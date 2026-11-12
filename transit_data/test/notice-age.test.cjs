/* How old are the rail and ferry notices — and does the app say so?
 *
 * On 24 Oct 2026 GitHub's servers lost the ability to read metro.istanbul, and for a day and a half the map kept showing a
 * "power outage" notice the official page had dropped: the notices come from a job, and when the job cannot run nothing on
 * the map said so. The fix has three parts, each checked here: the scraper writes a small file saying when the page was
 * last READ (not when a notice last changed, which on a quiet day says nothing); the app turns it into "checked 12 min ago"
 * and, after eight hours, a plain warning with the notices greyed; and the page keeps fetching, because an age computed
 * from a file fetched once at boot would grow in an open tab even when the file had long been refreshed.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const DIR = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');

/* the scraper's own helper, taken out of its source (the scraper runs main() when it is required) */
function scraperHelper() {
  const src = read('scrape-disruptions.cjs');
  assert.ok(src.includes('==STATUS-START=='), 'the status block lost its marker');
  const a = src.indexOf('const HEARTBEAT_MS'), b = src.indexOf('/* ==STATUS-END== */');
  assert.ok(a > 0 && b > a, 'the status block is not in the scraper');
  return new Function(src.slice(a, b) + '\nreturn { nextStatus, HEARTBEAT_MS, railCarriedOver };')();
}
const { nextStatus, HEARTBEAT_MS, railCarriedOver } = scraperHelper();
const T0 = Date.parse('2026-10-25T12:00:00Z');
const stamp = ms => ({ v: 1, checkedAt: new Date(ms).toISOString() });

test('the first read, a changed notice, and a quiet spell of three hours each publish a new status', () => {
  assert.deepStrictEqual(nextStatus(null, false, T0), { v: 1, checkedAt: '2026-10-25T12:00:00.000Z' }, 'no status yet');
  assert.ok(nextStatus(stamp(T0 - 60000), true, T0), 'a changed notice must publish at once');
  assert.ok(nextStatus(stamp(T0 - HEARTBEAT_MS), false, T0), 'three quiet hours is the longest a status may stay unrefreshed');
  assert.strictEqual(HEARTBEAT_MS, 3 * 3600 * 1000);
});

test('a status that is recent enough is left alone, so a quiet day costs a handful of commits, not one every half hour', () => {
  assert.strictEqual(nextStatus(stamp(T0 - 30 * 60000), false, T0), null);
  assert.strictEqual(nextStatus(stamp(T0 - HEARTBEAT_MS + 1000), false, T0), null);
});

test('a status that cannot be trusted is replaced: unreadable, missing its date, or dated in the future', () => {
  assert.ok(nextStatus({}, false, T0));
  assert.ok(nextStatus({ checkedAt: 'last tuesday' }, false, T0));
  assert.ok(nextStatus(stamp(T0 + 3600 * 1000), false, T0), 'a clock that ran ahead must not hold the stamp in the future');
});

/* the app's helpers, as they ship in the built page */
function appHelpers() {
  const html = H.html();
  const a = html.indexOf('const ANN_STALE_MIN'), b = html.indexOf('function annAgeText', a);
  assert.ok(a > 0 && b > a, 'noticeAge / ageWords are not in the built page');
  const t = k => ({ ageMin: '{n} min', ageHour: '{n} h', ageDay: '{n} d' }[k]);
  return new Function('t', html.slice(a, b) + '\nreturn { noticeAge, ageWords, ANN_STALE_MIN };')(t);
}
const A = appHelpers();

test('the age is whole minutes, never negative, and unknown when there is nothing to go on', () => {
  assert.strictEqual(A.noticeAge(null, T0), null, 'no status file: say nothing rather than guess');
  assert.strictEqual(A.noticeAge(NaN, T0), null);
  assert.strictEqual(A.noticeAge(undefined, T0), null);
  assert.strictEqual(A.noticeAge('2026-10-25T11:00:00Z', T0), null, 'it is milliseconds, not a string');
  assert.strictEqual(A.noticeAge(T0 - 12 * 60000, T0).mins, 12);
  assert.strictEqual(A.noticeAge(T0 + 5 * 60000, T0).mins, 0, 'a device clock a little behind the file must not show "-5 min"');
});

