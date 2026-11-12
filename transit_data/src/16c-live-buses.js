/* ===========================================================================
   LIVE BUSES (V4.5)
   Asked for as "make the live vehicle locations the actual thing". The carriages on the rail map are worked out from the timetable,
   and are called simulated everywhere they appear, because no operator publishes where its trains are. Buses are different in one
   city: İzmir's open-data service (openapi.izmir.bel.tr, CC BY 4.0, no key, readable from a browser) answers "where are the buses of
   line N now". So when a bus line is opened in İzmir, its real buses are drawn on it and refreshed every 20 seconds, for as long as
   the line is open, the page is on screen and there is a connection. Nothing is drawn that the service did not send.

   İstanbul (V4.5.1): İETT (api.ibb.gov.tr) has the same information, with a time on every position, but its server answers neither
   a web page (no CORS header) nor Cloudflare (it ignores requests from outside Türkiye). So İstanbul comes through the app's own
   relay (the `relay` folder): a Cloudflare Worker the page may ask, fed by a small script on a computer in Türkiye that asks İETT
   about the lines people have open. When that computer is off the relay says "no feed" and the app shows no buses and says why,
   rather than inventing them. The other cities publish nothing.

   The service has two habits that would put buses where they are not, and the rules below are for them:
     * a bus can be listed several times, at an old position and a new one, with no time on either. Which one is the bus? The one
       that moves: a position that was not in the last answer is where it is now. A bus listed once is drawn at once; a bus listed
       at several places is not drawn until one of them changes.
     * a parked bus looks the same as a record nobody is updating. A bus whose position has not changed for two minutes is drawn
       hollow and says so, instead of looking as live as the rest.
   ========================================================================== */
/* ==LIVEBUS-PURE-START== */
const LIVE_RELAY = 'https://turkmaps-relay.turkmaps-relay.workers.dev';
const LIVE_BUS_SOURCES = {
  izmir:    { kind:'izmir', base:'https://openapi.izmir.bel.tr/api/iztek/hatotobuskonumlari/', ref:/^\d{1,5}$/, credit:'İzmir Büyükşehir Belediyesi · CC BY 4.0', box:[37.5, 26.0, 39.6, 28.6] },
  istanbul: { kind:'relay', base:LIVE_RELAY + '/iett/buses?line=', ref:/^[-0-9A-ZÇĞİÖŞÜ]{1,8}$/, credit:'İETT · İBB Açık Veri · CC BY 4.0', box:[40.5, 27.8, 41.7, 30.1] },
};
const LIVE_BUS_EVERY = 20000;        // how often a line is asked about
const LIVE_BUS_SLOWEST = 120000;     // after refusals ("rate limit") the wait doubles, up to this
const LIVE_BUS_STILL = 120000;       // no change for this long: drawn as standing
const LIVE_BUS_WARM = 6000;          // the relay has just been asked for a line: its first answer is seconds away, so look again soon
const LIVE_BUS_WARM_MAX = 5;         // ... but not for ever
/* the address to ask for one line, or null where there is no live source (the line number is all that is sent) */
function liveBusURL(city, ref){
  const s = LIVE_BUS_SOURCES[city];
  return s && s.ref.test(String(ref)) ? s.base + encodeURIComponent(String(ref)) : null;
}
function liveBusNum(v){ const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : NaN; }
/* The answer as plain records. null when it is not an answer at all (an error, or "rate limit exceeded"); records that are not a
   position inside the city (the service sends 0,0 for a bus it has lost) are left out. KoorX is the latitude: the service's own
   document says so. */
function liveBusParse(json, box){
  if(!json || json.HataVarMi || !Array.isArray(json.HatOtobusKonumlari)) return null;
  const out = [];
  for(const r of json.HatOtobusKonumlari){
    if(!r || r.OtobusId == null) continue;
    const lat = liveBusNum(r.KoorX), lng = liveBusNum(r.KoorY);
    if(!(lat >= box[0] && lat <= box[2] && lng >= box[1] && lng <= box[3])) continue;
    out.push({ id:String(r.OtobusId), lat, lng });
  }
  return out;
}
/* One answer taken in. `state` is what the last answer left (a Map, bus → { keys, cur, first }); the result is the new state, the
   buses that can be drawn, and how many are listed but cannot be placed yet. Each drawn bus carries `moved`: when its position was
   last seen to change (null: not seen to change yet) and `first`: when it was first listed. */
