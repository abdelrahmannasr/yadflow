// Per-epic file ledger + the gate predicate. The file ledger (epics/<epic>/.sdlc/*.json) is the
// source of truth; the platform PR/MR is only an input path. Everything here is pure / filesystem —
// no gh/glab — so the predicate is unit-testable without a network. Node built-ins only.
import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { readJSON, readJSONStrict, writeJSON, fileSha } from './lib.mjs';
import { err } from './errors.mjs';
import { epicFiles } from './manifest.mjs';

const RISK_ESCALATORS = ['contract', 'auth', 'payments'];

// Epic ids are EP-<slug> with [a-z0-9-] only — anything else (uppercase, dots, slashes) is
// rejected before it can become a path segment under epics/.
export const isValidEpicId = (epic) => /^EP-[a-z0-9-]+$/.test(epic || '');

export const epicRoot = (root, epic) => path.join(root, 'epics', epic);

// epic.md -> "epic"; architecture.md -> "architecture"; stories/ -> "stories";
// stories/EP-x-S01.md -> "stories-S01".
export function artifactBase(artifact) {
  const a = artifact.replace(/\/$/, '');
  if (a === 'stories' || a === 'stories/') return 'stories';
  const m = a.match(/stories\/.*?(S\d+)\.md$/i);
  if (m) return `stories-${m[1]}`;
  return path.basename(a).replace(/\.md$/, '');
}

// `review/EP-<slug>/<artifact-base>` -> { epic, base } — the branch convention `gate open` creates.
// Null for any other branch: the guard CI uses to no-op on non-review branches.
export function parseReviewBranch(branch = '') {
  const m = branch.match(/^review\/(EP-[a-z0-9-]+)\/(.+)$/);
  return m ? { epic: m[1], base: m[2] } : null;
}

// The reverse of artifactBase: an artifact-base back to the ledger's artifact path. A single-story
// base (stories-S01) still maps to stories/ — the stories gate is ONE step over the whole set
// (storiesHash fingerprints the directory), so any story branch syncs the same review step.
export function artifactFromBase(base) {
  if (base === 'stories' || /^stories-S\d+$/i.test(base)) return 'stories/';
  if (base === 'discovery') return 'discovery/';
  return `${base}.md`;
}

// The files (relative to the epic dir) a review of this artifact covers — what `gate open` commits
// on the review branch (the owner's artifact), and what CI re-reads to bind the approval at merge.
// Architecture mirrors artifactHash(): the approval is bound to the locked contract surface too.
export function artifactPaths(base) {
  if (base === 'architecture') return ['architecture.md', 'contract.md', '.sdlc/contract-lock.json'];
  if (base === 'stories') return ['stories'];
  if (base === 'discovery') return [...DISCOVERY_FILES];
  return [`${base}.md`];
}

// Replace-not-append upsert into hub-prs.json, keyed by artifact (one live review PR per artifact).
export function upsertHubPr(hubPrs = [], rec) {
  return [...hubPrs.filter((p) => p.artifact !== rec.artifact), rec];
}

// SHA-256 of the contract surface block (architecture only). Mirrors
// yad-architecture/references/contract-format.md (awk markers + sha256).
// Line endings are normalized to LF so the same surface hashes identically across
// platforms (a CRLF re-save must not revoke approvals). A BEGIN without an END is
// malformed and yields null — never a silent hash of everything to end-of-file.
export function contractSurfaceHash(epicDir) {
  const file = path.join(epicDir, 'contract.md');
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  let inside = false;
  let terminated = true;
  const body = [];
  for (const ln of lines) {
    if (/CONTRACT-SURFACE:BEGIN/.test(ln)) { inside = true; terminated = false; continue; }
    if (/CONTRACT-SURFACE:END/.test(ln)) { inside = false; terminated = true; continue; }
    if (inside) body.push(ln);
  }
  if (!terminated || !body.length) return null;
  return 'sha256:' + createHash('sha256').update(body.join('\n')).digest('hex');
}

// Deterministic fingerprint of the whole stories/ set: hash each story file, sort, combine. Lets an
// edit to any story revoke prior stories-review approvals (the escalated, per-repo gate).
export function storiesHash(epicDir) {
  const dir = path.join(epicDir, 'stories');
  if (!fs.existsSync(dir)) return null;
  const parts = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => `${f}:${fileSha(path.join(dir, f))}`);
  if (!parts.length) return null;
  return 'sha256:' + createHash('sha256').update(parts.join('\n')).digest('hex');
}

// The reserved id of the project front-zero ("epic zero"). yad-discovery seeds it; yad-epic /
// yad-analysis must never pick this slug for a feature.
export const DISCOVERY_EPIC = 'EP-discovery';

// The project-discovery artifact set (EP-discovery / "epic zero"). The `discovery-review` step binds
// to the whole set, mirroring how stories-review binds to the stories/ directory — editing any file
// revokes prior approvals. A fixed list (not a dir scan) because the files live in the epic root.
export const DISCOVERY_FILES = [
  'market-research.md',
  'competitor-analysis.md',
  'current-state.md',
  'feasibility.md',
  'requirements.md',
  'roadmap.md',
];

// Deterministic fingerprint of the discovery set: hash every file in the fixed DISCOVERY_FILES order,
// combine. The WHOLE set is the reviewable unit — if any required artifact is missing the discovery is
// incomplete and NON-REVIEWABLE, so this returns null (no hash to bind an approval to), the same
// "nothing to lock" signal storiesHash/contractSurfaceHash give for an absent/malformed surface. Once
// the full set exists, an edit (or deletion) of any file changes the hash and revokes prior approvals.
export function discoveryHash(epicDir) {
  if (!DISCOVERY_FILES.every((f) => fs.existsSync(path.join(epicDir, f)))) return null;
  const parts = DISCOVERY_FILES.map((f) => `${f}:${fileSha(path.join(epicDir, f))}`);
  return 'sha256:' + createHash('sha256').update(parts.join('\n')).digest('hex');
}

