// Dependency-free tests that EXECUTE the bash check gates against scratch git repos.
// Run: node --test cli/test-checks.mjs
// verified-commits.sh is covered in cli/test.mjs; this file covers the rest of the
// production safety gates: spec-link, contract-check, build-test-lint, risk-route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECKS = path.join(ROOT, 'skills/yad-checks/templates/checks');
const RISK_ROUTE = path.join(ROOT, 'skills/yad-pr-template/templates/checks/risk-route.sh');

// Strip ambient git identity env (see cli/test.mjs for why) — and the two vars the gates resolve their
// base from: SDLC_BASE (the base branch) and SDLC_HUB_CONFIG (which hub.json to read default_branch
// out of). The repo's own docs tell developers to `export SDLC_BASE=…`, so leaking either would
// silence the no-base tests below on exactly the machines that followed the docs. Per-test overrides
// still work — runGate merges its `env` argument on top of this.
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(k) && k !== 'SDLC_BASE' && k !== 'SDLC_HUB_CONFIG',
  ),
);
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: GIT_ENV });

// A code repo with a `main` baseline and a `feature` branch checked out — the shape the
// gates see in CI. Returns the repo root.
function scaffoldRepo() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-checks-'));
  git(T, 'init', '-q');
  git(T, 'config', 'user.name', 'alice');
  git(T, 'config', 'user.email', 'alice@corp.io');
  fs.writeFileSync(path.join(T, 'a.txt'), '1');
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'seed');
  git(T, 'branch', '-q', '-M', 'main');
  git(T, 'checkout', '-q', '-b', 'feature');
  return T;
}

