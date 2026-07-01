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
// `repos` (the registry) is consulted so a repo whose domain ownership lives ONLY in the legacy
// `repos.json` `domain_owner`/`domain_owners` field — not the roster roles map — is still requested
// as a reviewer for any scope that is its repo name. Without this the read side credits that login as
// a domain-owner (resolveLogin's legacy fallback) but the open side never asks them, so an escalated
// gate becomes structurally unsatisfiable through platform routing (BUG-1).
export function reviewersForScopes(roster = [], scopes = [], { excludeLogin = null, repos = [] } = {}) {
  const out = [];
  const add = (login) => { if (login && login !== excludeLogin && !out.includes(login)) out.push(login); };
  for (const entry of roster) {
    if (hasAnyRole(entry, scopes, ['reviewer', 'domain-owner'])) add(entry.login);
  }
  for (const scope of scopes) {
    const repo = repos.find((r) => r.name === scope);
    if (!repo) continue;
    const names = repo.domain_owners || (repo.domain_owner ? [repo.domain_owner] : []);
    for (const name of names) add(roster.find((r) => r.name === name)?.login);
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
  try { exists = Array.isArray(JSON.parse(r.stdout)) && JSON.parse(r.stdout).length > 0; } catch { /* malformed JSON -> exists stays false */ }
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
    // Legacy fallback: a repo whose domain_owner / domain_owners[] includes this name confers
    // domain-owner for that domain. Both spellings are honored — symmetric with reviewersForScopes,
    // which REQUESTS from both, so a person routed as a domain owner is also credited as one.
    const legacy = repos.find((repo) => repo.name === d
      && (repo.domain_owner === entry.name || (Array.isArray(repo.domain_owners) && repo.domain_owners.includes(entry.name))));
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
export function mapApprovers(reviews = [], { roster, repos, touchedDomains, headOid } = {}) {
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
    for (const rec of resolveLogin(r.login, roster, repos, touchedDomains)) {
      out.push({ ...rec, submittedAt: r.submittedAt || null, engagement });
    }
  }
  return out;
}

// ---- read PR state (github) ---------------------------------------------------------------------
function readPrGitHub(n, { cwd } = {}) {
  const view = run('gh', ['pr', 'view', String(n), '--json', 'state,mergedAt,headRefOid'], { cwd });
  if (!view.ok) return { ok: false, reason: view.stderr || 'gh pr view failed' };
  const meta = JSON.parse(view.stdout);
  let reviews = [];
  let reviewsOk = false;
  // Review-thread resolution via GraphQL (REST does not expose isResolved). Paginate so a PR with
  // >100 threads is not mistakenly read as "all resolved".
  let threads = [];
  const nwo = run('gh', ['repo', 'view', '--json', 'owner,name'], { cwd });
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
      const rg = run('gh', args, { cwd });
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
  // Fallback if the GraphQL reviews read failed (no nwo / API hiccup): take the plain JSON view with
  // commit=null. Approvals then FAIL CLOSED in mapApprovers (a degraded read cannot prove an approval
  // is for the merged content), while CHANGES_REQUESTED is still honored — so a transient failure
  // holds the gate, never advances it.
  if (!reviewsOk) {
    const rev = run('gh', ['pr', 'view', String(n), '--json', 'latestReviews'], { cwd });
    if (rev.ok) reviews = (JSON.parse(rev.stdout).latestReviews || [])
      .map((x) => ({ login: x.author?.login, state: x.state, submittedAt: x.submittedAt, body: x.body, commit: null }));
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
  const disc = run('glab', ['api', `projects/:id/merge_requests/${mr.iid}/discussions`], { cwd });
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
    const note = run('glab', ['mr', 'note', iid, '-m', `Review requested (owner + reviewer rule): ${ats} — please review and approve/comment on this MR (this drives the gate).`], { cwd: opts.cwd });
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
