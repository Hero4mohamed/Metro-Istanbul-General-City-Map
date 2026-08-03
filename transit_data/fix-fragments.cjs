// Repair badly fragmented line geometry (drawn as many disconnected pieces, which reads as a
// "broken" line on the map). İZBAN's relation carries BOTH track directions as separate ways,
// which stitched into 42 chains totalling 154.7 km for a ~136 km railway — i.e. overlapping
// duplicates plus gaps. This re-stitches with a larger tolerance and then drops any chain that
// merely runs alongside one already kept, so the line draws as a few clean continuous paths.
// Run after process-city.cjs / process-city-extra.cjs. Idempotent.
const fs = require('fs'); const path = require('path');
const DIR = __dirname;
const Rm = 6371000, toRad = d => d * Math.PI / 180;
function meters(a, b) {
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]), la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * Rm * Math.asin(Math.sqrt(h));
}
const chainLen = c => { let s = 0; for (let i = 1; i < c.length; i++) s += meters(c[i - 1], c[i]); return s; };
function stitch(chains, tol) {
  let ch = chains.map(c => c.slice()), merged = 1;
  while (merged) {
    merged = 0;
    for (let i = 0; i < ch.length && !merged; i++) for (let j = i + 1; j < ch.length; j++) {
      const A = ch[i], B = ch[j], a0 = A[0], a1 = A[A.length - 1], b0 = B[0], b1 = B[B.length - 1];
      let nc = null;
      if (meters(a1, b0) < tol) nc = A.concat(B.slice(1));
      else if (meters(a1, b1) < tol) nc = A.concat(B.slice().reverse().slice(1));
      else if (meters(a0, b1) < tol) nc = B.concat(A.slice(1));
      else if (meters(a0, b0) < tol) nc = B.slice().reverse().concat(A.slice(1));
      if (nc) { ch[i] = nc; ch.splice(j, 1); merged = 1; break; }
    }
  }
  return ch;
}
// distance from a point to a polyline
function distTo(poly, p) {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const d = meters(p, [a[0] + dx * t, a[1] + dy * t]);
    if (d < best) best = d;
  }
  return best;
}
// a chain that is ~entirely within `tol` of chains already kept is the parallel/opposite track
function isDuplicate(cand, kept, tol) {
  if (!kept.length) return false;
  let near = 0, n = 0;
  const step = Math.max(1, Math.floor(cand.length / 40));
  for (let i = 0; i < cand.length; i += step) {
    n++;
    if (kept.some(k => distTo(k, cand[i]) < tol)) near++;
  }
  return n > 0 && near / n >= 0.85;
}

const TARGETS = [['izmir-lines.json', 3]];      // [file, only repair lines with more paths than this]
for (const [file, minPaths] of TARGETS) {
  const p = path.join(DIR, file);
  const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
  let changed = 0;
  for (const l of arr) {
    if (!l.paths || l.paths.length <= minPaths) continue;
    const before = l.paths.length, beforeKm = l.paths.reduce((s, c) => s + chainLen(c), 0) / 1000;
    let ch = stitch(l.paths, 250).sort((a, b) => chainLen(b) - chainLen(a));
    const kept = [];
    for (const c of ch) {
      if (chainLen(c) < 200) continue;             // stray stub
      if (isDuplicate(c, kept, 45)) continue;      // the other track of the same alignment
      kept.push(c);
    }
    if (kept.length && kept.length < before) {
      l.paths = kept;
      changed++;
      console.log('  ' + l.ref.padEnd(14) + before + ' paths / ' + beforeKm.toFixed(1) + ' km  →  ' +
                  kept.length + ' paths / ' + (kept.reduce((s, c) => s + chainLen(c), 0) / 1000).toFixed(1) + ' km');
    }
  }
  if (changed) { fs.writeFileSync(p, JSON.stringify(arr)); console.log(file + ': repaired ' + changed + ' line(s)'); }
  else console.log(file + ': nothing to repair');
}
