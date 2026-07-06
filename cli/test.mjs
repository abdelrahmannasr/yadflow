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

// A brand-NEW first-party skill rides `yad update`: moduleActions labels a not-yet-installed skill
// `new` (not `missing`) so the scope=changed filter keeps it, while _bmad module files / repo+hub
// wiring stay `missing` and remain excluded from update (no one-time setup on update).
const { moduleActions } = await import('./plan.mjs');
test('moduleActions: a not-yet-installed skill is status "new"; _bmad files stay "missing"', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-newskill-'));
  const acts = moduleActions(T, ['.claude']);
  const skills = acts.filter((a) => a.scope === '.claude');
  const bmad = acts.filter((a) => a.scope === '_bmad');
  assert.ok(skills.length && skills.every((a) => a.status === 'new'), 'every uninstalled skill is "new"');
  assert.ok(bmad.length && bmad.every((a) => a.status === 'missing'), '_bmad files stay "missing"');
  fs.rmSync(T, { recursive: true, force: true });
});

test('update (scope=changed) installs a brand-new skill but NOT a missing wiring file', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true }); // full install
  // Simulate a release that adds a new skill (delete one → it reads as "new") AND a dropped wiring file.
  fs.rmSync(path.join(T, '.claude/skills/yad-review-companion'), { recursive: true, force: true });
  fs.rmSync(path.join(T, 'demo/backend/.github/workflows/yad-checks.yml')); // repo wiring → stays "missing"
  const r = await reconcile(T, { fix: true, scope: 'changed' });
  assert.ok(fs.existsSync(path.join(T, '.claude/skills/yad-review-companion/SKILL.md')), 'new skill installed by update');
  assert.ok(!fs.existsSync(path.join(T, 'demo/backend/.github/workflows/yad-checks.yml')), 'missing wiring NOT installed by update');
  assert.ok(r.counts.new >= 1, 'counted as new');
  fs.rmSync(T, { recursive: true, force: true });
});

// `yad setup` now migrates a pre-2.0 install too (project IDE targets + the opt-in global
// ~/.claude/skills pass). Both reuse legacyModuleActions; the global pass calls it as
// legacyModuleActions(os.homedir(), ['.claude']) so an old skill at <root>/.claude/skills/<old>
// is removed and its yad-* rename installed. This drives that helper directly (the same way
// setup's applyActions does) to avoid the interactive runSetup prompts.
const { legacyModuleActions, removedModuleActions } = await import('./plan.mjs');
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

