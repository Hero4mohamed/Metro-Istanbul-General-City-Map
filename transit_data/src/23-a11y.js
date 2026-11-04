/* ===========================================================================
   ACCESSIBILITY (V4.3): names, switch state, keyboard, dialogs
   Four things a person using a screen reader or only a keyboard ran into:
   1. Names. Icon buttons, switches and the map itself carried a hard-coded English label, so Turkish, Arabic and French readers heard
      English ("Close", "Reduce motion"), and three checkboxes had no name at all. A name now comes from the text that is on screen (so
      it is already in the right language), or from a translated key.
   2. State. Every on/off switch was a role="switch" with no aria-checked, so "on" and "off" were never said.
   3. Keyboard. Some things you click (a line in the legend, a group header, a notice) were plain <div>s: unreachable and not
      operable. They are buttons now, in everything but the tag. Escape closed three panels and ended a live journey in one press; it
      now closes the newest thing and nothing else.
   4. Dialogs. A panel that slides in did not take focus, did not give it back, did not keep Tab inside, and while closed (only made
      invisible, not removed) could still be Tabbed into.
   Nothing here changes how the app looks.
   ========================================================================== */

/* ---- 1 and 2: names and state. A function declaration: applyI18n (01-i18n.js) calls it, and it can run before this file does. ---- */
function syncAria(){
  const q = s => document.querySelectorAll(s);
  // a switch or checkbox is named by the label printed beside it (already translated), not by a copy of that label in English
  q('button.sw[role="switch"], .switch > input[type="checkbox"]').forEach(el => {
    const row = el.closest('.sp-row, .row, .sp-item'); if(!row) return;
    const label = row.querySelector(':scope > span[data-i18n], :scope > .sp-row > span[data-i18n], :scope > span:not(.sw-k)');
    if(!label) return;
    if(!label.id) label.id = 'lbl_' + (el.id || Math.random().toString(36).slice(2, 8));
    el.setAttribute('aria-labelledby', label.id); el.removeAttribute('aria-label');
  });
  // a button whose tooltip is already translated is named by it
  q('[data-i18n-title][aria-label]').forEach(el => { if(el.title) el.setAttribute('aria-label', el.title); });
  // the zoom buttons and the map are drawn by Leaflet, which knows no translations
  q('.leaflet-control-zoom-in').forEach(a => { a.setAttribute('aria-label', t('zoomIn')); a.title = t('zoomIn'); });
  q('.leaflet-control-zoom-out').forEach(a => { a.setAttribute('aria-label', t('zoomOut')); a.title = t('zoomOut'); });
  const map = document.getElementById('map');
  if(map){ map.setAttribute('role', 'region'); map.setAttribute('aria-label', t('mapLabel')); map.setAttribute('aria-describedby', 'mapHelp'); }
  q('.omni-bar svg, .omni svg, .settings-btn svg, .locate-fab svg').forEach(s => s.setAttribute('aria-hidden', 'true'));
  syncSwitches();
  kbEnhance();
}
/* aria-checked follows the .on class the app already toggles */
function syncSwitches(){
  document.querySelectorAll('[role="switch"]').forEach(el => el.setAttribute('aria-checked', el.classList.contains('on') ? 'true' : 'false'));
  document.querySelectorAll('.lchip > .sw[role="checkbox"]').forEach(el => el.setAttribute('aria-checked', el.parentElement.classList.contains('off') ? 'false' : 'true'));
}

/* ---- 3: keyboard ---- */
/* Things the app draws as <div>/<span> and acts on when clicked. They get a role, a place in the Tab order, and Enter / Space. The
   swatch inside a legend chip shows or hides that line, so it is a checkbox of its own inside the chip, which opens the line. */
