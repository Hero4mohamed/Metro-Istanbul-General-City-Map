/* ===========================================================================
   SHARED TRACK (V4.8): two lines on the same track are drawn SIDE BY SIDE
   Where two lines run on the same track (M1A and M1B between Yenikapı and Otogar, Antalya's T1A and T1B, Bursa's B1 and B2,
   Kocaeli's T1 and T2), one used to be drawn exactly on top of the other, so the map showed one line where two run. Here each
   pair of lines is moved apart by a few SCREEN pixels, so the gap is the same at every zoom, and only where they share:
     - each line returns to its true path over 150 m where the two part (and stays apart to the end where both end together);
     - the shift is only the shortfall below a minimum gap, so zoomed in far enough for the real tracks to show apart, it is 0;
     - the two always go to opposite sides, whichever way each line's points happen to run;
     - everything drawn along a line moves with it: glow/outline, core, selection glow, disruption stripes and the trains.
   Worked out once at start-up from the line shapes; ferries are left alone (a different problem: six boats on one bay).
   Design: docs/superpowers/specs/2026-11-18-shared-track-drawing-design.md
   =========================================================================== */
/* ==SHARED-PURE-START== */
const SHARED = {
  tol: 25,        // metres: a sample this close to the other line is "on the same track" (M1A and M1B run 7-24 m apart from Yenikapı to Aksaray)
  min: 500,       // metres: a shorter touch is not a shared track (a street tram beside the metro at Zeytinburnu ran 360 m within 25 m)
  merge: 400,     // metres: two shared stretches this close are one (the tracks wander apart briefly at stations)
  taper: 150,     // metres over which a line returns to its true path where the two part
  step: 20,       // metres between samples
  gap: 1,         // px: the gap between the two lines' edges, on top of their widths
  cap: 1.5,       // a corner pushes a line out by at most this much more (miter limit)
  same: 0.5,      // metres: closer than this, the two lines are "the same coordinates"
  far: 100,       // metres: distances are only measured this far; beyond, "far"
  cell: 50,       // metres: grid cell of the nearest-segment index
  skip: { ferry: 1, intercity: 1, bus: 1 },
  /* Two branches of ONE line in one colour (M1A and M1B) are drawn as one line on their trunk, as transit maps do: side by
     side they would only make a fatter stroke of the same red. Set true to draw them apart anyway. */
  sameColour: false
};
function sharedNameKey(n){ return String(n || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim(); }
/* metres per degree, matching metersBetween (a sphere of radius R) */
function sharedKy(){ return R * Math.PI / 180; }
/* one line, ready to measure: each piece as metres [east, north] around lat0, its cumulative length, and a grid of its segments */
function sharedPrep(line, lat0){
  const ky = sharedKy(), kx = ky * Math.cos(lat0 * Math.PI / 180);
  const pieces = (line.paths || []).map(pts => {
    const xy = pts.map(q => [q[1] * kx, q[0] * ky]);
    const cum = [0];
    for(let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + metersBetween(pts[i - 1], pts[i]);
    return { pts, xy, cum };
  });
  const segs = [], grid = new Map();
  pieces.forEach(pc => {
    for(let i = 0; i < pc.xy.length - 1; i++){
      const a = pc.xy[i], b = pc.xy[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if(!len) continue;
      const id = segs.length;
      segs.push({ a, b, tx: (b[0] - a[0]) / len, ty: (b[1] - a[1]) / len });
      const x0 = Math.floor(Math.min(a[0], b[0]) / SHARED.cell), x1 = Math.floor(Math.max(a[0], b[0]) / SHARED.cell);
      const y0 = Math.floor(Math.min(a[1], b[1]) / SHARED.cell), y1 = Math.floor(Math.max(a[1], b[1]) / SHARED.cell);
      for(let x = x0; x <= x1; x++) for(let y = y0; y <= y1; y++){
        const key = x * 1e6 + y; let cell = grid.get(key);
        if(!cell) grid.set(key, cell = []);
        cell.push(id);
      }
    }
  });
  return { kx, ky, pieces, segs, grid, stamp: new Int32Array(segs.length), tick: 0 };
}
/* The nearest point of a prepared line to P [east, north]: its distance and that segment's direction. Only the 3x3 cells
   around P are searched, so anything within one cell (50 m) is always found and anything further reads as FAR: plenty to
   tell "on the same track" (25 m) and to fade the shift where two lines drift apart. */
function sharedNearest(prep, P){
  const cx = Math.floor(P[0] / SHARED.cell), cy = Math.floor(P[1] / SHARED.cell), tick = ++prep.tick;
  let best = SHARED.far, tx = 0, ty = 0, qx = 0, qy = 0, found = false;
  for(let x = cx - 1; x <= cx + 1; x++) for(let y = cy - 1; y <= cy + 1; y++){
    const cell = prep.grid.get(x * 1e6 + y); if(!cell) continue;
    for(const id of cell){
      if(prep.stamp[id] === tick) continue; prep.stamp[id] = tick;
      const sg = prep.segs[id], dx = sg.b[0] - sg.a[0], dy = sg.b[1] - sg.a[1], L2 = dx * dx + dy * dy;
      let t = L2 ? ((P[0] - sg.a[0]) * dx + (P[1] - sg.a[1]) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = sg.a[0] + t * dx, ey = sg.a[1] + t * dy, d = Math.hypot(ex - P[0], ey - P[1]);
      if(d < best || (!found && d <= best)){ best = d; tx = sg.tx; ty = sg.ty; qx = ex; qy = ey; found = true; }
    }
  }
  return { d: best, tx, ty, qx, qy, found };
}
/* every `step` metres (default STEP) along one piece of a line: where it is, which way it runs, how far the partner is */
function sharedSamples(pc, partner, step){
  const out = [], total = pc.cum[pc.cum.length - 1] || 0, by = step || SHARED.step;
  let i = 0;
  for(let s = 0; ; s += by){
    if(s > total) s = total;
    while(i < pc.cum.length - 2 && pc.cum[i + 1] < s) i++;
    const seg = (pc.cum[i + 1] - pc.cum[i]) || 1, t = Math.max(0, Math.min(1, (s - pc.cum[i]) / seg));
    const a = pc.xy[i], b = pc.xy[i + 1] || a;
    const P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / len, ty = (b[1] - a[1]) / len;
    const n = sharedNearest(partner, P);
    // cross > 0: the partner is on this line's LEFT; dot > 0: the partner runs the same way
    out.push({ s, d: n.d, cross: n.found ? Math.sign(tx * (n.qy - P[1]) - ty * (n.qx - P[0])) : 0, dot: n.found ? Math.sign(tx * n.tx + ty * n.ty) : 0 });
    if(s >= total) break;
  }
  return out;
}
/* the stretches of one piece that share track with the partner: [{b, e}] sample indexes, merged and long enough */
function sharedStretches(samples){
  const raw = []; let cur = null;
  samples.forEach((sm, k) => {
    if(sm.d > SHARED.tol) return;
    if(cur && sm.s - samples[cur.e].s <= SHARED.merge) cur.e = k;
    else { if(cur) raw.push(cur); cur = { b: k, e: k }; }
  });
  if(cur) raw.push(cur);
  return raw.filter(r => samples[r.e].s - samples[r.b].s >= SHARED.min);
}
/* Work out every shared stretch among `lines` and store it on each line as line._shared[pieceIndex] = [run, ...].
   widthOf(line) is the line's drawn width in px at full scale. Returns [{a, b, metres}] for each pair found. */
function sharedComputeAll(lines, widthOf){
  const live = (lines || []).filter(l => l && Array.isArray(l.paths) && l.paths.length && !SHARED.skip[l.kind]);
  (lines || []).forEach(l => { if(l) l._shared = null; });
  const names = live.map(l => new Set((l.stations || []).map(st => sharedNameKey(st.name))));
  const found = [], lat0 = live.length ? live[0].paths[0][0][0] : 0, preps = new Map();

  for(let i = 0; i < live.length; i++) for(let j = i + 1; j < live.length; j++){
    let common = 0;
    names[i].forEach(n => { if(names[j].has(n)) common++; });
    if(common < 2) continue;
    if(!SHARED.sameColour && live[i].color && live[j].color && String(live[i].color).toLowerCase() === String(live[j].color).toLowerCase()) continue;
    const pair = live[i].ref < live[j].ref ? [live[i], live[j]] : [live[j], live[i]];
    const metres = sharedPair(pair[0], pair[1], widthOf, sharedPrepOnce(preps, pair[0], lat0), sharedPrepOnce(preps, pair[1], lat0));
    if(metres) found.push({ a: pair[0].ref, b: pair[1].ref, metres: Math.round(metres) });
  }
  live.forEach(l => sharedKeepLongest(l));
  return found;
}
/* each line's measuring grid is built once per sharedComputeAll, the first time a pair needs it */
function sharedPrepOnce(preps, line, lat0){ let pp = preps.get(line); if(!pp) preps.set(line, pp = sharedPrep(line, lat0)); return pp; }
/* one pair: A is the line with the lower ref. Both lines get their runs; the side is decided ONCE for the pair. */
function sharedPair(A, B, widthOf, prepA, prepB){
  const lat0 = A.paths[0][0][0], pa = prepA || sharedPrep(A, lat0), pb = prepB || sharedPrep(B, lat0);
  const wPair = ((widthOf ? widthOf(A) : 4) + (widthOf ? widthOf(B) : 4)) / 2;
  /* a quick look first, every 100 m: two lines that share stations but not track (most such pairs) stop here */
  let near = 0;
  pa.pieces.forEach(pc => sharedSamples(pc, pb, 100).forEach(sm => { if(sm.d <= SHARED.tol) near++; }));
  if(near * 100 < SHARED.min / 2) return 0;
  const onA = pa.pieces.map(pc => { const sm = sharedSamples(pc, pb); return { pc, sm, st: sharedStretches(sm) }; });
  const onB = pb.pieces.map(pc => { const sm = sharedSamples(pc, pa); return { pc, sm, st: sharedStretches(sm) }; });
  let vote = 0, dot = 0, metres = 0;
  onA.forEach(o => o.st.forEach(r => { for(let k = r.b; k <= r.e; k++){ const sm = o.sm[k]; if(sm.d > SHARED.same && sm.d <= SHARED.tol) vote += sm.cross; } }));
  onB.forEach(o => o.st.forEach(r => { for(let k = r.b; k <= r.e; k++){ const sm = o.sm[k]; if(sm.d <= SHARED.tol) dot += sm.dot; } }));
  if(!onA.some(o => o.st.length) || !onB.some(o => o.st.length)) return 0;
  /* A moves away from the side B is on (to its own left when they coincide). B goes the other way in A's frame, which in
     B's own frame depends on whether B is drawn the same way as A. */
  const sideA = vote > 0 ? -1 : 1, signB = -sideA * (dot < 0 ? -1 : 1);
  metres = sharedStore(A, B.ref, onA, sideA, wPair);
  sharedStore(B, A.ref, onB, signB, wPair);
  return metres;
}
/* write a line's runs (one per shared stretch of each piece) onto line._shared; returns the metres stored */
function sharedStore(line, partner, list, sign, wPair){
  let metres = 0;
  list.forEach((o, p) => o.st.forEach(r => {
    const total = o.pc.cum[o.pc.cum.length - 1] || 0, s0 = o.sm[r.b].s, s1 = o.sm[r.e].s;
    const run = { s0, s1, sign, partner, wPair,
      noStart: s0 <= SHARED.step * 1.5, noEnd: s1 >= total - SHARED.step * 1.5,
      ss: o.sm.slice(r.b, r.e + 1).map(x => x.s), dd: o.sm.slice(r.b, r.e + 1).map(x => x.d) };
    if(!line._shared) line._shared = [];
    (line._shared[p] = line._shared[p] || []).push(run);
    metres += s1 - s0;
  }));
  return metres;
}
/* a line that shares with two partners on the same stretch keeps the longer one (three lines on one track: none on rail today) */
function sharedKeepLongest(line){
  if(!line._shared) return;
  line._shared = line._shared.map(runs => {
    if(!runs) return runs;
    const kept = [];
    runs.slice().sort((a, b) => (b.s1 - b.s0) - (a.s1 - a.s0)).forEach(r => { if(!kept.some(k => r.s0 < k.s1 && r.s1 > k.s0)) kept.push(r); });
    return kept.sort((a, b) => a.s0 - b.s0);
  });
}
/* 0..1: how much of the full shift applies at distance s along the run (the 150 m tapers) */
function sharedWeight(run, s){
  if(!run || s < run.s0 || s > run.s1) return 0;
  const T = Math.min(SHARED.taper, (run.s1 - run.s0) / 2);
  let w = 1;
  if(!run.noStart && T > 0) w = Math.min(w, (s - run.s0) / T);
  if(!run.noEnd && T > 0) w = Math.min(w, (run.s1 - s) / T);
  return Math.max(0, Math.min(1, w));
}
/* at distance s along piece p of a line: k = signed share of the shift (+ = to the line's left), d = metres to the partner */
function sharedAt(line, p, s){
  const runs = line && line._shared && line._shared[p];
  if(runs) for(const r of runs){
    if(s < r.s0 || s > r.s1) continue;
    const w = sharedWeight(r, s);
    let d = r.dd[0];
    for(let i = 1; i < r.ss.length; i++){
      if(r.ss[i] >= s){ const f = (s - r.ss[i - 1]) / ((r.ss[i] - r.ss[i - 1]) || 1); d = r.dd[i - 1] + (r.dd[i] - r.dd[i - 1]) * f; break; }
      d = r.dd[i];
    }
    return { k: w ? r.sign * w : 0, d, wPair: r.wPair };
  }
  return { k: 0, d: 0, wPair: 0 };
}
/* Web Mercator metres per pixel at a latitude and zoom (256 px tiles) */
function sharedMpp(lat, z){ return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z); }
/* the shift in px for one line: only the shortfall below the target gap, half each, signed and tapered by k */
function sharedShiftPx(k, dGeo, targetPx, mpp){
  const v = Math.max(0, (targetPx - dGeo / mpp) / 2);
  return v && k ? k * v : 0;
}
/* Move each projected point to the LEFT of the drawing direction by shifts[i] px (negative = right). On screen y points down,
   so left of (dx, dy) is (dy, -dx). Corners follow the bisector, pushed out by 1/cos(half-angle), at most CAP times. */
function sharedOffsetRing(points, shifts){
  const n = points.length, out = new Array(n);
  for(let i = 0; i < n; i++){
    const v = shifts[i] || 0, P = points[i];
    if(!v){ out[i] = { x: P.x, y: P.y }; continue; }
    let n1 = null, n2 = null;
    if(i > 0){ const dx = P.x - points[i - 1].x, dy = P.y - points[i - 1].y, L = Math.hypot(dx, dy); if(L) n1 = [dy / L, -dx / L]; }
    if(i < n - 1){ const dx = points[i + 1].x - P.x, dy = points[i + 1].y - P.y, L = Math.hypot(dx, dy); if(L) n2 = [dy / L, -dx / L]; }
    let bx, by, scale = 1;
    if(n1 && n2){
      bx = n1[0] + n2[0]; by = n1[1] + n2[1];
      const bl = Math.hypot(bx, by);
      if(bl < 1e-9){ bx = n1[0]; by = n1[1]; }
      else { bx /= bl; by /= bl; scale = Math.min(SHARED.cap, 1 / Math.max(1e-6, bx * n1[0] + by * n1[1])); }
    } else if(n1 || n2){ const m = n1 || n2; bx = m[0]; by = m[1]; }
    else { out[i] = { x: P.x, y: P.y }; continue; }
    out[i] = { x: P.x + bx * v * scale, y: P.y + by * v * scale };
  }
  return out;
}
/* distance along piece p of a line to the point nearest `latlng` */
function sharedSOnPath(line, p, latlng){
  const pts = line && line.paths && line.paths[p]; if(!pts || !pts.length || !latlng) return 0;
  const ky = sharedKy(), kx = ky * Math.cos(latlng[0] * Math.PI / 180), P = [latlng[1] * kx, latlng[0] * ky];
  let best = Infinity, bestS = 0, acc = 0;
  for(let i = 0; i < pts.length - 1; i++){
    const a = [pts[i][1] * kx, pts[i][0] * ky], b = [pts[i + 1][1] * kx, pts[i + 1][0] * ky], seg = metersBetween(pts[i], pts[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 ? ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a[0] + t * dx - P[0], a[1] + t * dy - P[1]);
    if(d < best){ best = d; bestS = acc + t * seg; }
    acc += seg;
  }
  return bestS;
}
/* What a drawn polyline needs: its points with a vertex added at every taper break-point, and per vertex the distance s,
   the signed share k, the distance d to the partner and the latitude. null when nothing along it is shared.
   sStart: where along piece p the first point sits (0 for a whole piece). */
function sharedDrawInfo(line, p, latlngs, sStart){
  const runs = line && line._shared && line._shared[p];
  if(!runs || !runs.length || !latlngs || latlngs.length < 2) return null;
  const bps = [];
  runs.forEach(r => {
    const T = Math.min(SHARED.taper, (r.s1 - r.s0) / 2);
    bps.push(r.s0, r.s1);
    if(!r.noStart) bps.push(r.s0 + T);
    if(!r.noEnd) bps.push(r.s1 - T);
  });
  bps.sort((a, b) => a - b);
  const pts = [], s = [];
  let acc = sStart || 0;
  for(let i = 0; i < latlngs.length; i++){
    pts.push(latlngs[i]); s.push(acc);
    if(i === latlngs.length - 1) break;
    const a = latlngs[i], b = latlngs[i + 1], seg = metersBetween(a, b);
    for(const bp of bps){
      if(bp > acc + 0.01 && bp < acc + seg - 0.01){
        const f = (bp - acc) / seg;
        pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); s.push(bp);
      }
    }
    acc += seg;
  }
  const at = s.map(v => sharedAt(line, p, v));
  const k = at.map(x => x.k);
  if(!k.some(x => x)) return null;
  return { pts, s, k, d: at.map(x => x.d), lat: pts.map(q => q[0]), wPair: runs[0].wPair };
}
/* the projected ring of a drawn polyline, shifted for zoom z (scale = the line-width scale at that zoom) */
function sharedProjectRing(ring, info, z, scale){
  if(!info || !ring || ring.length !== info.k.length) return ring;
  const target = info.wPair * scale + SHARED.gap;
  const shifts = info.k.map((k, i) => k ? sharedShiftPx(k, info.d[i], target, sharedMpp(info.lat[i], z)) : 0);
  if(!shifts.some(v => v)) return ring;
  return sharedOffsetRing(ring, shifts);
}
/* ==SHARED-PURE-END== */

/* ==SHARED-CORE-START== */
/* A Leaflet line that shifts its projected points before they are clipped and drawn. Leaflet re-projects on every zoom, so the
   shift is recomputed for each zoom; map turning rotates the panes afterwards, so the shift turns with the map. */
const SharedPolyline = (typeof L !== 'undefined' && L.Polyline) ? L.Polyline.extend({
  _project: function(){
    L.Polyline.prototype._project.call(this);
    const sh = this.options.irnShared;
    if(!sh || !this._map || !this._rings || this._rings.length !== 1) return;
    const z = this._map.getZoom();
    const out = sharedProjectRing(this._rings[0], sh, z, lineScale(z));
    if(out !== this._rings[0]) this._rings[0] = out.map(q => L.point(q.x, q.y));
  }
}) : null;
/* L.polyline, or the shifting kind when part of this piece of the line shares track */
function sharedPolyline(line, p, latlngs, opts, sStart){
  let info = null;
  try{ info = SharedPolyline ? sharedDrawInfo(line, p, latlngs, sStart || 0) : null; }catch(e){ info = null; }
  if(!info) return L.polyline(latlngs, opts);
  return new SharedPolyline(info.pts, Object.assign({}, opts, { irnShared: info }));
}
/* how far a train at distance s along its line moves sideways, in container px (or null) */
function sharedTrainOffset(line, s, z){
  const sh = sharedAt(line, 0, s);
  if(!sh.k) return null;
  const a = map.latLngToContainerPoint(posAt(line, Math.max(0, s - 8))), b = map.latLngToContainerPoint(posAt(line, s + 8));
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if(!len) return null;
  const v = sharedShiftPx(sh.k, sh.d, sh.wPair * lineScale(z) + SHARED.gap, sharedMpp(posAt(line, s)[0], z));
  return v ? { x: dy / len * v, y: -dx / len * v } : null;
}
try{ sharedComputeAll(liveLines, l => (KIND[l.kind] && KIND[l.kind].weight) || 4); }
catch(e){ if(typeof console !== 'undefined') console.warn('shared-track drawing skipped', e); }
/* ==SHARED-CORE-END== */
