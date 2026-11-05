// `yad run checks` (issue #347): every pull request gate, run here before the push, as CI runs it.
// Each test builds a workspace — a Product and a code repo, each with a bare origin — and runs the real CLI
// from inside the code repo.
import './fixtures/git-quiet.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const YAD = path.join(ROOT, 'bin/yad.mjs');
// No CI variable, git identity or base from the shell that runs the suite.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^GIT_(AUTHOR|COMMITTER)_/.test(k) && !/^(CI|GITLAB_CI|GITHUB_ACTIONS|SDLC_BASE|SDLC_HUB_CONFIG|SDLC_PRODUCT_CONFIG)$/.test(k) && !/^(CI_|GITHUB_)/.test(k)));
// Nor the person's own git settings (a signing key, an allowed-signers list).
ENV.GIT_CONFIG_GLOBAL = '/dev/null';
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: ENV }).toString().trim();
const fm = (fields) => ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', ''].join('\n');

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function commitAll(dir, msg, files = {}) {
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
}
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'alice');
  git(dir, 'config', 'user.email', 'alice@corp.io');
  git(dir, 'config', 'commit.gpgsign', 'false');
}
function addOrigin(dir, bare) {
  git(path.dirname(bare), 'init', '-q', '--bare', '-b', 'main', path.basename(bare));
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
}
// Every installed gate, as `yad check --fix` puts them in a code repo.
function installChecks(repo) {
  fs.mkdirSync(path.join(repo, 'checks'), { recursive: true });
  for (const sk of ['yad-checks', 'yad-pr-template']) {
    const from = path.join(ROOT, 'skills', sk, 'templates', 'checks');
    for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(repo, 'checks', f));
  }
}

// W/product (registers ../backend), W/backend on a `feature` branch with one task commit, both with origins.
function workspace({ storyStatus = 'in-progress' } = {}) {
  const W = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-run-checks-')));
  fs.mkdirSync(path.join(W, 'remotes'));
  fs.writeFileSync(path.join(W, '.yad-workspace.json'), JSON.stringify({ version: 1, product: 'product' }));
  const product = path.join(W, 'product');
  initRepo(product);
  commitAll(product, 'chore: seed the Product', {
    '.sdlc/product.json': JSON.stringify({ platform: 'github', default_branch: 'main' }),
    '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'backend', path: '../backend' }] }),
    'epics/EP-demo/epic.md': `${fm({ epic: 'EP-demo', type: 'feature' })}\n# EP-demo\n`,
    'epics/EP-demo/stories/EP-demo-S01.md': `${fm({ story: 'EP-demo-S01', status: storyStatus })}\n# S01\n`,
  });
  addOrigin(product, path.join(W, 'remotes/product.git'));

  const backend = path.join(W, 'backend');
  initRepo(backend);
  installChecks(backend);
  commitAll(backend, 'chore: wire the gates', {
    '.gitignore': '.yad/\n',
    '.sdlc/product-link.json': JSON.stringify({ git_url: path.join(W, 'remotes/product.git'), path: '.yad/product', default_branch: 'main' }),
    'specs/EP-demo-S01/link.md': fm({ story: 'EP-demo-S01', epic: 'EP-demo', 'product-repo': '../../.yad/product' }),
  });
  addOrigin(backend, path.join(W, 'remotes/backend.git'));
  git(backend, 'checkout', '-q', '-b', 'feature');
  commitAll(backend, 'feat: add thing\n\nTask: EP-demo-S01-T01', { 'src/thing.js': 'x\n' });
  return { W, product, backend };
}

