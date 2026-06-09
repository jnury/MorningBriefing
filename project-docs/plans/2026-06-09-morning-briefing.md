# Morning Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, scheduled generator that produces a daily French "morning briefing" static site (weather, world news, markets, tech news) and publishes it to GitHub Pages.

**Architecture:** A single Node orchestrator (`generate.mjs`) runs at 05:00 via Windows Task Scheduler. It calls `claude -p` (headless, Opus) to research the day and write a **schema-validated** JSON data file; a deterministic, pure-function renderer turns that JSON into static HTML under `docs/`; then git commits and pushes. Research (non-deterministic) is isolated from rendering (deterministic, unit-tested) by the JSON contract. Bad/missing data aborts before any push, so the live site never breaks.

**Tech Stack:** Node.js 24 (ESM `.mjs`, zero runtime dependencies), Node built-in test runner (`node --test`), Claude Code headless CLI, Open-Meteo API (fetched by Claude), git + GitHub Pages (deploy from `main` → `/docs`), Windows Task Scheduler.

**Conventions used throughout this plan:**
- Repo root: `C:\Users\Julien Nury\Repositories\MorningBreifing` (referred to as `<repo>`).
- All modules are ESM `.mjs`. Run tests with `node --test`.
- Published site lives in `<repo>/docs/`; edition data in `<repo>/docs/data/`.
- `linkPrefix` is `''` for pages at `docs/` (index, archive) and `'../'` for pages at `docs/editions/`.
- CSS is **inlined** into every page (no external stylesheet) so pages are path-independent on a GitHub project site served under `/MorningBriefing/`.

---

## The JSON contract (read first)

Every task references this shape. One edition = one object:

```json
{
  "date": "2026-06-09",
  "generatedAt": "2026-06-09T05:01:23+02:00",
  "weather": {
    "geneva":   { "high": 24, "low": 13, "condition": "Ensoleillé", "precipProbability": 10 },
    "lausanne": { "high": 23, "low": 14, "condition": "Partiellement nuageux", "precipProbability": 20 }
  },
  "worldNews": [
    { "headline": "Première nouvelle mondiale en une phrase." },
    { "headline": "Deuxième nouvelle mondiale en une phrase." },
    { "headline": "Troisième nouvelle mondiale en une phrase." }
  ],
  "markets": {
    "asOf": "clôture du 6 juin 2026",
    "regions": [
      { "region": "US",     "indices": [
          { "name": "S&P 500", "level": 5234.18, "changePct": 0.42 },
          { "name": "Nasdaq",  "level": 16780.5, "changePct": 0.61 },
          { "name": "Dow Jones","level": 39120.7, "changePct": -0.12 } ],
        "takeaway": "Wall Street termine en légère hausse, portée par la tech." },
      { "region": "Europe", "indices": [
          { "name": "SMI",          "level": 12010.3, "changePct": 0.18 },
          { "name": "Euro Stoxx 50","level": 4980.6,  "changePct": -0.05 } ],
        "takeaway": "Les bourses européennes hésitent avant les chiffres de l'inflation." },
      { "region": "Asia",   "indices": [
          { "name": "Nikkei 225",        "level": 38900.1, "changePct": 0.74 },
          { "name": "Hang Seng",         "level": 17850.9, "changePct": -0.30 },
          { "name": "Shanghai Composite","level": 3050.2,  "changePct": 0.11 } ],
        "takeaway": "Tokyo rebondit tandis que Hong Kong recule légèrement." }
    ]
  },
  "tech": [
    { "category": "AI", "title": "Titre de l'article", "url": "https://example.com/a",
      "summary": "Résumé en français de 150 mots maximum." }
  ]
}
```

**Validation rules** (enforced in Task 3):
- `date`: matches `^\d{4}-\d{2}-\d{2}$`.
- `generatedAt`: non-empty string.
- `weather.geneva` and `weather.lausanne`: each has numeric `high`, numeric `low`, non-empty string `condition`, numeric `precipProbability`.
- `worldNews`: array of **exactly 3**, each with a non-empty string `headline`.
- `markets.asOf`: non-empty string.
- `markets.regions`: array of **exactly 3** whose `region` values are exactly `"US"`, `"Europe"`, `"Asia"` (in any order); each has a non-empty `indices` array (every index has non-empty `name`, numeric `level`, numeric `changePct`) and a non-empty `takeaway`.
- `tech`: array of **1..20**; each item has `category` ∈ {`IT`,`Science`,`AI`}, non-empty `title`, `url` matching `^https?://`, non-empty `summary` of **≤150 words**.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore` (already exists from spec commit — verify/extend)
- Create: `lib/.gitkeep`, `test/fixtures/.gitkeep`, `prompts/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "morning-briefing",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Personal daily morning briefing static-site generator",
  "scripts": {
    "test": "node --test",
    "generate": "node generate.mjs",
    "render-only": "node generate.mjs --render-only"
  }
}
```

- [ ] **Step 2: Ensure `.gitignore` contains the right entries**

File `.gitignore` (overwrite to this exact content):

```
logs/
node_modules/
.DS_Store
*.log
```

- [ ] **Step 3: Create placeholder files so empty dirs are tracked**

Create `lib/.gitkeep`, `test/fixtures/.gitkeep`, `prompts/.gitkeep` (each an empty file).

- [ ] **Step 4: Verify Node can run the test runner (no tests yet = exit 0)**

Run: `node --test`
Expected: completes with `tests 0` (or "no test files found"), exit code 0.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore lib/.gitkeep test/fixtures/.gitkeep prompts/.gitkeep
git commit -m "chore: project scaffolding for morning briefing"
```

