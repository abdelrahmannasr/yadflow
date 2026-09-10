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
} from './epic-state.mjs';
import { sealedEpic, openDebtOnThread, threadSummary, runThread } from './thread.mjs';

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

for (const [skillFile, expected] of [
  ['yad-epic/SKILL.md', { kind: 'feature', type: 'feature', genesis: true }],
  ['yad-stub/SKILL.md', { kind: 'feature', type: 'feature', genesis: true, stub: 'backfill-pending' }],
]) {
  test(`${skillFile}: the epic.md template it tells people to copy reads back correctly`, () => {
    const T = hub();
    const dir = path.join(T, 'epics', 'EP-demo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'epic.md'),
      templateFrontmatter(skillFile).replace(/EP-<slug>/g, 'EP-demo') + '\n## Goal\nx\n');

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
    // …and the thread cache resolves, which is what `yad doctor` checks.
    assert.equal(resolveThread(T, 'EP-demo').broken, null);
    assert.equal(resolveThread(T, 'EP-demo').rootId, 'EP-demo');
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
  assert.equal(themeKey('###'), '', 'punctuation alone folds to nothing — doctor calls that unreadable');
  assert.equal(themeKey(null), '');
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
  assert.equal(stepPhase('discovery-review'), 'discover');
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

test('the discovery front-zero has no phase — it does not walk the feature lifecycle', () => {
  // EP-discovery is PRODUCT level. Its chain is discovery -> discovery-review -> discovery-done and
  // it never enters Design, Plan or Build, so placing it on the six-phase ladder claims a journey it
  // does not take. E75 folds it into Foundation, a Product-level phase of its own.
  assert.equal(currentPhase('discovery'), 'discover', 'the STEP is a Discover step…');
  assert.equal(currentPhase('discovery', { discovery: true }), null, '…but this epic is not on the ladder');
  assert.equal(phaseOf('discovery-review', { discovery: true }), null);
});

test('every step the engine can run is listed in a phase table BY NAME', () => {
  // Asserted on the tables, not through `stepPhase` — a `-review` id would satisfy a truthiness check
  // through the suffix strip without ever appearing in a table, so the looser test would pass while
  // the entry was missing.
  const listed = new Set(PHASES.flatMap((p) => phaseSteps(p.id)));
  for (const id of [...Object.keys(STEP_SKILL), ...Object.keys(BUILD_STEP_SKILL)]) {
    assert.ok(listed.has(id), `${id} has a skill but is in no phase table`);
  }
  // …and nothing is listed that no skill runs. Both directions, so neither table can grow alone.
  const runnable = new Set([...Object.keys(STEP_SKILL), ...Object.keys(BUILD_STEP_SKILL)]);
  for (const id of listed) assert.ok(runnable.has(id), `${id} is in a phase but no skill runs it`);
});
