import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBuckets, OVERCOLLECT } from '../lib/plan.mjs';

const TOPICS = {
  weather: { id: 'weather', kind: 'provider', label: 'Météo' },
  markets: { id: 'markets', kind: 'dataset', label: 'Marchés' },
  tech:    { id: 'tech', kind: 'topic', label: 'Tech', shape: 'card', bucketMin: 30, maxAgeDays: 2 },
  world:   { id: 'world', kind: 'topic', label: 'Monde', shape: 'headline', bucketMin: 10, maxAgeDays: 2 },
};

const MAIN = {
  id: 'main', title: 'M', order: 1,
  sections: [
    { topic: 'weather', params: { cities: [{ name: 'Genève', lat: 46.2, lon: 6.14 }, { name: 'Lausanne', lat: 46.52, lon: 6.63 }] } },
    { topic: 'markets', params: { indices: ['Nasdaq', 'SMI'] } },
    { topic: 'tech', max: 20, hints: ['IA', 'cloud'] },
  ],
};

const CARLOS = {
  id: 'carlos', title: 'C', order: 2,
  sections: [
    { topic: 'weather', params: { cities: [{ name: 'Zurich', lat: 47.37, lon: 8.54 }, { name: 'Genève', lat: 46.2, lon: 6.14 }] } },
    { topic: 'world', max: 5 },
    { topic: 'tech', max: 10, hints: ['cybersécurité', 'IA'] },
  ],
};

const cfg = { house: 'h', topics: TOPICS, editions: [MAIN, CARLOS] };

test('one bucket per distinct topic, ordered by id', () => {
  assert.deepEqual(planBuckets(cfg).map((b) => b.id), ['markets', 'tech', 'weather', 'world']);
});

test('weather cities are unioned across editions, deduplicated by name', () => {
  const wx = planBuckets(cfg).find((b) => b.id === 'weather');
  assert.deepEqual(wx.params.cities.map((c) => c.name), ['Genève', 'Lausanne', 'Zurich']);
});

test('market indices are unioned across editions', () => {
  const m = planBuckets(cfg).find((b) => b.id === 'markets');
  assert.deepEqual(m.params.indices, ['Nasdaq', 'SMI']);
});

test('hints are unioned across editions, deduplicated, first-seen order', () => {
  const tech = planBuckets(cfg).find((b) => b.id === 'tech');
  assert.deepEqual(tech.hints, ['IA', 'cloud', 'cybersécurité']);
});

test('topic bucket size is the larger of bucketMin and largest max x OVERCOLLECT', () => {
  const byId = Object.fromEntries(planBuckets(cfg).map((b) => [b.id, b]));
  // tech: largest max is 20 -> ceil(20 * 2.5) = 50, above bucketMin 30
  assert.equal(byId.tech.size, Math.ceil(20 * OVERCOLLECT));
  // world: largest max is 5 -> ceil(5 * 2.5) = 13, below bucketMin 10? no: 13 > 10
  assert.equal(byId.world.size, 13);
});

test('bucketMin wins when demand is small', () => {
  const small = { ...cfg, editions: [{ id: 'x', title: 'X', order: 1, sections: [{ topic: 'tech', max: 2 }] }] };
  assert.equal(planBuckets(small).find((b) => b.id === 'tech').size, 30);
});

test('provider and dataset buckets have no size', () => {
  const byId = Object.fromEntries(planBuckets(cfg).map((b) => [b.id, b]));
  assert.equal(byId.weather.size, undefined);
  assert.equal(byId.markets.size, undefined);
});

test('consumers lists the editions using each bucket', () => {
  const byId = Object.fromEntries(planBuckets(cfg).map((b) => [b.id, b]));
  assert.deepEqual(byId.tech.consumers, ['main', 'carlos']);
  assert.deepEqual(byId.world.consumers, ['carlos']);
});

test('editionIds narrows planning to the requested editions only', () => {
  const ids = planBuckets(cfg, { editionIds: ['carlos'] }).map((b) => b.id);
  assert.deepEqual(ids, ['tech', 'weather', 'world']);
});
