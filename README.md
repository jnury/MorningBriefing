# Morning Briefing

Personal daily briefing (French), generated locally every morning at 05:00
(Europe/Zurich) and published to GitHub Pages as one or more **editions** — each reader
gets their own configurable mix of sections (weather with icons, Swiss/world headlines,
market indices, IT/Science/AI, sport, …), while shared topics are researched only once
per day regardless of how many editions read them. Every news item carries a verified
`publishedAt` date and the schema rejects anything older than its topic's configured
limit, so no edition can ever publish stale news. Dark mode is the default, with a
toggle.

**Live site:** https://jnury.github.io/MorningBriefing/

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

## Troubleshooting

- A run failed → check `logs/generate.log`; inspect the raw research under
  `buckets/<date>/<bucketId>.json` and, per edition, the composed data at
  `docs/e/<id>/data/<date>.json`; refine `prompts/collect.md` (research) or
  `prompts/select.md` (editorial selection) if the model's output keeps
  missing the schema.
- Push fails unattended → run `git push` once manually so Git Credential Manager caches
  your GitHub credentials.
