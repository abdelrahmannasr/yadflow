// `yad gate open|sync|comments|status` — the PR/MR-driven Shape review gate.
// The platform PR/MR is the review UI; this command syncs its state into the file ledger and, when
// the gate passes (approvals satisfied + all comment threads resolved + PR merged), auto-advances the
// step. The merge click is the human approval act, so Shape steps still never machine_advance.
import fs from 'node:fs';
import path from 'node:path';
import {
  c, log, ok, info, warn, hand, fail, note, readJSON, readJSONStrict, writeJSON, run, pushWithRebase, isPlainObject,
  writeMirrored,
} from './lib.mjs';
import { PROJECT_FILES, isVerifiedLedger , productConfigPath } from './manifest.mjs';
import {
  epicIds, epicRel, epicRoot, loadLedger, findReviewStep, artifactBase, artifactHash, acceptedHashes, isStaleHash, gatePredicate,
  advanceState, closingRecord, markInReview, isEscalated, gateRuleFor, gateRuleSum, gateRuleEnforced, parseReviewBranch, artifactFromBase, legacyLogins,
  upsertHubPr, stateInvariants, repairState, DISCOVERY_FILES, FOUNDATION_REQUIRED, unwrittenSections,
  canonicalApprovals, canonicalComments, canonicalHubPrs, optionalStepsFor, isSkippableStep, writeState, routeLacksStep,
  isPassed, stepStatus, claimsSkipped, claimsInherited, DISCOVERY_EPIC, FOUNDATION_DIR, FOUNDATION_EPIC, staleFoundationGuards,
} from './epic-state.mjs';
import { activePeople, activeSum, activeBasis } from './people.mjs';
import { applyProductMove, planProductMove } from './migrate.mjs';
import { productGit, preflightGuardReadiness, resolveDefaultBranch, guardDefaultBranch } from './hubcommit.mjs';
import {
  readPr, mapApprovers, createPr, platformLogin, actorName, ambiguousLegacyNames, prNumberFromUrl,
  getPrBody, editPrBody, postComment, findPrForBranch, prBranch, branchExists,
} from './platform.mjs';
import { isNoBlock, upsertTrailerBlock, nudgeMessage, parseEngagement } from './companion.mjs';
import { sequenceDiff } from './walkthrough.mjs';
import { syncStatuses } from './artifact-status.mjs';
import { err } from './errors.mjs';

// Who WRITES a closing record (E18): the platform login, else the raw git user.name, else null
// (`actorName`). On CI that is usually the bot's git name — a job token cannot read `/user`. Best-effort,
// like every record's `by`: attribution never blocks a gate. Kept here rather than imported from
// skip.mjs, which imports this file.
function closingActor(root, hub) {
  return actorName(root, hub?.platform);
}

