// `yad worktree add|list|remove` (issue #115): one git worktree per epic, beside the Product and each code
// repo, so parallel agents never share a folder or a HEAD. The planners are tested with plain facts; the
// commands run against a real workspace — a Product and a code repo, each with a bare origin.
import './fixtures/git-quiet.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { worktreePath, planAdd, planRemove, YAD_LOCAL_FILES } from './worktree.mjs';
import { worktreeAt } from './worktree-record.mjs';
import { registryEntryFor, findProduct } from './find-product.mjs';
import { branchToCommitOn } from './productcommit.mjs';
import { run } from './lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const YAD = path.join(ROOT, 'bin/yad.mjs');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^GIT_(AUTHOR|COMMITTER)_/.test(k) && !/^(CI|GITLAB_CI|GITHUB_ACTIONS|SDLC_BASE|SDLC_HUB_CONFIG|SDLC_PRODUCT_CONFIG)$/.test(k) && !/^(CI_|GITHUB_)/.test(k)));
ENV.GIT_CONFIG_GLOBAL = '/dev/null';
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: ENV }).toString().trim();
const yad = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [YAD, ...args], { cwd, env: { ...ENV, PWD: cwd, YAD_NO_REPORT: '1', YAD_NO_UPDATE_CHECK: '1', NO_COLOR: '1' }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout, stderr: r.stderr };
};
const json = (r) => JSON.parse(r.stdout);

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function repoWithOrigin(W, name, files) {
  const dir = path.join(W, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'alice');
  git(dir, 'config', 'user.email', 'alice@corp.io');
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'seed');
  git(W, 'init', '-q', '--bare', '-b', 'main', `${name}.git`);
  git(dir, 'remote', 'add', 'origin', path.join(W, `${name}.git`));
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  return dir;
}

// A workspace: the Product (one epic naming api) and api (a package.json, an ignored node_modules).
function workspace({ product = {} } = {}) {
  const W = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-wt-')));
  fs.writeFileSync(path.join(W, '.yad-workspace.json'), JSON.stringify({ version: 1, product: 'product' }));
  const st = (id, type, status) => ({ id, type, artifact: 'epic.md', status, risk_tags: [] });
  const P = repoWithOrigin(W, 'product', {
    '.sdlc/product.json': JSON.stringify({ name: 'p', ...product }),
    '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }] }),
    'epics/EP-x/epic.md': '---\nid: EP-x\ntype: chore\nstatus: draft\nrepos: [api]\n---\n# EP-x\n',
    'epics/EP-x/.sdlc/state.json': JSON.stringify({ epicId: 'EP-x', profile: 'chore', currentStep: 'epic', steps: [st('epic', 'author', 'in_progress'), st('epic-review', 'review+approve', 'todo')] }),
    'epics/EP-x/.sdlc/approvals.json': '[]',
  });
  const api = repoWithOrigin(W, 'api', { 'package.json': '{}\n', '.gitignore': 'node_modules/\n', 'src/a.js': 'a\n' });
  write(api, { 'node_modules/dep/index.js': 'dep\n' });
  return { W, P, api, pwt: path.join(W, 'product--EP-x'), awt: path.join(W, 'api--EP-x') };
}

