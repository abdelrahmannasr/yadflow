// E180 — the local reports folder: where it is, how a file is named, the catalog, and `yad reports`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';

const { withCatalogLock, reportsDir, mainCheckout, reportName, slug, stamp, saveReport, readCatalog, listReports, pruneReports, freshness, renderIndex, writeOrSave, REPORTS_ENV, CATALOG_FILE } = await import('./reports-dir.mjs');
const { runReports } = await import('./reports.mjs');
const { classify } = await import('./agent-rules.mjs');
const { endJSON } = await import('./lib.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAD = path.join(HERE, '..', 'bin', 'yad.mjs');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-reports-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const done = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const noEnv = {};
const AT = new Date(2026, 10, 14, 9, 5);   // local time, 2026-11-14 09:05

// A Product checkout with one commit, inside a fresh workspace folder.
function product() {
  const ws = tmp();
  const root = path.join(ws, 'product');
  put(path.join(root, '.sdlc', 'product.json'), { name: 'demo' });
  put(path.join(root, 'epics', 'EP-x', 'epic.md'), '# x\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'start');
  return { ws, root };
}

async function captured(fn) {
  const out = []; const orig = console.log;
  console.log = (s) => out.push(String(s));
  try { await fn(); } finally { console.log = orig; endJSON(); }
  return JSON.parse(out.join('\n'));
}

test('the folder sits beside the main checkout — also from a worktree — and the env var wins', () => {
  const { ws, root } = product();
  try {
    assert.equal(reportsDir(root, { env: noEnv }).dir, path.join(ws, 'product--reports'));
    const wt = path.join(ws, 'product--EP-x');
    assert.equal(git(root, 'worktree', 'add', '-q', '--detach', wt).status, 0);
    assert.equal(mainCheckout(wt), root, 'a worktree finds its main checkout');
    assert.equal(reportsDir(wt, { env: noEnv }).dir, path.join(ws, 'product--reports'), 'and saves into the same folder');
    const mine = path.join(ws, 'elsewhere');
    assert.deepEqual(reportsDir(root, { env: { [REPORTS_ENV]: mine } }), { dir: mine, via: 'env' });
    assert.equal(reportsDir(root, { env: { [REPORTS_ENV]: '  ' } }).via, 'beside', 'a blank value is not a choice');
    // A Product folder inside another repo (not its top) keeps its reports beside itself.
    const inner = path.join(root, 'nested');
    fs.mkdirSync(inner);
    assert.equal(mainCheckout(inner), inner);
    // Not a repo at all: beside the folder.
    const plain = path.join(ws, 'plain');
    fs.mkdirSync(plain);
    assert.equal(reportsDir(plain, { env: noEnv }).dir, path.join(ws, 'plain--reports'));
  } finally { done(ws); }
});

test('a name says the time, kind, scope and state, in characters every system accepts', () => {
  assert.equal(stamp(AT), '2026-11-14-0905');
  assert.equal(reportName({ kind: 'standup', scope: 'Ahmed Zaki', state: '3 waiting', at: AT, ext: 'md' }), '2026-11-14-0905--standup--ahmed-zaki--3-waiting.md');
  assert.equal(reportName({ kind: 'usage', scope: 'team', state: '2026-10-01 → 2026-11-14', at: AT, ext: 'html' }), '2026-11-14-0905--usage--team--2026-10-01-2026-11-14.html');
  assert.equal(slug('Ünïcödé: a/b\\c*?"<>|'), 'unicode-a-b-c');
  assert.equal(slug(''), 'none');
  assert.equal(slug('-'.repeat(9)), 'none');
  assert.ok(slug('x'.repeat(200)).length <= 40);
  assert.ok(!slug('ab '.repeat(30), 10).endsWith('-'), 'a cut never ends on a dash');
  const long = reportName({ kind: 'progress-map', scope: 'y'.repeat(300), state: 'z'.repeat(300), at: AT, ext: 'html' });
  assert.ok(long.length <= 120, long.length);
  assert.throws(() => reportName({ kind: '../x', scope: 'a', state: 'b', at: AT, ext: 'md' }), /unknown report kind/);
  assert.throws(() => reportName({ kind: 'usage', scope: 'a', state: 'b', at: AT, ext: 'h/tml' }), /bad report extension/);
});

test('saving writes the file, the ignore file, the catalog and its page; a clash gets -2', () => {
  const { ws, root } = product();
  try {
    const a = saveReport(root, { kind: 'standup', scope: 'team', state: '2 waiting', ext: 'md', content: '# one\n', command: 'standup', at: AT, env: noEnv });
    const dir = path.join(ws, 'product--reports');
    assert.equal(a.file, path.join(dir, 'standup', '2026-11-14-0905--standup--team--2-waiting.md'));
    assert.equal(fs.readFileSync(a.file, 'utf8'), '# one\n');
    assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\*$/m);
    const b = saveReport(root, { kind: 'standup', scope: 'team', state: '2 waiting', ext: 'md', content: '# two\n', at: AT, env: noEnv });
    assert.equal(path.basename(b.file), '2026-11-14-0905--standup--team--2-waiting-2.md');
    const cat = readCatalog(dir);
    assert.equal(cat.entries.length, 2);
    const sha = git(root, 'rev-parse', 'HEAD').stdout.trim();
    assert.deepEqual(cat.entries[0], { file: 'standup/2026-11-14-0905--standup--team--2-waiting.md', kind: 'standup', scope: 'team', state: '2 waiting', createdAt: AT.toISOString(), productSha: sha, productBranch: 'main', anonymous: false, command: 'standup' });
    const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(page, /href="standup\/2026-11-14-0905--standup--team--2-waiting\.md"/);
    assert.match(page, /default-src 'none'/, 'the catalog page runs no script');
    // Inside a git tree, the folder's own ignore file keeps every report out of it.
    git(ws, 'init', '-q');
    assert.equal(git(ws, 'check-ignore', '-q', path.join('product--reports', 'standup', path.basename(a.file))).status, 0);
  } finally { done(ws); }
});

test('a broken catalog is never overwritten: the report is still saved, and the problem is said', () => {
  const { ws, root } = product();
  try {
    const dir = path.join(ws, 'product--reports');
    put(path.join(dir, CATALOG_FILE), '{ not json');
    const r = saveReport(root, { kind: 'usage', scope: 'team', state: 'all time', ext: 'html', content: '<p>x</p>', at: AT, env: noEnv });
    assert.ok(fs.existsSync(r.file));
    assert.match(r.warnings[0], /cannot be read .* the catalog was not changed/);
    assert.equal(fs.readFileSync(path.join(dir, CATALOG_FILE), 'utf8'), '{ not json');
    put(path.join(dir, CATALOG_FILE), { version: 9, entries: [] });
    assert.match(readCatalog(dir).problem, /version 9/);
    put(path.join(dir, CATALOG_FILE), [1, 2]);
    assert.match(readCatalog(dir).problem, /not a reports catalog/);
    // A file where the folder should be is refused, not written through.
    const other = product();
    put(path.join(other.ws, 'product--reports'), 'a file');
    assert.match(saveReport(other.root, { kind: 'usage', scope: 't', state: 's', ext: 'md', content: 'x', env: noEnv }).problem, /not a plain folder/);
    done(other.ws);
  } finally { done(ws); }
});

test('fresh until the Product\'s epics or .sdlc change; a missing or foreign sha is unknown', () => {
  const { ws, root } = product();
  try {
    saveReport(root, { kind: 'standup', scope: 'team', state: '0 waiting', ext: 'md', content: 'x', at: AT, env: noEnv });
    assert.equal(listReports(root, { env: noEnv }).entries[0].freshness, 'fresh');
    put(path.join(root, 'README.md'), 'not the record\n');
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'readme');
    assert.equal(listReports(root, { env: noEnv }).entries[0].freshness, 'fresh', 'a change outside the record does not make it stale');
    put(path.join(root, 'epics', 'EP-x', 'epic.md'), '# x moved\n');
    assert.equal(listReports(root, { env: noEnv }).entries[0].freshness, 'fresh', 'an uncommitted change is not the record yet');
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'move');
    assert.equal(listReports(root, { env: noEnv }).entries[0].freshness, 'stale');
    assert.equal(freshness(root, null), 'unknown');
    assert.equal(freshness(root, 'f'.repeat(40)), 'unknown');
    assert.equal(freshness(root, '--output=x'), 'unknown', 'never passed to git as an option');
  } finally { done(ws); }
});

