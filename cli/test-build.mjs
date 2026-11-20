// `yad build start|step|trust|ship|done` (issue #346): one command per Build record. The spine test drives
// a story from its first lane to `shipped` through the real CLI, then asks the EXISTING readers — `yad next`,
// the epic seal, `yad doctor`, `yad tidy` — whether they agree it shipped: the user's decision was that
// `build done` makes the three "shipped" signals agree.
import './fixtures/git-quiet.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const YAD = path.join(ROOT, 'bin/yad.mjs');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^GIT_(AUTHOR|COMMITTER)_/.test(k) && !/^(CI|GITLAB_CI|GITHUB_ACTIONS|SDLC_BASE|SDLC_HUB_CONFIG|SDLC_PRODUCT_CONFIG)$/.test(k) && !/^(CI_|GITHUB_)/.test(k)));
ENV.GIT_CONFIG_GLOBAL = '/dev/null';
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: ENV }).toString().trim();
const yad = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [YAD, ...args], { cwd, env: { ...ENV, PWD: cwd, YAD_NO_REPORT: '1', YAD_NO_UPDATE_CHECK: '1' }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
};
const json = (r) => JSON.parse(r.stdout);

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'alice');
  git(dir, 'config', 'user.email', 'alice@corp.io');
}

// A Product (W/product) with one epic whose stories review passed, one story declaring api and web, and the
// api repo (W/api) on its origin with the story's tasks.md merged. No platform: ships are recorded by flag.
function workspace({ tasks = '# Tasks\n\n- [ ] T01 — create the order\n- [ ] T02 — list orders\n', spec = null, merged = ['T01', 'T02'] } = {}) {
  const W = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-build-')));
  fs.writeFileSync(path.join(W, '.yad-workspace.json'), JSON.stringify({ version: 1, product: 'product' }));
  const P = path.join(W, 'product');
  const dir = path.join(P, 'epics/EP-l');
  const st = (id, type, status) => ({ id, type, artifact: id.startsWith('stories') ? 'stories/' : 'epic.md', status, risk_tags: [] });
  write(P, {
    '.sdlc/product.json': JSON.stringify({ name: 'p' }),
    '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'web', path: '../web' }] }),
    'epics/EP-l/epic.md': '---\nid: EP-l\ntype: chore\nstatus: approved\n---\n# EP-l\n',
    'epics/EP-l/.sdlc/state.json': JSON.stringify({
      epicId: 'EP-l', profile: 'chore', currentStep: 'ready-for-build',
      steps: [st('epic', 'author', 'done'), st('epic-review', 'review+approve', 'done'), st('stories', 'author', 'done'), st('stories-review', 'review+approve', 'done')],
    }),
    'epics/EP-l/.sdlc/approvals.json': '[]',
    'epics/EP-l/.sdlc/comments.json': '[]',
    'epics/EP-l/stories/EP-l-S01.md': '---\nid: EP-l-S01\nepic: EP-l\nstatus: approved\nrepos: [api, web]\n---\n# S01\n',
  });
  initRepo(P);
  git(P, 'add', '-A');
  git(P, 'commit', '-q', '-m', 'chore: seed');
  const api = path.join(W, 'api');
  initRepo(api);
  // `spec` replaces the tasks.md with other spec files (a light spec, #348).
  write(api, { ...(spec || { [`specs/EP-l-S01/tasks.md`]: tasks }), 'a.txt': 'a\n' });
  git(api, 'add', '-A');
  git(api, 'commit', '-q', '-m', 'docs: tasks');
  git(W, 'init', '-q', '--bare', '-b', 'main', 'api.git');
  git(api, 'remote', 'add', 'origin', path.join(W, 'api.git'));
  git(api, 'push', '-q', '-u', 'origin', 'main');
  git(api, 'remote', 'set-head', 'origin', 'main');
  // A merged commit per task, each naming its task with a Task: trailer, on origin/main.
  const sha = {};
  for (const t of merged) {
    write(api, { [`src/${t}.js`]: `${t}\n` });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', `feat: ${t}\n\nTask: EP-l-S01-${t}`);
    sha[t] = git(api, 'rev-parse', 'HEAD');
  }
  git(api, 'push', '-q', 'origin', 'main');
  return { W, P, dir, api, sha };
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const status = (dir) => (fs.readFileSync(path.join(dir, 'stories/EP-l-S01.md'), 'utf8').match(/^status:\s*(\S+)/m) || [])[1];

test('yad build: start → step → trust → ship → done, and every reader agrees the story shipped (#346)', () => {
  const { W, P, dir, sha } = workspace();
  try {
    let r = yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /EP-l-S01 \/ api lane started at spec/);
    const file = path.join(dir, '.sdlc/build-state/EP-l-S01.json');
    const lane = read(file).repos.api;
    assert.deepEqual(lane.steps.map((s) => s.id), ['spec', 'tasks', 'implement', 'checks', 'engineer-review']);
    assert.ok(lane.steps.every((s) => s.status === 'todo' && s.advance === 'human' && s.automation === 'human_approve'));
    assert.equal(lane.steps.find((s) => s.id === 'engineer-review').locked, true);
    // The web lane is set aside: the story needs no change there.
    r = yad(P, 'skip', 'EP-l', 'EP-l-S01', '--repo', 'web', '--reason', 'no UI change');
    assert.equal(r.code, 0, r.out);

    for (const step of ['spec', 'tasks', 'implement', 'checks']) {
      const signal = { spec: 'human_edited_spec=false', tasks: 'task_rescoped=false', implement: 'scope_overrun=false', checks: 'checks=pass' }[step];
      r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', step, '--verdict', 'approved-unchanged', '--signal', signal, '--json');
      assert.equal(r.code, 0, r.out);
      const { uid } = json(r);
      assert.match(uid, /^[0-9a-f]{8}$/);
      r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', step, 'done', '--run', uid);
      assert.equal(r.code, 0, r.out);
    }
    const closed = read(file).repos.api.steps.find((s) => s.id === 'checks').closed;
    assert.deepEqual([closed.via, typeof closed.run], ['human', 'string']);
    assert.equal(read(file).repos.api.currentStep, 'engineer-review');

    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01, '--approver', 'bob');
    assert.equal(r.code, 0, r.out);
    assert.equal(status(dir), 'in-build', 'a first ship puts an approved story in Build');
    // Not every task shipped: refused, naming what is missing.
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no ship yet for: api\/T02/);
    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T02', '--repo', 'api', '--merge-commit', sha.T02);
    assert.equal(r.code, 0, r.out);
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /EP-l-S01 is shipped — engineer-review closed in 1 lane/);
    assert.match(r.out, /EP-l is now sealed: every story shipped/);

    // The three signals agree.
    assert.equal(status(dir), 'shipped');
    assert.ok(read(file).repos.api.steps.every((s) => s.status === 'done'));
    const ships = fs.readdirSync(path.join(dir, '.sdlc/build-log')).sort();
    assert.deepEqual(ships, ['EP-l-S01-T01-api.json', 'EP-l-S01-T02-api.json']);
    const ship = read(path.join(dir, '.sdlc/build-log/EP-l-S01-T01-api.json'));
    assert.deepEqual([ship.story, ship.task, ship.repo, ship.mergeCommit, ship.engineer_review[0].approver], ['EP-l-S01', 'T01', 'api', sha.T01, 'bob']);
    assert.equal(fs.readdirSync(path.join(dir, '.sdlc/trust-log')).length, 4);

    // And every reader says so.
    r = yad(P, 'next', 'EP-l', '--json');
    assert.equal(r.code, 0, r.out);
    const flat = JSON.stringify(json(r));
    assert.match(flat, /Build — every story\/repo lane is shipped or skipped/, flat.slice(0, 600));
    assert.match(flat, /"repo":"api"[^}]*"shipped":true|"shipped":true[^}]*"repo":"api"/, flat.slice(0, 600));
    // What yad checkpoint would commit: the Build ledgers and the story's status line, nothing else.
    r = yad(P, 'checkpoint', '--dry-run', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).files.sort(), [
      'epics/EP-l/.sdlc/build-log/EP-l-S01-T01-api.json', 'epics/EP-l/.sdlc/build-log/EP-l-S01-T02-api.json',
      'epics/EP-l/.sdlc/build-state/EP-l-S01.json', ...fs.readdirSync(path.join(dir, '.sdlc/trust-log')).map((n) => `epics/EP-l/.sdlc/trust-log/${n}`),
      'epics/EP-l/stories/EP-l-S01.md',
    ].sort());
    r = yad(P, 'doctor', '--json');
    const lanesWarn = JSON.stringify(json(r)).match(/lane:[^"]*|step:no-record[^"]*/g) || [];
    assert.deepEqual(lanesWarn, [], 'doctor finds nothing wrong with the lanes');
    r = yad(P, 'tidy', 'up', '--dry-run');
    assert.match(r.out, /EP-l: would fold 4 trust \+ 2 build shard\(s\)/, 'tidy sees a shipped story to fold');
    // Done twice changes nothing.
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 0, r.out);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build step: the lane is walked in order; a halt needs a reason; the review step closes with done', () => {
  const { W, P, dir } = workspace();
  try {
    let r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'in_progress');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /EP-l-S01 has no lane in api yet/);
    assert.match(r.out, /yad build start EP-l-S01 --repo api/);
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /EP-l-S01 \/ api is at spec, not implement/);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'blocked');
    assert.match(r.out, /a halt needs a reason/);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'blocked', '--reason', 'the contract is unclear');
    assert.equal(r.code, 0, r.out);
    const spec = read(path.join(dir, '.sdlc/build-state/EP-l-S01.json')).repos.api.steps[0];
    assert.deepEqual([spec.status, spec.record.reason], ['blocked', 'the contract is unclear']);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'engineer-review', 'done');
    assert.match(r.out, /engineer-review is closed by `yad build done EP-l-S01`/);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'done', '--run', 'deadbeef');
    assert.match(r.out, /no trust run deadbeef for EP-l-S01 \/ api \/ spec/);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'done');
    assert.equal(r.code, 0, r.out);
    const after = read(path.join(dir, '.sdlc/build-state/EP-l-S01.json')).repos.api;
    assert.equal(after.currentStep, 'tasks');
    assert.equal('record' in after.steps[0], false, 'closing a halted step drops the halt record');
    r = yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'nope');
    assert.match(r.out, /EP-l-S01 does not declare nope/);
    r = yad(P, 'build', 'start', 'EP-l-S9', '--repo', 'api');
    assert.match(r.out, /no story EP-l-S9/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build trust: signals are checked per step, and --uid finalizes the verdict', () => {
  const { W, P, dir } = workspace();
  try {
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    let r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'implement', '--verdict', 'great');
    assert.match(r.out, /'great' is not a verdict/);
    r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'implement', '--verdict', 'rejected', '--signal', 'checks=pass');
    assert.match(r.out, /'checks' is not a implement signal/);
    r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'engineer-review', '--verdict', 'rejected');
    assert.match(r.out, /'engineer-review' has no trust entry/);
    r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'implement', '--verdict', 'approved-unchanged', '--signal', 'human_edited_diff=false', '--ran-by', 'machine', '--json');
    assert.equal(r.code, 0, r.out);
    const { uid } = json(r);
    const shard = path.join(dir, `.sdlc/trust-log/EP-l-S01-api-implement-${uid}.json`);
    const entry = read(shard);
    assert.deepEqual([entry.verdict, entry.ranBy, entry.signals.human_edited_diff, entry.advance, entry.automation], ['approved-unchanged', 'machine', false, 'human', 'human_approve']);
    r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'implement', '--uid', uid, '--verdict', 'approved-with-edits');
    assert.equal(r.code, 0, r.out);
    assert.equal(read(shard).verdict, 'approved-with-edits');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build ship: reads the merged PR, refuses an unmerged one or another task\'s branch', async () => {
  const { buildShip } = await import('./build.mjs');
  const { W, P, dir, sha } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    const view = (over = {}) => ({
      state: 'MERGED', mergedAt: '2026-10-18T10:00:00Z', mergeCommit: { oid: sha.T01 }, headRefName: 'feat/EP-l-S01-T01-orders',
      url: 'https://github.com/o/api/pull/7', body: '## Summary\nx\n\nRisk level: medium\n<!-- yad:trailer -->\n',
      statusCheckRollup: [{ name: 'spec-link', conclusion: 'SUCCESS' }, { name: 'build-test-lint', conclusion: 'SUCCESS' }, { name: 'flaky', conclusion: 'FAILURE' }], ...over,
    });
    let answer = view();
    const runner = (cmd, args) => (cmd === 'gh' && args[0] === 'pr' ? { ok: true, stdout: JSON.stringify(answer), stderr: '' } : { ok: false, stdout: '', stderr: 'x' });
    const prReader = () => ({ ok: true, reviews: [{ login: 'bob', state: 'APPROVED', body: '' }], headOid: null });
    const r = await buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', pr: '7', today: '2026-10-19', runner, prReader });
    assert.equal(r.changed, true);
    const ship = read(path.join(dir, '.sdlc/build-log/EP-l-S01-T01-api.json'));
    assert.deepEqual(
      [ship.branch, ship.pr, ship.mergeCommit, ship.gates, ship.risk, ship.companion.trailer, ship.shippedAt, ship.engineer_review],
      ['feat/EP-l-S01-T01-orders', 'https://github.com/o/api/pull/7', sha.T01, ['build-test-lint', 'spec-link'], 'medium', true, '2026-10-18', [{ approver: 'bob', engagement: 'none' }]],
    );
    answer = view({ state: 'OPEN', headRefName: 'feat/EP-l-S01-T02-x' });
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T02', repo: 'api', pr: '8', today: '2026-10-19', runner, prReader }), /PR #8 in api is not merged/);
    answer = view({ headRefName: 'feat/EP-l-S01-T03-x' });
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T02', repo: 'api', pr: '9', today: '2026-10-19', runner, prReader }), /feat\/EP-l-S01-T03-x, which names another task than EP-l-S01-T02/);
    answer = view();
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', pr: '7', today: '2026-10-19', runner, prReader }), /already has a ship in api/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('parseTaskIds and planDone: task lines in their usual forms; a retro ship covers its repo; an unreadable repo refuses', async () => {
  const { parseTaskIds, planDone } = await import('./build.mjs');
  assert.deepEqual(parseTaskIds('# Tasks\n- [ ] T01 a\n- [x] **T02** b\n### T03 — c\n4. T04 d\nT05: e\nsee T09 in text\n- T01 again\n'), ['T01', 'T02', 'T03', 'T04', 'T05']);
  const ships = [{ story: 'S', repo: 'api', task: 'T01' }, { story: 'S', repo: 'web', task: 'retro', retroactive: true }];
  assert.deepEqual(planDone({ story: 'S', declared: ['api', 'web'], owed: { api: ['T01'], web: null }, ships }), { missing: [], unreadable: [], shipped: true });
  assert.deepEqual(planDone({ story: 'S', declared: ['api', 'ops'], owed: { api: ['T01', 'T02'], ops: null }, ships }).missing, ['api/T02']);
  assert.deepEqual(planDone({ story: 'S', declared: ['api', 'ops'], owed: { api: ['T01'], ops: null }, ships }).unreadable, ['ops']);
  assert.equal(planDone({ story: 'S', declared: ['api', 'ops'], skipped: ['ops'], owed: { api: ['T01'] }, ships }).shipped, true);
});

