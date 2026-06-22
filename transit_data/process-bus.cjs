// Build a searchable directory of every Istanbul bus line from OSM route=bus
// relations. Stores one representative relation id per line so the app can
// fetch that line's real geometry on demand (drawing all 850+ at once would
// be an unreadable blob).
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'bus-probe.json'), 'utf8'));
const rels = raw.elements.filter(e => e.type === 'relation' && e.tags && e.tags.ref);

function endpoints(t){
  if (t.from && t.to) return [t.from, t.to];
  // parse from the name, stripping a leading "REF:" / "REF "
  let n = (t.name||'').replace(/^\s*[0-9A-ZÇĞİÖŞÜ\-]+\s*[:\-]\s*/i,'');
  const parts = n.split(/\s*(?:[-–—]|↔|→|<>|\/)\s*/).filter(Boolean);
  if (parts.length >= 2) return [parts[0].trim(), parts[parts.length-1].trim()];
  return [t.name||'', ''];
}

// group by ref, keep the richest representative
const byRef = {};
for (const r of rels){
  const t = r.tags, ref = t.ref.trim();
  const [from,to] = endpoints(t);
  const score = (from?1:0)+(to?1:0)+((t.name||'').length/100);
  const cur = byRef[ref];
  if (!cur || score > cur.score){
    byRef[ref] = { ref, from, to, id:r.id, op:(t.operator||t.network||'').replace(/İETT|IETT/,'İETT'), score };
  }
}

// natural-ish sort: numeric prefix first, then full ref
function key(ref){ const m = ref.match(/^(\d+)/); return [ m?+m[1]:99999, ref ]; }
const dir = Object.values(byRef).map(({ref,from,to,id,op})=>({
  ref, from, to, id,
  op: /İETT/.test(op) ? '' : op            // İETT is the default → omit to save bytes
})).sort((a,b)=>{ const ka=key(a.ref),kb=key(b.ref); return ka[0]-kb[0] || ka[1].localeCompare(kb[1],'tr'); });

fs.writeFileSync(path.join(DIR,'bus-directory.json'), JSON.stringify(dir));
const kb = (fs.statSync(path.join(DIR,'bus-directory.json')).size/1024).toFixed(0);
console.log('BUS LINES:', dir.length, ' FILE:', kb, 'KB');
console.log('SAMPLE:'); dir.slice(0,6).forEach(d=>console.log('  '+d.ref+'  '+d.from+' ↔ '+d.to+(d.op?'  ['+d.op+']':'')));
const noEnds = dir.filter(d=>!d.from||!d.to).length;
console.log('lines missing an endpoint:', noEnds);
