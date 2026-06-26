// Per-epic file ledger + the gate predicate. The file ledger (epics/<epic>/.sdlc/*.json) is the
// source of truth; the platform PR/MR is only an input path. Everything here is pure / filesystem —
// no gh/glab — so the predicate is unit-testable without a network. Node built-ins only.
import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { readJSONStrict, writeJSON, fileSha } from './lib.mjs';
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

export function loadLedger(epicDir) {
  const f = epicFiles(epicDir);
  return {
    files: f,
    state: validateState(readJSONStrict(f.state, null), f.state),
    approvals: requireArray(readJSONStrict(f.approvals, []), f.approvals),
    comments: requireArray(readJSONStrict(f.comments, []), f.comments),
    hubPrs: requireArray(readJSONStrict(f.hubPrs, []), f.hubPrs),
    contractLock: readJSONStrict(f.contractLock, null),
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
  solo = false,
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

  const forStep = approvals.filter((a) => a.step === step.id && a.status === 'approved');
  // Revoke-on-change: an approval bound to a stale content hash no longer counts.
  const stale = forStep.filter((a) => a.artifactHash && currentHash && a.artifactHash !== currentHash);
  const live = forStep.filter((a) => !stale.includes(a));

  const owners = uniqueBy(live.filter((a) => a.role === 'owner'), 'approver');
  const reviewers = uniqueBy(live.filter((a) => a.role === 'reviewer'), 'approver');
  const domainOwners = live.filter((a) => a.role === 'domain-owner');

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
  const next = state.steps[i + 1];
  if (next) {
    next.status = next.type === 'review+approve' ? 'in_review' : 'in_progress';
    state.currentStep = next.id;
  } else {
    state.currentStep = 'ready-for-build';
  }
  return state;
}

// Mark a step in-review (idempotent) and point currentStep at it — EXCEPT once the epic is
// `ready-for-build`: the parallel `test-cases` track must not pull currentStep back (the build half
// runs alongside the tester, and only the test-cases review is in flight at that point).
export function markInReview(state, step) {
  const i = state.steps.findIndex((s) => s.id === step.id);
  if (state.steps[i].status !== 'done') state.steps[i].status = 'in_review';
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

// PURE precondition guard. Is `stepId` runnable right now? A step is runnable iff every step BEFORE it
// in the chain is `done` and the step itself is not already `done`. With no state yet (greenfield), the
// only runnable steps are the entry authoring steps (analysis | epic). Used by `yad next --check`
// (the Phase B rail) and by the driver. No FS / network.
export function preconditionsMet(state, stepId) {
  if (!state || !Array.isArray(state.steps)) {
    const ok = stepId === 'epic' || stepId === 'analysis' || stepId === 'discovery';
    return { ok, blockedBy: null, reason: ok ? 'entry step (no state seeded yet)' : `start with yad-epic — no epic state for '${stepId}'` };
  }
  const i = state.steps.findIndex((s) => s.id === stepId);
  if (i === -1) return { ok: false, blockedBy: null, reason: `unknown step '${stepId}'` };
  if (state.steps[i].status === 'done') return { ok: false, blockedBy: null, reason: `${stepId} is already done` };
  const blocker = state.steps.slice(0, i).find((s) => s.status !== 'done');
  if (blocker) return { ok: false, blockedBy: blocker.id, reason: `${blocker.id} has not passed yet` };
  return { ok: true, blockedBy: null, reason: 'ready' };
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

  // The parallel test-cases track stays workable even once the epic is ready-for-build.
  const tc = state.steps.find((s) => s.id === 'test-cases');
  const tcOpen = !!tc && tc.status !== 'done' && tc.status !== 'blocked';
  const parallel = tcOpen ? { step: 'test-cases', skill: STEP_SKILL['test-cases'], artifact: tc.artifact } : null;

  if (state.currentStep === 'ready-for-build') {
    return { epicId, kind: 'build', step: 'ready-for-build', status: 'ready-for-build', parallel,
      why: 'front half approved — the build half can run' };
  }

  const step = state.steps.find((s) => s.id === state.currentStep)
    || state.steps.find((s) => s.status !== 'done');
  if (!step) return { epicId, kind: 'build', step: 'ready-for-build', parallel, why: 'all front steps are done' };

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
