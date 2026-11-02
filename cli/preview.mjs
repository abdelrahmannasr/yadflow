// The preview address of a PR/MR (#359): a live copy of the app that a service (Vercel, Netlify, a
// review app) deploys for each PR/MR, so a live design check — the page at several screen widths — can
// run against it instead of only on the developer's machine.
//
// Where it comes from, in order (the user's decision, 2026-11-02):
//   1. a per-repo pattern, `preview_url` in the Product's `.sdlc/repos.json`
//      (`https://pr-{pr}.myapp.dev`), set with `yad repo preview`;
//   2. else the platform: the newest successful, non-production deployment GitHub/GitLab records for
//      the PR's head (what Vercel/Netlify/review apps report);
//   3. else none — and the answer says the check runs locally only, and why.
//
// One rule (`patternProblems`) is shared by the command that writes a pattern, doctor that reads it and
// the resolver that fills it, so the three never disagree.
import { run } from './lib.mjs';

export const PREVIEW_KEY = 'preview_url';
export const PLACEHOLDERS = ['pr', 'branch', 'repo'];
const MAX_LEN = 2048;

// A name made safe for a host name or a path: lowercase, every run of other characters one `-`.
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Is this a URL yad may print and write into a PR/MR description? https, or http on this machine
// (a local preview server). Printable ASCII only, and none of the characters that end a Markdown link
// or an HTML attribute — the text comes from a shared file or a deployment service.
export function urlProblem(u) {
  if (typeof u !== 'string' || !u) return 'is not a URL';
  if (u.length > MAX_LEN) return `longer than ${MAX_LEN} characters`;
  if (!/^[\x21-\x7e]+$/.test(u)) return 'has a space, a control character or a non-ASCII character';
  if (/[<>"'`\\]/.test(u)) return 'has a character that is not allowed in it (< > " \' ` \\)';
  let p;
  try { p = new URL(u); } catch { return 'is not a URL'; }
  if (p.username || p.password) return 'carries a user name or password';
  if (p.protocol === 'https:') return null;
  if (p.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(p.hostname)) return null;
  return 'must start with https:// (or http://localhost)';
}

// Why a pattern cannot be used, or [] when it can. The placeholders are filled with harmless sample
// values, so the URL check sees what a filled pattern would be.
export function patternProblems(p) {
  if (typeof p !== 'string') return ['is not text'];
  const problems = [];
  const unknown = [...p.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((n) => !PLACEHOLDERS.includes(n));
  if (unknown.length) problems.push(`has an unknown placeholder ${[...new Set(unknown)].map((n) => `{${n}}`).join(', ')} (use {pr}, {branch} or {repo})`);
  if (/[{}]/.test(p.replace(/\{(pr|branch|repo)\}/g, ''))) {
    if (!unknown.length) problems.push('has a lone { or }');
  }
  const sample = p.replace(/\{pr\}/g, '1').replace(/\{branch\}/g, 'branch').replace(/\{repo\}/g, 'repo');
  if (!unknown.length && !/[{}]/.test(sample)) {
    const why = urlProblem(sample);
    if (why) problems.push(why);
  }
  return problems;
}

// The pattern recorded for a repo entry: { pattern } when there is a usable one, { problems } when one
// is recorded but cannot be used, {} when none is recorded.
export function previewPattern(meta) {
  if (!meta || typeof meta !== 'object' || !(PREVIEW_KEY in meta) || meta[PREVIEW_KEY] == null) return {};
  const p = meta[PREVIEW_KEY];
  const problems = patternProblems(p);
  return problems.length ? { problems } : { pattern: p };
}

// The pattern with its placeholders filled, or null when it needs a value that is missing ({pr} before
// the PR exists) or the result is not a URL yad would write.
export function fillPattern(p, { pr, branch, repo } = {}) {
  if (patternProblems(p).length) return null;
  const vals = { pr: pr == null || pr === '' ? null : String(pr), branch: slug(branch) || null, repo: slug(repo) || null };
  if (vals.pr != null && !/^\d+$/.test(vals.pr)) return null;
  let missing = false;
  const out = p.replace(/\{(pr|branch|repo)\}/g, (_m, k) => { if (vals[k] == null) { missing = true; return ''; } return vals[k]; });
  if (missing) return null;
  return urlProblem(out) ? null : out;
}

export const needs = (p, key) => typeof p === 'string' && p.includes(`{${key}}`);

const parse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
// A review must not stall on a slow or unreachable host: one budget covers every call the lookup makes
// (the PR's head, the deployments, their statuses), and each call gets only the time that is left.
// Spent, the answer is local-only, with why.
const PLATFORM_TIMEOUT = 8000;
export const PLATFORM_BUDGET = 15000;
const MIN_CALL = 500;
export function budget(now = Date.now, total = PLATFORM_BUDGET) {
  const until = now() + total;
  return { now, left: () => Math.min(PLATFORM_TIMEOUT, until - now()), spent: () => until - now() < MIN_CALL };
}
export const isPrNumber = (pr) => pr != null && /^\d+$/.test(String(pr));
const isSha = (s) => typeof s === 'string' && /^[0-9a-f]{7,64}$/i.test(s);
// A production environment is the live site, never a PR's preview — however the integration marked it.
// `production`, `prod`, and names that start with them: Vercel's `Production – app`, `production-eu`, `prod_us`.
const isProduction = (name) => typeof name === 'string' && /^prod(uction)?(?![a-z0-9])/i.test(name.trim());

// The newest successful, non-production deployment the platform records for the PR's head commit
// (GitHub) or branch (GitLab). Never throws: { url } or { url: null, why }.
export function platformPreview(platform, { cwd, sha, branch, pr = null, runner = run, clock = budget() } = {}) {
  const opts = () => ({ cwd, timeout: clock.left() });
  const slow = (host) => ({ url: null, why: `${host} was too slow to answer about deployments` });
  if (platform === 'github') {
    if (!isSha(sha)) return { url: null, why: 'the PR\'s head commit is not known' };
    if (clock.spent()) return slow('GitHub');
    const r = runner('gh', ['api', `repos/{owner}/{repo}/deployments?sha=${sha}&per_page=20`], opts());
    if (!r.ok) return { url: null, why: 'GitHub could not be asked for deployments (gh not signed in, offline, or no GitHub remote)' };
    const list = parse(r.stdout);
    if (!Array.isArray(list)) return { url: null, why: 'GitHub gave an answer yad cannot read' };
    // Newest first, as GitHub lists them.
    const candidates = list.filter((d) => d && typeof d === 'object' && Number.isInteger(d.id)
      && d.production_environment !== true && !isProduction(d.environment));
    let asked = 0, failed = 0;
    for (const d of candidates.slice(0, 3)) {
      if (clock.spent()) return slow('GitHub');
      asked++;
      const s = runner('gh', ['api', `repos/{owner}/{repo}/deployments/${d.id}/statuses?per_page=20`], opts());
      const statuses = s.ok ? parse(s.stdout) : undefined;
      if (!Array.isArray(statuses)) { failed++; continue; }
      // The newest status decides (GitHub lists them newest first): not success now is not live now.
      const latest = statuses.find((x) => x && typeof x === 'object' && typeof x.state === 'string');
      if (!latest || latest.state !== 'success') continue;
      const url = latest.environment_url;
      if (!url) continue;
      if (urlProblem(url)) return { url: null, why: 'GitHub reports a deployment address yad will not use (not https, or an odd character in it)' };
      return { url };
    }
    if (asked && failed === asked) return { url: null, why: 'GitHub could not be asked for the deployments\' status' };
    return { url: null, why: candidates.length ? 'GitHub lists no successful deployment with an address for this commit' : 'GitHub lists no preview deployment for this commit' };
  }
  if (platform === 'gitlab') {
    if (!branch && !pr) return { url: null, why: 'the PR\'s branch is not known' };
    if (clock.spent()) return slow('GitLab');
    // The deployments list has no branch filter: the newest 100 successful ones are read, and only this
    // branch's (at its head commit, when known) are kept. A deployment's environment there is a short
    // record, so the environment itself is asked whether it is still running and not production.
    const r = runner('glab', ['api', 'projects/:id/deployments?status=success&order_by=id&sort=desc&per_page=100'], opts());
    if (!r.ok) return { url: null, why: 'GitLab could not be asked for deployments (glab not signed in, offline, or no GitLab remote)' };
    const list = parse(r.stdout);
    if (!Array.isArray(list)) return { url: null, why: 'GitLab gave an answer yad cannot read' };
    const env = (x) => (x && typeof x === 'object' && x.environment && typeof x.environment === 'object' ? x.environment : null);
    const seen = new Set();
    // A merge-request pipeline deploys from `refs/merge-requests/<iid>/head` (a merged-results one, a
    // merge commit whose id is not the MR head's): for that ref the commit is not compared. The skills
    // still treat a page that does not show the change as local-only. Newest first: the answer is the
    // newest one whose environment is still running.
    const mrRef = pr ? `refs/merge-requests/${pr}/head` : null;
    const candidates = list.filter((x) => env(x) && ((x.ref === branch && (!sha || x.sha === sha)) || (mrRef && x.ref === mrRef))
      && Number.isInteger(env(x).id) && !isProduction(env(x).name) && !seen.has(env(x).id) && seen.add(env(x).id));
    let asked = 0, failed = 0;
    for (const d of candidates.slice(0, 3)) {
      if (clock.spent()) return slow('GitLab');
      asked++;
      const e = runner('glab', ['api', `projects/:id/environments/${env(d).id}`], opts());
      const full = e.ok ? parse(e.stdout) : undefined;
      if (!full || typeof full !== 'object') { failed++; continue; }
      if (full.state !== 'available' || isProduction(full.tier) || isProduction(full.name) || !full.external_url) continue;
      if (urlProblem(full.external_url)) return { url: null, why: 'GitLab reports a deployment address yad will not use (not https, or an odd character in it)' };
      return { url: full.external_url };
    }
    if (asked && failed === asked) return { url: null, why: 'GitLab could not be asked about the review environments' };
    return { url: null, why: 'GitLab lists no successful, running review deployment with an address for this branch or MR among its newest 100 deployments' };
  }
  return { url: null, why: 'the platform is not GitHub or GitLab' };
}

// The PR/MR's head commit and branch. With a PR number they are asked of the platform, and only the
// platform's answer counts: this checkout may be on another branch (main, a detached worktree), and its
// preview is not the PR's. Without one, this checkout's (the review of the branch you are on).
// { sha, branch } or { sha: null, branch: null, why }.
export function prHead(platform, pr, { cwd, runner = run, clock = budget(), base = null } = {}) {
  if (!pr) {
    const sha = runner('git', ['rev-parse', 'HEAD'], { cwd }).stdout || null;
    const b = runner('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).stdout || null;
    // The default branch is not a PR's branch: its deployment is the main site, never a preview.
    // Detached is no PR's either: yad's worktrees are detached at the default branch (#115).
    if (b && base && b === base) return { sha: null, branch: null, why: `this checkout is on the default branch (${base}), not the PR's` };
    if (b === 'HEAD') return { sha: null, branch: null, why: 'this checkout is on no branch (detached)' };
    if (!b) return { sha: null, branch: null, why: 'this checkout\'s branch could not be read' };
    return { sha: isSha(sha) ? sha : null, branch: b };
  }
  const none = (why) => ({ sha: null, branch: null, why });
  if (!isPrNumber(pr)) return none('the PR number given (--pr) is not a number');
  if (clock.spent()) return none('the platform was too slow to answer');
  const opts = { cwd, timeout: clock.left() };
  if (platform === 'github') {
    const r = runner('gh', ['pr', 'view', String(pr), '--json', 'headRefOid,headRefName'], opts);
    const j = r.ok ? parse(r.stdout) : null;
    if (j && isSha(j.headRefOid)) return { sha: j.headRefOid, branch: typeof j.headRefName === 'string' && j.headRefName ? j.headRefName : null };
    return none(`GitHub could not be asked for PR #${pr}'s head branch (gh not signed in, offline, or no such PR)`);
  }
  if (platform === 'gitlab') {
    const r = runner('glab', ['mr', 'view', String(pr), '-F', 'json'], opts);
    const j = r.ok ? parse(r.stdout) : null;
    if (j && isSha(j.sha)) return { sha: j.sha, branch: typeof j.source_branch === 'string' && j.source_branch ? j.source_branch : null };
    return none(`GitLab could not be asked for MR !${pr}'s source branch (glab not signed in, offline, or no such MR)`);
  }
  return none('the platform is not GitHub or GitLab');
}

// The answer a review step uses: { url, source: 'pattern'|'platform' } or
// { url: null, source: 'local-only', why }. `why` says what was tried and how to set a pattern.
// The PR's head is asked only when it is needed: a {pr} or {repo} pattern answers with no network call.
export function resolvePreview({ meta, platform, pr, base = null, cwd, runner = run, lookup = platformPreview, clock = budget(), head: given } = {}) {
  const repo = meta?.name;
  let head = given || null;
  const getHead = () => (head ||= prHead(platform, pr, { cwd, runner, clock, base }));
  const tried = [];
  const pat = previewPattern(meta);
  if (pat.pattern) {
    const h = needs(pat.pattern, 'branch') ? getHead() : {};
    const url = fillPattern(pat.pattern, { pr, branch: h.branch, repo });
    if (url) return { url, source: 'pattern' };
    if (needs(pat.pattern, 'pr') && pr && !isPrNumber(pr)) tried.push('the PR number given (--pr) is not a number');
    else if (needs(pat.pattern, 'pr') && !pr) tried.push('the repo\'s preview_url pattern needs the PR number ({pr}), and none was given (--pr)');
    else if (needs(pat.pattern, 'branch') && !h.branch) tried.push(`the repo's preview_url pattern needs the PR's branch ({branch}), and it is not known: ${h.why || 'no branch'}`);
    else tried.push('the repo\'s preview_url pattern could not be filled');
  } else if (pat.problems) {
    tried.push(`the repo's preview_url pattern cannot be used: it ${pat.problems.join('; ')}`);
  } else {
    tried.push(`no preview_url pattern is recorded for ${repo ? 'this repo' : 'a repo outside the registry'}`);
  }
  const h = getHead();
  const p = h.sha || h.branch ? lookup(platform, { cwd, sha: h.sha, branch: h.branch, pr, runner, clock }) : { url: null, why: h.why };
  if (p?.url) return { url: p.url, source: 'platform' };
  if (p?.why && !tried.some((t) => t === p.why || t.endsWith(p.why))) tried.push(p.why);
  // GitLab's merge-request pipelines deploy under the MR's own ref, which only its number finds — said
  // only when GitLab was asked and listed nothing (a GitLab it could not ask, --pr would not help).
  const gitlabNoPr = !pr && platform === 'gitlab' && /^GitLab lists no/.test(p?.why || '');
  if (gitlabNoPr) tried.push('a merge-request pipeline\'s deployment is found only with --pr');
  const fix = repo ? 'set one with `yad repo preview <repo> <pattern>`' : 'register the repo, then set one with `yad repo preview <repo> <pattern>`';
  // One next step, chosen here, the one that most likely unblocks the answer: a --pr that is missing
  // or wrong when it is what stopped it, then a pattern to fix, then --pr for GitLab's MR pipelines.
  const badPr = pr && !isPrNumber(pr);
  const next = badPr || (!pr && ((pat.pattern && needs(pat.pattern, 'pr')) || (head && !head.branch && !head.sha))) ? 'pass --pr <n>'
    : pat.pattern ? 'check the pattern with `yad repo preview <repo>`'
    : pat.problems ? 'set it again with `yad repo preview <repo> <pattern>`'
    : gitlabNoPr ? 'pass --pr <n>' : fix;
  return { url: null, source: 'local-only', why: `${tried.join('; ')} — ${next}` };
}

// The PR/MR description's Preview line, at open time: a pattern that can be filled now, else a note
// that says which case it is. A {pr} pattern is filled after the PR exists (`runOpenPr` edits the body).
export const PREVIEW_NONE = 'none recorded — a live design check runs locally only, unless the platform reports a deployment for this PR';
export const PREVIEW_UNFILLED = 'a preview_url pattern is recorded but could not be filled here — `yad review context --pr <n>` gives the address';
export const PREVIEW_UNUSABLE = 'the recorded preview_url pattern cannot be used — a live design check runs locally only, unless the platform reports a deployment for this PR; fix it with `yad repo preview <repo> <pattern>`';
export function previewLine(meta, { pr, branch } = {}) {
  const pat = previewPattern(meta);
  if (pat.problems) return PREVIEW_UNUSABLE;
  if (!pat.pattern) return PREVIEW_NONE;
  const url = fillPattern(pat.pattern, { pr, branch, repo: meta?.name });
  return url ? `<${url}>` : PREVIEW_UNFILLED;
}
