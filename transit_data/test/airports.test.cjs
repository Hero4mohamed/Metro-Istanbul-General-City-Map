'use strict';
/* The Airports tab (V4.5.2): choose an airport, choose departures or arrivals, and a button opens that board on the airport's
 * own website. The app has no flight data and fetches none; these tests keep the list honest (official sites only, the right
 * board behind each button) and the links safe. Each test runs the REAL built code. */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

const APP = H.appScript().replace(/\r\n/g, '\n');
const HTML = H.html();
function fnSource(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = src.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1); }
  throw new Error('unbalanced braces in ' + name);
}
const PURE = APP.slice(APP.indexOf('/* ==AIRPORTS-PURE-START== */'), APP.indexOf('/* ==AIRPORTS-PURE-END== */'));
assert.ok(PURE.length > 400, 'the airports list is not in the built page');
const A = (() => { const m = { exports: {} }; new Function('module', PURE + '\nmodule.exports = { AIRPORT_BOARDS, AIR_DHMI, airportBoards, airportLinks, airportSite };')(m); return m.exports; })();
const CITIES = Object.keys(JSON.parse(APP.slice(APP.indexOf('const CITIES = ') + 15, APP.indexOf(';\nconst INTERCITY_LINES_JSON'))));
/* the only sites a button may open: each airport's own, and the State Airports Authority's page for the airports it runs */
const OFFICIAL = ['istairport.com', 'sabihagokcen.aero', 'izmirairport.com', 'antalya-airport.aero', 'dhmi.gov.tr'];

