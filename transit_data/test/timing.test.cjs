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
    'journeyConfidence,hhmmToMin,minToHHMM,sameDayLine,alignOffset,' +
    'WAIT_CAP_MIN,XFER_VERDICT,CONF_RANK};'
  )(mod, mod.exports);
  return mod.exports;
}

/* --- trip matching --------------------------------------------------------------------
   Two stations on a line publish departures for the same vehicles, so the run time between
   them is the offset that aligns the sequences. The danger is aliasing: offsets a whole
   headway apart align equally well, and picking between them arbitrarily would manufacture a
   confident arrival time out of nothing. These tests are mostly about the refusals. */
const seq = (first, headway, n) => Array.from({ length: n }, (_, i) => first + i * headway);

test('the run time between two stations is read off their published departures', () => {
  const { alignOffset } = timing();
  const from = seq(360, 10, 40);                 // 06:00 then every 10 minutes
  const to = from.map(v => v + 13);              // same vehicles, 13 minutes later
  const r = alignOffset(from, to, 12, 4);        // physical estimate says about 12
  assert.ok(r, 'no offset found for two cleanly shifted sequences');
  assert.strictEqual(r.offset, 13);
  assert.ok(r.support > 0.9, 'every trip should agree; got ' + r.support);
});

test('an offset is refused when a whole headway makes two answers equally good', () => {
  const { alignOffset } = timing();
  const from = seq(360, 10, 40);
  const to = from.map(v => v + 13);
  /* A window WIDER than the headway admits 13 and 23 — both align perfectly, because the
     sequences cannot tell one vehicle from the next. Guessing here is exactly how a made-up
     arrival time would enter the app, so the honest answer is none at all. */
  const r = alignOffset(from, to, 18, 9);        // window 9..27 spans more than one headway
  assert.strictEqual(r, null, 'an ambiguous window must not yield an offset');
});

test('an offset is refused when the timetables do not really agree', () => {
  const { alignOffset } = timing();
  const from = seq(360, 10, 40);
  // only a quarter of the trips line up at +13; the rest are unrelated
  const to = from.filter((_, i) => i % 4 === 0).map(v => v + 13).concat(seq(1000, 7, 20));
  const r = alignOffset(from, to, 13, 2);
  assert.strictEqual(r, null, 'weak agreement must not be reported as a run time');
});

test('trip matching declines rather than guessing on thin or missing data', () => {
  const { alignOffset } = timing();
  assert.strictEqual(alignOffset([1, 2], [3, 4], 2, 1), null, 'two departures prove nothing');
  assert.strictEqual(alignOffset(null, [1, 2, 3], 2, 1), null);
  assert.strictEqual(alignOffset(seq(360, 10, 20), seq(360, 10, 20), 5, 0), null, 'a zero window');
  assert.strictEqual(alignOffset(seq(360, 10, 20), seq(360, 10, 20), -3, 2), null, 'a negative hint');
});

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

/* --- vehicle model ----------------------------------------------------------------------
   A funicular's cars hang from one rope over a drum: one descends because the other climbs.
   Simulated as independent shuttles they drifted apart and could reach the same terminus at
   once. The browser suite proves the invariant holds while the model runs; these check the
   mechanism that makes it structurally impossible to break, and the reasoning about which
   modes it may be applied to. */
