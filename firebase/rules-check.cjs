'use strict';
/* Live check of firebase/firestore.rules against the REAL project (V4.6.3). Run by hand, after setup:
 *     node --use-system-ca firebase/rules-check.cjs            (--use-system-ca: this machine's antivirus inspects HTTPS)
 *     node --use-system-ca firebase/rules-check.cjs --slow     (also waits 3 min to check a closed app disappears)
 * It needs firebase/.test-accounts.json (git-ignored, never committed):
 *     { "apiKey": "...", "projectId": "...", "a": { "email": "...", "pw": "..." }, "b": { "email": "...", "pw": "..." } }
 * Both test accounts must exist and have confirmed their email. It tries every allowed and forbidden case of design §6 and
 * prints PASS or FAIL for each; it exits 1 on any FAIL. It deletes what it wrote, before and after. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '.test-accounts.json'), 'utf8'));
const DOCS = `projects/${CFG.projectId}/databases/(default)/documents`;
const FS = 'https://firestore.googleapis.com/v1/';
const SLOW = process.argv.includes('--slow');
let fails = 0, passes = 0;

const val = v => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number'
  ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : v instanceof Date ? { timestampValue: v.toISOString() } : { stringValue: String(v) };
const enc = o => { const f = {}; for (const k in o) f[k] = val(o[k]); return { fields: f }; };
const pair = (x, y) => (x < y ? x + '_' + y : y + '_' + x);

async function signIn(who) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + CFG.apiKey,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: who.email, password: who.pw, returnSecureToken: true }) });
  const j = await r.json();
  if (!r.ok) throw new Error('sign-in failed for ' + who.email + ': ' + JSON.stringify(j.error && j.error.message));
  const claims = JSON.parse(Buffer.from(j.idToken.split('.')[1], 'base64url').toString());
  if (claims.email_verified !== true) throw new Error(who.email + ' has not confirmed its email yet');
  return { uid: j.localId, tok: j.idToken };
}
async function call(u, method, p, body) {
  const r = await fetch(FS + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, u ? { Authorization: 'Bearer ' + u.tok } : {}), body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* empty */ }
  return { ok: r.ok, status: r.status, j };
}
const get = (u, rel) => call(u, 'GET', DOCS + '/' + rel);
const commit = (u, writes) => call(u, 'POST', DOCS + ':commit', { writes });
const query = (u, sq) => call(u, 'POST', DOCS + ':runQuery', { structuredQuery: sq });
const upd = (rel, obj, extra) => Object.assign({ update: Object.assign({ name: DOCS + '/' + rel }, enc(obj)) }, extra || {});
const at = { updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] };
const created = { updateTransforms: [{ fieldPath: 'created', setToServerValue: 'REQUEST_TIME' }] };
const hours = h => new Date(Date.now() + h * 3600e3);

