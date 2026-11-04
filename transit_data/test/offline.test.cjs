'use strict';
/* The service worker, offline (V4.3).
 *
 * Why this matters more than it used to: the Android app (a Trusted Web Activity) is the website in a frame with no browser around it.
 * Chrome treats three things in it as a CRASH of the Android app: the address check failing, a page that cannot be loaded offline,
 * and a page that answers 404 or 5xx. So every page of the app's own address must always come back with a 200, online or not.
 *
 * Two real faults were found while writing this:
 *  - the page that opens "legal and privacy" from the footer of every legal page is legal/index.html, and the worker took ANY address
 *    ending in /index.html for the app, so it was stored as the offline app (the next offline launch opened the legal index);
 *  - nothing was fetched ahead of time: a legal page never opened online, and the app itself on a first launch that was never
 *    followed by a second online page, failed offline.
 *
 * The scenarios below drive the REAL built worker (sw.js) against a fake browser: a Cache API, a network that can be switched off,
 * a server that can answer 404/503, and events. The last test runs the same scenarios against deliberately broken copies of the
 * worker and requires each one to be caught (the project's mutation check only breaks index.html, so this file carries its own).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const SCOPE = 'https://example.github.io/Metro-Istanbul-General-City-Map/';
const BASE = '/Metro-Istanbul-General-City-Map/';
const LEGAL_DIR = path.join(__dirname, '..', '..', 'legal');
const LEGAL_FILES = fs.readdirSync(LEGAL_DIR).filter(f => f.endsWith('.html')).sort();

const htmlResponse = title => () => new Response('<!doctype html><title>' + title + '</title><p>' + title + '</p>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const textOf = async r => (r && typeof r.text === 'function') ? r.text() : '';

/* a fake browser around the worker source */
function boot(src) {
  const net = { online: true, routes: new Map(), log: [] };
  const stores = new Map();
  const keyOf = (k, o) => { let u = typeof k === 'string' ? k : (k && k.url) || String(k); if (o && o.ignoreSearch) u = u.split('?')[0]; return u; };
  const cacheOf = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (k, v) => { m.set(keyOf(k), v.clone ? v.clone() : v); },
      match: async (k, o) => { for (const [kk, v] of m) if (keyOf(kk, o) === keyOf(k, o)) return v.clone ? v.clone() : v; return undefined; },
      keys: async () => [...m.keys()].map(u => ({ url: u })),
      delete: async k => m.delete(keyOf(k)),
    };
  };
  const caches = {
    open: async n => cacheOf(n),
    match: async (k, o) => { for (const n of stores.keys()) { if (o && o.cacheName && o.cacheName !== n) continue; const r = await cacheOf(n).match(k, o); if (r) return r; } return undefined; },
    keys: async () => [...stores.keys()],
    delete: async n => stores.delete(n),
  };
  const fetchFn = async req => {
    const url = typeof req === 'string' ? req : req instanceof URL ? req.href : req.url;
    net.log.push(url);
    if (!net.online) throw new TypeError('Failed to fetch');
    const route = net.routes.get(new URL(url).pathname);
    if (route === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return route();
  };
  const handlers = {};
  const self = { registration: { scope: SCOPE }, addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting: () => {}, clients: { claim: async () => {} },
    navigator: { get onLine() { return net.online; } } };
  const ctx = vm.createContext({ self, caches, location: { origin: new URL(SCOPE).origin }, URL, Response, Request, Headers, Promise, setTimeout, fetch: fetchFn, Map, Set, console });
  vm.runInContext(src, ctx);
  const waitable = async (type) => { let p; handlers[type]({ waitUntil: x => { p = x; } }); await p; };
  return {
    net, stores, caches,
    install: () => waitable('install'),
    activate: () => waitable('activate'),
    /* what the page gets back for a request (undefined: the worker stepped aside and the browser would use the network itself) */
    get: async (url, mode = 'navigate') => { let p; handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: x => { p = x; } }); return p ? await p : undefined; },
  };
}

