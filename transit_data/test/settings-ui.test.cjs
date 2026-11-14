/* The settings page (V4.2): sections, a search box, and every setting still where the rest of the app expects it.
 *
 * Settings had grown into one long list with no order. Reorganising a page like that is mostly moving controls around, and the one
 * way to do real harm is to lose one: the rest of the app reaches each control by its id. So the first tests pin the ids, the later
 * ones run the real search code against a stand-in page.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

// every control the rest of the app reaches by id; each must be present exactly once, inside a section
const CONTROLS = ['themeSeg', 'styleSeg', 'textSeg', 'langSeg', 'swMotion', 'swContrast', 'prefSeg', 'paceSeg', 'swAvoidFerry', 'swAvoidBus', 'swStepFree',
  'unitSeg', 'clockSeg', 'cardRow', 'cardSel', 'cardArt', 'cardNote', 'cardCredit', 'offlineRow', 'offSave', 'offClear', 'offNote', 'placesGroup', 'homeVal', 'workVal',
  'openPassport', 'swOnline', 'resetTrips', 'installRow', 'instBtn', 'instNote', 'provRow', 'provList', 'aiKeyRow', 'aiKeyIn', 'aiKeySave', 'aiKeyClear', 'aiKeyNote',
  'diagRow', 'diagReport', 'diagCopy', 'diagClear', 'diagNote',
  'swTrains', 'swStations', 'swExplore', 'speedSeg'];   // V4.6: moved here from the Layers card
const panelHTML = () => { const h = H.html(), a = h.indexOf('<div class="settings-panel glass" id="settingsPanel"'), b = h.indexOf('<div class="near-panel glass"'); assert.ok(a > 0 && b > a); return h.slice(a, b); };

test('settings are eight sections, in this order, with Appearance open to begin with', () => {
  const p = panelHTML();
  const secs = [...p.matchAll(/<details class="sp-sec" data-sec="(\w+)"( open)?>/g)].map(m => m[1] + (m[2] ? '*' : ''));
  assert.deepStrictEqual(secs, ['appearance*', 'map', 'journey', 'accessibility', 'you', 'privacy', 'app', 'about']);   // V4.3 added About & legal; V4.6 put Map second
  assert.ok(/<input id="spSearch" type="search"/.test(p) && /id="spNone"/.test(p), 'the search box is gone');
});

test('no setting was lost in the move: every control the app looks for is there once, and inside a section', () => {
  const p = panelHTML();
  for (const id of CONTROLS) {
    assert.strictEqual((p.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, '#' + id + ' appears ' + (p.match(new RegExp('id="' + id + '"', 'g')) || []).length + ' times in Settings');
  }
  // anything that is not a section (the head and the search box) holds no control
  const outside = p.replace(/<details class="sp-sec"[\s\S]*?<\/details>/g, '');
  assert.ok(!/class="sw"|class="seg|<select|class="off-btn/.test(outside), 'a control is outside the sections');
  // the theme and language buttons keep the attributes the handlers read
  assert.ok(/data-theme="dark"/.test(p) && /data-lang="ar"/.test(p) && /data-pref="easy"/.test(p) && /data-uis="paper"/.test(p) && /data-place="work" data-act="clear"/.test(p));
});

test('every setting is a searchable item, and an item is one whole setting (its name and its explanation together)', () => {
  const p = panelHTML();
  const items = (p.match(/class="sp-item/g) || []).length;
  assert.ok(items >= 20, 'only ' + items + ' searchable items');
  // each switch sits in an item together with its own hint, not apart from it
  assert.ok(/<div class="sp-item">\s*<div class="sp-row"><span data-i18n="prefStepFree">[\s\S]*?id="swStepFree"[\s\S]*?data-i18n="stepFreeHint"/.test(p), 'the step-free switch is apart from its explanation');
  assert.ok(/<div class="sp-item">\s*<div class="sp-row"><span data-i18n="prefOnline">[\s\S]*?id="swOnline"[\s\S]*?data-i18n="onlineHint"/.test(p), 'the online lookup switch is apart from its explanation');
});

/* ---- the search, run on the real code against a stand-in page ---- */
const fold = s => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
function world(saved = {}) {
  const store = Object.assign({}, saved);
  const mkClass = () => { const cls = new Set(); return { cls, classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, f) => { (f === undefined ? !cls.has(c) : f) ? cls.add(c) : cls.delete(c); }, contains: c => cls.has(c) } }; };
  const item = text => Object.assign({ textContent: text, querySelectorAll: () => [] }, mkClass());
  const mkSec = (name, open, items) => { const l = {}; const d = Object.assign({ dataset: { sec: name }, open, items, querySelectorAll: () => items, addEventListener(t, f) { l[t] = f; }, fire(t) { l[t] && l[t](); } }, mkClass()); return d; };
  const secs = [
    mkSec('appearance', true, [item('Theme Dark Light Auto'), item('Language EN TR')]),
    mkSec('journey', false, [item('Show best route by Fastest Fewest changes'), item('Walking pace Slow Normal Fast'), item('Fare card Istanbulkart')]),
    mkSec('map', false, [item('Offline map Save this area')]),
  ];
  const panel = Object.assign({ querySelectorAll: () => secs }, mkClass());
  const inp = Object.assign({ value: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, type(v) { this.value = v; this.listeners.input(); } }, mkClass());
  const none = mkClass();
  const document = { getElementById: id => ({ settingsPanel: panel, spSearch: inp, spNone: none })[id] || null };
  const src = H.appScript().replace(/\r\n/g, '\n'), a = src.indexOf('var spResetFn = null;'), endMark = "spResetFn = function(){ if(inp.value){ inp.value = ''; find(); } };\n})();";
  const b = src.indexOf(endMark, a); assert.ok(a > 0 && b > a, 'the settings search code is not in the page');
  const api = new Function('document', 'foldQ', 'lsStr', 'localStorage', src.slice(a, b + endMark.length) + '\nreturn { spReset };')(
    document, fold, (k, d) => (k in store ? store[k] : d), { setItem: (k, v) => { store[k] = v; } });
  const vis = () => secs.filter(s => !s.cls.has('sp-hide')).map(s => s.dataset.sec + (s.open ? '*' : ''));
  const items = () => secs.flatMap(s => s.items).filter(i => !i.cls.has('sp-hide')).map(i => i.textContent.split(' ')[0]);
  return { secs, inp, none, panel, api, store, vis, items };
}

