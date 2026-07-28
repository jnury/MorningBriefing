import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, resolveEditions, loadBucketsFromDisk, parseGhActiveUser } from '../generate.mjs';
import { composeEdition } from '../lib/compose.mjs';

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

const tmpRoot = () => mkdtempSync(join(tmpdir(), 'mb-gen-'));
const DATE = '2026-07-28';
const TOPICS = {
  tech: { id: 'tech', kind: 'topic', label: 'Tech', shape: 'card', categories: ['AI'], bucketMin: 30, maxAgeDays: 2 },
  weather: { id: 'weather', kind: 'provider', label: 'Météo' },
};

function writeBucket(root, id, payload) {
  const dir = join(root, 'buckets', DATE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(payload));
}

// --recompose used to skip validateBucket entirely: collectOne validates on
// the normal path, but re-reading straight from disk did not, so a malformed
// bucket left over from a previous run reached composeEdition unguarded.
test('loadBucketsFromDisk marks a malformed on-disk bucket as failed instead of passing it through', () => {
  const root = tmpRoot();
  writeBucket(root, 'tech', { bucketId: 'tech', date: DATE }); // no collectedAt, no items
  const results = loadBucketsFromDisk([{ id: 'tech' }], DATE, TOPICS, root);
  assert.equal(results.get('tech').ok, false);
  assert.match(results.get('tech').error, /collectedAt|items/);
});

test('loadBucketsFromDisk accepts a well-formed on-disk bucket', () => {
  const root = tmpRoot();
  writeBucket(root, 'weather', {
    bucketId: 'weather', date: DATE, collectedAt: 'x',
    cities: [{ name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10 }],
  });
  const results = loadBucketsFromDisk([{ id: 'weather' }], DATE, TOPICS, root);
  assert.equal(results.get('weather').ok, true);
  assert.equal(results.get('weather').data.cities[0].name, 'Genève');
});

// The point of validating in loadBucketsFromDisk: it routes a malformed
// bucket through the same section-omission logic collectOne's output already
// relies on, instead of letting composeEdition dereference invalid data and
// throw out of the whole run (fallbackItems is called from inside a catch
// block, so that throw used to escape composeEdition entirely).
// `gh auth status` writes its human-readable summary to stderr by
// convention, not stdout -- a previous version only ever scanned stdout, so
// it always read as "indeterminate", which (before this fix) meant "nothing
// to restore" rather than a hard error. These pin the parsing logic that
// replaced that assumption.
test('parseGhActiveUser reads the account from stderr, where gh actually writes it', () => {
  const r = { status: 0, stdout: '', stderr: 'Logged in to github.com account jnury (keyring)' };
  assert.equal(parseGhActiveUser(r), 'jnury');
});

test('parseGhActiveUser also reads the account from stdout', () => {
  const r = { status: 0, stdout: 'Logged in to github.com account jnury (keyring)', stderr: '' };
  assert.equal(parseGhActiveUser(r), 'jnury');
});

test('parseGhActiveUser returns null on a non-zero exit even if the text would otherwise match', () => {
  const r = { status: 1, stdout: '', stderr: 'Logged in to github.com account jnury (keyring)' };
  assert.equal(parseGhActiveUser(r), null);
});

test('parseGhActiveUser returns null when neither stream mentions an account', () => {
  const r = { status: 0, stdout: '', stderr: 'You are not logged into any GitHub hosts.' };
  assert.equal(parseGhActiveUser(r), null);
});

test('a malformed on-disk bucket degrades composeEdition to a skipped section rather than throwing', async () => {
  const root = tmpRoot();
  writeBucket(root, 'tech', { bucketId: 'tech', date: DATE }); // fails validateBucket
  const bucketResults = loadBucketsFromDisk([{ id: 'tech' }], DATE, TOPICS, root);
  const edition = { id: 'main', title: 'B', sections: [{ topic: 'tech', max: 2 }] };
  const data = await composeEdition(edition, {
    root, date: DATE, topics: TOPICS, template: 'x', bucketResults, now: () => 'x', log: () => {},
  });
  assert.deepEqual(data.sections, []);
});
