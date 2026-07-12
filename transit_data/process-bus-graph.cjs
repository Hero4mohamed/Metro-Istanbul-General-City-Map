// Build a compact bus ROUTING graph (per line: ordered stops) from OSM route=bus.
const fs = require('fs'); const path = require('path');
const DIR = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(DIR,'bus-routes.json'),'utf8'));
const rels = raw.elements.filter(e=>e.type==='relation');
const nodeMap = {};
for (const n of raw.elements) if (n.type==='node') nodeMap[n.id] = { name:(n.tags&&n.tags.name)||'', lat:n.lat, lon:n.lon };

const Rm=6371000, toRad=d=>d*Math.PI/180;
function meters(a,b){ const dLat=toRad(b[0]-a[0]),dLng=toRad(b[1]-a[1]),la1=toRad(a[0]),la2=toRad(b[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*Rm*Math.asin(Math.sqrt(h)); }

// ordered, de-duplicated stops for one relation (collapse stop+platform pairs)
function relStops(rel){
  const out = [];
  for (const m of (rel.members||[])){
    if (m.type!=='node' || !/stop|platform/.test(m.role||'')) continue;
    const info = nodeMap[m.ref]; if(!info) continue;
    const last = out[out.length-1];
    if (last && ((info.name && info.name===last.name) || meters([info.lat,info.lon],[last.lat,last.lon])<45)) continue;
    out.push({ name:info.name, lat:info.lat, lon:info.lon });
  }
  return out;
}

// group relations by ref, then keep BOTH directions (İETT lines often run different
// outbound/return streets, which the planner needs to board the correct direction).
const byRef = {};
for (const rel of rels){
  const ref = (rel.tags && rel.tags.ref || '').trim(); if(!ref) continue;
  const stops = relStops(rel);
  if (stops.length < 2) continue;
  (byRef[ref] = byRef[ref] || []).push({ stops, to:(rel.tags.to||'').trim(), from:(rel.tags.from||'').trim(),
                                          head: stops[stops.length-1].name });
}
// a direction is identified by its (first stop → last stop) endpoints; keep the richest per distinct
// direction, cap at 3 variants/ref so short-turn duplicates don't bloat the graph.
const sig = d => (d.stops[0].name||d.stops[0].lat.toFixed(3)) + '»' + (d.head||d.stops[d.stops.length-1].lat.toFixed(3));
const out = [];
let totalStops = 0, dirLines = 0;
for (const ref of Object.keys(byRef)){
  const dirs = byRef[ref].sort((a,b)=>b.stops.length-a.stops.length);
  const bySig = new Map();
  for (const d of dirs){ const s = sig(d); if(!bySig.has(s)) bySig.set(s, d); }   // richest per endpoint-signature
  const keep = [...bySig.values()].slice(0, 3);
  if (keep.length > 1) dirLines++;
  keep.forEach((d, di) => {
    const stops = d.stops.map(s=>[ +s.lat.toFixed(5), +s.lon.toFixed(5), s.name ]);
    totalStops += stops.length;
    out.push({ ref, dir: di, head: d.head, stops });     // dir 0 = primary, 1 = return, 2 = variant
  });
}
out.sort((a,b)=>{ const na=parseInt(a.ref)||9999, nb=parseInt(b.ref)||9999; return na-nb || a.ref.localeCompare(b.ref,'tr') || a.dir-b.dir; });

fs.writeFileSync(path.join(DIR,'bus-graph.json'), JSON.stringify(out));
const kb = (fs.statSync(path.join(DIR,'bus-graph.json')).size/1024).toFixed(0);
const refs = new Set(out.map(o=>o.ref)).size;
console.log('BUS ENTRIES:', out.length, ' REFS:', refs, ' both-direction refs:', dirLines, ' TOTAL STOPS:', totalStops, ' FILE:', kb, 'KB');
console.log('sample:', out.slice(0,4).map(l=>l.ref+'#'+l.dir+'('+l.stops.length+')').join(' '));
