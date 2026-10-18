/* ===========================================================================
   BUS ANNOUNCEMENTS — İETT's own service notices, read live in the browser.

   The Announcements card used to know about rail only (Metro İstanbul's status page, scraped
   every 30 minutes into disruptions.json). Buses and ferries are most of what people ride, and
   both publish notices of their own. İETT's is the better of the two for a static site: an
   open-data SOAP method on api.ibb.gov.tr (the host the app already uses for Metro İstanbul
   timetables) that answers with Access-Control-Allow-Origin: *, so the page can ask İETT
   directly. That is also the right design for the data: it is today's notices and it changes all
   day — the cancelled departures alone come and go every few minutes — which would have been one
   commit and one deploy every 30 minutes if it went through the repository the way rail does.

   WHAT THE FEED IS
   A list of { HATKODU, HAT, TIP, GUNCELLEME_SAATI, MESAJ }, in capital-letter Turkish with the
   diacritics half stripped ("IHLAMUR", "ÇIFTLIK", "YOGUN"). TIP is "Sefer" for one cancelled
   departure and "Günlük" for everything else: detours, delays, a terminal that has moved.

   WHAT IS DONE WITH IT
   Nothing is guessed. A notice is turned into structure only where it can be CHECKED:
     - a detour names the stop buses leave the route at and the stop they rejoin it at. Both must
       be found, by name, in that route's real stop list (the İETT GTFS graph) and in travel
       order, or the notice stays what it is — the original Turkish, flagged as such — and nothing is
       drawn. When both are found the stretch between them is drawn on the route;
     - a delay, a terminal change and a cancelled departure have a fixed shape, so they are read
       by it;
     - everything else is shown in the operator's own words.
   There is no translation of free text here: every sentence in English, Arabic or French comes
   from a template filled with names that were verified or copied, never composed.
   =========================================================================== */
/* ==NOTICES-PURE-START== */
const _NOTICE_MAP = { 'Ç': 'C', 'Ğ': 'G', 'İ': 'I', 'Ö': 'O', 'Ş': 'S', 'Ü': 'U', 'Â': 'A', 'Î': 'I', 'Û': 'U' };
/* Capital ASCII, one character for one character, so an index into the folded text is an index into
   the original (the original is what gets displayed). */
function noticeAscii(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[ÇĞİÖŞÜÂÎÛ]/g, function (c) { return _NOTICE_MAP[c]; });
}
/* A stop's name as it is compared: ASCII capitals, punctuation to single spaces, and the word for
   "stop" removed, because the feed's prose says "KADIKÖY DURAGINDAN" where the stop list says
   "KADIKÖY". */
function noticeStopKey(name) {
  return noticeAscii(name).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+(DURAGI|DURAK|DUR)$/, '').trim();
}
/* The names a stop answers to. The stop list is exact ("KADIKÖY ÇARŞI", "BOZKURT - ŞEHİT VOLKAN DUYSAK",
   "ŞİŞLİ MERKEZ") and the prose is how people talk ("KADIKÖY", "BOZKURT"), so a stop also answers to its
   name before a dash and to its name without a generic last word. The exact name always counts too. */
