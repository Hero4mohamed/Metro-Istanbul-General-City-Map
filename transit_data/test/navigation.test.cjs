/* How you get around the app on a phone (V4.2): the bottom bar and the back button.
 *
 * The bottom bar had five buttons, one of them Weather, which opened a sheet of its own although Weather is also one of the scopes
 * in the Layers sheet (Active / Vision / Buses / Intercity / Weather): two doors to one room, and a crowded bar. It is four buttons
 * now and Weather is reached from Layers.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

test('the phone has four bottom buttons - Map, Planner, Layers, Alerts - and no sheet of its own for the weather', () => {
  const s = H.appScript();
  const items = /const items=\[([^\n]*)\];/.exec(s);
  assert.ok(items, 'the list of bottom buttons is gone');
  const keys = [...items[1].matchAll(/\['(\w+)','[^']*','(\w+)'\]/g)].map(m => m[1]);
  assert.deepStrictEqual(keys, ['map', 'planner', 'layers', 'alerts'], 'the bottom bar is not Map / Planner / Layers / Alerts');
  assert.ok(/mSheets=\{ planner:mkSheet\('planner'\), layers:mkSheet\('layers'\), alerts:mkSheet\('alerts'\) \};/.test(s), 'the phone has a sheet that no button opens, or a button without a sheet');
  assert.ok(!/mkSheet\('weather'\)/.test(s) && !/mSheets\.weather/.test(s), 'the weather has its own sheet again');
  assert.ok(!/mWeather/.test(s), 'the dead "Weather" bottom-bar label is still in the language tables');
});

test('the weather card goes in the Layers sheet with the tab strip that selects it, and the layers card steps aside on every screen', () => {
  const s = H.appScript(), html = H.html();
  // the sheet-filling loop sends planner and alerts where they belong and everything else (tabs, layers, buses, intercity, weather) to Layers
  assert.ok(/if\(el\.id==='cardPlanner'\) mSheets\.planner\.appendChild\(el\);\s*else mSheets\.layers\.appendChild\(el\);/.test(s), 'a card is sent to a sheet that no longer exists');
  assert.ok(/<button data-tab="weather" role="tab"/.test(html), 'the Weather scope is gone from the tab strip');
  assert.ok(/\n  document\.getElementById\('cardLayers'\)\.style\.display = \(t==='weather'\) \? 'none' : '';/.test(s), 'on a phone the layers card sits above the weather again');
});
