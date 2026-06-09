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
  const promptPath = outPath.replaceAll('\\', '/');
  const prompt = tmpl.replaceAll('{{DATE}}', date).replaceAll('{{OUTPUT_PATH}}', promptPath);
  log(`claude: démarrage de la recherche pour ${date}`);
  const res = spawnSync(
    'claude -p --model opus --permission-mode bypassPermissions --output-format json',
    { input: prompt, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024, cwd: ROOT },
  );
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
  const run = (cmd) => {
    const r = spawnSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: true });
    if (r.status !== 0) throw new Error(`${cmd} a échoué: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  run('git add docs');
  const status = spawnSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8', shell: true }).stdout;
  if (!status.trim()) { log('git: aucun changement à publier'); return; }
  run(`git commit -m "briefing: ${date}"`);
  run('git push origin main');
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