test('prune is a dry run until --apply, and only ever deletes what the catalog lists inside the folder', () => {
  const { ws, root } = product();
  try {
    const old = saveReport(root, { kind: 'usage', scope: 'team', state: 'old', ext: 'md', content: 'x', at: new Date(2026, 0, 1), env: noEnv });
    const recent = saveReport(root, { kind: 'usage', scope: 'team', state: 'new', ext: 'md', content: 'y', at: AT, env: noEnv });
    const dir = path.join(ws, 'product--reports');
    const outside = path.join(ws, 'keep-me.txt');
    put(outside, 'keep');
    const cat = JSON.parse(fs.readFileSync(path.join(dir, CATALOG_FILE), 'utf8'));
    cat.entries.push({ file: '../keep-me.txt', kind: 'usage', scope: 'x', state: 'x', createdAt: '2000-01-01T00:00:00.000Z' });
    fs.writeFileSync(path.join(dir, CATALOG_FILE), JSON.stringify(cat));
    const now = AT.getTime() + 864e5;
    const dry = pruneReports(root, { days: 30, now, env: noEnv });
    assert.deepEqual(dry.removed.map((e) => [e.file, e.reason]).sort(), [['../keep-me.txt', 'outside'], [path.posix.join('usage', path.basename(old.file)), 'old']].sort());
    assert.ok(fs.existsSync(old.file), 'a dry run deletes nothing');
    const applied = pruneReports(root, { days: 30, now, apply: true, env: noEnv });
    assert.equal(applied.removed.find((e) => e.reason === 'old').file, path.posix.join('usage', path.basename(old.file)), 'review 1: the reason is decided before the delete, so a removed file reads "old"');
    assert.equal(fs.existsSync(old.file), false);
    assert.ok(fs.existsSync(recent.file));
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep', 'a path that leaves the folder is dropped from the catalog, never deleted');
    assert.equal(readCatalog(dir).entries.length, 1);
  } finally { done(ws); }
});

