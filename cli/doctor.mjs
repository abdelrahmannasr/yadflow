// `yad doctor` — environment + state health, the complement of `yad check` (file drift).
// Three sections: environment (tools on PATH, auth), project state (config files parse and
// point at real repos), epics (each ledger loads). Pure reporting: exit 1 on any FAIL,
// 0 with warnings. `--json` emits the checks for CI / bug reports.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, warn, fail, hand, run, has, exists, readJSON, readJSONStrict } from './lib.mjs';
import { VERSION, PROJECT_FILES, DESIGN_TOOLS, TESTING_TOOLS, LEARNING_TOOLS } from './manifest.mjs';
import { loadLedger, epicRoot, isValidEpicId, epicLineage, resolveThread, stateInvariants } from './epic-state.mjs';
import { loadDebt } from './thread.mjs';
import { gitHead, insideWorkspace } from './setup.mjs';
import { cliFor, validateLogin, hostFromGitUrl } from './platform.mjs';

const MIN_NODE = 18;

// Solo mode (a lone developer): approval waived, merge + resolved threads still gate. Persisted in
// hub.json. Mirrors gate.mjs / next.mjs.
const isSolo = (hub) => !!(hub && (hub.solo === true || hub.review_gate?.solo === true));
// owner/repo slug from a git url (https or ssh), for the branch-protection probe.
const repoSlug = (url) => ((url || '').match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/) || [])[1] || null;
// Is an already-resolved path nested under the project root? Repo paths are contained to the WORKSPACE
// (the root's parent, see setup.insideWorkspace), so a registered sibling resolves outside the root —
// which is what distinguishes "absent because it lives elsewhere" from "absent because it is broken".
// The path.sep suffix keeps /proj-evil from reading as inside /proj.
const underProjectRoot = (root, p) => {
  const projectRoot = path.resolve(root);
  return p === projectRoot || p.startsWith(projectRoot + path.sep);
};
// An absent path is only excused as "a sibling that lives elsewhere" when it is one the connect step
// would actually accept. A hand-edited registry pointing outside the workspace entirely (../../x) is
// corruption, and must not be reassured away as an expected sibling.
const isRegistrableSibling = (root, rpath) => insideWorkspace(root, rpath);

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
      if (isSolo(hub)) check(checks, 'solo', 'project', 'ok', 'mode: solo — approval waived; the PR merge + resolved threads gate the step');
      // platform CLI + auth (best-effort; auth probing is the user's own session)
      const cli = cliFor(hub.platform);
      if (cli) {
        // git_url is required whenever a platform is set — doctor needs it to scope the auth probe
        // and the bridge/PR flow needs it to open PRs. Warn on its absence directly (not on the
        // resolved host), so it fires even when an origin remote can substitute: the field itself
        // is required regardless.
        if (!hostFromGitUrl(hub.git_url)) {
          check(checks, 'hub-git-url', 'project', 'warn',
            `${PROJECT_FILES.hubConfig} sets platform '${hub.platform}' but has no git_url [YAD-CFG-005]`,
            'add git_url to hub.json (or re-run `yad setup`) — auth/PR checks need the hub host');
        }
        // Scope the auth probe to the hub's own host (derived from git_url, falling back to the
        // origin remote). `${cli} auth status` without --hostname exits non-zero when ANY configured
        // instance fails, so an unrelated stale login (e.g. a dead gitlab.com token) would falsely
        // flag a working self-hosted hub — so we SKIP the probe entirely when no host resolves
        // rather than run the flaky unscoped form.
        const host = hostFromGitUrl(hub.git_url)
          || hostFromGitUrl(run('git', ['remote', 'get-url', 'origin'], { cwd: root }).stdout);
        if (!has(cli)) check(checks, 'platform-cli', 'project', 'warn', `${cli} not found on PATH [YAD-ENV-002]`, `install ${cli} — the gate degrades to file-only without it`);
        else if (!host) check(checks, 'platform-cli', 'project', 'warn', 'auth check skipped — hub host unknown (no git_url / origin)', 'add git_url to hub.json so the auth probe can target the right host');
        else if (!run(cli, ['auth', 'status', '--hostname', host]).ok) check(checks, 'platform-cli', 'project', 'warn', `${cli} present but not authenticated for ${host} [YAD-ENV-002]`, `run \`${cli} auth login --hostname ${host}\``);
        else {
          check(checks, 'platform-cli', 'project', 'ok', `${cli} present and authenticated`);
          // Re-validate each roster login against the hub (warn-only). Skips when a login is already
          // flagged unverified by setup; reports any that no longer resolve.
          const bad = [];
          for (const e of hub.roster || []) {
            const v = validateLogin(hub.platform, e.login);
            if (v.checked && !v.exists) bad.push(e.login);
          }
          if (bad.length) check(checks, 'roster', 'project', 'warn', `roster login(s) not found on ${hub.platform}: ${bad.join(', ')}`, 'fix the login or re-run `yad setup` (they cannot satisfy a gate)');
          else check(checks, 'roster', 'project', 'ok', `roster: ${(hub.roster || []).length} member(s) validated on ${hub.platform}`);
          // GitLab API reachability: the gate reads MR state via `glab api …` (approvals, discussions).
          // A present+authenticated glab whose token lacks api scope would still break readPrGitLab, so
          // probe a cheap api call (warn-only) to surface it before a sync silently holds the gate.
          if (hub.platform === 'gitlab') {
            // Scope the probe to the hub's own host (like the auth check above) so a multi-instance
            // setup doesn't hit the wrong GitLab. `host` is guaranteed truthy here (we skip the whole
            // auth branch when it cannot be resolved), so the probe is always host-scoped.
            if (!run('glab', ['api', 'version', '--hostname', host]).ok) {
              check(checks, 'gitlab-api', 'project', 'warn', `glab is authenticated but \`glab api\` failed for ${host} [YAD-ENV-002]`, 'ensure the token has `api` scope — the gate reads MR approvals/discussions via the API');
            }
          }
          // Solo + GitHub: a branch that "requires approvals" would block the solo dev's own merge
          // (they can't approve their own PR). Best-effort probe; a 404 (no protection) is fine.
          if (isSolo(hub) && hub.platform === 'github') {
            const slug = repoSlug(hub.git_url) || repoSlug(run('git', ['remote', 'get-url', 'origin'], { cwd: root }).stdout);
            const br = hub.default_branch || 'main';
            if (slug) {
              const probe = run('gh', ['api', `repos/${slug}/branches/${br}/protection/required_pull_request_reviews`, '--jq', '.required_approving_review_count']);
              if (probe.ok && Number(probe.stdout) > 0) {
                check(checks, 'solo-branch-protection', 'project', 'warn', `solo mode but ${br} requires ${probe.stdout} approval(s) — you cannot approve your own PR, so the merge will be blocked`, `relax "Require approvals" in ${slug} branch protection for ${br}`);
              }
            }
          }
        }
      }
    }
  }

  // design.json: parse + shape + tool + MCP confirmation (absent is the normal markdown-only default —
  // pre-feature projects have none, so silence rather than warn when the file does not exist).
  const designPath = path.join(root, PROJECT_FILES.designConfig);
  if (exists(designPath)) {
    let design = null, designBroken = false;
    try {
      design = readJSONStrict(designPath, null);
    } catch (e) {
      designBroken = true;
      check(checks, 'design', 'project', 'fail', `${PROJECT_FILES.designConfig} does not parse [${e.code || 'YAD-STATE-001'}]`, e.hint || 'fix the JSON or restore it from git');
    }
    if (designBroken) { /* reported above */ }
    else if (typeof design !== 'object' || Array.isArray(design) || design === null) check(checks, 'design', 'project', 'fail', `${PROJECT_FILES.designConfig} has the wrong shape [YAD-STATE-002]`, 'expected a JSON object');
    else if (design.tool === 'none') check(checks, 'design', 'project', 'ok', 'design: markdown-only');
    else if (!DESIGN_TOOLS.includes(design.tool)) check(checks, 'design', 'project', 'fail', `${PROJECT_FILES.designConfig}: unknown or missing design tool '${design.tool}' [YAD-CFG-002]`, `expected one of ${DESIGN_TOOLS.join(', ')}, or none`);
    else if (design.source && design.source !== 'unavailable') check(checks, 'design', 'project', 'ok', `design: ${design.tool} (${design.source})`);
    else if (design.source === 'unavailable') check(checks, 'design', 'project', 'warn', `design: ${design.tool} MCP unavailable — yad-ui runs markdown-only`, 'connect the MCP, then run `yad-connect-design` (action: refresh)');
    else check(checks, 'design', 'project', 'warn', `design: ${design.tool} recorded but the MCP is not confirmed`, 'run `yad-connect-design` in Claude Code to detect the MCP');
  }

  // testing.json: parse + shape + tool + MCP confirmation (absent is the normal artifacts-only default —
  // pre-feature projects have none, so silence rather than warn when the file does not exist).
  const testingPath = path.join(root, PROJECT_FILES.testingConfig);
  if (exists(testingPath)) {
    let testing = null, testingBroken = false;
    try {
      testing = readJSONStrict(testingPath, null);
    } catch (e) {
      testingBroken = true;
      check(checks, 'testing', 'project', 'fail', `${PROJECT_FILES.testingConfig} does not parse [${e.code || 'YAD-STATE-001'}]`, e.hint || 'fix the JSON or restore it from git');
    }
    if (testingBroken) { /* reported above */ }
    else if (typeof testing !== 'object' || Array.isArray(testing) || testing === null) check(checks, 'testing', 'project', 'fail', `${PROJECT_FILES.testingConfig} has the wrong shape [YAD-STATE-002]`, 'expected a JSON object');
    else if (testing.tool === 'none') check(checks, 'testing', 'project', 'ok', 'testing: artifacts-only');
    else if (!TESTING_TOOLS.includes(testing.tool)) check(checks, 'testing', 'project', 'fail', `${PROJECT_FILES.testingConfig}: unknown or missing testing tool '${testing.tool}' [YAD-CFG-003]`, `expected one of ${TESTING_TOOLS.join(', ')}, or none`);
    else if (testing.source && testing.source !== 'unavailable') check(checks, 'testing', 'project', 'ok', `testing: ${testing.tool} (${testing.source})`);
    else if (testing.source === 'unavailable') check(checks, 'testing', 'project', 'warn', `testing: ${testing.tool} MCP unavailable — yad-test-cases runs artifacts-only`, 'connect the MCP, then run `yad-connect-testing` (action: refresh)');
    else check(checks, 'testing', 'project', 'warn', `testing: ${testing.tool} recorded but the MCP is not confirmed`, 'run `yad-connect-testing` in Claude Code to detect the MCP');
  }

  // learning.json: parse + shape + tool + CLI confirmation (absent is the normal harness-native default —
  // pre-feature projects have none, so silence rather than warn when the file does not exist). DeepTutor
  // has no MCP, so `source` is deeptutor-cli (found on PATH) or harness-native (degraded).
  const learningPath = path.join(root, PROJECT_FILES.learningConfig);
  if (exists(learningPath)) {
    let learning = null, learningBroken = false;
    try {
      learning = readJSONStrict(learningPath, null);
    } catch (e) {
      learningBroken = true;
      check(checks, 'learning', 'project', 'fail', `${PROJECT_FILES.learningConfig} does not parse [${e.code || 'YAD-STATE-001'}]`, e.hint || 'fix the JSON or restore it from git');
    }
    if (learningBroken) { /* reported above */ }
    else if (typeof learning !== 'object' || Array.isArray(learning) || learning === null) check(checks, 'learning', 'project', 'fail', `${PROJECT_FILES.learningConfig} has the wrong shape [YAD-STATE-002]`, 'expected a JSON object');
    else if (learning.tool === 'none') check(checks, 'learning', 'project', 'ok', 'learning: harness-native');
    else if (!LEARNING_TOOLS.includes(learning.tool)) check(checks, 'learning', 'project', 'fail', `${PROJECT_FILES.learningConfig}: unknown or missing learning tool '${learning.tool}' [YAD-CFG-004]`, `expected one of ${LEARNING_TOOLS.join(', ')}, or none`);
    else if (learning.source === 'deeptutor-cli') check(checks, 'learning', 'project', 'ok', `learning: ${learning.tool} (${learning.source})`);
    else if (learning.source === 'harness-native') check(checks, 'learning', 'project', 'warn', `learning: ${learning.tool} CLI unavailable — yad-learn tutors harness-native`, 'install the deeptutor CLI, then run `yad-connect-learning` (action: refresh)');
    else if (learning.source == null) check(checks, 'learning', 'project', 'warn', `learning: ${learning.tool} recorded but the CLI is not confirmed`, 'run `yad-connect-learning` in Claude Code to detect the CLI');
    else check(checks, 'learning', 'project', 'fail', `${PROJECT_FILES.learningConfig}: unknown source '${learning.source}' [YAD-STATE-002]`, 'expected deeptutor-cli, harness-native, or null');
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
      // A registered repo may be a SIBLING of the hub (`../backend`, the standard multi-repo layout).
      // Such a checkout is legitimately absent wherever only the hub is checked out — hub CI, a fresh
      // clone — so its absence is a warn, not corruption. A missing path INSIDE the project root is
      // still a hard fail: nothing but damage explains it.
      if (!exists(repoRoot)) {
        if (underProjectRoot(root, repoRoot) || !isRegistrableSibling(root, repo.path)) check(checks, `repo:${repo.name}`, 'project', 'fail', `${repo.name}: path ${repo.path} does not exist [YAD-STATE-003]`, 'fix the path in repos.json or re-connect the repo');
        else check(checks, `repo:${repo.name}`, 'project', 'warn', `${repo.name}: ${repo.path} is not present in this checkout (sibling repo, outside the hub)`, 'expected when only the hub is checked out; clone it alongside the hub to work on it here');
        continue;
      }
      const head = gitHead(repoRoot);
      if (!head) { check(checks, `repo:${repo.name}`, 'project', 'fail', `${repo.name}: ${repo.path} is not a git repository (or has no commits) [YAD-STATE-003]`, 'init/clone the repo, then re-connect it'); continue; }
      if (!repo.syncedHead) check(checks, `repo:${repo.name}`, 'project', 'warn', `${repo.name}: registered without a code-context pack (greenfield)`, 'run `yad repo refresh ' + repo.name + '` once it has code');
      else if (head !== repo.syncedHead) check(checks, `repo:${repo.name}`, 'project', 'warn', `${repo.name}: code-context is stale (HEAD moved since last pack)`, 'run `yad repo refresh ' + repo.name + '`');
      else check(checks, `repo:${repo.name}`, 'project', 'ok', `${repo.name}: git repo, context fresh`);
    }
    if (!registry.repos.length) check(checks, 'repos', 'project', 'warn', 'no code repos registered', 'run `yad setup` to connect one');
  }

  ciTagsChecks(checks, root, hub, registry);
  return { hub, registry };
}

