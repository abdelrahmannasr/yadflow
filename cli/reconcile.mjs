// `yad check` (report) and `yad check --fix` (reconcile) — and `yad update`
// as a thin alias (--scope=changed). Inspects actual project state against the
// manifest: missing setup, drifted files, stale code-context.
import fs from 'node:fs';
import path from 'node:path';
import {
  c, log, ok, info, warn, hand, readJSON, writeJSON, exists,
} from './lib.mjs';

const readFileSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

import { preflightGuardReadiness } from './hubcommit.mjs';
import { VERSION, PROJECT_FILES } from './manifest.mjs';
import {
  moduleActions, repoActions, hubActions, authorsActions,
  legacyModuleActions, removedModuleActions, legacyRepoActions, legacyHubActions,
  ideTargetStateFor,
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

  // Resolve untrusted persisted IDE targets once, before any filesystem action is constructed.
  // The returned list contains canonical allowlisted roots only.
  const ideState = ideTargetStateFor(root);
  const ideTargets = ideState.targets;
  const stampPath = path.join(root, PROJECT_FILES.version);
  const writeCanonicalStamp = () => {
    const current = readJSON(stampPath, {});
    const record = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    writeJSON(stampPath, { ...record, version: VERSION, ideTargets });
  };

  // --- deterministic file actions (module + hub CI + author allowlists + every registered repo),
  //     plus pre-2.0 sdlc-* -> yad-* migrations ('legacy': old name installed; rename in place)
  //     and purge of skills removed in a later release ('removed': delete the lingering install) ---
  const actions = [
    ...moduleActions(root, ideTargets), ...legacyModuleActions(root, ideTargets), ...removedModuleActions(root, ideTargets),
    ...hubActions(root), ...legacyHubActions(root),
    ...authorsActions(root, registry.repos),
  ];
  if (ideState.needsRepair) {
    actions.push({
      scope: 'hub',
      item: `${PROJECT_FILES.version} ideTargets`,
      status: 'outdated',
      root,
      paths: [PROJECT_FILES.version],
      // The canonical stamp is written once, after every filesystem action succeeds below.
      apply: () => undefined,
    });
  }
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
  const shownInvalid = ideState.invalid.map((v) => {
    try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
  });
  if (ideState.hasStamp && !ideState.recordIsObject) {
    warn(`${PROJECT_FILES.version}: version stamp is unreadable or not a JSON object; using safe targets: ${ideTargets.join(', ')}`);
  } else if (ideState.hasStamp && !ideState.hasField) {
    warn(`${PROJECT_FILES.version}: ideTargets is missing; using safe targets: ${ideTargets.join(', ')}`);
  } else if (ideState.hasStamp && !ideState.shapeValid) {
    warn(`${PROJECT_FILES.version}: ideTargets is not an array; ignored persisted value: ${shownInvalid.join(', ')}; using safe targets: ${ideTargets.join(', ')}`);
  } else if (ideState.hasStamp && ideState.usedFallback && !ideState.invalid.length) {
    warn(`${PROJECT_FILES.version}: ideTargets is empty; using safe targets: ${ideTargets.join(', ')}`);
  }
  if (ideState.invalid.length && ideState.shapeValid) {
    warn(`${PROJECT_FILES.version}: ignored unsupported persisted IDE target(s): ${shownInvalid.join(', ')}`);
  }
  if (ideState.repaired.length) {
    warn(`${PROJECT_FILES.version}: persisted .cluade target will be repaired to .claude`);
  }
  for (const unsafe of ideState.unsafeDetected) {
    warn(`${PROJECT_FILES.version}: ignored unsafe detected IDE path '${unsafe.target}'; ${unsafe.message}; using safe targets: ${ideTargets.join(', ')}`);
  }
  if (exists(path.join(root, '.cluade'))) {
    warn('existing .cluade path was left untouched; review its contents and remove it manually');
  }

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
  // Refresh the version stamp and persist only the canonical targets used to build actions. This also
  // completes legacy/corrupt target migration even when no skill content itself needed an update.
  writeCanonicalStamp();
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