// A skill removed in a later release (REMOVED_SKILLS) must be PURGED from existing installs —
// setup/update only refresh current skills, so without this a breaking removal lingers. Covers
// both the folder IDEs (whole skill dir) and opencode's flat <name>.md command, and the legacy
// alias the skill shipped under (sdlc-review-comments) so a pre-2.0 leftover is purged too.
test('setup purge: removedModuleActions deletes lingering yad-review-comments installs', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-setup-removed-'));
  fs.mkdirSync(path.join(T, '.claude/skills/yad-review-comments'), { recursive: true });
  fs.writeFileSync(path.join(T, '.claude/skills/yad-review-comments/SKILL.md'), '---\nname: yad-review-comments\n---\n');
  fs.mkdirSync(path.join(T, '.claude/skills/sdlc-review-comments'), { recursive: true });
  fs.writeFileSync(path.join(T, '.claude/skills/sdlc-review-comments/SKILL.md'), '---\nname: sdlc-review-comments\n---\n');
  fs.mkdirSync(path.join(T, '.opencode/commands'), { recursive: true });
  fs.writeFileSync(path.join(T, '.opencode/commands/yad-review-comments.md'), '# yad-review-comments\n');

  const actions = removedModuleActions(T, ['.claude', '.opencode']);
  assert.equal(actions.length, 3, 'one action per lingering install (yad + alias folder + opencode cmd)');
  assert.ok(actions.every((a) => a.status === 'removed'), 'all are removal actions');
  for (const a of actions) a.apply();

  assert.ok(!fs.existsSync(path.join(T, '.claude/skills/yad-review-comments')), 'folder install purged');
  assert.ok(!fs.existsSync(path.join(T, '.claude/skills/sdlc-review-comments')), 'legacy alias purged');
  assert.ok(!fs.existsSync(path.join(T, '.opencode/commands/yad-review-comments.md')), 'opencode command purged');

  // Idempotent: a clean tree yields no further removal actions.
  assert.equal(removedModuleActions(T, ['.claude', '.opencode']).length, 0, 'purge is idempotent');
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

// `glab api` has NO built-in --jq flag (unlike `gh api`); passing it errors "unknown flag: --jq"
// and the swallowed error surfaces as "could not resolve merged MR IID" (issue #108). glab output
// must be filtered by piping to a real jq. `gh api --jq` is fine, so scope this to glab lines only.
test('gitlab fragments never pass --jq to glab api (glab has no such flag)', () => {
  // Discover every GitLab CI template dynamically so a new one can't slip through unscanned.
  const walk = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const full = path.join(dir, e.name);
          return e.isDirectory() ? walk(full) : [full];
        })
      : [];
  const templates = walk(path.join(ROOT, 'skills'))
    .filter((f) => f.includes(`${path.sep}templates${path.sep}gitlab${path.sep}`) && f.endsWith('.yml'))
    .map((f) => path.relative(ROOT, f))
    .sort();
  assert.ok(templates.length > 0, 'expected to discover GitLab CI templates under skills/');
  for (const rel of templates) {
    const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const offenders = txt
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .filter((l) => l.includes('glab api') && l.includes('--jq'));
    assert.equal(offenders.length, 0, `${rel}: glab api does not support --jq; pipe to jq instead:\n${offenders.join('\n')}`);
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
// detectStage / templateBody — stage-aware open-pr (fix #80)
// ---------------------------------------------------------------------------------------------
const { detectStage, templateBody } = await import('./openpr.mjs');
const { fillHubTemplate } = await import('./gate.mjs');

// A bare dir that IS a hub (carries .sdlc/hub.json) vs one that is not.
function hubDir() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-stage-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github' }));
  return T;
}

test('detectStage: code-repo when the root is not a hub, or the target repo is a sub-repo', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-stage-')); // no hub.json
  assert.equal(detectStage(plain, plain, 'feat/EP-x-S01-T01'), 'code-repo');
  const T = hubDir();
  // --repo resolves repoRoot to a sub-dir of the hub => a connected code repo, never the hub
  assert.equal(detectStage(T, path.join(T, 'demo/backend'), 'feat/EP-x-S01-T01'), 'code-repo');
  // a registry entry (meta truthy) is always a code repo — even if its path resolves to the hub root
  assert.equal(detectStage(T, T, 'review/EP-demo/architecture', { name: 'oddly-registered' }), 'code-repo');
  fs.rmSync(plain, { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

test('detectStage: on the hub, a review/EP-* head is hub-front, anything else is hub-tooling', () => {
  const T = hubDir();
  assert.equal(detectStage(T, T, 'review/EP-demo/architecture'), 'hub-front');
  assert.equal(detectStage(T, T, 'review/EP-demo/stories-S01'), 'hub-front');
  assert.equal(detectStage(T, T, 'ci/some-fix'), 'hub-tooling');
  assert.equal(detectStage(T, T, 'review/not-an-epic/x'), 'hub-tooling'); // must be review/EP-*
  // path.resolve normalises a trailing-slash / "." repoRoot to the same hub
  assert.equal(detectStage(T, T + path.sep, 'ci/x'), 'hub-tooling');
  fs.rmSync(T, { recursive: true, force: true });
});

test('templateBody: hub-tooling emits the code-task shape (fixes #80) and fills the risk', () => {
  const T = hubDir();
  const b = templateBody(T, 'github', { task: 'EP-x-S01-T01', risk: 'low', contract: false, domains: 'hub', stage: 'hub-tooling' });
  assert.match(b, /## Summary/);
  assert.match(b, /## Checklist/);
  assert.match(b, /\*\*Risk level:\*\* low/);
  // it must NOT carry the artifact-review markers the hub's own template has
  assert.doesNotMatch(b, /## Artifact under review/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('templateBody: the hub-tooling body passes the real pr-template hub gate on a tooling head (#80 regression)', () => {
  const T = hubDir();
  const b = templateBody(T, 'github', { risk: 'low', stage: 'hub-tooling' });
  const bodyFile = path.join(T, 'pr-body.md');
  fs.writeFileSync(bodyFile, b);
  const gate = path.join(ROOT, 'skills/yad-pr-template/templates/checks/pr-template.sh');
  // before the fix this body was the artifact-review template and the gate FAILED it.
  const code = (() => {
    try { execFileSync('bash', [gate, '--profile', 'hub', '--head', 'ci/some-fix', bodyFile], { stdio: 'pipe' }); return 0; }
    catch (e) { return e.status; }
  })();
  assert.equal(code, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

test('fillHubTemplate: the generated review-PR body carries every section the hub gate requires (#103)', () => {
  const b = fillHubTemplate({
    epic: 'EP-demo', artifact: 'architecture.md',
    step: { id: 'architecture-review', risk_tags: ['contract'] },
    owner: 'alice', domains: ['backend', 'mobile'],
  });
  // check_hub_body requires all four; `## Checklist` was the one missing before the fix.
  assert.match(b, /^## Artifact under review$/m);
  assert.match(b, /^## Impact & Risk \(front-half\)$/m);
  assert.match(b, /^## Checklist$/m);
  assert.match(b, /Risk tags:/);
});

test('fillHubTemplate: the generated body passes the real pr-template hub gate (#103 regression)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hubbody-'));
  const b = fillHubTemplate({
    epic: 'EP-demo', artifact: 'architecture.md',
    step: { id: 'architecture-review', risk_tags: [] },
    owner: 'alice', domains: ['backend'],
  });
  const bodyFile = path.join(T, 'pr-body.md');
  fs.writeFileSync(bodyFile, b);
  const gate = path.join(ROOT, 'skills/yad-pr-template/templates/checks/pr-template.sh');
  // before the fix the generated body omitted `## Checklist` and the gate FAILED it on a review/EP-* head.
  const code = (() => {
    try { execFileSync('bash', [gate, '--profile', 'hub', '--head', 'review/EP-demo/architecture', bodyFile], { stdio: 'pipe' }); return 0; }
    catch (e) { return e.status; }
  })();
  assert.equal(code, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

test('templateBody: code-repo / hub-front stages read the repo\'s own committed template', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-stage-'));
  fs.mkdirSync(path.join(T, '.github'), { recursive: true });
  fs.writeFileSync(path.join(T, '.github/pull_request_template.md'), '## Summary\n- **Risk level:** medium\n');
  // a non-hub-tooling stage uses the committed repo template (here a marker we can detect)
  const b = templateBody(T, 'github', { risk: 'high', stage: 'code-repo' });
  assert.match(b, /\*\*Risk level:\*\* high/); // the committed template's value is overwritten
  fs.rmSync(T, { recursive: true, force: true });
});

test('templateBody: hub-tooling on gitlab uses the bundled MR template, not the repo file', () => {
  const T = hubDir(); // its .github file would be artifact-review; gitlab must pull the packaged one
  const b = templateBody(T, 'gitlab', { risk: 'low', stage: 'hub-tooling' });
  assert.match(b, /## Summary/);
  assert.match(b, /## Checklist/);
  assert.match(b, /\*\*Risk level:\*\* low/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('templateBody: fills the Spec dir from the task and the Summary from the commit (stale-placeholder fix)', () => {
  const T = hubDir(); // hub-tooling loads the real bundled template (carries the Spec + Summary placeholders)
  const b = templateBody(T, 'github', {
    task: 'EP-resident-portal-v1-S06-T08', summary: 'Add the thing', risk: 'low', stage: 'hub-tooling',
  });
  // Story/task line is the task; the Spec line is the STORY dir (task minus its -T0N suffix), not the placeholder
  assert.match(b, /- Story \/ task: `EP-resident-portal-v1-S06-T08`/);
  assert.match(b, /- Spec: `specs\/EP-resident-portal-v1-S06\/`/);
  assert.doesNotMatch(b, /specs\/EP-<slug>-S0N\//); // the default placeholder is gone
  // Summary carries the real text and the guidance comment is replaced
  assert.match(b, /## Summary\nAdd the thing/);
  assert.doesNotMatch(b, /What this PR does/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('templateBody: a `$` in the summary is inserted verbatim, not read as a $1/$& replacement token', () => {
  const T = hubDir();
  const b = templateBody(T, 'github', { summary: 'use $1 as the fallback and $& too', risk: 'low', stage: 'hub-tooling' });
  assert.match(b, /## Summary\nuse \$1 as the fallback and \$& too\n/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('templateBody: a CRLF-checked-out template still gets its Summary filled (Windows autocrlf)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-stage-'));
  fs.mkdirSync(path.join(T, '.github'), { recursive: true });
  fs.writeFileSync(path.join(T, '.github/pull_request_template.md'),
    '## Summary\r\n<!-- What this PR does. -->\r\n\r\n- **Risk level:** low\r\n');
  const b = templateBody(T, 'github', { summary: 'Wire the thing', risk: 'low', stage: 'code-repo' });
  assert.match(b, /## Summary\r?\nWire the thing/);
  assert.doesNotMatch(b, /What this PR does/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('templateBody: without a task/summary the Spec + Summary placeholders degrade in place', () => {
  const T = hubDir();
  const b = templateBody(T, 'github', { risk: 'low', stage: 'hub-tooling' });
  assert.match(b, /specs\/EP-<slug>-S0N\//); // no task => story placeholder preserved
  assert.match(b, /What this PR does/);       // no summary => guidance comment preserved
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// gateOpen head override (P1) + runOpenPr hub-front delegation failure signalling (P2)
// ---------------------------------------------------------------------------------------------
const { gateOpen } = await import('./gate.mjs');
const { runOpenPr } = await import('./openpr.mjs');

// A hub with a platform + an epic whose ledger has a stories review step, on a bare-remote git repo.
function hubWithStoriesStep() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-gopen-'));
  git(T, 'init', '-q'); git(T, 'config', 'user.email', 'a@b.c'); git(T, 'config', 'user.name', 'x');
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', default_branch: 'main', roster: [] }));
  fs.mkdirSync(path.join(T, 'epics/EP-demo/.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-demo/.sdlc/state.json'), JSON.stringify({
    currentStep: 'stories-review',
    steps: [{ id: 'stories-review', type: 'review+approve', artifact: 'stories/', status: 'in_review', risk_tags: [] }],
  }));
  fs.writeFileSync(path.join(T, 'epics/EP-demo/epic.md'), '---\nowner: x\nrepos: []\n---\n');
  return T;
}

test('gateOpen: opens the PR against the head override, not its recomputed per-story branch (P1)', async () => {
  const T = hubWithStoriesStep();
  let seenHead;
  const creator = (_platform, opts) => { seenHead = opts.head; return { ok: true, url: 'https://x/pr/1' }; };
  // a per-story review: artifact collapses to stories/, but the pushed head is the -S01 branch
  const res = await gateOpen(T, { epic: 'EP-demo', artifact: 'stories/', head: 'review/EP-demo/stories-S01', creator });
  assert.equal(seenHead, 'review/EP-demo/stories-S01'); // NOT review/EP-demo/stories
  assert.deepEqual(res, { url: 'https://x/pr/1' });
  fs.rmSync(T, { recursive: true, force: true });
});

test('gateOpen: requests reviewers (incl. a repos.json domain owner) + domain labels (BUG-1/BUG-3)', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-gopen2-'));
  git(T, 'init', '-q'); git(T, 'config', 'user.email', 'a@b.c'); git(T, 'config', 'user.name', 'x');
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  // bob is a hub reviewer (roles map); carol owns backend ONLY via repos.json (no roster role).
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github', default_branch: 'main',
    roster: [{ login: 'bo', name: 'bob', roles: { hub: ['reviewer'] } }, { login: 'ca', name: 'carol' }],
  }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'backend', domain_owner: 'carol' }] }));
  fs.mkdirSync(path.join(T, 'epics/EP-demo/.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-demo/.sdlc/state.json'), JSON.stringify({
    currentStep: 'stories-review',
    steps: [{ id: 'stories-review', type: 'review+approve', artifact: 'stories/', status: 'in_review', risk_tags: [] }],
  }));
  fs.writeFileSync(path.join(T, 'epics/EP-demo/epic.md'), '---\nowner: x\nrepos: [backend]\n---\n');
  fs.mkdirSync(path.join(T, 'epics/EP-demo/stories'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-demo/stories/EP-demo-S01.md'), '---\nrepos: [backend]\n---\n');
  let seen;
  const creator = (_p, opts) => { seen = opts; return { ok: true, url: 'https://x/pr/1' }; };
  await gateOpen(T, { epic: 'EP-demo', artifact: 'stories/', creator });
  assert.deepEqual(seen.reviewers.sort(), ['bo', 'ca']); // carol requested via repos.json (BUG-1)
  assert.deepEqual(seen.labels, ['domain:backend']);     // escalated step labels the touched domain
  fs.rmSync(T, { recursive: true, force: true });
});

test('runOpenPr: a hub-front delegation that opens no PR sets a non-zero exit code (P2)', async () => {
  const prev = process.exitCode;
  const T = hubWithStoriesStep();
  let bare;
  try {
    // bare remote so the branch push succeeds; hub platform null so the delegated gateOpen reaches its
    // file-only "no PR opened" path and returns no url (that path does NOT set exitCode itself, so the
    // exit code can only come from runOpenPr's P2 line — i.e. the test is mutation-proof for the fix).
    bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-bare-')); git(bare, 'init', '-q', '--bare');
    fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null, default_branch: 'main', roster: [] }));
    fs.writeFileSync(path.join(T, 'seed.txt'), '0'); git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed');
    git(T, 'branch', '-q', '-M', 'main'); git(T, 'remote', 'add', 'origin', bare);
    git(T, 'checkout', '-q', '-b', 'review/EP-demo/stories-S01');
    process.exitCode = 0;
    // pass --platform so open-pr's OWN platform detection passes (a bare-file remote is neither
    // github nor gitlab) and execution actually reaches the hub-front delegation, not the early abort.
    let res;
    const out = await grab(() => runOpenPr(T, { platform: 'github' }).then((r) => { res = r; }));
    assert.match(out, /no hub platform/);                 // proves the delegated gateOpen was reached
    assert.doesNotMatch(out, /could not detect platform/); // ...not the early platform-detection abort
    assert.ok(!res?.url, 'no PR opened');
    assert.ok(process.exitCode, 'delegated no-PR result sets a non-zero exit code (P2 line)');
  } finally {
    // restore global state + temp dirs even if an assertion throws, so a failure here cannot leak a
    // non-zero exit code to the runner or strand temp repos (CodeRabbit).
    process.exitCode = prev;
    fs.rmSync(T, { recursive: true, force: true });
    if (bare) fs.rmSync(bare, { recursive: true, force: true });
  }
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

test('gatePredicate: requireEngagement counts only verified approvals (soft default counts both)', () => {
  const approvals = [
    appr({ approver: 'alice', role: 'owner', engagement: 'verified' }),
    appr({ approver: 'bob', role: 'reviewer', engagement: 'none' }),
  ];
  // soft (default): the bare reviewer still counts → passes.
  assert.equal(gatePredicate({ step: baseStep, approvals, currentHash: 'sha256:H1', merged: true, threadsResolved: true }).passed, true);
  // strict: bob's unengaged approval does not count → a reviewer is missing.
  const strict = gatePredicate({ step: baseStep, approvals, currentHash: 'sha256:H1', merged: true, threadsResolved: true, requireEngagement: true });
  assert.equal(strict.passed, false);
  assert.ok(strict.missing.some((m) => /reviewer/.test(m)));
  assert.ok(strict.missing.some((m) => /verified engagement/.test(m)));
  // once bob's approval is engagement-verified, strict passes.
  const ok = gatePredicate({
    step: baseStep, currentHash: 'sha256:H1', merged: true, threadsResolved: true, requireEngagement: true,
    approvals: [approvals[0], appr({ approver: 'bob', role: 'reviewer', engagement: 'verified' })],
  });
  assert.equal(ok.passed, true);
});

test('gatePredicate: solo passes an escalated step without any domain-owner approvals', () => {
  const p = gatePredicate({ step: escStep, approvals: [], currentHash: 'sha256:C', touchedDomains: ['backend', 'mobile'], merged: true, threadsResolved: true, solo: true });
  assert.equal(p.passed, true);
  assert.equal(p.rule, 'solo');
});

test('gatePredicate: discovery-review is a base-rule gate (owner + 1 reviewer, no escalation)', () => {
  const step = { id: 'discovery-review', type: 'review+approve', artifact: 'discovery/', risk_tags: [] };
  const approvals = [
    { step: 'discovery-review', status: 'approved', approver: 'alice', role: 'owner', artifactHash: 'sha256:D' },
    { step: 'discovery-review', status: 'approved', approver: 'bob', role: 'reviewer', artifactHash: 'sha256:D' },
  ];
  const p = gatePredicate({ step, approvals, currentHash: 'sha256:D', merged: true, threadsResolved: true });
  assert.equal(p.passed, true);
  assert.equal(p.rule, 'base');
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

// --- build half: nextAction surfaces each story/repo's next sub-step from build-state ---
const { buildNextForRepo, buildNextActions } = await import('./epic-state.mjs');
// One repo's build-state at an arbitrary point: pass which steps are done + the active step.
const repoBS = (currentStep, done = [], extra = {}) => ({
  currentStep,
  steps: ['spec', 'tasks', 'implement', 'checks', 'engineer-review'].map((id) => ({
    id,
    automation: extra[id]?.automation || 'human_approve',
    locked: id === 'engineer-review',
    status: done.includes(id) ? 'done' : (id === currentStep ? (extra[id]?.status || 'in_progress') : 'blocked'),
  })),
});

test('buildNextForRepo: spec done → next is implement (yad-implement); spec+tasks collapse to one yad-spec', () => {
  const fresh = buildNextForRepo(repoBS('spec'));
  assert.equal(fresh.skill, 'yad-spec');
  // spec → tasks both map to yad-spec, so the chain de-dupes the leading pair.
  assert.deepEqual(fresh.chain, ['yad-spec', 'yad-implement', 'yad-checks', 'yad-engineer-review']);
  const afterSpec = buildNextForRepo(repoBS('implement', ['spec', 'tasks']));
  assert.equal(afterSpec.step, 'implement');
  assert.equal(afterSpec.skill, 'yad-implement');
  assert.deepEqual(afterSpec.chain, ['yad-implement', 'yad-checks', 'yad-engineer-review']);
});

test('buildNextForRepo: implement done → checks; checks done → engineer-review; all done → shipped', () => {
  assert.equal(buildNextForRepo(repoBS('checks', ['spec', 'tasks', 'implement'])).skill, 'yad-checks');
  const er = buildNextForRepo(repoBS('engineer-review', ['spec', 'tasks', 'implement', 'checks']));
  assert.equal(er.skill, 'yad-engineer-review');
  assert.equal(er.locked, true);
  assert.deepEqual(er.chain, ['yad-engineer-review']);
  const shipped = buildNextForRepo(repoBS('engineer-review', ['spec', 'tasks', 'implement', 'checks', 'engineer-review']));
  assert.equal(shipped.shipped, true);
  assert.equal(shipped.skill, null);
});

test('buildNextForRepo: an empty/missing steps array is NOT shipped (it is unknown/not-started)', () => {
  const empty = buildNextForRepo({ currentStep: 'spec', steps: [] });
  assert.equal(empty.shipped, false);
  assert.equal(empty.status, 'unknown');
  assert.equal(empty.skill, null);
  const noSteps = buildNextForRepo({ currentStep: 'spec' }); // no steps key at all
  assert.equal(noSteps.shipped, false);
});

test('buildNextActions: a build-state with no repos contributes no lanes (not a false all-shipped)', () => {
  const out = buildNextActions([{ story: 'EP-x-S03' }]); // repos missing
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].repos, []);
});

test('buildNextForRepo: a machine_advance active step carries the dial through', () => {
  const r = buildNextForRepo(repoBS('checks', ['spec', 'tasks', 'implement'], { checks: { automation: 'machine_advance' } }));
  assert.equal(r.automation, 'machine_advance');
});

test('buildNextActions: maps every story/repo, repos sorted', () => {
  const out = buildNextActions([
    { story: 'EP-x-S03', repos: { mobile: repoBS('implement', ['spec', 'tasks']), backend: repoBS('checks', ['spec', 'tasks', 'implement']) } },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].repos.map((r) => r.repo), ['backend', 'mobile']); // sorted
  assert.equal(out[0].repos[0].skill, 'yad-checks');
  assert.equal(out[0].repos[1].skill, 'yad-implement');
});

test('nextAction: ready-for-build WITH build-state surfaces per-repo build sub-steps', () => {
  const state = { epicId: 'EP-x', currentStep: 'ready-for-build', steps: [S('stories-review', 'review+approve', 'done', 'stories/')] };
  const buildStates = [{ story: 'EP-x-S03', repos: { backend: repoBS('checks', ['spec', 'tasks', 'implement']) } }];
  const a = nextAction({ state, hubPrs: [], buildStates });
  assert.equal(a.kind, 'build');
  assert.equal(a.builds.length, 1);
  assert.equal(a.builds[0].repos[0].skill, 'yad-checks');
  assert.match(a.why, /in progress/);
});

test('nextAction: ready-for-build with NO build-state keeps the static start hint', () => {
  const state = { epicId: 'EP-x', currentStep: 'ready-for-build', steps: [S('stories-review', 'review+approve', 'done', 'stories/')] };
  const a = nextAction({ state, hubPrs: [], buildStates: [] });
  assert.equal(a.kind, 'build');
  assert.equal(a.builds, undefined);
  assert.match(a.why, /front half approved/);
});

test('nextAction: no state → kind new (seed with yad-epic)', () => {
  const a = nextAction({ state: null, hubPrs: [] }, { epic: 'EP-x' });
  assert.equal(a.kind, 'new');
  assert.equal(a.skill, 'yad-epic');
});

// --- discovery ("epic zero") — a 2-step author→review chain with no build half/parallel track ---
const dstate = (over) => ({
  epicId: 'EP-discovery', kind: 'discovery', currentStep: over.currentStep,
  steps: [
    S('discovery', 'author', over.discovery ?? 'done', 'discovery/'),
    S('discovery-review', 'review+approve', over.review ?? 'in_review', 'discovery/'),
  ],
});

test('nextAction: discovery author step maps to yad-discovery', () => {
  const a = nextAction({ state: dstate({ currentStep: 'discovery', discovery: 'in_progress', review: 'blocked' }), hubPrs: [] }, { epic: 'EP-discovery' });
  assert.equal(a.kind, 'author');
  assert.equal(a.skill, 'yad-discovery');
  assert.equal(a.artifact, 'discovery/');
});

test('nextAction: discovery in review → open the gate; with a PR → sync (no parallel track)', () => {
  const open = nextAction({ state: dstate({ currentStep: 'discovery-review' }), hubPrs: [] }, { epic: 'EP-discovery' });
  assert.equal(open.kind, 'review-open');
  assert.equal(open.command, 'yad gate open EP-discovery discovery/');
  assert.equal(open.parallel, undefined);
  const sync = nextAction({ state: dstate({ currentStep: 'discovery-review' }), hubPrs: [{ artifact: 'discovery/', number: 3 }] }, { epic: 'EP-discovery' });
  assert.equal(sync.kind, 'review-sync');
  assert.equal(sync.pr, 3);
});

test('nextAction: an approved discovery (discovery-done) points at yad-epic, not the build half', () => {
  const a = nextAction({ state: dstate({ currentStep: 'discovery-done', discovery: 'done', review: 'done' }), hubPrs: [] }, { epic: 'EP-discovery' });
  assert.equal(a.kind, 'discovery-done');
  assert.match(a.why, /roadmap\.md/);
});

test('preconditionsMet: discovery is a greenfield entry step (alongside epic/analysis)', () => {
  assert.equal(preconditionsMet(null, 'discovery').ok, true);
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

test('runNext: a ready-for-build epic with build-state prints each repo\'s next sub-step + chain', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-nextbuild-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null }));
  seedEpic(T, 'EP-x', { epicId: 'EP-x', currentStep: 'ready-for-build', steps: [
    S('stories-review', 'review+approve', 'done', 'stories/'),
  ] });
  const bsDir = path.join(T, 'epics/EP-x/.sdlc/build-state');
  fs.mkdirSync(bsDir, { recursive: true });
  fs.writeFileSync(path.join(bsDir, 'EP-x-S03.json'), JSON.stringify({
    story: 'EP-x-S03',
    repos: {
      backend: { currentStep: 'checks', steps: [
        { id: 'spec', automation: 'human_approve', locked: false, status: 'done' },
        { id: 'tasks', automation: 'human_approve', locked: false, status: 'done' },
        { id: 'implement', automation: 'machine_advance', locked: false, status: 'done' },
        { id: 'checks', automation: 'machine_advance', locked: false, status: 'in_progress' },
        { id: 'engineer-review', automation: 'human_approve', locked: true, status: 'blocked' },
      ] },
      mobile: { currentStep: 'implement', steps: [
        { id: 'spec', automation: 'human_approve', locked: false, status: 'done' },
        { id: 'tasks', automation: 'human_approve', locked: false, status: 'done' },
        { id: 'implement', automation: 'human_approve', locked: false, status: 'in_progress' },
        { id: 'checks', automation: 'human_approve', locked: false, status: 'blocked' },
        { id: 'engineer-review', automation: 'human_approve', locked: true, status: 'blocked' },
      ] },
    },
  }));
  const s = await grab(() => runNext(T, { epic: 'EP-x' }));
  assert.match(s, /EP-x-S03/);
  assert.match(s, /backend/);
  assert.match(s, /yad-checks/);
  assert.match(s, /yad-engineer-review/);      // backend's remaining chain
  assert.match(s, /yad-implement/);            // mobile's next sub-step
  assert.match(s, /machine_advance/);          // backend's dial note
});

test('runNext: set up greenfield with no epics suggests the yad-discovery front-zero, then yad-epic', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-nextd-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null, profile: { codebase: 'greenfield' } }));
  const s = await grab(() => runNext(T, {}));
  assert.match(s, /yad-discovery/);
  assert.match(s, /yad-epic/);
});

test('runNext: an open EP-discovery is surfaced (its gate action), not mixed into the feature roll-up', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-nextd2-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: null }));
  seedEpic(T, 'EP-discovery', { epicId: 'EP-discovery', kind: 'discovery', currentStep: 'discovery-review', steps: [
    S('discovery', 'author', 'done', 'discovery/'),
    S('discovery-review', 'review+approve', 'in_review', 'discovery/'),
  ] });
  const s = await grab(() => runNext(T, {}));
  assert.match(s, /yad gate (open|sync) EP-discovery discovery\//);
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

const { runSetup, buildReconfiguredHub } = await import('./setup.mjs');

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

test('runSetup: fresh write records git_url from the origin remote', async () => {
  const { T } = scaffold();
  git(T, 'remote', 'add', 'origin', 'https://github.com/acme/hub.git');
  process.env.SDLC_NONINTERACTIVE = '1';
  try {
    await runSetup(T, { solo: true, greenfield: true, monorepo: true, ideTargets: ['.claude'] });
  } finally { delete process.env.SDLC_NONINTERACTIVE; }
  const hub = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/hub.json'), 'utf8'));
  assert.equal(hub.platform, 'github', 'platform detected from origin');
  assert.equal(hub.git_url, 'https://github.com/acme/hub.git', 'git_url recorded from origin');
  fs.rmSync(T, { recursive: true, force: true });
});

test('runSetup: re-run backfills a missing git_url without clobbering the roster', async () => {
  const { T } = scaffold();
  git(T, 'remote', 'add', 'origin', 'https://github.com/acme/hub.git');
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', roster: [{ login: 'al', name: 'alice', roles: { hub: ['owner'] } }] }));
  process.env.SDLC_NONINTERACTIVE = '1';
  try {
    await runSetup(T, { solo: true, greenfield: true, monorepo: true, ideTargets: ['.claude'] }); // keeps existing (no reconfigure)
  } finally { delete process.env.SDLC_NONINTERACTIVE; }
  const hub = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/hub.json'), 'utf8'));
  assert.equal(hub.git_url, 'https://github.com/acme/hub.git', 'missing git_url backfilled from origin');
  assert.equal(hub.roster.length, 1, 'roster preserved');
  assert.equal(hub.roster[0].login, 'al', 'roster entry untouched');
  fs.rmSync(T, { recursive: true, force: true });
});

// Regression for #97: a reconfigure that collects no reviewers (solo re-run) must NOT blank a populated
// roster or drop the top-level verified_authors — both feed the verified-commits gate's allowlist.
test('buildReconfiguredHub: empty collected roster preserves the existing roster + verified_authors', () => {
  const cur = {
    platform: 'github',
    verified_authors: ['dev@acme.com'],
    roster: [{ login: 'al', name: 'alice', email: 'al@acme.com', roles: { hub: ['owner'] } }],
  };
  const next = buildReconfiguredHub(cur, {
    platform: 'github', git_url: 'https://github.com/acme/hub.git', bridge_enabled: true, bridge: true,
    default_branch: 'main', roster: [], solo: true, profile: { codebase: 'brownfield', repo_layout: 'separate', team_size: 1 },
  });
  assert.equal(next.git_url, 'https://github.com/acme/hub.git', 'git_url added');
  assert.deepEqual(next.verified_authors, ['dev@acme.com'], 'verified_authors preserved');
  assert.equal(next.roster.length, 1, 'populated roster preserved when reconfigure collects none');
  assert.equal(next.roster[0].login, 'al', 'roster entry untouched');
  assert.equal(next.solo, true, 'reconfigured fields overlaid');
});

test('buildReconfiguredHub: a non-empty collected roster replaces cur.roster but keeps verified_authors', () => {
  const cur = {
    platform: 'github',
    verified_authors: ['dev@acme.com'],
    roster: [{ login: 'al', name: 'alice', roles: { hub: ['owner'] } }],
  };
  const next = buildReconfiguredHub(cur, {
    platform: 'github', git_url: null, bridge_enabled: true, bridge: true, default_branch: 'main',
    roster: [{ login: 'bo', name: 'bob', roles: { hub: ['reviewer'] } }], solo: false,
    profile: { codebase: 'greenfield', repo_layout: 'monorepo', team_size: 2 },
  });
  assert.equal(next.roster.length, 1, 'new roster used');
  assert.equal(next.roster[0].login, 'bo', 'roster replaced by the reconfigured entries');
  assert.deepEqual(next.verified_authors, ['dev@acme.com'], 'verified_authors still preserved on replace');
});

test('buildReconfiguredHub: no existing file produces a plain object with an empty roster', () => {
  const next = buildReconfiguredHub(null, {
    platform: 'none', git_url: null, bridge_enabled: false, bridge: false, default_branch: 'main',
    roster: [], solo: true, profile: { codebase: 'greenfield', repo_layout: 'monorepo', team_size: 1 },
  });
  assert.deepEqual(next.roster, [], 'fresh write has an empty roster');
  assert.equal(next.verified_authors, undefined, 'no verified_authors invented');
  assert.equal(next.platform, 'none', 'reconfigured fields present');
});

// Wiring guard: a corrupt hub.json must abort the run (YAD-STATE-001), never fail-open to `{}` and get
// rewritten with roster/verified_authors stripped — the same silent-loss hole via a parse failure.
test('runSetup: a corrupt hub.json aborts instead of silently rewriting it stripped', async () => {
  const { T } = scaffold();
  const corrupt = '{ this is not valid json';
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), corrupt);
  process.env.SDLC_NONINTERACTIVE = '1';
  try {
    await assert.rejects(
      runSetup(T, { solo: true, greenfield: true, monorepo: true, ideTargets: ['.claude'] }),
      /YAD-STATE-001|corrupt JSON/,
    );
  } finally { delete process.env.SDLC_NONINTERACTIVE; }
  assert.equal(fs.readFileSync(path.join(T, '.sdlc/hub.json'), 'utf8'), corrupt, 'corrupt file left untouched for the user to fix/restore');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad gate sync` — platform state -> ledger -> advance (with an injected fake reader)
// ---------------------------------------------------------------------------------------------
const { gateSync, gateStatus } = await import('./gate.mjs'); // gateOpen imported earlier (P1/P2 block)

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
  fs.writeFileSync(path.join(ep, 'architecture.md'), '---\nid: EP-test\nartifact: architecture\nstatus: draft\n---\n# arch\n');
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

test('gate sync: records engagement per approval; a noblock companion thread never blocks (2f)', async () => {
  const { T, ep } = scaffoldEpic();
  const reader = () => ({
    ok: true, state: 'MERGED', merged: true, headOid: 'abc',
    reviews: [
      { login: 'al', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z', body: '<!-- yad:engagement verified -->' },
      { login: 'bo', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z' },              // bare → none
      { login: 'ca', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z', body: 'read it\n<!-- yad:engagement verified -->' },
    ],
    // An UNRESOLVED companion card thread — must NOT hold the gate (carries the noblock marker).
    threads: [{ id: 't1', resolved: false, login: 'al', body: 'Card deck 🃏\n<!-- yad:noblock -->' }],
  });
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader });
  const state = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json')));
  assert.equal(state.steps.find((s) => s.id === 'architecture-review').status, 'done'); // noblock thread ignored
  const approvals = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/approvals.json')));
  assert.equal(approvals.find((a) => a.approver === 'alice').engagement, 'verified');
  assert.equal(approvals.find((a) => a.approver === 'bob').engagement, 'none');
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate sync: a genuine unresolved thread still holds the gate in_review', async () => {
  const { T, ep } = scaffoldEpic();
  const reader = () => ({ ...fullApproval, threads: [{ id: 't', resolved: false, login: 'x', body: 'this section is wrong' }] });
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader });
  const state = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json')));
  assert.equal(state.steps.find((s) => s.id === 'architecture-review').status, 'in_review');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad review` — back-half companion + bridge (code PR/MR)
// ---------------------------------------------------------------------------------------------
const { reviewReconcile, reviewContext, reviewNudge, reviewWalkthrough } = await import('./review.mjs');
const { gateWalkthrough } = await import('./gate.mjs');
const { sequenceDiff, riskTagsForPath } = await import('./walkthrough.mjs');

test('gate walkthrough: front-half bundle + stops sequenced from the artifact review diff', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-gwalk-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', default_branch: 'main', roster: [] }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [] }));
  const ep = path.join(T, 'epics/EP-test');
  fs.mkdirSync(path.join(ep, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(ep, 'architecture.md'), '---\nid: EP-test\nartifact: architecture\n---\n# arch\n');
  fs.writeFileSync(path.join(ep, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-test', currentStep: 'architecture-review',
    steps: [{ id: 'architecture-review', type: 'review+approve', artifact: 'architecture.md', status: 'in_review', risk_tags: ['contract'] }],
  }));
  const diff = 'diff --git a/architecture.md b/architecture.md\n@@ -1,1 +1,3 @@\n+a\n+b\n';
  const runner = () => ({ ok: true, stdout: diff, code: 0, stderr: '' });
  const out = await gateWalkthrough(T, { epic: 'EP-test', artifact: 'architecture.md', runner });
  assert.equal(out.epic, 'EP-test');
  assert.equal(out.markers.pair, '<!-- yad:pair -->');
  assert.equal(out.step.escalated, true); // contract risk tag still escalates the gate
  assert.equal(out.stops.length, 1);
  assert.equal(out.stops[0].order, 1);
  assert.equal(out.stops[0].added, 2);
  fs.rmSync(T, { recursive: true, force: true });
});

test('review nudge: posts a friendly @-mention only on bare (un-engaged) approvals', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-rnudge-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'backend', path: 'demo/backend', platform: 'github', default_branch: 'main' }] }));
  const reader = () => ({ ok: true, reviews: [
    { login: 'al', state: 'APPROVED', body: '<!-- yad:engagement verified -->' }, // engaged → no nudge
    { login: 'bo', state: 'APPROVED' },                                            // bare → nudge
    { login: 'ca', state: 'COMMENTED' },                                           // not an approval → skip
  ] });
  const posted = [];
  const poster = (_p, _n, body) => { posted.push(body); return { ok: true }; };
  const res = await reviewNudge(T, { repo: 'backend', pr: 7, reader, poster });
  assert.equal(res.nudged, 1);
  assert.ok(posted[0].includes('@bo') && posted[0].includes('yad review chat') && posted[0].includes('yad:noblock'));
  fs.rmSync(T, { recursive: true, force: true });
});

test('review reconcile: stamps engagement onto the matching build-log ship record (back-half bridge)', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-review-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github',
    roster: [{ login: 'al', name: 'amelia', roles: { backend: ['owner'] } }, { login: 'ca', name: 'carol', roles: { backend: ['reviewer'] } }],
  }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'backend', path: 'demo/backend', platform: 'github', default_branch: 'main' }] }));
  const ep = path.join(T, 'epics/EP-test/.sdlc');
  fs.mkdirSync(ep, { recursive: true });
  fs.writeFileSync(path.join(ep, 'build-log.json'), JSON.stringify({
    epic: 'EP-test',
    ships: [{ story: 'EP-test-S01', task: 'T01', repo: 'backend', pr: 'http://x/pull/5', engineer_review: [] }],
  }));
  const reader = () => ({ ok: true, merged: true, headOid: 'h', reviews: [
    { login: 'al', state: 'APPROVED', body: 'read it\n<!-- yad:engagement verified -->' },
    { login: 'ca', state: 'APPROVED' },
  ], threads: [] });
  const res = await reviewReconcile(T, { epic: 'EP-test', repo: 'backend', pr: 5, reader });
  assert.equal(res.written, true);
  const bl = JSON.parse(fs.readFileSync(path.join(ep, 'build-log.json')));
  const er = bl.ships[0].engineer_review;
  assert.equal(er.find((e) => e.approver === 'amelia').engagement, 'verified');
  assert.equal(er.find((e) => e.approver === 'carol').engagement, 'none');
  assert.equal(er.find((e) => e.approver === 'amelia').role, 'owner');
  fs.rmSync(T, { recursive: true, force: true });
});

test('review reconcile: matches a ship by exact PR number, never substring', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-recon2-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', roster: [{ login: 'al', name: 'amelia', roles: { backend: ['owner'] } }] }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'backend', path: 'demo/backend', platform: 'github' }] }));
  const ep = path.join(T, 'epics/EP-test/.sdlc');
  fs.mkdirSync(ep, { recursive: true });
  // A ship recorded against PR #15 must NOT be matched by --pr 5.
  fs.writeFileSync(path.join(ep, 'build-log.json'), JSON.stringify({ epic: 'EP-test', ships: [{ story: 'S', task: 'T', repo: 'backend', pr: 'http://x/pull/15', engineer_review: [{ approver: 'old' }] }] }));
  const reader = () => ({ ok: true, reviews: [{ login: 'al', state: 'APPROVED' }] });
  const res = await reviewReconcile(T, { epic: 'EP-test', repo: 'backend', pr: 5, reader });
  assert.equal(res.written, false, 'no false substring match against #15');
  const bl = JSON.parse(fs.readFileSync(path.join(ep, 'build-log.json')));
  assert.equal(bl.ships[0].engineer_review[0].approver, 'old', 'the #15 ship is untouched');
  fs.rmSync(T, { recursive: true, force: true });
});

test('review: an explicit --repo not in the registry fails fast (no silent cwd fallthrough)', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-rrepo-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'backend', path: 'demo/backend', platform: 'github' }] }));
  const prev = process.exitCode; process.exitCode = 0;
  const r = await reviewContext(T, { repo: 'nope', pr: 1 });
  assert.ok(!r, 'returns nothing');
  assert.ok(process.exitCode, 'sets a non-zero exit code');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('review context: prints the grounding bundle (diff cmd + code-map) for the companion', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-rctx-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'backend', path: 'demo/backend', platform: 'gitlab', default_branch: 'main' }] }));
  const b = await reviewContext(T, { repo: 'backend', pr: 9 });
  assert.equal(b.platform, 'gitlab');
  assert.equal(b.pr, 9);
  assert.ok(b.diffCmd.includes('main...HEAD'));
  assert.ok(b.codeMap.endsWith('.sdlc/code-context/backend/code-map.md'));
  fs.rmSync(T, { recursive: true, force: true });
});

