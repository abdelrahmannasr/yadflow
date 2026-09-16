// `yad setup` — the guided, idempotent first-run wizard.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  c, log, step, guide, ok, info, warn, hand, fail, ask, askYesNo, run, has,
  exists, readJSON, readJSONStrict, writeJSON,
  writeProductConfig,
} from './lib.mjs';
import { VERSION, IDE_TARGETS, IDE_AGENTS, DEFAULT_IDE_TARGETS, PROJECT_FILES, DESIGN_TOOLS, DESIGN_PRIMARY, TESTING_TOOLS, TESTING_PRIMARY, LEARNING_TOOLS, LEARNING_PRIMARY , productConfigPath } from './manifest.mjs';
import {
  moduleActions, repoActions, productActions, hookActions, authorsActions,
  legacyModuleActions, removedModuleActions, legacyRepoActions, legacyHubActions,
  safeIdeTargetsFor, detectedIdeTargetStateFor, recordManagedWrites,
} from './plan.mjs';
import { modeFields, modeOf } from './mode.mjs';
import { recordActor } from './skip.mjs';
import { loadSkillBindings, stepSkills } from './epic-state.mjs';

// Parse a comma/space separated list into a clean, deduped array of trimmed tokens.
export function parseList(s) {
  return [...new Set((s || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean))];
}

