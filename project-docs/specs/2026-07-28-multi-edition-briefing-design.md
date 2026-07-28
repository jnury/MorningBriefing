# Multi-Edition Morning Briefing — Design Spec

**Date:** 2026-07-28
**Author:** Julien Nury
**Status:** Approved design, ready for implementation planning
**Supersedes:** parts of `2026-06-09-morning-briefing-design.md` (single-edition pipeline)

## 1. Purpose

Today the repository produces exactly one briefing, for one reader. A colleague
wants his own edition, with his own sections and his own editorial taste. This
spec generalises the system to **N editions** while keeping the research cost
proportional to the number of **distinct topics**, not to the number of readers.

The guiding rule: **two editions that share a topic read from the same bucket of
researched candidates, and differ only in how they cut it.**

Three things vary between editions:

1. **Which sections appear** — Carlos has no markets section, but has a sport one.
2. **Section parameters** — weather for Zurich rather than Geneva and Lausanne;
   a different set of market indices; a different item count.
3. **Editorial preference within a section** — the same tech bucket, cut
   AI-first for one reader and cybersecurity-first for another.

Language, tone and layout do **not** vary. Every edition is French, and every
edition uses the same renderer and stylesheet.

## 2. Core architecture

Four stages replace today's single run:

```
config/editions/*.json
        │
        ▼
     PLAN        resolve which buckets are needed, with which collection params
        │
        ▼
     COLLECT     one Claude run per bucket, in parallel (cap 4 concurrent)
        │        → buckets/<date>/<bucketId>.json   (gitignored scratch)
        ▼
     COMPOSE     per edition × per section: select from the bucket
        │        → docs/e/<id>/data/<date>.json     (validated)
        ▼
     PUBLISH     render pages + per-edition archives + landing, one commit
```

The June design's central principle is preserved: research is non-deterministic,
rendering is deterministic, and the two are separated by a validated JSON
contract. The change is that there are now **two** contracts — the bucket
contract (between collection and selection) and the edition contract (between
selection and rendering).

### 2.1 Module kinds

Sections are classified by **how they are collected** and **how they are
selected**. This is the main modularity axis.

| kind | collect | select | examples |
| --- | --- | --- | --- |
| `provider` | HTTP fetch | deterministic, from config | `weather` (Open-Meteo) |
| `dataset` | one Claude run | deterministic, from config | `markets` |
| `topic` | one Claude run | Claude editor pass | `swiss`, `world`, `tech`, `sport` |

Only `topic` sections need a per-edition LLM call. `weather` and `markets` cost
zero extra tokens per edition:

- **weather** — collection fetches the union of every city any edition requests,
  in one Open-Meteo call per city. An edition then picks its cities by name.
- **markets** — one Claude run collects the union of every index any edition
  requests. An edition picks its indices by name, in its configured order.

### 2.2 Bucket identity and sharing

```
bucketId = topic id
```

There is exactly **one bucket per topic per day**, and nothing an edition
declares can split it. Editorial preferences are selection concerns, so
"AI-heavy" and "cybersecurity-heavy" read the same `tech` bucket. Collection
parameters (weather cities, market indices) are gathered as the **union** across
every consuming edition and fed into that single bucket, so a shared bucket
stays shared no matter how the parameters differ.

To keep a shared bucket wide enough for every consumer, the collect prompt is
assembled from the topic definition plus the **union of the `hints` declared by
every edition using it**. The `tech` bucket for the two editions below is
researched with the union `[IA, modèles de langage, cloud, cybersécurité, CVE,
ransomware, Kubernetes]`, so both readers find what they care about in the same
candidate list.

**Bucket size is derived, never hand-tuned**, for `topic` buckets:

```
bucketSize = max(topic.bucketMin, ceil(largestConsumerMax × 2.5))
```

where `largestConsumerMax` is the greatest `max` declared by any edition using
that topic. An edition asking for 30 tech items automatically widens the bucket
for everyone. The 2.5 over-collection factor absorbs the freshness filter, which
historically discards a large fraction of candidates.

`provider` and `dataset` buckets have no `max` and no derived size — their
content is fully determined by the union of collection parameters.