// The content fingerprint an approval is bound to. For architecture the fingerprint is the locked
// contract surface (a re-lock => stale); for stories it is the whole stories/ set; for discovery it is
// the whole discovery file set; for every other artifact it is the file's bytes.
export function artifactHash(epicDir, artifact) {
  const b = artifactBase(artifact);
  if (b === 'architecture') return contractSurfaceHash(epicDir);
  if (b === 'stories') return storiesHash(epicDir);
  if (b === 'discovery') return discoveryHash(epicDir);
  return fileSha(path.join(epicDir, artifact.replace(/\/$/, '')));
}

// Shape checks for the ledger files. Fail fast with the exact file named — a wrong-shape ledger
// silently treated as a default would be rewritten by the next sync, destroying the real data.
const badShape = (file, what) => err('YAD-STATE-002', `${file}: ${what}`, 'fix the file or restore it from git');
function requireArray(v, file) {
  if (!Array.isArray(v)) throw badShape(file, 'expected a JSON array');
  return v;
}
function validateState(state, file) {
  if (state === null) return null; // missing state.json = epic not seeded yet, a normal state
  if (typeof state !== 'object' || Array.isArray(state)) throw badShape(file, 'expected a JSON object');
  if (!Array.isArray(state.steps) || !state.steps.length) throw badShape(file, 'expected a non-empty `steps` array');
  for (const s of state.steps) {
    if (!s || typeof s.id !== 'string' || typeof s.type !== 'string' || typeof s.status !== 'string') {
      throw badShape(file, 'every step needs string `id`, `type` and `status`');
    }
  }
  if (typeof state.currentStep !== 'string') throw badShape(file, 'expected a string `currentStep`');
  return state;
}

// Every build-state/<story>.json under the epic, story-sorted. Missing dir = the build half hasn't
// started yet, a normal state → []. The per-story files drive `yad next`'s build sub-step guidance —
// advisory, read-only hints, NOT a source-of-truth ledger. So a corrupt file is skipped (non-throwing
// `readJSON`), not fatal: `yad next` (and especially the all-epics roll-up) must still orient the user
// even if one story's hint file is broken, rather than aborting the whole command.
function loadBuildStates(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => readJSON(path.join(dir, f), null))
    .filter((bs) => bs && typeof bs === 'object' && !Array.isArray(bs));
}

export function loadLedger(epicDir) {
  const f = epicFiles(epicDir);
  return {
    files: f,
    state: validateState(readJSONStrict(f.state, null), f.state),
    approvals: requireArray(readJSONStrict(f.approvals, []), f.approvals),
    comments: requireArray(readJSONStrict(f.comments, []), f.comments),
    hubPrs: requireArray(readJSONStrict(f.hubPrs, []), f.hubPrs),
    contractLock: readJSONStrict(f.contractLock, null),
    buildStates: loadBuildStates(f.buildStateDir),
  };
}

// The review+approve step for an artifact (or the current step if it is a review step).
export function findReviewStep(state, artifact) {
  if (!state?.steps) return null;
  const base = artifactBase(artifact);
  return state.steps.find(
    (s) => s.type === 'review+approve' && artifactBase(s.artifact) === base,
  ) || null;
}

export const isEscalated = (step) =>
  (step?.risk_tags || []).some((t) => RISK_ESCALATORS.includes(t)) || step?.id === 'stories-review';

// The authoring step paired with a review gate: `stories-review` -> `stories`. Resolved BY ID (the
// same `-review` suffix convention `isSkippableStep` uses), never positionally — a chain may legally
// omit the author step (a change-epic that carries only the gate), and `steps[i-1]` would then point
// at an unrelated step. Returns null when the chain has no such step.
export function authorStepFor(state, reviewStep) {
  const id = String(reviewStep?.id || '');
  if (!id.endsWith('-review')) return null;
  return state?.steps?.find((s) => s.id === id.replace(/-review$/, '')) || null;
}

// Closing a review gate implies its artifact was authored — so the CLI, not the authoring skill, is
// what makes `<step>.status = done` true. Without this an author step left at `in_progress` strands
// forever: `preconditionsMet` requires every PRIOR step done, so the parallel `test-cases` track (and
// every later step) stays blocked behind a review that already passed. Idempotent; a no-op on an
// absent step and on a `skipped` one (already `done`, carrying its skip provenance).
// Returns the id it closed, or null.
function closeAuthorStep(state, reviewStep) {
  const author = authorStepFor(state, reviewStep);
  if (!author || author.status === 'done') return null;
  author.status = 'done';
  return author.id;
}

const uniqueBy = (arr, key) => {
  const seen = new Set();
  return arr.filter((x) => (seen.has(x[key]) ? false : seen.add(x[key])));
};