test('"may be out of date" starts at eight hours, not before', () => {
  assert.strictEqual(A.ANN_STALE_MIN, 480);
  assert.strictEqual(A.noticeAge(T0 - 479 * 60000, T0).stale, false);
  assert.strictEqual(A.noticeAge(T0 - 480 * 60000, T0).stale, true);
  // the status is refreshed at least every three hours while the job runs, so a healthy feed never reads as stale
  assert.ok(A.ANN_STALE_MIN * 60000 > 2 * HEARTBEAT_MS, 'the warning threshold must leave room for a missed run or two');
});

test('the age reads as minutes, then hours, then days', () => {
  assert.strictEqual(A.ageWords(0), '1 min', 'never "0 min"');
  assert.strictEqual(A.ageWords(12), '12 min');
  assert.strictEqual(A.ageWords(59), '59 min');
  assert.strictEqual(A.ageWords(60), '1 h');
  assert.strictEqual(A.ageWords(47 * 60), '47 h');
  assert.strictEqual(A.ageWords(48 * 60), '2 d');
  assert.strictEqual(A.ageWords(5 * 1440), '5 d');
});

test('every language says it, with the places the numbers go', () => {
  const src = read('src/01-i18n.js');
  const count = (re) => (src.match(re) || []).length;
  assert.strictEqual(count(/annAge:"[^"]*\{age\}[^"]*"/g), 4, 'annAge must exist in all four languages and carry {age}');
  assert.strictEqual(count(/annStale:"[^"]+"/g), 4, 'annStale must exist in all four languages');
  for (const k of ['ageMin', 'ageHour', 'ageDay']) assert.strictEqual(count(new RegExp(k + ':"[^"]*\\{n\\}[^"]*"', 'g')), 4, k + ' must exist in all four languages and carry {n}');
});

test('the page fetches the status with the notices, and keeps fetching while the tab is in use', () => {
  const html = H.html();
  assert.ok(/fetch\('transit_data\/disruptions-status\.json\?t='\+stamp/.test(html), 'the status file is not fetched');
  assert.ok(/DISR_CHECKED = ms/.test(html), 'the fetched time is never stored');
  const m = html.match(/if\(HAS\.disruptions\) setInterval\(\(\) => \{ if\(!document\.hidden\) loadLiveDisruptions\(\); \}, (\d+) \* 60 \* 1000\);/);
  assert.ok(m, 'a tab left open does not refresh the notices (and so would show an age that only grows)');
  assert.ok(Number(m[1]) <= 15, 'refreshing less often than every 15 minutes leaves the age out of step with the file');
  assert.ok(/setInterval\(refreshAnnAge, 60000\);/.test(html), 'the "checked … ago" line is never brought up to date');
});

test('a stale feed shows a warning and greys the rail and ferry rows, but not the bus group or the opening cards', () => {
  const html = H.html();
  assert.ok(/stale = annStaleness\(ages, rail\.length, ferry\.length\)/.test(html), 'the warning should need both a stale age and something to warn about');
  assert.ok(/class="ann-stalebar" role="status"/.test(html), 'the warning bar is gone');
  assert.ok(/\.ann-body\.ann-stale > \.ann-item\[data-id\]\{opacity:/.test(html), 'the stale rows are no longer greyed');
  // the bus groups carry data-key and sit inside .ann-busbox; the opening cards carry data-open: neither has data-id, so neither is greyed
  const bus = html.match(/function annBusGroupHTML[\s\S]*?\n\}/)[0];
  assert.ok(!/data-id=/.test(bus), 'a bus group row would be greyed by the stale rule');
});

test('the status file ships, is valid, and the GitHub job commits it with the notices', () => {
  const st = JSON.parse(read('disruptions-status.json'));
  assert.strictEqual(st.v, 1);
  assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(st.checkedAt) && isFinite(Date.parse(st.checkedAt)), 'checkedAt is not an ISO date');
  const wf = fs.readFileSync(path.join(DIR, '..', '.github', 'workflows', 'disruptions.yml'), 'utf8');
  assert.ok(/git add transit_data\/disruptions\.json transit_data\/disruptions-status\.json/.test(wf), 'the job would publish notices without their status');
  assert.ok(/git diff --quiet -- transit_data\/disruptions\.json transit_data\/disruptions-status\.json/.test(wf), 'the job would not notice a status-only change');
});

/* ---- V4.5.2: the ferry page can be read without the rail page (GitHub's job, through the relay), so each has its own age ---- */
const ISO = ms => new Date(ms).toISOString();

test('status: a run that read only the ferry page moves only the ferry time, and the rail time keeps what it had', () => {
  const prev = { v: 1, checkedAt: ISO(T0 - 9 * 3600000), ferryCheckedAt: ISO(T0 - 4 * 3600000) };
  assert.deepStrictEqual(nextStatus(prev, false, T0, { rail: false, ferry: true }), { v: 1, checkedAt: ISO(T0 - 9 * 3600000), ferryCheckedAt: ISO(T0) },
    'reading the ferry page was recorded as reading the rail page too: nine-hour-old rail notices would look fresh');
  assert.deepStrictEqual(nextStatus(prev, false, T0, { rail: true, ferry: false }), { v: 1, checkedAt: ISO(T0), ferryCheckedAt: ISO(T0 - 4 * 3600000) });
  assert.deepStrictEqual(nextStatus(prev, false, T0, { rail: true, ferry: true }), { v: 1, checkedAt: ISO(T0), ferryCheckedAt: ISO(T0) });
  // an older file has one time; the page that was not read does not get one invented for it
  assert.deepStrictEqual(nextStatus({ v: 1, checkedAt: ISO(T0 - 9 * 3600000) }, false, T0, { rail: false, ferry: true }), { v: 1, checkedAt: ISO(T0 - 9 * 3600000), ferryCheckedAt: ISO(T0) });
  assert.deepStrictEqual(nextStatus(null, false, T0, { rail: false, ferry: true }), { v: 1, ferryCheckedAt: ISO(T0) }, 'a rail time was made up for a page that was not read');
  // quiet and recent: nothing is published, whichever page it was
  assert.strictEqual(nextStatus({ v: 1, checkedAt: ISO(T0 - 9 * 3600000), ferryCheckedAt: ISO(T0 - 60000) }, false, T0, { rail: false, ferry: true }), null,
    'a ferry-only run publishes a status every half hour: dozens of needless commits a day');
  assert.ok(nextStatus({ v: 1, checkedAt: ISO(T0 - 60000), ferryCheckedAt: ISO(T0 - HEARTBEAT_MS) }, false, T0, { rail: true, ferry: true }), 'the ferry time is allowed to go unrefreshed past the heartbeat');
});

test('scraper: with the rail page unreadable the rail notices are kept exactly, and only the ferry ones are replaced', () => {
  const current = [{ id: 'a', ref: 'M2', message: 'rail fault' }, { id: 'f-old', mode: 'ferry', ref: 'F1' }, { id: 'b', ref: 'T1' }, { id: 'man', ref: 'B2', manual: true }];
  const out = railCarriedOver(current, [{ id: 'f-new', mode: 'ferry', ref: 'F2' }]);
  assert.deepStrictEqual(out.map(e => e.id), ['a', 'b', 'man', 'f-new'], 'a rail notice was lost, an old ferry notice was kept, or the new one was not written');
  assert.strictEqual(out[0], current[0], 'a carried-over notice must be the very same record, not a rebuilt one');
  assert.deepStrictEqual(railCarriedOver(current, []).map(e => e.id), ['a', 'b', 'man']);
  const src = read('scrape-disruptions.cjs');
  assert.ok(/if\(!fetchOk && !ferryOk\)\{[^}]*process\.exitCode=2; return; \}/.test(src), 'with neither page read the file must be left alone and the run marked as failed');
  assert.ok(/nextStatus\(prevStatus, before !== text, Date\.now\(\), \{ rail: fetchOk, ferry: ferryOk \}\)/.test(src), 'the status does not record which page was really read');
  assert.ok(!/Source unreachable — leaving disruptions\.json unchanged/.test(src), 'a rail page that cannot be read still stops the ferry notices from being refreshed');
});