A section referencing a topic id that has no definition under `config/topics/`
is a **configuration error**: the run aborts at the plan stage, before any Claude
call, rather than silently omitting the section.

### 2.3 Item shapes

Exactly two rendered shapes, so the renderer and validator stay generic:

- **`headline`** — `{ headline, publishedAt, url? }` (Swiss and world style)
- **`card`** — `{ title, url, publishedAt, summary, category? }` (tech style,
  with an optional category badge)

A topic declares which shape it produces. `weather` and `markets` keep bespoke
renderers, as they are not lists of news items.

## 3. Configuration

Three layers, all under `config/`, all committed to the repository.

**Decision:** `config/` is committed rather than local-only. Edition preferences
are not secret and the published site is public. If this is ever unwanted, the
edition files move to a gitignored local file, as `config.local.json` already
does for git identity — a one-line change to the loader.

### 3.1 `config/house.md`

Rules inherited by every collect prompt, written once instead of copy-pasted per
topic: French output; English research for tech, science and markets; the
freshness contract; and the rule never to cite a recap or digest page as the
final `url`, always the primary source.

### 3.2 Topic definitions — `config/topics/<id>.json`

```json
{
  "id": "tech",
  "kind": "topic",
  "label": "Tech / Science / IA",
  "shape": "card",
  "categories": ["IT", "Science", "AI"],
  "bucketMin": 30,
  "maxAgeDays": 2,
  "summaryMaxWords": 150,
  "research": "Actualités en informatique, science et IA de la veille.",
  "sources": [
    "archives datées d'éditeurs (techcrunch.com/2026/MM/JJ/)",
    "blogs officiels des entreprises",
    "ScienceDaily",
    "bulletins de sécurité"
  ]
}
```

```json
{
  "id": "swiss",
  "kind": "topic",
  "label": "Suisse",
  "shape": "headline",
  "bucketMin": 10,
  "maxAgeDays": 2,
  "research": "Actualités suisses importantes de la veille.",
  "sources": ["RTS", "Le Temps", "24 heures", "Tribune de Genève", "swissinfo", "Keystone-ATS"],
  "editorial": "Aucun fait divers (crimes, accidents, drames individuels, affaires judiciaires de personnes privées). Privilégier les bonnes nouvelles et les sujets constructifs."
}
```

The `editorial` field carries the standing editorial line for a topic. It is
applied at **collection** time, so it constrains every edition that consumes the
bucket and cannot be forgotten by an individual edition's preferences.

### 3.3 Edition definitions — `config/editions/<id>.json`

Array order is render order.

```json
{
  "id": "main",
  "title": "Morning Briefing",
  "sections": [
    { "topic": "weather", "params": { "cities": [
        { "name": "Genève",   "lat": 46.20, "lon": 6.14 },
        { "name": "Lausanne", "lat": 46.52, "lon": 6.63 } ] } },
    { "topic": "swiss",   "max": 3, "prefs": "Priorité Genève et Lausanne, puis Suisse romande et Confédération." },
    { "topic": "world",   "max": 3 },
    { "topic": "markets", "params": { "indices": ["Nasdaq", "Dow Jones", "SMI", "Euro Stoxx 50"] } },
    { "topic": "tech",    "max": 20,
      "prefs": "Équilibre IT/Science/IA, léger penchant IA.",
      "hints": ["IA", "modèles de langage", "cloud"] }
  ]
}
```

```json
{
  "id": "carlos",
  "title": "Briefing de Carlos",
  "sections": [
    { "topic": "weather", "params": { "cities": [{ "name": "Zurich", "lat": 47.37, "lon": 8.54 }] } },
    { "topic": "world",   "max": 5, "prefs": "Accent sur l'Amérique latine et l'Europe." },
    { "topic": "tech",    "max": 10,
      "prefs": "Cybersécurité d'abord, puis infrastructure et cloud. Peu d'IA générative.",
      "hints": ["cybersécurité", "CVE", "ransomware", "Kubernetes"] },
    { "topic": "sport",   "max": 3 }
  ]
}
```

**`hints` feed collection; `prefs` feed selection.** This separation is what
makes one research run serve several editorial cuts.

