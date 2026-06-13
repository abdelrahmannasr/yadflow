// `yad setup` — the guided, idempotent first-run wizard.
import path from 'node:path';
import fs from 'node:fs';
import {
  c, log, step, ok, info, warn, hand, fail, ask, askYesNo, run, has,
  exists, readJSON, writeJSON,
} from './lib.mjs';
import { VERSION, IDE_FOLDER_TARGETS, PROJECT_FILES, DESIGN_TOOLS, DESIGN_PRIMARY } from './manifest.mjs';
import { moduleActions, repoActions, hubActions, authorsActions } from './plan.mjs';

const ALL_IDES = [...IDE_FOLDER_TARGETS, '.opencode'];

export function detectPlatform(remoteUrl = '') {
  if (/gitlab/i.test(remoteUrl)) return 'gitlab';
  if (/github/i.test(remoteUrl)) return 'github';
  return null;
}
export const gitHead = (cwd) => run('git', ['rev-parse', 'HEAD'], { cwd }).stdout || null;

// Containment: every repo path must live inside the project root — the registry path is later
// joined and executed against (repomix cwd, CI wiring), and even the read-only remote probe must
// not run against an arbitrary outside path. The path.sep-suffixed compare avoids the
// /proj vs /proj-evil prefix trap.
export function insideRoot(root, rpath) {
  const projectRoot = path.resolve(root);
  const resolved = path.resolve(projectRoot, rpath);
  return resolved === projectRoot || resolved.startsWith(projectRoot + path.sep);
}

// Validate + record one code repo into the registry (the testable half of the connect loop).
// A path that is not a git repository is rejected and NOTHING is written — a registry entry with
// syncedHead:null would only surface later as an unexplained "unknown status" in the CI gates.
export function registerRepo(root, registry, { name, rpath, platform, domain_owner = '', default_branch = 'main', today = null }) {
  if (!insideRoot(root, rpath)) {
    warn(`${rpath} resolves outside the project root — skipped`);
    return null;
  }
  const repoRoot = path.resolve(root, rpath);
  const head = gitHead(repoRoot);
  if (head === null) { warn(`${rpath} is not a git repository (or has no commits) — skipped`); return null; }
  const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot });
  let plat = (platform || '').toLowerCase();
  if (!['github', 'gitlab'].includes(plat)) {
    const detected = detectPlatform(remote.ok ? remote.stdout : '') || 'github';
    if (plat) warn(`unknown platform '${platform}' — using ${detected}`);
    plat = detected;
  }
  const repo = {
    name, path: rpath, git_url: (remote.ok && remote.stdout) || null, platform: plat, domain_owner, default_branch,
    connectedAt: today, lastSyncedAt: today,
    syncedHead: head,
    contextPack: `.sdlc/code-context/${name}/pack.md`,
    codeMap: `.sdlc/code-context/${name}/code-map.md`,
    source: 'repomix',
  };
  registry.repos.push(repo);
  writeJSON(path.join(root, PROJECT_FILES.reposRegistry), registry);
  return repo;
}

