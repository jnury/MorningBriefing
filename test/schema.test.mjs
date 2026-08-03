import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, validateBucket, validateEditionData } from '../lib/schema.mjs';

const TECH = {
  id: 'tech', kind: 'topic', label: 'Tech', shape: 'card',
  categories: ['IT', 'Science', 'AI'], bucketMin: 30, maxAgeDays: 2, summaryMaxWords: 150,
};
const WORLD = { id: 'world', kind: 'topic', label: 'Monde', shape: 'headline', bucketMin: 10, maxAgeDays: 2 };
const WEATHER = { id: 'weather', kind: 'provider', label: 'Météo' };
const MARKETS = { id: 'markets', kind: 'dataset', label: 'Marchés' };

const card = (over = {}) => ({
  category: 'AI', title: 'Titre', url: 'https://example.com/a',
  publishedAt: '2026-07-27', summary: 'Résumé court.', ...over,
});
const headline = (over = {}) => ({ headline: 'Une nouvelle', publishedAt: '2026-07-27', ...over });

const bucket = (over = {}) => ({
  bucketId: 'tech', date: '2026-07-28', collectedAt: '2026-07-28T05:02:00+02:00',
  shape: 'card', items: [card()], ...over,
});

test('countWords counts whitespace-separated words', () => {
  assert.equal(countWords('un deux trois'), 3);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords(null), 0);
});

test('a well-formed card bucket validates', () => {
  const r = validateBucket(bucket(), TECH, '2026-07-28');
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.data.items.length, 1);
});

// A bucket is an over-collected candidate pool (see OVERCOLLECT in plan.mjs),
// not a publishable artefact: one malformed candidate must cost that candidate,
// never the whole pool. On 2026-08-03 a single tech summary came in 4 words over
// the 150-word cap and erased all 33 items from both editions.
test('bucket drops a single invalid item and keeps the rest of the pool', () => {
  const long = Array.from({ length: 151 }, (_, i) => `m${i}`).join(' ');
  const items = [card({ title: 'A' }), card({ title: 'B', summary: long }), card({ title: 'C' })];
  const r = validateBucket(bucket({ items }), TECH, '2026-07-28');

  assert.equal(r.valid, true, 'the pool survives one bad candidate');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data.items.map((i) => i.title), ['A', 'C'], 'only the offender is removed');
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].index, 1);
  assert.match(r.dropped[0].errors.join(' '), /150 mots/);
});

test('bucket drops stale, miscategorised and malformed candidates alike', () => {
  const items = [
    card({ title: 'ok' }),
    card({ title: 'vieux', publishedAt: '2026-07-20' }),
    card({ title: 'futur', publishedAt: '2026-07-29' }),
    card({ title: 'categorie', category: 'Sport' }),
    card({ title: 'url', url: 'ftp://x' }),
  ];
  const r = validateBucket(bucket({ items }), TECH, '2026-07-28');
  assert.equal(r.valid, true);
  assert.deepEqual(r.data.items.map((i) => i.title), ['ok']);
  assert.equal(r.dropped.length, 4);
});

test('bucket stays invalid when every candidate is dropped, and says why', () => {
  const long = Array.from({ length: 151 }, (_, i) => `m${i}`).join(' ');
  const r = validateBucket(bucket({ items: [card({ summary: long })] }), TECH, '2026-07-28');
  assert.equal(r.valid, false);
  // The per-item reason must survive into the fatal message, or a bucket that
  // fails wholesale becomes undiagnosable.
  assert.match(r.errors.join(' '), /150 mots/);
});

test('a structural error is still fatal however many items are valid', () => {
  const r = validateBucket(bucket({ bucketId: 'autre' }), TECH, '2026-07-28');
  assert.equal(r.valid, false);
  assert.match(r.errors.join(' '), /bucketId/);
});

test('bucket rejects an item older than the topic maxAgeDays', () => {
  const r = validateBucket(bucket({ items: [card({ publishedAt: '2026-07-20' })] }), TECH, '2026-07-28');
  assert.equal(r.valid, false);
  assert.match(r.errors.join(' '), /trop ancien/);
});

