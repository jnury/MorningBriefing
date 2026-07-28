// Resolves editions into the set of buckets that must be collected.
//
// There is exactly one bucket per topic per day: nothing an edition declares
// may split a bucket. Collection parameters (weather cities, market indices)
// and research hints are therefore UNIONED across every consuming edition, so
// a single research run serves every editorial cut of it.

// Over-collection factor for researched topics. The freshness filter discards a
// large fraction of candidates, so the bucket must be substantially wider than
// the largest edition's appetite.
export const OVERCOLLECT = 2.5;

function pushUnique(list, value, key) {
  if (!list.some((existing) => key(existing) === key(value))) list.push(value);
}

export function planBuckets(config, { editionIds = null } = {}) {
  const editions = editionIds
    ? config.editions.filter((e) => editionIds.includes(e.id))
    : config.editions;

  const buckets = new Map();

  for (const edition of editions) {
    for (const section of edition.sections) {
      const topic = config.topics[section.topic];
      let bucket = buckets.get(topic.id);
      if (!bucket) {
        bucket = { id: topic.id, kind: topic.kind, hints: [], params: {}, consumers: [] };
        if (topic.kind === 'topic') bucket.size = topic.bucketMin;
        buckets.set(topic.id, bucket);
      }

      bucket.consumers.push(edition.id);
      for (const hint of section.hints || []) pushUnique(bucket.hints, hint, (h) => h);

      for (const [name, value] of Object.entries(section.params || {})) {
        if (!Array.isArray(value)) { bucket.params[name] = value; continue; }
        bucket.params[name] = bucket.params[name] || [];
        // Objects union by their `name` field, plain strings by identity.
        const key = (v) => (v && typeof v === 'object' ? v.name : v);
        for (const entry of value) pushUnique(bucket.params[name], entry, key);
      }

      if (topic.kind === 'topic') {
        bucket.size = Math.max(bucket.size, Math.ceil(section.max * OVERCOLLECT));
      }
    }
  }

  return [...buckets.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}
