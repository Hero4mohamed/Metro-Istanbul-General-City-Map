'use strict';
/* Builds legal/*.html (V4.3) from legal-content.cjs and legal-config.json: privacy notice, terms of use, cookies and stored data,
 * credits, and an index, each in English (name.html) and Turkish (name.tr.html). Called by build.cjs, so the pages are rebuilt with
 * the app and CI's "the committed build matches a rebuild" check covers them. The output has no timestamp, so a rebuild is
 * byte-for-byte the same.
 *
 * The pages are plain, script-free HTML under a policy that forbids scripts (default-src 'none'), readable without the app,
 * with a skip link, real headings, table headers, a language link and light and dark colours that pass WCAG AA (a test measures
 * the contrast).
 */
const fs = require('fs');
const path = require('path');
const { PAGES, NOT_ADVICE } = require('./legal-content.cjs');

const ORDER = ['index', 'privacy', 'terms', 'storage', 'credits', 'accessibility'];
const NAV = {
  en: { index: 'Legal and privacy', privacy: 'Privacy notice', terms: 'Terms of use', storage: 'Cookies and stored data', credits: 'Credits and licences', accessibility: 'Accessibility' },
  tr: { index: 'Yasal bilgiler', privacy: 'Gizlilik bildirimi', terms: 'Kullanım koşulları', storage: 'Çerezler ve saklanan veriler', credits: 'Katkılar ve lisanslar', accessibility: 'Erişilebilirlik' },
};
const UI = {
  en: { skip: 'Skip to the content', home: '← Back to İstanbul Ray-Net', other: 'Türkçe', otherLang: 'tr', otherName: 'Türkçe', pages: 'Legal pages', lang: 'Language',
        updated: (d, v) => 'Last updated ' + d + ' · version ' + v, project: 'İstanbul Ray-Net · a free, non-commercial, open-source project' },
  tr: { skip: 'İçeriğe geç', home: '← İstanbul Ray-Net\'e dön', other: 'English', otherLang: 'en', otherName: 'English', pages: 'Yasal sayfalar', lang: 'Dil',
        updated: (d, v) => 'Son güncelleme ' + d + ' · sürüm ' + v, project: 'İstanbul Ray-Net · ücretsiz, ticari olmayan, açık kaynaklı bir proje' },
};
const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
};
const dateText = (iso, L) => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MONTHS[L][m - 1] + ' ' + y; };
const file = (page, L) => page + (L === 'tr' ? '.tr' : '') + '.html';

/* Colour tokens. Each text colour is measured against its background in test/legal.test.cjs (WCAG AA, 4.5:1). */
const COLOURS = {
  light: { bg: '#f7f8fa', text: '#14181f', muted: '#475262', link: '#0b5cad', line: '#c9d0da', note: '#e6f0fa', code: '#e7ebf0', head: '#e9edf2' },
  dark:  { bg: '#0d1117', text: '#e6edf3', muted: '#9aa7b8', link: '#6cb6ff', line: '#2b3440', note: '#13202f', code: '#1b232d', head: '#161d27' },
};
const vars = c => '--bg:' + c.bg + ';--text:' + c.text + ';--muted:' + c.muted + ';--link:' + c.link + ';--line:' + c.line + ';--note:' + c.note + ';--code:' + c.code + ';--head:' + c.head + ';';

