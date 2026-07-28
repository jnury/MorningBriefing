import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArchive } from '../lib/render.mjs';

const edition = { id: 'main', title: 'Briefing du matin', dates: ['2026-07-26', '2026-07-28', '2026-07-27'] };

test('lists every date, newest first, in French', () => {
  const html = renderArchive(edition);
  assert.ok(html.indexOf('28 juillet 2026') < html.indexOf('27 juillet 2026'));
  assert.ok(html.indexOf('27 juillet 2026') < html.indexOf('26 juillet 2026'));
});

test('links to the dated page inside the same edition directory', () => {
  assert.match(renderArchive(edition), /href="2026-07-28\.html"/);
});

test('carries the edition title', () => {
  assert.match(renderArchive(edition), /Briefing du matin/);
});

test('renders an empty archive without crashing', () => {
  assert.match(renderArchive({ ...edition, dates: [] }), /<h1>Archives<\/h1>/);
});