/* the panel's own rules, run from the built page */
const AGE = (() => {
  const html = H.appScript().replace(/\r\n/g, '\n');
  const grab = name => { const m = new RegExp('function ' + name + '\\(').exec(html); let i = html.indexOf('{', m.index), d = 0; for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; } return html.slice(m.index, i + 1); };
  const ctx = { DISR_CHECKED: null, DISR_FERRY_CHECKED: null };
  const f = new Function('ctx', 'const ANN_STALE_MIN = 8 * 60;\n' + grab('noticeAge') + '\n' + grab('annStaleness') +
    '\nfunction annAges(nowMs){ const DISR_CHECKED = ctx.DISR_CHECKED, DISR_FERRY_CHECKED = ctx.DISR_FERRY_CHECKED; ' + grab('annAges').replace(/^function annAges\(nowMs\)\{/, '') + '\nreturn { annAges, annStaleness };');
  return Object.assign(f(ctx), { ctx });
})();
const H1 = 3600000;

test('panel: fresh ferry notices are not called stale because the rail page has not been read, nor the other way round', () => {
  AGE.ctx.DISR_CHECKED = T0 - 9 * H1; AGE.ctx.DISR_FERRY_CHECKED = T0 - 20 * 60000;       // laptop off since last night, GitHub's job read the ferry page
  let ages = AGE.annAges(T0), st = AGE.annStaleness(ages, 2, 3);
  assert.deepStrictEqual([ages.rail.stale, ages.ferry.stale], [true, false]);
  assert.deepStrictEqual([st.rail, st.ferry, st.bar, st.apart], [true, false, 'annStaleRail', true], 'the warning says "rail and ferry" when only the rail notices are old');
  st = AGE.annStaleness(ages, 0, 3);
  assert.deepStrictEqual([st.rail, st.bar], [false, ''], 'a warning about rail notices with no rail notice on show');
  AGE.ctx.DISR_CHECKED = T0 - 20 * 60000; AGE.ctx.DISR_FERRY_CHECKED = T0 - 9 * H1;
  st = AGE.annStaleness(AGE.annAges(T0), 2, 3);
  assert.deepStrictEqual([st.rail, st.ferry, st.bar], [false, true, 'annStaleFerry']);
  AGE.ctx.DISR_CHECKED = T0 - 9 * H1; AGE.ctx.DISR_FERRY_CHECKED = T0 - 10 * H1;
  st = AGE.annStaleness(AGE.annAges(T0), 2, 3);
  assert.deepStrictEqual([st.rail, st.ferry, st.bar], [true, true, 'annStale']);
  // an older status file: one time speaks for both, and one line says so
  AGE.ctx.DISR_CHECKED = T0 - 40 * 60000; AGE.ctx.DISR_FERRY_CHECKED = null;
  ages = AGE.annAges(T0); st = AGE.annStaleness(ages, 2, 3);
  assert.strictEqual(ages.ferry.mins, 40, 'with no ferry time the ferry notices have no age at all');
  assert.deepStrictEqual([st.bar, st.apart], ['', false]);
  AGE.ctx.DISR_FERRY_CHECKED = T0 - 5 * 60000;
  assert.strictEqual(AGE.annStaleness(AGE.annAges(T0), 2, 3).apart, true, 'ages 35 minutes apart are shown as one');
});

