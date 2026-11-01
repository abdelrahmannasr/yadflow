// `yad ci check` (E160b) — will yad's checks really hold a merge? Read-only: for the Product and each code repo
// the Product registers, it reads yad's workflow files on disk and the platform's rules on the default
// branch (protection, the checks required before a merge, force pushes, deletion). Every finding is `ok`,
// `gap` (with the fix), `suggest`, or `unknown` (a read that failed: never counted as ok).
//
// The platform's settings are the person's (a human-only act): the agent hands over the exact page and the
// clicks, then runs this again to confirm by reading. yad's own files are the agent's to fix, with the
// command each gap names.
//
// The rules it reads, and how (cli/protection.mjs `readCiSettings`):
//   GitHub — a required check is named after its job. The checks required = those in the branch's active
//            rulesets plus classic branch protection's. Classic protection is readable by admins only, so a
//            job seen in neither is "not known" unless both were read. Who may bypass a ruleset is not read.
//   GitLab — "Pipelines must succeed" covers every job in the pipeline, so yad's jobs must be IN it: the
//            root `.gitlab-ci.yml` must include each of yad's fragments (the `files` row reads that). A
//            skipped pipeline must not count as passed. A group's protected-branch rule is not in the
//            project's list and wins over it, so a project entry saying "no" proves nothing in a group's
//            project; in a person's own namespace there is no group rule, and the entry is the whole answer.
// "Require signed commits" is never suggested on the Product: CI's ledger commits are unsigned (#432), so it
// would stop every gate. On the Product it is a gap when it is on; on a code repo it is a suggestion.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, warn, fail, info, hand, run, exists, readJSON, isPlainObject, forTerminal, asArg } from './lib.mjs';
import { REQUIRED_CHECKS, REPO_WIRING, PRODUCT_WIRING, PROJECT_FILES, PRODUCT_LINK, productConfigPath, isVerifiedLedger } from './manifest.mjs';
import { readCiSettings, protectionLine } from './protection.mjs';
import { repoActions, productActions } from './plan.mjs';
import { judgeRepo, runnable } from './workspace.mjs';
import { isSolo } from './gate.mjs';

// yad's CI files: the workflows (or GitLab fragments), the gate scripts they run, and the record that tells a
// code repo's CI where the Product is — not the pull request template beside them, nor the agent guard
// (which only a session runs).
const CI_FILES = new Set([...Object.values(REPO_WIRING), ...Object.values(PRODUCT_WIRING)]
  .flat().map((w) => w.dest).filter((d) => /^(\.github\/workflows\/|\.gitlab\/ci\/|checks\/)/.test(d)));
CI_FILES.add(PRODUCT_LINK);
const isCiItem = (item) => CI_FILES.has(item);
// A list of files, short: the first three, then how many more.
const few = (items) => (items.length > 3 ? `${items.slice(0, 3).join(', ')} and ${items.length - 3} more` : items.join(', '));

// Three answers: true, false, or null (not known). A rule list read in full proves a rule is absent; a full
// page proves nothing past it. Classic protection proven absent ('none') holds nothing.
const inRules = (s, pred) => (s.rules === null ? null : s.rules.some(pred) ? true : s.rulesFull ? null : false);
const inClassic = (s, read) => (s.classic === 'none' ? false : s.classic === null ? null : read(s.classic));
const either = (a, b) => (a === true || b === true ? true : a === false && b === false ? false : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);

// The checks this repo should require on GitHub: the Product's (with its verified-commits workflow when the
// file is there), or a code repo's.
function githubJobs(root, t) {
  if (t.kind === 'code') return [...REQUIRED_CHECKS.github.code];
  const verified = exists(path.join(root, '.github/workflows/yad-verified-commits.yml'));
  return [...REQUIRED_CHECKS.github.product, ...(verified ? REQUIRED_CHECKS.github.productVerified : [])];
}

