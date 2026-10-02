/* Official project facts from Metro İstanbul's own "projects" pages.
 *
 *   node transit_data/fetch-planned-facts.cjs
 *
 * Writes transit_data/planned-facts-mi.json (committed: it is small, and its diffs are the
 * changelog of what the operator says about each project).
 *
 * WHY THIS SOURCE
 * Wikipedia and the news disagree about almost everything that matters here — opening dates move,
 * lengths are quoted with and without the unbuilt tail, a station is spelled three ways. Metro
 * İstanbul publishes a page per project with the contractor, the works start date, the contract
 * value, the OFFICIAL STATION LIST in order, the length, the design capacity, the journey time,
 * the number of tunnel-boring machines and which lines it integrates with. That is as close to a
 * primary source as this exists, and it splits projects into the two stages the operator itself
 * uses: İnşa Halindeki (under construction) and Proje Halindeki (project stage).
 *
 * WHAT IT DOES NOT HAVE: opening dates and progress percentages. Those come from dated public
 * statements and live in planned-registry.json, each with its source. Nothing here is inferred.
 *
 * Be a polite client: ~15 small pages, a descriptive User-Agent, a pause between requests. The
 * project already scrapes this host for service disruptions (see DATA-SOURCES.md); this is the
 * same footing — public pages, attributed in-app, no licence published.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const HOST = 'www.metro.istanbul';
const BASE = '/Hatlarimiz/ProjeHalindekiHatlar';
const UA = 'Mozilla/5.0 (compatible; istanbul-rail-network/1.0; +https://github.com/Hero4mohamed/Metro-Istanbul-General-City-Map)';

function get(p) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: HOST, path: p, headers: { 'User-Agent': UA, 'Accept': 'text/html' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + p)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error('timeout for ' + p)); });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The page is server-rendered HTML with no structure worth selecting on, so it is turned into
   lines of visible text and read by its labels. Entities are decoded by hand: no dependency. */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
          .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
          .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m);
}
function textLines(html) {
  const t = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/span)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decode(t).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const LABELS = ['Hat Uzunluğu', 'Yolcu Kapasitesi', 'Ekipman', 'Seyahat Süresi', 'TBM Adedi', 'Çalışan Sayısı'];
const trNum = s => { const m = /([0-9]+(?:[.,][0-9]+)?)/.exec(String(s || '').replace(/\./g, m2 => m2)); return m ? parseFloat(m[1].replace(',', '.')) : null; };
const intTR = s => { const m = /([0-9][0-9.]*)/.exec(String(s || '')); return m ? parseInt(m[1].replace(/\./g, ''), 10) : null; };
function isoDate(s) {                                  // 28.04.2017 -> 2017-04-28
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s || '');
  return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
}

function parseProject(html, id, phase) {
  const ls = textLines(html);
  const k = ls.findIndex(l => l.startsWith('• Yüklenici'));
  if (k < 1) return null;
  const end = ls.findIndex((l, i) => i > k && l === 'Sefer Tarifeleri');
  const block = ls.slice(k, end > 0 ? end : k + 60);
  const val = label => { const i = block.findIndex(l => l.startsWith(label)); return i >= 0 ? block[i + 1] : null; };
  const p = {
    id: id, phase: phase,
    url: 'https://' + HOST + BASE + '?projeInsaat=' + (phase === 'construction' ? 0 : 1) + '&q=' + id,
    title: ls[k - 1],
    contractor: val('• Yüklenici'),
    startDate: isoDate(val('• İşe Başlama Tarihi')),
    contractValue: val('• Projeler'),
  };
  // everything between the contract value and "Entegre Olunan Hatlar": a description paragraph
  // followed by the station names, one per line
  const iVal = block.findIndex(l => l.startsWith('• Projeler')) + 2;
  const iInt = block.findIndex(l => l === 'Entegre Olunan Hatlar');
  const body = block.slice(iVal, iInt > 0 ? iInt : iVal);
  p.summary = body.find(l => l.length > 60) || null;
  p.stations = body.filter(l => l !== p.summary && l.length <= 48 && !/^\d+\.\s?İstasyon$/i.test(l));
  p.stationsUnnamed = body.filter(l => /^\d+\.\s?İstasyon$/i.test(l)).length || 0;   // "1.İstasyon…9.İstasyon": count only
  const iLen = block.findIndex(l => l === 'Hat Uzunluğu');
  p.integrations = iInt > 0 ? block.slice(iInt + 1, iLen > 0 ? iLen : iInt + 1).filter(l => l.length > 20) : [];
  // value-or-next-label: a missing value leaves the next line as another label
  const lab = label => { const i = block.findIndex(l => l === label); if (i < 0) return null;
    const v = block[i + 1]; return (v && !LABELS.includes(v) && !/^M\d|^T\d|^M$|^T$/.test(v)) ? v : null; };
  p.lengthKm = trNum(lab('Hat Uzunluğu'));
  p.capacityPphpd = intTR(lab('Yolcu Kapasitesi'));
  p.vehicles = intTR(lab('Ekipman'));
  p.travelMin = trNum(lab('Seyahat Süresi'));
  p.tbm = intTR(lab('TBM Adedi'));
  p.staff = intTR(lab('Çalışan Sayısı'));
  return p;
}