const yad = (cwd, args) => {
  const r = spawnSync(process.execPath, [YAD, ...args], { cwd, env: { ...ENV, PWD: cwd, YAD_NO_REPORT: '1', YAD_NO_UPDATE_CHECK: '1' }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
};

test('yad run checks: every gate runs with the Product\'s default branch where CI puts it, and it is removed after', () => {
  const { W, backend } = workspace();
  try {
    const r = yad(backend, ['run', 'checks', '--no-build']);
    // The only failure is the unsigned test commits: signatures are checked with git here.
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the Product's main \([0-9a-f]{12}\) is written to \.yad\/product, as CI checks it out, and removed after these gates/);
    assert.match(r.out, /PASS \[spec-link\]: \w+ EP-demo-S01-T01 -> specs\/EP-demo-S01\/link\.md/);
    assert.match(r.out, /PASS \[epic-open\]: \w+ EP-demo-S01-T01 -> EP-demo \(epic is open/);
    assert.match(r.out, /PASS \[lineage-check\]: \w+ EP-demo-S01-T01 -> EP-demo \(genesis feature epic\)/);
    assert.match(r.out, /PASS \[pr-title\]/);
    assert.match(r.out, /the title is the branch's one commit subject/);
    assert.match(r.out, /skipped: pr-template — no description: pass --body <file/);
    assert.match(r.out, /skipped: install-deps — skipped with --no-build/);
    assert.match(r.out, /FAIL \[verified-commits\]: \w+ is not signed/);
    assert.match(r.out, /the platform's Verified badge .* is judged in CI after the push/);
    assert.match(r.out, /1 gate failed: verified-commits/);
    assert.ok(!fs.existsSync(path.join(backend, '.yad')), 'the Product copy is removed after the run');
    assert.equal(git(backend, 'status', '--porcelain'), '', 'nothing is left in the work tree');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: the Product is read from its default branch, not from local unmerged edits — as in CI', () => {
  const { W, product, backend } = workspace({ storyStatus: 'shipped' });
  try {
    // Locally the story is reopened, but not merged: CI would still read it as shipped.
    write(product, { 'epics/EP-demo/stories/EP-demo-S01.md': `${fm({ story: 'EP-demo-S01', status: 'in-progress' })}\n# S01\n` });
    const r = yad(backend, ['run', 'checks', '--no-build']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL \[epic-open\]: \w+ EP-demo-S01-T01 targets SEALED epic EP-demo/);
    assert.match(git(product, 'status', '--porcelain'), /EP-demo-S01\.md/, 'the Product clone is left exactly as it was');
    assert.equal(git(product, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    assert.equal(git(product, 'diff', '--cached', '--name-only'), '', 'its index is untouched');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a contract file the base changed after the branch split is not this branch\'s change (#363 shape)', () => {
  const { W, backend } = workspace();
  try {
    git(backend, 'checkout', '-q', 'main');
    commitAll(backend, 'feat: a slice lands on main\n\nTask: EP-demo-S01-T02\nContract-Change: yes', { 'specs/EP-demo-S01/contracts/api.md': 'GET /x\n' });
    git(backend, 'push', '-q', 'origin', 'main');
    git(backend, 'checkout', '-q', 'feature');
    const r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /PASS \[contract-check\]: diff does not touch the contract surface/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: --title and --body are checked, and the run fails on any FAIL', () => {
  const { W, backend } = workspace();
  try {
    const body = path.join(W, 'body.md');
    fs.writeFileSync(body, '## Summary\nx\n');
    const r = yad(backend, ['run', 'checks', '--no-build', '--title', 'Add a thing.', '--body', body, '--json']);
    assert.equal(r.code, 1, r.out);
    const json = JSON.parse(r.stdout);
    const byName = Object.fromEntries(json.gates.map((g) => [g.name, g]));
    assert.equal(byName['pr-title'].status, 'fail');
    assert.ok(byName['pr-title'].fails.some((l) => /is not '<type>\(<scope>\)\?!\?: <description>'/.test(l)), JSON.stringify(byName['pr-title']));
    assert.equal(byName['pr-template'].status, 'fail');
    assert.ok(byName['pr-template'].fails.some((l) => /missing section '## Impact & Risk'/.test(l)), JSON.stringify(byName['pr-template']));
    assert.equal(byName['spec-link'].status, 'pass');
    assert.equal(json.kind, 'code');
    assert.equal(json.base, 'origin/main');
    assert.equal(json.product.placed, true);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a gate that differs from the shipped one is named; no checks/ folder is refused', () => {
  const { W, backend } = workspace();
  try {
    fs.appendFileSync(path.join(backend, 'checks/spec-link.sh'), '\n# a local edit\n');
    let r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /checks\/spec-link\.sh is not the gate this yadflow ships — CI runs the committed copy; if it is an older one, `yad update` replaces it/);
    fs.rmSync(path.join(backend, 'checks'), { recursive: true, force: true });
    r = yad(backend, ['run', 'checks']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no checks\/ folder in .* — the gates are not installed here/);
    r = yad(backend, ['run', 'nope']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /unknown run action: nope \(checks\)/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: commits signed with a key git can check pass verified-commits here', { skip: spawnSync('ssh-keygen', ['-?']).error && 'needs ssh-keygen' }, () => {
  const { W, backend } = workspace();
  try {
    const key = path.join(W, 'key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { stdio: 'pipe' });
    fs.writeFileSync(path.join(W, 'allowed'), `alice@corp.io ${fs.readFileSync(`${key}.pub`, 'utf8')}`);
    for (const [k, v] of [['gpg.format', 'ssh'], ['user.signingkey', key], ['gpg.ssh.allowedSignersFile', path.join(W, 'allowed')]]) git(backend, 'config', k, v);
    git(backend, 'commit', '-q', '--amend', '--no-edit', '-S');
    const r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /PASS \[verified-commits\]: \w+ is signed/);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /passed, \d+ skipped \(a skipped gate is not a pass\) — push when ready/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: install-deps and build/test/lint run by default', () => {
  const { W, backend } = workspace();
  try {
    commitAll(backend, 'chore: scripts\n\nTask: EP-demo-S01-T01', {
      // The build job never has the Product checked out in CI, so the copy must not be there yet.
      'package.json': JSON.stringify({ name: 'b', version: '0.0.0', scripts: { lint: 'node -e "process.exit(require(\'fs\').existsSync(\'.yad/product\') ? 1 : 0)"', build: 'node -e ""', test: 'node -e "process.exit(1)"' } }),
      'package-lock.json': JSON.stringify({ name: 'b', version: '0.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'b', version: '0.0.0' } } }),
    });
    const r = yad(backend, ['run', 'checks', '--title', 'feat: add thing']);
    assert.match(r.out, /✓ install-deps/);
    assert.doesNotMatch(r.out, /npm run lint' failed/, 'lint did not see a Product copy');
    assert.match(r.out, /FAIL \[build\/test\/lint\]: '.*npm run test' failed/);
    assert.equal(r.code, 1, r.out);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: from the Product, the Product gates run with the branch and changed paths CI passes', () => {
  const { W, product } = workspace();
  try {
    fs.mkdirSync(path.join(product, 'checks'), { recursive: true });
    for (const sk of ['yad-checks', 'yad-pr-template']) {
      const from = path.join(ROOT, 'skills', sk, 'templates', 'checks');
      for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(product, 'checks', f));
    }
    commitAll(product, 'chore: wire the gates', {});
    git(product, 'push', '-q', 'origin', 'main');
    git(product, 'checkout', '-q', '-b', 'tooling');
    commitAll(product, 'ci: tune a workflow', { 'notes.md': 'x\n' });
    const r = yad(product, ['run', 'checks']);
    assert.match(r.out, /Product product · branch tooling · base origin\/main/);
    assert.match(r.out, /PASS \[commit-message\]/);
    assert.match(r.out, /PASS \[pr-title\]/);
    assert.match(r.out, /✓ ledger-guard/);
    assert.match(r.out, /✓ member-check/);
    assert.doesNotMatch(r.out, /spec-link|contract-check|written to/);
    // A Shape artifact on a tooling branch fails, because the changed paths are passed as CI passes them.
    commitAll(product, 'docs: edit the epic', { 'epics/EP-demo/epic.md': `${fm({ epic: 'EP-demo', type: 'feature' })}\n# EP-demo, edited\n` });
    const r2 = yad(product, ['run', 'checks', '--title', 'docs: edit the epic']);
    assert.match(r2.out, /FAIL \[pr-title\]: head 'tooling' changes Shape artifacts/);
    assert.equal(r2.code, 1, r2.out);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a Product review branch takes no commit subject as its title', () => {
  const { W, product } = workspace();
  try {
    fs.mkdirSync(path.join(product, 'checks'), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'skills/yad-pr-template/templates/checks'))) fs.copyFileSync(path.join(ROOT, 'skills/yad-pr-template/templates/checks', f), path.join(product, 'checks', f));
    commitAll(product, 'chore: wire the gates', {});
    git(product, 'push', '-q', 'origin', 'main');
    git(product, 'checkout', '-q', '-b', 'review/EP-demo/epic');
    commitAll(product, 'docs: draft the epic', { 'epics/EP-demo/epic.md': `${fm({ epic: 'EP-demo', type: 'feature' })}\n# EP-demo, drafted\n` });
    let r = yad(product, ['run', 'checks']);
    assert.match(r.out, /skipped: pr-title — a review branch: pass --title "review: <artifact> \(EP-<slug>\)"/);
    r = yad(product, ['run', 'checks', '--title', 'review: epic (EP-demo)']);
    assert.match(r.out, /PASS \[pr-title\]/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: --base picks the base, and --no-fetch reads the last fetched one', () => {
  const { W, backend } = workspace();
  try {
    // A commit on the remote main this clone has not fetched.
    const other = path.join(W, 'other');
    git(W, 'clone', '-q', '-b', 'main', path.join(W, 'remotes/backend.git'), other);
    git(other, 'config', 'user.name', 'bob');
    git(other, 'config', 'user.email', 'bob@corp.io');
    commitAll(other, 'chore: on main meanwhile', { 'b.txt': 'b\n' });
    git(other, 'push', '-q', 'origin', 'main');
    const before = git(backend, 'rev-parse', 'origin/main');
    yad(backend, ['run', 'checks', '--no-build', '--no-fetch']);
    assert.equal(git(backend, 'rev-parse', 'origin/main'), before, '--no-fetch fetches nothing');
    yad(backend, ['run', 'checks', '--no-build']);
    assert.notEqual(git(backend, 'rev-parse', 'origin/main'), before, 'the base is fetched first');
    const r = yad(backend, ['run', 'checks', '--no-build', '--base', 'main']);
    assert.match(r.out, /base main\b/);
    const bad = yad(backend, ['run', 'checks', '--base', 'nope']);
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /base 'nope' is not a commit here/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a path CI refuses fails here too, and nothing outside the repo is written', () => {
  const { W, backend } = workspace();
  try {
    // .yad is a symlink to a folder outside the repo.
    fs.mkdirSync(path.join(W, 'shared'));
    fs.symlinkSync(path.join(W, 'shared'), path.join(backend, '.yad'));
    let r = yad(backend, ['run', 'checks', '--no-build']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL \[product-checkout\]: '\.yad' is a symlink — the Product is not written through it/);
    assert.deepEqual(fs.readdirSync(path.join(W, 'shared')), [], 'nothing written through the link');
    fs.rmSync(path.join(backend, '.yad'));
    // A default_branch that git would read as an option.
    git(backend, 'checkout', '-q', 'main');
    commitAll(backend, 'chore: odd record', { '.sdlc/product-link.json': JSON.stringify({ git_url: 'x', path: '.yad/product', default_branch: `--upload-pack=touch ${path.join(W, 'PWNED')};git-upload-pack` }) });
    git(backend, 'push', '-q', 'origin', 'main');
    git(backend, 'checkout', '-q', 'feature');
    r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /FAIL \[product-checkout\]: \.sdlc\/product-link\.json on origin\/main names a default_branch git cannot use as a branch name/);
    assert.ok(!fs.existsSync(path.join(W, 'PWNED')), 'the value never reaches git as an option');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a record CI refuses says what to change, as product-checkout does (#382)', () => {
  const { W, backend } = workspace();
  try {
    const onBase = (record) => {
      git(backend, 'checkout', '-q', 'main');
      commitAll(backend, 'chore: change the record', { '.sdlc/product-link.json': record });
      git(backend, 'push', '-q', 'origin', 'main');
      git(backend, 'checkout', '-q', 'feature');
      return yad(backend, ['run', 'checks', '--no-build']);
    };
    // A path that is set but outside the repo: `yad check --fix` keeps it, so it is changed and merged first.
    let r = onBase(JSON.stringify({ git_url: 'x', path: '../elsewhere' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /says path "\.\.\/elsewhere", which is not a folder inside this repo — .*\. Change path in it to one, such as \.yad\/product, and merge that change first: the record is read from origin\/main, so changing it on this branch does not help$/m);
    // No path: `yad check --fix --push` writes one.
    r = onBase(JSON.stringify({ git_url: 'x' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names no path — .*; run `yad check --fix --push` from the Product, on a machine that has this repo cloned and on its default branch; it writes path \.yad\/product to the record there\. Or set path yourself and merge that change first$/m);
    // Set but not a folder (only spaces), and set but unreadable by the gate (a quote): change it.
    r = onBase(JSON.stringify({ git_url: 'x', path: '   ' }));
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('says path "   ", which is not a folder inside this repo'), r.out);
    r = onBase(JSON.stringify({ git_url: 'x', path: 'a"b' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names a path the gate cannot read \(it is written with a JSON escape, a quote or a backslash\) — .*\. Change path in it to a plain folder such as \.yad\/product, and merge that change first: the record is read from origin\/main$/m);
    // A path written with a JSON escape: the gate reads the raw text, so it cannot read this one either.
    r = onBase('{"git_url": "x", "path": ".yad\\/product"}');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names a path the gate cannot read/);
    // A git_url written with an escape: the gate reads none and checks nothing out, so nothing fails here.
    r = onBase('{"git_url": "https:\\/\\/host\\/org\\/p.git", "path": "../elsewhere"}');
    assert.doesNotMatch(r.out, /FAIL \[product-checkout\]/, r.out);
    assert.match(r.out, /names a git_url CI's product-checkout cannot read \(it is written with a JSON escape, a quote or a backslash\), so CI checks no Product out — write it in the record without escapes and merge that change first\. Nothing is written here/);
    assert.ok(!fs.existsSync(path.join(W, 'elsewhere')), r.out);
    // An empty file, or one that does not parse with no git_url the gate can read: as in CI, a note.
    for (const text of ['', '{"path": "../elsewhere"']) {
      r = onBase(text);
      assert.doesNotMatch(r.out, /FAIL \[product-checkout\]/, r.out);
      assert.match(r.out, /names no git_url, so CI checks no Product out/);
    }
    // A path that is not ASCII comes back as written, and a no-break space is not a space to the gate.
    r = onBase(JSON.stringify({ git_url: 'x', path: '../café' }));
    assert.ok(r.out.includes('says path "../café"'), r.out);
    r = onBase(JSON.stringify({ git_url: 'x', path: '\u00a0' }));
    assert.doesNotMatch(r.out, /says path/, r.out);
    assert.ok(r.out.includes('is written to \u00a0, as CI checks it out'), r.out);
    assert.ok(!fs.existsSync(path.join(backend, '\u00a0')), 'the copy is removed after the gates');
    // A NUL byte in the value: the gate reads past it, so the value comes back without it…
    r = onBase('{"git_url": "x", "path": "../a\u0000b"}');
    assert.match(r.out, /says path "\.\.\/ab"/);
    r = onBase('{"git_url": "x", "path": ".yad/a\u0000b"}');
    // …and one that passes the path checks reaches git with the NUL gone: the Product is written to .yad/ab.
    assert.doesNotMatch(r.out, /ERR_INVALID_ARG_VALUE|null bytes/, r.out);
    assert.match(r.out, /is written to \.yad\/ab, as CI checks it out/, r.out);
    assert.ok(!fs.existsSync(path.join(backend, '.yad/ab')), 'the copy is removed after the gates');
    // A nested key: the gate reads the last "path" in the text, wherever it sits, and so does this.
    r = onBase('{"git_url": "x", "path": ".yad/product", "meta": {"path": "../n"}}');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /says path "\.\.\/n", which is not a folder inside this repo/);
    // An escaped default_branch reads as none, as in CI (which then clones the remote's default branch).
    r = onBase('{"git_url": "x", "path": "../e", "default_branch": "ma\\/in"}');
    assert.doesNotMatch(r.out, /default_branch git cannot use/, r.out);
    assert.match(r.out, /says path "\.\.\/e"/);
    // A duplicate key whose last copy is escaped: the gate reads the earlier one, and so does this.
    r = onBase('{"git_url": "x", "path": "../a", "path": "b\\/c"}');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /says path "\.\.\/a", which is not a folder inside this repo/);
    // A path that is not a string: `yad check --fix` replaces it.
    r = onBase(JSON.stringify({ git_url: 'x', path: 5 }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names no path — /);
    // A record that does not parse is read field by field, as CI reads it: its path still fails.
    r = onBase('{"git_url": "x", "path": "../elsewhere"');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /says path "\.\.\/elsewhere", which is not a folder inside this repo/);
    // No git_url: CI clones nothing and says so before it reads the path, so neither fails here.
    r = onBase(JSON.stringify({ path: '../elsewhere' }));
    assert.doesNotMatch(r.out, /FAIL \[product-checkout\]/, r.out);
    assert.match(r.out, /names no git_url, so CI checks no Product out/);
    // A tracked folder: untrack it here, or move the path on the base.
    git(backend, 'checkout', '-q', 'main');
    commitAll(backend, 'chore: a tracked folder', { '.sdlc/product-link.json': JSON.stringify({ git_url: 'x', path: 'prod' }), 'prod/x.txt': 'x\n' });
    git(backend, 'push', '-q', 'origin', 'main');
    git(backend, 'checkout', '-q', 'feature');
    git(backend, 'merge', '-q', '--no-edit', 'main');
    r = yad(backend, ['run', 'checks', '--no-build']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /'prod' holds files this repo tracks — .*Untrack them only if they do not belong in this repo \(git rm -r --cached -- 'prod', and add the folder to \.gitignore\), or change path in \.sdlc\/product-link\.json to an untracked folder such as \.yad\/product and merge that change first \(the record is read from origin\/main\)$/m);
    // A quote in the path is written the shell's way in the command to paste, as the gate writes it.
    git(backend, 'checkout', '-q', 'main');
    commitAll(backend, 'chore: a quoted folder', { '.sdlc/product-link.json': JSON.stringify({ git_url: 'x', path: "it's" }), "it's/x.txt": 'x\n' });
    git(backend, 'push', '-q', 'origin', 'main');
    git(backend, 'checkout', '-q', 'feature');
    git(backend, 'merge', '-q', '--no-edit', 'main');
    r = yad(backend, ['run', 'checks', '--no-build']);
    assert.ok(r.out.includes("(git rm -r --cached -- 'it'\\''s', and add the folder to .gitignore)"), r.out);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: an SSH signature git has no allowed-signers list for is "cannot check here", not "not signed"', { skip: spawnSync('ssh-keygen', ['-?']).error && 'needs ssh-keygen' }, () => {
  const { W, backend } = workspace();
  try {
    const key = path.join(W, 'key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { stdio: 'pipe' });
    for (const [k, v] of [['gpg.format', 'ssh'], ['user.signingkey', key]]) git(backend, 'config', k, v);
    git(backend, 'commit', '-q', '--amend', '--no-edit', '-S');
    const r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /note \[verified-commits\]: \w+ is signed, but this machine cannot check the key/);
    assert.doesNotMatch(r.out, /is not signed/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: Ctrl-C stops the run even when the gate catches it, and the copy is gone', { skip: process.platform === 'win32' && 'process groups' }, async () => {
  const { W, backend } = workspace();
  try {
    commitAll(backend, 'chore: scripts\n\nTask: EP-demo-S01-T01', {
      'package.json': JSON.stringify({ name: 'b', version: '0.0.0', scripts: { lint: 'node -e "process.on(\'SIGINT\',()=>process.exit(130));process.on(\'SIGTERM\',()=>process.exit(143));setTimeout(()=>{},30000)"', build: 'node -e ""', test: 'node -e ""' } }),
      'package-lock.json': JSON.stringify({ name: 'b', version: '0.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'b', version: '0.0.0' } } }),
    });
    for (const sig of ['SIGINT', 'SIGTERM']) {
      const child = spawn(process.execPath, [YAD, 'run', 'checks', '--title', 'feat: x'], { cwd: backend, env: { ...ENV, PWD: backend, YAD_NO_REPORT: '1' }, detached: true });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      const started = Date.now();
      while (!/build\/test\/lint\]? lint…|\[build\/test\/lint\] lint/.test(out) && Date.now() - started < 20000) await sleep(100);
      await sleep(500);
      // Ctrl-C reaches the whole group; a plain kill reaches yad alone.
      if (sig === 'SIGINT') process.kill(-child.pid, sig); else process.kill(child.pid, sig);
      const code = await new Promise((r) => child.on('close', r));
      assert.equal(code, sig === 'SIGINT' ? 130 : 143, `${sig}: ${out}`);
      assert.match(out, /stopped \(SIG(INT|TERM)\) — nothing after that gate ran/, out);
      assert.doesNotMatch(out, /\ncontract-check\n/, `${sig}: no later gate ran`);
      assert.ok(Date.now() - started < 25000, `${sig}: it stopped promptly`);
    }
    assert.ok(!fs.existsSync(path.join(backend, '.yad')));
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: member-check is left to CI when a member file changes; a missing --body file is refused', () => {
  const { W, product } = workspace();
  try {
    fs.mkdirSync(path.join(product, 'checks'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'skills/yad-checks/templates/checks/member-check.mjs'), path.join(product, 'checks/member-check.mjs'));
    commitAll(product, 'chore: wire the gate', {});
    git(product, 'push', '-q', 'origin', 'main');
    git(product, 'checkout', '-q', '-b', 'join');
    commitAll(product, 'chore: join', { '.sdlc/members/github-alice.json': '{"accounts":[]}\n' });
    let r = yad(product, ['run', 'checks']);
    assert.match(r.out, /skipped: member-check — a member file changes, and the gate needs the PR's author, which only CI has/);
    r = yad(product, ['run', 'checks', '--body', 'nope.md']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /--body file not found: nope\.md/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: the base follows the registry like yad open-pr, and GitLab warns at the 2700-character cut', () => {
  const { W, product, backend } = workspace();
  try {
    git(backend, 'checkout', '-q', '-b', 'develop', 'main');
    git(backend, 'push', '-q', 'origin', 'develop');
    git(backend, 'checkout', '-q', 'feature');
    write(product, { '.sdlc/repos.json': JSON.stringify({ repos: [{ name: 'backend', path: '../backend', default_branch: 'develop', platform: 'gitlab' }] }) });
    const body = path.join(W, 'body.md');
    fs.writeFileSync(body, `## Summary\n${'x'.repeat(2800)}\n`);
    const r = yad(backend, ['run', 'checks', '--no-build', '--body', body]);
    assert.match(r.out, /base origin\/develop/);
    assert.match(r.out, /the description is \d+ characters; GitLab hands CI only the first 2700/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a gate that exits 143 on its own is a FAIL, and the gates after it still run', () => {
  const { W, backend } = workspace();
  try {
    fs.writeFileSync(path.join(backend, 'checks/risk-map-check.sh'), '#!/usr/bin/env bash\necho "FAIL [risk-map]: a helper got SIGTERM"\nexit 143\n');
    const r = yad(backend, ['run', 'checks', '--no-build']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /✗ risk-map/);
    assert.match(r.out, /PASS \[epic-open\]/, 'the gates after it ran');
    assert.doesNotMatch(r.out, /stopped/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: the Product copy is gone before any other gate, whichever Product gates are installed', () => {
  const { W, backend } = workspace();
  try {
    fs.rmSync(path.join(backend, 'checks/reconcile-debt-check.sh'));
    fs.writeFileSync(path.join(backend, 'checks/backfill-check.sh'), '#!/usr/bin/env bash\nif [ -e .yad/product ]; then echo "FAIL [backfill]: COPY PRESENT"; exit 1; fi\necho "PASS [backfill]: no copy"\n');
    const r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /PASS \[epic-open\]/);
    assert.match(r.out, /PASS \[backfill\]: no copy/, r.out);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a record with no default_branch reads the Product clone\'s own default branch', () => {
  const { W, product, backend } = workspace({ storyStatus: 'shipped' });
  try {
    // The Product's trunk is master; main is gone.
    git(product, 'branch', '-m', 'main', 'master');
    git(product, 'push', '-q', 'origin', 'master');
    git(path.join(W, 'remotes/product.git'), 'symbolic-ref', 'HEAD', 'refs/heads/master');
    git(product, 'push', '-q', 'origin', '--delete', 'main');
    git(product, 'remote', 'set-head', 'origin', '-a');
    git(backend, 'checkout', '-q', 'main');
    commitAll(backend, 'chore: record with no branch', { '.sdlc/product-link.json': JSON.stringify({ git_url: path.join(W, 'remotes/product.git'), path: '.yad/product', default_branch: null }) });
    git(backend, 'push', '-q', 'origin', 'main');
    git(backend, 'checkout', '-q', 'feature');
    git(backend, 'rebase', '-q', 'main');
    const r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /the record names no default_branch, so the Product clone's origin\/HEAD says it: master/);
    assert.match(r.out, /FAIL \[epic-open\]: \w+ EP-demo-S01-T01 targets SEALED epic EP-demo/, 'master was read');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a stop during a Product gate removes the copy; a gate that ignores the signal is killed', { skip: process.platform === 'win32' && 'process groups' }, async () => {
  const { W, backend } = workspace();
  try {
    fs.writeFileSync(path.join(backend, 'checks/lineage-check.sh'), '#!/usr/bin/env bash\necho "lineage started"\ntrap "" INT TERM HUP\nsleep 30\n');
    const child = spawn(process.execPath, [YAD, 'run', 'checks', '--no-build'], { cwd: backend, env: { ...ENV, PWD: backend, YAD_NO_REPORT: '1' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const started = Date.now();
    while (!/lineage started/.test(out) && Date.now() - started < 20000) await sleep(100);
    assert.ok(fs.existsSync(path.join(backend, '.yad/product')), 'the copy is there while the gate runs');
    child.kill('SIGINT');
    const t = Date.now();
    const code = await new Promise((r) => child.on('close', r));
    assert.equal(code, 130, out);
    assert.ok(Date.now() - t < 12000, 'killed after the grace period, not after the gate\'s 30 seconds');
    assert.ok(!fs.existsSync(path.join(backend, '.yad')), 'the copy is gone');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a product-checkout FAIL skips the four gates; uncommitted work is named, a rename once', () => {
  const { W, backend } = workspace();
  try {
    write(backend, { 'src/new.js': 'not added\n' });
    git(backend, 'mv', 'src/thing.js', 'src/moved.js');
    // A rename in the work tree (intent to add) is one entry too: ` R new\0old\0`.
    fs.renameSync(path.join(backend, '.gitignore'), path.join(backend, 'ignore.txt'));
    git(backend, 'add', '-N', 'ignore.txt');
    fs.mkdirSync(path.join(W, 'shared'));
    fs.symlinkSync(path.join(W, 'shared'), path.join(backend, '.yad'));
    const r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /uncommitted changes are built and tested here but are not in the push \((ignore\.txt, src\/moved\.js, src\/new\.js|src\/moved\.js, ignore\.txt, src\/new\.js)\)/);
    assert.match(r.out, /skipped: contract-check — product-checkout failed, so it was not run \(as in CI\)/);
    assert.match(r.out, /✗ product-checkout — the Product could not be put where CI puts it/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('yad run checks: a folder already there is read as it is and kept; a run removes only what it wrote', () => {
  const { W, backend } = workspace();
  try {
    write(backend, { '.yad/notes.txt': 'mine\n' });
    let r = yad(backend, ['run', 'checks', '--no-build']);
    assert.ok(fs.existsSync(path.join(backend, '.yad/notes.txt')), 'a .yad/ of the user\'s own is kept');
    assert.ok(!fs.existsSync(path.join(backend, '.yad/product')), 'only the copy is removed');
    // A copy a killed run left behind, or anyone's folder: read as it is, never removed.
    write(backend, { '.yad/product/epics/x.md': 'left\n' });
    r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /\.yad\/product is already there, so it is read as it is — it may not be the Product's default branch \(another run may be using it, or a run that was killed left it\): remove it to read the default branch/);
    assert.ok(fs.existsSync(path.join(backend, '.yad/product/epics/x.md')));
    fs.rmSync(path.join(backend, '.yad'), { recursive: true });
    // A file put into the folder the run made, while it runs, stays; the copy goes.
    fs.writeFileSync(path.join(backend, 'checks/lineage-check.sh'), '#!/usr/bin/env bash\necho note > .yad/notes.md\necho "PASS [lineage-check]: wrote a note"\n');
    r = yad(backend, ['run', 'checks', '--no-build']);
    assert.match(r.out, /PASS \[lineage-check\]: wrote a note/);
    assert.ok(fs.existsSync(path.join(backend, '.yad/notes.md')), 'the file someone put there stays');
    assert.ok(!fs.existsSync(path.join(backend, '.yad/product')), 'the copy is gone');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('removeParents and removeCopy: only the folders a run made, and only while each is empty', async () => {
  const { removeCopy, removeParents } = await import('../cli/run-checks.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-rm-'));
  try {
    const top = path.join(T, 'a', 'b');
    const dest = path.join(top, 'c', 'd');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(top, 'stray.txt'), 'kept\n');
    fs.writeFileSync(path.join(dest, 'x.md'), 'copy\n');
    removeCopy(dest, top);
    assert.ok(!fs.existsSync(dest), 'the copy goes');
    assert.ok(!fs.existsSync(path.join(top, 'c')), 'an empty folder the run made goes');
    assert.ok(fs.existsSync(path.join(top, 'stray.txt')), 'a folder with a file in it stays');
    // On Windows, Node 18/20 report what mkdir made in the long \\?\ form; it is read as path.join writes it.
    const { plainPath } = await import('../cli/run-checks.mjs');
    assert.equal(plainPath('\\\\?\\C:\\r\\.yad', path.win32), 'C:\\r\\.yad');
    assert.equal(plainPath('\\\\?\\UNC\\srv\\share\\r\\.yad', path.win32), '\\\\srv\\share\\r\\.yad');
    assert.equal(plainPath('C:\\r\\.yad', path.win32), 'C:\\r\\.yad');
    // A `created` that is not above dest removes nothing.
    fs.mkdirSync(path.join(T, 'e', 'f'), { recursive: true });
    removeParents(path.join(T, 'e', 'f', 'g'), path.join(T, 'other'));
    assert.ok(fs.existsSync(path.join(T, 'e', 'f')));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad run checks: a folder read as it was, removed while the Product gates read it, is said to be gone', () => {
  const { W, backend } = workspace();
  try {
    write(backend, { '.yad/product/epics/EP-demo/epic.md': 'someone else\'s copy\n' });
    // Another run ending: its copy goes while this run's Product gates run.
    fs.writeFileSync(path.join(backend, 'checks/lineage-check.sh'), '#!/usr/bin/env bash\nrm -rf .yad/product\necho "PASS [lineage-check]: x"\n');
    const r = yad(backend, ['run', 'checks', '--no-build', '--json']);
    assert.match(r.out, /\.yad\/product was removed while the Product gates read it \(another run ended\) — their answers may be wrong; run again/);
    assert.equal(JSON.parse(r.stdout).product.vanished, true);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

test('#450 yad run checks: a branch cut from another branch, with a base nobody chose, is warned about once — and the run goes on', () => {
  const { W, backend } = workspace();
  try {
    git(backend, 'checkout', '-q', '-b', 'develop', 'main');
    commitAll(backend, 'feat: other\n\nTask: EP-demo-S01-T09', { 'src/other.js': 'o\n' });
    git(backend, 'push', '-q', 'origin', 'develop');
    git(backend, 'checkout', '-q', '-b', 'feature-2');
    commitAll(backend, 'feat: two\n\nTask: EP-demo-S01-T02', { 'src/two.js': 't\n' });
    const r = yad(backend, ['run', 'checks', '--no-build']);
    const hits = r.out.match(/this branch holds 1 commit of other tasks from origin\/develop that origin\/main does not have, so it was likely cut from origin\/develop — pass --base origin\/develop, or --base origin\/main to check against main anyway/g) || [];
    assert.equal(hits.length, 1, r.out);
    assert.match(r.out, /PASS \[spec-link\]: \w+ EP-demo-S01-T02/, 'the gates still run');
    // A base someone chose is trusted: no warning.
    assert.doesNotMatch(yad(backend, ['run', 'checks', '--no-build', '--base', 'origin/main']).out, /likely cut from/);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});