test('review walkthrough: prints the bundle PLUS ordered, risk-tagged stops (highest-risk first)', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-rwalk-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'backend', path: 'demo/backend', platform: 'github', default_branch: 'main' }] }));
  const fakeDiff = [
    'diff --git a/docs/readme.md b/docs/readme.md',
    '@@ -1,1 +1,2 @@',
    '+a line',
    'diff --git a/src/auth/session.js b/src/auth/session.js',
    '@@ -3,2 +3,4 @@ fn()',
    '-old', '+new1', '+new2',
  ].join('\n');
  const runner = () => ({ ok: true, stdout: fakeDiff, code: 0, stderr: '' });
  const out = await reviewWalkthrough(T, { repo: 'backend', pr: 7, runner });
  assert.equal(out.repo, 'backend');
  assert.ok(Array.isArray(out.stops) && out.stops.length === 2);
  // The auth hunk outranks the docs hunk.
  assert.equal(out.stops[0].file, 'src/auth/session.js');
  assert.ok(out.stops[0].riskTags.includes('auth'));
  assert.equal(out.stops[0].order, 1);
  assert.equal(out.stops[1].file, 'docs/readme.md');
  assert.deepEqual(out.stops[1].riskTags, []);
  assert.equal(out.markers.pair, '<!-- yad:pair -->');
  fs.rmSync(T, { recursive: true, force: true });
});

test('review walkthrough: STDOUT stays pure JSON on the empty-diff and failed-diff paths (diagnostics → stderr)', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-rwalk-json-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'backend', path: 'demo/backend', platform: 'github', default_branch: 'main' }] }));
  const captureStdout = async (runner) => {
    const realLog = console.log, realErr = console.error;
    const out = []; console.log = (s = '') => out.push(String(s)); console.error = () => {};
    try { await reviewWalkthrough(T, { repo: 'backend', pr: 1, runner }); }
    finally { console.log = realLog; console.error = realErr; }
    return out.join('\n');
  };
  // empty diff (branch == base) → stops [], but stdout must still parse
  const empty = await captureStdout(() => ({ ok: true, stdout: '', code: 0, stderr: '' }));
  assert.deepEqual(JSON.parse(empty).stops, [], 'empty-diff stdout is valid JSON');
  // failed diff read (unpushed branch / bad base) → warn must NOT leak onto stdout
  const failed = await captureStdout(() => ({ ok: false, stdout: '', code: 1, stderr: 'bad rev' }));
  assert.deepEqual(JSON.parse(failed).stops, [], 'failed-diff stdout is still valid JSON');
  fs.rmSync(T, { recursive: true, force: true });
});

test('sequenceDiff: anchors line ranges, counts +/- lines, and one zero-size stop for a hunkless file', () => {
  const diff = [
    'diff --git a/payments/charge.js b/payments/charge.js',
    '@@ -10,3 +10,5 @@',
    '-removed', '+added1', '+added2',
    'diff --git a/assets/logo.png b/assets/logo.png',
    'Binary files a/assets/logo.png and b/assets/logo.png differ',
  ].join('\n');
  const stops = sequenceDiff(diff, {});
  const charge = stops.find((s) => s.file === 'payments/charge.js');
  assert.equal(charge.startLine, 10);
  assert.equal(charge.endLine, 14);
  assert.equal(charge.added, 2);
  assert.equal(charge.removed, 1);
  assert.ok(charge.riskTags.includes('payments'));
  const logo = stops.find((s) => s.file === 'assets/logo.png');
  assert.equal(logo.hunkHeader, null);
  assert.equal(logo.added, 0);
  // orders are a contiguous 1..n
  assert.deepEqual(stops.map((s) => s.order).sort((a, b) => a - b), [1, 2]);
});

test('sequenceDiff: an explicit contractPath force-tags the locked surface', () => {
  const diff = 'diff --git a/lib/widget.ts b/lib/widget.ts\n@@ -1,1 +1,2 @@\n+x\n';
  assert.deepEqual(sequenceDiff(diff, { contractPath: 'lib/widget.ts' })[0].riskTags, ['contract']);
  assert.deepEqual(riskTagsForPath('lib/widget.ts', {}), []); // not contract without the hint
});

test('sequenceDiff: empty diff yields no stops', () => {
  assert.deepEqual(sequenceDiff('', {}), []);
  assert.deepEqual(sequenceDiff(undefined, {}), []);
});

test('sequenceDiff: counts content lines that themselves start with ++ / -- (e.g. CLI flags)', () => {
  // A removed `--flag` is the diff line `---flag`; an added `++i` is `+++i`. Both are content, not the
  // `--- a/file` / `+++ b/file` headers (those sit before the first @@), so they must be counted.
  const diff = 'diff --git a/x.sh b/x.sh\n@@ -1,2 +1,2 @@\n---flag\n+++i\n';
  const [s] = sequenceDiff(diff, {});
  assert.equal(s.removed, 1, '`---flag` content line counted as a removal');
  assert.equal(s.added, 1, '`+++i` content line counted as an addition');
});

test('gate sync: EP-discovery advances through the SAME gate to discovery-done (base rule, no escalation)', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-gate-disc-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github', default_branch: 'main',
    roster: [{ login: 'al', name: 'alice', role: 'owner' }, { login: 'bo', name: 'bob', role: 'reviewer' }],
  }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [] }));
  const ep = path.join(T, 'epics/EP-discovery');
  fs.mkdirSync(path.join(ep, '.sdlc'), { recursive: true });
  // The whole set must exist for the discovery review to be reviewable (hash-bound).
  fs.writeFileSync(path.join(ep, 'roadmap.md'), '---\nid: EP-discovery\nartifact: roadmap\nstatus: draft\nowner: alice\n---\n# roadmap\n');
  fs.writeFileSync(path.join(ep, 'requirements.md'), '---\nid: EP-discovery\nartifact: requirements\nstatus: draft\n---\n# reqs\n');
  for (const f of ['market-research.md', 'competitor-analysis.md', 'current-state.md', 'feasibility.md']) {
    fs.writeFileSync(path.join(ep, f), `---\nid: EP-discovery\nartifact: ${f.replace('.md', '')}\nstatus: draft\n---\n# ${f}\n`);
  }
  fs.writeFileSync(path.join(ep, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-discovery', kind: 'discovery', currentStep: 'discovery-review',
    steps: [
      { id: 'discovery', type: 'author', artifact: 'discovery/', status: 'done', risk_tags: [] },
      { id: 'discovery-review', type: 'review+approve', artifact: 'discovery/', status: 'in_review', risk_tags: [] },
    ],
  }));
  fs.writeFileSync(path.join(ep, '.sdlc/hub-prs.json'), JSON.stringify([
    { step: 'discovery-review', artifact: 'discovery/', platform: 'github', number: 4, url: 'http://x/4', branch: 'review/EP-discovery/discovery', lastSyncedAt: null },
  ]));
  const approval = { ok: true, state: 'MERGED', merged: true, headOid: 'abc',
    reviews: [{ login: 'al', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z' }, { login: 'bo', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z' }],
    threads: [] };
  await gateSync(T, { epic: 'EP-discovery', today: '2026-06-09', reader: () => approval });
  const state = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json')));
  assert.equal(state.steps.find((s) => s.id === 'discovery-review').status, 'done');
  assert.equal(state.currentStep, 'discovery-done', 'discovery terminates at discovery-done, never ready-for-build');
  const approvals = JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/approvals.json')));
  assert.ok(!approvals.some((a) => a.role === 'domain-owner'), 'discovery never escalates to domain owners');
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate sync: an approval on an older commit than the merged head is stale — gate holds (revoke-on-change in code)', async () => {
  const head = 'deadbeefcafe';
  const onHead = (login) => ({ login, state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z', commit: head });
  // carol (the backend domain-owner) approved an EARLIER revision; the artifact moved before merge,
  // so her review sits on an older commit than the merged head → dropped → escalated gate holds.
  const staleCarol = { ok: true, state: 'MERGED', merged: true, headOid: head,
    reviews: [onHead('al'), onHead('bo'), { login: 'ca', state: 'APPROVED', submittedAt: '2026-06-08T00:00:00Z', commit: 'oldsha' }],
    threads: [] };
  const s1 = scaffoldEpic();
  await gateSync(s1.T, { epic: 'EP-test', today: '2026-06-09', reader: () => staleCarol });
  assert.equal(JSON.parse(fs.readFileSync(path.join(s1.ep, '.sdlc/state.json'))).steps.find((s) => s.id === 'architecture-review').status,
    'in_review', 'stale domain-owner approval is dropped → escalated gate holds');
  fs.rmSync(s1.T, { recursive: true, force: true });

  // all three approved the merged head → all count → the escalated gate passes.
  const allHead = { ok: true, state: 'MERGED', merged: true, headOid: head,
    reviews: [onHead('al'), onHead('bo'), onHead('ca')], threads: [] };
  const s2 = scaffoldEpic();
  await gateSync(s2.T, { epic: 'EP-test', today: '2026-06-09', reader: () => allHead });
  assert.equal(JSON.parse(fs.readFileSync(path.join(s2.ep, '.sdlc/state.json'))).steps.find((s) => s.id === 'architecture-review').status,
    'done', 'approvals on the merged head advance');
  fs.rmSync(s2.T, { recursive: true, force: true });
});

