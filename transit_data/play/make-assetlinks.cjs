#!/usr/bin/env node
'use strict';
/* Writes the Digital Asset Links file (assetlinks.json) that lets the Android app (a Trusted Web Activity) hide the browser bar.
 * Android only trusts the page if https://<the address>/.well-known/assetlinks.json names the app's package AND the SHA-256 of the
 * certificate the installed app is signed with. After the first upload to Google Play, take the fingerprint from
 *   Play Console > (the app) > App integrity > App signing  ("App signing key certificate", SHA-256)
 * and, for builds you install yourself, from your own upload key (`keytool -list -v -keystore <file>`).
 *
 *   node transit_data/play/make-assetlinks.cjs io.github.hero4mohamed.turkmaps AB:CD:... [more fingerprints] [--out path]
 *
 * Without --out the JSON is printed. The result belongs in the repository named exactly Hero4mohamed.github.io, as
 * .well-known/assetlinks.json (see that repository's README). Everything here is checked: a SHA-1 pasted by mistake, a
 * fingerprint with a missing byte, or a package name that is not one, stops with a message instead of publishing a file that
 * silently fails on the phone.
 */
const fs = require('node:fs');

const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i;

/* "ab:cd:..", "ABCD..", "AB CD .." -> "AB:CD:.." (exactly 32 bytes) */
function normaliseFingerprint(text) {
  const hex = String(text).replace(/[:\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]*$/.test(hex)) throw new Error('not a fingerprint (only hex digits and colons are allowed): ' + text);
  if (hex.length === 40) throw new Error('that is a SHA-1 (20 bytes). Android needs the SHA-256 (32 bytes, 64 hex digits): ' + text);
  if (hex.length !== 64) throw new Error('a SHA-256 fingerprint is 32 bytes (64 hex digits); this has ' + hex.length + ' digits: ' + text);
  return hex.match(/../g).join(':');
}

function build(pkg, fingerprints) {
  if (!PACKAGE.test(String(pkg))) throw new Error('not an Android package name (like io.github.hero4mohamed.turkmaps): ' + pkg);
  if (!fingerprints || !fingerprints.length) throw new Error('give at least one SHA-256 fingerprint');
  const list = [...new Set(fingerprints.map(normaliseFingerprint))];
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: list },
  }];
}

const text = (pkg, fingerprints) => JSON.stringify(build(pkg, fingerprints), null, 2) + '\n';

module.exports = { build, text, normaliseFingerprint };

if (require.main === module) {
  const args = process.argv.slice(2);
  const o = args.indexOf('--out');
  let out = null;
  if (o >= 0) { out = args[o + 1]; args.splice(o, 2); }
  try {
    if (args.length < 2) throw new Error('usage: make-assetlinks.cjs <package> <SHA-256> [<SHA-256> ...] [--out file]');
    const json = text(args[0], args.slice(1));
    if (out) { fs.writeFileSync(out, json); console.log('wrote', out); } else process.stdout.write(json);
  } catch (e) { console.error('error: ' + e.message); process.exit(1); }
}
