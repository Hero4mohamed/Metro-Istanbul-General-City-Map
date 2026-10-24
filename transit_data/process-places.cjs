/* Turn the raw places dump (fetch-places.cjs) into the compact file the app searches: places-<city>.json.
 *
 *   node transit_data/process-places.cjs [city ...]
 *
 * WHAT COMES OUT
 * One ENTRY per thing a person might type to go somewhere: a district, a neighbourhood, a village or island, a street,
 * a landmark, a restaurant, a pharmacy, a school, a mosque, a shop. Each carries its name (and an English / Arabic
 * name where OpenStreetMap has one), a type, a position, the district and neighbourhood it lies in, and a rank for how
 * notable it is.
 *
 * THREE DECISIONS THAT MATTER
 * 1. A STREET IS NOT A WAY. OpenStreetMap cuts a street into a way at every junction and every change of class; Bağdat
 *    Caddesi is 105 ways. Searching those as they are gives the same street over and over. So the ways of one name in
 *    one district are joined into streets by touching (two ways belong together if their midpoints are no further apart
 *    than half their lengths plus a margin — i.e. they follow on from each other), and each street is ONE entry,
 *    pinned on the street itself. "1. Sokak" exists in every neighbourhood and is NOT one street: those components are
 *    far apart, so they stay separate.
 * 2. WHERE A THING IS comes from the district and neighbourhood outlines, by point in polygon, not from the nearest
 *    centre — near a border the nearest centre is often the wrong district, and the district is what the result says.
 * 3. NOTABLE THINGS RANK HIGHER. A thing with a Wikidata entry is, in practice, a thing people have heard of; the type
 *    adds to that (a district over a neighbourhood over a street over a shop). It is a tie-breaker the search blends with
 *    how well the name matches and how near it is, never a substitute for either.
 *
 * FORMAT (v1) — columns, not rows, because a column of small integers compresses far better than a list of objects:
 *   { v, city, box, osmBase, types:[key], districts:[name], hoods:[name], n:"name\nname\n…",
 *     t:[type index], la:[lat*1e5 deltas], lo:[lon*1e5 deltas], d:[district+1 or 0], h:[hood+1 or 0], r:[rank 0-3],
 *     en:{index:name}, ar:{index:name} }
 * Entries are in Morton (Z-curve) order, so neighbours in the file are neighbours on the ground and the coordinate
 * deltas are small. Written only when the entries changed, so a re-run on unchanged data leaves no diff.
 */
const fs = require('fs');
const path = require('path');
const { pointInRing } = require('./process-landuse.cjs');

const DIR = __dirname;

/* ---- types ------------------------------------------------------------------------------------------------------ */
/* The order is the file format: an index into this list is what an entry stores. Append only; never reorder. */
const TYPES = [
  'district', 'hood', 'place', 'square', 'street',
  'restaurant', 'cafe', 'fast_food', 'bar',
  'hotel', 'lodging',
  'attraction', 'museum', 'gallery', 'historic', 'viewpoint', 'tower',
  'cinema', 'theatre', 'library',
  'park', 'garden', 'beach', 'water', 'peak',
  'hospital', 'clinic', 'pharmacy',
  'university', 'school',
  'mosque', 'church', 'synagogue', 'worship',
  'mall', 'supermarket', 'shop',
  'bank', 'post', 'government', 'police', 'fuel',
  'bus_station', 'ferry', 'airport', 'pier',
  'sports', 'stadium',
  'other',
];
const T = {}; TYPES.forEach((k, i) => { T[k] = i; });