// PURE gate predicate. Given the step, its approvals, the current content hash, the PR thread/merge
// state and the touched domains, decide whether the gate passes — and exactly what is missing.
// `currentHash` drops any approval bound to a different hash (revoke-on-change). `merged` /
// `threadsResolved` come from the platform; with no bridge they default to the "advance" intent.
export function gatePredicate({
  step,
  approvals,
  currentHash = null,
  touchedDomains = [],
  defaultReviewers = 1,
  threadsResolved = true,
  merged = true,
  solo = false,
  requireEngagement = false,
}) {
  // Phase 6: an INHERITED step (a change-epic carrying a parent artifact by reference) is satisfied
  // without re-review — its approval lives upstream in the thread, recorded as an `inherited` provenance
  // entry. It is pre-marked `done` in state.json, so the gate is normally never invoked on it; this
  // short-circuit makes a direct call safe and surfaces a corrupted boundHash (a referenced artifact
  // cannot change under the child, so a mismatch is corruption — re-thread, do not silently pass).
  if (step?.inherited) {
    const drift = step.boundHash && currentHash && step.boundHash !== currentHash;
    return {
      approvalsSatisfied: true, threadsResolved: true, merged: true, staleDropped: 0,
      passed: !drift,
      missing: drift ? [`inherited artifact drifted from ${step.inheritedFrom || 'parent'} — re-thread`] : [],
      rule: 'inherited',
    };
  }

  // A SKIPPED step (an optional step the team marked N/A for this epic — e.g. `ui-design` on a
  // backend-only epic) is satisfied without review. Like `inherited`, it is pre-marked `done` in
  // state.json so the gate is normally never invoked on it; this short-circuit makes a direct call
  // safe and keeps the skip a first-class, auditable outcome (the reason lives on the step).
  // GUARD: only honour the flag on a genuinely skippable step (the author step or its `-review` gate).
  // A corrupted/hand-edited `skipped: true` on a non-optional step (e.g. `stories-review`) must NOT
  // bypass approvals — it falls through to the real predicate below and fails for lack of approvals.
  if (step?.skipped && isSkippableStep(step.id)) {
    return {
      approvalsSatisfied: true, threadsResolved: true, merged: true, staleDropped: 0,
      passed: true, missing: [], rule: 'skipped',
    };
  }

  const forStep = approvals.filter((a) => a.step === step.id && a.status === 'approved');
  // Revoke-on-change: an approval bound to a stale content hash no longer counts.
  const stale = forStep.filter((a) => a.artifactHash && currentHash && a.artifactHash !== currentHash);
  const live = forStep.filter((a) => !stale.includes(a));

  // requireEngagement (config `hub.review.requireEngagement`, soft-off by default): only an approval
  // carrying a verified engagement signal counts. The signal is gameable by design — this raises the
  // cost of a bare rubber-stamp, it does not claim to prove a human read the artifact.
  const counted = requireEngagement ? live.filter((a) => a.engagement === 'verified') : live;
  const unengaged = requireEngagement ? live.filter((a) => a.engagement !== 'verified').length : 0;
  const owners = uniqueBy(counted.filter((a) => a.role === 'owner'), 'approver');
  const reviewers = uniqueBy(counted.filter((a) => a.role === 'reviewer'), 'approver');
  const domainOwners = counted.filter((a) => a.role === 'domain-owner');

  const escalate = isEscalated(step);
  const missing = [];
  // Solo mode waives the APPROVAL requirements entirely (you can't approve your own PR on GitHub) —
  // merge + resolved threads are what advance the step. Team mode is unchanged.
  if (!solo) {
    if (owners.length < 1) missing.push('1 owner approval');
    if (reviewers.length < defaultReviewers) {
      missing.push(`${defaultReviewers - reviewers.length} reviewer approval(s)`);
    }
    if (escalate) {
      for (const d of touchedDomains) {
        if (!domainOwners.some((a) => a.domain === d)) missing.push(`domain-owner for ${d}`);
      }
    }
  }
  const approvalsSatisfied = missing.length === 0;
  // Surface engagement-gated approvals that did not count (only when requireEngagement holds the gate).
  if (!solo && requireEngagement && !approvalsSatisfied && unengaged) {
    missing.push(`${unengaged} approval(s) without verified engagement — run \`yad gate review\` so they count`);
  }
  // A stale approval only matters when approvals are required (team mode); in solo they are moot.
  if (!solo && stale.length) missing.unshift(`${stale.length} approval(s) revoked — artifact changed; re-approve`);
  if (!threadsResolved) missing.push('unresolved review comments');
  if (!merged) missing.push('review PR/MR not merged');

  return {
    approvalsSatisfied,
    threadsResolved,
    merged,
    staleDropped: stale.length,
    passed: approvalsSatisfied && threadsResolved && merged,
    missing,
    rule: solo ? 'solo' : escalate ? (step.id === 'stories-review' ? 'per-repo' : 'escalated') : 'base',
  };
}

// Advance the step in state.json once the predicate passes. Mirrors yad-review-gate Step 3:
// mark this review step done, unblock the next step, or set `ready-for-build` for the last one.
//
// `test-cases` is a PARALLEL, non-blocking track so the build half can start while the tester works:
// approving `stories-review` makes the epic `ready-for-build` (the build half keys off this) AND opens
// `test-cases` for the tester; completing `test-cases-review` never pulls `currentStep` back from
// `ready-for-build`. Both rules degrade safely for an old chain that has no test-cases steps.
export function advanceState(state, step) {
  const i = state.steps.findIndex((s) => s.id === step.id);
  state.steps[i] = { ...state.steps[i], status: 'done' };
  // Defensive: `markInReview` normally closed the author step when the gate opened, but the CI bridge
  // advances on a merge event without ever running it locally. Close it here too, so a passed gate can
  // never leave its author step behind (issue #131).
  closeAuthorStep(state, step);
  if (step.id === 'stories-review') {
    const tc = state.steps.find((s) => s.id === 'test-cases');
    if (tc && tc.status === 'blocked') tc.status = 'in_progress';
    state.currentStep = 'ready-for-build';
    return state;
  }
  if (step.id === 'test-cases-review') {
    state.currentStep = 'ready-for-build';
    return state;
  }
  // Discovery is the project front-zero ("epic zero"): it has no build half, so its review terminates
  // at a `discovery-done` sentinel rather than `ready-for-build` (which would make `yad next` claim the
  // build half can run). The roadmap it approved is the input the real feature epics read.
  if (step.id === 'discovery-review') {
    state.currentStep = 'discovery-done';
    return state;
  }
  // Step over any SKIPPED steps (an optional step marked N/A for this epic — e.g. a skipped
  // `ui-design`/`ui-design-review` pair). They are pre-marked `done`, so the next runnable step is the
  // first later step that is not skipped. When the whole tail is skipped, fall through to ready-for-build.
  let j = i + 1;
  while (state.steps[j]?.skipped) j++;
  const next = state.steps[j];
  if (next) {
    next.status = next.type === 'review+approve' ? 'in_review' : 'in_progress';
    state.currentStep = next.id;
  } else {
    state.currentStep = 'ready-for-build';
  }
  return state;
}

