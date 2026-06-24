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

// Strip ambient git identity env (see cli/test.mjs for why).
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(k)),
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
      cwd, env: { ...process.env, ...env }, stdio: 'pipe',
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
  assert.match(r.out, /PASS \[spec-link\]: [0-9a-f]+ 'chore\(deps\): bump x' — maintenance commit \(exempt\)/);
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

test('contract-check gate: Contract-Change claimed but link.md pins a stale hash fails', () => {
  const T = scaffoldRepo();
  // Product repo lives next to the code repo; lock hash differs from the pinned one.
  fs.mkdirSync(path.join(T, 'product/epics/EP-demo/.sdlc'), { recursive: true });
  fs.writeFileSync(
    path.join(T, 'product/epics/EP-demo/.sdlc/contract-lock.json'),
    JSON.stringify({ hash: 'sha256:' + 'b'.repeat(64) }),
  );
  commit(T, 'feat: widen API\n\nContract-Change: yes', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
    'specs/EP-demo-S01/link.md':
      `story: EP-demo-S01\nproduct-repo: product\ncontract-lock: sha256:${'a'.repeat(64)}\n`,
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
  fs.mkdirSync(path.join(T, 'product/epics/EP-demo/.sdlc'), { recursive: true });
  fs.writeFileSync(
    path.join(T, 'product/epics/EP-demo/.sdlc/contract-lock.json'),
    JSON.stringify({ hash: `sha256:${hash}` }),
  );
  commit(T, 'feat: widen API\n\nContract-Change: yes', {
    'specs/EP-demo-S01/contracts/api.md': 'new endpoint\n',
    'specs/EP-demo-S01/link.md':
      `story: EP-demo-S01\nproduct-repo: product\ncontract-lock: sha256:${hash}\n`,
  });
  const r = runGate(CONTRACT, T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /link\.md hash matches the product lock/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('contract-check gate: unresolvable base fails closed', () => {
  const T = scaffoldRepo();
  const r = runGate(CONTRACT, T, ['origin/nope']);
  assert.equal(r.code, 1, 'undiffable range must never green-light');
  assert.match(r.out, /base ref 'origin\/nope' not found/);
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

// ---------- ledger-guard.sh ----------
// No origin remote in these scratch repos, so the platform signature check is waived (WARN) — the
// tests exercise the bridge gate + author half hermetically (the signature half mirrors
// verified-commits, whose signature path is likewise not unit-mocked).
const LEDGER_GUARD = path.join(CHECKS, 'ledger-guard.sh');
const enableBridge = (T) => {
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), '{"platform":"github","bridge_enabled":true}\n');
};

test('ledger-guard: with the bridge ON, a non-bot commit touching gate-state files FAILS', () => {
  const T = scaffoldRepo();
  enableBridge(T);
  commit(T, 'enable bridge', {}); // commit the hub.json (artifact-side; not a gate file)
  commit(T, 'review: epic', { 'epics/EP-x/epic.md': 'x\n' }); // artifact ok
  commit(T, 'sneaky', { 'epics/EP-x/.sdlc/approvals.json': '[]\n' }); // human ledger edit
  const r = runGate(LEDGER_GUARD, T);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /epics\/EP-x\/\.sdlc\/approvals\.json/);
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
  enableBridge(T);
  commit(T, 'enable bridge', {});
  fs.mkdirSync(path.join(T, 'epics/EP-x/.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-x/.sdlc/state.json'), '{}\n');
  git(T, 'add', '-A');
  git(T, '-c', 'user.name=yad-gate-sync[bot]', '-c', 'user.email=yad-gate-sync[bot]@users.noreply.github.com',
    'commit', '-q', '-m', 'chore(gate): sync [skip ci]');
  assert.equal(runGate(LEDGER_GUARD, T).code, 0);
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

test('ledger-guard: an unresolvable base ref FAILs closed (bridge on)', () => {
  const T = scaffoldRepo();
  enableBridge(T);
  commit(T, 'enable bridge', {});
  assert.equal(runGate(LEDGER_GUARD, T, ['origin/nope']).code, 1);
  fs.rmSync(T, { recursive: true, force: true });
});
