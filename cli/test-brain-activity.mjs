// E178: the live activity record (the hook), its wiring, and the live view's stream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const YAD = path.join(ROOT, 'bin', 'yad.mjs');
const HOOK = path.join(ROOT, 'skills/yad-checks/templates/hooks/yad-activity.mjs');
const GOLDEN = path.join(HERE, 'fixtures', 'golden-v3');

const hook = await import(HOOK);
const act = await import('./brain-activity.mjs');
const { viewModel, startBrainServer, snapshotHTML } = await import('./brain-view.mjs');
const { composeBrain, buildRepoGraph, writeBrain, GRAPHIFY_VERSION } = await import('./brain.mjs');
const { COMMAND_CLASS } = await import('./agent-rules.mjs');
const plan = await import('./plan.mjs');
const { ACTIVITY_ADAPTERS, activityAdapters, REPO_ACTIVITY_DEST } = await import('./manifest.mjs');
const { activityChecks } = await import('./doctor.mjs');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-activity-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const done = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const yad = (cwd, ...a) => spawnSync(process.execPath, [YAD, ...a], {
  cwd, encoding: 'utf8',
  env: { ...process.env, PATH: path.dirname(process.execPath), NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' },
});
// The same, with git on PATH too (a folder holding only a link to git), for a command that finds a git folder.
const GIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-activity-git-'));
process.on('exit', () => fs.rmSync(GIT_DIR, { recursive: true, force: true }));
if (process.platform !== 'win32') fs.symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), path.join(GIT_DIR, 'git'));
const yadGit = (cwd, ...a) => spawnSync(process.execPath, [YAD, ...a], {
  cwd, encoding: 'utf8',
  env: { ...process.env, PATH: [path.dirname(process.execPath), GIT_DIR].join(path.delimiter), NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' },
});
const realRun = (cmd, args = [], opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { ok: r.status === 0, code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
};

// A repo with the hook installed where it lands in a code repo: `<repo>/checks/yad-activity.mjs`.
function repoWithHook() {
  const repo = tmp();
  git(repo, 'init', '-q');
  put(path.join(repo, 'src', 'a.js'), '// a\n');
  fs.mkdirSync(path.join(repo, 'checks'));
  fs.copyFileSync(HOOK, path.join(repo, 'checks', 'yad-activity.mjs'));
  return repo;
}
const runHook = (repo, payload, format = 'claude') => spawnSync(process.execPath, [path.join(repo, 'checks', 'yad-activity.mjs'), '--format', format], {
  input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8',
});
const logOf = (repo) => {
  try { return fs.readFileSync(path.join(repo, '.git', hook.LOG_NAME), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};

// ---- the record --------------------------------------------------------------------------------------

test('recordOf keeps only the allowlisted fields: no pattern, no command text, no path outside the repo', () => {
  const root = tmp();
  try {
    put(path.join(root, 'src', 'a.js'), 'x');
    const at = Date.parse('2026-11-14T10:00:00Z');
    const r = (tool, input, extra = {}) => hook.recordOf({ session_id: 'sess', tool_name: tool, tool_input: input, prompt: 'secret prompt', ...extra }, { root, now: at });
    const read = r('Read', { file_path: path.join(root, 'src/a.js') });
    assert.deepEqual(read, { v: 1, ts: '2026-11-14T10:00:00.000Z', s: createHash('sha256').update('sess').digest('hex').slice(0, 12), h: 'claude', op: 'read', tool: 'Read', paths: ['src/a.js'] });
    assert.deepEqual(r('Grep', { pattern: 'password=hunter2', path: 'src' }).paths, ['src']);
    assert.equal(JSON.stringify(r('Grep', { pattern: 'password=hunter2', path: 'src' })).includes('hunter2'), false);
    assert.equal(r('Glob', { pattern: '**/*.env' }).op, 'search');
    assert.deepEqual(r('MultiEdit', { file_path: 'src/a.js', edits: [{ file_path: 'src/b.js' }, { file_path: '/etc/passwd' }] }).paths, ['src/a.js', 'src/b.js']);
    assert.deepEqual(r('NotebookEdit', { notebook_path: 'n.ipynb' }).paths, ['n.ipynb']);
    for (const bad of ['/etc/passwd', '../outside.js', 'src/../../x', path.join(os.tmpdir(), 'x')]) assert.deepEqual(r('Read', { file_path: bad }).paths, [], bad);
    const run = r('Bash', { command: 'curl https://example.com/?token=abc && yad ship' });
    assert.deepEqual(Object.keys(run).sort(), ['h', 'op', 'paths', 's', 'tool', 'ts', 'v']);
    assert.equal(r('Bash', { command: 'yad ship --task T01' }).yad, 'ship');
    assert.equal(r('Bash', { command: 'npx yad brain query "private name"' }).yad, 'brain query');
    assert.equal(r('Bash', { command: 'yad brain notathing' }).yad, 'brain');
    assert.equal(r('Bash', { command: 'yad not-a-command x' }).yad, undefined);
    assert.equal(r('WebFetch', { url: 'https://x' }), null, 'a tool the view does not draw is not recorded');
    assert.equal(r('Read', {}, { session_id: undefined }).s, null);
    const many = r('MultiEdit', { edits: Array.from({ length: 40 }, (_, i) => ({ file_path: `f${i}.js` })) });
    assert.equal(many.paths.length, hook.MAX_PATHS);
    // Cursor: an edit and a shell command, its session from conversation_id.
    const cur = hook.recordOf({ conversation_id: 'c', hook_event_name: 'afterFileEdit', file_path: path.join(root, 'src/a.js'), edits: [] }, { root, now: at, format: 'cursor' });
    assert.equal(cur.op, 'edit');
    assert.equal(cur.h, 'cursor');
    assert.deepEqual(cur.paths, ['src/a.js']);
    const curRun = hook.recordOf({ conversation_id: 'c', hook_event_name: 'afterShellExecution', command: 'yad check --fix', output: 'SECRET OUTPUT' }, { root, now: at, format: 'cursor' });
    assert.equal(curRun.yad, 'check');
    assert.equal(JSON.stringify(curRun).includes('SECRET'), false);
    assert.equal(hook.recordOf({ hook_event_name: 'beforeReadFile', file_path: 'x' }, { root, format: 'cursor' }), null);
    assert.equal(hook.recordOf('not an object', { root }), null);
  } finally { done(root); }
});

test('a path through a link that leaves the repo is dropped; a line is at most 4 KB', () => {
  const root = tmp();
  const outside = tmp();
  try {
    put(path.join(outside, 'secret.txt'), 'x');
    fs.symlinkSync(outside, path.join(root, 'linked'));
    assert.deepEqual(hook.recordOf({ tool_name: 'Read', tool_input: { file_path: 'linked/secret.txt' } }, { root, realRoot: root }).paths, []);
    const rec = { v: 1, ts: 'x', s: null, h: 'claude', op: 'edit', tool: 'Edit', paths: Array.from({ length: 20 }, (_, i) => `${'d'.repeat(300)}/${i}.js`) };
    const line = hook.lineOf(rec);
    assert.ok(Buffer.byteLength(line) <= hook.MAX_LINE);
    assert.ok(JSON.parse(line).paths.length < 20 && JSON.parse(line).paths.length > 0);
  } finally { done(root, outside); }
});

test('the hook knows every yad command, and only yad\'s', () => {
  assert.deepEqual([...hook.YAD_COMMANDS].sort(), Object.keys(COMMAND_CLASS).sort(),
    'move YAD_COMMANDS in skills/yad-checks/templates/hooks/yad-activity.mjs with COMMAND_CLASS');
});

test('the hook as the harness runs it: one line per call, exit 0 and silent on anything, rotated at 5 MB', () => {
  const repo = repoWithHook();
  try {
    const r = runHook(repo, { session_id: 's', tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src/a.js') } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'nothing on stdout, ever');
    assert.deepEqual(logOf(repo).map((x) => [x.op, x.paths]), [['edit', ['src/a.js']]]);
    for (const bad of ['not json', '', '[]', JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } })]) {
      const b = runHook(repo, bad);
      assert.equal(b.status, 0, bad);
      assert.equal(b.stdout, '', bad);
    }
    assert.equal(logOf(repo).length, 2, 'the bad JSON wrote nothing; the outside path wrote a line with no path');
    assert.deepEqual(logOf(repo)[1].paths, []);
    // Rotation: a full log is renamed aside, and the new line starts a new file.
    fs.writeFileSync(path.join(repo, '.git', hook.LOG_NAME), `${'x'.repeat(hook.ROTATE_AT - 10)}\n`);
    runHook(repo, { tool_name: 'Read', tool_input: { file_path: 'src/a.js' } });
    assert.ok(fs.statSync(path.join(repo, '.git', hook.OLD_LOG_NAME)).size > hook.ROTATE_AT - 100);
    assert.equal(logOf(repo).length, 1);
    // A read-only git folder: the call still goes through, with at most one line on stderr.
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      fs.rmSync(path.join(repo, '.git', hook.LOG_NAME));
      fs.chmodSync(path.join(repo, '.git'), 0o555);
      try {
        const ro = runHook(repo, { tool_name: 'Read', tool_input: { file_path: 'src/a.js' } });
        assert.equal(ro.status, 0);
        assert.equal(ro.stdout, '');
        assert.ok(ro.stderr.split('\n').filter(Boolean).length <= 1);
      } finally { fs.chmodSync(path.join(repo, '.git'), 0o755); }
    }
  } finally { done(repo); }
});

test('in a worktree the record goes to the shared git folder; outside git, nowhere', () => {
  const repo = repoWithHook();
  const wt = path.join(tmp(), 'wt');
  const loose = tmp();
  try {
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'worktree', 'add', '-q', wt);
    fs.mkdirSync(path.join(wt, 'checks'), { recursive: true });
    fs.copyFileSync(HOOK, path.join(wt, 'checks', 'yad-activity.mjs'));
    runHook(wt, { tool_name: 'Read', tool_input: { file_path: 'src/a.js' } });
    assert.equal(logOf(repo).length, 1, 'written to the main repo\'s .git, which every worktree shares');
    fs.mkdirSync(path.join(loose, 'checks'));
    fs.copyFileSync(HOOK, path.join(loose, 'checks', 'yad-activity.mjs'));
    const r = runHook(loose, { tool_name: 'Read', tool_input: { file_path: 'x' } });
    assert.equal(r.status, 0);
    assert.deepEqual(fs.readdirSync(loose), ['checks']);
  } finally { done(repo, path.dirname(wt), loose); }
});

// ---- reading it back ---------------------------------------------------------------------------------

test('parseRecord trusts nothing it reads; the backlog is the last two weeks, oldest first, capped', () => {
  assert.equal(act.parseRecord('{"v":2,"op":"read","ts":"2026-01-01T00:00:00Z"}'), null);
  assert.equal(act.parseRecord('{"v":1,"op":"delete","ts":"2026-01-01T00:00:00Z"}'), null);
  assert.equal(act.parseRecord('{"v":1,"op":"read","ts":"never"}'), null);
  assert.equal(act.parseRecord('nope'), null);
  const r = act.parseRecord(JSON.stringify({ v: 1, op: 'read', ts: '2026-11-14T00:00:00Z', s: 'not-hex', h: 'x', tool: 'Read', paths: ['ok.js', '/abs', '../up', 7, 'a/../b'], yad: 'ship; rm -rf', extra: 'dropped' }));
  assert.deepEqual(r, { t: Date.parse('2026-11-14T00:00:00Z'), op: 'read', s: null, h: 'claude', tool: 'Read', paths: ['ok.js'] });
  const dir = tmp();
  try {
    const now = Date.parse('2026-11-14T12:00:00Z');
    const line = (t, op = 'read') => `${JSON.stringify({ v: 1, op, ts: new Date(t).toISOString(), paths: [] })}\n`;
    fs.writeFileSync(path.join(dir, act.OLD_LOG_NAME), line(now - 20 * 86400000) + line(now - 3000));
    fs.writeFileSync(path.join(dir, act.LOG_NAME), line(now - 1000, 'edit') + 'garbage\n' + line(now - 2000, 'search'));
    const b = act.readBacklog([{ repo: 'be', dir, prefixes: [] }], { now });
    assert.deepEqual(b.map((x) => x.r.op), ['read', 'search', 'edit'], 'two weeks only, by time, across the rotated file');
    assert.equal(act.readBacklog([{ repo: 'be', dir, prefixes: [] }], { now, limit: 2 }).length, 2);
  } finally { done(dir); }
});

test('follow reads each new whole line, keeps a part line, and starts over after a rotation', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, act.LOG_NAME);
    const line = (op) => `${JSON.stringify({ v: 1, op, ts: new Date().toISOString(), paths: [] })}\n`;
    fs.writeFileSync(file, line('read'));
    const got = [];
    const f = act.follow({ repo: null, dir, prefixes: [] }, (src, r) => got.push(r.op), { watch: () => {}, unwatch: () => {} });
    f.pump();
    assert.deepEqual(got, [], 'what was there before is the backlog\'s');
    const half = line('edit');
    fs.appendFileSync(file, half.slice(0, 10));
    f.pump();
    assert.deepEqual(got, []);
    fs.appendFileSync(file, half.slice(10) + line('search'));
    f.pump();
    assert.deepEqual(got, ['edit', 'search']);
    fs.renameSync(file, path.join(dir, act.OLD_LOG_NAME));
    fs.writeFileSync(file, line('run'));
    f.pump();
    assert.deepEqual(got, ['edit', 'search', 'run']);
    f.stop();
  } finally { done(dir); }
});

