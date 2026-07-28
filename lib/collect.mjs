import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { buildCollectPrompt } from './prompt.mjs';
import { validateBucket } from './schema.mjs';
import { fetchWeatherBucket } from './weather.mjs';
import { parseUsage, emptyUsage } from './usage.mjs';

export const bucketPath = (root, date, id) => join(root, 'buckets', date, `${id}.json`);

// spawnSync blocks the entire Node event loop for the child's whole lifetime,
// so a "concurrent" pool of spawnSync workers only ever runs one at a time —
// worker 1 never yields for 2-4 to start. spawn() plus this promise wrapper
// runs the child out-of-process while the event loop stays free, so the
// concurrency cap in collectAll/composeEdition is real rather than bookkeeping
// that never gets exercised.
export function runShell(command, { input, cwd, maxBuffer }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, { shell: true, cwd });
    } catch (error) {
      resolve({ status: null, stdout: '', stderr: '', error });
      return;
    }

    let stdout = '';
    let stderr = '';
    let overflowed = false;
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };

    // A child that exits before reading stdin (e.g. immediate failure) must
    // not crash the parent with an unhandled EPIPE/ECONNRESET.
    child.stdin.on('error', () => {});

    const collect = (chunk, into) => {
      const next = into + chunk.toString('utf8');
      if (next.length <= maxBuffer) return next;
      overflowed = true;
      child.kill();
      return into;
    };
    child.stdout.on('data', (chunk) => { stdout = collect(chunk, stdout); });
    child.stderr.on('data', (chunk) => { stderr = collect(chunk, stderr); });

    child.on('error', (error) => finish({ status: null, stdout, stderr, error }));
    child.on('close', (status) => {
      if (overflowed) finish({ status: null, stdout, stderr, error: new Error('maxBuffer dépassé') });
      else finish({ status, stdout, stderr });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

// Scope the headless run to exactly the tools a collector needs. In -p mode a
// non-allowlisted tool is denied rather than prompted, so the run stays
// unattended without granting blanket permissions.
export function runClaudeCollect(prompt, outPath, root) {
  return runShell(
    'claude -p --model opus --allowedTools "WebSearch,WebFetch,Write" --output-format json',
    { input: prompt, cwd: root, maxBuffer: 32 * 1024 * 1024 },
  );
}

async function collectOne(bucket, ctx) {
  const topic = ctx.topics[bucket.id];
  const outPath = bucketPath(ctx.root, ctx.date, bucket.id);
  mkdirSync(dirname(outPath), { recursive: true });

  let data;
  let usage = emptyUsage();
  if (topic.kind === 'provider') {
    data = await fetchWeatherBucket(bucket, ctx.date, { fetchImpl: ctx.fetchImpl, now: ctx.now });
  } else {
    const prompt = buildCollectPrompt({
      template: ctx.template, house: ctx.house, topic, bucket, date: ctx.date, outPath,
    });
    const res = await ctx.runClaude(prompt, outPath, ctx.root);
    // Parsed before any failure check: a bucket that burned tokens and then
    // failed (bad exit code, invalid JSON, failed validation) is exactly the
    // one worth attributing spend to, so every throw below carries usage.
    usage = parseUsage(res.stdout);
    if (res.error) { res.error.usage = usage; throw res.error; }
    if (res.status !== 0) {
      const err = new Error(`claude a échoué (code ${res.status}) : ${(res.stderr || '').slice(0, 500)}`);
      err.usage = usage; throw err;
    }
    if (!existsSync(outPath)) {
      const err = new Error(`fichier de vivier absent : ${outPath}`);
      err.usage = usage; throw err;
    }
    try {
      data = JSON.parse(readFileSync(outPath, 'utf8'));
    } catch (err) { err.usage = usage; throw err; }
  }

  const { valid, errors } = validateBucket(data, topic, ctx.date);
  if (!valid) {
    const err = new Error(`vivier invalide :\n - ${errors.join('\n - ')}`);
    err.usage = usage; throw err;
  }

  // Researched buckets are written by the model itself; a provider bucket only
  // ever lives in memory unless we persist it here, so --recompose would find
  // nothing. Written only after validation succeeds, so --recompose never
  // reloads an invalid provider bucket left on disk from a failed run.
  if (topic.kind === 'provider') writeFileSync(outPath, JSON.stringify(data, null, 2));

  return { data, usage };
}

// Runs every collector with a concurrency cap. A bucket that fails is recorded
// as failed and never throws out of here: the morning must publish whatever
// else succeeded. usage/durationMs are attached to every outcome, success or
// failure, so a costly failed run is still visible in the cost log.
export async function collectAll(buckets, ctx) {
  const results = new Map();
  const queue = [...buckets];
  const limit = Math.max(1, ctx.concurrency ?? 4);

  const worker = async () => {
    while (queue.length) {
      const bucket = queue.shift();
      const start = Date.now();
      try {
        const { data, usage } = await collectOne(bucket, ctx);
        results.set(bucket.id, { ok: true, data, usage, durationMs: Date.now() - start });
      } catch (err) {
        results.set(bucket.id, {
          ok: false, error: err.message, usage: err.usage ?? emptyUsage(), durationMs: Date.now() - start,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, buckets.length) }, worker));
  return results;
}