test('worktree planners: the path beside the checkout, the refusals, and yad\'s own files named apart (#115)', () => {
  assert.equal(worktreePath('/ws/product', 'EP-x'), path.join('/ws', 'product--EP-x'));
  const base = { main: '/ws/api', epic: 'EP-x', repo: 'api', hasOrigin: true, pathTaken: false, existing: null, mainIsLinked: false };
  assert.equal(planAdd(base).refuse, null);
  assert.match(planAdd({ ...base, existing: '/ws/api--EP-x' }).refuse.message, /already has a worktree for api/);
  assert.match(planAdd({ ...base, pathTaken: true }).refuse.message, /is already there/);
  assert.match(planAdd({ ...base, hasOrigin: false }).refuse.message, /no origin remote/);
  assert.match(planAdd({ ...base, mainIsLinked: true }).refuse.message, /itself a worktree/);
  assert.deepEqual(planRemove({ path: '/w' }), []);
  assert.equal(planRemove({ path: '/w', missing: true })[0].fix, 'run `git worktree prune` in the main checkout');
  const why = planRemove({ path: '/w', inside: true, locked: 'agent 2', busy: 'MERGE_HEAD', changes: ['a.js', ...YAD_LOCAL_FILES], unpushed: 2 });
  assert.equal(why.length, 6);
  assert.match(why.map((y) => y.reason).join('\n'), /you are inside it\nit is locked \(agent 2\)\na MERGE_HEAD is half done in it\n1 uncommitted or untracked file\(s\): a\.js\nyad's own working file\(s\) are there: \.specify\/feature\.json, \.gitmessage\n2 commit\(s\) are on no remote/);
  assert.match(why[4].fix, /safe to delete/);
});

test('yad worktree add --all, list and remove: beside each checkout, detached, node_modules linked, the main tree untouched (#115)', () => {
  const { W, P, api, pwt, awt } = workspace();
  try {
    let r = yad(P, 'worktree', 'add', 'EP-x', '--all', '--dry-run', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).worktrees.map((w) => [w.repo, w.path, w.added, w.links]), [[null, pwt, false, []], ['api', awt, false, ['node_modules']]]);
    assert.equal(fs.existsSync(pwt) || fs.existsSync(awt), false, 'a dry run makes nothing');

    r = yad(P, 'worktree', 'add', 'EP-x', '--all', '--json');
    assert.equal(r.code, 0, r.out);
    for (const [at, repo] of [[pwt, null], [awt, 'api']]) {
      const rec = worktreeAt(at);
      assert.deepEqual([rec.epic, rec.repo, rec.base], ['EP-x', repo, 'main']);
      assert.equal(git(at, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'detached');
      assert.equal(git(at, 'rev-parse', 'HEAD'), git(at, 'rev-parse', 'origin/main'));
    }
    assert.equal(fs.lstatSync(path.join(awt, 'node_modules')).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(awt, 'node_modules/dep/index.js'), 'utf8'), 'dep\n');
    assert.match(r.out, /node_modules is a link to the main checkout's — do not `npm install` in the worktree/);
    assert.match(r.out, /open each agent's session IN its worktree folder/);

    r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /YAD-STATE-010.*EP-x already has a worktree for api/s);

    r = yad(P, 'worktree', 'list', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).worktrees.map((w) => [w.epic, w.repo, w.branch, w.changes, w.unpushed, w.locked, w.missing]),
      [['EP-x', null, null, 0, 0, false, false], ['EP-x', 'api', null, 0, 0, false, false]], 'the node_modules link is not a change');

    r = yad(P, 'worktree', 'remove', 'EP-x', '--all', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).removed.map((x) => x.path), [pwt, awt]);
    assert.equal(fs.existsSync(pwt) || fs.existsSync(awt), false);
    assert.equal(fs.readFileSync(path.join(api, 'node_modules/dep/index.js'), 'utf8'), 'dep\n', 'only the link went');
    assert.equal(git(api, 'worktree', 'list').split('\n').length, 1);
    assert.equal(git(P, 'worktree', 'list').split('\n').length, 1);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree remove refuses, removing nothing, while a worktree holds work — and names yad\'s own files (#115)', () => {
  const { W, P, pwt, awt } = workspace();
  const refused = (re, cwd = P) => {
    const r = yad(cwd, 'worktree', 'remove', 'EP-x', '--all');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, re);
    assert.match(r.out, /nothing was removed/);
    assert.ok(fs.existsSync(pwt) && fs.existsSync(awt), 'both still there: one refusal removes nothing');
  };
  try {
    assert.equal(yad(P, 'worktree', 'add', 'EP-x', '--all').code, 0);
    write(awt, { 'new.txt': 'x\n' });
    refused(/1 uncommitted or untracked file\(s\): new\.txt; commit and push them, or `git -C .* stash -u`/);
    fs.rmSync(path.join(awt, 'new.txt'));
    write(awt, { 'src/a.js': 'changed\n' });
    refused(/1 uncommitted or untracked file\(s\): src\/a\.js/);
    git(awt, 'checkout', '--', 'src/a.js');
    write(awt, { '.gitmessage': 'Task:\n', '.specify/feature.json': '{}' });
    refused(/yad's own working file\(s\) are there: \.gitmessage, \.specify\/feature\.json; they are local state, safe to delete/);
    fs.rmSync(path.join(awt, '.gitmessage'));
    fs.rmSync(path.join(awt, '.specify'), { recursive: true });
    git(pwt, 'config', 'user.name', 'bob');
    git(pwt, 'config', 'user.email', 'bob@corp.io');
    write(pwt, { 'epics/EP-x/epic.md': '---\nid: EP-x\n---\n# edited\n' });
    git(pwt, 'commit', '-qam', 'edit');
    refused(/1 commit\(s\) are on no remote/);
    git(pwt, 'reset', '-q', '--hard', 'origin/main');
    git(P, 'worktree', 'lock', '--reason', 'agent 2 is here', pwt);
    refused(/it is locked \(agent 2 is here\)/);
    git(P, 'worktree', 'unlock', pwt);
    refused(/you are inside it; cd out of/, path.join(awt, 'src'));
    assert.equal(yad(P, 'worktree', 'remove', 'EP-x', '--all').code, 0);
    const r = yad(P, 'worktree', 'remove', 'EP-x');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no yad worktree for EP-x/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree: an epic that is not there, a repo not registered, and a repo with no origin are refused (#115)', () => {
  const { W, P, api } = workspace();
  try {
    let r = yad(P, 'worktree', 'add', 'EP-nope');
    assert.match(r.out, /no epic EP-nope on the Product/);
    r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'web');
    assert.match(r.out, /web is not a registered repo/);
    r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api', '--all');
    assert.match(r.out, /--repo and --all name different targets/);
    git(api, 'remote', 'remove', 'origin');
    r = yad(P, 'worktree', 'add', 'EP-x', '--all');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /api has no origin remote/);
    assert.equal(fs.existsSync(path.join(W, 'product--EP-x')), false, 'checked before any is made');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('from an epic\'s code worktree: the registry knows the repo, and Product commands go to the epic\'s Product worktree (#115)', () => {
  const { W, P, api, pwt, awt } = workspace();
  try {
    assert.equal(yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api').code, 0);
    assert.equal(registryEntryFor(P, path.join(awt, 'src'))?.meta?.name, 'api');
    assert.equal(findProduct(awt).root, P, 'no Product worktree yet: the main Product');
    assert.equal(yad(P, 'worktree', 'add', 'EP-x').code, 0);
    const found = findProduct(path.join(awt, 'src'));
    assert.deepEqual([found.root, found.worktree, found.repo?.name], [pwt, 'EP-x', 'api']);
    const r = yad(awt, 'worktree', 'list');
    assert.match(r.stderr, /Product: \.\.\/product--EP-x \(EP-x's worktree\)/);
    // A worktree yad did not make maps nothing: E80 review 3 still holds for it.
    git(api, 'worktree', 'add', '-q', '--detach', path.join(W, 'api-other'));
    assert.equal(registryEntryFor(P, path.join(W, 'api-other')), null);
    // Nor does a record copied into some other repo's worktree.
    const other = repoWithOrigin(W, 'other', { f: 'x\n' });
    git(other, 'worktree', 'add', '-q', '--detach', path.join(W, 'other--EP-x'));
    const gitDir = path.resolve(path.join(W, 'other--EP-x'), fs.readFileSync(path.join(W, 'other--EP-x', '.git'), 'utf8').match(/gitdir:\s*(.+)/)[1].trim());
    fs.writeFileSync(path.join(gitDir, 'yad-worktree.json'), JSON.stringify({ epic: 'EP-x', repo: 'api' }));
    assert.equal(registryEntryFor(P, path.join(W, 'other--EP-x')), null);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('default-branch commands: an epic Product worktree commits on the default branch; nothing else detached does (#115)', () => {
  const { W, P, pwt } = workspace();
  try {
    assert.equal(yad(P, 'worktree', 'add', 'EP-x').code, 0);
    const g = (root) => (...a) => run('git', a, { cwd: root });
    assert.equal(branchToCommitOn(pwt, g(pwt), 'main'), 'main');
    // A commit the default branch lacks: refused, so a step's unreviewed work never reaches it.
    git(pwt, 'config', 'user.name', 'bob');
    git(pwt, 'config', 'user.email', 'bob@corp.io');
    write(pwt, { 'notes.md': 'x\n' });
    git(pwt, 'add', 'notes.md');
    git(pwt, 'commit', '-qm', 'unreviewed');
    assert.equal(branchToCommitOn(pwt, g(pwt), 'main'), 'HEAD');
    git(pwt, 'reset', '-q', '--hard', 'origin/main');
    // Behind the default branch is fine: the push rebases.
    write(P, { 'later.md': 'y\n' });
    git(P, 'add', 'later.md');
    git(P, 'commit', '-qm', 'later');
    git(P, 'push', '-q', 'origin', 'main');
    assert.equal(branchToCommitOn(pwt, g(pwt), 'main'), 'main');
    // A detached main checkout is not an epic worktree: refused as before.
    git(P, 'switch', '-q', '--detach');
    assert.equal(branchToCommitOn(P, g(P), 'main'), 'HEAD');
    git(P, 'switch', '-q', 'main');

    // End to end: a Build record checkpointed from the worktree lands on origin/main.
    write(pwt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T01-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T01', repo: 'api', mergeCommit: 'abc', date: '2026-10-25' }) });
    let r = yad(pwt, 'checkpoint', '--push');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /pushed to origin\/main/);
    assert.match(git(path.join(W, 'product.git'), 'log', '-1', '--format=%s', 'main'), /sync Build state/);
    // On a step branch it is refused, as in the main checkout.
    git(pwt, 'switch', '-q', '-c', 'epic/EP-x');
    r = yad(pwt, 'checkpoint', '--push');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /on 'epic\/EP-x', not the default branch 'main'/);
    git(pwt, 'switch', '-q', '--detach', 'origin/main');
    write(pwt, { 'x.md': 'x\n' });
    git(pwt, 'add', 'x.md');
    git(pwt, 'commit', '-qm', 'unreviewed');
    write(pwt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T02-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T02', repo: 'api', mergeCommit: 'def', date: '2026-10-25' }) });
    r = yad(pwt, 'checkpoint', '--push');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /this epic worktree's HEAD has commits origin\/main does not/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad gate ci refuses to push from a named branch other than the default; a detached HEAD may (#115)', () => {
  const { W, P } = workspace({ product: { platform: 'github', git_url: 'https://github.com/acme/product', default_branch: 'main' } });
  try {
    git(P, 'switch', '-q', '-c', 'epic/EP-x');
    let r = yad(P, 'gate', 'ci', '--branch', 'review/EP-x/epic', '--pr', '1', '--merged');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /on 'epic\/EP-x', not the default branch 'main' — yad gate ci pushes HEAD to the default branch/);
    r = yad(P, 'gate', 'ci');
    assert.match(r.out, /on 'epic\/EP-x', not the default branch 'main'/, 'the sweep pushes too');
    git(P, 'switch', '-q', '--detach', 'main');
    r = yad(P, 'gate', 'ci', '--branch', 'review/EP-x/epic', '--pr', '1', '--merged');
    assert.doesNotMatch(r.out, /not the default branch/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad build step spec in_progress pins the epic\'s code worktree when there is one (#115)', () => {
  const { W, P, api, awt } = workspace();
  try {
    // A story whose stories review passed, so a lane can start.
    const st = (id, type, status) => ({ id, type, artifact: id.startsWith('stories') ? 'stories/' : 'epic.md', status, risk_tags: [] });
    write(P, {
      'epics/EP-x/.sdlc/state.json': JSON.stringify({ epicId: 'EP-x', profile: 'chore', currentStep: 'ready-for-build', steps: [st('epic', 'author', 'done'), st('epic-review', 'review+approve', 'done'), st('stories', 'author', 'done'), st('stories-review', 'review+approve', 'done')] }),
      'epics/EP-x/stories/EP-x-S01.md': '---\nid: EP-x-S01\nepic: EP-x\nstatus: approved\nrepos: [api]\n---\n# S01\n',
    });
    git(P, 'add', '-A');
    git(P, 'commit', '-qm', 'stories');
    git(P, 'push', '-q', 'origin', 'main');
    write(api, { '.specify/memory/constitution.md': '# c\n' });
    git(api, 'add', '.specify');
    git(api, 'commit', '-qm', 'spec kit');
    git(api, 'push', '-q', 'origin', 'main');
    assert.equal(yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api').code, 0);
    assert.equal(yad(P, 'build', 'start', 'EP-x-S01', '--repo', 'api').code, 0);
    const r = yad(P, 'build', 'step', 'EP-x-S01', '--repo', 'api', 'spec', 'in_progress', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).specKit, { file: 'api--EP-x/.specify/feature.json', featureDirectory: 'specs/EP-x-S01', changed: true });
    assert.equal(JSON.parse(fs.readFileSync(path.join(awt, '.specify/feature.json'), 'utf8')).feature_directory, 'specs/EP-x-S01');
    assert.equal(fs.existsSync(path.join(api, '.specify/feature.json')), false, 'the main checkout is left alone');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});
