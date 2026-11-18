'use strict';
/* Shared-track drawing: where two lines run on the same track, draw them side by side instead of one hiding the other.
 * Design: docs/superpowers/specs/2026-11-18-shared-track-drawing-design.md. The pure geometry (SHARED-PURE) runs in a vm
 * sandbox with the app's real metersBetween; the wiring is read from the built app. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const APP = () => H.appScript().replace(/\r\n/g, '\n');
function region(name) {
  const s = APP(), a = s.indexOf('/* ==' + name + '-START== */'), b = s.indexOf('/* ==' + name + '-END== */');
  assert.ok(a > 0 && b > a, 'the ' + name + ' block is missing');
  return s.slice(a, b);
}
function fnSrc(name) {
  const s = APP(), i = s.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'function ' + name + ' not found');
  let depth = 0, k = s.indexOf('{', s.indexOf(')', i));
  for (let j = k; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) return s.slice(i, j + 1); }
  throw new Error('unbalanced ' + name);
}
function line1(prefix) {
  const l = APP().split('\n').find(x => x.trim().startsWith(prefix));
  assert.ok(l, prefix + ' not found in the app'); return l;
}
function pure() {
  const ctx = { Math, JSON, Number, Array, Object, Infinity };
  vm.createContext(ctx);
  vm.runInContext([line1('const R ='), line1('const toRad'), fnSrc('metersBetween'), region('SHARED-PURE'),
    'this.api = { SHARED, sharedComputeAll, sharedWeight, sharedAt, sharedMpp, sharedShiftPx, sharedOffsetRing, sharedDrawInfo,'
    + ' sharedProjectRing, sharedSOnPath, metersBetween };'].join('\n'), ctx);
  return ctx.api;
}
const W = () => 4.5;                          // every test line drawn 4.5 px wide at full scale

/* ---- synthetic lines near İstanbul (lat 41): 0.001° lng ≈ 84 m, 0.001° lat ≈ 111 m ---- */
function mk(ref, paths, names, kind) {
  return { ref, kind: kind || 'subway', scope: 'active', paths,
    stations: names.map((n, i) => ({ name: n, lat: paths[0][Math.min(i, paths[0].length - 1)][0], lng: paths[0][Math.min(i, paths[0].length - 1)][1] })) };
}
function eastPts(lat, lng0, lng1, step) { const o = []; for (let x = lng0; x <= lng1 + 1e-9; x += step) o.push([lat, +x.toFixed(6)]); return o; }
/* A runs due east 29.000 → 29.050 (~4.2 km). B shares it 29.000 → 29.030 (~2.5 km), then leaves north-east. */
function pairAB(reverseB) {
  const A = mk('A1', [eastPts(41, 29.0, 29.05, 0.002)], ['S1', 'S2', 'S3', 'S4']);
  let b = eastPts(41, 29.0, 29.03, 0.002).concat([[41.004, 29.034], [41.008, 29.038], [41.012, 29.042]]);
  if (reverseB) b = b.slice().reverse();
  const B = mk('B1', [b], ['S1', 'S2', 'S3', 'Q9']);
  return { A, B };
}
/* geographic left normal of the drawing direction at s along path p, as [east, north] */
function leftAt(api, line, p, s) {
  const pts = line.paths[p]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = api.metersBetween(pts[i - 1], pts[i]);
    if (acc + d >= s || i === pts.length - 1) {
      const e = (pts[i][1] - pts[i - 1][1]) * Math.cos(pts[i][0] * Math.PI / 180), n = pts[i][0] - pts[i - 1][0], L = Math.hypot(e, n) || 1;
      return [-n / L, e / L];
    }
    acc += d;
  }
}
function dirAt(api, line, p, s) { const k = api.sharedAt(line, p, s).k, n = leftAt(api, line, p, s); return [Math.sign(k) * n[0], Math.sign(k) * n[1]]; }
function sNear(api, line, p, latlng) { return api.sharedSOnPath(line, p, latlng); }

test('a shared stretch is found on both lines, and only where they share', () => {
  const api = pure(), { A, B } = pairAB(false);
  api.sharedComputeAll([A, B], W);
  const ra = A._shared && A._shared[0], rb = B._shared && B._shared[0];
  assert.ok(ra && ra.length === 1, 'A has one shared run'); assert.ok(rb && rb.length === 1, 'B has one shared run');
  const sharedLen = api.metersBetween([41, 29.0], [41, 29.03]);
  assert.ok(Math.abs(ra[0].s0) < 30, 'A starts sharing at its start (' + ra[0].s0 + ')');
  assert.ok(Math.abs(ra[0].s1 - sharedLen) < 60, 'A stops sharing where B leaves (' + ra[0].s1 + ' vs ' + sharedLen + ')');
  const sEnd = sNear(api, A, 0, [41, 29.045]);
  assert.strictEqual(api.sharedAt(A, 0, sEnd).k, 0, 'past the split A is not shifted');
});

