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
.weather .city .wx-row{display:flex;align-items:center;gap:10px;margin:4px 0}
.wx{width:34px;height:34px;color:var(--accent);flex:none}
.weather .city .t{font-size:22px;font-weight:600}
.weather .city .c{color:var(--muted)}
.markets{display:flex;flex-wrap:wrap;gap:14px 26px;margin:10px 0;font-variant-numeric:tabular-nums}
.markets .idx{display:inline-flex;gap:8px;align-items:baseline}
.markets .idx-name{font-weight:600}
.up{color:#0a7a2f}.down{color:#b3261e}
.world li{margin:6px 0}
.badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;margin-right:8px;vertical-align:middle;background:#eef1f5;color:#41506b}
.badge-ai{background:#eae6fb;color:#5b3ea8}
.badge-science{background:#e3f3ec;color:#1f7a4d}
.badge-it{background:#e7eefb;color:#28508f}
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

function formatPct(n) {
  const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
  const cls = n > 0 ? 'up' : (n < 0 ? 'down' : '');
  const body = `${sign}${Math.abs(n).toFixed(2)} %`;
  return { cls, text: body };
}

// Minimal line-icon set (Lucide, ISC-licensed) keyed by WMO weather code.
const WX_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  partly: '<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  fog: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 17H7"/><path d="M17 21H9"/>',
  rain: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
  snow: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M8 15h.01"/><path d="M8 19h.01"/><path d="M12 17h.01"/><path d="M12 21h.01"/><path d="M16 15h.01"/><path d="M16 19h.01"/>',
  thunder: '<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/>',
};

// WMO weather code → icon key. Snow/thunder are checked before the broad rain range.
function weatherKey(code) {
  if (code === 0) return 'sun';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 71 && code <= 77) return 'snow';
  if (code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  if (code >= 51 && code <= 82) return 'rain';
  return 'cloud';
}

function weatherIcon(code) {
  const paths = WX_ICONS[weatherKey(code)];
  return `<svg class="wx" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function renderWeather(weather) {
  const city = (key) => {
    const c = weather[key];
    return `<div class="city">
<div class="name">${CITY_LABELS[key]}</div>
<div class="wx-row">${weatherIcon(c.weathercode)}<span class="t">${Math.round(c.high)}° / ${Math.round(c.low)}°</span></div>
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

const MARKET_ORDER = ['Nasdaq', 'Dow Jones', 'SMI', 'Euro Stoxx 50'];

function renderMarkets(markets) {
  const cells = MARKET_ORDER
    .map((name) => markets.indices.find((i) => i.name === name))
    .filter(Boolean)
    .map((idx) => {
      const p = formatPct(idx.changePct);
      return `<span class="idx"><span class="idx-name">${escapeHtml(idx.name)}</span> <span class="${p.cls}">${p.text}</span></span>`;
    }).join('\n');
  return `<h2>Marchés &middot; ${escapeHtml(markets.asOf)}</h2>
<div class="markets">${cells}</div>
<p class="lead">${escapeHtml(markets.summary)}</p>`;
}

const BADGE_CLASS = { AI: 'badge-ai', Science: 'badge-science', IT: 'badge-it' };

function renderTech(tech) {
  const item = (t) => {
    const badgeClass = BADGE_CLASS[t.category] || '';
    return `<article>
<h3><span class="badge ${badgeClass}">${escapeHtml(t.category)}</span> <a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a></h3>
<p>${escapeHtml(t.summary)}</p>
</article>`;
  };
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
