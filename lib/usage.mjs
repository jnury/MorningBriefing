// Parses the JSON result object `claude -p --output-format json` prints on
// stdout into a flat, always-present record. This must be total: unparseable
// stdout, valid JSON missing fields, an empty string, or undefined all have
// to produce the same null-filled shape rather than throw — a run that
// cannot be measured must still be allowed to publish.

const FIELDS = [
  'costUsd', 'numTurns', 'inputTokens', 'outputTokens',
  'cacheCreationInputTokens', 'cacheReadInputTokens',
  'webSearchRequests', 'webFetchRequests',
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function emptyUsage() {
  return Object.fromEntries(FIELDS.map((f) => [f, null]));
}

export function parseUsage(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') return emptyUsage();

  let parsed;
  try { parsed = JSON.parse(stdout); } catch { return emptyUsage(); }
  if (!parsed || typeof parsed !== 'object') return emptyUsage();

  const usage = parsed.usage && typeof parsed.usage === 'object' ? parsed.usage : {};
  const serverToolUse = usage.server_tool_use && typeof usage.server_tool_use === 'object'
    ? usage.server_tool_use : {};

  return {
    costUsd: num(parsed.total_cost_usd),
    numTurns: num(parsed.num_turns),
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheCreationInputTokens: num(usage.cache_creation_input_tokens),
    cacheReadInputTokens: num(usage.cache_read_input_tokens),
    webSearchRequests: num(serverToolUse.web_search_requests),
    webFetchRequests: num(serverToolUse.web_fetch_requests),
  };
}

// Sums two usage records field by field, treating "both unknown" as still
// unknown rather than 0 — a run total should not read as a real zero when
// every contributing entry actually failed to report anything.
export function addUsage(a, b) {
  const out = {};
  for (const f of FIELDS) {
    out[f] = (a[f] == null && b[f] == null) ? null : (a[f] ?? 0) + (b[f] ?? 0);
  }
  return out;
}
