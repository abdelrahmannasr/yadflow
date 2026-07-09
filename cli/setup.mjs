// `yad setup` — the guided, idempotent first-run wizard.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  c, log, step, guide, ok, info, warn, hand, fail, ask, askYesNo, run, has,
  exists, readJSON, readJSONStrict, writeJSON,
} from './lib.mjs';
import { VERSION, IDE_FOLDER_TARGETS, PROJECT_FILES, DESIGN_TOOLS, DESIGN_PRIMARY, TESTING_TOOLS, TESTING_PRIMARY, LEARNING_TOOLS, LEARNING_PRIMARY } from './manifest.mjs';
import {
  moduleActions, repoActions, hubActions, authorsActions,
  legacyModuleActions, removedModuleActions, legacyRepoActions, legacyHubActions,
} from './plan.mjs';
import { validateLogin, rolesForScope } from './platform.mjs';

// Parse a comma/space separated list into a clean, deduped array of trimmed tokens.
export function parseList(s) {
  return [...new Set((s || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean))];
}

// Parse a per-scope roles spec — `"hub=owner,reviewer backend=domain-owner"` — into the roster's
// per-scope map `{ hub: ['owner','reviewer'], backend: ['domain-owner'] }`. Tokens are whitespace
// separated; each is `scope=role[,role...]`. Malformed tokens (no `=`, empty scope/roles) are skipped.
export function parseRolesSpec(s) {
  const out = {};
  for (const tok of (s || '').split(/\s+/).map((x) => x.trim()).filter(Boolean)) {
    const eq = tok.indexOf('=');
    if (eq < 0) continue;
    const scope = tok.slice(0, eq).trim();
    const roles = parseList(tok.slice(eq + 1));
    if (!scope || !roles.length) continue;
    out[scope] = [...new Set([...(out[scope] || []), ...roles])];
  }
  return out;
}

const ALL_IDES = [...IDE_FOLDER_TARGETS, '.opencode'];

export function detectPlatform(remoteUrl = '') {
  if (/gitlab/i.test(remoteUrl)) return 'gitlab';
  if (/github/i.test(remoteUrl)) return 'github';
  return null;
}
export const gitHead = (cwd) => run('git', ['rev-parse', 'HEAD'], { cwd }).stdout || null;

// Containment: a repo path must live inside the WORKSPACE — the hub root's parent. The standard
// multi-repo layout puts the code repos BESIDE the hub, not under it (project/{product,backend,frontend}),
// so `../backend` has to register; containing to the hub root instead forced separate git repos to nest
// inside the hub's own repo (issue #129). A nested path (demo-repos/api) still works.
//
// The bound stays real: the registry path is later joined and executed against (repomix cwd,
// .coderabbit.yaml + CI wiring), and even the read-only remote probe must not run against an arbitrary
// outside path — so `../../elsewhere` and absolute-outside paths are still rejected. The path.sep-suffixed
// compare avoids the /project vs /project-evil prefix trap, now one level up at the workspace.
// A sibling of the hub (../product-evil) is, correctly, indistinguishable from ../backend: both are
// ordinary workspace members. The workspace DIRECTORY ITSELF (`..`) is not: it contains the hub, so
// registering it as a code repo would point repomix and the CI writes at the whole tree. Only the hub
// root itself (a monorepo, `.`) and strict descendants of the workspace pass.
//
// Place the hub one level below the workspace root (project/product), not directly in $HOME — the
// workspace is the trust boundary, and a shallow hub makes every sibling of it registerable.
export function insideWorkspace(root, rpath) {
  const projectRoot = path.resolve(root);
  const parent = path.dirname(projectRoot);
  const workspace = parent === projectRoot ? projectRoot : parent; // degenerate: root is the fs root
  const resolved = path.resolve(projectRoot, rpath);
  return resolved === projectRoot || resolved.startsWith(workspace + path.sep);
}

