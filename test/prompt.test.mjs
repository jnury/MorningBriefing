import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCollectPrompt, buildSelectPrompt } from '../lib/prompt.mjs';

const collectTpl = readFileSync(new URL('../prompts/collect.md', import.meta.url), 'utf8');
const selectTpl = readFileSync(new URL('../prompts/select.md', import.meta.url), 'utf8');

const TECH = {
  id: 'tech', kind: 'topic', label: 'Tech', shape: 'card',
  categories: ['IT', 'Science', 'AI'], bucketMin: 30, maxAgeDays: 2, summaryMaxWords: 150,
  research: 'Actualités tech de la veille.', sources: ['ScienceDaily', 'blogs officiels'],
};
const SWISS = {
  id: 'swiss', kind: 'topic', label: 'Suisse', shape: 'headline',
  bucketMin: 10, maxAgeDays: 2, research: 'Actualités suisses.',
  sources: ['RTS'], editorial: 'Aucun fait divers.',
};
const MARKETS = { id: 'markets', kind: 'dataset', label: 'Marchés', research: 'Variations des indices.' };

const args = (topic, bucket) => ({
  template: collectTpl, house: 'RÈGLES MAISON', topic, bucket,
  date: '2026-07-28', outPath: 'buckets/2026-07-28/tech.json',
});

test('collect prompt substitutes date, house rules, research text and output path', () => {
  const p = buildCollectPrompt(args(TECH, { id: 'tech', kind: 'topic', size: 50, hints: [], params: {} }));
  assert.match(p, /2026-07-28/);
  assert.match(p, /RÈGLES MAISON/);
  assert.match(p, /Actualités tech de la veille\./);
  assert.match(p, /buckets\/2026-07-28\/tech\.json/);
  assert.ok(!p.includes('{{'), 'aucun placeholder ne doit subsister');
});

// The cap is a validation boundary, not a writing target. Asking for the cap
// produced summaries at 141-154 words against a 150 cap for days running, so
// the prompt aims at summaryTargetWords and leaves the rest as headroom.
test('collect prompt aims at the target length and still names the hard cap', () => {
  const topic = { ...TECH, summaryTargetWords: 120 };
  const p = buildCollectPrompt(args(topic, { id: 'tech', kind: 'topic', size: 30, hints: [], params: {} }));
  assert.match(p, /120 mots/);
  assert.match(p, /150 mots/, 'le plafond dur reste énoncé');
});

test('collect prompt falls back to the cap when no target is configured', () => {
  const p = buildCollectPrompt(args(TECH, { id: 'tech', kind: 'topic', size: 30, hints: [], params: {} }));
  assert.match(p, /150 mots/);
});

test('collect prompt states the derived bucket size and the age limit', () => {
  const p = buildCollectPrompt(args(TECH, { id: 'tech', kind: 'topic', size: 50, hints: [], params: {} }));
  assert.match(p, /50/);
  assert.match(p, /2 jours/);
});

