/* Bus and ferry announcements.
 *
 * Rail faults come from Metro İstanbul's page through disruptions.json. Buses (İETT, read live in the browser)
 * and ferries (Şehir Hatları, scraped) have notices of their own, and they are free text in capital letters or
 * in an undocumented page format — which is how a wrong one gets shown. Everything here is checked against REAL
 * data: a day's İETT feed saved as a fixture (18 Oct 2026, 179 notices), the real route stop lists, and three real
 * Şehir Hatları pages.
 *
 * The rule the parser is held to: it states structure only where it can CHECK it. A detour is a detour only if
 * both stops it names are on the route, in travel order; otherwise the operator's own sentence is shown and
 * nothing is drawn. A wrong detour drawn on a route is worse than no detour.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');
const F = require('../scrape-ferry.cjs');

const FIX = path.join(__dirname, 'fixtures');
const fixture = n => fs.readFileSync(path.join(FIX, n), 'utf8');

function pure() {
  const html = H.html();
  const a = html.indexOf('/* ==NOTICES-PURE-START== */'), b = html.indexOf('/* ==NOTICES-PURE-END== */');
  assert.ok(a > 0 && b > a, 'the bus-notice parser markers are not in the built page');
  const mod = { exports: {} };
  new Function('module', 'exports', html.slice(a, b) +
    '\nmodule.exports={parseIettNotices,noticeAscii,noticeStopKey,noticeMentions,noticeDetour,noticeRoad,noticeCause,noticeTitle};'
  )(mod, mod.exports);
  return mod.exports;
}
const ROWS = JSON.parse(fixture('iett-duyurular-2026-10-18.json'));
const GRAPH = JSON.parse(fs.readFileSync(path.join(H.DATA, 'bus-data-istanbul.json'), 'utf8')).graph;
const dirsOf = ref => GRAPH.filter(g => g.ref === ref);
const stop = name => [41, 29, name];
const route = names => [{ dir: 0, head: 'X', stops: names.map(stop) }];

/* ---------------- the detour check, on toy routes ---------------- */

test('a detour is read only between two stops that are on the route, in travel order', () => {
  const P = pure(), r = route(['ALFA', 'BETA', 'GAMA', 'DELTA', 'EPSILON']);
  const ok = P.noticeDetour(P.noticeAscii('ARAÇLARIMIZ BETA DURAGINDAN GÜZERGAH DISINA ÇIKARAK DELTA DURAGINDAN GÜZERGAHA GIRECEKTIR'), r);
  assert.ok(ok, 'a plain detour was not read');
  assert.deepStrictEqual([ok.ia, ok.ib], [1, 3]);
  // the same stops in the other order on this direction: buses cannot rejoin BEHIND where they left
  assert.strictEqual(P.noticeDetour(P.noticeAscii('DELTA DURAGINDAN GÜZERGAH DISINA ÇIKARAK BETA DURAGINDAN GÜZERGAHA GIRER'), r), null);
  // a stop that is not on the route
  assert.strictEqual(P.noticeDetour(P.noticeAscii('BETA DURAGINDAN GÜZERGAH DISINA ÇIKARAK OMEGA DURAGINDAN GÜZERGAHA GIRER'), r), null);
  // a name with no "stop" word after it is a road or a district, not a stop
  assert.strictEqual(P.noticeDetour(P.noticeAscii('BETA DURAGINDAN GÜZERGAH DISINA ÇIKARAK DELTA CADDESI UZERINDEN GÜZERGAHA GIRER'), r), null);
  // not a detour at all: nobody rejoins anything
  assert.strictEqual(P.noticeDetour(P.noticeAscii('BETA DURAGI KAPALIDIR'), r), null);
});

test('a stop that is SHUT is not the stop buses leave at', () => {
  const P = pure(), r = route(['ALFA', 'BETA', 'GAMA', 'DELTA', 'EPSILON']);
  // opens by naming the shut stop (BETA); buses actually leave at GAMA
  const d = P.noticeDetour(P.noticeAscii('YOGUN TRAFIK NEDENIYLE BETA DURAGI KAPALIDIR. ARAÇLARIMIZ GAMA DURAGINDAN GÜZERGAH DISINA ÇIKARAK EPSILON DURAGINDAN GÜZERGAHA GIRECEKTIR'), r);
  assert.ok(d, 'the detour was not read');
  assert.strictEqual(d.a[2], 'GAMA', 'the shut stop was taken as the place buses leave the route');
});

