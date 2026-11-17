/* ===========================================================================
   THE PROFILE CORNER (V4.7)
   Asked for as: "put anything that has relation to the profile on the top right corner of the screen ... a place just for the profile
   things like signing out and adding friends". Design: docs/superpowers/specs/2026-11-16-profile-corner-favourites-design.md.
     * One round button at the top right (your initial, or a person outline; an amber dot while the email is unconfirmed).
     * It opens the profile: the account box (22c) and the friends list with Add friend (22d). On a computer a panel like Settings,
       on a phone a sheet of its own (18-mobile-shell.js moves #profileBody into it). It is not a bottom-bar button.
     * Opening it loads the friends list but never starts reading friends' positions: that stays the Friends tab's job.
   ========================================================================== */
/* ==PROFILE-CORE-START== */
const PROFILE_OUTLINE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.6 4.5-5.4 8-5.4s6.5 1.8 8 5.4"/></svg>';
/* the first letter as a person sees it (V4.7.1): a whole emoji (😀, 👩‍💻, 👍🏽) or a letter with its accent, never half of one.
   charAt(0) gave half an emoji, which shows as a broken box. Phones without Intl.Segmenter still get whole code points. */
function profileInitial(name){
  try{
    if(typeof Intl !== 'undefined' && Intl.Segmenter){
      const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)[Symbol.iterator]().next();
      if(!it.done) return it.value.segment;
    }
  }catch(e){}
  return Array.from(name)[0] || '';
}
function renderProfileBtn(){
  const b = document.getElementById('profileBtn'); if(!b) return;
  const name = acct ? ('' + (acct.name || acct.email || '')).trim() : '';
  if(acct && name){
    const c = profileInitial(name);
    b.textContent = (typeof lang !== 'undefined' && lang === 'tr') ? c.toLocaleUpperCase('tr-TR') : c.toUpperCase();
  } else b.innerHTML = PROFILE_OUTLINE;
  b.classList.toggle('signed', !!acct);
  b.classList.toggle('unconfirmed', !!acct && !acct.verified);
  b.setAttribute('aria-label', t('profile') + (acct ? ': ' + name : '') + (acct && !acct.verified ? ' · ' + t('profileUnconfirmed') : ''));
}
function profileVisible(){
  if(IS_MOBILE && mSheets.profile) return mSheets.profile.classList.contains('open');
  const p = document.getElementById('profilePanel');
  return !!(p && p.classList.contains('open'));
}
/* what the profile shows, fresh: the account, and (signed in) the friends list read from the server once */
async function profileOpened(){
  renderAccount(); renderFriendList();
  if(accReady()){ try{ await loadFriends(); renderFriendList(); }catch(e){} }
}
function openProfile(){
  if(IS_MOBILE && mSheets.profile){ openSheet('profile'); return; }       // openSheet calls profileOpened()
  const p = document.getElementById('profilePanel'), o = document.getElementById('profileOverlay');
  if(p) p.classList.add('open');
  if(o) o.classList.add('on');
  profileOpened();
}
function closeProfile(){
  if(IS_MOBILE && mSheets.profile){ if(mSheets.profile.classList.contains('open')) openSheet(null); return; }
  const p = document.getElementById('profilePanel'), o = document.getElementById('profileOverlay');
  if(p) p.classList.remove('open');
  if(o) o.classList.remove('on');
}
/* signed in, confirmed or out: the button follows, and an open profile reloads (its friends list is not the Friends tab's, so the
   Friends file does not load it when only the profile is open) */
function profileAccountChanged(){
  renderProfileBtn();
  if(profileVisible()) return profileOpened();
}
/* ==PROFILE-CORE-END== */
(function(){
  renderProfileBtn();
  onAccountChange(profileAccountChanged);
  const b = document.getElementById('profileBtn');
  if(b) b.addEventListener('click', () => { if(profileVisible()) closeProfile(); else openProfile(); });
  const x = document.getElementById('profileX'), o = document.getElementById('profileOverlay');
  if(x) x.addEventListener('click', closeProfile);
  if(o) o.addEventListener('click', closeProfile);
  /* "Open profile" in the Friends tab, "Account and friends ›" in Settings > You */
  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('[data-prof-open]'); if(!el) return;
    const sp = document.getElementById('settingsPanel');
    if(sp && sp.classList.contains('open')) closeSettings();
    openProfile();
  });
})();