test('--out still writes exactly the file named, and leaves the catalog alone', () => {
  const { ws, root } = product();
  try {
    const out = path.join(ws, 'sub', 'mine.md');
    const r = writeOrSave(root, { out, kind: 'standup', scope: 'team', state: 's', ext: 'md', content: 'z', env: noEnv });
    assert.equal(r.file, out);
    assert.equal(fs.readFileSync(out, 'utf8'), 'z');
    assert.equal(fs.existsSync(path.join(ws, 'product--reports')), false);
  } finally { done(ws); }
});

test('the catalog page escapes what it shows', () => {
  const page = renderIndex([{ file: 'usage/a"b<c>.md', kind: 'usage', scope: '<script>', state: '"x"', createdAt: AT.toISOString(), productSha: null, anonymous: true }]);
  assert.equal(page.includes('<script>'), false);
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /anonymous/);
  assert.match(renderIndex([]), /No reports saved yet/);
});

test('yad reports list | open | prune answer in JSON, and refuse what they do not take', async () => {
  const { ws, root } = product();
  try {
    const env = { [REPORTS_ENV]: path.join(ws, 'chosen') };
    saveReport(root, { kind: 'issues', scope: 'all repos', state: '4 items', ext: 'md', content: 'x', at: AT, env });
    const list = await captured(() => runReports(root, { action: 'list', json: true, env }));
    assert.equal(list.command, null);
    assert.equal(list.via, 'env');
    assert.equal(list.entries[0].n, 1);
    assert.equal(list.entries[0].present, true);
    let opened = null;
    const open = await captured(() => runReports(root, { action: 'open', args: ['1'], json: true, env, opener: (f) => { opened = f; return true; } }));
    assert.equal(open.opened, true);
    assert.equal(opened, path.join(ws, 'chosen', list.entries[0].file));
    assert.equal((await captured(() => runReports(root, { action: 'open', args: ['9'], json: true, env }))).ok, false);
    const bad = await captured(() => runReports(root, { action: 'prune', olderThan: 'soon', json: true, env }));
    assert.match(bad.error, /--older-than <days>/);
    const prune = await captured(() => runReports(root, { action: 'prune', olderThan: '0', json: true, env }));
    assert.equal(prune.applied, false);
    // review 2: --missing drops only entries whose file is gone, and deletes no report.
    const kept = path.join(ws, 'chosen', list.entries[0].file);
    saveReport(root, { kind: 'issues', scope: 'all repos', state: 'gone', ext: 'md', content: 'x', at: AT, env });
    const goner = listReports(root, { env }).entries.find((e) => e.state === 'gone');
    fs.rmSync(path.join(ws, 'chosen', goner.file));
    const miss = await captured(() => runReports(root, { action: 'prune', missing: true, apply: true, json: true, env }));
    assert.deepEqual(miss.removed.map((e) => e.reason), ['missing']);
    assert.ok(fs.existsSync(kept), 'the report whose file is there stays');
    assert.equal((await captured(() => runReports(root, { action: 'prune', missing: true, olderThan: '3', json: true, env }))).ok, false, 'not both');
    assert.equal((await captured(() => runReports(root, { action: 'frob', json: true, env }))).ok, false);
    process.exitCode = 0;
  } finally { done(ws); }
});