test('a leave stop that is two different stops is a guess, so nothing is drawn', () => {
  const P = pure();
  const r = route(['ALFA', 'KADIKÖY ÇARŞI', 'BETA', 'KADIKÖY ÇARŞI', 'DELTA']);          // the name is stops 1 AND 3
  assert.strictEqual(P.noticeDetour(P.noticeAscii('KADIKÖY DURAGINDAN GÜZERGAH DISINA ÇIKARAK DELTA DURAGINDAN GÜZERGAHA GIRER'), r), null);
  // but the same name with the generic word dropped IS found when it is one stop
  const one = route(['ALFA', 'KADIKÖY ÇARŞI', 'BETA', 'DELTA']);
  const d = P.noticeDetour(P.noticeAscii('KADIKÖY DURAGINDAN GÜZERGAH DISINA ÇIKARAK DELTA DURAGINDAN GÜZERGAHA GIRER'), one);
  assert.ok(d && d.ia === 1 && d.ib === 3, 'a stop named by its short name was not found');
});

test('stop names are compared the way the feed writes them', () => {
  const P = pure();
  assert.strictEqual(P.noticeStopKey('ŞİŞLİ MERKEZ'), 'SISLI MERKEZ');
  assert.strictEqual(P.noticeStopKey('Kadıköy Durağı'), 'KADIKOY DURAGI'.replace(/\s+DURAGI$/, ''));
  assert.strictEqual(P.noticeAscii('çiftlik ığüşö'), 'CIFTLIK IGUSO');
  // the leading stop number the feed sometimes prints ("52.HASANPASA") is not part of the name
  const r = route(['ALFA', 'HASANPAŞA', 'BETA', 'ÇİFTLİK', 'GAMA']);
  const d = P.noticeDetour(P.noticeAscii('52.HASANPASA DURAGINDAN GÜZERGAHTAN ÇIKIP 55.ÇIFTLIK DURAGINDAN GÜZERGAHA GIRECEKTIR'), r);
  assert.ok(d && d.ia === 1 && d.ib === 3, 'a numbered stop was not found');
});

test('a closed road is named from the road-type word, never from the reason in front of it', () => {
  const P = pure();
  const road = s => P.noticeRoad(s, P.noticeAscii(s));
  assert.strictEqual(road('MAÇ NEDENIYLE RECEP PEKER CADDESI KAPALIDIR. ARAÇLARIMIZ'), 'RECEP PEKER CADDESI');
  assert.strictEqual(road('YOGUN TRAFIK NEDENIYLE FATIH BULVARI KAPALIDIR.'), 'FATIH BULVARI');
  assert.strictEqual(road('29 EKIM PROVASI SEBEBI ILE VATAN CADDESI KAPALI.'), 'VATAN CADDESI');
  assert.strictEqual(road('PARKLANMA NEDENIYLE ÇAMLIK CADDESI DURAK MEVKI KAPALI.'), 'ÇAMLIK CADDESI');
  assert.strictEqual(road('TRAFIK YOGUNLUGU NEDENI ILE TEM YOLU KAPALIDIR.'), 'TEM YOLU');
  assert.strictEqual(road('BAYAZIT KAPALI OLDUGUNDAN ARAÇLARIMIZ AKSARAYDAN RINK ÇALISIR'), null, 'a district was taken for a road');
});

test('titles keep the Turkish letters of a verified stop and do not invent a combining dot', () => {
  const P = pure();
  assert.strictEqual(P.noticeTitle('KİRAZLITEPE MERKEZ', true), 'Kirazlıtepe Merkez');
  assert.strictEqual(P.noticeTitle('ÇİFTLİK', true), 'Çiftlik');
  assert.ok(!/[̇]/.test(P.noticeTitle('İSKİ ÇALIŞMASI')), 'a combining dot above leaked into a title');
});

/* ---------------- the real feed ---------------- */

