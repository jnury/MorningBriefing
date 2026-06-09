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
  if (!isNum(c.weathercode)) errors.push(`${where}.weathercode doit être un nombre`);
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
  if (!isStr(m.summary)) errors.push('markets.summary manquant');
  const REQUIRED_INDICES = ['Nasdaq', 'Dow Jones', 'SMI', 'Euro Stoxx 50'];
  if (!Array.isArray(m.indices) || m.indices.length !== 4) {
    errors.push('markets.indices doit contenir exactement 4 indices');
  } else {
    const names = m.indices.map((idx) => idx && idx.name);
    for (const req of REQUIRED_INDICES) {
      if (!names.includes(req)) errors.push(`markets.indices: ${req} manquant`);
    }
    m.indices.forEach((idx, i) => {
      if (!idx || typeof idx !== 'object') { errors.push(`markets.indices[${i}] invalide`); return; }
      if (!isStr(idx.name)) errors.push(`markets.indices[${i}].name manquant`);
      if (!isNum(idx.changePct)) errors.push(`markets.indices[${i}].changePct invalide`);
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
