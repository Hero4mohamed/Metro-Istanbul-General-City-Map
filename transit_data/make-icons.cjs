// Generate PWA icons from the route-M mark (dependency-free PNG encoder).
// Outputs: assets/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
const fs=require('fs'), zlib=require('zlib'), path=require('path');
const OUT=path.resolve(__dirname,'..','assets'); fs.mkdirSync(OUT,{recursive:true});

const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
const chunk=(ty,da)=>{const l=Buffer.alloc(4);l.writeUInt32BE(da.length,0);const t=Buffer.from(ty);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(Buffer.concat([t,da])),0);return Buffer.concat([l,t,da,cr]);};
const lerp=(a,b,t)=>Math.round(a+(b-a)*t);

function makeIcon(S, file, opts){
  opts=opts||{};
  const buf=Buffer.alloc(S*S*3);
  const set=(x,y,r,g,b)=>{ if(x<0||y<0||x>=S||y>=S)return; const i=(y*S+x)*3; buf[i]=r;buf[i+1]=g;buf[i+2]=b; };
  const disc=(cx,cy,rad,r,g,b)=>{ for(let y=-rad;y<=rad;y++)for(let x=-rad;x<=rad;x++) if(x*x+y*y<=rad*rad) set(Math.round(cx)+x,Math.round(cy)+y,r,g,b); };
  // background: full-bleed dark with a soft emerald glow (maskable-safe — no transparency)
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){
    const d=Math.hypot(x-S*0.3,y-S*0.25)/(S*0.95), gl=Math.max(0,1-d);
    set(x,y, lerp(9,13,gl), lerp(13,24,gl), lerp(21,29,gl));
  }
  // subtle rounded-tile inset ring (visual depth, still full-bleed)
  const m=opts.pad!==undefined?opts.pad:0.10;               // mark scale padding
  const cx=S/2, top=S*(0.5-0.235+m*0.2);
  // M route: feet/peaks proportional to S
  const w=S*(0.30-m*0.35), h=S*(0.24-m*0.25);
  const P=[[cx-w,cx? S*0.5+h : 0],[cx-w,S*0.5-h],[cx,S*0.5+h*0.55],[cx+w,S*0.5-h],[cx+w,S*0.5+h]];
  P[0][1]=S*0.5+h;
  let total=0; const segL=[]; for(let i=1;i<P.length;i++){ const L=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]); segL.push(L); total+=L; }
  const sw=Math.max(4,Math.round(S*0.052));
  let acc=0;
  for(let i=1;i<P.length;i++){
    const steps=Math.ceil(segL[i-1]);
    for(let s=0;s<=steps;s++){
      const t=(acc+segL[i-1]*s/steps)/total;
      disc(P[i-1][0]+(P[i][0]-P[i-1][0])*s/steps, P[i-1][1]+(P[i][1]-P[i-1][1])*s/steps, sw,
           lerp(74,20,t), lerp(222,184,t), lerp(128,166,t));
    }
    acc+=segL[i-1];
  }
  disc(P[1][0],P[1][1],Math.round(sw*0.85),255,255,255);
  disc(P[3][0],P[3][1],Math.round(sw*0.85),255,255,255);
  disc(P[2][0],P[2][1],Math.round(sw*1.05),229,72,77);
  disc(P[2][0],P[2][1],Math.round(sw*0.4),255,255,255);
  const stride=S*3,raw=Buffer.alloc((stride+1)*S);
  for(let y=0;y<S;y++){ raw[y*(stride+1)]=0; buf.copy(raw,y*(stride+1)+1,y*stride,y*stride+stride); }
  const ih=Buffer.alloc(13); ih.writeUInt32BE(S,0); ih.writeUInt32BE(S,4); ih[8]=8; ih[9]=2;
  fs.writeFileSync(path.join(OUT,file),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]));
  console.log('wrote',file);
}
makeIcon(192,'icon-192.png');
makeIcon(512,'icon-512.png');
makeIcon(512,'icon-maskable-512.png',{pad:0.16});   // extra safe-zone padding for maskable
makeIcon(180,'apple-touch-icon.png');