test('the real feed: what can be checked is drawn, what cannot stays the operator\'s own sentence', () => {
  const P = pure();
  const out = P.parseIettNotices(ROWS, dirsOf, 0);
  const verified = out.filter(e => e.detour);
  assert.ok(verified.length >= 15, 'only ' + verified.length + ' of the feed\'s detours verified against the route stops');
  for (const e of verified) {
    const dir = dirsOf(e.ref).find(d => d.dir === e.detour.dir);
    assert.ok(dir, e.ref + ': the detour names a direction the route does not have');
    assert.ok(e.detour.ia < e.detour.ib && e.detour.ib - e.detour.ia <= 40, e.ref + ': ' + JSON.stringify(e.detour));
    assert.ok(dir.stops[e.detour.ia] && dir.stops[e.detour.ib], e.ref + ': the detour points at a stop that is not there');
    assert.ok(e.tpl && e.tpl.a && e.tpl.b, e.ref + ': a drawn detour has no stop names to say');
  }
  // every notice that was NOT read keeps the operator's words, so it can be shown as they wrote it
  out.filter(e => !e.tpl).forEach(e => assert.ok(e.messageTr && e.messageTr.length > 5, e.ref + ': an unread notice lost its text'));
  // the "closed STOP" notice (48T) must not have become a detour that starts at the closed stop
  assert.ok(!out.some(e => e.ref === '48T' && e.tpl && e.tpl.a === 'Taksim'), '48T: the shut stop was taken as the leave stop');
  // ids are unique: the feed lists the same notice more than once
  assert.strictEqual(new Set(out.map(e => e.id)).size, out.length, 'two notices share an id');
});

test('the real feed: a route that is "back to normal" is not announced, and every row is accounted for', () => {
  const P = pure();
  const out = P.parseIettNotices(ROWS, dirsOf, 0);
  assert.ok(!out.some(e => /NORMALE DON/i.test(P.noticeAscii(e.messageTr))), 'a notice saying the route is back to normal was shown as a fault');
  // every ref in the feed shows up in the output, except a ref whose only notice was "back to normal"
  const refs = new Set(ROWS.map(r => r.HATKODU)), got = new Set(out.map(e => e.ref));
  const lost = [...refs].filter(r => !got.has(r));
  assert.ok(lost.length <= 1, 'notices were dropped for: ' + lost.join(', '));
});

test('cancelled departures: one entry per line, in time order, and a departure that has already gone is not listed', () => {
  const P = pure();
  const all = P.parseIettNotices(ROWS, dirsOf, 0).filter(e => e.kind === 'trips');
  assert.ok(all.length >= 20, 'too few lines with cancelled departures: ' + all.length);
  all.forEach(e => {
    const times = e.tpl.list.map(x => x.slice(0, 5));
    assert.deepStrictEqual(times, times.slice().sort(), e.ref + ': departures are not in time order');
    assert.strictEqual(e.tpl.n, e.tpl.list.length);
  });
  assert.strictEqual(P.parseIettNotices(ROWS, dirsOf, 24 * 60 - 1).filter(e => e.kind === 'trips').length, 0,
    'a departure at 15:27 is still announced as cancelled at 23:59');
  // 16:00: only the later ones remain
  const at16 = P.parseIettNotices(ROWS, dirsOf, 16 * 60).filter(e => e.kind === 'trips');
  at16.forEach(e => e.tpl.list.forEach(x => assert.ok(+x.slice(0, 2) * 60 + +x.slice(3, 5) >= 16 * 60 - 2, e.ref + ' lists ' + x + ' after 16:00')));
});

test('delays say how late, from where, and why only when the notice says so', () => {
  const P = pure();
  const d = P.parseIettNotices([{ HATKODU: '14F', HAT: 'X', TIP: 'Günlük', GUNCELLEME_SAATI: 'Kayit Saati: 10:00',
    MESAJ: 'GÜZERGAHTAKI YOGUN TRAFIK NEDENIYLE ARAÇLARIMIZ ATASOY KALKISLI SEFERLERINE 40 DAKIKA VE ÜZERI RÖTARLI HAREKET ETMEKTEDIR.' }], dirsOf, 0);
  assert.strictEqual(d.length, 1);
  assert.deepStrictEqual([d[0].kind, d[0].tpl.min, d[0].tpl.from, d[0].tpl.cause, d[0].tpl.both], ['delay', 40, 'Atasoy', 'traffic', false]);
  const both = P.parseIettNotices([{ HATKODU: '98H', HAT: 'X', TIP: 'Günlük', GUNCELLEME_SAATI: 'Kayit Saati: 10:00',
    MESAJ: 'GÜZERGAHTAKI YOGUN TRAFIK NEDENIYLE ARAÇLARIMIZ HER IKI YÖNDE SEFERLERINE 20 DAKIKA VE ÜZERI RÖTARLI HAREKET ETMEKTEDIR.' }], dirsOf, 0);
  assert.strictEqual(both[0].tpl.both, true);
});

