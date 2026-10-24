/* ==================================================================================================
   GAZETTEER — the app's own place search, on the device.

   Search used to be this map's stops and landmarks plus a live call to the public Photon service. That left the
   everyday question — "take me to Bağdat Caddesi / Moda / the pharmacy on my street" — to a free service whose own
   README says heavy use "will be throttled or completely banned". The places are now fetched once from
   OpenStreetMap (fetch-places.cjs), shipped with the app (places-<city>.json) and searched here: instant, offline,
   and no keystroke leaves the phone. Photon survives only as a top-up for what the file cannot hold (a house
   number, a shop opened last week), and can be switched off.

   WHAT A RESULT IS
   An entry has a name (and an English / Arabic one where OpenStreetMap has it), a type (district, street, pharmacy,
   mosque…), a point, the district and neighbourhood it lies in, and a rank for how well known it is.

   HOW A QUERY IS READ
   It is folded the way Turkish is actually typed — "ısparta", "ISPARTA", "isparta" and "Isparta" are one word, and
   "sisli" finds Şişli — and split into words. Every word must be accounted for, by one of three things:
     • the NAME ("moda" starts a word in "Moda Caddesi");
     • the PLACE it is in ("kadikoy" is the district of every entry in Kadıköy — so "starbucks kadikoy" works, and
       "eczane moda" is the pharmacies in Moda);
     • the TYPE ("eczane", "pharmacy", "صيدلية", "pharmacie" all mean a pharmacy — so a query of nothing but type words
       is "the nearest of those", which is what "hospital" or "cafe" means).
   A query that finds almost nothing is tried again with typos allowed.

   HOW RESULTS ARE ORDERED
   By how well the NAME matches first (exact > starts with > a word starts with > somewhere inside), then by how well
   known the thing is, and a mild preference for what is near — mild, because someone in Beşiktaş typing "Kadıköy"
   means Kadıköy. For a type-only query ("pharmacy") nearness leads, because "the nearest one" is the question.
   ================================================================================================== */
/* ==GAZETTEER-PURE-START== */
/* Folding. Latin letters lose their case and diacritics, Turkish dotted and dotless i become one letter, and any
   character that is not a letter or digit becomes a space, so "Ali-Baba's" and "ali baba s" are the same. Arabic loses
   its vowel marks and its alef / yeh variants, so the spelling a person types matches the spelling in the data. A
   table walk rather than normalize()+regex, because 150,000 names are folded when the file loads and it has to be
   quick on a phone. */
