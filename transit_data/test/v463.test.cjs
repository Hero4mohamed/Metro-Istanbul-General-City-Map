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