function commit(T, msg, files = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(T, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', msg);
}

const runGate = (script, cwd, args = ['main'], env = {}) => {
  try {
    const out = execFileSync('bash', [script, ...args], {
      cwd, env: { ...GIT_ENV, ...env }, stdio: 'pipe',
    });
    return { code: 0, out: out.toString() };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
};

// ---------- spec-link.sh ----------
const SPEC_LINK = path.join(CHECKS, 'spec-link.sh');

test('spec-link gate: Task trailer resolving to specs/<story>/link.md passes', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: add thing\n\nTask: EP-demo-S01-T01', {
    'src/thing.js': 'x',
    'specs/EP-demo-S01/link.md': 'story: EP-demo-S01\n',
  });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS \[spec-link\]: [0-9a-f]+ EP-demo-S01-T01 -> specs\/EP-demo-S01\/link\.md/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: commit without a Task trailer fails', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: unlinked change', { 'src/thing.js': 'x' });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 1, 'unlinked change must fail');
  assert.match(r.out, /has no 'Task:' trailer/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: maintenance commit (ci/chore/build/test) is exempt', () => {
  const T = scaffoldRepo();
  // No Task trailer, no spec — a chore commit must still PASS (CI wiring / dep bumps link no story).
  commit(T, 'chore(deps): bump x', { 'package.json': '{}' });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS \[spec-link\]: [0-9a-f]+ 'chore\(deps\): bump x' — maintenance commit, no Task trailer \(exempt\)/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: an exempt commit that CLAIMS a story still resolves it (issue #157)', () => {
  const T = scaffoldRepo();
  commit(T, 'chore(spec): tidy the spec\n\nTask: EP-demo-S01-T01', {
    'specs/EP-demo-S01/link.md': 'story: EP-demo-S01\n',
  });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /EP-demo-S01-T01 -> specs\/EP-demo-S01\/link\.md \(maintenance commit, trailer resolved anyway\)/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: an exempt commit whose Task trailer resolves to nothing FAILS (issue #157)', () => {
  const T = scaffoldRepo();
  // The exemption waives the REQUIREMENT for a link, never the VALIDITY of one that is claimed —
  // otherwise a `chore:` subject makes the trailer decorative and an unlinked commit of the same
  // shape is indistinguishable from a linked one.
  commit(T, 'chore(ci): rewire\n\nTask: EP-ghost-S01-T01', { '.github/x.yml': 'x' });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 1, 'a dangling story claim must fail even on an exempt commit');
  assert.match(r.out, /specs\/EP-ghost-S01\/ but link\.md is missing/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: an exempt commit with a MALFORMED Task trailer FAILS (issue #157)', () => {
  const T = scaffoldRepo();
  commit(T, 'test(spec): add a case\n\nTask: EP-demo-S01', {
    'specs/EP-demo-S01/link.md': 'story: EP-demo-S01\n',
  });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 1, 'a malformed trailer must fail even on an exempt commit');
  assert.match(r.out, /malformed Task trailer 'EP-demo-S01'/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: empty range (no non-merge commits) passes', () => {
  const T = scaffoldRepo();
  // feature branch is even with main — nothing to check.
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS \[spec-link\]: no non-merge commits/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: Task trailer with no link.md fails', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: add thing\n\nTask: EP-ghost-S02-T03', { 'src/thing.js': 'x' });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 1, 'missing link.md must fail');
  assert.match(r.out, /specs\/EP-ghost-S02\/ but link\.md is missing/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: malformed Task trailer (no -T<NN>) fails even if specs/<task>/link.md exists', () => {
  const T = scaffoldRepo();
  // 'EP-demo-S01' has no -T<NN> task suffix; it must be rejected as malformed, not pass
  // just because a specs/EP-demo-S01/link.md happens to exist.
  commit(T, 'feat: add thing\n\nTask: EP-demo-S01', {
    'src/thing.js': 'x',
    'specs/EP-demo-S01/link.md': 'story: EP-demo-S01\n',
  });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 1, 'malformed trailer must fail');
  assert.match(r.out, /malformed Task trailer 'EP-demo-S01' \(expected <story>-T<NN>\)/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: one linked + one unlinked story in range still fails', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: linked\n\nTask: EP-demo-S01-T01', {
    'src/a.js': 'x',
    'specs/EP-demo-S01/link.md': 'story: EP-demo-S01\n',
  });
  commit(T, 'feat: unlinked\n\nTask: EP-ghost-S01-T01', { 'src/b.js': 'y' });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 1, 'any unlinked task in the range must fail the gate');
  assert.match(r.out, /PASS \[spec-link\]: [0-9a-f]+ EP-demo-S01-T01/);
  assert.match(r.out, /FAIL \[spec-link\]: [0-9a-f]+ EP-ghost-S01-T01/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: unresolvable base fails closed', () => {
  const T = scaffoldRepo();
  const r = runGate(SPEC_LINK, T, ['origin/nope']);
  assert.equal(r.code, 1);
  assert.match(r.out, /base ref 'origin\/nope' not found/);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- contract-check.sh ----------
const CONTRACT = path.join(CHECKS, 'contract-check.sh');

test('contract-check gate: diff that only consumes the contract passes', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: implement endpoint\n\nTask: EP-demo-S01-T01', { 'src/api.js': 'x' });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /does not touch the contract surface/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: surface change without Contract-Change trailer fails', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: widen the API quietly', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 1, 'silent surface widening must fail');
  assert.match(r.out, /without a 'Contract-Change: yes' trailer/);
  assert.match(r.out, /Route back to the architecture gate/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: surface change with Contract-Change: yes passes (no upstream lock reachable)', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: widen API per re-locked contract\n\nContract-Change: yes', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /surface change accompanied by Contract-Change: yes/);
  fs.rmSync(T, { recursive: true, force: true });
});

// A link.md as `yad-spec` writes it: real frontmatter, `product-repo` written relative to THIS file's
// own directory (specs/<story>/) — `../../product` therefore points at <repo-root>/product.
const linkMd = (fields) =>
  ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', ''].join('\n');

// A product hub at <repo>/product carrying one epic's contract lock.
function seedProductLock(T, epic, hash, at = 'product') {
  fs.mkdirSync(path.join(T, at, 'epics', epic, '.sdlc'), { recursive: true });
  fs.writeFileSync(
    path.join(T, at, 'epics', epic, '.sdlc/contract-lock.json'),
    JSON.stringify({ hash: `sha256:${hash}` }),
  );
}

test('contract-check gate: Contract-Change claimed but link.md pins a stale hash fails', () => {
  const T = scaffoldRepo();
  // Product repo lives next to the code repo; lock hash differs from the pinned one.
  seedProductLock(T, 'EP-demo', 'b'.repeat(64));
  commit(T, 'feat: widen API\n\nContract-Change: yes', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
    'specs/EP-demo-S01/link.md': linkMd({
      story: 'EP-demo-S01', 'product-repo': '../../product', 'contract-lock': `sha256:${'a'.repeat(64)}`,
    }),
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 1, 'stale pinned hash must fail');
  assert.match(r.out, /still pins/);
  assert.match(r.out, /re-run yad-spec/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: Contract-Change with link.md matching the product lock passes', () => {
  const T = scaffoldRepo();
  const hash = 'c'.repeat(64);
  seedProductLock(T, 'EP-demo', hash);
  commit(T, 'feat: widen API\n\nContract-Change: yes', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
    'specs/EP-demo-S01/link.md': linkMd({
      story: 'EP-demo-S01', 'product-repo': '../../product', 'contract-lock': `sha256:${hash}`,
    }),
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /link\.md hash matches the product lock/);
  fs.rmSync(T, { recursive: true, force: true });
});

// (contract-check's product-repo forms are covered by the four-gate matrix below — an absolute path
// was already the one form it handled, so a bespoke case here pinned nothing.)

test('contract-check gate: unresolvable base fails closed', () => {
  const T = scaffoldRepo();
  const r = runGate(CONTRACT, T, ['origin/nope']);
  assert.equal(r.code, 1, 'undiffable range must never green-light');
  assert.match(r.out, /base ref 'origin\/nope' not found/);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- multi-story surface diffs (issue #161) ----------
// `git diff --name-only` is path-sorted, so reading ONE story off `head -1` validated whichever story
// sorted first and left every other quoted slice in the diff unpinned. Each case below is rigged so
// the story that would be read first is the one that does NOT fail.

// A story that quotes the surface: its slice + a link.md pinning `lock` against the shared product hub.
const storySlice = (story, lock) => ({
  [`specs/${story}/contracts/api.md`]: 'new endpoint\n',
  [`specs/${story}/link.md`]: linkMd({
    story, 'product-repo': '../../product', 'contract-lock': `sha256:${lock}`,
  }),
});

test('contract-check gate: a LATER story pinning a stale lock is not masked by a clean first one (issue #161)', () => {
  const T = scaffoldRepo();
  const hash = 'c'.repeat(64);
  seedProductLock(T, 'EP-demo', hash);
  commit(T, 'feat: widen API across both stories\n\nContract-Change: yes', {
    ...storySlice('EP-demo-S01', hash),                 // sorts first, pins the CURRENT lock
    ...storySlice('EP-demo-S02', 'a'.repeat(64)),       // sorts second, pins a STALE lock
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 1, `every changed slice must be pinned, not just the first:\n${r.out}`);
  assert.match(r.out, /specs\/EP-demo-S02\/link\.md still pins/);
  // ...and the clean story still reports, so the output names which slice is at fault.
  assert.match(r.out, /specs\/EP-demo-S01\/link\.md hash matches the product lock/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: a first story with no link.md does not defer the whole check (issue #161)', () => {
  const T = scaffoldRepo();
  seedProductLock(T, 'EP-demo', 'c'.repeat(64));
  commit(T, 'feat: widen API\n\nContract-Change: yes', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n', // sorts first, no link.md at all
    ...storySlice('EP-demo-S02', 'a'.repeat(64)),           // sorts second, pins a STALE lock
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 1, `a deferred story must not stand in for the ones behind it:\n${r.out}`);
  assert.match(r.out, /no specs\/EP-demo-S01\/link\.md — fidelity check deferred/);
  assert.match(r.out, /specs\/EP-demo-S02\/link\.md still pins/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: every story pinning the current lock passes, reporting each', () => {
  const T = scaffoldRepo();
  const hash = 'c'.repeat(64);
  seedProductLock(T, 'EP-demo', hash);
  commit(T, 'feat: widen API across both stories\n\nContract-Change: yes', {
    ...storySlice('EP-demo-S01', hash),
    ...storySlice('EP-demo-S02', hash),
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /specs\/EP-demo-S01\/link\.md hash matches the product lock/);
  assert.match(r.out, /specs\/EP-demo-S02\/link\.md hash matches the product lock/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: a product lock with no readable hash FAILs, never "hash matches"', () => {
  const T = scaffoldRepo();
  // A truncated / half-written / schema-changed lock: readable file, no parseable hash.
  fs.mkdirSync(path.join(T, 'product/epics/EP-demo/.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'product/epics/EP-demo/.sdlc/contract-lock.json'), '{}\n');
  commit(T, 'feat: widen API\n\nContract-Change: yes', storySlice('EP-demo-S01', 'a'.repeat(64)));
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 1, `an unparseable lock proves nothing and must not pass:\n${r.out}`);
  assert.match(r.out, /has no readable "hash": "sha256:…" value/);
  assert.doesNotMatch(r.out, /hash matches the product lock/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: a non-ASCII slice path still counts as the contract surface', () => {
  const T = scaffoldRepo();
  // git quote-wraps such paths in --name-only output unless core.quotePath is off, which used to hide
  // the slice from the surface pattern entirely — the gate PASSed an undeclared surface widening.
  commit(T, 'feat: widen the API quietly', {
    'specs/EP-démo-S01/contracts/api.md': 'new endpoint\n',
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 1, `one accented character must not buy a pass past the gate:\n${r.out}`);
  assert.match(r.out, /without a 'Contract-Change: yes' trailer/);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- base resolution with no explicit base (issue #161) ----------
// CI always passes the base; a local run does not. Defaulting to a hardcoded `origin/main` diffs the
// wrong range (or nothing at all) on a repo whose trunk is `develop`/`master`.

// A code repo CLONED from an origin whose default branch is `trunk`, so origin/HEAD points at it —
// the shape scaffoldRepo() cannot produce (it has no remote).
function scaffoldClonedRepo(trunk) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-origin-'));
  git(src, 'init', '-q');
  git(src, 'config', 'user.name', 'alice');
  git(src, 'config', 'user.email', 'alice@corp.io');
  fs.writeFileSync(path.join(src, 'a.txt'), '1');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'seed');
  git(src, 'branch', '-q', '-M', trunk);
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-checks-'));
  fs.rmSync(T, { recursive: true, force: true });
  git(os.tmpdir(), 'clone', '-q', src, T);
  git(T, 'config', 'user.name', 'alice');
  git(T, 'config', 'user.email', 'alice@corp.io');
  git(T, 'checkout', '-q', '-b', 'feature');
  return { T, src };
}

test('contract-check gate: with no base argument it diffs the remote default branch, not origin/main', () => {
  const { T, src } = scaffoldClonedRepo('develop');
  commit(T, 'feat: widen API\n\nContract-Change: yes', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
  });
  const r = runGate(CONTRACT, T, []); // no base: must resolve origin/HEAD -> origin/develop
  assert.equal(r.code, 0, `a develop-trunk repo must be diffable without naming the base:\n${r.out}`);
  assert.match(r.out, /no base given — diffing against 'origin\/develop'/);
  assert.doesNotMatch(r.out, /origin\/main/);
  assert.match(r.out, /diff touches the contract surface/);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: SDLC_BASE still wins over the auto-detected default branch', () => {
  const { T, src } = scaffoldClonedRepo('develop');
  commit(T, 'feat: unlinked change', { 'src/thing.js': 'x' });
  const r = runGate(SPEC_LINK, T, [], { SDLC_BASE: 'origin/nope' });
  assert.equal(r.code, 1);
  assert.match(r.out, /base ref 'origin\/nope' not found/);
  assert.doesNotMatch(r.out, /no base given/);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: a DANGLING origin/HEAD falls through to the next candidate', () => {
  // Trunk renamed master -> main: an old clone keeps origin/HEAD -> origin/master, and a prune removes
  // the ref it names. symbolic-ref still SUCCEEDS, so a fallback that only fires on failure would fail
  // the gate closed on a fully-fetched repo — for a base the developer never named.
  const { T, src } = scaffoldClonedRepo('master');
  git(T, 'update-ref', 'refs/remotes/origin/main', 'origin/master');
  git(T, 'update-ref', '-d', 'refs/remotes/origin/master');
  commit(T, 'feat: consume the contract', { 'src/api.js': 'x' });
  const r = runGate(CONTRACT, T, []);
  assert.equal(r.code, 0, `a dangling origin/HEAD must not fail a diffable repo:\n${r.out}`);
  assert.match(r.out, /no base given — diffing against 'origin\/main'/);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: a configured default_branch outranks the remote default (the CLI order)', () => {
  // `.sdlc/hub.json`'s default_branch is what the CLI resolves first (cli/hubcommit.mjs) — it is how a
  // team overrides a stale origin/HEAD, so a gate that ignored it would diff a different range than
  // every `yad` command on the same repo.
  const { T, src } = scaffoldClonedRepo('develop');
  git(T, 'update-ref', 'refs/remotes/origin/main', 'origin/develop');
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ default_branch: 'main' }, null, 2));
  commit(T, 'feat: consume the contract', { 'src/api.js': 'x' });
  const r = runGate(CONTRACT, T, []);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no base given — diffing against 'origin\/main'/); // not origin/develop
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: default_branch is read even when the JSON puts it across lines', () => {
  // A key and its value on separate lines is legal JSON. A per-line match silently misses it, and
  // "silently misses the configured branch" means diffing whatever origin/HEAD happens to name.
  const { T, src } = scaffoldClonedRepo('develop');
  git(T, 'update-ref', 'refs/remotes/origin/main', 'origin/develop');
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), '{\n  "default_branch":\n    "main"\n}\n');
  commit(T, 'feat: consume the contract', { 'src/api.js': 'x' });
  const r = runGate(CONTRACT, T, []);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no base given — diffing against 'origin\/main'/);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: a product lock split across lines still parses (it must not FAIL as broken)', () => {
  const T = scaffoldRepo();
  const hash = 'c'.repeat(64);
  fs.mkdirSync(path.join(T, 'product/epics/EP-demo/.sdlc'), { recursive: true });
  fs.writeFileSync(
    path.join(T, 'product/epics/EP-demo/.sdlc/contract-lock.json'),
    `{\n  "hash":\n    "sha256:${hash}"\n}\n`,
  );
  commit(T, 'feat: widen API\n\nContract-Change: yes', storySlice('EP-demo-S01', hash));
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 0, `a formatting choice must not read as a broken lock:\n${r.out}`);
  assert.match(r.out, /hash matches the product lock/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('commit-message gate: an EMPTY base argument counts as no base, like every other gate', () => {
  const T = scaffoldRepo();
  const r = runGate(path.join(CHECKS, 'commit-message.sh'), T, ['--profile', 'code', '']);
  assert.match(r.out, /no base given — diffing against 'origin\/main'/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: with no remote at all the base falls back to origin/main and fails closed', () => {
  const T = scaffoldRepo(); // no remote, so origin/HEAD does not resolve
  const r = runGate(CONTRACT, T, []);
  assert.equal(r.code, 1, 'an unresolvable auto-detected base must never green-light');
  assert.match(r.out, /no base given — diffing against 'origin\/main'/);
  assert.match(r.out, /base ref 'origin\/main' not found/);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- phase-6 thread gates: product-repo resolution (issue #149) ----------
// All three read the owning epic through link.md's `product-repo`. Both the ABSOLUTE and the RELATIVE
// form must reach the hub — an unresolvable path degrades each gate to a PASS-with-note, i.e. it stops
// gating without saying so.
const LINEAGE = path.join(CHECKS, 'lineage-check.sh');
const EPIC_OPEN = path.join(CHECKS, 'epic-open.sh');
const DEBT = path.join(CHECKS, 'reconcile-debt-check.sh');

// A hub with one epic. `fm` goes into epic.md frontmatter; `stories` maps story id -> status.
function seedHubEpic(hub, epic, { fm = {}, stories = {}, debt = null } = {}) {
  const dir = path.join(hub, 'epics', epic);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'epic.md'), linkMd({ epic, ...fm }) + `\n# ${epic}\n`);
  for (const [id, status] of Object.entries(stories)) {
    fs.mkdirSync(path.join(dir, 'stories'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'stories', `${id}.md`), linkMd({ story: id, status }) + `\n# ${id}\n`);
  }
  if (debt) {
    fs.mkdirSync(path.join(dir, '.sdlc'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.sdlc/reconcile-debt.json'), JSON.stringify(debt));
  }
  return dir;
}

// A code-repo commit whose Task trailer links a story pointing at `productRepo`.
const linkedCommit = (T, productRepo, epic = 'EP-demo') => commit(
  T, 'feat: add thing\n\nTask: EP-demo-S01-T01',
  {
    'src/thing.js': 'x',
    'specs/EP-demo-S01/link.md': linkMd({ story: 'EP-demo-S01', epic, 'product-repo': productRepo }),
  },
);

// The invariant is that all four hub-reading gates resolve `product-repo` IDENTICALLY — a value one
// gate can reach must be reachable from every gate, or the unreachable ones degrade to a
// PASS-with-note and silently stop gating (issue #149). So this is a matrix, not four bespoke cases:
// every gate × every path form a link.md in the wild can carry, each fixture rigged so the gate FAILs
// iff it actually read the hub.
//
// `link-relative` is the canonical form yad-spec writes; `root-relative` is what contract-check
// historically resolved, so link.md files authored against it must keep working; `unfenced` is a
// pre-frontmatter link.md, which the whole-file `sed` used to read and the frontmatter reader alone
// would silently see as empty.
const GATES = [
  {
    name: 'lineage-check',
    script: LINEAGE,
    seed: (hub) => seedHubEpic(hub, 'EP-demo', { fm: { kind: 'change' } }), // kind:change, no parent
    expect: /is kind:change but declares no 'parent:'/,
  },
  {
    name: 'epic-open',
    script: EPIC_OPEN,
    seed: (hub) => seedHubEpic(hub, 'EP-demo', { stories: { 'EP-demo-S01': 'shipped' } }), // sealed
    expect: /targets SEALED epic EP-demo/,
  },
  {
    name: 'reconcile-debt',
    script: DEBT,
    seed: (hub) => {
      seedHubEpic(hub, 'EP-root');
      seedHubEpic(hub, 'EP-demo', { fm: { kind: 'change', parent: 'EP-root' } });
      seedHubEpic(hub, 'EP-fix', { fm: { kind: 'hotfix', parent: 'EP-root' }, debt: [{ status: 'open' }] });
    },
    expect: /carries OPEN hotfix debt/,
  },
  {
    name: 'contract-check',
    script: CONTRACT,
    seed: (hub) => seedProductLock(hub, 'EP-demo', 'b'.repeat(64), '.'),
    // contract-check needs a surface change + the claim trailer; its link.md also pins a hash.
    files: {
      'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
    },
    subject: 'feat: widen API\n\nContract-Change: yes',
    extraLink: { 'contract-lock': `sha256:${'a'.repeat(64)}` },
    expect: /still pins/,
  },
];

// Where the hub lives on disk, and what `product-repo:` has to say to reach it from specs/<story>/.
const FORMS = [
  { name: 'absolute', hub: (T, out) => out, value: (T, out) => out },
  { name: 'link-relative', hub: (T) => path.join(T, 'product'), value: () => '../../product' },
  { name: 'root-relative', hub: (T) => path.join(T, 'product'), value: () => 'product' },
  { name: 'unfenced link.md', hub: (T) => path.join(T, 'product'), value: () => '../../product', unfenced: true },
];

for (const g of GATES) {
  for (const form of FORMS) {
    test(`${g.name} gate: reaches the hub with a ${form.name} product-repo (issue #149)`, () => {
      const T = scaffoldRepo();
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hub-'));
      const hub = form.hub(T, outside);
      g.seed(hub);
      const fields = { story: 'EP-demo-S01', epic: 'EP-demo', 'product-repo': form.value(T, outside), ...(g.extraLink || {}) };
      commit(T, g.subject || 'feat: add thing\n\nTask: EP-demo-S01-T01', {
        'src/thing.js': 'x',
        ...(g.files || {}),
        // An unfenced link.md is the pre-frontmatter shape still committed in code repos.
        'specs/EP-demo-S01/link.md': form.unfenced
          ? Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n'
          : linkMd(fields),
      });
      const r = runGate(g.script, T);
      assert.equal(r.code, 1, `a ${form.name} product-repo must be READ, not deferred to a vacuous PASS:\n${r.out}`);
      assert.match(r.out, g.expect);
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(T, { recursive: true, force: true });
    });
  }
}

test('contract-check gate: a link.md with no product-repo defers by name, not by a /-rooted path', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: widen API\n\nContract-Change: yes', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
    'specs/EP-demo-S01/link.md': linkMd({ story: 'EP-demo-S01' }), // no product-repo at all
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 0, r.out);
  // An empty resolution used to interpolate to "/epics/<epic>/…" — a path at the filesystem root,
  // which both reads as a real location in the note and could match a foreign file on some hosts.
  assert.match(r.out, /not reachable at <no product-repo in link\.md>/);
  assert.doesNotMatch(r.out, /at \/epics\//);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: says so when the product lock is not reachable', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: widen API\n\nContract-Change: yes', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
    'specs/EP-demo-S01/link.md': linkMd({ story: 'EP-demo-S01', 'product-repo': '../../nowhere' }),
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 0, r.out);
  // A skipped fidelity check used to be indistinguishable from a passed one — which is how a
  // mis-resolved product-repo turned a stale-pin FAIL into a silent PASS.
  assert.match(r.out, /product lock not reachable at .*nowhere.* — fidelity check deferred/);
  fs.rmSync(T, { recursive: true, force: true });
});

// The exemption rule has to hold in every gate that has one, or `chore(x): …` + a Task trailer walks
// past the sealed-epic / orphan-thread / frozen-thread checks while spec-link happily resolves it.
for (const g of GATES.filter((x) => x.name !== 'contract-check')) {
  test(`${g.name} gate: an exempt commit that CLAIMS a story is still gated (issue #157)`, () => {
    const T = scaffoldRepo();
    g.seed(path.join(T, 'product'));
    commit(T, 'chore(deps): bump x\n\nTask: EP-demo-S01-T01', {
      'package.json': '{}',
      'specs/EP-demo-S01/link.md': linkMd({ story: 'EP-demo-S01', epic: 'EP-demo', 'product-repo': '../../product' }),
    });
    const r = runGate(g.script, T);
    assert.equal(r.code, 1, `a maintenance subject must not buy a pass past this gate:\n${r.out}`);
    assert.match(r.out, g.expect);
    fs.rmSync(T, { recursive: true, force: true });
  });

  test(`${g.name} gate: a maintenance commit with no Task trailer stays exempt`, () => {
    const T = scaffoldRepo();
    g.seed(path.join(T, 'product'));
    commit(T, 'chore(deps): bump x', { 'package.json': '{}' });
    const r = runGate(g.script, T);
    assert.equal(r.code, 0, r.out);
    fs.rmSync(T, { recursive: true, force: true });
  });
}

test('all four hub-reading gates carry the SAME resolution block, byte for byte', () => {
  // The gates are standalone by design, so the block is duplicated rather than sourced — and issue
  // #149 was caused by exactly that duplication drifting. Pin it.
  const region = (file) => {
    const src = fs.readFileSync(path.join(CHECKS, file), 'utf8');
    const start = src.indexOf('# --- shared link.md resolution');
    const end = src.indexOf('\nresolve_product() {');
    assert.ok(start >= 0 && end > start, `${file}: shared block not found`);
    return src.slice(start, src.indexOf('\n}\n', end) + 3);
  };
  const canonical = region('contract-check.sh');
  for (const f of ['lineage-check.sh', 'epic-open.sh', 'reconcile-debt-check.sh']) {
    assert.equal(region(f), canonical, `${f} drifted from the canonical resolution block`);
  }
});

// Every gate that takes a `<base>`, by the path a test can read it from. The set is deliberately
// wider than CHECKS: `checks/verified-commits.sh` is the copy this repo's own CI runs (kept in sync by
// hand), and backfill-check.sh lives in a different skill — both were left behind by an earlier
// base-default change, which is precisely the drift this pins.
const BASE_TAKING_GATES = [
  'skills/yad-checks/templates/checks/contract-check.sh',
  'skills/yad-checks/templates/checks/spec-link.sh',
  'skills/yad-checks/templates/checks/lineage-check.sh',
  'skills/yad-checks/templates/checks/epic-open.sh',
  'skills/yad-checks/templates/checks/reconcile-debt-check.sh',
  'skills/yad-checks/templates/checks/commit-message.sh',
  'skills/yad-checks/templates/checks/ledger-guard.sh',
  'skills/yad-checks/templates/checks/verified-commits.sh',
  'skills/yad-backfill/templates/checks/backfill-check.sh',
  'checks/verified-commits.sh', // yadflow's own installed copy — its CI executes this one
];

test('every base-taking gate carries the SAME base-resolution block, byte for byte', () => {
  // Same reason as the link.md block above: duplicated by design, so it has to be pinned. A gate that
  // drifts back to a hardcoded `origin/main` diffs a different range than its siblings on the same
  // repo (issue #161), which is exactly the class of divergence #149 came from.
  const region = (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const start = src.indexOf('# --- shared base resolution');
    const end = src.indexOf('\nresolve_base() {');
    assert.ok(start >= 0 && end > start, `${file}: base-resolution block not found`);
    return src.slice(start, src.indexOf('\n}\n', end) + 3);
  };
  const [first, ...rest] = BASE_TAKING_GATES;
  const canonical = region(first);
  for (const f of rest) {
    assert.equal(region(f), canonical, `${f} drifted from the canonical base-resolution block`);
  }
});

test('every base-taking gate actually CONSUMES resolve_base (no hardcoded origin/main default)', () => {
  // Pinning the helper alone leaves the two lines that use it unpinned — a gate could carry the block
  // verbatim and still assign `BASE="${1:-${SDLC_BASE:-origin/main}}"`, i.e. exactly the drift the pin
  // above exists to catch, with the test passing.
  for (const f of BASE_TAKING_GATES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /SDLC_BASE:-origin\/main/, `${f} still hardcodes the origin/main default`);
    assert.match(src, /^BASE="\$\{(1|ARGS\[0\]):-\$\{SDLC_BASE:-\$\(resolve_base\)\}\}"$/m,
      `${f} does not assign BASE from resolve_base`);
    // ...and says which base it picked when nothing named one.
    assert.match(src, /\|\| echo "note \[[a-z-]+\]: no base given — diffing against '\$\{BASE\}'\."$/m,
      `${f} does not report an auto-resolved base`);
  }
});

test('epic-open gate: an ABSOLUTE product-repo reaches the hub and refuses a SEALED epic', () => {
  const T = scaffoldRepo();
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hub-'));
  seedHubEpic(hub, 'EP-demo', { stories: { 'EP-demo-S01': 'shipped' } });
  linkedCommit(T, hub);
  const r = runGate(EPIC_OPEN, T);
  assert.equal(r.code, 1, 'a sealed epic must fail, not defer');
  assert.match(r.out, /targets SEALED epic EP-demo/);
  fs.rmSync(hub, { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

test('epic-open gate: an open epic (an unshipped story) passes', () => {
  const T = scaffoldRepo();
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hub-'));
  seedHubEpic(hub, 'EP-demo', { stories: { 'EP-demo-S01': 'shipped', 'EP-demo-S02': 'in-progress' } });
  linkedCommit(T, hub);
  const r = runGate(EPIC_OPEN, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /epic is open — has unshipped stories/);
  fs.rmSync(hub, { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

test('reconcile-debt gate: an ABSOLUTE product-repo reaches the hub and freezes the thread', () => {
  const T = scaffoldRepo();
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hub-'));
  // EP-demo threads off EP-root; the sibling hotfix EP-fix (same thread) carries OPEN debt.
  seedHubEpic(hub, 'EP-root');
  seedHubEpic(hub, 'EP-demo', { fm: { kind: 'change', parent: 'EP-root' } });
  seedHubEpic(hub, 'EP-fix', {
    fm: { kind: 'hotfix', parent: 'EP-root' },
    debt: [{ status: 'open', reason: 'ship-first hotfix' }],
  });
  linkedCommit(T, hub);
  const r = runGate(DEBT, T);
  assert.equal(r.code, 1, 'open thread debt must freeze the thread, not defer');
  assert.match(r.out, /thread EP-root carries OPEN hotfix debt/);
  assert.match(r.out, /EP-fix/);
  fs.rmSync(hub, { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- build-test-lint.sh ----------
const BTL = path.join(CHECKS, 'build-test-lint.sh');
const npmStub = (lint, build, test_) => JSON.stringify({
  name: 'fixture', version: '0.0.0',
  scripts: { lint, build, test: test_ },
});

test('build-test-lint gate: all green scripts pass', () => {
  const T = scaffoldRepo();
  commit(T, 'chore: wire scripts', {
    'package.json': npmStub('node -e ""', 'node -e ""', 'node -e ""'),
  });
  const r = runGate(BTL, T, []);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS \[build\/test\/lint\]/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('build-test-lint gate: failing test script fails the gate', () => {
  const T = scaffoldRepo();
  commit(T, 'chore: wire scripts', {
    'package.json': npmStub('node -e ""', 'node -e ""', 'node -e "process.exit(1)"'),
  });
  const r = runGate(BTL, T, []);
  assert.notEqual(r.code, 0, 'failing tests must fail the gate');
  fs.rmSync(T, { recursive: true, force: true });
});

// A test fixture that passes iff it WAS handed `--maxWorkers=2`.
const requiresFlag = 'process.exit(process.argv.includes("--maxWorkers=2") ? 0 : 1);\n';
// A test fixture that passes iff it was NOT handed any --maxWorkers flag.
const forbidsFlag = 'process.exit(process.argv.some((a) => a.startsWith("--maxWorkers")) ? 1 : 0);\n';

test('build-test-lint gate: forwards --maxWorkers to a jest/vitest test script when capped', () => {
  const T = scaffoldRepo();
  commit(T, 'chore: wire scripts', {
    'package.json': npmStub('node -e ""', 'node -e ""', 'node vitest-stub.mjs'),
    'vitest-stub.mjs': requiresFlag,
  });
  const r = runGate(BTL, T, [], { YAD_TEST_MAX_WORKERS: '2' });
  assert.equal(r.code, 0, r.out); // fixture exits 0 only because the flag arrived
  assert.match(r.out, /PASS \[build\/test\/lint\]/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('build-test-lint gate: does NOT forward --maxWorkers to a non-jest/vitest runner', () => {
  const T = scaffoldRepo();
  commit(T, 'chore: wire scripts', {
    // `node --test`-style script: must stay flag-free even when the cap env is set.
    'package.json': npmStub('node -e ""', 'node -e ""', 'node plain-stub.mjs'),
    'plain-stub.mjs': forbidsFlag,
  });
  const r = runGate(BTL, T, [], { YAD_TEST_MAX_WORKERS: '2' });
  assert.equal(r.code, 0, r.out); // fixture exits 0 only because no flag was forwarded
  fs.rmSync(T, { recursive: true, force: true });
});

test('build-test-lint gate: no cap env means no --maxWorkers even for jest/vitest', () => {
  const T = scaffoldRepo();
  commit(T, 'chore: wire scripts', {
    'package.json': npmStub('node -e ""', 'node -e ""', 'node vitest-stub.mjs'),
    'vitest-stub.mjs': forbidsFlag,
  });
  const r = runGate(BTL, T, []); // YAD_TEST_MAX_WORKERS unset
  assert.equal(r.code, 0, r.out);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- risk-route.sh ----------
const body = (T, text) => {
  const p = path.join(T, 'pr-body.md');
  fs.writeFileSync(p, text);
  return p;
};

test('risk-route: low risk, no contract -> base rule', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-risk-'));
  const p = body(T, [
    '## Impact & Risk',
    '- Risk level: low',
    '- Contract surface touched: no',
    '- Domains touched: none',
  ].join('\n'));
  const r = runGate(RISK_ROUTE, T, [p]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ROUTE: base rule -> owner \+ 1 reviewer/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('risk-route: high risk escalates and lists domain owners', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-risk-'));
  const p = body(T, [
    '- Risk level: **High**',
    '- Contract surface touched: no',
    '- Domains touched: auth, payments',
  ].join('\n'));
  const r = runGate(RISK_ROUTE, T, [p]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ROUTE: ESCALATED \(risk: high\)/);
  assert.match(r.out, /- domain-owner: auth/);
  assert.match(r.out, /- domain-owner: payments/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('risk-route: contract surface touched escalates even at low risk', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-risk-'));
  const p = body(T, [
    '- Risk level: low',
    '- Contract surface touched: yes <!-- requires re-lock -->',
    '- Domains touched: <list each domain>',
  ].join('\n'));
  const r = runGate(RISK_ROUTE, T, [p]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ROUTE: ESCALATED \(contract surface touched\)/);
  assert.match(r.out, /Domains line not filled in/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('risk-route: half-filled body still routes (advisory, never aborts)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-risk-'));
  const p = body(T, '## Summary\nno risk block at all\n');
  const r = runGate(RISK_ROUTE, T, [p]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Risk level: unspecified/);
  assert.match(r.out, /ROUTE: base rule/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('risk-route: missing body file exits 2 (usage error)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-risk-'));
  const r = runGate(RISK_ROUTE, T, [path.join(T, 'nope.md')]);
  assert.equal(r.code, 2);
  assert.match(r.out, /file not found/);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- commit-message.sh ----------
const COMMIT_MSG = path.join(CHECKS, 'commit-message.sh');

test('commit-message gate: conventional subject + ordered trailers passes', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: add the inquiry endpoint\n\nTask: EP-demo-S01-T01\nCo-Authored-By: Claude <noreply@anthropic.com>', { 'a.js': 'x' });
  const r = runGate(COMMIT_MSG, T, ['--profile', 'code', 'main']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS \[commit-message\]/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('commit-message gate: scoped + breaking-change subjects pass (CONTRIBUTING allows them)', () => {
  const T = scaffoldRepo();
  commit(T, 'feat(api): add thing', { 'a.js': 'x' });
  commit(T, 'feat(yad-run)!: change the dial schema', { 'b.js': 'x' });
  commit(T, 'fix!: drop the legacy path', { 'c.js': 'x' });
  const r = runGate(COMMIT_MSG, T, ['main']);
  assert.equal(r.code, 0, r.out);
  fs.rmSync(T, { recursive: true, force: true });
});

test('commit-message gate: a body line starting with a trailer key does not trip the order check', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: add thing\n\nContract-Change: discussed below, none here\n\nTask: EP-demo-S01-T01', { 'a.js': 'x' });
  const r = runGate(COMMIT_MSG, T, ['main']);
  assert.equal(r.code, 0, r.out); // only the real trailer block (Task:) is parsed, not the prose line
  fs.rmSync(T, { recursive: true, force: true });
});

test('commit-message gate: unknown type fails', () => {
  const T = scaffoldRepo();
  commit(T, 'wip: half a thing', { 'a.js': 'x' });
  const r = runGate(COMMIT_MSG, T, ['main']);
  assert.equal(r.code, 1);
  assert.match(r.out, /is not '<type>/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('commit-message gate: trailing period on the subject fails', () => {
  const T = scaffoldRepo();
  commit(T, 'fix: handle null user.', { 'a.js': 'x' });
  const r = runGate(COMMIT_MSG, T, ['main']);
  assert.equal(r.code, 1);
  assert.match(r.out, /must not end with a period/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('commit-message gate: trailers out of order fail', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: add thing\n\nContract-Change: yes\nTask: EP-demo-S01-T01', { 'a.js': 'x' });
  const r = runGate(COMMIT_MSG, T, ['main']);
  assert.equal(r.code, 1);
  assert.match(r.out, /trailers out of order/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('commit-message gate: unresolvable base fails closed', () => {
  const T = scaffoldRepo();
  const r = runGate(COMMIT_MSG, T, ['origin/nope']);
  assert.equal(r.code, 1);
  assert.match(r.out, /base ref .* not found/);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- pr-title.sh ----------
const PR_TITLE = path.join(ROOT, 'skills/yad-pr-template/templates/checks/pr-title.sh');

test('pr-title gate: conventional code title passes; trailing period fails', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prt-'));
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'code', 'feat: add the inquiry endpoint']).code, 0);
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'code', 'feat(api)!: drop legacy']).code, 0); // scope + breaking
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'code', 'feat: add it.']).code, 1);
  assert.equal(runGate(PR_TITLE, T, ['Add it']).code, 1); // no type, default profile
  fs.rmSync(T, { recursive: true, force: true });
});

test('pr-title gate: hub review title passes; a code title fails under hub', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prt-'));
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'hub', 'review: architecture.md (EP-demo)']).code, 0);
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'hub', 'feat: nope']).code, 1);
  fs.rmSync(T, { recursive: true, force: true });
});

test('pr-title gate: hub splits by --head — review/EP-* wants the review shape, any other branch wants a code subject', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prt-'));
  // review/EP-* head => artifact-review title required
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'hub', '--head', 'review/EP-demo', 'review: architecture.md (EP-demo)']).code, 0);
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'hub', '--head', 'review/EP-demo', 'chore: nope']).code, 1);
  // any other head => a hub tooling PR, follows the code (Conventional-Commits) convention
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'hub', '--head', 'chore/wire-gates', 'chore: rewire the hub gates']).code, 0);
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'hub', '--head', 'chore/wire-gates', 'review: nope (EP-x)']).code, 1);
  // no --head stays strict (artifact-review), so existing single-arg callers are unaffected
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'hub', 'chore: nope']).code, 1);
  fs.rmSync(T, { recursive: true, force: true });
});

test('pr-title gate: hub rejects an artifact change (epics/**) on a non-review head — the bypass guard', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prt-'));
  const artifact = path.join(T, 'changed-artifact.txt');
  fs.writeFileSync(artifact, 'epics/EP-demo/epic.md\nREADME.md\n');
  const tooling = path.join(T, 'changed-tooling.txt');
  fs.writeFileSync(tooling, 'skills/yad-checks/x.sh\ncli/y.mjs\n');
  // non-review head touching epics/** => FAIL even with an otherwise-valid code title
  const r = runGate(PR_TITLE, T, ['--profile', 'hub', '--head', 'chore/sneak', '--changed', artifact, 'chore: sneak in an artifact']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /front-half artifacts/);
  // non-review head touching only tooling paths => still a tooling PR, code title passes
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'hub', '--head', 'chore/sneak', '--changed', tooling, 'chore: rewire the hub gates']).code, 0);
  // the legitimate path: a review/EP-* head carries the artifact change and wants the review title
  assert.equal(runGate(PR_TITLE, T, ['--profile', 'hub', '--head', 'review/EP-demo', '--changed', artifact, 'review: epic.md (EP-demo)']).code, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- pr-template.sh ----------
const PR_TEMPLATE = path.join(ROOT, 'skills/yad-pr-template/templates/checks/pr-template.sh');
const CODE_TPL = path.join(ROOT, 'skills/yad-pr-template/templates/github/pull_request_template.md');
const HUB_TPL = path.join(ROOT, 'skills/yad-pr-template/templates/hub/github/pull_request_template.md');

test('pr-template gate: the real code template passes; a stripped body fails', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prtpl-'));
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'code', CODE_TPL]).code, 0);
  const stripped = body(T, 'just some freeform text');
  const r = runGate(PR_TEMPLATE, T, ['--profile', 'code', stripped]);
  assert.equal(r.code, 1);
  assert.match(r.out, /does not use the template/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('pr-template gate: a prepended companion trailer block does not break the check', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prtpl-'));
  const tpl = fs.readFileSync(CODE_TPL, 'utf8');
  // The companion prepends a trailer whose prose mentions "Risk level: high" and adds a noblock note —
  // neither must hide a section nor be mistaken for the template's real Risk level.
  const withTrailer = body(T,
    '<!-- yad:trailer -->\nThis change is big. Risk level: high. Read time: 2 min.\n<!-- /yad:trailer -->\n\n'
    + tpl + '\n<!-- yad:noblock -->\n');
  const r = runGate(PR_TEMPLATE, T, ['--profile', 'code', withTrailer]);
  assert.equal(r.code, 0, r.out);   // template's real "Risk level: low" wins; sections still found
  fs.rmSync(T, { recursive: true, force: true });
});

test('pr-template gate: the real hub template passes under --profile hub', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prtpl-'));
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'hub', HUB_TPL]).code, 0);
  // a missing file is a hard fail
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'hub', path.join(T, 'nope.md')]).code, 1);
  fs.rmSync(T, { recursive: true, force: true });
});