// GitLab CI runner tags: the wired fragments run docker-image jobs. On instances whose runners are
// all tag-locked (run_untagged: false), an untagged image job matches no runner and sits `pending`
// forever — silently blocking the gates (issue #50). A current fragment carries
// `tags: [$YAD_RUNNER_TAGS]`; warn on any wired GitLab fragment that sets an `image:` but has no
// `tags:` (an old install, or one hand-reverted by a sync). Pure local read — no API calls.
export function ciTagsChecks(checks, root, hub, registry) {
  const untagged = (p) => {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      return /^\s*image:/m.test(txt) && !/^\s*tags:/m.test(txt);
    } catch { return false; } // absent fragment is not this check's concern
  };
  const fragments = [];
  if (hub?.platform === 'gitlab' && (hub.bridge_enabled === true || hub.bridge === true)) {
    fragments.push(
      { scope: 'hub', file: '.gitlab/ci/yad-gate-sync.yml', path: path.join(root, '.gitlab/ci/yad-gate-sync.yml') },
      { scope: 'hub', file: '.gitlab/ci/yad-verified-commits.yml', path: path.join(root, '.gitlab/ci/yad-verified-commits.yml') },
      { scope: 'hub', file: '.gitlab/ci/yad-hub-checks.yml', path: path.join(root, '.gitlab/ci/yad-hub-checks.yml') },
    );
  }
  for (const repo of registry?.repos || []) {
    if (repo.platform !== 'gitlab' || !repo.path) continue;
    fragments.push({ scope: repo.name, file: '.gitlab/ci/yad-checks.yml', path: path.join(path.resolve(root, repo.path), '.gitlab/ci/yad-checks.yml') });
  }
  for (const f of fragments) {
    if (untagged(f.path)) {
      check(checks, `ci-tags:${f.scope}`, 'project', 'warn',
        `${f.scope}: ${f.file} runs a docker job with no \`tags:\` [YAD-CI-001]`,
        'tag-locked runners (run_untagged: false) will strand it at `pending` — run `yad update`, then set the `YAD_RUNNER_TAGS` CI/CD variable');
    }
  }
}

