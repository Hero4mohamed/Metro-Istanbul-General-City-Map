/* The app's own place search: the processor that builds places-<city>.json, and the engine that searches it.
 *
 * Search used to be the map's stops plus a live call to a public service that says heavy use "will be throttled or
 * completely banned". The places now ship with the app and are searched on the device. What matters is that a person
 * can type what they would type — "bagdat", "starbucks kadikoy", "eczane", "Galata Tower" — and get the right thing,
 * so these tests state exactly those, against a small invented city where every answer can be known in advance, run
 * through the REAL processor and the engine AS SHIPPED in the built page (not the source file).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');
const P = require('../process-places.cjs');

/* the engine as it ships: the pure block of the built page */
function engine() {
  const html = H.html();
  const a = html.indexOf('/* ==GAZETTEER-PURE-START== */'), b = html.indexOf('/* ==GAZETTEER-PURE-END== */');
  assert.ok(a > 0 && b > a, 'the gazetteer markers are not in the built page');
  const mod = { exports: {} };
  new Function('module', 'exports', html.slice(a, b) + '\nmodule.exports={gazFold,gazDecode,gazSearch,gazTypesFor,gazEdit,gazMeters,gazMask,gazBits,gazThin};')(mod, mod.exports);
  return mod.exports;
}
const E = engine();

const { rawCity } = require('../testkit/places-fixture.cjs');
const built = P.build(rawCity());
const file = built.out;
const G = E.gazDecode(JSON.parse(JSON.stringify(file)));          // through JSON, exactly as the app receives it
const ti = k => file.types.indexOf(k);

/* what each type means, as the page builds it from the labels: a folded word -> type indexes */
const TW = new Map();
[['eczane', 'pharmacy'], ['pharmacy', 'pharmacy'], ['eczaneler', 'pharmacy'], ['pharmacie', 'pharmacy'], ['صيدلية', 'pharmacy'], ['cafe', 'cafe'], ['kafe', 'cafe'],
 ['hospital', 'hospital'], ['hastane', 'hospital'], ['cami', 'mosque'], ['market', 'supermarket'], ['street', 'street']].forEach(([w, k]) => {
  const f = E.gazFold(w); TW.set(f, (TW.get(f) || []).concat(ti(k)));
});
const ORG = { lat: 40.97, lng: 29.03 };                           // in Moda
const find = (q, o) => E.gazSearch(G, q, Object.assign({ org: ORG, limit: 10, typeWords: TW }, o || {}));
const names = rows => rows.map(r => G.name[r.i]);
const where = r => (G.d[r.i] ? G.districts[G.d[r.i] - 1] : '') + '/' + (G.h[r.i] ? G.hoods[G.h[r.i] - 1] : '');

/* ---------------- the processor ---------------- */

test('a street is not a way: the pieces of one street join, and a name shared by two streets stays two', () => {
  const bag = [...Array(G.n).keys()].filter(i => G.name[i] === 'Bağdat Caddesi');
  assert.strictEqual(bag.length, 2, 'Bağdat Caddesi should be one street per district, got ' + bag.length);
  assert.deepStrictEqual(bag.map(i => G.districts[G.d[i] - 1]).sort(), ['Kadıköy', 'Üsküdar']);
  const sokak = [...Array(G.n).keys()].filter(i => G.name[i] === '1. Sokak');
  assert.strictEqual(sokak.length, 2, '"1. Sokak" exists in two neighbourhoods and is not one street');
  // the pin lies on the street itself, not at the average of its pieces' neighbourhood
  const k = bag.find(i => G.districts[G.d[i] - 1] === 'Kadıköy');
  assert.ok(Math.abs(G.lat[k] - 40.975) < 1e-4 && G.lng[k] >= 29.0590 && G.lng[k] <= 29.0790, 'the street pin is off the street: ' + G.lat[k] + ',' + G.lng[k]);
});