// Programmatic setup is strict; interactive setup keeps asking until it receives at least one valid
// canonical target. Both paths return the same trimmed, ordered, deduplicated representation.
export async function selectIdeTargets(root, provided, asker = ask) {
  if (provided !== undefined) return safeIdeTargetsFor(root, provided);
  const detected = detectedIdeTargetStateFor(root);
  const present = detected.targets;
  for (const unsafe of detected.unsafe) warn(`${unsafe.message}; excluded from IDE defaults`);
  // Detected directories win: a project that already has `.cursor/` gets it offered back, and is not
  // talked into a default it did not choose. Only a project with NO agent directory sees the default.
  const def = (present.length ? present : DEFAULT_IDE_TARGETS).join(',');
  for (;;) {
    // Each target is listed with the agents that actually read it, because the directory name does not
    // say. A Codex or Gemini CLI user shown a bare `.agents` has no way to know it is the one for them.
    const menu = IDE_TARGETS.map((t) => `${t} = ${(IDE_AGENTS[t] || []).join(', ')}`).join('; ');
    const answer = await asker(`IDE targets to install ${c.dim('(comma-separated — ' + menu + ')')}`, def);
    if (answer === undefined || answer === null) throw new Error('IDE target selection ended before a valid choice was provided');
    const values = String(answer ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    try {
      return safeIdeTargetsFor(root, values);
    } catch (e) {
      if (process.env.SDLC_NONINTERACTIVE || e?.code !== 'YAD_IDE_TARGET') throw e;
      warn(e.message);
    }
  }
}

export function detectPlatform(remoteUrl = '') {
  if (/gitlab/i.test(remoteUrl)) return 'gitlab';
  if (/github/i.test(remoteUrl)) return 'github';
  return null;
}
export const gitHead = (cwd) => run('git', ['rev-parse', 'HEAD'], { cwd }).stdout || null;

// Containment: a repo path must live inside the WORKSPACE — the Product root's parent. The standard
// multi-repo layout puts the code repos BESIDE the Product, not under it (project/{product,backend,frontend}),
// so `../backend` has to register; containing to the Product root instead forced separate git repos to nest
// inside the Product's own repo (issue #129). A nested path (demo-repos/api) still works.
//
// The bound stays real: the registry path is later joined and executed against (repomix cwd,
// .coderabbit.yaml + CI wiring), and even the read-only remote probe must not run against an arbitrary
// outside path — so `../../elsewhere` and absolute-outside paths are still rejected. The path.sep-suffixed
// compare avoids the /project vs /project-evil prefix trap, now one level up at the workspace.
// A sibling of the Product (../product-evil) is, correctly, indistinguishable from ../backend: both are
// ordinary workspace members. The workspace DIRECTORY ITSELF (`..`) is not: it contains the Product, so
// registering it as a code repo would point repomix and the CI writes at the whole tree. Only the Product
// root itself (a monorepo, `.`) and strict descendants of the workspace pass.
//
// Place the Product one level below the workspace root (project/product), not directly in $HOME — the
// workspace is the trust boundary, and a shallow Product makes every sibling of it registerable.
export function insideWorkspace(root, rpath) {
  const projectRoot = path.resolve(root);
  const parent = path.dirname(projectRoot);
  const workspace = parent === projectRoot ? projectRoot : parent; // degenerate: root is the fs root
  const resolved = path.resolve(projectRoot, rpath);
  return resolved === projectRoot || resolved.startsWith(workspace + path.sep);
}

// Build the hub.json object for a (re)configure write: the fields this run collected, laid over the
// existing file so nothing the wizard does not ask about is dropped. Mirrors the safe { ...cur } merge
// on the keep path. That includes a `roster` or `verified_authors` an older release wrote (E62): the
// wizard no longer collects or reads either, and it never deletes them — `yad doctor` names them as
// unused instead.
export function buildReconfiguredHub(cur, fields) {
  return { ...(cur || {}), ...fields };
}

// Validate + record one code repo into the registry (the testable half of the connect loop).
// A path that is not a git repository is rejected and NOTHING is written — a registry entry with
// syncedHead:null would only surface later as an unexplained "unknown status" in the CI gates.
export function registerRepo(root, registry, { name, rpath, platform, default_branch = 'main', today = null, pack = true }) {
  if (!insideWorkspace(root, rpath)) {
    warn(`${rpath} resolves outside the workspace (the project root's parent) — skipped`);
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
  // No `domain_owner` / `domain_owners` (E62): people are not stored. A registry entry an older release
  // wrote may still carry them; nothing reads them, and `yad doctor` names them as unused.
  const repo = {
    name, path: rpath, git_url: (remote.ok && remote.stdout) || null, platform: plat,
    default_branch,
    connectedAt: today, lastSyncedAt: today,
    // Only claim a synced HEAD when a pack is actually produced. The greenfield path skips packing
    // (pack:false), so leave syncedHead null — the repo then reads as "needs an initial pack" in
    // `yad repo list` / `yad doctor` instead of falsely "fresh".
    syncedHead: pack ? head : null,
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
// fallback and the Product step. `none` is the explicit markdown-only choice.
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

// Record the project's testing-tool connection into .sdlc/testing.json (the deterministic half of the
// connect loop; MCP detection itself is an AI step, handed off to `yad-connect-testing`). An unknown
// tool falls back to the primary adapter rather than being rejected — mirrors registerDesign. `none` is
// the explicit artifacts-only choice.
export function registerTesting(root, { tool, project_url = null, suites = null, today = null } = {}) {
  // Idempotent re-connect: carry the original first-connect date forward; only lastSyncedAt moves.
  const testingPath = path.join(root, PROJECT_FILES.testingConfig);
  const prev = readJSON(testingPath, null);
  const connectedAt = prev && prev.connectedAt ? prev.connectedAt : today;
  let t = (tool || '').toLowerCase();
  if (t === 'none' || t === '') {
    const off = { tool: 'none', provider: null, project_url: null, auth: 'user',
      suites: {}, connectedAt, lastSyncedAt: today, source: 'unavailable' };
    writeJSON(testingPath, off);
    return off;
  }
  if (!TESTING_TOOLS.includes(t)) { warn(`unknown testing tool '${tool}' — using ${TESTING_PRIMARY}`); t = TESTING_PRIMARY; }
  // source stays null until `yad-connect-testing` detects the MCP in the harness (AI step). doctor
  // reports a recorded-but-unconfirmed connection as a warning pointing at that skill.
  const testing = {
    tool: t, provider: null, project_url: project_url || null, auth: 'user',
    suites: suites || {},
    connectedAt, lastSyncedAt: today, source: null,
  };
  writeJSON(testingPath, testing);
  return testing;
}

// Record the project's learning-tool connection into .sdlc/learning.json (the deterministic half of the
// connect loop; CLI detection + the kb build are AI steps, handed off to `yad-connect-learning`). An
// unknown tool falls back to the primary adapter rather than being rejected — mirrors registerDesign/
// registerTesting. `none` is the explicit harness-native choice (yad-learn tutors via the harness model).
// DeepTutor has no MCP, so `source` stays null at setup until the connect skill detects the CLI on PATH.
export function registerLearning(root, { tool, kb = null, today = null } = {}) {
  // Idempotent re-connect: carry the original first-connect date forward; only lastSyncedAt moves.
  const learningPath = path.join(root, PROJECT_FILES.learningConfig);
  const prev = readJSON(learningPath, null);
  const connectedAt = prev && prev.connectedAt ? prev.connectedAt : today;
  let t = (tool || '').toLowerCase();
  if (t === 'none' || t === '') {
    const off = { tool: 'none', provider: null, version: null, kb: null, kb_sources: [], auth: 'user',
      connectedAt, lastSyncedAt: today, source: 'harness-native' };
    writeJSON(learningPath, off);
    return off;
  }
  if (!LEARNING_TOOLS.includes(t)) { warn(`unknown learning tool '${tool}' — using ${LEARNING_PRIMARY}`); t = LEARNING_PRIMARY; }
  // source stays null until `yad-connect-learning` detects the CLI on PATH (AI step). doctor reports a
  // recorded-but-unconfirmed connection as a warning pointing at that skill.
  const learning = {
    tool: t, provider: null, version: null, kb: kb || null, kb_sources: [], auth: 'user',
    connectedAt, lastSyncedAt: today, source: null,
  };
  writeJSON(learningPath, learning);
  return learning;
}

// The solo switch as setup writes it: `solo` and `mode` in step, through the same `modeFields` `yad mode` uses
// (E10). Setup records `mode_set` only when it CHANGES the mode of a Product that already had a config — a
// first run is not a switch. It takes no reason, because an interview answer or a `--solo` / `--team` flag
// is the choice itself; the record names `yad setup` so the change is still attributable.
export function setupModeFields(root, cur, solo, opts = {}) {
  const had = !!cur && typeof cur === 'object' && Object.keys(cur).length > 0;
  const { mode_set: set, ...fields } = modeFields(cur, solo ? 'solo' : 'team', {
    by: had ? recordActor(root) : null, date: opts.today ?? null, reason: 'yad setup',
  });
  return had && set ? { ...fields, mode_set: set } : fields;
}

function applyActions(actions, { force = false } = {}) {
  let changed = 0;
  for (const a of actions) {
    // A managed file the team edited is left alone here too — setup re-runs with force:true, so
    // without this the wizard would be a second silent-clobber path for the same edits (#164).
    if (a.status === 'modified') {
      warn(`kept locally modified ${a.scope}/${a.item} — replace it with \`yad update --overwrite-local\``);
      continue;
    }
    if (a.status === 'ok' && !force) continue;
    a.apply();
    changed++;
    info(`${a.status === 'missing' || a.status === 'new' ? 'installed' : 'updated'} ${a.scope}/${a.item}${a.backup ? ` (previous content saved to ${path.basename(a.backup)})` : ''}`);
  }
  if (!changed) info('already up to date');
  return changed;
}

// Step 0 — resolve the setup profile that branches the rest of the wizard. Flags pre-answer each
// question (CI/scripts); an existing hub.json carries prior answers forward (idempotent re-run);
// otherwise we prompt with a default. Pure of side effects — it only reads. Returns
// { solo, team_size, codebase, repo_layout, configureTools }.
export async function resolveProfile(root, opts = {}) {
  const hub = readJSON(productConfigPath(root), null);
  const prev = (hub && hub.profile) || {};

  // 1. Solo or team (+ size). --solo / --team <n> win; else carry hub.solo forward; else ask.
  let solo, team_size;
  if (opts.solo) { solo = true; team_size = 1; }
  else if (opts.team != null) { team_size = Math.max(1, parseInt(opts.team, 10) || 1); solo = team_size <= 1; }
  // Either spelling carries forward: the older `review_gate.solo: true` also waives the gates, and asking again
  // would default a configured team Product to solo and switch approvals off with nobody choosing it (E10).
  else if (typeof hub?.solo === 'boolean' || hub?.review_gate?.solo === true) { solo = modeOf(hub) === 'solo'; team_size = prev.team_size ?? (solo ? 1 : 2); }
  else {
    // No mode recorded. The default used to come from the roster's size; it now comes from the team size
    // setup recorded, and a Product that exists with neither defaults to TEAM (E62). Solo waives every
    // approval, so it must be a choice, never what a scripted re-run of an old Product falls into.
    const known = prev.team_size ?? (hub ? 2 : 1);
    solo = !(await ask('Solo or team?', known > 1 ? 'team' : 'solo')).toLowerCase().startsWith('t');
    team_size = solo ? 1 : Math.max(2, parseInt(await ask('  how many team members?', String(Math.max(2, known))), 10) || 2);
  }

  // 2. Greenfield (new code) or brownfield (existing code).
  let codebase;
  if (opts.greenfield) codebase = 'greenfield';
  else if (opts.brownfield) codebase = 'brownfield';
  else if (prev.codebase) codebase = prev.codebase;
  else codebase = (await ask('Greenfield (new code) or brownfield (existing code)?', 'greenfield')).toLowerCase().startsWith('b') ? 'brownfield' : 'greenfield';

  // 3. Monorepo (one repo) or separate repos.
  let repo_layout;
  if (opts.monorepo) repo_layout = 'monorepo';
  else if (opts.separate) repo_layout = 'separate';
  else if (prev.repo_layout) repo_layout = prev.repo_layout;
  else repo_layout = (await ask('Monorepo (one repo) or separate repos?', 'monorepo')).toLowerCase().startsWith('s') ? 'separate' : 'monorepo';

  // 4. Configure the optional tools now, or defer (records them as none, connect later).
  const configureTools = opts.tools === true ? true
    : process.env.SDLC_NONINTERACTIVE ? false
      : await askYesNo('Configure design/testing/learning tools now? (else connect them later)', false);

  return { solo, team_size, codebase, repo_layout, configureTools };
}

// The guided, idempotent first-run wizard: a Step 0 profile interview (resolveProfile) that branches
// the remaining steps — install, Product platform, optional tools, repos, wiring — and persists the profile.
export async function runSetup(root, opts = {}) {
  log(c.bold(`\nSDLC Workflow setup  ${c.dim('v' + VERSION)}`));
  log(c.dim(`target: ${root}`));

  // 0. Profile interview — branch the wizard to the user's situation (solo/team, code, repo layout).
  const { solo, team_size, codebase, repo_layout, configureTools } = await resolveProfile(root, opts);
  // Steps: interview, preflight, install, Product, tools (1 if deferred else 3), repos, wire, coderabbit, done.
  const total = 8 + (configureTools ? 3 : 1);
  let _n = 0;
  const S = (title) => step(++_n, total, title);

  S('Profile');
  guide([
    'How you answer here shapes the rest of setup — fewer prompts, the right path.',
    `solo: ${solo ? 'yes — you review by merging your own PR (approval waived)' : `no — team of ${team_size}`}`,
    `code: ${codebase}  •  repos: ${repo_layout}  •  optional tools: ${configureTools ? 'configure now' : 'deferred (connect later)'}`,
  ]);

  // Preflight
  S('Preflight');
  if (!exists(path.join(root, '.git'))) {
    if (await askYesNo('Not a git repo. Run `git init` here?', true)) {
      run('git', ['init'], { cwd: root });
      ok('git initialized');
    } else warn('continuing without git — hub detection will be skipped');
  } else ok('git repo detected');
  for (const tool of ['git', 'node']) has(tool) ? ok(`${tool} present`) : warn(`${tool} not found on PATH`);
  if (!has('npx')) warn('npx not found — repomix packing will be skipped');

  // Install the module
  S('Install the module (skills + .sdlc/config.yaml)');
  guide([
    'Copies the yad-* skills into your AI tool(s) so they appear in Claude Code, Codex CLI, Cursor, Gemini CLI, Copilot, Zencoder or opencode.',
    'Enter the IDE folders to install into, comma-separated; default = whatever is already present.',
  ]);
  const ideTargets = await selectIdeTargets(root, opts.ideTargets);
  applyActions(moduleActions(root, ideTargets), { force: true });
  // Migrate any pre-2.0 install in place: remove the old sdlc-* skill copies in the project's
  // IDE targets and install their yad-* renames. Without this, setup only ADDED yad-* and left
  // stale sdlc-* sitting next to them (the rename only ran under `yad update` / `yad check --fix`).
  applyActions(legacyModuleActions(root, ideTargets), { force: true });
  // Purge any skill removed in a later release (REMOVED_SKILLS) that a prior install left behind —
  // setup only ADDS current skills, so without this a breaking removal would linger next to them.
  applyActions(removedModuleActions(root, ideTargets), { force: true });
  ok(`module installed into: ${ideTargets.join(', ')}`);

  // Global leftovers: a pre-2.0 install may have put sdlc-* skills in the user's global
  // ~/.claude/skills (path.join(homedir, '.claude', 'skills', <old>)). The CLI is project-scoped,
  // so touching the home dir requires an interactive yes — never auto-fire it in SDLC_NONINTERACTIVE
  // (scripted/CI) mode, where the prompt would otherwise return its default. Silent when there is
  // nothing to migrate.
  const globalLegacy = process.env.SDLC_NONINTERACTIVE ? [] : legacyModuleActions(os.homedir(), ['.claude']);
  if (globalLegacy.length) {
    if (await askYesNo(`Found ${globalLegacy.length} legacy sdlc-* skill(s) in your global ~/.claude/skills (pre-2.0 install). Migrate them to yad-*?`, true)) {
      applyActions(globalLegacy, { force: true });
      ok('migrated global ~/.claude/skills to yad-*');
    } else {
      info('left global ~/.claude/skills untouched — re-run `yad setup` or migrate later with `yad update`');
    }
  }

  // Same opt-in pass for skills removed in a later release (REMOVED_SKILLS) that linger in the
  // global ~/.claude/skills — purge them so a global install also drops the dead command.
  const globalRemoved = process.env.SDLC_NONINTERACTIVE ? [] : removedModuleActions(os.homedir(), ['.claude']);
  if (globalRemoved.length) {
    if (await askYesNo(`Found ${globalRemoved.length} removed skill(s) in your global ~/.claude/skills. Delete them?`, true)) {
      applyActions(globalRemoved, { force: true });
      ok('purged removed skill(s) from global ~/.claude/skills');
    } else {
      info('left global ~/.claude/skills untouched — re-run `yad setup` or purge later with `yad update`');
    }
  }

  // Detect Product platform. No people are collected (E62): anyone with access approves on the platform.
  S('Product platform');
  guide(solo
    ? [
      'Your hub is this repo on GitHub/GitLab (or none for a local gate).',
      'Solo: you review by merging your own PR (approval waived).',
    ]
    : [
      'Your hub is this repo on GitHub/GitLab; reviewers approve artifacts there.',
      'yad keeps no list of people: anyone with access to the repo can approve, and the platform records who did.',
      'A gate needs one approval from someone other than the author.',
      'It also reports how many people it would like: 3 on a contract review, 1 elsewhere. That extra number is advisory — it never blocks.',
    ]);
  const productPath = productConfigPath(root);
  if (exists(productPath) && !(await askYesNo('hub.json exists — reconfigure?', false))) {
    info('keeping existing .sdlc/hub.json');
  } else {
    const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: root });
    if (!remote.ok && exists(path.join(root, '.git'))) info('no origin remote — platform detection skipped');
    let platform = detectPlatform(remote.ok ? remote.stdout : '');
    platform = (await ask('Product platform (github/gitlab/none)', platform || 'none')).toLowerCase();
    if (!['github', 'gitlab', 'none'].includes(platform)) {
      warn(`unknown platform '${platform}' — using none (local gate)`);
      platform = 'none';
    }
    const default_branch = platform === 'none' ? 'main' : await ask('Product default branch', 'main');
    // `ledger` is the canonical switch (shape 2): "verified" = CI writes the ledger, "local" = this
    // machine does. The two booleans below say the same thing in the older spelling and are written
    // ALONGSIDE it, not instead of it — add before you remove (rule 3). They are what a check gate
    // that has not been refreshed by `yad update` yet still reads, and what a Product that is rolled back
    // to a 3.x CLI would fall back to. They go in a later major, once nothing on either side reads them.
    const enabled = platform !== 'none';
    // Record git_url — doctor needs it to scope the auth probe (YAD-CFG-005) and the verified ledger/PR flow
    // needs it to open PRs. Derived from the origin remote already resolved above; null when local-only.
    const git_url = enabled ? ((remote.ok && remote.stdout.trim()) || null) : null;
    // Merge into the existing file, never clobber: a key this wizard does not collect is kept as it is.
    // Read strict so a corrupt Product aborts here (YAD-STATE-001) rather than fail-open to `{}` and rewrite
    // the file with everything it did not collect stripped.
    const cur = readJSONStrict(productPath, {}) || {};
    // `ledger` belongs to shape 2. On a project still on shape 1 — one that has not run
    // `yad migrate` yet — writing it would leave a file DECLARING shape 1 while carrying a shape-2
    // field, which is rule 1 read backwards and makes `yad doctor`'s drift report a lie about the
    // one file this shape change is about. The old booleans below say the same thing and are what
    // the reader falls back to when `ledger` is absent, so nothing is lost by waiting: `yad migrate`
    // adds the key, and the setting it computes is the one these booleans just recorded.
    const onNewShape = (cur.schemaVersion ?? 1) >= 2 || !Object.keys(cur).length;
    const next = buildReconfiguredHub(cur, {
      platform: enabled ? platform : null, git_url,
      ...(onNewShape ? { ledger: enabled ? 'verified' : 'local' } : {}),
      bridge_enabled: enabled, bridge: enabled,
      default_branch, ...setupModeFields(root, cur, solo, opts), profile: { codebase, repo_layout, team_size },
    });
    writeProductConfig(root, next);
    ok(`wrote ${PROJECT_FILES.productConfig} + ${PROJECT_FILES.hubConfig}${solo ? ' (solo mode)' : ''}`);
  }
  // Persist the profile + solo flag even on the "keeping existing" path, so re-running setup with new
  // flags (e.g. `yad setup --solo`) updates the mode without a full reconfigure. Merge, never clobber.
  // Also backfill a missing git_url from origin here (idempotent repair for the doctor's YAD-CFG-005).
  if (exists(productPath)) {
    // Strict read for the same reason as the reconfigure write above: a corrupt Product must abort, never
    // fail-open to `{}` and get rewritten with everything else stripped on a plain re-run.
    const cur = readJSONStrict(productPath, {}) || {};
    const backfillUrl = (cur.platform && !cur.git_url)
      ? ((run('git', ['remote', 'get-url', 'origin'], { cwd: root }).stdout || '').trim() || null)
      : null;
    const mode = setupModeFields(root, cur, solo, opts);
    const modeMoved = Object.keys(mode).some((k) => JSON.stringify(cur[k]) !== JSON.stringify(mode[k]));
    if (modeMoved || JSON.stringify(cur.profile || {}) !== JSON.stringify({ codebase, repo_layout, team_size }) || backfillUrl) {
      writeProductConfig(root, { ...cur, ...(backfillUrl ? { git_url: backfillUrl } : {}), ...mode, profile: { codebase, repo_layout, team_size } });
      if (mode.mode_set) info(`mode: ${mode.mode_set.from} → ${mode.mode_set.to} (recorded as mode_set)`);
      if (backfillUrl) info(`backfilled hub git_url from origin: ${backfillUrl}`);
      else info(`recorded profile: ${solo ? 'solo' : `team(${team_size})`}, ${codebase}, ${repo_layout}`);
    }
  }

  // Optional tools (design / testing / learning). Paths are declared here so the final summary can
  // read them whether or not we configured the tools this run.
  const designPath = path.join(root, PROJECT_FILES.designConfig);
  const testingPath = path.join(root, PROJECT_FILES.testingConfig);
  const learningPath = path.join(root, PROJECT_FILES.learningConfig);
  if (configureTools) {
    // Connect a design tool (Figma-first, pluggable; the UI step materializes the design here)
    S('Connect a design tool (Figma / pencil / none)');
    guide([
      'Where yad-ui materializes real screens. figma (confirm the MCP later) or none for markdown-only.',
      'Skipping is safe — the UI step degrades to ui-design.md.',
    ]);
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

    // Connect a testing tool (Playwright-first, pluggable; the test-cases step implements automation here)
    // Banner + guide read TESTING_TOOLS rather than spelling the adapters out: this is the list that
    // actually grows (maestro joined it), and a hardcoded copy here would quietly offer the user fewer
    // tools than the prompt below accepts.
    S(`Connect a testing tool (${TESTING_TOOLS.join(' / ')} / none)`);
    guide([
      `Where yad-test-cases generates automation. ${TESTING_TOOLS.join('/')}, or none for artifacts-only.`,
      'Skipping is safe — test-cases authors test-cases.md only.',
    ]);
    if (exists(testingPath) && !(await askYesNo('testing.json exists — reconfigure?', false))) {
      info('keeping existing .sdlc/testing.json');
    } else {
      let tool = (await ask(`Testing tool (${TESTING_TOOLS.join('/')}/none)`, TESTING_PRIMARY)).toLowerCase();
      if (![...TESTING_TOOLS, 'none'].includes(tool)) {
        warn(`unknown testing tool '${tool}' — using ${TESTING_PRIMARY}`);
        tool = TESTING_PRIMARY;
      }
      const project_url = tool === 'none' ? null : (await ask('  project/config reference (blank to set later)', '')) || null;
      registerTesting(root, { tool, project_url, today: opts.today ?? null });
      ok(tool === 'none'
        ? `wrote ${PROJECT_FILES.testingConfig} (artifacts-only)`
        : `wrote ${PROJECT_FILES.testingConfig} (${tool})`);
    }

    // Connect a learning tool (DeepTutor-first, pluggable; the learning layer tutors team members here)
    S('Connect a learning tool (deeptutor / none)');
    guide([
      'Lets any team member invoke yad-learn to be tutored in-context. deeptutor (a CLI), or none.',
      'Skipping is safe — yad-learn tutors via the harness model (harness-native).',
    ]);
    if (exists(learningPath) && !(await askYesNo('learning.json exists — reconfigure?', false))) {
      info('keeping existing .sdlc/learning.json');
    } else {
      let tool = (await ask(`Learning tool (${LEARNING_TOOLS.join('/')}/none)`, LEARNING_PRIMARY)).toLowerCase();
      if (![...LEARNING_TOOLS, 'none'].includes(tool)) {
        warn(`unknown learning tool '${tool}' — using ${LEARNING_PRIMARY}`);
        tool = LEARNING_PRIMARY;
      }
      registerLearning(root, { tool, today: opts.today ?? null });
      ok(tool === 'none'
        ? `wrote ${PROJECT_FILES.learningConfig} (harness-native)`
        : `wrote ${PROJECT_FILES.learningConfig} (${tool})`);
    }
  } else {
    // Deferred: record any not-yet-present tool as none (degrades gracefully). Existing connections kept.
    S('Optional tools (design / testing / learning) — deferred');
    guide(['Recorded as none; connect any later with the yad-connect-* skills. Existing connections are kept.']);
    if (!exists(designPath)) registerDesign(root, { tool: 'none', project_url: null, today: opts.today ?? null });
    if (!exists(testingPath)) registerTesting(root, { tool: 'none', project_url: null, today: opts.today ?? null });
    if (!exists(learningPath)) registerLearning(root, { tool: 'none', today: opts.today ?? null });
    info('design / testing / learning recorded as none (connect later)');
  }

  // Connect code repos
  S(repo_layout === 'monorepo' ? 'Connect your code repo (monorepo)' : 'Connect code repos');
  guide(repo_layout === 'monorepo'
    ? [
      'One repo holds all the code; the contract lives in the Product and stories tag this single repo.',
      codebase === 'greenfield' ? 'Greenfield: no code yet — the repomix code-pack step is skipped.' : 'Brownfield: the repo is packed so the Shape phases see what already exists.',
    ]
    : [
      'Register each code repo the feature touches; stories get tagged with the repos that implement them.',
      'Per repo: name → path (inside this project) → platform → default branch.',
      codebase === 'greenfield' ? 'Greenfield: no code yet — the repomix code-pack step is skipped.' : 'Brownfield: each repo is packed so the Shape phases see what already exists.',
    ]);
  const regPath = path.join(root, PROJECT_FILES.reposRegistry);
  const registry = readJSON(regPath, { repos: [] });
  const known = new Set(registry.repos.map((r) => r.name));
  const greenfield = codebase === 'greenfield';
  const mono = repo_layout === 'monorepo';
  if (await askYesNo(`Connect a code repo? ${c.dim(`(${registry.repos.length} already registered)`)}`, registry.repos.length === 0)) {
    for (;;) {
      const name = await ask('  repo name (blank to finish)', '');
      if (!name) break;
      if (known.has(name)) { warn(`${name} already registered — skipping`); continue; }
      // Siblings of the Product are the common layout (project/{product,backend}) — `../backend` is valid.
      const rpath = await ask('    path (relative to project root, e.g. ../backend)', `demo-repos/${name}`);
      if (!insideWorkspace(root, rpath)) { warn(`${rpath} resolves outside the workspace (the project root's parent) — skipped`); continue; }
      const detected = run('git', ['remote', 'get-url', 'origin'], { cwd: path.resolve(root, rpath) });
      const platform = (await ask('    platform (github/gitlab)', detectPlatform(detected.ok ? detected.stdout : '') || 'github')).toLowerCase();
      const default_branch = await ask('    default branch', 'main');
      const repo = registerRepo(root, registry, { name, rpath, platform, default_branch, today: opts.today ?? null, pack: !greenfield });
      if (!repo) continue;
      known.add(name);
      ok(`registered ${name}`);
      if (greenfield) info(`${name}: greenfield — skipped repomix pack (run \`yad repo refresh ${name}\` once it has code)`);
      else packRepo(root, repo);
      if (mono) { info('monorepo — one repo connected; stop here'); break; }
    }
  }

  // Wire each connected repo + the Product itself
  S('Wire connected repos + the Product (CI gates, PR template, gate-sync)');
  guide(['Installs the CI safety gates, PR/MR template, and gate-sync — automatic, no input needed.']);
  if (registry.repos.length === 0) info('no repos to wire');
  // Every managed file this step writes is recorded (sha per repo root) so a LATER `yad update` can
  // tell a stale copy from one the team edited, instead of silently rewriting both (#164).
  const wired = [];
  for (const repo of registry.repos) {
    log(`  ${c.bold(repo.name)} ${c.dim(`(${repo.platform})`)}`);
    const repoWiring = repoActions(root, repo);
    applyActions(repoWiring, { force: true });
    wired.push(...repoWiring);
    // Migrate pre-2.0 wired CI (marker-owned sdlc-*.yml -> yad-*.yml); a user-authored
    // same-named file is never touched.
    applyActions(legacyRepoActions(root, repo), { force: true });
  }
  // the Product: event-driven gate-sync CI, so platform approvals/merges drive `yad gate ci`
  const hubWiring = productActions(root);
  if (hubWiring.length) {
    log(`  ${c.bold('hub')} ${c.dim('(gate-sync + verified-commits CI)')}`);
    applyActions(hubWiring, { force: true });
    wired.push(...hubWiring);
  }
  applyActions(legacyHubActions(root), { force: true });
  // the Product, locally: the harness ledger guard, so an agent is refused the CI-owned ledger write at
  // the moment it tries it rather than by a failed pipeline later (#171). Verified-only like the CI
  // above — with no bridge the ledger is locally owned and the guard would be wrong.
  const hookWiring = hookActions(root, ideTargets);
  if (hookWiring.length) {
    log(`  ${c.bold('hub')} ${c.dim('(agent ledger guard)')}`);
    applyActions(hookWiring, { force: true });
    wired.push(...hookWiring);
  }
  // After every write to a managed path has landed (including the legacy renames), so the recorded
  // sha is the file's final state.
  recordManagedWrites(wired);
  // author allowlists for the verified-commits gate (Product + every repo), from the roster emails
  applyActions(authorsActions(root, registry.repos), { force: true });

  // Optional CodeRabbit
  S('AI review (CodeRabbit)');
  guide(['Advisory AI first-pass on PRs — never the authority. Opt in per repo; safe to skip.']);
  for (const repo of registry.repos) {
    const cr = path.join(path.resolve(root, repo.path), '.coderabbit.yaml');
    if (exists(cr)) { info(`${repo.name}: .coderabbit.yaml present`); continue; }
    if (await askYesNo(`Wire CodeRabbit (advisory) in ${repo.name}?`, false)) {
      fs.writeFileSync(cr, 'reviews:\n  high_level_summary: true\n  poem: false\n');
      ok(`${repo.name}: wrote .coderabbit.yaml`);
    }
  }

  // Summary + version stamp
  S('Done');
  writeJSON(path.join(root, PROJECT_FILES.version), { version: VERSION, ideTargets, updatedAt: opts.today ?? null });
  ok(`stamped ${PROJECT_FILES.version} (v${VERSION})`);
  log('');
  // Tailored fastest path to the first epic, by profile.
  log(c.bold('Next:'));
  // Which skill authors the epic is the PROJECT's setting (E6), and `yad setup` re-runs on a project
  // that already has one — so naming the catalogue default here would send a team to a skill their own
  // `yad next` never mentions again. `yad-backfill` stays literal: waking a brownfield anchor is the
  // engine's own promote verb, not a step on any chain.
  const epicSkill = stepSkills('epic', loadSkillBindings(root))[0] || 'yad-epic';
  if (codebase === 'brownfield' && registry.repos.length) {
    hand(`capture what already exists first: run \`yad-backfill\`, then your first epic with \`${epicSkill}\``);
  } else {
    hand(`author your first epic: run \`${epicSkill}\``);
  }
  hand('your single next action, anytime: `yad next`');
  if (!solo) hand('reviewers need no setup: anyone with access approves on the platform, and one approval passes a gate');
  log('');
  log(c.bold('Then — AI-only steps (run in your AI agent):'));
  if (registry.repos.length) hand('generate code-maps: run `yad-connect-repos` for each connected repo');
  const design = readJSON(designPath, null);
  if (design && design.tool && design.tool !== 'none') {
    hand(`confirm the design tool: run \`yad-connect-design\` to detect the ${design.tool} MCP (or it degrades to markdown-only)`);
  }
  const testing = readJSON(testingPath, null);
  if (testing && testing.tool && testing.tool !== 'none') {
    hand(`confirm the testing tool: run \`yad-connect-testing\` to detect the ${testing.tool} MCP (or it degrades to artifacts-only)`);
  }
  const learning = readJSON(learningPath, null);
  if (learning && learning.tool && learning.tool !== 'none') {
    hand(`confirm the learning tool: run \`yad-connect-learning\` to detect the ${learning.tool} CLI (or it degrades to harness-native)`);
  }
  log('');
  log(c.dim('Re-run anytime: `yad check` (report) / `yad check --fix` (reconcile).'));
}

// The repomix pack is a large, regenerable artifact — the Product tracks the AI-authored code-map, not the
// pack. `yad repo refresh --push` relies on the pack being gitignored (repo-publish.mjs never stages it);
// this makes that assumption true in every Product, so a regenerated pack never strands as a dirty tree.
export const PACK_IGNORE_GLOB = '.sdlc/code-context/*/pack.md';

// The exact lines ensurePackIgnored appends — a comment pair + the glob. Kept as data (not inline
// strings) so the publish gate can verify a staged `.gitignore` change is ONLY this managed block and
// never sweep an unrelated user edit into the audit commit (repo-publish.mjs, invariant 1).
export const PACK_IGNORE_BLOCK = [
  '# Repomix code-context packs are large, regenerable artifacts (yad repo refresh) — the',
  '# tracked code-map.md is the reviewed AI output; the pack itself is never committed.',
  PACK_IGNORE_GLOB,
];

// Idempotently ensure the Product `.gitignore` ignores the repomix pack. No-op (returns false) if the line
// is already present (as its own entry); otherwise appends the managed block to a fresh or existing file
// and returns true.
export function ensurePackIgnored(root) {
  const gi = path.join(root, '.gitignore');
  const lines = exists(gi) ? fs.readFileSync(gi, 'utf8').split('\n') : [];
  if (lines.some((l) => l.trim() === PACK_IGNORE_GLOB)) return false;
  const body = lines.join('\n').replace(/\n*$/, '');
  const prefix = body ? `${body}\n\n` : '';
  fs.writeFileSync(gi, `${prefix}${PACK_IGNORE_BLOCK.join('\n')}\n`);
  return true;
}

// Deterministic repomix pack (code-map generation itself is an AI step, handed off).
export function packRepo(root, repo) {
  const repoRoot = path.resolve(root, repo.path);
  const out = path.join(root, repo.contextPack);
  if (!has('npx')) { warn(`${repo.name}: npx missing — skipped repomix pack`); return false; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  ensurePackIgnored(root); // keep the pack out of git before it is (re)written — see repo-publish.mjs invariant 1
  info(`${repo.name}: packing with repomix …`);
  const r = run('npx', ['repomix@latest', '--compress', '--include-logs', '--style', 'markdown', '-o', out], { cwd: repoRoot });
  if (r.ok) { ok(`${repo.name}: cached ${repo.contextPack}`); hand(`${repo.name}: generate the code-map in your AI agent (yad-connect-repos)`); return true; }
  fail(`${repo.name}: repomix failed — ${r.stderr.split('\n')[0] || 'unknown error'}`);
  return false;
}
