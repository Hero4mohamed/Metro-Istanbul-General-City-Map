/* ===========================================================================
   THE OWNER'S DEVELOPER OPTIONS (V4.8.2)
   Asked for on 19 Nov 2026, before the closed test on Google Play: "Data & sources" and the Assistant AI key box shown only to the
   owner, and the assistant ("Ask the map", still being developed) off for everyone else. Hidden with CSS (app.template.html:
   html:not(.dev-on) …), so nothing else in the app changes.
   The switch: tap the version line in Settings › About 7 times in quick succession (the same gesture as Android's own developer
   options); the same again switches it off. Nothing in these panels is secret, so a switch is enough. Tying it to the owner's
   account instead would put a personal email address in public code, and could still be bypassed.
   Stored on this device only, as irn_dev (listed on the storage page).
   =========================================================================== */
/* ==DEVMODE-PURE-START== */
const DEV_KEY = 'irn_dev', DEV_TAPS = 7, DEV_GAP_MS = 1500;
/* one tap on the version line: st is the count so far ({ n, last }) or null; returns the new count, and toggle when it reached 7 */
function devTapNext(st, now){
  const n = st && now - st.last <= DEV_GAP_MS ? st.n + 1 : 1;
  return n >= DEV_TAPS ? { n: 0, last: now, toggle: true } : { n: n, last: now, toggle: false };
}
/* ==DEVMODE-PURE-END== */
function devOn(){ return lsStr(DEV_KEY) === '1'; }
function devApply(){ document.documentElement.classList.toggle('dev-on', devOn()); }
devApply();
(function(){
  const v = document.getElementById('aboutBuild'); if(!v) return;
  let st = null;
  v.addEventListener('click', () => {
    st = devTapNext(st, Date.now());
    if(!st.toggle) return;
    const on = !devOn();
    try{ if(on) localStorage.setItem(DEV_KEY, '1'); else localStorage.removeItem(DEV_KEY); }catch(e){}
    devApply();
    if(!on && typeof aiShut === 'function') try{ aiShut(); }catch(e){}
    showToast(t(on ? 'devOnMsg' : 'devOffMsg'));
  });
})();