test('pr-template gate: hub splits by --head — review/EP-* wants the artifact template, any other branch wants the code template', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prtpl-'));
  // review/EP-* head => artifact-review template required
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'hub', '--head', 'review/EP-demo', HUB_TPL]).code, 0);
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'hub', '--head', 'review/EP-demo', CODE_TPL]).code, 1);
  // any other head => a hub tooling PR, uses the code task template
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'hub', '--head', 'chore/wire-gates', CODE_TPL]).code, 0);
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'hub', '--head', 'chore/wire-gates', HUB_TPL]).code, 1);
  // no --head stays strict (artifact-review template)
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'hub', HUB_TPL]).code, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

test('pr-template gate: hub rejects an artifact change (epics/**) on a non-review head — the bypass guard', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prtpl-'));
  const artifact = path.join(T, 'changed-artifact.txt');
  fs.writeFileSync(artifact, 'epics/EP-demo/architecture.md\n');
  const tooling = path.join(T, 'changed-tooling.txt');
  fs.writeFileSync(tooling, 'skills/yad-checks/x.sh\n');
  // non-review head touching epics/** => FAIL even with an otherwise-valid code template body
  const r = runGate(PR_TEMPLATE, T, ['--profile', 'hub', '--head', 'chore/sneak', '--changed', artifact, CODE_TPL]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /front-half artifacts/);
  // non-review head touching only tooling paths => code task template passes
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'hub', '--head', 'chore/sneak', '--changed', tooling, CODE_TPL]).code, 0);
  // the legitimate path: a review/EP-* head still requires the artifact-review template
  assert.equal(runGate(PR_TEMPLATE, T, ['--profile', 'hub', '--head', 'review/EP-demo', '--changed', artifact, HUB_TPL]).code, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- ledger-guard.sh ----------
// No origin remote in these scratch repos, so the platform signature check is waived (WARN) — the
// tests exercise the bridge gate + author half hermetically (the signature half mirrors
// verified-commits, whose signature path is likewise not unit-mocked).
const LEDGER_GUARD = path.join(CHECKS, 'ledger-guard.sh');
// The default hub is the canonical bridge shape: a platform AND the flag. `hub` overrides it so a
// test can exercise a divergent config (no platform, legacy key, key/value split across lines).
const BRIDGE_HUB = '{"platform":"github","bridge_enabled":true}\n';
const enableBridge = (T, hub = BRIDGE_HUB) => {
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), hub);
};