// GitLab runs a fragment only when the project's CI file includes it: `.gitlab-ci.yml` at the top of the git
// repo, or the path the project sets instead (`ci_config_path`). Read as text, as it is on disk here: a line
// that names the fragment's path, with comments taken off. An include made another way (a nested or remote
// include) is not seen, and reads as missing — a gap, never a false ok. A CI file kept in another project
// or at a URL cannot be read here: `unreadable`.
function missingIncludes(dir, fragments, ciPath) {
  const custom = typeof ciPath === 'string' && ciPath.trim() && ciPath.trim() !== '.gitlab-ci.yml' ? ciPath.trim() : null;
  if (custom && (/@|:\/\//.test(custom) || path.isAbsolute(custom) || custom.split(/[\\/]/).includes('..'))) return { unreadable: custom, missing: fragments };
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
  const file = custom || '.gitlab-ci.yml';
  let text;
  try { text = fs.readFileSync(path.join(top.ok ? top.stdout.trim() : dir, file), 'utf8'); } catch { return { noRoot: true, file, missing: fragments }; }
  const lines = text.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
  return { noRoot: false, file, missing: fragments.filter((f) => !lines.includes(f)) };
}

// yad's CI files, from the same plan `yad check` makes. Nothing is written. The files are read on disk here:
// CI reads them from the branch, so they must be committed too.
function filesRow(add, root, t, s) {
  let actions;
  let dir = root;
  if (t.kind === 'product') {
    if (!t.wired) { add('files', 'ok', 'the Product keeps its ledger locally, so yad runs no CI on it'); return; }
    actions = productActions(root);
  } else {
    const judged = judgeRepo(root, t.entry);
    if (!runnable(judged)) {
      // A clone yad can make is offered; an entry yad refuses (no path, outside the workspace…) says why.
      if (judged.state === 'refused') add('files', 'unknown', `its workflow files were not read: ${forTerminal(judged.reason)}`);
      else add('files', 'unknown', 'this repo is not cloned here, so its workflow files were not read', { actor: 'agent', commands: [`yad repo clone ${asArg(t.name)}`] });
      return;
    }
    dir = path.resolve(root, t.entry.path);
    // yad wires a repo's CI by the platform its entry names; one told only from the git URL got none.
    const seen = s.protection.platform;
    if (!t.target.platform && seen) {
      add('files', 'gap', `this repo's entry in .sdlc/repos.json names no platform, so yad wired none of its ${seen === 'gitlab' ? 'GitLab' : 'GitHub'} CI files`, {
        actor: 'agent',
        steps: [`Add "platform": "${seen}" to its entry in the Product's .sdlc/repos.json (through a pull request on the Product), then run \`yad check --fix\`.`],
      });
      return;
    }
    actions = repoActions(root, t.entry);
  }
  const ci = actions.filter((a) => isCiItem(a.item));
  const of = (...states) => ci.filter((a) => states.includes(a.status)).map((a) => forTerminal(a.item));
  const missing = of('missing', 'new');
  const outdated = of('outdated');
  const modified = of('modified');
  const other = ci.filter((a) => !['ok', 'missing', 'new', 'outdated', 'modified'].includes(a.status)).map((a) => forTerminal(a.item));
  const commit = 'Commit and push them through a pull request (or `yad check --fix --open-pr`).';
  if (missing.length) add('files', 'gap', `yad's CI files are missing: ${few(missing)}`, { actor: 'agent', commands: ['yad check --fix'], steps: [commit] });
  if (outdated.length) add('files', 'gap', `yad's CI files are older than this yadflow: ${few(outdated)}`, { actor: 'agent', commands: ['yad update'], steps: [commit] });
  if (modified.length) {
    add('files', 'gap', `yad's CI files were edited by hand: ${few(modified)}`, {
      actor: 'agent',
      steps: ['Ask the person first: `yad update --overwrite-local` puts yad\'s copy back and saves the edit beside it.', 'If yad\'s own file is wrong, report it with `yad report` — do not edit it.'],
    });
  }
  if (other.length) add('files', 'gap', `yad's CI files need attention: ${few(other)}`, { actor: 'agent', commands: ['yad check'] });
  // GitLab: the fragments are on disk; the root pipeline must include them, or no yad job runs.
  let noInclude = false;
  if (t.target.platform === 'gitlab') {
    const fragments = ci.filter((a) => a.item.startsWith('.gitlab/ci/') && !missing.includes(forTerminal(a.item))).map((a) => a.item);
    const inc = fragments.length ? missingIncludes(dir, fragments, s.project?.ci_config_path) : { missing: [] };
    if (inc.unreadable) {
      noInclude = true;
      add('files', 'unknown', `the project's CI file is ${forTerminal(inc.unreadable)}, which yad cannot read here, so whether it includes yad's jobs is not known`, {
        actor: 'agent', steps: ['Check that the pipeline of a merge request runs yad\'s jobs (their names start with yad-).'],
      });
    } else if (inc.missing.length) {
      noInclude = true;
      const file = forTerminal(inc.file);
      add('files', 'gap', inc.noRoot
        ? `there is no ${file}, so GitLab runs none of yad's jobs`
        : `${file} does not include ${few(inc.missing.map(forTerminal))}, so GitLab does not run those jobs (as ${file} is on disk here)`, {
        actor: 'agent',
        steps: [`In ${file}, through a pull request: under its top-level \`include:\` list (add one if there is none), add one line for each file:`,
          ...inc.missing.map((f) => `  - local: '${forTerminal(f)}'`),
          'If it is included another way (a nested or remote include), yad cannot see it: check the pipeline of a merge request runs yad\'s jobs.'],
      });
    }
  }
  if (!missing.length && !outdated.length && !modified.length && !other.length && !noInclude) {
    add('files', 'ok', ci.length ? `yad's ${ci.length} CI files are current on disk here (CI reads them from the branch: commit them)` : 'yad has no CI files for this repo');
  }
}

// Every row a repo would have, for a run that could not read the platform: each is `unknown` with the reason.
function rowIds(t, platform, solo) {
  return [
    'protected',
    ...(t.ciRuns ? ['required-checks'] : []),
    ...(platform === 'gitlab' && t.ciRuns ? ['skipped-pipelines'] : []),
    ...(platform === 'gitlab' && !(t.kind === 'product' && t.ciRuns) ? ['direct-push'] : []),
    'force-push', 'deletion',
    ...(!solo ? ['stale-approvals'] : []),
    ...(platform === 'gitlab' ? ['discussions'] : []),
    ...(t.kind === 'code' || t.ciRuns ? ['signed-commits'] : []),
  ];
}

// The platform's rows for one repo.
function platformRows(add, root, t, s, { solo }) {
  const p = s.protection;
  if (!p.known) {
    // No platform at all: nothing to protect, and nothing to read.
    // No platform at all: nothing holds a merge there — never a quiet ok.
    if (p.kind === 'no-platform' && !t.target.platform) {
      add('platform', 'unknown', 'no platform (GitHub or GitLab) is set, and none can be told from the git URL: nothing on a platform holds a merge here', {
        actor: 'person', steps: [t.kind === 'product' ? 'Set "platform" and "git_url" in the Product\'s .sdlc/product.json (or keep the Product local, with no merge to hold).' : 'Set "platform" for this repo in the Product\'s .sdlc/repos.json.'],
      });
      return;
    }
    // The hint is doctor's, which names itself; here the command to run again is this one.
    const hint = protectionLine(p, { name: t.name, solo }).hint?.replaceAll('`yad doctor`', '`yad ci check`');
    const why = forTerminal(p.why || 'the platform could not be read');
    for (const id of rowIds(t, p.platform, solo)) add(id, 'unknown', why, id === 'protected' && hint ? { actor: 'person', steps: [hint] } : null);
    return;
  }
  const branch = forTerminal(p.branch);
  const web = `https://${p.host}/${forTerminal(p.repo)}`;
  const gh = p.platform === 'github';
  const rulesPage = gh ? `${web}/settings/rules` : `${web}/-/settings/repository`;
  const mrPage = `${web}/-/settings/merge_requests`;
  const settings = (url, steps) => ({ actor: 'person', where: 'settings', url, steps: [...steps, 'Then run `yad ci check` again.'] });
  // A verified Product's gate bot pushes the ledger commit straight to the default branch.
  const bot = t.kind === 'product' && t.ciRuns;
  const protectSteps = gh
    ? [`Open ${rulesPage} → New ruleset → New branch ruleset: target the default branch (${branch}), set Enforcement to Active, and turn on the rules the other rows name ("Require a pull request before merging", "Require status checks to pass", "Block force pushes", "Restrict deletions").`,
      ...(bot ? ['Add the owner of the gate-sync token (a GitHub App, or the person whose token SDLC_GATE_TOKEN is) to the ruleset\'s bypass list, or the ledger never advances — see "The gate bot must be able to push" in docs/branch-protection.md.'] : [])]
    : [`Open ${rulesPage} → Protected branches → protect ${branch}: "Allowed to merge" Developers + Maintainers; "Allowed to push and merge" ${bot ? 'the role the gate token (SDLC_GATE_TOKEN) has, and no wider — the gate bot pushes the ledger there' : 'No one'}; "Allowed to force push" off.`];

  // Protected, and the approvals the mode asks for. A protection GitHub's own answers disagree about is not known.
  if (p.protected === false) add('protected', 'gap', `${branch} is not protected: anyone with write access can push to it`, settings(rulesPage, protectSteps));
  else if (p.protected !== true) add('protected', 'unknown', `whether ${branch} is protected is not known: ${forTerminal(p.protectedWhy || 'the platform\'s answers disagree')}`, settings(rulesPage, protectSteps));
  else if (p.approvals === null) add('protected', 'unknown', `${branch} is protected; the approval rules were not read: ${forTerminal(p.approvalsWhy || 'no answer')}`);
  else if (solo && p.approvals > 0) add('protected', 'gap', `${branch} needs ${p.approvals} approval(s) before a merge: in solo mode that blocks your own merge`, settings(gh ? rulesPage : mrPage, ['Set the required approvals to 0 (solo mode).']));
  else if (!solo && p.approvals === 0) {
    add('protected', 'gap', `${branch} is protected, but no approval is needed before a merge`, settings(gh ? rulesPage : mrPage, gh
      ? ['In the branch ruleset, turn on "Require a pull request before merging" with 1 or more approvals.']
      : ['Merge request approvals → an approval rule with 1 or more approvals (GitLab Premium; on Free an approval never blocks a merge).']));
  } else add('protected', 'ok', solo ? `${branch} is protected (solo mode: no approval needed)` : `${branch} is protected; ${p.atLeast ? 'at least ' : ''}${p.approvals} approval(s) needed before a merge`);

  if (gh) githubRows(add, root, t, s, { branch, web, rulesPage, settings, solo, protectSteps });
  else gitlabRows(add, t, s, { branch, rulesPage, mrPage, settings, solo });
}

function githubRows(add, root, t, s, { branch, web, rulesPage, settings, solo, protectSteps }) {
  const noClassic = 'classic branch protection is readable by a repo admin only';
  const why = [s.rules === null ? 'the branch\'s rules were not read' : s.rulesFull ? 'the branch has 100 or more rules and only the first 100 were read' : null, s.classic === null ? noClassic : null].filter(Boolean).join('; ');

  if (t.ciRuns) {
    const jobs = githubJobs(root, t);
    const required = new Set();
    for (const r of s.rules || []) {
      if (r?.type !== 'required_status_checks') continue;
      for (const x of Array.isArray(r.parameters?.required_status_checks) ? r.parameters.required_status_checks : []) if (typeof x?.context === 'string') required.add(x.context);
    }
    if (isPlainObject(s.classic)) {
      const rs = s.classic.required_status_checks;
      for (const x of Array.isArray(rs?.contexts) ? rs.contexts : []) if (typeof x === 'string') required.add(x);
      for (const x of Array.isArray(rs?.checks) ? rs.checks : []) if (typeof x?.context === 'string') required.add(x.context);
    }
    const missing = jobs.filter((j) => !required.has(j));
    const steps = [`In the branch ruleset, turn on "Require status checks to pass" and add: ${missing.join(', ')}.`, 'GitHub offers a check only after it has run once: open one pull request first.',
      ...(t.kind === 'product' ? protectSteps.slice(1) : [])];
    // Who may bypass: a ruleset's bypass list is not read; classic protection says whether admins are held.
    const adminsFree = isPlainObject(s.classic) && s.classic.enforce_admins?.enabled === false;
    if (!missing.length) add('required-checks', 'ok', `all ${jobs.length} of yad's checks must pass before a merge (who is on a ruleset's bypass list is not read${adminsFree ? '; classic protection lets admins bypass them' : ''})`);
    else if (why) add('required-checks', 'unknown', `not seen as required: ${missing.join(', ')} (${why})`, settings(rulesPage, steps));
    else add('required-checks', 'gap', `not required before a merge: ${missing.join(', ')} — a pull request can merge with these failing`, settings(rulesPage, steps));
  }

  const row = (id, ruleType, classicKey, okText, gapText, unknownText, step) => {
    const blocked = either(inRules(s, (r) => r?.type === ruleType), inClassic(s, (cl) => (typeof cl[classicKey]?.enabled === 'boolean' ? !cl[classicKey].enabled : null)));
    if (blocked === true) add(id, 'ok', `${okText} (who is on a ruleset's bypass list is not read)`);
    else if (blocked === false) add(id, 'gap', gapText, settings(rulesPage, [step]));
    else add(id, 'unknown', `${unknownText} (${why})`, settings(rulesPage, [step]));
  };
  row('force-push', 'non_fast_forward', 'allow_force_pushes', `force pushes to ${branch} are blocked`, `${branch} allows a force push: history on it can be rewritten`, `not known whether ${branch} allows a force push`, 'In the branch ruleset, turn on "Block force pushes".');
  row('deletion', 'deletion', 'allow_deletions', `${branch} cannot be deleted`, `${branch} can be deleted`, `not known whether ${branch} can be deleted`, 'In the branch ruleset, turn on "Restrict deletions".');

  if (!solo) {
    const stale = either(inRules(s, (r) => r?.type === 'pull_request' && r.parameters?.dismiss_stale_reviews_on_push === true),
      inClassic(s, (cl) => (isPlainObject(cl.required_pull_request_reviews) ? cl.required_pull_request_reviews.dismiss_stale_reviews === true : false)));
    const step = 'In the branch ruleset\'s pull request rule, turn on "Dismiss stale pull request approvals when new commits are pushed".';
    if (stale === true) add('stale-approvals', 'ok', 'an approval is dismissed when new commits are pushed');
    else add('stale-approvals', 'suggest', stale === false ? 'an approval stays after new commits are pushed' : `not known whether an approval is dismissed on a new push (${why})`, settings(rulesPage, [step]));
  }

  signedRow(add, t, either(inRules(s, (r) => r?.type === 'required_signatures'), inClassic(s, (cl) => bool(cl.required_signatures?.enabled))), {
    url: rulesPage, settings, why, on: 'In the branch ruleset, turn on "Require signed commits".',
    off: `In the branch ruleset (${rulesPage}) and in classic branch protection (${web}/settings/branches), turn off "Require signed commits".`,
  });
}

function gitlabRows(add, t, s, { branch, rulesPage, mrPage, settings, solo }) {
  const pr = s.project;
  const p = s.protection;
  const unread = 'the project\'s settings were not read';
  if (t.ciRuns) {
    const v = bool(pr?.only_allow_merge_if_pipeline_succeeds);
    const step = 'Merge checks → turn on "Pipelines must succeed".';
    // Which jobs the pipeline runs is the `files` row's (the root .gitlab-ci.yml must include yad's).
    if (v === true) add('required-checks', 'ok', 'a merge needs a passing pipeline (the files row says whether yad\'s jobs are in it)');
    else if (v === false) add('required-checks', 'gap', '"Pipelines must succeed" is off: a merge request can merge with yad\'s checks failing', settings(mrPage, [step]));
    else add('required-checks', 'unknown', `not known whether "Pipelines must succeed" is on (${unread})`, settings(mrPage, [step]));
    const skipped = bool(pr?.allow_merge_on_skipped_pipeline);
    const skipStep = 'Merge checks → turn off "Skipped pipelines are considered successful".';
    if (skipped === false) add('skipped-pipelines', 'ok', 'a skipped pipeline does not count as passed');
    else if (skipped === true) add('skipped-pipelines', 'gap', 'a skipped pipeline counts as passed, so a merge can skip yad\'s checks', settings(mrPage, [skipStep]));
    else add('skipped-pipelines', 'unknown', `not known whether a skipped pipeline counts as passed (${unread})`, settings(mrPage, [skipStep]));
  }

  // The project's protected-branch entries for this branch. In a person's own namespace they are the whole
  // answer; in a group's project a group rule (not in this list) can say otherwise, so "no" proves nothing.
  const ownNamespace = pr?.namespace?.kind === 'user';
  const entries = s.matched;
  // A full page proves nothing past it: a rule on the next page could allow more. Gaps on it still count.
  const listed = entries !== null && !s.matchedFull;
  const groupWhy = ownNamespace ? null : 'a group\'s protected-branch rule, which this project\'s list does not show, can allow it';
  const protectFirst = `Protected branches → protect ${branch}`;

  // Force push: allowed when any matching rule allows it; blocked only when every rule is read and blocks it.
  const fpStep = p.protected === false ? `${protectFirst}, with "Allowed to force push" off.` : `Protected branches → ${branch}: turn off "Allowed to force push".`;
  if (p.protected === false) add('force-push', 'gap', `${branch} is not protected, so a force push is allowed`, settings(rulesPage, [fpStep]));
  else if (!listed) add('force-push', 'unknown', `not known whether a force push is allowed (${entries === null ? 'the protected branches were not read' : 'the project has 100 or more protected branches and only the first 100 were read'})`, settings(rulesPage, [fpStep]));
  else if (entries.length && entries.every((m) => m?.allow_force_push === true)) add('force-push', 'gap', `${branch} allows a force push: history on it can be rewritten`, settings(rulesPage, [fpStep]));
  // Several rules that disagree: which one GitLab applies is not read here.
  else if (entries.some((m) => m?.allow_force_push === true)) add('force-push', 'unknown', `not known whether a force push is allowed: the rules that match ${branch} disagree`, settings(rulesPage, [fpStep]));
  else if (entries.length && entries.every((m) => m?.allow_force_push === false) && ownNamespace) add('force-push', 'ok', `force pushes to ${branch} are blocked`);
  else add('force-push', 'unknown', `not known whether a force push is allowed (${entries.length ? groupWhy : `${branch} is protected by a rule this project's list does not show, such as a group's`})`, settings(rulesPage, [fpStep]));

  // Direct push: a protected branch still lets "Allowed to push and merge" push past every merge check. The
  // most permissive matching rule wins. A verified Product's gate token must push there, so it is not asked.
  if (!(t.kind === 'product' && t.ciRuns)) {
    const pushStep = `${p.protected === false ? `${protectFirst}, with "Allowed to push and merge" No one.` : `Protected branches → ${branch}: set "Allowed to push and merge" to No one.`} (Then \`yad update --push\` cannot push there: use \`yad update --open-pr\`.)`;
    // The most permissive matching rule wins, so one entry on the first page that lets someone push proves it.
    const levels = entries ? entries.flatMap((m) => (Array.isArray(m?.push_access_levels) ? m.push_access_levels : [])) : [];
    const someone = levels.some((l) => (typeof l?.access_level === 'number' && l.access_level > 0) || l?.user_id || l?.group_id || l?.deploy_key_id);
    const noOne = listed && entries.length && entries.every((m) => Array.isArray(m?.push_access_levels) && m.push_access_levels.length && m.push_access_levels.every((l) => l?.access_level === 0 && !l.user_id && !l.group_id && !l.deploy_key_id));
    const status = solo ? 'suggest' : 'gap';
    if (p.protected === false) add('direct-push', status, `${branch} is not protected: anyone with write access can push to it, past every merge check`, settings(rulesPage, [pushStep]));
    else if (someone) add('direct-push', status, `"Allowed to push and merge" on ${branch} lets someone push straight to it, past every merge check`, settings(rulesPage, [pushStep]));
    else if (noOne && ownNamespace) add('direct-push', 'ok', `no one can push straight to ${branch}: every change comes through a merge request`);
    else add('direct-push', 'unknown', `not known who can push straight to ${branch} (${entries === null ? 'the protected branches were not read' : !listed ? 'the project has 100 or more protected branches and only the first 100 were read' : entries.length ? groupWhy : 'it is protected by a rule this project\'s list does not show, such as a group\'s'})`, settings(rulesPage, [pushStep]));
  }

  // GitLab never deletes a project's default branch; a protected branch is deleted only by a Maintainer, by hand.
  if (p.platformDefault && p.branch === p.platformDefault) add('deletion', 'ok', `${branch} is the project's default branch, which GitLab does not let anyone delete`);
  else if (p.protected === true) add('deletion', 'ok', `${branch} is protected: only a Maintainer can delete it, by hand in GitLab`);
  else add('deletion', 'gap', `${branch} is not protected, so it can be deleted`, settings(rulesPage, [`${protectFirst}.`]));

  if (!solo) {
    const reset = bool(s.approvals?.reset_approvals_on_push);
    const step = 'Merge request approvals → turn on "Remove all approvals when commits are added to the source branch".';
    if (reset === true) add('stale-approvals', 'ok', 'approvals are removed when new commits are added');
    else add('stale-approvals', 'suggest', reset === false ? 'approvals stay when new commits are added' : 'not known whether approvals are removed on a new push (the approval settings need GitLab Premium, or could not be read)', settings(mrPage, [step]));
  }
  const disc = bool(pr?.only_allow_merge_if_all_discussions_are_resolved);
  const discStep = 'Merge checks → turn on "All threads must be resolved".';
  if (disc === true) add('discussions', 'ok', 'every thread must be resolved before a merge');
  else add('discussions', 'suggest', disc === false ? 'a merge request can merge with open threads' : `not known whether threads must be resolved (${unread})`, settings(mrPage, [discStep]));

  const signed = s.pushRule === 'none' ? false : s.pushRule === null ? null : bool(s.pushRule.reject_unsigned_commits) ?? false;
  signedRow(add, t, signed, {
    url: rulesPage, settings, why: 'the push rules need GitLab Premium, or could not be read',
    on: 'Push rules → turn on "Reject unsigned commits".', off: 'Push rules → turn off "Reject unsigned commits".',
  });
}

// "Require signed commits": a gap when it is on for the Product (CI's ledger commits are unsigned), a
// suggestion for a code repo. A Product that runs no yad CI writes no bot commits, so it is not asked.
function signedRow(add, t, on, { url, settings, why, on: turnOn, off: turnOff }) {
  if (t.kind === 'product') {
    if (!t.ciRuns) return;
    if (on === true) add('signed-commits', 'gap', '"Require signed commits" is on: yad\'s CI writes the ledger in unsigned commits, so every gate would stop', settings(url, [turnOff]));
    else if (on === false) add('signed-commits', 'ok', '"Require signed commits" is off, as the Product needs (yad\'s CI writes the ledger in unsigned commits)');
    else add('signed-commits', 'unknown', `not known whether "Require signed commits" is on (${why}): it must be off on the Product`, settings(url, [turnOff]));
    return;
  }
  if (on === true) add('signed-commits', 'ok', 'commits must be signed');
  else add('signed-commits', 'suggest', on === false ? 'unsigned commits are accepted' : `not known whether commits must be signed (${why})`, settings(url, [turnOn]));
}

// The repos to check: one by name, or the Product and every registered repo.
export function ciTargets(root, { repo = null } = {}) {
  const productConfig = readJSON(productConfigPath(root), null);
  const config = isPlainObject(productConfig) ? productConfig : {};
  const registry = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
  const entries = (Array.isArray(registry?.repos) ? registry.repos : []).filter((r) => isPlainObject(r) && typeof r.name === 'string' && r.name);
  const origin = (cwd) => run('git', ['remote', 'get-url', 'origin'], { cwd }).stdout || null;
  const branchOf = (x) => (typeof x.default_branch === 'string' && x.default_branch ? x.default_branch : null);
  const code = (entry) => {
    const onDisk = typeof entry.path === 'string' && entry.path && runnable(judgeRepo(root, entry));
    return {
      name: entry.name, kind: 'code', entry, ciRuns: true,
      target: { platform: entry.platform || null, gitUrl: (typeof entry.git_url === 'string' && entry.git_url) || (onDisk ? origin(path.resolve(root, entry.path)) : null), branch: branchOf(entry) },
    };
  };
  if (repo !== null) {
    const hit = entries.find((e) => e.name === repo);
    return hit ? { targets: [code(hit)] } : { unknownRepo: repo, names: entries.map((e) => e.name) };
  }
  const wired = isVerifiedLedger(config);
  const product = {
    name: 'Product', kind: 'product', wired, ciRuns: wired,
    target: { platform: config.platform || null, gitUrl: config.git_url || origin(root), branch: branchOf(config) },
  };
  return { targets: [product, ...entries.map(code)] };
}

export function ciCheck(root, { repo = null, runner, env } = {}) {
  const picked = ciTargets(root, { repo });
  if (picked.unknownRepo !== undefined) return picked;
  const productConfig = readJSON(productConfigPath(root), null);
  const solo = isSolo(isPlainObject(productConfig) ? productConfig : null);
  const opts = { ...(runner ? { runner } : {}), ...(env ? { env } : {}), authCache: new Map() };
  const repos = picked.targets.map((t) => {
    const findings = [];
    const add = (id, status, message, fix = null) => findings.push({ id, status, message, ...(fix ? { fix } : {}) });
    const settings = readCiSettings(t.target, opts);
    filesRow(add, root, t, settings);
    platformRows(add, root, t, settings, { solo });
    return { name: t.name, kind: t.kind, findings };
  });
  const all = repos.flatMap((r) => r.findings);
  const count = (st) => all.filter((f) => f.status === st).length;
  return { repos, summary: { gaps: count('gap'), suggestions: count('suggest'), unknown: count('unknown'), complete: count('unknown') === 0 } };
}

export function runCiCheck(root, { repo = null, json = false, runner, env } = {}) {
  const r = ciCheck(root, { repo, runner, env });
  if (r.unknownRepo !== undefined) return r;
  if (!json) {
    log(c.bold('\nyad ci check'));
    const mark = { ok, gap: fail, suggest: warn, unknown: info };
    for (const repoResult of r.repos) {
      log(c.bold(`\n${forTerminal(repoResult.name)}`));
      for (const f of repoResult.findings) {
        mark[f.status](`${f.id}: ${f.status === 'unknown' ? 'not known — ' : ''}${f.message}`);
        if (f.fix?.url) log(c.dim(`    ${f.fix.url}`));
        for (const cmd of f.fix?.commands || []) hand(cmd);
        for (const s of f.fix?.steps || []) log(c.dim(`    ${s}`));
      }
    }
    const { gaps, unknown } = r.summary;
    log('');
    if (gaps) log(c.bold(`${gaps} thing(s) to fix. A platform setting is the person's to change; yad's own files take the command shown. Then run \`yad ci check\` again.`));
    else if (unknown) log(c.bold(`${unknown} item(s) not read — not cleared.`));
    else ok('yad\'s checks will hold a merge on every repo checked');
  }
  if (r.summary.gaps) process.exitCode = 1;
  return r;
}
