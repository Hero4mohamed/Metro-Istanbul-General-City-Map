/* Şehir Hatları (the İstanbul city ferries) announcements, read from the operator's own site.
 *
 *   exports: parseList, viewStateStrings, parseDetail, readNotice, ferryEntries, fetchFerryNotices
 *
 * scrape-disruptions.cjs calls fetchFerryNotices() and merges what it returns into disruptions.json, so ferry
 * notices travel the same road rail faults do: committed every 30 minutes (only when something changed — a
 * ferry notice changes a few times a month, not a few times an hour, unlike the bus feed) and shown in the
 * same Announcements card.
 *
 * WHAT THE SITE IS
 * sehirhatlari.istanbul/tr/duyurular lists the announcements, newest first; each links to a page whose text is
 * NOT in the HTML but in the ASP.NET __VIEWSTATE field, base64, as .NET-serialised strings. That is not a
 * documented interface and it can change, so everything here fails SOFT: a page that cannot be read yields no
 * notice, never a wrong one, and a failed fetch leaves the notices already published where they are
 * (scrape-disruptions.cjs carries them over).
 *
 * WHAT IS DONE WITH A NOTICE
 * It is kept for as long as it is RELEVANT, which the operator's own words decide: the dates in the title or
 * body ("12-13 Eylül 2026", "12 Ekim 2026 tarihinden itibaren"). A notice about last month's regatta is history.
 * The text is shown as the operator wrote it (Turkish), with a title, a severity and — only where the text names
 * a line this map draws — that line. Nothing is translated HERE: the text is stored as the operator wrote it, and
 * scrape-disruptions.cjs runs it through the ferry templates of the shared translator (TR_FERRY), which carry every
 * time and date across by capture and refuse any result whose numbers differ from the original. Wording the
 * templates do not know stays Turkish, flagged, rather than being guessed at.
 *
 * The ferry operator's other public service notices (cancellations on the day) are not on this page: Şehir
 * Hatları publishes them as images and PDFs, and İDO's page needs a browser to render. Neither is read.
 */
const BASE = 'https://sehirhatlari.istanbul';
const UA = 'Mozilla/5.0 (compatible; IstanbulTransitMap/1.0; +github.com/Hero4mohamed)';
const DAY = 86400000;

const ENT = { uuml: 'ü', Uuml: 'Ü', ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', nbsp: ' ', rsquo: '’', lsquo: '‘', bull: '•',
  ndash: '–', mdash: '—', amp: '&', quot: '"', iacute: 'í', Iacute: 'İ', scaron: 'š', Scaron: 'Š', hellip: '…', laquo: '«', raquo: '»',
  // the operator's quoted event names arrive as &ldquo;…&rdquo; and "imkânı" as imk&acirc;nı
  ldquo: '“', rdquo: '”', bdquo: '„', acirc: 'â', Acirc: 'Â', icirc: 'î', ucirc: 'û', ecirc: 'ê', ocirc: 'ô' };
function decodeEntities(s) {
  return String(s).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
                  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
                  .replace(/&([a-zA-Z]+);/g, (x, n) => ENT[n] || x);
}
const fold = s => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* the list page: [{ id, slug, title, url }], newest first, de-duplicated */
function parseList(html) {
  const out = [], seen = new Set();
  const re = /<a[^>]+href="(\/tr\/duyurular\/([^"\/]+?)-(\d+))"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const title = decodeEntities(m[4].replace(/<[^>]+>/g, ' ')).replace(/^[\s\-–]+/, '').replace(/\s+/g, ' ').trim();
    if (!title || seen.has(m[3])) continue;
    seen.add(m[3]);
    out.push({ id: m[3], slug: m[2], title: title, url: BASE + m[1] });
  }
  return out;
}

/* .NET LosFormatter strings: token 0x05, a 7-bit-encoded byte length, then UTF-8 text. Anything that does not
   decode cleanly is skipped. */
function viewStateStrings(b64) {
  const buf = Buffer.from(b64, 'base64'), out = [];
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] !== 0x05) continue;
    let len = 0, shift = 0, j = i + 1;
    for (; j < buf.length && shift < 35; j++) { len |= (buf[j] & 0x7f) << shift; if (!(buf[j] & 0x80)) { j++; break; } shift += 7; }
    if (len < 3 || j + len > buf.length) continue;
    const s = buf.slice(j, j + len).toString('utf8');
    if (s.includes('\uFFFD') || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) continue;     // a 0x05 inside some other token: not a string
    out.push(s);
    i = j + len - 1;
  }
  return out;
}

