// Platform adapter — the ONLY place that shells out to gh/glab. Read recipes mirror
// skills/yad-hub-bridge/references/bridge.md. Everything runs as the local user (gh/glab own auth);
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

// ---- roster role model (per-scope map, with legacy back-compat) ---------------------------------
// A roster entry's roles live in a per-scope map: `roles: { hub: ["owner","reviewer"], <repo>: [...] }`.
// `rolesForScope` normalizes the three shapes a roster entry can take on disk:
//   1. new object map     — `entry.roles = { hub: [...], backend: [...] }`
//   2. flat array variant — `entry.roles = ["owner","reviewer"]` (treated as hub roles)
//   3. legacy single role — `entry.role = "owner"` (a hub role; pre per-scope schema)
// The legacy `repos.json` `domain_owner` field is handled separately by resolveLogin's fallback.
export function rolesForScope(entry, scope) {
  if (!entry) return [];
  const r = entry.roles;
  if (r && typeof r === 'object' && !Array.isArray(r)) return Array.isArray(r[scope]) ? r[scope] : [];
  if (Array.isArray(r)) return scope === 'hub' ? r : [];
  if (typeof entry.role === 'string' && entry.role) return scope === 'hub' ? [entry.role] : [];
  return [];
}

// True when the entry holds any of `wanted` roles across any of `scopes`.
export function hasAnyRole(entry, scopes = [], wanted = []) {
  for (const scope of scopes) {
    for (const role of rolesForScope(entry, scope)) {
      if (wanted.includes(role)) return true;
    }
  }
  return false;
}

// Platform logins to auto-request as reviewers for the given scopes: everyone holding a `reviewer`
// or `domain-owner` role in any scope, minus `excludeLogin` (you don't review your own PR), deduped.
export function reviewersForScopes(roster = [], scopes = [], { excludeLogin = null } = {}) {
  const out = [];
  for (const entry of roster) {
    if (!entry.login || entry.login === excludeLogin) continue;
    if (hasAnyRole(entry, scopes, ['reviewer', 'domain-owner']) && !out.includes(entry.login)) out.push(entry.login);
  }
  return out;
}

// The committer/PR-opener's platform login, resolved from local git identity through the roster.
// Match on commit email first (the stable key), then fall back to name/login. null when unresolved.
export function resolveCommitterLogin(cwd, roster = []) {
  const email = (run('git', ['config', 'user.email'], { cwd }).stdout || '').trim().toLowerCase();
  const name = (run('git', ['config', 'user.name'], { cwd }).stdout || '').trim();
  if (email) {
    const byEmail = roster.find((r) => (r.email || '').toLowerCase() === email);
    if (byEmail) return byEmail.login || null;
  }
  if (name) {
    const byName = roster.find((r) => r.name === name || r.login === name);
    if (byName) return byName.login || null;
  }
  return null;
}

// Does this platform login exist on the hub? Warn-only (never throws): `checked:false` when the CLI
// is absent/unauthenticated so callers can distinguish "not a user" from "couldn't check".
export function validateLogin(platform, login) {
  const cli = cliFor(platform);
  if (!cli || !has(cli) || !login) return { ok: false, exists: false, checked: false };
  if (platform === 'github') {
    const r = run('gh', ['api', `users/${login}`]);
    return { ok: r.ok, exists: r.ok, checked: true };
  }
  // gitlab: users?username=<login> returns an array; empty array => no such user.
  const r = run('glab', ['api', `users?username=${encodeURIComponent(login)}`]);
  if (!r.ok) return { ok: false, exists: false, checked: true };
  let exists = false;
  try { exists = Array.isArray(JSON.parse(r.stdout)) && JSON.parse(r.stdout).length > 0; } catch { exists = false; }
  return { ok: exists, exists, checked: true };
}

// ---- login -> yad identity (roster + derived domain-owner) -------------------------------------
// Returns the records this login's APPROVED review contributes. Roles are read from the per-scope
// map: hub roles plus, for each touched domain, that repo's scoped roles (domain-owner carries the
// `domain` tag). The legacy `repos.json` `domain_owner === name` mapping is kept as a fallback so
// pre per-scope projects still resolve domain owners.
export function resolveLogin(login, roster = [], repos = [], touchedDomains = []) {
  const entry = roster.find((r) => r.login === login);
  if (!entry) return [{ name: login, role: 'reviewer', unverified: true }];
  const records = [];
  const push = (rec) => {
    if (!records.some((x) => x.name === rec.name && x.role === rec.role && x.domain === rec.domain)) records.push(rec);
  };
  for (const role of rolesForScope(entry, 'hub')) push({ name: entry.name, role });
  for (const d of touchedDomains) {
    for (const role of rolesForScope(entry, d)) {
      push(role === 'domain-owner' ? { name: entry.name, role, domain: d } : { name: entry.name, role });
    }
    // Legacy fallback: a repo whose domain_owner is this name confers domain-owner for that domain.
    const legacy = repos.find((repo) => repo.name === d && repo.domain_owner === entry.name);
    if (legacy) push({ name: entry.name, role: 'domain-owner', domain: d });
  }
  // An identity-only entry (no roles map and no legacy `role`) still contributes a base reviewer
  // record so an approval from a known person is never silently dropped. An entry that DOES declare
  // roles but none apply to these scopes contributes nothing here (it is scoped elsewhere).
  const hasNoRoleInfo = !entry.role && !(entry.roles && (Array.isArray(entry.roles) ? entry.roles.length : Object.keys(entry.roles).length));
  if (!records.length && hasNoRoleInfo) push({ name: entry.name, role: 'reviewer' });
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
// `assignees` = the committer/PR-opener (always set, so the PR is owned by whoever pushed it);
// `reviewers` = the scope's reviewers + domain-owners (computed by reviewersForScopes). On GitHub an
// empty assignee list falls back to `@me` so the opener still self-assigns even without a roster.
// Pure argv builder for the create command — exported so the reviewer/assignee/label wiring is
// unit-testable without shelling out. gh always self-assigns (@me) when no assignee resolved.
export function buildPrArgs(platform, { title, body, base, head, reviewers = [], labels = [], assignees = [] } = {}) {
  if (platform === 'gitlab') {
    const args = ['mr', 'create', '--title', title, '--description', body, '--target-branch', base, '--source-branch', head, '--yes'];
    if (reviewers.length) args.push('--reviewer', reviewers.join(','));
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

export function createPr(platform, opts = {}) {
  if (!platformReady(platform)) return { ok: false, reason: `${cliFor(platform) || 'platform CLI'} not available` };
  const r = run(cliFor(platform), buildPrArgs(platform, opts), { cwd: opts.cwd });
  return { ok: r.ok, url: r.stdout.split('\n').pop(), reason: r.stderr };
}