const GAZ_SKIP = 0xFFFF;
/* The fold as a table, code -> folded code: 32 is "a separator", GAZ_SKIP is "drop it". Built once. */
const GAZ_TBL = (function () {
  const T = new Uint16Array(0x700);
  for (let c = 0; c < T.length; c++) T[c] = 32;
  for (let c = 48; c <= 57; c++) T[c] = c;                                       // digits
  for (let c = 97; c <= 122; c++) T[c] = c;                                      // a-z
  for (let c = 65; c <= 90; c++) T[c] = c + 32;                                  // A-Z
  for (let c = 0xC0; c <= 0x24F; c++) {                                          // the rest of Latin: lower-cased, one letter
    const l = String.fromCharCode(c).toLowerCase();
    if (l.length === 1 && l.charCodeAt(0) !== c) T[c] = l.charCodeAt(0); else if (l.length === 1) T[c] = c;
  }
  const pairs = [['İ', 'i'], ['ı', 'i'], ['Ş', 's'], ['ş', 's'], ['Ğ', 'g'], ['ğ', 'g'], ['Ü', 'u'], ['ü', 'u'], ['Ö', 'o'], ['ö', 'o'],
                 ['Ç', 'c'], ['ç', 'c'], ['Â', 'a'], ['â', 'a'], ['Î', 'i'], ['î', 'i'], ['Û', 'u'], ['û', 'u'], ['É', 'e'], ['é', 'e'],
                 ['È', 'e'], ['è', 'e'], ['Ê', 'e'], ['ê', 'e'], ['Ë', 'e'], ['ë', 'e'], ['À', 'a'], ['à', 'a'], ['Ä', 'a'], ['ä', 'a'],
                 ['Ï', 'i'], ['ï', 'i'], ['Ô', 'o'], ['ô', 'o'], ['Ù', 'u'], ['ù', 'u'], ['Œ', 'o'], ['œ', 'o'], ['Ñ', 'n'], ['ñ', 'n'],
                 ['ß', 's'], ['Æ', 'a'], ['æ', 'a'], ['Ø', 'o'], ['ø', 'o']];
  pairs.forEach(function (p) { T[p[0].charCodeAt(0)] = p[1].charCodeAt(0); });
  for (let c = 0x300; c <= 0x36F; c++) T[c] = GAZ_SKIP;                          // combining marks (an i with a dot as two characters)
  for (let c = 0x621; c <= 0x64A; c++) T[c] = c;                                 // Arabic letters
  for (let c = 0x660; c <= 0x669; c++) T[c] = c;                                 // Arabic-Indic digits
  for (let c = 0x64B; c <= 0x65F; c++) T[c] = GAZ_SKIP;                          // Arabic vowel marks
  T[0x640] = GAZ_SKIP;                                                           // the stretching mark
  [[0x623, 0x627], [0x625, 0x627], [0x622, 0x627], [0x649, 0x64A], [0x626, 0x64A], [0x624, 0x648], [0x629, 0x647]].forEach(function (p) { T[p[0]] = p[1]; });
  return T;
})();
let GAZ_BUF = new Uint16Array(256);
function gazFold(s) {
  s = String(s == null ? '' : s);
  const n = s.length;
  if (n + 1 > GAZ_BUF.length) GAZ_BUF = new Uint16Array(n * 2 + 8);
  const buf = GAZ_BUF;
  let j = 0, sp = 1, ar = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const m = c < 0x700 ? GAZ_TBL[c] : 32;
    if (m === GAZ_SKIP) continue;
    if (m === 32) { if (sp) continue; sp = 1; } else { sp = 0; if (m >= 0x621) ar = 1; }
    buf[j++] = m;
  }
  if (sp && j) j--;
  let o = '';
  for (let p = 0; p < j; p += 4096) o += String.fromCharCode.apply(null, buf.subarray(p, Math.min(j, p + 4096)));
  // Arabic writes "the" as a prefix ("الصيدلية" is "the pharmacy"); a person types it or not, and the data has it or not
  if (ar) o = o.replace(/(^| )ال(?=[^ ]{2})/g, '$1');
  return o;
}

/* The file is columns, not rows (see process-places.cjs); decoding them once into typed arrays and pre-folded names is
   what makes a scan of every place per keystroke cheap. */
function gazDecode(f) {
  const names = f.n.split('\n'), N = names.length;
  const G = { n: N, name: names, fn: new Array(N), lat: new Float64Array(N), lng: new Float64Array(N),
              t: Uint8Array.from(f.t), d: Uint16Array.from(f.d), h: Uint16Array.from(f.h), r: Uint8Array.from(f.r),
              types: f.types, districts: f.districts, hoods: f.hoods, en: f.en || {}, ar: f.ar || {}, box: f.box, osmBase: f.osmBase || null,
              fen: {}, far: {}, hasAlt: new Uint8Array(N), fd: f.districts.map(gazFold), fh: f.hoods.map(gazFold), vocab: null };
  let a = 0, o = 0;
  for (let i = 0; i < N; i++) {
    a += f.la[i]; o += f.lo[i];
    G.lat[i] = a / 1e5; G.lng[i] = o / 1e5;
    G.fn[i] = gazFold(names[i]);
  }
  for (const k in G.en) { G.fen[k] = gazFold(G.en[k]); G.hasAlt[k] = 1; }
  for (const k in G.ar) { G.far[k] = gazFold(G.ar[k]); G.hasAlt[k] = 1; }
  return G;
}

/* metres between two points, flat-earth: this only ranks, and the error at city scale is far below what a ranking can see */
function gazMeters(la1, lo1, la2, lo2) {
  const y = (la2 - la1) * 111320, x = (lo2 - lo1) * 111320 * Math.cos((la1 + la2) * Math.PI / 360);
  return Math.sqrt(x * x + y * y);
}