// ---- matching ------------------------------------------------------------------------------------------

const MODEL = viewModel({
  format: 'yad-brain-1', inputs: 'sha256:x',
  nodes: [
    { id: 'epic:EP-a', kind: 'epic', label: 'A' }, { id: 'story:EP-a-S01', kind: 'story', label: 'S01' }, { id: 'contract:EP-a', kind: 'contract', label: 'c' },
    { id: 'task:EP-a-S01:be:T01', kind: 'task', label: 'T01' }, { id: 'repo:be', kind: 'repo', label: 'be' },
    { id: 'file:be:src/a.js', kind: 'file', label: 'src/a.js', repo: 'be' }, { id: 'file:be:src/b.js', kind: 'file', label: 'src/b.js', repo: 'be' },
    { id: 'code:be:a', kind: 'code', label: 'a()', repo: 'be', file: 'src/a.js' },
  ],
  edges: [
    { source: 'epic:EP-a', target: 'story:EP-a-S01', relation: 'has-story', confidence: 'EXTRACTED' },
    { source: 'story:EP-a-S01', target: 'task:EP-a-S01:be:T01', relation: 'has-task', confidence: 'EXTRACTED' },
    { source: 'task:EP-a-S01:be:T01', target: 'file:be:src/a.js', relation: 'declares-file', confidence: 'EXTRACTED' },
    { source: 'file:be:src/a.js', target: 'code:be:a', relation: 'defines', confidence: 'EXTRACTED' },
  ],
});
const id = (i) => MODEL.nodes[i].id;