async function expect(name, allowed, p) {
  const r = await p;
  const good = allowed ? r.ok : !r.ok;          // a refusal is any non-2xx answer (Firestore says 403 PERMISSION_DENIED)
  if (good) { passes++; console.log('PASS  ' + name + (allowed ? '' : '  (refused: ' + r.status + ')')); }
  else { fails++; console.log('FAIL  ' + name + '  -> HTTP ' + r.status + ' ' + JSON.stringify(r.j).slice(0, 200)); }
  return r;
}
async function tidy(u) {
  const mine = async (coll, field) => { const r = await query(u, { from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: u.uid } } } });
    return (Array.isArray(r.j) ? r.j : []).filter(x => x.document).map(x => x.document.name.replace(/^.*\/documents\//, '')); };
  const docs = [].concat(await mine('friendships', 'a'), await mine('friendships', 'b'), await mine('invites', 'from'));
  await commit(u, [{ delete: DOCS + '/locations/' + u.uid }, { delete: DOCS + '/profiles/' + u.uid }].concat(docs.map(d => ({ delete: DOCS + '/' + d }))));
}

(async () => {
  const A = await signIn(CFG.a), B = await signIn(CFG.b);
  await tidy(A); await tidy(B);
  console.log('Accounts A=' + A.uid.slice(0, 6) + '… B=' + B.uid.slice(0, 6) + '…, project ' + CFG.projectId + '\n');

  // profiles
  await expect('signed-out read of a profile is refused', false, get(null, 'profiles/' + A.uid));
  await expect('A writes its own name', true, commit(A, [upd('profiles/' + A.uid, { name: 'Test A' })]));
  await expect('B writes its own name', true, commit(B, [upd('profiles/' + B.uid, { name: 'Test B' })]));
  await expect('A cannot add other fields to its profile', false, commit(A, [upd('profiles/' + A.uid, { name: 'Test A', email: 'x@y.z' })]));
  await expect('A cannot write B\'s profile', false, commit(A, [upd('profiles/' + B.uid, { name: 'hacked' })]));
  await expect('a name over 30 characters is refused', false, commit(A, [upd('profiles/' + A.uid, { name: 'x'.repeat(31) })]));
  await expect('B cannot read A\'s name before they are friends', false, get(B, 'profiles/' + A.uid));

  // locations, before friendship
  await expect('A shares its location for 1 hour', true, commit(A, [upd('locations/' + A.uid, { lat: 41.01, lng: 28.98, acc: 20, approx: false, until: hours(1) }, at)]));
  await expect('sharing for 9 hours is refused', false, commit(A, [upd('locations/' + A.uid, { lat: 41.01, lng: 28.98, acc: 20, approx: false, until: hours(9) }, at)]));
  await expect('a position without the server time is refused', false, commit(A, [upd('locations/' + A.uid, { lat: 41.01, lng: 28.98, acc: 20, approx: false, until: hours(1), at: new Date() })]));
  await expect('a position with an extra field is refused', false, commit(A, [upd('locations/' + A.uid, { lat: 41.01, lng: 28.98, acc: 20, approx: false, until: hours(1), note: 'x' }, at)]));
  await expect('A cannot write B\'s position', false, commit(A, [upd('locations/' + B.uid, { lat: 1, lng: 1, acc: 1, approx: false, until: hours(1) }, at)]));
  await expect('B cannot read A\'s position before they are friends', false, get(B, 'locations/' + A.uid));
  await expect('nobody can list all positions', false, query(B, { from: [{ collectionId: 'locations' }] }));
  await expect('nobody can list all profiles', false, query(B, { from: [{ collectionId: 'profiles' }] }));

  // invites
  const id = crypto.randomBytes(16).toString('hex'), inv = 'invites/' + id;
  await expect('an invite lasting 72 hours is refused', false, commit(A, [upd('invites/' + crypto.randomBytes(16).toString('hex'), { from: A.uid, fromName: 'Test A', usedBy: null, expires: hours(72) }, Object.assign({ currentDocument: { exists: false } }, created))]));
  await expect('A cannot make an invite in B\'s name', false, commit(A, [upd('invites/' + crypto.randomBytes(16).toString('hex'), { from: B.uid, fromName: 'B', usedBy: null, expires: hours(47) }, Object.assign({ currentDocument: { exists: false } }, created))]));
  await expect('A makes a 47-hour invite', true, commit(A, [upd(inv, { from: A.uid, fromName: 'Test A', usedBy: null, expires: hours(47) }, Object.assign({ currentDocument: { exists: false } }, created))]));
  await expect('A cannot accept its own invite', false, commit(A, [upd(inv, { usedBy: A.uid }, { updateMask: { fieldPaths: ['usedBy'] } })]));
  const lo = A.uid < B.uid ? A.uid : B.uid, hi = A.uid < B.uid ? B.uid : A.uid, fr = 'friendships/' + pair(A.uid, B.uid);
  const friendship = upd(fr, { a: lo, b: hi, inviter: A.uid, acceptor: B.uid, invite: id }, Object.assign({ currentDocument: { exists: false } }, created));
  await expect('B cannot create the friendship without using the invite', false, commit(B, [friendship]));
  await expect('B accepts: claims the invite and creates the friendship in one write', true, commit(B, [upd(inv, { usedBy: B.uid }, { updateMask: { fieldPaths: ['usedBy'] } }), friendship]));
  await expect('the same invite cannot be used again', false, commit(B, [upd(inv, { usedBy: B.uid }, { updateMask: { fieldPaths: ['usedBy'] } })]));
  await expect('a friendship cannot be edited', false, commit(B, [upd(fr, { a: lo, b: hi, inviter: B.uid, acceptor: A.uid, invite: id, created: new Date() })]));

  // as friends
  await expect('B reads A\'s name as a friend', true, get(B, 'profiles/' + A.uid));
  await expect('B reads A\'s position while A shares', true, get(B, 'locations/' + A.uid));
  await expect('B lists its own friendships', true, query(B, { from: [{ collectionId: 'friendships' }], where: { fieldFilter: { field: { fieldPath: 'b' }, op: 'EQUAL', value: { stringValue: hi } } } }));
  await expect('A shares with an end time already passed: refused', false, commit(A, [upd('locations/' + A.uid, { lat: 41.01, lng: 28.98, acc: 20, approx: false, until: hours(-0.01) }, at)]));
  if (SLOW) {
    console.log('… waiting 190 s without sending (a closed app) …');
    await new Promise(r => setTimeout(r, 190e3));
    await expect('3 minutes after the last position, B can no longer see A', false, get(B, 'locations/' + A.uid));
  }

  // removing
  await expect('A removes the friendship', true, commit(A, [{ delete: DOCS + '/' + fr }]));
  await expect('after removal B cannot read A\'s position', false, get(B, 'locations/' + A.uid));
  await expect('after removal B cannot read A\'s name', false, get(B, 'profiles/' + A.uid));
  await expect('A stops sharing: its position is deleted', true, commit(A, [{ delete: DOCS + '/locations/' + A.uid }]));

  await tidy(A); await tidy(B);
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR ' + e.message); process.exit(2); });
