// `sdlc setup` — the guided, idempotent first-run wizard.
import path from 'node:path';
import fs from 'node:fs';
import {
  c, log, step, ok, info, warn, hand, fail, ask, askYesNo, run, has,
  exists, asset, copyFile, readJSON, writeJSON,
} from './lib.mjs';
import { VERSION, IDE_FOLDER_TARGETS, IDE_OPENCODE_DIR, PROJECT_FILES } from './manifest.mjs';
import { moduleActions, repoActions, hubActions } from './plan.mjs';

const ALL_IDES = [...IDE_FOLDER_TARGETS, '.opencode'];

export function detectPlatform(remoteUrl = '') {
  if (/gitlab/i.test(remoteUrl)) return 'gitlab';
  if (/github/i.test(remoteUrl)) return 'github';
  return null;
}
export const gitHead = (cwd) => run('git', ['rev-parse', 'HEAD'], { cwd }).stdout || null;

function applyActions(actions, { force = false } = {}) {
  let changed = 0;
  for (const a of actions) {
    if (a.status === 'ok' && !force) continue;
    a.apply();
    changed++;
    info(`${a.status === 'missing' ? 'installed' : 'updated'} ${a.scope}/${a.item}`);
  }
  if (!changed) info('already up to date');
  return changed;
}

