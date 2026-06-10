// Dependency-free tests for the sdlc CLI. Run: node --test cli/test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' });

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
    '.claude/skills/sdlc-author-epic/SKILL.md',
    '_bmad/sdlc/config.yaml',
    'demo/backend/.github/workflows/sdlc-checks.yml',
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

  fs.rmSync(path.join(T, 'demo/backend/.github/workflows/sdlc-checks.yml'));        // missing
  fs.appendFileSync(path.join(T, '.claude/skills/sdlc-status/SKILL.md'), '\ndrift'); // outdated
  git(backend, '-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '--allow-empty', '-m', 'more'); // stale

  const r = await reconcile(T, { fix: false });
  assert.equal(r.counts.missing, 1, 'one missing');
  assert.equal(r.counts.outdated, 1, 'one outdated');
  assert.equal(r.counts.stale, 1, 'one stale');
  fs.rmSync(T, { recursive: true, force: true });
});

test('CLI --version matches manifest', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  const out = execFileSync('node', [path.join(ROOT, 'bin/sdlc.mjs'), '--version']).toString().trim();
  assert.equal(out, version);
});

// ---------------------------------------------------------------------------------------------
// `sdlc commit` — message builder + branch-derived task
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
// `sdlc gate sync` — platform state -> ledger -> advance (with an injected fake reader)
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
// `sdlc repo list` — staleness as a human-visible flag
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
// `sdlc commit` — end-to-end against a real temp git repo
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
// `sdlc gate ci` — event-driven sync: derive from the review branch, overlay, ledger-only commit
// ---------------------------------------------------------------------------------------------
const { parseReviewBranch, artifactFromBase, artifactPaths, upsertHubPr, contractSurfaceHash } = await import('./epic-state.mjs');
const { gateCi } = await import('./gate.mjs');

test('parseReviewBranch accepts review/EP-*/<base> and rejects everything else', () => {
  assert.deepEqual(parseReviewBranch('review/EP-x/architecture'), { epic: 'EP-x', base: 'architecture' });
  assert.deepEqual(parseReviewBranch('review/EP-istifta-inquiries/stories'), { epic: 'EP-istifta-inquiries', base: 'stories' });
  assert.equal(parseReviewBranch('feature/foo'), null);
  assert.equal(parseReviewBranch('review/notanepic'), null);
  assert.equal(parseReviewBranch('review/notanepic/epic'), null);
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
    platform: 'github', // no default_branch — the `sdlc setup` hub.json shape; gate ci must derive it
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
  git(ci, 'config', 'user.email', 'sdlc-gate-sync@noreply');
  git(ci, 'config', 'user.name', 'sdlc-gate-sync');
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

test('check --fix wires the hub gate-sync CI only when the bridge is enabled', async () => {
  const { T } = scaffold();
  // no hub.json -> no hub action
  await reconcile(T, { fix: true });
  assert.ok(!fs.existsSync(path.join(T, '.github/workflows/sdlc-gate-sync.yml')), 'no hub.json => not wired');
  // hub on github with the bridge -> wired + idempotent
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'github', bridge_enabled: true, roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(fs.existsSync(path.join(T, '.github/workflows/sdlc-gate-sync.yml')), 'hub workflow installed');
  const again = await reconcile(T, { fix: false });
  assert.equal(again.counts.missing, 0);
  assert.equal(again.counts.outdated, 0);
  // gitlab with the bridge -> fragment installed + idempotent
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge_enabled: true, roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(fs.existsSync(path.join(T, '.gitlab/ci/sdlc-gate-sync.yml')), 'gitlab fragment installed');
  const gl = await reconcile(T, { fix: false });
  assert.equal(gl.counts.missing, 0);
  assert.equal(gl.counts.outdated, 0);
  // bridge disabled (either spelling) -> no action; an already-installed file is left alone
  fs.rmSync(path.join(T, '.gitlab/ci/sdlc-gate-sync.yml'));
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge: false, roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(!fs.existsSync(path.join(T, '.gitlab/ci/sdlc-gate-sync.yml')), 'disabled bridge => not wired');
  // legacy `bridge: true` (older setup) still counts as an explicit enable
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', bridge: true, roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(fs.existsSync(path.join(T, '.gitlab/ci/sdlc-gate-sync.yml')), 'legacy bridge:true wires');
  // platform set but NO enable flag in either spelling -> not wired (explicit-enable semantics)
  fs.rmSync(path.join(T, '.gitlab/ci/sdlc-gate-sync.yml'));
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ platform: 'gitlab', roster: [] }));
  await reconcile(T, { fix: true });
  assert.ok(!fs.existsSync(path.join(T, '.gitlab/ci/sdlc-gate-sync.yml')), 'missing flag => not wired');
  fs.rmSync(T, { recursive: true, force: true });
});
