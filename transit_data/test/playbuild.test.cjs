'use strict';
/* The Android app (Google Play) is this same page opened full-screen by a thin Android shell. Two things are deliberately different
 * there (src/00a-play-build.js):
 *   - the optional Claude layer of "Ask the map" is off: the key is never read, so nothing is ever sent to api.anthropic.com
 *     ("Ask the map" itself, which answers from the map's own data, stays), because Google Play asks generative-AI features for an
 *     in-app way to report offensive output and there is none;
 *   - the fare card is always the drawn face, never an operator's real card picture.
 * The website keeps both. These tests run the REAL built code against fake pages and shells.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const script = () => H.appScript().replace(/\r\n/g, '\n');
function fnSource(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = src.indexOf('{', m.index + m[0].length), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

/* the detection code exactly as built: the function, the constant, and the line that tags the page */
const DETECT = (() => {
  const s = script();
  const m = /function detectPlayApp\(\)[\s\S]*?const PLAY_APP = detectPlayApp\(\);\nif\(PLAY_APP\)\{[^\n]*\}/.exec(s);
  assert.ok(m, 'the Android-app detection is not in the built page');
  return m[0];
})();

/* one page load in a fake browser: what the page was opened from, its address, and the window's session storage */
function load({ referrer = '', search = '', session = new Map(), sessionThrows = false } = {}) {
  const classes = new Set();
  const sessionStorage = sessionThrows
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: k => (session.has(k) ? session.get(k) : null), setItem: (k, v) => { session.set(k, String(v)); } };
  const ctx = vm.createContext({ document: { referrer, documentElement: { classList: { add: c => classes.add(c) } } }, location: { search }, sessionStorage });
  const on = vm.runInContext(DETECT + '\nPLAY_APP', ctx);
  return { on, classes, session };
}

test('play build: a page opened by the Android shell is recognised, by the referrer or by the marker on the address', () => {
  for (const referrer of ['android-app://io.github.hero4mohamed.raynet', 'android-app://io.github.hero4mohamed.raynet/', 'ANDROID-APP://x.y']) {
    const r = load({ referrer });
    assert.strictEqual(r.on, true, 'the shell\'s referrer was not recognised: ' + referrer);
    assert.ok(r.classes.has('play-app'), 'the page was not tagged play-app');
  }
  for (const search of ['?src=play', '?v=3&src=play', '?src=play&v=3', '?city=ankara&src=play&x=1']) assert.strictEqual(load({ search }).on, true, 'the marker was not recognised: ' + search);
});

test('play build: an ordinary visit is not mistaken for the Android app', () => {
  for (const o of [{}, { referrer: 'https://www.google.com/' }, { referrer: 'https://hero4mohamed.github.io/Metro-Istanbul-General-City-Map/legal/privacy.html' },
                   { search: '?src=playground' }, { search: '?nosrc=play' }, { search: '?src=web' }, { search: '?city=izmir' }, { referrer: 'x-android-app://a' }]) {
    const r = load(o);
    assert.strictEqual(r.on, false, 'taken for the Android app: ' + JSON.stringify(o));
    assert.ok(!r.classes.has('play-app') && !r.session.has('irn_play'), 'an ordinary visit was tagged or remembered as the Android app');
  }
});

test('play build: the window remembers it, so a trip to a legal page and back does not switch the website behaviour on', () => {
  const session = new Map();
  assert.strictEqual(load({ referrer: 'android-app://io.github.hero4mohamed.raynet', session }).on, true);
  assert.strictEqual(session.get('irn_play'), '1', 'the window did not remember it was opened from the Android app');
  // the legal page's "back to the app" link is a new navigation whose referrer is the legal page
  const back = load({ referrer: 'https://hero4mohamed.github.io/Metro-Istanbul-General-City-Map/legal/privacy.html', session });
  assert.strictEqual(back.on, true, 'after a visit to a legal page the app turned back into the website');
  assert.ok(back.classes.has('play-app'));
  // another window (its own session) is not affected
  assert.strictEqual(load({ referrer: 'https://hero4mohamed.github.io/' }).on, false, 'the memory leaked into another window');
});

