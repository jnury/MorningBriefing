import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderEdition, renderArchive } from './render.mjs';

const DOCS = 'docs';

function ensure(dir) { mkdirSync(dir, { recursive: true }); }

// Write today's home page, the dated permalink, and persist the raw data.
export function writeEdition(root, data) {
  const docs = join(root, DOCS);
  ensure(join(docs, 'editions'));
  ensure(join(docs, 'data'));

  writeFileSync(join(docs, 'data', `${data.date}.json`), JSON.stringify(data, null, 2));
  writeFileSync(join(docs, 'index.html'), renderEdition(data, { linkPrefix: '' }));
  writeFileSync(join(docs, 'editions', `${data.date}.html`), renderEdition(data, { linkPrefix: '../' }));
}

// All edition dates present in docs/data, newest first.
export function listEditions(root) {
  const dataDir = join(root, DOCS, 'data');
  let files = [];
  try { files = readdirSync(dataDir); } catch { return []; }
  return files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort((a, b) => (a < b ? 1 : -1));
}

// Regenerate archive.html from whatever editions exist on disk.
export function rebuildArchive(root) {
  const docs = join(root, DOCS);
  ensure(docs);
  const editions = listEditions(root).map((date) => ({ date }));
  writeFileSync(join(docs, 'archive.html'), renderArchive(editions, { linkPrefix: '' }));
}
