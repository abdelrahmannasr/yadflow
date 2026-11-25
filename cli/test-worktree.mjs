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
import { worktreePath, planAdd, planRemove, YAD_LOCAL_FILES, yadWorktrees, runWorktreeAdd, runWorktreeList, runWorktreeRemove } from './worktree.mjs';
import { worktreeAt, linkedGitDir } from './worktree-record.mjs';
import { registryEntryFor, findProduct } from './find-product.mjs';
import { branchToCommitOn, isProductWorktree, YAD_COMMIT_SUBJECT, patchChanges, diffIsStatusOnly, diffAddsManagedIgnoreOnly, notYadsOwnAhead, parseRawLog, recheckBeforePush, epicOf } from './productcommit.mjs';
import { refreshIndexAfterWrite, INDEX_FILE } from './product-index.mjs';
import { run } from './lib.mjs';
import { commitAndPush } from './update-commit.mjs';
import { PACK_IGNORE_BLOCK } from './setup.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const YAD = path.join(ROOT, 'bin/yad.mjs');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^GIT_(AUTHOR|COMMITTER)_/.test(k) && !/^(CI|GITLAB_CI|GITHUB_ACTIONS|SDLC_BASE|SDLC_HUB_CONFIG|SDLC_PRODUCT_CONFIG)$/.test(k) && !/^(CI_|GITHUB_)/.test(k)));
ENV.GIT_CONFIG_GLOBAL = '/dev/null';
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: ENV }).toString().trim();
const yadWith = (env, cwd, ...args) => {
  const r = spawnSync(process.execPath, [YAD, ...args], { cwd, env: { ...ENV, ...env, PWD: cwd, YAD_NO_REPORT: '1', YAD_NO_UPDATE_CHECK: '1', NO_COLOR: '1' }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout, stderr: r.stderr };
};
const yad = (cwd, ...args) => yadWith({}, cwd, ...args);
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
  assert.deepEqual(planAdd(base), { path: path.join('/ws', 'api--EP-x'), skip: false, refuse: null });
  assert.deepEqual(planAdd({ ...base, existing: { path: '/ws/api--EP-x', missing: false } }), { path: '/ws/api--EP-x', skip: true, refuse: null }, 'a re-run goes on');
  assert.match(planAdd({ ...base, existing: { path: '/ws/api--EP-x', missing: true } }).refuse.hint, /git worktree prune/);
  assert.match(planAdd({ ...base, nested: true }).refuse.message, /kept inside the Product's folder/);
  assert.match(planAdd({ ...base, pathTaken: true }).refuse.message, /is already there/);
  assert.match(planAdd({ ...base, hasOrigin: false }).refuse.message, /no origin remote/);
  assert.match(planAdd({ ...base, mainIsLinked: true }).refuse.message, /itself a worktree/);
  assert.deepEqual(planRemove({ path: '/w' }), []);
  assert.equal(planRemove({ path: '/w', missing: true })[0].fix, 'run `git worktree prune` in the main checkout');
  assert.match(planRemove({ path: '/w', unpushed: null })[0].reason, /could not count/, 'unknown is not 0');
  const why = planRemove({ path: '/w', inside: true, locked: 'agent 2', busy: 'MERGE_HEAD', changes: ['a.js', ...YAD_LOCAL_FILES], unpushed: 2 });
  assert.equal(why.length, 6);
  assert.match(why.map((y) => y.reason).join('\n'), /you are inside it\nit is locked \(agent 2\)\na MERGE_HEAD is half done in it\n1 uncommitted or untracked file\(s\): a\.js\nyad's own working file\(s\) are there: \.specify\/feature\.json, \.gitmessage\n2 commit\(s\) are on no remote/);
  assert.match(why[4].fix, /safe to delete/);
});

test('worktree planners with a story: the folder is named after the story, an epic\'s path is as before, and planAdd refuses or skips with the story\'s path (EP-reported-agent-flow-S01)', () => {
  assert.equal(worktreePath('/ws/api', 'EP-x'), path.join('/ws', 'api--EP-x'), 'no story: as today');
  assert.equal(worktreePath('/ws/api', 'EP-x', null), path.join('/ws', 'api--EP-x'), 'story null: as today');
  assert.equal(worktreePath('/ws/api', 'EP-x', 'EP-x-S02'), path.join('/ws', 'api--EP-x-S02'));
  const base = { main: '/ws/api', epic: 'EP-x', story: 'EP-x-S02', repo: 'api', hasOrigin: true, pathTaken: false, existing: null, mainIsLinked: false };
  const at = path.join('/ws', 'api--EP-x-S02');
  assert.deepEqual(planAdd(base), { path: at, skip: false, refuse: null });
  assert.deepEqual(planAdd({ ...base, existing: { path: at, missing: false } }), { path: at, skip: true, refuse: null }, 'a re-run reuses the story\'s folder');
  const gone = planAdd({ ...base, existing: { path: at, missing: true } });
  assert.equal(gone.path, at);
  assert.match(gone.refuse.message, /^EP-x-S02's worktree for api is gone/);
  const taken = planAdd({ ...base, pathTaken: true });
  assert.equal(taken.path, at);
  assert.equal(taken.refuse.message, `${at} is already there`);
  assert.equal(planAdd({ ...base, hasOrigin: false }).path, at);
  assert.deepEqual(planAdd({ ...base, story: undefined }), { path: path.join('/ws', 'api--EP-x'), skip: false, refuse: null }, 'no story: the epic\'s path');
});

test('a worktree record with no story, a null story, or a story of its epic is yad\'s; a malformed or foreign-epic story is not (EP-reported-agent-flow-S01)', () => {
  const { W, api } = workspace();
  try {
    const wt = path.join(W, 'api--EP-x-S02');
    git(api, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    const rec = path.join(linkedGitDir(wt), 'yad-worktree.json');
    const put = (o) => fs.writeFileSync(rec, JSON.stringify({ epic: 'EP-x', repo: 'api', base: 'main', ...o }));
    const listed = () => yadWorktrees(api);
    put({});
    assert.equal(worktreeAt(wt)?.epic, 'EP-x', 'no story key: an epic worktree, as today');
    assert.equal('story' in worktreeAt(wt), false);
    assert.equal(listed().length, 1);
    put({ story: null });
    assert.equal(worktreeAt(wt)?.epic, 'EP-x', 'story null: an epic worktree');
    assert.equal(listed().length, 1);
    put({ story: 'EP-x-S02' });
    assert.deepEqual([worktreeAt(wt)?.epic, worktreeAt(wt)?.story], ['EP-x', 'EP-x-S02'], 'a good story');
    assert.deepEqual(listed().map((w) => [w.epic, w.story, w.path]), [['EP-x', 'EP-x-S02', wt]]);
    for (const bad of ['EP-x-02', 'EP-x', '', 'ep-x-S02', 'EP-x-S02 ', 7, true, {}, ['EP-x-S02']]) {
      put({ story: bad });
      assert.equal(worktreeAt(wt), null, `malformed story ${JSON.stringify(bad)}`);
      assert.deepEqual(listed(), [], `malformed story ${JSON.stringify(bad)} is skipped`);
    }
    for (const foreign of ['EP-y-S02', 'EP-xy-S01', 'EP-x-y-S01']) {
      put({ story: foreign });
      assert.equal(worktreeAt(wt), null, `a story of another epic: ${foreign}`);
      assert.deepEqual(listed(), [], `a story of another epic is skipped: ${foreign}`);
    }
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree add --all, list and remove: beside each checkout, detached, node_modules linked, the main tree untouched (#115)', () => {
  const { W, P, api, pwt, awt } = workspace();
  try {
    let r = yad(P, 'worktree', 'add', 'EP-x', '--all', '--dry-run', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).worktrees.map((w) => [w.repo, w.path, w.added, w.links, w.existing]), [[null, pwt, false, [], false], ['api', awt, false, ['node_modules'], false]]);
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

    // The link is never staged: `node_modules/` matches folders only, so yad excludes the link itself.
    assert.equal(git(awt, 'status', '--porcelain'), '');
    git(awt, 'add', '-A');
    assert.equal(git(awt, 'diff', '--cached', '--name-only'), '', 'git add -A stages nothing');

    r = yad(P, 'worktree', 'add', 'EP-x', '--all', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).worktrees.map((w) => [w.repo, w.added, w.existing]), [[null, false, true], ['api', false, true]], 'a re-run finds them there');

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

// Two stories of EP-x on the Product, each naming api, committed so the Product stays clean.
const readRecord = (at) => JSON.parse(fs.readFileSync(path.join(linkedGitDir(at), 'yad-worktree.json'), 'utf8'));
function withStories(P, stories = { 'EP-x-S01': '[api]', 'EP-x-S02': '[api]' }) {
  write(P, Object.fromEntries(Object.entries(stories).map(([id, repos]) => [`epics/EP-x/stories/${id}.md`, `---\nid: ${id}\nepic: EP-x\nrepos: ${repos}\n---\n# ${id}\n`])));
  git(P, 'add', '-A');
  git(P, 'commit', '-q', '-m', 'stories');
  git(P, 'push', '-q', 'origin', 'main');
}

test('yad worktree add, list and remove with a story: one folder per story, matched by story, reported with it; an epic\'s own as today (EP-reported-agent-flow-S01)', async () => {
  const { W, P, api, pwt, awt } = workspace();
  withStories(P);
  const s1 = path.join(W, 'api--EP-x-S01');
  const s2 = path.join(W, 'api--EP-x-S02');
  try {
    let r = await runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S01', dryRun: true });
    assert.deepEqual([r.epic, r.story, r.dryRun], ['EP-x', 'EP-x-S01', true]);
    assert.deepEqual(r.worktrees.map((w) => [w.repo, w.path, w.added, w.existing]), [['api', s1, false, false]], 'the story\'s repos, no Product');
    assert.equal(fs.existsSync(s1), false, 'a dry run makes nothing');

    r = await runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S01' });
    assert.deepEqual([r.epic, r.story], ['EP-x', 'EP-x-S01']);
    assert.deepEqual(r.worktrees.map((w) => [w.repo, w.path, w.added, w.links]), [['api', s1, true, ['node_modules']]]);
    const rec = worktreeAt(s1);
    assert.deepEqual([rec.epic, rec.story, rec.repo, rec.base], ['EP-x', 'EP-x-S01', 'api', 'main'], 'the record names the epic and the story');
    assert.equal(git(s1, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'detached');
    assert.equal(git(s1, 'rev-parse', 'HEAD'), git(s1, 'rev-parse', 'origin/main'));
    assert.equal(fs.lstatSync(path.join(s1, 'node_modules')).isSymbolicLink(), true);
    assert.equal(git(s1, 'status', '--porcelain'), '', 'the link is excluded');
    assert.equal(fs.existsSync(pwt), false, 'no Product worktree for a story');

    // An epic add does not reuse a story's worktree; it makes the epic's own, written as today.
    r = await runWorktreeAdd(P, { epic: 'EP-x', repo: 'api' });
    assert.equal(r.story, null);
    assert.deepEqual(r.worktrees.map((w) => [w.path, w.added]), [[awt, true]]);
    assert.equal('story' in worktreeAt(awt), false, 'an epic record has no story key');
    assert.deepEqual(Object.keys(readRecord(awt)).sort(), ['base', 'by', 'created', 'epic', 'links', 'repo']);
    // A second story gets a second folder: it reuses neither the epic's nor the first story's.
    r = await runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S02', repo: 'api' });
    assert.deepEqual(r.worktrees.map((w) => [w.path, w.added]), [[s2, true]]);
    assert.equal(worktreeAt(s2).story, 'EP-x-S02');
    r = await runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S01' });
    assert.deepEqual(r.worktrees.map((w) => [w.path, w.added, w.existing]), [[s1, false, true]], 'a re-run reuses its folder');
    r = await runWorktreeAdd(P, { epic: 'EP-x', repo: 'api' });
    assert.deepEqual(r.worktrees.map((w) => [w.path, w.added, w.existing]), [[awt, false, true]], 'an epic re-run reuses the epic\'s');

    r = await runWorktreeList(P, { epic: 'EP-x' });
    assert.deepEqual(r.worktrees.map((w) => [w.epic, w.story, w.repo, w.path]).sort((a, b) => a[3].localeCompare(b[3])),
      [['EP-x', null, 'api', awt], ['EP-x', 'EP-x-S01', 'api', s1], ['EP-x', 'EP-x-S02', 'api', s2]]);
    assert.deepEqual(Object.keys(r.worktrees[0]), ['epic', 'story', 'repo', 'path', 'branch', 'changes', 'unpushed', 'locked', 'missing'], 'story added; no field changed');
    const shown = yad(P, 'worktree', 'list');
    assert.match(shown.out, new RegExp(`EP-x {2}EP-x-S01 {2}api {2}${s1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'the story is on its line');
    assert.match(shown.out, new RegExp(`EP-x {2}api {2}${awt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'an epic line as today');

    // Remove without a story: only the epic's own, never a story's.
    r = await runWorktreeRemove(P, { epic: 'EP-x', all: true, cwd: W });
    assert.deepEqual([r.story, r.removed], [null, [{ repo: 'api', path: awt, story: null }]]);
    assert.ok(fs.existsSync(s1) && fs.existsSync(s2), 'the story worktrees stay');
    await assert.rejects(runWorktreeRemove(P, { epic: 'EP-x', repo: 'api', cwd: W }), /no yad worktree for EP-x in api/, 'the epic has none left of its own');

    // Remove with a story: only that story's.
    r = await runWorktreeRemove(P, { epic: 'EP-x', story: 'EP-x-S01', cwd: W });
    assert.deepEqual([r.epic, r.story, r.removed], ['EP-x', 'EP-x-S01', [{ repo: 'api', path: s1, story: 'EP-x-S01' }]]);
    assert.equal(fs.existsSync(s1), false);
    assert.equal(fs.existsSync(s2), true, 'the other story\'s stays');
    assert.equal(fs.lstatSync(path.join(s2, 'node_modules')).isSymbolicLink(), true);
    assert.equal(git(s2, 'status', '--porcelain'), '', 'the other story still has its exclude line');
    await assert.rejects(runWorktreeRemove(P, { epic: 'EP-x', story: 'EP-x-S01', cwd: W }), /no yad worktree for EP-x-S01/);
    write(s2, { 'new.txt': 'x\n' });
    await assert.rejects(runWorktreeRemove(P, { epic: 'EP-x', story: 'EP-x-S02', repo: 'api', cwd: W }), /EP-x-S02's worktree was not removed: 1 still holds work/, 'today\'s refusal rules');
    fs.rmSync(path.join(s2, 'new.txt'));
    r = await runWorktreeRemove(P, { epic: 'EP-x', story: 'EP-x-S02', repo: 'api', cwd: W });
    assert.deepEqual(r.removed.map((x) => x.path), [s2]);
    assert.equal(git(api, 'worktree', 'list').split('\n').length, 1);
    assert.equal(fs.readFileSync(path.join(api, 'node_modules/dep/index.js'), 'utf8'), 'dep\n', 'only the links went');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree add with a story is refused, making nothing, for a bad id, a story of another epic, a missing story file, --all, and a story naming no registered code repo (EP-reported-agent-flow-S01)', async () => {
  const { W, P, api } = workspace();
  withStories(P, { 'EP-x-S01': '[api]', 'EP-x-S03': '[web]', 'EP-x-S04': '[]' });
  try {
    const no = async (opts, re) => {
      await assert.rejects(runWorktreeAdd(P, { epic: 'EP-x', ...opts }), re, JSON.stringify(opts));
      if (opts.story !== true) await assert.rejects(runWorktreeRemove(P, { epic: 'EP-x', cwd: W, ...opts }), re, `remove ${JSON.stringify(opts)}`);
    };
    await no({ story: 'EP-x-02' }, /EP-x-02 is not a story id/);
    await no({ story: 'not a story' }, /is not a story id/);
    await no({ story: true }, /--story needs a story id/);
    await no({ story: '' }, /--story needs a story id/);
    await no({ story: 'EP-y-S01' }, /EP-y-S01 is a story of EP-y, not of EP-x/);
    await assert.rejects(runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S09' }), /no story EP-x-S09 in EP-x/);
    // remove does not need the story file (a retired story's worktree can still be removed): with none, it finds none.
    await assert.rejects(runWorktreeRemove(P, { epic: 'EP-x', story: 'EP-x-S09', cwd: W }), /no yad worktree for EP-x-S09/);
    await no({ story: 'EP-x-S01', all: true }, /--story and --all name different targets/);
    await assert.rejects(runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S03' }), /EP-x-S03 names no registered code repo/);
    await assert.rejects(runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S04' }), /EP-x-S04 names no registered code repo/);
    await assert.rejects(runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S03', repo: 'api' }), /api is not one of EP-x-S03's repos/);
    assert.equal(git(api, 'worktree', 'list').split('\n').length, 1, 'nothing was made');
    assert.equal(git(P, 'worktree', 'list').split('\n').length, 1, 'nothing was made');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree remove --story removes a story\'s worktree even when its story file is gone (EP-reported-agent-flow-S01)', async () => {
  const { W, P, api } = workspace();
  withStories(P, { 'EP-x-S02': '[api]' });
  const s2 = path.join(W, 'api--EP-x-S02');
  try {
    await runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S02' });
    assert.equal(fs.existsSync(s2), true);
    fs.rmSync(path.join(P, 'epics/EP-x/stories/EP-x-S02.md'));
    git(P, 'commit', '-q', '-am', 'retire EP-x-S02');
    await assert.rejects(runWorktreeAdd(P, { epic: 'EP-x', story: 'EP-x-S02' }), /no story EP-x-S02 in EP-x/, 'add still needs the file');
    const r = await runWorktreeRemove(P, { epic: 'EP-x', story: 'EP-x-S02', cwd: W });
    assert.deepEqual(r.removed, [{ repo: 'api', path: s2, story: 'EP-x-S02' }]);
    assert.equal(fs.existsSync(s2), false);
    assert.equal(git(api, 'worktree', 'list').split('\n').length, 1);
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

test('from an epic\'s code worktree: the registry knows the repo, and Product commands go to the epic\'s Product worktree (#115); a plain worktree is the repo too (#515)', () => {
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
    // A plain worktree yad did not make is api too (#515), worked in its own folder (E80 review 3).
    git(api, 'worktree', 'add', '-q', '--detach', path.join(W, 'api-other'));
    const plain = registryEntryFor(P, path.join(W, 'api-other', 'src'));
    assert.deepEqual([plain?.meta?.name, plain && fs.realpathSync(plain.top)], ['api', fs.realpathSync(path.join(W, 'api-other'))]);
    assert.equal(findProduct(path.join(W, 'api-other')).repo?.name, 'api', 'beside the Product, it finds it');
    // A `.git` file written by hand that points at api's worktree folder is not that worktree: git's back-link
    // names another folder.
    const wtGit = fs.readFileSync(path.join(W, 'api-other', '.git'), 'utf8');
    fs.mkdirSync(path.join(W, 'fake'));
    fs.writeFileSync(path.join(W, 'fake', '.git'), wtGit.replace(/gitdir:\s*(.+)/, (_, p) => `gitdir: ${path.resolve(path.join(W, 'api-other'), p.trim())}`));
    assert.equal(registryEntryFor(P, path.join(W, 'fake')), null, 'the back-link names api-other');
    // Nor a `.git` file pointing at yad's own epic worktree of api, with its record (#515 review 2).
    const awtGit = fs.readFileSync(path.join(awt, '.git'), 'utf8');
    fs.mkdirSync(path.join(W, 'fake-epic'));
    fs.writeFileSync(path.join(W, 'fake-epic', '.git'), awtGit.replace(/gitdir:\s*(.+)/, (_, p) => `gitdir: ${path.resolve(awt, p.trim())}`));
    assert.equal(registryEntryFor(P, path.join(W, 'fake-epic')), null, 'the back-link names api--EP-x');
    assert.equal(findProduct(path.join(W, 'fake-epic')).repo, undefined, 'and it borrows no repo from the workspace file');
    // A worktree of another clone of api is not the registered checkout.
    git(W, 'clone', '-q', path.join(W, 'api.git'), 'api-clone');
    git(path.join(W, 'api-clone'), 'worktree', 'add', '-q', '--detach', path.join(W, 'api-clone-wt'));
    assert.equal(registryEntryFor(P, path.join(W, 'api-clone-wt')), null, 'another clone');
    // Nor is a plain worktree of the Product a registered code repo.
    git(P, 'worktree', 'add', '-q', '--detach', path.join(W, 'product-plain'));
    assert.equal(registryEntryFor(P, path.join(W, 'product-plain')), null, 'never the Product\'s own entry');
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

test('default-branch commands: a plain detached Product worktree (no yad record) commits on the default branch; one with a commit not yad\'s own is refused (#597)', () => {
  const { W, P } = workspace({ product: { platform: 'github', git_url: 'https://github.com/acme/product', default_branch: 'main' } });
  try {
    const wt = path.join(W, 'product-build');
    git(P, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    assert.equal(worktreeAt(wt), null, 'git made it, not yad: no record');
    git(wt, 'config', 'user.name', 'bob');
    git(wt, 'config', 'user.email', 'bob@corp.io');
    const g = (root) => (...a) => run('git', a, { cwd: root });
    assert.equal(branchToCommitOn(wt, g(wt), 'main'), 'main', 'HEAD at the tip of origin/main');
    // End to end: a Build record checkpointed from it lands on origin/main.
    write(wt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T01-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T01', repo: 'api', mergeCommit: 'abc', date: '2026-10-25' }) });
    let r = yad(wt, 'checkpoint', '--push');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /pushed to origin\/main/);
    assert.match(git(path.join(W, 'product.git'), 'log', '-1', '--format=%s', 'main'), /sync Build state/);
    assert.equal(git(path.join(W, 'product.git'), 'for-each-ref', '--format=%(refname)', 'refs/heads/'), 'refs/heads/main', 'no branch named HEAD');
    // yad's own commit made without --push still counts, and the next run pushes it.
    write(wt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T02-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T02', repo: 'api', mergeCommit: 'def', date: '2026-10-25' }) });
    assert.equal(yad(wt, 'checkpoint').code, 0);
    assert.equal(branchToCommitOn(wt, g(wt), 'main'), 'main');
    write(wt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T05-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T05', repo: 'api', mergeCommit: 'bad', date: '2026-10-25' }) });
    r = yad(wt, 'checkpoint', '--push');
    assert.equal(r.code, 0, r.out);
    assert.equal(git(path.join(W, 'product.git'), 'rev-parse', 'main'), git(wt, 'rev-parse', 'HEAD'), 'both commits went up');
    // A commit that is not yad's own: refused, nothing pushed, and the hint is the worktree one.
    write(wt, { 'notes.md': 'x\n' });
    git(wt, 'add', 'notes.md');
    git(wt, 'commit', '-qm', 'unreviewed');
    assert.equal(branchToCommitOn(wt, g(wt), 'main'), 'HEAD');
    write(wt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T03-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T03', repo: 'api', mergeCommit: 'fed', date: '2026-10-25' }) });
    const head = git(path.join(W, 'product.git'), 'rev-parse', 'main');
    r = yad(wt, 'checkpoint', '--push');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /on 'HEAD', not the default branch 'main'/);
    assert.match(r.out, /this worktree's HEAD has commits origin\/main does not/);
    assert.doesNotMatch(r.out, /--allow-branch/);
    // gate ci there refuses it too.
    r = yad(wt, 'gate', 'ci');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a detached HEAD with commits of its own', not the default branch 'main'/);
    assert.equal(git(path.join(W, 'product.git'), 'rev-parse', 'main'), head, 'nothing reached origin/main');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('an amended yad commit that also carries a person\'s file is refused, names the file, and the hint moves it out; a plain checkpoint still pushes (#231)', () => {
  const { W, P } = workspace({ product: { platform: 'github', git_url: 'https://github.com/acme/product', default_branch: 'main' } });
  try {
    const wt = path.join(W, 'product-build');
    git(P, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    git(wt, 'config', 'user.name', 'bob');
    git(wt, 'config', 'user.email', 'bob@corp.io');
    const g = (...a) => run('git', a, { cwd: wt });
    const origin = path.join(W, 'product.git');
    // A plain yad checkpoint commit is yad's own: it still counts, and pushes.
    write(wt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T01-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T01', repo: 'api', mergeCommit: 'abc', date: '2026-10-25' }) });
    assert.equal(yad(wt, 'checkpoint').code, 0);
    assert.equal(branchToCommitOn(wt, g, 'main'), 'main');
    // The person amends it with an edit of their own: the subject is still yad's, the files are not.
    write(wt, { 'notes.md': 'mine\n' });
    git(wt, 'add', 'notes.md');
    git(wt, 'commit', '-q', '--amend', '--no-edit');
    assert.match(git(wt, 'log', '-1', '--format=%s'), YAD_COMMIT_SUBJECT);
    assert.equal(branchToCommitOn(wt, g, 'main'), 'HEAD');
    const head = git(origin, 'rev-parse', 'main');
    write(wt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T02-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T02', repo: 'api', mergeCommit: 'def', date: '2026-10-25' }) });
    let r = yad(wt, 'checkpoint', '--push');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /'notes\.md' is changed by the commits ahead of origin\/main, and yad does not write it/);
    assert.match(r.out, /git branch <branch>.*git reset --hard origin\/main.*git restore --worktree --source <branch> -- ':\(literal\)epics\/EP-x\/\.sdlc\/build-log\/EP-x-S01-T01-api\.json'.*yad checkpoint --push/);
    const restore = r.out.match(/`(git restore --worktree --source <branch> -- [^`]+)`/)[1].replace('<branch>', 'mine');
    r = yad(wt, 'gate', 'ci');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /'notes\.md' is changed by the commits ahead of origin\/main/);
    r = yad(wt, 'index');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /'notes\.md' is changed by the commits ahead of origin\/main/);
    assert.equal(git(origin, 'rev-parse', 'main'), head, 'nothing reached origin/main');
    // The hint, followed: every commit kept on a branch, HEAD back at the tip, yad's files back, and the push goes.
    git(wt, 'branch', 'mine');
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    execFileSync('sh', ['-c', restore], { cwd: wt, env: ENV });
    assert.equal(branchToCommitOn(wt, g, 'main'), 'main');
    r = yad(wt, 'checkpoint', '--push');
    assert.equal(r.code, 0, r.out);
    assert.equal(git(origin, 'rev-parse', 'main'), git(wt, 'rev-parse', 'HEAD'));
    assert.equal(git(origin, 'ls-tree', '--name-only', 'main', 'notes.md'), '', 'notes.md stayed off origin/main');
    assert.match(git(origin, 'ls-tree', '-r', '--name-only', 'main'), /EP-x-S01-T01-api\.json\n.*EP-x-S01-T02-api\.json/, 'both Build records went up');
    assert.equal(git(wt, 'ls-tree', '--name-only', 'mine', 'notes.md'), 'notes.md', 'and is kept on its branch');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('the files yad writes ride a yad commit: a status-only artifact flip and the managed .gitignore block; any other edit of them does not (#231)', () => {
  const { W, P } = workspace();
  try {
    const wt = path.join(W, 'product-build');
    git(P, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    git(wt, 'config', 'user.name', 'bob');
    git(wt, 'config', 'user.email', 'bob@corp.io');
    const g = (...a) => run('git', a, { cwd: wt });
    const yadCommit = (files) => {
      git(wt, 'reset', '-q', '--hard', 'origin/main');
      write(wt, files);
      git(wt, 'add', '-A');
      git(wt, 'commit', '-qm', 'chore(gate): advance EP-x/epic on merge [skip ci]');
      return branchToCommitOn(wt, g, 'main');
    };
    const ledgers = { 'epics/EP-x/.sdlc/state.json': '{}\n', '.sdlc/index.json': '{}\n', '.sdlc/repos.json': '{"repos":[]}\n', '.sdlc/code-context/api/code-map.md': '# api\n', 'epics/EP-x/reviews/epic.md': 'summary\n', 'foundation/.sdlc/state.json': '{}\n', 'foundation/reviews/foundation.md': 'summary\n' };
    assert.equal(yadCommit(ledgers), 'main', 'the ledgers, the index, the registry, the code-context and the review summaries');
    const epic = (status, title = 'EP-x') => ({ 'epics/EP-x/epic.md': `---\nid: EP-x\ntype: chore\nstatus: ${status}\nrepos: [api]\n---\n# ${title}\n` });
    assert.equal(yadCommit({ ...ledgers, ...epic('approved') }), 'main', 'a status-only flip of the epic');
    assert.equal(yadCommit(epic('approved', 'EP-x, edited')), 'HEAD', 'a flip with prose');
    assert.equal(yadCommit({ 'epics/EP-x/stories/EP-x-S01.md': '---\nstatus: approved\n---\n' }), 'HEAD', 'a new story file');
    assert.equal(yadCommit({ '.gitignore': `${PACK_IGNORE_BLOCK.join('\n')}\n` }), 'main', 'the managed ignore block');
    assert.equal(yadCommit({ '.gitignore': `${PACK_IGNORE_BLOCK.join('\n')}\n.env\n` }), 'HEAD', 'an ignore line of the person\'s');
    assert.equal(yadCommit({ 'epics/EP-x/notes.txt': 'x\n' }), 'HEAD', 'another file in the epic folder');
    assert.equal(yadCommit({ '.sdlc/product.json': JSON.stringify({ name: 'q' }) }), 'HEAD', 'the Product settings are not a file yad writes there');
    assert.equal(yadCommit({ '.sdlc/local-setup.json': '{}\n' }), 'HEAD', 'nor the team\'s setup steps');
    if (process.platform !== 'win32') {
      git(wt, 'reset', '-q', '--hard', 'origin/main');
      fs.symlinkSync('../../../.sdlc/product.json', path.join(wt, 'epics/EP-x/.sdlc/link.json'));
      git(wt, 'add', '-A');
      git(wt, 'commit', '-qm', 'chore(gate): advance EP-x/epic on merge [skip ci]');
      assert.equal(branchToCommitOn(wt, g, 'main'), 'HEAD', 'a symlink under a ledger folder');
    }
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('every commit ahead is judged, not their sum: a file in an earlier commit, one added then taken out, and a merge are refused; the hint is right for an earlier commit too (#231 review)', () => {
  const { W, P } = workspace();
  try {
    const wt = path.join(W, 'product-build');
    git(P, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    git(wt, 'config', 'user.name', 'bob');
    git(wt, 'config', 'user.email', 'bob@corp.io');
    const g = (...a) => run('git', a, { cwd: wt });
    const origin = path.join(W, 'product.git');
    const yadSubject = 'chore(product): sync Build state — EP-x/EP-x-S01 by bob [skip ci]';
    const ship = (t) => ({ [`epics/EP-x/.sdlc/build-log/EP-x-S01-${t}-api.json`]: JSON.stringify({ story: 'EP-x-S01', task: t, repo: 'api', mergeCommit: t, date: '2026-10-25' }) });
    // Added in one yad-subject commit, taken out in the next: the net change is clean, the history is not.
    write(wt, { 'notes.md': 'mine\n', ...ship('T01') });
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', yadSubject);
    git(wt, 'rm', '-q', 'notes.md');
    git(wt, 'commit', '-qm', yadSubject);
    assert.equal(git(wt, 'diff', '--name-only', 'origin/main...HEAD'), 'epics/EP-x/.sdlc/build-log/EP-x-S01-T01-api.json');
    assert.equal(branchToCommitOn(wt, g, 'main'), 'HEAD');
    // A merge commit in the range, even of yad's own commits.
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    git(wt, 'switch', '-q', '-c', 'side');
    write(wt, ship('T09'));
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', yadSubject);
    git(wt, 'switch', '-q', '--detach', 'origin/main');
    write(wt, ship('T08'));
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', yadSubject);
    git(wt, 'merge', '-q', '--no-ff', '-m', yadSubject, 'side');
    assert.equal(branchToCommitOn(wt, g, 'main'), 'HEAD');
    // A person's file in an EARLIER yad commit, a plain checkpoint commit after it.
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    write(wt, { 'notes.md': 'mine\n', ...ship('T01') });
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', yadSubject);
    write(wt, ship('T02'));
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', yadSubject); // as a checkpoint made before the person's file was there would be
    write(wt, ship('T03'));
    const head = git(origin, 'rev-parse', 'main');
    const r = yad(wt, 'checkpoint', '--push');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /'notes\.md' is changed by the commits ahead of origin\/main/);
    assert.equal(git(origin, 'rev-parse', 'main'), head);
    // Followed word for word, the hint keeps notes.md on its branch and every Build record goes up.
    const restore = r.out.match(/`(git restore --worktree --source <branch> -- [^`]+)`/)[1].replace('<branch>', 'mine');
    assert.doesNotMatch(restore, /notes\.md/);
    git(wt, 'branch', 'mine');
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    execFileSync('sh', ['-c', restore], { cwd: wt, env: ENV });
    const ok = yad(wt, 'checkpoint', '--push');
    assert.equal(ok.code, 0, ok.out);
    const tree = git(origin, 'ls-tree', '-r', '--name-only', 'main');
    for (const t of ['T01', 'T02', 'T03']) assert.match(tree, new RegExp(`EP-x-S01-${t}-api\\.json`), t);
    assert.doesNotMatch(tree, /notes\.md/);
    assert.equal(git(wt, 'ls-tree', '--name-only', 'mine', 'notes.md'), 'notes.md');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('every commit must carry yad\'s subject, an empty one too; a file is judged by its blobs, whatever its name or the pathspec setting; the run\'s own commit is judged before a push (#231 review 2)', () => {
  const { W, P } = workspace();
  try {
    const wt = path.join(W, 'product-build');
    git(P, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    git(wt, 'config', 'user.name', 'bob');
    git(wt, 'config', 'user.email', 'bob@corp.io');
    const g = (...a) => run('git', a, { cwd: wt });
    const yadSubject = 'chore(gate): advance EP-x/epic on merge [skip ci]';
    // A commit with an empty message is a commit whose subject is not yad's — alone, or under a yad commit.
    write(wt, { 'src/evil.js': 'steal()\n' });
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '--allow-empty-message', '-m', '');
    assert.deepEqual(notYadsOwnAhead(g, 'main', { fetch: false }), { subject: '' });
    write(wt, { 'epics/EP-x/.sdlc/x.json': '{}\n' });
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', yadSubject);
    assert.equal(branchToCommitOn(wt, g, 'main'), 'HEAD');
    // With literal pathspecs set in the person's environment, a prose edit is still refused and a status
    // flip still passes: no read here goes through a pathspec.
    const lit = (...a) => run('git', a, { cwd: wt, env: { ...ENV, GIT_LITERAL_PATHSPECS: '1' } });
    const epic = (status, title) => ({ 'epics/EP-x/epic.md': `---\nid: EP-x\ntype: chore\nstatus: ${status}\nrepos: [api]\n---\n# ${title}\n` });
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    write(wt, epic('draft', 'EP-x, edited'));
    git(wt, 'commit', '-qam', yadSubject);
    assert.equal(notYadsOwnAhead(lit, 'main', { fetch: false })?.file, 'epics/EP-x/epic.md');
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    write(wt, epic('approved', 'EP-x'));
    git(wt, 'commit', '-qam', yadSubject);
    assert.equal(notYadsOwnAhead(lit, 'main', { fetch: false }), null);
    // A file whose name is spelt in decomposed Unicode, which a path lookup under core.precomposeunicode misses.
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    const nfd = 'epics/EP-x/stories/Café.md';
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: wt, env: ENV, input: 'prose, not a status flip\n' }).toString().trim();
    git(wt, '-c', 'core.precomposeunicode=false', 'update-index', '--add', '--cacheinfo', `100644,${blob},${nfd}`);
    git(wt, '-c', 'core.precomposeunicode=false', 'commit', '-qm', yadSubject);
    git(wt, 'config', 'core.precomposeunicode', 'true');
    assert.deepEqual(notYadsOwnAhead(g, 'main', { fetch: false })?.files?.length, 1);
    git(wt, 'config', '--unset', 'core.precomposeunicode');
    // Every foreign file is named, and none of them is in the restore list.
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    write(wt, { 'notes.md': 'mine\n', 'other.txt': 'mine too\n', 'epics/EP-x/.sdlc/y.json': '{}\n' });
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', yadSubject);
    const why = notYadsOwnAhead(g, 'main', { fetch: false });
    assert.deepEqual(why.files, ['notes.md', 'other.txt']);
    assert.deepEqual(why.yadFiles, ['epics/EP-x/.sdlc/y.json']);
    // The last check before a push: a commit the run made that holds a person's file is not pushed.
    const code = process.exitCode;
    try {
      assert.equal(recheckBeforePush(wt, g, 'main'), false);
      assert.equal(process.exitCode, 1);
    } finally { process.exitCode = code; }
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    write(wt, { 'epics/EP-x/.sdlc/y.json': '{}\n' });
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', yadSubject);
    assert.equal(recheckBeforePush(wt, g, 'main'), true);
    assert.equal(recheckBeforePush(P, (...a) => run('git', a, { cwd: P }), 'main'), true, 'the main checkout on its branch is not judged here');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('after a refusal, the hint names `yad sync-status <epic>`, which writes again, uncommitted, a story status the reset dropped; only with a restore (#245)', () => {
  const { W, P } = workspace();
  try {
    const st = (id, type, status) => ({ id, type, artifact: id.startsWith('stories') ? 'stories/' : 'epic.md', status, risk_tags: [] });
    const state = (review) => JSON.stringify({ epicId: 'EP-x', profile: 'chore', currentStep: 'stories-review', steps: [st('epic', 'author', 'done'), st('epic-review', 'review+approve', 'done'), st('stories', 'author', 'done'), st('stories-review', 'review+approve', review)] });
    const story = (status, prose = '') => `---\nid: EP-x-S01\nepic: EP-x\nstatus: ${status}\nrepos: [api]\n---\n# S01\n${prose}`;
    write(P, { 'epics/EP-x/.sdlc/state.json': state('in_review'), 'epics/EP-x/stories/EP-x-S01.md': story('draft') });
    git(P, 'add', '-A');
    git(P, 'commit', '-qm', 'stories');
    git(P, 'push', '-q', 'origin', 'main');
    const wt = path.join(W, 'product-build');
    git(P, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    git(wt, 'config', 'user.name', 'bob');
    git(wt, 'config', 'user.email', 'bob@corp.io');
    // yad's advance carried the ledger and the story's status flip; the person's prose edit of the same story
    // rode in it, so the story file is not yad's, and the restore the hint gives leaves it out.
    write(wt, { 'epics/EP-x/.sdlc/state.json': state('done'), 'epics/EP-x/stories/EP-x-S01.md': story('approved', 'more prose\n') });
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', 'chore(gate): advance EP-x/stories on merge [skip ci]');
    const r = yad(wt, 'checkpoint', '--push');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /'epics\/EP-x\/stories\/EP-x-S01\.md' is changed by the commits ahead of origin\/main/);
    assert.match(r.out, /git reset --hard origin\/main.*git restore --worktree --source <branch> -- [^`]+`; then `yad sync-status EP-x`, which writes again a `status:` change the reset dropped — it stays uncommitted, and reaches 'main' with <branch> when that is reviewed and merged, so `git restore` it once <branch> carries it; then re-run/);
    // Followed word for word: the reset drops the flip, the restore brings the ledger back, and sync-status writes the flip again.
    const restore = r.out.match(/`(git restore --worktree --source <branch> -- [^`]+)`/)[1].replace('<branch>', 'mine');
    assert.doesNotMatch(restore, /stories/);
    git(wt, 'branch', 'mine');
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    execFileSync('sh', ['-c', restore], { cwd: wt, env: ENV });
    const storyFile = path.join(wt, 'epics/EP-x/stories/EP-x-S01.md');
    assert.match(fs.readFileSync(storyFile, 'utf8'), /status: draft/, 'the reset dropped the flip');
    const sync = r.out.match(/`yad (sync-status [^`]+)`/)[1].split(' ');
    const s = yad(wt, ...sync);
    assert.equal(s.code, 0, s.out);
    assert.equal(fs.readFileSync(storyFile, 'utf8'), story('approved'), 'the flip is back, without the person\'s prose');
    assert.match(git(wt, 'status', '--porcelain', '--', 'epics/EP-x/stories'), /^M epics\/EP-x\/stories\/EP-x-S01\.md$/, 'and left uncommitted, as the hint says');
    // Nothing of yad's to restore: no ledger to read anew, so no sync-status clause.
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    write(wt, { 'notes.md': 'mine\n' });
    git(wt, 'add', 'notes.md');
    git(wt, 'commit', '-qm', 'chore(gate): advance EP-x/stories on merge [skip ci]');
    const bare = yad(wt, 'checkpoint', '--push');
    assert.equal(bare.code, 1, bare.out);
    assert.match(bare.out, /'notes\.md' is changed by the commits ahead of origin\/main/);
    assert.doesNotMatch(bare.out, /git restore|sync-status/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('the epic named in the sync-status hint: one epic or the Product level, else none (#245)', () => {
  assert.equal(epicOf(['epics/EP-x/.sdlc/state.json', 'epics/EP-x/reviews/epic.md', '.sdlc/index.json']), 'EP-x', 'a root file names no epic');
  assert.equal(epicOf(['foundation/.sdlc/state.json']), 'EP-foundation');
  assert.equal(epicOf(['epics/EP-x/.sdlc/state.json', 'epics/EP-y/.sdlc/state.json']), null, 'two epics');
  assert.equal(epicOf(['epics/EP-x/.sdlc/state.json', 'foundation/.sdlc/state.json']), null);
  assert.equal(epicOf(['epics/not an id/.sdlc/state.json']), null, 'not an epic id');
  assert.equal(epicOf(['.sdlc/index.json']), null);
  assert.equal(epicOf([]), null);
});

test('yad update refuses a detached HEAD before it stages or commits, even with --allow-branch; the main checkout on main still pushes (#245)', () => {
  const { W, P } = workspace();
  // commitAndPush runs git in this process: keep the person's own git settings (a global ignore, signing) out.
  const realEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  const realLog = console.log;
  try {
    const wt = path.join(W, 'product-build');
    git(P, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    git(wt, 'config', 'user.name', 'bob');
    git(wt, 'config', 'user.email', 'bob@corp.io');
    const origin = path.join(W, 'product.git');
    const head = git(origin, 'rev-parse', 'main');
    const wtHead = git(wt, 'rev-parse', 'HEAD');
    write(wt, { '.claude/skills/x/SKILL.md': 'x\n' });
    const group = { root: wt, paths: ['.claude/skills/x/SKILL.md'], items: ['skill x'] };
    for (const opts of [{ push: true, allowBranch: true }, { push: true }, {}]) {
      const said = [];
      console.log = (...a) => said.push(a.map(String).join(' '));
      let r;
      try { r = commitAndPush(group, { ...opts, productRoot: wt, defaultBranch: 'main' }); } finally { console.log = realLog; }
      const out = said.join('\n');
      assert.deepEqual(r, { label: 'product', product: true, committed: false, pushed: false, skipped: true, error: false }, out);
      assert.match(out, /product: on a detached HEAD, not the default branch 'main' — skipped/, out);
      assert.equal(/--allow-branch cannot apply/.test(out), !!opts.allowBranch, out);
      assert.match(out, /run `yad update` from the main checkout on 'main'/, out);
      assert.doesNotMatch(out, /origin\/HEAD|committed/, out);
      assert.equal(git(wt, 'rev-parse', 'HEAD'), wtHead, 'nothing committed');
      assert.equal(git(wt, 'diff', '--cached', '--name-only'), '', 'nothing staged');
    }
    assert.equal(git(origin, 'rev-parse', 'main'), head, 'nothing reached origin/main');
    assert.equal(git(origin, 'for-each-ref', '--format=%(refname)', 'refs/heads/'), 'refs/heads/main', 'no branch named HEAD');
    // The main checkout on its default branch: the update goes up as before (the recheck there lets it pass).
    write(P, { '.claude/skills/x/SKILL.md': 'x\n' });
    const r = commitAndPush({ root: P, paths: ['.claude/skills/x/SKILL.md'], items: ['skill x'] }, { push: true, productRoot: P, defaultBranch: 'main' });
    assert.equal(r.pushed, true);
    assert.equal(git(origin, 'rev-parse', 'main'), git(P, 'rev-parse', 'HEAD'));
  } finally {
    console.log = realLog;
    for (const [k, v] of Object.entries(realEnv)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(W, { recursive: true, force: true });
  }
});

test('the raw log reader: commit ids, raw entries with their paths, and nothing else (#231 review 2)', () => {
  const z = '0'.repeat(40); const a = 'a'.repeat(40); const b = 'b'.repeat(40); const c = 'c'.repeat(40);
  const out = `\0${c}\0\n:100644 100644 ${a} ${b} M\0x.md\0:000000 120000 ${z} ${b} A\0.sdlc/l\0\0${a}\0\n`;
  assert.deepEqual(parseRawLog(out), [
    { commit: c, oldMode: '100644', newMode: '100644', oldBlob: a, newBlob: b, status: 'M', file: 'x.md' },
    { commit: c, oldMode: '000000', newMode: '120000', oldBlob: z, newBlob: b, status: 'A', file: '.sdlc/l' },
  ]);
  assert.equal(parseRawLog(`\0${c}\0gpg: Signature made\0`), null, 'a stray line');
  assert.equal(parseRawLog(`\0${c}\0\n:100644 100644 ${a} ${b} M\0`), null, 'an entry with no path');
  assert.equal(parseRawLog(`\n:100644 100644 ${a} ${b} M\0x\0`), null, 'an entry before any commit');
});

test('the -U0 patch reader: a content line `---` or `++x` is a change, not a header; status lines count only at column 0 inside the frontmatter (#231 review)', () => {
  const hdr = 'diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n';
  assert.deepEqual(patchChanges(`${hdr}@@ -3 +3 @@\n-status: draft\n+status: approved\n`), [{ sign: '-', text: 'status: draft', line: 3 }, { sign: '+', text: 'status: approved', line: 3 }]);
  assert.equal(diffIsStatusOnly(`${hdr}@@ -3 +3 @@\n-status: draft\n+status: approved\n`), true);
  assert.equal(diffIsStatusOnly(`${hdr}@@ -3 +3 @@\n-status: draft\n+status: approved\n`, { oldEnd: 5, newEnd: 5 }), true);
  assert.equal(diffIsStatusOnly(`${hdr}@@ -9 +9 @@\n-status: draft\n+status: approved\n`, { oldEnd: 5, newEnd: 5 }), false, 'a status line in the body');
  assert.equal(diffIsStatusOnly(`${hdr}@@ -3 +3 @@\n-  status: draft\n+  status: approved\n`), false, 'not at column 0');
  assert.equal(diffIsStatusOnly(`${hdr}@@ -3,2 +3 @@\n-status: draft\n----\n+status: approved\n`), false, 'the frontmatter close removed');
  assert.equal(diffIsStatusOnly(`${hdr}@@ -3 +3,2 @@\n-status: draft\n+status: approved\n+++x\n`), false, 'an added `++x`');
  assert.equal(patchChanges(`${hdr}@@ -3 +3,2 @@\n+status: approved\n`), null, 'counts that do not add up');
  // Two commits' patches of one file, read one after the other.
  assert.equal(patchChanges(`${hdr}@@ -3 +3 @@\n-a\n+b\n${hdr}@@ -3 +3 @@\n-b\n+c\n`).length, 4);
  const block = PACK_IGNORE_BLOCK.map((l) => `+${l}`).join('\n');
  assert.equal(diffAddsManagedIgnoreOnly(`${hdr}@@ -1,0 +2,${PACK_IGNORE_BLOCK.length} @@\n${block}\n`), true);
  assert.equal(diffAddsManagedIgnoreOnly(`${hdr}@@ -2 +1,0 @@\n-.env\n`), false, 'a removed line');
  assert.equal(diffAddsManagedIgnoreOnly(`${hdr}@@ -1,0 +2 @@\n+.env\n`), false, 'a line of the person\'s');
  assert.equal(diffAddsManagedIgnoreOnly(`${hdr}@@ -2 +1,0 @@\n----\n`), false, 'a removed `---` line, once read as a header');
});

test('a detached HEAD in the main Product checkout is refused, and --allow-branch (a push to a branch named HEAD) is not suggested (#597)', () => {
  const { W, P } = workspace();
  try {
    const g = (root) => (...a) => run('git', a, { cwd: root });
    // Even at the tip of origin/main.
    git(P, 'switch', '-q', '--detach');
    assert.equal(branchToCommitOn(P, g(P), 'main'), 'HEAD');
    write(P, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T04-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T04', repo: 'api', mergeCommit: 'cab', date: '2026-10-25' }) });
    let r = yad(P, 'checkpoint', '--push');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /on 'HEAD', not the default branch 'main'/);
    assert.match(r.out, /git switch main/);
    assert.doesNotMatch(r.out, /--allow-branch/);
    // A named branch still gets the --allow-branch hint, as before.
    git(P, 'switch', '-q', '-c', 'wip');
    r = yad(P, 'checkpoint', '--push');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /pass --allow-branch to override/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('--allow-branch never applies to a detached HEAD: refused before any commit, in the main checkout and in a worktree with a commit not yad\'s own (#597 review)', () => {
  const { W, P } = workspace();
  try {
    const shard = (dir, task) => write(dir, { [`epics/EP-x/.sdlc/build-log/EP-x-S01-${task}-api.json`]: JSON.stringify({ story: 'EP-x-S01', task, repo: 'api', mergeCommit: 'abc', date: '2026-10-25' }) });
    const refused = (dir) => {
      const before = git(dir, 'rev-parse', 'HEAD');
      const r = yad(dir, 'checkpoint', '--push', '--allow-branch');
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /--allow-branch cannot apply to a detached HEAD/);
      assert.doesNotMatch(r.out, /pushed to origin/);
      assert.equal(git(dir, 'rev-parse', 'HEAD'), before, 'no commit made, HEAD unmoved');
      assert.equal(git(path.join(W, 'product.git'), 'for-each-ref', '--format=%(refname)', 'refs/heads/'), 'refs/heads/main', 'no branch named HEAD');
    };
    git(P, 'switch', '-q', '--detach');
    shard(P, 'T01');
    refused(P);
    git(P, 'switch', '-q', 'main');
    const wt = path.join(W, 'product-build');
    git(P, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    git(wt, 'config', 'user.name', 'bob');
    git(wt, 'config', 'user.email', 'bob@corp.io');
    write(wt, { 'notes.md': 'x\n' });
    git(wt, 'add', 'notes.md');
    git(wt, 'commit', '-qm', 'unreviewed');
    shard(wt, 'T02');
    refused(wt);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('only a real linked worktree with no record, or the Product\'s record, counts: not a submodule kept at worktrees/<x>, not a damaged record (#597 review)', () => {
  const { W, P } = workspace();
  try {
    const g = (root) => (...a) => run('git', a, { cwd: root });
    // A Product kept as a submodule at `worktrees/prod`: its `.git` file points at
    // `.git/modules/worktrees/prod`, a folder named under `worktrees` with no `commondir`.
    const sup = path.join(W, 'super');
    fs.mkdirSync(sup);
    git(sup, 'init', '-q', '-b', 'main');
    git(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', path.join(W, 'product.git'), 'worktrees/prod');
    const sub = path.join(sup, 'worktrees', 'prod');
    assert.match(fs.readFileSync(path.join(sub, '.git'), 'utf8'), /modules\/worktrees\/prod/);
    git(sub, 'switch', '-q', '--detach', 'origin/main');
    assert.equal(isProductWorktree(sub), false);
    assert.equal(linkedGitDir(sub), null);
    assert.equal(branchToCommitOn(sub, g(sub), 'main'), 'HEAD', 'a submodule is not a worktree');
    // A plain linked worktree counts; with a record that cannot be read, or is not valid, it does not.
    const wt = path.join(W, 'product-build');
    git(P, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    assert.equal(isProductWorktree(wt), true);
    const rec = path.join(linkedGitDir(wt), 'yad-worktree.json');
    for (const bad of ['{not json', JSON.stringify({ epic: 'not-an-epic', repo: 'api' }), JSON.stringify({ epic: 'EP-x', repo: 7 })]) {
      fs.writeFileSync(rec, bad);
      assert.equal(isProductWorktree(wt), false, bad);
      assert.equal(branchToCommitOn(wt, g(wt), 'main'), 'HEAD', bad);
    }
    // A valid record naming a code repo does not count; the Product's own record does.
    fs.writeFileSync(rec, JSON.stringify({ epic: 'EP-x', repo: 'api' }));
    assert.equal(isProductWorktree(wt), false);
    fs.writeFileSync(rec, JSON.stringify({ epic: 'EP-x', repo: null }));
    assert.equal(isProductWorktree(wt), true);
    assert.equal(branchToCommitOn(wt, g(wt), 'main'), 'main');
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

test('yad worktree add --all makes nothing when one target cannot be fetched, and a repo inside the Product is refused (#115 review 1)', () => {
  const { W, P, api, pwt } = workspace();
  try {
    git(api, 'remote', 'set-url', 'origin', path.join(W, 'gone.git'));
    let r = yad(P, 'worktree', 'add', 'EP-x', '--all');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /could not fetch main for api/);
    assert.equal(fs.existsSync(pwt), false, 'the Product worktree was not made either');
    git(api, 'remote', 'set-url', 'origin', path.join(W, 'api.git'));
    assert.equal(yad(P, 'worktree', 'add', 'EP-x', '--all').code, 0, 'and a re-run makes both');
    // A code repo kept inside the Product's folder: its worktree could not find the Product.
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'inner', path: 'inner' }] }) });
    repoWithOrigin(P, 'inner', { f: 'x\n' });
    r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'inner');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /inner is kept inside the Product's folder/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('an epic Product worktree: yad\'s own unpushed commit is pushed by the next run; gate ci there refuses a step\'s commits (#115 review 1)', () => {
  const { W, P, pwt } = workspace({ product: { platform: 'github', git_url: 'https://github.com/acme/product', default_branch: 'main' } });
  try {
    assert.equal(yad(P, 'worktree', 'add', 'EP-x').code, 0);
    git(pwt, 'config', 'user.name', 'bob');
    git(pwt, 'config', 'user.email', 'bob@corp.io');
    write(pwt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T01-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T01', repo: 'api', mergeCommit: 'abc', date: '2026-10-25' }) });
    let r = yad(pwt, 'checkpoint');
    assert.equal(r.code, 0, r.out);
    // The next run, with something new, is not refused for that unpushed yad commit, and pushes both.
    write(pwt, { 'epics/EP-x/.sdlc/build-log/EP-x-S01-T02-api.json': JSON.stringify({ story: 'EP-x-S01', task: 'T02', repo: 'api', mergeCommit: 'def', date: '2026-10-25' }) });
    r = yad(pwt, 'checkpoint', '--push');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(git(path.join(W, 'product.git'), 'log', '-2', '--format=%s', 'main').split('\n').map((x) => /sync Build state/.test(x)), [true, true], 'the earlier commit went up too');
    // gate ci from the worktree with a step's commit on its detached HEAD: refused, nothing pushed.
    write(pwt, { 'epics/EP-x/epic.md': '---\nid: EP-x\n---\n# unreviewed\n' });
    git(pwt, 'commit', '-qam', 'author epic');
    const head = git(path.join(W, 'product.git'), 'rev-parse', 'main');
    r = yad(pwt, 'gate', 'ci');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a detached HEAD with commits of its own', not the default branch 'main'/);
    assert.equal(git(path.join(W, 'product.git'), 'rev-parse', 'main'), head);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree remove says which ignored files go with it (#115 review 1)', () => {
  const { W, P, awt } = workspace();
  try {
    assert.equal(yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api').code, 0);
    git(awt, 'config', 'user.name', 'bob');
    git(awt, 'config', 'user.email', 'bob@corp.io');
    fs.appendFileSync(path.join(awt, '.gitignore'), '.env\n');
    git(awt, 'commit', '-qam', 'ignore env');
    git(awt, 'push', '-q', 'origin', 'HEAD:refs/heads/ignore-env');
    write(awt, { '.env': 'SECRET=1\n' });
    const r = yad(P, 'worktree', 'remove', 'EP-x', '--repo', 'api');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /removed with it, as git ignores them: \.env/);
    assert.doesNotMatch(r.out, /removed with it, as git ignores them: .*node_modules/, 'yad\'s own link is not listed');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad\'s own commit is the exact subject yad writes — a revert of one, or a step\'s commit with the marker, is not (#115 review 2)', () => {
  for (const ok of ['chore(product): sync Build state — EP-x/EP-x-S01 by bob [skip ci]', 'chore(gate): repair epic state — close stranded author step(s) [skip ci]'])
    assert.ok(YAD_COMMIT_SUBJECT.test(ok), ok);
  for (const no of ['Revert "chore(product): sync Build state — x by y [skip ci]"', 'docs(ep-x): author epic [skip ci]', 'chore(product): sync Build state'])
    assert.equal(YAD_COMMIT_SUBJECT.test(no), false, no);
  const { W, P, pwt } = workspace();
  try {
    assert.equal(yad(P, 'worktree', 'add', 'EP-x').code, 0);
    git(pwt, 'config', 'user.name', 'bob');
    git(pwt, 'config', 'user.email', 'bob@corp.io');
    write(pwt, { 'notes.md': 'x\n' });
    git(pwt, 'add', 'notes.md');
    git(pwt, 'commit', '-qm', 'docs(ep-x): author epic [skip ci]');
    assert.equal(branchToCommitOn(pwt, (...a) => run('git', a, { cwd: pwt }), 'main'), 'HEAD');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('gate ci in an epic Product worktree with no default branch set still refuses a step\'s commits (#115 review 3)', () => {
  const { W, P, pwt } = workspace({ product: { platform: 'github', git_url: 'https://github.com/acme/product' } });
  try {
    assert.equal(yad(P, 'worktree', 'add', 'EP-x').code, 0);
    git(pwt, 'remote', 'set-head', 'origin', '-d');
    git(pwt, 'config', 'user.name', 'bob');
    git(pwt, 'config', 'user.email', 'bob@corp.io');
    write(pwt, { 'notes.md': 'x\n' });
    git(pwt, 'add', 'notes.md');
    git(pwt, 'commit', '-qm', 'docs(ep-x): author epic');
    const head = git(path.join(W, 'product.git'), 'rev-parse', 'main');
    const r = yad(pwt, 'gate', 'ci');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a detached HEAD with commits of its own', not the default branch 'main'/);
    assert.equal(git(path.join(W, 'product.git'), 'rev-parse', 'main'), head);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('the index refresh in an epic Product worktree asks no network: offline, it still rebuilds (#115 follow-up)', () => {
  const { W, P, pwt } = workspace();
  try {
    assert.equal(yad(P, 'worktree', 'add', 'EP-x').code, 0);
    git(pwt, 'remote', 'set-url', 'origin', path.join(W, 'gone.git')); // offline: every fetch fails
    const g = (...a) => run('git', a, { cwd: pwt });
    assert.equal(branchToCommitOn(pwt, g, 'main'), 'HEAD', 'a command that pushes still fetches first, and refuses');
    assert.equal(refreshIndexAfterWrite(pwt, null, { quiet: true }), true, 'a derived file is judged by the local origin/main');
    assert.equal(fs.existsSync(path.join(pwt, INDEX_FILE)), true);
    // A step's commit: the local ref says no, as the fetched one would.
    git(pwt, 'config', 'user.name', 'bob');
    git(pwt, 'config', 'user.email', 'bob@corp.io');
    git(pwt, 'add', INDEX_FILE);
    git(pwt, 'commit', '-qm', 'docs(ep-x): author epic');
    fs.rmSync(path.join(pwt, INDEX_FILE));
    assert.equal(refreshIndexAfterWrite(pwt, null), false);
    assert.equal(fs.existsSync(path.join(pwt, INDEX_FILE)), false);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree remove drops yad\'s exclude lines once no worktree of the repo has the link; a person\'s own line stays (#115 follow-up)', () => {
  const { W, P, api, awt } = workspace();
  try {
    write(P, {
      'epics/EP-y/epic.md': '---\nid: EP-y\ntype: chore\nstatus: draft\nrepos: [api]\n---\n# EP-y\n',
      'epics/EP-y/.sdlc/state.json': fs.readFileSync(path.join(P, 'epics/EP-x/.sdlc/state.json'), 'utf8').replace('"EP-x"', '"EP-y"'),
      'epics/EP-y/.sdlc/approvals.json': '[]',
    });
    git(P, 'add', '-A');
    git(P, 'commit', '-qm', 'EP-y');
    git(P, 'push', '-q', 'origin', 'main');
    const exclude = path.join(api, '.git/info/exclude');
    fs.appendFileSync(exclude, '/scratch\n');
    const mark = '# yad worktree (#115): the node_modules link\n/node_modules\n';
    assert.equal(yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api').code, 0);
    assert.equal(yad(P, 'worktree', 'add', 'EP-y', '--repo', 'api').code, 0);
    assert.equal(fs.readFileSync(exclude, 'utf8').split(mark).length, 2, 'the pair is written once, and shared');

    let r = yad(P, 'worktree', 'remove', 'EP-x', '--repo', 'api');
    assert.equal(r.code, 0, r.out);
    assert.match(fs.readFileSync(exclude, 'utf8'), /# yad worktree \(#115\)/, 'EP-y still has the link');
    assert.equal(git(path.join(W, 'api--EP-y'), 'status', '--porcelain'), '', 'so it is still never staged');

    r = yad(P, 'worktree', 'remove', 'EP-y', '--repo', 'api');
    assert.equal(r.code, 0, r.out);
    const left = fs.readFileSync(exclude, 'utf8');
    assert.doesNotMatch(left, /yad worktree|^\/node_modules$/m, 'the last link gone: so is the pair');
    assert.match(left, /^\/scratch$/m, 'the person\'s own line stays');
    assert.equal(fs.existsSync(awt) || fs.existsSync(path.join(W, 'api--EP-y')), false);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree add --all takes back what it made when git fails — also the half-made worktree git keeps (#115 follow-up)', { skip: process.platform === 'win32' && 'a sh hook' }, () => {
  const { W, P, api, pwt, awt } = workspace();
  try {
    // A second repo, last: api is made and linked before web fails.
    const web = repoWithOrigin(W, 'web', { 'package.json': '{}\n', '.gitignore': 'node_modules/\n' });
    write(P, {
      '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'web', path: '../web' }] }),
      'epics/EP-x/epic.md': '---\nid: EP-x\ntype: chore\nstatus: draft\nrepos: [api, web]\n---\n# EP-x\n',
    });
    // git keeps a worktree whose post-checkout hook fails, and still exits 1.
    write(web, { '.git/hooks/post-checkout': '#!/bin/sh\nexit 1\n' });
    fs.chmodSync(path.join(web, '.git/hooks/post-checkout'), 0o755);
    const r = yad(P, 'worktree', 'add', 'EP-x', '--all');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /git could not add .*web--EP-x[\s\S]*were taken back/);
    assert.equal(fs.existsSync(pwt) || fs.existsSync(awt), false, 'the worktrees made first are gone');
    assert.equal(fs.existsSync(path.join(W, 'web--EP-x')), false, 'and so is the one git kept');
    for (const at of [P, api, web]) assert.equal(git(at, 'worktree', 'list').split('\n').length, 1);
    assert.doesNotMatch(fs.readFileSync(path.join(api, '.git/info/exclude'), 'utf8'), /yad worktree/, 'api\'s exclude pair went with it');
    assert.equal(fs.readFileSync(path.join(api, 'node_modules/dep/index.js'), 'utf8'), 'dep\n', 'only the link went');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree remove puts the node_modules link back when git cannot remove the worktree (#115 follow-up)', { skip: process.platform === 'win32' && 'a sh shim for git' }, () => {
  const { W, P, api, awt } = workspace();
  try {
    assert.equal(yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api').code, 0);
    // A git that refuses `worktree remove` and runs everything else: yad's own checks all pass.
    const bin = path.join(W, 'bin');
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    write(bin, { git: `#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = remove ]; then echo 'fatal: refused by the test' >&2; exit 128; fi\nexec '${real}' "$@"\n` });
    fs.chmodSync(path.join(bin, 'git'), 0o755);
    let r = yadWith({ PATH: `${bin}${path.delimiter}${process.env.PATH}` }, P, 'worktree', 'remove', 'EP-x', '--repo', 'api');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /git could not remove .*api--EP-x: fatal: refused by the test/);
    assert.equal(fs.lstatSync(path.join(awt, 'node_modules')).isSymbolicLink(), true, 'the link is back');
    assert.equal(fs.readFileSync(path.join(awt, 'node_modules/dep/index.js'), 'utf8'), 'dep\n');
    assert.equal(worktreeAt(awt)?.epic, 'EP-x', 'still yad\'s worktree');
    assert.match(fs.readFileSync(path.join(api, '.git/info/exclude'), 'utf8'), /# yad worktree \(#115\)/, 'its exclude pair is kept');
    r = yad(P, 'worktree', 'remove', 'EP-x', '--repo', 'api');
    assert.equal(r.code, 0, r.out);
    assert.equal(fs.existsSync(awt), false);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('the add rollback never unlinks a node_modules symlink git tracks at origin/<default> (#115 follow-ups review 2)', { skip: process.platform === 'win32' && 'a sh hook and a tracked symlink' }, () => {
  const { W, P, api, awt } = workspace();
  try {
    // origin/main now tracks a node_modules symlink; the main checkout, not yet merged, has its ignored folder.
    const other = path.join(W, 'other');
    git(W, 'clone', '-q', path.join(W, 'api.git'), other);
    git(other, 'config', 'user.name', 'bob');
    git(other, 'config', 'user.email', 'bob@corp.io');
    fs.symlinkSync('src', path.join(other, 'node_modules'));
    git(other, 'add', 'node_modules');
    git(other, 'commit', '-qm', 'a tracked link');
    git(other, 'push', '-q', 'origin', 'main');
    const web = repoWithOrigin(W, 'web', { f: 'x\n' });
    write(P, {
      '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'web', path: '../web' }] }),
      'epics/EP-x/epic.md': '---\nid: EP-x\ntype: chore\nstatus: draft\nrepos: [api, web]\n---\n# EP-x\n',
    });
    write(web, { '.git/hooks/post-checkout': '#!/bin/sh\nexit 1\n' });
    fs.chmodSync(path.join(web, '.git/hooks/post-checkout'), 0o755);
    const r = yad(P, 'worktree', 'add', 'EP-x', '--all');
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /could not take back/);
    assert.equal(fs.existsSync(awt), false, 'api\'s worktree was taken back: its tracked link was left for git');
    for (const at of [P, api, web]) assert.equal(git(at, 'worktree', 'list').split('\n').length, 1);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

// #619: husky v9 points core.hooksPath at `.husky/_`, a folder its npm `prepare` makes (with a `.gitignore`
// of `*`) and a linked node_modules never remakes. The shape here is husky's: `_/pre-commit` relays to the
// tracked `.husky/pre-commit` beside it, found from `$0`, and that one logs the folder it ran in.
function husky(W, api, { ignored = true } = {}) {
  const log = path.join(W, 'hooks.log');
  write(api, { '.husky/pre-commit': `#!/bin/sh\npwd -P >> '${log}'\n` });
  git(api, 'add', '.husky');
  git(api, 'commit', '-qm', 'husky');
  git(api, 'push', '-q', 'origin', 'main');
  write(api, { '.husky/_/pre-commit': '#!/bin/sh\nexec sh -e "$(dirname "$(dirname "$0")")/pre-commit" "$@"\n', ...(ignored ? { '.husky/_/.gitignore': '*' } : {}) });
  fs.chmodSync(path.join(api, '.husky/_/pre-commit'), 0o755);
  git(api, 'config', 'core.hooksPath', '.husky/_');
  return log;
}
const ran = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');

test('yad worktree add links husky\'s ignored hooks folder, so the hooks run there; remove takes the link back (#619)', { skip: process.platform === 'win32' && 'sh hooks and symlinks' }, () => {
  const { W, P, api, awt } = workspace();
  try {
    const log = husky(W, api);
    let r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api', '--dry-run', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).worktrees[0].links, ['node_modules', '.husky/_'], '--dry-run lists the hooks link with the node_modules one');
    r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api');
    assert.equal(r.code, 0, r.out);
    assert.equal(fs.lstatSync(path.join(awt, '.husky/_')).isSymbolicLink(), true);
    assert.deepEqual(worktreeAt(awt).links, ['node_modules', '.husky/_'], 'recorded, so remove takes it back');
    assert.match(r.out, /api: node_modules is a link to the main checkout's/);
    assert.match(r.out, /\.husky\/_ \(git's core\.hooksPath\) is a link to the main checkout's hooks folder/);
    assert.match(r.out, /its git hooks run in the worktree too/);
    assert.doesNotMatch(r.out, /will not run/);
    assert.match(fs.readFileSync(path.join(api, '.git/info/exclude'), 'utf8'), /# yad worktree \(#619\): the git hooks link\n\/\.husky\/_\n/);
    assert.equal(git(awt, 'status', '--porcelain'), '', 'the link is never a change');
    git(awt, 'commit', '-q', '--allow-empty', '-m', 'x');
    assert.equal(ran(log).trim(), awt, 'the hook ran, in the worktree');
    git(awt, 'push', '-q', 'origin', 'HEAD:refs/heads/t');
    r = yad(P, 'worktree', 'remove', 'EP-x', '--repo', 'api');
    assert.equal(r.code, 0, r.out);
    assert.equal(fs.existsSync(awt), false);
    assert.equal(fs.existsSync(path.join(api, '.husky/_/pre-commit')), true, 'only the link went');
    assert.doesNotMatch(fs.readFileSync(path.join(api, '.git/info/exclude'), 'utf8'), /yad worktree/, 'and its exclude pair');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree add leaves a tracked or absolute hooksPath alone, refuses a link, and says when the hooks will not run (#619)', { skip: process.platform === 'win32' && 'sh hooks and symlinks' }, () => {
  const { W, P, api, awt } = workspace();
  const add = () => { const r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api', '--json'); assert.equal(r.code, 0, r.out); return r; };
  const remove = () => assert.equal(yad(P, 'worktree', 'remove', 'EP-x', '--repo', 'api').code, 0);
  try {
    // Tracked: the checkout has it, nothing new.
    write(api, { '.githooks/pre-commit': '#!/bin/sh\n' });
    git(api, 'add', '.githooks');
    git(api, 'commit', '-qm', 'hooks');
    git(api, 'push', '-q', 'origin', 'main');
    git(api, 'config', 'core.hooksPath', '.githooks');
    let r = add();
    assert.deepEqual(json(r).worktrees[0].links, ['node_modules']);
    assert.match(r.out, /its git hooks run in the worktree too/);
    assert.doesNotMatch(r.out, /will not run/);
    remove();

    // Absolute: every worktree finds the same folder, nothing new.
    husky(W, api);
    git(api, 'config', 'core.hooksPath', path.join(api, '.husky/_'));
    r = add();
    assert.deepEqual(json(r).worktrees[0].links, ['node_modules']);
    assert.equal(fs.existsSync(path.join(awt, '.husky/_')), false);
    assert.match(r.out, /its git hooks run in the worktree too/);
    remove();

    // A link in the main checkout is never followed: not linked, and the worktree is told its hooks are dead.
    fs.symlinkSync('.husky/_', path.join(api, 'hooks'));
    git(api, 'config', 'core.hooksPath', 'hooks');
    r = add();
    assert.deepEqual(json(r).worktrees[0].links, ['node_modules']);
    assert.match(r.out, /api: its git hooks will not run in the worktree — git's core\.hooksPath \(hooks\) is not there; point git at the main checkout's folder, which every worktree shares: `git -C '.*api' config core\.hooksPath '.*api\/hooks'`/);
    assert.doesNotMatch(r.out, /hooks run in the worktree too/);
    remove();
    fs.unlinkSync(path.join(api, 'hooks'));

    // Escaping the repo: never linked. The worktree sits beside the main checkout, so `../api/.husky/_` names
    // the main checkout's folder from both, and the hooks do run; `../nowhere` is missing from both: said.
    git(api, 'config', 'core.hooksPath', '../api/.husky/_');
    r = add();
    assert.deepEqual(json(r).worktrees[0].links, ['node_modules']);
    assert.match(r.out, /its git hooks run in the worktree too/);
    remove();
    git(api, 'config', 'core.hooksPath', '../nowhere');
    r = add();
    assert.deepEqual(json(r).worktrees[0].links, ['node_modules']);
    assert.match(r.out, /api: its git hooks will not run in the worktree — git's core\.hooksPath \(\.\.\/nowhere\) is not there; it is missing in the main checkout too/);
    assert.doesNotMatch(r.out, /hooks run in the worktree too/);
    remove();

    // An empty untracked folder git does not ignore as a whole: the person's, never linked (the shared exclude
    // line would hide the hooks they write there next), and the warning says it is empty there too.
    fs.mkdirSync(path.join(api, '.hooks'));
    git(api, 'config', 'core.hooksPath', '.hooks');
    r = add();
    assert.deepEqual(json(r).worktrees[0].links, ['node_modules']);
    assert.match(r.out, /api: its git hooks will not run in the worktree — git's core\.hooksPath \(\.hooks\) is not there; it is empty in the main checkout too, so no hook runs there either; to share the hooks you put there with every worktree: `git -C '.*api' config core\.hooksPath '.*api\/\.hooks'`/);
    assert.doesNotMatch(fs.readFileSync(path.join(api, '.git/info/exclude'), 'utf8'), /\.hooks/);
    remove();
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree add says husky\'s hooks will not run, with the fix, when its folder is not one git ignores (#619)', { skip: process.platform === 'win32' && 'sh hooks' }, () => {
  const { W, P, api, awt } = workspace();
  try {
    const log = husky(W, api, { ignored: false }); // git would add `.husky/_/pre-commit`: not yad's to link
    const r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'api', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).worktrees[0].links, ['node_modules']);
    assert.match(r.out, /api: its git hooks will not run in the worktree — git's core\.hooksPath \(\.husky\/_\) is not there; run `cd '.*api--EP-x' && npx husky`/);
    assert.doesNotMatch(r.out, /hooks run in the worktree too/);
    git(awt, 'commit', '-q', '--allow-empty', '-m', 'x');
    assert.equal(ran(log), '', 'as said: no hook ran');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('the add rollback takes back the hooks link and its exclude pair (#619)', { skip: process.platform === 'win32' && 'a sh hook and symlinks' }, () => {
  const { W, P, api, awt } = workspace();
  try {
    husky(W, api);
    const web = repoWithOrigin(W, 'web', { f: 'x\n' });
    write(P, {
      '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'web', path: '../web' }] }),
      'epics/EP-x/epic.md': '---\nid: EP-x\ntype: chore\nstatus: draft\nrepos: [api, web]\n---\n# EP-x\n',
    });
    write(web, { '.git/hooks/post-checkout': '#!/bin/sh\nexit 1\n' });
    fs.chmodSync(path.join(web, '.git/hooks/post-checkout'), 0o755);
    const r = yad(P, 'worktree', 'add', 'EP-x', '--all');
    assert.equal(r.code, 1, r.out);
    assert.equal(fs.existsSync(awt), false);
    assert.doesNotMatch(fs.readFileSync(path.join(api, '.git/info/exclude'), 'utf8'), /yad worktree/);
    assert.equal(fs.existsSync(path.join(api, '.husky/_/pre-commit')), true, 'only the link went');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

// #217: each registered folder is judged before any git runs in it, as E125 does for the other commands. A
// logging git first on PATH writes the folder each call runs in, as the disk spells it: a call in a link to
// api is logged as api.
function gitLogger(W) {
  const bin = path.join(W, 'bin');
  const log = path.join(W, 'git-calls.log');
  fs.mkdirSync(bin, { recursive: true });
  const realGit = execFileSync('sh', ['-c', 'command -v git']).toString().trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\t%s\\n' "$(pwd -P)" "$*" >> '${log}'\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  const env = { PATH: `${bin}${path.delimiter}${ENV.PATH}` };
  const gitIn = (dir) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').split('\n').filter((l) => l.startsWith(`${dir}\t`) || l.startsWith(`${dir}/`));
  return { env, gitIn, clear: () => fs.rmSync(log, { force: true }) };
}

test('yad worktree add, list and remove run no git in a registered folder reached through a link inside the Product, and say why (#217)', { skip: process.platform === 'win32' && 'a shell script as git, and symlinks' }, () => {
  const { W, P, api, awt } = workspace();
  try {
    const { env, gitIn, clear } = gitLogger(W);
    // A link the Product commits, to a real clone: it has a `.git`, so a bare existence test passed it.
    fs.symlinkSync('../api', path.join(P, 'evil'));
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'evil', path: 'evil' }] }) });
    const why = /evil \(evil\): reached through a link inside a repo's tree — yad runs no git there/;
    let r = yadWith(env, P, 'worktree', 'add', 'EP-x', '--repo', 'evil');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, why);
    assert.equal(fs.existsSync(path.join(P, 'evil--EP-x')), false, 'no worktree was made');
    assert.deepEqual(gitIn(api), [], 'no git ran in the linked clone');
    // The registered clone itself still works, by its own path.
    r = yadWith(env, P, 'worktree', 'add', 'EP-x', '--repo', 'api');
    assert.equal(r.code, 0, r.out);
    assert.ok(fs.existsSync(awt));
    clear();
    r = yadWith(env, P, 'worktree', 'list', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).worktrees.map((w) => [w.repo, w.path]), [['api', awt]], 'api\'s worktree is listed once, never again through the link');
    assert.deepEqual(json(r).skipped.map((s) => [s.repo, s.path]), [['evil', 'evil']]);
    assert.match(json(r).skipped[0].why, /reached through a link/);
    r = yadWith(env, P, 'worktree', 'remove', 'EP-x', '--repo', 'evil');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, why);
    assert.deepEqual(gitIn(api), [], 'list and remove ran no git in the main clone, nor through the link');
    r = yadWith(env, P, 'worktree', 'remove', 'EP-x', '--all', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).removed.map((x) => x.repo), ['api']);
    assert.deepEqual(json(r).skipped.map((s) => s.repo), ['evil']);
    assert.match(r.stderr, why);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree add, list and remove run no git in a registered folder shaped like a bare repo, and say why (#217)', { skip: process.platform === 'win32' && 'a shell script as git' }, () => {
  const { W, P } = workspace();
  try {
    const { env, gitIn } = gitLogger(W);
    const marker = path.join(W, 'fsmonitor-ran');
    const bare = path.join(P, 'bare');
    for (const d of ['objects', 'refs']) fs.mkdirSync(path.join(bare, d), { recursive: true });
    write(bare, { HEAD: 'ref: refs/heads/main\n', config: `[core]\n\tbare = true\n\tfsmonitor = touch '${marker}'\n` });
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'bare', path: 'bare' }] }) });
    const why = /bare \(bare\): a folder on its way holds an entry named HEAD, .* — yad runs no git there/;
    let r = yadWith(env, P, 'worktree', 'add', 'EP-x', '--repo', 'bare');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, why);
    r = yadWith(env, P, 'worktree', 'list', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).skipped.map((s) => s.repo), ['bare']);
    assert.match(r.stderr, why);
    r = yadWith(env, P, 'worktree', 'remove', 'EP-x', '--repo', 'bare');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, why);
    assert.deepEqual(gitIn(bare), [], 'no git ran in the bare-shaped folder');
    assert.equal(fs.existsSync(marker), false, 'its config never ran');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad worktree add, list and remove run no git in a registered clone outside the workspace, or one reached through a .git folder, and say why (#217)', { skip: process.platform === 'win32' && 'a shell script as git' }, () => {
  const { W, P } = workspace();
  // A real clone with an origin, beside the workspace folder, not in it: a bare existence test passed it.
  const outer = `${W}-elsewhere`;
  try {
    const { env, gitIn } = gitLogger(W);
    fs.mkdirSync(outer);
    const away = repoWithOrigin(outer, 'away', { f: 'x\n' });
    const hidden = repoWithOrigin(path.join(P, '.git'), 'hidden', { f: 'x\n' });
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'away', path: `../../${path.basename(outer)}/away` }, { name: 'hidden', path: '.git/hidden' }] }) });
    for (const [name, why] of [['away', /away \(\.\.\/\.\.\/[^)]+\/away\): outside the workspace .* — yad runs no git there/], ['hidden', /hidden \(\.git\/hidden\): it runs through a \.git folder .* — yad runs no git there/]]) {
      let r = yadWith(env, P, 'worktree', 'add', 'EP-x', '--repo', name);
      assert.deepEqual([...gitIn(away), ...gitIn(hidden)], [], `no git ran in ${name}`);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, why);
      r = yadWith(env, P, 'worktree', 'remove', 'EP-x', '--repo', name);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, why);
    }
    const r = yadWith(env, P, 'worktree', 'list', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).skipped.map((s) => s.repo), ['away', 'hidden']);
    assert.equal(fs.existsSync(path.join(outer, 'away--EP-x')), false, 'no worktree was made');
    assert.deepEqual(gitIn(away), [], 'no git ran in the clone outside the workspace');
    assert.deepEqual(gitIn(hidden), [], 'no git ran in the clone inside .git');
  } finally { fs.rmSync(W, { recursive: true, force: true }); fs.rmSync(outer, { recursive: true, force: true }); }
});

test('yad worktree: the Product\'s own entry and a folder inside a checkout are not acted on, as before (#217)', () => {
  const { W, P } = workspace();
  try {
    fs.mkdirSync(path.join(P, 'apps', 'web'), { recursive: true });
    write(P, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'api', path: '../api' }, { name: 'self', path: '.' }, { name: 'web', path: 'apps/web' }] }) });
    let r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'self');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /self is not a registered repo/, 'the Product\'s own entry: its worktree is the Product\'s');
    r = yad(P, 'worktree', 'add', 'EP-x', '--repo', 'web');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /web is not cloned here \(.*apps\/web\)/, 'a folder inside a checkout holds no worktrees of its own');
    r = yad(P, 'worktree', 'list', '--json');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(json(r).worktrees, [], 'nothing listed');
    assert.equal('skipped' in json(r), false, 'nothing skipped');
    assert.deepEqual(json(r).warnings, []);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});