const CSS = `
:root{${vars(COLOURS.light)}color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{${vars(COLOURS.dark)}}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif}
a{color:var(--link);text-underline-offset:.15em}
a:focus-visible,summary:focus-visible{outline:3px solid var(--link);outline-offset:2px;border-radius:3px}
.skip{position:absolute;left:12px;top:-60px;background:var(--bg);color:var(--text);padding:10px 14px;border:2px solid var(--link);border-radius:8px;z-index:9}
.skip:focus{top:10px}
.top{display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between;align-items:center;max-width:46rem;margin:0 auto;padding:16px 16px 0}
main{max-width:46rem;margin:0 auto;padding:8px 16px 32px}
h1{font-size:1.9rem;line-height:1.2;margin:.6em 0 .2em}
h2{font-size:1.3rem;line-height:1.3;margin:1.8em 0 .4em;padding-top:.4em;border-top:1px solid var(--line)}
h3{font-size:1.05rem;margin:1.4em 0 .4em}
p,li{max-width:42rem}
li{margin:.3em 0}
.meta{color:var(--muted);margin:0 0 1em}
.note{background:var(--note);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:0 0 1.4em}
code,kbd{background:var(--code);padding:.05em .35em;border-radius:5px;font:.9em ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
kbd{border:1px solid var(--line);border-bottom-width:2px}
.tw{overflow-x:auto;margin:.8em 0 1.2em;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:34rem;font-size:.95rem}
th,td{padding:9px 12px;text-align:start;vertical-align:top;border-bottom:1px solid var(--line)}
thead th{background:var(--head)}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
tbody th{font-weight:400}
footer{max-width:46rem;margin:0 auto;padding:8px 16px 40px;border-top:1px solid var(--line);color:var(--muted);font-size:.95rem}
footer ul{list-style:none;padding:0;margin:.8em 0;display:flex;flex-wrap:wrap;gap:6px 18px}
@media (max-width:30rem){body{font-size:16px}h1{font-size:1.6rem}}
@media print{.skip,.top nav{display:none}body{background:#fff;color:#000}a{color:#000}}
`.trim();

function render(page, L, cfg) {
  const u = UI[L];
  const doc = PAGES[page][L](cfg);
  const other = u.otherLang;
  const nav = ORDER.map(p => '<li><a href="' + file(p, L) + '"' + (p === page ? ' aria-current="page"' : '') + '>' + NAV[L][p] + '</a></li>').join('');
  return [
    '<!doctype html>',
    '<html lang="' + L + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\'; base-uri \'none\'; form-action \'none\'">',
    '<meta name="color-scheme" content="light dark">',
    '<title>' + doc.title + ' · İstanbul Ray-Net</title>',
    '<meta name="description" content="' + doc.desc.replace(/"/g, '&quot;') + '">',
    '<link rel="icon" type="image/png" sizes="32x32" href="../assets/favicon-32.png">',
    '<link rel="alternate" hreflang="en" href="' + file(page, 'en') + '">',
    '<link rel="alternate" hreflang="tr" href="' + file(page, 'tr') + '">',
    '<style>' + CSS + '</style>',
    '</head>',
    '<body>',
    '<a class="skip" href="#main">' + u.skip + '</a>',
    '<header class="top"><a href="../">' + u.home + '</a><nav aria-label="' + u.lang + '"><a lang="' + other + '" hreflang="' + other + '" href="' + file(page, other) + '">' + u.otherName + '</a></nav></header>',
    '<main id="main">',
    '<h1>' + doc.h1 + '</h1>',
    '<p class="meta">' + u.updated(dateText(cfg.policyDate, L), cfg.policyVersion) + '</p>',
    '<p class="note">' + NOT_ADVICE[L] + '</p>',
    doc.body,
    '</main>',
    '<footer><nav aria-label="' + u.pages + '"><ul>' + nav + '</ul></nav><p>' + u.project + '</p></footer>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function build(cfg, root) {
  const dir = path.join(root, 'legal');
  fs.mkdirSync(dir, { recursive: true });
  const c = Object.assign({}, cfg);
  const written = [];
  for (const page of ORDER) for (const L of ['en', 'tr']) {
    const out = path.join(dir, file(page, L));
    fs.writeFileSync(out, render(page, L, c));
    written.push(path.relative(root, out).replace(/\\/g, '/'));
  }
  console.log('WROTE legal pages:', written.length, '(' + ORDER.join(', ') + ' x en/tr)');
  return written;
}

module.exports = { build, render, COLOURS, ORDER, file };
