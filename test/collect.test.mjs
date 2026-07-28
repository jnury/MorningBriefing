import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAll, bucketPath, runShell } from '../lib/collect.mjs';
import { emptyUsage } from '../lib/usage.mjs';

const TOPICS = {
  weather: { id: 'weather', kind: 'provider', label: 'Météo' },
  tech: { id: 'tech', kind: 'topic', label: 'Tech', shape: 'card', categories: ['AI'], bucketMin: 30, maxAgeDays: 2, summaryMaxWords: 150, research: 'r', sources: ['s'] },
  world: { id: 'world', kind: 'topic', label: 'Monde', shape: 'headline', bucketMin: 10, maxAgeDays: 2, research: 'r', sources: ['s'] },
};

const DATE = '2026-07-28';
const item = () => ({ category: 'AI', title: 't', url: 'https://e.com/a', publishedAt: '2026-07-27', summary: 's' });

function ctx(root, runClaude, over = {}) {
  return {
    root, date: DATE, house: 'H', topics: TOPICS,
    template: 'PROMPT {{OUTPUT_PATH}} {{DATE}}',
    concurrency: 2, runClaude,
    fetchImpl: async () => ({ ok: true, json: async () => ({ daily: {
      temperature_2m_max: [24], temperature_2m_min: [13],
      precipitation_probability_max: [10], weathercode: [0] } }) }),
    now: () => '2026-07-28T05:00:00+02:00',
    ...over,
  };
}

const tmpRoot = () => mkdtempSync(join(tmpdir(), 'mb-col-'));

// Real, tiny node scripts stand in for `claude` here — never the real process,
// but real child processes, so runShell is exercised against actual OS
// scheduling rather than a JS-level mock that would yield control regardless
// of whether the production code is truly asynchronous.
const helpersDir = mkdtempSync(join(tmpdir(), 'mb-col-helpers-'));
const sleepScript = join(helpersDir, 'sleep.mjs');
writeFileSync(sleepScript, 'setTimeout(() => process.exit(0), Number(process.argv[2] || 100));\n');
const echoStdinScript = join(helpersDir, 'echo-stdin.mjs');
writeFileSync(echoStdinScript, [
  "let data = '';",
  "process.stdin.on('data', (c) => { data += c; });",
  "process.stdin.on('end', () => { process.stdout.write(data); process.exit(0); });",
].join('\n'));

// A fake collector that writes the bucket file the real Claude run would write.
function writingRunner(payloadFor) {
  return (prompt, outPath) => {
    const payload = payloadFor(outPath);
    if (payload === null) return { status: 1, stderr: 'échec simulé' };
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify(payload));
    return { status: 0, stderr: '' };
  };
}

test('collects a provider bucket without calling the model', async () => {
  const root = tmpRoot();
  let claudeCalls = 0;
  const buckets = [{ id: 'weather', kind: 'provider', hints: [], params: { cities: [{ name: 'Genève', lat: 46.2, lon: 6.14 }] }, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, () => { claudeCalls++; return { status: 0 }; }));
  assert.equal(claudeCalls, 0);
  assert.equal(results.get('weather').ok, true);
  assert.equal(results.get('weather').data.cities[0].name, 'Genève');
});

test('collects a researched bucket and validates it', async () => {
  const root = tmpRoot();
  const run = writingRunner(() => ({
    bucketId: 'tech', date: DATE, collectedAt: 'x', shape: 'card', items: [item()],
  }));
  const buckets = [{ id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, run));
  assert.equal(results.get('tech').ok, true);
  assert.equal(results.get('tech').data.items.length, 1);
});

// A stdout JSON payload alongside a status-0 exit stands in for the real
// `claude -p --output-format json` result: collectAll must parse it into the
// result entry rather than only ever caring about the bucket file it wrote.
test('a successful collect records its usage/cost and a wall-clock duration', async () => {
  const root = tmpRoot();
  const resultJson = JSON.stringify({
    total_cost_usd: 0.1234, num_turns: 3,
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 50, cache_read_input_tokens: 10,
      server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } },
  });
  const run = (prompt, outPath) => {
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ bucketId: 'tech', date: DATE, collectedAt: 'x', shape: 'card', items: [item()] }));
    return { status: 0, stdout: resultJson };
  };
  const buckets = [{ id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, run));
  const r = results.get('tech');
  assert.equal(r.ok, true);
  assert.equal(r.usage.costUsd, 0.1234);
  assert.equal(r.usage.numTurns, 3);
  assert.equal(r.usage.webSearchRequests, 2);
  assert.equal(typeof r.durationMs, 'number');
  assert.ok(r.durationMs >= 0);
});

