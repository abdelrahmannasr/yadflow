// Phase 6 feature-thread engine tests. Run: node --test cli/test-threads.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveThread, threadEpics, resolveCurrentArtifacts, resolveCurrentStories, epicLineage, gatePredicate,
  isStubEpic, nextAction, preconditionsMet, backfillAnchorKind, TYPE_NOUN, typeNoun,
  workItemType, isGenesisType, WORK_ITEM_TYPES, readFrontmatter, themeOf, themeKey,
  PHASES, stepPhase, currentPhase, phaseOf, phaseSteps, SENTINELS, STEP_SKILL, BUILD_STEP_SKILL,
  STEPS, stepDef, artifactBase, artifactFromBase, authorStepFor,
  LIFECYCLE_PROFILES, lifecycleProfile, profileSteps, matchLifecycleProfile, optionalStepsOf,
  seedableProfiles, seedState, stateInvariants, shape6Routes, advanceState, skipStep, routeLacksStep,
  PRODUCT_PHASES, FOUNDATION_EPIC, FOUNDATION_DIR, FOUNDATION_SECTIONS, FOUNDATION_REQUIRED, epicRoot, epicRel,
  epicIds, foundationHash, artifactHash, artifactPaths, parseReviewBranch, seedFoundationState, productProfiles, contractSurfaceHash,
  isProductLevel, PRODUCT_DONE, stepSkills,
} from './epic-state.mjs';
import { SCHEMA_VERSION as ENGINE_SHAPE } from './manifest.mjs';
import { sealedEpic, openDebtOnThread, threadSummary, runThread } from './thread.mjs';

// E62: a record's `by` asks `gh`/`glab` who is logged in. The suite must never ask the developer's real
// account — the answer would differ per machine — so the lookup is off for every test in this file and
// every CLI it spawns. The lookup's own tests pass `env` explicitly.
process.env.YAD_PLATFORM_LOGIN = '0';

// Capture console.log output produced while running fn (the CLI commands print via console.log).
async function grab(fn) {
  const orig = console.log;
  const out = [];
  console.log = (...a) => out.push(a.map(String).join(' '));
  try { await fn(); } finally { console.log = orig; }
  return out.join('\n');
}

// Minimal Product builder: write an epic with lineage frontmatter (+ optional stories/lock/debt).
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

test('resolveCurrentArtifacts: an epic never owns an artifact its ROUTE has no step for (E40)', () => {
  const T = hub();
  const dir = writeEpic(T, 'EP-chore', { kind: 'chore', thread: 'EP-chore' });
  // A short lane: no architecture, ui-design or test-cases step, and no `inherits:` either — it has no
  // parent to inherit from. `inherits` alone would therefore read "did not inherit it, so authored it"
  // and hand this epic four artifacts it will never produce. `yad-change` reads this map to pick a
  // threaded defect's `inheritedFrom`, so a false owner here becomes a forged provenance record there.
  fs.writeFileSync(path.join(dir, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-chore', profile: 'chore', currentStep: 'epic',
    steps: [{ id: 'epic' }, { id: 'epic-review' }, { id: 'stories' }, { id: 'stories-review' }],
  }));
  const owner = resolveCurrentArtifacts(T, 'EP-chore');
  assert.equal(owner.epic, 'EP-chore', 'it does author the epic');
  assert.deepEqual(owner.stories, ['EP-chore'], 'and the stories');
  assert.equal(owner.architecture, null);
  assert.equal(owner.contract, null, '`contract.md` is authored by the architecture step, which is absent');
  assert.equal(owner['ui-design'], null);
  assert.deepEqual(owner['test-cases'], []);
});

test('routeLacksStep: one rule, and it asks the RECORDED route rather than the chain (E40)', () => {
  // Three readers share this: `yad next`'s phase line, the review-PR contract checklist, and the
  // thread's artifact-ownership map. All three first inferred it from the chain, and all three were
  // wrong the same way — a truncated legacy chain is not a short lane, and treating it as one both
  // told a `classic` epic it was on one and stripped it of artifacts sitting on its disk.
  const chore = { profile: 'chore', steps: [{ id: 'epic' }, { id: 'stories' }] };
  assert.equal(routeLacksStep(chore, 'architecture'), true);
  assert.equal(routeLacksStep(chore, 'epic'), false);

  // A truncated `classic` chain — this repo's own e2e fixtures are exactly this — keeps every step.
  const legacy = { profile: 'classic', steps: [{ id: 'epic' }, { id: 'epic-review' }] };
  assert.equal(routeLacksStep(legacy, 'architecture'), false, 'the ROUTE has it; this chain merely predates it');
  assert.equal(routeLacksStep(legacy, 'test-cases'), false);

  // No key, an unknown key, and no state at all are the same conservative answer: assume it has the
  // step. That is what every one of the three readers said before the short lanes existed, so an epic
  // that never declares its route sees no change in behaviour.
  assert.equal(routeLacksStep({ steps: [{ id: 'epic' }] }, 'architecture'), false);
  assert.equal(routeLacksStep({ profile: 'moonshot' }, 'architecture'), false);
  assert.equal(routeLacksStep(null, 'architecture'), false);

  // A SKIPPED step is not a missing one, and asking the route gets that for free — no special case.
  const skipped = { profile: 'classic', steps: [{ id: 'ui-design', skipped: true, status: 'done' }] };
  assert.equal(routeLacksStep(skipped, 'ui-design'), false);
});

