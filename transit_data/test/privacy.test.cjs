/* What the app DOES with people's information (V4.3): the optional look-ups wait for a yes, the question is fair, "delete all my data"
 * deletes this app's data and only this app's, nothing is collected that the notice does not say, and opening a legal page cannot
 * break the offline app.
 *
 * Behaviour is tested by running the app's own functions (taken out of the BUILT page, so the mutation harness can break them)
 * against stand-ins for the browser.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const H = require('../testkit/helpers.cjs');

/** the source of `function name(...) {...}` (or `async function`) from the built script, found by matching braces */
function fnSource(script, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(script);
  assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = script.indexOf('{', m.index + m[0].length), depth = 0;
  const start = m.index;
  for (; i < script.length; i++) {
    if (script[i] === '{') depth++;
    else if (script[i] === '}' && --depth === 0) return script.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}
const script = () => H.appScript().replace(/\r\n/g, '\n');
const markup = () => H.html().replace(/\r\n/g, '\n');

/* ---- nothing is sent until the person has said yes ------------------------------------------------------------------ */
test('online look-ups are off until the person chooses', () => {
  const s = script();
  assert.ok(s.includes("let onlineSearchPref = lsStr('irn_online') === '1';"), 'online look-ups are on by default, or the default moved');
  // a stored answer of "on" survives; a stored "off" or nothing at all is off
  const code = "let onlineSearchPref = lsStr('irn_online') === '1';";
  const run = v => new Function('lsStr', code + ' return onlineSearchPref;')(() => v);
  assert.strictEqual(run(null), false); assert.strictEqual(run('0'), false); assert.strictEqual(run('1'), true);
});

test('with look-ups off, the walking-route, text-search and nearby-search calls never reach the network', async () => {
  const s = script();
  const calls = [];
  const fetchSpy = (...a) => { calls.push(String(a[0])); return Promise.reject(new Error('network reached')); };
  const g = { onlineSearchPref: false, fetch: fetchSpy, footCache: {}, GEO_CACHE: new Map(), POI_CACHE: new Map(), lang: 'en', IST_C: { lat: 41, lng: 29 },
    foldQ: x => String(x).toLowerCase(), metersBetween: () => 0, AbortController, setTimeout: () => 0, clearTimeout: () => {}, Map, encodeURIComponent };
  const ctx = vm.createContext(g);
  vm.runInContext(['fetchFoot', 'photonSearch', 'poiNear'].map(n => fnSource(s, n)).join('\n'), ctx);
  assert.strictEqual(await vm.runInContext("fetchFoot([41.04, 28.98], [41.03, 28.99])", ctx), null, 'a walking leg was routed while look-ups were off');
  assert.strictEqual(JSON.stringify(await vm.runInContext("photonSearch('taksim square')", ctx)), '[]', 'a typed place was looked up while look-ups were off');
  assert.strictEqual(await vm.runInContext("poiNear(41.04, 28.98, 'amenity=pharmacy', 3, 10)", ctx), null, 'a nearby search left the device while look-ups were off');
  assert.deepStrictEqual(calls, [], 'the network was reached: ' + calls.join(', '));
  // and the same functions DO ask once the person has said yes (so the test above is testing a gate, not a broken function)
  g.onlineSearchPref = true;
  await vm.runInContext("fetchFoot([41.04, 28.98], [41.03, 28.99])", ctx);
  await vm.runInContext("photonSearch('taksim square')", ctx);
  await vm.runInContext("poiNear(41.04, 28.98, 'amenity=pharmacy', 3, 10)", ctx);
  assert.strictEqual(calls.length, 3, 'with look-ups on, expected one request each; saw ' + calls.length);
  assert.ok(/routing\.openstreetmap\.de/.test(calls[0]) && /photon\.komoot\.io\/api/.test(calls[1]) && /photon\.komoot\.io\/reverse/.test(calls[2]), 'the requests went somewhere unexpected: ' + calls.join(' | '));
});

test('no code path sends text or coordinates to Photon or the routing server except through those three gated functions', () => {
  // comments are blanked (same length, so positions still line up): a comment may mention a host without calling it
  const raw = script();
  const s = raw.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/[^\n]*/g, c => c.replace(/[^\n\s]/g, ' '));
  const gated = ['fetchFoot', 'photonSearch', 'poiNear'].map(n => { const src = fnSource(s, n); const at = s.indexOf(src); return [at, at + src.length]; });
  let seen = 0;
  for (const host of ['photon.komoot.io', 'routing.openstreetmap.de']) {
    let at = -1;
    // an address the code can call ("https://host/..."), not the host's name in a sentence the person reads
    while ((at = s.indexOf('https://' + host, at + 1)) >= 0) {
      seen++;
      const line = s.slice(s.lastIndexOf('\n', at) + 1, s.indexOf('\n', at));
      assert.ok(gated.some(([a, b]) => at >= a && at < b), host + ' is used outside the gated functions: ' + line.trim().slice(0, 100));
    }
  }
  assert.strictEqual(seen, 3, 'expected the host names once each in the three gated functions, found ' + seen + ' (a fourth way to reach them needs gating and a test)');
});

