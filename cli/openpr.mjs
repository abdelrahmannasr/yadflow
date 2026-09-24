// `yad open-pr` — open a code-repo task PR/MR from the repo's platform template (Build).
// Detects the platform, pushes the current branch, and creates the PR/MR with Summary / Story-task /
// Impact & Risk prefilled. Distinct from `yad gate open`, which opens a Shape artifact-review PR
// on the Product.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, warn, hand, fail, run, exists, readJSON } from './lib.mjs';
import { PROJECT_FILES , productConfigPath } from './manifest.mjs';
import {
  detectPlatform, createPr, platformLogin, resolveBaseBranch,
} from './platform.mjs';
import { taskFromBranch } from './commit.mjs';
import { parseReviewBranch, artifactFromBase, gateCapFor, capLimit, peopleWord, gateRuleSum, gateRuleEnforced, legacyLogins } from './epic-state.mjs';
import { activePeople } from './people.mjs';
import { baseCodeowners, ownersFor, parseCodeowners } from './codeowners.mjs';
import { baseChangeLevel, changedSince, recentAuthorsFor, suggestedAuthorsFor } from './riskmap-command.mjs';
import { personLabel } from './riskmap.mjs';
import { gateOpen } from './gate.mjs';

// Resolve the target code repo: --repo <name> from the registry, else --dir, else cwd.
function resolveRepo(root, { repo, dir }) {
  if (repo) {
    const reg = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
    const found = reg.repos.find((r) => r.name === repo);
    if (found) return { repoRoot: path.resolve(root, found.path), meta: found };
  }
  return { repoRoot: path.resolve(root, dir || '.'), meta: null };
}

// Which SDLC stage is this PR? The Product serves two vehicles; a code repo only one. Mirrors the
// `--head` split the Product pattern gates (pr-title.sh/pr-template.sh) already apply:
//   code-repo    — NOT the Product (a registry repo via --repo, or root is not a Product).
//   hub-shape    — the Product itself AND head is a review/EP-* branch (artifact-review PR).
//   hub-tooling  — the Product itself AND head is anything else (a tooling/CI change to the Product).
// `meta` (truthy when resolved from the repos registry via --repo) is a connected code repo, so it is
// never the Product regardless of its path. Otherwise "is the Product" = repoRoot resolves to root AND root
// carries .sdlc/hub.json. path.resolve normalises `--dir .` / trailing slashes.
export function detectStage(root, repoRoot, head, meta) {
  if (meta) return 'code-repo';
  const isHub = path.resolve(repoRoot) === path.resolve(root)
    && exists(productConfigPath(root));
  if (!isHub) return 'code-repo';
  return /^review\/EP-[a-z0-9-]+\//.test(head || '') ? 'hub-shape' : 'hub-tooling';
}

// The bundled code-task template — the same file `REPO_WIRING` installs into code repos, resolved
// from the package (mirrors how manifest.mjs reads ../package.json). Used for a hub-tooling PR, whose
// `.github/pull_request_template.md` is the ARTIFACT-REVIEW template (wrong shape for the code-task
// Product gate). Falls back to a minimal body that still carries every section the gate requires.
function codeTaskTemplate(platform) {
  const rel = platform === 'gitlab'
    ? '../skills/yad-pr-template/templates/gitlab/merge_request_templates/Default.md'
    : '../skills/yad-pr-template/templates/github/pull_request_template.md';
  try {
    return fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  } catch {
    return [
      '## Summary', '',
      '## Impact & Risk',
      '- **Domains / repos touched:** <repo>',
      '- **Contract surface touched:** no',
      '- **Risk level:** low',
      '',
      '## Checklist',
      '- [ ] Lint, build, and tests pass (build/test/lint gate)',
      '',
    ].join('\n');
  }
}