test('gate sync: an ABSENT commit (GitLab — no per-approval SHA) is kept — relies on the platform dismissal setting', async () => {
  // Reviews omit `commit` entirely (GitLab approvals carry no per-approval SHA) → the in-code SHA
  // filter must NOT drop them; revoke-on-change there is the platform "remove approvals" setting.
  const noSha = { ok: true, state: 'MERGED', merged: true, headOid: 'whatever',
    reviews: [
      { login: 'al', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z' },
      { login: 'bo', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z' },
      { login: 'ca', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z' },
    ], threads: [] };
  const { T, ep } = scaffoldEpic();
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => noSha });
  assert.equal(JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json'))).steps.find((s) => s.id === 'architecture-review').status,
    'done', 'approvals with an absent commit SHA still count');
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate sync: a NULL commit (degraded GitHub read) fails closed — gate holds, never advances on unverifiable approvals', async () => {
  // commit === null is the GitHub reader signaling a degraded read: we cannot prove the approval is
  // for the merged content, so it must NOT count — a transient API failure holds the gate.
  const degraded = { ok: true, state: 'MERGED', merged: true, headOid: 'abc',
    reviews: [
      { login: 'al', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z', commit: null },
      { login: 'bo', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z', commit: null },
      { login: 'ca', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z', commit: null },
    ], threads: [] };
  const { T, ep } = scaffoldEpic();
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => degraded });
  assert.equal(JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json'))).steps.find((s) => s.id === 'architecture-review').status,
    'in_review', 'a degraded read (null commit) fails closed — the gate holds');
  fs.rmSync(T, { recursive: true, force: true });

  // …and a null commit must fail closed even when the read also omitted headOid.
  const degradedNoHead = { ok: true, state: 'MERGED', merged: true,
    reviews: [
      { login: 'al', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z', commit: null },
      { login: 'bo', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z', commit: null },
      { login: 'ca', state: 'APPROVED', submittedAt: '2026-06-09T00:00:00Z', commit: null },
    ], threads: [] };
  const b = scaffoldEpic();
  await gateSync(b.T, { epic: 'EP-test', today: '2026-06-09', reader: () => degradedNoHead });
  assert.equal(JSON.parse(fs.readFileSync(path.join(b.ep, '.sdlc/state.json'))).steps.find((s) => s.id === 'architecture-review').status,
    'in_review', 'null commit fails closed even without headOid');
  fs.rmSync(b.T, { recursive: true, force: true });
});

test('gate sync: a failed platform read flags the run non-zero (no green no-op) and holds the step', async () => {
  const { T, ep } = scaffoldEpic();
  const prev = process.exitCode;
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => ({ ok: false, reason: 'gh auth failed' }) });
  assert.equal(process.exitCode, 1, 'a failed read surfaces as a non-zero run');
  process.exitCode = prev;
  assert.equal(JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/state.json'))).steps.find((s) => s.id === 'architecture-review').status,
    'in_review', 'the step is not advanced on a failed read');
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate sync local: writes when the bridge is OFF, advisory (no writes) when ON', async () => {
  // bridge OFF (a platform but no gate-sync CI wired): local sync stays the writer and advances.
  const a = scaffoldEpic();
  await gateSync(a.T, { epic: 'EP-test', today: '2026-06-09', reader: () => fullApproval, local: true });
  const sa = JSON.parse(fs.readFileSync(path.join(a.ep, '.sdlc/state.json')));
  assert.equal(sa.steps.find((s) => s.id === 'architecture-review').status, 'done', 'non-bridge local sync advances');
  fs.rmSync(a.T, { recursive: true, force: true });

  // bridge ON: local sync is advisory — CI owns the ledger, so it writes nothing.
  const b = scaffoldEpic();
  const hub = JSON.parse(fs.readFileSync(path.join(b.T, '.sdlc/hub.json')));
  hub.bridge_enabled = true;
  fs.writeFileSync(path.join(b.T, '.sdlc/hub.json'), JSON.stringify(hub));
  await gateSync(b.T, { epic: 'EP-test', today: '2026-06-09', reader: () => fullApproval, local: true });
  const sb = JSON.parse(fs.readFileSync(path.join(b.ep, '.sdlc/state.json')));
  assert.equal(sb.steps.find((s) => s.id === 'architecture-review').status, 'in_review', 'bridge local sync writes nothing');
  fs.rmSync(b.T, { recursive: true, force: true });
});

test('gate sync advisory (bridge, local): unresolved comments do not dirty reviews/*.md', async () => {
  const { T, ep } = scaffoldEpic();
  const hub = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/hub.json')));
  hub.bridge_enabled = true;
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify(hub));
  const blocking = {
    ok: true, state: 'OPEN', merged: false, headOid: 'z',
    reviews: [{ login: 'bo', state: 'CHANGES_REQUESTED' }],
    threads: [{ id: 't1', resolved: false, login: 'bo', body: 'fix this' }],
  };
  await gateSync(T, { epic: 'EP-test', today: '2026-06-09', reader: () => blocking, local: true });
  assert.ok(!fs.existsSync(path.join(ep, 'reviews')), 'advisory sync wrote no reviews/*.md');
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
const { detectPlatform, cliFor, hostFromGitUrl, resolveLogin, mapApprovers, rolesForScope, hasAnyRole, reviewersForScopes, resolveCommitterLogin, validateLogin, buildPrArgs, prNumberFromUrl } = await import('./platform.mjs');

test('prNumberFromUrl anchors to the pull/merge_requests path, not a numeric org/repo', () => {
  assert.equal(prNumberFromUrl('https://github.com/org/repo/pull/123'), '123');
  assert.equal(prNumberFromUrl('https://gitlab.com/group/proj/-/merge_requests/45'), '45');
  // a numeric segment BEFORE the MR path must not win
  assert.equal(prNumberFromUrl('https://gitlab.example.com/team/123/-/merge_requests/45'), '45');
  assert.equal(prNumberFromUrl('https://x/pull/5'), '5');
  assert.equal(prNumberFromUrl('nonsense'), null);
});

test('resolveLogin credits a domain owner declared via repos.json domain_owners[] (symmetry)', () => {
  const roster = [{ login: 'ca', name: 'carol' }];
  const recs = resolveLogin('ca', roster, [{ name: 'backend', domain_owners: ['carol', 'bob'] }], ['backend']);
  assert.ok(recs.some((r) => r.role === 'domain-owner' && r.domain === 'backend'));
});
const { parseEngagement, isNoBlock, upsertTrailerBlock, nudgeMessage, engagementBody, noBlock, NOBLOCK_MARK, PAIR_MARK, isPair, pairSessionBody } = await import('./companion.mjs');

test('companion: engagement + noblock markers parse and round-trip', () => {
  assert.equal(parseEngagement('looks good\n<!-- yad:engagement verified -->'), 'verified');
  assert.equal(parseEngagement('<!-- yad:engagement none -->'), 'none');
  assert.equal(parseEngagement('no marker here'), 'none');
  assert.equal(parseEngagement(engagementBody('verified', 'hi')), 'verified');
  assert.equal(parseEngagement(engagementBody('none')), 'none');
  assert.ok(isNoBlock(noBlock('a companion card')));
  assert.ok(!isNoBlock('a real concern'));
  assert.ok(isNoBlock(nudgeMessage('ayman')) && nudgeMessage('ayman').includes('@ayman'));
});

test('companion: pairSessionBody carries the pair + noblock marks but NEVER an engagement mark', () => {
  const body = pairSessionBody({
    summary: 'walked 3 stops', scorecard: '| step | grade |', verdict: 'no blockers',
    humanSignoff: 'satisfied', aiSignoff: 'satisfied',
  });
  assert.ok(isPair(body), 'is a countable pair session');
  assert.ok(isNoBlock(body), 'never holds the gate');
  assert.equal(parseEngagement(body), 'none', 'the session log is history, not the approval');
  assert.ok(body.includes(PAIR_MARK) && body.includes(NOBLOCK_MARK));
  assert.ok(body.includes('walked 3 stops') && body.includes('🧑 Human: satisfied') && body.includes('🤖 AI: satisfied'));
  // a plain comment is neither a pair session nor a card
  assert.ok(!isPair('a real concern'));
  // empty input still produces a valid (marked) body, just no sections
  assert.ok(isPair(pairSessionBody()) && isNoBlock(pairSessionBody()));
});

test('yad-pair-review skill rides `yad update` (delete it → update reinstalls it)', async () => {
  const { T } = scaffold();
  await reconcile(T, { fix: true });
  fs.rmSync(path.join(T, '.claude/skills/yad-pair-review'), { recursive: true, force: true });
  const r = await reconcile(T, { fix: true, scope: 'changed' });
  assert.ok(fs.existsSync(path.join(T, '.claude/skills/yad-pair-review/SKILL.md')), 'pair-review installed by update');
  assert.ok(r.counts.new >= 1, 'counted as new');
  fs.rmSync(T, { recursive: true, force: true });
});

test('companion: upsertTrailerBlock inserts once and replaces idempotently', () => {
  const t1 = upsertTrailerBlock('existing description', 'TRAILER ONE');
  assert.ok(t1.includes('TRAILER ONE') && t1.includes('existing description'));
  assert.equal((t1.match(/<!-- yad:trailer -->/g) || []).length, 1);
  const t2 = upsertTrailerBlock(t1, 'TRAILER TWO');
  assert.ok(t2.includes('TRAILER TWO') && !t2.includes('TRAILER ONE')); // replaced, not duplicated
  assert.equal((t2.match(/<!-- yad:trailer -->/g) || []).length, 1);
  assert.ok(t2.includes('existing description')); // surrounding body preserved
  // an earlier QUOTED end-marker in the body must not break idempotent replacement
  const quoted = upsertTrailerBlock('quote: `<!-- /yad:trailer -->` in prose\n\n' + t1, 'TRAILER THREE');
  assert.equal((quoted.match(/<!-- yad:trailer -->/g) || []).length, 1, 'still exactly one trailer block');
  assert.ok(quoted.includes('TRAILER THREE') && !quoted.includes('TRAILER ONE'));
});

test('mapApprovers reads the engagement marker from the review body', () => {
  const roster = [{ login: 'al', name: 'alice', role: 'owner' }];
  const verified = mapApprovers([{ login: 'al', state: 'APPROVED', body: 'ok\n<!-- yad:engagement verified -->' }], { roster, repos: [], touchedDomains: [] });
  assert.equal(verified[0].engagement, 'verified');
  const bare = mapApprovers([{ login: 'al', state: 'APPROVED' }], { roster, repos: [], touchedDomains: [] });
  assert.equal(bare[0].engagement, 'none');
  assert.ok(NOBLOCK_MARK.includes('yad:noblock'));
});

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

test('reviewersForScopes requests a repos.json-only domain owner (BUG-1 regression)', () => {
  // carol owns backend ONLY via repos.json domain_owner — no roster role for the backend scope.
  const roster = [
    { login: 'al', name: 'alice', roles: { hub: ['owner'] } },
    { login: 'bo', name: 'bob', roles: { hub: ['reviewer'] } },
    { login: 'ca', name: 'carol' },                       // identity only, no roles map
  ];
  const repos = [{ name: 'backend', domain_owner: 'carol' }];
  // Without repos: carol is never requested (the bug). With repos: she is.
  assert.deepEqual(reviewersForScopes(roster, ['hub', 'backend'], {}).sort(), ['bo']);
  assert.deepEqual(reviewersForScopes(roster, ['hub', 'backend'], { repos }).sort(), ['bo', 'ca']);
  // domain_owners[] (plural) is honored too, and excludeLogin still applies.
  const repos2 = [{ name: 'backend', domain_owners: ['carol', 'bob'] }];
  assert.deepEqual(reviewersForScopes(roster, ['backend'], { repos: repos2, excludeLogin: 'bo' }).sort(), ['ca']);
});

test('buildPrArgs caps GitLab to a single reviewer field (BUG-2)', () => {
  const gl = buildPrArgs('gitlab', { title: 't', body: 'b', base: 'main', head: 'f', reviewers: ['bo', 'ca', 'dv'] });
  assert.equal(gl[gl.indexOf('--reviewer') + 1], 'bo');   // only the first; the rest get @-mentioned
  assert.equal(gl.filter((a) => a === '--reviewer').length, 1);
  // GitHub keeps the full comma list (multiple reviewers are supported there).
  const gh = buildPrArgs('github', { title: 't', body: 'b', base: 'main', head: 'f', reviewers: ['bo', 'ca'] });
  assert.equal(gh[gh.indexOf('--reviewer') + 1], 'bo,ca');
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

// runCommit's missing-Task warning is code-repo specific (spec-link is a repo gate, not a hub gate):
// on the hub it must reassure, not threaten with a gate that does not run there.
test('runCommit: the missing-Task warning is stage-aware (hub vs code repo)', async () => {
  // a hub (carries .sdlc/hub.json), staged change on a branch with no -S0N-T0N id
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-commit-'));
  git(T, 'init', '-q'); git(T, 'config', 'user.email', 'a@b.c'); git(T, 'config', 'user.name', 'x');
  fs.writeFileSync(path.join(T, 'seed.txt'), '0'); git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed');
  git(T, 'branch', '-q', '-M', 'main'); git(T, 'checkout', '-q', '-b', 'ci/wire-gates');
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github' }));
  fs.writeFileSync(path.join(T, 'a.txt'), '1'); git(T, 'add', '-A');
  const onHub = await grab(() => runCommit(T, { type: 'ci', message: 'wire the gates', dryRun: true }));
  assert.match(onHub, /fine for a hub PR/);
  assert.doesNotMatch(onHub, /spec-link gate will fail on a code repo/);
  fs.rmSync(T, { recursive: true, force: true });

  // a plain code repo (no hub.json) keeps the original code-repo warning
  const R = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-commit-'));
  git(R, 'init', '-q'); git(R, 'config', 'user.email', 'a@b.c'); git(R, 'config', 'user.name', 'x');
  fs.writeFileSync(path.join(R, 'seed.txt'), '0'); git(R, 'add', '-A'); git(R, 'commit', '-q', '-m', 'seed');
  git(R, 'branch', '-q', '-M', 'main'); git(R, 'checkout', '-q', '-b', 'feature/no-task');
  fs.writeFileSync(path.join(R, 'a.txt'), '1'); git(R, 'add', '-A');
  const onRepo = await grab(() => runCommit(R, { type: 'feat', message: 'do a thing', dryRun: true }));
  assert.match(onRepo, /spec-link gate will fail on a code repo/);
  fs.rmSync(R, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad gate ci` — merge-driven sync (Path B): read-only pre-merge; advance + status flip on the
// default branch at merge. Derives the epic/artifact from the review branch name.
// ---------------------------------------------------------------------------------------------
const { parseReviewBranch, artifactFromBase, artifactPaths, upsertHubPr, artifactBase, advanceState, markInReview, discoveryHash, DISCOVERY_FILES } = await import('./epic-state.mjs');
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

test('discovery: artifact mapping uses the virtual discovery/ set (mirrors stories/)', () => {
  assert.equal(artifactBase('discovery/'), 'discovery');
  assert.equal(artifactFromBase('discovery'), 'discovery/');
  assert.deepEqual(artifactPaths('discovery'), DISCOVERY_FILES);
});

test('advanceState: approving discovery-review terminates at discovery-done (no build half)', () => {
  const state = {
    epicId: 'EP-discovery', kind: 'discovery', currentStep: 'discovery-review',
    steps: [
      { id: 'discovery', type: 'author', artifact: 'discovery/', status: 'done' },
      { id: 'discovery-review', type: 'review+approve', artifact: 'discovery/', status: 'in_review' },
    ],
  };
  advanceState(state, state.steps[1]);
  assert.equal(state.steps[1].status, 'done');
  assert.equal(state.currentStep, 'discovery-done', 'discovery never becomes ready-for-build');
});

test('discoveryHash: a partial set is non-reviewable (null); the full set hashes and is edit-sensitive', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-disc-'));
  assert.equal(discoveryHash(T), null, 'no discovery files → non-reviewable');
  // A partial set (a required artifact still missing) is incomplete → not reviewable.
  fs.writeFileSync(path.join(T, 'roadmap.md'), '# roadmap v1');
  assert.equal(discoveryHash(T), null, 'missing required discovery files → null');
  // Complete the set → a real fingerprint, stable when unchanged.
  for (const f of DISCOVERY_FILES) fs.writeFileSync(path.join(T, f), `# ${f} v1`);
  const h1 = discoveryHash(T);
  assert.ok(h1 && h1.startsWith('sha256:'));
  assert.equal(discoveryHash(T), h1, 'stable when unchanged');
  // Edit any file → hash changes (revoke-on-change); remove one → back to non-reviewable.
  fs.writeFileSync(path.join(T, 'requirements.md'), '# requirements.md v2');
  assert.notEqual(discoveryHash(T), h1, 'a changed discovery file changes the set hash');
  fs.rmSync(path.join(T, 'feasibility.md'));
  assert.equal(discoveryHash(T), null, 'a deleted required file makes the set non-reviewable again');
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

// A hub repo with a bare origin: main carries the epic scaffolding (NO hub-prs.json — Path B never
// seeds it pre-merge), the review branch carries only the owner's artifact edit, and a separate "CI"
// clone runs `gate ci` the way the workflow does.
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
  fs.writeFileSync(path.join(ep, 'architecture.md'), '---\nid: EP-test\nartifact: architecture\nstatus: draft\n---\n# arch\n');
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

test('gate ci pre-merge: read-only — never pushes the review branch or the default branch (Path B)', async () => {
  const { T, author, ci } = scaffoldCiHub();
  // CI checks out the review branch itself, just as a wired workflow would.
  git(ci, 'fetch', '-q', 'origin', 'review/EP-test/architecture');
  git(ci, 'checkout', '-q', '-B', 'review/EP-test/architecture', 'origin/review/EP-test/architecture');
  // Pre-merge the PR is approved + threads resolved but NOT yet merged → a held step. Under Path B
  // CI writes nothing: the platform PR is the source of truth during review.
  const r = await gateCi(ci, { branch: 'review/EP-test/architecture', pr: 7, merged: false, today: '2026-06-09', reader: () => ({ ...fullApproval, state: 'OPEN', merged: false }) });
  assert.equal(r.synced, 1, 'the predicate still ran (synced) — it just was not persisted');

  git(author, 'fetch', '-q', 'origin');
  // the REVIEW branch is untouched: HEAD is still the owner's artifact commit, no CI ledger commit.
  assert.equal(git(author, 'log', '-1', '--format=%s', 'origin/review/EP-test/architecture').toString().trim(), 'review: architecture (EP-test)');
  // no CI-written gate-state files exist on the review branch (review state lives on the platform).
  // state.json pre-exists from the seed; hub-prs/approvals/comments are CI-only — they must be absent.
  const tree = git(author, 'ls-tree', '-r', '--name-only', 'origin/review/EP-test/architecture').toString();
  assert.doesNotMatch(tree, /epics\/EP-test\/\.sdlc\/(hub-prs|approvals|comments)\.json/, 'no CI ledger pushed to the review branch');
  assert.doesNotMatch(tree, /epics\/EP-test\/reviews\//, 'no review summaries pushed to the review branch');
  // the DEFAULT branch is untouched too — its HEAD is still the seed.
  assert.equal(git(author, 'log', '-1', '--format=%s', 'origin/trunk').toString().trim(), 'seed');
  // and the read-only run leaves the CI checkout clean (the hub-prs seed is restored, nothing else).
  assert.equal(git(ci, 'status', '--porcelain').toString().trim(), '', 'pre-merge leaves a clean working tree');
  fs.rmSync(T, { recursive: true, force: true });
});

test('gate ci --merged: advances the step + flips artifact status on the default branch (rebase-retries past the merge)', async () => {
  const { T, author, ci } = scaffoldCiHub();
  // The human merge brings the review branch (the owner's artifact edit) onto the default
  // branch. This lands AFTER the CI clone took its trunk, so CI's advance push rebases and retries.
  git(author, 'checkout', '-q', 'trunk');
  git(author, 'merge', '-q', '--no-ff', 'review/EP-test/architecture', '-m', 'merge review/EP-test/architecture');
  git(author, 'push', '-q', 'origin', 'trunk');

  await gateCi(ci, { branch: 'review/EP-test/architecture', pr: 7, merged: true, today: '2026-06-09', reader: () => fullApproval });

  git(author, 'fetch', '-q', 'origin');
  const state = JSON.parse(show(author, 'origin/trunk:epics/EP-test/.sdlc/state.json'));
  assert.equal(state.steps.find((s) => s.id === 'architecture-review').status, 'done');
  assert.equal(state.currentStep, 'ui-design');
  // the merged artifact is on trunk (via the human merge) and its status flipped to approved at merge.
  assert.equal(show(author, 'origin/trunk:epics/EP-test/contract.md'), BRANCH_CONTRACT);
  assert.match(show(author, 'origin/trunk:epics/EP-test/architecture.md'), /status: approved/);
  // the advance commit carries the loop guard.
  assert.match(git(author, 'log', '-1', '--format=%B', 'origin/trunk').toString(), /\[skip ci\]/);
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
  // P2: a swept merge advances AND flips the artifact status — even though --merged was not passed.
  assert.match(fs.readFileSync(path.join(ep, 'architecture.md'), 'utf8'), /status: approved/, 'swept advance syncs status');
  assert.ok(git(T, 'show', '--name-only', '--format=', 'HEAD').toString().includes('epics/EP-test/architecture.md'), 'the status flip is committed');
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

test('verified-commits gate: the gate-sync bot is allowlist-waived (signature still governs)', () => {
  const T = scaffoldGateRepo(); // allowlist has alice@corp.io only; no remote → signature skipped
  fs.mkdirSync(path.join(T, 'epics/EP-x/.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-x/.sdlc/state.json'), '{}\n');
  git(T, 'add', '-A');
  // bot author NOT in the allowlist — passes anyway because the bot is waived.
  git(T, '-c', 'user.name=yad-gate-sync[bot]', '-c', 'user.email=yad-gate-sync[bot]@users.noreply.github.com',
    'commit', '-q', '-m', 'chore(gate): sync [skip ci]');
  const r = runGate(T);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /gate-sync bot — allowlist waived/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('verified-commits gate: a merge commit is allowlist-waived (author = merger, not a roster human)', () => {
  // The push-on-default yad-update-guard sees merge commits (the PR-triggered gates never do). A merge
  // commit is authored by whoever pressed merge — often a platform noreply, not an allowlisted email —
  // so it must be waived (signature still governs), else every routine PR merge reddens the branch.
  const T = scaffoldGateRepo(); // on `feature`, allowlist = alice@corp.io only, no remote → sig skipped
  git(T, 'checkout', '-q', '-b', 'topic');
  fs.writeFileSync(path.join(T, 'd.txt'), '4');
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'feat: work on topic'); // alice-authored, allowlisted
  git(T, 'checkout', '-q', 'main');
  // a real 2-parent merge commit authored by a NON-allowlisted merger
  git(T, '-c', 'user.email=web-flow@github.com', '-c', 'user.name=GitHub',
    'merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from topic', 'topic');
  // runGate diffs main..HEAD, but here HEAD IS main — check the pushed range from the pre-merge tip.
  const preMerge = git(T, 'rev-parse', 'HEAD^1').toString().trim();
  const out = (() => { try { return execFileSync('bash', [GATE, preMerge], { cwd: T, stdio: 'pipe' }).toString(); }
    catch (e) { return (e.stdout || '').toString() + `\nEXIT ${e.status}`; } })();
  assert.match(out, /merge commit — allowlist waived/, out);
  assert.doesNotMatch(out, /unverified user/, 'the merger email must NOT fail the allowlist');
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

test('doctor: warns on an open review PR recorded on the default branch (pre-3.0 migration guard)', async () => {
  const { T } = scaffold();
  const ep = path.join(T, 'epics/EP-mig/.sdlc');
  fs.mkdirSync(ep, { recursive: true });
  const writeState = (reviewStatus) => fs.writeFileSync(path.join(ep, 'state.json'), JSON.stringify({
    epicId: 'EP-mig', currentStep: 'epic-review',
    steps: [
      { id: 'epic', type: 'author', artifact: 'epic.md', status: 'done' },
      { id: 'epic-review', type: 'review+approve', artifact: 'epic.md', status: reviewStatus },
    ],
  }));
  writeState('in_review');
  fs.writeFileSync(path.join(ep, 'hub-prs.json'), JSON.stringify([
    { step: 'epic-review', artifact: 'epic.md', platform: 'github', number: 7, branch: 'review/EP-mig/epic' },
  ]));
  const r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'epic:EP-mig:migration' && x.status === 'warn'), 'open review PR on the default branch warns');
  // once the review step is done, the recorded PR is historical — no warning.
  writeState('done');
  const r2 = await doctorOn(T);
  assert.ok(!r2.checks.some((x) => x.id === 'epic:EP-mig:migration'), 'a done review does not warn');
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

test('doctor: hub with a platform but no git_url warns YAD-CFG-005 (not a misleading YAD-ENV-002)', async () => {
  const { T } = scaffold();
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge_enabled: true, roster: [] }));
  await reconcile(T, { fix: true });
  const r = await doctorOn(T);
  assert.ok(r.checks.some((x) => x.id === 'hub-git-url' && x.status === 'warn' && /YAD-CFG-005/.test(x.message)), 'missing git_url must warn YAD-CFG-005');
  assert.equal(r.failed, 0, 'the warning must never be a failure');
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: hub with git_url present emits no hub-git-url warning', async () => {
  const { T } = scaffold();
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge_enabled: true, roster: [], git_url: 'https://gitlab.com/acme/hub.git' }));
  await reconcile(T, { fix: true });
  const r = await doctorOn(T);
  assert.ok(!r.checks.some((x) => x.id === 'hub-git-url'), 'a present git_url is silent');
  fs.rmSync(T, { recursive: true, force: true });
});

test('doctor: no resolvable host (no git_url, no origin) skips the auth probe — never a fail', async () => {
  const { T } = scaffold();
  // scaffold's T has no origin remote, so neither git_url nor origin can resolve a host.
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge_enabled: true, roster: [] }));
  await reconcile(T, { fix: true });
  const r = await doctorOn(T);
  const pc = r.checks.find((x) => x.id === 'platform-cli');
  assert.ok(pc && pc.status !== 'fail', 'the auth check must be skipped/warned, never failed');
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
  assert.match(gh, /deploy-pages@v5/);
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
  // the guided tutorial site mounts under public/tutorial (peer of the overview app)
  assert.match(gh, /docs\/tutorial-site/);
  assert.match(gh, /public\/tutorial/);
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

// ---- artifact-status: derive frontmatter status from state.json + sweep ----------------------
const { desiredStatus, setFrontmatterStatus, syncStatuses } = await import('./artifact-status.mjs');

test('desiredStatus derives draft/in-review/approved from the step pair', () => {
  const state = {
    steps: [
      { id: 'epic', type: 'author', artifact: 'epic.md', status: 'done' },
      { id: 'epic-review', type: 'review+approve', artifact: 'epic.md', status: 'done' },
      { id: 'architecture', type: 'author', artifact: 'architecture.md', status: 'done' },
      { id: 'architecture-review', type: 'review+approve', artifact: 'architecture.md', status: 'in_review' },
      { id: 'ui-design', type: 'author', artifact: 'ui-design.md', status: 'in_progress' },
      { id: 'ui-design-review', type: 'review+approve', artifact: 'ui-design.md', status: 'blocked' },
      { id: 'stories', type: 'author', artifact: 'stories/', status: 'done' },
      { id: 'stories-review', type: 'review+approve', artifact: 'stories/', status: 'done' },
    ],
  };
  assert.equal(desiredStatus(state, 'epic'), 'approved');
  assert.equal(desiredStatus(state, 'architecture'), 'in-review');
  assert.equal(desiredStatus(state, 'ui-design'), 'draft');
  assert.equal(desiredStatus(state, 'stories'), 'approved'); // story files key off the stories pair
  assert.equal(desiredStatus(state, 'contract'), null);      // contract has no own step
  assert.equal(desiredStatus({}, 'epic'), null);             // no steps -> nothing to manage
});

test('setFrontmatterStatus is advance-only and preserves owned values', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-fa-'));
  const f = path.join(T, 'a.md');
  const write = (s) => fs.writeFileSync(f, `---\nid: EP-x\nstatus: ${s}\nrepos: [backend]\n---\n# body\n`);
  const read = () => (fs.readFileSync(f, 'utf8').match(/^status:\s*(.*)$/m) || [])[1];

  write('draft');
  assert.equal(setFrontmatterStatus(f, 'approved'), 'draft'); // advance
  assert.equal(read(), 'approved');
  assert.ok(/repos: \[backend\]/.test(fs.readFileSync(f, 'utf8')), 'other frontmatter preserved');

  write('approved');
  assert.equal(setFrontmatterStatus(f, 'in-review'), null);   // never regress
  assert.equal(read(), 'approved');

  write('locked');
  assert.equal(setFrontmatterStatus(f, 'approved'), null);    // owned value untouched
  assert.equal(read(), 'locked');

  write('shipped');
  assert.equal(setFrontmatterStatus(f, 'approved'), null);    // build-owned value untouched
  assert.equal(read(), 'shipped');

  fs.writeFileSync(f, '# no frontmatter\n');
  assert.equal(setFrontmatterStatus(f, 'approved'), null);    // no block -> no-op
  assert.equal(setFrontmatterStatus(path.join(T, 'missing.md'), 'approved'), null);
  fs.rmSync(T, { recursive: true, force: true });
});

test('syncStatuses sweeps every epic, honors dry-run, and is idempotent', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ss-'));
  const dir = path.join(T, 'epics/EP-x');
  fs.mkdirSync(path.join(dir, '.sdlc'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'stories'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-x', currentStep: 'ready-for-build', steps: [
      { id: 'epic', type: 'author', artifact: 'epic.md', status: 'done' },
      { id: 'epic-review', type: 'review+approve', artifact: 'epic.md', status: 'done' },
      { id: 'stories', type: 'author', artifact: 'stories/', status: 'done' },
      { id: 'stories-review', type: 'review+approve', artifact: 'stories/', status: 'done' },
    ],
  }));
  const fm = (a, s) => `---\nid: EP-x\nartifact: ${a}\nstatus: ${s}\n---\n# x\n`;
  fs.writeFileSync(path.join(dir, 'epic.md'), fm('epic', 'draft'));
  fs.writeFileSync(path.join(dir, 'contract.md'), fm('contract', 'locked'));
  fs.writeFileSync(path.join(dir, 'stories/EP-x-S01.md'), fm('EP-x-S01', 'draft'));
  fs.writeFileSync(path.join(dir, 'stories/EP-x-S02.md'), fm('EP-x-S02', 'shipped'));

  const dry = await syncStatuses(T, { dryRun: true });
  assert.equal(dry.changed, 2, 'dry-run counts epic.md + S01, not the locked/shipped files');
  assert.match(fs.readFileSync(path.join(dir, 'epic.md'), 'utf8'), /status: draft/, 'dry-run writes nothing');

  const run = await syncStatuses(T, {});
  assert.equal(run.changed, 2);
  assert.match(fs.readFileSync(path.join(dir, 'epic.md'), 'utf8'), /status: approved/);
  assert.match(fs.readFileSync(path.join(dir, 'stories/EP-x-S01.md'), 'utf8'), /status: approved/);
  assert.match(fs.readFileSync(path.join(dir, 'contract.md'), 'utf8'), /status: locked/);
  assert.match(fs.readFileSync(path.join(dir, 'stories/EP-x-S02.md'), 'utf8'), /status: shipped/);

  const again = await syncStatuses(T, {});
  assert.equal(again.changed, 0, 'second run is a no-op');
  fs.rmSync(T, { recursive: true, force: true });
});

test('syncStatuses reconciles the discovery set: draft → approved once discovery-review is done', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ssd-'));
  const dir = path.join(T, 'epics/EP-discovery');
  fs.mkdirSync(path.join(dir, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-discovery', kind: 'discovery', currentStep: 'discovery-done', steps: [
      { id: 'discovery', type: 'author', artifact: 'discovery/', status: 'done' },
      { id: 'discovery-review', type: 'review+approve', artifact: 'discovery/', status: 'done' },
    ],
  }));
  const fm = (a, s) => `---\nid: EP-discovery\nartifact: ${a}\nstatus: ${s}\n---\n# x\n`;
  fs.writeFileSync(path.join(dir, 'roadmap.md'), fm('roadmap', 'draft'));
  fs.writeFileSync(path.join(dir, 'requirements.md'), fm('requirements', 'draft'));
  fs.writeFileSync(path.join(dir, 'market-research.md'), fm('market-research', 'draft'));

  const run = await syncStatuses(T, {});
  assert.equal(run.changed, 3, 'all three present discovery files advance together');
  assert.match(fs.readFileSync(path.join(dir, 'roadmap.md'), 'utf8'), /status: approved/);
  assert.match(fs.readFileSync(path.join(dir, 'requirements.md'), 'utf8'), /status: approved/);
  assert.equal((await syncStatuses(T, {})).changed, 0, 'second run is a no-op');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---- yad report (self issue reporter) ----------------------------------------------------------
const { scrub, sanitizeArgv, sanitizeContext, buildBody, buildTitle, runReport } = await import('./report.mjs');
const { UPSTREAM_REPO } = await import('./manifest.mjs');

test('scrub removes paths, emails, and URLs from free text', () => {
  const s = scrub('failed at /Users/amn/secret/.sdlc/hub.json for ceo@acme.com see https://gitlab.com/acme/backend and git@github.com:acme/x.git');
  assert.ok(!s.includes('/Users/amn'), 'unix path scrubbed');
  assert.ok(!s.includes('ceo@acme.com'), 'email scrubbed');
  assert.ok(!s.includes('gitlab.com/acme'), 'https url scrubbed');
  assert.ok(!s.includes('github.com:acme'), 'ssh remote scrubbed');
});

test('scrub removes branch refs / IDs, hostnames, IPs, ssh:// URLs, and UNC paths', () => {
  const refs = scrub('branch feat/EP-secret-story exists; cannot push to origin/feature-secret; see EP-topsecret');
  for (const leak of ['feat/EP-secret-story', 'EP-secret-story', 'origin/feature-secret', 'EP-topsecret', 'feature-secret']) {
    assert.ok(!refs.includes(leak), `ref/id leak: ${leak}`);
  }
  const net = scrub('getaddrinfo ENOTFOUND gitlab.internal.acme.com; ECONNREFUSED 10.1.2.3:5432; ssh://git@vcs.internal.acme.com/team/secret.git');
  for (const leak of ['gitlab.internal.acme.com', '10.1.2.3', 'vcs.internal.acme.com']) {
    assert.ok(!net.includes(leak), `network leak: ${leak}`);
  }
  assert.ok(!scrub('cannot open \\\\FILESERVER\\share\\hub.json').includes('FILESERVER'), 'UNC host scrubbed');
  // standard 2-label filenames are NOT over-redacted — the message stays useful
  assert.match(scrub('corrupt JSON in hub.json'), /hub\.json/);
});

test('sanitizeArgv keeps the verb chain + flag names, drops IDs/paths/values', () => {
  const out = sanitizeArgv(['gate', 'sync', 'EP-secret-epic', '--dir', '/Users/amn/x', '-m', 'my secret message', '--repo', 'backend-private']);
  assert.equal(out, 'gate sync --dir -m --repo');
  assert.ok(!out.includes('EP-secret-epic') && !out.includes('/Users') && !out.includes('secret') && !out.includes('backend-private'));
});

test('sanitizeArgv drops lowercase positional args — logins, repo names, roles', () => {
  assert.equal(sanitizeArgv(['roster', 'add', 'joesmith']), 'roster add');
  assert.equal(sanitizeArgv(['roster', 'grant', 'alice', 'backend-private', 'owner']), 'roster grant');
  assert.equal(sanitizeArgv(['repo', 'refresh', 'backend-private']), 'repo refresh');
  const g = sanitizeArgv(['roster', 'grant', 'alice', 'backend-private', 'owner']);
  for (const leak of ['joesmith', 'alice', 'backend-private', 'owner']) assert.ok(!g.includes(leak), `argv leak: ${leak}`);
});

test('report body carries ONLY the safe allowlist — no private data leaks', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-report-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github',
    git_url: 'https://github.com/acme/private-repo.git',
    roster: [{ login: 'topsecretuser', email: 'ceo@acme.com', role: 'owner' }],
  }));
  const error = {
    code: 'YAD-STATE-001',
    message: 'corrupt JSON in /Users/amn/private/.sdlc/hub.json: bad token',
    hint: 'restore /Users/amn/private/.sdlc/hub.json from git',
  };
  // A roster command whose positionals are a login + repo + role (the lowercase-positional vector).
  const argv = ['roster', 'grant', 'topsecretuser', 'backend-private', 'owner', '--dir', '/Users/amn/private'];
  const ctx = sanitizeContext(T, { error, argv });
  const body = buildBody(ctx, scrub('branch feat/EP-secret failed on gitlab.internal.acme.com and 10.1.2.3'));
  const title = buildTitle(ctx, '');
  for (const leak of ['/Users/amn', 'private-repo', 'topsecretuser', 'backend-private', 'ceo@acme.com',
    'EP-secret', 'github.com/acme', 'private/.sdlc', 'feat/EP-secret', 'gitlab.internal.acme.com', '10.1.2.3']) {
    assert.ok(!body.includes(leak), `body must not leak "${leak}"`);
    assert.ok(!title.includes(leak), `title must not leak "${leak}"`);
  }
  // ...but the safe facts ARE present.
  assert.match(body, /YAD-STATE-001/);
  assert.match(body, /platform: github/);
  assert.match(body, /yad roster grant --dir/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('report: dedup offers an existing issue and never files a duplicate', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-report-'));
  let filed = false;
  const r = await runReport(T, {
    error: { code: 'YAD-STATE-001', message: 'boom' },
    interactive: true,
    asker: async () => '',
    prompter: async () => true, // "open an existing issue instead?" → yes
    searcher: () => ({ ok: true, matches: [{ number: 42, title: 'existing', url: 'http://x/42' }] }),
    filer: () => { filed = true; return { ok: true, url: 'http://x/new' }; },
    opener: () => {},
    authed: () => true,
  });
  assert.equal(filed, false, 'no duplicate filed');
  assert.equal(r.deduped, true);
  assert.equal(r.url, 'http://x/42');
  fs.rmSync(T, { recursive: true, force: true });
});

