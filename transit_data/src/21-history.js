/* ===========================================================================
   THE BACK BUTTON (V4.2) — back is "undo", one step at a time.
   Something opens on top of the map (a sheet, a station, a line's panel, Settings...) and the browser's history gets one more entry;
   pressing back (the phone's back button or swipe) closes the newest thing and nothing else, so a person who opened Layers and then
   a line's panel is taken back to Layers first and to the map after that. Before this, back did not know about any of it and left the
   app (or the page) with a panel still open.

   Nothing in the app was changed to make this work: the open/closed state of each layer is already a class on an element, so the
   layers are WATCHED, not called. A layer opening pushes a history entry; one closing by its own button takes its entry away again;
   back closes the newest. Each entry carries its depth in its state, so the app can tell its own entries (and where a press of back
   has landed) from a #link, and can step over entries left by an earlier visit to the page.
   Two details are worth knowing:
   - A layer that opens in the same moment as a sheet closes (tapping a line in the Layers sheet closes the sheet to show its panel)
     remembers the sheet, and back puts the sheet back before going on to the map.
   - Switching scope inside the Layers sheet (Active, Vision, Buses, Intercity, Weather) is a step too: back returns to the scope
     you came from. It stops being a step when the sheet closes — the map keeps what you chose.
   The live journey is NOT a layer: it is something the person is in the middle of, and an accidental back press must not end it.
   ========================================================================== */
/* `var`, not `const`: init() runs at the end of the file before this one, and setTab() asks navScope() about the first scope. A const
   would still be in its temporal dead zone at that moment and stop the whole app starting; a var is simply not ready yet. */
var NAV = { ready:false, stack:[], depth:0, inflight:false, dirty:false, undoing:false, timer:0 };
const navHas = (id, cls) => { const e = document.getElementById(id); return !!(e && e.classList.contains(cls)); };
const navClick = id => { const e = document.getElementById(id); if(e) e.click(); };
/* in the order they are noticed when several open together; each says how to know it is open and how to close it */
const NAV_LAYERS = [
  { id:'sheet',    open:() => !!document.querySelector('.msheet.open'), close:() => openSheet(null) },
  { id:'stn',      open:() => navHas('stn','show'),           close:() => navClick('stnX') },
  { id:'linp',     open:() => navHas('linp','show'),          close:() => navClick('linpX') },
  { id:'near',     open:() => navHas('nearPanel','open'),     close:() => closeNearby() },
  { id:'pass',     open:() => navHas('passPanel','open'),     close:() => closePassport() },
  { id:'settings', open:() => navHas('settingsPanel','open'), close:() => closeSettings() },
  { id:'ai',       open:() => document.body.classList.contains('ai-open'), close:() => aiShut() },
  { id:'omni',     open:() => navHas('omni','open'),          close:() => document.body.click() },   // the search list closes on any click outside it
  { id:'welcome',  open:() => navHas('wcOverlay','show'),     close:() => navClick('wcGo') },
];
function navCloseEntry(e){
  if(e.id === 'scope'){ NAV.undoing = true; try{ setTab(e.from); }finally{ NAV.undoing = false; } return; }
  const l = NAV_LAYERS.find(x => x.id === e.id); if(l) l.close();
}
/* make the browser's history as deep as the stack is */
function navAlign(){
  const delta = NAV.stack.length - NAV.depth;
  if(delta > 0){
    for(let i = 0; i < delta; i++){ NAV.depth++; try{ history.pushState({ irnNav:true, d:NAV.depth }, ''); }catch(err){ NAV.ready = false; return; } }
  } else if(delta < 0){
    // going back is asynchronous: hold off looking at the page again until the browser says it has arrived
    NAV.inflight = true; NAV.depth = NAV.stack.length;
    clearTimeout(NAV.timer); NAV.timer = setTimeout(() => { if(NAV.inflight){ NAV.inflight = false; navReconcile(); } }, 600);
    history.go(delta);
  }
}
/* compare the stack with what is open on the page now */
function navReconcile(){
  if(!NAV.ready) return;
  if(NAV.inflight){ NAV.dirty = true; return; }
  const open = NAV_LAYERS.filter(l => l.open()), now = new Set(open.map(l => l.id));
  const layersSheet = navHas('sheet_layers','open');
  let goneSheet = null;
  for(let i = NAV.stack.length - 1; i >= 0; i--){
    const e = NAV.stack[i];
    const alive = e.id === 'scope' ? (!IS_MOBILE || layersSheet) : now.has(e.id);
    if(!alive){ if(e.id === 'sheet') goneSheet = e.sheet; NAV.stack.splice(i, 1); }
  }
  const have = new Set(NAV.stack.map(e => e.id));
  open.forEach(l => { if(!have.has(l.id)){ const e = { id:l.id }; if(l.id !== 'sheet' && goneSheet) e.returnTo = goneSheet; NAV.stack.push(e); } });
  const se = NAV.stack.find(e => e.id === 'sheet');
  if(se){ const o = document.querySelector('.msheet.open'); se.sheet = o ? o.id.replace('sheet_','') : null; }
  navAlign();
}
/* setTab() tells us when the scope changed (15-ui-wiring.js) */
function navScope(prev, now){
  if(!NAV || !NAV.ready || NAV.undoing || prev === now) return;
  if(IS_MOBILE && !navHas('sheet_layers','open')) return;      // a scope change made from the map (a notice opening a bus line) is not a step in the sheet
  const top = NAV.stack[NAV.stack.length - 1];
  if(top && top.id === 'scope' && top.from === now) NAV.stack.pop();    // going back to where it came from by hand IS the undo
  else NAV.stack.push({ id:'scope', from:prev });
  navAlign();
}
window.addEventListener('popstate', e => {
  if(!NAV.ready) return;
  const st = e.state;
  if(!st || !st.irnNav) return;                                 // a #link, or something that is not ours
  if(NAV.inflight && st.d === NAV.depth){                       // the browser arrived where we sent it
    NAV.inflight = false; clearTimeout(NAV.timer);
    if(NAV.dirty){ NAV.dirty = false; navReconcile(); }
    return;
  }
  if(st.d > NAV.depth){ history.back(); return; }               // an entry from an earlier visit, or a forward press: step over it
  let last = null;
  while(NAV.depth > st.d && NAV.stack.length){ last = NAV.stack.pop(); NAV.depth--; navCloseEntry(last); }
  NAV.depth = NAV.stack.length;
  if(last && last.returnTo && !document.querySelector('.msheet.open')) openSheet(last.returnTo);   // back from a panel opened out of a sheet: the sheet again
});
(function(){
  if(!window.history || !history.pushState || !history.replaceState) return;
  try{ history.replaceState({ irnNav:true, d:0 }, ''); }catch(err){ return; }
  NAV.ready = true;
  const mo = new MutationObserver(navReconcile);
  ['stn','linp','nearPanel','passPanel','settingsPanel','omni','wcOverlay'].forEach(id => { const e = document.getElementById(id); if(e) mo.observe(e, { attributes:true, attributeFilter:['class'] }); });
  document.querySelectorAll('.msheet').forEach(e => mo.observe(e, { attributes:true, attributeFilter:['class'] }));
  mo.observe(document.body, { attributes:true, attributeFilter:['class'] });
  navReconcile();
})();
