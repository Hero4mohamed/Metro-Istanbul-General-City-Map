'use strict';
/* V4.7.1: the six small V4.7 fixes that were put off at the V4.7 review. Each runs the REAL built app code in a vm sandbox
 * (or, for wiring, reads the built app). */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const APP = () => H.appScript().replace(/\r\n/g, '\n');
function region(name) {
  const s = APP(), a = s.indexOf('/* ==' + name + '-START== */'), b = s.indexOf('/* ==' + name + '-END== */');
  assert.ok(a > 0 && b > a, 'the ' + name + ' block is missing');
  return s.slice(a, b);
}
/* the source of one `function name(` of the built app (declaration or named expression), by brace matching */
function fnSrc(name) {
  const s = APP(), i = s.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'function ' + name + ' not found');
  let depth = 0, k = s.indexOf('{', s.indexOf(')', i));
  for (let j = k; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) return s.slice(i, j + 1); }
  throw new Error('unbalanced ' + name);
}
const REAL_ESC = (() => {
  const lines = APP().split('\n');
  const pick = p => { const l = lines.find(x => x.trim().startsWith(p)); assert.ok(l, p + ' not found in the app'); return l; };
  const c = {}; vm.createContext(c);
  vm.runInContext(pick('const svgEsc = ') + '\n' + pick('const attrEsc = ') + '\nthis.e = { svgEsc, attrEsc };', c);
  return c.e;
})();
function favPure(extra = {}) {
  const ctx = Object.assign({ localStorage: { getItem: () => null, setItem() {} }, t: k => k, svgEsc: REAL_ESC.svgEsc,
    attrEsc: REAL_ESC.attrEsc, Math, JSON, Date }, extra);
  vm.createContext(ctx);
  vm.runInContext(region('FAV-PURE') + '\nthis.api = {'
    + ' get favRemoveAskText(){ return typeof favRemoveAskText === "function" ? favRemoveAskText : null; },'
    + ' get favFocusIndex(){ return typeof favFocusIndex === "function" ? favFocusIndex : null; } };', ctx);
  return ctx.api;
}

/* ---- 1. a name with "$&" in it, in the "Remove …?" question ---- */
test('v4.7.1: the remove question shows the name exactly as typed, even with $& or $1 in it', () => {
  const api = favPure({ t: k => (k === 'favRemoveAsk' ? 'Remove {name}?' : k) });
  assert.ok(api.favRemoveAskText, 'no favRemoveAskText()');
  assert.strictEqual(api.favRemoveAskText('Cafe $& more'), 'Remove Cafe $& more?', '"$&" is replaced by "{name}" (String.replace pattern)');
  assert.strictEqual(api.favRemoveAskText("Ali's $1 $$ $`"), "Remove Ali's $1 $$ $`?");
  const click = APP().slice(APP().indexOf("else if(act === 'remove'){"), APP().indexOf("else if(act === 'remove-yes')"));
  assert.match(click, /favRemoveAskText\(f\.name\)/, 'the row still builds the question with .replace(\'{name}\', f.name)');
});

