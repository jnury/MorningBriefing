import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSelectPrompt } from './prompt.mjs';
import { bucketPath } from './collect.mjs';

// The editor pass only ever selects. Anything it returns that is not in the
// bucket is dropped, so a hallucinated item can never reach the page.
function keepOnlyBucketItems(chosen, bucketItems) {
  const known = new Map(bucketItems.map((i) => [itemKey(i), i]));
  const out = [];
  for (const c of chosen) {
    const match = known.get(itemKey(c));
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

const itemKey = (i) => (i?.url ? `u:${i.url}` : `h:${i?.headline ?? ''}`);

export function selectCities(section, bucketData) {
  const wanted = section.params?.cities || [];
  const byName = new Map(bucketData.cities.map((c) => [c.name, c]));
  return { cities: wanted.map((c) => byName.get(c.name)).filter(Boolean) };
}

export function selectIndices(section, bucketData) {
  const wanted = section.params?.indices || [];
  const byName = new Map(bucketData.indices.map((i) => [i.name, i]));
  return {
    asOf: bucketData.asOf,
    summary: bucketData.summary,
    indices: wanted.map((n) => byName.get(n)).filter(Boolean),
  };
}

export function fallbackItems(section, bucketData) {
  return bucketData.items.slice(0, section.max);
}

// Scoped to Read + Write only: the editor must not research, it must choose.
function runClaudeSelect(prompt, outPath, root) {
  return spawnSync(
    'claude -p --model sonnet --allowedTools "Read,Write" --output-format json',
    { input: prompt, encoding: 'utf8', shell: true, maxBuffer: 8 * 1024 * 1024, cwd: root },
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
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`sélection en échec (code ${res.status}) : ${(res.stderr || '').slice(0, 300)}`);
  if (!existsSync(outPath)) throw new Error(`fichier de sélection absent : ${outPath}`);

  const chosen = JSON.parse(readFileSync(outPath, 'utf8')).items;
  if (!Array.isArray(chosen) || chosen.length === 0) throw new Error('sélection vide');
  return keepOnlyBucketItems(chosen, bucketData.items).slice(0, section.max);
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

    if (topic.kind === 'provider') { sections.push({ ...base, ...selectCities(section, result.data) }); continue; }
    if (topic.kind === 'dataset') { sections.push({ ...base, ...selectIndices(section, result.data) }); continue; }

    let items, degraded = false;
    try {
      items = await selectWithEditor(edition, section, topic, result.data, ctx);
      if (items.length === 0) throw new Error('aucun élément du vivier retenu');
    } catch (err) {
      // The bucket was already collected under the topic's editorial rules, so
      // falling back to its own ordering is safe — better a slightly generic
      // section than a blank one.
      ctx.log?.(`compose ${edition.id}: section « ${topic.id} » dégradée (${err.message})`);
      items = fallbackItems(section, result.data);
      degraded = true;
    }

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
