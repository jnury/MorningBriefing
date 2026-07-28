import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, resolveEditions } from '../generate.mjs';

test('defaults: full run, push enabled, every edition', () => {
  assert.deepEqual(parseArgs([]), {
    renderOnly: false, recompose: false, date: null, push: true, editionIds: null,
  });
});

test('--no-push disables publishing', () => {
  assert.equal(parseArgs(['--no-push']).push, false);
});

test('--render-only and --recompose set their flags', () => {
  assert.equal(parseArgs(['--render-only']).renderOnly, true);
  assert.equal(parseArgs(['--recompose']).recompose, true);
});

test('--date accepts an ISO date and rejects anything else', () => {
  assert.equal(parseArgs(['--date', '2026-07-28']).date, '2026-07-28');
  assert.throws(() => parseArgs(['--date', '28-07-2026']), /date/);
  assert.throws(() => parseArgs(['--date']), /date/);
});

test('--edition may be repeated and accumulates ids', () => {
  assert.deepEqual(parseArgs(['--edition', 'main']).editionIds, ['main']);
  assert.deepEqual(parseArgs(['--edition', 'main', '--edition', 'carlos']).editionIds, ['main', 'carlos']);
});

test('--edition requires a value', () => {
  assert.throws(() => parseArgs(['--edition']), /edition/);
});

test('unknown arguments are rejected', () => {
  assert.throws(() => parseArgs(['--nope']), /inconnu/);
});

test('--render-only and --recompose together are rejected', () => {
  assert.throws(() => parseArgs(['--render-only', '--recompose']), /ensemble|incompatible/i);
});

const CONFIG_EDITIONS = [{ id: 'main' }, { id: 'carlos' }];

test('resolveEditions with no ids returns every configured edition', () => {
  assert.deepEqual(resolveEditions(CONFIG_EDITIONS, null), CONFIG_EDITIONS);
});

test('resolveEditions narrows to the requested ids', () => {
  assert.deepEqual(resolveEditions(CONFIG_EDITIONS, ['carlos']), [{ id: 'carlos' }]);
});

test('resolveEditions rejects a single unknown id even when others match', () => {
  assert.throws(() => resolveEditions(CONFIG_EDITIONS, ['main', 'carlso']), /carlso/);
});

test('resolveEditions rejects when every requested id is unknown', () => {
  assert.throws(() => resolveEditions(CONFIG_EDITIONS, ['nope']), /nope/);
});
