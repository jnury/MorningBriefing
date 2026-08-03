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
import { emptyUsage } from './lib/usage.mjs';
import { bucketCostLine, selectionCostLine, totalsLine, buildCostRecord } from './lib/costlog.mjs';

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

// Never throws: this is called from everywhere, including the publish loop
// itself, so a broken logs/ (unwritable dir, a stray file sitting where the
// directory should be, disk full) must degrade to a console line rather than
// take the run down -- logging must never be able to break what it is only
// supposed to be describing.
function log(line, root = ROOT) {
  try {
    const dir = join(root, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'generate.log'), `${new Date().toISOString()} ${line}\n`);
  } catch (err) {
    console.error(`ERREUR: écriture du journal impossible (${err.message}) : ${line}`);
    return;
  }
  console.log(line);
}

// Turns this run's bucket/selection outcomes into the human log lines and the
// costs.jsonl record. This function does NOT protect itself — mkdirSync/
// appendFileSync can throw (unwritable logs/, disk full, a permissions
// problem) — so it is only ever safe to call from inside the try/catch in
// recordCostsAndPublish below. `buckets` (the planned bucket list, not the
// topic config) supplies `kind` and `consumers` per id, so each bucket entry
// records every edition that shares it — a shared bucket's cost otherwise has
// no way to be attributed to the editions it served.
export function recordCosts({ date, buckets, bucketResults, selections, stageDurations }, root = ROOT) {
  const planned = new Map(buckets.map((b) => [b.id, b]));
  const bucketEntries = [...bucketResults].map(([id, r]) => ({
    id,
    kind: planned.get(id)?.kind ?? null,
    consumers: planned.get(id)?.consumers ?? [],
    ok: r.ok,
    usage: r.usage ?? emptyUsage(),
    durationMs: r.durationMs ?? null,
  }));

  for (const b of bucketEntries) log(bucketCostLine(b), root);
  for (const s of selections) log(selectionCostLine(s), root);

  const record = buildCostRecord({
    date, timestamp: new Date().toISOString(), buckets: bucketEntries, selections, stageDurations,
  });
  log(totalsLine(date, record.totals, stageDurations), root);

  const dir = join(root, 'logs');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'costs.jsonl'), `${JSON.stringify(record)}\n`);
}

// The boundary that actually delivers the "cost logging can never stop a
// briefing" guarantee: recordCosts is wrapped so any failure inside it — I/O
// or otherwise — is logged and swallowed here rather than reaching main()'s
// outer catch, which would abandon every edition already composed before a
// single one got the chance to publish. Only a publish-time failure
// (validation, site write) may suppress a publish after this point.
export function recordCostsAndPublish({
  composed, config, date, buckets, bucketResults, selections, stageDurations, root = ROOT,
}) {
  try {
    recordCosts({ date, buckets, bucketResults, selections, stageDurations }, root);
  } catch (err) {
    log(`ERREUR: enregistrement du coût/usage a échoué (ignoré) : ${err.message}`, root);
  }

  let published = 0;
  for (const data of composed) {
    const { valid, errors } = validateEditionData(data, config);
    if (!valid) { log(`édition ${data.edition}: NON PUBLIÉE — ${errors.join(' | ')}`, root); continue; }
    writeEditionPages(root, data);
    log(`édition ${data.edition}: publiée (${data.sections.length} section(s))`, root);
    published++;
  }
  return published;
}

// The repo is published under an account whose write access lives in a separate
// GitHub login (gh keyring). git uses gh as its credential helper, so the PUSH
// authenticates as whichever account is gh-"active". We flip to the publishing
// account for the push ONLY, then restore whatever was active before — the switch
// is global to the user, so we keep that window as small as possible to avoid
// disrupting any other git/gh work happening on the machine.
const PUBLISH_GH_USER = 'jnury';