test('yad reports runs from the CLI, and agents may list but must be asked to delete', () => {
  const { ws, root } = product();
  try {
    const r = spawnSync(process.execPath, [YAD, 'reports', '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1', [REPORTS_ENV]: '' } });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.command, 'reports list');
    assert.deepEqual(out.entries, []);
    assert.equal(classify(['reports', 'list']), 'read');
    assert.equal(classify(['reports', 'prune']), 'read', 'a dry run');
    assert.equal(classify(['reports', 'prune'], ['apply']), 'on-request');
  } finally { done(ws); }
});

test('review 1: a linked kind folder, a linked reports folder or a bare file name never lets prune, list or open leave the folder', { skip: process.platform === 'win32' && 'making a folder link needs extra rights on Windows' }, () => {
  const { ws, root } = product();
  try {
    const dir = path.join(ws, 'product--reports');
    saveReport(root, { kind: 'usage', scope: 'team', state: 's', ext: 'md', content: 'x', at: AT, env: noEnv });
    const outside = path.join(ws, 'outside');
    put(path.join(outside, 'keep.txt'), 'keep');
    fs.symlinkSync(outside, path.join(dir, 'standup'));
    const cat = JSON.parse(fs.readFileSync(path.join(dir, CATALOG_FILE), 'utf8'));
    cat.entries.push({ file: 'standup/keep.txt', kind: 'standup', scope: 'x', state: 'x', createdAt: '2000-01-01T00:00:00.000Z' });
    cat.entries.push({ file: '.gitignore', kind: 'usage', scope: 'x', state: 'x', createdAt: '2000-01-01T00:00:00.000Z' });
    cat.entries.push({ file: 'catalog.json', kind: 'usage', scope: 'x', state: 'x', createdAt: '2000-01-01T00:00:00.000Z' });
    fs.writeFileSync(path.join(dir, CATALOG_FILE), JSON.stringify(cat));
    const listed = listReports(root, { env: noEnv }).entries;
    assert.equal(listed.find((e) => e.file === 'standup/keep.txt').present, false, 'a file through a linked folder is not "present"');
    const r = pruneReports(root, { days: 1, now: AT.getTime() + 864e5, apply: true, env: noEnv });
    assert.deepEqual(r.removed.map((e) => e.reason).sort(), ['outside', 'outside', 'outside']);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep', 'never deleted through the link');
    assert.ok(fs.existsSync(path.join(dir, '.gitignore')), 'the folder\'s own files are never pruned');
    assert.equal(readCatalog(dir).entries.length, 1);
    // The reports folder itself a link: said, and nothing read or changed through it.
    const real = path.join(ws, 'real-reports');
    fs.mkdirSync(real);
    const env = { [REPORTS_ENV]: path.join(ws, 'linked-reports') };
    fs.symlinkSync(real, env[REPORTS_ENV]);
    assert.match(listReports(root, { env }).problem, /not a plain folder/);
    assert.match(pruneReports(root, { days: 0, apply: true, env }).problem, /not a plain folder/);
    assert.match(saveReport(root, { kind: 'usage', scope: 't', state: 's', ext: 'md', content: 'x', env }).problem, /not a plain folder/);
  } finally { done(ws); }
});

