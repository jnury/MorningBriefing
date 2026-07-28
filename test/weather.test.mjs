import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wmoCondition, fetchWeatherBucket } from '../lib/weather.mjs';

test('wmoCondition maps known codes to French labels', () => {
  assert.equal(wmoCondition(0), 'Ensoleillé');
  assert.equal(wmoCondition(2), 'Partiellement nuageux');
  assert.equal(wmoCondition(3), 'Couvert');
  assert.equal(wmoCondition(45), 'Brouillard');
  assert.equal(wmoCondition(61), 'Pluie faible');
  assert.equal(wmoCondition(95), 'Orage');
});

test('wmoCondition falls back rather than throwing on an unknown code', () => {
  assert.equal(typeof wmoCondition(999), 'string');
  assert.ok(wmoCondition(999).length > 0);
});

const daily = (over = {}) => ({
  daily: {
    temperature_2m_max: [24.4], temperature_2m_min: [13.2],
    precipitation_probability_max: [10], weathercode: [0], ...over,
  },
});

test('fetchWeatherBucket builds one city entry per requested city', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => daily() }; };
  const bucket = { id: 'weather', kind: 'provider', params: { cities: [
    { name: 'Genève', lat: 46.2, lon: 6.14 }, { name: 'Zurich', lat: 47.37, lon: 8.54 },
  ] } };

  const data = await fetchWeatherBucket(bucket, '2026-07-28', { fetchImpl, now: () => '2026-07-28T05:00:00+02:00' });

  assert.equal(calls.length, 2);
  assert.match(calls[0], /latitude=46\.2/);
  assert.match(calls[1], /longitude=8\.54/);
  assert.equal(data.bucketId, 'weather');
  assert.equal(data.date, '2026-07-28');
  assert.deepEqual(data.cities.map((c) => c.name), ['Genève', 'Zurich']);
  assert.deepEqual(data.cities[0], {
    name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10,
  });
});

test('fetchWeatherBucket rejects when a city request fails', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  const bucket = { id: 'weather', kind: 'provider', params: { cities: [{ name: 'Genève', lat: 46.2, lon: 6.14 }] } };
  await assert.rejects(() => fetchWeatherBucket(bucket, '2026-07-28', { fetchImpl }), /503/);
});
