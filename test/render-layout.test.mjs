import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageLayout, escapeHtml, PAGE_CSS } from '../lib/render.mjs';

test('escapeHtml escapes dangerous characters', () => {
  assert.equal(escapeHtml('a & b < c > "d" \'e\''), 'a &amp; b &lt; c &gt; &quot;d&quot; &#39;e&#39;');
});

test('pageLayout produces a full responsive HTML document', () => {
  const html = pageLayout({ title: 'Test', bodyHtml: '<p>hello</p>', linkPrefix: '' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /<title>Test<\/title>/);
  assert.match(html, /<p>hello<\/p>/);
  assert.ok(PAGE_CSS.length > 50);
  assert.match(html, /<style>/);
});

test('pageLayout nav links respect linkPrefix', () => {
  const deep = pageLayout({ title: 'T', bodyHtml: '', linkPrefix: '../' });
  assert.match(deep, /href="\.\.\/index\.html"/);
  assert.match(deep, /href="\.\.\/archive\.html"/);
});