test('lines are only compared when they share at least two station names, and ferries never', () => {
  const api = pure();
  let { A, B } = pairAB(false);
  B.stations = [{ name: 'S1', lat: 41, lng: 29 }, { name: 'Z2', lat: 41.01, lng: 29.04 }];
  api.sharedComputeAll([A, B], W);
  assert.ok(!(A._shared && A._shared[0] && A._shared[0].length), 'one shared name is not enough');
  ({ A, B } = pairAB(false)); A.kind = 'ferry'; B.kind = 'ferry';
  api.sharedComputeAll([A, B], W);
  assert.ok(!(A._shared && A._shared[0] && A._shared[0].length), 'ferries are left alone');
});

test('two branches of one line in the same colour (M1A/M1B) are left as one line; different colours are drawn apart', () => {
  const api = pure();
  let { A, B } = pairAB(false); A.color = '#EE2229'; B.color = '#ee2229';
  api.sharedComputeAll([A, B], W);
  assert.ok(!(A._shared && A._shared[0] && A._shared[0].length), 'same colour: one line on the trunk');
  ({ A, B } = pairAB(false)); A.color = '#E4032E'; B.color = '#F5871F';
  api.sharedComputeAll([A, B], W);
  assert.ok(A._shared && A._shared[0] && A._shared[0].length === 1, 'different colours: side by side');
});

test('a shared stretch shorter than 500 m is ignored', () => {
  const api = pure();
  const A = mk('A1', [eastPts(41, 29.0, 29.05, 0.002)], ['S1', 'S2']);
  const B = mk('B1', [[[41.01, 29.0], [41.001, 29.010], [41, 29.012], [41, 29.014], [41.001, 29.016], [41.01, 29.03]]], ['S1', 'S2']);
  api.sharedComputeAll([A, B], W);
  assert.ok(!(A._shared && A._shared[0] && A._shared[0].length), 'a ~170 m touch is not a shared track');
});

test('the two lines always go to opposite sides, whichever way each is drawn', () => {
  for (const rev of [false, true]) {
    const api = pure(), { A, B } = pairAB(rev);
    api.sharedComputeAll([A, B], W);
    const pt = [41, 29.014];
    const da = dirAt(api, A, 0, sNear(api, A, 0, pt)), db = dirAt(api, B, 0, sNear(api, B, 0, pt));
    assert.ok(da[0] * db[0] + da[1] * db[1] < -0.9, 'opposite sides' + (rev ? ' (B drawn backwards)' : '') + ': ' + da + ' vs ' + db);
  }
});

test('two lines a few metres apart each move away from the other', () => {
  const api = pure();
  const A = mk('A1', [eastPts(41, 29.0, 29.03, 0.002)], ['S1', 'S2']);
  const B = mk('B1', [eastPts(41.00005, 29.0, 29.03, 0.002)], ['S1', 'S2']);       // ~5.5 m north of A
  api.sharedComputeAll([A, B], W);
  const sA = sNear(api, A, 0, [41, 29.015]), sB = sNear(api, B, 0, [41.00005, 29.015]);
  const da = dirAt(api, A, 0, sA), db = dirAt(api, B, 0, sB);
  assert.ok(da[1] < -0.9, 'A (the southern one) moves south: ' + da);
  assert.ok(db[1] > 0.9, 'B (the northern one) moves north: ' + db);
  assert.ok(Math.abs(api.sharedAt(A, 0, sA).d - 5.5) < 1.5, 'the real distance to the partner is kept: ' + api.sharedAt(A, 0, sA).d);
});

test('the shift tapers to nothing over 150 m where the lines part, but not at a shared terminus', () => {
  const api = pure(), { A, B } = pairAB(false);
  api.sharedComputeAll([A, B], W);
  const r = A._shared[0][0];
  assert.strictEqual(api.SHARED.taper, 150);
  assert.strictEqual(api.sharedWeight(r, r.s1), 0, 'nothing at the split');
  assert.ok(Math.abs(api.sharedWeight(r, r.s1 - 75) - 0.5) < 1e-9, 'half way up the taper: half');
  assert.strictEqual(api.sharedWeight(r, r.s1 - 150), 1, 'full shift 150 m before the split');
  assert.strictEqual(api.sharedWeight(r, 0), 1, 'both lines start together: full shift right to the end, no taper');
});

