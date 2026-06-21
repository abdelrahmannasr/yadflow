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

// `yad setup` now migrates a pre-2.0 install too (project IDE targets + the opt-in global
// ~/.claude/skills pass). Both reuse legacyModuleActions; the global pass calls it as
// legacyModuleActions(os.homedir(), ['.claude']) so an old skill at <root>/.claude/skills/<old>
// is removed and its yad-* rename installed. This drives that helper directly (the same way
// setup's applyActions does) to avoid the interactive runSetup prompts.
const { legacyModuleActions } = await import('./plan.mjs');
test('setup migration: legacyModuleActions renames <root>/.claude/skills/sdlc-* to yad-*', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-setup-legacy-'));
  fs.mkdirSync(path.join(T, '.claude/skills/sdlc-author-epic'), { recursive: true });
  fs.writeFileSync(path.join(T, '.claude/skills/sdlc-author-epic/SKILL.md'), '---\nname: sdlc-author-epic\n---\n');

  const actions = legacyModuleActions(T, ['.claude']);
  assert.ok(actions.length >= 1, 'detects the legacy skill');
  for (const a of actions) a.apply(); // setup applies these with { force: true } — every action runs

  assert.ok(!fs.existsSync(path.join(T, '.claude/skills/sdlc-author-epic')), 'old sdlc-* removed');
  assert.ok(fs.existsSync(path.join(T, '.claude/skills/yad-epic/SKILL.md')), 'yad-* rename installed');

  // Idempotent: a clean tree yields no further legacy actions.
  assert.equal(legacyModuleActions(T, ['.claude']).length, 0, 'migration is idempotent');
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

// Every GitLab fragment that runs a docker-image job must carry `tags: [$YAD_RUNNER_TAGS]` so a
// tag-locked instance can route it (issue #50). Guards against a future revert dropping the tag.
test('gitlab fragments declare tags: [$YAD_RUNNER_TAGS] on their docker jobs', () => {
  for (const rel of [
    'skills/yad-checks/templates/gitlab/yad-checks.gitlab-ci.yml',
    'skills/yad-checks/templates/gitlab/yad-verified-commits.gitlab-ci.yml',
    'skills/yad-hub-bridge/templates/gitlab/yad-gate-sync.gitlab-ci.yml',
  ]) {
    const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(/^\s*image:/m.test(txt), `${rel}: expected an image: job`);
    assert.ok(txt.includes('tags: [$YAD_RUNNER_TAGS]'), `${rel}: missing tags: [$YAD_RUNNER_TAGS]`);
  }
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

// `--check` value-consume must be scoped to the `next` command — it must NOT swallow a positional in
// any other subcommand (regression guard for the bin/yad.mjs arg parser).
// Run the installed CLI in dir T and capture { out, code } without throwing on non-zero exit.
const yadRun = (T, ...args) => {
  try { return { out: execFileSync('node', [path.join(ROOT, 'bin/yad.mjs'), ...args], { cwd: T, encoding: 'utf8' }), code: 0 }; }
  catch (e) { return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status ?? 1 }; }
};

test('CLI: `next <epic> --check <step>` reads the step; bare `--check` is a usage error', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-argp-'));
  fs.mkdirSync(path.join(T, 'epics/EP-x/.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-x/.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-x', currentStep: 'architecture', steps: [
      { id: 'epic', type: 'author', artifact: 'epic.md', status: 'done', risk_tags: [] },
      { id: 'epic-review', type: 'review+approve', artifact: 'epic.md', status: 'done', risk_tags: [] },
      { id: 'architecture', type: 'author', artifact: 'architecture.md', status: 'in_progress', risk_tags: [] },
      { id: 'architecture-review', type: 'review+approve', artifact: 'architecture.md', status: 'blocked', risk_tags: [] },
    ],
  }));
  assert.equal(yadRun(T, 'next', 'EP-x', '--check', 'architecture').code, 0); // runnable
  assert.equal(yadRun(T, 'next', 'EP-x', '--check', 'architecture-review').code, 1); // blocked
  assert.equal(yadRun(T, 'next', 'EP-x', '--check').code, 1); // no step → usage error
});

test('CLI: a non-next command does not let `--check` swallow a following positional', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-argp2-'));
  // Before the scoped fix, `gate --check open EP-x epic.md` consumed `open` as the --check value,
  // shifting `EP-x`/`epic.md` and yielding a spurious "invalid epic id". After: `open` stays the action.
  const r = yadRun(T, 'gate', '--check', 'open', 'EP-x', 'epic.md');
  assert.doesNotMatch(r.out, /invalid epic id/);
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
// runShip — orchestration only (commit then open-pr); the PR step must NOT run without a commit
// ---------------------------------------------------------------------------------------------
const { runShip } = await import('./ship.mjs');

// A standalone code repo with a staged atomic change on a task branch (no remote — open-pr would
// push, which we never reach in these guard tests).
function scaffoldStaged() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ship-'));
  git(T, 'init', '-q');
  git(T, 'config', 'user.email', 'a@b.c');
  git(T, 'config', 'user.name', 'x');
  fs.writeFileSync(path.join(T, 'seed.txt'), '0');
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'seed');
  git(T, 'branch', '-q', '-M', 'main');
  git(T, 'checkout', '-q', '-b', 'feat/EP-demo-S01-T01-x');
  return T;
}

test('runShip --dry-run builds the message and never opens a PR', async () => {
  const prev = process.exitCode;
  const T = scaffoldStaged();
  fs.writeFileSync(path.join(T, 'a.txt'), '1');
  git(T, 'add', '-A');
  const r = await runShip(T, { type: 'feat', message: 'add a thing', ai: 'none', dryRun: true });
  assert.match(r.message, /^feat: add a thing/);
  assert.ok(!r.url, 'no PR opened on a dry run');
  process.exitCode = prev; // dry run does not set it, but keep the suite clean
  fs.rmSync(T, { recursive: true, force: true });
});

