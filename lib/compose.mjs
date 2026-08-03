import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildSelectPrompt } from './prompt.mjs';
import { bucketPath, runShell } from './collect.mjs';
import { parseUsage, emptyUsage } from './usage.mjs';

// Card items are identified by url, headline items by their headline text —
// but neither is guaranteed unique (syndicated stories share a url, wire
// headlines get reused verbatim), so that alone is only an anchor. title +
// publishedAt are folded in to break a genuine collision between two
// distinct bucket items sharing an anchor.
const anchorKey = (i) => (i?.url ? `u:${i.url}` : `h:${i?.headline ?? ''}`);
const fullKey = (i) => `${anchorKey(i)}|${i?.title ?? ''}|${i?.publishedAt ?? ''}`;

// The editor pass only ever selects. Anything it returns that is not in the
// bucket is dropped, so a hallucinated item can never reach the page.
function keepOnlyBucketItems(chosen, bucketItems) {
  const groups = new Map();    // anchor -> bucket items sharing it, in bucket order
  const byFullKey = new Map(); // exact identity -> first bucket item with it
  for (const item of bucketItems) {
    const anchor = anchorKey(item);
    if (!groups.has(anchor)) groups.set(anchor, []);
    groups.get(anchor).push(item);
    if (!byFullKey.has(fullKey(item))) byFullKey.set(fullKey(item), item); // first wins
  }

  const out = [];
  for (const c of chosen) {
    const group = groups.get(anchorKey(c));
    if (!group) continue;
    // An exact match disambiguates a real collision; short of that (or when
    // the anchor was unambiguous to begin with) the earliest — highest-ranked
    // — item sharing it is the least surprising resolution, tampered or not.
    const match = byFullKey.get(fullKey(c)) ?? group[0];
    if (!out.includes(match)) out.push(match);
  }
  return out;
}

// Market index names and city names are model-authored or hand-edited free
// text, matched by exact string. `missing` surfaces every requested name that
// did not match, so a config/bucket mismatch ("Nasdaq Composite" vs "Nasdaq")
// is visible in the log instead of silently producing a thin or empty section.
export function selectCities(section, bucketData) {
  const wanted = section.params?.cities || [];
  const byName = new Map(bucketData.cities.map((c) => [c.name, c]));
  return {
    cities: wanted.map((c) => byName.get(c.name)).filter(Boolean),
    missing: wanted.filter((c) => !byName.has(c.name)).map((c) => c.name),
  };
}

// Case, accents and punctuation removed so only the words themselves matter.
const normalizeName = (s) => (s ?? '')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A request for "Nasdaq" comes back as "Nasdaq Composite" and "Dow Jones" as
// "Dow Jones Industrial Average" — every day, because the collector names
// indices formally. Exact matching dropped both silently, so main published 2
// of its 4 indices from 2026-07-29 onward with the data sitting in the bucket.
//
// An exact match always wins; failing that the requested name may match a
// longer one, but only on a word boundary, so "SMI" resolves "SMI Mid" and
// never "SMIC". Anything looser would risk answering with the wrong index,
// which is worse than reporting it missing.
function findIndex(indices, requested) {
  const want = normalizeName(requested);
  if (want === '') return null;
  const exact = indices.find((i) => normalizeName(i.name) === want);
  if (exact) return { hit: exact, loose: false };
  const prefixed = indices.find((i) => normalizeName(i.name).startsWith(`${want} `));
  return prefixed ? { hit: prefixed, loose: true } : null;
}

// `loose` surfaces every name that only matched after normalisation, so the
// drift stays visible in the log rather than being quietly absorbed.
export function selectIndices(section, bucketData) {
  const wanted = section.params?.indices || [];
  const indices = [];
  const missing = [];
  const loose = [];

  for (const requested of wanted) {
    const found = findIndex(bucketData.indices, requested);
    if (!found) { missing.push(requested); continue; }
    if (found.loose) loose.push({ requested, found: found.hit.name });
    // The configured name is the editorial label — it keeps the compact index
    // strip compact — while the bucket supplies the value.
    indices.push({ ...found.hit, name: requested });
  }

  return { asOf: bucketData.asOf, summary: bucketData.summary, indices, missing, loose };
}

export function fallbackItems(section, bucketData) {
  return bucketData.items.slice(0, section.max);
}

// Scoped to Read + Write only: the editor must not research, it must choose.
function runClaudeSelect(prompt, outPath, root) {
  return runShell(
    'claude -p --model sonnet --allowedTools "Read,Write" --output-format json',
    { input: prompt, cwd: root, maxBuffer: 8 * 1024 * 1024 },
  );
}

