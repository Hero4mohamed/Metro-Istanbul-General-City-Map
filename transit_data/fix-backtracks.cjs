// Repair line paths that run OUT AND BACK over themselves (found 18 Nov 2026 while building shared-track drawing).
//
// When an OpenStreetMap route carries both track directions as separate ways, stitching can join them end to end, so a
// line's path goes out along one track and comes back along the other. The map hides it (the two copies lie on top of each
// other) but everything that measures the path does not: M1A's path ran Yenikapı → towards Topkapı → back to Yenikapı → on
// to the airport (25.9 km for a ~20 km line), so its trains drove out and back first; Kocaeli's T3 ran Otogar → Kocaelispor
// → back to Otogar, so its trams travelled 8.2 km on a 4.8 km line.
//
// What it does, per path that trains run on (the FIRST path of every live line in the city files):
//   - an out-and-back at the START that then sets off again over the same ground (M1A): keep the later, complete run;
//   - an out-and-back that is the WHOLE path (T3): keep the outward half, up to the turn;
//   - anything else that doubles back is only REPORTED, for a person to look at (a real loop or spur must not be cut).
// Planned and intercity lines are reported, never changed. Idempotent: a clean path is left exactly as it is.
//
//   node transit_data/fix-backtracks.cjs           repair and write the files
//   node transit_data/fix-backtracks.cjs --check   report only, write nothing (exit 1 if anything would change)
const fs = require('fs'); const path = require('path');
const DIR = __dirname;
const CITY_FILES = ['lines.json', 'ankara-lines.json', 'izmir-lines.json', 'bursa-lines.json', 'antalya-lines.json', 'kocaeli-lines.json', 'cable-lines.json', 't6-line.json', 'b2-line.json'];
const TOL = 12, BACK = 300, STEP = 10, MIN_DOUBLE = 200;
const Rm = 6371000, toRad = d => d * Math.PI / 180;
function meters(a, b) {
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]), la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * Rm * Math.asin(Math.sqrt(h));
}
function cumOf(p) { const c = [0]; for (let i = 1; i < p.length; i++) c[i] = c[i - 1] + meters(p[i - 1], p[i]); return c; }
/* For every STEP metres along the path: if it lies within TOL of an EARLIER part of the same path (at least BACK metres
   earlier), the distance x along the path of that earlier part; otherwise null. */
function retrace(p) {
  const cum = cumOf(p), ky = Rm * Math.PI / 180, kx = ky * Math.cos(toRad(p[0][0])), xy = p.map(q => [q[1] * kx, q[0] * ky]);
  const out = [];
  for (let s = 0, i = 0; s <= cum[cum.length - 1]; s += STEP) {
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const f = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1), P = [xy[i][0] + (xy[i + 1][0] - xy[i][0]) * f, xy[i][1] + (xy[i + 1][1] - xy[i][1]) * f];
    let best = null, bd = TOL;
    for (let j = 0; j < p.length - 1 && cum[j] < s - BACK; j++) {
      const a = xy[j], b = xy[j + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      let u = L2 ? ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / L2 : 0; u = Math.max(0, Math.min(1, u));
      const x = cum[j] + u * (cum[j + 1] - cum[j]);
      if (x > s - BACK) continue;
      const d = Math.hypot(a[0] + u * dx - P[0], a[1] + u * dy - P[1]);
      if (d < bd) { bd = d; best = x; }
    }
    out.push({ s, x: best });
  }
  return { cum, out };
}
/* the vertex index nearest distance s along the path */
function idxAt(cum, s) { let k = 0; for (let i = 0; i < cum.length; i++) if (Math.abs(cum[i] - s) < Math.abs(cum[k] - s)) k = i; return k; }
/* returns { path, action } — action is null when the path is clean. stations (optional): a cut that would leave any of
   them more than 150 m from the kept path is refused and reported instead. */