function liveBusStep(state, recs, now){
  const byId = new Map();
  for(const r of recs){
    const k = r.lat + ',' + r.lng;
    if(!byId.has(r.id)) byId.set(r.id, new Map());
    byId.get(r.id).set(k, r);
  }
  const next = new Map(), buses = []; let unplaced = 0;
  byId.forEach((places, id) => {
    const prev = state.get(id) || null, keys = new Set(places.keys());
    let cur = null;
    if(places.size === 1){
      const k = keys.values().next().value, r = places.get(k);
      // listed at this place last time too: it has not moved (and if it was not the drawn place then, nothing is known of it yet)
      const moved = !prev ? null : !prev.keys.has(k) ? now : (prev.cur && prev.cur.k === k ? prev.cur.moved : null);
      cur = { k, lat:r.lat, lng:r.lng, moved };
    } else if(prev){
      const fresh = [...keys].filter(k => !prev.keys.has(k));
      if(fresh.length === 1){ const r = places.get(fresh[0]); cur = { k:fresh[0], lat:r.lat, lng:r.lng, moved:now }; }
      else if(!fresh.length && prev.cur && keys.has(prev.cur.k)) cur = prev.cur;       // nothing changed: it is where it was
    }
    const first = prev ? prev.first : now;
    next.set(id, { keys, cur, first });
    if(cur) buses.push({ id, lat:cur.lat, lng:cur.lng, moved:cur.moved, first });
    else unplaced++;
  });
  return { state:next, buses, unplaced };
}
/* The relay's answer for an İstanbul line. Every position carries the time İETT heard from the bus, so nothing has to be worked
   out from movement: a bus is drawn where it was last heard, and one not heard from for LIVE_BUS_STILL is drawn hollow. Ages are
   measured against the RELAY's clock (`now` in its answer), moved onto this device's clock, so a phone whose clock is wrong does
   not see every bus as stale. `warming`: the relay has only just been asked for this line and has no answer yet. */
function liveBusFromRelay(json, box, now){
  if(!json || !Array.isArray(json.buses)) return null;
  const lag = typeof json.now === 'number' ? now - json.now : 0;
  const buses = [];
  for(const b of json.buses){
    if(!b || b.id == null) continue;
    const lat = +b.lat, lng = +b.lng;
    if(!(lat >= box[0] && lat <= box[2] && lng >= box[1] && lng <= box[3])) continue;
    const heard = (typeof b.t === 'number' ? b.t : (typeof json.now === 'number' ? json.now : now - lag)) + lag;
    buses.push({ id:String(b.id), lat, lng, moved:heard, first:heard, to:b.to ? String(b.to) : '' });
  }
  return { state:new Map(), buses, unplaced:0, warming:!!json.warming };
}
/* one answer taken in, whichever kind of source it came from; null when it is not an answer */
function liveBusTake(src, state, json, now){
  if(src.kind === 'relay') return liveBusFromRelay(json, src.box, now);
  const recs = liveBusParse(json, src.box);
  return recs ? liveBusStep(state, recs, now) : null;
}
/* a bus that has not been seen to change place for LIVE_BUS_STILL: parked, or a record nobody is updating */
function liveBusStanding(b, now){ return now - (b.moved == null ? b.first : b.moved) >= LIVE_BUS_STILL; }
/* how long to wait before asking again: the usual gap, doubled for each refusal in a row */
function liveBusWait(fails){ return Math.min(LIVE_BUS_SLOWEST, LIVE_BUS_EVERY * Math.pow(2, Math.max(0, fails))); }
/* ==LIVEBUS-PURE-END== */

/* `var`: setTab() and selectBus() can ask for a stop before this file has been read (see the note in 16b-bus-routes.js) */
var liveBus = null;                    // { ref, url, src, state, buses, unplaced, fails, warm, last, status, timer, ctrl }
var liveBusGroup = null;

