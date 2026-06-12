// Dependency-free tests for the yad CLI. Run: node --test cli/test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Strip ambient git identity env: GIT_AUTHOR_*/GIT_COMMITTER_* override repo-level `git config`,
// and semantic-release exports them during `npm publish` (prepublishOnly runs this suite) — test
// commits must carry the identity each test sets, not the publisher's.
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(k)),
);
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: GIT_ENV });

function scaffold() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-test-'));
  git(T, 'init', '-q');
  const backend = path.join(T, 'demo/backend');
  fs.mkdirSync(path.join(backend, '.github/workflows'), { recursive: true });
  git(backend, 'init', '-q');
  fs.writeFileSync(path.join(backend, 'package.json'), '{}');
  git(backend, 'add', '-A');
  git(backend, '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '-m', 'init');
  const head = git(backend, 'rev-parse', 'HEAD').toString().trim();
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({
    repos: [{
      name: 'backend', path: 'demo/backend', platform: 'github', domain_owner: 'x',
      default_branch: 'main', syncedHead: head,
      contextPack: '.sdlc/code-context/backend/pack.md',
      codeMap: '.sdlc/code-context/backend/code-map.md',
    }],
  }));
  return { T, backend, head };
}

// Import after env is irrelevant (reconcile is non-interactive).
const { reconcile } = await import('./reconcile.mjs');

test('check --fix installs module + wires repo, then is idempotent', async () => {
  const { T } = scaffold();
  const r1 = await reconcile(T, { fix: true });
  assert.ok(r1.applied > 0, 'should apply missing items');

  for (const f of [
    '.claude/skills/yad-epic/SKILL.md',
    '_bmad/sdlc/config.yaml',
    'demo/backend/.github/workflows/yad-checks.yml',
    'demo/backend/checks/spec-link.sh',
    'demo/backend/.github/pull_request_template.md',
    '.sdlc/cli-version.json',
  ]) assert.ok(fs.existsSync(path.join(T, f)), `expected ${f}`);

  assert.ok(fs.statSync(path.join(T, 'demo/backend/checks/spec-link.sh')).mode & 0o100, 'gate script executable');

  const r2 = await reconcile(T, { fix: false });
  assert.equal(r2.counts.missing, 0);
  assert.equal(r2.counts.outdated, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

test('check detects exactly one missing, one outdated, one stale', async () => {
  const { T, backend } = scaffold();
  await reconcile(T, { fix: true });

  fs.rmSync(path.join(T, 'demo/backend/.github/workflows/yad-checks.yml'));        // missing
  fs.appendFileSync(path.join(T, '.claude/skills/yad-status/SKILL.md'), '\ndrift'); // outdated
  git(backend, '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '--allow-empty', '-m', 'more'); // stale

  const r = await reconcile(T, { fix: false });
  assert.equal(r.counts.missing, 1, 'one missing');
  assert.equal(r.counts.outdated, 1, 'one outdated');
  assert.equal(r.counts.stale, 1, 'one stale');
  fs.rmSync(T, { recursive: true, force: true });
});

// `yad update` (scope=changed) must migrate a pre-2.0 install — old sdlc-* skill copies and
// marker-owned sdlc-* CI files are replaced by the yad-* names even though the new copies are
// technically "missing" (which scope=changed otherwise skips).
test('update migrates pre-2.0 sdlc-* skill copies and wired CI to yad-*', async () => {
  const { T } = scaffold();
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', bridge_enabled: true }));
  await reconcile(T, { fix: true });

  // Simulate the pre-2.0 state: skill installed under its old name, new name absent.
  fs.rmSync(path.join(T, '.claude/skills/yad-epic'), { recursive: true });
  fs.mkdirSync(path.join(T, '.claude/skills/sdlc-author-epic'), { recursive: true });
  fs.writeFileSync(path.join(T, '.claude/skills/sdlc-author-epic/SKILL.md'), '---\nname: sdlc-author-epic\n---\n');
  fs.mkdirSync(path.join(T, '.opencode/commands'), { recursive: true });
  fs.writeFileSync(path.join(T, '.opencode/commands/sdlc-run.md'), '---\nname: sdlc-run\n---\n');
  // Old wired CI files, first line carrying the old ownership marker.
  fs.rmSync(path.join(T, 'demo/backend/.github/workflows/yad-checks.yml'));
  fs.writeFileSync(path.join(T, 'demo/backend/.github/workflows/sdlc-checks.yml'), '# sdlc-managed: sdlc-checks\nname: sdlc-checks\n');
  fs.rmSync(path.join(T, '.github/workflows/yad-gate-sync.yml'));
  fs.writeFileSync(path.join(T, '.github/workflows/sdlc-gate-sync.yml'), '# sdlc-managed: sdlc-hub-bridge\nname: sdlc-gate-sync\n');

  const r = await reconcile(T, { fix: true, scope: 'changed' });
  assert.ok(r.applied >= 4, 'legacy migrations applied under scope=changed');
  for (const gone of [
    '.claude/skills/sdlc-author-epic',
    '.opencode/commands/sdlc-run.md',
    'demo/backend/.github/workflows/sdlc-checks.yml',
    '.github/workflows/sdlc-gate-sync.yml',
  ]) assert.ok(!fs.existsSync(path.join(T, gone)), `old ${gone} removed`);
  for (const there of [
    '.claude/skills/yad-epic/SKILL.md',
    '.opencode/commands/yad-run.md',
    'demo/backend/.github/workflows/yad-checks.yml',
    '.github/workflows/yad-gate-sync.yml',
  ]) assert.ok(fs.existsSync(path.join(T, there)), `new ${there} installed`);

  const again = await reconcile(T, { fix: false });
  assert.equal(again.counts.legacy, 0, 'migration is idempotent');
  fs.rmSync(T, { recursive: true, force: true });
});

// GitLab fragments are referenced by path from the root .gitlab-ci.yml include (written by the
// wire step) — migrating the fragment must rewrite that include too, or the pipeline hard-fails
// on a `local file does not exist`. Also covers the old `# sdlc-managed-include` marker variant.
test('gitlab migration rewrites the root .gitlab-ci.yml include to the new fragment', async () => {
  const { T } = scaffold();
  const repos = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/repos.json'), 'utf8'));
  repos.repos[0].platform = 'gitlab';
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify(repos));
  await reconcile(T, { fix: true });

  fs.rmSync(path.join(T, 'demo/backend/.gitlab/ci/yad-checks.yml'));
  fs.writeFileSync(path.join(T, 'demo/backend/.gitlab/ci/sdlc-checks.yml'), '# sdlc-managed-include: sdlc-checks\nsdlc-spec-link: {}\n');
  fs.writeFileSync(path.join(T, 'demo/backend/.gitlab-ci.yml'), "include:\n  - local: '.gitlab/ci/sdlc-checks.yml'\n");

  await reconcile(T, { fix: true, scope: 'changed' });
  assert.ok(!fs.existsSync(path.join(T, 'demo/backend/.gitlab/ci/sdlc-checks.yml')), 'old fragment removed');
  assert.ok(fs.existsSync(path.join(T, 'demo/backend/.gitlab/ci/yad-checks.yml')), 'new fragment installed');
  const rootCi = fs.readFileSync(path.join(T, 'demo/backend/.gitlab-ci.yml'), 'utf8');
  assert.ok(rootCi.includes('.gitlab/ci/yad-checks.yml'), 'include rewritten to new fragment');
  assert.ok(!rootCi.includes('.gitlab/ci/sdlc-checks.yml'), 'no dangling include to the deleted fragment');
  fs.rmSync(T, { recursive: true, force: true });
});

// A file at an old wired path that we did NOT install (no `# sdlc-managed` first line) belongs
// to the user — migration must leave it untouched.
test('update leaves a user-authored file at an old wired path alone', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  const userFile = path.join(T, 'demo/backend/.github/workflows/sdlc-checks.yml');
  fs.writeFileSync(userFile, 'name: my-own-workflow\non: push\n');

  const r = await reconcile(T, { fix: true, scope: 'changed' });
  assert.equal(r.counts.legacy, 0, 'unowned file is not a legacy action');
  assert.ok(fs.existsSync(userFile), 'user file untouched');
  assert.equal(fs.readFileSync(userFile, 'utf8'), 'name: my-own-workflow\non: push\n');
  fs.rmSync(T, { recursive: true, force: true });
});

test('CLI --version matches manifest', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  const out = execFileSync('node', [path.join(ROOT, 'bin/yad.mjs'), '--version']).toString().trim();
  assert.equal(out, version);
});

// ---------------------------------------------------------------------------------------------
// lib.mjs — atomic writeJSON (a killed process must never leave a truncated ledger file)
// ---------------------------------------------------------------------------------------------
const { writeJSON } = await import('./lib.mjs');

test('writeJSON round-trips with a trailing newline and leaves no tmp file', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-write-'));
  const f = path.join(T, 'nested/state.json');
  writeJSON(f, { a: 1 });
  assert.equal(fs.readFileSync(f, 'utf8'), '{\n  "a": 1\n}\n');
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['state.json'], 'no .tmp sibling left behind');
  fs.rmSync(T, { recursive: true, force: true });
});

