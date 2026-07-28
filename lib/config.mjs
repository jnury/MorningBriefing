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
