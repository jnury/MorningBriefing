import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCollectPrompt } from './prompt.mjs';
import { validateBucket } from './schema.mjs';
import { fetchWeatherBucket } from './weather.mjs';

export const bucketPath = (root, date, id) => join(root, 'buckets', date, `${id}.json`);

// Scope the headless run to exactly the tools a collector needs. In -p mode a
// non-allowlisted tool is denied rather than prompted, so the run stays
// unattended without granting blanket permissions.
export function runClaudeCollect(prompt, outPath, root) {
  return spawnSync(
    'claude -p --model opus --allowedTools "WebSearch,WebFetch,Write" --output-format json',
    { input: prompt, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024, cwd: root },
  );
}

async function collectOne(bucket, ctx) {
  const topic = ctx.topics[bucket.id];
  const outPath = bucketPath(ctx.root, ctx.date, bucket.id);
  mkdirSync(dirname(outPath), { recursive: true });

  let data;
  if (topic.kind === 'provider') {
    data = await fetchWeatherBucket(bucket, ctx.date, { fetchImpl: ctx.fetchImpl, now: ctx.now });
    // Researched buckets are written by the model itself; a provider bucket only
    // ever lives in memory unless we persist it, so --recompose would find nothing.
    writeFileSync(outPath, JSON.stringify(data, null, 2));
  } else {
    const prompt = buildCollectPrompt({
      template: ctx.template, house: ctx.house, topic, bucket, date: ctx.date, outPath,
    });
    const res = await ctx.runClaude(prompt, outPath, ctx.root);
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`claude a échoué (code ${res.status}) : ${(res.stderr || '').slice(0, 500)}`);
    if (!existsSync(outPath)) throw new Error(`fichier de vivier absent : ${outPath}`);
    data = JSON.parse(readFileSync(outPath, 'utf8'));
  }

  const { valid, errors } = validateBucket(data, topic, ctx.date);
  if (!valid) throw new Error(`vivier invalide :\n - ${errors.join('\n - ')}`);
  return data;
}

// Runs every collector with a concurrency cap. A bucket that fails is recorded
// as failed and never throws out of here: the morning must publish whatever
// else succeeded.
export async function collectAll(buckets, ctx) {
  const results = new Map();
  const queue = [...buckets];
  const limit = Math.max(1, ctx.concurrency ?? 4);

  const worker = async () => {
    while (queue.length) {
      const bucket = queue.shift();
      try {
        results.set(bucket.id, { ok: true, data: await collectOne(bucket, ctx) });
      } catch (err) {
        results.set(bucket.id, { ok: false, error: err.message });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, buckets.length) }, worker));
  return results;
}
