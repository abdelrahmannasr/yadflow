// `yad doctor` — environment + state health, the complement of `yad check` (file drift).
// Five sections: environment (tools on PATH, auth), project state (config files parse and point at
// real repos), shape (what schemaVersion the files are on vs the engine), epics (each ledger loads),
// and threads (feature-thread lineage). Pure reporting: exit 1 on any FAIL, 0 with warnings.
// `--json` emits the checks for CI / bug reports.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, warn, fail, hand, run, has, exists, readJSON, readJSONStrict } from './lib.mjs';
import { VERSION, PROJECT_FILES, DESIGN_TOOLS, TESTING_TOOLS, LEARNING_TOOLS, HOOK_SETTINGS, HOOK_TOOL_MATCHER, isBridgeHub } from './manifest.mjs';
import { mergeHookSettings, hookMatcherFires, ideTargetsFor } from './plan.mjs';
import { planMigration } from './migrate.mjs';
import { loadLedger, epicRoot, isValidEpicId, epicLineage, resolveThread, stateInvariants, contractSurfaceHash, artifactHash } from './epic-state.mjs';
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

// Each check: { id, section, status: 'ok'|'warn'|'fail', message, hint?, …extra }
// `extra` carries structured detail for the `--json` consumer that would be unreadable in the prose
// line — e.g. the per-file shape table behind a one-sentence drift summary.
function check(checks, id, section, status, message, hint = '', extra = null) {
  checks.push({ id, section, status, message, ...(hint ? { hint } : {}), ...(extra || {}) });
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
  // The stamp is not only cosmetic: in bridge mode the wired gate-sync job resolves the yadflow it
  // RUNS from it — unless hub.json pins `gate_sync_version`, a YAD_VERSION variable overrides, or the
  // stamp is not an exact release of the current major (then the job skips it and floats). So a stale
  // stamp can mean CI is running an old gate; say so, or the warning reads as bookkeeping.
  else if (ver.version !== VERSION) check(checks, 'cli-version', 'project', 'warn', `project stamped v${ver.version}, CLI is v${VERSION} — this also drives the wired gate-sync pin`, 'run `yad update` to reconcile');
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

  // The harness ledger guard (#171). Only meaningful in bridge mode: there the ledger is CI-owned and
  // an agent's hand-edit is always rejected later by `ledger-guard`, so the local hook that refuses it
  // up front should be installed. Without the bridge the ledger is locally owned and the hand-edit the
  // authoring skills describe is correct — nothing to report, so the check is silent rather than `ok`.
  const hubForHooks = readJSON(hubPath, null);
  if (isBridgeHub(hubForHooks)) {
    const unwired = [];
    const broken = [];
    if (!exists(path.join(root, 'hooks', 'ledger-guard.sh'))) unwired.push('hooks/ledger-guard.sh');
    // The SAME target list `hookActions` wires — the persisted `ideTargets`, not "does the directory
    // exist". Keyed on the directory, a project whose targets are `['.agents']` but which also has a
    // stray `.claude/` would be told to run `yad check --fix` forever, while that command builds no
    // action for `.claude` and correctly reports "already up to date". Never name a remedy that
    // cannot reach the thing being reported.
    const unreadable = [];
    for (const ide of ideTargetsFor(root)) {
      const relDest = HOOK_SETTINGS[ide];
      if (!relDest) continue;
      const settingsPath = path.join(root, relDest);
      // A file that exists but does not parse is its OWN report. `readJSON` returns null for both
      // "absent" and "broken", and null merges as "not wired" — which would send the human to
      // `yad check --fix`, a command that (correctly) refuses to rewrite a settings file it cannot
      // parse. The warning would then repeat forever with advice that can never apply.
      // Read ONCE and reuse: parsing the same file twice lets `unreadable` and the merge check
      // describe different content if it changes in between.
      let settings = null;
      if (exists(settingsPath)) {
        let parsed;
        try { parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* reported below */ }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { unreadable.push(relDest); continue; }
        settings = parsed;
      }
      if (mergeHookSettings(settings).changed) { unwired.push(relDest); continue; }
      // Present is not the same as armed. The entry's matcher is the team's to narrow (the merge
      // deliberately leaves it alone), but one that no longer selects any file-editing tool means
      // nothing is intercepted — and reporting that as `ok` is how a disarmed guard passes for
      // healthy until a ledger edit fails in CI.
      if (!hookMatcherFires(settings)) broken.push(relDest);
    }
    if (unreadable.length) {
      check(checks, 'hooks', 'project', 'warn', `agent ledger guard cannot be wired — ${unreadable.join(', ')} does not parse [YAD-STATE-001]`,
        'fix the JSON by hand, then run `yad check --fix` — yad never rewrites a settings file it cannot parse, so nothing else can clear this');
    } else if (unwired.length) {
      check(checks, 'hooks', 'project', 'warn', `agent ledger guard not wired: ${unwired.join(', ')}`,
        'run `yad check --fix` — until then an agent can hand-edit the CI-owned ledger and only find out when the review PR/MR fails');
    } else if (broken.length) {
      check(checks, 'hooks', 'project', 'warn', `agent ledger guard installed but its matcher no longer selects file edits: ${broken.join(', ')}`,
        `restore the matcher to \`${HOOK_TOOL_MATCHER}\` — as it stands the hook is wired but never fires`);
    } else {
      check(checks, 'hooks', 'project', 'ok', 'agent ledger guard wired (hooks/ledger-guard.sh)');
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

// Is `.sdlc/contract-lock.json` still the hash of the surface it claims to lock? The lock is what the
// spec pins and what contract-check compares a code repo's slice against, but nothing ever verified it
// against the live contract.md — so a surface edited without a re-lock (or locked with a different
// recipe) read as "locked" while binding nothing. FAIL on a mismatch: a decorative lock is worse than
// none, because everyone downstream treats it as proof.
//
// Two shapes (yad-change references/triage.md): a SURFACE lock, verified against this epic's own
// contract.md, and a POINTER lock — a change-epic that inherited architecture, which carries no
// contract.md at all and instead copies the parent's hash verbatim. Its integrity property is that the
// copy still equals what the referenced lock holds, so verify it there.
function contractLockCheck(checks, root, epic, ledger) {
  const id = `epic:${epic}:contract-lock`;
  const lock = ledger.contractLock;
  const epicDir = epicRoot(root, epic);
  // An epic that has not reached the lock yet simply has no lock file — that is the normal pre-lock
  // state and stays silent. A lock file that EXISTS but carries no usable hash is the opposite: it is
  // the decorative lock this check was added to catch, so it must never read as "not locked yet".
  // `readJSONStrict` yields null both for an absent file and for one holding literal `null`, so ask the
  // filesystem — the second is a malformed lock, not a missing one.
  if (lock === null && !exists(ledger.files.contractLock)) return;
  const stored = typeof lock?.hash === 'string' && /^sha256:[0-9a-f]{64}$/.test(lock.hash) ? lock.hash : null;
  if (!stored) {
    check(checks, id, 'epics', 'fail',
      `${epic}: contract-lock.json exists but carries no usable sha256 hash`,
      're-lock the surface (yad-architecture Step 5) or delete the file — a lock nobody can verify is worse than none');
    return;
  }
  const short = (h) => `${h.slice(0, 19)}…`;

  if (lock.inheritedFrom || lock.ref) {
    // The ref is repo-controlled text, so keep it inside this hub's epics/ — a lock file must not be
    // able to point the check at arbitrary JSON elsewhere on disk.
    const epicsDir = path.join(root, 'epics');
    const refPath = path.resolve(path.join(epicDir, '.sdlc'), lock.ref || `../../${lock.inheritedFrom}/.sdlc/contract-lock.json`);
    if (refPath !== epicsDir && !refPath.startsWith(epicsDir + path.sep)) {
      check(checks, id, 'epics', 'fail',
        `${epic}: pointer-lock ref '${lock.ref}' resolves outside epics/`,
        'a pointer-lock must reference another epic in this hub — fix `ref` (yad-change writes ../../EP-<parent>/.sdlc/contract-lock.json)');
      return;
    }
    const parent = readJSON(refPath, null);
    if (!parent || typeof parent.hash !== 'string') {
      check(checks, id, 'epics', 'fail',
        `${epic}: pointer-lock references ${lock.inheritedFrom || lock.ref}, whose contract-lock.json is missing or has no hash`,
        're-thread the change-epic (yad-change) so it points at a real parent lock');
      return;
    }
    if (parent.hash !== stored) {
      check(checks, id, 'epics', 'fail',
        `${epic}: pointer-lock pins ${short(stored)} but ${lock.inheritedFrom || 'its parent'} now locks ${short(parent.hash)}`,
        'the inherited surface was re-locked upstream — re-copy the parent hash, or re-author architecture in this epic');
      return;
    }
    // A pointer-lock epic has no contract.md by construction (the surface physically cannot drift).
    // One that DOES have a contract.md is a change-epic that re-authored architecture but left the
    // inherited fields behind, so verify the live surface as well rather than trusting the pointer.
    if (!exists(path.join(epicDir, 'contract.md'))) {
      check(checks, id, 'epics', 'ok', `${epic}: pointer-lock matches ${lock.inheritedFrom || 'its parent'} (${short(stored)})`);
      return;
    }
    check(checks, `${id}:inherited`, 'epics', 'warn',
      `${epic}: lock is marked inherited from ${lock.inheritedFrom || lock.ref} but this epic has its own contract.md`,
      're-authored architecture? drop `inheritedFrom`/`ref` and re-lock against this epic\'s surface');
    // and fall through to verify the live surface too
  }

  if (!exists(path.join(epicDir, 'contract.md'))) {
    check(checks, id, 'epics', 'fail',
      `${epic}: contract-lock.json pins ${short(stored)} but there is no contract.md to lock`,
      'restore contract.md, or record the lock as inherited (`inheritedFrom` + `ref`) if this epic threads off a parent');
    return;
  }
  const current = contractSurfaceHash(epicDir);
  if (current === null) {
    check(checks, id, 'epics', 'fail',
      `${epic}: contract-lock.json pins ${short(stored)} but contract.md has no readable CONTRACT-SURFACE block`,
      'restore the BEGIN/END markers around the surface, then re-lock (see yad-architecture Step 5)');
    return;
  }
  if (current !== stored) {
    check(checks, id, 'epics', 'fail',
      `${epic}: contract surface drifted from its lock — contract.md hashes ${short(current)}, contract-lock.json pins ${short(stored)}`,
      'the surface changed without a re-lock: re-run the yad-architecture Step 5 recipe and re-open the architecture gate');
    return;
  }
  check(checks, id, 'epics', 'ok', `${epic}: contract surface matches its lock (${short(stored)})`);
}

// Two findings on a review step that is already `done`, both about the approval record behind it.
//
//   FAIL — it holds NO qualifying approval at all (outside solo mode). This is the state the gate
//   exists to prevent: the step advanced without the record that justifies it. `gatePredicate` counts
//   exactly the same thing (`status === 'approved'`, with `inherited`/`skipped` steps short-circuited
//   before it), so a step doctor reports here is one the gate itself would refuse today.
//
//   WARN — it holds approvals, but none still bind to the artifact as it stands. The gate is
//   deliberately one-way — nothing pulls a chain backward once work is built on it — so the only way
//   this surfaces is if something reports it. `gate sync` records the gap on the step it is syncing;
//   this reports it for the whole epic, so a re-locked surface that was never re-approved is visible
//   in the one command people run when something looks wrong. A warning, because the state is a fact
//   about history and the fix (re-open the review) is a human decision.
function staleGateCheck(checks, root, epic, ledger, { solo = false } = {}) {
  const epicDir = epicRoot(root, epic);
  for (const s of ledger.state.steps) {
    if (s.type !== 'review+approve' || s.status !== 'done' || s.inherited || s.skipped) continue;
    const forStep = ledger.approvals.filter((a) => a.step === s.id && a.status === 'approved');
    // Checked BEFORE the artifact hash below: "done holding no approval" is a claim about the ledger,
    // not about content, so it must not depend on there being something to hash. Gating it behind the
    // hash would keep hiding it on every epic with no locked surface.
    if (!forStep.length) {
      // Solo mode waives the approval requirement outright (you cannot approve your own PR) — the
      // merge + resolved threads are what advance the step, so an empty record is the documented
      // shape there, not a finding. Everywhere else it is the gate being silently defeated.
      if (solo) continue;
      const records = ledger.approvals.filter((a) => a.step === s.id).length;
      check(checks, `epic:${epic}:${s.id}:unapproved`, 'epics', 'fail',
        `${epic}: ${s.id} is done but holds no approval${records ? ` (${records} record(s), none of them live)` : ''}`,
        'the step advanced without the record the gate exists to keep — re-open the review (a fresh PR/MR) and re-approve, or run `yad gate sync` if the approvals are on the PR but never reached the ledger');
      continue;
    }
    const cur = artifactHash(epicDir, s.artifact);
    if (!cur) continue; // nothing to bind to (no locked surface / incomplete set) — not a staleness claim
    const live = forStep.filter((a) => !a.artifactHash || a.artifactHash === cur);
    if (live.length) continue;
    check(checks, `epic:${epic}:${s.id}:stale`, 'epics', 'warn',
      `${epic}: ${s.id} is done, but all ${forStep.length} approval(s) are bound to an older ${s.artifact}`,
      'the artifact changed after it was approved — re-open the review (a fresh PR/MR) so the record matches what shipped');
  }
}

export function epicChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  // Read once for the whole sweep: whether approval is waived is a project fact, not a per-epic one.
  const solo = isSolo(readJSON(path.join(root, PROJECT_FILES.hubConfig), null));
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
        contractLockCheck(checks, root, e, ledger);
        staleGateCheck(checks, root, e, ledger, { solo });
      }
    } catch (err) {
      check(checks, `epic:${e}`, 'epics', 'fail', `${e}: ${err.message} [${err.code || 'YAD-STATE-001'}]`, err.hint || 'fix the file or restore it from git');
    }
  }
}

