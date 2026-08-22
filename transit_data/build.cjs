// Inject the processed network JSON into the app template → single self-contained file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');   // Content-Security-Policy hashes for the inline script
const DIR = __dirname;
const ROOT = path.resolve(DIR, '..');

const template = fs.readFileSync(path.join(DIR, 'app.template.html'), 'utf8');
const active  = JSON.parse(fs.readFileSync(path.join(DIR, 'lines.json'), 'utf8'));
const b2      = JSON.parse(fs.readFileSync(path.join(DIR, 'b2-line.json'), 'utf8'));        // B2 suburban line
const ferry   = JSON.parse(fs.readFileSync(path.join(DIR, 'ferry-lines.json'), 'utf8'));
const cable   = JSON.parse(fs.readFileSync(path.join(DIR, 'cable-lines.json'), 'utf8'));        // TF1/TF2 aerial cable cars
const planned = JSON.parse(fs.readFileSync(path.join(DIR, 'planned-lines.json'), 'utf8'));
const manual  = JSON.parse(fs.readFileSync(path.join(DIR, 'planned-manual.json'), 'utf8'));  // hand-placed approx lines
// Bus networks, per city. İstanbul comes from the İETT GTFS pipeline (with real road shape
// per route); Kocaeli is scraped from Kocaeli BB's own route pages by fetch-kocaeli-bus.cjs
// and has no road geometry, so the app falls back to the stop polyline for it.
// İstanbul comes from the İETT GTFS feed and Kocaeli from its published route pages, so both
// carry real timetables. Ankara and İzmir have no comparable open feed; their routes come from
// OpenStreetMap (see fetch-city-bus.cjs), which has stops and ordering but NO times — their
// schedule files are deliberately empty rather than filled with invented headways.
// İzmir, Bursa and Antalya are fetched and processed too, but are NOT listed here, because
// what OSM holds for them would misrepresent the network rather than describe it:
//   İzmir   — 29 ESHOT routes of ~300, and only ~6 stops per route (Ankara averages 62),
//             so the shapes would draw as crude straight lines between a handful of points.
//   Bursa   — 4 usable routes.      Antalya — 3 usable routes.
// Their files stay on disk so a later OSM improvement only needs re-processing, not re-deciding.
const BUS_CITIES = {
  istanbul: { dir:'bus-directory.json', graph:'bus-graph.json', sched:'bus-schedules.json', geom:'bus-geom.json' },
  kocaeli:  { dir:'kocaeli-bus-directory.json', graph:'kocaeli-bus-graph.json', sched:'kocaeli-bus-schedules.json' },
  ankara:   { dir:'ankara-bus-directory.json', graph:'ankara-bus-graph.json', sched:'ankara-bus-schedules.json' }
};
const rd = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const opt = f => (f && fs.existsSync(path.join(DIR, f))) ? rd(f) : {};
const busSets = {};
for (const [city, f] of Object.entries(BUS_CITIES))
  busSets[city] = { dir: rd(f.dir), graph: rd(f.graph), sched: rd(f.sched), geom: opt(f.geom) };
/* The directory and the graph come from DIFFERENT sources — the directory from İETT's published
   line list (process-bus.cjs), the graph and timetables from the GTFS feed — and they disagree.
   40 İstanbul refs (14E, 19FB, 29Ş, 34A …) exist in the graph with full stops and schedules but
   were absent from the line list, so the planner would happily route you onto a bus that the
   Buses directory could not show or search. The graph carries everything a directory row needs,
   so those rows are reconstructed here rather than left missing.
   Done in memory: the source files stay exactly as their scrapers wrote them, and a re-scrape
   cannot undo the merge. Casing is left as the operator publishes it — title-casing Turkish
   text mangles İ and ı, and the directory already mixes both styles. */
