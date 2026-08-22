/* The shared scope, kept honest.
 *
 * transit_data/src/*.js are concatenated into ONE scope, so every top-level name is visible to
 * every file. The audit called that out as the standing risk. Rather than pay for full ES-module
 * isolation to prevent a class of bug that has never occurred here, the risk is made impossible
 * to ship: a collision fails the build the moment it is introduced.
 *
 * The second check keeps the door open. Conversion to real modules is feasible only while the
 * EVALUATION-TIME dependency graph stays acyclic — cycles through function bodies are fine,
 * because the binding resolves when the function is called, but a cycle at load time throws on
 * a temporal dead zone. That property is cheap to preserve and expensive to recover.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

function analyse() {
  const out = execFileSync(process.execPath,
    [path.join(H.DATA, 'testkit', 'analyse-scope.cjs'), '--json'],
    { encoding: 'utf8', cwd: H.ROOT });
  return JSON.parse(out);
}

test('no two source files declare the same top-level name', () => {
  const r = analyse();
  const clashes = r.collisions.map(c => c.name + ' (' + c.files.join(' + ') + ')');
  assert.deepStrictEqual(clashes, [],
    'top-level name declared twice — one silently wins at concatenation: ' + clashes.join('; '));
});

test('the evaluation-time dependency graph stays acyclic', () => {
  const r = analyse();
  const cycles = (r.evalCycles || []).map(c => c.join(' <-> '));
  assert.deepStrictEqual(cycles, [],
    'a load-time cycle appeared, which both risks order-dependent bugs today and blocks a ' +
    'future move to ES modules: ' + cycles.join(' | '));
});
