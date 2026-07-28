// One-shot migration of the pre-multi-edition archive.
//
// Converts every docs/data/<date>.json from the flat legacy shape into the
// section-based edition shape, republishes it under docs/e/main/, and removes
// the old structure. Old URLs are not preserved: that was an explicit decision.
//
// Run once, verify the site, then delete this file — git history keeps it and
// it has no recurring use. Keeping it would mean carrying a legacy branch in a
// codebase that should only ever know one shape.
//
//   node tools/migrate-legacy.mjs            # convert and rewrite docs/
//   node tools/migrate-legacy.mjs --dry-run  # report only, touch nothing

import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { validateEditionData } from '../lib/schema.mjs';
import { writeEditionPages, rebuildEditionArchive, rebuildLanding } from '../lib/site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The legacy shape hard-coded these two cities as object keys.
const LEGACY_CITIES = [['geneva', 'Genève'], ['lausanne', 'Lausanne']];

const LABELS = {
  weather: 'Météo',
  swiss: 'La Suisse en bref',
  world: 'Le monde en bref',
  markets: 'Marchés',
  tech: 'Tech · IT, Science & IA',
};

export function convertLegacy(legacy, { editionId, title, labels = LABELS }) {
  const sections = [];

  if (legacy.weather) {
    const cities = LEGACY_CITIES
      .filter(([key]) => legacy.weather[key])
      .map(([key, name]) => ({ name, ...legacy.weather[key] }));
    if (cities.length) sections.push({ topic: 'weather', label: labels.weather, kind: 'provider', cities });
  }

  for (const [topic, field] of [['swiss', 'swissNews'], ['world', 'worldNews']]) {
    if (Array.isArray(legacy[field]) && legacy[field].length) {
      sections.push({ topic, label: labels[topic], kind: 'topic', shape: 'headline', items: legacy[field] });
    }
  }

  if (legacy.markets) {
    sections.push({
      topic: 'markets', label: labels.markets, kind: 'dataset',
      asOf: legacy.markets.asOf, summary: legacy.markets.summary, indices: legacy.markets.indices,
    });
  }

  if (Array.isArray(legacy.tech) && legacy.tech.length) {
    sections.push({ topic: 'tech', label: labels.tech, kind: 'topic', shape: 'card', items: legacy.tech });
  }

  return { edition: editionId, title, date: legacy.date, generatedAt: legacy.generatedAt, sections };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig(ROOT);
  const mainEdition = config.editions.find((e) => e.id === 'main');
  if (!mainEdition) throw new Error('édition « main » introuvable dans config/editions/');

  const legacyDir = join(ROOT, 'docs', 'data');
  const files = existsSync(legacyDir)
    ? readdirSync(legacyDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    : [];
  if (files.length === 0) { console.log('aucune édition héritée à migrer'); return; }

  let converted = 0;
  for (const file of files) {
    const legacy = JSON.parse(readFileSync(join(legacyDir, file), 'utf8'));
    const data = convertLegacy(legacy, { editionId: mainEdition.id, title: mainEdition.title });

    // Legacy items are older than maxAgeDays by construction, so freshness is
    // checked against the edition's own date rather than today's.
    const { valid, errors } = validateEditionData(data, config);
    if (!valid) { console.error(`${file}: IGNORÉ — ${errors.join(' | ')}`); continue; }

    if (!dryRun) writeEditionPages(ROOT, data);
    converted++;
  }

  console.log(`${converted}/${files.length} édition(s) converties${dryRun ? ' (simulation)' : ''}`);
  if (dryRun) return;

  for (const edition of config.editions) rebuildEditionArchive(ROOT, edition);
  rebuildLanding(ROOT, config.editions);

  for (const stale of ['data', 'editions', 'archive.html']) {
    rmSync(join(ROOT, 'docs', stale), { recursive: true, force: true });
  }
  console.log('ancienne structure supprimée : docs/data, docs/editions, docs/archive.html');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
