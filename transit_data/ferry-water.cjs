'use strict';
/* Keeps every ferry line on the water the map draws, and makes lines that share a stretch of sea share ONE path (V4.4.1).
 *
 * What was wrong: each ferry line carried its own geometry (an OpenStreetMap relation, or a spline through its piers pushed off the
 * coast by a nearest-coastline test). Eleven of the thirteen İstanbul lines touched land somewhere (Moda, Sarayburnu, the islands,
 * the Bosphorus headlands); lines between the same places ran side by side as separate dotted lines; and a pier served by five lines
 * was five dots, because each line had its own coordinate for it. Around Kadıköy that read as a tangle.
 *
 * What this does, from water-mask.json (the sea exactly as the base map draws it, ~15 m cells) and nothing else:
 *   1. one position per pier: same-named stops of a city's ferry lines within 700 m of each other become one point;
 *   2. every hop between two consecutive piers is routed over water cells (A*), keeping off the shore where there is room and
 *      preferring water another line already uses, so lines gather into shared lanes instead of running in parallel;
 *   3. the union of all routes is cut into stretches between junctions; each stretch is straightened and rounded ONCE, and every
 *      line that uses it gets the very same points, so shared lanes overlap exactly.
 * It runs in the build (build.cjs), needs no network, and is deterministic. test/ferry.test.cjs measures the result against the mask.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const R = 6371000, rad = d => d * Math.PI / 180;
const metres = (a, b) => { const x = rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), y = rad(b[0] - a[0]); return Math.hypot(x, y) * R; };

/** one region of water-mask.json as a grid with lat/lng <-> cell conversion */
function openRegion(reg) {
  const packed = zlib.gunzipSync(Buffer.from(reg.bits, 'base64'));
  const W = reg.width, H = reg.height, n = 2 ** reg.z;
  const water = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) water[i] = (packed[i >> 3] >> (i & 7)) & 1;
  const fx = lng => ((lng + 180) / 360 * n - reg.x0) * reg.px;
  const fy = lat => { const r = rad(lat); return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n - reg.y0) * reg.px; };
  const lng = x => (x / reg.px + reg.x0) / n * 360 - 180;
  const lat = y => { const t = Math.PI * (1 - 2 * (y / reg.px + reg.y0) / n); return Math.atan(Math.sinh(t)) * 180 / Math.PI; };
  const cellM = 40075016.686 * Math.cos(rad(lat(H / 2))) / n / reg.px;       // metres across one cell
  const isWater = (la, ln) => { const c = Math.floor(fx(ln)), r = Math.floor(fy(la)); return c >= 0 && r >= 0 && c < W && r < H ? water[r * W + c] === 1 : null; };
  return { W, H, water, fx, fy, lng, lat, cellM, isWater };
}
function loadMask(file) {
  const j = JSON.parse(fs.readFileSync(file || path.join(__dirname, 'water-mask.json'), 'utf8'));
  const out = {};
  for (const [k, reg] of Object.entries(j.regions)) out[k] = openRegion(reg);
  return out;
}

/* how far each water cell is from land, in cells (8-neighbour steps), capped */
function shoreDistance(g, cap) {
  const { W, H, water } = g, d = new Uint8Array(W * H).fill(cap);
  let frontier = [];
  for (let i = 0; i < W * H; i++) if (!water[i]) { d[i] = 0; }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c; if (!water[i]) continue;
    let edge = false;
    for (let dr = -1; dr <= 1 && !edge; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      if (!water[rr * W + cc]) { edge = true; break; }
    }
    if (edge) { d[i] = 1; frontier.push(i); }
  }
  for (let k = 2; k < cap && frontier.length; k++) {
    const next = [];
    for (const i of frontier) {
      const r = (i / W) | 0, c = i - r * W;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
        const j = rr * W + cc;
        if (water[j] && d[j] > k) { d[j] = k; next.push(j); }
      }
    }
    frontier = next;
  }
  return d;
}

/* the nearest water cell to a pier that a boat can leave from (prefers a cell with open water beside it) */
function dockCell(g, shore, la, ln) {
  const { W, H } = g, c0 = Math.round(g.fx(ln) - 0.5), r0 = Math.round(g.fy(la) - 0.5);
  let best = -1, bs = Infinity;
  const reach = Math.ceil(450 / g.cellM);
  for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
    const r = r0 + dr, c = c0 + dc; if (r < 0 || c < 0 || r >= H || c >= W) continue;
    const i = r * W + c, s = shore[i]; if (!s) continue;
    const score = Math.hypot(dr, dc) + (s >= 2 ? 0 : 2.5);          // a cell wedged against a quay is a poor place to start
    if (score < bs) { bs = score; best = i; }
  }
  return best;
}

