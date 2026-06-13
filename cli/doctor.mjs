// `yad doctor` — environment + state health, the complement of `yad check` (file drift).
// Three sections: environment (tools on PATH, auth), project state (config files parse and
// point at real repos), epics (each ledger loads). Pure reporting: exit 1 on any FAIL,
// 0 with warnings. `--json` emits the checks for CI / bug reports.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, warn, fail, hand, run, has, exists, readJSON, readJSONStrict } from './lib.mjs';
import { VERSION, PROJECT_FILES } from './manifest.mjs';
import { loadLedger, epicRoot } from './epic-state.mjs';
import { gitHead } from './setup.mjs';
import { cliFor } from './platform.mjs';

const MIN_NODE = 18;

// Each check: { id, section, status: 'ok'|'warn'|'fail', message, hint? }
function check(checks, id, section, status, message, hint = '') {
  checks.push({ id, section, status, message, ...(hint ? { hint } : {}) });
}

export function envChecks(checks) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= MIN_NODE) check(checks, 'node', 'environment', 'ok', `node ${process.versions.node}`);
  else check(checks, 'node', 'environment', 'fail', `node ${process.versions.node} is below the supported range [YAD-ENV-003]`, `install Node.js >= ${MIN_NODE}`);

  if (has('git')) check(checks, 'git', 'environment', 'ok', 'git present');
  else check(checks, 'git', 'environment', 'fail', 'git not found on PATH [YAD-ENV-001]', 'install git — every yad command needs it');

  for (const tool of ['npx', 'bash']) {
    if (has(tool)) check(checks, tool, 'environment', 'ok', `${tool} present`);
    else check(checks, tool, 'environment', 'warn', `${tool} not found on PATH`, tool === 'npx' ? 'repomix packing will be skipped' : 'the check gates are bash scripts');
  }
}

export function projectChecks(checks, root) {
  const hubPath = path.join(root, PROJECT_FILES.hubConfig);
  const regPath = path.join(root, PROJECT_FILES.reposRegistry);
  const verPath = path.join(root, PROJECT_FILES.version);
  if (!exists(hubPath) && !exists(regPath) && !exists(verPath)) {
    check(checks, 'project', 'project', 'warn', 'no yad project here (.sdlc/ not initialised)', 'run `yad setup` to start one — environment checks above still apply');
    return null;
  }

  // version stamp
  const ver = readJSON(verPath, null);
  if (!ver) check(checks, 'cli-version', 'project', 'warn', `${PROJECT_FILES.version} missing or unreadable`, 'run `yad check --fix`');
  else if (ver.version !== VERSION) check(checks, 'cli-version', 'project', 'warn', `project stamped v${ver.version}, CLI is v${VERSION}`, 'run `yad update` to reconcile');
  else check(checks, 'cli-version', 'project', 'ok', `version stamp matches (v${VERSION})`);

  // hub.json: parse + shape
  let hub = null;
  if (!exists(hubPath)) {
    check(checks, 'hub', 'project', 'warn', `${PROJECT_FILES.hubConfig} absent — file-only gate`, 'run `yad setup` to configure a platform + roster');
  } else {
    let hubBroken = false;
    try {
      hub = readJSONStrict(hubPath, null);
    } catch (e) {
      hubBroken = true;
      check(checks, 'hub', 'project', 'fail', `${PROJECT_FILES.hubConfig} does not parse [${e.code || 'YAD-STATE-001'}]`, e.hint || 'fix the JSON or restore it from git');
    }
    if (hubBroken) { /* reported above */ }
    else if (typeof hub !== 'object' || Array.isArray(hub) || hub === null) check(checks, 'hub', 'project', 'fail', `${PROJECT_FILES.hubConfig} has the wrong shape [YAD-STATE-002]`, 'expected a JSON object');
    else if (![null, undefined, 'github', 'gitlab'].includes(hub.platform)) check(checks, 'hub', 'project', 'fail', `${PROJECT_FILES.hubConfig}: unknown platform '${hub.platform}' [YAD-CFG-001]`, 'expected github, gitlab, or null');
    // Mirror gate.mjs's roster shape check so doctor never reports "ok" on a hub the gate would reject.
    else if (hub.roster !== undefined && !Array.isArray(hub.roster)) check(checks, 'hub', 'project', 'fail', `${PROJECT_FILES.hubConfig}: \`roster\` must be an array [YAD-STATE-002]`, 'fix the file or re-run `yad setup`');
    else {
      check(checks, 'hub', 'project', 'ok', `hub: ${hub.platform || 'file-only'}, ${(hub.roster || []).length} reviewer(s)`);
      // platform CLI + auth (best-effort; auth probing is the user's own session)
      const cli = cliFor(hub.platform);
      if (cli) {
        if (!has(cli)) check(checks, 'platform-cli', 'project', 'warn', `${cli} not found on PATH [YAD-ENV-002]`, `install ${cli} — the gate degrades to file-only without it`);
        else if (!run(cli, ['auth', 'status']).ok) check(checks, 'platform-cli', 'project', 'warn', `${cli} present but not authenticated [YAD-ENV-002]`, `run \`${cli} auth login\``);
        else check(checks, 'platform-cli', 'project', 'ok', `${cli} present and authenticated`);
      }
    }
  }

  // repos.json: parse + every entry is a live git repo; staleness vs syncedHead
  let registry = { repos: [] };
  let regBroken = false;
  try {
    registry = readJSONStrict(regPath, { repos: [] });
  } catch (e) {
    regBroken = true;
    check(checks, 'repos', 'project', 'fail', `${PROJECT_FILES.reposRegistry} does not parse [${e.code || 'YAD-STATE-001'}]`, e.hint || 'fix the JSON or restore it from git');
  }
  if (regBroken) { /* reported above */ }
  else if (!Array.isArray(registry?.repos)) check(checks, 'repos', 'project', 'fail', `${PROJECT_FILES.reposRegistry} has the wrong shape [YAD-STATE-002]`, 'expected a `repos` array');
  else {
    for (const repo of registry.repos) {
      // A missing/empty path must NOT fall back to the project root (which is itself a git repo and
      // would read as "healthy") — an entry with no path is malformed.
      if (!repo.path) { check(checks, `repo:${repo.name || '(unnamed)'}`, 'project', 'fail', `${repo.name || '(unnamed)'}: no \`path\` in repos.json [YAD-STATE-003]`, 're-connect the repo (`yad setup`)'); continue; }
      const repoRoot = path.resolve(root, repo.path);
      if (!exists(repoRoot)) { check(checks, `repo:${repo.name}`, 'project', 'fail', `${repo.name}: path ${repo.path} does not exist [YAD-STATE-003]`, 'fix the path in repos.json or re-connect the repo'); continue; }
      const head = gitHead(repoRoot);
      if (!head) { check(checks, `repo:${repo.name}`, 'project', 'fail', `${repo.name}: ${repo.path} is not a git repository (or has no commits) [YAD-STATE-003]`, 'init/clone the repo, then re-connect it'); continue; }
      if (repo.syncedHead && head !== repo.syncedHead) check(checks, `repo:${repo.name}`, 'project', 'warn', `${repo.name}: code-context is stale (HEAD moved since last pack)`, 'run `yad repo refresh ' + repo.name + '`');
      else check(checks, `repo:${repo.name}`, 'project', 'ok', `${repo.name}: git repo, context fresh`);
    }
    if (!registry.repos.length) check(checks, 'repos', 'project', 'warn', 'no code repos registered', 'run `yad setup` to connect one');
  }
  return { hub, registry };
}