test('writeJSON goes through a sibling tmp file + rename (atomic on the same filesystem)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-write2-'));
  const f = path.join(T, 'state.json');
  const calls = [];
  const orig = fs.renameSync;
  fs.renameSync = (from, to) => { calls.push([from, to]); return orig(from, to); };
  try { writeJSON(f, { a: 1 }); } finally { fs.renameSync = orig; }
  assert.equal(calls.length, 1);
  const [from, to] = calls[0];
  assert.equal(to, f);
  assert.equal(path.dirname(from), path.dirname(f), 'tmp file is a sibling of the target');
  assert.match(path.basename(from), /^state\.json\..+\.tmp$/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('writeJSON failure leaves a pre-existing target intact and cleans up the tmp file', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-write3-'));
  const f = path.join(T, 'state.json');
  writeJSON(f, { good: true });
  // serialization failure: nothing touches disk at all
  const circular = {}; circular.self = circular;
  assert.throws(() => writeJSON(f, circular), /circular/i);
  assert.equal(fs.readFileSync(f, 'utf8'), '{\n  "good": true\n}\n', 'target untouched');
  // rename failure: tmp file is removed, target untouched
  const orig = fs.renameSync;
  fs.renameSync = () => { throw new Error('EPERM: simulated'); };
  try { assert.throws(() => writeJSON(f, { bad: true }), /simulated/); } finally { fs.renameSync = orig; }
  assert.equal(fs.readFileSync(f, 'utf8'), '{\n  "good": true\n}\n', 'target untouched after rename failure');
  assert.deepEqual(fs.readdirSync(T), ['state.json'], 'tmp cleaned up');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad commit` — message builder + branch-derived task
// ---------------------------------------------------------------------------------------------
const { buildCommitMessage, taskFromBranch } = await import('./commit.mjs');

test('buildCommitMessage emits trailers in the fixed order with AI co-author', () => {
  const msg = buildCommitMessage({
    type: 'feat', subject: 'add create path', task: 'EP-x-S01-T01',
    contractChange: true, ai: 'claude',
  });
  assert.equal(msg.split('\n')[0], 'feat: add create path');
  const tail = msg.split('\n\n').pop();
  assert.equal(tail, [
    'Task: EP-x-S01-T01',
    'Contract-Change: yes',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
  ].join('\n'));
});

test('buildCommitMessage omits co-author for ai=none and rejects bad input', () => {
  const msg = buildCommitMessage({ type: 'fix', subject: 'patch', task: 'EP-x-S01-T02', ai: 'none' });
  assert.ok(!/Co-Authored-By/.test(msg));
  assert.throws(() => buildCommitMessage({ type: 'nope', subject: 'x' }), /invalid commit type/);
  assert.throws(() => buildCommitMessage({ type: 'feat', subject: 'ends.' }), /period/);
  assert.throws(() => buildCommitMessage({ type: 'feat', subject: 'x', ai: 'ghost' }), /unknown --ai/);
});

test('taskFromBranch derives the story-task id', () => {
  assert.equal(taskFromBranch('feat/EP-istifta-inquiries-S01-T01-create-inquiry'), 'EP-istifta-inquiries-S01-T01');
  assert.equal(taskFromBranch('main'), null);
});

// ---------------------------------------------------------------------------------------------
// Gate predicate — pure, the heart of the gate
// ---------------------------------------------------------------------------------------------
const { gatePredicate, artifactHash } = await import('./epic-state.mjs');

const baseStep = { id: 'epic-review', type: 'review+approve', artifact: 'epic.md', risk_tags: [] };
const escStep = { id: 'architecture-review', type: 'review+approve', artifact: 'architecture.md', risk_tags: ['contract'] };
const appr = (over) => ({ step: 'epic-review', status: 'approved', artifactHash: 'sha256:H1', ...over });

test('gatePredicate: base pass needs owner + 1 reviewer, then merged + resolved', () => {
  const approvals = [appr({ approver: 'alice', role: 'owner' }), appr({ approver: 'bob', role: 'reviewer' })];
  const p = gatePredicate({ step: baseStep, approvals, currentHash: 'sha256:H1', merged: true, threadsResolved: true });
  assert.equal(p.passed, true);
  assert.equal(p.rule, 'base');
});

test('gatePredicate: unresolved comments hold the gate in-review', () => {
  const approvals = [appr({ approver: 'alice', role: 'owner' }), appr({ approver: 'bob', role: 'reviewer' })];
  const p = gatePredicate({ step: baseStep, approvals, currentHash: 'sha256:H1', merged: true, threadsResolved: false });
  assert.equal(p.passed, false);
  assert.ok(p.missing.includes('unresolved review comments'));
});

test('gatePredicate: an approval against a stale hash is revoked', () => {
  const approvals = [appr({ approver: 'alice', role: 'owner' }), appr({ approver: 'bob', role: 'reviewer' })];
  const p = gatePredicate({ step: baseStep, approvals, currentHash: 'sha256:H2', merged: true, threadsResolved: true });
  assert.equal(p.passed, false);
  assert.equal(p.staleDropped, 2);
  assert.ok(p.missing.some((m) => /revoked/.test(m)));
});

test('gatePredicate: escalated step needs a domain-owner per touched repo', () => {
  const approvals = [
    { step: 'architecture-review', status: 'approved', approver: 'alice', role: 'owner', artifactHash: 'sha256:C' },
    { step: 'architecture-review', status: 'approved', approver: 'bob', role: 'reviewer', artifactHash: 'sha256:C' },
    { step: 'architecture-review', status: 'approved', approver: 'carol', role: 'domain-owner', domain: 'backend', artifactHash: 'sha256:C' },
  ];
  const miss = gatePredicate({ step: escStep, approvals, currentHash: 'sha256:C', touchedDomains: ['backend', 'mobile'], merged: true });
  assert.equal(miss.passed, false);
  assert.ok(miss.missing.includes('domain-owner for mobile'));
  assert.equal(miss.rule, 'escalated');

  approvals.push({ step: 'architecture-review', status: 'approved', approver: 'dave', role: 'domain-owner', domain: 'mobile', artifactHash: 'sha256:C' });
  const pass = gatePredicate({ step: escStep, approvals, currentHash: 'sha256:C', touchedDomains: ['backend', 'mobile'], merged: true });
  assert.equal(pass.passed, true);
});

// ---------------------------------------------------------------------------------------------
// `yad gate sync` — platform state -> ledger -> advance (with an injected fake reader)
// ---------------------------------------------------------------------------------------------
const { gateSync, gateOpen, gateStatus } = await import('./gate.mjs');

function scaffoldEpic() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-gate-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github', default_branch: 'main',
    roster: [
      { login: 'al', name: 'alice', role: 'owner' },
      { login: 'bo', name: 'bob', role: 'reviewer' },
      { login: 'ca', name: 'carol', role: 'reviewer' },
    ],
  }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({
    repos: [{ name: 'backend', path: 'demo/backend', domain_owner: 'carol', default_branch: 'main' }],
  }));
  const ep = path.join(T, 'epics/EP-test');
  fs.mkdirSync(path.join(ep, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(ep, 'epic.md'), '---\nid: EP-test\nowner: alice\nrepos: [backend]\n---\n');
  fs.writeFileSync(path.join(ep, 'architecture.md'), '# arch\n');
  fs.writeFileSync(path.join(ep, 'contract.md'), '<!-- CONTRACT-SURFACE:BEGIN -->\nPOST /x\n<!-- CONTRACT-SURFACE:END -->\n');
  fs.writeFileSync(path.join(ep, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-test', currentStep: 'architecture-review',
    steps: [
      { id: 'architecture', type: 'author', artifact: 'architecture.md', status: 'done', risk_tags: [] },
      { id: 'architecture-review', type: 'review+approve', artifact: 'architecture.md', status: 'in_review', risk_tags: ['contract'] },
      { id: 'ui-design', type: 'author', artifact: 'ui-design.md', status: 'blocked', risk_tags: [] },
    ],
  }));
  fs.writeFileSync(path.join(ep, '.sdlc/hub-prs.json'), JSON.stringify([
    { step: 'architecture-review', artifact: 'architecture.md', platform: 'github', number: 7, url: 'http://x/7', branch: 'review/EP-test/architecture', lastSyncedAt: null },
  ]));
  return { T, ep };
}

// alice owner, bob reviewer, carol reviewer + derived backend domain-owner — escalated rule satisfied.
const fullApproval = { ok: true, state: 'MERGED', merged: true, headOid: 'abc',
  reviews: [
    { login: 'al', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z' },
    { login: 'bo', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z' },
    { login: 'ca', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z' },
  ], threads: [] };

test('gate sync: approved + resolved + merged advances the step', async () => {
  const { T, ep } = scaffoldEpic();
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => fullApproval });
  const state = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json')));
  assert.equal(state.steps.find((s) => s.id === 'architecture-review').status, 'done');
  assert.equal(state.currentStep, 'ui-design');
  const approvals = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/approvals.json')));
  assert.ok(approvals.some((a) => a.role === 'domain-owner' && a.domain === 'backend' && a.source === 'bridge'));

  // idempotent: a second identical sync does not duplicate bridge approvals
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => fullApproval });
  const again = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/approvals.json')));
  assert.equal(again.filter((a) => a.source === 'bridge').length, approvals.filter((a) => a.source === 'bridge').length);
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate sync: a re-sync after advance does not clobber the next step', async () => {
  const { T, ep } = scaffoldEpic();
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => fullApproval });
  // simulate the next step having progressed
  const sf = path.join(ep, '.sdlc/state.json');
  const st = JSON.parse(fs.readFileSync(sf));
  st.steps.find((s) => s.id === 'ui-design').status = 'in_review';
  st.currentStep = 'ui-design';
  fs.writeFileSync(sf, JSON.stringify(st));
  // re-sync the (now done) architecture step — must skip, not re-advance
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => fullApproval });
  const after = JSON.parse(fs.readFileSync(sf));
  assert.equal(after.steps.find((s) => s.id === 'ui-design').status, 'in_review', 'next step not clobbered');
  assert.equal(after.currentStep, 'ui-design');
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate sync: an approval keeps its hash when the platform proves no newer review (GitLab path)', async () => {
  const { T, ep } = scaffoldEpic();
  // reviews without submittedAt (the GitLab adapter does not provide it) + not yet merged
  const noTs = {
    ok: true, state: 'opened', merged: false, headOid: 'a',
    reviews: [{ login: 'al', state: 'APPROVED' }, { login: 'bo', state: 'APPROVED' }, { login: 'ca', state: 'APPROVED' }],
    threads: [],
  };
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => noTs });
  const firstHash = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/approvals.json')))
    .find((a) => a.source === 'bridge').artifactHash;
  assert.ok(firstHash);
  // owner edits the locked contract surface -> content hash changes
  fs.writeFileSync(path.join(ep, 'contract.md'), '<!-- CONTRACT-SURFACE:BEGIN -->\nPOST /x\nPOST /y\n<!-- CONTRACT-SURFACE:END -->\n');
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => noTs });
  const kept = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/approvals.json')))
    .find((a) => a.source === 'bridge').artifactHash;
  assert.equal(kept, firstHash, 'approval still bound to the content it was given against (so it is now revoked)');
  // and the step has NOT advanced — the changed artifact revoked the approvals
  assert.equal(JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json'))).steps.find((s) => s.id === 'architecture-review').status, 'in_review');
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate sync: unresolved comment holds in-review (no advance) and is recorded in comments.json', async () => {
  const { T, ep } = scaffoldEpic();
  const withComment = { ...fullApproval, merged: false, threads: [{ id: 't1', resolved: false, login: 'bo', body: 'needs a version field' }] };
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => withComment });
  const state = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json')));
  assert.equal(state.steps.find((s) => s.id === 'architecture-review').status, 'in_review');
  assert.equal(state.currentStep, 'architecture-review');
  assert.ok(fs.existsSync(path.join(ep, 'reviews/architecture--2026-06-09--comments.md')));
  // ledger (not just the markdown side file) carries the participation record
  const comments = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/comments.json')));
  const rec = comments.find((cm) => cm.step === 'architecture-review' && cm.commenter === 'bob');
  assert.ok(rec, 'comments.json has a record for bob');
  assert.equal(rec.count, 1);
  // re-sync same round does not duplicate
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => withComment });
  const after = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/comments.json')));
  assert.equal(after.filter((cm) => cm.commenter === 'bob' && cm.round === rec.round).length, 1);
  fs.rmSync(T, { recursive: true, force: true });
});

test('artifactHash(stories/) changes on a story edit, so a stories-review approval goes stale', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-stories-'));
  const dir = path.join(T, 'stories');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'EP-x-S01.md'), '---\nrepos: [backend]\n---\nstory one\n');
  fs.writeFileSync(path.join(dir, 'EP-x-S02.md'), '---\nrepos: [mobile]\n---\nstory two\n');
  const h1 = artifactHash(T, 'stories/');
  assert.ok(h1 && h1.startsWith('sha256:'), 'stories/ now has a content hash (no longer null)');

  const step = { id: 'stories-review', type: 'review+approve', artifact: 'stories/', risk_tags: [] };
  const approvals = [
    { step: 'stories-review', status: 'approved', approver: 'alice', role: 'owner', artifactHash: h1 },
    { step: 'stories-review', status: 'approved', approver: 'bob', role: 'reviewer', artifactHash: h1 },
    { step: 'stories-review', status: 'approved', approver: 'carol', role: 'domain-owner', domain: 'backend', artifactHash: h1 },
    { step: 'stories-review', status: 'approved', approver: 'dave', role: 'domain-owner', domain: 'mobile', artifactHash: h1 },
  ];
  assert.equal(gatePredicate({ step, approvals, currentHash: h1, touchedDomains: ['backend', 'mobile'], merged: true }).passed, true);

  fs.appendFileSync(path.join(dir, 'EP-x-S01.md'), '\nnew acceptance criterion\n');
  const h2 = artifactHash(T, 'stories/');
  assert.notEqual(h2, h1, 'editing a story changes the stories hash');
  const after = gatePredicate({ step, approvals, currentHash: h2, touchedDomains: ['backend', 'mobile'], merged: true });
  assert.equal(after.passed, false);
  assert.equal(after.staleDropped, 4, 'all four approvals revoked by the story edit');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// contractSurfaceHash — line-ending independence + malformed-block rejection
// ---------------------------------------------------------------------------------------------
test('contractSurfaceHash: CRLF and LF files with the same surface hash identically', async () => {
  const { contractSurfaceHash: surfHash } = await import('./epic-state.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-crlf-'));
  const lf = path.join(T, 'lf'); const crlf = path.join(T, 'crlf');
  fs.mkdirSync(lf); fs.mkdirSync(crlf);
  const content = '<!-- CONTRACT-SURFACE:BEGIN -->\nPOST /x\nGET /y\n<!-- CONTRACT-SURFACE:END -->\n';
  fs.writeFileSync(path.join(lf, 'contract.md'), content);
  fs.writeFileSync(path.join(crlf, 'contract.md'), content.replace(/\n/g, '\r\n'));
  const h = surfHash(lf);
  assert.ok(h?.startsWith('sha256:'));
  assert.equal(surfHash(crlf), h, 'a CRLF re-save must not change the hash (no false revocations)');
  fs.rmSync(T, { recursive: true, force: true });
});

test('contractSurfaceHash: BEGIN without END is malformed — null, never a hash to end-of-file', async () => {
  const { contractSurfaceHash: surfHash } = await import('./epic-state.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-noend-'));
  fs.writeFileSync(path.join(T, 'contract.md'),
    '<!-- CONTRACT-SURFACE:BEGIN -->\nPOST /x\n\n# Everything after, accidentally included before\n');
  assert.equal(surfHash(T), null);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// Ledger fail-fast — a corrupt or wrong-shape ledger file must abort, never default-and-rewrite
// ---------------------------------------------------------------------------------------------
const { loadLedger } = await import('./epic-state.mjs');

test('a corrupt approvals.json aborts the sync with the file named — and is never rewritten', async () => {
  const { T, ep } = scaffoldEpic();
  const f = path.join(ep, '.sdlc/approvals.json');
  fs.writeFileSync(f, '[{"step": "architecture-rev'); // truncated mid-write
  await assert.rejects(
    gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => fullApproval }),
    /corrupt JSON in .*approvals\.json.*fix or delete/,
  );
  assert.equal(fs.readFileSync(f, 'utf8'), '[{"step": "architecture-rev', 'corrupt file left for recovery');
  fs.rmSync(T, { recursive: true, force: true });
});

test('a wrong-shape state.json fails with the file named', () => {
  const { T, ep } = scaffoldEpic();
  fs.writeFileSync(path.join(ep, '.sdlc/state.json'), JSON.stringify({ steps: 'oops' }));
  assert.throws(() => loadLedger(ep), /state\.json: expected a non-empty `steps` array/);
  fs.writeFileSync(path.join(ep, '.sdlc/state.json'), JSON.stringify([1, 2]));
  assert.throws(() => loadLedger(ep), /state\.json: expected a JSON object/);
  fs.writeFileSync(path.join(ep, '.sdlc/state.json'), JSON.stringify({
    currentStep: 'x', steps: [{ id: 'x', type: 'author', status: 'done' }],
  }));
  fs.writeFileSync(path.join(ep, '.sdlc/approvals.json'), JSON.stringify({ not: 'an array' }));
  assert.throws(() => loadLedger(ep), /approvals\.json: expected a JSON array/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('an unknown hub platform fails fast instead of degrading to file-only', async () => {
  const { T } = scaffoldEpic();
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'bitbucket', roster: [] }));
  await assert.rejects(
    gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => fullApproval }),
    /hub\.json: unknown platform 'bitbucket'/,
  );
  fs.rmSync(T, { recursive: true, force: true });
});

test('missing ledger files still default silently (a fresh epic is a normal state)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-fresh-'));
  const ledger = loadLedger(path.join(T, 'epics/EP-x'));
  assert.equal(ledger.state, null);
  assert.deepEqual(ledger.approvals, []);
  assert.deepEqual(ledger.hubPrs, []);
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate open without an artifact fails cleanly (no throw)', async () => {
  const { T } = scaffoldEpic();
  const prev = process.exitCode;
  await assert.doesNotReject(gateOpen(T, { epic: 'EP-test', today: '2026-06-09' }));
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate status counts only non-stale approvals after an artifact change', async () => {
  const { T, ep } = scaffoldEpic();
  // record approvals bound to the current contract surface, not yet merged
  const noTs = { ok: true, state: 'opened', merged: false, headOid: 'a',
    reviews: [{ login: 'al', state: 'APPROVED' }, { login: 'bo', state: 'APPROVED' }, { login: 'ca', state: 'APPROVED' }], threads: [] };
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => noTs });
  // change the locked surface -> existing approvals become stale
  fs.writeFileSync(path.join(ep, 'contract.md'), '<!-- CONTRACT-SURFACE:BEGIN -->\nPOST /x\nPOST /z\n<!-- CONTRACT-SURFACE:END -->\n');
  const lines = [];
  const orig = console.log;
  console.log = (s = '') => lines.push(String(s));
  try { await gateStatus(T, { epic: 'EP-test' }); } finally { console.log = orig; }
  const archLine = lines.find((l) => l.includes('architecture-review') && l.includes('approval'));
  assert.match(archLine, /0 approval\(s\)/);
  assert.match(archLine, /stale \(revoked\)/);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad repo list` — staleness as a human-visible flag
// ---------------------------------------------------------------------------------------------
const { runRepo } = await import('./repo.mjs');

test('repo list flags a repo whose HEAD advanced past syncedHead', async () => {
  const { T, backend } = scaffold();
  // syncedHead in scaffold == current HEAD => fresh
  let r = await runRepo(T, { action: 'list' });
  assert.equal(r.stale, 0);
  git(backend, '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '--allow-empty', '-m', 'move');
  r = await runRepo(T, { action: 'list' });
  assert.equal(r.stale, 1);
  fs.rmSync(T, { recursive: true, force: true });
});

test('repo refresh rejects an unknown repo name', async () => {
  const { T } = scaffold();
  const prev = process.exitCode;
  const r = await runRepo(T, { action: 'refresh', name: 'ghost' });
  assert.equal(r.refreshed, 0);
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad setup` — registerRepo: only real git repos may enter the registry
// ---------------------------------------------------------------------------------------------
const { registerRepo } = await import('./setup.mjs');

test('registerRepo rejects a missing path and a non-git directory — nothing written', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-reg-'));
  const registry = { repos: [] };
  assert.equal(registerRepo(T, registry, { name: 'ghost', rpath: 'nope/ghost' }), null);
  fs.mkdirSync(path.join(T, 'plain'));
  assert.equal(registerRepo(T, registry, { name: 'plain', rpath: 'plain' }), null);
  assert.equal(registry.repos.length, 0);
  assert.ok(!fs.existsSync(path.join(T, '.sdlc/repos.json')), 'no registry written for rejected repos');
  fs.rmSync(T, { recursive: true, force: true });
});

test('registerRepo rejects paths that resolve outside the project root', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-reg3-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-outside-'));
  git(outside, 'init', '-q'); // a real git repo — still rejected, because it is outside
  const registry = { repos: [] };
  assert.equal(registerRepo(T, registry, { name: 'esc', rpath: '../' + path.basename(outside) }), null);
  assert.equal(registerRepo(T, registry, { name: 'abs', rpath: outside }), null);
  assert.equal(registry.repos.length, 0);
  // the prefix trap: a sibling dir sharing the root's name prefix must not pass containment
  const evil = `${T}-evil`;
  fs.mkdirSync(evil);
  git(evil, 'init', '-q');
  assert.equal(registerRepo(T, registry, { name: 'evil', rpath: evil }), null);
  fs.rmSync(T, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  fs.rmSync(evil, { recursive: true, force: true });
});

test('gate commands reject an invalid epic id before touching the filesystem', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-epicid-'));
  for (const bad of ['../../etc', 'EP-Bad_Slug!', 'EP-../escape']) {
    let code = 0, out = '';
    try {
      execFileSync('node', [path.join(ROOT, 'bin/yad.mjs'), 'gate', 'status', bad, '--dir', T], { stdio: 'pipe' });
    } catch (e) {
      code = e.status;
      out = (e.stdout || '').toString() + (e.stderr || '').toString();
    }
    assert.equal(code, 1, `${bad} must be rejected`);
    assert.match(out, /invalid epic id/);
  }
  fs.rmSync(T, { recursive: true, force: true });
});

test('registerRepo records a real repo; an unknown platform answer falls back to the detected one', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-reg2-'));
  const real = path.join(T, 'real');
  fs.mkdirSync(real);
  git(real, 'init', '-q');
  fs.writeFileSync(path.join(real, 'a.txt'), '1');
  git(real, 'add', '-A');
  git(real, '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '-m', 'init');
  const head = git(real, 'rev-parse', 'HEAD').toString().trim();
  const registry = { repos: [] };
  const repo = registerRepo(T, registry, { name: 'real', rpath: 'real', platform: 'bitbucket', today: '2026-06-10' });
  assert.ok(repo);
  assert.equal(repo.platform, 'github', 'unknown platform falls back (no remote => github)');
  assert.equal(repo.syncedHead, head);
  assert.equal(repo.git_url, null, 'no origin remote recorded as null, not ""');
  const reg = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/repos.json')));
  assert.equal(reg.repos.length, 1);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// platform.mjs — pure mapping helpers (no network)
// ---------------------------------------------------------------------------------------------
const { detectPlatform, cliFor, resolveLogin, mapApprovers } = await import('./platform.mjs');

test('detectPlatform / cliFor', () => {
  assert.equal(detectPlatform('git@github.com:o/r.git'), 'github');
  assert.equal(detectPlatform('https://gitlab.com/o/r.git'), 'gitlab');
  assert.equal(detectPlatform('file:///local'), null);
  assert.equal(cliFor('github'), 'gh');
  assert.equal(cliFor('gitlab'), 'glab');
});

test('resolveLogin derives a domain-owner record for a touched repo', () => {
  const roster = [{ login: 'ca', name: 'carol', role: 'reviewer' }];
  const repos = [{ name: 'backend', domain_owner: 'carol' }];
  const recs = resolveLogin('ca', roster, repos, ['backend']);
  assert.deepEqual(recs.map((r) => r.role).sort(), ['domain-owner', 'reviewer']);
  // unmapped login => flagged plain reviewer, never promoted
  const unknown = resolveLogin('zz', roster, repos, ['backend']);
  assert.deepEqual(unknown, [{ name: 'zz', role: 'reviewer', unverified: true }]);
});

test('mapApprovers only counts APPROVED and carries submittedAt', () => {
  const reviews = [
    { login: 'al', state: 'APPROVED', submittedAt: 't1' },
    { login: 'bo', state: 'CHANGES_REQUESTED', submittedAt: 't2' },
  ];
  const recs = mapApprovers(reviews, { roster: [{ login: 'al', name: 'alice', role: 'owner' }], repos: [], touchedDomains: [] });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].name, 'alice');
  assert.equal(recs[0].submittedAt, 't1');
});

// ---------------------------------------------------------------------------------------------
// `yad commit` — end-to-end against a real temp git repo
// ---------------------------------------------------------------------------------------------
const { runCommit } = await import('./commit.mjs');

test('runCommit writes a conventional commit with trailers', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-commit-'));
  git(T, 'init', '-q');
  git(T, 'config', 'user.email', 'a@b.c');
  git(T, 'config', 'user.name', 'x');
  git(T, 'commit', '-q', '--allow-empty', '-m', 'init');   // born branch so the feature branch has a base
  git(T, 'checkout', '-q', '-b', 'feat/EP-x-S01-T01-thing');
  fs.writeFileSync(path.join(T, 'a.txt'), 'hi');
  git(T, 'add', '-A');
  await runCommit(T, { type: 'feat', message: 'add a thing', ai: 'claude' });
  const body = git(T, 'log', '-1', '--format=%B').toString();
  assert.match(body, /^feat: add a thing/);
  assert.match(body, /Task: EP-x-S01-T01/);          // derived from the branch
  assert.match(body, /Co-Authored-By: Claude/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCommit refuses when nothing is staged', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-commit2-'));
  git(T, 'init', '-q');
  const prev = process.exitCode;
  const r = await runCommit(T, { type: 'feat', message: 'x' });
  assert.equal(r, undefined);
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCommit dry-run prints without committing', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-commit3-'));
  git(T, 'init', '-q');
  git(T, 'config', 'user.email', 'a@b.c');
  git(T, 'config', 'user.name', 'x');
  fs.writeFileSync(path.join(T, 'a.txt'), 'hi');
  git(T, 'add', '-A');
  const r = await runCommit(T, { type: 'docs', message: 'note', task: 'EP-x-S01-T09', dryRun: true });
  assert.match(r.message, /^docs: note/);
  assert.throws(() => git(T, 'rev-parse', 'HEAD'));   // nothing committed
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad gate ci` — event-driven sync: derive from the review branch, overlay, ledger-only commit
// ---------------------------------------------------------------------------------------------
const { parseReviewBranch, artifactFromBase, artifactPaths, upsertHubPr, contractSurfaceHash } = await import('./epic-state.mjs');
const { gateCi } = await import('./gate.mjs');

test('parseReviewBranch accepts review/EP-*/<base> and rejects everything else', () => {
  assert.deepEqual(parseReviewBranch('review/EP-x/architecture'), { epic: 'EP-x', base: 'architecture' });
  assert.deepEqual(parseReviewBranch('review/EP-istifta-inquiries/stories'), { epic: 'EP-istifta-inquiries', base: 'stories' });
  assert.equal(parseReviewBranch('feature/foo'), null);
  assert.equal(parseReviewBranch('review/notanepic'), null);
  assert.equal(parseReviewBranch('review/notanepic/epic'), null);
  // the epic segment becomes a path under epics/ — only EP-[a-z0-9-]+ may pass
  assert.equal(parseReviewBranch('review/EP-../epic'), null);
  assert.equal(parseReviewBranch('review/EP-Bad_Slug/epic'), null);
});

test('artifactFromBase reverses artifactBase (single story maps to the stories/ set)', () => {
  assert.equal(artifactFromBase('epic'), 'epic.md');
  assert.equal(artifactFromBase('architecture'), 'architecture.md');
  assert.equal(artifactFromBase('ui-design'), 'ui-design.md');
  assert.equal(artifactFromBase('stories'), 'stories/');
  assert.equal(artifactFromBase('stories-S01'), 'stories/');
});

test('artifactPaths covers what artifactHash fingerprints', () => {
  assert.deepEqual(artifactPaths('architecture'), ['architecture.md', 'contract.md', '.sdlc/contract-lock.json']);
  assert.deepEqual(artifactPaths('stories'), ['stories']);
  assert.deepEqual(artifactPaths('epic'), ['epic.md']);
});

test('upsertHubPr replaces by artifact, never duplicates', () => {
  const a = upsertHubPr([], { artifact: 'epic.md', number: 1 });
  const b = upsertHubPr(a, { artifact: 'epic.md', number: 2 });
  assert.equal(b.length, 1);
  assert.equal(b[0].number, 2);
  const c2 = upsertHubPr(b, { artifact: 'architecture.md', number: 3 });
  assert.equal(c2.length, 2);
});

// A hub repo with a bare origin: main carries the epic scaffolding (NO hub-prs.json — the
// wrinkle-1 case), the review branch carries the artifact edit, and a separate "CI" clone runs
// `gate ci` the way the workflow does.
const SEED_CONTRACT = '<!-- CONTRACT-SURFACE:BEGIN -->\nPOST /x\n<!-- CONTRACT-SURFACE:END -->\n';
const BRANCH_CONTRACT = '<!-- CONTRACT-SURFACE:BEGIN -->\nPOST /x\nPOST /y\n<!-- CONTRACT-SURFACE:END -->\n';
function scaffoldCiHub() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ci-'));
  const origin = path.join(T, 'origin.git');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '--bare');
  git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/trunk'); // a NON-main default proves gate ci derives the push target from the checkout
  const author = path.join(T, 'author');
  git(T, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'a@b.c');
  git(author, 'config', 'user.name', 'x');
  fs.mkdirSync(path.join(author, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(author, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github', // no default_branch — the `yad setup` hub.json shape; gate ci must derive it
    roster: [
      { login: 'al', name: 'alice', role: 'owner' },
      { login: 'bo', name: 'bob', role: 'reviewer' },
      { login: 'ca', name: 'carol', role: 'reviewer' },
    ],
  }));
  fs.writeFileSync(path.join(author, '.sdlc/repos.json'), JSON.stringify({
    repos: [{ name: 'backend', path: 'demo/backend', domain_owner: 'carol', default_branch: 'main' }],
  }));
  const ep = path.join(author, 'epics/EP-test');
  fs.mkdirSync(path.join(ep, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(ep, 'epic.md'), '---\nid: EP-test\nowner: alice\nrepos: [backend]\n---\n');
  fs.writeFileSync(path.join(ep, 'architecture.md'), '# arch\n');
  fs.writeFileSync(path.join(ep, 'contract.md'), SEED_CONTRACT);
  fs.writeFileSync(path.join(ep, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-test', currentStep: 'architecture-review',
    steps: [
      { id: 'architecture', type: 'author', artifact: 'architecture.md', status: 'done', risk_tags: [] },
      { id: 'architecture-review', type: 'review+approve', artifact: 'architecture.md', status: 'in_review', risk_tags: ['contract'] },
      { id: 'ui-design', type: 'author', artifact: 'ui-design.md', status: 'blocked', risk_tags: [] },
    ],
  }));
  git(author, 'add', '-A');
  git(author, 'commit', '-q', '-m', 'seed');
  git(author, 'branch', '-q', '-M', 'trunk');
  git(author, 'push', '-q', 'origin', 'trunk');
  // the review branch carries the artifact change reviewers approved
  git(author, 'checkout', '-q', '-b', 'review/EP-test/architecture');
  fs.writeFileSync(path.join(ep, 'contract.md'), BRANCH_CONTRACT);
  git(author, 'add', '-A');
  git(author, 'commit', '-q', '-m', 'review: architecture (EP-test)');
  git(author, 'push', '-q', 'origin', 'review/EP-test/architecture');
  git(author, 'checkout', '-q', 'trunk');
  // the throwaway CI checkout, on the default branch, without the artifact edit
  const ci = path.join(T, 'ci');
  git(T, 'clone', '-q', origin, ci);
  git(ci, 'config', 'user.email', 'yad-gate-sync@noreply');
  git(ci, 'config', 'user.name', 'yad-gate-sync');
  return { T, origin, author, ci };
}
const show = (cwd, ref) => git(cwd, 'show', ref).toString();

test('gate ci: derives epic/artifact from the branch, syncs, commits ONLY the ledger to the default branch', async () => {
  const { T, author, ci } = scaffoldCiHub();
  await gateCi(ci, { branch: 'review/EP-test/architecture', pr: 7, today: '2026-06-09', reader: () => fullApproval });

  git(author, 'fetch', '-q', 'origin');
  // step advanced + hub-prs.json upserted from the event (it was never committed by the author)
  const state = JSON.parse(show(author, 'origin/trunk:epics/EP-test/.sdlc/state.json'));
  assert.equal(state.steps.find((s) => s.id === 'architecture-review').status, 'done');
  assert.equal(state.currentStep, 'ui-design');
  const hubPrs = JSON.parse(show(author, 'origin/trunk:epics/EP-test/.sdlc/hub-prs.json'));
  assert.equal(hubPrs[0].number, 7);
  // the approval is bound to the BRANCH contract surface (the overlay), not main's stale one
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hash-'));
  fs.writeFileSync(path.join(tmp, 'contract.md'), BRANCH_CONTRACT);
  const branchHash = contractSurfaceHash(tmp);
  const approvals = JSON.parse(show(author, 'origin/trunk:epics/EP-test/.sdlc/approvals.json'));
  assert.ok(approvals.every((a) => a.artifactHash === branchHash), 'approvals bound to the reviewed content');
  // the artifact itself never lands via CI — only via the human merge
  assert.equal(show(author, 'origin/trunk:epics/EP-test/contract.md'), SEED_CONTRACT);
  assert.equal(fs.readFileSync(path.join(ci, 'epics/EP-test/contract.md'), 'utf8'), SEED_CONTRACT, 'overlay dropped in the CI tree');
  // loop guard rides on the commit
  assert.match(git(author, 'log', '-1', '--format=%B', 'origin/trunk').toString(), /\[skip ci\]/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate ci: a rejected push rebases and retries (competing ledger commit lands too)', async () => {
  const { T, author, ci } = scaffoldCiHub();
  // a competing commit reaches the default branch after the CI clone was taken
  fs.writeFileSync(path.join(author, 'NOTES.md'), 'competing\n');
  git(author, 'add', '-A');
  git(author, 'commit', '-q', '-m', 'competing');
  git(author, 'push', '-q', 'origin', 'trunk');

  await gateCi(ci, { branch: 'review/EP-test/architecture', pr: 7, today: '2026-06-09', reader: () => fullApproval });
  git(author, 'fetch', '-q', 'origin');
  const count = Number(git(author, 'rev-list', '--count', 'origin/trunk').toString().trim());
  assert.equal(count, 3, 'seed + competing + sync all on trunk');
  const state = JSON.parse(show(author, 'origin/trunk:epics/EP-test/.sdlc/state.json'));
  assert.equal(state.currentStep, 'ui-design');
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate ci: a non-review branch is a graceful no-op', async () => {
  const { T, ci } = scaffoldCiHub();
  const r = await gateCi(ci, { branch: 'feature/foo', pr: 1, today: '2026-06-09', reader: () => fullApproval });
  assert.equal(r.synced, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate ci sweep: syncs every open review PR, one commit, holds the unapproved gate', async () => {
  const { T, ep } = scaffoldEpic();
  // second epic, base-rule gate over epic.md, held (no approvals on its PR)
  const ep2 = path.join(T, 'epics/EP-two');
  fs.mkdirSync(path.join(ep2, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(ep2, 'epic.md'), '---\nid: EP-two\nowner: alice\nrepos: [backend]\n---\n');
  fs.writeFileSync(path.join(ep2, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-two', currentStep: 'epic-review',
    steps: [
      { id: 'epic', type: 'author', artifact: 'epic.md', status: 'done', risk_tags: [] },
      { id: 'epic-review', type: 'review+approve', artifact: 'epic.md', status: 'in_review', risk_tags: [] },
      { id: 'architecture', type: 'author', artifact: 'architecture.md', status: 'blocked', risk_tags: [] },
    ],
  }));
  fs.writeFileSync(path.join(ep2, '.sdlc/hub-prs.json'), JSON.stringify([
    { step: 'epic-review', artifact: 'epic.md', platform: 'github', number: 9, url: 'http://x/9', branch: 'review/EP-two/epic', lastSyncedAt: null },
  ]));
  git(T, 'init', '-q');
  git(T, 'config', 'user.email', 'a@b.c');
  git(T, 'config', 'user.name', 'x');
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'seed');

  const held = { ok: true, state: 'OPEN', merged: false, headOid: 'z', reviews: [], threads: [] };
  const reader = (platform, n) => (n === 7 ? fullApproval : held);
  await gateCi(T, { today: '2026-06-09', push: false, reader });

  const s1 = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json')));
  assert.equal(s1.steps.find((s) => s.id === 'architecture-review').status, 'done');
  const s2 = JSON.parse(fs.readFileSync(path.join(ep2, '.sdlc/state.json')));
  assert.equal(s2.steps.find((s) => s.id === 'epic-review').status, 'in_review', 'unapproved gate held');
  assert.equal(Number(git(T, 'rev-list', '--count', 'HEAD').toString().trim()), 2, 'one sweep commit');
  assert.match(git(T, 'log', '-1', '--format=%B').toString(), /scheduled gate sync \[skip ci\]/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate ci sweep: one corrupt epic is skipped (exit 1) while the rest still sync', async () => {
  const { T, ep } = scaffoldEpic();
  // a second epic with a truncated state.json — must not block EP-test's sync
  const ep2 = path.join(T, 'epics/EP-two');
  fs.mkdirSync(path.join(ep2, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(ep2, '.sdlc/state.json'), '{"currentStep": "epic-rev');
  git(T, 'init', '-q');
  git(T, 'config', 'user.email', 'a@b.c');
  git(T, 'config', 'user.name', 'x');
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'seed');

  const prev = process.exitCode;
  await gateCi(T, { today: '2026-06-09', push: false, reader: () => fullApproval });
  assert.equal(process.exitCode, 1, 'the corrupt epic surfaces as a failed run');
  process.exitCode = prev;

  const s1 = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json')));
  assert.equal(s1.currentStep, 'ui-design', 'the healthy epic still synced and advanced');
  assert.equal(fs.readFileSync(path.join(ep2, '.sdlc/state.json'), 'utf8'),
    '{"currentStep": "epic-rev', 'the corrupt file is left for recovery, never rewritten');
  fs.rmSync(T, { recursive: true, force: true });
});

test('check --fix wires the hub gate-sync CI only when the bridge is enabled', async () => {
  const { T } = scaffold();
  // no hub.json -> no hub action
  await reconcile(T, { fix: true });
  assert.ok(!fs.existsSync(path.join(T, '.github/workflows/yad-gate-sync.yml')), 'no hub.json => not wired');
  // hub on github with the bridge -> wired + idempotent
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', bridge_enabled: true, roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(fs.existsSync(path.join(T, '.github/workflows/yad-gate-sync.yml')), 'hub workflow installed');
  const again = await reconcile(T, { fix: false });
  assert.equal(again.counts.missing, 0);
  assert.equal(again.counts.outdated, 0);
  // gitlab with the bridge -> fragment installed + idempotent
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge_enabled: true, roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(fs.existsSync(path.join(T, '.gitlab/ci/yad-gate-sync.yml')), 'gitlab fragment installed');
  const gl = await reconcile(T, { fix: false });
  assert.equal(gl.counts.missing, 0);
  assert.equal(gl.counts.outdated, 0);
  // bridge disabled (either spelling) -> no action; an already-installed file is left alone
  fs.rmSync(path.join(T, '.gitlab/ci/yad-gate-sync.yml'));
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge: false, roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(!fs.existsSync(path.join(T, '.gitlab/ci/yad-gate-sync.yml')), 'disabled bridge => not wired');
  // legacy `bridge: true` (older setup) still counts as an explicit enable
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge: true, roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(fs.existsSync(path.join(T, '.gitlab/ci/yad-gate-sync.yml')), 'legacy bridge:true wires');
  // platform set but NO enable flag in either spelling -> not wired (explicit-enable semantics)
  fs.rmSync(path.join(T, '.gitlab/ci/yad-gate-sync.yml'));
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(!fs.existsSync(path.join(T, '.gitlab/ci/yad-gate-sync.yml')), 'missing flag => not wired');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// verified-commits gate — author allowlist generation + the bash gate itself
// ---------------------------------------------------------------------------------------------
const { verifiedAuthorEmails, authorsActions } = await import('./plan.mjs');

test('verifiedAuthorEmails: roster emails + verified_authors, lower-cased, deduped, sorted', () => {
  const hub = {
    roster: [
      { login: 'al', name: 'alice', role: 'owner', email: 'Alice@Corp.io' },
      { login: 'bo', name: 'bob', role: 'reviewer', emails: ['bob@corp.io', 'bob@users.noreply.github.com'] },
      { login: 'ca', name: 'carol', role: 'reviewer' }, // no email — contributes nothing
    ],
    verified_authors: ['dev@corp.io', 'alice@corp.io'], // dupe of the roster email
  };
  assert.deepEqual(verifiedAuthorEmails(hub), [
    'alice@corp.io', 'bob@corp.io', 'bob@users.noreply.github.com', 'dev@corp.io',
  ]);
  assert.deepEqual(verifiedAuthorEmails({ roster: [{ login: 'x', name: 'x', role: 'owner' }] }), []);
  assert.deepEqual(verifiedAuthorEmails(null), []);
});

test('check --fix generates .sdlc/verified-authors in hub + repos only when emails exist', async () => {
  const { T } = scaffold();
  // no hub.json / no emails -> no allowlist anywhere
  await reconcile(T, { fix: true });
  assert.ok(!fs.existsSync(path.join(T, '.sdlc/verified-authors')), 'no emails => no hub allowlist');

  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github', bridge_enabled: true,
    roster: [{ login: 'al', name: 'alice', role: 'owner', email: 'alice@corp.io' }],
    verified_authors: ['dev@corp.io'],
  }));
  await reconcile(T, { fix: true });
  for (const f of ['.sdlc/verified-authors', 'demo/backend/.sdlc/verified-authors', 'demo/backend/checks/verified-commits.sh', 'checks/verified-commits.sh', '.github/workflows/yad-verified-commits.yml']) {
    assert.ok(fs.existsSync(path.join(T, f)), `expected ${f}`);
  }
  const list = fs.readFileSync(path.join(T, '.sdlc/verified-authors'), 'utf8');
  assert.match(list, /alice@corp\.io\ndev@corp\.io\n$/);
  assert.equal(list, fs.readFileSync(path.join(T, 'demo/backend/.sdlc/verified-authors'), 'utf8'), 'repo copy identical');

  const again = await reconcile(T, { fix: false });
  assert.equal(again.counts.missing, 0);
  assert.equal(again.counts.outdated, 0);

  // a hand-edited allowlist is drift-corrected back from hub.json
  fs.appendFileSync(path.join(T, '.sdlc/verified-authors'), 'rogue@evil.io\n');
  const drift = await reconcile(T, { fix: false });
  assert.equal(drift.counts.outdated, 1, 'hand edit shows as outdated');
  fs.rmSync(T, { recursive: true, force: true });
});

// The gate script itself, against a real temp repo. No origin remote => the signature check is
// SKIPPED with a warning, so this exercises the author-allowlist half hermetically.
const GATE = path.join(ROOT, 'skills/yad-checks/templates/checks/verified-commits.sh');
function scaffoldGateRepo() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-vc-'));
  git(T, 'init', '-q');
  git(T, 'config', 'user.name', 'alice');
  git(T, 'config', 'user.email', 'alice@corp.io');
  fs.writeFileSync(path.join(T, 'a.txt'), '1');
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'seed');
  git(T, 'branch', '-q', '-M', 'main');
  git(T, 'checkout', '-q', '-b', 'feature');
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/verified-authors'), '# generated\nalice@corp.io\n');
  return T;
}
const runGate = (cwd, env = {}) => {
  try {
    const out = execFileSync('bash', [GATE, 'main'], { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
    return { code: 0, out: out.toString() };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
};

test('verified-commits gate: allowlisted author passes; unknown author fails', () => {
  const T = scaffoldGateRepo();
  fs.writeFileSync(path.join(T, 'b.txt'), '2');
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'by alice'); // .sdlc + b.txt authored by alice@corp.io
  let r = runGate(T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /known identity/);
  assert.match(r.out, /signature verification SKIPPED/);

  fs.writeFileSync(path.join(T, 'c.txt'), '3');
  git(T, 'add', '-A');
  git(T, '-c', 'user.email=mallory@evil.io', '-c', 'user.name=mallory', 'commit', '-q', '-m', 'by mallory');
  r = runGate(T);
  assert.equal(r.code, 1, 'unknown author must fail the gate');
  assert.match(r.out, /mallory@evil\.io.*unverified user/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('verified-commits gate: missing allowlist warns (not enforced); empty range passes', () => {
  const T = scaffoldGateRepo();
  fs.rmSync(path.join(T, '.sdlc/verified-authors'));
  fs.writeFileSync(path.join(T, 'b.txt'), '2');
  git(T, 'add', '-A');
  git(T, '-c', 'user.email=anyone@anywhere.io', '-c', 'user.name=zz', 'commit', '-q', '-m', 'x');
  let r = runGate(T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /author allowlist NOT enforced/);

  git(T, 'checkout', '-q', 'main');
  r = runGate(T);
  assert.equal(r.code, 0);
  assert.match(r.out, /no commits in/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('verified-commits gate: unresolvable base fails closed', () => {
  const T = scaffoldGateRepo();
  try {
    execFileSync('bash', [GATE, 'origin/nope'], { cwd: T, stdio: 'pipe' });
    assert.fail('should exit non-zero');
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(e.stdout.toString(), /base ref 'origin\/nope' not found/);
  }
  fs.rmSync(T, { recursive: true, force: true });
});

test('verified-commits gate: unknown SDLC_PLATFORM override fails closed; CRLF allowlist tolerated', () => {
  const T = scaffoldGateRepo();
  fs.writeFileSync(path.join(T, 'b.txt'), '2');
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'by alice');
  let r = runGate(T, { SDLC_PLATFORM: 'bogus' });
  assert.equal(r.code, 1, 'unknown platform must fail closed');
  assert.match(r.out, /unknown platform 'bogus'/);
  // CRLF + padded allowlist still matches
  fs.writeFileSync(path.join(T, '.sdlc/verified-authors'), '# generated\r\n  ALICE@corp.io  \r\n');
  r = runGate(T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /known identity/);
  fs.rmSync(T, { recursive: true, force: true });
});
