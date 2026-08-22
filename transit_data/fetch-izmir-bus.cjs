/* İzmir bus data from the city's own open-data portal.
 *
 * OSM held 29 usable ESHOT routes at ~6 stops each, which was too degraded to ship. İzmir
 * Büyükşehir publishes the real thing at acikveri.bizizmir.com: 441 lines, 11,784 stops, and
 * ordered road geometry for both directions of every line.
 *
 * What it does NOT publish is a bus timetable, so no schedules are written — the same rule as
 * Ankara. process-izmir-bus.cjs derives stop ORDER by projecting each line's stops onto its own
 * route geometry, the technique already used for İstanbul's bus shapes.
 *
 * Usage: node fetch-izmir-bus.cjs
 * Writes: izmir-{hatlar,duraklar,guzergah}.csv (raw, git-ignored)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const BASE = 'https://openfiles.izmir.bel.tr/211488/docs/';
const UA = 'raynet-transit-map/1.0 (github.com/Hero4mohamed/Metro-Istanbul-General-City-Map)';

const FILES = [
  ['eshot-otobus-hatlari.csv',           'izmir-hatlar.csv',    'line list'],
  ['eshot-otobus-duraklari.csv',         'izmir-duraklar.csv',  'stops'],
  ['eshot-otobus-hat-guzergahlari.csv',  'izmir-guzergah.csv',  'route geometry'],
];

let failed = 0;
for (const [remote, local, label] of FILES) {
  const out = path.join(DIR, local);
  process.stdout.write(label.padEnd(16) + '… ');
  try {
    execFileSync('curl.exe', ['-s', '-S', '--fail', '-L', '-A', UA,
      '--max-time', '180', '-o', out, BASE + remote], { stdio: ['ignore', 'inherit', 'inherit'] });
    const size = fs.statSync(out).size;
    if (size < 1000) throw new Error('suspiciously small (' + size + ' bytes)');
    const rows = fs.readFileSync(out, 'utf8').split('\n').length - 1;
    console.log((size / 1048576).toFixed(1) + ' MB  ' + rows.toLocaleString('en') + ' rows');
  } catch (e) {
    console.log('FAILED — ' + String(e.message || e).split('\n')[0]);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
