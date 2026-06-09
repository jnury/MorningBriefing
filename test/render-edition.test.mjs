import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderEdition } from '../lib/render.mjs';

const data = JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url)));

test('renderEdition includes weather for both cities', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.match(html, /Genève/);
  assert.match(html, /Lausanne/);
  assert.match(html, /Ensoleillé/);
});

test('renderEdition lists the three world news headlines', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  for (const n of data.worldNews) assert.ok(html.includes(n.headline), `missing: ${n.headline}`);
});

test('renderEdition shows market indices with numbers and signed percent', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.match(html, /S&amp;P 500/);
  assert.match(html, /SMI/);
  assert.match(html, /\+0[.,]42\s*%/);   // up value formatted with + sign
  assert.match(html, /-0[.,]12\s*%/);    // down value
});

test('renderEdition renders tech items with titles, links and category', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.match(html, /href="https:\/\/example\.com\/openclaw"/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /AI/);
  assert.match(html, /IT/);
  assert.match(html, /Science/);
});

test('renderEdition contains no emoji', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.ok(!/\p{Extended_Pictographic}/u.test(html), 'should not contain emoji');
});