test('yad build done: a repo the story owes with no lane is refused, so yad next and the status never disagree', () => {
  const { W, P, dir, sha } = workspace({ tasks: '- T01 one\n' });
  try {
    // Shipped by hand in api, with no lane: done would set shipped while yad next still reads it in Build.
    let r = yad(P, 'skip', 'EP-l', 'EP-l-S01', '--repo', 'web', '--reason', 'no UI change');
    assert.equal(r.code, 0, r.out);
    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01);
    assert.equal(r.code, 0, r.out);
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /EP-l-S01 has no lane in api, so `yad next` would still read it in Build/);
    assert.match(r.out, /yad checkpoint --retro-ship/);
    assert.notEqual((fs.readFileSync(path.join(dir, 'stories/EP-l-S01.md'), 'utf8').match(/^status:\s*(\S+)/m) || [])[1], 'shipped');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

// Drive api's lane through its four author steps (no trust runs: the closing record names none).
function walk(P) {
  for (const step of ['spec', 'tasks', 'implement', 'checks']) yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', step, 'done');
}
const story = (dir) => path.join(dir, 'stories/EP-l-S01.md');
const setStory = (dir, fm, name = 'EP-l-S01.md') => {
  fs.rmSync(story(dir), { force: true });
  fs.writeFileSync(path.join(dir, 'stories', name), `---\n${fm}\n---\n# S01\n`);
};

test('yad build done: the status line moves from any Shape value, and a value it cannot place is refused before anything is written (#346 review 1)', () => {
  const { W, P, dir, sha } = workspace({ tasks: '- T01 one\n' });
  try {
    // A file named other than its id is refused: yad tidy and the seal read a story by its file name.
    setStory(dir, 'id: EP-l-S01\nepic: EP-l\nstatus: draft\nrepos: [api, web]', 'EP-l-S01-checkout.md');
    let r = yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    assert.match(r.out, /EP-l-S01 is in stories\/EP-l-S01-checkout\.md, not stories\/EP-l-S01\.md/);
    fs.rmSync(path.join(dir, 'stories/EP-l-S01-checkout.md'));
    // A story nobody ran sync-status on still says draft, here quoted with a comment.
    setStory(dir, 'id: EP-l-S01\nepic: EP-l\nstatus: "draft" # authored\nrepos: [api, web]');
    yad(P, 'skip', 'EP-l', 'EP-l-S01', '--repo', 'web', '--reason', 'no UI change');
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    walk(P);
    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01);
    assert.equal(r.code, 0, r.out);
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 0, r.out);
    assert.match(fs.readFileSync(story(dir), 'utf8'), /^status: shipped$/m);
    assert.match(r.out, /EP-l is now sealed/);

    // A value no Build write can move on: refused, the lanes untouched.
    const file = path.join(dir, '.sdlc/build-state/EP-l-S01.json');
    const lanesBefore = fs.readFileSync(file, 'utf8');
    setStory(dir, 'id: EP-l-S01\nepic: EP-l\nstatus: ready-for-build\nrepos: [api, web]');
    const bs = JSON.parse(lanesBefore);
    bs.repos.api.steps.find((s) => s.id === 'engineer-review').status = 'todo';
    fs.writeFileSync(file, JSON.stringify(bs));
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has status: ready-for-build, which a Build write cannot move on/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).repos.api.steps.find((s) => s.id === 'engineer-review').status, 'todo');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build done: no repo owed, a stray lane, a blocked review step, a failed fetch — each refused (#346 review 1)', () => {
  const { W, P, dir, api, sha } = workspace({ tasks: '- T01 one\n' });
  try {
    setStory(dir, 'id: EP-l-S01\nepic: EP-l\nstatus: approved\nrepos: []');
    let r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.match(r.out, /owes no lane in any repo/);
    setStory(dir, 'id: EP-l-S01\nepic: EP-l\nstatus: approved\nrepos: [api]');
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    walk(P);
    yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01);
    const file = path.join(dir, '.sdlc/build-state/EP-l-S01.json');
    const bs = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...bs, repos: { ...bs.repos, Api: { currentStep: 'spec', steps: [{ id: 'spec', status: 'todo' }] } } }));
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.match(r.out, /has a lane the story does not declare: Api/);
    fs.writeFileSync(file, JSON.stringify(bs));
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'engineer-review', 'blocked', '--reason', 'waiting on a fix');
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.match(r.out, /engineer-review is blocked in api/);
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'engineer-review', 'in_progress');
    git(api, 'remote', 'set-url', 'origin', path.join(W, 'gone.git'));
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.match(r.out, /could not fetch main in api to read the tasks it owes/);
    r = yad(P, 'build', 'done', 'EP-l-S01', '--no-fetch');
    assert.equal(r.code, 0, r.out);
    const review = JSON.parse(fs.readFileSync(file, 'utf8')).repos.api.steps.find((s) => s.id === 'engineer-review');
    assert.equal(review.status, 'done');
    assert.equal('record' in review, false, 'no halt record left on a closed step');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build ship: a repo not checked out is never read through the Product; --pr is a number; the stories review must have passed; the branch match ignores case and prefixes (#346 review 1)', async () => {
  const { buildShip } = await import('./build.mjs');
  const { W, P, dir, sha } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../nowhere', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    let r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--pr', '7');
    assert.match(r.out, /api is not checked out here, so its PR cannot be read/);
    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--pr', 'https://x/pull/7', '--merge-commit', 'a'.repeat(40));
    assert.match(r.out, /--pr must be the PR\/MR number/);
    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', 'not-a-sha');
    assert.match(r.out, /--merge-commit must be a commit SHA/);
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    const answer = { state: 'MERGED', mergedAt: '2026-10-18T10:00:00Z', mergeCommit: { oid: sha.T01 }, headRefName: 'amn/feat/ep-l-s01-t01-orders', url: 'u', body: '', statusCheckRollup: [] };
    const runner = (cmd, args) => (cmd === 'gh' && args[0] === 'pr' ? { ok: true, stdout: JSON.stringify(answer), stderr: '' } : { ok: false, stdout: '', stderr: 'x' });
    const res = await buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', pr: '7', today: '2026-10-19', runner, prReader: () => ({ ok: true, reviews: [] }) });
    assert.equal(res.changed, true, 'a lower-case branch under a folder still names the task');
    const st = JSON.parse(fs.readFileSync(path.join(dir, '.sdlc/state.json'), 'utf8'));
    st.steps.find((x) => x.id === 'stories-review').status = 'in_review';
    fs.writeFileSync(path.join(dir, '.sdlc/state.json'), JSON.stringify(st));
    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T02', '--repo', 'api', '--merge-commit', 'a'.repeat(40));
    assert.match(r.out, /the stories review has not passed/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build done: a shipped status written another way is rewritten; two status lines or two files are refused; the epic must be in Build (#346 review 2)', () => {
  const { W, P, dir, sha } = workspace({ tasks: '- T01 one\n' });
  try {
    yad(P, 'skip', 'EP-l', 'EP-l-S01', '--repo', 'web', '--reason', 'no UI change');
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    walk(P);
    yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01);
    setStory(dir, 'id: EP-l-S01\nepic: EP-l\nstatus: approved\nstatus: approved\nrepos: [api, web]');
    let r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.match(r.out, /which a Build write cannot move on/);
    fs.writeFileSync(path.join(dir, 'stories/EP-l-S01-copy.md'), '---\nid: EP-l-S01\nstatus: approved\n---\n');
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.match(r.out, /2 story files claim EP-l-S01/);
    fs.rmSync(path.join(dir, 'stories/EP-l-S01-copy.md'));
    setStory(dir, 'id: EP-l-S01\nepic: EP-l\nstatus: "shipped" # by hand\nrepos: [api, web]');
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 0, r.out);
    assert.match(fs.readFileSync(story(dir), 'utf8'), /^status: shipped$/m, 'rewritten as the seal and tidy read it');
    assert.match(r.out, /EP-l is now sealed/);
    // A reopened stories review takes the epic out of Build.
    const st = JSON.parse(fs.readFileSync(path.join(dir, '.sdlc/state.json'), 'utf8'));
    st.steps.find((x) => x.id === 'stories-review').status = 'in_review';
    st.currentStep = 'stories-review';
    fs.writeFileSync(path.join(dir, '.sdlc/state.json'), JSON.stringify(st));
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.match(r.out, /EP-l is not in Build/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('tasksInBranch: the task a branch names, under folders and in any case, never a slug after it (#346 review 3)', async () => {
  const { tasksInBranch } = await import('./build.mjs');
  assert.deepEqual(tasksInBranch('feat/EP-auth-S01-T02-2fa-setup'), ['ep-auth-s01-t02']);
  assert.deepEqual(tasksInBranch('amn/feat/ep-l-s01-t01-orders'), ['ep-l-s01-t01']);
  assert.deepEqual(tasksInBranch('feat/EP-x-S01-T01-then-S02-T03'), ['ep-x-s01-t01']);
  assert.deepEqual(tasksInBranch('feat/EP-l-S01-T012-x'), ['ep-l-s01-t012']);
  assert.deepEqual(tasksInBranch('EP-l-S01-T01'), ['ep-l-s01-t01']);
  assert.deepEqual(tasksInBranch('fix-typo'), []);
});

test('yad build done: a lane with no steps is half-seeded, not shipped; a clone is matched to its registered URL by path, never printed (#346 review 3)', () => {
  const { W, P, dir, api, sha } = workspace({ tasks: '- T01 one\n' });
  try {
    yad(P, 'skip', 'EP-l', 'EP-l-S01', '--repo', 'web', '--reason', 'no UI change');
    yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01);
    const file = path.join(dir, '.sdlc/build-state/EP-l-S01.json');
    const bs = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...bs, repos: { ...bs.repos, api: { currentStep: 'spec', steps: [] } } }));
    let r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.match(r.out, /EP-l-S01 has no lane in api/);
    // The registered URL with a port and a token, the clone over another remote form: one repo.
    git(api, 'remote', 'set-url', 'origin', path.join(W, 'api.git'));
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', git_url: 'ssh://git@host:2222/team/api.git' }, { name: 'web', path: '../web' }] }) });
    git(api, 'remote', 'set-url', 'origin', 'https://oauth2:SECRET@host/team/api/');
    r = yad(P, 'build', 'done', 'EP-l-S01', '--no-fetch');
    assert.doesNotMatch(r.out, /is a clone of/);
    git(api, 'remote', 'set-url', 'origin', 'https://oauth2:SECRET@host/team/other.git');
    r = yad(P, 'build', 'done', 'EP-l-S01', '--no-fetch');
    assert.match(r.out, /\.\.\/api is a clone of team\/other, not team\/api/);
    assert.doesNotMatch(r.out, /SECRET/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build ship: an epic slug that reads like a task still matches its own branch (#346 review 4)', async () => {
  const { tasksInBranch } = await import('./build.mjs');
  assert.deepEqual(tasksInBranch('feat/EP-aws-s3-t2-backup-S01-T01-x'), ['ep-aws-s3-t2'], 'the general scan alone would refuse it');
  // The exact id is matched first, so a branch whose slug after the task reads like another task passes too.
  const { W, P, sha } = workspace();
  try {
    const { buildShip } = await import('./build.mjs');
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    const answer = { state: 'MERGED', mergedAt: '2026-10-18T10:00:00Z', mergeCommit: { oid: sha.T01 }, headRefName: 'feat/EP-l-S01-T01-s3-t2-x', url: 'u', body: '', statusCheckRollup: [] };
    const runner = (cmd, args) => (cmd === 'gh' && args[0] === 'pr' ? { ok: true, stdout: JSON.stringify(answer), stderr: '' } : { ok: false, stdout: '', stderr: 'x' });
    const r = await buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', pr: '7', today: '2026-10-20', runner, prReader: () => ({ ok: true, reviews: [] }) });
    assert.equal(r.changed, true);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build done: a status write that fails puts the lanes back; another build-state file claiming the story is refused (#346 review 4)', { skip: (process.getuid && process.getuid() === 0) && 'root writes read-only files' }, () => {
  const { W, P, dir, sha } = workspace({ tasks: '- T01 one\n' });
  try {
    yad(P, 'skip', 'EP-l', 'EP-l-S01', '--repo', 'web', '--reason', 'no UI change');
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    walk(P);
    yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01);
    const file = path.join(dir, '.sdlc/build-state/EP-l-S01.json');
    fs.writeFileSync(path.join(dir, '.sdlc/build-state/copy.json'), JSON.stringify({ story: 'EP-l-S01', repos: {} }));
    let r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.match(r.out, /build-state\/copy\.json also says story: EP-l-S01/);
    fs.rmSync(path.join(dir, '.sdlc/build-state/copy.json'));
    const before = fs.readFileSync(file, 'utf8');
    // The story's folder, not the file, is made read-only: the status line is written through a new file and a
    // rename (#235), which a read-only file does not stop.
    fs.chmodSync(path.dirname(story(dir)), 0o555);
    try {
      r = yad(P, 'build', 'done', 'EP-l-S01');
      assert.notEqual(r.code, 0, r.out);
      assert.equal(fs.readFileSync(file, 'utf8'), before, 'the lanes are exactly as they were');
    } finally { fs.chmodSync(path.dirname(story(dir)), 0o755); }
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build step --task: the next task reopens implement and checks once the lane is at the review step; each close is kept (#346)', () => {
  const { W, P, dir } = workspace();
  try {
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    for (const step of ['spec', 'tasks']) yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', step, 'done');
    let r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'implement', '--verdict', 'approved-unchanged', '--task', 'T01', '--json');
    const t1 = json(r).uid;
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done', '--run', t1, '--task', 'T01');
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'in_progress', '--task', 'T02');
    assert.match(r.out, /once the lane is at engineer-review/, 'not before checks is done for T01');
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'checks', 'done', '--task', 'T01');
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'in_progress');
    assert.match(r.out, /implement is already done/, 'no --task, no reopen');
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'blocked', '--task', 'T02', '--reason', 'scope overrun: b.js');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /implement is blocked again, for T02/);
    const file = path.join(dir, '.sdlc/build-state/EP-l-S01.json');
    let lane = read(file).repos.api;
    const impl = lane.steps.find((s) => s.id === 'implement');
    assert.deepEqual([lane.currentStep, impl.status, impl.record.reason, impl.runs[0].task, impl.runs[0].run], ['implement', 'blocked', 'scope overrun: b.js', 'T01', t1]);
    assert.equal(lane.steps.find((s) => s.id === 'checks').status, 'todo', 'checks is owed again for T02');
    r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'implement', '--verdict', 'approved-with-edits', '--task', 'T02', '--json');
    const t2 = json(r).uid;
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done', '--run', t2, '--task', 'T02');
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'checks', 'done', '--task', 'T02');
    lane = read(file).repos.api;
    assert.equal(lane.currentStep, 'engineer-review');
    assert.deepEqual(lane.steps.find((s) => s.id === 'implement').closed, { by: 'alice', date: lane.steps.find((s) => s.id === 'implement').closed.date, via: 'human', run: t2, task: 'T02' });
    assert.equal(read(path.join(dir, `.sdlc/trust-log/EP-l-S01-api-implement-${t2}.json`)).task, 'T02');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build ship: a task merged with no PR is recorded from its commit on the default branch (#346)', async () => {
  const { buildShip } = await import('./build.mjs');
  const { W, P, dir, api } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    write(api, { 'src/x.js': 'x\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'feat: x\n\nTask: EP-l-S01-T01');
    const sha = git(api, 'rev-parse', 'HEAD');
    const runner = (cmd, args) => (cmd === 'gh' && args[0] === 'api' ? { ok: true, stdout: '[]', stderr: '' } : { ok: false, stdout: '', stderr: 'no PR is read' });
    // Not pushed yet: not on the default branch.
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', mergeCommit: sha, today: '2026-10-20', runner }), /is not on api's main/);
    git(api, 'push', '-q', 'origin', 'main');
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T02', repo: 'api', mergeCommit: sha, today: '2026-10-20', runner }), /names EP-l-S01-T01, not EP-l-S01-T02/);
    const r = await buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', mergeCommit: sha.slice(0, 12), today: '2026-10-20', runner });
    assert.equal(r.changed, true);
    const ship = read(path.join(dir, '.sdlc/build-log/EP-l-S01-T01-api.json'));
    assert.deepEqual([ship.pr, ship.mergeCommit, ship.engineer_review], ['none', sha, []]);
    // Hand-given approvers are still refused where the platform can be read.
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T02', repo: 'api', mergeCommit: sha, approvers: ['bob'], today: '2026-10-20', runner }), /the ship is read from PR/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build ship with no PR, where the platform can be read: the commit names the task, and the platform says no PR merged it (#346 review 7)', async () => {
  const { buildShip } = await import('./build.mjs');
  const { W, P, dir, api } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    const commit = (msg) => {
      write(api, { [`src/${Math.random().toString(36).slice(2)}.js`]: 'x\n' });
      git(api, 'add', '-A');
      git(api, 'commit', '-q', '-m', msg);
      git(api, 'push', '-q', 'origin', 'main');
      return git(api, 'rev-parse', 'HEAD');
    };
    let pulls = '[]';
    let fails = false;
    const runner = (cmd, args) => (cmd === 'gh' && args[0] === 'api' && /\/pulls$/.test(args[1])
      ? (fails ? { ok: false, stdout: '', stderr: 'HTTP 401' } : { ok: true, stdout: pulls, stderr: '' })
      : { ok: false, stdout: '', stderr: 'x' });
    const ship = (task, sha) => buildShip(P, { story: 'EP-l-S01', task, repo: 'api', mergeCommit: sha, today: '2026-10-20', runner });
    await assert.rejects(() => ship('T1', commit('feat: ten\n\nTask: EP-l-S01-T10')), /names EP-l-S01-T10, not EP-l-S01-T1/);
    await assert.rejects(() => ship('T03', commit('Revert "feat: three EP-l-S01-T03"')), /does not name EP-l-S01-T03/);
    await assert.rejects(() => ship('T03', commit('docs: notes\n\nfollow-up to EP-l-S01-T03')), /does not name EP-l-S01-T03/);
    // The platform says a PR merged it: refused, naming that PR so its approvers are kept.
    const squashed = commit('feat: EP-l-S01-T03 orders (#5)');
    pulls = JSON.stringify([{ number: 5, merged_at: '2026-10-19T10:00:00Z' }]);
    await assert.rejects(() => ship('T03', squashed), /merged by PR\/MR #5/);
    // The platform cannot answer: refused, never a guess.
    fails = true;
    await assert.rejects(() => ship('T03', squashed), /could not ask github whether a PR\/MR merged/);
    // "(#346)" cites an issue and the platform knows no PR: recorded with no PR.
    fails = false;
    pulls = '[]';
    const r = await ship('T04', commit('feat: EP-l-S01-T04 orders (#346)'));
    assert.equal(r.changed, true);
    assert.equal(read(path.join(dir, '.sdlc/build-log/EP-l-S01-T04-api.json')).pr, 'none');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build ship by hand, where the platform cannot be read: the person vouches, but not for another task or another PR (#346 review 7)', () => {
  const { W, P, api } = workspace();
  try {
    const commit = (msg) => {
      write(api, { [`src/${Math.random().toString(36).slice(2)}.js`]: 'x\n' });
      git(api, 'add', '-A');
      git(api, 'commit', '-q', '-m', msg);
      git(api, 'push', '-q', 'origin', 'main');
      return git(api, 'rev-parse', 'HEAD');
    };
    let r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T03', '--repo', 'api', '--merge-commit', commit('feat: ten\n\nTask: EP-l-S01-T10'));
    assert.match(r.out, /names EP-l-S01-T10, not EP-l-S01-T03/);
    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T03', '--repo', 'api', '--pr', '7', '--merge-commit', commit('Merge pull request #9 from org/feat/x'), '--approver', 'bob');
    assert.match(r.out, /merged PR\/MR #9, not #7/);
    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T03', '--repo', 'api', '--pr', '5', '--merge-commit', commit('feat: list orders (#5)'), '--approver', 'bob');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /names no task — recorded as you say it ships EP-l-S01-T03/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build step: done --task for another task is refused; only implement reopens; closes without --run keep their history (#346 review 5)', () => {
  const { W, P, dir } = workspace();
  try {
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    for (const step of ['spec', 'tasks']) yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', step, 'done');
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done', '--task', 'T01');
    let r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done', '--task', 'T02');
    assert.match(r.out, /implement was closed for T01, not T02/);
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'checks', 'done');
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'checks', 'in_progress', '--task', 'T02');
    assert.match(r.out, /the next task reopens implement once the lane is at engineer-review/);
    // Walked by hand, with no --run: every task's close is kept.
    for (const t of ['T02', 'T03']) {
      yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'in_progress', '--task', t);
      r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done');
      assert.equal(r.code, 0, r.out);
      yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'checks', 'done');
    }
    const impl = read(path.join(dir, '.sdlc/build-state/EP-l-S01.json')).repos.api.steps.find((s) => s.id === 'implement');
    assert.deepEqual([impl.closed.task, ...impl.runs.map((x) => x.task)], ['T03', 'T01', 'T02'], 'the task defaults to the one the step was reopened for');
    // A close with no task is not "already done" for T04, and a run already used for a close is not reused.
    r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'implement', '--verdict', 'approved-unchanged', '--json');
    const used = json(r).uid;
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'in_progress', '--task', 'T04');
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done', '--run', used);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done', '--task', 'T09');
    assert.match(r.out, /implement was closed for T04, not T09/);
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'checks', 'done');
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'in_progress', '--task', 'T05');
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done', '--run', used);
    assert.match(r.out, new RegExp(`trust run ${used} already closed implement`));
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('prOfCommit: certain for a GitHub or GitLab merge, only a maybe for a squash (#346 review 6)', async () => {
  const { prOfCommit } = await import('./ship-drift.mjs');
  assert.deepEqual(prOfCommit('Merge pull request #42 from org/feat/x'), { pr: 42, certain: true });
  assert.deepEqual(prOfCommit("Merge branch 'feat/x' into 'main'", 'See merge request team/api!12'), { pr: 12, certain: true });
  assert.deepEqual(prOfCommit('feat: orders (#17)'), { pr: 17, certain: false });
  assert.deepEqual(prOfCommit('feat: orders #17 later'), { pr: null, certain: false });
});