// The whole point of instrumenting a failure path: a bucket that burned
// tokens and then failed (non-zero exit here) must still surface that spend,
// not silently drop it because the run itself was a failure.
test('a failed collect (non-zero exit) still records the usage the run reported', async () => {
  const root = tmpRoot();
  const resultJson = JSON.stringify({ total_cost_usd: 0.07, num_turns: 1, usage: { input_tokens: 500, output_tokens: 100 } });
  const run = () => ({ status: 1, stdout: resultJson, stderr: 'boom' });
  const buckets = [{ id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, run));
  const r = results.get('tech');
  assert.equal(r.ok, false);
  assert.equal(r.usage.costUsd, 0.07);
  assert.equal(r.usage.inputTokens, 500);
});

// Same guarantee, but for a failure that only surfaces after the process
// exited 0 — an invalid bucket caught by validateBucket. The spend already
// happened by the time validation runs.
test('a bucket that fails validation still records the usage the run reported', async () => {
  const root = tmpRoot();
  const resultJson = JSON.stringify({ total_cost_usd: 0.02, num_turns: 1 });
  const run = (prompt, outPath) => {
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({
      bucketId: 'tech', date: DATE, collectedAt: 'x', shape: 'card',
      items: [{ ...item(), publishedAt: '2026-01-01' }], // stale, fails validation
    }));
    return { status: 0, stdout: resultJson };
  };
  const buckets = [{ id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, run));
  const r = results.get('tech');
  assert.equal(r.ok, false);
  assert.equal(r.usage.costUsd, 0.02);
});

test('a provider bucket (no claude call) reports null usage rather than fabricating cost', async () => {
  const root = tmpRoot();
  const buckets = [{ id: 'weather', kind: 'provider', hints: [], params: { cities: [{ name: 'Genève', lat: 46.2, lon: 6.14 }] }, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, () => ({ status: 0 })));
  assert.deepEqual(results.get('weather').usage, emptyUsage());
});

// --recompose reloads buckets from disk (buckets/<date>/<id>.json) instead of
// re-collecting, so every successfully collected bucket must leave that file
// behind — regardless of which branch of collectOne produced it.
test('persists a provider bucket to disk so --recompose can reload it', async () => {
  const root = tmpRoot();
  const buckets = [{ id: 'weather', kind: 'provider', hints: [], params: { cities: [{ name: 'Genève', lat: 46.2, lon: 6.14 }] }, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, () => ({ status: 0 })));
  assert.equal(results.get('weather').ok, true);
  const onDisk = JSON.parse(readFileSync(bucketPath(root, DATE, 'weather'), 'utf8'));
  assert.deepEqual(onDisk, results.get('weather').data);
});

test('persists a researched bucket to disk so --recompose can reload it', async () => {
  const root = tmpRoot();
  const run = writingRunner(() => ({
    bucketId: 'world', date: DATE, collectedAt: 'x', shape: 'headline',
    items: [{ headline: 'h', publishedAt: '2026-07-27' }],
  }));
  const buckets = [{ id: 'world', kind: 'topic', size: 10, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, run));
  assert.equal(results.get('world').ok, true);
  const onDisk = JSON.parse(readFileSync(bucketPath(root, DATE, 'world'), 'utf8'));
  assert.deepEqual(onDisk, results.get('world').data);
});

test('marks a bucket failed when the run exits non-zero', async () => {
  const root = tmpRoot();
  const buckets = [{ id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, writingRunner(() => null)));
  assert.equal(results.get('tech').ok, false);
  assert.match(results.get('tech').error, /échec|code/i);
});

test('marks a bucket failed when the written file is invalid', async () => {
  const root = tmpRoot();
  const run = writingRunner(() => ({
    bucketId: 'tech', date: DATE, collectedAt: 'x', shape: 'card',
    items: [{ ...item(), publishedAt: '2026-01-01' }],   // stale
  }));
  const buckets = [{ id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, run));
  assert.equal(results.get('tech').ok, false);
  assert.match(results.get('tech').error, /trop ancien/);
});

test('one failing bucket does not prevent the others from succeeding', async () => {
  const root = tmpRoot();
  const run = writingRunner((outPath) => (outPath.includes('tech') ? null : {
    bucketId: 'world', date: DATE, collectedAt: 'x', shape: 'headline',
    items: [{ headline: 'h', publishedAt: '2026-07-27' }],
  }));
  const buckets = [
    { id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] },
    { id: 'world', kind: 'topic', size: 10, hints: [], params: {}, consumers: ['main'] },
  ];
  const results = await collectAll(buckets, ctx(root, run));
  assert.equal(results.get('tech').ok, false);
  assert.equal(results.get('world').ok, true);
});