---

## Task 2: Valid fixture edition

**Files:**
- Create: `test/fixtures/sample.json`

This fixture is the single source of truth for schema + renderer tests. It must satisfy every validation rule.

- [ ] **Step 1: Create `test/fixtures/sample.json`**

```json
{
  "date": "2026-06-09",
  "generatedAt": "2026-06-09T05:01:23+02:00",
  "weather": {
    "geneva":   { "high": 24, "low": 13, "condition": "Ensoleillé", "precipProbability": 10 },
    "lausanne": { "high": 23, "low": 14, "condition": "Partiellement nuageux", "precipProbability": 20 }
  },
  "worldNews": [
    { "headline": "Le sommet du G20 s'ouvre à Genève sur fond de tensions commerciales." },
    { "headline": "Une avancée majeure dans les négociations climatiques est annoncée à l'ONU." },
    { "headline": "Les marchés réagissent à la décision de la banque centrale américaine." }
  ],
  "markets": {
    "asOf": "clôture du 6 juin 2026",
    "regions": [
      { "region": "US", "indices": [
          { "name": "S&P 500", "level": 5234.18, "changePct": 0.42 },
          { "name": "Nasdaq", "level": 16780.5, "changePct": 0.61 },
          { "name": "Dow Jones", "level": 39120.7, "changePct": -0.12 } ],
        "takeaway": "Wall Street termine en légère hausse, portée par la technologie." },
      { "region": "Europe", "indices": [
          { "name": "SMI", "level": 12010.3, "changePct": 0.18 },
          { "name": "Euro Stoxx 50", "level": 4980.6, "changePct": -0.05 } ],
        "takeaway": "Les bourses européennes hésitent avant les chiffres de l'inflation." },
      { "region": "Asia", "indices": [
          { "name": "Nikkei 225", "level": 38900.1, "changePct": 0.74 },
          { "name": "Hang Seng", "level": 17850.9, "changePct": -0.30 },
          { "name": "Shanghai Composite", "level": 3050.2, "changePct": 0.11 } ],
        "takeaway": "Tokyo rebondit tandis que Hong Kong recule légèrement." }
    ]
  },
  "tech": [
    { "category": "AI", "title": "OpenClaw runtime devient gratuit", "url": "https://example.com/openclaw",
      "summary": "Microsoft a rendu gratuit le runtime open source OpenClaw et monétise désormais la couche de contrôle autour de celui-ci : identité, gouvernance, audit et gestion d'entreprise." },
    { "category": "IT", "title": "Google louera de la capacité de calcul à SpaceX", "url": "https://example.com/google-spacex",
      "summary": "Google paierait près d'un milliard de dollars par mois pour louer de la capacité de centre de données à SpaceX entre 2026 et 2029, sous réserve de la livraison de puces Nvidia." },
    { "category": "Science", "title": "Une nouvelle méthode d'exécution durable dans PostgreSQL", "url": "https://example.com/pg-durable",
      "summary": "Microsoft a publié en open source pg_durable, une extension PostgreSQL permettant des workflows tolérants aux pannes avec points de reprise, sans infrastructure externe." }
  ]
}
```

- [ ] **Step 2: Verify it is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('test/fixtures/sample.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/sample.json
git commit -m "test: add valid sample briefing fixture"
```

---

## Task 3: Schema validator (`lib/schema.mjs`)

**Files:**
- Create: `lib/schema.mjs`
- Test: `test/schema.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/schema.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBriefing, countWords } from '../lib/schema.mjs';

const valid = () => JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url)));

test('countWords counts whitespace-separated words', () => {
  assert.equal(countWords('un deux trois'), 3);
  assert.equal(countWords('  espaces   multiples  '), 2);
  assert.equal(countWords(''), 0);
});

test('valid fixture passes', () => {
  const r = validateBriefing(valid());
  assert.equal(r.valid, true, r.errors.join('; '));
  assert.deepEqual(r.errors, []);
});

test('rejects wrong worldNews count', () => {
  const d = valid(); d.worldNews = d.worldNews.slice(0, 2);
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects missing weather city', () => {
  const d = valid(); delete d.weather.lausanne;
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects more than 20 tech items', () => {
  const d = valid();
  d.tech = Array.from({ length: 21 }, () => ({
    category: 'AI', title: 't', url: 'https://x.com', summary: 'résumé'
  }));
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects summary over 150 words', () => {
  const d = valid();
  d.tech[0].summary = Array.from({ length: 151 }, () => 'mot').join(' ');
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects bad tech category', () => {
  const d = valid(); d.tech[0].category = 'Sports';
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects non-http url', () => {
  const d = valid(); d.tech[0].url = 'ftp://x.com';
  assert.equal(validateBriefing(d).valid, false);
});

