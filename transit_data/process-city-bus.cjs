/* Turn the raw OSM bus payload (fetch-city-bus.cjs) into the same shapes the app already
 * consumes for İstanbul and Kocaeli:
 *     <city>-bus-directory.json  [{ref, from, to, id, op, desc}]
 *     <city>-bus-graph.json      [{ref, dir, head, stops:[[lat,lng,name], …]}]
 *     <city>-bus-schedules.json  {}   ← deliberately EMPTY
 *
 * OSM has no timetables. İstanbul's first/last/headway come from the İETT GTFS feed and
 * Kocaeli's from its published route pages; neither exists for these cities, so no schedule
 * is written and the app keeps saying it has none rather than inventing headways.
 *
 * Usage: node process-city-bus.cjs [city ...]
 */
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const TARGETS = process.argv.slice(2).length ? process.argv.slice(2)
                                             : ['ankara', 'izmir', 'bursa', 'antalya'];

/* A bounding box does not respect a city boundary — this project has been bitten by that
 * before, when İstanbul's box reached into Kocaeli and stole its "M2"/"T2" refs. The same
 * thing happens here: İzmir's box covers Manisa, and 22 of the 51 routes it returned were
 * Manisa co-operatives, not ESHOT. So a route is kept only when its operator is the city's
 * own. Routes with NO operator tag are dropped too: they cannot be attributed, and a smaller
 * correct directory beats a larger one carrying another city's buses.  */
const OPERATOR = {
  ankara:  /\bego\b/i,        // EGO Genel Müdürlüğü (spelled several ways in OSM)
  izmir:   /\beshot\b/i,      // ESHOT — İzmir's municipal operator
  bursa:   /burulaş|bursa/i,
  antalya: /antalya/i
};

for (const city of TARGETS) {
  const raw = path.join(DIR, city + '-bus-osm.json');
  if (!fs.existsSync(raw)) { console.error(city + ': no ' + path.basename(raw) + ' — run fetch-city-bus.cjs first'); continue; }
  const j = JSON.parse(fs.readFileSync(raw, 'utf8'));
  const nodes = new Map();
  for (const e of j.elements) if (e.type === 'node') nodes.set(e.id, e);

  const dir = [], graph = [];
  const perRef = new Map();                       // ref -> how many directions seen so far
  let skippedNoRef = 0, skippedNoStops = 0, skippedForeign = 0;
  const wantOp = OPERATOR[city];

  for (const e of j.elements) {
    if (e.type !== 'relation') continue;
    const tg = e.tags || {};
    const ref = (tg.ref || '').trim();
    if (!ref) { skippedNoRef++; continue; }        // an unnumbered route is not usable in a directory
    if (wantOp && !wantOp.test(tg.operator || '')) { skippedForeign++; continue; }   // another city's bus

    // stops are the members carrying a stop/platform role; keep OSM's order, it is the ride order
    const stops = [];
    for (const m of (e.members || [])) {
      if (m.type !== 'node') continue;
      if (!/^(stop|platform)/.test(m.role || '')) continue;
      const nd = nodes.get(m.ref);
      if (!nd || nd.lat == null) continue;
      const nm = (nd.tags && (nd.tags.name || nd.tags['name:tr'])) || '';
      const last = stops[stops.length - 1];
      if (last && last[0] === nd.lat && last[1] === nd.lon) continue;   // duplicate stop/platform pair
      stops.push([+nd.lat.toFixed(5), +nd.lon.toFixed(5), nm]);
    }
    if (stops.length < 2) { skippedNoStops++; continue; }

    const named = stops.filter(s => s[2]);
    const from = (tg.from || (named[0] && named[0][2]) || '').trim();
    const to   = (tg.to   || (named[named.length - 1] && named[named.length - 1][2]) || '').trim();
    const d = perRef.get(ref) || 0;
    perRef.set(ref, d + 1);

    graph.push({ ref, dir: d, head: to, stops });
    if (d === 0) dir.push({ ref, from, to, id: dir.length, op: (tg.operator || '').trim(), desc: (tg.name || '').trim() });
  }

  // natural-ish order: numeric refs by number, then the rest alphabetically
  const key = r => { const m = /^(\d+)/.exec(r); return m ? +m[1] : Infinity; };
  dir.sort((a, b) => key(a.ref) - key(b.ref) || a.ref.localeCompare(b.ref, 'tr'));
  dir.forEach((d, i) => { d.id = i; });

  fs.writeFileSync(path.join(DIR, city + '-bus-directory.json'), JSON.stringify(dir));
  fs.writeFileSync(path.join(DIR, city + '-bus-graph.json'), JSON.stringify(graph));
  fs.writeFileSync(path.join(DIR, city + '-bus-schedules.json'), JSON.stringify({}));

  const withNames = graph.reduce((a, g) => a + g.stops.filter(s => s[2]).length, 0);
  const totalStops = graph.reduce((a, g) => a + g.stops.length, 0);
  console.log(`${city}: ${dir.length} lines, ${graph.length} directions, ${totalStops} stops ` +
              `(${Math.round(withNames / (totalStops || 1) * 100)}% named)` +
              (skippedNoRef ? `  [skipped ${skippedNoRef} unnumbered]` : '') +
              (skippedForeign ? `  [skipped ${skippedForeign} not ${city}'s operator]` : '') +
              (skippedNoStops ? `  [skipped ${skippedNoStops} without stops]` : ''));
}
