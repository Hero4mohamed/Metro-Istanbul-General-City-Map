// Generate assets/og-card.png (1200×630 social-preview card): the app icon (assets/icon-512.png, the picture the user
// supplied for V4.0) beside the wordmark. Dependency-free: hand-rolled PNG reader/encoder + a 5×7 pixel font.
const fs=require('fs'), zlib=require('zlib'), path=require('path');
const OUT=path.resolve(__dirname,'..','assets');
fs.mkdirSync(OUT,{recursive:true});

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

// the app icon: read assets/icon-512.png (8-bit RGBA, not interlaced) and draw it, smoothed down, with its own rounded corners
function readPng(file){
  const b=fs.readFileSync(file); let pos=8, w=0, h=0; const idat=[];
  while(pos<b.length){ const len=b.readUInt32BE(pos), type=b.toString('latin1',pos+4,pos+8);
    if(type==='IHDR'){ w=b.readUInt32BE(pos+8); h=b.readUInt32BE(pos+12); if(b[pos+16]!==8||b[pos+17]!==6||b[pos+20]!==0) throw new Error(file+' must be 8-bit RGBA and not interlaced'); }
    if(type==='IDAT') idat.push(b.subarray(pos+8,pos+8+len));
    pos+=12+len; }
  const raw=zlib.inflateSync(Buffer.concat(idat)), bpp=4, stride=w*bpp, out=Buffer.alloc(stride*h); let prev=Buffer.alloc(stride);
  for(let r=0;r<h;r++){ const ft=raw[r*(stride+1)], line=out.subarray(r*stride,(r+1)*stride);
    raw.copy(line,0,r*(stride+1)+1,(r+1)*(stride+1));
    for(let i=0;i<stride;i++){ const a=i>=bpp?line[i-bpp]:0, up=prev[i], ul=i>=bpp?prev[i-bpp]:0; let v=line[i];
      if(ft===1)v+=a; else if(ft===2)v+=up; else if(ft===3)v+=(a+up)>>1;
      else if(ft===4){ const p=a+up-ul, pa=Math.abs(p-a), pb=Math.abs(p-up), pc=Math.abs(p-ul); v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?up:ul); }
      line[i]=v&255; }
    prev=line; }
  return { w, h, px: out };
}
const ICON=readPng(path.join(OUT,'icon-512.png'));
const IS=380, IX=70, IY=Math.round((H-IS)/2);       // size and position of the icon on the card
// a soft emerald glow behind it, so the dark card does not swallow the rounded corners
const RR=Math.round(IS*0.157);                      // corner radius of the icon's rounded square
for(let y=IY-60;y<IY+IS+60;y++)for(let x=IX-60;x<IX+IS+60;x++){
  // distance outside the ROUNDED square (not its bounding box, or the empty corners would show as a dark box inside the glow)
  const qx=Math.abs(x-(IX+IS/2))-(IS/2-RR), qy=Math.abs(y-(IY+IS/2))-(IS/2-RR);
  const d=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-RR;
  if(d>0&&d<60){ const a=Math.pow(1-d/60,2)*0.22; const i=(y*W+x)*3; buf[i]=lerp(buf[i],52,a); buf[i+1]=lerp(buf[i+1],211,a); buf[i+2]=lerp(buf[i+2],153,a); }
}
for(let y=0;y<IS;y++)for(let x=0;x<IS;x++){
  // bilinear sample of the 512 px icon at the centre of this output pixel
  const fx=(x+0.5)*ICON.w/IS-0.5, fy=(y+0.5)*ICON.h/IS-0.5, x0=Math.max(0,Math.floor(fx)), y0=Math.max(0,Math.floor(fy)), x1=Math.min(ICON.w-1,x0+1), y1=Math.min(ICON.h-1,y0+1), tx=fx-x0, ty=fy-y0;
  const px=(xx,yy,c)=>ICON.px[(yy*ICON.w+xx)*4+c];
  const ch=c=>(px(x0,y0,c)*(1-tx)+px(x1,y0,c)*tx)*(1-ty)+(px(x0,y1,c)*(1-tx)+px(x1,y1,c)*tx)*ty;
  const a=ch(3)/255; if(a<=0) continue;
  const o=((IY+y)*W+(IX+x))*3;
  buf[o]=Math.round(buf[o]*(1-a)+ch(0)*a); buf[o+1]=Math.round(buf[o+1]*(1-a)+ch(1)*a); buf[o+2]=Math.round(buf[o+2]*(1-a)+ch(2)*a);
}

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
text("İSTANBUL · RAY-NET", 520, 205, 5, 238,242,248);
fill(520, 262, 520+230, 268, 52,211,153);
text("LIVE TRANSIT NETWORK MAP", 520, 296, 3, 147,157,178);
text("METRO · TRAM · FERRY · BUS · CABLE CAR", 520, 332, 2, 94,104,128);

/* encode */
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
const chunk=(ty,da)=>{const l=Buffer.alloc(4);l.writeUInt32BE(da.length,0);const t=Buffer.from(ty);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(Buffer.concat([t,da])),0);return Buffer.concat([l,t,da,cr]);};
const stride=W*3,raw=Buffer.alloc((stride+1)*H);
for(let y=0;y<H;y++){ raw[y*(stride+1)]=0; buf.copy(raw,y*(stride+1)+1,y*stride,y*stride+stride); }
const ih=Buffer.alloc(13); ih.writeUInt32BE(W,0); ih.writeUInt32BE(H,4); ih[8]=8; ih[9]=2;
fs.writeFileSync(path.join(OUT,'og-card.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]));
console.log('wrote assets/og-card.png',(fs.statSync(path.join(OUT,'og-card.png')).size/1024).toFixed(0)+'KB');