// Validate + record one code repo into the registry (the testable half of the connect loop).
// A path that is not a git repository is rejected and NOTHING is written — a registry entry with
// syncedHead:null would only surface later as an unexplained "unknown status" in the CI gates.
// Grant per-repo roles to roster members by writing into each person's `roles[<repo>]` array in
// hub.json. `grants` maps a role -> the yad names that hold it for this repo. A name that is not in
// the roster is warned about and skipped (the roster is the source of identity). Idempotent.
export function addRepoRoles(root, repo, grants = {}) {
  const hubPath = path.join(root, PROJECT_FILES.hubConfig);
  const hub = readJSON(hubPath, null);
  if (!hub || !Array.isArray(hub.roster)) return;
  const byName = new Map(hub.roster.map((e) => [e.name, e]));
  let touched = false;
  for (const [role, names] of Object.entries(grants)) {
    for (const nm of names) {
      const entry = byName.get(nm);
      if (!entry) { warn(`'${nm}' is not in the roster — skipped ${role} for ${repo}`); continue; }
      // Normalize to the per-scope map, migrating the legacy shapes: a flat array or a single
      // `role` string both become hub roles so nothing is lost.
      if (!entry.roles || typeof entry.roles !== 'object' || Array.isArray(entry.roles)) {
        const hub = Array.isArray(entry.roles) ? entry.roles : (entry.role ? [entry.role] : []);
        entry.roles = hub.length ? { hub } : {};
        delete entry.role;
      }
      const list = Array.isArray(entry.roles[repo]) ? entry.roles[repo] : [];
      if (!list.includes(role)) { list.push(role); touched = true; }
      entry.roles[repo] = list;
    }
  }
  if (touched) writeJSON(hubPath, hub);
}

// Normalize a roster entry's roles in place to the per-scope map, migrating the two legacy shapes
// (a flat array, or a single `role` string) into `roles.hub` so nothing is lost. Mirrors the
// migration addRepoRoles does; pulled out so upsert/remove share it.
function normalizeRoles(entry) {
  if (!entry.roles || typeof entry.roles !== 'object' || Array.isArray(entry.roles)) {
    const hub = Array.isArray(entry.roles) ? entry.roles : (entry.role ? [entry.role] : []);
    entry.roles = hub.length ? { hub } : {};
    delete entry.role;
  }
  return entry.roles;
}

// Build the hub.json object for a (re)configure write, preserving user-owned identity data the wizard
// does not re-collect: top-level `verified_authors` (and any other existing fields), plus a previously
// populated `roster` when this run collected none (solo re-runs skip the reviewer loop). Never blanks a
// non-empty roster; never drops verified_authors. Mirrors the safe { ...cur } merge on the keep path.
// Trade-off (deliberate, fail-safe): a reconfigure can no longer EMPTY a populated roster — collecting
// zero reviewers keeps the existing entries. To actually remove members, use `yad roster remove` (or
// edit hub.json directly); this flow only ever grows or replaces the roster, never silently clears it.
export function buildReconfiguredHub(cur, fields) {
  const { roster, ...rest } = fields;
  const keptRoster = (Array.isArray(roster) && roster.length)
    ? roster
    : (Array.isArray(cur?.roster) ? cur.roster : []);
  return { ...(cur || {}), ...rest, roster: keptRoster };
}