/* binary heap of [priority, cell] */
function heap() {
  const p = [], v = [];
  return {
    get size() { return p.length; },
    push(pr, val) { let i = p.length; p.push(pr); v.push(val); while (i > 0) { const k = (i - 1) >> 1; if (p[k] <= p[i]) break; [p[k], p[i]] = [p[i], p[k]]; [v[k], v[i]] = [v[i], v[k]]; i = k; } },
    pop() { const top = v[0], lp = p.pop(), lv = v.pop(); if (p.length) { p[0] = lp; v[0] = lv; let i = 0; for (;;) { let a = 2 * i + 1, b = a + 1, m = i; if (a < p.length && p[a] < p[m]) m = a; if (b < p.length && p[b] < p[m]) m = b; if (m === i) break; [p[m], p[i]] = [p[i], p[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; } } return top; },
  };
}

const SHORE_CAP = 14;                      // cells; beyond ~200 m from land the shore no longer matters
const USED = 0.5;                          // water another ferry line already crosses costs half: lines gather into lanes
/* extra cost of sailing close to land: steep right at the quay, gone by ~130 m out */
const shoreCost = s => s >= 9 ? 0 : s <= 1 ? 5 : (9 - s) * 0.32;

function route(g, shore, used, from, to, st) {
  const { W, H } = g;
  if (from === to) return [from];
  const tr = (to / W) | 0, tc = to - tr * W;
  st.stamp++;
  const open = heap(); st.g[from] = 0; st.seen[from] = st.stamp; st.prev[from] = -1; open.push(0, from);
  const hmin = USED;
  while (open.size) {
    const cur = open.pop();
    if (cur === to) break;
    if (st.done[cur] === st.stamp) continue; st.done[cur] = st.stamp;
    const r = (cur / W) | 0, c = cur - r * W, gc = st.g[cur];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      const j = rr * W + cc, s = shore[j]; if (!s) continue;
      if (dr && dc && (!shore[r * W + cc] || !shore[rr * W + c])) continue;       // no squeezing diagonally between two land cells
      const step = (dr && dc ? 1.41421356 : 1) * (1 + shoreCost(s)) * (used[j] ? USED : 1);
      const ng = gc + step;
      if (st.seen[j] !== st.stamp || ng < st.g[j]) {
        st.seen[j] = st.stamp; st.g[j] = ng; st.prev[j] = cur;
        const ar = Math.abs(rr - tr), ac = Math.abs(cc - tc);
        open.push(ng + hmin * (Math.max(ar, ac) + 0.41421356 * Math.min(ar, ac)), j);
      }
    }
  }
  if (st.seen[to] !== st.stamp) return null;
  const out = []; for (let i = to; i !== -1; i = st.prev[i]) out.push(i);
  return out.reverse();
}

/* is the straight run between two points of the grid clear water, at least `need` cells off the shore? */
function clear(g, shore, a, b, need) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
  for (let k = 0; k <= n; k++) {
    const x = a[0] + (b[0] - a[0]) * k / n, y = a[1] + (b[1] - a[1]) * k / n;
    const c = Math.floor(x), r = Math.floor(y);
    if (c < 0 || r < 0 || c >= g.W || r >= g.H || shore[r * g.W + c] < need) return false;
  }
  return true;
}
/* one stretch of cells -> few straight runs (each as long as stays clear) -> corners rounded where the rounding stays on water */
function tidy(g, shore, cells) {
  const pts = cells.map(i => { const r = (i / g.W) | 0; return [i - r * g.W + 0.5, r + 0.5]; });
  if (pts.length < 3) return pts;
  const keep = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + 1), lo = 255;
    let best = j;
    for (let k = i + 1; k < pts.length; k++) {
      lo = Math.min(lo, shore[cells[k]]);
      if (clear(g, shore, pts[i], pts[k], Math.max(1, Math.min(4, lo)))) best = k; else if (k - i > 220) break;
    }
    keep.push(pts[best]); i = best;
  }
  let out = keep;
  for (let pass = 0; pass < 3; pass++) {                              // Chaikin corner cutting, ends fixed
    const nx = [out[0]];
    for (let k = 1; k < out.length - 1; k++) {
      const a = out[k - 1], b = out[k], c = out[k + 1];
      const la = Math.hypot(b[0] - a[0], b[1] - a[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const cut = Math.min(0.25, 14 / Math.max(la, 1e-6), 14 / Math.max(lc, 1e-6));       // never cut more than ~200 m off a corner
      const p = [b[0] + (a[0] - b[0]) * cut, b[1] + (a[1] - b[1]) * cut], q = [b[0] + (c[0] - b[0]) * cut, b[1] + (c[1] - b[1]) * cut];
      if (cut > 0.02 && clear(g, shore, p, q, 1) && clear(g, shore, nx[nx.length - 1], p, 1)) nx.push(p, q); else nx.push(b);
    }
    nx.push(out[out.length - 1]); out = nx;
  }
  return out;
}

const norm = s => String(s || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

/**
 * Re-routes the ferry lines of one city in place. `lines`: the city's lines (only kind 'ferry' with no `planned` scope are touched).
 * Returns a report: { lines, piers, merged, hops, lanes }.
 */
function routeFerries(lines, g) {
  const ferries = lines.filter(l => l.kind === 'ferry' && Array.isArray(l.stations) && l.stations.length >= 2);
  if (!ferries.length) return { lines: 0 };
  const shore = shoreDistance(g, SHORE_CAP);

  /* 1. one position per pier */
  const groups = [];                                  // { name, members:[station], lat, lng }
  for (const l of ferries) for (const s of l.stations) {
    const k = norm(s.name);
    let grp = groups.find(x => x.key === k && metres([x.lat, x.lng], [s.lat, s.lng]) < 700);
    if (!grp) { grp = { key: k, members: [], lat: s.lat, lng: s.lng }; groups.push(grp); }
    grp.members.push(s);
    grp.lat = grp.members.reduce((a, m) => a + m.lat, 0) / grp.members.length;
    grp.lng = grp.members.reduce((a, m) => a + m.lng, 0) / grp.members.length;
  }
  let merged = 0;
  for (const grp of groups) {
    /* the real surveyed position nearest the middle of the group (never an invented point on land) */
    let pick = grp.members[0], bd = Infinity;
    for (const m of grp.members) { const d = metres([m.lat, m.lng], [grp.lat, grp.lng]); if (d < bd - 1e-6 || (Math.abs(d - bd) <= 1e-6 && (m.lat + m.lng) < (pick.lat + pick.lng))) { bd = d; pick = m; } }
    const la = pick.lat, ln = pick.lng;
    if (new Set(grp.members.map(m => m.lat + ',' + m.lng)).size > 1) merged++;
    grp.lat = la; grp.lng = ln; grp.dock = dockCell(g, shore, la, ln);
    for (const m of grp.members) { m.lat = la; m.lng = ln; m._pier = grp; }
  }

  /* 2. route every hop once (longest lines first, so the trunk routes are laid before the short hops choose their water) */
  const used = new Uint8Array(g.W * g.H);
  const st = { g: new Float32Array(g.W * g.H), prev: new Int32Array(g.W * g.H), seen: new Uint32Array(g.W * g.H), done: new Uint32Array(g.W * g.H), stamp: 0 };
  const hops = new Map();                             // "a|b" -> cells from a to b
  const hopKey = (a, b) => groups.indexOf(a) + '|' + groups.indexOf(b);
  const order = ferries.slice().sort((a, b) => b.stations.length - a.stations.length || (a.ref < b.ref ? -1 : 1));
  const lay = () => {
    for (const l of order) for (let i = 1; i < l.stations.length; i++) {
      const A = l.stations[i - 1]._pier, B = l.stations[i]._pier;
      if (A === B || hops.has(hopKey(A, B))) continue;
      if (A.dock < 0 || B.dock < 0) { hops.set(hopKey(A, B), null); hops.set(hopKey(B, A), null); continue; }
      const cells = route(g, shore, used, A.dock, B.dock, st);
      hops.set(hopKey(A, B), cells); hops.set(hopKey(B, A), cells ? cells.slice().reverse() : null);
      if (cells) for (const c of cells) used[c] = 1;
    }
  };
  lay();
  hops.clear(); lay();                                // a second pass: every hop now sees the lanes all the others laid

  /* 3. cut the union into stretches between junctions, tidy each once */
  const links = new Map();                            // cell -> Set of neighbouring cells in the union
  const link = (a, b) => { let s = links.get(a); if (!s) links.set(a, s = new Set()); s.add(b); };
  const docks = new Set(groups.map(x => x.dock));
  for (const cells of new Set(hops.values())) if (cells) for (let i = 1; i < cells.length; i++) { link(cells[i - 1], cells[i]); link(cells[i], cells[i - 1]); }
  const junction = c => docks.has(c) || links.get(c).size !== 2;
  const stretch = new Map();                          // "from>to>second" -> tidied points (grid units)
  const tidied = cells => {
    const out = [];
    let start = 0;
    for (let i = 1; i < cells.length; i++) {
      if (i < cells.length - 1 && !junction(cells[i])) continue;
      const part = cells.slice(start, i + 1);
      const fwd = part[0] < part[part.length - 1] || (part[0] === part[part.length - 1]);
      const canon = fwd ? part : part.slice().reverse();
      const key = canon[0] + '>' + canon[canon.length - 1] + '>' + canon[1] + '>' + canon.length;
      let pts = stretch.get(key); if (!pts) stretch.set(key, pts = tidy(g, shore, canon));
      const use = fwd ? pts : pts.slice().reverse();
      for (let k = out.length ? 1 : 0; k < use.length; k++) out.push(use[k]);
      start = i;
    }
    return out;
  };

  let failed = 0;
  for (const l of ferries) {
    const pathLL = [];
    for (let i = 1; i < l.stations.length; i++) {
      const A = l.stations[i - 1]._pier, B = l.stations[i]._pier;
      const pa = [A.lat, A.lng], pb = [B.lat, B.lng];
      if (!pathLL.length) pathLL.push(pa);
      const cells = A === B ? null : hops.get(hopKey(A, B));
      if (cells) for (const p of tidied(cells)) pathLL.push([+g.lat(p[1]).toFixed(5), +g.lng(p[0]).toFixed(5)]);
      else if (A !== B) failed++;
      pathLL.push(pb);
    }
    l.paths = [pathLL.filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])];
    l.geom = 'water';
  }
  for (const l of ferries) for (const s of l.stations) delete s._pier;
  return { lines: ferries.length, piers: groups.length, merged, hops: new Set(hops.values()).size, lanes: stretch.size, failed };
}