function typeOf(tags) {
  const a = tags.amenity, tr = tags.tourism, hi = tags.historic, le = tags.leisure, sh = tags.shop, pl = tags.place,
        na = tags.natural, mm = tags.man_made, ae = tags.aeroway, of = tags.office;
  if (pl) {
    if (pl === 'square') return 'square';
    if (pl === 'borough' || pl === 'district') return 'district';
    if (pl === 'suburb' || pl === 'neighbourhood' || pl === 'quarter') return 'hood';
    if (pl === 'city_block') return null;
    return 'place';                                                 // city, town, village, hamlet, island, islet, locality
  }
  if (ae) return 'airport';
  if (a === 'place_of_worship') {
    if (tags.religion === 'muslim') return 'mosque';
    if (tags.religion === 'christian') return 'church';
    if (tags.religion === 'jewish') return 'synagogue';
    return 'worship';
  }
  if (a) {
    if (a === 'restaurant' || a === 'food_court') return 'restaurant';
    if (a === 'cafe' || a === 'ice_cream') return 'cafe';
    if (a === 'fast_food') return 'fast_food';
    if (a === 'bar' || a === 'pub' || a === 'biergarten' || a === 'nightclub') return 'bar';
    if (a === 'hospital') return 'hospital';
    if (a === 'clinic' || a === 'doctors' || a === 'dentist' || a === 'veterinary') return 'clinic';
    if (a === 'pharmacy') return 'pharmacy';
    if (a === 'university' || a === 'college') return 'university';
    if (a === 'school' || a === 'kindergarten' || a === 'language_school') return 'school';
    if (a === 'library') return 'library';
    if (a === 'cinema') return 'cinema';
    if (a === 'theatre' || a === 'arts_centre') return 'theatre';
    if (a === 'bank') return 'bank';
    if (a === 'post_office') return 'post';
    if (a === 'townhall' || a === 'courthouse' || a === 'embassy' || a === 'fire_station') return 'government';
    if (a === 'police') return 'police';
    if (a === 'fuel') return 'fuel';
    if (a === 'bus_station') return 'bus_station';
    if (a === 'ferry_terminal') return 'ferry';
    if (a === 'marketplace') return 'mall';
    if (a === 'taxi' || a === 'car_rental') return 'other';
    return 'other';
  }
  if (tr) {
    if (tr === 'hotel' || tr === 'resort') return 'hotel';
    if (tr === 'hostel' || tr === 'guest_house' || tr === 'motel' || tr === 'apartment' || tr === 'camp_site') return 'lodging';
    if (tr === 'museum') return 'museum';
    if (tr === 'gallery') return 'gallery';
    if (tr === 'viewpoint') return 'viewpoint';
    return 'attraction';
  }
  if (hi) return 'historic';
  if (mm) return mm === 'pier' ? 'pier' : 'tower';
  if (le) {
    if (le === 'park' || le === 'nature_reserve') return 'park';
    if (le === 'garden') return 'garden';
    if (le === 'stadium') return 'stadium';
    if (le === 'marina') return 'pier';
    if (le === 'beach_resort') return 'beach';
    return 'sports';
  }
  if (sh) {
    if (sh === 'mall' || sh === 'department_store') return 'mall';
    if (sh === 'supermarket' || sh === 'convenience' || sh === 'grocery') return 'supermarket';
    return 'shop';
  }
  if (of === 'government') return 'government';
  if (na) {
    if (na === 'beach') return 'beach';
    if (na === 'peak') return 'peak';
    return 'water';                                                 // bay, strait, water, spring, cape, cave
  }
  return null;
}

/* a base importance by type: 3 = people know it, 0 = it is somewhere to go among thousands */
const TYPE_RANK = { district: 3, hood: 2, place: 2, square: 2, attraction: 2, museum: 2, airport: 3, stadium: 2, university: 2,
                    hospital: 1, mall: 1, park: 1, historic: 1, viewpoint: 1, tower: 1, ferry: 1, bus_station: 1, mosque: 0 };