// The front steps that may be marked N/A ("skipped") for an epic that does not need them. Only the
// UI-design step is optional today: an epic with no user-facing surface (backend/API, data, infra)
// can skip it. A skip carries a recorded reason and stays VISIBLE in the chain (both the author step
// and its review gate pre-marked `done`, short-circuited by `gatePredicate`) — the auditable,
// reversible counterpart to omitting `analysis` from the chain entirely.
export const SKIPPABLE_STEPS = new Set(['ui-design']);

// True for a genuinely skippable step id — the author step (`ui-design`) OR its paired review gate
// (`ui-design-review`). Used to gate the `gatePredicate` skip short-circuit so a corrupted/hand-edited
// `skipped: true` on a non-optional step cannot bypass its real approvals.
export function isSkippableStep(id) {
  return SKIPPABLE_STEPS.has(String(id || '').replace(/-review$/, ''));
}

// Strip the skip-provenance fields off a step — the inverse of the stamp `skipStep` applies.
function withoutSkip(step) {
  const rest = { ...step };
  delete rest.skipped;
  delete rest.skipReason;
  delete rest.skippedBy;
  delete rest.skippedAt;
  return rest;
}

// PURE. Mark a skippable step (its author step + paired `<id>-review` gate) N/A for this epic: pre-mark
// both `done` with a recorded reason, and — if currentStep is sitting on the pair — advance currentStep
// past them to the next non-skipped step. Idempotent on an already-skipped step. Refuses once the step
// was authored, once its review gate has opened, or once its downstream `stories` has started — the
// step is optional only up to authoring it. Throws on a non-skippable id or a malformed (unpaired) chain.
export function skipStep(state, stepId, { reason, by = null, at = null } = {}) {
  if (!SKIPPABLE_STEPS.has(stepId)) {
    throw err('YAD-STATE-004', `step '${stepId}' is not optional`, `only these steps may be skipped: ${[...SKIPPABLE_STEPS].join(', ')}`);
  }
  const ai = state.steps.findIndex((s) => s.id === stepId);
  if (ai === -1) throw err('YAD-STATE-004', `step '${stepId}' is not in this epic's chain`, 'nothing to skip');
  const author = state.steps[ai];
  // Idempotent BEFORE the reason check: a repeat skip on an already-N/A step is a no-op that keeps the
  // original reason/actor, so it must not fail merely for lacking a fresh --reason.
  if (author.skipped) return state;
  if (!reason || !String(reason).trim()) {
    throw err('YAD-STATE-004', 'a skip needs a reason', 'pass a reason, e.g. "backend-only epic, no UI"');
  }
  // A skippable step must carry its paired `-review` gate — the change keeps BOTH in the chain. A
  // missing gate is a malformed chain; refuse rather than half-stamp only the author step.
  const ri = state.steps.findIndex((s) => s.id === `${stepId}-review`);
  if (ri === -1) throw err('YAD-STATE-004', `malformed chain: ${stepId} has no ${stepId}-review gate`, 'restore state.json from git');
  const review = state.steps[ri];
  if (author.status === 'done') {
    throw err('YAD-STATE-004', `${stepId} is already authored`, 'cannot skip a step whose artifact was already written');
  }
  // Once the review gate has opened (in_review / done), the UI work is effectively committed — skipping
  // then would orphan a live review PR. Refuse; the step is optional only up to authoring it.
  if (review.status !== 'blocked') {
    throw err('YAD-STATE-004', `cannot skip ${stepId} — its review has already opened`, 'skip the UI step before its review begins');
  }
  const stories = state.steps.find((s) => s.id === 'stories');
  if (stories && stories.status !== 'blocked') {
    throw err('YAD-STATE-004', `cannot skip ${stepId} — stories have already started`, 'skip the UI step before stories begin');
  }
  const stamp = { skipped: true, skipReason: String(reason).trim(), skippedBy: by, skippedAt: at, status: 'done' };
  state.steps[ai] = { ...author, ...stamp };
  state.steps[ri] = { ...review, ...stamp };
  // If currentStep was on the pair we just skipped, move it to the next non-skipped step.
  if (state.currentStep === stepId || state.currentStep === `${stepId}-review`) {
    let j = ri + 1;
    while (state.steps[j]?.skipped) j++;
    const next = state.steps[j];
    if (next) {
      if (next.status === 'blocked') next.status = next.type === 'review+approve' ? 'in_review' : 'in_progress';
      state.currentStep = next.id;
    } else {
      state.currentStep = 'ready-for-build';
    }
  }
  return state;
}

// PURE. Reverse a skip: clear the N/A stamp on the pair and restore the chain. Allowed only while the
// downstream `stories-review` has not opened (state-only signal for "stories authoring is under way").
// If every earlier step is done, the restored author step becomes the active step again (and a
// downstream that the skip auto-opened is pushed back to `blocked` behind it); otherwise it just
// returns to `blocked`. Throws if the step is not skipped or it is too late.
export function unskipStep(state, stepId) {
  if (!SKIPPABLE_STEPS.has(stepId)) {
    throw err('YAD-STATE-004', `step '${stepId}' is not optional`, `only these steps may be skipped: ${[...SKIPPABLE_STEPS].join(', ')}`);
  }
  const ai = state.steps.findIndex((s) => s.id === stepId);
  if (ai === -1) throw err('YAD-STATE-004', `step '${stepId}' is not in this epic's chain`, 'nothing to un-skip');
  if (!state.steps[ai].skipped) throw err('YAD-STATE-004', `${stepId} is not skipped`, 'nothing to un-skip');
  const storiesReview = state.steps.find((s) => s.id === 'stories-review');
  if (storiesReview && storiesReview.status !== 'blocked') {
    throw err('YAD-STATE-004', `cannot un-skip ${stepId} — the stories review has already opened`, 'un-skip before the stories review begins');
  }
  const ri = state.steps.findIndex((s) => s.id === `${stepId}-review`);
  const priorAllDone = state.steps.slice(0, ai).every((s) => s.status === 'done');
  state.steps[ai] = { ...withoutSkip(state.steps[ai]), status: priorAllDone ? 'in_progress' : 'blocked' };
  if (ri !== -1) state.steps[ri] = { ...withoutSkip(state.steps[ri]), status: 'blocked' };
  if (priorAllDone) {
    // The restored author step is the active step again. Push the downstream the skip auto-opened
    // back to `blocked` (it must wait behind the now-live step), and re-point currentStep here. Scan
    // past any still-skipped steps (mirrors skipStep's step-over) and reset whether it was opened as
    // an author step (`in_progress`) or a review gate (`in_review`).
    let j = (ri !== -1 ? ri : ai) + 1;
    while (state.steps[j]?.skipped) j++;
    const after = state.steps[j];
    if (after && (after.status === 'in_progress' || after.status === 'in_review')) after.status = 'blocked';
    state.currentStep = stepId;
  }
  return state;
}

