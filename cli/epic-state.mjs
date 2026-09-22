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

// ---- the per-step gate rule (E7) -----------------------------------------------------------------
//
// HOW MANY HUMAN APPROVALS a step asks for, as a NUMBER derived from the step's own recorded data.
// `needed = base + risk step` — the roadmap's tier-1 rule (docs/roadmap-idea-1.md, Part 3). There is
// no name and no role anywhere in it, which is the whole point: a rule that names a person, a role or
// a step goes stale the moment the team changes, and "repository access is the roster" replaces it.
//
// WHAT HOLDS THE GATE. Part 3's rule is ONE formula: `needed = base + risk_step`, CAPPED at
// `active − 1`, floor 1 in team mode. `active` is the live count of people (E71, cli/people.mjs), read
// once per command by the caller. E72 computes the cap (`gateCapFor` below), prints it wherever a gate
// reports itself and records it on the closing record — but ONLY THE BASE HOLDS THE GATE, still.
//
// WHY THE CAP IS SHOWN AND NOT ENFORCED (the user's decision, 2026-09-21, after review). The count of
// people errs HIGH on purpose (E71), and in the NORMAL case, not an edge: a commit is keyed by its git
// NAME unless its address is a platform `noreply` one, an approval by its platform LOGIN, and E71 never
// joins the two without exact evidence. So a two-person team whose members commit with work addresses
// and approve on GitHub reads as FOUR, the cap lowers nothing, and an enforced contract gate would ask
// for three approvals from one person who is not the author — E7's deadlock, back. Rule 7 needs a way
// out before any count holds a gate, and that is `yad gate lower --reason`. E73 was to turn the capped
// count on together with it; the user then kept E73 to DETECTION (2026-09-22, `gateReach` below), and
// enforcement plus the escape hatch moved to E108, which waits for the count to be accurate. Until then
// `short` is measured against the capped ask and printed, and never enforced.
//
// WHEN THE COUNT IS UNKNOWN (`active: null`) no cap is computed at all: an unknown is never a small
// number (E71). Product CI is usually that case — it checks out only the hub, so connected repos are
// not on disk — and the surfaces say so.
//
// Until E62 the base was not what held a gate either: a ROLE rule read from the roster did (1 owner,
// 1 reviewer, a domain owner per touched repo). E62 removed the roster, and the base took its place.
//
// THE RISK STEP comes from the step's risk tags — `contract` +2, `auth` / `payments` +1 (the "high"
// tier), nothing +0. Two inferences the roadmap leaves open, recorded here so the next reader does not
// have to guess: `auth` and `payments` ARE the high tier (they are the other two escalators, and the
// roadmap gives the contract surface its own larger step), and a step carrying several tags takes the
// MAXIMUM step, never the sum — a gate is one decision about the riskiest thing it touches, and summing
// would let three tags ask for five approvals that no small team can produce.
//
// THE TAGS ARE READ FROM THE EPIC, not from the catalogue: `seedState` copies `risk_tags` into
// `state.json`, and a team may add `auth` to a step by hand. Change-safety rule 3 — the file wins — so
// the rule asks the step in front of it, exactly as `optionalStepsFor` asks the epic's recorded route.
//
// THE BASE IS 1: one human who is not the author. That is what Part 3 says the gate actually needs
// ("did a human approve; was it someone other than the author; were there enough of them"), and the
// platform already enforces the "not the author" half — on GitHub you cannot approve your own PR. The
// roadmap never fixes the number; E62 enforced it as the floor, and the cap (E72) never goes below it.
const GATE_BASE = 1;
// Tag -> { step, tier }. The TIER NAME comes from the winning tag rather than from the number, so a
// future change to a tag's step cannot make an `auth`-only gate print "contract risk".
const RISK_TIERS = {
  contract: { step: 2, tier: 'contract' },
  auth: { step: 1, tier: 'high' },
  payments: { step: 1, tier: 'high' },
};

// The gate rule for ONE step: how many distinct human approvals it asks for, and the arithmetic that
// says why. Pure, data-only, and safe on a step from a newer yadflow — an unknown tag adds nothing, and
// a hand-edited `risk_tags: "contract"` (a string where the shape says array) is read as no tags rather
// than crashing the gate that was about to report on it.
export function gateRuleFor(step) {
  const tags = Array.isArray(step?.risk_tags) ? step.risk_tags : [];
  let riskStep = 0;
  let risk = 'normal';
  for (const t of tags) {
    const hit = RISK_TIERS[t];
    if (hit && hit.step > riskStep) { riskStep = hit.step; risk = hit.tier; }
  }
  return { base: GATE_BASE, riskStep, needed: GATE_BASE + riskStep, risk };
}

// THE CAP (E72): the number of approvals a gate asks for once the live count of people is known.
//
//     to = min(needed, max(1, active − 1))        — never below the base, which is 1
//
// `active` is the capacity count from `activePeople` (cli/people.mjs). Anything that is not a whole
// number — `null` when a source could not be read, or a caller that has no count — gives NO cap (`null`):
// the cap is never applied from an unknown, so the risk step stays advisory and only the base holds.
//
// THE `− 1` IS ONE SEAT, NOT A CHECK. It leaves room for the author, who wrote the review branch in the
// Product and so is always among the people counted. The engine does not know who the author is and does
// not check whose approval it is counting: that is the PLATFORM's rule (E62 decision h — GitHub never
// allows self-approval; GitLab only when its settings say so; a local ledger checks nothing).
//
// The floor of 1 means the cap can only ever trim the RISK STEP. The base is 1, so `to` is at least the
// base. Until E108 the cap is REPORTED: the base alone holds every team gate (see `gateRuleFor`).
//
// Shape: { active, limit, to, capped } — `limit` is `max(1, active − 1)`, `to` the number asked for,
// `capped` true only when the cap LOWERED the count (rule 6: every cap is said, and recorded on the
// step's closing record by the caller that closes it).
export function gateCapFor(rule, active) {
  if (!Number.isInteger(active) || active < 0) return null;
  const limit = capLimit(active);
  const to = Math.max(rule.base, Math.min(rule.needed, limit));
  return { active, limit, to, capped: to < rule.needed };
}

// The cap's arithmetic and its wording, ONE copy each. Every surface that prints a cap reads these, so
// E108 — which changes what those surfaces say — has one place to change, not five.
//   capLimit   the most approvals a count of `active` people can give: one seat is left for the author,
//              and never below 1 (a known count of 0 or 1 people still asks for the base).
//   peopleWord `person` or `people`.
//   capSeat    why the limit is what it is: `one seat is left for the author` from 2 people up; at 0 or
//              1 people the floor decides, and the phrase says `never below 1` instead of subtracting.
//   capWho     the reason a capped line gives, e.g. `2 active people, less one seat for the author`.
export const capLimit = (active) => Math.max(1, active - 1);
export const peopleWord = (n) => (n === 1 ? 'person' : 'people');
const capByFloor = (active) => active - 1 < 1;
export const capSeat = (active) => (capByFloor(active) ? 'never below 1' : 'one seat is left for the author');
export const capWho = (active) => (capByFloor(active)
  ? `${active} active ${peopleWord(active)} (never below 1)`
  : `${active} active ${peopleWord(active)}, less one seat for the author`);

// UNMEETABLE-GATE DETECTION (E73): lines saying why a team gate may not pass. REPORTED, and never
// enforced — nothing here holds a gate, changes `passed`, `missing` or `short`, or writes a file.
// Enforcing the risk step, and `yad gate lower --reason` as its way out, is a later row (E108), which
// waits for the count of people to be accurate. These lines are the evidence that row needs.
//
// TWO KINDS OF LINE, because two different things can be said, and mixing them made lines untrue:
//   `may not be met: …`                    TODAY's rule — the base, one approval — may have nobody to
//                                          give it.
//   `if the risk step were enforced: …`    a WHAT-IF — what enforcing more than the base would do. Today
//                                          the gate still passes on the base, and the line says so.
//
// Every claim is about the PEOPLE COUNTED, and is hedged ("may", "if"), because the count is wrong both
// ways, and neither is an edge:
//   too LOW   a reviewer who has not committed or approved inside the counting window is not counted —
//             the second person on a brand-new Product reads as absent until their first approval;
//   too HIGH  a commit is keyed by its git name and an approval by its platform login, and E71 never joins
//             the two without exact evidence, so a two-person team can read as four (E72, case a).
//
// WHAT AN APPROVAL SHOWS. `have` is the approvals on THIS step and `approvers` the people counted with an
// approval in the counting window. Any such approval shows that approvals can be given here, so the two
// TODAY lines speak only when there is none in the window. For the what-if lines an approval is also a
// lower bound on the team: the approvers on this step plus the author (`have + 1`), and at least two
// people once anyone approved anything. That assumes the platform keeps authors from approving their own
// work: always on GitHub, on GitLab only when its settings say so, never on a local ledger (E62 decision
// h). Where it is wrong the bound is too high, so a what-if line may stay quiet — never a false alarm.
//
// The checks, each only while its own ask is unmet:
//   base        0 or 1 active person counted, and no approval in the window.
//   one person  exactly two people counted, one NOT MATCHED to a login (a git name, or an approval record
//               that proves no login — an older hand-written one, or an engineer-review record, which
//               carries none) and one login, and no approval in the window: they may be one person. (A solo
//               developer who commits with a work address AND through GitHub's web editor, whose noreply
//               address carries the login, reads as two people; only this check sees it.)
//   full        (what-if) the cap lowered the ask: the full count is more than the people counted can
//               give. Not said when a today line is, nor when the approvals show more people than counted.
//   names       (what-if) some people are not matched to a login and at least one is a login, and the
//               smallest possible team cannot give the ask. That team is the larger of the logins and the
//               names (each name may be one of the logins, and distinct names are taken as distinct
//               people, as the count takes them), and never fewer than the approvals prove. Taking only the
//               logins made a four-person team with one web-editor commit read as "as small as 1".
// "No approval" always names the capacity window (`days`): the reader never sees an older approval.
// A Product whose records are all names (no platform) gets no name line — there is no login for a name
// to be the same person as. Two spellings of one NAME still count twice; that is E108's, with the join.
//
// An unknown count (`cap: null`) or an unknown `nameOnly` says nothing: an unknown is never a number.
// Pure. The caller decides where it applies — never in solo mode, never on a step that passed or was
// waived — and prints each distinct line once per command (`uniqueReach`).
export const REACH_TODAY = 'may not be met';
export const REACH_IF_ENFORCED = 'if the risk step were enforced';
const WAY_OUT = "Another person's approval settles it, or use the recorded way out, `yad mode solo --reason`";
const whole = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
export function gateReach(rule, cap, { have = 0, nameOnly = null, approvers = 0, days = null } = {}) {
  if (!cap) return [];
  const lines = [];
  const got = whole(have);
  const approved = got > 0 || whole(approvers) > 0;
  // The fewest people the approvals prove: this step's approvers plus the author, and two once anyone
  // approved anything (the approver, and the author of what they approved).
  const floor = Math.max(got > 0 ? got + 1 : 0, approved ? 2 : 0);
  const names = Number.isInteger(nameOnly) && nameOnly > 0 && nameOnly < cap.active;
  const logins = names ? cap.active - nameOnly : null;
  const today = (t) => lines.push(`${REACH_TODAY}: ${t}`);
  const ifEnforced = (t) => lines.push(`${REACH_IF_ENFORCED}: ${t}. Nothing beyond the one enforced approval is needed today`);
  // The count only sees the capacity window, so every claim about "no approval" names it: an approval
  // older than the window is on record, and "no approval yet" would be untrue.
  const window = whole(days) ? `in the last ${days} days` : 'in the counting window';
  let base = false;
  if (!approved && cap.active <= 1) {
    base = true;
    today(`only ${cap.active} active ${peopleWord(cap.active)} counted and no approval ${window}, so if nobody but the author can approve, this gate cannot pass. Someone who has not committed or approved ${window} is not counted. ${WAY_OUT}`);
  }
  // Only the two-row shape (one name, one login): the solo developer who commits two ways. With more
  // names beside one login — a new team where one person once used the web editor — "the team may be
  // one person" is possible but not a fair reading, and it would alarm every first week.
  if (!approved && names && cap.active === 2) {
    base = true;
    today(`1 of the 2 people counted is not matched to a platform login and may be the same person as the one login, and there is no approval ${window}, so the team may be one person. Then, if nobody but the author can approve, this gate cannot pass. ${WAY_OUT}`);
  }
  // `floor <= cap.active` also covers "the full count is already met" and "only one person counted":
  // either way the approvals prove more people than were counted, and the line would contradict them.
  if (!base && cap.capped && floor <= cap.active) {
    ifEnforced(`with no cap, the full count of ${rule.needed} is more than ${cap.active} active people can give (${capSeat(cap.active)}), so if nobody else joins, this gate could not pass`);
  }
  if (names && !base) {
    const smallest = Math.max(logins, nameOnly, floor);
    const room = capLimit(smallest);
    if (room < cap.to) {
      const why = floor > Math.max(logins, nameOnly) ? ` (the approvals already recorded show at least ${smallest} people)` : '';
      // At most as many names as there are logins can be a login's second row, so say how many.
      const overlap = Math.min(nameOnly, logins);
      const logWord = logins === 1 ? 'the one login' : 'the logins';
      const same = nameOnly === 1
        ? `and may be the same person as ${logins === 1 ? 'the one login' : 'one of the logins'}`
        : `and ${overlap === 1 ? 'one of them' : `up to ${overlap} of them`} may be the same ${overlap === 1 ? 'person' : 'people'} as ${logWord}`;
      ifEnforced(`${nameOnly} of the ${cap.active} people counted ${nameOnly === 1 ? 'is' : 'are'} not matched to a platform login, ${same}, so the team may be as small as ${smallest}${why}. That leaves room for ${room} of the ${cap.to} approvals asked, so if the team is that small, this gate could not pass`);
    }
  }
  return lines;
}

// Each line once. A reason about the whole Product (the base, one person) is true of every open step
// at once; printed under each, it buries the step lines around it. `seen` is kept by the caller for one
// command, so a line prints under the first step (or PR) it applies to and nowhere after.
export const uniqueReach = (lines, seen) => lines.filter((l) => !seen.has(l) && seen.add(l));

// The rule as one human-readable sum — `3 approvers = base 1 + contract risk 2`. Defined here, beside
// the rule, because several surfaces print it (`gate sync`, `gate status`, the generated review-PR body
// and `yad open-pr`) and several copies of the arithmetic would eventually disagree.
export const gateRuleSum = (rule) => {
  const people = `${rule.needed} approver${rule.needed === 1 ? '' : 's'}`;
  return rule.riskStep ? `${people} = base ${rule.base} + ${rule.risk} risk ${rule.riskStep}` : `${people} = base ${rule.base}`;
};

// Which part of that sum holds the gate, said wherever the sum is printed. Empty when the step carries
// no risk step: then the base IS the whole count, and the cap can never lower it. Otherwise the base
// holds and the risk step is advisory (until E108 — see `gateRuleFor`), and a cap that lowered the ask
// is named first, so the shortfall printed after it reads against the capped number.
export const gateRuleEnforced = (rule, cap = null) => {
  if (!rule.riskStep) return '';
  const capped = cap?.capped ? ` — capped to ${cap.to}: ${capWho(cap.active)}` : '';
  return `${capped} — base enforced, risk step advisory`;
};

// The name -> login pairs of a roster an older release left on disk (E62). Read for ONE job: recognising
// the person an older approval or comment record names, so the first sync after the upgrade continues
// that record instead of guessing. The roster decides nothing else and nothing writes it; `yad doctor`
// still names it as unused. The user chose this over matching by order (2026-09-16), which swapped two
// people's fingerprints on GitLab. A name the roster gives to two logins cannot be told apart and is
// left out.
//
// It sat in cli/gate.mjs until E71, which needs it in the active-people reader that gate.mjs prints —
// a cycle. It is pure and data-only, so it belongs here beside `gateRuleFor`; gate.mjs re-exports it.
export function legacyLogins(hub) {
  const out = new Map();
  const clash = new Set();
  for (const e of Array.isArray(hub?.roster) ? hub.roster : []) {
    if (!e || typeof e.name !== 'string' || !e.name || typeof e.login !== 'string' || !e.login) continue;
    if (out.has(e.name) && out.get(e.name) !== e.login) clash.add(e.name);
    out.set(e.name, e.login);
  }
  for (const n of clash) out.delete(n);
  return out;
}

// The platform LOGIN an approval or comment record names, or null when the record only ever knew a
// roster name. Shared by `yad usage` (the report) and the active-people reader (E71), because the two
// must place the same record on the same person: if they disagreed, one of them would split a person
// into two rows or — worse for a count that must never shrink — fold two people into one.
//
// Four cases, in the order they are decided:
//   * `source: 'bridge'`    -> the record was written from the PLATFORM's own answer. `mapApprovers`
//     builds it as `name: r.login` (cli/platform.mjs), so the name IS a platform login — exact
//     evidence, recorded by the writer, not a guess about what the string looks like. E62 decision 4
//     is about a record's `by`, which falls back to git `user.name` when there is no platform; this
//     marker is what tells the two apart, and it is why "a post-E62 record names a login" is true of
//     bridge records and NOT true in general.
//   * `rosterName` present  -> a gate write already recorded the login from the roster (E64), so the
//     name the record carries IS the login.
//   * an OLDER record (it carries the `role` or `domain` the roster gave it, and is not `unverified`)
//     -> translate through the roster's name -> login table, which is exact or absent (`legacyLogins`).
//     An `unverified` record already named a login, and translating it through a roster name it
//     collided with passed a gate on an outsider's old approval once (E62) — hence the exclusion.
//   * anything else -> no login is proven. The caller falls back to the name as written.
export function ledgerPersonLogin(rec, rawName, aliases = new Map()) {
  if (rec && rec.source === 'bridge') return rawName || null;
  if (rec && rec.rosterName !== undefined) return rawName || null;
  const older = !!rec && (rec.role !== undefined || rec.domain !== undefined) && !rec.unverified;
  return older && aliases.has(rawName) ? aliases.get(rawName) : null;
}

// Epic ids are EP-<slug> with [a-z0-9-] only — anything else (uppercase, dots, slashes) is
// rejected before it can become a path segment under epics/.
export const isValidEpicId = (epic) => /^EP-[a-z0-9-]+$/.test(epic || '');

// ---- the Product level: Foundation (E75) --------------------------------------------------------
//
// A product has ONE product-level ledger. Its id is `EP-foundation` and it lives in a folder of its
// own at the top of the project, `foundation/` — not under `epics/`, because it is not an epic: it
// runs once per product, has no `epic.md`, no work-item type and no Build.
//
// THE ID KEEPS THE `EP-` PREFIX ON PURPOSE. Everything that routes a review already matches it: the
// review branch is `review/EP-foundation/foundation` (`parseReviewBranch`), and both gate-sync
// workflows committed in users' repos fire on `review/EP-*`. A prefix-less id would have made every
// Foundation review silently fail to sync on every project wired before this release.
//
// THE FOLDER IS THE ONE THING THAT DIFFERS, and it is answered in exactly one place: `epicRoot` below.
// Every command that takes an epic id resolves its directory through it, so `yad gate open
// EP-foundation foundation/` works with no special case at the call site.
export const FOUNDATION_EPIC = 'EP-foundation';
export const FOUNDATION_DIR = 'foundation';

// The project-relative POSIX path of an epic's directory — for git pathspecs and printed paths, where
// `epicRoot`'s absolute path is the wrong thing.
export const epicRel = (epic) => (epic === FOUNDATION_EPIC ? FOUNDATION_DIR : `epics/${epic}`);
export const epicRoot = (root, epic) => (epic === FOUNDATION_EPIC ? path.join(root, FOUNDATION_DIR) : path.join(root, 'epics', epic));

// Every epic id that has a directory: the valid ids under `epics/`, plus `EP-foundation` once
// `foundation/.sdlc/` exists. Sorted. The ONE enumerator a walker should use, so a sweep cannot see the
// feature epics and miss the product level.
//
// Keyed on `foundation/.sdlc/`, not on `foundation/`: a product repo may well hold an unrelated folder
// of that name (design tokens, a docs section), and reporting it as an unseeded ledger would be a false
// finding about somebody else's files. An `epics/EP-foundation/` directory is NOT listed — that id's
// directory is `foundation/`, so listing it would read the real Foundation twice under one id;
// `yad doctor` reports the stray directory instead.
export function epicIds(root) {
  const dir = path.join(root, 'epics');
  const ids = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isValidEpicId(e.name) && e.name !== FOUNDATION_EPIC)
      .map((e) => e.name)
    : [];
  if (fs.existsSync(path.join(root, FOUNDATION_DIR, '.sdlc'))) ids.push(FOUNDATION_EPIC);
  return ids.sort();
}

// The wired checks that protect `foundation/`, and the line each one needs to know the folder. They are
// committed in the user's repo and refreshed by `yad update` — not by `yad migrate` — so a copy older
// than E75 guards `epics/` only. One list for every place that asks, so `yad doctor`, `yad foundation
// new` and the CI conversion can never disagree about whether a Foundation would land unguarded.
const FOUNDATION_GUARD_ARMS = {
  'checks/ledger-guard.sh': `      ${FOUNDATION_DIR}/*)`,
  'checks/pr-title.sh': `^(epics|${FOUNDATION_DIR})/`,
  'checks/pr-template.sh': `^(epics|${FOUNDATION_DIR})/`,
};

