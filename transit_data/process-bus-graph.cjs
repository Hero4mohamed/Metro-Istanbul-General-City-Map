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

// group by ref, keep the richest single direction
const byRef = {};
for (const rel of rels){
  const ref = (rel.tags && rel.tags.ref || '').trim(); if(!ref) continue;
  const stops = relStops(rel);
  if (stops.length < 2) continue;
  if (!byRef[ref] || stops.length > byRef[ref].length) byRef[ref] = stops;
}

const out = [];
let totalStops = 0;
for (const ref of Object.keys(byRef)){
  const stops = byRef[ref].map(s=>[ +s.lat.toFixed(5), +s.lon.toFixed(5), s.name ]);
  totalStops += stops.length;
  out.push({ ref, stops });
}
out.sort((a,b)=>{ const na=parseInt(a.ref)||9999, nb=parseInt(b.ref)||9999; return na-nb || a.ref.localeCompare(b.ref,'tr'); });

fs.writeFileSync(path.join(DIR,'bus-graph.json'), JSON.stringify(out));
const kb = (fs.statSync(path.join(DIR,'bus-graph.json')).size/1024).toFixed(0);
console.log('BUS LINES:', out.length, ' TOTAL STOPS:', totalStops, ' FILE:', kb, 'KB');
console.log('sample:', out.slice(0,3).map(l=>l.ref+'('+l.stops.length+')').join(' '));