/* ---- 2. an open ⋯ menu must not take Escape from the search box ---- */
function menuWorld(opts = {}) {
  const calls = { stop: 0, render: 0 };
  const more = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, focus() { doc.activeElement = more; } };
  const item = { focus() { doc.activeElement = item; } }, search = { focus() { doc.activeElement = search; } };
  const menu = { hidden: false, querySelector: s => (s === '.fav-ask' && opts.asking ? {} : null) };
  const row = { contains: x => [row, menu, more, item].includes(x), querySelector: s => (/data-fav-act="menu"/.test(s) ? more : null) };
  menu.parentNode = row;
  const doc = { activeElement: opts.inMenu ? item : search,
    querySelector: s => (/fav-menu:not\(\[hidden\]\)/.test(s) && !menu.hidden ? menu : null),
    querySelectorAll: () => [menu] };
  const ctx = { document: doc, renderFavs: () => { calls.render++; } };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('favCloseMenus') + '\n' + fnSrc('favMenuEscape') + '\n'
    + 'this.api = { favCloseMenus, favMenuEscape, get favMenuFocusOut(){ return typeof favMenuFocusOut === "function" ? favMenuFocusOut : null; } };'
    + (APP().includes('function favMenuFocusOut(') ? '\n' + fnSrc('favMenuFocusOut') : ''), ctx);
  const esc = { key: 'Escape', stopPropagation() { calls.stop++; } };
  return { api: ctx.api, menu, more, item, search, doc, calls, esc };
}
test('v4.7.1: Escape typed in the search box is the search box\'s, even with a ⋯ menu left open', () => {
  const w = menuWorld({ inMenu: false });
  w.api.favMenuEscape(w.esc);
  assert.strictEqual(w.calls.stop, 0, 'the open ⋯ menu swallowed an Escape meant for the search box');
  assert.ok(w.menu.hidden, 'the stray menu is not closed');
  assert.strictEqual(w.doc.activeElement, w.search, 'focus was pulled away from the search box');
});
test('v4.7.1: Escape inside the ⋯ menu still closes just the menu and goes back to its button', () => {
  const w = menuWorld({ inMenu: true });
  w.api.favMenuEscape(w.esc);
  assert.strictEqual(w.calls.stop, 1, 'Escape in the menu also closed the sheet behind it');
  assert.ok(w.menu.hidden);
  assert.strictEqual(w.doc.activeElement, w.more);
});
test('v4.7.1: moving the keyboard out of a ⋯ menu closes it', () => {
  const w = menuWorld({ inMenu: true });
  assert.ok(w.api.favMenuFocusOut, 'no favMenuFocusOut()');
  w.api.favMenuFocusOut({ target: w.item });
  assert.ok(!w.menu.hidden, 'the menu closed while the keyboard was still in it');
  w.api.favMenuFocusOut({ target: w.search });
  assert.ok(w.menu.hidden, 'the menu stays open after the keyboard left it');
  assert.match(APP(), /document\.addEventListener\('focusin', function favMenuFocusOut\(/, 'favMenuFocusOut is not listening');
});
test('v4.7.1: a "Remove …?" question closed by a click elsewhere is not shown again by the next ⋯', () => {
  const w = menuWorld({ inMenu: false, asking: true });
  w.api.favCloseMenus();
  assert.strictEqual(w.calls.render, 1, 'the row keeps the question, and its next ⋯ shows "Remove …?" instead of the menu');
  const n = menuWorld({ inMenu: false });
  n.api.favCloseMenus();
  assert.strictEqual(n.calls.render, 0, 'closing a plain menu redraws the whole list');
});

/* ---- 3. focus after the list is drawn again ---- */
test('v4.7.1: after the list is redrawn the keyboard stays on the same favourite, or the next one when it was removed', () => {
  const api = favPure();
  assert.ok(api.favFocusIndex, 'no favFocusIndex()');
  assert.strictEqual(api.favFocusIndex(['home', 'a', 'b'], 'a', 1), 1, 'renamed: not the same row');
  assert.strictEqual(api.favFocusIndex(['home', 'b'], 'a', 1), 1, 'removed: not the row that took its place');
  assert.strictEqual(api.favFocusIndex(['home', 'a'], 'b', 2), 1, 'the last one removed: not the one above it');
  assert.strictEqual(api.favFocusIndex([], 'a', 0), -1, 'the list is empty: there is nothing to focus');
  assert.strictEqual(api.favFocusIndex(['a'], null, -1), 0, 'focus was in the list but not on a row: the first row');
  const r = fnSrc('renderFavs');
  assert.match(r, /document\.activeElement/, 'renderFavs does not look where the keyboard was');
  assert.match(r, /favFocusIndex\(/, 'renderFavs does not put the keyboard back');
  assert.match(r, /\.focus\(/);
});

/* ---- 4. the name dialog and the phone's Back ---- */
test('v4.7.1: Back closes the name dialog (as Cancel), not the sheet behind it', () => {
  const s = APP();
  assert.match(s, /\{ id:'favname', +open:\(\) => !!document\.getElementById\('favNameDlg'\), +close:\(\) => favNameCancel\(\) \}/, 'Back does not know the name dialog');
  const a = fnSrc('favAskName');
  assert.ok((a.match(/navReconcile\(\)/g) || []).length >= 2, 'opening and closing the dialog is not told to Back');
  let clicked = 0;
  const ctx = { document: { querySelector: q => (/#favNameDlg \[data-fav-dlg="cancel"\]/.test(q) ? { click() { clicked++; } } : null) } };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('favNameCancel') + '\nfavNameCancel();', ctx);
  assert.strictEqual(clicked, 1, 'Back does not press Cancel');
});

/* ---- 5. an emoji or accented first letter on the profile button ---- */
function profileWorld(name) {
  const el = { textContent: '', innerHTML: '', attrs: {}, classList: { s: new Set(), toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    setAttribute(k, v) { this.attrs[k] = v; } };
  const ctx = { acct: { uid: 'u', name, verified: true }, IS_MOBILE: false, mSheets: {}, t: k => k, lang: 'en',
    document: { getElementById: id => (id === 'profileBtn' ? el : null) }, onAccountChange() {} };
  vm.createContext(ctx);
  vm.runInContext(region('PROFILE-CORE') + '\nthis.api = { renderProfileBtn };', ctx);
  return { ctx, el };
}
test('v4.7.1: a name starting with an emoji shows the whole emoji on the profile button, not half of it', () => {
  for (const [name, want] of [['😀 Ali', '😀'], ['👩‍💻 Deniz', '👩‍💻'], ['👍🏽Can', '👍🏽'], ['émile', 'É'], ['ayşe', 'A']]) {
    const w = profileWorld(name);
    w.ctx.api.renderProfileBtn();
    assert.strictEqual(w.el.textContent, want, name + ' shows ' + JSON.stringify(w.el.textContent));
  }
  const tr = profileWorld('ilkay'); tr.ctx.lang = 'tr'; tr.ctx.api.renderProfileBtn();
  assert.strictEqual(tr.el.textContent, 'İ', 'Turkish i is not İ');
});
test('v4.7.1: with no Intl.Segmenter (older phones) an emoji is still whole', () => {
  const w = profileWorld('😀 Ali');
  vm.runInContext('Intl.Segmenter = undefined;', w.ctx);
  w.ctx.api.renderProfileBtn();
  assert.strictEqual(w.el.textContent, '😀');
});

/* ---- 6. opening a favourite on a phone ---- */
function favOpenWorld(mobile) {
  const calls = [];
  const ctx = { IS_MOBILE: mobile, CITY_ID: 'istanbul', cityKnown: () => true, switchCity: () => calls.push('city'),
    mSheets: { friends: { classList: { contains: c => c === 'open' } } },
    openSheet: n => calls.push('sheet:' + n), setDragDetent: () => calls.push('low'), dropPin: (p, z) => calls.push('pin:' + p.name + ':' + z) };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('favOpen') + '\nthis.favOpen = favOpen;', ctx);
  return { favOpen: ctx.favOpen, calls };
}
test('v4.7.1: on a phone a favourite opens on the map in full view, not hidden under the Friends sheet', () => {
  const w = favOpenWorld(true);
  w.favOpen({ id: 'f1', name: 'Moda', lat: 40.98, lng: 29.02, city: 'istanbul' });
  assert.deepStrictEqual(w.calls, ['sheet:null', 'pin:Moda:16'], 'the pin lands at the edge of (or under) the Friends sheet');
  const pc = favOpenWorld(false);
  pc.favOpen({ id: 'f1', name: 'Moda', lat: 40.98, lng: 29.02, city: 'istanbul' });
  assert.deepStrictEqual(pc.calls, ['pin:Moda:16'], 'on a computer opening a favourite closes something');
});
