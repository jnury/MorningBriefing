import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArchive } from '../lib/render.mjs';

const editions = [{ date: '2026-06-07' }, { date: '2026-06-09' }, { date: '2026-06-08' }];

test('renderArchive lists editions newest first', () => {
  const html = renderArchive(editions, { linkPrefix: '' });
  const i9 = html.indexOf('2026-06-09');
  const i8 = html.indexOf('2026-06-08');
  const i7 = html.indexOf('2026-06-07');
  assert.ok(i9 < i8 && i8 < i7, 'order should be 9, 8, 7');
});

test('renderArchive links to edition permalinks with linkPrefix', () => {
  const html = renderArchive(editions, { linkPrefix: '' });
  assert.match(html, /href="editions\/2026-06-09\.html"/);
});

test('renderArchive uses French date labels', () => {
  const html = renderArchive(editions, { linkPrefix: '' });
  assert.match(html, /9 juin 2026/);
});