function completeDirectory(city, s) {
  const known = new Set(s.dir.map(d => String(d.ref)));
  const byRef = new Map();
  for (const g of s.graph) {
    const ref = String(g.ref);
    if (known.has(ref)) continue;
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push(g);
  }
  if (!byRef.size) return s.dir;
  const added = [];
  for (const [ref, dirs] of byRef) {
    const a = dirs.find(d => d.dir === 0) || dirs[0];
    const first = (a.stops && a.stops[0] && a.stops[0][2]) || '';
    const last = a.head || (a.stops && a.stops[a.stops.length - 1] && a.stops[a.stops.length - 1][2]) || '';
    if (!first && !last) continue;                 // nothing usable; better absent than blank
    added.push({ ref, from: first, to: last, id: null, op: '', fromGraph: true });
  }
  if (added.length) console.log('  ' + city + ': recovered ' + added.length +
    ' route(s) present in the graph but missing from the directory');
  return s.dir.concat(added);
}
const busDirs = Object.fromEntries(
  Object.entries(busSets).map(([c, s]) => [c, completeDirectory(c, s)]));
const disrupt = JSON.parse(fs.readFileSync(path.join(DIR, 'disruptions.json'), 'utf8'));     // live faults/closures
const miStns  = JSON.parse(fs.readFileSync(path.join(DIR, 'mi-stations.json'), 'utf8'));     // official station ids (exact timetables)
const access  = JSON.parse(fs.readFileSync(path.join(DIR, 'accessibility.json'), 'utf8'));   // İBB+OSM step-free/elevator data
const attract = JSON.parse(fs.readFileSync(path.join(DIR, 'attractions.json'), 'utf8'));     // curated İstanbul landmarks for Explore
const openings= JSON.parse(fs.readFileSync(path.join(DIR, 'openings.json'), 'utf8'));        // curated projected new-line opening dates (İBB targets)
const cardImg = JSON.parse(fs.readFileSync(path.join(DIR, 'card-images.json'), 'utf8'));     // official card artwork as data URIs (PD, Belbim via Commons)
const intercity=JSON.parse(fs.readFileSync(path.join(DIR, 'intercity-lines.json'), 'utf8')); // TCDD national rail (YHT + ana hat), scope:'intercity'
const cities  = JSON.parse(fs.readFileSync(path.join(DIR, 'cities.json'), 'utf8'));           // per-city meta (centre, fares, districts…)
const ankara  = JSON.parse(fs.readFileSync(path.join(DIR, 'ankara-lines.json'), 'utf8'));     // EGO metro/Ankaray + Başkentray
const izmir   = JSON.parse(fs.readFileSync(path.join(DIR, 'izmir-lines.json'), 'utf8'));      // İzmir Metro + İZBAN + trams
const bursa   = JSON.parse(fs.readFileSync(path.join(DIR, 'bursa-lines.json'), 'utf8'));      // BursaRay B1/B2 + trams
const antalya = JSON.parse(fs.readFileSync(path.join(DIR, 'antalya-lines.json'), 'utf8'));    // AntRay T1A/T1B/T2/T3
const kocaeli = JSON.parse(fs.readFileSync(path.join(DIR, 'kocaeli-lines.json'), 'utf8'));    // Akçaray T1/T2/T3 + M1/M2 projects
// each city carries its own line set; the app picks one at boot and derives EVERYTHING
// (station registry, routing graph, sim, legend, stats) from it. Intercity is national, so it
// is shipped separately and appended to whichever city is active.
cities.istanbul.lines = active.concat(b2, ferry, cable, planned, manual);
cities.ankara.lines   = ankara;
cities.izmir.lines    = izmir;
cities.bursa.lines    = bursa;
cities.antalya.lines  = antalya;
cities.kocaeli.lines  = kocaeli;
const data = JSON.stringify(cities);

// lift the TR→EN translator out of the scraper so the CLIENT can re-translate any
// disruption that still contains Turkish (safety net for wording newer than the vocab)
const scraper = fs.readFileSync(path.join(DIR, 'scrape-disruptions.cjs'), 'utf8');
const tStart = scraper.indexOf('// ==TRANSLATOR-START=='), tEnd = scraper.indexOf('// ==TRANSLATOR-END==');
if (tStart < 0 || tEnd < 0) { console.error('translator markers missing in scrape-disruptions.cjs'); process.exit(1); }
const translatorJS = scraper.slice(tStart, tEnd);

