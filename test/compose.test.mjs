import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeEdition, selectCities, selectIndices, fallbackItems } from '../lib/compose.mjs';
import { emptyUsage } from '../lib/usage.mjs';

const TOPICS = {
  weather: { id: 'weather', kind: 'provider', label: 'Météo' },
  markets: { id: 'markets', kind: 'dataset', label: 'Marchés' },
  tech: { id: 'tech', kind: 'topic', label: 'Tech', shape: 'card', categories: ['AI', 'IT'], bucketMin: 30, maxAgeDays: 2, summaryMaxWords: 150 },
};

const DATE = '2026-07-28';
const card = (n) => ({ category: 'AI', title: `t${n}`, url: `https://e.com/${n}`, publishedAt: '2026-07-27', summary: `s${n}` });

const WEATHER_BUCKET = { bucketId: 'weather', date: DATE, collectedAt: 'x', cities: [
  { name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10 },
  { name: 'Zurich', high: 21, low: 12, condition: 'Couvert', weathercode: 3, precipProbability: 40 },
  { name: 'Lausanne', high: 23, low: 14, condition: 'Nuageux', weathercode: 2, precipProbability: 20 },
] };

const MARKETS_BUCKET = { bucketId: 'markets', date: DATE, collectedAt: 'x', asOf: 'clôture du 27', summary: 'Calme.', indices: [
  { name: 'Nasdaq', changePct: 0.4 }, { name: 'SMI', changePct: -0.1 }, { name: 'Dow Jones', changePct: 0.2 },
] };

const TECH_BUCKET = { bucketId: 'tech', date: DATE, collectedAt: 'x', shape: 'card', items: [1, 2, 3, 4, 5].map(card) };

const tmpRoot = () => mkdtempSync(join(tmpdir(), 'mb-comp-'));

function ctx(root, over = {}) {
  return {
    root, date: DATE, topics: TOPICS, template: 'SELECT {{OUTPUT_PATH}} {{MAX}}',
    bucketResults: new Map([
      ['weather', { ok: true, data: WEATHER_BUCKET }],
      ['markets', { ok: true, data: MARKETS_BUCKET }],
      ['tech', { ok: true, data: TECH_BUCKET }],
    ]),
    runClaude: (prompt, outPath) => {
      mkdirSync(join(outPath, '..'), { recursive: true });
      writeFileSync(outPath, JSON.stringify({ items: [card(3), card(1)] }));
      return { status: 0 };
    },
    now: () => '2026-07-28T05:04:00+02:00',
    log: () => {},
    ...over,
  };
}

test('selectCities picks the edition cities in configured order', () => {
  const s = { topic: 'weather', params: { cities: [{ name: 'Lausanne' }, { name: 'Genève' }] } };
  assert.deepEqual(selectCities(s, WEATHER_BUCKET).cities.map((c) => c.name), ['Lausanne', 'Genève']);
});

test('selectCities skips a city the bucket does not have', () => {
  const s = { topic: 'weather', params: { cities: [{ name: 'Genève' }, { name: 'Berne' }] } };
  assert.deepEqual(selectCities(s, WEATHER_BUCKET).cities.map((c) => c.name), ['Genève']);
});

test('selectIndices picks the edition indices in configured order', () => {
  const s = { topic: 'markets', params: { indices: ['SMI', 'Nasdaq'] } };
  const out = selectIndices(s, MARKETS_BUCKET);
  assert.deepEqual(out.indices.map((i) => i.name), ['SMI', 'Nasdaq']);
  assert.equal(out.asOf, 'clôture du 27');
  assert.equal(out.summary, 'Calme.');
});

test('selectCities reports a city name that did not match the bucket', () => {
  const s = { topic: 'weather', params: { cities: [{ name: 'Genève' }, { name: 'Berne' }] } };
  assert.deepEqual(selectCities(s, WEATHER_BUCKET).missing, ['Berne']);
});

test('selectIndices reports an index name that did not match the bucket', () => {
  const s = { topic: 'markets', params: { indices: ['Nasdaq', 'Nasdaq Composite'] } };
  assert.deepEqual(selectIndices(s, MARKETS_BUCKET).missing, ['Nasdaq Composite']);
});

test('fallbackItems takes the top max in bucket order', () => {
  assert.deepEqual(fallbackItems({ max: 2 }, TECH_BUCKET).map((i) => i.title), ['t1', 't2']);
});

