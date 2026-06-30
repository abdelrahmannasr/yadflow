// `yad review trailer|context|nudge|reconcile` — the BACK-HALF Review Companion + bridge for code
// PR/MRs (the analogue of `yad gate …` for the front half). The fun process (trailer/cards/chat/nudge)
// makes the engineer review easy and visible; the bridge process (reconcile) maps the code PR's review
// state — including the engagement signal — into the build ledger (build-log.json) at merge.
//
// The CLI never calls an LLM: the skill (yad-review-companion / yad-engineer-review) generates the
// trailer/cards/chat text and posts it via these primitives, all to the PLATFORM (never a ledger file).
import path from 'node:path';
import { log, ok, info, warn, fail, note, run, readJSON, writeJSON } from './lib.mjs';
import { PROJECT_FILES, epicFiles } from './manifest.mjs';
import { epicRoot } from './epic-state.mjs';
import {
  detectPlatform, readPr, mapApprovers, getPrBody, editPrBody, postComment, prNumberFromUrl,
} from './platform.mjs';
import { upsertTrailerBlock, nudgeMessage, parseEngagement } from './companion.mjs';
import { sequenceDiff } from './walkthrough.mjs';

const NUDGE_CMD = 'yad review chat';

// Resolve the target code repo: --repo <name> from the registry (platform + path + roles), else cwd.
// An explicit --repo that is NOT in the registry is an error — never silently fall through to cwd (that
// would operate on the wrong repo). Returns { error } in that case for the caller to surface.
function resolveRepo(root, { repo, dir }) {
  if (repo) {
    const reg = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
    const found = (reg.repos || []).find((r) => r.name === repo);
    if (!found) return { error: `repo '${repo}' is not in .sdlc/repos.json — connect it first (yad-connect-repos)` };
    return { repoRoot: path.resolve(root, found.path), meta: found };
  }
  return { repoRoot: path.resolve(root, dir || '.'), meta: null };
}

function platformOf(root, repoRoot, meta) {
  if (meta?.platform) return meta.platform;
  const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot }).stdout;
  return detectPlatform(remote) || readJSON(path.join(root, PROJECT_FILES.hubConfig), {}).platform || null;
}

// Build (but don't print) the back-half grounding bundle. Shared by `context` and `walkthrough` so the
// pair walkthrough adds an ordered stop-list on top of the exact same grounding the companion uses.
// Returns { error } on a bad --repo, else { bundle, repoRoot, base }.
function contextBundle(root, { repo, dir, pr } = {}) {
  const rr = resolveRepo(root, { repo, dir });
  if (rr.error) return { error: rr.error };
  const { repoRoot, meta } = rr;
  const platform = platformOf(root, repoRoot, meta);
  const base = meta?.default_branch || 'main';
  const bundle = {
    repo: meta?.name || null,
    repoRoot,
    platform,
    pr: pr || null,
    base,
    diffCmd: `git -C ${repoRoot} diff ${base}...HEAD`,
    codeMap: meta?.name ? path.join(root, '.sdlc/code-context', meta.name, 'code-map.md') : null,
    pack: meta?.name ? path.join(root, '.sdlc/code-context', meta.name, 'pack.md') : null,
    contract: meta?.contract || null,
    markers: {
      trailerBegin: '<!-- yad:trailer -->', noblock: '<!-- yad:noblock -->',
      engagementVerified: '<!-- yad:engagement verified -->', pair: '<!-- yad:pair -->',
    },
  };
  return { bundle, repoRoot, base };
}

// `yad review context --repo <r> --pr <n>` — print the grounding bundle the companion uses to generate
// the trailer / cards and run the chat over the CODE diff (grounded in the repo code-map + the PR).
export async function reviewContext(root, { repo, dir, pr } = {}) {
  const r = contextBundle(root, { repo, dir, pr });
  if (r.error) { fail(r.error); process.exitCode = 1; return; }
  log(JSON.stringify(r.bundle, null, 2));
  return r.bundle;
}

// `yad review walkthrough --repo <r> --pr <n>` — the pair-review grounding: the same bundle PLUS an
// ordered `stops[]` (the code diff parsed into hunk-anchored, risk-tagged review stops, highest-risk
// first). The CLI sequences deterministically; the skill (yad-pair-review) walks the stops, generates
// the per-stop briefing + Socratic question, and runs the two-way session. No LLM here, no ledger write.
export async function reviewWalkthrough(root, { repo, dir, pr, runner = run } = {}) {
  const r = contextBundle(root, { repo, dir, pr });
  if (r.error) { fail(r.error); process.exitCode = 1; return; }
  const { bundle, repoRoot, base } = r;
  const diff = runner('git', ['-C', repoRoot, 'diff', `${base}...HEAD`]);
  // Diagnostics go to STDERR so STDOUT stays pure JSON (the skill / e2e parse it). The empty `stops: []`
  // in the bundle already signals "nothing to walk".
  if (!diff.ok) note(`could not read the diff (${base}...HEAD) in ${repoRoot} — is the branch pushed and the base correct?`);
  const stops = sequenceDiff(diff.ok ? diff.stdout : '', { contractPath: bundle.contract });
  const out = { ...bundle, stops };
  log(JSON.stringify(out, null, 2));
  if (!stops.length) note('no stops — the diff is empty (nothing to walk through)');
  return out;
}

