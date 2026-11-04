/* The carriage/label canvas and the bubbles that sit on the map (V4.3).
 *
 * #trainCanvas is one screen-sized canvas ABOVE the whole map (carriages must be above the lines). A warning bubble (or a hover
 * tooltip, or a popup) is a Leaflet layer INSIDE the map, so it was underneath: station names and carriage dots were printed straight
 * through the bubble's text on a phone. The canvas now clears whatever a bubble covers, and the pinned bubble is fully opaque.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const script = () => H.appScript().replace(/\r\n/g, '\n');
function fnSource(s, name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(s); assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = s.indexOf('{', m.index + m[0].length), d = 0;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return s.slice(m.index, i + 1); }
  throw new Error('unbalanced ' + name);
}
const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h });

test('whatever a tooltip, the pinned bubble or a popup covers is cleared out of the carriage canvas, with a margin, and nothing else is', () => {
  const cleared = [];
  const els = [{ getBoundingClientRect: () => rect(40, 290, 293, 102) }, { getBoundingClientRect: () => rect(10, 10, 0, 0) }];
  const ctx = vm.createContext({
    document: { querySelectorAll: sel => (/leaflet-tooltip/.test(sel) && /leaflet-popup/.test(sel) ? els : []) },
    tcv: { getBoundingClientRect: () => rect(0, 0, 375, 812) }, tctx: { clearRect: (...a) => cleared.push(a) },
  });
  vm.runInContext(fnSource(script(), 'clearUnderBubbles') + '\nclearUnderBubbles()', ctx);
  assert.deepStrictEqual(cleared, [[36, 286, 301, 110]], 'the canvas was not cleared exactly under the bubble (and only under visible ones): ' + JSON.stringify(cleared));
  // nothing open: nothing to do (and no layout work every frame)
  els.length = 0; cleared.length = 0;
  vm.runInContext('clearUnderBubbles()', ctx);
  assert.deepStrictEqual(cleared, []);
});

test('the carriage pass cuts the bubbles out AFTER it has drawn, every frame', () => {
  const f = fnSource(script(), 'renderOverlay');
  assert.ok(f.indexOf('drawLabels()') > 0 && f.indexOf('drawTrains(now)') > 0 && f.indexOf('clearUnderBubbles()') > f.indexOf('drawTrains(now)'), 'renderOverlay does not clear under the bubbles after drawing the labels and carriages');
});

test('the pinned warning bubble is opaque in every style, so no line or dot shows through its text', () => {
  const css = H.appStyle().replace(/\r\n/g, '\n');
  const base = /\.leaflet-tooltip\.lt\.disr-pin\{([^}]*)\}/.exec(css);
  assert.ok(base, 'the pinned bubble rule is missing');
  assert.match(base[1], /background-color:\s*#[0-9a-fA-F]{6}\b/, 'the pinned bubble has no solid background');
  assert.match(base[1], /backdrop-filter:\s*none/, 'a blurred translucent bubble lets the lines show through');
  const atlas = /body\.atlas \.leaflet-tooltip\.lt\.disr-pin\{([^}]*)\}/.exec(css);
  assert.ok(atlas && /var\(--obsidian\)/.test(atlas[1]), 'in Atlas (a translucent panel colour) the bubble must be laid over a solid colour');
});

/* ---- station names never print over each other ---- */
function labelWorld(stations, zoom) {
  const s = script();
  const drawn = [];
  const tctx = { save() {}, restore() {}, strokeText: (n, x, y) => drawn.push([n, x, y, 'stroke']), fillText: (n, x, y) => drawn.push([n, x, y, 'fill']),
    measureText: n => ({ width: n.length * 6 }), set font(v) {}, set textBaseline(v) {}, set textAlign(v) {}, set lineJoin(v) {}, set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {}, set globalAlpha(v) {} };
  const map = { getZoom: () => zoom, getSize: () => ({ x: 400, y: 800 }), latLngToContainerPoint: ll => ({ x: ll[1], y: ll[0] }) };
  const ctx = vm.createContext({ labelAlpha: 1, currentTab: 'active', stationList: stations, plannedStationList: [], map, tctx, LABEL_FONT: 'x', MAP_T: () => ({ halo: '#000', label: '#fff', labelMulti: '#fff' }), Map });
  vm.runInContext('let _lblSrc = null, _lblOrder = []; const _lblWidth = new Map();\n' + fnSource(s, 'drawLabels') + '\ndrawLabels()', ctx);
  return [...new Set(drawn.filter(d => d[3] === 'fill').map(d => d[0]))];
}
const st = (name, lat, lng, lines) => ({ name, lat, lng, lines: new Set(lines) });
test('station names never print over each other: interchanges are placed first, a name that would overlap is left out, names with room are all drawn', () => {
  // Plain stop at (100,100) and an interchange 5 px from it: they overlap, so only the interchange (placed first) is drawn
  const near = labelWorld([st('Plain stop', 100, 100, ['M1']), st('Interchange', 100, 105, ['M1', 'M2'])], 15);
  assert.deepStrictEqual(near, ['Interchange'], 'overlapping names were both drawn, or the plain one won over the interchange: ' + near);
  // far apart: both drawn
  assert.deepStrictEqual(labelWorld([st('Plain stop', 100, 100, ['M1']), st('Other stop', 300, 100, ['M2'])], 15).sort(), ['Other stop', 'Plain stop']);
  // stacked closely vertically (labels are 16 px tall): the second is left out; 20 px apart is fine
  assert.strictEqual(labelWorld([st('A', 100, 100, ['M1']), st('B', 108, 100, ['M1'])], 15).length, 1);
  assert.strictEqual(labelWorld([st('A', 100, 100, ['M1']), st('B', 120, 100, ['M1'])], 15).length, 2);
  // the existing rule stays: below zoom 14 only interchanges are named
  assert.deepStrictEqual(labelWorld([st('Plain stop', 100, 100, ['M1']), st('Interchange', 300, 300, ['M1', 'M2'])], 12), ['Interchange']);
});
