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
  return !!f && typeof f === 'object' && typeof f.id === 'string' && f.id !== ''
    && typeof f.name === 'string' && f.name.trim() !== ''
    && typeof f.lat === 'number' && isFinite(f.lat) && typeof f.lng === 'number' && isFinite(f.lng);
}
const favStr = v => (typeof v === 'string' ? v : '');
/* a broken, hand-edited or foreign value never throws: it reads as the valid entries it holds, or none, and every text field is
   text (an entry with no usable id could be neither opened nor removed, so it is skipped) */
function favLoad(){
  let v = null;
  try{ v = JSON.parse(localStorage.getItem(FAV_KEY)); }catch(e){ v = null; }
  if(!Array.isArray(v)) return [];
  return v.filter(favValid).map(f => Object.assign({}, f, { ic: favStr(f.ic), ctx: favStr(f.ctx), city: favStr(f.city),
    kind: favStr(f.kind) || 'place' }));
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
/* The list in the Friends tab: Home and Work first (when set), then favourites newest first. Every piece of text is escaped:
   names are typed by the person, and the store can be hand-edited. `cityLabel(id)` gives a city's name. */
function favListHTML(list, home, work, cityId, cityLabel){
  const row = (id, ic, name, sub, other, menu) =>
    '<div class="fav-row' + (other ? ' fav-other' : '') + '" data-fav-id="' + attrEsc(id) + '">' +
      '<button type="button" class="fav-main" data-fav-open="' + attrEsc(id) + '"><span class="fav-ic" aria-hidden="true">' + svgEsc(ic) + '</span>' +
        '<span class="fav-tx"><b>' + svgEsc(name) + '</b>' + (sub ? '<small>' + svgEsc(sub) + '</small>' : '') + '</span></button>' +
      '<button type="button" class="fav-go" data-fav-act="go" data-fav-id="' + attrEsc(id) + '">' + svgEsc(t('favGo')) + '</button>' +
      (menu ? '<button type="button" class="fav-more" data-fav-act="menu" data-fav-id="' + attrEsc(id) + '" aria-expanded="false" aria-label="' + attrEsc(t('favMore')) + '">⋯</button>' +
        '<div class="fav-menu" hidden>' +
          ['rename:favRename', 'home:favMakeHome', 'work:favMakeWork', 'remove:favRemove'].map(s => {
            const [act, key] = s.split(':');
            return '<button type="button" data-fav-act="' + act + '" data-fav-id="' + attrEsc(id) + '">' + svgEsc(t(key)) + '</button>';
          }).join('') +
        '</div>' : '') +
    '</div><!--row-->';
  let h = '<div class="fav-h"><span aria-hidden="true">★</span> ' + svgEsc(t('favTitle')) + '</div>';
  if(home) h += row('home', '🏠', t('homeP'), home.name, false, false);
  if(work) h += row('work', '💼', t('workP'), work.name, false, false);
  list.forEach(f => {
    const other = !!f.city && f.city !== cityId;
    const sub = [f.ctx, other ? cityLabel(f.city) : ''].filter(Boolean).join(' · ');
    h += row(f.id, f.ic || '📍', f.name, sub, other, true);
  });
  if(!list.length) h += '<div class="fav-empty">' + svgEsc(t('favEmpty')) + '</div>';
  return h;
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
/* the menu event: a finger's long press drops a pin. From a mouse it is ignored (macOS and Linux send it when the button goes DOWN,
   before the drag that turns the map); the mouse's still click comes as "irnstillclick" when its button comes up (07z) */
function favMapMenu(e){
  if(!e || !e.latlng) return;
  if(Date.now() - turnMouseAt < 1500) return;
  dropPinAt(e.latlng);
}
function favStillClick(e){ if(e && e.latlng) dropPinAt(e.latlng); }
map.on('contextmenu', favMapMenu);
map.on('irnstillclick', favStillClick);
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
  const title = document.querySelector('.pin-pop > b');                // a dropped pin just named: its pop-up shows the new name
  if(title && pinPlace && title.textContent !== pinPlace.name) title.textContent = pinPlace.name;
  document.querySelectorAll('[data-pin="S"]').forEach(x => {
    const on = favIsSaved(pinPlace);
    x.classList.toggle('fav-on', on);
    x.textContent = (on ? '★ ' : '☆ ') + t(on ? 'favSaved' : 'favSave');
  });
}
/* every list and button that shows favourites is told here */
function favChanged(){
  favRefreshButtons();
  renderFavs();
}

/* ---- the list (Friends tab) ---- */
function renderFavs(){
  const html = favListHTML(favLoad(), homePlace, workPlace, CITY_ID, id => (cityKnown(id) && CITIES[id].label) || id);
  document.querySelectorAll('.fav-box').forEach(b => { b.innerHTML = html; });
}
function favPlaceById(id){
  if(id === 'home') return homePlace ? Object.assign({ kind: 'place', ic: '🏠', city: CITY_ID }, homePlace) : null;
  if(id === 'work') return workPlace ? Object.assign({ kind: 'place', ic: '💼', city: CITY_ID }, workPlace) : null;
  return favLoad().find(f => f.id === id) || null;
}
/* see it: the map flies there and the pin opens. A favourite of another city switches city first (the page reloads and
   opens it once, see the end of this file). */
function favOpen(f){
  if(!f) return;
  if(f.city && f.city !== CITY_ID && cityKnown(f.city) && f.id){ switchCity(f.city, { fav: f.id }); return; }
  if(IS_MOBILE && mSheets.friends && mSheets.friends.classList.contains('open')) setDragDetent(mSheets.friends, 'low');
  dropPin({ name: f.name, lat: f.lat, lng: f.lng, kind: f.kind, ic: f.ic, ctx: f.ctx, city: f.city }, 16);
}
function favMakeHomeWork(which, id){
  const f = favPlaceById(id); if(!f) return;
  const rec = { name: f.name, lat: f.lat, lng: f.lng };
  if(which === 'home'){ homePlace = rec; try{ localStorage.setItem('irn_home', JSON.stringify(rec)); }catch(e){} showToast(t('homeSaved')); }
  else { workPlace = rec; try{ localStorage.setItem('irn_work', JSON.stringify(rec)); }catch(e){} showToast(t('workSaved')); }
  renderPlaces(); renderFavs();
}
const favMakeHome = id => favMakeHomeWork('home', id);
const favMakeWork = id => favMakeHomeWork('work', id);
function favCloseMenus(except){
  document.querySelectorAll('.fav-box .fav-menu').forEach(m => {
    if(m === except) return;
    m.hidden = true;
    const b = m.parentNode.querySelector('[data-fav-act="menu"]'); if(b) b.setAttribute('aria-expanded', 'false');
  });
}
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('.fav-box [data-fav-open], .fav-box [data-fav-act]');
  if(!el){ if(!(e.target.closest && e.target.closest('.fav-menu'))) favCloseMenus(); return; }
  const open = el.getAttribute('data-fav-open');
  if(open){ favCloseMenus(); favOpen(favPlaceById(open)); return; }
  const act = el.getAttribute('data-fav-act'), id = el.getAttribute('data-fav-id'), f = favPlaceById(id);
  if(act === 'menu'){
    const m = el.parentNode.querySelector('.fav-menu'); if(!m) return;
    const show = m.hidden; favCloseMenus(m); m.hidden = !show; el.setAttribute('aria-expanded', show ? 'true' : 'false');
    if(show){ const first = m.querySelector('button'); if(first) first.focus(); }
    return;
  }
  favCloseMenus();
  if(!f) return;
  if(act === 'go'){
    if(f.city && f.city !== CITY_ID && cityKnown(f.city)) favOpen(f);     // another city: go there first, then plan from the pin
    else goToPlace(f);
  }
  else if(act === 'rename') favAskName(f.name, name => { if(name && ('' + name).trim()){ favSave(favRename(favLoad(), id, name)); favChanged(); } });
  else if(act === 'home') favMakeHome(id);
  else if(act === 'work') favMakeWork(id);
  else if(act === 'remove'){
    // asked once, in the row itself
    const m = el.parentNode;
    m.innerHTML = '<span class="fav-ask">' + svgEsc(t('favRemoveAsk').replace('{name}', f.name)) + '</span>' +
      '<button type="button" class="fav-yes" data-fav-act="remove-yes" data-fav-id="' + attrEsc(id) + '">' + svgEsc(t('favRemove')) + '</button>' +
      '<button type="button" data-fav-act="remove-no" data-fav-id="' + attrEsc(id) + '">' + svgEsc(t('accCancel')) + '</button>';
    m.hidden = false;
    m.querySelector('.fav-yes').focus();
  }
  else if(act === 'remove-yes'){ favSave(favRemove(favLoad(), id)); showToast(t('favRemoved')); favChanged(); }
  else if(act === 'remove-no') renderFavs();
});
/* Escape closes an open ⋯ menu first (on the capture phase, before the app's own Escape closes the sheet) */
document.addEventListener('keydown', function favMenuEscape(e){
  if(e.key !== 'Escape') return;
  const open = document.querySelector('.fav-box .fav-menu:not([hidden])');
  if(open){ e.stopPropagation(); favCloseMenus(); const b = open.parentNode.querySelector('[data-fav-act="menu"]'); if(b) b.focus(); }
}, true);
/* the page was opened to show a favourite of this city (after switching city from the list): show it once, then take the
   favourite out of the address bar so a reload does not show it again */
(function(){
  let id = null;
  try{ id = new URLSearchParams(location.search).get('fav'); }catch(e){}
  try{ renderFavs(); }catch(e){}       // whatever is in the store, the rest of the app still starts
  if(!id) return;
  try{ const u = new URL(location.href); u.searchParams.delete('fav'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }catch(e){}
  const f = favLoad().find(x => x.id === id);
  if(f && f.city === CITY_ID) setTimeout(() => favOpen(f), 900);
})();
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
    // Enter saves from the name box only: on a focused button it does what that button says (Enter on Cancel used to save)
    if(e.key === 'Enter' && e.target === inp){ e.preventDefault(); finish(inp.value); }
    else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); finish(null); }
    else if(e.key === 'Tab'){                                           // a modal dialog: the keyboard stays inside it
      const f = [...d.querySelectorAll('input, button')], i = f.indexOf(document.activeElement);
      const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
      e.preventDefault(); f[n].focus();
    }
  });
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
