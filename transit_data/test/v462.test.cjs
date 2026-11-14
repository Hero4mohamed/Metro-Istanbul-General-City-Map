'use strict';
/* V4.6.2: the warning sign and the boat piers one small size at every zoom, sheets and panels that leave the map in view and move
 * with a finger, the planner opened from the search bar (three bottom buttons), a line shown on the map when it is pressed, and
 * reminders ("scheduling") for a bus, metro, tram or boat stop. Each test runs the REAL built code where it can. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const APP = H.appScript().replace(/\r\n/g, '\n');
const HTML = H.html().replace(/\r\n/g, '\n');
const CSS = H.appStyle().replace(/\r\n/g, '\n');
function fnSource(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = src.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1); }
  throw new Error('unbalanced braces in ' + name);
}
const PURE = (() => {
  const a = APP.indexOf('/* ==REMIND-PURE-START== */'), b = APP.indexOf('/* ==REMIND-PURE-END== */');
  assert.ok(a > 0 && b > a, 'the reminders\' pure block is gone');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(APP.slice(a, b) + '\nthis.f = { remParseTime, remDayOk, remYmd, remNextDue, remOnceDate, remDueAlerts, remICS, REM_BEFORE, REM_KEY };', ctx);
  return ctx.f;
})();
const MIN = 60000;
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();   // this machine's local time, as the app uses

