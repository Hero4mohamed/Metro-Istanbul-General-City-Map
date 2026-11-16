/* ===========================================================================
   FAVOURITE PLACES (V4.7) — saved on THIS DEVICE ONLY.
   Asked for as: "A place I save, tap it to see it and add the choice to go to it, but the main objective is to save it for later".
   Design: docs/superpowers/specs/2026-11-16-profile-corner-favourites-design.md.
     * Stored in localStorage 'irn_favplaces' (NOT 'irn_favourites', which holds the planner's starred journeys).
     * Nothing here touches the network: saving, listing, opening, renaming and removing are all local.
   ========================================================================== */
/* ==FAV-PURE-START== */
const FAV_KEY = 'irn_favplaces', FAV_MAX = 200, FAV_SAME_M = 30, FAV_NAME_MAX = 60;
function favMeters(a, b){
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function favValid(f){
  return !!f && typeof f === 'object' && typeof f.name === 'string' && f.name.trim() !== ''
    && typeof f.lat === 'number' && isFinite(f.lat) && typeof f.lng === 'number' && isFinite(f.lng);
}
/* a broken, hand-edited or foreign value never throws: it reads as the valid entries it holds, or none */
function favLoad(){
  let v = null;
  try{ v = JSON.parse(localStorage.getItem(FAV_KEY)); }catch(e){ v = null; }
  return Array.isArray(v) ? v.filter(favValid) : [];
}
function favSave(list){ try{ localStorage.setItem(FAV_KEY, JSON.stringify(list)); }catch(e){} }
const favKeyName = s => ('' + (s || '')).trim().toLowerCase();
function favFind(list, p){
  const n = favKeyName(p.name);
  return list.find(f => favKeyName(f.name) === n && favMeters(f, p) <= FAV_SAME_M) || null;
}
function favNewId(now){
  let s = '';
  for(let i = 0; i < 4; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
  return 'f' + now.toString(36) + s;
}
function favAdd(list, p, now){
  const have = favFind(list, p);
  if(have) return { list, fav: have, dropped: false };
  const fav = { id: favNewId(now), name: ('' + p.name).trim().slice(0, FAV_NAME_MAX), lat: +p.lat, lng: +p.lng,
    kind: p.kind || 'place', ic: p.ic || '', ctx: p.ctx || '', city: p.city || '', saved: now };
  let out = [fav].concat(list), dropped = false;
  if(out.length > FAV_MAX){ out = out.slice(0, FAV_MAX); dropped = true; }
  return { list: out, fav, dropped };
}
function favRemove(list, id){ return list.filter(f => f.id !== id); }
function favRename(list, id, name){
  const n = ('' + (name || '')).trim().slice(0, FAV_NAME_MAX);
  if(!n) return list;
  return list.map(f => f.id === id ? Object.assign({}, f, { name: n }) : f);
}
/* ==FAV-PURE-END== */