test('runShip aborts the PR step when the commit does not land (nothing staged)', async () => {
  const prev = process.exitCode;
  const T = scaffoldStaged(); // nothing staged this time
  const r = await runShip(T, { type: 'feat', message: 'add a thing' });
  assert.ok(!r || !r.url, 'no PR opened when the commit fails');
  assert.ok(process.exitCode, 'commit failure sets a non-zero exit code');
  process.exitCode = prev; // restore so the failed-commit signal does not leak to the runner
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// Gate predicate — pure, the heart of the gate
// ---------------------------------------------------------------------------------------------
const { gatePredicate, artifactHash, nextAction, preconditionsMet } = await import('./epic-state.mjs');

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

test('gatePredicate: solo waives approvals — merged + resolved passes with zero approvals', () => {
  const p = gatePredicate({ step: baseStep, approvals: [], currentHash: 'sha256:H1', merged: true, threadsResolved: true, solo: true });
  assert.equal(p.passed, true);
  assert.equal(p.rule, 'solo');
});

test('gatePredicate: solo still requires the merge and resolved threads', () => {
  const unmerged = gatePredicate({ step: baseStep, approvals: [], merged: false, threadsResolved: true, solo: true });
  assert.equal(unmerged.passed, false);
  assert.ok(unmerged.missing.includes('review PR/MR not merged'));
  const unresolved = gatePredicate({ step: baseStep, approvals: [], merged: true, threadsResolved: false, solo: true });
  assert.equal(unresolved.passed, false);
  assert.ok(unresolved.missing.includes('unresolved review comments'));
});

test('gatePredicate: solo passes an escalated step without any domain-owner approvals', () => {
  const p = gatePredicate({ step: escStep, approvals: [], currentHash: 'sha256:C', touchedDomains: ['backend', 'mobile'], merged: true, threadsResolved: true, solo: true });
  assert.equal(p.passed, true);
  assert.equal(p.rule, 'solo');
});

// ---------------------------------------------------------------------------------------------
// `yad next` — the driver: nextAction() + preconditionsMet() (both pure)
// ---------------------------------------------------------------------------------------------
// Build a single state-machine step record for the test chains below.
const S = (id, type, status, artifact, extra = {}) => ({ id, type, status, artifact, risk_tags: [], ...extra });
// A small front chain at an arbitrary point: epic, epic-review, architecture, architecture-review.
const chain = (overrides) => ({
  epicId: 'EP-x',
  currentStep: overrides.currentStep,
  steps: [
    S('epic', 'author', overrides.epic ?? 'done', 'epic.md'),
    S('epic-review', 'review+approve', overrides.epicReview ?? 'done', 'epic.md'),
    S('architecture', 'author', overrides.architecture ?? 'blocked', 'architecture.md'),
    S('architecture-review', 'review+approve', overrides.architectureReview ?? 'blocked', 'architecture.md'),
  ],
});

test('preconditionsMet: greenfield (no state) — epic is the entry step, architecture is not', () => {
  assert.equal(preconditionsMet(null, 'epic').ok, true);
  assert.equal(preconditionsMet(null, 'architecture').ok, false);
});

test('preconditionsMet: current step runnable, downstream blocked, done step not re-runnable', () => {
  const state = chain({ currentStep: 'architecture', architecture: 'in_progress' });
  assert.equal(preconditionsMet(state, 'architecture').ok, true);
  const blocked = preconditionsMet(state, 'architecture-review');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockedBy, 'architecture');
  assert.equal(preconditionsMet(state, 'epic').ok, false); // already done
  assert.equal(preconditionsMet(state, 'nope').ok, false); // unknown
});

test('nextAction: author step → invoke the mapped skill', () => {
  const a = nextAction({ state: chain({ currentStep: 'architecture', architecture: 'in_progress' }), hubPrs: [] }, { epic: 'EP-x' });
  assert.equal(a.kind, 'author');
  assert.equal(a.skill, 'yad-architecture');
  assert.equal(a.artifact, 'architecture.md');
});

test('nextAction: review step with no PR → open; with a PR → sync', () => {
  const state = chain({ currentStep: 'epic-review', epicReview: 'in_review', architecture: 'blocked' });
  const open = nextAction({ state, hubPrs: [] }, { epic: 'EP-x' });
  assert.equal(open.kind, 'review-open');
  assert.equal(open.command, 'yad gate open EP-x epic.md');
  const sync = nextAction({ state, hubPrs: [{ artifact: 'epic.md', number: 7 }] }, { epic: 'EP-x' });
  assert.equal(sync.kind, 'review-sync');
  assert.equal(sync.command, 'yad gate sync EP-x epic.md');
  assert.equal(sync.pr, 7);
});

test('nextAction: ready-for-build → build; an open test-cases track is surfaced as parallel', () => {
  const base = { epicId: 'EP-x', currentStep: 'ready-for-build', steps: [S('stories-review', 'review+approve', 'done', 'stories/')] };
  assert.equal(nextAction({ state: base, hubPrs: [] }).kind, 'build');
  assert.equal(nextAction({ state: base, hubPrs: [] }).parallel, null);
  const withTc = { ...base, steps: [...base.steps, S('test-cases', 'author', 'in_progress', 'test-cases.md')] };
  const a = nextAction({ state: withTc, hubPrs: [] });
  assert.equal(a.kind, 'build');
  assert.equal(a.parallel.skill, 'yad-test-cases');
});

test('nextAction: no state → kind new (seed with yad-epic)', () => {
  const a = nextAction({ state: null, hubPrs: [] }, { epic: 'EP-x' });
  assert.equal(a.kind, 'new');
  assert.equal(a.skill, 'yad-epic');
});

// runNext (the CLI surface) — capture stdout and assert the guidance + exit codes.
const { runNext } = await import('./next.mjs');
// Capture console.log output produced while running fn (the CLI commands print via console.log).
async function grab(fn) {
  const orig = console.log;
  const out = [];
  console.log = (...a) => out.push(a.map(String).join(' '));
  try { await fn(); } finally { console.log = orig; }
  return out.join('\n');
}
// Write a minimal per-epic state ledger under T/epics/<id>/.sdlc/state.json for driver tests.
function seedEpic(T, id, state) {
  fs.mkdirSync(path.join(T, 'epics', id, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics', id, '.sdlc/state.json'), JSON.stringify(state));
}

test('runNext: a fresh project tells you to run yad setup', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-next1-'));
  const s = await grab(() => runNext(T, {}));
  assert.match(s, /yad setup/);
});

test('runNext: set up but no epics points at yad-epic; brownfield suggests yad-backfill first', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-next2-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null, profile: { codebase: 'brownfield' } }));
  const s = await grab(() => runNext(T, {}));
  assert.match(s, /yad-epic/);
  assert.match(s, /yad-backfill/);
});

test('runNext: specific epic prints the action; --check on a blocked step exits 1', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-next3-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null }));
  seedEpic(T, 'EP-x', chain({ currentStep: 'architecture', architecture: 'in_progress' }));
  const s = await grab(() => runNext(T, { epic: 'EP-x' }));
  assert.match(s, /yad-architecture/);
  process.exitCode = 0;
  await grab(() => runNext(T, { epic: 'EP-x', check: 'architecture-review' }));
  assert.equal(process.exitCode, 1);
  process.exitCode = 0; // do not leak a failing exit code into the test runner
});

test('runNext: review-sync action in solo mode notes the merge-only path', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-next4-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', solo: true }));
  seedEpic(T, 'EP-x', chain({ currentStep: 'epic-review', epicReview: 'in_review', architecture: 'blocked' }));
  fs.writeFileSync(path.join(T, 'epics/EP-x/.sdlc/hub-prs.json'), JSON.stringify([{ artifact: 'epic.md', number: 9 }]));
  const s = await grab(() => runNext(T, { epic: 'EP-x' }));
  assert.match(s, /yad gate sync EP-x epic\.md/);
  assert.match(s, /solo/i);
});

test('runNext: build action surfaces the parallel test-cases track', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-next5-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null }));
  seedEpic(T, 'EP-x', { epicId: 'EP-x', currentStep: 'ready-for-build', steps: [
    S('stories-review', 'review+approve', 'done', 'stories/'),
    S('test-cases', 'author', 'in_progress', 'test-cases.md'),
  ] });
  const s = await grab(() => runNext(T, { epic: 'EP-x' }));
  assert.match(s, /yad-run|build/i);
  assert.match(s, /yad-test-cases/);
});

test('runNext: several epics list each action, and --all expands them', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-next6-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null }));
  seedEpic(T, 'EP-a', chain({ currentStep: 'architecture', architecture: 'in_progress' }));
  seedEpic(T, 'EP-b', chain({ currentStep: 'epic-review', epicReview: 'in_review', architecture: 'blocked' }));
  const list = await grab(() => runNext(T, {}));
  assert.match(list, /EP-a/);
  assert.match(list, /EP-b/);
  const all = await grab(() => runNext(T, { all: true }));
  assert.match(all, /yad-architecture/); // EP-a author action shown in detail
});

test('runNext: no-epics non-brownfield omits the backfill hint; bad id / missing epic are handled', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-next7-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null, profile: { codebase: 'greenfield' } }));
  const fresh = await grab(() => runNext(T, {}));
  assert.match(fresh, /yad-epic/);
  assert.doesNotMatch(fresh, /yad-backfill/);
  process.exitCode = 0;
  await grab(() => runNext(T, { epic: 'not-an-id' }));
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
  await grab(() => runNext(T, { epic: 'EP-missing' }));
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

// ---------------------------------------------------------------------------------------------
// `yad setup` — the profile interview (resolveProfile is pure of side effects)
// ---------------------------------------------------------------------------------------------
const { resolveProfile } = await import('./setup.mjs');

test('resolveProfile: flags fully determine a solo/greenfield/monorepo profile (no prompts)', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prof-'));
  process.env.SDLC_NONINTERACTIVE = '1';
  try {
    const p = await resolveProfile(T, { solo: true, greenfield: true, monorepo: true });
    assert.deepEqual(p, { solo: true, team_size: 1, codebase: 'greenfield', repo_layout: 'monorepo', configureTools: false });
  } finally { delete process.env.SDLC_NONINTERACTIVE; }
});

test('resolveProfile: --team N is a team of N; brownfield/separate/--tools honored', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prof2-'));
  const p = await resolveProfile(T, { team: '3', brownfield: true, separate: true, tools: true });
  assert.deepEqual(p, { solo: false, team_size: 3, codebase: 'brownfield', repo_layout: 'separate', configureTools: true });
});

test('resolveProfile: carries a prior profile forward from hub.json on re-run', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-prof3-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ solo: true, profile: { codebase: 'brownfield', repo_layout: 'separate', team_size: 1 } }));
  process.env.SDLC_NONINTERACTIVE = '1';
  try {
    const p = await resolveProfile(T, {}); // no flags — must reuse hub.json
    assert.equal(p.solo, true);
    assert.equal(p.codebase, 'brownfield');
    assert.equal(p.repo_layout, 'separate');
  } finally { delete process.env.SDLC_NONINTERACTIVE; }
});

