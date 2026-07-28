import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertLegacy } from '../tools/migrate-legacy.mjs';

const legacy = {
  date: '2026-07-26',
  generatedAt: '2026-07-26T05:01:00+02:00',
  weather: {
    geneva: { high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10 },
    lausanne: { high: 23, low: 14, condition: 'Partiellement nuageux', weathercode: 2, precipProbability: 20 },
  },
  swissNews: [{ headline: 'Une nouvelle suisse', publishedAt: '2026-07-25' }],
  worldNews: [
    { headline: 'Une nouvelle mondiale', publishedAt: '2026-07-25' },
    { headline: 'Une autre', publishedAt: '2026-07-25' },
    { headline: 'Une troisième', publishedAt: '2026-07-25' },
  ],
  markets: { asOf: 'clôture du 25 juillet 2026', summary: 'Séance calme.', indices: [
    { name: 'Nasdaq', changePct: 0.4 }, { name: 'Dow Jones', changePct: 0.1 },
    { name: 'SMI', changePct: -0.2 }, { name: 'Euro Stoxx 50', changePct: 0.3 },
  ] },
  tech: [{ category: 'AI', title: 'Un modèle', url: 'https://e.com/a', publishedAt: '2026-07-25', summary: 'Résumé.' }],
};

const opts = { editionId: 'main', title: 'Briefing du matin' };

test('carries the identity fields over', () => {
  const out = convertLegacy(legacy, opts);
  assert.equal(out.edition, 'main');
  assert.equal(out.title, 'Briefing du matin');
  assert.equal(out.date, '2026-07-26');
  assert.equal(out.generatedAt, '2026-07-26T05:01:00+02:00');
});

test('produces the five sections in the original reading order', () => {
  assert.deepEqual(convertLegacy(legacy, opts).sections.map((s) => s.topic),
    ['weather', 'swiss', 'world', 'markets', 'tech']);
});

test('turns the two fixed weather keys into named cities', () => {
  const wx = convertLegacy(legacy, opts).sections[0];
  assert.equal(wx.kind, 'provider');
  assert.deepEqual(wx.cities.map((c) => c.name), ['Genève', 'Lausanne']);
  assert.equal(wx.cities[0].weathercode, 0);
});

test('maps swissNews and worldNews to headline sections', () => {
  const [, swiss, world] = convertLegacy(legacy, opts).sections;
  assert.equal(swiss.shape, 'headline');
  assert.equal(swiss.items[0].headline, 'Une nouvelle suisse');
  assert.equal(world.items.length, 3);
});

test('maps markets to a dataset section keeping asOf and summary', () => {
  const m = convertLegacy(legacy, opts).sections[3];
  assert.equal(m.kind, 'dataset');
  assert.equal(m.asOf, 'clôture du 25 juillet 2026');
  assert.equal(m.indices.length, 4);
});

test('maps tech to a card section', () => {
  const t = convertLegacy(legacy, opts).sections[4];
  assert.equal(t.shape, 'card');
  assert.equal(t.items[0].category, 'AI');
});

test('omits a section the legacy file does not have', () => {
  const { swissNews, ...withoutSwiss } = legacy;
  assert.ok(!convertLegacy(withoutSwiss, opts).sections.some((s) => s.topic === 'swiss'));
});

test('tolerates a legacy weather block with only one city', () => {
  const one = { ...legacy, weather: { geneva: legacy.weather.geneva } };
  assert.deepEqual(convertLegacy(one, opts).sections[0].cities.map((c) => c.name), ['Genève']);
});
