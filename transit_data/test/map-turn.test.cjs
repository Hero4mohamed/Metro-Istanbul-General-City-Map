/* Turning the map (V4.2): the geometry, the layers that have to follow it, and the fingers and mouse that turn it.
 *
 * Leaflet has no idea of a turned map; 07y-map-turn.js teaches it, by putting a "rotor" between the map pane and everything drawn,
 * and rewriting the two conversions between screen and layer pixels as a rotation about the middle of the screen. Almost every
 * defect this could have is a wrong sign or a wrong centre, and they all look alike on screen ("the map jumps", "it turns about the
 * wrong point", "the line is not on the road"). So the tests below are arithmetic: the real code, taken out of the built page,
 * run against a stand-in for the stock Leaflet methods it wraps (testkit/mini-leaflet.cjs).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');
const { mini } = require('../testkit/mini-leaflet.cjs');

const tick = () => new Promise(r => setTimeout(r, 8));
const near = (a, b, e = 1e-6, msg) => assert.ok(Math.abs(a - b) <= e, (msg || 'values differ') + ': ' + a + ' vs ' + b);
const nearPt = (p, q, e = 1e-6, msg) => { near(p.x, q.x, e, (msg || 'x') + ' x'); near(p.y, q.y, e, (msg || 'y') + ' y'); };

function load() {
  const s = H.appScript(), a = s.indexOf('const MAP_TURN = (function(){'), endMark = "L.Map.addInitHook('addHandler', 'irnMouse', L.Map.IrnMouse);", b = s.indexOf(endMark, a);
  assert.ok(a > 0 && b > a, 'the map-turning code is not in the page');
  const L = mini();
  const doc = { hidden: true, body: { classList: { contains: () => false } }, listeners: {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); },
    fire(t, ev) { (this.listeners[t] || []).slice().forEach(f => f(ev)); } };
  const queue = []; const frame = t => queue.splice(0).forEach(fn => fn(t));      // a screen's animation frames, run by hand
  const api = new Function('L', 'document', 'window', 'performance', 'cancelAnimationFrame', 'requestAnimationFrame', 'setTimeout', 'clearTimeout',
    s.slice(a, b + endMark.length) + '\nreturn { MAP_TURN };')(L, doc, {}, { now: () => 0 }, () => {}, fn => queue.push(fn), setTimeout, clearTimeout);
  return { L, doc, frame, MAP_TURN: api.MAP_TURN };
}
const make = (opts) => { const w = load(); const map = w.L.makeMap(Object.assign({ irnTurn: true, irnPinch: true, irnMouse: true, zoomAnimation: true }, opts)); map.setView([41, 29], 12); return Object.assign(w, { map }); };
const ANGLES = [0, 17, 90, 133, -45, 180, 271];

test('with the map not turned every method is Leaflet\'s own: north-up is the stock map', () => {
  const { map } = make(), stockL = mini(), stock = stockL.makeMap({}); stock.setView([41, 29], 12);
  map.panBy([30, -20]); stock.panBy([30, -20]);
  for (const p of [[0, 0], [200, 400], [399, 799]]) {
    nearPt(map.containerPointToLayerPoint(p), stock.containerPointToLayerPoint(p), 0, 'container->layer');
    nearPt(map.layerPointToContainerPoint(p), stock.layerPointToContainerPoint(p), 0, 'layer->container');
  }
  nearPt(map._getNewPixelOrigin([41.2, 29.1], 13), stock._getNewPixelOrigin([41.2, 29.1], 13), 0, 'pixel origin');
  nearPt(map._getCenterOffset([41.01, 29.02]), stock._getCenterOffset([41.01, 29.02]), 0, 'centre offset');
  const pb = map.getPixelBounds(), sb = stock.getPixelBounds(); nearPt(pb.min, sb.min, 0, 'bounds min'); nearPt(pb.max, sb.max, 0, 'bounds max');
  assert.strictEqual(map.getBoundsZoom([[40.9, 28.9], [41.1, 29.2]]), stock.getBoundsZoom([[40.9, 28.9], [41.1, 29.2]]));
  assert.strictEqual(map.getRotation(), 0);
});

test('a map that is not allowed to turn builds no rotor, ignores setRotation and keeps Leaflet\'s renderers and tile bounds', () => {
  const { map, L } = make({ irnTurn: false });
  assert.ok(!map._irnRotor, 'a rotor was built');
  map.setRotation(40); assert.strictEqual(map.getRotation(), 0, 'a map that cannot turn turned');
  const r = Object.create(L.Renderer.prototype); r._map = map; r._update();
  assert.deepStrictEqual([r._bounds.getSize().x, r._bounds.getSize().y], [800, 1600], 'the renderer is not the stock padded rectangle');
});

test('screen and layer pixels convert both ways at every angle, with the map panned', () => {
  for (const deg of ANGLES) {
    const { map } = make(); map.panBy([37, -21]); map.setRotation(deg);
    for (const p of [[0, 0], [400, 800], [123, 456], [200, 400]]) nearPt(map.layerPointToContainerPoint(map.containerPointToLayerPoint(p)), L_pt(p), 1e-9, 'round trip at ' + deg);
  }
  function L_pt(p) { return { x: p[0], y: p[1] }; }
});

test('turning keeps the middle of the screen where it is, and moves everything else about it like a turned sheet of paper', () => {
  for (const deg of [30, 90, -75, 200]) {
    const { map, MAP_TURN } = make(); map.panBy([55, 40]);
    const c0 = map.getCenter(), c = map.getSize().divideBy(2), spots = [[41.02, 29.03], [40.97, 28.94], [41.1, 29.2]];
    const before = spots.map(ll => map.latLngToContainerPoint(ll));
    map.setRotation(deg);
    const c1 = map.getCenter(); near(c1[0], c0[0], 1e-9, 'the centre moved (lat)'); near(c1[1], c0[1], 1e-9, 'the centre moved (lng)');
    nearPt(map.latLngToContainerPoint(c0), { x: c.x, y: c.y }, 0.51, 'the centre is not in the middle of the screen');
    spots.forEach((ll, i) => {
      const o = before[i].subtract(c), want = MAP_TURN.turn(o, deg * MAP_TURN.RAD).add(c);
      nearPt(map.latLngToContainerPoint(ll), want, 0.01, 'a place did not turn about the middle of the screen (' + deg + ')');
    });
  }
});

test('after a move the new centre is in the middle of the screen, at any angle and pan', () => {
  for (const deg of [0, 25, 160, -100]) {
    const { map } = make(); map.panBy([-80, 33]); map.setRotation(deg);
    const target = [41.07, 29.11]; map._move(target, 14);
    const c = map.getSize().divideBy(2);
    nearPt(map.latLngToContainerPoint(target), { x: c.x, y: c.y }, 0.8, 'the new centre is off the middle at ' + deg);
  }
});

test('the box of tiles to load holds the whole turned screen, and swaps its sides at a right angle', () => {
  const { map } = make(); map.panBy([20, 10]);
  for (const deg of ANGLES) {
    map.setRotation(deg);
    const b = map.getPixelBounds(), o = map.getPixelOrigin();
    for (const p of [[0, 0], [400, 0], [0, 800], [400, 800]]) {
      const proj = map.containerPointToLayerPoint(p).add(o);
      assert.ok(proj.x >= b.min.x - 1e-6 && proj.x <= b.max.x + 1e-6 && proj.y >= b.min.y - 1e-6 && proj.y <= b.max.y + 1e-6, 'a corner of the screen is outside the box at ' + deg);
    }
  }
  map.setRotation(90); const s = map.getPixelBounds().getSize(); near(s.x, 800, 1e-6, 'width at 90'); near(s.y, 400, 1e-6, 'height at 90');
  map.setRotation(45); const t = map.getPixelBounds().getSize(); near(t.x, (400 + 800) * Math.SQRT1_2, 1e-6, 'the box at 45 degrees');
});

test('fitting bounds into a turned screen measures them as the turned screen sees them', () => {
  const { map } = make(), wide = [[40.99, 28.9], [41.01, 29.1]];   // twice as wide as it is tall, on a screen that is twice as tall as it is wide
  const upright = map.getBoundsZoom(wide); map.setRotation(90);
  assert.ok(map.getBoundsZoom(wide) > upright, 'a wide area should fit one zoom closer on a screen turned a quarter');
  map.setRotation(0); assert.strictEqual(map.getBoundsZoom(wide), upright, 'turning back changed the answer');
});

test('the line and station canvases are one square that holds the screen at EVERY angle, so turning never redraws them', () => {
  const { map, L } = make(), size = map.getSize(), diag = Math.hypot(size.x, size.y);
  const r = Object.create(L.Renderer.prototype); r._map = map; r._container = L.DomUtil.create('canvas');
  for (const deg of ANGLES.concat([45, 63.4])) {
    map.setRotation(deg); r._update();
    const b = r._bounds, s = b.getSize(); assert.strictEqual(s.x, s.y, 'not a square');
    assert.ok(s.x >= diag + 0.3 * Math.max(size.x, size.y), 'too small for a screen that is turned and then panned: ' + s.x);
    assert.ok(s.x <= diag + 0.5 * Math.max(size.x, size.y), 'much bigger than it needs to be (memory): ' + s.x);
    for (const p of [[0, 0], [size.x, 0], [0, size.y], [size.x, size.y]]) {
      const l = map.containerPointToLayerPoint(p);
      assert.ok(l.x > b.min.x && l.x < b.max.x && l.y > b.min.y && l.y < b.max.y, 'a corner of the screen is off the canvas at ' + deg);
    }
    nearPt(b.getCenter(), map.containerPointToLayerPoint(size.divideBy(2)), 1, 'the canvas is not centred on the middle of the screen');
  }
});

test('a canvas that is not moved or zoomed stays exactly where it is (the transform offset is its own top-left)', () => {
  const { map, L } = make(), r = Object.create(L.Renderer.prototype); r._map = map; r._container = L.DomUtil.create('canvas');
  map.setRotation(37); r._update();
  r._updateTransform(r._center, r._zoom);
  assert.ok(r._container.style.transform.indexOf('translate3d(' + r._bounds.min.x + 'px,' + r._bounds.min.y + 'px,0)') === 0 && /scale\(1\)$/.test(r._container.style.transform), 'the canvas jumped: ' + r._container.style.transform);
});

test('everything Leaflet draws sits under a rotor that is turned about the middle of the screen, and a pane made later goes under it too', () => {
  const { map, L } = make();
  const rotor = map._irnRotor; assert.ok(rotor && rotor.parentNode === map._mapPane, 'no rotor under the map pane');
  for (const n of ['tilePane', 'overlayPane', 'markerPane', 'tooltipPane', 'popupPane']) assert.strictEqual(map._panes[n].parentNode, rotor, n + ' is not under the rotor');
  const late = map.createPane('stationPane'); assert.strictEqual(late.parentNode, rotor, 'a pane made later is outside the rotor, so it would not turn');
  map.setRotation(30);
  assert.strictEqual(rotor.style.transform, 'rotate(' + 30 * Math.PI / 180 + 'rad)');
  assert.strictEqual(rotor.style.transformOrigin, '200px 400px', 'the rotor does not turn about the middle of the screen');
  assert.strictEqual(rotor.style.props['--irn-up'], (-30 * Math.PI / 180) + 'rad', 'markers are not told how to stand upright');
  map.setRotation(0); assert.strictEqual(rotor.style.transform, '', 'north-up left a transform on the rotor');
});

test('the pan of the map pane turns with the map, so the middle of the screen does not drift', () => {
  const { map, MAP_TURN } = make(); map.panBy([100, 0]);                          // the pane's position is (-100, 0)
  const p0 = map._getMapPanePos(); map.setRotation(90);
  nearPt(map._getMapPanePos(), MAP_TURN.turn(p0, Math.PI / 2), 1e-9, 'the pan was not turned with the map');
});

test('markers, tooltips and popups turn back about the place they point at, by one CSS variable, so a turn costs one write', () => {
  const { map, L } = make();
  const icon = L.DomUtil.create('div'); icon.style.marginLeft = '-11px'; icon.style.marginTop = '-13px';
  const m = Object.create(L.Marker.prototype); m._map = map; m._icon = icon; m.options = { zIndexOffset: 0 }; m._setPos(L.point(10, 20));
  assert.ok(/ rotate\(var\(--irn-up,0rad\)\)$/.test(icon.style.transform) && icon.style.transformOrigin === '11px 13px', 'a marker does not turn back about its anchor: ' + icon.style.transform + ' / ' + icon.style.transformOrigin);
  const tip = Object.create(L.Tooltip.prototype); tip._map = map; tip.options = { offset: [0, -8] }; tip._container = L.DomUtil.create('div'); tip._container.offsetWidth = 100; tip._container.offsetHeight = 40;
  tip._setPosition(L.point(300, 300));                                           // its corner goes to (250, 252); the place it points at is (300, 300)
  assert.strictEqual(tip._container.style.transformOrigin, '50px 48px', 'a tooltip does not turn back about the place it points at');
  const pop = Object.create(L.Popup.prototype); pop._map = map; pop._latlng = [41, 29]; pop._zoomAnimated = true; pop._container = L.DomUtil.create('div'); pop._container.offsetLeft = -60; pop._container.offsetTop = -30;
  pop._updatePosition();
  assert.strictEqual(pop._container.style.transformOrigin, '60px 30px', 'a popup does not turn back about its anchor');
  map.setRotation(50); pop._panned = false; pop._adjustPan(); assert.ok(!pop._panned, 'a popup tried to keep itself in view with an upright screen in mind');
  const { map: still, L: L2 } = make({ irnTurn: false }); const i2 = L2.DomUtil.create('div'); const m2 = Object.create(L2.Marker.prototype); m2._map = still; m2._icon = i2; m2.options = { zIndexOffset: 0 }; m2._setPos(L2.point(1, 1));
  assert.ok(!/irn-up/.test(i2.style.transform), 'a map that cannot turn got turning code on its markers');
});

test('raster tile layers load the tiles of the turned screen, not of an upright one', () => {
  const { map, L } = make(), g = Object.create(L.GridLayer.prototype); g._map = map; g._tileZoom = 12; g.options = { updateInterval: 200, updateWhenIdle: false };
  const flat = g._getTiledPixelBounds([41, 29]).getSize(); map.setRotation(45);
  const turned = g._getTiledPixelBounds([41, 29]).getSize();
  assert.ok(turned.x > flat.x && turned.y > flat.y, 'the box of tiles did not grow for a turned screen: ' + turned.x + ' vs ' + flat.x);
  near(turned.x, (400 + 800) * Math.SQRT1_2, 1e-6); assert.ok('rotate' in g.getEvents(), 'tiles are not loaded as the map turns');
});

/* ---- the MapLibre layers ---- */
function glWorld(deg) {
  const w = make(); const { map, L } = w; map.setRotation(deg);
  const layer = Object.create(L.MaplibreGL.prototype); layer._map = map; layer.options = { padding: 0.1 }; layer._container = L.DomUtil.create('div');
  layer._glMap = { transform: { width: 480, height: 960, bearing: 0 }, _update() { this.updated = true; }, _resize() { this.resized = true; }, jumpTo(o) { this.jumped = o; } };
  return Object.assign(w, { layer });
}
test('the base map is told the angle (MapLibre turns the other way round) and its box is centred on the screen and turned back to upright', () => {
  const { map, layer, MAP_TURN } = glWorld(40);
  layer._update();
  near(layer._glMap.transform.bearing, -40, 1e-9, 'MapLibre was not told to turn the map by minus the angle');
  const c = map.containerPointToLayerPoint(map.getSize().divideBy(2)), want = c.subtract({ x: 240, y: 480 });
  assert.ok(layer._container.style.transform.indexOf('translate3d(' + Math.round(want.x) + 'px,' + Math.round(want.y) + 'px,0) rotate(' + (-40 * MAP_TURN.RAD) + 'rad)') === 0, 'the box is not centred on the screen, or not turned back: ' + layer._container.style.transform);
  assert.strictEqual(layer._container.style.transformOrigin, '50% 50%');
  assert.ok(layer._glMap.updated, 'MapLibre was not asked to draw');
});
test('north-up hands the base map over to the stock bridge untouched, and takes its box back to a plain position', () => {
  const { layer } = glWorld(0);
  layer._update(); assert.ok(layer.stockUpdate, 'north-up did not use the stock update');
  layer._pinchZoom(); layer._animateZoom({ zoom: 13, center: [41, 29] }); layer._zoomEnd(); layer._transitionEnd();
  assert.ok(layer.stockPinch && layer.stockAnim && layer.stockZoomEnd && layer.stockTransition, 'a stock method was not called at north-up');
  assert.strictEqual(layer._glMap.transform.bearing, 0);
});
test('a pinch and a zoom animation carry the angle and the scale to the base map', () => {
  const { map, layer } = glWorld(40);
  layer._pinchZoom(); assert.ok(near(layer._glMap.jumped.bearing, -40, 1e-9) === undefined, 'a pinch does not carry the bearing');
  layer._animateZoom({ zoom: 14, center: map.getCenter() });
  assert.ok(/rotate\(-0\.6981\d*rad\) scale\(4\)$/.test(layer._container.style.transform), 'a two-level zoom is not a scale of 4 on a turned box: ' + layer._container.style.transform);
  assert.ok(/leaflet-zoom-animated/.test(layer._container.className), 'the box is not animated with the other layers');
});