test('matchEvent: a repo file and its code, a Product work file, a searched folder, a path outside the brain', () => {
  const index = act.activityIndex(MODEL);
  const ev = (src, paths, op = 'read') => act.matchEvent(index, src, { t: 1, op, s: null, h: 'claude', tool: 'Read', paths });
  const be = { repo: 'be', dir: '/x', prefixes: [] };
  const product = { repo: null, dir: '/p', prefixes: [{ repo: 'be', prefix: 'repos/be/' }] };
  const a = ev(be, ['src/a.js']);
  assert.deepEqual(a.hits.map((h) => [h.path, id(h.node), h.code.map(id)]), [['be/src/a.js', 'file:be:src/a.js', ['code:be:a']]]);
  assert.deepEqual(ev(product, ['epics/EP-a/stories/EP-a-S01.md', 'epics/EP-a/contract.md', 'epics/EP-a/epic.md']).hits.map((h) => id(h.node)),
    ['story:EP-a-S01', 'contract:EP-a', 'epic:EP-a']);
  assert.deepEqual(ev(product, ['repos/be/src/b.js']).hits.map((h) => id(h.node)), ['file:be:src/b.js'], 'a code repo inside the Product folder');
  const folder = ev(be, ['src'], 'search');
  assert.deepEqual(folder.areas.map((x) => [x.path, x.nodes.map(id).sort()]), [['be/src', ['file:be:src/a.js', 'file:be:src/b.js']]]);
  assert.deepEqual(folder.outside, []);
  assert.deepEqual(ev(be, ['README.md']).outside, ['be/README.md']);
  assert.deepEqual(ev(product, ['notes.md']).outside, ['notes.md']);
  assert.equal(ev(be, ['srcx']).areas.length, 0, 'a folder is matched on its whole name');
});