const { runSetup } = await import('./setup.mjs');

test('runSetup: solo/greenfield/monorepo writes the profile + solo and defers the optional tools', async () => {
  const { T } = scaffold();
  process.env.SDLC_NONINTERACTIVE = '1';
  try {
    await runSetup(T, { solo: true, greenfield: true, monorepo: true, ideTargets: ['.claude'] });
  } finally { delete process.env.SDLC_NONINTERACTIVE; }
  const hub = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/hub.json'), 'utf8'));
  assert.equal(hub.solo, true);
  assert.equal(hub.profile.codebase, 'greenfield');
  assert.equal(hub.profile.repo_layout, 'monorepo');
  assert.equal(JSON.parse(fs.readFileSync(path.join(T, '.sdlc/design.json'), 'utf8')).tool, 'none'); // deferred
});

test('runSetup: team + --tools records a team profile and configures the optional tools', async () => {
  const { T } = scaffold();
  process.env.SDLC_NONINTERACTIVE = '1';
  try {
    await runSetup(T, { team: '2', brownfield: true, separate: true, tools: true, ideTargets: ['.claude'] });
  } finally { delete process.env.SDLC_NONINTERACTIVE; }
  const hub = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/hub.json'), 'utf8'));
  assert.equal(hub.solo, false);
  assert.equal(hub.profile.team_size, 2);
  assert.equal(hub.profile.codebase, 'brownfield');
  assert.equal(JSON.parse(fs.readFileSync(path.join(T, '.sdlc/design.json'), 'utf8')).tool, 'figma'); // configured (default)
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
    (e) => /corrupt JSON in .*approvals\.json/.test(e.message) && e.code === 'YAD-STATE-001',
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
// `yad repo sync` — switch every connected repo to its default branch + fast-forward from origin
// ---------------------------------------------------------------------------------------------
const gc = (cwd, ...a) => git(cwd, '-c', 'user.email=a@b.c', '-c', 'user.name=x', ...a);

// A repo wired to a bare origin, currently on a `feature` branch, with origin/main one commit AHEAD.
function scaffoldSync() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-sync-'));
  git(T, 'init', '-q');
  git(T, 'init', '-q', '--bare', 'origin.git');
  const origin = path.join(T, 'origin.git');
  git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');  // so clones check out main, not master
  const backend = path.join(T, 'demo/backend');
  fs.mkdirSync(backend, { recursive: true });
  git(backend, 'init', '-q');
  fs.writeFileSync(path.join(backend, 'f.txt'), 'a');
  gc(backend, 'add', '-A');
  gc(backend, 'commit', '-q', '-m', 'init');
  git(backend, 'branch', '-M', 'main');  // deterministic default-branch name
  git(backend, 'remote', 'add', 'origin', origin);
  git(backend, 'push', '-q', 'origin', 'main');
  // advance origin/main via a throwaway second clone
  git(T, 'clone', '-q', origin, 'other');
  const other = path.join(T, 'other');
  fs.writeFileSync(path.join(other, 'g.txt'), 'b');
  gc(other, 'add', '-A');
  gc(other, 'commit', '-q', '-m', 'advance');
  git(other, 'push', '-q', 'origin', 'main');
  git(backend, 'checkout', '-q', '-b', 'feature');  // start off the default branch
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({
    repos: [{ name: 'backend', path: 'demo/backend', platform: null, default_branch: 'main' }],
  }));
  return { T, backend };
}

test('repo sync switches to the default branch and fast-forwards from origin', async () => {
  const { T, backend } = scaffoldSync();
  const r = await runRepo(T, { action: 'sync' });
  assert.equal(r.synced, 1);
  assert.equal(r.skipped, 0);
  assert.equal(git(backend, 'rev-parse', '--abbrev-ref', 'HEAD').toString().trim(), 'main');
  // local HEAD pulled up to the advanced origin tip
  assert.equal(
    git(backend, 'rev-parse', 'HEAD').toString().trim(),
    git(backend, 'rev-parse', 'origin/main').toString().trim(),
  );
  fs.rmSync(T, { recursive: true, force: true });
});

test('repo sync skips a repo with a dirty working tree', async () => {
  const { T, backend } = scaffoldSync();
  fs.writeFileSync(path.join(backend, 'f.txt'), 'dirty change');
  const before = git(backend, 'rev-parse', 'HEAD').toString().trim();
  const r = await runRepo(T, { action: 'sync' });
  assert.equal(r.synced, 0);
  assert.equal(r.skipped, 1);
  assert.equal(git(backend, 'rev-parse', '--abbrev-ref', 'HEAD').toString().trim(), 'feature'); // untouched
  assert.equal(git(backend, 'rev-parse', 'HEAD').toString().trim(), before);
  fs.rmSync(T, { recursive: true, force: true });
});

test('repo sync switches a local-only repo (no remote) to its default branch', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-sync-'));
  git(T, 'init', '-q');
  const backend = path.join(T, 'demo/backend');
  fs.mkdirSync(backend, { recursive: true });
  git(backend, 'init', '-q');
  fs.writeFileSync(path.join(backend, 'f.txt'), 'a');
  gc(backend, 'add', '-A');
  gc(backend, 'commit', '-q', '-m', 'init');
  git(backend, 'branch', '-M', 'main');  // deterministic default-branch name
  git(backend, 'checkout', '-q', '-b', 'feature');
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({
    repos: [{ name: 'backend', path: 'demo/backend', platform: null, default_branch: 'main' }],
  }));
  const r = await runRepo(T, { action: 'sync' });
  assert.equal(r.synced, 1);
  assert.equal(r.skipped, 0);
  assert.equal(git(backend, 'rev-parse', '--abbrev-ref', 'HEAD').toString().trim(), 'main');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad setup` — registerRepo: only real git repos may enter the registry
// ---------------------------------------------------------------------------------------------
const { registerRepo, registerDesign, registerTesting, registerLearning, addRepoRoles } = await import('./setup.mjs');

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

test('registerRepo records multiple domain_owners, keeping domain_owner as the first', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-reg3-'));
  const real = path.join(T, 'real');
  fs.mkdirSync(real);
  git(real, 'init', '-q');
  fs.writeFileSync(path.join(real, 'a.txt'), '1');
  git(real, 'add', '-A');
  git(real, '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '-m', 'init');
  const repo = registerRepo(T, { repos: [] }, { name: 'real', rpath: 'real', platform: 'github', domain_owners: ['carol', 'dave'], today: '2026-06-14' });
  assert.deepEqual(repo.domain_owners, ['carol', 'dave']);
  assert.equal(repo.domain_owner, 'carol', 'legacy single field mirrors the first owner');
  fs.rmSync(T, { recursive: true, force: true });
});

test('registerRepo with pack:false (greenfield) leaves syncedHead null and reads as needs-pack', async () => {
  const { T } = scaffold(); // scaffold registers `backend` with syncedHead == HEAD (fresh)
  const registry = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/repos.json'), 'utf8'));
  const repo = registerRepo(T, registry, { name: 'gf', rpath: 'demo/backend', platform: 'github', pack: false });
  assert.equal(repo.syncedHead, null, 'no pack produced => no synced HEAD claimed');
  // The fresh `backend` is not flagged; the never-packed `gf` is — so `yad repo list` reports 1 to refresh.
  const r = await runRepo(T, { action: 'list' });
  assert.equal(r.stale, 1);
  fs.rmSync(T, { recursive: true, force: true });
});

test('addRepoRoles grants per-repo roles into the roster map and warns on unknown names', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-roles-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github', roster: [
      { login: 'ca', name: 'carol', roles: { hub: ['reviewer'] } },
      { login: 'al', name: 'alice', role: 'owner' }, // legacy entry gets migrated to a map
    ],
  }));
  addRepoRoles(T, 'backend', { 'domain-owner': ['carol', 'ghost'], owner: ['alice'] });
  const hub = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/hub.json')));
  const carol = hub.roster.find((r) => r.name === 'carol');
  const alice = hub.roster.find((r) => r.name === 'alice');
  assert.deepEqual(carol.roles.backend, ['domain-owner']);
  assert.deepEqual(carol.roles.hub, ['reviewer'], 'existing hub roles preserved');
  assert.deepEqual(alice.roles, { hub: ['owner'], backend: ['owner'] }, 'legacy role migrated into the map');
  // idempotent: re-granting the same role does not duplicate
  addRepoRoles(T, 'backend', { 'domain-owner': ['carol'] });
  const again = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/hub.json')));
  assert.deepEqual(again.roster.find((r) => r.name === 'carol').roles.backend, ['domain-owner']);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad roster` — manage the roster + per-repo roles at any time (repo-driven, repos.json sync)
