/* ===========================================================================
   PRIVACY CHOICE, LEGAL LINKS AND "DELETE ALL MY DATA" (V4.3)
   The app has no accounts, no cookies and no analytics, so it has nothing to ask consent for EXCEPT the two optional look-ups that
   send what the person typed (or the ends of a walk) to services run by others (see onlineSearchPref, 02-settings.js). This file
   asks that once, in a card above the bottom bar that never covers the map and never blocks it: two buttons of the same size and
   weight, "keep everything on my device" first because it is the default, and a link to the full notice. Escape means "keep".
   Until the person answers the look-ups stay off.
   ========================================================================== */

/* legal pages come in English (name.html) and Turkish (name.tr.html); Arabic and French readers get the English page.
   A function declaration, not an expression: applyI18n (01-i18n.js) calls it, and it can run before this file does. */
function syncLegalLinks(){
  const suffix = (typeof lang !== 'undefined' && lang === 'tr') ? '.tr' : '';
  document.querySelectorAll('a[data-legal]').forEach(a => {
    a.setAttribute('href', 'legal/' + a.getAttribute('data-legal') + suffix + '.html');
    a.setAttribute('hreflang', suffix ? 'tr' : 'en');
  });
}

(function(){
  syncLegalLinks();
  const build = document.getElementById('aboutBuild');
  if(build) build.textContent = '__APP_VERSION__' + ' · ' + BUILD;

  /* ---- the one-time question ---- */
  const box = document.getElementById('privNotice');
  if(box){
    const welcome = document.getElementById('wcOverlay');
    const needed = () => lsStr('irn_privacy') !== PRIVACY_VERSION;
    const show = () => {
      if(!needed()) return;
      if(welcome && welcome.classList.contains('show')) return;   // one thing at a time: the welcome dialog goes first
      box.classList.add('show');
    };
    const answer = allow => {
      setOnlineSearch(allow);                                      // 02-settings.js: stores the choice, moves the switch, hides this card
      showToast(t(allow ? 'privAllowed' : 'privKept'));
    };
    document.getElementById('privAllow').addEventListener('click', () => answer(true));
    document.getElementById('privKeep').addEventListener('click', () => answer(false));
    box.addEventListener('keydown', e => { if(e.key === 'Escape'){ e.stopPropagation(); answer(false); } });
    if(welcome) new MutationObserver(show).observe(welcome, { attributes:true, attributeFilter:['class'] });
    show();
  }

  /* ---- delete everything this app stored on this device ---- */
  const btn = document.getElementById('deleteAll');
  if(btn){
    let armed = false, timer = 0;
    const disarm = () => { armed = false; clearTimeout(timer); btn.textContent = t('deleteAll'); btn.classList.remove('armed'); };
    btn.addEventListener('click', () => {
      if(!armed){                                                  // two taps: the first only asks, so a stray touch deletes nothing
        armed = true; btn.textContent = t('deleteAllSure'); btn.classList.add('armed');
        timer = setTimeout(disarm, 5000);
        return;
      }
      disarm();
      deleteAllMyData();
    });
    btn.addEventListener('blur', () => { if(armed) disarm(); });
  }
})();

/* Everything the app wrote, and nothing else. The address this app lives at (a github.io user page) is shared with the same
   author's other projects, and local storage and cache storage belong to the ADDRESS, not to the app, so localStorage.clear()
   or deleting every cache would wipe a neighbour's data. Ours all start with irn_ (storage) and raynet- (caches). */
function irnWipeLocal(){
  try{ Object.keys(localStorage).filter(k => k.indexOf('irn_') === 0).forEach(k => localStorage.removeItem(k)); }catch(e){}
}
async function deleteAllMyData(){
  window.addEventListener('pagehide', irnWipeLocal);               // anything written while the page unloads goes too
  irnWipeLocal();
  try{
    if(window.caches){
      const names = await caches.keys();
      await Promise.all(names.filter(n => n.indexOf('raynet-') === 0).map(n => caches.delete(n)));
    }
  }catch(e){}
  try{
    if(navigator.serviceWorker){
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg) await reg.unregister();
    }
  }catch(e){}
  irnWipeLocal();
  showToast(t('deleteAllDone'));
  setTimeout(() => location.reload(), 900);
}
