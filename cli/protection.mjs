// E70 — what the PLATFORM holds on a repo's branch: branch protection, and whether any rule requires an
// approval before a merge. yad never enforces a merge itself (Part 4: platform branch protection is "the
// real enforcement"), so this is a READ, reported by `yad doctor`, and it may never claim more than it read.
//
// THE TRAP THIS FILE EXISTS FOR. A failed call is not an answer. GitHub answers 404 on classic branch
// protection to anyone who is not an admin — even on a branch its own `branches/<b>` call reports as
// `protected: true` (checked on cli/cli's trunk, 2026-09-22). So "no rules" is PROVEN only from calls that
// succeeded, and anything else is `null` — "not known", with the reason — never "none" and never "fine".
//
// What counts as an approval rule (the user's decision, 2026-09-22): a required approving review count
// above 0.
//   GitHub  — a ruleset `pull_request` rule (`rules/branches/<b>`: every ACTIVE rule on the branch, from
//             the repo or the organisation; needs only read access), and classic branch protection's
//             `required_pull_request_reviews` (`branches/<b>/protection`: admins only).
//   GitLab  — a project approval rule with `approvals_required` above 0 that applies to the branch. The
//             API is GitLab Premium and Ultimate only; on Free an approval never blocks a merge. A refusal
//             is "needs Premium, or your login may not read it" — the tier is never guessed.
// Protection alone (no direct push) and a code-owner review are FACTS beside the answer, not approval
// rules: a code-owner review covers only the files CODEOWNERS names.
//
// Every call is the user's own `gh`/`glab`, logged in as the user, to the repo's own host (rule 8: nothing
// leaves the machine for anywhere else). `YAD_PLATFORM_READ=0` turns the reads off — for offline work, and
// for the test suite, which must never ask the developer's real account (the `YAD_PLATFORM_LOGIN=0`
// precedent). `runner` is injectable so every answer is testable without a network.
import { run } from './lib.mjs';
import { cliFor, hostFromGitUrl, detectPlatform } from './platform.mjs';

export const PLATFORM_NAME = { github: 'GitHub', gitlab: 'GitLab' };
const TIMEOUT = 10_000;

// A word with an `@` after its first character may be an e-mail address, and no address is ever printed
// (E67). A branch or a repo path is printed as written otherwise.
export const shown = (w) => (typeof w === 'string' && w.indexOf('@', 1) >= 0 ? 'a name with an @ in it' : `${w}`);

// The repo's path on its host (`owner/repo`, or `group/sub/project` on GitLab), from a git remote URL in
// either form. Not doctor's `repoSlug`, which keeps only the last two parts and so names the wrong GitLab
// project under a subgroup.
export function repoPathFromGitUrl(url = '') {
  if (typeof url !== 'string' || !url.trim()) return null;
  const u = url.trim();
  let p;
  // scp-like `[user@]host:path`. A `scheme://` URL never matches: the colon is followed by `/`.
  const scp = u.match(/^(?:[^@/]+@)?[^/:]+:(?!\/)(.+)$/);
  if (scp) p = scp[1];
  else {
    try { p = new URL(u).pathname; } catch { return null; }
  }
  p = p.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  const parts = p.split('/').filter(Boolean);
  return parts.length >= 2 ? parts.join('/') : null;
}