test('play build: blocked session storage never breaks the page and the referrer or marker still work', () => {
  assert.strictEqual(load({ referrer: 'android-app://a.b', sessionThrows: true }).on, true);
  assert.strictEqual(load({ search: '?src=play', sessionThrows: true }).on, true);
  assert.strictEqual(load({ sessionThrows: true }).on, false);
});

test('play build: the detection runs before anything reads it', () => {
  const s = script();
  const at = s.indexOf('const PLAY_APP = detectPlayApp();');
  assert.ok(at > 0);
  for (const user of ['function aiKey(', 'function cardPicture(', 'const CARD_IMG =']) assert.ok(at < s.indexOf(user), 'PLAY_APP is set after ' + user + ' (a read before it is set throws)');
});

test('play build: the Android app never reads the Anthropic key, so it never contacts Anthropic', () => {
  const s = script();
  const code = fnSource(s, 'aiKey');
  const run = (play, stored) => {
    let read = 0;
    const ctx = vm.createContext({ PLAY_APP: play, localStorage: { getItem: k => { read++; return k === 'irn_ai_key' ? stored : null; } } });
    return { key: vm.runInContext(code + '\naiKey()', ctx), read };
  };
  assert.deepStrictEqual(run(false, 'sk-ant-abc'), { key: 'sk-ant-abc', read: 1 }, 'the website no longer reads its key');
  assert.deepStrictEqual(run(true, 'sk-ant-abc'), { key: '', read: 0 }, 'the Android app read a key (a key saved on the website shares the storage with the shell)');
  // the one place that calls Anthropic starts from aiKey(), and there is exactly one such place
  assert.strictEqual((s.match(/https:\/\/api\.anthropic\.com/g) || []).length, 1, 'there is more than one call to Anthropic');
  const llm = fnSource(s, 'aiLLM');
  assert.ok(/^async function aiLLM\(question\)\{\s*const key = aiKey\(\); if\(!key\) return null;/.test(llm), 'aiLLM no longer starts from aiKey(): the Android app could reach Anthropic');
  assert.strictEqual((s.match(/localStorage\.getItem\(\s*["']irn_ai_key["']\s*\)/g) || []).length, 1, 'the key is read somewhere other than aiKey()');
});

test('play build: the Android app shows the drawn card, the website the real picture, and nothing else reads the pictures', () => {
  const s = script();
  const code = fnSource(s, 'cardPicture');
  const CARD_IMG = { cities: { istanbul: { tam: { src: 'data:image/png;base64,AAAA', credit: 'Belbim A.Ş.' } } } };
  const run = (play, city, key) => vm.runInContext(code + '\ncardPicture("' + key + '")', vm.createContext({ PLAY_APP: play, CARD_IMG, CITY_ID: city }));
  assert.strictEqual(run(false, 'istanbul', 'tam').credit, 'Belbim A.Ş.', 'the website lost its card picture');
  assert.strictEqual(run(true, 'istanbul', 'tam'), null, 'the Android app shows an operator\'s card picture');
  assert.ok(!run(false, 'izmir', 'tam') && !run(false, 'istanbul', 'unknown'), 'a card with no picture got one');
  assert.strictEqual((s.match(/CARD_IMG\.cities/g) || []).length, 1, 'the card pictures are read somewhere other than cardPicture(), which the Android app would not be held back by');
  assert.ok(/function cardFaceHTML\(key, c\)\{\s*const img=cardPicture\(key\);/.test(s), 'the card face does not go through cardPicture()');
  assert.ok(/const ci=cardPicture\(fareCard\);/.test(s), 'the card credit does not go through cardPicture(): the Android app would credit a picture it does not show');
});

test('play build: the Android app has no box for the key, and the rule that hides it cannot lose to another rule', () => {
  const css = H.appStyle();
  assert.ok(/\.play-app #aiKeyRow\{display:none !important;\}/.test(css), 'the key box is shown in the Android app');
  assert.ok(/id="aiKeyRow"/.test(H.html()), 'the key row has moved: the rule above no longer hides it');
});