function repair(p, stations) {
  const { cum, out } = retrace(p), total = cum[cum.length - 1];
  const hits = out.filter(o => o.x != null);
  if (hits.length * STEP < MIN_DOUBLE) return { path: p, action: null };
  /* the RETURN leg: the first run of hits that comes back the way it went (x falling, allowing a little noise) */
  const back = [hits[0]];
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].s - back[back.length - 1].s > BACK) break;              // a long gap: the return leg is over (short gaps are where the two tracks part briefly)
    if (hits[i].x > back[back.length - 1].x + 2 * TOL) break;          // going forwards again over old ground
    back.push(hits[i]);
  }
  const first = back[0], last = back[back.length - 1];
  const review = 'REVIEW: doubles back ' + hits.length * STEP + ' m (from ' + first.s + ' m), not changed';
  if (back.length * STEP < MIN_DOUBLE) return { path: p, action: review };
  /* the turn: the point between the matched earlier point and the first hit that is farthest from that earlier point */
  const ref = pointAt(p, cum, first.x);
  let turnK = idxAt(cum, first.x);
  for (let k = 0; k < p.length; k++) if (cum[k] >= first.x && cum[k] <= first.s && meters(p[k], ref) > meters(p[turnK], ref)) turnK = k;
  let kept = null, action = null;
  if (total - last.s <= STEP * 3) {                                    // it comes all the way back to the end: T3
    kept = p.slice(0, turnK + 1);
    action = 'kept the outward half (turned at ' + Math.round(cum[turnK]) + ' m of ' + Math.round(total) + ' m)';
  } else {                                                              // it comes back, then carries on over old ground: M1A
    const k1 = idxAt(cum, last.x), k2 = idxAt(cum, last.s);           // where the excursion left, and where it got back
    if (k2 <= k1) return { path: p, action: review };
    kept = p.slice(0, k1 + 1).concat(p.slice(k2));
    action = 'cut out an out-and-back excursion (' + Math.round(cum[k1]) + ' m to ' + Math.round(cum[k2]) + ' m of ' + Math.round(total) + ' m)';
  }
  if (stations && stations.length) {
    const near = (path, st) => path.some((q, i) => i < path.length - 1 && segDist([st.lat, st.lng], q, path[i + 1]) <= 150);
    const lost = stations.filter(st => near(p, st) && !near(kept, st));
    if (lost.length) return { path: p, action: 'REVIEW: the cut would leave ' + lost.map(s => s.name).join(', ') + ' off the line; not changed' };
  }
  return { path: kept, action };
}
function pointAt(p, cum, s) { const k = Math.max(0, Math.min(p.length - 2, cum.findIndex(c => c >= s) - 1)); const f = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1); return [p[k][0] + (p[k + 1][0] - p[k][0]) * f, p[k][1] + (p[k + 1][1] - p[k][1]) * f]; }
function segDist(P, a, b) {
  const ky = Rm * Math.PI / 180, kx = ky * Math.cos(toRad(P[0]));
  const ax = a[1] * kx, ay = a[0] * ky, bx = b[1] * kx, by = b[0] * ky, px = P[1] * kx, py = P[0] * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let u = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; u = Math.max(0, Math.min(1, u));
  return Math.hypot(ax + u * dx - px, ay + u * dy - py);
}
if (require.main === module) {
  const check = process.argv.includes('--check');
  let changes = 0;
  for (const f of CITY_FILES) {
    const file = path.join(DIR, f); if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(data)) continue;
    let touched = false;
    data.forEach(l => {
      (l.paths || []).forEach((p0, pi) => { let p = p0;
        const trainPath = l.scope !== 'planned' && l.scope !== 'intercity' && pi === 0;
        /* a path can hold more than one out-and-back: repair until nothing more changes (each pass re-checks the stations) */
        for (let pass = 0; pass < 5; pass++) {
          const r = repair(p, pi === 0 ? l.stations : null); if (!r.action) break;
          const fix = trainPath && !/^REVIEW/.test(r.action);
          console.log(f.padEnd(20), (l.ref + ' path ' + pi).padEnd(16), fix ? r.action : (/^REVIEW/.test(r.action) ? r.action : 'REVIEW (not a live train path): ' + r.action));
          if (!fix) break;
          p = l.paths[pi] = r.path; touched = true; changes++;
        }
      });
    });
    if (touched && !check) fs.writeFileSync(file, JSON.stringify(data));
  }
  console.log(changes ? (check ? changes + ' path(s) would be repaired' : changes + ' path(s) repaired') : 'no out-and-back paths to repair');
  if (check && changes) process.exit(1);
}
module.exports = { repair };
