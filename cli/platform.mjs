// Platform adapter — the ONLY place that shells out to gh/glab. Read recipes mirror
// skills/sdlc-hub-bridge/references/bridge.md. Everything runs as the local user (gh/glab own auth);
// no tokens are stored. Pure mapping fns (resolveLogin/mapApprovers) are exported for unit tests;
// readPr is injectable so the gate can be tested with a fake.
import { run, has } from './lib.mjs';

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

// Is the platform CLI present? (auth is the user's own; we don't probe it here.)
export function platformReady(platform) {
  const cli = cliFor(platform);
  return !!cli && has(cli);
}

// ---- login -> sdlc identity (roster + derived domain-owner) -------------------------------------
// Returns the records this login's APPROVED review contributes. A roster reviewer who owns a touched
// repo's domain contributes BOTH a base record and a domain-owner record (bridge.md "Login -> role").
export function resolveLogin(login, roster = [], repos = [], touchedDomains = []) {
  const entry = roster.find((r) => r.login === login);
  if (!entry) return [{ name: login, role: 'reviewer', unverified: true }];
  const records = [{ name: entry.name, role: entry.role }];
  for (const repo of repos) {
    if (repo.domain_owner === entry.name && touchedDomains.includes(repo.name)) {
      records.push({ name: entry.name, role: 'domain-owner', domain: repo.name });
    }
  }
  return records;
}

// Normalized PR reviews -> approval records (only APPROVED states count). `submittedAt` rides along
// so the gate can tell a fresh re-approval from a stale one (revoke-on-change).
export function mapApprovers(reviews = [], { roster, repos, touchedDomains }) {
  const out = [];
  for (const r of reviews) {
    if (r.state !== 'APPROVED') continue;
    for (const rec of resolveLogin(r.login, roster, repos, touchedDomains)) {
      out.push({ ...rec, submittedAt: r.submittedAt || null });
    }
  }
  return out;
}

// ---- read PR state (github) ---------------------------------------------------------------------
function readPrGitHub(n, { cwd } = {}) {
  const view = run('gh', ['pr', 'view', String(n), '--json', 'state,mergedAt,headRefOid'], { cwd });
  if (!view.ok) return { ok: false, reason: view.stderr || 'gh pr view failed' };
  const meta = JSON.parse(view.stdout);
  // latestReviews collapses a reviewer's superseded reviews to their current one.
  const rev = run('gh', ['pr', 'view', String(n), '--json', 'latestReviews'], { cwd });
  const reviews = rev.ok
    ? (JSON.parse(rev.stdout).latestReviews || []).map((x) => ({ login: x.author?.login, state: x.state, submittedAt: x.submittedAt }))
    : [];
  // Review-thread resolution via GraphQL (REST does not expose isResolved). Paginate so a PR with
  // >100 threads is not mistakenly read as "all resolved".
  let threads = [];
  const nwo = run('gh', ['repo', 'view', '--json', 'owner,name'], { cwd });
  if (nwo.ok) {
    const { owner, name } = JSON.parse(nwo.stdout);
    const q = `query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{isResolved comments(first:1){nodes{author{login} body}}}}}}}`;
    let cursor = null;
    for (let guard = 0; guard < 50; guard++) {
      const args = ['api', 'graphql', '-f', `query=${q}`, '-F', `o=${owner.login}`, '-F', `r=${name}`, '-F', `n=${n}`];
      if (cursor) args.push('-F', `c=${cursor}`);
      const g = run('gh', args, { cwd });
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
  return {
    ok: true,
    state: meta.state,
    merged: meta.state === 'MERGED' || !!meta.mergedAt,
    headOid: meta.headRefOid,
    reviews,
    threads,
  };
}

// ---- read PR state (gitlab) ---------------------------------------------------------------------
function readPrGitLab(n, { cwd } = {}) {
  const view = run('glab', ['mr', 'view', String(n), '-F', 'json'], { cwd });
  if (!view.ok) return { ok: false, reason: view.stderr || 'glab mr view failed' };
  const mr = JSON.parse(view.stdout);
  const approvals = run('glab', ['api', `projects/:id/merge_requests/${mr.iid}/approvals`], { cwd });
  const approvedBy = approvals.ok ? (JSON.parse(approvals.stdout).approved_by || []) : [];
  const reviews = approvedBy.map((a) => ({ login: a.user?.username, state: 'APPROVED' }));
  const disc = run('glab', ['api', `projects/:id/merge_requests/${mr.iid}/discussions`], { cwd });
  let threads = [];
  if (disc.ok) {
    threads = (JSON.parse(disc.stdout) || [])
      .filter((d) => d.notes?.some((nt) => nt.resolvable))
      .map((d, i) => ({
        id: d.id || `disc-${i}`,
        resolved: !!d.notes.find((nt) => nt.resolvable)?.resolved,
        login: d.notes[0]?.author?.username,
        body: d.notes[0]?.body,
      }));
  }
  return {
    ok: true,
    state: mr.state,
    merged: mr.state === 'merged',
    headOid: mr.diff_refs?.head_sha || mr.sha,
    reviews,
    threads,
  };
}

// Injectable entry point. gate.mjs accepts a `reader` override; default dispatches to gh/glab.
export function readPr(platform, n, opts = {}) {
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  return platform === 'gitlab' ? readPrGitLab(n, opts) : readPrGitHub(n, opts);
}

// ---- create a PR/MR -----------------------------------------------------------------------------
export function createPr(platform, { title, body, base, head, reviewers = [], labels = [], cwd } = {}) {
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  if (platform === 'gitlab') {
    const args = ['mr', 'create', '--title', title, '--description', body, '--target-branch', base, '--source-branch', head, '--yes'];
    if (reviewers.length) args.push('--reviewer', reviewers.join(','));
    if (labels.length) args.push('--label', labels.join(','));
    const r = run('glab', args, { cwd });
    return { ok: r.ok, url: r.stdout.split('\n').pop(), reason: r.stderr };
  }
  const args = ['pr', 'create', '--title', title, '--body', body, '--base', base, '--head', head];
  if (reviewers.length) args.push('--reviewer', reviewers.join(','));
  if (labels.length) args.push('--label', labels.join(','));
  const r = run('gh', args, { cwd });
  return { ok: r.ok, url: r.stdout.split('\n').pop(), reason: r.stderr };
}
