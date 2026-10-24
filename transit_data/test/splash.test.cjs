/* The loading screen (V4.1): the icon's own background, the strait without the "M", behind the icon, instead of a black screen.
 *
 * Three things can go wrong with it and each is checked here. The pictures can be the wrong size or too heavy for a phone's first
 * visit. The colour the phone shows before the page paints (the manifest's background_color) can drift from the colour the page
 * starts with, which brings back a flash of a different colour between the two. And, worst, the screen can fail to leave and sit
 * on top of the app: it must go when the map is ready, no later than a fixed ceiling, and by itself in CSS if the script never runs.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const ROOT = path.join(__dirname, '..', '..');
const BASE_COLOUR = '#0E2A3F';

/* width and height of a JPEG, read from its start-of-frame marker */
function jpeg(f) {
  const b = fs.readFileSync(path.join(ROOT, f));
  assert.deepStrictEqual([b[0], b[1]], [0xFF, 0xD8], f + ' is not a JPEG');
  let p = 2;
  while (p < b.length) {
    assert.strictEqual(b[p], 0xFF, f + ': broken marker at ' + p);
    const m = b[p + 1], len = b.readUInt16BE(p + 2);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { w: b.readUInt16BE(p + 7), h: b.readUInt16BE(p + 5), bytes: b.length };
    p += 2 + len;
  }
  throw new Error(f + ': no frame header');
}

test('the splash pictures are real JPEGs of the sizes the page expects, light enough for a first visit', () => {
  const bg = jpeg('assets/splash-bg.jpg'), icon = jpeg('assets/splash-icon.jpg');
  assert.deepStrictEqual([bg.w, bg.h], [640, 640]);
  assert.deepStrictEqual([icon.w, icon.h], [384, 384]);
  assert.ok(bg.bytes <= 40e3, 'the background is heavier than a loading screen should be: ' + bg.bytes);
  assert.ok(icon.bytes <= 80e3, 'the icon is heavier than a loading screen should be: ' + icon.bytes);
});

test('the loading screen is the first thing in the page, is announced as a status, and its pictures are preloaded', () => {
  const html = H.html();
  const body = html.slice(html.indexOf('<body>') + 6);
  assert.ok(/^\s*<div id="bootSplash" role="status" aria-label="Loading">/.test(body), 'the loading screen is not the first element of the body');
  assert.ok(/<img class="bs-icon" src="assets\/splash-icon\.jpg" width="384" height="384" alt="">/.test(body), 'the icon on the loading screen changed or lost its size');
  assert.ok(/<div class="bs-bg"><\/div>/.test(body.slice(0, 400)), 'the background art is not on the loading screen');
  assert.ok(/<link rel="preload" as="image" href="assets\/splash-bg\.jpg">/.test(html) && /<link rel="preload" as="image" href="assets\/splash-icon\.jpg">/.test(html), 'the pictures are not preloaded, so the screen would paint empty first');
  assert.ok(/url\(assets\/splash-bg\.jpg\)/.test(html), 'the stylesheet does not use the background picture');
});

test('the colour the phone shows first (manifest) is the colour the page starts with, so nothing flashes between them', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(m.background_color.toUpperCase(), BASE_COLOUR, 'the start-up colour in the manifest is not the loading screen\'s');
  const rule = /#bootSplash\{[^}]*\}/.exec(H.html());
  assert.ok(rule, 'the loading screen has no style rule');
  assert.ok(new RegExp('background:' + BASE_COLOUR, 'i').test(rule[0]), 'the loading screen does not start on the manifest colour');
});

test('the loading screen can never be left covering the app: it sits above everything, fades out, and removes itself in CSS after 12 s', () => {
  const html = H.html();
  const rule = /#bootSplash\{[^}]*\}/.exec(html)[0];
  assert.ok(/position:fixed;inset:0/.test(rule), 'it does not cover the screen');
  const z = +/z-index:(\d+)/.exec(rule)[1];
  assert.ok(z >= 10000, 'a map control or dialog could sit above the loading screen (z-index ' + z + ')');
  assert.ok(/animation:bsGone [\d.]+s linear 12s forwards/.test(rule), 'the CSS-only fallback that removes the screen after 12 s is gone');
  assert.ok(/@keyframes bsGone\{to\{[^}]*visibility:hidden[^}]*pointer-events:none[^}]*\}\}/.test(html), 'the fallback animation does not hide the screen and let touches through');
  assert.ok(/#bootSplash\.done\{opacity:0;pointer-events:none;\}/.test(html), 'the finished state does not fade out and let touches through');
  assert.ok(/prefers-reduced-motion:reduce\)\{#bootSplash\{transition:none;\}/.test(html), 'people who ask for less motion still get a fade');
});

