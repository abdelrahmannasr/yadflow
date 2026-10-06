// E132 — the open and recently merged PRs/MRs of one repo, for `yad standup`. A READ, and E70's rule holds
// here word for word: an empty list is an answer only when the platform answered it. Anything else — no
// platform, reads turned off, no `gh`/`glab`, not logged in, offline, a 403 — is `{ ok: false, why }`, which
// the standup prints as "platform not read — <why>", never as "no PRs".
//
// One call per list, never one per PR: GitHub's GraphQL answers the open PRs with their review decision
// and check state, and the merged ones, in one query; GitLab's MR list carries `detailed_merge_status`.
// A page is 100. A FULL page proves nothing about what is past it, so it is said ("more than 100 …, not
// all read"), never read as the whole list.
//
// Facts only: the number, the author's login, draft or not, the check state and the review state the
// platform gives. Never a title, a body, a branch name or a comment (no free text — `yad usage`'s rule).
// `runner` is injectable so every answer is testable without a network (`YAD_PLATFORM_READ=0` in tests).
import { run } from './lib.mjs';
import { cliFor, detectPlatform, hostFromGitUrl, plainHost } from './platform.mjs';
import { api, httpStatus, loggedIn, repoPathFromGitUrl, shown, whyFailed, PAGE, TIMEOUT } from './protection.mjs';

// The check state, one word: GitHub's rollup, or what GitLab's merge status says about the pipeline.
const GH_CHECKS = { SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'running', EXPECTED: 'running' };