/* The application source lives in transit_data/src/*.js and is concatenated here, in filename
   order, into the single inline script the page ships.

   This is deliberately concatenation and not a bundler. The app is one self-contained HTML file
   that works from file:// with no tooling, and adding a bundler would mean a dependency this
   machine cannot reliably install. Concatenating in a fixed order is also what makes the split
   provably safe on a codebase with one shared scope: the assembled text is byte-identical to
   the file it replaced, so no declaration order or hoisting behaviour can have changed.

   What this buys is navigability, not isolation. The 20 files are still one scope once joined;
   a name collision is exactly as possible as it was. Real isolation needs ES modules, and this
   is the step that makes that conversion approachable rather than the conversion itself. */
const SRC = path.join(DIR, 'src');
const srcFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
if (!srcFiles.length) { console.error('no source files in transit_data/src'); process.exit(1); }
const appJs = srcFiles.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('');
if (!template.includes('__APP_JS__')) { console.error('token missing: __APP_JS__'); process.exit(1); }


/* Data provenance. Every shipped dataset declares where it came from and how far it can be
   trusted; the freshness figure is the file's real modification time, measured here rather
   than claimed, so a stale scrape cannot quietly present itself as current. The app uses the
   "kind" to decide how to word itself: operator data may be stated plainly, community and
   scraped data must say so. */
const provenance = JSON.parse(fs.readFileSync(path.join(DIR, 'provenance.json'), 'utf8'));
for (const [file, meta] of Object.entries(provenance.datasets)) {
  const p = path.join(DIR, file);
  meta.updated = fs.existsSync(p) ? fs.statSync(p).mtime.toISOString() : null;
  meta.present = fs.existsSync(p);
}
const staleDays = Object.values(provenance.datasets)
  .filter(m => m.present && m.kind === 'scraped')
  .map(m => (Date.now() - Date.parse(m.updated)) / 86400000);
const buildStamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
// the script goes in FIRST: every other token below lives inside the application source
let html = template.replace('__APP_JS__', () => appJs);

for (const t of ['__CITIES_JSON__','__INTERCITY_JSON__','__BUS_JSON__','__DISRUPTIONS_JSON__','__OPENINGS_JSON__','__MISTATIONS_JSON__','__ACCESS_JSON__','__ATTRACTIONS_JSON__','__CARDIMG_JSON__','__TRANSLATOR_JS__','__BUILD__','__PROVENANCE_JSON__'])
  if (!html.includes(t)) { console.error('token missing:', t); process.exit(1); }

html = html.replace('__BUILD__', () => buildStamp)
                     .replace('__CITIES_JSON__', data)
                     .replace('__INTERCITY_JSON__', () => JSON.stringify(intercity))
                     .replace('__BUS_JSON__', () => JSON.stringify(busDirs))
                     .replace('__DISRUPTIONS_JSON__', JSON.stringify(disrupt))
                     .replace('__OPENINGS_JSON__', () => JSON.stringify(openings))
                     .replace('__MISTATIONS_JSON__', JSON.stringify(miStns))
                     .replace('__ACCESS_JSON__', () => JSON.stringify(access))
                     .replace('__ATTRACTIONS_JSON__', () => JSON.stringify(attract))
                     .replace('__CARDIMG_JSON__', () => JSON.stringify(cardImg))
                     .replace('__TRANSLATOR_JS__', () => translatorJS)
                     .replace('__PROVENANCE_JSON__', () => JSON.stringify(provenance));
console.log('İSTANBUL:', cities.istanbul.lines.length, ' ANKARA:', ankara.length, ' İZMİR:', izmir.length, ' BURSA:', bursa.length, ' ANTALYA:', antalya.length, ' KOCAELİ:', kocaeli.length,
            ' INTERCITY:', intercity.length,
            ' BUSES:', Object.entries(busSets).map(([c, s]) => c + ':' + s.dir.length).join(' '),
            ' DISRUPTIONS:', disrupt.length, ' MISTATIONS:', miStns.length, ' ACCESS:', access.length);

/* ---- Content-Security-Policy -----------------------------------------------------------
   GitHub Pages serves static files and cannot set response headers, so the policy ships as a
   <meta> tag. That costs us frame-ancestors and report-uri, which meta CSP does not support;
   everything else applies normally.

   script-src is the strict half and the half that matters: the app's one inline script is
   allowed by HASH, computed here from the exact bytes just assembled, so any injected script —
   including anything that came in through the scraped disruption text — is refused. There is
   no eval anywhere in the app, so 'unsafe-eval' is not granted.

   style-src keeps 'unsafe-inline' deliberately. 66 elements carry style="" attributes, which a
   hash cannot cover, and CSP3 ignores 'unsafe-inline' as soon as a hash is present — so hashing
   the stylesheet would break every one of them. Style injection is a far smaller problem than
   script injection, and this is the honest trade rather than a policy that only looks strict. */
