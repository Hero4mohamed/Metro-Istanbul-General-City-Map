/* Accessibility (V4.3): names, switch state, keyboard, dialogs. (Contrast is contrast.test.cjs.)
 *
 * Browser behaviour is checked by running the app's own functions, taken out of the BUILT page, against stand-ins for the page.
 * A real-browser pass backed this when it was written: 0 interactive elements without a name in English and Turkish, 39 of 39 legend
 * chips reachable and operable by keyboard, Tab kept inside Settings, Escape closing it and returning focus.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const html = () => H.html().replace(/\r\n/g, '\n');
const script = () => H.appScript().replace(/\r\n/g, '\n');
/* the page's own markup, without the script: text inside the script is templates the app fills in (with already-translated names) */
const markup = () => html().replace(/<script\b[\s\S]*?<\/script>/g, '');
function fnSource(s, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(s); assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = s.indexOf('{', m.index + m[0].length), d = 0;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return s.slice(m.index, i + 1); }
  throw new Error('unbalanced ' + name);
}
const LANGS = ['en', 'tr', 'ar', 'fr'];

test('every hard-coded accessible name in the markup follows the language: translated key, translated tooltip, or the label printed beside it', () => {
  const bad = [];
  for (const m of markup().matchAll(/<(\w+)\b[^>]*\baria-label="[^"]*"[^>]*>/g)) {
    const tag = m[0];
    const ok = /data-i18n-aria="/.test(tag) || /data-i18n-title="/.test(tag) || /role="switch"/.test(tag);
    // proper nouns and generated content that are the same in every language
    const exempt = /class="(?:leaflet|maplibre)/.test(tag) || /aria-hidden="true"/.test(tag);
    if (!ok && !exempt) bad.push(tag.slice(0, 110));
  }
  assert.deepStrictEqual(bad, [], 'a name that stays English whatever the language: ' + bad.join(' | '));
});

