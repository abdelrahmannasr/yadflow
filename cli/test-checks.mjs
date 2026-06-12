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
  assert.match(r.out, /PASS \[spec-link\]: EP-demo-S01-T01 -> specs\/EP-demo-S01\/link\.md/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('spec-link gate: commit without a Task trailer fails', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: unlinked change', { 'src/thing.js': 'x' });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 1, 'unlinked change must fail');
  assert.match(r.out, /no 'Task: <story>-<task>' trailer/);
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

test('spec-link gate: one linked + one unlinked story in range still fails', () => {
  const T = scaffoldRepo();
  commit(T, 'feat: linked\n\nTask: EP-demo-S01-T01', {
    'src/a.js': 'x',
    'specs/EP-demo-S01/link.md': 'story: EP-demo-S01\n',
  });
  commit(T, 'feat: unlinked\n\nTask: EP-ghost-S01-T01', { 'src/b.js': 'y' });
  const r = runGate(SPEC_LINK, T);
  assert.equal(r.code, 1, 'any unlinked task in the range must fail the gate');
  assert.match(r.out, /PASS \[spec-link\]: EP-demo-S01-T01/);
  assert.match(r.out, /FAIL \[spec-link\]: EP-ghost-S01-T01/);
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
