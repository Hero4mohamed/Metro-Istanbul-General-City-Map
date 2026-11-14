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

/* -------------------------------------------------------------- sharing ---- */
function shareWorld(routes, opts = {}) {
  const sh = { said: [], shown: 0, hidden: 0, drawn: null }, geo = { watching: 0, cleared: 0, ok: null, err: null };
  const extra = Object.assign({
    navigator: { geolocation: { watchPosition: (ok, err) => { geo.watching++; geo.ok = ok; geo.err = err; return 7; }, clearWatch: () => { geo.cleared++; } } },
    setInterval: () => 9, clearInterval: () => {},
    shareUI: { show: () => { sh.shown++; }, hide: () => { sh.hidden++; }, say: k => sh.said.push(k), drawFriends: list => { sh.drawn = list.map(f => ({ uid: f.uid, pos: f.pos })); } },
  }, opts.extra || {});
  const w = friendsWorld(routes, Object.assign({}, opts, { extra }));
  vm.runInContext(region('SHARE-PURE') + region('SHARE-CORE')
    + '\nthis.sh = { SHARE_DURATIONS, approxPos, posMeters, shouldSend, locationWrite, startSharing, stopSharing, pollFriends, shareBootCleanup, shareViewHTML, get sharing(){ return sharing; } };', w.ctx);
  return Object.assign(w, { sh: w.ctx.sh, shUI: sh, geo });
}
const POS = (lat, lng, acc = 12) => ({ coords: { latitude: lat, longitude: lng, accuracy: acc } });