test('planOf: each task with its story and declared files', () => {
  assert.deepEqual(act.planOf(MODEL).map((p) => [id(p.task), id(p.story), p.files.map(id)]), [['task:EP-a-S01:be:T01', 'story:EP-a-S01', ['file:be:src/a.js']]]);
});

// ---- wiring ------------------------------------------------------------------------------------------

function wiredProduct({ activity }) {
  const ws = tmp();
  const root = path.join(ws, 'product');
  fs.cpSync(GOLDEN, root, { recursive: true });
  const cfg = path.join(root, '.sdlc', 'hub.json');
  const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  j.activity = activity;
  fs.writeFileSync(cfg, JSON.stringify(j, null, 2));
  return { ws, root, cfg };
}
const applyAll = (actions) => { for (const a of actions) a.apply(); };

test('activity: true wires the script and both harnesses\' entries; false takes out ours and keeps the team\'s', () => {
  const { ws, root, cfg } = wiredProduct({ activity: true });
  try {
    put(path.join(root, '.claude', 'settings.json'), { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'team-own.sh' }] }] } });
    fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
    const targets = ['.claude', '.cursor'];
    applyAll(plan.activityHookActions(root, targets));
    assert.equal(fs.readFileSync(path.join(root, 'hooks', 'yad-activity.mjs'), 'utf8'), fs.readFileSync(HOOK, 'utf8'));
    const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
    const cmds = claude.hooks.PostToolUse.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.includes('team-own.sh'));
    assert.ok(cmds.includes(ACTIVITY_ADAPTERS[0].command));
    const cursor = JSON.parse(fs.readFileSync(path.join(root, '.cursor', 'hooks.json'), 'utf8'));
    assert.equal(cursor.version, 1);
    assert.deepEqual(cursor.hooks.afterFileEdit.map((e) => e.command), ['node hooks/yad-activity.mjs --format cursor']);
    assert.deepEqual(cursor.hooks.afterShellExecution.map((e) => e.command), ['node hooks/yad-activity.mjs --format cursor']);
    assert.deepEqual(plan.orphanActivityHookActions(root, targets), [], 'nothing to take out while it is on');
    // Doctor: on and wired.
    const checks = [];
    activityChecks(root, checks, JSON.parse(fs.readFileSync(cfg, 'utf8')));
    assert.match(JSON.stringify(checks), /wired/);
    // Off: ours come out, the team's stays, the script goes.
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    j.activity = false;
    fs.writeFileSync(cfg, JSON.stringify(j));
    applyAll(plan.orphanActivityHookActions(root, targets));
    const after = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(after.hooks.PostToolUse.flatMap((e) => e.hooks.map((h) => h.command)), ['team-own.sh']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.cursor', 'hooks.json'), 'utf8')), { version: 1 });
    assert.equal(fs.existsSync(path.join(root, 'hooks', 'yad-activity.mjs')), false);
    const off = [];
    activityChecks(root, off, j);
    assert.match(JSON.stringify(off), /is off/);
  } finally { done(ws); }
});

test('activity is off by default, and the doctor warns when it is on but not wired', () => {
  const { ws, root, cfg } = wiredProduct({ activity: undefined });
  try {
    assert.equal(plan.activityWanted(root), false);
    assert.deepEqual(plan.activityHookActions(root, ['.claude']), []);
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    j.activity = true;
    const checks = [];
    activityChecks(root, checks, j);
    assert.match(JSON.stringify(checks), /on but not wired[\s\S]*yad check --fix/);
  } finally { done(ws); }
});

test('a code repo gets the script in checks/ and its own entries; turning activity off takes them out', () => {
  const { ws, root, cfg } = wiredProduct({ activity: true });
  const repo = tmp();
  try {
    git(repo, 'init', '-q');
    fs.mkdirSync(path.join(repo, '.claude'));
    applyAll(plan.repoActivityActions(root, repo, ['.claude'], { scope: 'be' }));
    assert.ok(fs.existsSync(path.join(repo, REPO_ACTIVITY_DEST)));
    const s = JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(s.hooks.PostToolUse[0].hooks[0].command, activityAdapters(REPO_ACTIVITY_DEST)[0].command);
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    j.activity = false;
    fs.writeFileSync(cfg, JSON.stringify(j));
    applyAll(plan.repoOrphanActivityActions(root, repo, ['.claude'], { scope: 'be' }));
    assert.equal(fs.existsSync(path.join(repo, REPO_ACTIVITY_DEST)), false);
    assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'))).includes('yad-activity'), false);
  } finally { done(ws, repo); }
});

// ---- the live server ----------------------------------------------------------------------------------

