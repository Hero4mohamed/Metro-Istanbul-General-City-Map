'use strict';
/* V4.8.1: (1) a place pin goes away the way people expect — with its pop-up, with Back, with the search's ✕ — instead of staying
 * until the app is reloaded; (2) a closed or affected SECTION of a line is drawn with the red-and-yellow caution band again (the
 * owner asked for it back), with the line's own colour down its middle so the band still says WHICH line; and a notice that only
 * names its stretches in words ("normal between A and B, a shuttle between C and D", M7 on 18 Nov 2026) is drawn as those sections.
 * The pure parts run the app's real code in a vm sandbox; the drawing is read from the built app. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const APP = () => H.appScript().replace(/\r\n/g, '\n');
function fnSrc(name) {
  const s = APP(), i = s.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'function ' + name + ' not found');
  let depth = 0, k = s.indexOf('{', s.indexOf(')', i));
  for (let j = k; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) return s.slice(i, j + 1); }
  throw new Error('unbalanced ' + name);
}
function line1(prefix) { const l = APP().split('\n').find(x => x.trim().startsWith(prefix)); assert.ok(l, prefix + ' not found'); return l; }
function foldSrc() { const s = APP(), a = s.indexOf('const _foldMemo = new Map();'), b = s.indexOf('};', s.indexOf('const fold = s => {')); return s.slice(a, b + 2); }
const tick = () => new Promise(r => setTimeout(r, 10));

/* ---- 1. the place pin ---- */
function pinEnv() {
  const removed = [], made = [], nav = { n: 0 };
  const L = {
    divIcon: o => o,
    marker: ll => {
      const m = { ll, handlers: {}, open: false,
        on(ev, f) { (this.handlers[ev] = this.handlers[ev] || []).push(f); return this; },
        fire(ev) { (this.handlers[ev] || []).forEach(f => f()); },
        bindPopup() { return this; }, openPopup() { this.open = true; return this; },
        closePopup() { if (this.open) { this.open = false; this.fire('popupclose'); } return this; },
        isPopupOpen() { return this.open; }, addTo() { return this; } };
      made.push(m); return m;
    },
  };
  const map = { removeLayer: m => { removed.push(m); if (m.open) m.closePopup(); }, flyTo() {}, getZoom: () => 14, getSize: () => ({ x: 800, y: 600 }) };
  const ctx = { Math, isFinite, L, map, setTimeout, nearestStops: () => [], svgEsc: s => String(s), t: k => k, favIsSaved: () => false,
    walkMin: () => 1, navReconcile: () => { nav.n++; } };
  vm.createContext(ctx);
  vm.runInContext([line1('let pinMarker = null, pinPlace = null;'), fnSrc('mapUsable'), fnSrc('dropPin'), fnSrc('removePin'),
    'this.api = { dropPin, removePin, get pin(){ return pinMarker; }, get place(){ return pinPlace; } };'].join('\n'), ctx);
  return { api: ctx.api, removed, made, nav };
}
const MODA = { name: 'Moda', lat: 40.98, lng: 29.02 };

test('v4.8.1: closing a pin\'s pop-up takes the pin off the map', async () => {
  const e = pinEnv();
  e.api.dropPin(MODA);
  const m = e.made[0];
  assert.ok(m && m.open && e.api.pin === m, 'the pin is on the map with its pop-up open');
  m.closePopup(); await tick();
  assert.strictEqual(e.api.pin, null, 'the pin is gone');
  assert.ok(e.removed.includes(m), 'it was taken off the map');
  assert.strictEqual(e.api.place, null, 'and its place is forgotten, so its buttons cannot act on it any more');
});

test('v4.8.1: a pop-up that closes and opens again in the same moment keeps its pin', async () => {
  const e = pinEnv();
  e.api.dropPin(MODA);
  const m = e.made[0];
  m.closePopup(); m.openPopup(); await tick();
  assert.strictEqual(e.api.pin, m, 'a re-opened pop-up (Leaflet does this when it redraws one) must not lose its pin');
});

test('v4.8.1: a new pin replaces the old one, and the old one\'s closing does not take the new one away', async () => {
  const e = pinEnv();
  e.api.dropPin(MODA);
  e.api.dropPin({ name: 'Kadıköy', lat: 40.99, lng: 29.03 });
  await tick();
  assert.strictEqual(e.made.length, 2);
  assert.ok(e.removed.includes(e.made[0]), 'the first pin is gone');
  assert.strictEqual(e.api.pin, e.made[1], 'the second pin stays');
});

