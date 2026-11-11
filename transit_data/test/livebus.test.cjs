'use strict';
/* Live buses (V4.5): the real positions İzmir's open-data service publishes for a bus line, drawn while the line is open.
 * The answers used here are the shape of real ones, recorded from openapi.izmir.bel.tr on 11 Nov 2026 (line 302): a bus listed four
 * times with three frozen positions, a bus that moves between answers, a "0","0" record, and the service's "rate limit" refusal.
 * Each test runs the REAL built code. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const APP = H.appScript().replace(/\r\n/g, '\n');
function fnSource(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = src.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1); }
  throw new Error('unbalanced braces in ' + name);
}
const PURE = APP.slice(APP.indexOf('/* ==LIVEBUS-PURE-START== */'), APP.indexOf('/* ==LIVEBUS-PURE-END== */'));
assert.ok(PURE.length > 500, 'the live-bus rules are not in the built page');
const P = (() => { const m = { exports: {} }; new Function('module', PURE + '\nmodule.exports = { LIVE_BUS_SOURCES, LIVE_BUS_EVERY, LIVE_BUS_SLOWEST, LIVE_BUS_STILL, liveBusURL, liveBusParse, liveBusStep, liveBusStanding, liveBusWait };')(m); return m.exports; })();
const BOX = P.LIVE_BUS_SOURCES.izmir.box;
const rec = (id, lat, lng) => ({ OtobusId: id, Yon: 1, KoorX: String(lat).replace('.', ','), KoorY: String(lng).replace('.', ',') });
const answer = list => ({ HataMesaj: '', HatOtobusKonumlari: list, HataVarMi: false });
// the four records the service really sent for bus 1746 (three of them never changed in a minute and a half), and two other buses
const GHOSTS = [rec(1746, 38.43809, 27.168275), rec(1746, 38.43801333, 27.1674), rec(1746, 38.438025, 27.16734)];

test('live buses: only real positions inside the city are kept, and the latitude is the one the service calls KoorX', () => {
  const out = P.liveBusParse(answer([rec(1701, 38.42465667, 27.13232833), { OtobusId: 11288, Yon: 0, KoorY: '0', KoorX: '0' }, rec(7, 41.0, 29.0), { Yon: 1, KoorX: '38,4', KoorY: '27,1' }]), BOX);
  assert.deepStrictEqual(out, [{ id: '1701', lat: 38.42465667, lng: 27.13232833 }], 'a lost bus (0,0), a position outside İzmir or a record with no bus number got through, or the decimal commas were misread');
  assert.strictEqual(P.liveBusParse({ message: 'API rate limit exceeded' }, BOX), null, 'a refusal was read as "no buses"');
  assert.strictEqual(P.liveBusParse({ HataMesaj: 'x', HatOtobusKonumlari: [], HataVarMi: true }, BOX), null, 'an error was read as "no buses"');
  assert.deepStrictEqual(P.liveBusParse(answer([]), BOX), [], 'an empty line is an answer: no buses');
});

test('live buses: a bus listed at several places is drawn only where it is seen to move', () => {
  const t0 = 1000000;
  let r = P.liveBusStep(new Map(), P.liveBusParse(answer([...GHOSTS, rec(1746, 38.429055, 27.21262667), rec(1701, 38.42465667, 27.13232833)]), BOX), t0);
  assert.deepStrictEqual(r.buses.map(b => b.id), ['1701'], 'a bus listed at four places was drawn before anything showed which place is real');
  assert.strictEqual(r.unplaced, 1, 'the bus that cannot be placed yet is not counted');
  assert.strictEqual(r.buses[0].moved, null, 'a bus seen once cannot be known to have moved');
  // 20 s later: 1701 has driven on, and one of 1746's four records has changed by a metre (a standing bus still jitters)
  r = P.liveBusStep(r.state, P.liveBusParse(answer([...GHOSTS, rec(1746, 38.429055, 27.212625), rec(1701, 38.42309167, 27.13135333)]), BOX), t0 + 20000);
  const b46 = r.buses.find(b => b.id === '1746'), b01 = r.buses.find(b => b.id === '1701');
  assert.ok(b46 && b46.lat === 38.429055 && b46.lng === 27.212625, 'the bus was not drawn at the one record that changed');
  assert.strictEqual(b46.moved, t0 + 20000);
  assert.ok(b01.lat === 38.42309167 && b01.moved === t0 + 20000, 'a bus listed once did not follow its new position');
  assert.strictEqual(r.unplaced, 0);
  // nothing changes: both stay where they were, with the time of their last move kept
  r = P.liveBusStep(r.state, P.liveBusParse(answer([...GHOSTS, rec(1746, 38.429055, 27.212625), rec(1701, 38.42309167, 27.13135333)]), BOX), t0 + 40000);
  assert.deepStrictEqual(r.buses.map(b => [b.id, b.lat, b.moved]).sort(), [['1701', 38.42309167, t0 + 20000], ['1746', 38.429055, t0 + 20000]]);
  // the frozen records alone, with the real one gone: nothing to draw for that bus, never a ghost
  r = P.liveBusStep(r.state, P.liveBusParse(answer(GHOSTS), BOX), t0 + 60000);
  assert.deepStrictEqual(r.buses, [], 'a frozen record was drawn as the bus');
  // a bus that leaves the answer leaves the map
  r = P.liveBusStep(r.state, [], t0 + 80000);
  assert.strictEqual(r.state.size, 0);
});

