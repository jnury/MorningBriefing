import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEdition } from '../lib/render.mjs';

const data = {
  edition: 'main', title: 'Briefing du matin', date: '2026-07-28',
  generatedAt: '2026-07-28T05:04:00+02:00',
  sections: [
    { topic: 'weather', label: 'Météo', kind: 'provider', cities: [
      { name: 'Genève', high: 24, low: 13, condition: 'Ensoleillé', weathercode: 0, precipProbability: 10 },
      { name: 'Zurich', high: 21, low: 12, condition: 'Couvert', weathercode: 3, precipProbability: 40 },
    ] },
    { topic: 'swiss', label: 'La Suisse en bref', kind: 'topic', shape: 'headline', items: [
      { headline: 'Le Grand Conseil adopte le budget', publishedAt: '2026-07-27' },
    ] },
    { topic: 'markets', label: 'Marchés', kind: 'dataset',
      asOf: 'clôture du 27 juillet 2026', summary: 'Séance calme.',
      indices: [{ name: 'Nasdaq', changePct: 0.42 }, { name: 'SMI', changePct: -0.15 }, { name: 'CAC 40', changePct: 0 }] },
    { topic: 'tech', label: 'Tech · IT, Science & IA', kind: 'topic', shape: 'card', items: [
      { category: 'AI', title: 'Un nouveau modèle', url: 'https://example.com/a', publishedAt: '2026-07-27', summary: 'Un résumé.' },
    ] },
  ],
};

test('renders the French date in the title and heading', () => {
  const html = renderEdition(data);
  assert.match(html, /<title>Briefing du matin — 28 juillet 2026<\/title>/);
  assert.match(html, /<h1>Briefing du 28 juillet 2026<\/h1>/);
});

test('renders every configured city, not a fixed pair', () => {
  const html = renderEdition(data);
  assert.match(html, /Genève/);
  assert.match(html, /Zurich/);
  assert.ok(!html.includes('Lausanne'), 'aucune ville non configurée ne doit apparaître');
});

test('renders section labels from the data', () => {
  const html = renderEdition(data);
  assert.match(html, /<h2>La Suisse en bref<\/h2>/);
  assert.match(html, /Tech · IT, Science &amp; IA/);
});

test('renders sections in the order given by the data', () => {
  const html = renderEdition(data);
  assert.ok(html.indexOf('Météo') < html.indexOf('La Suisse en bref'));
  assert.ok(html.indexOf('La Suisse en bref') < html.indexOf('Marchés'));
});

test('renders market indices in data order with signed, coloured percentages', () => {
  const html = renderEdition(data);
  assert.ok(html.indexOf('Nasdaq') < html.indexOf('SMI'));
  assert.match(html, /class="up">\+0\.42 %/);
  assert.match(html, /class="down">-0\.15 %/);
  assert.match(html, /class="">0\.00 %/);
});

test('renders card items with a category badge and an external link', () => {
  const html = renderEdition(data);
  assert.match(html, /class="badge badge-ai">AI</);
  assert.match(html, /href="https:\/\/example\.com\/a" target="_blank" rel="noopener"/);
});

test('omits a section entirely when it is absent from the data', () => {
  const html = renderEdition({ ...data, sections: data.sections.filter((s) => s.topic !== 'markets') });
  assert.ok(!html.includes('Marchés'), 'une section absente ne doit rien rendre');
});

test('renders a discreet note for a degraded section', () => {
  const degraded = { ...data, sections: data.sections.map((s) => (s.topic === 'tech' ? { ...s, degraded: true } : s)) };
  assert.match(renderEdition(degraded), /sélection automatique/i);
});

test('escapes HTML in headlines and titles', () => {
  const evil = { ...data, sections: [{ topic: 'swiss', label: 'Suisse', kind: 'topic', shape: 'headline',
    items: [{ headline: 'Alerte <script>alert(1)</script>', publishedAt: '2026-07-27' }] }] };
  const html = renderEdition(evil);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('nav links use the given prefix for depth-1 pages', () => {
  assert.match(renderEdition(data, { linkPrefix: '../' }), /href="\.\.\/archive\.html"/);
});

test('links back to the landing page', () => {
  assert.match(renderEdition(data, { linkPrefix: '../' }), /href="\.\.\/\.\.\/index\.html"/);
});