// Upsert one roster member into hub.json, keyed by `login`. Deep-merges the per-scope `roles` map so
// scopes the caller did not name are preserved; sets `name`/`email` when given; validates the login
// against the hub (warn-only — a miss flags `unverified`, `checked:false` skips silently). Creates the
// hub.json shell if absent. Returns { entry, created }.
export function upsertRosterEntry(root, { login, name, email, roles = {}, platform } = {}) {
  if (!login) { warn('roster upsert needs a login — skipped'); return { entry: null, created: false }; }
  const hubPath = path.join(root, PROJECT_FILES.hubConfig);
  const hub = readJSON(hubPath, null) || { platform: platform && platform !== 'none' ? platform : null, bridge_enabled: false, bridge: false, default_branch: 'main', roster: [] };
  if (!Array.isArray(hub.roster)) hub.roster = [];
  let entry = hub.roster.find((e) => e.login === login);
  const created = !entry;
  if (!entry) { entry = { login, name: name || login, roles: {} }; hub.roster.push(entry); }
  if (name) entry.name = name;
  if (email) entry.email = email;
  normalizeRoles(entry);
  for (const [scope, list] of Object.entries(roles || {})) {
    const cur = Array.isArray(entry.roles[scope]) ? entry.roles[scope] : [];
    entry.roles[scope] = [...new Set([...cur, ...list])];
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) warn(`'${email}' does not look like an email address`);
  const plat = platform || hub.platform;
  if (plat && plat !== 'none') {
    const v = validateLogin(plat, login);
    if (v.checked && !v.exists) { warn(`'${login}' not found on ${plat} — saved as unverified`); entry.unverified = true; }
    else if (v.checked && v.exists) { ok(`verified ${login} on ${plat}`); delete entry.unverified; }
  }
  writeJSON(hubPath, hub);
  return { entry, created };
}

// Inverse of addRepoRoles: drop the named role(s) from a member's `roles[<repo>]` scope, removing the
// scope key when it empties. Member is found by yad `name` (matching addRepoRoles). Idempotent.
export function removeRepoRole(root, name, repo, roles = []) {
  const hubPath = path.join(root, PROJECT_FILES.hubConfig);
  const hub = readJSON(hubPath, null);
  if (!hub || !Array.isArray(hub.roster)) return;
  const entry = hub.roster.find((e) => e.name === name);
  if (!entry) { warn(`'${name}' is not in the roster — nothing to revoke for ${repo}`); return; }
  normalizeRoles(entry);
  const cur = Array.isArray(entry.roles[repo]) ? entry.roles[repo] : [];
  const next = cur.filter((r) => !roles.includes(r));
  if (next.length === cur.length) return; // nothing removed
  if (next.length) entry.roles[repo] = next; else delete entry.roles[repo];
  writeJSON(hubPath, hub);
}

// Keep repos.json `domain_owners` in sync when a domain-owner role is granted/revoked via the roster,
// so the gate's per-repo reviewer-routing and the derivation fallback never drift from hub.json. Adds
// or removes the yad `name` and mirrors `domain_owner = domain_owners[0]`. No-op + warn if the repo is
// not registered. Returns true when the registry was written.
export function setRepoDomainOwners(root, repo, name, { add = true } = {}) {
  const regPath = path.join(root, PROJECT_FILES.reposRegistry);
  const registry = readJSON(regPath, { repos: [] });
  const entry = (registry.repos || []).find((r) => r.name === repo);
  if (!entry) { warn(`repo '${repo}' is not registered (.sdlc/repos.json) — domain_owners not synced`); return false; }
  const owners = Array.isArray(entry.domain_owners) ? [...entry.domain_owners] : (entry.domain_owner ? [entry.domain_owner] : []);
  const has = owners.includes(name);
  let next;
  if (add) { if (has) return false; next = [...owners, name]; }
  else { if (!has) return false; next = owners.filter((o) => o !== name); }
  entry.domain_owners = next;
  entry.domain_owner = next[0] || '';
  writeJSON(regPath, registry);
  return true;
}

// Reconcile one repo's roles for a member to exactly `want`: grant what is new, revoke what is gone,
// and mirror domain-owner changes into repos.json. `current` is the member's existing roles for the
// repo. Shared by the `yad roster` walk and the `yad setup` per-repo role step. Idempotent.
export function reconcileRepoRoles(root, name, repo, current = [], want = []) {
  const toAdd = want.filter((r) => !current.includes(r));
  const toRemove = current.filter((r) => !want.includes(r));
  if (!toAdd.length && !toRemove.length) { info(`    ${repo}: unchanged`); return; }
  if (toAdd.length) addRepoRoles(root, repo, Object.fromEntries(toAdd.map((r) => [r, [name]])));
  if (toRemove.length) removeRepoRole(root, name, repo, toRemove);
  if (toAdd.includes('domain-owner')) setRepoDomainOwners(root, repo, name, { add: true });
  if (toRemove.includes('domain-owner')) setRepoDomainOwners(root, repo, name, { add: false });
  ok(`    ${repo}: ${want.length ? want.join(', ') : 'cleared'}`);
}