test('while two fingers turn the map, the base map is turned back by the angle the map has NOW, every frame (it used to keep the angle from when the fingers went down)', () => {
  const { map, layer, MAP_TURN } = glWorld(0);
  layer._zooming = true;                       // zoomstart has fired: this is what _update() sees for the whole of a pinch
  const back = deg => (deg === 0 ? '' : 'rotate(' + (-deg * MAP_TURN.RAD) + 'rad)');
  for (const deg of [10, 25, 40, -15]) {
    map.setRotation(deg); layer._pinchZoom();
    assert.ok(layer._container.style.transform.indexOf(back(deg)) > 0, 'at ' + deg + ' degrees the base map box is not turned back by ' + deg + ': ' + layer._container.style.transform);
    near(layer._glMap.jumped.bearing, -deg, 1e-9, 'MapLibre bearing at ' + deg);
    assert.ok(layer._container._irnTurned, 'the box is not marked as turned');
  }
  // the lines are in the rotor, turned by the map's angle: the box inside it must be turned by minus that, so the two cancel
  assert.ok(Math.abs(map.getRotation() - (-15)) < 1e-6);
  map.setRotation(0); layer._pinchZoom();
  assert.ok(!layer._container._irnTurned && !/rotate/.test(layer._container.style.transform) && !/leaflet-zoom-animated/.test(layer._container.className), 'back at north-up the box keeps a turn it no longer needs');
});