test('rejects wrong market regions', () => {
  const d = valid(); d.markets.regions[0].region = 'LatAm';
  assert.equal(validateBriefing(d).valid, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/schema.test.mjs`
Expected: FAIL — `Cannot find module '../lib/schema.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `lib/schema.mjs`:

```javascript
// Hand-rolled validator for the briefing JSON contract. Zero dependencies.

export function countWords(s) {
  if (typeof s !== 'string') return 0;
  const t = s.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

function checkCity(errors, where, c) {
  if (!c || typeof c !== 'object') { errors.push(`${where} manquant`); return; }
  if (!isNum(c.high)) errors.push(`${where}.high doit être un nombre`);
  if (!isNum(c.low)) errors.push(`${where}.low doit être un nombre`);
  if (!isStr(c.condition)) errors.push(`${where}.condition manquant`);
  if (!isNum(c.precipProbability)) errors.push(`${where}.precipProbability doit être un nombre`);
}

export function validateBriefing(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['racine: objet attendu'] };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) errors.push('date invalide (YYYY-MM-DD)');
  if (!isStr(data.generatedAt)) errors.push('generatedAt manquant');

  const w = data.weather || {};
  checkCity(errors, 'weather.geneva', w.geneva);
  checkCity(errors, 'weather.lausanne', w.lausanne);

  if (!Array.isArray(data.worldNews) || data.worldNews.length !== 3) {
    errors.push('worldNews doit contenir exactement 3 éléments');
  } else {
    data.worldNews.forEach((n, i) => {
      if (!n || !isStr(n.headline)) errors.push(`worldNews[${i}].headline manquant`);
    });
  }

  const m = data.markets || {};
  if (!isStr(m.asOf)) errors.push('markets.asOf manquant');
  if (!Array.isArray(m.regions) || m.regions.length !== 3) {
    errors.push('markets.regions doit contenir exactement 3 régions');
  } else {
    const names = m.regions.map((r) => r && r.region);
    for (const req of ['US', 'Europe', 'Asia']) {
      if (!names.includes(req)) errors.push(`markets.regions: région ${req} manquante`);
    }
    m.regions.forEach((r, i) => {
      if (!Array.isArray(r.indices) || r.indices.length === 0) {
        errors.push(`markets.regions[${i}].indices vide`);
      } else {
        r.indices.forEach((idx, j) => {
          if (!isStr(idx.name)) errors.push(`markets.regions[${i}].indices[${j}].name manquant`);
          if (!isNum(idx.level)) errors.push(`markets.regions[${i}].indices[${j}].level invalide`);
          if (!isNum(idx.changePct)) errors.push(`markets.regions[${i}].indices[${j}].changePct invalide`);
        });
      }
      if (!isStr(r.takeaway)) errors.push(`markets.regions[${i}].takeaway manquant`);
    });
  }

  if (!Array.isArray(data.tech) || data.tech.length < 1 || data.tech.length > 20) {
    errors.push('tech doit contenir entre 1 et 20 éléments');
  } else {
    data.tech.forEach((t, i) => {
      if (!['IT', 'Science', 'AI'].includes(t.category)) errors.push(`tech[${i}].category invalide`);
      if (!isStr(t.title)) errors.push(`tech[${i}].title manquant`);
      if (!/^https?:\/\//.test(t.url || '')) errors.push(`tech[${i}].url invalide`);
      if (!isStr(t.summary)) errors.push(`tech[${i}].summary manquant`);
      else if (countWords(t.summary) > 150) errors.push(`tech[${i}].summary dépasse 150 mots`);
    });
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/schema.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schema.mjs test/schema.test.mjs
git commit -m "feat: add briefing JSON schema validator"
```

---

## Task 4: Date helper (`lib/clock.mjs`)

**Files:**
- Create: `lib/clock.mjs`
- Test: `test/clock.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/clock.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zurichDate } from '../lib/clock.mjs';

test('formats a date in Europe/Zurich as YYYY-MM-DD', () => {
  // 2026-06-09T03:30:00Z is 05:30 in Zurich (CEST, +02:00) -> still the 9th
  assert.equal(zurichDate(new Date('2026-06-09T03:30:00Z')), '2026-06-09');
});

test('handles day rollover relative to UTC', () => {
  // 2026-06-08T23:30:00Z is 01:30 on the 9th in Zurich
  assert.equal(zurichDate(new Date('2026-06-08T23:30:00Z')), '2026-06-09');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/clock.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/clock.mjs`:

```javascript
// Returns the calendar date in Europe/Zurich as 'YYYY-MM-DD'.
export function zurichDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/clock.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/clock.mjs test/clock.test.mjs
git commit -m "feat: add Europe/Zurich date helper"
```

---

## Task 5: Page layout + CSS (`lib/render.mjs` part 1)

**Files:**
- Create: `lib/render.mjs`
- Test: `test/render-layout.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/render-layout.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageLayout, escapeHtml, PAGE_CSS } from '../lib/render.mjs';

test('escapeHtml escapes dangerous characters', () => {
  assert.equal(escapeHtml('a & b < c > "d" \'e\''), 'a &amp; b &lt; c &gt; &quot;d&quot; &#39;e&#39;');
});

test('pageLayout produces a full responsive HTML document', () => {
  const html = pageLayout({ title: 'Test', bodyHtml: '<p>hello</p>', linkPrefix: '' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /<title>Test<\/title>/);
  assert.match(html, /<p>hello<\/p>/);
  assert.ok(PAGE_CSS.length > 50);
  assert.match(html, /<style>/);
});

test('pageLayout nav links respect linkPrefix', () => {
  const deep = pageLayout({ title: 'T', bodyHtml: '', linkPrefix: '../' });
  assert.match(deep, /href="\.\.\/index\.html"/);
  assert.match(deep, /href="\.\.\/archive\.html"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/render-layout.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/render.mjs` with the layout half (renderEdition/renderArchive added in Tasks 6–7 — keep them out for now):

```javascript
// Pure rendering functions: (data) -> HTML strings. No side effects.

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const PAGE_CSS = `
:root{--ink:#1a1a1a;--muted:#6b6b6b;--line:#e6e6e6;--accent:#0b5cad;--bg:#ffffff}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  line-height:1.6;font-size:18px}
.wrap{max-width:680px;margin:0 auto;padding:24px 20px 80px}
header.site{display:flex;justify-content:space-between;align-items:baseline;
  border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:8px;flex-wrap:wrap;gap:8px}
header.site .date{font-size:15px;color:var(--muted)}
header.site nav a{color:var(--accent);text-decoration:none;font-size:15px;margin-left:16px}
header.site nav a:hover{text-decoration:underline}
h1{font-size:26px;letter-spacing:-0.01em;margin:18px 0 4px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);
  margin:40px 0 12px;font-weight:600}
h3{font-size:19px;margin:22px 0 4px;line-height:1.35}
h3 a{color:var(--ink);text-decoration:none}
h3 a:hover{color:var(--accent)}
p{margin:8px 0}
.lead{color:var(--muted);margin-top:0}
.weather{display:flex;gap:28px;flex-wrap:wrap}
.weather .city{flex:1 1 200px}
.weather .city .t{font-size:22px;font-weight:600}
.weather .city .c{color:var(--muted)}
.market{margin:14px 0}
.market .name{font-weight:600}
.market table{border-collapse:collapse;width:100%;margin:6px 0;font-size:16px}
.market td{padding:3px 0;border-bottom:1px solid var(--line)}
.market td.num{text-align:right;font-variant-numeric:tabular-nums}
.up{color:#0a7a2f}.down{color:#b3261e}
.world li{margin:6px 0}
.cat{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:0.06em}
.src{font-size:14px}.src a{color:var(--accent);text-decoration:none}
.archive li{margin:8px 0;list-style:none}
.archive ul{padding:0}
.archive a{color:var(--accent);text-decoration:none;font-size:18px}
footer.site{margin-top:60px;border-top:1px solid var(--line);padding-top:14px;
  color:var(--muted);font-size:14px}
@media(max-width:480px){body{font-size:17px}.wrap{padding:18px 16px 60px}h1{font-size:23px}}
`.trim();

export function pageLayout({ title, bodyHtml, linkPrefix = '' }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
<header class="site">
<span class="brand">Briefing du matin</span>
<nav><a href="${linkPrefix}index.html">Aujourd'hui</a><a href="${linkPrefix}archive.html">Archives</a></nav>
</header>
${bodyHtml}
<footer class="site">Généré automatiquement &middot; Julien Nury</footer>
</div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/render-layout.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/render.mjs test/render-layout.test.mjs
git commit -m "feat: add page layout and inline CSS"
```

---

## Task 6: Edition renderer (`renderEdition`)

**Files:**
- Modify: `lib/render.mjs` (append `formatLevel`, `formatPct`, `renderEdition`)
- Test: `test/render-edition.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/render-edition.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderEdition } from '../lib/render.mjs';

const data = JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url)));

test('renderEdition includes weather for both cities', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.match(html, /Genève/);
  assert.match(html, /Lausanne/);
  assert.match(html, /Ensoleillé/);
});

test('renderEdition lists the three world news headlines', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  for (const n of data.worldNews) assert.ok(html.includes(n.headline), `missing: ${n.headline}`);
});

test('renderEdition shows market indices with numbers and signed percent', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.match(html, /S&amp;P 500/);
  assert.match(html, /SMI/);
  assert.match(html, /\+0[.,]42\s*%/);   // up value formatted with + sign
  assert.match(html, /-0[.,]12\s*%/);    // down value
});

test('renderEdition renders tech items with titles, links and category', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.match(html, /href="https:\/\/example\.com\/openclaw"/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /AI/);
  assert.match(html, /IT/);
  assert.match(html, /Science/);
});

test('renderEdition contains no emoji', () => {
  const html = renderEdition(data, { linkPrefix: '' });
  assert.ok(!/\p{Extended_Pictographic}/u.test(html), 'should not contain emoji');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/render-edition.test.mjs`
Expected: FAIL — `renderEdition is not a function`.

- [ ] **Step 3: Append the implementation to `lib/render.mjs`**

Add to the end of `lib/render.mjs`:

```javascript
const CITY_LABELS = { geneva: 'Genève', lausanne: 'Lausanne' };

function formatLevel(n) {
  // French thousands separator (narrow no-break space), 2 decimals.
  return n.toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n) {
  const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
  const cls = n > 0 ? 'up' : (n < 0 ? 'down' : '');
  const body = `${sign}${Math.abs(n).toFixed(2)} %`;
  return { cls, text: body };
}

function renderWeather(weather) {
  const city = (key) => {
    const c = weather[key];
    return `<div class="city">
<div class="name">${CITY_LABELS[key]}</div>
<div class="t">${Math.round(c.high)}° / ${Math.round(c.low)}°</div>
<div class="c">${escapeHtml(c.condition)} &middot; ${Math.round(c.precipProbability)} % de précip.</div>
</div>`;
  };
  return `<h2>Météo</h2>
<div class="weather">${city('geneva')}${city('lausanne')}</div>`;
}

function renderWorld(worldNews) {
  const items = worldNews.map((n) => `<li>${escapeHtml(n.headline)}</li>`).join('\n');
  return `<h2>Le monde en bref</h2>\n<ul class="world">\n${items}\n</ul>`;
}

function renderMarkets(markets) {
  const block = (r) => {
    const rows = r.indices.map((idx) => {
      const p = formatPct(idx.changePct);
      return `<tr><td>${escapeHtml(idx.name)}</td>
<td class="num">${formatLevel(idx.level)}</td>
<td class="num ${p.cls}">${p.text}</td></tr>`;
    }).join('\n');
    return `<div class="market">
<div class="name">${escapeHtml(r.region)}</div>
<table>${rows}</table>
<p class="lead">${escapeHtml(r.takeaway)}</p>
</div>`;
  };
  const order = ['US', 'Europe', 'Asia'];
  const sorted = order
    .map((name) => markets.regions.find((r) => r.region === name))
    .filter(Boolean);
  return `<h2>Marchés &middot; ${escapeHtml(markets.asOf)}</h2>\n${sorted.map(block).join('\n')}`;
}

function renderTech(tech) {
  const item = (t) => `<article>
<div class="cat">${escapeHtml(t.category)}</div>
<h3><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a></h3>
<p>${escapeHtml(t.summary)}</p>
</article>`;
  return `<h2>Tech &middot; IT, Science &amp; IA</h2>\n${tech.map(item).join('\n')}`;
}

const FR_MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
function frenchDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${FR_MONTHS[m - 1]} ${y}`;
}

export function renderEdition(data, { linkPrefix = '' } = {}) {
  const body = `<h1>Briefing du ${frenchDate(data.date)}</h1>
<p class="lead">Météo, monde, marchés et tech — l'essentiel du jour.</p>
${renderWeather(data.weather)}
${renderWorld(data.worldNews)}
${renderMarkets(data.markets)}
${renderTech(data.tech)}`;
  return pageLayout({ title: `Briefing du ${frenchDate(data.date)}`, bodyHtml: body, linkPrefix });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/render-edition.test.mjs`
Expected: PASS. (Note: `formatPct` renders `-` itself, and `escapeHtml` turns `&` into `&amp;` so "S&P 500" → "S&amp;P 500", matching the test.)

- [ ] **Step 5: Commit**

```bash
git add lib/render.mjs test/render-edition.test.mjs
git commit -m "feat: render a full briefing edition page"
```

---

## Task 7: Archive renderer (`renderArchive`)

**Files:**
- Modify: `lib/render.mjs` (append `renderArchive`)
- Test: `test/render-archive.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/render-archive.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArchive } from '../lib/render.mjs';

const editions = [{ date: '2026-06-07' }, { date: '2026-06-09' }, { date: '2026-06-08' }];

test('renderArchive lists editions newest first', () => {
  const html = renderArchive(editions, { linkPrefix: '' });
  const i9 = html.indexOf('2026-06-09');
  const i8 = html.indexOf('2026-06-08');
  const i7 = html.indexOf('2026-06-07');
  assert.ok(i9 < i8 && i8 < i7, 'order should be 9, 8, 7');
});

test('renderArchive links to edition permalinks with linkPrefix', () => {
  const html = renderArchive(editions, { linkPrefix: '' });
  assert.match(html, /href="editions\/2026-06-09\.html"/);
});

test('renderArchive uses French date labels', () => {
  const html = renderArchive(editions, { linkPrefix: '' });
  assert.match(html, /9 juin 2026/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/render-archive.test.mjs`
Expected: FAIL — `renderArchive is not a function`.

- [ ] **Step 3: Append the implementation to `lib/render.mjs`**

Add to the end of `lib/render.mjs` (reuses `frenchDate` defined in Task 6):

```javascript
export function renderArchive(editions, { linkPrefix = '' } = {}) {
  const sorted = [...editions].sort((a, b) => (a.date < b.date ? 1 : -1));
  const items = sorted.map((e) =>
    `<li><a href="${linkPrefix}editions/${e.date}.html">${frenchDate(e.date)}</a></li>`
  ).join('\n');
  const body = `<h1>Archives</h1>
<p class="lead">Toutes les éditions précédentes, de la plus récente à la plus ancienne.</p>
<div class="archive"><ul>\n${items}\n</ul></div>`;
  return pageLayout({ title: 'Archives — Briefing du matin', bodyHtml: body, linkPrefix });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/render-archive.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/render.mjs test/render-archive.test.mjs
git commit -m "feat: render the archive index page"
```

---

## Task 8: Site writer (`lib/site.mjs`)

**Files:**
- Create: `lib/site.mjs`
- Test: `test/site.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/site.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/site.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/site.mjs`:

```javascript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/site.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/site.mjs test/site.test.mjs
git commit -m "feat: write edition pages and rebuild archive from disk"
```

---

## Task 9: The Claude research prompt (`prompts/briefing.md`)

**Files:**
- Create: `prompts/briefing.md`

This is the full instruction handed to `claude -p`. `generate.mjs` (Task 10) replaces `{{DATE}}` and `{{OUTPUT_PATH}}` before sending it.

- [ ] **Step 1: Create `prompts/briefing.md`**

```markdown
Tu es l'éditeur d'un briefing matinal personnel. Nous sommes le {{DATE}} (fuseau Europe/Zurich).

Ta mission : rechercher les informations du jour et écrire UN SEUL fichier JSON valide à ce chemin exact : `{{OUTPUT_PATH}}`. N'écris rien d'autre, ne crée aucun autre fichier, ne renvoie aucun texte hors du JSON écrit dans le fichier.

Langue de TOUT le contenu rédactionnel : français.

Étapes de recherche :
1. MÉTÉO — Récupère les prévisions du jour pour Genève (lat 46.20, lon 6.14) et Lausanne (lat 46.52, lon 6.63) via l'API Open-Meteo (sans clé). Utilise WebFetch sur :
   `https://api.open-meteo.com/v1/forecast?latitude=46.20&longitude=6.14&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=Europe%2FZurich&forecast_days=1`
   et l'équivalent pour Lausanne. Convertis le `weathercode` WMO en une courte description française (ex. 0 = « Ensoleillé », 2 = « Partiellement nuageux », 3 = « Couvert », 61 = « Pluie faible »). `high`/`low` = max/min du jour arrondis ; `precipProbability` = precipitation_probability_max.
2. MONDE — Identifie les 3 nouvelles internationales les plus importantes du jour. Une phrase maximum chacune, classées par importance.
3. MARCHÉS — Donne les niveaux de clôture les plus récents et la variation en % pour : US (S&P 500, Nasdaq, Dow Jones), Europe (SMI, Euro Stoxx 50), Asie (Nikkei 225, Hang Seng, Shanghai Composite). Indique la date de référence dans `asOf` (ex. « clôture du 6 juin 2026 »). Une phrase de synthèse par région dans `takeaway`. Recherche des sources fiables et récentes.
4. TECH — Rassemble jusqu'à 20 actualités pertinentes en informatique (IT), science et IA, classées de la plus importante à la moins importante. Pour chacune : `category` (« IT », « Science » ou « AI »), un `title`, l'`url` de la source, et un `summary` en français de 150 mots MAXIMUM. Privilégie les sources primaires et les nouvelles des dernières 24–48 h.

Format de sortie — écris EXACTEMENT cette structure (les valeurs ci-dessous sont illustratives) :

{
  "date": "{{DATE}}",
  "generatedAt": "<horodatage ISO 8601 avec fuseau, ex. 2026-06-09T05:01:00+02:00>",
  "weather": {
    "geneva":   { "high": 24, "low": 13, "condition": "Ensoleillé", "precipProbability": 10 },
    "lausanne": { "high": 23, "low": 14, "condition": "Partiellement nuageux", "precipProbability": 20 }
  },
  "worldNews": [
    { "headline": "..." }, { "headline": "..." }, { "headline": "..." }
  ],
  "markets": {
    "asOf": "...",
    "regions": [
      { "region": "US",     "indices": [ { "name": "S&P 500", "level": 0, "changePct": 0 }, { "name": "Nasdaq", "level": 0, "changePct": 0 }, { "name": "Dow Jones", "level": 0, "changePct": 0 } ], "takeaway": "..." },
      { "region": "Europe", "indices": [ { "name": "SMI", "level": 0, "changePct": 0 }, { "name": "Euro Stoxx 50", "level": 0, "changePct": 0 } ], "takeaway": "..." },
      { "region": "Asia",   "indices": [ { "name": "Nikkei 225", "level": 0, "changePct": 0 }, { "name": "Hang Seng", "level": 0, "changePct": 0 }, { "name": "Shanghai Composite", "level": 0, "changePct": 0 } ], "takeaway": "..." }
    ]
  },
  "tech": [
    { "category": "AI", "title": "...", "url": "https://...", "summary": "..." }
  ]
}

Contraintes STRICTES (le fichier sera rejeté sinon) :
- `worldNews` : exactement 3 éléments.
- `markets.regions` : exactement 3 régions nommées « US », « Europe », « Asia ».
- `tech` : entre 1 et 20 éléments ; chaque `summary` ≤ 150 mots ; `category` ∈ { « IT », « Science », « AI » } ; `url` commence par http(s).
- `level` et `changePct` sont des nombres (pas de chaînes, pas de « % » dans la valeur).
- Le fichier doit être du JSON pur valide (pas de commentaires, pas de texte autour).

Écris le fichier avec l'outil Write à `{{OUTPUT_PATH}}`, puis arrête-toi.
```

- [ ] **Step 2: Sanity-check the placeholders are present**

Run: `node -e "const t=require('fs').readFileSync('prompts/briefing.md','utf8'); console.log(t.includes('{{DATE}}'), t.includes('{{OUTPUT_PATH}}'))"`
Expected: prints `true true`.

- [ ] **Step 3: Commit**

```bash
git add prompts/briefing.md
git commit -m "feat: add Claude research prompt for the briefing"
```

---

## Task 10: Orchestrator (`generate.mjs`)

**Files:**
- Create: `generate.mjs`
- Test: `test/generate-args.test.mjs`

The orchestrator has a pure, testable argument parser plus side-effecting glue. We unit-test the parser and the render-from-existing-data path; the live Claude call is exercised by the manual verification in Task 11.

- [ ] **Step 1: Write the failing test for argument parsing**

Create `test/generate-args.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../generate.mjs';

test('defaults: claude on, no explicit date', () => {
  const o = parseArgs([]);
  assert.equal(o.renderOnly, false);
  assert.equal(o.date, null);
  assert.equal(o.push, true);
});

test('--render-only and --date and --no-push', () => {
  const o = parseArgs(['--render-only', '--date', '2026-06-09', '--no-push']);
  assert.equal(o.renderOnly, true);
  assert.equal(o.date, '2026-06-09');
  assert.equal(o.push, false);
});

test('rejects malformed --date', () => {
  assert.throws(() => parseArgs(['--date', '09-06-2026']));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/generate-args.test.mjs`
Expected: FAIL — cannot find `parseArgs` export.

- [ ] **Step 3: Write `generate.mjs`**

Create `generate.mjs`:

```javascript
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { zurichDate } from './lib/clock.mjs';
import { validateBriefing } from './lib/schema.mjs';
import { writeEdition, rebuildArchive } from './lib/site.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const o = { renderOnly: false, date: null, push: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--render-only') o.renderOnly = true;
    else if (a === '--no-push') o.push = false;
    else if (a === '--date') {
      o.date = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) throw new Error(`--date invalide: ${o.date}`);
    } else throw new Error(`argument inconnu: ${a}`);
  }
  return o;
}

function log(line) {
  const dir = join(ROOT, 'logs');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString();
  appendFileSync(join(dir, 'generate.log'), `${stamp} ${line}\n`);
  console.log(line);
}

function runClaude(date, outPath) {
  const tmpl = readFileSync(join(ROOT, 'prompts', 'briefing.md'), 'utf8');
  const prompt = tmpl.replaceAll('{{DATE}}', date).replaceAll('{{OUTPUT_PATH}}', outPath);
  log(`claude: démarrage de la recherche pour ${date}`);
  const res = spawnSync('claude', [
    '-p',
    '--model', 'opus',
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'json',
  ], { input: prompt, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024, cwd: ROOT });
  if (res.error) throw res.error;
  log(`claude: code de sortie ${res.status}`);
  if (res.status !== 0) log(`claude stderr: ${(res.stderr || '').slice(0, 2000)}`);
  return res;
}

function loadAndValidate(outPath) {
  if (!existsSync(outPath)) throw new Error(`fichier de données absent: ${outPath}`);
  const data = JSON.parse(readFileSync(outPath, 'utf8'));
  const { valid, errors } = validateBriefing(data);
  if (!valid) throw new Error(`validation échouée:\n - ${errors.join('\n - ')}`);
  return data;
}

function gitPublish(date) {
  const run = (args) => {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: true });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} a échoué: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  run(['add', 'docs']);
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8', shell: true }).stdout;
  if (!status.trim()) { log('git: aucun changement à publier'); return; }
  run(['commit', '-m', `briefing: ${date}`]);
  run(['push', 'origin', 'main']);
  log('git: publié sur origin/main');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const date = opts.date || zurichDate();
  const outPath = join(ROOT, 'docs', 'data', `${date}.json`);

  try {
    if (!opts.renderOnly) {
      mkdirSync(dirname(outPath), { recursive: true });
      runClaude(date, outPath);
    }
    const data = loadAndValidate(outPath);
    writeEdition(ROOT, data);
    rebuildArchive(ROOT);
    log(`rendu: site mis à jour pour ${date}`);
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/generate-args.test.mjs`
Expected: PASS. (Importing `generate.mjs` does not run `main()` because of the direct-execution guard.)

- [ ] **Step 5: Verify the render-only path end-to-end with the fixture (no Claude, no push)**

```bash
# Seed docs/data with the fixture, then render from it.
node -e "require('fs').mkdirSync('docs/data',{recursive:true}); require('fs').copyFileSync('test/fixtures/sample.json','docs/data/2026-06-09.json')"
node generate.mjs --render-only --date 2026-06-09 --no-push
```
Expected: exit 0; `docs/index.html`, `docs/editions/2026-06-09.html`, `docs/archive.html` now exist. Open `docs/index.html` in a browser to eyeball the layout.

- [ ] **Step 6: Run the full test suite**

Run: `node --test`
Expected: all tests across all files PASS.

- [ ] **Step 7: Commit**

```bash
git add generate.mjs test/generate-args.test.mjs docs/index.html docs/archive.html docs/editions docs/data
git commit -m "feat: add orchestrator with render-only and publish paths"
```

---

## Task 11: Live Claude smoke test (manual)

**Files:** none (produces a real `docs/data/<today>.json`)

- [ ] **Step 1: Run a real generation without pushing**

Run: `node generate.mjs --no-push`
Expected: Claude researches the day, writes `docs/data/<today>.json`, validation passes, the site re-renders. If validation fails, read `logs/generate.log`, inspect the JSON file, and refine `prompts/briefing.md` (e.g. tighten the schema instructions), then re-run. Repeat until it validates.

- [ ] **Step 2: Eyeball today's output**

Open `docs/index.html` in a browser. Confirm: weather for both cities, 3 world headlines, three market blocks with numbers, tech items grouped by category, all in French, no emoji, readable on a narrow (iPhone-width) window.

- [ ] **Step 3: Commit the first real edition**

```bash
git add docs
git commit -m "content: first generated briefing edition"
```

---

## Task 12: Connect the remote and publish to GitHub Pages

**Files:** none (git + GitHub settings)

- [ ] **Step 1: Add the remote**

```bash
git remote add origin https://github.com/jnury/MorningBriefing.git
git remote -v
```
Expected: `origin` points at the URL (fetch + push).

- [ ] **Step 2: Push main (first push triggers Windows credential prompt)**

```bash
git push -u origin main
```
If prompted, authenticate to GitHub via the Git Credential Manager window (browser sign-in as `jnury`). This caches credentials so the scheduled task can push unattended later. Expected: branch `main` pushed, tracking set.

- [ ] **Step 2b (if the remote already has commits and the push is rejected):** integrate then re-push:

```bash
git pull --rebase origin main
git push -u origin main
```

- [ ] **Step 3: Enable GitHub Pages (deploy from branch → main / docs)**

In a browser: GitHub → repo `jnury/MorningBriefing` → **Settings → Pages** → "Build and deployment" → Source = **Deploy from a branch** → Branch = **main**, folder = **/docs** → Save.

- [ ] **Step 4: Verify the site is live**

Wait ~1 minute, then open `https://jnury.github.io/MorningBriefing/`.
Expected: today's briefing renders. Click "Archives" → archive lists the edition; click it → the permalink loads. Confirm CSS is applied (inlined, so it must work even though the site is served under `/MorningBriefing/`).

---

## Task 13: Schedule the daily 05:00 run (Windows Task Scheduler)

**Files:**
- Create: `schedule.ps1`

- [ ] **Step 1: Create `schedule.ps1`**

```powershell
# Registers (or re-registers) the daily 05:00 Morning Briefing task.
# Run once from an elevated PowerShell in the repo root: powershell -ExecutionPolicy Bypass -File .\schedule.ps1

$ErrorActionPreference = 'Stop'

$repo = $PSScriptRoot
$node = (Get-Command node).Source
$taskName = 'MorningBriefing'

$action = New-ScheduledTaskAction -Execute $node -Argument 'generate.mjs' -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 5:00am

# StartWhenAvailable = catch up after a missed 05:00 (e.g. PC was off).
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Generate and publish the daily morning briefing' -Force

Write-Host "Scheduled task '$taskName' registered for 05:00 daily (StartWhenAvailable)."
```

- [ ] **Step 2: Register the task**

Run (in PowerShell, from `<repo>`): `powershell -ExecutionPolicy Bypass -File .\schedule.ps1`
Expected: prints the confirmation line. (Runs under your user account; the task needs the user logged in or "run whether user is logged on" — adjust in Task Scheduler UI if you want it to run while logged off, which also requires storing your password.)

- [ ] **Step 3: Verify the task exists and dry-run it**

```powershell
Get-ScheduledTask -TaskName 'MorningBriefing'
Start-ScheduledTask -TaskName 'MorningBriefing'
```
Expected: task listed as `Ready`; starting it generates today's edition and pushes (watch `logs/generate.log` and the live site). 

- [ ] **Step 4: Commit**

```bash
git add schedule.ps1
git commit -m "chore: add Windows Task Scheduler registration script"
git push
```

---

## Task 14: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Morning Briefing

Personal daily briefing (French) — weather for Geneva & Lausanne, 3 world headlines,
US/Europe/Asia market tendencies, and up to 20 IT/Science/AI items. Generated locally
every morning at 05:00 (Europe/Zurich) and published to GitHub Pages.

**Live site:** https://jnury.github.io/MorningBriefing/

## How it works

`generate.mjs` (run by Windows Task Scheduler) calls `claude -p` (Opus) to research the
day and write a schema-validated JSON file to `docs/data/<date>.json`. A pure renderer
turns that JSON into static HTML under `docs/` (served by Pages from `main` → `/docs`).
Invalid or missing data aborts before any push, so the live site never breaks.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Run the unit tests (`node --test`). |
| `node generate.mjs` | Full run: research → render → commit → push. |
| `node generate.mjs --no-push` | Generate + render locally, don't push. |
| `node generate.mjs --render-only --date YYYY-MM-DD` | Re-render from an existing `docs/data/<date>.json`. |

## Layout

- `generate.mjs` — orchestrator / scheduler entry point
- `prompts/briefing.md` — the research prompt (placeholders `{{DATE}}`, `{{OUTPUT_PATH}}`)
- `lib/schema.mjs` — JSON contract validator
- `lib/render.mjs` — pure HTML renderers (inline CSS)
- `lib/site.mjs` — writes pages + rebuilds the archive
- `lib/clock.mjs` — Europe/Zurich date
- `docs/` — the published site (`index.html`, `editions/`, `archive.html`, `data/`)
- `schedule.ps1` — registers the 05:00 scheduled task

## Troubleshooting

- A run failed → check `logs/generate.log`; inspect `docs/data/<date>.json`; refine
  `prompts/briefing.md` if the model's output keeps missing the schema.
- Push fails unattended → run `git push` once manually so Git Credential Manager caches
  your GitHub credentials.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
git push
```

---

## Self-review notes (coverage check against the spec)

- Weather (Geneva + Lausanne, Open-Meteo) → Tasks 9 (prompt), 6 (render), 3 (validate). ✓
- 3 world news, one sentence → schema enforces exactly 3 (Task 3); rendered (Task 6). ✓
- Markets, key indices with numbers, US/Europe(SMI+Euro Stoxx 50)/Asia → Tasks 2/3/6/9. ✓
- Up to 20 IT/Science/AI items, ≤150 words, by importance → schema cap + word-count (Task 3); prompt asks for importance order (Task 9). ✓
- Modern-minimal, no cards/emoji, responsive → CSS + emoji test (Tasks 5, 6). ✓
- Home = today, archive of past editions → Tasks 7, 8. ✓
- Local scheduled task, 05:00, catch-up → Task 13 (StartWhenAvailable). ✓
- Claude Code headless, Opus → Task 10 (`runClaude`). ✓
- Git personal identity + existing repo + Pages main/docs → already configured (spec commit) + Task 12. ✓
- Fail-safe (no broken publish) → Task 10 validation gate before `gitPublish`. ✓
```
