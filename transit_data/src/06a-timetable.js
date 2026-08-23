/* ===========================================================================
   6a. DEPARTURE ORACLE — the deterministic answer to "when does the next one go?"

   Everything that reasons about time goes through this file. It is pure: no DOM, no
   rendering, no network of its own. Callers ask, it answers, and it always says WHERE the
   answer came from, because the four sources this app holds are not equally good:

     tier 4  timetable   exact published departure clock times   Metro Istanbul API
     tier 3  operator    first + last + published headway        IETT GTFS / Kocaeli pages
     tier 2  published   a published frequency range             LINE_TIMING (peak/off)
     tier 1  modeDefault a per-mode assumption                   HW_FALLBACK

   The distinction is the whole point. With tier 4 the app can say "the 19:46 leaves in 4
   minutes and you will make it". With tier 2 the only honest statement is "about every 4-9
   minutes, so expect to wait around 3". Presenting the second as if it were the first is the
   defect this file exists to prevent, and it is the difference between a route that says 25
   minutes and a platform where the next train is 11 minutes away.

   Coverage is uneven and that is a fact about Istanbul's open data, not a bug here: exact
   timetables exist for 18 line refs (M1A-M9, T1/T3/T4/T5, F1, F4, TF1, TF2) and NOT for
   Marmaray, M11, T2, F2, F3, Metrobus or any ferry.

   SYNCHRONOUS BY DESIGN. Routing must work offline and must not block on a network call, so
   every function here answers immediately from what is already known. Exact timetables are
   fetched separately (warmTimetables) and land in a cache; the caller re-renders and the
   answer upgrades from tier 2 to tier 4. Same pattern the bus geometry already uses.
   =========================================================================== */

/* ---- tiers ---------------------------------------------------------------------------- */
const DEP_TIER = {
  timetable:   { rank: 4, conf: 'high',   i18n: 'srcTimetable'  },
  operator:    { rank: 3, conf: 'high',   i18n: 'srcOperator'   },
  published:   { rank: 2, conf: 'medium', i18n: 'srcPublished'  },
  modeDefault: { rank: 1, conf: 'low',    i18n: 'srcDefault'    },
};
// a tier at or above this is precise enough to talk about a SPECIFIC vehicle
const TIER_EXACT = 3;

/* ==TIMING-PURE-START==
   Everything between these markers is pure arithmetic: no DOM, no network, no app state, no
   dependency on anything declared elsewhere. That is what makes it testable in isolation, and
   it is also the boundary the brief draws — the calculations a language model must never be
   asked to do from memory live here, where they can be pinned by tests.
   ---------------------------------------------------------------------------------------- */

/* Expected wait for a passenger arriving at an unknown point in a uniform cycle is half the
   headway. Capped, because on a 90-minute rural bus nobody turns up at random — they read the
   timetable — so charging 45 minutes would push the router away from a route a real traveller
   would happily plan around. The cap is a routing convenience, applied in ONE place rather
   than re-invented per caller. */
