/* ===========================================================================
   ISTANBUL RAY-NET  ·  Leaflet edition
   Real OSM-derived geometry for the entire metropolitan rail network plus the
   Metrobüs BRT, rendered on real map tiles, with live carriage simulation,
   predictive arrivals, and Dijkstra trip planning.
   =========================================================================== */

/* --- Network dataset (injected from OpenStreetMap-derived build) --- */
const NETWORK = CITY.lines.concat(INTERCITY_LINES_JSON);
/* --- Bus directory: every İETT line {ref,from,to,id,op} (geometry fetched on demand) --- */
const BUS_ALL = __BUS_JSON__;                     // { city: [routes] }
const BUS_OPERATOR = CITY.busOperator || '';      // İETT, UlaşımPark, …
const BUS_DIR = HAS.bus ? (BUS_ALL[CITY_ID] || []) : [];
/* --- Live disruptions: faults / closures / suspensions (editable transit_data/disruptions.json) --- */
let DISRUPTIONS = HAS.disruptions ? __DISRUPTIONS_JSON__ : [];   // baked-in fallback; overridden by the live fetch below
/* --- Upcoming line openings: curated İBB projected launch dates (subject to change). Shown as
       "coming soon" cards in the announcements panel; auto-hide once the projected date passes. --- */
const OPENINGS = HAS.openings ? __OPENINGS_JSON__ : [];
/* --- Bus routing graph: per İETT line ordered stops [[lat,lng,name],...] for the trip planner --- */
/* İETT GTFS bus graph + schedules are ~3.1 MB — 85% of the whole app — so they are NOT baked
   in. They are fetched from transit_data/bus-data-<city>.json right after first paint (see
   loadBusData in the boot section): the map is interactive in a fraction of the time, and
   bus routing/schedules light up seconds later. Until then both stay empty and every
   consumer (busDirs, siblingBuses, busScheduleHTML, planner) degrades gracefully. */
let BUS_GRAPH = [];   // İETT GTFS: per line per direction {ref,dir,head,stops}
let BUS_SCHED = {};   // İETT GTFS departure schedules {ref:[{dir,head,wd,sat,sun}]}
let BUS_GEOM  = {};   // real road shape per bus ref: [[ [lat,lng]… ], …] (baked, no live fetch)
/* Road geometry is the larger half of the bus payload (0.66 MB gzipped for İstanbul against
   0.48 MB for graph+schedules) and is only read when a specific route is drawn, which most
   visitors never do. It is therefore fetched on first use rather than with the rest. Cities
   with no baked geometry never request it, and a failure is remembered so a route draw does
   not retry on every click — the stop-polyline fallback already covers that case. */
let busGeomPromise = null;
function ensureBusGeom(){
  if (busGeomPromise) return busGeomPromise;
  busGeomPromise = fetch('transit_data/bus-geom-' + CITY_ID + '.json')
    .then(r => r.ok ? r.json() : null)
    .then(g => { if (g) BUS_GEOM = g; return BUS_GEOM; })
    .catch(() => BUS_GEOM);           // offline, or a city that ships none
  return busGeomPromise;
}
let busReady = false;
let busReadyResolve;
const busDataPromise = new Promise(res => { busReadyResolve = res; });
const BUS_COLOR = '#E8A33D';
// bus directions available for a line ref (0/1 = the two directions, from the GTFS graph)
function busDirs(ref){ return BUS_GRAPH.filter(l=>l.ref===ref); }
// typical headway (min) for a ref across directions/day-types — for a compact "every ~N min" label
function busHeadway(ref){ const s=BUS_SCHED[ref]; if(!s) return null;
  const hs=[]; for(const d of s) for(const k of ['wd','sat','sun']) if(d[k]&&d[k].hw) hs.push(d[k].hw);
  if(!hs.length) return null; hs.sort((a,b)=>a-b); return hs[Math.floor(hs.length/2)]; }
/* --- Official Metro İstanbul station registry [[Id,LineName,lat,lng,Name],...] — resolves a
       clicked station to its official ID for EXACT scheduled departures (api.ibb.gov.tr, CORS-open) --- */
const MI_STATIONS = HAS.miStations ? __MISTATIONS_JSON__ : [];
/* --- Step-free / accessibility per station: İBB open data (elevator + escalator counts)
       merged with OpenStreetMap wheelchair tags. {name,elevators,escalators,size,district,wheelchair,stepFree}. --- */
const ACCESS_RAW = HAS.access ? __ACCESS_JSON__ : [];
/* Where every shipped dataset came from and when, measured at build time. The app uses this
   to say what it knows and how well it knows it, rather than presenting a community-mapped
   route and an operator timetable with the same confidence. */