/* ---- 1, 2: one small size at every zoom ---- */
test('the warning sign and its ring are one small fixed size (20 / 27 px), drawn as page elements that do not grow with the map', () => {
  assert.match(APP, /const WARN_SIZE = 20, WARN_RING = 27;/, 'the sign is not the small size of the zoomed-in screenshot any more');
  assert.match(APP, /width:\$\{WARN_RING\}px;height:\$\{WARN_RING\}px/, 'the ring is not drawn at its fixed size');
  assert.match(CSS, /\.warn-ring\{position:absolute;left:50%;top:50%;transform:translate\(-50%,-50%\)/, 'the ring is not centred on the sign');
});
test('a boat pier is a small dot of one size at every zoom (6 px, 8 px where lines meet), not a circle that grows when zoomed out', () => {
  assert.match(APP, /const PIER_DOT = 6, PIER_DOT_MULTI = 8;/);
  const m = /const d = s\.lines\.size > 1 \? PIER_DOT_MULTI : PIER_DOT;\s*L\.marker\(\[s\.lat, s\.lng\], \{ icon: L\.divIcon\(\{ className: 'pier-dot'/.exec(APP);
  assert.ok(m, 'the piers are not drawn as fixed-size dots');
  assert.match(CSS, /\.pier-dot\{[^}]*pointer-events:none;/, 'a pier dot takes the taps meant for the boats under it');
});

/* ---- 3, 7: sheets and panels that leave the map in view and move with a finger ---- */
function dragCtx(vh, topbarBottom) {
  const ctx = { window: { innerHeight: vh }, document: { querySelector: s => (s === '.topbar' ? { getBoundingClientRect: () => ({ bottom: topbarBottom }) } : null) } };
  vm.createContext(ctx);
  vm.runInContext(fnSource(APP, 'dragHeights') + '\n' + fnSource(APP, 'dragSettle') + '\n' + fnSource(APP, 'setDragDetent') + '\nthis.f = { dragHeights, dragSettle, setDragDetent };', ctx);
  return ctx.f;
}
test('on a phone a sheet opens at a LOW height (about half the screen) and never past 86 %: the map stays in view above it', () => {
  const f = dragCtx(800, 150);
  assert.deepStrictEqual({ ...f.dragHeights({ dataset: { dragKind: 'sheet' } }) }, { low: 440, high: 688 });
  const p = f.dragHeights({ dataset: { dragKind: 'panel' } });
  assert.strictEqual(p.low, 352); assert.strictEqual(p.high, 800 - 150 - 104, 'the line panel at its high height covers the top bar');
  assert.match(CSS, /body\.mobile \.msheet\{display:block;position:fixed;left:0;right:0;bottom:0;z-index:1300;max-height:55vh;/, 'a sheet covers the whole screen again');
  assert.match(fnSource(APP, 'openSheet'), /getElementById\('mbackdrop'\)\.classList\.remove\('on'\);/, 'the map behind a sheet is dimmed');
});
test('where a drag settles: up past the middle = high, a little down = low, far or fast down from low = closed', () => {
  const { dragSettle } = dragCtx(800, 150), Hh = { low: 400, high: 700 };
  assert.strictEqual(dragSettle(400, 600, 0.1, 'low', Hh), 'high');
  assert.strictEqual(dragSettle(400, 520, 0.6, 'low', Hh), 'high', 'a quick flick up does not open it');
  assert.strictEqual(dragSettle(400, 480, 0.1, 'low', Hh), 'low', 'a short slow pull up opens it fully');
  assert.strictEqual(dragSettle(700, 500, -0.1, 'high', Hh), 'low');
  assert.strictEqual(dragSettle(700, 640, -0.1, 'high', Hh), 'high', 'a little wobble down at the high height drops it');
  assert.strictEqual(dragSettle(400, 100, -0.2, 'low', Hh), null, 'dragging it far down does not close it');
  assert.strictEqual(dragSettle(400, 360, -0.9, 'low', Hh), null, 'a fast flick down does not close it');
  assert.strictEqual(dragSettle(400, 390, -0.1, 'low', Hh), 'low', 'a tiny slow pull down closes it');
});
test('setDragDetent sets the height, and with "instant" no animation runs (a panel never reopens squashed at a dragged height)', () => {
  const f = dragCtx(800, 150), cls = new Set(), log = [];
  const el = { dataset: { dragKind: 'panel' }, style: {}, scrollTop: 50, querySelector: () => null,
    classList: { add: c => { cls.add(c); log.push('+' + c); }, remove: c => { cls.delete(c); log.push('-' + c); } } };
  Object.defineProperty(el, 'offsetHeight', { get: () => { log.push('read:' + el.style.maxHeight); return 0; } });
  f.setDragDetent(el, 'high', true);
  assert.strictEqual(el.style.maxHeight, '546px'); assert.strictEqual(el.dataset.detent, 'high');
  assert.deepStrictEqual(log, ['+dragging', 'read:546px', '-dragging'], 'the height is not set with the animation off and drawn before it comes back');
  f.setDragDetent(el, 'low'); assert.strictEqual(el.style.maxHeight, '352px'); assert.strictEqual(el.scrollTop, 0);
});
test('the end of a drag reads the height BEFORE the animation comes back, and a close resets the height after the panel is gone', () => {
  const s = fnSource(APP, 'makeDraggable');
  const read = s.indexOf('const h = el.getBoundingClientRect().height;'), on = s.indexOf("el.classList.remove('dragging');\n    if(!moved) return;");
  assert.ok(read > 0 && on > read, 'the drag end can read the old, animating height (the panel then does not close)');
  assert.match(s, /if\(to === null\)\{ close\(\); setDragDetent\(el, 'low', true\); \}/);
  assert.match(fnSource(APP, 'setupPanelDrag'), /if\(now && !shown\) setDragDetent\(el, 'low', true\); shown = now;/, 'the line panel does not reopen at its low height');
  assert.match(fnSource(APP, 'setupPanelDrag'), /\[\['linp', 'linpX'\], \['stn', 'stnX'\]\]/, 'the line and station panels cannot be dragged');
  assert.ok(/<div class="linep glass" id="linp"[^>]*>\s*<div class="sgrab" aria-hidden="true"><\/div>/.test(HTML), 'the line panel has no grip');
});
test('opening a sheet (Layers, Alerts…) closes the line or station panel instead of leaving it on top', () => {
  assert.match(fnSource(APP, 'openSheet'), /if\(name && typeof closeAllPanels==='function'\) closeAllPanels\(\);/);
});

/* ---- 4, 5: the planner in the search bar, three bottom buttons ---- */
function plannerWorld(mobile, tab, plannerOpen) {
  const calls = [];
  const sel = { focus: () => calls.push('focus selO') };
  const ctx = {
    IS_MOBILE: mobile, currentTab: tab, calls,
    mSheets: { planner: { classList: { contains: c => c === 'open' && plannerOpen } } },
    openSheet: n => calls.push('sheet ' + n), setTab: x => calls.push('tab ' + x), openPlannerCard: () => calls.push('card'),
    document: { getElementById: id => (id === 'selO' ? sel : id === 'cardPlanner' ? { scrollIntoView() {} } : null) },
  };
  vm.createContext(ctx); vm.runInContext(fnSource(APP, 'plannerFromSearch') + '\nplannerFromSearch();', ctx);
  return calls;
}
test('the button beside the search box opens the planner (and on a phone closes it again); the bottom bar is Map / Layers / Alerts', () => {
  assert.deepStrictEqual(plannerWorld(true, 'active', false), ['sheet planner']);
  assert.deepStrictEqual(plannerWorld(true, 'active', true), ['sheet null'], 'pressing it again does not close the planner');
  assert.deepStrictEqual(plannerWorld(true, 'bus', false), ['tab active', 'sheet planner'], 'the planner opens over the bus view');
  assert.deepStrictEqual(plannerWorld(false, 'active', false), ['card', 'focus selO'], 'on a computer it does not open the Trip Planner card');
  assert.match(HTML, /<button class="omni-plan" id="omniPlan" type="button"/);
  /* V4.6.3 added Friends as the second button (v463.test.cjs); the planner is still not in the bar */
  assert.match(APP, /const items=\[ \['map','mMap'\], \['friends','mFriends'\], \['layers','mLayers'\], \['alerts','mAlerts'\] \];/);
  assert.ok(/ind\.className='mnav-ind'/.test(APP) && /\.mnav\[data-on="1"\] \.mnav-ind\{transform:translateX\(100%\);\}/.test(CSS), 'the bottom bar lost its sliding marker');
});

/* ---- 6: pressing a line shows it on the map ---- */
function fitWorld(mobile, panelShown) {
  const out = {};
  const ctx = {
    IS_MOBILE: mobile, window: { innerWidth: 1200, innerHeight: 800 },
    map: { fitBounds: (b, o) => { out.b = b; out.o = o; } },
    L: { latLngBounds: p => ({ n: p.length }) },
    document: {
      getElementById: id => (id === 'linp' ? { classList: { contains: () => panelShown }, getBoundingClientRect: () => (mobile ? { top: 450, right: 360 } : { top: 0, right: 340 }) } : null),
      querySelector: s => (s === '.topbar' ? { getBoundingClientRect: () => ({ bottom: 120 }) } : s === '.controls' ? { getBoundingClientRect: () => ({ left: 860, width: 320 }) } : null),
    },
  };
  vm.createContext(ctx); vm.runInContext(fnSource(APP, 'fitLineInView'), ctx);
  ctx.fitLineInView({ paths: [[[41, 29], [41.1, 29.1]], [[41.2, 29.2]]] });
  return out;
}
test('pressing a line fits the whole line into the part of the map nothing covers', () => {
  const ph = fitWorld(true, true);
  assert.strictEqual(ph.b.n, 3);
  assert.deepStrictEqual({ tl: [...ph.o.paddingTopLeft], br: [...ph.o.paddingBottomRight], z: ph.o.maxZoom }, { tl: [24, 132], br: [24, 362], z: 15 }, 'on a phone the line is not between the top bar and the panel');
  const pc = fitWorld(false, true);
  assert.deepStrictEqual({ tl: [...pc.o.paddingTopLeft], br: [...pc.o.paddingBottomRight] }, { tl: [364, 30], br: [364, 30] }, 'on a computer the line is not between the panel and the cards');
  const s = fnSource(APP, 'showLineOnMap');
  assert.match(s, /openSheet\(null\)/, 'a sheet stays over the line on a phone');
  assert.ok((fnSource(APP, 'openLine').match(/showLineOnMap\(line\);/g) || []).length >= 2, 'a live or a Vision line is not shown on the map when pressed');
});

/* ---- 8: reminders ---- */
test('reminder times: "05:20" is read, nonsense is not', () => {
  assert.strictEqual(PURE.remParseTime('05:20'), 320); assert.strictEqual(PURE.remParseTime('5:20'), 320); assert.strictEqual(PURE.remParseTime('23:59'), 1439);
  for (const bad of ['24:00', '12:60', '', null, '5.20', 'abc']) assert.strictEqual(PURE.remParseTime(bad), null, String(bad));
  assert.deepStrictEqual([...PURE.REM_BEFORE], [5, 10, 20]); assert.strictEqual(PURE.REM_KEY, 'irn_reminders');
});
test('the next time a reminder is due: today if still ahead, else the next allowed day; weekdays skip the weekend; a past one-off is none', () => {
  const fri = at(2026, 11, 13, 9, 0);   // Friday 13 Nov 2026
  assert.strictEqual(PURE.remNextDue({ time: '17:30', days: 'daily' }, fri), at(2026, 11, 13, 17, 30));
  assert.strictEqual(PURE.remNextDue({ time: '05:20', days: 'daily' }, fri), at(2026, 11, 14, 5, 20));
  assert.strictEqual(PURE.remNextDue({ time: '05:20', days: 'weekdays' }, fri), at(2026, 11, 16, 5, 20), 'a weekday reminder comes on a Saturday');
  assert.strictEqual(PURE.remNextDue({ time: '05:20', days: 'weekends' }, fri), at(2026, 11, 14, 5, 20));
  assert.strictEqual(PURE.remNextDue({ time: '05:20', days: 'once', date: '2026-11-14' }, fri), at(2026, 11, 14, 5, 20));
  assert.strictEqual(PURE.remNextDue({ time: '05:20', days: 'once', date: '2026-11-12' }, fri), null);
  assert.strictEqual(PURE.remOnceDate('08:00', fri), '2026-11-14', 'a one-off for a time already gone today is not for tomorrow');
  assert.strictEqual(PURE.remOnceDate('10:00', fri), '2026-11-13');
});
test('heads-ups: none before the earliest one, one at each chosen moment, never twice, and ONE (the latest) after the app slept', () => {
  const due = at(2026, 11, 14, 5, 20);
  const r = { id: 'a', on: true, time: '05:20', days: 'daily', before: [5, 10, 20] };
  assert.strictEqual(PURE.remDueAlerts([r], due - 21 * MIN).length, 0, 'a heads-up comes too early');
  let a = PURE.remDueAlerts([r], due - 20 * MIN);
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].before, 20); assert.deepStrictEqual([...a[0].covers], [20]);
  r.fired = { due: String(a[0].due), b: a[0].covers };
  assert.strictEqual(PURE.remDueAlerts([r], due - 15 * MIN).length, 0, 'the same heads-up is given twice');
  a = PURE.remDueAlerts([r], due - 4 * MIN);   // slept through the 10-minute one
  assert.strictEqual(a.length, 1, 'several heads-ups at once after the app slept');
  assert.strictEqual(a[0].before, 5); assert.deepStrictEqual([...a[0].covers].sort((x, y) => x - y), [5, 10, 20]);
  assert.strictEqual(PURE.remDueAlerts([{ ...r, on: false, fired: undefined }], due - 4 * MIN).length, 0, 'a switched-off reminder speaks');
  assert.strictEqual(PURE.remDueAlerts([{ ...r, fired: undefined }], due + 2 * MIN).length, 0, 'a heads-up after the time has gone');
});
test('"Add to my calendar" writes a valid calendar file: local time, the chosen days repeated, one alarm for each "before"', () => {
  const now = at(2026, 11, 13, 9, 0);
  const ics = PURE.remICS({ id: 'x1', time: '05:20', days: 'weekdays', before: [5, 20], title: 'M8 → Bostancı', desc: 'Kozyatağı; at 05:20, ok' }, now);
  const lines = ics.split('\r\n');
  assert.strictEqual(lines[0], 'BEGIN:VCALENDAR'); assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(lines.includes('DTSTART:20261116T052000'), 'the first weekday is not Monday 16 Nov, or the time is not local');
  assert.ok(lines.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'));
  assert.deepStrictEqual(lines.filter(l => l.startsWith('TRIGGER:')), ['TRIGGER:-PT20M', 'TRIGGER:-PT5M']);
  assert.ok(lines.includes('DESCRIPTION:Kozyatağı\\; at 05:20\\, ok'), 'text is not escaped for the calendar');
  const once = PURE.remICS({ id: 'x2', time: '07:05', days: 'once', date: '2026-12-01', before: [10], title: 't' }, now);
  assert.ok(once.includes('DTSTART:20261201T070500') && !once.includes('RRULE'), 'a one-off repeats');
  assert.strictEqual(PURE.remICS({ id: 'x3', time: 'bad', days: 'daily', before: [5] }, now), null);
});
test('reminders can be set from a line panel and a bus panel, are listed in Settings, close with Back / Escape, and are in the storage list', () => {
  assert.match(HTML, /<button class="lp-follow lp-remind" id="lpRemind" type="button">/);
  assert.match(APP, /class="bd-remind" data-remind="/, 'the bus panel has no Remind me button');
  assert.match(APP, /openReminder\('bus', rm\.dataset\.remind\)/);
  assert.ok(/id="remPanel"/.test(HTML) && /id="remRow"/.test(HTML) && /id="remList"/.test(HTML));
  assert.match(APP, /\{ id:'remind',\s+open:\(\) => navHas\('remPanel','open'\),\s+close:\(\) => closeReminder\(\) \}/, 'Back does not close the reminder dialog');
  assert.match(APP, /\{ id: 'remPanel',\s+cls: 'open', modal: true,\s+first: '#remX' \}/, 'the reminder dialog does not hold the keyboard focus');
  assert.match(APP, /if\(open\('remPanel', 'open'\)\)\{ closeReminder\(\); e\.preventDefault\(\); return; \}/, 'Escape does not close the reminder dialog');
  const legal = require('../legal-content.cjs'), s = JSON.stringify(legal);
  assert.ok(s.includes('irn_reminders'), 'the storage page does not list the reminders');
});