/* ---- the question is fair ----------------------------------------------------------------------------------------------- */
test('the privacy question gives both answers the same size and style, and neither is pre-selected', () => {
  const html = markup();
  const box = /<div class="priv-notice[\s\S]*?<\/div>\s*<a class="priv-link"[^>]*>/.exec(html);
  assert.ok(box, 'the privacy notice markup is missing');
  const btn = id => new RegExp('<button([^>]*)id="' + id + '"([^>]*)>').exec(box[0]);
  const a = btn('privKeep'), b = btn('privAllow');
  assert.ok(a && b, 'the two answer buttons are missing');
  const cls = m => (/class="([^"]*)"/.exec(m[1] + ' ' + m[2]) || [])[1];
  assert.strictEqual(cls(a), cls(b), 'the two answers do not share a style (a dark pattern: one answer looks like the right one)');
  assert.ok(!/autofocus|checked|aria-pressed|data-default/.test(a[0] + b[0]), 'an answer is pre-selected');
  const css = H.appStyle();
  assert.ok(!/#priv(Keep|Allow)\s*[{,:.]|\.priv-btn\.[\w-]+|\.priv-btn:(first|last|nth)/.test(css), 'the stylesheet singles one answer out');
  assert.ok(/id="privKeep"[\s\S]*id="privAllow"/.test(box[0]), '"keep everything on my device" must come first: it is the default');
  assert.ok(/data-legal="privacy"/.test(box[0]) && /role="region"/.test(box[0]), 'the notice has no link to the full privacy notice, or is not a labelled region');
});

test('the privacy question waits for the welcome dialog, stays out of the way, and any answer (or using the switch) closes it for good', () => {
  const s = script();
  const code = s.slice(s.indexOf('function syncLegalLinks'), s.indexOf('function irnWipeLocal'));
  assert.ok(/welcome\.classList\.contains\('show'\)\) return/.test(code), 'the question can appear on top of the welcome dialog');
  assert.ok(!/\.focus\(\)/.test(code), 'the question steals keyboard focus');
  assert.ok(/e\.key === 'Escape'[\s\S]{0,80}answer\(false\)/.test(code), 'Escape does not mean "keep everything on my device"');
  const set = fnSource(s, 'setOnlineSearch');
  assert.ok(/irn_privacy/.test(set) && /privNotice/.test(set), 'using the Settings switch does not count as an answer');
  // the notice shows when nothing has been answered for THIS version of the notice, and not otherwise
  assert.ok(/lsStr\('irn_privacy'\) !== PRIVACY_VERSION/.test(code), 'the question is not tied to the version of the notice');
});

/* ---- delete all my data -------------------------------------------------------------------------------------------------- */
test('"delete all my data" removes this app\'s storage, offline copies and service worker, and leaves everything else at the same address alone', async () => {
  const s = script();
  const store = { irn_home: '1', irn_theme: 'dark', irn_lyr_vision: '0', irn_sec_map: '1', otherApp_progress: '42', 'kok:streak': '7' };
  const cacheNames = ['raynet-shell-1', 'raynet-static-v1', 'raynet-tiles-v2', 'raynet-vtiles-v1', 'turkish-shell', 'workbox-precache'];
  const deleted = []; let unregistered = 0, reloaded = 0, toast = '';
  const localStorage = new Proxy({}, {
    ownKeys: () => Object.keys(store), getOwnPropertyDescriptor: (_, k) => (k in store ? { value: store[k], enumerable: true, configurable: true } : undefined),
    get: (_, k) => (k === 'removeItem' ? key => { delete store[key]; } : store[k]),
  });
  const caches = { keys: async () => cacheNames.slice(), delete: async n => { deleted.push(n); return true; } };
  const win = { addEventListener: () => {}, caches };
  const ctx = vm.createContext({ localStorage, window: win, caches,
    navigator: { serviceWorker: { getRegistration: async () => ({ unregister: async () => { unregistered++; } }) } },
    location: { reload: () => { reloaded++; } }, showToast: m => { toast = m; }, t: k => k, setTimeout: fn => { fn(); return 0; }, Object, Promise });
  vm.runInContext(fnSource(s, 'irnWipeLocal') + '\n' + fnSource(s, 'deleteAllMyData'), ctx);
  await vm.runInContext('deleteAllMyData()', ctx);
  assert.deepStrictEqual(Object.keys(store).sort(), ['kok:streak', 'otherApp_progress'], 'storage left over, or a neighbour\'s data was deleted: ' + Object.keys(store));
  assert.deepStrictEqual(deleted.sort(), ['raynet-shell-1', 'raynet-static-v1', 'raynet-tiles-v2', 'raynet-vtiles-v1'], 'wrong caches deleted: ' + deleted);
  assert.strictEqual(unregistered, 1, 'the service worker was not unregistered');
  assert.strictEqual(reloaded, 1, 'the app did not restart');
  assert.strictEqual(toast, 'deleteAllDone');
});

