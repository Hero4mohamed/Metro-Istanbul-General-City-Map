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