test('every translated name has its key in all four languages', () => {
  const dict = H.i18nValues(), missing = [];
  const keys = new Set([...markup().matchAll(/data-i18n-aria="([^"]+)"/g)].map(m => m[1]));
  for (const k of ['mapLabel', 'zoomIn', 'zoomOut', 'showHide', 'close']) keys.add(k);
  assert.ok(keys.size >= 12, 'found only ' + keys.size + ' translated names');
  for (const k of keys) for (const L of LANGS) if (!dict[L][k] || !String(dict[L][k]).trim()) missing.push(L + '.' + k);
  assert.deepStrictEqual(missing, [], 'missing translations: ' + missing.join(', '));
});

test('applyI18n renames the accessible names when the language changes, and calls the derived-name pass', () => {
  const f = fnSource(script(), 'applyI18n');
  assert.match(f, /\[data-i18n-aria\][\s\S]*setAttribute\('aria-label', t\(/, 'applyI18n does not translate data-i18n-aria');
  assert.match(f, /syncAria\(\)/, 'applyI18n does not refresh the derived names (switches, zoom buttons, the map)');
});

test('syncAria names switches by the label beside them, retitles the zoom buttons and labels the map, in the current language', () => {
  const s = script();
  const mk = (cls, attrs = {}) => { const e = { cls: new Set(cls), attrs: { ...attrs }, id: attrs.id || '', title: attrs.title || '', getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = v; }, removeAttribute(k) { delete this.attrs[k]; }, classList: null }; e.classList = { contains: c => e.cls.has(c) }; return e; };
  const label = mk([], { id: '' }), sw = mk(['sw'], { id: 'swMotion', role: 'switch', 'aria-label': 'Reduce motion' }), row = { querySelector: () => label };
  sw.closest = () => row; label.id = '';
  const zoomIn = mk([]), zoomOut = mk([]), map = mk([]), tipped = mk([], { 'aria-label': 'My location' }); tipped.title = 'Konumum';
  const all = { 'button.sw[role="switch"], .switch > input[type="checkbox"]': [sw], '.leaflet-control-zoom-in': [zoomIn], '.leaflet-control-zoom-out': [zoomOut], '[data-i18n-title][aria-label]': [tipped] };
  const doc = { querySelectorAll: sel => all[sel] || [], getElementById: id => (id === 'map' ? map : null) };
  const T = { zoomIn: 'Yakınlaştır', zoomOut: 'Uzaklaştır', mapLabel: 'Ulaşım haritası' };
  const ctx = vm.createContext({ document: doc, t: k => T[k] || k, Math, syncSwitches: () => {}, kbEnhance: () => {} });
  vm.runInContext(fnSource(s, 'syncAria') + '\nsyncAria()', ctx);
  assert.strictEqual(sw.attrs['aria-labelledby'], label.id, 'the switch is not named by the label beside it');
  assert.ok(label.id && !('aria-label' in sw.attrs), 'the switch kept its fixed English label');
  assert.strictEqual(zoomIn.attrs['aria-label'], 'Yakınlaştır'); assert.strictEqual(zoomOut.attrs['aria-label'], 'Uzaklaştır');
  assert.strictEqual(map.attrs['aria-label'], 'Ulaşım haritası'); assert.strictEqual(map.attrs.role, 'region');
  assert.strictEqual(tipped.attrs['aria-label'], 'Konumum', 'a button with a translated tooltip kept its old name');
});

test('every on/off switch announces its state (aria-checked follows the .on class)', () => {
  const s = script();
  const mk = on => { const e = { on, attrs: {}, classList: { contains: c => c === 'on' && e.on }, setAttribute(k, v) { e.attrs[k] = v; } }; return e; };
  const a = mk(true), b = mk(false);
  const ctx = vm.createContext({ document: { querySelectorAll: sel => (sel === '[role="switch"]' ? [a, b] : []) } });
  vm.runInContext(fnSource(s, 'syncSwitches') + '\nsyncSwitches()', ctx);
  assert.strictEqual(a.attrs['aria-checked'], 'true'); assert.strictEqual(b.attrs['aria-checked'], 'false');
  assert.ok(/role="switch"/.test(html()), 'no switches in the markup: has the pattern drifted?');
});

test('every image has alt text (empty only when it is decoration), and decorative icons are hidden from screen readers', () => {
  const imgs = [...markup().matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  assert.ok(imgs.length >= 2, 'found no images');
  for (const i of imgs) assert.ok(/\balt="/.test(i), 'an image without alt: ' + i.slice(0, 90));
  // the images the app builds in script: the tag may span lines, so read to the closing >
  for (const m of script().matchAll(/<img\s[^>]*>/g)) assert.ok(/\balt=/.test(m[0]), 'a script-built image without alt: ' + m[0].slice(0, 90));
  for (const i of imgs.filter(x => /alt=""/.test(x))) assert.ok(/aria-hidden="true"|decoding=|width=/.test(i), 'an empty-alt image that is not clearly decorative: ' + i.slice(0, 90));
});

test('dialogs are named dialogs, and a panel that is only hidden (not removed) cannot be reached with Tab', () => {
  const h = html();
  for (const id of ['settingsPanel', 'passPanel', 'goPanel', 'wcOverlay']) {
    const tag = new RegExp('<div[^>]*id="' + id + '"[^>]*>').exec(h);
    assert.ok(tag, id + ' is missing');
    if (id === 'wcOverlay') continue;                       // its card inside is the dialog
    assert.ok(/role="dialog"/.test(tag[0]) && /aria-label="[^"]+"/.test(tag[0]), id + ' is not a labelled dialog');
  }
  assert.match(/<div class="wc-card[^>]*>/.exec(h)[0], /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="wcTitle"|aria-modal="true"[^>]*role="dialog"/, 'the welcome dialog is not a labelled modal');
  const s = script();
  assert.match(s, /el\.inert = !isOpen/, 'closed panels are not made inert');
  for (const id of ['settingsPanel', 'passPanel', 'nearPanel', 'goPanel']) assert.ok(new RegExp("id: '" + id + "'").test(s), id + ' is not managed as a dialog');
});

test('the things you click that are not buttons become buttons: focusable, with a role, operable with Enter and Space', () => {
  const s = script();
  const KB = /var KB_CLICKABLE = '([^']+)'/.exec(s); assert.ok(KB, 'the list of clickable things is missing');
  const listed = KB[1].split(/\s*,\s*/);       // whole selectors: '.lchip' must not be satisfied by '.lchip > .sw'
  for (const c of ['.lchip', '.lchip > .sw', '.grp-h', '#annHead', '.ann-item']) assert.ok(listed.includes(c), c + ' is not made keyboard-operable');
  const mk = (matchesSwatch, parentOff) => { const e = { attrs: {}, hasAttribute(k) { return k in e.attrs; }, getAttribute(k) { return e.attrs[k]; }, setAttribute(k, v) { e.attrs[k] = String(v); }, matches: sel => (sel === '.lchip > .sw' ? matchesSwatch : false), closest: () => null, parentElement: { classList: { contains: c => c === 'off' && parentOff } } }; return e; };
  const chip = mk(false), swatch = mk(true, true);
  const ctx = vm.createContext({ document: { querySelectorAll: () => [chip, swatch] }, KB_CLICKABLE: KB[1], t: k => k });
  vm.runInContext(fnSource(s, 'kbEnhance') + '\nkbEnhance()', ctx);
  assert.deepStrictEqual([chip.attrs.tabindex, chip.attrs.role], ['0', 'button']);
  assert.deepStrictEqual([swatch.attrs.tabindex, swatch.attrs.role, swatch.attrs['aria-checked'], swatch.attrs['aria-label']], ['0', 'checkbox', 'false', 'showHide'], 'a legend swatch is not a labelled checkbox that reports whether its line is shown');
  assert.match(s, /e\.key !== 'Enter' && e\.key !== ' '/, 'Enter and Space do not activate them');
  assert.match(s, /el\.matches\(KB_CLICKABLE\)/, 'activation must act on the focused element itself, so a swatch is not also its chip');
});

test('Escape closes the newest thing and nothing else, and ends a live journey only when nothing else is open', () => {
  const s = script();
  assert.ok(!s.includes('closeSettings(); closeNearby(); exitGo(); closePassport();'), 'the old Escape handler that closed everything (and ended the journey) in one press is back');
  const start = s.indexOf("document.addEventListener('keydown', e => {\n  if(e.key !== 'Escape'");
  assert.ok(start > 0, 'the Escape handler is missing');
  const end = s.indexOf('\n});', start) + 4, handler = s.slice(start, end);
  const run = (state) => {
    const calls = []; let fn = null;
    const el = (open) => ({ classList: { contains: c => open === c } });
    const doc = { addEventListener: (t, f) => { fn = f; }, getElementById: id => el(state.open[id] || '') };
    const ctx = vm.createContext({ document: doc, NAV: { stack: (state.stack || []).map(id => ({ id })) }, goState: state.go ? {} : null,
      closeSettings: () => calls.push('settings'), closeNearby: () => calls.push('nearby'), closePassport: () => calls.push('passport'), navCloseEntry: e => calls.push('layer:' + e.id), exitGo: () => calls.push('journey') });
    vm.runInContext(handler, ctx);
    fn({ key: 'Escape', defaultPrevented: false, target: { id: state.target || '' }, preventDefault() {} });
    return calls;
  };
  assert.deepStrictEqual(run({ open: { settingsPanel: 'open' }, stack: ['linp', 'settings'], go: true }), ['settings'], 'Escape with Settings open closed more than Settings');
  assert.deepStrictEqual(run({ open: {}, stack: ['stn', 'linp'], go: true }), ['layer:linp'], 'Escape did not close just the newest panel (or ended the journey too)');
  assert.deepStrictEqual(run({ open: {}, stack: ['welcome'] }), ['layer:welcome'], 'Escape does not close the welcome dialog');
  assert.deepStrictEqual(run({ open: {}, stack: [], go: true }), ['journey'], 'Escape no longer ends a journey when nothing else is open');
  assert.deepStrictEqual(run({ open: {}, stack: ['linp'], target: 'omniIn' }), [], 'Escape inside the search box must be left to the search box');
  assert.deepStrictEqual(run({ open: { nearPanel: 'open' }, stack: ['near'] }), ['nearby']);
});

test('keyboard users can see where they are, can skip the chrome, and the motion preference is honoured', () => {
  const h = html(), css = H.appStyle();
  assert.match(css, /:focus-visible\{outline:2px solid var\(--accent\)/, 'no global focus ring');
  assert.ok(!/outline\s*:\s*(none|0)\s*[;}][^}]*}\s*(?=[^{]*\{)/.test('') && /button:focus-visible,a:focus-visible,input:focus-visible/.test(css), 'the focus ring rule for controls is gone');
  assert.match(markup(), /<a[^>]*class="skip-link"/, 'no skip link');
  // (V4.3: the page no longer pinch-zooms - the app is not a document, only the map zooms - see appfeel.test.cjs. Text is enlarged in
  // Settings > Text size or with the device's own magnifier, which the accessibility page says.)
  assert.match(h, /id="textSeg"/, 'with page zoom locked, the app must still let people enlarge text (Settings > Text size)');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important;transition:none!important;\}\}/, 'the system "reduce motion" setting is ignored');
  assert.match(h, /<html lang="/, 'the page has no language');
});