const _GENERIC_TAIL = /\s+(CARSI|MERKEZ|ISKELE|ISKELESI|PERON|PERONLAR|PERONU|GARAJI|MEYDAN|KAVSAGI)$/;
function noticeStopKeys(name) {
  const full = noticeStopKey(name), set = [full];
  const dash = noticeAscii(name).split(/\s+-\s+/)[0];
  if (dash && dash !== noticeAscii(name)) set.push(noticeStopKey(dash));
  set.slice().forEach(function (k) { const t = k.replace(_GENERIC_TAIL, ''); if (t !== k && t.length >= 4) set.push(t); });
  return set.filter(function (k, i) { return k.length >= 3 && set.indexOf(k) === i; });
}
const _STOP_WORD = '(?:DURAGINDAN|DURAGINDA|DURAGINA|DURAGI|DURAKTAN|DURAGINI|DUR)(?![A-Z0-9])';
function _reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Where in `text` (already noticeAscii'd) a stop of this route is NAMED AS A STOP: a name it answers to, then
   a word for stop. The stop word is required: without it a place inside the road's name ("ULUDAG CADDESI")
   would be taken for a stop. Returns [{ at, end, key }] in text order; where two names overlap the longer one
   wins ("KADIKÖY ISKELE" over "KADIKÖY"). */
function noticeMentions(text, dirs) {
  const keys = {};
  dirs.forEach(function (d) { (d.stops || []).forEach(function (st) { noticeStopKeys(st[2]).forEach(function (k) { keys[k] = 1; }); }); });
  const all = [];
  Object.keys(keys).sort(function (a, b) { return b.length - a.length; }).forEach(function (key) {
    const re = new RegExp('(?:^|[^A-Z0-9])((?:\\d{1,3}\\s*\\.\\s*)?' + _reEsc(key).replace(/ /g, '[ .]+') + ')\\s*\\.?\\s*' + _STOP_WORD, 'g');
    let m;
    while ((m = re.exec(text))) {
      const at = m.index + m[0].indexOf(m[1]), end = m.index + m[0].length;
      if (!all.some(function (h) { return at < h.end && end > h.at; })) all.push({ at: at, end: end, key: key });   // the longer name was tried first
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  });
  return all.sort(function (a, b) { return a.at - b.at; });
}
/* the indices, in one direction of the route, of every stop that answers to `key` */
function noticeStopsNamed(dir, key) {
  const out = [];
  (dir.stops || []).forEach(function (st, i) { if (noticeStopKeys(st[2]).indexOf(key) >= 0) out.push(i); });
  return out;
}

/* The two stops of a detour and where they sit on the route, or null when they cannot be verified.
   Buses LEAVE the route at the first stop the text names and REJOIN it at the last stop named before
   "GÜZERGAHA GİRECEKTİR". On some direction of the route the leave stop must be named by exactly ONE stop
   (a name that is two different stops is a guess), the rejoin stop must come after it in travel order, and
   the two must be close enough to be a detour — a notice that names the route's two termini is a misread. */
function noticeDetour(text, dirs) {
  const rejoin = /GUZERGAH\w*\s+(?:GIR|DON|KATIL)/.exec(text);
  if (!rejoin) return null;
  /* The stop buses LEAVE at is the one named just before the leaving verb. Not simply the first stop the
     text names: "TAKSIM DURAGI KAPALIDIR. ARAÇLARIMIZ ... BEŞİKTAŞ STADYUMU DURAĞINDAN GÜZERGAH DIŞINA
     ÇIKARAK" opens with the stop that is SHUT, which is not where they leave. */
  const leave = /GUZERGAH\w*\s+DISINA\s+CIK|GUZERGAH\w*\s+(?:CIK|AYRIL)|\b(?:CIKARAK|CIKIP|CIKAR|CIKARLAR|AYRILARAK|AYRILACAK|AYRILIR|AYRILIP)\b/.exec(text);
  if (!leave || leave.index > rejoin.index) return null;
  const ms = noticeMentions(text, dirs);
  const A = ms.filter(function (h) { return h.end <= leave.index && leave.index - h.end <= 30; }).pop();
  const B = ms.filter(function (h) { return h.at > leave.index && h.end <= rejoin.index + 1; }).pop();
  if (!A || !B || A.key === B.key) return null;
  for (let d = 0; d < dirs.length; d++) {
    const ia = noticeStopsNamed(dirs[d], A.key);
    if (ia.length !== 1) continue;
    const ib = noticeStopsNamed(dirs[d], B.key).filter(function (i) { return i > ia[0]; });
    if (!ib.length) continue;
    const a = ia[0], b = ib[0];
    if (b - a <= 40) return { dir: dirs[d].dir, ia: a, ib: b, a: dirs[d].stops[a], b: dirs[d].stops[b] };
  }
  return null;
}

/* Why a road is shut, as a key the templates know. Only what is stated is reported. */
function noticeCause(text) {
  if (/\bMAC\b.{0,30}(?:NEDEN|SEBEB|DOLAYI)/.test(text) || /^MAC /.test(text)) return 'match';
  if (/ISKI\s+CALISMA/.test(text)) return 'utility';
  if (/ALT\s*GECIT\s+CALISMA/.test(text)) return 'underpass';
  if (/ASFALT/.test(text)) return 'asphalt';
  if (/KAYGAN\s+ZEMIN/.test(text)) return 'slippery';
  if (/PARKLANMA|ARAC\s+PARK/.test(text)) return 'parking';
  if (/PROVA|TOREN|KUTLAMA|YURUYUS|MITING/.test(text)) return 'event';
  if (/YOGUN\s+TRAFIK|TRAFIK\s+YOGUNLUGU/.test(text)) return 'traffic';
  if (/CALISMA|INSAAT|ONARIM|BAKIM/.test(text)) return 'works';
  return null;
}
/* "MAÇ NEDENIYLE RECEP PEKER CADDESI KAPALIDIR" -> "RECEP PEKER CADDESI": the words just before a road-type
   word, never reaching back into the reason, cut from the ORIGINAL so the diacritics survive. null when the
   text names no road. */
const _ROAD_TYPE = '(?:CADDESI|CADDE|CAD\\.?|SOKAK|SOKAGI|SK\\.|BULVARI|BLV\\.?|YOLU|OTOYOLU|KOPRUSU|TUNELI|YANYOLU)';
const _ROAD_STOP = /^(?:NEDENIYLE|NEDENI|NEDEN|ILE|SEBEBI|SEBEBIYLE|DOLAYI|YONU|YONUNE|YONUNDE|MAHALLESI|GIDIS|GIDISTE|GIDISLERDE|DONUS|DONUSTE|DONUSLERDE|VE|ISKI|CALISMASI|CALISMASINDAN|ASFALT|ALTGECIT|KAYGAN|ZEMIN|YOGUN|TRAFIK|MAC|PROVASI|ARACLARIMIZ|OTOBUSLERIMIZ|OTOLARIMIZ|KAPALI|KAPALIDIR|\d+)$/;
function noticeRoad(orig, text) {
  const re = new RegExp("((?:[A-Z0-9.'-]+\\s+){1,3})(" + _ROAD_TYPE + ')(?=[\\s.][^.]{0,70}?KAPALI)', 'g');
  let m;
  while ((m = re.exec(text))) {
    const words = m[1].trim().split(/\s+/), keep = [];
    for (let i = words.length - 1; i >= 0; i--) { if (_ROAD_STOP.test(words[i].replace(/\.$/, ''))) break; keep.unshift(words[i]); }
    if (!keep.length) continue;
    const typeAt = m.index + m[1].length;                                  // where the road-type word starts
    const nameLen = keep.join(' ').length, nameAt = typeAt - 1 - nameLen;   // one space between name and type
    return orig.slice(nameAt, typeAt + m[2].length).replace(/\s+/g, ' ').trim();
  }
  return null;
}
/* Capitalised for display. A name that was verified against the stop list keeps the stop list's own spelling
   and is cased by Turkish rules (its "İ" and "I" are real, so "KİRAZLITEPE" -> "Kirazlıtepe"). A name taken
   from the notice's prose has lost which was which — the feed writes "ISKI" for İSKİ — so the plain rule is
   used there: more often right, and never a stray combining dot. */
function noticeTitle(s, turkish) {
  const low = turkish ? String(s || '').toLocaleLowerCase('tr') : String(s || '').replace(/İ/g, 'i').toLowerCase();
  return low.replace(/(^|[\s'’(/-])([a-zçğıöşüâ])/g, function (_, a, b) { return a + (turkish ? b.toLocaleUpperCase('tr') : b.toUpperCase()); }).replace(/\s+/g, ' ').trim();
}
function noticeStopName(s) { return noticeTitle(String(s || '').replace(/\s*\bDUR\.?$/i, '')); }

function _hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function _hhmm(s) { const m = /(\d{1,2})[:.](\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function _pad2(n) { return (n < 10 ? '0' : '') + n; }

/* The whole feed -> notices. `dirsOf(ref)` returns the route's directions [{dir, head, stops:[[lat,lng,name]]}]
   (empty before the bus data has loaded, which only costs the map band); `nowMin` is the minute of the
   day in İstanbul, so a departure that has already gone is not announced as cancelled. */
function parseIettNotices(rows, dirsOf, nowMin) {
  const out = [], trips = {};
  for (const r of (rows || [])) {
    if (!r || !r.HATKODU || !r.MESAJ) continue;
    const ref = String(r.HATKODU).trim(), orig = String(r.MESAJ).replace(/\s+/g, ' ').trim(), N = noticeAscii(orig);
    const rec = (/(\d{1,2}[:.]\d{2})/.exec(r.GUNCELLEME_SAATI || '') || [])[1] || null;
    const base = { mode: 'bus', ref: ref, scope: 'note', source: 'iett', route: r.HAT ? String(r.HAT).replace(/\s+/g, ' ').trim() : null, recorded: rec, messageTr: orig };
    if (/NORMALE\s+DON/.test(N)) continue;                                   // "the route is back to normal": nothing to announce
    // ---- one cancelled departure
    let m = /^(.*?)\s*DAN\s+SAAT\s+(\d{1,2})[:.](\d{2})\s+DE\s+HAREKET\s+ETMESI\s+PLANLANAN\s+SEFERIMIZ/.exec(N);
    if (m) {
      const at = (+m[2]) * 60 + (+m[3]);
      if (nowMin != null && at < nowMin - 2) continue;                       // already gone
      const t = trips[ref] = trips[ref] || { ref: ref, route: base.route, times: [] };
      const from = noticeStopName(orig.slice(0, m[1].length));
      if (!t.times.some(function (x) { return x.at === at && x.from === from; })) t.times.push({ at: at, from: from });
      continue;
    }
    // ---- a delay
    m = /(\d{1,3})\s*(?:DAKIKA|DK)\s+(?:VE\s+)?UZERI\s+ROTAR/.exec(N);
    if (m) {
      const f = /ARACLARIMIZ\s+(.+?)\s+KALKISLI/.exec(N), both = /HER\s+IKI\s+YONDE/.test(N);
      const tpl = { k: 'delay', min: +m[1], from: f ? noticeStopName(orig.slice(f.index + f[0].indexOf(f[1]), f.index + f[0].indexOf(f[1]) + f[1].length)) : null,
                    both: both, cause: noticeCause(N) };
      out.push(Object.assign({}, base, { id: 'bus:' + ref + ':delay:' + _hash(N), kind: 'delay', severity: 'minor', title: 'Delays', tpl: tpl }));
      continue;
    }
    // ---- a terminal that moved: trips end at one stop (and, if said, start again from another)
    const endAt = /DURAG\w*\s+(?:SEFERLERINI\s+BITIR|BITIS\s+YAP)/.exec(N);
    if (endAt) {
      const dirsT = typeof dirsOf === 'function' ? dirsOf(ref) : [], ms = dirsT.length ? noticeMentions(N, dirsT) : [];
      const A = ms.filter(function (h) { return h.end <= endAt.index + 12 && h.end >= endAt.index; }).pop();      // the mention that IS the ending phrase's stop
      if (A) {
        const nameOf = function (h) { for (const d of dirsT) { const ix = noticeStopsNamed(d, h.key); if (ix.length) return noticeTitle(d.stops[ix[0]][2], true); } return noticeTitle(h.key); };
        const restart = /AYNI\s+DURAKTAN/.test(N) ? null : ms.filter(function (h) { return h.at > endAt.index + endAt[0].length; })[0];
        out.push(Object.assign({}, base, { id: 'bus:' + ref + ':short:' + _hash(N), kind: 'shortturn', severity: 'partial', title: 'Terminal change',
          tpl: { k: 'short', a: nameOf(A), b: restart ? nameOf(restart) : null, cause: noticeCause(N) } }));
        continue;
      }
    }
    // ---- a detour
    const dirs = typeof dirsOf === 'function' ? dirsOf(ref) : [];
    const det = dirs.length ? noticeDetour(N, dirs) : null;
    if (det) {
      out.push(Object.assign({}, base, { id: 'bus:' + ref + ':detour:' + _hash(N), kind: 'detour', severity: 'partial', title: 'Detour',
        detour: { dir: det.dir, ia: det.ia, ib: det.ib },
        tpl: { k: 'detour', a: noticeTitle(det.a[2], true), b: noticeTitle(det.b[2], true), road: noticeRoad(orig, N) ? noticeTitle(noticeRoad(orig, N)) : null, cause: noticeCause(N) } }));
      continue;
    }
    // ---- anything else: the operator's words, as they are
    const isDetour = /GUZERGAH/.test(N) && /(?:CIK|AYRIL|GIR)/.test(N);
    out.push(Object.assign({}, base, { id: 'bus:' + ref + ':' + (isDetour ? 'detour' : 'info') + ':' + _hash(N), kind: isDetour ? 'detour' : 'info',
      severity: isDetour ? 'partial' : 'minor', title: isDetour ? 'Detour' : 'Service notice' }));
  }
  const seen = {}, uniq = [];
  out.forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; uniq.push(e); } });     // the feed lists the same notice more than once
  out.length = 0; uniq.forEach(function (e) { out.push(e); });
  for (const ref in trips) {
    const t = trips[ref]; t.times.sort(function (a, b) { return a.at - b.at; });
    const key = t.times.map(function (x) { return x.at + x.from; }).join('|');
    out.push({ id: 'bus:' + ref + ':trips:' + _hash(key), mode: 'bus', ref: ref, scope: 'note', source: 'iett', route: t.route, kind: 'trips', severity: 'minor',
      title: 'Trips cancelled', tpl: { k: 'trips', n: t.times.length, list: t.times.map(function (x) { return _pad2(Math.floor(x.at / 60)) + ':' + _pad2(x.at % 60) + (x.from ? ' ' + x.from : ''); }) },
      messageTr: t.times.length + ' sefer: ' + t.times.map(function (x) { return _pad2(Math.floor(x.at / 60)) + ':' + _pad2(x.at % 60) + (x.from ? ' ' + x.from : ''); }).join(', ') });
  }
  return out;
}
/* ==NOTICES-PURE-END== */

/* ---- the words ------------------------------------------------------------------------------
   Every sentence comes from the I18N table in the reader's language, filled with names that were
   verified against the route (or copied from the operator's text). {a} {b} {road} {cause} {m} {from}
   {list} {n} are the only holes. */
function noticeMessage(d, L) {
  const p = d && d.tpl; if (!p) return null;
  const T = I18N[L] || I18N.en, tt = function (k) { return T[k] !== undefined ? T[k] : I18N.en[k]; };
  const fill = function (k, o) { return String(tt(k)).replace(/\{(\w+)\}/g, function (m, x) { return o[x] != null ? o[x] : m; }); };
  const why = p.cause ? tt('nCause_' + p.cause) : '';
  const parts = [];
  if (p.k === 'detour') {
    if (p.road) parts.push(why ? fill('nRoadWhy', { road: p.road, cause: why }) : fill('nRoad', { road: p.road }));
    else if (why) parts.push(fill('nWhyOnly', { cause: why }));
    parts.push(fill('nDetour', { a: p.a, b: p.b }));
  } else if (p.k === 'delay') {
    parts.push(p.both ? fill('nDelayBoth', { m: p.min }) : p.from ? fill('nDelayFrom', { m: p.min, from: p.from }) : fill('nDelay', { m: p.min }));
    if (why) parts.push(fill('nWhyOnly', { cause: why }));
  } else if (p.k === 'short') {
    parts.push(p.b ? fill('nShortB', { a: p.a, b: p.b }) : fill('nShort', { a: p.a }));
    if (why) parts.push(fill('nWhyOnly', { cause: why }));
  } else if (p.k === 'trips') {
    const shown = p.list.slice(0, 6), more = p.list.length - shown.length;
    parts.push(fill('nTrips', { n: p.n, list: shown.join(', ') + (more > 0 ? ' ' + fill('nMore', { n: more }) : '') }));
  } else return null;
  return parts.join(' ');
}
/* The active notices that bear on one ride of a trip: a bus by its line code, a ferry by the line it names. */
function noticesForRide(s) {
  if (!s || s.type !== 'ride') return [];
  return activeDisruptions().filter(function (d) {
    if (s.bus) return d.mode === 'bus' && d.ref === s.ref;
    return d.mode === 'ferry' && ((d.lines || []).indexOf(s.ref) >= 0 || d.ref === s.ref);
  });
}

/* ---- fetching ------------------------------------------------------------------------------- */
const IETT_NOTICES_URL = 'https://api.ibb.gov.tr/iett/UlasimDinamikVeri/Duyurular.asmx';
let IETT_ROWS = null;                      // the last good answer, kept so the notices can be re-derived when the bus data lands
let _iettBusy = false;
async function fetchIettRows() {
  const body = '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
               '<soap:Body><GetDuyurular_json xmlns="http://tempuri.org/" /></soap:Body></soap:Envelope>';
  const r = await fetch(IETT_NOTICES_URL, { method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"http://tempuri.org/GetDuyurular_json"' }, body: body });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const xml = new DOMParser().parseFromString(await r.text(), 'text/xml');
  const el = xml.getElementsByTagName('GetDuyurular_jsonResult')[0];
  if (!el) throw new Error('no result element');
  const rows = JSON.parse(el.textContent || '[]');
  if (!Array.isArray(rows)) throw new Error('not a list');
  return rows;
}
function nowIstanbulMinutes() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const h = +p.find(function (x) { return x.type === 'hour'; }).value % 24, m = +p.find(function (x) { return x.type === 'minute'; }).value;
  return h * 60 + m;
}
function deriveBusNotices() {
  if (!IETT_ROWS) return;
  SURFACE_NOTICES = parseIettNotices(IETT_ROWS, function (ref) { return busDirs(ref); }, nowIstanbulMinutes());
  SURFACE_NOTICES.forEach(function (e) { const en = noticeMessage(e, 'en'); if (en) { e.message = en; e.messageLang = 'en'; } });
  if (typeof applyDisruptionFeed === 'function') applyDisruptionFeed();
}
async function refreshBusNotices() {
  if (_iettBusy || !HAS.bus || CITY_ID !== 'istanbul') return;
  _iettBusy = true;
  try { IETT_ROWS = await fetchIettRows(); deriveBusNotices(); }
  catch (e) { /* offline or İETT is down: keep what we have; the rail notices are unaffected */ }
  _iettBusy = false;
}
// İETT updates through the day; five minutes is as fresh as it is useful, and nothing is polled in a hidden tab
setInterval(function () { if (document.visibilityState === 'visible') refreshBusNotices(); }, 5 * 60 * 1000);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && IETT_ROWS) deriveBusNotices(); });
/* Named entry points for the browser smoke suite, in the spirit of setDisruptions(): the page's state is script-scoped, not on
   window, so what a test needs to drive has to be published on purpose. Client-side only and gone on reload. */
function setSurfaceNotices(list) { SURFACE_NOTICES = Array.isArray(list) ? list : []; applyDisruptionFeed(); return SURFACE_NOTICES.length; }
// the dashed detour bands currently drawn on the bus layer, and how many layers it holds
function busNoticeProbe() {
  let dashed = 0, all = 0;
  busLayer.eachLayer(function (l) { all++; if (l.options && l.options.dashArray === '2,7') dashed++; });
  return { dashed: dashed, layers: all };
}
// first read shortly after boot (the page is interactive first), and again as soon as the bus data lands: a detour can only be VERIFIED against the route's stops
setTimeout(refreshBusNotices, 800);
busDataPromise.then(function () { deriveBusNotices(); });