const GH_QUERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
open:pullRequests(states:OPEN,first:${PAGE},orderBy:{field:CREATED_AT,direction:DESC}){totalCount nodes{number isDraft author{__typename login} reviewDecision reviews{totalCount} latestOpinionatedReviews(first:100){nodes{state}} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}
merged:pullRequests(states:MERGED,first:${PAGE},orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number mergedAt updatedAt author{__typename login}}}}}`;

// GitHub's review state, in the words the standup prints. `none` = no review of any kind yet.
// `reviewDecision` is null on a repo with no required-review rule — even on an approved PR — so the latest
// opinionated review of each reviewer decides when it is null: a change request wins, then an approval.
function ghReview(n) {
  if (n.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  if (n.reviewDecision === 'APPROVED') return 'approved';
  const states = (n.latestOpinionatedReviews?.nodes || []).map((r) => r?.state);
  if (n.reviewDecision == null && states.includes('CHANGES_REQUESTED')) return 'changes-requested';
  if (n.reviewDecision == null && states.includes('APPROVED')) return 'approved';
  return (n.reviews?.totalCount || 0) > 0 ? 'reviewed' : 'none';
}

// GitLab's `detailed_merge_status`. Only the two pipeline words are turned into a check state; every other
// status is printed as GitLab wrote it, because reading more into it would say what GitLab did not —
// `mergeable` on a project with no approval rule was approved by nobody. `waits` lists the statuses where
// the MR cannot merge until something happens: those put it under "waiting".
const GL_CHECKS = { ci_must_pass: 'failing', ci_still_running: 'running' };
export const GL_WAITS = ['ci_must_pass', 'ci_still_running', 'not_approved', 'requested_changes', 'discussions_not_resolved', 'need_rebase', 'conflict'];

const author = (a) => (a && typeof a.login === 'string' && a.__typename !== 'Bot' && !/\[bot\]$/i.test(a.login) ? a.login : null);

// Where to ask, or why yad cannot: the same preamble E70's `readProtection` runs, in the same order.
export function prTarget({ platform = null, gitUrl = '' } = {}, { runner = run, env = process.env, authCache = new Map() } = {}) {
  const rawHost = hostFromGitUrl(gitUrl || '');
  const host = plainHost(rawHost);
  const repo = repoPathFromGitUrl(gitUrl || '');
  const plat = platform || detectPlatform(gitUrl || '') || null;
  const base = { platform: plat, host, repo };
  const no = (kind, why) => ({ ...base, ok: false, kind, why });
  const cli = cliFor(plat);
  if (!cli) return no('no-platform', plat ? `yad does not know the platform ${JSON.stringify(shown(plat))} (it reads GitHub and GitLab)` : 'no platform (GitHub or GitLab) is known for it');
  if (env.YAD_PLATFORM_READ === '0') return no('off', 'platform reads are turned off (YAD_PLATFORM_READ=0)');
  if (rawHost && !host) return no('no-url', 'its git URL names a host that is not a plain host name, so yad does not ask about it');
  if (!host || !repo) return no('no-url', 'no git URL yad can read, so it cannot tell which repo to ask about');
  if (!runner(process.platform === 'win32' ? 'where' : 'which', [cli], {}).ok) return no('no-cli', `${cli} is not installed`);
  if (!loggedIn(runner, cli, host, authCache)) return no('no-login', `${cli} is not logged in for ${host} (or ${host} did not answer)`);
  return { ...base, ok: true, cli };
}

// The PRs/MRs of one repo: `{ ok: true, open: [...], merged: [...], openPartial, mergedPartial }` or
// `{ ok: false, kind, why }`. `sinceMs` bounds the merged list (epoch milliseconds).
//   open:   { number, author, draft, checks: passing|failing|running|none|null, review: none|reviewed|approved|changes-requested|null,
//             status? (GitLab's own word), waits? (GitLab: a status that holds the merge) }
//   merged: { number, author, mergedAt (ISO) }
export function listPrs(target, { sinceMs, runner = run, env = process.env, authCache = new Map() } = {}) {
  const t = target?.cli ? target : prTarget(target, { runner, env, authCache });
  if (!t.ok) return t;
  return t.platform === 'github' ? listGitHub(t, sinceMs, runner) : listGitLab(t, sinceMs, runner);
}

function listGitHub(t, sinceMs, runner) {
  const parts = t.repo.split('/');
  const fail = (res) => ({ ...t, ok: false, kind: 'other', why: whyFailed(res, { platform: 'github', host: t.host, what: `the pull requests of ${shown(t.repo)}`, plural: true }) });
  if (parts.length !== 2) return { ...t, ok: false, kind: 'no-url', why: `${shown(t.repo)} is not an owner/name GitHub repo path` };
  const r = runner('gh', ['api', '--hostname', t.host, 'graphql', '-f', `query=${GH_QUERY}`, '-f', `owner=${parts[0]}`, '-f', `name=${parts[1]}`], { timeout: TIMEOUT });
  // gh exits non-zero when the answer carries GraphQL `errors`: a partial answer is not an answer.
  if (!r.ok) return fail({ ok: false, status: httpStatus(r) });
  let body;
  try { body = JSON.parse(r.stdout); } catch { return fail({ unreadable: true }); }
  const repo = body?.data?.repository;
  if (!repo || !Array.isArray(repo.open?.nodes) || !Array.isArray(repo.merged?.nodes)) return fail({ unreadable: true });
  const open = repo.open.nodes.map((n) => ({
    number: n.number, author: author(n.author), draft: n.isDraft === true,
    checks: GH_CHECKS[n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] || (n.commits?.nodes?.[0]?.commit?.statusCheckRollup ? null : 'none'),
    review: ghReview(n),
  }));
  const nodes = repo.merged.nodes;
  const merged = nodes.filter((n) => Date.parse(n.mergedAt) >= sinceMs).map((n) => ({ number: n.number, author: author(n.author), mergedAt: n.mergedAt }));
  // Sorted by last update, newest first: the list is whole for the window once its oldest entry is older.
  const last = nodes[nodes.length - 1];
  return {
    ...t, ok: true, open, merged,
    openPartial: (repo.open.totalCount ?? 0) > open.length,
    mergedPartial: nodes.length >= PAGE && !(Date.parse(last?.updatedAt) < sinceMs),
  };
}

function listGitLab(t, sinceMs, runner) {
  const at = `projects/${encodeURIComponent(t.repo)}/merge_requests`;
  const what = `the merge requests of ${shown(t.repo)}`;
  const fail = (res) => ({ ...t, ok: false, kind: 'other', why: whyFailed(res, { platform: 'gitlab', host: t.host, what, plural: true }) });
  const o = api(runner, 'glab', t.host, `${at}?state=opened&per_page=${PAGE}`);
  if (!o.ok) return fail(o);
  const since = new Date(sinceMs).toISOString();
  const m = api(runner, 'glab', t.host, `${at}?state=merged&order_by=updated_at&sort=desc&updated_after=${encodeURIComponent(since)}&per_page=${PAGE}`);
  if (!m.ok) return fail(m);
  if (!Array.isArray(o.body) || !Array.isArray(m.body)) return fail({ unreadable: true });
  const who = (a) => (a && typeof a.username === 'string' && a.bot !== true && !/\[bot\]$/i.test(a.username) ? a.username : null);
  const open = o.body.map((x) => {
    const st = typeof x.detailed_merge_status === 'string' ? x.detailed_merge_status : null;
    const checks = st && Object.hasOwn(GL_CHECKS, st) ? GL_CHECKS[st] : null;
    return { number: x.iid, author: who(x.author), draft: x.draft === true, checks, review: null, ...(st && !checks ? { status: st } : {}), waits: !!st && GL_WAITS.includes(st) };
  });
  const merged = m.body.filter((x) => Date.parse(x.merged_at) >= sinceMs).map((x) => ({ number: x.iid, author: who(x.author), mergedAt: x.merged_at }));
  return { ...t, ok: true, open, merged, openPartial: o.body.length >= PAGE, mergedPartial: m.body.length >= PAGE };
}

