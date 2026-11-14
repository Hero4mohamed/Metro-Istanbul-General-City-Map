'use strict';
/* V4.6: three themes with Auto following the device, the warning sign one size at every zoom, the notices of a line shown at the
 * top of its panel and on its rows, lines found by name in the search box, the bus panel in two views (the first view and Info),
 * and "Show on map" + "Simulation speed" moved into a cleaner Settings. Each test runs the REAL built code where it can. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const APP = H.appScript().replace(/\r\n/g, '\n');
const HTML = H.html().replace(/\r\n/g, '\n');
const CSS = H.appStyle().replace(/\r\n/g, '\n');
function fnSource(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = src.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1); }
  throw new Error('unbalanced braces in ' + name);
}
const settingsHTML = () => { const a = HTML.indexOf('<div class="settings-panel glass" id="settingsPanel"'), b = HTML.indexOf('<div class="near-panel glass"'); return HTML.slice(a, b); };
const layersHTML = () => { const a = HTML.indexOf('<div class="card glass" id="cardLayers">'), b = HTML.indexOf('<div class="card glass" id="cardWeather"'); return HTML.slice(a, b); };

/* ---- themes ---- */
function themeWorld(saved, deviceDark) {
  const listeners = [];
  const mq = { matches: !!deviceDark, addEventListener: (t, f) => listeners.push(f) };
  const body = { cls: new Set(), classList: { toggle(c, on) { on ? body.cls.add(c) : body.cls.delete(c); } } };
  const store = { irn_theme: saved };
  const ctx = {
    window: { matchMedia: () => mq }, matchMedia: () => mq, document: { body, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    syncThemeColor() {}, afterPaint: f => f(), syncBaseToTheme() { ctx.synced = (ctx.synced || 0) + 1; },
  };
  vm.createContext(ctx);
  const src = APP.slice(APP.indexOf('const lsStr='), APP.indexOf('let routePref'))
    + APP.slice(APP.indexOf('const THEME_MQ'), APP.indexOf('/* The browser\'s address bar'))
    + fnSource(APP, 'applyTheme') + '\n' + APP.slice(APP.indexOf('function onDeviceTheme'), APP.indexOf('function setRoutePref'));
  vm.runInContext(src + '\nthis.get = () => JSON.stringify({ themePref, light: document.body.cls.has("light") }); this.resolveTheme = resolveTheme; this.applyTheme = applyTheme;', ctx);
  return { ctx, mq, listeners, store, fire: on => { mq.matches = on; listeners.forEach(f => f()); } };
}

test('themes: Light, Dark and Auto, in that order; Mixed is gone everywhere', () => {
  const seg = /<div class="seg" id="themeSeg">([\s\S]*?)<\/div>/.exec(HTML)[1];
  assert.deepStrictEqual([...seg.matchAll(/data-theme="(\w+)"/g)].map(m => m[1]), ['light', 'dark', 'auto']);
  assert.ok(/data-theme="auto" class="active"[^>]*data-i18n-title="themeAutoTip"/.test(seg), 'Auto does not say it follows the device');
  assert.ok(!/body\.mixed|themeSplit|'split'\)\s*return s|classList\.toggle\('mixed'/.test(HTML + APP), 'a piece of the Mixed theme is left');
  assert.strictEqual((APP.match(/themeAutoTip:"/g) || []).length, 4, 'the Auto tooltip is not in all four languages');
});

test('themes: Auto follows the device, at once and every time it changes; a first visit starts on Auto; a saved Mixed becomes Light', () => {
  let w = themeWorld(null, true);
  assert.deepStrictEqual(JSON.parse(w.ctx.get()), { themePref: 'auto', light: false }, 'a first visit on a dark device');
  w.ctx.applyTheme('auto', true);
  assert.strictEqual(JSON.parse(w.ctx.get()).light, false);
  w.fire(false);
  assert.strictEqual(JSON.parse(w.ctx.get()).light, true, 'the device went light and the app stayed dark');
  w.fire(true);
  assert.strictEqual(JSON.parse(w.ctx.get()).light, false, 'the device went dark and the app stayed light');
  assert.ok(w.ctx.synced >= 2, 'the map does not follow the device with the page');
  w.ctx.applyTheme('light', false); w.fire(true);
  assert.strictEqual(JSON.parse(w.ctx.get()).light, true, 'a chosen Light theme was overridden by the device');
  assert.strictEqual(w.store.irn_theme, 'light');
  w = themeWorld('split', true);
  assert.strictEqual(JSON.parse(w.ctx.get()).themePref, 'light', 'a saved Mixed theme does not become Light');
  w = themeWorld('dark', false);
  assert.strictEqual(JSON.parse(w.ctx.get()).themePref, 'dark');
  assert.strictEqual(w.ctx.resolveTheme('auto'), 'light');
  assert.ok(!/getHours\(\)/.test(fnSource(APP, 'resolveTheme')), 'Auto is the time of day again, not the device');
});

/* ---- the warning sign ---- */
test('warning sign: the sign and its ring are one fixed size at every zoom, in the sign\'s own element', () => {
  const fn = fnSource(APP, 'renderDisruptionMarkers');
  assert.ok(/const isz = WARN_SIZE;/.test(fn), 'the sign is sized by the zoom again');
  assert.ok(!/markerScale|circleMarker/.test(fn), 'the ring is drawn on the map overlay again, or sized by the zoom: it grows and shrinks during a zoom');
  assert.ok(/<i class="warn-ring" style="--wc:\$\{col\};width:\$\{WARN_RING\}px;height:\$\{WARN_RING\}px"><\/i>/.test(fn), 'the ring is not a fixed-size part of the sign');
  assert.ok(/iconSize:\[box,box\], iconAnchor:\[box\/2,box\/2\]/.test(fn), 'the sign is not centred on its place');
  const m = /const WARN_SIZE = (\d+), WARN_RING = (\d+);/.exec(APP);
  assert.ok(m && +m[2] > +m[1] + 8, 'the ring is not clearly larger than the sign');
  assert.ok(/\.warn-ring\{[^}]*pointer-events:none;[^}]*animation:disrPulse/.test(CSS), 'the ring catches presses, or no longer pulses');
  assert.ok(!/color-mix\(/.test(CSS), 'color-mix() is not drawn by older Android browsers');
});

/* ---- notices on a line ---- */
const NOTICES = (() => {
  const src = APP.slice(APP.indexOf('const NOTICE_RANK'), APP.indexOf('/* a coloured pill for a row in a list'))
    + fnSource(APP, 'noticePillHTML');
  return all => {
    const ctx = { activeDisruptions: () => all, SEV_COLOR: { major: '#E5484D', partial: '#F5A623', minor: '#FFD400' }, inkOn: () => '#000',
      svgEsc: s => String(s), attrEsc: s => String(s), sevLabel: s => s.toUpperCase(), disTitle: d => d.title, disMsg: d => d.message, disTrTag: () => '',
      untilText: d => 'until ' + d.until, t: k => ({ lineNotice1: 'ONE', lineNoticeN: '{n} NOTICES', ferryAllNotices: 'ALL FERRIES ({n})', detourDrawn: 'DETOUR', lineNoticesAria: 'N' })[k] || k };
    vm.createContext(ctx); vm.runInContext(src, ctx); return ctx;
  };
})();
const D = [
  { id: 'a', ref: 'M7', severity: 'partial', title: 'Section', message: 'slow' },
  { id: 'b', ref: 'M7', severity: 'major', title: 'Closed', message: 'shut', until: '2026-12-01' },
  { id: 'c', ref: 'T3', severity: 'minor', title: 'Other', message: 'x' },
  { id: 'd', mode: 'bus', ref: 'M7', severity: 'minor', title: 'Bus', message: 'b', detour: { dir: 0 } },
  { id: 'e', mode: 'ferry', ref: null, severity: 'minor', title: 'All ferries', message: 'weather' },
  { id: 'f', mode: 'ferry', ref: null, lines: ['F2'], severity: 'major', title: 'F2 off', message: 'off' },
];

test('notices: each kind of line gets its own notices, worst first, and a boat line also gets the ones that name no line', () => {
  const N = NOTICES(D);
  assert.deepStrictEqual(N.lineNotices('M7', '').map(d => d.id), ['a', 'b'], 'the metro line M7 got another line\'s, or the bus M7\'s, notices');
  assert.deepStrictEqual(N.lineNotices('M7', 'bus').map(d => d.id), ['d'], 'the bus line M7 got the metro\'s notices');
  assert.deepStrictEqual(N.lineNotices('F2', 'ferry').map(d => d.id), ['f']);
  assert.deepStrictEqual(N.ferryGeneralNotices().map(d => d.id), ['e'], 'a ferry notice that names no line is not shown with the boat lines');
  assert.deepStrictEqual(N.noticeSort(N.lineNotices('M7', '')).map(d => d.id), ['b', 'a'], 'the worst notice is not first');
  const h = N.lineNoticesHTML(N.lineNotices('M7', ''));
  assert.ok(/--sc:#E5484D/.test(h.slice(0, 120)), 'the block is not coloured by the worst notice');
  assert.ok(h.includes('2 NOTICES') && h.indexOf('Closed') < h.indexOf('Section'), 'the count is missing or the order is wrong');
  assert.ok(h.includes('until 2026-12-01'), 'how long a notice lasts is not shown');
  assert.ok(N.lineNoticesHTML(N.lineNotices('M7', 'bus')).includes('DETOUR'), 'a drawn detour is not mentioned');
  assert.ok(N.lineNoticesHTML([N.lineNotices('T3', '')[0]]).includes('ONE'));
  assert.strictEqual(N.lineNoticesHTML([]), '', 'a line with nothing to say shows an empty block');
  const g = N.lineNoticesHTML([], N.ferryGeneralNotices());
  assert.ok(/<details class="ln-gen">/.test(g) && g.includes('ALL FERRIES (1)'), 'the notices for all ferries are not offered');
  assert.strictEqual(N.noticePillHTML([]), '');
  assert.ok(/background:#E5484D[^>]*>⚠ 2</.test(N.noticePillHTML(N.lineNotices('M7', ''))), 'the pill does not show the worst colour and the count');
  assert.ok(/>⚠ PARTIAL</.test(N.noticePillHTML([D[0]])), 'a single notice\'s pill does not say how bad it is');
});

test('notices: the line panel opens with them, the Buses and Boats rows carry the pill, the bus panel shows them in both views', () => {
  assert.ok(/<div class="lp-kind" id="lpKind"><\/div>\n  <div class="lp-notices" id="lpNotices"><\/div>/.test(HTML), 'the line panel has no place for its notices under its name');
  const open = fnSource(APP, 'openLine');
  assert.ok(/box\.innerHTML = live \? lineNoticesHTML\(lineNotices\(line\.ref, ferry \? 'ferry' : ''\), ferry \? ferryGeneralNotices\(\) : null\) : '';/.test(open), 'openLine does not fill the notices');
  assert.ok(open.indexOf('lpNotices') < open.indexOf('if(!live){'), 'a line that is not running keeps the last line\'s notices');
  assert.ok(/noticePillHTML\(lineNotices\(l\.ref, 'ferry'\)\)/.test(fnSource(APP, 'renderBoatList')), 'a boat row does not show its notices');
  assert.ok(/noticePillHTML\(noticesBy\[d\.ref\], 'bn-warn'\)/.test(fnSource(APP, 'renderBusList')), 'a bus row does not show its notices');
  assert.ok(/lineNoticesHTML\(lineNotices\(ref, 'bus'\)\)/.test(fnSource(APP, 'busMainHTML')) && /lineNoticesHTML\(lineNotices\(ref, 'bus'\)\)/.test(fnSource(APP, 'busInfoHTML')), 'the bus panel does not show the line\'s notices');
  for (const k of ['lineNoticesAria', 'lineNotice1', 'lineNoticeN', 'ferryAllNotices', 'omniLines', 'omniBusLine', 'busInfo', 'busBack', 'busStopsTitle'])
    assert.strictEqual((APP.match(new RegExp('[ ,{]' + k + ':"', 'g')) || []).length, 4, k + ' is not in all four languages');
});

/* ---- the search box finds lines ---- */
test('search: a line\'s name finds the line, exact name first, at most four, with its notices; a click opens it', () => {
  const body = APP.slice(APP.indexOf('const lineKey = s =>'), APP.indexOf('  function lineRow(p){'));
  const ctx = {
    fold: s => String(s).toLowerCase(), isLive: l => l.scope !== 'planned', colorForLine: () => '#123', LINE_META: {}, kindLabel: k => k, BUS_COLOR: '#E8A33D', HAS: { bus: true }, t: k => k,
    lineNotices: (ref, mode) => (ref === 'M7' && mode === '' ? [{ severity: 'partial' }] : []),
    NETWORK: [{ ref: 'M7', kind: 'subway', official: 'Mahmutbey – Kabataş', color: '#F7A' }, { ref: 'M70', kind: 'subway', scope: 'planned' }, { ref: 'M1A', kind: 'subway' },
      { ref: 'M1B', kind: 'subway' }, { ref: 'YHT', kind: 'rail', scope: 'intercity' }, { ref: 'F1', kind: 'ferry' }, { ref: 'M1', kind: 'subway', partOf: 'M1A' }],
    BUS_DIR: [{ ref: 'M7', from: 'A', to: 'B' }, { ref: '34G', from: 'X', to: 'Y' }, { ref: '34', from: 'P', to: 'Q' }, { ref: '34A' }, { ref: '34AS' }, { ref: '34BZ' }, { ref: '34C' }],
  };
  vm.createContext(ctx); vm.runInContext(body + '\nthis.searchLines = searchLines;', ctx);
  const lines = q => Array.from(ctx.searchLines(q));
  const m7 = lines('m7');
  assert.deepStrictEqual(m7.map(r => (r.bus ? 'bus ' : '') + r.lineRef), ['M7', 'bus M7'], 'the metro and the bus line called M7 are not both found');
  assert.strictEqual(m7[0].notices.length, 1, 'a line\'s notices do not come with it');
  assert.deepStrictEqual(lines('34').map(r => r.lineRef), ['34', '34G', '34A', '34AS'], 'the exact name is not first, or more than four lines are listed');
  assert.deepStrictEqual(lines('m').map(r => r.lineRef), [], 'one letter fills the list with lines');
  assert.deepStrictEqual(lines('m1').map(r => r.lineRef), ['M1A', 'M1B'], 'a branch, a planned line or an intercity train was offered');
  assert.deepStrictEqual(lines('kadıköy moda iskelesi'), [], 'a sentence was taken for a line name');
  const run = fnSource(APP, 'run');
  assert.ok(/\{ h:t\("omniLines"\),  items:lines,              row:lineRow \},\n      \{ h:t\("omniStops"\)/.test(run), 'lines are not the first section');
  assert.ok(/if\(p\.lineRef\)\{[\s\S]*?if\(p\.bus\) openBusRoute\(p\.lineRef\); else if\(lineByRef\[p\.lineRef\]\) openLine\(lineByRef\[p\.lineRef\]\);\s*return;/.test(APP), 'a line result does not open the line');
});

/* ---- the bus panel in two views ---- */
test('bus panel: the first view is live buses, notices, fare and a compact stop list; Info holds directions, departures and every stop', () => {
  const main = fnSource(APP, 'busMainHTML'), info = fnSource(APP, 'busInfoHTML');
  assert.ok(/liveBusHTML\(ref\) \+ lineNoticesHTML\(lineNotices\(ref, 'bus'\)\) \+ busFareHTML\(ref\) \+ busCompactStopsHTML\(dirs\)/.test(main), 'the first view is not live buses, notices, fare, stops, in that order');
  assert.ok(/data-bd="info"/.test(main) && !/busScheduleHTML|busStopsHTML|busDirToggleHTML/.test(main), 'the first view has no Info button, or still carries the long parts');
  assert.ok(/'<div class="bd-info" hidden>'/.test(info) && /data-bd="back"/.test(info), 'Info is shown from the start, or has no way back');
  for (const part of ['busDirToggleHTML(dirs)', 'busScheduleHTML(ref)', 'busStopsHTML(dirs)']) assert.ok(info.includes(part), 'Info lacks ' + part);
  assert.ok(/detail\.innerHTML = busMainHTML\(ref, dirs\) \+ busInfoHTML\(ref, dirs\);/.test(fnSource(APP, 'selectBus')), 'choosing a line does not start on the first view');
  assert.ok(!/function busNoticesHTML/.test(APP), 'the old notices list is still there beside the new one');
});

test('bus panel: the compact list names each stop once, a direction at a time, and the buttons switch views and directions', () => {
  const ctx = { svgEsc: s => String(s), attrEsc: s => String(s), t: k => k, BUS_DIR_COLOR: ['#E8A33D', '#5BA8E8'] };
  vm.createContext(ctx);
  vm.runInContext(fnSource(APP, 'busStopNames') + fnSource(APP, 'busCompactStopsHTML') + '\nthis.n = busStopNames; this.h = busCompactStopsHTML;', ctx);
  const dirs = [{ head: 'KONAK', stops: [[0, 0, 'Şehitlik'], [0, 0, 'Şehitlik'], [0, 0, 'Siteler'], [0, 0, ''], [0, 0, 'Konak']] }, { head: 'NARLIDERE', stops: [[0, 0, 'Konak'], [0, 0, 'Şehitlik']] }];
  assert.deepStrictEqual(Array.from(ctx.n(dirs[0])), ['Şehitlik', 'Siteler', 'Konak'], 'a stop served from both sides of the road is listed twice');
  const h = ctx.h(dirs);
  assert.ok(/<div class="bd-cs" data-dir="0">/.test(h) && /<div class="bd-cs" data-dir="1" hidden>/.test(h), 'both directions are shown at once');
  assert.ok(/<li class="end">Şehitlik<\/li><li>Siteler<\/li><li class="end">Konak<\/li>/.test(h), 'the two ends are not marked');
  assert.ok(/data-csdir="0" class="active" aria-pressed="true"/.test(h) && /data-csdir="1" aria-pressed="false"/.test(h));
  assert.ok(!/data-csdir/.test(ctx.h([dirs[0]])), 'a one-way line is offered a choice with nothing to choose');
  assert.strictEqual(ctx.h([]), '');
  const wire = APP.slice(APP.indexOf("const box = document.getElementById('busDetail'); if(!box) return;"), APP.indexOf('function selectBus'));
  assert.ok(/if\(b\)\{ busShowInfo\(box, b\.dataset\.bd === 'info'\); return; \}/.test(wire), 'Info and Back do not switch the view');
  assert.ok(/x\.hidden = x\.dataset\.dir !== i;/.test(wire), 'the direction buttons do not switch the list');
  assert.ok(/main\.hidden = on; info\.hidden = !on;/.test(fnSource(APP, 'busShowInfo')));
  assert.ok(/\.bd-main\[hidden\],\.bd-info\[hidden\],\.bd-cs\[hidden\]\{display:none;\}/.test(CSS), 'a hidden view still takes space');
});

/* ---- Settings ---- */
test('settings: "Show on map" and "Simulation speed" moved from the Layers card to Settings > Map, as switches that still act', () => {
  const lay = layersHTML(), set = settingsHTML();
  assert.ok(!/tglTrains|tglStations|tglExplore|speedSeg|data-i18n="showOnMap"|data-i18n="simSpeed"/.test(lay), 'the Layers card still has them');
  const map = /<details class="sp-sec" data-sec="map">[\s\S]*?<\/details>/.exec(set)[0];
  for (const id of ['swTrains', 'swStations', 'swExplore', 'speedSeg']) assert.ok(map.includes('id="' + id + '"'), id + ' is not in Settings > Map');
  assert.ok(map.indexOf('swTrains') < map.indexOf('swTurn'), 'what the map shows is not first in the Map section');
  assert.ok(/<button class="sw on" id="swTrains" role="switch" aria-checked="true"/.test(map) && /<button class="sw" id="swExplore" role="switch" aria-checked="false"/.test(map), 'a switch starts in the wrong state');
  assert.ok(/getElementById\('swTrains'\)\.addEventListener\('click', \(\)=>\{ showTrains=!showTrains; setSwitch\('swTrains', showTrains\); renderBoard\(\); \}\);/.test(APP), 'the carriages switch does nothing');
  assert.ok(/getElementById\('swExplore'\)\.addEventListener\('click', \(\)=>toggleAttractions\(!attractionsOn\)\);/.test(APP), 'the attractions switch does nothing');
  assert.ok(/const g = currentTab==='active' \? stationGroup : \(currentTab==='vision' \? plannedStationGroup : null\);/.test(APP), 'the station switch puts stations on a view that draws none');
  assert.ok(/sw\.classList\.toggle\('on', attractionsOn\)/.test(fnSource(APP, 'toggleAttractions')), 'turning attractions on elsewhere leaves the switch off');
});

test('settings: every section is a card with its own one-line summary in every language, and the head stays put', () => {
  const set = settingsHTML();
  const secs = [...set.matchAll(/<details class="sp-sec" data-sec="(\w+)"[^>]*>\s*<summary><span class="sp-ico" aria-hidden="true">[^<]*<\/span><span class="sp-st"><span data-i18n="\w+">[^<]*<\/span><small data-i18n="(\w+)">/g)];
  assert.strictEqual(secs.length, 8, 'a section has no summary line');
  for (const m of secs) assert.strictEqual((APP.match(new RegExp('[ ,{]' + m[2] + ':"', 'g')) || []).length, 4, m[2] + ' is not in all four languages');
  assert.ok(/#settingsPanel \.sp-head\{position:sticky;top:0;/.test(CSS), 'the head scrolls away');
  assert.ok(/\.sp-sec\{margin:0 0 9px;border:1px solid var\(--stroke\);border-radius:16px;background:var\(--surface\);/.test(CSS), 'the sections are not cards');
  assert.ok(/\.sp-searching \.sp-sub\{display:none;\}/.test(CSS), 'the group headings stay while a search hides their settings');
  assert.ok(/body:not\(\.mobile\) #settingsPanel\{width:/.test(CSS), 'the wider panel would also squeeze the phone sheet');
});

test('Lenis and React Bits were looked at and not added: the page loads no scroll or React library', () => {
  assert.ok(!/lenis|react(-dom)?(\.production)?(\.min)?\.js|reactbits/i.test(HTML.replace(/<!--[\s\S]*?-->/g, '')), 'a smooth-scroll or React library is loaded');
});