test('a funicular is modelled as a counterbalanced pair', () => {
  const src = H.appScript();
  assert.ok(/function spawnCounterbalanced/.test(src), 'the counterbalanced spawn is gone');
  assert.ok(/if\(line\.kind === 'funicular'/.test(src),
    'funiculars no longer get the paired model — their cars would drift apart again');
  /* The second car is DERIVED from its partner every frame rather than simulated beside it.
     That is the whole point: with one state and a view of it, drift is not unlikely, it is
     unrepresentable. Two independent integrations would drift however carefully they started. */
  assert.ok(/tr\.s = tr\.pairSpan - a\.s;/.test(src),
    'the partner car is no longer derived from the lead — it is being simulated separately again');
  assert.ok(/if\(tr\.mirrorOf\) continue;/.test(src),
    'the derived car is being integrated by the normal loop as well, which would double-move it');
});

test('the counterbalance is not applied to modes it was not established for', () => {
  const src = H.appScript();
  /* TF1/TF2 are aerial cable cars. Nothing this project ships says whether they are two-cabin
     reversible systems or continuous gondolas, so pairing them would swap one fiction for
     another. If that ever changes it should change with data, not by widening a condition. */
  // read the actual guard that reaches spawnCounterbalanced, rather than hoping a pattern
  // happens to span however it is formatted
  const guard = /(if\s*\([^\n]*\)\s*\{)\s*\n\s*trains\.push\(\.\.\.spawnCounterbalanced/.exec(src);
  assert.ok(guard, 'the condition that selects the counterbalanced model was not found');
  assert.ok(!/'cable'/.test(guard[1]),
    'cable cars are being paired, but the project holds nothing saying they are reversible two-cabin systems: ' + guard[1]);
  assert.ok(/aerial cable cars/i.test(src),
    'the note explaining why cable cars keep the generic model has gone');
});

/* --- the assistant's tool surface -------------------------------------------------------
   The brief's central architectural rule: the model understands the question and explains the
   answer, but every minute, wait, verdict and feasibility comes from the deterministic engine.
   A language model asked to add a walk to a departure will produce something plausible and
   occasionally wrong, and nothing downstream can tell which. These checks are about keeping
   that boundary where it is. */
test('the assistant is told not to do transport arithmetic itself', () => {
  const src = H.appScript();
  assert.ok(/You do not do transport arithmetic/.test(src),
    'the rule forbidding the model from computing times itself has been removed from the system prompt');
  assert.ok(/never dress an expectation up as a specific vehicle/i.test(src),
    'the instruction separating a timetabled departure from a frequency estimate has gone');
});

test('every transport tool the model is offered actually exists', () => {
  const src = H.appScript();
  const block = /const AI_TOOLS = \[([\s\S]*?)\n  \];/.exec(src);
  assert.ok(block, 'AI_TOOLS not found');
  const declared = [...block[1].matchAll(/\{\s*name:"([a-z_]+)"/g)].map(m => m[1]);
  assert.ok(declared.length >= 12, 'implausibly few tools declared: ' + declared.length);
  /* A tool the model can see but the runner cannot handle falls through to "unknown tool" —
     which the model reads as a failure of the app, not of its own request, and works around by
     guessing. Every advertised name must be implemented. */
  const handled = new Set([...src.matchAll(/name === "([a-z_]+)"/g)].map(m => m[1]));
  const missing = declared.filter(n => !handled.has(n));
  assert.deepStrictEqual(missing, [], 'declared to the model but not implemented: ' + missing.join(', '));
});

test('the deterministic tool surface is reachable by name', () => {
  const src = H.appScript();
  /* The tools live in the assistant's closure, where the question loop is. An engine API that
     nothing outside that closure can call cannot be tested and cannot be reused — the browser
     suite drives it through this entry point. */
  assert.ok(/function transportTool\(name, args\)/.test(src),
    'the published tool entry point is gone — the engine surface is sealed inside a closure again');
  assert.ok(/_transportToolRunner = \(name, a\) => runAiTool\(name, a\)/.test(src),
    'the tool runner is no longer published');
});

test('a journey handed to the model says where each leg’s time came from', () => {
  const src = H.appScript();
  /* Scoped to the function that BUILDS the summary. Checking the whole script found these
     names in the system prompt, which talks about them — so deleting a field from the payload
     while the prompt still instructed the model to read it left the test green and the model
     looking for something that was no longer there. */
  const fn = /function planSummaryFor\(it\)\{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(fn, 'the shared journey shape is gone');
  for (const field of ['departure_source', 'departure_is_exact', 'run_time_from_timetable',
                       'confidence', 'legs_from_timetable', 'missed_connections']) {
    assert.ok(new RegExp(field).test(fn[1]),
      'plan summaries no longer report ' + field + ' — the model cannot tell a timetabled departure from an estimate');
  }
  // anything the prompt tells the model to read must actually be produced
  for (const m of src.matchAll(/When a leg says (\w+)/g))
    assert.ok(new RegExp(m[1]).test(fn[1]),
      'the system prompt tells the model to read ' + m[1] + ', but plan summaries no longer contain it');
  // and the transfer detail must keep saying what it is NOT based on
  assert.ok(/no delay history is published/.test(src),
    'the tool output no longer states that its verdicts exclude delay history, which invites the model to imply reliability data exists');
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
  /* A leg's arrival is exact only when both its ends publish a timetable and the two sequences
     align unambiguously; otherwise it is board + a scaled share of the router's static cost and
     carries minutes of slop. Declaring a SPECIFIC train missed against an estimate would be the
     arrivals board's old false precision wearing different clothes, so the verdict caps at
     'risky' — true and useful — and no vehicle is named. */
  assert.ok(/if \(slack < 0 && arrivalExact\)/.test(src),
    "the guard is gone — 'infeasible' can now be declared from an estimated arrival time");
  assert.ok(/verdict: 'risky', capped: true/.test(src),
    'the capped verdict for an estimated arrival has been removed');
  /* The planner must pass the leg's REAL exactness. It used to hard-code false, which was
     honest but permanently pessimistic; hard-coding true would be the opposite and much worse. */
  assert.ok(/arrivalExact:prevExact/.test(src),
    'the planner no longer forwards whether the previous leg had a timetabled arrival');
  assert.ok(!/arrivalExact:\s*true/.test(src),
    'an arrival is being asserted exact unconditionally, without trip-matching it');
});

/* Direction matching cost two bugs, both silent, and both would come straight back if these
   fallbacks were "simplified" away. The oracle picks a platform, and picking the wrong one
   returns a confident departure time for a train going the other way. */
test('direction is decided by position or geography, never by terminus name alone', () => {
  const src = H.appScript();
  assert.ok(/function dirServes/.test(src), 'dirServes is gone');
  // 1. positional: the operator's terminus is on our line, so its index settles the direction
  assert.ok(/stationIndexOnLine\(ctx\.ref, d\.towards\)/.test(src),
    'the positional direction test has been removed');
  /* 2. geometric: the operator's M1B runs "to Kirazlı"; this project's M1B ends at Bağcılar
     Meydan and files Kirazlı under M3, so neither the name nor our station order matches. A
     terminus nearer the alighting station than the boarding one is still the way you are
     going. Without this, every M1B leg silently lost its timetable. */
  assert.ok(/stationCoordsByName\(d\.towards\)/.test(src),
    'the geometric direction fallback has been removed — lines whose operator terminus is not on our station list will silently lose their timetables');
  assert.ok(/return dTo < dFrom;/.test(src), 'the geometric comparison no longer chooses a direction');
  // an unknown direction must never be silently dropped, or a station loses its timetable
  assert.ok(/if \(!d \|\| !d\.towards\) return true;/.test(src),
    'an unrecognised direction is now excluded rather than accepted');
});

test('a leg that ends at a terminus keeps an estimated arrival', () => {
  const src = H.appScript();
  /* An operator publishes departures OUT of a terminus, never arrivals INTO it, so there is no
     sequence to align against and legArrival must return null. This is a property of the
     published data; the comment is load-bearing because the null looks like a bug otherwise. */
  assert.ok(/never arrivals into it/i.test(src),
    'the note explaining why a terminus alighting cannot be trip-matched has gone');
  assert.ok(/const ta = seqFor\(A\), tb = seqFor\(B\);[\s\S]{0,60}if \(!ta \|\| !tb\) return null;/.test(src),
    'legArrival no longer declines when either end has no usable direction');
});

test('a journey through a shut line does not claim timetable-grade confidence', () => {
  const src = H.appScript();
  /* Rating a closed line's (non-existent) departure as high confidence let a 01:49 plan across
     a line that stops at midnight still print "times from published timetables". Confidence
     rates the departure time; the certainty about the closure rides on reason/closed. */
  assert.ok(/confidence: 'low', exact: false, headwayMin: null,\s*\n\s*times: null, next: null, waitMin: null, reason: 'closed'/.test(src),
    'a shut line reports confidence about a departure time it does not have');
  assert.ok(!/confidence: 'high'[^}]*reason: 'closed'/.test(src),
    "a closed-line branch is claiming high confidence again");
});

/* --- time-dependent routing -----------------------------------------------------------
   The search used to charge half a headway for every line at every hour, so at 02:00 a route
   that could not move until 06:00 scored the same as one running right now — and, being
   shorter once moving, outranked it. These pin the mechanism that fixed it. */
test('the search charges a wait that depends on the clock', () => {
  const src = H.appScript();
  assert.ok(/function waitAt\(ref, isBus, atMin, refId\)/.test(src),
    'waitAt no longer takes a time — the search would be time-independent again');
  assert.ok(/nd \+= XFER_PREF \+ waitAt\(vm\.ref, vm\.kind==='bus', t0 \+ du, vm\.refId\)/.test(src),
    'a change no longer costs a time-dependent wait');
  /* The FIRST boarding must cost a wait too. Charging only at changes made starting a journey
     free, which is where the ranking bug bit hardest. */
  assert.ok(/w \+= waitAt\(nodeMeta\[k\]\.ref, nodeMeta\[k\]\.kind==='bus', t0 \+ w, nodeMeta\[k\]\.refId\)/.test(src),
    'the first boarding is free again, so a route starting on a shut line costs nothing to begin');
});

test('a suspended line is excluded from routing, not merely warned about', () => {
  const src = H.appScript();
  assert.ok(/function suspendedRefs/.test(src), 'suspendedRefs is gone');
  assert.ok(/susp && susp\.size && susp\.has\(m\.ref\)/.test(src),
    'suspended lines are no longer blocked — the planner can route onto a line that is not running');
  // it must respect an expiry, or a line stays "suspended" forever after the works finish
  assert.ok(/if\(d\.until && Date\.parse\(d\.until \+ 'T23:59:59'\) < Date\.now\(\)\) continue;/.test(src),
    'an expired suspension no longer releases the line');
});

test('ranking compares door-to-door time, not travel time alone', () => {
  const src = H.appScript();
  assert.ok(/doorTotal: realTotal \+ waitTotal/.test(src), 'the router no longer reports a door-to-door total');
  assert.ok(/const dt = x => \(x\.it\.doorTotal != null \? x\.it\.doorTotal : x\.it\.total\);/.test(src),
    'the alternatives sort no longer uses the door-to-door figure');
  // and the headline keeps its old meaning, or the two disagree on screen
  assert.ok(/total:realTotal, waitTotal, doorTotal/.test(src),
    'travel time and waiting are no longer reported separately');
});

test('"arrive by" searches near the target, not near now', () => {
  const src = H.appScript();
  /* Anchoring an arrival request at the current clock costed the journey against whatever is
     running NOW. Asked at 02:30 for a 09:00 arrival that produced a six-leg night-bus crawl
     instead of the morning metro. Probe from the target, then anchor a journey-length earlier. */
  assert.ok(/planWhen\.mode === 'arrive' && planWhen\.min != null/.test(src),
    'the arrive-by branch is gone — an arrival request would be searched at the wrong hour');
  assert.ok(/t0 = planWhen\.min - Math\.min\(240, Math\.max\(5, span\)\)/.test(src),
    'the arrive-by anchor no longer steps back by the journey length');
  // and the probe must run at the TARGET, or the span it measures is itself mis-timed
  assert.ok(/const probe = routeXY\(o, d, null, planWhen\.min\);/.test(src),
    'the arrive-by probe no longer runs at the requested arrival time');
});

test('the search is guided but still optimal', () => {
  const src = H.appScript();
  /* A* with an admissible heuristic. The speed it divides by must never be lower than a real
     mode's — underestimating the remaining travel time is what keeps the heuristic admissible,
     and an admissible heuristic is what keeps the answer optimal.

     It was written as a literal 100 km/h, which held for metro and Marmaray and was quietly
     wrong for intercity rail at 200. Deriving it from KIND means a city that adds a faster mode
     cannot invalidate the search by accident, so this checks the DERIVATION survives rather
     than checking a number. */
  assert.ok(/const FASTEST_KMH = \(\(\) => \{/.test(src),
    'the A* heuristic speed is gone or is no longer derived');
  assert.ok(/const s = KIND\[l\.kind\] && KIND\[l\.kind\]\.speed; if\(s > m\) m = s;/.test(src),
    'the heuristic speed no longer reads the network’s own mode speeds — a literal here goes stale silently');
  assert.ok(!/const FASTEST_KMH = \d/.test(src),
    'the heuristic speed is hard-coded again');
  // and it must be used as a DIVISOR of distance, or it is not a time at all
  assert.ok(/\/1000\/FASTEST_KMH\*60/.test(src), 'the heuristic no longer converts distance to minutes');
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
