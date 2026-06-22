// Build the Istanbul ferry (vapur) network from real OSM pier coordinates,
// connected per actual operator routes. Ferries travel ~straight over open
// water, so pier-to-pier segments are geographically faithful.
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'piers.json'), 'utf8'));

// pier list: {name, lat, lng}
const piers = [];
for (const e of raw.elements){
  const name = e.tags && e.tags.name; if(!name) continue;
  const lat = e.lat != null ? e.lat : (e.center && e.center.lat);
  const lng = e.lon != null ? e.lon : (e.center && e.center.lon);
  if (lat == null || lng == null) continue;
  piers.push({ name, lat, lng });
}

// ---- real OSM ferry-path geometry (for accurate curves over water) ----
const Rm = 6371000, toRad = d => d*Math.PI/180;
function meters(a,b){ const dLat=toRad(b[0]-a[0]),dLng=toRad(b[1]-a[1]),la1=toRad(a[0]),la2=toRad(b[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*Rm*Math.asin(Math.sqrt(h)); }
const chainLen = c => { let s=0; for(let i=1;i<c.length;i++) s+=meters(c[i-1],c[i]); return s; };
function buildChains(ways, tol){
  let ch = ways.map(w=>w.slice()); let merged=true;
  while(merged){ merged=false;
    for(let i=0;i<ch.length && !merged;i++) for(let j=i+1;j<ch.length;j++){
      const A=ch[i],B=ch[j],a0=A[0],a1=A[A.length-1],b0=B[0],b1=B[B.length-1]; let nc=null;
      if(meters(a1,b0)<tol)nc=A.concat(B.slice(1)); else if(meters(a1,b1)<tol)nc=A.concat(B.slice().reverse().slice(1));
      else if(meters(a0,b1)<tol)nc=B.concat(A.slice(1)); else if(meters(a0,b0)<tol)nc=B.slice().reverse().concat(A.slice(1));
      if(nc){ ch[i]=nc; ch.splice(j,1); merged=true; break; } }
  }
  return ch;
}
function simplify(pts,eps){ if(pts.length<3)return pts; const sq=eps*eps; const keep=new Array(pts.length).fill(false);
  keep[0]=keep[pts.length-1]=true; const st=[[0,pts.length-1]];
  const sd=(p,a,b)=>{const x=a[0],y=a[1];let dx=b[0]-x,dy=b[1]-y; if(dx||dy){const t=((p[0]-x)*dx+(p[1]-y)*dy)/(dx*dx+dy*dy);
    if(t>1){dx=p[0]-b[0];dy=p[1]-b[1];}else if(t>0){dx=p[0]-(x+dx*t);dy=p[1]-(y+dy*t);}else{dx=p[0]-x;dy=p[1]-y;}}else{dx=p[0]-x;dy=p[1]-y;}return dx*dx+dy*dy;};
  while(st.length){const[s,e]=st.pop();let md=0,idx=-1;for(let i=s+1;i<e;i++){const dd=sd(pts[i],pts[s],pts[e]);if(dd>md){md=dd;idx=i;}}
    if(md>sq&&idx!==-1){keep[idx]=true;st.push([s,idx],[idx,e]);}}
  return pts.filter((_,i)=>keep[i]); }

// Catmull-Rom spline → gentle smooth curves through the piers (so straight
// pier-to-pier hops read as smoothly as the OSM-geometry lines).
function catmullRom(pts, seg){
  if (pts.length < 3) return pts;
  const P = i => pts[Math.max(0, Math.min(pts.length-1, i))];
  const cr = (a,b,c,d,t) => { const t2=t*t,t3=t2*t;
    return 0.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3); };
  const out = [];
  for (let i=0;i<pts.length-1;i++){
    const p0=P(i-1),p1=P(i),p2=P(i+1),p3=P(i+2);
    for (let t=0;t<seg;t++){ const s=t/seg; out.push([ cr(p0[0],p1[0],p2[0],p3[0],s), cr(p0[1],p1[1],p2[1],p3[1],s) ]); }
  }
  out.push(pts[pts.length-1]);
  return out;
}
// insert an offset midpoint between each pier so the route bows into open water
function offsetMidpoints(pts, dLat, dLng){
  const out = [];
  for (let i=0;i<pts.length;i++){
    out.push(pts[i]);
    if (i<pts.length-1) out.push([ (pts[i][0]+pts[i+1][0])/2 + dLat, (pts[i][1]+pts[i+1][1])/2 + dLng ]);
  }
  return out;
}
// per-route nudge toward the channel/sea (keeps shore lines off land)
const OFFSETS = {
  'Boğaz (Avrupa)':   [0,  0.0050],
  'Boğaz (Anadolu)':  [0, -0.0050],
  'Bostancı–Kadıköy': [-0.007, 0.003]
};

// stitched paths from the OSM route=ferry relations (real over-water geometry)
const relPaths = [];
try {
  const fraw = JSON.parse(fs.readFileSync(path.join(DIR,'ferry.json'),'utf8'));
  fraw.elements.filter(e=>e.type==='relation').forEach(rel=>{
    const ways=(rel.members||[]).filter(m=>m.type==='way'&&m.geometry).map(m=>m.geometry.map(g=>[g.lat,g.lon]));
    if(!ways.length) return;
    const c = buildChains(ways,80).sort((a,b)=>chainLen(b)-chainLen(a))[0];
    if(c && c.length>=2) relPaths.push({ coords:c, a:c[0], b:c[c.length-1], len:chainLen(c) });
  });
} catch(e){ /* ferry.json optional */ }

// find a real ferry path whose ends match this route's terminals (either direction)
function findGeom(start, end){
  const straight = meters(start,end); let best=null;
  for(const rp of relPaths){
    const fwd = meters(start,rp.a)<1600 && meters(end,rp.b)<1600;
    const rev = meters(start,rp.b)<1600 && meters(end,rp.a)<1600;
    if((fwd||rev) && rp.len > straight*0.75 && rp.len < straight*2.2){
      if(!best || rp.len>best.len) best = { coords: rev?rp.coords.slice().reverse():rp.coords, len:rp.len };
    }
  }
  return best;
}

function norm(s){
  return s.normalize('NFC').toLocaleLowerCase('tr')
    .replace(/[()]/g,' ')
    .replace(/\b(i̇skelesi|iskelesi|i̇skesi|iskesi|vapur|motor|deniz otobüsü|denizotobüsü|şehir hatları|şehir hatlari|sehir hatlari|turyol|i̇do|ido|dentur|terminali|terminalı|limanı|prenstur|araba|net|mavimarmara|galataport)\b/g,' ')
    .replace(/\s+/g,' ').trim();
}

// approximate location per place — disambiguates OSM noise (e.g. a mislabelled
// "Kabataş İskelesi" node that actually sits at Kadıköy). The real OSM pier
// nearest the hint is used.
const HINTS = {
  'Eminönü':[41.017,28.974],'Karaköy':[41.022,28.977],'Kabataş':[41.033,28.994],
  'Beşiktaş':[41.041,29.005],'Üsküdar':[41.026,29.015],'Kadıköy':[40.992,29.022],
  'Bostancı':[40.954,29.094],'Ortaköy':[41.047,29.027],'Arnavutköy':[41.067,29.043],
  'Bebek':[41.078,29.043],'Emirgan':[41.108,29.055],'İstinye':[41.109,29.058],
  'Yeniköy':[41.121,29.060],'Sarıyer':[41.167,29.058],'Rumeli Kavağı':[41.196,29.066],
  'Beylerbeyi':[41.045,29.045],'Çengelköy':[41.051,29.051],'Kandilli':[41.075,29.058],
  'Anadolu Hisarı':[41.083,29.067],'Kanlıca':[41.100,29.065],'Çubuklu':[41.108,29.082],
  'Paşabahçe':[41.117,29.093],'Beykoz':[41.134,29.090],'Anadolu Kavağı':[41.173,29.088],
  'Kasımpaşa':[41.034,28.965],'Hasköy':[41.043,28.951],'Fener':[41.034,28.949],
  'Balat':[41.031,28.949],'Ayvansaray':[41.035,28.943],'Sütlüce':[41.046,28.948],
  'Eyüp':[41.048,28.933],'Kınalıada':[40.910,29.056],'Burgazada':[40.881,29.071],
  'Heybeliada':[40.878,29.101],'Büyükada':[40.875,29.128]
};
const dist2 = (p,h) => { const dx=p.lat-h[0], dy=p.lng-h[1]; return dx*dx+dy*dy; };

// find the best pier coordinate for a place name: name match, then nearest to hint
function findPier(place){
  const np = norm(place), hint = HINTS[place];
  const cands = piers.filter(p => { const n = norm(p.name); return n===np || n.includes(np) || np.includes(n); });
  if (!cands.length) return null;
  const pick = hint
    ? cands.reduce((a,b) => dist2(b,hint) < dist2(a,hint) ? b : a)
    : cands.reduce((a,b) => norm(b.name).length < norm(a.name).length ? b : a);
  const off = hint ? Math.round(Math.sqrt(dist2(pick,hint))*111000) : 0;   // metres from hint
  if (off > 2500) console.warn('  ! '+place+' pick '+off+'m from hint ('+pick.name+')');
  return { name:place, lat:+pick.lat.toFixed(5), lng:+pick.lng.toFixed(5) };
}

// canonical routes (accurate to Şehir Hatları / Turyol / İDO / Dentur services)
// all ferries share one light-blue, thin, dotted style (matching the Golden Horn look)
const FX = '#4AB8E8';
const ROUTES = [
  { ref:'Üsküdar–Eminönü',  color:FX,        official:'Şehir Hatları · Üsküdar – Eminönü',         places:['Üsküdar','Eminönü'] },
  { ref:'Kadıköy–Eminönü',  color:FX,        official:'Şehir Hatları · Kadıköy – Eminönü',         places:['Kadıköy','Eminönü'] },
  { ref:'Kadıköy–Karaköy',  color:FX,        official:'Şehir Hatları · Kadıköy – Karaköy',         places:['Kadıköy','Karaköy'] },
  { ref:'Üsküdar–Beşiktaş', color:FX,        official:'Şehir Hatları · Üsküdar – Beşiktaş',        places:['Üsküdar','Beşiktaş'] },
  { ref:'Kadıköy–Beşiktaş', color:FX,        official:'Şehir Hatları · Kadıköy – Beşiktaş',        places:['Kadıköy','Beşiktaş'] },
  { ref:'Üsküdar–Kabataş',  color:FX,        official:'Dentur Avrasya · Üsküdar – Kabataş',         places:['Üsküdar','Kabataş'] },
  { ref:'Kadıköy–Kabataş',  color:FX,        official:'Dentur Avrasya · Kadıköy – Kabataş',         places:['Kadıköy','Kabataş'] },
  { ref:'Bostancı–Kadıköy', color:FX,        official:'Şehir Hatları · Bostancı – Kadıköy – Karaköy', places:['Bostancı','Kadıköy','Karaköy'] },
  { ref:'Boğaz (Avrupa)',   color:'#1B6CA8', official:'Boğaz Hattı · European shore',
    places:['Eminönü','Beşiktaş','Ortaköy','Arnavutköy','Bebek','Emirgan','İstinye','Yeniköy','Sarıyer','Rumeli Kavağı'] },
  { ref:'Boğaz (Anadolu)',  color:'#1B6CA8', official:'Boğaz Hattı · Asian shore',
    places:['Üsküdar','Beylerbeyi','Çengelköy','Kandilli','Anadolu Hisarı','Kanlıca','Çubuklu','Paşabahçe','Beykoz','Anadolu Kavağı'] },
  { ref:'Haliç Hattı',      color:'#3FB6C9', official:'Golden Horn · Üsküdar – Karaköy – Eyüp',
    places:['Üsküdar','Karaköy','Kasımpaşa','Hasköy','Fener','Balat','Ayvansaray','Sütlüce','Eyüp'] },
  { ref:'Adalar (Kabataş)', color:'#5AC8E8', official:'Şehir Hatları · Kabataş – Kadıköy – Adalar',
    places:['Kabataş','Kadıköy','Kınalıada','Burgazada','Heybeliada','Büyükada'] },
  { ref:'Adalar (Bostancı)',color:'#5AC8E8', official:'Şehir Hatları · Bostancı – Adalar',
    places:['Bostancı','Kınalıada','Burgazada','Heybeliada','Büyükada'] }
];

const out = [];
const missing = [];
let geomUsed = 0;
for (const r of ROUTES){
  const stations = r.places.map(p => { const f = findPier(p); if(!f) missing.push(r.ref+': '+p); return f; }).filter(Boolean);
  if (stations.length < 2) continue;
  const start = [stations[0].lat, stations[0].lng];
  const end   = [stations[stations.length-1].lat, stations[stations.length-1].lng];
  // prefer real OSM over-water geometry; fall back to straight pier-to-pier
  const g = findGeom(start, end);
  const round = p => [ +p[0].toFixed(5), +p[1].toFixed(5) ];
  let path, src;
  if (g){ path = simplify(g.coords, 0.00006).map(round); src='osm'; geomUsed++; }
  else {
    let pts = stations.map(s => [s.lat, s.lng]);
    const off = OFFSETS[r.ref];
    if (off) pts = offsetMidpoints(pts, off[0], off[1]);   // route around headlands / into the strait
    path = catmullRom(pts, 14).map(round); src='piers';
  }
  out.push({ ref:r.ref, kind:'ferry', color:FX, paths:[path], stations,
             scope:'active', official:r.official, geom:src });
}

fs.writeFileSync(path.join(DIR,'ferry-lines.json'), JSON.stringify(out));
console.log('REF'.padEnd(18),'PIERS','GEOM','PTS','OFFICIAL');
for (const l of out) console.log(l.ref.padEnd(18), String(l.stations.length).padEnd(5), (l.geom||'').padEnd(5), String(l.paths[0].length).padEnd(4), l.official);
if (missing.length) console.log('\nMISSING PIERS:', missing.join(' | '));
console.log('\nTOTAL FERRY LINES:', out.length, ' USING OSM GEOMETRY:', geomUsed, ' RELPATHS:', relPaths.length);
