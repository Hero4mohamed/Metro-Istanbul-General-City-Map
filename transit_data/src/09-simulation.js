/* ===========================================================================
   5. TRAIN SIMULATION  (carriages move along real geometry)
   =========================================================================== */
const trains = [];
function spawnTrains(){
  trains.length = 0;
  let id = 0;
  liveLines.forEach(line => {
    const tm = lineTiming(line.ref);
    const mps = tm.spd * 1000/3600;                       // commercial speed (m/s)

    /* A funicular's two cars are not independent vehicles that happen to share a route. They
       hang from the same rope over a drum at the summit, so one descends BECAUSE the other
       climbs: their positions always sum to the track length, and they reach opposite ends at
       the same moment. Simulated separately they drifted apart within a minute and could sit
       at the same station at once — something the machinery physically forbids, and visible on
       the map as two cars crossing the same platform.

       Only `funicular` is modelled this way, because for a funicular the counterbalance IS the
       definition of the mode. TF1 and TF2 are aerial cable cars, and nothing this project
       ships says whether they are two-cabin reversible systems or continuous gondolas carrying
       many cabins. Pairing them on a guess would trade one fiction for another, so they keep
       the generic model. A line may opt out explicitly if a city ever ships that fact. */
    if(line.kind === 'funicular' && line.paired !== false && (line._stops||[]).length >= 2){
      trains.push(...spawnCounterbalanced(line, mps, () => id++));
      return;
    }

    // trains needed so arrivals match the real headway: 2 dirs × (one-way time / headway)
    const traverseMin = (line._len/1000) / tm.spd * 60;
    let count = Math.round(2 * traverseMin / tm.hwMin);
    count = Math.max(2, Math.min(count, 18));
    for(let i=0;i<count;i++){
      const dir = (i%2===0)?1:-1;
      const s = (line._len) * (i/count) * 0.96 + 30;
      const tr = { id:id++, line, ref:line.ref, color:line.color, speed:mps, s, dir, dwell:0, state:"run" };
      tr.targetIdx = nextStopIndex(line, s, dir);
      trains.push(tr);
    }
  });
}
/* Vehicle state, readable from outside the page's own scope.

   `trains` is a top-level const, which — unlike the function declarations around it — is not a
   window property, and this page's Content-Security-Policy rightly forbids eval. So anything
   that wants to inspect what the vehicles are doing needs a named function to ask through:
   the browser test that proves the funicular pair stays counterbalanced, and any later
   consumer of live vehicle state. Returns copies, so a caller cannot steer the simulation. */
function simCars(ref){
  return trains
    .filter(t => !ref || t.ref === ref)
    .map(t => ({ id:t.id, ref:t.ref, kind:(t.line && t.line.kind) || null,
                 s:t.s, dir:t.dir, state:t.state,
                 paired: !!t.paired, derived: !!t.mirrorOf,
                 pairSpan: (t.pairSpan != null ? t.pairSpan : null) }));
}
/* The pair. One car is simulated normally; the other is DERIVED from it every frame rather
   than simulated alongside it, which is what makes drift impossible rather than merely
   unlikely — there is only one state, and the second car is a view of it. */
function spawnCounterbalanced(line, mps, nextId){
  const stops = line._stops;
  const lo = stops[0], hi = stops[stops.length-1];
  const lead = { id:nextId(), line, ref:line.ref, color:line.color, speed:mps,
                 s:lo, dir:1, dwell:0, state:'run', paired:true };
  lead.targetIdx = nextStopIndex(line, lead.s, lead.dir);
  const mate = { id:nextId(), line, ref:line.ref, color:line.color, speed:mps,
                 s:hi, dir:-1, dwell:0, state:'run', paired:true, mirrorOf:lead };
  mate.targetIdx = nextStopIndex(line, mate.s, mate.dir);
  // the sum the pair must always preserve; taken from the real endpoints, not assumed to be _len
  lead.pairSpan = mate.pairSpan = lo + hi;
  return [lead, mate];
}
function nextStopIndex(line, s, dir){
  const stops = line._stops;
  if(dir>0){ for(let i=0;i<stops.length;i++) if(stops[i] > s+1) return i; return stops.length-1; }
  else { for(let i=stops.length-1;i>=0;i--) if(stops[i] < s-1) return i; return 0; }
}
function updateTrains(dt){
  const st = dt*simSpeed;
  for(const tr of trains){
    if(tr.mirrorOf) continue;                 // derived from its partner in the second pass
    const stops = tr.line._stops;
    if(tr.state==="dwell"){
      tr.dwell -= st;
      if(tr.dwell<=0){
        tr.state="run";
        tr.targetIdx += tr.dir;
        if(tr.targetIdx>=stops.length){ tr.dir=-1; tr.targetIdx=stops.length-2; }
        else if(tr.targetIdx<0){ tr.dir=1; tr.targetIdx=1; }
      }
      continue;
    }
    const target = stops[tr.targetIdx];
    tr.s += tr.dir*tr.speed*st;
    if(tr.dir>0 && tr.s>=target){ tr.s=target; tr.state="dwell"; tr.dwell=DWELL; }
    else if(tr.dir<0 && tr.s<=target){ tr.s=target; tr.state="dwell"; tr.dwell=DWELL; }
  }
  /* Second pass: the counterbalanced car reads its whole state off its partner — position
     mirrored about the track, direction reversed, dwelling when it dwells. A separate pass so
     it cannot matter which car happens to come first in the list. */
  for(const tr of trains){
    if(!tr.mirrorOf) continue;
    const a = tr.mirrorOf;
    tr.s = tr.pairSpan - a.s;
    tr.dir = -a.dir;
    tr.state = a.state;
    tr.dwell = a.dwell;
    tr.targetIdx = nextStopIndex(tr.line, tr.s, tr.dir);
  }
}