test('typing finds a setting by what it says, opens the section it is in, and hides everything else', () => {
  const w = world();
  w.inp.type('walk');
  assert.deepStrictEqual(w.vis(), ['journey*'], 'only the section with a match should be left, and open');
  assert.deepStrictEqual(w.items(), ['Walking']);
  w.inp.type('fewest changes');
  assert.deepStrictEqual(w.items(), ['Show'], 'a phrase from a setting\'s own value buttons did not find it');
  w.inp.type('istanbulkart');
  assert.deepStrictEqual(w.items(), ['Fare'], 'a word from inside a control did not find it');
  w.inp.type('İSTANBULKART');
  assert.deepStrictEqual(w.items(), ['Fare'], 'capital letters or the Turkish dotted İ broke the search');
});

test('several words must all be present, and nothing found says so', () => {
  const w = world();
  w.inp.type('walking fast'); assert.deepStrictEqual(w.items(), ['Walking']);
  w.inp.type('walking offline'); assert.deepStrictEqual(w.items(), []);
  assert.ok(w.none.cls.has('show'), 'no message when nothing matches');
  w.inp.type('map'); assert.ok(!w.none.cls.has('show'));
});

test('clearing the search puts every section back as it was (open ones open, closed ones closed)', () => {
  const w = world();
  w.inp.type('offline'); assert.deepStrictEqual(w.vis(), ['map*']);
  w.inp.type('');
  assert.deepStrictEqual(w.vis(), ['appearance*', 'journey', 'map'], 'the sections are not as they were before the search');
  assert.strictEqual(w.items().length, 6, 'items stayed hidden after the search was cleared');
  assert.ok(!w.none.cls.has('show') && !w.panel.cls.has('sp-searching'));
});