test('live buses: a bus that has not changed place for two minutes is marked as standing', () => {
  const t0 = 5000000, one = () => P.liveBusParse(answer([rec(1615, 38.422285, 27.14557167)]), BOX);
  let r = P.liveBusStep(new Map(), one(), t0);
  assert.strictEqual(P.liveBusStanding(r.buses[0], t0), false, 'a bus just seen is not known to be standing');
  for (let k = 1; k <= 6; k++) r = P.liveBusStep(r.state, one(), t0 + k * 20000);
  assert.strictEqual(r.buses[0].moved, null, 'an unchanged position was counted as a move');
  assert.strictEqual(P.liveBusStanding(r.buses[0], t0 + 120000), true, 'two minutes at one place and still drawn as moving: a frozen record would look live');
  r = P.liveBusStep(r.state, P.liveBusParse(answer([rec(1615, 38.42236667, 27.14597667)]), BOX), t0 + 140000);
  assert.strictEqual(P.liveBusStanding(r.buses[0], t0 + 140000), false, 'a bus that moved is still marked as standing');
  assert.strictEqual(P.liveBusStanding(r.buses[0], t0 + 140000 + P.LIVE_BUS_STILL), true);
});

test('live buses: only a city that publishes positions is asked, and only for a line number', () => {
  assert.strictEqual(P.liveBusURL('izmir', '302'), 'https://openapi.izmir.bel.tr/api/iztek/hatotobuskonumlari/302');
  for (const city of ['istanbul', 'ankara', 'bursa', 'antalya', 'kocaeli']) assert.strictEqual(P.liveBusURL(city, '302'), null, city + ' has no live source a web page can read; nothing may be asked (or drawn) there');
  for (const ref of ['', '34AS', '../x', '5?x=1', '123456']) assert.strictEqual(P.liveBusURL('izmir', ref), null, 'something that is not a line number was put in the address: ' + ref);
  assert.deepStrictEqual(Object.keys(P.LIVE_BUS_SOURCES), ['izmir']);
});

