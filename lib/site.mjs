import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderEdition, renderArchive, renderLanding } from './render.mjs';

const DOCS = 'docs';

const ensure = (dir) => mkdirSync(dir, { recursive: true });
const editionDir = (root, id) => join(root, DOCS, 'e', id);

// Both the home page and the dated page live directly in the edition directory,
// so they share one link prefix and one copy of the rendered HTML.
export function writeEditionPages(root, data) {
  const dir = editionDir(root, data.edition);
  ensure(join(dir, 'data'));

  const html = renderEdition(data, { linkPrefix: '' });
  writeFileSync(join(dir, 'data', `${data.date}.json`), JSON.stringify(data, null, 2));
  writeFileSync(join(dir, 'index.html'), html);
  writeFileSync(join(dir, `${data.date}.html`), html);
}

export function listEditionDates(root, id) {
  let files = [];
  try { files = readdirSync(join(editionDir(root, id), 'data')); } catch { return []; }
  return files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort((a, b) => (a < b ? 1 : -1));
}

export function listPublishedEditionIds(root) {
  try {
    return readdirSync(join(root, DOCS, 'e'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch { return []; }
}

export function rebuildEditionArchive(root, { id, title }) {
  const dir = editionDir(root, id);
  ensure(dir);
  writeFileSync(join(dir, 'archive.html'), renderArchive({ id, title, dates: listEditionDates(root, id) }));
}

// Rebuilt from configuration, not from disk: an edition that failed this morning
// still appears, showing its last good date.
export function rebuildLanding(root, editions) {
  ensure(join(root, DOCS));
  const entries = editions.map(({ id, title }) => ({
    id, title, latestDate: listEditionDates(root, id)[0] || null,
  }));
  writeFileSync(join(root, DOCS, 'index.html'), renderLanding(entries));
}