export async function runSetup(root, opts = {}) {
  const total = 7;
  log(c.bold(`\nSDLC Workflow setup  ${c.dim('v' + VERSION)}`));
  log(c.dim(`target: ${root}`));

  // 1. Preflight
  step(1, total, 'Preflight');
  if (!exists(path.join(root, '.git'))) {
    if (await askYesNo('Not a git repo. Run `git init` here?', true)) {
      run('git', ['init'], { cwd: root });
      ok('git initialized');
    } else warn('continuing without git — hub detection will be skipped');
  } else ok('git repo detected');
  for (const tool of ['git', 'node']) has(tool) ? ok(`${tool} present`) : warn(`${tool} not found on PATH`);
  if (!has('npx')) warn('npx not found — repomix packing will be skipped');

  // 2. Install the module
  step(2, total, 'Install the module (skills + _bmad registration)');
  let ideTargets = opts.ideTargets;
  if (!ideTargets) {
    const present = ALL_IDES.filter((d) => exists(path.join(root, d)));
    const def = (present.length ? present : ['.claude']).join(',');
    const answer = await ask(`IDE targets to install ${c.dim('(comma-separated: ' + ALL_IDES.join(', ') + ')')}`, def);
    ideTargets = answer.split(',').map((s) => s.trim()).filter(Boolean);
  }
  applyActions(moduleActions(root, ideTargets), { force: true });
  ok(`module installed into: ${ideTargets.join(', ')}`);

  // 3. Detect hub platform + roster
  step(3, total, 'Hub platform & reviewer roster');
  const hubPath = path.join(root, PROJECT_FILES.hubConfig);
  if (exists(hubPath) && !(await askYesNo('hub.json exists — reconfigure?', false))) {
    info('keeping existing .sdlc/hub.json');
  } else {
    const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: root }).stdout;
    let platform = detectPlatform(remote);
    platform = (await ask('Hub platform (github/gitlab/none)', platform || 'none')).toLowerCase();
    const roster = [];
    if (await askYesNo('Add reviewers to the roster now?', true)) {
      for (;;) {
        const login = await ask('  reviewer platform login (blank to finish)', '');
        if (!login) break;
        const name = await ask('    sdlc name', login);
        const role = await ask('    role (owner/reviewer/domain-owner)', 'reviewer');
        roster.push({ login, name, role });
      }
    }
    const default_branch = platform === 'none' ? 'main' : await ask('Hub default branch', 'main');
    // `bridge_enabled` is the canonical flag (hub-config schema); keep the legacy `bridge` spelling
    // for anything that still reads it.
    const enabled = platform !== 'none';
    writeJSON(hubPath, { platform: enabled ? platform : null, bridge_enabled: enabled, bridge: enabled, default_branch, roster });
    ok(`wrote ${PROJECT_FILES.hubConfig} (${roster.length} reviewer(s))`);
  }

  // 4. Connect code repos
  step(4, total, 'Connect code repos');
  const regPath = path.join(root, PROJECT_FILES.reposRegistry);
  const registry = readJSON(regPath, { repos: [] });
  const known = new Set(registry.repos.map((r) => r.name));
  if (await askYesNo(`Connect a code repo? ${c.dim(`(${registry.repos.length} already registered)`)}`, registry.repos.length === 0)) {
    for (;;) {
      const name = await ask('  repo name (blank to finish)', '');
      if (!name) break;
      if (known.has(name)) { warn(`${name} already registered — skipping`); continue; }
      const rpath = await ask('    path (relative to project root)', `demo-repos/${name}`);
      const repoRoot = path.resolve(root, rpath);
      const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot }).stdout;
      const platform = (await ask('    platform (github/gitlab)', detectPlatform(remote) || 'github')).toLowerCase();
      const domain_owner = await ask('    domain owner', '');
      const default_branch = await ask('    default branch', 'main');
      const repo = {
        name, path: rpath, git_url: remote || null, platform, domain_owner, default_branch,
        connectedAt: opts.today ?? null, lastSyncedAt: opts.today ?? null,
        syncedHead: gitHead(repoRoot),
        contextPack: `.sdlc/code-context/${name}/pack.md`,
        codeMap: `.sdlc/code-context/${name}/code-map.md`,
        source: 'repomix',
      };
      registry.repos.push(repo);
      known.add(name);
      writeJSON(regPath, registry);
      ok(`registered ${name}`);
      packRepo(root, repo);
    }
  }

  // 5. Wire each connected repo + the hub itself
  step(5, total, 'Wire connected repos + the hub (CI gates, PR template, comment scaffold, gate-sync)');
  if (registry.repos.length === 0) info('no repos to wire');
  for (const repo of registry.repos) {
    log(`  ${c.bold(repo.name)} ${c.dim(`(${repo.platform})`)}`);
    applyActions(repoActions(root, repo), { force: true });
  }
  // the hub: event-driven gate-sync CI, so platform approvals/merges drive `sdlc gate ci`
  const hubWiring = hubActions(root);
  if (hubWiring.length) {
    log(`  ${c.bold('hub')} ${c.dim('(gate-sync CI)')}`);
    applyActions(hubWiring, { force: true });
  }

  // 6. Optional CodeRabbit
  step(6, total, 'AI review (CodeRabbit)');
  for (const repo of registry.repos) {
    const cr = path.join(path.resolve(root, repo.path), '.coderabbit.yaml');
    if (exists(cr)) { info(`${repo.name}: .coderabbit.yaml present`); continue; }
    if (await askYesNo(`Wire CodeRabbit (advisory) in ${repo.name}?`, false)) {
      fs.writeFileSync(cr, 'reviews:\n  high_level_summary: true\n  poem: false\n');
      ok(`${repo.name}: wrote .coderabbit.yaml`);
    }
  }

  // 7. Summary + version stamp
  step(7, total, 'Done');
  writeJSON(path.join(root, PROJECT_FILES.version), { version: VERSION, ideTargets, updatedAt: opts.today ?? null });
  ok(`stamped ${PROJECT_FILES.version} (v${VERSION})`);
  log('');
  log(c.bold('Next — AI-only steps (run in Claude Code):'));
  hand('generate code-maps: run `sdlc-connect-repos` for each connected repo');
  hand('author your first epic: run `sdlc-author-epic`');
  log('');
  log(c.dim('Re-run anytime: `sdlc check` (report) / `sdlc check --fix` (reconcile).'));
}

// Deterministic repomix pack (code-map generation itself is an AI step, handed off).
export function packRepo(root, repo) {
  const repoRoot = path.resolve(root, repo.path);
  const out = path.join(root, repo.contextPack);
  if (!has('npx')) { warn(`${repo.name}: npx missing — skipped repomix pack`); return false; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  info(`${repo.name}: packing with repomix …`);
  const r = run('npx', ['repomix@latest', '--compress', '--include-logs', '--style', 'markdown', '-o', out], { cwd: repoRoot });
  if (r.ok) { ok(`${repo.name}: cached ${repo.contextPack}`); hand(`${repo.name}: generate the code-map in Claude Code (sdlc-connect-repos)`); return true; }
  fail(`${repo.name}: repomix failed — ${r.stderr.split('\n')[0] || 'unknown error'}`);
  return false;
}
