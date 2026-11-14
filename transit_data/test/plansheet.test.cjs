'use strict';
/* The planner on a phone keeps the map in view (V4.4.1).
 *
 * It used to open as a sheet over 80% of the screen with the map dimmed behind it. Now the sheet has three heights: compact (From, To,
 * the button: the map above, usable), half (a found route, fitted into the map above) and full (everything, and while typing).
 * These tests run the REAL built functions against fake pages.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const script = () => H.appScript().replace(/\r\n/g, '\n');
const css = () => H.appStyle().replace(/\r\n/g, '\n');
function fnSource(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = src.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1); }
  throw new Error('unbalanced braces in ' + name);
}
const classList = (init) => { const s = new Set(init || []); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), contains: c => s.has(c), toggle: (c, on) => { if (on === undefined) on = !s.has(c); on ? s.add(c) : s.delete(c); return on; }, get list() { return [...s].sort(); } }; };

const H3 = { compact: 250, half: 470, full: 715 };
test('plan sheet: a drag settles on the nearest height, a flick goes one step, and only a pull below compact closes it', () => {
  const settle = vm.runInContext("const PLAN_DETENTS = ['compact', 'half', 'full'];\n" + fnSource(script(), 'planSettle') + '\nplanSettle', vm.createContext({ Math }));
  // slow drags: the nearest height wins
  assert.strictEqual(settle(300, 0.1, 'compact', H3), 'compact'); assert.strictEqual(settle(380, 0.1, 'compact', H3), 'half');
  assert.strictEqual(settle(600, -0.1, 'full', H3), 'full'); assert.strictEqual(settle(580, -0.1, 'full', H3), 'half');
  // a flick moves exactly one step in its direction, however short the drag
  assert.strictEqual(settle(270, 0.9, 'compact', H3), 'half'); assert.strictEqual(settle(480, 0.9, 'half', H3), 'full');
  assert.strictEqual(settle(700, -0.9, 'full', H3), 'half'); assert.strictEqual(settle(460, -0.9, 'half', H3), 'compact');
  assert.strictEqual(settle(715, 0.9, 'full', H3), 'full', 'a flick up at full height went somewhere');
  // closing: pulled well below compact, or flicked down from compact; never from a slow drag that stays near compact
  assert.strictEqual(settle(170, -0.1, 'compact', H3), null); assert.strictEqual(settle(240, -0.8, 'compact', H3), null);
  assert.strictEqual(settle(200, -0.1, 'compact', H3), 'compact', 'a small downward nudge closed the planner');
  assert.strictEqual(settle(400, -0.8, 'half', H3), 'compact', 'a flick down from half closed the planner instead of going to compact');
});

/* a fake page around openSheet / setPlanDetent / planHeights */
function world(opts) {
  const o = Object.assign({ route: false, adventure: false, vh: 812, compactContent: 248 }, opts);
  const sheet = { dataset: {}, classList: classList(['msheet', 'plan']), style: { height: '' }, scrollTop: 40, get className() { return this.classList.list.join(' '); }, set className(v) { this.classList = classList(v.split(' ').filter(Boolean)); },
    get offsetHeight() { return this.style.height === 'auto' ? o.compactContent : parseInt(this.style.height, 10) || 0; }, querySelector: () => grab };
  const grab = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const other = { dataset: { dragKind: 'sheet' }, classList: classList(['msheet']) };
  const backdrop = { classList: classList() }, body = { classList: classList(['mobile']) }, rootStyle = {};
  const rout = { classList: classList(o.route ? ['show'] : []) }, adv = { style: { display: o.adventure ? '' : 'none' } };
  const btn = () => ({ classList: classList(), setAttribute() {}, removeAttribute() {} });
  const nav = { map: btn(), layers: btn(), alerts: btn() };
  const ctx = vm.createContext({ Math, parseInt, window: { innerHeight: o.vh }, navigator: {},
    document: { getElementById: id => ({ mbackdrop: backdrop, rout, plannerAdv: adv })[id] || null, querySelector: () => null, body, documentElement: { style: { setProperty: (k, v) => { rootStyle[k] = v; } } } },
    mSheets: { planner: sheet, layers: other }, mNavBtns: nav, setDragDetent: (el, d) => { el.dataset.detent = d; }, closeAllPanels: () => { ctx.panelsClosed = (ctx.panelsClosed || 0) + 1; } });
  const s = script();
  vm.runInContext("const PLAN_DETENTS = ['compact', 'half', 'full'];\nlet planDetent = 'compact', planTyping = false;\n" +
    ['planRouteShown', 'planHeights', 'planFloor', 'setPlanDetent', 'openSheet'].map(n => fnSource(s, n)).join('\n'), ctx);
  return { ctx, sheet, other, backdrop, body, rootStyle, rout, grab, nav, run: code => vm.runInContext(code, ctx) };
}

