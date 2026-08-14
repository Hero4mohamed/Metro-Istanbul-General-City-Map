/* Bus routes for the cities with no official open feed (Ankara, İzmir, Bursa, Antalya).
 *
 * İstanbul has an İETT GTFS feed and Kocaeli publishes its own route pages; these four do
 * not expose anything comparable, so the uniform source is OpenStreetMap. OSM gives ordered
 * stops, refs, endpoints and operator, which is enough for the directory, the map and the
 * routing graph. It does NOT give timetables — no schedules are written for these cities and
 * the app must keep saying "no schedule" rather than inventing headways.
 *
 * Usage:  node fetch-city-bus.cjs [city ...]     (default: all four)
 * Writes: <city>-bus-osm.json  (raw Overpass payload, git-ignored; processed separately)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const CITIES = JSON.parse(fs.readFileSync(path.join(DIR, 'cities.json'), 'utf8'));
const TARGETS = process.argv.slice(2).length ? process.argv.slice(2)
                                             : ['ankara', 'izmir', 'bursa', 'antalya'];
// Overpass rejects the default agent with 406, and PowerShell's clients mangle UTF-8 —
// curl.exe writing raw bytes is the combination that has worked for this project.
const UA = 'raynet-transit-map/1.0 (github.com/Hero4mohamed/Metro-Istanbul-General-City-Map)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function query(box) {
  // relations first, then only their member NODES (the stops). Pulling member ways as well
  // would drag in the whole road network and turn a 10 MB answer into hundreds of MB.
  return `[out:json][timeout:900];
rel["type"="route"]["route"="bus"](${box.s},${box.w},${box.n},${box.e});
out body;
node(r);
out body;`;
}

for (const city of TARGETS) {
  const meta = CITIES[city];
  if (!meta) { console.error('unknown city:', city); continue; }
  const out = path.join(DIR, city + '-bus-osm.json');
  const qFile = path.join(DIR, '.overpass-' + city + '.ql');
  fs.writeFileSync(qFile, query(meta.box), 'utf8');

  let ok = false;
  for (const ep of ENDPOINTS) {
    process.stdout.write(`${city}: querying ${new URL(ep).host} … `);
    const t0 = Date.now();
    try {
      execFileSync('curl.exe', ['-s', '-S', '--fail', '-A', UA,
        '--max-time', '900', '-o', out, '--data-binary', '@' + qFile, ep],
        { stdio: ['ignore', 'inherit', 'inherit'] });
      const size = fs.statSync(out).size;
      if (size < 2000) throw new Error('suspiciously small answer (' + size + ' bytes)');
      const j = JSON.parse(fs.readFileSync(out, 'utf8'));
      const rels = (j.elements || []).filter(e => e.type === 'relation').length;
      const nodes = (j.elements || []).filter(e => e.type === 'node').length;
      console.log(`ok  ${(size / 1048576).toFixed(1)} MB  ${rels} routes  ${nodes} stop-nodes  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      ok = true;
      break;
    } catch (e) {
      console.log('failed — ' + (e.message || e).toString().split('\n')[0]);
    }
  }
  fs.unlinkSync(qFile);
  if (!ok) console.error(city + ': NO DATA (all endpoints failed)');
}