test('a place knows its district and neighbourhood from the outlines, not from the nearest centre', () => {
  const find1 = n => [...Array(G.n).keys()].find(i => G.name[i] === n);
  const s1 = [...Array(G.n).keys()].filter(i => G.name[i] === 'Starbucks');
  const moda = s1.find(i => G.lat[i] < 41), usk = s1.find(i => G.lat[i] > 41);
  assert.strictEqual(G.districts[G.d[moda] - 1], 'Kadıköy'); assert.strictEqual(G.hoods[G.h[moda] - 1], 'Moda');
  assert.strictEqual(G.districts[G.d[usk] - 1], 'Üsküdar'); assert.strictEqual(G.h[usk], 0, 'no neighbourhood outline there, so none claimed');
  // the neighbourhood suffix is not part of its name
  assert.ok(G.hoods.includes('Caddebostan') && !G.hoods.some(h => /mahalle/i.test(h)), 'a neighbourhood keeps its "Mahallesi"');
  assert.ok(find1('Kadıköy') !== undefined && G.types[G.t[find1('Kadıköy')]] === 'district', 'a district is not an entry of its own');
});

test('a thing named twice for one place is one place, and a notable thing ranks higher', () => {
  assert.strictEqual([...Array(G.n).keys()].filter(i => G.name[i] === 'Moda Sahil Cafe').length, 1, 'a building and its entrance node were both listed');
  const gal = [...Array(G.n).keys()].find(i => G.name[i] === 'Galata Kulesi');
  const mig = [...Array(G.n).keys()].find(i => G.name[i] === 'Migros');
  assert.ok(G.r[gal] > G.r[mig], 'a landmark with a Wikidata entry should outrank a supermarket');
});

test('another country\'s district, which a box reaching past the border brings in, and everything inside it, is left out', () => {
  const raw = rawCity();
  raw.admin.push({ id: 5, level: 6, name: 'Περιφερειακή Ενότητα Λέσβου', rings: [require('../testkit/places-fixture.cjs').sq(40.90, 40.94, 29.15, 29.19)], centre: [40.92, 29.17] });
  raw.admin.push({ id: 6, level: 8, name: 'Μυτιλήνη', rings: [require('../testkit/places-fixture.cjs').sq(40.91, 40.93, 29.16, 29.18)], centre: [40.92, 29.17] });
  raw.pois.push({ id: 'n801', tags: { name: 'Island Cafe', amenity: 'cafe' }, lat: 40.915, lon: 29.17 });
  raw.streets.push({ id: 801, name: 'Island Street', hw: 'residential', lat: 40.915, lon: 29.175, len: 300 });
  const { out } = P.build(raw), g = P.decode(out);
  assert.ok(!out.districts.some(d => /Λέσβου/.test(d)) && !out.hoods.some(h => /Μυτιλήνη/.test(h)), 'a Greek district or neighbourhood is in the file');
  assert.ok(!g.names.includes('Island Cafe') && !g.names.includes('Island Street'), 'a place inside the foreign district is in the file');
  assert.ok(g.names.includes('Moda Eczanesi') && g.names.includes('Bağdat Caddesi'), 'the real places went with them');
});

test('the file is columns that decode to exactly the places that went in', () => {
  assert.strictEqual(G.n, built.stats.entries);
  assert.strictEqual(file.n.split('\n').length, G.n, 'the name column and the entry count disagree');
  for (const k of ['t', 'la', 'lo', 'd', 'h', 'r']) assert.strictEqual(file[k].length, G.n, 'column ' + k + ' has the wrong length');
  // coordinates survive the delta encoding to a metre
  const i = [...Array(G.n).keys()].find(x => G.name[x] === 'Galata Kulesi');
  assert.ok(Math.abs(G.lat[i] - 41.02) < 2e-5 && Math.abs(G.lng[i] - 29.06) < 2e-5, 'coordinates drifted: ' + G.lat[i] + ',' + G.lng[i]);
  assert.strictEqual(G.en[i], 'Galata Tower');
  assert.ok(file.types.every((k, x) => P.TYPES[x] === k), 'the type table in the file is not the processor\'s');
});