test('a notice that matches no shape is passed through whole, never summarised', () => {
  const P = pure();
  const o = P.parseIettNotices([{ HATKODU: '91E', HAT: 'X', TIP: 'Günlük', GUNCELLEME_SAATI: 'Kayit Saati: 09:00',
    MESAJ: 'BAYAZIT KAPALI OLDUGUNDAN ARAÇLARIMIZ AKSARAYDAN RINK ÇALISIR' }], dirsOf, 0);
  assert.strictEqual(o.length, 1);
  assert.strictEqual(o[0].tpl, undefined, 'a sentence nobody understood was given a structure');
  assert.strictEqual(o[0].messageTr, 'BAYAZIT KAPALI OLDUGUNDAN ARAÇLARIMIZ AKSARAYDAN RINK ÇALISIR');
  assert.strictEqual(P.parseIettNotices(null, dirsOf, 0).length, 0);
  assert.strictEqual(P.parseIettNotices([{ HATKODU: '1' }, null, { MESAJ: 'x' }], dirsOf, 0).length, 0);
});

/* ---------------- the words, in every language ---------------- */

test('every sentence a notice can be made of exists in all four languages, and fills every hole', () => {
  const I = H.i18nValues(), s = H.appScript();
  const keys = ['nDetour', 'nRoad', 'nRoadWhy', 'nWhyOnly', 'nDelay', 'nDelayFrom', 'nDelayBoth', 'nShort', 'nShortB', 'nTrips', 'nMore', 'nTripsSummary',
    'busNotices', 'detourDrawn', 'annRailSub', 'annBusSub', 'annFerrySub', 'annMore', 'annLess', 'annFootExtra',
    'nCause_match', 'nCause_traffic', 'nCause_works', 'nCause_utility', 'nCause_underpass', 'nCause_asphalt', 'nCause_slippery', 'nCause_parking', 'nCause_event',
    'ttl:Detour', 'ttl:Delays', 'ttl:Terminal change', 'ttl:Trips cancelled', 'ttl:Timetable change', 'ttl:Extra trips', 'ttl:Ferry notice', 'ttl:Seasonal timetable'];
  for (const L of ['en', 'tr', 'ar', 'fr']) for (const k of keys) assert.ok(I[L][k] && I[L][k].length > 1, L + ' is missing ' + k);
  // the causes the parser can emit are exactly the causes the words cover
  const emitted = new Set((/function noticeCause\(text\) \{[\s\S]*?\n\}/.exec(s)[0].match(/return '(\w+)'/g) || []).map(x => x.slice(8, -1)));
  emitted.forEach(c => assert.ok(I.en['nCause_' + c], 'the parser can say "' + c + '" and nothing translates it'));
  // build the renderer from the shipped page and check no hole is left unfilled
  const a = s.indexOf('function noticeMessage('), b = s.indexOf('function noticesForRide(');
  assert.ok(a > 0 && b > a, 'noticeMessage is not in the shipped page');
  const noticeMessage = new Function('I18N', s.slice(a, b) + '\nreturn noticeMessage;')(I);
  const tpls = [
    { k: 'detour', a: 'Hasanpaşa', b: 'Çiftlik', road: 'Fatih Bulvari', cause: 'traffic' },
    { k: 'detour', a: 'A', b: 'B', road: null, cause: null },
    { k: 'delay', min: 40, from: 'Atasoy', both: false, cause: 'traffic' },
    { k: 'delay', min: 20, from: null, both: true, cause: null },
    { k: 'short', a: 'Hafız Sokak', b: 'Kaptan', cause: 'parking' },
    { k: 'short', a: 'Hafız Sokak', b: null, cause: null },
    { k: 'trips', n: 8, list: ['14:10 Üsküdar', '14:47 X', '15:50 Y', '16:20 Z', '17:00 A', '17:30 B', '18:00 C', '18:30 D'] },
  ];
  for (const L of ['en', 'tr', 'ar', 'fr']) for (const tpl of tpls) {
    const m = noticeMessage({ tpl }, L);
    assert.ok(m && !/[{}]/.test(m), L + ' ' + tpl.k + ' left a hole or said nothing: ' + m);
    if (tpl.a) assert.ok(m.indexOf(tpl.a) >= 0, L + ' lost the stop name ' + tpl.a);
  }
  assert.ok(/Fatih Bulvari is closed \(heavy traffic\)\. Buses leave the route at Hasanpaşa and rejoin it at Çiftlik\./.test(noticeMessage({ tpl: tpls[0] }, 'en')), 'the English sentence changed shape');
  assert.strictEqual(noticeMessage({}, 'en'), null);
});

