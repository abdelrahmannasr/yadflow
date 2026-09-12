// Per-epic file ledger + the gate predicate. The file ledger (epics/<epic>/.sdlc/*.json) is the
// source of truth; the platform PR/MR is only an input path. Everything here is pure / filesystem —
// no gh/glab — so the predicate is unit-testable without a network. Node built-ins only.
import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { isPlainObject, readJSON, readJSONStrict, writeJSON, fileSha } from './lib.mjs';
import { err } from './errors.mjs';
import {
  ADVANCE_FROM_AUTOMATION, AUTOMATION_FROM_ADVANCE, DRIVER_FROM_ASSISTANCE, epicFiles, preferring,
  PROJECT_FILES, SCHEMA_VERSION, stepAdvance,
} from './manifest.mjs';

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

// ---- canonical ledger order ---------------------------------------------------------------------
// Every epic-ledger upsert in this codebase is drop-and-re-append: the records being refreshed are
// filtered out of the array and pushed back at the TAIL. That makes the file's bytes depend on WHICH
// step was synced last, not on what the ledger holds — and the wired sweep drives one `gate ci` per
// merged PR/MR, so a pass over N merged reviews ROTATES the array:
//
//   [A,B,C,D,E] -sync A-> [B,C,D,E,A] -sync B-> [C,D,E,A,B] -> … -sync E-> [A,B,C,D,E]
//
// Every hop is a non-empty diff, so every hop commits and pushes, and the pass lands back where it
// started — an unbounded commit loop with zero semantic change (issue #163). Sorting the array on
// write makes the bytes a pure function of the record SET, so an unchanged re-sync is byte-identical
// and `gate ci`'s existing "nothing staged -> nothing to commit" guard finally holds.
//
// The per-record JSON.stringify tiebreak is what makes the order TOTAL. `Array#sort` is stable, so
// records tying on the tuple key would keep their (rotating) insertion order — and a manual,
// skill-written approval can tie with a bridge one on (step, approver, role, domain). The tiebreak is
// position-independent, so ties resolve by content instead.
//
// Compared by CODE UNIT (`<`), not localeCompare: the ledger is written by CI and read/re-written by
// every teammate's machine, and localeCompare's order depends on the host locale and ICU build. Two
// machines disagreeing on where one record sorts would reintroduce exactly the churn this prevents.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (list, keyOf) => [...list].sort(
  (x, y) => cmp(keyOf(x), keyOf(y)) || cmp(JSON.stringify(x), JSON.stringify(y)),
);
const field = (v) => (v == null ? '' : String(v));

export const canonicalApprovals = (approvals = []) => canonical(approvals, (a) =>
  [a.step, a.artifact, a.role, a.domain, a.approver, a.source, a.approvedAt, a.date].map(field).join('|'));

export const canonicalComments = (comments = []) => canonical(comments, (cm) =>
  [cm.step, String(cm.round ?? '').padStart(6, '0'), cm.commenter, cm.role, cm.date].map(field).join('|'));

export const canonicalHubPrs = (hubPrs = []) => canonical(hubPrs, (p) =>
  [p.artifact, p.step].map(field).join('|'));

// Replace-not-append upsert into hub-prs.json, keyed by artifact (one live review PR per artifact).
export function upsertHubPr(hubPrs = [], rec) {
  return canonicalHubPrs([...hubPrs.filter((p) => p.artifact !== rec.artifact), rec]);
}

// SHA-256 of the contract surface block (architecture only). Byte-for-byte identical to the recipe
// yad-architecture/references/contract-format.md publishes — the one the architect runs to write
// contract-lock.json:
//
//   awk '/CONTRACT-SURFACE:BEGIN/{f=1;next} /CONTRACT-SURFACE:END/{f=0} f' contract.md \
//     | tr -d '\r' | shasum -a 256
//
// Canonicalization, in the order awk applies it: every line strictly between the markers, CRLF
// normalized to LF (so a CRLF re-save never revokes approvals), joined by LF, and TERMINATED by a
// trailing LF — awk emits a newline after every line it prints, so that last newline is part of the
// hashed bytes. Omitting it made the CLI digest and the documented recipe disagree by exactly one
// byte on every surface, so contract-lock.json could never equal what approvals bind to (issue #156).
// A BEGIN without an END is malformed and yields null — never a silent hash of everything to EOF.
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
  return 'sha256:' + createHash('sha256').update(body.join('\n') + '\n').digest('hex');
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

// Every build-state/<story>.json under the epic, story-sorted. Missing dir = Build hasn't
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

// ---- the one writer of `state.json` --------------------------------------------------------------
// Every save of an epic's step state goes through here, and there is exactly one of these on purpose.
//
// On a VERIFIED project `yad migrate` never rewrites `state.json` — CI is its only writer, so the
// command reports the file as `ci-owned` and skips it (cli/migrate.mjs). That is correct, and it
// means the shape-4 dials would otherwise never reach `state.json` on precisely the projects that
// most need their records consistent: the Build state would gain `driver`/`advance` while the Shape
// state kept only the old names, forever, with no command a user could run to close it.
//
// So the gate's own write carries the migration. Same rule as everywhere else in shape 4: ADD the new
// name beside the old, translate rather than copy, and never write `advance: auto` onto a step a
// human must sign off.
//
// Routing every writer through one function is the point. E30 shipped a reviewer who could be added
// and never removed because one writer out of several was left on the old key, and the test suite was
// green. A single writer cannot be half-updated.
export function stampStepDials(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.steps)) return state;
  let moved = false;
  const steps = state.steps.map((s) => {
    if (!isPlainObject(s)) return s;
    const out = { ...s };
    // Object.hasOwn, not a bare lookup: a value like "toString" would otherwise resolve through the
    // prototype to a function, get assigned as the dial, and mark the state as changed.
    if (typeof s.assistance === 'string' && !('driver' in s) && Object.hasOwn(DRIVER_FROM_ASSISTANCE, s.assistance)) {
      out.driver = DRIVER_FROM_ASSISTANCE[s.assistance];
      moved = true;
    }
    if (typeof s.automation === 'string' && !('advance' in s) && Object.hasOwn(ADVANCE_FROM_AUTOMATION, s.automation)) {
      const isReview = s.type === 'review+approve' || s.locked === true;
      out.advance = isReview ? 'human' : ADVANCE_FROM_AUTOMATION[s.automation];
      moved = true;
    }
    return out;
  });
  // Return the SAME object when nothing changed. `writeJSON` short-circuits on identical bytes, and
  // handing back a fresh object either way would make that comparison the only thing standing between
  // a read-only gate path and a spurious write.
  return moved ? { ...state, steps } : state;
}

// Copy the work-item type into `state.json`. Shape 5.
//
// The type is AUTHORED in `epic.md` frontmatter and copied here, because `state.json` is the file CI
// writes and the gates read. Opening a hand-edited markdown file from inside a gate decision would
// make the ledger depend on something the engine does not own. `yad epic new` (E17) seeds a whole
// step chain from the type, and it needs the answer in the ledger.
//
// TWO OTHER WORDS IN THIS FILE LOOK LIKE THIS ONE AND ARE NOT IT. Neither is touched here:
//   * top-level `kind` in state.json is the lifecycle marker `"stub"` / `"discovery"`. A stub epic
//     legitimately carries `kind: "stub"` AND `type: "feature"` at once.
//   * `steps[].type` is `author` / `review+approve` — which kind of STEP, not which kind of work.
//
// Add-only, and idempotent, so a second `yad migrate` and every later gate write are no-ops:
//   * a state that already records a `type` is returned untouched, whatever it says;
//   * so is one whose epic has no `epic.md` to read a type from. That is the discovery front-zero
//     (`EP-discovery`, `kind: "discovery"`), which is not a work item on the ladder and has no
//     frontmatter to copy. Inventing `feature` for it would put a fifth thing on the ladder that
//     nobody authored.
//
// ONE of these, called from `writeState` below and from the 4 -> 5 step in cli/migrate.mjs. E28
// shipped two dial stampers and they drifted — one guarded array-valued steps, the other did not.
export function stampWorkItemType(state, epicDir) {
  // ANY `type` key already present is left alone, not just a string one. Overwriting a value
  // somebody wrote — even `null`, even a number — would be this function deciding what their file
  // meant, during an upgrade they ran to be safe. `yad doctor` is what reports a value it does not
  // understand; silently correcting one is the behaviour the whole shape-5 design refuses.
  if (!isPlainObject(state) || 'type' in state) return state;
  const md = path.join(epicDir, 'epic.md');
  if (!fs.existsSync(md)) return state;
  const type = workItemType(readFrontmatter(md));
  // Placed at the TOP of the file, not appended. `{ ...state, type }` is the one-line version and it
  // puts the key last, which on a real state.json means `"type": "feature"` dangling at the bottom
  // directly beneath a `steps` array whose every entry carries its own `"type"` — the exact two-axis
  // confusion the rest of this change exists to prevent. JSON key order IS the file's bytes, so the
  // object is rebuilt in order rather than spread and assigned.
  //
  // Idempotent either way: a state that already records a type returns above, keeping the position it
  // has, so a file seeded by a skill is never reordered by a later engine write.
  //
  // `profile` is in the anchor list, and that is what makes the canonical order `type, profile`
  // unconditional rather than a happy accident of the order `writeState` calls the two stampers in.
  // The migration chain adds `type` at 4 -> 5 and `profile` at 5 -> 6, so it always produces that
  // order. A gate write does not always have both to add at the same moment: an epic whose ledger
  // reached shape 5 before its `epic.md` existed (seeded by `yad-analysis`, migrated during the
  // upgrade, the epic authored afterwards) gets `profile` from the migration and `type` only from a
  // LATER gate write. Without this anchor that write would append `type` after `profile`, and a
  // verified project would hold a key order no local project can produce.
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if ((k === 'profile' || k === 'currentStep' || k === 'steps') && !('type' in out)) out.type = type;
    out[k] = v;
  }
  if (!('type' in out)) out.type = type;
  return out;
}