/* How well one folded name answers the query. Returns a score (330 somewhere inside … 1000 the whole name), 0 for no
   match at all, or -n when only n of the query's words are in the name — `miss` then lists the words that are not,
   for the caller to try on the district, the neighbourhood and the type. A word is satisfied when it starts a word of
   the name; found only in the middle of one it counts for less. */
const GAZ_EXACT = 1000, GAZ_PREFIX_LO = 500, GAZ_PREFIX_HI = 700, GAZ_WORD = 540, GAZ_SUB = 330, GAZ_CTX = 410, GAZ_TYPE = 380;
function gazNameScore(fnm, F, toks, miss) {
  miss.length = 0;
  if (fnm === F) return GAZ_EXACT;
  if (fnm.length > F.length && fnm.startsWith(F)) {
    // a prefix covering most of the name is nearly the name; one covering a fifth of it is barely better than a word match
    return GAZ_PREFIX_LO + (GAZ_PREFIX_HI - GAZ_PREFIX_LO) * (F.length / fnm.length);
  }
  let covered = 0, inside = false, got = 0;
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    let p = fnm.indexOf(tk);
    if (p < 0) { miss.push(k); continue; }
    let start = false;
    while (p >= 0) {
      if (p === 0 || fnm.charCodeAt(p - 1) === 32) { start = true; break; }
      p = fnm.indexOf(tk, p + 1);
    }
    got++;
    if (start) covered += tk.length; else { covered += tk.length * 0.5; inside = true; }
  }
  if (!got) return 0;
  if (got < toks.length) return -got;
  if (inside) return GAZ_SUB + 60 * Math.min(1, covered / fnm.length);
  return GAZ_WORD + 120 * Math.min(1, covered / fnm.length);
}
/* is `cand` a better answer than `cur`? a real score beats a partial one, a partial beats none, and of two partials the one with more words */
function gazBetter(cur, cand) {
  if (cand > 0) return cur <= 0 || cand > cur;
  if (cand < 0) return cur === 0 || (cur < 0 && cand < cur);
  return false;
}

/* how much a type is worth as a destination, before anything else: places people name come first */
const GAZ_TYPE_WEIGHT = { district: 130, hood: 112, place: 104, square: 100, airport: 110, attraction: 96, museum: 96, historic: 92, viewpoint: 88,
                          tower: 92, stadium: 84, university: 84, hospital: 80, mall: 80, park: 76, mosque: 62, street: 70, ferry: 70, bus_station: 66 };
const GAZ_AREA = { district: 1, hood: 1, place: 1, square: 1, airport: 1, attraction: 1, museum: 1, historic: 1, viewpoint: 1, tower: 1, stadium: 1, park: 1 };

/* Lowest edit distance up to a limit (banded Levenshtein with an early exit), for the typo pass */
function gazEdit(a, b, lim) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > lim) return lim + 1;
  let prev = new Array(m + 1), cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i; let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > lim) return lim + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[m];
}
function gazVocab(G) {
  if (G.vocab) return G.vocab;
  const seen = new Set();
  for (let i = 0; i < G.n; i++) { const w = G.fn[i].split(' '); for (let k = 0; k < w.length; k++) if (w[k].length >= 4) seen.add(w[k]); }
  G.vocab = Array.from(seen);
  return G.vocab;
}

/* The types a query word can mean, as {typeIndex:1}, or null. `typeWords` maps a folded word to type indexes (built by the
   caller from the labels in every language). A plural typed ("hospitals") or a word half typed ("pharm") still counts. */
function gazTypesFor(tk, typeWords) {
  if (!typeWords) return null;
  let hit = null;
  const add = function (list) { if (!list) return; hit = hit || {}; for (let i = 0; i < list.length; i++) hit[list[i]] = 1; };
  add(typeWords.get(tk));
  if (tk.length >= 4) {
    typeWords.forEach(function (list, w) {
      // a plural typed ("hospitals" for "hospital") or a long word half typed ("pharm"); "mark" is not "market"
      if (w !== tk && ((w.length >= 4 && tk.startsWith(w)) || (tk.length >= 5 && w.startsWith(tk)))) add(list);
    });
  }
  return hit;
}
/* which districts / neighbourhoods (as 1-based ids) have a word starting with `tk` */
function gazAreasFor(folded, tk) {
  const out = {};
  if (tk.length < 3) return out;
  for (let i = 0; i < folded.length; i++) {
    const s = folded[i]; let p = s.indexOf(tk);
    while (p >= 0) { if (p === 0 || s.charCodeAt(p - 1) === 32) { out[i + 1] = 1; break; } p = s.indexOf(tk, p + 1); }
  }
  return out;
}

