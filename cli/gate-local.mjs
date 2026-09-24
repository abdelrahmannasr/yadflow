// `yad gate approve|comment|advance` (E112) — the review gate on a Product with NO platform.
//
// With a platform, the PR/MR is the review: `yad gate sync` reads its approvals and threads into the file
// ledger and advances the step on the merge. With no platform there is nothing to read, so `gate sync` and
// `gate ci` return at once — and the `yad-review-gate` skill used to append approvals and comments by hand
// and advance the chain by following a hand-written copy of `advanceState`. These three verbs are that path
// in the engine. The decisions were the user's (2026-09-24):
//   1. TWO human acts, as on a platform: a reviewer records an approval (`approve`, which only reports the
//      verdict), and someone then advances the step (`advance`, which runs the predicate). Approving never
//      advances, the way approving a PR never merges it.
//   2. NO PLATFORM ONLY. With a platform the approvals come from the PR/MR, and on a verified ledger CI is the
//      only writer — two sources of truth for one gate is the thing this refuses.
//   3. An approval records the artifact's fingerprint (`artifactHash`), so an edit after it revokes it, as a
//      platform approval is revoked. An older hand-written record with no fingerprint still counts.
//   4. `comment` records who took part (`comments.json`); the words stay in `reviews/*--comments.md`, which
//      the skill writes. With no platform there are no threads, so a comment never holds the gate.
// None of this stops a git merge conflict on the ledger: the writers upsert (one record per person) and sort,
// so equal content gives equal bytes, and after a conflict a person keeps either side and runs the verb again.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { c, log, ok, info, warn, hand, fail, note, writeJSON } from './lib.mjs';
import { isVerifiedLedger } from './manifest.mjs';
import {
  epicRel, epicRoot, loadLedger, findReviewStep, artifactHash, acceptedHashes, gatePredicate, printable, advanceState,
  gateRuleSum, gateRuleEnforced, legacyLogins, canonicalApprovals, canonicalComments, optionalStepsFor, writeState,
  isPassed, stepStatus, readFrontmatter,
} from './epic-state.mjs';
import { activePeople, activeSum, activeBasis } from './people.mjs';
import { actorName } from './platform.mjs';
import { refreshIndexAfterWrite } from './product-index.mjs';
import { loadProduct, isSolo, requireEngagement } from './gate.mjs';

// A name typed on the command line lands in a committed file that is printed on other people's screens
// (`yad gate status`, `yad history show`). So it is taken only as it would print: no control or bidi
// characters, no line break, no space at either end (`printable` is the cleaner every printed value goes
// through). It is REFUSED rather than cleaned, so what is recorded is exactly what was typed.
export function reviewerName(v) {
  if (typeof v !== 'string') return null;
  return v.length && printable(v) === v ? v : null;
}

// Everything the three verbs share, or null after a refusal (the reason is printed, the exit code set).
function localGate(root, { epic, artifact, verb }) {
  const usage = `yad gate ${verb} <epic> <artifact>${verb === 'advance' ? '' : ' --by <name>'}`;
  if (!artifact) { fail(`usage: ${usage}`); process.exitCode = 1; return null; }
  const { hub } = loadProduct(root);
  // One check covers both refusals: a verified ledger needs a platform (`isVerifiedLedger`), so any
  // platform at all means the approvals live on the PR/MR, not here.
  if (hub?.platform) {
    fail(`\`yad gate ${verb}\` is for a Product with no platform — this one reviews on ${printable(String(hub.platform)) ?? 'a platform'}, so nothing is written`);
    if (isVerifiedLedger(hub)) hand('CI owns this ledger: approvals, comments and the advance land from the review PR/MR when it merges (`yad gate ci`)');
    else hand(`review on the PR/MR, then run \`yad gate sync ${epic} ${artifact}\` — it reads the approvals and advances the step when the PR merges`);
    process.exitCode = 1;
    return null;
  }
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicRel(epic)}/.sdlc/state.json`); process.exitCode = 1; return null; }
  const step = findReviewStep(ledger.state, artifact);
  if (!step) { fail(`${epic} has no review step for ${artifact}`); process.exitCode = 1; return null; }
  return { hub, epicDir, ledger, step, solo: isSolo(hub), reqEng: requireEngagement(hub) };
}

// A gate is recorded against only while it is OPEN. A step not reached yet has no review to approve:
// opening it is `yad gate open`, which also closes its author step with a record — recording here instead
// would let `advance` close that author step with none. A step that already passed is refused by
// `advance` (the chain is one-way) but NOT by `approve`/`comment`: a re-review after an edit records
// approvals bound to the new content, as `gate sync` re-syncs a done step, so `gate status` tells the truth.
function refuseUnopened(g, { epic, artifact, verb }) {
  const state = stepStatus(g.step);
  if (state === 'in_review' || isPassed(g.step)) return false;
  fail(`${g.step.id} is ${state || 'in no known state'} — its review is not open, so there is nothing to ${verb === 'comment' ? 'comment on' : verb}`);
  hand(`open the review first: \`yad gate open ${epic} ${artifact}\``);
  process.exitCode = 1;
  return true;
}