/* ---- fingers ---- */
const touch = pts => ({ touches: pts.map(p => ({ clientX: p[0], clientY: p[1] })), defaultPrevented: false });
const pinchAt = (mid, ang, dist) => [[mid[0] - Math.cos(ang) * dist / 2, mid[1] - Math.sin(ang) * dist / 2], [mid[0] + Math.cos(ang) * dist / 2, mid[1] + Math.sin(ang) * dist / 2]];
async function pinch(w, steps) {          // steps: [[angleDeg, dist], ...] about the middle point mid
  const { map, L, doc } = w, mid = [240, 340];
  w.anchor = map.containerPointToLatLng(mid); w.mid = mid;
  L.DomEvent.fire(map._container, 'touchstart', touch(pinchAt(mid, steps[0][0] * Math.PI / 180, steps[0][1])));
  for (const [a, d] of steps.slice(1)) L.DomEvent.fire(doc, 'touchmove', touch(pinchAt(mid, a * Math.PI / 180, d)));
  await tick();
}
test('two fingers: a wobble of a few degrees does not turn the map, but zoom and the place under the fingers still follow', async () => {
  const w = make(); map = w.map; const z0 = w.map.getZoom();
  await pinch(w, [[0, 100], [2, 110], [4, 130], [5, 150]]);
  assert.strictEqual(w.map.getRotation(), 0, 'a 5 degree wobble turned the map');
  near(w.map.getZoom(), z0 + Math.log2(1.5), 1e-9, 'the zoom does not follow the spread of the fingers');
  const at = w.map.latLngToContainerPoint(w.anchor); nearPt(at, { x: w.mid[0], y: w.mid[1] }, 1.2, 'the place under the fingers moved');
});
test('two fingers: a clear twist turns the map from the end of the wobble (no jump), and the place under the fingers stays under them', async () => {
  const w = make(); await pinch(w, [[0, 100], [8, 100], [14, 100], [30, 100], [45, 100]]);
  near(w.map.getRotation(), 45 - 8, 0.0001, 'the map did not follow the twist after its start');   // the first step past 7 degrees (8) is where the turn starts: no jump, then it follows
  const at = w.map.latLngToContainerPoint(w.anchor); nearPt(at, { x: w.mid[0], y: w.mid[1] }, 1.2, 'the place under the fingers moved while turning');
});
test('two fingers: the twist is continuous across the half-turn, where an angle jumps from 180 to -180', async () => {
  const w = make(); await pinch(w, [[170, 100], [178, 100], [186, 100], [194, 100], [200, 100]]);
  near(w.map.getRotation(), 30 - 8, 0.0001, 'the angle jumped across the half-turn: ' + w.map.getRotation());
});
test('two fingers: a wobble that happens to straddle the half-turn is still a wobble', async () => {
  const w = make(); await pinch(w, [[176, 100], [179, 100], [182, 100], [181, 100]]);      // 5 degrees in all; 182 is read as -178
  assert.strictEqual(w.map.getRotation(), 0, 'a 5 degree wobble across the half-turn turned the map');
});
test('two fingers do not turn the map when the person has switched turning off, but still zoom it', async () => {
  const w = make(); w.map._irnTurnOn = false; const z0 = w.map.getZoom(); await pinch(w, [[0, 100], [30, 140], [60, 200]]);
  assert.strictEqual(w.map.getRotation(), 0); near(w.map.getZoom(), z0 + 1, 1e-9);
});
test('lifting the fingers settles the zoom (and the angle onto north if it is within 5 degrees)', async () => {
  const w = make(); await pinch(w, [[0, 100], [10, 110], [23, 150]]);       // the turn starts at 10; at 23 it is 13 degrees
  const { map, L, doc } = w; L.DomEvent.fire(doc, 'touchend', touch([]));
  assert.ok(map.animated && map.animated[1] === Math.round(12 + Math.log2(1.5)), 'the zoom was not settled to a whole level: ' + JSON.stringify(map.animated));
  map.fire('zoomend'); await tick(); assert.ok(near(map.getRotation(), 13, 1e-6) === undefined, 'a 13 degree turn must stay where it is');
  const v = make(); await pinch(v, [[0, 100], [9, 100], [12, 100]]);         // 12 - 9 = 3 degrees of turn: close enough to north
  v.L.DomEvent.fire(v.doc, 'touchend', touch([])); v.map.fire('zoomend'); await tick(); await tick();
  assert.strictEqual(v.map.getRotation(), 0, 'a turn of 3 degrees did not settle onto north');
});

