/* Fetch every railway that OpenStreetMap records as UNDER CONSTRUCTION or PROPOSED, per city.
 *
 *   node transit_data/fetch-planned.cjs [city ...]      (default: every city in cities.json)
 *
 * Writes transit_data/planned-osm-<city>.json (gitignored, like the other raw dumps — re-fetch,
 * never commit). process-planned.cjs turns those, plus the curated planned-registry.json, into
 * planned-lines.json.
 *
 * WHY OSM IS THE GEOMETRY SOURCE
 * The previous pipeline asked Overpass for seven hand-picked route RELATIONS and typed ten more
 * lines in by hand as 3-point polylines. But the people who map this city record planned and
 * in-construction rail as plain ways — tagged `railway=construction|proposed` plus
 * `construction:railway=subway` / `proposed:railway=…` — with no relation around them, so a
 * relation query never sees them. Querying the ways directly finds 889 of them in İstanbul alone,
 * with real alignments (5-30 vertices per km, bending the way a designed tunnel bends), official
 * project names, tunnel depth, and the stations as tagged nodes on the line. That replaced a
 * hand-typed straight segment of up to 9 km with the surveyed route.
 *
 * What is NOT queried, deliberately: `rail` mainline projects (TCDD high-speed, freight bypasses)
 * stay out of the urban Vision tab — they belong to Intercity — and depots, crossovers and
 * sidings are filtered later, not here, so the raw file stays a faithful copy of what OSM says.
 *
 * Be a polite client: one query per city, a descriptive User-Agent, a pause between cities, and a
 * mirror fallback. Overpass is a free public service.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const UA = 'istanbul-rail-network/1.0 (planned-lines refresh; https://github.com/Hero4mohamed/Metro-Istanbul-General-City-Map)';
const MIRRORS = [
  { host: 'overpass-api.de', path: '/api/interpreter' },
  { host: 'overpass.kumi.systems', path: '/api/interpreter' },
];

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

function query(b) {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  return `[out:json][timeout:240];
(
  way["railway"~"^(construction|proposed)$"](${bb});
  way["construction:railway"](${bb});
  way["proposed:railway"](${bb});
)->.w;
.w out body geom;
(
  node(w.w)[~"^(name|railway|public_transport|station|proposed|construction|proposed:railway|construction:railway)$"~"."];
  node["railway"~"^(proposed|construction)$"](${bb});
  node["proposed:railway"](${bb});
  node["construction:railway"](${bb});
);
out body;`;
}

async function fetchCity(city, box) {
  const q = query(box);
  let lastErr = null;
  for (const m of MIRRORS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await post(m, q, 280000);
        if (r.status === 200) {
          const j = JSON.parse(r.body);
          if (!Array.isArray(j.elements)) throw new Error('response has no elements array');
          return j;
        }
        lastErr = new Error(m.host + ' answered HTTP ' + r.status);
        if (r.status === 429 || r.status >= 500) await new Promise(res => setTimeout(res, 8000 * attempt));
        else break;                                  // a 4xx is our query's fault: do not hammer it
      } catch (e) {
        lastErr = e;
        await new Promise(res => setTimeout(res, 5000 * attempt));
      }
    }
  }
  throw lastErr || new Error('no mirror answered');
}

(async () => {
  const cities = JSON.parse(fs.readFileSync(path.join(DIR, 'cities.json'), 'utf8'));
  const want = process.argv.slice(2);
  const list = want.length ? want : Object.keys(cities);
  let failed = 0;
  for (const city of list) {
    if (!cities[city]) { console.error('unknown city: ' + city); failed++; continue; }
    process.stdout.write(city.padEnd(10));
    try {
      const j = await fetchCity(city, cities[city].box);
      const ways = j.elements.filter(e => e.type === 'way').length, nodes = j.elements.length - ways;
      /* keep the server's own timestamp: it is what makes "when was this true" answerable later */
      const out = { fetched: new Date().toISOString(), osmBase: j.osm3s && j.osm3s.timestamp_osm_base || null,
                    city, box: cities[city].box, elements: j.elements };
      fs.writeFileSync(path.join(DIR, 'planned-osm-' + city + '.json'), JSON.stringify(out));
      console.log(ways + ' ways, ' + nodes + ' nodes  (OSM data as of ' + (out.osmBase || '?') + ')');
    } catch (e) {
      failed++;
      console.log('FAILED — ' + e.message);
    }
    await new Promise(res => setTimeout(res, 4000));  // pause between cities
  }
  if (failed) { console.error(failed + ' city fetch(es) failed; existing files were left untouched.'); process.exit(1); }
})();