// The HTTP status of a failed `gh api` / `glab api` call, or null when there was none (offline, a timeout,
// the host is down). gh ends with `gh: Not Found (HTTP 404)`; glab with `glab: 404 Not Found (HTTP 404)`
// and prints the body `{"message":"401 Unauthorized"}` on stdout.
export function httpStatus(r) {
  const text = `${r?.stderr || ''}\n${r?.stdout || ''}`;
  const m = text.match(/\(HTTP (\d{3})\)/) || text.match(/\bglab: (\d{3})\b/) || text.match(/"message":\s*"(\d{3})\b/)
    || text.match(/"status":\s*"(\d{3})"/);
  return m ? Number(m[1]) : null;
}

function api(runner, cli, host, pathname) {
  const r = runner(cli, ['api', '--hostname', host, pathname], { timeout: TIMEOUT });
  if (r.ok) {
    try { return { ok: true, body: JSON.parse(r.stdout) }; } catch { return { ok: false, status: null, unreadable: true }; }
  }
  return { ok: false, status: httpStatus(r) };
}

// One page of 100 is read, never more. A FULL page proves nothing about what is past it, so a list that
// comes back with exactly PAGE entries and does not already hold the answer is "not known".
export const PAGE = 100;

// Why a call gave no answer, as a clause that finishes "not known — ".
function whyFailed(res, { platform, host, what }) {
  const name = PLATFORM_NAME[platform];
  if (res.unreadable) return `${name} answered ${what} with something yad could not read`;
  if (res.status == null) return `yad could not reach ${host} to read ${what} (offline, or the host did not answer)`;
  if (res.status === 401) return `${name} refused to show ${what} (HTTP 401 — the login may have expired)`;
  if (res.status === 403) return `${name} refused to show ${what} (HTTP 403 — your login may not read it)`;
  if (res.status === 404) return `${name} answered 404 for ${what} (it does not exist, or your login may not see it)`;
  return `${name} answered HTTP ${res.status} for ${what}`;
}

const segment = (b) => b.split('/').map(encodeURIComponent).join('/');

// A GitLab protected-branch name may be a wildcard (`release-*`); `*` matches any run of characters.
export function branchMatches(pattern, branch) {
  if (typeof pattern !== 'string') return false;
  if (!pattern.includes('*')) return pattern === branch;
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(branch);
}

// The answer, for one repo and one branch. Every field that could not be read is null with a reason:
//   { platform, host, repo, branch, branchFrom, platformDefault,
//     known: false, why }                                  — nothing could be asked at all, or
//   { …, known: true,
//     protected: true|false|null, protectedWhy,            — is the branch protected at all?
//     approvals: n|null, approvalsWhy, from: [..],         — the largest required approval count, and where
//     codeOwners: true|false|null }                        — a code-owner review is required (a fact beside)
export function readProtection({ platform, gitUrl, branch = null, branchFrom = 'registry' } = {}, { runner = run, env = process.env } = {}) {
  const host = hostFromGitUrl(gitUrl || '');
  const repo = repoPathFromGitUrl(gitUrl || '');
  const plat = platform || detectPlatform(gitUrl || '') || null;
  const base = { platform: plat, host, repo, branch, branchFrom, platformDefault: null };
  const cli = cliFor(plat);
  if (!cli) return { ...base, known: false, why: platform ? `yad does not know the platform ${JSON.stringify(platform)} (it reads GitHub and GitLab)` : 'no platform (GitHub or GitLab) is set, so there is no platform to ask' };
  if (env.YAD_PLATFORM_READ === '0') return { ...base, known: false, why: 'platform reads are turned off (YAD_PLATFORM_READ=0)' };
  if (!host || !repo) return { ...base, known: false, why: 'no git remote URL yad can read, so it cannot tell which repo to ask about' };
  const which = runner(process.platform === 'win32' ? 'where' : 'which', [cli], {});
  if (!which.ok) return { ...base, known: false, why: `${cli} is not installed, so yad cannot ask ${PLATFORM_NAME[plat]}` };
  if (!runner(cli, ['auth', 'status', '--hostname', host], { timeout: TIMEOUT }).ok) {
    return { ...base, known: false, why: `${cli} is not logged in for ${host} (or ${host} did not answer)` };
  }
  return plat === 'github' ? readGitHub(base, runner) : readGitLab(base, runner);
}

function readGitHub(base, runner) {
  const { host, repo } = base;
  const at = `repos/${repo.split('/').map(encodeURIComponent).join('/')}`;
  const meta = api(runner, 'gh', host, at);
  if (!meta.ok) return { ...base, known: false, why: whyFailed(meta, { platform: 'github', host, what: `the repo ${shown(repo)}` }) };
  const platformDefault = typeof meta.body?.default_branch === 'string' ? meta.body.default_branch : null;
  let { branch, branchFrom } = base;
  if (!branch) {
    if (!platformDefault) return { ...base, known: false, why: 'no default branch is set in yad\'s files, and GitHub named none' };
    branch = platformDefault; branchFrom = 'platform';
  }
  const out = { ...base, branch, branchFrom, platformDefault, known: true, protected: null, protectedWhy: null, approvals: null, approvalsWhy: null, from: [], codeOwners: null };
  const b = api(runner, 'gh', host, `${at}/branches/${segment(branch)}`);
  if (!b.ok) {
    return { ...out, known: false, why: whyFailed(b, { platform: 'github', host, what: `the branch ${shown(branch)}` }) };
  }
  if (typeof b.body?.protected !== 'boolean') return { ...out, known: false, why: 'GitHub did not say whether the branch is protected' };
  out.protected = b.body.protected;
  // Rulesets: every ACTIVE rule on the branch ("evaluate" and "disabled" rulesets are not returned).
  const rules = api(runner, 'gh', host, `${at}/rules/branches/${segment(branch)}?per_page=${PAGE}`);
  let rulesetCount = null;
  let rulesetCodeOwners = false;
  if (rules.ok && Array.isArray(rules.body)) {
    rulesetCount = 0;
    for (const r of rules.body) {
      if (r?.type !== 'pull_request') continue;
      const n = Number(r.parameters?.required_approving_review_count);
      if (r.parameters?.require_code_owner_review === true) rulesetCodeOwners = true;
      if (Number.isInteger(n) && n > 0) {
        rulesetCount = Math.max(rulesetCount, n);
        out.from.push(`${r.ruleset_source_type === 'Organization' ? 'an organisation' : 'a repo'} ruleset${r.ruleset_id != null ? `, id ${r.ruleset_id}` : ''}`);
      }
    }
    // Any active rule at all is a protection, even one GitHub's `protected` flag may not count.
    if (rules.body.length && out.protected === false) out.protected = true;
    if (rulesetCount === 0 && rules.body.length >= PAGE) rulesetCount = null;
  }
  const rulesWhy = rules.ok && Array.isArray(rules.body)
    ? (rulesetCount === null ? `the branch has ${PAGE} or more active rules and yad reads only the first ${PAGE}` : null)
    : whyFailed(rules.ok ? { unreadable: true } : rules, { platform: 'github', host, what: 'the rulesets on the branch' });
  // Classic protection. `protected: false` with no active ruleset is a proven "none"; there is nothing
  // classic to read, and asking would only earn a 404 that proves nothing.
  let classicCount = null;
  let classicWhy = null;
  let classicCodeOwners = false;
  if (b.body.protected) {
    const p = api(runner, 'gh', host, `${at}/branches/${segment(branch)}/protection`);
    if (p.ok) {
      const rev = p.body?.required_pull_request_reviews;
      const n = Number(rev?.required_approving_review_count);
      classicCount = rev && Number.isInteger(n) ? n : 0;
      if (rev?.require_code_owner_reviews === true) classicCodeOwners = true;
      if (classicCount > 0) out.from.push('classic branch protection');
    } else {
      classicWhy = p.status === 404
        ? 'only a repo admin can read classic branch protection, and GitHub answered 404 (your login is not an admin, or the branch is protected by rulesets alone)'
        : whyFailed(p, { platform: 'github', host, what: 'classic branch protection' });
    }
  } else {
    classicCount = 0;
  }
  out.codeOwners = rulesetCodeOwners || classicCodeOwners ? true : (classicWhy || rulesWhy ? null : false);
  if ((rulesetCount ?? 0) > 0 || (classicCount ?? 0) > 0) {
    // GitHub applies the strictest of the layered rules, so the count is exact only when both were read.
    out.approvals = Math.max(rulesetCount ?? 0, classicCount ?? 0);
    out.atLeast = rulesetCount === null || classicCount === null;
  } else if (rulesetCount === 0 && classicCount === 0) {
    out.approvals = 0;
  } else {
    out.approvalsWhy = [rulesWhy, classicWhy].filter(Boolean).join('; ');
  }
  return out;
}

function readGitLab(base, runner) {
  const { host, repo } = base;
  const at = `projects/${encodeURIComponent(repo)}`;
  const meta = api(runner, 'glab', host, at);
  if (!meta.ok) return { ...base, known: false, why: whyFailed(meta, { platform: 'gitlab', host, what: `the project ${shown(repo)}` }) };
  const platformDefault = typeof meta.body?.default_branch === 'string' ? meta.body.default_branch : null;
  let { branch, branchFrom } = base;
  if (!branch) {
    if (!platformDefault) return { ...base, known: false, why: 'no default branch is set in yad\'s files, and GitLab named none' };
    branch = platformDefault; branchFrom = 'platform';
  }
  const out = { ...base, branch, branchFrom, platformDefault, known: true, protected: null, protectedWhy: null, approvals: null, approvalsWhy: null, from: [], codeOwners: null };
  const pb = api(runner, 'glab', host, `${at}/protected_branches?per_page=${PAGE}`);
  if (pb.ok && Array.isArray(pb.body)) {
    const matched = pb.body.filter((p) => branchMatches(p?.name, branch));
    if (!matched.length && pb.body.length >= PAGE) {
      out.protectedWhy = `the project has ${PAGE} or more protected branches and yad reads only the first ${PAGE}`;
    } else {
      out.protected = matched.length > 0;
      out.codeOwners = matched.some((p) => p?.code_owner_approval_required === true);
    }
  } else {
    out.protectedWhy = whyFailed(pb.ok ? { unreadable: true } : pb, { platform: 'gitlab', host, what: 'the protected branches' });
  }
  const ar = api(runner, 'glab', host, `${at}/approval_rules?per_page=${PAGE}`);
  if (ar.ok && Array.isArray(ar.body)) {
    let most = 0;
    for (const r of ar.body) {
      const n = Number(r?.approvals_required);
      if (!Number.isInteger(n) || n <= 0) continue;
      const listed = Array.isArray(r.protected_branches) ? r.protected_branches : [];
      let applies;
      if (r.applies_to_all_protected_branches === true) applies = out.protected; // null when unknown
      else if (listed.length) applies = listed.some((p) => branchMatches(p?.name, branch));
      else applies = true; // a rule scoped to no branch applies to every branch
      if (applies === null) { out.approvalsWhy = `an approval rule applies to every protected branch, and ${out.protectedWhy}`; continue; }
      if (applies) { most = Math.max(most, n); out.from.push(`approval rule ${JSON.stringify(shown(String(r.name ?? r.id)))}`); }
    }
    // Each GitLab rule must be met on its own and their approvers may overlap, so the largest is a floor.
    if (most > 0) { out.approvals = most; out.approvalsWhy = null; out.atLeast = out.from.length > 1; } else if (ar.body.length >= PAGE) {
      out.approvalsWhy = `the project has ${PAGE} or more approval rules and yad reads only the first ${PAGE}`;
    } else if (!out.approvalsWhy) out.approvals = 0;
  } else {
    out.approvalsWhy = ar.ok
      ? 'GitLab answered the approval rules with something yad could not read'
      : ([401, 403, 404].includes(ar.status)
        ? `GitLab refused to show the approval rules (HTTP ${ar.status}): they need GitLab Premium or Ultimate, or your login may not read them`
        : whyFailed(ar, { platform: 'gitlab', host, what: 'the approval rules' }));
  }
  return out;
}

// The doctor line for one answer: { status: 'ok'|'warn', message, hint }. `name` is the repo's name in
// yad (or "Product hub"). In solo mode (the user's decision) the facts print as `ok` with no banner — one
// person cannot approve their own pull request, so "no approval rules" may be the right setup — except
// the old solo warning: a required approval there blocks the solo developer's own merge.
//
// The Part 3 banner is printed word for word only when BOTH halves are proven: no approval rule AND no
// branch protection. Nothing here ever says a repo is safe, or that yad holds a merge.
export const BANNER = 'This repo has no approval rules and no branch protection. Anyone with write access can merge anything. yad will record what happens, but it cannot stop anything here.';

// The answer as `--json` prints it: the same, with any name that holds an `@` hidden (E67).
export function protectionJSON(r) {
  const out = { ...r };
  for (const k of ['branch', 'platformDefault', 'repo']) if (typeof out[k] === 'string') out[k] = shown(out[k]);
  if (Array.isArray(out.from)) out.from = [...out.from];
  return out;
}

export function protectionLine(r, { name, solo = false } = {}) {
  const P = PLATFORM_NAME[r.platform] || 'the platform';
  const br = !r.branch ? 'the default branch' : (shown(r.branch) === r.branch ? `\`${r.branch}\`` : shown(r.branch));
  const where = r.repo ? `${P} ${shown(r.repo)}` : P;
  const other = r.platformDefault && shown(r.platformDefault) === r.platformDefault ? `\`${r.platformDefault}\`` : shown(r.platformDefault);
  const note = r.branchFrom === 'platform'
    ? `yad's files name no default branch, so ${P}'s default was read`
    : (r.platformDefault && r.branch && r.platformDefault !== r.branch ? `${P}'s own default branch is ${other}` : '');
  const branchNote = note ? ` (${note})` : '';
  const team = solo ? 'ok' : 'warn';
  // The platform's own name for the setting that requires an approval (named, never explained: that is
  // documentation's job, not the doctor's).
  const setting = r.platform === 'gitlab'
    ? `an approval rule (GitLab Premium or Ultimate) for ${br}`
    : `${P}'s branch protection or a ruleset for ${br}`;
  if (!r.known) {
    return { status: team, message: `${name}: not known whether ${br} requires an approval — ${r.why}`, hint: unknownHint(r) };
  }
  const owners = r.codeOwners === true ? '; a code owner must also approve a change to a file CODEOWNERS lists' : '';
  if (r.approvals > 0) {
    const n = `${r.atLeast ? 'at least ' : ''}${r.approvals} approval${r.approvals === 1 ? '' : 's'}`;
    if (solo) {
      return { status: 'warn', message: `${name}: solo mode, but ${where} requires ${n} to merge into ${br}${branchNote} — you cannot approve your own pull request, so the merge will be blocked`, hint: `relax the required approvals in ${setting} (from: ${r.from.join(', ')})` };
    }
    return { status: 'ok', message: `${name}: ${where} requires ${n} to merge into ${br} (from: ${r.from.join(', ')})${note ? `; ${note}` : ''}${owners} — ${P} holds the merge, not yad` };
  }
  if (r.approvals === 0 && r.protected === false) {
    if (solo) return { status: 'ok', message: `${name}: ${where} has no approval rules and no branch protection on ${br}${branchNote} — expected in solo mode; yad records what happens, but cannot stop anything here` };
    return { status: 'warn', message: `${name} (${where}, branch ${br}${note ? `; ${note}` : ''}): ${BANNER}`, hint: `only ${P} can hold a merge — a required approval in ${setting} does it; yad only reports what is set` };
  }
  if (r.approvals === 0 && r.protected === true) {
    const msg = r.codeOwners === true
      ? `${name}: ${br} is protected on ${where}${branchNote}, but no rule requires an approval — only a change to a file CODEOWNERS lists needs a code owner's approval; anyone with write access can merge any other change of their own`
      : `${name}: ${br} is protected on ${where}${branchNote}, but no rule requires an approval — anyone with write access can merge their own pull request`;
    return solo ? { status: 'ok', message: msg } : { status: 'warn', message: msg, hint: `only ${P} can require an approval — in ${setting}; yad only reports what is set` };
  }
  if (r.approvals === 0) {
    const msg = `${name}: no rule on ${where} requires an approval to merge into ${br}${branchNote}; whether the branch is protected is not known — ${r.protectedWhy}`;
    return solo ? { status: 'ok', message: msg } : { status: 'warn', message: msg, hint: 'anyone with write access may be able to push to it directly' };
  }
  // approvals not known
  if (r.protected === false) {
    const msg = `${name}: ${br} is not protected on ${where}${branchNote} — anyone with write access can push to it directly; whether a merge needs an approval is not known — ${r.approvalsWhy}`;
    return solo ? { status: 'ok', message: msg } : { status: 'warn', message: msg, hint: r.platform === 'gitlab' ? 'on GitLab Free an approval never blocks a merge, so with no protected branch nothing holds one' : `ask someone who can see ${P}'s settings for ${br}` };
  }
  const state = r.protected === true ? `${br} is protected on ${where}${branchNote}` : `whether ${br} is protected on ${where} is not known (${r.protectedWhy})`;
  const msg = `${name}: ${state}, but whether a merge needs an approval is not known — ${r.approvalsWhy}${owners}`;
  const hint = r.platform === 'gitlab'
    ? `on GitLab Free an approval never blocks a merge; on Premium or Ultimate, a Maintainer can see the approval rules for ${br} in the project's merge request settings`
    : `ask a repo admin to check the required approvals for ${br} in ${P}'s settings`;
  return solo ? { status: 'ok', message: msg } : { status: 'warn', message: msg, hint };
}

function unknownHint(r) {
  const cli = cliFor(r.platform);
  if (/YAD_PLATFORM_READ/.test(r.why)) return 'unset YAD_PLATFORM_READ to let `yad doctor` ask the platform';
  if (/is not installed/.test(r.why)) return `install ${cli} and log in, then run \`yad doctor\` again`;
  if (/not logged in/.test(r.why)) return `run \`${cli} auth login --hostname ${r.host}\`, then \`yad doctor\` again`;
  if (/no platform|does not know the platform/.test(r.why)) return 'set `platform` (github or gitlab) in yad\'s files — `yad setup` for the Product, `yad repo connect` for a code repo';
  if (/git remote URL/.test(r.why)) return 'add `git_url` to the repo\'s entry in .sdlc/repos.json (hub.json for the Product), or give the repo an origin remote';
  if (/for the branch /.test(r.why)) return 'check that `default_branch` in yad\'s files names a branch that exists on the platform';
  return 'run `yad doctor` again when the platform can be reached; nothing about this repo\'s protection is assumed meanwhile';
}