export function epicChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  for (const e of fs.readdirSync(epicsDir).sort()) {
    if (!fs.statSync(path.join(epicsDir, e)).isDirectory()) continue;
    try {
      const ledger = loadLedger(epicRoot(root, e));
      if (!ledger.state) check(checks, `epic:${e}`, 'epics', 'warn', `${e}: no state.json — epic not seeded`, 'author it via yad-epic, or remove the directory');
      else {
        check(checks, `epic:${e}`, 'epics', 'ok', `${e}: currentStep ${ledger.state.currentStep}`);
        // Chain consistency: a passed review gate whose author step was never closed. currentStep alone
        // cannot see this, yet it blocks every later step (including the parallel test-cases track).
        for (const v of stateInvariants(ledger.state)) {
          check(checks, `epic:${e}:${v.authorStep}`, 'epics', 'fail',
            `${e}: ${v.message} [${v.code}]`,
            `run \`yad gate repair ${e}\` to close it`);
        }
        // Migration guard (pre-3.0 model): under the current model CI records the ledger on the
        // default branch only at merge (when the step is already done), and writes nothing during
        // review — so an OPEN (non-done) review PR recorded here means it was opened under an older
        // model. Merge/close it under the version that opened it before relying on the CI flow.
        const openPr = (ledger.hubPrs || []).find((p) => {
          const st = (ledger.state.steps.find((s) => s.id === p.step) || {}).status;
          return st && st !== 'done';
        });
        if (openPr) check(checks, `epic:${e}:migration`, 'epics', 'warn',
          `${e}: an open review PR (${openPr.artifact}${openPr.number ? ` #${openPr.number}` : ''}) is recorded on the default branch`,
          'opened under a pre-3.0 yadflow? merge/close it before continuing — CI now records the gate ledger on the default branch only at merge');
      }
    } catch (err) {
      check(checks, `epic:${e}`, 'epics', 'fail', `${e}: ${err.message} [${err.code || 'YAD-STATE-001'}]`, err.hint || 'fix the file or restore it from git');
    }
  }
}

