// Per-epic file ledger + the gate predicate. The file ledger (epics/<epic>/.sdlc/*.json) is the
// source of truth; the platform PR/MR is only an input path. Everything here is pure / filesystem —
// no gh/glab — so the predicate is unit-testable without a network. Node built-ins only.
import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { readJSON, writeJSON, fileSha } from './lib.mjs';
import { epicFiles } from './manifest.mjs';

const RISK_ESCALATORS = ['contract', 'auth', 'payments'];

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
  const m = branch.match(/^review\/(EP-[^/]+)\/(.+)$/);
  return m ? { epic: m[1], base: m[2] } : null;
}

// The reverse of artifactBase: an artifact-base back to the ledger's artifact path. A single-story
// base (stories-S01) still maps to stories/ — the stories gate is ONE step over the whole set
// (storiesHash fingerprints the directory), so any story branch syncs the same review step.
export function artifactFromBase(base) {
  if (base === 'stories' || /^stories-S\d+$/i.test(base)) return 'stories/';
  return `${base}.md`;
}

// The files (relative to the epic dir) a review of this artifact covers — what `gate open` commits
// on the review branch, and what the CI overlay checks out from the head ref (and never commits).
// Architecture mirrors artifactHash(): the approval is bound to the locked contract surface too.
export function artifactPaths(base) {
  if (base === 'architecture') return ['architecture.md', 'contract.md', '.sdlc/contract-lock.json'];
  if (base === 'stories') return ['stories'];
  return [`${base}.md`];
}

// Replace-not-append upsert into hub-prs.json, keyed by artifact (one live review PR per artifact).
export function upsertHubPr(hubPrs = [], rec) {
  return [...hubPrs.filter((p) => p.artifact !== rec.artifact), rec];
}

// SHA-256 of the contract surface block (architecture only). Mirrors
// sdlc-author-architecture/references/contract-format.md (awk markers + sha256).
export function contractSurfaceHash(epicDir) {
  const file = path.join(epicDir, 'contract.md');
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inside = false;
  const body = [];
  for (const ln of lines) {
    if (/CONTRACT-SURFACE:BEGIN/.test(ln)) { inside = true; continue; }
    if (/CONTRACT-SURFACE:END/.test(ln)) { inside = false; continue; }
    if (inside) body.push(ln);
  }
  if (!body.length) return null;
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

// The content fingerprint an approval is bound to. For architecture the fingerprint is the locked
// contract surface (a re-lock => stale); for stories it is the whole stories/ set; for every other
// artifact it is the file's bytes.
export function artifactHash(epicDir, artifact) {
  const b = artifactBase(artifact);
  if (b === 'architecture') return contractSurfaceHash(epicDir);
  if (b === 'stories') return storiesHash(epicDir);
  return fileSha(path.join(epicDir, artifact.replace(/\/$/, '')));
}

export function loadLedger(epicDir) {
  const f = epicFiles(epicDir);
  return {
    files: f,
    state: readJSON(f.state, null),
    approvals: readJSON(f.approvals, []),
    comments: readJSON(f.comments, []),
    hubPrs: readJSON(f.hubPrs, []),
    contractLock: readJSON(f.contractLock, null),
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
}) {
  const forStep = approvals.filter((a) => a.step === step.id && a.status === 'approved');
  // Revoke-on-change: an approval bound to a stale content hash no longer counts.
  const stale = forStep.filter((a) => a.artifactHash && currentHash && a.artifactHash !== currentHash);
  const live = forStep.filter((a) => !stale.includes(a));

  const owners = uniqueBy(live.filter((a) => a.role === 'owner'), 'approver');
  const reviewers = uniqueBy(live.filter((a) => a.role === 'reviewer'), 'approver');
  const domainOwners = live.filter((a) => a.role === 'domain-owner');

  const missing = [];
  if (owners.length < 1) missing.push('1 owner approval');
  if (reviewers.length < defaultReviewers) {
    missing.push(`${defaultReviewers - reviewers.length} reviewer approval(s)`);
  }
  const escalate = isEscalated(step);
  if (escalate) {
    for (const d of touchedDomains) {
      if (!domainOwners.some((a) => a.domain === d)) missing.push(`domain-owner for ${d}`);
    }
  }
  const approvalsSatisfied = missing.length === 0;
  if (stale.length) missing.unshift(`${stale.length} approval(s) revoked — artifact changed; re-approve`);
  if (!threadsResolved) missing.push('unresolved review comments');
  if (!merged) missing.push('review PR/MR not merged');

  return {
    approvalsSatisfied,
    threadsResolved,
    merged,
    staleDropped: stale.length,
    passed: approvalsSatisfied && threadsResolved && merged,
    missing,
    rule: escalate ? (step.id === 'stories-review' ? 'per-repo' : 'escalated') : 'base',
  };
}

// Advance the step in state.json once the predicate passes. Mirrors sdlc-review-gate Step 3:
// mark this review step done, unblock the next step, or set `ready-for-build` for the last one.
export function advanceState(state, step) {
  const i = state.steps.findIndex((s) => s.id === step.id);
  state.steps[i] = { ...state.steps[i], status: 'done' };
  const next = state.steps[i + 1];
  if (next) {
    next.status = next.type === 'review+approve' ? 'in_review' : 'in_progress';
    state.currentStep = next.id;
  } else {
    state.currentStep = 'ready-for-build';
  }
  return state;
}

// Mark a step in-review (idempotent) and point currentStep at it.
export function markInReview(state, step) {
  const i = state.steps.findIndex((s) => s.id === step.id);
  if (state.steps[i].status !== 'done') state.steps[i].status = 'in_review';
  state.currentStep = step.id;
  return state;
}

export { writeJSON };