test('review 1: a folder that cannot be written is a refusal with the way out, never a crash', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const { ws, root } = product();
  try {
    const locked = path.join(ws, 'locked');
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o500);
    try {
      const r = saveReport(root, { kind: 'usage', scope: 't', state: 's', ext: 'md', content: 'x', env: { [REPORTS_ENV]: path.join(locked, 'reports') } });
      assert.match(r.problem, /cannot save the report .* set YAD_REPORTS_DIR .* or pass --out/);
    } finally { fs.chmodSync(locked, 0o700); }
  } finally { done(ws); }
});

test('review 1: a name already taken is never overwritten, and a held catalog lock waits, then is said', () => {
  const { ws, root } = product();
  try {
    const dir = path.join(ws, 'product--reports');
    const a = saveReport(root, { kind: 'usage', scope: 'team', state: 's', ext: 'md', content: 'first', at: AT, env: noEnv });
    const b = saveReport(root, { kind: 'usage', scope: 'team', state: 's', ext: 'md', content: 'second', at: AT, env: noEnv });
    assert.equal(fs.readFileSync(a.file, 'utf8'), 'first');
    assert.equal(fs.readFileSync(b.file, 'utf8'), 'second');
    // A lock held by a run that is still going (this test's own pid): the report is saved, the catalog is
    // left, and the warning says where the report is — never "try again", which would save a second copy.
    fs.writeFileSync(path.join(dir, 'catalog.lock'), `${process.pid} ${'a'.repeat(16)}`);
    const held = saveReport(root, { kind: 'usage', scope: 'team', state: 'held', ext: 'md', content: 'x', at: AT, env: noEnv, lockWaitMs: 200 });
    assert.ok(fs.existsSync(held.file));
    assert.match(held.warnings[0], /the report was saved at .*held.*not added to the catalog: .*catalog\.lock is held by another yad run that is still going/);
    assert.equal(readCatalog(dir).entries.length, 2);
    assert.equal(fs.readFileSync(path.join(dir, 'catalog.lock'), 'utf8'), `${process.pid} ${'a'.repeat(16)}`, 'a lock that is not ours is never removed');
    // A lock whose run is gone (no such process) is taken over at once, and ours is removed after.
    fs.writeFileSync(path.join(dir, 'catalog.lock'), `2147483646 ${'b'.repeat(16)}`);
    saveReport(root, { kind: 'usage', scope: 'team', state: 'after', ext: 'md', content: 'x', at: AT, env: noEnv });
    assert.equal(readCatalog(dir).entries.length, 3);
    assert.equal(fs.existsSync(path.join(dir, 'catalog.lock')), false);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.stale')), [], 'the set-aside lock is gone too');
  } finally { done(ws); }
});