Adding a new topic such as `sport` requires **no code**: a topic JSON file and a
section entry in whichever editions want it.

## 4. Data contracts

### 4.1 Bucket contract — `buckets/<date>/<bucketId>.json`

```json
{
  "bucketId": "tech",
  "date": "2026-07-28",
  "collectedAt": "2026-07-28T05:02:41+02:00",
  "shape": "card",
  "items": [
    { "category": "AI", "title": "…", "url": "https://…", "publishedAt": "2026-07-27", "summary": "…" }
  ]
}
```

Items are ordered by the researcher's assessment of importance. Every item is
freshness-checked against `topic.maxAgeDays` at validation time, exactly as
today. A bucket that fails validation is a failed bucket (see §6).

### 4.2 Edition contract — `docs/e/<id>/data/<date>.json`

```json
{
  "edition": "main",
  "title": "Morning Briefing",
  "date": "2026-07-28",
  "generatedAt": "2026-07-28T05:04:12+02:00",
  "sections": [
    { "topic": "weather", "label": "Météo", "kind": "provider",
      "cities": [ { "name": "Genève", "high": 24, "low": 13, "condition": "Ensoleillé", "weathercode": 0, "precipProbability": 10 } ] },
    { "topic": "swiss", "label": "Suisse", "kind": "topic", "shape": "headline",
      "items": [ { "headline": "…", "publishedAt": "2026-07-27" } ] },
    { "topic": "markets", "label": "Marchés", "kind": "dataset",
      "asOf": "clôture du 27 juillet 2026",
      "summary": "…",
      "indices": [ { "name": "Nasdaq", "changePct": 0.42 } ] },
    { "topic": "tech", "label": "Tech / Science / IA", "kind": "topic", "shape": "card",
      "degraded": false,
      "items": [ { "category": "AI", "title": "…", "url": "https://…", "publishedAt": "2026-07-27", "summary": "…" } ] }
  ]
}
```

Every section carries `topic`, `label` and `kind`. Sections of kind `topic`
additionally carry `shape` and an `items` array, and may carry `degraded`;
`provider` and `dataset` sections carry their own bespoke fields as shown. The
renderer dispatches on `kind`, then on `shape` for topics.

The section array mirrors the edition config, so rendering is a loop rather than
a fixed template. **A section that failed is simply absent from the array** —
this is what makes partial publication fall out of the data model instead of
requiring special cases in the renderer.

### 4.3 Generic validation

`lib/schema.mjs` stops hard-coding `swissNews`, `worldNews` and `tech`. It
validates each section against its topic config: shape conformance, item count
against `max`, freshness against `maxAgeDays`, and `summary` length against
`summaryMaxWords`. Adding a topic requires no validator change.

## 5. Site layout

```
docs/
  index.html                      landing page: one card per edition → today's briefing
  e/main/index.html               today (main)
        archive.html
        2026-07-28.html
        data/2026-07-28.json
  e/carlos/index.html
           archive.html
           2026-07-28.html
           data/2026-07-28.json
```

`docs/index.html` becomes the landing page listing available editions. Each
edition owns its own home page, archive and data directory.

The landing page shows one card per edition, in the order the edition files are
discovered on disk: the edition `title`, the date of its most recent published
edition, and links to that edition's home page and archive. It is rebuilt on
every run from whatever exists under `docs/e/`, in the same way the archive is
rebuilt today — so an edition that failed this morning still appears, showing its
last good date.

### 5.1 Migration of existing editions

`tools/migrate-legacy.mjs`, run once:

1. Read each `docs/data/<date>.json` (flat legacy shape).
2. Map mechanically: `weather` → weather section, `swissNews` → swiss section,
   `worldNews` → world, `markets` → markets, `tech` → tech.
3. Write to `docs/e/main/data/<date>.json` in the new shape.
4. Re-render all pages plus `docs/e/main/archive.html` and the new landing page.
5. Delete `docs/data/`, `docs/editions/`, and the old root `index.html` /
   `archive.html`.

No redirects and no permalink preservation — old URLs break, which is accepted.
After the migration commit the script is deleted; git history preserves it and
it has no recurring use. The renderer therefore never carries a legacy branch.