test('never runs more collectors at once than the concurrency cap', async () => {
  const root = tmpRoot();
  // Distinct bucket ids: identical ids would collapse into one results entry.
  const topics = { ...TOPICS };
  const buckets = [];
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    topics[id] = { ...TOPICS.world, id };
    buckets.push({ id, kind: 'topic', size: 10, hints: [], params: {}, consumers: ['main'] });
  }

  let running = 0, peak = 0;
  const run = async (prompt, outPath) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    const id = outPath.match(/([a-e])\.json$/)[1];
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({
      bucketId: id, date: DATE, collectedAt: 'x', shape: 'headline',
      items: [{ headline: 'h', publishedAt: '2026-07-27' }],
    }));
    return { status: 0 };
  };

  const results = await collectAll(buckets, ctx(root, run, { concurrency: 2, topics }));
  assert.equal(results.size, 5);
  assert.ok([...results.values()].every((r) => r.ok));
  // Exact, not just <=: this also catches a regression that silently serialises
  // the pool (peak stuck at 1), which `peak <= 2` alone would never flag.
  assert.equal(peak, 2, `pic de concurrence ${peak}, attendu exactement 2`);
});

test('concurrency: 1 runs collectors strictly one at a time', async () => {
  const root = tmpRoot();
  const topics = { ...TOPICS };
  const buckets = [];
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    topics[id] = { ...TOPICS.world, id };
    buckets.push({ id, kind: 'topic', size: 10, hints: [], params: {}, consumers: ['main'] });
  }

  let running = 0, peak = 0;
  const run = async (prompt, outPath) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    const id = outPath.match(/([a-e])\.json$/)[1];
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({
      bucketId: id, date: DATE, collectedAt: 'x', shape: 'headline',
      items: [{ headline: 'h', publishedAt: '2026-07-27' }],
    }));
    return { status: 0 };
  };

  const results = await collectAll(buckets, ctx(root, run, { concurrency: 1, topics }));
  assert.equal(results.size, 5);
  assert.ok([...results.values()].every((r) => r.ok));
  assert.equal(peak, 1, `pic de concurrence ${peak}, attendu exactement 1`);
});

test('runShell delivers the prompt on stdin to the child process', async () => {
  const root = tmpRoot();
  const res = await runShell(`node "${echoStdinScript}"`, {
    input: 'CONTENU DU PROMPT', cwd: root, maxBuffer: 1024 * 1024,
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, 'CONTENU DU PROMPT');
});

// This is the regression test for the spawnSync bug: it runs the real, exported
// runShell (the async spawn wrapper collectOne actually calls in production)
// against real child processes, not a JS-level async mock. A mock with
// `await new Promise(r => setTimeout(r, ms))` yields control on its own and
// would pass even if the production runner still used spawnSync — which is
// exactly why the pre-existing concurrency tests above did not catch the bug.
// spawnSync blocks the whole Node process for the child's lifetime, so with
// N === concurrency (every bucket eligible to start at once) a spawnSync-based
// runner would still serialise them behind worker 1: wall-clock ~= N * SLEEP_MS.
// A genuinely async runner instead costs about one SLEEP_MS plus one process
// spawn, regardless of N.
test('collectAll genuinely overlaps slow collectors instead of serialising them (regression: spawnSync blocked the event loop)', async () => {
  const root = tmpRoot();
  const topics = { ...TOPICS };
  const ids = ['a', 'b', 'c', 'd'];
  const buckets = [];
  for (const id of ids) {
    topics[id] = { ...TOPICS.world, id };
    buckets.push({ id, kind: 'topic', size: 10, hints: [], params: {}, consumers: ['main'] });
  }

  const SLEEP_MS = 300;
  const run = async (prompt, outPath) => {
    const res = await runShell(`node "${sleepScript}" ${SLEEP_MS}`, {
      input: prompt, cwd: root, maxBuffer: 1024 * 1024,
    });
    const id = outPath.match(/([a-d])\.json$/)[1];
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({
      bucketId: id, date: DATE, collectedAt: 'x', shape: 'headline',
      items: [{ headline: 'h', publishedAt: '2026-07-27' }],
    }));
    return { status: res.status, stderr: res.stderr };
  };

  const start = Date.now();
  const results = await collectAll(buckets, ctx(root, run, { concurrency: 4, topics }));
  const elapsed = Date.now() - start;

  assert.equal(results.size, 4);
  assert.ok([...results.values()].every((r) => r.ok), JSON.stringify([...results.values()]));
  // Serialised (the bug) would take roughly 4 * SLEEP_MS = 1200ms plus four
  // process-spawn overheads. Genuinely concurrent takes roughly one SLEEP_MS
  // plus one spawn. The threshold sits well below the serial floor while
  // leaving generous room for process-spawn variance on a loaded machine.
  assert.ok(elapsed < SLEEP_MS * 2.5, `délai ${elapsed}ms — les collecteurs semblent sérialisés`);
});