test('yad build step: the same close sent again is "already done", and no second trust run is asked for (#346 review 7)', () => {
  const { W, P, dir } = workspace();
  try {
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    const r0 = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'spec', '--verdict', 'approved-unchanged', '--json');
    const uid = json(r0).uid;
    let r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'done', '--run', uid);
    assert.equal(r.code, 0, r.out);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'done', '--run', uid);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /spec is already done in EP-l-S01 \/ api — nothing changed/);
    assert.equal(fs.readdirSync(path.join(dir, '.sdlc/trust-log')).length, 1);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'done', '--task', 'T01');
    assert.match(r.out, /--task does not apply to spec/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build: the PR path checks what merged; a by-hand ship keeps the commit date; --via auto obeys the kill switch and a rejected run (#346 final review)', async () => {
  const { buildShip } = await import('./build.mjs');
  const { W, P, api, sha } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    // Merged into another branch: not on main.
    git(api, 'checkout', '-q', '-b', 'release/1.x');
    write(api, { 'src/rel.js': 'x\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'feat: release fix\n\nTask: EP-l-S01-T01');
    const off = git(api, 'rev-parse', 'HEAD');
    git(api, 'push', '-q', 'origin', 'release/1.x');
    git(api, 'checkout', '-q', 'main');
    let mergeOid = off;
    let branch = 'feat/EP-l-S01-T01-x';
    const runner = (cmd, args) => (cmd === 'gh' && args[0] === 'pr'
      ? { ok: true, stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-10-18T10:00:00Z', mergeCommit: { oid: mergeOid }, headRefName: branch, url: 'u', body: '', statusCheckRollup: [] }), stderr: '' }
      : { ok: false, stdout: '', stderr: 'x' });
    const prReader = () => ({ ok: true, reviews: [] });
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', pr: '7', today: '2026-10-20', runner, prReader }), /is not on api's main/);
    // A branch naming no task, a merge commit naming another: refused.
    mergeOid = sha.T02;
    branch = 'hotfix-login';
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', pr: '8', today: '2026-10-20', runner, prReader }), /names EP-l-S01-T02, not EP-l-S01-T01/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build: a by-hand ship records the commit date; --via auto needs the dial in force and a run not rejected (#346 final review)', () => {
  const { W, P, dir, api, sha } = workspace();
  try {
    const when = git(api, 'log', '-1', '--format=%cs', sha.T01);
    let r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01, '--approver', 'bob');
    assert.equal(r.code, 0, r.out);
    assert.equal(read(path.join(dir, '.sdlc/build-log/EP-l-S01-T01-api.json')).shippedAt, when);
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    r = yad(P, 'dial', 'EP-l', 'EP-l-S01', '--repo', 'api', 'spec', '--to', 'auto');
    assert.equal(r.code, 0, r.out);
    r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'spec', '--verdict', 'rejected', '--json');
    const bad = json(r).uid;
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'done', '--via', 'auto');
    assert.match(r.out, /--via auto needs --run <uid>/);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'done', '--via', 'auto', '--run', bad);
    assert.match(r.out, /is rejected, so spec does not advance on its own/);
    r = yad(P, 'kill', '--reason', 'a bad week');
    assert.equal(r.code, 0, r.out);
    r = yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'spec', '--verdict', 'approved-unchanged', '--json');
    const good = json(r).uid;
    assert.equal(read(path.join(dir, `.sdlc/trust-log/EP-l-S01-api-spec-${good}.json`)).advance, 'human', 'the dial in force under the kill switch');
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'done', '--via', 'auto', '--run', good);
    assert.match(r.out, /the kill switch is on/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build merged: asks the platform about the task\'s PR, found by its branch; --ship records it once (#355)', async () => {
  const { buildMerged } = await import('./build.mjs');
  const { W, P, dir, sha } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    let list = [];
    const views = {};
    const asked = [];
    const runner = (cmd, args) => {
      asked.push(args.slice(0, 2).join(' '));
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: JSON.stringify(list), stderr: '' };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view' && views[args[2]]) return { ok: true, stdout: JSON.stringify(views[args[2]]), stderr: '' };
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const prReader = () => ({ ok: true, reviews: [{ login: 'bob', state: 'APPROVED', body: '' }], headOid: null });
    const ask = (over = {}) => buildMerged(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', today: '2026-10-20', runner, prReader, ...over });
    const view = (state, branch = 'feat/EP-l-S01-T01-orders', oid = sha.T01) => ({
      state, mergedAt: state === 'MERGED' ? '2026-10-19T10:00:00Z' : null, mergeCommit: state === 'MERGED' ? { oid } : null,
      headRefName: branch, url: 'https://github.com/o/api/pull/7', body: '', statusCheckRollup: [],
    });
    // No PR carries the task yet. Another task's PR and a branch with the id inside a longer one do not count.
    list = [{ number: 3, state: 'OPEN', headRefName: 'feat/EP-l-S01-T02-x', url: 'u3' }, { number: 4, state: 'OPEN', headRefName: 'feat/EP-l-S01-T012-x', url: 'u4' }];
    assert.equal((await ask()).state, 'none');
    // An open PR: not merged yet, and nothing written.
    list.push({ number: 7, state: 'OPEN', headRefName: 'feat/EP-l-S01-T01-orders', url: 'u7' });
    views['7'] = view('OPEN');
    let r = await ask({ ship: true });
    assert.deepEqual([r.state, r.pr, r.changed], ['open', 7, false]);
    assert.equal(fs.existsSync(path.join(dir, '.sdlc/build-log/EP-l-S01-T01-api.json')), false);
    // Two live PRs for the task: refused, naming both. A closed one alongside a live one does not count.
    list.push({ number: 8, state: 'OPEN', headRefName: 'fix/ep-l-s01-t01', url: 'u8' });
    await assert.rejects(() => ask(), /more than one PR\/MR carries EP-l-S01-T01: #7 \(open\), #8 \(open\)/);
    list[list.length - 1].state = 'CLOSED';
    // Merged: the merge commit is named; without --ship nothing is written.
    views['7'] = view('MERGED');
    r = await ask();
    assert.deepEqual([r.state, r.pr, r.mergeCommit, r.changed], ['merged', 7, sha.T01, false]);
    assert.equal(fs.existsSync(path.join(dir, '.sdlc/build-log/EP-l-S01-T01-api.json')), false);
    // --ship records it through `build ship`, with the PR's approvers.
    r = await ask({ ship: true });
    assert.deepEqual([r.state, r.changed, r.ship.engineer_review], ['merged', true, [{ approver: 'bob', engagement: 'none' }]]);
    assert.equal(read(path.join(dir, '.sdlc/build-log/EP-l-S01-T01-api.json')).mergeCommit, sha.T01);
    assert.equal(status(dir), 'in-build');
    // Asked again: already shipped, the same answer with or without --ship, and the platform is not asked.
    asked.length = 0;
    r = await ask({ ship: true });
    assert.deepEqual([r.state, r.changed, r.mergeCommit], ['shipped', false, sha.T01]);
    assert.deepEqual(asked, []);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build merged: closed, a cut-short list, a --pr for another task, and no platform to ask (#355)', async () => {
  const { buildMerged, findTaskPrs } = await import('./build.mjs');
  const { W, P } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'gitlab' }, { name: 'web', path: '../web' }] }) });
    let mrs = [];
    const mr = {};
    const runner = (cmd, args) => {
      if (cmd !== 'glab') return { ok: false, stdout: '', stderr: 'x' };
      if (args[1].startsWith('projects/:id/merge_requests?')) return { ok: true, stdout: JSON.stringify(mrs), stderr: '' };
      const n = (args[1].match(/merge_requests\/(\d+)$/) || [])[1];
      return n && mr[n] ? { ok: true, stdout: JSON.stringify(mr[n]), stderr: '' } : { ok: false, stdout: '', stderr: 'x' };
    };
    const ask = (over = {}) => buildMerged(P, { story: 'EP-l-S01', task: 'T02', repo: 'api', today: '2026-10-20', runner, ...over });
    // Only a closed MR: closed, naming it.
    mrs = [{ iid: 5, state: 'closed', source_branch: 'feat/EP-l-S01-T02-y', web_url: 'w5' }];
    assert.deepEqual([(await ask()).state, (await ask()).pr], ['closed', 5]);
    // A locked MR is mid-merge: still open.
    mr['6'] = { iid: 6, state: 'locked', source_branch: 'feat/EP-l-S01-T02-y', web_url: 'w6' };
    assert.equal((await ask({ pr: '6' })).state, 'open');
    // A full page with no match: none, and the answer says the list was cut short.
    mrs = Array.from({ length: 100 }, (_, i) => ({ iid: i + 10, state: 'merged', source_branch: `feat/x-${i}` }));
    const r = await ask();
    assert.deepEqual([r.state, r.partial], ['none', true]);
    assert.equal(findTaskPrs('gitlab', { story: 'EP-l-S01', task: 'T02' }, { runner }).partial, true);
    // --pr naming another task's MR: refused. A bad number: refused.
    mr['9'] = { iid: 9, state: 'merged', source_branch: 'feat/EP-l-S01-T01-x', merge_commit_sha: 'abc1234' };
    await assert.rejects(() => ask({ pr: '9' }), /feat\/EP-l-S01-T01-x, which names another task than EP-l-S01-T02/);
    await assert.rejects(() => ask({ pr: 'x9' }), /--pr must be the PR\/MR number/);
    // The listing fails: refused, never "none".
    await assert.rejects(() => ask({ runner: () => ({ ok: false, stdout: '', stderr: 'denied' }) }), /could not list the PRs\/MRs of api: denied/);
    // No platform recorded: refused with the by-hand way.
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'web', path: '../web' }] }) });
    fs.rmSync(path.join(W, 'api/.git/refs/remotes'), { recursive: true, force: true });
    execFileSync('git', ['remote', 'remove', 'origin'], { cwd: path.join(W, 'api') });
    await assert.rejects(() => ask(), /api has no platform to ask, so yad cannot see whether EP-l-S01-T02 merged/);
    // A story the repo is not declared for: the same refusal `build ship` gives.
    await assert.rejects(() => buildMerged(P, { story: 'EP-l-S01', task: 'T02', repo: 'ops', runner }), /does not declare ops/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build merged through the CLI: help names it, and --json carries the state (#355)', () => {
  const { W, P } = workspace();
  try {
    const h = yad(P, '--help');
    assert.match(h.out, /yad build merged <story> --task <T> --repo <r>/);
    const r = yad(P, 'build', 'merged', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--json');
    // api has an origin on disk but no platform: refused with the by-hand hint, as JSON.
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, /cannot see whether EP-l-S01-T01 merged/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build merged: a PR merged off the default branch, or naming another task, is refused, never "merged" (#355 review 1)', async () => {
  const { buildMerged } = await import('./build.mjs');
  const { W, P, api, sha } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    git(api, 'checkout', '-q', '-b', 'release/1.x');
    write(api, { 'src/rel.js': 'x\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'feat: release fix\n\nTask: EP-l-S01-T01');
    const off = git(api, 'rev-parse', 'HEAD');
    git(api, 'push', '-q', 'origin', 'release/1.x');
    git(api, 'checkout', '-q', 'main');
    let oid = off;
    const runner = (cmd, args) => (cmd === 'gh' && args[1] === 'view'
      ? { ok: true, stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-10-19T10:00:00Z', mergeCommit: oid ? { oid } : null, headRefName: 'feat/EP-l-S01-T01-x', url: 'u', body: '', statusCheckRollup: [] }), stderr: '' }
      : { ok: false, stdout: '', stderr: 'x' });
    const ask = () => buildMerged(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', pr: '7', today: '2026-10-20', runner });
    await assert.rejects(ask, /is not on api's main/);
    oid = sha.T02;
    await assert.rejects(ask, /names EP-l-S01-T02, not EP-l-S01-T01/);
    oid = null;
    await assert.rejects(ask, /merged, but the platform names no merge commit/);
    oid = sha.T01;
    assert.deepEqual([(await ask()).state, (await ask()).mergeCommit], ['merged', sha.T01]);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build merged: a ship build ship would not write (a file another repo\'s name shares) is refused, not "merged" (#355 review 3)', async () => {
  const { buildMerged } = await import('./build.mjs');
  const { W, P, dir, sha } = workspace();
  try {
    write(P, {
      '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }),
      // A shard under api's file name that the ledger cannot read: build ship would refuse to write over it.
      'epics/EP-l/.sdlc/build-log/EP-l-S01-T01-api.json': '{ not json',
    });
    const runner = (cmd, args) => (cmd === 'gh' && args[1] === 'view'
      ? { ok: true, stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-10-19T10:00:00Z', mergeCommit: { oid: sha.T01 }, headRefName: 'feat/EP-l-S01-T01-x', url: 'u', body: '', statusCheckRollup: [] }), stderr: '' }
      : { ok: false, stdout: '', stderr: 'x' });
    await assert.rejects(() => buildMerged(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', pr: '7', today: '2026-10-20', runner }), /api shares a ship file name/);
    assert.equal(fs.readFileSync(path.join(dir, '.sdlc/build-log/EP-l-S01-T01-api.json'), 'utf8'), '{ not json');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('planAutoOpen: the checks step passed now, and each task\'s newest close names it with a run that passed and was not rejected (#356, #350)', async () => {
  const { planAutoOpen } = await import('./build.mjs');
  const at = { story: 'EP-l-S01', repo: 'api' };
  const run = (uid, over = {}) => ({ uid, story: 'EP-l-S01', repo: 'api', step: 'checks', verdict: 'approved-unchanged', signals: { checks: 'pass' }, ...over });
  const lane = (checks, extra = {}) => ({ currentStep: 'engineer-review', steps: [{ id: 'implement', status: 'done' }, { id: 'checks', status: 'done', ...checks }], ...extra });
  const ask = (l, runs, task = 'T01') => planAutoOpen(l, runs, { ...at, task });
  // Not closed, or closed for another task only.
  assert.match(ask(lane({}), []).message, /checks is not closed/);
  assert.match(ask(lane({ closed: { run: 'a', task: 'T02' } }), [run('a', { task: 'T02' })]).message, /checks has not closed for T01/);
  // A close and a run naming no task count for no task: the next task's branch cannot ride on it.
  assert.match(ask(lane({ closed: { run: 'a' } }), [run('a')]).message, /has not closed for T01/);
  assert.match(ask(lane({ closed: { run: 'a' } }), [run('a')], 'T02').message, /has not closed for T02/);
  assert.equal(ask(lane({ closed: { run: 'a' } }), [run('a', { task: 'T01' })]).ok, true, 'the run names it');
  assert.match(ask(lane({ closed: { run: 'a', task: 'T01' } }), [run('a', { task: 'T02' })]).message, /run a, which is for T02/);
  // A close naming a run that is not recorded, a rejected run, a run without checks=pass.
  assert.match(ask(lane({ closed: { run: 'a', task: 'T01' } }), []).message, /trust run a, which is not recorded/);
  assert.match(ask(lane({ closed: { run: 'a', task: 'T01' } }), [run('a', { verdict: 'rejected' })]).message, /is rejected/);
  assert.match(ask(lane({ closed: { run: 'a', task: 'T01' } }), [run('a', { signals: { checks: 'fail' } })]).message, /did not record checks=pass/);
  assert.match(ask(lane({ closed: { run: 'a', task: 'T01' } }), [run('a', { signals: {} })]).message, /did not record checks=pass/);
  assert.equal(ask(lane({ closed: { run: 'a', task: 'T01' } }), [run('a')]).ok, true);
  // The step reopened and not closed again holds every task — for the next task, or this one again with
  // new work its old run never checked.
  assert.match(ask(lane({ status: 'todo', task: 'T02', runs: [{ run: 'a', task: 'T01' }] }), [run('a')]).message, /checks is not closed \(it is open for T02\)/);
  assert.match(ask(lane({ status: 'blocked', task: 'T01', runs: [{ run: 'a', task: 'T01' }] }), [run('a')]).message, /it is open for T01/);
  // Closed again: the NEWEST close for the task counts — an earlier pass never hides a later rejected run.
  const again = lane({ closed: { run: 'b', task: 'T01' }, runs: [{ run: 'a', task: 'T01' }] });
  assert.match(ask(again, [run('a'), run('b', { verdict: 'rejected' })]).message, /\(b\) is rejected/);
  assert.equal(ask(lane({ closed: { run: 'b', task: 'T01' }, runs: [{ run: 'a', task: 'T01' }] }), [run('a', { verdict: 'rejected' }), run('b')]).ok, true);
  // A group (#350): T01's close kept in `runs`, T02's current — both count while the step is passed now.
  const group = lane({ closed: { run: 'b', task: 'T02' }, runs: [{ run: 'a', task: 'T01' }] });
  const both = planAutoOpen(group, [run('a'), run('b')], { ...at, tasks: ['T01', 'T02'] });
  assert.deepEqual([both.ok, Object.keys(both.runs)], [true, ['T01', 'T02']]);
  assert.match(planAutoOpen(group, [run('a', { signals: { checks: 'fail' } }), run('b')], { ...at, tasks: ['T01', 'T02'] }).message, /checks run for T01 \(a\) did not record checks=pass/);
  assert.match(planAutoOpen(group, [run('a'), run('b')], { ...at, tasks: ['T01', 'T02', 'T03'] }).message, /checks has not closed for T03/);
  assert.match(planAutoOpen(lane({ status: 'todo', task: 'T03', runs: [{ run: 'a', task: 'T01' }, { run: 'b', task: 'T02' }] }), [run('a'), run('b')], { ...at, tasks: ['T01', 'T02'] }).message, /open for T03/);
  // Already opened by the dial: not a second time, for any task of the group.
  assert.match(ask(lane({ closed: { run: 'a', task: 'T01' } }, { opened: [{ task: 'T01', pr: 12 }] }), [run('a')]).message, /already opened by the dial: #12/);
  assert.match(planAutoOpen(group, [run('a'), run('b')], { ...at, tasks: ['T01', 'T02'] , }).ok && planAutoOpen({ ...group, opened: [{ task: 'T02', pr: 4 }] }, [run('a'), run('b')], { ...at, tasks: ['T01', 'T02'] }).message, /EP-l-S01-T02's PR\/MR was already opened by the dial: #4/);
  assert.match(ask(null, []).message, /has no lane/);
});

test('yad dial open-pr: a project-wide action dial every automation.json writer keeps; doctor names a bad value (#356)', async () => {
  const { automationChecks } = await import('./doctor.mjs');
  const { W, P } = workspace();
  try {
    const file = path.join(P, '.sdlc/automation.json');
    let r = yad(P, 'dial', 'open-pr', '--json');
    assert.deepEqual([json(r).scope, json(r).advance, json(r).why], ['action', 'human', 'project']);
    r = yad(P, 'dial', 'open-pr', '--to', 'auto');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(read(file).actions, { 'open-pr': 'auto' });
    // A Shape dial and the kill switch rewrite the file: the action dial survives each.
    yad(P, 'dial', 'architecture', '--to', 'auto');
    yad(P, 'kill', '--reason', 'bad deploy');
    r = yad(P, 'dial', 'open-pr', '--json');
    assert.deepEqual([json(r).set, json(r).advance, json(r).why], ['auto', 'human', 'kill']);
    yad(P, 'unkill');
    assert.deepEqual([read(file).actions, read(file).steps], [{ 'open-pr': 'auto' }, { architecture: 'auto' }]);
    assert.equal(json(yad(P, 'dial', 'open-pr', '--json')).advance, 'auto');
    // Set for the project, never per lane.
    r = yad(P, 'dial', 'EP-l', 'EP-l-S01', '--repo', 'api', 'open-pr', '--to', 'auto');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /open-pr is set for the whole project, not per lane/);
    // Back to human: the key is removed.
    yad(P, 'dial', 'open-pr', '--to', 'human');
    assert.equal(read(file).actions, undefined);
    // Doctor: an unknown value or action is named.
    fs.writeFileSync(file, JSON.stringify({ steps: {}, actions: { 'open-pr': 'yes', merge: 'auto' } }));
    const checks = [];
    automationChecks(checks, P);
    const unknown = checks.find((x) => x.id === 'automation:unknown');
    assert.match(unknown.message, /actions\.open-pr: "yes" is not human or auto/);
    assert.match(unknown.message, /actions\.merge: not an action this release knows/);
    assert.equal(json(yad(P, 'dial', 'open-pr', '--json')).advance, 'human', '"yes" is not auto');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad open-pr --via auto: opened on the standing approval only after this task\'s checks passed; refusals push nothing; recorded on the lane (#356)', async () => {
  const { runOpenPr } = await import('./openpr.mjs');
  const { buildMerged } = await import('./build.mjs');
  const { W, P, dir, api, sha } = workspace();
  const prev = process.exitCode;
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github', default_branch: 'main' }, { name: 'web', path: '../web' }] }) });
    git(P, 'add', '-A');
    git(P, 'commit', '-q', '-m', 'chore: register api on github');
    const branch = 'feat/EP-l-S01-T01-orders';
    git(api, 'checkout', '-q', '-b', branch);
    write(api, { 'src/orders.js': 'x\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'feat: orders\n\nTask: EP-l-S01-T01');
    const pushed = () => git(api, 'ls-remote', '--heads', 'origin', branch) !== '';
    let created = 0;
    const creator = () => { created += 1; return { ok: true, url: 'https://github.com/o/api/pull/12' }; };
    const runner = () => ({ ok: false, stdout: '', stderr: 'no platform here' });
    const open = (over = {}) => runOpenPr(api, { product: P, via: 'auto', creator, runner, today: '2026-10-20', ...over });
    // The dial is human: refused, nothing pushed.
    await assert.rejects(open, /the open-pr dial is human/);
    yad(P, 'dial', 'open-pr', '--to', 'auto');
    // No lane yet, then checks not closed for T01: refused, nothing pushed.
    await assert.rejects(open, /has no lane/);
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    for (const step of ['spec', 'tasks']) yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', step, 'done');
    const impl = json(yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'implement', '--verdict', 'approved-unchanged', '--task', 'T01', '--json')).uid;
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'done', '--run', impl, '--task', 'T01');
    await assert.rejects(open, /checks is not closed/);
    const checks = json(yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', 'checks', '--verdict', 'approved-unchanged', '--signal', 'checks=pass', '--task', 'T01', '--json')).uid;
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'checks', 'done', '--run', checks, '--task', 'T01');
    // The kill switch holds it.
    yad(P, 'kill', '--reason', 'freeze');
    await assert.rejects(open, /kill switch .* holds it at human/);
    yad(P, 'unkill');
    // A bad --via; a branch naming no task.
    await assert.rejects(() => open({ via: 'yes' }), /--via must be auto or human/);
    git(api, 'checkout', '-q', '-b', 'misc');
    await assert.rejects(open, /misc carries no task of this Product/);
    // A --task never names a task the branch does not carry (review 5).
    await assert.rejects(() => open({ task: 'EP-l-S01-T01' }), /misc carries no task of this Product/);
    git(api, 'checkout', '-q', branch);
    // A --task naming another task than the branch carries: refused, never believed (review 1).
    await assert.rejects(() => open({ task: 'EP-l-S01-T02' }), /--task EP-l-S01-T02 is not the task feat\/EP-l-S01-T01-orders carries/);
    // On the Product, a review branch is never opened with --via auto, and nothing is pushed (review 1).
    git(P, 'checkout', '-q', '-b', 'review/EP-l/epic');
    await assert.rejects(() => runOpenPr(P, { via: 'auto', platform: 'github', creator, runner }), /only a task PR\/MR in a code repo/);
    git(P, 'checkout', '-q', 'main');
    assert.equal(pushed(), false, 'no refusal pushed the branch');
    assert.equal(created, 0);
    // Opened: pushed, created once, and recorded on the lane with the run that earned it.
    const res = await open();
    assert.deepEqual([res.via, pushed(), created], ['auto', true, 1]);
    const lane = read(path.join(dir, '.sdlc/build-state/EP-l-S01.json')).repos.api;
    assert.deepEqual(lane.opened, [{ task: 'T01', pr: 12, url: 'https://github.com/o/api/pull/12', via: 'auto', run: checks, by: 'alice', date: '2026-10-20' }]);
    // Not a second time.
    await assert.rejects(open, /already opened by the dial: #12/);
    // The same task spelled in another case, or under more folders, is read as the same task (review 2).
    await assert.rejects(() => open({ task: 'ep-l-s01-t01' }), /already opened by the dial: #12/);
    git(api, 'checkout', '-q', '-b', 'amn/feat/ep-l-s01-t01-again');
    await assert.rejects(open, /already opened by the dial: #12/);
    git(api, 'checkout', '-q', branch);
    // Every reading of a branch name is tried; only a story of this Product counts (reviews 3 and 4).
    const { branchTasks } = await import('./build.mjs');
    write(P, { 'epics/EP-aws-s3-t2-backup/stories/EP-aws-s3-t2-backup-S01.md': '---\nid: EP-aws-s3-t2-backup-S01\n---\n', 'epics/EP-l/stories/EP-l-S02.md': '---\nid: EP-l-S02\n---\n' });
    const ids = (b) => branchTasks(P, b).map((x) => `${x.story}-${x.task}`);
    assert.deepEqual(ids('feat/EP-aws-s3-t2-backup-S01-T01'), ['EP-aws-s3-t2-backup-S01-T01'], 'a slug that reads like a task');
    assert.deepEqual(ids('feat/EP-l-S01-T01-then-S02-T03'), ['EP-l-S01-T01'], 'words after the task');
    assert.deepEqual(ids('feat/EP-l-S01-T01-add-s3-t2-support'), ['EP-l-S01-T01']);
    assert.deepEqual(ids('amn/feat/ep-l-s01-t01-again'), ['EP-l-S01-T01'], 'any case, any folders');
    assert.deepEqual(ids('feat/EP-l-S01-T01_EP-l-S02-T02'), ['EP-l-S01-T01', 'EP-l-S02-T02'], 'two real tasks');
    assert.deepEqual(ids('feat/EP-zz-S01-T01'), [], 'not a story here');
    git(api, 'checkout', '-q', '-b', 'feat/EP-l-S01-T01_EP-l-S02-T02');
    await assert.rejects(open, /carries more than one task: EP-l-S01-T01, EP-l-S02-T02/);
    await assert.rejects(() => open({ task: 'EP-l-S01-T01' }), /carries more than one task/);
    git(api, 'checkout', '-q', '-b', 'feat/EP-l-S01-T01-then-S02-T03');
    await assert.rejects(open, /already opened by the dial: #12/, 'read as EP-l-S01-T01');
    await assert.rejects(() => open({ task: 'EP-l-S02-T03' }), /is not the task feat\/EP-l-S01-T01-then-S02-T03 carries/);
    git(api, 'checkout', '-q', branch);
    // `yad build merged` reads the recorded number: no search is needed (the listing would fail here).
    const view = (cmd, args) => (cmd === 'gh' && args[1] === 'view' && args[2] === '12'
      ? { ok: true, stdout: JSON.stringify({ state: 'OPEN', headRefName: branch, url: 'u12', body: '', statusCheckRollup: [] }), stderr: '' }
      : { ok: false, stdout: '', stderr: 'x' });
    const m = await buildMerged(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', today: '2026-10-20', runner: view });
    assert.deepEqual([m.state, m.pr], ['open', 12]);
    // The recorded PR closed without a merge, and a person opened #15: the search finds it (review 1).
    const after = (cmd, args) => {
      if (cmd === 'gh' && args[1] === 'view' && args[2] === '12') return { ok: true, stdout: JSON.stringify({ state: 'CLOSED', headRefName: branch, url: 'u12', body: '', statusCheckRollup: [] }), stderr: '' };
      if (cmd === 'gh' && args[1] === 'view' && args[2] === '15') return { ok: true, stdout: JSON.stringify({ state: 'OPEN', headRefName: `${branch}-2`, url: 'u15', body: '', statusCheckRollup: [] }), stderr: '' };
      if (cmd === 'gh' && args[1] === 'list') return { ok: true, stdout: JSON.stringify([{ number: 15, state: 'OPEN', headRefName: `${branch}-2`, url: 'u15' }, { number: 12, state: 'CLOSED', headRefName: branch, url: 'u12' }]), stderr: '' };
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const m2 = await buildMerged(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', today: '2026-10-20', runner: after });
    assert.deepEqual([m2.state, m2.pr], ['open', 15]);
    // A human open is today's open: no dial asked, nothing recorded.
    git(api, 'checkout', '-q', '-b', 'feat/EP-l-S01-T02-list');
    const h = await runOpenPr(api, { product: P, creator, runner });
    assert.equal(h.via, 'human');
    assert.equal(read(path.join(dir, '.sdlc/build-state/EP-l-S01.json')).repos.api.opened.length, 1);
    void sha;
  } finally { process.exitCode = prev; fs.rmSync(W, { recursive: true, force: true }); }
});

test('follow-ups: a fix/<story>-<task>-followup branch never competes with the task\'s PR, and its merge is added to the ship (#350)', async () => {
  const { buildShip, buildMerged, isFollowUpBranch } = await import('./build.mjs');
  const { W, P, dir, api, sha } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    assert.equal(isFollowUpBranch('fix/EP-l-S01-T01-followup-null-check', 'EP-l-S01', 'T01'), true);
    assert.equal(isFollowUpBranch('amn/fix/ep-l-s01-t01-followup', 'EP-l-S01', 'T01'), true);
    assert.equal(isFollowUpBranch('feat/EP-l-S01-T01-orders', 'EP-l-S01', 'T01'), false);
    assert.equal(isFollowUpBranch('fix/EP-l-S01-T012-followup', 'EP-l-S01', 'T01'), false);
    // A follow-up commit on main, naming the task.
    write(api, { 'src/T01-fix.js': 'fix\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'fix: null check\n\nTask: EP-l-S01-T01');
    const fu = git(api, 'rev-parse', 'HEAD');
    git(api, 'push', '-q', 'origin', 'main');
    const views = {
      7: { state: 'MERGED', mergedAt: '2026-10-18T10:00:00Z', mergeCommit: { oid: sha.T01 }, headRefName: 'feat/EP-l-S01-T01-orders', url: 'https://github.com/o/api/pull/7', body: '', statusCheckRollup: [] },
    };
    const followUpPr = { state: 'OPEN', mergedAt: null, mergeCommit: null, headRefName: 'fix/EP-l-S01-T01-followup-null', url: 'https://github.com/o/api/pull/9', body: '', statusCheckRollup: [] };
    const runner = (cmd, args) => {
      if (cmd === 'gh' && args[1] === 'list') return { ok: true, stdout: JSON.stringify(Object.entries(views).map(([n, v]) => ({ number: Number(n), state: v.state, headRefName: v.headRefName, url: v.url })).reverse()), stderr: '' };
      if (cmd === 'gh' && args[1] === 'view' && views[args[2]]) return { ok: true, stdout: JSON.stringify(views[args[2]]), stderr: '' };
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const prReader = () => ({ ok: true, reviews: [] });
    const base = { story: 'EP-l-S01', task: 'T01', repo: 'api', today: '2026-10-20', runner, prReader };
    // Before the ship, an open follow-up does not compete with the task's own merged PR, by search or by number;
    // and it is never recorded as the task's ship (review 2).
    views[9] = followUpPr;
    let r = await buildMerged(P, base);
    assert.deepEqual([r.state, r.pr], ['merged', 7]);
    await assert.rejects(() => buildMerged(P, { ...base, pr: '9' }), /a follow-up branch, while EP-l-S01-T01's own PR\/MR is another/);
    views[9] = { ...followUpPr, state: 'MERGED', mergeCommit: { oid: sha.T02 } };
    await assert.rejects(() => buildShip(P, { ...base, pr: '9' }), /a follow-up branch of EP-l-S01-T01/);
    // A follow-up-named PR recorded by the dial is held to the same rule (review 4).
    const bsFile = path.join(dir, '.sdlc/build-state/EP-l-S01.json');
    fs.mkdirSync(path.dirname(bsFile), { recursive: true });
    fs.writeFileSync(bsFile, JSON.stringify({ story: 'EP-l-S01', repos: { api: { currentStep: 'engineer-review', steps: [], opened: [{ task: 'T01', pr: 9, via: 'auto' }] } } }));
    await assert.rejects(() => buildMerged(P, base), /a follow-up branch, while EP-l-S01-T01's own PR\/MR is another/);
    fs.rmSync(bsFile);
    delete views[9];
    await assert.rejects(() => buildMerged(P, { ...base, followUp: true }), /has no ship in api yet, so it has no follow-up/);
    await assert.rejects(() => buildShip(P, { ...base, pr: '9', followUp: true }), /has no ship in api yet/);
    r = await buildMerged(P, { ...base, ship: true });
    assert.equal(r.changed, true);
    // Once shipped, the task's own question is answered `shipped`, follow-up or not; the dial opens no follow-up.
    views[9] = followUpPr;
    assert.equal((await buildMerged(P, base)).state, 'shipped');
    yad(P, 'dial', 'open-pr', '--to', 'auto');
    const { autoOpenCheck } = await import('./build.mjs');
    assert.throws(() => autoOpenCheck(P, { story: 'EP-l-S01', task: 'T01', repo: 'api' }), /EP-l-S01-T01 has already shipped in api/);
    // A follow-up PR is never the task's own ship, nor asked about as one.
    views[9] = { ...views[9], state: 'MERGED', mergedAt: '2026-10-20T09:00:00Z', mergeCommit: { oid: fu } };
    await assert.rejects(() => buildShip(P, { ...base, pr: '9' }), /PR #9 is from fix\/EP-l-S01-T01-followup-null, a follow-up branch of EP-l-S01-T01/);
    // As a follow-up: found by its branch, merged, and added to the ship with --ship.
    views[9] = { ...views[9], state: 'OPEN', mergeCommit: null };
    assert.deepEqual([(await buildMerged(P, { ...base, followUp: true })).state, (await buildMerged(P, { ...base, followUp: true })).pr], ['open', 9]);
    views[9] = { ...views[9], state: 'MERGED', mergeCommit: { oid: fu } };
    r = await buildMerged(P, { ...base, followUp: true });
    assert.deepEqual([r.state, r.pr, r.mergeCommit, r.changed], ['merged', 9, fu, false]);
    r = await buildMerged(P, { ...base, followUp: true, ship: true });
    assert.deepEqual([r.state, r.changed, r.entry], ['merged', true, { pr: 'https://github.com/o/api/pull/9', branch: 'fix/EP-l-S01-T01-followup-null', mergeCommit: fu, date: '2026-10-20' }]);
    const shipFile = path.join(dir, '.sdlc/build-log/EP-l-S01-T01-api.json');
    assert.deepEqual([read(shipFile).mergeCommit, read(shipFile).followUps.length], [sha.T01, 1]);
    assert.equal(status(dir), 'in-build', 'the status is left as it is');
    // Asked again: recorded, so no follow-up is left to find; by number it is `shipped`; a second record is refused.
    assert.equal((await buildMerged(P, { ...base, followUp: true })).state, 'none');
    // An older follow-up closed without a merge owes nothing: still `none`, not `closed` (review 1).
    views[8] = { ...followUpPr, state: 'CLOSED', headRefName: 'fix/EP-l-S01-T01-followup-old', url: 'u8' };
    assert.equal((await buildMerged(P, { ...base, followUp: true })).state, 'none');
    delete views[8];
    assert.equal((await buildMerged(P, { ...base, followUp: true, pr: '9' })).state, 'shipped');
    await assert.rejects(() => buildShip(P, { ...base, pr: '9', followUp: true }), /a follow-up of EP-l-S01 \/ T01 already records/);
    await assert.rejects(() => buildShip(P, { ...base, pr: '7', followUp: true }), /T01's own ship already records/);
    // Where the platform can be read, a follow-up comes from its PR; where it cannot, by hand.
    await assert.rejects(() => buildShip(P, { ...base, mergeCommit: fu, followUp: true }), /a follow-up is read from its merged PR\/MR/);
    write(api, { 'src/T01-fix2.js': 'fix2\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'fix: second\n\nTask: EP-l-S01-T01');
    const fu2 = git(api, 'rev-parse', 'HEAD');
    git(api, 'push', '-q', 'origin', 'main');
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'web', path: '../web' }] }) });
    r = await buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', mergeCommit: fu2, followUp: true, today: '2026-10-20' });
    assert.equal(r.followUp.pr, 'local');
    assert.deepEqual(read(shipFile).followUps.map((x) => x.mergeCommit), [fu, fu2]);
    // The same commit in its short, upper-case form is the same follow-up (review 1).
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', mergeCommit: fu2.slice(0, 9).toUpperCase(), followUp: true, today: '2026-10-20' }), /already records merge/);
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', mergeCommit: sha.T01.slice(0, 7), followUp: true, today: '2026-10-20' }), /T01's own ship already records merge/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('a task branch whose words start with "followup" is the task\'s own until it ships (#350 review 1)', async () => {
  const { buildShip, buildMerged } = await import('./build.mjs');
  const { W, P, dir, sha } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    const view = { state: 'MERGED', mergedAt: '2026-10-19T10:00:00Z', mergeCommit: { oid: sha.T02 }, headRefName: 'feat/EP-l-S01-T02-followup-reminders', url: 'u5', body: '', statusCheckRollup: [] };
    const runner = (cmd, args) => {
      if (cmd === 'gh' && args[1] === 'list') return { ok: true, stdout: JSON.stringify([{ number: 5, state: 'MERGED', headRefName: view.headRefName, url: 'u5' }]), stderr: '' };
      if (cmd === 'gh' && args[1] === 'view' && args[2] === '5') return { ok: true, stdout: JSON.stringify(view), stderr: '' };
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const base = { story: 'EP-l-S01', task: 'T02', repo: 'api', today: '2026-10-20', runner, prReader: () => ({ ok: true, reviews: [] }) };
    assert.deepEqual([(await buildMerged(P, base)).state, (await buildMerged(P, base)).pr], ['merged', 5]);
    // Older than the page the listing reads: the PR asked about still counts (review 3).
    const older = { ...base, runner: (cmd, args) => (cmd === 'gh' && args[1] === 'list' ? { ok: true, stdout: '[]', stderr: '' } : runner(cmd, args)) };
    assert.equal((await buildMerged(P, { ...older, pr: '5' })).state, 'merged');
    const r = await buildShip(P, { ...older, pr: '5' });
    assert.equal(r.changed, true);
    assert.equal(read(path.join(dir, '.sdlc/build-log/EP-l-S01-T02-api.json')).mergeCommit, sha.T02);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

// A grouped PR's branch in `api`: two commits, T01 and T02, merged into main as PR #20 with a merge commit.
// `trailer: false` squashes it to a commit that names no task, as a platform's squash button does.
function groupedMerge(api, { merge = true, trailer = true } = {}) {
  git(api, 'checkout', '-q', '-b', 'feat/EP-l-S01-T01-small-fixes');
  for (const t of ['T01', 'T02']) {
    write(api, { [`src/g-${t}.js`]: `${t}\n` });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', `fix: small ${t}\n\nTask: EP-l-S01-${t}`);
  }
  git(api, 'checkout', '-q', 'main');
  if (merge) git(api, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #20 from o/feat/EP-l-S01-T01-small-fixes', 'feat/EP-l-S01-T01-small-fixes');
  else {
    git(api, 'merge', '-q', '--squash', 'feat/EP-l-S01-T01-small-fixes');
    git(api, 'commit', '-q', '-m', `fix: small fixes (#20)${trailer ? '\n\nTask: EP-l-S01-T01' : ''}`);
  }
  git(api, 'push', '-q', 'origin', 'main');
  return git(api, 'rev-parse', 'HEAD');
}

test('a grouped PR: several small tasks of one story in one PR, each shipped from it (#350)', async () => {
  const { buildShip, buildMerged, prTasks, trailerTask } = await import('./build.mjs');
  const { W, P, dir, api } = workspace({ tasks: '# Tasks\n\n- [ ] T01 — a\n- [ ] T02 — b\n- [ ] T03 — c\n' });
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    const m = groupedMerge(api);
    // A Task: trailer as git reads it: the last paragraph, the key in any case, the first one (review 1).
    assert.equal(trailerTask('fix: x\n\nTask: EP-l-S01-T01\nTask: EP-l-S01-T02'), 'EP-l-S01-T01');
    assert.equal(trailerTask('fix: x\r\n\r\ntask:  EP-l-S01-T02 \r\n'), 'EP-l-S01-T02');
    assert.equal(trailerTask('fix: x\n\nTask: EP-l-S01-T07\nmore words\n\nTask: EP-l-S01-T04'), 'EP-l-S01-T04', 'a Task: line in a middle paragraph is not a trailer');
    assert.equal(trailerTask('fix: x\n\nTask: not-an-id'), null);
    // git's own trailer rules (review 2): prose before it, the title alone, a folded value, an empty first one.
    assert.equal(trailerTask('fix: a\n\nSome prose here.\nTask: EP-l-S01-T01'), null);
    assert.equal(trailerTask('Task: EP-l-S01-T01'), null);
    assert.equal(trailerTask('fix: a\n\nTask: EP-l-S01-T01\n---\nfoo'), null);
    assert.equal(trailerTask('fix: a\n\nTask:\n  EP-l-S01-T01'), 'EP-l-S01-T01');
    assert.equal(trailerTask('fix: a\n\nTask:\nTask: EP-l-S01-T02'), 'EP-l-S01-T02');
    const view = { state: 'MERGED', mergedAt: '2026-10-20T10:00:00Z', mergeCommit: { oid: m }, headRefName: 'feat/EP-l-S01-T01-small-fixes', url: 'https://github.com/o/api/pull/20', body: '', statusCheckRollup: [] };
    const commits = { commits: [{ commit: { message: 'fix: small T01\n\nTask: EP-l-S01-T01' } }, { commit: { message: 'fix: small T02\n\nTask: EP-l-S01-T02' } }] };
    let commitsOk = true;
    const runner = (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'api' && args[1].startsWith('repos/{owner}/{repo}/pulls/20/commits')) return commitsOk ? { ok: true, stdout: JSON.stringify(commits.commits), stderr: '' } : { ok: false, stdout: '', stderr: 'denied' };
      if (cmd === 'gh' && args[1] === 'view' && args[2] === '20') return { ok: true, stdout: JSON.stringify(view), stderr: '' };
      if (cmd === 'gh' && args[1] === 'list') return { ok: true, stdout: JSON.stringify([{ number: 20, state: 'MERGED', headRefName: view.headRefName, url: view.url }]), stderr: '' };
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const base = { story: 'EP-l-S01', repo: 'api', today: '2026-10-20', runner, prReader: () => ({ ok: true, reviews: [] }) };
    assert.deepEqual(prTasks('github', 20, { runner }).tasks, ['EP-l-S01-T01', 'EP-l-S01-T02']);
    // T02 is not the branch's task: the search does not find it, by --pr it does.
    let r = await buildMerged(P, { ...base, task: 'T02' });
    assert.equal(r.state, 'none');
    r = await buildMerged(P, { ...base, task: 'T02', pr: '20' });
    assert.deepEqual([r.state, r.mergeCommit], ['merged', m]);
    // A task the PR does not carry is refused; commits that cannot be read are a refusal, never a guess.
    await assert.rejects(() => buildMerged(P, { ...base, task: 'T03', pr: '20' }), /PR\/MR #20's commits carry EP-l-S01-T01, EP-l-S01-T02, not EP-l-S01-T03/);
    // A branch naming no task whose commits carry other tasks: that is evidence, not a warning (review 1).
    view.headRefName = 'fix/typo';
    await assert.rejects(() => buildShip(P, { ...base, task: 'T03', pr: '20' }), /PR #20's commits carry EP-l-S01-T01, EP-l-S01-T02, not EP-l-S01-T03/);
    view.headRefName = 'feat/EP-l-S01-T01-small-fixes';
    commitsOk = false;
    await assert.rejects(() => buildShip(P, { ...base, task: 'T02', pr: '20' }), /its commits could not all be read to see whether it carries T02 too: denied/);
    commitsOk = true;
    // More than a page of commits: as unread as a failed read (review 1).
    const many = commits.commits;
    commits.commits = Array.from({ length: 100 }, () => ({ commit: { message: 'chore: x' } }));
    await assert.rejects(() => buildShip(P, { ...base, task: 'T02', pr: '20' }), /\(more than one page of them\)/);
    commits.commits = many;
    // Each task ships from the one PR, with the same merge commit.
    await buildShip(P, { ...base, task: 'T01', pr: '20' });
    await buildShip(P, { ...base, task: 'T02', pr: '20' });
    const ship = (t) => read(path.join(dir, `.sdlc/build-log/EP-l-S01-${t}-api.json`));
    assert.deepEqual([ship('T01').mergeCommit, ship('T02').mergeCommit, ship('T02').pr], [m, m, 'https://github.com/o/api/pull/20']);
    assert.equal((await buildMerged(P, { ...base, task: 'T02', pr: '20' })).state, 'shipped');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('a grouped PR by hand: the merge commit\'s merged range carries the tasks; a squash names only one (#350)', async () => {
  const { buildShip } = await import('./build.mjs');
  for (const merge of [true, false]) {
    const { W, P, api } = workspace();
    try {
      const m = groupedMerge(api, { merge });
      const ship = () => buildShip(P, { story: 'EP-l-S01', task: 'T02', repo: 'api', mergeCommit: m, today: '2026-10-20' });
      if (merge) assert.equal((await ship()).ship.mergeCommit, m);
      else await assert.rejects(ship, /names EP-l-S01-T01, not EP-l-S01-T02/);
    } finally { fs.rmSync(W, { recursive: true, force: true }); }
  }
});

test('grouped PR size: lines and files from the merge base, binary counted; warn only, over group_limit (#350)', async () => {
  const { changeSize, groupLimit, groupWarnings } = await import('./build.mjs');
  const { W, api } = workspace();
  try {
    git(api, 'checkout', '-q', '-b', 'g');
    write(api, { 'big.txt': Array.from({ length: 150 }, (_, i) => `l${i}`).join('\n') + '\n', 'two.txt': 'a\nb\n' });
    fs.writeFileSync(path.join(api, 'bin.dat'), Buffer.from([0, 1, 2, 0, 255]));
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'fix: a\n\nTask: EP-l-S01-T01');
    assert.deepEqual(changeSize(api, 'origin/main'), { lines: 152, files: 3 });
    const ids = ['EP-l-S01-T01', 'EP-l-S01-T02'];
    assert.deepEqual(groupWarnings(api, 'origin/main', ['EP-l-S01-T01'], {}), [], 'one task is not a group');
    assert.deepEqual(groupWarnings(api, 'origin/main', ids, {}), [], 'under the default limit');
    assert.match(groupWarnings(api, 'origin/main', ids, { group_limit: { lines: 100 } })[0], /changes 152 lines in 3 files — over the limit for a group \(100 lines, 10 files\)/);
    assert.match(groupWarnings(api, 'origin/main', ids, { group_limit: { files: 2 } })[0], /over the limit/);
    assert.deepEqual(groupLimit({ group_limit: { lines: -1, files: 'x' } }), { lines: 200, files: 10, bad: ['group_limit.lines', 'group_limit.files'] });
    assert.match(groupWarnings(api, 'origin/main', ['EP-l-S01-T01', 'EP-l-S02-T01'], {})[0], /tasks of more than one story/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad open-pr on a grouped branch: the body lists every task; --via auto checks each task\'s run and records each (#350)', async () => {
  const { runOpenPr } = await import('./openpr.mjs');
  const { W, P, dir, api } = workspace({ tasks: '# Tasks\n\n- [ ] T01 — a\n- [ ] T02 — b\n' });
  const prev = process.exitCode;
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github', default_branch: 'main' }, { name: 'web', path: '../web' }] }) });
    git(P, 'add', '-A');
    git(P, 'commit', '-q', '-m', 'chore: register api on github');
    groupedMerge(api, { merge: false });
    git(api, 'reset', '-q', '--hard', 'origin/main~1');
    git(api, 'push', '-q', '-f', 'origin', 'main');
    git(api, 'checkout', '-q', 'feat/EP-l-S01-T01-small-fixes');
    let seen = null;
    const creator = (_p, o) => { seen = o; return { ok: true, url: 'https://github.com/o/api/pull/21' }; };
    const runner = () => ({ ok: false, stdout: '', stderr: 'no platform here' });
    // A person opens it: the body lists both tasks; nothing is recorded.
    let res = await runOpenPr(api, { product: P, creator, runner, today: '2026-10-20' });
    assert.deepEqual(res.tasks, ['EP-l-S01-T01', 'EP-l-S01-T02']);
    assert.match(seen.body, /Story \/ task: `EP-l-S01-T01`, `EP-l-S01-T02`/);
    assert.match(seen.body, /specs\/EP-l-S01\//);
    // On the standing approval: each task's checks must have passed — T02's has not closed yet.
    yad(P, 'dial', 'open-pr', '--to', 'auto');
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    for (const step of ['spec', 'tasks']) yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', step, 'done');
    const close = (task) => {
      for (const step of ['implement', 'checks']) {
        const uid = json(yad(P, 'build', 'trust', 'EP-l-S01', '--repo', 'api', step, '--verdict', 'approved-unchanged', ...(step === 'checks' ? ['--signal', 'checks=pass'] : []), '--task', task, '--json')).uid;
        yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', step, 'done', '--run', uid, '--task', task);
      }
    };
    close('T01');
    const open = () => runOpenPr(api, { product: P, via: 'auto', creator, runner, today: '2026-10-20' });
    await assert.rejects(open, /checks has not closed for T02/);
    yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'implement', 'in_progress', '--task', 'T02');
    close('T02');
    res = await open();
    assert.deepEqual(res.tasks, ['EP-l-S01-T01', 'EP-l-S01-T02']);
    const opened = read(path.join(dir, '.sdlc/build-state/EP-l-S01.json')).repos.api.opened;
    assert.deepEqual(opened.map((o) => [o.task, o.pr, o.via]), [['T01', 21, 'auto'], ['T02', 21, 'auto']]);
    assert.notEqual(opened[0].run, opened[1].run, 'each task names its own checks run');
    // A commit of another story on the branch: refused before the push.
    write(api, { 'src/other.js': 'o\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'fix: other\n\nTask: EP-l-S02-T01');
    await assert.rejects(open, /carries tasks of another story: EP-l-S02-T01/);
  } finally { process.exitCode = prev; fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build sync: records every merged task with no ship through yad build ship, then build done; lists what it cannot (#365)', async () => {
  const { buildSync } = await import('./build.mjs');
  const { W, P, dir, sha } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github', default_branch: 'main' }, { name: 'web', path: '../web' }] }) });
    const asked = [];
    const runner = (cmd, args) => {
      asked.push(args.join(' '));
      // T01 merged with no PR; T02's merge commit was merged by PR #9.
      if (cmd === 'gh' && args[0] === 'api' && args[1] === `repos/{owner}/{repo}/commits/${sha.T01}/pulls`) return { ok: true, stdout: '[]', stderr: '' };
      if (cmd === 'gh' && args[0] === 'api' && args[1] === `repos/{owner}/{repo}/commits/${sha.T02}/pulls`) return { ok: true, stdout: JSON.stringify([{ number: 9, merged_at: '2026-10-20T10:00:00Z' }]), stderr: '' };
      if (cmd === 'gh' && args[1] === 'view' && args[2] === '9') return { ok: true, stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-10-20T10:00:00Z', mergeCommit: { oid: sha.T02 }, headRefName: 'feat/EP-l-S01-T02-list', url: 'https://github.com/o/api/pull/9', body: '', statusCheckRollup: [] }), stderr: '' };
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const prReader = () => ({ ok: true, reviews: [{ login: 'bob', state: 'APPROVED', body: '' }] });
    // No Build lane: the story may predate tracking, so a person decides (review 1).
    let r = await buildSync(P, { today: '2026-10-21', runner, prReader });
    assert.deepEqual([r.recorded.length, r.left.length], [0, 2]);
    assert.match(r.left[0].why, /has no Build lane in api — it may predate tracking/);
    assert.match(r.left[0].fix, /--retro-ship/);
    // A skipped lane, and a build-state that does not parse, are refused by build ship with their own cause (review 2).
    const bsFile = path.join(dir, '.sdlc/build-state/EP-l-S01.json');
    write(P, { 'epics/EP-l/.sdlc/build-state/EP-l-S01.json': JSON.stringify({ story: 'EP-l-S01', repos: { api: { status: 'skipped', record: { reason: 'x' } } } }) });
    r = await buildSync(P, { today: '2026-10-21', runner, prReader });
    assert.match(r.left[0].why, /EP-l-S01 \/ api is skipped/);
    for (const bad of ['{ not json', '[]', '{"repos": []}']) {
      fs.writeFileSync(bsFile, bad);
      r = await buildSync(P, { today: '2026-10-21', runner, prReader });
      assert.doesNotMatch(r.left[0].why, /predate tracking/, bad);
    }
    fs.rmSync(bsFile);
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    // A dry run writes nothing and says what it would run — the build done too (review 1).
    r = await buildSync(P, { dryRun: true, today: '2026-10-21', runner, prReader });
    assert.deepEqual(r.planned.filter((p) => p.task).map((p) => p.task).sort(), ['T01', 'T02']);
    assert.ok(r.planned.some((p) => p.command === 'yad build done EP-l-S01'));
    assert.equal(fs.existsSync(path.join(dir, '.sdlc/build-log')), false);
    // The run: T01 from its commit (no PR merged it), T02 from PR #9, which the platform names for its commit.
    r = await buildSync(P, { today: '2026-10-21', runner, prReader });
    assert.deepEqual(r.recorded.map((x) => [x.task, x.pr]).sort(), [['T01', 'none'], ['T02', 'https://github.com/o/api/pull/9']]);
    assert.deepEqual(read(path.join(dir, '.sdlc/build-log/EP-l-S01-T02-api.json')).engineer_review, [{ approver: 'bob', engagement: 'none' }]);
    assert.equal(status(dir), 'in-build');
    // build done ran for the story, and its refusal (web is not cloned) is listed, not fatal.
    assert.equal(r.notDone[0].story, 'EP-l-S01');
    assert.equal(r.changed, true);
    // Asked again: nothing left to record.
    r = await buildSync(P, { today: '2026-10-21', runner, prReader });
    assert.deepEqual([r.recorded.length, r.left.length], [0, 0]);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build sync: a squash-merged grouped PR ships every task of the story it carries (#583)', async () => {
  const { buildSync } = await import('./build.mjs');
  const { W, P, dir, api } = workspace({ merged: [] });
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github', default_branch: 'main', git_url: 'https://github.com/o/api.git' }, { name: 'web', path: '../web' }] }) });
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    // On main only a squash commit that names no task: the platform's branch name says T01, the PR's commits say T02 too.
    const m = groupedMerge(api, { merge: false, trailer: false });
    const view = { state: 'MERGED', mergedAt: '2026-10-20T10:00:00Z', mergeCommit: { oid: m }, headRefName: 'feat/EP-l-S01-T01-small-fixes', url: 'https://github.com/o/api/pull/20', body: '', statusCheckRollup: [] };
    // The PR also carries a task of another story: listed for a person, never recorded.
    const commits = ['T01', 'T02'].map((t) => ({ commit: { message: `fix: small ${t}\n\nTask: EP-l-S01-${t}` } })).concat({ commit: { message: 'fix: other\n\nTask: EP-l-S02-T01' } });
    const read20 = { ok: true, stdout: JSON.stringify(commits), stderr: '' };
    let commitsAnswer = read20;
    const runner = (cmd, args) => {
      if (cmd === 'which' || (cmd === 'gh' && args[0] === 'auth')) return { ok: true, stdout: '', stderr: '' };
      if (cmd === 'gh' && args[0] === 'api' && args.includes('graphql')) return { ok: true, stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 20, headRefName: view.headRefName, baseRefName: 'main', mergedAt: view.mergedAt, mergeCommit: { oid: m } }] } } } }), stderr: '' };
      if (cmd === 'gh' && args[0] === 'api' && args[1].startsWith('repos/{owner}/{repo}/pulls/20/commits')) return commitsAnswer;
      if (cmd === 'gh' && args[1] === 'view' && args[2] === '20') return { ok: true, stdout: JSON.stringify(view), stderr: '' };
      if (cmd === 'gh' && args[1] === 'list') return { ok: true, stdout: JSON.stringify([{ number: 20, state: 'MERGED', headRefName: view.headRefName, url: view.url }]), stderr: '' };
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const opts = { today: '2026-10-21', runner, prReader: () => ({ ok: true, reviews: [] }) };
    const shipFile = (t) => path.join(dir, `.sdlc/build-log/EP-l-S01-${t}-api.json`);
    const other = (r) => r.left.filter((x) => x.story === 'EP-l-S02');
    // A dry run lists T02 from the PR's commits, and writes nothing.
    let r = await buildSync(P, { ...opts, dryRun: true });
    assert.deepEqual(r.planned.filter((p) => p.task).map((p) => [p.task, p.pr]), [['T01', '20'], ['T02', '20']]);
    assert.equal(r.planned.find((p) => p.task === 'T02').command, 'yad build ship EP-l-S01 --task T02 --repo api --pr 20');
    assert.equal(other(r).length, 1);
    assert.equal(fs.existsSync(path.join(dir, '.sdlc/build-log')), false);
    // The PR's commits cannot be read, or not all of them: only the branch's task is recorded, and the rest
    // is said to be unknown, with the command a person runs.
    const page = { ok: true, stdout: JSON.stringify(Array.from({ length: 100 }, () => commits[0])), stderr: '' };
    for (const [answer, why] of [[{ ok: false, stdout: '', stderr: 'denied' }, /its commits could not all be read \(denied\)/], [page, /\(more than one page of them\)/]]) {
      commitsAnswer = answer;
      const now = await buildSync(P, opts);
      assert.deepEqual(now.recorded.map((x) => x.task), ['T01']);
      const note = now.unread.find((u) => u.pr === 20);
      assert.match(note.why, why);
      assert.match(note.why, /yad build ship <story> --task <T> --repo api --pr 20/);
      assert.equal(fs.existsSync(shipFile('T02')), false);
      fs.rmSync(path.join(dir, '.sdlc/build-log'), { recursive: true });
    }
    commitsAnswer = read20;
    // Read: both tasks of the story ship from PR #20, with its merge commit.
    r = await buildSync(P, opts);
    assert.deepEqual(r.recorded.map((x) => [x.task, x.pr, x.mergeCommit]), [['T01', view.url, m], ['T02', view.url, m]]);
    assert.deepEqual(other(r).map((x) => [x.task, x.command]), [['T01', 'yad build ship EP-l-S02 --task T01 --repo api --pr 20']]);
    assert.match(other(r)[0].why, /a task of another story than EP-l-S01/);
    assert.equal(fs.existsSync(path.join(dir, '.sdlc/build-log/EP-l-S02-T01-api.json')), false);
    assert.equal(r.notDone[0].story, 'EP-l-S01', 'build done ran for the story');
    // Asked again: nothing new.
    r = await buildSync(P, opts);
    assert.equal(r.recorded.length, 0);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build sync: a later sync records the tasks of a grouped PR an earlier one missed, asking each PR once (#218)', async () => {
  const { buildSync } = await import('./build.mjs');
  // T03 is still owed after the PR ships T01 and T02, so the story's PR stays worth reading.
  const { W, P, dir, api } = workspace({ merged: [], tasks: '# Tasks\n\n- [ ] T01 — a\n- [ ] T02 — b\n- [ ] T03 — c\n' });
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github', default_branch: 'main', git_url: 'https://github.com/o/api.git' }, { name: 'web', path: '../web' }] }) });
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    const m = groupedMerge(api, { merge: false, trailer: false });
    const view = { state: 'MERGED', mergedAt: '2026-10-20T10:00:00Z', mergeCommit: { oid: m }, headRefName: 'feat/EP-l-S01-T01-small-fixes', url: 'https://github.com/o/api/pull/20', body: '', statusCheckRollup: [] };
    const answer = (ts) => ({ ok: true, stdout: JSON.stringify(ts.map((t) => ({ commit: { message: `fix: small ${t}\n\nTask: EP-l-S01-${t}` } }))), stderr: '' });
    let commitsAnswer = { ok: false, stdout: '', stderr: 'denied' };
    let asked = 0;
    const runner = (cmd, args) => {
      if (cmd === 'which' || (cmd === 'gh' && args[0] === 'auth')) return { ok: true, stdout: '', stderr: '' };
      if (cmd === 'gh' && args[0] === 'api' && args.includes('graphql')) return { ok: true, stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 20, headRefName: view.headRefName, baseRefName: 'main', mergedAt: view.mergedAt, mergeCommit: { oid: m } }] } } } }), stderr: '' };
      if (cmd === 'gh' && args[0] === 'api' && args[1].startsWith('repos/{owner}/{repo}/pulls/20/commits')) { asked++; return commitsAnswer; }
      if (cmd === 'gh' && args[1] === 'view' && args[2] === '20') return { ok: true, stdout: JSON.stringify(view), stderr: '' };
      if (cmd === 'gh' && args[1] === 'list') return { ok: true, stdout: JSON.stringify([{ number: 20, state: 'MERGED', headRefName: view.headRefName, url: view.url }]), stderr: '' };
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const opts = { today: '2026-10-21', runner, prReader: () => ({ ok: true, reviews: [] }) };
    const shipFile = (t) => path.join(dir, `.sdlc/build-log/EP-l-S01-${t}-api.json`);
    // 1. The PR's commits cannot be read: only the branch's task is recorded, and the note says a later sync asks again.
    let r = await buildSync(P, opts);
    assert.deepEqual(r.recorded.map((x) => x.task), ['T01']);
    assert.equal(r.unread.filter((u) => u.pr === 20).length, 1, 'a PR not read is said once');
    assert.match(r.unread.find((u) => u.pr === 20).why, /the next sync asks again, or each other task it carries: yad build ship <story> --task <T> --repo api --pr 20/);
    assert.equal(fs.existsSync(shipFile('T02')), false);
    // 2. Read again, but its commits name only T01 (as an older yadflow saw it): nothing new, and the ship of T01
    // is never written twice.
    commitsAnswer = answer(['T01']);
    r = await buildSync(P, opts);
    assert.deepEqual([r.recorded.length, r.left.length], [0, 0]);
    // 3. A dry run, the commits now read in full: T02 is planned from the PR of T01's ship, nothing is written.
    commitsAnswer = answer(['T01', 'T02']);
    r = await buildSync(P, { ...opts, dryRun: true });
    assert.deepEqual(r.planned.filter((x) => x.task).map((x) => [x.task, x.pr, x.command]), [['T02', '20', 'yad build ship EP-l-S01 --task T02 --repo api --pr 20']]);
    assert.equal(fs.existsSync(shipFile('T02')), false);
    // 4. The sync records T02 from PR #20, with its merge commit.
    r = await buildSync(P, opts);
    assert.deepEqual(r.recorded.map((x) => [x.task, x.pr, x.mergeCommit]), [['T02', view.url, m]]);
    assert.equal(read(shipFile('T02')).mergeCommit, m);
    // 5. Asked again: nothing new is recorded, and PR #20 is asked once, though the ships of T01 and T02 both
    // name it (T03 has no ship yet, so the story is still in-build).
    asked = 0;
    r = await buildSync(P, opts);
    assert.deepEqual([r.recorded.length, r.left.length], [0, 0]);
    assert.equal(status(dir), 'in-build');
    assert.equal(asked, 1);
    // 6. A shipped story is not asked again.
    const story = path.join(dir, 'stories/EP-l-S01.md');
    fs.writeFileSync(story, fs.readFileSync(story, 'utf8').replace(/^status:.*$/m, 'status: shipped'));
    asked = 0;
    r = await buildSync(P, opts);
    assert.equal(asked, 0);
    assert.equal(r.recorded.length, 0);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build sync: what a re-read asks, skips and lists — other stories, no PR, retro, every task shipped, another repo (#218)', async () => {
  const { buildSync } = await import('./build.mjs');
  const { W, P, dir, api } = workspace({ merged: [] });
  try {
    write(P, {
      '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github', default_branch: 'main', git_url: 'https://github.com/o/api.git' }, { name: 'web', path: '../web' }] }),
      'epics/EP-l/stories/EP-l-S02.md': '---\nid: EP-l-S02\nepic: EP-l\nstatus: in-build\nrepos: [api]\n---\n# S02\n',
      'epics/EP-l/stories/EP-l-S03.md': '---\nid: EP-l-S03\nepic: EP-l\nstatus: in-build\nrepos: [api]\n---\n# S03\n',
    });
    // S02 owes T01 and T02 on api's main; S03 has no task list there.
    write(api, { 'specs/EP-l-S02/tasks.md': '# Tasks\n\n- [ ] T01 — a\n- [ ] T02 — b\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'docs: S02 tasks');
    git(api, 'push', '-q', 'origin', 'main');
    const ship = (story, task, pr, extra = {}) => ({ [`.sdlc/build-log/${story}-${task}-api.json`]: JSON.stringify({ story, task, repo: 'api', pr, mergeCommit: null, shippedAt: '2026-10-20', ...extra }) });
    write(dir, {
      ...ship('EP-l-S01', 'T01', '#30'), // re-read: S01 still owes T02
      ...ship('EP-l-S01', 'T05', 'none'), ...ship('EP-l-S01', 'T06', 'local'), // no PR: skipped
      ...ship('EP-l-S01', 'retro', '#31', { retroactive: true }), // retroactive: skipped
      ...ship('EP-l-S02', 'T01', '#40'), ...ship('EP-l-S02', 'T02', '#40'), // every task shipped: not asked
      ...ship('EP-l-S03', 'T01', 'https://github.com/o/other/pull/50'), // a PR of another repo
      ...ship('EP-l-S04', 'T01', '#60'), // no story file: its status cannot be read
    });
    const calls = [];
    const msg = (id) => ({ commit: { message: `fix: ${id}\n\nTask: ${id}` } });
    const runner = (cmd, args) => {
      if (cmd === 'which' || (cmd === 'gh' && args[0] === 'auth')) return { ok: true, stdout: '', stderr: '' };
      const m = cmd === 'gh' && args[0] === 'api' && String(args[1]).match(/^repos\/\{owner\}\/\{repo\}\/pulls\/(\d+)\/commits/);
      if (m) {
        calls.push(Number(m[1]));
        return { ok: true, stdout: JSON.stringify(['EP-l-S01-T01', 'EP-l-S01-T02', 'EP-l-S02-T03', 'EP-m-S01-T01'].map(msg)), stderr: '' };
      }
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const lines = [];
    const was = console.log;
    console.log = (x) => lines.push(String(x));
    let r;
    try { r = await buildSync(P, { today: '2026-10-21', runner, prReader: () => ({ ok: true, reviews: [] }), dryRun: true }); } finally { console.log = was; }
    assert.ok(lines.some((l) => /not recorded \(again\): EP-l-S02 \/ T03 in api/.test(l)), lines.join('\n'));
    // Only PR #30 is asked: no PR, a retro ship, a story with every task shipped, another repo's link and an
    // unreadable story are not.
    assert.deepEqual(calls, [30]);
    assert.deepEqual(r.planned.filter((x) => x.task).map((x) => [x.story, x.task, x.pr]), [['EP-l-S01', 'T02', '30']]);
    // Tasks of another story or epic are listed, never planned or recorded, and marked as read again.
    assert.deepEqual(r.left.map((x) => [x.story, x.task, x.again]).sort(), [['EP-l-S02', 'T03', true], ['EP-m-S01', 'T01', true]]);
    assert.match(r.left[0].command, /^yad build ship EP-[lm]-S0[12] --task T0[13] --repo api --pr 30$/);
    const cross = r.unread.find((u) => u.pr === 50);
    assert.equal(cross.repo, 'api');
    assert.match(cross.why, /links https:\/\/github\.com\/o\/other\/pull\/50, a PR\/MR of o\/other, not of o\/api, so it is not read again/);
    // Unknown is never an all-clear: a story with no task list counts as owing (S03 is then held back only by its
    // link to another repo), and it is said.
    assert.match(r.notes.find((x) => x.story === 'EP-l-S03').why, /no specs\/EP-l-S03\/tasks\.md on origin\/main — so its PRs\/MRs are read again/);
    assert.match(r.notes.find((x) => x.story === 'EP-l-S04').why, /its status could not be read \(no story file for EP-l-S04\)/);
    assert.equal(r.notes.some((x) => x.story === 'EP-l-S02'), false);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build sync: a grouped PR merged with a merge commit ships each task once (#583)', async () => {
  const { buildSync } = await import('./build.mjs');
  const { W, P, dir, api } = workspace({ merged: [] });
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github', default_branch: 'main' }, { name: 'web', path: '../web' }] }) });
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    const m = groupedMerge(api);
    const view = { state: 'MERGED', mergedAt: '2026-10-20T10:00:00Z', mergeCommit: { oid: m }, headRefName: 'feat/EP-l-S01-T01-small-fixes', url: 'https://github.com/o/api/pull/20', body: '', statusCheckRollup: [] };
    const commits = ['T01', 'T02'].map((t) => ({ commit: { message: `fix: small ${t}\n\nTask: EP-l-S01-${t}` } }));
    const runner = (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'api' && args[1].endsWith('/pulls') && args[1].startsWith('repos/{owner}/{repo}/commits/')) return { ok: true, stdout: JSON.stringify([{ number: 20, merged_at: view.mergedAt }]), stderr: '' };
      if (cmd === 'gh' && args[0] === 'api' && args[1].startsWith('repos/{owner}/{repo}/pulls/20/commits')) return { ok: true, stdout: JSON.stringify(commits), stderr: '' };
      if (cmd === 'gh' && args[1] === 'view' && args[2] === '20') return { ok: true, stdout: JSON.stringify(view), stderr: '' };
      if (cmd === 'gh' && args[1] === 'list') return { ok: true, stdout: JSON.stringify([{ number: 20, state: 'MERGED', headRefName: view.headRefName, url: view.url }]), stderr: '' };
      return { ok: false, stdout: '', stderr: 'x' };
    };
    const r = await buildSync(P, { today: '2026-10-21', runner, prReader: () => ({ ok: true, reviews: [] }) });
    assert.deepEqual(r.recorded.map((x) => x.task).sort(), ['T01', 'T02']);
    assert.equal(r.left.length, 0, JSON.stringify(r.left));
    for (const t of ['T01', 'T02']) assert.equal(read(path.join(dir, `.sdlc/build-log/EP-l-S01-${t}-api.json`)).mergeCommit, m);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build sync: where the platform cannot be read, nothing is recorded on nobody\'s word (#365)', async () => {
  const { buildSync } = await import('./build.mjs');
  const { W, P, dir } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', default_branch: 'main' }, { name: 'web', path: '../web' }] }) });
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    const r = await buildSync(P, { today: '2026-10-21' });
    assert.equal(r.recorded.length, 0);
    assert.deepEqual(r.left.map((x) => x.task).sort(), ['T01', 'T02']);
    assert.match(r.left[0].why, /api has no platform to read the PR\/MR that merged/);
    assert.match(r.left[0].fix, /a person records it/);
    assert.equal(fs.existsSync(path.join(dir, '.sdlc/build-log')), false);
    await assert.rejects(() => buildSync(P, { epic: 'nope' }), /'nope' is not an epic id/);
    await assert.rejects(() => buildSync(P, { epic: 'EP-typo' }), /no epic EP-typo in this Product/);
    assert.match(yad(P, 'build', 'sync', 'EP-l', 'EP-x').out, /takes one epic at most/);
    // A repo not read is unknown, never an all-clear (review 1).
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../gone', default_branch: 'main' }, { name: 'web', path: '../web' }] }) });
    const u = await buildSync(P, { today: '2026-10-21' });
    assert.equal(u.recorded.length + u.left.length, 0);
    assert.ok(u.unread.some((x) => x.repo === 'api'));
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build ship from a commit more than one merged PR holds: refused, naming them, never the first (#365 review 1)', async () => {
  const { buildShip } = await import('./build.mjs');
  const { W, P, sha } = workspace();
  try {
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    const runner = (cmd, args) => (cmd === 'gh' && args[0] === 'api' && /\/pulls$/.test(args[1])
      ? { ok: true, stdout: JSON.stringify([{ number: 4, merged_at: 'x' }, { number: 8, merged_at: 'y' }]), stderr: '' }
      : { ok: false, stdout: '', stderr: 'x' });
    await assert.rejects(() => buildShip(P, { story: 'EP-l-S01', task: 'T01', repo: 'api', mergeCommit: sha.T01, today: '2026-10-21', runner }), /is in more than one merged PR\/MR: #4, #8/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build step spec in_progress pins Spec Kit\'s feature folder to the story, only where Spec Kit is used (#348)', () => {
  const { W, P, api } = workspace();
  const fj = path.join(api, '.specify/feature.json');
  try {
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    // No .specify/: the repo does not use Spec Kit, so nothing is written or said.
    let r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'in_progress', '--json');
    assert.equal(r.code, 0, r.out);
    assert.equal('specKit' in json(r), false);
    assert.equal(fs.existsSync(fj), false);
    assert.doesNotMatch(r.out, /Spec Kit/);
    // The previous story's folder, plus a key of Spec Kit's own: the folder moves, the key stays.
    write(api, { '.specify/feature.json': JSON.stringify({ feature_directory: 'specs/EP-l-S00', other: 1 }) });
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'in_progress', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).specKit, { file: 'api/.specify/feature.json', featureDirectory: 'specs/EP-l-S01', changed: true });
    assert.deepEqual(read(fj), { feature_directory: 'specs/EP-l-S01', other: 1 });
    assert.match(r.out, /SPECIFY_FEATURE_DIRECTORY=specs\/EP-l-S01/);
    // Already pinned: no rewrite.
    const before = fs.statSync(fj).mtimeMs;
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'in_progress');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /feature folder in api is already specs\/EP-l-S01/);
    assert.equal(fs.statSync(fj).mtimeMs, before);
    // A file it cannot read is left alone, and the step is still recorded.
    fs.writeFileSync(fj, '{ not json');
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'in_progress');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /feature\.json cannot be read, so it was left alone/);
    assert.equal(fs.readFileSync(fj, 'utf8'), '{ not json');
    fs.writeFileSync(fj, '[]');
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'in_progress');
    assert.match(r.out, /is not a JSON object/);
    assert.equal(fs.readFileSync(fj, 'utf8'), '[]');
    // Other moves of the step do not touch it.
    fs.rmSync(fj);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'done');
    assert.equal(r.code, 0, r.out);
    assert.equal(fs.existsSync(fj), false);
    // The tasks step pins it too (yad-spec runs both, and another story may have moved it), creating the
    // file when .specify/ has none; specify's hint is for the spec step only.
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'tasks', 'in_progress', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).specKit, { file: 'api/.specify/feature.json', featureDirectory: 'specs/EP-l-S01', changed: true });
    assert.equal(fs.readFileSync(fj, 'utf8'), '{"feature_directory":"specs/EP-l-S01"}\n');
    assert.doesNotMatch(r.out, /SPECIFY_FEATURE_DIRECTORY/);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'tasks', 'in_progress', '--json');
    assert.deepEqual(json(r).specKit, { file: 'api/.specify/feature.json', featureDirectory: 'specs/EP-l-S01', changed: false });
    // Not a plain file, or a .specify that is a link: never written through.
    fs.rmSync(fj);
    fs.mkdirSync(fj);
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'tasks', 'in_progress');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /feature\.json is not a plain file, so it was left alone/);
    assert.equal(fs.statSync(fj).isDirectory(), true);
    fs.rmSync(path.join(api, '.specify'), { recursive: true });
    const elsewhere = path.join(W, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(api, '.specify'));
    r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'tasks', 'in_progress');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /api\/\.specify is not a plain folder, so Spec Kit's feature folder was not pinned/);
    assert.deepEqual(fs.readdirSync(elsewhere), []);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build step spec in_progress: a repo not checked out is said, and the step is still recorded (#348)', () => {
  const { W, P, dir } = workspace();
  try {
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'web');
    const r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'web', 'spec', 'in_progress');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /web is not checked out here, so Spec Kit's feature folder was not pinned/);
    assert.equal(read(path.join(dir, '.sdlc/build-state/EP-l-S01.json')).repos.web.steps[0].status, 'in_progress');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build step spec in_progress: a pin that cannot run never fails the recorded step (#348 review 2)', () => {
  const { W, P, dir, api } = workspace();
  try {
    yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
    write(api, { '.specify/memory/constitution.md': '# c\n' });
    // The folder is a clone of another repo than the one registered: the lookup throws, the pin is a warning
    // that keeps the lookup's fix, and the step stands.
    git(api, 'remote', 'set-url', 'origin', 'https://github.com/team/api.git');
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api', git_url: 'https://github.com/team/other.git' }, { name: 'web', path: '../web' }] }) });
    const r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', 'spec', 'in_progress', '--json');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Spec Kit folder not pinned: \.\.\/api is a clone of team\/api, not team\/other — fix the path of api/);
    assert.equal('specKit' in json(r), false);
    assert.equal(fs.existsSync(path.join(api, '.specify/feature.json')), false);
    assert.equal(read(path.join(dir, '.sdlc/build-state/EP-l-S01.json')).repos.api.steps[0].status, 'in_progress');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

// A light spec (#348): one spec.md with the spec, the plan and the tasks; link.md says spec-mode: light.
const LIGHT_LINK = '---\nstory: EP-l-S01\nepic: EP-l\nrepo: api\nfeature-id: EP-l-S01\nproduct-repo: ../../../product\ncontract-lock: none\nspeckit: not-used\nspec-mode: light\ngenerated: 2026-10-25\n---\n# Spec link\n';
const lightSpec = (tasks) => `# Spec — EP-l-S01\n\n## Acceptance criteria\n- T09 is not a task: it is above the block.\n\n## Plan\n1. T08 neither.\n\n## Tasks\n${tasks}`;
const LIGHT_TASKS_OK = '<!-- yad:tasks -->\n## T01 — create the order\n**Files:** src/T01.js\n\n## T02 — list orders\n**Files:** src/T02.js\n<!-- /yad:tasks -->\n';
function walkToReview(P) {
  yad(P, 'build', 'start', 'EP-l-S01', '--repo', 'api');
  yad(P, 'skip', 'EP-l', 'EP-l-S01', '--repo', 'web', '--reason', 'no UI change');
  for (const step of ['spec', 'tasks', 'implement', 'checks']) {
    const r = yad(P, 'build', 'step', 'EP-l-S01', '--repo', 'api', step, 'done');
    assert.equal(r.code, 0, r.out);
  }
}

test('yad build done reads a light spec\'s tasks from the marked block of spec.md (#348)', () => {
  const { W, P, dir, sha } = workspace({ spec: { 'specs/EP-l-S01/link.md': LIGHT_LINK, 'specs/EP-l-S01/spec.md': lightSpec(LIGHT_TASKS_OK) } });
  try {
    walkToReview(P);
    let r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01);
    assert.equal(r.code, 0, r.out);
    // T02 is owed; T08 and T09 above the block are not.
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no ship yet for: api\/T02/);
    assert.doesNotMatch(r.out, /T0[89]/);
    r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T02', '--repo', 'api', '--merge-commit', sha.T02);
    assert.equal(r.code, 0, r.out);
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 0, r.out);
    assert.equal(status(dir), 'shipped');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build done: a spec.md tasks block counts only for a light spec, and only when it is whole (#348)', () => {
  const cases = [
    // link.md does not say light: the missing tasks.md is missing, whatever spec.md holds.
    [{ 'specs/EP-l-S01/link.md': LIGHT_LINK.replace('spec-mode: light\n', ''), 'specs/EP-l-S01/spec.md': lightSpec(LIGHT_TASKS_OK) }, /its link\.md does not say `spec-mode: light` \(plain, on its own line\), so the tasks block in spec\.md is not read/],
    // A link.md with Windows line endings is not read as light: named, not hidden behind "no tasks.md".
    [{ 'specs/EP-l-S01/link.md': LIGHT_LINK.replace(/\n/g, '\r\n'), 'specs/EP-l-S01/spec.md': lightSpec(LIGHT_TASKS_OK) }, /its link\.md does not say `spec-mode: light`/],
    [{ 'specs/EP-l-S01/link.md': LIGHT_LINK.replace('spec-mode: light', 'spec-mode: full') }, /no specs\/EP-l-S01\/tasks\.md on origin\/main/],
    [{ 'specs/EP-l-S01/link.md': LIGHT_LINK }, /says spec-mode: light, but there is no spec\.md/],
    [{ 'specs/EP-l-S01/link.md': LIGHT_LINK, 'specs/EP-l-S01/spec.md': lightSpec('## T01 — no markers\n') }, /is a light spec without one <!-- yad:tasks --> … <!-- \/yad:tasks --> block/],
    [{ 'specs/EP-l-S01/link.md': LIGHT_LINK, 'specs/EP-l-S01/spec.md': lightSpec(LIGHT_TASKS_OK + LIGHT_TASKS_OK) }, /is a light spec without one/],
    [{ 'specs/EP-l-S01/link.md': LIGHT_LINK, 'specs/EP-l-S01/spec.md': lightSpec('<!-- /yad:tasks -->\n## T01 — x\n<!-- yad:tasks -->\n') }, /is a light spec without one/],
    [{ 'specs/EP-l-S01/link.md': LIGHT_LINK, 'specs/EP-l-S01/spec.md': lightSpec('<!-- yad:tasks -->\nnothing yet\n<!-- /yad:tasks -->\n') }, /the tasks block of specs\/EP-l-S01\/spec\.md on origin\/main names no task/],
  ];
  for (const [spec, why] of cases) {
    const { W, P, sha } = workspace({ spec });
    try {
      walkToReview(P);
      yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01);
      const r = yad(P, 'build', 'done', 'EP-l-S01');
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, why);
      assert.match(r.out, /EP-l-S01 is not shipped yet/);
    } finally { fs.rmSync(W, { recursive: true, force: true }); }
  }
});

test('the light-spec markers the skills write are the ones yad build done reads (#348)', async () => {
  const { LIGHT_TASKS, lightTasksBlock } = await import('./build.mjs');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['skills/yad-spec/SKILL.md', 'skills/yad-spec/references/spec-handoff.md', 'skills/yad-implement/SKILL.md', 'docs/CLI.md']) {
    const text = read(f);
    assert.ok(text.includes(LIGHT_TASKS.begin) && text.includes(LIGHT_TASKS.end), f);
  }
  assert.match(read('skills/yad-spec/SKILL.md'), /`spec-mode: light`/);
  assert.match(read('skills/yad-spec/references/spec-handoff.md'), /^spec-mode: full \| light$/m);
  // The example in spec-handoff.md is a block build done can read.
  const example = read('skills/yad-spec/references/spec-handoff.md').match(/```markdown\n(# Spec — [\s\S]*?)```/)[1];
  assert.match(lightTasksBlock(example), /^## T01 — /m);
});

test('yad build done: a tasks.md that exists wins over a light spec\'s tasks block (#348 review 1)', () => {
  const { W, P, dir, sha } = workspace({ spec: {
    'specs/EP-l-S01/tasks.md': '# Tasks\n\n- [ ] T01 — create the order\n',
    'specs/EP-l-S01/link.md': LIGHT_LINK,
    'specs/EP-l-S01/spec.md': lightSpec(LIGHT_TASKS_OK),
  } });
  try {
    walkToReview(P);
    let r = yad(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--merge-commit', sha.T01);
    assert.equal(r.code, 0, r.out);
    r = yad(P, 'build', 'done', 'EP-l-S01');
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /T02/);
    assert.equal(status(dir), 'shipped');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('#450 yad open-pr --via auto: a branch cut from another branch, with no base chosen, is a YAD-STATE-009 error and nothing is pushed', async () => {
  const { runOpenPr } = await import('./openpr.mjs');
  const { W, P, api } = workspace();
  try {
    // The registry names no default_branch for api, so the base is origin/HEAD (main): nobody chose it.
    git(api, 'checkout', '-q', '-b', 'develop');
    write(api, { 'src/other.js': 'o\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'feat: other\n\nTask: EP-l-S01-T09');
    git(api, 'push', '-q', 'origin', 'develop');
    const branch = 'feat/EP-l-S01-T01-orders';
    git(api, 'checkout', '-q', '-b', branch);
    write(api, { 'src/orders.js': 'x\n' });
    git(api, 'add', '-A');
    git(api, 'commit', '-q', '-m', 'feat: orders\n\nTask: EP-l-S01-T01');
    let created = 0;
    const creator = () => { created += 1; return { ok: true, url: 'https://github.com/o/api/pull/12' }; };
    const runner = () => ({ ok: false, stdout: '', stderr: 'no platform here' });
    await assert.rejects(() => runOpenPr(api, { product: P, via: 'auto', platform: 'github', creator, runner }),
      (e) => e.code === 'YAD-STATE-009' && /holds 1 commit of other tasks from origin\/develop/.test(e.message));
    assert.equal(git(api, 'ls-remote', '--heads', 'origin', branch), '', 'nothing was pushed');
    assert.equal(created, 0);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

// #217: a registered folder is judged before any git runs in it, as E125 does for the other commands. A
// logging git first on PATH writes the folder each call runs in, as the disk spells it: a call in a link to
// api is logged as api.
function gitLogger(W) {
  const bin = path.join(W, 'bin');
  const log = path.join(W, 'git-calls.log');
  fs.mkdirSync(bin, { recursive: true });
  const realGit = execFileSync('sh', ['-c', 'command -v git']).toString().trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\t%s\\n' "$(pwd -P)" "$*" >> '${log}'\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  // gh and glab are never signed in here: nothing reaches the network.
  for (const cli of ['gh', 'glab']) fs.writeFileSync(path.join(bin, cli), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const yadLogged = (cwd, ...args) => {
    const r = spawnSync(process.execPath, [YAD, ...args], { cwd, env: { ...ENV, PATH: `${bin}${path.delimiter}${ENV.PATH}`, PWD: cwd, YAD_NO_REPORT: '1', YAD_NO_UPDATE_CHECK: '1' }, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const gitIn = (dir) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').split('\n').filter((l) => l.startsWith(`${dir}\t`) || l.startsWith(`${dir}/`));
  return { yadLogged, gitIn };
}
// A folder the Product commits, shaped like a bare repo whose config runs a command when git reads it.
function bareShaped(dir, marker) {
  for (const d of ['objects', 'refs']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(dir, 'config'), `[core]\n\tbare = true\n\tfsmonitor = touch '${marker}'\n`);
}

test('yad build ship, build done and the Spec Kit pin run no git in a registered folder reached through a link inside the Product, and say why (#217)', { skip: process.platform === 'win32' && 'a shell script as git, and symlinks' }, async () => {
  const { pinSpecKit } = await import('./build.mjs');
  const { W, P, api } = workspace();
  try {
    const { yadLogged, gitIn } = gitLogger(W);
    // A link the Product commits, to a real clone: it has a `.git`, so a bare existence test passed it.
    fs.symlinkSync('../api', path.join(P, 'evil'));
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: 'evil', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    git(P, 'add', '-A');
    git(P, 'commit', '-q', '-m', 'chore: a link');
    fs.mkdirSync(path.join(api, '.specify'));
    const why = /api \(evil\): reached through a link inside a repo's tree — yad runs no git there/;
    let r = yadLogged(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--pr', '7');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, why);
    r = yadLogged(P, 'build', 'done', 'EP-l-S01', '--no-fetch');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, why);
    assert.equal(pinSpecKit(P, 'api', 'EP-l-S01', 'spec'), null, 'the pin is not made');
    assert.equal(fs.existsSync(path.join(api, '.specify', 'feature.json')), false, 'nothing was written through the link');
    assert.deepEqual(gitIn(api), [], 'no git ran in the linked clone');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build ship and the Spec Kit pin run no git in a registered folder shaped like a bare repo, and say why (#217)', { skip: process.platform === 'win32' && 'a shell script as git' }, async () => {
  const { pinSpecKit } = await import('./build.mjs');
  const { W, P } = workspace();
  try {
    const { yadLogged, gitIn } = gitLogger(W);
    const marker = path.join(W, 'fsmonitor-ran');
    const bare = path.join(P, 'bare');
    bareShaped(bare, marker);
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: 'bare', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    const r = yadLogged(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--pr', '7');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /api \(bare\): a folder on its way holds an entry named HEAD, .* — yad runs no git there/);
    assert.equal(pinSpecKit(P, 'api', 'EP-l-S01', 'spec'), null);
    assert.deepEqual(gitIn(bare), [], 'no git ran in the bare-shaped folder');
    assert.equal(fs.existsSync(marker), false, 'its config never ran');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build ship and the Spec Kit pin run no git in a registered clone outside the workspace, or one reached through a .git folder, and say why (#217)', { skip: process.platform === 'win32' && 'a shell script as git' }, async () => {
  const { pinSpecKit } = await import('./build.mjs');
  const { W, P } = workspace();
  // A real clone beside the workspace folder, not in it: a bare existence test passed it.
  const away = `${W}-elsewhere`;
  try {
    const { yadLogged, gitIn } = gitLogger(W);
    initRepo(away);
    fs.mkdirSync(path.join(away, '.specify'));
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: `../../${path.basename(away)}`, platform: 'github' }, { name: 'web', path: '../web' }] }) });
    let r = yadLogged(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--pr', '7');
    assert.deepEqual(gitIn(away), [], 'no git ran in the clone outside the workspace');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /api \(\.\.\/\.\.\/[^)]+-elsewhere\): outside the workspace .* — yad runs no git there/);
    assert.equal(pinSpecKit(P, 'api', 'EP-l-S01', 'spec'), null);
    assert.equal(fs.existsSync(path.join(away, '.specify', 'feature.json')), false, 'nothing was written there');
    assert.deepEqual(gitIn(away), [], 'no git ran in the clone outside the workspace');
    // A clone kept inside the Product's own git folder.
    const hidden = path.join(P, '.git', 'hidden');
    initRepo(hidden);
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '.git/hidden', platform: 'github' }, { name: 'web', path: '../web' }] }) });
    r = yadLogged(P, 'build', 'ship', 'EP-l-S01', '--task', 'T01', '--repo', 'api', '--pr', '7');
    assert.deepEqual(gitIn(hidden), [], 'no git ran in the clone inside .git');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /api \(\.git\/hidden\): it runs through a \.git folder .* — yad runs no git there/);
    assert.deepEqual(gitIn(hidden), [], 'no git ran in the clone inside .git');
  } finally { fs.rmSync(W, { recursive: true, force: true }); fs.rmSync(away, { recursive: true, force: true }); }
});

test('the Spec Kit pin: the Product\'s own entry is its checkout, and a folder inside a checkout has none, as before (#217)', async () => {
  const { pinSpecKit } = await import('./build.mjs');
  const { W, P } = workspace();
  try {
    // A monorepo: api is the Product itself.
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '.' }, { name: 'web', path: 'apps/web' }] }) });
    fs.mkdirSync(path.join(P, '.specify'));
    fs.mkdirSync(path.join(P, 'apps', 'web', '.specify'), { recursive: true });
    assert.equal(pinSpecKit(P, 'api', 'EP-l-S01', 'spec').changed, true);
    assert.equal(read(path.join(P, '.specify', 'feature.json')).feature_directory, 'specs/EP-l-S01');
    // web is a folder inside the Product's checkout, with no .git of its own: not checked out, as before.
    assert.equal(pinSpecKit(P, 'web', 'EP-l-S01', 'spec'), null);
    assert.equal(fs.existsSync(path.join(P, 'apps', 'web', '.specify', 'feature.json')), false);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});
