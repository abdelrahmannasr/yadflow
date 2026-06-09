// `sdlc gate open|sync|comments|status` — the PR/MR-driven front-half review gate.
// The platform PR/MR is the review UI; this command syncs its state into the file ledger and, when
// the gate passes (approvals satisfied + all comment threads resolved + PR merged), auto-advances the
// step. The merge click is the human approval act, so front steps still never machine_advance.
import fs from 'node:fs';
import path from 'node:path';
import {
  c, log, ok, info, warn, hand, fail, readJSON, writeJSON,
} from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import {
  epicRoot, loadLedger, findReviewStep, artifactBase, artifactHash, gatePredicate,
  advanceState, markInReview, isEscalated,
} from './epic-state.mjs';
import { readPr, mapApprovers, createPr } from './platform.mjs';

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

const ownerOf = (epicDir) => frontmatter(path.join(epicDir, 'epic.md')).owner || '<owner>';

function loadHub(root) {
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig), null);
  const registry = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
  return { hub, repos: registry.repos };
}

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
function recordComments(comments, { artifact, stepId, today, roster, repos, blocking }) {
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

export async function gateSync(root, { epic, artifact, today, reader = readPr } = {}) {
  const { hub, repos } = loadHub(root);
  if (!hub?.platform) { warn('no hub platform configured (.sdlc/hub.json) — file-only gate, nothing to sync'); return { synced: 0 }; }
  const platform = hub.platform;
  const roster = hub.roster || [];
  const defaultReviewers = 1;
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir}/.sdlc/state.json`); process.exitCode = 1; return { synced: 0 }; }

  let { approvals, comments, hubPrs, state } = ledger;
  const targets = hubPrs.filter((p) => !artifact || p.artifact === artifact);
  if (!targets.length) { warn(`no open review PR recorded for ${epic}${artifact ? ` / ${artifact}` : ''} (run \`sdlc gate open\` first)`); return { synced: 0 }; }

  let synced = 0;
  for (const pr of targets) {
    const step = findReviewStep(state, pr.artifact);
    if (!step) { warn(`no review step for ${pr.artifact}`); continue; }
    // Already advanced: a re-sync must not re-run advance (it would reset the next step's status /
    // currentStep backward). The gate is one-way per step.
    if (step.status === 'done') { info(`${pr.artifact}: ${step.id} already done — skipping`); continue; }
    const domains = touchedDomains(epicDir, step);
    const pull = reader(platform, pr.number, { cwd: root });
    if (!pull.ok) { warn(`${pr.artifact}: ${pull.reason} — skipping (file-only)`); continue; }

    const curHash = artifactHash(epicDir, pr.artifact);
    const recs = mapApprovers(pull.reviews, { roster, repos, touchedDomains: domains });
    approvals = upsertBridge(approvals, recs, { stepId: step.id, artifact: pr.artifact, curHash, today });

    const changeRequested = pull.reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
    const unresolved = (pull.threads || []).filter((t) => !t.resolved);
    const threadsResolved = unresolved.length === 0 && changeRequested.length === 0;
    const blocking = [
      ...changeRequested.map((r) => ({ login: r.login, changesRequested: true })),
      ...unresolved,
    ];
    writeComments(epicDir, base(pr.artifact), today, blocking);
    comments = recordComments(comments, { artifact: pr.artifact, stepId: step.id, today, roster, repos, blocking });

    const pred = gatePredicate({
      step, approvals, currentHash: curHash, touchedDomains: domains,
      defaultReviewers, threadsResolved, merged: pull.merged,
    });

    log(`  ${c.bold(pr.artifact)} ${c.dim(`(PR #${pr.number}, rule: ${pred.rule})`)}`);
    if (pred.passed) {
      state = advanceState(state, step);
      ok(`gate PASSED — ${step.id} → done; next: ${state.currentStep}`);
    } else {
      state = markInReview(state, step);
      for (const m of pred.missing) hand(`still needed: ${m}`);
    }
    pr.lastSyncedAt = today;
    synced++;
  }

  writeJSON(ledger.files.approvals, approvals);
  writeJSON(ledger.files.comments, comments);
  writeJSON(ledger.files.hubPrs, hubPrs);
  writeJSON(ledger.files.state, state);
  refreshRoster(epicDir, targets, approvals, today);
  return { synced };
}

export async function gateComments(root, { epic, artifact, today, reader = readPr } = {}) {
  const { hub } = loadHub(root);
  if (!hub?.platform) { warn('no hub platform configured — nothing to fetch'); return; }
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  const targets = (ledger.hubPrs || []).filter((p) => !artifact || p.artifact === artifact);
  if (!targets.length) { warn('no review PR recorded — run `sdlc gate open` first'); return; }
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
  log(`\n  ${c.bold(epic)}  ${c.dim(`currentStep: ${ledger.state.currentStep}`)}`);
  for (const s of ledger.state.steps.filter((x) => x.type === 'review+approve')) {
    const cur = artifactHash(epicDir, s.artifact);
    const live = ledger.approvals.filter((a) => a.step === s.id && a.status === 'approved' && !(a.artifactHash && cur && a.artifactHash !== cur));
    const stale = ledger.approvals.filter((a) => a.step === s.id && a.status === 'approved' && a.artifactHash && cur && a.artifactHash !== cur).length;
    const tags = `${isEscalated(s) ? ', escalated' : ''}${stale ? `, ${stale} stale (revoked)` : ''}`;
    log(`    ${s.status === 'done' ? c.green('✓') : c.yellow('•')} ${s.id} ${c.dim(`— ${s.status}, ${live.length} approval(s)${tags}`)}`);
  }
}

export async function gateOpen(root, { epic, artifact, today } = {}) {
  const { hub, repos } = loadHub(root);
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir}`); process.exitCode = 1; return; }
  if (!artifact) { fail('artifact is required: `sdlc gate open <epic> <artifact>`'); process.exitCode = 1; return; }
  const step = findReviewStep(ledger.state, artifact);
  if (!step) { fail(`no review step for ${artifact}`); process.exitCode = 1; return; }
  const b = base(artifact);
  const branch = `review/${epic}/${b}`;
  const domains = touchedDomains(epicDir, step);

  // Mark in-review in the ledger regardless of platform (file-only still works).
  ledger.state = markInReview(ledger.state, step);
  writeJSON(ledger.files.state, ledger.state);

  if (!hub?.platform) { warn('no hub platform — marked in_review file-only (no PR opened)'); ok(`${step.id} → in_review`); return; }

  const body = fillHubTemplate({ epic, artifact, step, owner: ownerOf(epicDir), domains });
  const reviewers = (hub.roster || []).filter((r) => r.role !== 'owner').map((r) => r.login);
  const labels = isEscalated(step) ? domains.map((d) => `domain:${d}`) : [];
  info(`opening review ${hub.platform === 'gitlab' ? 'MR' : 'PR'} on branch ${branch} …`);
  const r = createPr(hub.platform, { title: `review: ${artifact} (${epic})`, body, base: hub.default_branch || 'main', head: branch, reviewers, labels, cwd: root });
  if (!r.ok) { warn(`could not open PR (${r.reason || 'unknown'}); step is in_review file-only`); return; }

  const number = Number((r.url.match(/\/(\d+)(?:[/?#]|$)/) || [])[1]) || null;
  ledger.hubPrs = (ledger.hubPrs || []).filter((p) => p.artifact !== artifact);
  ledger.hubPrs.push({ step: step.id, artifact, platform: hub.platform, number, url: r.url, branch, lastSyncedAt: null });
  writeJSON(ledger.files.hubPrs, ledger.hubPrs);
  ok(`opened ${r.url}`);
  hand(`reviewers approve/comment there; then run \`sdlc gate sync ${epic} ${artifact}\``);
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