test('report: files directly via an authenticated CLI', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-report-'));
  let call = null;
  const r = await runReport(T, {
    message: 'something broke',
    interactive: true,
    asker: async () => '',
    prompter: async () => true, // "post this now?" → yes
    searcher: () => ({ ok: true, matches: [] }),
    filer: (platform, repo, payload) => { call = { platform, repo, payload }; return { ok: true, url: 'http://issue/1' }; },
    opener: () => {},
    authed: () => true,
  });
  assert.equal(r.filed, true);
  assert.equal(r.url, 'http://issue/1');
  assert.equal(call.repo, UPSTREAM_REPO);
  assert.deepEqual(call.payload.labels, ['bug']);
  assert.match(call.payload.body, /something broke/);
  fs.rmSync(T, { recursive: true, force: true });
});

test('report: falls back to a prefilled URL when the CLI is not authenticated', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-report-'));
  let opened = null;
  const r = await runReport(T, {
    message: 'broke',
    interactive: true,
    asker: async () => '',
    prompter: async () => true,
    searcher: () => ({ ok: true, matches: [] }),
    filer: () => { throw new Error('must not file when unauthenticated'); },
    opener: (url) => { opened = url; },
    authed: () => false,
  });
  assert.equal(r.filed, false);
  assert.ok(r.url.startsWith(`https://github.com/${UPSTREAM_REPO}/issues/new?`), 'prefilled issues/new URL');
  assert.equal(opened, r.url, 'opened the fallback URL');
  fs.rmSync(T, { recursive: true, force: true });
});

test('report: non-interactive never posts — hands back a prefilled URL', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-report-'));
  const r = await runReport(T, {
    error: { code: 'YAD-ENV-001', message: 'no git' },
    interactive: false,
    asker: async () => { throw new Error('must not prompt'); },
    prompter: async () => { throw new Error('must not prompt'); },
    searcher: () => ({ ok: false, matches: [] }),
    filer: () => { throw new Error('must not file'); },
    opener: () => {},
    authed: () => true,
  });
  assert.equal(r.filed, false);
  assert.ok(r.url.includes('/issues/new?'));
  fs.rmSync(T, { recursive: true, force: true });
});

// ---- yad usage (derived team-member behavior report) --------------------------------------------
const { buildModel, renderHtml, renderMarkdown, deriveEvents } = await import('./usage.mjs');

// Scaffold a hub dir with a roster + one epic's ledgers (no git repo — git-authored events degrade to
// []). `dormant` is in the roster with no activity so we can assert it surfaces at zero.
function usageFixture() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-usage-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github',
    roster: [
      { login: 'al', name: 'alice', email: 'alice@corp.io', roles: { hub: ['reviewer'] } },
      { login: 'bo', name: 'bob', role: 'owner' },
      { login: 'dg', name: 'dormant', roles: { hub: ['reviewer'] } },
    ],
  }));
  const ep = path.join(T, 'epics/EP-x/.sdlc');
  fs.mkdirSync(ep, { recursive: true });
  fs.writeFileSync(path.join(ep, 'approvals.json'), JSON.stringify([
    { artifact: 'epic.md', step: 'epic-review', approver: 'alice', role: 'reviewer', status: 'approved', date: '2026-01-10' },
    { artifact: 'stories/', step: 'stories-review', approver: 'alice', role: 'reviewer', status: 'approved', date: '2026-05-20' },
  ]));
  fs.writeFileSync(path.join(ep, 'comments.json'), JSON.stringify([
    { artifact: 'epic.md', step: 'epic-review', commenter: 'bob', role: 'owner', round: 1, count: 3, date: '2026-01-11' },
  ]));
  fs.writeFileSync(path.join(ep, 'build-log.json'), JSON.stringify({
    epic: 'EP-x', ships: [
      { story: 'EP-x-S01', task: 'T01', repo: 'backend', engineer_review: [{ approver: 'bob', role: 'owner' }], risk: 'low', shippedAt: '2026-01-12' },
      { story: 'EP-x-S02', task: 'T02', repo: 'backend', engineer_review: [], risk: 'high', shippedAt: '2026-01-13' },
    ],
  }));
  return T;
}

test('usage: attributes ledger events to roster members; dormant member surfaces at zero', () => {
  const T = usageFixture();
  const model = buildModel(T, {});
  const by = Object.fromEntries(model.members.map((m) => [m.name, m]));
  assert.equal(by.alice.counts.approved, 2, 'alice has both approvals all-time');
  assert.equal(by.bob.counts.commented, 1, 'bob commented once');
  assert.equal(by.bob.counts.shipped, 1, 'bob has one engineer-review ship');
  assert.equal(by.dormant.total, 0, 'dormant member is present with zero activity');
  assert.ok(by.dormant.flags.includes('dormant'), 'dormant flag raised');
  assert.equal(model.totals.approved, 2);
  fs.rmSync(T, { recursive: true, force: true });
});

test('usage: --since/--until window trims out-of-range events', () => {
  const T = usageFixture();
  const jan = buildModel(T, { since: '2026-01-01', until: '2026-01-31' });
  const alice = jan.members.find((m) => m.name === 'alice');
  assert.equal(alice.counts.approved, 1, 'only the January approval is in range (May excluded)');
  fs.rmSync(T, { recursive: true, force: true });
});

test('usage: --member filters to one person', () => {
  const T = usageFixture();
  const model = buildModel(T, { member: 'alice' });
  assert.equal(model.members.length, 1);
  assert.equal(model.members[0].name, 'alice');
  fs.rmSync(T, { recursive: true, force: true });
});

test('usage: a ship with no engineer review is flagged as a hygiene gap', () => {
  const T = usageFixture();
  const model = buildModel(T, {});
  assert.equal(model.hygiene.length, 1, 'exactly the empty-review ship');
  assert.equal(model.hygiene[0].story, 'EP-x-S02');
  assert.equal(model.hygiene[0].shippedAt, '2026-01-13');
  fs.rmSync(T, { recursive: true, force: true });
});

test('usage: rendered output never leaks emails or comment bodies', () => {
  const T = usageFixture();
  const model = buildModel(T, {});
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  assert.ok(!emailRe.test(renderHtml(model, '2026-07-02')), 'no email in HTML');
  assert.ok(!emailRe.test(renderMarkdown(model, '2026-07-02')), 'no email in Markdown');
  assert.ok(!emailRe.test(JSON.stringify(model)), 'no email in JSON model');
  fs.rmSync(T, { recursive: true, force: true });
});

test('usage: same fixture derives a byte-identical JSON model (deterministic)', () => {
  const T = usageFixture();
  const a = JSON.stringify(buildModel(T, { since: '2026-01-01', until: '2026-12-31' }), null, 2);
  const b = JSON.stringify(buildModel(T, { since: '2026-01-01', until: '2026-12-31' }), null, 2);
  assert.equal(a, b, 'no wall-clock / unstable ordering in the model');
  fs.rmSync(T, { recursive: true, force: true });
});

test('usage: deriveEvents degrades to [] when the hub is not a git repo', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-usage-nogit-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', roster: [] }));
  const events = deriveEvents(T, { byNameOrLogin: () => null, byGitAuthor: () => null }, {});
  assert.deepEqual(events, [], 'no epics, no git — empty stream, no throw');
  fs.rmSync(T, { recursive: true, force: true });
});

// --- review-follow-up fixes: reviewer-any-scope, corrupt-ledger warn, --out mkdir, --member totals ---
const { isReviewerAnywhere, runUsage } = await import('./usage.mjs');

test('usage: isReviewerAnywhere detects repo-scoped, hub-scoped, and legacy reviewer roles', () => {
  assert.equal(isReviewerAnywhere({ roles: { backend: ['reviewer'] } }), true, 'repo-scoped reviewer');
  assert.equal(isReviewerAnywhere({ roles: { hub: ['reviewer'] } }), true, 'hub-scoped reviewer');
  assert.equal(isReviewerAnywhere({ role: 'reviewer' }), true, 'legacy flat role');
  assert.equal(isReviewerAnywhere({ roles: { backend: ['domain-owner'] }, role: 'owner' }), false, 'owner/domain-owner only');
  assert.equal(isReviewerAnywhere(null), false, 'no entry');
});

test('usage: a corrupt ledger warns and is skipped, never throws or under-counts other ledgers', () => {
  const T = usageFixture();
  fs.writeFileSync(path.join(T, 'epics/EP-x/.sdlc/approvals.json'), '{ this is not json');
  let model;
  assert.doesNotThrow(() => { model = buildModel(T, {}); }, 'one corrupt ledger does not abort the view');
  // approvals are gone (the file was unreadable) but comments/ships from the other ledgers survive.
  const bob = model.members.find((m) => m.name === 'bob');
  assert.equal(bob.counts.commented, 1, 'the intact comments ledger still counts');
  assert.equal(bob.counts.shipped, 1, 'the intact build-log still counts');
  fs.rmSync(T, { recursive: true, force: true });
});

test('usage: runUsage --out creates missing parent directories', () => {
  const T = usageFixture();
  const dest = path.join(T, 'nested/deep/report.html');
  runUsage(T, { out: dest, all: true });
  assert.ok(fs.existsSync(dest), 'report written into a directory that did not exist');
  fs.rmSync(T, { recursive: true, force: true });
});

test('usage: --member recomputes totals to the shown member only', () => {
  const T = usageFixture();
  const model = buildModel(T, { member: 'alice' });
  assert.equal(model.members.length, 1);
  assert.equal(model.totals.approved, 2, "totals reflect only alice's approvals");
  assert.equal(model.totals.commented, 0, "bob's comment is excluded from the filtered totals");
  fs.rmSync(T, { recursive: true, force: true });
});

// --- CodeRabbit PR#98 follow-ups: legacy array roles + Markdown cell escaping ---
const { renderMarkdown: renderMd } = await import('./usage.mjs');

test('usage: isReviewerAnywhere handles the legacy hub-scope roles array (rolesForScope shape)', () => {
  assert.equal(isReviewerAnywhere({ roles: ['reviewer'] }), true, 'roles: ["reviewer"] is a hub reviewer');
  assert.equal(isReviewerAnywhere({ roles: ['owner'] }), false, 'roles: ["owner"] is not a reviewer');
});

test('usage: renderMarkdown escapes pipes/newlines so table structure survives hostile names', () => {
  const model = {
    window: { since: null, until: null }, generatedFrom: 'derived',
    members: [{ name: 'a|b\nc', login: 'x|y', role: 'rev|iewer', rostered: true, counts: { authored: 0, commented: 0, approved: 0, shipped: 0, committed: 0 }, total: 0, firstActive: null, lastActive: null, epics: [], flags: ['dor|mant'], timeline: [] }],
    totals: { authored: 0, commented: 0, approved: 0, shipped: 0, committed: 0 },
    hygiene: [{ epic: 'EP-a|b', story: 'S0\n1', task: 'T|1', repo: 'back|end', shippedAt: '2026-01-01' }],
  };
  const md = renderMd(model, '2026-07-02');
  // The single data row must not spawn extra columns: raw '|' escaped, newline flattened to a space.
  const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('|---') && !l.startsWith('| member'));
  assert.equal(rows.length, 1, 'exactly one data row (no newline split it in two)');
  assert.ok(rows[0].includes('a\\|b'), 'pipe in the name is escaped');
  assert.ok(!rows[0].includes('a|b'), 'no raw pipe leaks into the cell');
  assert.ok(!md.includes('S0\n1'), 'newline in a hygiene value is flattened');
});