// Record which lifecycle profile the chain came from. Shape 6.
//
// A PROFILE is the route an epic takes through the lifecycle — the named, ordered chain of catalogue
// steps E5 wrote down. Until now nothing on disk said which one an epic was on, and every reader
// worked it out by matching the chain. That is a fine answer for a report and a bad one for a seed:
// `yad epic new` has to know the route BEFORE there is a chain to match, and an epic that legitimately
// dropped steps reads as a shorter route than the one it was started on.
//
// DERIVED, NEVER DEFAULTED, for an epic that already exists. The value comes from
// `matchLifecycleProfile`, which returns null for a chain that fits no route — and a null means NO
// KEY, not `classic`. Stamping a guess would put a route on the record that nobody chose, and
// `yad doctor` would then stop reporting the chain as off-route because the file would finally agree
// with itself. `yad doctor` reports the gap; an upgrade never invents an answer for it.
//
// Add-only and idempotent, exactly like `stampWorkItemType`: ANY `profile` key already present is
// left alone, whatever it says. A project may carry a route from a newer yadflow, and a hand-written
// chain is allowed to be ahead of the tool reading it (rule 3 — the file wins for this whole major).
//
// ONE of these, called from `writeState` below and from the 5 -> 6 step in cli/migrate.mjs, because
// on a VERIFIED Product `yad migrate` never rewrites `state.json` — CI is its only writer, so the
// gate's own write is the only path a shape change has into that file.
export function stampProfile(state) {
  if (!isPlainObject(state) || 'profile' in state) return state;
  const profile = matchLifecycleProfile(state.steps);
  if (!profile) return state;
  // Placed beside `type` at the TOP, for the same reason: `{ ...state, profile }` would leave
  // `"profile": "classic"` dangling under the `steps` array, where the eye reads it as a property of
  // the last step rather than of the epic. JSON key order IS the file's bytes, so the object is
  // rebuilt in order rather than spread and assigned.
  //
  // No trailing "if it still is not there, append it" guard, unlike `stampWorkItemType`. That guard is
  // reachable there because that stamper runs on states with no `steps` at all; here a profile is only
  // ever derived FROM `steps`, so reaching this loop means `steps` is present and the `k === 'steps'`
  // arm has already placed the key. A line that cannot run is a line no test can cover.
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if ((k === 'currentStep' || k === 'steps') && !('profile' in out)) out.profile = profile;
    out[k] = v;
  }
  return out;
}

// Move a `state.json`'s recorded shape up to this engine's, AFTER both stampers above have run.
//
// This is the other half of the verified-mode gap, and without it the first half is a half-truth.
// On a verified Product `yad migrate` reports `state.json` as `ci-owned` and never writes it, so the
// stampers are what carry a shape change into that file. They carried the FIELDS. They did not carry
// the NUMBER, because `writeShape` (cli/lib.mjs) preserves a stamp that is already there — the right
// rule for every other caller, and the wrong one for the one file no migration will ever reach.
//
// The effect was permanent and silent. yadflow 3.18.1 stamps `schemaVersion: 1`, so every verified
// project on disk today holds a `state.json` recording shape 1. Its fields would be brought fully up
// to date by the next gate write while the number stayed at 1 for ever, and `yad doctor` would keep
// reporting "N are CI-owned and behind" with the hint "CI owns these files and moves them on its next
// gate sync" — a warning that could never clear, attached to a sentence that was not true.
//
// WHAT MAKES THIS CORRECT is an invariant, not an assumption: for `state.json`, running the whole
// migration chain must produce exactly what these stampers produce — in the same ORDER, down to the
// bytes. Two things hold that up and both are load-bearing. The stampers are called here in the
// migration's own order (dials, type, profile), and each inserts its key in front of every key a LATER
// shape adds, so a gate write that supplies one of them long after the other still lands it in the
// canonical position. Without the second, a ledger that reached shape 5 before its `epic.md` existed
// would come out `profile, type` while every migrated project reads `type, profile`. It holds today — shapes 2 and 3
// change `hub.json` and the roster, shape 4 is the dials (`stampStepDials`), shape 5 is the work-item
// type (`stampWorkItemType`). cli/test-migrate.mjs pins it by migrating one project, gate-writing
// another, and comparing the two files byte for byte. A future shape that changes `state.json`
// without adding a stamper here fails that test loudly rather than mis-stamping a file quietly.
//
// Never DOWN. A file recording a shape newer than this engine understands is left exactly as it is:
// `yad migrate` reports that one `ahead` and refuses it for the same reason, and lowering the number
// would have this release claim it wrote something it cannot read.
const atEngineShape = (state) => (
  isPlainObject(state) && Number.isInteger(state.schemaVersion) && state.schemaVersion < SCHEMA_VERSION
    ? { ...state, schemaVersion: SCHEMA_VERSION }
    : state
);

export function writeState(file, state) {
  // `file` is <epicDir>/.sdlc/state.json, so the epic's own directory is two levels up — that is
  // where `epic.md` lives, and the stamper needs it to read the type the author wrote.
  const epicDir = path.dirname(path.dirname(file));
  // Same ORDER as the migration chain in cli/migrate.mjs — dials (4), type (5), profile (6). The two
  // paths must produce byte-identical files (cli/test-migrate.mjs pins it), and both `type` and
  // `profile` insert themselves in front of `currentStep`, so running them out of order would swap
  // two keys and make a migrated project's bytes differ from a gate-written one's.
  const stamped = stampProfile(stampWorkItemType(stampStepDials(state), epicDir));
  return writeJSON(file, atEngineShape(stamped));
}

