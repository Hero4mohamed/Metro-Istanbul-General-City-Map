#!/usr/bin/env node
'use strict';
/* TurkMaps feeder: the half of the relay that has to sit in Türkiye.
 *
 * İETT's live-position service does not answer Cloudflare, so the Worker cannot ask it. This script can, from any always-on
 * computer on a Turkish connection (a laptop, a Raspberry Pi, a small server). Every 5 seconds it asks the Worker which bus lines
 * people have open, asks İETT about just those lines (each at most once per 15 seconds), and pushes the answers to the Worker.
 * With no lines open it makes one tiny request every 5 seconds and nothing else.
 *
 * It needs two values, from the environment or from a file named feeder.env next to this script (never committed):
 *   RELAY_URL=https://turkmaps-relay.<your-subdomain>.workers.dev
 *   FEED_TOKEN=<the same secret the Worker holds: `npx wrangler secret put FEED_TOKEN`>
 *
 *   node relay/feeder.cjs            run until stopped (Ctrl+C)
 *   node relay/feeder.cjs --once     one round, then exit (for a test)
 *   To pause without stopping it: create an empty file named PAUSED next to this script; delete it to resume.
 *
 * It uses curl for its requests (present on Windows 10+, macOS, Linux): on a PC whose antivirus re-signs HTTPS, Node's own
 * fetch refuses the connection and curl does not. No other dependency.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const IETT_URL = 'https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx';
const LINE_RE = /^[-0-9A-ZÇĞİÖŞÜ]{1,8}$/;
const EVERY = 5000, PER_LINE = 15000, AT_ONCE = 4;      // ask the Worker every 5 s; each line at most every 15 s; four İETT requests at a time

function config() {
  const cfg = { RELAY_URL: process.env.RELAY_URL || '', FEED_TOKEN: process.env.FEED_TOKEN || '' };
  const file = path.join(__dirname, 'feeder.env');
  if (fs.existsSync(file)) for (const ln of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = /^\s*(RELAY_URL|FEED_TOKEN)\s*=\s*(.+?)\s*$/.exec(ln); if (m && !cfg[m[1]]) cfg[m[1]] = m[2]; }
  cfg.RELAY_URL = cfg.RELAY_URL.replace(/\/+$/, '');
  return cfg;
}
function curl(args, input) {
  return new Promise(resolve => {
    const p = execFile('curl', ['-s', '-m', '25', '--compressed', '-w', '\n%{http_code}'].concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 }, (err, out) => {
      if (err && !out) return resolve({ status: 0, text: '' });
      const i = out.lastIndexOf('\n'); resolve({ status: +out.slice(i + 1) || 0, text: out.slice(0, i) });
    });
    if (input !== undefined) { p.stdin.on('error', () => {}); p.stdin.end(input); }
  });
}
const soap = line => '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
  + '<GetHatOtoKonum_json xmlns="http://tempuri.org/"><HatKodu>' + line + '</HatKodu></GetHatOtoKonum_json></soap:Body></soap:Envelope>';
/* the JSON text İETT wraps in a SOAP envelope → its records, or null when this is not an answer */
function unwrap(xml) {
  const m = /<GetHatOtoKonum_jsonResult>([\s\S]*?)<\/GetHatOtoKonum_jsonResult>/.exec(String(xml || ''));
  if (!m) return null;
  try { const v = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&')); return Array.isArray(v) ? v : null; } catch (e) { return null; }
}
async function askIett(line) {
  const r = await curl(['-X', 'POST', IETT_URL, '-H', 'Content-Type: text/xml; charset=utf-8', '-H', 'SOAPAction: "http://tempuri.org/GetHatOtoKonum_json"', '--data-binary', '@-'], soap(line));
  return r.status === 200 ? unwrap(r.text) : null;          // null: İETT did not answer; the Worker then says so instead of showing old buses
}

const last = new Map();            // line → when it was last fetched
const tally = { rounds: 0, lines: 0, failed: 0, relayDown: 0 };
async function round(cfg) {
  tally.rounds++;
  const w = await curl([cfg.RELAY_URL + '/feed/wanted', '-H', 'Authorization: Bearer ' + cfg.FEED_TOKEN]);
  if (w.status !== 200) { tally.relayDown++; return { ok: false, status: w.status }; }
  let lines = []; try { lines = (JSON.parse(w.text).lines || []).filter(l => LINE_RE.test(l)); } catch (e) { lines = []; }
  const now = Date.now(), due = lines.filter(l => !(last.get(l) > now - PER_LINE));
  if (!due.length) return { ok: true, wanted: lines.length, fetched: 0 };
  const out = {};
  for (let i = 0; i < due.length; i += AT_ONCE) {
    await Promise.all(due.slice(i, i + AT_ONCE).map(async l => { last.set(l, Date.now()); const v = await askIett(l); out[l] = v; tally.lines++; if (v === null) tally.failed++; }));
  }
  const p = await curl(['-X', 'POST', cfg.RELAY_URL + '/feed/push', '-H', 'Authorization: Bearer ' + cfg.FEED_TOKEN, '-H', 'Content-Type: application/json', '--data-binary', '@-'], JSON.stringify({ lines: out }));
  if (p.status !== 200) tally.relayDown++;
  for (const k of last.keys()) if (Date.now() - last.get(k) > 600000) last.delete(k);
  return { ok: p.status === 200, wanted: lines.length, fetched: due.length, buses: Object.values(out).reduce((n, v) => n + (v ? v.length : 0), 0) };
}

async function main() {
  const cfg = config();
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(cfg.RELAY_URL) || !cfg.FEED_TOKEN) { console.error('feeder: set RELAY_URL and FEED_TOKEN (environment, or relay/feeder.env). See the top of this file.'); process.exit(2); }
  if (process.argv.includes('--once')) { console.log(JSON.stringify(await round(cfg))); return; }
  console.log(new Date().toISOString() + ' feeder started for ' + cfg.RELAY_URL);
  let lastLog = Date.now();
  for (;;) {
    const t0 = Date.now();
    // the off switch: a file named PAUSED next to this script. While it exists nothing is asked of anyone, and the app says
    // that live buses are not running.
    if (!fs.existsSync(path.join(__dirname, 'PAUSED'))) { try { await round(cfg); } catch (e) { tally.relayDown++; } }
    if (Date.now() - lastLog > 600000) { console.log(new Date().toISOString() + ' rounds ' + tally.rounds + ', line fetches ' + tally.lines + ' (' + tally.failed + ' unanswered by İETT), relay errors ' + tally.relayDown); lastLog = Date.now(); }
    await new Promise(r => setTimeout(r, Math.max(500, EVERY - (Date.now() - t0))));
  }
}
if (require.main === module) main();
module.exports = { unwrap, soap, LINE_RE, IETT_URL };