// train rendering on the overlay canvas
const tcv = document.getElementById('trainCanvas');
const tctx = tcv.getContext('2d');
let DPR=1, hideTrainsZoom=false, labelAlpha=0;
const LABEL_FONT = "Inter,-apple-system,'Segoe UI',Roboto,sans-serif";
function sizeCanvas(){
  DPR = window.devicePixelRatio||1;
  const s = map.getSize();
  tcv.width = s.x*DPR; tcv.height = s.y*DPR;
  tcv.style.width = s.x+'px'; tcv.style.height = s.y+'px';
  tctx.setTransform(DPR,0,0,DPR,0,0);
}
/* Keep the map and the carriage overlay matched to the window.

   Both were sized once at load and never again — there was no resize listener in the app at
   all. Resize the window, rotate a phone, or let a mobile browser's toolbar collapse, and the
   map kept its old dimensions: tiles covered only the original area and the rest of the
   viewport stayed empty, which reads as "the map stopped loading". The overlay canvas drifted
   the same way, so carriages and labels landed in the wrong place.

   Debounced, because resizing fires continuously while dragging. visualViewport is watched
   too — on mobile that is what actually changes when the URL bar shows or hides. */
let _relayoutT = 0;
function relayoutMap(){
  map.invalidateSize();          // re-measure the container and request any newly exposed tiles
  sizeCanvas();                  // overlay must match the new pixel size, DPR included
  try{ applyZoomStyling(); }catch(e){}
}
function scheduleRelayout(delay){
  clearTimeout(_relayoutT);
  _relayoutT = setTimeout(relayoutMap, delay || 150);
}
window.addEventListener('resize', () => scheduleRelayout(150));
window.addEventListener('orientationchange', () => scheduleRelayout(350));   // after the rotation settles
if(window.visualViewport) window.visualViewport.addEventListener('resize', () => scheduleRelayout(200));
// coming back to a backgrounded tab can also mean the viewport moved underneath us
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') scheduleRelayout(120); });

// single overlay pass: clear → station labels (zoom-faded) → sleek carriages
function renderOverlay(now){
  const s = map.getSize();
  tctx.clearRect(0,0,s.x,s.y);
  if(hideTrainsZoom) return;
  if(focusRefs) return;              // focused on one route: no other labels or carriages
  drawLabels();
  if(showTrains && currentTab==='active') drawTrains(now);
}
function drawLabels(){
  if(labelAlpha < 0.03) return;
  const list = currentTab==='active' ? stationList : (currentTab==='vision' ? plannedStationList : []);
  const z = map.getZoom(), s = map.getSize();
  tctx.save();
  tctx.globalAlpha = labelAlpha;
  tctx.font = "600 11px "+LABEL_FONT;
  tctx.textBaseline = "middle"; tctx.textAlign = "left"; tctx.lineJoin = "round";
  for(const r of list){
    const multi = r.lines && r.lines.size>1;
    if(z < 14 && !multi) continue;                    // below z14 → interchanges only
    const p = map.latLngToContainerPoint([r.lat, r.lng]);
    if(p.x<-60||p.y<-16||p.x>s.x+60||p.y>s.y+16) continue;
    const x = p.x + 8, y = p.y;
    tctx.lineWidth = 3.2; tctx.strokeStyle = "rgba(7,10,16,0.92)";
    tctx.strokeText(r.name, x, y);
    tctx.fillStyle = multi ? "#ffffff" : "#cdd5e4";
    tctx.fillText(r.name, x, y);
  }
  tctx.restore();
}
function drawTrains(now){
  const s = map.getSize(), z = map.getZoom();
  const rad = z>=14?4.6 : z>=12?3.7 : 2.8;
  for(const tr of trains){
    if(!lineLayers[tr.ref].on) continue;
    if(closedCache[tr.ref]) continue;                 // line suspended / outside service hours
    const ll = posAt(tr.line, tr.s);
    const p = map.latLngToContainerPoint([ll[0], ll[1]]);
    if(p.x<-15||p.y<-15||p.x>s.x+15||p.y>s.y+15) continue;
    const dwell = tr.state==="dwell";
    // sleek translucent dot
    tctx.globalAlpha = 0.85;
    tctx.beginPath(); tctx.arc(p.x,p.y,rad,0,7);
    tctx.fillStyle = tr.color; tctx.fill();
    // soft inner pulse (or steady gold while dwelling)
    const pulse = 0.30 + 0.30*Math.sin(now*0.005 + tr.id*1.3);
    tctx.globalAlpha = dwell ? 0.95 : 0.25 + pulse;
    tctx.beginPath(); tctx.arc(p.x,p.y,Math.max(1, rad*0.42),0,7);
    tctx.fillStyle = dwell ? "#FFE08A" : "#ffffff"; tctx.fill();
    if(dwell){
      tctx.globalAlpha = 0.9; tctx.lineWidth = 1; tctx.strokeStyle = "#FFC94D";
      tctx.beginPath(); tctx.arc(p.x,p.y,rad+1.4,0,7); tctx.stroke();
    }
  }
  tctx.globalAlpha = 1;
}