// ---------------------------------------------------------------------------------------------
const { parseRolesSpec, upsertRosterEntry, removeRepoRole, setRepoDomainOwners } = await import('./setup.mjs');
const { runRoster } = await import('./roster.mjs');

// A temp root with a hub.json (platform null so login validation is skipped) and a repos.json.
function rosterRoot(roster = [], repos = []) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-roster-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null, bridge_enabled: false, default_branch: 'main', roster }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos }));
  return T;
}
const readHub = (T) => JSON.parse(fs.readFileSync(path.join(T, '.sdlc/hub.json')));
const readRepos = (T) => JSON.parse(fs.readFileSync(path.join(T, '.sdlc/repos.json')));

test('parseRolesSpec parses a multi-scope spec and dedupes', () => {
  assert.deepEqual(parseRolesSpec('hub=owner,reviewer backend=domain-owner'),
    { hub: ['owner', 'reviewer'], backend: ['domain-owner'] });
  assert.deepEqual(parseRolesSpec('hub=reviewer,reviewer'), { hub: ['reviewer'] }, 'dedupes within a scope');
  assert.deepEqual(parseRolesSpec('garbage no-equals'), {}, 'malformed tokens are skipped');
  assert.deepEqual(parseRolesSpec(''), {});
});

test('upsertRosterEntry inserts a new member and upserts by login, merging roles without dropping scopes', () => {
  const T = rosterRoot();
  upsertRosterEntry(T, { login: 'gl-abd', name: 'abdulrahman', email: 'a@b.c', roles: { hub: ['owner', 'reviewer'], backend: ['domain-owner'] }, platform: 'none' });
  let e = readHub(T).roster.find((r) => r.login === 'gl-abd');
  assert.equal(e.name, 'abdulrahman');
  assert.equal(e.email, 'a@b.c');
  assert.deepEqual(e.roles, { hub: ['owner', 'reviewer'], backend: ['domain-owner'] });
  // upsert by login: add a dashboard scope; hub + backend must survive
  upsertRosterEntry(T, { login: 'gl-abd', roles: { dashboard: ['domain-owner'] }, platform: 'none' });
  e = readHub(T).roster.find((r) => r.login === 'gl-abd');
  assert.deepEqual(e.roles, { hub: ['owner', 'reviewer'], backend: ['domain-owner'], dashboard: ['domain-owner'] });
  assert.equal(readHub(T).roster.length, 1, 'upsert, not duplicate');
  fs.rmSync(T, { recursive: true, force: true });
});

test('setRepoDomainOwners adds/removes a name and mirrors domain_owner; no-op for an unregistered repo', () => {
  const T = rosterRoot([], [{ name: 'backend', domain_owner: '', domain_owners: [] }]);
  assert.equal(setRepoDomainOwners(T, 'backend', 'abdulrahman', { add: true }), true);
  assert.deepEqual(readRepos(T).repos[0].domain_owners, ['abdulrahman']);
  assert.equal(readRepos(T).repos[0].domain_owner, 'abdulrahman', 'legacy field mirrors the first owner');
  setRepoDomainOwners(T, 'backend', 'ayman', { add: true });
  assert.deepEqual(readRepos(T).repos[0].domain_owners, ['abdulrahman', 'ayman']);
  setRepoDomainOwners(T, 'backend', 'abdulrahman', { add: false });
  assert.deepEqual(readRepos(T).repos[0].domain_owners, ['ayman']);
  assert.equal(readRepos(T).repos[0].domain_owner, 'ayman', 'mirror follows the removal');
  assert.equal(setRepoDomainOwners(T, 'ghost', 'x', { add: true }), false, 'unregistered repo is a no-op');
  fs.rmSync(T, { recursive: true, force: true });
});

test('runRoster grant writes the roles map AND syncs repos.json domain_owners; revoke reverts both', async () => {
  const T = rosterRoot(
    [{ login: 'ay', name: 'ayman', roles: { hub: ['reviewer'] } }],
    [{ name: 'backend', domain_owner: '', domain_owners: [] }],
  );
  await runRoster(T, { action: 'grant', args: ['ayman', 'backend', 'domain-owner'] });
  assert.deepEqual(readHub(T).roster[0].roles.backend, ['domain-owner']);
  assert.deepEqual(readRepos(T).repos[0].domain_owners, ['ayman'], 'repos.json kept in sync');
  await runRoster(T, { action: 'revoke', args: ['ayman', 'backend', 'domain-owner'] });
  assert.equal(readHub(T).roster[0].roles.backend, undefined, 'empty scope key removed');
  assert.deepEqual(readRepos(T).repos[0].domain_owners, [], 'repos.json reverted');
  fs.rmSync(T, { recursive: true, force: true });
});

test('runRoster grant refuses a name that is not in the roster', async () => {
  const T = rosterRoot([], [{ name: 'backend', domain_owners: [] }]);
  const prev = process.exitCode;
  await runRoster(T, { action: 'grant', args: ['ghost', 'backend', 'domain-owner'] });
  assert.equal(process.exitCode, 1, 'sets a failing exit code');
  assert.deepEqual(readHub(T).roster, [], 'nothing written');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runRoster add --roles (scripted) upserts and mirrors domain-owner scopes into repos.json', async () => {
  const T = rosterRoot([], [{ name: 'backend', domain_owners: [] }, { name: 'dashboard', domain_owners: [] }]);
  await runRoster(T, { action: 'add', args: ['gl-abd'], name: 'abdulrahman', email: 'a@b.c',
    roles: 'hub=owner,reviewer backend=domain-owner dashboard=domain-owner' });
  const e = readHub(T).roster.find((r) => r.login === 'gl-abd');
  assert.deepEqual(e.roles, { hub: ['owner', 'reviewer'], backend: ['domain-owner'], dashboard: ['domain-owner'] });
  assert.deepEqual(readRepos(T).repos.find((r) => r.name === 'backend').domain_owners, ['abdulrahman']);
  assert.deepEqual(readRepos(T).repos.find((r) => r.name === 'dashboard').domain_owners, ['abdulrahman']);
  fs.rmSync(T, { recursive: true, force: true });
});

test('removeRepoRole drops one role and empties the scope key; runRoster remove deletes by login', async () => {
  const T = rosterRoot([{ login: 'ca', name: 'carol', roles: { hub: ['reviewer'], backend: ['domain-owner', 'reviewer'] } }],
    [{ name: 'backend', domain_owners: ['carol'] }]);
  removeRepoRole(T, 'carol', 'backend', ['reviewer']);
  assert.deepEqual(readHub(T).roster[0].roles.backend, ['domain-owner'], 'only the named role is removed');
  removeRepoRole(T, 'carol', 'backend', ['domain-owner']);
  assert.equal(readHub(T).roster[0].roles.backend, undefined, 'empty scope key deleted');
  await runRoster(T, { action: 'remove', args: ['ca'] });
  assert.deepEqual(readHub(T).roster, [], 'member removed by login');
  fs.rmSync(T, { recursive: true, force: true });
});

