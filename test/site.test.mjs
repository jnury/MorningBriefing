import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeEditionPages, listEditionDates, listPublishedEditionIds,
  rebuildEditionArchive, rebuildLanding,
} from '../lib/site.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url)));
const tmpRepo = () => mkdtempSync(join(tmpdir(), 'mb-site-'));

test('writeEditionPages writes the home page, the dated page and the data file', () => {
  const root = tmpRepo();
  writeEditionPages(root, fixture);
  assert.ok(existsSync(join(root, 'docs', 'e', 'main', 'index.html')));
  assert.ok(existsSync(join(root, 'docs', 'e', 'main', '2026-07-28.html')));
  assert.ok(existsSync(join(root, 'docs', 'e', 'main', 'data', '2026-07-28.json')));
});

test('both pages sit at the same depth, so their nav prefixes match', () => {
  const root = tmpRepo();
  writeEditionPages(root, fixture);
  const index = readFileSync(join(root, 'docs', 'e', 'main', 'index.html'), 'utf8');
  const dated = readFileSync(join(root, 'docs', 'e', 'main', '2026-07-28.html'), 'utf8');
  assert.match(index, /href="archive\.html"/);
  assert.match(dated, /href="archive\.html"/);
  assert.match(index, /href="\.\.\/\.\.\/index\.html"/);   // back to the landing page, two levels up
});

test('listEditionDates returns that edition dates newest first', () => {
  const root = tmpRepo();
  mkdirSync(join(root, 'docs', 'e', 'main', 'data'), { recursive: true });
  for (const d of ['2026-07-26', '2026-07-28', '2026-07-27']) {
    writeFileSync(join(root, 'docs', 'e', 'main', 'data', `${d}.json`), '{}');
  }
  assert.deepEqual(listEditionDates(root, 'main'), ['2026-07-28', '2026-07-27', '2026-07-26']);
});

test('listEditionDates returns an empty list for an edition never published', () => {
  assert.deepEqual(listEditionDates(tmpRepo(), 'inconnue'), []);
});

test('listPublishedEditionIds finds every edition directory', () => {
  const root = tmpRepo();
  writeEditionPages(root, fixture);
  writeEditionPages(root, { ...fixture, edition: 'carlos', title: 'Briefing de Carlos' });
  assert.deepEqual(listPublishedEditionIds(root).sort(), ['carlos', 'main']);
});

test('rebuildEditionArchive lists the dates found on disk', () => {
  const root = tmpRepo();
  writeEditionPages(root, fixture);
  rebuildEditionArchive(root, { id: 'main', title: 'Briefing du matin' });
  const arch = readFileSync(join(root, 'docs', 'e', 'main', 'archive.html'), 'utf8');
  assert.match(arch, /href="2026-07-28\.html"/);
});

test('rebuildLanding writes docs/index.html with one entry per configured edition', () => {
  const root = tmpRepo();
  writeEditionPages(root, fixture);
  rebuildLanding(root, [{ id: 'main', title: 'Briefing du matin' }, { id: 'carlos', title: 'Briefing de Carlos' }]);
  const landing = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
  assert.match(landing, /Briefing du matin/);
  assert.match(landing, /28 juillet 2026/);
  // Carlos is configured but never published: listed, without a link.
  assert.match(landing, /Briefing de Carlos/);
  assert.ok(!landing.includes('href="e/carlos/index.html"'));
});
