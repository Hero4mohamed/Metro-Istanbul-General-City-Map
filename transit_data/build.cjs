// Inject the processed network JSON into the app template → single self-contained file.
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const ROOT = path.resolve(DIR, '..');

const template = fs.readFileSync(path.join(DIR, 'app.template.html'), 'utf8');
const active  = JSON.parse(fs.readFileSync(path.join(DIR, 'lines.json'), 'utf8'));
const ferry   = JSON.parse(fs.readFileSync(path.join(DIR, 'ferry-lines.json'), 'utf8'));
const planned = JSON.parse(fs.readFileSync(path.join(DIR, 'planned-lines.json'), 'utf8'));
const manual  = JSON.parse(fs.readFileSync(path.join(DIR, 'planned-manual.json'), 'utf8'));  // hand-placed approx lines
const buses   = JSON.parse(fs.readFileSync(path.join(DIR, 'bus-directory.json'), 'utf8'));
const data = JSON.stringify(active.concat(ferry, planned, manual));

if (!template.includes('__NETWORK_JSON__') || !template.includes('__BUS_JSON__')) { console.error('token missing'); process.exit(1); }
const html = template.replace('__NETWORK_JSON__', data).replace('__BUS_JSON__', JSON.stringify(buses));
console.log('ACTIVE:', active.length, ' FERRY:', ferry.length, ' PLANNED:', planned.length, ' MANUAL:', manual.length, ' BUSES:', buses.length);

const outPath = path.join(ROOT, 'index.html');   // GitHub Pages serves the repo-root index.html
fs.writeFileSync(outPath, html);
console.log('WROTE', outPath, (fs.statSync(outPath).size/1024).toFixed(1), 'KB');