/* ---- names ------------------------------------------------------------------------------------------------------- */
// Turkish-aware folding: i/ı/İ/I all become i, diacritics drop, case drops. Only used here to find duplicates.
const FOLD = (() => {
  const m = { 'İ': 'i', 'I': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ğ': 'g', 'ğ': 'g', 'Ü': 'u', 'ü': 'u', 'Ö': 'o', 'ö': 'o', 'Ç': 'c', 'ç': 'c',
              'Â': 'a', 'â': 'a', 'Î': 'i', 'î': 'i', 'Û': 'u', 'û': 'u', 'É': 'e', 'é': 'e' };
  return m;
})();
function fold(s) {
  let o = '';
  for (const ch of String(s)) {
    const m = FOLD[ch];
    o += m !== undefined ? m : ch.toLowerCase();
  }
  return o.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
const HOOD_SUFFIX = /\s+(mahallesi|mah\.?|mahalle)$/i;
function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function hoodName(s) { return cleanName(s).replace(HOOD_SUFFIX, ''); }
const DIGITS_ONLY = /^[\d\s.,\-/]+$/;
/* The dump is fetched by box, and a box can reach past the border: İzmir's takes in Lesbos, whose outline is named in Greek.
   A district named in Greek, Cyrillic or Georgian letters is another country's, and so is everything inside it; leaving them
   in would offer the search a "Περιφερειακή Ενότητα Λέσβου" and a few thousand streets of an island no one here is going to. */
const FOREIGN_SCRIPT = /[Ͱ-Ͽἀ-῿Ѐ-ӿႠ-ჿ]/;

/* ---- geometry ------------------------------------------------------------------------------------------------------ */
function mPerDeg(lat) { return { y: 111320, x: 111320 * Math.cos(lat * Math.PI / 180) }; }
function distM(a, b) { const m = mPerDeg((a.lat + b.lat) / 2); return Math.hypot((a.lon - b.lon) * m.x, (a.lat - b.lat) * m.y); }
function ringBox(ring) {
  let s = 90, n = -90, w = 180, e = -180;
  for (const p of ring) { if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon; }
  return { s, n, w, e };
}
/* Outline index: which area (of one kind) is a point in? A grid of bounding boxes finds the few candidates, and a
   point-in-polygon test settles it. An area with no outline is not in the index (it is only ever a name and a point). */
function areaIndex(areas) {
  const CELL = 0.05, grid = new Map();
  areas.forEach((a, ai) => {
    if (!a.rings) return;
    a.polys = a.rings.map(r => r.map(p => ({ lat: p[0], lon: p[1] })));
    a.boxes = a.polys.map(ringBox);
    for (const b of a.boxes)
      for (let y = Math.floor(b.s / CELL); y <= Math.floor(b.n / CELL); y++)
        for (let x = Math.floor(b.w / CELL); x <= Math.floor(b.e / CELL); x++) {
          const k = y + ',' + x; let l = grid.get(k); if (!l) { l = []; grid.set(k, l); } if (l[l.length - 1] !== ai) l.push(ai);
        }
  });
  return function which(pt) {
    const l = grid.get(Math.floor(pt.lat / CELL) + ',' + Math.floor(pt.lon / CELL));
    if (!l) return -1;
    let hit = -1, hitArea = Infinity;
    for (const ai of l) {
      const a = areas[ai];
      for (let k = 0; k < a.polys.length; k++) {
        const b = a.boxes[k];
        if (pt.lat < b.s || pt.lat > b.n || pt.lon < b.w || pt.lon > b.e) continue;
        if (pointInRing(pt, a.polys[k])) {
          // the smallest enclosing outline wins: a neighbourhood outline can overlap its district's edge
          const area = (b.n - b.s) * (b.e - b.w);
          if (area < hitArea) { hitArea = area; hit = ai; }
          break;
        }
      }
    }
    return hit;
  };
}
/* a good label point for an area: its box centre when that is inside the outline, else the middle vertex of the biggest ring */
function labelPoint(a) {
  if (a.centre) {
    const c = { lat: a.centre[0], lon: a.centre[1] };
    if (!a.polys || a.polys.some(r => pointInRing(c, r))) return c;
  }
  if (a.polys && a.polys.length) {
    const r = a.polys.slice().sort((x, y) => y.length - x.length)[0];
    let la = 0, lo = 0; for (const p of r) { la += p.lat; lo += p.lon; }
    const c = { lat: la / r.length, lon: lo / r.length };
    if (pointInRing(c, r)) return c;
    return r[r.length >> 1];
  }
  return a.centre ? { lat: a.centre[0], lon: a.centre[1] } : null;
}
function morton(x, y) {                       // 16-bit interleave: neighbours on the ground are neighbours in the file
  let r = 0;
  for (let i = 0; i < 16; i++) r |= (((x >> i) & 1) << (2 * i)) | (((y >> i) & 1) << (2 * i + 1));
  return r >>> 0;
}

/* ---- streets ----------------------------------------------------------------------------------------------------- */
const HW_RANK = { motorway: 3, trunk: 3, primary: 2, secondary: 2, tertiary: 1, motorway_link: 0, trunk_link: 0, primary_link: 0,
                  secondary_link: 0, tertiary_link: 0 };
const HW_ORDER = ['residential', 'unclassified', 'living_street', 'pedestrian', 'road', 'tertiary_link', 'secondary_link', 'primary_link', 'trunk_link',
                  'motorway_link', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
/* Join the ways of ONE street name in ONE district into streets: two ways follow on from each other when their midpoints
   are no further apart than half the sum of their lengths plus a margin. Union-find over the ways, with a coarse grid so
   a name used 400 times (Atatürk Caddesi) is not compared 400 x 400. */
function joinStreets(ways) {
  const n = ways.length, parent = ways.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const MARGIN = 140;
  const order = ways.map((_, i) => i).sort((a, b) => ways[a].lat - ways[b].lat);
  for (let x = 0; x < n; x++) {
    const a = ways[order[x]], m = mPerDeg(a.lat);
    for (let y = x + 1; y < n; y++) {
      const b = ways[order[y]];
      if ((b.lat - a.lat) * m.y > 4000 + MARGIN) break;               // sorted by latitude: nothing further on can be close
      if (distM(a, b) <= (a.len + b.len) / 2 + MARGIN) parent[find(order[x])] = find(order[y]);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); let g = groups.get(r); if (!g) { g = []; groups.set(r, g); } g.push(ways[i]); }
  return [...groups.values()];
}

/* ---- build ------------------------------------------------------------------------------------------------------- */
function build(raw) {
  const warnings = [];
  // ---- areas
  const dist = raw.admin.filter(a => a.level === 6).map(a => Object.assign({}, a));
  const hoodsA = raw.admin.filter(a => a.level === 8).map(a => Object.assign({}, a));
  const whichDist = areaIndex(dist), whichHood = areaIndex(hoodsA);
  const foreignD = new Set(); dist.forEach((a, i) => { if (FOREIGN_SCRIPT.test(a.name)) foreignD.add(i); });
  const nearestCentre = (pt, list) => {                       // fallback for a point that is in no outline (the sea, a gap)
    let best = -1, bd = 5000;
    list.forEach((a, i) => { if (!a.centre || (list === dist && foreignD.has(i))) return; const d = distM(pt, { lat: a.centre[0], lon: a.centre[1] }); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const districtNames = [], hoodNames = [], distIdx = new Map(), hoodIdx = new Map();
  const dOf = i => { if (i < 0) return 0; if (!distIdx.has(i)) { distIdx.set(i, districtNames.length); districtNames.push(cleanName(dist[i].name)); } return distIdx.get(i) + 1; };
  const hOf = i => { if (i < 0) return 0; if (!hoodIdx.has(i)) { hoodIdx.set(i, hoodNames.length); hoodNames.push(hoodName(hoodsA[i].name)); } return hoodIdx.get(i) + 1; };
  const locate = pt => {
    let di = whichDist(pt); if (di >= 0 && foreignD.has(di)) return { skip: true };
    if (di < 0) di = nearestCentre(pt, dist);
    const hi = whichHood(pt);
    return { d: dOf(di), h: hOf(hi) };
  };

  const E = [];                                                // { name, type, lat, lon, d, h, r, en, ar }
  const add = (name, type, lat, lon, rank, en, ar, loc) => {
    name = cleanName(name);
    if (name.length < 2 || DIGITS_ONLY.test(name)) return;
    const l = loc || locate({ lat, lon });
    if (l.skip) return;                                       // inside another country's district
    E.push({ name, type: T[type], lat, lon, d: l.d, h: l.h, r: Math.max(0, Math.min(3, rank)), en: en || '', ar: ar || '' });
  };

  // districts and neighbourhoods, from the outlines
  dist.forEach((a, i) => {
    if (foreignD.has(i)) return;
    const p = labelPoint(a); if (!p) return;
    add(a.name, 'district', p.lat, p.lon, 3, a.en, a.ar, { d: dOf(i), h: 0 });
  });
  const placeAreas = [];                                       // place nodes that name an area, to drop duplicates of the outlines below
  raw.pois.forEach(e => { if (e.tags.place) placeAreas.push({ f: fold(e.tags.name), lat: e.lat, lon: e.lon }); });
  hoodsA.forEach((a, i) => {
    const p = labelPoint(a); if (!p) return;
    if (FOREIGN_SCRIPT.test(a.name)) return;
    { const di0 = whichDist(p); if (di0 >= 0 && foreignD.has(di0)) return; }
    const nm = hoodName(a.name);
    const f = fold(nm);
    if (placeAreas.some(q => q.f === f && distM(q, p) < 2500)) return;       // the place node says the same, better placed
    const di = whichDist(p);
    add(nm, 'hood', p.lat, p.lon, 2, a.en, a.ar, { d: dOf(di >= 0 ? di : nearestCentre(p, dist)), h: hOf(i) });
  });

  // places, landmarks, shops …: de-duplicated by name and type within 80 m (a building and its entrance node, both named)
  const seen = new Map();
  const grid = new Map();
  const near = (key, p) => {
    const gk = Math.floor(p.lat / 0.001) + ',' + Math.floor(p.lon / 0.001);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = grid.get(key + '|' + (Math.floor(p.lat / 0.001) + dy) + ',' + (Math.floor(p.lon / 0.001) + dx));
      if (l && l.some(q => distM(q, p) < 80)) return true;
    }
    (grid.get(key + '|' + gk) || grid.set(key + '|' + gk, []).get(key + '|' + gk)).push(p);
    return false;
  };
  let dropped = 0;
  raw.pois.forEach(e => {
    const k = typeOf(e.tags); if (!k) { dropped++; return; }
    const nm = cleanName(e.tags.name);
    if (k === 'hood' || k === 'district' || k === 'place') {
      const rank = (e.tags.place === 'city' || e.tags.place === 'town') ? 3 : TYPE_RANK[k] || 2;
      const key = k + '|' + fold(nm);
      if (near(key, e)) return;
      add(nm, k, e.lat, e.lon, rank, e.tags['name:en'], e.tags['name:ar']);
      return;
    }
    const key = k + '|' + fold(nm);
    if (near(key, e)) return;
    let rank = TYPE_RANK[k] || 0;
    if (e.tags.wikidata) rank = Math.min(3, rank + 1 + (rank >= 2 ? 0 : 0));
    add(nm, k, e.lat, e.lon, rank, e.tags['name:en'], e.tags['name:ar']);
  });

  // streets
  const byName = new Map();
  for (const w of raw.streets) {
    const loc = locate(w);
    if (loc.skip) continue;
    w._loc = loc;
    const key = fold(w.name) + '|' + loc.d;
    let g = byName.get(key); if (!g) { g = []; byName.set(key, g); } g.push(w);
  }
  let streetCount = 0;
  for (const ways of byName.values()) {
    for (const part of joinStreets(ways)) {
      const total = part.reduce((s, w) => s + w.len, 0);
      // the way nearest the length-weighted centre: the pin goes ON the street, not in the middle of the block beside it
      let la = 0, lo = 0; for (const w of part) { la += w.lat * w.len; lo += w.lon * w.len; }
      la /= total || 1; lo /= total || 1;
      const rep = part.slice().sort((a, b) => distM(a, { lat: la, lon: lo }) - distM(b, { lat: la, lon: lo }))[0];
      let hw = 'residential'; for (const w of part) if (HW_ORDER.indexOf(w.hw) > HW_ORDER.indexOf(hw)) hw = w.hw;
      // a long street, or a big road, is one people know; a 60 m lane is not
      let rank = HW_RANK[hw] || 0; if (rank < 3 && total > 1500) rank += 1;
      if (total < 120 && rank > 0) rank -= 1;
      const best = part.find(w => w.en) || null;
      const spelled = new Map(); for (const w of part) spelled.set(w.name, (spelled.get(w.name) || 0) + w.len);
      const name = [...spelled.entries()].sort((a, b) => b[1] - a[1])[0][0];
      add(name, 'street', rep.lat, rep.lon, rank, best && best.en, (part.find(w => w.ar) || {}).ar, rep._loc);
      streetCount++;
    }
  }

  // ---- encode
  const b = raw.box, W = b.w, S = b.s, DX = b.e - b.w, DY = b.n - b.s;
  const keyed = E.map(e => ({ e, m: morton(Math.max(0, Math.min(65535, ((e.lon - W) / DX * 65535) | 0)), Math.max(0, Math.min(65535, ((e.lat - S) / DY * 65535) | 0))) }));
  keyed.sort((x, y) => x.m - y.m || (x.e.name < y.e.name ? -1 : 1));
  const out = { v: 1, city: raw.city, box: raw.box, osmBase: raw.osmBase || null, types: TYPES, districts: districtNames, hoods: hoodNames,
                n: '', t: [], la: [], lo: [], d: [], h: [], r: [], en: {}, ar: {} };
  const names = [];
  let pla = 0, plo = 0;
  keyed.forEach(({ e }, i) => {
    names.push(e.name);
    out.t.push(e.type); out.d.push(e.d); out.h.push(e.h); out.r.push(e.r);
    const la = Math.round(e.lat * 1e5), lo = Math.round(e.lon * 1e5);
    out.la.push(la - pla); out.lo.push(lo - plo); pla = la; plo = lo;
    if (e.en && fold(e.en) !== fold(e.name)) out.en[i] = cleanName(e.en);
    if (e.ar) out.ar[i] = cleanName(e.ar);
  });
  out.n = names.join('\n');
  out.count = names.length;
  return { out, stats: { entries: names.length, streets: streetCount, dropped, districts: districtNames.length, hoods: hoodNames.length } };
}

function decode(f) {
  const names = f.n.split('\n'), N = names.length, lat = new Float64Array(N), lon = new Float64Array(N);
  let a = 0, o = 0;
  for (let i = 0; i < N; i++) { a += f.la[i]; o += f.lo[i]; lat[i] = a / 1e5; lon[i] = o / 1e5; }
  return { names, lat, lon, t: f.t, d: f.d, h: f.h, r: f.r, types: f.types, districts: f.districts, hoods: f.hoods, en: f.en, ar: f.ar };
}

module.exports = { TYPES, typeOf, fold, hoodName, joinStreets, areaIndex, labelPoint, morton, build, decode };

if (require.main === module) {
  const cities = JSON.parse(fs.readFileSync(path.join(DIR, 'cities.json'), 'utf8'));
  const want = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const list = want.length ? want : Object.keys(cities);
  for (const city of list) {
    const src = path.join(DIR, 'places-osm-' + city + '.json');
    if (!fs.existsSync(src)) { console.log(city.padEnd(10) + 'no dump (run fetch-places.cjs ' + city + ')'); continue; }
    const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
    const { out, stats } = build(raw);
    const dst = path.join(DIR, 'places-' + city + '.json');
    const text = JSON.stringify(out);
    const same = fs.existsSync(dst) && (() => { try { const p = JSON.parse(fs.readFileSync(dst, 'utf8')); return p.n === out.n && JSON.stringify(p.la) === JSON.stringify(out.la) && JSON.stringify(p.t) === JSON.stringify(out.t); } catch (e) { return false; } })();
    if (!same) fs.writeFileSync(dst, text);
    const gz = require('zlib').gzipSync(text).length;
    console.log(city.padEnd(10) + stats.entries + ' entries (' + stats.streets + ' streets, ' + stats.districts + ' districts, ' + stats.hoods + ' neighbourhoods)  ' +
                (text.length / 1024).toFixed(0) + ' KB, ' + (gz / 1024).toFixed(0) + ' KB gzipped  ' + (same ? 'unchanged' : 'written'));
  }
}
