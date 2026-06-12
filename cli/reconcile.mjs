// `yad check` (report) and `yad check --fix` (reconcile) — and `yad update`
// as a thin alias (--scope=changed). Inspects actual project state against the
// manifest: missing setup, drifted files, stale code-context.
import path from 'node:path';
import {
  c, log, ok, info, warn, hand, fail, readJSON, writeJSON, exists,
} from './lib.mjs';
import { VERSION, PROJECT_FILES } from './manifest.mjs';
import {
  moduleActions, repoActions, hubActions, authorsActions,
  legacyModuleActions, legacyRepoActions, legacyHubActions,
} from './plan.mjs';
import { gitHead, packRepo } from './setup.mjs';

const MARK = { missing: c.red('missing'), outdated: c.yellow('outdated'), stale: c.yellow('stale'), legacy: c.yellow('legacy'), ok: c.green('ok') };

export async function reconcile(root, { fix = false, scope = 'all', force = false } = {}) {
  log(c.bold(`\nSDLC reconcile  ${c.dim('v' + VERSION)}`));
  log(c.dim(`target: ${root}\n`));

  // --- missing one-time setup (needs the interactive wizard) ---
  const gaps = [];
  if (!exists(path.join(root, PROJECT_FILES.version))) gaps.push('module not installed (.sdlc/cli-version.json absent)');
  if (!exists(path.join(root, PROJECT_FILES.hubConfig))) gaps.push('hub not configured (.sdlc/hub.json absent)');
  const registry = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
  if (!exists(path.join(root, PROJECT_FILES.reposRegistry))) gaps.push('no repos registered (.sdlc/repos.json absent)');

  // --- deterministic file actions (module + hub CI + author allowlists + every registered repo),
  //     plus pre-2.0 sdlc-* -> yad-* migrations ('legacy': old name installed; rename in place) ---
  const actions = [
    ...moduleActions(root), ...legacyModuleActions(root),
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
      actions.push({ scope: repo.name, item: 'code-context', status: 'stale', apply: () => packRepo(root, repo) });
    }
  }

  // --- report, grouped by scope ---
  const byScope = new Map();
  for (const a of actions) {
    if (!byScope.has(a.scope)) byScope.set(a.scope, []);
    byScope.get(a.scope).push(a);
  }
  const counts = { missing: 0, outdated: 0, stale: 0, legacy: 0, ok: 0 };
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
  log(c.dim(`summary: ${counts.missing} missing, ${counts.outdated} outdated, ${counts.stale} stale, ${counts.legacy} legacy, ${counts.ok} ok`));

  if (!fix) {
    if (fixable.length || gaps.length) hand('run `yad check --fix` to reconcile (or `yad setup` for missing one-time setup).');
    return { counts, gaps, applied: 0 };
  }

  // --- apply ---
  log('');
  let applied = 0;
  for (const a of fixable) {
    a.apply();
    applied++;
    info(`${a.status} → fixed: ${a.scope}/${a.item}`);
  }
  if (force) {
    for (const a of actions.filter((a) => a.status === 'ok')) a.apply();
  }
  // refresh the version stamp (preserve recorded ideTargets)
  const rec = readJSON(path.join(root, PROJECT_FILES.version), {});
  writeJSON(path.join(root, PROJECT_FILES.version), { ...rec, version: VERSION });
  applied ? ok(`reconciled ${applied} item(s)`) : info('nothing to fix');
  if (gaps.length) hand('one-time setup still missing — run `yad setup`.');
  return { counts, gaps, applied };
}
