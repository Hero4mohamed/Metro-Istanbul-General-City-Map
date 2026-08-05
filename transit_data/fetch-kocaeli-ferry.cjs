// Kocaeli's ferry network from Kocaeli BB's own timetable tool.
//
// kocaeli.bel.tr/vapurlar is an origin→destination picker over the 8 ferry piers. POSTing a
// pier pair returns three tables — weekday / Saturday / Sunday+holiday — where every row is
// one sailing: line (HAT-n), from, to, departure, arrival. Querying all 56 ordered pairs
// therefore reconstructs the whole network from the operator itself, with real sailing times,
// instead of guessing which piers a "Hat 1" joins.
//
// Pier COORDINATES come from a different official source: the Deniz Ulaşım Şube Müdürlüğü
// "İskele konum ve bilgileri (2026)" dataset on veri.kocaeli.bel.tr (CC-BY), which also marks
// each pier active or passive for 2026.
//
// Emits kocaeli-ferry-raw.json for process-kocaeli-ferry.cjs to turn into lines.

const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const CACHE = path.join(DIR, '.cache-kocaeli-ferry');

const URL = 'https://www.kocaeli.bel.tr/vapurlar/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// pier id (timetable tool) → name. Yarımca is offered by the picker but the 2026 pier dataset
// marks it passive; whether it actually has sailings is decided by the scrape, not by us.
const PIERS = {
  '7922': 'İzmit', '7923': 'Gölcük', '7924': 'Değirmendere', '7925': 'Karamürsel',
  '7926': 'Derince', '7927': 'Tütünçiftlik', '7929': 'Hereke', '7930': 'Yarımca'
};

const DAYS = ['wd', 'sat', 'sun'];   // the three tables, in page order
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function pair(from, to) {
  const key = from + '_' + to;
  const cf = path.join(CACHE, key + '.html');
  if (fs.existsSync(cf)) return fs.readFileSync(cf, 'utf8');
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(URL, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ kalkis_iskele: from, varis_iskele: to })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text();
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(cf, t);
      return t;
    } catch (e) {
      if (a === 3) { console.warn('  ! ' + key + ' failed: ' + e.message); return null; }
      await sleep(700 * a);
    }
  }
}

(async function main() {
  const ids = Object.keys(PIERS);
  const sailings = [];
  let queried = 0, withService = 0;

  for (const from of ids) {
    for (const to of ids) {
      if (from === to) continue;
      const html = await pair(from, to);
      await sleep(120);
      queried++;
      if (!html) continue;
      const tabs = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
      let any = false;
      tabs.forEach((tbl, ti) => {
        const day = DAYS[ti]; if (!day) return;
        for (const rm of tbl.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
          const cells = [...rm[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map(c => strip(c[0]));
          if (cells.length < 5) continue;
          const [hat, kalkis, varis, dep, arr] = cells;
          if (!/^HAT/i.test(hat)) continue;                       // skip the header row
          if (!/^\d{1,2}:\d{2}$/.test(dep)) continue;
          sailings.push({
            hat: hat.trim(), day,
            from: PIERS[from], to: PIERS[to],
            dep: dep.padStart(5, '0'),
            arr: /^\d{1,2}:\d{2}$/.test(arr) ? arr.padStart(5, '0') : null
          });
          any = true;
        }
      });
      if (any) withService++;
    }
    console.log('  from ' + PIERS[from] + ' done');
  }

  const lines = [...new Set(sailings.map(s => s.hat))].sort();
  fs.writeFileSync(path.join(DIR, 'kocaeli-ferry-raw.json'),
                   JSON.stringify({ piers: PIERS, sailings }, null, 0));
  console.log('\npairs queried:', queried, ' with service:', withService);
  console.log('sailings:', sailings.length, ' lines:', lines.join(', '));
  for (const l of lines) {
    const s = sailings.filter(x => x.hat === l);
    const ps = [...new Set(s.flatMap(x => [x.from, x.to]))];
    console.log('  ' + l.padEnd(8) + String(s.length).padStart(4) + ' sailings   piers: ' + ps.join(', '));
  }
})();