(async () => {
  const projects = [];
  const lists = [['construction', 0], ['project', 1]];
  for (const [phase, flag] of lists) {
    const idx = await get(BASE + 'Tumu?projeInsaat=' + flag);
    const ids = [...new Set([...idx.matchAll(/ProjeHalindekiHatlar\?projeInsaat=[01]&(?:amp;)?q=(\d+)/g)].map(m => +m[1]))];
    console.log(phase.padEnd(13) + ids.length + ' projects: ' + ids.join(', '));
    for (const id of ids) {
      await sleep(1200);
      try {
        const p = parseProject(await get(BASE + '?projeInsaat=' + flag + '&q=' + id), id, phase);
        if (p) projects.push(p); else console.log('  q=' + id + ': no project block found');
      } catch (e) { console.log('  q=' + id + ': ' + e.message); }
    }
  }
  if (!projects.length) { console.error('nothing parsed: the page layout has probably changed. File left untouched.'); process.exit(1); }
  projects.sort((a, b) => (a.phase === b.phase ? a.id - b.id : (a.phase === 'construction' ? -1 : 1)));
  /* Two guards. A scrape that finds far fewer projects than last time means the page changed shape, and
     overwriting would quietly delete facts that are still true. And an unchanged result is NOT
     written: `fetched` moves every run, and a file that differs only by its timestamp would make the
     weekly job commit (and redeploy the site) forever for nothing. */
  const file = path.join(DIR, 'planned-facts-mi.json');
  let prev = null; try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first run */ }
  if (prev && projects.length < prev.projects.length * 0.6) {
    console.error('parsed ' + projects.length + ' projects against ' + prev.projects.length + ' before: the page layout has probably changed. File left untouched.');
    process.exit(1);
  }
  if (prev && JSON.stringify(prev.projects) === JSON.stringify(projects)) { console.log('no change: ' + projects.length + ' projects identical to the committed file.'); return; }
  fs.writeFileSync(file, JSON.stringify({
    fetched: new Date().toISOString(),
    source: 'https://' + HOST + BASE,
    note: 'As published by Metro İstanbul. phase: construction = "İnşa Halindeki", project = "Proje Halindeki".',
    projects: projects }, null, 1) + '\n');
  console.log('wrote planned-facts-mi.json: ' + projects.length + ' projects');
  for (const p of projects) console.log('  ' + String(p.id).padStart(2) + ' ' + p.phase.padEnd(12) + (p.title || '').slice(0, 56).padEnd(57) +
    (p.lengthKm || '?') + ' km, ' + p.stations.length + ' stn' + (p.stationsUnnamed ? '(+' + p.stationsUnnamed + ' unnamed)' : ''));
})().catch(e => { console.error(e.message); process.exit(1); });
