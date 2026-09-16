// Platform adapter — the ONLY place that shells out to gh/glab. Read recipes mirror
// skills/yad-hub-bridge/references/bridge.md. Everything runs as the local user (gh/glab own auth);
// no tokens are stored. Pure mapping fns (resolveLogin/mapApprovers) are exported for unit tests;
// readPr is injectable so the gate can be tested with a fake.
import { URLSearchParams } from 'node:url';
import { run, has } from './lib.mjs';
import { parseEngagement } from './companion.mjs';

// github | gitlab | null, from a repo/remote.
export function detectPlatform(remoteUrl = '') {
  if (/gitlab/i.test(remoteUrl)) return 'gitlab';
  if (/github/i.test(remoteUrl)) return 'github';
  return null;
}

export function cliFor(platform) {
  if (platform === 'gitlab') return 'glab';
  if (platform === 'github') return 'gh';
  return null;
}

// Bare host from a git remote URL, for hostname-scoped CLI auth checks. Handles both the
// `https://[user@]host[:port]/...` and the scp-like `git@host:group/repo.git` forms. Returns
// null when nothing parses (caller falls back to an unscoped check).
export function hostFromGitUrl(url = '') {
  if (typeof url !== 'string' || !url.trim()) return null;
  const u = url.trim();
  // scp-like syntax: [user@]host:path — only when there's no scheme and the colon precedes a path.
  const scp = u.match(/^(?:[^@/]+@)?([^/:]+):(?!\/)/);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return scp[1].toLowerCase() || null;
  try {
    // URL needs a scheme to parse a host; ssh:// and https:// both work here.
    return new URL(u).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

// Is the platform CLI present? (auth is the user's own; we don't probe it here.)
export function platformReady(platform) {
  const cli = cliFor(platform);
  return !!cli && has(cli);
}

// ---- who is running this command ------------------------------------------------------------
// The platform login of whoever runs this command, asked of the platform's own CLI (`gh api user`,
// `glab api user`) rather than looked up in a stored list (E62). A list is a claim that goes stale; the
// CLI's answer is who is actually logged in. It is what a record's `by` names and what a commit subject
// shows as `@login`.
//
// Best effort, and never a gate: null when there is no platform, the CLI is missing or logged out, the
// network is down, the answer does not look like a login, or `YAD_PLATFORM_LOGIN=0` turns the lookup
// off (offline work, and the test suite, which must never ask the developer's real account). Callers
// then fall back to git `user.name` — see `actorName`. On CI the job token usually cannot read `/user`,
// so the fallback is the bot's git name, exactly what it was before.
//
// Asked once per platform and directory per process: a command that writes several records pays for
// one call. The timeout keeps a hung network from holding a command that only wanted a name.
//
// ON GITHUB THE HOST IS PASSED. `gh api` asks github.com unless told otherwise, so someone logged in to
// both github.com and a GitHub Enterprise server would be recorded under the wrong account. `host` is the
// caller's (the Product's `git_url`), else the directory's origin remote. `glab api` already resolves the
// host from the repo.
const LOGIN_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\[bot\])?$/; // GitLab allows a leading underscore
const loginCache = new Map();
export function platformLogin(cwd, platform, { runner = run, env = process.env, host } = {}) {
  if (env.YAD_PLATFORM_LOGIN === '0') return null;
  const cli = cliFor(platform);
  if (!cli) return null;
  const ghHost = platform === 'github'
    ? (host || hostFromGitUrl(runner('git', ['remote', 'get-url', 'origin'], { cwd }).stdout) || null)
    : null;
  const key = `${platform}\0${cwd}\0${ghHost || ''}`;
  if (runner === run && loginCache.has(key)) return loginCache.get(key);
  let login = null;
  if (platform === 'github') {
    const r = runner('gh', ['api', ...(ghHost ? ['--hostname', ghHost] : []), 'user', '--jq', '.login'], { cwd, timeout: 10000 });
    if (r.ok) login = r.stdout.trim();
  } else {
    const r = runner('glab', ['api', 'user'], { cwd, timeout: 10000 });
    if (r.ok) { try { login = String(JSON.parse(r.stdout).username || ''); } catch { /* not JSON — no login */ } }
  }
  if (!login || !LOGIN_RE.test(login)) login = null;
  if (runner === run) loginCache.set(key, login);
  return login;
}

// Who wrote a record: the platform login, else git `user.name`, else null. Attribution is a nicety on
// the audit trail and never blocks the command that writes it.
export function actorName(cwd, platform, opts = {}) {
  return platformLogin(cwd, platform, opts)
    || ((opts.runner || run)('git', ['config', 'user.name'], { cwd }).stdout || '').trim()
    || null;
}

// The roster names `legacyLogins` (cli/gate.mjs) leaves out because two logins share them, each with the
// logins that share it. An older record under such a
// name could be either person, so it is never matched by name — only as `upsertBridge` matches a record
// no name can place (an exact submission time, or an open step's one-to-one).
export function ambiguousLegacyNames(hub) {
  const logins = new Map();
  for (const e of Array.isArray(hub?.roster) ? hub.roster : []) {
    if (!e || typeof e.name !== 'string' || !e.name || typeof e.login !== 'string' || !e.login) continue;
    if (!logins.has(e.name)) logins.set(e.name, new Set());
    logins.get(e.name).add(e.login);
  }
  return new Map([...logins].filter(([, set]) => set.size > 1));
}

// Normalized PR reviews -> approval records (only APPROVED states count). `submittedAt` rides along
// so the gate can tell a fresh re-approval from a stale one (revoke-on-change).
// The record names the PLATFORM LOGIN that approved (E62). There is no stored list to look it up in and
// no role to give it: the platform's record of who approved is the evidence, and the gate counts
// people, not roles. A review with no login cannot be told apart from another one, so it is not counted.
export function mapApprovers(reviews = [], { headOid } = {}) {
  const out = [];
  for (const r of reviews) {
    if (r.state !== 'APPROVED') continue;
    // Revoke-on-change, enforced in code where the platform binds an approval to a commit. The reader
    // sets `commit` to the review's SHA (GitHub), to `null` when that read DEGRADED, or leaves it
    // ABSENT when the platform exposes no per-approval SHA (GitLab):
    //   - `null` (degraded read)  → FAIL CLOSED → drop, independently of headOid: we cannot prove the
    //                               approval is for the merged content, so a transient failure holds
    //                               the gate rather than advancing on unverifiable approvals;
    //   - a known SHA ≠ head      → the approval is stale (artifact moved) → drop;
    //   - absent (GitLab)         → keep: revoke-on-change is the platform's "remove approvals on new
    //                               commits" setting.
    if (r.commit === null) continue;
    if (headOid && r.commit !== undefined && r.commit !== headOid) continue;
    // engagement rides in the APPROVE review body (`<!-- yad:engagement verified -->`); a bare UI
    // click has no marker → 'none'. Gameable by design (it makes review quality visible, not provable).
    const engagement = parseEngagement(r.body);
    if (!r.login) continue;
    out.push({ name: r.login, submittedAt: r.submittedAt || null, engagement });
  }
  return out;
}

// ---- read PR state (github) ---------------------------------------------------------------------
function readPrGitHub(n, { cwd, runner = run } = {}) {
  const view = runner('gh', ['pr', 'view', String(n), '--json', 'state,mergedAt,mergedBy,mergeCommit,headRefOid'], { cwd });
  if (!view.ok) return { ok: false, reason: view.stderr || 'gh pr view failed' };
  const meta = JSON.parse(view.stdout);
  let reviews = [];
  let reviewsOk = false;
  // Review-thread resolution via GraphQL (REST does not expose isResolved). Paginate so a PR with
  // >100 threads is not mistakenly read as "all resolved".
  let threads = [];
  const nwo = runner('gh', ['repo', 'view', '--json', 'owner,name'], { cwd });
  if (nwo.ok) {
    const { owner, name } = JSON.parse(nwo.stdout);
    // latestReviews collapses a reviewer's superseded reviews to their current one; commit.oid binds
    // each approval to the revision it was made on, so an approval on an older commit than the merged
    // head is dropped as stale (revoke-on-change in code — see mapApprovers). `gh pr view --json
    // latestReviews` does not expose the commit, so read it via GraphQL. Paginate so a PR with >100
    // reviewers never silently omits one; any page failure aborts to the commitless fallback below,
    // which fails closed rather than advancing on a partial read.
    const rq = `query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){latestReviews(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{author{login} state submittedAt body commit{oid}}}}}}`;
    let rcursor = null;
    reviewsOk = true;
    for (let guard = 0; guard < 50; guard++) {
      const args = ['api', 'graphql', '-f', `query=${rq}`, '-F', `o=${owner.login}`, '-F', `r=${name}`, '-F', `n=${n}`];
      if (rcursor) args.push('-F', `c=${rcursor}`);
      const rg = runner('gh', args, { cwd });
      if (!rg.ok) { reviewsOk = false; reviews = []; break; }
      const conn = JSON.parse(rg.stdout)?.data?.repository?.pullRequest?.latestReviews;
      for (const x of conn?.nodes || []) {
        reviews.push({ login: x.author?.login, state: x.state, submittedAt: x.submittedAt, body: x.body, commit: x.commit?.oid || null });
      }
      if (!conn?.pageInfo?.hasNextPage) break;
      rcursor = conn.pageInfo.endCursor;
    }
    const q = `query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{isResolved comments(first:1){nodes{author{login} body}}}}}}}`;
    let cursor = null;
    for (let guard = 0; guard < 50; guard++) {
      const args = ['api', 'graphql', '-f', `query=${q}`, '-F', `o=${owner.login}`, '-F', `r=${name}`, '-F', `n=${n}`];
      if (cursor) args.push('-F', `c=${cursor}`);
      const g = runner('gh', args, { cwd });
      if (!g.ok) break;
      const page = JSON.parse(g.stdout)?.data?.repository?.pullRequest?.reviewThreads;
      for (const t of page?.nodes || []) {
        threads.push({
          id: `thread-${threads.length}`,
          resolved: !!t.isResolved,
          login: t.comments?.nodes?.[0]?.author?.login,
          body: t.comments?.nodes?.[0]?.body,
        });
      }
      if (!page?.pageInfo?.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }
  }
  // Fallback if the GraphQL reviews read failed (no nwo / API hiccup): take the plain JSON view with
  // commit=null. Approvals then FAIL CLOSED in mapApprovers (a degraded read cannot prove an approval
  // is for the merged content), while CHANGES_REQUESTED is still honored — so a transient failure
  // holds the gate, never advances it.
  if (!reviewsOk) {
    const rev = runner('gh', ['pr', 'view', String(n), '--json', 'latestReviews'], { cwd });
    if (rev.ok) reviews = (JSON.parse(rev.stdout).latestReviews || [])
      .map((x) => ({ login: x.author?.login, state: x.state, submittedAt: x.submittedAt, body: x.body, commit: null }));
  }
  return {
    ok: true,
    state: meta.state,
    merged: meta.state === 'MERGED' || !!meta.mergedAt,
    // What a closing record points at (E18). Null when the platform does not say, never invented.
    mergedAt: meta.mergedAt || null,
    mergedBy: meta.mergedBy?.login || null,
    mergeCommit: meta.mergeCommit?.oid || null,
    headOid: meta.headRefOid,
    reviews,
    threads,
  };
}

// ---- read PR state (gitlab) ---------------------------------------------------------------------
function readPrGitLab(n, { cwd, runner = run } = {}) {
  const view = runner('glab', ['mr', 'view', String(n), '-F', 'json'], { cwd });
  if (!view.ok) return { ok: false, reason: view.stderr || 'glab mr view failed' };
  const mr = JSON.parse(view.stdout);
  const approvals = runner('glab', ['api', `projects/:id/merge_requests/${mr.iid}/approvals`], { cwd });
  const approvedBy = approvals.ok ? (JSON.parse(approvals.stdout).approved_by || []) : [];
  const disc = runner('glab', ['api', `projects/:id/merge_requests/${mr.iid}/discussions`], { cwd });
  const discussions = disc.ok ? (JSON.parse(disc.stdout) || []) : [];
  // A GitLab approval carries no body, so the companion's engagement marker rides in a NOTE the
  // reviewer posts; attach the latest engagement-bearing note per username to their approval so
  // mapApprovers reads engagement uniformly with GitHub.
  const engagementByUser = new Map();
  for (const d of discussions) {
    for (const nt of d.notes || []) {
      if (/<!--\s*yad:engagement\s+\w+\s*-->/i.test(nt.body || '')) engagementByUser.set(nt.author?.username, nt.body);
    }
  }
  const reviews = approvedBy.map((a) => ({ login: a.user?.username, state: 'APPROVED', body: engagementByUser.get(a.user?.username) }));
  const threads = discussions
    .filter((d) => d.notes?.some((nt) => nt.resolvable))
    .map((d, i) => ({
      id: d.id || `disc-${i}`,
      resolved: !!d.notes.find((nt) => nt.resolvable)?.resolved,
      login: d.notes[0]?.author?.username,
      body: d.notes[0]?.body,
    }));
  return {
    ok: true,
    state: mr.state,
    merged: mr.state === 'merged',
    mergedAt: mr.merged_at || null,
    // `merge_user` since GitLab 14.7; `merged_by` is the deprecated spelling older instances still send.
    mergedBy: mr.merge_user?.username || mr.merged_by?.username || null,
    mergeCommit: mr.merge_commit_sha || mr.squash_commit_sha || null,
    headOid: mr.diff_refs?.head_sha || mr.sha,
    reviews,
    threads,
  };
}

// Injectable entry point. gate.mjs accepts a `reader` override; default dispatches to gh/glab.
// `opts.runner` replaces the gh/glab calls, so the parsing is unit-testable without either installed
// (mirrors platformDefaultBranch). With a runner there is no CLI to probe, only a platform to name.
export function readPr(platform, n, opts = {}) {
  const ready = opts.runner ? !!cliFor(platform) : platformReady(platform);
  if (!ready) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  return platform === 'gitlab' ? readPrGitLab(n, opts) : readPrGitHub(n, opts);
}

// ---- find the PR/MR for a branch ----------------------------------------------------------------
// The review PR/MR opened for `review/EP-<slug>/<artifact>`, by HEAD/source branch. Under the verified ledger
// the ledger records that pointer only at merge (CI is the sole writer), so without this a human has
// no way to name the review a merged PR belongs to — `gate sync` would just report "no open review PR
// recorded" for a PR that is sitting merged on the platform (issue #158).
//
// State is deliberately UNfiltered: the interesting case is a MERGED PR that never advanced. Newest
// first, so a re-opened review resolves to its current PR and not a superseded one. Returns
// { ok, number, url } — never throws; `ok:false` carries the reason.
export function findPrForBranch(platform, branch, { cwd } = {}) {
  if (!branch) return { ok: false, reason: 'no branch given' };
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  if (platform === 'gitlab') {
    const r = run('glab', ['api', `projects/:id/merge_requests?source_branch=${encodeURIComponent(branch)}&order_by=updated_at&sort=desc&per_page=1`], { cwd });
    if (!r.ok) return { ok: false, reason: r.stderr || 'glab api merge_requests failed' };
    let rows;
    try { rows = JSON.parse(r.stdout); } catch { return { ok: false, reason: 'unreadable glab api response' }; }
    const mr = Array.isArray(rows) ? rows[0] : null;
    if (!mr?.iid) return { ok: false, reason: `no merge request found for source branch ${branch}` };
    return { ok: true, number: Number(mr.iid), url: mr.web_url || null };
  }
  const r = run('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,url'], { cwd });
  if (!r.ok) return { ok: false, reason: r.stderr || 'gh pr list failed' };
  let rows;
  try { rows = JSON.parse(r.stdout); } catch { return { ok: false, reason: 'unreadable gh pr list response' }; }
  const pr = Array.isArray(rows) ? rows[0] : null;
  if (!pr?.number) return { ok: false, reason: `no pull request found for head branch ${branch}` };
  return { ok: true, number: Number(pr.number), url: pr.url || null };
}

// The head/source branch of a PR/MR, so a caller can confirm a number a human typed actually belongs
// to the review it is about to bind approvals to. Returns { ok, branch }; never throws.
export function prBranch(platform, n, { cwd } = {}) {
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  if (platform === 'gitlab') {
    const r = run('glab', ['api', `projects/:id/merge_requests/${Number(n)}`], { cwd });
    if (!r.ok) return { ok: false, reason: r.stderr || 'glab api merge_request failed' };
    try {
      const mr = JSON.parse(r.stdout);
      return mr?.source_branch ? { ok: true, branch: mr.source_branch } : { ok: false, reason: `MR !${n} has no source_branch` };
    } catch { return { ok: false, reason: 'unreadable glab api response' }; }
  }
  const r = run('gh', ['pr', 'view', String(n), '--json', 'headRefName'], { cwd });
  if (!r.ok) return { ok: false, reason: r.stderr || 'gh pr view failed' };
  try {
    const pr = JSON.parse(r.stdout);
    return pr?.headRefName ? { ok: true, branch: pr.headRefName } : { ok: false, reason: `PR #${n} has no headRefName` };
  } catch { return { ok: false, reason: 'unreadable gh pr view response' }; }
}

// Is `branch` on ORIGIN? `gate open` opens a PR against the review branch but never creates or pushes
// it — and neither does the platform CLI, since `gh pr create --head <b>` explicitly disables its
// automatic push. So a branch that exists only locally is just as unusable as one that does not exist
// at all, and checking locally would wave it through into the opaque platform error this replaces.
// Returns null when git cannot answer (not a checkout, no origin, network/auth failure) — "unknown"
// must never read as "missing" and block.
export function branchExists(cwd, branch) {
  if (!run('git', ['rev-parse', '--git-dir'], { cwd }).ok) return null;
  // This runs synchronously on the `gate open` path, so "cannot ask" has to be FAST — a blocked probe
  // is a hung command, not the intended null. Three separate ways it could block:
  //   GIT_TERMINAL_PROMPT=0  — git's own credential prompt (https origins)
  //   GIT_SSH_COMMAND        — ssh's passphrase / host-key prompts, which git's flag does NOT cover
  //                            (an unset host key otherwise waits on "Are you sure…?" forever)
  //   timeout                — anything else that stalls: a black-holed host, a wedged helper
  // A caller's own GIT_SSH_COMMAND wins; we only supply the default.
  const remote = run('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch], {
    cwd,
    timeout: 10_000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new',
    },
  });
  if (remote.ok) return true;
  // exit 2 is ls-remote's own "no matching ref" — the only definite negative. Anything else (no
  // remote configured, auth, offline) is a question we could not ask.
  return remote.code === 2 ? false : null;
}

