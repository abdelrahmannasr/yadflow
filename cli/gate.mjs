// `yad gate open|sync|comments|status` — the PR/MR-driven front-half review gate.
// The platform PR/MR is the review UI; this command syncs its state into the file ledger and, when
// the gate passes (approvals satisfied + all comment threads resolved + PR merged), auto-advances the
// step. The merge click is the human approval act, so front steps still never machine_advance.
import fs from 'node:fs';
import path from 'node:path';
import {
  c, log, ok, info, warn, hand, fail, readJSONStrict, writeJSON, run,
} from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import {
  epicRoot, loadLedger, findReviewStep, artifactBase, artifactHash, gatePredicate,
  advanceState, markInReview, isEscalated, parseReviewBranch, artifactFromBase,
  upsertHubPr, DISCOVERY_FILES,
} from './epic-state.mjs';
import { readPr, mapApprovers, createPr, reviewersForScopes, resolveCommitterLogin } from './platform.mjs';
import { syncStatuses } from './artifact-status.mjs';
import { err } from './errors.mjs';

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

// Touched domains, resolved from files (gating.md): architecture => epic.repos; stories => union of
// every story's repos; otherwise none.
export function touchedDomains(epicDir, step) {
  if (!isEscalated(step)) return [];
  if (step.id === 'stories-review') {
    const dir = path.join(epicDir, 'stories');
    if (!fs.existsSync(dir)) return [];
    const set = new Set();
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      for (const r of (frontmatter(path.join(dir, f)).repos || [])) set.add(r);
    }
    return [...set];
  }
  return frontmatter(path.join(epicDir, 'epic.md')).repos || [];
}

// The artifact owner shown in the review PR/MR body. Feature epics carry it in epic.md; the discovery
// front-zero (EP-discovery) has no epic.md, so fall back to roadmap.md's frontmatter owner.
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

// A null discovery hash means the discovery set is incomplete (a required artifact is missing), so the
// review is not yet reviewable and an approval would not be hash-bound. Name the missing files so the
// owner can complete the set before the gate is opened/advanced (mirrors warnUnlockedContract).
function warnIncompleteDiscovery(epicDir, artifact) {
  if (artifactBase(artifact) !== 'discovery') return;
  if (artifactHash(epicDir, artifact) !== null) return;
  const missing = DISCOVERY_FILES.filter((f) => !fs.existsSync(path.join(epicDir, f)));
  warn(`discovery set incomplete — missing ${missing.join(', ')}; review is not yet reviewable (approvals will not be hash-bound until the full set exists)`);
}

// Fail fast on a corrupt or wrong-shape hub config: a silently-defaulted hub.json would degrade
// every gate to file-only without anyone noticing, and a typo'd platform would read as "no bridge".
function loadHub(root) {
  const hubFile = path.join(root, PROJECT_FILES.hubConfig);
  const regFile = path.join(root, PROJECT_FILES.reposRegistry);
  // Distinguish an ABSENT hub.json (null default → fine, file-only gate) from one that exists but
  // holds literal `null` (malformed — must not silently downgrade to file-only).
  const hub = readJSONStrict(hubFile, null);
  if (hub === null && fs.existsSync(hubFile)) {
    throw err('YAD-STATE-002', `${hubFile}: contains \`null\` — expected a config object`, 'fix the file or re-run `yad setup`');
  }
  if (hub !== null) {
    if (typeof hub !== 'object' || Array.isArray(hub)) throw err('YAD-STATE-002', `${hubFile}: expected a JSON object`, 'fix the file or re-run `yad setup`');
    if (![null, undefined, 'github', 'gitlab'].includes(hub.platform)) {
      throw err('YAD-CFG-001', `${hubFile}: unknown platform '${hub.platform}'`, 'expected github, gitlab, or null — fix the file or re-run `yad setup`');
    }
    if (hub.roster !== undefined && !Array.isArray(hub.roster)) {
      throw err('YAD-STATE-002', `${hubFile}: expected \`roster\` to be an array`, 'fix the file or re-run `yad setup`');
    }
  }
  const registry = readJSONStrict(regFile, { repos: [] });
  if (!Array.isArray(registry?.repos)) throw err('YAD-STATE-002', `${regFile}: expected a \`repos\` array`, 'fix the file or re-run `yad setup`');
  return { hub, repos: registry.repos };
}