test('zoomed out the lines get a full gap; zoomed in far enough, real separation takes over and the shift fades to 0', () => {
  const api = pure();
  const mppZ12 = api.sharedMpp(41, 12), mppZ18 = api.sharedMpp(41, 18);
  assert.ok(Math.abs(mppZ12 - 156543.03392 * Math.cos(41 * Math.PI / 180) / 4096) < 1e-9);
  assert.ok(Math.abs(api.sharedShiftPx(1, 0, 5.5, mppZ12) - 2.75) < 1e-9, 'coincident: each moves half the target gap');
  assert.ok(Math.abs(api.sharedShiftPx(-0.5, 0, 5.5, mppZ12) + 1.375) < 1e-9, 'sign and taper weight carried through');
  assert.strictEqual(api.sharedShiftPx(1, 6, 5.5, mppZ18), 0, '6 m apart at z18 is already > 5.5 px: no shift');
  const part = api.sharedShiftPx(1, 6, 5.5, api.sharedMpp(41, 16));
  assert.ok(part > 0 && part < 2.75, 'in between, only the shortfall: ' + part);
});

test('the offset maths: straight shifts exactly, corners are mitred (capped at 1.5x), zero leaves a point alone', () => {
  const api = pure();
  const flat = api.sharedOffsetRing([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], [2, 2, 0]);
  assert.deepStrictEqual(flat.slice(0, 2).map(p => [p.x, p.y]), [[0, -2], [100, -2]], 'left of an eastward line is up the screen');
  assert.deepStrictEqual([flat[2].x, flat[2].y], [200, 0], 'a zero shift stays put');
  const corner = api.sharedOffsetRing([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], [4, 4, 4]);
  const m = Math.hypot(corner[1].x - 100, corner[1].y);
  assert.ok(m > 4 * 1.4 && m <= 4 * 1.5 + 1e-9, 'a right-angle corner is pushed out by ~1.41x, never more than 1.5x: ' + m);
  const sharp = api.sharedOffsetRing([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 5 }], [4, 4, 4]);
  assert.ok(Math.hypot(sharp[1].x - 100, sharp[1].y) <= 6 + 1e-9, 'a hairpin is capped at 1.5x');
});

test('vertices are added at the taper break-points, and trains read exactly what the drawn line uses', () => {
  const api = pure(), { A, B } = pairAB(false);
  api.sharedComputeAll([A, B], W);
  const r = A._shared[0][0], info = api.sharedDrawInfo(A, 0, A.paths[0], 0);
  assert.ok(info && info.pts.length === info.s.length && info.s.length === info.k.length && info.k.length === info.d.length);
  for (const want of [r.s1 - 150, r.s1]) assert.ok(info.s.some(s => Math.abs(s - want) < 0.01), 'a vertex at s=' + want.toFixed(1));
  info.s.forEach((s, i) => assert.ok(Math.abs(api.sharedAt(A, 0, s).k - info.k[i]) < 1e-9, 'vertex ' + i + ' matches sharedAt'));
  assert.ok(info.k.some(k => k !== 0) && info.k.some(k => k === 0), 'shifted on the trunk, untouched past the split');
  assert.strictEqual(api.sharedDrawInfo(mk('Z9', [eastPts(42, 30, 30.01, 0.002)], ['a']), 0, [[42, 30], [42, 30.01]], 0), null, 'a line with no shared track gets nothing');
});

test('projection: a drawn ring is shifted by the shared info at the current zoom', () => {
  const api = pure(), { A, B } = pairAB(false);
  api.sharedComputeAll([A, B], W);
  const info = api.sharedDrawInfo(A, 0, A.paths[0], 0);
  const ring = info.pts.map((p, i) => ({ x: i * 10, y: 0 }));               // pretend projection: due east, 10 px apart
  const out = api.sharedProjectRing(ring, info, 12, 1);
  assert.strictEqual(out.length, ring.length);
  const moved = out.filter((p, i) => Math.abs(p.y - ring[i].y) > 1e-9).length;
  assert.ok(moved > 0 && moved < ring.length, 'only the shared part moves (' + moved + '/' + ring.length + ')');
  assert.strictEqual(api.sharedProjectRing(ring, Object.assign({}, info, { k: info.k.slice(1) }), 12, 1), ring, 'a ring that does not match vertex for vertex is left untouched');
});

