/* Emit status.json — the data behind status.html.
 *
 * Deliberately generated, never hand-written: a dashboard fed by numbers someone typed is a
 * dashboard that quietly goes stale. Everything here is measured from the build that is about
 * to be deployed, or from the test run that just happened.
 *
 * CI writes this into the Pages artifact WITHOUT committing it, so the deployed dashboard is
 * fresh on every deploy and the repo stays free of churn.
 *
 * Usage: node transit_data/gen-status.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'transit_data');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const jd = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const has = f => fs.existsSync(path.join(DATA, f));

/* --- run the static suite and record the real numbers --- */
function runSuite() {
  const r = spawnSync(process.execPath, [path.join(DATA, 'testkit', 'run.cjs')],
    { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const num = re => { const m = re.exec(out); return m ? +m[1] : null; };
  const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1].trim());
  return {
    total: num(/^# tests (\d+)/m),
    pass: num(/^# pass (\d+)/m),
    fail: num(/^# fail (\d+)/m),
    failed,
    exit: r.status,
  };
}

/* --- what the built page actually contains --- */
function coverage() {
  const html = rd('index.html');
  const m = /const CITIES\s*=\s*(\{[\s\S]*?\});\s*\n/.exec(html);
  const cities = m ? eval('(' + m[1] + ')') : {};
  const rows = [];
  let lines = 0, stations = 0;

  const busFiles = {
    istanbul: 'bus-directory.json',
    kocaeli: 'kocaeli-bus-directory.json',
    ankara: 'ankara-bus-directory.json',
  };

  for (const [id, c] of Object.entries(cities)) {
    const ls = c.lines || [];
    const st = ls.reduce((a, l) => a + (l.stations || []).length, 0);
    lines += ls.length; stations += st;
    const bf = busFiles[id];
    rows.push({
      id,
      label: c.label || c.name || id,
      lines: ls.length,
      stations: st,
      buses: (bf && has(bf) && c.has && c.has.bus) ? jd(bf).length : 0,
      ferry: !!(c.has && c.has.ferry),
      disruptions: !!(c.has && c.has.disruptions),
      stepFree: !!(c.has && c.has.access),
      busSource: c.busSource || (c.has && c.has.bus ? 'operator' : null),
    });
  }
  rows.sort((a, b) => (b.lines + b.buses) - (a.lines + a.buses));

  return {
    cities: rows,
    totals: {
      cities: rows.length,
      lines,
      stations,
      busRoutes: rows.reduce((a, r) => a + r.buses, 0),
      stepFreeRecords: has('accessibility.json') ? jd('accessibility.json').length : 0,
      pageBytes: Buffer.byteLength(html),
    },
  };
}

const status = {
  generated: new Date().toISOString(),
  commit: (process.env.GITHUB_SHA || '').slice(0, 7) || null,
  ref: process.env.GITHUB_REF_NAME || null,
  staticSuite: runSuite(),
  coverage: coverage(),
  disruptions: (() => {
    try { return jd('disruptions.json').map(d => ({ ref: d.ref, severity: d.severity, title: d.title, scope: d.scope })); }
    catch { return []; }
  })(),
  roadmap: (() => { try { return jd('roadmap.json'); } catch { return null; } })(),
};

fs.writeFileSync(path.join(ROOT, 'status.json'), JSON.stringify(status, null, 2));
const s = status.staticSuite;
console.log('WROTE status.json — suite ' + s.pass + '/' + s.total +
            ', ' + status.coverage.totals.cities + ' cities, ' +
            status.coverage.totals.lines + ' lines, ' +
            status.coverage.totals.busRoutes + ' bus routes');
