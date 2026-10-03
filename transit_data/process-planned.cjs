/* Build the Vision tab's data: planned-lines.json (+ openings.json, planned-report.json).
 *
 *   node transit_data/process-planned.cjs            build everything
 *   node transit_data/process-planned.cjs --scaffold print registry stubs for OSM projects nobody has curated
 *
 * INPUTS
 *   planned-osm-<city>.json   raw OpenStreetMap ways + nodes   (fetch-planned.cjs, gitignored)
 *   planned-facts-mi.json     Metro İstanbul's project pages   (fetch-planned-facts.cjs)
 *   planned-registry.json     curated: which projects exist, their status, dated targets, sources
 *
 * THREE LAYERS, KEPT APART ON PURPOSE
 *   geometry  comes ONLY from OpenStreetMap: surveyed alignments, not guesses. A project whose
 *             alignment is not mapped gets no line rather than an invented one.
 *   facts     come from the operator's own pages where they exist (length, official station list,
 *             contractor, capacity, journey time, tunnel-boring machines).
 *   claims    (status, opening target, progress) are curated, each with a SOURCE and an as-of date,
 *             because they are exactly the things sources disagree on and change.
 *   Nothing in the output is inferred from another layer: if the registry says "under
 *   construction" and OSM says "proposed", both are reported (planned-report.json), not averaged.
 *
 * The old pipeline typed ten lines in by hand as 3-point polylines — straight segments up to 9 km
 * long between guessed coordinates. This replaces them with the mapped alignment, or with nothing.
 *
 * Exports its pieces so the tests can exercise the geometry arithmetic directly.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

/* ---------- geometry ---------------------------------------------------------------------- */
const R = 6371000, rad = d => d * Math.PI / 180;
function meters(a, b) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]), la1 = rad(a[0]), la2 = rad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const chainLen = c => { let s = 0; for (let i = 1; i < c.length; i++) s += meters(c[i - 1], c[i]); return s; };

/* distance from a point to a segment, and where along the segment it falls (0..1), in a local
   flat projection — plenty accurate over the few hundred metres this is used for */
function toSegment(p, a, b) {
  const k = Math.cos(rad(p[0]));
  const px = p[1] * k, py = p[0], ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0];
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [ay + dy * t, (ax + dx * t) / k];
  return { d: meters(p, q), t: t, q: q };
}
function nearestOn(path, p) {                          // {d, s (metres along), i, q}
  let best = { d: Infinity, s: 0, i: 0, q: path[0] }, acc = 0;
  for (let i = 1; i < path.length; i++) {
    const r = toSegment(p, path[i - 1], path[i]), segL = meters(path[i - 1], path[i]);
    if (r.d < best.d) best = { d: r.d, s: acc + segL * r.t, i: i, q: r.q };
    acc += segL;
  }
  return best;
}
function simplify(pts, eps) {                          // Douglas-Peucker, eps in degrees
  if (pts.length < 3) return pts;
  const sq = eps * eps, keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const st = [[0, pts.length - 1]];
  const sd = (p, a, b) => {
    const x = a[0], y = a[1]; let dx = b[0] - x, dy = b[1] - y;
    if (dx || dy) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { dx = p[0] - b[0]; dy = p[1] - b[1]; }
      else if (t > 0) { dx = p[0] - (x + dx * t); dy = p[1] - (y + dy * t); }
      else { dx = p[0] - x; dy = p[1] - y; }
    } else { dx = p[0] - x; dy = p[1] - y; }
    return dx * dx + dy * dy;
  };
  while (st.length) {
    const [s, e] = st.pop(); let md = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const dd = sd(pts[i], pts[s], pts[e]); if (dd > md) { md = dd; idx = i; } }
    if (md > sq && idx !== -1) { keep[idx] = true; st.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* Join polylines end-to-end where an end of one lies within `tol` metres of an end of another.
   (Two tubes were already collapsed to one by dedupTubes, so this is stitching, not choosing.) */
function chainPaths(paths, tol) {
  const chains = paths.map(p => p.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < chains.length; i++) for (let j = i + 1; j < chains.length; j++) {
      const A = chains[i], B = chains[j], a0 = A[0], a1 = A[A.length - 1], b0 = B[0], b1 = B[B.length - 1];
      let nc = null;
      if (meters(a1, b0) < tol) nc = A.concat(B.slice(1));
      else if (meters(a1, b1) < tol) nc = A.concat(B.slice().reverse().slice(1));
      else if (meters(a0, b1) < tol) nc = B.concat(A.slice(1));
      else if (meters(a0, b0) < tol) nc = B.slice().reverse().concat(A.slice(1));
      if (nc) { chains[i] = nc; chains.splice(j, 1); merged = true; break outer; }
    }
  }
  return chains;
}