test('resolveCurrentArtifacts: a SKIPPED step still owns its artifact, and an unreadable chain owns everything', () => {
  // Two boundaries the rule above must not cross.
  //
  // A skipped `ui-design` is IN the chain, pre-marked done with a recorded reason — this epic's own
  // decision about an artifact that is genuinely its to decide. That is the opposite of a step the
  // route never had, and collapsing the two would erase the distinction E35 exists to draw.
  const T = hub();
  const dir = writeEpic(T, 'EP-skip', { kind: 'feature', thread: 'EP-skip' });
  fs.writeFileSync(path.join(dir, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-skip', profile: 'classic', currentStep: 'stories',
    steps: [{ id: 'epic' }, { id: 'epic-review' }, { id: 'architecture' }, { id: 'architecture-review' },
      { id: 'ui-design', skipped: true, status: 'done' }, { id: 'ui-design-review', skipped: true, status: 'done' },
      { id: 'stories' }, { id: 'stories-review' }, { id: 'test-cases' }, { id: 'test-cases-review' }],
  }));
  assert.equal(resolveCurrentArtifacts(T, 'EP-skip')['ui-design'], 'EP-skip');

  // And an epic whose ledger cannot be read keeps every base it had before this rule. A file that will
  // not parse is not evidence that the epic owns nothing — `yad doctor` reports it (rule 3), and this
  // map must not quietly start dropping provenance because of it.
  const T2 = hub();
  const d2 = writeEpic(T2, 'EP-broken', { kind: 'feature', thread: 'EP-broken' });
  fs.writeFileSync(path.join(d2, '.sdlc/state.json'), '{ not json');
  const broken = resolveCurrentArtifacts(T2, 'EP-broken');
  assert.equal(broken.architecture, 'EP-broken');
  assert.deepEqual(broken['test-cases'], ['EP-broken']);

  // Same for an epic with no `state.json` at all, which is every pre-ledger fixture in the wild.
  const T3 = hub();
  writeEpic(T3, 'EP-bare', { kind: 'feature', thread: 'EP-bare' });
  assert.equal(resolveCurrentArtifacts(T3, 'EP-bare').architecture, 'EP-bare');

  // AND THE CASE THE FIRST VERSION OF THIS RULE GOT WRONG. A truncated `classic` chain — seeded
  // before later steps existed, which is the shape of this repo's own e2e fixtures — keeps every base.
  // Losing an owner is exactly as wrong as inventing one, and `yad-change` reads this map either way.
  const T4 = hub();
  const d4 = writeEpic(T4, 'EP-old', { kind: 'feature', thread: 'EP-old' });
  fs.writeFileSync(path.join(d4, '.sdlc/state.json'), JSON.stringify({
    epicId: 'EP-old', profile: 'classic', currentStep: 'stories',
    steps: [{ id: 'epic' }, { id: 'epic-review' }, { id: 'architecture' }, { id: 'architecture-review' },
      { id: 'stories' }, { id: 'stories-review' }],
  }));
  const old = resolveCurrentArtifacts(T4, 'EP-old');
  assert.equal(old['ui-design'], 'EP-old', 'the route has ui-design even though this old chain lacks it');
  assert.deepEqual(old['test-cases'], ['EP-old']);
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

test('preconditionsMet: no Shape step is runnable on a stub or a documented anchor', () => {
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

test('backfillAnchorKind: one classifier drives nextAction + preconditionsMet — they cannot diverge', () => {
  // Normal states.
  assert.equal(backfillAnchorKind({ kind: 'stub', currentStep: 'backfill-pending' }), 'stub');
  assert.equal(backfillAnchorKind({ currentStep: 'backfill-done' }), 'documented');
  assert.equal(backfillAnchorKind({ currentStep: 'epic' }), null);
  assert.equal(backfillAnchorKind(null), null);
  // Corrupted / partially-applied promote (kind:stub AND currentStep:backfill-done): the `stub` check
  // wins (conservative — "still needs promoting"), and BOTH readers agree, closing the divergence.
  const corrupt = { kind: 'stub', currentStep: 'backfill-done', steps: [{ id: 'epic', type: 'author', status: 'blocked' }] };
  assert.equal(backfillAnchorKind(corrupt), 'stub');
  assert.equal(nextAction({ state: { epicId: 'EP-x', ...corrupt }, hubPrs: [], buildStates: [] }, { epic: 'EP-x' }).kind, 'backfill-pending');
  assert.match(preconditionsMet(corrupt, 'epic').reason, /stub \(backfill pending\)/);  // NOT "documented anchor"
});

test('typeNoun renders the human noun per work-item type and falls back to Epic', () => {
  assert.equal(typeNoun('feature'), 'Epic');
  assert.equal(typeNoun('change'), 'Change request');
  assert.equal(typeNoun('defect'), 'Defect');   // a bug is a defect — same noun
  assert.equal(typeNoun('hotfix'), 'Hotfix');
  assert.equal(typeNoun('chore'), 'Chore');      // the fifth type, new in shape 5
  assert.equal(typeNoun(undefined), 'Epic');     // absent type → Epic
  assert.equal(typeNoun('nonsense'), 'Epic');    // unknown type → Epic
  assert.equal(TYPE_NOUN.defect, 'Defect');
});

test('runThread renders each node with its kind noun, not the generic word "epic"', async () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  writeEpic(T, 'EP-fix', { kind: 'defect', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic'] });
  const out = await grab(() => runThread(T, { epic: 'EP-gen' }));
  assert.match(out, /EP-gen\s+Epic/);     // the feature genesis reads "Epic"
  assert.match(out, /EP-fix\s+Defect/);   // the defect node reads "Defect"
});

test('epicLineage defaults an un-migrated genesis epic to type:feature', () => {
  const T = hub();
  // No kind/type/parent/thread frontmatter at all.
  const dir = path.join(T, 'epics', 'EP-legacy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'epic.md'), '---\nid: EP-legacy\nrepos: [backend]\n---\n\n## Goal\nx\n');
  const lin = epicLineage(T, 'EP-legacy');
  assert.equal(lin.type, 'feature');
  assert.equal(lin.parent, null);
  assert.deepEqual(resolveThread(T, 'EP-legacy').chain, ['EP-legacy']);
});

// ---- the work-item type (E21) --------------------------------------------------------------------

test('workItemType reads the OLD name first — `kind:` still wins for this whole major', () => {
  // The rename is staged: `type:` is written beside `kind:`, and `kind:` is the one that counts
  // until the next major. If the new name won here, a repo that ran `yad migrate` but not
  // `yad update` would have `lineage-check.sh` (which reads `kind:`) and the engine disagreeing
  // about what a work item IS — and the gate would stop asking a change-epic for its parent.
  assert.equal(workItemType({ kind: 'defect', type: 'feature' }), 'defect');
  assert.equal(workItemType({ type: 'defect' }), 'defect', 'the new name alone is read');
  assert.equal(workItemType({ kind: 'change' }), 'change', 'the old name alone is read');
  assert.equal(workItemType({}), 'feature', 'nothing written at all is a genesis');
  assert.equal(workItemType(), 'feature');
});

test('workItemType hands back a value it does not recognise instead of correcting it', () => {
  // Quietly reading a typo as `feature` would make it parent-free, which drops the lineage gate on
  // a work item that may well be a defect. Doctor reports the value; nothing here guesses.
  assert.equal(workItemType({ kind: 'Defect' }), 'Defect');
  assert.equal(workItemType({ kind: 'nonsense' }), 'nonsense');
  assert.equal(workItemType({ kind: 42 }), 'feature', 'a non-string is not a type at all');
});

test('isGenesisType: feature and chore may stand alone, the other three may not', () => {
  assert.equal(isGenesisType('feature'), true);
  assert.equal(isGenesisType('chore'), true, 'upkeep often has no feature to hang off');
  for (const t of ['change', 'defect', 'hotfix']) {
    assert.equal(isGenesisType(t), false, `${t} is work ON something and must name it`);
  }
  assert.equal(isGenesisType(undefined), false);
  assert.deepEqual(WORK_ITEM_TYPES, ['feature', 'change', 'defect', 'hotfix', 'chore']);
});

test('a parentless chore resolves as its own thread root', () => {
  // The walk in resolveThread stops on "no parent", not on the type — so this already worked. The
  // test pins it, because the alternative (stopping on `feature`) would strand every chore.
  const T = hub();
  writeEpic(T, 'EP-bump-deps', { kind: 'chore', status: 'draft', repos: ['backend'] });
  const lin = epicLineage(T, 'EP-bump-deps');
  assert.equal(lin.type, 'chore');
  assert.equal(lin.parent, null);
  const { rootId, chain, broken } = resolveThread(T, 'EP-bump-deps');
  assert.equal(broken, null, 'a chore with no parent is not broken lineage');
  assert.equal(rootId, 'EP-bump-deps');
  assert.deepEqual(chain, ['EP-bump-deps']);
});

test('epicLineage reads `type:` when an epic.md carries only the new name', () => {
  const T = hub();
  writeEpic(T, 'EP-new', { type: 'defect', parent: 'EP-old', thread: 'EP-old', repos: ['backend'] });
  writeEpic(T, 'EP-old', { type: 'feature', repos: ['backend'] });
  assert.equal(epicLineage(T, 'EP-new').type, 'defect');
  assert.equal(resolveThread(T, 'EP-new').rootId, 'EP-old');
});

// ---- the skill templates are read back by the engine that reads real epics -----------------------

// Both skills say "use EXACTLY this template", and the block they show goes into a real `epic.md`.
// Nothing checked that the engine could read it back, and it could not: a trailing `# comment` in
// frontmatter is NOT stripped by `readFrontmatter`, nor by `fm_val` in the bash check gates — the
// whole rest of the line becomes the value. A commented `kind:` reads as a type nobody defined, so
// the epic stops being a genesis and `lineage-check` refuses every commit that links a story to it.
// A commented `thread:` reads as a cache that disagrees with the computed root, so `yad doctor` fails.
// Every epic the tool creates went through one of these two templates.
const TEMPLATE_KEYS = ['id', 'status', 'kind', 'type', 'theme', 'thread', 'verified', 'stub', 'owner', 'repos'];

// Pull the first fenced ```markdown block that opens with a `---` frontmatter fence.
function templateFrontmatter(skillFile) {
  const src = fs.readFileSync(new URL(`../skills/${skillFile}`, import.meta.url), 'utf8');
  const m = src.match(/```markdown\n(---\n[\s\S]*?\n---\n)/);
  assert.ok(m, `${skillFile}: no markdown frontmatter template found`);
  return m[1];
}

// The three skills that author an `epic.md`. `yad-change`'s template writes a THREADED epic, so its
// row substitutes a real type in for the `<change|defect|hotfix>` placeholder and plants the parent it
// names on disk — without that its `parent:` and `thread:` cannot resolve and the round trip proves
// nothing about them.
for (const [skillFile, expected] of [
  ['yad-epic/SKILL.md', { kind: 'feature', type: 'feature', genesis: true, root: 'EP-demo' }],
  ['yad-stub/SKILL.md', { kind: 'feature', type: 'feature', genesis: true, stub: 'backfill-pending', root: 'EP-demo' }],
  ['yad-change/SKILL.md', {
    kind: 'defect', type: 'defect', genesis: false, root: 'EP-parent',
    fill: (t) => t
      .replace('<change|defect|hotfix>', 'defect')
      .replace('<the same value as kind>', 'defect')
      .replace('<EP-parent>', 'EP-parent')
      .replace('<EP-genesis>', 'EP-parent')
      // This template's `theme:` is a placeholder telling the author to copy the parent's tag down,
      // not a blank. Fill it the way the skill says to, and check it reads back as that exact tag.
      .replace("<the parent's theme, or leave empty>", 'checkout-revamp'),
    parent: 'EP-parent',
    theme: 'checkout-revamp',
  }],
]) {
  test(`${skillFile}: the epic.md template it tells people to copy reads back correctly`, () => {
    const T = hub();
    if (expected.parent) writeEpic(T, expected.parent, { kind: 'feature', thread: expected.parent });
    const dir = path.join(T, 'epics', 'EP-demo');
    fs.mkdirSync(dir, { recursive: true });
    const filled = (expected.fill || ((t) => t))(templateFrontmatter(skillFile));
    fs.writeFileSync(path.join(dir, 'epic.md'), filled.replace(/EP-<slug>/g, 'EP-demo') + '\n## Goal\nx\n');

    const fm = readFrontmatter(path.join(dir, 'epic.md'));
    // No value the engine reads may carry a trailing comment — that is the whole failure.
    for (const k of TEMPLATE_KEYS) {
      if (typeof fm[k] === 'string') {
        assert.equal(fm[k].includes('#'), false, `${k} carries a comment: ${JSON.stringify(fm[k])}`);
      }
    }
    assert.equal(fm.kind, expected.kind);
    assert.equal(fm.type, expected.type, 'the template writes BOTH names');
    assert.equal(workItemType(fm), expected.kind);
    assert.equal(isGenesisType(workItemType(fm)), expected.genesis);
    if (expected.stub) assert.equal(isStubEpic(T, 'EP-demo'), true, 'the stub marker is readable');
    // The grouping tag round-trips: an empty `theme:` reads back as NO theme rather than as a value,
    // and a filled one reads back as exactly what was written.
    assert.equal(epicLineage(T, 'EP-demo').theme, expected.theme ?? null);
    // …and the thread cache resolves, which is what `yad doctor` checks.
    assert.equal(resolveThread(T, 'EP-demo').broken, null);
    assert.equal(resolveThread(T, 'EP-demo').rootId, expected.root);
    fs.rmSync(T, { recursive: true, force: true });
  });
}

// ---- the grouping theme (E31) --------------------------------------------------------------------

test('themeOf: a theme is ONE tag, and having none is the normal answer', () => {
  assert.equal(themeOf({ theme: 'checkout-revamp' }), 'checkout-revamp');
  assert.equal(themeOf({ theme: '  checkout-revamp  ' }), 'checkout-revamp', 'trimmed');
  assert.equal(themeOf({}), null, 'no theme is not an error, it is most epics');
  assert.equal(themeOf(), null);
  assert.equal(themeOf({ theme: '' }), null, 'the template ships the key empty');
  assert.equal(themeOf({ theme: '   ' }), null);
  // `readFrontmatter` turns `theme: [a, b]` into an array. A theme groups by being one value, so a
  // list is not a weaker theme, it is no theme — and `yad doctor` says so out loud.
  assert.equal(themeOf({ theme: ['a', 'b'] }), null);
  assert.equal(themeOf({ theme: 42 }), null);
  assert.equal(themeOf({ theme: null }), null);
});

test('themeKey folds the ways one theme gets typed, and keeps different themes apart', () => {
  const same = ['checkout-revamp', 'Checkout Revamp', 'checkout_revamp', 'CheckoutRevamp', ' checkout revamp '];
  const keys = new Set(same.map(themeKey));
  assert.equal(keys.size, 1, `these are one theme typed five ways, folded to ${[...keys].join(' / ')}`);
  assert.notEqual(themeKey('checkout'), themeKey('checkout-revamp'), 'different themes stay different');
  assert.equal(themeKey(null), '');
  // Letters and digits in ANY script survive the fold. An ASCII-only fold flattens a whole team's
  // themes to the empty string at once — they would look identical to each other AND to a tag of pure
  // punctuation, so `yad doctor` would call every one of them ungroupable with no way to clear it.
  assert.equal(themeKey('Дизайн'), 'дизайн');
  assert.equal(themeKey('дизайн'), themeKey('Дизайн'), 'case folds outside ASCII too');
  assert.notEqual(themeKey('дизайн'), themeKey('结账改版'), 'and two of them stay apart');
  assert.equal(themeKey('结账改版'), '结账改版');
  // An empty fold means one thing only: nothing in the tag to match another epic on.
  assert.equal(themeKey('###'), '');
  assert.equal(themeKey('🎯'), '');
});

test('epicLineage carries the theme, and null when there is none', () => {
  const T = hub();
  writeEpic(T, 'EP-a', { kind: 'feature', thread: 'EP-a', theme: 'checkout-revamp' });
  writeEpic(T, 'EP-b', { kind: 'feature', thread: 'EP-b' });
  writeEpic(T, 'EP-c', { kind: 'feature', thread: 'EP-c', theme: ['x', 'y'] });
  assert.equal(epicLineage(T, 'EP-a').theme, 'checkout-revamp');
  assert.equal(epicLineage(T, 'EP-b').theme, null);
  assert.equal(epicLineage(T, 'EP-c').theme, null, 'a list is read as no theme');
  // The theme is additive: nothing else about the lineage moved.
  assert.equal(epicLineage(T, 'EP-a').type, 'feature');
  assert.equal(epicLineage(T, 'EP-a').kind, 'feature');
  fs.rmSync(T, { recursive: true, force: true });
});

test('yad thread --json carries the theme; the printed tree shows it only when set', async () => {
  const T = hub();
  writeEpic(T, 'EP-cart', { kind: 'feature', thread: 'EP-cart', theme: 'checkout-revamp' });
  writeEpic(T, 'EP-cart-fix', { kind: 'defect', parent: 'EP-cart', thread: 'EP-cart', theme: 'checkout-revamp' });
  writeEpic(T, 'EP-plain', { kind: 'feature', thread: 'EP-plain' });

  const nodes = threadSummary(T, 'EP-cart').nodes;
  assert.deepEqual(nodes.map((n) => n.theme), ['checkout-revamp', 'checkout-revamp'],
    'a change inherits nothing automatically — yad-change copies the parent tag down');
  assert.equal(threadSummary(T, 'EP-plain').nodes[0].theme, null);

  const themed = await grab(() => runThread(T, { epic: 'EP-cart' }));
  assert.match(themed, /#checkout-revamp/);
  const plain = await grab(() => runThread(T, { epic: 'EP-plain' }));
  assert.equal(plain.includes('#'), false, 'no theme, no marker — an empty tag on every line is noise');
  fs.rmSync(T, { recursive: true, force: true });
});

test('yad thread with no epic lists each thread under its theme', async () => {
  // This list is where a person looks to see which threads belong together, so it is where the tag
  // does the most work. The theme shown is the GENESIS epic's — the thread's own heading.
  const T = hub();
  writeEpic(T, 'EP-cart', { kind: 'feature', thread: 'EP-cart', theme: 'checkout-revamp' });
  writeEpic(T, 'EP-cart-fix', { kind: 'defect', parent: 'EP-cart', thread: 'EP-cart', theme: 'checkout-revamp' });
  writeEpic(T, 'EP-plain', { kind: 'feature', thread: 'EP-plain' });
  const out = await grab(() => runThread(T, {}));
  assert.match(out, /EP-cart #checkout-revamp {2}2 epic\(s\)/);
  assert.match(out, /EP-plain {2}1 epic\(s\)/, 'no theme, no marker');
  fs.rmSync(T, { recursive: true, force: true });
});

// ---- the step catalogue (E4) ---------------------------------------------------------------------

test('the catalogue is self-consistent — every row answers for itself', () => {
  // The whole point of E4 is that a step is defined ONCE. That only holds if the one definition is
  // internally sound, so each rule below is a way the table could lie without any caller noticing.
  const ids = STEPS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'a duplicate id would make stepDef return one of two rows');
  const phaseIds = new Set(PHASES.map((p) => p.id));
  const productPhaseIds = new Set(PRODUCT_PHASES.map((p) => p.id));
  for (const r of STEPS) {
    // Each LEVEL has its own ladder (E75): a feature step sits in one of the six phases, a product step
    // in the Product level's own phase — and never the other way round, which would put the Foundation
    // on the feature lifecycle or a feature step before every epic.
    const ladder = r.level === 'product' ? productPhaseIds : phaseIds;
    assert.ok(ladder.has(r.phase), `${r.id}: phase '${r.phase}' is not on the ${r.level} ladder`);
    assert.ok(['author', 'review'].includes(r.kind), `${r.id}: kind '${r.kind}'`);
    assert.ok(Array.isArray(r.risk_tags), `${r.id}: risk_tags must be a list`);
    assert.ok(['feature', 'product'].includes(r.level), `${r.id}: level '${r.level}'`);
    // An author step is something a person or agent RUNS, so it must say what runs it.
    if (r.kind === 'author') assert.ok(r.skill, `${r.id}: an author step with no skill cannot be run`);
    // A Shape step writes a file into the epic directory, and its gate hashes that file. A BUILD step
    // does not: Build runs per story per code repo and is recorded in `build-state/`, so there is no
    // epic-level artifact to name and no epic-level gate to hash one. Without this rule a new step
    // could be added with no artifact and nothing would object until a gate had nothing to bind to.
    if (r.phase === 'build') assert.equal(r.artifact, null, `${r.id}: a Build step has no epic-level artifact`);
    else assert.ok(r.artifact, `${r.id}: a Shape step must name what it writes or reviews`);
    // A gate must point at a step that exists, or it can never close its author step.
    if (r.reviews) {
      const target = stepDef(r.reviews);
      assert.ok(target, `${r.id}: reviews '${r.reviews}', which is not in the catalogue`);
      assert.equal(target.kind, 'author', `${r.id}: reviews '${r.reviews}', which is not an author step`);
      assert.equal(target.phase, r.phase, `${r.id}: a gate belongs to the phase of what it reviews`);
      assert.equal(target.artifact, r.artifact, `${r.id}: a gate reviews the artifact its author step wrote`);
    }
    if (r.reviews) assert.equal(r.kind, 'review', `${r.id}: only a gate reviews something`);
  }
  // Exactly one gate per author step that has one — two gates on one step would both try to close it.
  const gatedTwice = ids.filter((id) => STEPS.filter((r) => r.reviews === id).length > 1);
  assert.deepEqual(gatedTwice, []);
});

test('the catalogue and the artifact helpers agree on every step that writes a file', () => {
  // `artifactBase` / `artifactFromBase` are NOT derived from the catalogue: they also serve artifact
  // bases that no step writes (`contract`), and `artifactHash` special-cases some of them (stories
  // hashes a directory, architecture hashes the locked contract surface too). Rather than merge them
  // and risk the gate hashing something different, the two are pinned in AGREEMENT here.
  for (const r of STEPS.filter((x) => x.artifact)) {
    const base = artifactBase(r.artifact);
    assert.equal(artifactFromBase(base), r.artifact,
      `${r.id}: '${r.artifact}' does not survive the round trip through base '${base}'`);
  }
});

test('the derived tables are views of the catalogue, not copies beside it', () => {
  // Each of these was a hand-kept table before E4. If any of them stops agreeing, a step has been
  // added in one place and forgotten in another — the exact failure the catalogue exists to end.
  // The SAME rule the production derivation uses — `build` or not — not a second rule that agrees with
  // it today. An allowlist of Shape phases here and a denylist there would agree only until the first
  // `release` step (E32) landed in neither, leaving `yad next` with no skill to name for it.
  assert.deepEqual(
    STEP_SKILL,
    Object.fromEntries(STEPS.filter((r) => r.skill && r.phase !== 'build').map((r) => [r.id, r.skill])),
  );
  assert.deepEqual(
    BUILD_STEP_SKILL,
    Object.fromEntries(STEPS.filter((r) => r.skill && r.phase === 'build').map((r) => [r.id, r.skill])),
  );
  for (const p of [...PHASES, ...PRODUCT_PHASES]) {
    assert.deepEqual(
      phaseSteps(p.id),
      STEPS.filter((r) => r.phase === p.id && !r.reviews).map((r) => r.id),
      `phaseSteps('${p.id}') drifted from the catalogue`,
    );
  }
  // And the values themselves are unchanged from before E4 — a derivation that agrees with itself but
  // renamed a skill would pass everything above. `foundation` is the one addition (E75), and it is run
  // by the skill that already ran its old spelling.
  assert.deepEqual(STEP_SKILL, {
    foundation: 'yad-discovery',
    discovery: 'yad-discovery', analysis: 'yad-analysis', epic: 'yad-epic',
    architecture: 'yad-architecture', 'ui-design': 'yad-ui', stories: 'yad-stories',
    'test-cases': 'yad-test-cases',
  });
  assert.deepEqual(BUILD_STEP_SKILL, {
    spec: 'yad-spec', tasks: 'yad-spec', implement: 'yad-implement',
    checks: 'yad-checks', 'engineer-review': 'yad-engineer-review',
  });
});

test('a gate finds its author step through the catalogue, and engineer-review gates nothing', () => {
  const chain = (ids) => ({ steps: ids.map((id) => ({ id, type: 'author', status: 'todo' })) });
  const st = chain(['epic', 'epic-review', 'architecture', 'architecture-review']);
  assert.equal(authorStepFor(st, { id: 'epic-review' }).id, 'epic');
  assert.equal(authorStepFor(st, { id: 'architecture-review' }).id, 'architecture');
  assert.equal(authorStepFor(st, { id: 'epic' }), null, 'an author step reviews nothing');
  // `engineer-review` is the last step of Build, not the review of a step called `engineer`. Before
  // E4 this worked only because no chain happens to contain a step called `engineer` — plant one and
  // the old string-strip would have closed it as if the merge gate had reviewed it.
  const trap = chain(['engineer', 'engineer-review']);
  assert.equal(authorStepFor(trap, { id: 'engineer-review' }), null);
  // An id from a newer release still resolves by the convention every gate in the catalogue follows.
  const future = chain(['feasibility', 'feasibility-review']);
  assert.equal(authorStepFor(future, { id: 'feasibility-review' }).id, 'feasibility');
  // But the fallback never strips onto a base the catalogue knows to be something else. `checks` is a
  // Build step nothing gates, so `checks-review` — not a step at all — must not resolve to it: a chain
  // listing both would otherwise make `stateInvariants` demand a repair, and `yad gate repair` would
  // flip `checks` to done as though the merge gate had reviewed it.
  const bad = chain(['checks', 'checks-review']);
  assert.equal(authorStepFor(bad, { id: 'checks-review' }), null);
  const alsoBad = chain(['epic-review', 'epic-review-review']);
  assert.equal(authorStepFor(alsoBad, { id: 'epic-review-review' }), null, 'a gate does not gate a gate');
});

// ---- lifecycle profiles (E5) ---------------------------------------------------------------------

// Every route this release carries, written out verbatim. If the table has described one wrongly,
// every assertion below is measuring the wrong thing — so they are spelled out here rather than
// derived from the same code under test. The first three are the chains five skill files seeded by
// hand before E5; `chore` and `spike` are E40's short lanes, which nobody seeded before.
const CLASSIC_10 = ['epic', 'epic-review', 'architecture', 'architecture-review',
  'ui-design', 'ui-design-review', 'stories', 'stories-review', 'test-cases', 'test-cases-review'];
const ANALYSIS_12 = ['analysis', 'analysis-review', ...CLASSIC_10];
const CHORE_4 = ['epic', 'epic-review', 'stories', 'stories-review'];
const SPIKE_6 = ['analysis', 'analysis-review', ...CHORE_4];
const DISCOVERY_2 = ['discovery', 'discovery-review'];
const FOUNDATION_2 = ['foundation', 'foundation-review'];

test('the profiles are the chains the skills already seed, step for step', () => {
  assert.deepEqual(profileSteps('classic'), CLASSIC_10);
  assert.deepEqual(profileSteps('analysis-first'), ANALYSIS_12);
  assert.deepEqual(profileSteps('chore'), CHORE_4);
  assert.deepEqual(profileSteps('spike'), SPIKE_6);
  assert.deepEqual(profileSteps('discovery'), DISCOVERY_2);
  assert.deepEqual(profileSteps('foundation'), FOUNDATION_2);
  assert.deepEqual(LIFECYCLE_PROFILES.map((p) => p.id),
    ['classic', 'analysis-first', 'chore', 'spike', 'discovery', 'foundation']);
  assert.equal(lifecycleProfile('nonsense'), null, 'a route this release does not carry is null, not a guess');
  assert.deepEqual(profileSteps('nonsense'), []);
});

test('a short lane makes "no optional steps" mean something new, and `yad skip` says which (E40)', () => {
  // THE INVARIANT E40 BROKE. Before the short lanes every feature route marked exactly one step
  // optional, so an empty answer could only mean the chain fitted no route — and `notOptional` had one
  // branch for both. `chore` and `spike` are routes the release fully recognises on which NOTHING is
  // optional, because they dropped those steps from the chain instead of marking them skippable.
  //
  // The refusal is right either way; what this pins is that the epic is not told to go chase a
  // `step:off-route` finding that will never fire on a chain matching its route perfectly.
  for (const id of ['chore', 'spike']) {
    assert.deepEqual(optionalStepsOf(id), [], `${id}: a short lane has nothing left to make optional`);
    const s = seedState({ epic: 'EP-demo', profile: id, type: 'chore', today: '2026-01-02' });
    assert.throws(() => skipStep(s, 'ui-design', { reason: 'no screens' }), (e) => {
      assert.match(e.hint, new RegExp(`on the \`${id}\` route`), 'the hint names the route the epic is on');
      assert.doesNotMatch(e.hint, /step:off-route/, 'and does not send a healthy epic to a check that cannot fire');
      return true;
    });
  }
  // The other two branches still say their own thing: a route WITH an optional step lists it, and a
  // chain on no route at all keeps the off-route remedy that is correct for it.
  const classic = seedState({ epic: 'EP-demo', profile: 'classic', type: 'feature', today: '2026-01-02' });
  assert.throws(() => skipStep(classic, 'architecture', { reason: 'x' }), /not optional/);
  try { skipStep(classic, 'architecture', { reason: 'x' }); } catch (e) {
    assert.match(e.hint, /only these steps may be skipped here: ui-design/);
  }
  try { skipStep({ steps: [{ id: 'stories' }, { id: 'epic' }] }, 'ui-design', { reason: 'x' }); } catch (e) {
    assert.match(e.hint, /step:off-route/, 'an off-route chain keeps the remedy that fits it');
  }
});