// Mark a step in-review (idempotent) and point currentStep at it — EXCEPT once the epic is
// `ready-for-build`: the parallel `test-cases` track must not pull currentStep back (the build half
// runs alongside the tester, and only the test-cases review is in flight at that point).
export function markInReview(state, step) {
  const i = state.steps.findIndex((s) => s.id === step.id);
  if (state.steps[i].status !== 'done') state.steps[i].status = 'in_review';
  // Opening a review gate means the artifact was authored — close the paired author step rather than
  // trusting the authoring skill to have hand-edited state.json (issue #131).
  closeAuthorStep(state, step);
  if (state.currentStep !== 'ready-for-build') state.currentStep = step.id;
  return state;
}

// The front authoring step a `yad next` action maps to — the skill the user invokes for that step.
// Review (review+approve) steps are driven by the `yad gate` CLI, not a skill, so they are not here.
export const STEP_SKILL = {
  discovery: 'yad-discovery',
  analysis: 'yad-analysis',
  epic: 'yad-epic',
  architecture: 'yad-architecture',
  'ui-design': 'yad-ui',
  stories: 'yad-stories',
  'test-cases': 'yad-test-cases',
};

// The skill that runs each BACK-half (build) step — the build-state analogue of STEP_SKILL. `spec`
// and `tasks` are the two legs of the SAME yad-spec ceremony (run-loop.md), so both map to yad-spec;
// the chain renderer collapses the consecutive duplicate. `engineer-review` is the human merge gate.
export const BUILD_STEP_SKILL = {
  spec: 'yad-spec',
  tasks: 'yad-spec',
  implement: 'yad-implement',
  checks: 'yad-checks',
  'engineer-review': 'yad-engineer-review',
};

// The fixed back-half order. Used to derive the "remaining chain" from the active step onward even if a
// repo's `steps` array is partial or out of order.
const BUILD_STEP_ORDER = ['spec', 'tasks', 'implement', 'checks', 'engineer-review'];

// Collapse consecutive identical skills (spec+tasks → one yad-spec) so the rendered chain reads
// yad-spec → yad-implement → yad-checks → yad-engineer-review, matching the build-half mental model.
// Folds against the last KEPT element (not the raw neighbor) so a dropped null between duplicates can't
// reintroduce one.
function dedupeConsecutive(skills) {
  const out = [];
  for (const s of skills) if (s && s !== out[out.length - 1]) out.push(s);
  return out;
}

// PURE: given ONE repo's build-state ({ currentStep, steps }), resolve the next build sub-step and the
// remaining chain. The active step is `currentStep`'s entry, or the first step not yet `done`. Returns
// `shipped: true` only when there ARE steps and every one is `done`; an empty/missing steps array is
// `unknown` (not-started), NEVER shipped — otherwise a half-seeded file would render a false "shipped ✓".
export function buildNextForRepo(repoState = {}) {
  const steps = Array.isArray(repoState.steps) ? repoState.steps : [];
  const byId = new Map(steps.map((s) => [s.id, s]));
  // Empty/half-seeded file ⇒ unknown (not-started), NEVER shipped. Every step done ⇒ shipped.
  if (!steps.length) {
    return { step: null, status: 'unknown', shipped: false, skill: null, automation: null, locked: false, chain: [] };
  }
  if (steps.every((s) => s.status === 'done')) {
    return { step: null, status: 'done', shipped: true, skill: null, automation: null, locked: false, chain: [] };
  }
  // Active = the orchestrator's currentStep when it isn't already done, else the first not-done step
  // (guaranteed to exist here — not every step is done). currentStep authority, with a done-step skip.
  const cur = byId.get(repoState.currentStep);
  const active = cur && cur.status !== 'done' ? cur : steps.find((s) => s.status !== 'done');
  // The remaining chain: the active step + every later step in the canonical order, mapped to skills.
  const from = BUILD_STEP_ORDER.indexOf(active.id);
  const tail = from === -1 ? [active.id] : BUILD_STEP_ORDER.slice(from);
  const chain = dedupeConsecutive(tail.map((id) => BUILD_STEP_SKILL[id] || null));
  return {
    step: active.id,
    status: active.status || 'blocked',
    automation: active.automation || 'human_approve',
    locked: !!active.locked,
    skill: BUILD_STEP_SKILL[active.id] || null,
    shipped: false,
    chain,
  };
}

// PURE: map every parsed build-state object → its per-repo next sub-steps. `buildStates` is the array
// `loadLedger` reads from build-state/*.json. Repos are sorted for a stable, machine-independent order.
export function buildNextActions(buildStates = []) {
  return buildStates.map((bs) => ({
    story: bs.story || null,
    repos: Object.keys(bs.repos || {}).sort()
      .map((repo) => ({ repo, ...buildNextForRepo(bs.repos[repo]) })),
  }));
}

// Classify a stub / backfill anchor from its ledger state — the SINGLE source of truth so `nextAction`
// and `preconditionsMet` can never disagree, even on a partially-applied `promote`. The `stub` check
// takes precedence over `backfill-done`, so a half-cleared promote (`kind:stub` still set while
// `currentStep` already moved) reads as still-a-stub — the conservative side (needs promoting). Returns
// `'stub'` (un-promoted anchor), `'documented'` (light-promoted anchor), or `null` (a normal epic).
export function backfillAnchorKind(state) {
  if (!state) return null;
  if (state.kind === 'stub' || state.currentStep === 'backfill-pending') return 'stub';
  if (state.currentStep === 'backfill-done') return 'documented';
  return null;
}

