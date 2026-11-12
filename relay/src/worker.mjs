/* TurkMaps relay: a small Cloudflare Worker the app asks for İstanbul's live buses.
 *
 * WHY IT EXISTS, AND WHY IN TWO PARTS. İETT publishes where every İstanbul bus is (İBB open data, no key), but:
 *   1. its server sends no CORS header, so a browser refuses to hand the answer to a web page;
 *   2. its server does not answer Cloudflare at all (measured 12 Nov 2026: time-outs from Cloudflare's Amsterdam site, with and
 *      without a placement hint; the same request from a home line in Türkiye is answered in a second).
 * So a Worker alone cannot do it. The relay is this Worker plus a FEEDER: a small script (relay/feeder.cjs) on any always-on
 * computer in Türkiye. The Worker keeps a list of the lines people have open; the feeder reads that list, asks İETT about just
 * those lines, and pushes the answers here; the Worker hands them to the page with the header that lets the TurkMaps page (and
 * only it) read them. When no feeder is running the Worker says so (503 "no-feed") and the app shows no buses: nothing is made up
 * and nothing old is passed off as new.
 *
 * WHAT IT KEEPS. For each line someone has open: the time it was last asked for, and İETT's last answer. Rows older than ten
 * minutes are deleted. Nothing about the person asking: no address, no identifier, no cookie.
 *
 *   GET  /iett/buses?line=34G   public   { line, at, now, buses:[{ id, lat, lng, t, to, stop }] }  |  { ..., warming:true }  |  503 no-feed
 *                                        (`now` is this Worker's clock when it answered: the page measures a bus's age against it, not against the phone's clock)
 *   GET  /health                public   is a feeder alive, and where does this Worker run
 *   GET  /feed/wanted           feeder   the lines to fetch now                      (Authorization: Bearer FEED_TOKEN)
 *   POST /feed/push             feeder   { lines: { "34G": [İETT's records] | null } }
 *
 * The functions above the handler are pure and are tested by transit_data/test/relay.test.cjs with real recorded answers.
 */
export const VERSION = '3';
/* the pages allowed to read the answers in a browser. Anything else still gets the answer if it asks directly (it is open data),
   but a browser will not hand it to another website's script. */
export const ALLOWED_ORIGINS = ['https://hero4mohamed.github.io', 'http://localhost:8470', 'http://127.0.0.1:8470'];
/* an İETT line code as the app holds them: digits, capitals (Turkish ones too) and a dash, e.g. 34G, 500T, E-10, 15ÇK */
export const LINE_RE = /^[-0-9A-ZÇĞİÖŞÜ]{1,8}$/;
export const ISTANBUL_BOX = [40.5, 27.8, 41.7, 30.1];        // south, west, north, east: a position outside is not an İstanbul bus
export const TOO_OLD = 10 * 60000;                           // a position older than this is not sent on at all
export const WANTED_FOR = 90000;                             // a line stays on the feeder's list this long after it was last asked for
export const SNAP_FRESH = 60000;                             // an answer older than this is not "now": it is not served
export const FEEDER_ALIVE = 45000;                           // no word from the feeder for this long: there is no feed
export const MAX_LINES = 40;                                 // lines per push, and lines on the wanted list

export function corsHeaders(origin) {
  const h = { 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Methods'] = 'GET, OPTIONS'; h['Access-Control-Max-Age'] = '86400'; }
  return h;
}
/* "2026-11-12 03:00:59" is Turkish clock time (UTC+3 all year) → milliseconds since 1970, or NaN */
export function turkeyTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5], +m[6]) : NaN;
}
const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
/* İETT's records → what the app draws. Left out: a record with no vehicle number, no position, a position outside İstanbul, no
   readable time, or a time more than ten minutes old (a bus that stopped reporting is not "where the bus is now"). If a vehicle
   is listed twice, the newer record wins. */
export function parseBuses(list, now) {
  if (!Array.isArray(list)) return null;
  const best = new Map();
  for (const r of list) {
    if (!r || !r.kapino) continue;
    const lat = num(r.enlem), lng = num(r.boylam), t = turkeyTime(r.son_konum_zamani);
    if (!(lat >= ISTANBUL_BOX[0] && lat <= ISTANBUL_BOX[2] && lng >= ISTANBUL_BOX[1] && lng <= ISTANBUL_BOX[3])) continue;
    if (!Number.isFinite(t) || now - t > TOO_OLD) continue;
    const id = String(r.kapino).slice(0, 12), was = best.get(id);
    if (was && was.t >= t) continue;
    best.set(id, { id, lat: +lat.toFixed(6), lng: +lng.toFixed(6), t, to: r.yon ? String(r.yon).slice(0, 60) : '', stop: r.yakinDurakKodu ? String(r.yakinDurakKodu).slice(0, 12) : '' });
  }
  return [...best.values()];
}
/* what to tell the page about one line, from what is stored: `snap` is the feeder's last answer for it ({ at, ok, body }) or
   null, `beat` the time the feeder was last heard from or 0 */