// ---- default branch -----------------------------------------------------------------------------
// The REMOTE's own default branch, asked of the platform. This is the branch the platform (and the
// tooling that keys off it — CodeRabbit's auto-review eligibility, branch protection, "compare"
// defaults) considers the trunk, so it is the only authoritative answer to "what should a PR target?".
// `runner` is injectable so the read is unit-testable without shelling out (mirrors searchIssues).
// Returns { ok, branch, reason }; never throws — an absent/unauthenticated CLI is just `ok:false`.
// It is a READ of the remote's own config, so it costs one API round-trip; callers that only need a
// base branch get it folded into resolveBaseBranch below rather than calling this twice.
export function platformDefaultBranch(platform, { cwd, runner = run } = {}) {
  // No `platformReady` probe: an absent CLI already surfaces as a failed spawn, and skipping the probe
  // keeps the read a pure function of `runner` (so a test never depends on gh/glab being installed).
  if (!cliFor(platform)) return { ok: false, reason: 'no platform (github/gitlab) to ask' };
  // This is a live network round-trip on a SYNCHRONOUS command path, so it carries the same ceiling
  // branchExists documents for its own remote probe: "cannot ask" has to be fast, or a black-holed
  // host / wedged credential helper turns `yad open-pr` into a hang. A timeout surfaces as ok:false,
  // which the caller already treats as "the platform could not tell me".
  const opts = { cwd, timeout: 10_000 };
  if (platform === 'gitlab') {
    // `:id` is glab's own placeholder for the project the cwd resolves to (same form as readPrGitLab).
    const r = runner('glab', ['api', 'projects/:id'], opts);
    if (!r.ok) return { ok: false, reason: r.stderr || 'glab api projects/:id failed' };
    try {
      const branch = JSON.parse(r.stdout)?.default_branch;
      return branch ? { ok: true, branch } : { ok: false, reason: 'project has no default_branch' };
    } catch { return { ok: false, reason: 'unreadable glab api response' }; }
  }
  const r = runner('gh', ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], opts);
  if (!r.ok) return { ok: false, reason: r.stderr || 'gh repo view failed' };
  return r.stdout ? { ok: true, branch: r.stdout } : { ok: false, reason: 'gh returned no defaultBranchRef' };
}