/* the site as a deploy serves it */
function serve(b) {
  b.net.routes.set(BASE, htmlResponse('APP-PAGE'));
  b.net.routes.set(BASE + 'index.html', htmlResponse('APP-PAGE'));
  for (const f of LEGAL_FILES) b.net.routes.set(BASE + 'legal/' + f, htmlResponse('LEGAL-' + f));
  b.net.routes.set(BASE + 'assets/icon-192.png', () => new Response('png', { status: 200, headers: { 'content-type': 'image/png' } }));
}

/* each scenario returns a list of what went wrong */
const SCENARIOS = {
  /* a legal page (above all legal/index.html, the footer link on every legal page) must never become the app */
  async 'a legal page is never stored as the offline app'(src) {
    const out = [], b = boot(src); serve(b);
    await b.install();
    for (const f of ['index.html', 'index.tr.html', 'privacy.html', 'credits.tr.html']) await b.get(SCOPE + 'legal/' + f);
    await b.get(SCOPE);
    for (const f of ['index.html', 'index.tr.html']) await b.get(SCOPE + 'legal/' + f);
    b.net.online = false;
    const r = await b.get(SCOPE + '?city=izmir');
    const body = await textOf(r);
    if (!r || r.status !== 200 || !/APP-PAGE/.test(body)) out.push('offline, the app page came back as: ' + body.slice(0, 80));
    return out;
  },
  /* the app opens offline after ONE online visit, even if no second page was ever opened */
  async 'the app opens offline right after it was installed'(src) {
    const out = [], b = boot(src); serve(b);
    await b.install();
    b.net.online = false;
    const r = await b.get(SCOPE);
    if (!r || r.status !== 200 || !/APP-PAGE/.test(await textOf(r))) out.push('the app page did not open offline after install');
    return out;
  },
  /* every legal page (English and Turkish) opens offline although it was never opened online */
  async 'every legal page opens offline without ever having been opened'(src) {
    const out = [], b = boot(src); serve(b);
    await b.install();
    b.net.online = false;
    for (const f of LEGAL_FILES) {
      const r = await b.get(SCOPE + 'legal/' + f);
      if (!r || r.status !== 200 || !(await textOf(r)).includes('LEGAL-' + f)) out.push('legal/' + f + ' did not open offline');
    }
    return out;
  },
  /* a page of the app's own address that is not stored comes back as a 200 page, never as an error */
  async 'a page that cannot be loaded is a 200 page, never an error'(src) {
    const out = [], b = boot(src); serve(b);
    await b.install();
    b.net.online = false;
    for (const u of [SCOPE + 'no-such-page.html', SCOPE + 'legal/never-existed.html', SCOPE + 'legal/', SCOPE + 'status.html']) {
      const r = await b.get(u);
      if (!r || r.status !== 200) { out.push(u + ' -> ' + (r ? r.status + ' ' + r.type : 'nothing')); continue; }
      const body = await textOf(r);
      if (!/text\/html/.test(r.headers.get('content-type') || '')) out.push(u + ' did not come back as html');
      if (!body.includes('href="' + BASE + '"')) out.push(u + ': the page does not link back to the app');
    }
    return out;
  },
  /* the server answering 404 or 5xx is treated like being offline, and a bad answer never replaces the stored app */
  async 'a 404 or 5xx answer never reaches the app and never replaces the stored page'(src) {
    const out = [], b = boot(src); serve(b);
    await b.install();
    const bad = status => () => new Response('SERVER-ERROR-' + status, { status, headers: { 'content-type': 'text/html' } });
    b.net.routes.set(BASE, bad(503));
    b.net.routes.set(BASE + 'legal/privacy.html', bad(500));
    b.net.routes.set(BASE + 'legal/gone.html', bad(404));
    const app = await b.get(SCOPE), priv = await b.get(SCOPE + 'legal/privacy.html'), gone = await b.get(SCOPE + 'legal/gone.html');
    const appBody = await textOf(app), privBody = await textOf(priv);
    if (!app || app.status !== 200 || /SERVER-ERROR/.test(appBody) || !/APP-PAGE/.test(appBody)) out.push('a 503 on the app page was shown, or the stored app was not used');
    if (!priv || priv.status !== 200 || /SERVER-ERROR/.test(privBody) || !/LEGAL-privacy.html/.test(privBody)) out.push('a 500 on a legal page was shown, or the stored copy was not used');
    if (!gone || gone.status !== 200) out.push('a 404 was passed on to the app (a crash in the Android app)');
    b.net.online = false;
    const again = await b.get(SCOPE);
    if (!/APP-PAGE/.test(await textOf(again))) out.push('the 503 replaced the stored app page');
    return out;
  },
  /* a redirect (for example legal -> legal/) must be handed to the browser untouched */
  async 'a redirect is handed to the browser untouched'(src) {
    const out = [], b = boot(src); serve(b);
    await b.install();
    const redirect = { type: 'opaqueredirect', ok: false, status: 0, clone() { return this; } };
    b.net.routes.set(BASE + 'legal', () => redirect);
    const r = await b.get(SCOPE + 'legal');
    if (r !== redirect) out.push('a redirect was replaced by something else');
    return out;
  },
  /* only PAGES get a page: a missing picture or file must stay an error, or the app would try to draw html as an image */
  async 'only pages get the fallback page'(src) {
    const out = [], b = boot(src); serve(b);
    await b.install();
    b.net.online = false;
    for (const mode of ['cors', 'no-cors', 'same-origin']) {
      const r = await b.get(SCOPE + 'assets/never-saved.png', mode);
      if (r && r.status === 200) out.push('a missing file (' + mode + ') came back as a 200 page');
    }
    return out;
  },
  /* the install never fails because a page could not be fetched, and keeps what it did fetch */
  async 'the install survives a page that cannot be fetched'(src) {
    const out = [], b = boot(src); serve(b);
    b.net.routes.set(BASE + 'legal/terms.html', () => { throw new TypeError('boom'); });
    b.net.routes.set(BASE + 'legal/storage.html', () => new Response('x', { status: 404 }));
    try { await b.install(); } catch (e) { out.push('the install failed: ' + e.message); return out; }
    b.net.online = false;
    const r = await b.get(SCOPE + 'legal/privacy.html');
    if (!/LEGAL-privacy.html/.test(await textOf(r))) out.push('the pages that could be fetched were not kept');
    const b2 = boot(src); b2.net.online = false;
    try { await b2.install(); } catch (e) { out.push('an install while offline failed: ' + e.message); }
    return out;
  },
  /* an old version's stored pages go, the other caches stay */
  async 'a new version removes the old stored pages and nothing else'(src) {
    const out = [], b = boot(src); serve(b);
    for (const n of ['raynet-shell-0', 'raynet-pages-0', 'raynet-static-v1', 'raynet-tiles-v2', 'raynet-vtiles-v1', 'turkish-shell']) await b.caches.open(n);
    await b.install(); await b.activate();
    const names = await b.caches.keys();
    for (const gone of ['raynet-shell-0', 'raynet-pages-0']) if (names.includes(gone)) out.push(gone + ' was not removed');
    for (const kept of ['raynet-static-v1', 'raynet-tiles-v2', 'raynet-vtiles-v1', 'turkish-shell']) if (!names.includes(kept)) out.push(kept + ' was removed');
    if (!names.some(n => /^raynet-shell-\d/.test(n)) || !names.some(n => /^raynet-pages-\d/.test(n))) out.push('this version has no stored shell or pages');
    return out;
  },
  /* the fallback page is plain: no script, no outside address, two languages, a way back */
  async 'the fallback page is plain and safe'(src) {
    const out = [], b = boot(src); serve(b);
    await b.install();
    b.net.online = false;
    const body = await textOf(await b.get(SCOPE + 'nothing-here.html'));
    if (/<script/i.test(body)) out.push('the fallback page contains a script');
    if (/https?:\/\//i.test(body)) out.push('the fallback page names an outside address');
    if (!/Content-Security-Policy/i.test(body) || !/default-src 'none'/.test(body)) out.push('the fallback page has no strict policy');
    if (!/<html lang="en"/.test(body) || !/lang="tr"/.test(body)) out.push('the fallback page is not in English and Turkish');
    if (!/<title>[^<]+<\/title>/.test(body)) out.push('the fallback page has no title');
    return out;
  },
};

const REAL = H.read('sw.js');
for (const [name, fn] of Object.entries(SCENARIOS)) {
  test('offline: ' + name, async () => { assert.deepStrictEqual(await fn(REAL), []); });
}

test('offline: the worker fetches the legal pages it is told about, and the list matches the legal folder', () => {
  const m = /const OFFLINE_PAGES\s*=\s*(\[[^\]]*\])/.exec(REAL);
  assert.ok(m, 'the worker has no list of pages to store ahead of time');
  const list = JSON.parse(m[1]);
  assert.deepStrictEqual(list.slice().sort(), LEGAL_FILES.map(f => 'legal/' + f), 'the worker\'s page list is not the legal folder');
});