// Solo mode (a lone developer): waive the approval requirement — on GitHub you cannot approve your own
// PR, so an approval gate would deadlock. The review PR/MR and its merge stay (CI runs on the PR; the
// merge advances the step). Recorded per-project in hub.json by `yad setup`.
const isSolo = (hub) => !!(hub && (hub.solo === true || hub.review_gate?.solo === true));

// Bridge mode: a platform AND the gate-sync CI explicitly enabled (the canonical `bridge_enabled`,
// or the older `bridge`). ONLY then is CI the sole ledger writer — so `gate open`/`sync` stay
// hands-off. A platform without the bridge (no gate-sync CI installed) keeps the local write path,
// or reviews could never advance. Mirrors plan.mjs hubActions.
const isBridge = (hub) => !!(hub?.platform && (hub.bridge_enabled === true || hub.bridge === true));

// Re-add this step's bridge approvals from the current platform state (drop+re-add => dismissals and
// revocations vanish idempotently; manual approvals are never touched). Preserve the artifactHash a
// reviewer first approved against unless their review is newer (a genuine re-approval) — that is what
// makes "revoke only when the artifact changed" work.
function upsertBridge(approvals, recs, { stepId, artifact, curHash, today }) {
  const keyOf = (name, role, domain) => `${stepId}|${name}|${role}|${domain || ''}`;
  const prior = new Map(
    approvals.filter((a) => a.step === stepId && a.source === 'bridge')
      .map((a) => [keyOf(a.approver, a.role, a.domain), a]),
  );
  const kept = approvals.filter((a) => !(a.step === stepId && a.source === 'bridge'));
  for (const r of recs) {
    const was = prior.get(keyOf(r.name, r.role, r.domain));
    let artHash = curHash;            // first time we see this approval => bind to current content
    let approvedAt = r.submittedAt || today;
    if (was) {
      // We only adopt the new hash when the platform PROVES a genuinely newer review (a later
      // submittedAt). Otherwise — same review, or a platform that gives no timestamp (GitLab) — we
      // KEEP the hash they originally approved, so a later artifact change still revokes the approval.
      const genuinelyNewer = r.submittedAt && was.approvedAt && r.submittedAt > was.approvedAt;
      if (!genuinelyNewer) {
        artHash = was.artifactHash ?? curHash;
        approvedAt = was.approvedAt ?? approvedAt;
      }
    }
    kept.push({
      artifact, step: stepId, approver: r.name, role: r.role,
      ...(r.domain ? { domain: r.domain } : {}),
      status: 'approved', date: today, source: 'bridge',
      artifactHash: artHash, approvedAt,
      ...(r.unverified ? { unverified: true } : {}),
    });
  }
  return kept;
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
function recordComments(comments, { artifact, stepId, today, roster, blocking }) {
  if (!blocking.length) return comments;
  const byName = (login) => (roster.find((r) => r.login === login)?.name) || login || 'reviewer';
  const roleOf = (login) => (roster.find((r) => r.login === login)?.role) || 'reviewer';
  const round = (comments.filter((cm) => cm.step === stepId).reduce((m, cm) => Math.max(m, cm.round || 0), 0)) + 1;
  const counts = new Map();
  for (const t of blocking) counts.set(t.login, (counts.get(t.login) || 0) + 1);
  const kept = comments.filter((cm) => !(cm.step === stepId && cm.round === round));
  for (const [login, count] of counts) {
    kept.push({ artifact, step: stepId, commenter: byName(login), role: roleOf(login), round, count, date: today });
  }
  return kept;
}

// ---- actions ------------------------------------------------------------------------------------

export async function gateSync(root, { epic, artifact, today, reader = readPr, local = false, dryRun = false } = {}) {
  const { hub, repos } = loadHub(root);
  if (!hub?.platform) { warn('no hub platform configured (.sdlc/hub.json) — file-only gate, nothing to sync'); return { synced: 0 }; }
  const platform = hub.platform;
  const roster = hub.roster || [];
  const defaultReviewers = 1;
  const solo = isSolo(hub);
  // Local invocation in bridge mode is ADVISORY: CI is the sole ledger writer, so a human run reads
  // the platform and prints the predicate but writes nothing. CI calls gateSync with local=false.
  // Without the bridge (platform but no gate-sync CI) the local command stays the writer.
  // dryRun forces the same read-only behavior regardless of bridge — used for the Path B pre-merge
  // evaluation, which must persist nothing (gateCi passes dryRun for a held branch event).
  const readOnly = (local && isBridge(hub)) || dryRun;
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir}/.sdlc/state.json`); process.exitCode = 1; return { synced: 0 }; }

  let { approvals, comments, hubPrs, state } = ledger;
  const targets = hubPrs.filter((p) => !artifact || p.artifact === artifact);
  if (!targets.length) { warn(`no open review PR recorded for ${epic}${artifact ? ` / ${artifact}` : ''} (run \`yad gate open\` first)`); return { synced: 0 }; }

  let synced = 0;
  let advanced = 0;
  for (const pr of targets) {
    const step = findReviewStep(state, pr.artifact);
    if (!step) { warn(`no review step for ${pr.artifact}`); continue; }
    // Already advanced: a re-sync must not re-run advance (it would reset the next step's status /
    // currentStep backward). The gate is one-way per step.
    if (step.status === 'done') { info(`${pr.artifact}: ${step.id} already done — skipping`); continue; }
    const domains = touchedDomains(epicDir, step);
    const pull = reader(platform, pr.number, { cwd: root });
    // A failed platform read must not pass as a green no-op: flag the run non-zero so CI surfaces it
    // (the wired workflow's reconcile/sweep aggregates this exit) instead of silently not advancing.
    if (!pull.ok) { warn(`${pr.artifact}: ${pull.reason} — skipping (file-only)`); process.exitCode = 1; continue; }

    const curHash = artifactHash(epicDir, pr.artifact);
    warnUnlockedContract(epicDir, pr.artifact);
    warnIncompleteDiscovery(epicDir, pr.artifact);
    const recs = mapApprovers(pull.reviews, { roster, repos, touchedDomains: domains, headOid: pull.headOid });
    approvals = upsertBridge(approvals, recs, { stepId: step.id, artifact: pr.artifact, curHash, today });

    const changeRequested = pull.reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
    const unresolved = (pull.threads || []).filter((t) => !t.resolved);
    const threadsResolved = unresolved.length === 0 && changeRequested.length === 0;
    const blocking = [
      ...changeRequested.map((r) => ({ login: r.login, changesRequested: true })),
      ...unresolved,
    ];
    // Advisory (read-only) sync must not touch the working tree — defer the reviews/*.md write.
    if (!readOnly) writeComments(epicDir, base(pr.artifact), today, blocking);
    comments = recordComments(comments, { artifact: pr.artifact, stepId: step.id, today, roster, repos, blocking });

    const pred = gatePredicate({
      step, approvals, currentHash: curHash, touchedDomains: domains,
      defaultReviewers, threadsResolved, merged: pull.merged, solo,
    });

    log(`  ${c.bold(pr.artifact)} ${c.dim(`(PR #${pr.number}, rule: ${pred.rule})`)}`);
    if (pred.passed) {
      state = advanceState(state, step);
      advanced++;
      ok(`gate PASSED — ${step.id} → done; next: ${state.currentStep}`);
    } else {
      state = markInReview(state, step);
      for (const m of pred.missing) hand(`still needed: ${m}`);
    }
    pr.lastSyncedAt = today;
    synced++;
  }

  if (readOnly) {
    info('bridge mode: advisory view — CI owns the ledger, nothing written locally');
    return { synced, advanced };
  }
  writeJSON(ledger.files.approvals, approvals);
  writeJSON(ledger.files.comments, comments);
  writeJSON(ledger.files.hubPrs, hubPrs);
  writeJSON(ledger.files.state, state);
  refreshRoster(epicDir, targets, approvals, today);
  return { synced, advanced };
}

// `yad gate ci` — the self-sufficient entry point hub CI calls on platform events. Path B: CI
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
export async function gateCi(root, { branch, pr, merged = false, today, push = true, reader = readPr } = {}) {
  const { hub } = loadHub(root);
  if (!hub?.platform) { warn('no hub platform configured (.sdlc/hub.json) — nothing to sync'); return { synced: 0 }; }
  const git = (...args) => run('git', args, { cwd: root });
  const defaultBranch = hub.default_branch || (() => { const h = git('rev-parse', '--abbrev-ref', 'HEAD').stdout; return h && h !== 'HEAD' ? h : 'main'; })();
  // Push is decided AFTER the sync, once we know whether any step advanced: a held step (no advance,
  // not merged) is read-only and pushes nothing; an advance lands on the default branch (see below).

  // Build the work list: one job per (epic, artifact) — from the event branch, or a full sweep.
  const jobs = [];
  if (branch) {
    const parsed = parseReviewBranch(branch);
    if (!parsed) { warn(`${branch} is not a review/EP-*/<artifact> branch — nothing to sync`); return { synced: 0 }; }
    jobs.push({ epic: parsed.epic, base: parsed.base, artifact: artifactFromBase(parsed.base), branch, pr });
  } else {
    const epicsDir = path.join(root, 'epics');
    for (const e of fs.existsSync(epicsDir) ? fs.readdirSync(epicsDir).sort() : []) {
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
        if (!step || step.status === 'done') continue;
        jobs.push({ epic: e, base: base(p.artifact), artifact: p.artifact, branch: p.branch, pr: p.number });
      }
    }
    if (!jobs.length) { info('no open review PRs to sync'); return { synced: 0 }; }
  }

  let synced = 0;
  const touched = new Set();
  const advancedEpics = new Set(); // epics whose step actually passed this run (merge OR a swept merge)
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
      continue;
    }
    const step = findReviewStep(ledger.state, job.artifact);
    if (!step) { warn(`${job.epic}: no review step for ${job.artifact} — skipping`); continue; }

    // The merge event may fire before any hub-prs record exists (Path B never wrote one pre-merge) —
    // build the entry from the event itself so the advance commit carries it onto the default branch.
    const existing = (ledger.hubPrs || []).find((x) => x.artifact === job.artifact);
    const number = Number(job.pr) || existing?.number || null;
    if (!existing || existing.number !== number || existing.branch !== job.branch) {
      ledger.hubPrs = upsertHubPr(ledger.hubPrs, {
        step: step.id, artifact: job.artifact, platform: hub.platform, number,
        url: existing?.url ?? null, branch: job.branch, lastSyncedAt: existing?.lastSyncedAt ?? null,
      });
      writeJSON(ledger.files.hubPrs, ledger.hubPrs);
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
      if (r.advanced > 0) { advancedEpics.add(job.epic); await syncStatuses(root, { epic: job.epic }); }
    } catch (err) {
      if (branch) throw err; // event mode: one epic — surface the failure
      warn(`${job.epic}: sync failed — ${err.message} — skipping this epic`);
      process.exitCode = 1;
      failed = true;
    }
    if (failed) continue; // a failed epic's partial state must not be committed by this run
    touched.add(job.epic);
  }
  if (!touched.size) return { synced };

  // Path B: CI never writes the ledger to the review branch. A held step that did not advance is
  // read-only here — during review the platform PR/MR is the source of truth (native approvals/
  // threads); the ledger is reconciled onto the default branch at merge. Keeping CI off the PR head
  // is what stops an approval from being dismissed and required checks from stranding. Correctness is
  // unaffected: the merge phase re-reads approvals fresh from the platform (readPr).
  const advancedAny = advancedEpics.size > 0;
  if (!merged && !advancedAny) {
    // Pre-merge is read-only (Path B): the gate was evaluated with a dry sync that persists nothing.
    // The one working-tree write is the hub-prs.json seed above (so the dry sync could find the PR);
    // restore exactly that file per epic so the checkout stays clean — never touching anything else,
    // so a local `yad gate ci --branch` cannot disturb unrelated files.
    for (const e of touched) {
      const hp = path.join('epics', e, '.sdlc', 'hub-prs.json');
      git('checkout', '-q', '--', hp); // restore it if it was tracked
      git('clean', '-fq', '--', hp);   // remove it if the event first-seeded it (untracked)
    }
    info('pre-merge: gate evaluated; the ledger reconciles on the default branch at merge — nothing pushed');
    return { synced };
  }
  const target = defaultBranch; // CI only ever commits the ledger to the default branch

  // Stage what this merge-phase run owns, per epic (everything lands on the default branch):
  //  - advanced → the whole epic (ledger advance + the status flip syncStatuses wrote into the .md).
  //  - merged but not advanced (merged before the rule passed) → the ledger (.sdlc) + the generated
  //    reviews/ summaries only; the artifact is the owner's, left untouched.
  for (const e of touched) {
    if (advancedEpics.has(e)) git('add', '-A', '--', path.join('epics', e));
    else { git('add', '-A', '--', path.join('epics', e, '.sdlc')); git('add', '-A', '--', path.join('epics', e, 'reviews')); }
  }
  if (git('diff', '--cached', '--quiet').ok) { info('ledger unchanged — nothing to commit'); return { synced }; }
  // [skip ci]: the advance lands on the default branch (no PR trigger) but keeps the marker to guard
  // sibling workflows. CI never pushes the review branch (Path B), so there is no synchronize loop.
  const subject = !branch
    ? 'chore(gate): scheduled gate sync [skip ci]' // sweep is a batch; one subject for the run
    : `chore(gate): advance ${jobs[0].epic}/${jobs[0].base} on merge [skip ci]`;
  const cm = git('commit', '-m', subject);
  if (!cm.ok) { fail(`commit failed: ${cm.stderr || cm.stdout}`); process.exitCode = 1; return { synced }; }
  ok(`committed gate update: ${c.dim(subject)}`);
  if (!push) return { synced };

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (git('push', 'origin', `HEAD:${target}`).ok) { ok(`pushed to origin/${target}`); return { synced }; }
    if (attempt < 3) {
      info(`push rejected — rebasing onto origin/${target} and retrying (${attempt}/3)`);
      if (!git('pull', '--rebase', 'origin', target).ok) git('rebase', '--abort'); // never leave a wedged rebase
    }
  }
  fail(`could not push to origin/${target}${merged ? ' — protected default branch? allow the gate bot to push the merge advance (see yad-hub-bridge references/bridge.md)' : ''} — or run \`yad gate sync\` locally`);
  process.exitCode = 1;
  return { synced };
}

