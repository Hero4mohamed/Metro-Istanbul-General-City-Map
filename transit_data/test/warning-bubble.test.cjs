/* The bubble of a warning sign on a metro line (V4.2).
 *
 * It used to be a hover tooltip. On a phone there is no hover: it opened on the tap, then the map flew to the sign, the warnings were
 * redrawn at the new zoom, and the bubble was thrown away with the old marker before anyone could read it. Now the bubble belongs to
 * nobody but itself, stays where the sign is, and leaves when a press lands anywhere. These tests run the real code against a fake
 * map: what matters is who owns the bubble and what closes it.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

/* taken out of the BUILT page, so that what is tested is what is shipped (and what the mutation check alters) */
const SRC = H.appScript();

function world() {
  const added = [], removed = [], doc = {};
  const mkTip = opts => { const tip = { opts, latlng: null, content: null,
    setLatLng(ll) { tip.latlng = ll; return tip; }, setContent(c) { tip.content = c; return tip; }, addTo() { added.push(tip); return tip; } }; return tip; };
  const L = { tooltip: mkTip };
  const map = { removeLayer: l => { removed.push(l); } };
  const document = { addEventListener(type, fn, capture) { (doc[type] = doc[type] || []).push({ fn, capture }); } };
  const a = SRC.indexOf('let pinnedDisr = null;'), b = SRC.indexOf('/* a hover tooltip is only for a mouse');
  assert.ok(a > 0 && b > a, 'the warning-bubble block is not in 17-boot.js');
  const api = new Function('L', 'map', 'document', 'disrTip', 'svgEsc', 't',
    SRC.slice(a, b) + '\nreturn { pinDisr, unpinDisr, current: () => pinnedDisr };')(
    L, map, document, d => '<b>' + d.ref + '</b>', s => s, k => '[' + k + ']');
  const fire = (type, ev) => (doc[type] || []).forEach(h => h.fn(ev || {}));
  return { api, added, removed, doc, fire };
}

test('pressing a warning sign opens a bubble that is its own layer on the map, holding the notice and the way to close it', () => {
  const w = world();
  w.api.pinDisr({ ref: 'M7' }, [41, 29], 15);
  assert.strictEqual(w.added.length, 1);
  const tip = w.added[0];
  assert.strictEqual(tip.opts.permanent, true, 'a bubble that is not permanent closes itself when the mouse leaves');
  assert.ok(/\bdisr-pin\b/.test(tip.opts.className) && /\blt\b/.test(tip.opts.className));
  assert.deepStrictEqual(tip.opts.offset, [0, -15], 'the bubble does not sit above the sign');
  assert.deepStrictEqual(tip.latlng, [41, 29]);
  assert.ok(tip.content.includes('<b>M7</b>') && tip.content.includes('[disrPinHint]'), 'the bubble is missing the notice or the "press anywhere to close" line');
  assert.strictEqual(tip.opts.interactive, false, 'the bubble would catch the press meant for the map');
});

test('it stays through a drag and a fly (neither is a click) and goes on the next press, a click anywhere, or Escape', () => {
  const w = world();
  w.api.pinDisr({ ref: 'M7' }, [41, 29]);
  assert.ok(w.api.current(), 'no bubble');
  assert.ok(w.doc.mousemove === undefined && w.doc.touchmove === undefined && w.doc.pointermove === undefined, 'moving closes the bubble: panning or turning the map would take it away');
  assert.ok((w.doc.click || []).length === 1 && w.doc.click[0].capture === true, 'the press listener is missing or is not on the capture phase (a control that swallows clicks would keep the bubble open)');
  w.fire('click');
  assert.strictEqual(w.api.current(), null, 'a press did not close the bubble');
  assert.strictEqual(w.removed.length, 1);
  w.api.pinDisr({ ref: 'M7' }, [41, 29]);
  w.fire('keydown', { key: 'a' }); assert.ok(w.api.current(), 'a letter key closed the bubble');
  w.fire('keydown', { key: 'Escape' }); assert.strictEqual(w.api.current(), null, 'Escape did not close the bubble');
});

test('opening a second bubble replaces the first, and closing with nothing open does nothing', () => {
  const w = world();
  w.fire('click');                                 // nothing open: must not throw or remove anything
  assert.strictEqual(w.removed.length, 0);
  w.api.pinDisr({ ref: 'M7' }, [41, 29]); w.api.pinDisr({ ref: 'M2' }, [41.1, 29.1]);
  assert.strictEqual(w.removed.length, 1, 'the first bubble was left on the map');
  assert.strictEqual(w.added.length, 2);
  assert.strictEqual(w.api.current(), w.added[1]);
});

test('every way to open a warning pins the bubble, and a screen with no hover is not given a hover tooltip that vanishes', () => {
  const s = H.appScript();
  assert.ok(/mk\.on\('click', \(\)=>\{ mk\.closeTooltip\(\); pinDisr\(d, p, isz\/2 \+ 4\); openDisruption\(d\); \}\);/.test(s), 'the warning sign does not pin its bubble');
  assert.ok(/hit\.on\('click', e=>\{ hit\.closeTooltip\(\); pinDisr\(d, e\.latlng, 8\); openDisruption\(d\); \}\);/.test(s), 'the stripe along the affected stretch does not pin its bubble');
  assert.ok(/if\(CAN_HOVER\) mk\.bindTooltip\(/.test(s) && /if\(CAN_HOVER\) hit\.bindTooltip\(/.test(s) && /if\(CAN_HOVER\) det\.bindTooltip\(/.test(s), 'a touch screen is given a hover tooltip');
  assert.ok(/const CAN_HOVER = matchMedia\('\(hover:hover\)'\)\.matches;/.test(s));
  assert.ok(/det\.on\('click', e => \{ det\.closeTooltip\(\); pinDisr\(d, e\.latlng, 8\); \}\);/.test(s), 'a bus detour does not pin its bubble');
});

test('the bubble is cleared when the scope changes or the notices are refreshed, and its text exists in all four languages', () => {
  const s = H.appScript();
  assert.ok(/function setTab\(t\)\{[^}]*?unpinDisr\(\);/.test(s.replace(/\n/g, ' ')), 'changing scope leaves the bubble behind');
  assert.ok(/function applyDisruptionFeed\(\)\{[^}]*?unpinDisr\(\);/.test(s.replace(/\n/g, ' ')), 'a refreshed feed leaves a bubble about a notice that may be gone');
  const v = H.i18nValues();
  for (const lg of ['en', 'tr', 'ar', 'fr']) assert.ok(v[lg] && typeof v[lg].disrPinHint === 'string' && v[lg].disrPinHint.length > 5, lg + ' has no "press anywhere to close" text');
});

test('the bubble wraps like text and lets presses through to the map', () => {
  const html = H.html();
  assert.ok(/\.leaflet-tooltip\.lt\.disr-pin\{white-space:normal;width:max-content;max-width:min\(78vw,300px\);[^}]*pointer-events:none;\}/.test(html), 'the bubble runs off the screen as one long line, or catches presses');
});