/* ---- the script that sends it away, run against a fake page and a fake clock ---- */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', '20-splash.js'), 'utf8');

function world({ map, readyState = 'complete', start = 1000 } = {}) {
  let now = start, seq = 0; const timers = [];
  const classes = new Set(); let removed = false; const winHandlers = {};
  const el = { classList: { add: c => classes.add(c) }, parentNode: { removeChild: () => { removed = true; } } };
  const document = { getElementById: id => (id === 'bootSplash' ? el : null), readyState };
  const window = { performance: { timing: { navigationStart: start } }, addEventListener: (t, f) => { winHandlers[t] = f; } };
  const setTimeout_ = (fn, ms) => { timers.push({ at: now + ms, fn, id: ++seq }); return seq; };
  const DateFake = { now: () => now };
  new Function('document', 'window', 'setTimeout', 'Date', 'curBase', SRC)(document, window, setTimeout_, DateFake, map);
  return {
    advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0]; if (!t || t.at > end) break;
        timers.shift(); now = Math.max(now, t.at); t.fn();
      }
      now = end;
    },
    fireLoad() { winHandlers.load && winHandlers.load(); },
    get done() { return classes.has('done'); }, get removed() { return removed; }, get now() { return now - start; }
  };
}
const fakeMap = () => { const m = { cb: null, once(t, f) { assert.strictEqual(t, 'load'); m.cb = f; return m; }, ready() { m.cb && m.cb(); } }; return m; };

test('it waits for the map, then leaves — but never before 0.7 s, so it does not flash', () => {
  const map = fakeMap(), w = world({ map });
  w.advance(100); assert.ok(!w.done, 'it left before the map was ready');
  map.ready(); w.advance(1); assert.ok(!w.done, 'it left before the 0.7 s minimum');
  w.advance(700); assert.ok(w.done, 'it did not leave after the minimum');
  assert.ok(!w.removed, 'it was removed before its fade finished');
  w.advance(900); assert.ok(w.removed, 'it never left the page');
});

test('a map that is ready late is not made to wait on top of the minimum', () => {
  const map = fakeMap(), w = world({ map });
  w.advance(3000); map.ready(); w.advance(0); w.advance(1); assert.ok(w.done, 'it waited longer than it needed to');
});

test('it leaves at the 6 s ceiling even if the map never says it is ready (a hidden tab, a tile service that does not answer)', () => {
  const map = fakeMap(), w = world({ map });
  w.advance(5900); assert.ok(!w.done);
  w.advance(200); assert.ok(w.done, 'the ceiling did not fire');
  w.advance(900); assert.ok(w.removed);
});

test('the map being ready twice, or the ceiling firing after it, does not run it twice', () => {
  const map = fakeMap(), w = world({ map });
  map.ready(); map.ready(); w.advance(7000);
  assert.ok(w.done && w.removed);
});

test('with no map object at all it still leaves, and if the page was still loading it waits for the load event first', () => {
  const w = world({ map: undefined }); w.advance(800); assert.ok(w.done, 'with no map it should leave');
  const map = fakeMap(), v = world({ map, readyState: 'loading' });
  v.advance(7000); assert.ok(!v.done, 'it started its clock before the page had loaded');
  v.fireLoad(); map.ready(); v.advance(1); assert.ok(v.done, 'it did not run after the load event');
});

test('the script that does this is in the page the user receives', () => {
  const s = H.appScript();
  assert.ok(s.includes("getElementById('bootSplash')") && s.includes('setTimeout(dismiss, 6000)') && s.includes('Math.max(0, 700 -'), 'the dismissal code is not in the built page');
});