test('review 3: a young lock yad cannot judge is waited on, never taken; a lock it cannot read ends at the deadline', () => {
  const ws = tmp();
  try {
    const lock = path.join(ws, 'catalog.lock');
    let ran = 0;
    for (const odd of ['', 'half', '0 x']) {
      fs.writeFileSync(lock, odd);
      const r = withCatalogLock(ws, () => { ran++; return {}; }, { waitMs: 150 });
      assert.equal(r.held, true, `${JSON.stringify(odd)} is not taken over while young`);
      assert.equal(fs.readFileSync(lock, 'utf8'), odd);
    }
    // The same content, older than 5 minutes: taken over, used, and released.
    const old = new Date(Date.now() - 6 * 60 * 1000);
    fs.utimesSync(lock, old, old);
    assert.deepEqual(withCatalogLock(ws, () => { ran++; return { ok: 1 }; }, { waitMs: 150 }), { ok: 1 });
    assert.equal(ran, 1);
    assert.equal(fs.existsSync(lock), false);
    // A folder where the lock should be: the loop ends, with the reason.
    fs.mkdirSync(lock);
    const t0 = Date.now();
    const r = withCatalogLock(ws, () => { ran++; return {}; }, { waitMs: 150 });
    assert.ok(Date.now() - t0 < 3000, 'no endless spin');
    assert.equal(r.held, true);
    assert.equal(ran, 1);
    assert.deepEqual(fs.readdirSync(ws).filter((n) => /\.(new|stale)$/.test(n)), [], 'no temp lock files left');
  } finally { done(ws); }
});

test('review 4: on a disk with no hard links the lock falls back to a plain create, and the catalog still updates', () => {
  const { ws, root } = product();
  const link = fs.linkSync;
  fs.linkSync = () => { const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e; };
  try {
    saveReport(root, { kind: 'usage', scope: 'team', state: 'a', ext: 'md', content: 'x', at: AT, env: noEnv });
    const b = saveReport(root, { kind: 'usage', scope: 'team', state: 'b', ext: 'md', content: 'y', at: AT, env: noEnv });
    assert.deepEqual(b.warnings, []);
    const dir = path.join(ws, 'product--reports');
    assert.equal(readCatalog(dir).entries.length, 2);
    assert.equal(fs.existsSync(path.join(dir, 'catalog.lock')), false);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => /\.(new|stale)$/.test(n)), [], 'no temp lock file left');
    assert.equal(pruneReports(root, { days: 0, now: AT.getTime() + 864e5, apply: true, env: noEnv }).removed.length, 2, 'prune works there too');
  } finally { fs.linkSync = link; done(ws); }
});

test('review 5: a takeover that moved a fresh lock puts it back, also on a disk with no hard links', () => {
  const ws = tmp();
  const link = fs.linkSync, rename = fs.renameSync;
  try {
    const lock = path.join(ws, 'catalog.lock');
    const fresh = `${process.pid} ${'c'.repeat(16)}`;
    fs.writeFileSync(lock, `2147483646 ${'d'.repeat(16)}`);           // judged stale (its run is gone)…
    fs.renameSync = (from, to) => { fs.writeFileSync(from, fresh); fs.renameSync = rename; return rename(from, to); };  // …but replaced before the move
    fs.linkSync = () => { const e = new Error('no links'); e.code = 'ENOTSUP'; throw e; };
    const r = withCatalogLock(ws, () => ({ ran: true }), { waitMs: 150 });
    assert.equal(r.held, true, 'the live lock is waited on, never taken');
    assert.equal(fs.readFileSync(lock, 'utf8'), fresh, 'and it is back in place');
  } finally { fs.linkSync = link; fs.renameSync = rename; done(ws); }
});
