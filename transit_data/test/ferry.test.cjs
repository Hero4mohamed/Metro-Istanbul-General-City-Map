'use strict';
/* Ferry lines stay on the water the map draws, and shared stretches are shared (V4.4.1).
 *
 * Measured before this update: eleven of İstanbul's thirteen ferry lines touched land (up to 230 m), Kocaeli's ran up to 10 km over
 * land, and lines between the same places ran side by side. The build now re-routes them (ferry-water.cjs). These tests read the
 * lines OUT OF THE BUILT PAGE and measure them against water-mask.json, the sea as the base map itself draws it.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');
const FW = require('../ferry-water.cjs');

const mask = FW.loadMask();
const QUAY = 120;                                   // a pier stands on the shore: land within this many metres of one is the pier itself
const ferriesOf = id => H.cities()[id].lines.filter(l => l.kind === 'ferry' && (l.stations || []).length >= 2);
const CITIES = Object.keys(mask);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

test('ferries: the cities with a water mask are the cities that have ferry lines', () => {
  const withFerries = Object.keys(H.cities()).filter(id => ferriesOf(id).length).sort();
  assert.deepStrictEqual(CITIES.slice().sort(), withFerries, 'a city has ferry lines and no water mask (add its box to fetch-water-mask.cjs), or the other way round');
  assert.ok(ferriesOf('istanbul').length >= 13, 'İstanbul lost ferry lines');
});

test('ferries: no ferry line crosses land', () => {
  const bad = [];
  for (const id of CITIES) for (const l of ferriesOf(id)) {
    assert.strictEqual(l.paths.length, 1, id + ' ' + l.ref + ' is not one continuous path');
    const m = FW.landMetres(mask[id], l.paths[0], l.stations, QUAY);
    if (m.land > 12) bad.push(id + ' ' + l.ref + ': ' + Math.round(m.land) + ' m on land (longest stretch ' + Math.round(m.worst) + ' m)');
  }
  assert.deepStrictEqual(bad, []);
});

test('ferries: every line calls at each of its piers, in order, and a pier has one position', () => {
  for (const id of CITIES) {
    const where = new Map();
    for (const l of ferriesOf(id)) {
      let at = 0; const p = l.paths[0];
      for (const s of l.stations) {
        const i = p.findIndex((q, k) => k >= at && q[0] === s.lat && q[1] === s.lng);
        assert.ok(i >= 0, id + ' ' + l.ref + ' does not pass through ' + s.name + ' (or passes it out of order)');
        at = i;
        const key = String(s.name).toLocaleLowerCase('tr');
        const seen = where.get(key) || [];
        if (!seen.some(q => q[0] === s.lat && q[1] === s.lng)) seen.push([s.lat, s.lng]);
        where.set(key, seen);
      }
      assert.ok(same(p[0], [l.stations[0].lat, l.stations[0].lng]) && same(p[p.length - 1], [l.stations[l.stations.length - 1].lat, l.stations[l.stations.length - 1].lng]), id + ' ' + l.ref + ' does not start and end at its terminal piers');
    }
    for (const [name, pts] of where) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
      assert.ok(FW.metres(pts[i], pts[j]) >= 700, id + ': the pier "' + name + '" is drawn in two places ' + Math.round(FW.metres(pts[i], pts[j])) + ' m apart');
  }
});

test('ferries: two lines between the same two piers use exactly the same path (no side-by-side lines)', () => {
  let shared = 0;
  for (const id of CITIES) {
    const hops = new Map();
    for (const l of ferriesOf(id)) {
      const p = l.paths[0]; let at = 0;
      for (let k = 1; k < l.stations.length; k++) {
        const a = l.stations[k - 1], b = l.stations[k];
        const i = p.findIndex((q, n) => n >= at && q[0] === a.lat && q[1] === a.lng), j = p.findIndex((q, n) => n > i && q[0] === b.lat && q[1] === b.lng);
        at = j;
        let seg = p.slice(i, j + 1);
        const fwd = a.lat < b.lat || (a.lat === b.lat && a.lng <= b.lng);
        if (!fwd) seg = seg.slice().reverse();
        const key = fwd ? a.lat + ',' + a.lng + '>' + b.lat + ',' + b.lng : b.lat + ',' + b.lng + '>' + a.lat + ',' + a.lng;
        const was = hops.get(key);
        if (was) { shared++; assert.strictEqual(JSON.stringify(seg), JSON.stringify(was.seg), id + ': ' + l.ref + ' and ' + was.ref + ' run between ' + a.name + ' and ' + b.name + ' on different paths'); }
        else hops.set(key, { seg, ref: l.ref });
      }
    }
  }
  assert.ok(shared >= 4, 'no two ferry lines share a hop any more: has the data changed?');
});

test('ferries: lines gather into shared lanes: most of the network is water more than one line uses, and no line wanders', () => {
  const g = mask.istanbul, lines = ferriesOf('istanbul');
  const cell = p => Math.floor(g.fx(p[1]) / 2) + ':' + Math.floor(g.fy(p[0]) / 2);         // ~30 m squares
  const count = new Map();
  for (const l of lines) {
    const mine = new Set(); const p = l.paths[0];
    for (let i = 1; i < p.length; i++) { const d = FW.metres(p[i - 1], p[i]), n = Math.max(1, Math.ceil(d / 12)); for (let s = 0; s <= n; s++) mine.add(cell([p[i - 1][0] + (p[i][0] - p[i - 1][0]) * s / n, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * s / n])); }
    for (const c of mine) count.set(c, (count.get(c) || 0) + 1);
  }
  const usedByMany = [...count.values()].filter(n => n > 1).length / count.size;
  assert.ok(usedByMany > 0.2, 'only ' + (100 * usedByMany).toFixed(0) + '% of the ferry water is shared: the lines have gone back to running each on its own path');
  for (const id of CITIES) for (const l of ferriesOf(id)) {
    const p = l.paths[0]; let len = 0, direct = 0;
    for (let i = 1; i < p.length; i++) len += FW.metres(p[i - 1], p[i]);
    for (let k = 1; k < l.stations.length; k++) direct += FW.metres([l.stations[k - 1].lat, l.stations[k - 1].lng], [l.stations[k].lat, l.stations[k].lng]);
    assert.ok(len < direct * 1.9 + 600, id + ' ' + l.ref + ' sails ' + Math.round(len) + ' m for ' + Math.round(direct) + ' m of straight hops: a wild detour');
    for (let i = 1; i < p.length; i++) assert.ok(FW.metres(p[i - 1], p[i]) < 25000, id + ' ' + l.ref + ' has a jump of ' + Math.round(FW.metres(p[i - 1], p[i])) + ' m');
  }
});

test('ferries: the checks above can fail: a line pushed inland, and a pier moved, are both noticed', () => {
  const g = mask.istanbul, l = JSON.parse(JSON.stringify(ferriesOf('istanbul').find(x => /Kadıköy/.test(x.ref))));
  assert.strictEqual(Math.round(FW.landMetres(g, l.paths[0], l.stations, QUAY).land), 0);
  const inland = l.paths[0].map(p => [p[0], p[1] + 0.03]);                                   // 2.5 km east: over Kadıköy and Üsküdar
  assert.ok(FW.landMetres(g, inland, l.stations, QUAY).land > 800, 'a line moved 2.5 km inland still measures as on water: the mask or the measure is broken');
  assert.strictEqual(g.isWater(41.0100, 29.0000), true, 'the middle of the Bosphorus mouth is not water in the mask');
  assert.strictEqual(g.isWater(40.9870, 29.0300), false, 'Moda is water in the mask');
  assert.strictEqual(mask.izmir.isWater(38.4300, 27.1100), true, 'the middle of İzmir bay is not water in the mask');
});