test('matchLifecycleProfile: a chain says which route it is on, and says nothing when it is on none', () => {
  const S = (ids) => ids.map((id) => ({ id }));
  assert.equal(matchLifecycleProfile(S(CLASSIC_10)), 'classic');
  assert.equal(matchLifecycleProfile(S(ANALYSIS_12)), 'analysis-first');
  assert.equal(matchLifecycleProfile(S(CHORE_4)), 'chore');
  assert.equal(matchLifecycleProfile(S(SPIKE_6)), 'spike');
  assert.equal(matchLifecycleProfile(S(DISCOVERY_2)), 'discovery');
  // Leaving a step out is normal — an epic with no screens drops `ui-design` and is still classic.
  assert.equal(matchLifecycleProfile(S(CLASSIC_10.filter((x) => !x.startsWith('ui-design')))), 'classic');
  // The tie that length breaks: the 10-step chain is also a correctly ordered subset of the 12-step
  // one. Without the shortest-wins rule every classic epic would read as an analysis-first epic that
  // skipped its first two steps — and E17 would then seed the wrong route from the wrong answer.
  //
  // E40 turned that rule from a tidy-up into the load-bearing one, because the short lanes are the
  // first routes DECLARED after routes they are shorter than. `chore` is an ordered subset of
  // `classic`, and of `spike`; both pairs resolve the wrong way on declaration order. The reversed
  // list further down is what proves length is the rule and position in the table is not.
  assert.equal(matchLifecycleProfile(S(['epic', 'epic-review'])), 'chore',
    'these two fit chore and classic alike — the SHORTER route is the answer');
  assert.equal(matchLifecycleProfile(S(['analysis', 'analysis-review', 'epic'])), 'spike',
    'and the analyst pair leads into the spike lane before it reads as the 12-step chain');
  assert.equal(matchLifecycleProfile(S(['epic', 'epic-review', 'architecture'])), 'classic',
    'one step no short lane carries, and classic is the only fit left');

  // A MIGRATION MUST NOT GET THIS ANSWER. These two steps read as `classic` before the chore lane
  // existed, so shape 6 — which answers a question about the past — keeps saying `classic` for them.
  // `stampProfile` freezes its route set for exactly this pair of answers.
  assert.equal(matchLifecycleProfile(S(['epic', 'epic-review']), shape6Routes()), 'classic');

  // A caller-supplied route must be MATCHED, not silently dropped. The seam reads the rows off the
  // profile it is handed; resolving `p.id` through the module's own index instead would come back
  // empty for a route that is not in it, the route would never fit, and the answer would be a wrong
  // one with no error.
  const tiny = { id: 'tiny-lane', level: 'feature', steps: ['epic', 'epic-review'] };
  assert.equal(matchLifecycleProfile(S(['epic', 'epic-review']), [...LIFECYCLE_PROFILES, tiny]), 'tiny-lane',
    'a two-step route beats the four-step chore lane on the same two steps');
  assert.equal(matchLifecycleProfile(S(['epic', 'epic-review', 'stories']), [...LIFECYCLE_PROFILES, tiny]), 'chore',
    'and loses as soon as the chain goes past it');

  const reversed = [...LIFECYCLE_PROFILES].reverse();
  assert.equal(matchLifecycleProfile(S(CLASSIC_10), reversed), 'classic');
  assert.equal(matchLifecycleProfile(S(CHORE_4), reversed), 'chore');
  assert.equal(matchLifecycleProfile(S(SPIKE_6), reversed), 'spike');
  assert.equal(matchLifecycleProfile(S(['epic', 'epic-review']), reversed), 'chore');
  assert.equal(matchLifecycleProfile(S(ANALYSIS_12), reversed), 'analysis-first',
    'the longer route still wins when it is the only one that fits');
  // Out of order is a different thing from missing, and is not a route.
  assert.equal(matchLifecycleProfile(S(['stories', 'epic'])), null);
  assert.equal(matchLifecycleProfile(S(['epic', 'analysis'])), null, 'analysis comes BEFORE epic or not at all');
  assert.equal(matchLifecycleProfile(S(['epic', 'discovery'])), null, 'the front-zero is not on the Epic ladder');
  assert.equal(matchLifecycleProfile(S(['epic', 'feasibility'])), null, 'a step no route has');
  assert.equal(matchLifecycleProfile([]), null);
  assert.equal(matchLifecycleProfile(null), null);
  assert.equal(matchLifecycleProfile(S(['epic', 'epic'])), null, 'the same step twice is not in order');
});

// ---- the six phases (E22) ------------------------------------------------------------------------

test('the six phases are named, in order, each in exactly one part', () => {
  assert.deepEqual(PHASES.map((p) => p.id), ['discover', 'design', 'plan', 'build', 'release', 'operate']);
  assert.deepEqual(PHASES.map((p) => p.part), ['Shape', 'Shape', 'Shape', 'Build', 'Run', 'Run']);
  // Release and Operate are named and NOT built. Listing them is the point — a person has to see the
  // lifecycle does not stop at merge — and `built: false` is what keeps every renderer honest.
  assert.deepEqual(PHASES.filter((p) => !p.built).map((p) => p.id), ['release', 'operate']);
  for (const p of PHASES.filter((x) => !x.built)) {
    assert.deepEqual(phaseSteps(p.id), [], `${p.id} must claim no step until E32/E33 build one`);
  }
});

test('a review gate takes its phase from the artifact it reviews', () => {
  assert.equal(stepPhase('epic'), 'discover');
  assert.equal(stepPhase('epic-review'), 'discover');
  assert.equal(stepPhase('architecture-review'), 'design');
  assert.equal(stepPhase('ui-design-review'), 'design');
  assert.equal(stepPhase('test-cases-review'), 'plan');
  // The product level's gates are placed on the product ladder, old spelling and new alike (E75).
  assert.equal(stepPhase('discovery-review'), 'foundation');
  assert.equal(stepPhase('foundation-review'), 'foundation');
});

test('`engineer-review` is a step, not the review of a step called `engineer`', () => {
  // The trap this pins. Strip `-review` first and this id resolves to `engineer`, which nothing
  // claims — so the last step of Build would render with no phase at all. The full id has to be
  // tried before the suffix is touched, and only this test says so.
  assert.equal(stepPhase('engineer-review'), 'build');
  assert.equal(phaseOf('engineer-review').name, 'Build');
  assert.ok(phaseSteps('build').includes('engineer-review'));
});