/* A double-track tunnel is mapped as TWO ways a few tens of metres apart, one per direction, and
   sometimes cut into different pieces. For a map that draws a line, one is wanted. Longest first;
   a way is dropped when most of it lies within `tol` metres of a way already kept. The parts of a
   shorter way that stick out past the longer one survive, so nothing real is lost at the ends. */
function dedupTubes(paths, tol) {
  const order = paths.map((p, i) => ({ p, L: chainLen(p), i })).sort((a, b) => b.L - a.L);
  const kept = [];
  for (const o of order) {
    // sample every ~40 m so a long way is judged by its length and not by its vertex count
    const samples = [];
    for (let i = 1; i < o.p.length; i++) {
      const a = o.p[i - 1], b = o.p[i], n = Math.max(1, Math.round(meters(a, b) / 40));
      for (let k = 0; k < n; k++) samples.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    samples.push(o.p[o.p.length - 1]);
    const outside = [];
    for (const s of samples) {
      let near = false;
      for (const k of kept) if (nearestOn(k, s).d <= tol) { near = true; break; }
      outside.push(!near);
    }
    if (!kept.length) { kept.push(o.p); continue; }
    // keep each maximal run of "outside" samples that is long enough to be real track
    let runStart = -1;
    const flush = end => {
      if (runStart < 0) return;
      const piece = samples.slice(Math.max(0, runStart - 1), Math.min(samples.length, end + 1));
      if (piece.length >= 2 && chainLen(piece) >= 120) kept.push(piece);
      runStart = -1;
    };
    for (let i = 0; i < outside.length; i++) { if (outside[i]) { if (runStart < 0) runStart = i; } else flush(i); }
    flush(outside.length);
  }
  return kept;
}

/* Cut a path between two points, in path order. Each cut point is snapped to the path. */
function clipPath(p, a, b) {
  const A = nearestOn(p, a), B = nearestOn(p, b);
  const lo = A.s <= B.s ? A : B, hi = A.s <= B.s ? B : A;
  const out = [lo.q];
  for (let i = lo.i; i < hi.i; i++) out.push(p[i]);
  out.push(hi.q);
  return { path: out, reversed: A.s > B.s };
}

/* Corner-cutting for sparsely mapped alignments. Chaikin keeps the general shape and removes the
   polygonal look of a line mapped at 2-3 vertices per km. It never moves a point by more than a
   quarter of the segment it cuts, and the original ends are preserved. Applied only where the
   source is genuinely sparse (see build()), and recorded in the output. */
function chaikin(p, iterations) {
  let q = p.slice();
  for (let it = 0; it < iterations; it++) {
    if (q.length < 3) break;
    const n = [q[0]];
    for (let i = 0; i < q.length - 1; i++) {
      const a = q[i], b = q[i + 1];
      n.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    n.push(q[q.length - 1]);
    q = n;
  }
  return q;
}

/* ---------- names ------------------------------------------------------------------------- */
const TR = { 'ı': 'i', 'İ': 'i', 'I': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c' };
const fold = s => String(s || '').replace(/[ıİIşŞğĞüÜöÖçÇ]/g, c => TR[c]).toLowerCase()
  .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/* OSM station names carry decoration: "Sarıgazi (M13)", "Atakent Mahallesi". Strip the bracketed
   interchange note and keep the rest as the mapper wrote it. */
const cleanStationName = s => String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

const MODE_OK = /^(subway|light_rail|tram|funicular|monorail)$/;
/* Depots, crossovers and sidings are real track but not the line; a platform box is an area. */
function isServiceWay(t) {
  return t.area === 'yes' || /platform/.test(t.public_transport || '') || /platform/.test(t.construction || '')
      || /^(yard|crossover|siding|spur|depot)$/.test(t.service || '');
}
function wayMode(t) { return t['construction:railway'] || t['proposed:railway'] || t.construction || t.proposed || ''; }
function wayStatus(t) { return t.railway === 'construction' ? 'construction' : (t.railway === 'proposed' ? 'proposed' : null); }

/* ---------- loading ----------------------------------------------------------------------- */
const rd = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const exists = f => fs.existsSync(path.join(DIR, f));

function loadOsm(city) {
  const f = 'planned-osm-' + city + '.json';
  if (!exists(f)) return null;
  const raw = rd(f), ways = [], nodes = new Map();
  for (const e of raw.elements) {
    if (e.type === 'node') nodes.set(e.id, e);
    else if (e.type === 'way' && e.geometry && e.tags) {
      /* Mode is NOT filtered here: a mapper can tag a planned metro as plain `rail` (M14's second
         phase is), and a registry entry that names it should still find it. The mode filter
         applies only to the "unclaimed OSM projects" report, where it keeps mainline rail out. */
      const t = e.tags, md = wayMode(t);
      if (isServiceWay(t) || !wayStatus(t)) continue;
      ways.push({ id: e.id, tags: t, mode: md, status: wayStatus(t), pts: e.geometry.map(g => [g.lat, g.lon]), nodeIds: e.nodes || [] });
    }
  }
  return { raw, ways, nodes, osmBase: raw.osmBase, fetched: raw.fetched };
}

/* The live network's stations, per city, from the processed line files. */
const LIVE_FILES = { istanbul: ['lines.json', 'b2-line.json'], ankara: ['ankara-lines.json'], izmir: ['izmir-lines.json'],
                     bursa: ['bursa-lines.json'], antalya: ['antalya-lines.json'], kocaeli: ['kocaeli-lines.json'] };
function liveStations(city) {
  const out = [];
  for (const f of LIVE_FILES[city] || []) {
    if (!exists(f)) continue;
    for (const l of rd(f)) { if (l.scope === 'planned') continue; for (const st of l.stations || []) if (st.name) out.push(st); }
  }
  return out;
}

/* ---------- one project ------------------------------------------------------------------- */
const STATION_TAG = t => t['construction:railway'] === 'station' || t['proposed:railway'] === 'station'
  || t.proposed === 'station' || t.construction === 'station'
  || (t.public_transport === 'station' && (t.railway === 'proposed' || t.railway === 'construction' || t['proposed:railway'] || t['construction:railway']));

function matchWays(osm, spec) {
  const res = (spec.names || []).map(n => new RegExp(n, 'i'));
  const st = spec.status || null;
  // each field on its own, so an anchored pattern like ^Hızray$ can match: joining them first
  // meant `$` could never be reached and the line was silently "not found"
  return osm.ways.filter(w => {
    const fields = [w.tags.name, w.tags['name:en'], w.tags.ref].filter(Boolean);
    return res.some(r => fields.some(f => r.test(f))) && (!st || w.status === st) && (!spec.mode || w.mode === spec.mode);
  });
}

/* One matched set of ways -> stitched, de-duplicated chains, optionally clipped between two
   points. A clip point is a station NAME (looked up among the planned stations and then the live
   network), a [lat,lng], or '@start' / '@end' for the ends of the alignment. */
function geometryPart(osm, spec, opts) {
  const ways = matchWays(osm, spec);
  if (!ways.length) return null;
  const kept = dedupTubes(ways.map(w => w.pts), opts.tubeTol);
  let chains = chainPaths(kept, opts.stitchTol).sort((a, b) => chainLen(b) - chainLen(a));
  if (spec.clip) {
    const longest = chains[0];
    const at = x => {
      if (Array.isArray(x)) return x;
      if (x === '@start') return longest[0];
      if (x === '@end') return longest[longest.length - 1];
      return osm.stationByName.get(fold(x)) || null;
    };
    const pa = at(spec.clip.from), pb = at(spec.clip.to);
    if (!pa || !pb) return { error: 'clip point not found: ' + JSON.stringify(!pa ? spec.clip.from : spec.clip.to), ways };
    let bestC = null, bestScore = Infinity;
    for (const c of chains) { const sc = nearestOn(c, pa).d + nearestOn(c, pb).d; if (sc < bestScore) { bestScore = sc; bestC = c; } }
    if (!bestC || bestScore > 700) return { error: 'clip points are not on the matched alignment (' + Math.round(bestScore) + ' m off)', ways };
    chains = [clipPath(bestC, pa, pb).path];
  }
  return { ways, chains };
}

function buildGeometry(osm, spec, opts) {
  const parts = spec.parts || [spec];
  let ways = [], chains = [];
  for (const part of parts) {
    const r = geometryPart(osm, part, opts);
    if (!r) continue;
    if (r.error) return r;
    ways = ways.concat(r.ways); chains = chains.concat(r.chains);
  }
  if (!ways.length) return null;
  if (parts.length > 1) chains = chainPaths(chains, opts.stitchTol);
  chains.sort((a, b) => chainLen(b) - chainLen(a));
  const rawKm = chains.reduce((s, c) => s + chainLen(c), 0) / 1000;
  const vertices = chains.reduce((s, c) => s + c.length, 0);
  const sparse = vertices / Math.max(rawKm, .1) < opts.sparsePerKm;
  chains = chains.filter((c, i) => i === 0 || chainLen(c) > 300).map(c => simplify(c, 0.00002));
  if (sparse) chains = chains.map(c => chaikin(c, 2));
  chains = chains.map(c => c.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]));
  return { ways, paths: chains, mappedKm: chains.reduce((s, c) => s + chainLen(c), 0) / 1000, smoothed: sparse,
           osmWayIds: [...new Set(ways.map(w => w.id))], vertices };
}

/* Stations: tagged nodes within `snap` metres of the drawn alignment, ordered along it. */
function stationsFor(osm, paths, snap, extraNames) {
  const found = new Map();
  if (!paths.length) return [];
  const main = paths[0];
  for (const n of osm.nodes.values()) {
    const t = n.tags; if (!t || !t.name || !STATION_TAG(t)) continue;
    let best = null, bi = -1;
    paths.forEach((p, i) => { const r = nearestOn(p, [n.lat, n.lon]); if (!best || r.d < best.d) { best = r; bi = i; } });
    if (!best || best.d > snap) continue;
    const name = cleanStationName(t.name), key = fold(name);
    if (!key) continue;
    const cur = found.get(key);
    if (!cur || best.d < cur.d) found.set(key, { name, lat: +n.lat.toFixed(5), lng: +n.lon.toFixed(5), d: best.d, s: best.s, chain: bi,
      wikidata: t.wikidata || undefined, wikipedia: t.wikipedia || undefined,
      status: (t['construction:railway'] || t.construction) ? 'construction' : 'proposed' });
  }
  const list = [...found.values()].sort((a, b) => a.chain - b.chain || a.s - b.s);
  return list.map(({ name, lat, lng, wikidata, wikipedia, status }) => {
    const o = { name, lat, lng, status }; if (wikidata) o.wikidata = wikidata; if (wikipedia) o.wikipedia = wikipedia; return o;
  });
}

/* ---------- the build --------------------------------------------------------------------- */
const STATUS = ['Under construction', 'Planned', 'On hold', 'Long-term plan'];
const PHASE = { 'Under construction': 'construction', 'Planned': 'planned', 'On hold': 'hold', 'Long-term plan': 'vision' };

/* ---------- unverified entries made straight from OpenStreetMap ---------------------------- */
/* How much of a drawn alignment is made of long straight runs. A mapper who only knew a line's two ends
   draws one segment between them; the app cannot honestly add curves the source does not have, so
   such a line is drawn as INDICATIVE (finest dots, and the panel says so) instead of passing for a
   surveyed route. */
function shapeOf(paths) {
  let km = 0, maxSeg = 0, long = 0;
  for (const p of paths) for (let i = 1; i < p.length; i++) { const m = meters(p[i - 1], p[i]); km += m; if (m > maxSeg) maxSeg = m; if (m > 500) long += m; }
  return { maxSeg: Math.round(maxSeg), longPct: km ? Math.round(100 * long / km) : 0 };
}
const isSchematic = paths => { const s = shapeOf(paths); return s.maxSeg > 2000 || s.longPct >= 70; };

const AUTO_MIN_KM = 1.5;                       // below this a "line" is usually a connector or a stub
const AUTO_NAME_OK = /^(?=.*\s)(?!.*(depo|garaj))/i;   // needs a real name: "M34" alone is a track, and depots are not lines
const AUTO_COLOR = { subway: '#8579B8', tram: '#4FA3A5', funicular: '#B48A6B' };
const chainsOf = (ways, opts) => chainPaths(dedupTubes(ways.map(w => w.pts), opts.tubeTol), opts.stitchTol);

/* "M İncirli - Söğütlüçeşme Metro Hattı" -> "İncirli–Söğütlüçeşme"; "M2-M3 Bağlantı Hattı" -> "M2–M3 Bağlantı".
   A chip is short, and a bare mode letter or a trailing "Hattı" says nothing. */
function autoRef(name) {
  const paren = (name.match(/\(([^)]*)\)/) || [])[1];
  let n = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(), lead = '';
  const m = n.match(/^([A-ZÇĞİÖŞÜ]{1,2}\d+[A-Z]?(?:-[A-ZÇĞİÖŞÜ]{1,2}\d+)?)\s+(.*)$/);
  if (m) { lead = m[1]; n = m[2]; }
  else { const b = n.match(/^[MTFB]\s+(.*)$/); if (b) n = b[1]; }
  n = n.replace(/\s+(Metro\s+)?(Hattı|Metrosu|Projesi|Planı)$/i, '').replace(/\s+Metro$/i, '');
  // "M3 (Gebze – Sabiha Gökçen Havalimanı) Hattı": once the bracket is cut nothing is left, and the bracket was the name
  if (/^(Metro\s+)?(Hattı|Metrosu|Projesi|Planı)?$/i.test(n) && paren) n = paren.trim();
  n = n.replace(/\s*[-–]\s*/g, '–');
  let out = (lead ? lead + ' ' : '') + n;
  if (out.length > 34) out = out.slice(0, 33).replace(/\s+\S*$/, '') + '…';
  return out || name;
}