function liveBusHTML(ref){
  if(!liveBusURL(CITY_ID, ref)) return '';
  return '<div class="lb-strip" id="liveBusStrip" role="status" aria-live="polite"><span class="lb-dot" aria-hidden="true"></span><span class="lb-t">' + svgEsc(t('liveBusLoading')) + '</span>'
       + '<span class="lb-src">' + svgEsc(LIVE_BUS_SOURCES[CITY_ID].credit) + '</span></div>';
}
function liveBusStop(){
  if(!liveBus) return;
  clearTimeout(liveBus.timer);
  try{ if(liveBus.ctrl) liveBus.ctrl.abort(); }catch(e){}
  liveBus = null;
  if(liveBusGroup){ liveBusGroup.clearLayers(); map.removeLayer(liveBusGroup); }
}
function liveBusStart(ref){
  liveBusStop();
  const url = liveBusURL(CITY_ID, ref); if(!url) return;
  if(!liveBusGroup){
    // their own pane, above the route and its stops: those are redrawn on every pan and would otherwise end up over the buses
    if(!map.getPane('liveBusPane')) map.createPane('liveBusPane').style.zIndex = 455;
    liveBusGroup = L.layerGroup();
  }
  liveBusGroup.addTo(map);
  liveBus = { ref, url, src:LIVE_BUS_SOURCES[CITY_ID], state:new Map(), buses:[], unplaced:0, fails:0, warm:0, last:0, status:'loading', timer:0, ctrl:null };
  liveBusPoll();
}
function liveBusAgain(ms){ if(liveBus){ clearTimeout(liveBus.timer); liveBus.timer = setTimeout(liveBusPoll, ms); } }
async function liveBusPoll(){
  const me = liveBus; if(!me) return;
  if(currentTab !== 'bus'){ liveBusStop(); return; }
  if(document.hidden){ liveBusAgain(LIVE_BUS_EVERY); return; }               // nobody is looking: ask nothing
  if(navigator.onLine === false){ me.status = 'offline'; liveBusShow(); liveBusAgain(LIVE_BUS_EVERY); return; }
  let got = null, limited = false, off = false;
  try{
    me.ctrl = new AbortController();
    const stop = setTimeout(() => { try{ me.ctrl.abort(); }catch(e){} }, 12000);
    const resp = await fetch(me.url, { cache:'no-store', signal:me.ctrl.signal });
    const json = await resp.json().catch(() => null);
    clearTimeout(stop);
    limited = resp.status === 429 || !!(json && json.message && /limit/i.test(json.message));
    off = resp.status === 503 && !!json && json.error === 'no-feed';          // the relay has nobody feeding it: say so, do not guess
    got = resp.ok ? liveBusTake(me.src, me.state, json, Date.now()) : null;
  }catch(e){ got = null; }
  if(liveBus !== me) return;                                                 // another line was opened, or the view was left, meanwhile
  let wait;
  if(got && got.warming && me.warm < LIVE_BUS_WARM_MAX){ me.warm++; me.fails = 0; me.status = 'loading'; wait = LIVE_BUS_WARM; }
  else if(got && !got.warming){
    me.state = got.state; me.buses = got.buses; me.unplaced = got.unplaced; me.fails = 0; me.warm = 0; me.last = Date.now();
    me.status = got.buses.length || got.unplaced ? 'ok' : 'empty';
    wait = liveBusWait(0);
  } else {
    me.fails++;
    me.status = off ? 'off' : limited ? 'busy' : 'error';
    if(off || me.fails >= 3){ me.buses = []; me.unplaced = 0; me.state = new Map(); }  // no feed, or a minute without an answer: what is drawn is no longer "now"
    wait = liveBusWait(me.fails);
  }
  liveBusShow();
  liveBusAgain(wait);
}
function liveBusShow(){
  const me = liveBus; if(!me || !liveBusGroup) return;
  const now = Date.now(), tone = MAP_T();
  liveBusGroup.clearLayers();
  let standing = 0;
  me.buses.forEach(b => {
    const still = liveBusStanding(b, now); if(still) standing++;
    L.circleMarker([b.lat, b.lng], { pane:'liveBusPane', radius:11, stroke:false, fillColor:'#12B886', fillOpacity:still ? 0 : 0.22, interactive:false }).addTo(liveBusGroup);
    L.circleMarker([b.lat, b.lng], { pane:'liveBusPane', radius:6.2, color:still ? '#12B886' : '#FFFFFF', weight:2.2, fillColor:still ? tone.hole : '#12B886', fillOpacity:1, bubblingMouseEvents:false })
      .bindTooltip(svgEsc(t('liveBusTip').replace('{id}', b.id) + (b.to ? ' → ' + b.to : '') + (still ? ' · ' + t(me.src.kind === 'relay' ? 'liveBusQuiet' : 'liveBusStill') : '')), { className:'lt', direction:'top' }).addTo(liveBusGroup);
  });
  const strip = document.getElementById('liveBusStrip'); if(!strip) return;
  const n = me.buses.length;
  let text;
  if(me.status === 'loading') text = t('liveBusLoading');
  else if(me.status === 'offline') text = t('liveBusOffline');
  else if(me.status === 'off') text = t('liveBusOff');
  else if(me.status === 'busy' || me.status === 'error') text = t(me.status === 'busy' ? 'liveBusBusy' : 'liveBusError') + (n ? ' · ' + t('liveBusKept').replace('{n}', n) : '');
  else if(me.status === 'empty') text = t('liveBusNone');
  else text = (n === 1 ? t('liveBusOne') : t('liveBusMany').replace('{n}', n))
            + (standing ? ' · ' + t(me.src.kind === 'relay' ? 'liveBusQuietN' : 'liveBusStanding').replace('{n}', standing) : '')
            + (me.unplaced ? ' · ' + t('liveBusUnplaced').replace('{n}', me.unplaced) : '');
  strip.className = 'lb-strip ' + (me.status === 'ok' ? 'on' : me.status === 'loading' ? '' : 'off');
  strip.querySelector('.lb-t').textContent = text;
  if(me.last) strip.title = t('liveBusAt').replace('{t}', new Date(me.last).toLocaleTimeString(lang, { hour:'2-digit', minute:'2-digit', second:'2-digit' }));
}
/* back on screen, or back on line: ask at once instead of waiting out the gap */
document.addEventListener('visibilitychange', () => { if(!document.hidden && liveBus) liveBusAgain(300); });
window.addEventListener('online', () => { if(liveBus) liveBusAgain(300); });
