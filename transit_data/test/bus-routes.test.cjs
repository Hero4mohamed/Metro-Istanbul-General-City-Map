/* Bus routes (V4.2): the going route and the coming route each on their own side of the road, each with its arrows and stops.
 *
 * The old drawing put both directions on the very same line, the returning one dashed over the going one, so on any street both
 * used one of them hid the other. The geometry is plain arithmetic in screen pixels, so it is tested as arithmetic, on the code that
 * ships (taken out of the built page), with a stand-in for the map.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

class Pt { constructor(x, y) { this.x = x; this.y = y; } distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y); } }
const point = (x, y) => new Pt(x, y);

function world({ zoom = 15, view = 'both', dirs = null } = {}) {
  const s = H.appScript(), a = s.indexOf("const BUS_VIEW = { v:'both' };"), b = s.indexOf('function busPathPoints(v)');
  assert.ok(a > 0 && b > a, 'the bus-route block is not in the page');
  const drawn = [];
  const add = (kind, pts, opts) => { const o = { kind, pts, opts, tip: null, bindTooltip(c) { o.tip = c; return o; }, addTo(g) { g.items.push(o); drawn.push(o); return o; } }; return o; };
  const L = { point, polyline: (p, o) => add('line', p, o), polygon: (p, o) => add('poly', p, o), circleMarker: (p, o) => add('dot', p, o), layerGroup: () => ({ items: [], clearLayers() { this.items = []; }, addTo() { return this; } }) };
  // an equirectangular stand-in: 1 degree = 1000 px at any zoom (the geometry does not depend on the projection)
  const map = { getZoom: () => zoom, project: (ll) => point(ll[1] * 1000, -ll[0] * 1000), unproject: (p) => [-p.y / 1000, p.x / 1000],
    getPixelBounds: () => ({ min: { x: -1e6, y: -1e6 }, max: { x: 1e6, y: 1e6 } }), on() {} };
  const layer = { hasLayer: () => true, clearLayers() {}, addLayer() {} };
  const api = new Function('L', 'map', 'busLayer', 'MAP_T', 'BUS_DIR_COLOR', 'svgEsc', 'attrEsc', 't', 'busDirPath', 'setTimeout', 'clearTimeout',
    s.slice(a, b) + '\nreturn { busOffset, busSnap, busArrows, busW, paintBus, drawBusDirs, busDirToggleHTML, BUS_VIEW, get busDraw(){ return busDraw; } };')(
    L, map, layer, () => ({ casing: '#08090B', casingOp: 0.92, hole: '#0A0B0D' }), ['#E8A33D', '#5BA8E8'], x => x, x => x, k => '[' + k + ']',
    d => d.stops.map(p => [p[0], p[1]]), setTimeout, clearTimeout);
  api.BUS_VIEW.v = view;
  return { api, drawn, map };
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('each direction is shifted to the RIGHT of its own travel, so the two directions of one street end up on opposite sides', () => {
  const { api } = world();
  const east = api.busOffset([point(0, 0), point(100, 0)], 5), west = api.busOffset([point(100, 0), point(0, 0)], 5);
  assert.ok(near(east[0].y, 5) && near(east[1].y, 5), 'going east, the right-hand side is south (down the screen)');
  assert.ok(near(west[0].y, -5) && near(west[1].y, -5), 'going west, the right-hand side is north');
  assert.ok(Math.abs(east[0].y - west[1].y) === 10, 'the two directions of one street are not 2 x the offset apart');
});

test('a corner is mitred so the line keeps its distance, a hairpin is capped, and points on top of each other cannot make a spike or a NaN', () => {
  const { api } = world();
  const c = api.busOffset([point(0, 0), point(100, 0), point(100, 100)], 5);
  assert.ok(near(c[1].x, 95) && near(c[1].y, 5), 'the inside of a right turn is not at (95,5): ' + c[1].x + ',' + c[1].y);
  const spike = api.busOffset([point(0, 0), point(100, 0), point(0, 1)], 5);
  assert.ok(spike.every(p => isFinite(p.x) && isFinite(p.y)), 'a hairpin produced a non-number');
  assert.ok(Math.hypot(spike[1].x - 100, spike[1].y) <= 5 * 2.2 + 1e-6, 'a hairpin threw the line further than the cap');
  const dup = api.busOffset([point(0, 0), point(0, 0), point(0.1, 0), point(100, 0)], 5);
  assert.ok(dup.every(p => isFinite(p.x) && isFinite(p.y)) && dup.length === 2, 'repeated points were not dropped');
  assert.deepStrictEqual(api.busOffset([point(1, 1)], 5).map(p => [p.x, p.y]), [[1, 1]]);
  assert.strictEqual(api.busOffset([point(0, 0), point(100, 0)], 0)[0].y, 0, 'a route with one direction was moved off its own line');
});

test('arrowheads point the way the bus goes, are spaced evenly, and are only made where they will be seen', () => {
  const { api } = world();
  const vb = { min: { x: -1e5, y: -1e5 }, max: { x: 1e5, y: 1e5 } };
  const east = api.busArrows([point(0, 0), point(400, 0)], 84, 8, 2.5, vb);
  assert.deepStrictEqual(east.map(a => Math.round(a[0].x - 4.8)), [42, 126, 210, 294, 378], 'the arrowheads are not evenly spaced from half a gap in');
  east.forEach(a => { assert.ok(a[0].x > a[1].x && a[0].x > a[2].x, 'an arrowhead points backwards'); assert.ok(near(a[1].y, -a[2].y), 'an arrowhead is lopsided'); });
  const west = api.busArrows([point(400, 0), point(0, 0)], 84, 8, 2.5, vb);
  west.forEach(a => assert.ok(a[0].x < a[1].x, 'going west the arrowheads do not point west'));
  // the spacing carries on across the corner of a path, and a stretch outside the box is walked past, not drawn
  const bent = api.busArrows([point(0, 0), point(100, 0), point(100, 100)], 84, 8, 2.5, vb);
  assert.strictEqual(bent.length, 2);
  const away = api.busArrows([point(0, 0), point(400, 0)], 84, 8, 2.5, { min: { x: 1000, y: 1000 }, max: { x: 2000, y: 2000 } });
  assert.strictEqual(away.length, 0, 'arrowheads were made for a stretch nobody can see');
  const half = api.busArrows([point(0, 0), point(400, 0)], 84, 8, 2.5, { min: { x: 200, y: -10 }, max: { x: 400, y: 10 } });
  assert.deepStrictEqual(half.map(a => Math.round(a[0].x - 4.8)), [210, 294, 378], 'drawing only the near part changed where the arrowheads are');
});

test('a stop that is not exactly on the centre line is drawn on its own direction\'s line', () => {
  const { api } = world();
  const base = [point(0, 0), point(100, 0)];
  const at = api.busSnap(base, 5, point(50, -3));
  assert.ok(near(at.x, 50) && near(at.y, 5), 'the stop is not on the shifted line: ' + at.x + ',' + at.y);
  const back = api.busSnap([point(100, 0), point(0, 0)], 5, point(50, -3));
  assert.ok(near(back.y, -5), 'the return direction\'s stop is not on the other side of the road');
});

function twoWayRoute() {
  const stops = [[40.0, 29.0, 'A'], [40.0, 29.4, 'B'], [40.0, 29.8, 'C']];     // 800 px long in the stand-in projection
  return [{ ref: '500T', head: 'C', stops }, { ref: '500T', head: 'A', stops: stops.slice().reverse() }];
}

test('both directions are drawn: an edge under each, then the two coloured lines, never one line over the other', () => {
  const { api, drawn } = world({ zoom: 15 });
  api.drawBusDirs(twoWayRoute(), null);
  const lines = drawn.filter(d => d.kind === 'line');
  assert.strictEqual(lines.length, 4, 'two edges and two lines are expected');
  assert.deepStrictEqual(lines.map(l => l.opts.color), ['#08090B', '#08090B', '#E8A33D', '#5BA8E8'], 'the edges must be drawn under both coloured lines');
  assert.ok(lines[2].opts.weight > 0 && !lines[2].opts.dashArray && !lines[3].opts.dashArray, 'the return line is dashed again: dashes over the other line are what hid it');
  // on the same street they are apart by twice the offset, going one way and the other: the lines are not on top of each other
  const ay = lines[2].pts[0][0], by = lines[3].pts[0][0];
  const w = api.busW(15), off = w * 0.62 + 1;
  assert.ok(Math.abs(Math.abs(ay - by) * 1000 - 2 * off) < 0.01, 'the two directions are not 2 x the offset apart: ' + Math.abs(ay - by) * 1000);
  assert.ok(2 * off > w, 'the two lines would touch');
  assert.ok(lines[2].tip.includes('500T → C') && lines[3].tip.includes('500T → A'), 'the lines do not say which way they go');
});

test('a route with one direction stays on its own line (nothing to separate from)', () => {
  const { api, drawn } = world({ zoom: 15 });
  const one = twoWayRoute().slice(0, 1);
  api.drawBusDirs(one, null);
  const line = drawn.filter(d => d.kind === 'line')[1];
  assert.ok(near(line.pts[0][0], 40.0, 1e-9), 'a one-way route was moved off the road');
});

test('zoomed out, only where each direction starts and ends is marked; zoomed in, every stop and the arrowheads', () => {
  const far = world({ zoom: 11 }); far.api.drawBusDirs(twoWayRoute(), null);
  assert.strictEqual(far.drawn.filter(d => d.kind === 'dot').length, 4, 'a whole-city view should show only 2 ends per direction');
  assert.strictEqual(far.drawn.filter(d => d.kind === 'poly').length, 0, 'arrowheads at city scale are noise');
  const near_ = world({ zoom: 16 }); near_.api.drawBusDirs(twoWayRoute(), null);
  assert.strictEqual(near_.drawn.filter(d => d.kind === 'dot').length, 6, 'every stop of both directions should be marked close up');
  assert.ok(near_.drawn.filter(d => d.kind === 'poly').length > 10, 'no arrowheads close up');
});

test('showing one direction fades the other, drops its arrows and stops, and says so in the control', () => {
  const { api, drawn } = world({ zoom: 16, view: 1 });
  api.drawBusDirs(twoWayRoute(), null);
  const lines = drawn.filter(d => d.kind === 'line');
  assert.ok(lines[2].opts.opacity < 0.4 && lines[3].opts.opacity > 0.9, 'the direction not chosen is not faded back');
  assert.ok(lines[0].opts.opacity < 0.3 && lines[1].opts.opacity > 0.9, 'the faded direction keeps a full-strength edge');
  assert.strictEqual(drawn.filter(d => d.kind === 'dot').length, 3, 'the faded direction still has its stops');
  const html = api.busDirToggleHTML(twoWayRoute());
  assert.ok(html.includes('data-v="both"') && html.includes('data-v="0"') && html.includes('data-v="1"') && html.includes('→ C') && html.includes('→ A'), 'the control does not offer both directions');
  assert.strictEqual(api.busDirToggleHTML(twoWayRoute().slice(0, 1)), '', 'a one-way route is offered a control with nothing to choose');
});

test('the route is redrawn when the zoom changes (the gap between the lines is a number of screen pixels) and only the near arrowheads are redrawn when it moves', () => {
  const s = H.appScript();
  assert.ok(/map\.on\('zoomend', busPaintSoon\);\s*map\.on\('moveend', busPaintSoon\);/.test(s), 'the route is not redrawn on zoom and move');
  assert.ok(/const key = z \+ '\|' \+ view \+ '\|' \+ tone\.casing;\s*if\(busDraw\.key !== key\)/.test(s), 'the two lines are rebuilt on every pan');
  const { api, drawn } = world({ zoom: 15 });
  api.drawBusDirs(twoWayRoute(), null);
  const first = drawn.filter(d => d.kind === 'line').length;
  api.paintBus();                                   // as after a pan: the lines are kept, the arrowheads and stops are made again
  assert.strictEqual(drawn.filter(d => d.kind === 'line').length, first, 'a pan rebuilt the two lines');
  assert.ok(drawn.filter(d => d.kind === 'dot').length > 6, 'a pan did not remake the stops');
});
