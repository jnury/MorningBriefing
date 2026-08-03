// Pure prompt assembly: configuration in, prompt string out. Keeping this free
// of I/O is what lets every prompt-shaping decision be unit-tested without
// spending a token.

const CARD_SHAPE = `{
  "bucketId": "{{TOPIC_ID}}",
  "date": "{{DATE}}",
  "collectedAt": "{{DATE}}T05:02:00+02:00",
  "shape": "card",
  "items": [
    { "category": "AI", "title": "...", "url": "https://...", "publishedAt": "...", "summary": "..." }
  ]
}`;

const HEADLINE_SHAPE = `{
  "bucketId": "{{TOPIC_ID}}",
  "date": "{{DATE}}",
  "collectedAt": "{{DATE}}T05:02:00+02:00",
  "shape": "headline",
  "items": [
    { "headline": "...", "publishedAt": "..." }
  ]
}`;

const MARKETS_SHAPE = `{
  "bucketId": "{{TOPIC_ID}}",
  "date": "{{DATE}}",
  "collectedAt": "{{DATE}}T05:02:00+02:00",
  "asOf": "clôture du ...",
  "summary": "Une seule phrase de synthèse globale.",
  "indices": [
    { "name": "...", "changePct": 0 }
  ]
}`;

// Replaces every {{KEY}} occurrence, then collapses the blank lines left behind
// by blocks that resolved to an empty string.
//
// The values come from config/ prose the user edits freely (French editorial
// preferences, sources, house rules). replaceAll(search, replacement) still
// scans a literal search string's REPLACEMENT for $$, $&, $`, $' patterns, so
// a preference containing e.g. "$&" would silently corrupt the prompt. A
// replacer function sidesteps that: its return value is inserted literally.
function fill(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, () => String(value ?? ''));
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function outputShape(topic) {
  if (topic.kind === 'dataset') return MARKETS_SHAPE;
  return topic.shape === 'headline' ? HEADLINE_SHAPE : CARD_SHAPE;
}

export function buildCollectPrompt({ template, house, topic, bucket, date, outPath }) {
  const hints = (bucket.hints || []).length
    ? `Centres d'intérêt déclarés par les éditions qui liront ce vivier — assure-toi que chacun soit ` +
      `représenté parmi les candidats : ${bucket.hints.join(', ')}.`
    : '';

  let research = topic.research;
  // The name is repeated back verbatim because compose matches on it. Left
  // free, the collector returns the formal wording ("Nasdaq Composite" for
  // "Nasdaq") and the index silently drops out of the section.
  if (topic.kind === 'dataset' && Array.isArray(bucket.params?.indices)) {
    research += `\n\nIndices demandés, à fournir tous : ${bucket.params.indices.join(', ')}.`
      + `\nDans le champ \`name\`, reprends EXACTEMENT le nom demandé ci-dessus,`
      + ` sans le compléter ni le reformuler.`;
  }

  // Resolved here, before embedding, because by the time OUTPUT_SHAPE is
  // substituted into the outer template the DATE/TOPIC_ID entries have
  // already had their turn in the loop below and won't run again.
  let shape = fill(outputShape(topic), { TOPIC_ID: topic.id, DATE: date });
  if (topic.categories) {
    shape += `\n\n`
      + `Valeurs autorisées pour \`category\` : ${topic.categories.join(', ')}.`;
  }
  // Aim below the cap rather than at it. summaryMaxWords is where validation
  // discards a card, so writing to it leaves no room for the model's own
  // variance: tech summaries sat at 141-154 words against a 150 cap until one
  // finally overshot. The target is what we ask for, the cap is stated as the
  // boundary it must never cross.
  if (topic.summaryMaxWords) {
    const target = topic.summaryTargetWords ?? topic.summaryMaxWords;
    shape += target < topic.summaryMaxWords
      ? `\nChaque \`summary\` vise ${target} mots en français, et ne dépasse en aucun cas ${topic.summaryMaxWords} mots.`
      : `\nChaque \`summary\` fait au maximum ${topic.summaryMaxWords} mots, en français.`;
  }

  return fill(template, {
    DATE: date,
    HOUSE: fill(house, { DATE: date, MAX_AGE_DAYS: topic.maxAgeDays ?? 2 }),
    TOPIC_ID: topic.id,
    TOPIC_LABEL: topic.label,
    RESEARCH: research,
    EDITORIAL: topic.editorial ? `Ligne éditoriale, impérative : ${topic.editorial}` : '',
    HINTS: hints,
    SOURCES: (topic.sources || []).join(' · ') || 'sources primaires de ton choix',
    SIZE: bucket.size ?? '',
    MAX_AGE_DAYS: topic.maxAgeDays ?? 2,
    OUTPUT_SHAPE: shape,
    OUTPUT_PATH: outPath,
  });
}

export function buildSelectPrompt({ template, topic, section, edition, bucketPath, outPath, date }) {
  return fill(template, {
    DATE: date,
    EDITION_TITLE: edition.title,
    TOPIC_LABEL: topic.label,
    // The topic's editorial line is repeated at selection time so an edition's
    // own preferences can never quietly override it.
    EDITORIAL: topic.editorial ? `Ligne éditoriale, impérative et non négociable : ${topic.editorial}` : '',
    PREFS: section.prefs ? `Préférences de cette édition : ${section.prefs}` : '',
    MAX: section.max,
    BUCKET_PATH: bucketPath,
    OUTPUT_PATH: outPath,
  });
}