test('panel: the ferry rows carry their own word, the page reads both times, and every language can say each line', () => {
  const html = H.html();
  assert.ok(/'class="ann-item ' \+ \(stale\.ferry \? 'ann-old' : 'ann-fresh'\) \+ '"'/.test(html), 'a ferry row is not marked old or fresh');
  assert.ok(/body\.classList\.toggle\('ann-stale', stale\.rail\)/.test(html), 'the grey over the rail rows no longer follows the rail age');
  assert.ok(/\.ann-body\.ann-stale > \.ann-item\.ann-fresh\[data-id\]\{opacity:1;filter:none;\}/.test(html), 'fresh ferry rows are greyed with the old rail rows');
  assert.ok(/\.ann-body > \.ann-item\.ann-old\[data-id\]\{opacity:\.62;/.test(html), 'old ferry rows are not greyed when the rail rows are fresh');
  assert.ok(/fm = Date\.parse\(st\.ferryCheckedAt\)/.test(html) && /DISR_FERRY_CHECKED = isFinite\(fm\) \? fm : null;/.test(html), 'the page does not read the ferry time');
  for (const key of ['annStaleRail', 'annStaleFerry', 'annAgeRail', 'annAgeFerry']) {
    const n = (H.appScript().match(new RegExp(key + ':"', 'g')) || []).length;
    assert.strictEqual(n, 4, key + ' is missing in a language');
  }
  for (const key of ['annAgeRail', 'annAgeFerry']) assert.strictEqual((H.appScript().match(new RegExp(key + ':"[^"]*\\{age\\}', 'g')) || []).length, 4, key + ' has no place for the age in some language');
});