test('composeEdition builds sections in configured order', async () => {
  const edition = { id: 'main', title: 'Briefing', order: 1, sections: [
    { topic: 'weather', params: { cities: [{ name: 'Genève' }] } },
    { topic: 'tech', max: 2, prefs: 'IA' },
  ] };
  const data = await composeEdition(edition, ctx(tmpRoot()));
  assert.equal(data.edition, 'main');
  assert.equal(data.title, 'Briefing');
  assert.equal(data.date, DATE);
  assert.deepEqual(data.sections.map((s) => s.topic), ['weather', 'tech']);
  assert.equal(data.sections[0].kind, 'provider');
  assert.equal(data.sections[1].kind, 'topic');
  assert.equal(data.sections[1].shape, 'card');
  assert.equal(data.sections[1].label, 'Tech');
});

test('the editor selection is honoured, in the order it returned', async () => {
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  const data = await composeEdition(edition, ctx(tmpRoot()));
  assert.deepEqual(data.sections[0].items.map((i) => i.title), ['t3', 't1']);
  assert.ok(!data.sections[0].degraded);
});

test('an item the editor invented is dropped — selection cannot add to the bucket', async () => {
  const root = tmpRoot();
  const runClaude = (prompt, outPath) => {
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ items: [card(2), { ...card(9), title: 'inventé' }] }));
    return { status: 0 };
  };
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 3 }] };
  const data = await composeEdition(edition, ctx(root, { runClaude }));
  assert.deepEqual(data.sections[0].items.map((i) => i.title), ['t2']);
});

test('two bucket items colliding on url are broken by publishedAt — the editor picks the first, not the second', async () => {
  const root = tmpRoot();
  const dup = (n, publishedAt) => ({ category: 'AI', title: 'shared', url: 'https://e.com/shared', publishedAt, summary: `s${n}` });
  const first = dup(1, '2026-07-26');
  const second = dup(2, '2026-07-27');
  const bucket = { bucketId: 'tech', date: DATE, collectedAt: 'x', shape: 'card', items: [first, second] };
  const runClaude = (prompt, outPath) => {
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ items: [{ ...first }] }));
    return { status: 0 };
  };
  const bucketResults = new Map([['tech', { ok: true, data: bucket }]]);
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  const data = await composeEdition(edition, ctx(root, { runClaude, bucketResults }));
  assert.equal(data.sections[0].items.length, 1);
  assert.equal(data.sections[0].items[0].publishedAt, '2026-07-26');
  assert.equal(data.sections[0].items[0].summary, 's1');
});

test('a tampered copy still resolves to the bucket item, with its original fields intact', async () => {
  const root = tmpRoot();
  const real = { category: 'AI', title: 'Titre réel', url: 'https://e.com/uniq', publishedAt: '2026-07-25', summary: 'Résumé réel' };
  const tampered = { category: 'AI', title: 'Titre modifié', url: 'https://e.com/uniq', publishedAt: '2026-07-27', summary: 'Résumé modifié' };
  const bucket = { bucketId: 'tech', date: DATE, collectedAt: 'x', shape: 'card', items: [real] };
  const runClaude = (prompt, outPath) => {
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ items: [tampered] }));
    return { status: 0 };
  };
  const bucketResults = new Map([['tech', { ok: true, data: bucket }]]);
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 1 }] };
  const data = await composeEdition(edition, ctx(root, { runClaude, bucketResults }));
  assert.equal(data.sections[0].items.length, 1);
  assert.equal(data.sections[0].items[0].title, 'Titre réel');
  assert.equal(data.sections[0].items[0].summary, 'Résumé réel');
  assert.equal(data.sections[0].items[0].publishedAt, '2026-07-25');
});

test('the max is enforced even if the editor returns more', async () => {
  const root = tmpRoot();
  const runClaude = (prompt, outPath) => {
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ items: [card(1), card(2), card(3), card(4)] }));
    return { status: 0 };
  };
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  const data = await composeEdition(edition, ctx(root, { runClaude }));
  assert.equal(data.sections[0].items.length, 2);
});

test('a failed editor pass degrades to bucket order rather than dropping the section', async () => {
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  const data = await composeEdition(edition, ctx(tmpRoot(), { runClaude: () => ({ status: 1, stderr: 'boom' }) }));
  assert.equal(data.sections.length, 1);
  assert.equal(data.sections[0].degraded, true);
  assert.deepEqual(data.sections[0].items.map((i) => i.title), ['t1', 't2']);
});

test('a section whose bucket failed is omitted entirely', async () => {
  const bucketResults = new Map([
    ['tech', { ok: false, error: 'échec' }],
    ['weather', { ok: true, data: WEATHER_BUCKET }],
  ]);
  const edition = { id: 'main', title: 'B', sections: [
    { topic: 'weather', params: { cities: [{ name: 'Genève' }] } },
    { topic: 'tech', max: 2 },
  ] };
  const data = await composeEdition(edition, ctx(tmpRoot(), { bucketResults }));
  assert.deepEqual(data.sections.map((s) => s.topic), ['weather']);
});

