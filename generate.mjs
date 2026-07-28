import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { zurichDate } from './lib/clock.mjs';
import { loadConfig } from './lib/config.mjs';
import { planBuckets } from './lib/plan.mjs';
import { collectAll, bucketPath, runClaudeCollect } from './lib/collect.mjs';
import { composeEdition } from './lib/compose.mjs';
import { validateEditionData, validateBucket } from './lib/schema.mjs';
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

// A typo in --edition must fail loudly, not silently shrink the run: every
// requested id has to resolve to a configured edition.
export function resolveEditions(configEditions, editionIds) {
  if (!editionIds) return configEditions;
  const known = new Set(configEditions.map((e) => e.id));
  const unknown = editionIds.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`édition(s) inconnue(s): ${unknown.join(', ')}`);
  return configEditions.filter((e) => editionIds.includes(e.id));
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
// Validated exactly like a freshly collected bucket (collectOne does the same
// check), so this path and the normal collection path leave composeEdition the
// same invariant: every `ok: true` result has already passed validateBucket.
// Without this, a malformed on-disk bucket reached composeEdition unguarded,
// which dereferences `.cities` / `.indices` / `.items` and can throw out of
// the whole run instead of just omitting that section.
export function loadBucketsFromDisk(buckets, date, topics, root = ROOT) {
  const results = new Map();
  for (const b of buckets) {
    const path = bucketPath(root, date, b.id);
    if (!existsSync(path)) { results.set(b.id, { ok: false, error: `vivier absent: ${path}` }); continue; }
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      const { valid, errors } = validateBucket(data, topics[b.id], date);
      if (!valid) { results.set(b.id, { ok: false, error: errors.join(' | ') }); continue; }
      results.set(b.id, { ok: true, data });
    } catch (err) { results.set(b.id, { ok: false, error: err.message }); }
  }
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const date = opts.date || zurichDate();

  try {
    const config = loadConfig(ROOT);
    const editions = resolveEditions(config.editions, opts.editionIds);
    let generationFailed = false;

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
        ? loadBucketsFromDisk(buckets, date, config.topics)
        : await collectAll(buckets, {
            root: ROOT, date, house: config.house, topics: config.topics,
            template: readFileSync(join(ROOT, 'prompts', 'collect.md'), 'utf8'),
            concurrency: 4, runClaude: runClaudeCollect,
          });

      for (const [id, r] of bucketResults) {
        log(r.ok ? `collecte: ${id} OK` : `collecte: ${id} ÉCHEC — ${r.error}`);
      }

      // Select passes are Claude runs of their own (one per edition × topic
      // section); each composeEdition call is independent of the others, so
      // they are started together rather than awaited one edition at a time —
      // the same event-loop-blocking pitfall as collection would otherwise
      // apply here across editions.
      const selectTemplate = readFileSync(join(ROOT, 'prompts', 'select.md'), 'utf8');
      const composed = await Promise.all(editions.map((edition) => composeEdition(edition, {
        root: ROOT, date, topics: config.topics, template: selectTemplate,
        bucketResults, now: () => new Date().toISOString(), log,
      })));

      let published = 0;
      for (const data of composed) {
        const { valid, errors } = validateEditionData(data, config);
        if (!valid) { log(`édition ${data.edition}: NON PUBLIÉE — ${errors.join(' | ')}`); continue; }
        writeEditionPages(ROOT, data);
        log(`édition ${data.edition}: publiée (${data.sections.length} section(s))`);
        published++;
      }
      // Some editions failing while others publish is a partial success — the whole
      // point of per-edition isolation. But nothing published is a failed run: an
      // unattended job that reports OK on a morning with an empty site is worse
      // than one that fails loudly.
      if (published === 0) generationFailed = true;
    }

    // Archives and landing are rebuilt from every configured edition, not just
    // the ones generated this run, so a --edition run never truncates the site.
    for (const edition of config.editions) rebuildEditionArchive(ROOT, edition);
    rebuildLanding(ROOT, config.editions);

    if (opts.push) gitPublish(date);

    if (generationFailed) {
      log(`ÉCHEC: aucune édition publiée pour ${date}`);
      process.exitCode = 1;
    } else {
      log(`OK: briefing ${date} terminé`);
    }
  } catch (err) {
    log(`ERREUR: ${err.message}`);
    process.exitCode = 1;
  }
}

// Only run main when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
