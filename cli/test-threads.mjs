// Phase 6 feature-thread engine tests. Run: node --test cli/test-threads.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveThread, threadEpics, resolveCurrentArtifacts, resolveCurrentStories, epicLineage, gatePredicate,
  isStubEpic, nextAction, preconditionsMet,
} from './epic-state.mjs';
import { sealedEpic, openDebtOnThread, threadSummary } from './thread.mjs';

// Minimal hub builder: write an epic with lineage frontmatter (+ optional stories/lock/debt).
function hub() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-thread-'));
  fs.mkdirSync(path.join(T, 'epics'), { recursive: true });
  return T;
}
function writeEpic(T, id, fm, { stories = null, lockHash = null, debt = null } = {}) {
  const dir = path.join(T, 'epics', id);
  fs.mkdirSync(path.join(dir, '.sdlc'), { recursive: true });
  const front = Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n');
  fs.writeFileSync(path.join(dir, 'epic.md'), `---\nid: ${id}\n${front}\n---\n\n## Goal\nx\n`);
  if (stories) {
    fs.mkdirSync(path.join(dir, 'stories'), { recursive: true });
    stories.forEach((st, i) => fs.writeFileSync(
      path.join(dir, 'stories', `${id}-S0${i + 1}.md`),
      `---\nid: ${id}-S0${i + 1}\nepic: ${id}\nstatus: ${st}\nrepos: [backend]\n---\n\n## Story\nx\n`,
    ));
  }
  if (lockHash) fs.writeFileSync(path.join(dir, '.sdlc/contract-lock.json'), JSON.stringify({ artifact: 'contract.md', hash: lockHash }));
  if (debt) fs.writeFileSync(path.join(dir, '.sdlc/reconcile-debt.json'), JSON.stringify(debt));
  return dir;
}

test('resolveThread: linear chain resolves genesis-first with the genesis root', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  writeEpic(T, 'EP-chg', { kind: 'change', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic', 'architecture'] });
  writeEpic(T, 'EP-fix', { kind: 'defect', parent: 'EP-chg', thread: 'EP-gen', inherits: ['epic'] });

  const r = resolveThread(T, 'EP-fix');
  assert.equal(r.rootId, 'EP-gen');
  assert.deepEqual(r.chain, ['EP-gen', 'EP-chg', 'EP-fix']);
  assert.equal(r.broken, null);
  // threadEpics groups everything sharing the root, genesis-first.
  assert.deepEqual(threadEpics(T, 'EP-chg'), ['EP-gen', 'EP-chg', 'EP-fix']);
});

test('resolveThread: a missing parent and a thread-cache mismatch are flagged broken', () => {
  const T = hub();
  writeEpic(T, 'EP-orphan', { kind: 'change', parent: 'EP-ghost', thread: 'EP-ghost' });
  assert.match(resolveThread(T, 'EP-orphan').broken, /missing parent epic EP-ghost/);

  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  writeEpic(T, 'EP-bad', { kind: 'change', parent: 'EP-gen', thread: 'EP-wrong' });
  assert.match(resolveThread(T, 'EP-bad').broken, /thread cache 'EP-wrong' != computed root 'EP-gen'/);
});

test('resolveThread: a non-genesis epic with NO thread cache is flagged broken (fail-closed)', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  writeEpic(T, 'EP-nocache', { kind: 'change', parent: 'EP-gen' }); // parent set, thread cache absent
  const r = resolveThread(T, 'EP-nocache');
  assert.equal(r.rootId, 'EP-gen');            // still computes the root by walking parent
  assert.match(r.broken, /missing thread cache/); // but flags the missing cache (gates/doctor catch it)
});