// PURE precondition guard. Is `stepId` runnable right now? A step is runnable iff every step BEFORE it
// in the chain is `done` and the step itself is not already `done`. With no state yet (greenfield), the
// only runnable steps are the entry authoring steps (analysis | epic). Used by `yad next --check`
// (the Phase B rail) and by the driver. No FS / network.
export function preconditionsMet(state, stepId) {
  if (!state || !Array.isArray(state.steps)) {
    const ok = stepId === 'epic' || stepId === 'analysis' || stepId === 'discovery';
    return { ok, blockedBy: null, reason: ok ? 'entry step (no state seeded yet)' : `start with yad-epic — no epic state for '${stepId}'` };
  }
  // A stub anchor (backfill-pending) or a light-promoted anchor (backfill-done) has NO runnable front
  // step: its front chain is intentionally left `blocked`. It evolves via `yad-backfill promote` / a
  // threaded `yad-change`, never by authoring `epic` against the anchor itself — so the precondition
  // guard must not green-light one (its blocked steps would otherwise read as "entry step ready").
  const anchorKind = backfillAnchorKind(state);
  if (anchorKind) {
    const anchor = anchorKind === 'documented';
    return { ok: false, blockedBy: null,
      reason: anchor
        ? `${stepId} is not runnable — this is a documented backfill anchor; evolve it with yad-change`
        : `${stepId} is not runnable — this is a stub (backfill pending); run yad-backfill then promote, or thread a change with yad-change` };
  }
  const i = state.steps.findIndex((s) => s.id === stepId);
  if (i === -1) return { ok: false, blockedBy: null, reason: `unknown step '${stepId}'` };
  if (state.steps[i].status === 'done') return { ok: false, blockedBy: null, reason: `${stepId} is already done` };
  const blocker = state.steps.slice(0, i).find((s) => s.status !== 'done');
  if (blocker) return { ok: false, blockedBy: blocker.id, reason: `${blocker.id} has not passed yet` };
  return { ok: true, blockedBy: null, reason: 'ready' };
}

// PURE. Consistency invariants over a chain, for `doctor` (report) and `gate repair` (heal). Today one
// rule: a `review+approve` step that is `done` must have its paired author step `done` too — a gate
// cannot have passed on an unauthored artifact. Violations are epics damaged by a pre-fix `gate sync`
// (issue #131); they read as healthy to a `currentStep`-only check while silently blocking every later
// step through `preconditionsMet`.
//
// Deliberately NOT the broader "no non-done step precedes a done one": the parallel `test-cases` track
// legitimately sits `in_progress` after `stories-review` advanced the epic to ready-for-build.
// No FS / network. Returns [] on a missing or malformed chain (loadLedger already reports that).
export function stateInvariants(state) {
  if (!state || !Array.isArray(state.steps)) return [];
  const violations = [];
  for (const step of state.steps) {
    if (step.type !== 'review+approve' || step.status !== 'done') continue;
    const author = authorStepFor(state, step);
    if (!author || author.status === 'done') continue;
    violations.push({
      code: 'YAD-STATE-005',
      reviewStep: step.id,
      authorStep: author.id,
      message: `${author.id} is '${author.status}' behind a completed ${step.id}`,
    });
  }
  return violations;
}

// Apply the repair `stateInvariants` describes: close every author step stranded behind a done review
// gate. Mutates `state` and returns the ids it closed (empty when already consistent — idempotent).
export function repairState(state) {
  const closed = [];
  for (const v of stateInvariants(state)) {
    const author = state.steps.find((s) => s.id === v.authorStep);
    if (author && author.status !== 'done') { author.status = 'done'; closed.push(author.id); }
  }
  return closed;
}

