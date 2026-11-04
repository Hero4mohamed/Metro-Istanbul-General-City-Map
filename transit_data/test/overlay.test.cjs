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
