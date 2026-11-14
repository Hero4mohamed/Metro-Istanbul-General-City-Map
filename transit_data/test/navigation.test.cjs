/* How you get around the app on a phone (V4.2): the bottom bar and the back button.
 *
 * The bottom bar had five buttons, one of them Weather, which opened a sheet of its own although Weather is also one of the scopes
 * in the Layers sheet (Active / Vision / Buses / Intercity / Weather): two doors to one room, and a crowded bar. It is four buttons
 * now and Weather is reached from Layers.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

test('the phone has three bottom buttons - Map, Layers, Alerts - the planner opens from the search bar, and the weather has no sheet', () => {
  const s = H.appScript();
  const items = /const items=\[([^\n]*)\];/.exec(s);
  assert.ok(items, 'the list of bottom buttons is gone');
  const keys = [...items[1].matchAll(/\['(\w+)','(\w+)'\]/g)].map(m => m[1]);
  assert.deepStrictEqual(keys, ['map', 'layers', 'alerts'], 'the bottom bar is not Map / Layers / Alerts (V4.6.2: the planner moved to the search bar)');
  assert.ok(/<button class="omni-plan" id="omniPlan" type="button"/.test(H.html()) && /getElementById\('omniPlan'\); if\(b\) b\.addEventListener\('click', plannerFromSearch\)/.test(s), 'nothing opens the planner any more');
  /* V4.5: a fourth sheet, the kinds of transport (Metro & rail / Buses / Boats), which the MAP button opens when pressed on the default map */
  assert.ok(/mSheets=\{ planner:mkSheet\('planner'\), layers:mkSheet\('layers'\), alerts:mkSheet\('alerts'\), modes:mkSheet\('modes'\) \};/.test(s), 'the phone has a sheet that no button opens, or a button without a sheet');
  assert.ok(/if\(k==='map'\)\{ mapButton\(\); return; \}/.test(s) && /if\(mapIsDefault\(\)\)\{ openSheet\('modes'\); return; \}/.test(s), 'nothing opens the kinds-of-transport sheet');
  assert.ok(!/mkSheet\('weather'\)/.test(s) && !/mSheets\.weather/.test(s), 'the weather has its own sheet again');
  assert.ok(!/mWeather/.test(s), 'the dead "Weather" bottom-bar label is still in the language tables');
});

test('the weather card goes in the Layers sheet with the tab strip that selects it, and the layers card steps aside on every screen', () => {
  const s = H.appScript(), html = H.html();
  // the sheet-filling loop sends planner and alerts where they belong and everything else (tabs, layers, buses, intercity, weather) to Layers
  assert.ok(/if\(el\.id==='cardPlanner'\) mSheets\.planner\.appendChild\(el\);\s*else if\(el\.id==='cardBus' \|\| el\.id==='cardBoats'\) mSheets\.modes\.appendChild\(el\);\s*else mSheets\.layers\.appendChild\(el\);/.test(s), 'a card is sent to a sheet that no longer exists');
  assert.ok(/<button data-tab="weather" role="tab"/.test(html), 'the Weather scope is gone from the tab strip');
  assert.ok(/\n  document\.getElementById\('cardLayers'\)\.style\.display = \(t==='weather' \|\| t==='airport'\) \? 'none' : '';/.test(s), 'on a phone the layers card sits above the weather again');
});