/* One announcement page -> { title, published (YYYY-MM-DD), html } or null. The page's text is the string that
   holds markup after the publication date; the date is the one string that is exactly dd.mm.yyyy. */
function parseDetail(html) {
  const vs = /id="__VIEWSTATE"\s+value="([^"]+)"/.exec(html);
  if (!vs) return null;
  const strings = viewStateStrings(vs[1]);
  const di = strings.findIndex(s => /^\d{2}\.\d{2}\.\d{4}$/.test(s));
  if (di < 0) return null;
  const body = strings.slice(di + 1).find(s => /<p[ >]/i.test(s) || /<li[ >]/i.test(s));
  if (!body) return null;
  const t = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const title = decodeEntities((strings[di - 1] || (t && t[1]) || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const [d, mo, y] = strings[di].split('.');
  return { title, published: y + '-' + mo + '-' + d, html: body.slice(body.indexOf('<')) };
}

/* The message: the paragraphs and the list items, NOT the tables (a day's timetable is a grid of times that says
   nothing in a sentence) and not the salutation or the sign-off. */
const BOILER = /^(?:de[gğ]erli\s+yolcular[ıi]m[ıi]z|bilgilerinize\s+sunar[ıi]z|iyi\s+yolculuklar|sayg[ıi]lar[ıi]m[ıi]zla|bilgilerinize)\b/i;
function messageOf(html) {
  const noTables = html.replace(/<(table|figure)[\s\S]*?<\/\1>/gi, ' ');
  const pieces = [];
  noTables.replace(/<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, inner) => {
    const lines = decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).split('\n');
    lines.forEach(l => {
      const t = l.replace(/\s+/g, ' ').replace(/^[•\s]+/, '').trim();
      if (t.length > 2 && !BOILER.test(t)) pieces.push(t);
    });
    return '';
  });
  // list items join with semicolons; a paragraph that ends in a colon introduces them, and a sentence ends the run
  let out = '';
  out = pieces.reduce((acc, p, i) => {
    const prev = pieces[i - 1];
    if (!acc) return p;
    return acc + (/[.!?:;,]$/.test(prev || '') ? ' ' : '; ') + p;
  }, '');
  // long notices (the season change is a press release) are cut at the last full sentence that fits
  if (out.length <= 520) return out;
  const cut = out.lastIndexOf('. ', 520);
  return cut > 120 ? out.slice(0, cut + 1) : out.slice(0, out.lastIndexOf(' ', 500)) + '…';
}

/* ---- the dates a notice is about ---------------------------------------------------------------- */
const MONTHS = { ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12 };
const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
/* every date the text states, as { iso, from } where `from` marks "…tarihinden itibaren" (effective from, no end) */
function datesIn(text, fallbackYear) {
  // folded for the month names but with the hyphens left in: "12-13 Eylül" is a range, "12 13 eylul" is not
  const f = String(text).toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, ''), out = [];
  const mon = '(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)';
  let m;
  // "12-13-14 Eylül 2026", "12-13 Eylül", "16 Ağustos 2026"
  const re = new RegExp('(\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})*)\\s+' + mon + '(?:\\s+(\\d{4}))?', 'g');
  while ((m = re.exec(f))) {
    const y = m[3] ? +m[3] : fallbackYear, mo = MONTHS[m[2]];
    const tail = f.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const from = /^\s*tarihinden\s+itibaren/.test(tail) || /^\s*itibaren/.test(tail);
    m[1].split(/\s*[-–]\s*/).forEach(d => { if (+d >= 1 && +d <= 31) out.push({ iso: iso(y, mo, +d), from: from }); });
  }
  const re2 = /(\d{2})\.(\d{2})\.(\d{4})/g;
  while ((m = re2.exec(text))) out.push({ iso: iso(+m[3], +m[2], +m[1]), from: false });
  return out;
}
/* How long a notice stays relevant: { from, until } as YYYY-MM-DD.
     - it states dates: from the first to the last of them;
     - it states a start only ("…tarihinden itibaren"): from then, for three weeks;
     - it states nothing: for a week after it was published. */
