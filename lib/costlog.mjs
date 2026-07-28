import { addUsage, emptyUsage } from './usage.mjs';

const money = (v) => (v == null ? 'n/d' : `$${v.toFixed(4)}`);
const n = (v) => (v == null ? 'n/d' : String(v));
const seconds = (ms) => (ms == null ? 'n/d' : `${(ms / 1000).toFixed(1)}s`);

function usageLine(label, entry) {
  const u = entry.usage;
  const status = entry.ok ? 'OK' : 'ÉCHEC';
  return `coût ${label} ${status} — ${money(u.costUsd)}, ${n(u.numTurns)} tour(s), `
    + `${n(u.inputTokens)} entrée / ${n(u.outputTokens)} sortie `
    + `(cache ${n(u.cacheReadInputTokens)} lus / ${n(u.cacheCreationInputTokens)} créés), `
    + `${n(u.webSearchRequests)} recherche(s) web, ${n(u.webFetchRequests)} fetch(s), ${seconds(entry.durationMs)}`;
}

export function bucketCostLine(entry) {
  return usageLine(`collecte ${entry.id}`, entry);
}

export function selectionCostLine(entry) {
  return usageLine(`sélection ${entry.edition}/${entry.topic}`, entry);
}

export function totalsLine(date, totals, stageDurations) {
  const stages = Object.entries(stageDurations).map(([k, ms]) => `${k} ${seconds(ms)}`).join(', ');
  return `coût total ${date} — ${money(totals.costUsd)}, ${n(totals.numTurns)} tour(s), `
    + `${n(totals.inputTokens)} entrée / ${n(totals.outputTokens)} sortie, `
    + `${n(totals.webSearchRequests)} recherche(s) web, ${n(totals.webFetchRequests)} fetch(s) — durées : ${stages}`;
}

const flattenBucket = (b) => ({ id: b.id, kind: b.kind, ok: b.ok, durationMs: b.durationMs ?? null, ...b.usage });
const flattenSelection = (s) => ({
  edition: s.edition, topic: s.topic, ok: s.ok, durationMs: s.durationMs ?? null, ...s.usage,
});

// One flat JSON object per run, appended to logs/costs.jsonl. Flat per-entry
// fields (rather than a nested `usage` object) so a later question like
// "what did the tech bucket cost each day this month" is a one-line filter —
// e.g. `jq 'select(.date >= "2026-07-01") | .buckets[] | select(.id=="tech")'`
// — without unpacking a nested shape first.
export function buildCostRecord({ date, timestamp, buckets, selections, stageDurations }) {
  const totals = [...buckets, ...selections].reduce((acc, e) => addUsage(acc, e.usage), emptyUsage());
  return {
    date,
    timestamp,
    buckets: buckets.map(flattenBucket),
    selections: selections.map(flattenSelection),
    totals,
    stageDurations,
  };
}