test('the delete button asks twice, so a stray touch deletes nothing, and says what it will remove', () => {
  const s = script(), html = markup();
  const code = s.slice(s.indexOf("const btn = document.getElementById('deleteAll')"), s.indexOf('function irnWipeLocal'));
  assert.ok(/if\(!armed\)\{[\s\S]*?return;[\s\S]*?\}\s*disarm\(\);\s*deleteAllMyData\(\)/.test(code), 'the first tap deletes (it must only arm the button)');
  assert.ok(/setTimeout\(disarm/.test(code), 'an armed button never disarms itself');
  assert.ok(/id="deleteAll"[\s\S]{0,400}data-i18n="deleteAllHint"/.test(html), 'no explanation under the delete button');
});

test('everything the app stores is under the irn_ prefix and no other kind of storage or tracking is used', () => {
  const code = H.codeOnly(H.appScript());
  const raw = H.appScript();
  const keys = [...raw.matchAll(/(?:localStorage\.(?:getItem|setItem|removeItem)|lsStr|lsJSON|lsGet|lsSet)\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(keys.length > 20, 'found only ' + keys.length + ' storage calls: has the pattern drifted?');
  assert.deepStrictEqual([...new Set(keys.filter(k => !k.startsWith('irn_')))], [], 'storage keys outside irn_ would survive "delete all my data"');
  assert.ok(!/\bsessionStorage\b|\bindexedDB\b|document\.cookie/.test(code), 'the storage page promises no session storage, IndexedDB or cookies');
  for (const bad of ['google-analytics', 'googletagmanager', 'gtag(', 'fbq(', 'connect.facebook', 'hotjar', 'mixpanel', 'segment.com', 'plausible.io', 'matomo', 'clarity.ms', 'sentry', 'doubleclick', 'adsbygoogle', 'sendBeacon'])
    assert.ok(!raw.includes(bad) && !markup().includes(bad), 'the page carries tracking or advertising code: ' + bad);
});

/* ---- forms and consent -------------------------------------------------------------------------------------------------- */
test('there is no sign-up, contact or payment form: no field asks for an e-mail, phone number, name or address, and the policy forbids submitting forms', () => {
  const html = markup();
  assert.ok(!/<form[\s>]/i.test(html), 'a <form> element appeared: a form needs a consent line and a place in the privacy notice');
  assert.match(csp(), /form-action 'none'/, 'the policy no longer forbids form submission');
  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map(m => m[0]);
  assert.ok(inputs.length > 0, 'found no inputs: has the pattern drifted?');
  for (const i of inputs) {
    const type = (/type="([^"]+)"/.exec(i) || [, 'text'])[1];
    assert.ok(['text', 'search', 'password', 'range', 'checkbox', 'time', 'date', 'number'].includes(type), 'an input of type ' + type + ' (' + i.slice(0, 60) + ')');
    assert.ok(!/autocomplete="(?:name|given-name|family-name|email|tel|street-address|postal-code|cc-)/.test(i), 'a field asks the browser to fill personal details: ' + i.slice(0, 80));
    if (type === 'password') assert.ok(/id="aiKeyIn"/.test(i) && /autocomplete="off"/.test(i), 'the only password field is the optional API key, with autocomplete off');
  }
});
function csp() { return /Content-Security-Policy" content="([^"]+)"/.exec(H.html())[1]; }

/* ---- reports: what leaves the device, and only by the person's own hand ---------------------------------------------------- */
test('"Report a problem" says what it opens, and a report names the app version but carries nothing personal', () => {
  const html = markup();
  assert.ok(/id="diagNote"[\s\S]{0,200}data-i18n="diagPrivacy"/.test(html), 'the report button has no disclosure under it');
  const body = fnSource(script(), 'diagReportText');
  assert.ok(/"app: V\d+(?:\.\d+)* build " \+ BUILD/.test(body), 'a report does not say which version of the app it came from');
  assert.ok(!/geoPos|irn_home|irn_work|irn_history|irn_recent|irn_ai_key|homePlace|workPlace/.test(body), 'a report carries something personal');
});

/* ---- the legal pages cannot break the offline app ------------------------------------------------------------------------- */
test('opening a legal page is not stored as the offline app shell, and opening the app is', async () => {
  const sw = H.read('sw.js');
  let onFetch = null, puts = [];
  const cacheStore = { put: async (k, v) => { puts.push(k); }, match: async () => undefined, keys: async () => [] };
  const caches = { open: async () => cacheStore, match: async () => undefined, keys: async () => [], delete: async () => true };
  const self = { registration: { scope: 'https://example.github.io/Metro-Istanbul-General-City-Map/' }, location: { origin: 'https://example.github.io' },
    addEventListener: (t, fn) => { if (t === 'fetch') onFetch = fn; }, skipWaiting: () => {}, clients: { claim: async () => {} }, navigator: { onLine: true } };
  const ctx = vm.createContext({ self, caches, location: self.location, URL, Response: class { clone() { return this; } get ok() { return true; } }, Promise, setTimeout, fetch: async () => new (class { clone() { return this; } get ok() { return true; } })(), Map, Set });
  vm.runInContext(sw, ctx);
  assert.ok(onFetch, 'the service worker registered no fetch handler');
  const nav = async (url) => {
    let p = null; puts = [];
    onFetch({ request: { method: 'GET', url, mode: 'navigate' }, respondWith: x => { p = x; } });
    if (p) await p;
    // the page a navigation returns may be cached under its own address (static files are), but only the app page is THE SHELL
    return puts.filter(k => k === 'shell');
  };
  assert.deepStrictEqual(await nav('https://example.github.io/Metro-Istanbul-General-City-Map/legal/privacy.html'), [], 'a legal page was stored as the app shell: the next offline launch would open it instead of the app');
  assert.deepStrictEqual(await nav('https://example.github.io/Metro-Istanbul-General-City-Map/legal/privacy.tr.html'), []);
  assert.deepStrictEqual(await nav('https://example.github.io/Metro-Istanbul-General-City-Map/'), ['shell'], 'the app page is no longer stored for offline launches');
  assert.deepStrictEqual(await nav('https://example.github.io/Metro-Istanbul-General-City-Map/?city=ankara'), ['shell'], 'the app page with a query string is no longer stored for offline launches');
});

test('Settings and the welcome dialog link all four legal pages and the legal links follow the language', () => {
  const html = markup();
  const settings = /<details class="sp-sec" data-sec="about">[\s\S]*?<\/details>/.exec(html);
  assert.ok(settings, 'no About & legal section in Settings');
  for (const p of ['privacy', 'terms', 'storage', 'credits']) assert.ok(settings[0].includes('data-legal="' + p + '"'), 'Settings does not link the ' + p + ' page');
  const wc = /<div class="wc-overlay"[\s\S]*?<\/div>\s*<\/div>/.exec(html)[0];
  for (const p of ['privacy', 'terms', 'credits']) assert.ok(wc.includes('data-legal="' + p + '"'), 'the welcome dialog does not link the ' + p + ' page');
  const fn = fnSource(script(), 'syncLegalLinks');
  const links = [{ attrs: { 'data-legal': 'privacy' } }].map(l => { l.setAttribute = (k, v) => { l.attrs[k] = v; }; l.getAttribute = k => l.attrs[k]; return l; });
  for (const [language, want] of [['tr', 'legal/privacy.tr.html'], ['en', 'legal/privacy.html'], ['ar', 'legal/privacy.html'], ['fr', 'legal/privacy.html']]) {
    const ctx = vm.createContext({ lang: language, document: { querySelectorAll: () => links } });
    vm.runInContext(fn + '\nsyncLegalLinks()', ctx);
    assert.strictEqual(links[0].attrs.href, want, 'in ' + language + ' the privacy link points at ' + links[0].attrs.href);
  }
});
