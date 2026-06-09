# Personal Morning Briefing — Design Spec

**Date:** 2026-06-09
**Author:** Julien Nury (julien@nury.ch)
**Status:** Approved design, ready for implementation planning

## 1. Purpose

A personal, automatically-generated **morning briefing** published as a static
website. Every morning at 05:00 (Europe/Zurich) a local scheduled task generates
the day's edition and pushes it to GitHub Pages. The home page is always today's
briefing; past editions are reachable from an archive page.

The briefing is written in **French** and contains, in order:

1. **Weather** for today in **Geneva** and **Lausanne**.
2. **3 major world news** items — one sentence maximum each.
3. **Market tendencies** — key indices with numbers for **US**, **Europe**, **Asia**.
4. **Tech news** — up to **20** items across **IT / Science / AI**, ordered by
   importance, each with a summary of **≤150 words** and a source link.

## 2. Core architecture

Research is **non-deterministic** (done by Claude); rendering is **deterministic**
(a pure template function). The two are separated by a **validated JSON contract**
so the AI's output is isolated behind a schema, and the page can be developed and
tested without spending tokens.

```
Windows Task Scheduler — 05:00 Europe/Zurich, daily
        │
        ▼
   node generate.mjs                      (single orchestrator; Node 24)
        │
        ├─ 1. claude -p (WebSearch/WebFetch/Write)
        │        → data/YYYY-MM-DD.json   (schema-validated)
        │
        ├─ 2. render: JSON + template
        │        → docs/index.html                 (today)
        │        → docs/editions/YYYY-MM-DD.html    (permalink)
        │        → docs/archive.html                (all editions, newest first)
        │        → docs/style.css
        │
        └─ 3. git add / commit / push    → GitHub Pages (main / docs) serves it
```

**Failure rule:** if step 1 fails or the JSON does not validate against the schema,
the run **aborts before any git push**. Yesterday's edition stays live; nothing
broken is ever published. The error is logged to `logs/`.

## 3. Components

| Path | Responsibility |
| --- | --- |
| `generate.mjs` | Orchestrator + entry point for Task Scheduler. Calls Claude, validates, renders, commits, pushes. |
| `prompts/briefing.md` | Instructions handed to `claude -p`: research scope, French tone, the exact JSON schema to emit, and the content rules (≤20 items, ≤150 words, order by importance). |
| `lib/schema.mjs` | JSON schema + validator — the contract between Claude and the renderer. |
| `lib/render.mjs` | Pure function `(data) → htmlPages`. No side effects; unit-testable. |
| `template/` | HTML skeleton + `style.css` (modern minimal, responsive). |
| `docs/` | **Published site** (served by GitHub Pages): `index.html`, `editions/`, `archive.html`, `style.css`, `data/`. |
| `data/` (under `docs/`) | One `YYYY-MM-DD.json` per edition; also the source of truth the archive is rebuilt from each run. |
| `test/fixtures/sample.json` | A representative edition for offline renderer development/tests. |
| `logs/` | Per-run logs; failed runs leave a trail without touching the live site. |

> Note: `data/*.json` lives under `docs/` so editions are self-describing and the
> archive can be rebuilt by scanning the folder. (Final placement — under `docs/`
> vs repo root — to be confirmed in the plan; default: under `docs/`.)

## 4. Content & data sources

### Weather
- **Open-Meteo** API (free, no API key). Geneva (46.20, 6.14), Lausanne (46.52, 6.63).
- Today's high/low, conditions, precipitation probability. Fetched by Claude via
  WebFetch (deterministic JSON endpoint).

### 3 world news
- One sentence maximum each, French, ordered by importance.

### Markets (key indices with numbers)
- **US:** S&P 500, Nasdaq, Dow Jones
- **Europe:** **SMI**, **Euro Stoxx 50**
- **Asia:** Nikkei 225, Hang Seng, Shanghai Composite
- Each region: the index levels + % change, plus a one-line takeaway.
- Labelled **"as of last close"** with retrieval timestamp.

### Tech news (IT / Science / AI)
- Up to **20** items total, grouped by category, **ordered by importance**.
- Each item: title, source link, French summary of **≤150 words**.
- TLDR-style structure (reference: `Examples/`), but **no emojis and no cards**.

## 5. Visual design

- **Modern minimal.** Single column, generous whitespace, system sans-serif,
  strong typographic hierarchy. **No emoji section headers, no boxed cards.**
- **Responsive** — comfortable reading on desktop and iPhone.
- Slim header: edition date + link to the archive. Sections flow as headed text
  blocks (Weather → World → Markets → IT → Science → AI).
- `frontend-design` skill handles visual polish during implementation.

## 6. Error handling & resilience

- **Schema-validation gate** before any git operation; invalid output aborts the run.
- **Idempotent per day:** re-running for the same date overwrites that date's
  edition and re-renders the home page and archive.
- Weather/markets carry retrieval time and "last close" caveats.
- All runs (success or failure) write a log to `logs/`.

## 7. Testing

- `lib/render.mjs` is a **pure function** → unit-tested against
  `test/fixtures/sample.json`, no Claude calls, no network.
- Schema validator tested with valid and intentionally-malformed fixtures.
- The page design can be iterated entirely offline using the fixture.

## 8. Git & publishing

- `git init` in this repo; set **local** (repo-scoped) identity so global/work
  config is untouched:
  - `user.name = Julien Nury`
  - `user.email = julien@nury.ch`
- Wire up the **existing** GitHub remote (URL to be provided during implementation).
- **GitHub Pages: deploy from branch → `main` / `/docs` folder.** No GitHub Actions
  build; the site is pre-rendered locally and pushed.

## 9. Scheduling

- **Windows Task Scheduler**, daily at **05:00 Europe/Zurich**, action:
  `node <repo>\generate.mjs`. Runs whether or not Claude Code is open; depends on
  the PC being powered on at that time (accepted trade-off of the local model).

## 10. Open items to confirm during planning

1. GitHub remote URL of the existing repo.
2. Exact `claude -p` invocation flags (allowed tools, model, headless output mode).
3. Final location of `data/` (under `docs/` vs repo root).
4. Behaviour if the PC is off at 05:00 (catch-up on next wake vs skip).
```