test('plan sheet: opening the planner leaves the map in view and usable: compact height, nothing dimmed, and no other sheet dims it either', () => {
  const w = world();
  w.run("openSheet('planner')");
  assert.ok(w.sheet.classList.contains('open') && w.sheet.classList.contains('d-compact') && w.sheet.classList.contains('short'), 'the planner did not open at its compact height: ' + w.sheet.className);
  assert.strictEqual(w.sheet.style.height, '248px', 'compact is not the height its short content needs');
  assert.ok(parseInt(w.sheet.style.height, 10) <= 812 * 0.5, 'the compact planner covers more than half the screen');
  assert.strictEqual(w.backdrop.classList.contains('on'), false, 'the map is dimmed (and untouchable) behind the planner');
  assert.ok(w.body.classList.contains('plan-open')); assert.strictEqual(w.rootStyle['--plan-h'], '248px', 'the buttons that ride above the sheet do not know its height');
  assert.strictEqual(w.sheet.scrollTop, 0); assert.strictEqual(w.grab.attrs['aria-expanded'], 'false');
  assert.ok(w.nav.map.classList.contains('on'), 'with the planner open no bottom button is marked (the planner has no button there since V4.6.2)');
  w.run("openSheet('layers')");
  assert.ok(!w.backdrop.classList.contains('on'), 'the Layers sheet dims the map again (V4.6.2: the map stays in view behind every sheet)');
  assert.strictEqual(w.other.dataset.detent, 'low', 'the Layers sheet does not open at its low height');
  assert.ok(w.ctx.panelsClosed >= 1, 'a line or station panel stays open over the sheet');
  assert.ok(w.nav.layers.classList.contains('on') && !w.nav.map.classList.contains('on'));
  assert.ok(!w.body.classList.contains('plan-open') && !w.sheet.classList.contains('open'));
  w.run('openSheet(null)');
  assert.ok(!w.backdrop.classList.contains('on') && w.nav.map.classList.contains('on'));
});

test('plan sheet: a found route is shown at half height in the short form, the full height shows everything, and a tall phone never loses the map', () => {
  const w = world({ route: true });
  w.run("openSheet('planner')");
  assert.ok(w.sheet.classList.contains('d-half') && w.sheet.classList.contains('short'), 'a planner opened with a route does not show it at half height: ' + w.sheet.className);
  const half = parseInt(w.sheet.style.height, 10);
  assert.ok(half >= 812 * 0.5 && half <= 812 * 0.62, 'half height is ' + half + ' px of 812: the route or the map loses its room');
  w.run("setPlanDetent('full')");
  assert.ok(w.sheet.classList.contains('d-full') && !w.sheet.classList.contains('short') && !w.sheet.classList.contains('d-half'));
  assert.ok(parseInt(w.sheet.style.height, 10) < 812, 'the full planner hides the whole screen: no way to see there is a map');
  assert.strictEqual(w.grab.attrs['aria-expanded'], 'true');
  // half WITHOUT a route (dragged there to see the options) is not the short form
  const n = world(); n.run("openSheet('planner'); setPlanDetent('half')");
  assert.ok(n.sheet.classList.contains('d-half') && !n.sheet.classList.contains('short'), 'the options are hidden at half height with no route to show instead');
  // a long compact content (large text) is capped, so the map keeps half the screen
  const big = world({ compactContent: 700 }); big.run("openSheet('planner')");
  assert.ok(parseInt(big.sheet.style.height, 10) <= 406, 'a tall compact form took the map away');
});

