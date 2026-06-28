// Dependency-free PNG renderer to VISUALLY verify ferry geometry against the real
// coastline — bypasses the flaky headless screenshot. Draws filled islands (closed
// coastline ways) + mainland outline + each ferry path (vertices as dots) + piers.
// Usage: node render-check.cjs <minLat> <minLng> <maxLat> <maxLng> <W> <out.png> [refSubstr]
const fs=require('fs'), zlib=require('zlib'), path=require('path'); const DIR=__dirname;

// ---- minimal PNG (truecolor) ----
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const t=Buffer.from(type);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])),0);return Buffer.concat([len,t,data,crc]);}
function encodePNG(W,H,rgb){
  const stride=W*3, raw=Buffer.alloc((stride+1)*H);
  for(let y=0;y<H;y++){ raw[y*(stride+1)]=0; rgb.copy(raw,y*(stride+1)+1,y*stride,y*stride+stride); }
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',zlib.deflateSync(raw,{level:9})), chunk('IEND',Buffer.alloc(0))]);
}

// ---- args + projection ----
const [minLat,minLng,maxLat,maxLng]=process.argv.slice(2,6).map(Number);
const W=+(process.argv[6]||820);
const OUT=process.argv[7]||'check.png';
const REF=process.argv[8]||'';
const lat0=(minLat+maxLat)/2, kx=Math.cos(lat0*Math.PI/180);
const H=Math.round(W * ((maxLat-minLat)/((maxLng-minLng)*kx)));
const px=lng=>Math.round((lng-minLng)/(maxLng-minLng)*W);
const py=lat=>Math.round((maxLat-lat)/(maxLat-minLat)*H);
const buf=Buffer.alloc(W*H*3);
function set(x,y,r,g,b){ if(x<0||y<0||x>=W||y>=H)return; const i=(y*W+x)*3; buf[i]=r;buf[i+1]=g;buf[i+2]=b; }
function bg(r,g,b){ for(let i=0;i<W*H;i++){ buf[i*3]=r;buf[i*3+1]=g;buf[i*3+2]=b; } }
function line(x0,y0,x1,y1,r,g,b,wd){ wd=wd||1; let dx=Math.abs(x1-x0),dy=Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1,err=dx-dy;
  while(true){ for(let ox=-(wd>>1);ox<=(wd>>1);ox++)for(let oy=-(wd>>1);oy<=(wd>>1);oy++)set(x0+ox,y0+oy,r,g,b);
    if(x0===x1&&y0===y1)break; const e2=2*err; if(e2>-dy){err-=dy;x0+=sx;} if(e2<dx){err+=dx;y0+=sy;} } }
function disc(cx,cy,rad,r,g,b){ for(let y=-rad;y<=rad;y++)for(let x=-rad;x<=rad;x++) if(x*x+y*y<=rad*rad) set(cx+x,cy+y,r,g,b); }
// scanline fill of a closed polygon (array of [x,y])
function fillPoly(pts,r,g,b){ let minY=H,maxY=0; for(const p of pts){ if(p[1]<minY)minY=p[1]; if(p[1]>maxY)maxY=p[1]; }
  minY=Math.max(0,minY); maxY=Math.min(H-1,maxY);
  for(let y=minY;y<=maxY;y++){ const xs=[]; for(let i=0,j=pts.length-1;i<pts.length;j=i++){ const yi=pts[i][1],yj=pts[j][1];
      if((yi>y)!==(yj>y)){ const x=pts[i][0]+(y-yi)/(yj-yi)*(pts[j][0]-pts[i][0]); xs.push(x); } }
    xs.sort((a,b)=>a-b); for(let k=0;k+1<xs.length;k+=2){ for(let x=Math.max(0,Math.ceil(xs[k]));x<=Math.min(W-1,Math.floor(xs[k+1]));x++) set(x,y,r,g,b); } } }

// ---- draw ----
bg(18,28,42);                                   // water
const coast=JSON.parse(fs.readFileSync(path.join(DIR,'coastline.json'),'utf8'));
const ways=coast.elements.filter(e=>e.type==='way'&&e.geometry);
// filled land for closed ways (islands), outline for open ways (mainland)
for(const w of ways){ const g=w.geometry; const closed=g.length>3 && Math.abs(g[0].lat-g[g.length-1].lat)<1e-6 && Math.abs(g[0].lon-g[g.length-1].lon)<1e-6;
  const pts=g.map(p=>[px(p.lon),py(p.lat)]);
  if(closed) fillPoly(pts,44,54,40); }
for(const w of ways){ const g=w.geometry; for(let i=1;i<g.length;i++) line(px(g[i-1].lon),py(g[i-1].lat),px(g[i].lon),py(g[i].lat),96,108,96,1); }

const ferries=JSON.parse(fs.readFileSync(path.join(DIR,'ferry-lines.json'),'utf8'));
const COLS=[[90,200,255],[255,170,60],[120,230,140],[255,120,200],[180,160,255],[120,210,235],[240,220,120]];
let ci=0, drawn=[];
for(const l of ferries){ if(REF && !l.ref.toLowerCase().includes(REF.toLowerCase())) continue;
  const c=COLS[ci++%COLS.length]; const p=l.paths[0];
  for(let i=1;i<p.length;i++) line(px(p[i-1][1]),py(p[i-1][0]),px(p[i][1]),py(p[i][0]),c[0],c[1],c[2],2);
  for(let i=0;i<p.length;i++) disc(px(p[i][1]),py(p[i][0]),1,c[0],c[1],c[2]);   // vertices reveal scribbles
  for(const s of (l.stations||[])) disc(px(s.lng),py(s.lat),4,255,60,60);        // piers = red
  drawn.push(l.ref+' ['+c.join(',')+']');
}
fs.writeFileSync(path.join(DIR,OUT), encodePNG(W,H,buf));
console.log('wrote',OUT,W+'x'+H,'| lines:',drawn.join('  '));