// One line for a review step's closing record in `yad gate status` (E18).
function closedLine(closed) {
  const how = closed.via === 'merge'
    ? `merged${closed.mergedBy ? ` by ${closed.mergedBy}` : ''}${closed.pr != null ? ` (PR #${closed.pr})` : ''}${closed.commit ? ` at ${String(closed.commit).slice(0, 7)}` : ''}`
    : `via ${closed.via || 'an unknown path'}${closed.pr != null ? ` (PR #${closed.pr})` : ''}`;
  const waived = closed.waived === 'solo' ? '; approvals waived (solo mode)' : closed.waived ? `; approvals waived (${closed.waived})` : '';
  return `closed${closed.date ? ` on ${closed.date}` : ''} — ${how}${waived}${closed.by ? `; recorded by ${closed.by}` : ''}`;
}

// ---- tiny frontmatter reader (key: value, and `repos: [a, b]`) ----------------------------------
function frontmatter(file) {
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

// Touched domains, resolved from files (gating.md): stories => union of every story's repos; a step
// carrying a risk tag (architecture's `contract`) => epic.repos; otherwise none. The stories clause is
// checked FIRST and on its own: it used to live inside `isEscalated`, which E62 narrowed to risk tags.
export function touchedDomains(epicDir, step) {
  if (step?.id === 'stories-review') {
    const dir = path.join(epicDir, 'stories');
    if (!fs.existsSync(dir)) return [];
    const set = new Set();
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      for (const r of (frontmatter(path.join(dir, f)).repos || [])) set.add(r);
    }
    return [...set];
  }
  if (!isEscalated(step)) return [];
  return frontmatter(path.join(epicDir, 'epic.md')).repos || [];
}

// The artifact owner shown in the review PR/MR body. Feature epics carry it in epic.md; the Product
// level has no epic.md, so fall back to roadmap.md's frontmatter owner — a section the Foundation and
// its old `EP-discovery` spelling both have, under that same name, in their own folder.
const ownerOf = (epicDir) =>
  frontmatter(path.join(epicDir, 'epic.md')).owner
  || frontmatter(path.join(epicDir, 'roadmap.md')).owner
  || '<owner>';

// A null architecture hash with a BEGIN marker present means the surface block is malformed
// (no END, or empty) — approvals would not be hash-bound, so make that visible.
function warnUnlockedContract(epicDir, artifact) {
  if (artifactBase(artifact) !== 'architecture') return;
  if (artifactHash(epicDir, artifact) !== null) return;
  const f = path.join(epicDir, 'contract.md');
  if (fs.existsSync(f) && /CONTRACT-SURFACE:BEGIN/.test(fs.readFileSync(f, 'utf8'))) {
    warn('contract.md has CONTRACT-SURFACE:BEGIN without a matching END (or an empty block) — surface not locked, approvals will not be hash-bound');
  }
}

// A null hash on a product-level set means it is incomplete (a required file is missing), so the review
// is not yet reviewable and an approval would not be hash-bound. Name the missing files so the owner can
// complete the set before the gate is opened/advanced (mirrors warnUnlockedContract). Two sets: the
// Foundation's required sections (E75 — its optional ones never make it incomplete) and the six files
// of the old `discovery` spelling.
//
// A complete Foundation can still be an EMPTY one (E76): every section present and holding only its
// template headings has a fingerprint, so reviewers could approve it. That is named too — a warning,
// never a refusal, the stance E75 took on the Foundation's gate itself. The old `discovery` spelling
// is not asked: its templates were never read this way, and it is only ever converted, not authored.
export function warnIncompleteDiscovery(epicDir, artifact) {
  const b = artifactBase(artifact);
  const required = b === 'foundation' ? FOUNDATION_REQUIRED : b === 'discovery' ? DISCOVERY_FILES : null;
  if (!required) return;
  if (artifactHash(epicDir, artifact) === null) {
    const missing = required.filter((f) => !fs.existsSync(path.join(epicDir, f)));
    const label = b === 'foundation' ? 'Foundation incomplete' : 'discovery set incomplete';
    warn(`${label} — missing ${missing.join(', ')}; review is not yet reviewable (approvals will not be hash-bound until the full set exists)`);
  }
  if (b !== 'foundation') return;
  const empty = unwrittenSections(epicDir);
  if (empty.length) {
    // Worded for both callers: `gate open` before any approval, and `gate sync` on a review that may
    // already have passed — so it says what an approval of this content means, not that one is coming.
    const one = empty.length === 1;
    warn(`Foundation not written yet — ${empty.join(', ')} ${one ? 'holds nothing but its' : 'hold nothing but their'} template, so an approval of ${one ? 'it approves an empty section' : 'them approves empty sections'}`);
  }
}

// Fail fast on a corrupt or wrong-shape Product config: a silently-defaulted hub.json would degrade
// every gate to local without anyone noticing, and a typo'd platform would read as a local ledger.
export function loadProduct(root) {
  const hubFile = productConfigPath(root);
  const regFile = path.join(root, PROJECT_FILES.reposRegistry);
  // Distinguish an ABSENT hub.json (null default → fine, local gate) from one that exists but
  // holds literal `null` (malformed — must not silently downgrade to local).
  const hub = readJSONStrict(hubFile, null);
  if (hub === null && fs.existsSync(hubFile)) {
    throw err('YAD-STATE-002', `${hubFile}: contains \`null\` — expected a config object`, 'fix the file or re-run `yad setup`');
  }
  if (hub !== null) {
    if (typeof hub !== 'object' || Array.isArray(hub)) throw err('YAD-STATE-002', `${hubFile}: expected a JSON object`, 'fix the file or re-run `yad setup`');
    if (![null, undefined, 'github', 'gitlab'].includes(hub.platform)) {
      throw err('YAD-CFG-001', `${hubFile}: unknown platform '${hub.platform}'`, 'expected github, gitlab, or null — fix the file or re-run `yad setup`');
    }
  }
  const registry = readJSONStrict(regFile, { repos: [] });
  if (!Array.isArray(registry?.repos)) throw err('YAD-STATE-002', `${regFile}: expected a \`repos\` array`, 'fix the file or re-run `yad setup`');
  return { hub, repos: registry.repos };
}

// Solo mode (a lone developer): waive the approval requirement — on GitHub you cannot approve your own
// PR, so an approval gate would deadlock. The review PR/MR and its merge stay (CI runs on the PR; the
// merge advances the step). Recorded per-project in hub.json by `yad setup`.
export const isSolo = (hub) => !!(hub && (hub.solo === true || hub.review_gate?.solo === true));

// Verified mode: CI is the sole ledger writer, so `gate open`/`sync` stay hands-off. The predicate is
// defined once in manifest.mjs (`isVerifiedLedger`) and shared with plan.mjs's wiring and the ledger
// hook, so no two readers can disagree about who owns the ledger (#186).

// requireEngagement (config `hub.review.requireEngagement`): when on, the predicate counts only
// approvals carrying a verified engagement signal. Soft-off by default — a bare approve still counts
// but is recorded `engagement: none` and draws the friendly nudge.
export const requireEngagement = (hub) => !!(hub && (hub.review?.requireEngagement === true));

// `legacyLogins` LIVES in cli/epic-state.mjs now (E71): the active-people reader needs the same table to
// recognise an older record, and importing it from here would have made a cycle (gate.mjs prints the
// count that reader returns). This re-export stays — rule 3, the new name beside the old — and is the
// one every older reader here and in cli/usage.mjs still calls.
export { legacyLogins };

// Re-add this step's bridge approvals from the current platform state (drop+re-add => dismissals and
// revocations vanish idempotently; manual approvals are never touched). Preserve the artifactHash a
// reviewer first approved against unless their review is newer (a genuine re-approval) — that is what
// makes "revoke only when the artifact changed" work.
// `closed`: the step already advanced. Drop-and-re-add is what makes a dismissal or revocation vanish
// idempotently on an OPEN step — the platform is the live source of truth there. On a CLOSED step it
// is destructive instead: the gate passed, and the approvals that passed it are the audit record of
// why. A GitLab approval reset, or any degraded-but-`ok` read yields an empty `recs`
// and would erase them, leaving `done` with zero approvals — the very state issue #156 is about,
// reached from the other side. So a closed step's record is only ever added to or refreshed in place.
//
// ONE RECORD PER PERSON (E62). An approval is keyed by who gave it and nothing else. Before E62 the key
// also held the role and domain the roster gave that person, so one approval could be several records;
// such a person's older records are replaced by one, which keeps the fingerprint and dates they carried
// — a STALE one when their records disagree, so the merge leans stale. Stale means not among
// `accepted` (`acceptedHashes`), never merely "not today's exact hash": every approval a released
// yadflow wrote carries an older fingerprint form the gate still reads as live, and treating those as
// stale picked the wrong record and passed a gate on a stale approval (E62 review). The
// `role`/`domain` fields are not carried forward — nothing reads them any more.
//
// AN OLDER RECORD NAMES THE PERSON AS THE ROSTER DID (`alice`), and the platform now reports their LOGIN
// (`al`). Unmatched, the first sync after the upgrade treated the approval as new and bound it to
// TODAY's content — an approval of the old text read as approval of the edited one, the hole #156 is
// about — and on a closed step it listed one person twice. `aliases` is the roster's own name → login
// table (`legacyLogins`), read for this recognition ONLY; it decides nothing about the gate. With it the
// match is exact — unless the roster itself is ambiguous (a name held twice is dropped by `legacyLogins`;
// a name equal to another entry's login `yad doctor` warns about). Without it (the roster was deleted) an
// older record is matched only when nothing else could be it: the same submission time on GitHub, or, on
// an OPEN step, the single unmatched approval against the single unmatched older approver of this PR on
// GitLab. A record an older release marked `unverified` names a login already and is never translated. Guessing by order is how two people's fingerprints got
// swapped. Where it stays ambiguous, a closed step adds nothing (its record is history, and a second
// entry for the same review would count one person twice), and an open step records the approval
// against a STALE fingerprint from those older records when one exists — the approval must be given
// again, on a new review, rather than pass on content one of those people may never have seen.
function upsertBridge(approvals, recs, { stepId, artifact, curHash, today, prNumber = null, closed = false, aliases = new Map(), clashed = new Map(), accepted = null }) {
  const live = accepted ?? (curHash ? [curHash] : []);
  const stale = (a) => !!a.artifactHash && isStaleHash(a.artifactHash, live);
  // A submission TIME, not a date. Every GitLab record written before E64 read `approved_at` holds the
  // day it was synced (`today`), and as text `2026-09-15T10:00:00Z` sorts after `2026-09-15` — so a
  // date-only value compared as a time made the first E64 sync read every same-day GitLab approval as a
  // newer review and bind it to today's content (#156). A date is "time unknown".
  const hasTime = (t) => typeof t === 'string' && t.includes('T') && !Number.isNaN(Date.parse(t));
  const isLegacy = (a) => a.role !== undefined || a.domain !== undefined;
  // An `unverified` record already names a LOGIN — an older release wrote one for a reviewer the roster did
  // not list — so it is never translated through the roster's names, where it could collide with a name.
  // A record under a roster name two logins share is keyed apart from every login (a NUL-prefixed key no
  // platform login can equal), so it is never name-matched and, on a closed step, stays as history. The
  // key also carries the submission time: an older release wrote one record per login under that one
  // name, so a single key would lump two people together, and continuing one would delete the other.
  const personOf = (a) => {
    if (!isLegacy(a) || a.unverified) return a.approver;
    if (aliases.has(a.approver)) return aliases.get(a.approver);
    return clashed.has(a.approver) ? `\u0000${a.approver}\u0000${a.approvedAt ?? ''}` : a.approver;
  };
  // Who could own a group: anyone for a record no name places; only the logins the roster gives that
  // name for a shared-name group — a login that merely EQUALS the shared name is someone else.
  const nameOfKey = (k) => (k.startsWith('\u0000') ? k.split('\u0000')[1] : null);
  const eligible = (k, r) => { const n = nameOfKey(k); return n === null || !!clashed.get(n)?.has(r.name); };
  const bridge = approvals.filter((a) => a.step === stepId && a.source === 'bridge');
  const groups = new Map();   // person -> their records
  for (const a of bridge) {
    const k = personOf(a);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const repOf = (list) => list.find(stale) || list[0];
  const seen = new Set(recs.map((r) => r.name));
  const matchOf = new Map();  // rec -> the record it continues
  const replaced = new Set(); // people some of whose records a rec continues
  const claimed = new Set();  // the older records a rec continues — per REVIEW, not per person (see below)
  const claim = (r, k, list) => { matchOf.set(r, repOf(list)); for (const a of list) claimed.add(a); replaced.add(k); };
  // An older release's record, or one `stampLegacyLogins` moved onto a login through the name table.
  const olderRec = (a) => (isLegacy(a) && !a.unverified) || a.rosterName !== undefined;
  // AN EXACT SUBMISSION TIME BEATS THE NAME TABLE. On GitHub every review carries the second it was
  // submitted, and an older record kept it as `approvedAt`; when exactly one older group holds that
  // second, it is the same review whatever name the roster now gives it. The name table can be wrong —
  // a team that renamed one of two people sharing a name hands the older records to whoever kept it,
  // and trusting the name then dropped the right record and passed the gate on an approval of old content
  // (E62 upgrade simulation). Only older groups are matched this way: role-bearing records, and records
  // `stampLegacyLogins` moved onto a login through that same name table, which keep the name in
  // `rosterName` (E64) so that stamping them does not take this correction away.
  //
  // The time claims THE RECORDS OF THAT REVIEW, not the whole name group. Two people an older release wrote
  // under one name sit in one group, each with their own submission time; claiming the group for whichever
  // approval matched first, and continuing from the group's first stale record, handed one person the
  // other's record — the later time then read as a newer review and both approvals were bound to today's
  // content, passing a gate on approvals of content that had changed (E64 upgrade simulation). So each
  // approval continues from the records at its own time, and it does so even when the name matches too, or
  // the name match would pick from both people's records. A submission time is unique among these approvals
  // (a shared one is skipped above), so no two claim the same records and the platform's order cannot matter.
  for (const r of recs) {
    if (!r.submittedAt || recs.some((x) => x !== r && x.submittedAt === r.submittedAt)) continue;
    // A group matches on an OLDER record holding that second; the review is then every record of the group
    // holding it — an older release could write one review twice (under the roster name, and `unverified`
    // under the login), and leaving one behind kept it as a second person on a closed step.
    const atTime = (k) => groups.get(k).filter((a) => a.approvedAt === r.submittedAt);
    const byTime = [...groups.keys()].filter((k) => atTime(k).some(olderRec));
    if (byTime.length === 1) claim(r, byTime[0], atTime(byTime[0]));
  }
  // By name, from what no time claimed — and still per review: when some of those records hold this
  // approval's own time, those are its review; the rest may be another person's under the same name.
  for (const r of recs) {
    if (matchOf.has(r) || !groups.has(r.name)) continue;
    const rest = groups.get(r.name).filter((a) => !claimed.has(a));
    const own = r.submittedAt ? rest.filter((a) => a.approvedAt === r.submittedAt) : [];
    if (rest.length) claim(r, r.name, own.length ? own : rest);
  }
  // Older approvers nobody could name: legacy records with no alias, recorded against THIS review (a
  // record with no `pr` predates PR provenance and is taken as the pointer's, as `stampLegacyPr` does).
  // A group an exact time already continued is not an orphan: claiming it again through the one-to-one or
  // time rule below handed the same records to a second approval (E64 upgrade simulation).
  const orphans = prNumber == null ? [] : [...groups.keys()].filter((k) => !seen.has(k) && !replaced.has(k)
    && groups.get(k).every((a) => isLegacy(a) && !a.unverified && !aliases.has(a.approver) && (a.pr == null || a.pr === prNumber)));
  // (a clashed-name group's key starts with NUL, so `seen` never holds it and it is always eligible here)
  const unmatched = recs.filter((r) => !matchOf.has(r));
  // Every approval is judged against the SAME set of older approvers, and only then are the matches taken:
  // deciding them one at a time made the result depend on the order the platform lists reviews, so an
  // unchanged re-sync could add a record the first sync had dropped. A CLOSED step continues an older
  // record only on an exact submission time — the GitLab one-to-one guess there could hand one person's
  // history to another. Two approvals that would continue the same older record continue neither.
  const picks = new Map();
  for (const r of unmatched) {
    const mine = orphans.filter((k) => eligible(k, r));
    // Match by time only when the older records hold one to match. A GitLab record from before E64 holds a
    // date, so an approval that now carries `approved_at` still takes the one-to-one rule against it.
    const byTimeOnly = !!r.submittedAt && mine.some((k) => groups.get(k).some((a) => hasTime(a.approvedAt)));
    if (closed && !byTimeOnly) continue;
    const candidates = byTimeOnly
      ? mine.filter((k) => groups.get(k).some((a) => a.approvedAt === r.submittedAt))
      : (mine.length === 1 ? mine : []);
    const rivals = byTimeOnly
      ? unmatched.filter((x) => x.submittedAt === r.submittedAt && candidates.some((k) => eligible(k, x))).length
      : unmatched.filter((x) => candidates.some((k) => eligible(k, x))).length;
    if (candidates.length === 1 && rivals === 1) picks.set(r, candidates[0]);
  }
  const claims = new Map();
  for (const k of picks.values()) claims.set(k, (claims.get(k) || 0) + 1);
  for (const [r, k] of picks) {
    if (claims.get(k) > 1) { picks.delete(r); continue; }
    claim(r, k, groups.get(k));
  }
  const unclaimed = orphans.filter((k) => !replaced.has(k));
  // Ambiguous: an unmatched approval that one of the older approvers still left could be. Each is bound to
  // a stale fingerprint from the records IT could be, never from someone it cannot be.
  const couldBe = (r) => unclaimed.filter((k) => eligible(k, r));
  const ambiguous = new Set(unmatched.filter((r) => !picks.has(r) && couldBe(r).length));
  const staleFor = (r) => couldBe(r).flatMap((k) => groups.get(k)).find(stale) || null;
  const kept = approvals.filter((a) => {
    if (!(a.step === stepId && a.source === 'bridge')) return true;
    if (claimed.has(a)) return false;
    // Closed step: keep a prior approval the platform no longer reports. It is history, not state. That
    // includes a record left in a name group some of whose records a review continued: it is another
    // review — under a shared name, another person's — and dropping the whole group deleted their history.
    return closed && (!seen.has(personOf(a)) || replaced.has(personOf(a)));
  });
  for (const r of recs) {
    if (closed && ambiguous.has(r)) continue;
    const was = matchOf.get(r);
    // first time we see this approval => bind to current content; an ambiguous one => to the stale print
    const staleOrphan = ambiguous.has(r) ? staleFor(r) : null;
    let artHash = staleOrphan ? staleOrphan.artifactHash : curHash;
    let approvedAt = r.submittedAt || today;
    let recordedOn = today;
    if (was) {
      // We only adopt the new hash when the platform PROVES a genuinely newer review. Otherwise —
      // the same review read again — we KEEP the hash they originally approved, so a later artifact
      // change still revokes the approval. Two independent proofs, because one platform lacks each:
      //   - a later submission TIME on both sides (GitHub always; GitLab when it sends `approved_at` and the
      //     record already holds a time — a date-only record is "time unknown", see `hasTime`), or
      //   - a DIFFERENT PR/MR than the one this approval was recorded against. A re-opened review is
      //     always a new PR, so an approval arriving on it cannot be the old one read again. Without
      //     this, a GitLab re-review after a re-lock re-recorded the pre-edit hash and stayed
      //     permanently stale — the step read `done` with zero live approvals (issue #156).
      const newerReview = hasTime(r.submittedAt) && hasTime(was.approvedAt) && Date.parse(r.submittedAt) > Date.parse(was.approvedAt);
      const newerPr = prNumber != null && was.pr != null && was.pr !== prNumber;
      if (!newerReview && !newerPr) {
        artHash = was.artifactHash ?? curHash;
        // A record holding only a date takes the platform's time once (E64) and keeps its fingerprint: the
        // time is evidence of when, the fingerprint is what the gate decides on. Then it is byte-stable.
        approvedAt = !hasTime(was.approvedAt) && hasTime(r.submittedAt) ? r.submittedAt : (was.approvedAt ?? approvedAt);
        // Same review, re-read: keep the date it was RECORDED too, so re-syncing an unchanged
        // approval is a byte-identical no-op instead of a daily one-line ledger commit.
        recordedOn = was.date ?? recordedOn;
      }
    }
    kept.push({
      artifact, step: stepId, approver: r.name,
      status: 'approved', date: recordedOn, source: 'bridge',
      artifactHash: artHash, approvedAt,
      ...(prNumber != null ? { pr: prNumber } : {}),
      // The platform's evidence for this review, when it gave any (E64, see mapApprovers). Audit only.
      ...(r.commit ? { commit: r.commit } : {}),
      ...(r.url ? { url: r.url } : {}),
      ...(r.reviewId ? { reviewId: r.reviewId } : {}),
      engagement: r.engagement === 'verified' ? 'verified' : 'none',
    });
  }
  // Canonical order, not insertion order: this function re-appends at the tail, so without it the
  // bytes depend on which step was synced last and the sweep rotates the file forever (issue #163 —
  // see canonicalApprovals). Sorting here also makes the in-memory before/after comparison below
  // (`approvalsBefore`) mean what it says, so an unchanged re-sync no longer re-stamps lastSyncedAt.
  return canonicalApprovals(kept);
}

// Mutates in place, returns how many it stamped. Backfill `pr` on this step's bridge approvals that
// predate approvals recording which PR they arrived on. `prNumber` must be the pointer they were
// recorded against — callers stamp only at the moment that pointer is about to be replaced, so nothing
// is invented: it is exactly the PR those approvals came from.
export function stampLegacyPr(approvals, stepId, prNumber) {
  let n = 0;
  for (const a of approvals) {
    if (a.step !== stepId || a.source !== 'bridge' || a.pr != null) continue;
    a.pr = prNumber;
    n++;
  }
  return n;
}

// Record the platform login on every older approval and comment record the roster can place (E64), so no
// later sync needs the roster at all. E62's handoff: without this, a roster deleted before the first sync
// after the upgrade left an open review's older approvals matchable only when nothing else could be them.
//
// An older record is one an older release wrote with a `role` or `domain`, naming the person by the
// roster's `name`. It is stamped exactly as `upsertBridge` rewrites a record it continues: `approver` /
// `commenter` becomes the login, and `role`, `domain` and `unverified` are removed — a role left on a
// login-named record would make the next sync look its login up as a roster name, which can be another
// person's. The dated `reviews/*--approved.md` keeps the roles.
//
// It stamps only what the name table places for certain, and leaves the rest for `upsertBridge` to judge
// with the platform's evidence in hand:
//   - an `unverified` record already names a login, and a name two logins share (`clashed`) or a name the
//     roster does not hold is not in `aliases` — none is touched;
//   - ONE RECORD PER PERSON, BUT ONLY FOR ONE REVIEW. An older release wrote one record per role, so one
//     approval can be several records. Several records for one login on one step are merged only when they
//     provably are one review: every one holds the same submission TIME and the same `pr`. Anything less is
//     not proof — a GitLab record from before E64 holds the day it was synced, so two people a renamed
//     roster now gives one name, synced the same day, look identical; a hand-written record holds no time at
//     all. Merging those deleted one person's approval and passed a gate on the other's approval of old
//     content (E64 upgrade simulation). Such a group is left as it is (`unplaced`). When records for one
//     review disagree on the fingerprint, the stale one (outside `acceptedHashes`) is kept, as E62 does;
//   - a stamped approval keeps the roster name it had in `rosterName`. `upsertBridge` still lets an exact
//     submission time beat that name, as it did while the record carried a role — so a renamed shared name
//     stamped onto the wrong login is corrected by the platform's time, not locked in;
//   - a comment round where two records would name one login is left as it is: which count is right is
//     not knowable, and the cost of leaving it is one extra round.
// Pure: returns new arrays and the counts; `acceptedFor(artifact)` gives that artifact's live fingerprints.
// `unplaced` counts older records the roster was still needed for and the stamp could not place.
export function stampLegacyLogins({ approvals = [], comments = [] } = {}, { aliases = new Map(), clashed = new Map(), acceptedFor = () => [] } = {}) {
  const isOld = (x) => x.role !== undefined || x.domain !== undefined;
  // A ledger is a list a person can edit, so an entry may be anything. One this cannot read is left exactly
  // as it is: the stamp runs over every epic on a merge run, and a bad record in an epic nobody is syncing
  // must not stop the review that merged (E64 review).
  const readable = (x, who) => isPlainObject(x) && typeof x[who] === 'string' && x[who] !== '';
  const hasTime = (t) => typeof t === 'string' && t.includes('T') && !Number.isNaN(Date.parse(t));
  const accepted = new Map();
  const live = (artifact) => { if (!accepted.has(artifact)) accepted.set(artifact, acceptedFor(artifact) || []); return accepted.get(artifact); };
  let stamped = 0;
  let unplaced = 0;

  const groups = new Map();
  approvals.forEach((a, i) => {
    if (!readable(a, 'approver') || typeof a.step !== 'string' || !readable(a, 'artifact')) return;
    const old = isOld(a) && !a.unverified;
    if (old && !aliases.has(a.approver)) { if (clashed.has(a.approver)) unplaced++; return; }
    const login = old ? aliases.get(a.approver) : (isOld(a) ? null : a.approver);
    if (login == null) return;
    const k = JSON.stringify([a.step, a.artifact, a.source ?? null, login]);
    if (!groups.has(k)) groups.set(k, { login, list: [] });
    groups.get(k).list.push({ a, i, old });
  });
  const out = approvals.slice();
  const drop = new Set();
  for (const { login, list } of groups.values()) {
    const olds = list.filter((x) => x.old);
    if (!olds.length) continue;
    const oneReview = list.length === 1
      || (list.every((x) => hasTime(x.a.approvedAt)) && new Set(list.map((x) => `${x.a.approvedAt}|${x.a.pr ?? ''}`)).size === 1);
    if (!oneReview) { unplaced += olds.length; continue; }
    // Which fingerprints are live cannot always be computed from a hand-edited record (an `artifact` naming a
    // folder throws). Then which record is stale is unknown, and choosing one could keep the live print, so
    // the group is left as it is (E64 review).
    let staleRec;
    try { staleRec = list.find((x) => !!x.a.artifactHash && isStaleHash(x.a.artifactHash, live(x.a.artifact))); } catch { unplaced += olds.length; continue; }
    const rep = staleRec || list.find((x) => !x.old) || olds[0];
    const { role, domain, unverified, ...rest } = rep.a; // eslint-disable-line no-unused-vars
    out[rep.i] = { ...rest, approver: login, rosterName: rep.old ? rep.a.approver : (rep.a.rosterName ?? olds[0].a.approver) };
    for (const x of list) if (x !== rep) drop.add(x.i);
    stamped += olds.length;
  }

  const rounds = new Map();
  comments.forEach((cm, i) => {
    if (!readable(cm, 'commenter')) return;
    const old = isOld(cm);
    if (old && !aliases.has(cm.commenter)) { if (clashed.has(cm.commenter)) unplaced++; return; }
    const login = old ? aliases.get(cm.commenter) : cm.commenter;
    const k = JSON.stringify([cm.step, cm.round ?? null, login]);
    if (!rounds.has(k)) rounds.set(k, { login, list: [] });
    rounds.get(k).list.push({ cm, i, old });
  });
  const cOut = comments.slice();
  for (const { login, list } of rounds.values()) {
    const olds = list.filter((x) => x.old);
    if (!olds.length) continue;
    if (list.length > 1) { unplaced += olds.length; continue; }
    const { role, domain, ...rest } = olds[0].cm; // eslint-disable-line no-unused-vars
    cOut[olds[0].i] = { ...rest, commenter: login, rosterName: olds[0].cm.commenter };
    stamped++;
  }

  return { approvals: out.filter((_, i) => !drop.has(i)), comments: cOut, stamped, unplaced };
}

function writeComments(epicDir, base, today, blocking) {
  if (!blocking.length) return;
  const file = path.join(epicDir, 'reviews', `${base}--${today}--comments.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [`# Review comments — ${base} — ${today}`, ''];
  for (const t of blocking) {
    lines.push(`## ${t.login || 'reviewer'} ${t.changesRequested ? '(changes requested — **blocking**)' : '(unresolved)'}`);
    lines.push(`- ${(t.body || '').split('\n')[0] || '(no text)'}`);
    lines.push('');
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// Upsert machine-readable participation records into the comments ledger (the counterpart to the
// markdown side file) so the ledger — not just reviews/*.md — reflects platform thread state. One
// record per (step, commenter, round); `round` is the count of prior synced rounds for the step.
// The commenter is the platform login (E62) — there is no stored list to turn it into another name.
// A round an older release wrote names the roster's name for a person; `aliases` (see `legacyLogins`)
// reads it as their login, so the first sync after the upgrade does not open a new round for the same
// threads.
function recordComments(comments, { artifact, stepId, today, blocking, aliases = new Map(), clashed = new Map() }) {
  if (!blocking.length) return comments;
  const byName = (login) => login || 'reviewer';
  // As `upsertBridge` reads approvals: a shared roster name is nobody's login, so its round is not "the same".
  const personOf = (cm) => {
    if (cm.role === undefined) return cm.commenter;
    if (aliases.has(cm.commenter)) return aliases.get(cm.commenter);
    return clashed.has(cm.commenter) ? `\u0000${cm.commenter}` : cm.commenter;
  };
  const counts = new Map();
  for (const t of blocking) counts.set(t.login, (counts.get(t.login) || 0) + 1);
  // A round is a CHANGE in the thread state, not a sync. Allocating max+1 on every call made an
  // unchanged re-read append a whole new record set each pass — and the sweep re-reads a merged review
  // every 15 minutes for a week. A step whose gate never passes (one unresolved thread, or a missing
  // approval) is never `alreadyDone`, so it kept reaching here: ~96 ledger commits a day per stuck
  // review, the same unbounded loop as #163 from the other side. So when the latest recorded round
  // already describes exactly these commenters and counts, REWRITE it in place instead.
  const rounds = comments.filter((cm) => cm.step === stepId);
  const latest = rounds.reduce((m, cm) => Math.max(m, cm.round || 0), 0);
  const prior = rounds.filter((cm) => cm.round === latest);
  const now = new Map([...counts].map(([login, count]) => [byName(login), count]));
  // The same people, each once, with the same counts — two older records that map to one person are not.
  const same = latest > 0 && prior.length === now.size && new Set(prior.map(personOf)).size === prior.length
    && prior.every((cm) => now.get(personOf(cm)) === cm.count);
  const round = same ? latest : latest + 1;
  const kept = comments.filter((cm) => !(cm.step === stepId && cm.round === round));
  for (const [login, count] of counts) {
    // An unchanged round keeps its original date, so re-syncing it is byte-identical rather than a
    // daily one-line churn (the same rule upsertBridge applies to an unchanged approval).
    const was = prior.find((cm) => personOf(cm) === byName(login));
    kept.push({ artifact, step: stepId, commenter: byName(login), round, count, date: (same && was?.date) || today });
  }
  return canonicalComments(kept); // same drop-and-re-append churn as approvals — see canonicalApprovals
}

// ---- actions ------------------------------------------------------------------------------------

// The review PR/MR(s) to sync. Normally the ledger's own pointer — but with a verified ledger the record
// records that pointer only at merge (CI is the sole writer), so a review a human needs to push
// through by hand has NO recorded pointer at all. Fall back to the PR number the caller named
// (`--pr`), else resolve it from the review branch on the platform. Without this, `gate sync` reported
// "no open review PR recorded" for a PR sitting merged on the platform and the advance was
// unreachable by hand (issue #158).
// `--pr` is a recovery flag, so an explicit one WINS over the recorded pointer (a re-opened review is a
// new PR the ledger has not seen). It is also the one number a human types, so it is checked before it
// can bind approvals: it must be a positive integer, and — when the platform can be asked — it must be
// the PR for this artifact's review branch. Without that confirmation a typo'd number naming some
// unrelated merged-and-approved PR would have its reviewers bound to this artifact's hash and satisfy
// the gate.
function resolveTargets(hubPrs, { epic, artifact, state, platform, number, finder, branchOf, cwd }) {
  const recorded = hubPrs.filter((p) => !artifact || p.artifact === artifact);
  const named = number == null || number === '' ? null : Number(number);
  if (named !== null && (!Number.isInteger(named) || named <= 0)) {
    return { targets: [], discovered: false, reason: `--pr must be a positive integer, got '${number}'` };
  }
  if (named === null && recorded.length) return { targets: recorded, discovered: false };
  if (!artifact) return { targets: [], discovered: false, reason: 'name the artifact to resolve its review PR' };
  const step = findReviewStep(state, artifact);
  if (!step) return { targets: [], discovered: false, reason: `no review step for ${artifact}` };
  const branch = `review/${epic}/${base(artifact)}`;
  // `upsertHubPr` replaces the whole entry for an artifact, so a record built from scratch DROPS
  // whatever the recorded one carried. That matters when `--pr` names the PR already on file: `nudged`
  // is the idempotency set for the engagement nudge, so losing it makes the next writer run
  // re-@-mention every bare approver on the PR — a platform write, not just a ledger one — and `url`
  // would churn to null. Carry the recorded entry forward whenever the number is the same one.
  const entry = (n, url) => {
    const prev = recorded.find((p) => p.number === n) || {};
    return [{ ...prev, step: step.id, artifact, platform, number: n, url: url ?? prev.url ?? null, branch, lastSyncedAt: prev.lastSyncedAt ?? null }];
  };
  if (named !== null) {
    // Confirm the number names THIS artifact's review before its reviewers are bound to this
    // artifact's hash. A platform that cannot answer (no CLI, no auth, offline) is not evidence
    // against it — warn and take the human at their word — but a definite mismatch is refused.
    const head = branchOf(platform, named, { cwd });
    if (head.ok && head.branch !== branch) {
      return { targets: [], discovered: false, reason: `#${named} is on '${head.branch}', not this artifact's review branch '${branch}'` };
    }
    if (!head.ok) warn(`could not confirm #${named} belongs to ${branch} (${head.reason}) — using it as given`);
    if (recorded.length && recorded[0].number !== named) info(`--pr #${named} overrides the recorded review PR #${recorded[0].number}`);
    return { targets: entry(named, null), discovered: true };
  }
  const found = finder(platform, branch, { cwd });
  if (!found.ok) return { targets: [], discovered: false, reason: found.reason };
  info(`no recorded review PR — resolved #${found.number}${found.state ? ` (${found.state})` : ''} from ${branch}`);
  return { targets: entry(found.number, found.url), discovered: true };
}

export async function gateSync(root, { epic, artifact, today, reader = readPr, finder = findPrForBranch, branchOf = prBranch, poster = postComment, number = null, local = false, dryRun = false } = {}) {
  const { hub } = loadProduct(root);
  if (!hub?.platform) { warn('no Product platform configured (.sdlc/hub.json) — local gate, nothing to sync'); return { synced: 0 }; }
  const platform = hub.platform;
  const aliases = legacyLogins(hub);
  const clashed = ambiguousLegacyNames(hub);
  const solo = isSolo(hub);
  const reqEng = requireEngagement(hub);
  // E71 — ONE Product-wide count per command, read before the per-step loop so that N steps cannot mean
  // N walks of every repo's history. `today` is the one this command was given, so the count and the
  // records it reports on are measured from the same day.
  const headCount = activePeople(root, { today: today || undefined, aliases });
  // Local invocation in verified mode is ADVISORY: CI is the sole ledger writer, so a human run reads
  // the platform and prints the predicate but writes nothing. CI calls gateSync with local=false.
  // With a local ledger (platform but no gate-sync CI) the local command stays the writer.
  // dryRun forces the same read-only behavior regardless of the ledger — used for the Path B pre-merge
  // evaluation, which must persist nothing (gateCi passes dryRun for a held branch event).
  const readOnly = (local && isVerifiedLedger(hub)) || dryRun;
  // Who writes this run's closing records (E18). Not asked on a read-only run, which writes nothing.
  const by = readOnly ? null : closingActor(root, hub);
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir}/.sdlc/state.json`); process.exitCode = 1; return { synced: 0 }; }

  let { approvals, comments, hubPrs, state } = ledger;
  // Migration (see stampLegacyPr): an approval written before PR provenance existed carries no `pr`,
  // so it can never be told apart from one arriving on a replacement PR — and on GitLab, with no
  // submittedAt either, the other proof is unavailable too. The pointer recorded here IS the PR those
  // approvals came from, so stamp them before anything replaces it.
  for (const p of hubPrs) {
    const s = p.number != null ? findReviewStep(state, p.artifact) : null;
    if (s) stampLegacyPr(approvals, s.id, p.number);
  }
  // E64: record the login on every older record the roster can place, every step of this epic, before
  // anything else reads them — after the `pr` backfill above, so one review's role records agree on `pr` and
  // merge on this write rather than the next. In memory like everything here: a read-only run writes
  // nothing, and the writer path below persists it with the rest. A failure here is named and the sync goes
  // on with the records as they were: the stamp must never stop a merge.
  let stampedOld = { approvals, comments, stamped: 0 };
  try {
    stampedOld = stampLegacyLogins({ approvals, comments }, { aliases, clashed, acceptedFor: (a) => acceptedHashes(epicDir, a) });
  } catch (e) {
    warn(`${epic}: older records not stamped — ${e.message}`);
  }
  approvals = stampedOld.approvals;
  comments = stampedOld.comments;
  const resolved = resolveTargets(hubPrs, { epic, artifact, state, platform, number, finder, branchOf, cwd: root });
  // Advance in CHAIN order, never in ledger order. `advanceState` opens the step that FOLLOWS the one
  // it closes, so syncing two passing gates out of chain order rewinds the epic: closing
  // architecture-review first (next: ui-design) and epic-review second (next: architecture) reopens the
  // already-done `architecture` author step and points currentStep backward — the YAD-STATE-005 chain
  // inconsistency `yad gate repair` exists to undo. This used to hold only by accident, because
  // hub-prs.json happened to be in insertion order; now that the file is written sorted by artifact
  // (see canonicalHubPrs) the accident is gone, so make the ordering explicit. `gate ci` is unaffected
  // either way — it always names a single artifact.
  const stepIndex = (p) => {
    const s = findReviewStep(state, p.artifact);
    return s ? state.steps.indexOf(s) : Number.MAX_SAFE_INTEGER;
  };
  const targets = [...resolved.targets].sort((a, b) => stepIndex(a) - stepIndex(b));
  if (!targets.length) {
    // The stamp still lands (E64): an epic with no review PR on file is exactly one no later sync would
    // write, so `yad doctor`'s "run `yad gate sync <epic>`" would otherwise repeat for ever.
    if (stampedOld.stamped && !readOnly) {
      writeJSON(ledger.files.approvals, canonicalApprovals(approvals));
      writeJSON(ledger.files.comments, canonicalComments(comments));
      info(`${epic}: recorded the platform login on ${stampedOld.stamped} older approval/comment record(s) that named a roster name`);
    }
    warn(`no review PR recorded for ${epic}${artifact ? ` / ${artifact}` : ''}${resolved.reason ? ` — ${resolved.reason}` : ''}`);
    hand(`run \`yad gate open ${epic} ${artifact || '<artifact>'}\`, or name the PR: \`yad gate sync ${epic} ${artifact || '<artifact>'} --pr <n>\``);
    return { synced: 0 };
  }
  // A pointer resolved from the platform is adopted into the ledger on the WRITER path only. In
  // verified mode this run is advisory and writes nothing, so the human never ends up with a gate-state
  // file in their working tree for the ledger-guard check to reject.
  if (resolved.discovered && !readOnly) hubPrs = upsertHubPr(hubPrs, targets[0]);

  let synced = 0;
  let advanced = 0;
  // E71 — said ONCE, before the per-artifact lines, because it is a fact about the PRODUCT and not
  // about any one gate (rule 6: say the arithmetic, not just the verdict). It is reported only: E72 is
  // the row that turns it into the cap on `needed`, so the basis line says so in as many words.
  log(`  ${c.dim(activeSum(headCount))}`);
  note(c.dim(activeBasis(headCount)));
  // Targets whose step is still open. The dated approval-record file is regenerated only for these —
  // an already-done step is re-synced for its approvals alone, and would otherwise drop a new
  // reviews/<artifact>--<today>--approved.md every time the scheduled sweep re-visits it.
  const open = [];
  for (const pr of targets) {
    const step = findReviewStep(state, pr.artifact);
    if (!step) { warn(`no review step for ${pr.artifact}`); continue; }
    // A step that already advanced is never advanced AGAIN (that would reset the next step's status /
    // currentStep backward) — the gate is one-way per step. But it is still SYNCED: in verified mode
    // nothing ever moves a step back to in_review (CI is the sole ledger writer), so a re-opened
    // review — surface re-locked, fresh PR, fresh approvals, merged — used to hit a blanket skip here
    // and write nothing but the PR pointer. The step then read `done` while its approvals were all
    // stale: work proceeded on an audit trail saying the re-review never happened (issue #156).
    const alreadyDone = isPassed(step);
    const pull = reader(platform, pr.number, { cwd: root });
    // A failed platform read must not pass as a green no-op: flag the run non-zero so CI surfaces it
    // (the wired workflow's reconcile/sweep aggregates this exit) instead of silently not advancing.
    if (!pull.ok) { warn(`${pr.artifact}: ${pull.reason} — skipping (local)`); process.exitCode = 1; continue; }

    const curHash = artifactHash(epicDir, pr.artifact);
    warnUnlockedContract(epicDir, pr.artifact);
    warnIncompleteDiscovery(epicDir, pr.artifact);
    const approvalsBefore = JSON.stringify(approvals);
    const recs = mapApprovers(pull.reviews, { headOid: pull.headOid });
    approvals = upsertBridge(approvals, recs, { stepId: step.id, artifact: pr.artifact, curHash, today, prNumber: pr.number ?? null, closed: alreadyDone, aliases, clashed, accepted: acceptedHashes(epicDir, pr.artifact) });

    const changeRequested = pull.reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
    // 2f: companion scaffolding + nudge threads carry the noblock marker and are EXCLUDED from the
    // blocking check — they stay unresolved as a permanent PR/MR history trail but never hold the gate.
    // Only genuine (unflagged) unresolved threads block.
    const unresolved = (pull.threads || []).filter((t) => !t.resolved && !isNoBlock(t.body));
    const threadsResolved = unresolved.length === 0 && changeRequested.length === 0;
    const blocking = [
      ...changeRequested.map((r) => ({ login: r.login, changesRequested: true })),
      ...unresolved,
    ];
    // Advisory (read-only) sync must not touch the working tree — defer the reviews/*.md write.
    //
    // An already-done step is re-synced for its APPROVALS ONLY. Everything else here is per-round
    // bookkeeping for a review still in flight, and re-running it on a closed one is pure churn: both
    // wired sweeps drive `gate ci --branch … --merged` (event mode) over a 7-day window, so a merged
    // review that still carries one unresolved thread would append a fresh comment round — and a fresh
    // `chore(gate): advance … [skip ci]` commit on the default branch — every 15 minutes for a week.
    // That is the same churn the resource_group fix exists to stop, so it must not be reintroduced here.
    if (!alreadyDone) {
      if (!readOnly) writeComments(epicDir, base(pr.artifact), today, blocking);
      comments = recordComments(comments, { artifact: pr.artifact, stepId: step.id, today, blocking, aliases, clashed });
    }

    // Social nudge: a bare APPROVE (no verified engagement) still counts (soft default), but the bot
    // posts a friendly public @-mention inviting the reviewer to run the companion. Idempotent via
    // pr.nudged; only on the writer path (a platform comment, not a ledger write) — and never on a
    // closed step, where it would @-mention reviewers on an already-merged PR.
    if (!readOnly && !alreadyDone) {
      const nudged = new Set(pr.nudged || []);
      for (const rv of pull.reviews) {
        if (rv.state !== 'APPROVED' || parseEngagement(rv.body) === 'verified' || !rv.login || nudged.has(rv.login)) continue;
        if (poster(platform, pr.number, nudgeMessage(rv.login), { cwd: root }).ok) nudged.add(rv.login);
      }
      pr.nudged = [...nudged];
    }

    const pred = gatePredicate({
      // Carried, not applied: E72 is the row that caps `needed` with it.
      active: headCount.capacity.active,
      step, approvals, currentHash: curHash, acceptedHashes: acceptedHashes(epicDir, pr.artifact),
      threadsResolved, merged: pull.merged, solo, requireEngagement: reqEng,
      // Which steps may be skipped is a fact about THIS epic's route (E35), so it is resolved from the
      // ledger here rather than from a module-level set that answered the same for every epic.
      optional: optionalStepsFor(state),
    });

    // Say the arithmetic, not just the verdict (rule 6): the count, and which half of it holds the gate
    // — only the base until E72 caps the risk step, and labelled that way so nobody reads a number the
    // gate is not enforcing as the reason it did or did not pass.
    // `have: null` is a step whose approvals were never counted (inherited from a parent epic, or
    // skipped): there is no head count to report and no requirement to report either.
    const count = pred.have === null
      ? 'approvals not counted here'
      : `${pred.have} approved; count: ${gateRuleSum(pred.gateRule)}${gateRuleEnforced(pred.gateRule)}${pred.short ? ` — ${pred.short} short` : ''}`;
    log(`  ${c.bold(pr.artifact)} ${c.dim(`(PR #${pr.number}, rule: ${pred.rule}, ${count})`)}`);
    if (alreadyDone) {
      // The step keeps its `done` status and the chain is untouched — re-advancing would reset the
      // next step, and moving it back to in_review would un-ship work already built on it. What this
      // pass DOES do is record the approvals that arrived, so `gate status` tells the truth about how
      // many of them are live against the current artifact.
      // A DEFERRED step reads as passed, so it lands here too — but nothing was approved, and "already
      // done … the rule no longer holds" would describe a pass that never happened. Say what is true: the
      // review is still owed, and what it still needs (E37). The approvals themselves are kept either way:
      // a sync of a step that reads as passed only ever adds to its record (`upsertBridge`'s `closed`).
      if (stepStatus(step) === 'deferred') {
        info(`${step.id} is deferred — approvals re-synced, chain not re-advanced; its review is still owed`);
        for (const m of pred.missing) hand(`still owed: ${m}`);
      } else {
        const verdict = pred.passed ? 'the rule still holds' : `the rule no longer holds${pred.staleDropped ? ` (${pred.staleDropped} stale)` : ''}`;
        info(`${step.id} already done — approvals re-synced, chain not re-advanced; ${verdict}`);
        for (const m of pred.missing) hand(`recorded gap: ${m}`);
      }
    } else if (pred.passed) {
      // The merge is the close (E18): its date, not the day this sweep happened to run, when the platform
      // says so.
      state = advanceState(state, step, {
        by, date: (typeof pull.mergedAt === 'string' && pull.mergedAt.slice(0, 10)) || today,
        pr: pr.number ?? null, commit: pull.mergeCommit || null, hash: curHash, mergedBy: pull.mergedBy || null,
        // Solo mode passed this gate without counting approvals, and the record says so (E10).
        waived: solo ? 'solo' : null,
      });
      advanced++;
      ok(`gate PASSED — ${step.id} → done; next: ${state.currentStep}`);
    } else {
      state = markInReview(state, step, { by, date: today, pr: pr.number ?? null, hash: curHash });
      for (const m of pred.missing) hand(`still needed: ${m}`);
    }
    // Stamp when this run actually learned something: an open step every time, and a closed one only
    // when the approval record genuinely changed (a re-opened review that was re-approved). Otherwise
    // an identical re-sync would rewrite the date daily and churn the ledger, while a real re-review
    // would leave no trace of when it was reconciled.
    if (!alreadyDone) { pr.lastSyncedAt = today; open.push(pr); }
    else if (JSON.stringify(approvals) !== approvalsBefore) pr.lastSyncedAt = today;
    synced++;
  }

  if (readOnly) {
    info('verified mode: advisory view — CI owns the ledger, nothing written locally');
    return { synced, advanced };
  }
  // Belt-and-braces: the upserts above already return canonical order, but a ledger this run only
  // READ (no matching target, or a pre-canonical file written by an older release) still gets sorted
  // here, so the first sweep after the upgrade converges the file once and never churns it again.
  approvals = canonicalApprovals(approvals);
  comments = canonicalComments(comments);
  hubPrs = canonicalHubPrs(hubPrs);
  if (stampedOld.stamped) info(`${epic}: recorded the platform login on ${stampedOld.stamped} older approval/comment record(s) that named a roster name`);
  writeJSON(ledger.files.approvals, approvals);
  writeJSON(ledger.files.comments, comments);
  writeMirrored(ledger.files.productPrs, ledger.files.hubPrs, hubPrs);
  writeState(ledger.files.state, state);
  refreshApprovalRecord(epicDir, open, approvals, today); // the dated side file lists them in the same order
  return { synced, advanced };
}

// `yad gate ci` — the self-sufficient entry point Product CI calls on platform events. Path B: CI
// never writes the ledger to the review branch — during review the platform PR/MR is the source of
// truth, and the ledger is reconciled onto the default branch at merge.
//
//   PRE-MERGE (a held step, no --merged and nothing advanced): READ-ONLY. The predicate is
//   evaluated for visibility, but nothing is committed or pushed — so an in-flight approval is never
//   dismissed and the PR's required checks never strand on a CI commit.
//
//   MERGE (--merged, PR/MR closed+merged): the artifact reached the default branch via the human
//   merge; the workflow checks out the default branch. CI runs the sync — the PR reads merged=true,
//   so the predicate ADVANCES the step, flips the artifact `status:` to approved (syncStatuses), and
//   commits the advance to the default branch. CI re-reads approvals fresh from the platform, so it
//   needs no ledger pre-seeded on the branch.
//
// CI is the SOLE writer of the ledger and only ever commits to the default branch; humans never
// commit gate-state files (enforced by the ledger-guard check). Sweep mode (no --branch) advances
// merged-but-stuck reviews found in the locally checked-out default-branch ledgers.
// Shape 8 on a VERIFIED Product. `yad migrate` refuses to move `epics/EP-discovery/` there, because CI
// owns the ledger and the ledger guard rejects a person's commit that moves it. The gate bot is the one
// writer allowed to, so the move happens here — the same rule as every other verified-mode shape change:
// the gate write IS the migration. Returns the paths it wrote, or null when nothing moved.
//
// It refuses, and moves nothing, on everything `yad migrate` refuses (an open review, two product levels,
// a collision, an unreadable ledger) and on one thing more: checks committed in the repo that predate the
// Foundation. Moving the ledger under those would put it where CI stops nobody from hand-editing it, so
// the project keeps the old spelling — which every command still reads — until `yad update` lands.
//
// Two refusals are about the CHECKOUT, not the project, and exist for the documented manual recovery
// (`yad gate ci … --merged` run by a person), since CI's own checkout is always fresh and on the default
// branch: `dirty` — uncommitted or untracked files under either folder BEFORE this run began (the move
// copies what is on disk, so they would be committed and pushed to the default branch), and a HEAD that
// is not the default branch (the push goes to the default branch whatever is checked out).
export function convertProductLevel(root, hub, { git = (...a) => run('git', a, { cwd: root }), defaultBranch = 'main', dirty = false } = {}) {
  if (!isVerifiedLedger(hub)) return null;
  const move = planProductMove(root, { verified: true, ci: true });
  if (!move) return null;
  const out = (r) => (r?.ok ? String(r.stdout || '').trim() : '');
  const head = out(git('rev-parse', 'HEAD'));
  const onDefault = out(git('rev-parse', '--abbrev-ref', 'HEAD')) === defaultBranch
    || (!!head && head === out(git('rev-parse', '--verify', '-q', `origin/${defaultBranch}`)));
  if (!onDefault) {
    info(`the product level stays in ${move.from}/ — this checkout is not on ${defaultBranch}, and the move is only ever made there`);
    return null;
  }
  if (dirty) {
    warn(`the product level stays in ${move.from}/ — this checkout has uncommitted changes under ${move.from}/ or ${move.to}/, and the move would commit them; commit or discard them first`);
    return null;
  }
  if (move.action !== 'move') {
    info(`the product level stays in ${move.from}/ for now — ${move.detail}`);
    return null;
  }
  const stale = staleFoundationGuards(root);
  if (stale.length) {
    warn(`the product level stays in ${move.from}/ — the wired checks predate the Foundation (${stale.join(', ')}); run \`yad update\` and commit the refreshed checks, and the next gate run moves it`);
    return null;
  }
  try {
    const written = applyProductMove(root, move, { backup: false });
    ok(`the product level moved: ${move.from}/ → ${move.to}/ as ${FOUNDATION_EPIC} (shape 8)`);
    return written;
  } catch (e) {
    // `applyProductMove` has already put everything back. Red, not quiet: nothing here should fail.
    fail(`the product level was not moved — ${e.message}`);
    process.exitCode = 1;
    return null;
  }
}

export async function gateCi(root, { branch, pr, merged = false, today, push = true, reader = readPr } = {}) {
  const { hub } = loadProduct(root);
  if (!hub?.platform) { warn('no Product platform configured (.sdlc/hub.json) — nothing to sync'); return { synced: 0 }; }
  const git = (...args) => run('git', args, { cwd: root });
  const defaultBranch = hub.default_branch || (() => { const h = git('rev-parse', '--abbrev-ref', 'HEAD').stdout; return h && h !== 'HEAD' ? h : 'main'; })();
  // Push is decided AFTER the sync, once we know whether any step advanced: a held step (no advance,
  // not merged) is read-only and pushes nothing; an advance lands on the default branch (see below).

  // Whether the old product-level folder (or foundation/) held a person's uncommitted work BEFORE this
  // run writes anything — read now, because the sync below legitimately modifies that ledger. Only asked
  // when a move could happen at all; an unreadable status counts as dirty (refuse rather than guess).
  const legacyDirtyBefore = (merged || !branch) && isVerifiedLedger(hub)
    && fs.existsSync(path.join(epicRoot(root, DISCOVERY_EPIC), '.sdlc', 'state.json'))
    ? (() => {
      const st = git('status', '--porcelain', '--untracked-files=all', '--', epicRel(DISCOVERY_EPIC), FOUNDATION_DIR);
      return !st.ok || String(st.stdout || '').trim() !== '';
    })()
    : false;

  // Build the work list: one job per (epic, artifact) — from the event branch, or a full sweep.
  const jobs = [];
  if (branch) {
    const parsed = parseReviewBranch(branch);
    if (!parsed) { warn(`${branch} is not a review/EP-*/<artifact> branch — nothing to sync`); return { synced: 0 }; }
    // A review branch named for the OLD spelling whose ledger has already moved (shape 8) is the
    // Foundation's review: its steps keep `artifact: "discovery/"`, so the job resolves to them there.
    // Without this, that merge finds no ledger at `epics/EP-discovery/` and is dropped.
    const moved8 = parsed.epic === DISCOVERY_EPIC
      && !fs.existsSync(path.join(epicRoot(root, DISCOVERY_EPIC), '.sdlc', 'state.json'))
      && fs.existsSync(path.join(epicRoot(root, FOUNDATION_EPIC), '.sdlc', 'state.json'));
    jobs.push({ epic: moved8 ? FOUNDATION_EPIC : parsed.epic, base: parsed.base, artifact: artifactFromBase(parsed.base), branch, pr });
  } else {
    // `epicIds`, not a listing of `epics/`: the Foundation's ledger lives in `foundation/` (E75), and a
    // sweep that missed it would leave a merged Foundation review stranded, un-advanced, for ever.
    for (const e of epicIds(root)) {
      // Sweep mode isolates per-epic failures: one corrupt ledger must not block the other epics'
      // syncs in an unattended CI run. The run still exits non-zero so the bad file gets fixed.
      let ledger;
      try {
        ledger = loadLedger(epicRoot(root, e));
      } catch (err) {
        warn(`${e}: ${err.message} — skipping this epic`);
        process.exitCode = 1;
        continue;
      }
      if (!ledger.state) continue;
      for (const p of ledger.hubPrs || []) {
        const step = findReviewStep(ledger.state, p.artifact);
        if (!step || isPassed(step)) continue;
        jobs.push({ epic: e, base: base(p.artifact), artifact: p.artifact, branch: p.branch, pr: p.number });
      }
    }
    // No early return: a sweep with nothing to sync may still have the product level to move (below).
    if (!jobs.length) info('no open review PRs to sync');
  }

  let synced = 0;
  const touched = new Set();
  const failedEpics = new Set();
  const advancedEpics = new Set(); // epics whose step actually passed this run (merge OR a swept merge)
  const statusFiles = new Map();   // epic -> the artifact files syncStatuses rewrote (staging allowlist)
  for (const job of jobs) {
    const epicDir = epicRoot(root, job.epic);
    // Event mode (--branch) targets a single epic: fail loudly. Sweep mode skips the bad epic.
    let ledger;
    try {
      ledger = loadLedger(epicDir);
    } catch (err) {
      if (branch) throw err;
      warn(`${job.epic}: ${err.message} — skipping this epic`);
      process.exitCode = 1;
      continue;
    }
    if (!ledger.state) {
      warn(`${job.epic}: no epic state on the checked-out branch — the review branch is cut from the default branch, so it should carry it`);
      // Red on a named merge: that review's approval would otherwise be dropped by a run that ends green,
      // and the scheduled reconcile would repeat the same silent no-op for as long as it looks back.
      if (branch && merged) process.exitCode = 1;
      continue;
    }
    const step = findReviewStep(ledger.state, job.artifact);
    if (!step) { warn(`${job.epic}: no review step for ${job.artifact} — skipping`); continue; }

    // The merge event may fire before any hub-prs record exists (Path B never wrote one pre-merge) —
    // build the entry from the event itself so the advance commit carries it onto the default branch.
    const existing = (ledger.hubPrs || []).find((x) => x.artifact === job.artifact);
    const number = Number(job.pr) || existing?.number || null;
    // Same migration as gateSync, at the one point CI knows the OLD pointer: stamp the approvals it
    // recorded before replacing it, or a re-review on the replacement PR can never be told from a
    // re-read of the old one and stays permanently stale.
    //
    // MERGE PHASE ONLY. This is the one approvals.json write gateCi itself performs, and pre-merge the
    // run persists nothing and commits nothing — so a stamp there would be a working-tree edit with no
    // purpose, left behind for `ledger-guard` to reject (and a `git checkout` broad enough to undo it
    // would also revert approvals this run never wrote, e.g. a human's uncommitted manual record). The
    // stamp loses nothing by waiting: pre-merge writes nothing, so the OLD pointer is still on disk when
    // the merge event arrives and re-runs this. In sweep mode `job.pr` comes from the ledger itself, so
    // `number === existing.number` and the condition is false regardless.
    if (merged && existing?.number != null && number !== existing.number) {
      const stamped = stampLegacyPr(ledger.approvals, step.id, existing.number);
      if (stamped) {
        writeJSON(ledger.files.approvals, canonicalApprovals(ledger.approvals));
        info(`${job.epic}: recorded PR #${existing.number} on ${stamped} approval(s) that predate PR provenance`);
      }
    }
    if (!existing || existing.number !== number || existing.branch !== job.branch) {
      ledger.hubPrs = upsertHubPr(ledger.hubPrs, {
        step: step.id, artifact: job.artifact, platform: hub.platform, number,
        url: existing?.url ?? null, branch: job.branch, lastSyncedAt: existing?.lastSyncedAt ?? null,
      });
      writeMirrored(ledger.files.productPrs, ledger.files.hubPrs, ledger.hubPrs);
    }

    // No overlay: at merge the artifact is on the default branch CI checked out, so artifactHash
    // binds to the reviewed content directly when CI re-reads the platform.
    let failed = false;
    try {
      // A branch event that is not a merge can never advance (the predicate requires merged), so it
      // is read-only under Path B — run it as a dry sync that persists nothing to the working tree.
      const r = await gateSync(root, { epic: job.epic, artifact: job.artifact, today, reader, dryRun: !!branch && !merged });
      synced += r.synced;
      // When the step actually ADVANCED (the merge phase, or a swept merge the schedule observed),
      // reflect it in the artifact frontmatter (draft → approved). Keyed off the advance, not the
      // --merged flag, so the GitLab scheduled sweep also flips status on a merge it catches. Never
      // on a held step: CI must not touch the artifact while the owner is editing it pre-merge.
      if (r.advanced > 0) {
        advancedEpics.add(job.epic);
        const st = await syncStatuses(root, { epic: job.epic });
        // Remember exactly which artifacts were rewritten — that, and nothing else, is what the
        // commit below may stage outside the ledger (see the staging allowlist).
        statusFiles.set(job.epic, [...(statusFiles.get(job.epic) || []), ...(st.files || [])]);
      }
    } catch (err) {
      if (branch) throw err; // event mode: one epic — surface the failure
      warn(`${job.epic}: sync failed — ${err.message} — skipping this epic`);
      process.exitCode = 1;
      failed = true;
    }
    if (failed) { failedEpics.add(job.epic); continue; } // a failed epic's partial state must not be committed by this run
    touched.add(job.epic);
  }
  // The product-level move runs AFTER the jobs, so an event for `review/EP-discovery/…` resolved and
  // advanced its ledger in the old folder first, and only on the DEFAULT branch — a merge run or a sweep,
  // never a review head, where CI writes nothing (Path B).
  // E64: the login stamp for every OTHER epic — one with no open review, which the job list never reaches.
  // An epic this run synced was already stamped by `gateSync`, and a failed one is left alone. It is a
  // write in its own right, so it can be the reason this run commits, exactly as the product-level move is.
  // It runs after the jobs, so a job that throws leaves no stamp behind uncommitted. Only on a `--merged`
  // run — the merge event, and the wired reconcile that re-runs it — never pre-merge (Path B). An epic with
  // uncommitted changes under `.sdlc` or `reviews` is skipped: the commit below stages both, and must not
  // carry a person's edit along with the stamp. One epic's unreadable ledger is named and skipped; it does
  // not stop the review that merged.
  let stampedCount = 0;
  if (merged) {
    const aliases = legacyLogins(hub);
    const clashed = ambiguousLegacyNames(hub);
    for (const e of aliases.size ? epicIds(root) : []) {
      if (touched.has(e) || failedEpics.has(e)) continue;
      const dirty = git('status', '--porcelain', '--untracked-files=all', '--', path.join(epicRel(e), '.sdlc'), path.join(epicRel(e), 'reviews'));
      if (!dirty.ok || String(dirty.stdout || '').trim() !== '') continue;
      const dir = epicRoot(root, e);
      try {
        const led = loadLedger(dir);
        if (!led.state) continue;
        const st = stampLegacyLogins({ approvals: led.approvals, comments: led.comments }, { aliases, clashed, acceptedFor: (a) => acceptedHashes(dir, a) });
        if (!st.stamped) continue;
        const approvalsNow = canonicalApprovals(st.approvals);
        const commentsNow = canonicalComments(st.comments);
        if (JSON.stringify(approvalsNow) !== JSON.stringify(canonicalApprovals(led.approvals))) writeJSON(led.files.approvals, approvalsNow);
        if (JSON.stringify(commentsNow) !== JSON.stringify(canonicalComments(led.comments))) writeJSON(led.files.comments, commentsNow);
        touched.add(e);
        stampedCount += st.stamped;
        info(`${e}: recorded the platform login on ${st.stamped} older approval/comment record(s) that named a roster name`);
      } catch (err) {
        warn(`${e}: older records not stamped — ${err.message}`);
      }
    }
  }
  const moved = (merged || !branch)
    ? convertProductLevel(root, hub, { git, defaultBranch, dirty: legacyDirtyBefore })
    : null;
  if (!touched.size && !moved) return { synced };

  // Path B: CI never writes the ledger to the review branch. A held step that did not advance is
  // read-only here — during review the platform PR/MR is the source of truth (native approvals/
  // threads); the ledger is reconciled onto the default branch at merge. Keeping CI off the PR head
  // is what stops an approval from being dismissed and required checks from stranding. Correctness is
  // unaffected: the merge phase re-reads approvals fresh from the platform (readPr).
  const advancedAny = advancedEpics.size > 0;
  if (!merged && !advancedAny && !moved) {
    // EVENT mode (--branch) pre-merge is read-only (Path B): the gate was evaluated with a dry sync
    // that persists nothing, so the one working-tree write is the hub-prs.json seed above (which let
    // the dry sync find the PR). Restore exactly that file per epic so the checkout stays clean —
    // never touching anything else, so a local `yad gate ci --branch` cannot disturb unrelated files.
    // The stampLegacyPr backfill is gated on `merged` above precisely so there is no second file to
    // undo: a restore wide enough to cover approvals.json would also revert records this run never
    // wrote — a human's uncommitted manual approval, or an untracked ledger seed `git clean` deletes.
    //
    // SWEEP mode (no --branch) reaches here too, and its sync was NOT dry, so state.json/comments.json
    // and reviews/*.md may be modified and are deliberately left alone: reverting a sync that genuinely
    // ran would discard platform state the run just recorded. A bare `yad gate ci` that advances
    // nothing therefore leaves those files dirty for the operator to inspect and commit (or discard).
    // (A sweep that MOVES the product level does not come here: it commits, and those sync writes are
    // recorded with the move rather than left behind.)
    // BOTH names of the PR ledger. It is written under its new name and its old one (see
    // MIRRORED_FILES, cli/manifest.mjs), so restoring only one leaves the other behind as an
    // untracked file — a read-only run that dirties the checkout, which is exactly what this block
    // exists to prevent.
    for (const e of touched) {
      for (const name of ['product-prs.json', 'hub-prs.json']) {
        const hp = path.join(epicRel(e), '.sdlc', name);
        git('checkout', '-q', '--', hp); // restore it if it was tracked
        git('clean', '-fq', '--', hp);   // remove it if the event first-seeded it (untracked)
      }
    }
    info('pre-merge: gate evaluated; the ledger reconciles on the default branch at merge — nothing pushed');
    return { synced };
  }
  const target = defaultBranch; // CI only ever commits the ledger to the default branch

  // Stage what this merge-phase run owns, per epic, by an EXPLICIT ALLOWLIST — never `git add -A`
  // over the whole epic directory:
  //  - always → the ledger (.sdlc) + the generated reviews/ summaries.
  //  - advanced → plus exactly the artifact files syncStatuses rewrote (the draft → approved flip).
  //    The owner's artifact is otherwise theirs, and is left untouched.
  //
  // `git add -A -- epics/<e>` would also sweep up anything else sitting in that directory. In CI the
  // checkout is fresh, so it is invisible there — but `yad gate ci … --merged` on the default branch
  // is the DOCUMENTED manual recovery for a stuck gate, and a human's checkout is rarely pristine.
  // Half-finished edits to another artifact, or a stray untracked file, would be committed and pushed
  // straight to the default branch under a `chore(gate)` subject with [skip ci] — unreviewed, and
  // contradicting the "CI commits only the ledger" contract every doc in this repo states.
  for (const e of touched) {
    git('add', '-A', '--', path.join(epicRel(e), '.sdlc'));
    git('add', '-A', '--', path.join(epicRel(e), 'reviews'));
    for (const f of statusFiles.get(e) || []) git('add', '--', f);
  }
  // The move: exactly the files it wrote, by name, and the old folder's removal — the same allowlist rule.
  if (moved) {
    for (const f of moved) git('add', '--', f);
    git('add', '-A', '--', epicRel(DISCOVERY_EPIC));
  }
  if (git('diff', '--cached', '--quiet').ok) { info('ledger unchanged — nothing to commit'); return { synced }; }
  // [skip ci]: the advance lands on the default branch (no PR trigger) but keeps the marker to guard
  // sibling workflows. CI never pushes the review branch (Path B), so there is no synchronize loop.
  const sync = !branch
    ? 'scheduled gate sync' // sweep is a batch; one subject for the run
    : `advance ${jobs[0].epic}/${jobs[0].base} on merge`;
  // The move, when there is one, is the subject: it is the change a reader of the default branch most
  // needs to find, and a sync subject would name a folder the same commit deletes. The sync goes in the body.
  const subject = moved
    ? `chore(gate): move the product level to ${FOUNDATION_DIR}/ (shape 8) [skip ci]`
    : `chore(gate): ${sync} [skip ci]`;
  const cm = git('commit', '-m', subject, ...(moved && touched.size ? ['-m', `Also: ${sync}.`] : []),
    ...(stampedCount ? ['-m', `Also: recorded the platform login on ${stampedCount} older approval/comment record(s) (E64).`] : []));
  if (!cm.ok) { fail(`commit failed: ${cm.stderr || cm.stdout}`); process.exitCode = 1; return { synced }; }
  ok(`committed gate update: ${c.dim(subject)}`);
  if (!push) return { synced };

  if (pushWithRebase(root, target).ok) { ok(`pushed to origin/${target}`); return { synced }; }
  fail(`could not push to origin/${target}${merged ? ' — protected default branch? allow the gate bot to push the merge advance (see yad-hub-bridge references/bridge.md)' : ''} — or run \`yad gate sync\` locally`);
  process.exitCode = 1;
  return { synced };
}

export async function gateComments(root, { epic, artifact, today, reader = readPr } = {}) {
  const { hub } = loadProduct(root);
  if (!hub?.platform) { warn('no Product platform configured — nothing to fetch'); return; }
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  const targets = (ledger.hubPrs || []).filter((p) => !artifact || p.artifact === artifact);
  if (!targets.length) { warn('no review PR recorded — run `yad gate open` first'); return; }
  for (const pr of targets) {
    const pull = reader(hub.platform, pr.number, { cwd: root });
    if (!pull.ok) { warn(`${pr.artifact}: ${pull.reason}`); continue; }
    const cr = pull.reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
    const unresolved = (pull.threads || []).filter((t) => !t.resolved);
    log(`\n  ${c.bold(pr.artifact)} ${c.dim(`(PR #${pr.number})`)}`);
    if (!cr.length && !unresolved.length) { ok('no unresolved comments — clear to approve/merge'); continue; }
    for (const r of cr) hand(`${r.login}: changes requested ${c.red('(blocking)')}`);
    for (const t of unresolved) info(`${t.login || 'reviewer'}: ${(t.body || '').split('\n')[0]}`);
    writeComments(epicDir, base(pr.artifact), today, [
      ...cr.map((r) => ({ login: r.login, changesRequested: true })),
      ...unresolved,
    ]);
    hand('address them in the artifact, reply on the PR, then ask reviewers to resolve their threads');
  }
}

export async function gateStatus(root, { epic } = {}) {
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir}`); process.exitCode = 1; return; }
  const { hub } = loadProduct(root);
  const solo = isSolo(hub);
  const reqEng = requireEngagement(hub);
  const optional = optionalStepsFor(ledger.state);   // which steps THIS epic's route allows to be skipped
  // E71 — read ONCE for the whole view, not once per step: it is a Product-wide fact, and a per-step
  // read would walk every connected repo's history once for every gate on the screen.
  // NOT `counted`: the per-step loop below already binds that name to this step's engagement-filtered
  // approvals, and two different meanings of one word in one function is how a later edit reads the
  // wrong one.
  const headCount = activePeople(root, { aliases: legacyLogins(hub) });
  log(`\n  ${c.bold(epic)}  ${c.dim(`currentStep: ${ledger.state.currentStep}${solo ? ' — solo mode (approval waived; merge still required)' : ''}`)}`);
  // Printed in solo mode too, exactly as the per-step count is: someone who later switches to team mode
  // can see the number their gates will be capped against, before it starts holding anything.
  log(`  ${c.dim(activeSum(headCount))}`);
  note(c.dim(activeBasis(headCount)));
  for (const s of ledger.state.steps.filter((x) => x.type === 'review+approve')) {
    const accepted = acceptedHashes(epicDir, s.artifact);
    const live = ledger.approvals.filter((a) => a.step === s.id && a.status === 'approved' && !isStaleHash(a.artifactHash, accepted));
    const stale = ledger.approvals.filter((a) => a.step === s.id && a.status === 'approved' && isStaleHash(a.artifactHash, accepted)).length;
    const tags = `${isEscalated(s) ? ', escalated' : ''}${stale ? `, ${stale} stale (revoked)` : ''}`;
    // E7's count, per step, from the step's own risk tags — only its base holds the gate until E72 caps
    // the risk step, and it is labelled so.
    // Distinct PEOPLE, which is why it can differ from the approval count beside it: two approvals from
    // one person are one approver. Printed in solo mode too, where approvals are waived, so a reader who
    // later switches to team mode can see what each gate will then ask for.
    //
    // COUNTED THE WAY THE PREDICATE COUNTS. With `requireEngagement` on, an approval carrying no
    // verified engagement signal is dropped BEFORE people are counted, so a line built from every live
    // approval would report a head count the engine does not recognise. The dropped ones are named
    // rather than hidden, because "two people approved and neither counts" is the fact a reader needs.
    //
    // NO COUNT ON A WAIVED STEP. An inherited step's approvals live under the parent epic and a skipped
    // step was never reviewed, so printing what the count asks for would read as an audit failure on a
    // step the engine deliberately waives.
    const counted = reqEng ? live.filter((a) => a.engagement === 'verified') : live;
    const unengaged = live.length - counted.length;
    const people = new Set(counted.filter((a) => typeof a.approver === 'string' && a.approver.trim()).map((a) => a.approver)).size; // as gatePredicate counts
    const from = `from ${people} ${people === 1 ? 'person' : 'people'}${unengaged ? `, ${unengaged} not engagement-verified (not counted)` : ''}`;
    // A `skipped` flag is honoured here on exactly the terms `gatePredicate` honours it: only on a step
    // THIS epic's route marks optional (`isSkippableStep`). Without that guard a hand-edited
    // `skipped: true` on a required step would read as waived in `gate status` while `gate sync` fell
    // through to the real rule — two read-only views of one ledger disagreeing, and the misleading one
    // is the view a human checks first.
    // `claimsInherited` / `claimsSkipped`, not the canonical state: this note mirrors what
    // `gatePredicate` honours, and the predicate reads the claim. Reading the canonical state here
    // instead would make `gate status` and `gate sync` disagree about a half-stamped step — two
    // read-only views of one ledger, and a human checks this one first.
    const state = stepStatus(s);
    const waived = claimsInherited(s)
      ? `; inherited from ${s.inheritedFrom || 'the parent epic'}`
      : (claimsSkipped(s) && isSkippableStep(s.id, optional)) ? '; skipped (N/A)'
        : (state === 'deferred' && isSkippableStep(s.id, optional)) ? `; deferred (still owed${s.debt === true ? ', as debt' : ''})` : '';
    // The shortfall, the same number `gatePredicate` returns as `short`. Printed here because this is the
    // surface people read when they want to know where a gate stands, and a count with no distance to it
    // is half the fact.
    const rule = gateRuleFor(s);
    const short = Math.max(0, rule.needed - people);
    const count = waived || `; count: ${gateRuleSum(rule)}${gateRuleEnforced(rule)}${short && !solo ? ` — ${short} short` : ''}`;
    // The CANONICAL state, not the raw field: a pre-shape-7 chain says `blocked` where it means
    // `todo`, and printing the file's word in the one view people read to see where a gate stands
    // would make the old vocabulary outlive the model. A status this release cannot name falls back
    // to the raw string with a mark, because inventing a name for it would hide the finding
    // `yad doctor` reports as `step:unknown-status`.
    // A deferred step lets the chain continue, but nobody has reviewed it: a green tick beside "still
    // owed" would read as reviewed, so it keeps the open-step mark (E37).
    // A debt being paid back (E41) is no longer `deferred`, so the tag above does not show; say it here,
    // until the review passes and clears the flag.
    const paying = s.debt === true && state !== 'deferred' ? '; owed as debt — being paid back' : '';
    log(`    ${isPassed(s) && state !== 'deferred' ? c.green('✓') : c.yellow('•')} ${s.id} ${c.dim(`— ${state || `${s.status} (unknown)`}, ${live.length} approval(s) ${from}${tags}${count}${paying}`)}`);
    if (s.closed && typeof s.closed === 'object' && !Array.isArray(s.closed)) log(`      ${c.dim(closedLine(s.closed))}`);
  }
}

// PURE — the audit-trail commit message for a state repair (mirrors buildCheckpointMessage). The
// subject passes the Product commit-message gate (valid type `chore`, scope `gate`, no trailing period)
// and carries [skip ci]: the repair lands on the default branch, where a re-triggered gate workflow
// would have nothing to do. No Task trailer and no Co-Authored-By footer — this is machine state a
// human corrected, not an authored code change.
export function buildRepairMessage({ epic, steps }) {
  const subject = 'chore(gate): repair epic state — close stranded author step(s) [skip ci]';
  return `${subject}\n\nEpic: ${epic}\nClosed: ${steps.join(', ')}\nReason: YAD-STATE-005 — author step(s) left behind a completed review gate`;
}

// `yad gate repair <epic>` — heal the chain inconsistency `doctor` reports as YAD-STATE-005: an author
// step stranded at in_progress behind a review gate that already advanced (issue #131). A pre-fix
// `gate sync` could leave this, and it never self-heals — sync skips a step that is already `done` — so
// the damage needs an explicit, auditable correction.
//
// Only state.json is touched, and `--push` commits ONLY that file: a `[skip ci]` chore commit must never
// sweep up an unrelated edit. It lands on the DEFAULT branch, where `ledger-guard` (which polices the
// machine-written ledger on review PRs) does not apply — so this stays compatible with "CI is the sole
// writer of the ledger" during review.
export async function gateRepair(root, { epic, push = false, allowBranch = false, dryRun = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir}/.sdlc/state.json`); process.exitCode = 1; return { closed: [] }; }

  log(c.bold(`\nyad gate repair  ${c.dim(epic)}`));
  const violations = stateInvariants(ledger.state);
  if (!violations.length) { ok('epic state is consistent — nothing to repair'); return { closed: [] }; }
  for (const v of violations) warn(`${v.message} [${v.code}]`);

  // Read leniently: a repair heals a broken ledger, and a broken hub.json must not stop it (E18).
  const closed = repairState(ledger.state, { by: closingActor(root, readJSON(productConfigPath(root), null)), date: today });
  if (dryRun) { info('dry run — nothing written'); return { closed }; }
  writeState(ledger.files.state, ledger.state);
  ok(`closed ${closed.length} stranded author step(s): ${c.dim(closed.join(', '))}`);
  if (!push) { hand('re-run `yad doctor` to confirm, then commit epics/*/.sdlc/state.json (or re-run with --push)'); return { closed }; }

  // --- publish: narrow, default-branch-only commit of the one repaired file ---
  preflightGuardReadiness(root);
  const git = productGit(root);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  const defaultBranch = resolveDefaultBranch(git, loadProduct(root).hub);
  if (!guardDefaultBranch(branch, defaultBranch, { allowBranch, cmd: 'yad gate repair' })) return { closed };

  const spec = path.relative(root, ledger.files.state);
  if (!git('add', '--', spec).ok) { fail(`git add failed for ${spec}`); process.exitCode = 1; return { closed }; }
  if (git('diff', '--cached', '--quiet', '--', spec).ok) { info('state.json unchanged on disk — nothing to commit'); return { closed }; }

  const message = buildRepairMessage({ epic, steps: closed });
  const cm = git('commit', '-m', message, '--', spec);
  if (!cm.ok) {
    git('reset', '-q', '--', spec); // never leave it staged for an unrelated commit to sweep up
    fail(`git commit failed — ${cm.stderr.split('\n')[0] || cm.code}`);
    process.exitCode = 1;
    return { closed };
  }
  ok(`committed the repair: ${c.dim(message.split('\n')[0])}`);
  // Push HEAD to its OWN branch — with --allow-branch we are not on the default branch, and pushing
  // HEAD:defaultBranch would publish a WIP branch straight to it.
  if (pushWithRebase(root, branch).ok) { ok(`pushed to origin/${branch}`); return { closed }; }
  fail(`could not push to origin/${branch} — a protected branch, or an unresolvable rebase conflict`);
  hand('run `git pull --rebase` and re-run `yad gate repair <epic> --push`');
  process.exitCode = 1;
  return { closed };
}

// `head` overrides the review branch the PR is opened against — `open-pr` delegates here after pushing
// the user's checked-out branch, which for a per-story review (review/EP-*/stories-S01) does NOT equal
// the branch this would otherwise recompute (artifactFromBase collapses stories-S01 → stories/). Pass
// the real pushed head so the PR targets a branch that exists. `creator` is injected in tests.
export async function gateOpen(root, { epic, artifact, head, creator = createPr, hasBranch = branchExists, today = new Date().toISOString().slice(0, 10) } = {}) {
  const { hub } = loadProduct(root);
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir}`); process.exitCode = 1; return; }
  if (!artifact) { fail('artifact is required: `yad gate open <epic> <artifact>`'); process.exitCode = 1; return; }
  const step = findReviewStep(ledger.state, artifact);
  if (!step) { fail(`no review step for ${artifact}`); process.exitCode = 1; return; }
  // The step's own spelling from here on: `stories` and `stories/` name one review, and a pointer
  // recorded under the other spelling would be a second pointer that nothing stamps or replaces.
  artifact = step.artifact || artifact;
  // A step SET ASIDE — skipped or deferred — has no review to open. The chain already walks past it, so
  // `markInReview` would leave the ledger alone while the PR opened anyway: a live review of a step the
  // chain has walked past, which no merge can advance. Put the step back first (E37).
  const aside = stepStatus(step);
  if (aside === 'skipped' || aside === 'deferred') {
    fail(`${step.id} is ${aside} — there is no review to open`);
    hand(`put it back in the chain first: yad ${aside === 'skipped' ? 'unskip' : 'undefer'} ${epic} ${step.id.replace(/-review$/, '')}`);
    process.exitCode = 1;
    return;
  }
  const b = base(artifact);
  const branch = head || `review/${epic}/${b}`;
  const domains = touchedDomains(epicDir, step);
  warnUnlockedContract(epicDir, artifact);
  warnIncompleteDiscovery(epicDir, artifact);

  const verified = isVerifiedLedger(hub);
  // The review branch must exist ON ORIGIN: this command opens a PR against it, it never creates or
  // pushes it, and `gh pr create --head` explicitly does NOT push either — so a branch that is only
  // local still fails inside the platform CLI, which is the opaque error this guard exists to replace.
  // `open-pr` pushes the checked-out branch first and passes it as `head`, so that path is unaffected;
  // only the branch this command COMPUTED is checked. A null answer means git could not be asked (no
  // checkout, unreachable origin) — not evidence of absence, so it warns rather than blocks.
  //
  // Checked BEFORE any state is written: marking the step in_review and then refusing would leave the
  // ledger claiming a review is open that was never opened.
  if (!head && hub?.platform) {
    const present = hasBranch(root, branch);
    if (present === false) {
      fail(`review branch '${branch}' is not on origin`);
      hand(`git push -u origin ${branch}`);
      hand('or run `yad open-pr` from the branch — it pushes, then opens the review PR');
      process.exitCode = 1;
      return;
    }
    if (present === null) warn(`could not verify that '${branch}' is on origin — opening the PR against it anyway`);
  }

  // Outside verified mode (local, OR a platform with no gate-sync CI) there is no CI to write the
  // ledger, so the local command marks the step in_review. In verified mode CI is the sole writer.
  // The author step this run closes, if any: its record gets the PR number once the PR exists (below).
  const author = ledger.state.steps.find((s) => s?.type === 'author' && s.artifact === step.artifact && s.id !== step.id);
  const closesAuthor = !verified && !!author && !isPassed(author) && !author.closed;
  if (!verified) {
    ledger.state = markInReview(ledger.state, step, { by: closingActor(root, hub), date: today, hash: artifactHash(epicDir, step.artifact) });
    writeState(ledger.files.state, ledger.state);
  }
  if (!hub?.platform) {
    warn('no Product platform — marked in_review locally (no PR opened)');
    ok(`${step.id} → in_review`);
    return;
  }

  // Open the PR. In verified mode CI records the hub-prs entry (and advances) on the default branch at
  // merge — `yad gate open` never commits gate-state files (the ledger-guard check enforces that), and
  // CI writes nothing pre-merge. With a local ledger the local command records the PR itself (no CI will).
  const body = fillHubTemplate({
    epic, artifact, step, owner: ownerOf(epicDir), domains,
    active: activePeople(root, { aliases: legacyLogins(hub) }).capacity.active,
    // Does this epic's ROUTE have an architecture step? Asked of the recorded route and never of the
    // chain (`routeLacksStep`): a truncated legacy chain has no `architecture` row and is not on a
    // short lane, and telling its reviewer in writing that it is would be a false claim in a record
    // people act on. This repo's own e2e fixture is exactly that shape.
    hasArchitecture: !routeLacksStep(ledger.state, 'architecture'),
  });
  // Assignee = whoever opens the review PR: `@me` on GitHub, which `gh` resolves on the right host
  // (buildPrArgs sends it when no assignee is named), and the login `glab` reports on GitLab.
  // NO REVIEWERS ARE REQUESTED (E62): they used to come from the roster's reviewer and domain-owner
  // roles, and there is no stored list to pick them from any more. The team requests them on the PR,
  // and E68 will suggest them from history. Said on the way out, so nobody waits for a request that
  // was never sent.
  const committer = hub.platform === 'gitlab' ? platformLogin(root, hub.platform) : null;
  const assignees = committer ? [committer] : [];
  const labels = domains.map((d) => `domain:${d}`); // empty unless the step names its repos (touchedDomains)
  info(`opening review ${hub.platform === 'gitlab' ? 'MR' : 'PR'} on branch ${branch} …`);
  const r = creator(hub.platform, { title: `review: ${artifact} (${epic})`, body, base: hub.default_branch || 'main', head: branch, assignees, labels, cwd: root });
  if (!r.ok) { warn(`could not open PR (${r.reason || 'unknown'})${verified ? ' — open it manually; CI records the gate on merge' : '; step is in_review locally'}`); return; }

  if (!verified) {
    // The PR number from its path segment — the first number in the URL can be the repo (`acme/2048/pull/9`).
    const opened = Number(prNumberFromUrl(r.url)) || null;
    // A re-opened review replaces the pointer. Stamp the OLD number on this step's approvals that predate
    // PR provenance first, exactly as `gateCi` does at merge: once the pointer names the new PR, the next
    // sync would stamp THAT number on them, so an approval given again on the new PR could never be told
    // from a re-read of the old one and, on GitLab (whose older records hold no submission time), would stay
    // stale for good.
    const previous = (ledger.hubPrs || []).find((x) => x.artifact === artifact)?.number ?? null;
    // Also when the new URL carries no number: the old pointer is about to be overwritten either way.
    if (previous != null && previous !== opened && stampLegacyPr(ledger.approvals, step.id, previous)) {
      writeJSON(ledger.files.approvals, canonicalApprovals(ledger.approvals));
    }
    ledger.hubPrs = upsertHubPr(ledger.hubPrs, { step: step.id, artifact, platform: hub.platform, number: opened, url: r.url, branch, lastSyncedAt: null });
    writeMirrored(ledger.files.productPrs, ledger.files.hubPrs, ledger.hubPrs);
    // The record was written before the PR existed, and the first close wins, so no later sync can add
    // the number. Add it here, to the record this run wrote and to nothing older (E18).
    const number = ledger.hubPrs.find((p) => p.artifact === artifact)?.number ?? null;
    const closedHere = closesAuthor ? ledger.state.steps.find((s) => s.id === author.id) : null;
    if (number != null && closedHere?.closed?.via === 'review-opened' && closedHere.closed.pr == null) {
      closedHere.closed = closingRecord({ ...closedHere.closed, pr: number });
      writeState(ledger.files.state, ledger.state);
    }
  }
  ok(`opened ${r.url}`);
  hand('no reviewers were requested — ask them on the PR itself');
  hand(verified
    ? 'reviewers approve/comment there; CI advances the gate on the default branch when it is merged'
    : `reviewers approve/comment there; then run \`yad gate sync ${epic} ${artifact}\``);
  return { url: r.url };
}

// `yad gate review <epic> [artifact]` — assemble + print the grounding bundle the companion skill uses
// to generate the 60-sec trailer / swipe cards and to run the grounded chat (artifact + risk tags +
// contract + PR + repo code-maps). The CLI never calls an LLM; the skill (yad-review-companion)
// consumes this JSON, generates, and posts back via the platform (trailer/comments/approval).
// Assemble (but don't print) the Shape grounding bundle. Shared by `review` and `walkthrough` so the
// pair walkthrough adds an ordered stop-list on top of the exact same grounding the companion uses.
// Returns { error } when there is no epic state, else { bundle, epicDir, hub }.
function reviewBundle(root, { epic, artifact } = {}) {
  const { hub, repos } = loadProduct(root);
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) return { error: `no epic state at ${epicDir}` };
  const pr = (ledger.hubPrs || []).find((p) => !artifact || p.artifact === artifact) || null;
  const art = artifact || pr?.artifact || null;
  const step = art ? findReviewStep(ledger.state, art) : null;
  const bundle = {
    epic,
    artifact: art,
    platform: hub?.platform || null,
    pr: pr ? { number: pr.number, url: pr.url } : null,
    // `gateRule` is E7's per-step rule — the number of distinct approvers the count asks for and the
    // arithmetic behind it. Only its base holds the gate until E72 caps the risk step. `escalated` says
    // the step carries a risk tag that raises the count.
    step: step
      ? { id: step.id, riskTags: step.risk_tags || [], escalated: isEscalated(step), gateRule: gateRuleFor(step) }
      : null,
    // E71 — the live capacity count, as an OBJECT and never as the sentence, so a consumer reads the
    // number rather than parsing prose (the same discipline `gateRule` follows). `active: null` means a
    // source could not be read, which is NOT the same fact as "few people": `unknown` says which.
    // Its own read, and still once per command: `reviewBundle` has exactly two callers, `gate review`
    // and `gate walkthrough`, and neither runs alongside `gate status` or `gate sync`.
    activePeople: (() => {
      const counted = activePeople(root, { aliases: legacyLogins(hub) });
      return { active: counted.capacity.active, windowDays: counted.capacity.days, basis: counted.capacity.basis, unknown: counted.unknown };
    })(),
    artifactPath: art ? path.join(epicDir, art) : null,
    contractPath: art && base(art) === 'architecture' ? path.join(epicDir, 'contract.md') : null,
    touchedDomains: step ? touchedDomains(epicDir, step) : [],
    repos: (repos || []).map((r) => ({
      name: r.name,
      codeMap: r.name ? path.join(root, '.sdlc/code-context', r.name, 'code-map.md') : null,
    })),
    requireEngagement: requireEngagement(hub),
    markers: {
      trailerBegin: '<!-- yad:trailer -->', noblock: '<!-- yad:noblock -->',
      engagementVerified: '<!-- yad:engagement verified -->', pair: '<!-- yad:pair -->',
    },
  };
  return { bundle, epicDir, hub };
}

export async function gateReview(root, { epic, artifact } = {}) {
  const r = reviewBundle(root, { epic, artifact });
  if (r.error) { fail(r.error); process.exitCode = 1; return; }
  log(JSON.stringify(r.bundle, null, 2));
  return r.bundle;
}

// `yad gate walkthrough <epic> [artifact]` — the Shape pair-review grounding: the same bundle PLUS
// an ordered `stops[]` from the artifact's review diff (highest-risk first). The skill (yad-pair-review)
// walks the stops and runs the two-way teaching session. Deterministic sequencing only — no LLM here.
export async function gateWalkthrough(root, { epic, artifact, runner = run } = {}) {
  const r = reviewBundle(root, { epic, artifact });
  if (r.error) { fail(r.error); process.exitCode = 1; return; }
  const { bundle, hub } = r;
  const defaultBranch = hub?.default_branch || 'main';
  let stops = [];
  if (bundle.artifactPath) {
    const rel = path.relative(root, bundle.artifactPath) || bundle.artifact;
    const diff = runner('git', ['-C', root, 'diff', `${defaultBranch}...HEAD`, '--', rel]);
    if (diff.ok && diff.stdout.trim()) {
      stops = sequenceDiff(diff.stdout, { contractPath: bundle.contractPath });
    } else if (!diff.ok) {
      note(`could not read the artifact diff (${defaultBranch}...HEAD) in ${root} — is the review branch checked out and the base correct?`);
    }
  }
  const out = { ...bundle, stops };
  log(JSON.stringify(out, null, 2));
  // Diagnostics to STDERR so STDOUT stays pure JSON (the skill / e2e parse it).
  if (!stops.length) note('no stops from the artifact diff — walk the artifact by section (see yad-pair-review)');
  return out;
}

// `yad gate trailer <epic> [artifact] --body <text> [--pr <n>]` — the skill generates the 60-second
// briefing text and passes it here; this upserts it idempotently into the review PR/MR description as a
// delimited block, so regenerating on every artifact change never duplicates it. A platform write only.
export async function gateTrailer(root, { epic, artifact, body, number, getBody = getPrBody, editBody = editPrBody } = {}) {
  const { hub } = loadProduct(root);
  if (!hub?.platform) { warn('no Product platform configured — the trailer posts to the PR/MR (local has none)'); return; }
  if (!body || !String(body).trim()) { fail('trailer body is required: `yad gate trailer <epic> <artifact> --body <text>` (the companion generates it)'); process.exitCode = 1; return; }
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  const pr = (ledger.hubPrs || []).find((p) => !artifact || p.artifact === artifact) || null;
  const n = number || pr?.number;
  if (!n) { warn('no PR number — pass `--pr <n>` (in verified mode the PR is recorded in the ledger only at merge)'); return; }
  const cur = getBody(hub.platform, n, { cwd: root });
  if (!cur.ok) { fail(`could not read PR #${n} description: ${cur.reason || 'unknown'}`); process.exitCode = 1; return; }
  const r = editBody(hub.platform, n, upsertTrailerBlock(cur.body, String(body).trim()), { cwd: root });
  if (!r.ok) { fail(`could not update PR #${n}: ${r.reason || 'unknown'}`); process.exitCode = 1; return; }
  ok(`trailer posted to PR #${n}`);
  return { number: n };
}

// ---- helpers ------------------------------------------------------------------------------------
const base = (artifact) => artifactBase(artifact);

// `active` is the caller's already-read count (E71, `activePeople`), or null when it did not read one.
// Passed in rather than read here for the same reason the predicate takes it: this builds a string and
// must stay callable from a test without a Product on disk.
export function fillHubTemplate({ epic, artifact, step, owner, domains, hasArchitecture = true, active = null }) {
  const rule = gateRuleFor(step);
  return [
    '## Artifact under review',
    `- Epic: \`${epic}\``,
    `- Artifact: \`${artifact}\``,
    `- Gate step: \`${step.id}\``,
    `- Owner: \`${owner}\``,
    '',
    '## Impact & Risk (front-half)',
    `- **Domains / repos touched:** ${domains.join(', ') || 'n/a'}`,
    `- **Risk tags:** ${(step.risk_tags || []).join(', ') || 'none'}`,
    // What the count asks for, stated on the artifact people are about to review rather than left for
    // them to discover later (rule 6). Only the base holds this gate; the risk step starts holding gates
    // when E72 caps it. Said plainly here so nobody treats the full number as the requirement.
    `- **Approvals needed:** ${rule.base} (enforced) · full count ${gateRuleSum(rule)}${rule.riskStep ? ' (the risk step is advisory until the capacity cap)' : ''}`,
    // E71 — how many people could give those approvals, stated beside the ask so a reviewer can see a
    // gate that asks for more people than the team has BEFORE they start. It caps nothing yet.
    //
    // THIS IS THE ONE SURFACE WHERE THE COUNT BECOMES A LASTING RECORD. Everywhere else it is printed
    // live and gone; a PR description is written once, at `gate open`, and read for as long as the PR
    // exists. The number can be different an hour later, and on a different machine: `gate open` run
    // from a laptop that has not cloned the connected repos reads "not counted" and would leave that
    // word in the body for good. So the line dates itself. It does NOT go quiet on an unknown (Part 3),
    // it just says WHEN it could not count, which is the only honest thing a frozen line can say.
    `- **Active people:** ${active === null ? 'not counted when this PR was opened (an unreadable source is never read as few people — `yad gate status` counts it live)' : `${active} when this PR was opened (reported only — it does not cap the count yet; \`yad gate status\` counts it live)`}`,
    '',
    '## How to review (this drives the gate)',
    '- **Approve** to record your approval; **comment / request changes** to hold the gate.',
    '- This step advances when approvals are satisfied, all threads are resolved, and this PR is merged.',
    '',
    // Required by the Product `pr-template` gate (check_hub_body). Mirrors the Checklist block of the
    // committed static template (yad-pr-template/templates/hub/<platform>/) so the generated body
    // passes on the first CI run.
    '## Checklist',
    '- [ ] `owner` set in the artifact frontmatter (inherited from `epic.md`)',
    // The contract item asks about re-locking a surface. An epic on a short lane (E40) has no
    // architecture step and therefore no `contract.md` and no lock, ever — so the box can never be
    // ticked and never needs to be. A checklist carrying an item nobody on this route can act on
    // teaches people to tick without reading, which costs more than the line is worth. Replaced
    // rather than dropped, so the reviewer is told the surface is out of scope instead of finding a
    // gap where a contract line used to be. `hasArchitecture` defaults true: every caller outside
    // this file predates the flag, and the classic wording is the safe answer for an unknown chain.
    hasArchitecture
      ? '- [ ] Contract re-locked (`.sdlc/contract-lock.json`) if the surface changed (architecture only)'
      : '- [ ] Contract surface unchanged — this epic is on a short lane with no architecture gate, so it may consume the shared surface but never change it',
    '- [ ] Risk tags reflect the real surface touched (contract/auth/payments raise the approval count)',
    '- [ ] No secrets or tokens in the artifact or this description',
  ].join('\n');
}

// The dated, human-readable approval record beside the ledger. An older approval still carries the
// role the roster gave it (E62 left those fields on disk), and it is printed as recorded.
function refreshApprovalRecord(epicDir, targets, approvals, today) {
  for (const pr of targets) {
    const stepApprovals = approvals.filter((a) => a.step === pr.step && a.status === 'approved');
    const file = path.join(epicDir, 'reviews', `${base(pr.artifact)}--${today}--approved.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = [
      `# Approval record — ${pr.artifact} — ${today}`, '',
      '## Approved by',
      ...stepApprovals.map((a) => `- ${a.approver}${a.role ? ` — ${a.role}` : ''}${a.domain ? ` (${a.domain})` : ''} — approved ${a.date}${a.source ? ` (${a.source})` : ''}`),
      '',
    ];
    fs.writeFileSync(file, lines.join('\n') + '\n');
  }
}
