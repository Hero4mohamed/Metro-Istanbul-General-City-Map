/* ===========================================================================
   ACCOUNTS (V4.6.3) — email + password, the address confirmed, on Google Firebase
   Asked for as "the ability to make accounts using your email in the app", for Friends (26b-friends.js).
   Design: docs/superpowers/specs/2026-11-14-friends-location-design.md. What matters here:
     * No Firebase SDK: the page may run only its own script (CSP), so this file talks to Firebase's REST endpoints with fetch.
     * No secret key: FIREBASE (03-data.js) is the PUBLIC web config; the data is protected by firebase/firestore.rules.
     * Nothing is sent until someone uses an account: with no project set up (FIREBASE null) or nobody signed in, no request.
     * The password is sent to Firebase over HTTPS and never kept: the device keeps only Firebase's session tokens (irn_account).
     * Friends stays locked until the email address is confirmed (the rules check it too).
     * Delete my account: a fresh sign-in (Firebase requires it), then the data, THEN the account; if the last step fails, the
       app remembers and offers to finish it.
   ========================================================================== */
/* ==ACCOUNT-PURE-START== */
const ACC_KEY = 'irn_account';
const FB_AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:';
const FB_TOKEN = 'https://securetoken.googleapis.com/v1/token';
const FS_ROOT = 'https://firestore.googleapis.com/v1/';
function pwOk(s){ return typeof s === 'string' && s.length >= 8; }
/* one friendship per pair: the two account ids sorted (the rules check the same) */
function pairId(u1, u2){ return u1 < u2 ? u1 + '_' + u2 : u2 + '_' + u1; }
function fsDocPath(projectId, ...segs){ return 'projects/' + projectId + '/databases/(default)/documents' + (segs.length ? '/' + segs.join('/') : ''); }
/* Firestore's typed values, both ways */
function fsVal(v){
  if(v === null || v === undefined) return { nullValue: null };
  if(typeof v === 'boolean') return { booleanValue: v };
  if(typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if(v instanceof Date) return { timestampValue: v.toISOString() };
  return { stringValue: String(v) };
}
function fsEncode(obj){ const fields = {}; for(const k in obj) fields[k] = fsVal(obj[k]); return { fields }; }
function fsUnval(v){
  if(!v) return undefined;
  if('stringValue' in v) return v.stringValue;
  if('integerValue' in v) return Number(v.integerValue);
  if('doubleValue' in v) return v.doubleValue;
  if('booleanValue' in v) return v.booleanValue;
  if('timestampValue' in v) return Date.parse(v.timestampValue);
  if('nullValue' in v) return null;
  return undefined;
}
function fsDecode(doc){
  const o = {}, f = (doc && doc.fields) || {};
  for(const k in f) o[k] = fsUnval(f[k]);
  if(doc && doc.name) o._id = doc.name.split('/').pop();
  if(doc && doc.updateTime) o._updateTime = doc.updateTime;
  return o;
}
/* the claims inside a Firebase ID token (read only to learn whether the email is confirmed; Google checks the token itself) */
function jwtClaims(tok){
  try{ const p = String(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), bin = atob(p + '==='.slice((p.length + 3) % 4));
       return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))); }catch(e){ return {}; }
}
function fbErr(code){ const c = String(code || 'error').toLowerCase(); const e = new Error(c); e.code = c; return e; }
/* ==ACCOUNT-PURE-END== */
/* ==ACCOUNT-CORE-START== */
/* the session: { uid, email, name, verified, refreshToken, idToken, idExp, pendingDelete? }, or null. Never the password. */
var acct = (function(){ const a = lsJSON(ACC_KEY); return a && a.uid && a.refreshToken ? a : null; })();
var accMode = 'signin', accMsg = '', accMsgKind = '', accAskDelete = false;
const accSubs = [], accLeaveHooks = [];
function onAccountChange(fn){ accSubs.push(fn); }
/* run before signing out or deleting the account (the friends file stops sharing here, which erases the stored position) */
function accOnLeave(fn){ accLeaveHooks.push(fn); }
async function accLeave(why){ for(const f of accLeaveHooks){ try{ await f(why); }catch(e){} } }
function accSave(){
  try{
    if(acct) localStorage.setItem(ACC_KEY, JSON.stringify({ uid: acct.uid, email: acct.email, name: acct.name || '', verified: !!acct.verified,
      refreshToken: acct.refreshToken, idToken: acct.idToken, idExp: acct.idExp, pendingDelete: acct.pendingDelete ? true : undefined }));
    else localStorage.removeItem(ACC_KEY);
  }catch(e){}
}
function accChanged(){ accSave(); accSubs.forEach(f => { try{ f(acct); }catch(e){} }); }
function accReady(){ return !!(FIREBASE && acct && acct.verified && !acct.pendingDelete); }
async function fbAuth(method, body){
  if(!FIREBASE) throw fbErr('not_set_up');
  let r;
  try{ r = await fetch(FB_AUTH + method + '?key=' + encodeURIComponent(FIREBASE.apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch(e){ throw fbErr('network'); }
  const j = await r.json().catch(() => ({}));
  if(!r.ok) throw fbErr(String((j.error && j.error.message) || ('HTTP_' + r.status)).split(/[ :]/)[0]);
  return j;
}
function accFromAuth(j, email){
  const keep = acct && acct.uid === j.localId ? acct.name : '';
  acct = { uid: j.localId, email: j.email || email, name: keep || '', verified: jwtClaims(j.idToken).email_verified === true,
           refreshToken: j.refreshToken, idToken: j.idToken, idExp: Date.now() + (+j.expiresIn || 3600) * 1000 };
}
/* a new ID token from the refresh token (an ID token lives one hour) */
async function accRefresh(){
  if(!FIREBASE || !acct) throw fbErr('signed_out');
  let r;
  try{ r = await fetch(FB_TOKEN + '?key=' + encodeURIComponent(FIREBASE.apiKey), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(acct.refreshToken) }); }
  catch(e){ throw fbErr('network'); }
  const j = await r.json().catch(() => ({}));
  if(!r.ok){
    const code = String((j.error && j.error.message) || ('HTTP_' + r.status));
    if(/token_expired|user_disabled|user_not_found|invalid_refresh_token/i.test(code)){ acct = null; accChanged(); }   // signed out elsewhere, or deleted
    throw fbErr(code);
  }
  acct.idToken = j.id_token; acct.refreshToken = j.refresh_token || acct.refreshToken; acct.idExp = Date.now() + (+j.expires_in || 3600) * 1000;
  acct.verified = jwtClaims(j.id_token).email_verified === true;
  accSave();
  return acct.idToken;
}
async function idToken(){
  if(!acct) throw fbErr('signed_out');
  if(!acct.idToken || Date.now() > acct.idExp - 60000) await accRefresh();
  return acct.idToken;
}
/* a Firestore request as the signed-in person. Refused as signed out (401)? Renew the sign-in once and try once more (RF1). */
async function fsFetch(path, opts){
  opts = opts || {};
  const go = tok => fetch(FS_ROOT + path, Object.assign({}, opts, { headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}, { Authorization: 'Bearer ' + tok }) }));
  let r;
  try{
    r = await go(await idToken());
    if(r.status === 401){ await accRefresh(); r = await go(acct.idToken); }
  }catch(e){ if(e && e.code) throw e; throw fbErr('network'); }
  return r;
}
async function fsJSON(r){ const j = await r.json().catch(() => ({})); if(!r.ok) throw fbErr((j && j.error && (j.error.status || j.error.message)) || ('HTTP_' + r.status)); return j; }
const docName = (...segs) => fsDocPath(FIREBASE.projectId, ...segs);
/* how far the server's clock is ahead of this phone's, learnt from each write's commitTime (the rules judge times by the server) */
var serverSkew = 0;
async function fsCommit(writes){
  const j = await fsJSON(await fsFetch(fsDocPath(FIREBASE.projectId) + ':commit', { method: 'POST', body: JSON.stringify({ writes }) }));
  if(j && j.commitTime){ const t = Date.parse(j.commitTime); if(isFinite(t)) serverSkew = t - Date.now(); }
  return j;
}
async function fsQuery(structuredQuery){
  const j = await fsJSON(await fsFetch(fsDocPath(FIREBASE.projectId) + ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery }) }));
  return (Array.isArray(j) ? j : []).filter(x => x && x.document).map(x => fsDecode(x.document));
}
function fsWhereEq(coll, field, value){ return { from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: fsVal(value) } } }; }
async function accSaveProfile(){ await fsCommit([{ update: Object.assign({ name: docName('profiles', acct.uid) }, fsEncode({ name: acct.name })) }]); }
async function accLoadName(){
  const r = await fsFetch(docName('profiles', acct.uid));
  if(r.ok){ const p = fsDecode(await r.json()); if(p.name) acct.name = p.name; }
  else if(r.status === 404 && acct.name) await accSaveProfile();
}
async function accSignUp(email, pw, name){
  email = String(email || '').trim(); name = String(name || '').trim().slice(0, 30);
  if(!pwOk(pw)) throw fbErr('weak_password');
  if(!name) throw fbErr('name_required');
  const j = await fbAuth('signUp', { email, password: pw, returnSecureToken: true });
  accFromAuth(j, email); acct.name = name; accChanged();
  await fbAuth('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: acct.idToken });
  return acct;
}
async function accSignIn(email, pw){
  email = String(email || '').trim();
  const j = await fbAuth('signInWithPassword', { email, password: pw, returnSecureToken: true });
  accFromAuth(j, email);
  if(acct.verified) try{ await accLoadName(); }catch(e){}
  accChanged();
  return acct;
}
/* "I've confirmed": a new token says whether the address is confirmed now; the profile (name only) is written from then on */
async function accRecheckVerified(){
  await accRefresh();
  if(acct.verified){ if(acct.name) await accSaveProfile(); else await accLoadName(); }
  accChanged();
  return acct.verified;
}
async function accSetName(name){ name = String(name || '').trim().slice(0, 30); if(!name) throw fbErr('name_required'); acct.name = name; await accSaveProfile(); accChanged(); }
async function accResendVerify(){ await fbAuth('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: await idToken() }); }
async function accResetPassword(email){ await fbAuth('sendOobCode', { requestType: 'PASSWORD_RESET', email: String(email || '').trim() }); }
async function accSignOut(){
  await accLeave('signout');
  acct = null; accChanged();
}
/* Everything about you, then the account. Firebase deletes an account only right after a sign-in, hence the password. */
async function accDelete(pw){
  const email = acct.email, name = acct.name;
  const j = await fbAuth('signInWithPassword', { email, password: pw, returnSecureToken: true });
  accFromAuth(j, email); acct.name = name;
  let fr = [], inv = [];
  if(acct.verified){                       // an unconfirmed account cannot have stored anything (the rules refuse it)
    await accLeave('delete');
    const me = acct.uid;
    fr = (await fsQuery(fsWhereEq('friendships', 'a', me))).concat(await fsQuery(fsWhereEq('friendships', 'b', me)));
    inv = await fsQuery(fsWhereEq('invites', 'from', me));
    await fsCommit([{ delete: docName('locations', me) }]
      .concat(fr.map(f => ({ delete: docName('friendships', f._id) })), inv.map(i => ({ delete: docName('invites', i._id) })), [{ delete: docName('profiles', me) }]));
  }
  try{ await fbAuth('delete', { idToken: acct.idToken }); }
  catch(e){ acct.pendingDelete = true; accChanged(); throw e; }
  acct = null; accChanged();
  return { friendships: fr.length, invites: inv.length };
}
function accErrText(e){
  const c = (e && e.code) || '';
  const k = { email_exists: 'accErrExists', invalid_login_credentials: 'accErrLogin', invalid_password: 'accErrLogin', email_not_found: 'accErrLogin',
              weak_password: 'accErrWeak', too_many_attempts_try_later: 'accErrMany', name_required: 'accErrName', invalid_email: 'accErrEmail',
              missing_email: 'accErrEmail', missing_password: 'accErrLogin', network: 'accErrNet', not_set_up: 'accNotSetUp' }[c];
  return k ? t(k) : t('accErrGeneric').replace('{code}', c || '?');
}
/* the account box, for the current state (Settings › You, and the Friends sheet). Every value from outside is escaped. */
function accViewHTML(){
  const msg = accMsg ? '<div class="acc-msg' + (accMsgKind ? ' ' + accMsgKind : '') + '" role="status">' + svgEsc(accMsg) + '</div>' : '';
  const btn = (act, key, cls) => '<button type="button" class="' + (cls || 'btn') + '" data-acc="' + act + '">' + svgEsc(t(key)) + '</button>';
  const ph = key => ' placeholder="' + attrEsc(t(key)) + '" aria-label="' + attrEsc(t(key)) + '">';
  const EMAIL = '<input class="acc-in acc-email" type="email" autocomplete="email" maxlength="200"' + ph('accEmail');
  const PW_NEW = '<input class="acc-in acc-pw" type="password" autocomplete="new-password" minlength="8"' + ph('accPassword');
  const PW = '<input class="acc-in acc-pw" type="password" autocomplete="current-password"' + ph('accPassword');
  const NAME = '<input class="acc-in acc-name" type="text" autocomplete="nickname" maxlength="30"' + ph('accName');
  if(!FIREBASE) return '<p class="sp-hint">' + svgEsc(t('accNotSetUp')) + '</p>';
  if(!acct){
    const up = accMode === 'signup';
    return '<div class="acc-form">' + EMAIL + (up ? PW_NEW + NAME : PW)
      + '<div class="acc-acts">' + (up ? btn('signup', 'accSignUp') : btn('signin', 'accSignIn')) + '</div>'
      + '<div class="acc-links">' + btn(up ? 'mode-signin' : 'mode-signup', up ? 'accHaveAccount' : 'accNoAccount', 'acc-link')
      + (up ? '' : btn('forgot', 'accForgot', 'acc-link')) + '</div>' + msg
      + '<p class="sp-hint">' + svgEsc(t('accPrivacy')) + '</p></div>';
  }
  if(acct.pendingDelete) return '<div class="acc-form"><p>' + svgEsc(t('accDeletePending')) + '</p>' + PW
    + '<div class="acc-acts">' + btn('delete-go', 'accRetry') + '</div>' + msg + '</div>';
  if(!acct.verified) return '<div class="acc-form"><p>' + svgEsc(t('accCheckEmail').replace('{email}', acct.email)) + '</p>'
    + '<div class="acc-acts">' + btn('recheck', 'accConfirmed') + btn('resend', 'accResend', 'btn ghost') + '</div>'
    + '<div class="acc-links">' + btn('signout', 'accSignOut', 'acc-link') + '</div>' + msg + '</div>';
  if(!acct.name) return '<div class="acc-form"><p>' + svgEsc(t('accNameNeeded')) + '</p>' + NAME
    + '<div class="acc-acts">' + btn('setname', 'accSaveName') + '</div>' + msg + '</div>';
  return '<div class="acc-form"><p class="acc-who">' + svgEsc(t('accSignedIn')).replace('{name}', '<b>' + svgEsc(acct.name) + '</b>') + '<small>' + svgEsc(acct.email) + '</small></p>'
    + '<div class="acc-acts">' + btn('signout', 'accSignOut', 'btn ghost') + btn('delete-ask', 'accDelete', 'btn danger') + '</div>'
    + (accAskDelete ? '<div class="acc-del"><p>' + svgEsc(t('accDeleteAsk')) + '</p>' + PW
        + '<div class="acc-acts">' + btn('delete-go', 'accDeleteGo', 'btn danger') + btn('delete-cancel', 'accCancel', 'btn ghost') + '</div></div>' : '')
    + msg + '</div>';
}
/* ==ACCOUNT-CORE-END== */
function renderAccount(){ document.querySelectorAll('.acc-box').forEach(b => { b.innerHTML = accViewHTML(); }); }
function accSay(key, kind, raw){ accMsg = raw != null ? raw : t(key); accMsgKind = kind || ''; renderAccount(); }
(function(){
  onAccountChange(() => { accAskDelete = false; renderAccount(); });
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-acc]'); if(!b) return;
    const box = b.closest('.acc-box'), val = c => { const i = box && box.querySelector('.' + c); return i ? i.value : ''; };
    const act = b.dataset.acc;
    if(act === 'mode-signup' || act === 'mode-signin'){ accMode = act === 'mode-signup' ? 'signup' : 'signin'; accMsg = ''; renderAccount(); return; }
    if(act === 'delete-ask'){ accAskDelete = true; accMsg = ''; renderAccount(); return; }
    if(act === 'delete-cancel'){ accAskDelete = false; renderAccount(); return; }
    b.disabled = true;
    try{
      if(act === 'signup'){ await accSignUp(val('acc-email'), val('acc-pw'), val('acc-name')); accSay('accSentConfirm', 'ok'); }
      else if(act === 'signin'){ await accSignIn(val('acc-email'), val('acc-pw')); accMsg = ''; renderAccount(); }
      else if(act === 'forgot'){ if(!val('acc-email')) return accSay('accErrEmail', 'err'); await accResetPassword(val('acc-email')); accSay('accResetSent', 'ok'); }
      else if(act === 'resend'){ await accResendVerify(); accSay('accSentConfirm', 'ok'); }
      else if(act === 'recheck'){ accSay(await accRecheckVerified() ? 'accNowConfirmed' : 'accNotYet', ''); }
      else if(act === 'setname'){ await accSetName(val('acc-name')); accMsg = ''; renderAccount(); }
      else if(act === 'signout'){ await accSignOut(); accMsg = ''; renderAccount(); }
      else if(act === 'delete-go'){
        const r = await accDelete(val('acc-pw'));
        accSay(null, 'ok', t('accDeleted').replace('{f}', r.friendships).replace('{i}', r.invites));
      }
    }catch(err){ accSay(null, 'err', accErrText(err)); }
    finally{ b.disabled = false; }
  });
  renderAccount();
})();