const WAIT_CAP_MIN = 12;
function expectedWaitFor(headwayMin) {
  return Math.min(WAIT_CAP_MIN, Math.max(0.5, headwayMin / 2));
}
// typical gap in an exact timetable — the median resists the long overnight gap at the ends
function medianGap(times) {
  if (!times || times.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/* ---- trip matching ----------------------------------------------------------------------
   Two stations on the same line and direction publish departure times for the SAME vehicles.
   The run time between them is therefore whatever offset makes the two sequences line up, and
   reading it off the operator's own timetables beats any estimate built from commercial speed.
   This is what turns "a leg takes about 12 minutes" into "this train leaves at 19:58 and is
   there at 20:10", which is in turn what makes a missed connection a fact rather than a guess.

   The trap is ALIASING. With a 4-minute headway, offsets of 8, 12 and 16 minutes all align
   almost perfectly, because they differ by whole headways — the sequences cannot tell you which
   vehicle you are looking at, only that vehicles are regular. The search window must therefore
   be narrower than one headway and centred on an independent physical estimate. When it cannot
   be made that narrow, or when the timetables do not agree well enough, this returns null and
   the caller keeps its estimate rather than guessing between the aliases. */
function alignOffset(fromTimes, toTimes, hintMin, tolMin) {
  if (!fromTimes || !toTimes || fromTimes.length < 3 || toTimes.length < 3) return null;
  if (!(tolMin > 0) || !(hintMin > 0)) return null;
  const toSet = new Set(toTimes);
  const lo = Math.max(1, Math.ceil(hintMin - tolMin));
  const hi = Math.floor(hintMin + tolMin);
  if (hi < lo) return null;
  const counts = new Map();
  for (const a of fromTimes) {
    for (let off = lo; off <= hi; off++) if (toSet.has(a + off)) counts.set(off, (counts.get(off) || 0) + 1);
  }
  if (!counts.size) return null;
  let best = null, bestN = 0, secondN = 0;
  for (const [off, n] of counts) {
    if (n > bestN) { secondN = bestN; bestN = n; best = off; }
    else if (n > secondN) secondN = n;
  }
  const support = bestN / fromTimes.length;
  /* Two independent guards. Support: the winning offset must explain most of the trips, not a
     lucky handful. Margin: it must beat the runner-up clearly, or the window still holds two
     plausible answers and picking one would be arbitrary. */
  if (support < 0.6) return null;
  if (secondN > 0 && bestN < secondN * 1.5) return null;
  return { offset: best, support: support, matched: bestN, runnerUp: secondN };
}

/* How long a change takes before any waiting: the walk is measured from real coordinates by the
   caller, and the buffer scales with how many lines meet at the interchange — a proxy for
   concourse size that is COUNTED from the network, not invented. */
const XFER_BASE_BUFFER = 1.0;
const XFER_PER_LINE    = 0.5;
const XFER_MAX_BUFFER  = 3.0;
function bufferForLines(n) {
  return Math.min(XFER_MAX_BUFFER, XFER_BASE_BUFFER + (Math.max(1, n || 1) - 1) * XFER_PER_LINE);
}

/* Verdicts, ordered. Meaningful ONLY against a specific known departure — with a frequency all
   you can say is how long you expect to wait, so checkTransfer returns 'frequency' instead of
   inventing a connection to miss. */
const XFER_VERDICT = [
  { id: 'infeasible', maxSlack: 0 },
  { id: 'risky',      maxSlack: 1 },
  { id: 'tight',      maxSlack: 3 },
  { id: 'ok',         maxSlack: 8 },
  { id: 'safe',       maxSlack: Infinity },
];
function verdictForSlack(slack) {
  for (const v of XFER_VERDICT) if (slack < v.maxSlack) return v.id;
  return 'safe';
}

/* A journey is only as trustworthy as its weakest leg, so confidence is the MINIMUM across
   legs, never an average — an average lets one exact leg launder three guessed ones. */
const CONF_RANK = { high: 3, medium: 2, low: 1 };
function journeyConfidence(legSources) {
  let worst = 'high', exactCount = 0, total = 0;
  for (const s of legSources || []) {
    total++;
    if (s.exact) exactCount++;
    const c = s.confidence || 'low';
    if (CONF_RANK[c] < CONF_RANK[worst]) worst = c;
  }
  return { level: total ? worst : 'low', exactLegs: exactCount, legs: total,
           allExact: total > 0 && exactCount === total };
}

/* ---- clock helpers -------------------------------------------------------------------- */
// "HH:MM" -> minutes since midnight, or null. Operators publish 24:15 / 25:30 for after-midnight
// departures, which is a real convention and not an error — 24:15 means 00:15 the next day.
function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim());
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  if (mm > 59) return null;
  return h * 60 + mm;                       // deliberately NOT %1440: 24:15 stays 1455
}
function minToHHMM(min) {
  const m = Math.round(((min % 1440) + 1440) % 1440);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
/* Comparing a departure to "now" has to survive midnight. A service running 06:00-00:30 has
   departures at 1440+ in operator notation; a traveller at 00:10 is at minute 10. Lift the
   traveller onto the same day-line before comparing, never the other way round. */
function sameDayLine(afterMin, times) {
  if (!times.length) return afterMin;
  const late = times[times.length - 1];
  // if the service runs past midnight and the traveller is in those small hours, they are on
  // the PREVIOUS service day
  if (late >= 1440 && afterMin < (late - 1440) + 1) return afterMin + 1440;
  return afterMin;
}
/* ==TIMING-PURE-END== */

/* ---- day type ------------------------------------------------------------------------- */
/* Istanbul bus timetables are published per day type, so the right column has to be picked
   before any bus time means anything. istDayType() already exists in the assistant for the
   same reason; this is the one the engine uses, and both read the same clock. */
function depDayType(atMin) {
  try {
    const d = new Date();
    // a plan for 25:30 is still "tonight", so do not roll the weekday over for after-midnight
    const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', weekday: 'short' })
      .format(d);
    if (/Sat/i.test(wd)) return 'sat';
    if (/Sun/i.test(wd)) return 'sun';
    return 'wd';
  } catch (e) { return 'wd'; }
}

/* ---- tier 4: exact published timetables ------------------------------------------------
   Filled by warmTimetables() and by the station panel, which was already fetching this data
   for its own board while the planner ignored it. One store, so both agree. */
const TT_STORE = Object.create(null);           // "stationId|dirId" -> [minOfDay, …] ascending
const TT_BY_STATION = Object.create(null);      // stationId -> [dirId, …]
const TT_DIR = Object.create(null);             // "stationId|dirId" -> { name, towards }
function ttKey(stationId, dirId) { return stationId + '|' + dirId; }
function ttPut(stationId, dirId, times, dirName) {
  const mins = (times || []).map(hhmmToMin).filter(v => v != null).sort((a, b) => a - b);
  TT_STORE[ttKey(stationId, dirId)] = mins;
  if (dirName) TT_DIR[ttKey(stationId, dirId)] = { name: dirName, towards: dirTerminus(dirName) };
  const list = TT_BY_STATION[stationId] || (TT_BY_STATION[stationId] = []);
  if (list.indexOf(dirId) < 0) list.push(dirId);
  return mins;
}
function ttHas(stationId) { return !!(TT_BY_STATION[stationId] || []).length; }
/* The operator names a direction by its endpoints — "Yenikapı->Hacıosman". The half after the
   arrow is where those trains are going, which is the only part a traveller's direction can be
   matched against. */
function dirTerminus(name) {
  return String(name || '').split(/->|→|-&gt;/).pop().trim();
}
/* Coordinates for a station named anywhere in the network, or null. The operator names a
   direction after its terminus, and that terminus is not always a station this project holds on
   that line — the operator's M1B runs "to Kirazlı" while this project's M1B ends at Bağcılar
   Meydan, and Kirazlı appears only on M3. A place still has a position even when it is filed
   under a different line, and a position is all the direction test needs. */
function stationCoordsByName(name) {
  if (!name || typeof nameNodes === 'undefined') return null;
  const keys = nameNodes[fold(name)];
  if (keys && keys.length) {
    const m = nodeMeta[keys[0]];
    if (m && m.lat != null) return { lat: m.lat, lng: m.lng };
  }
  return null;
}

/* Where a named station sits along a line, or -1. Folded and tolerant, because the operator and
   this project do not always spell a station identically. */
function stationIndexOnLine(ref, name) {
  const ln = (typeof lineByRef !== 'undefined') ? lineByRef[ref] : null;
  const sts = ln && (ln.stations || ln.stops);
  if (!sts || !name) return -1;
  const want = fold(name);
  for (let i = 0; i < sts.length; i++) {
    const n = fold(sts[i] && sts[i].name);
    if (n && (n === want || n.indexOf(want) >= 0 || want.indexOf(n) >= 0)) return i;
  }
  return -1;
}

/* Does this direction carry someone travelling from fromIdx to toIdx?

   Matching the operator's direction name against OUR terminus name looked obvious and was
   wrong: M1B runs to "Kirazlı" in the operator's timetable and to "Bağcılar Meydan" in this
   project's line data, so every leg on it was silently rejected. The reliable comparison is
   positional — find where the operator's named terminus sits on the line, and ask whether it
   lies beyond the alighting station in the direction being travelled. Names only decide which
   station is meant, never which way the train goes.

   Falls back to name equality, and finally to accepting the direction: an unknown direction
   must not be excluded, or a station the operator describes unusually loses its timetable. */
/* Assemble the direction context a caller implied. Kept in one place so departureInfo and
   legArrival cannot drift apart about what "the traveller's direction" means. */
function dirCtxOf(ref, o) {
  if (!o) return null;
  if (o.towards == null && o.fromIdx == null && o.toLat == null) return null;
  return { ref: ref, towards: o.towards, fromIdx: o.fromIdx, toIdx: o.toIdx,
           fromLat: o.fromLat != null ? o.fromLat : o.lat,
           fromLng: o.fromLng != null ? o.fromLng : o.lng,
           toLat: o.toLat, toLng: o.toLng };
}
function dirServes(stationId, dirId, ctx) {
  if (!ctx) return true;
  const d = TT_DIR[ttKey(stationId, dirId)];
  if (!d || !d.towards) return true;               // unknown direction: do not silently exclude it

  // 1. positional: the terminus is on this line, so ask which side of the journey it lies
  if (ctx.ref && ctx.fromIdx != null && ctx.toIdx != null) {
    const ti = stationIndexOnLine(ctx.ref, d.towards);
    if (ti >= 0) {
      return (ctx.toIdx >= ctx.fromIdx) ? (ti >= ctx.toIdx) : (ti <= ctx.toIdx);
    }
  }
  /* 2. geometric: the terminus is somewhere this project knows, just not on this line's station
     list. Trains headed for it are going the traveller's way when it lies nearer the alighting
     station than the boarding one. This is what rescues M1B, where the operator's "Kirazlı" is
     filed under M3 and matches neither our terminus name nor our station order. */
  if (ctx.fromLat != null && ctx.toLat != null) {
    const c = stationCoordsByName(d.towards);
    if (c) {
      const dFrom = metersBetween([c.lat, c.lng], [ctx.fromLat, ctx.fromLng]);
      const dTo   = metersBetween([c.lat, c.lng], [ctx.toLat, ctx.toLng]);
      return dTo < dFrom;
    }
  }
  // 3. the operator and this project happen to agree on the terminus name
  if (!ctx.towards) return true;
  const a = fold(d.towards), b = fold(ctx.towards);
  return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

/* Resolve a station NAME on a given line to the operator's own station id. The registry is
   MI_STATIONS = [stationId, lineId, ref, lat, lng, name]; matching on coordinates rather than
   name avoids the transliteration traps that plague Turkish station names. */
function miStationFor(ref, lat, lng, maxM) {
  let best = null, bd = Infinity;
  for (const s of (typeof MI_STATIONS !== 'undefined' ? MI_STATIONS : [])) {
    if (s[2] !== ref) continue;
    const d = metersBetween([lat, lng], [s[3], s[4]]);
    if (d < bd) { bd = d; best = s; }
  }
  return (best && bd <= (maxM || 450)) ? best : null;
}

/* ---- the oracle ------------------------------------------------------------------------
   Returns the best available answer for "line REF at this point, after this minute".

     { source, confidence, exact, headwayMin,
       times:   [minOfDay…] | null      only when exact
       next:    minOfDay | null         the specific next departure, when known
       waitMin: number                  minutes to wait: measured if exact, expected if not
       reason:  null | 'after_last' | 'closed' }

   waitMin for a frequency tier is HALF the headway. That is the expected value for a
   passenger arriving at an unknown moment in the cycle, which is exactly the situation when
   no timetable is known — and it is an expectation, never a promise, which is why `exact`
   is false and the confidence travels with it.
*/
function departureInfo(ref, opts) {
  opts = opts || {};
  const afterMin = (opts.afterMin != null) ? opts.afterMin : nowIstanbulMin();
  const isBus = !!opts.bus;

  /* A suspension is a real closure and outranks everything, including a timetable that was
     printed before the line broke. */
  const closed = (typeof lineClosedAt === 'function') ? lineClosedAt(ref, afterMin) : null;
  if (closed && closed.why === 'susp') {
    /* 'confidence' rates a DEPARTURE TIME, and a shut line has none — so it is low, even
       though the closure itself is known perfectly well. Rating it high let a journey whose
       line was not running still report "times from published timetables", because the
       journey takes the minimum across legs and this leg claimed to be the strongest. The
       closure is carried by reason and closed, which is where certainty about it belongs. */
    return { source: 'modeDefault', confidence: 'low', exact: false, headwayMin: null,
             times: null, next: null, waitMin: null, reason: 'closed', closed };
  }

  /* tier 4 — exact clock times for this station and direction.
     Checked BEFORE the operating-hours string, because that string is this project's summary
     ("06:00 – 00:00") while the timetable is the operator's own answer. M2 at Yenikapı really
     does publish 01:00, 02:00 and 03:00 departures — weekend night service the summary flattens
     away. Where the two disagree the operator wins; the summary is only used when nothing
     better is held. */
  if (!isBus && opts.lat != null && opts.lng != null) {
    const st = miStationFor(ref, opts.lat, opts.lng);
    if (st && ttHas(st[0])) {
      let best = null, bestTimes = null, anyTimes = null;
      for (const dirId of TT_BY_STATION[st[0]]) {
        /* Only trains going the traveller's way. Without this the oracle returns whichever
           train comes first at the platform regardless of where it is headed — at a mid-line
           station that is the wrong one half the time, and it would quote a confident
           departure for a journey in the opposite direction. */
        if (!dirServes(st[0], dirId, dirCtxOf(ref, opts))) continue;
        const times = TT_STORE[ttKey(st[0], dirId)] || [];
        if (!times.length) continue;
        anyTimes = anyTimes || times;
        const t0 = sameDayLine(afterMin, times);
        let nxt = times.find(v => v >= t0);
        /* Past the last departure of the clock day, the next one is the first of tomorrow.
           The operator publishes a recurring daily set — 00:20 … 23:47 — so a traveller at
           23:55 is not stranded, they catch the 00:20. Without this wrap the engine reports
           "after_last" every night and the app looks shut when it is not. */
        if (nxt == null) nxt = times[0] + 1440;
        if (best == null || nxt < best) { best = nxt; bestTimes = times; }
      }
      if (best != null) {
        const t0 = sameDayLine(afterMin, bestTimes);
        const wait = Math.max(0, best - t0);
        /* A wrap that lands more than a few hours out means the service really has stopped for
           the night; report that rather than "your train is in 7 hours". */
        if (wait > 240) {
          return { source: 'timetable', confidence: 'high', exact: true, headwayMin: medianGap(bestTimes),
                   times: bestTimes, next: best, waitMin: wait, reason: 'after_last' };
        }
        return { source: 'timetable', confidence: 'high', exact: true,
                 headwayMin: medianGap(bestTimes), times: bestTimes, next: best,
                 waitMin: wait, reason: null };
      }
    }
  }

  // no exact timetable here — now the published operating hours are the best guard available
  if (closed) {
    /* 'confidence' rates a DEPARTURE TIME, and a shut line has none — so it is low, even
       though the closure itself is known perfectly well. Rating it high let a journey whose
       line was not running still report "times from published timetables", because the
       journey takes the minimum across legs and this leg claimed to be the strongest. The
       closure is carried by reason and closed, which is where certainty about it belongs. */
    return { source: 'modeDefault', confidence: 'low', exact: false, headwayMin: null,
             times: null, next: null, waitMin: null, reason: 'closed', closed };
  }

  /* tier 3 — operator first/last/headway (buses) */
  if (isBus && typeof BUS_SCHED !== 'undefined' && BUS_SCHED[ref]) {
    const day = depDayType(afterMin);
    let bestWait = Infinity, bestNext = null, hw = null, ended = false;
    for (const d of BUS_SCHED[ref]) {
      const col = d && d[day];
      if (!col || !col.first || !col.hw) continue;
      const first = hhmmToMin(col.first), last = hhmmToMin(col.last);
      if (first == null) continue;
      const t0 = (last != null && last >= 1440 && afterMin < (last - 1440) + 1)
        ? afterMin + 1440 : afterMin;
      let next;
      if (t0 <= first) next = first;
      else next = first + Math.ceil((t0 - first) / col.hw) * col.hw;
      if (last != null && next > last) { ended = true; continue; }
      const w = next - t0;
      if (w < bestWait) { bestWait = w; bestNext = next; hw = col.hw; }
    }
    if (bestNext != null) {
      /* An operator headway is a PLANNED interval, not a departure board. The vehicle that
         should leave at 07:20 is a real scheduled trip, so this is exact enough to reason
         about catching it — but it is a plan, not an observation, which is what separates it
         from a live feed the app does not have. */
      return { source: 'operator', confidence: 'high', exact: true, headwayMin: hw,
               times: null, next: bestNext, waitMin: Math.max(0, bestWait), reason: null };
    }
    if (ended) {
      return { source: 'operator', confidence: 'high', exact: true, headwayMin: null,
               times: null, next: null, waitMin: null, reason: 'after_last' };
    }
  }

  /* tier 2 — a published frequency range */
  const lt = (typeof lineTiming === 'function') ? lineTiming(ref) : null;
  const known = !isBus && typeof LINE_TIMING !== 'undefined' && LINE_TIMING[ref];
  if (lt && lt.hwMin) {
    return { source: known ? 'published' : 'modeDefault',
             confidence: known ? 'medium' : 'low',
             exact: false, headwayMin: lt.hwMin, times: null, next: null,
             waitMin: expectedWaitFor(lt.hwMin), reason: null };
  }

  /* tier 1 — nothing better than the mode's assumption */
  const hwFallback = (typeof busHeadway === 'function' && isBus && busHeadway(ref)) || 10;
  return { source: 'modeDefault', confidence: 'low', exact: false, headwayMin: hwFallback,
           times: null, next: null, waitMin: expectedWaitFor(hwFallback), reason: null };
}

/* ---- transfer feasibility --------------------------------------------------------------
   The question the old planner could not ask. It charged half a headway at every change and
   moved on, so a change was never impossible and never tight — every transfer looked alike.

     arrival + walk across the interchange + a buffer = the minute you can be on the platform

   Compare that to the next departure and the answer is arithmetic. What must NOT happen is
   inventing the parts: the walk is measured from the two nodes' real coordinates, and the
   buffer is a function of how many lines meet at that station, which is counted, not guessed.

   There is deliberately NO historical-reliability term. This project holds no delay history
   for any Istanbul line, and a "reliability score" derived from nothing would be the most
   confident-looking fabrication in the app. `basis` says so explicitly.
*/
function interchangeSize(stationName) {
  if (!stationName || typeof nameNodes === 'undefined') return 1;
  const keys = nameNodes[fold(stationName)] || [];
  const refs = new Set();
  for (const k of keys) { const m = nodeMeta[k]; if (m && m.ref) refs.add(m.ref); }
  return Math.max(1, refs.size);
}
function transferBuffer(stationName) {
  return bufferForLines(interchangeSize(stationName));
}

/* from/to carry {lat,lng,ref,bus,name}; arriveMin is when the first vehicle puts you down.
   opts.arrivalExact says whether that minute came from a timetable or was estimated.

   That flag decides whether "you will miss this train" may be said at all. The arriving leg's
   duration is currently a scaled share of the router's static path cost, so an arrival minute
   is an estimate with minutes of slop in it — and a slack of −0.1 against an estimate is noise,
   not a missed connection. Announcing one would be the same overconfidence as the arrivals
   board's old second-by-second countdown, merely pointed in the other direction. So while the
   arrival is estimated the verdict is capped at 'risky': the traveller is told the change is
   very tight, which is true and useful, and is not told a specific train has gone, which is
   not knowable yet. Trip-matching each leg against the alighting station's own timetable is
   what would lift the cap. */
function checkTransfer(arriveMin, from, to, opts) {
  const arrivalExact = !!(opts && opts.arrivalExact);
  const walkM = (from && to && from.lat != null && to.lat != null)
    ? metersBetween([from.lat, from.lng], [to.lat, to.lng]) : 0;
  const walkMin = walkM / (typeof WALK !== 'undefined' ? WALK : 80);
  const buffer = transferBuffer((to && to.name) || (from && from.name));
  const readyMin = arriveMin + walkMin + buffer;

  /* The connection under test is the one a traveller would AIM for: the first departure after
     they step off the arriving vehicle. Asking instead for the first departure after they can
     physically reach the platform would make the answer vacuous — that one is always catchable
     by construction, and "infeasible" could never occur. The whole question is whether the
     obvious connection survives the walk. */
  const aim = departureInfo(to.ref, { afterMin: arriveMin, bus: !!to.bus, lat: to.lat, lng: to.lng,
                                     towards: to.towards, fromIdx: to.fromIdx, toIdx: to.toIdx,
                                     toLat: to.toLat, toLng: to.toLng });

  const out = {
    walkM: Math.round(walkM), walkMin, bufferMin: buffer, readyMin,
    source: aim.source, confidence: aim.confidence, reason: aim.reason,
    lines: interchangeSize((to && to.name) || ''),
    basis: 'slack',                       // never 'history' — none is held, see the note above
  };

  if (aim.reason === 'closed') {
    return Object.assign(out, { verdict: 'closed', departMin: null, slackMin: null,
                                waitMin: null, closed: aim.closed });
  }
  if (aim.reason === 'after_last') {
    return Object.assign(out, { verdict: 'after_last', departMin: null, slackMin: null, waitMin: null });
  }

  /* Without a specific departure there is nothing to miss. Saying "tight" would imply a
     vehicle we cannot see; the honest answer is the expected wait and no verdict at all. */
  if (!aim.exact || aim.next == null) {
    return Object.assign(out, { verdict: 'frequency', departMin: null, slackMin: null,
                                waitMin: aim.waitMin, headwayMin: aim.headwayMin });
  }

  const slack = aim.next - readyMin;
  out.arrivalExact = arrivalExact;

  if (slack < 0 && arrivalExact) {
    // both times are known, so this is a fact: the obvious connection goes without you
    const actual = departureInfo(to.ref, { afterMin: readyMin, bus: !!to.bus, lat: to.lat, lng: to.lng,
                                      towards: to.towards, fromIdx: to.fromIdx, toIdx: to.toIdx,
                                     toLat: to.toLat, toLng: to.toLng });
    return Object.assign(out, {
      verdict: 'infeasible', missedMin: aim.next, slackMin: slack,
      departMin: (actual.exact && actual.next != null) ? actual.next : null,
      waitMin: (actual.exact && actual.next != null) ? Math.max(0, actual.next - arriveMin) : null,
      headwayMin: aim.headwayMin,
    });
  }
  if (slack < 0) {
    /* Estimated arrival: the change is very tight and the plan takes the following departure,
       but no claim is made about which vehicle was missed. */
    const actual = departureInfo(to.ref, { afterMin: readyMin, bus: !!to.bus, lat: to.lat, lng: to.lng,
                                      towards: to.towards, fromIdx: to.fromIdx, toIdx: to.toIdx,
                                     toLat: to.toLat, toLng: to.toLng });
    return Object.assign(out, {
      verdict: 'risky', capped: true, slackMin: slack,
      departMin: (actual.exact && actual.next != null) ? actual.next : aim.next,
      waitMin: (actual.exact && actual.next != null) ? Math.max(0, actual.next - arriveMin) : null,
      headwayMin: aim.headwayMin,
    });
  }
  return Object.assign(out, {
    verdict: verdictForSlack(slack), departMin: aim.next, slackMin: slack,
    waitMin: Math.max(0, aim.next - arriveMin), headwayMin: aim.headwayMin,
  });
}

/* ---- a leg's arrival, from the operator rather than from a speed assumption ---------------
   Returns null whenever the answer would be a guess — no timetable at either end, no direction
   that carries this traveller, a headway too tight to disambiguate, or sequences that simply do
   not agree. Null is the normal case for most of the network and is not a failure: the caller
   keeps its estimate and the journey stays labelled as estimated.

   hintMin is the independent physical estimate (distance and commercial speed) that pins which
   of the aliased offsets is the real one. Without it this cannot be done safely at all. */
function legArrival(ref, fromPt, toPt, dirOpts, boardMin, hintMin) {
  if (!(hintMin > 0)) return null;
  const A = miStationFor(ref, fromPt.lat, fromPt.lng);
  const B = miStationFor(ref, toPt.lat, toPt.lng);
  if (!A || !B || A[0] === B[0]) return null;
  if (!ttHas(A[0]) || !ttHas(B[0])) return null;
  const ctx = dirCtxOf(ref, Object.assign({}, dirOpts, {
    fromLat: fromPt.lat, fromLng: fromPt.lng, toLat: toPt.lat, toLng: toPt.lng }));

  /* The departure sequence at each end for the direction this traveller is going. At a TERMINUS
     there is no such sequence in the arriving direction — an operator publishes departures out
     of a terminus, never arrivals into it — so a leg that ends at one declines here. That is a
     property of the published data, not a gap to paper over. */
  const seqFor = (st) => {
    for (const dirId of TT_BY_STATION[st[0]]) {
      if (!dirServes(st[0], dirId, ctx)) continue;
      const times = TT_STORE[ttKey(st[0], dirId)];
      if (times && times.length) return times;
    }
    return null;
  };
  const ta = seqFor(A), tb = seqFor(B);
  if (!ta || !tb) return null;

  /* The window must be narrower than one headway or the aliases are indistinguishable. If the
     line is frequent enough that this leaves no usable window, decline. */
  const hw = medianGap(ta) || medianGap(tb) || 5;
  const tol = Math.min(hw * 0.45, Math.max(1.5, hintMin * 0.35));
  if (!(tol >= 0.75)) return null;

  const al = alignOffset(ta, tb, hintMin, tol);
  if (!al) return null;
  return { arrivalMin: boardMin + al.offset, runMin: al.offset,
           support: al.support, headwayMin: hw };
}

/* If a connection cannot be made, the useful answer is the one that can. Walks the exact
   departures forward until one clears the platform-ready minute. */
function nextFeasibleDeparture(readyMin, to) {
  const dep = departureInfo(to.ref, { afterMin: readyMin, bus: !!to.bus, lat: to.lat, lng: to.lng,
                                      towards: to.towards, fromIdx: to.fromIdx, toIdx: to.toIdx,
                                     toLat: to.toLat, toLng: to.toLng });
  return (dep.exact && dep.next != null) ? dep.next : null;
}

/* ---- warming the exact timetables ------------------------------------------------------
   The only part of this file that touches the network. Deliberately separate: everything
   above answers instantly from what is already known, this upgrades what is known. Callers
   await it and then re-render, so an itinerary shows an honest tier-2 estimate immediately
   and sharpens to exact times a moment later rather than blocking on a fetch that may fail.

   miPost/miDirCache live in the station panel, which owned this fetch first; this reuses them
   rather than opening a second path to the same API. */
async function warmTimetables(points, timeoutMs) {
  if (typeof miPost !== 'function' || typeof MI_STATIONS === 'undefined') return 0;
  const deadline = Date.now() + (timeoutMs || 8000);
  let added = 0;

  /* Distinct stations only. A journey names its boarding and alighting points separately but
     they are frequently the same interchange, and every leg of a two-change trip would
     otherwise re-ask for a station already held. */
  const want = [];
  const seen = new Set();
  for (const p of (points || [])) {
    if (!p || p.bus || p.lat == null) continue;
    const st = miStationFor(p.ref, p.lat, p.lng);
    if (!st || ttHas(st[0]) || seen.has(st[0])) continue;
    seen.add(st[0]); want.push(st);
  }
  if (!want.length) return 0;

  const one = async (st) => {
    if (Date.now() > deadline) return;
    try {
      const dkey = 'd' + st[1] + '_' + st[0];
      if (!miDirCache[dkey]) {
        miDirCache[dkey] = ((await miPost('/GetDirectionsByLineIdAndStationId',
          { lineId: st[1], stationId: st[0] })).Data) || [];
      }
      // both directions at once: they are independent requests and waiting for one to finish
      // before starting the other doubled the time a station took for no reason
      await Promise.all((miDirCache[dkey] || []).map(async (d) => {
        if (Date.now() > deadline) return;
        const tt = await miPost('/GetTimeTable',
          { boardingStationId: st[0], directionId: d.DirectionId });
        const row = (tt.Data && tt.Data[0]) || {};
        const ti = row.TimeInfos;
        const times = (Array.isArray(ti) ? (ti[0] && ti[0].Times) : (ti && ti.Times)) || [];
        if (times.length) { ttPut(st[0], d.DirectionId, times, d.DirectionName); added++; }
      }));
    } catch (e) { /* one station's API hiccup must not cost the whole journey its timing */ }
  };

  /* Stations in parallel, bounded. Sequentially a four-station journey ran past the budget and
     the alighting stations were the ones dropped — which is precisely the half that makes an
     arrival exact, so trip matching almost never fired. Bounded rather than unbounded out of
     courtesy to a public API this project does not pay for. */
  const POOL = 4;
  const queue = want.slice();
  await Promise.all(Array.from({ length: Math.min(POOL, queue.length) }, async () => {
    while (queue.length) {
      if (Date.now() > deadline) return;
      await one(queue.shift());
    }
  }));
  return added;
}
