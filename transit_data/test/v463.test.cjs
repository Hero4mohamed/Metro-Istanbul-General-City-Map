'use strict';
/* V4.6.3: accounts (email + password, address confirmed), friends added through one-time links, and location sharing that only
 * accepted friends can see, for a chosen time. The safety lives in two places, and both are tested here:
 *   - firebase/firestore.rules, which Google's servers apply to every read and write (its text is checked here; its behaviour is
 *     checked live by firebase/rules-check.cjs once the project exists);
 *   - the REAL built app code (run in a sandbox with a fake network). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const RULES_PATH = path.join(H.ROOT, 'firebase', 'firestore.rules');
const rules = () => fs.readFileSync(RULES_PATH, 'utf8').replace(/\r\n/g, '\n');
/* the text of one `match /<coll>/{...} { ... }` block */
function block(coll) {
  const s = rules(), i = s.indexOf('match /' + coll + '/');
  assert.ok(i > 0, 'no rules for ' + coll);
  let j = s.indexOf('{', s.indexOf('}', i) + 1), depth = 0;   // skip the {id} wildcard, then take the braces of the block
  for (let k = j; k < s.length; k++) { if (s[k] === '{') depth++; else if (s[k] === '}' && --depth === 0) return s.slice(i, k + 1); }
  throw new Error('unbalanced rules block ' + coll);
}

