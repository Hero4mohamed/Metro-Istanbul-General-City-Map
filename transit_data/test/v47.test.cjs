'use strict';
/* V4.7: the profile corner (account + friends at the top right) and favourite places saved on this device only.
 * The favourites store, the list and the profile/friends rendering run here as the REAL built app code in vm sandboxes. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

const APP = () => H.appScript().replace(/\r\n/g, '\n');
function region(name) {
  const s = APP(), a = s.indexOf('/* ==' + name + '-START== */'), b = s.indexOf('/* ==' + name + '-END== */');
  assert.ok(a > 0 && b > a, 'the ' + name + ' block is missing');
  return s.slice(a, b);
}
const esc = s => (s == null ? '' : '' + s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => (s == null ? '' : '' + s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* A sandbox running the real favourites store. `fetch` throws: favourites must never use the network. */
function favWorld(store = {}, extra = {}) {
  const ctx = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    fetch: () => { throw new Error('favourites made a network request'); },
    XMLHttpRequest: function () { throw new Error('favourites made a network request'); },
    t: k => k, svgEsc: esc, attrEsc: attr, Math, JSON, Date,
  };
  Object.assign(ctx, extra);
  vm.createContext(ctx);
  vm.runInContext(region('FAV-PURE') + '\nthis.api = { FAV_KEY, FAV_MAX, favLoad, favSave, favFind, favAdd, favRemove, favRename,'
    + ' get favListHTML(){ return typeof favListHTML === "function" ? favListHTML : null; } };', ctx);
  return { api: ctx.api, store, ctx };
}
const plain = v => JSON.parse(JSON.stringify(v));

/* ---------------------------------------------------------------- store ---- */
test('fav: a missing, broken or non-array store reads as an empty list', () => {
  for (const v of [undefined, '{oops', '{"a":1}', 'null', '7']) {
    const w = favWorld(v === undefined ? {} : { irn_favplaces: v });
    assert.deepStrictEqual(plain(w.api.favLoad()), [], 'store ' + v + ' did not read as empty');
  }
});
test('fav: entries without a name or coordinates are skipped, the rest kept', () => {
  const w = favWorld({ irn_favplaces: JSON.stringify([{ id: 'a', name: '', lat: 1, lng: 1 }, { id: 'b', name: 'X', lat: 'n', lng: 1 },
    null, 5, { id: 'd', name: 'No lng', lat: 41 }, { id: 'c', name: 'Ok', lat: 41, lng: 29 }]) });
  assert.deepStrictEqual(plain(w.api.favLoad().map(f => f.id)), ['c']);
});
test('fav: adding the same place twice keeps one; a different name at the same spot is a new one', () => {
  const w = favWorld(), a = w.api;
  let r = a.favAdd([], { name: 'Moda Cafe', lat: 40.98, lng: 29.02, kind: 'place' }, 1000);
  r = a.favAdd(r.list, { name: 'Moda Cafe', lat: 40.98, lng: 29.02, kind: 'place' }, 2000);
  assert.strictEqual(r.list.length, 1);
  r = a.favAdd(r.list, { name: 'moda cafe ', lat: 40.98018, lng: 29.02, kind: 'place' }, 3000);   // ~20 m north
  assert.strictEqual(r.list.length, 1, 'the same name 20 m away was added again');
  r = a.favAdd(r.list, { name: 'Moda Park', lat: 40.98, lng: 29.02, kind: 'place' }, 4000);
  assert.strictEqual(r.list.length, 2);
  r = a.favAdd(r.list, { name: 'Moda Cafe', lat: 40.99, lng: 29.02, kind: 'place' }, 5000);      // ~1.1 km away
  assert.strictEqual(r.list.length, 3, 'a same-named place far away is a different place');
  assert.ok(/^f[0-9a-z]+$/.test(r.fav.id) && r.fav.id.length >= 6, 'id ' + r.fav.id);
  assert.strictEqual(r.fav.saved, 5000);
});
test('fav: newest first; past 200 the oldest is dropped and reported', () => {
  const a = favWorld().api;
  let list = [], r;
  for (let i = 0; i < 201; i++) { r = a.favAdd(list, { name: 'P' + i, lat: 41, lng: 29 + i * 0.01 }, 1000 + i); list = r.list; if (i < 200) assert.strictEqual(r.dropped, false); }
  assert.strictEqual(a.FAV_MAX, 200);
  assert.strictEqual(list.length, 200);
  assert.strictEqual(list[0].name, 'P200');
  assert.ok(!list.some(f => f.name === 'P0'), 'the oldest was kept');
  assert.strictEqual(r.dropped, true);
});
test('fav: rename trims, caps at 60 characters and ignores an empty name; remove deletes only that id', () => {
  const a = favWorld().api;
  let list = a.favAdd([], { name: 'One', lat: 41, lng: 29 }, 1).list;
  list = a.favAdd(list, { name: 'Two', lat: 41, lng: 30 }, 2).list;
  const id1 = list[1].id, id2 = list[0].id;
  list = a.favRename(list, id1, '  Home of Ayşe  ');
  assert.strictEqual(list.find(f => f.id === id1).name, 'Home of Ayşe');
  list = a.favRename(list, id1, '   ');
  assert.strictEqual(list.find(f => f.id === id1).name, 'Home of Ayşe', 'an empty name was accepted');
  list = a.favRename(list, id1, 'x'.repeat(80));
  assert.strictEqual(list.find(f => f.id === id1).name.length, 60);
  list = a.favRemove(list, id1);
  assert.deepStrictEqual(plain(list.map(f => f.id)), [id2]);
});
test('fav: the store makes no network request', () => {
  const w = favWorld(), a = w.api;
  let list = a.favLoad();
  list = a.favAdd(list, { name: 'Kadıköy', lat: 40.99, lng: 29.03, kind: 'place', ic: '📍', ctx: 'Kadıköy', city: 'istanbul' }, 9).list;
  a.favSave(list);
  list = a.favRename(a.favLoad(), list[0].id, 'K');
  a.favSave(a.favRemove(list, list[0].id));
  assert.deepStrictEqual(plain(a.favLoad()), []);
  assert.ok('irn_favplaces' in w.store, 'favSave did not write irn_favplaces');
});
test('fav: saved entries keep their kind, icon, district and city', () => {
  const w = favWorld(), a = w.api;
  a.favSave(a.favAdd([], { name: 'Taksim', lat: 41.037, lng: 28.985, kind: 'station', ic: '🚉', ctx: 'M2', city: 'istanbul' }, 77).list);
  const f = a.favLoad()[0];
  assert.deepStrictEqual(plain([f.kind, f.ic, f.ctx, f.city, f.saved]),['station', '🚉', 'M2', 'istanbul', 77]);
});

/* ----------------------------------------------------------------- saving ---- */
/* the source of one top-level `function name(` of the built app, by brace matching */
function fnSrc(name) {
  const s = APP(), i = s.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'function ' + name + ' not found');
  let depth = 0, k = s.indexOf('{', s.indexOf(')', i));
  for (let j = k; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) return s.slice(i, j + 1); }
  throw new Error('unbalanced ' + name);
}
/* run the real dropPin() against a stub Leaflet; returns the pop-up HTML it built */
function popupFor(p, saved) {
  let html = '';
  const marker = { addTo() { return this; }, bindPopup(h) { html = h; return this; }, openPopup() {} };
  const ctx = { L: { marker: () => marker, divIcon: () => ({}) }, map: { removeLayer() {}, getSize: () => ({ x: 0, y: 0 }), getZoom: () => 12 },
    pinMarker: null, pinPlace: null, nearestStops: () => [], walkMin: m => m, t: k => k, svgEsc: esc, favIsSaved: () => !!saved, isFinite };
  vm.createContext(ctx);
  vm.runInContext('var pinMarker = null, pinPlace = null;\n' + fnSrc('mapUsable') + fnSrc('dropPin') + '\ndropPin(' + JSON.stringify(p) + ', 15);', ctx);
  return html;
}
test('fav ui: the place pop-up has Save beside Route from, Route to and Near here', () => {
  const h = popupFor({ name: 'Moda', lat: 40.98, lng: 29.02 }, false);
  assert.match(h, /data-pin="O"[\s\S]*data-pin="D"[\s\S]*data-pin="N"[\s\S]*data-pin="S"[^>]*>[^<]*favSave/, 'no Save in the pop-up');
  assert.match(popupFor({ name: 'Moda', lat: 40.98, lng: 29.02 }, true), /data-pin="S"[^>]*>[^<]*favSaved/, 'a saved place does not say Saved');
});
test('fav ui: the station panel has a Save button', () => {
  const h = H.html(), i = h.indexOf('id="stn"'), rb = h.indexOf('class="rowbtns"', i), end = h.indexOf('</div>', rb);
  assert.ok(i > 0 && rb > i, 'no station panel buttons');
  assert.match(h.slice(rb, end), /<button id="stnFav"[^>]*data-i18n="favSave"/, 'no Save button in the station panel');
});
/* the real FAV-CORE against stubs; `turnMoved` = did the last right-button gesture turn the map */
function coreWorld(o = {}) {
  const store = {}, calls = { drop: [], toast: [], changed: 0, ask: [] }, handlers = {};
  const ctx = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    fetch: () => { throw new Error('favourites made a network request'); },
    t: k => k, svgEsc: esc, attrEsc: attr, Math, JSON, Date, CITY_ID: 'istanbul', turnMoved: !!o.turnMoved,
    map: { on: (ev, fn) => { handlers[ev] = fn; }, getZoom: () => 13 },
    dropPin: (p, z) => calls.drop.push(p), showToast: m => calls.toast.push(m), favChanged: () => { calls.changed++; },
    favAskName: (def, cb) => { calls.ask.push(def); cb(o.answer); },
  };
  vm.createContext(ctx);
  vm.runInContext(region('FAV-PURE') + region('FAV-CORE')
    + '\nthis.api = { favToggle, favIsSaved, dropPinAt, favLoad, setTurn: v => { turnMoved = v; } };', ctx);
  return { api: ctx.api, store, calls, handlers, ctx };
}
test('fav ui: a dropped pin is offered on a long press or a still right-click, never after turning the map', () => {
  const w = coreWorld({ turnMoved: true });
  assert.ok(w.handlers.contextmenu, 'the map does not listen for a long press / right-click');
  w.handlers.contextmenu({ latlng: { lat: 41.012345, lng: 28.976543 } });
  assert.strictEqual(w.calls.drop.length, 0, 'turning the map with the right button dropped a pin');
  w.api.setTurn(false);
  w.handlers.contextmenu({ latlng: { lat: 41.012345, lng: 28.976543 } });
  assert.strictEqual(w.calls.drop.length, 1);
  const p = w.calls.drop[0];
  assert.deepStrictEqual(plain([p.kind, p.ic, p.name, p.ctx, p.city]), ['pin', '📍', 'favPinName', '41.012, 28.977', 'istanbul']);
  const s = APP(), a = s.indexOf('L.Map.IrnMouse = '), turn = s.slice(s.indexOf('_onDown: function', a), s.indexOf('_onWheel: function', a));
  assert.match(turn, /turnMoved = false/, 'a new right-button press does not reset the turn flag');
  assert.match(turn, /this\._mm = ev => \{[^}]*turnMoved = true/, 'turning the map with the mouse does not set the turn flag');
});
test('fav ui: saving a dropped pin asks for its name; the name is stored as typed and shown escaped', () => {
  const w = coreWorld({ answer: '<b>"x"' });
  const pin = { name: 'favPinName', lat: 41.01, lng: 28.97, kind: 'pin', ic: '📍', ctx: '41.010, 28.970', city: 'istanbul' };
  assert.strictEqual(w.api.favToggle(pin), true);
  assert.deepStrictEqual(plain(w.calls.ask), ['favPinName'], 'a dropped pin was saved without asking for a name');
  assert.strictEqual(w.api.favLoad()[0].name, '<b>"x"');
  assert.deepStrictEqual(plain(w.calls.toast), ['favAdded']);
  const h = popupFor({ name: '<b>"x"', lat: 41.01, lng: 28.97 }, true);
  assert.ok(h.includes('&lt;b&gt;') && !h.includes('<b>"x"'), 'the name is not escaped in the pop-up');
});
test('fav ui: a cancelled name saves nothing; Save on a saved place removes it', () => {
  const w = coreWorld({ answer: null });
  w.api.favToggle({ name: 'favPinName', lat: 41, lng: 29, kind: 'pin' });
  assert.strictEqual(w.api.favLoad().length, 0, 'cancelling the name still saved the pin');
  const place = { name: 'Moda', lat: 40.98, lng: 29.02, kind: 'place', ic: '☕', ctx: 'Kadıköy' };
  assert.strictEqual(w.api.favToggle(place), true);
  assert.strictEqual(w.api.favIsSaved(place), true);
  assert.strictEqual(w.api.favLoad()[0].city, 'istanbul', 'the city was not stored');
  assert.strictEqual(w.api.favToggle(place), false);
  assert.strictEqual(w.api.favIsSaved(place), false);
  assert.deepStrictEqual(plain(w.calls.toast), ['favAdded', 'favRemoved']);
  assert.ok(w.calls.changed >= 2, 'the buttons and list were not told');
});