test('runRoster list reports members, repos, and hub<->repos.json domain-owner drift', async () => {
  const T = rosterRoot([{ login: 'ca', name: 'carol', roles: { hub: ['reviewer'] } }],
    [{ name: 'backend', domain_owners: ['carol'] }]); // carol owns backend in repos.json but has no roles.backend
  const summary = await runRoster(T, { action: 'list' });
  assert.equal(summary.members, 1);
  assert.equal(summary.repos, 1);
  assert.equal(summary.drift, 1, 'flags the repos.json-only ownership');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad setup` — registerDesign: record the design-tool connection (deterministic half)
// ---------------------------------------------------------------------------------------------
test('registerDesign records a known tool with source unconfirmed (MCP detection is the AI step)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-design-'));
  const d = registerDesign(T, { tool: 'figma', project_url: 'https://figma.com/files/project/1/x', today: '2026-06-13' });
  assert.equal(d.tool, 'figma');
  assert.equal(d.auth, 'user');
  assert.equal(d.source, null, 'MCP not yet confirmed at setup time');
  assert.equal(d.provider, null);
  const onDisk = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/design.json')));
  assert.equal(onDisk.tool, 'figma');
  assert.equal(onDisk.project_url, 'https://figma.com/files/project/1/x');
  assert.ok(!JSON.stringify(onDisk).includes('token'), 'no token field — references only');
  fs.rmSync(T, { recursive: true, force: true });
});

test('registerDesign: a re-connect preserves the original connectedAt, only lastSyncedAt moves', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-design3-'));
  registerDesign(T, { tool: 'figma', today: '2026-06-13' });
  const again = registerDesign(T, { tool: 'pencil', today: '2026-06-20' });
  assert.equal(again.tool, 'pencil', 'tool switched in place');
  assert.equal(again.connectedAt, '2026-06-13', 'first-connect date preserved');
  assert.equal(again.lastSyncedAt, '2026-06-20', 'lastSyncedAt advanced');
  fs.rmSync(T, { recursive: true, force: true });
});

test('registerDesign: an unknown tool falls back to the primary; `none` is markdown-only', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-design2-'));
  const bad = registerDesign(T, { tool: 'sketch', today: '2026-06-13' });
  assert.equal(bad.tool, 'figma', 'unknown tool falls back to the primary adapter');
  const none = registerDesign(T, { tool: 'none', today: '2026-06-13' });
  assert.equal(none.tool, 'none');
  assert.equal(none.source, 'unavailable', 'none => deliberate markdown-only');
  assert.equal(none.provider, null);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad setup` — registerTesting: record the testing-tool connection (deterministic half)
// ---------------------------------------------------------------------------------------------
test('registerTesting records a known tool with source unconfirmed (MCP detection is the AI step)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-testing-'));
  const t = registerTesting(T, { tool: 'playwright', project_url: 'tests/playwright.config.ts', today: '2026-06-13' });
  assert.equal(t.tool, 'playwright');
  assert.equal(t.auth, 'user');
  assert.equal(t.source, null, 'MCP not yet confirmed at setup time');
  assert.equal(t.provider, null);
  const onDisk = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/testing.json')));
  assert.equal(onDisk.tool, 'playwright');
  assert.equal(onDisk.project_url, 'tests/playwright.config.ts');
  assert.ok(!JSON.stringify(onDisk).includes('token'), 'no token field — references only');
  fs.rmSync(T, { recursive: true, force: true });
});

test('registerTesting: a re-connect preserves the original connectedAt, only lastSyncedAt moves', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-testing3-'));
  registerTesting(T, { tool: 'playwright', today: '2026-06-13' });
  const again = registerTesting(T, { tool: 'cypress', today: '2026-06-20' });
  assert.equal(again.tool, 'cypress', 'tool switched in place');
  assert.equal(again.connectedAt, '2026-06-13', 'first-connect date preserved');
  assert.equal(again.lastSyncedAt, '2026-06-20', 'lastSyncedAt advanced');
  fs.rmSync(T, { recursive: true, force: true });
});