/* Search. opt: { org:{lat,lng}, limit, typeWords, only:[type indexes] }. Returns [{ i, score, m }] best first. */
function gazSearch(G, q, opt) {
  opt = opt || {};
  const F = gazFold(q);
  if (F.length < 2) return [];
  const toks = F.split(' '), T = toks.length;
  const org = opt.org || null, limit = opt.limit || 12;
  const tTypes = toks.map(function (tk) { return gazTypesFor(tk, opt.typeWords); });
  const allType = tTypes.every(function (x) { return !!x; });          // "pharmacy", "coffee shop": nothing but what a thing IS
  const onlySet = opt.only ? (function () { const s = {}; opt.only.forEach(function (x) { s[x] = 1; }); return s; })() : null;
  const tDist = toks.map(function (tk) { return gazAreasFor(G.fd, tk); });
  const tHood = toks.map(function (tk) { return gazAreasFor(G.fh, tk); });

  const top = [], keep = limit * 4;                                      // sorted descending by score
  let floor = -1e9;
  const consider = function (i, base, typeOnly) {
    const ty = G.types[G.t[i]];
    let s = base + (GAZ_TYPE_WEIGHT[ty] || 40) * (typeOnly ? 0.3 : 1) + G.r[i] * 26;
    let m = -1;
    if (org) {
      m = gazMeters(org.lat, org.lng, G.lat[i], G.lng[i]);
      const km = m / 1000;
      s -= typeOnly ? Math.min(420, km * 14) : (GAZ_AREA[ty] ? Math.min(45, km * 1.5) : Math.min(120, km * 4));
    }
    s -= Math.min(24, Math.max(0, G.fn[i].length - F.length) * 0.35);
    if (top.length >= keep && s <= floor) return;
    let lo = 0, hi = top.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (top[mid].score > s) lo = mid + 1; else hi = mid; }
    top.splice(lo, 0, { i: i, score: s, m: m });
    if (top.length > keep) top.pop();
    if (top.length >= keep) floor = top[top.length - 1].score;
  };

  const missA = [], missB = [];
  for (let i = 0; i < G.n; i++) {
    const ti = G.t[i];
    if (onlySet && !onlySet[ti]) continue;
    // a query that is only type words ("eczane"): every entry of that type is an answer, the nearest first
    if (allType && T === 1 && tTypes[0][ti]) { consider(i, GAZ_TYPE, true); continue; }
    /* Can this place be an answer at all? Every word of the query must be in its name, or be its district, its
       neighbourhood or its type. That is a handful of cheap tests, and almost every place fails the first one — so the
       scoring below, which is what costs, runs on a few hundred places rather than 150,000. This is what keeps a
       keystroke quick on a phone. */
    const nm = G.fn[i], di = G.d[i], hi = G.h[i];
    let feasible = true;
    for (let k = 0; k < T; k++) {
      if (nm.indexOf(toks[k]) >= 0 || tDist[k][di] || tHood[k][hi] || (tTypes[k] && tTypes[k][ti])) continue;
      if (G.hasAlt[i]) {
        const x1 = G.fen[i], x2 = G.far[i];
        if ((x1 !== undefined && x1.indexOf(toks[k]) >= 0) || (x2 !== undefined && x2.indexOf(toks[k]) >= 0)) continue;
      }
      feasible = false; break;
    }
    if (!feasible) continue;
    let best = gazNameScore(G.fn[i], F, toks, missA), bestMiss = missA;
    const a1 = G.fen[i], a2 = G.far[i];
    if (a1 !== undefined) { const s = gazNameScore(a1, F, toks, missB); if (gazBetter(best, s)) { best = s; bestMiss = missB.slice(); } }
    if (a2 !== undefined) { const s = gazNameScore(a2, F, toks, missB); if (gazBetter(best, s)) { best = s; bestMiss = missB.slice(); } }
    if (best > 0) { consider(i, best, false); continue; }
    // some of the words are not in the name: can the district, the neighbourhood or the type account for them?
    const nameWords = best < 0 ? -best : 0;
    const missing = best < 0 ? bestMiss : toks.map(function (_, k) { return k; });
    let ok = true, typeUsed = false;
    for (let z = 0; z < missing.length; z++) {
      const k = missing[z];
      if (tTypes[k] && tTypes[k][ti]) { typeUsed = true; continue; }
      if (tDist[k][G.d[i]] || tHood[k][G.h[i]]) continue;
      ok = false; break;
    }
    // a place with none of the query in its NAME is an answer only through its TYPE ("eczane moda"); "kadikoy" alone is
    // not a request for everything in Kadıköy
    if (!ok || (nameWords === 0 && !typeUsed)) continue;
    consider(i, nameWords ? GAZ_CTX + 45 * nameWords / T : GAZ_TYPE, nameWords === 0);
  }

  // few or no results: tolerate a typo in one word, by finding the real word in the file's vocabulary
  if (top.length < 3 && F.length >= 4 && !opt.noFuzzy) {
    const vocab = gazVocab(G), swaps = [];
    toks.forEach(function (tk) {
      if (tk.length < 4) return;
      const lim = tk.length <= 5 ? 1 : 2;
      for (let v = 0; v < vocab.length && swaps.length < 40; v++) {
        const w = vocab[v];
        if (w !== tk && Math.abs(w.length - tk.length) <= lim && gazEdit(tk, w, lim) <= lim) swaps.push([tk, w]);
      }
    });
    if (swaps.length) {
      const have = {}; top.forEach(function (x) { have[x.i] = 1; });
      for (let w = 0; w < swaps.length; w++) {
        const fixed = toks.map(function (t) { return t === swaps[w][0] ? swaps[w][1] : t; }).join(' ');
        gazSearch(G, fixed, { org: org, limit: limit, typeWords: opt.typeWords, only: opt.only, noFuzzy: true }).forEach(function (x) {
          if (!have[x.i]) { have[x.i] = 1; top.push({ i: x.i, score: x.score - 160, m: x.m, fuzzy: true }); }
        });
      }
      top.sort(function (a, b) { return b.score - a.score; });
    }
  }

  // identical names (a chain, a numbered street) are not worth more than four rows each
  const out = [], per = {};
  for (let z = 0; z < top.length && out.length < limit; z++) {
    const key = G.fn[top[z].i] + '|' + G.t[top[z].i];
    per[key] = (per[key] || 0) + 1;
    if (per[key] > 4) continue;
    out.push(top[z]);
  }
  return out;
}
/* ==GAZETTEER-PURE-END== */

