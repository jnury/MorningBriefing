// Pure rendering functions: (data) -> HTML strings. No side effects.

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const PAGE_CSS = `
:root{--ink:#1a1a1a;--muted:#6b6b6b;--line:#e6e6e6;--accent:#0b5cad;--bg:#ffffff}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  line-height:1.6;font-size:18px}
.wrap{max-width:680px;margin:0 auto;padding:24px 20px 80px}
header.site{display:flex;justify-content:space-between;align-items:baseline;
  border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:8px;flex-wrap:wrap;gap:8px}
header.site .date{font-size:15px;color:var(--muted)}
header.site nav a{color:var(--accent);text-decoration:none;font-size:15px;margin-left:16px}
header.site nav a:hover{text-decoration:underline}
h1{font-size:26px;letter-spacing:-0.01em;margin:18px 0 4px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);
  margin:40px 0 12px;font-weight:600}
h3{font-size:19px;margin:22px 0 4px;line-height:1.35}
h3 a{color:var(--ink);text-decoration:none}
h3 a:hover{color:var(--accent)}
p{margin:8px 0}
.lead{color:var(--muted);margin-top:0}
.weather{display:flex;gap:28px;flex-wrap:wrap}
.weather .city{flex:1 1 200px}
.weather .city .t{font-size:22px;font-weight:600}
.weather .city .c{color:var(--muted)}
.market{margin:14px 0}
.market .name{font-weight:600}
.market table{border-collapse:collapse;width:100%;margin:6px 0;font-size:16px}
.market td{padding:3px 0;border-bottom:1px solid var(--line)}
.market td.num{text-align:right;font-variant-numeric:tabular-nums}
.up{color:#0a7a2f}.down{color:#b3261e}
.world li{margin:6px 0}
.cat{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:0.06em}
.src{font-size:14px}.src a{color:var(--accent);text-decoration:none}
.archive li{margin:8px 0;list-style:none}
.archive ul{padding:0}
.archive a{color:var(--accent);text-decoration:none;font-size:18px}
footer.site{margin-top:60px;border-top:1px solid var(--line);padding-top:14px;
  color:var(--muted);font-size:14px}
@media(max-width:480px){body{font-size:17px}.wrap{padding:18px 16px 60px}h1{font-size:23px}}
`.trim();

export function pageLayout({ title, bodyHtml, linkPrefix = '' }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
<header class="site">
<span class="brand">Briefing du matin</span>
<nav><a href="${linkPrefix}index.html">Aujourd'hui</a><a href="${linkPrefix}archive.html">Archives</a></nav>
</header>
${bodyHtml}
<footer class="site">Généré automatiquement &middot; Julien Nury</footer>
</div>
</body>
</html>`;
}

const CITY_LABELS = { geneva: 'Genève', lausanne: 'Lausanne' };

// Escape only characters that are unsafe in HTML text content (not apostrophes).
function escapeText(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatLevel(n) {
  // French thousands separator (narrow no-break space), 2 decimals.
  return n.toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n) {
  const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
  const cls = n > 0 ? 'up' : (n < 0 ? 'down' : '');
  const body = `${sign}${Math.abs(n).toFixed(2)} %`;
  return { cls, text: body };
}

function renderWeather(weather) {
  const city = (key) => {
    const c = weather[key];
    return `<div class="city">
<div class="name">${CITY_LABELS[key]}</div>
<div class="t">${Math.round(c.high)}° / ${Math.round(c.low)}°</div>
<div class="c">${escapeHtml(c.condition)} &middot; ${Math.round(c.precipProbability)} % de précip.</div>
</div>`;
  };
  return `<h2>Météo</h2>
<div class="weather">${city('geneva')}${city('lausanne')}</div>`;
}

function renderWorld(worldNews) {
  const items = worldNews.map((n) => `<li>${escapeText(n.headline)}</li>`).join('\n');
  return `<h2>Le monde en bref</h2>\n<ul class="world">\n${items}\n</ul>`;
}

function renderMarkets(markets) {
  const block = (r) => {
    const rows = r.indices.map((idx) => {
      const p = formatPct(idx.changePct);
      return `<tr><td>${escapeHtml(idx.name)}</td>
<td class="num">${formatLevel(idx.level)}</td>
<td class="num ${p.cls}">${p.text}</td></tr>`;
    }).join('\n');
    return `<div class="market">
<div class="name">${escapeHtml(r.region)}</div>
<table>${rows}</table>
<p class="lead">${escapeHtml(r.takeaway)}</p>
</div>`;
  };
  const order = ['US', 'Europe', 'Asia'];
  const sorted = order
    .map((name) => markets.regions.find((r) => r.region === name))
    .filter(Boolean);
  return `<h2>Marchés &middot; ${escapeHtml(markets.asOf)}</h2>\n${sorted.map(block).join('\n')}`;
}

function renderTech(tech) {
  const item = (t) => `<article>
<div class="cat">${escapeHtml(t.category)}</div>
<h3><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a></h3>
<p>${escapeHtml(t.summary)}</p>
</article>`;
  return `<h2>Tech &middot; IT, Science &amp; IA</h2>\n${tech.map(item).join('\n')}`;
}

const FR_MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
function frenchDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${FR_MONTHS[m - 1]} ${y}`;
}

export function renderEdition(data, { linkPrefix = '' } = {}) {
  const body = `<h1>Briefing du ${frenchDate(data.date)}</h1>
<p class="lead">Météo, monde, marchés et tech — l'essentiel du jour.</p>
${renderWeather(data.weather)}
${renderWorld(data.worldNews)}
${renderMarkets(data.markets)}
${renderTech(data.tech)}`;
  return pageLayout({ title: `Briefing du ${frenchDate(data.date)}`, bodyHtml: body, linkPrefix });
}

export function renderArchive(editions, { linkPrefix = '' } = {}) {
  const sorted = [...editions].sort((a, b) => (a.date < b.date ? 1 : -1));
  const items = sorted.map((e) =>
    `<li><a href="${linkPrefix}editions/${e.date}.html">${frenchDate(e.date)}</a></li>`
  ).join('\n');
  const body = `<h1>Archives</h1>
<p class="lead">Toutes les éditions précédentes, de la plus récente à la plus ancienne.</p>
<div class="archive"><ul>\n${items}\n</ul></div>`;
  return pageLayout({ title: 'Archives — Briefing du matin', bodyHtml: body, linkPrefix });
}
