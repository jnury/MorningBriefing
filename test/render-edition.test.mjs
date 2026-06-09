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

test('renderEdition shows the four indices on one line with signed percent', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.match(html, /class="markets"/);
  for (const name of ['Nasdaq', 'Dow Jones', 'SMI', 'Euro Stoxx 50']) {
    assert.ok(html.includes(name), `missing index: ${name}`);
  }
  assert.match(html, /\+0[.,]61\s*%/);   // Nasdaq up
  assert.match(html, /-0[.,]12\s*%/);    // Dow Jones down
  assert.match(html, /Séance hésitante/); // single summary sentence
});

test('renderEdition includes an inline weather icon for each city', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.equal((html.match(/<svg class="wx"/g) || []).length, 2);
});

test('renderEdition puts a category badge before each tech title', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.match(html, /href="https:\/\/example\.com\/openclaw"/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /<span class="badge badge-ai">AI<\/span>/);
  assert.match(html, /badge-it">IT</);
  assert.match(html, /badge-science">Science</);
});

test('renderEdition contains no emoji', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.ok(!/\p{Extended_Pictographic}/u.test(html), 'should not contain emoji');
});
