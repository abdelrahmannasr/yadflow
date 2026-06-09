// `sdlc repo list|refresh` — connected-repo staleness as an explicit HUMAN decision.
// Skill steps no longer silently repack a stale repo; they flag it and point here. (`sdlc check --fix`
// still refreshes too — it is also human-invoked.)
import path from 'node:path';
import { c, log, ok, info, warn, hand, fail, readJSON, writeJSON } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { gitHead, packRepo } from './setup.mjs';

function load(root) {
  const regPath = path.join(root, PROJECT_FILES.reposRegistry);
  return { regPath, registry: readJSON(regPath, { repos: [] }) };
}

// HEAD != syncedHead => stale (config.yaml code_context.staleness: head-sha).
function staleness(root, repo) {
  const head = gitHead(path.resolve(root, repo.path));
  const stale = head && repo.syncedHead && head !== repo.syncedHead;
  return { head, stale: !!stale, unknown: !head };
}

export async function runRepo(root, { action = 'list', name, today } = {}) {
  const { regPath, registry } = load(root);
  if (!registry.repos.length) { warn('no repos registered (.sdlc/repos.json) — run `sdlc setup`'); return { repos: 0 }; }

  if (action === 'list') {
    log(c.bold('\nconnected repos'));
    let staleCount = 0;
    for (const repo of registry.repos) {
      const { stale, unknown } = staleness(root, repo);
      if (unknown) { warn(`${repo.name} ${c.dim(`(${repo.path})`)} — HEAD unreadable`); continue; }
      if (stale) { staleCount++; warn(`${repo.name} ${c.dim(`(${repo.path})`)} — ${c.yellow('stale')} (HEAD moved since last pack)`); }
      else ok(`${repo.name} ${c.dim('— fresh')}`);
    }
    if (staleCount) hand(`refresh with \`sdlc repo refresh${registry.repos.length > 1 ? ' <name>' : ''}\` (or \`sdlc repo refresh\` for all)`);
    return { repos: registry.repos.length, stale: staleCount };
  }

  if (action === 'refresh') {
    const targets = name ? registry.repos.filter((r) => r.name === name) : registry.repos;
    if (name && !targets.length) { fail(`unknown repo: ${name}`); process.exitCode = 1; return { refreshed: 0 }; }
    let refreshed = 0;
    for (const repo of targets) {
      const { head, unknown } = staleness(root, repo);
      if (unknown) { warn(`${repo.name}: HEAD unreadable — skipped`); continue; }
      log(`  ${c.bold(repo.name)}`);
      if (packRepo(root, repo)) {
        repo.syncedHead = head;
        if (today) repo.lastSyncedAt = today;   // always stamp when a date is supplied (the CLI passes today)
        refreshed++;
      }
    }
    writeJSON(regPath, registry);
    refreshed ? ok(`refreshed ${refreshed} repo(s)`) : info('nothing refreshed');
    hand('regenerate the code-map in Claude Code (sdlc-connect-repos) — the pack is cached, the map is the AI step');
    return { refreshed };
  }

  fail(`unknown repo action: ${action} (list | refresh)`);
  process.exitCode = 1;
  return {};
}
