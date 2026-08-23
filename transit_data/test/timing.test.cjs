/* The timing engine's arithmetic, tested against the page that actually ships.
 *
 * These are the calculations the brief insists a language model must never perform from
 * memory, so they are deterministic, isolated behind ==TIMING-PURE-== markers, and pinned
 * here. Every check below corresponds to a way the old planner was wrong, or a way this one
 * could quietly become wrong:
 *
 *   - it charged half a headway at EVERY change and never asked whether the connection stood
 *     up, so a transfer could never be tight and never be missed;
 *   - it treated a published frequency and an operator timetable as the same kind of fact;
 *   - the arrivals board rendered "3m 43s" from a decorative animation under a LIVE badge.
 *
 * The recurring hazard now is the opposite one: a confident-looking number with nothing behind
 * it. Several tests below exist only to prove the engine still REFUSES to answer when it does
 * not know — that refusal is a feature and it is easy to delete by accident.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

/* Lift the pure block out of the SHIPPED page. Not out of src/: build.cjs concatenates the
   sources, and a splice that dropped this file would leave a test of src/ perfectly green. */
function timing() {
  const html = H.html();
  const a = html.indexOf('/* ==TIMING-PURE-START==');
  const b = html.indexOf('/* ==TIMING-PURE-END== */');
  assert.ok(a > 0 && b > a, 'timing pure-maths markers not found in the built page');
  const src = html.slice(a, b);
  const mod = { exports: {} };
  new Function('module', 'exports', src +
    '\nmodule.exports={expectedWaitFor,medianGap,bufferForLines,verdictForSlack,' +
    'journeyConfidence,hhmmToMin,minToHHMM,sameDayLine,WAIT_CAP_MIN,XFER_VERDICT,CONF_RANK};'
  )(mod, mod.exports);
  return mod.exports;
}

/* --- expected wait ------------------------------------------------------------------- */
test('expected wait on a frequency is half the headway, and capped', () => {
  const { expectedWaitFor, WAIT_CAP_MIN } = timing();
  assert.strictEqual(expectedWaitFor(10), 5, 'a 10 min headway should mean a 5 min expected wait');
  assert.strictEqual(expectedWaitFor(6), 3);
  // the cap exists so a rare service does not dominate the router; without it a 90-minute
  // rural bus would cost 45 minutes and the route would never be offered
  assert.strictEqual(expectedWaitFor(90), WAIT_CAP_MIN, 'a rare service must be capped');
  assert.ok(expectedWaitFor(0.2) > 0, 'wait must never be zero or negative');
});

/* --- the operator's after-midnight clock ---------------------------------------------- */
test('operator times past midnight are read as the next day, not rejected', () => {
  const { hhmmToMin } = timing();
  // 24:15 is a real convention in Turkish timetables and means 00:15 tomorrow. Reading it as
  // invalid loses the last departures of the night; reading it as 15 puts them at dawn.
  assert.strictEqual(hhmmToMin('24:15'), 1455);
  assert.strictEqual(hhmmToMin('25:30'), 1530);
  assert.strictEqual(hhmmToMin('00:15'), 15);
  assert.strictEqual(hhmmToMin('nonsense'), null);
  assert.strictEqual(hhmmToMin('12:75'), null, 'a 75th minute is not a time');
});

test('a traveller in the small hours is placed on the service day that is still running', () => {
  const { sameDayLine } = timing();
  const times = [360, 1380, 1455];           // 06:00 … 23:00, 24:15
  // 00:10 with a service that runs to 24:15 means minute 1450, not minute 10 — otherwise the
  // engine reports the last train as long gone when it has not left yet
  assert.strictEqual(sameDayLine(10, times), 1450);
  assert.strictEqual(sameDayLine(600, times), 600, 'a daytime traveller is not shifted');
  assert.strictEqual(sameDayLine(600, []), 600, 'an empty timetable must not throw');
});

/* --- transfer verdicts ----------------------------------------------------------------- */
test('transfer verdicts follow the slack, and a missed connection is reachable', () => {
  const { verdictForSlack } = timing();
  assert.strictEqual(verdictForSlack(-2), 'infeasible', 'negative slack means the train has gone');
  assert.strictEqual(verdictForSlack(0.5), 'risky');
  assert.strictEqual(verdictForSlack(2), 'tight');
  assert.strictEqual(verdictForSlack(5), 'ok');
  assert.strictEqual(verdictForSlack(30), 'safe');
});

test('the verdict scale is ordered and reaches every state', () => {
  const { XFER_VERDICT, verdictForSlack } = timing();
  const ids = XFER_VERDICT.map(v => v.id);
  assert.deepStrictEqual(ids, ['infeasible', 'risky', 'tight', 'ok', 'safe'],
    'reordering these silently changes what every transfer is called');
  for (let i = 1; i < XFER_VERDICT.length; i++) {
    assert.ok(XFER_VERDICT[i].maxSlack > XFER_VERDICT[i - 1].maxSlack,
      'thresholds must increase, or a band becomes unreachable');
  }
  // every band must be producible; an unreachable one is a label users would never see
  const seen = new Set([-5, 0.5, 2, 5, 60].map(verdictForSlack));
  assert.strictEqual(seen.size, 5, 'some verdict band cannot be reached');
});