function liveProduct() {
  const ws = tmp();
  const root = path.join(ws, 'product');
  fs.cpSync(GOLDEN, root, { recursive: true });
  git(root, 'init', '-q');
  const be = path.join(root, 'demo-repos', 'backend');
  put(path.join(be, 'src', 'routes.js'), '// routes\n');
  put(path.join(be, 'specs', 'EP-checkout-S01', 'tasks.md'), '## T01 — Route\n- **Files:** `src/routes.js`\n');
  git(be, 'init', '-q');
  git(be, 'add', '-A');
  git(be, 'commit', '-qm', 'init');
  const graph = { graph: { schema_version: 1, graphify_version: '0.9.108' }, nodes: [{ id: 'r', label: 'routes.js', source_file: 'src/routes.js' }], links: [] };
  const runner = (cmd, args = [], opts = {}) => {
    if (cmd === 'graphify' && args[0] === 'update') { put(path.join(opts.cwd, 'graphify-out', 'graph.json'), JSON.stringify(graph)); return { ok: true, code: 0, stdout: '', stderr: '' }; }
    if (cmd === 'graphify') return { ok: true, code: 0, stdout: `graphify ${GRAPHIFY_VERSION}`, stderr: '' };
    return realRun(cmd, args, opts);
  };
  buildRepoGraph(root, { name: 'backend', target: be }, { runner });
  writeBrain(root, composeBrain(root).brain);
  return { ws, root, be };
}

// Read Server-Sent Events from a running server until `want(events)` is true.
function sse(port, pathname, want, { host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.request({ host: '127.0.0.1', port, path: pathname, headers: { Host: host } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve({ status: res.statusCode, events }); return; }
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (block.startsWith(':')) { events.push({ event: 'ping' }); continue; }
          const ev = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          events.push({ event: ev, data: data ? JSON.parse(data) : null });
        }
        if (want(events)) { req.destroy(); resolve({ status: 200, events, headers: res.headers }); }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    req.end();
  });
}

test('the live stream: the key and Host guard it; status, then the backlog, then each new line as an event', async () => {
  const { ws, root, be } = liveProduct();
  const s = await startBrainServer(root, { runner: realRun, live: true, interval: 40, heartbeat: 60 });
  try {
    assert.equal((await sse(s.port, '/events')).status, 403);
    assert.equal((await sse(s.port, `/events?t=${s.token}`, () => true, { host: 'evil.example' })).status, 403);
    const log = path.join(be, '.git', act.LOG_NAME);
    fs.writeFileSync(log, `${JSON.stringify({ v: 1, op: 'read', ts: new Date().toISOString(), s: 'abcdefabcdef', paths: ['src/routes.js'] })}\n`);
    const appendLater = setTimeout(() => fs.appendFileSync(log, `${JSON.stringify({ v: 1, op: 'edit', ts: new Date().toISOString(), paths: ['src/routes.js', 'nope.md'] })}\n`), 300);
    const got = await sse(s.port, `/events?t=${s.token}`, (evs) => evs.some((e) => e.event === 'activity') && evs.some((e) => e.event === 'ping'));
    clearTimeout(appendLater);
    assert.equal(got.status, 200);
    assert.match(got.headers['content-type'], /^text\/event-stream/);
    assert.equal(got.headers['access-control-allow-origin'], undefined);
    assert.equal(got.events[0].event, 'status');
    assert.equal(got.events[0].data.activity, false);
    assert.deepEqual(got.events[0].data.sources.sort(), ['backend', 'product']);
    assert.equal(got.events[1].event, 'backlog');
    assert.deepEqual(got.events[1].data.map((e) => [e.op, e.hits.map((h) => h.path)]), [['read', ['backend/src/routes.js']]]);
    const live = got.events.find((e) => e.event === 'activity').data;
    assert.equal(live.op, 'edit');
    assert.deepEqual(live.hits.map((h) => h.path), ['backend/src/routes.js']);
    assert.deepEqual(live.outside, ['backend/nope.md']);
    const g = JSON.parse(await new Promise((resolve) => http.get({ host: '127.0.0.1', port: s.port, path: `/graph.json?t=${s.token}`, headers: { Host: `127.0.0.1:${s.port}` } }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve(b)); })));
    assert.equal(g.live, true);
    assert.ok(g.plan.some((p) => g.nodes[p.task].id === 'task:EP-checkout-S01:backend:T01' && p.files.map((f) => g.nodes[f].id).includes('file:backend:src/routes.js')));
  } finally { await s.close(); done(ws); }
});

test('--html --live: the recorded events ride in the file, escaped, with every inline block hashed', () => {
  const { ws, root, be } = liveProduct();
  try {
    fs.writeFileSync(path.join(be, '.git', act.LOG_NAME), `${JSON.stringify({ v: 1, op: 'read', ts: new Date().toISOString(), paths: ['src/routes.js', '</script><img src=x>.md'] })}\n`);
    const r = yadGit(root, 'brain', 'view', '--html', '--live', '--json');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.events, 1);
    assert.match(out.file, /live\.html$/);
    const html = fs.readFileSync(out.file, 'utf8');
    assert.equal(html.includes('</script><img'), false);
    const between = (open, close) => html.split(open).slice(1).map((part) => part.slice(0, part.indexOf(close)));
    const [data] = between('<script type="application/json" id="yad-brain-data">', '</script>');
    const model = JSON.parse(data);
    assert.equal(model.replay.length, 1);
    assert.deepEqual(model.replay[0].outside, ['backend/</script><img src=x>.md']);
    const csp = between('<meta http-equiv="Content-Security-Policy" content="', '"')[0];
    for (const b of [...between('<script>', '</script>'), ...between('<style>', '</style>')]) {
      assert.ok(csp.includes(`'sha256-${createHash('sha256').update(b, 'utf8').digest('base64')}'`));
    }
    assert.equal(snapshotHTML(model, { live: true }).includes('Plan and reality'), true);
  } finally { done(ws); }
});