export function epicChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  for (const e of fs.readdirSync(epicsDir).sort()) {
    if (!fs.statSync(path.join(epicsDir, e)).isDirectory()) continue;
    try {
      const ledger = loadLedger(epicRoot(root, e));
      if (!ledger.state) check(checks, `epic:${e}`, 'epics', 'warn', `${e}: no state.json — epic not seeded`, 'author it via yad-epic, or remove the directory');
      else check(checks, `epic:${e}`, 'epics', 'ok', `${e}: currentStep ${ledger.state.currentStep}`);
    } catch (err) {
      check(checks, `epic:${e}`, 'epics', 'fail', `${e}: ${err.message} [${err.code || 'YAD-STATE-001'}]`, err.hint || 'fix the file or restore it from git');
    }
  }
}

export async function runDoctor(root, { json = false } = {}) {
  const checks = [];
  envChecks(checks);
  projectChecks(checks, root);
  epicChecks(checks, root);

  const failed = checks.filter((x) => x.status === 'fail');
  const warned = checks.filter((x) => x.status === 'warn');
  if (json) {
    log(JSON.stringify({ version: VERSION, ok: failed.length === 0, checks }, null, 2));
  } else {
    log(c.bold(`\nyad doctor  ${c.dim('v' + VERSION)}`));
    let section = '';
    for (const x of checks) {
      if (x.section !== section) { section = x.section; log(`\n  ${c.bold(section)}`); }
      ({ ok, warn, fail })[x.status](x.message);
      if (x.hint && x.status !== 'ok') hand(x.hint);
    }
    log('');
    if (failed.length) fail(`${failed.length} problem(s) found`);
    else if (warned.length) info(`healthy with ${warned.length} warning(s)`);
    else ok('all clear');
  }
  if (failed.length) process.exitCode = 1;
  return { ok: failed.length === 0, failed: failed.length, warned: warned.length, checks };
}