/* ---- the asking itself, with the page, the clock and the service played by the test ---- */
function world(over) {
  const timers = [], asked = [], drawn = [];
  const strip = { className: '', title: '', text: { textContent: '' }, querySelector() { return this.text; } };
  const group = { clearLayers() { drawn.length = 0; }, addTo() { return this; } };
  const marker = o => ({ o, bindTooltip() { return this; }, addTo() { if (o.interactive !== false) drawn.push(o); return this; } });
  const ctx = Object.assign({
    currentTab: 'bus', CITY_ID: 'izmir', lang: 'en', Date, Math, Map, Set, String, parseFloat, isFinite, Array, Promise, AbortController,
    document: { hidden: false, getElementById: id => id === 'liveBusStrip' ? strip : null, addEventListener() {} },
    window: { addEventListener() {} }, navigator: { onLine: true },
    setTimeout: (fn, ms) => { if (ms === 12000) return 0; timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    L: { layerGroup: () => group, circleMarker: (ll, o) => marker(Object.assign({ ll }, o)) },
    map: { getPane: () => true, createPane: () => ({ style: {} }), removeLayer() {} },
    MAP_T: () => ({ hole: '#FFFFFF' }), t: k => k, svgEsc: s => s,
    fetch: url => { let done; const p = new Promise(r => { done = r; }); asked.push({ url, answer: (json, status) => done({ ok: (status || 200) === 200, status: status || 200, json: async () => json }) }); return p; },
  }, over || {});
  vm.createContext(ctx);
  vm.runInContext(PURE + '\nvar liveBus = null, liveBusGroup = null;\n' + ['liveBusStop', 'liveBusStart', 'liveBusAgain', 'liveBusPoll', 'liveBusShow'].map(n => fnSource(APP, n)).join('\n'), ctx);
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
  return { ctx, timers, asked, drawn, strip, settle, live: () => vm.runInContext('liveBus', ctx) };
}

test('live buses: nothing is asked while the page is hidden or offline, or once the bus view has been left', async () => {
  let w = world(); w.ctx.document.hidden = true;
  w.ctx.liveBusStart('302'); await w.settle();
  assert.strictEqual(w.asked.length, 0, 'the service was asked while nobody could see the map');
  assert.strictEqual(w.timers[w.timers.length - 1].ms, P.LIVE_BUS_EVERY, 'the next look is not booked');
  w = world(); w.ctx.navigator.onLine = false;
  w.ctx.liveBusStart('302'); await w.settle();
  assert.strictEqual(w.asked.length, 0, 'a request was made with no connection');
  assert.strictEqual(w.strip.text.textContent, 'liveBusOffline', 'the strip does not say why there are no buses');
  w = world(); w.ctx.liveBusStart('302'); await w.settle();
  assert.strictEqual(w.asked.length, 1);
  w.asked[0].answer(answer([rec(1701, 38.42465667, 27.13232833)])); await w.settle();
  assert.strictEqual(w.drawn.length, 1, 'the bus the service sent is not on the map');
  assert.deepStrictEqual(Array.from(w.drawn[0].ll), [38.42465667, 27.13232833]);
  assert.strictEqual(w.strip.text.textContent, 'liveBusOne');
  w.ctx.currentTab = 'active';                        // the view was left without the tab code stopping it
  w.timers[w.timers.length - 1].fn(); await w.settle();
  assert.strictEqual(w.asked.length, 1, 'the service is still asked after the bus view was left');
  assert.strictEqual(w.live(), null);
  assert.strictEqual(w.drawn.length, 0, 'buses were left on a map that is no longer the bus view');
});

test('live buses: the answer for a line that is no longer open is thrown away', async () => {
  const w = world();
  w.ctx.liveBusStart('302'); await w.settle();
  w.ctx.liveBusStart('5'); await w.settle();          // another line is opened before the first answer arrives
  assert.strictEqual(w.asked.length, 2);
  assert.ok(/\/5$/.test(w.asked[1].url));
  w.asked[0].answer(answer([rec(1701, 38.42465667, 27.13232833)])); await w.settle();
  assert.strictEqual(w.drawn.length, 0, 'the buses of the line that was closed were drawn on the line now open');
  assert.strictEqual(w.live().ref, '5');
  w.asked[1].answer(answer([rec(3118, 38.39530833, 27.057345)])); await w.settle();
  assert.deepStrictEqual(w.drawn.map(d => Array.from(d.ll)), [[38.39530833, 27.057345]]);
});

test('live buses: refusals slow the asking down, and a minute of silence clears the map', async () => {
  assert.deepStrictEqual([0, 1, 2, 3, 9].map(P.liveBusWait), [20000, 40000, 80000, 120000, 120000]);
  const w = world();
  w.ctx.liveBusStart('302'); await w.settle();
  w.asked[0].answer(answer([rec(1701, 38.42465667, 27.13232833)])); await w.settle();
  assert.strictEqual(w.timers[w.timers.length - 1].ms, 20000);
  w.timers[w.timers.length - 1].fn(); await w.settle();
  w.asked[1].answer({ message: 'API rate limit exceeded' }); await w.settle();
  assert.strictEqual(w.timers[w.timers.length - 1].ms, 40000, 'a refusal did not lengthen the wait');
  assert.strictEqual(w.drawn.length, 1, 'one missed answer wiped the map');
  assert.ok(/^liveBusBusy/.test(w.strip.text.textContent), 'the strip does not say the service refused');
  w.timers[w.timers.length - 1].fn(); await w.settle(); w.asked[2].answer({}, 500); await w.settle();
  w.timers[w.timers.length - 1].fn(); await w.settle(); w.asked[3].answer({ message: 'API rate limit exceeded' }); await w.settle();
  assert.strictEqual(w.drawn.length, 0, 'buses from an answer more than a minute old are still drawn as "now"');
  assert.strictEqual(w.timers[w.timers.length - 1].ms, 120000);
  w.timers[w.timers.length - 1].fn(); await w.settle();
  w.asked[4].answer(answer([rec(1701, 38.42001, 27.128)])); await w.settle();
  assert.strictEqual(w.timers[w.timers.length - 1].ms, 20000, 'the wait did not go back to normal after an answer');
  assert.deepStrictEqual(w.drawn.map(d => Array.from(d.ll)), [[38.42001, 27.128]]);
});

test('live buses: the page is allowed to reach the service, and the bus view starts and stops it', () => {
  assert.ok(/connect-src[^";]*https:\/\/openapi\.izmir\.bel\.tr/.test(H.html()), 'the security policy does not let the page talk to openapi.izmir.bel.tr: every request would be blocked silently');
  const sel = fnSource(APP, 'selectBus'), tab = fnSource(APP, 'setTab');
  assert.ok(sel.indexOf('liveBusStop()') > 0 && sel.indexOf('liveBusStop()') < sel.indexOf('liveBusStart(ref)'), 'opening a line does not stop the line before it and start this one');
  assert.ok(/detail\.innerHTML = liveBusHTML\(ref\)/.test(sel), 'the line panel has no live strip');
  assert.ok(tab.includes('liveBusStop()'), 'leaving the bus view does not stop the asking');
  assert.ok(/cache:'no-store'/.test(fnSource(APP, 'liveBusPoll')), 'an old answer could be served from a cache as "now"');
});