// The wired checks that are present but predate the Foundation. A check that is not wired at all is not
// listed: that is `yad check`'s finding, and a Product with no checks has nothing to refresh.
export function staleFoundationGuards(root) {
  return Object.keys(FOUNDATION_GUARD_ARMS).filter((rel) => {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) return false;
    try { return !fs.readFileSync(file, 'utf8').includes(FOUNDATION_GUARD_ARMS[rel]); } catch { return false; }
  });
}

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
  if (base === 'foundation') return 'foundation/';
  return `${base}.md`;
}

// The files (relative to the epic dir) a review of this artifact covers — what `gate open` commits
// on the review branch (the owner's artifact), and what CI re-reads to bind the approval at merge.
// Architecture mirrors artifactHash(): the approval is bound to the locked contract surface too.
export function artifactPaths(base) {
  if (base === 'architecture') return ['architecture.md', 'contract.md', '.sdlc/contract-lock.json'];
  if (base === 'stories') return ['stories'];
  if (base === 'discovery') return [...DISCOVERY_FILES];
  // Every section, optional ones included: this names what a Foundation review COVERS, and a section
  // that is absent today is still one a reviewer may be asked to look at tomorrow.
  if (base === 'foundation') return [...FOUNDATION_FILES];
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

// ---- what an approval's fingerprint covers (shape 9) ---------------------------------------------
//
// An approval is bound to a fingerprint of what the reviewers read. The frontmatter `status:` line is
// NOT part of that. It is lifecycle bookkeeping that the engine and the skills rewrite ON PURPOSE after
// the review: the gate's own merge run flips `draft` to `approved` (`syncStatuses`,
// cli/artifact-status.mjs) straight after it records the approvals, and Build flips a story to
// `in-build` / `shipped` (the yad-engineer-review skill). Hashing the whole file made every one of
// those writes revoke the approvals it was reporting on — `yad gate status` printed "stale (revoked)",
// `yad doctor` warned, and the sweep said the rule no longer held, on every epic, right after a clean
// merge. The contract surface already hashed only what was reviewed; this does the same for the rest.
//
// The block is found with the regex `setFrontmatterStatus` uses, shared from here, so the line the
// fingerprint leaves out is the line that writer changes. The line itself is matched up to its newline
// — never across it — so an empty `status:` cannot swallow the key below it.
export const FRONTMATTER_BLOCK = /^---\n([\s\S]*?)\n---/;
const STATUS_LINE = /^status:[^\n]*(?:\n|$)/m;

// The file's text with its frontmatter `status:` line rewritten by `edit`, or null when there is no such
// line (then the bytes are used as they are, so a file without one keeps its old fingerprint exactly).
function withStatusLine(text, edit) {
  const fm = text.match(FRONTMATTER_BLOCK);
  if (!fm || !STATUS_LINE.test(fm[1])) return null;
  return `---\n${fm[1].replace(STATUS_LINE, edit)}${text.slice(4 + fm[1].length)}`;
}

const shaOf = (data) => 'sha256:' + createHash('sha256').update(data).digest('hex');

// The fingerprint of one file as reviewed: its bytes without the frontmatter `status:` line.
export function reviewedSha(p) {
  if (!fs.existsSync(p)) return null;
  const bytes = fs.readFileSync(p);
  const stripped = withStatusLine(bytes.toString('utf8'), '');
  return shaOf(stripped === null ? bytes : stripped);
}

// The fingerprints releases before shape 9 recorded, for reading only (rule 2 — read old, write new).
// They hashed the whole file, so an approval recorded then matches one of these:
//   - the file's bytes as they are, when nothing has flipped since; or
//   - the bytes with `status:` set back to what it said when the approval was recorded. That is exact,
//     not a guess: the gate flips only FROM `draft` or `in-review` (the ladder in artifact-status.mjs),
//     a re-opened review is approved over `approved` — or, for stories, over Build's `in-build` /
//     `shipped` — and one run flips a whole set to one value. The line is rebuilt the way
//     `setFrontmatterStatus` writes it (`status: <value>`), keeping the original line ending, `\r` included.
// Without the second kind, an approval that is already reported stale today would stay stale for ever,
// and this fix would help only reviews merged after it. A set whose files had DIFFERENT statuses when it
// was approved is not rebuilt (every combination is too many), and docs/migrations/shape-9.md says so.
const LEGACY_STATUSES = ['draft', 'in-review', 'approved', 'in-build', 'shipped'];
const LEGACY_FORMS = [
  fileSha,
  ...LEGACY_STATUSES.map((value) => (p) => {
    if (!fs.existsSync(p)) return null;
    const bytes = fs.readFileSync(p);
    const text = withStatusLine(bytes.toString('utf8'), (line) => `status: ${value}${line.match(/\r?\n?$/)[0]}`);
    return shaOf(text === null ? bytes : text);
  }),
];

// Deterministic fingerprint of the whole stories/ set: hash each story file, sort, combine. Lets an
// edit to any story revoke prior stories-review approvals.
// `sha` is how one file is fingerprinted — `reviewedSha` for the record, a legacy form for reading.
export function storiesHash(epicDir, sha = reviewedSha) {
  const dir = path.join(epicDir, 'stories');
  if (!fs.existsSync(dir)) return null;
  const parts = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => `${f}:${sha(path.join(dir, f))}`);
  if (!parts.length) return null;
  return 'sha256:' + createHash('sha256').update(parts.join('\n')).digest('hex');
}

// The reserved id of the Product level in its OLD spelling ("epic zero", `epics/EP-discovery/`), written
// by every release before E75 and still read. yad-epic / yad-analysis must never pick this slug — or
// `EP-foundation` — for a feature.
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

// The Foundation's sections, one Markdown file each, in the order the roadmap lists them (Part 1,
// "Foundation"). Two are optional there — Market and Risks — and optional here: a Foundation without
// them is complete and reviewable.
//
// Written as rows rather than two parallel lists so a section cannot be added to one and forgotten in
// the other. The files sit directly in `foundation/`, beside its `.sdlc/` ledger, exactly as the
// discovery set sat directly in `epics/EP-discovery/`.
export const FOUNDATION_SECTIONS = [
  { file: 'purpose.md' },
  { file: 'market.md', optional: true },
  { file: 'scope.md' },
  { file: 'mvp.md' },
  { file: 'roadmap.md' },
  { file: 'stack.md' },
  { file: 'repos.md' },
  { file: 'risks.md', optional: true },
];
export const FOUNDATION_FILES = FOUNDATION_SECTIONS.map((s) => s.file);
export const FOUNDATION_REQUIRED = FOUNDATION_SECTIONS.filter((s) => !s.optional).map((s) => s.file);

// The Foundation's fingerprint. Null until every REQUIRED section exists — the same "not reviewable
// yet" answer `discoveryHash` gives for an incomplete set. An OPTIONAL section counts once it exists,
// so adding `risks.md` after an approval, or deleting it, revokes that approval like any other edit:
// the reviewers approved the Foundation as it stood, and a new risk section is part of what they did
// not see.
export function foundationHash(dir, sections = FOUNDATION_SECTIONS, sha = reviewedSha) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (!sections.filter((s) => !s.optional).every((s) => has(s.file))) return null;
  const parts = sections.map((s) => s.file).filter(has).map((f) => `${f}:${sha(path.join(dir, f))}`);
  return 'sha256:' + createHash('sha256').update(parts.join('\n')).digest('hex');
}

// Is a Foundation section still only its template (E76)? `foundationHash` asks whether the files EXIST,
// so six files holding nothing but their headings are a complete, reviewable Foundation — and an
// approval on it approves nothing. This is the other half: does a section say anything yet?
//
// What does NOT count as writing is exactly what the templates in
// `skills/yad-discovery/references/foundation-schema.md` are made of, and a test reads those templates
// to keep the two in step: the frontmatter, headings, HTML comments, blank lines, and an empty table —
// its header row, its `|---|` rule and rows whose cells are all empty). Anything else is a person's words.
//
// "Headings" means `#` and `##` only — the level the templates use. A `### TypeScript and React` under
// `## Languages and frameworks` is an answer, not a template line.
//
// A table rule and a header row must each carry a `|`. Without that, a bare `---` divider matched the
// rule, and the line above it — a real sentence, or a filled table row — was read as a header, so real
// content came out unwritten (the E76 review). A divider on its own is ignored, and marks nothing else.
//
// A heuristic, and it errs one way on purpose: a single real sentence makes a section written. It is
// only ever used to WARN (`yad gate open`, `yad gate sync`, `yad doctor`), never to refuse, so a false
// "written" costs a missing reminder and a false "unwritten" would cost a wrong one.
const TABLE_RULE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;
const isTableRule = (l) => l.includes('|') && TABLE_RULE.test(l);
const DIVIDER = /^(-{3,}|\*{3,}|_{3,})$/;
export function isUnwrittenSection(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(FRONTMATTER_BLOCK, '')
    .replace(/<!--[\s\S]*?-->/g, '').split('\n').map((l) => l.trim());
  return lines.every((l, i) => !l
    || /^#{1,2}(\s|$)/.test(l)
    || DIVIDER.test(l)
    || isTableRule(l)
    || (l.includes('|') && isTableRule(lines[i + 1] ?? ''))       // a table's header row
    || (l.startsWith('|') && l.split('|').every((cell) => !cell.trim())));
}

// The sections that exist and are still only their template, in section order. Optional ones are
// asked too: once `risks.md` exists it is part of what reviewers approve, empty or not. A section that
// does not exist is not listed — missing is `foundationHash`'s answer, and the gate names it separately.
export function unwrittenSections(dir, sections = FOUNDATION_SECTIONS) {
  return sections.map((s) => s.file).filter((f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p) && isUnwrittenSection(fs.readFileSync(p, 'utf8'));
  });
}

