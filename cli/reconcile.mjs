// `yad check` (report) and `yad check --fix` (reconcile) — and `yad update`
// as a thin alias (--scope=changed). Inspects actual project state against the
// manifest: missing setup, drifted files, stale code-context.
import fs from 'node:fs';
import path from 'node:path';
import {
  c, log, ok, info, warn, hand, readJSON, writeJSON, exists, run,
} from './lib.mjs';

const readFileSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

// The yad-update-guard will reject the very commits `--push` is about to create unless they are
// signed AND their author email is allowlisted. Warn up front (never block) so the operator isn't
// surprised by a reddened default branch across every repo. Best-effort, hub-identity based.
function preflightGuardReadiness(root) {
  const gitcfg = (k) => run('git', ['config', '--get', k], { cwd: root }).stdout;
  // Only commit.gpgsign actually enables signing — user.signingkey merely picks WHICH key once
  // signing is on, so it must not count (it would hide the warning while commits stay unsigned).
  const signing = run('git', ['config', '--bool', '--get', 'commit.gpgsign'], { cwd: root }).stdout === 'true';
  if (!signing) warn('commit signing is not enabled (git config commit.gpgsign true) — the yad-update-guard requires a platform-Verified signature; unsigned pushes will fail the gate.');
  const email = gitcfg('user.email').toLowerCase();
  const allow = readFileSafe(path.join(root, '.sdlc', 'verified-authors'));
  const known = allow.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'));
  if (known.length && email && !known.includes(email)) {
    warn(`your git email <${email}> is not in .sdlc/verified-authors — the yad-update-guard will reject these commits (add it to the hub roster and re-run \`yad check --fix\`).`);
  }
}
import { VERSION, PROJECT_FILES } from './manifest.mjs';
import {
  moduleActions, repoActions, hubActions, authorsActions,
  legacyModuleActions, removedModuleActions, legacyRepoActions, legacyHubActions,
} from './plan.mjs';
import { gitHead, packRepo } from './setup.mjs';
import { groupByRoot, commitUpdates } from './update-commit.mjs';

const MARK = { missing: c.red('missing'), new: c.cyan('new'), outdated: c.yellow('outdated'), stale: c.yellow('stale'), legacy: c.yellow('legacy'), removed: c.yellow('removed'), ok: c.green('ok') };

