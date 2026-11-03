/* The legal pages (V4.3): privacy notice, terms of use, cookies and stored data, credits - English and Turkish.
 *
 * They are generated (build-legal.cjs) from legal-content.cjs + legal-config.json. These tests keep them TRUE: every host the app can
 * contact is named in the privacy notice, every key the app writes to local storage has a row on the storage page, the pages are in
 * step with the build, and they are readable (headings, landmarks, links that resolve, contrast that passes WCAG AA).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');
const { ratio } = require('../testkit/contrast.cjs');
const legal = require('../build-legal.cjs');
const { HOSTS, STORAGE } = require('../legal-content.cjs');
const CFG = H.json('legal-config.json');

const LEGAL_DIR = path.join(H.ROOT, 'legal');
const page = (name, L) => fs.readFileSync(path.join(LEGAL_DIR, legal.file(name, L)), 'utf8');
const LF = s => s.replace(/\r\n/g, '\n');
const PAGES = legal.ORDER, LANGS = ['en', 'tr'];
const csp = () => /Content-Security-Policy" content="([^"]+)"/.exec(H.html())[1];
const cspHosts = dir => { const m = new RegExp('(?:^|;\\s*)' + dir + '\\s([^;]*)').exec(csp()); return m ? [...m[1].matchAll(/https:\/\/([a-z0-9.-]+)/g)].map(x => x[1]) : []; };

test('every legal page exists in English and Turkish and is exactly what the build makes (nothing hand-edited, nothing stale)', () => {
  for (const name of PAGES) for (const L of LANGS) {
    const onDisk = page(name, L);
    assert.strictEqual(LF(onDisk), legal.render(name, L, CFG), legal.file(name, L) + ' differs from what build-legal.cjs produces: run npm run build, and edit legal-content.cjs, never the page');
  }
});

test('every page is a real document: language, title, one h1, a main landmark, a skip link, a link to its twin, no script', () => {
  for (const name of PAGES) for (const L of LANGS) {
    const h = page(name, L), f = legal.file(name, L);
    assert.match(h, new RegExp('<html lang="' + L + '">'), f + ': wrong or missing lang');
    assert.match(h, /<title>[^<]+ · İstanbul Ray-Net<\/title>/, f + ': no title');
    assert.strictEqual((h.match(/<h1>/g) || []).length, 1, f + ': needs exactly one h1');
    assert.ok(/<main id="main">/.test(h) && /<a class="skip" href="#main">/.test(h), f + ': no main landmark or skip link');
    assert.ok(h.includes('href="' + legal.file(name, L === 'en' ? 'tr' : 'en') + '"'), f + ': does not link to its other-language twin');
    assert.ok(!/<script/i.test(h) && /default-src 'none'/.test(h), f + ': a legal page must carry no script, and its policy must forbid them');
    for (const t of h.match(/<table[\s\S]*?<\/table>/g) || []) assert.ok(/<th scope="col">/.test(t) && /<th scope="row">/.test(t), f + ': a table without header cells');
  }
});

test('every link between the pages (and back to the app) resolves to a file that exists', () => {
  const bad = [];
  for (const name of PAGES) for (const L of LANGS) {
    const h = page(name, L);
    for (const m of h.matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const file = path.join(LEGAL_DIR, href.split('#')[0]);
      const target = href.split('#')[0] === '../' ? H.ROOT : file;
      if (!fs.existsSync(target)) bad.push(legal.file(name, L) + ' -> ' + href);
      const hash = href.split('#')[1];
      if (hash && fs.existsSync(file) && fs.statSync(file).isFile() && !new RegExp('id="' + hash + '"').test(fs.readFileSync(file, 'utf8'))) bad.push(legal.file(name, L) + ' -> ' + href + ' (no such section)');
    }
    for (const m of h.matchAll(/(?:src|href)="(\.\.\/assets\/[^"]+)"/g)) if (!fs.existsSync(path.join(LEGAL_DIR, m[1]))) bad.push(legal.file(name, L) + ' -> ' + m[1]);
  }
  assert.deepStrictEqual(bad, [], 'broken links: ' + bad.join(', '));
});

test('the privacy notice names every host the app can contact, and no host the app cannot', () => {
  const allowed = new Set([...cspHosts('connect-src'), ...cspHosts('img-src')]);
  const named = new Set(HOSTS.flatMap(h => h.hosts));
  for (const L of LANGS) {
    const h = page('privacy', L);
    for (const host of allowed) assert.ok(h.includes('<code>' + host + '</code>'), 'privacy' + (L === 'tr' ? '.tr' : '') + '.html does not name ' + host + ', which the security policy lets the app contact');
  }
  assert.ok(named.has(new URL(CFG.siteUrl).host), 'the notice must name the host that serves the app');
  const extra = [...named].filter(h => !allowed.has(h) && h !== new URL(CFG.siteUrl).host);
  assert.deepStrictEqual(extra, [], 'the notice names hosts the app is not allowed to contact: ' + extra.join(', '));
  // the optional ones are marked as such, in both languages, because that is the whole point of the section
  for (const h of HOSTS.filter(x => ['photon.komoot.io', 'routing.openstreetmap.de', 'api.anthropic.com'].includes(x.hosts[0]))) assert.ok(h.optional, h.hosts[0] + ' is optional and must be listed under "only if you allow it"');
});

test('every key the app writes to local storage has a row on the storage page, and no row describes a key that is gone', () => {
  const found = new Set();
  for (const m of H.appScript().matchAll(/['"`](irn_[A-Za-z0-9_]*)/g)) {
    if (m[1] === 'irn_') continue;                    // the bare prefix the delete-all button filters on is not a key
    found.add(m[1].endsWith('_') ? m[1] + '*' : m[1]);
  }
  const rows = new Set(STORAGE.map(s => s.key));
  const undocumented = [...found].filter(k => !rows.has(k)).sort(), stale = [...rows].filter(k => !found.has(k)).sort();
  assert.deepStrictEqual(undocumented, [], 'the app writes keys the storage page does not describe: ' + undocumented.join(', '));
  assert.deepStrictEqual(stale, [], 'the storage page describes keys the app no longer writes: ' + stale.join(', '));
  for (const L of LANGS) for (const k of found) assert.ok(page('storage', L).includes('<code>' + k + '</code>'), k + ' is missing from the ' + L + ' storage page');
});

test('the operator and contact details are on every page and in the app, and come from one place', () => {
  assert.match(CFG.contactEmail, /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i, 'legal-config.json has no usable contact e-mail');
  for (const L of LANGS) {
    assert.ok(page('index', L).includes('mailto:' + CFG.contactEmail) && page('privacy', L).includes('mailto:' + CFG.contactEmail) && page('terms', L).includes('mailto:' + CFG.contactEmail),
      'the contact address is missing from the ' + L + ' index, privacy notice or terms');
  }
  assert.ok(H.html().includes('href="mailto:' + CFG.contactEmail + '"'), 'the app\'s Settings does not show the contact address');
  assert.ok(H.html().includes('href="' + CFG.repoUrl + '"'), 'the app\'s Settings does not link to the source code');
});

test('every page says it is not legal advice, and the dates and versions agree with the config', () => {
  for (const name of PAGES) for (const L of LANGS) {
    const h = page(name, L);
    assert.ok(L === 'en' ? /not legal advice/.test(h) : /Hukuki tavsiye değildir/.test(h), legal.file(name, L) + ': no "not legal advice" notice');
    assert.ok(h.includes('· ' + (L === 'en' ? 'version ' : 'sürüm ') + CFG.policyVersion), legal.file(name, L) + ': version line does not match legal-config.json');
  }
  assert.ok(H.appScript().includes("const PRIVACY_VERSION = '" + CFG.policyVersion + "';"), 'the app asks the privacy question for a different policy version than the pages carry');
});

test('the pages cover what a person is entitled to be told: fees, refunds, reviews, children, unsubscribing, deleting, cookies', () => {
  const need = {
    en: { terms: [/no hidden costs/, /Refunds and cancellation/, /no user reviews/, /Age/], privacy: [/Children/, /nothing to unsubscribe from/, /Delete all my data/, /Your rights/, /Notifications/], storage: [/no cookies/, /Delete all my data/, /Offline copies/] },
    tr: { terms: [/gizli maliyet yoktur/, /İade ve iptal/, /kullanıcı yorumu/, /Yaş/], privacy: [/Çocuklar/, /abonelikten çıkılacak bir şey/, /Bu cihazdaki tüm verilerimi sil/, /Haklarınız/, /Bildirimler/], storage: [/hiç çerez koymaz/, /Bu cihazdaki tüm verilerimi sil/, /Çevrimdışı kopyalar/] },
  };
  for (const L of LANGS) for (const name of Object.keys(need[L])) for (const re of need[L][name]) assert.match(page(name, L), re, legal.file(name, L) + ' no longer covers ' + re);
});

test('credits name every library, typeface and image source the app ships', () => {
  const credits = page('credits', 'en') + page('credits', 'tr');
  for (const s of ['Leaflet', 'MapLibre', 'maplibre-gl-leaflet', 'Inter', 'Space Grotesk', 'JetBrains Mono', 'Noto Sans', 'OpenStreetMap', 'OpenFreeMap', 'Esri', 'Open-Meteo', 'Belbim', 'Wikimedia Commons'])
    assert.ok(credits.includes(s), 'the credits page does not mention ' + s);
  // the İBB Open Data Licence asks for this exact credit and a link to the licence wherever its data is used
  for (const L of LANGS) {
    const c = page('credits', L);
    assert.ok(c.includes('Atıf 4.0 Uluslararası (CC BY 4.0) kapsamında lisanslanan kamu sektörü bilgilerini içerir') && c.includes('https://data.ibb.gov.tr/license'), 'the ' + L + ' credits page lacks the İBB credit line or the link to its licence');
  }
  // each vendored library folder has a licence file, which is what the credits page promises
  for (const f of ['vendor/leaflet/LICENSE', 'vendor/fonts/LICENSE-OFL.txt', 'vendor/maplibre/LICENSE-maplibre-gl.txt', 'vendor/glyphs/LICENSE-NotoSans-OFL.txt']) assert.ok(H.exists(f), f + ' is missing');
});

test('no picture the app ships has an unclear licence: the card images are the Istanbul ones from Commons, nothing from a municipality site', () => {
  const ci = H.json('card-images.json');
  assert.deepStrictEqual(Object.keys(ci.cities), ['istanbul'], 'a city other than Istanbul has fare-card pictures again: check where they came from and add them to the credits page first');
  for (const k of Object.keys(ci.cities.istanbul)) assert.match(ci.cities.istanbul[k].credit, /Belbim/, k + ' is not credited to its maker');
  assert.match(ci._source.istanbul, /Wikimedia Commons/, 'the Istanbul card pictures do not record where they came from');
});

test('the colours of the legal pages pass WCAG AA (4.5:1), light and dark', () => {
  const pairs = [['text', 'bg'], ['muted', 'bg'], ['link', 'bg'], ['text', 'note'], ['link', 'note'], ['muted', 'note'], ['text', 'code'], ['text', 'head'], ['link', 'head']];
  const low = [];
  for (const scheme of ['light', 'dark']) for (const [fg, bg] of pairs) {
    const r = ratio(legal.COLOURS[scheme][fg], legal.COLOURS[scheme][bg]);
    if (r < 4.5) low.push(scheme + ' ' + fg + ' on ' + bg + ' = ' + r.toFixed(2));
  }
  assert.deepStrictEqual(low, [], 'too little contrast: ' + low.join('; '));
});