// PURE next-action resolver for ONE epic's ledger — what `yad next <epic>` prints. Reads state + the
// recorded review PRs only. kind:
//   'new'         — no epic state yet (seed one with yad-epic)
//   'author'      — invoke a front authoring skill (STEP_SKILL)
//   'review-open' — open the review PR/MR (`yad gate open`)
//   'review-sync' — a review PR/MR is open; sync its state (`yad gate sync`)
//   'build'       — front half approved (ready-for-build); the build half can run
export function nextAction(ledger, { epic } = {}) {
  const state = ledger?.state;
  const epicId = epic || state?.epicId || null;
  if (!state) return { epicId, kind: 'new', skill: 'yad-epic', why: 'no epic state yet — seed it with yad-epic' };

  // EP-discovery ("epic zero") is the project front-zero: a 2-step author→review chain with no build
  // half and no parallel track. Resolve its action in isolation so the feature-epic logic below never
  // applies to it.
  if (state.kind === 'discovery') {
    if (state.currentStep === 'discovery-done') {
      return { epicId, kind: 'discovery-done', step: 'discovery-done', status: 'done',
        why: 'discovery approved — seed feature epics with yad-epic (each reads roadmap.md)' };
    }
    const dstep = state.steps.find((s) => s.id === state.currentStep)
      || state.steps.find((s) => s.status !== 'done');
    if (!dstep) return { epicId, kind: 'discovery-done', step: 'discovery-done', why: 'discovery is done' };
    if (dstep.type === 'author') {
      return { epicId, kind: 'author', step: dstep.id, status: dstep.status,
        skill: STEP_SKILL[dstep.id] || null, artifact: dstep.artifact,
        why: `${dstep.id} is ${dstep.status} — author ${dstep.artifact}` };
    }
    const dpr = (ledger.hubPrs || []).find((p) => artifactBase(p.artifact) === artifactBase(dstep.artifact));
    const dverb = dpr ? 'sync' : 'open';
    return { epicId, kind: dpr ? 'review-sync' : 'review-open', step: dstep.id, status: dstep.status,
      artifact: dstep.artifact, pr: dpr ? dpr.number : null,
      command: `yad gate ${dverb} ${epicId} ${dstep.artifact}`,
      why: dpr ? `review PR #${dpr.number} is open — sync its state to advance` : `${dstep.id} is open — create the review PR/MR` };
  }

  // A STUB genesis epic (yad-stub) or a light-promoted anchor: classified by the SHARED
  // `backfillAnchorKind` helper (the same one `preconditionsMet` uses), so the two readers can never
  // disagree — even on a partially-applied `promote`. A stub is (epic.md `stub:backfill-pending`) ⟺
  // (state.kind:stub + currentStep:backfill-pending); `yad-backfill promote` clears ALL of these
  // atomically (see state-schema.md), keeping this sentinel in step with `isStubEpic` (frontmatter).
  const anchorKind = backfillAnchorKind(state);
  if (anchorKind === 'stub') {
    // No build half until backfilled + promoted — route to yad-backfill (not to authoring the epic),
    // and remind that bugs can thread off it now with yad-change.
    return { epicId, kind: 'backfill-pending', step: 'backfill-pending', status: 'stub',
      why: 'stub epic (backfill pending) — document the code with yad-backfill then `yad-backfill promote` to make it real; thread bugs now with yad-change' };
  }
  if (anchorKind === 'documented') {
    // `yad-backfill promote` documented the feature (verified) but did NOT wake the front chain (its docs
    // live in the backfill spec). Terminal like `discovery-done` — no build half runs directly; the
    // feature evolves by threading a change/defect off it.
    return { epicId, kind: 'backfill-done', step: 'backfill-done', status: 'documented',
      why: 'backfilled anchor (documented) — no build half runs directly; evolve it by threading a change/defect with yad-change' };
  }

  // The parallel test-cases track stays workable even once the epic is ready-for-build.
  const tc = state.steps.find((s) => s.id === 'test-cases');
  const tcOpen = !!tc && tc.status !== 'done' && tc.status !== 'blocked';
  const parallel = tcOpen ? { step: 'test-cases', skill: STEP_SKILL['test-cases'], artifact: tc.artifact } : null;

  if (state.currentStep === 'ready-for-build') {
    // Once stories enter the build half, surface each story/repo's CONCRETE next sub-step (spec →
    // implement → checks → engineer-review) from build-state, not one static "run the build half" hint.
    const builds = buildNextActions(ledger?.buildStates || []);
    const lanes = builds.flatMap((b) => b.repos);
    const open = lanes.filter((r) => !r.shipped);
    if (builds.length) {
      let why;
      if (!lanes.length) why = 'build half started — no repo lanes recorded yet';
      else if (!open.length) why = 'build half — every story/repo lane is shipped';
      else why = `build half in progress — ${open.length} story/repo lane(s) still moving`;
      return { epicId, kind: 'build', step: 'ready-for-build', status: 'ready-for-build', parallel, builds, why };
    }
    return { epicId, kind: 'build', step: 'ready-for-build', status: 'ready-for-build', parallel,
      why: 'front half approved — the build half can run' };
  }

  const step = state.steps.find((s) => s.id === state.currentStep)
    || state.steps.find((s) => s.status !== 'done');
  if (!step) {
    const builds = buildNextActions(ledger?.buildStates || []);
    return { epicId, kind: 'build', step: 'ready-for-build', parallel,
      builds: builds.length ? builds : undefined, why: 'all front steps are done' };
  }

  if (step.type === 'author') {
    return { epicId, kind: 'author', step: step.id, status: step.status, parallel,
      skill: STEP_SKILL[step.id] || null, artifact: step.artifact,
      why: `${step.id} is ${step.status} — author ${step.artifact}` };
  }

  // review+approve: open the review PR if none is recorded yet, else sync the open one.
  const pr = (ledger.hubPrs || []).find((p) => artifactBase(p.artifact) === artifactBase(step.artifact));
  const verb = pr ? 'sync' : 'open';
  return { epicId, kind: pr ? 'review-sync' : 'review-open', step: step.id, status: step.status,
    artifact: step.artifact, pr: pr ? pr.number : null, parallel,
    command: `yad gate ${verb} ${epicId} ${step.artifact}`,
    why: pr ? `review PR #${pr.number} is open — sync its state to advance` : `${step.id} is open — create the review PR/MR` };
}

// ---- Phase 6: feature threads (lineage frontmatter on epic.md) -----------------------------------

// Minimal frontmatter reader (key: value, and `inherits: [a, b]` arrays). Mirrors gate.mjs's reader so
// the thread helpers and the gate agree on the same parse; shared here as the lineage source.
export function readFrontmatter(file) {
  if (!fs.existsSync(file)) return {};
  const m = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    out[k] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : v.trim();
  }
  return out;
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// The human-facing noun for a lineage kind. Presentation only — the artifact is always an epic
// (`EP-<slug>`); this just renders WHAT KIND of work it is so `yad next`/`yad thread`/`yad status`
// read as "Defect EP-…" / "Change request EP-…" instead of a generic "Epic". `feature` (and any
// unknown/absent kind) falls back to "Epic". A bug is a defect (kind:defect) — no separate noun.
export const KIND_NOUN = { feature: 'Epic', change: 'Change request', defect: 'Defect', hotfix: 'Hotfix' };
export const kindNoun = (kind) => KIND_NOUN[kind] || 'Epic';

// The lineage of an epic from epic.md frontmatter. `kind` defaults to `feature` (genesis) when absent,
// so an un-migrated genesis epic behaves as the thread root. Greenfield/missing-safe.
export function epicLineage(root, epic) {
  const fm = readFrontmatter(path.join(epicRoot(root, epic), 'epic.md'));
  return {
    kind: fm.kind || 'feature',
    parent: fm.parent || null,
    thread: fm.thread || null,
    inherits: asList(fm.inherits),
    supersedes: asList(fm.supersedes),
  };
}

// Is this a STUB genesis epic (minted by yad-stub as a brownfield thread anchor)? A stub is kind:feature
// but carries `stub: backfill-pending` in epic.md frontmatter until `yad-backfill promote` flips it to a
// real, verified epic (which clears the marker). Missing/greenfield-safe. Read by yad thread / yad-status
// / the reconciler to render "stub (backfill pending)" and never treat it as a fully-specced feature.
export function isStubEpic(root, epic) {
  return readFrontmatter(path.join(epicRoot(root, epic), 'epic.md')).stub === 'backfill-pending';
}

