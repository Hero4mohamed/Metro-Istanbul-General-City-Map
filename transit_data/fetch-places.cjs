/* Fetch the named places the app's own search runs over: streets, neighbourhoods and districts, landmarks, shops,
 * food, health, schools, worship — per city, from OpenStreetMap.
 *
 *   node transit_data/fetch-places.cjs [city ...]       (default: every city in cities.json)
 *
 * Writes transit_data/places-osm-<city>.json (gitignored, like the other raw dumps — re-fetch, never commit).
 * process-places.cjs turns that into the compact places-<city>.json the app ships.
 *
 * WHY THIS EXISTS
 * Search used to be a local list of stops and landmarks plus a live call to the public Photon service. Photon's own
 * README says extensive use "will be throttled or completely banned" and promises no availability, which is no
 * foundation for an app people depend on. OpenStreetMap's data is open (ODbL, attribution only), so the places are
 * fetched ONCE here and shipped with the app, and search runs on the device: instant, offline, and nobody's
 * keystrokes leave the phone.
 *
 * WHAT IS KEPT, AND WHAT IS NOT
 * Everything a person would type to go somewhere. Not asked for: unnamed things (a bench has no name), kerbside
 * furniture, parking, individual buildings (23,000 named buildings in İstanbul, nearly all also tagged as a shop, an
 * office or a school, which ARE asked for), and the paths, steps and service roads that carry a street's name in
 * OpenStreetMap without being the street (Bağdat Caddesi is 105 ways, including its footpaths and steps).
 *
 * Be a polite client, like fetch-landuse.cjs: descriptive User-Agent, a pause between requests, a mirror fallback,
 * retries, and the city split into sub-boxes so no single answer is enormous. Each answer is REDUCED as it arrives
 * (a street keeps its middle point and length, not its 40 vertices), so the dump stays small enough to keep around.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { ringsOfElement, simplify } = require('./process-landuse.cjs');

const DIR = __dirname;
const UA = 'istanbul-rail-network/1.0 (places refresh; https://github.com/Hero4mohamed/Metro-Istanbul-General-City-Map)';
const MIRRORS = [
  { host: 'overpass-api.de', path: '/api/interpreter' },
  { host: 'overpass.kumi.systems', path: '/api/interpreter' },
];
const STEP = 0.3;                          // degrees: street geometry is the heavy part; this answers in seconds

/* ---- what is asked for ---------------------------------------------------------------------------------------- */
const STREET_CLASSES = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|road|' +
  'motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const AMENITY = 'restaurant|cafe|fast_food|food_court|bar|pub|ice_cream|biergarten|nightclub|hospital|clinic|doctors|dentist|' +
  'pharmacy|veterinary|university|college|school|kindergarten|library|language_school|bank|post_office|townhall|courthouse|' +
  'police|fire_station|embassy|community_centre|cinema|theatre|arts_centre|casino|marketplace|bus_station|ferry_terminal|' +
  'fuel|place_of_worship|public_bath|events_venue|conference_centre|exhibition_centre|planetarium|car_rental|taxi';
const TOURISM = 'attraction|museum|gallery|hotel|hostel|guest_house|motel|apartment|viewpoint|zoo|aquarium|theme_park|camp_site|resort';
const LEISURE = 'park|garden|stadium|sports_centre|swimming_pool|marina|beach_resort|fitness_centre|nature_reserve|golf_course|water_park';
const PLACE = 'city|town|village|suburb|neighbourhood|quarter|hamlet|island|islet|locality|square|borough|city_block|district';
const NATURAL = 'bay|strait|beach|peak|cape|water|spring|cave_entrance';
const MAN_MADE = 'tower|lighthouse|pier|bridge';