/* ---------------------------------------------------------------- rules ---- */
test('rules: version 2, a confirmed-email check, and everything not named is denied', () => {
  const s = rules();
  assert.match(s, /rules_version = '2';/);
  assert.match(s, /function verified\(\)\s*\{\s*return request\.auth != null && request\.auth\.token\.email_verified == true;\s*\}/, 'no confirmed-email check');
  assert.match(s, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/, 'what is not named is not denied');
});
test('rules: every allow (but the final deny) needs a signed-in person with a confirmed email', () => {
  const allows = rules().split('\n').filter(l => /^\s*allow /.test(l) && !/if false;/.test(l));
  assert.ok(allows.length >= 8, 'too few rules: ' + allows.length);
  allows.forEach(l => assert.match(l, /verified\(\)/, 'a rule lets in an unconfirmed or signed-out person: ' + l.trim()));
});
test('rules: a location is seen by a friend only while its time runs and while the app is still sending (3 min)', () => {
  const b = block('locations');
  assert.match(b, /resource\.data\.until > request\.time/, 'a friend sees the location after its time is up');
  assert.match(b, /resource\.data\.at > request\.time - duration\.value\(3, 'm'\)/, 'a friend sees the location of a closed app');
  assert.match(b, /isFriend\(uid\)/, 'friendship is not checked');
  assert.match(b, /request\.resource\.data\.until <= request\.time \+ duration\.value\(8, 'h'\)/, 'sharing can last longer than 8 hours');
  assert.match(b, /request\.resource\.data\.at == request\.time/, 'the time of a position is not the server\'s');
  assert.match(b, /request\.resource\.data\.keys\(\)\.hasOnly\(\['lat', 'lng', 'acc', 'approx', 'at', 'until'\]\)/, 'a location can carry other fields');
  assert.match(b, /allow write: if verified\(\) && request\.auth\.uid == uid/, 'someone else can write your location');
});
test('rules: a friendship is made only by its acceptor, from an invite claimed in the same write, and is never changed', () => {
  const b = block('friendships');
  assert.match(b, /getAfter\(/, 'the invite claim is not checked in the same write');
  assert.match(b, /request\.auth\.uid == request\.resource\.data\.acceptor/);
  assert.match(b, /request\.resource\.data\.a < request\.resource\.data\.b/, 'the pair is not sorted (Remove could leave a second friendship)');
  assert.match(b, /allow update: if false;/);
  assert.match(b, /\.expires > request\.time/, 'an expired invite still makes a friendship');
});
test('rules: an invite lasts at most 48 hours, is claimed once, never by its maker', () => {
  const b = block('invites');
  assert.match(b, /duration\.value\(48, 'h'\)/);
  assert.match(b, /resource\.data\.usedBy == null/, 'an invite can be claimed twice');
  assert.match(b, /resource\.data\.from != request\.auth\.uid/, 'you can accept your own invite');
  assert.match(b, /affectedKeys\(\)\.hasOnly\(\['usedBy'\]\)/, 'claiming can change other fields');
});
test('rules: a profile holds only a name of 1 to 30 characters, written only by its owner', () => {
  const b = block('profiles');
  assert.match(b, /request\.resource\.data\.keys\(\)\.hasOnly\(\['name'\]\)/);
  assert.match(b, /request\.resource\.data\.name\.size\(\) >= 1 && request\.resource\.data\.name\.size\(\) <= 30/);
  assert.match(b, /allow write: if verified\(\) && request\.auth\.uid == uid/);
});

/* --------------------------------------------------------------- config ---- */
const csp = () => /Content-Security-Policy" content="([^"]+)"/.exec(H.html())[1];
const connectSrc = () => /(?:^|;\s*)connect-src\s([^;]*)/.exec(csp())[1].trim().split(/\s+/);
const FB_HOSTS = ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://firestore.googleapis.com'];
test('config: the security policy lets the app reach exactly the three Firebase addresses it uses, and loads no Google script', () => {
  const cs = connectSrc();
  FB_HOSTS.forEach(h => assert.ok(cs.includes(h), 'connect-src lacks ' + h));
  assert.strictEqual(cs.filter(h => /google|firebase/.test(h)).length, 3, 'connect-src allows another Google address: ' + cs.join(' '));
  assert.ok(!/google|firebase|gstatic/.test(/(?:^|;\s*)script-src\s([^;]*)/.exec(csp())[1]), 'a Google script is allowed');
});
test('config: the app carries only the PUBLIC web config (apiKey, projectId) or none, and no secret key exists anywhere', () => {
  const m = /const FIREBASE = (null|\{[^;\n]*\});/.exec(H.appScript());
  assert.ok(m, 'the Firebase config slot is missing');
  if (m[1] !== 'null') assert.deepStrictEqual(Object.keys(JSON.parse(m[1])).sort(), ['apiKey', 'projectId'], 'the config holds more than the public fields');
  const look = [H.html()];
  for (const f of ['transit_data/firebase-config.json', 'firebase/firestore.rules', 'firebase/README.md']) if (H.exists(f)) look.push(H.read(f));
  look.forEach(s => { assert.ok(!/private_key|"type"\s*:\s*"service_account"|client_secret/.test(s), 'a secret key is in the app or the repo'); });
});
test('config: the build refuses a Firebase config with anything but apiKey and projectId', () => {
  const b = H.read('transit_data/build.cjs');
  assert.match(b, /firebase-config\.json/);
  assert.match(b, /FIREBASE config may hold only apiKey and projectId/, 'the build does not check the config');
});
test('config: storage and privacy pages name the account data, Google, who can see it, and the app asks its privacy question again', () => {
  const { HOSTS, STORAGE } = require('../legal-content.cjs');
  assert.ok(STORAGE.some(r => r.key === 'irn_account'), 'the storage page does not list the session');
  const fb = HOSTS.find(h => h.hosts.includes('firestore.googleapis.com'));
  assert.ok(fb && fb.optional, 'Firebase is not listed as an optional service');
  FB_HOSTS.forEach(h => assert.ok(fb.hosts.includes(h.replace('https://', '')), 'privacy page does not name ' + h));
  const cfg = JSON.parse(H.read('transit_data/legal-config.json'));
  assert.strictEqual(cfg.policyVersion, '3', 'the app will not ask its privacy question again');
  assert.strictEqual(cfg.appVersion, 'V4.6.3');
  const en = H.read('legal/privacy.html'), tr = H.read('legal/privacy.tr.html');
  assert.ok(!/No accounts, no sign-up/.test(en), 'the privacy page still says there are no accounts');
  assert.match(en, /<h2 id="accounts">/); assert.match(tr, /<h2 id="accounts">/);
  assert.match(en, /Firebase console/, 'the page does not say the author can see account data in the Firebase console');
  assert.match(en, /3 minutes/); assert.match(en, /8 hours/);
  assert.ok(!/has no accounts/.test(H.i18n ? JSON.stringify(H.i18n()) : H.appScript().match(/privBody:"[^"]*"/)[0]), 'the privacy question still says the app has no accounts');
});

/* -------------------------------------------------------------- account ---- */
const vm = require('node:vm');
const APP = () => H.appScript().replace(/\r\n/g, '\n');
function region(name) {
  const s = APP(), a = s.indexOf('/* ==' + name + '-START== */'), b = s.indexOf('/* ==' + name + '-END== */');
  assert.ok(a > 0 && b > a, 'the ' + name + ' block is missing');
  return s.slice(a, b);
}
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = claims => b64u({ alg: 'none' }) + '.' + b64u(claims) + '.sig';
/* A sandbox running the real account code against a fake Firebase. `routes(url, body, method)` returns [status, json]. */
function accWorld(routes, opts = {}) {
  const calls = [], store = Object.assign({}, opts.store || {});
  const ctx = {
    FIREBASE: opts.noConfig ? null : { apiKey: 'AIzaTESTTESTTESTTESTTESTTESTTEST', projectId: 'turkmaps-test' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    atob: s => Buffer.from(s, 'base64').toString('binary'), TextDecoder, decodeURIComponent, encodeURIComponent,
    t: k => k, svgEsc: s => (s == null ? '' : '' + s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    attrEsc: s => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    fetch: async (url, o = {}) => {
      const body = o.body && /json/.test((o.headers || {})['Content-Type'] || '') ? JSON.parse(o.body) : o.body;
      calls.push({ url, method: o.method || 'GET', body, auth: (o.headers || {}).Authorization });
      const [status, json] = routes(url, body, o.method || 'GET', calls.length) || [404, {}];
      return { ok: status >= 200 && status < 300, status, json: async () => json };
    },
  };
  ctx.lsJSON = k => { try { return JSON.parse(ctx.localStorage.getItem(k)); } catch (e) { return null; } };
  Object.assign(ctx, opts.extra || {});
  vm.createContext(ctx);
  vm.runInContext(region('ACCOUNT-PURE') + region('ACCOUNT-CORE') + (opts.more || '')
    + '\nthis.api = { get acct(){ return acct; }, set acct(v){ acct = v; }, pwOk, pairId, fsEncode, fsDecode, fsDocPath, fsFetch, fsCommit, fsQuery, accSignUp, accSignIn, accRecheckVerified, accDelete, accReady, accViewHTML, idToken };'
    + (opts.expose || ''), ctx);
  return { api: ctx.api, calls, store, ctx };
}
const signedUp = (verified) => [200, { localId: 'uidA', email: 'a@x.test', idToken: jwt({ email_verified: !!verified }), refreshToken: 'r1', expiresIn: '3600' }];
const SESSION = verified => ({ irn_account: JSON.stringify({ uid: 'uidA', email: 'a@x.test', name: 'Ayşe', verified, refreshToken: 'r1', idToken: jwt({ email_verified: verified }), idExp: Date.now() + 3600e3 }) });
const REFRESHED = [200, { id_token: jwt({ email_verified: true }), refresh_token: 'r2', expires_in: '3600' }];

test('account: Firestore values are written and read back with their types; pairs are sorted; passwords need 8 characters', () => {
  const { api } = accWorld(() => null);
  const e = api.fsEncode({ a: 'x', n: 3, d: 1.5, b: true, z: null });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e)), { fields: { a: { stringValue: 'x' }, n: { integerValue: '3' }, d: { doubleValue: 1.5 }, b: { booleanValue: true }, z: { nullValue: null } } });
  const d = api.fsDecode({ name: 'projects/p/databases/(default)/documents/profiles/u1', fields: e.fields });
  assert.deepStrictEqual([d.a, d.n, d.d, d.b, d.z, d._id], ['x', 3, 1.5, true, null, 'u1']);
  assert.strictEqual(api.pairId('b', 'a'), 'a_b'); assert.strictEqual(api.pairId('a', 'b'), 'a_b');
  assert.strictEqual(api.pwOk('1234567'), false); assert.strictEqual(api.pwOk('12345678'), true);
});
test('account: signing up asks Firebase to email a confirmation link, keeps no password, and writes nothing until confirmed', async () => {
  const w = accWorld(url => /accounts:signUp/.test(url) ? signedUp(false) : /accounts:sendOobCode/.test(url) ? [200, {}] : null);
  await w.api.accSignUp('a@x.test', 'correct horse', 'Ayşe');
  assert.deepStrictEqual(w.calls.map(c => c.url.replace(/\?.*/, '')), ['https://identitytoolkit.googleapis.com/v1/accounts:signUp', 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode']);
  assert.strictEqual(w.calls[1].body.requestType, 'VERIFY_EMAIL');
  assert.ok(!/correct horse/.test(w.store.irn_account) && !/password/i.test(w.store.irn_account), 'the password is kept on the device');
  assert.strictEqual(w.api.accReady(), false, 'an unconfirmed account can use Friends');
  await assert.rejects(w.api.accSignUp('b@x.test', 'short', 'B'), /weak_password/);
});
test('account: once the email is confirmed, the name is saved as the only field of the profile', async () => {
  const w = accWorld(url => /securetoken/.test(url) ? REFRESHED : /:commit/.test(url) ? [200, {}] : null, { store: SESSION(false) });
  assert.strictEqual(await w.api.accRecheckVerified(), true);
  const c = w.calls.find(x => /:commit/.test(x.url));
  assert.ok(c, 'the profile is not saved');
  assert.strictEqual(c.body.writes.length, 1);
  assert.match(c.body.writes[0].update.name, /\/documents\/profiles\/uidA$/);
  assert.deepStrictEqual(Object.keys(c.body.writes[0].update.fields), ['name']);
  assert.strictEqual(w.api.accReady(), true);
});
test('account (RF1): an expired sign-in is renewed once and the request retried once; a second refusal is an error, not a loop', async () => {
  let n = 0;
  const w = accWorld(url => /securetoken/.test(url) ? REFRESHED : /:commit/.test(url) ? (++n === 1 ? [401, {}] : [200, {}]) : null, { store: SESSION(true) });
  await w.api.fsCommit([]);
  assert.strictEqual(w.calls.filter(c => /securetoken/.test(c.url)).length, 1);
  assert.strictEqual(w.calls.filter(c => /:commit/.test(c.url)).length, 2);
  const w2 = accWorld(url => /securetoken/.test(url) ? REFRESHED : /:commit/.test(url) ? [401, { error: { status: 'UNAUTHENTICATED' } }] : null, { store: SESSION(true) });
  await assert.rejects(w2.api.fsCommit([]));
  assert.strictEqual(w2.calls.filter(c => /:commit/.test(c.url)).length, 2, 'it retried more than once');
});
test('account: deleting signs in again, removes the data (position, friendships, links, profile) BEFORE the account', async () => {
  const doc = (coll, id) => ({ document: { name: 'projects/turkmaps-test/databases/(default)/documents/' + coll + '/' + id, fields: {} } });
  const w = accWorld((url, body) => /signInWithPassword/.test(url) ? signedUp(true)
    : /:runQuery/.test(url) ? [200, body.structuredQuery.from[0].collectionId === 'friendships' ? (body.structuredQuery.where.fieldFilter.field.fieldPath === 'a' ? [doc('friendships', 'uidA_uidB')] : []) : [doc('invites', 'f'.repeat(32))]]
    : /:commit/.test(url) ? [200, {}] : /accounts:delete/.test(url) ? [200, {}] : null, { store: SESSION(true) });
  const r = await w.api.accDelete('correct horse');
  const seq = w.calls.map(c => c.url.replace(/\?.*/, ''));
  assert.match(seq[0], /accounts:signInWithPassword$/);
  const iCommit = seq.findIndex(s => /:commit$/.test(s)), iDel = seq.findIndex(s => /accounts:delete$/.test(s));
  assert.ok(iCommit >= 0 && iDel > iCommit, 'the account is deleted before its data');
  const commit = w.calls[iCommit].body.writes.map(x => x.delete.replace(/^.*documents\//, ''));
  assert.deepStrictEqual(commit, ['locations/uidA', 'friendships/uidA_uidB', 'invites/' + 'f'.repeat(32), 'profiles/uidA']);
  assert.strictEqual(w.api.acct, null); assert.ok(!('irn_account' in w.store), 'the session stays on the device');
  assert.deepStrictEqual({ ...r }, { friendships: 1, invites: 1 });
});
test('account: if deleting the account itself fails, the data is already gone and the app remembers to finish it', async () => {
  const w = accWorld(url => /signInWithPassword/.test(url) ? signedUp(true) : /:runQuery/.test(url) ? [200, []]
    : /:commit/.test(url) ? [200, {}] : /accounts:delete/.test(url) ? [500, { error: { message: 'INTERNAL' } }] : null, { store: SESSION(true) });
  await assert.rejects(w.api.accDelete('correct horse'));
  assert.ok(w.calls.some(c => /:commit/.test(c.url)), 'the data was not deleted first');
  assert.strictEqual(JSON.parse(w.store.irn_account).pendingDelete, true, 'the unfinished deletion is forgotten');
});
test('account: with no Firebase project set up, nothing is sent and Friends says it is not set up', () => {
  const w = accWorld(() => [200, {}], { noConfig: true, store: SESSION(true) });
  assert.strictEqual(w.calls.length, 0); assert.strictEqual(w.api.accReady(), false);
  assert.match(w.api.accViewHTML(), /accNotSetUp/);
});
test('account: the name a person chose is shown escaped, so it cannot inject anything', () => {
  const w = accWorld(() => null, { extra: { t: k => k + ' {name}' }, store: { irn_account: JSON.stringify({ uid: 'uidA', email: 'a@x.test', name: '<img src=x onerror=alert(1)>', verified: true, refreshToken: 'r', idToken: 'x', idExp: Date.now() + 3e6 }) } });
  const h = w.api.accViewHTML();
  assert.ok(!/<img/i.test(h), 'a name injected markup'); assert.match(h, /&lt;img src=x/);
});

/* -------------------------------------------------------------- friends ---- */
function friendsWorld(routes, opts = {}) {
  const ui = { shown: [], said: [], needAccount: 0 }, sess = {};
  const extra = Object.assign({
    sessionStorage: { getItem: k => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = String(v); }, removeItem: k => { delete sess[k]; } },
    inviteUI: { show: inv => ui.shown.push(inv), say: k => ui.said.push(k), needAccount: () => { ui.needAccount++; } },
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } },
    renderFriends: () => {},
  }, opts.extra || {});
  const w = accWorld(routes, Object.assign({}, opts, { extra, more: '\n' + region('FRIENDS-PURE') + region('FRIENDS-CORE'),
    expose: '\nthis.fr = { newInviteId, parseInviteHash, inviteLink, acceptWrites, openInvite, acceptInvite, removeFriend, makeInvite, friendsViewHTML, get friends(){ return friends; }, set friends(v){ friends = v; }, fireAccount: () => accChanged() };' }));
  return Object.assign(w, { ui, sess, fr: w.ctx.fr });
}
const INV_ID = 'ab'.repeat(16);
const invDoc = (over = {}) => ({ name: 'projects/turkmaps-test/databases/(default)/documents/invites/' + INV_ID, updateTime: '2026-11-14T10:00:00.000000Z',
  fields: Object.assign({ from: { stringValue: 'uidB' }, fromName: { stringValue: 'Bora' }, usedBy: { nullValue: null }, expires: { timestampValue: new Date(Date.now() + 3600e3).toISOString() } }, over) });

test('friends: a link id is 32 hex characters (128 random bits), and only a well-formed #invite= link is read', () => {
  const { fr } = friendsWorld(() => null);
  const id = fr.newInviteId(new Uint8Array(16).map((_, i) => i));
  assert.strictEqual(id, '000102030405060708090a0b0c0d0e0f');
  assert.strictEqual(fr.parseInviteHash('#invite=' + 'a'.repeat(32)), 'a'.repeat(32));
  for (const bad of ['#invite=xyz', '#invite=' + 'g'.repeat(32), '#invite=' + 'a'.repeat(33), '', '#invite=', null]) assert.strictEqual(fr.parseInviteHash(bad), null, String(bad));
  assert.strictEqual(fr.inviteLink('https://h.io/app/?city=istanbul#old', 'c'.repeat(32)), 'https://h.io/app/?city=istanbul#invite=' + 'c'.repeat(32));
});
test('friends: accepting is ONE write that claims the link (only if unchanged since read) and creates the sorted friendship (only if new)', () => {
  const { fr, api } = friendsWorld(() => null, { store: SESSION(true) });
  const inv = api.fsDecode(invDoc());
  const w = fr.acceptWrites('turkmaps-test', inv, 'uidA');
  assert.strictEqual(w.length, 2);
  assert.match(w[0].update.name, /\/invites\/(ab){16}$/); assert.deepStrictEqual([...w[0].updateMask.fieldPaths], ['usedBy']);
  assert.strictEqual(w[0].update.fields.usedBy.stringValue, 'uidA'); assert.strictEqual(w[0].currentDocument.updateTime, '2026-11-14T10:00:00.000000Z');
  assert.match(w[1].update.name, /\/friendships\/uidA_uidB$/);
  const f = api.fsDecode(w[1].update);
  assert.deepStrictEqual([f.a, f.b, f.inviter, f.acceptor, f.invite], ['uidA', 'uidB', 'uidB', 'uidA', INV_ID]);
  assert.strictEqual(w[1].currentDocument.exists, false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w[1].updateTransforms)), [{ fieldPath: 'created', setToServerValue: 'REQUEST_TIME' }]);
});
test('friends (RF4): a link opened before signing in waits for the account to be ready, then asks; nothing is written before Accept', async () => {
  const w = friendsWorld(url => /securetoken/.test(url) ? REFRESHED : /\/invites\//.test(url) ? [200, invDoc()] : /:commit/.test(url) ? [200, {}] : null);
  await w.fr.openInvite(INV_ID);
  assert.strictEqual(w.ui.needAccount, 1); assert.strictEqual(w.sess.irn_pending_invite, INV_ID);
  assert.strictEqual(w.calls.length, 0, 'something was sent before signing in');
  w.api.acct = JSON.parse(SESSION(true).irn_account); w.fr.fireAccount();
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(w.ui.shown.length, 1, 'the Accept question did not come after signing in'); assert.strictEqual(w.ui.shown[0]._id, INV_ID);
  assert.ok(!w.calls.some(c => /:commit/.test(c.url)), 'the link was accepted without pressing Accept');
  await w.fr.acceptInvite(w.ui.shown[0]);
  assert.ok(w.calls.some(c => /:commit/.test(c.url))); assert.ok(!('irn_pending_invite' in w.sess));
});
test('friends: your own, used or expired links are refused before anything is written', async () => {
  for (const [over, me] of [[{ from: { stringValue: 'uidA' } }, 'own'], [{ usedBy: { stringValue: 'uidC' } }, 'used'], [{ expires: { timestampValue: new Date(Date.now() - 1000).toISOString() } }, 'expired']]) {
    const w = friendsWorld(url => /\/invites\//.test(url) ? [200, invDoc(over)] : null, { store: SESSION(true) });
    await w.fr.openInvite(INV_ID);
    assert.strictEqual(w.ui.shown.length, 0, me + ' link was offered'); assert.ok(w.ui.said.length === 1, me + ' link gave no message');
  }
});
test('friends: removing a friend deletes exactly your one friendship document', async () => {
  const w = friendsWorld(url => /:commit/.test(url) ? [200, {}] : /:runQuery/.test(url) ? [200, []] : null, { store: SESSION(true) });
  await w.fr.removeFriend('uid0');
  const c = w.calls.find(x => /:commit/.test(x.url));
  assert.deepStrictEqual(c.body.writes.map(x => x.delete.replace(/^.*documents\//, '')), ['friendships/uid0_uidA']);
});
test('friends: a new link expires within 48 hours, carries your chosen name, and its time is the server\'s', async () => {
  const w = friendsWorld(url => /:commit/.test(url) ? [200, {}] : null, { store: SESSION(true) });
  const link = await w.fr.makeInvite('https://h.io/app/');
  const c = w.calls.find(x => /:commit/.test(x.url)).body.writes[0];
  const f = w.api.fsDecode(c.update);
  assert.match(link, /^https:\/\/h\.io\/app\/#invite=[0-9a-f]{32}$/);
  assert.deepStrictEqual([f.from, f.fromName, f.usedBy], ['uidA', 'Ayşe', null]);
  assert.ok(f.expires - Date.now() <= 48 * 3600e3 && f.expires - Date.now() > 46 * 3600e3, 'the link lasts longer than 48 h or much less');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.updateTransforms)), [{ fieldPath: 'created', setToServerValue: 'REQUEST_TIME' }]);
  assert.strictEqual(c.currentDocument.exists, false);
});
test('friends: a friend\'s name is escaped in the list, so it cannot inject anything', () => {
  const w = friendsWorld(() => null, { store: SESSION(true) });
  w.fr.friends = [{ uid: 'uidB', name: '<img src=x onerror=alert(1)>', sharing: false }];
  const h = w.fr.friendsViewHTML();
  assert.ok(!/<img/i.test(h)); assert.match(h, /&lt;img src=x/);
});