test('registerTesting: an unknown tool falls back to the primary; `none` is artifacts-only', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-testing2-'));
  const bad = registerTesting(T, { tool: 'mocha', today: '2026-06-13' });
  assert.equal(bad.tool, 'playwright', 'unknown tool falls back to the primary adapter');
  const none = registerTesting(T, { tool: 'none', today: '2026-06-13' });
  assert.equal(none.tool, 'none');
  assert.equal(none.source, 'unavailable', 'none => deliberate artifacts-only');
  assert.equal(none.provider, null);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad setup` — registerLearning: record the learning-tool connection (deterministic half).
// DeepTutor is a CLI (no MCP), so `source` stays null until yad-connect-learning detects it on PATH.
// ---------------------------------------------------------------------------------------------
test('registerLearning records a known tool with source unconfirmed (CLI detection is the AI step)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-learning-'));
  const l = registerLearning(T, { tool: 'deeptutor', kb: 'yadflow-istifta', today: '2026-06-14' });
  assert.equal(l.tool, 'deeptutor');
  assert.equal(l.auth, 'user');
  assert.equal(l.source, null, 'CLI not yet confirmed at setup time');
  assert.equal(l.provider, null);
  assert.equal(l.kb, 'yadflow-istifta', 'the kb reference round-trips');
  const onDisk = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/learning.json')));
  assert.equal(onDisk.tool, 'deeptutor');
  assert.equal(onDisk.kb, 'yadflow-istifta');
  assert.ok(!JSON.stringify(onDisk).includes('token'), 'no token field — references only');
  fs.rmSync(T, { recursive: true, force: true });
});

test('registerLearning: a re-connect preserves the original connectedAt, only lastSyncedAt moves', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-learning3-'));
  registerLearning(T, { tool: 'deeptutor', today: '2026-06-14' });
  const again = registerLearning(T, { tool: 'deeptutor', today: '2026-06-20' });
  assert.equal(again.connectedAt, '2026-06-14', 'first-connect date preserved');
  assert.equal(again.lastSyncedAt, '2026-06-20', 'lastSyncedAt advanced');
  fs.rmSync(T, { recursive: true, force: true });
});

test('registerLearning: an unknown tool falls back to the primary; `none` is harness-native', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-learning2-'));
  const bad = registerLearning(T, { tool: 'khanmigo', today: '2026-06-14' });
  assert.equal(bad.tool, 'deeptutor', 'unknown tool falls back to the primary adapter');
  const none = registerLearning(T, { tool: 'none', today: '2026-06-14' });
  assert.equal(none.tool, 'none');
  assert.equal(none.source, 'harness-native', 'none => deliberate harness-native');
  assert.equal(none.provider, null);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// platform.mjs — pure mapping helpers (no network)
// ---------------------------------------------------------------------------------------------
const { detectPlatform, cliFor, hostFromGitUrl, resolveLogin, mapApprovers, rolesForScope, hasAnyRole, reviewersForScopes, resolveCommitterLogin, validateLogin, buildPrArgs } = await import('./platform.mjs');

test('detectPlatform / cliFor', () => {
  assert.equal(detectPlatform('git@github.com:o/r.git'), 'github');
  assert.equal(detectPlatform('https://gitlab.com/o/r.git'), 'gitlab');
  assert.equal(detectPlatform('file:///local'), null);
  assert.equal(cliFor('github'), 'gh');
  assert.equal(cliFor('gitlab'), 'glab');
});

test('hostFromGitUrl parses https, ssh, and scp-like remotes', () => {
  assert.equal(hostFromGitUrl('https://github.com/o/r.git'), 'github.com');
  assert.equal(hostFromGitUrl('https://user@gitlab.zadapps.info/g/r.git'), 'gitlab.zadapps.info');
  assert.equal(hostFromGitUrl('git@gitlab.zadapps.info:group/repo.git'), 'gitlab.zadapps.info');
  assert.equal(hostFromGitUrl('ssh://git@gitlab.example.com:2222/g/r.git'), 'gitlab.example.com');
  assert.equal(hostFromGitUrl('https://GitLab.COM/o/r.git'), 'gitlab.com');
  // Nothing parseable -> null, so the caller falls back to an unscoped check.
  assert.equal(hostFromGitUrl(''), null);
  assert.equal(hostFromGitUrl(null), null);
  assert.equal(hostFromGitUrl('not a url'), null);
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

test('rolesForScope normalizes the per-scope map, the flat array, and the legacy single role', () => {
  assert.deepEqual(rolesForScope({ roles: { hub: ['owner'], backend: ['domain-owner'] } }, 'backend'), ['domain-owner']);
  assert.deepEqual(rolesForScope({ roles: { hub: ['owner'] } }, 'frontend'), []);
  assert.deepEqual(rolesForScope({ roles: ['reviewer'] }, 'hub'), ['reviewer']); // flat array => hub
  assert.deepEqual(rolesForScope({ roles: ['reviewer'] }, 'backend'), []);
  assert.deepEqual(rolesForScope({ role: 'owner' }, 'hub'), ['owner']);          // legacy single role
  assert.deepEqual(rolesForScope({ role: 'owner' }, 'backend'), []);
  assert.deepEqual(rolesForScope(null, 'hub'), []);
});

test('hasAnyRole searches the requested roles across scopes', () => {
  const e = { roles: { hub: ['reviewer'], backend: ['domain-owner'] } };
  assert.equal(hasAnyRole(e, ['hub'], ['owner']), false);
  assert.equal(hasAnyRole(e, ['hub', 'backend'], ['domain-owner']), true);
  assert.equal(hasAnyRole(e, ['frontend'], ['reviewer']), false);
});

test('resolveLogin reads per-scope roles (owner+reviewer+domain-owner at once)', () => {
  const roster = [{ login: 'ca', name: 'carol', roles: { hub: ['owner', 'reviewer'], backend: ['domain-owner'] } }];
  const recs = resolveLogin('ca', roster, [], ['backend']);
  assert.deepEqual(recs.map((r) => r.role).sort(), ['domain-owner', 'owner', 'reviewer']);
  assert.equal(recs.find((r) => r.role === 'domain-owner').domain, 'backend');
  // a domain not touched contributes no domain-owner record
  assert.ok(!resolveLogin('ca', roster, [], []).some((r) => r.role === 'domain-owner'));
  // an entry scoped only to backend contributes nothing to an untouched scope
  const scoped = [{ login: 'dv', name: 'dave', roles: { backend: ['domain-owner'] } }];
  assert.deepEqual(resolveLogin('dv', scoped, [], []), []);
});

test('resolveLogin keeps the legacy repos.json domain_owner fallback', () => {
  const roster = [{ login: 'ca', name: 'carol', role: 'reviewer' }];
  const recs = resolveLogin('ca', roster, [{ name: 'backend', domain_owner: 'carol' }], ['backend']);
  assert.deepEqual(recs.map((r) => r.role).sort(), ['domain-owner', 'reviewer']);
});

test('reviewersForScopes picks reviewers + domain-owners and excludes the committer', () => {
  const roster = [
    { login: 'al', name: 'alice', roles: { hub: ['owner'] } },              // owner-only => not requested
    { login: 'bo', name: 'bob', roles: { hub: ['reviewer'] } },
    { login: 'ca', name: 'carol', roles: { hub: ['reviewer'], backend: ['domain-owner'] } },
    { login: 'dv', name: 'dave', roles: { backend: ['domain-owner'] } },
  ];
  assert.deepEqual(reviewersForScopes(roster, ['hub'], {}).sort(), ['bo', 'ca']);
  assert.deepEqual(reviewersForScopes(roster, ['hub', 'backend'], { excludeLogin: 'bo' }).sort(), ['ca', 'dv']);
});

test('resolveCommitterLogin maps git identity through the roster', () => {
  const { backend } = scaffold();
  git(backend, 'config', 'user.email', 'a@b.c');
  git(backend, 'config', 'user.name', 'x');
  const roster = [{ login: 'xx', name: 'x', email: 'a@b.c' }, { login: 'yy', name: 'y' }];
  assert.equal(resolveCommitterLogin(backend, roster), 'xx');           // by email
  assert.equal(resolveCommitterLogin(backend, [{ login: 'zz', name: 'x' }]), 'zz'); // by name
  assert.equal(resolveCommitterLogin(backend, [{ login: 'no', name: 'other' }]), null);
});

test('validateLogin returns checked:false when the platform CLI is unknown', () => {
  assert.deepEqual(validateLogin(null, 'someone'), { ok: false, exists: false, checked: false });
  assert.deepEqual(validateLogin('github', ''), { ok: false, exists: false, checked: false });
});

test('buildPrArgs wires reviewers + assignees for gh and glab', () => {
  const gh = buildPrArgs('github', { title: 't', body: 'b', base: 'main', head: 'feat', reviewers: ['bo', 'ca'], assignees: ['al'], labels: ['domain:backend'] });
  assert.ok(gh.includes('--reviewer') && gh[gh.indexOf('--reviewer') + 1] === 'bo,ca');
  assert.ok(gh.includes('--assignee') && gh[gh.indexOf('--assignee') + 1] === 'al');
  assert.ok(gh.includes('--label') && gh[gh.indexOf('--label') + 1] === 'domain:backend');
  // gh self-assigns @me when no assignee resolved
  assert.equal(buildPrArgs('github', { title: 't', body: 'b', base: 'main', head: 'f' }).at(-1), '@me');
  const gl = buildPrArgs('gitlab', { title: 't', body: 'b', base: 'main', head: 'feat', reviewers: ['bo'], assignees: ['al'] });
  assert.ok(gl.includes('--reviewer') && gl[gl.indexOf('--reviewer') + 1] === 'bo');
  assert.ok(gl.includes('--assignee') && gl[gl.indexOf('--assignee') + 1] === 'al');
  // glab omits --assignee entirely when none given (no @me concept)
  assert.ok(!buildPrArgs('gitlab', { title: 't', body: 'b', base: 'main', head: 'f' }).includes('--assignee'));
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
const { parseReviewBranch, artifactFromBase, artifactPaths, upsertHubPr, contractSurfaceHash, artifactBase, advanceState, markInReview } = await import('./epic-state.mjs');
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

test('test-cases.md is a single-file artifact: base, reverse and paths use the default branch', () => {
  // The single-file decision — test-cases.md must NOT need the folder-special handling stories/ does.
  assert.equal(artifactBase('test-cases.md'), 'test-cases');
  assert.equal(artifactFromBase('test-cases'), 'test-cases.md');
  assert.deepEqual(artifactPaths('test-cases'), ['test-cases.md']);
});

test('advanceState: approving stories-review opens test-cases AND makes the epic ready-for-build (parallel)', () => {
  const state = {
    epicId: 'EP-x', currentStep: 'stories-review',
    steps: [
      { id: 'stories-review', type: 'review+approve', artifact: 'stories/', status: 'in_review' },
      { id: 'test-cases', type: 'author', artifact: 'test-cases.md', status: 'blocked' },
      { id: 'test-cases-review', type: 'review+approve', artifact: 'test-cases.md', status: 'blocked' },
    ],
  };
  advanceState(state, state.steps[0]);
  // the build half keys off ready-for-build, so implementation can start immediately …
  assert.equal(state.currentStep, 'ready-for-build', 'stories-review => ready-for-build (build unblocked)');
  // … while the tester works the parallel test-cases track
  assert.equal(state.steps[1].status, 'in_progress', 'test-cases opens in parallel');
});

test('advanceState: completing the parallel test-cases-review keeps the epic at ready-for-build', () => {
  const state = {
    epicId: 'EP-x', currentStep: 'ready-for-build',
    steps: [
      { id: 'stories-review', type: 'review+approve', artifact: 'stories/', status: 'done' },
      { id: 'test-cases', type: 'author', artifact: 'test-cases.md', status: 'done' },
      { id: 'test-cases-review', type: 'review+approve', artifact: 'test-cases.md', status: 'in_review' },
    ],
  };
  advanceState(state, state.steps[2]);
  assert.equal(state.steps[2].status, 'done');
  assert.equal(state.currentStep, 'ready-for-build', 'the parallel track never regresses currentStep');
});

test('markInReview: the parallel test-cases-review does not pull currentStep back from ready-for-build', () => {
  const state = {
    epicId: 'EP-x', currentStep: 'ready-for-build',
    steps: [
      { id: 'test-cases-review', type: 'review+approve', artifact: 'test-cases.md', status: 'blocked' },
    ],
  };
  markInReview(state, state.steps[0]);
  assert.equal(state.steps[0].status, 'in_review', 'the step still goes in_review');
  assert.equal(state.currentStep, 'ready-for-build', 'currentStep stays at ready-for-build (build keeps running)');
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
const { verifiedAuthorEmails } = await import('./plan.mjs');

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

// ---- yad doctor + structured error codes ---------------------------------------------------------
const { runDoctor } = await import('./doctor.mjs');
const { YadError } = await import('./errors.mjs');
const { readJSONStrict } = await import('./lib.mjs');

// runDoctor sets process.exitCode on failure — capture and restore so a failing-doctor test
// does not fail the whole suite run.
async function doctorOn(T) {
  const before = process.exitCode;
  try {
    return await runDoctor(T, { json: true });
  } finally {
    process.exitCode = before;
  }
}

test('doctor: healthy project has no failures (warnings allowed)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  const r = await doctorOn(T);
  assert.equal(r.failed, 0, JSON.stringify(r.checks.filter((x) => x.status === 'fail')));
  assert.ok(r.checks.some((x) => x.id === 'repo:backend' && x.status === 'ok'), 'backend repo healthy');
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: untagged GitLab fragment warns with YAD-CI-001; tagged is silent', async () => {
  const { T } = scaffold();
  const repos = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/repos.json'), 'utf8'));
  repos.repos[0].platform = 'gitlab';
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify(repos));
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge_enabled: true, roster: [] }));
  await reconcile(T, { fix: true });

  // Freshly wired fragments carry tags: no YAD-CI-001.
  let r = await doctorOn(T);
  assert.ok(!r.checks.some((x) => /YAD-CI-001/.test(x.message)), 'tagged fragments must not warn');

  // Strip the tags line from the repo fragment (an old install / hand-reverted sync) -> warn.
  const frag = path.join(T, 'demo/backend/.gitlab/ci/yad-checks.yml');
  fs.writeFileSync(frag, fs.readFileSync(frag, 'utf8').replace(/^\s*tags: \[\$YAD_RUNNER_TAGS\]\n/m, ''));
  r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'ci-tags:backend' && x.status === 'warn' && /YAD-CI-001/.test(x.message)), 'untagged repo fragment must warn');
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: corrupt repos.json fails with YAD-STATE-001', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), '{ corrupt');
  const r = await doctorOn(T);
  assert.ok(!r.ok);
  assert.ok(r.checks.some((x) => x.status === 'fail' && /YAD-STATE-001/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: registered repo path gone fails with YAD-STATE-003', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.rmSync(path.join(T, 'demo/backend'), { recursive: true, force: true });
  const r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'repo:backend' && x.status === 'fail' && /YAD-STATE-003/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: corrupt epic ledger fails with its code; missing state.json only warns', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.mkdirSync(path.join(T, 'epics/EP-bad/.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-bad/.sdlc/state.json'), 'not json');
  fs.mkdirSync(path.join(T, 'epics/EP-unseeded'), { recursive: true });
  const r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'epic:EP-bad' && x.status === 'fail' && /YAD-STATE-001/.test(x.message)));
  assert.ok(r.checks.some((x) => x.id === 'epic:EP-unseeded' && x.status === 'warn'));
  fs.rmSync(T, { recursive: true, force: true });
});

test('errors: readJSONStrict throws a YadError with code + hint on corrupt JSON', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-err-'));
  const p = path.join(T, 'x.json');
  fs.writeFileSync(p, '{ nope');
  try {
    readJSONStrict(p);
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof YadError);
    assert.equal(e.code, 'YAD-STATE-001');
    assert.ok(e.hint, 'carries a recovery hint');
  }
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: non-array hub.roster fails (matches the gate shape check)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', roster: 'oops' }));
  const r = await doctorOn(T);
  assert.ok(!r.ok);
  assert.ok(r.checks.some((x) => x.id === 'hub' && x.status === 'fail' && /roster/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: repo entry with no path fails (no silent fallback to project root)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'ghost' }] }));
  const r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'repo:ghost' && x.status === 'fail' && /no `path`/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: design.json with a known tool + confirmed MCP is ok; unknown tool fails YAD-CFG-002', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  // confirmed connection
  fs.writeFileSync(path.join(T, '.sdlc/design.json'), JSON.stringify({ tool: 'figma', source: 'figma-mcp' }));
  let r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'design' && x.status === 'ok' && /figma/.test(x.message)));
  // none => markdown-only, still ok
  fs.writeFileSync(path.join(T, '.sdlc/design.json'), JSON.stringify({ tool: 'none', source: 'unavailable' }));
  r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'design' && x.status === 'ok' && /markdown-only/.test(x.message)));
  // unknown tool => fail with the structured code
  fs.writeFileSync(path.join(T, '.sdlc/design.json'), JSON.stringify({ tool: 'sketch' }));
  r = await doctorOn(T);
  assert.ok(!r.ok);
  assert.ok(r.checks.some((x) => x.id === 'design' && x.status === 'fail' && /YAD-CFG-002/.test(x.message)));
  // missing tool (schema makes it mandatory) => fail, not silently treated as markdown-only
  fs.writeFileSync(path.join(T, '.sdlc/design.json'), JSON.stringify({ source: 'unavailable' }));
  r = await doctorOn(T);
  assert.ok(!r.ok);
  assert.ok(r.checks.some((x) => x.id === 'design' && x.status === 'fail' && /YAD-CFG-002/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: design.json recorded but MCP unconfirmed warns (points at yad-connect-design)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.writeFileSync(path.join(T, '.sdlc/design.json'), JSON.stringify({ tool: 'figma', source: null }));
  const r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'design' && x.status === 'warn' && /not confirmed/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: absent design.json is silent (markdown-only is the normal default)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  const r = await doctorOn(T);
  assert.ok(!r.checks.some((x) => x.id === 'design'), 'no design check emitted when the file is absent');
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: testing.json with a known tool + confirmed MCP is ok; unknown tool fails YAD-CFG-003', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  // confirmed connection
  fs.writeFileSync(path.join(T, '.sdlc/testing.json'), JSON.stringify({ tool: 'playwright', source: 'playwright-mcp' }));
  let r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'testing' && x.status === 'ok' && /playwright/.test(x.message)));
  // none => artifacts-only, still ok
  fs.writeFileSync(path.join(T, '.sdlc/testing.json'), JSON.stringify({ tool: 'none', source: 'unavailable' }));
  r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'testing' && x.status === 'ok' && /artifacts-only/.test(x.message)));
  // unknown tool => fail with the structured code
  fs.writeFileSync(path.join(T, '.sdlc/testing.json'), JSON.stringify({ tool: 'mocha' }));
  r = await doctorOn(T);
  assert.ok(!r.ok);
  assert.ok(r.checks.some((x) => x.id === 'testing' && x.status === 'fail' && /YAD-CFG-003/.test(x.message)));
  // missing tool (schema makes it mandatory) => fail, not silently treated as artifacts-only
  fs.writeFileSync(path.join(T, '.sdlc/testing.json'), JSON.stringify({ source: 'unavailable' }));
  r = await doctorOn(T);
  assert.ok(!r.ok);
  assert.ok(r.checks.some((x) => x.id === 'testing' && x.status === 'fail' && /YAD-CFG-003/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: testing.json recorded but MCP unconfirmed warns (points at yad-connect-testing)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.writeFileSync(path.join(T, '.sdlc/testing.json'), JSON.stringify({ tool: 'playwright', source: null }));
  const r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'testing' && x.status === 'warn' && /not confirmed/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: absent testing.json is silent (artifacts-only is the normal default)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  const r = await doctorOn(T);
  assert.ok(!r.checks.some((x) => x.id === 'testing'), 'no testing check emitted when the file is absent');
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: learning.json with a known tool + confirmed CLI is ok; unknown tool fails YAD-CFG-004', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  // confirmed connection
  fs.writeFileSync(path.join(T, '.sdlc/learning.json'), JSON.stringify({ tool: 'deeptutor', source: 'deeptutor-cli' }));
  let r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'learning' && x.status === 'ok' && /deeptutor/.test(x.message)));
  // none => harness-native, still ok
  fs.writeFileSync(path.join(T, '.sdlc/learning.json'), JSON.stringify({ tool: 'none', source: 'harness-native' }));
  r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'learning' && x.status === 'ok' && /harness-native/.test(x.message)));
  // unknown tool => fail with the structured code
  fs.writeFileSync(path.join(T, '.sdlc/learning.json'), JSON.stringify({ tool: 'khanmigo' }));
  r = await doctorOn(T);
  assert.ok(!r.ok);
  assert.ok(r.checks.some((x) => x.id === 'learning' && x.status === 'fail' && /YAD-CFG-004/.test(x.message)));
  // missing tool (schema makes it mandatory) => fail, not silently treated as harness-native
  fs.writeFileSync(path.join(T, '.sdlc/learning.json'), JSON.stringify({ source: 'harness-native' }));
  r = await doctorOn(T);
  assert.ok(!r.ok);
  assert.ok(r.checks.some((x) => x.id === 'learning' && x.status === 'fail' && /YAD-CFG-004/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: learning.json recorded but CLI unconfirmed warns (points at yad-connect-learning)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.writeFileSync(path.join(T, '.sdlc/learning.json'), JSON.stringify({ tool: 'deeptutor', source: null }));
  const r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'learning' && x.status === 'warn' && /not confirmed/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: learning.json with source harness-native warns (CLI absent, yad-learn still tutors)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.writeFileSync(path.join(T, '.sdlc/learning.json'), JSON.stringify({ tool: 'deeptutor', source: 'harness-native' }));
  const r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'learning' && x.status === 'warn' && /harness-native/.test(x.message)));
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: absent learning.json is silent (harness-native is the normal default)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  const r = await doctorOn(T);
  assert.ok(!r.checks.some((x) => x.id === 'learning'), 'no learning check emitted when the file is absent');
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate loadHub: an existing hub.json holding literal null is rejected (not treated as absent)', async () => {
  const { T, ep } = scaffoldEpic();
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), 'null');
  await assert.rejects(
    gateSync(T, { epic: 'EP-test', today: '2026-06-13' }),
    (e) => e.code === 'YAD-STATE-002' && /contains `null`/.test(e.message),
  );
  assert.ok(ep);
  fs.rmSync(T, { recursive: true, force: true });
});

// ---- docs (interactive documentation sites) -----------------------------------------------------
const {
  deployTargetFromHub, siteBasePath, siteDir, manifestPath,
  docsArtifactHash, docsArtifactFiles, docsStale, pagesWorkflow, pagesWorkflowPath,
} = await import('./docs.mjs');

test('deployTargetFromHub maps platform (and git_url) to a Pages target', () => {
  assert.equal(deployTargetFromHub({ platform: 'github' }), 'github-pages');
  assert.equal(deployTargetFromHub({ platform: 'gitlab' }), 'gitlab-pages');
  assert.equal(deployTargetFromHub({ platform: null }), 'none');
  assert.equal(deployTargetFromHub({ git_url: 'git@gitlab.com:o/r.git' }), 'gitlab-pages');
  assert.equal(deployTargetFromHub({}), 'none');
});

test('siteBasePath nests per-epic under the project base; the overview SPA mounts under app/', () => {
  // the overview SPA sits under <base>/app/ so the hand-maintained report.html can own the root
  assert.equal(siteBasePath({ basePath: '/yadflow/' }, { overview: true }), '/yadflow/app/');
  assert.equal(siteBasePath({ basePath: '/yadflow/' }, { epic: 'EP-foo' }), '/yadflow/epics/EP-foo/');
  assert.equal(siteBasePath({ basePath: '/' }, { epic: 'EP-foo' }), '/epics/EP-foo/');
  assert.equal(siteBasePath({}, { overview: true }), '/app/');
  // a basePath WITHOUT a trailing slash must not double-slash or drop the join
  assert.equal(siteBasePath({ basePath: '/foo' }, { epic: 'EP-x' }), '/foo/epics/EP-x/');
  assert.equal(siteBasePath({ basePath: '/foo' }, { overview: true }), '/foo/app/');
});

test('siteDir / manifestPath resolve per-epic vs overview locations', () => {
  assert.match(siteDir('/r', { epic: 'EP-x' }), /epics\/EP-x\/docs-site$/);
  assert.match(siteDir('/r', { overview: true }), /docs\/sdlc-site$/);
  assert.match(manifestPath('/r', { epic: 'EP-x' }), /epics\/EP-x\/\.sdlc\/docs-build\.json$/);
  assert.match(manifestPath('/r', { overview: true }), /docs\/sdlc-site\/\.docs-build\.json$/);
});

test('docsArtifactHash is deterministic, order-independent, and changes on edit', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-test-'));
  fs.writeFileSync(path.join(T, 'a.md'), 'alpha');
  fs.writeFileSync(path.join(T, 'b.md'), 'beta');
  const a = path.join(T, 'a.md'), b = path.join(T, 'b.md');
  const h1 = docsArtifactHash([a, b]);
  const h2 = docsArtifactHash([b, a]);           // order must not matter (sorted internally)
  assert.equal(h1, h2);
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
  fs.writeFileSync(b, 'beta!');                   // an edit must move the hash
  assert.notEqual(docsArtifactHash([a, b]), h1);
  // the contract-surface `extra` is folded in: a surface change moves the hash; empty extra is a no-op
  assert.notEqual(docsArtifactHash([a], 'sha256:surface-1'), docsArtifactHash([a], 'sha256:surface-2'));
  assert.equal(docsArtifactHash([a]), docsArtifactHash([a], ''));
  fs.rmSync(T, { recursive: true, force: true });
});

test('docsArtifactFiles collects existing epic artifacts + stories, sorted', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-test-'));
  const epicRoot = path.join(T, 'epics/EP-x');
  fs.mkdirSync(path.join(epicRoot, 'stories'), { recursive: true });
  fs.writeFileSync(path.join(epicRoot, 'epic.md'), '#');
  fs.writeFileSync(path.join(epicRoot, 'architecture.md'), '#');
  fs.writeFileSync(path.join(epicRoot, 'stories/EP-x-S01.md'), '#');
  const files = docsArtifactFiles(T, 'EP-x');
  assert.ok(files.some((f) => f.endsWith('epic.md')));
  assert.ok(files.some((f) => f.endsWith('EP-x-S01.md')));
  assert.ok(!files.some((f) => f.endsWith('contract.md')), 'absent files are not included');
  fs.rmSync(T, { recursive: true, force: true });
});

test('docsStale flags never-built, changed artifacts, advanced HEADs, and shell upgrades', () => {
  assert.deepEqual(docsStale(null, {}), { stale: true, reasons: ['never built'] });
  const m = { artifactHash: 'sha256:aaa', repoHeads: { backend: 'h1' }, templateVersion: '1.0.0' };
  assert.equal(docsStale(m, { artifactHash: 'sha256:aaa', repoHeads: { backend: 'h1' }, templateVersion: '1.0.0' }).stale, false);
  assert.ok(docsStale(m, { artifactHash: 'sha256:bbb' }).reasons.some((r) => /artifacts changed/.test(r)));
  assert.ok(docsStale(m, { repoHeads: { backend: 'h2' } }).reasons.some((r) => /backend HEAD advanced/.test(r)));
  assert.ok(docsStale(m, { templateVersion: '2.0.0' }).reasons.some((r) => /shell upgraded/.test(r)));
});

test('pagesWorkflow emits a valid github vs gitlab Pages job, yad-managed + loop-safe', () => {
  const gh = pagesWorkflow('github');
  assert.match(gh, /deploy-pages@v4/);
  assert.match(gh, /concurrency:/);                 // deploy-loop guard
  assert.match(gh, /# yad-managed/);
  // both the overview AND per-epic sites are assembled into ./public (epics nested under epics/<id>/)
  assert.match(gh, /docs\/sdlc-site/);
  assert.match(gh, /epics\/\*\/docs-site/);
  assert.match(gh, /public\/epics\/\$id/);
  assert.match(gh, /path: public/);
  // the overview SPA mounts under public/app and the report.html owns the root (index.html + report.html)
  assert.match(gh, /public\/app/);
  assert.match(gh, /report\.html public\/index\.html/);
  assert.equal(pagesWorkflowPath('github'), '.github/workflows/yad-docs.yml');
  const gl = pagesWorkflow('gitlab');
  assert.match(gl, /^pages:/m);
  assert.match(gl, /artifacts:/);
  assert.match(gl, /epics\/\*\/docs-site/);         // GitLab publishes per-epic sites too
  assert.equal(pagesWorkflowPath('gitlab'), '.gitlab/ci/yad-docs.yml');
});

test('runDocs: list/sync/wire orchestrate over generated sites and install the Pages CI', async () => {
  const { runDocs } = await import('./docs.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-run-'));
  // a connected github-pages target + one generated epic site with artifacts and a manifest
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/docs.json'), JSON.stringify({ target: 'github-pages', scope: 'hub', basePath: '/yadflow/', source: 'gh' }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [] }));
  const ep = path.join(T, 'epics/EP-x');
  fs.mkdirSync(path.join(ep, '.sdlc'), { recursive: true });
  fs.mkdirSync(path.join(ep, 'docs-site'), { recursive: true });
  fs.writeFileSync(path.join(ep, 'epic.md'), '# epic');
  fs.writeFileSync(path.join(ep, '.sdlc/state.json'), JSON.stringify({ repos: [] }));
  fs.writeFileSync(path.join(ep, '.sdlc/docs-build.json'), JSON.stringify({ artifactHash: 'sha256:old' })); // mismatch -> stale

  const listed = await runDocs(T, { action: 'list' });
  assert.equal(listed.sites, 1);

  const checked = await runDocs(T, { action: 'sync', sync: 'check' });
  assert.equal(checked.stale, 1, 'the changed artifact hash marks the epic site stale');

  const wired = await runDocs(T, { action: 'sync', sync: 'wire' });
  assert.equal(wired.wired, '.github/workflows/yad-docs.yml');
  assert.ok(fs.existsSync(path.join(T, '.github/workflows/yad-docs.yml')), 'Pages workflow written');

  // build degrades (does not throw) when a targeted site has not been generated yet
  const builtMissing = await runDocs(T, { action: 'build', epic: 'EP-nope' });
  assert.equal(builtMissing.built, 0, 'build of a non-generated site yields nothing, no throw');

  const before = process.exitCode;
  await runDocs(T, { action: 'bogus' });
  assert.equal(process.exitCode, 1, 'an unknown action sets a failing exit code');
  process.exitCode = before;
  fs.rmSync(T, { recursive: true, force: true });
});