test('every type the file can hold has a name in all four languages, so no result is ever shown with a bare key', () => {
  const html = H.html(), lacking = [];
  for (const lg of ['en', 'tr', 'ar', 'fr']) {
    const i = html.indexOf('\n  ' + lg + ': {') >= 0 ? html.indexOf('\n  ' + lg + ': {') : html.indexOf('\n  ' + lg + ':{');
    for (const k of P.TYPES) {
      // each language's block is a run of key:"value" pairs; look the key up anywhere after its language header
      const re = new RegExp('gt_' + k + ':"[^"]+"');
      const seg = html.slice(i);
      if (!re.test(seg)) lacking.push(lg + ' ' + k);
    }
  }
  assert.deepStrictEqual(lacking, [], 'no label for: ' + lacking.join(', '));
  // and an icon
  const meta = H.html().match(/const GAZ_TYPE_META = \{([\s\S]*?)\n\};/);
  assert.ok(meta, 'GAZ_TYPE_META not found');
  const noIcon = P.TYPES.filter(k => !new RegExp('\\b' + k + ':\\s*\\[').test(meta[1]));
  assert.deepStrictEqual(noIcon, [], 'no icon for: ' + noIcon.join(', '));
});

/* ---------------- folding ---------------- */

test('Turkish is folded the way it is typed', () => {
  const f = E.gazFold;
  for (const v of ['ISPARTA', 'ısparta', 'Isparta', 'İsparta', 'isparta']) assert.strictEqual(f(v), 'isparta', v);
  assert.strictEqual(f('Şişli'), 'sisli'); assert.strictEqual(f('Üsküdar'), 'uskudar'); assert.strictEqual(f('Kadıköy'), 'kadikoy');
  assert.strictEqual(f('Çağlayan - Ömer’s'), 'caglayan omer s', 'punctuation is a space, collapsed');
  assert.strictEqual(f('  '), '');
});
test('Arabic is folded the way it is typed: no vowel marks, one alef, and "the" does not matter', () => {
  const f = E.gazFold;
  assert.strictEqual(f('صَيْدَلِيَّة'), f('صيدليه'), 'vowel marks and the final ة');
  assert.strictEqual(f('أحمد'), f('احمد')); assert.strictEqual(f('الصيدلية'), f('صيدلية'), 'the definite article');
  // the same fold is applied to the names in the file and to what is typed, so a name and its own query always agree
  assert.strictEqual(f('السلطان'), f('سلطان'));
  assert.strictEqual(f('ال'), 'ال', 'a lone article is a word, not a prefix to strip');
});

/* ---------------- searching ---------------- */

test('a street is found by its name, however it is typed', () => {
  for (const q of ['bagdat caddesi', 'Bağdat Caddesi', 'BAGDAT', 'bagdat cad']) {
    const r = find(q);
    assert.ok(r.length >= 2 && names(r).slice(0, 2).every(n => n === 'Bağdat Caddesi'), q + ' -> ' + names(r).join(' | '));
  }
});
/* Equally well known (both are long primary roads), so only where you are decides. A famous street rightly outranks a
   short lane of the same name that happens to be nearer; that is the notability rank doing its job. */