// ---- the roadmap's features, and how far each has got (E76 follow-up) ---------------------------
// `roadmap.md` lists the product's features with a proposed epic id each. It used to carry a `Status`
// column people bumped by hand (`planned` → `epic-started` → `shipped`). That table is part of what the
// Foundation's reviewers approved, so the hand edit changed the Foundation's fingerprint and made its
// approvals read as stale. The user's decision (recorded in the E76 row): stop the edit, and READ the
// status from the epic ledgers instead. Nothing here writes `roadmap.md`.
//
// The table reader. A feature table is any Markdown table whose header row has a `Proposed epic id`
// cell — in any column, because the old `discovery` spelling put `Requirements` between the id and the
// status. The heading above a table is its phase. Rows run until the first line with no `|`. Comments
// are never read, so the template's example row (kept in a comment) is never read as a feature.
// Cells split on UNESCAPED pipes only: `\|` inside a cell is a literal pipe, as GitHub renders it.
const tableCells = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  .split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(```|~~~)/;
export function roadmapFeatures(text) {
  // A line that held ONLY a comment is dropped whole, not left blank: the template keeps its example
  // row in a comment directly under the `|---|` rule, and a blank line there would end the table before
  // the rows a person adds beneath it.
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(FRONTMATTER_BLOCK, '')
    .replace(/<!--[\s\S]*?-->/g, '\u0000').split('\n')
    .filter((l) => !(l.includes('\u0000') && !l.split('\u0000').join('').trim()))
    .map((l) => l.split('\u0000').join('').trim());
  const out = [];
  let phase = null;
  let fence = null;   // the marker of an open code fence — a table shown as an example is not a feature
  for (let i = 0; i < lines.length; i++) {
    const mark = lines[i].match(FENCE);
    if (fence) { if (mark && mark[1] === fence) fence = null; continue; }
    if (mark) { fence = mark[1]; continue; }
    const heading = lines[i].match(HEADING);
    // The PHASE is the nearest `#` or `##` heading — the level the template's phases use. A `###` under a
    // phase (`### Must have`) groups rows inside it; it does not start a new one.
    if (heading) { if (heading[1].length <= 2) phase = heading[2].trim(); continue; }
    if (!lines[i].includes('|') || !isTableRule(lines[i + 1] ?? '')) continue;
    const head = tableCells(lines[i]).map((cell) => cell.toLowerCase().replace(/\s+/g, ' '));
    const idCol = head.findIndex((cell) => cell.includes('proposed epic id'));
    if (idCol === -1) continue;
    const statusCol = head.indexOf('status');
    const named = head.indexOf('feature');
    const featureCol = named !== -1 ? named : head.findIndex((_, n) => n !== idCol && n !== statusCol);
    let r = i + 2;
    // A heading or a fence ends a table, even one with a `|` in it (`## Phase 2 | later`), as GitHub ends it.
    for (; r < lines.length && lines[r].includes('|') && !HEADING.test(lines[r]) && !FENCE.test(lines[r]); r++) {
      const cells = tableCells(lines[r]);
      if (cells.every((cell) => !cell)) continue;
      out.push({
        phase,
        feature: cells[featureCol] || '',
        // `EP-x`, **EP-x** and EP-x are the same id.
        epicId: (cells[idCol] || '').replace(/[`*]/g, '').trim(),
        written: statusCol === -1 ? null : (cells[statusCol] || null),
      });
    }
    i = r - 1;   // the line that ended the table may be the next heading
  }
  return out;
}

// How far a feature has got, read from its epic's ledger — the words the artifact-status ladder already
// uses for Build (`in-build`, `shipped`), plus `planned` and `in-shape` for before it:
//   planned    no ledger — nobody has seeded the epic yet
//   in-shape   seeded, and still walking Shape (epic, architecture, UI, stories)
//   in-build   Shape is done; Build has not shipped every story in every repo yet
//   shipped    every Build lane of every story is shipped — or a brownfield anchor (`yad-stub`), which
//              exists precisely because the feature shipped before the Product did
// It reuses `nextAction`, the same reader `yad next` prints, so the two can never disagree about an epic.
export const FEATURE_STATUSES = ['planned', 'in-shape', 'in-build', 'shipped'];
export function featureStatus(ledger, { stories = [] } = {}) {
  if (!ledger?.state) return 'planned';
  const a = nextAction(ledger);
  if (a.kind === 'build') return buildShipped(a.builds || [], stories) ? 'shipped' : 'in-build';
  if (a.kind === 'backfill-pending' || a.kind === 'backfill-done') return 'shipped';
  return 'in-shape';
}

// Shipped means EVERY lane the epic owes, not every lane that happens to exist. A story's build-state
// file appears only once that story starts Build (the `yad-run` skill creates it), so the lanes on disk
// can all be shipped while two stories have not begun — the E76 follow-up review found exactly that.
// So, when the epic's stories are known: each one needs a build-state, and each repo it declares needs a
// lane in it. `buildNextForRepo` already refuses a false "shipped" for an empty lane; this is the same
// refusal one level up. With no stories to compare against, the lanes on disk are all there is to read.
function buildShipped(builds, stories) {
  const lanes = builds.flatMap((b) => b.repos);
  // A SKIPPED lane (E39) is owed nothing, so it counts as finished — but a feature where every lane was
  // skipped shipped nothing, so at least one lane must really have shipped.
  if (!lanes.some((lane) => lane.shipped) || !lanes.every((lane) => lane.shipped || lane.status === 'skipped')) return false;
  return stories.every((story) => {
    const b = builds.find((x) => x.story === story.id);
    return !!b && story.repos.every((repo) => b.repos.some((lane) => lane.repo === repo));
  });
}

// The stories an epic expects Build to ship, from its `stories/` folder: each file's frontmatter `id`
// (its file name without `.md` when that is missing — the name `yad-stories` gives it) and its `repos`.
export function epicStories(epicDir) {
  const dir = path.join(epicDir, 'stories');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const fm = readFrontmatter(path.join(dir, f));
    return { id: fm.id || f.replace(/\.md$/, ''), repos: declaredRepos(fm) };
  });
}

// The repos a story's frontmatter declares — `repos: [api, web]` or `repos: api`. ONE parse, shared by
// every reader that asks which lanes a story owes: `epicStories` (so `featureStatus`), the lane skip
// below, and `yad checkpoint --retro-ship`. Two parses of one list is how a trimmed name and an untrimmed
// one come to disagree about whether a repo is declared.
export const declaredRepos = (fm = {}) => {
  const v = fm?.repos;
  // Duplicates folded: `[web, web]` declares one lane, and counting it twice would make a skip of it read
  // as "the last lane left" (E39 review).
  return [...new Set((Array.isArray(v) ? v : v ? [v] : []).map((r) => String(r).trim()).filter(Boolean))];
};

// ---- skipping a whole Build lane (E39) ----------------------------------------------------------
// E39 is "skip at three levels: profile · epic · story/repo". Two of the three already existed: the
// PROFILE level is E35 (a route marks a step `optional`, in this engine's code — the user's decision was
// not to add a project file for it, which belongs with E51/E54), and the EPIC level is `yad skip` /
// `yad defer` (E36/E37). This is the third: one story in one repo — a LANE — needs no change.
//
// A LANE, NEVER A STEP. The user's decision: no single Build step may be skipped. `spec`, `tasks`,
// `implement` and `checks` are the work and its safety checks, and `engineer-review` is the Build gate
// (rule 2). What is legitimately "does not apply" is a whole lane — a story declared `repos: [api, web]`
// and `web` turned out to need nothing. `yad doctor` reports a single Build step set aside by hand.
//
// WHERE IT IS WRITTEN. `build-state/<story>.json`, as `repos.<repo> = { status: 'skipped', record }`.
//   * Not the story's `repos:` frontmatter — that list is under the stories-review fingerprint
//     (`storiesHash`), so editing it after approval makes the approvals read as stale (the trap #242
//     closed for the roadmap column). Before the review passes, editing the list IS the right answer,
//     so the skip is refused then and says so.
//   * Not `state.json` — on a verified Product CI is its only writer, and an epic at `ready-for-build`
//     has no review PR left to carry the write.
//   * `build-state/` is machine state `yad checkpoint --push` commits on the default branch, and the
//     `yad-run` skill updates it in place, so a skip written here survives its next run. The skill is
//     told never to drive a skipped lane.
// A shape-10 yadflow reads such an entry as a lane with no steps — "not started yet" — which drives
// nothing, so no file shape moves.
//
// PURE: returns the new build-state; the caller reads and writes the file. Refusals throw YAD-STATE-004.
const laneIsSkipped = (lane) => isPlainObject(lane) && lane.status === 'skipped';

// Has work STARTED in a lane? Any step carrying a status that is not `todo` — a halt (`blocked` with a
// record) and a status word this release does not know both count, because E36 pinned "an unknown word
// counts as started (fail closed)" and `stepStatus` answers `null` for one. A step with NO status at all
// is a seeded step nobody has begun, which is how `buildNextForRepo` has always read it.
//
// ONE predicate for the three readers that ask: `skipLane` (refuse to skip over work),
// `buildNextForRepo` (a `skipped` word over real work is not honoured — the claim is not walked past on
// its own, E38's rule), and `yad doctor`'s `lane:…:contradiction`.
export const laneStarted = (lane) => isPlainObject(lane) && Array.isArray(lane.steps)
  && lane.steps.some((st) => isPlainObject(st) && st.status != null && stepStatus(st) !== 'todo');
export function skipLane(buildState, { story, repo, reason, by = null, date = null, declared = [], shippedRepos = [], storiesPassed = false } = {}) {
  const bs = isPlainObject(buildState) ? buildState : { story, repos: {} };
  const repos = isPlainObject(bs.repos) ? bs.repos : {};
  const lane = repos[repo];
  if (!storiesPassed) {
    throw err('YAD-STATE-004', `the stories review has not passed, so ${story} is not approved yet — there is no lane to skip`,
      `if ${story} does not need ${repo}, remove it from the story's \`repos:\` instead: nothing is approved yet, so that edit revokes nothing`);
  }
  if (!declared.includes(repo)) {
    throw err('YAD-STATE-004', `${story} does not declare ${repo}, so it owes no lane there`,
      declared.length ? `its repos: ${declared.join(', ')} (names are case-sensitive)` : 'the story declares no repos at all');
  }
  // A file this cannot read as a lane map is refused, never overwritten: replacing it would destroy content
  // the skills wrote (E39 review).
  if (buildState != null && !isPlainObject(buildState)) {
    throw err('YAD-STATE-004', `build-state/${story}.json is not a JSON object`, 'fix the file by hand — nothing here overwrites content it cannot read');
  }
  if (isPlainObject(buildState) && 'repos' in buildState && !isPlainObject(buildState.repos)) {
    throw err('YAD-STATE-004', `build-state/${story}.json has a \`repos\` that is not an object`, 'fix the file by hand — nothing here overwrites content it cannot read');
  }
  // Idempotent BEFORE the reason check, like a Shape skip: a repeat keeps the original record.
  if (laneIsSkipped(lane)) return { buildState: bs, already: true };
  if (shippedRepos.includes(repo)) {
    throw err('YAD-STATE-004', `${story} already has a ship recorded in ${repo}`, 'a lane that shipped was not skipped — there is nothing to set aside');
  }
  // "Started" the way E36 counts it: any step past `todo`, a halt (`blocked` with a record) included —
  // a skip says the lane does not apply, and work in it says otherwise.
  if (laneStarted(lane)) {
    throw err('YAD-STATE-004', `work has started in ${story} / ${repo}`,
      'a skip says the lane does not apply; finish it, or clear the halt and drive it with yad-run');
  }
  if (!declared.some((r) => r !== repo && !laneIsSkipped(repos[r]))) {
    throw err('YAD-STATE-004', `${repo} is the last lane ${story} has left to build`,
      'a story that needs no change in any repo is a question for its stories review, not a lane skip');
  }
  if (reason == null || reason === true || !String(reason).trim()) {
    throw err('YAD-STATE-004', 'a lane skip needs a reason', `yad skip <epic> ${story} --repo ${repo} --reason "<why it needs no change>"`);
  }
  // A lane the skill SEEDED but never began is replaced whole, and with it any per-step dial a person set
  // with `yad-run set-dial`. `yad unskip` does not bring those back: `yad-run` re-seeds the lane from the
  // `back_steps` defaults, which is what an unstarted lane would have been driven with anyway.
  return {
    buildState: { ...bs, story: bs.story || story, repos: { ...repos, [repo]: { status: 'skipped', record: stepRecord({ reason, by, date }) } } },
    already: false,
  };
}

// Putting a lane back asks nothing but that it was skipped — restoring owed work can never let anything
// pass, the same reason `yad unskip` on a Shape step asks no route. The entry is removed, so `yad-run`
// seeds the lane fresh from its defaults. `empty` is true when nothing is left but what a skip wrote,
// so the caller can remove a file the skip created rather than leave an empty one behind.
export function unskipLane(buildState, { story, repo } = {}) {
  const repos = isPlainObject(buildState?.repos) ? buildState.repos : {};
  if (!laneIsSkipped(repos[repo])) {
    throw err('YAD-STATE-004', `${story} / ${repo} is not skipped`, 'nothing to put back — see the lanes with `yad next <epic>`');
  }
  const rest = { ...repos };
  delete rest[repo];
  const next = { ...buildState, repos: rest };
  const empty = !Object.keys(rest).length && Object.keys(next).every((k) => ['story', 'repos', 'schemaVersion'].includes(k));
  return { buildState: next, empty };
}

// The two spellings of the product level. `foundation` is the one this release writes; `discovery` is
// what every release before it wrote, under `epics/EP-discovery/`, and it is still READ (rule 2) — a
// verified project cannot be converted by `yad migrate`, because CI owns its ledger, so the old
// spelling has to keep working for this whole major.
//
// ONE predicate, and every reader that used to ask `state.kind === 'discovery'` asks this instead. Two
// spellings read by two different checks is how one of them gets forgotten.
export const PRODUCT_KINDS = ['foundation', 'discovery'];
export const PRODUCT_EPICS = [FOUNDATION_EPIC, DISCOVERY_EPIC];
export const isProductLevel = (state) => PRODUCT_KINDS.includes(state?.kind);

// Does a step's recorded artifact agree with its catalogue row? The same artifact always does. One
// other answer is right, and only for the Foundation's two steps: `discovery/`. A Foundation that
// `yad migrate` converted from the old spelling keeps binding to the six files it was approved
// against, so its fingerprint — and every approval on it — survives the move (shape 8). Reporting that
// as "bound to the wrong file" would be false, and it would fire on every converted project.
export const artifactAgrees = (def, artifact) => artifactBase(artifact) === artifactBase(def.artifact)
  || (def.level === 'product' && artifactBase(def.artifact) === 'foundation' && artifactBase(artifact) === 'discovery');
// The terminal sentinel of each spelling — also the `yad next` action kind that says "finished".
export const PRODUCT_DONE = PRODUCT_KINDS.map((k) => `${k}-done`);

// Deterministic fingerprint of the discovery set: hash every file in the fixed DISCOVERY_FILES order,
// combine. The WHOLE set is the reviewable unit — if any required artifact is missing the discovery is
// incomplete and NON-REVIEWABLE, so this returns null (no hash to bind an approval to), the same
// "nothing to lock" signal storiesHash/contractSurfaceHash give for an absent/malformed surface. Once
// the full set exists, an edit (or deletion) of any file changes the hash and revokes prior approvals.
export function discoveryHash(epicDir, sha = reviewedSha) {
  if (!DISCOVERY_FILES.every((f) => fs.existsSync(path.join(epicDir, f)))) return null;
  const parts = DISCOVERY_FILES.map((f) => `${f}:${sha(path.join(epicDir, f))}`);
  return 'sha256:' + createHash('sha256').update(parts.join('\n')).digest('hex');
}

// The content fingerprint an approval is bound to. For architecture the fingerprint is the locked
// contract surface (a re-lock => stale); for stories it is the whole stories/ set; for discovery it is
// the whole discovery file set; for every other artifact it is the file. Every file is fingerprinted
// without its frontmatter `status:` line (see `reviewedSha`). `sha` swaps that for a legacy form —
// only `acceptedHashes` passes one.
export function artifactHash(epicDir, artifact, sha = reviewedSha) {
  const b = artifactBase(artifact);
  if (b === 'architecture') return contractSurfaceHash(epicDir);
  if (b === 'stories') return storiesHash(epicDir, sha);
  if (b === 'discovery') return discoveryHash(epicDir, sha);
  if (b === 'foundation') return foundationHash(epicDir, FOUNDATION_SECTIONS, sha);
  return sha(path.join(epicDir, artifact.replace(/\/$/, '')));
}

// Every fingerprint that still means "the content these reviewers approved": today's first, then the
// legacy forms (see LEGACY_FORMS). Empty when there is nothing to fingerprint — the same "no claim"
// answer a null `artifactHash` gives. What is WRITTEN is always `artifactHash`; this is for reading.
export function acceptedHashes(epicDir, artifact) {
  const current = artifactHash(epicDir, artifact);
  if (current === null) return [];
  return [...new Set([current, ...LEGACY_FORMS.map((sha) => artifactHash(epicDir, artifact, sha))].filter(Boolean))];
}

// Is a recorded fingerprint stale against the accepted ones? Never when nothing was recorded (a manual
// approval with no hash) or nothing can be fingerprinted — both are "no claim", as they always were.
export const isStaleHash = (recorded, accepted) => !!recorded && accepted.length > 0 && !accepted.includes(recorded);

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

// ---- the step-state model (E38) -------------------------------------------------------------------
//
// WHAT A STEP'S `status` MEANS, in one table, for the first time. Until now the answer was four words
// hard-coded in about thirty places with two boolean flags beside them, and every reader decided for
// itself what each one implied.
//
// The roadmap's model (docs/roadmap-idea-1.md, Part 1, "Step states") names SEVEN states. The table
// below has EIGHT rows, because `in_review` is kept beside them (see the note at the end of this
// comment). The two questions those thirty readers were really asking are its two columns:
//
//   passed    may the chain continue past this step, and does a later step see it as satisfied?
//   authored  was the artifact actually WRITTEN HERE? (a skip and an inheritance are not)
//
// Those are not one question, and running them together is the bug this table exists to stop. Both
// used to be spelled `status === 'done'`, which is why a skipped step had to be pre-marked `done` to
// get past the first group and carry a flag to be excluded from the second. Which reader wants which:
//
//   isPassed     `preconditionsMet`'s blocker scan · `restoreStep`'s `priorAllDone` ·
//                `closeAuthorStep`'s "already finished" guard (stamping `done` over a SKIPPED author
//                step would destroy the provenance of the skip) · `gate sync`'s `alreadyDone` ·
//                `buildNextForRepo`'s active-step scan · `artifact-status`'s "approved"
//   isAuthored   `setAsideStep`'s "already authored" refusal
//   == 'done'    `stateInvariants` on the REVIEW side and `yad doctor`'s gate-blind check — both ask
//                "did this gate genuinely complete here", which `isAuthored` answers for an author
//                step and this answers for a gate
//   set aside    the three step-over scans (`advanceState`, `setAsideStep`, `restoreStep`) walk past a
//                step whose STATUS is `skipped` or `deferred` (`isSetAside`, E37). They read the status,
//                never a legacy flag alone, so `skipped: true` on an unfinished step is not walked past.
//                A status word typed by hand onto a required step IS walked past, as a hand-typed
//                `skipped` always was: the file wins, and `yad doctor` reports it (`skip:not-optional`)
//
// A THIRD QUESTION, and it is not either column: what the file CLAIMS about itself. `claimsSkipped` /
// `claimsInherited` below answer that, for the readers that apply their own guard to the claim.
//
// THE NAME COLLISION THIS TASK HAD TO SETTLE. Every release up to shape 6 wrote `blocked` to mean
// "waiting on an earlier step" — which is what the roadmap calls `todo`. The roadmap gives `blocked` a
// DIFFERENT meaning: cannot proceed, and not by our choice. One string, two meanings.
//
// The disambiguator is the RECORD, not the schema version:
//
//     `blocked` + no `record`  ==  todo     — everything written before shape 7
//     `blocked` + a `record`   ==  blocked  — genuinely stuck; the record says on whom or what
//
// That is unambiguous BY CONSTRUCTION, because no release has ever written a `record`. Keying it on
// `schemaVersion` instead was the obvious alternative and is worse: `yad migrate` never rewrites
// `state.json` on a VERIFIED project — CI is its only writer, so the file is reported `ci-owned` and
// skipped — which leaves such a project at shape 6 until its next gate write, and several readers
// (`cli/doctor.mjs`, `cli/artifact-status.mjs`) load the file raw and have no shape number in hand.
// A meaning that depends on a number in another key is also a meaning a hand-edit can flip.
//
// Shape 7 writes `todo` going forward, and `blocked`-with-no-record stays READ as `todo` for this
// whole major — rule 2, read old and write new.
//
// THE CONVERSE: clearing a `blocked` must move `status` OFF `blocked`. Deleting only the record turns the
// step silently back into a `todo`. `unblockStep` (`yad unblock`, E37) is that verb, and it does both in
// one write.
//
// `in_review` is not in the roadmap's table and stays on purpose. It is `in_progress` on a
// `review+approve` step, and `markInReview`, `advanceState` and `cli/artifact-status.mjs` all key on
// that difference — an artifact whose gate is open reads `in-review`, one still being written reads
// `draft`. The table's `in-progress` hyphen is prose: the hyphen appears nowhere in code and in no
// file on disk, where the word has always been `in_progress`.
//
// WHO WRITES THE RECORDED STATES. `yad skip` writes `skipped` (E35, E36) and `yad defer` writes
// `deferred` (E37), both THROUGH this table rather than beside it. Nothing in the CLI writes `blocked`:
// a person does, by hand, and the `yad-run` skill does for a halted Build lane. `yad unblock` clears one
// (E37). `cli/test.mjs` still constructs a chain carrying every row of this table and pins each reader
// against it, because a state the fixtures happen not to use is untested.
//
// `debt: true` (E41) is a FLAG BESIDE a state, not a ninth row: it changes nothing any column above
// answers. `yad defer --debt` writes it on a deferred pair — work the team set aside under pressure and
// owes back — and it only decides what REMINDS (`owedSteps`: `yad next`, `yad doctor`). It stays on the
// pair while the step is paid back, and `advanceState` removes it when the step's review passes.
export const STEP_STATES = [
  { id: 'todo', passed: false, authored: false, record: false, meaning: 'not started' },
  { id: 'in_progress', passed: false, authored: false, record: false, meaning: 'being worked on' },
  { id: 'in_review', passed: false, authored: false, record: false, meaning: 'its review gate is open' },
  { id: 'done', passed: true, authored: true, record: false, meaning: 'completed here' },
  { id: 'skipped', passed: true, authored: false, record: true, meaning: 'consciously chose not to' },
  { id: 'deferred', passed: true, authored: false, record: true, meaning: 'will do it, later' },
  { id: 'satisfied', passed: true, authored: false, record: true, meaning: 'done elsewhere' },
  { id: 'blocked', passed: false, authored: false, record: true, meaning: 'cannot proceed, not our choice' },
];

const STATE_BY_ID = new Map(STEP_STATES.map((s) => [s.id, s]));

// The row for a canonical state id, or null for one this release does not know.
export const stepStateDef = (id) => STATE_BY_ID.get(String(id || '')) || null;

// Which states must carry a `record` to be meaningful — the four the roadmap gives a "Must record"
// column. Read by `yad doctor`, which reports a recorded state with nothing recorded on it.
export const RECORDED_STEP_STATES = STEP_STATES.filter((s) => s.record).map((s) => s.id);

// The `record` a recorded state carries: `{ reason, by, date, link? }` — why, who, when, and (for
// `satisfied`) where the work actually happened. Only `reason` is required. `by` and `date` are
// best-effort and may be null, exactly as `skippedBy` / `skippedAt` have always allowed: attribution
// is a nicety on the audit trail, never a gate, so a missing git identity must not block a skip.
export const isStepRecord = (r) => isPlainObject(r) && typeof r.reason === 'string' && !!r.reason.trim();

// A record object, from the fields `yad skip` and the threading seed already collect.
export const stepRecord = ({ reason, by = null, date = null, link = null }) => ({
  reason: String(reason || '').trim(),
  by: by || null,
  date: date || null,
  ...(link ? { link } : {}),
});

// THE ONE READER. A step's canonical state, whatever encoding its file happens to use.
//
// Three legacy encodings are translated HERE and nowhere else:
//   * `inherited: true` BESIDE `status: 'done'`  ->  `satisfied`  — Phase 6 threading: the artifact
//     is carried by reference and was reviewed in the parent, which is exactly "done elsewhere".
//   * `skipped: true` BESIDE `status: 'done'`    ->  `skipped`    — E35's skip stamp.
//   * `blocked` with no `record`                 ->  `todo`       — every file written before shape 7.
//
// THE PAIRING IS LOAD-BEARING, and a first cut of this function got it wrong by reading the flag
// alone. Both writers have always stamped the flag AND pre-marked the step `done`, and it is the
// `done` that made the chain move past it. A flag on its own is a hand edit — and reading that as a
// finished step would let `skipped: true`, typed into a file by someone with no route permission to
// skip anything, unblock every step behind it. So `status` stays the field that decides, and a flag
// only says which KIND of finish it was. `claimsSkipped` / `claimsInherited` below are for the
// separate question of what the file CLAIMS, which is not the same as what the chain concludes.
//
// BOTH FLAGS ARE STILL WRITTEN as well as read — rule 3, add before you remove — so a 3.x reader
// keying on `.skipped` or `.inherited` keeps working for this whole major.
//
// An UNRECOGNISED status is NOT an error. A project may legitimately hold a step written by a newer
// yadflow, and for this major THE FILE WINS — the same discipline as `workItemType` and the step
// catalogue. It reads as `null`, which `isPassed` and `isAuthored` both answer false to (fail
// closed: an unknown state never lets a chain past it), and which `yad doctor` reports as
// `step:unknown-status` and changes nothing about.
export function stepStatus(step) {
  if (!isPlainObject(step)) return null;
  const raw = typeof step.status === 'string' ? step.status : '';
  // Checked in the order `gatePredicate` short-circuits the two legacy FLAGS, so a step carrying both
  // of those (which no writer produces) reads one way here and the same way there. The new spellings
  // are not covered by that: `{ status: 'skipped', inherited: true }` reads `skipped` here and takes
  // the inherited branch there. No writer produces that either, and neither reading is wrong — it is
  // simply not a promise this function can keep across two fields that cannot both be `status`.
  if (raw === 'done' && step.inherited) return 'satisfied';
  if (raw === 'done' && step.skipped) return 'skipped';
  if (raw === 'blocked' && !isStepRecord(step.record)) return 'todo';
  return STATE_BY_ID.has(raw) ? raw : null;
}

// WHAT THE FILE CLAIMS, in either spelling — the shape-7 `status` or the legacy flag beside it. A
// different question from `stepStatus`, and the two must not be run together:
//
//   * `stepStatus` answers what the CHAIN concludes, so it needs the flag to be paired with the
//     `done` that every writer put beside it.
//   * these answer what the step SAYS ABOUT ITSELF, whatever state it is in — which is what a
//     reader wants when it is about to apply its own guard to the claim. `gatePredicate` honours a
//     skip only on a step this epic's ROUTE marks optional (`isSkippableStep`), and `yad doctor`
//     reports the ones it does not — both need to see a claim before they can refuse it, and a
//     half-stamped or hand-edited claim is exactly the one worth reporting.
export const claimsSkipped = (step) => step?.skipped === true || step?.status === 'skipped';
// ASYMMETRY WORTH NAMING: `gatePredicate` puts a ROUTE guard on the skip claim (`isSkippableStep`) and
// none on this one, so a hand-edited `inherited` passes any gate. That is not an oversight — a skip is
// a decision THIS epic makes about its own chain, so the route is what says whether it may; an
// inheritance is a claim about a DIFFERENT epic, and the thing that validates it is `boundHash`
// against the parent's live artifact, which the predicate already checks. A forged claim with no
// hash has nothing to drift from, exactly as a stub parent's does not — the check that catches it is
// `yad doctor`'s lineage walk, not the gate. Shape 7 widens the hand-editable surface from one
// spelling to two and changes nothing else about that.
export const claimsInherited = (step) => step?.inherited === true || step?.status === 'satisfied';

// May the chain continue past this step — and does a step after it see it as satisfied? True for
// `done`, and for the three states that finish a step without authoring it (`skipped`, `deferred`,
// `satisfied`). False for anything still outstanding, and for a state this release cannot name.
export const isPassed = (step) => !!stepStateDef(stepStatus(step))?.passed;

// Was this step's artifact actually written HERE? True for `done` alone. A skip has nothing to show,
// and an inherited artifact belongs to the parent epic — so neither can be audited for approvals or
// repaired as a stranded author step.
export const isAuthored = (step) => !!stepStateDef(stepStatus(step))?.authored;

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
      out.advance = isGateStep(s) ? 'human' : ADVANCE_FROM_AUTOMATION[s.automation];
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
//
// MATCHED AGAINST A FROZEN ROUTE SET, not against `LIFECYCLE_PROFILES`. A migration answers a question
// about the PAST — "which of the routes that existed when shape 6 landed is this chain on" — and
// reading the live table lets a route added later change that answer.
//
// `matchLifecycleProfile` breaks ties on the SHORTEST fitting route, and E40 adds two routes shorter
// than `classic`. Every chain drawn only from `epic`, `epic-review`, `stories` and `stories-review`
// therefore changes route the day the chore lane lands: a chain that stops at `epic-review`, or one
// hand-edited down to those steps, is the shape this catches. Against the live table an upgrade would
// relabel such an epic, and `optionalStepsFor` would answer from the new route for good, because the
// key just written is the one every later reader prefers over matching.
//
// NO SEED yadflow HAS EVER SHIPPED IS AFFECTED — every one of them carries `architecture`, which no
// short lane has, so a seeded chain still matches `classic` either way. HAND-WRITTEN CHAINS ARE, and
// this repo holds two: the `EP-e2e` and `EP-cici` fixtures in test/e2e/run.sh are `[epic, epic-review]`
// with no `profile` key, which the live table now places on `chore`. `yad gate ci` stamps them through
// `writeState`, so they are a live exercise of this function, and without the freeze they would come
// out labelled `chore`. Rule 3 is the general form of the same point: a hand-written chain is allowed
// to be ahead of the tool reading it, and a migration that is correct only because of what today's
// data happens to contain is one release away from being wrong.
//
// The freeze pins the SET OF ROUTES shape 6 may choose from, not the step rows inside them. Editing
// `classic`'s own chain would still move what fits it. That is the right scope — a route's steps are
// its definition, and a migration reading a stale copy of them would be the drift this file spends
// most of its comments avoiding — but it means the guarantee is against ADDED routes, not all change.
//
// `shape6Routes()` is the freeze and `profiles` is the seam the tests drive it through. Epics seeded
// by `yad epic new` are unaffected either way: `seedState` writes `profile` itself, and the first line
// here leaves any key already present alone — so a chore-lane epic keeps its own route.
//
// The freeze is about STAMPING, not about reading. An epic whose chain genuinely is chore-shaped and
// which carries no key gets `classic` here, and `yad doctor` then reports `profile:disagree` against
// the live table. That is the right split: an upgrade records what was true, and the report is what
// tells a person the label wants correcting. The remedy is to set `profile` by hand, once.
export function stampProfile(state, profiles = shape6Routes()) {
  if (!isPlainObject(state) || 'profile' in state) return state;
  const profile = matchLifecycleProfile(state.steps, profiles);
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

// Move every step's `status` onto the step-state model. Shape 7 (E38).
//
// Three rewrites, and every one is a TRANSLATION of something the file already said — never a new
// fact, which is the same discipline as the dial stamp above and the type/profile copies below:
//
//   `blocked` with no `record`  ->  `todo`       `blocked` changes meaning in shape 7, so the old
//                                                spelling of "not started" is written out here, while
//                                                the file still says it unambiguously.
//   `skipped: true`             ->  `skipped`    the step's own state, with a `record` assembled from
//                                                the `skipReason` / `skippedBy` / `skippedAt` the
//                                                skip already recorded. Nothing is invented.
//   `inherited: true`           ->  `satisfied`  done elsewhere: the artifact is carried by reference
//                                                and was reviewed in the parent, which `record.link`
//                                                names from the `inheritedFrom` already on the step.
//
// EVERY LEGACY FIELD IS KEPT — `skipped`, `skipReason`, `skippedBy`, `skippedAt`, `inherited`,
// `inheritedFrom`, `boundHash`. Rule 3, add before you remove, and the fourth time this engine makes
// that choice. `stepStatus` translates the flags either way, so a chain written by a skill that has
// not been refreshed by `yad update` reads exactly like a migrated one.
//
// `boundHash` is deliberately NOT folded into the record. It is evidence the gate compares against a
// live hash (`gatePredicate`), not provenance a person reads — a record is why/who/when/where.
//
// WHAT THIS DOES NOT TOUCH, and the one place the shape-7 story is genuinely awkward.
// `build-state/<story>.json` holds the same status words and is written by the `yad-run` and
// `yad-implement` SKILLS, not by the engine — so a rewrite here would be undone by their next write,
// and it is left alone. The awkward part is that those skills are the one existing writer of
// `blocked` in the NEW sense: `yad-run` halts a lane on a failed check, a scope overrun or a contract
// touch and marks the step `blocked`, meaning exactly "cannot proceed, not our choice". They now
// write a `record` with the halt cause alongside it (see their step-4 HALT branch), which is what
// keeps that halt distinguishable from a lane nobody started.
//
// A lane halted by an OLDER yad-run carries a bare `blocked` and therefore reads as `todo`. Nothing
// advances past it either way — `isPassed` is false for both — so what is lost is the word, until
// the next run rewrites the file. That is the cost of not migrating a file whose writer is a skill,
// and it is smaller than rewriting a file the next write would undo. `buildNextForRepo` goes through
// `stepStatus` like every other reader.
//
// Add-only and idempotent: a step whose `status` already IS its canonical state is returned
// untouched, so a second `yad migrate` and every later gate write are no-ops. A status this release
// cannot name is left exactly as it stands — the file wins (rule 3) — and `yad doctor` reports it as
// `step:unknown-status` rather than this function guessing what it meant.
//
// ONE of these, called from `writeState` below and from the 6 -> 7 step in cli/migrate.mjs. Both
// paths must produce byte-identical files (cli/test-migrate.mjs pins it), which is why the rewrite
// keeps `status` in the position it already held (spreading then overriding an existing key does not
// move it) and appends `record` at the end.
export function stampStepStates(state) {
  if (!isPlainObject(state) || !Array.isArray(state.steps)) return state;
  let moved = false;
  const steps = state.steps.map((s) => {
    if (!isPlainObject(s)) return s;
    const canonical = stepStatus(s);
    if (!canonical || canonical === s.status) return s;
    const out = { ...s, status: canonical };
    // ANY record already on the step is left alone — `isPlainObject`, deliberately not `isStepRecord`.
    // It is the team's own sentence about their own step, and an upgrade rewriting it would be this
    // function deciding what they meant. That includes a MALFORMED one: `{ by: '@al', note: 'ticket
    // 4412' }` has no `reason` and is not a valid record, and replacing it with a generated one would
    // throw away the fields they did write. `yad doctor` reports it as `step:no-record` instead, which
    // is the same split this whole file keeps — report, never correct.
    if (!isPlainObject(out.record)) {
      if (canonical === 'skipped') {
        out.record = stepRecord({ reason: s.skipReason, by: s.skippedBy, date: s.skippedAt });
      } else if (canonical === 'satisfied') {
        out.record = stepRecord({
          reason: `carried by reference from ${s.inheritedFrom || 'the parent epic'}`,
          link: s.inheritedFrom || null,
        });
      }
    }
    moved = true;
    return out;
  });
  // The SAME object when nothing changed, for the reason `stampStepDials` gives: `writeJSON`
  // short-circuits on identical bytes, and a fresh object every time would defeat that on every
  // read-only gate path.
  return moved ? { ...state, steps } : state;
}

export function writeState(file, state) {
  // `file` is <epicDir>/.sdlc/state.json, so the epic's own directory is two levels up — that is
  // where `epic.md` lives, and the stamper needs it to read the type the author wrote.
  const epicDir = path.dirname(path.dirname(file));
  // Same ORDER as the migration chain in cli/migrate.mjs — dials (4), type (5), profile (6), step
  // states (7). The two paths must produce byte-identical files (cli/test-migrate.mjs pins it), and
  // both `type` and `profile` insert themselves in front of `currentStep`, so running them out of
  // order would swap two keys and make a migrated project's bytes differ from a gate-written one's.
  // The step-state stamp goes LAST for the same reason and for one of its own: it reads a step's
  // `status` and its legacy flags, and both are settled by the time the earlier three have run.
  const stamped = stampStepStates(stampProfile(stampWorkItemType(stampStepDials(state), epicDir)));
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

// Does this step carry a risk tag that raises its count (`contract`, `auth`, `payments`)? A fact read
// from the step's own tags and nothing else. It used to be the trigger of the roster-era rule — a
// domain owner per touched repo — and it named `stories-review` BY ID for that rule's per-repo half.
// E62 removed that rule with the roster, and the step name went with it. What still reads this: the
// `escalated` flag `yad gate status` and the review bundle print, and `touchedDomains` (cli/gate.mjs),
// which decides which repos a review PR names and labels.
export const isEscalated = (step) =>
  (step?.risk_tags || []).some((t) => RISK_ESCALATORS.includes(t));

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

// Is this step a GATE — one a human signs off, which may never advance on its own (rule 1)? (E34)
//
// Three answers, in order. `type: review+approve` is how the Shape chain marks one. For a step the
// catalogue knows, its `kind` decides — that is how a Build `engineer-review`, which carries no `type`, is
// recognised. And `locked: true` counts ONLY on an id the catalogue does not know, a step from a newer
// yadflow, where it is the one signal left.
//
// `locked` alone used to decide it, and that was wrong for Shape: every seeded Shape step carries
// `locked: true`, author steps included, so every Shape author step was pinned to `advance: human`. Since
// E34 an author step's advance dial is the team's to set; `locked` on a step the catalogue knows to be
// an author step decides nothing. No file changes — only what the readers conclude from it.
//
// `type` is checked before the catalogue on purpose: a step that SAYS it is a review is treated as one
// even if its id names an author step. Of the two ways to be wrong, a gate read as an author step is the
// one that breaks rule 1.
export const isGateStep = (step) => {
  if (!isPlainObject(step)) return false;
  if (step.type === 'review+approve') return true;
  const def = stepDef(step.id);
  if (def) return def.kind === 'review';
  return step.locked === true;
};

// Closing a review gate implies its artifact was authored — so the CLI, not the authoring skill, is
// what makes `<step>.status = done` true. Without this an author step left at `in_progress` strands
// forever: `preconditionsMet` requires every PRIOR step done, so the parallel `test-cases` track (and
// every later step) stays blocked behind a review that already passed. Idempotent; a no-op on an
// absent step and on a `skipped` one (already `done`, carrying its skip provenance).
// Returns the id it closed, or null. `closed` (E18) is the closing record to stamp on the step it closes.
function closeAuthorStep(state, reviewStep, closed = null) {
  const author = authorStepFor(state, reviewStep);
  // `isPassed`, not `status === 'done'`: a skipped or inherited author step is already finished, and
  // stamping `done` over it would erase the reason it never needed authoring.
  if (!author || isPassed(author)) return null;
  author.status = 'done';
  stampClosed(author, closed);
  return author.id;
}

// ---- closing records (E18) -----------------------------------------------------------------------
//
// A step that becomes `done` says how it closed. Before this, `done` was the one state that recorded
// nothing: `skipped`, `deferred`, `satisfied` and `blocked` all carry a `record`, while a passed review
// said only `status: "done"`, and who closed it, when and on which PR had to be pieced together from
// approvals.json and the PR ledger.
//
// It is `closed`, NOT `record`. `record` means why a step is not done, and `blocked` is read by whether
// it has one, so a second meaning under that key would blur both. The fields:
//
//   by        who WROTE the record, as on every record: the local git identity, or CI's on a verified
//             Product. Never the merger — that is `mergedBy`.
//   date      when the step closed: the merge date for a merge, otherwise the day the command ran.
//   via       how it closed — CLOSED_VIA below.
//   pr        the review PR/MR number, when there is one.
//   commit    the merge commit, when the platform reports it.
//   hash      the artifact hash the step closed on (the one approvals bind to).
//   mergedBy  the platform login that merged the PR, when the platform reports it.
//   run       the trust-log run id, for a Build lane step the `yad-run` skill moved past.
//   waived    `solo` when a REVIEW step passed while solo mode waived its approvals (E10). Absent on a
//             gate that counted approvals. Never on the author step it closes: the approvals were
//             waived, the authoring was not, so `closeAuthorStep` is handed its fields one by one.
//   capped    `{ needed, to, active }` when a REVIEW step passed in team mode while the capacity cap
//             LOWERED its ask (E72): the full count, the capped ask, and the count of people it read.
//             The ask is reported until E108, so this records what the gate asked, not what held it.
//             Absent when no cap applied — the count of people was unknown, or it lowered nothing — and
//             in solo mode, where nothing was counted. Never on the author step, as `waived`.
//
// FIRST CLOSE WINS: a step that already carries one keeps it. Nothing moves a `done` step back today,
// so nothing has to remove one; a writer that ever does must take `closed` with it, as `record` goes
// with `blocked`. No shape change: an older release ignores a key it does not know, and nothing reads
// `done` differently because this is present. Steps finished before it carry none, and nothing asks.
// `approved` is the one no engine command writes: the `yad-review-gate` skill passes a gate by hand on a
// Product with no platform, where `advanceState` has no caller and nothing merges.
export const CLOSED_VIA = ['merge', 'approved', 'review-passed', 'review-opened', 'repair', 'auto', 'human'];

export const closingRecord = ({ by = null, date = null, via, pr = null, commit = null, hash = null, mergedBy = null, run = null, waived = null, capped = null } = {}) => ({
  by: by || null,
  date: date || null,
  via,
  ...(pr != null ? { pr } : {}),
  ...(commit ? { commit } : {}),
  ...(hash ? { hash } : {}),
  ...(mergedBy ? { mergedBy } : {}),
  ...(run ? { run } : {}),
  ...(waived ? { waived } : {}),
  ...(isPlainObject(capped) ? { capped } : {}),
});

function stampClosed(step, closed) {
  if (isPlainObject(step) && isPlainObject(closed) && !isPlainObject(step.closed)) step.closed = closed;
}

const uniqueBy = (arr, key) => {
  const seen = new Set();
  return arr.filter((x) => (seen.has(x[key]) ? false : seen.add(x[key])));
};

// PURE gate predicate. Given the step, its approvals, the current content hash, the PR thread/merge
// state and the touched domains, decide whether the gate passes — and exactly what is missing.
// `currentHash` drops any approval bound to a different hash (revoke-on-change). `merged` /
// `threadsResolved` come from the platform; with a local ledger they default to the "advance" intent.
//
// ONE APPROVAL RULE (E62). No role and no name is inspected anywhere in it:
//   * the BASE — `gateRuleFor(step).base` distinct approvers (one). This is what decides `passed`.
//   * the RISK STEP — the rest of `needed`, capped at `active − 1` (floor 1) when the count of people is
//     known (E72, `gateCapFor`). Computed, returned as `gateRule`/`cap`/`have`/`short` and printed
//     wherever a gate reports itself, and it holds NOTHING until E108 lands its escape hatch. See the
//     long note on `gateRuleFor`: the count of people errs high in the normal case, so an enforced cap
//     would still lock a small team out with no recorded way out (rule 7).
// Approvals are counted as distinct PEOPLE: two approvals from one person are one approver.
// Before E62 a role rule read from the roster held the gate (1 owner, 1 reviewer, a domain owner per
// touched repo). The `role` and `domain` fields older approvals carry are left on disk and never read.
export function gatePredicate({
  step,
  approvals,
  currentHash = null,
  // Every fingerprint that still counts as the reviewed content — `acceptedHashes(epicDir, artifact)`,
  // which puts `currentHash` first and adds the forms older releases recorded. A caller that passes only
  // `currentHash` gets exactly the old comparison against that one value.
  acceptedHashes = null,
  threadsResolved = true,
  merged = true,
  solo = false,
  requireEngagement = false,
  // How many people are ACTIVE right now, Product-wide (E71, `activePeople` in cli/people.mjs), or null
  // when no source could be read. PASSED IN, never computed here: this function is pure and is called
  // once per step, while the count is one fact about the whole Product that the CALLER reads once per
  // command. Computing it here would also walk git from inside the golden fixture — which lives inside
  // yadflow's own work tree — and fold this repo's committers into a frozen snapshot.
  //
  // E72 caps the reported ask with it (`gateCapFor`); `null` never becomes a small number — no cap.
  active = null,
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
  // COMPARE AGAINST THE OWNER'S COPY. `boundHash` is the hash of the artifact in `inheritedFrom`, and the
  // child's folder is not always empty where that artifact's name would be: a change-epic writes its own
  // `epic.md` (the change brief), so hashes taken from the CHILD's folder for a carried `epic-review`
  // would read as drift that is not there. No caller runs the predicate on a carried step today.
  const accepted = acceptedHashes ?? (currentHash ? [currentHash] : []);
  if (claimsInherited(step)) {
    const drift = isStaleHash(step.boundHash, accepted);
    return {
      approvalsSatisfied: true, threadsResolved: true, merged: true, staleDropped: 0,
      passed: !drift,
      missing: drift ? [`inherited artifact drifted from ${step.inheritedFrom || 'parent'} — re-thread`] : [],
      rule: 'inherited',
      // The step's own rule is a fact about the step, so it is reported even where nothing was counted
      // against it — here the approvals live upstream in the thread, under the parent epic. `have: null`
      // says "not counted", which is not the same fact as zero approvals.
      gateRule: gateRuleFor(step), have: null, short: 0, active, cap: gateCapFor(gateRuleFor(step), active),
    };
  }

  // A SKIPPED step (an optional step the team marked N/A for this epic — e.g. `ui-design` on a
  // backend-only epic) is satisfied without review. Like `inherited`, it is pre-marked `done` in
  // state.json so the gate is normally never invoked on it; this short-circuit makes a direct call
  // safe and keeps the skip a first-class, auditable outcome (the reason lives on the step).
  // GUARD: only honour the flag on a genuinely skippable step (the author step or its `-review` gate).
  // A corrupted/hand-edited `skipped: true` on a non-optional step (e.g. `stories-review`) must NOT
  // bypass approvals — it falls through to the real predicate below and fails for lack of approvals.
  if (claimsSkipped(step) && isSkippableStep(step.id, optional)) {
    return {
      approvalsSatisfied: true, threadsResolved: true, merged: true, staleDropped: 0,
      passed: true, missing: [], rule: 'skipped',
      // Nothing is counted on a step nobody reviewed; the rule and its cap are still facts about the step.
      gateRule: gateRuleFor(step), have: null, short: 0, active, cap: gateCapFor(gateRuleFor(step), active),
    };
  }

  // A DEFERRED step gets NO short-circuit here. That is E38's decision, and E37 keeps it on purpose: the
  // chain walks past a deferred step (`isPassed`), but its review is still owed. A skip's gate will never
  // be asked again; a deferral's will. So the predicate answers honestly — not passed, and what is still
  // missing — which is the true report of what the team owes.

  const forStep = approvals.filter((a) => a.step === step.id && a.status === 'approved');
  // Revoke-on-change: an approval bound to a stale content hash no longer counts.
  const stale = forStep.filter((a) => isStaleHash(a.artifactHash, accepted));
  const live = forStep.filter((a) => !stale.includes(a));

  // requireEngagement (config `hub.review.requireEngagement`, soft-off by default): only an approval
  // carrying a verified engagement signal counts. The signal is gameable by design — this raises the
  // cost of a bare rubber-stamp, it does not claim to prove a human read the artifact.
  const counted = requireEngagement ? live.filter((a) => a.engagement === 'verified') : live;
  const unengaged = requireEngagement ? live.filter((a) => a.engagement !== 'verified').length : 0;

  // How many DISTINCT humans approved. An older record may name one person several times, once per
  // role the roster gave them; that is still one approver. A record naming nobody is nobody: before E62
  // it carried no role and counted for nothing, and with only the base enforced one such hand-written
  // line would otherwise pass a team gate on its own (`mapApprovers` refuses one the same way).
  const approvers = uniqueBy(counted.filter((a) => typeof a.approver === 'string' && a.approver.trim()), 'approver').length;
  const gateRule = gateRuleFor(step);
  // E72. `asks` is the count the gate asks for — capped when the count of people is known, the full
  // count otherwise. Only the BASE holds the gate until E108 (see `gateRuleFor`).
  const cap = gateCapFor(gateRule, active);
  const asks = cap ? cap.to : gateRule.needed;

  const missing = [];
  // Solo mode waives the APPROVAL requirements entirely (you can't approve your own PR on GitHub) —
  // merge + resolved threads are what advance the step.
  if (!solo) {
    // Only the BASE holds the gate. The rest of the ask rides out as `short`, which is what the surfaces
    // print and what E108 turns into a `missing` entry, beside `yad gate lower --reason`.
    if (approvers < gateRule.base) missing.push(`${gateRule.base - approvers} approval(s)`);
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
    // `rule` names which kind of rule was applied. A team gate is `count`; it used to be one of three
    // roster-era labels (`base`, `escalated`, `per-repo`), which E62 retired with the rule they named.
    rule: solo ? 'solo' : 'count',
    // The rule and what was counted against it. `have` is the number of distinct approvers and `short`
    // how many more the gate ASKS for — the capped count when `active` is known, the full count when it
    // is not. A gate can pass while `short` is not 0: only the base is enforced until E108.
    gateRule,
    have: approvers,
    short: solo ? 0 : Math.max(0, asks - approvers),
    // The live capacity count as the caller read it, and the cap it gives (`null` when unknown). Solo
    // mode still reports the cap, so a reader who later switches to team mode sees what it will ask.
    active,
    cap,
  };
}

// Advance the step in state.json once the predicate passes. Mirrors yad-review-gate Step 3:
// mark this review step done, unblock the next step, or set `ready-for-build` for the last one.
//
// `test-cases` is a PARALLEL, non-blocking track so Build can start while the tester works:
// approving `stories-review` makes the epic `ready-for-build` (Build keys off this) AND opens
// `test-cases` for the tester; completing `test-cases-review` never pulls `currentStep` back from
// `ready-for-build`. Both rules degrade safely for an old chain that has no test-cases steps.
// `close` (E18) is what the caller knows about the merge — `{ by, date, pr, commit, hash, mergedBy }`. With
// it, the review step is stamped `closed` via `merge`, and an author step closed here via `review-passed`.
// Without it nothing is stamped, so a caller that knows nothing invents nothing.
export function advanceState(state, step, close = null) {
  const i = state.steps.findIndex((s) => s.id === step.id);
  // A step that was BLOCKED and has now passed is no longer waiting on anybody, so the record goes
  // with the state it belonged to — otherwise the step reads `done` while still naming who we wait
  // for. ONLY `blocked`: a skip's record is the reason that step passed and has to survive (and the
  // shape-7 stamp would put it straight back from `skipReason` anyway).
  const closing = { ...state.steps[i], status: 'done' };
  if (stepStatus(state.steps[i]) === 'blocked') delete closing.record;
  state.steps[i] = closing;
  if (close) stampClosed(closing, closingRecord({ ...close, via: 'merge' }));
  // Defensive: `markInReview` normally closed the author step when the gate opened, but the CI bridge
  // advances on a merge event without ever running it locally. Close it here too, so a passed gate can
  // never leave its author step behind (issue #131). The merge closed it, but nothing here knows who
  // wrote it, so its record carries the PR and the hash and no `mergedBy` or `commit`.
  closeAuthorStep(state, step, close ? closingRecord({ by: close.by, date: close.date, pr: close.pr, hash: close.hash, via: 'review-passed' }) : null);
  // DEBT IS PAID when the review passes (E41) — not when the step is put back, which only starts paying
  // it. `closeAuthorStep` above has already closed the author step, so the pair is paid together.
  delete state.steps[i].debt;
  const paid = authorStepFor(state, step);
  if (paid) delete paid.debt;
  if (step.id === 'stories-review') {
    const tc = state.steps.find((s) => s.id === 'test-cases');
    if (tc && stepStatus(tc) === 'todo') tc.status = 'in_progress';
    state.currentStep = 'ready-for-build';
    return state;
  }
  if (step.id === 'test-cases-review') {
    state.currentStep = 'ready-for-build';
    return state;
  }
  // The product level has no Build part, so its review terminates at its own `-done` sentinel rather
  // than `ready-for-build` (which would make `yad next` claim the Build can run). The roadmap it
  // approved is the input the real feature epics read. Two spellings, each ending on its own word, so
  // a legacy discovery ledger that has not been converted keeps writing what its readers expect.
  if (step.id === 'foundation-review') {
    state.currentStep = 'foundation-done';
    return state;
  }
  if (step.id === 'discovery-review') {
    state.currentStep = 'discovery-done';
    return state;
  }
  // Step over any step SET ASIDE — a skipped or a deferred pair (`isSetAside`). Neither is waiting to be
  // opened by the gate in front of it: a skip does not apply, and a deferral comes back through
  // `yad undefer`. Opening one here would write `in_progress` over the deferral and lose its record
  // (E37). The next runnable step is the first later step not set aside; when the whole tail is set
  // aside, fall through to ready-for-build.
  // A GATE THAT PASSED BEHIND THE CHAIN — a step re-opened after later work finished (E41), whose
  // `currentStep` is already past it or at `ready-for-build` — opens nothing and moves nothing. The step
  // after it is finished work: re-opening it would undo that work, and pointing `currentStep` back at it
  // would pull the epic out of Build.
  const cur = state.steps.findIndex((s) => s?.id === state.currentStep);
  if (state.currentStep === 'ready-for-build' || cur > i) return state;
  // Step over every step that has already PASSED — not only a skipped or deferred pair. A change-epic's
  // inherited (`satisfied`) steps are passed too, and landing `currentStep` on one made `yad next` say to
  // author an artifact the parent epic owns (found in the E41 review; older releases wrote `in_progress`
  // over it instead, which was worse).
  let j = i + 1;
  while (state.steps[j] && isPassed(state.steps[j])) j++;
  const next = state.steps[j];
  if (next) {
    // Only a `todo` step is opened. A BLOCKED one is not: a gate passing is not somebody saying the wait
    // is over, and writing `in_progress` over it kept the record while hiding the block (E37). Nor is one
    // already started or finished, or in a state this release cannot name (the file wins). `currentStep`
    // still moves there, so `yad next` shows where the chain stands.
    if (stepStatus(next) === 'todo') next.status = next.type === 'review+approve' ? 'in_review' : 'in_progress';
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
// A chain to work on, or a YadError saying there is not one.
//
// Both verbs below are reachable from `yad skip`, which a person types at a corrupt ledger, and both
// index straight into `state.steps` from their second line on. Without this they answer a malformed
// `state.json` with a raw `TypeError: Cannot read properties of undefined`, which names no file and
// suggests no fix. `cli/skip.mjs` already refuses a MISSING ledger; this is the one that exists and
// is wrong inside.
const requireChain = (state, verb) => {
  if (isPlainObject(state) && Array.isArray(state.steps)) return state.steps;
  throw err('YAD-STATE-004', `this epic has no step chain to ${verb}`,
    '`.sdlc/state.json` is missing its `steps` array or does not hold an object — restore it from git, then run `yad doctor`');
};

// THREE REASONS A STEP IS NOT SKIPPABLE, and they need three different sentences because the remedy
// differs. Until E40 there were two, because every feature route marked exactly one step optional
// (`ui-design`) — so "this epic has nothing optional" could only mean "this epic is on no route", and
// one branch covered both. The short lanes end that: `chore` and `spike` are routes the release fully
// recognises, on which NOTHING is optional, because they dropped the optional steps from the chain
// rather than marking them skippable. Sending that user to `yad doctor` for a `step:off-route` finding
// that will never fire is worse than saying nothing — it is a remedy for a fault they do not have.
// The same three sentences answer `yad defer` (E37), which asks the same route the same question.
const notOptional = (stepId, optional, route, participle = 'skipped') => err(
  'YAD-STATE-004',
  `step '${stepId}' is not optional on this epic's route`,
  optional.length
    ? `only these steps may be ${participle} here: ${optional.join(', ')}`
    : route
      ? `this epic is on the \`${route}\` route, and no step on it is optional — a short lane leaves the steps it does not need OUT of the chain rather than making them skippable, so there is nothing to mark N/A. If this epic needs '${stepId}', it is on the wrong route: start it again on a route that carries the step`
      : 'this epic is on no lifecycle route this release knows — it records none, and its chain matches none — so nothing on it is optional. Run `yad doctor` and look for `step:off-route`',
);

// Strip the set-aside fields off a step — the inverse of the stamp `setAsideStep` applies: a skip's four
// legacy fields, and the record either verb writes.
function withoutSetAside(step) {
  const rest = { ...step };
  delete rest.skipped;
  delete rest.skipReason;
  delete rest.skippedBy;
  delete rest.skippedAt;
  // And the shape-7 record. Leaving it behind would be worse than untidy: the caller sets `status` to
  // `todo`, and a `todo` carrying a stale reason is a step that claims to be un-started and explains
  // why it was set aside.
  delete rest.record;
  return rest;
}

// SET ASIDE: a step that passed without anybody working on it here, because a person chose that —
// `skipped` (E35/E36: it does not apply) or `deferred` (E37: it applies, later). The chain walks past
// both, the gate passes both on a step the route marks optional, and neither verb turns one into the
// other. `satisfied` is not in this set: an inherited step was worked on, in the parent epic, and
// nobody here set it aside. `stepStatus`, never the claim: a hand-typed flag on an unfinished step must
// not be walked past (E38).
const isSetAside = (step) => {
  const st = stepStatus(step);
  return st === 'skipped' || st === 'deferred';
};

// The index of the first step after `index` that is not itself set aside: the step a skip or a deferral
// opens. Past the end of the chain when the whole rest of it is set aside. Both verbs below refuse a
// hole after the pair (`refuseHoleAfter`) before they ask this, so it never has to decide what a null
// entry means.
const firstLiveAfter = (steps, index) => {
  let j = index + 1;
  while (steps[j] && isSetAside(steps[j])) j++;
  return j;
};

// Has work begun on this step IN THIS CHAIN — is it open (`in_progress` / `in_review`) or completed
// here (`done`)? That is the only thing that makes a skip or an un-skip too late, because it is the only
// thing built on the skip. The recorded states are not work done here: `skipped`, `satisfied` (carried
// from a parent epic), `deferred` and `blocked` all describe a step nobody worked on in this chain, so
// counting them would refuse an un-skip because a later step was inherited. A status word this release
// cannot name counts as started: refusing is the safe reading of a file a newer release wrote.
const hasStarted = (step) => {
  const st = stepStatus(step);
  return st === null || st === 'in_progress' || st === 'in_review' || st === 'done';
};

// RE-OPENED BEHIND FINISHED WORK (E41): is the step at `index` unfinished while a later step, before
// `end`, was COMPLETED HERE? That is what a deferral resumed late looks like — `ui-design` open again
// after `stories` is done — and such a step runs BESIDE the chain, the way `test-cases` does: it must
// not block the finished work in front of it, and passing its gate must not re-open that work.
//
// READ OFF THE CHAIN, NEVER A FLAG. A `reopened: true` that `preconditionsMet` honoured would be one
// hand-typed word that unblocks a chain — the exact hole E38 closed for `skipped: true`.
//
// `done` only, not `isPassed`: a later step that was skipped, deferred or carried from a parent epic
// (`satisfied`) is not work built here, and counting it would let an unfinished `architecture` stop
// blocking `stories` just because `ui-design` between them was skipped. The step's OWN review gate does
// not count either: a `done` gate over an unwritten author step is the damage `stateInvariants` reports
// (#131), not a re-open.
const behindFinishedWork = (steps, index, end = steps.length) => {
  const ownGate = `${steps[index]?.id}-review`;
  return steps.slice(index + 1, end).some((s) => isPlainObject(s) && s.id !== ownGate && stepStatus(s) === 'done');
};

// A hole in the chain after the pair makes "has the chain moved on?" unanswerable either way — reading
// it as `todo` would let a skip through past a started step, reading it as started would refuse for a
// step that does not exist. Refuse it, the way a pair with no `-review` gate is refused.
const refuseHoleAfter = (steps, index, verb) => {
  if (steps.slice(index + 1).some((s) => !isPlainObject(s))) {
    throw err('YAD-STATE-004', `malformed chain: an entry after the step to ${verb} is not a step`, 'restore state.json from git, then run `yad doctor`');
  }
};

// The two ways to set a step aside, and everything that differs between them: the words, the command
// that puts the step back, what the step claims, and the stamp. Everything else — which steps qualify,
// when it is too late, what happens to `currentStep` — is ONE rule, in `setAsideStep` / `restoreStep`.
const SET_ASIDE = {
  skipped: {
    verb: 'skip', undo: 'un-skip', undoCommand: 'unskip', noun: 'skip',
    needsReason: 'a skip needs a reason', reasonHint: 'say why the step does not apply',
    // What the step CLAIMS, in either spelling — the shape-7 status or the legacy flag beside `done`.
    claims: (step) => claimsSkipped(step),
    // `status: 'skipped'` is the step's own state from shape 7 on (E38), and the four legacy fields
    // stay beside it — rule 3, add before you remove. `skipped: true` is what a 3.x reader keys on and
    // what `stepStatus` still translates, so both vocabularies describe the same step for this major.
    stamp: ({ reason, by, at }) => ({
      skipped: true, skipReason: String(reason).trim(), skippedBy: by, skippedAt: at,
      status: 'skipped', record: stepRecord({ reason, by, date: at }),
    }),
  },
  deferred: {
    verb: 'defer', undo: 'un-defer', undoCommand: 'undefer', noun: 'deferral',
    needsReason: 'a deferral needs a reason', reasonHint: 'say why it waits, and who is waiting for it',
    // `deferred` has no older spelling, so the status word IS the claim.
    claims: (step) => stepStatus(step) === 'deferred',
    // No legacy fields: `deferred` was born in shape 7, so there is no older reader to keep fed. The
    // record's `by` is who WROTE it, as on every record; who is waiting for the step belongs in the reason.
    // `debt` (E41) only when asked for: a plain deferral is planned, a debt is owed back and reminded.
    stamp: ({ reason, by, at, debt }) => ({ status: 'deferred', record: stepRecord({ reason, by, date: at }), ...(debt ? { debt: true } : {}) }),
    carriesDebt: true,
  },
};
const otherWay = (as) => (as === 'skipped' ? 'deferred' : 'skipped');

// PURE. Set a step aside for this epic: mark its author step and paired `<id>-review` gate `skipped`
// (`skipStep`) or `deferred` (`deferStep`) with a recorded reason, and — if currentStep is sitting on the
// pair — advance currentStep past them to the next step not set aside. Idempotent on a step already set
// aside the same way. Refuses once the step was authored, once its review gate has opened, or once work
// has started on any later step — the step is optional only up to authoring it. Refuses a step set aside
// the OTHER way: each has its own record and its own way back, and converting in place would lose one.
// Throws on a step the route does not mark optional, or a malformed (unpaired) chain. Which step ids
// qualify is the epic's route (`optionalStepsFor`), and nothing below names one.
//
// WHY DEFERRING IS NO WIDER THAN SKIPPING (E37). A deferred step lets the chain continue exactly as a
// skipped one does, so it needs the same permission from the route. Deferring a required step would carry
// the chain past its review gate with no approvals on it, which rule 2 forbids however the reason is
// worded. The gate itself is not waived: `gatePredicate` still reports a deferred step's review as owed.
function setAsideStep(state, stepId, as, { reason, by = null, at = null, debt = false, profiles = LIFECYCLE_PROFILES } = {}) {
  const V = SET_ASIDE[as];
  // DEBT IS OWED WORK, and a skip says the step does not apply (E36/E37), so nothing is owed back. Asked
  // first, before any chain question: it is a wrong command, whatever state the chain is in.
  if (debt && !V.carriesDebt) {
    throw err('YAD-STATE-004', 'a skip cannot carry debt',
      `a skip says ${stepId} does not apply, so nothing is owed back. If the step is owed, defer it instead: \`yad defer <epic> ${stepId} --reason "<why>" --debt\``);
  }
  const steps = requireChain(state, `${V.verb} a step in`);
  const optional = optionalStepsFor(state, profiles);
  if (!optional.includes(stepId)) throw notOptional(stepId, optional, epicProfileId(state, profiles), as);
  // `s?.id` throughout: a hand-edited chain can hold a null entry, and a crash on one would be the
  // same unhelpful answer `requireChain` exists to replace.
  const ai = steps.findIndex((s) => s?.id === stepId);
  if (ai === -1) throw err('YAD-STATE-004', `step '${stepId}' is not in this epic's chain`, `nothing to ${V.verb}`);
  const author = steps[ai];
  // Idempotent BEFORE the reason check: a repeat on a step already set aside this way is a no-op that
  // keeps the original reason/actor, so it must not fail merely for lacking a fresh --reason.
  // One addition is allowed: `--debt` on a deferral already made marks it owed, on both steps of the
  // pair, and keeps its record. The reverse is not offered — debt is cleared by paying it back (E41).
  if (V.claims(author)) {
    if (debt) for (const s of [author, steps.find((x) => x?.id === `${stepId}-review`)]) if (isPlainObject(s) && V.claims(s)) s.debt = true;
    return state;
  }
  const O = SET_ASIDE[otherWay(as)];
  if (O.claims(author)) {
    throw err('YAD-STATE-004', `${stepId} is already ${otherWay(as)}`,
      `put it back with \`yad ${O.undoCommand} <epic> ${stepId}\` first, then ${V.verb} it — changing it in place would lose the ${O.noun}'s record`);
  }
  // A BLOCKED step is waiting on somebody outside the workflow, and its record says who. Setting it aside
  // would replace that record with this verb's own, and putting the step back would then delete it — the
  // blocker would vanish without anybody clearing it. Refuse, and name the verb that does clear it. This
  // was a hole in `yad skip` from E35 on; `yad unblock` (E37) is what makes the refusal answerable. It
  // also replaces a wrong answer: a blocked REVIEW gate used to be refused as "its review has already
  // opened".
  const blockedStep = [author, steps.find((s) => s?.id === `${stepId}-review`)].find((s) => stepStatus(s) === 'blocked');
  if (blockedStep) {
    throw err('YAD-STATE-004', `${blockedStep.id} is blocked — ${blockedStep.record?.reason || 'no reason recorded'}`,
      `clear the blocker first with \`yad unblock <epic> ${blockedStep.id}\`, then ${V.verb} ${stepId} — setting it aside now would lose the record of who it waits on`);
  }
  // A step OWED AS DEBT cannot be skipped (E41). A skip says nothing is owed, and a skipped gate reads as
  // passed, so its review would never run again and nothing could ever clear the flag. Only a passing
  // review pays a debt. Deferring it again is allowed, and keeps the debt.
  if (as === 'skipped' && [author, steps.find((s) => s?.id === `${stepId}-review`)].some((s) => s?.debt === true)) {
    throw err('YAD-STATE-004', `${stepId} is owed as debt`,
      `a skip says nothing is owed, so it cannot close a debt — only passing ${stepId}-review does. Put it aside again with \`yad defer <epic> ${stepId} --reason "<why>"\`, which keeps the debt`);
  }
  if (!reason || !String(reason).trim()) {
    throw err('YAD-STATE-004', V.needsReason, `${V.reasonHint}, e.g. \`yad ${V.verb} <epic> ${stepId} --reason "<why>"\``);
  }
  // A skippable step must carry its paired `-review` gate — the change keeps BOTH in the chain. A
  // missing gate is a malformed chain; refuse rather than half-stamp only the author step.
  const ri = steps.findIndex((s) => s?.id === `${stepId}-review`);
  if (ri === -1) throw err('YAD-STATE-004', `malformed chain: ${stepId} has no ${stepId}-review gate`, 'restore state.json from git');
  const review = steps[ri];
  if (isAuthored(author)) {
    throw err('YAD-STATE-004', `${stepId} is already authored`, `cannot ${V.verb} a step whose artifact was already written`);
  }
  // An INHERITED author step is not authored here and not skippable either — its artifact belongs to
  // the parent epic. Without this it falls through to the review guard below and is refused for the
  // wrong reason ("its review has already opened"), sending someone to look for a review PR that was
  // never opened in this epic.
  if (claimsInherited(author)) {
    throw err('YAD-STATE-004', `${stepId} is inherited from ${author.inheritedFrom || 'the parent epic'}`,
      `a step carried by reference is already satisfied upstream — there is nothing here to ${V.verb}. Re-thread the change if it should be re-authored`);
  }
  // Once the review gate has opened (in_review / done), the work is effectively committed — setting it
  // aside then would orphan a live review PR. Refuse; the step is optional only up to authoring it.
  if (stepStatus(review) !== 'todo') {
    throw err('YAD-STATE-004', `cannot ${V.verb} ${stepId} — its review has already opened`, `${V.verb} ${stepId} before its review begins`);
  }
  // No step past the pair may have started. This used to name `stories`, which was right only because
  // `ui-design` was the one step any route marked optional and `stories` is what follows it. On a route
  // that marks `architecture` optional, the step after the pair is `ui-design`, and a literal `stories`
  // would let the skip through with ui-design already under way (E36).
  refuseHoleAfter(steps, ri, V.verb);
  const started = steps.slice(ri + 1).find(hasStarted);
  // A step RE-OPENED behind finished work (a late `yad undefer`, E41) may be deferred again: later work
  // is expected to have started — that is what re-opened it — and without this a mistaken late undefer
  // could not be undone. A skip stays refused there: the finished work was built without the step.
  if (started && !(as === 'deferred' && behindFinishedWork(steps, ai))) {
    throw err('YAD-STATE-004', `cannot ${V.verb} ${stepId} — ${started.id} is already '${started.status ?? '(no status)'}'`,
      `${V.verb} ${stepId} before ${started.id} begins`);
  }
  const stamp = V.stamp({ reason, by, at, debt });
  state.steps[ai] = { ...author, ...stamp };
  state.steps[ri] = { ...review, ...stamp };
  // If currentStep was on the pair we just set aside, move it to the next step not set aside.
  if (state.currentStep === stepId || state.currentStep === `${stepId}-review`) {
    const next = state.steps[firstLiveAfter(state.steps, ri)];
    if (next) {
      if (stepStatus(next) === 'todo') next.status = next.type === 'review+approve' ? 'in_review' : 'in_progress';
      state.currentStep = next.id;
    } else {
      state.currentStep = 'ready-for-build';
    }
  }
  return state;
}

// PURE. Put a set-aside step back: clear the stamp on the pair and restore the chain (`unskipStep`,
// `undeferStep`). Allowed while the step after the pair — the one setting it aside opened — is at most
// under way: once it is finished, or anything PAST it has started (on `classic`, once `stories` is done
// or `stories-review` opens), the chain has built on the step being absent, and it is too late.
// If every earlier step has passed, the restored author step becomes the active step again (and the
// downstream that was auto-opened is pushed back to `todo` behind it); otherwise it just returns to
// `todo`. Throws if the step is not set aside this way, or it is too late.
//
// FOR A DEFERRAL THERE IS NO CLOSING WINDOW (E41). For a skip the window is the meaning: stories finished
// on the assumption that there is no UI were built without one, so an un-skip after that is refused. A
// deferral promised to come back, so stories finished before the UI are expected. Once the chain has
// built past a deferred pair, `yad undefer` RE-OPENS it behind that work instead of refusing: the author
// step opens (or waits, if an earlier step has not passed), its gate goes to `todo`, and nothing after the
// pair and nothing about `currentStep` moves. The re-opened step then runs beside the chain — see
// `behindFinishedWork` for how `preconditionsMet`, `advanceState`, `markInReview` and `yad next` tell.
// This is also how DEBT is paid back: a debt is a deferral, and its flag stays on until the review passes.
function restoreStep(state, stepId, as) {
  // NO ROUTE GUARD HERE, and that asymmetry with `setAsideStep` is deliberate. Setting a step aside needs
  // the route's permission because it makes a gate pass without approvals. Putting it back only returns
  // a step to the chain — it can never let anything through, so refusing it has no safety value and one
  // real cost: `yad doctor`'s `skip:not-optional` names exactly the epics whose skip the route does not
  // allow, and its remedy is this command. With the guard, the one command the finding recommends was
  // the one command guaranteed to throw in the state that produced the finding.
  const V = SET_ASIDE[as];
  const steps = requireChain(state, `${V.undo} a step in`);
  const ai = steps.findIndex((s) => s?.id === stepId);
  if (ai === -1) throw err('YAD-STATE-004', `step '${stepId}' is not in this epic's chain`, `nothing to ${V.undo}`);
  if (!V.claims(steps[ai])) {
    const O = SET_ASIDE[otherWay(as)];
    throw err('YAD-STATE-004', `${stepId} is not ${as}`,
      O.claims(steps[ai]) ? `it is ${otherWay(as)} — put it back with \`yad ${O.undoCommand} <epic> ${stepId}\`` : `nothing to ${V.undo}`);
  }
  const ri = steps.findIndex((s) => s?.id === `${stepId}-review`);
  // The step after the pair may be under way — setting it aside opened it, and putting it back pushes it
  // back — but not FINISHED: a `done` step was authored while the set-aside step was absent (stories
  // written with no UI), and putting that step back would leave the work built without it standing as
  // complete. Work started on anything BEYOND it means the same. This used to be a literal
  // `stories-review` — the same rule read off the one route shape that existed (E36) — and asking only
  // past the step after the pair missed a finished `stories` whose review was then blocked.
  const tail = ri !== -1 ? ri : ai;
  refuseHoleAfter(steps, tail, V.undo);
  const j = firstLiveAfter(steps, tail);
  const after = steps[j];
  const beyond = (stepStatus(after) === 'done' ? after : null) || steps.slice(j + 1).find(hasStarted);
  const priorAllDone = steps.slice(0, ai).every((s) => isPassed(s));
  // Only when later work is FINISHED here (`behindFinishedWork`). Work that has merely started, or a status
  // this release cannot name, is not something to re-open beside — refuse, as before E41.
  if (beyond && as === 'deferred' && behindFinishedWork(steps, ai)) {
    // LATE RESUME (E41): re-open the pair behind the work built past it. `withoutSetAside` keeps `debt`,
    // which is still owed until the review passes.
    steps[ai] = { ...withoutSetAside(steps[ai]), status: priorAllDone ? 'in_progress' : 'todo' };
    if (ri !== -1) steps[ri] = { ...withoutSetAside(steps[ri]), status: 'todo' };
    return state;
  }
  if (beyond) {
    throw err('YAD-STATE-004', `cannot ${V.undo} ${stepId} — ${beyond.id} is already '${beyond.status ?? '(no status)'}'`,
      `${V.undo} before ${beyond.id} ${beyond === after ? 'is finished' : 'begins'} — the chain has built on the ${V.noun} since`);
  }
  steps[ai] = { ...withoutSetAside(steps[ai]), status: priorAllDone ? 'in_progress' : 'todo' };
  if (ri !== -1) steps[ri] = { ...withoutSetAside(steps[ri]), status: 'todo' };
  if (priorAllDone) {
    // The restored author step is the active step again. Push the downstream that was auto-opened back
    // to `todo` (it must wait behind the now-live step), whether it was opened as an author step
    // (`in_progress`) or a review gate (`in_review`).
    const afterState = stepStatus(after);
    if (afterState === 'in_progress' || afterState === 'in_review') after.status = 'todo';
    // Re-point currentStep here — EXCEPT when the epic EARNED `ready-for-build`: its `stories-review`
    // passed a review — `done` here, or `satisfied`, reviewed in the parent epic — and sits before this
    // step. A step restored after that gate runs beside Build the way `test-cases` does, and must not
    // pull the epic out of Build (`markInReview` keeps the same rule; `advanceState` names the same
    // gate). Anywhere else `ready-for-build` was reached by setting steps aside, and restoring the step
    // takes the claim back with it: on a chore lane whose stories pair was skipped by hand, keeping it
    // would leave "Build can run" over unapproved stories.
    const gate = steps.findIndex((s) => s?.id === 'stories-review');
    const earnedBuild = state.currentStep === 'ready-for-build' && gate !== -1 && gate < ai && ['done', 'satisfied'].includes(stepStatus(steps[gate]));
    if (!earnedBuild) state.currentStep = stepId;
  }
  return state;
}

// The four verbs. `yad skip` / `yad unskip` (E35, E36) say a step does not apply to this epic;
// `yad defer` / `yad undefer` (E37) say it does, later.
export function skipStep(state, stepId, opts) { return setAsideStep(state, stepId, 'skipped', opts); }
export function unskipStep(state, stepId) { return restoreStep(state, stepId, 'skipped'); }
export function deferStep(state, stepId, opts) { return setAsideStep(state, stepId, 'deferred', opts); }
export function undeferStep(state, stepId) { return restoreStep(state, stepId, 'deferred'); }

// PURE. Clear a recorded blocker once the wait is over (`yad unblock`, E37 — the E38 row gave this verb
// to E37). A `blocked` step is waiting on somebody outside the workflow, so nothing in the chain ever
// clears it; a person says the wait is over.
//
// STATUS AND RECORD GO TOGETHER. Deleting only the record would turn the step silently back into a
// `todo` (a `blocked` with no record IS the older spelling of `todo`), and moving only the status would
// leave a record explaining a wait that is over. So one write does both: an author step whose earlier
// steps have all passed goes back to `in_progress`, and anything else to `todo` — a review gate included,
// because opening a review is `yad gate open`'s job, not this verb's. `currentStep` is not touched: the
// chain already points wherever it pointed while the step was blocked.
//
// `state.json` only. A halted Build lane is `blocked` in `build-state/<story>.json`, and that file is
// the `yad-run` skill's: a write here would be undone by its next run (the E38 row).
export function unblockStep(state, stepId) {
  const steps = requireChain(state, 'unblock a step in');
  const i = steps.findIndex((s) => s?.id === stepId);
  if (i === -1) throw err('YAD-STATE-004', `step '${stepId}' is not in this epic's chain`, 'nothing to unblock');
  const step = steps[i];
  const st = stepStatus(step);
  if (st !== 'blocked') {
    // The one case worth its own sentence: `blocked` with no record is the pre-shape-7 word for "not
    // started". Nobody is being waited on, so there is no blocker to clear — and saying "not blocked"
    // about a step whose file says `blocked` would read as a bug.
    if (step.status === 'blocked') {
      throw err('YAD-STATE-004', `${stepId} has no blocker recorded`,
        'a `blocked` step with no `record` is the older spelling of `todo` — it is not waiting on anyone, so there is nothing to clear. `yad migrate --apply` rewrites the word to `todo` (on a verified project, the next gate write does)');
    }
    throw err('YAD-STATE-004', `${stepId} is not blocked`, `it is '${st ?? step.status ?? '(no status)'}' — nothing to unblock`);
  }
  const cleared = { ...step };
  delete cleared.record;
  const earlierPassed = steps.slice(0, i).every((s) => isPassed(s));
  cleared.status = earlierPassed && step.type === 'author' ? 'in_progress' : 'todo';
  steps[i] = cleared;
  return state;
}

// Mark a step in-review (idempotent) and point currentStep at it — EXCEPT once the epic is
// `ready-for-build`: the parallel `test-cases` track must not pull currentStep back (Build
// runs alongside the tester, and only the test-cases review is in flight at that point).
// `close` (E18): `{ by, date, pr?, hash? }` for the author step this closes, stamped via `review-opened`.
export function markInReview(state, step, close = null) {
  const i = state.steps.findIndex((s) => s.id === step.id);
  // A BLOCKED step is not opened by a review (E38). The blocker is not this workflow's to clear, so
  // writing `in_review` over `blocked` would drop the record naming who we are waiting on while
  // changing nothing about the wait — and `gate sync` reaches here on exactly the path where the
  // gate did NOT pass. It still reports what is missing; the step keeps saying why it cannot move.
  // `st &&` is the unknown-status case: a word this release cannot name belongs to the file (rule 3),
  // and writing `in_review` over it would be this function deciding what a newer release meant.
  const st = stepStatus(state.steps[i]);
  if (st && st !== 'blocked' && !isPassed(state.steps[i])) state.steps[i].status = 'in_review';
  // Opening a review gate means the artifact was authored — close the paired author step rather than
  // trusting the authoring skill to have hand-edited state.json (issue #131).
  // A BLOCKED review is not opened (above), so its author step is closed but not labelled `review-opened`.
  closeAuthorStep(state, step, close && st !== 'blocked' ? closingRecord({ ...close, via: 'review-opened' }) : null);
  // `currentStep` only moves FORWARD. Opening the review of a step re-opened behind finished work (E41)
  // must not point the chain back at it, just as the parallel `test-cases` track must not.
  const cur = state.steps.findIndex((s) => s?.id === state.currentStep);
  if (state.currentStep !== 'ready-for-build' && cur <= i) state.currentStep = step.id;
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
// below), seeding a chain from one is `yad epic new` (E17, cli/epic.mjs); how many approvals each step's
// gate ASKS FOR — the base enforced, the risk step reported and capped by the active people (E72) until
// E108 — is `gateRuleFor` and `gateCapFor` at the top of this file (E7, E62, E72), which read
// the `risk_tags` a seed copies from the row below into the epic's own `state.json`;
// the fuller step-state model is E38. The `skill` column stays here as the shipped DEFAULT, and a
// project overrides it in `.sdlc/skills.json` (E6, below) — E51 later slides a per-profile default
// between the two, once E50 can detect which skills are installed. Three of the five
// skills that used to hand-write a seed now run `yad epic new` instead (E17b), `yad-discovery` runs
// `yad foundation new` (E75), and `yad-change` runs `yad epic new --parent` for a threaded change-epic
// (E42).
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
//   level     'feature' (a step on the Epic ladder) or 'product' (the Foundation, `EP-foundation`, and
//             its older spelling `EP-discovery` — product-level, never on the feature lifecycle, and
//             placed in the Foundation phase, which belongs to no Part (E75)). This field was called
//             `chain` when E4 landed and was renamed before any release carried it — `chain` is the
//             word for an ordered LIST of steps, which is what a lifecycle profile holds (E5).
//   risk_tags the DEFAULT tags a seed gives this step, copied into the epic's `state.json` where a team
//             may add to them by hand. `architecture-review` carries `contract`, which does two separate
//             things: it marks the step escalated (`isEscalated`, so its review PR names the touched
//             repos), and it sets the step's E7 RISK STEP — `contract` +2,
//             `auth` / `payments` +1, nothing +0, the maximum across the tags and never their sum. The
//             rule that turns those tags into a number of approvals is `gateRuleFor`, at the top of this
//             file; it reads the epic's recorded tags, not this row.
//
// `spec` and `tasks` are two legs of the same yad-spec ceremony (run-loop.md) and share a skill; the
// chain renderer collapses the consecutive duplicate. `ready-for-build` and the other SENTINELS are
// not steps and are not here.
export const STEPS = [
  // Foundation — the Product level (E75). `yad-discovery` stays the skill name: renaming a skill folder
  // is its own change, with an install migration of its own (LEGACY_SKILLS), and it is not this one.
  { id: 'foundation', phase: 'foundation', kind: 'author', artifact: 'foundation/', skill: 'yad-discovery', level: 'product', risk_tags: [] },
  { id: 'foundation-review', phase: 'foundation', kind: 'review', artifact: 'foundation/', reviews: 'foundation', level: 'product', risk_tags: [] },
  // The OLD spelling of the same level, kept for this whole major (rule 3): a project that has not
  // converted still carries these ids, and dropping the rows would report every step of it as
  // `phase:unknown`. They move into the Foundation phase with the level they always were.
  { id: 'discovery', phase: 'foundation', kind: 'author', artifact: 'discovery/', skill: 'yad-discovery', level: 'product', risk_tags: [] },
  { id: 'discovery-review', phase: 'foundation', kind: 'review', artifact: 'discovery/', reviews: 'discovery', level: 'product', risk_tags: [] },
  // Discover
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
// THE FIRST THREE WERE NOT NEW ROUTES. They predate this table — they were seeded by hand, in five
// skill files, until `yad epic new` took over the two feature ones. `yad-analysis`'s own description already calls them "the 12-step chain" and "the 10-step
// chain". E5 wrote them down in one place and checks projects against them; it did not change what
// any epic does, and nothing here is written to disk.
//
//   classic         the 10-step chain, seeded by yad-epic, yad-stub and yad-change. `epic` first.
//   analysis-first  the 12-step chain, seeded by yad-analysis, which puts `analysis` before `epic`
//                   when a feature is shaped by the analyst before it becomes an epic.
//   chore           the upkeep lane (E40). Four steps: `epic` then `stories`.
//   spike           the investigation lane (E40). Six steps: `analysis` in front of the chore lane.
//   discovery       the product front-zero (`EP-discovery`), two steps and no Build. The OLD spelling
//                   of the Product level, still read for this major; `yad migrate` converts it.
//   foundation      the Product level (E75), `EP-foundation` in `foundation/`. Two steps, no Build.
//
// THE SHORT LANES ARE NEW, and they are the first routes here that nobody has ever walked. E40 adds
// them because the engine had exactly one shape of work: until now a dependency bump was seeded on the
// same 10-step chain as a payments rewrite, and the way through was to skip steps — which `classic`
// does not permit, since only `ui-design` is optional on it. Making the whole chain optional to fit
// upkeep would have made it optional for everything. A shorter ROUTE says the same thing honestly, and
// says it once, at seed time, where a person chooses it.
//
// WHAT THE TWO LANES DROP, and why each is ABSENT rather than `optional`. An optional step stays in
// the chain, pre-marked done with a recorded reason (E35) — that is the right shape for a step the
// route genuinely has and this epic happens not to need. A step the route never has is not that:
// writing `ui-design` into the chore lane as optional would make every chore epic carry a skip record
// for a screen nobody was ever going to draw, and the audit trail would fill with noise that means
// nothing.
//
//   architecture / architecture-review   Both lanes drop them, and dropping the architecture gate
//       drops the CONTRACT with it — no `contract.md`, no `contract-lock.json`. That is the point:
//       these lanes are for work that does not move the shared cross-repo surface. Work that does move
//       it belongs on `classic`, whatever its size. `yad doctor`'s contract-lock check is silent on an
//       epic with no lock file, which is the normal pre-lock state and also the permanent state here.
//       The gap this leaves in the check gates is written up on the E40 row of the roadmap.
//   ui-design / ui-design-review         `chore` is "upkeep, no user-visible change" by the
//       definition of the work-item type, so there is no screen; a spike's prototype is thrown away,
//       so designing one would be work the lane exists to avoid.
//   test-cases / test-cases-review       Neither lane introduces behaviour to pin. A chore must not
//       change what the product does, and a spike's output is a finding, not a shipped feature. The
//       tests that guard the code a chore touches already exist and its Build gates still run them.
//
// WHAT NEITHER LANE DROPS is `epic` / `epic-review` and `stories` / `stories-review`, and that is not
// a matter of taste. `epic.md` is where the work-item type and the `parent:` lineage are authored —
// `workItemType` reads it, `lineage-check.sh` reads it inside the user's repo, and `yad thread` skips
// an epic that has none entirely, so a lane without it would produce work that is invisible to every
// rollup. `stories` is what tags the repos Build runs in, and `stories-review` is the step
// `advanceState` turns into `ready-for-build`. A lane ending anywhere else would leave `currentStep`
// at a sentinel claiming a Build that has nothing in it.
//
// WHY `spike` IS `chore` PLUS `analysis`. The distinction is whether the answer is known. A chore is
// upkeep somebody has already decided on: bump the dependency, move the CI job. A spike is a
// timeboxed investigation — the analyst's brief is the first artifact because reducing the
// uncertainty IS the work. Everything after that is the same short route, which is why one is a
// strict ordered subset of the other. `matchLifecycleProfile` breaks the resulting tie on the shorter
// route, so a chore-shaped chain reads as `chore` and not as a spike that skipped its analysis.
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
    id: 'chore',
    title: 'the upkeep lane',
    level: 'feature',
    steps: [
      'epic', 'epic-review',
      'stories', 'stories-review',
    ],
  },
  {
    id: 'spike',
    title: 'the investigation lane',
    level: 'feature',
    steps: [
      'analysis', 'analysis-review',
      'epic', 'epic-review',
      'stories', 'stories-review',
    ],
  },
  {
    id: 'discovery',
    title: 'the product front-zero',
    level: 'product',
    steps: ['discovery', 'discovery-review'],
  },
  {
    id: 'foundation',
    title: 'the Product Foundation',
    level: 'product',
    steps: ['foundation', 'foundation-review'],
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

// ---- the routes shape 6 may stamp, frozen ---------------------------------------------------------
//
// The three routes that existed the day shape 6 landed, written out BY ID rather than derived, which
// is the whole point: a list computed from `LIFECYCLE_PROFILES` would grow every time a route is
// added, and then it would not be frozen. `stampProfile` explains what breaks without this.
//
// Adding a route NEVER belongs here, and the reason is NOT that nothing new can reach the stamper —
// `writeState` runs it on every save, so a chain hand-written today with no `profile` key is stamped
// the same as one from before the field existed. It is that shape 6 is a fixed question with a fixed
// answer: "which of the routes that existed when this shape landed is this chain on". A chain that is
// really on a newer route and says nothing gets the closest OLD answer, and `yad doctor` reports the
// disagreement — which is a label to correct, not a migration to rewrite. The only edit this list ever
// takes is a future shape adding its OWN frozen list beside it, never a line appended to this one.
export const SHAPE_6_ROUTE_IDS = ['classic', 'analysis-first', 'discovery'];

// Filtered rather than rebuilt, so the frozen set carries each route's REAL rows. Writing the three
// chains out again here would be a second copy of `classic` free to drift from the first, and it would
// drift silently: shape 6 would keep stamping against a chain nobody maintains.
//
// A route named here that this release no longer carries simply drops out RATHER THAN THROWING: a
// removed route is not one a chain can be matched onto, and a migration is the worst place to raise on
// a condition the user cannot act on. The silent shrink is still a bug in the release that caused it —
// shape 6 would quietly stop placing chains it used to place — so `cli/test-migrate.mjs` asserts every
// id here still resolves. Tolerated at runtime, caught in CI; the two are not in tension.
export const shape6Routes = (profiles = LIFECYCLE_PROFILES) =>
  profiles.filter((p) => SHAPE_6_ROUTE_IDS.includes(p.id));

// ---- which steps an epic may skip (E35) ----------------------------------------------------------
//
// A step may be marked N/A ("skipped") when the epic does not need it. UI-design is the only step any
// route marks optional today, and only `classic` and `analysis-first` mark it: an epic with no
// user-facing surface (backend/API, data, infra) can skip it. The short lanes mark NOTHING optional —
// they left the steps they do not need out of the chain instead, which is a different mechanism with a
// different audit trail, so "this epic has no optional steps" no longer implies its chain is broken
// (see `notOptional`). A skip carries a recorded reason and stays VISIBLE in the chain — both the author step and its review gate
// pre-marked `done`, short-circuited by `gatePredicate` — the auditable, reversible counterpart to
// omitting `analysis` from the chain entirely.
//
// IT IS A FACT ABOUT THE ROUTE, NOT ABOUT THE ENGINE. Until E35 this was one module-level set, the
// union of every route's `optional` marks, and it answered the same for every epic in the project.
// That is wrong the moment two routes disagree, and E40 made them disagree in the sharper of the two
// possible ways. A union across routes answers with every route's marks pooled, so the moment ANY
// route marked a step optional, every epic in the project could skip it — silently, because a union
// never says which route its answer came from. The short lanes are the opposite case and still break
// it: they mark nothing, so pooling would hand a `chore` epic `classic`'s optional `ui-design` and let
// it skip a step its chain does not even contain.
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

// ---- "this epic's route never had that step" — ONE rule, three readers (E40) -----------------------
//
// Asked by `yad next`'s phase line, by the review-PR checklist, and by the thread's artifact-ownership
// map. All three used to work it out from the CHAIN, and all three were wrong in the same way.
//
// A CHAIN IS ALLOWED TO BE SHORT WITHOUT ITS ROUTE BEING SHORT. Every hand-written and pre-shape-6
// ledger is a truncated `classic` — `matchLifecycleProfile` says as much ("a chain seeded before a
// step existed simply lacks it"), and this repo's own e2e fixtures are `[epic, epic-review]`. Reading
// "no `architecture` row" as "this route has no architecture step" tells a `classic` epic it is on a
// short lane, and strips a legacy epic of artifacts that are sitting on its disk. Inventing an owner
// and losing one are the same error.
//
// So the answer comes from the RECORDED route and nothing else, and it is deliberately conservative:
// FALSE unless the epic itself says which route it is on AND this release carries that route AND that
// route has no such step. No key, an unknown key, or an unreadable ledger all mean "assume it has the
// step", which is the answer every one of these readers gave before the short lanes existed.
//
// This is narrower than `epicProfileId`, on purpose. A best-available guess is right for deciding what
// a step MAY skip — a wrong guess there is a refusal a person immediately sees. It is not right for a
// silent claim about an epic's future or its provenance, where a wrong guess is believed.
//
// A SKIPPED STEP IS NOT A MISSING ONE, and asking the route rather than the chain gets that for free:
// `ui-design` skipped on `classic` is still a step the route has, so the epic still owns the decision.
// That is the distinction E35 exists to draw, and it needs no special case here.
export const routeLacksStep = (state, stepId, profiles = LIFECYCLE_PROFILES) => {
  const recorded = String(state?.profile || '');
  const route = profiles.find((p) => p.id === recorded);
  return !!route && !profileRows(route).some((r) => r.id === stepId);
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
// The two PRODUCT routes, `foundation` and its old spelling `discovery`, are excluded because the
// Product level is not a work item on the Epic ladder. Its ledger carries a top-level `kind` marker the
// engine keys off, its id is fixed, and it has no `epic.md` and therefore no work-item type. A seed that
// produced its chain without those would be a broken product level, not a plain one — so the command
// refuses both and sends the user to `yad foundation new` (`seedFoundationState`, below).
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
  const steps = seedChain(p, { stub });
  // Key order mirrors what the stampers produce, so a seeded file and a migrated one are the same
  // bytes. `schemaVersion` is deliberately absent: `writeJSON` stamps this engine's shape onto an
  // object that was never read from disk (writeShape, cli/lib.mjs), and naming the number here would
  // be a second place to forget to change.
  // `kind` sits between `type` and `profile`, which is where the `yad-stub` template has always put it
  // and where `stampProfile` would insert on a stub that lacked one. The two words look alike and are
  // different axes: `kind` is the LIFECYCLE marker (`stub`, `foundation`), `type` is the work item.
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

// The routes that seed the PRODUCT level. A separate predicate rather than a loosened
// `seedableProfiles`: a product route has a fixed id, a `kind` marker and no work-item type, so letting
// `seedState` produce one would mint a product level missing all three.
export const productProfiles = (profiles = LIFECYCLE_PROFILES) =>
  profiles.filter((p) => p.level === 'product').map((p) => p.id);

// The Foundation's `state.json` (E75) — what `yad foundation new` writes. PURE, like `seedState`.
//
// Only the `foundation` route is seeded. `discovery` is a product route too, and it is the OLD
// spelling: this release reads it and converts it, and writing a fresh one would be minting the very
// ledger `yad migrate` exists to retire.
//
// No `type`: the Foundation is not a work item on the ladder, and inventing `feature` for it would put
// a thing on the ladder nobody authored — the same reason `stampWorkItemType` leaves it alone.
export function seedFoundationState({ today }) {
  const steps = seedChain(lifecycleProfile('foundation'));
  return {
    epicId: FOUNDATION_EPIC,
    createdAt: today,
    kind: 'foundation',
    profile: 'foundation',
    currentStep: steps[0].id,
    steps,
  };
}

// The step rows a seed writes, off a profile and the catalogue — shared by the feature and product
// seeds so the two cannot drift in field order, dial names or statuses.
function seedChain(p, { stub = false } = {}) {
  return p.rows.map((row, i) => {
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
      // `todo`, not `blocked` (E38). This is the engine's own seed, so it writes the model's word
      // for "not started" directly — `blocked` now means "cannot proceed, not our choice", and a
      // freshly seeded chain is not waiting on anybody.
      status: !stub && i === 0 ? 'in_progress' : 'todo',
      risk_tags: [...def.risk_tags],
    };
  });
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
// which skills a team has installed and which harness they run. E3 deleted the BMAD personas from the
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
  const boundTo = (id) => (isPlainObject(steps) && Object.hasOwn(steps, id) ? steps[id] : null);
  const bound = boundTo(stepId);
  if (Array.isArray(bound) && bound.length) return [...bound];
  // A step that took over from an OLD id inherits the old id's binding until it is given one of its
  // own (rule 3). A project that bound its own skill to `discovery` before E75 renamed the product
  // step to `foundation` would otherwise be switched back to the default without anyone deciding it.
  const legacy = Object.hasOwn(BINDING_SUCCEEDS, stepId) ? boundTo(BINDING_SUCCEEDS[stepId]) : null;
  if (Array.isArray(legacy) && legacy.length) return [...legacy];
  const fallback = CATALOGUE_SKILL[stepId];
  return typeof fallback === 'string' ? [fallback] : [];
}

// new step id -> the old step id whose binding it inherits while it has none of its own.
const BINDING_SUCCEEDS = { __proto__: null, foundation: 'discovery' };

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

// The PRODUCT level's phase (E75). Kept out of `PHASES` on purpose, because the roadmap's two levels
// are two different ladders: a feature epic walks the six phases above, once per epic, and the
// Foundation runs once per product, before any of them. It belongs to no Part — Shape, Build and Run
// are the rhythms of FEATURE work — so it has no `part`, and a renderer printing the six-phase strip
// for a Foundation would claim a journey it never takes.
export const PRODUCT_PHASES = [
  { id: 'foundation', name: 'Foundation', level: 'product', built: true },
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
export const SENTINELS = ['ready-for-build', 'backfill-pending', 'backfill-done', 'discovery-done', 'foundation-done'];

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
//   * The PRODUCT level (`EP-foundation`, or its old spelling `EP-discovery`) is not a work item on the
//     feature ladder. It is in the Foundation phase for its whole life — while authoring, in review,
//     and once its `-done` sentinel is reached — and it never enters Design, Plan or Build. So the
//     answer is decided by the LEVEL, which the caller knows from the ledger's `kind`, and not by the
//     step id: a sentinel has no phase of its own, and asking `stepPhase` would lose the Foundation the
//     moment it was approved.
//
// A stub epic (`backfill-pending` / `backfill-done`) has no phase either, and needs no special case:
// neither marker is a step.
export function currentPhase(currentStep, { product = false } = {}) {
  if (product) return 'foundation';
  const cur = String(currentStep || '');
  if (cur === 'ready-for-build') return 'build';
  return stepPhase(cur);
}

// The phase record for an epic's current step, or null. `.name` is the word a person reads. Both
// ladders are searched: a Foundation step placed by `stepPhase` alone must still name its phase.
export const phaseOf = (currentStep, opts) =>
  [...PHASES, ...PRODUCT_PHASES].find((p) => p.id === currentPhase(currentStep, opts)) || null;

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
  // A whole lane SKIPPED (E39): nothing to drive and nothing shipped. A lane on disk carries a `status` only
  // when it is skipped; this RESULT always has a `status`, so the skip reuses that key, and `record` is added
  // ONLY here, which keeps a frozen v3 lane's output byte-identical. The word is honoured only over a lane
  // with no work in it (`laneStarted`): `skipped` beside real steps — a hand edit, or an older `yad-run`
  // filling in what looked like a half-seeded lane — is read as the work, and `yad doctor` fails the file.
  if (repoState?.status === 'skipped' && !laneStarted(repoState)) {
    return { step: null, status: 'skipped', shipped: false, skill: null, automation: null, locked: false, chain: [],
      ...(isPlainObject(repoState.record) ? { record: repoState.record } : {}) };
  }
  const steps = Array.isArray(repoState.steps) ? repoState.steps : [];
  const byId = new Map(steps.map((s) => [s.id, s]));
  // Empty/half-seeded file ⇒ unknown (not-started), NEVER shipped. Every step done ⇒ shipped.
  if (!steps.length) {
    return { step: null, status: 'unknown', shipped: false, skill: null, automation: null, locked: false, chain: [] };
  }
  if (steps.every((s) => isPassed(s))) {
    return { step: null, status: 'done', shipped: true, skill: null, automation: null, locked: false, chain: [] };
  }
  // Active = the orchestrator's currentStep when it isn't already done, else the first not-done step
  // (guaranteed to exist here — not every step is done). currentStep authority, with a done-step skip.
  const cur = byId.get(repoState.currentStep);
  const active = cur && !isPassed(cur) ? cur : steps.find((s) => !isPassed(s));
  // The remaining chain: the active step + every later step in the canonical order, mapped to skills.
  const from = BUILD_STEP_ORDER.indexOf(active.id);
  const tail = from === -1 ? [active.id] : BUILD_STEP_ORDER.slice(from);
  const chain = dedupeConsecutive(tail.flatMap((id) => stepSkills(id, bindings)));
  return {
    step: active.id,
    // The CANONICAL state (E38), so a Build lane reports itself in the same vocabulary as a Shape
    // step. `build-state/<story>.json` is written by the `yad-run` / `yad-implement` skills and is
    // deliberately not migrated, which cuts two ways here: a lane HALTED by those skills is `blocked`
    // with a record and reports itself that way, while one halted by an older yad-run carries a bare
    // `blocked` — the pre-shape-7 spelling of "not started" — and reads as `todo` until the next run
    // rewrites it. Nothing advances past it either way (`isPassed` is false for both), so what the
    // record buys is the word. A step with no status at all is `todo` for the same reason, and a word
    // this release cannot name falls through to itself rather than being renamed to something it is not.
    status: stepStatus(active) || active.status || 'todo',
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
    const ok = stepId === 'epic' || stepId === 'analysis' || stepId === 'foundation' || stepId === 'discovery';
    return { ok, blockedBy: null, reason: ok ? 'entry step (no state seeded yet)' : `start with yad-epic — no epic state for '${stepId}'` };
  }
  // A stub anchor (backfill-pending) or a light-promoted anchor (backfill-done) has NO runnable Shape
  // step: its Shape chain is intentionally left un-started — `todo` since shape 7, `blocked` in every
  // file written before it, which reads as the same thing. It evolves via `yad-backfill promote` / a
  // threaded `yad-change`, never by authoring `epic` against the anchor itself — so the precondition
  // guard must not green-light one (its un-started steps would otherwise read as "entry step ready").
  const anchorKind = backfillAnchorKind(state);
  if (anchorKind) {
    const anchor = anchorKind === 'documented';
    return { ok: false, blockedBy: null,
      reason: anchor
        ? `${stepId} is not runnable — this is a documented backfill anchor; evolve it with yad-change`
        : `${stepId} is not runnable — this is a stub (backfill pending); run yad-backfill then promote, or thread a change with yad-change` };
  }
  const i = state.steps.findIndex((s) => s.id === stepId);
  // TWO WAYS A STEP IS NOT IN THE CHAIN, and they read very differently to a person. Before E40 the
  // only one was a typo or an id from a newer release, so "unknown step" covered it. A short lane
  // makes the other one ordinary: `architecture` is a step the catalogue knows perfectly well and this
  // epic's ROUTE does not carry. Telling someone their step is unknown when `yad skill list` shows it
  // sends them looking for a misspelling that is not there.
  if (i === -1) {
    const known = !!stepDef(stepId);
    const route = epicProfileId(state);
    return { ok: false, blockedBy: null,
      reason: known
        ? `${stepId} is not on this epic's route${route ? ` (\`${route}\`)` : ''} — the step exists, this chain does not carry it`
        : `unknown step '${stepId}'` };
  }
  // Name the state that finished it. `yad next --check ui-design` answering "already done" for a deferred
  // step would tell somebody the UI exists (E37).
  if (isPassed(state.steps[i])) return { ok: false, blockedBy: null, reason: `${stepId} is already ${stepStatus(state.steps[i])}` };
  // A step re-opened BEHIND finished work (E41) is not a blocker of anything past that work: it runs
  // beside the chain. It still blocks the steps between it and that work, its own gate included.
  const blocker = state.steps.slice(0, i).find((s, b) => !isPassed(s) && !behindFinishedWork(state.steps, b, i));
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
    // `=== 'done'` on the gate, `isPassed` on the author, and the asymmetry is the rule itself: only a
    // gate that genuinely COMPLETED here implies its artifact was written. A skipped or satisfied gate
    // pairs with a skipped or satisfied author and is no violation — and `deferred` (E37) is the one
    // that makes this load-bearing rather than theoretical, because it is a PER-STEP state with no
    // pairing rule. `isPassed` here would read a deferred gate above a `todo` author as a violation,
    // and `repairState` below would then stamp that author `done` — claiming an artifact nobody wrote.
    if (step.type !== 'review+approve' || stepStatus(step) !== 'done') continue;
    const author = authorStepFor(state, step);
    if (!author || isPassed(author)) continue;
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
// `close` (E18): `{ by, date }`. A repair is an escape hatch, so the step it closes says so (rule 7).
export function repairState(state, close = null) {
  const closed = [];
  for (const v of stateInvariants(state)) {
    const author = state.steps.find((s) => s.id === v.authorStep);
    if (author && !isPassed(author)) {
      author.status = 'done';
      if (close) stampClosed(author, closingRecord({ ...close, via: 'repair' }));
      closed.push(author.id);
    }
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
//
// Two keys are added only when they have something in them, so an epic with neither prints exactly the
// JSON it printed before (the golden test deep-equals it):
//   reopened — a lane per step re-opened behind finished work (E41), each shaped like an action
//   debt     — the steps still owed as debt (`owedSteps`), the reminder that repeats until they are paid
export function nextAction(ledger, opts = {}) {
  const a = shapeNextAction(ledger, opts);
  const state = ledger?.state;
  if (!state || !Array.isArray(state.steps) || isProductLevel(state) || backfillAnchorKind(state)) return a;
  const lanes = reopenedLanes(ledger, { epicId: a.epicId, currentStep: state.currentStep, bindings: opts.bindings ?? null });
  const debt = owedSteps(state).map((s) => ({ step: s.id, status: stepStatus(s) ?? s.status, record: s.record || null }));
  return { ...a, ...(lanes.length ? { reopened: lanes } : {}), ...(debt.length ? { debt } : {}) };
}

// The steps still OWED AS DEBT (E41): flagged `debt: true` and not yet written here. One entry per pair —
// the author step while it is unfinished, then its gate — so one `yad defer --debt` reads as one debt.
export function owedSteps(state) {
  if (!isPlainObject(state) || !Array.isArray(state.steps)) return [];
  const open = state.steps.filter((s) => isPlainObject(s) && typeof s.id === 'string' && s.debt === true && stepStatus(s) !== 'done');
  const ids = new Set(open.map((s) => s.id));
  return open.filter((s) => !(s.id.endsWith('-review') && ids.has(s.id.replace(/-review$/, ''))));
}

// Is this step open again BEHIND finished work (E41)? For the words a command prints after `yad undefer`.
export function isReopenedStep(state, stepId) {
  const steps = Array.isArray(state?.steps) ? state.steps : [];
  const i = steps.findIndex((s) => s?.id === stepId);
  return i !== -1 && !isPassed(steps[i]) && behindFinishedWork(steps, i);
}

// A lane for each step re-opened behind finished work (E41) that can be worked on now — the same three
// actions a chain step gets (author it, open its review, sync its review) or the blocker it waits on.
function reopenedLanes(ledger, { epicId, currentStep, bindings }) {
  const { steps } = ledger.state;
  return steps.filter((s, b) => isPlainObject(s) && s.id !== currentStep && !isPassed(s)
      && behindFinishedWork(steps, b) && preconditionsMet(ledger.state, s.id).ok)
    .map((s) => {
      if (stepStatus(s) === 'blocked') return { step: s.id, kind: 'blocked', status: 'blocked', record: s.record || null };
      if (s.type === 'author') return { step: s.id, kind: 'author', status: s.status, ...skillFields(stepSkills(s.id, bindings)), artifact: s.artifact };
      const pr = (ledger.hubPrs || []).find((p) => artifactBase(p.artifact) === artifactBase(s.artifact));
      return { step: s.id, kind: pr ? 'review-sync' : 'review-open', status: s.status, artifact: s.artifact, pr: pr ? pr.number : null,
        command: `yad gate ${pr ? 'sync' : 'open'} ${epicId} ${s.artifact}` };
    });
}

function shapeNextAction(ledger, { epic, bindings = null } = {}) {
  const state = ledger?.state;
  const epicId = epic || state?.epicId || null;
  // No ledger yet: the action is to author the `epic` step, so it names whatever runs that step here.
  if (!state) return { epicId, kind: 'new', ...skillFields(stepSkills('epic', bindings)), why: 'no epic state yet — seed it with yad-epic' };

  // The PRODUCT level — the Foundation, or a ledger still in its old `discovery` spelling: a 2-step
  // author→review chain with no Build part and no parallel track. Resolve its action in isolation so
  // the feature-epic logic below never applies to it. Each spelling reports its own `-done` kind, so a
  // script reading `yad next --json` on an unconverted project sees exactly the word it saw before.
  if (isProductLevel(state)) {
    const done = `${state.kind}-done`;
    const label = state.kind === 'foundation' ? 'Foundation' : 'discovery';
    if (state.currentStep === done) {
      return { epicId, kind: done, step: done, status: 'done',
        why: `${label} approved — seed feature epics with yad-epic (each reads roadmap.md)` };
    }
    const dstep = state.steps.find((s) => s.id === state.currentStep)
      || state.steps.find((s) => !isPassed(s));
    if (!dstep) return { epicId, kind: done, step: done, why: `${label} is done` };
    // The same refusal the feature path makes below: a BLOCKED step is not a step to run, and naming
    // its skill would tell someone to author an artifact that is waiting on somebody else.
    if (stepStatus(dstep) === 'blocked') {
      const reason = dstep.record?.reason;
      return { epicId, kind: 'blocked', step: dstep.id, status: 'blocked', record: dstep.record || null,
        why: `${dstep.id} is blocked${reason ? ` — ${reason}` : ' — no reason recorded'}` };
    }
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
  const tcState = stepStatus(tc);
  const tcOpen = tcState === 'in_progress' || tcState === 'in_review';
  const parallel = tcOpen
    ? { step: 'test-cases', ...skillFields(stepSkills('test-cases', bindings)), artifact: tc.artifact }
    : null;

  if (state.currentStep === 'ready-for-build') {
    // Once stories enter Build, surface each story/repo's CONCRETE next sub-step (spec →
    // implement → checks → engineer-review) from build-state, not one static "run Build" hint.
    const builds = buildNextActions(ledger?.buildStates || [], { bindings });
    const lanes = builds.flatMap((b) => b.repos);
    const open = lanes.filter((r) => !r.shipped && r.status !== 'skipped');
    if (builds.length) {
      let why;
      if (!lanes.length) why = 'Build started — no repo lanes recorded yet';
      // Every recorded lane SKIPPED and none shipped (E39 review): a skip written before Build began creates
      // the build-state file on its own, and "every lane is shipped or skipped" would call Build finished at
      // its first step. Nothing has started, so say what was said before the skip.
      else if (!open.length && !lanes.some((r) => r.shipped)) why = 'Shape approved — Build can run (every recorded lane is skipped; nothing has started)';
      // The first wording is frozen golden bytes; the second is said only when a lane was skipped (E39).
      else if (!open.length) why = lanes.some((r) => r.status === 'skipped') ? 'Build — every story/repo lane is shipped or skipped' : 'Build — every story/repo lane is shipped';
      else why = `Build in progress — ${open.length} story/repo lane(s) still moving`;
      return { epicId, kind: 'build', step: 'ready-for-build', status: 'ready-for-build', parallel, builds, why };
    }
    return { epicId, kind: 'build', step: 'ready-for-build', status: 'ready-for-build', parallel,
      why: 'Shape approved — Build can run' };
  }

  const step = state.steps.find((s) => s.id === state.currentStep)
    || state.steps.find((s) => !isPassed(s));
  if (!step) {
    const builds = buildNextActions(ledger?.buildStates || [], { bindings });
    return { epicId, kind: 'build', step: 'ready-for-build', parallel,
      builds: builds.length ? builds : undefined, why: 'all Shape steps are done' };
  }

  // A genuinely BLOCKED step (E38) is not a step to run. `skipped`, `deferred` and `satisfied` all
  // read as passed, so this resolver never lands on one; `blocked` is the only recorded state that
  // stops the chain, and naming its skill would tell someone to author an artifact that is waiting on
  // a third party. The record is the one place that says on whom or what, so it is what gets printed.
  if (stepStatus(step) === 'blocked') {
    const reason = step.record?.reason;
    return { epicId, kind: 'blocked', step: step.id, status: 'blocked', parallel,
      record: step.record || null,
      why: `${step.id} is blocked${reason ? ` — ${reason}` : ' — no reason recorded'}` };
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

// The catalogue step that PRODUCES each base. `contract` has no step of its own — `contract.md` is
// authored by the architecture step, which `artifactFromBase` already says — so both map to it.
//
// Needed because `inherits` answers only half the question. It says "I did not re-author this", which
// on every route that HAS the step means "I authored it myself". E40's short lanes break that: a
// `chore` epic has no architecture step, never writes `inherits:`, and so claimed to be the
// authoritative source for `architecture`, `contract`, `ui-design` and `test-cases` — four files that
// will never exist. `yad thread` printed it, and `yad-change` reads exactly that map to choose what a
// threaded defect inherits from, so the false claim became a forged `inheritedFrom`.
const BASE_STEP = {
  epic: 'epic', architecture: 'architecture', contract: 'architecture',
  'ui-design': 'ui-design', stories: 'stories', 'test-cases': 'test-cases',
};

// Does this epic's chain carry the step that produces this base? Answered through `routeLacksStep`,
// which is the ONE rule for "this epic's route never had that step" — see it for why the recorded
// route is asked and the chain is not.
const chainHasBase = (root, id, base) => {
  const step = BASE_STEP[base];
  if (!step) return true;
  let state;
  // THE STRICT-READ THROW IS CAUGHT ON PURPOSE, which is the opposite of what a ledger WRITE does.
  // `writeState` and the gate read strictly and refuse, because a read-modify-write against a file
  // they cannot parse destroys the contents. This is a pure read feeding a provenance display, and
  // `yad thread` is exactly the command someone runs to inspect a project that is already damaged —
  // crashing it on the corrupt file takes away the tool they are holding. `yad doctor` reports the
  // corruption, and still does. Before this rule the function never opened `state.json` at all, so
  // failing closed here would also be a new way for a read-only command to die on an old project.
  try { state = readJSONStrict(path.join(epicRoot(root, id), '.sdlc', 'state.json'), null); } catch { return true; }
  return !routeLacksStep(state, step);
};

// The owning epic per artifact base across a thread. REPLACE bases resolve to a single epic id (the
// latest re-author); ADDITIVE bases resolve to the ordered LIST of every epic that re-authored them
// (genesis-first) — use resolveCurrentStories for story-id-level ownership of the composed set.
export function resolveCurrentArtifacts(root, threadOrEpicId) {
  return ownersAlong(root, threadEpics(root, threadOrEpicId)); // genesis-first
}

// The same map over an explicit genesis-first list of epics. `resolveCurrentArtifacts` passes the whole
// thread; the threaded seed (E42) passes only the PARENT'S line, because a sibling branch off the same
// genesis is not something the new epic builds on.
function ownersAlong(root, members) {
  const out = {};
  for (const b of REPLACE_BASES) out[b] = null;
  for (const b of ADDITIVE_BASES) out[b] = [];
  for (const id of members) {
    const { inherits } = epicLineage(root, id);
    // Two conditions, not one: this epic did not inherit the base AND its chain carries the step that
    // produces it. An epic on a route without that step authored nothing to own.
    for (const b of REPLACE_BASES) if (!inherits.includes(b) && chainHasBase(root, id, b)) out[b] = id;
    for (const b of ADDITIVE_BASES) if (!inherits.includes(b) && chainHasBase(root, id, b)) out[b].push(id);
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

// ---- threading a change-epic off its parent (E42) -----------------------------------------------
//
// Rule 5: you may skip AUTHORING a contract, never skip HAVING one. A change that does not move the
// surface carries its parent's contract by reference — a pointer-lock holding the parent's hash
// verbatim — instead of writing a second copy. Until E42 that chain was hand-written by the
// `yad-change` skill. This is the engine writing it.
//
// WHAT IS DECIDED HERE AND WHAT IS NOT. Which bases a change inherits is the depth triage, a judgement
// made with a person, and it stays in the skill. This takes the OUTCOME of that triage (`inherits`) and
// writes the ledger it implies, refusing every outcome the ledger could not honestly record.

// The bases a change may carry by reference. The REPLACE bases, where one epic owns the current copy.
// `stories` and `test-cases` are ADDITIVE — the thread's set is the union of every contributor, so
// there is no single owner to bind a hash to — and every depth re-authors both anyway: `stories-review`
// is the step that hands the epic to Build, so a change that inherited it would have nothing to build.
export const INHERITABLE_BASES = ['epic', 'architecture', 'contract', 'ui-design'];

// The chain steps each base carries. `analysis` rides with `epic`: it is the brief the epic was written
// from, it has no base of its own, and re-running it under a carried epic would review a brief for a
// decision already made. `contract` has no step — the architecture step writes `contract.md`.
const INHERIT_STEPS = { epic: ['analysis', 'epic'], architecture: ['architecture'], contract: ['architecture'], 'ui-design': ['ui-design'] };

const LOCK_HASH = /^sha256:[0-9a-f]{64}$/;

// Plan the ledger of a change-epic threaded off `parent`. Reads the Product; writes nothing.
// Returns `{ ok: false, message, hint }` or `{ ok: true, state, approvals, lock, profile, owners, anchor, thread }`.
export function planThreadedSeed(root, { epic, parent, inherits = [], type, today }) {
  const refuse = (message, hint) => ({ ok: false, message, hint });
  const bases = [...new Set(inherits.map((b) => String(b).trim()).filter(Boolean))];

  const unknown = bases.filter((b) => !THREAD_ARTIFACT_BASES.includes(b));
  if (unknown.length) {
    return refuse(`unknown base in inherits: ${unknown.join(', ')}`,
      `a change carries some of ${INHERITABLE_BASES.join(' · ')}`);
  }
  const additive = bases.filter((b) => !INHERITABLE_BASES.includes(b));
  if (additive.length) {
    return refuse(`${additive.join(' and ')} cannot be inherited`,
      'every change writes its own stories and test cases: the thread\'s set is the union of every epic that wrote some, and `stories-review` is what hands an epic to Build. Leave them out of inherits');
  }
  if (bases.includes('architecture') !== bases.includes('contract')) {
    return refuse('architecture and contract are inherited together, or not at all',
      'the architecture step writes contract.md, so they are one step. To change the surface, inherit neither — the change re-authors architecture and re-locks');
  }

  if (!isValidEpicId(parent)) return refuse(`invalid parent id: ${parent} (expected EP-<slug>)`);
  if (PRODUCT_EPICS.includes(parent)) {
    return refuse(`${parent} is the Product level, not an epic a change can thread off`,
      'name the feature epic this change evolves');
  }
  if (parent === epic) return refuse(`${epic} cannot be its own parent`);
  const parentDir = epicRoot(root, parent);
  let parentState;
  try { parentState = readJSONStrict(path.join(parentDir, '.sdlc', 'state.json'), null); } catch (e) {
    return refuse(`${parent}: its state.json cannot be read — ${e.message}`, 'run `yad doctor` and fix the parent first');
  }
  if (!fs.existsSync(path.join(parentDir, 'epic.md')) || !isPlainObject(parentState) || !Array.isArray(parentState.steps)) {
    return refuse(`${parent} is not an epic with a lifecycle here`,
      'a change threads off an epic that exists. For a feature built before it had one, mint an anchor with the yad-stub skill first');
  }
  const line = resolveThread(root, parent);
  if (line.broken) return refuse(`${parent}: its lineage is broken — ${line.broken}`, 'fix the parent\'s epic.md first');

  // THE ROUTE IS THE PARENT'S. A short-lane parent gives a short child; writing `classic` over it would
  // mint inherited architecture steps for a review that never happened anywhere.
  const profile = epicProfileId(parentState);
  if (!profile || !seedableProfiles().includes(profile)) {
    return refuse(`${parent}: its chain is on no route this command can seed${profile ? ` ('${profile}')` : ''}`,
      'run `yad doctor` on the parent — its recorded profile and its chain must agree');
  }
  const steps = seedChain(lifecycleProfile(profile));
  const onChain = new Set(steps.map((s) => s.id));

  // Who owns each base, along the parent's line only.
  const owners = ownersAlong(root, line.chain);
  // One step writes both, so one epic must own both. They can split when an epic between here and the
  // genesis lists only one of the two in its `inherits:` — and carrying them from two owners would bind
  // the architecture steps to one surface and point the lock at another.
  if (bases.includes('architecture') && owners.architecture !== owners.contract) {
    return refuse(`along ${parent}'s line the architecture is owned by ${owners.architecture || 'no epic'} but the contract by ${owners.contract || 'no epic'}`,
      'one step writes both, so one epic must own both. An epic between them lists only one of the two in its `inherits:` — list both there, or neither, then thread again');
  }
  const carried = new Map(); // step id -> { owner, boundHash }
  const ownerOf = {};
  let anchor = false;
  let lock = null;
  for (const base of bases) {
    const ids = INHERIT_STEPS[base].filter((id) => onChain.has(id));
    const owner = owners[base];
    if (!ids.length || !owner) {
      return refuse(`${parent}'s ${profile} route has no ${base} step — there is nothing to inherit`,
        `leave ${base} out of inherits. A short lane has no architecture or UI, and a change that moves the contract is a new epic on classic`);
    }
    ownerOf[base] = owner;
    const ownerDir = epicRoot(root, owner);
    let ownerState;
    try { ownerState = readJSONStrict(path.join(ownerDir, '.sdlc', 'state.json'), null); } catch { ownerState = null; }
    if (!isPlainObject(ownerState) || !Array.isArray(ownerState.steps)) {
      return refuse(`${owner} owns ${base}, but its state.json is missing or cannot be read`,
        'nothing here can check that it was approved. Run `yad doctor` and fix it first');
    }
    // A brownfield anchor has an un-started chain and nothing locked: the base is carried with no hash
    // to drift from, and no pointer-lock is written — there is no surface to point at yet.
    if (backfillAnchorKind(ownerState)) {
      anchor = true;
      for (const id of ids) carried.set(id, { owner, boundHash: null });
      continue;
    }
    for (const id of ids) {
      // `analysis` was never named by the person typing the list, so say why it is being checked.
      const rides = id === base ? '' : ` (${id} rides with ${base})`;
      // THE SET-ASIDE RULE (the limit E37 and E41 left open). The thread's owner map names the epic that
      // DECIDED about a base, which is right for a skip: the decision is that epic's. It is not the same
      // as an artifact to carry. Only work written AND approved there is inherited.
      for (const sid of [id, `${id}-review`]) {
        const s = ownerState.steps.find((x) => x?.id === sid);
        const st = stepStatus(s);
        if (st === 'done') continue;
        if (claimsSkipped(s)) {
          return refuse(`${owner} skipped ${sid}${s.record?.reason ? ` (${s.record.reason})` : ''}${rides} — nothing was written to inherit`,
            `leave ${base} out of inherits, then \`yad skip\` it on this epic if it does not apply here either`);
        }
        if (st === 'deferred') {
          return refuse(`${owner} deferred ${sid}${rides} — that work is still owed, not written`,
            `leave ${base} out of inherits and author it on this epic, so the owed work follows the thread`);
        }
        // The owner map reads `inherits:` in epic.md; the ledger says the step came from further up. The
        // two records disagree, and choosing one would be guessing where the artifact really lives.
        if (claimsInherited(s)) {
          return refuse(`${owner}'s ledger carries ${sid} from ${s.inheritedFrom || 'its parent'}${rides}, but its epic.md does not list ${base} in inherits`,
            `add ${base} to ${owner}'s inherits (or re-author it there), then thread again`);
        }
        return refuse(`${owner} has not finished ${sid} (${s ? (st ?? s.status) : 'not on its chain'})${rides} — nothing approved to inherit yet`,
          `finish it on ${owner} first, or leave ${base} out of inherits and author it here`);
      }
      const boundHash = artifactHash(ownerDir, stepDef(id).artifact);
      if (!boundHash) {
        return refuse(`${owner} approved ${id}${rides}, but ${stepDef(id).artifact} is not there to bind to`,
          `restore it on ${owner}, or leave ${base} out of inherits`);
      }
      carried.set(id, { owner, boundHash });
    }
    if (base === 'architecture') {
      let ownerLock;
      try { ownerLock = readJSONStrict(path.join(ownerDir, '.sdlc', 'contract-lock.json'), null); } catch { ownerLock = null; }
      if (!isPlainObject(ownerLock) || !LOCK_HASH.test(String(ownerLock.hash || ''))) {
        return refuse(`${owner} approved its architecture but holds no usable contract lock`,
          `rule 5: a change may skip authoring a contract, never having one. Lock the surface on ${owner} (yad-architecture Step 5) first`);
      }
      // A pointer to a lock that no longer matches its surface would pass that drift down the thread.
      if (contractSurfaceHash(ownerDir) !== ownerLock.hash) {
        return refuse(`${owner}'s contract surface no longer matches its lock`,
          `run \`yad doctor\` — re-lock ${owner}'s surface before a change points at it`);
      }
      lock = {
        artifact: 'contract.md', hash: ownerLock.hash, lockedAt: today,
        inheritedFrom: owner, ref: `../../${owner}/.sdlc/contract-lock.json`,
      };
    }
  }

  let opened = false;
  const chain = steps.map((row) => {
    const hit = carried.get(row.id.replace(/-review$/, ''));
    if (!hit) {
      const status = opened ? 'todo' : 'in_progress';
      opened = true;
      return { ...row, status };
    }
    const { risk_tags: riskTags, ...head } = row;
    return {
      ...head,
      status: 'satisfied',
      // The legacy flag is still written beside the new word (rule 3), so a 3.x reader keying on
      // `.inherited` keeps working for this whole major.
      inherited: true,
      inheritedFrom: hit.owner,
      boundHash: hit.boundHash,
      record: stepRecord({ reason: `carried by reference from ${hit.owner}`, date: today, link: hit.owner }),
      risk_tags: riskTags,
    };
  });
  const first = chain.find((s) => s.status === 'in_progress');
  const approvals = canonicalApprovals(chain.filter((s) => s.inherited && s.type === 'review+approve').map((s) => ({
    artifact: s.artifact, step: s.id, status: 'inherited', from: s.inheritedFrom, boundHash: s.boundHash, date: today,
  })));
  return {
    ok: true,
    profile,
    thread: line.rootId,
    owners: ownerOf,
    anchor,
    lock,
    approvals,
    state: { epicId: epic, createdAt: today, type, profile, currentStep: first.id, steps: chain },
  };
}

// ---- the advance dial, set freely, and the kill switch (E34) ------------------------------------
//
// Automation used to be EARNED: the `yad-run` skill refused `advance: auto` until a step's trust log
// cleared a threshold. E34 deletes that. The dial is the team's to set, `yad dial` shows the run record as
// advice, and a recorded kill switch holds every step at `human`. What never moves is rule 1: a gate
// (`isGateStep`) is `human`, whatever any file says.
//
// TWO HOMES, because the two parts are written by different hands. A Build lane's dial stays on the
// lane, in `build-state/<story>.json`, where `yad-run` already reads it. A Shape author step's dial is
// project-wide, in `.sdlc/automation.json` beside the kill switch: `state.json` belongs to CI on a
// verified Product, so a dial written there could not be changed by the team it belongs to.
//
// A SHAPE `auto` IS RECORDED, NOT ACTED ON — yet. Nothing drives a Shape step on its own until the engine
// runs agents (E26, Wave 3.5). The same pattern as E7's approver count: the value is real, stored and
// shown, and the command that prints it says so.
export const ADVANCE_VALUES = ['human', 'auto'];

const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// `.sdlc/automation.json` as the readers see it: `{ kill, steps, error }`. An absent file is the
// defaults — the switch off and every Shape step `human`. A file that is there and wrong carries an
// `error`, and `killSwitchOn` reads an error as ON: of the two ways to be wrong about a safety switch,
// holding everything at `human` is the one nobody gets hurt by. `steps` keeps its values as written, so
// `yad doctor` can name a bad one; the readers honour only `auto`.
export function normalizeAutomation(raw) {
  const out = { kill: null, steps: {}, error: null };
  if (raw == null) return out;
  if (!isPlainObject(raw)) return { ...out, error: 'is not a JSON object' };
  if (raw.kill != null) {
    if (!isPlainObject(raw.kill) || typeof raw.kill.on !== 'boolean') return { ...out, error: 'has a `kill` that is not { on, reason, by, date }' };
    out.kill = { on: raw.kill.on, reason: strOrNull(raw.kill.reason), by: strOrNull(raw.kill.by), date: strOrNull(raw.kill.date) };
    // The record this one replaced, one level deep (rule 7: turning the switch off must not erase who
    // turned it on, and why).
    const p = raw.kill.previous;
    if (isPlainObject(p) && typeof p.on === 'boolean') {
      out.kill.previous = { on: p.on, reason: strOrNull(p.reason), by: strOrNull(p.by), date: strOrNull(p.date) };
    }
  }
  if (raw.steps != null) {
    if (!isPlainObject(raw.steps)) return { ...out, error: 'has a `steps` that is not an object' };
    for (const [id, v] of Object.entries(raw.steps)) out.steps[id] = v;
  }
  return out;
}

export function loadAutomation(root) {
  try {
    return normalizeAutomation(readJSONStrict(path.join(root, PROJECT_FILES.automationConfig), null));
  } catch {
    return { kill: null, steps: {}, error: 'does not parse' };
  }
}

// What goes back on disk. Steps sorted, so the bytes depend on what is set, not on the order it was set.
export const serializeAutomation = (a) => ({
  ...(a.kill ? { kill: a.kill } : {}),
  steps: Object.fromEntries(Object.entries(a.steps || {}).sort(([x], [y]) => cmp(x, y))),
});

export const killSwitchOn = (a) => !!a && (a.error != null || a.kill?.on === true);

// A step's advance as it will actually be applied: `{ advance, set, why }`. `set` is what the team chose;
// `advance` is what happens. `why` is `gate` (rule 1), `kill` (held by the switch), `project` (a Shape
// step, from automation.json) or `lane` (a Build step, from its own row).
export function effectiveAdvance(step, automation = null) {
  if (!isPlainObject(step)) return { advance: 'human', set: 'human', why: 'unknown' };
  if (isGateStep(step)) return { advance: 'human', set: 'human', why: 'gate' };
  const def = stepDef(step.id);
  // A step this release does not know is held at human: nothing here can say it is not a gate.
  if (!def) return { advance: 'human', set: 'human', why: 'unknown' };
  const shape = def.phase !== 'build';
  const set = shape
    ? (automation?.steps && Object.hasOwn(automation.steps, step.id) && automation.steps[step.id] === 'auto' ? 'auto' : 'human')
    : (stepAdvance(step) === 'auto' ? 'auto' : 'human');
  if (set === 'auto' && killSwitchOn(automation)) return { advance: 'human', set, why: 'kill' };
  return { advance: set, set, why: shape ? 'project' : 'lane' };
}

const refusal = (message, hint) => ({ ok: false, message, hint });
const shapeAuthorIds = () => STEPS.filter((d) => d.kind === 'author' && d.phase !== 'build' && d.level !== 'product').map((d) => d.id);
const buildAuthorIds = () => STEPS.filter((d) => d.kind === 'author' && d.phase === 'build').map((d) => d.id);

// Set a Shape author step's dial for the whole project. PURE: takes and returns the automation object.
export function planShapeDial(automation, { step, to }) {
  const def = stepDef(step);
  if (!def) return refusal(`unknown step: ${step}`, `a Shape step's dial is one of ${shapeAuthorIds().join(' · ')}`);
  // "Shape author steps" means a feature's chain. The Foundation is the Product level, reviewed once per
  // product; its dial is not the team's per-feature automation choice.
  if (def.level === 'product') {
    return refusal(`${step} is the Product level, not a step on a feature's Shape chain`,
      `a Shape step's dial is one of ${shapeAuthorIds().join(' · ')}`);
  }
  if (def.kind === 'review') {
    return refusal(`${step} is a review gate, and a gate is never auto`,
      'a person clears every gate (rule 1). Set the dial of the step it reviews instead');
  }
  if (def.phase === 'build') {
    return refusal(`${step} is a Build step — its dial is set per lane`,
      `yad dial <epic> <story> --repo <name> ${step} --to ${to || 'auto'}`);
  }
  if (!ADVANCE_VALUES.includes(to)) return refusal(`--to must be human or auto, not ${to}`);
  const steps = { ...(automation?.steps || {}) };
  const before = steps[step] === 'auto' ? 'auto' : 'human';
  // `human` is the default, so it is written as the key's ABSENCE: the file only ever lists what a team
  // turned on.
  if (to === 'auto') steps[step] = 'auto';
  else delete steps[step];
  return { ok: true, before, changed: before !== to || (to === 'human' && Object.hasOwn(automation?.steps || {}, step)), automation: { kill: automation?.kill || null, steps } };
}

// Set one Build step's dial on one lane. PURE: takes the parsed build-state, returns a new one.
export function planLaneDial(buildState, { story, repo, step, to, declared = [] }) {
  const def = stepDef(step);
  if (def && def.phase !== 'build' && def.kind === 'author') {
    return refusal(`${step} is a Shape step — its dial is set for the whole project`, `yad dial ${step} --to ${to || 'auto'}`);
  }
  if (!def || def.phase !== 'build') return refusal(`unknown Build step: ${step}`, `a lane's dial is one of ${buildAuthorIds().join(' · ')}`);
  if (isGateStep({ id: step })) {
    return refusal(`${step} is the merge gate, and a gate is never auto`, 'a person clears every gate (rule 1)');
  }
  if (!ADVANCE_VALUES.includes(to)) return refusal(`--to must be human or auto, not ${to}`);
  if (!declared.includes(repo)) {
    return refusal(`${story} does not declare the repo ${repo}`, `its repos are ${declared.join(' · ') || '(none)'}`);
  }
  const lane = isPlainObject(buildState?.repos) ? buildState.repos[repo] : null;
  if (lane?.status === 'skipped') return refusal(`${story} / ${repo} is skipped — a skipped lane runs nothing`, `yad unskip <epic> ${story} --repo ${repo} first`);
  const row = Array.isArray(lane?.steps) ? lane.steps.find((x) => isPlainObject(x) && x.id === step) : null;
  if (!row) {
    return refusal(`${story} / ${repo} has no ${step} step yet`,
      'yad-run writes every Build step onto a lane the first time it drives it. Set the dial after that');
  }
  const before = stepAdvance(row) === 'auto' ? 'auto' : 'human';
  // A deep copy: the caller's object is left exactly as it was read.
  const next = JSON.parse(JSON.stringify(buildState));
  const target = next.repos[repo].steps.find((x) => isPlainObject(x) && x.id === step);
  // BOTH names, the old one first in meaning: `automation` is still the one read (shape 4), and a row
  // carrying only `advance` is what `yad doctor` reports as `dials:new-only`.
  target.automation = AUTOMATION_FROM_ADVANCE[to];
  target.advance = to;
  return { ok: true, before, changed: row.automation !== target.automation || row.advance !== target.advance, buildState: next };
}

// Turn the kill switch on or off. PURE. Turning it ON needs a reason (rule 7 — the escape hatch is
// recorded); turning it off records who and when, and the reason when one is given.
export function planKill(automation, { on, reason = null, by = null, date = null }) {
  const why = strOrNull(reason);
  if (on && !why) return refusal('the kill switch needs a reason', 'yad kill --reason "<why>" — the record is what tells the team when it is safe to turn it off');
  const already = (automation?.kill?.on === true) === on;
  if (already) return { ok: true, already: true, automation };
  // The record being replaced is kept as `previous`, without its own `previous` — one level is the audit
  // trail a person reads; the rest is git history.
  const replaced = automation?.kill ? (({ previous: _previous, ...rest }) => rest)(automation.kill) : null;
  return { ok: true, already: false, automation: { steps: { ...(automation?.steps || {}) }, kill: {
    on, reason: why, by: by || null, date: date || null, ...(replaced ? { previous: replaced } : {}),
  } } };
}

export { writeJSON };
