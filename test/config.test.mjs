import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';

// Builds a throwaway config tree so tests never depend on the real config/.
function tmpConfig({ topics = {}, editions = {}, house = 'règles' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mb-cfg-'));
  mkdirSync(join(root, 'config', 'topics'), { recursive: true });
  mkdirSync(join(root, 'config', 'editions'), { recursive: true });
  writeFileSync(join(root, 'config', 'house.md'), house);
  for (const [id, t] of Object.entries(topics)) {
    writeFileSync(join(root, 'config', 'topics', `${id}.json`), JSON.stringify(t));
  }
  for (const [id, e] of Object.entries(editions)) {
    writeFileSync(join(root, 'config', 'editions', `${id}.json`), JSON.stringify(e));
  }
  return root;
}

const TECH = {
  id: 'tech', kind: 'topic', label: 'Tech', shape: 'card',
  bucketMin: 30, maxAgeDays: 2, summaryMaxWords: 150,
  research: 'Actualités tech.', sources: ['ScienceDaily'],
};

test('loadConfig returns house text, topics keyed by id, and editions', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: { main: { id: 'main', title: 'Briefing', sections: [{ topic: 'tech', max: 20 }] } },
  });
  const cfg = loadConfig(root);
  assert.equal(cfg.house, 'règles');
  assert.equal(cfg.topics.tech.label, 'Tech');
  assert.equal(cfg.editions.length, 1);
  assert.equal(cfg.editions[0].id, 'main');
});

test('loadConfig sorts editions by order then id', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: {
      zed:  { id: 'zed',  title: 'Z', order: 1, sections: [{ topic: 'tech', max: 5 }] },
      main: { id: 'main', title: 'M', order: 1, sections: [{ topic: 'tech', max: 5 }] },
      last: { id: 'last', title: 'L', order: 9, sections: [{ topic: 'tech', max: 5 }] },
    },
  });
  assert.deepEqual(loadConfig(root).editions.map((e) => e.id), ['main', 'zed', 'last']);
});

test('loadConfig rejects a section referencing an unknown topic', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: { main: { id: 'main', title: 'M', sections: [{ topic: 'sport', max: 3 }] } },
  });
  assert.throws(() => loadConfig(root), /sport/);
});

test('loadConfig rejects a topic section without max', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: { main: { id: 'main', title: 'M', sections: [{ topic: 'tech' }] } },
  });
  assert.throws(() => loadConfig(root), /max/);
});

test('loadConfig rejects an edition whose id does not match its filename', () => {
  const root = tmpConfig({
    topics: { tech: TECH },
    editions: { main: { id: 'autre', title: 'M', sections: [{ topic: 'tech', max: 5 }] } },
  });
  assert.throws(() => loadConfig(root), /autre/);
});

test('loadConfig rejects an unknown topic kind', () => {
  const root = tmpConfig({
    topics: { tech: { ...TECH, kind: 'bizarre' } },
    editions: { main: { id: 'main', title: 'M', sections: [{ topic: 'tech', max: 5 }] } },
  });
  assert.throws(() => loadConfig(root), /bizarre/);
});

// A target above the cap would ask the collector for summaries that validation
// is guaranteed to discard, so the contradiction has to fail at load time.
test('loadConfig rejects a summary target above the hard cap', () => {
  const root = tmpConfig({
    topics: { tech: { ...TECH, summaryTargetWords: 200 } },
    editions: { main: { id: 'main', title: 'M', sections: [{ topic: 'tech', max: 5 }] } },
  });
  assert.throws(() => loadConfig(root), /summaryTargetWords/);
});

test('the real config/ tree loads without errors', () => {
  // fileURLToPath, not URL.pathname: the repo path contains a space, which
  // pathname leaves percent-encoded and readdirSync then fails to find.
  const root = fileURLToPath(new URL('..', import.meta.url));
  const cfg = loadConfig(root);
  assert.ok(cfg.topics.tech, 'topic tech attendu');
  assert.ok(cfg.editions.some((e) => e.id === 'main'), 'édition main attendue');
});

test('loadConfig collects every independent error in a single throw', () => {
  // Three unrelated defects at once: an unknown topic kind, an edition id that
  // disagrees with its filename, and a section pointing at a nonexistent topic.
  // A fail-fast regression would only report the first of these.
  const root = tmpConfig({
    topics: { tech: { ...TECH, kind: 'bizarre' } },
    editions: { main: { id: 'autre', title: 'M', sections: [{ topic: 'sport', max: 3 }] } },
  });
  assert.throws(() => loadConfig(root), (err) => {
    assert.match(err.message, /bizarre/);
    assert.match(err.message, /autre/);
    assert.match(err.message, /sport/);
    return true;
  });
});

test('loadConfig reports malformed JSON as a French collected error, not a raw SyntaxError', () => {
  const root = mkdtempSync(join(tmpdir(), 'mb-cfg-'));
  mkdirSync(join(root, 'config', 'topics'), { recursive: true });
  mkdirSync(join(root, 'config', 'editions'), { recursive: true });
  writeFileSync(join(root, 'config', 'house.md'), 'règles');
  writeFileSync(join(root, 'config', 'topics', 'tech.json'), JSON.stringify(TECH));
  writeFileSync(join(root, 'config', 'topics', 'broken.json'), '{ not valid json');
  writeFileSync(
    join(root, 'config', 'editions', 'main.json'),
    JSON.stringify({ id: 'main', title: 'M', sections: [{ topic: 'tech', max: 5 }] }),
  );
  assert.throws(() => loadConfig(root), (err) => {
    assert.ok(!(err instanceof SyntaxError), 'ne doit pas laisser fuiter un SyntaxError brut');
    assert.match(err.message, /broken/);
    return true;
  });
});