// Walk `parent` to the thread root. Cycle- and missing-safe. Returns the genesis-first `chain`, the
// computed `rootId`, and a `broken` reason (missing parent dir, a cycle, or a denormalized `thread`
// cache that disagrees with the computed root) — the signal yad doctor / yad next --check report.
export function resolveThread(root, epicId) {
  const chain = [];
  const seen = new Set();
  let cur = epicId;
  let broken = null;
  while (cur) {
    if (seen.has(cur)) { broken = `cycle at ${cur}`; break; }
    seen.add(cur);
    if (!fs.existsSync(epicRoot(root, cur))) {
      broken = cur === epicId ? `missing epic ${cur}` : `missing parent epic ${cur}`;
      break;
    }
    chain.unshift(cur); // genesis ends up first
    const { parent } = epicLineage(root, cur);
    if (!parent) break; // reached genesis
    cur = parent;
  }
  const rootId = chain[0] || epicId;
  const tip = epicLineage(root, epicId);
  // A non-genesis epic (has a parent) MUST carry a `thread:` cache that equals the computed root.
  // A missing cache is corruption too — without it the bash gates' parent-walk is the only safety net,
  // and a tool reading the field would mis-scope the thread.
  if (!broken && tip.parent && !tip.thread) {
    broken = `missing thread cache on ${epicId} (kind:${tip.kind}, parent:${tip.parent}) — should be '${rootId}'`;
  }
  if (!broken && tip.thread && tip.thread !== rootId) {
    broken = `thread cache '${tip.thread}' != computed root '${rootId}'`;
  }
  return { rootId, chain, broken };
}

// Every epic that belongs to a thread (resolved root == this thread's root), ordered genesis-first by
// chain depth. Derived by scanning epics/ — no duplicated thread registry. Used by yad-timeline/yad-defects.
export function threadEpics(root, threadOrEpicId) {
  const { rootId } = resolveThread(root, threadOrEpicId);
  const dir = path.join(root, 'epics');
  if (!fs.existsSync(dir)) return [rootId];
  const depth = new Map();
  const members = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || !isValidEpicId(e.name) || !fs.existsSync(path.join(dir, e.name, 'epic.md'))) continue;
    const rt = resolveThread(root, e.name); // one walk per member (not per comparison)
    if (rt.rootId !== rootId) continue;
    members.push(e.name);
    depth.set(e.name, rt.chain.length);
  }
  // Genesis-first by depth, then a STABLE, machine-independent tie-break (id order) so the resolver is
  // deterministic across filesystems even when two epics sit at the same depth (a branch).
  return members.sort((a, b) => (depth.get(a) - depth.get(b)) || a.localeCompare(b));
}

// Compose the CURRENT authoritative source per artifact base across a thread: the LATEST epic in the
// chain that actually RE-AUTHORED it (did NOT list it in `inherits`). Genesis owns everything; a later
// change-epic shadows only what it re-authored. Returns { <base>: <owning epic id> } — the source-of-
// truth map AI/humans read for the next change (rendered by yad-timeline as thread-resolved.md).
export const THREAD_ARTIFACT_BASES = ['epic', 'architecture', 'contract', 'ui-design', 'stories', 'test-cases'];
// REPLACE bases — a re-author supersedes the prior version wholesale, so the LATEST re-author owns it
// (a contract-surface change re-locks and replaces; a re-authored architecture supersedes the old one).
const REPLACE_BASES = ['epic', 'architecture', 'contract', 'ui-design'];
// ADDITIVE bases — each re-authoring epic CONTRIBUTES (stories add files; a change adds its test-cases
// file), so the current truth is the UNION of contributors, never a single owner. Collapsing these to
// one epic would drop the parent's inherited stories/cases.
const ADDITIVE_BASES = ['stories', 'test-cases'];

// The owning epic per artifact base across a thread. REPLACE bases resolve to a single epic id (the
// latest re-author); ADDITIVE bases resolve to the ordered LIST of every epic that re-authored them
// (genesis-first) — use resolveCurrentStories for story-id-level ownership of the composed set.
export function resolveCurrentArtifacts(root, threadOrEpicId) {
  const members = threadEpics(root, threadOrEpicId); // genesis-first
  const out = {};
  for (const b of REPLACE_BASES) out[b] = null;
  for (const b of ADDITIVE_BASES) out[b] = [];
  for (const id of members) {
    const { inherits } = epicLineage(root, id);
    for (const b of REPLACE_BASES) if (!inherits.includes(b)) out[b] = id;
    for (const b of ADDITIVE_BASES) if (!inherits.includes(b)) out[b].push(id);
  }
  return out;
}

// Compose the current STORY SET at story-id granularity across the thread: each re-authoring epic's
// stories/ files are overlaid (a later same-id supersedes; a `supersedes:` entry retires a parent
// story). Returns { <story-id>: <owning epic id> } — the real current truth for stories, because a
// change-epic re-authors only the stories it changes and inherits the rest by reference. Without this,
// a defect-fix that adds one regression story would appear to drop every unchanged parent story.
export function resolveCurrentStories(root, threadOrEpicId) {
  const members = threadEpics(root, threadOrEpicId); // genesis-first
  const owner = {};
  for (const id of members) {
    const lin = epicLineage(root, id);
    for (const sid of lin.supersedes) delete owner[sid]; // explicitly retired parent stories
    if (lin.inherits.includes('stories')) continue; // inherited wholesale -> contributes nothing new
    const sdir = path.join(epicRoot(root, id), 'stories');
    if (!fs.existsSync(sdir)) continue;
    for (const f of fs.readdirSync(sdir).filter((x) => /\.md$/.test(x))) {
      owner[f.replace(/\.md$/, '')] = id; // contribute / override same-id
    }
  }
  return owner;
}

export { writeJSON };
