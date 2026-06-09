import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBriefing, countWords } from '../lib/schema.mjs';

const valid = () => JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url)));

test('countWords counts whitespace-separated words', () => {
  assert.equal(countWords('un deux trois'), 3);
  assert.equal(countWords('  espaces   multiples  '), 2);
  assert.equal(countWords(''), 0);
});

test('valid fixture passes', () => {
  const r = validateBriefing(valid());
  assert.equal(r.valid, true, r.errors.join('; '));
  assert.deepEqual(r.errors, []);
});

test('rejects wrong worldNews count', () => {
  const d = valid(); d.worldNews = d.worldNews.slice(0, 2);
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects missing weather city', () => {
  const d = valid(); delete d.weather.lausanne;
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects more than 20 tech items', () => {
  const d = valid();
  d.tech = Array.from({ length: 21 }, () => ({
    category: 'AI', title: 't', url: 'https://x.com', summary: 'résumé'
  }));
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects summary over 150 words', () => {
  const d = valid();
  d.tech[0].summary = Array.from({ length: 151 }, () => 'mot').join(' ');
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects bad tech category', () => {
  const d = valid(); d.tech[0].category = 'Sports';
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects non-http url', () => {
  const d = valid(); d.tech[0].url = 'ftp://x.com';
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects wrong market regions', () => {
  const d = valid(); d.markets.regions[0].region = 'LatAm';
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects a null market region without throwing', () => {
  const d = valid(); d.markets.regions[0] = null;
  let r;
  assert.doesNotThrow(() => { r = validateBriefing(d); });
  assert.equal(r.valid, false);
});