// `yad review trailer --repo <r> --pr <n> --body <text>` — idempotently upsert the 60-sec briefing into
// the code PR/MR description (delimited block; safe to re-run after a push).
export async function reviewTrailer(root, { repo, dir, pr, body, getBody = getPrBody, editBody = editPrBody } = {}) {
  if (!pr) { fail('--pr <n> is required'); process.exitCode = 1; return; }
  if (!body || !String(body).trim()) { fail('trailer body is required: `yad review trailer --repo <r> --pr <n> --body <text>`'); process.exitCode = 1; return; }
  const rr = resolveRepo(root, { repo, dir });
  if (rr.error) { fail(rr.error); process.exitCode = 1; return; }
  const { repoRoot, meta } = rr;
  const platform = platformOf(root, repoRoot, meta);
  if (!platform) { fail('could not detect platform (github/gitlab)'); process.exitCode = 1; return; }
  const cur = getBody(platform, pr, { cwd: repoRoot });
  if (!cur.ok) { fail(`could not read PR #${pr}: ${cur.reason || 'unknown'}`); process.exitCode = 1; return; }
  const r = editBody(platform, pr, upsertTrailerBlock(cur.body, String(body).trim()), { cwd: repoRoot });
  if (!r.ok) { fail(`could not update PR #${pr}: ${r.reason || 'unknown'}`); process.exitCode = 1; return; }
  ok(`trailer posted to ${platform === 'gitlab' ? 'MR' : 'PR'} #${pr}`);
  return { number: pr };
}

// `yad review nudge --repo <r> --pr <n>` — friendly public @-mention on a bare approve (engagement none)
// of a code PR. A platform comment (carries the noblock marker so it never blocks); call once per PR.
export async function reviewNudge(root, { repo, dir, pr, reader = readPr, poster = postComment } = {}) {
  if (!pr) { fail('--pr <n> is required'); process.exitCode = 1; return; }
  const rr = resolveRepo(root, { repo, dir });
  if (rr.error) { fail(rr.error); process.exitCode = 1; return; }
  const { repoRoot, meta } = rr;
  const platform = platformOf(root, repoRoot, meta);
  if (!platform) { fail('could not detect platform (github/gitlab)'); process.exitCode = 1; return; }
  const pull = reader(platform, pr, { cwd: repoRoot });
  if (!pull.ok) { warn(`could not read PR #${pr}: ${pull.reason}`); process.exitCode = 1; return; }
  let nudged = 0;
  for (const rv of pull.reviews) {
    if (rv.state !== 'APPROVED' || parseEngagement(rv.body) === 'verified' || !rv.login) continue;
    if (poster(platform, pr, nudgeMessage(rv.login, NUDGE_CMD), { cwd: repoRoot }).ok) nudged++;
  }
  if (nudged) info(`nudged ${nudged} bare approval(s) — invited to run \`${NUDGE_CMD}\``);
  else ok('no un-engaged approvals to nudge');
  return { nudged };
}

// `yad review reconcile --epic <id> --repo <r> --pr <n>` — the back-half BRIDGE: read the code PR's
// approvals (with the engagement signal) and stamp them onto the matching build-log.json ship record,
// so the build ledger reflects who actually engaged. The first CLI to write build-log.json. Matches the
// ship record by its `pr` field (url or number); if none exists yet, prints the engineer_review block
// for the engineer/CI to attach at ship time (we never fabricate a story/task).
export async function reviewReconcile(root, { epic, repo, dir, pr, reader = readPr } = {}) {
  if (!epic) { fail('--epic <id> is required'); process.exitCode = 1; return; }
  if (!pr) { fail('--pr <n> is required'); process.exitCode = 1; return; }
  const rr = resolveRepo(root, { repo, dir });
  if (rr.error) { fail(rr.error); process.exitCode = 1; return; }
  const { repoRoot, meta } = rr;
  const platform = platformOf(root, repoRoot, meta);
  if (!platform) { fail('could not detect platform (github/gitlab)'); process.exitCode = 1; return; }
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig), { roster: [] });
  const registry = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
  const domain = meta?.name ? [meta.name] : [];
  const pull = reader(platform, pr, { cwd: repoRoot });
  if (!pull.ok) { fail(`could not read PR #${pr}: ${pull.reason}`); process.exitCode = 1; return; }

  // Map platform approvals → engineer_review entries, deduped by (approver, role, domain), carrying the
  // engagement signal read from the approve body/note.
  const recs = mapApprovers(pull.reviews, { roster: hub.roster || [], repos: registry.repos || [], touchedDomains: domain, headOid: pull.headOid });
  const seen = new Set();
  const engineerReview = [];
  for (const r of recs) {
    const key = `${r.name}|${r.role}|${r.domain || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    engineerReview.push({ approver: r.name, role: r.role, ...(r.domain ? { domain: r.domain } : {}), engagement: r.engagement === 'verified' ? 'verified' : 'none' });
  }

  const file = epicFiles(epicRoot(root, epic)).buildLog;
  const ledger = readJSON(file, null);
  // Match by exact PR number — never substring (`--pr 5` must not match a ship recorded against #15).
  const ship = ledger?.ships?.find((s) => s.pr != null
    && (String(s.pr) === String(pr) || prNumberFromUrl(s.pr) === String(pr)));
  if (!ship) {
    warn(`no build-log ship record matches PR #${pr} in ${epic} — attach this at ship time:`);
    log(JSON.stringify({ engineer_review: engineerReview }, null, 2));
    return { engineerReview, written: false };
  }
  ship.engineer_review = engineerReview;
  writeJSON(file, ledger);
  ok(`stamped engagement onto ${epic} ship ${ship.story || ''}${ship.task ? '/' + ship.task : ''} (PR #${pr})`);
  return { engineerReview, written: true };
}