// Put an epic's ledger on `main` (the base ref) so the branch that follows MUTATES a CI-owned ledger
// rather than seeding a new one. scaffoldRepo cuts `feature` off the first commit, so the ledger has
// to land on main and the working branch be re-cut from it.
const seedLedgerOnBase = (T, epic = 'EP-x', files = {}, hub = BRIDGE_HUB) => {
  git(T, 'checkout', '-q', 'main');
  enableBridge(T, hub);
  commit(T, 'seed epic ledger', {
    [`epics/${epic}/epic.md`]: '# e\n',
    [`epics/${epic}/.sdlc/state.json`]: '{"epicId":"' + epic + '"}\n',
    [`epics/${epic}/.sdlc/approvals.json`]: '[]\n',
    ...files,
  });
  git(T, 'checkout', '-q', '-B', 'feature');
};

test('ledger-guard: with the bridge ON, a non-bot commit MUTATING an existing ledger FAILS', () => {
  const T = scaffoldRepo();
  seedLedgerOnBase(T);
  commit(T, 'review: epic', { 'epics/EP-x/epic.md': 'x\n' }); // artifact ok
  commit(T, 'sneaky', { 'epics/EP-x/.sdlc/approvals.json': '[{"status":"approved"}]\n' }); // human ledger edit
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /epics\/EP-x\/\.sdlc\/approvals\.json/);
  fs.rmSync(T, { recursive: true, force: true });
});

