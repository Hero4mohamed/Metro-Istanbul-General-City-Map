'use strict';
/* The Android app's address file (V4.3). A wrong fingerprint does not fail loudly: the app just opens with a browser bar and looks
 * like a website. So the file is generated, and what can be checked is checked. */
const { test } = require('node:test');
const assert = require('node:assert');
const { build, text, normaliseFingerprint } = require('../play/make-assetlinks.cjs');

const SHA256 = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
const PKG = 'io.github.hero4mohamed.turkmaps';

test('play: the file names the package and the certificate in the form Android reads', () => {
  const j = JSON.parse(text(PKG, [SHA256]));
  assert.deepStrictEqual(j, [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PKG, sha256_cert_fingerprints: [SHA256] } }]);
});

test('play: a fingerprint is accepted in any usual spelling and written in one', () => {
  for (const spelling of [SHA256, SHA256.toLowerCase(), SHA256.replace(/:/g, ''), SHA256.replace(/:/g, ' '), '  ' + SHA256 + '\n']) assert.strictEqual(normaliseFingerprint(spelling), SHA256);
});

test('play: the two fingerprints (Google\'s signing key and your upload key) are both kept, and a repeat is dropped', () => {
  const other = SHA256.replace(/^14/, '15');
  assert.deepStrictEqual(build(PKG, [SHA256, other, SHA256.toLowerCase()])[0].target.sha256_cert_fingerprints, [SHA256, other]);
});

test('play: the usual mistakes stop with a message instead of producing a file that silently fails on the phone', () => {
  const sha1 = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42';
  assert.throws(() => normaliseFingerprint(sha1), /SHA-1/, 'a SHA-1 was accepted');
  assert.throws(() => normaliseFingerprint(SHA256.slice(0, -3)), /64 hex digits/, 'a fingerprint with a missing byte was accepted');
  assert.throws(() => normaliseFingerprint(SHA256.replace('14', 'ZZ')), /hex digits/, 'a fingerprint with non-hex letters was accepted');
  assert.throws(() => build('raynet', [SHA256]), /package name/, 'a name with no dots was accepted as a package');
  assert.throws(() => build('io.github.hero4mohamed.', [SHA256]), /package name/);
  assert.throws(() => build(PKG, []), /at least one/, 'a file with no fingerprint was produced');
});
