'use strict';
/* V4.5: the Boats tab, the Map button's second press, the glow on an opened line, the readable search list, the calmer day map,
 * and the new name. Each test runs the REAL built code (the back-button rule is in back-button.test.cjs). */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const APP = H.appScript().replace(/\r\n/g, '\n');
const CSS = H.appStyle().replace(/\r\n/g, '\n');
function fnSource(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = src.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1); }
  throw new Error('unbalanced braces in ' + name);
}
const classList = init => { const s = new Set(init || []); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), contains: c => s.has(c), toggle: (c, on) => { on ? s.add(c) : s.delete(c); } }; };

/* ---- boats: every line on its own lane ---- */
const B = (() => { const m = { exports: {} }; new Function('module', APP.slice(APP.indexOf('/* ==BOATS-PURE-START== */'), APP.indexOf('/* ==BOATS-PURE-END== */')) + '\nmodule.exports = { BOAT_COLOURS, BOAT_GAP, boatSegKey, boatLanes, boatOffsetPath };')(m); return m.exports; })();
const px = geo => geo.map(q => ({ x: q[1] * 1000, y: -q[0] * 1000 }));        // a flat little world: 1 unit of longitude = 1000 px

test('boats: two lines on the same stretch of water run side by side, the same way round whichever direction each sails', () => {
  const a = [[0, 0], [0, 1], [0, 2], [0, 3]];                                   // west to east
  const b = [[0, 3], [0, 2], [0, 1], [0, 0]];                                   // the same water, east to west
  const c = [[1, 0], [1, 1]];                                                   // alone, elsewhere
  const seg = B.boatLanes([a, b, c]);
  assert.deepStrictEqual(seg.get(B.boatSegKey([0, 1], [0, 2])), [0, 1], 'the shared stretch does not know both its lines');
  const A = B.boatOffsetPath(px(a), a, 0, seg, 6), Bp = B.boatOffsetPath(px(b), b, 1, seg, 6), C = B.boatOffsetPath(px(c), c, 2, seg, 6);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(A[i].y - px(a)[i].y) > 2.9, 'line A was not moved off the shared middle');
    const mate = Bp[3 - i];                                                     // the same place on the water
    assert.ok(Math.abs(A[i].x - mate.x) < 1e-9, 'the lanes are not parallel');
    assert.ok(Math.abs(Math.abs(A[i].y - mate.y) - 6) < 1e-9, 'two lines on one stretch are ' + Math.abs(A[i].y - mate.y) + ' px apart, not one lane (6 px): they overlap or drift');
  }
  assert.ok(Math.sign(A[0].y - px(a)[0].y) === Math.sign(A[3].y - px(a)[3].y), 'a line changes side along one stretch');
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(C[i].y - px(c)[i].y) < 1e-9 && Math.abs(C[i].x - px(c)[i].x) < 1e-9, 'a line alone on its water was moved off its route');
});

test('boats: three lines take three lanes in a fixed order, and at a pier the lanes come together', () => {
  const g = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];
  const seg = B.boatLanes([g, g, g]);
  const ys = [0, 1, 2].map(li => B.boatOffsetPath(px(g), g, li, seg, 5)[2].y - px(g)[2].y);
  assert.deepStrictEqual(ys.map(v => Math.round(v * 100) / 100), [-5, 0, 5], 'three lines are not in three lanes one gap apart');
  // a pier at the first point: every line docks there exactly, and the shift grows smoothly away from it
  const pin = [px(g)[0]];
  const p = B.boatOffsetPath(px(g), g, 0, seg, 5, pin, 1500);
  assert.ok(Math.abs(p[0].y - px(g)[0].y) < 1e-9, 'a line does not reach its pier: it docks ' + Math.abs(p[0].y - px(g)[0].y) + ' px to one side');
  const d = p.map((q, i) => Math.abs(q.y - px(g)[i].y));
  assert.ok(d[1] > 0 && d[1] < d[2] && d[2] <= 5 + 1e-9 && Math.abs(d[4] - 5) < 1e-9, 'the lanes do not open out smoothly from the pier: ' + d.map(v => v.toFixed(2)));
});