/* The HTML parser normalises CRLF to LF before the script text is hashed for CSP, and this
   repo checks out with CRLF on Windows — 5,854 of them in the app script. Hashing the bytes
   on disk produced a policy that blocked the entire application. Normalise first. */
const LF = s => s.split('\r\n').join('\n');
const sha256 = s => "'sha256-" +
  crypto.createHash('sha256').update(LF(s), 'utf8').digest('base64') + "'";
const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
if (!inlineScript) { console.error('CSP: inline script not found'); process.exit(1); }

const CSP = [
  "default-src 'self'",
  "script-src 'self' " + sha256(inlineScript[1]) + ' https://unpkg.com',
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  'font-src https://fonts.gstatic.com data:',
  // tiles come from CARTO and Esri; card art and marker icons are data: URIs
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://server.arcgisonline.com",
  // every host the app fetches from, including tiles (the offline save uses fetch, not <img>)
  ["connect-src 'self'",
   'https://*.basemaps.cartocdn.com', 'https://server.arcgisonline.com',
   'https://photon.komoot.io', 'https://overpass-api.de', 'https://api.ibb.gov.tr',
   'https://api.open-meteo.com', 'https://routing.openstreetmap.de',
   'https://api.anthropic.com'].join(' '),
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

if (html.indexOf('__CSP__') < 0) { console.error('CSP: __CSP__ placeholder missing from the template'); process.exit(1); }
html = html.replace('__CSP__', () => CSP);

const outPath = path.join(ROOT, 'index.html');   // GitHub Pages serves the repo-root index.html
fs.writeFileSync(outPath, html);
console.log('WROTE', outPath, (fs.statSync(outPath).size/1024).toFixed(1), 'KB',
            ' cardArt:', Object.keys(cardImg.cities).map(c=>c+'×'+Object.keys(cardImg.cities[c]).length).join(' '));

/* Bus data is the heaviest thing the app fetches, and it is split in two because the halves
   are needed at very different moments.

   graph + schedules drive the directory, search, routing and timetables, so they are needed as
   soon as anyone opens the Buses tab. Road GEOMETRY is only read when a specific route is
   drawn, which most visitors never do — and for İstanbul it is the larger half: measured over
   the wire, graph+sched gzip to 0.48 MB against geometry's 0.66 MB. Shipping them together made
   the first bus interaction cost 1.16 MB when 0.48 MB would do.

   Kocaeli and Ankara have no baked geometry at all, so no file is written for them and the app
   falls back to the stop polyline exactly as it already did. */
for (const [city, s] of Object.entries(busSets)) {
  const p = path.join(DIR, 'bus-data-' + city + '.json');
  fs.writeFileSync(p, JSON.stringify({ graph: s.graph, sched: s.sched }));
  const geomRefs = Object.keys(s.geom || {}).filter(k => s.geom[k]);
  let geomNote = 'no geometry';
  if (geomRefs.length) {
    const gp = path.join(DIR, 'bus-geom-' + city + '.json');
    fs.writeFileSync(gp, JSON.stringify(s.geom));
    geomNote = 'geometry split into ' + path.basename(gp) + ' (' +
               (fs.statSync(gp).size / 1024).toFixed(0) + ' KB, ' + geomRefs.length + ' routes)';
  }
  console.log('WROTE', p, (fs.statSync(p).size / 1024).toFixed(1), 'KB  (lazy)  dirs:', s.graph.length,
              ' ' + geomNote);
}

// emit the service worker with a fresh version stamp → installed apps self-update on deploy
const swTpl = fs.readFileSync(path.join(DIR, 'sw.template.js'), 'utf8');
const swVersion = buildStamp;   // one stamp for the worker and the diagnostics report
fs.writeFileSync(path.join(ROOT, 'sw.js'), swTpl.replace('__SW_VERSION__', swVersion));
console.log('WROTE sw.js  version', swVersion);