// ---------------------------------------------------------------------------------------------
// yad checkpoint — commit the machine-written back-half hub state (trust-log/build-log/build-state)
// ---------------------------------------------------------------------------------------------
const {
  runCheckpoint, backHalfPathspecs, storyStatusPathspecs, stagedStoryIsStatusOnly, summarizeStaged, checkpointAuthor, buildCheckpointMessage,
} = await import('./checkpoint.mjs');
const { hubGit } = await import('./hubcommit.mjs');

// A hub (carries .sdlc/hub.json with a roster) on the default branch, with a seed commit so HEAD
// exists. The roster email matches the git identity so resolveCommitterLogin yields @abdelrahmannasr.
function hubForCheckpoint() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ckpt-'));
  git(T, 'init', '-q');
  git(T, 'config', 'user.email', 'a.nasr@x.com');
  git(T, 'config', 'user.name', 'abdelrahman');
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({
    platform: 'github', default_branch: 'main',
    roster: [{ login: 'abdelrahmannasr', name: 'abdelrahman', email: 'a.nasr@x.com', role: 'owner' }],
  }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [] }));
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'seed');
  git(T, 'branch', '-q', '-M', 'main');
  return T;
}

// Dirty the back-half ledgers for one story, plus a FRONT-half state.json that checkpoint must never
// stage (it is the CI-owned ledger guarded by ledger-guard).
function writeBackHalf(T, epic, story) {
  const sdlc = path.join(T, 'epics', epic, '.sdlc');
  fs.mkdirSync(path.join(sdlc, 'build-state'), { recursive: true });
  fs.writeFileSync(path.join(sdlc, 'trust-log.json'), JSON.stringify({ epic, runs: [] }));
  fs.writeFileSync(path.join(sdlc, 'build-state', `${story}.json`), JSON.stringify({ story }));
  fs.writeFileSync(path.join(sdlc, 'state.json'), JSON.stringify({ step: 'x' })); // front-half — must stay out
}

test('summarizeStaged labels one story, N stories, or the epic when only ledgers changed', () => {
  const one = summarizeStaged(['epics/EP-a/.sdlc/trust-log.json', 'epics/EP-a/.sdlc/build-state/EP-a-S03.json']);
  assert.equal(one.label, 'EP-a/EP-a-S03');
  assert.deepEqual(one.basenames, ['trust-log.json', 'build-state/EP-a-S03.json']);
  assert.equal(summarizeStaged(['epics/EP-a/.sdlc/build-state/EP-a-S01.json', 'epics/EP-a/.sdlc/build-state/EP-a-S02.json']).label, '2 stories');
  assert.equal(summarizeStaged(['epics/EP-a/.sdlc/trust-log.json']).label, 'EP-a'); // no build-state => epic-level
  assert.equal(summarizeStaged(['epics/EP-a/.sdlc/build-log.json', 'epics/EP-b/.sdlc/build-log.json']).label, '2 epics');
});

test('checkpointAuthor prefers the @login, falls back to git name, then a placeholder', () => {
  assert.equal(checkpointAuthor('abdelrahmannasr', 'abdelrahman'), '@abdelrahmannasr');
  assert.equal(checkpointAuthor(null, 'abdelrahman'), 'abdelrahman');
  assert.equal(checkpointAuthor(null, '   '), 'unknown');
});

test('buildCheckpointMessage: chore(hub) subject, no trailing period, no AI footer, body lists files', () => {
  const msg = buildCheckpointMessage({
    label: 'EP-a/EP-a-S03', author: '@abdelrahmannasr',
    basenames: ['trust-log.json', 'build-state/EP-a-S03.json'],
  });
  assert.equal(msg.split('\n')[0], 'chore(hub): sync back-half state — EP-a/EP-a-S03 by @abdelrahmannasr [skip ci]');
  assert.ok(!/\.$/.test(msg.split('\n')[0]), 'subject must not end with a period');
  assert.ok(!/Co-Authored-By/.test(msg), 'no AI co-author footer');
  assert.match(msg, /\nUpdated: trust-log\.json, build-state\/EP-a-S03\.json$/);
});

test('backHalfPathspecs lists only the back-half ledgers that exist — never the front-half', () => {
  const T = hubForCheckpoint();
  writeBackHalf(T, 'EP-a', 'EP-a-S03');
  const specs = backHalfPathspecs(T);
  assert.ok(specs.includes('epics/EP-a/.sdlc/trust-log.json'));
  assert.ok(specs.includes('epics/EP-a/.sdlc/build-state'));
  assert.ok(!specs.some((s) => s.endsWith('build-log.json')), 'absent build-log is not listed');
  assert.ok(!specs.some((s) => s.endsWith('state.json')), 'front-half state.json is never listed');
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint commits ONLY the back-half ledgers with a chore(hub) audit subject', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  writeBackHalf(T, 'EP-istifta-inquiries', 'EP-istifta-inquiries-S03');
  await grab(() => runCheckpoint(T, {}));
  const subject = git(T, 'log', '-1', '--format=%s').toString().trim();
  assert.equal(subject, 'chore(hub): sync back-half state — EP-istifta-inquiries/EP-istifta-inquiries-S03 by @abdelrahmannasr [skip ci]');
  const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString().trim().split('\n').filter(Boolean);
  assert.ok(files.length && files.every((f) => /\.sdlc\/(trust-log\.json|build-log\.json|build-state\/)/.test(f)), `only back-half: ${files.join()}`);
  assert.ok(!files.some((f) => f.endsWith('state.json')), 'front-half state.json must not be committed');
  assert.ok(fs.existsSync(path.join(T, 'epics/EP-istifta-inquiries/.sdlc/state.json')), 'state.json still present, uncommitted');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint commits ONLY the allowlist even when an unrelated file is already staged', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  writeBackHalf(T, 'EP-a', 'EP-a-S01');
  fs.writeFileSync(path.join(T, 'unrelated.txt'), 'hi'); // stage something outside the allowlist
  git(T, 'add', 'unrelated.txt');
  await grab(() => runCheckpoint(T, {}));
  const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString().trim().split('\n').filter(Boolean);
  assert.ok(!files.includes('unrelated.txt'), 'the unrelated staged file must not ride in the checkpoint commit');
  assert.ok(files.every((f) => f.startsWith('epics/')), `only back-half files committed: ${files.join()}`);
  assert.equal(git(T, 'diff', '--cached', '--name-only').toString().trim(), 'unrelated.txt', 'the unrelated file stays staged, uncommitted');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint is a clean no-op when nothing changed', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  writeBackHalf(T, 'EP-a', 'EP-a-S01');
  await grab(() => runCheckpoint(T, {}));
  const head1 = git(T, 'rev-parse', 'HEAD').toString().trim();
  const out = await grab(() => runCheckpoint(T, {}));
  assert.equal(git(T, 'rev-parse', 'HEAD').toString().trim(), head1, 'no new commit on a clean tree');
  assert.match(out, /unchanged/);
  assert.ok(!process.exitCode, 'a no-op does not set a non-zero exit code');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint refuses off the default branch, and --allow-branch overrides', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  git(T, 'checkout', '-q', '-b', 'wip/side');
  writeBackHalf(T, 'EP-a', 'EP-a-S01');
  const before = git(T, 'rev-parse', 'HEAD').toString().trim();
  const out = await grab(() => runCheckpoint(T, {}));
  assert.match(out, /not the default branch/);
  assert.ok(process.exitCode, 'the guard sets a non-zero exit code');
  assert.equal(git(T, 'rev-parse', 'HEAD').toString().trim(), before, 'nothing committed while blocked');
  process.exitCode = 0;
  await grab(() => runCheckpoint(T, { allowBranch: true }));
  assert.notEqual(git(T, 'rev-parse', 'HEAD').toString().trim(), before, '--allow-branch lets the commit land');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint --dry-run prints the message but commits nothing and leaves the index clean', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  writeBackHalf(T, 'EP-a', 'EP-a-S01');
  const head0 = git(T, 'rev-parse', 'HEAD').toString().trim();
  const out = await grab(() => runCheckpoint(T, { dryRun: true }));
  assert.match(out, /chore\(hub\): sync back-half state/);
  assert.equal(git(T, 'rev-parse', 'HEAD').toString().trim(), head0, 'dry run makes no commit');
  assert.equal(git(T, 'diff', '--cached', '--name-only').toString().trim(), '', 'dry run leaves the index clean');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint --push lands the commit on the bare remote default branch', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ckpt-bare-'));
  git(bare, 'init', '-q', '--bare');
  git(T, 'remote', 'add', 'origin', bare);
  git(T, 'push', '-q', 'origin', 'main');
  writeBackHalf(T, 'EP-a', 'EP-a-S01');
  await grab(() => runCheckpoint(T, { push: true }));
  assert.equal(
    git(T, 'rev-parse', 'HEAD').toString().trim(),
    git(bare, 'rev-parse', 'main').toString().trim(),
    'the checkpoint commit is on origin/main',
  );
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
});

