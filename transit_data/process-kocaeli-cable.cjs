// Kartepe Teleferik → a 'cable' line merged into kocaeli-lines.json.
// Run AFTER process-city.cjs (which regenerates that file). Idempotent: replaces by ref.
//
// Source: Kocaeli BB open data, "Kocaeli Teleferik Hattı İstasyon Noktaları ve Kabin Bilgileri"
// (veri.kocaeli.bel.tr). The dataset gives both stations as decimal lat/lng, plus the fleet
// (72 passenger cabins + 1 maintenance, 10 people each) and all 16 pylon heights. Only two
// stations exist, so there is nothing to derive — the geometry is the straight span between
// them, which is what a gondola actually flies.
//
// The pylons have heights but no coordinates in the dataset, so they cannot refine the path.

const fs = require('fs');
const path = require('path');
const DIR = __dirname;

const LINE = {
  ref: 'TF',
  kind: 'cable',
  color: '#B45309',
  scope: 'active',
  city: 'kocaeli',
  official: 'Kartepe Teleferik · Derbent – Kuzuyayla',
  stations: [
    { name: 'Derbent',   lat: 40.68924, lng: 30.11894 },   // 331 m, Kartepe
    { name: 'Kuzuyayla', lat: 40.64715, lng: 30.11580 }    // 1421 m, Kuzuyayla Tabiat Parkı
  ]
};
LINE.paths = [LINE.stations.map(s => [s.lat, s.lng])];

const LP = path.join(DIR, 'kocaeli-lines.json');
const lines = JSON.parse(fs.readFileSync(LP, 'utf8')).filter(l => l.ref !== LINE.ref);
lines.push(LINE);
fs.writeFileSync(LP, JSON.stringify(lines));

const R = 6371000, rad = d => d * Math.PI / 180;
const a = LINE.stations[0], b = LINE.stations[1];
const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
const span = 2 * R * Math.asin(Math.sqrt(h));

console.log('Kartepe Teleferik: ' + a.name + ' → ' + b.name);
console.log('  span ' + (span / 1000).toFixed(2) + ' km (operator states 4.7 km line length)');
console.log('kocaeli-lines.json now ' + lines.length + ' lines');