async function selectWithEditor(edition, section, topic, bucketData, ctx) {
  const outPath = join(ctx.root, 'buckets', ctx.date, `sel-${edition.id}-${topic.id}.json`);
  mkdirSync(dirname(outPath), { recursive: true });

  const prompt = buildSelectPrompt({
    template: ctx.template, topic, section, edition,
    bucketPath: bucketPath(ctx.root, ctx.date, topic.id),
    outPath, date: ctx.date,
  });

  const run = ctx.runClaude || runClaudeSelect;
  const res = await run(prompt, outPath, ctx.root);
  // As in collect: parsed before any failure check, so a selection pass that
  // spent tokens and then failed still attributes that spend to its error.
  const usage = parseUsage(res.stdout);
  if (res.error) { res.error.usage = usage; throw res.error; }
  if (res.status !== 0) {
    const err = new Error(`sélection en échec (code ${res.status}) : ${(res.stderr || '').slice(0, 300)}`);
    err.usage = usage; throw err;
  }
  if (!existsSync(outPath)) {
    const err = new Error(`fichier de sélection absent : ${outPath}`);
    err.usage = usage; throw err;
  }

  let chosen;
  try {
    chosen = JSON.parse(readFileSync(outPath, 'utf8')).items;
  } catch (err) { err.usage = usage; throw err; }
  if (!Array.isArray(chosen) || chosen.length === 0) {
    const err = new Error('sélection vide');
    err.usage = usage; throw err;
  }
  return { items: keepOnlyBucketItems(chosen, bucketData.items).slice(0, section.max), usage };
}

export async function composeEdition(edition, ctx) {
  const sections = [];

  for (const section of edition.sections) {
    const topic = ctx.topics[section.topic];
    const result = ctx.bucketResults.get(topic.id);
    if (!result?.ok) {
      ctx.log?.(`compose ${edition.id}: section « ${topic.id} » omise (vivier indisponible)`);
      continue;
    }

    const base = { topic: topic.id, label: topic.label, kind: topic.kind };

    if (topic.kind === 'provider' || topic.kind === 'dataset') {
      // `missing` and `loose` are diagnostics, not page content — destructured
      // out so neither reaches the published edition JSON.
      const { missing, loose, ...picked } = topic.kind === 'provider'
        ? selectCities(section, result.data)
        : selectIndices(section, result.data);
      if (missing.length > 0) {
        ctx.log?.(`compose ${edition.id}: section « ${topic.id} » — non trouvé(s) dans le vivier : ${missing.join(', ')}`);
      }
      for (const l of loose ?? []) {
        ctx.log?.(`compose ${edition.id}: section « ${topic.id} » — « ${l.requested} » apparié à « ${l.found} »`);
      }
      const picks = topic.kind === 'provider' ? picked.cities : picked.indices;
      if (picks.length === 0) {
        // Same failure shape as a missing bucket: an empty deterministic
        // selection must not take the whole edition down with it.
        ctx.log?.(`compose ${edition.id}: section « ${topic.id} » omise (sélection vide)`);
        continue;
      }
      sections.push({ ...base, ...picked });
      continue;
    }

    let items, degraded = false, usage = emptyUsage();
    const start = Date.now();
    try {
      const outcome = await selectWithEditor(edition, section, topic, result.data, ctx);
      usage = outcome.usage;
      if (outcome.items.length === 0) throw new Error('aucun élément du vivier retenu');
      items = outcome.items;
    } catch (err) {
      // The bucket was already collected under the topic's editorial rules, so
      // falling back to its own ordering is safe — better a slightly generic
      // section than a blank one.
      ctx.log?.(`compose ${edition.id}: section « ${topic.id} » dégradée (${err.message})`);
      items = fallbackItems(section, result.data);
      degraded = true;
      usage = err.usage ?? usage;
    }
    // Recorded for every attempt, success or degraded, so a selection pass
    // that spent tokens before failing is never invisible to the cost log.
    // Guarded because composeEdition runs concurrently across editions
    // (Promise.all in generate.mjs): an unguarded callback throwing here
    // would take down every other edition's compose along with this one
    // section, which is exactly the isolation this module exists to avoid.
    try {
      ctx.recordSelection?.({
        edition: edition.id, topic: topic.id, ok: !degraded, usage, durationMs: Date.now() - start,
      });
    } catch { /* logging must never affect what gets composed or published */ }

    sections.push({ ...base, shape: topic.shape, degraded, items });
  }

  return {
    edition: edition.id,
    title: edition.title,
    date: ctx.date,
    generatedAt: ctx.now(),
    sections,
  };
}