function build(opts) {
  opts = Object.assign({ tubeTol: 100, stitchTol: 120, snap: 120, sparsePerKm: 4.5, now: new Date() }, opts || {});
  const registry = rd('planned-registry.json');
  const facts = exists('planned-facts-mi.json') ? rd('planned-facts-mi.json') : { projects: [] };
  const miById = new Map(facts.projects.map(p => [p.id, p]));
  const cities = rd('cities.json');
  const sources = registry.sources || {};
  const report = { generated: opts.now.toISOString(), unmatchedRegistry: [], clipErrors: [], statusDisagreements: [],
                   lengthDisagreements: [], missingSources: [], noOsmCity: [], osmNotInRegistry: [], autoEntries: [], stale: [] };
  const lines = [], osmByCity = {};
  for (const city of Object.keys(cities)) {
    const o = loadOsm(city);
    if (!o) { report.noOsmCity.push(city); continue; }
    // station-name -> coordinate, for clip points given by name: the PLANNED stations first, then
    // the live network (a planned line usually starts at a station that already exists)
    o.stationByName = new Map();
    for (const n of liveStations(city)) o.stationByName.set(fold(n.name), [n.lat, n.lng]);
    for (const n of o.nodes.values()) if (n.tags && n.tags.name && STATION_TAG(n.tags)) o.stationByName.set(fold(cleanStationName(n.tags.name)), [n.lat, n.lon]);
    osmByCity[city] = o;
  }

  const usedWayIds = new Set();
  for (const p of registry.projects) {
    const osm = osmByCity[p.city];
    const out = {
      id: p.id, ref: p.ref, kind: p.kind, color: p.color, scope: 'planned', official: p.official,
      status: p.status, phase: PHASE[p.status],
    };
    if (!STATUS.includes(p.status)) report.statusDisagreements.push(p.id + ': unknown status "' + p.status + '"');
    if (p.partOf) out.partOf = p.partOf;
    if (p.officialTr) out.officialTr = p.officialTr;
    for (const k of ['owner', 'operator', 'driverless', 'notes', 'target', 'progress', 'km', 'stations', 'tags']) if (p[k] !== undefined) out[k === 'stations' ? 'stationCount' : k] = p[k];
    out.verified = p.verified || null;

    /* official facts from Metro İstanbul, copied as published and never reconciled with the rest */
    let mi = null;
    if (p.mi !== undefined) {
      mi = miById.get(p.mi);
      if (!mi) report.unmatchedRegistry.push(p.id + ': Metro İstanbul project q=' + p.mi + ' is no longer published');
      else {
        out.official_facts = { source: 'Metro İstanbul', url: mi.url, title: mi.title, phase: mi.phase,
          contractor: mi.contractor && mi.contractor !== '-' ? mi.contractor : undefined,
          startDate: mi.startDate || undefined, contractValue: mi.contractValue && mi.contractValue !== '-' ? mi.contractValue : undefined,
          lengthKm: mi.lengthKm || undefined, capacityPphpd: mi.capacityPphpd || undefined,
          travelMin: mi.travelMin || undefined, tbm: mi.tbm || undefined, vehicles: mi.vehicles || undefined,
          stations: mi.stations && mi.stations.length ? mi.stations : undefined, integrations: mi.integrations && mi.integrations.length ? mi.integrations : undefined };
        const want = { 'Under construction': 'construction', 'Planned': 'project' }[p.status];
        if (want && mi.phase !== want && !p.partOf)
          report.statusDisagreements.push(p.id + ': registry says "' + p.status + '" but Metro İstanbul lists it as "' + mi.phase + '"');
      }
    }
    /* facts from a source other than Metro İstanbul (contractor, contract value, vehicles ...) take the
       same official_facts shape with the source named; where Metro İstanbul published them, theirs win */
    if (p.facts && !out.official_facts) {
      const fsrc = sources[p.facts.src];
      if (!fsrc) report.missingSources.push(p.id + ': facts source "' + p.facts.src + '" is not in sources');
      else { const rest = Object.assign({}, p.facts); delete rest.src; out.official_facts = Object.assign({ source: fsrc.label, url: fsrc.url }, rest); }
    }
    if (p.stationNames) out.stationNames = p.stationNames;
    else if (mi && mi.stations && mi.stations.length) out.stationNames = mi.stations;

    /* geometry */
    let g = null;
    if (p.osm && osm) {
      g = buildGeometry(osm, p.osm, opts);
      if (g && g.error) { report.clipErrors.push(p.id + ': ' + g.error); g = null; }
      else if (!g) report.unmatchedRegistry.push(p.id + ': no OpenStreetMap way matches ' + JSON.stringify(p.osm.names));
    }
    if (g) {
      g.osmWayIds.forEach(i => usedWayIds.add(i));
      out.paths = g.paths;
      out.stations = stationsFor(osm, g.paths, opts.snap);
      out.geometry = { kind: 'osm', status: [...new Set(g.ways.map(w => w.status))].join('+'), osmWays: g.osmWayIds.length,
                       mappedKm: +g.mappedKm.toFixed(1), smoothed: g.smoothed || undefined, schematic: isSchematic(g.paths) || undefined,
                       osmBase: osm.osmBase || null, source: 'OpenStreetMap contributors (ODbL)' };
      // OSM and the registry disagreeing about status is information, not noise
      const osmSt = out.geometry.status;
      const expect = { 'Under construction': 'construction' }[p.status];
      if (expect && osmSt !== expect && !p.partOf) report.statusDisagreements.push(p.id + ': registry "' + p.status + '" vs OpenStreetMap "' + osmSt + '" (OSM may lag)');
      const refKm = p.km || (mi && mi.lengthKm);
      if (refKm && Math.abs(refKm - g.mappedKm) / refKm > 0.25)
        report.lengthDisagreements.push(p.id + ': published ' + refKm + ' km vs ' + g.mappedKm.toFixed(1) + ' km mapped');
    } else {
      out.paths = []; out.stations = []; out.geometry = { kind: 'none' };
    }

    /* sources, resolved so the client needs no registry */
    const ids = [].concat(p.sources || []);
    if (mi && !ids.includes('mi_projects')) ids.unshift('mi_projects');
    out.sources = ids.map(id => {
      const s = sources[id];
      if (!s) { report.missingSources.push(p.id + ': unknown source "' + id + '"'); return null; }
      return { label: s.label, url: s.url, date: s.date || undefined, note: s.note || undefined };
    }).filter(Boolean);
    if (g && g.ways.length) out.sources.push({ label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/way/' + g.osmWayIds[0], date: (osm.osmBase || '').slice(0, 10) || undefined, note: 'alignment' + (out.stations.length ? ' and stations' : '') });
    if (out.target && out.target.src && !sources[out.target.src]) report.missingSources.push(p.id + ': target source "' + out.target.src + '" is not in sources');
    if (out.progress && out.progress.src && !sources[out.progress.src]) report.missingSources.push(p.id + ': progress source "' + out.progress.src + '" is not in sources');
    out._city = p.city;
    const age = p.verified ? (opts.now - new Date(p.verified)) / 86400000 : Infinity;
    if (age > (registry.staleAfterDays || 120)) report.stale.push(p.id + ': last verified ' + (p.verified || 'never'));
    lines.push(out);
  }

  /* OSM planned projects that no registry entry claims. They still go on the map, as UNVERIFIED
     entries: a project somebody has surveyed into OpenStreetMap should show up in the Vision tab
     without waiting for a human to curate it, but it is shown for what it is — a mapper's
     record, with no official source behind it — and every such entry says so (`verified: null`).
     Promoting one to a curated entry is just adding it to the registry; the way ids it used are
     then claimed and the auto entry disappears. */
  const bandOf = (city, lat, lon) => {
    // the İstanbul and Kocaeli boxes overlap, and each city's OSM file holds the other's projects;
    // the boundary runs between Tuzla and Gebze
    if (city === 'istanbul' || city === 'kocaeli') return (lat <= 40.93 && lon >= 29.34) ? 'kocaeli' : 'istanbul';
    return city;
  };
  const inBox = (city, lat, lon) => { const b = cities[city].box; return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e; };
  const groups = new Map();
  for (const [city, osm] of Object.entries(osmByCity)) {
    for (const w of osm.ways) {
      if (usedWayIds.has(w.id) || !MODE_OK.test(w.mode)) continue;
      const name = w.tags.name || w.tags['name:en'] || '';
      if (!name) continue;
      const k = fold(name);
      const gp = groups.get(k) || { name, ways: new Map(), cities: new Set() };
      gp.ways.set(w.id, w); gp.cities.add(city); groups.set(k, gp);   // the same way in two city files counts once
    }
  }
  const taken = {};
  for (const l of lines) (taken[l._city] = taken[l._city] || new Set()).add(l.ref);
  for (const [city, c] of Object.entries(cities)) {
    const live = new Set();
    for (const f of LIVE_FILES[city] || []) if (exists(f)) for (const l of rd(f)) if (l.scope !== 'planned') live.add(l.ref);
    taken[city] = new Set([...(taken[city] || []), ...live]);
  }
  for (const gp of groups.values()) {
    const ways = [...gp.ways.values()];
    const km1 = chainsOf(ways, opts).reduce((s, c) => s + chainLen(c), 0) / 1000;
    const skip = reason => report.osmNotInRegistry.push({ name: gp.name, km: +km1.toFixed(1), ways: ways.length, skipped: reason });
    if (!AUTO_NAME_OK.test(gp.name)) { skip('a bare reference or depot track, not a line'); continue; }
    if (km1 < AUTO_MIN_KM) { skip('shorter than ' + AUTO_MIN_KM + ' km'); continue; }
    const first = [...gp.cities][0];
    const probe = chainsOf(ways, opts).sort((a, b) => chainLen(b) - chainLen(a))[0];
    const mid = probe[probe.length >> 1];
    const city = bandOf(first, mid[0], mid[1]);
    if (!osmByCity[city] || !inBox(city, mid[0], mid[1])) { skip('outside every supported city'); continue; }
    const modes = [...new Set(ways.map(w => w.mode))], sts = [...new Set(ways.map(w => w.status))];
    const spec = { names: ['^' + gp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'] };
    const g = buildGeometry(osmByCity[city], spec, opts);
    if (!g || g.error || !g.paths.length) { skip('geometry did not resolve'); continue; }
    const status = sts.length === 1 && sts[0] === 'construction' ? 'Under construction' : 'Long-term plan';
    const kind = modes.length === 1 && modes[0] === 'funicular' ? 'funicular' : (/tram|light_rail/.test(modes[0]) && modes.length === 1 ? 'tram' : 'subway');
    let ref = autoRef(gp.name), n = 2; const base = ref;
    while ((taken[city] || new Set()).has(ref)) ref = base + ' (' + n++ + ')';
    (taken[city] = taken[city] || new Set()).add(ref);
    const osm = osmByCity[city];
    const stations = stationsFor(osm, g.paths, opts.snap);
    lines.push({
      id: 'osm-' + g.osmWayIds[0], ref, kind, color: AUTO_COLOR[kind], colorSource: 'assigned', scope: 'planned', official: gp.name,
      status, phase: PHASE[status], verified: null, auto: true,
      paths: g.paths, stations,
      geometry: { kind: 'osm', status: sts.join('+'), osmWays: g.osmWayIds.length, mappedKm: +g.mappedKm.toFixed(1), smoothed: g.smoothed || undefined, schematic: isSchematic(g.paths) || undefined,
                  osmBase: osm.osmBase || null, source: 'OpenStreetMap contributors (ODbL)' },
      sources: [{ label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/way/' + g.osmWayIds[0], date: (osm.osmBase || '').slice(0, 10) || undefined,
                  note: 'alignment' + (stations.length ? ' and stations' : '') + ' — the only source' }],
      _city: city });
    g.osmWayIds.forEach(i => usedWayIds.add(i));
    report.autoEntries.push({ city, ref, name: gp.name, km: +g.mappedKm.toFixed(1), status, osmStatus: sts.join('+') });
  }
  report.osmNotInRegistry.sort((a, b) => b.km - a.km);
  report.autoEntries.sort((a, b) => a.city < b.city ? -1 : a.city > b.city ? 1 : b.km - a.km);
  return { lines, report, registry, osmBase: Object.values(osmByCity).map(o => o.osmBase).filter(Boolean).sort().pop() || null,
           osmByCity };
}

/* openings.json drives the "coming soon" cards: only projects UNDER CONSTRUCTION with a stated
   target, soonest first. A quarter or a year is rendered as the END of that period — the card
   says "by", never "on" — so a vague target is never presented as a date. */
function targetEnd(t) {
  if (!t) return null;
  if (t.date) return { iso: t.date, disp: null };
  if (t.end) return { iso: t.end, disp: null };
  return null;
}
function openingsFrom(lines, now) {
  const out = [];
  for (const l of lines) {
    if (l.status !== 'Under construction' || !l.target || l._city !== 'istanbul') continue;
    const e = targetEnd(l.target);
    if (!e) continue;
    if (Date.parse(e.iso.length === 7 ? e.iso + '-28' : e.iso) < now - 3 * 86400000) continue;
    out.push({ ref: l.ref, name: l.official.replace(/^[A-Z0-9]+\s·\s/, ''), color: l.color, open: e.iso,
               disp: l.target.text, km: l.official_facts && l.official_facts.lengthKm || l.km || null,
               stations: l.stationCount || (l.official_facts && l.official_facts.stations && l.official_facts.stations.length) || null });
  }
  return out.sort((a, b) => a.open < b.open ? -1 : 1);
}

function main() {
  if (process.argv.includes('--scaffold')) {
    const r = build();
    console.log(JSON.stringify(r.report.osmNotInRegistry, null, 1));
    return;
  }
  const r = build();
  const byCity = {};
  for (const l of r.lines) { const c = l._city; delete l._city; (byCity[c] = byCity[c] || []).push(l); }
  /* Only rewrite the outputs when something real changed. Every run stamps `generated` and the OSM
     snapshot time, so a file that differs only by those would make the scheduled job commit (and
     redeploy the site) every week for nothing. */
  const quiet = function (k, v) {
    if (k === 'generated' || k === 'osmBase') return undefined;
    if (k === 'date' && this && this.label === 'OpenStreetMap') return undefined;   // the OSM source's "as of" day
    return v;
  };
  const outFile = path.join(DIR, 'planned-lines.json');
  const next = { generated: r.report.generated, osmBase: r.osmBase, cities: byCity };
  let same = false;
  try { same = JSON.stringify(JSON.parse(fs.readFileSync(outFile, 'utf8')), quiet) === JSON.stringify(next, quiet); } catch (e) { /* first run */ }
  if (same) console.log('planned-lines.json: nothing changed apart from timestamps; left as is.');
  else fs.writeFileSync(outFile, JSON.stringify(next) + '\n');
  fs.writeFileSync(path.join(DIR, 'planned-report.json'), JSON.stringify(r.report, null, 1) + '\n');
  const now = Date.now();
  const flat = Object.entries(byCity).flatMap(([c, ls]) => ls.map(l => Object.assign({ _city: c }, l)));
  fs.writeFileSync(path.join(DIR, 'openings.json'), JSON.stringify(openingsFrom(flat, now), null, 1) + '\n');
  // a readable summary
  let n = 0;
  for (const [c, ls] of Object.entries(byCity)) {
    console.log('\n' + c + ': ' + ls.length + ' projects');
    for (const l of ls) {
      n++;
      console.log('  ' + l.status.padEnd(19) + String(l.ref).padEnd(24) + (l.geometry.mappedKm != null ? String(l.geometry.mappedKm).padStart(5) + ' km' : '   — no alignment ') +
        '  ' + String(l.stations.length).padStart(2) + ' stn mapped' + (l.stationNames ? ' / ' + l.stationNames.length + ' official' : '') + (l.geometry.smoothed ? '  (smoothed)' : ''));
    }
  }
  console.log('\n' + n + ' projects. Report:');
  for (const k of Object.keys(r.report)) { const v = r.report[k]; if (Array.isArray(v) && v.length && k !== 'osmNotInRegistry' && k !== 'autoEntries') console.log('  ' + k + ' (' + v.length + '):\n    ' + v.slice(0, 12).join('\n    ')); }
  console.log('  autoEntries: ' + r.report.autoEntries.length + ' unverified OpenStreetMap-only entries; ' + r.report.osmNotInRegistry.length + ' OSM groups skipped (see planned-report.json)');
}

module.exports = { meters, chainLen, nearestOn, simplify, chainPaths, dedupTubes, clipPath, chaikin, fold, cleanStationName,
                   isServiceWay, wayMode, wayStatus, STATION_TAG, loadOsm, shapeOf, isSchematic, autoRef, build, openingsFrom, STATUS, PHASE };
if (require.main === module) main();
