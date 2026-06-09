# Morning Briefing

Personal daily briefing (French) — weather (with icons) for Geneva & Lausanne, 3 world
headlines, four key market indices on one line (Nasdaq, Dow Jones, SMI, Euro Stoxx 50),
and up to 20 IT/Science/AI items (each tagged with a category badge). News is restricted
to the day before (never older than 2 days). Generated locally every morning at 05:00
(Europe/Zurich) and published to GitHub Pages.

**Live site:** https://jnury.github.io/MorningBriefing/

## How it works

`generate.mjs` (run by Windows Task Scheduler) calls `claude -p` (Opus) to research the
day and write a schema-validated JSON file to `docs/data/<date>.json`. A pure renderer
turns that JSON into static HTML under `docs/` (served by Pages from `main` → `/docs`).
Invalid or missing data aborts before any push, so the live site never breaks.

The headless Claude run is scoped to only the `WebSearch`, `WebFetch`, and `Write` tools
— enough to research and write the data file, without granting blanket permissions.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Run the unit tests (`node --test`). |
| `node generate.mjs` | Full run: research → render → commit → push. |
| `node generate.mjs --no-push` | Generate + render locally, don't push. |
| `node generate.mjs --render-only --date YYYY-MM-DD` | Re-render from an existing `docs/data/<date>.json` (no Claude call). |

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