// Record the project's design-tool connection into .sdlc/design.json (the deterministic half of the
// connect loop; MCP detection itself is an AI step, handed off to `yad-connect-design`). An unknown tool
// falls back to the primary adapter rather than being rejected — mirrors registerRepo's platform
// fallback and the hub step. `none` is the explicit markdown-only choice.
export function registerDesign(root, { tool, project_url = null, files = null, today = null } = {}) {
  // Idempotent re-connect: carry the original first-connect date forward (the schema defines
  // connectedAt as "first connect"); only lastSyncedAt moves. Mirrors repo.mjs refresh.
  const designPath = path.join(root, PROJECT_FILES.designConfig);
  const prev = readJSON(designPath, null);
  const connectedAt = prev && prev.connectedAt ? prev.connectedAt : today;
  let t = (tool || '').toLowerCase();
  if (t === 'none' || t === '') {
    const off = { tool: 'none', provider: null, project_url: null, auth: 'user',
      files: { web: null, mobile: null }, connectedAt, lastSyncedAt: today, source: 'unavailable' };
    writeJSON(designPath, off);
    return off;
  }
  if (!DESIGN_TOOLS.includes(t)) { warn(`unknown design tool '${tool}' — using ${DESIGN_PRIMARY}`); t = DESIGN_PRIMARY; }
  // source stays null until `yad-connect-design` detects the MCP in the harness (AI step). doctor reports
  // a recorded-but-unconfirmed connection as a warning pointing at that skill.
  const design = {
    tool: t, provider: null, project_url: project_url || null, auth: 'user',
    files: files || { web: null, mobile: null },
    connectedAt, lastSyncedAt: today, source: null,
  };
  writeJSON(designPath, design);
  return design;
}

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
  const total = 8;
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
    const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: root });
    if (!remote.ok && exists(path.join(root, '.git'))) info('no origin remote — platform detection skipped');
    let platform = detectPlatform(remote.ok ? remote.stdout : '');
    platform = (await ask('Hub platform (github/gitlab/none)', platform || 'none')).toLowerCase();
    if (!['github', 'gitlab', 'none'].includes(platform)) {
      warn(`unknown platform '${platform}' — using none (file-only gate)`);
      platform = 'none';
    }
    const roster = [];
    if (await askYesNo('Add reviewers to the roster now?', true)) {
      for (;;) {
        const login = await ask('  reviewer platform login (blank to finish)', '');
        if (!login) break;
        const name = await ask('    yad name', login);
        const role = await ask('    role (owner/reviewer/domain-owner)', 'reviewer');
        const email = await ask('    commit email (verified-commits gate; blank to skip)', '');
        roster.push({ login, name, role, ...(email ? { email } : {}) });
      }
    }
    const default_branch = platform === 'none' ? 'main' : await ask('Hub default branch', 'main');
    // `bridge_enabled` is the canonical flag (hub-config schema); keep the legacy `bridge` spelling
    // for anything that still reads it.
    const enabled = platform !== 'none';
    writeJSON(hubPath, { platform: enabled ? platform : null, bridge_enabled: enabled, bridge: enabled, default_branch, roster });
    ok(`wrote ${PROJECT_FILES.hubConfig} (${roster.length} reviewer(s))`);
  }

  // 4. Connect a design tool (Figma-first, pluggable; the UI step materializes the design here)
  step(4, total, 'Connect a design tool (Figma / pencil / none)');
  const designPath = path.join(root, PROJECT_FILES.designConfig);
  if (exists(designPath) && !(await askYesNo('design.json exists — reconfigure?', false))) {
    info('keeping existing .sdlc/design.json');
  } else {
    let tool = (await ask(`Design tool (${DESIGN_TOOLS.join('/')}/none)`, DESIGN_PRIMARY)).toLowerCase();
    if (![...DESIGN_TOOLS, 'none'].includes(tool)) {
      warn(`unknown design tool '${tool}' — using ${DESIGN_PRIMARY}`);
      tool = DESIGN_PRIMARY;
    }
    const project_url = tool === 'none' ? null : (await ask('  project/file URL (blank to set later)', '')) || null;
    registerDesign(root, { tool, project_url, today: opts.today ?? null });
    ok(tool === 'none'
      ? `wrote ${PROJECT_FILES.designConfig} (markdown-only)`
      : `wrote ${PROJECT_FILES.designConfig} (${tool})`);
  }

  // 5. Connect code repos
  step(5, total, 'Connect code repos');
  const regPath = path.join(root, PROJECT_FILES.reposRegistry);
  const registry = readJSON(regPath, { repos: [] });
  const known = new Set(registry.repos.map((r) => r.name));
  if (await askYesNo(`Connect a code repo? ${c.dim(`(${registry.repos.length} already registered)`)}`, registry.repos.length === 0)) {
    for (;;) {
      const name = await ask('  repo name (blank to finish)', '');
      if (!name) break;
      if (known.has(name)) { warn(`${name} already registered — skipping`); continue; }
      const rpath = await ask('    path (relative to project root)', `demo-repos/${name}`);
      if (!insideRoot(root, rpath)) { warn(`${rpath} resolves outside the project root — skipped`); continue; }
      const detected = run('git', ['remote', 'get-url', 'origin'], { cwd: path.resolve(root, rpath) });
      const platform = (await ask('    platform (github/gitlab)', detectPlatform(detected.ok ? detected.stdout : '') || 'github')).toLowerCase();
      const domain_owner = await ask('    domain owner', '');
      const default_branch = await ask('    default branch', 'main');
      const repo = registerRepo(root, registry, { name, rpath, platform, domain_owner, default_branch, today: opts.today ?? null });
      if (!repo) continue;
      known.add(name);
      ok(`registered ${name}`);
      packRepo(root, repo);
    }
  }

  // 6. Wire each connected repo + the hub itself
  step(6, total, 'Wire connected repos + the hub (CI gates, PR template, comment scaffold, gate-sync)');
  if (registry.repos.length === 0) info('no repos to wire');
  for (const repo of registry.repos) {
    log(`  ${c.bold(repo.name)} ${c.dim(`(${repo.platform})`)}`);
    applyActions(repoActions(root, repo), { force: true });
  }
  // the hub: event-driven gate-sync CI, so platform approvals/merges drive `yad gate ci`
  const hubWiring = hubActions(root);
  if (hubWiring.length) {
    log(`  ${c.bold('hub')} ${c.dim('(gate-sync + verified-commits CI)')}`);
    applyActions(hubWiring, { force: true });
  }
  // author allowlists for the verified-commits gate (hub + every repo), from the roster emails
  applyActions(authorsActions(root, registry.repos), { force: true });

  // 7. Optional CodeRabbit
  step(7, total, 'AI review (CodeRabbit)');
  for (const repo of registry.repos) {
    const cr = path.join(path.resolve(root, repo.path), '.coderabbit.yaml');
    if (exists(cr)) { info(`${repo.name}: .coderabbit.yaml present`); continue; }
    if (await askYesNo(`Wire CodeRabbit (advisory) in ${repo.name}?`, false)) {
      fs.writeFileSync(cr, 'reviews:\n  high_level_summary: true\n  poem: false\n');
      ok(`${repo.name}: wrote .coderabbit.yaml`);
    }
  }

  // 8. Summary + version stamp
  step(8, total, 'Done');
  writeJSON(path.join(root, PROJECT_FILES.version), { version: VERSION, ideTargets, updatedAt: opts.today ?? null });
  ok(`stamped ${PROJECT_FILES.version} (v${VERSION})`);
  log('');
  log(c.bold('Next — AI-only steps (run in Claude Code):'));
  hand('generate code-maps: run `yad-connect-repos` for each connected repo');
  const design = readJSON(designPath, null);
  if (design && design.tool && design.tool !== 'none') {
    hand(`confirm the design tool: run \`yad-connect-design\` to detect the ${design.tool} MCP (or it degrades to markdown-only)`);
  }
  hand('author your first epic: run `yad-epic`');
  log('');
  log(c.dim('Re-run anytime: `yad check` (report) / `yad check --fix` (reconcile).'));
}

// Deterministic repomix pack (code-map generation itself is an AI step, handed off).
export function packRepo(root, repo) {
  const repoRoot = path.resolve(root, repo.path);
  const out = path.join(root, repo.contextPack);
  if (!has('npx')) { warn(`${repo.name}: npx missing — skipped repomix pack`); return false; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  info(`${repo.name}: packing with repomix …`);
  const r = run('npx', ['repomix@latest', '--compress', '--include-logs', '--style', 'markdown', '-o', out], { cwd: repoRoot });
  if (r.ok) { ok(`${repo.name}: cached ${repo.contextPack}`); hand(`${repo.name}: generate the code-map in Claude Code (yad-connect-repos)`); return true; }
  fail(`${repo.name}: repomix failed — ${r.stderr.split('\n')[0] || 'unknown error'}`);
  return false;
}