/* ---- everything below talks to the page: the type table, the language, the network ------------------------------ */
/* An icon and a group for every type in the file. The label of each, in every language, is the i18n key gt_<type>. */
const GAZ_TYPE_META = {
  district: ['🏙️', 'area'], hood: ['🏘️', 'area'], place: ['📍', 'area'], square: ['⛲', 'area'], street: ['🛣️', 'street'],
  restaurant: ['🍽️', 'food'], cafe: ['☕', 'food'], fast_food: ['🍔', 'food'], bar: ['🍺', 'food'],
  hotel: ['🏨', 'stay'], lodging: ['🛏️', 'stay'],
  attraction: ['⭐', 'sights'], museum: ['🖼️', 'sights'], gallery: ['🎨', 'sights'], historic: ['🏛️', 'sights'], viewpoint: ['🌆', 'sights'], tower: ['🗼', 'sights'],
  cinema: ['🎬', 'culture'], theatre: ['🎭', 'culture'], library: ['📚', 'culture'],
  park: ['🌳', 'nature'], garden: ['🌷', 'nature'], beach: ['🏖️', 'nature'], water: ['🌊', 'nature'], peak: ['⛰️', 'nature'],
  hospital: ['🏥', 'health'], clinic: ['🩺', 'health'], pharmacy: ['💊', 'health'],
  university: ['🎓', 'education'], school: ['🏫', 'education'],
  mosque: ['🕌', 'worship'], church: ['⛪', 'worship'], synagogue: ['🕍', 'worship'], worship: ['🛐', 'worship'],
  mall: ['🛍️', 'shop'], supermarket: ['🛒', 'shop'], shop: ['🏪', 'shop'],
  bank: ['🏦', 'service'], post: ['📮', 'service'], government: ['🏢', 'service'], police: ['🚓', 'service'], fuel: ['⛽', 'service'],
  bus_station: ['🚌', 'transport'], ferry: ['⛴️', 'transport'], airport: ['✈️', 'transport'], pier: ['⚓', 'transport'],
  sports: ['🏋️', 'sports'], stadium: ['🏟️', 'sports'], other: ['📍', 'other']
};
/* words that mean a type besides its label: what people type for "somewhere to eat" or "a chemist" */
const GAZ_SYNONYMS = {
  restaurant: ['food', 'eat', 'dinner', 'lunch', 'yemek', 'lokanta', 'restoran', 'مطعم'],
  cafe: ['coffee', 'kahve', 'kafe', 'kahveci', 'قهوة'],
  fast_food: ['burger', 'doner', 'döner', 'kebab', 'pizza'],
  bar: ['pub', 'meyhane', 'drink', 'bira'],
  hotel: ['stay', 'otel', 'konaklama'],
  hospital: ['emergency', 'acil', 'hastane', 'urgences'],
  clinic: ['doctor', 'dentist', 'doktor', 'klinik', 'diş'],
  pharmacy: ['chemist', 'drugstore', 'eczane', 'eczaneler'],
  mosque: ['cami', 'camii', 'mescit', 'جامع'],
  church: ['kilise'], synagogue: ['sinagog'],
  museum: ['müze', 'musee'],
  park: ['korusu', 'koru'],
  mall: ['avm', 'alışveriş', 'shopping', 'çarşı', 'bazaar'],
  supermarket: ['market', 'grocery', 'bakkal', 'migros', 'bim', 'a101'],
  bank: ['banka', 'atm', 'bankamatik'],
  post: ['ptt', 'postane'],
  police: ['karakol', 'polis'],
  fuel: ['petrol', 'benzin', 'gas', 'akaryakıt', 'benzinlik'],
  bus_station: ['otogar', 'terminal'],
  ferry: ['iskele', 'vapur', 'feribot'],
  airport: ['havalimanı', 'havaalanı'],
  university: ['üniversite', 'campus', 'kampüs'],
  school: ['okul', 'lise', 'ilkokul', 'ortaokul'],
  stadium: ['stat', 'stadyum'],
  beach: ['plaj', 'sahil'],
  street: ['cadde', 'sokak', 'bulvar', 'avenue', 'road', 'rue', 'street'],
  district: ['ilçe', 'ilce'], hood: ['neighbourhood', 'neighborhood', 'mahalle', 'quarter', 'semt', 'quartier'],
  place: ['town', 'village', 'island', 'köy', 'ada', 'adası'],
  square: ['meydan', 'meydanı', 'plaza'],
  government: ['government', 'belediye', 'kaymakamlık', 'adliye'],
  worship: ['worship', 'ibadet'], historic: ['historic', 'tarihi', 'antik', 'ruins'], attraction: ['attraction', 'sights', 'gezilecek'],
  post: ['post'], fuel: ['fuel'], viewpoint: ['viewpoint', 'manzara'], tower: ['tower', 'kule'], gallery: ['galeri', 'gallery'],
  library: ['kütüphane', 'library'], cinema: ['sinema', 'cinema'], theatre: ['tiyatro', 'theatre', 'theater']
};
const GAZ = { G: null, promise: null, state: 'idle', typeWords: null };