test('boats: the colours can be told apart, the tab exists on every screen, and it draws only the boats', () => {
  const ferries = H.cities().istanbul.lines.filter(l => l.kind === 'ferry');
  assert.ok(B.BOAT_COLOURS.length >= ferries.length, 'İstanbul has ' + ferries.length + ' ferry lines and only ' + B.BOAT_COLOURS.length + ' colours: two lines would share one');
  assert.strictEqual(new Set(B.BOAT_COLOURS.map(c => c.toUpperCase())).size, B.BOAT_COLOURS.length, 'a colour is used twice');
  const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  for (let i = 1; i < B.BOAT_COLOURS.length; i++) { const p = rgb(B.BOAT_COLOURS[i - 1]), q = rgb(B.BOAT_COLOURS[i]); assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 90, 'neighbouring lanes ' + B.BOAT_COLOURS[i - 1] + ' and ' + B.BOAT_COLOURS[i] + ' are too alike to tell apart side by side'); }
  const html = H.html();
  assert.ok(/<button data-tab="boat" role="tab" aria-selected="false" data-i18n="tabBoat">/.test(html) && /id="cardBoats"/.test(html) && /id="boatList"/.test(html), 'the Boats tab or its card is gone');
  const st = fnSource(APP, 'setTab');
  assert.ok(/map\.removeLayer\(boatLayer\);/.test(st), 'the boats stay on the map when another view is chosen');
  assert.ok(/else if\(t==='boat'\)\{[\s\S]*?ghostGroup\.addTo\(map\);\s*boatLayer\.addTo\(map\); renderBoats\(\); renderBoatList\(\);/.test(st), 'the Boats view does not draw the boats');
  assert.ok(/getElementById\('cardBoats'\)\.style\.display\s*=\s*\(t==='boat'\) \? '' : 'none';/.test(st));
  assert.ok(/currentTab==='boat' \? boatStations : \[\]/.test(fnSource(APP, 'drawLabels')), 'the pier names are not printed in the Boats view');
  const I = H.i18nValues();
  for (const lang of Object.keys(I)) for (const k of ['tabBoat', 'boatsTitle', 'boatsIntro', 'boatPiers', 'boatCount', 'modesTitle', 'modeRail', 'modeBus', 'modeBoat', 'modeHint']) assert.ok(I[lang][k] && I[lang][k].length > 1, lang + ' has no text for ' + k);
});