/* ---- the real network: the four corridors from check 4 (checks_2026-11-18.md) ---- */
const DATA = path.join(__dirname, '..');
function cityLines(...files) {
  return [].concat(...files.map(f => require(path.join(DATA, f)))).filter(l => l.scope !== 'planned' && l.scope !== 'intercity')
    .map(l => ({ ref: l.ref, kind: l.kind, color: l.color, scope: l.scope, paths: l.paths, stations: l.stations }));
}
function runLen(l) { return ((l._shared && l._shared[0]) || []).reduce((a, r) => a + (r.s1 - r.s0), 0); }
test('real data: the four rail corridors are found, at the measured lengths, and nothing in Ankara or İzmir', () => {
  const api = pure();
  /* İstanbul: M1A/M1B share the same red, so they stay one line (see the colour test); Marmaray and T6 run side by side
     near Kazlıçeşme–Yedikule and Cerrahpaşa (found in the app on 18 Nov 2026; T6 lives in its own file). */
  const cases = [[['lines.json', 't6-line.json'], 'Marmaray', 'T6', 1500, 2600], [['antalya-lines.json'], 'T1A', 'T1B', 17000, 20000],
    [['bursa-lines.json'], 'B1', 'B2', 9000, 12500], [['kocaeli-lines.json'], 'T1', 'T2', 6500, 9000]];
  for (const [files, a, b, lo, hi] of cases) {
    const file = files.join('+'), ls = cityLines(...files), pairs = api.sharedComputeAll(ls, W);
    assert.deepStrictEqual(Array.from(pairs, x => x.a + '+' + x.b), [a + '+' + b], file + ': exactly one shared pair');
    const A = ls.find(l => l.ref === a), B = ls.find(l => l.ref === b);
    for (const l of [A, B]) assert.ok(runLen(l) > lo && runLen(l) < hi, file + ' ' + l.ref + ' shared ' + Math.round(runLen(l)) + ' m');
    const r = A._shared[0][0], mid = (r.s0 + r.s1) / 2, at = midPoint(api, A, mid);
    const da = dirAt(api, A, 0, mid), db = dirAt(api, B, 0, sNear(api, B, 0, at));
    assert.ok(da[0] * db[0] + da[1] * db[1] < -0.5, file + ': ' + a + ' and ' + b + ' on opposite sides');
  }
  for (const f of ['ankara-lines.json', 'izmir-lines.json']) {
    const ls = cityLines(f); api.sharedComputeAll(ls, W);
    assert.ok(ls.every(l => !runLen(l)), f + ' has no shared track');
  }
});
function midPoint(api, line, s) { const info = api.sharedDrawInfo(line, 0, line.paths[0], 0); let best = 0; info.s.forEach((v, i) => { if (Math.abs(v - s) < Math.abs(info.s[best] - s)) best = i; }); return info.pts[best]; }

