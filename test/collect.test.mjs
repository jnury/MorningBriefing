import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAll } from '../lib/collect.mjs';

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