var KB_CLICKABLE = '.lchip, .lchip > .sw, .grp-h, #annHead, .ann-item, .ic-row, .bus-row, .nb-row, .ropt, .plan-item';   // var: syncAria() can run before this line
function kbEnhance(){
  document.querySelectorAll(KB_CLICKABLE).forEach(el => {
    if(el.closest('.leaflet-container')) return;
    if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if(el.matches('.lchip > .sw')){
      el.setAttribute('role', 'checkbox'); el.setAttribute('aria-checked', el.parentElement.classList.contains('off') ? 'false' : 'true');
      el.setAttribute('aria-label', t('showHide'));
    } else if(!el.hasAttribute('role')) el.setAttribute('role', 'button');
  });
}
document.addEventListener('keydown', e => {
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target;
  if(!el || !el.matches || !el.matches(KB_CLICKABLE)) return;      // the focused element itself, not an ancestor: a swatch is not also its chip
  e.preventDefault();
  el.click();
});
{
  let queued = false;
  new MutationObserver(muts => {
    if(queued || !muts.some(m => !(m.target.closest && m.target.closest('.leaflet-container')))) return;
    queued = true; afterPaint(() => { queued = false; kbEnhance(); syncSwitches(); });      // afterPaint (02-settings.js) also fires in a hidden tab, which requestAnimationFrame does not
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => afterPaint(syncSwitches), true);
}

/* Escape closes the newest thing and nothing else, the same way the phone's back button does (21-history.js). A live journey is only
   ended by Escape when nothing else is open. The search boxes have their own Escape. */
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape' || e.defaultPrevented) return;
  if(e.target && (e.target.id === 'omniIn' || e.target.id === 'aiIn')) return;
  const open = (id, cls) => { const x = document.getElementById(id); return !!(x && x.classList.contains(cls)); };
  if(open('settingsPanel', 'open')){ closeSettings(); e.preventDefault(); return; }
  if(open('nearPanel', 'open')){ closeNearby(); e.preventDefault(); return; }
  if(open('passPanel', 'open')){ closePassport(); e.preventDefault(); return; }
  const top = NAV && NAV.stack && NAV.stack[NAV.stack.length - 1];
  if(top && top.id !== 'omni' && top.id !== 'ai'){ e.preventDefault(); navCloseEntry(top); return; }
  if(typeof goState !== 'undefined' && goState){ e.preventDefault(); exitGo(); }
});

/* ---- 4: dialogs ---- */
(function(){
  /* each: the element, the class that means open, whether it is modal (keeps Tab inside), and what takes focus when it opens */
  const DIALOGS = [
    { id: 'settingsPanel', cls: 'open', modal: true,  first: '#settingsX' },
    { id: 'passPanel',     cls: 'open', modal: true,  first: '#passX' },
    { id: 'stnFinder',     cls: 'open', modal: true,  first: '#finderList button, #finderX' },     // the first of these that exists
    { id: 'wcOverlay',     cls: 'show', modal: true,  first: '#wcGo', hiddenByDisplay: true },
    { id: 'nearPanel',     cls: 'open', modal: false, first: '#nearX' },
    { id: 'goPanel',       cls: 'open', modal: false, first: '#goExit' },
  ];
  const state = {};
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  DIALOGS.forEach(d => {
    const el = document.getElementById(d.id); if(!el) return;
    state[d.id] = { opener: null, open: false };
    const apply = () => {
      const isOpen = el.classList.contains(d.cls), s = state[d.id];
      // closed panels are only made invisible (opacity, off-screen), so the keyboard could still land inside them: inert removes them
      if(!d.hiddenByDisplay) el.inert = !isOpen;
      if(isOpen && !s.open){
        s.open = true; s.opener = document.activeElement && !el.contains(document.activeElement) ? document.activeElement : null;
        // only a modal takes focus: the nearby list and the journey bar open on their own and must not pull the cursor away
        if(d.modal) setTimeout(() => { const f = d.first.split(',').map(sel => el.querySelector(sel.trim())).find(Boolean); if(f && visible(f)) f.focus({ preventScroll: true }); }, 60);
      } else if(!isOpen && s.open){
        s.open = false;
        const o = s.opener; s.opener = null;
        if(o && o.isConnected && visible(o) && !(document.activeElement && document.activeElement !== document.body && !el.contains(document.activeElement))) o.focus({ preventScroll: true });
      }
    };
    new MutationObserver(apply).observe(el, { attributes: true, attributeFilter: ['class'] });
    apply();
  });
  document.addEventListener('keydown', e => {
    if(e.key !== 'Tab') return;
    const d = DIALOGS.find(x => x.modal && document.getElementById(x.id) && document.getElementById(x.id).classList.contains(x.cls));
    if(!d) return;
    const el = document.getElementById(d.id);
    const items = [...el.querySelectorAll(FOCUSABLE)].filter(visible);
    if(!items.length) return;
    const first = items[0], last = items[items.length - 1], a = document.activeElement;
    if(!el.contains(a)){ e.preventDefault(); first.focus(); }
    else if(e.shiftKey && a === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && a === last){ e.preventDefault(); first.focus(); }
  });
})();

syncAria();
