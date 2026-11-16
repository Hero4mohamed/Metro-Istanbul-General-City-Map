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

/* ==FAV-CORE-START== */
function favIsSaved(p){ return !!(p && isFinite(p.lat) && isFinite(p.lng) && favFind(favLoad(), p)); }
/* ☆ Save / ★ Saved: returns whether the place is saved afterwards. A dropped pin is named first (prefilled "Dropped pin");
   cancelling the name saves nothing. */
function favToggle(p){
  if(!p || !isFinite(p.lat) || !isFinite(p.lng)) return false;
  const have = favFind(favLoad(), p);
  if(have){
    favSave(favRemove(favLoad(), have.id)); showToast(t('favRemoved')); favChanged();
    return false;
  }
  const add = name => {
    const r = favAdd(favLoad(), { name, lat: p.lat, lng: p.lng, kind: p.kind || 'place', ic: p.ic || '', ctx: p.ctx || '',
      city: p.city || CITY_ID }, Date.now());
    favSave(r.list);
    if(p.kind === 'pin') p.name = r.fav.name;         // the pin on the map now carries its new name, so it shows ★ Saved
    showToast(t(r.dropped ? 'favDropped' : 'favAdded')); favChanged();
  };
  if(p.kind === 'pin'){
    favAskName(p.name, name => { if(name && ('' + name).trim()) add(('' + name).trim()); });
    return true;
  }
  add(p.name);
  return true;
}
/* a long press (phone) or a STILL right-click (computer) on the map drops a pin there, which can then be saved */
function dropPinAt(ll){
  dropPin({ name: t('favPinName'), lat: ll.lat, lng: ll.lng, kind: 'pin', ic: '📍',
    ctx: ll.lat.toFixed(3) + ', ' + ll.lng.toFixed(3), city: CITY_ID }, Math.max(map.getZoom(), 15));
}
function favMapMenu(e){
  if(turnMoved || !e || !e.latlng) return;            // the right button turned the map: that was not a click
  dropPinAt(e.latlng);
}
map.on('contextmenu', favMapMenu);
/* ==FAV-CORE-END== */

/* ---- the page: buttons that show ☆ / ★, and the name dialog ---- */
function favStationPlace(){
  if(!selected) return null;
  return { name: selected.name, lat: selected.lat, lng: selected.lng, kind: 'station', ic: '🚉',
    ctx: [...(selected.lines || [])].slice(0, 4).join(', '), city: CITY_ID };
}
function favRefreshButtons(){
  const b = document.getElementById('stnFav'), sp = favStationPlace();
  if(b && sp){
    const on = favIsSaved(sp);
    b.classList.toggle('fav-on', on);
    b.setAttribute('data-i18n', on ? 'favSaved' : 'favSave');   // a language switch keeps the right word
    b.textContent = t(on ? 'favSaved' : 'favSave');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  document.querySelectorAll('[data-pin="S"]').forEach(x => {
    const on = favIsSaved(pinPlace);
    x.classList.toggle('fav-on', on);
    x.textContent = (on ? '★ ' : '☆ ') + t(on ? 'favSaved' : 'favSave');
  });
}
/* every list and button that shows favourites is told here */
function favChanged(){
  favRefreshButtons();
}
document.getElementById('stnFav').addEventListener('click', () => { const sp = favStationPlace(); if(sp) favToggle(sp); });

/* the name of a dropped pin: a small dialog, Enter saves, Escape cancels; `cb(null)` on cancel */
function favAskName(def, cb){
  const old = document.getElementById('favNameDlg'); if(old) old.remove();
  const d = document.createElement('div');
  d.id = 'favNameDlg'; d.className = 'fav-dlg glass'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  d.setAttribute('aria-labelledby', 'favNameT');
  d.innerHTML = '<div id="favNameT" class="fav-dlg-t">' + svgEsc(t('favNameTitle')) + '</div>' +
    '<input id="favNameIn" type="text" maxlength="' + FAV_NAME_MAX + '" autocomplete="off">' +
    '<div class="fav-dlg-b"><button type="button" data-fav-dlg="cancel">' + svgEsc(t('accCancel')) + '</button>' +
    '<button type="button" class="primary" data-fav-dlg="ok">' + svgEsc(t('favSave')) + '</button></div>';
  document.body.appendChild(d);
  const inp = d.querySelector('input'), back = document.activeElement;
  inp.value = def || '';
  let done = false;
  const finish = v => {
    if(done) return; done = true; d.remove();
    if(back && back.focus && document.contains(back)) try{ back.focus(); }catch(e){}
    cb(v);
  };
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-fav-dlg]'); if(!b) return;
    finish(b.getAttribute('data-fav-dlg') === 'ok' ? inp.value : null);
  });
  d.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); finish(inp.value); }
    else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); finish(null); }
  });
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
