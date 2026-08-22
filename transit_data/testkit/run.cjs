/* Discover and run the suite.
 *
 * Not `node --test <glob>`: glob support in the test runner landed after Node 20, and Node 20
 * is what CI installs, so the glob reached it as a literal path and the job failed while the
 * same command passed locally on Node 22. Not `node --test <dir>` either: the runner treats
 * EVERY file under a directory named `test` as a test, which is why the helpers and the
 * mutation checker were being executed as tests.
 *
 * Enumerating the files here works identically on every Node 20+ and needs no maintenance
 * when a suite is added.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.resolve(__dirname, '..', 'test');
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.cjs'))
  .sort()
  .map(f => path.join(dir, f));

if (!files.length) {
  console.error('No *.test.cjs files found in ' + dir);
  process.exit(1);
}

const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status === null ? 1 : res.status);