const Q_STREETS = b => `[out:json][timeout:240];
way["highway"~"^(${STREET_CLASSES})$"]["name"](${b});
out tags geom qt;`;
const Q_POIS = b => `[out:json][timeout:240];
(
  nwr["place"~"^(${PLACE})$"]["name"](${b});
  nwr["amenity"~"^(${AMENITY})$"]["name"](${b});
  nwr["tourism"~"^(${TOURISM})$"]["name"](${b});
  nwr["historic"]["name"](${b});
  nwr["leisure"~"^(${LEISURE})$"]["name"](${b});
  nwr["shop"]["name"](${b});
  nwr["office"="government"]["name"](${b});
  nwr["natural"~"^(${NATURAL})$"]["name"](${b});
  nwr["aeroway"~"^(aerodrome|terminal)$"]["name"](${b});
  nwr["man_made"~"^(${MAN_MADE})$"]["name"](${b});
);
out tags center qt;`;
/* Relations need `out body geom`: with `tags` the server sends a box and drops the members, and the members ARE the
   outline (the lesson of the land-use fetch). Level 6 is a district (ilçe), level 8 a neighbourhood (mahalle). */
const Q_ADMIN = b => `[out:json][timeout:240];
relation["boundary"="administrative"]["admin_level"~"^(6|8)$"]["name"](${b});
out body geom qt;`;

/* ---- the network -------------------------------------------------------------------------------------------------- */
function post(mirror, q, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = 'data=' + encodeURIComponent(q);
    const req = https.request({
      host: mirror.host, path: mirror.path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body),
                 'User-Agent': UA, 'Accept': 'application/json' },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout after ' + timeoutMs + 'ms')); });
    req.write(body);
    req.end();
  });
}
async function ask(q) {
  let lastErr = null;
  for (const m of MIRRORS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await post(m, q, 290000);
        if (r.status === 200 && r.body[0] === '{') {
          const j = JSON.parse(r.body);
          if (!Array.isArray(j.elements)) throw new Error('response has no elements array');
          if (j.remark && /runtime error|out of memory/i.test(j.remark)) throw new Error('server: ' + j.remark);
          return j;
        }
        lastErr = new Error(m.host + ' answered HTTP ' + r.status);
        if (r.status === 429 || r.status >= 500) await sleep(9000 * attempt);
        else break;
      } catch (e) { lastErr = e; await sleep(6000 * attempt); }
    }
  }
  throw lastErr || new Error('no mirror answered');
}
const sleep = ms => new Promise(res => setTimeout(res, ms));

/* ---- reducing what comes back ----------------------------------------------------------------------------------- */
const KEEP = ['name', 'name:en', 'name:ar', 'place', 'amenity', 'tourism', 'historic', 'leisure', 'shop', 'office', 'natural',
              'aeroway', 'man_made', 'religion', 'cuisine', 'wikidata'];
function slim(tags) {
  const o = {};
  for (const k of KEEP) if (tags[k]) o[k] = tags[k];
  if (tags['name:en'] === tags.name) delete o['name:en'];
  return o;
}
const mPerDeg = lat => ({ y: 111320, x: 111320 * Math.cos(lat * Math.PI / 180) });
/* a street way -> its name, class, length, and the point half way along it (a pin that lies ON the street) */
function reduceStreet(e) {
  const g = e.geometry;
  if (!g || g.length < 2 || !e.tags || !e.tags.name) return null;
  const m = mPerDeg(g[0].lat);
  const seg = [];
  let len = 0;
  for (let i = 1; i < g.length; i++) {
    const d = Math.hypot((g[i].lon - g[i - 1].lon) * m.x, (g[i].lat - g[i - 1].lat) * m.y);
    seg.push(d); len += d;
  }
  let half = len / 2, i = 0;
  while (i < seg.length - 1 && half > seg[i]) { half -= seg[i]; i++; }
  const t = seg[i] ? half / seg[i] : 0;
  const lat = g[i].lat + (g[i + 1].lat - g[i].lat) * t, lon = g[i].lon + (g[i + 1].lon - g[i].lon) * t;
  const o = { id: e.id, name: e.tags.name, hw: e.tags.highway, lat: +lat.toFixed(6), lon: +lon.toFixed(6), len: Math.round(len) };
  if (e.tags['name:en'] && e.tags['name:en'] !== e.tags.name) o.en = e.tags['name:en'];
  if (e.tags['name:ar']) o.ar = e.tags['name:ar'];
  return o;
}
function reducePoi(e) {
  const lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
  if (lat == null || lon == null || !e.tags || !e.tags.name) return null;
  return { id: e.type[0] + e.id, tags: slim(e.tags), lat: +(+lat).toFixed(6), lon: +(+lon).toFixed(6) };
}
/* an administrative relation -> its name, level and (simplified) outline; no outline = a centre only */
function reduceAdmin(e) {
  const t = e.tags || {};
  const o = { id: e.id, level: +t.admin_level, name: t.name };
  if (t['name:en'] && t['name:en'] !== t.name) o.en = t['name:en'];
  if (t['name:ar']) o.ar = t['name:ar'];
  const rg = ringsOfElement(e);
  if (rg && rg.outers.length) {
    // 30 m is far finer than a "which neighbourhood is this in" question needs, and keeps 1,200 outlines small
    o.rings = rg.outers.map(r => simplify(r, 30).map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5)]));
  }
  const b = e.bounds;
  if (b) o.centre = [+((b.minlat + b.maxlat) / 2).toFixed(5), +((b.minlon + b.maxlon) / 2).toFixed(5)];
  return o;
}

