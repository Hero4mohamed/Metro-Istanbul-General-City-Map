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
const buses   = JSON.parse(fs.readFileSync(path.join(DIR, 'bus-directory.json'), 'utf8'));
const busGraph= JSON.parse(fs.readFileSync(path.join(DIR, 'bus-graph.json'), 'utf8'));        // bus stops for routing
const disrupt = JSON.parse(fs.readFileSync(path.join(DIR, 'disruptions.json'), 'utf8'));     // live faults/closures
const miStns  = JSON.parse(fs.readFileSync(path.join(DIR, 'mi-stations.json'), 'utf8'));     // official station ids (exact timetables)
const data = JSON.stringify(active.concat(b2, ferry, cable, planned, manual));

// lift the TR→EN translator out of the scraper so the CLIENT can re-translate any
// disruption that still contains Turkish (safety net for wording newer than the vocab)
const scraper = fs.readFileSync(path.join(DIR, 'scrape-disruptions.cjs'), 'utf8');
const tStart = scraper.indexOf('// ==TRANSLATOR-START=='), tEnd = scraper.indexOf('// ==TRANSLATOR-END==');
if (tStart < 0 || tEnd < 0) { console.error('translator markers missing in scrape-disruptions.cjs'); process.exit(1); }
const translatorJS = scraper.slice(tStart, tEnd);

for (const t of ['__NETWORK_JSON__','__BUS_JSON__','__BUSGRAPH_JSON__','__DISRUPTIONS_JSON__','__MISTATIONS_JSON__','__TRANSLATOR_JS__'])
  if (!template.includes(t)) { console.error('token missing:', t); process.exit(1); }
const html = template.replace('__NETWORK_JSON__', data)
                     .replace('__BUS_JSON__', JSON.stringify(buses))
                     .replace('__BUSGRAPH_JSON__', JSON.stringify(busGraph))
                     .replace('__DISRUPTIONS_JSON__', JSON.stringify(disrupt))
                     .replace('__MISTATIONS_JSON__', JSON.stringify(miStns))
                     .replace('__TRANSLATOR_JS__', () => translatorJS);
console.log('ACTIVE:', active.length, ' B2:', b2.length, ' FERRY:', ferry.length, ' CABLE:', cable.length, ' PLANNED:', planned.length, ' MANUAL:', manual.length, ' BUSES:', buses.length, ' BUSGRAPH:', busGraph.length, ' DISRUPTIONS:', disrupt.length, ' MISTATIONS:', miStns.length);

const outPath = path.join(ROOT, 'index.html');   // GitHub Pages serves the repo-root index.html
fs.writeFileSync(outPath, html);
console.log('WROTE', outPath, (fs.statSync(outPath).size/1024).toFixed(1), 'KB');
