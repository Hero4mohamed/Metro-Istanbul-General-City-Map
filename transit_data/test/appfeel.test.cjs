/* The app feels like an app (V4.3): only the map zooms and pans; the tabs, panels and page never do.
 *
 * Pinching the tabs used to zoom the whole page and distort it. touch-action is the intersection of an element's value and its
 * ancestors', so `pan-x pan-y` on html and body takes pinch and double-tap zoom away from everything, and the map's own
 * `touch-action:none` keeps its gestures. iOS reports its pinch as "gesture" events instead, which are cancelled unless they start on
 * the map. The price (WCAG 1.4.4 resize text) is paid back inside the app: Settings > Text size, and the device's own magnifier.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const css = () => H.appStyle().replace(/\r\n/g, '\n');
const head = () => H.html().split('</head>')[0];

test('the viewport is locked to the page width and scale, so the page itself cannot be pinched', () => {
  const m = /<meta name="viewport" content="([^"]+)"/.exec(head()); assert.ok(m, 'no viewport');
  const v = Object.fromEntries(m[1].split(',').map(p => p.trim().split('=')));
  assert.strictEqual(v['user-scalable'], 'no'); assert.strictEqual(v['maximum-scale'], '1.0'); assert.strictEqual(v['minimum-scale'], '1.0');
  assert.strictEqual(v.width, 'device-width'); assert.strictEqual(v['viewport-fit'], 'cover');
});

test('html and body allow panning but not pinching; the map keeps all of its own gestures', () => {
  const root = /html,body\{touch-action:pan-x pan-y;([^}]*)\}/.exec(css()); assert.ok(root, 'html and body are not limited to panning');
  assert.match(root[1], /overscroll-behavior:none/, 'the page still rubber-bands / pull-to-refreshes');
  assert.match(root[1], /-webkit-touch-callout:none/); assert.match(root[1], /-webkit-tap-highlight-color:transparent/);
  assert.match(root[1], /user-select:none/, 'text selects like a document');
  assert.match(css(), /\.leaflet-container\{touch-action:none;\}/, 'the map no longer owns its own gestures: it could not be pinched or turned');
  assert.match(css(), /input,textarea,select,\[contenteditable="true"\]\{-webkit-user-select:text;user-select:text;\}/, 'typing fields cannot select (on iOS an input inside a user-select:none body cannot even be typed in)');
  // nothing re-enables pinch on the chrome: a `touch-action:pinch-zoom` / `manipulation` on html or body would undo it
  assert.ok(!/(?:^|\n)\s*(?:html|body)[^{]*\{[^}]*touch-action:\s*(?:auto|manipulation|pinch-zoom)/.test(css()), 'html or body allows pinch again');
});

test('a pinch that does not start on the map is cancelled (iOS gesture events), and one that does is left alone', () => {
  const s = H.appScript().replace(/\r\n/g, '\n');
  const i = s.indexOf("['gesturestart', 'gesturechange', 'gestureend']"); assert.ok(i > 0, 'the gesture handler is missing');
  const code = s.slice(s.lastIndexOf('(function(){', i), s.indexOf('\n})();', i) + 6);
  const listeners = {};
  const ctx = vm.createContext({ document: { addEventListener: (t, f, o) => { listeners[t] = { f, o }; } }, window: {}, matchMedia: () => ({ matches: false }) });
  vm.runInContext(code, ctx);
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) assert.ok(listeners[t] && listeners[t].o && listeners[t].o.passive === false, t + ' is not a cancelable listener');
  const ev = onMap => { const e = { prevented: false, target: { closest: sel => (sel === '#map' && onMap ? {} : null) }, preventDefault() { e.prevented = true; } }; return e; };
  const a = ev(false), b = ev(true);
  listeners.gesturestart.f(a); listeners.gesturestart.f(b);
  assert.strictEqual(a.prevented, true, 'a pinch on the chrome was not cancelled');
  assert.strictEqual(b.prevented, false, 'a pinch on the map was cancelled: the map could not be zoomed');
});

test('with page zoom gone, text can still be enlarged inside the app, and the manifest keeps the standalone look', () => {
  assert.match(H.html(), /id="textSeg"[\s\S]{0,400}data-ts="large"/, 'no in-app text size control');
  const m = JSON.parse(H.read('manifest.webmanifest')); assert.strictEqual(m.display, 'standalone');
  assert.match(head(), /apple-mobile-web-app-capable" content="yes"/); assert.match(head(), /name="mobile-web-app-capable" content="yes"/);
});