// ---- file shape (schemaVersion) -------------------------------------------------------------
// What shape this project's files are in, against the shape this engine writes. The stamp itself is
// silent by design (cli/lib.mjs), and `yad migrate` only speaks when you run it — so without this
// section a project could sit a shape behind, or a shape ahead, with nothing ever saying so. Rule 6:
// the engine never goes quiet about what is unprotected.
//
// The reading comes from `planMigration`, the same function `yad migrate` previews with, so doctor and
// migrate can never disagree about what state a project is in or what would fix it.
//
// Three outcomes, and the middle one is the whole point:
//   ok    every file is on the engine's shape
//   warn  a file is BEHIND — `yad migrate` walks it forward, and the message says so
//   fail  a file is AHEAD — written by a newer yadflow than this one; migrating would downgrade it,
//         so the fix is to upgrade the CLI, not to touch the file
const scopeOf = (rel) => {
  const parts = rel.split(path.sep);
  return parts[0] === 'epics' && parts.length > 1 ? parts[1] : null;
};

function shapeCheckFor(checks, id, label, rows, engine) {
  // A file that does not parse has no shape to compare. It still gets said out loud here, because
  // nothing else in doctor reads these files — a corrupt change.json or build-log shard would
  // otherwise pass a clean health check while `yad migrate` refuses to touch the project over it.
  const unreadable = rows.filter((r) => r.from === null);
  if (unreadable.length) {
    check(checks, `${id}:unreadable`, 'shape', 'fail',
      `${label}: ${unreadable.length} state file(s) do not parse — ${unreadable.map((r) => r.file).join(', ')}`,
      'restore them from git — a broken state file blocks `yad migrate` and cannot be read by the gate');
  }

  const readable = rows.filter((r) => r.from !== null);
  if (!readable.length) return;
  const ahead = readable.filter((r) => r.action === 'ahead');
  // A file behind the engine on a VERIFIED hub is real drift, but `yad migrate` deliberately refuses
  // to touch it — CI is its only writer. Pointing at migrate there would send someone to a command
  // that changes nothing while the warning never clears, so those are counted and named separately.
  const behind = readable.filter((r) => r.from < engine && r.action !== 'ci-owned');
  const behindCi = readable.filter((r) => r.from < engine && r.action === 'ci-owned');
  // An object with no key yet is shape 1 by rule 1 — correct, not drifted. Read from the bytes
  // (`stamped`), not from `action`: that fires on any byte difference, a re-indent included.
  const unstamped = readable.filter((r) => !r.stamped).length;
  const shapes = [...new Set(readable.map((r) => r.from))].sort((a, b) => a - b);
  const on = shapes.length === 1 ? `shape ${shapes[0]}` : `shapes ${shapes.join(' and ')}`;
  const detail = { shape: { engine, files: readable.map((r) => ({ file: r.file, shape: r.from, stamped: !!r.stamped })) } };

  if (ahead.length) {
    check(checks, id, 'shape', 'fail',
      `${label} is on ${on}, the engine is on shape ${engine} — ${ahead.length} file(s) are newer than this yadflow`,
      'upgrade yadflow (`npm i -g yadflow@latest`) — migrating would move those files BACKWARD and lose what the newer version wrote',
      detail);
    return;
  }
  if (behind.length || behindCi.length) {
    const parts = [];
    if (behind.length) parts.push(`${behind.length} file(s) are behind`);
    if (behindCi.length) parts.push(`${behindCi.length} are CI-owned and behind`);
    check(checks, id, 'shape', 'warn',
      `${label} is on ${on}, the engine is on shape ${engine} — ${parts.join(', ')}`,
      behind.length
        ? 'run `yad migrate` to see what would change, then `yad migrate --apply` (each file is backed up first)'
        : 'nothing to run — in verified mode CI owns these files and moves them on its next gate sync',
      detail);
    return;
  }
  // The suggestion lives in the MESSAGE, not the hint: runDoctor prints hints only for warn/fail, so a
  // hint on a passing check would reach `--json` and never the person reading the terminal.
  check(checks, id, 'shape', 'ok',
    `${label} is on shape ${engine}, the engine is on shape ${engine}`
      + (unstamped ? ` (${unstamped} file(s) do not record it yet — counted as shape 1; \`yad migrate --apply\` writes it in)` : ''),
    '',
    detail);
}

