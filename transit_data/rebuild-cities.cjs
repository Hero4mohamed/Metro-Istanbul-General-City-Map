// Rebuild every city's line data in the ONE order that is correct, then the app.
//
// process-city.cjs regenerates <city>-lines.json from scratch, so anything that augments those
// files must run after it — otherwise İzmir silently loses its ferries and İZBAN extension,
// Bursa loses T2 and the teleferik, and Kocaeli loses its ferries. Running the steps by hand in
// the wrong order has quietly dropped lines twice; this script exists so that cannot happen.
//
//   node transit_data/rebuild-cities.cjs

const { execFileSync } = require('child_process');
const path = require('path');
const DIR = __dirname;

const STEPS = [
  ['process-city.cjs',         'base city networks from OSM relations (OVERWRITES <city>-lines.json)'],
  ['process-city-extra.cjs',   'completeness pass: İZBAN extension, İzmir ferries, Bursa T2 + teleferik, planned lines'],
  ['fix-fragments.cjs',        'repair fragmented geometry (İZBAN\'s 42 chains → 5)'],
  ['process-kocaeli-ferry.cjs','Kocaeli ferry lines from the scraped timetable'],
  ['process-kocaeli-cable.cjs','Kartepe Teleferik from the open-data station points'],
  ['build.cjs',                'inject everything into index.html + sw.js']
];

for (const [script, why] of STEPS) {
  console.log('\n[36m→ ' + script + '[0m  — ' + why);
  try {
    const out = execFileSync(process.execPath, [path.join(DIR, script)], { encoding: 'utf8' });
    process.stdout.write(out.split('\n').filter(Boolean).slice(-8).join('\n') + '\n');
  } catch (e) {
    console.error('\n!! ' + script + ' failed:\n' + (e.stdout || '') + (e.stderr || ''));
    process.exit(1);
  }
}
console.log('\nall cities rebuilt in order.');