test('a review suffix is only ever stripped against a step that HAS a review gate', () => {
  // Shape steps each have a `<id>-review` gate, so the suffix resolves to the artifact's phase. Build
  // steps have none — `engineer-review` is a step in its own right, the locked merge gate. Stripping
  // the suffix against the Build table too would quietly invent `checks-review` and `spec-review`,
  // steps that do not exist, and `phase:unknown` would then stay silent on them.
  for (const id of ['spec-review', 'tasks-review', 'implement-review', 'checks-review', 'engineer-review-review']) {
    assert.equal(stepPhase(id), null, `${id} is not a step and must not resolve`);
  }
  assert.equal(stepPhase('engineer-review'), 'build', 'while the real one still does');
});

test('an id the engine does not recognise has NO phase, rather than a guessed one', () => {
  // Sentinels are `currentStep` values, not entries in `steps[]`, and a future profile may carry step
  // ids this release has never heard of. A renderer showing the wrong phase is worse than one
  // showing none, so this returns null and every caller has to decide what to do about it.
  for (const id of ['ready-for-build', 'backfill-pending', 'backfill-done', 'discovery-done',
    'feasibility', 'engineer', 'review', '', null, undefined]) {
    assert.equal(stepPhase(id), null, `${id} should have no phase`);
  }
  // `phaseOf` asks the other question — where is the EPIC — so `ready-for-build` is Build there, and
  // is covered by its own test. Everything that is not a step is still nothing to either function.
  for (const id of ['backfill-pending', 'backfill-done', 'discovery-done', 'feasibility', '', null]) {
    assert.equal(phaseOf(id), null, `${id} should place no epic`);
  }
});

test('every step the engine can run belongs to a phase', () => {
  // The invariant that keeps the three tables from drifting: a step added to STEP_SKILL or
  // BUILD_STEP_SKILL and forgotten here would render with no phase and no test would notice.
  for (const id of [...Object.keys(STEP_SKILL), ...Object.keys(BUILD_STEP_SKILL)]) {
    assert.ok(stepPhase(id), `${id} has a skill but no phase`);
  }
  // …and every phase that claims to be built really has steps.
  for (const p of PHASES.filter((x) => x.built)) {
    assert.ok(phaseSteps(p.id).length, `${p.id} is marked built but claims no step`);
  }
  // Every review gate of a known authoring step resolves too.
  for (const id of Object.keys(STEP_SKILL)) {
    assert.equal(stepPhase(`${id}-review`), stepPhase(id), `${id}-review drifted from ${id}`);
  }
});

test('a thread node carries the phase the EPIC is in, the same answer yad next prints', () => {
  // `yad thread --json` is not frozen by the golden test, so it gains the new word directly. Null is
  // a real answer here, not a gap: `ready-for-build` is a currentStep sentinel, not a step, and
  // placing it in a phase would be inventing one.
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  const dir = path.join(T, 'epics', 'EP-gen', '.sdlc');
  fs.mkdirSync(dir, { recursive: true });
  const at = (currentStep) => {
    fs.writeFileSync(path.join(dir, 'state.json'),
      JSON.stringify({ schemaVersion: 5, currentStep, steps: [{ id: 'epic', type: 'author', status: 'done' }] }, null, 2) + '\n');
    return threadSummary(T, 'EP-gen').nodes[0];
  };
  assert.equal(at('architecture-review').phase, 'design');
  assert.equal(at('stories').phase, 'plan');
  assert.equal(at('engineer-review').phase, 'build');
  // `ready-for-build` is the marker that stands in for the whole of Build — an epic sitting on it is
  // in Build, and this key would otherwise be null for the entire back half of every epic.
  assert.equal(at('ready-for-build').phase, 'build');
  assert.equal(at('backfill-pending').phase, null, 'a stub is not walking the lifecycle');
  fs.rmSync(T, { recursive: true, force: true });
});

test('the phase table in skills/sdlc/config.yaml agrees with the code, row for row', () => {
  // config.yaml is documentation-as-config: the skills read it, people read it, and nothing else
  // checks it against the engine. A table copied by hand into a second file is a table that drifts —
  // the same reason `ledger-guard.sh` and `lineage-check.sh` have agreement tests. There is no YAML
  // parser in this repo (Node built-ins only), so the six inline maps are read with a regex; a change
  // to their layout fails loudly here rather than silently skipping the comparison.
  const src = fs.readFileSync(new URL('../skills/sdlc/config.yaml', import.meta.url), 'utf8');
  const block = src.match(/^lifecycle:\n([\s\S]*?)\n^defaults:/m);
  assert.ok(block, 'the lifecycle block is gone or was renamed');
  const rows = [...block[1].matchAll(
    /- \{ id: (\w+),\s+name: (\w+),\s+part: (\w+),\s+built: (true|false),?\s+steps: \[([^\]]*)\] \}/g,
  )].map((m) => ({
    id: m[1], name: m[2], part: m[3], built: m[4] === 'true',
    steps: m[5].split(',').map((x) => x.trim()).filter(Boolean),
  }));
  assert.equal(rows.length, PHASES.length, `parsed ${rows.length} rows, the code has ${PHASES.length}`);
  for (const [i, row] of rows.entries()) {
    const p = PHASES[i];
    assert.deepEqual(
      { id: row.id, name: row.name, part: row.part, built: row.built },
      { id: p.id, name: p.name, part: p.part, built: p.built },
      `config row ${i} disagrees with PHASES[${i}]`,
    );
    assert.deepEqual(row.steps, phaseSteps(p.id), `config lists different steps for ${p.id}`);
  }
  // The other two lists, pinned the same way — by deepEqual against the code, not by "is it truthy".
  // `[].split(',')` yields [''] with length 1, so a length check would pass on an emptied list, and a
  // one-directional loop would pass on a shortened one.
  const listOf = (key) => (block[1].match(new RegExp(`${key}: \\[([^\\]]*)\\]`))?.[1] ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  assert.deepEqual(listOf('sentinels'), SENTINELS, 'the sentinel list drifted from the code');
  assert.deepEqual(listOf('parts'), [...new Set(PHASES.map((p) => p.part))], 'the parts list drifted');
  assert.deepEqual(listOf('profiles'), LIFECYCLE_PROFILES.map((x) => x.id), 'the profile list drifted');
  // The product ladder (E75), held the same way as the six. Its own key, so the six-row count above
  // stays a count of the feature phases.
  const productRows = [...block[1].matchAll(
    /- \{ id: (\w+), name: (\w+), level: (\w+), built: (true|false), steps: \[([^\]]*)\] \}/g,
  )].map((m) => ({ id: m[1], name: m[2], level: m[3], built: m[4] === 'true',
    steps: m[5].split(',').map((x) => x.trim()).filter(Boolean) }));
  assert.deepEqual(productRows.map(({ steps: _steps, ...r }) => r), PRODUCT_PHASES.map((p) => ({ ...p })),
    'the product_phases rows drifted from PRODUCT_PHASES');
  for (const row of productRows) assert.deepEqual(row.steps, phaseSteps(row.id), `config lists different steps for ${row.id}`);
  for (const sent of SENTINELS) assert.equal(stepPhase(sent), null, `${sent} is a sentinel but has a phase`);
});

test('an epic in Build is placed in Build, from the marker that stands in for its steps', () => {
  // `stepPhase` is a pure id lookup and `ready-for-build` is not an id, so it has none — correct.
  // `currentPhase` answers the other question, which every renderer actually asks: WHERE IS THIS
  // EPIC. `nextAction` never reports a concrete build step id at the epic level (the real ones live
  // per story per repo in build-state), so without this Build could never be shown at all.
  assert.equal(stepPhase('ready-for-build'), null, 'still not a step');
  assert.equal(currentPhase('ready-for-build'), 'build');
  assert.equal(phaseOf('ready-for-build').name, 'Build');
  // The other three markers stay phase-less: a stub is not walking the lifecycle, and neither is a
  // finished discovery.
  for (const sent of ['backfill-pending', 'backfill-done', 'discovery-done']) {
    assert.equal(currentPhase(sent), null, sent);
  }
});

test('the product level is in the Foundation phase for its whole life, and never on the feature ladder', () => {
  // Until E75 this pinned the opposite — the front-zero had NO phase, because the Product level was
  // named and not modelled. It is modelled now: a ladder of its own with one phase, Foundation.
  //
  // The LEVEL decides, not the step id, and the sentinel is what proves it: `foundation-done` is not a
  // step, so a lookup by id alone would drop an approved Foundation out of its phase the moment it
  // passed its gate.
  for (const cur of ['foundation', 'foundation-review', 'foundation-done', 'discovery', 'discovery-done']) {
    assert.equal(currentPhase(cur, { product: true }), 'foundation', cur);
  }
  assert.equal(currentPhase('foundation-done'), null, 'without the level, a sentinel is still nothing');
  assert.equal(phaseOf('discovery-review', { product: true }).name, 'Foundation');
  assert.equal(phaseOf('foundation', { product: true }).level, 'product');
  // The six phases are untouched: the Foundation is not a seventh step on the feature lifecycle.
  assert.deepEqual(PHASES.map((p) => p.id), ['discover', 'design', 'plan', 'build', 'release', 'operate']);
  assert.equal(PHASES.some((p) => phaseSteps(p.id).includes('foundation')), false);
});

test('every step the engine can run is listed in a phase table BY NAME', () => {
  // Asserted on the tables, not through `stepPhase` — a `-review` id would satisfy a truthiness check
  // through the suffix strip without ever appearing in a table, so the looser test would pass while
  // the entry was missing.
  const listed = new Set([...PHASES, ...PRODUCT_PHASES].flatMap((p) => phaseSteps(p.id)));
  for (const id of [...Object.keys(STEP_SKILL), ...Object.keys(BUILD_STEP_SKILL)]) {
    assert.ok(listed.has(id), `${id} has a skill but is in no phase table`);
  }
  // …and nothing is listed that no skill runs. Both directions, so neither table can grow alone.
  const runnable = new Set([...Object.keys(STEP_SKILL), ...Object.keys(BUILD_STEP_SKILL)]);
  for (const id of listed) assert.ok(runnable.has(id), `${id} is in a phase but no skill runs it`);
});

// ---- seeding a chain from a profile (E17) --------------------------------------------------------