test('the nearer of two equally important streets with the same name comes first', () => {
  const r = find('bagdat caddesi', { org: { lat: 40.975, lng: 29.06 } });
  assert.strictEqual(G.districts[G.d[r[0].i] - 1], 'Kadıköy');
  const r2 = find('bagdat caddesi', { org: { lat: 41.012, lng: 29.03 } });
  assert.strictEqual(G.districts[G.d[r2[0].i] - 1], 'Üsküdar');
});
test('a district is found by its name and comes before the streets and shops that carry it', () => {
  const r = find('kadikoy');
  assert.strictEqual(names(r)[0], 'Kadıköy'); assert.strictEqual(G.types[G.t[r[0].i]], 'district');
  // standing in the other district, it is still the first answer: someone in Üsküdar typing "Kadıköy" means Kadıköy
  assert.strictEqual(names(find('kadikoy', { org: { lat: 41.03, lng: 29.05 } }))[0], 'Kadıköy');
  // and a district name alone is not a request for everything in the district: every answer is called something like it
  const all = find('kadikoy', { limit: 30 });
  assert.ok(all.length >= 2 && all.every(x => E.gazFold(G.name[x.i]).indexOf('kadikoy') >= 0), 'unrelated places answered "kadikoy": ' + names(all).join(' | '));
});
test('a place name and an area narrow each other: "starbucks kadikoy" is the one in Kadıköy', () => {
  const r = find('starbucks kadikoy', { org: { lat: 41.02, lng: 29.02 } });      // standing next to the OTHER one
  assert.ok(r.length >= 1 && where(r[0]).startsWith('Kadıköy'), 'got ' + r.map(where).join(' | '));
  assert.ok(!r.some(x => where(x).startsWith('Üsküdar')), 'the Üsküdar branch was offered for a Kadıköy query');
  assert.strictEqual(find('starbucks üsküdar').map(where)[0].split('/')[0], 'Üsküdar');
});
test('a type word alone means "the nearest of those", in every language', () => {
  for (const q of ['eczane', 'pharmacy', 'صيدلية', 'الصيدلية', 'eczaneler', 'pharmacie']) {
    const r = find(q);
    assert.ok(r.length >= 3, q + ' found ' + r.length);
    assert.ok(r.slice(0, 3).every(x => G.types[G.t[x.i]] === 'pharmacy'), q + ' -> ' + names(r).slice(0, 4).join(' | '));
    assert.strictEqual(names(r)[0], 'Moda Eczanesi', q + ' should start with the pharmacy next to where we stand, got ' + names(r)[0]);
  }
});
test('a type and an area: "eczane moda" is the pharmacies in Moda, not the ones across the water', () => {
  const r = find('eczane moda', { org: { lat: 41.03, lng: 29.05 } });
  assert.ok(r.length >= 1 && names(r).includes('Moda Eczanesi'));
  assert.ok(!names(r).includes('Gül Eczanesi'), 'a pharmacy outside Moda answered "eczane moda"');
});
test('an English or Arabic name finds the place, and the Turkish name still does', () => {
  assert.strictEqual(names(find('galata tower'))[0], 'Galata Kulesi');
  assert.strictEqual(names(find('galata kulesi'))[0], 'Galata Kulesi');
  assert.strictEqual(names(find('moda avenue'))[0], 'Moda Caddesi');
  assert.strictEqual(names(find('صيدلية الشفاء'))[0], 'Şifa Eczanesi');
});
test('a typo is forgiven, but only when nothing better exists', () => {
  assert.strictEqual(names(find('bagdad caddesi'))[0], 'Bağdat Caddesi');
  assert.strictEqual(names(find('kadikoyy'))[0], 'Kadıköy');
  // a real match is never displaced by a fuzzy one
  const exact = find('moda'); assert.ok(!exact.some(x => x.fuzzy), 'a fuzzy hit appeared beside real matches');
  // no match at all, and no match close to anything, is an empty list rather than rubbish
  assert.deepStrictEqual(find('qqqzzzxx'), []);
});
test('a chain does not flood the list, and a one-letter query does not search at all', () => {
  const r = find('zeytin market', { limit: 10 });
  assert.ok(r.length <= 4, 'six identical shops showed ' + r.length + ' rows');
  assert.deepStrictEqual(find('k'), []);
  assert.deepStrictEqual(find(''), []);
});
test('a search can be limited to some types', () => {
  const r = find('moda', { only: [ti('street')] });
  assert.ok(r.length >= 1 && r.every(x => G.types[G.t[x.i]] === 'street'));
});
test('the whole name outranks a longer name that merely starts with it', () => {
  const r = find('moda'), n = names(r);
  assert.strictEqual(n[0], 'Moda', 'the neighbourhood called exactly "Moda" should lead: ' + n.join(' | '));
  assert.ok(n.indexOf('Moda Caddesi') > 0 && n.indexOf('Moda Eczanesi') > 0 && n.indexOf('Moda Sahil Cafe') > 0, 'the longer names should all follow: ' + n.join(' | '));
  // a word found only INSIDE another word is a weaker answer than a word that starts one
  const inside = find('erkez'), start = find('merkez');
  assert.ok(inside.length === 1 && start.length >= 1 && start[0].score > inside[0].score, 'a mid-word match should score below a word-start match');
});

/* The typo pass runs on a phone on a keystroke. Measured against the real İstanbul file (128,000 places) it used to take 150-1000 ms
   (a scan of the whole vocabulary with an edit distance per word, then a full re-search for each of up to forty corrections); these
   are the properties that bring it to a few milliseconds, so that an edit cannot quietly give them back. */
