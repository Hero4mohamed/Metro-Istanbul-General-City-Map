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
    return { uid, name: name || '?', sharing: old ? old.sharing : false, pos: old ? old.pos : null, viaMyLink: f.inviter === me, since: f.created || 0 };
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
      + '<span class="fr-nm">' + svgEsc(f.name) + (f.sharing ? '<small class="fr-on">' + svgEsc(t('frSharingNow')) + '</small>' : '')
      + (f.viaMyLink && f.since > Date.now() - 48 * 3600e3 ? '<small class="fr-new">' + svgEsc(t('frJustJoined')) + '</small>' : '') + '</span>'
      + btn('remove', 'frRemove', 'mini', ' data-uid="' + attrEsc(f.uid) + '" aria-label="' + attrEsc(t('frRemove') + ': ' + f.name) + '"') + '</div>').join('')
    : '<p class="sp-hint">' + svgEsc(t('frNone')) + '</p>';
  const inv = myInvites.map(i => '<div class="fr-row fr-inv"><span class="fr-nm">' + svgEsc(t('frOpenLink')) + '<small>'
      + svgEsc(t('frExpires').replace('{h}', String(Math.max(1, Math.round((i.expires - Date.now()) / 3600e3))))) + '</small></span>'
      + btn('cancel', 'accCancel', 'mini', ' data-id="' + attrEsc(i._id) + '"') + '</div>').join('');
  return '<div class="fr-list"><div class="fr-h">' + svgEsc(t('frFriends')) + '</div>' + rows + inv + '</div>'
    + '<div class="acc-acts">' + btn('invite', 'frInvite') + '</div><p class="sp-hint">' + svgEsc(t('frInviteHint')) + '</p>';
}
/* ==FRIENDS-CORE-END== */
/* ---------------------------------------------------------------------------
   SHARING YOUR LOCATION. Off until you start it; 15 min, 1 h or 8 h, never longer; exact, or rounded to about 1 km ON THE PHONE.
   While it runs a "Sharing" sign with Stop stays on screen. The position is sent when you moved more than 25 m, and at least every
   2 minutes (the rules hide you from friends 3 minutes after the last one, so a closed app disappears), never more than every 30 s.
   Stop, sign out and delete erase the stored position; so does the next start of the app, for one a crash left behind.
   --------------------------------------------------------------------------- */
/* ==SHARE-PURE-START== */
const SHARE_DURATIONS = [15, 60, 480];
const SHARE_MIN_GAP = 30e3, SHARE_MAX_GAP = 120e3, SHARE_MOVE_M = 25;
function approxPos(lat, lng){ return [Math.round(lat * 100) / 100, Math.round(lng * 100) / 100]; }
function posMeters(a, b){
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/* send now? `last` = { t, pos } of the last send, or null */
function shouldSend(last, now, pos){
  if(!last) return true;
  const dt = now - last.t;
  if(dt < SHARE_MIN_GAP) return false;
  if(dt >= SHARE_MAX_GAP) return true;
  return posMeters(last.pos, pos) > SHARE_MOVE_M;
}
/* the one stored position. Approximate is rounded HERE, so the exact numbers never leave the phone. The time comes from the server. */
function locationWrite(projectId, uid, pos, approx, untilMs){
  const ll = approx ? approxPos(pos.lat, pos.lng) : [pos.lat, pos.lng];
  return { update: Object.assign({ name: fsDocPath(projectId, 'locations', uid) },
             fsEncode({ lat: ll[0], lng: ll[1], acc: approx ? 1000 : Math.min(5000, Math.max(0, Math.round(pos.acc || 0))), approx: !!approx, until: new Date(untilMs) })),
           updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] };
}
/* ==SHARE-PURE-END== */
/* ==SHARE-CORE-START== */
var sharing = null;                        // { until (server ms), approx, watchId, tick, last, fix: { pos, t }, fails }
var shareSel = { min: 60, approx: false };
var shareChain = Promise.resolve(), shareStarting = null;
const FIX_MAX_AGE = 150e3;                 // a fix older than this is not sent as live (the rules hide you 3 min after the last one)
/* Every location write goes through ONE queue, so Stop's delete always lands after a write already on its way, and a write that had
   not started yet is dropped. Without this a late write could put your position back after Stop. */