// One person, one spelling. The gate counts distinct names exactly (`gatePredicate`), so `Bob` after `bob`
// would be a second approver — and once the full count is enforced (E108), one person could meet a
// two-approver gate. A name that differs from one already on the step only by case is refused, naming
// the spelling to use (E112 review).
function refuseRespelled(names, name, { epic, artifact, verb }) {
  const other = names.find((n) => typeof n === 'string' && n !== name && n.toLowerCase() === name.toLowerCase());
  if (!other) return false;
  fail(`${name} differs only by case from ${printable(other) ?? 'a name'} already recorded on this step — one person must have one spelling`);
  hand(`yad gate ${verb} ${epic} ${artifact} --by ${printable(other) ?? '<name>'}`);
  process.exitCode = 1;
  return true;
}

// The one count every verb reports, read once per command (E71) — or handed in by a test, which must not
// walk git from inside a fixture.
function countPeople(root, hub, today, headCount) {
  return headCount || activePeople(root, { today: today || undefined, aliases: legacyLogins(hub) });
}

function judge(g, epicDir, people) {
  return gatePredicate({
    active: people.capacity.active,
    step: g.step, approvals: g.ledger.approvals,
    currentHash: artifactHash(epicDir, g.step.artifact), acceptedHashes: acceptedHashes(epicDir, g.step.artifact),
    // No platform: no threads to resolve and no merge to wait for. `advance` itself is the human act.
    threadsResolved: true, merged: true,
    solo: g.solo, requireEngagement: g.reqEng, optional: optionalStepsFor(g.ledger.state),
  });
}

// The verdict line, in `gate sync`'s words, and the --json form of it.
function verdict(pred, step, artifact) {
  const count = pred.have === null
    ? 'approvals not counted here'
    : `${pred.have} approved; count: ${gateRuleSum(pred.gateRule)}${gateRuleEnforced(pred.gateRule, pred.cap)}${pred.short ? ` — ${pred.short} short` : ''}`;
  log(`  ${c.bold(artifact)} ${c.dim(`(rule: ${pred.rule}, ${count})`)}`);
  return {
    step: step.id, artifact, rule: pred.rule, passed: !!pred.passed, have: pred.have, gateRule: pred.gateRule ?? null,
    cap: pred.cap ?? null, short: pred.short ?? null, missing: pred.missing, staleDropped: pred.staleDropped ?? 0,
  };
}

// Who authored the artifact, as far as the files say: the epic's `owner:`. A warning only — the engine
// cannot tell who is typing, and on a local ledger nothing else stops an author approving their own work.
function ownerOf(epicDir) {
  const owner = readFrontmatter(path.join(epicDir, 'epic.md')).owner;
  return typeof owner === 'string' && owner.trim() ? owner.trim() : null;
}