export async function reconcile(root, { fix = false, scope = 'all', force = false, push = false, allowBranch = false } = {}) {
  log(c.bold(`\nSDLC reconcile  ${c.dim('v' + VERSION)}`));
  log(c.dim(`target: ${root}\n`));

  // --- missing one-time setup (needs the interactive wizard) ---
  const gaps = [];
  if (!exists(path.join(root, PROJECT_FILES.version))) gaps.push('module not installed (.sdlc/cli-version.json absent)');
  if (!exists(path.join(root, PROJECT_FILES.hubConfig))) gaps.push('hub not configured (.sdlc/hub.json absent)');
  const registry = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
  if (!exists(path.join(root, PROJECT_FILES.reposRegistry))) gaps.push('no repos registered (.sdlc/repos.json absent)');

  // --- deterministic file actions (module + hub CI + author allowlists + every registered repo),
  //     plus pre-2.0 sdlc-* -> yad-* migrations ('legacy': old name installed; rename in place)
  //     and purge of skills removed in a later release ('removed': delete the lingering install) ---
  const actions = [
    ...moduleActions(root), ...legacyModuleActions(root), ...removedModuleActions(root),
    ...hubActions(root), ...legacyHubActions(root),
    ...authorsActions(root, registry.repos),
  ];
  for (const repo of registry.repos) actions.push(...repoActions(root, repo), ...legacyRepoActions(root, repo));

  // --- stale code-context (HEAD moved since last pack) ---
  const staleRepos = [];
  for (const repo of registry.repos) {
    const head = gitHead(path.resolve(root, repo.path));
    if (head && repo.syncedHead && head !== repo.syncedHead) {
      staleRepos.push(repo);
      // packRepo writes the repomix cache under the HUB root (root/repo.contextPack, e.g.
      // .sdlc/code-context/<name>/pack.md), so the touched path belongs to the hub — and is commonly
      // gitignored, in which case the push stage's check-ignore drops it. codeMap is AI-generated
      // later, not here, so only the pack is claimed.
      actions.push({
        scope: repo.name,
        item: 'code-context',
        status: 'stale',
        root,
        paths: repo.contextPack ? [repo.contextPack] : [],
        apply: () => packRepo(root, repo),
      });
    }
  }

  // --- report, grouped by scope ---
  const byScope = new Map();
  for (const a of actions) {
    if (!byScope.has(a.scope)) byScope.set(a.scope, []);
    byScope.get(a.scope).push(a);
  }
  const counts = { missing: 0, new: 0, outdated: 0, stale: 0, legacy: 0, removed: 0, ok: 0 };
  for (const [scopeName, items] of byScope) {
    const notOk = items.filter((i) => i.status !== 'ok');
    items.forEach((i) => counts[i.status]++);
    if (notOk.length === 0) { ok(`${scopeName} ${c.dim('— up to date')}`); continue; }
    log(`  ${c.bold(scopeName)}`);
    for (const i of notOk) log(`    ${MARK[i.status]}  ${i.item}`);
  }
  for (const g of gaps) warn(g);

  const fixable = actions.filter((a) =>
    a.status !== 'ok' && (scope === 'all' ? true : a.status !== 'missing'),
  );
  log('');
  log(c.dim(`summary: ${counts.missing} missing, ${counts.new} new, ${counts.outdated} outdated, ${counts.stale} stale, ${counts.legacy} legacy, ${counts.removed} removed, ${counts.ok} ok`));

  if (!fix) {
    if (push) warn('--push has no effect without --fix (there is nothing applied to commit).');
    if (fixable.length || gaps.length) hand('run `yad check --fix` to reconcile (or `yad setup` for missing one-time setup).');
    return { counts, gaps, applied: 0 };
  }

  // --- apply --- (collect the applied actions so --push can stage each repo's exact allowlist) ---
  log('');
  let applied = 0;
  const appliedActions = [];
  for (const a of fixable) {
    a.apply();
    applied++;
    appliedActions.push(a);
    info(`${a.status} → fixed: ${a.scope}/${a.item}`);
  }
  if (force) {
    for (const a of actions.filter((a) => a.status === 'ok')) { a.apply(); appliedActions.push(a); }
  }
  // refresh the version stamp (preserve recorded ideTargets) and let it ride the hub's update commit
  const rec = readJSON(path.join(root, PROJECT_FILES.version), {});
  writeJSON(path.join(root, PROJECT_FILES.version), { ...rec, version: VERSION });
  appliedActions.push({ scope: 'hub', item: PROJECT_FILES.version, status: 'stamp', root, paths: [PROJECT_FILES.version] });
  applied ? ok(`reconciled ${applied} item(s)`) : info('nothing to fix');
  if (gaps.length) hand('one-time setup still missing — run `yad setup`.');

  // --- publish: commit each repo's applied changes and push directly to its default branch ---
  if (push) {
    preflightGuardReadiness(root);
    const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig), {});
    const defByRoot = new Map([[root, hub?.default_branch]]);
    const platformByRoot = new Map([[root, hub?.platform]]);
    for (const repo of registry.repos) {
      const repoRoot = path.resolve(root, repo.path);
      defByRoot.set(repoRoot, repo.default_branch);
      platformByRoot.set(repoRoot, repo.platform);
    }
    commitUpdates(root, groupByRoot(appliedActions), {
      push: true, allowBranch,
      defaultBranchFor: (r) => defByRoot.get(r),
      // GitLab's yad-update-guard is an includable fragment: unlike a GitHub workflow it does nothing
      // until the root .gitlab-ci.yml `include:`s it (added by the yad-checks skill wire step, not by
      // reconcile). Flag a gitlab repo whose root pipeline lacks the include so the direct-to-default
      // push isn't left silently unguarded.
      guardInactiveGitlab: (r) => {
        if (platformByRoot.get(r) !== 'gitlab') return false;
        const ci = path.join(r, '.gitlab-ci.yml');
        return !exists(ci) || !readFileSafe(ci).includes('yad-update-guard.yml');
      },
    });
  }
  return { counts, gaps, applied };
}