/* --- the interchange buffer ------------------------------------------------------------ */
test('the interchange buffer grows with the interchange and stays bounded', () => {
  const { bufferForLines } = timing();
  const one = bufferForLines(1), five = bufferForLines(5);
  assert.ok(five > one, 'a five-line interchange must cost more to cross than a single stop');
  assert.ok(bufferForLines(50) <= 3, 'the buffer must be bounded — no station takes 25 minutes to cross');
  assert.strictEqual(bufferForLines(0), bufferForLines(1), 'a missing count must not go negative');
});

/* --- journey confidence ---------------------------------------------------------------- */
test('journey confidence is the weakest leg, never an average', () => {
  const { journeyConfidence } = timing();
  // the defect this prevents: two exact legs and one guess reported as "mostly high", which is
  // how an itinerary ends up looking more certain than its worst part
  const mixed = journeyConfidence([
    { confidence: 'high', exact: true },
    { confidence: 'high', exact: true },
    { confidence: 'low',  exact: false },
  ]);
  assert.strictEqual(mixed.level, 'low', 'one guessed leg must drag the whole journey down');
  assert.strictEqual(mixed.exactLegs, 2);
  assert.strictEqual(mixed.legs, 3);
  assert.strictEqual(mixed.allExact, false);

  const all = journeyConfidence([{ confidence: 'high', exact: true }, { confidence: 'high', exact: true }]);
  assert.strictEqual(all.level, 'high');
  assert.strictEqual(all.allExact, true);

  assert.strictEqual(journeyConfidence([]).level, 'low', 'knowing nothing is not high confidence');
});

/* --- median gap ------------------------------------------------------------------------ */
test('the typical gap ignores the overnight hole at the ends of a timetable', () => {
  const { medianGap } = timing();
  // 06:00-06:30 every 10, then nothing until 23:00 — the mean would call this "every 4 hours"
  const times = [360, 370, 380, 390, 1380];
  assert.strictEqual(medianGap(times), 10, 'the median must survive one enormous gap');
  assert.strictEqual(medianGap([100]), null, 'one departure has no gap');
  assert.strictEqual(medianGap(null), null);
});

/* --- refusals -------------------------------------------------------------------------- */
/* The engine's most valuable behaviour is declining to answer. These check the refusals are
   still wired into the shipped page, because each one is a single branch away from becoming a
   confident fabrication. */
test('a transfer onto a line with no timetable yields no verdict', () => {
  const src = H.appScript();
  assert.ok(/verdict:\s*'frequency'/.test(src),
    "the 'frequency' outcome is gone — a transfer with no timetable would now be given a verdict it cannot support");
  assert.ok(/if \(!aim\.exact \|\| aim\.next == null\)/.test(src),
    'the guard that detects a non-exact departure has been removed or renamed');
});

test('a missed connection is only claimed when both times are known', () => {
  const src = H.appScript();
  /* The arriving leg's duration is a scaled share of the router's static path cost, so an
     arrival minute carries minutes of slop. Declaring a SPECIFIC train missed against it would
     be the arrivals board's old false precision wearing different clothes. While the arrival is
     estimated the verdict is capped at 'risky' — true and useful — and no vehicle is named. */
  assert.ok(/if \(slack < 0 && arrivalExact\)/.test(src),
    "the guard is gone — 'infeasible' can now be declared from an estimated arrival time");
  assert.ok(/verdict: 'risky', capped: true/.test(src),
    'the capped verdict for an estimated arrival has been removed');
  // and the planner must actually admit its arrivals are estimates
  assert.ok(/arrivalExact:false/.test(src),
    'the planner now claims exact arrivals it does not compute');
});

test('no reliability score is derived from delay history the project does not hold', () => {
  const src = H.appScript();
  assert.ok(/basis: 'slack'/.test(src), "checkTransfer no longer records what its verdict is based on");
  assert.ok(!/basis: 'history'/.test(src),
    'a history-based reliability score appeared, but no delay history is shipped — it could only be invented');
});

test('the modelled arrivals board is not badged as live', () => {
  const html = H.html();
  const i = html.indexOf('id="stnBoard"');
  assert.ok(i > 0, '#stnBoard not found');
  // the header immediately precedes the board; it once read LIVE above second-by-second
  // countdowns generated by the map's carriage animation
  const head = html.slice(Math.max(0, i - 400), i);
  assert.ok(/data-i18n="modelled"/.test(head),
    'the modelled-arrivals board lost its MODELLED badge');
  assert.ok(!/class="live"/.test(head),
    'the modelled board is badged LIVE again — it is generated from published frequencies, not observed vehicles');
});

test('the modelled board does not quote seconds', () => {
  const src = H.appScript();
  const m = /function fmtEta\(sec\)\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(m, 'fmtEta not found');
  assert.ok(!/"s"|\'s\'|padStart\(2/.test(m[1]),
    'second-level precision is back on a board modelled from a published frequency');
});