// Pull the first fenced ```json block out of a skill file — the `state.json` seed it tells people to
// copy. Four skills carry one, and each is the hand-written twin of what the engine now writes.
function templateSeed(skillFile) {
  const src = fs.readFileSync(new URL(`../skills/${skillFile}`, import.meta.url), 'utf8');
  const m = src.match(/```json\n(\{[\s\S]*?\n\})\n```/);
  assert.ok(m, `${skillFile}: no json seed template found`);
  return JSON.parse(m[1]
    .replace(/<the same value as epic\.md[^"]*>/, 'feature')
    .replace(/"EP-<[a-z]+>"/g, '"EP-x"')
    .replace(/"<today>"/g, '"2026-01-02"')
    .replace(/"sha256:…"/g, '"sha256:abc"'));
}

// What is LEFT after E17b. `yad-epic`, `yad-analysis` and `yad-stub` no longer carry one — they run
// `yad epic new` instead, and `yad-discovery` runs `yad foundation new` (E75); the test below is what
// keeps those templates from coming back. This one remains as a WORKED EXAMPLE, not an instruction:
// since E42 `yad-change` runs `yad epic new --parent`, and a test further down keeps this example equal
// to what the engine writes, so a reviewer reading it is not reading a shape that no longer exists.
const SEED_TEMPLATES = [
  ['yad-change/references/triage.md', 'classic'],
];

// The skills that USED to hand-write a chain and now call the engine. The rule is invisible from the
// code alone — nothing breaks if a JSON seed reappears in one of these files, and the copy would
// simply start drifting from the catalogue again, silently, exactly as five copies did before E4. So
// the absence is asserted.
const ENGINE_SEEDED = [
  ['yad-epic/SKILL.md', 'yad epic new'],
  ['yad-analysis/SKILL.md', 'yad epic new EP-<slug> --profile analysis-first'],
  ['yad-stub/SKILL.md', 'yad epic new EP-<slug> --stub'],
  // E75: the Product level has a command of its own, and the skill that authors it runs that.
  ['yad-discovery/SKILL.md', 'yad foundation new'],
  // E42: the threaded chain — inherited steps, provenance records and the pointer-lock.
  ['yad-change/SKILL.md', 'yad epic new EP-<slug> --type <change|defect|hotfix> --parent <EP-parent> --inherits <bases>'],
];

test('the skills that call the engine carry no chain of their own to drift', () => {
  for (const [skillFile, command] of ENGINE_SEEDED) {
    const src = fs.readFileSync(new URL(`../skills/${skillFile}`, import.meta.url), 'utf8');
    // Not "no ```json fence" — a skill may legitimately show some other JSON. The thing that must not
    // come back is a STEP CHAIN, which is what a `steps` array of ids is.
    for (const m of src.matchAll(/```json\n([\s\S]*?)\n```/g)) {
      assert.equal(/"steps"\s*:\s*\[/.test(m[1]), false,
        `${skillFile}: a hand-written step chain is back — the engine owns it now`);
    }
    assert.ok(src.includes(command), `${skillFile}: does not tell the author to run \`${command}\``);
    // And no instruction to hand-edit the ledger either, which is the other half of E17b.
    assert.equal(/In `state\.json`: set|Write `state\.json`/.test(src), false,
      `${skillFile}: still instructs a hand-edit of state.json`);
  }
});

test('the skills E17b changed instruct no ledger write at all', () => {
  // The first version of this keyed on two literal phrases lifted from the deleted blocks, and a
  // matcher loose enough to catch any rewording also caught `yad-test-cases` READING the file
  // ("state.json shows it `skipped`") and missed `yad-discovery` writing it, because its path is long.
  // A prose heuristic over 38 files cannot be made both. So the check is narrow and exact instead: the
  // nine skills this task changed, each asserted to contain no imperative aimed at the ledger.
  const CHANGED = ['yad-epic', 'yad-analysis', 'yad-stub', 'yad-architecture', 'yad-ui',
    'yad-stories', 'yad-test-cases', 'yad-review-gate', 'yad-discovery', 'yad-change'];
  // An imperative aimed at the ledger, in EITHER word order — and both orders are needed, because the
  // blocks this task deleted used the second one. `Create {project-root}/…/.sdlc/state.json` puts the
  // verb first; ``In `state.json`: set `architecture.status` to done`` puts the file first, and a
  // matcher that only looked one way would have missed every block E17b exists to remove.
  //
  // The two directions take different verb lists on purpose. Verb-first is a stem match, so `Creates`
  // and `Seeding` both count. File-first must be an exact word, or "if `state.json` already exists
  // (SEEDED, or a re-entry)" — a sentence about whether the file is there — reads as an instruction
  // to write it.
  const FILE = '`?\\.?/?[\\w/<>{}.-]{0,60}state\\.json`?';
  // Up to a short run of words between the verb and the file, so `Mark the step done in state.json`
  // counts as well as `Create .sdlc/state.json`. Bounded, and stopped at a sentence end, so the verb
  // and the file have to be in the same clause.
  const VERB_FIRST = '\\b(creat|writ|seed|re-seed|set|mark|mov|remov|rewrit|updat|append|delet|clear|stamp|flip)[a-z]*\\s+[^.\n]{0,30}?[`\'"({[]*';
  const VERB_AFTER = '\\b(set|mark|move|remove|write|add|update|append|delete|clear|stamp|flip)\\b';
  const WRITE = new RegExp(`${VERB_FIRST}${FILE}|${FILE}[^.\n]{0,20}${VERB_AFTER}`, 'i');
  for (const d of CHANGED) {
    const src = fs.readFileSync(new URL(`../skills/${d}/SKILL.md`, import.meta.url), 'utf8');
    const offenders = src.split('\n')
      // A prohibition is not a write, and neither is a conditional that forbids one.
      .filter((l) => !/never|read-only|do \*\*not\*\*|do not|don't|refus|exempt|rejects/i.test(l))
      // Nor is a sentence whose subject is the ENGINE. "That writes …/state.json with the classic
      // chain" describes what `yad epic new` does; it is the opposite of an instruction to the author,
      // and it is the sentence this whole task exists to put there. A line naming an engine command,
      // or opening with "That"/"It", is describing one.
      .filter((l) => !/yad (epic new|gate open|migrate)|^(That|It) (writes|sets|marks|moves|creates)/i.test(l.trim()))
      // A heading is a label for the step, not an imperative inside it. The instruction lives in the
      // body underneath, which this still reads.
      .filter((l) => !l.trimStart().startsWith('#'))
      // And the file as the SUBJECT of a reading verb is a read: "(state.json shows it `skipped`)"
      // tells you where to look, it does not tell you to write anything.
      .filter((l) => !/state\.json`?\s*(shows|says|records|holds|reads|lists|is |has )/i.test(l))
      .filter((l) => WRITE.test(l));
    // `yad-review-gate` is the one exception and it is deliberate: its `advance` action transcribes
    // `advanceState`, which has no engine verb on a Product with no platform. Its `open` action must
    // still be clean, which the next test checks.
    if (d === 'yad-review-gate') continue;
    assert.deepEqual(offenders, [], `${d}: still instructs a ledger write`);
  }
});

test('the skills that still write a chain by hand are named, with the reason', () => {
  // Not "only yad-review-gate", which is what this used to claim and was false. Three others write a
  // chain too, and each is out of scope for a stated reason rather than by oversight. The claim lives
  // in the review gate's own banner, so a reader hits it where the transcription is.
  const gate = fs.readFileSync(new URL('../skills/yad-review-gate/SKILL.md', import.meta.url), 'utf8');
  assert.match(gate, /TRANSCRIPTION of `advanceState`/);
  for (const [skill, why] of [
    ['yad-backfill', /promote/],
  ]) {
    assert.match(gate, new RegExp(skill), `the banner does not name ${skill} as a remaining writer`);
    assert.match(gate, why, `the banner does not say WHY ${skill} is still one`);
  }
  // `yad-discovery` left the list in E75, and the banner says where it went rather than dropping it
  // silently — a reader who remembers it as a writer would otherwise go looking for the JSON block.
  assert.match(gate, /`yad-discovery` used to be one; since E75 it runs\s+> `yad foundation new`/);
  // `yad-change` left in E42, and the banner says where it went for the same reason.
  assert.match(gate, /`yad-change` used to seed a threaded chain by hand; since E42 it runs\s+> `yad epic new --parent`/);
  // …and each of those really does still seed or rewrite a chain, so the banner is not naming skills
  // that have already been converted.
  for (const d of ['yad-backfill']) {
    const src = fs.readFileSync(new URL(`../skills/${d}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(src, /state\.json/, `${d}: no longer touches the ledger — drop it from the banner`);
  }
});

test('the review gate opens a gate with the ENGINE, not by hand', () => {
  // The regression this exists for. E17b deleted the six authoring-skill blocks that closed the author
  // step, on the promise that `yad-review-gate` runs `yad gate open`. It did not — its `open` action
  // hand-wrote `in_review` and never closed the author step, so every epic on a local Product would
  // have stranded behind YAD-STATE-005 with nothing in the suite to notice. The rule lives in the
  // interaction between two skill files, which is why no code test could see it.
  const src = fs.readFileSync(new URL('../skills/yad-review-gate/SKILL.md', import.meta.url), 'utf8');
  assert.match(src, /yad gate open <epic> <artifact>/);
  // The two rules a transcription of that command keeps losing.
  assert.match(src, /closes the paired authoring step/i);
  assert.match(src, /ready-for-build/);
  // And every skill that hands off to it names the command and its one prerequisite, rather than
  // leaving the transition to nobody.
  for (const d of ['yad-epic', 'yad-analysis', 'yad-architecture', 'yad-ui', 'yad-stories', 'yad-test-cases']) {
    const skill = fs.readFileSync(new URL(`../skills/${d}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(skill, /yad gate open/, `${d}: does not name the command that makes the transition`);
    assert.match(skill, /must already be \*\*on origin\*\*/,
      `${d}: does not say the review branch must be pushed first — with a platform the command refuses and writes nothing`);
  }
});

test('every skill seed template states this shape and the route its own chain is on', () => {
  for (const [skillFile, profile] of SEED_TEMPLATES) {
    const seed = templateSeed(skillFile);
    // A template left on the previous shape mints epics that `yad doctor` calls behind the moment
    // they are created — and `yad migrate` never touches a skill file, so nothing would ever fix it.
    assert.equal(seed.schemaVersion, ENGINE_SHAPE, `${skillFile}: seeds shape ${seed.schemaVersion}`);
    assert.equal(seed.profile, profile, `${skillFile}: records the wrong route`);
    // The claim is checked against the chain it actually writes, not just against this test's table.
    assert.equal(matchLifecycleProfile(seed.steps), profile, `${skillFile}: its chain is not on ${profile}`);
  }
});

test('seedableProfiles is the FEATURE routes, read off the profiles', () => {
  // E40's short lanes need no edit here and that is the assertion: a feature route is seedable the day
  // it is added to the table, because this reads `level` rather than a second list to keep in step.
  assert.deepEqual(seedableProfiles(), ['classic', 'analysis-first', 'chore', 'spike']);
  // The rule is `level === 'feature'`, and with today's data "all but the last" and "all but
  // `discovery` by name" give the same answer — so it is asserted on routes where they differ.
  assert.deepEqual(seedableProfiles([
    { id: 'a', level: 'product', steps: ['discovery'] },
    { id: 'b', level: 'feature', steps: ['epic'] },
    { id: 'c', level: 'product', steps: ['discovery'] },
  ]), ['b'], 'a product route is excluded wherever it is declared');
  assert.deepEqual(seedableProfiles([]), []);
});

test('seedState: the first step is open, everything after it is todo', () => {
  const s = seedState({ epic: 'EP-demo', profile: 'classic', type: 'feature', today: '2026-01-02' });
  assert.deepEqual(s.steps.map((x) => x.id), CLASSIC_10);
  assert.equal(s.currentStep, 'epic');
  // The engine seeds BEFORE anything is authored, which is the opposite of what a skill records. A
  // seed that copied the skill's `done` + `in_review` would claim an artifact exists and open a gate
  // on a file nobody has written.
  assert.deepEqual(s.steps.map((x) => x.status), ['in_progress', ...Array(9).fill('todo')]);
  assert.equal(s.epicId, 'EP-demo');
  assert.equal(s.createdAt, '2026-01-02');
  assert.equal(s.type, 'feature');
  assert.equal(s.profile, 'classic');
  // The chain the seed writes is on the route it records — the round trip `yad doctor` compares.
  assert.equal(matchLifecycleProfile(s.steps), 'classic');

  const a = seedState({ epic: 'EP-demo', profile: 'analysis-first', type: 'chore', today: '2026-01-02' });
  assert.deepEqual(a.steps.map((x) => x.id), ANALYSIS_12);
  assert.equal(a.currentStep, 'analysis');
  assert.equal(a.steps[0].status, 'in_progress');
  assert.equal(matchLifecycleProfile(a.steps), 'analysis-first');
});

test('seedState: every step carries what the catalogue says it is', () => {
  const s = seedState({ epic: 'EP-demo', profile: 'classic', type: 'feature', today: '2026-01-02' });
  for (const step of s.steps) {
    const def = stepDef(step.id);
    assert.equal(step.type, def.kind === 'review' ? 'review+approve' : 'author');
    assert.equal(step.artifact, def.artifact);
    assert.deepEqual(step.risk_tags, def.risk_tags);
    // Both dial names, old beside new (rule 3). A check gate inside a user's repo still reads the old
    // pair, and `yad update` is a separate act from creating an epic — so a seed writing only the new
    // names would mint epics an un-refreshed gate cannot read.
    assert.equal(step.assistance, 'review');
    assert.equal(step.driver, 'pair');
    assert.equal(step.automation, 'human_approve');
    assert.equal(step.advance, 'human');
    assert.equal(step.locked, true);
  }
  // The escalation tag is not invented here — it comes from the catalogue row, and this is the one
  // step that carries one.
  assert.deepEqual(s.steps.find((x) => x.id === 'architecture-review').risk_tags, ['contract']);
  assert.deepEqual(s.steps.find((x) => x.id === 'stories-review').risk_tags, []);
  // A fresh seed is internally consistent and its first step is runnable.
  assert.deepEqual(stateInvariants(s), []);
  assert.equal(preconditionsMet(s, 'epic').ok, true);
  assert.equal(preconditionsMet(s, 'stories').ok, false, 'a later step is still blocked');
});

test('a short lane seeds, walks and hands off to Build without a step it does not carry (E40)', () => {
  // The whole lane end to end, because every piece of it is a rule that lives somewhere else:
  // `seedState` builds the chain, `advanceState` walks it, and the sentinel it lands on is what
  // `currentPhase` and `yad next` read. A route is only as good as the walk it survives.
  for (const [id, chain] of [['chore', CHORE_4], ['spike', SPIKE_6]]) {
    const s = seedState({ epic: 'EP-demo', profile: id, type: 'chore', today: '2026-01-02' });
    assert.equal(s.profile, id, 'a lane records its own route at seed time — nothing is left to match');
    assert.deepEqual(s.steps.map((x) => x.id), chain);
    assert.equal(s.currentStep, chain[0]);
    assert.deepEqual(s.steps.map((x) => x.status), ['in_progress', ...Array(chain.length - 1).fill('todo')]);
    // No architecture step means no `contract` risk tag anywhere on the chain, which is what routes a
    // gate through the escalated rule. A short lane carrying one would ask for the domain owners of a
    // surface it has no lock on.
    assert.deepEqual(s.steps.flatMap((x) => x.risk_tags), []);

    // Approve every gate in order. The last one must leave the epic at `ready-for-build` and nowhere
    // else: `advanceState` gets there for `stories-review` by name, and the `test-cases` track it
    // looks for on the way is absent here, which it has to tolerate rather than throw on.
    for (const g of s.steps.filter((x) => x.type === 'review+approve')) advanceState(s, g);
    assert.equal(s.currentStep, 'ready-for-build');
    assert.equal(currentPhase(s.currentStep), 'build');
    assert.deepEqual([...new Set(s.steps.map((x) => x.status))], ['done']);
  }
});

test('seedState refuses a route it must not seed', () => {
  // `discovery` is a real route and still not seedable: the front-zero has a fixed id, a `kind`
  // marker and no work-item type, so a plain-profile seed of it would be a broken front-zero.
  assert.throws(() => seedState({ epic: 'EP-discovery', profile: 'discovery', type: 'feature', today: 'x' }),
    /cannot seed the 'discovery' lifecycle profile/);
  assert.throws(() => seedState({ epic: 'EP-x', profile: 'nonsense', type: 'feature', today: 'x' }),
    /cannot seed the 'nonsense' lifecycle profile/);
});

// A STUB is a variation of the STATUSES, not of the chain: same `classic` route, every step `todo`
// behind the `backfill-pending` sentinel, plus the `kind: "stub"` lifecycle marker. It replaced a
// hand-written template, so the shape it produces is asserted field by field rather than trusted.
//
// `todo`, not `blocked`, since shape 7 (E38): nobody is RUNNING a stub's chain, and nothing outside
// the team is standing in its way — which is what `blocked` now means.
test('seedState --stub: the classic chain, every step todo behind the sentinel', () => {
  const s = seedState({ epic: 'EP-demo', profile: 'classic', type: 'feature', today: '2026-01-02', stub: true });
  assert.deepEqual(s.steps.map((x) => x.id), CLASSIC_10, 'the same chain `promote` wakes');
  assert.deepEqual([...new Set(s.steps.map((x) => x.status))], ['todo'], 'nothing is runnable yet');
  assert.equal(s.currentStep, 'backfill-pending');
  assert.equal(s.kind, 'stub', 'the lifecycle marker the engine keys off');
  assert.equal(s.type, 'feature', '…which is a different axis from the work-item type');
  // `kind` sits between `type` and `profile` — where the template always put it, and where
  // `stampProfile` would insert on a stub that lacked a route. Key order is the file's bytes.
  assert.deepEqual(Object.keys(s), ['epicId', 'createdAt', 'type', 'kind', 'profile', 'currentStep', 'steps']);
  // The readers agree it is an anchor: no step is runnable and `yad next` routes it to the backfill
  // skill rather than to authoring.
  assert.equal(backfillAnchorKind(s), 'stub');
  assert.equal(preconditionsMet(s, 'epic').ok, false);
  assert.equal(nextAction({ state: s }, { epic: 'EP-demo' }).kind, 'backfill-pending');
  // A plain seed is none of those things — the assertion that keeps the flag from becoming a no-op.
  const plain = seedState({ epic: 'EP-demo', profile: 'classic', type: 'feature', today: '2026-01-02' });
  assert.equal('kind' in plain, false);
  assert.equal(plain.currentStep, 'epic');
  assert.equal(backfillAnchorKind(plain), null);
});

// ---- the Product level: Foundation (E75) ---------------------------------------------------------

test('epicRoot is the one place that knows the Foundation lives outside epics/', () => {
  // Every command resolves an epic's directory through this function, so pinning it here is what keeps
  // `yad gate open EP-foundation foundation/` from needing a special case at each call site.
  assert.equal(epicRoot('/p', FOUNDATION_EPIC), path.join('/p', FOUNDATION_DIR));
  assert.equal(epicRoot('/p', 'EP-cart'), path.join('/p', 'epics', 'EP-cart'));
  assert.equal(epicRel(FOUNDATION_EPIC), 'foundation');
  assert.equal(epicRel('EP-cart'), 'epics/EP-cart');
  // The id keeps the prefix every review router matches: parseReviewBranch here, and `review/EP-*` in
  // both gate-sync workflows committed in users' repos.
  assert.deepEqual(parseReviewBranch('review/EP-foundation/foundation'), { epic: FOUNDATION_EPIC, base: 'foundation' });
  assert.equal(artifactFromBase(artifactBase('foundation/')), 'foundation/');
});

test('epicIds lists the Foundation only once its ledger folder exists, and never a stray copy under epics/', () => {
  const T = hub();
  try {
    writeEpic(T, 'EP-cart', { kind: 'feature' });
    // An unrelated `foundation/` folder — a docs section, say — is somebody else's files, not a ledger.
    fs.mkdirSync(path.join(T, 'foundation'), { recursive: true });
    assert.deepEqual(epicIds(T), ['EP-cart']);
    fs.mkdirSync(path.join(T, 'foundation', '.sdlc'), { recursive: true });
    assert.deepEqual(epicIds(T), ['EP-cart', FOUNDATION_EPIC]);
    // `epics/EP-foundation/` resolves to `foundation/` through epicRoot, so listing it would read the
    // real Foundation twice under one id.
    fs.mkdirSync(path.join(T, 'epics', FOUNDATION_EPIC, '.sdlc'), { recursive: true });
    assert.deepEqual(epicIds(T), ['EP-cart', FOUNDATION_EPIC]);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('foundationHash: reviewable once every REQUIRED section exists; an optional one counts when present', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-foundation-'));
  try {
    const write = (f, body = `# ${f}\n`) => fs.writeFileSync(path.join(T, f), body);
    for (const f of FOUNDATION_REQUIRED.slice(1)) write(f);
    assert.equal(foundationHash(T), null, 'one required section missing — not reviewable');
    write(FOUNDATION_REQUIRED[0]);
    const without = foundationHash(T);
    assert.match(without, /^sha256:/, 'complete without market.md and risks.md');
    assert.equal(artifactHash(T, 'foundation/'), without, 'the gate hashes the Foundation through the same function');
    write('risks.md');
    assert.notEqual(foundationHash(T), without, 'adding an optional section is an edit reviewers did not see');
    write('stray.md');
    const withRisks = foundationHash(T);
    assert.equal(foundationHash(T), withRisks, 'a file that is not a section is not hashed');
    // The optional/required split is a RULE, and with the shipped sections it cannot be told apart from
    // "hash whatever exists" on a complete Foundation. So it is shown on sections where it matters: a
    // required file that is missing yields null, the same file marked optional does not.
    const sections = [{ file: 'purpose.md' }, { file: 'extra.md' }];
    assert.equal(foundationHash(T, sections), null);
    assert.match(foundationHash(T, [{ file: 'purpose.md' }, { file: 'extra.md', optional: true }]), /^sha256:/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
  assert.deepEqual(artifactPaths('foundation'), FOUNDATION_SECTIONS.map((s) => s.file));
  assert.deepEqual(FOUNDATION_SECTIONS.filter((s) => s.optional).map((s) => s.file), ['market.md', 'risks.md']);
});

test('seedFoundationState writes the product level: fixed id, a kind marker, no work-item type', () => {
  const s = seedFoundationState({ today: '2026-09-13' });
  assert.deepEqual(Object.keys(s), ['epicId', 'createdAt', 'kind', 'profile', 'currentStep', 'steps']);
  assert.equal(s.epicId, FOUNDATION_EPIC);
  assert.equal(s.kind, 'foundation');
  assert.equal(isProductLevel(s), true);
  assert.deepEqual(s.steps.map((x) => [x.id, x.type, x.artifact, x.status]), [
    ['foundation', 'author', 'foundation/', 'in_progress'],
    ['foundation-review', 'review+approve', 'foundation/', 'todo'],
  ]);
  assert.equal(matchLifecycleProfile(s.steps), 'foundation');
  assert.deepEqual(productProfiles(), ['discovery', 'foundation']);
  // The feature seed still refuses every product route — the predicate was not loosened.
  assert.throws(() => seedState({ epic: FOUNDATION_EPIC, profile: 'foundation', type: 'feature', today: 'x' }),
    /cannot seed the 'foundation' lifecycle profile/);
});

test('the product level ends on its own -done word, one per spelling', () => {
  const chain = (kind, a, r) => ({ kind, currentStep: r, steps: [
    { id: a, type: 'author', artifact: `${kind}/`, status: 'done' },
    { id: r, type: 'review+approve', artifact: `${kind}/`, status: 'in_review' },
  ] });
  const f = advanceState(chain('foundation', 'foundation', 'foundation-review'), { id: 'foundation-review' });
  assert.equal(f.currentStep, 'foundation-done');
  const d = advanceState(chain('discovery', 'discovery', 'discovery-review'), { id: 'discovery-review' });
  assert.equal(d.currentStep, 'discovery-done', 'an unconverted ledger keeps writing the word its readers expect');
  assert.deepEqual(PRODUCT_DONE, ['foundation-done', 'discovery-done']);
  for (const w of PRODUCT_DONE) assert.ok(SENTINELS.includes(w), `${w} is a sentinel`);
});

test('nextAction walks the Foundation like the old front-zero, under its own id and words', () => {
  const st = (currentStep, a, r) => ({ epicId: FOUNDATION_EPIC, kind: 'foundation', currentStep, steps: [
    { id: 'foundation', type: 'author', artifact: 'foundation/', status: a },
    { id: 'foundation-review', type: 'review+approve', artifact: 'foundation/', status: r },
  ] });
  const author = nextAction({ state: st('foundation', 'in_progress', 'todo'), hubPrs: [] }, { epic: FOUNDATION_EPIC });
  assert.equal(author.kind, 'author');
  assert.equal(author.skill, 'yad-discovery');
  const open = nextAction({ state: st('foundation-review', 'done', 'in_review'), hubPrs: [] }, { epic: FOUNDATION_EPIC });
  assert.equal(open.command, 'yad gate open EP-foundation foundation/');
  assert.equal(open.parallel, undefined, 'no parallel track on the product level');
  const done = nextAction({ state: st('foundation-done', 'done', 'done'), hubPrs: [] }, { epic: FOUNDATION_EPIC });
  assert.equal(done.kind, 'foundation-done');
  assert.match(done.why, /Foundation approved/);
  assert.equal(preconditionsMet(null, 'foundation').ok, true, 'an entry step, like epic / analysis');
});

test('the foundation step inherits a binding made for discovery, until it has its own', () => {
  // A project that bound its own skill to `discovery` before E75 must not be switched back to the
  // default by a rename it did not ask for (rule 3).
  assert.deepEqual(stepSkills('foundation', { steps: { discovery: ['ours'] } }), ['ours']);
  assert.deepEqual(stepSkills('foundation', { steps: { discovery: ['ours'], foundation: ['mine'] } }), ['mine']);
  assert.deepEqual(stepSkills('foundation', { steps: {} }), ['yad-discovery']);
  // One direction only: the old step does not start reading the new step's binding.
  assert.deepEqual(stepSkills('discovery', { steps: { foundation: ['mine'] } }), ['yad-discovery']);
  // A hostile step id resolves through nothing on the prototype.
  assert.deepEqual(stepSkills('constructor', { steps: {} }), []);
});

// ---- `yad epic new --parent` — the engine seeds a threaded change-epic (E42) ----------------------
async function seedOn(T, opts) {
  const { runEpicNew } = await import('./epic.mjs');
  const code = process.exitCode;
  process.exitCode = undefined;
  const out = await grab(() => runEpicNew(T, { today: '2026-02-02', ...opts }));
  const failed = process.exitCode === 1;
  process.exitCode = code;
  return { out, failed };
}
const sdlcOf = (T, id, f) => JSON.parse(fs.readFileSync(path.join(epicRoot(T, id), '.sdlc', f), 'utf8'));
const seeded = (T, id) => fs.existsSync(path.join(epicRoot(T, id), '.sdlc', 'state.json'));
const SURFACE = '# Contract\n<!-- CONTRACT-SURFACE:BEGIN -->\nGET /orders\n<!-- CONTRACT-SURFACE:END -->\n';

// An epic whose whole Shape part is approved: every artifact on disk, every step `done`, the surface
// locked. `fm` overrides the lineage, so the same builder makes a genesis and a change.
function approvedEpic(T, id, { profile = 'classic', fm = {}, lock = true } = {}) {
  const dir = writeEpic(T, id, { kind: 'feature', type: 'feature', thread: id, ...fm });
  for (const f of ['analysis.md', 'architecture.md', 'ui-design.md']) fs.writeFileSync(path.join(dir, f), `---\nstatus: approved\n---\n# ${f}\n`);
  fs.writeFileSync(path.join(dir, 'contract.md'), SURFACE);
  const state = seedState({ epic: id, profile, type: fm.type || 'feature', today: '2026-01-01' });
  for (const s of state.steps) s.status = 'done';
  state.currentStep = 'ready-for-build';
  fs.writeFileSync(path.join(dir, '.sdlc/state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(dir, '.sdlc/approvals.json'), '[]');
  if (lock) fs.writeFileSync(path.join(dir, '.sdlc/contract-lock.json'), JSON.stringify({ artifact: 'contract.md', hash: contractSurfaceHash(dir) }));
  return dir;
}
const setSteps = (dir, edit) => {
  const f = path.join(dir, '.sdlc/state.json');
  const state = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const s of state.steps) edit(s);
  fs.writeFileSync(f, JSON.stringify(state));
};

test('yad epic new --parent: a defect carries what it inherits by reference, and the contract by pointer (E42)', async () => {
  const { loadLedger } = await import('./epic-state.mjs');
  const { epicChecks } = await import('./doctor.mjs');
  const T = hub();
  const P = approvedEpic(T, 'EP-checkout');
  const { out, failed } = await seedOn(T, { slug: 'fix', type: 'defect', parent: 'EP-checkout', inherits: 'epic,architecture,contract,ui-design' });
  try {
    assert.equal(failed, false, out);
    const state = sdlcOf(T, 'EP-fix', 'state.json');
    assert.equal(state.type, 'defect');
    assert.equal(state.profile, 'classic', 'the route is the parent\'s');
    assert.equal(state.currentStep, 'stories', 'the first step this epic writes');
    const by = Object.fromEntries(state.steps.map((s) => [s.id, s]));
    for (const id of ['epic', 'epic-review', 'architecture', 'architecture-review', 'ui-design', 'ui-design-review']) {
      const s = by[id];
      assert.equal(s.status, 'satisfied', id);
      assert.equal(s.inherited, true, `${id}: the legacy flag is still written (rule 3)`);
      assert.equal(s.inheritedFrom, 'EP-checkout', id);
      assert.equal(s.boundHash, artifactHash(P, s.artifact), `${id}: bound to the owner's live hash`);
      assert.deepEqual(s.record, { reason: 'carried by reference from EP-checkout', by: null, date: '2026-02-02', link: 'EP-checkout' });
    }
    assert.equal(by.architecture.boundHash, contractSurfaceHash(P), 'architecture binds to the contract surface');
    assert.deepEqual(by['architecture-review'].risk_tags, ['contract'], 'the catalogue\'s risk tags survive the overlay');
    assert.equal(by.stories.status, 'in_progress');
    for (const id of ['stories-review', 'test-cases', 'test-cases-review']) assert.equal(by[id].status, 'todo', id);

    // One provenance record per carried GATE — not per step, and never an approval the predicate counts.
    const approvals = sdlcOf(T, 'EP-fix', 'approvals.json');
    assert.deepEqual(approvals.map((a) => a.step), ['architecture-review', 'epic-review', 'ui-design-review']);
    assert.ok(approvals.every((a) => a.status === 'inherited' && a.from === 'EP-checkout' && a.date === '2026-02-02'));
    assert.equal(approvals.find((a) => a.step === 'epic-review').boundHash, by.epic.boundHash);

    // The pointer-lock: the owner's hash verbatim, and where it came from.
    const lock = sdlcOf(T, 'EP-fix', 'contract-lock.json');
    assert.equal(lock.hash, sdlcOf(T, 'EP-checkout', 'contract-lock.json').hash);
    assert.equal(lock.inheritedFrom, 'EP-checkout');
    assert.equal(lock.ref, '../../EP-checkout/.sdlc/contract-lock.json');
    assert.equal(fs.existsSync(path.join(epicRoot(T, 'EP-fix'), 'contract.md')), false, 'no second contract');
    assert.match(out, /points at EP-checkout's lock/);

    // What reads it back agrees: yad next opens stories, the gate passes a carried review against the
    // owner's artifact, and doctor verifies the pointer.
    const ledger = loadLedger(epicRoot(T, 'EP-fix'));
    assert.equal(nextAction(ledger, { epic: 'EP-fix' }).step, 'stories');
    // The hashes a real caller passes are taken from a folder, so take them the same way. The child has no
    // contract.md, so its own folder makes no claim; and a carried epic-review compared with the OWNER's
    // epic.md passes — the child writes an epic.md of its own (the change brief), which is not the one
    // it carries.
    const { acceptedHashes } = await import('./epic-state.mjs');
    const gate = gatePredicate({ step: by['architecture-review'], approvals: [], acceptedHashes: acceptedHashes(epicRoot(T, 'EP-fix'), 'architecture.md') });
    assert.equal(gate.passed, true);
    assert.equal(gate.rule, 'inherited');
    assert.equal(gatePredicate({ step: by['epic-review'], approvals: [], acceptedHashes: acceptedHashes(P, 'epic.md') }).passed, true);
    const checks = [];
    epicChecks(checks, T);
    assert.equal(checks.find((c) => c.id === 'epic:EP-fix:contract-lock')?.status, 'ok');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: a change that re-authors the epic carries only the contract', async () => {
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  const { out, failed } = await seedOn(T, { slug: 'beh', type: 'change', parent: 'EP-checkout', inherits: 'architecture contract', json: true });
  try {
    assert.equal(failed, false, out);
    const res = JSON.parse(out);
    assert.equal(res.currentStep, 'epic');
    assert.equal(res.next, 'yad-epic');
    assert.deepEqual(res.inheritedFrom, { architecture: 'EP-checkout', contract: 'EP-checkout' });
    assert.equal(res.pointerLock, '../../EP-checkout/.sdlc/contract-lock.json');
    assert.equal(res.anchor, false);
    const by = Object.fromEntries(sdlcOf(T, 'EP-beh', 'state.json').steps.map((s) => [s.id, s.status]));
    assert.deepEqual(by, {
      epic: 'in_progress', 'epic-review': 'todo', architecture: 'satisfied', 'architecture-review': 'satisfied',
      'ui-design': 'todo', 'ui-design-review': 'todo', stories: 'todo', 'stories-review': 'todo', 'test-cases': 'todo', 'test-cases-review': 'todo',
    });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: nothing carried is a full chain on the parent\'s route, with no lock', async () => {
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  const { out, failed } = await seedOn(T, { slug: 'grow', type: 'change', parent: 'EP-checkout' });
  try {
    assert.equal(failed, false, out);
    const state = sdlcOf(T, 'EP-grow', 'state.json');
    assert.equal(state.currentStep, 'epic');
    assert.equal(state.steps.some((s) => s.inherited), false);
    assert.deepEqual(sdlcOf(T, 'EP-grow', 'approvals.json'), []);
    assert.equal(fs.existsSync(path.join(epicRoot(T, 'EP-grow'), '.sdlc/contract-lock.json')), false);
    assert.match(out, /nothing is carried by reference/);
    assert.match(out, /architecture is authored here/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: analysis rides with the epic it was written for', async () => {
  const T = hub();
  approvedEpic(T, 'EP-big', { profile: 'analysis-first' });
  const { out, failed } = await seedOn(T, { slug: 'fix', type: 'defect', parent: 'EP-big', inherits: ['epic'] });
  try {
    assert.equal(failed, false, out);
    const state = sdlcOf(T, 'EP-fix', 'state.json');
    assert.equal(state.profile, 'analysis-first');
    const by = Object.fromEntries(state.steps.map((s) => [s.id, s]));
    assert.equal(by.analysis.status, 'satisfied');
    assert.equal(by['analysis-review'].boundHash, artifactHash(epicRoot(T, 'EP-big'), 'analysis.md'));
    assert.equal(state.currentStep, 'architecture');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }

  // The person typed `epic`, not `analysis`, so a refusal about the brief says why it is being checked.
  const T2 = hub();
  setSteps(approvedEpic(T2, 'EP-big', { profile: 'analysis-first' }), (s) => { if (s.id === 'analysis-review') s.status = 'in_review'; });
  try {
    const { out, failed } = await seedOn(T2, { slug: 'fix', type: 'defect', parent: 'EP-big', inherits: 'epic' });
    assert.equal(failed, true);
    assert.match(out, /has not finished analysis-review \(in_review\) \(analysis rides with epic\)/);
  } finally { fs.rmSync(T2, { recursive: true, force: true }); }
});

test('yad epic new --parent: the owner is found along the PARENT\'s line, not anywhere in the thread', async () => {
  const T = hub();
  approvedEpic(T, 'EP-g');
  // A middle change that re-authored the epic and carried the contract from the genesis.
  writeEpic(T, 'EP-mid', { kind: 'change', type: 'change', parent: 'EP-g', thread: 'EP-g', inherits: ['architecture', 'contract'] });
  const mid = await seedOn(T, { slug: 'mid', type: 'change' });
  // A sibling off the same genesis that re-authored everything. In the whole-thread map it is the
  // latest owner of architecture — and it is not something EP-mid's children build on.
  approvedEpic(T, 'EP-sib', { fm: { kind: 'change', type: 'change', parent: 'EP-g', thread: 'EP-g' } });
  try {
    assert.equal(mid.failed, false, mid.out);
    setSteps(epicRoot(T, 'EP-mid'), (s) => { if (!s.inherited) s.status = 'done'; });
    assert.equal(resolveCurrentArtifacts(T, 'EP-g').architecture, 'EP-sib', 'the whole-thread map does name the sibling');

    const { out, failed } = await seedOn(T, { slug: 'leaf', type: 'defect', parent: 'EP-mid', inherits: 'epic,architecture,contract' });
    assert.equal(failed, false, out);
    const by = Object.fromEntries(sdlcOf(T, 'EP-leaf', 'state.json').steps.map((s) => [s.id, s]));
    assert.equal(by.epic.inheritedFrom, 'EP-mid', 'the epic was re-authored in the middle');
    assert.equal(by.architecture.inheritedFrom, 'EP-g', 'the contract still lives in the genesis');
    const lock = sdlcOf(T, 'EP-leaf', 'contract-lock.json');
    assert.equal(lock.ref, '../../EP-g/.sdlc/contract-lock.json', 'the pointer names the real lock, not the middle pointer');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: a short-lane parent gives a short child, with nothing to point a lock at', async () => {
  const T = hub();
  approvedEpic(T, 'EP-bump', { profile: 'chore', fm: { kind: 'chore', type: 'chore' }, lock: false });
  try {
    for (const inherits of ['ui-design', 'architecture,contract']) {
      const r = await seedOn(T, { slug: 'r', type: 'change', parent: 'EP-bump', inherits });
      assert.equal(r.failed, true, inherits);
      assert.match(r.out, /chore route has no (ui-design|architecture) step/);
      assert.equal(seeded(T, 'EP-r'), false);
    }
    const { out, failed } = await seedOn(T, { slug: 'fix', type: 'defect', parent: 'EP-bump', inherits: 'epic' });
    assert.equal(failed, false, out);
    const state = sdlcOf(T, 'EP-fix', 'state.json');
    assert.equal(state.profile, 'chore');
    assert.deepEqual(state.steps.map((s) => s.id), ['epic', 'epic-review', 'stories', 'stories-review']);
    assert.equal(fs.existsSync(path.join(epicRoot(T, 'EP-fix'), '.sdlc/contract-lock.json')), false);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: off a brownfield anchor, bases carry no hash and no lock is written', async () => {
  const T = hub();
  const dir = writeEpic(T, 'EP-legacy', { kind: 'feature', type: 'feature', thread: 'EP-legacy', stub: 'backfill-pending', verified: false });
  fs.writeFileSync(path.join(dir, '.sdlc/state.json'), JSON.stringify(seedState({ epic: 'EP-legacy', profile: 'classic', type: 'feature', today: '2026-01-01', stub: true })));
  const { out, failed } = await seedOn(T, { slug: 'fix', type: 'defect', parent: 'EP-legacy', inherits: 'epic,architecture,contract,ui-design', json: true });
  try {
    assert.equal(failed, false, out);
    assert.equal(JSON.parse(out).anchor, true);
    const carried = sdlcOf(T, 'EP-fix', 'state.json').steps.filter((s) => s.inherited);
    assert.equal(carried.length, 6);
    assert.ok(carried.every((s) => s.boundHash === null && s.inheritedFrom === 'EP-legacy'));
    assert.equal(fs.existsSync(path.join(epicRoot(T, 'EP-fix'), '.sdlc/contract-lock.json')), false);
    // And the gate reads a null hash as "nothing locked upstream", so the carried step passes.
    assert.equal(gatePredicate({ step: carried[3], approvals: [], acceptedHashes: [] }).passed, true);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: only work written AND approved upstream is carried (the E37/E41 limit)', async () => {
  // The thread's owner map names the epic that DECIDED about a base, which is right for a skip — and a
  // skip is not an artifact. Carrying one would seed an inherited UI nobody wrote; carrying a deferral
  // would drop the owed work out of the thread.
  const cases = [
    ['skipped', (s) => { s.status = 'skipped'; s.record = { reason: 'backend only', by: null, date: null }; }, /EP-checkout skipped ui-design \(backend only\)[\s\S]*yad skip/],
    ['legacy skip', (s) => { s.skipped = true; s.skipReason = 'no screens'; }, /EP-checkout skipped ui-design/],
    ['deferred', (s) => { s.status = 'deferred'; s.record = { reason: 'later', by: null, date: null }; }, /deferred ui-design — that work is still owed[\s\S]*author it on this epic/],
    ['unfinished', (s) => { s.status = s.type === 'author' ? 'done' : 'in_review'; }, /has not finished ui-design-review \(in_review\)/],
    ['claims inherited', (s) => { s.inherited = true; s.inheritedFrom = 'EP-elsewhere'; }, /ledger carries ui-design from EP-elsewhere, but its epic\.md does not list ui-design/],
  ];
  for (const [name, edit, message] of cases) {
    const T = hub();
    const P = approvedEpic(T, 'EP-checkout');
    setSteps(P, (s) => { if (s.id.startsWith('ui-design')) edit(s); });
    try {
      const { out, failed } = await seedOn(T, { slug: 'fix', type: 'defect', parent: 'EP-checkout', inherits: 'ui-design' });
      assert.equal(failed, true, name);
      assert.match(out, message, name);
      assert.equal(seeded(T, 'EP-fix'), false, `${name}: a refusal wrote a ledger`);
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  }
});

test('yad epic new --parent: rule 5 — a carried contract must be a real, current lock', async () => {
  const cases = [
    ['no lock', (P) => fs.rmSync(path.join(P, '.sdlc/contract-lock.json')), /holds no usable contract lock[\s\S]*rule 5/],
    ['malformed lock', (P) => fs.writeFileSync(path.join(P, '.sdlc/contract-lock.json'), '{"hash":"sha256:nope"}'), /holds no usable contract lock/],
    ['drifted surface', (P) => fs.writeFileSync(path.join(P, 'contract.md'), SURFACE.replace('GET', 'POST')), /surface no longer matches its lock/],
    ['approved but missing', (P) => fs.rmSync(path.join(P, 'ui-design.md')), /approved ui-design, but ui-design\.md is not there/],
  ];
  for (const [name, edit, message] of cases) {
    const T = hub();
    edit(approvedEpic(T, 'EP-checkout'));
    try {
      const { out, failed } = await seedOn(T, { slug: 'fix', type: 'defect', parent: 'EP-checkout', inherits: 'architecture,contract,ui-design' });
      assert.equal(failed, true, name);
      assert.match(out, message, name);
      assert.equal(seeded(T, 'EP-fix'), false, name);
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  }

  // And a lock already sitting in the new epic is somebody's record: refused before anything is written.
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  const stray = path.join(T, 'epics/EP-fix/.sdlc/contract-lock.json');
  fs.mkdirSync(path.dirname(stray), { recursive: true });
  fs.writeFileSync(stray, '{"mine":true}');
  try {
    const { out, failed } = await seedOn(T, { slug: 'fix', type: 'defect', parent: 'EP-checkout', inherits: 'architecture,contract' });
    assert.equal(failed, true);
    assert.match(out, /already has a contract-lock\.json/);
    assert.equal(fs.readFileSync(stray, 'utf8'), '{"mine":true}');
    assert.equal(seeded(T, 'EP-fix'), false);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: the header wins over no flag, and a contradicting flag is refused', async () => {
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  approvedEpic(T, 'EP-other');
  writeEpic(T, 'EP-fix', { kind: 'defect', type: 'defect', parent: 'EP-checkout', thread: 'EP-checkout', inherits: ['epic', 'ui-design'] });
  try {
    for (const [opts, message] of [
      [{ parent: 'EP-other' }, /epic\.md says `parent: EP-checkout`, --parent says `EP-other`/],
      [{ inherits: 'epic' }, /epic\.md inherits \[epic, ui-design\], --inherits says \[epic\]/],
      [{ type: 'change' }, /epic\.md says `defect`, --type says `change`/],
    ]) {
      const r = await seedOn(T, { slug: 'fix', ...opts });
      assert.equal(r.failed, true, JSON.stringify(opts));
      assert.match(r.out, message);
      assert.equal(seeded(T, 'EP-fix'), false);
    }
    // The same list in another order or spelling is not a contradiction.
    const { out, failed } = await seedOn(T, { slug: 'fix', inherits: 'ui-design epic' });
    assert.equal(failed, false, out);
    const state = sdlcOf(T, 'EP-fix', 'state.json');
    assert.equal(state.type, 'defect');
    assert.equal(state.steps.filter((s) => s.inherited).length, 4);
    assert.doesNotMatch(out, /lists no `inherits:`/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }

  // A thread cache that disagrees with the parent's line is refused; a header with no inherits is told
  // to add them, because `yad thread` reads the header.
  const T2 = hub();
  approvedEpic(T2, 'EP-checkout');
  writeEpic(T2, 'EP-bad', { kind: 'defect', type: 'defect', parent: 'EP-checkout', thread: 'EP-wrong' });
  writeEpic(T2, 'EP-bare', { kind: 'defect', type: 'defect', parent: 'EP-checkout', thread: 'EP-checkout' });
  try {
    const bad = await seedOn(T2, { slug: 'bad', inherits: 'epic' });
    assert.equal(bad.failed, true);
    assert.match(bad.out, /thread: EP-wrong`, but EP-checkout's thread starts at EP-checkout/);
    const bare = await seedOn(T2, { slug: 'bare', inherits: 'epic' });
    assert.equal(bare.failed, false, bare.out);
    assert.match(bare.out, /epic\.md lists no `inherits:` — add `inherits: \[epic\]`/);
  } finally { fs.rmSync(T2, { recursive: true, force: true }); }
});

test('yad epic new --parent: what may be inherited, and from what, is refused before anything is written', async () => {
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  const foundation = path.join(T, 'foundation', '.sdlc');
  fs.mkdirSync(foundation, { recursive: true });
  try {
    for (const [opts, message] of [
      [{ type: 'defect', parent: 'EP-checkout', inherits: 'stories' }, /stories cannot be inherited/],
      [{ type: 'defect', parent: 'EP-checkout', inherits: 'test-cases,epic' }, /test-cases cannot be inherited/],
      [{ type: 'defect', parent: 'EP-checkout', inherits: 'architecture' }, /architecture and contract are inherited together/],
      [{ type: 'defect', parent: 'EP-checkout', inherits: 'contract' }, /architecture and contract are inherited together/],
      [{ type: 'defect', parent: 'EP-checkout', inherits: 'design' }, /unknown base in inherits: design/],
      [{ type: 'defect', parent: 'EP-nope', inherits: 'epic' }, /EP-nope is not an epic with a lifecycle here/],
      [{ type: 'defect', parent: 'EP-foundation' }, /EP-foundation is the Product level/],
      [{ type: 'defect', parent: 'not an id' }, /invalid parent id/],
      [{ type: 'defect', parent: 'EP-r' }, /EP-r cannot be its own parent/],
      [{ type: 'feature', parent: 'EP-checkout' }, /a feature has no parent/],
      [{ type: 'chore', parent: 'EP-checkout' }, /a chore has no parent/],
      [{ inherits: 'epic' }, /--inherits needs a parent/],
      [{ type: 'hotfix' }, /a hotfix epic cannot be seeded without its parent[\s\S]*--parent/],
      [{ type: 'defect', parent: 'EP-checkout', profile: 'chore' }, /takes its parent's route — EP-checkout is on 'classic', --profile says 'chore'/],
      [{ type: 'defect', parent: 'EP-checkout', stub: true }, /a stub has no parent/],
      [{ parent: 'EP-checkout', stub: true }, /a stub has no parent/],
    ]) {
      const r = await seedOn(T, { slug: 'r', ...opts });
      assert.equal(r.failed, true, JSON.stringify(opts));
      assert.match(r.out, message, JSON.stringify(opts));
      assert.equal(seeded(T, 'EP-r'), false, JSON.stringify(opts));
    }
    // A --profile naming the parent's own route is not a contradiction.
    const same = await seedOn(T, { slug: 'r', type: 'defect', parent: 'EP-checkout', profile: 'classic' });
    assert.equal(same.failed, false, same.out);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }

  // A parent whose lineage is broken is fixed first.
  const T2 = hub();
  approvedEpic(T2, 'EP-mid', { fm: { kind: 'change', type: 'change', parent: 'EP-gone', thread: 'EP-gone' } });
  try {
    const r = await seedOn(T2, { slug: 'r', type: 'defect', parent: 'EP-mid' });
    assert.equal(r.failed, true);
    assert.match(r.out, /EP-mid: its lineage is broken — missing parent epic EP-gone/);
  } finally { fs.rmSync(T2, { recursive: true, force: true }); }
});

test('triage.md\'s worked example is what `yad epic new --parent` really writes (E42)', async () => {
  // The example is prose a reviewer trusts. Once the engine writes the chain, nothing else would notice
  // the two drifting apart — a field renamed, a status changed, a key moved.
  const example = templateSeed('yad-change/references/triage.md');
  const T = hub();
  approvedEpic(T, 'EP-genesis');
  const { out, failed } = await seedOn(T, { slug: 'slug', type: 'defect', parent: 'EP-genesis', inherits: 'epic,architecture,contract,ui-design' });
  try {
    assert.equal(failed, false, out);
    const real = sdlcOf(T, 'EP-slug', 'state.json');
    assert.deepEqual(Object.keys(real), Object.keys(example), 'top-level keys and their order');
    assert.equal(real.currentStep, example.currentStep);
    assert.equal(real.profile, example.profile);
    const norm = (s) => ({ ...s, ...(s.boundHash ? { boundHash: 'H' } : {}), ...(s.record ? { record: { ...s.record, date: 'D' } } : {}),
      ...(s.inheritedFrom ? { inheritedFrom: 'O', record: { ...s.record, date: 'D', reason: 'R', link: 'O' } } : {}) });
    real.steps.forEach((s, i) => {
      assert.deepEqual(Object.keys(s), Object.keys(example.steps[i]), `${s.id}: keys and their order`);
      assert.deepEqual(norm(s), norm(example.steps[i]), s.id);
    });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- the holes the E42 review found ---------------------------------------------------------------
test('yad epic new --parent: architecture and contract owned by two epics are refused, in either order', async () => {
  // An epic between here and the genesis lists only `contract` in its `inherits:`, so the owner map
  // names it for architecture and the genesis for the contract. Carrying both would bind the steps to one
  // surface and point the lock at another — and which one depended on the order the list was typed in.
  const T = hub();
  approvedEpic(T, 'EP-g');
  const mid = approvedEpic(T, 'EP-mid', { fm: { kind: 'change', type: 'change', parent: 'EP-g', thread: 'EP-g', inherits: ['contract'] } });
  fs.writeFileSync(path.join(mid, 'contract.md'), SURFACE.replace('GET', 'POST'));
  fs.writeFileSync(path.join(mid, '.sdlc/contract-lock.json'), JSON.stringify({ artifact: 'contract.md', hash: contractSurfaceHash(mid) }));
  try {
    for (const inherits of ['architecture,contract', 'contract,architecture']) {
      const { out, failed } = await seedOn(T, { slug: 'leaf', type: 'defect', parent: 'EP-mid', inherits });
      assert.equal(failed, true, inherits);
      assert.match(out, /along EP-mid's line the architecture is owned by EP-mid but the contract by EP-g/, inherits);
      assert.equal(seeded(T, 'EP-leaf'), false, inherits);
    }
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: an `inherits:` the other readers parse differently is refused', async () => {
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  // No brackets: this command would read two bases, `epicLineage` — and so `yad thread` — reads one
  // base called "epic, ui-design".
  writeEpic(T, 'EP-fix', { kind: 'defect', type: 'defect', parent: 'EP-checkout', thread: 'EP-checkout', inherits: 'epic, ui-design' });
  writeEpic(T, 'EP-one', { kind: 'defect', type: 'defect', parent: 'EP-checkout', thread: 'EP-checkout', inherits: 'epic' });
  try {
    const { out, failed } = await seedOn(T, { slug: 'fix' });
    assert.equal(failed, true);
    assert.match(out, /write it as `inherits: \[epic, ui-design\]`/);
    assert.equal(seeded(T, 'EP-fix'), false);
    // A single base needs no brackets — every reader agrees on it.
    const one = await seedOn(T, { slug: 'one' });
    assert.equal(one.failed, false, one.out);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: an approvals.json with records in it is never overwritten', async () => {
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  const file = path.join(T, 'epics/EP-fix/.sdlc/approvals.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    for (const body of ['[{"step":"stories-review","status":"approved"}]', '{ not json']) {
      fs.writeFileSync(file, body);
      const { out, failed } = await seedOn(T, { slug: 'fix', type: 'defect', parent: 'EP-checkout', inherits: 'epic' });
      assert.equal(failed, true, body);
      assert.match(out, /already has an approvals\.json with records in it/);
      assert.equal(fs.readFileSync(file, 'utf8'), body);
      assert.equal(seeded(T, 'EP-fix'), false);
    }
    // An empty list is exactly what a seed writes, so it is safe to replace.
    fs.writeFileSync(file, '[]');
    const { out, failed } = await seedOn(T, { slug: 'fix', type: 'defect', parent: 'EP-checkout', inherits: 'epic' });
    assert.equal(failed, false, out);
    assert.equal(sdlcOf(T, 'EP-fix', 'approvals.json').length, 1);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: a header that exists must carry the parent and the thread', async () => {
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  writeEpic(T, 'EP-np', { kind: 'defect', type: 'defect', thread: 'EP-checkout' });
  writeEpic(T, 'EP-nt', { kind: 'defect', type: 'defect', parent: 'EP-checkout' });
  writeEpic(T, 'EP-ok', { kind: 'defect', type: 'defect', parent: 'EP-checkout', thread: 'EP-checkout' });
  try {
    const np = await seedOn(T, { slug: 'np', parent: 'EP-checkout', inherits: 'epic' });
    assert.equal(np.failed, true);
    assert.match(np.out, /epic\.md has no `parent:`[\s\S]*add `parent: EP-checkout`/);
    const nt = await seedOn(T, { slug: 'nt', inherits: 'epic' });
    assert.equal(nt.failed, true);
    assert.match(nt.out, /epic\.md has no `thread:` — add `thread: EP-checkout`/);
    assert.equal(seeded(T, 'EP-np') || seeded(T, 'EP-nt'), false);
    // `--parent checkout` names the same epic as the header's EP-checkout, the way the slug does.
    const ok = await seedOn(T, { slug: 'ok', parent: 'checkout', inherits: 'epic' });
    assert.equal(ok.failed, false, ok.out);
    assert.equal(sdlcOf(T, 'EP-ok', 'state.json').steps[0].inheritedFrom, 'EP-checkout');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: the refusals nothing else reached — an unreadable parent, no route, an unreadable owner', async () => {
  const cases = [
    ['unreadable parent', (T) => fs.writeFileSync(path.join(approvedEpic(T, 'EP-p'), '.sdlc/state.json'), '{ nope'), 'EP-p', /EP-p: its state\.json cannot be read/],
    ['no route', (T) => fs.writeFileSync(path.join(approvedEpic(T, 'EP-p'), '.sdlc/state.json'), JSON.stringify({ epicId: 'EP-p', steps: [{ id: 'weird' }] })), 'EP-p', /EP-p: its chain is on no route this command can seed/],
    ['unreadable owner', (T) => {
      fs.writeFileSync(path.join(writeEpic(T, 'EP-g', { kind: 'feature', type: 'feature', thread: 'EP-g' }), '.sdlc/state.json'), '{ nope');
      approvedEpic(T, 'EP-p', { fm: { kind: 'change', type: 'change', parent: 'EP-g', thread: 'EP-g', inherits: ['ui-design'] } });
    }, 'EP-p', /EP-g owns ui-design, but its state\.json is missing or cannot be read/],
  ];
  for (const [name, build, parent, message] of cases) {
    const T = hub();
    build(T);
    try {
      const { out, failed } = await seedOn(T, { slug: 'leaf', type: 'defect', parent, inherits: 'ui-design' });
      assert.equal(failed, true, name);
      assert.match(out, message, name);
      assert.equal(seeded(T, 'EP-leaf'), false, name);
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  }
});

test('yad epic new --parent: a --json refusal is one parseable object', async () => {
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  try {
    const { out, failed } = await seedOn(T, { slug: 'r', type: 'defect', parent: 'EP-checkout', inherits: 'stories', json: true });
    assert.equal(failed, true);
    const res = JSON.parse(out);
    assert.equal(res.ok, false);
    assert.match(res.error, /stories cannot be inherited/);
    assert.ok(res.hint);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent: a carried step AFTER an authored one is walked past as the chain advances', async () => {
  const { advanceState } = await import('./epic-state.mjs');
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  const { out, failed } = await seedOn(T, { slug: 'ui', type: 'change', parent: 'EP-checkout', inherits: 'ui-design' });
  try {
    assert.equal(failed, false, out);
    const state = sdlcOf(T, 'EP-ui', 'state.json');
    assert.equal(state.currentStep, 'epic');
    assert.deepEqual(stateInvariants(state), []);
    for (const s of state.steps) if (['epic', 'epic-review', 'architecture'].includes(s.id)) s.status = 'done';
    advanceState(state, state.steps.find((s) => s.id === 'architecture-review'));
    assert.equal(state.currentStep, 'stories', 'the carried ui-design pair is walked past');
    assert.equal(state.steps.find((s) => s.id === 'ui-design').status, 'satisfied', 'and left as it was');
    assert.deepEqual(stateInvariants(state), []);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad epic new --parent --inherits through the real command line, and a stray word is refused', async () => {
  const { execFileSync } = await import('node:child_process');
  const bin = new URL('../bin/yad.mjs', import.meta.url).pathname;
  const T = hub();
  approvedEpic(T, 'EP-checkout');
  const run = (args) => {
    try { return { out: execFileSync('node', [bin, ...args, '--dir', T], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: String(e.stdout), code: e.status }; }
  };
  try {
    const stray = run(['epic', 'new', 'fix', 'architecture', '--type', 'defect', '--parent', 'EP-checkout', '--inherits', 'epic']);
    assert.equal(stray.code, 1);
    assert.match(stray.out, /unexpected argument\(s\): architecture/);
    assert.equal(seeded(T, 'EP-fix'), false);

    const good = run(['epic', 'new', 'fix', '--type', 'defect', '--parent', 'EP-checkout', '--inherits', 'epic,architecture,contract,ui-design', '--json']);
    assert.equal(good.code, 0, good.out);
    const res = JSON.parse(good.out);
    assert.equal(res.parent, 'EP-checkout');
    assert.deepEqual(res.inheritedFrom, { epic: 'EP-checkout', architecture: 'EP-checkout', contract: 'EP-checkout', 'ui-design': 'EP-checkout' });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
