/* The map's stations by keyboard and screen reader (V4.3). Stations are circles on a canvas; N / P step through the ones in view, Enter
 * opens one, L lists them, Escape clears the choice. The real module (src/25-map-keyboard.js, taken out of the built page) runs here
 * against a stand-in for the map, so "which station is next, and is it announced and drawn" is checked without a browser.
 * (A first version cleared its own index while marking the ring and announced nothing: only a test like this sees that.)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const script = () => H.appScript().replace(/\r\n/g, '\n');
const pt = (x, y) => ({ x, y, distanceTo: o => Math.hypot(x - o.x, y - o.y), divideBy: n => pt(x / n, y / n) });
const st = (name, lat, lng, lines) => ({ name, lat, lng, lines: new Set(lines) });

function world({ tab = 'active', zoom = 15, stations = [], planned = [], lineOn = { M1: true, M2: true }, focus = null } = {}) {
  const s = script();
  const i = s.indexOf('var kmOpenFinder = null;');
  assert.ok(i > 0, 'the station keyboard module is not in the page');
  const src = s.slice(i);                       // it is the last file of the script
  const handlers = {}, made = [], removed = [], opened = [], said = [];
  const mkEl = id => { const e = { id, hidden: false, innerHTML: '', _cls: new Set(), listeners: {}, classList: { add: c => e._cls.add(c), remove: c => e._cls.delete(c), contains: c => e._cls.has(c) }, addEventListener(t, f) { e.listeners[t] = f; }, textContent: '' }; return e; };
  const els = Object.fromEntries(['mapLive', 'stnFinder', 'finderOverlay', 'finderList', 'finderNone', 'finderX', 'stnFinderBtn'].map(id => [id, mkEl(id)]));
  const cont = mkEl('map');
  const map = { getContainer: () => cont, getSize: () => pt(400, 800), latLngToContainerPoint: ll => pt(ll[1], ll[0]), getZoom: () => zoom, getCenter: () => ({ lat: 400, lng: 200 }),
    getRotation: () => 0, on() {}, removeLayer: l => removed.push(l) };
  const layer = (kind, ll, o) => { const l = { kind, ll, o, addTo() { made.push(l); return l; }, bindTooltip(txt) { l.tip = txt; return l; }, openTooltip() { return l; } }; return l; };
  const ctx = vm.createContext({ document: { getElementById: id => els[id] || null, body: {} }, getComputedStyle: () => ({ getPropertyValue: () => '#0a7' }), map, L: { circleMarker: (ll, o) => layer('ring', ll, o) },
    currentTab: tab, stationList: stations, plannedStationList: planned, lineLayers: Object.fromEntries(Object.keys(lineOn).map(k => [k, { on: lineOn[k] }])), lineByRef: { M1: { ref: 'M1' }, M2: { ref: 'M2' } },
    STOP_MIN_ZOOM: 12, focusRefs: focus, stationRenderer: {}, svgEsc: x => String(x),
    t: k => ({ stnPick: '{name}{ix}. Lines {lines}. {n} of {total}.', stnIx: ' (interchange)', stnOpened: 'Opened {name}.', stnCleared: 'cleared', finderNone: 'none in view' }[k] || k),
    openStation: r => opened.push('station:' + r.name), openLine: l => opened.push('line:' + l.ref), setTimeout: f => { f(); return 0; } });
  vm.runInContext(src, ctx);
  const key = (k, extra = {}) => { let prevented = false, stopped = false; cont.listeners.keydown(Object.assign({ key: k, target: cont, ctrlKey: false, altKey: false, metaKey: false, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }, extra)); return { prevented, stopped }; };
  return { key, els, cont, made, removed, opened, live: () => els.mapLive.textContent, ctx };
}
const near = [st('Far', 700, 200, ['M1']), st('Near', 410, 205, ['M1']), st('Middle', 450, 260, ['M1', 'M2'])];

test('N steps to the nearest station to the centre first, then outward; P goes back and wraps; each is announced and ringed', () => {
  const w = world({ stations: near });
  w.key('n'); assert.strictEqual(w.live(), 'Near. Lines M1. 1 of 3.', 'the first N is not the nearest station, or says nothing: ' + w.live());
  w.key('n'); assert.match(w.live(), /^Middle \(interchange\)\. Lines M1, M2\. 2 of 3\.$/);
  w.key('N'); assert.match(w.live(), /^Far\. .* 3 of 3\.$/);
  w.key('n'); assert.match(w.live(), /^Near\. .* 1 of 3\.$/, 'N does not wrap round');
  w.key('p'); assert.match(w.live(), /^Far\. .* 3 of 3\.$/, 'P does not wrap back');
  assert.ok(w.made.length >= 2 && w.made.every(l => l.kind === 'ring'), 'a ring is not drawn');
  assert.ok(w.made[w.made.length - 1].tip === 'Far', 'the ring does not carry the station\'s name');
  assert.ok(w.removed.length >= 2, 'the old ring is not taken off before the next is drawn');
});

test('Enter opens the chosen station (the panel a tap opens), Escape clears the choice, and neither does anything with nothing chosen', () => {
  const w = world({ stations: near });
  assert.strictEqual(w.key('Enter').prevented, false, 'Enter with no station chosen was swallowed');
  w.key('n'); w.key('n'); const r = w.key('Enter');
  assert.deepStrictEqual(w.opened, ['station:Middle']); assert.ok(r.prevented && r.stopped); assert.strictEqual(w.live(), 'Opened Middle.');
  const before = w.removed.length; w.key('Escape'); assert.strictEqual(w.live(), 'cleared'); assert.ok(w.removed.length > before, 'Escape left the ring on the map');
  assert.strictEqual(w.key('Escape').stopped, false, 'Escape with nothing chosen must go on to close panels');
});

test('only what is drawn is offered: plain stops wait for zoom 12, switched-off lines and off-screen stops are left out, nothing while a route is focused', () => {
  const stations = [st('Plain', 410, 205, ['M1']), st('Interchange', 450, 260, ['M1', 'M2']), st('Hidden line', 420, 210, ['M2']), st('Off screen', 900, 200, ['M1'])];
  let w = world({ stations, zoom: 11, lineOn: { M1: true, M2: false } });
  w.key('n'); assert.match(w.live(), /^Interchange/, 'at zoom 11 only interchanges are drawn; M2 is off so even the interchange stays via M1');
  w.key('n'); assert.match(w.live(), / 1 of 1\.$/, 'a stop that is not drawn was offered: ' + w.live());
  w = world({ stations, zoom: 15, lineOn: { M1: true, M2: false } }); w.key('n');
  const list = []; for (let i = 0; i < 4; i++) { w.key('n'); list.push(w.live().split('.')[0]); }
  assert.ok(!list.some(x => /Hidden line|Off screen/.test(x)), 'a station on a switched-off line or off the screen was offered: ' + list);
  w = world({ stations, focus: { M1: true } }); w.key('n'); assert.strictEqual(w.live(), 'none in view', 'stations were offered while a route is focused (they are not drawn)');
});

test('on the Vision tab the planned stops are offered and Enter opens their line; keys are ignored unless the map itself has focus and no modifier is held', () => {
  const w = world({ tab: 'vision', planned: [{ ref: 'M2', name: 'Planned', lat: 410, lng: 205 }] });
  w.key('n'); w.key('Enter'); assert.deepStrictEqual(w.opened, ['line:M2']);
  const v = world({ stations: near });
  v.key('n', { target: {} }); assert.strictEqual(v.live(), '', 'a key typed in another element moved the map selection');
  v.key('n', { ctrlKey: true }); assert.strictEqual(v.live(), '', 'Ctrl+N was taken from the browser');
  assert.strictEqual(world({ tab: 'bus', stations: near }).key('n').prevented, true);   // the bus scope has no stations drawn: still handled, says "none in view"
});

test('L lists the stations in view as buttons, nearest first, and choosing one rings it and opens it', () => {
  const w = world({ stations: near });
  w.key('l');
  const html = w.els.finderList.innerHTML; assert.ok(/data-i="0"[\s\S]*Near[\s\S]*data-i="1"[\s\S]*Middle[\s\S]*◆[\s\S]*data-i="2"[\s\S]*Far/.test(html), 'the list is not nearest first, or lacks the interchange mark: ' + html);
  assert.ok(w.els.stnFinder.classList.contains('open') && w.els.finderOverlay.classList.contains('on') && w.els.finderNone.hidden === true);
  w.els.finderList.listeners.click({ target: { closest: () => ({ dataset: { i: '1' } }) } });
  assert.deepStrictEqual(w.opened, ['station:Middle']); assert.ok(!w.els.stnFinder.classList.contains('open'), 'choosing a station left the list open');
  // empty view: the list says so
  const e = world({ stations: [] }); e.key('l'); assert.strictEqual(e.els.finderNone.hidden, false);
});

test('the list is a modal layer of the back button and the dialog manager, the map describes its keys, and the button is reachable by Tab', () => {
  const s = script(), h = H.html();
  assert.match(s, /\{ id:'finder',\s+open:\(\) => navHas\('stnFinder','open'\)/, 'the list is not a layer of the back button');
  assert.match(s, /\['stn','linp','nearPanel','passPanel','stnFinder'/, 'the list is not watched for opening and closing');
  assert.match(s, /id: 'stnFinder',\s+cls: 'open', modal: true/, 'the list is not a managed modal dialog (focus, Tab trap, inert when closed)');
  assert.match(s, /map\.setAttribute\('aria-describedby', 'mapHelp'\)/, 'the map does not point at its key help');
  assert.match(h, /<button id="stnFinderBtn" class="sr-focusable"/, 'no Browse stations button');
  assert.match(h, /id="mapLive" class="sr-only" role="status" aria-live="polite"/, 'no live region for announcements');
  const dict = H.i18nValues();
  for (const L of ['en', 'tr', 'ar', 'fr']) for (const k of ['mapKeys', 'finderBtn', 'finderTitle', 'finderNone', 'stnPick', 'stnIx', 'stnOpened', 'stnCleared'])
    assert.ok(dict[L][k] && String(dict[L][k]).trim(), L + ' lacks ' + k);
  for (const L of ['en', 'tr', 'ar', 'fr']) for (const ph of ['{name}', '{lines}', '{n}', '{total}']) assert.ok(dict[L].stnPick.includes(ph), L + '.stnPick lost its ' + ph);
});