export function answerFor(line, snap, beat, now) {
  if (snap && now - snap.at < SNAP_FRESH) {
    if (!snap.ok) return { status: 502, body: { error: 'upstream' } };                 // the feeder asked İETT and İETT did not answer
    let buses = null; try { buses = JSON.parse(snap.body); } catch (e) { buses = null; }
    if (!Array.isArray(buses)) return { status: 502, body: { error: 'unreadable' } };
    return { status: 200, body: { line, at: snap.at, now, buses: buses.filter(b => b && now - b.t <= TOO_OLD) } };
  }
  if (beat && now - beat < FEEDER_ALIVE) return { status: 200, body: { line, at: now, now, buses: [], warming: true } };   // asked for; the answer is seconds away
  return { status: 503, body: { error: 'no-feed' } };
}
/* compared without stopping at the first wrong character */
export function sameToken(given, real) {
  if (typeof given !== 'string' || typeof real !== 'string' || !real || given.length !== real.length) return false;
  let diff = 0; for (let i = 0; i < real.length; i++) diff |= given.charCodeAt(i) ^ real.charCodeAt(i);
  return diff === 0;
}
export function json(body, status, origin, extra) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, corsHeaders(origin), extra || {}) });
}

const noted = new Map();       // line → when this instance last wrote "wanted" for it (so a busy line is one write per 20 s, not one per request)
let swept = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), origin = request.headers.get('Origin'), now = Date.now(), db = env.turkmaps_relay;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    if (url.pathname === '/iett/buses') {
      if (request.method !== 'GET') return json({ error: 'method' }, 405, origin, { 'Allow': 'GET, OPTIONS' });
      const line = (url.searchParams.get('line') || '').toUpperCase();
      if (!LINE_RE.test(line)) return json({ error: 'line' }, 400, origin);
      if (!db) return json({ error: 'no-feed' }, 503, origin);
      if (!(noted.get(line) > now - 20000)) {
        noted.set(line, now); if (noted.size > 500) noted.clear();
        ctx.waitUntil(db.prepare('INSERT INTO wanted (line, at) VALUES (?1, ?2) ON CONFLICT(line) DO UPDATE SET at = ?2').bind(line, now).run());
      }
      const [snap, beat] = await db.batch([db.prepare('SELECT at, ok, body FROM snap WHERE line = ?1').bind(line), db.prepare("SELECT v FROM meta WHERE k = 'feeder'")]);
      const a = answerFor(line, snap.results[0] || null, beat.results[0] ? beat.results[0].v : 0, now);
      return json(a.body, a.status, origin);
    }

    if (url.pathname === '/health') {
      const cf = request.cf || {};
      let beat = null; try { const r = db && await db.prepare("SELECT v FROM meta WHERE k = 'feeder'").first(); beat = r ? r.v : null; } catch (e) { beat = null; }
      return json({ relay: 'turkmaps', version: VERSION, colo: cf.colo || null, placement: request.headers.get('cf-placement') || null,
        feeder: beat ? { alive: now - beat < FEEDER_ALIVE, heardSecondsAgo: Math.round((now - beat) / 1000) } : { alive: false, heardSecondsAgo: null } }, 200, origin);
    }

    if (url.pathname === '/feed/wanted' || url.pathname === '/feed/push') {
      const auth = request.headers.get('Authorization') || '';
      if (!env.FEED_TOKEN || !db) return json({ error: 'not configured' }, 503, null);
      if (!sameToken(auth.replace(/^Bearer\s+/i, ''), env.FEED_TOKEN)) return json({ error: 'forbidden' }, 403, null);

      if (url.pathname === '/feed/wanted') {
        if (request.method !== 'GET') return json({ error: 'method' }, 405, null);
        const stmts = [db.prepare("INSERT INTO meta (k, v) VALUES ('feeder', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1").bind(now),
                       db.prepare('SELECT line FROM wanted WHERE at > ?1 ORDER BY at DESC LIMIT ?2').bind(now - WANTED_FOR, MAX_LINES)];
        if (now - swept > 300000) { swept = now; stmts.push(db.prepare('DELETE FROM wanted WHERE at < ?1').bind(now - 600000), db.prepare('DELETE FROM snap WHERE at < ?1').bind(now - 600000)); }
        const res = await db.batch(stmts);
        return json({ lines: res[1].results.map(r => r.line), now }, 200, null);
      }
      if (request.method !== 'POST') return json({ error: 'method' }, 405, null);
      if (+(request.headers.get('Content-Length') || 0) > 2000000) return json({ error: 'too large' }, 413, null);
      let body = null; try { body = await request.json(); } catch (e) { body = null; }
      const lines = body && body.lines && typeof body.lines === 'object' ? Object.entries(body.lines).filter(([k]) => LINE_RE.test(k)).slice(0, MAX_LINES) : null;
      if (!lines) return json({ error: 'body' }, 400, null);
      const stmts = [db.prepare("INSERT INTO meta (k, v) VALUES ('feeder', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1").bind(now)];
      let stored = 0;
      for (const [line, raw] of lines) {
        const buses = raw === null ? null : parseBuses(raw, now);
        stmts.push(db.prepare('INSERT INTO snap (line, at, ok, body) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(line) DO UPDATE SET at = ?2, ok = ?3, body = ?4')
          .bind(line, now, buses ? 1 : 0, buses ? JSON.stringify(buses) : '[]'));
        stored++;
      }
      await db.batch(stmts);
      return json({ stored }, 200, null);
    }

    if (url.pathname === '/') return json({ relay: 'turkmaps', version: VERSION, endpoints: ['/iett/buses?line=34G', '/health'] }, 200, origin);
    return json({ error: 'not found' }, 404, origin);
  },
};