test('collect prompt lists hints when present and omits the block when absent', () => {
  const withHints = buildCollectPrompt(args(TECH, { id: 'tech', kind: 'topic', size: 50, hints: ['IA', 'CVE'], params: {} }));
  assert.match(withHints, /IA/);
  assert.match(withHints, /CVE/);
  const without = buildCollectPrompt(args(TECH, { id: 'tech', kind: 'topic', size: 50, hints: [], params: {} }));
  assert.ok(!/Centres d'intérêt/.test(without), 'le bloc hints doit disparaître quand il est vide');
});

test('collect prompt includes the editorial line when the topic declares one', () => {
  const p = buildCollectPrompt({ ...args(SWISS, { id: 'swiss', kind: 'topic', size: 10, hints: [], params: {} }) });
  assert.match(p, /Aucun fait divers\./);
});

test('collect prompt for a card topic documents the card fields and categories', () => {
  const p = buildCollectPrompt(args(TECH, { id: 'tech', kind: 'topic', size: 50, hints: [], params: {} }));
  assert.match(p, /"title"/);
  assert.match(p, /"url"/);
  assert.match(p, /"summary"/);
  assert.match(p, /IT.*Science.*AI|IT, Science, AI/s);
});

test('collect prompt for a headline topic documents the headline field only', () => {
  const p = buildCollectPrompt(args(SWISS, { id: 'swiss', kind: 'topic', size: 10, hints: [], params: {} }));
  assert.match(p, /"headline"/);
  assert.ok(!p.includes('"summary"'), 'un topic headline ne demande pas de summary');
});

test('collect prompt for the markets dataset lists the requested indices', () => {
  const p = buildCollectPrompt({
    ...args(MARKETS, { id: 'markets', kind: 'dataset', hints: [], params: { indices: ['Nasdaq', 'SMI'] } }),
  });
  assert.match(p, /Nasdaq/);
  assert.match(p, /SMI/);
  assert.match(p, /"changePct"/);
});

test('select prompt carries the edition preferences, the max and both paths', () => {
  const p = buildSelectPrompt({
    template: selectTpl, topic: TECH,
    section: { topic: 'tech', max: 10, prefs: 'Cybersécurité d\'abord.' },
    edition: { id: 'carlos', title: 'Briefing de Carlos' },
    bucketPath: 'buckets/2026-07-28/tech.json',
    outPath: 'buckets/2026-07-28/sel-carlos-tech.json',
    date: '2026-07-28',
  });
  assert.match(p, /Cybersécurité d'abord\./);
  assert.match(p, /10/);
  assert.match(p, /buckets\/2026-07-28\/tech\.json/);
  assert.match(p, /buckets\/2026-07-28\/sel-carlos-tech\.json/);
  assert.ok(!p.includes('{{'), 'aucun placeholder ne doit subsister');
});

test('select prompt still carries the topic editorial line, so preferences cannot override it', () => {
  const p = buildSelectPrompt({
    template: selectTpl, topic: SWISS,
    section: { topic: 'swiss', max: 3, prefs: 'Genève d\'abord.' },
    edition: { id: 'main', title: 'Briefing' },
    bucketPath: 'b.json', outPath: 'o.json', date: '2026-07-28',
  });
  assert.match(p, /Aucun fait divers\./);
});

// fill() used replaceAll(literalKey, String(value)) -- the value is a normal
// string argument, but replaceAll still scans it for $$, $&, $`, $' special
// replacement patterns. config/ prose is French editorial text the user
// edits freely, so a preference containing "$&" must not silently corrupt
// the prompt.
test('collect prompt is not corrupted by a research/editorial value containing a $&-style pattern', () => {
  const topic = { ...SWISS, research: 'Priorité aux thèmes A&B ($&) de la veille.' };
  const p = buildCollectPrompt(args(topic, { id: 'swiss', kind: 'topic', size: 10, hints: [], params: {} }));
  assert.match(p, /Priorité aux thèmes A&B \(\$&\) de la veille\./);
});

test('select prompt is not corrupted by a prefs value containing a $&-style pattern', () => {
  const p = buildSelectPrompt({
    template: selectTpl, topic: TECH,
    section: { topic: 'tech', max: 5, prefs: 'IA d\'abord ($&), puis le reste.' },
    edition: { id: 'main', title: 'Briefing' },
    bucketPath: 'b.json', outPath: 'o.json', date: '2026-07-28',
  });
  assert.match(p, /IA d'abord \(\$&\), puis le reste\./);
});

test('select prompt handles a section without prefs', () => {
  const p = buildSelectPrompt({
    template: selectTpl, topic: TECH,
    section: { topic: 'tech', max: 5 },
    edition: { id: 'main', title: 'Briefing' },
    bucketPath: 'b.json', outPath: 'o.json', date: '2026-07-28',
  });
  assert.ok(!p.includes('{{'), 'aucun placeholder ne doit subsister');
});