export function templateBody(repoRoot, platform, { task, summary, risk, contract, domains, stage }) {
  // hub-tooling: the Product's own template is artifact-review — use the bundled code-task template so the
  // body matches the shape the Product `pr-template` gate demands for a non-review head.
  let base;
  if (stage === 'hub-tooling') {
    base = codeTaskTemplate(platform);
  } else {
    const tplPath = platform === 'gitlab'
      ? path.join(repoRoot, '.gitlab/merge_request_templates/Default.md')
      : path.join(repoRoot, '.github/pull_request_template.md');
    base = exists(tplPath) ? fs.readFileSync(tplPath, 'utf8') : codeTaskTemplate(platform);
  }
  // The Spec line's placeholder is the STORY dir `specs/EP-<slug>-S0N/` (no `-T0N`), so the task
  // regex below never touches it — derive the story from the task (task minus its `-T0N` suffix).
  const story = task ? task.replace(/-T\d+$/i, '') : null;
  // Fill the obvious fields; leave the rest of the committed template intact for the author.
  // Function replacers (not string replacements) so a `$` in interpolated free text — a commit-derived
  // summary or a repo name — is inserted verbatim, never read as a `$1`/`$&` replacement token.
  let out = base
    .replace(/EP-<slug>-S0N-T0N/g, () => task || 'EP-<slug>-S0N-T0N')
    .replace(/specs\/EP-<slug>-S0N\//g, () => `specs/${story || 'EP-<slug>-S0N'}/`)
    .replace(/(\*\*Risk level:\*\*)\s*\w+/i, (_m, g1) => `${g1} ${risk}`)
    .replace(/(\*\*Contract surface touched:\*\*)\s*\w+/i, (_m, g1) => `${g1} ${contract ? 'yes' : 'no'}`)
    .replace(/(\*\*Domains \/ repos touched:\*\*).*/i, (_m, g1) => `${g1} ${domains || '<repo>'}`);
  if (summary) {
    // Replace the "## Summary" heading + its optional guidance comment with the real summary.
    // `\r?\n` tolerates a CRLF-checked-out template (Windows core.autocrlf) so the fill never no-ops.
    out = out.replace(/(## Summary\r?\n)(?:<!--[\s\S]*?-->\r?\n)?/, (_m, g1) => `${g1}${summary}\n`);
  }
  return out;
}

// E66 — how many approvers this PR asks for, printed once it is open: the body's own level and contract
// answer (what `--risk` / `--contract-change` put there), and the risk map on the BASE branch — a change
// touching a `high` directory adds the high step. The largest step wins, so the map can raise what the
// body says and never lower it. The same sum `checks/risk-route.sh` prints from the PR body. Printed
// only, never written: the body keeps the author's level (the user's decision, 2026-09-18).
export function routeCount(repoRoot, baseBranch, opts = {}) {
  const map = baseChangeLevel(repoRoot, `origin/${baseBranch}`);
  const high = (map.dirs || []).filter((d) => d.level === 'high').map((d) => `${d.dir}${d.state === 'guessed' ? ' (guessed)' : ''}`);
  let riskStep = 0;
  let risk = 'normal';
  if (opts.risk === 'high' || high.length) { riskStep = 1; risk = 'high'; }
  if (opts.contractChange) { riskStep = 2; risk = 'contract'; }
  const rule = { base: 1, riskStep, needed: 1 + riskStep, risk };
  const lines = [];
  if (map.unknown) lines.push([info, `risk map not counted — ${map.unknown}; the count below is the body's alone`]);
  else if (map.noMap) lines.push([info, `risk map: none — ${map.noMap}`]);
  else if (high.length) lines.push([info, `risk map on ${map.base}: high — ${high.join(', ')}`]);
  // E67 — who can meet the ask a `high` directory makes: someone who has committed there in the last 30
  // days, from the BASE branch's history, this change's own authors left out. Reported, never enforced.
  if (high.length) {
    const hist = recentAuthorsFor(repoRoot, `origin/${baseBranch}`, { entries: map.entries, changed: map.changed });
    if (hist.unknown) lines.push([info, `who has worked there lately: not read — ${hist.unknown}`]);
    else if (hist.authors.length) {
      lines.push([hand, `this change asks for an approval from someone who has committed in ${high.join(', ')} in the last 30 days: ${hist.authors.map(personLabel).join(', ')}`]);
    } else lines.push([info, `nobody else has committed in ${high.join(', ')} in the last 30 days — ask anyone who knows it`]);
  }
  if (high.length && opts.risk !== 'high') lines.push([warn, `the body says Risk level: ${opts.risk || 'low'}, but the risk map on ${map.base} marks ${high.join(', ')} high — the larger counts`]);
  // E72 — the cap, SHOWN and never enforced here. The Build count never holds a merge: the platform's
  // branch protection does (Part 9), and the user decided (2026-09-21) that the Build half stays
  // reported even after E108 turns the Shape cap on. That is also E66's answer: the CI half of this count runs from the PR's own checkout of
  // `checks/`, so a PR can edit the script that counts it — harmless only because nothing blocks on it.
  // `gateRuleEnforced` is called WITHOUT the cap on purpose, so the line keeps saying "advisory".
  const cap = gateCapFor(rule, opts.active);
  const capped = cap?.capped ? `, capped to ${cap.to} for ${cap.active} active ${peopleWord(cap.active)}` : '';
  lines.push([riskStep ? hand : info, `this PR asks for ${gateRuleSum(rule)}${capped}${gateRuleEnforced(rule)}; \`bash checks/risk-route.sh "<pr body>" ${map.base}\` prints the count without the cap`]);
  // E71 — how many people are around to meet that ask. `opts.active` is the Product-wide count the
  // CALLER already read: this function runs in a code repo, which has no Product of its own to read
  // (the E65 finding that keeps `checks/*.sh` out of this entirely), so it is handed the number or
  // nothing. `null` means no source could be read, which is never the same as "few people".
  if (opts.active !== undefined) {
    lines.push([info, opts.active === null
      ? 'active people: not counted — no cap applies; reported only, and an unreadable source is never read as few people'
      : `active people: ${opts.active} — caps the count at ${capLimit(opts.active)}; reported only, a Build merge is held by branch protection, not by this count`]);
  }
  return { rule, map, lines };
}

// E68 — a reviewer SUGGESTION, printed once the PR is open. Two separate hints, never merged: the people
// who have committed in the folders this change touches in the last 30 days (base branch, the change's
// own authors and robots left out), and what CODEOWNERS on the base lists for those files. It holds
// nothing, waives nothing and requests no one — E62 decided PRs request no reviewers, and a name here is
// a hint about who MAY know the code, never a claim about who owns it or who must approve. A git name
// and a CODEOWNERS login are joined only on exact evidence: a commit address that carries that login.
export const SUGGEST_SHOWN = 5;
// The host of a remote URL — `https://host/…`, `ssh://user@host:port/…` or scp-like `user@host:path` —
// lower-cased, or null.
export function remoteHost(url) {
  const u = String(url || '').trim();
  const m = u.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i) || u.match(/^(?:[^@/]+@)?([^:/]+):(?!\/\/)/);
  return m ? m[1].toLowerCase() : null;
}
// A noreply login is a github.com or gitlab.com account. It is evidence for a CODEOWNERS `@name` only
// on that same public host: a self-managed GitLab or GitHub Enterprise keeps its own accounts, and
// one spelled the same may be someone else.
export const PUBLIC_HOST = { github: 'github.com', gitlab: 'gitlab.com' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function suggestReviewers(repoRoot, baseBranch, platform, { remote } = {}) {
  const base = `origin/${baseBranch}`;
  const url = remote ?? run('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot }).stdout;
  const sameHost = remoteHost(url) === PUBLIC_HOST[platform];
  const lines = [];
  const ch = changedSince(repoRoot, base);
  if (ch.unknown) return { lines: [[info, `reviewer suggestion: not read — ${ch.unknown}`]] };
  if (!ch.files.length) return { lines: [[info, `reviewer suggestion: none — this branch changes no file against ${base}`]] };

  const hist = suggestedAuthorsFor(repoRoot, base, { changed: ch.files });
  const where = hist.folders > 1 ? `the ${hist.folders} folders this change touches` : hist.folders === 1 ? 'the folder this change touches' : 'the folders this change touches';
  const cut = hist.skipped ? ` (${plural(hist.skipped, 'more folder')} not asked about — the list stops at ${hist.folders})` : '';
  const logins = new Set();
  if (hist.unknown) lines.push([info, `who has committed in ${where} lately: not read — ${hist.unknown}`]);
  else if (!hist.authors.length) lines.push([info, `nobody else has committed in ${where} in the last 30 days${cut}`]);
  else {
    // Only a login from THIS platform's noreply address is evidence for a CODEOWNERS `@name` here.
    for (const a of hist.authors) if (a.login && a.loginHost === platform && sameHost) logins.add(a.login);
    const shown = hist.authors.slice(0, SUGGEST_SHOWN).map((a) => `${personLabel(a)} — ${plural(a.commits, 'commit')}`);
    const more = hist.authors.length > SUGGEST_SHOWN ? `, and ${hist.authors.length - SUGGEST_SHOWN} more` : '';
    lines.push([hand, `may know this code — committed in ${where} in the last 30 days: ${shown.join(', ')}${more}${cut}`]);
  }

  const co = baseCodeowners(repoRoot, base, platform);
  let listed = false;
  if (co.unknown) lines.push([info, `CODEOWNERS: not read — ${co.unknown}`]);
  else if (co.none) lines.push([info, `CODEOWNERS: none — ${co.none}`]);
  else {
    const parsed = parseCodeowners(co.text, platform);
    const got = ownersFor(parsed, ch.files);
    // A file with no owner: no line matched it, the matching line names nobody, or a GitLab `!` line
    // excludes it — the same answer for a reviewer, so one count.
    const unmatched = got.unmatched ? `; ${got.unmatched} of ${plural(ch.files.length, 'touched file')} ${got.unmatched === 1 ? 'has' : 'have'} no owner there` : '';
    // A line this reader skipped could have been the last match for a file, so an answer built without it
    // may be wrong — and "nobody" most of all, since the skipped line may be the only one that matched.
    const skippedN = parsed.skipped.length ? plural(parsed.skipped.length, 'line') : '';
    if (!got.owners.length) {
      lines.push([info, skippedN
        ? `CODEOWNERS on ${base} (${co.path}) lists nobody this reader could match for the files this change touches; ${skippedN} could not be read, so this may be wrong`
        : `CODEOWNERS on ${base} (${co.path}) lists nobody for the files this change touches`]);
    } else {
      listed = true;
      const tag = { team: ' (a team)', group: ' (a group)', role: ' (a role)' };
      const shown = got.owners.slice(0, SUGGEST_SHOWN).map((o) => {
        // "the 30-day history", not "above": the person may be one of the `and N more` not shown.
        const also = (o.kind === 'user' || o.kind === 'name') && logins.has(o.text.slice(1)) ? ', also in the 30-day history' : '';
        const notes = [tag[o.kind]?.slice(2, -1), o.optional ? 'optional section' : '', also.slice(2)].filter(Boolean);
        return `${o.text}${notes.length ? ` (${notes.join(', ')})` : ''}`;
      });
      const more = got.owners.length > SUGGEST_SHOWN ? `, and ${got.owners.length - SUGGEST_SHOWN} more` : '';
      const gl = platform === 'gitlab' && got.owners.some((o) => o.kind === 'name') ? '; on GitLab an @name can be a person or a group' : '';
      const partial = skippedN ? `; ${skippedN} could not be read, so this list may be wrong` : '';
      lines.push([hand, `CODEOWNERS on ${base} (${co.path}) lists for the touched files: ${shown.join(', ')}${more}${unmatched}${partial} — a hint only: these files go stale, and yad does not check that anyone listed still works here${gl}`]);
    }
    for (const s of parsed.skipped.slice(0, 3)) lines.push([warn, `CODEOWNERS line ${s.line} not read — ${s.why}`]);
    if (parsed.skipped.length > 3) lines.push([warn, `CODEOWNERS: ${plural(parsed.skipped.length - 3, 'more line')} not read`]);
  }
  const both = listed && hist.authors?.length;
  lines.push([info, `a suggestion only — nobody was asked to review, and no name above is an owner or a required approver${both ? '; the same person can appear in both lists under two names (yad joins them only when a commit address carries the exact @login)' : ''}`]);
  return { lines };
}

export async function runOpenPr(root, opts = {}) {
  log(c.bold('\nyad open-pr'));
  const { repoRoot, meta } = resolveRepo(root, opts);
  if (!exists(path.join(repoRoot, '.git'))) { fail(`not a git repo: ${repoRoot}`); process.exitCode = 1; return; }

  const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot }).stdout;
  const platform = opts.platform || meta?.platform || detectPlatform(remote);
  if (!platform) { fail('could not detect platform (github/gitlab) — pass --platform'); process.exitCode = 1; return; }

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot }).stdout;
  const stage = detectStage(root, repoRoot, branch, meta);

  // hub-shape: this is a Shape artifact-review PR (review/EP-*/<artifact> head on the Product). The
  // artifact-review title, body, and ledger bookkeeping all live in `yad gate open` — delegate to it
  // rather than emit the code-task shape (which the Product gate would reject). Push first (gateOpen does
  // not push), then hand off; any --title/--message is dropped (gateOpen sets `review: …`).
  if (stage === 'hub-shape') {
    const parsed = parseReviewBranch(branch);
    if (!parsed) { fail(`could not parse review branch '${branch}' (expected review/EP-<slug>/<artifact>)`); process.exitCode = 1; return; }
    info(`pushing ${branch} …`);
    const fpush = run('git', ['push', '-u', 'origin', branch], { cwd: repoRoot });
    if (!fpush.ok) { fail(`git push failed — ${fpush.stderr.split('\n')[0] || 'unknown'}`); process.exitCode = 1; return; }
    // Pass the branch we just pushed as the head so gateOpen opens the PR against it (its own
    // recompute would collapse a per-story base). gateOpen signals failure by returning no url —
    // mirror open-pr's own error contract so `ship` sees the non-zero exit and never reports success.
    // (On a platform-less Product gateOpen marks the step in_review locally and returns no url; open-pr's
    // job is to open a PR, so "no PR opened" is a non-zero outcome here, unlike `yad gate open`.)
    const res = await gateOpen(root, { epic: parsed.epic, artifact: artifactFromBase(parsed.base), head: branch });
    if (!res?.url) process.exitCode = 1;
    return res;
  }

  // The Product's default_branch, which only applies when the PR targets the Product ITSELF
  // (a hub-tooling branch) — for a connected code repo the Product's trunk belongs to a different repo and
  // must never leak in. Resolved AFTER the hub-shape hand-off above, which delegates its own base to
  // `yad gate open`: resolving before it would spend a platform round-trip and print a base that the
  // delegated path then ignores.
  const hub = readJSON(productConfigPath(root), {});

  // Resolve the base rather than assume it (#168). Hardcoding 'main' mis-based every PR on a repo
  // whose trunk is something else — and CodeRabbit decides auto-review eligibility from the base at
  // PR-OPEN time, so those PRs silently got no AI first pass at all.
  const { base: baseBranch, source: baseSource, platformDefault } = resolveBaseBranch(platform, {
    cwd: repoRoot, explicit: opts.base, meta, hub: stage === 'code-repo' ? null : hub, runner: opts.runner,
  });
  if (branch === baseBranch) { fail(`on ${baseBranch} — switch to your task branch first`); process.exitCode = 1; return; }
  info(`base ${baseBranch} ${c.dim(`(from ${baseSource})`)}`);
  // A base that is not the remote's default is legitimate (stacked PRs, release branches) but it costs
  // the AI first pass, invisibly and irreversibly — so it is never silent. The REMEDY depends on where
  // the base came from: telling someone to override a `default_branch` they deliberately configured
  // would mean contradicting their own committed config on every PR, forever.
  if (platformDefault && platformDefault !== baseBranch) {
    warn(`base '${baseBranch}' is not the repo default '${platformDefault}' — CodeRabbit skips auto-review on a non-default base unless .coderabbit.yaml lists it under reviews.base_branches, and retargeting later does NOT undo the skip`);
    if (baseSource === 'registry' || baseSource === 'hub') {
      hand(`the configured default_branch (${baseSource === 'hub' ? '.sdlc/hub.json' : '.sdlc/repos.json'}) disagrees with the platform — reconcile them, or allow '${baseBranch}' in .coderabbit.yaml`);
    } else {
      hand(`open against '${platformDefault}' (or pass --base ${platformDefault}) unless you meant to stack this PR`);
    }
  }

  // Push the branch (sets upstream) using the user's own auth. Abort on failure — creating a PR for a
  // branch that is not on the remote just fails with a more confusing error.
  info(`pushing ${branch} …`);
  const push = run('git', ['push', '-u', 'origin', branch], { cwd: repoRoot });
  if (!push.ok) { fail(`git push failed — ${push.stderr.split('\n')[0] || 'unknown'}`); process.exitCode = 1; return; }

  const task = opts.task || taskFromBranch(branch);
  const subject = run('git', ['log', '-1', '--format=%s'], { cwd: repoRoot }).stdout;
  const title = opts.title || subject || `task ${task || branch}`;
  // Summary = commit subject (Conventional-Commits "type:" prefix stripped) + body paragraphs,
  // dropping the Task / Contract-Change / Co-Authored-By trailer lines. `run().stdout` is trimmed
  // but keeps internal newlines, so a multi-line body survives.
  const subjectText = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '');
  const bodyText = run('git', ['log', '-1', '--format=%b'], { cwd: repoRoot }).stdout
    .split('\n')
    .filter((l) => !/^(Task|Contract-Change|Co-Authored-By):/i.test(l.trim()))
    .join('\n')
    .trim();
  const summary = [subjectText, bodyText].filter(Boolean).join('\n\n') || undefined;
  const body = templateBody(repoRoot, platform, {
    task, summary, risk: opts.risk || 'low', contract: !!opts.contractChange, domains: meta?.name, stage,
  });

  // Assignee = the committer: `@me` on GitHub (buildPrArgs sends it when no assignee is named, and `gh`
  // resolves it on the repo's own host), the login `glab` reports on GitLab. No reviewers are requested (E62): the roster that named them is gone. The team requests them
  // on the PR; E68 prints a suggestion from history and CODEOWNERS below, and requests no one.
  const committer = platform === 'gitlab' ? platformLogin(repoRoot, platform) : null;
  const assignees = committer ? [committer] : [];

  // `creator` is injectable (mirrors gateOpen's) so a test can assert the base that reaches the
  // platform CLI without shelling out to gh/glab.
  const creator = opts.creator || createPr;
  const r = creator(platform, { title, body, base: baseBranch, head: branch, assignees, cwd: repoRoot });
  if (!r.ok) { fail(`could not open PR/MR — ${r.reason || 'unknown'}`); process.exitCode = 1; return; }
  ok(`opened ${r.url}`);
  hand('no reviewers were requested — ask them on the PR itself');
  // The Product-wide active count (E71), read ONCE here and handed down: `routeCount` works inside a
  // code repo and must not go looking for a Product itself.
  //
  // ONLY WHEN `root` REALLY IS A PRODUCT. `root` is the working directory, and running this command
  // from inside the code repo is a supported path — `detectStage` returns `code-repo` for exactly that
  // case. Counting from there would have walked the CODE REPO's history and reported its committers as
  // the whole team: no `epics/` (so no ledger and no `unknown`), no `.sdlc/repos.json` (which is a
  // readable "no connected repos"), and one git log that works — a confident, smaller, wrong number,
  // feeding the number E72 caps with. `null` is the honest answer there: we are not standing in a
  // Product, so we did not count.
  const active = (() => {
    // Only the `code-repo` stage prints it (`routeCount`, below). On a `hub-tooling` PR this would
    // otherwise walk the Product and every connected repo's history and throw the answer away.
    if (stage !== 'code-repo') return null;
    if (!exists(productConfigPath(root))) return null;
    // `readJSON`, not `readJSONStrict`, and that is not the degradation cli/people.mjs warns about:
    // losing the roster's name -> login table only stops OLDER records being joined to a login, so a
    // person lands on two rows instead of one. That over-counts, the safe direction here. The count
    // itself still refuses on every source it cannot read.
    try { return activePeople(root, { aliases: legacyLogins(readJSON(productConfigPath(root), null)) }).capacity.active; } catch { return null; }
  })();
  const count = stage === 'code-repo' ? routeCount(repoRoot, baseBranch, { ...opts, active }) : null;
  if (count) for (const [say, line] of count.lines) say(line);
  else if (opts.risk === 'high' || opts.contractChange) hand('high risk / contract surface — run `bash checks/risk-route.sh "<pr body>"` to see how many approvers it asks for');
  if (stage === 'code-repo') for (const [say, line] of suggestReviewers(repoRoot, baseBranch, platform, { remote }).lines) say(line);
  // The --json answer (E1). The count and the reviewer suggestion are said in prose, and a warning among
  // them reaches `warnings`; nothing here is a request — no reviewer is ever asked for (E62).
  return { url: r.url, platform, stage, base: baseBranch, baseSource, branch, title, task: task || null };
}
