import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, emptyUsage, addUsage } from '../lib/usage.mjs';

const REALISTIC_RESULT = JSON.stringify({
  is_error: false,
  duration_api_ms: 42310,
  num_turns: 4,
  stop_reason: 'end_turn',
  session_id: 'abc123',
  total_cost_usd: 0.1234,
  usage: {
    input_tokens: 1200,
    output_tokens: 340,
    cache_creation_input_tokens: 8000,
    cache_read_input_tokens: 500,
    server_tool_use: { web_search_requests: 3, web_fetch_requests: 1 },
  },
  permission_denials: [],
  terminal_reason: 'completed',
  subtype: 'success',
  result: 'ok',
});

test('parses every field out of a realistic full result object', () => {
  const u = parseUsage(REALISTIC_RESULT);
  assert.deepEqual(u, {
    costUsd: 0.1234,
    numTurns: 4,
    inputTokens: 1200,
    outputTokens: 340,
    cacheCreationInputTokens: 8000,
    cacheReadInputTokens: 500,
    webSearchRequests: 3,
    webFetchRequests: 1,
  });
});

test('returns the null-filled record for malformed JSON rather than throwing', () => {
  assert.deepEqual(parseUsage('{not json at all'), emptyUsage());
});

test('returns the null-filled record for valid JSON missing usage entirely', () => {
  const u = parseUsage(JSON.stringify({ total_cost_usd: 0.5, num_turns: 2 }));
  assert.deepEqual(u, {
    costUsd: 0.5,
    numTurns: 2,
    inputTokens: null,
    outputTokens: null,
    cacheCreationInputTokens: null,
    cacheReadInputTokens: null,
    webSearchRequests: null,
    webFetchRequests: null,
  });
});

test('returns the null-filled record for an empty string', () => {
  assert.deepEqual(parseUsage(''), emptyUsage());
});

test('returns the null-filled record for undefined', () => {
  assert.deepEqual(parseUsage(undefined), emptyUsage());
});

test('returns the null-filled record for JSON that is not an object', () => {
  assert.deepEqual(parseUsage('42'), emptyUsage());
  assert.deepEqual(parseUsage('null'), emptyUsage());
  assert.deepEqual(parseUsage('"a string"'), emptyUsage());
});

test('tolerates a non-numeric total_cost_usd or usage field instead of propagating garbage', () => {
  const u = parseUsage(JSON.stringify({ total_cost_usd: 'free', usage: { input_tokens: 'lots' } }));
  assert.equal(u.costUsd, null);
  assert.equal(u.inputTokens, null);
});

test('addUsage sums two records field by field', () => {
  const a = { ...emptyUsage(), costUsd: 0.1, numTurns: 2 };
  const b = { ...emptyUsage(), costUsd: 0.2, numTurns: 3, inputTokens: 100 };
  assert.deepEqual(addUsage(a, b), {
    costUsd: 0.30000000000000004, numTurns: 5, inputTokens: 100, outputTokens: null,
    cacheCreationInputTokens: null, cacheReadInputTokens: null,
    webSearchRequests: null, webFetchRequests: null,
  });
});

test('addUsage keeps a field null only when neither side reported it', () => {
  const sum = addUsage(emptyUsage(), emptyUsage());
  assert.deepEqual(sum, emptyUsage());
});
