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