test('an edition whose every bucket failed produces no sections', async () => {
  const bucketResults = new Map([['tech', { ok: false, error: 'échec' }]]);
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  const data = await composeEdition(edition, ctx(tmpRoot(), { bucketResults }));
  assert.deepEqual(data.sections, []);
});

// Market/city names are model-authored or hand-edited free text matched by
// exact string; a config/bucket mismatch must drop only that section, not
// the whole edition, and must be visible in the log rather than silent.
test('a dataset section is omitted when none of its indices match the bucket, other sections still publish', async () => {
  const logs = [];
  const edition = { id: 'main', title: 'B', sections: [
    { topic: 'weather', params: { cities: [{ name: 'Genève' }] } },
    { topic: 'markets', params: { indices: ['Nasdaq Composite'] } },
  ] };
  const data = await composeEdition(edition, ctx(tmpRoot(), { log: (l) => logs.push(l) }));
  assert.deepEqual(data.sections.map((s) => s.topic), ['weather']);
  assert.ok(logs.some((l) => l.includes('markets') && l.includes('omise')));
});

test('a dataset section with a partial index match is still published, with the misses logged', async () => {
  const logs = [];
  const edition = { id: 'main', title: 'B', sections: [
    { topic: 'markets', params: { indices: ['Nasdaq', 'Nasdaq Composite', 'SMI'] } },
  ] };
  const data = await composeEdition(edition, ctx(tmpRoot(), { log: (l) => logs.push(l) }));
  assert.equal(data.sections.length, 1);
  assert.deepEqual(data.sections[0].indices.map((i) => i.name), ['Nasdaq', 'SMI']);
  assert.ok(logs.some((l) => l.includes('Nasdaq Composite')));
});

test('a successful selection pass reports its usage via recordSelection', async () => {
  const root = tmpRoot();
  const resultJson = JSON.stringify({ total_cost_usd: 0.03, num_turns: 1, usage: { input_tokens: 300, output_tokens: 50 } });
  const runClaude = (prompt, outPath) => {
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ items: [card(1)] }));
    return { status: 0, stdout: resultJson };
  };
  const selections = [];
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  await composeEdition(edition, ctx(root, { runClaude, recordSelection: (e) => selections.push(e) }));
  assert.equal(selections.length, 1);
  assert.deepEqual(selections[0], {
    edition: 'main', topic: 'tech', ok: true,
    usage: { ...emptyUsage(), costUsd: 0.03, numTurns: 1, inputTokens: 300, outputTokens: 50 },
    durationMs: selections[0].durationMs,
  });
  assert.equal(typeof selections[0].durationMs, 'number');
});

// The same guarantee as the collect side: a selection pass that spent tokens
// and then failed (non-zero exit here) must still surface that spend even
// though the section degrades to the bucket's own ordering.
test('a failed (degraded) selection pass still reports the usage the run incurred', async () => {
  const resultJson = JSON.stringify({ total_cost_usd: 0.015, num_turns: 1 });
  const runClaude = () => ({ status: 1, stdout: resultJson, stderr: 'boom' });
  const selections = [];
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  const data = await composeEdition(edition, ctx(tmpRoot(), { runClaude, recordSelection: (e) => selections.push(e) }));
  assert.equal(data.sections[0].degraded, true);
  assert.equal(selections.length, 1);
  assert.equal(selections[0].ok, false);
  assert.equal(selections[0].usage.costUsd, 0.015);
});

test('composeEdition works without a recordSelection callback (optional, does not throw)', async () => {
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  const data = await composeEdition(edition, ctx(tmpRoot()));
  assert.equal(data.sections.length, 1);
});

// composeEdition calls are run concurrently across editions (Promise.all in
// generate.mjs), so a throwing recordSelection must be contained to the
// section it was called for — an unguarded callback would take down every
// other edition's compose along with it, defeating the per-section isolation
// this module maintains everywhere else.
test('a throwing recordSelection does not break composeEdition or drop the section', async () => {
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  const data = await composeEdition(edition, ctx(tmpRoot(), {
    recordSelection: () => { throw new Error('logging boom'); },
  }));
  assert.equal(data.sections.length, 1);
  assert.deepEqual(data.sections[0].items.map((i) => i.title), ['t3', 't1']);
  assert.ok(!data.sections[0].degraded);
});

test('a provider section is omitted when none of its cities match the bucket, other sections still publish', async () => {
  const logs = [];
  const edition = { id: 'main', title: 'B', sections: [
    { topic: 'weather', params: { cities: [{ name: 'Berne' }] } },
    { topic: 'tech', max: 2 },
  ] };
  const data = await composeEdition(edition, ctx(tmpRoot(), { log: (l) => logs.push(l) }));
  assert.deepEqual(data.sections.map((s) => s.topic), ['tech']);
  assert.ok(logs.some((l) => l.includes('weather') && l.includes('omise')));
});
