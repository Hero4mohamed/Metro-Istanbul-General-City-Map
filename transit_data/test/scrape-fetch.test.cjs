/* The disruptions scraper's page fetch.
 *
 * Twice on 23 Oct 2026 the scheduled run on GitHub's network got "fetch failed" from metro.istanbul — the same page
 * answered from a developer's machine at the same time — after days of success, and the log said nothing about why.
 * So the fetch retries, and every failed attempt reports its cause. What must NOT change is what happens when every
 * attempt fails: the run reports the source as unreachable and leaves disruptions.json alone (that part is main()'s,
 * and is only reached through the throw checked below).
 *
 * The helper is taken out of the scraper's source text, because the scraper runs main() when it is required.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function helper(log) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scrape-disruptions.cjs'), 'utf8');
  const a = src.indexOf('async function getWithRetry');
  const b = src.indexOf('\nasync function main()', a);
  assert.ok(a > 0 && b > a, 'getWithRetry is not in the scraper');
  return new Function('console', src.slice(a, b) + '\nreturn getWithRetry;')({ error: m => log.push(String(m)) });
}
const ok = body => ({ ok: true, status: 200, text: async () => body });
const reply = status => ({ ok: false, status, text: async () => '' });
const cause = code => { const e = new TypeError('fetch failed'); e.cause = { code }; return e; };

test('a page that answers first time is fetched once', async () => {
  const log = []; let calls = 0;
  const text = await helper(log)('https://x/', {}, 3, 0, async () => { calls++; return ok('<html>'); });
  assert.strictEqual(text, '<html>');
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(log, [], 'a clean fetch logged something');
});

test('a transient failure gets another chance, and the cause of each failure is logged', async () => {
  const log = []; let calls = 0;
  const text = await helper(log)('https://x/', {}, 3, 0, async () => {
    calls++;
    if (calls === 1) throw cause('UND_ERR_CONNECT_TIMEOUT');
    if (calls === 2) return reply(503);
    return ok('page');
  });
  assert.strictEqual(text, 'page');
  assert.strictEqual(calls, 3);
  assert.ok(/attempt 1\/3 failed: fetch failed \(UND_ERR_CONNECT_TIMEOUT\)/.test(log[0]), 'the cause was not logged: ' + log[0]);
  assert.ok(/attempt 2\/3 failed: HTTP 503/.test(log[1]), 'an HTTP error was not logged: ' + log[1]);
});

test('when every attempt fails the last error is thrown, so the caller leaves the feed untouched', async () => {
  const log = []; let calls = 0;
  await assert.rejects(
    helper(log)('https://x/', {}, 3, 0, async () => { calls++; throw cause('ECONNRESET'); }),
    /fetch failed/);
  assert.strictEqual(calls, 3, 'it gave up early or kept going past its attempts');
  assert.strictEqual(log.length, 3);
});

test('each attempt carries a timeout, so one stalled connection cannot hold the run open', async () => {
  const log = []; let seen;
  await helper(log)('https://x/', { headers: { 'User-Agent': 'u' } }, 1, 0, async (url, o) => { seen = o; return ok('p'); });
  assert.ok(seen.signal && typeof seen.signal.aborted === 'boolean', 'no abort signal was passed to fetch');
  assert.strictEqual(seen.headers['User-Agent'], 'u', 'the caller\'s headers were dropped');
});

test('the scraper reads the status page through it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scrape-disruptions.cjs'), 'utf8');
  assert.ok(src.indexOf('parseMetro(await getWithRetry(SRC') > 0, 'main() no longer uses the retrying fetch for metro.istanbul');
});