const PROVENANCE = __PROVENANCE_JSON__;
/* --- curated İstanbul landmarks for the "Explore" layer (real places; the app computes the
       nearest station + walk). {name,cat,lat,lng} --- */
const ATTRACTIONS = CITY.attractions || __ATTRACTIONS_JSON__;
const ATTR_CAT = { historic:'🏛️', mosque:'🕌', palace:'👑', museum:'🖼️', market:'🛍️', viewpoint:'🌆', park:'🌳', waterfront:'🌊', landmark:'📍', tower:'🗼' };

/* --- line kind metadata: travel speed (km/h) + render style --- */
const KIND = {
  subway:   { speed:70, weight:4.5, dash:null,    label:"Metro" },
  marmaray: { speed:95, weight:5,   dash:null,    label:"Marmaray" },
  suburban: { speed:80, weight:4,   dash:null,    label:"Banliyö (Suburban)" },
  tram:     { speed:32, weight:3.5, dash:null,    label:"Tram" },
  funicular:{ speed:28, weight:3.5, dash:null,    label:"Funicular" },
  cable:    { speed:14, weight:3.5, dash:null,    label:"Cable Car" },
  metrobus: { speed:42, weight:3.5, dash:"7,6",   label:"Metrobüs (BRT)" },
  ferry:    { speed:26, weight:1.5, dash:"1,7",   label:"Ferry (Vapur)" },
  intercity:{ speed:200,weight:3,   dash:null,    label:"Intercity (TCDD)" }
};
const GROUP_ORDER = ["subway","marmaray","suburban","tram","funicular","cable","metrobus","ferry","intercity"];
const DWELL = 4;             // seconds dwell at each station (sim time)
const TRANSFER_MIN = 4;      // walking-transfer penalty (minutes)
// typical Metro İstanbul service hours / headways (per mode)
const SCHEDULE = {
  subway:   { hours:'06:00 – 00:00', freq:'every 4–10 min' },
  marmaray: { hours:'06:00 – 00:00', freq:'every 5–15 min' },
  suburban: { hours:'06:00 – 00:00', freq:'every 15–30 min' },
  tram:     { hours:'06:00 – 00:00', freq:'every 5–10 min' },
  funicular:{ hours:'07:00 – 00:00', freq:'every 3–5 min' },
  cable:    { hours:'08:00 – 22:00', freq:'every 5–10 min' },
  metrobus: { hours:'24 hours',      freq:'every 1–4 min' },
  ferry:    { hours:'06:30 – 21:00', freq:'every 15–40 min' }
};
// Per-line accurate timings: commercial speed (km/h) drives realistic live ETAs;
// peak–offpeak headway (min) drives how often trains arrive + the panel frequency.
const LINE_TIMING_IST = {
  'M1A':{spd:34,peak:5,off:10}, 'M1B':{spd:34,peak:6,off:10},
  'M2':{spd:38,peak:4,off:9},  'M2S':{spd:30,peak:6,off:12},
  'M3':{spd:35,peak:5,off:10}, 'M4':{spd:38,peak:4,off:8}, 'M5':{spd:38,peak:4,off:8},
  'M6':{spd:30,peak:6,off:10}, 'M7':{spd:36,peak:5,off:9}, 'M8':{spd:38,peak:5,off:9},
  'M9':{spd:36,peak:6,off:10}, 'M11':{spd:50,peak:8,off:12},
  'Marmaray':{spd:50,peak:5,off:12},
  'B2':{spd:45,peak:15,off:30,hours:'06:00 – 23:00'},
  'T1':{spd:18,peak:5,off:10}, 'T2':{spd:10,peak:15,off:20,hours:'07:00 – 21:00'},
  'T3':{spd:12,peak:12,off:20,hours:'07:00 – 21:00'}, 'T4':{spd:20,peak:7,off:12},
  'T5':{spd:22,peak:6,off:10}, 'T6':{spd:22,peak:8,off:15},
  'F1':{spd:25,peak:4,off:5},  'F2':{spd:18,peak:5,off:7}, 'F3':{spd:25,peak:5,off:8}, 'F4':{spd:25,peak:5,off:8},
  'TF1':{spd:12,peak:8,off:10,hours:'08:00 – 20:00'}, 'TF2':{spd:12,peak:8,off:10,hours:'08:00 – 23:00'},
  'Metrobüs':{spd:40,peak:1,off:4,hours:'24 hours'}
};
const LINE_TIMING = CITY.timing || LINE_TIMING_IST;   // each city ships its own published timings
const HW_FALLBACK = { subway:8, marmaray:10, suburban:20, tram:10, funicular:6, cable:8, metrobus:3, ferry:25 };
/* Memoised. These are static per line, and the time-dependent router asks for them inside a
   loop that relaxes hundreds of thousands of edges — rebuilding an object and re-formatting a
   frequency string each time cost more than the search itself. */