test('v4.8.1: Back takes the pin away, and the search box\'s ✕ does too', () => {
  const e = pinEnv();
  e.api.dropPin(MODA);
  assert.ok(e.nav.n >= 1, 'dropping a pin tells the Back button about it');
  const before = e.nav.n; e.api.removePin();
  assert.strictEqual(e.api.pin, null); assert.ok(e.nav.n > before, 'and so does removing it');
  const s = APP();
  assert.ok(/\{ id:'pin',\s+open:\(\) => typeof pinMarker !== 'undefined' && !!pinMarker, close:\(\) => removePin\(\) \}/.test(s), 'the pin is a layer of the Back button');
  assert.ok(/xb\.addEventListener\("click", \(\)=>\{ removePin\(\); inp\.value="";/.test(s), 'the search box\'s ✕ takes the pin away');
});

/* ---- 2. sections named only in a notice's words ---- */
function notice() {
  const ctx = { Map, Math, String, Array };
  vm.createContext(ctx);
  /* since V4.9 noticeSections() merges the stretches read by the planner's code (07b-notice-routing.js, NOTICE-ROUTE-PURE) */
  const s = APP(), a = s.indexOf('/* ==NOTICE-ROUTE-PURE-START== */'), b = s.indexOf('/* ==NOTICE-ROUTE-PURE-END== */');
  vm.runInContext([foldSrc(), fnSrc('noticeStationIndex'), s.slice(a, b), fnSrc('noticeSections'), 'this.api = { noticeSections };'].join('\n'), ctx);
  return ctx.api;
}
const M7 = require(path.join(__dirname, '..', 'lines.json')).find(l => l.ref === 'M7').stations;
const nameAt = i => M7[i].name;

test('v4.8.1: M7\'s notice ("normal between Nurtepe and Mahmutbey, a shuttle to Kağıthane") marks Nurtepe → Yıldız', () => {
  const api = notice();
  const txt = 'Teknik bir arıza nedeniyle seferler Nurtepe-Mahmutbey arasında normal işletme döngüsünde, Nurtepe-Kağıthane arasında ise mekik seferi olarak yapılmaktadır.';
  const got = Array.from(api.noticeSections(M7, txt), p => [nameAt(p[0]), nameAt(p[1])]);
  assert.deepStrictEqual(got, [['Nurtepe', 'Yıldız']], 'everything outside the normal stretch is affected: the shuttle to Kağıthane and beyond');
});

test('v4.8.1: a normal stretch in the middle leaves two affected ends; a shuttle alone marks just its stretch', () => {
  const api = notice();
  const mid = Array.from(api.noticeSections(M7, 'seferler Alibeyköy-Kağıthane arasında normal işletme döngüsündedir.'), p => [nameAt(p[0]), nameAt(p[1])]);
  assert.deepStrictEqual(mid, [['Mahmutbey', 'Alibeyköy'], ['Kağıthane', 'Yıldız']]);
  const sh = Array.from(api.noticeSections(M7, 'Seferler Çağlayan-Fulya arasında mekik seferi olarak yapılmaktadır.'), p => [nameAt(p[0]), nameAt(p[1])]);
  assert.deepStrictEqual(sh, [['Çağlayan', 'Fulya']]);
});

test('v4.8.1: nothing is guessed — unknown stations, a whole-line "normal", or no such words mark nothing', () => {
  const api = notice();
  assert.strictEqual(api.noticeSections(M7, 'seferler Atlantis-Mahmutbey arasında normal işletme döngüsünde').length, 0, 'a station not on the line');
  assert.strictEqual(api.noticeSections(M7, 'seferler Mahmutbey-Yıldız arasında normal işletme döngüsünde').length, 0, 'normal end to end: nothing affected');
  assert.strictEqual(api.noticeSections(M7, 'Asansör bakım nedeniyle kullanılamamaktadır.').length, 0, 'no stretch named');
  assert.strictEqual(api.noticeSections(M7, '').length, 0);
  assert.strictEqual(api.noticeSections(null, 'x').length, 0);
});

test('v4.8.1: a notice that is not a "segment" is drawn as the sections its words name (a suspended line stays dashed)', () => {
  const src = fnSrc('disruptionPaths');
  assert.ok(/noticeSections\(line\.stations, d\.messageTr\)/.test(src), 'disruptionPaths reads the sections from the operator\'s own Turkish words');
  assert.ok(/const bands = suspended \? \[\] : disruptionPaths\(d\)/.test(APP()), 'a fully suspended line still gets no band end to end');
});

/* ---- 3. the caution band is back, and still says which line ---- */
test('v4.8.1: an affected section gets the red-and-yellow caution band, with the line\'s own colour down its middle', () => {
  const s = APP(), b = s.slice(s.indexOf('bands.forEach(coords=>{'), s.indexOf('// warning marker(s)'));
  for (const [v, colour] of [['aura', "'#D42A2A'"], ['red', "'#D42A2A'"], ['yellow', "'#F5C518'"], ['seam', 'line.color'], ['hit', 'col']])
    assert.ok(new RegExp('const ' + v + '\\s*= sharedPolyline\\(line, 0, coords, \\{ renderer:hazardRenderer, color:' + colour.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(b), v + ' in ' + colour);
  const seam = b.match(/const seamW\s*= Math\.max\([\d.]+, core \* ([\d.]+)\);/);
  assert.ok(seam && parseFloat(seam[1]) >= 0.5, 'the line\'s colour down the middle is at least half the line\'s own width, so you can still tell which line it is');
  const order = ['aura.addTo', 'red.addTo', 'yellow.addTo', 'seam.addTo', 'hit.addTo'].map(x => b.indexOf(x));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'drawn glow, red, yellow, the line\'s colour, then the invisible tap line on top');
});

/* ---- 4. notifications that ring, open the app when tapped, and can be checked from Settings ---- */
function notifyEnv() {
  const shown = [], toasts = [];
  const reg = { showNotification: (title, o) => { shown.push({ title, o }); return Promise.resolve(); } };
  const ctx = { Notification: { permission: 'granted' }, navigator: { serviceWorker: { ready: Promise.resolve(reg) } },
    window: {}, location: { pathname: '/app/', search: '?city=istanbul' }, showToast: (m) => toasts.push(m), Date, Math, Promise };
  ctx.window.Notification = ctx.Notification;
  vm.createContext(ctx);
  vm.runInContext(fnSrc('notifyOpts') + '\n' + fnSrc('notify') + '\nthis.api = { notify, notifyOpts };', ctx);
  return { api: ctx.api, shown, toasts };
}
test('v4.8.1: a notification rings each time: its own tag, "alert again", a vibration, and where tapping it goes', async () => {
  const e = notifyEnv();
  e.api.notify('T1', 'one'); e.api.notify('T2', 'two', null, 'rem-r1');
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(e.shown.length, 2);
  const [a, b] = e.shown.map(x => x.o);
  assert.ok(a.tag && a.tag !== 'irn-alert' && a.tag !== b.tag, 'every notification has its own tag (one shared tag made each new one replace the last SILENTLY)');
  assert.strictEqual(b.tag, 'rem-r1', 'a caller can name the tag, so a newer heads-up for the same reminder replaces the older one');
  assert.ok(a.renotify === true && b.renotify === true, 'a replaced notification still rings');
  assert.ok(Array.isArray(a.vibrate) && a.vibrate.length >= 1 && a.silent === false, 'it vibrates and is not silent');
  assert.strictEqual(a.data.url, '/app/?city=istanbul', 'tapping it opens this page of the app');
  assert.deepStrictEqual(e.toasts, ['one', 'two'], 'the in-app message is still shown as well');
});
test('v4.8.1: a reminder and a line alert each name their own tag', () => {
  const s = APP();
  assert.ok(/notify\(t\('remNotifyTitle'\)[\s\S]{0,260}?, null, 'rem-' \+ a\.r\.id\)/.test(fnSrc('remTick')), 'a reminder\'s heads-up is tagged by reminder');
  assert.ok(/notify\('⚠ '\+d\.ref\+' · '\+disTitle\(d\), body, d\.severity==='major'\?'err':null, 'dis-'\+d\.id\)/.test(s), 'a line alert is tagged by its notice');
});

/* the service worker's tap handler, run against a stand-in for the browser */
function swTap(windows) {
  const src = require('fs').readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf("self.addEventListener('notificationclick'");
  assert.ok(i >= 0, 'the service worker has no handler for a tapped notification');
  let depth = 0, k = src.indexOf('{', i), end = -1;
  for (let j = k; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) { end = src.indexOf(');', j) + 2; break; } }
  const handlers = {}, opened = [], focused = [];
  const self = { registration: { scope: 'https://x.test/app/' }, addEventListener: (t, f) => { handlers[t] = f; },
    clients: { matchAll: async () => windows.map(u => ({ url: u, focus: async () => { focused.push(u); }, navigate: async () => {} })),
               openWindow: async u => { opened.push(u); } } };
  const ctx = { self, URL, Promise };
  vm.createContext(ctx); vm.runInContext(src.slice(i, end), ctx);
  return async (url) => {
    let closed = false, wait = null;
    await handlers.notificationclick({ notification: { data: url === undefined ? undefined : { url }, close: () => { closed = true; } }, waitUntil: p => { wait = p; } });
    if (wait) await wait;
    return { closed, opened, focused };
  };
}
test('v4.8.1: tapping a notification closes it and opens TurkMaps (or brings it to the front)', async () => {
  let r = await swTap([])('/app/?city=istanbul');
  assert.ok(r.closed, 'the tapped notification is closed');
  assert.deepStrictEqual(r.opened, ['https://x.test/app/?city=istanbul'], 'the app is opened where the notification points');
  r = await swTap(['https://x.test/app/?city=ankara'])('/app/?city=istanbul');
  assert.deepStrictEqual(r.focused, ['https://x.test/app/?city=ankara'], 'an app already open is brought to the front');
  assert.deepStrictEqual(r.opened, [], 'and no second copy is opened');
  r = await swTap([])('https://evil.example/');
  assert.deepStrictEqual(r.opened, ['https://x.test/app/'], 'a link outside the app is never opened: the app itself is');
  r = await swTap([])(undefined);
  assert.deepStrictEqual(r.opened, ['https://x.test/app/'], 'a notification with no link opens the app');
});

test('v4.8.1: Settings says whether notifications are on, can ask for them, and can send a test', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fnSrc('notifStateKey') + '\nthis.f = notifStateKey;', ctx);
  assert.deepStrictEqual(['granted', 'default', 'denied', undefined].map(ctx.f), ['notifOn', 'notifOff', 'notifBlocked', 'notifNone']);
  const html = require('fs').readFileSync(path.join(__dirname, '..', 'app.template.html'), 'utf8');
  for (const id of ['notifRow', 'notifState', 'notifAllow', 'notifTest']) assert.ok(html.includes('id="' + id + '"'), 'Settings has #' + id);
  const i18n = require('fs').readFileSync(path.join(__dirname, '..', 'src', '01-i18n.js'), 'utf8');
  for (const k of ['notifTitle', 'notifOn', 'notifOff', 'notifBlocked', 'notifNone', 'notifAllow', 'notifTest', 'notifTestTitle', 'notifTestBody', 'notifHint'])
    assert.strictEqual((i18n.match(new RegExp('(^|[^A-Za-z])' + k + ':"', 'gm')) || []).length, 4, k + ' in all four languages');
  assert.ok(/notify\(t\('notifTestTitle'\), t\('notifTestBody'\), null, 'test'\)/.test(APP()), 'the test button sends a real notification through the same path as reminders');
});

test('v4.8.1: the privacy notice says what a notification does when tapped, and what the test is', () => {
  const s = require('fs').readFileSync(path.join(__dirname, '..', 'legal-content.cjs'), 'utf8');
  const en = s.slice(s.indexOf('<h2 id="notify">7. Notifications</h2>'), s.indexOf('<h2', s.indexOf('<h2 id="notify">7. Notifications</h2>') + 5));
  const tr = s.slice(s.indexOf('<h2 id="notify">7. Bildirimler</h2>'), s.indexOf('<h2', s.indexOf('<h2 id="notify">7. Bildirimler</h2>') + 5));
  assert.ok(/test notification/i.test(en) && /opens TurkMaps/.test(en), 'EN: the test, and tapping opens the app');
  assert.ok(/deneme bildirimi/i.test(tr) && /TurkMaps.{0,20}açılır/.test(tr), 'TR: the same');
  assert.ok(/while the app is running/.test(en) && /calendar/.test(en), 'EN still says when reminders can ring and offers the calendar');
});
