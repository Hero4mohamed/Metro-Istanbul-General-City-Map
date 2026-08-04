// Inject the processed network JSON into the app template → single self-contained file.
const fs = require('fs');
const path = require('path');
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
const BUS_CITIES = {
  istanbul: { dir:'bus-directory.json', graph:'bus-graph.json', sched:'bus-schedules.json', geom:'bus-geom.json' },
  kocaeli:  { dir:'kocaeli-bus-directory.json', graph:'kocaeli-bus-graph.json', sched:'kocaeli-bus-schedules.json' }
};
const rd = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const opt = f => (f && fs.existsSync(path.join(DIR, f))) ? rd(f) : {};
const busSets = {};
for (const [city, f] of Object.entries(BUS_CITIES))
  busSets[city] = { dir: rd(f.dir), graph: rd(f.graph), sched: rd(f.sched), geom: opt(f.geom) };
const busDirs = Object.fromEntries(Object.entries(busSets).map(([c, s]) => [c, s.dir]));
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

for (const t of ['__CITIES_JSON__','__INTERCITY_JSON__','__BUS_JSON__','__DISRUPTIONS_JSON__','__OPENINGS_JSON__','__MISTATIONS_JSON__','__ACCESS_JSON__','__ATTRACTIONS_JSON__','__CARDIMG_JSON__','__TRANSLATOR_JS__'])
  if (!template.includes(t)) { console.error('token missing:', t); process.exit(1); }
const html = template.replace('__CITIES_JSON__', data)
                     .replace('__INTERCITY_JSON__', () => JSON.stringify(intercity))
                     .replace('__BUS_JSON__', () => JSON.stringify(busDirs))
                     .replace('__DISRUPTIONS_JSON__', JSON.stringify(disrupt))
                     .replace('__OPENINGS_JSON__', () => JSON.stringify(openings))
                     .replace('__MISTATIONS_JSON__', JSON.stringify(miStns))
                     .replace('__ACCESS_JSON__', () => JSON.stringify(access))
                     .replace('__ATTRACTIONS_JSON__', () => JSON.stringify(attract))
                     .replace('__CARDIMG_JSON__', () => JSON.stringify(cardImg))
                     .replace('__TRANSLATOR_JS__', () => translatorJS);
console.log('İSTANBUL:', cities.istanbul.lines.length, ' ANKARA:', ankara.length, ' İZMİR:', izmir.length, ' BURSA:', bursa.length, ' ANTALYA:', antalya.length, ' KOCAELİ:', kocaeli.length,
            ' INTERCITY:', intercity.length,
            ' BUSES:', Object.entries(busSets).map(([c, s]) => c + ':' + s.dir.length).join(' '),
            ' DISRUPTIONS:', disrupt.length, ' MISTATIONS:', miStns.length, ' ACCESS:', access.length);

const outPath = path.join(ROOT, 'index.html');   // GitHub Pages serves the repo-root index.html
fs.writeFileSync(outPath, html);
console.log('WROTE', outPath, (fs.statSync(outPath).size/1024).toFixed(1), 'KB',
            ' cardArt:', Object.keys(cardImg.cities).map(c=>c+'×'+Object.keys(cardImg.cities[c]).length).join(' '));

// bus graph + schedules are the heaviest datasets and most visitors never plan a bus trip in
// the first seconds — each city gets its own file, fetched after first paint for that city
for (const [city, s] of Object.entries(busSets)) {
  const p = path.join(DIR, 'bus-data-' + city + '.json');
  fs.writeFileSync(p, JSON.stringify({ graph: s.graph, sched: s.sched, geom: s.geom }));
  console.log('WROTE', p, (fs.statSync(p).size/1024).toFixed(1), 'KB  (lazy)  dirs:', s.graph.length,
              ' geom routes:', Object.keys(s.geom).filter(k => s.geom[k]).length);
}

// emit the service worker with a fresh version stamp → installed apps self-update on deploy
const swTpl = fs.readFileSync(path.join(DIR, 'sw.template.js'), 'utf8');
const swVersion = new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
fs.writeFileSync(path.join(ROOT, 'sw.js'), swTpl.replace('__SW_VERSION__', swVersion));
console.log('WROTE sw.js  version', swVersion);
