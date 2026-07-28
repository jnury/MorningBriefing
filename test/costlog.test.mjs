import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketCostLine, selectionCostLine, totalsLine, buildCostRecord } from '../lib/costlog.mjs';
import { emptyUsage } from '../lib/usage.mjs';

const usage = (over = {}) => ({ ...emptyUsage(), ...over });

test('bucketCostLine reports cost, turns, tokens and web counts in French', () => {
  const line = bucketCostLine({
    id: 'tech', ok: true, durationMs: 42300,
    usage: usage({ costUsd: 0.1234, numTurns: 3, inputTokens: 1200, outputTokens: 340, webSearchRequests: 2, webFetchRequests: 1 }),
  });
  assert.match(line, /collecte tech OK/);
  assert.match(line, /\$0\.1234/);
  assert.match(line, /3 tour\(s\)/);
  assert.match(line, /1200 entrée \/ 340 sortie/);
  assert.match(line, /2 recherche\(s\) web/);
  assert.match(line, /1 fetch\(s\)/);
  assert.match(line, /42\.3s/);
});

test('bucketCostLine shows ÉCHEC and n/d for a failed bucket with no usage', () => {
  const line = bucketCostLine({ id: 'tech', ok: false, durationMs: 1200, usage: emptyUsage() });
  assert.match(line, /collecte tech ÉCHEC/);
  assert.match(line, /n\/d/);
});

test('bucketCostLine tolerates a missing usage field entirely rather than throwing', () => {
  const line = bucketCostLine({ id: 'tech', ok: true, durationMs: 100 });
  assert.match(line, /n\/d/);
});

test('selectionCostLine identifies the edition and topic', () => {
  const line = selectionCostLine({
    edition: 'main', topic: 'tech', ok: true, durationMs: 3100,
    usage: usage({ costUsd: 0.01, numTurns: 1 }),
  });
  assert.match(line, /sélection main\/tech OK/);
  assert.match(line, /\$0\.0100/);
});

test('totalsLine reports stage durations', () => {
  const line = totalsLine('2026-07-28', usage({ costUsd: 0.5, numTurns: 10 }), { collectMs: 120000, composeMs: 30000 });
  assert.match(line, /2026-07-28/);
  assert.match(line, /\$0\.5000/);
  assert.match(line, /collectMs 120\.0s/);
  assert.match(line, /composeMs 30\.0s/);
});

test('buildCostRecord round-trips through JSON and sums totals across buckets and selections', () => {
  const buckets = [
    { id: 'tech', kind: 'topic', ok: true, durationMs: 1000, usage: usage({ costUsd: 0.1, numTurns: 2, inputTokens: 100 }) },
    { id: 'weather', kind: 'provider', ok: true, durationMs: 50, usage: emptyUsage() },
  ];
  const selections = [
    { edition: 'main', topic: 'tech', ok: true, durationMs: 200, usage: usage({ costUsd: 0.02, numTurns: 1, inputTokens: 50 }) },
  ];
  const record = buildCostRecord({
    date: '2026-07-28', timestamp: '2026-07-28T05:00:00.000Z', buckets, selections,
    stageDurations: { collectMs: 1000, composeMs: 200 },
  });

  const roundTripped = JSON.parse(JSON.stringify(record));
  assert.deepEqual(roundTripped, record);

  assert.equal(record.date, '2026-07-28');
  assert.equal(record.buckets.length, 2);
  assert.equal(record.buckets[0].id, 'tech');
  assert.equal(record.buckets[0].costUsd, 0.1); // flattened, not nested under `usage`
  assert.equal(record.selections[0].edition, 'main');
  assert.equal(record.selections[0].topic, 'tech');
  assert.ok(Math.abs(record.totals.costUsd - 0.12) < 1e-9);
  assert.equal(record.totals.numTurns, 3);
  assert.equal(record.totals.inputTokens, 150);
  assert.deepEqual(record.stageDurations, { collectMs: 1000, composeMs: 200 });
});

test('buildCostRecord totals stay null when nothing reported any usage', () => {
  const buckets = [{ id: 'weather', kind: 'provider', ok: true, durationMs: 50, usage: emptyUsage() }];
  const record = buildCostRecord({ date: '2026-07-28', timestamp: 'x', buckets, selections: [], stageDurations: {} });
  assert.equal(record.totals.costUsd, null);
});

// The attribution gap: a bucket shared by two editions (e.g. the markets
// dataset bucket, which does make a real claude call at collection) must
// show which editions consumed it, since its cost is a single shared cost
// that cannot be meaningfully split per edition.
test('buildCostRecord carries consumers on each bucket entry, defaulting to empty when absent', () => {
  const buckets = [
    { id: 'markets', kind: 'dataset', ok: true, durationMs: 500, consumers: ['main', 'carlos'], usage: usage({ costUsd: 0.05 }) },
    { id: 'weather', kind: 'provider', ok: true, durationMs: 50, usage: emptyUsage() },
  ];
  const record = buildCostRecord({ date: '2026-07-28', timestamp: 'x', buckets, selections: [], stageDurations: {} });
  assert.deepEqual(record.buckets[0].consumers, ['main', 'carlos']);
  assert.deepEqual(record.buckets[1].consumers, []);
});
