import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLanding } from '../lib/render.mjs';

const entries = [
  { id: 'main', title: 'Briefing du matin', latestDate: '2026-07-28' },
  { id: 'carlos', title: 'Briefing de Carlos', latestDate: '2026-07-27' },
];

test('renders one card per edition, in the given order', () => {
  const html = renderLanding(entries);
  assert.ok(html.indexOf('Briefing du matin') < html.indexOf('Briefing de Carlos'));
});

test('links to each edition home page and archive', () => {
  const html = renderLanding(entries);
  assert.match(html, /href="e\/main\/index\.html"/);
  assert.match(html, /href="e\/carlos\/archive\.html"/);
});

test('shows the latest date of each edition in French', () => {
  const html = renderLanding(entries);
  assert.match(html, /28 juillet 2026/);
  assert.match(html, /27 juillet 2026/);
});

test('an edition with no published date is shown without a link to today', () => {
  const html = renderLanding([{ id: 'neuf', title: 'Nouveau', latestDate: null }]);
  assert.match(html, /Nouveau/);
  assert.ok(!html.includes('href="e/neuf/index.html"'), 'pas de lien vers une édition jamais publiée');
});