function windowOf(title, text, published) {
  const y = +published.slice(0, 4), dates = datesIn(title + ' ' + text, y).filter(d => d.iso >= iso(y - 1, 1, 1));
  const add = (isoDate, days) => new Date(Date.parse(isoDate + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
  if (!dates.length) return { from: published, until: add(published, 7) };
  const startOnly = dates.filter(d => d.from), plain = dates.filter(d => !d.from);
  const all = dates.map(d => d.iso).sort();
  if (plain.length) return { from: all[0], until: plain.map(d => d.iso).sort().pop() };
  return { from: all[0], until: add(startOnly.map(d => d.iso).sort().pop(), 21) };
}

/* ---- what kind of notice, and which of OUR ferry lines it names ---------------------------------- */
function kindOf(title) {
  const f = fold(title);
  if (/iptal/.test(f)) return { title: 'Trips cancelled', severity: 'partial' };
  if (/ek sefer/.test(f)) return { title: 'Extra trips', severity: 'minor' };
  if (/tarifesine geciyor|kis tarifesi|yaz tarifesi/.test(f)) return { title: 'Seasonal timetable', severity: 'minor' };
  if (/sefer duzenleme|duzenleme|saat|ugrama/.test(f)) return { title: 'Timetable change', severity: 'minor' };
  return { title: 'Ferry notice', severity: 'minor' };
}
/* A line of ours is named only when the text names IT. A two-ended line ("Üsküdar–Beşiktaş") needs both ends next to
   each other, in either order — "Üsküdar-Haliç" and "Beşiktaş-Haliç" in a Haliç notice contain all three words and
   name none of the Üsküdar–Beşiktaş line. A one-word line ("Haliç Hattı") needs its word. The operator's other
   routes ("Maltepe-Adalar") name no line this map draws, and then none is claimed. */
function linesNamed(text, ferryLines) {
  const f = ' ' + fold(text) + ' ';
  return ferryLines.filter(l => {
    const ends = String(l.ref).split(/\s*[–-]\s*/).map(fold).filter(Boolean);
    if (ends.length >= 2) { const a = ends[0], b = ends[ends.length - 1]; return f.indexOf(' ' + a + ' ' + b + ' ') >= 0 || f.indexOf(' ' + b + ' ' + a + ' ') >= 0; }
    const words = fold(l.ref).split(' ').filter(w => w && !/^(hatti|bogaz|avrupa|anadolu)$/.test(w));
    return words.length > 0 && words.every(w => f.indexOf(' ' + w) >= 0);
  }).map(l => l.ref);
}

/* a list item + its page -> a disruptions.json entry, or null when the page cannot be read or is no longer relevant */
function readNotice(item, pageHtml, today, ferryLines) {
  const det = parseDetail(pageHtml);
  if (!det) return null;
  const text = messageOf(det.html);
  if (!text) return null;
  const win = windowOf(det.title || item.title, text, det.published);
  if (win.until < today) return null;                                   // history
  if (Date.parse(today + 'T00:00:00Z') - Date.parse(det.published + 'T00:00:00Z') > 90 * DAY) return null;
  const k = kindOf(det.title || item.title), named = linesNamed(det.title + ' ' + text, ferryLines || []);
  const e = { id: 'ferry-' + item.id, mode: 'ferry', ref: named.length === 1 ? named[0] : null, scope: 'note', severity: k.severity, title: k.title,
              message: text, messageTr: text, messageLang: 'tr', translatedBy: 'none', source: 'sehirhatlari.istanbul', url: item.url,
              published: det.published, until: win.until };
  if (named.length) e.lines = named;
  if (win.from > today) e.starts = win.from;
  return e;
}
function ferryEntries(listHtml, pages, today, ferryLines) {
  const out = [];
  parseList(listHtml).forEach(item => { const html = pages[item.id]; const e = html && readNotice(item, html, today, ferryLines); if (e) out.push(e); });
  return out;
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.text();
}
/* the newest announcements only: the list is long and old, and only a recent one can still be relevant */
async function fetchFerryNotices(today, ferryLines, limit) {
  const list = await get(BASE + '/tr/duyurular');
  const items = parseList(list).slice(0, limit || 8), pages = {};
  for (const it of items) {
    try { pages[it.id] = await get(it.url); } catch (e) { console.error('ferry notice page failed:', e.message); }
    await new Promise(r => setTimeout(r, 400));
  }
  return ferryEntries(list, pages, today, ferryLines);
}

module.exports = { parseList, viewStateStrings, parseDetail, messageOf, datesIn, windowOf, kindOf, linesNamed, readNotice, ferryEntries, fetchFerryNotices, decodeEntities };