/* ---------------- how the page uses them ---------------- */

test('bus notices join the same active list as rail faults, and raw ones skip the Turkish translator', () => {
  const s = H.appScript();
  assert.ok(/function activeDisruptions\(\)\{ return \(DISRUPTIONS\|\|\[\]\)\.concat\(SURFACE_NOTICES\)\.filter\(disruptionActive\); \}/.test(s),
    'activeDisruptions no longer includes the live bus notices');
  assert.ok(/let SURFACE_NOTICES = \[\];/.test(s), 'SURFACE_NOTICES is not declared where the earliest reader can see it');
  // a notice with a template speaks the reader's language; an unread bus notice is shown as written, BEFORE any translation is tried
  const fn = /function disText\(d\)\{[\s\S]*?\n\}/.exec(s)[0];
  const iTpl = fn.indexOf('d.tpl'), iBus = fn.indexOf("d.mode === 'bus'"), iTr = fn.indexOf('bestEffortTranslation');
  assert.ok(iTpl > 0 && iBus > iTpl && iTr > iBus, 'disText must try the template, then pass an unread bus notice through, before the translator');
  // a bus notice is never painted on a rail line that happens to share its code
  assert.ok(/function disruptionPaths\(d\)\{\s*if\(d\.mode === 'bus'\) return \[\];/.test(s), 'a bus notice can be drawn on a rail line');
  assert.ok(/function disruptionPoints\(d\)\{\s*if\(d\.mode === 'bus'\) return \[\];/.test(s), 'a bus notice can put a warning pin on a rail line');
});

test('İETT is read directly from the browser: allowed by the CSP, with the SOAP action it needs', () => {
  const html = H.html(), s = H.appScript();
  assert.ok(/connect-src[^"]*https:\/\/api\.ibb\.gov\.tr/.test(html), 'the CSP does not let the page talk to api.ibb.gov.tr');
  assert.ok(/'SOAPAction': '"http:\/\/tempuri\.org\/GetDuyurular_json"'/.test(s), 'the SOAP action is missing');
  assert.ok(/refreshBusNotices/.test(s) && /visibilityState === 'visible'/.test(s), 'the feed is not refreshed, or is polled in a hidden tab');
  assert.ok(/CITY_ID !== 'istanbul'/.test(s), 'İETT notices would be shown in other cities');
});

test('the announcements card groups bus notices, collapses them, and caps what it shows at first', () => {
  const s = H.appScript(), css = H.appStyle();
  assert.ok(/function busGroups\(list\)/.test(s) && /function annBusGroupHTML\(g\)/.test(s), 'bus groups are gone');
  assert.ok(/const ANN_BUS_SHOWN = (\d+);/.test(s) && +/const ANN_BUS_SHOWN = (\d+);/.exec(s)[1] <= 10, 'the bus section shows too many rows at once');
  assert.ok(/<button class="ann-sec" id="annBusSec" aria-expanded="\$\{_annBusOpen\}"/.test(s), 'the bus section is not a collapsible button');
  assert.ok(/\.ann-busbox\[hidden\]\{display:none;\}/.test(css), 'a collapsed bus section is not hidden');
  // what was verified comes first
  assert.ok(/g\.d\.kind === 'detour' \? \(g\.d\.tpl \? 0 : 1\)/.test(s), 'verified detours are no longer listed before unverified ones');
  // clicking a chip or a notice opens that bus line, with its route and notices
  assert.ok(/function openBusRoute\(ref\)\{[\s\S]*?setTab\('bus'\);[\s\S]*?selectBus\(row\.dataset\.id, row\)/.test(s), 'a bus notice no longer opens its route');
  assert.ok(/if\(d\.mode === 'bus'\)\{ openBusRoute\(d\.ref\); return; \}/.test(s), 'clicking a bus announcement does nothing');
});

test('a verified detour is drawn on the route, dashed, only from a stored direction and stop range', () => {
  const s = H.appScript();
  const fn = /function drawBusNotices\(ref, dirs, chains\)\{[\s\S]*?\n\}/.exec(s);
  assert.ok(fn, 'drawBusNotices is gone');
  assert.ok(/d\.mode === 'bus' && d\.ref === ref && d\.detour/.test(fn[0]), 'an unverified notice can be drawn');
  assert.ok(/dir\.stops\.slice\(d\.detour\.ia, d\.detour\.ib \+ 1\)/.test(fn[0]), 'the band is not the stretch between the two verified stops');
  assert.ok(/dashArray:'2,7'/.test(fn[0]), 'the detour is not dashed, the map\'s word for "not in normal service"');
  assert.ok(/drawBusNotices\(ref, dirs, chains\);/.test(s), 'the overlay is never drawn when a route is selected');
  assert.ok(/class=\\"bn-warn\\"/.test(s) || /class="bn-warn"/.test(s), 'a bus line with a notice carries no marker in the list');
});

test('a trip leg on a line with a notice says so', () => {
  const s = H.appScript();
  assert.ok(/const ns = noticesForRide\(s\);/.test(s) && /class="rw notice"/.test(s), 'the trip warnings do not show bus or ferry notices');
  assert.ok(/function noticesForRide\(s\)/.test(s), 'noticesForRide is gone');
});

/* ---------------- ferries ---------------- */

test('ferry: the announcement list and the three real pages read as the operator wrote them', () => {
  const items = F.parseList(fixture('sehirhatlari-list.html'));
  assert.ok(items.length >= 8, 'list read as ' + items.length);
  assert.strictEqual(items[0].id, '3811');
  assert.ok(/Maltepe-Adalar/.test(items[0].title));
  assert.ok(items.every(i => /^https:\/\/sehirhatlari\.istanbul\/tr\/duyurular\/.+-\d+$/.test(i.url)));
  const d = F.parseDetail(fixture('sehirhatlari-3811.html'));
  assert.ok(d, 'the page could not be read');
  assert.strictEqual(d.published, '2026-10-11');
  const text = F.messageOf(d.html);
  assert.ok(/Heybeliada kalkış saati: 15\.40 yerine 16\.10/.test(text), 'the changed times are not in the message: ' + text);
  assert.ok(!/<|&[a-z]+;/.test(text), 'markup or an entity leaked into the message: ' + text);
  assert.ok(!/Değerli yolcular/i.test(text) && !/Bilgilerinize/i.test(text), 'the salutation or sign-off was kept');
  // the Haliç page has a timetable grid after the paragraph: it is not in the message
  const h = F.messageOf(F.parseDetail(fixture('sehirhatlari-3803.html')).html);
  assert.ok(/Balat İskelesi/.test(h) && !/KALKIŞ|\d{2}:\d{2}/.test(h), 'the timetable grid leaked into the message: ' + h.slice(0, 200));
});

test('ferry: a notice is kept while its own dates say it matters, and no longer', () => {
  const ferry = H.json('ferry-lines.json'), list = F.parseList(fixture('sehirhatlari-list.html'));
  const read = (id, today, file) => F.readNotice(list.find(i => i.id === id), fixture(file), today, ferry);
  // Maltepe-Adalar: effective 12 Oct 2026, "from" only -> relevant for three weeks
  assert.ok(read('3811', '2026-10-18', 'sehirhatlari-3811.html'), 'a current timetable change was dropped');
  // announced the day before it takes effect: shown at once, and marked as not yet in force
  const ahead = read('3811', '2026-10-11', 'sehirhatlari-3811.html');
  assert.ok(ahead && ahead.starts === '2026-10-12', 'a change announced ahead of time is not marked with its start date');
  assert.strictEqual(read('3811', '2026-11-03', 'sehirhatlari-3811.html'), null, 'a three-week-old change is still announced');
  const cur = read('3811', '2026-10-18', 'sehirhatlari-3811.html');
  assert.strictEqual(cur.until, '2026-11-02');
  assert.strictEqual(cur.mode, 'ferry');
  assert.strictEqual(cur.ref, null, 'a route this map does not draw was pinned to one that it does');
  assert.strictEqual(cur.messageLang, 'tr', 'an untranslated notice must say it is Turkish');
  assert.ok(cur.url.indexOf('https://sehirhatlari.istanbul/') === 0);
  // Haliç regatta, 12-13 Sep: live on the day, history after, and it names a line we draw
  const on = read('3803', '2026-09-12', 'sehirhatlari-3803.html');
  assert.ok(on, 'the notice was dropped on the day it applies');
  assert.strictEqual(on.until, '2026-09-13');
  assert.strictEqual(on.ref, 'Haliç Hattı');
  assert.ok(on.lines.indexOf('Haliç Hattı') >= 0);
  assert.strictEqual(read('3803', '2026-09-14', 'sehirhatlari-3803.html'), null, 'last month\'s regatta is still announced');
  // "back to normal" Moda notice from June: long gone
  assert.strictEqual(read('3765', '2026-10-18', 'sehirhatlari-3765.html'), null);
});

test('ferry: a page that cannot be read gives nothing, never a wrong notice', () => {
  const ferry = H.json('ferry-lines.json'), item = { id: '1', title: 'x', url: 'https://sehirhatlari.istanbul/tr/duyurular/x-1' };
  assert.strictEqual(F.readNotice(item, '<html><body>nothing here</body></html>', '2026-10-18', ferry), null);
  assert.strictEqual(F.readNotice(item, '<input id="__VIEWSTATE" value="AAAA" />', '2026-10-18', ferry), null);
  assert.strictEqual(F.parseDetail(''), null);
  assert.deepStrictEqual(F.parseList('<html></html>'), []);
  assert.deepStrictEqual(F.ferryEntries('<a href="/tr/duyurular/x-1">x</a>', {}, '2026-10-18', ferry), [], 'a page that failed to download produced a notice');
});

test('ferry: dates are read as ranges, and a notice with none lasts a week', () => {
  assert.deepStrictEqual(F.datesIn('12-13 Eylül 2026 tarihlerinde', 2026).map(d => d.iso), ['2026-09-12', '2026-09-13']);
  assert.deepStrictEqual(F.datesIn('16 Ağustos 2026', 2026).map(d => d.iso), ['2026-08-16']);
  assert.strictEqual(F.datesIn('12 Ekim 2026 tarihinden itibaren', 2026)[0].from, true);
  assert.deepStrictEqual(F.windowOf('Bir duyuru', 'tarih yok', '2026-10-01'), { from: '2026-10-01', until: '2026-10-08' });
  assert.strictEqual(F.kindOf('23 Ağustos İptal Seferler Duyurusu').title, 'Trips cancelled');
  assert.strictEqual(F.kindOf('26 Temmuz 2026 Adalar-Bostancı Ek Seferi').title, 'Extra trips');
  assert.strictEqual(F.kindOf('ŞEHİR HATLARI KIŞ TARİFESİNE GEÇİYOR').title, 'Seasonal timetable');
});

test('ferry: the scraper carries the notices already published over a failed fetch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scrape-disruptions.cjs'), 'utf8');
  assert.ok(/ferry=JSON\.parse\(fs\.readFileSync\(OUT,'utf8'\)\)\.filter\(e=>e\.mode==='ferry'\)/.test(src), 'a failed ferry fetch would erase the ferry notices');
  assert.ok(/const all=keptManual\.concat\(metro, x, ferry\);/.test(src), 'ferry notices are not written to disruptions.json');
});