test('plan sheet: the Adventure planner, which has no short form, never opens at compact', () => {
  const w = world({ adventure: true });
  w.run("openSheet('planner')");
  assert.ok(w.sheet.classList.contains('d-half') && !w.sheet.classList.contains('d-compact'), 'the Adventure planner opened as an empty compact sheet');
  w.run("setPlanDetent('compact')"); assert.ok(w.sheet.classList.contains('d-half'));
});

test('plan sheet: choosing the second end finds the route once: not on desktop, not with the sheet closed, not twice for the same pair, and a swap is one search', async () => {
  const s = script();
  const make = (mobile, open) => {
    const runs = []; const sheet = { classList: classList(open ? ['open'] : []) };
    const ctx = vm.createContext({ IS_MOBILE: mobile, mSheets: { planner: sheet }, originPt: null, destPt: null, runRoute: () => runs.push(ctx.originPt.name + '>' + ctx.destPt.name), setTimeout, clearTimeout });
    vm.runInContext("let planAutoT = null, planAutoKey = '';\n" + fnSource(s, 'planAutoRun'), ctx);
    return { ctx, runs, sheet };
  };
  const A = { name: 'A', lat: 41, lng: 29 }, B = { name: 'B', lat: 41.1, lng: 29.1 }, wait = () => new Promise(r => setTimeout(r, 260));
  let w = make(true, true); w.ctx.originPt = A; w.ctx.destPt = B; vm.runInContext('planAutoRun(); planAutoRun()', w.ctx); await wait();
  assert.deepStrictEqual(w.runs, ['A>B'], 'both ends chosen did not find the route exactly once');
  vm.runInContext('planAutoRun()', w.ctx); await wait();
  assert.deepStrictEqual(w.runs, ['A>B'], 'the same pair was searched again (finding a route can set an end itself: that would loop)');
  // a swap sets both ends in turn; in between they are the same place
  w.ctx.originPt = B; vm.runInContext('planAutoRun()', w.ctx); w.ctx.destPt = A; vm.runInContext('planAutoRun()', w.ctx); await wait();
  assert.deepStrictEqual(w.runs, ['A>B', 'B>A'], 'a swap searched from a place to itself, or twice');
  w.ctx.destPt = B; vm.runInContext('planAutoRun()', w.ctx); await wait();
  assert.deepStrictEqual(w.runs, ['A>B', 'B>A'], 'a route from a place to itself was searched');
  for (const [mobile, open] of [[false, true], [true, false]]) { w = make(mobile, open); w.ctx.originPt = A; w.ctx.destPt = B; vm.runInContext('planAutoRun()', w.ctx); await wait(); assert.deepStrictEqual(w.runs, [], mobile ? 'searched with the planner closed' : 'the desktop planner now searches by itself'); }
  assert.ok(/if\(pt && originPt && destPt && typeof planAutoRun==='function'\) planAutoRun\(\);/.test(fnSource(s, 'setPoint')), 'setting an end no longer asks for the route');
});