// Phase 6 — feature-thread integrity. A change-epic must thread to a real parent and its denormalized
// `thread` cache must equal the computed root; an open hotfix reconcile-debt is a warn (the next change
// on that thread is blocked at the gate until it is paid). Pure reporting, like the other sections.
export function threadChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  for (const e of fs.readdirSync(epicsDir).sort()) {
    if (!fs.statSync(path.join(epicsDir, e)).isDirectory() || !isValidEpicId(e)) continue;
    if (!exists(path.join(epicsDir, e, 'epic.md'))) continue;
    const lin = epicLineage(root, e);
    if (lin.kind === 'feature' && !lin.parent) continue; // genesis with no lineage — nothing to check
    const { broken } = resolveThread(root, e);
    if (broken) {
      check(checks, `thread:${e}`, 'threads', 'fail', `${e}: ${broken}`,
        'a change-epic must thread to a real parent; fix `parent:`/`thread:` in epic.md frontmatter');
    } else {
      check(checks, `thread:${e}`, 'threads', 'ok', `${e}: ${lin.kind} threaded to ${lin.thread || lin.parent}`);
    }
    for (const d of loadDebt(root, e)) {
      if (d.status === 'open') {
        check(checks, `thread:${e}:debt`, 'threads', 'warn',
          `${e}: open reconcile debt (${d.reason || 'hotfix shipped first'})`,
          'pay it — update the artifacts + add a regression test; the next change on this thread is blocked until then');
      }
    }
  }
}

// Run every check section and return the diagnostic object without printing. This is the shared
// core of `runDoctor` — the reporter (cli/report.mjs) consumes it to derive a *scrubbed* safe
// subset (never the raw checks, which carry names + paths). Same shape `--json` prints.
export function collectDoctor(root) {
  const checks = [];
  envChecks(checks);
  projectChecks(checks, root);
  epicChecks(checks, root);
  threadChecks(checks, root);
  const failed = checks.filter((x) => x.status === 'fail');
  return { version: VERSION, ok: failed.length === 0, checks };
}

export async function runDoctor(root, { json = false } = {}) {
  const { checks } = collectDoctor(root);

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