/* ---- mouse, wheel, keys ---- */
const press = (over) => Object.assign({ button: 0, ctrlKey: false, clientX: 100, clientY: 300, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }, over);
test('mouse: right-drag (or Ctrl + drag) sideways turns the map, a plain drag is left to Leaflet', () => {
  const w = make(); const down = w.map._container.listeners.mousedown[0];
  const plain = press({ button: 0 }); down(plain); assert.ok(!plain.prevented && !plain.stopped, 'a plain left press was taken from Leaflet\'s dragging');
  const right = press({ button: 2 }); down(right); assert.ok(right.prevented && right.stopped, 'a right press was not taken');
  w.doc.fire('mousemove', { clientX: 200 }); near(w.map.getRotation(), 30, 1e-9, '100 px sideways is 30 degrees');
  w.doc.fire('mouseup', {});
  const ctrl = press({ button: 0, ctrlKey: true }); down(ctrl); assert.ok(ctrl.prevented, 'Ctrl + left press was not taken');
  w.doc.fire('mouseup', {});
  w.map._irnTurnOn = false; const off = press({ button: 2 }); down(off); assert.ok(!off.prevented, 'a press was taken while turning is switched off');
});
test('wheel: Shift + wheel turns the map and is kept from zooming it; a plain wheel is left alone', () => {
  const w = make(); const wheel = w.map._container.listeners.wheel[0];
  const zoomWheel = press({ shiftKey: false, deltaY: -120, deltaMode: 0 }); wheel(zoomWheel); assert.ok(!zoomWheel.prevented && w.map.getRotation() === 0, 'a plain wheel was taken');
  const turnWheel = press({ shiftKey: true, deltaY: 100, deltaMode: 0 }); wheel(turnWheel); near(w.map.getRotation(), 12, 1e-9); assert.ok(turnWheel.prevented && turnWheel.stopped, 'Shift + wheel was left for the zoom as well');
});
test('keys: Shift + left/right turn by 15 degrees and are kept from panning Leaflet three times as far; other keys are left alone', () => {
  const w = make(); const key = w.map._container.listeners.keydown[0];
  const arrow = press({ key: 'ArrowRight', shiftKey: true, altKey: false, metaKey: false }); key(arrow); near(w.map.getRotation(), 15, 1e-9); assert.ok(arrow.prevented && arrow.stopped);
  const left = press({ key: 'ArrowLeft', shiftKey: true, altKey: false, metaKey: false }); key(left); key(left); near(w.map.getRotation(), -15, 1e-9);
  const plain = press({ key: 'ArrowRight', shiftKey: false, altKey: false, metaKey: false }); key(plain); assert.ok(!plain.prevented, 'an arrow key without Shift was taken from the keyboard panning');
});
test('turning the short way round: 350 to 10 is 20 degrees, not 340; and within 5 degrees of north the map settles onto it', () => {
  const w = make(); w.map.setRotation(350); w.map.rotateTo(10, 0); near(w.map.getRotation(), 10, 1e-9);
  w.map.setRotation(10); w.map.rotateTo(350, 0); near(w.map.getRotation(), -10, 1e-9);
  w.map.setRotation(4); w.map._irnSnap(); assert.strictEqual(w.map.getRotation(), 0, 'within 5 degrees must settle onto north');
  w.map.setRotation(6); w.map._irnSnap(); near(w.map.getRotation(), 6, 1e-9, '6 degrees is a deliberate turn');
  // and the way it GOES is the short one: from 170 to -170 the map passes through 180, it does not swing back through 0
  const a = make(); a.doc.hidden = false; a.map.setRotation(170); a.map.rotateTo(-170, 100); a.frame(0); a.frame(50);
  const half = ((a.map.getRotation() - 170 + 540) % 360) - 180;
  assert.ok(half > 0 && half < 20, 'half way from 170 to -170 the map is at ' + a.map.getRotation() + ' (it should be just past 170, going the short way)');
  a.frame(100); near((a.map.getRotation() + 360) % 360, 190, 1e-6, 'the turn did not arrive');
  let rotated = 0, moved = 0; w.map.on('rotateend', () => rotated++); w.map.on('moveend', () => moved++); w.map.rotateTo(80, 0);
  assert.strictEqual(rotated, 1); assert.strictEqual(moved, 1, 'tile layers and canvases are told once, at the end of a turn');
});

