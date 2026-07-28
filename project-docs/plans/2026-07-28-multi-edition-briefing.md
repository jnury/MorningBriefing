# Multi-Edition Morning Briefing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalise the single-reader briefing into N configurable editions that share one per-topic research bucket each, published side by side under `docs/e/<id>/`.

**Architecture:** Four stages — plan (resolve which buckets are needed), collect (one Claude run or HTTP fetch per bucket, in parallel), compose (per-edition selection from the shared buckets), publish (render pages, archives, landing). Research stays non-deterministic and rendering stays pure; the two are separated by two validated JSON contracts (bucket, then edition). Sections become data-driven: topics are declared in `config/topics/*.json`, editions in `config/editions/*.json`, and adding a topic requires no code.

**Tech Stack:** Node 20+ ESM, zero runtime dependencies, `node --test` for tests, `claude -p` headless for research, Open-Meteo for weather, GitHub Pages for hosting.

**Spec:** `project-docs/specs/2026-07-28-multi-edition-briefing-design.md`

## Global Constraints

- **Zero runtime dependencies.** No npm packages. Hand-rolled validation, hand-rolled HTML. Node built-ins only (`node:fs`, `node:path`, `node:child_process`, global `fetch`).
- **ESM only.** `package.json` has `"type": "module"`; every file uses `import`/`export`.
- **All user-facing content is French.** Page copy, section labels, log messages, error messages. Code identifiers and comments stay English, matching the existing codebase.
- **Comments explain *why*, not *what*.** Match the existing density in `lib/*.mjs` — sparse, and only where a decision is non-obvious.
- **Pure renderers.** Everything in `lib/render.mjs` is `(data) -> string` with no side effects and no filesystem access, so it is testable without spending tokens.
- **Prompt assembly is a pure function** (config in → string out) so it is unit-testable without an LLM call.
- **No network in tests.** Every test runs offline. HTTP and `claude -p` calls are injected as parameters so tests pass fakes.
- **Freshness is enforced in code, not requested in prompts.** Per-topic `maxAgeDays`; violations fail validation.
- **One bucket per topic per day.** Bucket id is the topic id. Nothing an edition declares may split a bucket.
- **Escaping:** use `escapeHtml` for attributes and `escapeText` for text content, following the existing split in `lib/render.mjs`.
- **Commit after every task.** Do not push; the user pushes.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `config/house.md` | Collection rules inherited by every topic prompt (language, freshness, primary-source rule). |
| `config/topics/*.json` | Topic definitions: kind, shape, research instructions, sources, limits. |
| `config/editions/*.json` | Edition definitions: ordered sections with params, max, prefs, hints. |
| `lib/config.mjs` | Load and validate topics + editions; fail loudly on unknown topic ids. |
| `lib/plan.mjs` | Resolve editions into buckets: param unions, hint unions, derived sizes. |
| `lib/prompt.mjs` | Pure prompt assembly for collect and select. |
| `lib/schema.mjs` | Generic bucket and edition validation driven by topic config. |
| `lib/weather.mjs` | Open-Meteo fetch and WMO code → French condition. |
| `lib/collect.mjs` | Run collectors with a concurrency cap; isolate per-bucket failure. |
| `lib/compose.mjs` | Per-edition selection: deterministic paths, LLM editor path, degraded fallback. |
| `lib/render.mjs` | Pure renderers: section dispatch, both shapes, weather, markets, archive, landing. |
| `lib/site.mjs` | Write per-edition pages, per-edition archives, landing page. |
| `lib/clock.mjs` | Europe/Zurich date. **Unchanged.** |
| `generate.mjs` | Orchestrator and CLI. |
| `tools/migrate-legacy.mjs` | One-shot migration of the 40 legacy editions. Deleted after use. |

Files deleted by this plan: none of the libs — `lib/schema.mjs`, `lib/render.mjs`, `lib/site.mjs` are rewritten in place. `prompts/briefing.md` is replaced by `prompts/collect.md` + `prompts/select.md`.

---

### Task 1: Configuration loading

**Files:**
- Create: `config/house.md`
- Create: `config/topics/weather.json`, `config/topics/swiss.json`, `config/topics/world.json`, `config/topics/markets.json`, `config/topics/tech.json`
- Create: `config/editions/main.json`
- Create: `lib/config.mjs`
- Test: `test/config.test.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `loadConfig(root) -> { house: string, topics: Record<string, Topic>, editions: Edition[] }` — throws `Error` with a French message listing every problem if any config is invalid. `editions` sorted by `order` ascending, then `id`.
  - `Topic = { id, kind: 'provider'|'dataset'|'topic', label, shape?, categories?, bucketMin?, maxAgeDays?, summaryMaxWords?, research?, sources?, editorial? }`
  - `Edition = { id, title, order, sections: Section[] }`
  - `Section = { topic, max?, prefs?, hints?, params? }`

- [ ] **Step 1: Write the failing test**

Create `test/config.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.mjs';

// Builds a throwaway config tree so tests never depend on the real config/.
function tmpConfig({ topics = {}, editions = {}, house = 'règles' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mb-cfg-'));
  mkdirSync(join(root, 'config', 'topics'), { recursive: true });
  mkdirSync(join(root, 'config', 'editions'), { recursive: true });
  writeFileSync(join(root, 'config', 'house.md'), house);
  for (const [id, t] of Object.entries(topics)) {
    writeFileSync(join(root, 'config', 'topics', `${id}.json`), JSON.stringify(t));
  }
  for (const [id, e] of Object.entries(editions)) {
    writeFileSync(join(root, 'config', 'editions', `${id}.json`), JSON.stringify(e));
  }
  return root;
}

const TECH = {
  id: 'tech', kind: 'topic', label: 'Tech', shape: 'card',
  bucketMin: 30, maxAgeDays: 2, summaryMaxWords: 150,
  research: 'Actualités tech.', sources: ['ScienceDaily'],
};

test('loadConfig returns house text, topics keyed by id, and editions', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: { main: { id: 'main', title: 'Briefing', sections: [{ topic: 'tech', max: 20 }] } },
  });
  const cfg = loadConfig(root);
  assert.equal(cfg.house, 'règles');
  assert.equal(cfg.topics.tech.label, 'Tech');
  assert.equal(cfg.editions.length, 1);
  assert.equal(cfg.editions[0].id, 'main');
});

test('loadConfig sorts editions by order then id', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: {
      zed:  { id: 'zed',  title: 'Z', order: 1, sections: [{ topic: 'tech', max: 5 }] },
      main: { id: 'main', title: 'M', order: 1, sections: [{ topic: 'tech', max: 5 }] },
      last: { id: 'last', title: 'L', order: 9, sections: [{ topic: 'tech', max: 5 }] },
    },
  });
  assert.deepEqual(loadConfig(root).editions.map((e) => e.id), ['main', 'zed', 'last']);
});

test('loadConfig rejects a section referencing an unknown topic', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: { main: { id: 'main', title: 'M', sections: [{ topic: 'sport', max: 3 }] } },
  });
  assert.throws(() => loadConfig(root), /sport/);
});

test('loadConfig rejects a topic section without max', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: { main: { id: 'main', title: 'M', sections: [{ topic: 'tech' }] } },
  });
  assert.throws(() => loadConfig(root), /max/);
});

test('loadConfig rejects an edition whose id does not match its filename', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: { main: { id: 'autre', title: 'M', sections: [{ topic: 'tech', max: 5 }] } },
  });
  assert.throws(() => loadConfig(root), /autre/);
});

