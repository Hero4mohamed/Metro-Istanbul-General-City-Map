/* ===========================================================================
   NOTICES IN THE PLANNER (V4.9)
   The map has drawn a closed stretch (the red-and-yellow band) while the planner could still send people through it: only a line
   suspended end to end was ever avoided. Here each notice becomes STRETCHES of its line, of three kinds, and the planner treats
   each the way the owner decided (19 Nov 2026):
     - closed       the operator says trains do NOT run between A and B (or marks a section "major"): AVOIDED;
     - reduced      a shuttle, or a section that is only "affected": routable, with an amber note on the leg;
     - unmentioned  the part of the line a notice leaves out when it lists where trains run ("normal between Nurtepe and Mahmutbey,
                    a shuttle Nurtepe–Kağıthane" says nothing of Kağıthane–Yıldız): routable, with a RED warning on the leg.
   And one safety valve: when the notices are older than the stale limit the Announcements panel uses (8 h), nothing is avoided
   at all; everything is a warning instead, so a notice nobody has re-read can never block a line that has reopened.
   Design: docs/superpowers/specs/2026-11-19-v4.9-design.md
   =========================================================================== */
/* ==NOTICE-ROUTE-PURE-START== */
/* words that say trains do NOT run between two stations ("…arasında seferler yapılamamaktadır", "…durdurulmuştur", "…kapalıdır") */
const NOTICE_CLOSED_RE = /([^\s,]+)\s*[-–]\s*([^\s,]+)(?:\s+istasyonlar[ıi])?\s+arasında[^.;]{0,80}?(?:yapılamamaktadır|yapılmamaktadır|yapılamayacaktır|yapılmayacaktır|durdurulmuştur|durdurulacaktır|verilememektedir|verilmemektedir|kapalıdır|kapatılmıştır|kapatılacaktır)/gi;
const NOTICE_SHUTTLE_RE = /([^\s,]+)\s*[-–]\s*([^\s,]+)\s+arasında\s+(?:ise\s+)?mekik/i;
const NOTICE_NORMAL_RE = /([^\s,]+)\s*[-–]\s*([^\s,]+)\s+arasında\s+normal\s+işletme/i;
/* two station names in a notice → [lo, hi] station indexes along the line, or null when either is not on it */
function noticePair(stations, w1, w2){
  const a = noticeStationIndex(stations, w1), b = noticeStationIndex(stations, w2);
  return a < 0 || b < 0 || a === b ? null : [Math.min(a, b), Math.max(a, b)];
}
/* intervals [x, y] (station positions along the line) minus one interval */
function noticeCut(list, c){
  const out = [];
  for(const p of list){
    if(c[1] <= p[0] || c[0] >= p[1]){ out.push(p); continue; }
    if(c[0] > p[0]) out.push([p[0], c[0]]);
    if(c[1] < p[1]) out.push([c[1], p[1]]);
  }
  return out;
}
/* what a notice's Turkish words name, as stretches {kind, a, b} */
function noticeTextStretches(stations, text){
  if(!Array.isArray(stations) || stations.length < 2 || !text) return [];
  const t = String(text), last = stations.length - 1, out = [];
  NOTICE_CLOSED_RE.lastIndex = 0;
  for(const m of t.matchAll(NOTICE_CLOSED_RE)){ const p = noticePair(stations, m[1], m[2]); if(p) out.push({ kind: 'closed', a: p[0], b: p[1] }); }
  const sh = NOTICE_SHUTTLE_RE.exec(t), shut = sh ? noticePair(stations, sh[1], sh[2]) : null;
  if(shut) out.push({ kind: 'reduced', a: shut[0], b: shut[1] });
  const nm = NOTICE_NORMAL_RE.exec(t), normal = nm ? noticePair(stations, nm[1], nm[2]) : null;
  if(normal){
    let rest = [];
    if(normal[0] > 0) rest.push([0, normal[0]]);
    if(normal[1] < last) rest.push([normal[1], last]);
    out.forEach(s => { rest = noticeCut(rest, [s.a, s.b]); });          // what is closed or a shuttle is that, not "unmentioned"
    rest.forEach(p => out.push({ kind: 'unmentioned', a: p[0], b: p[1] }));
  }
  return out;
}
/* a notice → stretches of its line: a "segment" notice names its two ends; otherwise its words are read */
function noticeStretches(stations, d){
  if(!d || !Array.isArray(stations)) return [];
  if(d.scope === 'segment' && d.from && d.to){
    const p = noticePair(stations, d.from, d.to);
    return p ? [{ kind: d.severity === 'major' ? 'closed' : 'reduced', a: p[0], b: p[1] }] : [];
  }
  return d.messageTr ? noticeTextStretches(stations, d.messageTr) : [];
}
/* What the planner must do about a set of notices. lineOf(ref) → the line (its stations), or null; stale: the notices are old.
   Returns lines to avoid end to end, station nodes ('REF#index') to avoid, track to avoid ('node>node', both ways), what was
   avoided (to say so) and the warnings (to put on the legs). */
