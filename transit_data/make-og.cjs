// Generate assets/og-card.png (1200×630 social-preview card) + assets/logo.svg.
// Dependency-free: hand-rolled PNG encoder + a 5×7 pixel font for the wordmark.
const fs=require('fs'), zlib=require('zlib'), path=require('path');
const OUT=path.resolve(__dirname,'..','assets');
fs.mkdirSync(OUT,{recursive:true});

/* ---------- standalone logo.svg (same mark as the app) ---------- */
fs.writeFileSync(path.join(OUT,'logo.svg'),
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34" width="256" height="256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4ADE80"/><stop offset="1" stop-color="#14B8A6"/>
  </linearGradient></defs>
  <rect x="1.2" y="1.2" width="31.6" height="31.6" rx="9.5" fill="#0B0F17" stroke="rgba(255,255,255,.16)" stroke-width="1.2"/>
  <path d="M8 24 V11 L17 19.5 26 11 V24" fill="none" stroke="url(#g)" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="8" cy="11" r="2" fill="#fff"/><circle cx="26" cy="11" r="2" fill="#fff"/>
  <circle cx="17" cy="19.5" r="2.3" fill="#E5484D"/>
</svg>
`);

/* ---------- 1200×630 PNG card ---------- */
const W=1200,H=630,buf=Buffer.alloc(W*H*3);
function set(x,y,r,g,b){ if(x<0||y<0||x>=W||y>=H)return; const i=(y*W+x)*3; buf[i]=r;buf[i+1]=g;buf[i+2]=b; }
function fill(x0,y0,x1,y1,r,g,b){ for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)set(x,y,r,g,b); }
function disc(cx,cy,rad,r,g,b){ for(let y=-rad;y<=rad;y++)for(let x=-rad;x<=rad;x++) if(x*x+y*y<=rad*rad) set(cx+x,cy+y,r,g,b); }
function thick(x0,y0,x1,y1,wd,r,g,b){ const n=Math.ceil(Math.hypot(x1-x0,y1-y0)); for(let i=0;i<=n;i++){ disc(Math.round(x0+(x1-x0)*i/n),Math.round(y0+(y1-y0)*i/n),(wd/2)|0,r,g,b);} }
function rrect(x,y,w,h,rad,r,g,b){ for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){ const dx=Math.max(rad-xx,xx-(w-1-rad),0),dy=Math.max(rad-yy,yy-(h-1-rad),0); if(dx*dx+dy*dy<=rad*rad||dx===0||dy===0) if(!((dx>0)&&(dy>0)&&dx*dx+dy*dy>rad*rad)) set(x+xx,y+yy,r,g,b);} }
const lerp=(a,b,t)=>Math.round(a+(b-a)*t);

// background: deep navy with a soft emerald glow top-left and faint dot grid
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const d=Math.hypot(x-190,y-160)/900;
  const gl=Math.max(0,1-d);
  set(x,y, lerp(7,10,gl), lerp(10,22,gl), lerp(18,26,gl));
}
for(let y=40;y<H;y+=44)for(let x=40;x<W;x+=44){ set(x,y,22,28,40); set(x+1,y,22,28,40); set(x,y+1,22,28,40); }

// logo tile
const TX=95,TY=165,TS=300;
rrect(TX-6,TY-6,TS+12,TS+12,44,26,33,46);          // border halo
rrect(TX,TY,TS,TS,40,11,15,23);                    // tile
// M route (gradient emerald→teal along the stroke)
const pts=[[TX+62,TY+218],[TX+62,TY+92],[TX+150,TY+175],[TX+238,TY+92],[TX+238,TY+218]];
let total=0; const segL=[]; for(let i=1;i<pts.length;i++){ const L=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]); segL.push(L); total+=L; }
let acc=0;
for(let i=1;i<pts.length;i++){
  const steps=Math.ceil(segL[i-1]);
  for(let s=0;s<=steps;s++){
    const t=(acc+segL[i-1]*s/steps)/total;
    disc(Math.round(pts[i-1][0]+(pts[i][0]-pts[i-1][0])*s/steps),
         Math.round(pts[i-1][1]+(pts[i][1]-pts[i-1][1])*s/steps), 14,
         lerp(74,20,t), lerp(222,184,t), lerp(128,166,t));
  }
  acc+=segL[i-1];
}
disc(pts[1][0],pts[1][1],12,255,255,255);          // terminal stations
disc(pts[3][0],pts[3][1],12,255,255,255);
disc(pts[2][0],pts[2][1],15,229,72,77);            // red hub
disc(pts[2][0],pts[2][1],6,255,255,255);

// 5×7 pixel font
const F={
 'A':["01110","10001","10001","11111","10001","10001","10001"],
 'B':["11110","10001","11110","10001","10001","10001","11110"],
 'C':["01111","10000","10000","10000","10000","10000","01111"],
 'D':["11110","10001","10001","10001","10001","10001","11110"],
 'E':["11111","10000","11110","10000","10000","10000","11111"],
 'F':["11111","10000","11110","10000","10000","10000","10000"],
 'I':["11111","00100","00100","00100","00100","00100","11111"],
 'İ':["00100","00000","11111","00100","00100","00100","11111"],
 'K':["10001","10010","10100","11000","10100","10010","10001"],
 'L':["10000","10000","10000","10000","10000","10000","11111"],
 'M':["10001","11011","10101","10101","10001","10001","10001"],
 'N':["10001","11001","10101","10011","10001","10001","10001"],
 'O':["01110","10001","10001","10001","10001","10001","01110"],
 'P':["11110","10001","10001","11110","10000","10000","10000"],
 'R':["11110","10001","10001","11110","10100","10010","10001"],
 'S':["01111","10000","10000","01110","00001","00001","11110"],
 'T':["11111","00100","00100","00100","00100","00100","00100"],
 'U':["10001","10001","10001","10001","10001","10001","01110"],
 'V':["10001","10001","10001","10001","10001","01010","00100"],
 'W':["10001","10001","10001","10101","10101","11011","10001"],
 'Y':["10001","10001","01010","00100","00100","00100","00100"],
 '-':["00000","00000","00000","11111","00000","00000","00000"],
 '·':["00000","00000","00000","00100","00000","00000","00000"],
 ' ':["000","000","000","000","000","000","000"],
};
function text(str,x,y,sc,r,g,b){
  let cx=x;
  for(const ch of str){
    const gl=F[ch]||F[' '];
    for(let row=0;row<7;row++)for(let col=0;col<gl[row].length;col++)
      if(gl[row][col]==='1') fill(cx+col*sc, y+row*sc, cx+(col+1)*sc, y+(row+1)*sc, r,g,b);
    cx += (gl[0].length+1)*sc;
  }
  return cx;
}
// wordmark + subtitle + accent underline
text("İSTANBUL · RAY-NET", 470, 205, 6, 238,242,248);
fill(470, 268, 470+250, 274, 52,211,153);
text("LIVE TRANSIT NETWORK MAP", 470, 300, 3, 147,157,178);
text("METRO · TRAM · FERRY · BUS · CABLE CAR", 470, 336, 2, 94,104,128);

/* encode */
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
const chunk=(ty,da)=>{const l=Buffer.alloc(4);l.writeUInt32BE(da.length,0);const t=Buffer.from(ty);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(Buffer.concat([t,da])),0);return Buffer.concat([l,t,da,cr]);};
const stride=W*3,raw=Buffer.alloc((stride+1)*H);
for(let y=0;y<H;y++){ raw[y*(stride+1)]=0; buf.copy(raw,y*(stride+1)+1,y*stride,y*stride+stride); }
const ih=Buffer.alloc(13); ih.writeUInt32BE(W,0); ih.writeUInt32BE(H,4); ih[8]=8; ih[9]=2;
fs.writeFileSync(path.join(OUT,'og-card.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]));
console.log('wrote assets/logo.svg + assets/og-card.png',(fs.statSync(path.join(OUT,'og-card.png')).size/1024).toFixed(0)+'KB');