// The last git author of the artifact, or null (no git, no commit, a folder artifact with nothing in it).
function lastAuthor(epicDir, artifact, runner) {
  try {
    const out = runner('git', ['log', '-1', '--format=%an', '--', artifact], { cwd: epicDir });
    return String(out || '').trim() || null;
  } catch { return null; }
}
const gitRunner = (cmd, args, opts) => execFileSync(cmd, args, { ...opts, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// `yad gate approve <epic> <artifact> --by <name>` — record one approval. Never advances.
export async function gateApprove(root, { epic, artifact, by, engagement = null, today, headCount = null, runner = gitRunner } = {}) {
  const g = localGate(root, { epic, artifact, verb: 'approve' });
  if (!g) return;
  const name = reviewerName(by);
  if (!name) {
    fail(by == null || by === true ? 'who is approving? `--by <name>` is required' : '`--by` must be a name as it would print: no line breaks, control characters, or spaces at either end');
    hand(`yad gate approve ${epic} ${artifact} --by <name>`);
    process.exitCode = 1;
    return;
  }
  if (engagement != null && engagement !== 'verified' && engagement !== 'none') {
    fail(`--engagement is verified or none, not ${printable(String(engagement)) ?? 'that'}`);
    process.exitCode = 1;
    return;
  }
  if (refuseUnopened(g, { epic, artifact, verb: 'approve' })) return;
  if (refuseRespelled(g.ledger.approvals.filter((a) => a.step === g.step.id).map((a) => a.approver), name, { epic, artifact, verb: 'approve' })) return;
  const { epicDir, ledger, step } = g;
  const hash = artifactHash(epicDir, step.artifact);
  const eng = engagement || 'none';
  // Filter-then-push, keyed on (step, approver), as `upsertHubPr` does: one record per person. A bridge
  // record (from a platform the Product once had) is left alone — it is another source's history.
  // The same person approving the same content again keeps the record as it was, date included, so a
  // repeat is a byte-identical no-op rather than a new line in the ledger's history.
  const mine = (a) => a.step === step.id && a.approver === name && a.source !== 'bridge';
  const was = ledger.approvals.find(mine);
  const same = was && was.status === 'approved' && was.artifactHash === hash && (was.engagement ?? 'none') === eng;
  const record = same ? was : { artifact: step.artifact, step: step.id, approver: name, status: 'approved', date: today, artifactHash: hash, engagement: eng };
  g.ledger.approvals = canonicalApprovals([...ledger.approvals.filter((a) => !mine(a)), record]);

  for (const author of new Set([ownerOf(epicDir), lastAuthor(epicDir, step.artifact, runner)].filter(Boolean))) {
    if (author.toLowerCase() === name.toLowerCase()) warn(`${name} is also ${author === ownerOf(epicDir) ? 'the epic\'s owner' : 'the last author of ' + step.artifact} — an author should not approve their own work (recorded anyway: the engine cannot tell who is typing)`);
  }
  if (!same) {
    // The ledger only. The dated `reviews/*--approved.md` is the skill's full named record (count,
    // approvers, commenters, what is still required): writing the short `gate sync` list here would erase
    // it on every approval of the day (E112 review).
    writeJSON(ledger.files.approvals, g.ledger.approvals);
    refreshIndexAfterWrite(root, g.hub);
  }
  if (same) info(`${name} had already approved this content of ${step.artifact} — nothing changed`);
  else ok(`${name} approved ${step.artifact} (${step.id})${was ? ' — their earlier approval is replaced' : ''}`);

  const people = countPeople(root, g.hub, today, headCount);
  log(`  ${c.dim(activeSum(people))}`);
  note(c.dim(activeBasis(people)));
  const pred = judge(g, epicDir, people);
  const gate = verdict(pred, step, step.artifact);
  if (isPassed(step)) info(`${step.id} already passed — the approval is recorded against today's content; the chain is not moved`);
  else if (pred.passed) hand(`the gate would pass — advance it with: yad gate advance ${epic} ${artifact}`);
  else for (const m of pred.missing) hand(`still needed: ${m}`);
  return { epic, approver: name, changed: !same, gate };
}

// `yad gate comment <epic> <artifact> --by <name> [--count N] [--new-round]` — record who took part in a
// round of comments. One record per (step, commenter, round). The round is the step's latest; with
// `--new-round`, the next one — but only for someone already in the latest round (see below).
export async function gateComment(root, { epic, artifact, by, count = null, newRound = false, today } = {}) {
  const g = localGate(root, { epic, artifact, verb: 'comment' });
  if (!g) return;
  const name = reviewerName(by);
  if (!name) {
    fail(by == null || by === true ? 'who commented? `--by <name>` is required' : '`--by` must be a name as it would print: no line breaks, control characters, or spaces at either end');
    hand(`yad gate comment ${epic} ${artifact} --by <name> [--count <n>]`);
    process.exitCode = 1;
    return;
  }
  const n = count == null ? 1 : Number(count);
  if (!Number.isInteger(n) || n < 1 || !/^\d+$/.test(String(count ?? '1'))) {
    fail(`--count is how many comments this person made this round — a whole number from 1, not ${printable(String(count)) ?? 'that'}`);
    process.exitCode = 1;
    return;
  }
  if (refuseUnopened(g, { epic, artifact, verb: 'comment' })) return;
  if (refuseRespelled(g.ledger.comments.filter((cm) => cm.step === g.step.id).map((cm) => cm.commenter), name, { epic, artifact, verb: 'comment' })) return;
  const { epicDir, ledger, step } = g;
  // A round written by hand as text (`"round": "1"`) is the same round as the number — read it as one, or
  // the same person gets two records for one round.
  const roundOf = (cm) => (Number.isInteger(cm.round) ? cm.round : typeof cm.round === 'string' && /^\d+$/.test(cm.round) ? Number(cm.round) : 0);
  const onStep = ledger.comments.filter((cm) => cm.step === step.id);
  const latest = onStep.reduce((m, cm) => Math.max(m, roundOf(cm)), 0);
  // A round is one version of the artifact: the owner addresses the comments by editing it, and the next
  // round reviews the edit. So each record carries the fingerprint it was made against, and `--new-round`
  // opens the next round only when the artifact has CHANGED since the latest round's records. Otherwise it
  // joins the latest round: a retry of the same command is a no-op, and a second reviewer who also types
  // `--new-round` lands beside the first, instead of a round that never happened (E112 review). A round
  // written before E112 carries no fingerprint, so after it `--new-round` opens the next round, as asked.
  const hash = artifactHash(epicDir, step.artifact);
  const latestHashes = onStep.filter((cm) => roundOf(cm) === latest).map((cm) => cm.artifactHash);
  const changed = !latestHashes.includes(hash);
  const round = latest === 0 ? 1 : newRound && changed ? latest + 1 : latest;
  if (newRound && latest > 0 && !changed) info(`${step.artifact} has not changed since round ${latest} began — this joins round ${latest}`);
  const mine = (cm) => cm.step === step.id && cm.commenter === name && roundOf(cm) === round;
  const was = ledger.comments.find(mine);
  const same = was && was.count === n && was.round === round && was.artifactHash === hash;
  const record = same ? was : { artifact: step.artifact, step: step.id, commenter: name, round, count: n, date: today, artifactHash: hash };
  ledger.comments = canonicalComments([...ledger.comments.filter((cm) => !mine(cm)), record]);
  if (!same) {
    writeJSON(ledger.files.comments, ledger.comments);
    refreshIndexAfterWrite(root, g.hub);
  }
  if (same) info(`${name}'s round ${round} on ${step.artifact} already says ${n} comment(s) — nothing changed`);
  else ok(`${name}: ${n} comment(s) on ${step.artifact}, round ${round}${was ? ` (was ${was.count})` : ''}`);
  info('a comment never holds the gate here — with no platform there are no threads to resolve');
  return { epic, step: step.id, artifact: step.artifact, commenter: name, round, count: n, changed: !same };
}

// `yad gate advance <epic> <artifact>` — pass the gate when the predicate holds. The second human act.
export async function gateAdvance(root, { epic, artifact, today, headCount = null } = {}) {
  const g = localGate(root, { epic, artifact, verb: 'advance' });
  if (!g) return;
  const { epicDir, ledger, step } = g;
  if (isPassed(step)) {
    const deferred = stepStatus(step) === 'deferred';
    fail(deferred
      ? `${step.id} is deferred — the chain has already moved past it, and its review is still owed`
      : `${step.id} already passed — a gate advances once, and the chain is never pulled back`);
    if (deferred) hand(`put it back in the chain first: \`yad undefer ${epic} ${step.id.replace(/-review$/, '')}\``);
    process.exitCode = 1;
    return;
  }
  if (refuseUnopened(g, { epic, artifact, verb: 'advance' })) return;
  const people = countPeople(root, g.hub, today, headCount);
  log(`  ${c.dim(activeSum(people))}`);
  note(c.dim(activeBasis(people)));
  const pred = judge(g, epicDir, people);
  const gate = verdict(pred, step, step.artifact);
  if (!pred.passed) {
    fail(`${step.id} does not pass yet — nothing is written`);
    for (const m of pred.missing) hand(`still needed: ${m}`);
    process.exitCode = 1;
    return { epic, advanced: false, currentStep: ledger.state.currentStep ?? null, gate };
  }
  const state = advanceState(ledger.state, step, {
    by: actorName(root, null), date: today, hash: artifactHash(epicDir, step.artifact),
    // Nothing merged: the close is the approval (E18's `approved`), with no PR and no commit to name.
    via: 'approved',
    waived: g.solo ? 'solo' : null,
    // Every cap is recorded (E72), exactly as `gate sync` records it on a merge.
    capped: pred.rule === 'count' && pred.cap?.capped ? { needed: pred.gateRule.needed, to: pred.cap.to, active: pred.cap.active } : null,
  });
  writeState(ledger.files.state, state);
  refreshIndexAfterWrite(root, g.hub);
  ok(`gate PASSED — ${step.id} → done; next: ${state.currentStep}`);
  return { epic, advanced: true, currentStep: state.currentStep ?? null, gate };
}