function noticeRouting(notices, lineOf, stale){
  const lines = [], nodes = [], edges = [], avoided = [], warn = [];
  for(const d of notices || []){
    if(!d || !d.ref || d.mode === 'bus') continue;
    const line = lineOf(d.ref); if(!line || !Array.isArray(line.stations)) continue;
    if(d.scope === 'line' && d.severity === 'major'){
      if(stale) warn.push({ d: d, ref: d.ref, kind: 'lineStale', a: 0, b: line.stations.length - 1 });
      else { lines.push(d.ref); avoided.push({ d: d, ref: d.ref, a: 0, b: line.stations.length - 1, line: true }); }
      continue;
    }
    const last = line.stations.length - 1;
    for(const s of noticeStretches(line.stations, d)){
      if(s.kind !== 'closed'){ warn.push({ d: d, ref: d.ref, kind: s.kind, a: s.a, b: s.b }); continue; }
      if(stale){ warn.push({ d: d, ref: d.ref, kind: 'closedStale', a: s.a, b: s.b }); continue; }
      avoided.push({ d: d, ref: d.ref, a: s.a, b: s.b });
      for(let k = s.a + 1; k < s.b; k++) nodes.push(d.ref + '#' + k);   // inside: cannot board, alight or pass
      if(s.a === 0) nodes.push(d.ref + '#0');                              // an end of the LINE inside the stretch: nothing reaches it
      if(s.b === last) nodes.push(d.ref + '#' + last);
      for(let k = s.a; k < s.b; k++){ edges.push(d.ref + '#' + k + '>' + d.ref + '#' + (k + 1), d.ref + '#' + (k + 1) + '>' + d.ref + '#' + k); }
    }
  }
  return { lines: lines, nodes: nodes, edges: edges, avoided: avoided, warn: warn };
}
/* the warnings a leg rides through: same line, and the leg covers part of the stretch (ending at its edge is not riding it) */
function stretchHits(warn, ref, fromIdx, toIdx){
  if(fromIdx == null || toIdx == null) return [];
  const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx);
  return (warn || []).filter(w => w.ref === ref && Math.max(lo, w.a) < Math.min(hi, w.b));
}
/* ==NOTICE-ROUTE-PURE-END== */

/* are the rail notices older than the stale limit of the Announcements panel? (unknown age: not stale) */
function noticesStale(){
  try{ const a = annAges(Date.now()); return !!(a && a.rail && a.rail.stale); }catch(e){ return false; }
}
/* the planner's view of the notices now, as Sets (built on every search: a handful of notices, so it costs nothing) */
function noticeRoutingNow(){
  let r;
  try{ r = noticeRouting(activeDisruptions(), ref => lineByRef[ref], noticesStale()); }
  catch(e){ r = { lines: [], nodes: [], edges: [], avoided: [], warn: [] }; }
  return { lines: new Set(r.lines), nodes: new Set(r.nodes), edges: new Set(r.edges), avoided: r.avoided, warn: r.warn };
}