/* ---- the scenarios must be able to fail ------------------------------------------------------------------------------------- */
const MUTANTS = [
  { name: 'any address ending in /index.html is the app again', scenario: 'a legal page is never stored as the offline app',
    edit: s => s.replace(/url\.pathname === APP_PATH \+ 'index\.html'/, "url.pathname.endsWith('/index.html')") },
  { name: 'nothing is fetched at install', scenario: 'the app opens offline right after it was installed',
    edit: s => s.replace(/e\.waitUntil\(precache\(\)\.catch\(\(\) => \{\}\)\);/, '') },
  { name: 'the legal pages are not fetched at install', scenario: 'every legal page opens offline without ever having been opened',
    edit: s => s.replace(/const OFFLINE_PAGES = \[[^\]]*\]/, 'const OFFLINE_PAGES = []') },
  { name: 'a page that cannot be loaded is an error again', scenario: 'a page that cannot be loaded is a 200 page, never an error',
    edit: s => s.replace(/return kept \|\| offlinePage\(\);/, 'return kept || Response.error();') },
  { name: 'the fallback page answers 404', scenario: 'a page that cannot be loaded is a 200 page, never an error',
    edit: s => s.replace(/\{ status: 200, headers: \{ 'Content-Type': 'text\/html; charset=utf-8'/, "{ status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8'") },
  { name: 'a 503 answer is shown and stored as the app', scenario: 'a 404 or 5xx answer never reaches the app and never replaces the stored page',
    edit: s => s.replace(/if \(r\.ok\) \{/, 'if (r.ok || r.status >= 400) {') },
  { name: 'a redirect is treated as a failure', scenario: 'a redirect is handed to the browser untouched',
    edit: s => s.replace(/if \(r\.type === 'opaqueredirect'\) return r;[^\n]*\n/, '') },
  { name: 'files get the fallback page too', scenario: 'only pages get the fallback page',
    edit: s => s.replace(/e\.request\.mode === 'navigate' && url\.origin === location\.origin/, 'url.origin === location.origin') },
  { name: 'a failed fetch at install fails the install', scenario: 'the install survives a page that cannot be fetched',
    edit: s => s.replace('const quiet = p => p.catch(() => {});', 'const quiet = p => p;').replace('e.waitUntil(precache().catch(() => {}));', 'e.waitUntil(precache());') },
  { name: 'old stored pages are kept', scenario: 'a new version removes the old stored pages and nothing else',
    edit: s => s.replace(/k\.startsWith\('raynet-pages-'\) && k !== PAGES\) \|\|/, "false) ||") },
  { name: 'the fallback page carries a script', scenario: 'the fallback page is plain and safe',
    edit: s => s.replace(/<main>/, '<script>1</script><main>') },
];

test('offline: every scenario fails on a worker with the matching mistake put back (the mutation check for this file)', async () => {
  const notCaught = [];
  for (const m of MUTANTS) {
    const broken = m.edit(REAL);
    if (broken === REAL) { notCaught.push(m.name + ' (the edit did not apply: the anchor no longer matches the worker)'); continue; }
    let problems;
    try { problems = await SCENARIOS[m.scenario](broken); } catch (e) { problems = ['threw: ' + e.message]; }
    if (!problems.length) notCaught.push(m.name);
  }
  assert.deepStrictEqual(notCaught, [], 'mistakes the scenarios did not catch:\n  ' + notCaught.join('\n  '));
});