/* ---- the Map button ---- */
function phone(opts) {
  const o = Object.assign({ tab: 'active', sheet: null, stn: false, linp: false }, opts), calls = [];
  const ctx = vm.createContext({ currentTab: o.tab, calls,
    document: { querySelector: q => (q === '.msheet.open' && o.sheet ? {} : null), getElementById: id => ({ classList: classList((id === 'stn' && o.stn) || (id === 'linp' && o.linp) ? ['show'] : []) }) },
    openSheet: n => { calls.push('sheet:' + n); o.sheet = n; }, closeAllPanels: () => { calls.push('panels'); o.stn = o.linp = false; }, setTab: t => { calls.push('tab:' + t); ctx.currentTab = t; } });
  vm.runInContext(fnSource(APP, 'mapIsDefault') + '\n' + fnSource(APP, 'mapButton'), ctx);
  return { calls, press: () => vm.runInContext('mapButton()', ctx), ctx };
}
test('map button: anywhere else it brings back the default map; pressed again there, it opens the kinds of transport', () => {
  let p = phone(); p.press();
  assert.deepStrictEqual(p.calls, ['sheet:modes'], 'on the default map the Map button does not open the kinds of transport');
  for (const [o, what] of [[{ tab: 'vision' }, 'the Vision view'], [{ tab: 'boat' }, 'the Boats view'], [{ sheet: 'planner' }, 'an open sheet'], [{ stn: true }, 'an open station'], [{ linp: true }, 'an open line'], [{ tab: 'bus', sheet: 'modes', linp: true }, 'buses with a line open']]) {
    p = phone(o); p.press();
    assert.ok(!p.calls.includes('sheet:modes'), 'from ' + what + ' the first press opened the kinds of transport instead of the default map');
    assert.ok(p.calls.includes('sheet:null') && p.calls.includes('panels'), 'from ' + what + ' the Map button left something open');
    assert.strictEqual(p.ctx.currentTab, 'active', 'from ' + what + ' the Map button did not go back to the default view');
    p.calls.length = 0; p.press();
    assert.deepStrictEqual(p.calls, ['sheet:modes'], 'the second press (now on the default map) does not open the kinds of transport');
  }
  assert.ok(/body\.mobile #tabs button\[data-tab="bus"\],body\.mobile #tabs button\[data-tab="boat"\]\{display:none;\}/.test(CSS), 'on a phone Buses and Boats are still in the Layers sheet as well');
  assert.ok(/classList\.toggle\('on', !!name && name!=='planner' && name!=='modes'\)/.test(fnSource(APP, 'openSheet')), 'the map is dimmed behind the kinds of transport');
});

/* ---- the glow on the line being looked at ---- */
test('line glow: opening a line gives it a halo under everything and dims every other line; closing puts it all back', () => {
  const src = APP.slice(APP.indexOf('const lineGlowLayer = L.layerGroup();'), APP.indexOf("map.on('zoomend', () => { if(lineGlowRef !== null) lineGlowWidths(); });"));
  const made = [], styled = [];
  const poly = (ref, glow, op) => ({ ref, glow, baseOp: op, pl: { options: { opacity: op }, setStyle(s) { Object.assign(this.options, s); styled.push(ref); } } });
  const linePolys = [poly('M1', false, .95), poly('M1', true, .16), poly('M2', false, .95), poly('M2', true, .16), poly('F1', false, .62)];
  let onMap = false, applied = 0;
  const layer = { items: [], clearLayers() { this.items = []; }, eachLayer(f) { this.items.forEach(f); } };
  const ctx = vm.createContext({ Math, Array, linePolys, lineRenderer: {}, lineScale: () => 1, applyLineStyle: () => { applied++; },
    map: { getZoom: () => 13, hasLayer: () => onMap, removeLayer: () => { onMap = false; } },
    L: { layerGroup: () => Object.assign(layer, { addTo() { onMap = true; return layer; } }),
         polyline: (p, o) => { const pl = { path: p, options: Object.assign({}, o), back: false, setStyle(s) { Object.assign(this.options, s); }, bringToBack() { this.back = true; }, addTo(g) { g.items.push(this); made.push(this); return this; } }; return pl; } } });
  vm.runInContext(src + '\nthis.glow = setLineGlow; this.ref = () => lineGlowRef;', ctx);
  const M1 = { ref: 'M1', color: '#E63946', paths: [[[41, 29], [41.1, 29.1]], [[41.1, 29.1], [41.2, 29.2]]] };
  ctx.glow(M1);
  assert.strictEqual(ctx.ref(), 'M1'); assert.ok(onMap, 'the halo is not on the map');
  assert.strictEqual(layer.items.length, 6, 'each of the 2 paths should get 3 halo strokes');
  assert.ok(layer.items.every(p => p.options.color === '#E63946' && p.options.interactive === false && p.back), 'the halo is not in the line\'s colour, takes clicks, or is drawn over the line and its stations');
  assert.ok(layer.items.every(p => p.options.opacity <= .35), 'the halo is solid: it would hide the map under it');
  const op = r => linePolys.filter(o => o.ref === r).map(o => +o.pl.options.opacity.toFixed(3));
  assert.deepStrictEqual(op('M1'), [.95, .16], 'the opened line itself was dimmed');
  assert.deepStrictEqual([op('M2'), op('F1')], [[.285, .048], [.186]], 'the other lines did not step back to a third');
  ctx.glow({ ref: 'M2', color: '#00A651', paths: [[[41, 29], [41.1, 29.1]]] });        // straight to another line
  assert.deepStrictEqual(op('M2').slice(0, 1), [.95], 'a line opened after another stays dimmed'); assert.strictEqual(+linePolys[0].pl.options.opacity.toFixed(3), .285);
  assert.strictEqual(layer.items.length, 3, 'the first line\'s halo was left behind');
  const before = applied; ctx.glow(null);
  assert.strictEqual(ctx.ref(), null); assert.strictEqual(layer.items.length, 0); assert.ok(!onMap);
  assert.deepStrictEqual(linePolys.filter(o => !o.glow).map(o => o.pl.options.opacity), [.95, .95, .62], 'closing the panel left lines dimmed');
  assert.ok(applied > before, 'the outlines were not put back by the style in force');
  assert.ok(/if\(typeof setLineGlow === 'function'\) setLineGlow\(line\);/.test(fnSource(APP, 'openLine')), 'opening a line does not light it');
  assert.ok(/if\(!panel\.classList\.contains\('show'\) && lineGlowRef !== null\) setLineGlow\(null\);/.test(APP), 'the glow stays when the panel is closed by something other than its own button');
});

/* ---- the search list can be read in every theme ---- */
test('search list: its ground follows the theme like its text (it was a fixed dark box, so in the light theme the names were dark on dark)', () => {
  const rule = /\.ac-list\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, 'the suggestion list has no rule');
  assert.ok(/background-color:var\(--obsidian\)/.test(rule[1]) && /color:var\(--text\)/.test(rule[1]), 'the list\'s ground and text do not come from the same theme: ' + rule[1].slice(0, 120));
  assert.ok(!/background:\s*rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/.test(rule[1]) && !/background:\s*#/.test(rule[1]), 'the list has a hard-coded ground again');
  // and the two tokens it reads are far enough apart in each theme
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const pair = block => { const o = /--obsidian:(#[0-9A-Fa-f]{6})/.exec(block), t = /--text:(#[0-9A-Fa-f]{6})/.exec(block); return o && t ? [o[1], t[1]] : null; };
  let checked = 0;
  for (const m of CSS.matchAll(/(?::root|body(?:\.[a-z-]+)*)\{([^}]*--obsidian:#[0-9A-Fa-f]{6}[^}]*)\}/g)) { const p = pair(m[1]); if (!p) continue; checked++; assert.ok(ratio(p[0], p[1]) >= 7, 'a theme has list text at ' + ratio(p[0], p[1]).toFixed(1) + ':1 on its ground (' + p + ')'); }
  assert.ok(checked >= 3, 'only ' + checked + ' themes were found: the check reads too little');
});

/* ---- the day map is calmer ---- */
test('day map: a warm parchment, not near-white: clearly dimmer than before, warmer, and streets are cream rather than pure white', () => {
  const pal = (() => { const m = { exports: {} }; new Function('module', APP.slice(APP.indexOf('/* ==BASEMAP-PURE-START== */'), APP.indexOf('/* ==BASEMAP-PURE-END== */')) + '\n' + APP.slice(APP.indexOf('/* ==VECTOR-BASEMAP-PURE-START== */'), APP.indexOf('/* ==VECTOR-BASEMAP-PURE-END== */')) + '\nmodule.exports = { ATLAS_PAL, vecColours };')(m); return m.exports; })();
  const lum = c => { const v = c.map(x => x / 255).map(x => x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  const day = pal.ATLAS_PAL.day, V = pal.vecColours('day');
  assert.ok(lum(day.ground) < .80 && lum(day.ground) > .68, 'the day ground is at ' + (lum(day.ground) * 100).toFixed(0) + '% of white (it was 87%: too bright; under 68% it stops being a day map)');
  assert.ok(day.ground[0] - day.ground[2] >= 16, 'the day ground is not warm (red ' + day.ground[0] + ', blue ' + day.ground[2] + ')');
  assert.deepStrictEqual(day.bands.land.c, day.ground, 'land and ground must be one colour, or every tile seam shows');
  assert.ok(Math.max(...V.road) < 252 && V.road[0] > V.road[2], 'streets are pure (or cold) white again: the glare this change removed');
  assert.ok(lum(V.road) > lum(day.ground) + .08, 'streets no longer stand out from the ground');
  assert.ok(lum(day.bands.water.c) < lum(day.ground) && day.bands.water.c[2] > day.bands.water.c[0] + 30, 'water is not a darker blue than the land');
  assert.ok(lum(pal.ATLAS_PAL.night.ground) < .03, 'the night map was changed too');
});

/* ---- the name ---- */
test('name: the app is TurkMaps everywhere a person reads it; the old name survives only in internal storage names', () => {
  const html = H.html(), manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(manifest.short_name, 'TurkMaps'); assert.ok(/^TurkMaps\b/.test(manifest.name));
  assert.ok(/<title>TurkMaps\b/.test(html) && /apple-mobile-web-app-title" content="TurkMaps"/.test(html) && /og:site_name" content="TurkMaps"/.test(html));
  const visible = html.replace(/raynet-[a-z0-9-]*/gi, '').replace(/['"]raynet['"]/g, '');
  const left = [...visible.matchAll(/.{0,30}ray-?net.{0,20}/gi)].map(m => m[0]);
  assert.deepStrictEqual(left, [], 'the old name is still shown somewhere');
  for (const f of fs.readdirSync(path.join(__dirname, '..', '..', 'legal')).filter(f => f.endsWith('.html'))) {
    const page = fs.readFileSync(path.join(__dirname, '..', '..', 'legal', f), 'utf8').replace(/raynet-[a-z0-9-]*/gi, '');
    assert.ok(!/ray-?net/i.test(page), 'legal/' + f + ' still says the old name'); assert.ok(/TurkMaps/.test(page), 'legal/' + f + ' does not name the app');
  }
  assert.strictEqual(H.json('legal-config.json').project, 'TurkMaps');
});