export async function gateComments(root, { epic, artifact, today, reader = readPr } = {}) {
  const { hub } = loadHub(root);
  if (!hub?.platform) { warn('no hub platform configured — nothing to fetch'); return; }
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
  const solo = isSolo(loadHub(root).hub);
  log(`\n  ${c.bold(epic)}  ${c.dim(`currentStep: ${ledger.state.currentStep}${solo ? ' — solo mode (approval waived; merge still required)' : ''}`)}`);
  for (const s of ledger.state.steps.filter((x) => x.type === 'review+approve')) {
    const cur = artifactHash(epicDir, s.artifact);
    const live = ledger.approvals.filter((a) => a.step === s.id && a.status === 'approved' && !(a.artifactHash && cur && a.artifactHash !== cur));
    const stale = ledger.approvals.filter((a) => a.step === s.id && a.status === 'approved' && a.artifactHash && cur && a.artifactHash !== cur).length;
    const tags = `${isEscalated(s) ? ', escalated' : ''}${stale ? `, ${stale} stale (revoked)` : ''}`;
    log(`    ${s.status === 'done' ? c.green('✓') : c.yellow('•')} ${s.id} ${c.dim(`— ${s.status}, ${live.length} approval(s)${tags}`)}`);
  }
}

// `head` overrides the review branch the PR is opened against — `open-pr` delegates here after pushing
// the user's checked-out branch, which for a per-story review (review/EP-*/stories-S01) does NOT equal
// the branch this would otherwise recompute (artifactFromBase collapses stories-S01 → stories/). Pass
// the real pushed head so the PR targets a branch that exists. `creator` is injected in tests.
export async function gateOpen(root, { epic, artifact, head, creator = createPr } = {}) {
  const { hub, repos } = loadHub(root);
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir}`); process.exitCode = 1; return; }
  if (!artifact) { fail('artifact is required: `yad gate open <epic> <artifact>`'); process.exitCode = 1; return; }
  const step = findReviewStep(ledger.state, artifact);
  if (!step) { fail(`no review step for ${artifact}`); process.exitCode = 1; return; }
  const b = base(artifact);
  const branch = head || `review/${epic}/${b}`;
  const domains = touchedDomains(epicDir, step);
  warnUnlockedContract(epicDir, artifact);
  warnIncompleteDiscovery(epicDir, artifact);

  const bridge = isBridge(hub);
  // Outside bridge mode (file-only, OR a platform with no gate-sync CI) there is no CI to write the
  // ledger, so the local command marks the step in_review. In bridge mode CI is the sole writer.
  if (!bridge) {
    ledger.state = markInReview(ledger.state, step);
    writeJSON(ledger.files.state, ledger.state);
  }
  if (!hub?.platform) {
    warn('no hub platform — marked in_review file-only (no PR opened)');
    ok(`${step.id} → in_review`);
    return;
  }

  // Open the PR. In bridge mode CI records the hub-prs entry (and advances) on the default branch at
  // merge — `yad gate open` never commits gate-state files (the ledger-guard check enforces that), and
  // CI writes nothing pre-merge. Without the bridge, the local command records the PR itself (no CI will).
  const body = fillHubTemplate({ epic, artifact, step, owner: ownerOf(epicDir), domains });
  // Assignee = whoever opens the review PR (the committer); reviewers = the hub's reviewers +
  // domain-owners of the touched repos, minus the committer (the owner/author is recorded, not asked
  // to review their own artifact). Scope is the hub plus every touched domain.
  const committer = resolveCommitterLogin(root, hub.roster || []);
  const reviewers = reviewersForScopes(hub.roster || [], ['hub', ...domains], { excludeLogin: committer, repos });
  const assignees = committer ? [committer] : [];
  const labels = isEscalated(step) ? domains.map((d) => `domain:${d}`) : [];
  info(`opening review ${hub.platform === 'gitlab' ? 'MR' : 'PR'} on branch ${branch} …`);
  const r = creator(hub.platform, { title: `review: ${artifact} (${epic})`, body, base: hub.default_branch || 'main', head: branch, reviewers, assignees, labels, cwd: root });
  if (!r.ok) { warn(`could not open PR (${r.reason || 'unknown'})${bridge ? ' — open it manually; CI records the gate on merge' : '; step is in_review file-only'}`); return; }
  // Surface routing: who was assigned as a reviewer, who was @-mentioned (GitLab field cap), and any
  // login the platform could not add (dropped) so a partial roster is visible, not silent.
  if (r.mentioned?.length) info(`@-mentioned (GitLab single-reviewer field): ${r.mentioned.join(', ')}`);
  if (r.dropped?.length) warn(`could not request as reviewer (unknown/non-collaborator login): ${r.dropped.join(', ')}`);

  if (!bridge) {
    ledger.hubPrs = upsertHubPr(ledger.hubPrs, { step: step.id, artifact, platform: hub.platform, number: Number((r.url.match(/\/(\d+)(?:[/?#]|$)/) || [])[1]) || null, url: r.url, branch, lastSyncedAt: null });
    writeJSON(ledger.files.hubPrs, ledger.hubPrs);
  }
  ok(`opened ${r.url}`);
  hand(bridge
    ? 'reviewers approve/comment there; CI advances the gate on the default branch when it is merged'
    : `reviewers approve/comment there; then run \`yad gate sync ${epic} ${artifact}\``);
  return { url: r.url };
}

// ---- helpers ------------------------------------------------------------------------------------
const base = (artifact) => artifactBase(artifact);

function fillHubTemplate({ epic, artifact, step, owner, domains }) {
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
    '',
    '## How to review (this drives the gate)',
    '- **Approve** to record your approval; **comment / request changes** to hold the gate.',
    '- This step advances when approvals are satisfied, all threads are resolved, and this PR is merged.',
  ].join('\n');
}

function refreshRoster(epicDir, targets, approvals, today) {
  for (const pr of targets) {
    const stepApprovals = approvals.filter((a) => a.step === pr.step && a.status === 'approved');
    const file = path.join(epicDir, 'reviews', `${base(pr.artifact)}--${today}--approved.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = [
      `# Approval record — ${pr.artifact} — ${today}`, '',
      '## Approved by',
      ...stepApprovals.map((a) => `- ${a.approver} — ${a.role}${a.domain ? ` (${a.domain})` : ''} — approved ${a.date}${a.source ? ` (${a.source})` : ''}`),
      '',
    ];
    fs.writeFileSync(file, lines.join('\n') + '\n');
  }
}