// The branch a PR/MR should target, resolved rather than assumed (issue #168: open-pr hardcoded
// 'main', so every task PR on a `staging`-trunk repo was mis-based — and CodeRabbit, which decides
// auto-review eligibility at PR-OPEN time from the base, silently skipped every one of them).
//
// Order — most explicit first, and configuration outranks the remote: the same
// configuration-outranks-the-remote order `yad repo sync` (repo.mjs) and the contract-check gate use,
// though only this chain has a platform rung — they stop at the local `origin/HEAD`:
//   1 flag        — an explicit --base; the human said so
//   2 registry    — the repo's `default_branch` in .sdlc/repos.json
//   3 hub         — hub.json's `default_branch`, for a PR against the Product itself
//   4 platform    — what the remote says (see platformDefaultBranch)
//   5 origin-head — local `refs/remotes/origin/HEAD`, the same read repo.mjs/hubcommit.mjs use.
//                   Deliberately NOT `ls-remote`: see branchExists above for why a network probe on
//                   this path is a hang hazard.
//   6 fallback    — 'main'
//
// `probe` decides WHEN the platform is asked, and exists because the two callers want different things:
//   true  (default) — ask up front, so `platformDefault` rides along even when an earlier rung won.
//                     `yad open-pr` needs that to warn about a base that is not the remote's trunk,
//                     and it is about to shell out to gh/glab anyway.
//   false           — ask only if the config rungs all miss. A caller that just wants a base (the
//                     review companion) would otherwise pay a live round-trip — up to the full 10s
//                     timeout on a slow/unreachable host — for a `platformDefault` it discards.
// Either way the probe runs AT MOST once. Returns { base, source, platformDefault }; with `probe:false`
// and an early rung winning, `platformDefault` is null because it was never asked, not because the
// platform had no answer.
export function resolveBaseBranch(platform, {
  cwd, explicit = null, meta = null, hub = null, runner = run, probe = true,
} = {}) {
  let platformDefault = null;
  let asked = false;
  const askPlatform = () => {
    if (asked) return platformDefault;
    asked = true;
    const remote = platformDefaultBranch(platform, { cwd, runner });
    platformDefault = remote.ok ? remote.branch : null;
    return platformDefault;
  };
  if (probe) askPlatform();
  const originHead = () => {
    const r = runner('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd });
    return r.ok && r.stdout ? r.stdout.replace(/^origin\//, '') : null;
  };
  const chain = [
    ['flag', explicit],
    ['registry', meta?.default_branch],
    ['hub', hub?.default_branch],
    ['platform', askPlatform],
    ['origin-head', originHead],
  ];
  for (const [source, value] of chain) {
    const branch = typeof value === 'function' ? value() : value;
    if (branch) return { base: branch, source, platformDefault };
  }
  return { base: 'main', source: 'fallback', platformDefault };
}

// ---- create a PR/MR -----------------------------------------------------------------------------
// `assignees` = the committer/PR-opener on GitLab (empty when `glab` cannot say who is logged in);
// GitHub callers pass none and get `@me`, so the PR is owned by whoever pushed it;
// `reviewers` = logins to request. No caller passes any since E62 removed the roster that chose them;
// the parameter stays for E68, which suggests reviewers from history. On GitHub an empty assignee list
// falls back to `@me` so the opener still self-assigns when the platform login is unknown.
// Pure argv builder for the create command — exported so the reviewer/assignee/label wiring is
// unit-testable without shelling out. gh always self-assigns (@me) when no assignee resolved.
export function buildPrArgs(platform, { title, body, base, head, reviewers = [], labels = [], assignees = [] } = {}) {
  if (platform === 'gitlab') {
    const args = ['mr', 'create', '--title', title, '--description', body, '--target-branch', base, '--source-branch', head, '--yes'];
    // A Free/Core GitLab MR carries a SINGLE reviewer field (multiple reviewers is a Premium feature),
    // so only the first reviewer goes in the field; createPr @-mentions the rest in a note (BUG-2).
    if (reviewers.length) args.push('--reviewer', reviewers[0]);
    if (assignees.length) args.push('--assignee', assignees.join(','));
    if (labels.length) args.push('--label', labels.join(','));
    return args;
  }
  const args = ['pr', 'create', '--title', title, '--body', body, '--base', base, '--head', head];
  if (reviewers.length) args.push('--reviewer', reviewers.join(','));
  args.push('--assignee', assignees.length ? assignees.join(',') : '@me');
  if (labels.length) args.push('--label', labels.join(','));
  return args;
}

// Number/IID from a PR/MR URL (…/pull/123, …/pulls/123, …/-/merge_requests/45). Anchored to the
// PR/MR path segment so a numeric group/org/repo earlier in the URL is never mistaken for it; falls
// back to a trailing number for non-standard URLs. null when unparsable.
export function prNumberFromUrl(url = '') {
  const s = String(url);
  const m = s.match(/\/(?:pull|pulls|merge_requests)\/(\d+)/);
  if (m) return m[1];
  const tail = s.match(/\/(\d+)(?:[/?#]|$)/);
  return tail ? tail[1] : null;
}

// Create a PR/MR and route the required reviewers, resiliently, on both platforms:
//   GitHub — create WITHOUT reviewers, then add each via `gh pr edit --add-reviewer`. A bad/
//            non-collaborator login then WARNS (dropped) instead of aborting the whole create (BUG-4).
//   GitLab — assign the first reviewer to the MR field; @-mention the remaining required reviewers in
//            an MR note so they are still notified/routed despite the single-reviewer-field cap (BUG-2).
// Returns { ok, url, reviewers (assigned), mentioned, dropped }.
// ---- post back to the platform (companion write helpers) ----------------------------------------
// The reviewer/companion writes to the PLATFORM (PR/MR body + comments + approval), never the ledger —
// so the ledger-guard check is never tripped. Each returns { ok, ... } and never throws.

// Current PR/MR description (for idempotent trailer-block upsert). null when unreadable.
export function getPrBody(platform, n, { cwd } = {}) {
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  if (platform === 'github') {
    const r = run('gh', ['pr', 'view', String(n), '--json', 'body', '-q', '.body'], { cwd });
    return { ok: r.ok, body: r.ok ? r.stdout : '', reason: r.stderr };
  }
  const r = run('glab', ['mr', 'view', String(n), '-F', 'json'], { cwd });
  if (!r.ok) return { ok: false, body: '', reason: r.stderr };
  try { return { ok: true, body: JSON.parse(r.stdout).description || '' }; } catch { return { ok: false, body: '', reason: 'unparseable mr json' }; }
}

// Replace the PR/MR description (used to upsert the trailer block).
export function editPrBody(platform, n, body, { cwd } = {}) {
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  const r = platform === 'github'
    ? run('gh', ['pr', 'edit', String(n), '--body', body], { cwd })
    : run('glab', ['mr', 'update', String(n), '--description', body], { cwd });
  return { ok: r.ok, reason: r.stderr };
}

// Post a top-level comment/note (companion card deck, chat log, nudge — pass a noBlock()-tagged body).
export function postComment(platform, n, body, { cwd } = {}) {
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  const r = platform === 'github'
    ? run('gh', ['pr', 'comment', String(n), '--body', body], { cwd })
    : run('glab', ['mr', 'note', String(n), '-m', body], { cwd });
  return { ok: r.ok, reason: r.stderr };
}

// Submit an APPROVE carrying the engagement marker. On GitLab an approval has no body, so the marker
// is posted as a note (readPrGitLab attaches it to the approval); on GitHub it rides in the review body.
export function submitApproval(platform, n, body = '', { cwd } = {}) {
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  if (platform === 'github') {
    const r = run('gh', ['pr', 'review', String(n), '--approve', '--body', body], { cwd });
    return { ok: r.ok, reason: r.stderr };
  }
  const a = run('glab', ['mr', 'approve', String(n)], { cwd });
  if (!a.ok) return { ok: false, reason: a.stderr };
  if (body) {
    // The engagement marker rides in this note (GitLab approvals carry no body). If it fails to post,
    // the approval landed but the engagement signal is lost — report failure so the caller can retry.
    const note = run('glab', ['mr', 'note', String(n), '-m', body], { cwd });
    if (!note.ok) return { ok: false, reason: `approved, but failed to post the engagement note: ${note.stderr || 'unknown'}` };
  }
  return { ok: true };
}

export function createPr(platform, opts = {}) {
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  const reviewers = opts.reviewers || [];
  if (platform === 'github') {
    const r = run('gh', buildPrArgs('github', { ...opts, reviewers: [] }), { cwd: opts.cwd });
    if (!r.ok) return { ok: false, reason: r.stderr };
    const url = r.stdout.split('\n').pop();
    const number = prNumberFromUrl(url);
    const added = []; const dropped = [];
    if (number) {
      for (const rv of reviewers) {
        (run('gh', ['pr', 'edit', number, '--add-reviewer', rv], { cwd: opts.cwd }).ok ? added : dropped).push(rv);
      }
    }
    return { ok: true, url, reviewers: added, mentioned: [], dropped };
  }
  // gitlab
  const r = run('glab', buildPrArgs('gitlab', opts), { cwd: opts.cwd });
  if (!r.ok) return { ok: false, reason: r.stderr };
  const url = r.stdout.split('\n').pop();
  const iid = prNumberFromUrl(url);
  const rest = reviewers.slice(1);
  // Only report a reviewer as `mentioned` if the @-mention note actually posted; otherwise they were
  // neither assigned (single-field cap) nor notified — surface them as `dropped` so the caller warns.
  let mentioned = []; let dropped = [];
  if (rest.length && iid) {
    const ats = rest.map((m) => `@${m}`).join(' ');
    const note = run('glab', ['mr', 'note', iid, '-m', `Review requested: ${ats} — please review and approve/comment on this MR (this drives the gate).`], { cwd: opts.cwd });
    if (note.ok) mentioned = rest; else dropped = rest;
  } else if (rest.length) {
    dropped = rest; // could not parse the IID to post the note
  }
  return { ok: true, url, reviewers: reviewers.slice(0, 1), mentioned, dropped };
}

// ---- issues (for `yad report`) ------------------------------------------------------------------
// Filing a bug against the upstream yadflow repo. Same local-user auth as everything else: the call
// inherits the user's own gh/glab session, no tokens handled. `repo` is an `owner/name` slug; the
// upstream lives on GitHub, so the github path is the primary one (glab kept for symmetry).
// `runner` is injectable so cli/report.mjs — and its tests — never shell out.

// Is the platform CLI present AND authenticated? A best-effort probe (mirrors doctor's auth check).
// Used to decide direct-file vs the URL fallback; a false here is not an error, just "use the URL".
export function platformAuthed(platform, { runner = run } = {}) {
  const cli = cliFor(platform);
  if (!cli || !has(cli)) return false;
  return runner(cli, ['auth', 'status']).ok;
}

// Open issues whose title/body match `query`. Returns { ok, matches: [{number, title, url}] }.
// A failed/absent CLI returns ok:false so the caller can skip dedup rather than block filing.
export function searchIssues(platform, repo, query, { runner = run, limit = 5 } = {}) {
  if (platform === 'gitlab') {
    const r = runner('glab', ['issue', 'list', '--repo', repo, '--search', query, '-P', String(limit), '-F', 'json']);
    if (!r.ok) return { ok: false, matches: [] };
    try {
      const rows = JSON.parse(r.stdout || '[]');
      return { ok: true, matches: rows.map((i) => ({ number: i.iid, title: i.title, url: i.web_url })) };
    } catch { return { ok: false, matches: [] }; }
  }
  const r = runner('gh', ['issue', 'list', '--repo', repo, '--search', query, '--state', 'open', '--limit', String(limit), '--json', 'number,title,url']);
  if (!r.ok) return { ok: false, matches: [] };
  try {
    return { ok: true, matches: JSON.parse(r.stdout || '[]') };
  } catch { return { ok: false, matches: [] }; }
}

// The issue URL from a create command's stdout: the last line that looks like one (tolerates any
// trailing notice the CLI may print after it), falling back to the last non-empty line.
const urlFromStdout = (stdout = '') => {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return [...lines].reverse().find((l) => /^https?:\/\//.test(l)) || lines.pop() || '';
};

// Create an issue. Returns { ok, url } or { ok:false, reason }. Mirrors createPr's shape.
export function createIssue(platform, repo, { title, body, labels = [] } = {}, { runner = run } = {}) {
  if (platform === 'gitlab') {
    const args = ['issue', 'create', '--repo', repo, '--title', title, '--description', body];
    for (const l of labels) args.push('--label', l);
    const r = runner('glab', args);
    if (!r.ok) return { ok: false, reason: r.stderr };
    return { ok: true, url: urlFromStdout(r.stdout) };
  }
  const args = ['issue', 'create', '--repo', repo, '--title', title, '--body', body];
  for (const l of labels) args.push('--label', l);
  const r = runner('gh', args);
  if (!r.ok) return { ok: false, reason: r.stderr };
  return { ok: true, url: urlFromStdout(r.stdout) };
}

// The prefilled `issues/new` URL — the always-works fallback when the CLI is missing/unauthenticated.
// GitHub honours ?title=&body= (and &labels=); GitLab uses issue[title]/issue[description].
export function issueUrl(platform, repo, { title = '', body = '', labels = [] } = {}) {
  if (platform === 'gitlab') {
    const q = new URLSearchParams({ 'issue[title]': title, 'issue[description]': body });
    if (labels.length) q.set('issue[label_names][]', labels.join(','));
    return `https://gitlab.com/${repo}/-/issues/new?${q.toString()}`;
  }
  const q = new URLSearchParams({ title, body });
  if (labels.length) q.set('labels', labels.join(','));
  return `https://github.com/${repo}/issues/new?${q.toString()}`;
}