test('--live belongs to view; view --live with activity off says how to turn it on', () => {
  const { ws, root } = liveProduct();
  try {
    for (const args of [['build', '--live'], ['status', '--live'], ['query', 'x', '--live']]) {
      const r = yad(root, 'brain', ...args, '--json');
      assert.notEqual(r.status, 0, args.join(' '));
      assert.match(JSON.parse(r.stdout).error, /does not take --live/);
    }
  } finally { done(ws); }
});

// ---- review 1 -----------------------------------------------------------------------------------------

test('review 1: text that only looks like a relative path is dropped; a repo opened through a link still matches', () => {
  const real = tmp();
  const via = path.join(tmp(), 'via');
  try {
    put(path.join(real, 'src', 'a.js'), 'x');
    fs.symlinkSync(real, via);
    const r = (p) => hook.recordOf({ tool_name: 'Grep', tool_input: { path: p } }, { root: real, realRoot: real }).paths;
    for (const bad of ['~/.ssh/id_rsa', '$HOME/x', '%USERPROFILE%\\x', `file://${real}/src`]) assert.deepEqual(r(bad), [], bad);
    if (process.platform !== 'win32') for (const bad of ['C:\\Users\\me\\secret.txt', 'a:b']) assert.deepEqual(r(bad), [], bad);
    assert.deepEqual(r(path.join(via, 'src', 'a.js')), ['src/a.js'], 'the path the agent typed, through the link');
    assert.deepEqual(r(path.join(via, 'src', 'new.js')), ['src/new.js'], 'a file not written yet, under a real folder');
  } finally { done(real, path.dirname(via)); }
});

test('review 1: a Product in a subfolder of its git repo records into that repo\'s git folder', () => {
  const top = tmp();
  try {
    git(top, 'init', '-q');
    const sub = path.join(top, 'product');
    put(path.join(sub, 'src', 'a.js'), 'x');
    fs.mkdirSync(path.join(sub, 'checks'));
    fs.copyFileSync(HOOK, path.join(sub, 'checks', 'yad-activity.mjs'));
    git(top, 'add', '-A');
    git(top, 'commit', '-qm', 'the Product, in a subfolder');
    const r = runHook(sub, { tool_name: 'Read', tool_input: { file_path: path.join(sub, 'src/a.js') } });
    assert.equal(r.status, 0);
    const lines = fs.readFileSync(path.join(top, '.git', hook.LOG_NAME), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((x) => x.paths), [['src/a.js']]);
  } finally { done(top); }
});

test('review 2: a folder that only sits inside an unrelated repo (a home folder kept in git) records nothing there', () => {
  const home = tmp();
  try {
    git(home, 'init', '-q');
    put(path.join(home, '.zshrc'), '# dotfiles\n');
    git(home, 'add', '.zshrc');
    git(home, 'commit', '-qm', 'dotfiles');
    const product = path.join(home, 'Projects', 'product');
    put(path.join(product, 'src', 'a.js'), 'x');
    fs.mkdirSync(path.join(product, 'checks'));
    fs.copyFileSync(HOOK, path.join(product, 'checks', 'yad-activity.mjs'));
    const r = runHook(product, { tool_name: 'Read', tool_input: { file_path: path.join(product, 'src/a.js') } });
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(path.join(home, '.git', hook.LOG_NAME)), false, 'the dotfiles repo is not the Product\'s');
    assert.equal(hook.gitCommonDir(product), null);
  } finally { done(home); }
});

test('review 1: the reader takes plain files only, keeps characters whole across reads, and drops an endless line', () => {
  const dir = tmp();
  const elsewhere = tmp();
  try {
    const line = (op, p = []) => `${JSON.stringify({ v: 1, op, ts: new Date().toISOString(), paths: p })}\n`;
    put(path.join(elsewhere, 'big.jsonl'), line('read'));
    fs.symlinkSync(path.join(elsewhere, 'big.jsonl'), path.join(dir, act.LOG_NAME));
    assert.deepEqual(act.readBacklog([{ repo: null, dir, prefixes: [] }]), [], 'a link at the log is not followed');
    fs.rmSync(path.join(dir, act.LOG_NAME));
    if (process.platform !== 'win32') {
      spawnSync('mkfifo', [path.join(dir, act.LOG_NAME)]);
      assert.deepEqual(act.readBacklog([{ repo: null, dir, prefixes: [] }]), [], 'a FIFO is not opened (it would block)');
      fs.rmSync(path.join(dir, act.LOG_NAME));
    }
    const file = path.join(dir, act.LOG_NAME);
    fs.writeFileSync(file, '');
    const got = [];
    const f = act.follow({ repo: null, dir, prefixes: [] }, (src, r) => got.push(r.paths[0] ?? r.op), { watch: () => {}, unwatch: () => {} });
    const bytes = Buffer.from(line('read', ['src/مرحبا.js']));
    const cut = bytes.indexOf(Buffer.from('مرحبا')) + 1; // inside the first two-byte character
    fs.appendFileSync(file, bytes.subarray(0, cut));
    f.pump();
    fs.appendFileSync(file, bytes.subarray(cut));
    f.pump();
    assert.deepEqual(got, ['src/مرحبا.js']);
    fs.appendFileSync(file, 'x'.repeat(70 * 1024));
    f.pump();
    fs.appendFileSync(file, `\n${line('edit')}`);
    f.pump();
    assert.deepEqual(got, ['src/مرحبا.js', 'edit'], 'the endless part was dropped, the next whole line read');
    // A rotation: what the old file gained after the last look is read before the new file.
    fs.appendFileSync(file, line('search'));
    fs.renameSync(file, path.join(dir, act.OLD_LOG_NAME));
    fs.writeFileSync(file, line('run'));
    f.pump();
    assert.deepEqual(got.slice(-2), ['search', 'run']);
    f.stop();
  } finally { done(dir, elsewhere); }
});