## 6. Failure handling

The policy is **publish what succeeded, log the rest**.

| Stage | Failure | Behaviour |
| --- | --- | --- |
| Collect | non-zero exit, missing file, or invalid bucket JSON | bucket marked failed and logged; other buckets unaffected |
| Compose | consuming a failed bucket | section omitted from the edition |
| Compose | editor pass fails or returns invalid JSON | fall back to the bucket's own importance ordering, top `max` items; section flagged `degraded: true` and rendered with a discreet note |
| Compose | edition ends with zero sections | edition skipped entirely |
| Publish | nothing rendered at all | no commit; site keeps yesterday's editions |

The degraded fallback is safe because the bucket was already collected under the
topic's `editorial` rules, so a transient selection failure cannot smuggle in
material the editorial line forbids. It costs one blank section avoided per
hiccup.

Each run appends a summary line to `logs/generate.log`: which buckets succeeded,
which editions published, and which sections were degraded.

## 7. Command-line interface

| Command | Effect |
| --- | --- |
| `node generate.mjs` | All editions: plan → collect → compose → publish |
| `node generate.mjs --edition carlos` | That edition only; collects just the buckets it needs |
| `node generate.mjs --recompose --date X` | Re-run editor passes from existing local buckets — cheap prompt iteration |
| `node generate.mjs --render-only --date X` | Re-render from stored edition JSON; no LLM call |
| `node generate.mjs --no-push` | Generate and render locally without pushing |

Buckets are written to `buckets/<date>/` and gitignored. They are scratch rather
than site content, but keeping them locally is what makes `--recompose` cheap.

## 8. Module layout

```
generate.mjs              orchestrator: plan → collect → compose → publish
lib/config.mjs            load and validate topic + edition configs
lib/plan.mjs              bucket resolution, hint union, derived bucket sizes
lib/collect.mjs           run collectors (provider fetch / Claude run), concurrency cap
lib/compose.mjs           per-edition selection; deterministic and LLM paths
lib/prompt.mjs            pure prompt assembly (config in → string out)
lib/schema.mjs            generic bucket + edition validation, driven by topic config
lib/render.mjs            pure renderers: shapes, weather, markets, page, landing, archive
lib/site.mjs              write per-edition pages, archives, landing page
lib/clock.mjs             Europe/Zurich date (unchanged)
prompts/collect.md        parameterised collector prompt template
prompts/select.md         parameterised editor prompt template
config/house.md           rules inherited by every collect prompt
config/topics/*.json      topic definitions
config/editions/*.json    edition definitions
tools/migrate-legacy.mjs  one-shot migration, deleted after use
```

## 9. Testing

Everything stays network-free and unit-testable, because prompt assembly is a
pure function from config to string.

- **plan** — bucket union, hint union, derived bucket sizes from fixture configs
- **prompt assembly** — collect and select prompts built from fixture configs
- **schema** — generic validation per shape and per topic config; freshness;
  summary word limits
- **render** — both item shapes, weather, markets, landing page, per-edition
  archive
- **migration** — legacy fixture converts to the expected new shape
- **degradation** — missing bucket omits the section; failed editor pass falls
  back to bucket ordering with `degraded: true`
- **CLI** — argument parsing including `--edition` and `--recompose`

Existing tests (`schema`, `render-*`, `site`, `generate-args`) are updated rather
than replaced.

## 10. Cost and runtime

Today: one long Opus run. After: roughly four to five short Opus runs, one per
distinct topic bucket, executed in parallel with a concurrency cap of four; plus
one small Sonnet call per edition × `topic` section.

Wall-clock should be comparable or better, since buckets run in parallel and
each prompt is short enough to be followed properly. Token spend grows with the
number of **distinct topics**, not with the number of editions — adding a third
reader who wants the same sections as an existing one costs only that reader's
selection calls.

## 11. Out of scope

- Per-edition language, tone or layout — all editions remain French and share
  one stylesheet.
- Email delivery — editions are published as pages only.
- Access control — the site stays public; editions are unlisted only in the
  sense that the landing page is the single entry point.
- Redirects from the old URL structure.
