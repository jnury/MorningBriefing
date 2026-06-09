import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../generate.mjs';

test('defaults: claude on, no explicit date', () => {
  const o = parseArgs([]);
  assert.equal(o.renderOnly, false);
  assert.equal(o.date, null);
  assert.equal(o.push, true);
});

test('--render-only and --date and --no-push', () => {
  const o = parseArgs(['--render-only', '--date', '2026-06-09', '--no-push']);
  assert.equal(o.renderOnly, true);
  assert.equal(o.date, '2026-06-09');
  assert.equal(o.push, false);
});

test('rejects malformed --date', () => {
  assert.throws(() => parseArgs(['--date', '09-06-2026']));
});