test('review 1: turning activity off never removes a team\'s own copy, nor anything through a linked folder', () => {
  const { ws, root } = wiredProduct({ activity: false });
  const repo = tmp();
  const outside = tmp();
  try {
    // A linked checks/: the file behind it is never removed, and nothing is installed through it.
    put(path.join(outside, 'yad-activity.mjs'), fs.readFileSync(HOOK, 'utf8'));
    fs.symlinkSync(outside, path.join(repo, 'checks'));
    applyAll(plan.repoOrphanActivityActions(root, repo, ['.claude'], { scope: 'be' }));
    assert.ok(fs.existsSync(path.join(outside, 'yad-activity.mjs')), 'the file behind the link is untouched');
    const cfg = path.join(root, '.sdlc', 'hub.json');
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    j.activity = true;
    fs.writeFileSync(cfg, JSON.stringify(j));
    fs.mkdirSync(path.join(repo, '.claude'));
    assert.deepEqual(plan.repoActivityActions(root, repo, ['.claude'], { scope: 'be' }), [], 'nothing is written through it');
    // The Product's own hooks/ with a team-edited copy: kept when activity goes off.
    j.activity = false;
    fs.writeFileSync(cfg, JSON.stringify(j));
    put(path.join(root, 'hooks', 'yad-activity.mjs'), '// our own version\n');
    assert.deepEqual(plan.orphanActivityHookActions(root, []).filter((a) => a.item.includes('removed') && a.item.startsWith('hooks/')), []);
    // yad's own copy goes.
    fs.copyFileSync(HOOK, path.join(root, 'hooks', 'yad-activity.mjs'));
    applyAll(plan.orphanActivityHookActions(root, []));
    assert.equal(fs.existsSync(path.join(root, 'hooks', 'yad-activity.mjs')), false);
  } finally { done(ws, repo, outside); }
});

test('review 1: a second page gets no event twice; a page is told when the brain is rebuilt under it', async () => {
  const { ws, root, be } = liveProduct();
  const s = await startBrainServer(root, { runner: realRun, live: true, interval: 60_000, heartbeat: 60_000 });
  const log = path.join(be, '.git', act.LOG_NAME);
  const line = (op) => `${JSON.stringify({ v: 1, op, ts: new Date().toISOString(), paths: ['src/routes.js'] })}\n`;
  const open = (onEvent) => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, path: `/events?t=${s.token}`, headers: { Host: `127.0.0.1:${s.port}` } }, (res) => {
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (ev) onEvent(ev, data ? JSON.parse(data) : null);
        }
      });
      resolve(req);
    });
    req.on('error', () => {});
    req.end();
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    fs.writeFileSync(log, '');
    const first = [];
    const a = await open((ev, d) => first.push([ev, d]));
    await wait(200);
    fs.appendFileSync(log, line('edit'));          // landed, not yet pumped (the interval is a minute)
    const second = [];
    const b = await open((ev, d) => second.push([ev, d]));
    await wait(300);
    const edits = (list) => list.flatMap(([ev, d]) => (ev === 'backlog' ? d : ev === 'activity' ? [d] : [])).filter((e) => e.op === 'edit').length;
    assert.equal(edits(second), 1, 'the second page has the edit once, in its backlog');
    assert.equal(edits(first), 1, 'the first page was sent it live, before the second read its backlog');
    // The brain is rebuilt: the next event tells each page once.
    const brainFile = path.join(root, '.sdlc', 'brain', 'graph.json');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(brainFile, later, later);
    fs.appendFileSync(log, line('read'));
    // A new page connecting makes the server look at the files now (the open pages first).
    await new Promise((r) => http.get({ host: '127.0.0.1', port: s.port, path: `/events?t=${s.token}`, headers: { Host: `127.0.0.1:${s.port}` } }, (res) => { res.destroy(); r(); }).on('error', r));
    await wait(300);
    assert.equal(first.filter(([ev]) => ev === 'rebuilt').length, 1);
    a.destroy(); b.destroy();
  } finally { await s.close(); done(ws); }
});

// ---- review 3 -----------------------------------------------------------------------------------------