// Extracted from ghActiveUser so the parsing logic -- the actual fix -- is
// unit-testable without spawning the real gh binary. `gh auth status` writes
// its human-readable summary to stderr by convention, not stdout, so both
// streams are scanned; a non-zero exit is never treated as a match. Returning
// null here is a hard-error signal to the caller -- it must NOT be read as
// "nothing to restore".
export function parseGhActiveUser(result) {
  if (result.status !== 0) return null;
  const m = `${result.stdout || ''}\n${result.stderr || ''}`.match(/account\s+(\S+)/);
  return m ? m[1] : null;
}

// Returns the currently gh-active account, or null if that could not be
// determined reliably (gh missing, not logged in, unexpected output).
function ghActiveUser() {
  return parseGhActiveUser(spawnSync('gh auth status --active', { cwd: ROOT, encoding: 'utf8', shell: true }));
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
  // Scoped to the docs pathspec: this repo is worked on directly on main, so
  // without it anything else left staged at 05:00 would be swept into the
  // briefing commit and pushed to a public repository unattended.
  run(`git commit -m "briefing: ${date}" -- docs`);

  const previous = ghActiveUser();
  // An indeterminate previous account must stop the publish before any
  // switch happens -- proceeding would risk leaving the machine switched to
  // PUBLISH_GH_USER with no way to know what to restore it to.
  if (previous === null) {
    throw new Error('compte gh actif indéterminable ; publication interrompue avant toute bascule');
  }
  const mustSwitch = previous !== PUBLISH_GH_USER;
  try {
    if (mustSwitch) { ghSwitch(PUBLISH_GH_USER); log(`git: bascule gh ${previous} -> ${PUBLISH_GH_USER}`); }
    run('git push origin main');
    log('git: publié sur origin/main');
  } finally {
    if (mustSwitch) {
      try {
        ghSwitch(previous);
        log(`git: gh restauré -> ${previous}`);
      } catch (err) {
        // A restore failure here must never throw over whatever error (if
        // any) came out of the try block above -- log loudly instead, since
        // the machine is now left switched to PUBLISH_GH_USER with no
        // automatic way back.
        log(`ERREUR: restauration du compte gh a échoué, compte laissé sur ${PUBLISH_GH_USER} : ${err.message}`);
      }
    }
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
      const validated = validateBucket(data, topics[b.id], date);
      if (!validated.valid) { results.set(b.id, { ok: false, error: validated.errors.join(' | ') }); continue; }
      for (const d of validated.dropped) {
        log(`vivier ${b.id} — élément ${d.index} écarté (${d.errors.join(' ; ')})`);
      }
      // The on-disk bucket keeps every candidate the collector wrote; the
      // filtered copy is what composes, so --recompose and a fresh collection
      // hand composeEdition the same already-validated items.
      results.set(b.id, { ok: true, data: validated.data });
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

      const collectStart = Date.now();
      const bucketResults = opts.recompose
        ? loadBucketsFromDisk(buckets, date, config.topics)
        : await collectAll(buckets, {
            root: ROOT, date, house: config.house, topics: config.topics,
            template: readFileSync(join(ROOT, 'prompts', 'collect.md'), 'utf8'),
            concurrency: 4, runClaude: runClaudeCollect, log,
          });
      const collectMs = Date.now() - collectStart;

      for (const [id, r] of bucketResults) {
        log(r.ok ? `collecte: ${id} OK` : `collecte: ${id} ÉCHEC — ${r.error}`);
      }

      // Select passes are Claude runs of their own (one per edition × topic
      // section); each composeEdition call is independent of the others, so
      // they are started together rather than awaited one edition at a time —
      // the same event-loop-blocking pitfall as collection would otherwise
      // apply here across editions.
      const selectTemplate = readFileSync(join(ROOT, 'prompts', 'select.md'), 'utf8');
      const selections = [];
      const composeStart = Date.now();
      const composed = await Promise.all(editions.map((edition) => composeEdition(edition, {
        root: ROOT, date, topics: config.topics, template: selectTemplate,
        bucketResults, now: () => new Date().toISOString(), log,
        recordSelection: (entry) => selections.push(entry),
      })));
      const composeMs = Date.now() - composeStart;

      const published = recordCostsAndPublish({
        composed, config, date, buckets, bucketResults, selections,
        stageDurations: { collectMs, composeMs },
      });
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