function shareQueue(job){ const p = shareChain.then(job, job); shareChain = p.catch(() => {}); return p; }
function serverNow(){ return Date.now() + serverSkew; }
async function sendPosition(pos, fixT){
  if(!sharing) return;
  const now = Date.now();
  if(serverNow() >= sharing.until){ await stopSharing('expired'); return; }
  sharing.fix = { pos, t: fixT || now };
  if(now - sharing.fix.t > FIX_MAX_AGE) return;           // underground, or the fix is lost: say nothing rather than an old place as "now"
  if(!shouldSend(sharing.last, now, pos)) return;
  sharing.last = { t: now, pos };                          // set before trying: a refused write also waits the 30-second floor
  const s = sharing;
  await shareQueue(async () => {
    if(sharing !== s) return;                             // stopped meanwhile: never write after Stop
    const until = Math.min(s.until, serverNow() + 8 * 3600e3 - 60e3);     // the 8-hour rule, by the server's clock
    try{ await fsCommit([locationWrite(FIREBASE.projectId, acct.uid, pos, s.approx, until)]); if(s.fails) shareUI.trouble(false); s.fails = 0; }
    catch(e){ s.fails = (s.fails || 0) + 1; if(s.fails >= 3) shareUI.trouble(true); }   // the sign says so; it never claims all is well
  });
}
/* every 30 s: re-send the last fix if it is still recent (standing still sends nothing otherwise), and refresh the sign */
function shareHeartbeat(){ if(sharing && sharing.fix) return sendPosition(sharing.fix.pos, sharing.fix.t); return Promise.resolve(); }
/* resolves true once sharing runs, false if the location was refused or is unavailable (RF3) */
function startSharing(minutes, approx){
  if(SHARE_DURATIONS.indexOf(minutes) < 0) return Promise.reject(fbErr('bad_duration'));
  if(!accReady()) return Promise.reject(fbErr('signed_out'));
  if(!navigator.geolocation) return Promise.reject(fbErr('no_location'));
  if(sharing) return Promise.resolve(true);
  if(shareStarting) return shareStarting;   // pressed again while the location question is open: still ONE location watch
  const p = new Promise(resolve => {
    let first = true, watchId = null;
    const onPos = q => {
      const pos = { lat: q.coords.latitude, lng: q.coords.longitude, acc: q.coords.accuracy }, fixT = q.timestamp || Date.now();
      if(first){
        first = false;
        sharing = { until: serverNow() + minutes * 60e3, approx: !!approx, watchId, last: null, fix: null, fails: 0,
                    tick: setInterval(() => { shareHeartbeat(); if(sharing) shareUI.show(sharing); }, SHARE_MIN_GAP) };
        shareUI.show(sharing);
        sendPosition(pos, fixT).then(() => resolve(true), () => resolve(true));
        return;
      }
      sendPosition(pos, fixT);
    };
    const onErr = err => {
      if(first){ first = false; try{ navigator.geolocation.clearWatch(watchId); }catch(e){} shareUI.say('shareDenied'); resolve(false); return; }
      /* later: a refusal (permission taken back) stops sharing; a lost fix just stops the sends until it is back */
      if(err && err.code === 1 && sharing && sharing.watchId === watchId){ shareUI.say('shareDenied'); stopSharing('denied'); }
    };
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: !approx, maximumAge: 15000, timeout: 30000 });
  });
  shareStarting = p;
  const done = () => { shareStarting = null; }; p.then(done, done);
  return p;
}
async function stopSharing(why){
  const s = sharing; sharing = null;
  if(s){ try{ navigator.geolocation.clearWatch(s.watchId); }catch(e){} try{ clearInterval(s.tick); }catch(e){} }
  shareUI.hide();
  if(acct && acct.verified && FIREBASE){ const uid = acct.uid; await shareQueue(async () => { try{ await fsCommit([{ delete: docName('locations', uid) }]); }catch(e){} }); }
}
accOnLeave(async () => { if(sharing) await stopSharing('leave'); });
/* the account was lost (sign-in expired or disabled elsewhere): sharing stops at once, and the sign with it */
onAccountChange(() => { if(sharing && !accReady()) stopSharing('lost'); });
/* a position a crash or a closed tab left behind is erased when the app starts (it is already hidden from friends after 3 min) */
async function shareBootCleanup(){ if(accReady() && !sharing) try{ await fsCommit([{ delete: docName('locations', acct.uid) }]); }catch(e){} }
/* each friend read on its own: one who is not sharing (refused or missing) must not hide the others (RF2) */
async function pollFriends(){
  if(!accReady() || !friends.length){ shareUI.drawFriends(friends); return; }
  await Promise.all(friends.map(async f => {
    try{
      const r = await fsFetch(docName('locations', f.uid));
      if(r.ok){ const d = fsDecode(await r.json()); f.pos = { lat: d.lat, lng: d.lng, at: d.at, approx: !!d.approx }; f.sharing = true; }
      else { f.pos = null; f.sharing = false; }
    }catch(e){ f.pos = null; f.sharing = false; }
  }));
  shareUI.drawFriends(friends);
}
function shareViewHTML(){
  if(!accReady()) return '';
  if(sharing){
    const d = new Date(sharing.until - serverSkew), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return '<div class="sh-box sh-on"><p>' + svgEsc(t(sharing.approx ? 'shareOnApprox' : 'shareOnExact').replace('{time}', typeof remClock === 'function' ? remClock(hm) : hm)) + '</p>'
      + '<button type="button" class="btn danger" data-sh="stop">' + svgEsc(t('shareStop')) + '</button></div>';
  }
  const seg = (attr, opts, cur) => '<div class="seg">' + opts.map(([v, key]) => '<button type="button" ' + attr + '="' + v + '"' + (String(cur) === String(v) ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + '>' + svgEsc(t(key)) + '</button>').join('') + '</div>';
  return '<div class="sh-box"><div class="fr-h">' + svgEsc(t('shareTitle')) + '</div>'
    + seg('data-sh-min', [[15, 'share15'], [60, 'share60'], [480, 'share480']], shareSel.min)
    + seg('data-sh-approx', [[0, 'shareExact'], [1, 'shareApprox']], shareSel.approx ? 1 : 0)
    + '<button type="button" class="btn" data-sh="start">' + svgEsc(t('shareStart')) + '</button>'
    + '<p class="sp-hint">' + svgEsc(t('shareHint')) + '</p></div>';
}
/* ==SHARE-CORE-END== */
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
function renderFriends(){ document.querySelectorAll('.fr-box').forEach(b => { b.innerHTML = shareViewHTML() + friendsViewHTML(); }); }
/* the "Sharing" sign (on top of the map while you share), and your friends on the map */
const shareUI = {
  show: s => {
    const p = document.getElementById('sharePill'); if(!p || !s) return;
    const left = Math.max(1, Math.ceil((s.until - serverNow()) / 60e3));
    document.getElementById('sharePillTxt').textContent = t(s.approx ? 'sharePillApprox' : 'sharePill').replace('{m}', String(left));
    const tb = document.querySelector('.topbar'); if(tb) document.documentElement.style.setProperty('--share-top', Math.round(tb.getBoundingClientRect().bottom + 8) + 'px');
    p.hidden = false; document.body.classList.add('sharing-on');
  },
  hide: () => { const p = document.getElementById('sharePill'); if(p){ p.hidden = true; p.classList.remove('trouble'); } document.body.classList.remove('sharing-on'); renderFriends(); if(!friendsVisible()) stopFriendPolling(); },
  /* three refused writes in a row: the sign says friends may not see you, until a write gets through */
  trouble: on => { const p = document.getElementById('sharePill'); if(!p) return; p.classList.toggle('trouble', !!on); if(on) document.getElementById('sharePillTxt').textContent = t('sharePillTrouble'); },
  say: key => { if(typeof showToast === 'function') showToast(t(key)); renderFriends(); },
  drawFriends: list => {
    if(typeof map === 'undefined' || typeof L === 'undefined') return;
    if(!friendLayer) friendLayer = L.layerGroup().addTo(map);
    friendLayer.clearLayers();
    const now = Date.now();
    list.filter(f => f.pos && isFinite(f.pos.lat) && isFinite(f.pos.lng)).forEach(f => {
      const ago = Math.max(0, Math.floor((now - (f.pos.at || now)) / 60e3));
      const label = svgEsc(f.name) + ' · ' + svgEsc(ago < 1 ? t('frAgoNow') : t('frAgo').replace('{m}', String(ago))) + (f.pos.approx ? ' · ' + svgEsc(t('frApproxTag')) : '');
      L.marker([f.pos.lat, f.pos.lng], { icon: L.divIcon({ className: 'friend-dot' + (f.pos.approx ? ' approx' : ''), html: '<span>' + svgEsc((f.name || '?').trim().charAt(0).toUpperCase()) + '</span>', iconSize: [30, 30], iconAnchor: [15, 15] }),
        keyboard: false, title: (f.name || '') }).bindTooltip(label, { direction: 'top', offset: [0, -14] }).addTo(friendLayer);
    });
  },
};
var friendLayer = null, friendPoll = null;
/* friends' positions are read every 20 s while the Friends view is open or while you share (no live push in Firestore's REST) */
function startFriendPolling(){ if(friendPoll || !accReady()) return; const go = async () => { try{ await pollFriends(); renderFriends(); }catch(e){} }; go(); friendPoll = setInterval(go, 20e3); }
function stopFriendPolling(){ if(sharing) return; if(friendPoll){ clearInterval(friendPoll); friendPoll = null; } if(friendLayer) friendLayer.clearLayers(); }
/* is the Friends view on screen? On a computer its card always is; on a phone, while its sheet is open */
function friendsVisible(){ return typeof IS_MOBILE === 'undefined' || !IS_MOBILE || !!(typeof mSheets !== 'undefined' && mSheets.friends && mSheets.friends.classList.contains('open')); }
/* open the Friends view: the sheet on a phone, the card on a computer (18-mobile-shell.js adds the sheet) */
function openFriends(){
  if(typeof IS_MOBILE !== 'undefined' && IS_MOBILE && typeof mSheets !== 'undefined' && mSheets.friends) openSheet('friends');
  else { const c = document.getElementById('cardFriends'); if(c) try{ c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }catch(e){} }
  friendsOpened();
}
async function friendsOpened(){ renderAccount(); renderFriends(); if(accReady()){ try{ await loadFriends(); renderFriends(); }catch(e){} startFriendPolling(); } }
(function(){
  onAccountChange(() => { renderFriends(); if(accReady()){ if(friendsVisible()) friendsOpened(); } else { if(friendPoll){ clearInterval(friendPoll); friendPoll = null; } friends = []; shareUI.drawFriends([]); } });
  /* the share controls and the Stop on the sign */
  document.addEventListener('click', async e => {
    const m = e.target.closest('[data-sh-min]'), a = e.target.closest('[data-sh-approx]'), b = e.target.closest('[data-sh]');
    if(m){ shareSel.min = +m.dataset.shMin; renderFriends(); return; }
    if(a){ shareSel.approx = a.dataset.shApprox === '1'; renderFriends(); return; }
    if(!b) return;
    b.disabled = true;
    try{
      if(b.dataset.sh === 'start'){ if(await startSharing(shareSel.min, shareSel.approx)) startFriendPolling(); }
      else if(b.dataset.sh === 'stop') await stopSharing('stop');
    }catch(err){ showToast(accErrText(err)); }
    finally{ b.disabled = false; renderFriends(); }
  });
  const ps = document.getElementById('sharePillStop'); if(ps) ps.addEventListener('click', () => stopSharing('stop'));
  setTimeout(() => { shareBootCleanup(); if(!IS_MOBILE && accReady()) friendsOpened(); }, 1500);
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