test('a section left open or closed stays that way, but a search opening sections is not remembered', () => {
  const w = world({ irn_sec_journey: '1', irn_sec_appearance: '0' });
  assert.strictEqual(w.vis().length, 3, 'a section is hidden without a search');
  assert.strictEqual(w.secs[1].open, true, 'the saved "open" was not restored'); assert.strictEqual(w.secs[0].open, false, 'the saved "closed" was not restored');
  w.secs[2].open = true; w.secs[2].fire('toggle');
  assert.strictEqual(w.store.irn_sec_map, '1', 'opening a section was not remembered');
  w.inp.type('walk'); w.secs[1].fire('toggle'); w.secs[0].open = true; w.secs[0].fire('toggle');
  assert.strictEqual(w.store.irn_sec_appearance, '0', 'a section the search opened was remembered as open');
});

test('opening Settings again starts with an empty search box, and the reset is called from there', () => {
  const w = world();
  w.inp.type('walk'); w.api.spReset();
  assert.strictEqual(w.inp.value, ''); assert.deepStrictEqual(w.vis(), ['appearance*', 'journey', 'map']);
  const s = H.appScript();
  assert.ok(/function openSettings\(\)\{\s*spReset\(\);/.test(s), 'openSettings does not reset the search');
});

test('the sheet is light on a phone: no full-screen blur behind it, and a scroll in it does not scroll the map', () => {
  const css = H.html();
  assert.ok(/body\.mobile \.settings-overlay\{backdrop-filter:none;/.test(css), 'a full-screen blur is behind the settings sheet on a phone');
  assert.ok(/\.settings-panel\{[^}]*overscroll-behavior:contain;/.test(css), 'scrolling past the end of Settings scrolls the page behind');
  assert.ok(/body\.mobile \.settings-panel\{[^}]*env\(safe-area-inset-bottom\)/.test(css), 'the last setting can sit under the phone\'s home bar');
});

test('a press on a setting lights its button at once and does the heavy part (the other base map, every panel in the new language) after the browser has painted', () => {
  const s = H.appScript();
  assert.ok(/applyTheme\(b\.dataset\.theme, true, true\)/.test(s), 'the theme buttons swap the base map before the press has been drawn');
  assert.ok(/if\(l\) setLang\(l, true\)/.test(s), 'the language buttons redraw every panel before the press has been drawn');
  assert.ok(/if\(syncBase\) later \? afterPaint\(syncBaseToTheme\) : syncBaseToTheme\(\);/.test(s), 'start-up no longer fixes the base map before the first paint');
  assert.ok(/later \? afterPaint\(relocalise\) : relocalise\(\);/.test(s));
  assert.ok(/applyTheme\(themePref, true\);/.test(s), 'start-up must call applyTheme without "later", or the wrong base map flashes first');
});

test('afterPaint runs its work once, after a frame, and still runs it if no frame is ever produced', () => {
  const src = H.appScript(), a = src.indexOf('function afterPaint(fn){'), b = src.indexOf('/* keep the map\'s base layer in step with the UI theme');
  assert.ok(a > 0 && b > a, 'afterPaint is not in the page');
  const run = (hidden, frames) => {
    const timers = [], rafs = []; let calls = 0;
    const f = new Function('document', 'setTimeout', 'requestAnimationFrame', src.slice(a, b) + '\nreturn afterPaint;')(
      { hidden }, (fn, ms) => { timers.push({ fn, ms }); }, fn => { rafs.push(fn); });
    f(() => calls++);
    if (frames) rafs.splice(0).forEach(r => r());
    timers.sort((x, y) => x.ms - y.ms).forEach(t => t.fn());
    return calls;
  };
  assert.strictEqual(run(false, true), 1, 'with frames it ran the work ' + run(false, true) + ' times');
  assert.strictEqual(run(false, false), 1, 'with no frames (a hidden tab) the work never ran');
  assert.strictEqual(run(true, false), 1, 'a hidden page never ran the work');
});

test('controls answer a press at once: no double-tap-zoom wait on buttons, switches and the section headers', () => {
  assert.ok(/button,summary,select,\.switch,\.seg\{touch-action:manipulation;\}/.test(H.html()), 'controls can wait for a second tap');
});