test('plan sheet: a route is fitted into the part of the map the top bar and the sheet leave in view', () => {
  const s = script();
  const pad = (mobile, open) => {
    const sheet = { classList: classList(['plan'].concat(open ? ['open'] : [])), style: { height: '248px' }, get className() { return this.classList.list.join(' '); }, set className(v) { this.classList = classList(v.split(' ').filter(Boolean)); }, get offsetHeight() { return this.style.height === 'auto' ? 248 : parseInt(this.style.height, 10); } };
    const ctx = vm.createContext({ Math, parseInt, IS_MOBILE: mobile, mSheets: { planner: sheet }, window: { innerHeight: 812 },
      document: { querySelector: q => q === '.topbar' ? { getBoundingClientRect: () => ({ bottom: 60 }) } : null, getElementById: id => id === 'rout' ? { classList: classList(['show']) } : null } });
    return vm.runInContext([fnSource(s, 'planRouteShown'), fnSource(s, 'planHeights'), fnSource(s, 'mapFitPad')].join('\n') + '\nmapFitPad()', ctx);
  };
  assert.strictEqual(pad(false, true), null, 'the desktop map is padded for a sheet it does not have');
  const p = pad(true, true);
  assert.ok(p.paddingTopLeft[1] >= 60 && p.paddingTopLeft[1] <= 90, 'the route may be fitted under the top bar');
  assert.ok(p.paddingBottomRight[1] >= 471 && p.paddingBottomRight[1] <= 500, 'the route may be fitted under the sheet (it shows a route at ' + Math.round(812 * 0.58) + ' px): ' + p.paddingBottomRight[1]);
  assert.ok(812 - p.paddingTopLeft[1] - p.paddingBottomRight[1] >= 220, 'no room is left for the route');
  assert.ok(pad(true, false).paddingBottomRight[1] < 140, 'with the planner closed the map is padded as if it were open');
  assert.ok(/const fitPad = typeof mapFitPad==='function' \? mapFitPad\(\) : null;\s*\n\s*if\(allPts\.length\) map\.fitBounds\(L\.latLngBounds\(allPts\)\.pad\(fitPad \? 0\.04 : 0\.25\), fitPad \|\| \{\}\);/.test(fnSource(s, 'showItinerary')), 'a found route is fitted without regard to the sheet');
});

test('plan sheet: the styles that make it work are there', () => {
  const c = css();
  assert.ok(/body\.mobile \.msheet\.plan\{max-height:none;height:var\(--plan-h,auto\);/.test(c), 'the planner sheet is back to one fixed tall height');
  assert.ok(/body\.mobile \.msheet\.plan:not\(\.d-full\)\{overflow-y:hidden;\}/.test(c), 'below full height the sheet scrolls instead of growing when dragged');
  assert.ok(/body\.mobile \.msheet\.plan\.dragging,body\.mobile \.msheet\.plan\.measuring\{transition:none;\}/.test(c), 'the sheet lags behind the finger (or flickers when measured)');
  const short = /\.msheet\.plan\.short #plannerHead,[^{]*\{display:none !important;\}/.exec(c);
  assert.ok(short, 'the short form hides nothing');
  for (const id of ['#plannerTabs', '#nearBtn', '.field>label', '#airportChips', '#modeChips', '.when-row', '#favSec', '#histSec', '#plannerAdv']) assert.ok(short[0].includes('.msheet.plan.short ' + id), 'the short form still shows ' + id);
  for (const keep of ['#selO', '#selD', '#route', '.rsum', '#swap']) assert.ok(!short[0].includes(keep), 'the short form hides ' + keep);
  assert.ok(/\.msheet\.plan\.d-compact #rout>:not\(\.rsum\)\{display:none !important;\}/.test(c), 'compact shows the whole route, not its three numbers');
  assert.ok(/body\.mobile\.plan-open \.locate-fab\{bottom:calc\(var\(--plan-h,240px\) \+ 12px\);/.test(c), 'the locate button is left under the sheet');
  assert.ok(/body\.mobile\.plan-open \.omni\{display:none;\}/.test(c) && /body\.mobile \.leaflet-control-zoom\{display:none;\}/.test(c));
  // the handle is a named button, and the two fields say which is which now that their labels are hidden in the short form
  const s = script(), html = H.html();
  assert.ok(/btn\.setAttribute\('aria-label', t\('sheetResize'\)\)/.test(fnSource(s, 'setupPlanSheet')), 'the handle has no name for a screen reader');
  assert.ok(/id="selO"[^>]*data-i18n-ph="fromPh"/.test(html) && /id="selD"[^>]*data-i18n-ph="toPh"/.test(html), 'the two fields have the same placeholder: with the labels hidden nobody can tell From from To');
  const I = H.i18nValues();
  for (const lang of Object.keys(I)) for (const k of ['fromPh', 'toPh', 'sheetResize']) assert.ok(I[lang][k] && I[lang][k].length > 3, lang + ' has no text for ' + k);
  for (const lang of Object.keys(I)) assert.notStrictEqual(I[lang].fromPh, I[lang].toPh);
});