/* ------------------------------------------------------------------- list ---- */
const LABEL = id => ({ istanbul: 'İstanbul', izmir: 'İzmir', ankara: 'Ankara' }[id] || id);
function listHTML(list, home, work, city = 'istanbul') {
  const f = favWorld().api.favListHTML;
  assert.ok(f, 'favListHTML is missing from FAV-PURE');
  return f(list, home, work, city, LABEL);
}
const F = (id, name, extra) => Object.assign({ id, name, lat: 41, lng: 29, kind: 'place', ic: '📍', ctx: 'Kadıköy', city: 'istanbul', saved: 1 }, extra || {});
test('fav list: Home and Work come first, then favourites newest first', () => {
  const h = listHTML([F('fb', 'Newer'), F('fa', 'Older')], { name: 'Flat', lat: 41, lng: 29 }, { name: 'Office', lat: 41.1, lng: 29 });
  const order = ['data-fav-open="home"', 'data-fav-open="work"', 'data-fav-open="fb"', 'data-fav-open="fa"'].map(s => h.indexOf(s));
  assert.ok(order.every(i => i >= 0), 'a row is missing: ' + order);
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order, 'rows are out of order');
  assert.ok(h.includes('homeP') && h.includes('Flat') && h.includes('workP') && h.includes('Office'));
  const noHome = listHTML([F('fa', 'Older')], null, null);
  assert.ok(!noHome.includes('data-fav-open="home"') && !noHome.includes('data-fav-open="work"'), 'an empty Home/Work row is shown');
});
test('fav list: empty shows the how-to hint', () => {
  assert.match(listHTML([], null, null), /favEmpty/);
  assert.doesNotMatch(listHTML([F('fa', 'X')], null, null), /favEmpty/);
});
test('fav list: a favourite from another city is marked with its city and dimmed', () => {
  const h = listHTML([F('fz', 'Kordon', { city: 'izmir' }), F('fi', 'Moda')], null, null, 'istanbul');
  const row = id => { const i = h.indexOf('data-fav-id="' + id + '"'); return h.slice(h.lastIndexOf('<div class="fav-row', i), h.indexOf('</div><!--row-->', i)); };
  assert.match(row('fz'), /class="fav-row fav-other"/, 'the other city row is not dimmed');
  assert.ok(row('fz').includes('İzmir'), 'the other city is not named');
  assert.doesNotMatch(row('fi'), /fav-other/);
  assert.ok(!row('fi').includes('İstanbul'), 'a favourite of this city names the city for nothing');
});
test('fav list: names and districts are escaped', () => {
  const h = listHTML([F('f1', '<img src=x onerror=alert(1)>', { ctx: '<script>x</script>', ic: '<u>' })], { name: '<i>h</i>', lat: 1, lng: 1 }, null);
  for (const raw of ['<img', '<script', '<u>', '<i>h']) assert.ok(!h.includes(raw), 'raw HTML in the list: ' + raw);
  assert.ok(h.includes('&lt;img'), 'the name is not shown at all');
  const bad = listHTML([F('x" onclick="alert(1)', 'Y')], null, null);
  assert.ok(!bad.includes('" onclick="'), 'an id breaks out of its attribute');
});
test('fav list: every row has Go and a menu with Rename, Make Home, Make Work, Remove', () => {
  const h = listHTML([F('f1', 'A'), F('f2', 'B')], null, null);
  for (const id of ['f1', 'f2'])
    for (const act of ['go', 'menu', 'rename', 'home', 'work', 'remove'])
      assert.ok(h.includes('data-fav-act="' + act + '" data-fav-id="' + id + '"'), id + ' has no ' + act);
  assert.ok(/data-fav-act="menu"[^>]*aria-expanded="false"/.test(h), 'the menu button does not say it is closed');
  const hw = listHTML([], { name: 'Flat', lat: 41, lng: 29 }, null);
  assert.ok(hw.includes('data-fav-act="go" data-fav-id="home"'), 'Home has no Go');
});
test('fav list: Go and opening use the planner and the pin, not the network; another city switches city with the favourite', () => {
  const src = fnSrc('favOpen') + fnSrc('goToPlace');
  assert.match(src, /switchCity\([^)]*\{\s*fav:/, 'another city is not switched to with the favourite');
  assert.match(src, /dropPin\(/); assert.match(src, /setPoint\('D'/);
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest/);
  assert.match(fnSrc('useSavedPlace'), /goToPlace\(/, 'Home/Work chips do not go through goToPlace');
  assert.match(fnSrc('switchCity'), /extra/, 'switchCity cannot carry the favourite');
});

/* ------------------------------------------------------------ friends tab ---- */
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = claims => b64u({ alg: 'none' }) + '.' + b64u(claims) + '.sig';
const SESSION = verified => ({ irn_account: JSON.stringify({ uid: 'uidA', email: 'a@x.test', name: 'Ayşe', verified, refreshToken: 'r1', idToken: jwt({ email_verified: verified }), idExp: Date.now() + 3600e3 }) });
/* the 22d page code (after SHARE-CORE) up to the favourites file */
function friendsPage() {
  const s = APP(), a = s.indexOf('/* ==SHARE-CORE-END== */'), b = s.indexOf('FAVOURITE PLACES (V4.7)');
  assert.ok(a > 0 && b > a, 'the friends page code was not found');
  return s.slice(a, s.lastIndexOf('/* ====', b));
}
/* the real account + friends + sharing code and the Friends page code, against a fake page and a network that says OK */
function pageWorld(store = {}, o = {}) {
  const boxes = { '.fr-share-box': [{ innerHTML: '' }], '.fr-list-box': [{ innerHTML: '' }], '.acc-box': [{ innerHTML: '' }] };
  const timers = { set: 0, cleared: [] }, calls = { load: 0, poll: 0 };
  const noop = () => {};
  const ctx = {
    FIREBASE: { apiKey: 'AIzaTESTTESTTESTTESTTESTTESTTEST', projectId: 'turkmaps-test' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    atob: s => Buffer.from(s, 'base64').toString('binary'), TextDecoder, decodeURIComponent, encodeURIComponent, Date, Math, JSON, Promise,
    t: k => k, svgEsc: esc, attrEsc: attr, showToast: noop, IS_MOBILE: !!o.mobile, mSheets: o.mSheets || {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    navigator: {}, location: { hash: '', origin: 'http://x.test', pathname: '/', search: '' }, history: { replaceState: noop },
    setTimeout: () => 0, setInterval: () => ++timers.set, clearInterval: id => timers.cleared.push(id),
    document: { querySelectorAll: sel => boxes[sel] || [], querySelector: () => null, getElementById: () => null, addEventListener: noop,
      documentElement: { style: { setProperty: noop } }, body: { classList: { add: noop, remove: noop, contains: () => false } } },
  };
  ctx.lsJSON = k => { try { return JSON.parse(ctx.localStorage.getItem(k)); } catch (e) { return null; } };
  vm.createContext(ctx);
  vm.runInContext(['ACCOUNT-PURE', 'ACCOUNT-CORE', 'FRIENDS-PURE', 'FRIENDS-CORE', 'SHARE-PURE', 'SHARE-CORE'].map(region).join('\n')
    + '\nfunction renderAccount(){ document.querySelectorAll(".acc-box").forEach(b => { b.innerHTML = accViewHTML(); }); }\n'
    + friendsPage()
    + '\nthis.api = { get friendPoll(){ return friendPoll; }, setFriends(v){ friends = v; }, renderFriends, startFriendPolling, accSignOut,'
    + ' get renderShare(){ return typeof renderShare === "function" ? renderShare : null; }, get renderFriendList(){ return typeof renderFriendList === "function" ? renderFriendList : null; } };', ctx);
  return { api: ctx.api, boxes, timers, ctx, share: () => boxes['.fr-share-box'][0].innerHTML, list: () => boxes['.fr-list-box'][0].innerHTML };
}
test('friends tab: signed out it shows the sign-in line and no account form', () => {
  const w = pageWorld();
  w.api.renderFriends();
  assert.match(w.share(), /shareSignIn/, 'no sign-in line');
  assert.match(w.share(), /data-prof-open/, 'the sign-in line does not open the profile');
  assert.doesNotMatch(w.share(), /acc-form|accEmail/, 'the account form is in the Friends tab');
  assert.strictEqual(w.list(), '', 'a signed-out person sees a friends list');
});
test('friends tab: signed in it shows Share my location and who is sharing now, not the friends list or Add friend', () => {
  const w = pageWorld(SESSION(true));
  w.api.setFriends([{ uid: 'uidB', name: 'Bora', sharing: true, pos: { lat: 41.01, lng: 28.97, at: Date.now() - 120e3, approx: true } },
    { uid: 'uidC', name: '<i>Cem</i>', sharing: false, pos: null }]);
  w.api.renderFriends();
  const s = w.share();
  assert.match(s, /data-sh="start"/, 'no Share my location');
  assert.doesNotMatch(s, /data-fr="invite"|frFriends/, 'the friends list or Add friend is still in the Friends tab');
  assert.match(s, /shareNowTitle/, 'no "sharing now" list');
  assert.match(s, /data-fr-fly="uidB"[^>]*>[\s\S]*Bora/, 'a sharing friend is not listed to fly to');
  assert.doesNotMatch(s, /uidC/, 'a friend who is not sharing is listed as sharing');
  assert.match(w.list(), /data-fr="invite"/, 'Add friend is not in the profile list');
  assert.ok(w.list().includes('&lt;i&gt;Cem'), 'the profile list does not escape names');
  w.api.setFriends([]); w.api.renderFriends();
  assert.match(w.share(), /shareNoneNow/, 'no hint when nobody is sharing');
});
test('friends tab: the card holds no account box', () => {
  const h = H.html(), a = h.indexOf('id="cardFriends"'), b = h.indexOf('id="cardLayers"');
  assert.ok(a > 0 && b > a);
  const card = h.slice(a, b);
  assert.doesNotMatch(card, /acc-box/, 'the account box is still in the Friends card');
  assert.match(card, /<div class="fr-share-box"><\/div>\s*<div class="fav-box"><\/div>/, 'the Friends card is not sharing + favourites');
});
test('friends tab: signing out empties the friends list and stops reading positions', async () => {
  const w = pageWorld(SESSION(true));
  w.api.startFriendPolling();
  const id = w.api.friendPoll;
  assert.ok(id, 'polling did not start');
  w.api.setFriends([{ uid: 'uidB', name: 'Bora', pos: { lat: 41, lng: 29, at: Date.now() } }]);
  w.api.renderFriends();
  assert.match(w.list(), /Bora/);
  await w.api.accSignOut();
  assert.strictEqual(w.api.friendPoll, null, 'positions are still read after signing out');
  assert.ok(w.timers.cleared.includes(id), 'the 20 s timer was not stopped');
  assert.strictEqual(w.list(), '', 'the friends list still shows after signing out');
  assert.match(w.share(), /shareSignIn/);
});

/* ---------------------------------------------------------------- profile ---- */
const CSS = () => H.appStyle().replace(/\r\n/g, '\n');
function profileWorld(o = {}) {
  const cls = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => { if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); return s.has(c); }, s }; };
  const el = id => ({ id, textContent: '', innerHTML: '', attrs: {}, classList: cls(), setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; } });
  const els = { profileBtn: el('profileBtn'), profilePanel: el('profilePanel'), profileOverlay: el('profileOverlay') };
  const calls = { load: 0, poll: 0, sheet: [], acc: 0, list: 0 };
  const ctx = {
    acct: o.acct || null, IS_MOBILE: !!o.mobile, mSheets: o.mobile ? { profile: el('sheet_profile') } : {}, t: k => k, svgEsc: esc, attrEsc: attr,
    accReady: () => !!(o.acct && o.acct.verified), renderAccount: () => { calls.acc++; }, renderFriendList: () => { calls.list++; },
    loadFriends: async () => { calls.load++; }, startFriendPolling: () => { calls.poll++; }, openSheet: n => calls.sheet.push(n),
    document: { getElementById: id => els[id] || null }, onAccountChange: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(region('PROFILE-CORE') + '\nthis.api = { openProfile, closeProfile, profileVisible, renderProfileBtn, profileOpened };', ctx);
  return { api: ctx.api, els, calls, ctx };
}
test('profile: the button is in the top bar with an accessible name, and shows the initial when signed in', () => {
  const h = H.html(), tb = h.slice(h.indexOf('<div class="topbar glass">'), h.indexOf('<!-- first-visit welcome'));
  assert.match(tb, /<button id="profileBtn"[^>]*aria-label="Profile"[^>]*data-i18n-aria="profile"/, 'no profile button with a name in the top bar');
  assert.ok(tb.indexOf('id="profileBtn"') < tb.indexOf('id="settingsBtn"'), 'the profile button is not beside Settings');
  const w = profileWorld({ acct: { uid: 'u', name: 'ayşe', verified: true } });
  w.api.renderProfileBtn();
  assert.strictEqual(w.els.profileBtn.textContent, 'A');
  assert.ok(!w.els.profileBtn.classList.contains('unconfirmed'));
  assert.ok(/profile/.test(w.els.profileBtn.attrs['aria-label']) && /ayşe/.test(w.els.profileBtn.attrs['aria-label']), 'the button does not say whose profile');
  const out = profileWorld();
  out.api.renderProfileBtn();
  assert.match(out.els.profileBtn.innerHTML, /<svg/, 'signed out, the button shows no person outline');
});
test('profile: an unconfirmed account marks the button', () => {
  const w = profileWorld({ acct: { uid: 'u', name: 'Bora', verified: false } });
  w.api.renderProfileBtn();
  assert.ok(w.els.profileBtn.classList.contains('unconfirmed'), 'an unconfirmed account is not marked');
  assert.match(w.els.profileBtn.attrs['aria-label'], /profileUnconfirmed/, 'the mark is not said to a screen reader');
});
test('profile: the account box and friends list live only in the profile', () => {
  const h = H.html();
  assert.strictEqual((h.match(/class="acc-box"/g) || []).length, 1, 'the account box appears more than once');
  assert.match(h, /<div id="profileBody">[\s\S]*?<div class="acc-box"><\/div>\s*<div class="fr-list-box"><\/div>/, 'the account box and friends list are not in the profile');
  const you = h.slice(h.indexOf('data-sec="you"'), h.indexOf('id="placesGroup"'));
  assert.match(you, /data-prof-open[^>]*>[\s\S]*accAndFriends/, 'Settings > You has no way to the profile');
});
test('profile: opening it loads friends but does not read their positions', async () => {
  const w = profileWorld({ acct: { uid: 'u', name: 'Bora', verified: true } });
  w.api.openProfile(); await w.api.profileOpened();
  assert.ok(w.els.profilePanel.classList.contains('open') && w.els.profileOverlay.classList.contains('on'), 'the panel did not open');
  assert.ok(w.api.profileVisible());
  assert.ok(w.calls.load >= 1 && w.calls.acc >= 1 && w.calls.list >= 1, 'opening the profile did not load and show the friends list');
  assert.strictEqual(w.calls.poll, 0, 'opening the profile started reading friends\' positions');
  w.api.closeProfile();
  assert.ok(!w.api.profileVisible() && !w.els.profileOverlay.classList.contains('on'));
  const out = profileWorld();
  await out.api.profileOpened();
  assert.strictEqual(out.calls.load, 0, 'signed out, the profile asked the server for friends');
});
test('profile: on a phone it is a sheet of its own, not a bottom-bar button', () => {
  const s = APP();
  assert.match(s, /mSheets=\{ planner:mkSheet\('planner'\), friends:mkSheet\('friends'\), layers:mkSheet\('layers'\), alerts:mkSheet\('alerts'\), modes:mkSheet\('modes'\), profile:mkSheet\('profile'\) \};/);
  assert.match(s, /const items=\[ \['map','mMap'\], \['friends','mFriends'\], \['layers','mLayers'\], \['alerts','mAlerts'\] \];/, 'the bottom bar changed');
  assert.match(s, /mSheets\.profile\.appendChild\(document\.getElementById\('profileBody'\)\)/, 'the profile is not moved into its sheet');
  const os = /function openSheet\(name\)\{[\s\S]*?\n\}/.exec(s)[0];
  assert.match(os, /if\(name==='profile' && typeof profileOpened==='function'\) profileOpened\(\);/, 'opening the profile sheet does not load it');
  const w = profileWorld({ mobile: true });
  w.api.openProfile();
  assert.deepStrictEqual(plain(w.ctx.__sheets || w.calls.sheet), ['profile']);
});
test('profile: on a 320 px phone the search box keeps at least 150 px', () => {
  const c = CSS();
  assert.match(c, /body\.mobile \.omni\{[^}]*flex:1 1 calc\(100% - 44px\);[^}]*min-width:150px;/, 'the search box can shrink below 150 px or no longer leaves room for the button');
  assert.match(c, /body\.mobile #profileBtn\{[^}]*order:1;[^}]*flex:0 0 34px;/, 'the profile button does not sit beside the search box');
});
test('profile: Escape and Back close it, and it is a modal dialog for the keyboard', () => {
  const s = APP();
  assert.match(s, /\{ id:'profile', +open:\(\) => navHas\('profilePanel','open'\), +close:\(\) => closeProfile\(\) \}/, 'Back does not know the profile');
  assert.match(s, /\['stn','linp',[^\]]*'profilePanel'[^\]]*\]\.forEach/, 'the profile panel is not watched for Back');
  assert.match(s, /if\(open\('profilePanel', 'open'\)\)\{ closeProfile\(\); e\.preventDefault\(\); return; \}/, 'Escape does not close the profile');
  assert.match(s, /\{ id: 'profilePanel', +cls: 'open', modal: true, +first: '#profileX' \}/, 'the profile is not a modal dialog');
  const h = H.html();
  assert.match(h, /<div class="settings-panel glass profile-panel" id="profilePanel" role="dialog" aria-modal="true" aria-label="[^"]+" data-i18n-aria="profileTitle">/);
  assert.match(s, /\[data-prof-open\]/, 'nothing opens the profile from the Friends tab or Settings');
});