test('threadEpics: same-depth siblings (a branch) order deterministically by id, not readdir', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  // Two change-epics both threaded directly off genesis — same depth (a fork).
  writeEpic(T, 'EP-bbb', { kind: 'change', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic'] });
  writeEpic(T, 'EP-aaa', { kind: 'change', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic'] });
  // Genesis first, then the two siblings in stable id order (aaa before bbb) — machine-independent.
  assert.deepEqual(threadEpics(T, 'EP-gen'), ['EP-gen', 'EP-aaa', 'EP-bbb']);
});

test('resolveThread: a cycle is detected, not looped forever', () => {
  const T = hub();
  writeEpic(T, 'EP-a', { kind: 'change', parent: 'EP-b', thread: 'EP-a' });
  writeEpic(T, 'EP-b', { kind: 'change', parent: 'EP-a', thread: 'EP-a' });
  assert.match(resolveThread(T, 'EP-a').broken, /cycle/);
});

test('resolveCurrentArtifacts: a defect-epic owns only what it re-authored; genesis owns the rest', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  // defect-fix: inherits epic/architecture/contract/ui-design, re-authors stories + test-cases.
  writeEpic(T, 'EP-fix', {
    kind: 'defect', parent: 'EP-gen', thread: 'EP-gen',
    inherits: ['epic', 'architecture', 'contract', 'ui-design'],
  });
  const owner = resolveCurrentArtifacts(T, 'EP-gen');
  assert.equal(owner.epic, 'EP-gen');           // REPLACE base: single latest owner
  assert.equal(owner.architecture, 'EP-gen');
  assert.equal(owner.contract, 'EP-gen');
  assert.equal(owner['ui-design'], 'EP-gen');
  // ADDITIVE bases: the UNION of contributors (genesis + the defect), never collapsed to one.
  assert.deepEqual(owner.stories, ['EP-gen', 'EP-fix']);
  assert.deepEqual(owner['test-cases'], ['EP-gen', 'EP-fix']);
});

test('resolveCurrentStories: composes the story set — inherited parent stories survive a defect-fix', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' }, { stories: ['shipped', 'shipped', 'shipped'] });
  // genesis story files are EP-gen-S01..S03 (writeEpic names them by epic id).
  // defect re-authors stories but contributes only its OWN regression story; inherits the rest.
  writeEpic(T, 'EP-fix', { kind: 'defect', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic', 'architecture', 'contract', 'ui-design'] }, { stories: ['shipped'] });
  const stories = resolveCurrentStories(T, 'EP-gen');
  // the three genesis stories are still owned by genesis (NOT dropped) ...
  assert.equal(stories['EP-gen-S01'], 'EP-gen');
  assert.equal(stories['EP-gen-S03'], 'EP-gen');
  // ... plus the defect's own regression story.
  assert.equal(stories['EP-fix-S01'], 'EP-fix');
  assert.equal(Object.keys(stories).length, 4);
});

test('resolveCurrentStories: `supersedes` retires a parent story id', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' }, { stories: ['shipped', 'shipped'] });
  writeEpic(T, 'EP-chg', { kind: 'change', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic', 'architecture', 'contract', 'ui-design'], supersedes: ['EP-gen-S02'] }, { stories: ['draft'] });
  const stories = resolveCurrentStories(T, 'EP-gen');
  assert.equal(stories['EP-gen-S01'], 'EP-gen');         // kept
  assert.equal(stories['EP-gen-S02'], undefined);        // retired via supersedes
  assert.equal(stories['EP-chg-S01'], 'EP-chg');         // the change's replacement
});

test('resolveCurrentArtifacts: a later contract-surface change shadows architecture+contract', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  writeEpic(T, 'EP-fix', { kind: 'defect', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic', 'architecture', 'contract', 'ui-design'] });
  // contract-surface change re-authors architecture + contract (omits them from inherits).
  writeEpic(T, 'EP-surf', { kind: 'change', parent: 'EP-fix', thread: 'EP-gen', inherits: ['epic', 'ui-design'] });
  const owner = resolveCurrentArtifacts(T, 'EP-gen');
  assert.equal(owner.architecture, 'EP-surf');  // REPLACE: the surface change wins (latest re-author)
  assert.equal(owner.contract, 'EP-surf');
  assert.deepEqual(owner.stories, ['EP-gen', 'EP-fix', 'EP-surf']); // ADDITIVE: every contributor
  assert.deepEqual(owner['test-cases'], ['EP-gen', 'EP-fix', 'EP-surf']);
  assert.equal(owner.epic, 'EP-gen');            // never re-authored
});

test('gatePredicate: an inherited step is satisfied without re-review; a drifted boundHash fails', () => {
  const inherited = { id: 'architecture-review', inherited: true, inheritedFrom: 'EP-gen', boundHash: 'sha256:abc' };
  // No approvals at all, but inherited -> passes (the approval lives upstream).
  const ok = gatePredicate({ step: inherited, approvals: [], currentHash: 'sha256:abc' });
  assert.equal(ok.passed, true);
  assert.equal(ok.rule, 'inherited');
  // boundHash != current hash -> corruption, fails (re-thread).
  const drift = gatePredicate({ step: inherited, approvals: [], currentHash: 'sha256:DIFFERENT' });
  assert.equal(drift.passed, false);
  assert.match(drift.missing[0], /drifted/);
  // A normal (non-inherited) step still needs approvals (regression guard).
  const normal = gatePredicate({ step: { id: 'stories-review' }, approvals: [], currentHash: null });
  assert.equal(normal.passed, false);
});

test('sealedEpic + openDebtOnThread + threadSummary reflect ship + debt state', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' }, { stories: ['shipped', 'shipped'] });
  assert.equal(sealedEpic(T, 'EP-gen'), true);                 // all stories shipped -> sealed
  writeEpic(T, 'EP-open', { kind: 'feature', thread: 'EP-open' }, { stories: ['shipped', 'draft'] });
  assert.equal(sealedEpic(T, 'EP-open'), false);               // one draft -> open
  assert.equal(sealedEpic(T, 'EP-gen'), true);

  // A hotfix on the EP-gen thread with open debt.
  writeEpic(T, 'EP-hot', { kind: 'hotfix', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic'] },
    { debt: [{ thread: 'EP-gen', epicId: 'EP-hot', status: 'open', reason: 'outage', requires: ['artifacts-updated', 'regression-test'] }] });
  const open = openDebtOnThread(T, 'EP-gen');
  assert.equal(open.length, 1);
  assert.equal(open[0].epicId, 'EP-hot');

  const s = threadSummary(T, 'EP-gen');
  assert.equal(s.thread, 'EP-gen');
  assert.equal(s.openDebt.length, 1);
  assert.ok(s.nodes.find((n) => n.id === 'EP-gen').sealed);
});

// ── Brownfield stub genesis epics (yad-stub) ─────────────────────────────────

test('isStubEpic: detects a stub genesis by the stub:backfill-pending marker; a normal epic is not', () => {
  const T = hub();
  writeEpic(T, 'EP-stub', { kind: 'feature', thread: 'EP-stub', verified: false, stub: 'backfill-pending' });
  writeEpic(T, 'EP-real', { kind: 'feature', thread: 'EP-real' });
  assert.equal(isStubEpic(T, 'EP-stub'), true);
  assert.equal(isStubEpic(T, 'EP-real'), false);
  assert.equal(isStubEpic(T, 'EP-missing'), false);  // missing-safe
});

test('a defect threads off a stub genesis: it resolves the thread and the rollup lists it', () => {
  const T = hub();
  writeEpic(T, 'EP-stub', { kind: 'feature', thread: 'EP-stub', verified: false, stub: 'backfill-pending' });
  // A defect off the stub inherits only `epic` (the stub brief); no architecture/contract exist yet.
  writeEpic(T, 'EP-bug', { kind: 'defect', parent: 'EP-stub', thread: 'EP-stub', inherits: ['epic'] });
  const r = resolveThread(T, 'EP-bug');
  assert.equal(r.rootId, 'EP-stub');
  assert.equal(r.broken, null);                                   // a stub is a valid parent
  assert.deepEqual(threadEpics(T, 'EP-stub'), ['EP-stub', 'EP-bug']);
  // The stub owns `epic` (REPLACE base — it never inherited it); stories is ADDITIVE, so both the stub
  // genesis and the defect are lineage-level contributors (file-level ownership is resolveCurrentStories).
  const owner = resolveCurrentArtifacts(T, 'EP-stub');
  assert.equal(owner.epic, 'EP-stub');
  assert.deepEqual(owner.stories, ['EP-stub', 'EP-bug']);
  // File-level: only the defect actually has a stories/ file → it alone owns a real story id.
  writeEpic(T, 'EP-bug', { kind: 'defect', parent: 'EP-stub', thread: 'EP-stub', inherits: ['epic'] }, { stories: ['draft'] });
  const stories = resolveCurrentStories(T, 'EP-stub');
  assert.deepEqual(Object.keys(stories), ['EP-bug-S01']);
  assert.equal(stories['EP-bug-S01'], 'EP-bug');
  // The thread summary flags the stub node.
  const s = threadSummary(T, 'EP-stub');
  assert.equal(s.nodes.find((n) => n.id === 'EP-stub').stub, true);
  assert.equal(s.nodes.find((n) => n.id === 'EP-bug').stub, false);
});

test('gatePredicate: a stub-parent inherited step with boundHash:null passes (nothing locked → no drift)', () => {
  // A defect off a stub inherits the undocumented surface with a null boundHash — must not block.
  const step = { id: 'architecture-review', inherited: true, inheritedFrom: 'EP-stub', boundHash: null };
  const res = gatePredicate({ step, approvals: [], currentHash: null });
  assert.equal(res.passed, true);
  assert.equal(res.rule, 'inherited');
  assert.deepEqual(res.missing, []);
});

test('nextAction: a stub epic routes to backfill-pending (not to authoring the epic)', () => {
  const mkStub = (currentStep, kind) => ({
    state: { epicId: 'EP-stub', kind, currentStep, steps: [{ id: 'epic', type: 'author', status: 'blocked' }] },
    hubPrs: [], buildStates: [],
  });
  // Detected by state.kind === 'stub' ...
  const a = nextAction(mkStub('backfill-pending', 'stub'), { epic: 'EP-stub' });
  assert.equal(a.kind, 'backfill-pending');
  assert.match(a.why, /backfill/i);
  // ... and also by the currentStep sentinel alone (defensive).
  const b = nextAction(mkStub('backfill-pending', undefined), { epic: 'EP-stub' });
  assert.equal(b.kind, 'backfill-pending');
});

test('promote (light) clears BOTH sources: nextAction stops calling it a stub and isStubEpic agrees', () => {
  // The regression guard for the promote desync bug: light promote clears epic.md `stub:` AND rewrites
  // state.json (drop kind:stub, currentStep -> backfill-done). Both readers must then agree "not a stub".
  const T = hub();
  writeEpic(T, 'EP-promoted', { kind: 'feature', thread: 'EP-promoted', verified: true }); // stub: cleared
  assert.equal(isStubEpic(T, 'EP-promoted'), false);                    // frontmatter reader
  // A half-promoted epic left on the sentinel would misreport — assert the promoted state does NOT:
  const promoted = { state: { epicId: 'EP-promoted', currentStep: 'backfill-done',
    steps: [{ id: 'epic', type: 'author', status: 'blocked' }] }, hubPrs: [], buildStates: [] };
  const a = nextAction(promoted, { epic: 'EP-promoted' });             // ledger reader
  assert.equal(a.kind, 'backfill-done');                               // documented anchor, NOT backfill-pending
  assert.match(a.why, /documented/i);
  assert.doesNotMatch(a.why, /pending/i);
});

test('preconditionsMet: no front step is runnable on a stub or a documented anchor', () => {
  const blockedChain = [{ id: 'epic', type: 'author', status: 'blocked' }];
  // Un-promoted stub: `yad next EP-x --check epic` must NOT say "ready" (its blocked steps otherwise read as entry-ready).
  const stub = preconditionsMet({ kind: 'stub', currentStep: 'backfill-pending', steps: blockedChain }, 'epic');
  assert.equal(stub.ok, false);
  assert.match(stub.reason, /stub \(backfill pending\)/);
  // Light-promoted anchor: also not runnable — it evolves via yad-change.
  const anchor = preconditionsMet({ currentStep: 'backfill-done', steps: blockedChain }, 'epic');
  assert.equal(anchor.ok, false);
  assert.match(anchor.reason, /documented backfill anchor/);
  // Regression guard: a NORMAL epic entry step is still runnable (the short-circuit didn't over-reach).
  const normal = preconditionsMet({ currentStep: 'epic', steps: [{ id: 'epic', type: 'author', status: 'in_progress' }] }, 'epic');
  assert.equal(normal.ok, true);
});

test('epicLineage defaults an un-migrated genesis epic to kind:feature', () => {
  const T = hub();
  // No kind/parent/thread frontmatter at all.
  const dir = path.join(T, 'epics', 'EP-legacy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'epic.md'), '---\nid: EP-legacy\nrepos: [backend]\n---\n\n## Goal\nx\n');
  const lin = epicLineage(T, 'EP-legacy');
  assert.equal(lin.kind, 'feature');
  assert.equal(lin.parent, null);
  assert.deepEqual(resolveThread(T, 'EP-legacy').chain, ['EP-legacy']);
});