export function registerRepo(root, registry, { name, rpath, platform, domain_owner = '', domain_owners = null, default_branch = 'main', today = null, pack = true }) {
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
  // A repo can have multiple domain owners. `domain_owners` is the array of record; `domain_owner`
  // is kept as the first element so anything still reading the legacy single-owner field works.
  const owners = (domain_owners && domain_owners.length) ? domain_owners : (domain_owner ? [domain_owner] : []);
  const repo = {
    name, path: rpath, git_url: (remote.ok && remote.stdout) || null, platform: plat,
    domain_owner: owners[0] || '', domain_owners: owners, default_branch,
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

// Step 0 — resolve the setup profile that branches the rest of the wizard. Flags pre-answer each
// question (CI/scripts); an existing hub.json carries prior answers forward (idempotent re-run);
// otherwise we prompt with a default. Pure of side effects — it only reads. Returns
// { solo, team_size, codebase, repo_layout, configureTools }.
export async function resolveProfile(root, opts = {}) {
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig), null);
  const prev = (hub && hub.profile) || {};

  // 1. Solo or team (+ size). --solo / --team <n> win; else carry hub.solo forward; else ask.
  let solo, team_size;
  if (opts.solo) { solo = true; team_size = 1; }
  else if (opts.team != null) { team_size = Math.max(1, parseInt(opts.team, 10) || 1); solo = team_size <= 1; }
  else if (typeof hub?.solo === 'boolean') { solo = hub.solo; team_size = prev.team_size ?? (solo ? 1 : 2); }
  else {
    // Default from any existing roster: a hub already carrying reviewers is a team; otherwise solo.
    const rosterN = Array.isArray(hub?.roster) ? hub.roster.length : 0;
    solo = !(await ask('Solo or team?', rosterN > 1 ? 'team' : 'solo')).toLowerCase().startsWith('t');
    team_size = solo ? 1 : Math.max(2, parseInt(await ask('  how many team members?', String(rosterN || 2)), 10) || 2);
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
// the remaining steps — install, hub + roster, optional tools, repos, wiring — and persists the profile.
export async function runSetup(root, opts = {}) {
  log(c.bold(`\nSDLC Workflow setup  ${c.dim('v' + VERSION)}`));
  log(c.dim(`target: ${root}`));

  // 0. Profile interview — branch the wizard to the user's situation (solo/team, code, repo layout).
  const { solo, team_size, codebase, repo_layout, configureTools } = await resolveProfile(root, opts);
  // Steps: interview, preflight, install, hub, tools (1 if deferred else 3), repos, wire, coderabbit, done.
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
  S('Install the module (skills + _bmad registration)');
  guide([
    'Copies the yad-* skills into your AI tool(s) so they appear in Claude Code / agents / opencode.',
    'Enter the IDE folders to install into, comma-separated; default = whatever is already present.',
  ]);
  let ideTargets = opts.ideTargets;
  if (!ideTargets) {
    const present = ALL_IDES.filter((d) => exists(path.join(root, d)));
    const def = (present.length ? present : ['.claude']).join(',');
    const answer = await ask(`IDE targets to install ${c.dim('(comma-separated: ' + ALL_IDES.join(', ') + ')')}`, def);
    ideTargets = answer.split(',').map((s) => s.trim()).filter(Boolean);
  }
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

  // Detect hub platform + roster
  S(solo ? 'Hub platform (solo — no roster)' : 'Hub platform & reviewer roster');
  guide(solo
    ? [
      'Your hub is this repo on GitHub/GitLab (or none for a file-only gate).',
      'Solo: no roster needed — you review by merging your own PR (approval waived).',
    ]
    : [
      'Your hub is this repo on GitHub/GitLab; reviewers approve artifacts there.',
      `Add your ${team_size}-person roster: platform login → yad name → hub role (owner/reviewer).`,
      'An owner + 1 reviewer is required to pass a gate; skip now and add later with `yad roster add`.',
    ]);
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
    // Solo mode needs no roster — the lone developer is owner and reviewer-by-merge.
    if (!solo && await askYesNo('Add reviewers to the roster now?', true)) {
      for (;;) {
        const login = await ask('  reviewer platform login (blank to finish)', '');
        if (!login) break;
        const name = await ask('    yad name', login);
        const email = await ask('    commit email (committer→login lookup + verified-commits gate; blank to skip)', '');
        // Per-scope roles: capture the hub roles here; per-repo roles are added in step 7 when the
        // repo is connected. A person can hold several roles (owner reviewer) at once.
        const hubRoles = parseList(await ask('    hub roles (owner/reviewer, space-separated)', 'reviewer'));
        const entry = { login, name, ...(email ? { email } : {}), roles: { hub: hubRoles } };
        // Validate the login exists on the hub — warn-only (fail-open): a miss is flagged unverified
        // but still saved. `checked:false` (no CLI/auth) skips the check silently.
        if (platform !== 'none') {
          const v = validateLogin(platform, login);
          if (v.checked && !v.exists) { warn(`'${login}' not found on ${platform} — saved as unverified`); entry.unverified = true; }
          else if (v.checked && v.exists) ok(`verified ${login} on ${platform}`);
        }
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) warn(`'${email}' does not look like an email address`);
        roster.push(entry);
      }
    }
    const default_branch = platform === 'none' ? 'main' : await ask('Hub default branch', 'main');
    // `bridge_enabled` is the canonical flag (hub-config schema); keep the legacy `bridge` spelling
    // for anything that still reads it.
    const enabled = platform !== 'none';
    // Record git_url — doctor needs it to scope the auth probe (YAD-CFG-005) and the bridge/PR flow
    // needs it to open PRs. Derived from the origin remote already resolved above; null when local-only.
    const git_url = enabled ? ((remote.ok && remote.stdout.trim()) || null) : null;
    // Merge into the existing file, never clobber: roster + verified_authors are user-owned identity
    // data (the verified-commits gate's allowlist derives from them). A reconfigure that collects no
    // reviewers (e.g. solo mode skips the loop) must NOT blank a populated roster or drop verified_authors.
    // Read strict so a corrupt hub aborts here (YAD-STATE-001) rather than fail-open to `{}` and rewrite
    // the file with identity stripped — the same silent-loss hole, just triggered by a parse failure.
    const cur = readJSONStrict(hubPath, {}) || {};
    const next = buildReconfiguredHub(cur, {
      platform: enabled ? platform : null, git_url, bridge_enabled: enabled, bridge: enabled,
      default_branch, roster, solo, profile: { codebase, repo_layout, team_size },
    });
    if (!roster.length && Array.isArray(cur.roster) && cur.roster.length) {
      info(`kept existing roster (${cur.roster.length} member(s)) — reconfigure collected none`);
    }
    if (cur.verified_authors?.length) info(`preserved ${cur.verified_authors.length} verified_authors entry(ies)`);
    writeJSON(hubPath, next);
    ok(`wrote ${PROJECT_FILES.hubConfig} (${next.roster.length} reviewer(s)${solo ? ', solo mode' : ''})`);
  }
  // Persist the profile + solo flag even on the "keeping existing" path, so re-running setup with new
  // flags (e.g. `yad setup --solo`) updates the mode without a full reconfigure. Merge, never clobber.
  // Also backfill a missing git_url from origin here (idempotent repair for the doctor's YAD-CFG-005).
  if (exists(hubPath)) {
    // Strict read for the same reason as the reconfigure write above: a corrupt hub must abort, never
    // fail-open to `{}` and get rewritten with roster/verified_authors stripped on a plain re-run.
    const cur = readJSONStrict(hubPath, {}) || {};
    const backfillUrl = (cur.platform && !cur.git_url)
      ? ((run('git', ['remote', 'get-url', 'origin'], { cwd: root }).stdout || '').trim() || null)
      : null;
    if (cur.solo !== solo || JSON.stringify(cur.profile || {}) !== JSON.stringify({ codebase, repo_layout, team_size }) || backfillUrl) {
      writeJSON(hubPath, { ...cur, ...(backfillUrl ? { git_url: backfillUrl } : {}), solo, profile: { codebase, repo_layout, team_size } });
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
    S('Connect a testing tool (playwright / cypress / pytest / none)');
    guide([
      'Where yad-test-cases generates automation. playwright/cypress/pytest, or none for artifacts-only.',
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
      'One repo holds all the code; the contract lives in the hub and stories tag this single repo.',
      codebase === 'greenfield' ? 'Greenfield: no code yet — the repomix code-pack step is skipped.' : 'Brownfield: the repo is packed so the front phases see what already exists.',
    ]
    : [
      'Register each code repo the feature touches; stories get tagged with the repos that implement them.',
      'Per repo: name → path (inside this project) → platform → domain owner(s).',
      codebase === 'greenfield' ? 'Greenfield: no code yet — the repomix code-pack step is skipped.' : 'Brownfield: each repo is packed so the front phases see what already exists.',
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
      // Siblings of the hub are the common layout (project/{product,backend}) — `../backend` is valid.
      const rpath = await ask('    path (relative to project root, e.g. ../backend)', `demo-repos/${name}`);
      if (!insideWorkspace(root, rpath)) { warn(`${rpath} resolves outside the workspace (the project root's parent) — skipped`); continue; }
      const detected = run('git', ['remote', 'get-url', 'origin'], { cwd: path.resolve(root, rpath) });
      const platform = (await ask('    platform (github/gitlab)', detectPlatform(detected.ok ? detected.stdout : '') || 'github')).toLowerCase();
      // Domain owners route the per-repo review. Solo (no roster) and monorepo (one repo = one owner)
      // skip these prompts — there is no second person to route to.
      const domain_owners = solo || mono ? [] : parseList(await ask('    domain owner(s) (yad names, space-separated)', ''));
      const repoReviewers = solo || mono ? [] : parseList(await ask('    repo reviewer(s) (yad names, space-separated; blank to skip)', ''));
      const repoOwners = solo || mono ? [] : parseList(await ask('    repo owner(s) (yad names, space-separated; blank to skip)', ''));
      const default_branch = await ask('    default branch', 'main');
      const repo = registerRepo(root, registry, { name, rpath, platform, domain_owners, default_branch, today: opts.today ?? null, pack: !greenfield });
      if (!repo) continue;
      addRepoRoles(root, name, { 'domain-owner': domain_owners, reviewer: repoReviewers, owner: repoOwners });
      known.add(name);
      ok(`registered ${name}`);
      if (greenfield) info(`${name}: greenfield — skipped repomix pack (run \`yad repo refresh ${name}\` once it has code)`);
      else packRepo(root, repo);
      if (mono) { info('monorepo — one repo connected; stop here'); break; }
    }
  }

  // Assign/update roles for ALREADY-connected repos. Skipped in solo mode (no roster). The connect loop
  // above only prompts for repos you add now; this closes the gap so a member's role on a repo connected
  // in an earlier run can be set without reconnecting. Mirrors `yad roster` (repo-driven).
  const hub7 = readJSON(hubPath, null);
  if (!solo && registry.repos.length && hub7 && Array.isArray(hub7.roster) && hub7.roster.length
      && await askYesNo('Assign/update roles for connected repos?', false)) {
    for (const member of hub7.roster) {
      if (!(await askYesNo(`  edit ${member.name}'s repo roles?`, false))) continue;
      for (const repo of registry.repos) {
        const cur = rolesForScope(member, repo.name);
        if (!(await askYesNo(`    set ${member.name}'s role on ${repo.name}? (current: ${cur.length ? cur.join(', ') : 'none'})`, false))) continue;
        const input = await ask('      roles (domain-owner/reviewer/owner, space-separated; blank = clear)', cur.join(' '));
        const want = parseList(input).filter((x) => ['owner', 'reviewer', 'domain-owner'].includes(x));
        reconcileRepoRoles(root, member.name, repo.name, cur, want);
      }
    }
  }

  // Wire each connected repo + the hub itself
  S('Wire connected repos + the hub (CI gates, PR template, gate-sync)');
  guide(['Installs the CI safety gates, PR/MR template, and gate-sync — automatic, no input needed.']);
  if (registry.repos.length === 0) info('no repos to wire');
  for (const repo of registry.repos) {
    log(`  ${c.bold(repo.name)} ${c.dim(`(${repo.platform})`)}`);
    applyActions(repoActions(root, repo), { force: true });
    // Migrate pre-2.0 wired CI (marker-owned sdlc-*.yml -> yad-*.yml); a user-authored
    // same-named file is never touched.
    applyActions(legacyRepoActions(root, repo), { force: true });
  }
  // the hub: event-driven gate-sync CI, so platform approvals/merges drive `yad gate ci`
  const hubWiring = hubActions(root);
  if (hubWiring.length) {
    log(`  ${c.bold('hub')} ${c.dim('(gate-sync + verified-commits CI)')}`);
    applyActions(hubWiring, { force: true });
  }
  applyActions(legacyHubActions(root), { force: true });
  // author allowlists for the verified-commits gate (hub + every repo), from the roster emails
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
  if (codebase === 'brownfield' && registry.repos.length) {
    hand('capture what already exists first: run `yad-backfill`, then your first epic with `yad-epic`');
  } else {
    hand('author your first epic: run `yad-epic`');
  }
  hand('your single next action, anytime: `yad next`');
  if (!solo && !(readJSON(hubPath, null)?.roster || []).length) {
    hand('add reviewers when ready: `yad roster add <login>` (an owner + 1 reviewer passes a gate)');
  }
  log('');
  log(c.bold('Then — AI-only steps (run in Claude Code):'));
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

// The repomix pack is a large, regenerable artifact — the hub tracks the AI-authored code-map, not the
// pack. `yad repo refresh --push` relies on the pack being gitignored (repo-publish.mjs never stages it);
// this makes that assumption true in every hub, so a regenerated pack never strands as a dirty tree.
export const PACK_IGNORE_GLOB = '.sdlc/code-context/*/pack.md';

// The exact lines ensurePackIgnored appends — a comment pair + the glob. Kept as data (not inline
// strings) so the publish gate can verify a staged `.gitignore` change is ONLY this managed block and
// never sweep an unrelated user edit into the audit commit (repo-publish.mjs, invariant 1).
export const PACK_IGNORE_BLOCK = [
  '# Repomix code-context packs are large, regenerable artifacts (yad repo refresh) — the',
  '# tracked code-map.md is the reviewed AI output; the pack itself is never committed.',
  PACK_IGNORE_GLOB,
];

// Idempotently ensure the hub `.gitignore` ignores the repomix pack. No-op (returns false) if the line
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
  if (r.ok) { ok(`${repo.name}: cached ${repo.contextPack}`); hand(`${repo.name}: generate the code-map in Claude Code (yad-connect-repos)`); return true; }
  fail(`${repo.name}: repomix failed — ${r.stderr.split('\n')[0] || 'unknown error'}`);
  return false;
}