// #162: no CI path can seed a new epic's ledger (gate-sync only ADVANCES an existing chain, at merge,
// on the default branch), so the seed can only reach the trunk through the first review PR/MR — the
// one place this gate runs. Creation is exempt; mutation stays guarded by the test above.
test('ledger-guard: a human seeding a NEW epic PASSES — creation is not mutation', () => {
  const T = scaffoldRepo();
  enableBridge(T);
  commit(T, 'enable bridge', {});
  commit(T, 'review: epic', {
    'epics/EP-new/epic.md': '# e\n',
    'epics/EP-new/.sdlc/state.json': '{"currentStep":"epic"}\n',
    'epics/EP-new/.sdlc/approvals.json': '[]\n',
    'epics/EP-new/.sdlc/comments.json': '[]\n',
  });
  // the authoring skill's follow-up edit (epic → done, epic-review → in_review) is a MODIFY, still pre-seed
  commit(T, 'chore: close the authoring step', { 'epics/EP-new/.sdlc/state.json': '{"currentStep":"epic-review"}\n' });
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /epics\/EP-new has no ledger on main — new epic/);
  assert.match(r.out, /PASS .*gate-bot commit or a new epic's seed/); // the PASS line names the rule that passed it
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: the carve-out is anchored on state.json — hub-prs.json on an existing epic still FAILS', () => {
  const T = scaffoldRepo();
  seedLedgerOnBase(T); // state.json + approvals.json on main; hub-prs.json has never existed
  commit(T, 'sneaky pointer', { 'epics/EP-x/.sdlc/hub-prs.json': '[{"number":1}]\n' });
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /hub-prs\.json/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: deleting an on-base state.json FAILS — delete-then-re-seed cannot reset the carve-out', () => {
  const T = scaffoldRepo();
  seedLedgerOnBase(T);
  fs.rmSync(path.join(T, 'epics/EP-x/.sdlc/state.json'));
  commit(T, 'drop the ledger');
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /epics\/EP-x\/\.sdlc\/state\.json/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: a mixed range fails for the existing epic only, not the newly seeded one', () => {
  const T = scaffoldRepo();
  seedLedgerOnBase(T, 'EP-old');
  commit(T, 'seed + mutate', {
    'epics/EP-new/.sdlc/state.json': '{"currentStep":"epic"}\n',   // new epic — exempt
    'epics/EP-old/.sdlc/approvals.json': '[{"status":"approved"}]\n', // existing ledger — guarded
  });
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /epics\/EP-old\/\.sdlc\/approvals\.json/);
  assert.doesNotMatch(r.out, /→ epics\/EP-new/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: reviews/*.md for a not-yet-seeded epic rides the same carve-out', () => {
  const T = scaffoldRepo();
  enableBridge(T);
  commit(T, 'enable bridge', {});
  commit(T, 'review: epic', {
    'epics/EP-new/.sdlc/state.json': '{"currentStep":"epic"}\n',
    'epics/EP-new/reviews/epic--review.md': '# review\n',
  });
  assert.equal(runGate(LEDGER_GUARD, T).code, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: reviews/*.md on an epic that IS on base stays guarded', () => {
  const T = scaffoldRepo();
  seedLedgerOnBase(T);
  commit(T, 'hand-written review record', { 'epics/EP-x/reviews/epic--review.md': '# review\n' });
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /epics\/EP-x\/reviews\/epic--review\.md/);
  fs.rmSync(T, { recursive: true, force: true });
});

// Git permits a newline inside a path. Read line-wise, `epics/EP-<newline>x/.sdlc/state.json` splits
// into two records that match no arm — the on-base ledger vanishes from the seeded list AND the
// mutation vanishes from the scan, so the gate fails OPEN. Both reads are NUL-delimited instead.
test('ledger-guard: a newline inside the epic path cannot slip a mutation past the scan', () => {
  const T = scaffoldRepo();
  const slug = 'EP-x\nold';
  const write = (p, content) => {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'],
      { cwd: T, env: GIT_ENV, input: content }).toString().trim();
    // --cacheinfo cannot carry a newline in its comma form; index-info takes NUL-terminated records.
    execFileSync('git', ['update-index', '-z', '--add', '--index-info'],
      { cwd: T, env: GIT_ENV, input: `100644 ${blob}\t${p}\0` });
  };
  git(T, 'checkout', '-q', 'main');
  enableBridge(T);
  git(T, 'add', '.sdlc/hub.json');      // never `add -A` after write(): the path is index-only, so a
  write(`epics/${slug}/.sdlc/state.json`, '{}\n'); // worktree rescan would stage its deletion
  git(T, 'commit', '-q', '-m', 'seed epic ledger');
  git(T, 'checkout', '-q', '-B', 'feature');
  write(`epics/${slug}/.sdlc/approvals.json`, '[{"status":"approved"}]\n');
  git(T, 'commit', '-q', '-m', 'sneaky newline path');
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  fs.rmSync(T, { recursive: true, force: true });
});

// macOS/Windows fold case, so `ep-x` beside an on-base `EP-x` would be the SAME directory locally —
// the carve-out must read that as a mutation of EP-x's ledger, not the creation of a new epic.
test('ledger-guard: a case-folded slug cannot launder a mutation as a creation', () => {
  const T = scaffoldRepo();
  seedLedgerOnBase(T, 'EP-x');
  // Straight through the index: this host's filesystem folds case, so writing the file would land in
  // the real EP-x directory and never produce the `ep-x` path a case-sensitive CI runner would see.
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'],
    { cwd: T, env: GIT_ENV, input: '[{"status":"approved"}]\n' }).toString().trim();
  git(T, 'update-index', '--add', '--cacheinfo', `100644,${blob},epics/ep-x/.sdlc/approvals.json`);
  git(T, 'commit', '-q', '-m', 'sneaky case fold');
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /epics\/ep-x\/\.sdlc\/approvals\.json/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: artifact + contract-lock edits by a human PASS', () => {
  const T = scaffoldRepo();
  enableBridge(T);
  commit(T, 'enable bridge', {});
  commit(T, 'review: architecture', {
    'epics/EP-x/architecture.md': '# a\n',
    'epics/EP-x/contract.md': 'POST /x\n',
    'epics/EP-x/.sdlc/contract-lock.json': '{"sha":"x"}\n', // artifact-side — allowed
  });
  assert.equal(runGate(LEDGER_GUARD, T).code, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: a bot-authored ledger commit is allowed (signature waived without a remote)', () => {
  const T = scaffoldRepo();
  seedLedgerOnBase(T); // an EXISTING ledger, so this exercises the bot path and not the seeding carve-out
  fs.writeFileSync(path.join(T, 'epics/EP-x/.sdlc/state.json'), '{"currentStep":"epic-review"}\n');
  git(T, 'add', '-A');
  git(T, '-c', 'user.name=yad-gate-sync[bot]', '-c', 'user.email=yad-gate-sync[bot]@users.noreply.github.com',
    'commit', '-q', '-m', 'chore(gate): sync [skip ci]');
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /is a verified gate-bot commit\.$/m); // passed on the BOT rule, not the carve-out
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: with the bridge OFF it is a no-op (humans own the ledger locally)', () => {
  const T = scaffoldRepo(); // no .sdlc/hub.json → bridge not enabled
  commit(T, 'human ledger edit', { 'epics/EP-x/.sdlc/approvals.json': '[]\n' });
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /bridge not enabled/);
  fs.rmSync(T, { recursive: true, force: true });
});

// #186: the gate used to enable itself on the flag ALONE, while `isBridge` (cli/gate.mjs) and
// `hubActions` (cli/plan.mjs) both also require a `platform`. A hub holding one without the other
// deadlocked — the shell rejected the human's ledger commit while the CLI, reading the same file,
// called it file-only and kept the local write path, so nothing could write the ledger at all.
test('ledger-guard: the bridge flag WITHOUT a platform is not bridge mode — no-op (issue #186)', () => {
  const T = scaffoldRepo();
  enableBridge(T, '{"bridge_enabled":true}\n'); // no platform → the CLI calls this file-only
  commit(T, 'human ledger edit', { 'epics/EP-x/.sdlc/approvals.json': '[]\n' });
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /bridge not enabled/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: a platform WITHOUT the bridge flag is not bridge mode — no-op (issue #186)', () => {
  const T = scaffoldRepo();
  enableBridge(T, '{"platform":"github"}\n');
  commit(T, 'human ledger edit', { 'epics/EP-x/.sdlc/approvals.json': '[]\n' });
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /bridge not enabled/);
  fs.rmSync(T, { recursive: true, force: true });
});

// The #161 bug class, in its FAIL-OPEN direction: the old per-line grep missed a key whose value sat
// on the next line, so a fully bridge-enabled hub silently no-opped a security gate. Every other
// hub.json read in these gates already flattens with `tr -d '\n'` first.
test('ledger-guard: a hub.json with the flag split across lines still enforces (issue #186)', () => {
  const T = scaffoldRepo();
  const multiline = '{\n  "platform":\n    "github",\n  "bridge_enabled":\n    true\n}\n';
  seedLedgerOnBase(T, 'EP-x', {}, multiline);
  commit(T, 'sneaky', { 'epics/EP-x/.sdlc/approvals.json': '[{"status":"approved"}]\n' });
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /epics\/EP-x\/\.sdlc\/approvals\.json/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: the legacy `bridge` key still enforces when a platform is set', () => {
  const T = scaffoldRepo();
  seedLedgerOnBase(T, 'EP-x', {}, '{"platform":"gitlab","bridge":true}\n');
  commit(T, 'sneaky', { 'epics/EP-x/.sdlc/approvals.json': '[{"status":"approved"}]\n' });
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /epics\/EP-x\/\.sdlc\/approvals\.json/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('ledger-guard: an unresolvable base ref FAILs closed (bridge on)', () => {
  const T = scaffoldRepo();
  enableBridge(T);
  commit(T, 'enable bridge', {});
  assert.equal(runGate(LEDGER_GUARD, T, ['origin/nope']).code, 1);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------- the gate-sync version pin (issue #163 suggestion 4) ----------
// The wired fragments used to run `yadflow@3`, floating on the major — so a release could change what
// a scheduled job does with nobody deciding to upgrade, which is how #163's churn bug reached hubs
// that never opted into it. They now resolve an EXACT version at run time. The resolver cannot be
// stamped into the wired file: `fileAction` (cli/plan.mjs) compares the installed file against the
// shipped template by sha256, so an edited-in version would report `outdated` forever and be reverted
// by the next `yad check --fix`. It therefore reads committed files instead, and these tests EXECUTE
// the real block lifted out of each template rather than asserting on its text.
const GATE_SYNC_GITHUB = path.join(ROOT, 'skills/yad-hub-bridge/templates/github/yad-gate-sync.yml');
const GATE_SYNC_GITLAB = path.join(ROOT, 'skills/yad-hub-bridge/templates/gitlab/yad-gate-sync.gitlab-ci.yml');

// Pull every `# >>> yad-pin` … `# <<< yad-pin` block out of a YAML fragment and undo the block
// scalar's indentation, so what runs here is what the runner runs.
const pinBlocks = (file) => {
  const blocks = [];
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.includes('>>> yad-pin')) { cur = []; continue; }
    if (line.includes('<<< yad-pin')) { blocks.push(cur); cur = null; continue; }
    if (cur) cur.push(line);
  }
  return blocks.map((b) => {
    const indent = Math.min(...b.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    return b.map((l) => l.slice(indent)).join('\n');
  });
};

// `sh`, not `bash`: a GitLab runner falls back to it when the image ships no bash, so the block has to
// stay POSIX. Returns the resolved package version.
const resolvePin = (block, files = {}, env = {}) => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-pin-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(T, rel), body);
  fs.writeFileSync(path.join(T, 'pin.sh'), `${block}\nprintf 'RESOLVED=%s' "$YAD_PKG"\n`);
  const out = execFileSync('sh', ['pin.sh'], { cwd: T, env: { ...GIT_ENV, ...env }, stdio: 'pipe' }).toString();
  fs.rmSync(T, { recursive: true, force: true });
  return out.match(/RESOLVED=(.*)$/)?.[1];
};

test('gate-sync pin: every wired fragment carries the same resolver, and none floats on the major', () => {
  const gh = pinBlocks(GATE_SYNC_GITHUB);
  const gl = pinBlocks(GATE_SYNC_GITLAB);
  assert.equal(gh.length, 2, 'both GitHub jobs resolve a pin'); // mergesync + reconcile
  assert.equal(gl.length, 1, 'the GitLab job resolves one, reused across its script');
  assert.equal(gh[0], gh[1], 'the two GitHub copies must not drift apart');
  // Comments differ (each names its own platform's variable); the code must not.
  const code = (s) => s.replace(/^\s*#.*$/gm, '').replace(/\n+/g, '\n').trim();
  assert.equal(code(gh[0]), code(gl[0]), 'GitHub and GitLab must resolve the pin identically');

  for (const f of [GATE_SYNC_GITHUB, GATE_SYNC_GITLAB]) {
    const text = fs.readFileSync(f, 'utf8');
    // The floating invocation is what #163 asked to remove; `yadflow@${YAD_PKG}` is the only form left.
    assert.ok(!/npx[^\n]*yadflow@(3|\$\{YAD_VERSION:-3\})["\s]/.test(text), `${f} still floats on the major`);
    assert.ok(/npx -y -p "yadflow@\$\{YAD_PKG\}"/.test(text), `${f} does not run the resolved pin`);
  }
});

test('gate-sync pin: resolves in precedence order, and refuses a pin it cannot trust', () => {
  const [block] = pinBlocks(GATE_SYNC_GITLAB);
  const hub = (v) => ({ '.sdlc/hub.json': `{"gate_sync_version":"${v}"}` });
  const stamp = (v) => ({ '.sdlc/cli-version.json': `{"version":"${v}"}` });

  // 4. nothing committed to read → the floating major, exactly today's behaviour
  assert.equal(resolvePin(block), '3');
  // 3. the version that wired the hub
  assert.equal(resolvePin(block, stamp('3.15.3')), '3.15.3');
  // 2. the explicit hub pin outranks it
  assert.equal(resolvePin(block, { ...stamp('3.15.3'), ...hub('3.14.0') }), '3.14.0');
  // 1. the platform variable outranks both, verbatim — the operator's escape hatch, including
  //    downgrading across majors, which the file sources are not allowed to do.
  assert.equal(resolvePin(block, hub('3.14.0'), { YAD_VERSION: '2.1.0' }), '2.1.0');

  // A stamp from a different major is the realistic failure: `.sdlc/cli-version.json` is written by
  // whichever CLI last ran `yad check --fix`, and a long-untouched project can still say 1.0.2 — a
  // version with no `yad gate ci` at all. Skip it, do not run it.
  assert.equal(resolvePin(block, { ...hub('1.0.2'), ...stamp('3.15.3') }), '3.15.3');
  assert.equal(resolvePin(block, { ...hub('1.0.2'), ...stamp('1.0.2') }), '3');
  // Not a version at all → never reaches `npx -p "yadflow@$V"` on a runner holding a push token.
  assert.equal(resolvePin(block, hub('3.1.0;curl evil')), '3');
  assert.equal(resolvePin(block, hub('latest')), '3');
  // Prereleases are legitimate exact versions; a key split across lines still reads (the #161 idiom).
  assert.equal(resolvePin(block, hub('3.16.0-rc.1')), '3.16.0-rc.1');
  assert.equal(resolvePin(block, { '.sdlc/hub.json': '{\n "gate_sync_version":\n  "3.15.9"\n}' }), '3.15.9');
});
