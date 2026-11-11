/* The back button is "undo" (V4.2): the newest thing opened is the first thing closed, and the map is what is left.
 *
 * The module watches classes on elements and keeps the browser's history exactly as deep as the number of things open, so the tests
 * run the real file (src/21-history.js) against a stand-in for the page and a stand-in for the browser's history that behaves like
 * the real one: going back is asynchronous, pushing drops anything ahead, and a press of back arrives as an event carrying the state
 * of the entry it landed on.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

/* the module is taken out of the BUILT page, so that what is tested is what is shipped (and what the mutation check alters) */
const SRC = (() => {
  const s = H.appScript(), i = s.indexOf('var NAV = {'); assert.ok(i > 0, 'the history module is not in the page');
  // 21-history.js used to be the last file; the module ends where the next one (22-privacy.js) begins
  const j = s.search(/\/\* =+\s+PRIVACY CHOICE/);
  return s.slice(i, j > i ? j : undefined);
})();
const tick = (ms = 6) => new Promise(r => setTimeout(r, ms));

function world({ mobile = true, preset = null, welcome = false } = {}) {
  const els = {}, observers = [], popHandlers = [];
  const note = () => queueMicrotask(() => observers.forEach(f => f()));
  function mk(id) {
    const e = { id, cls: new Set(), onclick: null, classList: null, click() { if (e.onclick) e.onclick(); } };
    e.classList = { add: c => { if (!e.cls.has(c)) { e.cls.add(c); note(); } }, remove: c => { if (e.cls.delete(c)) note(); }, contains: c => e.cls.has(c) };
    return els[id] = e;
  }
  ['stn', 'linp', 'nearPanel', 'passPanel', 'settingsPanel', 'omni', 'wcOverlay', 'stnX', 'linpX', 'wcGo'].forEach(mk);
  const sheets = mobile ? ['planner', 'layers', 'alerts'].map(n => mk('sheet_' + n)) : [];
  const body = mk('body');
  const close = (id, cls) => () => els[id].classList.remove(cls);
  els.stnX.onclick = close('stn', 'show'); els.linpX.onclick = close('linp', 'show'); els.wcGo.onclick = close('wcOverlay', 'show');
  if (welcome) els.wcOverlay.classList.add('show');

  // a browser history that behaves like the real one
  const entries = preset ? preset.entries.map(s => ({ state: s })) : [{ state: null }];
  let idx = preset ? preset.idx : 0, steps = 0;
  const history = {
    pushState(s) { entries.length = idx + 1; entries.push({ state: s }); idx++; },
    replaceState(s) { entries[idx].state = s; },
    go(n) { steps++; setTimeout(() => { idx = Math.max(0, Math.min(entries.length - 1, idx + n)); popHandlers.forEach(h => h({ state: entries[idx].state })); }, 0); },
    back() { history.go(-1); }, forward() { history.go(1); },
  };
  const document = {
    getElementById: id => els[id] || null,
    querySelector: sel => sel === '.msheet.open' ? (sheets.find(s => s.cls.has('open')) || null) : null,
    querySelectorAll: sel => sel === '.msheet' ? sheets : [],
    body: { classList: els.body.classList, click() {} },
  };
  const state = { tab: 'active' };
  const api = { };
  const openSheet = name => sheets.forEach(s => s.id === 'sheet_' + name ? s.classList.add('open') : s.classList.remove('open'));
  const win = { addEventListener: (t, f) => { if (t === 'popstate') popHandlers.push(f); }, history };
  const MO = function (cb) { observers.push(cb); }; MO.prototype.observe = () => {};
  const mod = new Function('window', 'document', 'history', 'IS_MOBILE', 'openSheet', 'closeNearby', 'closePassport', 'closeSettings', 'aiShut', 'setTab', 'MutationObserver', 'setTimeout', 'clearTimeout',
    SRC + '\nreturn { NAV, navScope };')(
    win, document, history, mobile, openSheet,
    close('nearPanel', 'open'), close('passPanel', 'open'), close('settingsPanel', 'open'), () => body.classList.remove('ai-open'),
    t => { const prev = state.tab; state.tab = t; api.mod.navScope(prev, t); }, MO, setTimeout, clearTimeout);
  api.mod = mod;
  return {
    mod, els, sheets, state, history, openSheet,
    setTab: t => { const prev = state.tab; state.tab = t; mod.navScope(prev, t); },
    open: () => Object.keys(els).filter(k => els[k].cls.size && !/^(body)$/.test(k)).map(k => k + ':' + [...els[k].cls].join('+')),
    info: () => ({ depth: mod.NAV.depth, stack: mod.NAV.stack.map(e => e.id + (e.from ? '<' + e.from : '') + (e.returnTo ? '>' + e.returnTo : '')), idx, len: entries.length, tab: state.tab }),
    back: async () => { history.back(); await tick(); await tick(); },
    settle: async () => { await tick(); await tick(); },
    steps: () => steps,
    firePop: s => popHandlers.forEach(h => h({ state: s })),
  };
}

