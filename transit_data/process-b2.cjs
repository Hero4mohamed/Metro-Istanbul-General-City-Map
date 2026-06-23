// Process the B2 Halkalı–Bahçeşehir suburban (banliyö) rail line from OSM.
const fs = require('fs'); const path = require('path');
const DIR = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(DIR,'b2-geom.json'),'utf8'));
const nodes = raw.elements.filter(e=>e.type==='node');
const nodeMap = {}; for(const n of nodes) nodeMap[n.id] = { name:(n.tags&&n.tags.name)||null, lat:n.lat, lon:n.lon };

const Rm=6371000, toRad=d=>d*Math.PI/180;
function meters(a,b){const dLat=toRad(b[0]-a[0]),dLng=toRad(b[1]-a[1]),la1=toRad(a[0]),la2=toRad(b[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;return 2*Rm*Math.asin(Math.sqrt(h));}
const chainLen=c=>{let s=0;for(let i=1;i<c.length;i++)s+=meters(c[i-1],c[i]);return s;};
function buildChains(ways,tol){let ch=ways.map(w=>w.slice());let mg=1;while(mg){mg=0;
  for(let i=0;i<ch.length&&!mg;i++)for(let j=i+1;j<ch.length;j++){const A=ch[i],B=ch[j],a0=A[0],a1=A[A.length-1],b0=B[0],b1=B[B.length-1];let nc=null;
    if(meters(a1,b0)<tol)nc=A.concat(B.slice(1));else if(meters(a1,b1)<tol)nc=A.concat(B.slice().reverse().slice(1));
    else if(meters(a0,b1)<tol)nc=B.concat(A.slice(1));else if(meters(a0,b0)<tol)nc=B.slice().reverse().concat(A.slice(1));
    if(nc){ch[i]=nc;ch.splice(j,1);mg=1;break;}}}return ch;}
function simplify(pts,eps){if(pts.length<3)return pts;const sq=eps*eps;const keep=new Array(pts.length).fill(false);
  keep[0]=keep[pts.length-1]=true;const st=[[0,pts.length-1]];
  const sd=(p,a,b)=>{const x=a[0],y=a[1];let dx=b[0]-x,dy=b[1]-y;if(dx||dy){const t=((p[0]-x)*dx+(p[1]-y)*dy)/(dx*dx+dy*dy);
    if(t>1){dx=p[0]-b[0];dy=p[1]-b[1];}else if(t>0){dx=p[0]-(x+dx*t);dy=p[1]-(y+dy*t);}else{dx=p[0]-x;dy=p[1]-y;}}else{dx=p[0]-x;dy=p[1]-y;}return dx*dx+dy*dy;};
  while(st.length){const[s,e]=st.pop();let md=0,idx=-1;for(let i=s+1;i<e;i++){const dd=sd(pts[i],pts[s],pts[e]);if(dd>md){md=dd;idx=i;}}
    if(md>sq&&idx!==-1){keep[idx]=true;st.push([s,idx],[idx,e]);}}return pts.filter((_,i)=>keep[i]);}

// pick the richest B2 relation, stitch its ways, collect named stops
let best=null;
for(const rel of raw.elements.filter(e=>e.type==='relation')){
  const ways=(rel.members||[]).filter(m=>m.type==='way'&&m.geometry).map(m=>m.geometry.map(g=>[g.lat,g.lon]));
  if(!ways.length) continue;
  const chains=buildChains(ways,40).sort((a,b)=>chainLen(b)-chainLen(a));
  const stations=[];const seen=new Set();
  for(const m of (rel.members||[])){ if(m.type!=='node'||!/stop|platform/.test(m.role||''))continue;
    const info=nodeMap[m.ref]; if(!info||!info.name||seen.has(info.name))continue; seen.add(info.name);
    stations.push({name:info.name,lat:info.lat,lng:info.lon}); }
  const score=chainLen(chains[0])+stations.length*1000;
  if(!best||score>best.score) best={chains,stations,score};
}
const round=p=>[+p[0].toFixed(5),+p[1].toFixed(5)];
const coords=simplify(best.chains[0],0.00003).map(round);
const stations=best.stations.map(s=>({name:s.name,lat:+s.lat.toFixed(5),lng:+s.lng.toFixed(5)}));
const out=[{ ref:'B2', kind:'suburban', color:'#1F6FB2', paths:[coords], stations, scope:'active',
            official:'B2 · Halkalı – Bahçeşehir Banliyö Hattı' }];
fs.writeFileSync(path.join(DIR,'b2-line.json'), JSON.stringify(out));
console.log('B2: pts='+coords.length+' stations='+stations.length+' km='+(chainLen(best.chains[0])/1000).toFixed(1));
console.log('  stops:', stations.map(s=>s.name).join(' · '));