/** how much of a path lies on land (metres), ignoring the first/last `quay` metres at each pier of `stations` */
function landMetres(g, pathLL, stations, quay) {
  let land = 0, worst = 0, run = 0;
  for (let i = 1; i < pathLL.length; i++) {
    const a = pathLL[i - 1], b = pathLL[i], d = metres(a, b), k = Math.max(1, Math.ceil(d / 8));
    for (let s = 0; s < k; s++) {
      const t = (s + 0.5) / k, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const w = g.isWater(p[0], p[1]);
      const atPier = stations.some(q => metres(p, [q.lat, q.lng]) < quay);
      if (w === false && !atPier) { land += d / k; run += d / k; worst = Math.max(worst, run); } else run = 0;
    }
  }
  return { land, worst };
}

module.exports = { loadMask, openRegion, routeFerries, landMetres, shoreDistance, metres };

if (require.main === module) {                         // node ferry-water.cjs : a report on the committed line files, nothing written
  const mask = loadMask();
  const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  for (const [city, file] of [['istanbul', 'ferry-lines.json'], ['kocaeli', 'kocaeli-lines.json'], ['izmir', 'izmir-lines.json']]) {
    const lines = read(file), g = mask[city];
    const before = lines.filter(l => l.kind === 'ferry').map(l => landMetres(g, l.paths[0], l.stations, 120).land);
    const t = Date.now(), rep = routeFerries(lines, g);
    console.log(city, JSON.stringify(rep), (Date.now() - t) + ' ms');
    lines.filter(l => l.kind === 'ferry').forEach((l, i) => { const m = landMetres(g, l.paths[0], l.stations, 120); console.log('  ' + String(l.ref).padEnd(22), 'points', String(l.paths[0].length).padStart(4), ' on land before', String(Math.round(before[i])).padStart(5) + ' m', ' after', Math.round(m.land) + ' m'); });
  }
}