test('airports: every city has its airport, and every button leads to an official flight board over https', () => {
  assert.deepStrictEqual(CITIES.filter(c => !A.airportBoards(c).length), [], 'a city of the app has no airport in the Airports tab');
  assert.deepStrictEqual(Object.keys(A.AIRPORT_BOARDS).filter(c => !CITIES.includes(c)), [], 'airports are listed for a city the app does not have');
  for (const city of CITIES) {
    const list = A.airportBoards(city);
    assert.strictEqual(new Set(list.map(a => a.code)).size, list.length, city + ' lists an airport twice');
    for (const a of list) {
      assert.ok(/^[A-Z]{3}$/.test(a.code) && a.name.length > 5, city + ': an airport has no proper code or name');
      for (const kind of ['dep', 'arr']) {
        const got = A.airportLinks(a, kind);
        assert.ok(got.links.length >= 1, a.code + ' has no button for ' + kind);
        for (const l of got.links) {
          assert.ok(/^https:\/\/[a-z0-9.-]+\/[^?#\s]*$/.test(l.url), a.code + ': not a plain https address: ' + l.url);
          assert.ok(OFFICIAL.includes(A.airportSite(l.url)), a.code + ': ' + A.airportSite(l.url) + ' is not an airport\'s own site');
          assert.ok(['', 'intl', 'dom'].includes(l.k));
        }
      }
    }
  }
  assert.strictEqual(A.airportSite('https://www.istairport.com/en/flights/flight-info/departure-flights'), 'istairport.com');
});

test('airports: departures and arrivals open different boards where the airport has two, and the app says so where it has one', () => {
  const by = code => Object.values(A.AIRPORT_BOARDS).flat().find(a => a.code === code);
  for (const code of ['IST', 'ADB', 'AYT']) {
    const dep = A.airportLinks(by(code), 'dep'), arr = A.airportLinks(by(code), 'arr');
    assert.ok(!dep.shared && !arr.shared);
    assert.ok(dep.links.every(l => !arr.links.some(x => x.url === l.url)), code + ': the Departures button opens the arrivals board (or the other way round)');
    assert.ok(dep.links.every(l => /depart|gidis/.test(l.url)) && arr.links.every(l => /arriv|gelis/.test(l.url)), code + ': a board address does not match its kind');
  }
  const ayt = A.airportLinks(by('AYT'), 'dep');
  assert.deepStrictEqual(ayt.links.map(l => l.k), ['intl', 'dom'], 'Antalya has separate international and domestic boards; both must be offered and told apart');
  assert.ok(/dis-hat/.test(ayt.links[0].url) && /yurtici/.test(ayt.links[1].url), 'Antalya\'s international button opens the domestic board');
  const saw = A.airportLinks(by('SAW'), 'arr');
  assert.deepStrictEqual([saw.shared, saw.pick, saw.links.length], [true, false, 1]);
  for (const code of ['ESB', 'YEI', 'KCO']) {
    const got = A.airportLinks(by(code), 'dep');
    assert.strictEqual(got.links[0].url, A.AIR_DHMI);
    assert.deepStrictEqual([got.shared, got.pick], [true, true], code + ': the page lists every airport, and the person is not told to choose theirs there');
  }
});

test('airports: the tab and its card exist, the view shows them, and a button opens a new tab without handing this page over', () => {
  assert.ok(/<button data-tab="airport" role="tab" aria-selected="false" data-i18n="tabAirport">/.test(HTML), 'there is no Airports tab');
  assert.ok(/<div class="card glass" id="cardAirports" style="display:none;">/.test(HTML) && /id="airList"/.test(HTML) && /id="airBoard" hidden/.test(HTML), 'the Airports card is missing or shown from the start');
  const tab = fnSource(APP, 'setTab');
  assert.ok(/getElementById\('cardAirports'\)\.style\.display = \(t==='airport'\) \? '' : 'none';/.test(tab), 'choosing the Airports tab does not show its card (or leaving it does not hide it)');
  assert.ok(/t==='airport'\)\{[^}]*renderAirports\(\)/.test(tab), 'choosing the Airports tab does not fill the list');
  assert.ok(/cardLayers'\)\.style\.display = \(t==='weather' \|\| t==='airport'\) \? 'none' : ''/.test(tab), 'on a phone the airports would sit below the whole map-layers card');
  const board = fnSource(APP, 'renderAirBoard');
  assert.ok(/<a class="air-open" href="\$\{attrEsc\(l\.url\)\}" target="_blank" rel="noopener noreferrer">/.test(board), 'an airport button replaces the app, or gives the opened site a handle on this page');
  assert.ok(/data-kind="\$\{k\}"/.test(board) && /kindBtn\('dep'/.test(board) && /kindBtn\('arr'/.test(board), 'there is no choice between departures and arrivals');
  assert.ok(/t\('airWhy'\)/.test(board), 'the card does not say why the table is not in the app');
});

test('airports: the app fetches nothing from an airport, and the privacy notice says the buttons open other sites', () => {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(HTML)[1];
  for (const host of OFFICIAL) assert.ok(!csp.includes(host), 'the security policy lets the page fetch from ' + host + ': the tab is meant to open the site, not read it');
  assert.ok(!/fetch\([^)]*(istairport|sabihagokcen|izmirairport|antalya-airport|dhmi\.gov)/.test(APP), 'the app fetches from an airport\'s site');
  const fs = require('node:fs'), path = require('node:path');
  const en = fs.readFileSync(path.join(__dirname, '..', '..', 'legal', 'privacy.html'), 'utf8'), tr = fs.readFileSync(path.join(__dirname, '..', '..', 'legal', 'privacy.tr.html'), 'utf8');
  assert.ok(/the airports(&#39;|'|’) own flight boards from the Airports tab/.test(en), 'the English privacy notice does not mention the airport links');
  assert.ok(/Havalimanları sekmesinden havalimanlarının kendi uçuş tabloları/.test(tr), 'the Turkish privacy notice does not mention the airport links');
});

test('airports: every language has every line, with the places for the site and the airport name', () => {
  const keys = ['tabAirport', 'airTitle', 'airIntro', 'airNone', 'airKind', 'airDep', 'airArr', 'airOpen', 'airIntl', 'airDom', 'airShared', 'airPick', 'airWhy'];
  for (const k of keys) assert.strictEqual((APP.match(new RegExp('[ ,{]' + k + ':"', 'g')) || []).length, 4, k + ' is not in all four languages');
  assert.strictEqual((APP.match(/airOpen:"[^"]*\{site\}/g) || []).length, 4, 'a language has no place for the site in "Open the live board on …"');
  assert.strictEqual((APP.match(/airPick:"[^"]*\{name\}/g) || []).length, 4, 'a language has no place for the airport name');
  assert.ok(/currentTab==='airport'\) renderAirports\(\)/.test(fnSource(APP, 'relocalise')), 'changing the language leaves the Airports card in the old one');
});