test('sharing: only 15 minutes, 1 hour or 8 hours; nothing longer, nothing in between', async () => {
  const w = shareWorld(url => /:commit/.test(url) ? [200, {}] : null, { store: SESSION(true) });
  assert.deepStrictEqual([...w.sh.SHARE_DURATIONS], [15, 60, 480]);
  await assert.rejects(w.sh.startSharing(30, false)); await assert.rejects(w.sh.startSharing(1440, false));
  assert.strictEqual(w.geo.watching, 0, 'the location was asked for a refused duration');
  const p = w.sh.startSharing(480, false); w.geo.ok(POS(41.0123456, 28.9876543)); await p;
  assert.ok(Math.abs(w.sh.sharing.until - (Date.now() + 480 * 60e3)) < 5000);
});
test('sharing: Approximate rounds to about 1 km ON THE PHONE; the exact numbers are never sent', async () => {
  const w = shareWorld(url => /:commit/.test(url) ? [200, {}] : null, { store: SESSION(true) });
  assert.deepStrictEqual([...w.sh.approxPos(41.012345, 28.987654)], [41.01, 28.99]);
  const p = w.sh.startSharing(60, true); w.geo.ok(POS(41.012345, 28.987654)); await p;
  const sent = JSON.stringify(w.calls.filter(c => /:commit/.test(c.url)).map(c => c.body));
  assert.ok(sent.length > 0 && !/41\.0123|28\.9876/.test(sent), 'the exact position left the phone: ' + sent);
});
test('sharing: a position is sent when moved more than 25 m, at least every 2 minutes, never more often than every 30 s', () => {
  const { sh } = shareWorld(() => null);
  const at = (lat, lng) => ({ lat, lng }), t0 = 1e12, last = { t: t0, pos: at(41, 29) }, m = d => at(41 + d / 111320, 29);
  assert.strictEqual(sh.shouldSend(null, t0, at(41, 29)), true);
  assert.strictEqual(sh.shouldSend(last, t0 + 10e3, m(100)), false);
  assert.strictEqual(sh.shouldSend(last, t0 + 31e3, m(30)), true);
  assert.strictEqual(sh.shouldSend(last, t0 + 60e3, m(10)), false);
  assert.strictEqual(sh.shouldSend(last, t0 + 121e3, m(0)), true);
  assert.ok(Math.abs(sh.posMeters(at(41, 29), m(100)) - 100) < 1);
});
test('sharing: the stored position carries only lat, lng, acc, approx and until, and its time is set by the server', () => {
  const { sh } = shareWorld(() => null);
  const w = sh.locationWrite('turkmaps-test', 'uidA', { lat: 41.5, lng: 29.25, acc: 12.7 }, false, Date.UTC(2026, 10, 14, 12));
  assert.match(w.update.name, /\/documents\/locations\/uidA$/);
  assert.deepStrictEqual(Object.keys(w.update.fields).sort(), ['acc', 'approx', 'lat', 'lng', 'until']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.updateTransforms)), [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }]);
  assert.strictEqual(w.update.fields.until.timestampValue, '2026-11-14T12:00:00.000Z');
});
test('sharing: Stop deletes the stored position, stops watching and hides the sign; signing out does the same', async () => {
  const w = shareWorld(url => /:commit/.test(url) ? [200, {}] : null, { store: SESSION(true) });
  const p = w.sh.startSharing(15, false); w.geo.ok(POS(41, 29)); await p;
  assert.strictEqual(w.shUI.shown, 1, 'the Sharing sign did not show');
  await w.sh.stopSharing('stop');
  assert.strictEqual(w.sh.sharing, null); assert.strictEqual(w.geo.cleared, 1); assert.ok(w.shUI.hidden >= 1);
  const last = w.calls.filter(c => /:commit/.test(c.url)).pop();
  assert.deepStrictEqual(last.body.writes.map(x => x.delete && x.delete.replace(/^.*documents\//, '')), ['locations/uidA']);
  const p2 = w.sh.startSharing(15, false); w.geo.ok(POS(41, 29)); await p2;
  await vm.runInContext('accSignOut()', w.ctx);
  assert.strictEqual(w.sh.sharing, null, 'signing out left sharing on');
  assert.deepStrictEqual(w.calls.filter(c => /:commit/.test(c.url)).pop().body.writes.map(x => x.delete && x.delete.replace(/^.*documents\//, '')), ['locations/uidA']);
});
test('sharing (RF3): if the location is refused, sharing does not start, no sign shows, and the person is told', async () => {
  const w = shareWorld(() => null, { store: SESSION(true) });
  const p = w.sh.startSharing(60, false); w.geo.err({ code: 1 }); const r = await p;
  assert.strictEqual(r, false); assert.strictEqual(w.sh.sharing, null); assert.strictEqual(w.shUI.shown, 0);
  assert.deepStrictEqual(w.shUI.said, ['shareDenied']); assert.strictEqual(w.geo.cleared, 1);
  assert.ok(!w.calls.some(c => /:commit/.test(c.url)), 'something was sent');
});
test('sharing (RF2): a friend who stops sharing disappears from the map; the others stay, and no error is shown', async () => {
  const loc = { name: 'x/locations/uidB', fields: { lat: { doubleValue: 41.1 }, lng: { doubleValue: 29.1 }, acc: { integerValue: '9' }, approx: { booleanValue: false },
    at: { timestampValue: new Date().toISOString() }, until: { timestampValue: new Date(Date.now() + 3600e3).toISOString() } } };
  const w = shareWorld(url => /locations\/uidB$/.test(url) ? [200, loc] : /locations\/uidC$/.test(url) ? [403, {}] : /locations\/uidD$/.test(url) ? [404, {}] : null, { store: SESSION(true) });
  w.fr.friends = [{ uid: 'uidB', name: 'B', pos: null }, { uid: 'uidC', name: 'C', pos: { lat: 1, lng: 1 } }, { uid: 'uidD', name: 'D', pos: { lat: 2, lng: 2 } }];
  await w.sh.pollFriends();
  assert.deepStrictEqual(w.shUI.drawn.filter(f => f.pos).map(f => f.uid), ['uidB']);
  assert.strictEqual(w.shUI.drawn.find(f => f.uid === 'uidB').pos.lat, 41.1);
  assert.deepStrictEqual(w.shUI.said, [], 'an error was shown');
  assert.strictEqual(w.calls.filter(c => /\/locations\//.test(c.url)).length, 3, 'friends were not read one by one');
});
test('sharing (RF5): when the app starts, a position left by a crash is deleted and the sign does not come back by itself', async () => {
  const w = shareWorld(url => /:commit/.test(url) ? [200, {}] : null, { store: SESSION(true) });
  await w.sh.shareBootCleanup();
  const c = w.calls.filter(x => /:commit/.test(x.url));
  assert.strictEqual(c.length, 1); assert.deepStrictEqual(c[0].body.writes.map(x => x.delete.replace(/^.*documents\//, '')), ['locations/uidA']);
  assert.strictEqual(w.sh.sharing, null); assert.strictEqual(w.shUI.shown, 0);
});
test('sharing: the share controls offer only 15 min / 1 h / 8 h and Exact / Approximate, and show Stop while sharing', async () => {
  const w = shareWorld(url => /:commit/.test(url) ? [200, {}] : null, { store: SESSION(true) });
  const h = w.sh.shareViewHTML();
  assert.deepStrictEqual([...h.matchAll(/data-sh-min="(\d+)"/g)].map(m => +m[1]), [15, 60, 480]);
  assert.match(h, /data-sh-approx="0"/); assert.match(h, /data-sh-approx="1"/); assert.match(h, /data-sh="start"/);
  const p = w.sh.startSharing(15, false); w.geo.ok(POS(41, 29)); await p;
  assert.match(w.sh.shareViewHTML(), /data-sh="stop"/);
});

/* ------------------------------------------------------------------- ui ---- */
const CSS = () => H.appStyle().replace(/\r\n/g, '\n');
test('ui: the phone\'s bottom bar is Map, Friends, Layers, Alerts, and its sliding marker is a quarter wide', () => {
  assert.match(APP(), /const items=\[ \['map','mMap'\], \['friends','mFriends'\], \['layers','mLayers'\], \['alerts','mAlerts'\] \];/);
  assert.match(CSS(), /\.mnav-ind\{[^}]*width:calc\(\(100% - 12px\) \/ 4\)/, 'the marker is not a quarter of the bar');
  assert.match(CSS(), /\.mnav\[data-on="3"\] \.mnav-ind\{transform:translateX\(300%\);\}/, 'the marker cannot reach the fourth button');
  assert.match(APP(), /friends: '<svg /, 'the Friends button has no drawn icon');
});
test('ui: on a phone the Friends card lives in its own sheet; opening it loads friends, leaving it stops reading their positions', () => {
  const s = APP();
  assert.match(s, /mSheets=\{ planner:mkSheet\('planner'\), friends:mkSheet\('friends'\), layers:mkSheet\('layers'\)/);
  assert.match(s, /if\(el\.id==='cardFriends'\) mSheets\.friends\.appendChild\(el\);/, 'the Friends card ends up in the Layers sheet');
  const os = /function openSheet\(name\)\{[\s\S]*?\n\}/.exec(s)[0];
  assert.match(os, /if\(name==='friends' && typeof friendsOpened==='function'\) friendsOpened\(\);/, 'opening Friends does not load them');
  assert.match(os, /if\(name!=='friends' && typeof stopFriendPolling==='function'\) stopFriendPolling\(\);/, 'friends\' positions are read with the sheet closed');
  assert.match(H.html(), /<div class="card glass" id="cardFriends">/);
});
test('ui: the friend-request dialog is a proper dialog: Back and Escape decline it, and the keyboard stays inside', () => {
  const s = APP();
  assert.match(s, /\{ id:'invite',\s+open:\(\) => navHas\('inviteDlg','open'\),\s+close:\(\) => \{ declineInvite\(\); closeInviteDlg\(\); \} \}/, 'Back does not close the friend request');
  assert.match(s, /if\(open\('inviteDlg', 'open'\)\)\{ declineInvite\(\); closeInviteDlg\(\); e\.preventDefault\(\); return; \}/, 'Escape does not close the friend request');
  assert.match(s, /\{ id: 'inviteDlg',\s+cls: 'open', modal: true,\s+first: '#inviteAccept' \}/, 'the keyboard can leave the friend request');
});
test('ui: the Sharing sign is above every card, sheet and dialog, so it stays visible (and its Stop reachable) the whole time', () => {
  const css = CSS();
  const pill = /\.share-pill\{[^}]*z-index:(\d+)/.exec(css);
  assert.ok(pill, 'the Sharing sign has no z-index');
  const others = [...css.matchAll(/([^{}]+)\{[^}]*z-index:(\d+)/g)].filter(m => !/share-pill|#bootSplash/.test(m[1]))   /* the loading splash: shown only while the app starts, when nothing can be shared */.map(m => +m[2]).filter(z => z < 100000);
  assert.ok(+pill[1] > Math.max(...others), 'something can cover the Sharing sign: it is at ' + pill[1] + ', another layer at ' + Math.max(...others));
  assert.match(css, /body\.mobile \.share-pill\{top:/, 'on a phone the sign sits at the bottom, over the buttons of cards and sheets');
});

/* ------------------------------------------- final review fixes (14 Nov 2026) ---- */
function fixWorld(routes, opts = {}) {
  const w = shareWorld(routes, Object.assign({ store: SESSION(true) }, opts, { extra: Object.assign({}, opts.extra || {}) }));
  w.shUI.trouble = 0;
  w.ctx.shareUI.trouble = () => { w.shUI.trouble++; };
  vm.runInContext('globalThis.__now = Date.now(); Date.now = () => globalThis.__now;', w.ctx);
  w.tick = ms => { vm.runInContext('globalThis.__now += ' + ms + ';', w.ctx); };
  w.now = () => vm.runInContext('globalThis.__now', w.ctx);
  w.commits = () => w.calls.filter(c => /:commit/.test(c.url)).map(c => c.body.writes);
  return w;
}
const POST = (lat, lng, ts) => ({ coords: { latitude: lat, longitude: lng, accuracy: 10 }, timestamp: ts });
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('review fix 3: Stop waits for a position still being sent, so the delete is always the LAST write', async () => {
  const w = fixWorld(url => /:commit/.test(url) ? [200, {}] : null);
  const orig = w.ctx.fetch;
  w.ctx.fetch = async (url, o) => { if (/:commit/.test(url) && /"update"/.test(o.body)) await sleep(60); return orig(url, o); };
  const started = w.sh.startSharing(15, false);
  w.geo.ok(POST(41, 29, w.now())); await sleep(5);           // the first position is now on its way (its answer takes 60 ms)
  const stopped = w.sh.stopSharing('stop');
  await Promise.all([started, stopped]);
  const c = w.commits();
  assert.ok(c.length >= 2, 'nothing was written');
  assert.ok(c[c.length - 1][0].delete && /locations\/uidA$/.test(c[c.length - 1][0].delete), 'a position landed after Stop deleted it');
  assert.strictEqual(w.sh.sharing, null);
});
test('review fix 4: after a refused write the next try waits 30 s; three in a row show trouble on the sign', async () => {
  const w = fixWorld(url => /:commit/.test(url) ? [500, { error: { status: 'INTERNAL' } }] : null);
  const p = w.sh.startSharing(60, false); w.geo.ok(POST(41, 29, w.now())); await p;
  assert.strictEqual(w.commits().length, 1);
  w.geo.ok(POST(41.01, 29, w.now())); await sleep(5);
  assert.strictEqual(w.commits().length, 1, 'a refused write is retried at once (it hammers the server)');
  w.tick(31e3); w.geo.ok(POST(41.02, 29, w.now())); await sleep(5);
  w.tick(31e3); w.geo.ok(POST(41.03, 29, w.now())); await sleep(5);
  assert.strictEqual(w.commits().length, 3); assert.ok(w.shUI.trouble >= 1, 'three refused writes in a row, and the sign still says all is well');
});
test('review fix 4: the end time follows the SERVER clock (learnt from its answers) and stays inside the 8-hour rule', async () => {
  let first = true;
  const w = fixWorld(url => /:commit/.test(url) ? [200, first ? (first = false, { commitTime: new Date(Date.now() + 3600e3).toISOString() }) : {}] : null);
  await w.sh.shareBootCleanup();                                // the server answers: its clock is 1 h ahead of this phone
  const p = w.sh.startSharing(480, false); w.geo.ok(POST(41, 29, w.now())); await p;
  const loc = w.commits().pop()[0];
  const until = w.api.fsDecode(loc.update).until, serverNow = w.now() + 3600e3;
  assert.ok(until <= serverNow + 8 * 3600e3 - 30e3, 'the end time breaks the 8-hour rule on the server');
  assert.ok(until > serverNow + 7.9 * 3600e3, 'the end time was cut short');
});
test('review fix 5: a lost location fix is not re-sent as live; a later refusal of location stops sharing', async () => {
  const w = fixWorld(url => /:commit/.test(url) ? [200, {}] : null);
  const p = w.sh.startSharing(60, false); w.geo.ok(POST(41, 29, w.now())); await p;
  const n = w.commits().length;
  w.tick(200e3); await vm.runInContext('shareHeartbeat()', w.ctx);
  assert.strictEqual(w.commits().length, n, 'a 3-minute-old fix was sent as if it were current');
  w.geo.err({ code: 1 }); await sleep(5);
  assert.strictEqual(w.sh.sharing, null, 'sharing went on after location was refused');
  assert.ok(w.shUI.said.includes('shareDenied'));
  assert.ok(w.commits().pop()[0].delete, 'the stored position was not deleted');
});
test('review fix 6: if the sign-in is lost (expired, disabled), sharing stops and the sign goes', async () => {
  const w = fixWorld(url => /securetoken/.test(url) ? [400, { error: { message: 'TOKEN_EXPIRED' } }] : /:commit/.test(url) ? [200, {}] : null);
  const p = w.sh.startSharing(60, false); w.geo.ok(POST(41, 29, w.now())); await p;
  w.api.acct.idExp = 0;
  await assert.rejects(w.api.idToken());
  await sleep(5);
  assert.strictEqual(w.api.acct, null); assert.strictEqual(w.sh.sharing, null, 'the sign still says Sharing after the account was lost');
  assert.ok(w.shUI.hidden >= 1); assert.ok(w.geo.cleared >= 1);
});
test('review fix 10: pressing Start twice while the location question is open starts ONE location watch', async () => {
  const w = fixWorld(url => /:commit/.test(url) ? [200, {}] : null);
  const a = w.sh.startSharing(60, false), b = w.sh.startSharing(60, false);
  w.geo.ok(POST(41, 29, w.now())); await Promise.all([a, b]);
  assert.strictEqual(w.geo.watching, 1, 'a second watch was started, and Stop would never clear it');
});
test('review fix 7: a friend who joined with YOUR link is marked new, so you can check it is who you meant', async () => {
  const fdoc = { document: { name: 'x/friendships/uidA_uidZ', fields: { a: { stringValue: 'uidA' }, b: { stringValue: 'uidZ' }, inviter: { stringValue: 'uidA' }, acceptor: { stringValue: 'uidZ' }, created: { timestampValue: new Date().toISOString() } } } };
  const w = fixWorld((url, body) => /:runQuery/.test(url) ? [200, body.structuredQuery.from[0].collectionId === 'friendships' && body.structuredQuery.where.fieldFilter.field.fieldPath === 'a' ? [fdoc] : []]
    : /profiles\/uidZ/.test(url) ? [200, { name: 'x/profiles/uidZ', fields: { name: { stringValue: 'Zeynep' } } }] : null);
  await vm.runInContext('loadFriends()', w.ctx);
  assert.strictEqual(w.fr.friends[0].viaMyLink, true);
  assert.match(w.fr.friendsViewHTML(), /frJustJoined/, 'the new friend is not marked');
});
test('review fixes 1-2: friends load as soon as the account is ready (and on a computer at start), and leave the map when no longer read', () => {
  const s = APP();
  assert.match(s, /onAccountChange\(\(\) => \{ renderFriends\(\); if\(accReady\(\)\)\{ if\(friendsVisible\(\)\) friendsOpened\(\); \}/, 'signing in inside the open Friends view does not load friends');
  assert.match(s, /function friendsVisible\(\)\{/);
  assert.match(s, /if\(!IS_MOBILE && accReady\(\)\) friendsOpened\(\);/, 'on a computer friends are never loaded');
  assert.match(s, /function stopFriendPolling\(\)\{ if\(sharing\) return; if\(friendPoll\)\{ clearInterval\(friendPoll\); friendPoll = null; \} if\(friendLayer\) friendLayer\.clearLayers\(\); \}/, 'friends stay on the map, frozen, after their positions stop being read');
});
test('review fix 3: a position queued but not yet sent when Stop is pressed is never sent at all', async () => {
  const w = fixWorld(url => /:commit/.test(url) ? [200, {}] : null);
  const started = w.sh.startSharing(15, false);
  w.geo.ok(POST(41, 29, w.now()));
  const stopped = w.sh.stopSharing('stop');                    // at once: the first position is queued, not on its way yet
  await Promise.all([started, stopped]);
  const writes = w.commits().flat();
  assert.ok(!writes.some(x => x.update), 'a position was written after Stop was pressed');
  assert.ok(writes.some(x => x.delete), 'Stop did not delete the stored position');
});
