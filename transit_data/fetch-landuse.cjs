/* Fetch the land-use polygons the basemap paints under the streets: forests, parks, airports and
 * campuses, per city, from OpenStreetMap.
 *
 *   node transit_data/fetch-landuse.cjs [city ...]      (default: every city in cities.json)
 *
 * Writes transit_data/landuse-osm-<city>.json (gitignored, like the other raw dumps — re-fetch,
 * never commit). process-landuse.cjs turns that into the small landuse-<city>.json the app ships.
 *
 * WHY THIS EXISTS
 * Esri's Streets raster, which is the only keyless street basemap left, draws a park as a pale
 * green and everything else — forest, meadow, an airport — as the same beige as the rest of the
 * land. The map people compare this to (Google's dark map) tells a forest from a park from a
 * runway at a glance, and a regrade of the raster cannot invent a distinction the raster never
 * drew. OpenStreetMap records all of it as polygons, so those are what is fetched.
 *
 * Be a polite client, like fetch-planned.cjs: descriptive User-Agent, a pause between requests,
 * a mirror fallback, and the city split into sub-boxes so no single answer is enormous.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const UA = 'istanbul-rail-network/1.0 (land-use refresh; https://github.com/Hero4mohamed/Metro-Istanbul-General-City-Map)';
const MIRRORS = [
  { host: 'overpass-api.de', path: '/api/interpreter' },
  { host: 'overpass.kumi.systems', path: '/api/interpreter' },
];
const STEP = 0.45;                         // degrees: a sub-box this size answers in seconds, not minutes

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

/* Everything the classifier in process-landuse.cjs can use, and nothing else. Farmland, meadow,
   cemetery and industrial land are deliberately not asked for: they would tint most of the
   countryside and turn a calm map into a patchwork.

   Ways and relations are asked for in two statements on purpose. A way carries its outline with
   `out tags geom`. A RELATION does not: with `tags` the server sends the bounding box and drops the
   members, and the members are the outline — so Belgrad Forest came back as a name and a rectangle.
   A relation needs `out body geom`. (Relations are the minority — a few hundred against tens of
   thousands of ways — so the heavier output costs little.) */
const WAY_TAGS = `
  way["natural"="wood"](B);
  way["landuse"="forest"](B);
  way["leisure"~"^(nature_reserve|park|garden|golf_course|recreation_ground|common)$"](B);
  way["landuse"~"^(grass|village_green|recreation_ground)$"](B);
  way["aeroway"="aerodrome"](B);
  way["amenity"~"^(university|college|hospital)$"](B);`;
const REL_TAGS = `
  relation["natural"="wood"](B);
  relation["landuse"="forest"](B);
  relation["leisure"~"^(nature_reserve|park|garden|golf_course|recreation_ground|common)$"](B);
  relation["aeroway"="aerodrome"](B);
  relation["amenity"~"^(university|college|hospital)$"](B);`;
function query(bb, what) {
  const b = `${bb.s},${bb.w},${bb.n},${bb.e}`;
  const fill = t => t.split('(B)').join('(' + b + ')');
  const ways = '(' + fill(WAY_TAGS) + '\n);\nout tags geom qt;';
  const rels = '(' + fill(REL_TAGS) + '\n);\nout body geom qt;';
  return '[out:json][timeout:200];\n' + (what === 'relations' ? rels : what === 'ways' ? ways : ways + '\n' + rels);
}

async function fetchBox(bb, what) {
  const q = query(bb, what);
  let lastErr = null;
  for (const m of MIRRORS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await post(m, q, 280000);
        if (r.status === 200) {
          const j = JSON.parse(r.body);
          if (!Array.isArray(j.elements)) throw new Error('response has no elements array');
          if (j.remark && /runtime error|out of memory/i.test(j.remark)) throw new Error('server: ' + j.remark);
          return j;
        }
        lastErr = new Error(m.host + ' answered HTTP ' + r.status);
        if (r.status === 429 || r.status >= 500) await new Promise(res => setTimeout(res, 9000 * attempt));
        else break;
      } catch (e) {
        lastErr = e;
        await new Promise(res => setTimeout(res, 6000 * attempt));
      }
    }
  }
  throw lastErr || new Error('no mirror answered');
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
  const args = process.argv.slice(2);
  /* --relations-only re-fetches just the relations into an existing dump (the way to repair a dump made
     before relations were asked for properly) and leaves its ways exactly as they are. */
  const relOnly = args.includes('--relations-only');
  const want = args.filter(a => !a.startsWith('--'));
  const list = want.length ? want : Object.keys(cities);
  let failed = 0;
  for (const city of list) {
    if (!cities[city]) { console.error('unknown city: ' + city); failed++; continue; }
    const file = path.join(DIR, 'landuse-osm-' + city + '.json');
    let prev = null;
    if (relOnly) {
      if (!fs.existsSync(file)) { console.error(city + ': no dump to repair'); failed++; continue; }
      prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    const boxes = subBoxes(cities[city].box);
    process.stdout.write(city.padEnd(10) + boxes.length + ' sub-boxes ' + (relOnly ? '(relations only) ' : ''));
    const byId = new Map();
    if (prev) for (const e of prev.elements) if (e.type !== 'relation') byId.set(e.type + e.id, e);
    let osmBase = prev && prev.osmBase || null, bad = null;
    for (const bb of boxes) {
      try {
        const j = await fetchBox(bb, relOnly ? 'relations' : 'both');
        osmBase = osmBase || (j.osm3s && j.osm3s.timestamp_osm_base) || null;
        for (const e of j.elements) byId.set(e.type + e.id, e);
        process.stdout.write('.');
      } catch (e) { bad = e; process.stdout.write('x'); break; }
      await new Promise(res => setTimeout(res, 3500));
    }
    if (bad) { failed++; console.log(' FAILED — ' + bad.message + ' (existing file left untouched)'); continue; }
    const elements = [...byId.values()];
    /* keep the server's own timestamp: it is what makes "when was this true" answerable later */
    const out = { fetched: new Date().toISOString(), osmBase, city, box: cities[city].box, elements };
    fs.writeFileSync(file, JSON.stringify(out));
    const withGeom = elements.filter(e => e.type === 'relation' && (e.members || []).some(m => m.geometry)).length;
    console.log(' ' + elements.length + ' elements, ' + elements.filter(e => e.type === 'relation').length + ' relations (' + withGeom + ' with outlines)  (OSM data as of ' + (osmBase || '?') + ')');
    await new Promise(res => setTimeout(res, 4000));
  }
  if (failed) { console.error(failed + ' city fetch(es) failed; existing files were left untouched.'); process.exit(1); }
})();