// `plan` is injectable for the same reason `yad migrate` takes an injectable migration list: while the
// engine is on shape 1 nothing can be BEHIND it, so the warn branch — the one this section exists for —
// is unreachable from a real project until the first real shape change lands. Tests supply a plan that
// reaches it, which is how the drift report is proven before there is any drift to report.
export function shapeChecks(checks, root, { plan: injected = null } = {}) {
  if (!injected && !exists(path.join(root, PROJECT_FILES.hubConfig)) && !exists(path.join(root, PROJECT_FILES.version))) return;
  let plan = injected;
  if (!plan) {
    try {
      plan = planMigration(root);
    } catch (e) {
      // Say so rather than returning quietly. The failure modes here do not overlap with the other
      // sections — an unreadable shard DIRECTORY, say, throws while `loadLedger` never looks at it —
      // so a silent return would drop this whole section and let doctor print "all clear" over it.
      check(checks, 'shape', 'shape', 'warn',
        `could not read this project's file shapes: ${e.message}`,
        'fix the path in the message, then re-run — until then neither doctor nor `yad migrate` can tell you what shape this project is on');
      return;
    }
  }
  const { rows, engine } = plan;
  // A list ledger has no key to read and never will (rule 1's second half) — reporting it as a file
  // that "does not record its shape" would be a permanent nag about something that is already correct.
  const relevant = rows.filter((r) => r.action !== 'list');

  shapeCheckFor(checks, 'shape', 'this project', relevant.filter((r) => scopeOf(r.file) === null), engine);
  const epics = [...new Set(relevant.map((r) => scopeOf(r.file)).filter(Boolean))].sort();
  for (const e of epics) {
    shapeCheckFor(checks, `shape:${e}`, e, relevant.filter((r) => scopeOf(r.file) === e), engine);
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

// Run every check section and return the diagnostic object without printing. The shared core of
// `runDoctor`, and the same shape `--json` prints. Checks carry names and paths, so anything that
// leaves the machine must scrub them — `yad report` does NOT consume this; it builds its own
// allowlisted subset (cli/report.mjs `sanitizeContext`).
export function collectDoctor(root) {
  const checks = [];
  envChecks(checks);
  projectChecks(checks, root);
  shapeChecks(checks, root);
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
