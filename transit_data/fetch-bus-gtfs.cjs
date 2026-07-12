// fetch-bus-gtfs.cjs — authoritative BOTH-DIRECTION bus routes + REAL departure schedules
// from the official İETT GTFS feed (data.ibb.gov.tr, dataset iett-gtfs-verisi).
//   Writes: bus-graph.json      [{ref,dir,head,stops:[[lat,lon,name],...]}]  (both directions)
//           bus-schedules.json  {ref:[{dir,head,wd,sat,sun}]}  first/last/headway per day-type
// GTFS is the transit-schedule standard: trips.direction_id gives the two directions and
// stop_times gives real per-stop times — so this is precise, not estimated.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), readline = require('readline');
const DIR = __dirname;
const RES = 'https://data.ibb.gov.tr/dataset/8540e256-6df5-4719-85bc-e64e91508ede/resource';
const URLS = {
  routes:   RES + '/46dbe388-c8c2-45c4-ac72-c06953de56a2/download/routes.csv',
  trips:    RES + '/7ff49bdd-b0d2-4a6e-9392-b598f77f5070/download/trips.csv',
  stops:    RES + '/2299bc82-983b-4bdf-8520-5cef8c555e29/download/stops.csv',
  calendar: RES + '/6c9623b1-3858-4b37-b936-8ffa78de2a69/download/calendar.csv',
  // the .csv is truncated at the 1,048,576-row spreadsheet limit — the .zip has the FULL 6.1M rows (comma-delimited)
  stop_times_zip: RES + '/80401c1c-c240-4a32-8f40-ef697100a681/download/stop_times.zip',
};
// stream a big comma-delimited file row-by-row (first line = header → column index map)
async function eachRow(file, cb){
  let ci=null;
  const rl=readline.createInterface({ input: fs.createReadStream(file), crlfDelay:Infinity });
  for await (const line of rl){ if(ci===null){ ci={}; line.split(',').forEach((c,i)=>ci[c.trim().replace(/^﻿/,'')]=i); continue; } if(line) cb(line.split(','), ci); }
}
async function getText(u){ const r = await fetch(u, { headers:{'accept':'text/csv,*/*'} }); if(!r.ok) throw new Error(u+' HTTP '+r.status); return r.text(); }

// İETT GTFS uses ';' delimiters and quoted fields
function parseCSV(text){
  const rows=[]; let field='', row=[], inq=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(inq){ if(c==='"'){ if(text[i+1]==='"'){ field+='"'; i++; } else inq=false; } else field+=c; }
    else if(c==='"') inq=true;
    else if(c===';'){ row.push(field); field=''; }
    else if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=''; }
    else if(c!=='\r') field+=c;
  }
  if(field.length||row.length){ row.push(field); rows.push(row); }
  const header=rows.shift().map(h=>h.trim().replace(/^﻿/,''));
  const idx={}; header.forEach((h,i)=>idx[h]=i);
  return { idx, rows };
}
// İETT mangles coordinates with dots as separators ("410.191.700.005.564" = 41.0191700005564)
function coord(s){ s=(''+(s||'')).trim(); if(!s) return NaN;
  if((s.match(/\./g)||[]).length<=1) return parseFloat(s);
  const d=s.replace(/[^\d]/g,''); return parseFloat(d.slice(0,2)+'.'+d.slice(2)); }
const hhmmToMin = t => { const p=(t||'').split(':'); return p.length>=2 ? (+p[0])*60 + (+p[1]) : null; };
const minToHHMM = m => { if(m==null) return null; m=((m%1440)+1440)%1440; return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); };
function headway(mins){ if(mins.length<2) return null; const s=[...mins].sort((a,b)=>a-b); const d=[]; for(let i=1;i<s.length;i++){ const g=s[i]-s[i-1]; if(g>0&&g<=120) d.push(g); } if(!d.length) return null; d.sort((a,b)=>a-b); return d[Math.floor(d.length/2)]; }

