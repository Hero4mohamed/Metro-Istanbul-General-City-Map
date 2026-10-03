/* The Trip Planner card folds the way the Layers card does: its title is the button.
 *
 * Two things can go wrong, and both are silent. The markup can stop matching (a header that points
 * at a body that is not there folds nothing, and the person sees a dead arrow). And the fold can
 * swallow the answer: a station's "route from here", a dropped pin, the assistant and "use my
 * location" all put things INTO the card and a route renders inside it, so a folded card would
 * hide a result that was just asked for. Anything that sets an endpoint or runs a route has to
 * open the card first.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

test('the planner title is a button wired to a body that exists and can fold', () => {
  const html = H.html();
  const head = /<button[^>]*id="plannerHead"[^>]*>/.exec(html);
  assert.ok(head, 'the planner title is not a button');
  assert.ok(/aria-expanded="true"/.test(head[0]), 'the planner starts open');
  const target = /aria-controls="([^"]+)"/.exec(head[0]);
  assert.ok(target && html.indexOf('id="' + target[1] + '"') > 0, 'aria-controls points at nothing');
  assert.strictEqual(target[1], 'plannerBody');
  // the body must contain the controls it hides, and must NOT contain the title that opens it
  const bodyStart = html.indexOf('id="plannerBody"'), tabs = html.indexOf('id="plannerTabs"');
  assert.ok(bodyStart > 0 && tabs > bodyStart, 'the planner tabs are not inside the foldable body');
  assert.ok(html.indexOf('id="plannerHead"') < bodyStart, 'the title must sit outside the body it folds');
  assert.ok(/\.plan-body\.folded\{display:none;\}/.test(H.appStyle()), 'a folded planner body is not hidden');
  assert.ok(/\.plan-head\[aria-expanded="false"\]::after\{transform:rotate\(-90deg\);\}/.test(H.appStyle()), 'the arrow does not turn when folded');
});

test('the planner remembers its own fold, apart from the Layers card', () => {
  const s = H.appScript();
  assert.ok(/wireFold\("layersHead","layersBody","irn_layers"\)/.test(s), 'the Layers fold is no longer wired');
  assert.ok(/wireFold\("plannerHead","plannerBody","irn_planner"\)/.test(s), 'the planner fold is not wired, or shares the Layers key');
});

test('putting something into a folded planner opens it', () => {
  const s = H.appScript();
  assert.ok(/function openPlannerCard\(\)/.test(s), 'openPlannerCard is gone');
  assert.ok(/function setPoint\(which, pt\)\{\s*if\(pt\) openPlannerCard\(\)/.test(s), 'setting an endpoint no longer opens the planner');
  assert.ok(/function runRoute\(\)\{\s*openPlannerCard\(\)/.test(s), 'running a route no longer opens the planner, so the answer would render out of sight');
  assert.ok(/skip-link\[href="#cardPlanner"\]/.test(s), 'the "skip to trip planner" link does not open a folded planner');
});