let _lineTimingMemo = Object.create(null);
function lineTiming(ref){
  const hit = _lineTimingMemo[ref];
  if(hit) return hit;
  const t = HAS.lineTiming ? LINE_TIMING[ref] : null, kind = lineByRef[ref] && lineByRef[ref].kind;
  // a line with one published gap (Kocaeli's ferries) reads "every 81 min", not "every 81–81 min"
  if(t) return _lineTimingMemo[ref] = { spd:t.spd, hwMin:(t.peak+t.off)/2, hours:t.hours||'06:00 – 00:00',
                 freq:`every ${t.peak===t.off ? t.peak : t.peak+'–'+t.off} min` };
  const s = SCHEDULE[kind] || SCHEDULE.subway;
  return _lineTimingMemo[ref] = { spd:(KIND[kind]&&KIND[kind].speed)||40, hwMin:HW_FALLBACK[kind]||10, hours:s.hours, freq:s.freq };
}
/* The parsed form of a line's operating hours, and whether a disruption has suspended it.
   Parsing "06:00 – 00:00" with a regex and re-running Date.parse over the disruption list on
   every call made lineClosedAt the single most expensive function in the router. Invalidated
   by clearTimingMemo() when the disruption feed refreshes. */
let _lineHoursMemo = Object.create(null);
function clearTimingMemo(){ _lineTimingMemo = Object.create(null); _lineHoursMemo = Object.create(null); }
/* ---- ONE disruption clock. ----------------------------------------------------------------
   `until` is an end-of-day date: the fault is over once that day is out, and the line is back
   in normal service. The router and the operating-hours check each carried their own copy of
   this arithmetic; the map overlay, the announcements list, the follow-alerts and the assistant
   carried none, so B2's engineering works kept a caution band painted over the line — and kept
   the line's own colour hidden underneath it — for as long as the entry sat in the feed. The
   date is the operator's; expiry is not a judgement call, so it belongs in one place. */
function disruptionActive(d){
  if(!d) return false;
  if(!d.until) return true;                                  // open-ended: active until withdrawn
  const end = Date.parse(d.until + 'T23:59:59');
  if(Number.isNaN(end)) return true;                         // unparseable date → never silently drop a fault
  return end >= Date.now();
}
function activeDisruptions(){ return (DISRUPTIONS||[]).filter(disruptionActive); }
function lineHours(ref){
  const hit = _lineHoursMemo[ref];
  if(hit) return hit;
  const d=(DISRUPTIONS||[]).find(x=> x.ref===ref && x.scope==='line' && x.severity==='major'
        && disruptionActive(x));
  const h=(lineTiming(ref).hours)||'';
  const f = { susp:d||null, hours:h, always:/24/.test(h), start:null, end:null, opens:null };
  if(!f.always){
    const m=h.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
    if(m){ f.start=+m[1]*60+ +m[2]; f.end=+m[3]*60+ +m[4]; f.opens=m[1]+':'+m[2]; }
  }
  return _lineHoursMemo[ref] = f;
}
/* ---- is this line actually running right now? Two reasons it may not be:
   (a) suspended by an active line-scope MAJOR disruption (e.g. B2 engineering works);
   (b) outside its operating hours (İstanbul time; ranges may span midnight).
   Simulated carriages + the predictive-arrivals board both respect this. ---- */
// Same check at an ARBITRARY minute-of-day, so the planner can ask "will this line be
// running when I actually board it?" rather than only "is it running right now?".
function lineClosedAt(ref, atMin){
  const f = lineHours(ref);
  if(f.susp) return { why:'susp', d:f.susp };
  if(f.always || f.start==null) return null;          // 24-hour service, or unparseable → open
  const now=((Math.round(atMin)%1440)+1440)%1440;     // planner times can run past midnight
  const open = f.start<=f.end ? (now>=f.start && now<f.end) : (now>=f.start || now<f.end);   // spans midnight
  return open ? null : { why:'hours', hours:f.hours, opens:f.opens };
}
function lineClosedNow(ref){ return lineClosedAt(ref, nowIstanbulMin()); }
let closedCache={};                                    // ref -> closure info (checked per frame → cached)
function refreshClosed(){
  const c={};
  (typeof liveLines!=='undefined'?liveLines:[]).forEach(l=>{ const x=lineClosedNow(l.ref); if(x) c[l.ref]=x; });
  closedCache=c;
}
setInterval(refreshClosed, 30000);

/* --- geo helpers --- */
const R = 6371000;
const toRad = d => d*Math.PI/180;
function metersBetween(a, b){
  const dLat = toRad(b[0]-a[0]), dLng = toRad(b[1]-a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