(async () => {
  console.log('downloading GTFS…');
  const [routesT, tripsT, stopsT, calT] = await Promise.all([getText(URLS.routes), getText(URLS.trips), getText(URLS.stops), getText(URLS.calendar)]);

  // routes.csv is double-mojibaked (UTF-8 read as CP1252 then re-encoded); fix the Turkish letters in refs
  const MOJI={'Ã‡':'Ç','Ã–':'Ö','Ãœ':'Ü','Ä°':'İ','Åž':'Ş','ÅŸ':'ş','Äž':'Ğ','ÄŸ':'ğ','Ã§':'ç','Ã¶':'ö','Ã¼':'ü','Ä±':'ı','Å':'Ş','Ä':'İ'};
  // longest alternatives first; lone Å/Ä fall through to Ş/İ (CP1254 drops the trailing byte in refs)
  const demoji = s => (s||'').replace(/Åž|ÅŸ|Äž|ÄŸ|Ä°|Ã‡|Ã–|Ãœ|Ã§|Ã¶|Ã¼|Ä±|Å|Ä/g, m=>MOJI[m]);
  // routes: route_id -> short name (the bus ref, e.g. "500T", "46Ç")
  const R = parseCSV(routesT); const routeRef = new Map();
  for(const r of R.rows){ const id=r[R.idx.route_id]; const sn=demoji((r[R.idx.route_short_name]||'').trim()) || demoji((r[R.idx.route_long_name]||'').trim()); if(id) routeRef.set(id, sn); }

  // calendar: service_id -> day-type bucket (wd / sat / sun)
  const C = parseCSV(calT); const svcType = new Map();
  for(const r of C.rows){ const sid=r[C.idx.service_id]; const mon=+r[C.idx.monday], sat=+r[C.idx.saturday], sun=+r[C.idx.sunday];
    svcType.set(sid, mon? 'wd' : sat? 'sat' : sun? 'sun' : 'wd'); }

  // stops: stop_id -> {name,lat,lon}
  const S = parseCSV(stopsT); const stop = new Map();
  for(const r of S.rows){ const id=r[S.idx.stop_id]; if(!id) continue; stop.set(id, { name:(r[S.idx.stop_name]||'').trim(), lat:coord(r[S.idx.stop_lat]), lon:coord(r[S.idx.stop_lon]) }); }

  // trips: trip_id -> {ref, dir, svc, head}; also group trip ids by ref+dir
  const T = parseCSV(tripsT); const trip = new Map(); const byRefDir = new Map();
  for(const r of T.rows){ const tid=r[T.idx.trip_id]; if(!tid) continue;
    const ref=routeRef.get(r[T.idx.route_id]); if(!ref) continue;
    const dir=(r[T.idx.direction_id]||'0').trim()||'0';
    const svc=svcType.get(r[T.idx.service_id])||'wd';
    const head=(T.idx.trip_headsign!=null ? (r[T.idx.trip_headsign]||'') : '').trim();
    trip.set(tid, { ref, dir, svc, head });
    const key=ref+'|'+dir; let g=byRefDir.get(key); if(!g){ g=[]; byRefDir.set(key,g); } g.push(tid);
  }
  console.log('routes:', routeRef.size, ' trips:', trip.size, ' stops:', stop.size);

  // stop_times: download the FULL feed (zip → 150 MB, 6.1 M rows) and stream it twice.
  console.log('downloading stop_times.zip (22 MB) + extracting…');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gtfs-'));
  const zipPath = path.join(tmp, 'st.zip');
  fs.writeFileSync(zipPath, Buffer.from(await (await fetch(URLS.stop_times_zip)).arrayBuffer()));
  cp.execSync('unzip -o ' + JSON.stringify(zipPath) + ' -d ' + JSON.stringify(tmp), { stdio: 'ignore' });
  const stPath = path.join(tmp, fs.readdirSync(tmp).find(f => /stop_times\.txt$/i.test(f)));

  // pass 1: per trip → stop count + first departure (min sequence)
  console.log('stop_times pass 1…');
  const tAgg = new Map();   // tripId -> {n, firstSeq, dep}
  await eachRow(stPath, (f, ci) => { const tid=f[ci.trip_id]; if(!tid) return; const seq=+f[ci.stop_sequence];
    let a=tAgg.get(tid); if(!a){ a={ n:0, firstSeq:Infinity, dep:null }; tAgg.set(tid,a); }
    a.n++; if(seq<a.firstSeq){ a.firstSeq=seq; a.dep=hhmmToMin(f[ci.departure_time]); } });
  // representative trip per ref+dir = the one with the most stops (full route, not a short-turn)
  const repTrip = new Map();  // ref|dir -> tripId
  for(const [key, tids] of byRefDir){ let best=null, bn=-1; for(const tid of tids){ const a=tAgg.get(tid); if(a && a.n>bn){ bn=a.n; best=tid; } } if(best) repTrip.set(key, best); }
  const repSet = new Set(repTrip.values());

  // pass 2: ordered stops for representative trips only
  console.log('stop_times pass 2…');
  const repStops = new Map();  // tripId -> [{seq, stopId}]
  await eachRow(stPath, (f, ci) => { const tid=f[ci.trip_id]; if(!repSet.has(tid)) return;
    let arr=repStops.get(tid); if(!arr){ arr=[]; repStops.set(tid,arr); }
    arr.push({ seq:+f[ci.stop_sequence], stopId:f[ci.stop_id] }); });
  try { fs.rmSync(tmp, { recursive:true, force:true }); } catch(e){}

  // build bus-graph (both directions) + schedules
  const graph=[]; const sched={};
  for(const [key, tid] of repTrip){
    const [ref, dir] = key.split('|');
    const seq = repStops.get(tid); if(!seq || seq.length<2) continue;
    seq.sort((a,b)=>a.seq-b.seq);
    const stops=[]; for(const s of seq){ const st=stop.get(s.stopId); if(!st||!isFinite(st.lat)||!isFinite(st.lon)) continue;
      const last=stops[stops.length-1]; if(last && last[2]===st.name) continue;
      stops.push([ +st.lat.toFixed(5), +st.lon.toFixed(5), st.name ]); }
    if(stops.length<2) continue;
    const head = trip.get(tid).head || stops[stops.length-1][2];
    graph.push({ ref, dir:+dir, head, stops });

    // schedule: bucket this ref+dir's trip first-departures by day-type
    const buckets={ wd:[], sat:[], sun:[] };
    for(const t2 of byRefDir.get(key)){ const a=tAgg.get(t2), tr=trip.get(t2); if(!a||a.dep==null||!tr) continue; (buckets[tr.svc]||buckets.wd).push(a.dep); }
    const pack = arr => arr.length ? { first:minToHHMM(Math.min(...arr)), last:minToHHMM(Math.max(...arr)), hw:headway(arr), n:arr.length } : null;
    (sched[ref] = sched[ref] || []).push({ dir:+dir, head, wd:pack(buckets.wd), sat:pack(buckets.sat), sun:pack(buckets.sun) });
  }
  graph.sort((a,b)=>{ const na=parseInt(a.ref)||9999, nb=parseInt(b.ref)||9999; return na-nb || a.ref.localeCompare(b.ref,'tr') || a.dir-b.dir; });

  fs.writeFileSync(path.join(DIR,'bus-graph.json'), JSON.stringify(graph));
  fs.writeFileSync(path.join(DIR,'bus-schedules.json'), JSON.stringify(sched));
  const refs=new Set(graph.map(g=>g.ref)).size, bothDir=[...new Set(graph.map(g=>g.ref))].filter(rf=>graph.filter(g=>g.ref===rf).length>1).length;
  console.log('WROTE bus-graph.json ', (fs.statSync(path.join(DIR,'bus-graph.json')).size/1024).toFixed(0)+' KB', ' entries:', graph.length, ' refs:', refs, ' both-direction refs:', bothDir);
  console.log('WROTE bus-schedules.json', (fs.statSync(path.join(DIR,'bus-schedules.json')).size/1024).toFixed(0)+' KB', ' refs:', Object.keys(sched).length);
  const ex=graph.find(g=>g.ref==='500T')||graph[0];
  console.log('sample', ex.ref+'#'+ex.dir, '('+ex.stops.length+' stops) →', ex.head, '| sched', JSON.stringify((sched[ex.ref]||[])[0]));
})();