test('opening something puts one entry in the history, and closing it with its own button takes the entry away again', async () => {
  const w = world(); await w.settle();
  assert.deepStrictEqual(w.info().stack, []); assert.strictEqual(w.info().idx, 0);
  w.els.stn.classList.add('show'); await w.settle();
  assert.deepStrictEqual([w.info().depth, w.info().idx, w.info().stack], [1, 1, ['stn']]);
  w.els.stnX.click(); await w.settle();
  assert.deepStrictEqual([w.info().depth, w.info().idx, w.info().stack], [0, 0, []], 'the entry of a panel closed with its X was left in the history');
});

test('back closes the newest layer only: a station panel over Settings goes first, Settings second', async () => {
  const w = world(); await w.settle();
  w.els.settingsPanel.classList.add('open'); await w.settle();
  w.els.stn.classList.add('show'); await w.settle();
  assert.deepStrictEqual(w.info().stack, ['settings', 'stn']);
  await w.back(); assert.ok(!w.els.stn.cls.has('show') && w.els.settingsPanel.cls.has('open'), 'back did not close the newest layer first');
  await w.back(); assert.ok(!w.els.settingsPanel.cls.has('open'), 'back did not close Settings');
  assert.deepStrictEqual([w.info().depth, w.info().idx], [0, 0]);
});

test('the user\'s own example: from a line\'s panel opened out of the Layers sheet, back is the Layers sheet and back again is the map', async () => {
  const w = world(); await w.settle();
  w.openSheet('layers'); await w.settle();
  assert.deepStrictEqual(w.info().stack, ['sheet']);
  // tapping a line in the sheet closes the sheet and opens that line's panel in the same moment
  w.openSheet(null); w.els.linp.classList.add('show'); await w.settle();
  assert.deepStrictEqual(w.info().stack, ['linp>layers'], 'the panel did not remember which sheet it came from');
  assert.strictEqual(w.info().len, 2, 'swapping a sheet for a panel added to the history');
  await w.back();
  assert.ok(!w.els.linp.cls.has('show'), 'back did not close the panel');
  assert.ok(w.sheets[1].cls.has('open'), 'back did not return to the Layers sheet');
  assert.deepStrictEqual(w.info().stack, ['sheet'], 'the returned sheet is not the next thing back closes');
  await w.back();
  assert.ok(!w.sheets[1].cls.has('open') && !w.els.linp.cls.has('show'), 'the second back did not reach the map');
  assert.deepStrictEqual([w.info().depth, w.info().idx, w.info().stack], [0, 0, []]);
});

test('switching scope inside the Layers sheet is a step: back returns to the scope you came from, then closes the sheet', async () => {
  const w = world(); await w.settle();
  w.openSheet('layers'); await w.settle();
  w.setTab('vision'); await w.settle();
  assert.deepStrictEqual(w.info().stack, ['sheet', 'scope<active']);
  await w.back();
  assert.strictEqual(w.state.tab, 'active', 'back did not go back to the Active scope');
  assert.ok(w.sheets[1].cls.has('open'), 'back closed the sheet instead of the scope');
  await w.back();
  assert.ok(!w.sheets[1].cls.has('open')); assert.deepStrictEqual(w.info().stack, []);
});

/* V4.5: back always leads to the default map. A view other than the default one is ONE step however many views were visited on the way. */
test('going back to the default view by hand is the undo itself, and a walk through several views is one step back to the default map', async () => {
  const w = world(); await w.settle();
  w.openSheet('layers'); await w.settle();
  w.setTab('vision'); await w.settle(); w.setTab('active'); await w.settle();
  assert.deepStrictEqual(w.info().stack, ['sheet'], 'going back to Active by hand left a step behind');
  w.setTab('vision'); await w.settle(); w.setTab('bus'); await w.settle(); w.setTab('boat'); await w.settle();
  assert.deepStrictEqual(w.info().stack, ['sheet', 'scope<active'], 'each view visited became a step of its own: back would walk through them instead of going to the default map');
  await w.back(); assert.strictEqual(w.state.tab, 'active', 'back did not go straight to the default map');
  await w.back(); assert.ok(!w.sheets[1].cls.has('open'));
});