/* ---- wiring in the built app ---- */
test('wiring: shared info is worked out at start-up, before the map draws the lines', () => {
  const s = APP();
  const calc = s.indexOf('sharedComputeAll(liveLines'), draw = s.indexOf('const lineLayers = {}');
  assert.ok(calc > 0 && draw > 0 && calc < draw, 'sharedComputeAll(liveLines, …) runs before 08-map builds the lines');
});
test('wiring: the glow/casing and the core of every non-ferry line are built as shared-aware polylines', () => {
  const s = APP(), a = s.indexOf('line.paths.forEach((path, pi)'), b = s.indexOf('lineLayers[line.ref] = { group:grp');
  assert.ok(a > 0 && b > a, 'the per-path drawing loop has an index');
  const body = s.slice(a, b), ferry = body.slice(0, body.indexOf('return;'));
  assert.ok(!/sharedPolyline/.test(ferry), 'ferries stay plain');
  assert.ok(/const glow = sharedPolyline\(line, pi, path,/.test(body), 'glow/casing');
  assert.ok(/const core = sharedPolyline\(line, pi, path,/.test(body.slice(body.indexOf('const glow'))), 'core');
});
test('wiring: the selection glow, the disruption stripes and the trains all move with their line', () => {
  const glow = fnSrc('setLineGlow');
  assert.ok(/sharedPolyline\(line, pi, path,/.test(glow) && /paths === line\.paths/.test(glow), 'the selection glow (boat lanes excepted)');
  const s = APP(), bands = s.slice(s.indexOf('bands.forEach(coords=>{'), s.indexOf('// warning marker(s)'));
  for (const v of ['aura', 'red', 'yellow', 'seam', 'hit']) assert.ok(new RegExp('const ' + v + '\\s*= sharedPolyline\\(line, 0, coords,').test(bands), 'disruption ' + v);
  const trains = fnSrc('drawTrains');
  assert.ok(/sharedTrainOffset\(tr\.line, tr\.s, z\)/.test(trains), 'drawTrains asks for the offset at the train\'s own distance');
  assert.ok(trains.indexOf('sharedTrainOffset') > trains.indexOf('latLngToContainerPoint') && trains.indexOf('sharedTrainOffset') < trains.indexOf('tctx.arc'), 'and applies it before drawing');
});
test('wiring: the Leaflet line class shifts the projected ring in _project, using the line\'s zoom scale', () => {
  const core = region('SHARED-CORE');
  assert.ok(/_project: function\(\)\{\s*L\.Polyline\.prototype\._project\.call\(this\)/.test(core), 'calls Leaflet\'s own projection first');
  assert.ok(/sharedProjectRing\(this\._rings\[0\], sh, z, lineScale\(z\)\)/.test(core), 'then shifts with the line scale of this zoom');
});

/* ---- the Leaflet class really shifts what it draws (a tiny stand-in for Leaflet: extend + a 1:1 projection) ---- */
test('the shifting Leaflet line moves its projected points by the shared info, and a plain line is untouched', () => {
  const api = pure(), { A, B } = pairAB(false);
  api.sharedComputeAll([A, B], W);
  function Polyline(latlngs, options) { this._latlngs = latlngs; this.options = options || {}; }
  Polyline.prototype._project = function () { this._rings = [this._latlngs.map((q, i) => ({ x: i * 10, y: 0 }))]; };
  Polyline.extend = function (props) { function C(a, b) { Polyline.call(this, a, b); } C.prototype = Object.create(Polyline.prototype); Object.assign(C.prototype, props); return C; };
  const L = { Polyline, point: (x, y) => ({ x, y, isPoint: true }), polyline: (a, b) => new Polyline(a, b) };
  const ctx = { Math, JSON, Number, Array, Object, Infinity, Set, Map, Int32Array, L, lineScale: () => 1, map: null, posAt: null };
  vm.createContext(ctx);
  vm.runInContext([line1('const R ='), line1('const toRad'), fnSrc('metersBetween'), region('SHARED-PURE'), region('SHARED-CORE')
    .replace(/try\{ sharedComputeAll\(liveLines[^\n]*\n[^\n]*\n/, ''), 'this.api = { sharedComputeAll, sharedPolyline };'].join('\n'), ctx);
  ctx.api.sharedComputeAll([A, B], W);
  const shared = ctx.api.sharedPolyline(A, 0, A.paths[0], { weight: 4 });
  assert.ok(shared.options.irnShared, 'a shared piece becomes the shifting kind');
  shared._map = { getZoom: () => 12 }; shared._project();
  const ys = shared._rings[0].map(p => p.y);
  assert.ok(ys.some(y => Math.abs(y) > 1) && ys.some(y => y === 0), 'the shared part is shifted, the rest is not: ' + ys.slice(0, 5));
  assert.ok(shared._rings[0].every(p => p.isPoint), 'points stay Leaflet points');
  const plain = ctx.api.sharedPolyline(mk('Z9', [eastPts(42, 30, 30.01, 0.002)], ['a']), 0, [[42, 30], [42, 30.01]], {});
  assert.ok(!plain.options.irnShared, 'a line with no shared track stays a plain Leaflet line');
});

/* ---- the data: no train runs out and back over its own path (M1A, İZBAN and Kocaeli T3 did until 18 Nov 2026) ---- */
test('data: no live line\'s train path runs out and back over itself', () => {
  const { repair } = require('../fix-backtracks.cjs');
  for (const f of ['lines.json', 'ankara-lines.json', 'izmir-lines.json', 'bursa-lines.json', 'antalya-lines.json', 'kocaeli-lines.json', 'cable-lines.json', 't6-line.json', 'b2-line.json']) {
    for (const l of require(path.join(DATA, f))) {
      if (l.scope === 'planned' || l.scope === 'intercity' || !l.paths || !l.paths[0]) continue;
      const r = repair(l.paths[0], l.stations);
      assert.ok(!r.action || /^REVIEW/.test(r.action), f + ' ' + l.ref + ': ' + r.action);
    }
  }
  const len = (f, ref) => { const p = require(path.join(DATA, f)).find(l => l.ref === ref).paths[0]; let s = 0; for (let i = 1; i < p.length; i++) s += pure().metersBetween(p[i - 1], p[i]); return s; };
  assert.ok(len('lines.json', 'M1A') < 21000, 'M1A is one trip Yenikapı → airport, not ~26 km out and back');
  assert.ok(len('kocaeli-lines.json', 'T3') < 5500, 'Kocaeli T3 is one trip, not there and back');
});