test('runCheckpoint aborts on a non-hub dir (no .sdlc/hub.json)', async () => {
  const prev = process.exitCode;
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ckpt-nohub-'));
  git(T, 'init', '-q');
  const out = await grab(() => runCheckpoint(T, {}));
  assert.match(out, /no \.sdlc\/hub\.json/);
  assert.ok(process.exitCode, 'a non-hub dir sets a non-zero exit code');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

// --- #112: checkpoint carries the build-log-backed story `status:` flip ---

// Write stories/<story>.md with a `status:` frontmatter, and (unless ship===false) a build-log ship
// for that story — the two conditions storyStatusPathspecs gates on. The ship goes in a per-story
// shard (build-log/<story>-<task>-<repo>.json) so multiple stories in one epic accumulate instead of
// clobbering a shared build-log.json.
function writeStory(T, epic, story, status, { ship = true } = {}) {
  const epicDir = path.join(T, 'epics', epic);
  fs.mkdirSync(path.join(epicDir, 'stories'), { recursive: true });
  fs.writeFileSync(path.join(epicDir, 'stories', `${story}.md`), `---\nstatus: ${status}\nrepos: [web]\n---\n\n# ${story}\n`);
  if (ship) {
    fs.mkdirSync(path.join(epicDir, '.sdlc/build-log'), { recursive: true });
    fs.writeFileSync(path.join(epicDir, '.sdlc/build-log', `${story}-T01-web.json`),
      JSON.stringify({ story, task: 'T01', repo: 'web' }));
  }
}

test('storyStatusPathspecs lists ONLY ship-backed stories at a back-half status', () => {
  const T = hubForCheckpoint();
  writeStory(T, 'EP-a', 'EP-a-S01', 'shipped');           // ship + shipped ⇒ carried
  writeStory(T, 'EP-a', 'EP-a-S02', 'in-build');          // ship + in-build ⇒ carried
  writeStory(T, 'EP-a', 'EP-a-S03', 'approved');          // ship but front-gate status ⇒ excluded
  writeStory(T, 'EP-b', 'EP-b-S01', 'shipped', { ship: false }); // shipped but no ship evidence ⇒ excluded
  const specs = storyStatusPathspecs(T);
  assert.ok(specs.includes('epics/EP-a/stories/EP-a-S01.md'), 'shipped + ship is carried');
  assert.ok(specs.includes('epics/EP-a/stories/EP-a-S02.md'), 'in-build + ship is carried');
  assert.ok(!specs.includes('epics/EP-a/stories/EP-a-S03.md'), 'approved is a front-gate status, never carried');
  assert.ok(!specs.includes('epics/EP-b/stories/EP-b-S01.md'), 'no build-log ship ⇒ never carried');
  fs.rmSync(T, { recursive: true, force: true });
});

test('summarizeStaged recognizes a carried story file (labels the story, lists its basename)', () => {
  const s = summarizeStaged(['epics/EP-a/.sdlc/build-log.json', 'epics/EP-a/stories/EP-a-S01.md']);
  assert.equal(s.label, 'EP-a/EP-a-S01');
  assert.deepEqual(s.basenames, ['build-log.json', 'EP-a-S01.md']);
});

test('runCheckpoint carries the story status flip (approved → shipped) alongside the ledgers (#112)', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  // Baseline: the story sits at `approved` on the default branch with its ship already recorded.
  writeStory(T, 'EP-a', 'EP-a-S01', 'approved');
  git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed story + build-log');
  // The engineer-review skill flips the frontmatter in the working tree; nothing has committed it yet.
  fs.writeFileSync(path.join(T, 'epics/EP-a/stories/EP-a-S01.md'), `---\nstatus: shipped\nrepos: [web]\n---\n\n# EP-a-S01\n`);
  await grab(() => runCheckpoint(T, {}));
  const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString().trim().split('\n').filter(Boolean);
  assert.deepEqual(files, ['epics/EP-a/stories/EP-a-S01.md'], 'the story flip rides in the checkpoint commit');
  const subject = git(T, 'log', '-1', '--format=%s').toString().trim();
  assert.match(subject, /^chore\(hub\): sync back-half state — EP-a\/EP-a-S01 by @abdelrahmannasr \[skip ci\]$/);
  assert.equal(git(T, 'status', '--porcelain').toString().trim(), '', 'nothing left uncommitted — no raw git-to-main needed');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint does NOT carry a story flip lacking a build-log ship, even while committing ledgers', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  // A story flipped to shipped but with NO ship evidence — must never ride along.
  writeStory(T, 'EP-a', 'EP-a-S09', 'approved', { ship: false });
  git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed unshipped story');
  fs.writeFileSync(path.join(T, 'epics/EP-a/stories/EP-a-S09.md'), `---\nstatus: shipped\nrepos: [web]\n---\n\n# EP-a-S09\n`);
  writeBackHalf(T, 'EP-a', 'EP-a-S01'); // give checkpoint a real ledger change so it commits
  await grab(() => runCheckpoint(T, {}));
  const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString().trim().split('\n').filter(Boolean);
  assert.ok(files.length, 'the ledger change was committed');
  assert.ok(!files.includes('epics/EP-a/stories/EP-a-S09.md'), 'an unshipped story flip must not ride along');
  assert.match(git(T, 'status', '--porcelain').toString(), /EP-a-S09\.md/, 'the unshipped flip stays in the working tree');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('stagedStoryIsStatusOnly: true for a lone status flip, false for a prose edit or a new file', () => {
  const T = hubForCheckpoint();
  const rel = 'epics/EP-a/stories/EP-a-S01.md';
  const abs = path.join(T, rel);
  writeStory(T, 'EP-a', 'EP-a-S01', 'approved');
  git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed');
  const g = hubGit(T); // the production git accessor: returns { ok, stdout, stderr, code }
  // lone status flip
  fs.writeFileSync(abs, `---\nstatus: shipped\nrepos: [web]\n---\n\n# EP-a-S01\n`);
  git(T, 'add', '--', rel);
  assert.equal(stagedStoryIsStatusOnly(g, rel), true, 'a status-only flip is carriable');
  git(T, 'reset', '-q');
  // status flip + a prose edit
  fs.writeFileSync(abs, `---\nstatus: shipped\nrepos: [web]\n---\n\n# EP-a-S01 (reworded)\n`);
  git(T, 'add', '--', rel);
  assert.equal(stagedStoryIsStatusOnly(g, rel), false, 'a prose edit alongside the flip is NOT carriable');
  git(T, 'reset', '-q');
  // a brand-new (untracked→added) story file: every line is an addition ⇒ not status-only
  const rel2 = 'epics/EP-a/stories/EP-a-S02.md';
  fs.writeFileSync(path.join(T, rel2), `---\nstatus: shipped\nrepos: [web]\n---\n\n# EP-a-S02\n`);
  git(T, 'add', '--', rel2);
  assert.equal(stagedStoryIsStatusOnly(g, rel2), false, 'a newly-added story file is NOT status-only');
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint drops a ship-backed story whose change is MORE than the status line (review-bypass guard)', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  writeStory(T, 'EP-a', 'EP-a-S01', 'approved');
  git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed');
  // The flip AND an unrelated prose edit in the same file — the prose must NOT ride a [skip ci] commit.
  fs.writeFileSync(path.join(T, 'epics/EP-a/stories/EP-a-S01.md'), `---\nstatus: shipped\nrepos: [web]\n---\n\n# EP-a-S01 — secretly reworded\n`);
  writeBackHalf(T, 'EP-a', 'EP-a-S02'); // a real ledger change so checkpoint still commits something
  const out = await grab(() => runCheckpoint(T, {}));
  const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString().trim().split('\n').filter(Boolean);
  assert.ok(!files.includes('epics/EP-a/stories/EP-a-S01.md'), 'the mixed prose+status edit must not ride the chore commit');
  assert.ok(files.some((f) => f.includes('.sdlc/')), 'the ledger change still committed');
  assert.match(out, /skipped .*EP-a-S01\.md/);
  assert.match(git(T, 'status', '--porcelain').toString(), /EP-a-S01\.md/, 'the mixed edit stays in the working tree for review');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint: a corrupt build-log in one epic does not block checkpointing another epic', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  // EP-bad has a corrupt folded build-log; EP-ok has a clean ledger change to checkpoint.
  fs.mkdirSync(path.join(T, 'epics/EP-bad/.sdlc'), { recursive: true });
  fs.mkdirSync(path.join(T, 'epics/EP-bad/stories'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-bad/.sdlc/build-log.json'), '{ this is not json');
  fs.writeFileSync(path.join(T, 'epics/EP-bad/stories/EP-bad-S01.md'), `---\nstatus: shipped\nrepos: [web]\n---\n\n# EP-bad-S01\n`);
  writeBackHalf(T, 'EP-ok', 'EP-ok-S01');
  const out = await grab(() => runCheckpoint(T, {}));
  assert.doesNotMatch(out, /yad failed|YAD-STATE/, 'a corrupt build-log must not abort the whole checkpoint');
  const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString().trim().split('\n').filter(Boolean);
  assert.ok(files.some((f) => f.startsWith('epics/EP-ok/')), 'the healthy epic ledger was still committed');
  assert.ok(!files.includes('epics/EP-bad/stories/EP-bad-S01.md'), 'the corrupt epic carries no story flip');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('storyStatusPathspecs: a ship-backed story with NO frontmatter is excluded (no crash)', () => {
  const T = hubForCheckpoint();
  writeStory(T, 'EP-a', 'EP-a-S01', 'shipped'); // ship recorded
  fs.writeFileSync(path.join(T, 'epics/EP-a/stories/EP-a-S01.md'), '# EP-a-S01 with no frontmatter\n');
  assert.deepEqual(storyStatusPathspecs(T), [], 'no frontmatter ⇒ no status ⇒ excluded, and no throw');
  fs.rmSync(T, { recursive: true, force: true });
});

test('summarizeStaged labels "2 stories" across two carried story files', () => {
  const s = summarizeStaged(['epics/EP-a/stories/EP-a-S01.md', 'epics/EP-a/stories/EP-a-S02.md']);
  assert.equal(s.label, '2 stories');
});

// --- regression tests for the Fable5 review findings ---

test('runCheckpoint guard fires even with hub.default_branch UNSET — never trusts the current branch (HIGH-2)', async () => {
  const prev = process.exitCode;
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ckpt-nodef-'));
  git(T, 'init', '-q');
  git(T, 'config', 'user.email', 'a.nasr@x.com');
  git(T, 'config', 'user.name', 'abdelrahman');
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', roster: [] })); // NO default_branch
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [] }));
  git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed'); git(T, 'branch', '-q', '-M', 'main');
  git(T, 'checkout', '-q', '-b', 'feat/side'); // no origin/HEAD ⇒ derives 'main'; we sit on feat/side
  writeBackHalf(T, 'EP-a', 'EP-a-S01');
  const before = git(T, 'rev-parse', 'HEAD').toString().trim();
  const out = await grab(() => runCheckpoint(T, {}));
  assert.match(out, /not the default branch/);
  assert.ok(process.exitCode, 'the guard still fires when default_branch is unconfigured');
  assert.equal(git(T, 'rev-parse', 'HEAD').toString().trim(), before, 'nothing committed on the WIP branch');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint --force does NOT bypass the branch guard — only --allow-branch does (MEDIUM-5)', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  git(T, 'checkout', '-q', '-b', 'wip/x');
  writeBackHalf(T, 'EP-a', 'EP-a-S01');
  const out = await grab(() => runCheckpoint(T, { force: true }));
  assert.match(out, /not the default branch/);
  assert.ok(process.exitCode, '--force must not disable the safety guard');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runCheckpoint --allow-branch --push pushes the CURRENT branch, never the default branch (HIGH-1)', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint(); // default_branch main, on main
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ckpt-bare2-'));
  git(bare, 'init', '-q', '--bare');
  git(T, 'remote', 'add', 'origin', bare);
  git(T, 'push', '-q', 'origin', 'main');
  const mainAtStart = git(bare, 'rev-parse', 'main').toString().trim();
  git(T, 'checkout', '-q', '-b', 'wip/side');
  fs.writeFileSync(path.join(T, 'wip.txt'), 'half done'); git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'feat: wip');
  writeBackHalf(T, 'EP-a', 'EP-a-S01');
  await grab(() => runCheckpoint(T, { push: true, allowBranch: true }));
  assert.equal(git(bare, 'rev-parse', 'main').toString().trim(), mainAtStart, 'origin/main is NOT advanced by a WIP-branch checkpoint');
  assert.equal(
    git(bare, 'rev-parse', 'wip/side').toString().trim(),
    git(T, 'rev-parse', 'HEAD').toString().trim(),
    'the WIP branch is pushed to its OWN ref',
  );
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
});

test('runCheckpoint commits cleanly when build-state/ exists but is empty — no pathspec crash (HIGH-3)', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  const sdlc = path.join(T, 'epics/EP-a/.sdlc');
  fs.mkdirSync(path.join(sdlc, 'build-state'), { recursive: true }); // empty dir, no story JSON yet
  fs.writeFileSync(path.join(sdlc, 'trust-log.json'), JSON.stringify({ epic: 'EP-a', runs: [] }));
  const out = await grab(() => runCheckpoint(T, {}));
  assert.doesNotMatch(out, /git commit failed/);
  assert.ok(!process.exitCode, 'an empty build-state/ dir does not crash the commit');
  const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString().trim().split('\n').filter(Boolean);
  assert.deepEqual(files, ['epics/EP-a/.sdlc/trust-log.json'], 'committed the trust log, not the empty dir spec');
  assert.equal(git(T, 'diff', '--cached', '--name-only').toString().trim(), '', 'index left clean');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('buildCheckpointMessage subject matches the hub commit-message gate regex and collapses injection (NIT-8)', () => {
  const TYPES = 'feat|fix|docs|refactor|test|perf|build|ci|chore|revert';
  const gate = new RegExp(`^(${TYPES})(\\([a-z0-9._-]+\\))?!?: .+`);
  const subj = buildCheckpointMessage({ label: 'EP-a/EP-a-S03', author: '@x', basenames: ['trust-log.json'] }).split('\n')[0];
  assert.match(subj, gate);
  assert.doesNotMatch(subj, /\.$/);
  // a hostile git user.name with a newline + a fake trailer must collapse into the single subject line
  const msg = buildCheckpointMessage({ label: 'EP-a/EP-a-S01', author: 'evil\nCo-Authored-By: X <x@x>', basenames: ['trust-log.json'] });
  assert.ok(!msg.split('\n\n')[0].includes('\n'), 'the subject stays one line — no forged trailer');
  assert.match(msg.split('\n')[0], gate);
});

// ---------------------------------------------------------------------------------------------
// cli/ledger.mjs — shard-then-fold union reader + fold (the conflict-free ledger storage)
// ---------------------------------------------------------------------------------------------
const { readTrustRuns, readShips, updateShip, foldTrust, trustShardName, buildShardName } = await import('./ledger.mjs');

// Build an epic dir with a .sdlc/. Returns the epicDir (what the ledger fns take).
function ledgerEpic() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ledger-'));
  const epicDir = path.join(T, 'epics', 'EP-x');
  fs.mkdirSync(path.join(epicDir, '.sdlc'), { recursive: true });
  return { T, epicDir };
}
const writeTrustShard = (epicDir, e) => {
  const dir = path.join(epicDir, '.sdlc/trust-log'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, trustShardName(e)), JSON.stringify(e));
};
const writeBuildShard = (epicDir, s) => {
  const dir = path.join(epicDir, '.sdlc/build-log'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, buildShardName(s)), JSON.stringify(s));
};
const writeFolded = (epicDir, name, obj) => fs.writeFileSync(path.join(epicDir, '.sdlc', name), JSON.stringify(obj));

test('readTrustRuns: folded-only epic reads unchanged (migration-free)', () => {
  const { T, epicDir } = ledgerEpic();
  writeFolded(epicDir, 'trust-log.json', { epic: 'EP-x', runs: [{ story: 'EP-x-S01', repo: 'be', step: 'checks', verdict: 'approved-unchanged' }] });
  assert.equal(readTrustRuns(epicDir).length, 1);
  fs.rmSync(T, { recursive: true, force: true });
});

test('readTrustRuns: unions folded + loose shards, and never dedups distinct re-runs of a step', () => {
  const { T, epicDir } = ledgerEpic();
  writeFolded(epicDir, 'trust-log.json', { epic: 'EP-x', runs: [{ story: 'EP-x-S01', repo: 'be', step: 'checks', uid: 'f1', verdict: 'approved-unchanged' }] });
  writeTrustShard(epicDir, { story: 'EP-x-S01', repo: 'be', step: 'checks', uid: 's1', verdict: 'approved-unchanged' }); // a SECOND checks run
  writeTrustShard(epicDir, { story: 'EP-x-S02', repo: 'be', step: 'implement', uid: 's2', verdict: 'rejected' });
  const runs = readTrustRuns(epicDir);
  assert.equal(runs.length, 3, 'folded 1 + 2 shards = 3 — re-runs of the same (story,repo,step) are all kept (the threshold counts them)');
  fs.rmSync(T, { recursive: true, force: true });
});

test('readTrustRuns: a shard whose uid is already folded is skipped (half-applied tidy)', () => {
  const { T, epicDir } = ledgerEpic();
  writeFolded(epicDir, 'trust-log.json', { epic: 'EP-x', runs: [{ story: 'EP-x-S01', repo: 'be', step: 'checks', uid: 'dup', verdict: 'approved-unchanged' }] });
  writeTrustShard(epicDir, { story: 'EP-x-S01', repo: 'be', step: 'checks', uid: 'dup', verdict: 'approved-unchanged' });
  assert.equal(readTrustRuns(epicDir).length, 1, 'same uid in folded + shard counts once');
  fs.rmSync(T, { recursive: true, force: true });
});

test('readShips: unions folded + shards; a shard WINS over a stale folded ship of the same key', () => {
  const { T, epicDir } = ledgerEpic();
  writeFolded(epicDir, 'build-log.json', { epic: 'EP-x', ships: [{ story: 'EP-x-S01', task: 'T01', repo: 'be', engineer_review: [] }] });
  writeBuildShard(epicDir, { story: 'EP-x-S01', task: 'T01', repo: 'be', engineer_review: [{ approver: 'amelia' }] }); // reconcile-updated
  writeBuildShard(epicDir, { story: 'EP-x-S02', task: 'T01', repo: 'be', engineer_review: [] });
  const ships = readShips(epicDir);
  assert.equal(ships.length, 2, 'same (story,task,repo) deduped; the S02 ship added');
  const s01 = ships.find((s) => s.story === 'EP-x-S01');
  assert.equal(s01.engineer_review.length, 1, 'the shard (with engagement) won over the stale folded ship');
  fs.rmSync(T, { recursive: true, force: true });
});

test('updateShip: mutates the ship\'s own loose shard; finds the folded ship when no shard', () => {
  const { T, epicDir } = ledgerEpic();
  writeBuildShard(epicDir, { story: 'EP-x-S01', task: 'T01', repo: 'be', pr: '7', engineer_review: [] });
  const r1 = updateShip(epicDir, (s) => String(s.pr) === '7', (s) => { s.engineer_review = [{ approver: 'a' }]; });
  assert.equal(r1.where, 'shard');
  assert.equal(readShips(epicDir).find((s) => s.pr === '7').engineer_review.length, 1, 'shard mutation persisted');
  // no shard, only folded
  const { T: T2, epicDir: e2 } = ledgerEpic();
  writeFolded(e2, 'build-log.json', { epic: 'EP-x', ships: [{ story: 'EP-x-S01', task: 'T01', repo: 'be', pr: '9', engineer_review: [] }] });
  const r2 = updateShip(e2, (s) => String(s.pr) === '9', (s) => { s.engineer_review = [{ approver: 'b' }]; });
  assert.equal(r2.where, 'folded');
  assert.equal(updateShip(e2, (s) => String(s.pr) === '404', () => {}).found, false, 'no match writes nothing');
  fs.rmSync(T, { recursive: true, force: true });
  fs.rmSync(T2, { recursive: true, force: true });
});

test('foldTrust/foldBuild: fold picked shards into the folded file + delete them; dry-run mutates nothing', () => {
  const { T, epicDir } = ledgerEpic();
  writeTrustShard(epicDir, { story: 'EP-x-S01', repo: 'be', step: 'checks', uid: 'k1', date: '2026-07-01' });
  writeTrustShard(epicDir, { story: 'EP-x-S02', repo: 'be', step: 'checks', uid: 'k2', date: '2026-07-02' });
  const onlyS01 = (e) => e.story === 'EP-x-S01';
  // dry run: reports what WOULD fold, writes/deletes nothing
  const dry = foldTrust(epicDir, onlyS01, { dryRun: true });
  assert.equal(dry.folded, 1);
  assert.equal(fs.readdirSync(path.join(epicDir, '.sdlc/trust-log')).length, 2, 'dry run left both shards');
  assert.ok(!fs.existsSync(path.join(epicDir, '.sdlc/trust-log.json')), 'dry run wrote no folded file');
  // real fold
  const res = foldTrust(epicDir, onlyS01);
  assert.equal(res.folded, 1);
  assert.equal(fs.readdirSync(path.join(epicDir, '.sdlc/trust-log')).length, 1, 'S01 shard deleted, S02 kept');
  assert.equal(JSON.parse(fs.readFileSync(path.join(epicDir, '.sdlc/trust-log.json'))).runs.length, 1, 'S01 folded in');
  // idempotent: S01 already gone, nothing more to fold
  assert.equal(foldTrust(epicDir, onlyS01).folded, 0);
  fs.rmSync(T, { recursive: true, force: true });
});

test('trust/buildShardName sanitize path-traversal components — a shard can never escape its dir (CodeRabbit)', () => {
  const n = trustShardName({ story: '../../etc/passwd', repo: 'a/b', step: 'checks', uid: 'x.y' });
  assert.ok(!n.includes('/') && !n.includes('..'), `no separators or traversal: ${n}`);
  assert.equal(n, '______etc_passwd-a_b-checks-x_y.json');
  const b = buildShardName({ story: 'EP-x-S01', task: '..', repo: 'r' });
  assert.ok(!b.includes('/') && !b.includes('..'), `no traversal: ${b}`);
  // normal ids are untouched (only unsafe chars change)
  assert.equal(trustShardName({ story: 'EP-x-S01', repo: 'be', step: 'checks', uid: 'a1' }), 'EP-x-S01-be-checks-a1.json');
});

test('readTrustRuns/foldTrust key on FULL identity — two runs that share a uid are BOTH kept (Fable HIGH-2)', () => {
  const { T, epicDir } = ledgerEpic();
  // same uid 'dup', DIFFERENT stories — a token collision must NOT fuse them
  writeTrustShard(epicDir, { story: 'EP-x-S01', repo: 'be', step: 'checks', uid: 'dup', verdict: 'rejected', date: '2026-07-01' });
  writeTrustShard(epicDir, { story: 'EP-x-S02', repo: 'be', step: 'checks', uid: 'dup', verdict: 'approved-unchanged', date: '2026-07-01' });
  assert.equal(readTrustRuns(epicDir).length, 2, 'both distinct runs survive the union read (uid alone must not dedup)');
  // fold S01 then S02 — neither may drop the other (the dropped one was a rejected verdict → would inflate trust)
  foldTrust(epicDir, (e) => e.story === 'EP-x-S01');
  foldTrust(epicDir, (e) => e.story === 'EP-x-S02');
  const runs = JSON.parse(fs.readFileSync(path.join(epicDir, '.sdlc/trust-log.json'))).runs;
  assert.equal(runs.length, 2, 'both runs folded — no evidence silently deleted');
  assert.ok(runs.some((r) => r.verdict === 'rejected') && runs.some((r) => r.verdict === 'approved-unchanged'));
  fs.rmSync(T, { recursive: true, force: true });
});

test('a corrupt folded ledger ABORTS (never silently rebuilt, which would erase history) (Fable HIGH-3)', () => {
  const { T, epicDir } = ledgerEpic();
  fs.writeFileSync(path.join(epicDir, '.sdlc/trust-log.json'), '{ this is not json'); // truncated/corrupt
  writeTrustShard(epicDir, { story: 'EP-x-S01', repo: 'be', step: 'checks', uid: 'a1' });
  assert.throws(() => readTrustRuns(epicDir), /corrupt JSON/i, 'read throws rather than under-report');
  assert.throws(() => foldTrust(epicDir, () => true), /corrupt JSON/i, 'fold throws rather than rebuild from scratch');
  // the corrupt file is untouched — no data destroyed
  assert.equal(fs.readFileSync(path.join(epicDir, '.sdlc/trust-log.json'), 'utf8'), '{ this is not json');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// yad tidy up + the conflict-free concurrency guarantee
// ---------------------------------------------------------------------------------------------
const { runTidy, shippedStories } = await import('./tidy.mjs');

// A hub on main with a story of the given frontmatter status + a trust shard and a build shard for it.
function hubWithShards(statusByStory) {
  const T = hubForCheckpoint(); // from the checkpoint suite: hub.json (default_branch main) + seed on main
  const ep = path.join(T, 'epics/EP-demo');
  fs.mkdirSync(path.join(ep, 'stories'), { recursive: true });
  fs.mkdirSync(path.join(ep, '.sdlc/trust-log'), { recursive: true });
  fs.mkdirSync(path.join(ep, '.sdlc/build-log'), { recursive: true });
  for (const [story, status] of Object.entries(statusByStory)) {
    fs.writeFileSync(path.join(ep, 'stories', `${story}.md`), `---\nstatus: ${status}\n---\n`);
    fs.writeFileSync(path.join(ep, '.sdlc/trust-log', `${story}-be-checks-${story.slice(-1)}.json`),
      JSON.stringify({ story, repo: 'be', step: 'checks', uid: `u${story.slice(-1)}`, verdict: 'approved-unchanged', date: '2026-07-01' }));
    fs.writeFileSync(path.join(ep, '.sdlc/build-log', `${story}-T01-be.json`),
      JSON.stringify({ story, task: 'T01', repo: 'be', shippedAt: '2026-07-01', engineer_review: [{ approver: 'a', role: 'owner' }] }));
  }
  git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed shards');
  return T;
}

test('shippedStories reads only frontmatter status:shipped', () => {
  const T = hubWithShards({ 'EP-demo-S01': 'shipped', 'EP-demo-S02': 'in-build' });
  const set = shippedStories(T, 'EP-demo');
  assert.ok(set.has('EP-demo-S01') && !set.has('EP-demo-S02'));
  fs.rmSync(T, { recursive: true, force: true });
});

test('runTidy folds ONLY a shipped story\'s shards, leaves in-progress loose, commits, and is idempotent', async () => {
  const prev = process.exitCode;
  const T = hubWithShards({ 'EP-demo-S01': 'shipped', 'EP-demo-S02': 'in-build' });
  const ep = path.join(T, 'epics/EP-demo');
  await grab(() => runTidy(T, {}));
  // S01 shards folded + deleted; S02 shard stays loose
  assert.deepEqual(fs.readdirSync(path.join(ep, '.sdlc/trust-log')), ['EP-demo-S02-be-checks-2.json'], 'only the in-progress trust shard remains');
  assert.deepEqual(fs.readdirSync(path.join(ep, '.sdlc/build-log')), ['EP-demo-S02-T01-be.json'], 'the shipped build shard folded away; the in-progress one stays loose');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/trust-log.json'))).runs.length, 1, 'S01 run folded in');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ep, '.sdlc/build-log.json'))).ships.length, 1, 'S01 ship folded in');
  // the union reader still sees BOTH the folded S01 and the loose S02
  assert.equal(readTrustRuns(ep).length, 2, 'union: folded S01 + loose S02');
  assert.equal(git(T, 'log', '-1', '--format=%s').toString().trim(), 'chore(hub): tidy back-half ledgers — EP-demo by @abdelrahmannasr [skip ci]');
  const out = await grab(() => runTidy(T, {}));
  assert.match(out, /nothing to tidy/);
  assert.ok(!process.exitCode);
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runTidy --dry-run previews but mutates nothing', async () => {
  const prev = process.exitCode;
  const T = hubWithShards({ 'EP-demo-S01': 'shipped' });
  const ep = path.join(T, 'epics/EP-demo');
  const head0 = git(T, 'rev-parse', 'HEAD').toString().trim();
  const out = await grab(() => runTidy(T, { dryRun: true }));
  assert.match(out, /would fold/);
  assert.equal(fs.readdirSync(path.join(ep, '.sdlc/trust-log')).length, 1, 'dry run left the shard');
  assert.ok(!fs.existsSync(path.join(ep, '.sdlc/trust-log.json')), 'dry run wrote no folded file');
  assert.equal(git(T, 'rev-parse', 'HEAD').toString().trim(), head0, 'dry run made no commit');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runTidy refuses off the default branch', async () => {
  const prev = process.exitCode;
  const T = hubWithShards({ 'EP-demo-S01': 'shipped' });
  git(T, 'checkout', '-q', '-b', 'wip/x');
  const out = await grab(() => runTidy(T, {}));
  assert.match(out, /not the default branch/);
  assert.ok(process.exitCode);
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('runTidy does not crash when a touched epic has only build shards (no trust ledger at all) (Fable HIGH-1)', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  const ep = path.join(T, 'epics/EP-demo');
  fs.mkdirSync(path.join(ep, 'stories'), { recursive: true });
  fs.mkdirSync(path.join(ep, '.sdlc/build-log'), { recursive: true }); // build shard only — NO trust-log file or dir
  fs.writeFileSync(path.join(ep, 'stories/EP-demo-S01.md'), '---\nstatus: shipped\n---\n');
  fs.writeFileSync(path.join(ep, '.sdlc/build-log/EP-demo-S01-T01-be.json'), JSON.stringify({ story: 'EP-demo-S01', task: 'T01', repo: 'be', shippedAt: '2026-07-01' }));
  git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed build shard');
  const out = await grab(() => runTidy(T, {}));
  assert.doesNotMatch(out, /git add failed/, 'missing trust-log path must not make git add fatal');
  assert.ok(!process.exitCode, 'clean exit');
  const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString();
  assert.match(files, /build-log\.json/, 'the build shard folded + committed');
  assert.equal(git(T, 'diff', '--cached', '--name-only').toString().trim(), '', 'nothing stranded staged');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

test('THE POINT: two writers add different shards to the SAME epic and both push with ZERO conflict', async () => {
  const prev = process.exitCode;
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-conc-bare-'));
  git(bare, 'init', '-q', '--bare');
  // origin seeded from clone A
  const A = hubForCheckpoint();
  git(A, 'remote', 'add', 'origin', bare); git(A, 'push', '-q', 'origin', 'main');
  // Point the bare's HEAD at main so a clone checks it out. A fresh `git init --bare` defaults HEAD to
  // `master` where init.defaultBranch is unset (CI runners) — without this, clone B lands on an unborn
  // branch with an EMPTY tree (no hub.json) and its checkpoint silently no-ops.
  git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const B = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-conc-B-'));
  git(B, 'clone', '-q', bare, B); // clone into B
  git(B, 'config', 'user.email', 'a.nasr@x.com'); git(B, 'config', 'user.name', 'abdelrahman');
  // A writes a trust shard for S01; B writes one for S02 — same epic, DIFFERENT files
  const shard = (root, story, uid) => {
    const d = path.join(root, 'epics/EP-demo/.sdlc/trust-log'); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `EP-demo-${story}-be-checks-${uid}.json`), JSON.stringify({ story: `EP-demo-${story}`, repo: 'be', step: 'checks', uid, verdict: 'approved-unchanged', date: '2026-07-01' }));
  };
  shard(A, 'S01', 'a1'); shard(B, 'S02', 'b1');
  // A checkpoints + pushes first
  await grab(() => runCheckpoint(A, { push: true }));
  // B checkpoints + pushes — push is rejected (A moved main), pushWithRebase rebases and retries; the
  // two commits touch DIFFERENT files so the rebase is clean and B lands with no conflict.
  await grab(() => runCheckpoint(B, { push: true }));
  git(A, 'pull', '-q', '--rebase', 'origin', 'main');
  // both shards are present on origin/main (pulled into A)
  assert.ok(fs.existsSync(path.join(A, 'epics/EP-demo/.sdlc/trust-log/EP-demo-S01-be-checks-a1.json')), 'S01 survived');
  assert.ok(fs.existsSync(path.join(A, 'epics/EP-demo/.sdlc/trust-log/EP-demo-S02-be-checks-b1.json')), 'S02 survived — no conflict, no lost write');
  process.exitCode = prev;
  fs.rmSync(A, { recursive: true, force: true }); fs.rmSync(B, { recursive: true, force: true }); fs.rmSync(bare, { recursive: true, force: true });
});

test('runCheckpoint commits trust-log/ + build-log/ shard files (allowlist widened) and labels the story', async () => {
  const prev = process.exitCode;
  const T = hubForCheckpoint();
  const d = path.join(T, 'epics/EP-demo/.sdlc');
  fs.mkdirSync(path.join(d, 'trust-log'), { recursive: true });
  fs.mkdirSync(path.join(d, 'build-log'), { recursive: true });
  fs.writeFileSync(path.join(d, 'trust-log/EP-demo-S01-be-checks-a1.json'), JSON.stringify({ story: 'EP-demo-S01', repo: 'be', step: 'checks', uid: 'a1' }));
  fs.writeFileSync(path.join(d, 'build-log/EP-demo-S01-T01-be.json'), JSON.stringify({ story: 'EP-demo-S01', task: 'T01', repo: 'be' }));
  await grab(() => runCheckpoint(T, {}));
  const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString().trim().split('\n').filter(Boolean);
  assert.ok(files.includes('epics/EP-demo/.sdlc/trust-log/EP-demo-S01-be-checks-a1.json'), 'trust shard committed');
  assert.ok(files.includes('epics/EP-demo/.sdlc/build-log/EP-demo-S01-T01-be.json'), 'build shard committed');
  assert.match(git(T, 'log', '-1', '--format=%s').toString(), /EP-demo\/EP-demo-S01 by @abdelrahmannasr/, 'subject label derived from the shard filename');
  process.exitCode = prev;
  fs.rmSync(T, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// `yad update --push` — commit + push applied drift straight to the default branch
// ---------------------------------------------------------------------------------------------
const { buildUpdateMessage, groupByRoot, repoLabel } = await import('./update-commit.mjs');
const { VERSION: PKG_VERSION } = await import('./manifest.mjs');

test('buildUpdateMessage: valid chore(yad-update) subject, version-stamped, no [skip ci]/Task/Co-Authored-By', () => {
  const m = buildUpdateMessage({ version: '3.7.0', items: ['hub/checks/verified-commits.sh', 'backend/checks/spec-link.sh'] });
  const subject = m.split('\n')[0];
  assert.equal(subject, 'chore(yad-update): sync SDLC install to yadflow v3.7.0');
  assert.doesNotMatch(m, /\[skip ci\]/i, 'must NOT skip CI — the yad-update-guard has to run');
  assert.doesNotMatch(m, /^Task:/mi);
  assert.doesNotMatch(m, /Co-Authored-By/i);
  assert.doesNotMatch(subject, /\.$/, 'no trailing period (commit-message gate)');
  assert.match(m, /- hub\/checks\/verified-commits\.sh/, 'body lists changed items as bullets');
});

test('buildUpdateMessage: defaults to package version and a bodyless subject with no items', () => {
  const m = buildUpdateMessage();
  assert.equal(m, `chore(yad-update): sync SDLC install to yadflow v${PKG_VERSION}`);
  assert.ok(!m.includes('\n'), 'no body when there are no items');
});

test('buildUpdateMessage: collapses newlines in an item so it cannot forge a trailer line', () => {
  const m = buildUpdateMessage({ version: '1.0.0', items: ['x\nTask: EP-evil-S01-T01'] });
  // the injected newline is collapsed, so the item stays a single `- ` bullet, not a Task trailer
  assert.doesNotMatch(m, /^Task: EP-evil/mi);
  assert.match(m, /- x Task: EP-evil-S01-T01/);
});

test('groupByRoot: groups paths + item labels by root, dedups paths, ignores rootless actions', () => {
  const groups = groupByRoot([
    { scope: 'hub', item: 'a', root: '/hub', paths: ['x', 'y'] },
    { scope: 'hub', item: 'b', root: '/hub', paths: ['y', 'z'] },
    { scope: 'be', item: 'c', root: '/repo', paths: ['p'] },
    { scope: 'x', item: 'd' }, // no root/paths -> ignored
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].root, '/hub');
  assert.deepEqual([...groups[0].paths].sort(), ['x', 'y', 'z']);
  assert.deepEqual(groups[0].items, ['hub/a', 'hub/b']);
  assert.deepEqual(groups[1].root, '/repo');
});

test('repoLabel: hub root -> "hub", connected repo -> its relative path', () => {
  assert.equal(repoLabel('/hub', '/hub'), 'hub');
  assert.equal(repoLabel('/hub', '/hub/demo/backend'), 'demo/backend');
});

// Scaffold a hub + connected backend, each with a bare origin on `main`, hub.json bridge-enabled.
function scaffoldWithRemotes() {
  const { T, backend } = scaffold();
  const hubBare = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-hubbare-')); git(hubBare, 'init', '-q', '--bare');
  const beBare = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-bebare-')); git(beBare, 'init', '-q', '--bare');
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', default_branch: 'main', bridge_enabled: true, roster: [] }));
  // hub: seed a commit, name the branch main, wire origin
  fs.writeFileSync(path.join(T, 'seed.txt'), '0'); git(T, 'add', '-A');
  git(T, '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '-m', 'seed');
  git(T, 'branch', '-q', '-M', 'main'); git(T, 'remote', 'add', 'origin', hubBare);
  // backend: already has an init commit; name main + wire origin
  git(backend, 'branch', '-q', '-M', 'main'); git(backend, 'remote', 'add', 'origin', beBare);
  git(backend, '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'config', 'user.email', 'a@b.c');
  git(T, 'config', 'user.email', 'a@b.c'); git(T, 'config', 'user.name', 'x');
  git(backend, 'config', 'user.name', 'x');
  return { T, backend, hubBare, beBare };
}

test('reconcile --push: commits chore(yad-update) on hub + connected repo and pushes to origin/main', async () => {
  const prev = process.exitCode;
  const { T, backend, hubBare, beBare } = scaffoldWithRemotes();
  try {
    process.exitCode = 0;
    await grab(() => reconcile(T, { fix: true, push: true }));

    // hub commit
    const hubSubject = git(T, 'log', '-1', '--format=%s').toString().trim();
    assert.match(hubSubject, new RegExp(`^chore\\(yad-update\\): sync SDLC install to yadflow v${PKG_VERSION.replace(/\./g, '\\.')}$`), 'hub subject');
    assert.doesNotMatch(git(T, 'log', '-1', '--format=%B').toString(), /\[skip ci\]/i, 'no [skip ci] on hub commit');
    // the version stamp + new guard workflow rode the hub commit
    const hubFiles = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString();
    assert.match(hubFiles, /\.sdlc\/cli-version\.json/, 'version stamp committed on hub');
    assert.match(hubFiles, /\.github\/workflows\/yad-update-guard\.yml/, 'new guard workflow committed on hub');

    // backend commit + new guard workflow installed
    const beSubject = git(backend, 'log', '-1', '--format=%s').toString().trim();
    assert.match(beSubject, /^chore\(yad-update\): sync SDLC install to yadflow v/, 'backend subject');
    assert.ok(fs.existsSync(path.join(backend, '.github/workflows/yad-update-guard.yml')), 'backend guard workflow installed');

    // both pushed to their bare origins
    assert.match(git(hubBare, 'log', '-1', '--format=%s', 'main').toString(), /chore\(yad-update\)/, 'hub pushed to origin/main');
    assert.match(git(beBare, 'log', '-1', '--format=%s', 'main').toString(), /chore\(yad-update\)/, 'backend pushed to origin/main');
    assert.ok(!process.exitCode, 'clean push -> zero exit code');
  } finally {
    process.exitCode = prev;
    for (const d of [T, backend, hubBare, beBare]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('commitAndPush: a path that is NOT its own repo top (nested plain dir) is skipped, never committed into the enclosing repo', async () => {
  const { commitAndPush } = await import('./update-commit.mjs');
  const prev = process.exitCode;
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-nest-'));
  try {
    process.exitCode = 0;
    git(T, 'init', '-q'); git(T, 'config', 'user.email', 'a@b.c'); git(T, 'config', 'user.name', 'x');
    fs.writeFileSync(path.join(T, 'seed'), '0'); git(T, 'add', '-A'); git(T, 'commit', '-q', '-m', 'seed'); git(T, 'branch', '-q', '-M', 'main');
    // a registered repo whose clone is GONE: just a plain dir inside the hub, with recreated wiring
    const fake = path.join(T, 'demo/backend'); fs.mkdirSync(path.join(fake, 'checks'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'checks/spec-link.sh'), '# wired\n');
    const out = await grab(() => {
      const r = commitAndPush({ root: fake, paths: ['checks/spec-link.sh'], items: ['backend/x'] },
        { push: false, hubRoot: T, defaultBranch: 'main' });
      assert.equal(r.committed, false); assert.equal(r.skipped, true);
    });
    assert.match(out, /not its own git repo/, 'nested plain dir is refused');
    // the enclosing hub must NOT have gained a commit or a staged backend file
    assert.equal(git(T, 'rev-list', '--count', 'HEAD').toString().trim(), '1', 'hub still has only the seed commit');
    assert.equal(git(T, 'diff', '--cached', '--name-only').toString().trim(), '', 'nothing staged into the hub index');
  } finally {
    process.exitCode = prev;
    fs.rmSync(T, { recursive: true, force: true });
  }
});

test('reconcile --push: a connected repo on a non-default branch is skipped, not disrupted', async () => {
  const prev = process.exitCode;
  const { T, backend, hubBare, beBare } = scaffoldWithRemotes();
  try {
    process.exitCode = 0;
    git(backend, 'checkout', '-q', '-b', 'feature/wip'); // backend off its default branch
    const out = await grab(() => reconcile(T, { fix: true, push: true }));
    assert.match(out, /not the default branch 'main' — skipped/, 'backend skipped with a warning');
    // backend HEAD is still the original init commit — no yad-update commit forced onto the feature branch
    assert.doesNotMatch(git(backend, 'log', '-1', '--format=%s').toString(), /chore\(yad-update\)/, 'no commit on the feature branch');
    // and nothing was pushed to the backend remote
    assert.doesNotMatch(git(beBare, 'log', '--oneline', '--all').toString(), /chore\(yad-update\)/, 'backend remote untouched');
    // the hub itself (on main) still committed + pushed — one repo being skipped doesn't block the rest
    assert.match(git(T, 'log', '-1', '--format=%s').toString(), /chore\(yad-update\)/, 'hub still published');
    // and the summary must NOT claim "merges can resume" when a repo was skipped (CodeRabbit fix)
    assert.match(out, /update incomplete/, 'skipped repo => incomplete summary');
    assert.doesNotMatch(out, /merges can resume/);
  } finally {
    process.exitCode = prev;
    for (const d of [T, backend, hubBare, beBare]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// `yad repo refresh --push` — publish the connected-repo code-context to the hub default branch
// ---------------------------------------------------------------------------------------------
const { buildCodeMapMessage, codeMapPathspecs, summarizeCodeContext, publishCodeContext } = await import('./repo-publish.mjs');

test('buildCodeMapMessage: valid chore(hub) code-context subject with [skip ci], no Task/Co-Authored-By', () => {
  const m = buildCodeMapMessage({ label: 'backend', author: '@amn', basenames: ['.sdlc/code-context/backend/code-map.md', '.sdlc/repos.json'] });
  const subject = m.split('\n')[0];
  assert.equal(subject, 'chore(hub): sync code-context — backend by @amn [skip ci]');
  assert.doesNotMatch(m, /^Task:/mi);
  assert.doesNotMatch(m, /Co-Authored-By/i);
  assert.match(m, /Updated: .*code-map\.md/, 'body lists the staged files');
});

test('buildCodeMapMessage: collapses newlines in the author so it cannot forge a trailer line', () => {
  const m = buildCodeMapMessage({ label: 'backend', author: 'x\nTask: EP-evil-S01-T01', basenames: [] });
  assert.doesNotMatch(m, /^Task: EP-evil/mi);
  assert.match(m.split('\n')[0], /by x Task: EP-evil-S01-T01 \[skip ci\]$/);
});

test('summarizeCodeContext: labels single repo / N repos / registry-only', () => {
  assert.equal(summarizeCodeContext(['.sdlc/code-context/backend/code-map.md']).label, 'backend');
  assert.equal(summarizeCodeContext(['.sdlc/code-context/a/code-map.md', '.sdlc/code-context/b/code-map.md']).label, '2 repos');
  assert.equal(summarizeCodeContext(['.sdlc/repos.json']).label, 'registry');
});

test('codeMapPathspecs: only existing code-maps + the registry (never the gitignored pack, never a missing map)', () => {
  const { T } = scaffold();
  try {
    fs.mkdirSync(path.join(T, '.sdlc/code-context/backend'), { recursive: true });
    fs.writeFileSync(path.join(T, '.sdlc/code-context/backend/code-map.md'), '# map\n');
    const registry = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/repos.json'), 'utf8'));
    registry.repos.push({ name: 'mobile', path: 'demo/mobile', codeMap: '.sdlc/code-context/mobile/code-map.md' });
    const specs = codeMapPathspecs(T, registry);
    assert.ok(specs.includes('.sdlc/code-context/backend/code-map.md'), 'existing code-map included');
    assert.ok(specs.includes('.sdlc/repos.json'), 'registry included');
    assert.ok(!specs.includes('.sdlc/code-context/mobile/code-map.md'), 'a repo with no on-disk map is excluded');
    assert.ok(!specs.some((s) => s.includes('pack.md')), 'gitignored pack never staged');
    // name filter: a scoped refresh only stages the named repo's map (+ the registry)
    const scoped = codeMapPathspecs(T, registry, 'backend');
    assert.ok(scoped.includes('.sdlc/code-context/backend/code-map.md'), 'named repo map included');
    assert.deepEqual(codeMapPathspecs(T, registry, 'mobile'), ['.sdlc/repos.json'], 'scoping to a repo with no on-disk map leaves only the registry');
  } finally {
    fs.rmSync(T, { recursive: true, force: true });
  }
});

test('publishCodeContext: commits chore(hub) code-context, pushes to origin/main, then is idempotent', async () => {
  const prev = process.exitCode;
  const { T, backend, hubBare, beBare } = scaffoldWithRemotes();
  try {
    process.exitCode = 0;
    // a freshly (AI-)regenerated code-map in the hub working tree
    fs.mkdirSync(path.join(T, '.sdlc/code-context/backend'), { recursive: true });
    fs.writeFileSync(path.join(T, '.sdlc/code-context/backend/code-map.md'), '# backend code-map\n');
    await grab(() => publishCodeContext(T, { push: true }));

    const subject = git(T, 'log', '-1', '--format=%s').toString().trim();
    assert.match(subject, /^chore\(hub\): sync code-context — backend by .+ \[skip ci\]$/, 'audit-trail subject');
    const files = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString();
    assert.match(files, /\.sdlc\/code-context\/backend\/code-map\.md/, 'code-map committed');
    assert.doesNotMatch(files, /pack\.md/, 'the gitignored pack never rides along');
    assert.match(git(hubBare, 'log', '-1', '--format=%s', 'main').toString(), /chore\(hub\): sync code-context/, 'pushed to origin/main');
    assert.ok(!process.exitCode, 'clean push -> zero exit code');

    // idempotent: a re-run with nothing new and already pushed is a clean no-op (no second commit)
    const count = git(T, 'rev-list', '--count', 'HEAD').toString().trim();
    const out2 = await grab(() => publishCodeContext(T, { push: true }));
    assert.match(out2, /already published — nothing to do/, 'unchanged + already pushed -> no-op');
    assert.equal(git(T, 'rev-list', '--count', 'HEAD').toString().trim(), count, 'no second commit');
  } finally {
    process.exitCode = prev;
    for (const d of [T, backend, hubBare, beBare]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('publishCodeContext: a named refresh publishes only that repo\'s code-map, not others', async () => {
  const prev = process.exitCode;
  const { T, backend, hubBare, beBare } = scaffoldWithRemotes();
  try {
    process.exitCode = 0;
    // register a second repo and give both an on-disk (uncommitted) code-map in the hub
    const reg = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/repos.json'), 'utf8'));
    reg.repos.push({ name: 'mobile', path: 'demo/mobile', default_branch: 'main', codeMap: '.sdlc/code-context/mobile/code-map.md' });
    fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify(reg));
    for (const n of ['backend', 'mobile']) {
      fs.mkdirSync(path.join(T, `.sdlc/code-context/${n}`), { recursive: true });
      fs.writeFileSync(path.join(T, `.sdlc/code-context/${n}/code-map.md`), `# ${n} map\n`);
    }
    await grab(() => publishCodeContext(T, { push: false, name: 'backend' }));

    const committed = git(T, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').toString();
    assert.match(committed, /code-context\/backend\/code-map\.md/, 'named repo code-map committed');
    assert.doesNotMatch(committed, /code-context\/mobile\/code-map\.md/, 'unrelated repo code-map NOT swept in');
    assert.ok(fs.existsSync(path.join(T, '.sdlc/code-context/mobile/code-map.md')), 'mobile map still present, left unpublished');
    assert.match(git(T, 'log', '-1', '--format=%s').toString(), /sync code-context — backend by /, 'label scoped to the named repo, not "2 repos"');
  } finally {
    process.exitCode = prev;
    for (const d of [T, backend, hubBare, beBare]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('publishCodeContext: a re-run pushes a commit that a prior run committed but failed to push', async () => {
  const prev = process.exitCode;
  const { T, backend, hubBare, beBare } = scaffoldWithRemotes();
  try {
    process.exitCode = 0;
    git(T, 'push', '-q', 'origin', 'HEAD:main'); // origin/main exists (tracking ref set)
    fs.mkdirSync(path.join(T, '.sdlc/code-context/backend'), { recursive: true });
    fs.writeFileSync(path.join(T, '.sdlc/code-context/backend/code-map.md'), '# map\n');
    // 1st run commits locally but does NOT push (simulates a push that failed and left the commit ahead)
    await grab(() => publishCodeContext(T, { push: false }));
    assert.match(git(T, 'log', '-1', '--format=%s').toString(), /sync code-context/, 'commit landed locally');
    assert.doesNotMatch(git(hubBare, 'log', '--oneline', '--all').toString(), /sync code-context/, 'not yet on origin');

    // re-run with --push: index is unchanged (already committed) but the unpushed commit must still land
    const out = await grab(() => publishCodeContext(T, { push: true }));
    assert.match(out, /pushing 1 already-committed change/, 'detects the unpushed commit and pushes it');
    assert.match(git(hubBare, 'log', '-1', '--format=%s', 'main').toString(), /sync code-context/, 'existing commit reaches origin/main on the re-run');
    assert.ok(!process.exitCode, 'successful retry -> zero exit code');

    // a further re-run with nothing unpushed is a clean no-op
    const out2 = await grab(() => publishCodeContext(T, { push: true }));
    assert.match(out2, /already published — nothing to do/, 'fully-published re-run no-ops');
  } finally {
    process.exitCode = prev;
    for (const d of [T, backend, hubBare, beBare]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('publishCodeContext: non-default branch is skipped unless --allow-branch', async () => {
  const prev = process.exitCode;
  const { T, backend, hubBare, beBare } = scaffoldWithRemotes();
  try {
    process.exitCode = 0;
    fs.mkdirSync(path.join(T, '.sdlc/code-context/backend'), { recursive: true });
    fs.writeFileSync(path.join(T, '.sdlc/code-context/backend/code-map.md'), '# map\n');
    git(T, 'checkout', '-q', '-b', 'chore/wip'); // hub off its default branch
    const out = await grab(() => publishCodeContext(T, { push: false }));
    assert.match(out, /not the default branch 'main'/, 'guard refuses a non-default branch');
    assert.doesNotMatch(git(T, 'log', '-1', '--format=%s').toString(), /sync code-context/, 'no commit on the wip branch');
    assert.ok(process.exitCode, 'guard sets a non-zero exit code');

    // --allow-branch overrides: the commit lands on the current branch
    process.exitCode = 0;
    await grab(() => publishCodeContext(T, { push: false, allowBranch: true }));
    assert.match(git(T, 'log', '-1', '--format=%s').toString(), /sync code-context/, '--allow-branch commits on the wip branch');
  } finally {
    process.exitCode = prev;
    for (const d of [T, backend, hubBare, beBare]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('publishCodeContext: outside a hub (no hub.json) fails with a non-zero exit code', async () => {
  const prev = process.exitCode;
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-nohub-'));
  try {
    process.exitCode = 0;
    git(T, 'init', '-q');
    const out = await grab(() => publishCodeContext(T, { push: false }));
    assert.match(out, /hub\.json/, 'refuses to publish outside the product hub');
    assert.ok(process.exitCode, 'sets a non-zero exit code');
  } finally {
    process.exitCode = prev;
    fs.rmSync(T, { recursive: true, force: true });
  }
});