function subBoxes(b) {
  const out = [];
  for (let s = b.s; s < b.n - 1e-9; s += STEP)
    for (let w = b.w; w < b.e - 1e-9; w += STEP)
      out.push({ s: +s.toFixed(4), w: +w.toFixed(4), n: +Math.min(b.n, s + STEP).toFixed(4), e: +Math.min(b.e, w + STEP).toFixed(4) });
  return out;
}

(async () => {
  const cities = JSON.parse(fs.readFileSync(path.join(DIR, 'cities.json'), 'utf8'));
  const want = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const list = want.length ? want : Object.keys(cities);
  let failed = 0;
  for (const city of list) {
    if (!cities[city]) { console.error('unknown city: ' + city); failed++; continue; }
    const file = path.join(DIR, 'places-osm-' + city + '.json');
    const boxes = subBoxes(cities[city].box);
    const t0 = Date.now();
    process.stdout.write(city.padEnd(10) + boxes.length + ' sub-boxes ');
    const streets = new Map(), pois = new Map(), admin = new Map();
    let osmBase = null, bad = null;
    /* The outlines are fetched ONCE for the whole city box, not once per sub-box. A district outline is tens of
       thousands of points and it crosses most of the sub-boxes it sits in, so asking per box re-downloaded the same
       few relations eight to twenty times and was most of the time this took. The streets and places, which really are
       different in every box, are what the sub-boxes are for. */
    try {
      const cb = cities[city].box;
      const ja = await ask(Q_ADMIN(`${cb.s},${cb.w},${cb.n},${cb.e}`));
      for (const e of ja.elements) { const r = reduceAdmin(e); if (r.name) admin.set(r.id, r); }
      process.stdout.write('o');
      await sleep(3500);
    } catch (e) { bad = e; process.stdout.write('x'); }
    for (const bb of bad ? [] : boxes) {
      const b = `${bb.s},${bb.w},${bb.n},${bb.e}`;
      try {
        const js = await ask(Q_STREETS(b)); osmBase = osmBase || (js.osm3s && js.osm3s.timestamp_osm_base) || null;
        for (const e of js.elements) { const r = reduceStreet(e); if (r) streets.set(r.id, r); }
        await sleep(3000);
        const jp = await ask(Q_POIS(b));
        for (const e of jp.elements) { const r = reducePoi(e); if (r) pois.set(r.id, r); }
        process.stdout.write('.');
      } catch (e) { bad = e; process.stdout.write('x'); break; }
      await sleep(3500);
    }
    if (bad) { failed++; console.log(' FAILED — ' + bad.message + ' (existing file left untouched)'); continue; }
    const out = { fetched: new Date().toISOString(), osmBase, city, box: cities[city].box,
                  streets: [...streets.values()], pois: [...pois.values()], admin: [...admin.values()] };
    fs.writeFileSync(file, JSON.stringify(out));
    const withRings = out.admin.filter(a => a.rings).length;
    console.log(' ' + out.streets.length + ' street ways, ' + out.pois.length + ' places, ' + out.admin.length + ' boundaries (' +
                withRings + ' with outlines)  (OSM data as of ' + (osmBase || '?') + ', ' + ((Date.now() - t0) / 60000).toFixed(1) + ' min)');
    await sleep(4000);
  }
  if (failed) { console.error(failed + ' city fetch(es) failed; existing files were left untouched.'); process.exit(1); }
})();
