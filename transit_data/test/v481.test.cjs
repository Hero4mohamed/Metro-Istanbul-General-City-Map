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
  const ctx = { Map, Math };
  vm.createContext(ctx);
  vm.runInContext([foldSrc(), fnSrc('noticeStationIndex'), fnSrc('noticeSections'), 'this.api = { noticeSections };'].join('\n'), ctx);
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