/* folded word -> [type index], over the labels in EVERY language plus the synonyms: someone searching in English in a Turkish
   city still types "eczane" */
function gazBuildTypeWords(G) {
  const m = new Map();
  const put = function (w, ti) {
    const f = gazFold(w); if (f.length < 2) return;
    const l = m.get(f); if (!l) m.set(f, [ti]); else if (l.indexOf(ti) < 0) l.push(ti);
  };
  G.types.forEach(function (key, ti) {
    ['en', 'tr', 'ar', 'fr'].forEach(function (lg) {
      // only a label that is ONE word: "Town or village" must not make "or" mean a settlement
      const lab = I18N[lg] && I18N[lg]['gt_' + key];
      if (lab && gazFold(lab).indexOf(' ') < 0) put(lab, ti);
    });
    (GAZ_SYNONYMS[key] || []).forEach(function (w) { put(w, ti); });
  });
  return m;
}
function gazLoad() {
  if (GAZ.promise) return GAZ.promise;
  GAZ.state = 'loading';
  GAZ.promise = fetch('transit_data/places-' + CITY_ID + '.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || j.v !== 1) { GAZ.state = 'none'; return null; }
      GAZ.G = gazDecode(j);
      GAZ.typeWords = gazBuildTypeWords(GAZ.G);
      GAZ.state = 'ready';
      return GAZ.G;
    })
    .catch(function () { GAZ.state = 'none'; return null; });       // offline with nothing cached, or a city with no file: the stop search and the live top-up remain
  return GAZ.promise;
}
/* wait for the file, but never for long: a search that waits more than a moment is worse than one that starts with fewer places */
function gazWhen(ms) {
  if (GAZ.G) return Promise.resolve(GAZ.G);
  return Promise.race([gazLoad(), new Promise(function (res) { setTimeout(function () { res(null); }, ms || 1500); })]);
}
function gazLabel(key) { const v = I18N[lang] && I18N[lang]['gt_' + key]; return v !== undefined ? v : (I18N.en['gt_' + key] || key); }
/* what the reader sees of entry i: the name in their language where there is one, the Turkish name as the secondary line */
function gazShow(G, i) {
  const tr = G.name[i];
  const alt = lang === 'en' ? G.en[i] : (lang === 'ar' ? G.ar[i] : '');
  const key = G.types[G.t[i]];
  const hood = G.h[i] ? G.hoods[G.h[i] - 1] : '', dist = G.d[i] ? G.districts[G.d[i] - 1] : '';
  const where = key === 'district' ? '' : (hood && dist && hood !== dist ? hood + ', ' + dist : (dist || hood));
  return { name: alt || tr, tr: alt && alt !== tr ? tr : '', key: key, ic: (GAZ_TYPE_META[key] || GAZ_TYPE_META.other)[0], where: where,
           type: gazLabel(key) };
}
function gazRow(G, i, extra) {
  const s = gazShow(G, i);
  return Object.assign({ name: s.name, tr: s.tr, lat: G.lat[i], lng: G.lng[i], ctx: s.where, type: s.type, typeKey: s.key, ic: s.ic, geo: true, gaz: true, i: i }, extra || {});
}
/* the search the rest of the app calls: [{ name, lat, lng, ctx, type, ic, tr, geo:true, gaz:true, score, m }] */
function gazFind(q, limit, only) {
  const G = GAZ.G; if (!G) return [];
  const rows = gazSearch(G, q, { org: searchOrigin(), limit: limit || 12, typeWords: GAZ.typeWords, only: only });
  return rows.map(function (r) { return gazRow(G, r.i, { score: r.score, m: r.m }); });
}
/* the nearest places of some types around a point, for the category chips; null when the file is not loaded */
function gazNearby(typeKeys, lat, lng, limit) {
  const G = GAZ.G; if (!G) return null;
  const set = {}; typeKeys.forEach(function (k) { const x = G.types.indexOf(k); if (x >= 0) set[x] = 1; });
  const hits = [];
  for (let i = 0; i < G.n; i++) {
    if (!set[G.t[i]]) continue;
    const m = gazMeters(lat, lng, G.lat[i], G.lng[i]);
    if (m > 6000) continue;
    hits.push([m - G.r[i] * 120, i, m]);
  }
  hits.sort(function (a, b) { return a[0] - b[0]; });
  return hits.slice(0, limit || 25).map(function (h) { return gazRow(G, h[1], { m: h[2] }); });
}
/* Start the file loading a few seconds after the app opens, once the map has had its first paint, so the first search
   is instant rather than the first thing to wait on a download. It is cached for offline use after that. */
setTimeout(function () { gazLoad(); }, 4000);