test('review 3: a big folder in a repo above still records — the tracked-file check reads only the first bytes', () => {
  const top = tmp();
  try {
    git(top, 'init', '-q');
    const app = path.join(top, 'apps', 'web');
    for (let i = 0; i < 200; i++) put(path.join(app, 'src', `a-component-with-a-rather-long-file-name-${String(i).padStart(4, '0')}.js`), 'x');
    fs.mkdirSync(path.join(app, 'checks'));
    fs.copyFileSync(HOOK, path.join(app, 'checks', 'yad-activity.mjs'));
    git(top, 'add', '-A');
    git(top, 'commit', '-qm', 'many files');
    assert.ok(spawnSync('git', ['-C', app, 'ls-files', '-z', '--', '.'], { encoding: 'utf8' }).stdout.length > 4096, 'the list is longer than the check reads');
    assert.equal(hook.gitCommonDir(app), path.join(top, '.git'));
    assert.equal(act.tracksHere(app, realRun), true);
    // The reader's twin rule: a folder inside an unrelated repo is not a source.
    const home = tmp();
    git(home, 'init', '-q');
    put(path.join(home, 'dot'), 'x');
    git(home, 'add', 'dot');
    git(home, 'commit', '-qm', 'dotfiles');
    const loose = path.join(home, 'Projects', 'p');
    fs.mkdirSync(loose, { recursive: true });
    assert.equal(act.tracksHere(loose, realRun), false);
    assert.equal(act.tracksHere(loose, () => ({ ok: false, stdout: 'a', error: { code: 'ENOBUFS' } })), true, 'an overflow is a yes');
    assert.equal(act.tracksHere(loose, () => ({ ok: false, stdout: '', error: { code: 'ENOENT' } })), false);
    done(home);
  } finally { done(top); }
});

test('review 3: a page\'s backlog stops where the live reader stands, so a line is never in both', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, act.LOG_NAME);
    const line = (op) => `${JSON.stringify({ v: 1, op, ts: new Date().toISOString(), paths: [] })}\n`;
    fs.writeFileSync(file, line('read'));
    const live = [];
    const src = { repo: null, dir, prefixes: [] };
    const f = act.follow(src, (s, r) => live.push(r.op), { watch: () => {}, unwatch: () => {} });
    fs.appendFileSync(file, line('edit'));       // lands after the reader's last look
    const at = f.position();
    const backlog = act.readBacklog([src], { upTo: () => at }).map((x) => x.r.op);
    f.pump();
    assert.deepEqual(backlog, ['read'], 'the backlog stops at the reader');
    assert.deepEqual(live, ['edit'], 'and the reader sends the rest');
    f.stop();
  } finally { done(dir); }
});

test('review 3: the doctor asks the hook\'s question — a Product no repo tracks has nowhere to record', () => {
  const home = tmp();
  try {
    git(home, 'init', '-q');
    put(path.join(home, 'dot'), 'x');
    git(home, 'add', 'dot');
    git(home, 'commit', '-qm', 'dotfiles');
    const root = path.join(home, 'Projects', 'product');
    fs.cpSync(GOLDEN, root, { recursive: true });
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.sdlc', 'hub.json'), 'utf8'));
    cfg.activity = true;
    fs.writeFileSync(path.join(root, '.sdlc', 'hub.json'), JSON.stringify(cfg));
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    for (const a of plan.activityHookActions(root, ['.claude'])) a.apply();
    const checks = [];
    activityChecks(root, checks, cfg);
    assert.match(JSON.stringify(checks), /not committed in a git repo of its own[\s\S]*commit the Product/);
  } finally { done(home); }
});

test('review 4: a rotation between the reader\'s position and a page\'s backlog sends no line twice', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, act.LOG_NAME);
    const line = (op) => `${JSON.stringify({ v: 1, op, ts: new Date().toISOString(), paths: [] })}\n`;
    fs.writeFileSync(file, line('read'));
    const src = { repo: null, dir, prefixes: [] };
    const live = [];
    const f = act.follow(src, (s, r) => live.push(r.op), { watch: () => {}, unwatch: () => {} });
    fs.appendFileSync(file, line('edit'));                 // after the reader's last look
    const at = f.position();
    fs.renameSync(file, path.join(dir, act.OLD_LOG_NAME)); // rotated before the page reads its backlog
    fs.writeFileSync(file, line('search'));
    const backlog = act.readBacklog([src], { upTo: () => at }).map((x) => x.r.op);
    f.pump();
    assert.deepEqual(backlog, ['read'], 'the old file up to the reader, nothing of the new one');
    assert.deepEqual(live, ['edit', 'search'], 'the reader sends the old tail and the new file');
    f.stop();
  } finally { done(dir); }
});

test('review 6: file numbers that cannot tell files apart never cost a line', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, act.LOG_NAME);
    const old = path.join(dir, act.OLD_LOG_NAME);
    const line = (op) => `${JSON.stringify({ v: 1, op, ts: new Date().toISOString(), paths: [] })}\n`;
    const src = { repo: null, dir, prefixes: [] };
    const ops = (upTo) => act.readBacklog([src], { upTo }).map((x) => x.r.op).sort();
    // Every file numbered 0 (FAT, exFAT): the current log is cut where the reader stands, not dropped.
    fs.writeFileSync(file, line('read') + line('edit'));
    assert.deepEqual(ops(() => ({ ino: 0, offset: Buffer.byteLength(line('read')) })), ['read']);
    // A rotation between the backlog's two reads: every line is there at least once.
    fs.writeFileSync(file, line('read'));
    fs.rmSync(old, { force: true });
    let calls = 0;
    const rotating = () => { calls += 1; if (calls === 2) { fs.renameSync(file, old); fs.writeFileSync(file, ''); } return null; };
    assert.ok(ops(rotating).includes('read'));
    // Two names for one file (one number for both): the old file is read whole.
    fs.rmSync(old, { force: true });
    fs.writeFileSync(file, line('read') + line('search'));
    fs.linkSync(file, old);
    const at = { ino: fs.statSync(file).ino, offset: 0 };
    assert.ok(ops(() => at).includes('search'));
  } finally { done(dir); }
});