test('on a phone, back from any view other than the default map goes to the default map, however the view was reached and with no sheet open', async () => {
  const w = world(); await w.settle();
  w.setTab('vision'); await w.settle();                   // reached from the map itself: it used not to count, and back left the app
  assert.deepStrictEqual(w.info().stack, ['scope<active'], 'a view chosen with no sheet open is not a step: back would leave the app');
  await w.back(); assert.strictEqual(w.state.tab, 'active'); assert.deepStrictEqual([w.info().stack, w.info().depth], [[], 0]);
  // chosen in a sheet, then the sheet closed by a tap on the map: the view stays, and so does its way back
  w.openSheet('layers'); await w.settle(); w.setTab('weather'); await w.settle();
  w.openSheet(null); await w.settle();
  assert.strictEqual(w.state.tab, 'weather', 'closing the sheet undid the choice of view');
  assert.deepStrictEqual(w.info().stack, ['scope<active'], 'closing the sheet dropped the way back to the default map');
  await w.back(); assert.strictEqual(w.state.tab, 'active', 'back from Weather (sheet closed) did not go to the default map');
  assert.deepStrictEqual([w.info().stack, w.info().depth, w.info().idx], [[], 0, 0]);
});

test('on a computer the scope steps do not need a sheet: back steps through them', async () => {
  const w = world({ mobile: false }); await w.settle();
  w.setTab('weather'); await w.settle();
  assert.deepStrictEqual(w.info().stack, ['scope<active']);
  await w.back(); assert.strictEqual(w.state.tab, 'active'); assert.deepStrictEqual(w.info().stack, []);
});

test('moving between sheets with the bottom bar is not a step (one back from any tab is the map)', async () => {
  const w = world(); await w.settle();
  w.openSheet('planner'); await w.settle(); w.openSheet('layers'); await w.settle(); w.openSheet('alerts'); await w.settle();
  assert.deepStrictEqual([w.info().stack, w.info().len], [['sheet'], 2]);
  await w.back(); assert.ok(!w.sheets.some(s => s.cls.has('open')));
});

test('the welcome dialog that is open on the first visit is a layer too, and its own button closes it cleanly', async () => {
  const w = world({ welcome: true }); await w.settle();
  assert.deepStrictEqual([w.info().stack, w.info().idx], [['welcome'], 1]);
  w.els.wcGo.click(); await w.settle();
  assert.deepStrictEqual([w.info().stack, w.info().idx], [[], 0]);
});

test('a #link (a popstate that carries no state of ours) leaves everything open', async () => {
  const w = world(); await w.settle();
  w.els.settingsPanel.classList.add('open'); await w.settle();
  w.firePop(null); w.firePop({ somethingElse: 1 }); await w.settle();
  assert.ok(w.els.settingsPanel.cls.has('open'), 'a link to #something closed Settings');
  assert.deepStrictEqual(w.info().stack, ['settings']);
});

test('entries left by an earlier visit are stepped over, and a forward press is undone, instead of closing something', async () => {
  // the page was reloaded two entries deep: those entries still say d:1 and d:2 although this visit starts from nothing
  const w = world({ preset: { entries: [{ irnNav: true, d: 0 }, { irnNav: true, d: 1 }, { irnNav: true, d: 2 }], idx: 2 } }); await w.settle();
  assert.strictEqual(w.info().depth, 0);
  w.els.settingsPanel.classList.add('open'); await w.settle();
  assert.deepStrictEqual(w.info().stack, ['settings']);
  await w.back();
  assert.ok(!w.els.settingsPanel.cls.has('open'), 'back did not close Settings');
  assert.strictEqual(w.info().idx, 2);
  // forward (a computer) lands on an entry deeper than we are: it is stepped back over and nothing reopens
  w.history.forward(); await w.settle(); await w.settle();
  assert.ok(!w.els.settingsPanel.cls.has('open'), 'forward reopened something');
  assert.strictEqual(w.info().idx, 2, 'a forward press was left in effect');
  // and pressing back with nothing open walks over the stale entries instead of doing nothing, so the app can be left
  await w.back(); await w.settle();
  assert.strictEqual(w.info().idx, 0, 'the entries from the earlier visit swallowed the back presses');
});

test('the module is in the page, loaded after init (so the state it starts with is the page\'s own), and setTab tells it about scopes', () => {
  const s = H.appScript();
  assert.ok(/var NAV = \{/.test(s), 'NAV must be a var: init() calls setTab before this file runs and a const would still be unreadable');
  assert.ok(/if\(typeof navScope === 'function'\) navScope\(prevTab, t\);/.test(s), 'setTab does not report scope changes');
  assert.ok(s.indexOf('var NAV = {') > s.indexOf('\ninit();'), 'the history module runs before init(), so it would start with the welcome dialog and sheets not yet built');
  assert.ok(/window\.addEventListener\('popstate'/.test(s));
});
