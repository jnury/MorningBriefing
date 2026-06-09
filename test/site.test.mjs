import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeEdition, rebuildArchive, listEditions } from '../lib/site.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url)));

function tmpRepo() { return mkdtempSync(join(tmpdir(), 'mb-')); }

test('writeEdition writes index.html and the dated permalink, and saves data', () => {
  const root = tmpRepo();
  writeEdition(root, fixture);
  assert.ok(existsSync(join(root, 'docs', 'index.html')));
  assert.ok(existsSync(join(root, 'docs', 'editions', '2026-06-09.html')));
  assert.ok(existsSync(join(root, 'docs', 'data', '2026-06-09.json')));
  const index = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
  const perma = readFileSync(join(root, 'docs', 'editions', '2026-06-09.html'), 'utf8');
  assert.match(index, /href="index\.html"/);        // depth-0 nav
  assert.match(perma, /href="\.\.\/index\.html"/);   // depth-1 nav
});

test('listEditions returns dates found in docs/data newest first', () => {
  const root = tmpRepo();
  mkdirSync(join(root, 'docs', 'data'), { recursive: true });
  for (const d of ['2026-06-07', '2026-06-09', '2026-06-08']) {
    writeFileSync(join(root, 'docs', 'data', `${d}.json`), JSON.stringify({ date: d }));
  }
  assert.deepEqual(listEditions(root), ['2026-06-09', '2026-06-08', '2026-06-07']);
});

test('rebuildArchive writes archive.html listing all editions', () => {
  const root = tmpRepo();
  writeEdition(root, fixture);
  rebuildArchive(root);
  const arch = readFileSync(join(root, 'docs', 'archive.html'), 'utf8');
  assert.match(arch, /href="editions\/2026-06-09\.html"/);
});