test('bucket rejects a publishedAt in the future', () => {
  const r = validateBucket(bucket({ items: [card({ publishedAt: '2026-07-29' })] }), TECH, '2026-07-28');
  assert.match(r.errors.join(' '), /futur/);
});

test('bucket rejects a category outside the topic list', () => {
  const r = validateBucket(bucket({ items: [card({ category: 'Sport' })] }), TECH, '2026-07-28');
  assert.match(r.errors.join(' '), /category/);
});

test('bucket rejects a non-http url', () => {
  const r = validateBucket(bucket({ items: [card({ url: 'ftp://x' })] }), TECH, '2026-07-28');
  assert.match(r.errors.join(' '), /url/);
});

test('bucket rejects a summary over summaryMaxWords', () => {
  const long = Array.from({ length: 151 }, (_, i) => `m${i}`).join(' ');
  const r = validateBucket(bucket({ items: [card({ summary: long })] }), TECH, '2026-07-28');
  assert.match(r.errors.join(' '), /150 mots/);
});

test('bucket rejects an empty item list', () => {
  const r = validateBucket(bucket({ items: [] }), TECH, '2026-07-28');
  assert.equal(r.valid, false);
});

test('a headline bucket validates and requires headline text', () => {
  const ok = validateBucket({ bucketId: 'world', date: '2026-07-28', collectedAt: 'x', shape: 'headline', items: [headline()] }, WORLD, '2026-07-28');
  assert.equal(ok.valid, true);
  const bad = validateBucket({ bucketId: 'world', date: '2026-07-28', collectedAt: 'x', shape: 'headline', items: [{ publishedAt: '2026-07-27' }] }, WORLD, '2026-07-28');
  assert.match(bad.errors.join(' '), /headline/);
});

test('a markets dataset bucket validates asOf, summary and numeric changePct', () => {
  const good = { bucketId: 'markets', date: '2026-07-28', collectedAt: 'x', asOf: 'clôture du 27 juillet', summary: 'Séance calme.', indices: [{ name: 'SMI', changePct: 0.4 }] };
  assert.equal(validateBucket(good, MARKETS, '2026-07-28').valid, true);
  const bad = { ...good, indices: [{ name: 'SMI', changePct: '0.4' }] };
  assert.match(validateBucket(bad, MARKETS, '2026-07-28').errors.join(' '), /changePct/);
});

test('a weather provider bucket validates its cities', () => {
  const good = { bucketId: 'weather', date: '2026-07-28', collectedAt: 'x', cities: [{ name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10 }] };
  assert.equal(validateBucket(good, WEATHER, '2026-07-28').valid, true);
  const bad = { ...good, cities: [{ name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', precipProbability: 10 }] };
  assert.match(validateBucket(bad, WEATHER, '2026-07-28').errors.join(' '), /weathercode/);
});

const CONFIG = { topics: { tech: TECH, world: WORLD, weather: WEATHER, markets: MARKETS }, editions: [] };

const editionData = (over = {}) => ({
  edition: 'main', title: 'Briefing du matin', date: '2026-07-28',
  generatedAt: '2026-07-28T05:04:00+02:00',
  sections: [
    { topic: 'tech', label: 'Tech', kind: 'topic', shape: 'card', items: [card()] },
  ],
  ...over,
});

test('a well-formed edition validates', () => {
  assert.deepEqual(validateEditionData(editionData(), CONFIG), { valid: true, errors: [] });
});

test('edition rejects an unknown topic in a section', () => {
  const r = validateEditionData(editionData({ sections: [{ topic: 'sport', label: 'S', kind: 'topic', shape: 'card', items: [card()] }] }), CONFIG);
  assert.match(r.errors.join(' '), /sport/);
});

test('edition rejects a stale item, same rule as the bucket', () => {
  const r = validateEditionData(editionData({ sections: [{ topic: 'tech', label: 'Tech', kind: 'topic', shape: 'card', items: [card({ publishedAt: '2026-07-01' })] }] }), CONFIG);
  assert.match(r.errors.join(' '), /trop ancien/);
});

test('edition rejects an empty sections array — a fully failed run publishes nothing, not an empty page', () => {
  const r = validateEditionData(editionData({ sections: [] }), CONFIG);
  assert.equal(r.valid, false);
  assert.match(r.errors.join(' '), /aucune section/);
});