/* ---- how the page is put together ---- */
test('the page makes a map that can be turned (unless the person switched it off), by our own two-finger handler, with a compass', () => {
  const s = H.appScript(), html = H.html();
  assert.ok(/const TURNABLE = mapTurnPref;/.test(s) && /irnTurn:TURNABLE, irnPinch:TURNABLE && L\.Browser\.touch, irnMouse:TURNABLE, touchZoom:!TURNABLE && L\.Browser\.touch/.test(s), 'the map is not made turnable from the saved setting, or Leaflet\'s own two-finger zoom is still on beside ours');
  assert.ok(/let mapTurnPref = lsStr\('irn_turn'\) !== '0';/.test(s), 'turning is not on by default');
  assert.ok(/<button id="compassBtn" class="compass-fab glass"[^>]*hidden>/.test(html), 'the compass button is gone');
  assert.ok(/id="swTurn" role="switch"/.test(html) && /getElementById\('swTurn'\)\.addEventListener\('click', \(\)=> setMapTurn\(!mapTurnPref\)\);/.test(s), 'the Settings switch is not wired');
  assert.ok(/\.leaflet-container\{touch-action:none;\}/.test(html), 'the map can be zoomed or scrolled by the browser instead of by us');
  assert.ok(/map\.createPane\(VEC_LABEL_PANE\)/.test(s), 'the names pane is made in an unexpected way (it must go through map.createPane to land under the rotor)');
});
