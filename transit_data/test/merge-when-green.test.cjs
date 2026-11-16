'use strict';
/* "Merge when green" (16 Nov 2026). GitHub's own auto-merge cannot work on this repository: it only waits for REQUIRED checks, and
 * requiring the tests on main would block the six scheduled data jobs that push to main as GitHub's bot (a personal repository
 * cannot exempt that bot from a rule: GitHub refused it). So a small job does the merge itself, and this file pins what makes it
 * safe: it acts only after the Tests run on a pull request finished GREEN, only on a pull request the owner labelled, only from this
 * repository (not a fork), only on the exact commit that was tested, with a merge commit, and it never runs the pull request's code. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const FILE = path.join(H.ROOT, '.github', 'workflows', 'merge-when-green.yml');
const yml = () => { assert.ok(fs.existsSync(FILE), 'there is no merge-when-green job'); return fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'); };
const runScript = y => (y.match(/run: \|\n([\s\S]*?)(?=\n\S|\n {6}- |$)/g) || []).join('\n');

test('merge when green: it starts only when the Tests run on a pull request has finished, and acts only on success', () => {
  const y = yml();
  assert.match(y, /on:\n {2}workflow_run:\n {4}workflows: \["Tests"\]\n {4}types: \[completed\]/, 'it is not started by the end of a Tests run');
  assert.match(y, /github\.event\.workflow_run\.event == 'pull_request'/, 'a Tests run on main or by hand could trigger a merge');
  assert.match(y, /github\.event\.workflow_run\.conclusion == 'success'/, 'it merges after failed or cancelled tests');
  const tests = fs.readFileSync(path.join(H.ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
  assert.match(tests, /^name: Tests$/m, 'the Tests workflow was renamed: this job would never start');
});
test('merge when green: only a labelled pull request from this repository, only on the exact commit that was tested, with a merge commit', () => {
  const s = runScript(yml());
  assert.match(s, /--label "merge when green"/, 'it merges pull requests the owner did not mark');
  assert.match(s, /isCrossRepository == false/, 'a pull request from a fork with the same branch name could be merged');
  assert.match(s, /headRefOid == \$HEAD_SHA/, 'it does not check that the pull request still points at the tested commit');
  assert.match(s, /gh pr merge "\$pr" --repo "\$REPO" --merge --match-head-commit "\$HEAD_SHA"/, 'not a merge commit on the tested commit');
  assert.doesNotMatch(s, /--squash|--rebase|--admin/, 'it squashes, rebases or overrides the checks');
});
test('merge when green: it never runs the pull request\'s code, and nothing from the event is pasted into the script', () => {
  const y = yml();
  assert.doesNotMatch(y, /actions\/checkout|pull_request_target/, 'it checks out (and could run) the pull request\'s code with a write token');
  assert.doesNotMatch(runScript(y), /\$\{\{/, 'event data is pasted into the script (a crafted branch name could run commands); pass it through env');
  assert.match(y, /^permissions:\n {2}contents: write\n {2}pull-requests: write\n {2}actions: write\n/m, 'the token can do more (or less) than merge and start the deploy');
});
test('merge when green: the site is deployed after its merge (a merge by the job\'s token starts no other job by itself)', () => {
  assert.match(runScript(yml()), /gh workflow run pages\.yml --repo "\$REPO" --ref main/, 'the merged change would not reach the live site');
  assert.match(fs.readFileSync(path.join(H.ROOT, '.github', 'workflows', 'pages.yml'), 'utf8'), /workflow_dispatch:/, 'the deploy cannot be started by the job');
});
