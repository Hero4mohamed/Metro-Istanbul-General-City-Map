/* ===========================================================================
   FRIENDS AND SHARING YOUR LOCATION (V4.6.3)
   Asked for as: "share location and show their locations on map but only to their friends ... add your friends via links".
   Design: docs/superpowers/specs/2026-11-14-friends-location-design.md. The access rules (firebase/firestore.rules) are the real
   protection; this file follows them:
     * A friend link: 128 random bits, at most 48 hours, once, and only if the other person presses Accept. Accepting is ONE write
       that uses up the link and creates the friendship, so neither can happen without the other.
     * One friendship per pair (the two ids sorted), so Remove ends it both ways.
   ========================================================================== */
/* ==FRIENDS-PURE-START== */
const INVITE_HOURS = 47;              // the rules allow 48 h from the SERVER's clock; an hour less leaves room for a phone whose clock runs ahead
function newInviteId(rand){ return Array.from(rand, b => b.toString(16).padStart(2, '0')).join(''); }
function parseInviteHash(hash){ const m = /^#invite=([0-9a-f]{32})$/.exec(String(hash || '')); return m ? m[1] : null; }
function inviteLink(base, id){ return String(base).replace(/#.*$/, '') + '#invite=' + id; }
/* Accept = claim the link (only if nobody changed it since we read it) + create the friendship (only if it does not exist) */
function acceptWrites(projectId, invite, me){
  const a = me < invite.from ? me : invite.from, b = me < invite.from ? invite.from : me;
  return [
    { update: Object.assign({ name: fsDocPath(projectId, 'invites', invite._id) }, fsEncode({ usedBy: me })),
      updateMask: { fieldPaths: ['usedBy'] }, currentDocument: { updateTime: invite._updateTime } },
    { update: Object.assign({ name: fsDocPath(projectId, 'friendships', pairId(me, invite.from)) }, fsEncode({ a, b, inviter: invite.from, acceptor: me, invite: invite._id })),
      updateTransforms: [{ fieldPath: 'created', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } },
  ];
}
/* ==FRIENDS-PURE-END== */
/* ==FRIENDS-CORE-START== */
var friends = [], myInvites = [];
/* a friend link opened while signed out waits here (this tab only) until the account is ready */
function pendingInvite(){ try{ return sessionStorage.getItem('irn_pending_invite'); }catch(e){ return null; } }
function setPendingInvite(id){ try{ if(id) sessionStorage.setItem('irn_pending_invite', id); else sessionStorage.removeItem('irn_pending_invite'); }catch(e){} }
async function loadFriends(){
  if(!accReady()){ friends = []; myInvites = []; return; }
  const me = acct.uid;
  const rows = (await fsQuery(fsWhereEq('friendships', 'a', me))).concat(await fsQuery(fsWhereEq('friendships', 'b', me)));
  const prev = new Map(friends.map(f => [f.uid, f]));
  friends = await Promise.all(rows.map(async f => {
    const uid = f.a === me ? f.b : f.a, old = prev.get(uid);
    let name = old ? old.name : '';
    try{ const r = await fsFetch(docName('profiles', uid)); if(r.ok) name = fsDecode(await r.json()).name || name; }catch(e){}
    return { uid, name: name || '?', sharing: old ? old.sharing : false, pos: old ? old.pos : null };
  }));
  friends.sort((x, y) => x.name.localeCompare(y.name));
  const now = Date.now(), inv = await fsQuery(fsWhereEq('invites', 'from', me));
  myInvites = inv.filter(i => i.usedBy == null && i.expires > now);
  const stale = inv.filter(i => !(i.usedBy == null && i.expires > now));          // used or expired links are tidied away
  if(stale.length) try{ await fsCommit(stale.map(i => ({ delete: docName('invites', i._id) }))); }catch(e){}
}
async function makeInvite(base){
  const id = newInviteId(crypto.getRandomValues(new Uint8Array(16)));
  await fsCommit([{ update: Object.assign({ name: docName('invites', id) },
      fsEncode({ from: acct.uid, fromName: acct.name, usedBy: null, expires: new Date(Date.now() + INVITE_HOURS * 3600e3) })),
    updateTransforms: [{ fieldPath: 'created', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } }]);
  return inviteLink(base, id);
}
async function cancelInvite(id){ await fsCommit([{ delete: docName('invites', id) }]); myInvites = myInvites.filter(i => i._id !== id); }
async function removeFriend(uid){ await fsCommit([{ delete: docName('friendships', pairId(acct.uid, uid)) }]); friends = friends.filter(f => f.uid !== uid); }
/* a friend link was opened: sign in first if needed (the link waits), then ask. Nothing is written before Accept. */
async function openInvite(id){
  if(!accReady()){ setPendingInvite(id); inviteUI.needAccount(); return; }
  let inv = null;
  try{ const r = await fsFetch(docName('invites', id)); if(r.ok) inv = fsDecode(await r.json()); }catch(e){}
  if(!inv || !inv.from){ setPendingInvite(null); inviteUI.say('frInviteGone'); return; }
  if(inv.from === acct.uid){ setPendingInvite(null); inviteUI.say('frInviteOwn'); return; }
  if(inv.usedBy != null || !(inv.expires > Date.now())){ setPendingInvite(null); inviteUI.say('frInviteGone'); return; }
  inviteUI.show(inv);
}
async function acceptInvite(inv){
  setPendingInvite(null);
  try{ await fsCommit(acceptWrites(FIREBASE.projectId, inv, acct.uid)); }
  catch(e){ inviteUI.say(/already_exists|failed_precondition|aborted/.test(e.code || '') ? 'frAlready' : 'frAcceptFailed'); return false; }
  inviteUI.say('frNowFriends');
  try{ await loadFriends(); }catch(e){}
  renderFriends();
  return true;
}
function declineInvite(){ setPendingInvite(null); }
onAccountChange(() => { if(accReady()){ const p = pendingInvite(); if(p) openInvite(p); } });
/* the friends part of the Friends box (the account box above it handles signing in) */
function friendsViewHTML(){
  if(!accReady()) return '';
  const btn = (act, key, cls, data) => '<button type="button" class="' + (cls || 'btn') + '" data-fr="' + act + '"' + (data || '') + '>' + svgEsc(t(key)) + '</button>';
  const rows = friends.length ? friends.map(f => '<div class="fr-row"><span class="fr-av" aria-hidden="true">' + svgEsc((f.name || '?').trim().charAt(0).toUpperCase()) + '</span>'
      + '<span class="fr-nm">' + svgEsc(f.name) + (f.sharing ? '<small class="fr-on">' + svgEsc(t('frSharingNow')) + '</small>' : '') + '</span>'
      + btn('remove', 'frRemove', 'mini', ' data-uid="' + attrEsc(f.uid) + '" aria-label="' + attrEsc(t('frRemove') + ': ' + f.name) + '"') + '</div>').join('')
    : '<p class="sp-hint">' + svgEsc(t('frNone')) + '</p>';
  const inv = myInvites.map(i => '<div class="fr-row fr-inv"><span class="fr-nm">' + svgEsc(t('frOpenLink')) + '<small>'
      + svgEsc(t('frExpires').replace('{h}', String(Math.max(1, Math.round((i.expires - Date.now()) / 3600e3))))) + '</small></span>'
      + btn('cancel', 'accCancel', 'mini', ' data-id="' + attrEsc(i._id) + '"') + '</div>').join('');
  return '<div class="fr-list"><div class="fr-h">' + svgEsc(t('frFriends')) + '</div>' + rows + inv + '</div>'
    + '<div class="acc-acts">' + btn('invite', 'frInvite') + '</div><p class="sp-hint">' + svgEsc(t('frInviteHint')) + '</p>';
}
/* ==FRIENDS-CORE-END== */
/* ---- on the page ---- */
const inviteUI = {
  show: inv => {
    const d = document.getElementById('inviteDlg'), o = document.getElementById('inviteOverlay'); if(!d) return;
    d._inv = inv;
    document.getElementById('inviteQ').textContent = t('frInviteQ').replace('{name}', inv.fromName || '?');
    d.classList.add('open'); if(o) o.classList.add('on');
    try{ document.getElementById('inviteAccept').focus(); }catch(e){}
  },
  say: key => { if(typeof showToast === 'function') showToast(t(key)); renderFriends(); },
  needAccount: () => { if(typeof showToast === 'function') showToast(t('frSignInFirst')); openFriends(); },
};
function closeInviteDlg(){ const d = document.getElementById('inviteDlg'), o = document.getElementById('inviteOverlay'); if(d){ d.classList.remove('open'); d._inv = null; } if(o) o.classList.remove('on'); }
function renderFriends(){ document.querySelectorAll('.fr-box').forEach(b => { b.innerHTML = friendsViewHTML(); }); }
/* open the Friends view: the sheet on a phone, the card on a computer (18-mobile-shell.js adds the sheet) */
function openFriends(){
  if(typeof IS_MOBILE !== 'undefined' && IS_MOBILE && typeof mSheets !== 'undefined' && mSheets.friends) openSheet('friends');
  else { const c = document.getElementById('cardFriends'); if(c) try{ c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }catch(e){} }
  friendsOpened();
}
async function friendsOpened(){ renderAccount(); renderFriends(); if(accReady()) try{ await loadFriends(); renderFriends(); }catch(e){} }
(function(){
  onAccountChange(() => { renderFriends(); });
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-fr]'); if(!b) return;
    const act = b.dataset.fr; b.disabled = true;
    try{
      if(act === 'invite'){
        const link = await makeInvite(location.origin + location.pathname + location.search);
        let shared = false;
        if(navigator.share) try{ await navigator.share({ title: 'TurkMaps', text: t('frShareText').replace('{name}', acct.name), url: link }); shared = true; }catch(err){}
        if(!shared){ try{ await navigator.clipboard.writeText(link); showToast(t('frCopied')); }catch(err){ prompt(t('frCopyThis'), link); } }
        await loadFriends();
      }
      else if(act === 'cancel') await cancelInvite(b.dataset.id);
      else if(act === 'remove') await removeFriend(b.dataset.uid);
      renderFriends();
    }catch(err){ showToast(accErrText(err)); }
    finally{ b.disabled = false; }
  });
  const acc = document.getElementById('inviteAccept'), dec = document.getElementById('inviteDecline'), ov = document.getElementById('inviteOverlay');
  if(acc) acc.addEventListener('click', async () => { const d = document.getElementById('inviteDlg'), inv = d && d._inv; closeInviteDlg(); if(inv) await acceptInvite(inv); });
  if(dec) dec.addEventListener('click', () => { declineInvite(); closeInviteDlg(); });
  if(ov) ov.addEventListener('click', () => { declineInvite(); closeInviteDlg(); });
  /* a friend link opened this page: read it, take it out of the address bar, and ask (after signing in, if needed) */
  const id = parseInviteHash(location.hash);
  if(id){ try{ history.replaceState(history.state, '', location.pathname + location.search); }catch(e){} setTimeout(() => openInvite(id), 800); }
  renderFriends();
})();