test('the letter-mask filter never rules out a word that really is within the edit limit', () => {
  const rnd = (() => { let x = 12345; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const L = 'abcdefghijklmnopqrstuvwxyz0123456789', pick = () => L[Math.floor(rnd() * L.length)];
  for (let n = 0; n < 4000; n++) {
    let w = ''; const len = 4 + Math.floor(rnd() * 8); for (let i = 0; i < len; i++) w += pick();
    let v = w; const edits = 1 + Math.floor(rnd() * 2);
    for (let e = 0; e < edits; e++) {
      const p = Math.floor(rnd() * (v.length + 1)), kind = Math.floor(rnd() * 3);
      v = kind === 0 ? v.slice(0, p) + pick() + v.slice(p) : kind === 1 ? v.slice(0, p) + v.slice(p + 1) : v.slice(0, p) + pick() + v.slice(p + 1);
    }
    const d = E.gazEdit(w, v, 2);
    if (d <= 2) assert.ok(E.gazBits(E.gazMask(w) ^ E.gazMask(v)) <= 2 * 2, w + ' -> ' + v + ' is ' + d + ' edit(s) but the mask would discard it');
  }
  assert.strictEqual(E.gazBits(0), 0); assert.strictEqual(E.gazBits(-1), 32); assert.strictEqual(E.gazBits(0b1011), 3);
  // and it must actually filter: unrelated words are well outside the band, so the edit distance runs on few words, not all of them
  assert.ok(E.gazBits(E.gazMask('kadikoy') ^ E.gazMask('besiktas')) > 4 && E.gazBits(E.gazMask('caddesi') ^ E.gazMask('universitesi')) > 4, 'the mask separates nothing');
});
test('a query that already has a real match by name does not go looking for typos', () => {
  const G2 = E.gazDecode(JSON.parse(JSON.stringify(file)));
  const r = E.gazSearch(G2, 'galata kulesi', { org: ORG, limit: 10, typeWords: TW });
  assert.ok(r.length >= 1 && G.name[r[0].i] === 'Galata Kulesi');
  assert.strictEqual(G2.vocab, null, 'a typo pass ran although the name matched in full (one extra scan of every word, and worse results added)');
});
test('words that all exist but never together are not mistaken for typos', () => {
  const G2 = E.gazDecode(JSON.parse(JSON.stringify(file)));
  const r = E.gazSearch(G2, 'galata zeytin', { org: ORG, limit: 10, typeWords: TW });
  assert.deepStrictEqual(r, [], 'two real words with no place between them returned ' + r.length + ' rows');
});
test('the same thing mapped twice nearby is one answer; two far apart are two', () => {
  const raw = rawCity();
  const cafe = (id, lat) => ({ id: 'n' + id, tags: { name: 'Twin Cafe', amenity: 'cafe' }, lat, lon: 29.03 });
  raw.pois.push(cafe(901, 40.9700), cafe(902, 40.9712) /* 130 m: past the processor's 80 m, inside the engine's 150 m */, cafe(903, 40.9790) /* 1 km away */);
  const G2 = E.gazDecode(JSON.parse(JSON.stringify(P.build(raw).out)));
  const r = E.gazSearch(G2, 'twin cafe', { org: ORG, limit: 10, typeWords: TW });
  assert.strictEqual(r.length, 2, 'expected the pair to collapse and the far one to stay: ' + r.length + ' rows');
});

test('the typo helper is a real edit distance with an early exit', () => {
  assert.strictEqual(E.gazEdit('kadikoy', 'kadikoy', 2), 0);
  assert.strictEqual(E.gazEdit('kadikoy', 'kadikoyy', 2), 1);
  assert.strictEqual(E.gazEdit('kadikoy', 'besiktas', 2), 3, 'beyond the limit it must say so');
});

/* ---------------- how the page uses it ---------------- */

test('the geocoder asks the offline file first and the network only to top up a thin answer', () => {
  const html = H.html();
  const g = html.indexOf('async function geocode(q)'); assert.ok(g > 0, 'geocode not found');
  const body = html.slice(g, g + 900);
  assert.ok(body.indexOf('gazFind(') > 0 && body.indexOf('gazFind(') < body.indexOf('photonSearch('), 'the network is asked before the offline file');
  assert.ok(/gazThin\(local\.length,\s*q\)/.test(body), 'an answer with enough offline results still goes to the network');
  assert.ok(/gazThin\(top\.length \+ gz\.length,\s*q\)/.test(html) && /gazThin\(gz\.length,\s*q\)/.test(html), 'the search box or the planner asks the network about a place the file already found');
});
test('a name typed as one word is found, and ranks as the whole name when it is exactly that', () => {
  // "Zeytin Market" typed "zeytinmarket", "Moda Sahil Cafe" typed "modasahil" (a prefix of the joined name)
  const z = find('zeytinmarket'); assert.ok(z.length >= 1 && names(z)[0] === 'Zeytin Market', 'zeytinmarket: ' + names(z).join(' | '));
  const m = find('modasahil'); assert.ok(m.length >= 1 && names(m)[0] === 'Moda Sahil Cafe', 'modasahil: ' + names(m).join(' | '));
  // a short joined word is left alone (too many names would join into it), and a word that already is a name is not joined
  assert.ok(!find('modas').some(x => G.name[x.i] === 'Moda Sahil Cafe' && !x.fuzzy), 'a five-letter fragment should not join names');
  assert.strictEqual(names(find('moda'))[0], 'Moda');
});
test('the network is asked about a place only when the file found next to nothing, or when the query has a number', () => {
  assert.strictEqual(E.gazThin(0, 'galata'), true);
  assert.strictEqual(E.gazThin(1, 'galata'), true);
  assert.strictEqual(E.gazThin(2, 'galata kulesi'), false, 'two real answers from the file are enough');
  assert.strictEqual(E.gazThin(8, 'bagdat caddesi 120'), true, 'a house number is the one thing the file does not hold');
  assert.strictEqual(E.gazThin(8, 'kadikoy'), false);
});
test('turning online lookup off stops the network lookup, and is a switch in Settings in every language', () => {
  const html = H.html();
  const p = html.indexOf('async function photonSearch(q)'); assert.ok(p > 0);
  assert.ok(/onlineSearchPref/.test(html.slice(p, p + 500)), 'photonSearch ignores the setting');
  assert.ok(html.indexOf('id="swOnline"') > 0, 'no switch in Settings');
  for (const k of ['prefOnline', 'onlineHint', 'omniBus', 'omniRecent', 'omniLoading', 'omniOnline', 'omniMore'])
    assert.ok((html.match(new RegExp('\\b' + k + ':"', 'g')) || []).length >= 4, k + ' is missing in a language');
});
test('the planner no longer hides a result just for being near a stop', () => {
  const html = H.html();
  const d = html.indexOf('function dedupeGeo(geo, local)'); assert.ok(d > 0);
  const body = html.slice(d, d + 400);
  // after the same-name test comes a name-prefix condition AND the distance, not the distance alone
  assert.ok(/\|\|\s*\(foldQ\(g\.name\)\.startsWith/.test(body), 'dedupeGeo still drops every result within 200 m of a stop');
});

/* ---------------- the real file, once it exists ---------------- */

test('the shipped places file for every city that has one decodes and answers a plain query', () => {
  const seen = [];
  for (const city of Object.keys(JSON.parse(fs.readFileSync(path.join(H.DATA, 'cities.json'), 'utf8')))) {
    const f = path.join(H.DATA, 'places-' + city + '.json');
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.strictEqual(j.v, 1, city + ': unknown format');
    const g = E.gazDecode(j);
    assert.ok(g.n > 500, city + ': only ' + g.n + ' places');
    for (const k of ['t', 'd', 'h', 'r', 'la', 'lo']) assert.strictEqual(j[k].length, g.n, city + ': column ' + k);
    /* the dump is fetched by box, so nearly every place lies inside it. A few legitimately do not: a district whose centre
       is beyond the box (it straddles it), and a long road whose middle is. More than a few percent would mean the dump
       was fetched for the wrong place, which is what this is here to catch. */
    let outside = 0; for (let i = 0; i < g.n; i++) if (g.lat[i] < j.box.s - 0.01 || g.lat[i] > j.box.n + 0.01 || g.lng[i] < j.box.w - 0.01 || g.lng[i] > j.box.e + 0.01) outside++;
    assert.ok(outside / g.n < 0.03, city + ': ' + outside + ' of ' + g.n + ' places are outside the city box');
    // the district names that are in the file are the ones that are searchable
    const d0 = g.districts[0]; assert.ok(E.gazSearch(g, d0, { limit: 5 }).length > 0, city + ': cannot find its own district ' + d0);
    seen.push(city);
  }
  assert.ok(true, seen.join(','));
});