export function loadLedger(epicDir) {
  const f = epicFiles(epicDir);
  return {
    files: f,
    state: validateState(readJSONStrict(f.state, null), f.state),
    approvals: requireArray(readJSONStrict(f.approvals, []), f.approvals),
    comments: requireArray(readJSONStrict(f.comments, []), f.comments),
    // Read the OLD name while it exists, the new one otherwise — the same tie-break as the settings
    // file (`preferring`, cli/manifest.mjs). Both are written on every
    // save (see gateSync / gateOpen), so they agree unless someone edited one by hand — which
    // `yad doctor` reports rather than leaving to be discovered.
    hubPrs: (() => {
      const f2 = preferring(f.productPrs, f.hubPrs);
      return requireArray(readJSONStrict(f2, []), f2);
    })(),
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
  // The catalogue names the author step a gate reviews (E4), so a gate that reviews NOTHING says so by
  // carrying no `reviews` — which is how `engineer-review` stays what it is, the last step of Build
  // rather than the review of a step called `engineer`. Before this it worked only by accident: the
  // strip produced `engineer`, and nothing was found because no chain has such a step.
  const def = stepDef(id);
  if (def) {
    if (!def.reviews) return null;
    return state?.steps?.find((s) => s.id === def.reviews) || null;
  }
  // An id this release does not carry — a step from a newer yadflow or a future profile. Fall back to
  // the convention every gate in the catalogue follows, so an unknown `<x>-review` still finds `<x>`.
  if (!id.endsWith('-review')) return null;
  const base = id.replace(/-review$/, '');
  // …but never against a base the catalogue knows to be something OTHER than a gated Shape step.
  // `checks-review` is not a step, and `checks` is a Build step nothing gates: resolving it would let
  // a chain that lists both make `stateInvariants` demand a repair, and `yad gate repair` would then
  // flip `checks` to done as though the merge gate had reviewed it. Same discipline as `stepPhase`.
  const baseDef = stepDef(base);
  if (baseDef && (baseDef.phase === 'build' || baseDef.kind !== 'author')) return null;
  return state?.steps?.find((s) => s.id === base) || null;
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
// `threadsResolved` come from the platform; with a local ledger they default to the "advance" intent.
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
  // Which author steps THIS epic's route marks optional — `optionalStepsFor(state)`. Empty means
  // "no step on this chain may be skipped", and that is the right default for a gate: a caller that
  // forgets to pass it fails closed, and a `skipped: true` nobody can justify falls through to the
  // real approvals instead of passing on the strength of the flag alone.
  optional = [],
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
  if (step?.skipped && isSkippableStep(step.id, optional)) {
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
// `test-cases` is a PARALLEL, non-blocking track so Build can start while the tester works:
// approving `stories-review` makes the epic `ready-for-build` (Build keys off this) AND opens
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
  // Discovery is the project front-zero ("epic zero"): it has no Build part, so its review terminates
  // at a `discovery-done` sentinel rather than `ready-for-build` (which would make `yad next` claim the
  // Build can run). The roadmap it approved is the input the real feature epics read.
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

// Which steps may be marked N/A ("skipped") is a fact about the epic's ROUTE, and the route is
// declared with the lifecycle profiles below (E35). `optionalStepsFor(state)` is the one answer; every
// function here takes it as an argument rather than reading a module-level set, so the guard is about
// THIS epic rather than about every route at once.
//
// That distinction is invisible today — both feature routes mark the same pair optional, so a union
// across the routes and this epic's own route give the identical answer — and an invisible rule is an
// untested rule. The resolvers below take the route list as a seam so a test can pass routes that
// disagree, the same reason `matchLifecycleProfile` takes one.

// True for a genuinely skippable step id — the author step (`ui-design`) OR its paired review gate
// (`ui-design-review`) — given the author steps this epic's route marks optional. Used to gate the
// `gatePredicate` skip short-circuit so a corrupted/hand-edited `skipped: true` on a step this epic's
// route requires cannot bypass its real approvals.
export function isSkippableStep(id, optional = []) {
  return [...(optional || [])].includes(String(id || '').replace(/-review$/, ''));
}

// The message every refusal to skip shares. An epic whose chain is on no route has NO optional steps —
// never a default set — because guessing a route here would let a step be skipped on the strength of a
// route nobody chose. `yad doctor` already reports that chain as `step:off-route`, and this says so
// rather than pretending the step is simply required.
const notOptional = (stepId, optional) => err(
  'YAD-STATE-004',
  `step '${stepId}' is not optional on this epic's route`,
  optional.length
    ? `only these steps may be skipped here: ${optional.join(', ')}`
    : 'this epic is on no lifecycle route this release knows — it records none, and its chain matches none — so nothing on it is optional. Run `yad doctor` and look for `step:off-route`',
);

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
export function skipStep(state, stepId, { reason, by = null, at = null, profiles = LIFECYCLE_PROFILES } = {}) {
  const optional = optionalStepsFor(state, profiles);
  if (!optional.includes(stepId)) throw notOptional(stepId, optional);
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
  // NO ROUTE GUARD HERE, and that asymmetry with `skipStep` is deliberate. Skipping needs the route's
  // permission because it makes a gate pass without approvals. Un-skipping only puts a step BACK in
  // the chain — it can never let anything through, so refusing it has no safety value and one real
  // cost: `yad doctor`'s `skip:not-optional` names exactly the epics whose skip the route does not
  // allow, and its remedy is this command. With the guard, the one command the finding recommends was
  // the one command guaranteed to throw in the state that produced the finding.
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
// `ready-for-build`: the parallel `test-cases` track must not pull currentStep back (Build
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

// ---- the step catalogue (E4) ---------------------------------------------------------------------
//
// ONE place that says what a step IS. Before this, the answer was spread across five tables in this
// file, an order array, two artifact helpers, and a hand-written `state.json` seed copied into five
// skill files — so "which phase is `stories` in", "which skill authors it", "what does it produce"
// and "what reviews it" were four separate lookups that nothing held together.
//
// Everything below this constant is DERIVED from it. `STEP_SKILL`, `BUILD_STEP_SKILL`,
// `BUILD_STEP_ORDER`, `SHAPE_STEP_PHASE` and `BUILD_STEP_PHASE` are still exported under the names
// they had, because ~20 call sites and the golden test use them — but they are now VIEWS of this
// table, not sources beside it. A test deep-equals each one against what the catalogue says, so a
// step added here and forgotten there cannot happen, and neither can the reverse.
//
// WHAT THIS TABLE IS NOT. The catalogue is the data structure the rest of Wave 2b keys off, and each
// of those is its own task: which steps an epic walks and in what order is a lifecycle profile (E5,
// below), seeding a chain from one is `yad epic new` (E17, cli/epic.mjs); per-step gate rules are E7;
// the fuller step-state model is E38. The `skill` column stays here as the shipped DEFAULT, and a
// project overrides it in `.sdlc/skills.json` (E6, below) — E51 later slides a per-profile default
// between the two, once E50 can detect which skills are installed. Three of the five
// skills that used to hand-write a seed now run `yad epic new` instead (E17b); the two that do not are
// the product front-zero (E75 absorbs it) and the threaded change-epic (E42 owns inheritance).
//
// IT IS CODE, NOT A FILE. Nothing here is written to disk, so no file shape changes and there is
// nothing to migrate. When a project's `state.json` disagrees with the catalogue, THE FILE WINS for
// this whole major (rule 3): a project may hold a step from a newer yadflow, and a hand-written chain
// is allowed to be ahead of the tool reading it. `yad doctor` reports the disagreement and changes
// nothing — the same discipline as `workItemType`.
//
// The row fields, each of which had a home somewhere before:
//   id        the step id as it appears in `state.json` `steps[]`
//   phase     which of the six phases it belongs to (was SHAPE_STEP_PHASE / BUILD_STEP_PHASE)
//   kind      'author' (produces an artifact) or 'review' (a gate on one)
//   artifact  what it produces or reviews, relative to the epic dir (was only in the skill seeds)
//   skill     the skill that runs it (was STEP_SKILL / BUILD_STEP_SKILL). Review gates in Shape are
//             driven by the `yad gate` CLI and have none; `engineer-review` is a Build step in its own
//             right — the locked human merge gate — and does have one.
//   reviews   for a review gate, the id of the author step it gates. This replaces stripping
//             `-review` off a string, which is what made `checks-review` look resolvable.
//   level     'feature' (a step on the Epic ladder) or 'product' (the front-zero, `EP-discovery`,
//             which is product-level and does not walk the feature lifecycle). E75 folds the product
//             level into Foundation; it is named here, not modelled further. This field was called
//             `chain` when E4 landed and was renamed before any release carried it — `chain` is the
//             word for an ordered LIST of steps, which is what a lifecycle profile holds (E5).
//   risk_tags the DEFAULT tags a seed gives this step. `architecture-review` carries `contract`, which
//             is what routes it through the escalated gate rule. E7 owns the rules themselves.
//
// `spec` and `tasks` are two legs of the same yad-spec ceremony (run-loop.md) and share a skill; the
// chain renderer collapses the consecutive duplicate. `ready-for-build` and the other SENTINELS are
// not steps and are not here.
export const STEPS = [
  // Discover
  { id: 'discovery', phase: 'discover', kind: 'author', artifact: 'discovery/', skill: 'yad-discovery', level: 'product', risk_tags: [] },
  { id: 'discovery-review', phase: 'discover', kind: 'review', artifact: 'discovery/', reviews: 'discovery', level: 'product', risk_tags: [] },
  { id: 'analysis', phase: 'discover', kind: 'author', artifact: 'analysis.md', skill: 'yad-analysis', level: 'feature', risk_tags: [] },
  { id: 'analysis-review', phase: 'discover', kind: 'review', artifact: 'analysis.md', reviews: 'analysis', level: 'feature', risk_tags: [] },
  { id: 'epic', phase: 'discover', kind: 'author', artifact: 'epic.md', skill: 'yad-epic', level: 'feature', risk_tags: [] },
  { id: 'epic-review', phase: 'discover', kind: 'review', artifact: 'epic.md', reviews: 'epic', level: 'feature', risk_tags: [] },
  // Design
  { id: 'architecture', phase: 'design', kind: 'author', artifact: 'architecture.md', skill: 'yad-architecture', level: 'feature', risk_tags: [] },
  { id: 'architecture-review', phase: 'design', kind: 'review', artifact: 'architecture.md', reviews: 'architecture', level: 'feature', risk_tags: ['contract'] },
  { id: 'ui-design', phase: 'design', kind: 'author', artifact: 'ui-design.md', skill: 'yad-ui', level: 'feature', risk_tags: [] },
  { id: 'ui-design-review', phase: 'design', kind: 'review', artifact: 'ui-design.md', reviews: 'ui-design', level: 'feature', risk_tags: [] },
  // Plan
  { id: 'stories', phase: 'plan', kind: 'author', artifact: 'stories/', skill: 'yad-stories', level: 'feature', risk_tags: [] },
  { id: 'stories-review', phase: 'plan', kind: 'review', artifact: 'stories/', reviews: 'stories', level: 'feature', risk_tags: [] },
  { id: 'test-cases', phase: 'plan', kind: 'author', artifact: 'test-cases.md', skill: 'yad-test-cases', level: 'feature', risk_tags: [] },
  { id: 'test-cases-review', phase: 'plan', kind: 'review', artifact: 'test-cases.md', reviews: 'test-cases', level: 'feature', risk_tags: [] },
  // Build — these run per story per code repo, recorded in build-state/, not in the epic's steps[]
  { id: 'spec', phase: 'build', kind: 'author', artifact: null, skill: 'yad-spec', level: 'feature', risk_tags: [] },
  { id: 'tasks', phase: 'build', kind: 'author', artifact: null, skill: 'yad-spec', level: 'feature', risk_tags: [] },
  { id: 'implement', phase: 'build', kind: 'author', artifact: null, skill: 'yad-implement', level: 'feature', risk_tags: [] },
  { id: 'checks', phase: 'build', kind: 'author', artifact: null, skill: 'yad-checks', level: 'feature', risk_tags: [] },
  // Not the review of a step called `engineer` — a step in its own right, and the one Build step that
  // is a gate. It carries no `reviews`, which is what keeps `checks-review` from resolving.
  { id: 'engineer-review', phase: 'build', kind: 'review', artifact: null, skill: 'yad-engineer-review', level: 'feature', risk_tags: [] },
];

// ---- lifecycle profiles (E5) ---------------------------------------------------------------------
//
// A PROFILE is a named, ordered chain of catalogue steps — the route an epic takes through the
// lifecycle. The catalogue above says what each step IS; a profile says which ones an epic walks and
// in what order. Two epics can now take different routes without the engine pretending every piece of
// work is the same size.
//
// THE WORD. The roadmap calls this a profile, so that is the word (rule: the roadmap's vocabulary
// wins). `hub.json` already carries an unrelated `profile` — the SETUP answers `{ codebase,
// repo_layout, team_size }` that `yad setup` records — so nothing here is called plain `profile` in
// code, and `next.mjs` reads the other one through `setupProfileOf`. Two different things under one
// word is a trap for whoever reads this next; two clearly different names is not.
//
// THESE ARE NOT NEW ROUTES. All three predate this table — they were seeded by hand, in five skill
// files, until `yad epic new` took over the two feature ones. `yad-analysis`'s own description already calls them "the 12-step chain" and "the 10-step
// chain". E5 writes them down in one place and checks projects against them; it does not change what
// any epic does, and nothing here is written to disk.
//
//   classic         the 10-step chain, seeded by yad-epic, yad-stub and yad-change. `epic` first.
//   analysis-first  the 12-step chain, seeded by yad-analysis, which puts `analysis` before `epic`
//                   when a feature is shaped by the analyst before it becomes an epic.
//   discovery       the product front-zero (`EP-discovery`), two steps and no Build. Product-level,
//                   not on the Epic ladder — E75 folds it into Foundation.
//
// WHAT IS AND IS NOT HERE. Seeding a chain from a profile is `seedState` below, driven by
// `yad epic new` (E17, cli/epic.mjs); shape 6 is where an epic first RECORDS which profile it is on,
// and an epic seeded before that field existed still has its route derived by matching its chain
// (`matchLifecycleProfile`). Which steps are optional per route already lives here and is read per
// EPIC (E35, `optionalStepsFor`); the short chore and spike lanes are E40. A PROJECT-wide skill
// binding already exists (E6, below); E51 adds a per-profile one between it and the catalogue
// default, so two routes can run different skills for the same step.
export const LIFECYCLE_PROFILES = [
  {
    id: 'classic',
    title: 'the 10-step chain',
    level: 'feature',
    steps: [
      'epic', 'epic-review',
      'architecture', 'architecture-review',
      { id: 'ui-design', optional: true }, { id: 'ui-design-review', optional: true },
      'stories', 'stories-review',
      'test-cases', 'test-cases-review',
    ],
  },
  {
    id: 'analysis-first',
    title: 'the 12-step chain',
    level: 'feature',
    steps: [
      'analysis', 'analysis-review',
      'epic', 'epic-review',
      'architecture', 'architecture-review',
      { id: 'ui-design', optional: true }, { id: 'ui-design-review', optional: true },
      'stories', 'stories-review',
      'test-cases', 'test-cases-review',
    ],
  },
  {
    id: 'discovery',
    title: 'the product front-zero',
    level: 'product',
    steps: ['discovery', 'discovery-review'],
  },
];

// One profile's steps as plain rows: `{ id, optional }`, in chain order.
//
// `optional` is the only per-step field a profile carries today, and it is carried because something
// READS it — `optionalStepsOf` below, which is what decides whether an epic on this route may skip a
// step (E35). The parallel `test-cases` track is deliberately NOT recorded here: `advanceState`
// decides it from the step id, and a flag nothing reads would be a second copy of a rule that lives
// somewhere else — free to drift, with every test still green. Moving that rule into the profile is
// worth doing, and it belongs to whichever task takes it, not to a field added on spec here.
const profileRows = (p) => p.steps.map((x) => (typeof x === 'string' ? { id: x } : x))
  .map((x) => ({ id: x.id, optional: !!x.optional }));

const PROFILE_BY_ID = new Map(LIFECYCLE_PROFILES.map((p) => [p.id, { ...p, rows: profileRows(p) }]));

// A profile by id, or null for one this release does not carry.
export const lifecycleProfile = (id) => PROFILE_BY_ID.get(String(id || '')) || null;

// The step ids of a profile, in chain order.
export const profileSteps = (id) => (lifecycleProfile(id)?.rows || []).map((r) => r.id);

// WHICH profile a chain is on, worked out from the chain itself — and NOT from the `profile` key
// shape 6 records. Two readers with two jobs: the recorded key says which route the epic was STARTED
// on, and this says which route its steps are on NOW. `yad doctor` compares them, so a function that
// read the key would compare it with itself; and `stampProfile` calls this to fill the key in the
// first place, for every epic that existed before shape 6. A chain that has never been recorded is
// the normal case for those, and this is the only answer available for it.
//
// A chain MATCHES a profile when every step it carries belongs to that profile and they appear in the
// profile's order. Missing steps are allowed — an epic with no screens legitimately drops `ui-design`,
// and a chain seeded before a step existed simply lacks it. Extra or out-of-order steps are not: those
// mean a different route, or a broken one.
//
// The most specific match wins. A 10-step `classic` chain is a subset of `analysis-first` in the right
// order too, so the SHORTEST fitting route breaks the tie — otherwise every classic epic would read as
// an analysis-first epic that skipped its first two steps, and shape 6 would record that wrong route
// on every one of them during an upgrade.
//
// `profiles` is a seam for the tests, and it is here because the tie-break is otherwise invisible:
// with today's three routes the shortest fit also happens to be declared first, so dropping the sort
// changes no answer and no test could tell. E40 adds the chore and spike lanes — shorter routes,
// declared last — and on that day declaration order would quietly become the rule. A test passes the
// list reversed and asserts the answer does not move.
export function matchLifecycleProfile(steps, profiles = LIFECYCLE_PROFILES) {
  if (!Array.isArray(steps)) return null;
  const ids = steps.map((s) => s?.id).filter((x) => typeof x === 'string' && x);
  if (!ids.length) return null;
  // Read the rows off the profile that was HANDED IN, never by resolving its id — a caller-supplied
  // route is not in the module's own index, so `profileSteps(p.id)` would come back empty and the
  // route would silently never fit. That is a wrong answer with no error, and the one thing a seam
  // for the tests must not quietly do differently from the real call.
  const orderOf = (p) => profileRows(p).map((r) => r.id);
  const fits = profiles.filter((p) => {
    const order = orderOf(p);
    let at = -1;
    return ids.every((id) => {
      const i = order.indexOf(id);
      if (i <= at) return false;    // not in this profile, or out of order
      at = i;
      return true;
    });
  });
  if (!fits.length) return null;
  return fits.sort((a, b) => orderOf(a).length - orderOf(b).length)[0].id;
}

// ---- which steps an epic may skip (E35) ----------------------------------------------------------
//
// A step may be marked N/A ("skipped") when the epic does not need it. Only the UI-design step is
// optional today: an epic with no user-facing surface (backend/API, data, infra) can skip it. A skip
// carries a recorded reason and stays VISIBLE in the chain — both the author step and its review gate
// pre-marked `done`, short-circuited by `gatePredicate` — the auditable, reversible counterpart to
// omitting `analysis` from the chain entirely.
//
// IT IS A FACT ABOUT THE ROUTE, NOT ABOUT THE ENGINE. Until E35 this was one module-level set, the
// union of every route's `optional` marks, and it answered the same for every epic in the project.
// That is wrong the moment two routes disagree: E40's chore lane can drop steps a `classic` epic must
// walk, and a union would have let a `classic` epic skip them too — silently, because the union never
// says which route its answer came from.
//
// The union is gone. `optionalStepsFor(state)` asks THIS epic's route and nothing else.

// The optional AUTHOR steps of ONE route, in chain order. Author steps only — `isSkippableStep` pairs
// each with its `-review` gate, which is the shape every caller expects. A route this release does not
// carry has none, which is the honest answer rather than an error: the chain is what it is.
//
// The rows are read off the route that was HANDED IN, never by resolving its id, for the reason
// `matchLifecycleProfile` spells out — a caller-supplied route is not in the module's own index, so
// resolving would come back empty and every synthetic route in a test would silently have no optional
// steps, agreeing with a broken implementation.
export const optionalStepsOf = (profileId, profiles = LIFECYCLE_PROFILES) => {
  const route = profiles.find((p) => p.id === String(profileId || ''));
  return route ? profileRows(route).filter((r) => r.optional && !r.id.endsWith('-review')).map((r) => r.id) : [];
};

// WHICH route an epic is on, for the purpose of asking what it may skip.
//
// The RECORDED key wins whenever it names a route this release carries — including when the CHAIN no
// longer fits that route. Two separate reasons, and the second is the load-bearing one:
//
//   * Guessing is worse. `matchLifecycleProfile` picks the shortest fitting route, so a `classic` epic
//     that legitimately dropped a step can read as a shorter lane; E40 adds two shorter lanes. Shape 6
//     exists precisely so the route stops being guessed. Matching is the fallback for an epic seeded
//     before the key existed, not the first answer.
//   * A chain this release cannot place is not a broken chain. Rule 3: the file wins. An epic written
//     by a NEWER yadflow carries a step this one has never heard of, so it fits no route HERE — and
//     reading that as "no route" would strip its optional steps, which means an already-skipped
//     `ui-design` stops short-circuiting and its gate starts asking for approvals nobody gave. An
//     older CLI silently downgrading a newer project is exactly what rule 3 forbids.
//
// A recorded route the chain contradicts is `profile:disagree`, and `yad doctor` reports it. Reporting
// is the remedy; refusing to answer is not.
//
// When NEITHER resolves there is NO route, never a default one. Stamping `classic` on an epic that
// records nothing and matches nothing would let a step be skipped on the strength of a route nobody
// chose, quietly — the same reason `stampProfile` declines to invent the key in the first place.
export const epicProfileId = (state, profiles = LIFECYCLE_PROFILES) => {
  const recorded = String(state?.profile || '');
  if (profiles.some((p) => p.id === recorded)) return recorded;
  return matchLifecycleProfile(state?.steps, profiles);
};

// The author steps THIS epic may skip. The one answer every skip guard asks.
export const optionalStepsFor = (state, profiles = LIFECYCLE_PROFILES) =>
  optionalStepsOf(epicProfileId(state, profiles), profiles);

// Does the route an epic RECORDS disagree with the route its chain is on?
//
// One rule, two readers, so they cannot drift apart: `yad doctor` reports it as `profile:disagree`,
// and `skip:not-optional` stays SILENT on an epic this already names. Both findings come from the same
// stale label, and the file's own discipline is that one fault is named once — two messages with two
// different remedies, one of which does not address the cause, is how people learn to stop reading
// warnings.
//
// False for an epic that records nothing (there is no label to be stale) and for one whose chain fits
// no route (`step:off-route` owns that), so it fires only where the two answers genuinely differ.
export const recordedRouteDisagrees = (state, profiles = LIFECYCLE_PROFILES) => {
  if (!isPlainObject(state) || !('profile' in state)) return false;
  const recorded = String(state.profile || '');
  if (!profiles.some((p) => p.id === recorded)) return false;
  const matched = matchLifecycleProfile(state.steps, profiles);
  return !!matched && matched !== recorded;
};

// ---- seeding a chain FROM a profile (E17) --------------------------------------------------------
//
// The routes a `yad epic new` may seed: the FEATURE-level ones. Read off the profiles, never written
// out again — a route added to `LIFECYCLE_PROFILES` is seedable the day it lands, and E40's chore and
// spike lanes need no edit here.
//
// `discovery` is excluded because it is not a work item on the Epic ladder. Its ledger carries a
// top-level `kind: "discovery"` marker the engine keys off, its id is fixed (`EP-discovery`), it has
// no `epic.md` and therefore no work-item type, and E75 folds the whole level into Foundation. A
// seed that produced its chain without those would be a broken front-zero, not a plain one — so the
// command refuses it and sends the user to `yad-discovery`, which is still its author.
export const seedableProfiles = (profiles = LIFECYCLE_PROFILES) =>
  profiles.filter((p) => p.level === 'feature').map((p) => p.id);

// The `state.json` an epic starts life with, built from a profile and the catalogue. PURE — it
// returns an object and writes nothing; `runEpicNew` (cli/epic.mjs) is what puts it on disk, through
// `writeState` like every other save.
//
// WHY THE FIRST STEP IS `in_progress` AND NOT `done`. The skill templates this replaced wrote the
// first author step `done` and its gate `in_review`, because by the time a skill seeded, it had
// already WRITTEN the artifact — the seed was a record of work finished. The engine seeds before any
// work exists, so the honest chain is: the first author step open, everything after it blocked, and
// `currentStep` on the first step. `yad next` then names that step and the skill that authors it,
// which is the whole point of seeding ahead of the author instead of behind it.
//
// FIELD ORDER IS THE FILE'S BYTES, and it is the order those deleted templates used. Every chain on
// disk in every existing project was written that way, so ordering the keys differently here would
// churn the bytes of any epic gate-written after an upgrade — on a verified Product, one CI commit per
// epic saying nothing. It is also still the order `yad-discovery` and `yad-change` write, which are
// the two seeds the engine deliberately does not own.
//
// BOTH DIAL NAMES ARE WRITTEN — `assistance`/`automation` beside `driver`/`advance`. The old pair is
// still the one every reader outside this repo uses (rule 3, add before remove), and a seed that
// wrote only the new names would produce an epic that a user's un-updated check gates cannot read.
//
// A STUB is the one variation, and it is a variation of the STATUSES, not of the chain. `yad-stub`
// mints an anchor for a feature that was built before the Product existed, so a defect can thread off
// it today: the same `classic` chain, every step `blocked`, a top-level `kind: "stub"` marker and the
// `backfill-pending` sentinel as `currentStep`. Nothing is runnable until `yad-backfill promote` wakes
// it — `preconditionsMet` refuses every step of an anchor, and `nextAction` routes it to the backfill
// skill rather than to authoring. Modelled here rather than in a second function because it differs
// from a plain seed in three fields, and two functions sharing a chain is how the five skill copies
// drifted in the first place. `yad-stub` Step 5 is one line now: run `yad epic new --stub`.
export function seedState({ epic, profile, type, today, stub = false }) {
  const p = lifecycleProfile(profile);
  if (!p || !seedableProfiles().includes(p.id)) {
    throw err('YAD-STATE-007', `cannot seed the '${profile}' lifecycle profile`,
      `pick one of ${seedableProfiles().join(' · ')}`);
  }
  const steps = p.rows.map((row, i) => {
    const def = stepDef(row.id);
    return {
      id: def.id,
      type: def.kind === 'review' ? 'review+approve' : 'author',
      artifact: def.artifact,
      assistance: 'review',
      driver: 'pair',
      automation: 'human_approve',
      advance: 'human',
      locked: true,
      status: !stub && i === 0 ? 'in_progress' : 'blocked',
      risk_tags: [...def.risk_tags],
    };
  });
  // Key order mirrors what the stampers produce, so a seeded file and a migrated one are the same
  // bytes. `schemaVersion` is deliberately absent: `writeJSON` stamps this engine's shape onto an
  // object that was never read from disk (writeShape, cli/lib.mjs), and naming the number here would
  // be a second place to forget to change.
  // `kind` sits between `type` and `profile`, which is where the `yad-stub` template has always put it
  // and where `stampProfile` would insert on a stub that lacked one. The two words look alike and are
  // different axes: `kind` is the LIFECYCLE marker (`stub`, `discovery`), `type` is the work item.
  return {
    epicId: epic,
    createdAt: today,
    type,
    ...(stub ? { kind: 'stub' } : {}),
    profile: p.id,
    currentStep: stub ? 'backfill-pending' : steps[0].id,
    steps,
  };
}

// The catalogue keyed by id. `stepDef(id)` is null for an id this release does not know — a real
// answer, not a gap, and the reason every reader below has a fallback.
const STEP_BY_ID = new Map(STEPS.map((s) => [s.id, s]));
export const stepDef = (id) => STEP_BY_ID.get(String(id || '')) || null;

// Split by the one line that matters: Build steps run per story per code repo out of `build-state/`,
// everything else runs at the epic level. Expressed as `=== 'build'` / `!== 'build'` rather than as a
// list of Shape phases, so the first `release` step (E32) lands in the epic-level table by default
// instead of falling silently out of BOTH and leaving `yad next` with no skill to name.
const catalogueSkills = (inBuild) => Object.fromEntries(
  STEPS.filter((s) => s.skill && (s.phase === 'build') === inBuild).map((s) => [s.id, s.skill]),
);

// The Shape authoring step a `yad next` action maps to — the skill the user invokes for that step.
// Review (review+approve) steps are driven by the `yad gate` CLI, not a skill, so they are not here.
// A VIEW of the catalogue; `cli/test-threads.mjs` deep-equals it against one.
//
// This is the engine's DEFAULT, not the final answer: a project can bind a different skill to a step
// in `.sdlc/skills.json` (E6, below). Every caller that asks "which skill runs this step" goes through
// `stepSkills`, which consults the project first and falls back to here.
export const STEP_SKILL = catalogueSkills(false);

// The skill that runs each Build (build) step — the build-state analogue of STEP_SKILL. `spec`
// and `tasks` are the two legs of the SAME yad-spec ceremony (run-loop.md), so both map to yad-spec;
// the chain renderer collapses the consecutive duplicate. `engineer-review` is the human merge gate.
// Like STEP_SKILL, this is the DEFAULT a project overrides in `.sdlc/skills.json` — read it through
// `stepSkills`, not directly, or the binding is silently ignored.
export const BUILD_STEP_SKILL = catalogueSkills(true);

// The fixed Build order. Used to derive the "remaining chain" from the active step onward even if a
// repo's `steps` array is partial or out of order. The catalogue's own order IS this order.
const BUILD_STEP_ORDER = STEPS.filter((s) => s.phase === 'build').map((s) => s.id);

// ---- skill binding (E6) --------------------------------------------------------------------------
//
// WHICH skill runs a step is a project's choice, not the engine's. The catalogue above still ships a
// default for every step — that is what `STEP_SKILL` / `BUILD_STEP_SKILL` hold, and a project that
// binds nothing behaves exactly as it did before. What changes here is that the default is no longer
// the only possible answer: `.sdlc/skills.json` can name a different skill for a step, or several.
//
// WHY THIS IS A FILE AND THE CATALOGUE IS NOT. The catalogue says what a step IS — its phase, its
// artifact, what reviews it — and those are facts about the lifecycle this engine implements, so they
// stay in code where they cannot drift. WHO does the work is a different kind of fact: it depends on
// which skills a team has installed and which harness they run. E3 deletes the BMAD personas from the
// engine, and E11 supports harnesses other than Claude Code; neither is possible while the only
// answer to "who authors the architecture" is a string compiled into this file.
//
// THE FILE WINS, AND THE DOCTOR ONLY REPORTS. Same discipline as `workItemType` and the lifecycle
// profile: a project may bind a skill this engine has never heard of — that is the whole point, since
// the engine cannot know what a team installed. So nothing here validates a skill NAME. `yad doctor`
// reports a binding on a step id the catalogue does not know, and changes nothing. Detecting which
// skills are actually installed is E50; per-profile defaults are E51.
//
// SEVERAL SKILLS PER STEP IS A CHAIN, NEVER A PANEL (closed decision 7). They run in the order given,
// each one seeing what the one before it produced, and the LAST output is the artifact. A panel — run
// three, pick one — needs a picking step, which is either a human reading three architectures or an AI
// judge nobody should trust inside a governance tool. One skill is the default; more is opt-in, and
// every surface that prints a chain of more than one says it costs more.
//
// The file, all of it optional:
//
//   {
//     "schemaVersion": 6,
//     "steps": {
//       "architecture": "my-architecture-skill",
//       "stories": ["shape-the-stories", "yad-stories"]
//     }
//   }
//
// A value may be one skill or a list of them; both are read back as a list, so nothing downstream has
// to handle two shapes. The wrapper object exists so that E50 and E51 can add keys beside `steps`
// without the file changing shape.

// The catalogue's own answer for a step, Shape or Build. One lookup, because a step id belongs to
// exactly one of the two tables (`catalogueSkills` splits them on the same `phase === 'build'` rule),
// and a caller asking "which skill runs `implement`" should not have to know which half it is in.
// `__proto__: null` because this is looked up by a step id read out of a project's `state.json`, and
// on a normal object literal `Object.prototype` answers for `constructor`, `toString` and friends. A
// chain carrying a step called `constructor` would otherwise resolve its "skill" to a function.
const CATALOGUE_SKILL = { __proto__: null, ...STEP_SKILL, ...BUILD_STEP_SKILL };

// Read a raw parsed `.sdlc/skills.json` into `{ steps: { <id>: [skill, …] } }`.
//
// Junk is DROPPED here rather than rejected, and that is deliberate: this runs inside `yad next`,
// which must keep working on a project whose config file someone mistyped. An empty string, an empty
// list, a number, a nested object — each simply leaves that step on its catalogue default, and
// `yad doctor` is what tells the user their line did nothing. A command that refuses to say what to do
// next because a config file has a stray comma would be the worse failure.
// Written with `defineProperty`, not `out[id] = …`. A plain assignment of the key `__proto__` sets
// the object's PROTOTYPE instead of adding a key, so a binding spelled that way would vanish
// completely — unlisted by `yad skill list` and unreported by all three doctor checks, which is
// exactly the invisible binding those checks exist to catch. The object keeps its normal prototype;
// `stepSkills` guards the LOOKUP side with `Object.hasOwn` instead.
//
// Consecutive duplicates are collapsed, because running the same skill twice in a row means nothing
// and the two surfaces would disagree about it: the rendered Build chain folds them (that is what
// `dedupeConsecutive` has always done for spec+tasks) while the cost note counted them, so a step
// bound to `["a", "a"]` would be billed for two runs and shown as one.
export function normalizeBindings(raw) {
  const out = {};
  const steps = isPlainObject(raw) ? raw.steps : null;
  if (isPlainObject(steps)) {
    for (const [id, value] of Object.entries(steps)) {
      const list = dedupeConsecutive((Array.isArray(value) ? value : [value])
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => s.trim()));
      if (list.length) Object.defineProperty(out, id, { value: list, enumerable: true, writable: true, configurable: true });
    }
  }
  return { steps: out };
}

// The project's bindings, or the empty set when the file is absent or unreadable.
export const loadSkillBindings = (root) =>
  normalizeBindings(readJSON(path.join(root, PROJECT_FILES.skillsConfig), null));

// Which skills run a step, in order. The project's binding when it has one, else the catalogue's
// single default, else nothing at all — a Shape review gate is driven by `yad gate`, not by a skill,
// and an unbound one honestly has none.
//
// `bindings` is a PARAMETER, not a read from disk, so a test can hand this function a binding that
// disagrees with the catalogue. A resolver that opened the file itself would be untestable against
// any project but the one the test happens to be standing in.
export function stepSkills(stepId, bindings = null) {
  // `Object.hasOwn`, not a bare lookup. The id comes out of a project's `state.json`, and on a plain
  // object `Object.prototype` answers for `constructor`, `toString` and friends — so a chain carrying
  // a step called `constructor` resolved its "skill" to a function, and `yad next` threw trying to
  // spread it. The catalogue map below is `__proto__: null` for the same reason.
  const steps = bindings?.steps;
  const bound = isPlainObject(steps) && Object.hasOwn(steps, stepId) ? steps[stepId] : null;
  if (Array.isArray(bound) && bound.length) return [...bound];
  const fallback = CATALOGUE_SKILL[stepId];
  return typeof fallback === 'string' ? [fallback] : [];
}

// The two keys every action object carries for its skill, from one resolved list.
//
// `skill` STAYS A STRING and is the first of the chain, because ~20 call sites and `yad next --json`
// read it that way and rule 3 keeps an old name working for a whole major. `skills` is added only
// when the chain is longer than one — NOT always-present-null like `parallel` beside it. That is a
// deliberate departure from the neighbouring field: `cli/test-golden.mjs` deep-equals this output
// against a frozen v3 project, and rule 6 says a frozen project's answers never change, so a key that
// appeared on every action would break it. A project that binds nothing gets byte-identical output.
export const skillFields = (ids) => ({
  skill: ids[0] ?? null,
  ...(ids.length > 1 ? { skills: ids } : {}),
});

// ---- the six phases ------------------------------------------------------------------------------
//
// Between the three PARTS (Shape · Build · Run) and the individual steps sits one more rung: the
// phase. Six of them, in order, each belonging to exactly one part:
//
//   Discover   Shape   discovery · analysis · epic, each with its gate
//   Design     Shape   architecture (with the locked contract) · ui-design, each with its gate
//   Plan       Shape   stories · test-cases, each with its gate
//   Build      Build   spec · tasks · implement · checks · engineer-review
//   Release    Run     PLANNED — release notes · version · deploy record · gate
//   Operate    Run     PLANNED — defects · feedback · retrospective · improvements
//
// Release and Operate are NAMED and not built. No step, skill or gate exists for either, and none is
// invented: `built: false` is the whole of what is known about them. (`skills/sdlc/config.yaml`
// carries the same table for the skills to read, and a test holds the two together row for row.) They are listed
// rather than left out because a person has to be able to see that the lifecycle does not stop at
// merge — and a renderer that shows them as planned tells the truth, while one that hides them
// implies the work ends at Build.
//
// DERIVED, NOT STORED. A step's phase is a pure function of its id — it comes off the step catalogue
// (E4, above), so nothing is written into `state.json` and there is no file-shape change. Storing it
// would put a second copy of the catalogue on disk, and the two copies would then need a doctor check
// to catch a drift that cannot happen while there is only one answer.
//
// "PHASE" IS A CROWDED WORD IN THIS REPOSITORY, and none of the other three mean this one:
//   * `cli/gate.mjs` says "merge phase" for a stage INSIDE a single gate run;
//   * the `build-state` notes say "Phase 4a/4b", from the old build-plan numbering;
//   * `docs/phase-N-build-plan.md` are the development phases of yadflow itself.
// So the phase NUMBER is deliberately never printed: "Phase 4" already means something else to anyone
// who has read those. The name is what is shown.
export const PHASES = [
  { id: 'discover', name: 'Discover', part: 'Shape', built: true },
  { id: 'design', name: 'Design', part: 'Shape', built: true },
  { id: 'plan', name: 'Plan', part: 'Shape', built: true },
  { id: 'build', name: 'Build', part: 'Build', built: true },
  { id: 'release', name: 'Release', part: 'Run', built: false },
  { id: 'operate', name: 'Operate', part: 'Run', built: false },
];

// Which phase each step belongs to. Split in two on purpose, because the `-review` rule differs.
//
// SHAPE steps each have a review gate named `<id>-review`, and that gate belongs to the phase of the
// artifact it reviews — `epic-review` is Discover beside `epic`. BUILD steps have no such gates:
// `engineer-review` is a step in its own right, the locked human merge gate, not the review of a step
// called `engineer`. So the suffix is only ever stripped against the Shape table, which is what keeps
// `checks-review` — a step that does not exist — from quietly resolving into Build.
//
// Every id in STEP_SKILL and BUILD_STEP_SKILL above appears in one of these two, and a test asserts
// membership directly rather than through `stepPhase`, so a step added to one table and forgotten
// here fails rather than resolving by accident.
//
// The roadmap also names a `feasibility` step in Discover. Nothing implements it — no skill, no step
// id, no gate — so it is deliberately absent from the catalogue rather than declared and dead. A new
// step is added by adding a row to `STEPS`; RENAMING one means adding the new row beside the old and
// keeping both for a major (rule 3), because a project still carrying the old id would otherwise trip
// `phase:unknown` on every `yad doctor` run until it is migrated.
//
// Both tables are now VIEWS of the catalogue (E4). A row is listed under its phase unless it is a
// review gate that gates ANOTHER step — that is, unless it carries `reviews`. That one rule is what
// keeps `epic-review` out (it is the gate on `epic`, which is already listed) while keeping
// `engineer-review` in (it gates nothing; it is the last step of Build in its own right), and it is
// the same distinction the `-review` strip below depends on.
const phaseTable = (rows) => Object.fromEntries(rows.filter((r) => !r.reviews).map((r) => [r.id, r.phase]));
const SHAPE_STEP_PHASE = phaseTable(STEPS.filter((r) => r.phase !== 'build'));
const BUILD_STEP_PHASE = phaseTable(STEPS.filter((r) => r.phase === 'build'));
const STEP_PHASE = { ...SHAPE_STEP_PHASE, ...BUILD_STEP_PHASE };

// `currentStep` markers that are NOT steps: they never appear in `steps[]`, and no phase claims them.
// `ready-for-build` is the one with a phase anyway — see `currentPhase` below, which is where an epic's
// position is decided rather than a step's.
export const SENTINELS = ['ready-for-build', 'backfill-pending', 'backfill-done', 'discovery-done'];

// The phase a STEP id belongs to, or null for anything this engine does not recognise — a sentinel, a
// step from a future profile, a typo. Null, never a guess: a renderer showing the wrong phase is worse
// than one showing none.
//
// THE CATALOGUE IS ASKED FIRST, and that is load-bearing rather than an optimisation. Strip `-review`
// first and `engineer-review` resolves to `engineer`, which nothing claims, so the last step of Build
// falls out of every phase. The strip below is reached only by an id the catalogue does not carry.
export function stepPhase(id) {
  const s = String(id || '');
  // The catalogue answers for every id this release knows, review gates included — no string surgery.
  const def = stepDef(s);
  if (def) return def.phase;
  // Only reached by an id the catalogue does not carry: a step from a newer yadflow or a future
  // profile. `<known-shape-step>-review` still resolves, so a project ahead of this release keeps its
  // gates placed. Stripped against the SHAPE table only, which is what stops `checks-review` — a step
  // that does not exist — from quietly resolving into Build.
  const base = s.replace(/-review$/, '');
  return Object.hasOwn(SHAPE_STEP_PHASE, base) ? SHAPE_STEP_PHASE[base] : null;
}

// The phase an EPIC is in. Different question from `stepPhase`, and this is the one every renderer
// asks — so there is one of it, shared by `yad next` and `yad thread`.
//
// TWO THINGS A STEP LOOKUP ALONE GETS WRONG:
//
//   * `ready-for-build` is a marker, not a step, so `stepPhase` gives it nothing — and it is the
//     `currentStep` for the WHOLE of Build. `nextAction` never reports a concrete build step id at the
//     epic level either; the real ones (`spec`, `implement`, …) live per story per repo in
//     `build-state`. So a step lookup alone can never place an epic in Build at all, which is the
//     phase with the most steps in it. The marker means "Shape is approved, Build can run" — that is
//     Build, and it is resolved here rather than in `stepPhase`, which stays a pure id lookup.
//   * `EP-discovery` is the PRODUCT-level front-zero, not a work item on the feature ladder. Its whole
//     chain is `discovery` → `discovery-review` → `discovery-done`; it never enters Design, Plan or
//     Build. Printing the six-phase lifecycle for it claims a journey it does not take. E75 folds it
//     into Foundation, which is a Product-level phase of its own; until then it has none.
//
// A stub epic (`backfill-pending` / `backfill-done`) has no phase either, and needs no special case:
// neither marker is a step.
export function currentPhase(currentStep, { discovery = false } = {}) {
  if (discovery) return null;
  const cur = String(currentStep || '');
  if (cur === 'ready-for-build') return 'build';
  return stepPhase(cur);
}

// The phase record for an epic's current step, or null. `.name` is the word a person reads.
export const phaseOf = (currentStep, opts) => PHASES.find((p) => p.id === currentPhase(currentStep, opts)) || null;

// Every step id this engine knows in a phase, in chain order. Empty for a phase nothing implements
// yet, which is exactly what `built: false` says.
export const phaseSteps = (phaseId) => Object.keys(STEP_PHASE).filter((s) => STEP_PHASE[s] === phaseId);

// Collapse consecutive identical skills (spec+tasks → one yad-spec) so the rendered chain reads
// yad-spec → yad-implement → yad-checks → yad-engineer-review, matching the Build mental model.
// Folds against the last KEPT element (not the raw neighbor) so a dropped null between duplicates can't
// reintroduce one.
//
// Exported because `yad next` has to fold the SAME way to know how much of `chain` belongs to the
// active step. A second copy of this rule there would agree until the first step bound to the same
// skill twice, which folds to one entry in the chain and two in the step's own list.
export function dedupeConsecutive(skills) {
  const out = [];
  for (const s of skills) if (s && s !== out[out.length - 1]) out.push(s);
  return out;
}

// PURE: given ONE repo's build-state ({ currentStep, steps }), resolve the next build sub-step and the
// remaining chain. The active step is `currentStep`'s entry, or the first step not yet `done`. Returns
// `shipped: true` only when there ARE steps and every one is `done`; an empty/missing steps array is
// `unknown` (not-started), NEVER shipped — otherwise a half-seeded file would render a false "shipped ✓".
export function buildNextForRepo(repoState = {}, { bindings = null } = {}) {
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
  const chain = dedupeConsecutive(tail.flatMap((id) => stepSkills(id, bindings)));
  return {
    step: active.id,
    status: active.status || 'blocked',
    // Read either spelling (old wins), then say it the OLD way. `cli/test-golden.mjs` deep-equals
    // this output against a frozen v3 snapshot, and rule 6 says a frozen project's answers never
    // change — so even ADDING a key here would break it. The output follows the field in the major
    // that removes `automation`; until then a step carrying only `advance` still reports correctly.
    automation: AUTOMATION_FROM_ADVANCE[stepAdvance(active)] || 'human_approve',
    locked: !!active.locked,
    ...skillFields(stepSkills(active.id, bindings)),
    shipped: false,
    chain,
  };
}

// PURE: map every parsed build-state object → its per-repo next sub-steps. `buildStates` is the array
// `loadLedger` reads from build-state/*.json. Repos are sorted for a stable, machine-independent order.
export function buildNextActions(buildStates = [], { bindings = null } = {}) {
  return buildStates.map((bs) => ({
    story: bs.story || null,
    repos: Object.keys(bs.repos || {}).sort()
      .map((repo) => ({ repo, ...buildNextForRepo(bs.repos[repo], { bindings }) })),
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
  // A stub anchor (backfill-pending) or a light-promoted anchor (backfill-done) has NO runnable Shape
  // step: its Shape chain is intentionally left `blocked`. It evolves via `yad-backfill promote` / a
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
//   'author'      — invoke a Shape authoring skill (whatever `stepSkills` resolves for the step)
//   'review-open' — open the review PR/MR (`yad gate open`)
//   'review-sync' — a review PR/MR is open; sync its state (`yad gate sync`)
//   'build'       — Shape approved (ready-for-build); Build can run
export function nextAction(ledger, { epic, bindings = null } = {}) {
  const state = ledger?.state;
  const epicId = epic || state?.epicId || null;
  // No ledger yet: the action is to author the `epic` step, so it names whatever runs that step here.
  if (!state) return { epicId, kind: 'new', ...skillFields(stepSkills('epic', bindings)), why: 'no epic state yet — seed it with yad-epic' };

  // EP-discovery ("epic zero") is the project front-zero: a 2-step author→review chain with no Build
  // part and no parallel track. Resolve its action in isolation so the feature-epic logic below never
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
        ...skillFields(stepSkills(dstep.id, bindings)), artifact: dstep.artifact,
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
    // No Build until backfilled + promoted — route to yad-backfill (not to authoring the epic),
    // and remind that bugs can thread off it now with yad-change.
    return { epicId, kind: 'backfill-pending', step: 'backfill-pending', status: 'stub',
      why: 'stub epic (backfill pending) — document the code with yad-backfill then `yad-backfill promote` to make it real; thread bugs now with yad-change' };
  }
  if (anchorKind === 'documented') {
    // `yad-backfill promote` documented the feature (verified) but did NOT wake the Shape chain (its docs
    // live in the backfill spec). Terminal like `discovery-done` — Build never runs directly; the
    // feature evolves by threading a change/defect off it.
    return { epicId, kind: 'backfill-done', step: 'backfill-done', status: 'documented',
      why: 'backfilled anchor (documented) — Build never runs directly; evolve it by threading a change/defect with yad-change' };
  }

  // The parallel test-cases track stays workable even once the epic is ready-for-build.
  const tc = state.steps.find((s) => s.id === 'test-cases');
  const tcOpen = !!tc && tc.status !== 'done' && tc.status !== 'blocked';
  const parallel = tcOpen
    ? { step: 'test-cases', ...skillFields(stepSkills('test-cases', bindings)), artifact: tc.artifact }
    : null;

  if (state.currentStep === 'ready-for-build') {
    // Once stories enter Build, surface each story/repo's CONCRETE next sub-step (spec →
    // implement → checks → engineer-review) from build-state, not one static "run Build" hint.
    const builds = buildNextActions(ledger?.buildStates || [], { bindings });
    const lanes = builds.flatMap((b) => b.repos);
    const open = lanes.filter((r) => !r.shipped);
    if (builds.length) {
      let why;
      if (!lanes.length) why = 'Build started — no repo lanes recorded yet';
      else if (!open.length) why = 'Build — every story/repo lane is shipped';
      else why = `Build in progress — ${open.length} story/repo lane(s) still moving`;
      return { epicId, kind: 'build', step: 'ready-for-build', status: 'ready-for-build', parallel, builds, why };
    }
    return { epicId, kind: 'build', step: 'ready-for-build', status: 'ready-for-build', parallel,
      why: 'Shape approved — Build can run' };
  }

  const step = state.steps.find((s) => s.id === state.currentStep)
    || state.steps.find((s) => s.status !== 'done');
  if (!step) {
    const builds = buildNextActions(ledger?.buildStates || [], { bindings });
    return { epicId, kind: 'build', step: 'ready-for-build', parallel,
      builds: builds.length ? builds : undefined, why: 'all Shape steps are done' };
  }

  if (step.type === 'author') {
    return { epicId, kind: 'author', step: step.id, status: step.status, parallel,
      ...skillFields(stepSkills(step.id, bindings)), artifact: step.artifact,
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

// ---- the work-item type ------------------------------------------------------------------------
// The ladder is Product -> Epic -> Story -> Task, and every work item on it also declares a TYPE.
// The type is what stops everything being called an epic:
//
//   feature   new value
//   change    a change to something already shipped
//   defect    something is broken
//   hotfix    broken and urgent
//   chore     upkeep, no user-visible change
//
// The word for this used to be `kind`, and in `epic.md` frontmatter `kind:` is STILL the one that
// counts. Shape 5 adds `type:` beside it and teaches every writer to write both; `kind:` stays
// authoritative for this whole major, and is removed in the one after. The reason is the same as for
// every other rename in this codebase: `epic.md` is hand-authored by people and by ~29 skills, and
// `lineage-check.sh` reads `kind:` from inside the USER's repository, refreshed by `yad update` —
// a separate act from `yad migrate` with no ordering between them. Make the new name win now and a
// change-epic in a repo that migrated but did not update reads as a parent-free genesis, and the
// lineage gate stops asking it for a parent.
export const WORK_ITEM_TYPES = ['feature', 'change', 'defect', 'hotfix', 'chore'];

// Resolve the type from `epic.md` frontmatter. OLD name first (see above), then the new one, then
// `feature` — an epic authored before types existed is the root of its own thread, which is what a
// genesis is. An unrecognised value is returned AS WRITTEN rather than corrected to `feature`:
// silently reading someone's typo as a genesis would drop the lineage gate. `yad doctor` reports it.
export function workItemType(fm = {}) {
  if (typeof fm.kind === 'string' && fm.kind) return fm.kind;
  if (typeof fm.type === 'string' && fm.type) return fm.type;
  return 'feature';
}

// Which types may stand alone with no `parent:` — the root of a thread.
//
// `feature` is the original genesis. `chore` joins it because upkeep frequently has no feature to
// hang off: a dependency bump, a CI move, a lockfile refresh. Requiring a parent there would push
// people to invent one, and an invented parent is worse than none — the thread rollups, the defect
// report and the timeline all walk `parent:` and would attribute the upkeep to a feature it has
// nothing to do with. Everything else (`change`, `defect`, `hotfix`) describes work ON something
// that already exists, so it must name what.
//
// `templates/checks/lineage-check.sh` re-implements this in bash, because the check gates are
// standalone by design and run inside the user's repo with no Node. `cli/test-checks.mjs` runs a
// table of types through both and asserts they agree — two readers is two ways to drift.
export const isGenesisType = (t) => t === 'feature' || t === 'chore';

// The human-facing noun for a work-item type. Presentation only — the artifact is always an epic
// (`EP-<slug>`); this just renders WHAT KIND of work it is so `yad next`/`yad thread`/`yad status`
// read as "Defect EP-…" / "Change request EP-…" instead of a generic "Epic". `feature` (and any
// unknown/absent type) falls back to "Epic". A bug is a defect (`defect`) — no separate noun.
export const TYPE_NOUN = {
  feature: 'Epic', change: 'Change request', defect: 'Defect', hotfix: 'Hotfix', chore: 'Chore',
};
export const typeNoun = (t) => TYPE_NOUN[t] || 'Epic';

// ---- the grouping theme (E31) --------------------------------------------------------------------
// A `theme:` on an epic is a FREE grouping tag: any word or short phrase the team picks, shared by
// however many epics belong together. It is what this engine has instead of an Initiative rung above
// the Epic — the ladder stays Product -> Epic -> Story -> Task, and grouping is a label rather than a
// level. Nothing enforces a vocabulary and nothing has to be registered first; an epic with no theme
// is perfectly normal, which is why the answer is `null` rather than a default.
//
// It lives ONLY in `epic.md`. No copy in `state.json`, so no file shape changes and no migration:
// every reader that wants the theme already has the epic's frontmatter open. `yad next --json` does
// not carry it either — that answer is deep-equalled by the golden test (rule 6) and an ADDED key
// breaks it as hard as a renamed one. `yad thread --json` is where a script reads it.
//
// One string, always. `readFrontmatter` turns `theme: [a, b]` into an array and keeps whatever else
// someone typed, so the normalization is done HERE, once, and every caller shares it — a tag that is
// a string in one reader and an array in the next groups nothing.
export function themeOf(fm = {}) {
  return typeof fm?.theme === 'string' && fm.theme.trim() ? fm.theme.trim() : null;
}

// Two themes that only differ in case, spacing or punctuation are the same idea typed twice, and they
// split the group in silence. Folding to this key is how `yad doctor` finds them; it is NEVER stored
// or displayed — the tag people wrote is the tag they see.
//
// Letters and digits in ANY script survive the fold (`\p{L}\p{N}`, not `a-z0-9`). A team writing its
// themes in Arabic, Cyrillic or Chinese groups exactly as well as one writing them in English, and an
// ASCII-only fold would flatten every one of their themes to the empty string — making them look
// identical to each other and to a tag of pure punctuation. An empty fold therefore means one thing
// only: there is nothing here to compare.
export const themeKey = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// The lineage of an epic from epic.md frontmatter. `type` defaults to `feature` (genesis) when
// absent, so an un-migrated genesis epic behaves as the thread root. Greenfield/missing-safe.
export function epicLineage(root, epic) {
  const fm = readFrontmatter(path.join(epicRoot(root, epic), 'epic.md'));
  const type = workItemType(fm);
  return {
    type,
    // The older name for the same value, kept for one major — the same choice `yad thread --json`
    // makes. An out-of-tree caller reading `.kind` would otherwise get `undefined`, which reads as a
    // NON-genesis type: their parent-free feature epic starts being asked for a parent it has not got.
    kind: type,
    parent: fm.parent || null,
    thread: fm.thread || null,
    inherits: asList(fm.inherits),
    supersedes: asList(fm.supersedes),
    // The free grouping tag (E31). Null when unset, which is most epics.
    theme: themeOf(fm),
  };
}

// Is this a STUB genesis epic (minted by yad-stub as a brownfield thread anchor)? A stub is type feature
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
    broken = `missing thread cache on ${epicId} (type:${tip.type}, parent:${tip.parent}) — should be '${rootId}'`;
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