test('loadConfig rejects an unknown topic kind', () => {
  const root = tmpConfig({
    topics: { tech: { ...TECH, kind: 'bizarre' } },
    editions: { main: { id: 'main', title: 'M', sections: [{ topic: 'tech', max: 5 }] } },
  });
  assert.throws(() => loadConfig(root), /bizarre/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/config.test.mjs`
Expected: FAIL — `Cannot find module '../lib/config.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `lib/config.mjs`:

```javascript
// Loads and validates the topic + edition configuration. Every problem is
// collected before throwing, so a bad config reports all its errors at once
// instead of one per run.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = ['provider', 'dataset', 'topic'];
const SHAPES = ['headline', 'card'];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function readJsonDir(dir) {
  let files = [];
  try { files = readdirSync(dir); } catch { return []; }
  return files
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f.replace(/\.json$/, ''), data: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

function checkTopic(errors, name, t) {
  if (t.id !== name) errors.push(`topic ${name}: le champ id vaut « ${t.id} » et ne correspond pas au nom du fichier`);
  if (!KINDS.includes(t.kind)) errors.push(`topic ${name}: kind « ${t.kind} » inconnu (attendu: ${KINDS.join(', ')})`);
  if (!isStr(t.label)) errors.push(`topic ${name}: label manquant`);
  if (t.kind === 'topic') {
    if (!SHAPES.includes(t.shape)) errors.push(`topic ${name}: shape « ${t.shape} » inconnu (attendu: ${SHAPES.join(', ')})`);
    if (!isStr(t.research)) errors.push(`topic ${name}: research manquant`);
    if (!isNum(t.bucketMin)) errors.push(`topic ${name}: bucketMin doit être un nombre`);
    if (!isNum(t.maxAgeDays)) errors.push(`topic ${name}: maxAgeDays doit être un nombre`);
  }
  if (t.kind === 'dataset' && !isStr(t.research)) errors.push(`topic ${name}: research manquant`);
}

function checkEdition(errors, name, e, topics) {
  if (e.id !== name) errors.push(`édition ${name}: le champ id vaut « ${e.id} » et ne correspond pas au nom du fichier`);
  if (!isStr(e.title)) errors.push(`édition ${name}: title manquant`);
  if (!Array.isArray(e.sections) || e.sections.length === 0) {
    errors.push(`édition ${name}: sections doit contenir au moins une section`);
    return;
  }
  e.sections.forEach((s, i) => {
    const topic = topics[s.topic];
    if (!topic) {
      errors.push(`édition ${name}: sections[${i}] référence le topic inconnu « ${s.topic} »`);
      return;
    }
    if (topic.kind === 'topic' && !isNum(s.max)) {
      errors.push(`édition ${name}: sections[${i}] (${s.topic}) doit déclarer un max numérique`);
    }
    if (s.hints !== undefined && !Array.isArray(s.hints)) {
      errors.push(`édition ${name}: sections[${i}] (${s.topic}) hints doit être un tableau`);
    }
  });
}

export function loadConfig(root) {
  const errors = [];
  const dir = join(root, 'config');

  let house = '';
  try { house = readFileSync(join(dir, 'house.md'), 'utf8').trim(); }
  catch { errors.push('config/house.md introuvable'); }

  const topics = {};
  for (const { name, data } of readJsonDir(join(dir, 'topics'))) {
    checkTopic(errors, name, data);
    topics[name] = data;
  }
  if (Object.keys(topics).length === 0) errors.push('aucun topic dans config/topics/');

  const editions = [];
  for (const { name, data } of readJsonDir(join(dir, 'editions'))) {
    checkEdition(errors, name, data, topics);
    editions.push({ order: 100, ...data });
  }
  if (editions.length === 0) errors.push('aucune édition dans config/editions/');

  if (errors.length) throw new Error(`configuration invalide:\n - ${errors.join('\n - ')}`);

  editions.sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : 1));
  return { house, topics, editions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/config.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the real config files**

Create `config/house.md`:

```markdown
Règles communes à toutes les collectes du briefing matinal.

**Langue de sortie** : français, systématiquement, quelle que soit la langue des sources.

**Langue de recherche** : anglais pour la tech, la science et les marchés (c'est là que se trouvent
les sources primaires datées, les mieux indexées) ; français et sources suisses/francophones
(RTS, Le Temps, swissinfo, AFP) pour l'actualité générale.

**Récence — règle stricte et vérifiée** : chaque élément doit dater de la veille du {{DATE}}, et en
aucun cas de plus de {{MAX_AGE_DAYS}} jours. Le fichier sera REJETÉ automatiquement si un seul
élément est plus ancien.

**Méthode pour garantir la fraîcheur (impérative)** :

- Ne cite JAMAIS une page de récapitulatif (« Top Tech News Today », digests, listes du type
  « les X plus grosses histoires ») comme `url` finale : ces pages mélangent des nouvelles d'âges
  différents, dont des éléments vieux de plusieurs semaines. Elles peuvent servir de point de départ
  pour repérer des sujets, jamais de source citée.
- Pour CHAQUE élément retenu, remonte à la source primaire (annonce officielle, communiqué, article
  original, papier de recherche) et OUVRE-la avec WebFetch pour CONFIRMER sa date de publication.
  Privilégie les URL horodatées (ex. `/2026/07/27/`).
- Renseigne `publishedAt` (`YYYY-MM-DD`) avec la date de publication RÉELLE et vérifiée de la source.
  Si tu ne peux pas confirmer une date dans la fenêtre autorisée, ÉCARTE l'élément — n'invente jamais
  de date et ne la force pas.
- Mieux vaut moins d'éléments réellement frais qu'une longue liste contenant des nouvelles périmées.
- RATISSE LARGE : interroge plusieurs sources primaires variées et collecte nettement plus de
  candidats que demandé, car le filtre de récence en écartera une bonne partie.
```

Create `config/topics/weather.json`:

```json
{
  "id": "weather",
  "kind": "provider",
  "label": "Météo",
  "provider": "open-meteo"
}
```

Create `config/topics/swiss.json`:

```json
{
  "id": "swiss",
  "kind": "topic",
  "label": "La Suisse en bref",
  "shape": "headline",
  "bucketMin": 10,
  "maxAgeDays": 2,
  "research": "Actualités suisses importantes de la veille. Une phrase maximum par élément, classées par importance.",
  "sources": ["RTS", "Le Temps", "24 heures", "Tribune de Genève", "swissinfo", "Keystone-ATS"],
  "editorial": "Ne rapporte AUCUN fait divers (crimes, agressions, accidents, drames individuels, affaires judiciaires de personnes privées) — écarte-les même s'ils sont très commentés. Privilégie TOUJOURS les bonnes nouvelles et les sujets constructifs (avancées, accords, initiatives positives, culture, sport, économie, science, vie locale) ; à défaut, retiens des nouvelles d'intérêt général sérieuses, mais jamais des faits divers."
}
```

Create `config/topics/world.json`:

```json
{
  "id": "world",
  "kind": "topic",
  "label": "Le monde en bref",
  "shape": "headline",
  "bucketMin": 10,
  "maxAgeDays": 2,
  "research": "Actualités internationales les plus importantes de la veille. Une phrase maximum par élément, classées par importance.",
  "sources": ["AFP", "Reuters", "RTS", "Le Temps", "swissinfo"],
  "editorial": "Ne rapporte AUCUN fait divers (crimes, agressions, accidents, drames individuels, affaires judiciaires de personnes privées) — écarte-les même s'ils sont très commentés. Privilégie TOUJOURS les bonnes nouvelles et les sujets constructifs (avancées, accords, initiatives positives, culture, sport, économie, science) ; à défaut, retiens des nouvelles d'intérêt général sérieuses, mais jamais des faits divers."
}
```

Create `config/topics/markets.json`:

```json
{
  "id": "markets",
  "kind": "dataset",
  "label": "Marchés",
  "research": "Donne la variation en pourcentage par rapport à la séance précédente (la veille) pour chacun des indices demandés. Indique la date de référence dans `asOf` (ex. « clôture du 27 juillet 2026 »). Rédige UNE SEULE phrase de synthèse globale dans `summary`, et non une phrase par indice."
}
```

Create `config/topics/tech.json`:

```json
{
  "id": "tech",
  "kind": "topic",
  "label": "Tech · IT, Science & IA",
  "shape": "card",
  "categories": ["IT", "Science", "AI"],
  "bucketMin": 30,
  "maxAgeDays": 2,
  "summaryMaxWords": 150,
  "research": "Actualités pertinentes en informatique (IT), science et intelligence artificielle, publiées la veille. Pour chaque élément : une `category` parmi celles autorisées, un `title`, l'`url` de la source PRIMAIRE, un `publishedAt` vérifié et un `summary` en français.",
  "sources": [
    "archives datées d'éditeurs (ex. techcrunch.com/2026/MM/JJ/)",
    "blogs officiels des entreprises",
    "ScienceDaily",
    "bulletins de sécurité"
  ]
}
```

Create `config/editions/main.json` — reproduces today's briefing exactly:

```json
{
  "id": "main",
  "title": "Briefing du matin",
  "order": 1,
  "sections": [
    { "topic": "weather", "params": { "cities": [
        { "name": "Genève",   "lat": 46.20, "lon": 6.14 },
        { "name": "Lausanne", "lat": 46.52, "lon": 6.63 } ] } },
    { "topic": "swiss", "max": 3,
      "prefs": "Priorité à Genève et Lausanne, puis au reste de la Suisse romande et de la Confédération." },
    { "topic": "world", "max": 3 },
    { "topic": "markets", "params": { "indices": ["Nasdaq", "Dow Jones", "SMI", "Euro Stoxx 50"] } },
    { "topic": "tech", "max": 20,
      "prefs": "Équilibre entre IT, Science et IA, avec un léger penchant pour l'IA. Classe par importance.",
      "hints": ["IA", "modèles de langage", "cloud", "sécurité"] }
  ]
}
```

- [ ] **Step 6: Add a test that the real config loads**

Append to `test/config.test.mjs`:

```javascript
test('the real config/ tree loads without errors', () => {
  const root = new URL('..', import.meta.url).pathname;
  const cfg = loadConfig(process.platform === 'win32' ? root.slice(1) : root);
  assert.ok(cfg.topics.tech, 'topic tech attendu');
  assert.ok(cfg.editions.some((e) => e.id === 'main'), 'édition main attendue');
});
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: the new config tests PASS. Pre-existing tests still pass (nothing else changed yet).

- [ ] **Step 8: Commit**

```bash
git add config lib/config.mjs test/config.test.mjs
git commit -m "feat(config): topic and edition configuration with validation"
```

---

### Task 2: Bucket planning

**Files:**
- Create: `lib/plan.mjs`
- Test: `test/plan.test.mjs`

**Interfaces:**
- Consumes: `loadConfig(root) -> { house, topics, editions }` from Task 1.
- Produces:
  - `OVERCOLLECT = 2.5`
  - `planBuckets(config, { editionIds = null } = {}) -> Bucket[]`
  - `Bucket = { id, kind, size?, hints: string[], params: object, consumers: string[] }`, ordered by bucket id. `size` is present only for `kind === 'topic'`. `params.cities` (weather) and `params.indices` (markets) are unions, deduplicated by `name`, in first-seen edition order.

- [ ] **Step 1: Write the failing test**

Create `test/plan.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBuckets, OVERCOLLECT } from '../lib/plan.mjs';

const TOPICS = {
  weather: { id: 'weather', kind: 'provider', label: 'Météo' },
  markets: { id: 'markets', kind: 'dataset', label: 'Marchés' },
  tech:    { id: 'tech', kind: 'topic', label: 'Tech', shape: 'card', bucketMin: 30, maxAgeDays: 2 },
  world:   { id: 'world', kind: 'topic', label: 'Monde', shape: 'headline', bucketMin: 10, maxAgeDays: 2 },
};

const MAIN = {
  id: 'main', title: 'M', order: 1,
  sections: [
    { topic: 'weather', params: { cities: [{ name: 'Genève', lat: 46.2, lon: 6.14 }, { name: 'Lausanne', lat: 46.52, lon: 6.63 }] } },
    { topic: 'markets', params: { indices: ['Nasdaq', 'SMI'] } },
    { topic: 'tech', max: 20, hints: ['IA', 'cloud'] },
  ],
};

const CARLOS = {
  id: 'carlos', title: 'C', order: 2,
  sections: [
    { topic: 'weather', params: { cities: [{ name: 'Zurich', lat: 47.37, lon: 8.54 }, { name: 'Genève', lat: 46.2, lon: 6.14 }] } },
    { topic: 'world', max: 5 },
    { topic: 'tech', max: 10, hints: ['cybersécurité', 'IA'] },
  ],
};

const cfg = { house: 'h', topics: TOPICS, editions: [MAIN, CARLOS] };

test('one bucket per distinct topic, ordered by id', () => {
  assert.deepEqual(planBuckets(cfg).map((b) => b.id), ['markets', 'tech', 'weather', 'world']);
});

test('weather cities are unioned across editions, deduplicated by name', () => {
  const wx = planBuckets(cfg).find((b) => b.id === 'weather');
  assert.deepEqual(wx.params.cities.map((c) => c.name), ['Genève', 'Lausanne', 'Zurich']);
});

test('market indices are unioned across editions', () => {
  const m = planBuckets(cfg).find((b) => b.id === 'markets');
  assert.deepEqual(m.params.indices, ['Nasdaq', 'SMI']);
});

test('hints are unioned across editions, deduplicated, first-seen order', () => {
  const tech = planBuckets(cfg).find((b) => b.id === 'tech');
  assert.deepEqual(tech.hints, ['IA', 'cloud', 'cybersécurité']);
});

test('topic bucket size is the larger of bucketMin and largest max x OVERCOLLECT', () => {
  const byId = Object.fromEntries(planBuckets(cfg).map((b) => [b.id, b]));
  // tech: largest max is 20 -> ceil(20 * 2.5) = 50, above bucketMin 30
  assert.equal(byId.tech.size, Math.ceil(20 * OVERCOLLECT));
  // world: largest max is 5 -> ceil(5 * 2.5) = 13, below bucketMin 10? no: 13 > 10
  assert.equal(byId.world.size, 13);
});

test('bucketMin wins when demand is small', () => {
  const small = { ...cfg, editions: [{ id: 'x', title: 'X', order: 1, sections: [{ topic: 'tech', max: 2 }] }] };
  assert.equal(planBuckets(small).find((b) => b.id === 'tech').size, 30);
});

test('provider and dataset buckets have no size', () => {
  const byId = Object.fromEntries(planBuckets(cfg).map((b) => [b.id, b]));
  assert.equal(byId.weather.size, undefined);
  assert.equal(byId.markets.size, undefined);
});

test('consumers lists the editions using each bucket', () => {
  const byId = Object.fromEntries(planBuckets(cfg).map((b) => [b.id, b]));
  assert.deepEqual(byId.tech.consumers, ['main', 'carlos']);
  assert.deepEqual(byId.world.consumers, ['carlos']);
});

test('editionIds narrows planning to the requested editions only', () => {
  const ids = planBuckets(cfg, { editionIds: ['carlos'] }).map((b) => b.id);
  assert.deepEqual(ids, ['tech', 'weather', 'world']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/plan.test.mjs`
Expected: FAIL — `Cannot find module '../lib/plan.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `lib/plan.mjs`:

```javascript
// Resolves editions into the set of buckets that must be collected.
//
// There is exactly one bucket per topic per day: nothing an edition declares
// may split a bucket. Collection parameters (weather cities, market indices)
// and research hints are therefore UNIONED across every consuming edition, so
// a single research run serves every editorial cut of it.

// Over-collection factor for researched topics. The freshness filter discards a
// large fraction of candidates, so the bucket must be substantially wider than
// the largest edition's appetite.
export const OVERCOLLECT = 2.5;

function pushUnique(list, value, key) {
  if (!list.some((existing) => key(existing) === key(value))) list.push(value);
}

export function planBuckets(config, { editionIds = null } = {}) {
  const editions = editionIds
    ? config.editions.filter((e) => editionIds.includes(e.id))
    : config.editions;

  const buckets = new Map();

  for (const edition of editions) {
    for (const section of edition.sections) {
      const topic = config.topics[section.topic];
      let bucket = buckets.get(topic.id);
      if (!bucket) {
        bucket = { id: topic.id, kind: topic.kind, hints: [], params: {}, consumers: [] };
        if (topic.kind === 'topic') bucket.size = topic.bucketMin;
        buckets.set(topic.id, bucket);
      }

      bucket.consumers.push(edition.id);
      for (const hint of section.hints || []) pushUnique(bucket.hints, hint, (h) => h);

      for (const [name, value] of Object.entries(section.params || {})) {
        if (!Array.isArray(value)) { bucket.params[name] = value; continue; }
        bucket.params[name] = bucket.params[name] || [];
        // Objects union by their `name` field, plain strings by identity.
        const key = (v) => (v && typeof v === 'object' ? v.name : v);
        for (const entry of value) pushUnique(bucket.params[name], entry, key);
      }

      if (topic.kind === 'topic') {
        bucket.size = Math.max(bucket.size, Math.ceil(section.max * OVERCOLLECT));
      }
    }
  }

  return [...buckets.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/plan.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/plan.mjs test/plan.test.mjs
git commit -m "feat(plan): resolve editions into shared per-topic buckets"
```

---

### Task 3: Generic validation

**Files:**
- Rewrite: `lib/schema.mjs`
- Rewrite: `test/schema.test.mjs`
- Delete: `test/fixtures/sample.json` is replaced in Task 6; leave it alone for now.

**Interfaces:**
- Consumes: `Topic` from Task 1.
- Produces:
  - `countWords(s) -> number` (unchanged behaviour, still exported)
  - `validateBucket(bucket, topic, editionDate) -> { valid, errors }`
  - `validateEditionData(data, config) -> { valid, errors }`

The old `validateBriefing` and `MAX_NEWS_AGE_DAYS` exports are removed — freshness is now per-topic via `topic.maxAgeDays`.

- [ ] **Step 1: Write the failing test**

Replace the whole of `test/schema.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, validateBucket, validateEditionData } from '../lib/schema.mjs';

const TECH = {
  id: 'tech', kind: 'topic', label: 'Tech', shape: 'card',
  categories: ['IT', 'Science', 'AI'], bucketMin: 30, maxAgeDays: 2, summaryMaxWords: 150,
};
const WORLD = { id: 'world', kind: 'topic', label: 'Monde', shape: 'headline', bucketMin: 10, maxAgeDays: 2 };
const WEATHER = { id: 'weather', kind: 'provider', label: 'Météo' };
const MARKETS = { id: 'markets', kind: 'dataset', label: 'Marchés' };

const card = (over = {}) => ({
  category: 'AI', title: 'Titre', url: 'https://example.com/a',
  publishedAt: '2026-07-27', summary: 'Résumé court.', ...over,
});
const headline = (over = {}) => ({ headline: 'Une nouvelle', publishedAt: '2026-07-27', ...over });

const bucket = (over = {}) => ({
  bucketId: 'tech', date: '2026-07-28', collectedAt: '2026-07-28T05:02:00+02:00',
  shape: 'card', items: [card()], ...over,
});

test('countWords counts whitespace-separated words', () => {
  assert.equal(countWords('un deux trois'), 3);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords(null), 0);
});

test('a well-formed card bucket validates', () => {
  assert.deepEqual(validateBucket(bucket(), TECH, '2026-07-28'), { valid: true, errors: [] });
});

test('bucket rejects an item older than the topic maxAgeDays', () => {
  const r = validateBucket(bucket({ items: [card({ publishedAt: '2026-07-20' })] }), TECH, '2026-07-28');
  assert.equal(r.valid, false);
  assert.match(r.errors.join(' '), /trop ancien/);
});

test('bucket rejects a publishedAt in the future', () => {
  const r = validateBucket(bucket({ items: [card({ publishedAt: '2026-07-29' })] }), TECH, '2026-07-28');
  assert.match(r.errors.join(' '), /futur/);
});

test('bucket rejects a category outside the topic list', () => {
  const r = validateBucket(bucket({ items: [card({ category: 'Sport' })] }), TECH, '2026-07-28');
  assert.match(r.errors.join(' '), /category/);
});

test('bucket rejects a non-http url', () => {
  const r = validateBucket(bucket({ items: [card({ url: 'ftp://x' })] }), TECH, '2026-07-28');
  assert.match(r.errors.join(' '), /url/);
});

test('bucket rejects a summary over summaryMaxWords', () => {
  const long = Array.from({ length: 151 }, (_, i) => `m${i}`).join(' ');
  const r = validateBucket(bucket({ items: [card({ summary: long })] }), TECH, '2026-07-28');
  assert.match(r.errors.join(' '), /150 mots/);
});

test('bucket rejects an empty item list', () => {
  const r = validateBucket(bucket({ items: [] }), TECH, '2026-07-28');
  assert.equal(r.valid, false);
});

test('a headline bucket validates and requires headline text', () => {
  const ok = validateBucket({ bucketId: 'world', date: '2026-07-28', collectedAt: 'x', shape: 'headline', items: [headline()] }, WORLD, '2026-07-28');
  assert.equal(ok.valid, true);
  const bad = validateBucket({ bucketId: 'world', date: '2026-07-28', collectedAt: 'x', shape: 'headline', items: [{ publishedAt: '2026-07-27' }] }, WORLD, '2026-07-28');
  assert.match(bad.errors.join(' '), /headline/);
});

test('a markets dataset bucket validates asOf, summary and numeric changePct', () => {
  const good = { bucketId: 'markets', date: '2026-07-28', collectedAt: 'x', asOf: 'clôture du 27 juillet', summary: 'Séance calme.', indices: [{ name: 'SMI', changePct: 0.4 }] };
  assert.equal(validateBucket(good, MARKETS, '2026-07-28').valid, true);
  const bad = { ...good, indices: [{ name: 'SMI', changePct: '0.4' }] };
  assert.match(validateBucket(bad, MARKETS, '2026-07-28').errors.join(' '), /changePct/);
});

test('a weather provider bucket validates its cities', () => {
  const good = { bucketId: 'weather', date: '2026-07-28', collectedAt: 'x', cities: [{ name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10 }] };
  assert.equal(validateBucket(good, WEATHER, '2026-07-28').valid, true);
  const bad = { ...good, cities: [{ name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', precipProbability: 10 }] };
  assert.match(validateBucket(bad, WEATHER, '2026-07-28').errors.join(' '), /weathercode/);
});

const CONFIG = { topics: { tech: TECH, world: WORLD, weather: WEATHER, markets: MARKETS }, editions: [] };

const editionData = (over = {}) => ({
  edition: 'main', title: 'Briefing du matin', date: '2026-07-28',
  generatedAt: '2026-07-28T05:04:00+02:00',
  sections: [
    { topic: 'tech', label: 'Tech', kind: 'topic', shape: 'card', items: [card()] },
  ],
  ...over,
});

test('a well-formed edition validates', () => {
  assert.deepEqual(validateEditionData(editionData(), CONFIG), { valid: true, errors: [] });
});

test('edition rejects an unknown topic in a section', () => {
  const r = validateEditionData(editionData({ sections: [{ topic: 'sport', label: 'S', kind: 'topic', shape: 'card', items: [card()] }] }), CONFIG);
  assert.match(r.errors.join(' '), /sport/);
});

test('edition rejects a stale item, same rule as the bucket', () => {
  const r = validateEditionData(editionData({ sections: [{ topic: 'tech', label: 'Tech', kind: 'topic', shape: 'card', items: [card({ publishedAt: '2026-07-01' })] }] }), CONFIG);
  assert.match(r.errors.join(' '), /trop ancien/);
});

test('edition accepts an empty sections array — a fully failed run publishes nothing, not garbage', () => {
  const r = validateEditionData(editionData({ sections: [] }), CONFIG);
  assert.equal(r.valid, false);
  assert.match(r.errors.join(' '), /aucune section/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/schema.test.mjs`
Expected: FAIL — `validateBucket is not a function`.

- [ ] **Step 3: Write the implementation**

Replace the whole of `lib/schema.mjs`:

```javascript
// Hand-rolled validators for the two JSON contracts. Zero dependencies.
//
// Contract 1 (bucket): between collection and selection.
// Contract 2 (edition): between selection and rendering.
//
// Both are driven by the topic configuration rather than hard-coded field
// names, so adding a topic never requires touching this file.

export function countWords(s) {
  if (typeof s !== 'string') return 0;
  const t = s.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcDays(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

// Returns an error string if publishedAt is missing, malformed, in the future,
// or older than the topic's maxAgeDays relative to the edition date.
function checkFreshness(where, publishedAt, editionDate, maxAgeDays) {
  if (!DATE_RE.test(publishedAt || '')) return `${where}.publishedAt invalide (YYYY-MM-DD)`;
  if (!DATE_RE.test(editionDate || '')) return null;
  const age = Math.round(utcDays(editionDate) - utcDays(publishedAt));
  if (age < 0) return `${where}.publishedAt dans le futur (${publishedAt})`;
  if (age > maxAgeDays) {
    return `${where}.publishedAt trop ancien (${publishedAt}, > ${maxAgeDays} jours avant ${editionDate})`;
  }
  return null;
}

function checkItem(errors, where, item, topic, editionDate) {
  if (!item || typeof item !== 'object') { errors.push(`${where} invalide`); return; }

  if (topic.shape === 'headline') {
    if (!isStr(item.headline)) errors.push(`${where}.headline manquant`);
  } else {
    if (!isStr(item.title)) errors.push(`${where}.title manquant`);
    if (!/^https?:\/\//.test(item.url || '')) errors.push(`${where}.url invalide`);
    if (!isStr(item.summary)) errors.push(`${where}.summary manquant`);
    else if (topic.summaryMaxWords && countWords(item.summary) > topic.summaryMaxWords) {
      errors.push(`${where}.summary dépasse ${topic.summaryMaxWords} mots`);
    }
    if (topic.categories && !topic.categories.includes(item.category)) {
      errors.push(`${where}.category invalide (attendu: ${topic.categories.join(', ')})`);
    }
  }

  const stale = checkFreshness(where, item.publishedAt, editionDate, topic.maxAgeDays);
  if (stale) errors.push(stale);
}

function checkItems(errors, where, items, topic, editionDate) {
  if (!Array.isArray(items) || items.length === 0) {
    errors.push(`${where}.items doit contenir au moins un élément`);
    return;
  }
  items.forEach((item, i) => checkItem(errors, `${where}.items[${i}]`, item, topic, editionDate));
}

function checkCities(errors, where, cities) {
  if (!Array.isArray(cities) || cities.length === 0) {
    errors.push(`${where}.cities doit contenir au moins une ville`);
    return;
  }
  cities.forEach((c, i) => {
    const at = `${where}.cities[${i}]`;
    if (!isStr(c?.name)) errors.push(`${at}.name manquant`);
    if (!isNum(c?.high)) errors.push(`${at}.high doit être un nombre`);
    if (!isNum(c?.low)) errors.push(`${at}.low doit être un nombre`);
    if (!isStr(c?.condition)) errors.push(`${at}.condition manquant`);
    if (!isNum(c?.weathercode)) errors.push(`${at}.weathercode doit être un nombre`);
    if (!isNum(c?.precipProbability)) errors.push(`${at}.precipProbability doit être un nombre`);
  });
}

function checkMarkets(errors, where, m) {
  if (!isStr(m.asOf)) errors.push(`${where}.asOf manquant`);
  if (!isStr(m.summary)) errors.push(`${where}.summary manquant`);
  if (!Array.isArray(m.indices) || m.indices.length === 0) {
    errors.push(`${where}.indices doit contenir au moins un indice`);
    return;
  }
  m.indices.forEach((idx, i) => {
    if (!isStr(idx?.name)) errors.push(`${where}.indices[${i}].name manquant`);
    if (!isNum(idx?.changePct)) errors.push(`${where}.indices[${i}].changePct doit être un nombre`);
  });
}

// Validates one collected bucket against its topic definition.
export function validateBucket(bucket, topic, editionDate) {
  const errors = [];
  if (!bucket || typeof bucket !== 'object') return { valid: false, errors: ['bucket: objet attendu'] };
  const where = `bucket ${topic.id}`;

  if (bucket.bucketId !== topic.id) errors.push(`${where}.bucketId incorrect (« ${bucket.bucketId} »)`);
  if (!DATE_RE.test(bucket.date || '')) errors.push(`${where}.date invalide (YYYY-MM-DD)`);
  if (!isStr(bucket.collectedAt)) errors.push(`${where}.collectedAt manquant`);

  if (topic.kind === 'provider') checkCities(errors, where, bucket.cities);
  else if (topic.kind === 'dataset') checkMarkets(errors, where, bucket);
  else checkItems(errors, where, bucket.items, topic, editionDate);

  return { valid: errors.length === 0, errors };
}

// Validates a composed edition against the topic definitions it references.
export function validateEditionData(data, config) {
  const errors = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['édition: objet attendu'] };

  if (!isStr(data.edition)) errors.push('édition.edition manquant');
  if (!isStr(data.title)) errors.push('édition.title manquant');
  if (!DATE_RE.test(data.date || '')) errors.push('édition.date invalide (YYYY-MM-DD)');
  if (!isStr(data.generatedAt)) errors.push('édition.generatedAt manquant');

  if (!Array.isArray(data.sections) || data.sections.length === 0) {
    errors.push('édition: aucune section publiable');
    return { valid: false, errors };
  }

  data.sections.forEach((s, i) => {
    const where = `édition.sections[${i}]`;
    const topic = config.topics[s?.topic];
    if (!topic) { errors.push(`${where}: topic inconnu « ${s?.topic} »`); return; }
    if (!isStr(s.label)) errors.push(`${where}.label manquant`);
    if (s.kind !== topic.kind) errors.push(`${where}.kind incorrect (attendu ${topic.kind})`);

    if (topic.kind === 'provider') checkCities(errors, where, s.cities);
    else if (topic.kind === 'dataset') checkMarkets(errors, where, s);
    else checkItems(errors, where, s.items, topic, data.date);
  });

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/schema.test.mjs`
Expected: PASS, 16 tests.

- [ ] **Step 5: Note the expected breakage**

Run: `npm test`
Expected: `test/site.test.mjs`, `test/render-*.test.mjs` FAIL — they import `validateBriefing` indirectly through the old fixture shape. This is expected and is fixed in Tasks 5 and 6. Do not fix them here; do not delete them.

- [ ] **Step 6: Commit**

```bash
git add lib/schema.mjs test/schema.test.mjs
git commit -m "feat(schema): generic bucket and edition validation driven by topic config"
```

---

### Task 4: Prompt assembly

**Files:**
- Create: `prompts/collect.md`
- Create: `prompts/select.md`
- Delete: `prompts/briefing.md`
- Create: `lib/prompt.mjs`
- Test: `test/prompt.test.mjs`

**Interfaces:**
- Consumes: `Topic` (Task 1), `Bucket` (Task 2), `house` text (Task 1).
- Produces:
  - `buildCollectPrompt({ template, house, topic, bucket, date, outPath }) -> string`
  - `buildSelectPrompt({ template, topic, section, edition, bucketPath, date, outPath }) -> string`

Templates are passed in as strings rather than read from disk, keeping both functions pure and testable.

- [ ] **Step 1: Write the failing test**

Create `test/prompt.test.mjs`:

```javascript
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

test('select prompt handles a section without prefs', () => {
  const p = buildSelectPrompt({
    template: selectTpl, topic: TECH,
    section: { topic: 'tech', max: 5 },
    edition: { id: 'main', title: 'Briefing' },
    bucketPath: 'b.json', outPath: 'o.json', date: '2026-07-28',
  });
  assert.ok(!p.includes('{{'), 'aucun placeholder ne doit subsister');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/prompt.test.mjs`
Expected: FAIL — `Cannot find module '../lib/prompt.mjs'`.

- [ ] **Step 3: Write the templates**

Create `prompts/collect.md`:

```markdown
Tu es le documentaliste d'un briefing matinal personnel. Nous sommes le {{DATE}} (fuseau Europe/Zurich).

Ta mission : rassembler un VIVIER de candidats sur un seul sujet — « {{TOPIC_LABEL}} » — et écrire UN SEUL
fichier JSON valide à ce chemin exact : `{{OUTPUT_PATH}}`. N'écris rien d'autre, ne crée aucun autre fichier,
ne renvoie aucun texte hors du JSON écrit dans le fichier.

Ce vivier sera ensuite relu par plusieurs éditions du briefing, chacune y puisant selon ses propres goûts.
Ratisse donc plus large que ce qu'une seule édition consommerait, et classe les éléments par importance
décroissante.

{{HOUSE}}

## Sujet

{{RESEARCH}}

{{EDITORIAL}}

{{HINTS}}

Sources à privilégier : {{SOURCES}}

## Quantité

Vise {{SIZE}} éléments, classés du plus important au moins important. Ne descends jamais sous la moitié de
ce nombre sans avoir élargi ta recherche à d'autres sources.

## Format de sortie

Écris EXACTEMENT cette structure (les valeurs sont illustratives) :

{{OUTPUT_SHAPE}}

Contraintes STRICTES (le fichier sera rejeté sinon) :

- `bucketId` vaut exactement « {{TOPIC_ID}} » et `date` exactement « {{DATE}} ».
- `collectedAt` est un horodatage ISO 8601 avec fuseau.
- chaque `publishedAt` est au format `YYYY-MM-DD`, n'est pas dans le futur, et n'est jamais antérieur de
  plus de {{MAX_AGE_DAYS}} jours au {{DATE}}.
- le fichier est du JSON pur valide : pas de commentaires, pas de texte autour.

Écris le fichier avec l'outil Write à `{{OUTPUT_PATH}}`, puis arrête-toi.
```

Create `prompts/select.md`:

```markdown
Tu es le rédacteur en chef de l'édition « {{EDITION_TITLE}} » du briefing matinal du {{DATE}}.

Un vivier de candidats sur le sujet « {{TOPIC_LABEL}} » a déjà été rassemblé et vérifié. Il se trouve ici :
`{{BUCKET_PATH}}`. Lis-le avec l'outil Read.

Ta mission : CHOISIR et ORDONNER les éléments qui iront dans cette édition, puis écrire UN SEUL fichier JSON
valide à ce chemin exact : `{{OUTPUT_PATH}}`.

## Règles absolues

- Tu ne RÉÉCRIS RIEN. Reprends chaque élément retenu tel quel, champ pour champ, sans modifier une seule
  valeur — ni le titre, ni le résumé, ni l'URL, ni la date. Tu ne fais que sélectionner et ordonner.
- Tu n'INVENTES RIEN. N'ajoute aucun élément absent du vivier.
- Tu ne fais AUCUNE recherche. Aucune source externe, aucun outil web.
- Retiens AU PLUS {{MAX}} éléments. Moins est acceptable si le vivier n'offre pas mieux ; jamais plus.
- Classe du plus pertinent au moins pertinent POUR CETTE ÉDITION.

{{EDITORIAL}}

{{PREFS}}

## Format de sortie

Écris un objet JSON contenant uniquement les éléments retenus, copiés depuis le vivier :

{
  "items": [ ... ]
}

Le fichier doit être du JSON pur valide : pas de commentaires, pas de texte autour.

Écris le fichier avec l'outil Write à `{{OUTPUT_PATH}}`, puis arrête-toi.
```

- [ ] **Step 4: Write the implementation**

Create `lib/prompt.mjs`:

```javascript
// Pure prompt assembly: configuration in, prompt string out. Keeping this free
// of I/O is what lets every prompt-shaping decision be unit-tested without
// spending a token.

const CARD_SHAPE = `{
  "bucketId": "{{TOPIC_ID}}",
  "date": "{{DATE}}",
  "collectedAt": "{{DATE}}T05:02:00+02:00",
  "shape": "card",
  "items": [
    { "category": "AI", "title": "...", "url": "https://...", "publishedAt": "...", "summary": "..." }
  ]
}`;

const HEADLINE_SHAPE = `{
  "bucketId": "{{TOPIC_ID}}",
  "date": "{{DATE}}",
  "collectedAt": "{{DATE}}T05:02:00+02:00",
  "shape": "headline",
  "items": [
    { "headline": "...", "publishedAt": "..." }
  ]
}`;

const MARKETS_SHAPE = `{
  "bucketId": "{{TOPIC_ID}}",
  "date": "{{DATE}}",
  "collectedAt": "{{DATE}}T05:02:00+02:00",
  "asOf": "clôture du ...",
  "summary": "Une seule phrase de synthèse globale.",
  "indices": [
    { "name": "...", "changePct": 0 }
  ]
}`;

// Replaces every {{KEY}} occurrence, then collapses the blank lines left behind
// by blocks that resolved to an empty string.
function fill(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ''));
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function outputShape(topic) {
  if (topic.kind === 'dataset') return MARKETS_SHAPE;
  return topic.shape === 'headline' ? HEADLINE_SHAPE : CARD_SHAPE;
}

export function buildCollectPrompt({ template, house, topic, bucket, date, outPath }) {
  const hints = (bucket.hints || []).length
    ? `Centres d'intérêt déclarés par les éditions qui liront ce vivier — assure-toi que chacun soit ` +
      `représenté parmi les candidats : ${bucket.hints.join(', ')}.`
    : '';

  let research = topic.research;
  if (topic.kind === 'dataset' && Array.isArray(bucket.params?.indices)) {
    research += `\n\nIndices demandés, à fournir tous : ${bucket.params.indices.join(', ')}.`;
  }

  let shape = outputShape(topic);
  if (topic.categories) {
    shape += `\n\n`
      + `Valeurs autorisées pour \`category\` : ${topic.categories.join(', ')}.`;
  }
  if (topic.summaryMaxWords) {
    shape += `\nChaque \`summary\` fait au maximum ${topic.summaryMaxWords} mots, en français.`;
  }

  return fill(template, {
    DATE: date,
    HOUSE: fill(house, { DATE: date, MAX_AGE_DAYS: topic.maxAgeDays ?? 2 }),
    TOPIC_ID: topic.id,
    TOPIC_LABEL: topic.label,
    RESEARCH: research,
    EDITORIAL: topic.editorial ? `Ligne éditoriale, impérative : ${topic.editorial}` : '',
    HINTS: hints,
    SOURCES: (topic.sources || []).join(' · ') || 'sources primaires de ton choix',
    SIZE: bucket.size ?? '',
    MAX_AGE_DAYS: topic.maxAgeDays ?? 2,
    OUTPUT_SHAPE: shape,
    OUTPUT_PATH: outPath,
  });
}

export function buildSelectPrompt({ template, topic, section, edition, bucketPath, outPath, date }) {
  return fill(template, {
    DATE: date,
    EDITION_TITLE: edition.title,
    TOPIC_LABEL: topic.label,
    // The topic's editorial line is repeated at selection time so an edition's
    // own preferences can never quietly override it.
    EDITORIAL: topic.editorial ? `Ligne éditoriale, impérative et non négociable : ${topic.editorial}` : '',
    PREFS: section.prefs ? `Préférences de cette édition : ${section.prefs}` : '',
    MAX: section.max,
    BUCKET_PATH: bucketPath,
    OUTPUT_PATH: outPath,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/prompt.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 6: Delete the superseded prompt**

```bash
git rm prompts/briefing.md
```

- [ ] **Step 7: Commit**

```bash
git add prompts/collect.md prompts/select.md lib/prompt.mjs test/prompt.test.mjs
git commit -m "feat(prompt): parameterised collect and select prompt assembly"
```

---

### Task 5: Rendering

**Files:**
- Modify: `lib/render.mjs` (replace `renderWeather`, `renderSwiss`, `renderWorld`, `renderMarkets`, `renderTech`, `renderEdition`, `renderArchive`, `pageLayout`; add `renderLanding`)
- Rewrite: `test/render-edition.test.mjs`, `test/render-archive.test.mjs`
- Keep: `test/render-layout.test.mjs` (adjust only what breaks)
- Test: `test/render-landing.test.mjs`

**Interfaces:**
- Consumes: edition data shape from Task 3 (`validateEditionData`).
- Produces:
  - `pageLayout({ title, brand, bodyHtml, linkPrefix, homeHref }) -> string`
  - `renderEdition(data, { linkPrefix = '' }) -> string`
  - `renderArchive({ id, title, dates }, { linkPrefix = '' }) -> string`
  - `renderLanding(entries, { linkPrefix = '' }) -> string` where `entries = [{ id, title, latestDate }]`
  - `escapeHtml`, `PAGE_CSS` unchanged and still exported.

Weather rendering becomes N-city rather than the hard-coded Geneva/Lausanne pair, and market ordering comes from the section data rather than the `MARKET_ORDER` constant.

- [ ] **Step 1: Write the failing tests**

Replace `test/render-edition.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEdition } from '../lib/render.mjs';

const data = {
  edition: 'main', title: 'Briefing du matin', date: '2026-07-28',
  generatedAt: '2026-07-28T05:04:00+02:00',
  sections: [
    { topic: 'weather', label: 'Météo', kind: 'provider', cities: [
      { name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10 },
      { name: 'Zurich', high: 21, low: 12, condition: 'Couvert', weathercode: 3, precipProbability: 40 },
    ] },
    { topic: 'swiss', label: 'La Suisse en bref', kind: 'topic', shape: 'headline', items: [
      { headline: 'Le Grand Conseil adopte le budget', publishedAt: '2026-07-27' },
    ] },
    { topic: 'markets', label: 'Marchés', kind: 'dataset',
      asOf: 'clôture du 27 juillet 2026', summary: 'Séance calme.',
      indices: [{ name: 'Nasdaq', changePct: 0.42 }, { name: 'SMI', changePct: -0.15 }, { name: 'CAC 40', changePct: 0 }] },
    { topic: 'tech', label: 'Tech · IT, Science & IA', kind: 'topic', shape: 'card', items: [
      { category: 'AI', title: 'Un nouveau modèle', url: 'https://example.com/a', publishedAt: '2026-07-27', summary: 'Un résumé.' },
    ] },
  ],
};

test('renders the French date in the title and heading', () => {
  const html = renderEdition(data);
  assert.match(html, /<title>Briefing du matin — 28 juillet 2026<\/title>/);
  assert.match(html, /<h1>Briefing du 28 juillet 2026<\/h1>/);
});

test('renders every configured city, not a fixed pair', () => {
  const html = renderEdition(data);
  assert.match(html, /Genève/);
  assert.match(html, /Zurich/);
  assert.ok(!html.includes('Lausanne'), 'aucune ville non configurée ne doit apparaître');
});

test('renders section labels from the data', () => {
  const html = renderEdition(data);
  assert.match(html, /<h2>La Suisse en bref<\/h2>/);
  assert.match(html, /Tech · IT, Science &amp; IA/);
});

test('renders sections in the order given by the data', () => {
  const html = renderEdition(data);
  assert.ok(html.indexOf('Météo') < html.indexOf('La Suisse en bref'));
  assert.ok(html.indexOf('La Suisse en bref') < html.indexOf('Marchés'));
});

test('renders market indices in data order with signed, coloured percentages', () => {
  const html = renderEdition(data);
  assert.ok(html.indexOf('Nasdaq') < html.indexOf('SMI'));
  assert.match(html, /class="up">\+0\.42 %/);
  assert.match(html, /class="down">-0\.15 %/);
  assert.match(html, /class="">0\.00 %/);
});

test('renders card items with a category badge and an external link', () => {
  const html = renderEdition(data);
  assert.match(html, /class="badge badge-ai">AI</);
  assert.match(html, /href="https:\/\/example\.com\/a" target="_blank" rel="noopener"/);
});

test('omits a section entirely when it is absent from the data', () => {
  const html = renderEdition({ ...data, sections: data.sections.filter((s) => s.topic !== 'markets') });
  assert.ok(!html.includes('Marchés'), 'une section absente ne doit rien rendre');
});

test('renders a discreet note for a degraded section', () => {
  const degraded = { ...data, sections: data.sections.map((s) => (s.topic === 'tech' ? { ...s, degraded: true } : s)) };
  assert.match(renderEdition(degraded), /sélection automatique/i);
});

test('escapes HTML in headlines and titles', () => {
  const evil = { ...data, sections: [{ topic: 'swiss', label: 'Suisse', kind: 'topic', shape: 'headline',
    items: [{ headline: 'Alerte <script>alert(1)</script>', publishedAt: '2026-07-27' }] }] };
  const html = renderEdition(evil);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('nav links use the given prefix for depth-1 pages', () => {
  assert.match(renderEdition(data, { linkPrefix: '../' }), /href="\.\.\/archive\.html"/);
});

test('links back to the landing page', () => {
  assert.match(renderEdition(data, { linkPrefix: '../' }), /href="\.\.\/\.\.\/index\.html"/);
});
```

Replace `test/render-archive.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArchive } from '../lib/render.mjs';

const edition = { id: 'main', title: 'Briefing du matin', dates: ['2026-07-26', '2026-07-28', '2026-07-27'] };

test('lists every date, newest first, in French', () => {
  const html = renderArchive(edition);
  assert.ok(html.indexOf('28 juillet 2026') < html.indexOf('27 juillet 2026'));
  assert.ok(html.indexOf('27 juillet 2026') < html.indexOf('26 juillet 2026'));
});

test('links to the dated page inside the same edition directory', () => {
  assert.match(renderArchive(edition), /href="2026-07-28\.html"/);
});

test('carries the edition title', () => {
  assert.match(renderArchive(edition), /Briefing du matin/);
});

test('renders an empty archive without crashing', () => {
  assert.match(renderArchive({ ...edition, dates: [] }), /<h1>Archives<\/h1>/);
});
```

Create `test/render-landing.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLanding } from '../lib/render.mjs';

const entries = [
  { id: 'main', title: 'Briefing du matin', latestDate: '2026-07-28' },
  { id: 'carlos', title: 'Briefing de Carlos', latestDate: '2026-07-27' },
];

test('renders one card per edition, in the given order', () => {
  const html = renderLanding(entries);
  assert.ok(html.indexOf('Briefing du matin') < html.indexOf('Briefing de Carlos'));
});

test('links to each edition home page and archive', () => {
  const html = renderLanding(entries);
  assert.match(html, /href="e\/main\/index\.html"/);
  assert.match(html, /href="e\/carlos\/archive\.html"/);
});

test('shows the latest date of each edition in French', () => {
  const html = renderLanding(entries);
  assert.match(html, /28 juillet 2026/);
  assert.match(html, /27 juillet 2026/);
});

test('an edition with no published date is shown without a link to today', () => {
  const html = renderLanding([{ id: 'neuf', title: 'Nouveau', latestDate: null }]);
  assert.match(html, /Nouveau/);
  assert.ok(!html.includes('href="e/neuf/index.html"'), 'pas de lien vers une édition jamais publiée');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/render-edition.test.mjs test/render-archive.test.mjs test/render-landing.test.mjs`
Expected: FAIL — `renderLanding is not a function`, and the edition tests fail on the old data shape.

- [ ] **Step 3: Rewrite the render functions**

In `lib/render.mjs`, **keep** `escapeHtml`, `PAGE_CSS`, the theme JS/HTML constants, `escapeText`, `formatPct`, `WX_ICONS`, `weatherKey`, `weatherIcon`, `BADGE_CLASS`, `FR_MONTHS`, `frenchDate`. **Delete** `CITY_LABELS`, `MARKET_ORDER`, `renderSwiss`, `renderWorld`, `renderTech`. **Replace** the rest as follows.

Add to `PAGE_CSS`, just before the closing backtick (after the `.archive a` rule):

```css
.degraded{color:var(--muted);font-size:14px;font-style:italic;margin:4px 0 0}
.editions{display:grid;gap:14px;padding:0;margin:18px 0}
.editions li{list-style:none;border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.editions h3{margin:0 0 4px}
.editions .meta{color:var(--muted);font-size:14px}
.editions a{color:var(--accent);text-decoration:none}
.editions a:hover{text-decoration:underline}
```

Replace `pageLayout`:

```javascript
export function pageLayout({ title, brand, bodyHtml, linkPrefix = '', homeHref = null }) {
  // homeHref points back to the landing page; edition pages set it, the landing
  // page itself does not (it would link to itself).
  const home = homeHref ? `<a href="${homeHref}">Éditions</a>` : '';
  const nav = homeHref
    ? `${home}<a href="${linkPrefix}index.html">Aujourd'hui</a><a href="${linkPrefix}archive.html">Archives</a>`
    : '';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<script>${THEME_INIT_JS}</script>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
<header class="site">
<span class="brand">${escapeHtml(brand)}</span>
<nav>${nav}${THEME_TOGGLE_HTML}</nav>
</header>
${bodyHtml}
<footer class="site">Généré automatiquement &middot; Julien Nury</footer>
</div>
</body>
</html>`;
}
```

Replace `renderWeather` and `renderMarkets`, and add the shape renderers plus the dispatcher:

```javascript
function renderWeather(section) {
  const city = (c) => `<div class="city">
<div class="name">${escapeText(c.name)}</div>
<div class="wx-row">${weatherIcon(c.weathercode)}<span class="t">${Math.round(c.high)}° / ${Math.round(c.low)}°</span></div>
<div class="c">${escapeHtml(c.condition)} &middot; ${Math.round(c.precipProbability)} % de précip.</div>
</div>`;
  return `<div class="weather">${section.cities.map(city).join('')}</div>`;
}

function renderMarkets(section) {
  // Order comes from the data, which the composer already put in the edition's
  // configured order — no global index ordering here.
  const cells = section.indices.map((idx) => {
    const p = formatPct(idx.changePct);
    return `<span class="idx"><span class="idx-name">${escapeHtml(idx.name)}</span> <span class="${p.cls}">${p.text}</span></span>`;
  }).join('\n');
  return `<div class="markets">${cells}</div>
<p class="lead">${escapeHtml(section.summary)}</p>`;
}

function renderHeadlines(section) {
  const items = section.items.map((n) => `<li>${escapeText(n.headline)}</li>`).join('\n');
  return `<ul class="world">\n${items}\n</ul>`;
}

function renderCards(section) {
  return section.items.map((t) => {
    const badge = t.category
      ? `<span class="badge ${BADGE_CLASS[t.category] || ''}">${escapeHtml(t.category)}</span> `
      : '';
    return `<article>
<h3>${badge}<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a></h3>
<p>${escapeHtml(t.summary)}</p>
</article>`;
  }).join('\n');
}

const DEGRADED_NOTE = '<p class="degraded">Sélection automatique de secours : le tri éditorial n\'a pas abouti ce matin.</p>';

// Dispatch on kind, then on shape for researched topics.
export function renderSection(section) {
  let body;
  if (section.kind === 'provider') body = renderWeather(section);
  else if (section.kind === 'dataset') body = renderMarkets(section);
  else body = section.shape === 'headline' ? renderHeadlines(section) : renderCards(section);

  const heading = section.kind === 'dataset' && section.asOf
    ? `${escapeText(section.label)} &middot; ${escapeText(section.asOf)}`
    : escapeText(section.label);

  return `<h2>${heading}</h2>\n${section.degraded ? `${DEGRADED_NOTE}\n` : ''}${body}`;
}
```

Replace `renderEdition` and `renderArchive`, and add `renderLanding`:

```javascript
export function renderEdition(data, { linkPrefix = '' } = {}) {
  const body = `<h1>Briefing du ${frenchDate(data.date)}</h1>
${data.sections.map(renderSection).join('\n')}`;
  return pageLayout({
    title: `${data.title} — ${frenchDate(data.date)}`,
    brand: data.title,
    bodyHtml: body,
    linkPrefix,
    // Edition pages live at docs/e/<id>/, so the landing page is two levels up
    // from a dated page and one level up from the edition home page.
    homeHref: `${linkPrefix}../index.html`,
  });
}

export function renderArchive({ title, dates }, { linkPrefix = '' } = {}) {
  const sorted = [...dates].sort((a, b) => (a < b ? 1 : -1));
  const items = sorted.map((d) => `<li><a href="${linkPrefix}${d}.html">${frenchDate(d)}</a></li>`).join('\n');
  const body = `<h1>Archives</h1>
<p class="lead">Toutes les éditions précédentes de « ${escapeText(title)} », de la plus récente à la plus ancienne.</p>
<div class="archive"><ul>\n${items}\n</ul></div>`;
  return pageLayout({
    title: `Archives — ${title}`,
    brand: title,
    bodyHtml: body,
    linkPrefix,
    homeHref: `${linkPrefix}../index.html`,
  });
}

export function renderLanding(entries, { linkPrefix = '' } = {}) {
  const card = (e) => {
    const meta = e.latestDate
      ? `<p class="meta">Dernière édition : ${frenchDate(e.latestDate)}</p>
<p><a href="${linkPrefix}e/${e.id}/index.html">Lire</a> &middot; <a href="${linkPrefix}e/${e.id}/archive.html">Archives</a></p>`
      : '<p class="meta">Aucune édition publiée pour l\'instant.</p>';
    return `<li><h3>${escapeText(e.title)}</h3>${meta}</li>`;
  };
  const body = `<h1>Éditions</h1>
<p class="lead">Chaque édition a sa propre sélection de nouvelles.</p>
<ul class="editions">\n${entries.map(card).join('\n')}\n</ul>`;
  return pageLayout({ title: 'Briefing du matin — éditions', brand: 'Briefing du matin', bodyHtml: body, linkPrefix });
}
```

- [ ] **Step 4: Fix `test/render-layout.test.mjs`**

Run: `npm test -- test/render-layout.test.mjs`

It tests `pageLayout` and the theme toggle. Update every `pageLayout(...)` call in it to pass `brand` and, where nav links are asserted, `homeHref`. Do not change what it asserts about the theme toggle, the CSS variables or the `lang="fr"` attribute — those behaviours are unchanged.

- [ ] **Step 5: Run the render tests**

Run: `npm test -- test/render-edition.test.mjs test/render-archive.test.mjs test/render-landing.test.mjs test/render-layout.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/render.mjs test/render-edition.test.mjs test/render-archive.test.mjs test/render-landing.test.mjs test/render-layout.test.mjs
git commit -m "feat(render): data-driven sections, N-city weather, landing page"
```

---

### Task 6: Site writing

**Files:**
- Rewrite: `lib/site.mjs`
- Rewrite: `test/site.test.mjs`
- Replace: `test/fixtures/sample.json` with the new edition shape

**Interfaces:**
- Consumes: `renderEdition`, `renderArchive`, `renderLanding` (Task 5).
- Produces:
  - `writeEditionPages(root, data) -> void` — writes `docs/e/<id>/index.html`, `docs/e/<id>/<date>.html`, `docs/e/<id>/data/<date>.json`
  - `listEditionDates(root, id) -> string[]` — newest first
  - `listPublishedEditionIds(root) -> string[]`
  - `rebuildEditionArchive(root, { id, title }) -> void`
  - `rebuildLanding(root, editions) -> void` where `editions = [{ id, title }]`

- [ ] **Step 1: Write the failing test**

Replace `test/fixtures/sample.json`:

```json
{
  "edition": "main",
  "title": "Briefing du matin",
  "date": "2026-07-28",
  "generatedAt": "2026-07-28T05:04:00+02:00",
  "sections": [
    { "topic": "weather", "label": "Météo", "kind": "provider", "cities": [
      { "name": "Genève", "high": 24, "low": 13, "condition": "Ensoleillé", "weathercode": 0, "precipProbability": 10 }
    ] },
    { "topic": "swiss", "label": "La Suisse en bref", "kind": "topic", "shape": "headline", "items": [
      { "headline": "Le Grand Conseil adopte le budget", "publishedAt": "2026-07-27" }
    ] },
    { "topic": "tech", "label": "Tech · IT, Science & IA", "kind": "topic", "shape": "card", "items": [
      { "category": "AI", "title": "Un nouveau modèle", "url": "https://example.com/a", "publishedAt": "2026-07-27", "summary": "Un résumé." }
    ] }
  ]
}
```

Replace `test/site.test.mjs`:

```javascript
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
  assert.match(index, /href="\.\.\/index\.html"/);   // back to the landing page
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/site.test.mjs`
Expected: FAIL — `writeEditionPages is not a function`.

- [ ] **Step 3: Write the implementation**

Replace the whole of `lib/site.mjs`:

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/site.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/site.mjs test/site.test.mjs test/fixtures/sample.json
git commit -m "feat(site): per-edition pages, archives and landing page"
```

---

### Task 7: Collection

**Files:**
- Create: `lib/weather.mjs`
- Create: `lib/collect.mjs`
- Test: `test/weather.test.mjs`, `test/collect.test.mjs`
- Modify: `.gitignore` (add `buckets/`)

**Interfaces:**
- Consumes: `Bucket` (Task 2), `buildCollectPrompt` (Task 4), `validateBucket` (Task 3).
- Produces:
  - `wmoCondition(code) -> string` — French label for a WMO weather code
  - `fetchWeatherBucket(bucket, date, { fetchImpl = fetch }) -> Promise<BucketData>`
  - `collectAll(buckets, ctx) -> Promise<Map<string, { ok: boolean, data?, error? }>>` where
    `ctx = { root, date, house, topics, template, concurrency = 4, runClaude, fetchImpl, now }`
  - `runClaudeCollect(prompt, outPath, root) -> object` — default `runClaude`, spawns `claude -p`

`runClaude` and `fetchImpl` are injected so tests never touch the network or spawn a process.

- [ ] **Step 1: Write the failing weather test**

Create `test/weather.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wmoCondition, fetchWeatherBucket } from '../lib/weather.mjs';

test('wmoCondition maps known codes to French labels', () => {
  assert.equal(wmoCondition(0), 'Ensoleillé');
  assert.equal(wmoCondition(2), 'Partiellement nuageux');
  assert.equal(wmoCondition(3), 'Couvert');
  assert.equal(wmoCondition(45), 'Brouillard');
  assert.equal(wmoCondition(61), 'Pluie faible');
  assert.equal(wmoCondition(95), 'Orage');
});

test('wmoCondition falls back rather than throwing on an unknown code', () => {
  assert.equal(typeof wmoCondition(999), 'string');
  assert.ok(wmoCondition(999).length > 0);
});

const daily = (over = {}) => ({
  daily: {
    temperature_2m_max: [24.4], temperature_2m_min: [13.2],
    precipitation_probability_max: [10], weathercode: [0], ...over,
  },
});

test('fetchWeatherBucket builds one city entry per requested city', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => daily() }; };
  const bucket = { id: 'weather', kind: 'provider', params: { cities: [
    { name: 'Genève', lat: 46.2, lon: 6.14 }, { name: 'Zurich', lat: 47.37, lon: 8.54 },
  ] } };

  const data = await fetchWeatherBucket(bucket, '2026-07-28', { fetchImpl, now: () => '2026-07-28T05:00:00+02:00' });

  assert.equal(calls.length, 2);
  assert.match(calls[0], /latitude=46\.2/);
  assert.match(calls[1], /longitude=8\.54/);
  assert.equal(data.bucketId, 'weather');
  assert.equal(data.date, '2026-07-28');
  assert.deepEqual(data.cities.map((c) => c.name), ['Genève', 'Zurich']);
  assert.deepEqual(data.cities[0], {
    name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10,
  });
});

test('fetchWeatherBucket rejects when a city request fails', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  const bucket = { id: 'weather', kind: 'provider', params: { cities: [{ name: 'Genève', lat: 46.2, lon: 6.14 }] } };
  await assert.rejects(() => fetchWeatherBucket(bucket, '2026-07-28', { fetchImpl }), /503/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/weather.test.mjs`
Expected: FAIL — `Cannot find module '../lib/weather.mjs'`.

- [ ] **Step 3: Write `lib/weather.mjs`**

```javascript
// Open-Meteo provider. Deterministic, keyless, and fetched directly rather than
// via the model — the numbers are facts, not editorial judgement.

const CONDITIONS = [
  [[0], 'Ensoleillé'],
  [[1], 'Plutôt ensoleillé'],
  [[2], 'Partiellement nuageux'],
  [[3], 'Couvert'],
  [[45, 48], 'Brouillard'],
  [[51, 53, 55], 'Bruine'],
  [[56, 57], 'Bruine verglaçante'],
  [[61], 'Pluie faible'],
  [[63], 'Pluie'],
  [[65], 'Pluie forte'],
  [[66, 67], 'Pluie verglaçante'],
  [[71, 73, 75, 77], 'Neige'],
  [[80, 81, 82], 'Averses'],
  [[85, 86], 'Averses de neige'],
  [[95, 96, 99], 'Orage'],
];

export function wmoCondition(code) {
  for (const [codes, label] of CONDITIONS) if (codes.includes(code)) return label;
  return 'Variable';
}

function forecastUrl({ lat, lon }) {
  return 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode'
    + '&timezone=Europe%2FZurich&forecast_days=1';
}

export async function fetchWeatherBucket(bucket, date, { fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  const cities = [];
  for (const city of bucket.params.cities) {
    const res = await fetchImpl(forecastUrl(city));
    if (!res.ok) throw new Error(`Open-Meteo ${city.name}: HTTP ${res.status}`);
    const { daily } = await res.json();
    const code = daily.weathercode[0];
    cities.push({
      name: city.name,
      high: Math.round(daily.temperature_2m_max[0]),
      low: Math.round(daily.temperature_2m_min[0]),
      condition: wmoCondition(code),
      weathercode: code,
      precipProbability: Math.round(daily.precipitation_probability_max[0]),
    });
  }
  return { bucketId: bucket.id, date, collectedAt: now(), cities };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/weather.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing collect test**

Create `test/collect.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAll } from '../lib/collect.mjs';

const TOPICS = {
  weather: { id: 'weather', kind: 'provider', label: 'Météo' },
  tech: { id: 'tech', kind: 'topic', label: 'Tech', shape: 'card', categories: ['AI'], bucketMin: 30, maxAgeDays: 2, summaryMaxWords: 150, research: 'r', sources: ['s'] },
  world: { id: 'world', kind: 'topic', label: 'Monde', shape: 'headline', bucketMin: 10, maxAgeDays: 2, research: 'r', sources: ['s'] },
};

const DATE = '2026-07-28';
const item = () => ({ category: 'AI', title: 't', url: 'https://e.com/a', publishedAt: '2026-07-27', summary: 's' });

function ctx(root, runClaude, over = {}) {
  return {
    root, date: DATE, house: 'H', topics: TOPICS,
    template: 'PROMPT {{OUTPUT_PATH}} {{DATE}}',
    concurrency: 2, runClaude,
    fetchImpl: async () => ({ ok: true, json: async () => ({ daily: {
      temperature_2m_max: [24], temperature_2m_min: [13],
      precipitation_probability_max: [10], weathercode: [0] } }) }),
    now: () => '2026-07-28T05:00:00+02:00',
    ...over,
  };
}

const tmpRoot = () => mkdtempSync(join(tmpdir(), 'mb-col-'));

// A fake collector that writes the bucket file the real Claude run would write.
function writingRunner(payloadFor) {
  return (prompt, outPath) => {
    const payload = payloadFor(outPath);
    if (payload === null) return { status: 1, stderr: 'échec simulé' };
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify(payload));
    return { status: 0, stderr: '' };
  };
}

test('collects a provider bucket without calling the model', async () => {
  const root = tmpRoot();
  let claudeCalls = 0;
  const buckets = [{ id: 'weather', kind: 'provider', hints: [], params: { cities: [{ name: 'Genève', lat: 46.2, lon: 6.14 }] }, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, () => { claudeCalls++; return { status: 0 }; }));
  assert.equal(claudeCalls, 0);
  assert.equal(results.get('weather').ok, true);
  assert.equal(results.get('weather').data.cities[0].name, 'Genève');
});

test('collects a researched bucket and validates it', async () => {
  const root = tmpRoot();
  const run = writingRunner(() => ({
    bucketId: 'tech', date: DATE, collectedAt: 'x', shape: 'card', items: [item()],
  }));
  const buckets = [{ id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, run));
  assert.equal(results.get('tech').ok, true);
  assert.equal(results.get('tech').data.items.length, 1);
});

test('marks a bucket failed when the run exits non-zero', async () => {
  const root = tmpRoot();
  const buckets = [{ id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, writingRunner(() => null)));
  assert.equal(results.get('tech').ok, false);
  assert.match(results.get('tech').error, /échec|code/i);
});

test('marks a bucket failed when the written file is invalid', async () => {
  const root = tmpRoot();
  const run = writingRunner(() => ({
    bucketId: 'tech', date: DATE, collectedAt: 'x', shape: 'card',
    items: [{ ...item(), publishedAt: '2026-01-01' }],   // stale
  }));
  const buckets = [{ id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] }];
  const results = await collectAll(buckets, ctx(root, run));
  assert.equal(results.get('tech').ok, false);
  assert.match(results.get('tech').error, /trop ancien/);
});

test('one failing bucket does not prevent the others from succeeding', async () => {
  const root = tmpRoot();
  const run = writingRunner((outPath) => (outPath.includes('tech') ? null : {
    bucketId: 'world', date: DATE, collectedAt: 'x', shape: 'headline',
    items: [{ headline: 'h', publishedAt: '2026-07-27' }],
  }));
  const buckets = [
    { id: 'tech', kind: 'topic', size: 50, hints: [], params: {}, consumers: ['main'] },
    { id: 'world', kind: 'topic', size: 10, hints: [], params: {}, consumers: ['main'] },
  ];
  const results = await collectAll(buckets, ctx(root, run));
  assert.equal(results.get('tech').ok, false);
  assert.equal(results.get('world').ok, true);
});

test('never runs more collectors at once than the concurrency cap', async () => {
  const root = tmpRoot();
  // Distinct bucket ids: identical ids would collapse into one results entry.
  const topics = { ...TOPICS };
  const buckets = [];
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    topics[id] = { ...TOPICS.world, id };
    buckets.push({ id, kind: 'topic', size: 10, hints: [], params: {}, consumers: ['main'] });
  }

  let running = 0, peak = 0;
  const run = async (prompt, outPath) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    const id = outPath.match(/([a-e])\.json$/)[1];
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify({
      bucketId: id, date: DATE, collectedAt: 'x', shape: 'headline',
      items: [{ headline: 'h', publishedAt: '2026-07-27' }],
    }));
    return { status: 0 };
  };

  const results = await collectAll(buckets, ctx(root, run, { concurrency: 2, topics }));
  assert.equal(results.size, 5);
  assert.ok([...results.values()].every((r) => r.ok));
  assert.ok(peak <= 2, `pic de concurrence ${peak} > 2`);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- test/collect.test.mjs`
Expected: FAIL — `Cannot find module '../lib/collect.mjs'`.

- [ ] **Step 7: Write `lib/collect.mjs`**

```javascript
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCollectPrompt } from './prompt.mjs';
import { validateBucket } from './schema.mjs';
import { fetchWeatherBucket } from './weather.mjs';

export const bucketPath = (root, date, id) => join(root, 'buckets', date, `${id}.json`);

// Scope the headless run to exactly the tools a collector needs. In -p mode a
// non-allowlisted tool is denied rather than prompted, so the run stays
// unattended without granting blanket permissions.
export function runClaudeCollect(prompt, outPath, root) {
  return spawnSync(
    'claude -p --model opus --allowedTools "WebSearch,WebFetch,Write" --output-format json',
    { input: prompt, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024, cwd: root },
  );
}

async function collectOne(bucket, ctx) {
  const topic = ctx.topics[bucket.id];
  const outPath = bucketPath(ctx.root, ctx.date, bucket.id);
  mkdirSync(dirname(outPath), { recursive: true });

  let data;
  if (topic.kind === 'provider') {
    data = await fetchWeatherBucket(bucket, ctx.date, { fetchImpl: ctx.fetchImpl, now: ctx.now });
  } else {
    const prompt = buildCollectPrompt({
      template: ctx.template, house: ctx.house, topic, bucket, date: ctx.date, outPath,
    });
    const res = await ctx.runClaude(prompt, outPath, ctx.root);
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`claude a échoué (code ${res.status}) : ${(res.stderr || '').slice(0, 500)}`);
    if (!existsSync(outPath)) throw new Error(`fichier de vivier absent : ${outPath}`);
    data = JSON.parse(readFileSync(outPath, 'utf8'));
  }

  const { valid, errors } = validateBucket(data, topic, ctx.date);
  if (!valid) throw new Error(`vivier invalide :\n - ${errors.join('\n - ')}`);
  return data;
}

// Runs every collector with a concurrency cap. A bucket that fails is recorded
// as failed and never throws out of here: the morning must publish whatever
// else succeeded.
export async function collectAll(buckets, ctx) {
  const results = new Map();
  const queue = [...buckets];
  const limit = Math.max(1, ctx.concurrency ?? 4);

  const worker = async () => {
    while (queue.length) {
      const bucket = queue.shift();
      try {
        results.set(bucket.id, { ok: true, data: await collectOne(bucket, ctx) });
      } catch (err) {
        results.set(bucket.id, { ok: false, error: err.message });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, buckets.length) }, worker));
  return results;
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npm test -- test/collect.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 9: Ignore the scratch directory**

Add to `.gitignore`, under the existing entries:

```
# Collected research buckets — scratch, not site content. Kept locally so
# `--recompose` can re-run the editorial pass without paying for research again.
buckets/
```

- [ ] **Step 10: Commit**

```bash
git add lib/weather.mjs lib/collect.mjs test/weather.test.mjs test/collect.test.mjs .gitignore
git commit -m "feat(collect): parallel per-bucket collection with failure isolation"
```

---

### Task 8: Composition

**Files:**
- Create: `lib/compose.mjs`
- Test: `test/compose.test.mjs`

**Interfaces:**
- Consumes: bucket results (Task 7), `buildSelectPrompt` (Task 4), `validateEditionData` (Task 3).
- Produces:
  - `selectCities(section, bucketData) -> object` — weather subset, in the edition's configured order
  - `selectIndices(section, bucketData) -> object` — markets subset, in the edition's configured order
  - `fallbackItems(section, bucketData) -> object[]` — top `max` in bucket order
  - `composeEdition(edition, ctx) -> Promise<EditionData>` where
    `ctx = { root, date, topics, template, bucketResults, runClaude, now, log }`

- [ ] **Step 1: Write the failing test**

Create `test/compose.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeEdition, selectCities, selectIndices, fallbackItems } from '../lib/compose.mjs';

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/compose.test.mjs`
Expected: FAIL — `Cannot find module '../lib/compose.mjs'`.

- [ ] **Step 3: Write `lib/compose.mjs`**

```javascript
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/compose.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/compose.mjs test/compose.test.mjs
git commit -m "feat(compose): per-edition selection with degraded fallback"
```

---

### Task 9: Orchestrator and CLI

**Files:**
- Rewrite: `generate.mjs`
- Rewrite: `test/generate-args.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: `parseArgs(argv) -> { renderOnly, recompose, date, push, editionIds }`.

`gitPublish`, `ghActiveUser`, `ghSwitch`, `PUBLISH_GH_USER` and `log` are kept **unchanged** from the current file — only the paths staged change (`git add docs`, unchanged, since everything published still lives under `docs/`).

- [ ] **Step 1: Write the failing test**

Replace `test/generate-args.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../generate.mjs';

test('defaults: full run, push enabled, every edition', () => {
  assert.deepEqual(parseArgs([]), {
    renderOnly: false, recompose: false, date: null, push: true, editionIds: null,
  });
});

test('--no-push disables publishing', () => {
  assert.equal(parseArgs(['--no-push']).push, false);
});

test('--render-only and --recompose set their flags', () => {
  assert.equal(parseArgs(['--render-only']).renderOnly, true);
  assert.equal(parseArgs(['--recompose']).recompose, true);
});

test('--date accepts an ISO date and rejects anything else', () => {
  assert.equal(parseArgs(['--date', '2026-07-28']).date, '2026-07-28');
  assert.throws(() => parseArgs(['--date', '28-07-2026']), /date/);
  assert.throws(() => parseArgs(['--date']), /date/);
});

test('--edition may be repeated and accumulates ids', () => {
  assert.deepEqual(parseArgs(['--edition', 'main']).editionIds, ['main']);
  assert.deepEqual(parseArgs(['--edition', 'main', '--edition', 'carlos']).editionIds, ['main', 'carlos']);
});

test('--edition requires a value', () => {
  assert.throws(() => parseArgs(['--edition']), /edition/);
});

test('unknown arguments are rejected', () => {
  assert.throws(() => parseArgs(['--nope']), /inconnu/);
});

test('--render-only and --recompose together are rejected', () => {
  assert.throws(() => parseArgs(['--render-only', '--recompose']), /ensemble|incompatible/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/generate-args.test.mjs`
Expected: FAIL — `editionIds` missing from the default result.

- [ ] **Step 3: Rewrite `generate.mjs`**

```javascript
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { zurichDate } from './lib/clock.mjs';
import { loadConfig } from './lib/config.mjs';
import { planBuckets } from './lib/plan.mjs';
import { collectAll, bucketPath, runClaudeCollect } from './lib/collect.mjs';
import { composeEdition } from './lib/compose.mjs';
import { validateEditionData } from './lib/schema.mjs';
import { writeEditionPages, rebuildEditionArchive, rebuildLanding } from './lib/site.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const o = { renderOnly: false, recompose: false, date: null, push: true, editionIds: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--render-only') o.renderOnly = true;
    else if (a === '--recompose') o.recompose = true;
    else if (a === '--no-push') o.push = false;
    else if (a === '--date') {
      o.date = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) throw new Error(`--date invalide: ${o.date}`);
    } else if (a === '--edition') {
      const id = argv[++i];
      if (!id || id.startsWith('--')) throw new Error('--edition attend un identifiant');
      o.editionIds = [...(o.editionIds || []), id];
    } else throw new Error(`argument inconnu: ${a}`);
  }
  if (o.renderOnly && o.recompose) throw new Error('--render-only et --recompose sont incompatibles');
  return o;
}

function log(line) {
  const dir = join(ROOT, 'logs');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'generate.log'), `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

// The repo is published under an account whose write access lives in a separate
// GitHub login (gh keyring). git uses gh as its credential helper, so the PUSH
// authenticates as whichever account is gh-"active". We flip to the publishing
// account for the push ONLY, then restore whatever was active before — the switch
// is global to the user, so we keep that window as small as possible to avoid
// disrupting any other git/gh work happening on the machine.
const PUBLISH_GH_USER = 'jnury';

function ghActiveUser() {
  const r = spawnSync('gh auth status --active', { cwd: ROOT, encoding: 'utf8', shell: true });
  const m = (r.stdout || '').match(/account\s+(\S+)/);
  return m ? m[1] : null;
}

function ghSwitch(user) {
  const s = spawnSync(`gh auth switch --user ${user}`, { cwd: ROOT, encoding: 'utf8', shell: true });
  if (s.status !== 0) throw new Error(`gh auth switch --user ${user} a échoué: ${s.stderr || s.stdout}`);
  spawnSync('gh auth setup-git', { cwd: ROOT, encoding: 'utf8', shell: true });
}

function gitPublish(date) {
  const run = (cmd) => {
    const r = spawnSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: true });
    if (r.status !== 0) throw new Error(`${cmd} a échoué: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  run('git add docs');
  const status = spawnSync('git status --porcelain docs', { cwd: ROOT, encoding: 'utf8', shell: true }).stdout;
  if (!status.trim()) { log('git: aucun changement à publier'); return; }
  run(`git commit -m "briefing: ${date}"`);

  const previous = ghActiveUser();
  const mustSwitch = previous !== PUBLISH_GH_USER;
  try {
    if (mustSwitch) { ghSwitch(PUBLISH_GH_USER); log(`git: bascule gh ${previous ?? '?'} -> ${PUBLISH_GH_USER}`); }
    run('git push origin main');
    log('git: publié sur origin/main');
  } finally {
    if (mustSwitch && previous) { ghSwitch(previous); log(`git: gh restauré -> ${previous}`); }
  }
}

// Re-reads buckets from disk so --recompose can skip collection entirely.
function loadBucketsFromDisk(buckets, date) {
  const results = new Map();
  for (const b of buckets) {
    const path = bucketPath(ROOT, date, b.id);
    if (!existsSync(path)) { results.set(b.id, { ok: false, error: `vivier absent: ${path}` }); continue; }
    try { results.set(b.id, { ok: true, data: JSON.parse(readFileSync(path, 'utf8')) }); }
    catch (err) { results.set(b.id, { ok: false, error: err.message }); }
  }
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const date = opts.date || zurichDate();

  try {
    const config = loadConfig(ROOT);
    const editions = opts.editionIds
      ? config.editions.filter((e) => opts.editionIds.includes(e.id))
      : config.editions;
    if (editions.length === 0) throw new Error(`aucune édition ne correspond à ${opts.editionIds?.join(', ')}`);

    if (opts.renderOnly) {
      let rendered = 0;
      for (const edition of editions) {
        const path = join(ROOT, 'docs', 'e', edition.id, 'data', `${date}.json`);
        if (!existsSync(path)) { log(`rendu: ${edition.id} ignorée (pas de données pour ${date})`); continue; }
        writeEditionPages(ROOT, JSON.parse(readFileSync(path, 'utf8')));
        rendered++;
      }
      log(`rendu: ${rendered} édition(s) re-rendue(s) pour ${date}`);
    } else {
      const buckets = planBuckets(config, { editionIds: editions.map((e) => e.id) });
      log(`plan: ${buckets.length} vivier(s) — ${buckets.map((b) => b.id).join(', ')}`);

      const bucketResults = opts.recompose
        ? loadBucketsFromDisk(buckets, date)
        : await collectAll(buckets, {
            root: ROOT, date, house: config.house, topics: config.topics,
            template: readFileSync(join(ROOT, 'prompts', 'collect.md'), 'utf8'),
            concurrency: 4, runClaude: runClaudeCollect,
          });

      for (const [id, r] of bucketResults) {
        log(r.ok ? `collecte: ${id} OK` : `collecte: ${id} ÉCHEC — ${r.error}`);
      }

      const selectTemplate = readFileSync(join(ROOT, 'prompts', 'select.md'), 'utf8');
      for (const edition of editions) {
        const data = await composeEdition(edition, {
          root: ROOT, date, topics: config.topics, template: selectTemplate,
          bucketResults, now: () => new Date().toISOString(), log,
        });
        const { valid, errors } = validateEditionData(data, config);
        if (!valid) { log(`édition ${edition.id}: NON PUBLIÉE — ${errors.join(' | ')}`); continue; }
        writeEditionPages(ROOT, data);
        log(`édition ${edition.id}: publiée (${data.sections.length} section(s))`);
      }
    }

    // Archives and landing are rebuilt from every configured edition, not just
    // the ones generated this run, so a --edition run never truncates the site.
    for (const edition of config.editions) rebuildEditionArchive(ROOT, edition);
    rebuildLanding(ROOT, config.editions);

    if (opts.push) gitPublish(date);
    log(`OK: briefing ${date} terminé`);
  } catch (err) {
    log(`ERREUR: ${err.message}`);
    process.exitCode = 1;
  }
}

// Only run main when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, every test file.

- [ ] **Step 5: Commit**

```bash
git add generate.mjs test/generate-args.test.mjs
git commit -m "feat(generate): four-stage multi-edition orchestrator"
```

---

### Task 10: Migration, Carlos's edition, documentation

**Files:**
- Create: `tools/migrate-legacy.mjs`
- Test: `test/migrate.test.mjs`
- Create: `config/topics/sport.json`, `config/editions/carlos.json`
- Modify: `README.md`
- Delete (via the migration): `docs/data/`, `docs/editions/`, old `docs/index.html`, old `docs/archive.html`

**Interfaces:**
- Consumes: `writeEditionPages`, `rebuildEditionArchive`, `rebuildLanding` (Task 6), `validateEditionData` (Task 3).
- Produces: `convertLegacy(legacy, { editionId, title, labels }) -> EditionData` — pure, exported for testing.

- [ ] **Step 1: Write the failing test**

Create `test/migrate.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertLegacy } from '../tools/migrate-legacy.mjs';

const legacy = {
  date: '2026-07-26',
  generatedAt: '2026-07-26T05:01:00+02:00',
  weather: {
    geneva: { high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10 },
    lausanne: { high: 23, low: 14, condition: 'Partiellement nuageux', weathercode: 2, precipProbability: 20 },
  },
  swissNews: [{ headline: 'Une nouvelle suisse', publishedAt: '2026-07-25' }],
  worldNews: [
    { headline: 'Une nouvelle mondiale', publishedAt: '2026-07-25' },
    { headline: 'Une autre', publishedAt: '2026-07-25' },
    { headline: 'Une troisième', publishedAt: '2026-07-25' },
  ],
  markets: { asOf: 'clôture du 25 juillet 2026', summary: 'Séance calme.', indices: [
    { name: 'Nasdaq', changePct: 0.4 }, { name: 'Dow Jones', changePct: 0.1 },
    { name: 'SMI', changePct: -0.2 }, { name: 'Euro Stoxx 50', changePct: 0.3 },
  ] },
  tech: [{ category: 'AI', title: 'Un modèle', url: 'https://e.com/a', publishedAt: '2026-07-25', summary: 'Résumé.' }],
};

const opts = { editionId: 'main', title: 'Briefing du matin' };

test('carries the identity fields over', () => {
  const out = convertLegacy(legacy, opts);
  assert.equal(out.edition, 'main');
  assert.equal(out.title, 'Briefing du matin');
  assert.equal(out.date, '2026-07-26');
  assert.equal(out.generatedAt, '2026-07-26T05:01:00+02:00');
});

test('produces the five sections in the original reading order', () => {
  assert.deepEqual(convertLegacy(legacy, opts).sections.map((s) => s.topic),
    ['weather', 'swiss', 'world', 'markets', 'tech']);
});

test('turns the two fixed weather keys into named cities', () => {
  const wx = convertLegacy(legacy, opts).sections[0];
  assert.equal(wx.kind, 'provider');
  assert.deepEqual(wx.cities.map((c) => c.name), ['Genève', 'Lausanne']);
  assert.equal(wx.cities[0].weathercode, 0);
});

test('maps swissNews and worldNews to headline sections', () => {
  const [, swiss, world] = convertLegacy(legacy, opts).sections;
  assert.equal(swiss.shape, 'headline');
  assert.equal(swiss.items[0].headline, 'Une nouvelle suisse');
  assert.equal(world.items.length, 3);
});

test('maps markets to a dataset section keeping asOf and summary', () => {
  const m = convertLegacy(legacy, opts).sections[3];
  assert.equal(m.kind, 'dataset');
  assert.equal(m.asOf, 'clôture du 25 juillet 2026');
  assert.equal(m.indices.length, 4);
});

test('maps tech to a card section', () => {
  const t = convertLegacy(legacy, opts).sections[4];
  assert.equal(t.shape, 'card');
  assert.equal(t.items[0].category, 'AI');
});

test('omits a section the legacy file does not have', () => {
  const { swissNews, ...withoutSwiss } = legacy;
  assert.ok(!convertLegacy(withoutSwiss, opts).sections.some((s) => s.topic === 'swiss'));
});

test('tolerates a legacy weather block with only one city', () => {
  const one = { ...legacy, weather: { geneva: legacy.weather.geneva } };
  assert.deepEqual(convertLegacy(one, opts).sections[0].cities.map((c) => c.name), ['Genève']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/migrate.test.mjs`
Expected: FAIL — `Cannot find module '../tools/migrate-legacy.mjs'`.

- [ ] **Step 3: Write `tools/migrate-legacy.mjs`**

```javascript
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
  const main = config.editions.find((e) => e.id === 'main');
  if (!main) throw new Error('édition « main » introuvable dans config/editions/');

  const legacyDir = join(ROOT, 'docs', 'data');
  const files = existsSync(legacyDir)
    ? readdirSync(legacyDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    : [];
  if (files.length === 0) { console.log('aucune édition héritée à migrer'); return; }

  let converted = 0;
  for (const file of files) {
    const legacy = JSON.parse(readFileSync(join(legacyDir, file), 'utf8'));
    const data = convertLegacy(legacy, { editionId: main.id, title: main.title });

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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/migrate.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Dry-run the migration and inspect**

Run: `node tools/migrate-legacy.mjs --dry-run`
Expected: `40/40 édition(s) converties (simulation)` or similar, with no `IGNORÉ` lines. If any file is reported as ignored, read the error and fix `convertLegacy` before continuing — do **not** proceed with a lossy migration.

- [ ] **Step 6: Run the migration for real**

```bash
node tools/migrate-legacy.mjs
```

Open `docs/index.html` and `docs/e/main/index.html` in a browser. Confirm: the landing page lists the editions, the main edition renders with weather icons, headlines, markets and tech cards, the theme toggle works, and the archive lists every date.

- [ ] **Step 7: Commit the migration**

```bash
git add -A docs
git commit -m "chore(site): migrate legacy editions to docs/e/main/"
```

- [ ] **Step 8: Delete the migration script**

```bash
git rm tools/migrate-legacy.mjs test/migrate.test.mjs
git commit -m "chore: remove one-shot legacy migration"
```

- [ ] **Step 9: Add Carlos's edition**

> **Ask the user before this step.** The values below come from the spec's worked example, not from Carlos. Confirm his real sections, cities and preferences, and adjust before committing.

Create `config/topics/sport.json`:

```json
{
  "id": "sport",
  "kind": "topic",
  "label": "Sport",
  "shape": "headline",
  "bucketMin": 10,
  "maxAgeDays": 2,
  "research": "Résultats et actualités sportives marquants de la veille. Une phrase maximum par élément, classés par importance.",
  "sources": ["RTS Sport", "L'Équipe", "Reuters Sports"]
}
```

Create `config/editions/carlos.json`:

```json
{
  "id": "carlos",
  "title": "Briefing de Carlos",
  "order": 2,
  "sections": [
    { "topic": "weather", "params": { "cities": [{ "name": "Zurich", "lat": 47.37, "lon": 8.54 }] } },
    { "topic": "world", "max": 5, "prefs": "Accent sur l'Amérique latine et l'Europe." },
    { "topic": "tech", "max": 10,
      "prefs": "Cybersécurité d'abord, puis infrastructure et cloud. Peu d'IA générative.",
      "hints": ["cybersécurité", "CVE", "ransomware", "Kubernetes"] },
    { "topic": "sport", "max": 3 }
  ]
}
```

- [ ] **Step 10: Verify the config loads and the plan is shared**

Run: `npm test`
Expected: PASS — including the "real config tree loads" test from Task 1.

Run: `node -e "import('./lib/config.mjs').then(async c=>{const {planBuckets}=await import('./lib/plan.mjs');const cfg=c.loadConfig(process.cwd());for(const b of planBuckets(cfg))console.log(b.id,'| taille',b.size??'-','| éditions',b.consumers.join(','),'| hints',b.hints.join(','))})"`

Expected output shows `tech` with **both** editions as consumers and the merged hint list — the proof that one research run serves both readers:

```
markets | taille - | éditions main | hints
sport   | taille 10 | éditions carlos | hints
tech    | taille 50 | éditions main,carlos | hints IA,modèles de langage,cloud,sécurité,cybersécurité,CVE,ransomware,Kubernetes
weather | taille - | éditions main,carlos | hints
world   | taille 13 | éditions main,carlos | hints
```

- [ ] **Step 11: End-to-end dry run without pushing**

```bash
node generate.mjs --no-push --edition main
```

This spends tokens. Watch `logs/generate.log` for one `collecte: <id> OK` line per bucket and `édition main: publiée`. Then open `docs/e/main/index.html` and confirm today's edition renders.

If a bucket fails, read its error, fix the topic's `research` text or `sources`, and re-run with `--recompose` where possible to avoid paying for research twice.

- [ ] **Step 12: Update the README**

Replace the "How it works", "Commands" and "Layout" sections of `README.md`:

````markdown
## How it works

`generate.mjs` (run by Windows Task Scheduler) runs four stages:

1. **Plan** — read `config/editions/*.json`, resolve which topic buckets are needed.
2. **Collect** — one `claude -p` run per bucket, in parallel (weather is fetched
   straight from Open-Meteo). Buckets land in `buckets/<date>/` and are gitignored.
3. **Compose** — for each edition, a small `claude -p` pass per researched section
   picks and orders items from the shared bucket according to that edition's
   preferences. Weather and markets are selected deterministically from config.
4. **Publish** — render each edition's pages, archives and the landing page under
   `docs/`, then commit and push.

There is exactly **one bucket per topic per day**. Two editions that share a topic
read the same researched candidates and differ only in how they cut them, so token
spend grows with the number of distinct topics, not the number of readers.

A failed bucket removes that section from the editions using it; a failed editorial
pass falls back to the bucket's own ordering and marks the section degraded. The
morning publishes whatever succeeded.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Run the unit tests (`node --test`). |
| `node generate.mjs` | Full run: plan → collect → compose → publish. |
| `node generate.mjs --no-push` | Same, without pushing. |
| `node generate.mjs --edition carlos` | One edition only. Repeatable. |
| `node generate.mjs --recompose --date YYYY-MM-DD` | Re-run the editorial passes from existing local buckets — cheap prompt iteration, no research. |
| `node generate.mjs --render-only --date YYYY-MM-DD` | Re-render from stored edition JSON. No LLM call. |

## Layout

- `generate.mjs` — orchestrator / scheduler entry point
- `config/house.md` — rules inherited by every collect prompt
- `config/topics/*.json` — topic definitions (research, sources, shape, limits)
- `config/editions/*.json` — edition definitions (ordered sections, params, prefs)
- `prompts/collect.md`, `prompts/select.md` — prompt templates
- `lib/config.mjs` — config loading and validation
- `lib/plan.mjs` — bucket resolution and unions
- `lib/prompt.mjs` — pure prompt assembly
- `lib/schema.mjs` — bucket and edition validators
- `lib/weather.mjs` — Open-Meteo provider
- `lib/collect.mjs` — parallel collection
- `lib/compose.mjs` — per-edition selection
- `lib/render.mjs` — pure HTML renderers
- `lib/site.mjs` — page, archive and landing writers
- `docs/` — the published site (`index.html`, `e/<id>/`)

## Adding an edition

Create `config/editions/<id>.json` with the sections that reader wants. Reuse
existing topics — the bucket is shared automatically. To add a topic nobody has
yet, drop a `config/topics/<id>.json` next to the others; no code changes.
````

Also update the intro paragraph so it describes editions rather than a single briefing.

- [ ] **Step 13: Final full-suite run and commit**

Run: `npm test`
Expected: PASS.

```bash
git add config README.md
git commit -m "feat: add Carlos's edition and document the multi-edition workflow"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §2 four-stage pipeline | 9 |
| §2.1 provider / dataset / topic kinds | 1 (config), 7 (collect), 8 (compose) |
| §2.2 one bucket per topic, unions, derived size, unknown-topic abort | 2, 1 |
| §2.3 two item shapes | 3 (validate), 5 (render) |
| §3.1 house.md | 1, 4 |
| §3.2 topic definitions | 1 |
| §3.3 edition definitions, hints vs prefs | 1, 2, 4 |
| §4.1 bucket contract | 3, 7 |
| §4.2 edition contract | 3, 8 |
| §4.3 generic validation | 3 |
| §5 site layout, landing page | 5, 6 |
| §5.1 migration | 10 |
| §6 failure handling, degraded fallback | 7, 8, 9 |
| §7 CLI | 9 |
| §8 module layout | all |
| §9 testing | every task |
| §10 cost and runtime | 7 (concurrency cap 4) |

No gaps.

**Known deviations from the spec, deliberate:**

1. **Weather is a real HTTP fetch**, not a Claude run. The spec classifies it as a `provider` whose collection is an HTTP fetch; today the model does it via WebFetch. Task 7 makes it deterministic, which removes a token cost and a failure mode. The WMO→French mapping moves from the prompt into `lib/weather.mjs`.
2. **Edition ordering uses an explicit `order` field** rather than "discovery order on disk", which is not guaranteed stable across platforms. Default `100`, so an edition without one sorts last, then alphabetically.
3. **`selectWithEditor` drops items not present in the bucket.** The spec says the editor selects rather than writes; this enforces it in code instead of trusting the prompt.

**Type consistency:** `loadConfig` → `{ house, topics, editions }` used identically in Tasks 2, 9, 10. `planBuckets(config, {editionIds})` → `Bucket[]` consumed in Tasks 7 and 9. `collectAll` → `Map<id, {ok, data?, error?}>` consumed by `composeEdition` as `ctx.bucketResults` in Tasks 8 and 9. `bucketPath(root, date, id)` defined in Task 7, imported in Tasks 8 and 9. `validateEditionData(data, config)` defined in Task 3, used in Tasks 9 and 10. `writeEditionPages`/`rebuildEditionArchive`/`rebuildLanding` defined in Task 6, used in Tasks 9 and 10. Section field names (`topic`, `label`, `kind`, `shape`, `items`, `cities`, `indices`, `asOf`, `summary`, `degraded`) are identical across Tasks 3, 5, 6, 8 and 10.
