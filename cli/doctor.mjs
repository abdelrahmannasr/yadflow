// `yad doctor` — environment + state health, the complement of `yad check` (file drift).
// Five sections: environment (tools on PATH, auth), project state (config files parse and point at
// real repos), shape (what schemaVersion the files are on vs the engine), epics (each ledger loads),
// and threads (feature-thread lineage). Pure reporting: exit 1 on any FAIL, 0 with warnings.
// `--json` emits the checks for CI / bug reports.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, warn, fail, hand, run, has, exists, isPlainObject, readJSON, readJSONStrict } from './lib.mjs';
import { VERSION, MIRRORED_FILES, PROJECT_FILES, epicFiles, DESIGN_TOOLS, TESTING_TOOLS, LEARNING_TOOLS, HOOK_SETTINGS, HOOK_TOOL_MATCHER, isVerifiedLedger , productConfigPath, ADVANCE_FROM_AUTOMATION, DRIVER_FROM_ASSISTANCE } from './manifest.mjs';
import { mergeHookSettings, hookMatcherFires, ideTargetsFor } from './plan.mjs';
import { planMigration } from './migrate.mjs';
import { loadLedger, epicRoot, isValidEpicId, epicLineage, isGenesisType, readFrontmatter, resolveThread, stateInvariants, contractSurfaceHash, artifactHash, workItemType, WORK_ITEM_TYPES, themeOf, themeKey, stepPhase, stepDef, artifactBase, matchLifecycleProfile, lifecycleProfile, LIFECYCLE_PROFILES, SENTINELS, normalizeBindings } from './epic-state.mjs';
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
  const productPath = productConfigPath(root);
  const regPath = path.join(root, PROJECT_FILES.reposRegistry);
  const verPath = path.join(root, PROJECT_FILES.version);
  if (!exists(productPath) && !exists(regPath) && !exists(verPath)) {
    check(checks, 'project', 'project', 'warn', 'no yad project here (.sdlc/ not initialised)', 'run `yad setup` to start one — environment checks above still apply');
    return null;
  }

  // version stamp
  const ver = readJSON(verPath, null);
  if (!ver) check(checks, 'cli-version', 'project', 'warn', `${PROJECT_FILES.version} missing or unreadable`, 'run `yad check --fix`');
  // The stamp is not only cosmetic: in verified mode the wired gate-sync job resolves the yadflow it
  // RUNS from it — unless hub.json pins `gate_sync_version`, a YAD_VERSION variable overrides, or the
  // stamp is not an exact release of the current major (then the job skips it and floats). So a stale
  // stamp can mean CI is running an old gate; say so, or the warning reads as bookkeeping.
  else if (ver.version !== VERSION) check(checks, 'cli-version', 'project', 'warn', `project stamped v${ver.version}, CLI is v${VERSION} — this also drives the wired gate-sync pin`, 'run `yad update` to reconcile');
  else check(checks, 'cli-version', 'project', 'ok', `version stamp matches (v${VERSION})`);

  // hub.json: parse + shape
  let hub = null;
  if (!exists(productPath)) {
    check(checks, 'hub', 'project', 'warn', `${PROJECT_FILES.hubConfig} absent — local gate`, 'run `yad setup` to configure a platform + roster');
  } else {
    let hubBroken = false;
    try {
      hub = readJSONStrict(productPath, null);
    } catch (e) {
      hubBroken = true;
      check(checks, 'hub', 'project', 'fail', `${PROJECT_FILES.hubConfig} does not parse [${e.code || 'YAD-STATE-001'}]`, e.hint || 'fix the JSON or restore it from git');
    }
    if (hubBroken) { /* reported above */ }
    else if (typeof hub !== 'object' || Array.isArray(hub) || hub === null) check(checks, 'hub', 'project', 'fail', `${PROJECT_FILES.hubConfig} has the wrong shape [YAD-STATE-002]`, 'expected a JSON object');
    else if (![null, undefined, 'github', 'gitlab'].includes(hub.platform)) check(checks, 'hub', 'project', 'fail', `${PROJECT_FILES.hubConfig}: unknown platform '${hub.platform}' [YAD-CFG-001]`, 'expected github, gitlab, or null');
    // Mirror gate.mjs's roster shape check so doctor never reports "ok" on a Product the gate would reject.
    else if (hub.roster !== undefined && !Array.isArray(hub.roster)) check(checks, 'hub', 'project', 'fail', `${PROJECT_FILES.hubConfig}: \`roster\` must be an array [YAD-STATE-002]`, 'fix the file or re-run `yad setup`');
    else {
      check(checks, 'hub', 'project', 'ok', `hub: ${hub.platform || 'local'}, ${(hub.roster || []).length} reviewer(s)`);
      if (isSolo(hub)) check(checks, 'solo', 'project', 'ok', 'mode: solo — approval waived; the PR merge + resolved threads gate the step');
      // platform CLI + auth (best-effort; auth probing is the user's own session)
      const cli = cliFor(hub.platform);
      if (cli) {
        // git_url is required whenever a platform is set — doctor needs it to scope the auth probe
        // and the verified ledger/PR flow needs it to open PRs. Warn on its absence directly (not on the
        // resolved host), so it fires even when an origin remote can substitute: the field itself
        // is required regardless.
        if (!hostFromGitUrl(hub.git_url)) {
          check(checks, 'hub-git-url', 'project', 'warn',
            `${PROJECT_FILES.hubConfig} sets platform '${hub.platform}' but has no git_url [YAD-CFG-005]`,
            'add git_url to hub.json (or re-run `yad setup`) — auth/PR checks need the Product host');
        }
        // Scope the auth probe to the Product's own host (derived from git_url, falling back to the
        // origin remote). `${cli} auth status` without --hostname exits non-zero when ANY configured
        // instance fails, so an unrelated stale login (e.g. a dead gitlab.com token) would falsely
        // flag a working self-hosted Product — so we SKIP the probe entirely when no host resolves
        // rather than run the flaky unscoped form.
        const host = hostFromGitUrl(hub.git_url)
          || hostFromGitUrl(run('git', ['remote', 'get-url', 'origin'], { cwd: root }).stdout);
        if (!has(cli)) check(checks, 'platform-cli', 'project', 'warn', `${cli} not found on PATH [YAD-ENV-002]`, `install ${cli} — the gate degrades to local without it`);
        else if (!host) check(checks, 'platform-cli', 'project', 'warn', 'auth check skipped — hub host unknown (no git_url / origin)', 'add git_url to hub.json so the auth probe can target the right host');
        else if (!run(cli, ['auth', 'status', '--hostname', host]).ok) check(checks, 'platform-cli', 'project', 'warn', `${cli} present but not authenticated for ${host} [YAD-ENV-002]`, `run \`${cli} auth login --hostname ${host}\``);
        else {
          check(checks, 'platform-cli', 'project', 'ok', `${cli} present and authenticated`);
          // Re-validate each roster login against the Product (warn-only). Skips when a login is already
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
            // Scope the probe to the Product's own host (like the auth check above) so a multi-instance
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

  // The harness ledger guard (#171). Only meaningful in verified mode: there the ledger is CI-owned and
  // an agent's hand-edit is always rejected later by `ledger-guard`, so the local hook that refuses it
  // up front should be installed. With a local ledger nothing guards it, and the hand-edit the
  // authoring skills describe is correct — nothing to report, so the check is silent rather than `ok`.
  const hubForHooks = readJSON(productPath, null);
  if (isVerifiedLedger(hubForHooks)) {
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

  // skills.json: which skill runs which step, when the project does not want the engine's default.
  // Called from HERE rather than from `collectDoctor` beside the other E6 code so its findings land
  // inside the `project` block. The renderer prints a header every time the section CHANGES, so a
  // `project` check added after the `shape` section prints the word "project" a second time.
  skillBindingChecks(checks, root);

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
      // A registered repo may be a SIBLING of the Product (`../backend`, the standard multi-repo layout).
      // Such a checkout is legitimately absent wherever only the Product is checked out — Product CI, a fresh
      // clone — so its absence is a warn, not corruption. A missing path INSIDE the project root is
      // still a hard fail: nothing but damage explains it.
      if (!exists(repoRoot)) {
        if (underProjectRoot(root, repoRoot) || !isRegistrableSibling(root, repo.path)) check(checks, `repo:${repo.name}`, 'project', 'fail', `${repo.name}: path ${repo.path} does not exist [YAD-STATE-003]`, 'fix the path in repos.json or re-connect the repo');
        else check(checks, `repo:${repo.name}`, 'project', 'warn', `${repo.name}: ${repo.path} is not present in this checkout (sibling repo, outside the Product)`, 'expected when only the Product is checked out; clone it alongside the Product to work on it here');
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
  if (hub?.platform === 'gitlab' && isVerifiedLedger(hub)) {
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
    // The ref is repo-controlled text, so keep it inside this Product's epics/ — a lock file must not be
    // able to point the check at arbitrary JSON elsewhere on disk.
    const epicsDir = path.join(root, 'epics');
    const refPath = path.resolve(path.join(epicDir, '.sdlc'), lock.ref || `../../${lock.inheritedFrom}/.sdlc/contract-lock.json`);
    if (refPath !== epicsDir && !refPath.startsWith(epicsDir + path.sep)) {
      check(checks, id, 'epics', 'fail',
        `${epic}: pointer-lock ref '${lock.ref}' resolves outside epics/`,
        'a pointer-lock must reference another epic in this Product — fix `ref` (yad-change writes ../../EP-<parent>/.sdlc/contract-lock.json)');
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
  const solo = isSolo(readJSON(productConfigPath(root), null));
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
  // A file behind the engine on a VERIFIED Product is real drift, but `yad migrate` deliberately refuses
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
// A file that lives under two names must say the same thing under both. The engine writes them
// together, so they only drift when something outside the engine touched one — a person editing the
// name they happen to know, a script, a half-finished merge. The older name is the authoritative one
// this major, so a silent drift means the OTHER copy is being ignored, which is the kind of thing
// people lose an afternoon to. Say it out loud instead.
export function mirrorChecks(checks, root) {
  const pairs = [...MIRRORED_FILES.map(({ canonical, legacy }) => ({ canonical, legacy }))];
  // The per-epic PR ledger is renamed the same way, so it drifts the same way. It is not in
  // MIRRORED_FILES because that list is project-relative and this one exists once per epic.
  const epicsDir = path.join(root, 'epics');
  if (exists(epicsDir)) {
    for (const e of fs.readdirSync(epicsDir).sort()) {
      // `statSync` follows symlinks and throws on a dangling one, so guard the whole entry rather
      // than letting one broken link take the entire health check down.
      try {
        if (!fs.statSync(path.join(epicsDir, e)).isDirectory()) continue;
      } catch { continue; }
      const f = epicFiles(path.join('epics', e));
      pairs.push({ canonical: f.productPrs, legacy: f.hubPrs });
    }
  }
  for (const { canonical, legacy } of pairs) {
    const a = path.join(root, canonical);
    const b = path.join(root, legacy);
    // Only the settings file reaches this branch in practice: the per-epic PR ledgers are top-level
    // arrays, which carry no shape at all, so `shape >= 3` is never true for them. They can be
    // reported as DRIFTED (below) but never as half-made, and that is correct — their new name
    // appears when a gate command next writes them, not when the project migrates.
    //
    // One side missing is NORMAL before `yad migrate` — an un-migrated project has only the old name.
    // It is not normal once the file says shape 3, because from then on every save writes both. And
    // `writeMirrored` cannot repair it on its own: when the authoritative copy already matches, it
    // correctly does nothing, so a half-made pair stays half-made and silent.
    if (exists(a) !== exists(b)) {
      const present = exists(a) ? a : b;
      let shape;
      try { shape = JSON.parse(fs.readFileSync(present, 'utf8'))?.schemaVersion ?? 1; } catch { continue; }
      if (typeof shape === 'number' && shape >= 3) {
        check(
          checks, `mirror:${canonical}`, 'shape', 'warn',
          `${exists(a) ? legacy : canonical} is missing — it should exist beside ${path.relative(root, present)} on shape ${shape}`,
          'run `yad migrate --apply` — a missing partner counts as a change, so it writes the pair back into step',
        );
      }
      continue;
    }
    if (!exists(a)) continue;
    let same;
    try { same = fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8'); } catch { continue; }
    if (same) continue;
    check(
      checks, `mirror:${canonical}`, 'shape', 'warn',
      `${canonical} and ${legacy} do not match — ${legacy} is the one being read`,
      'they are two names for one file while the rename settles. Copy the one you meant to keep over the other, then re-run the command that writes it',
    );
  }
}

// The two dials are one setting under two spellings, exactly like the mirrored file names, so they
// drift the same way and are reported the same way. Two things can go wrong, and they need different
// answers:
//
//   DISAGREE  a step says `assistance: heavy` and `driver: human`. Somebody edited one spelling, or a
//             tool wrote one and a person wrote the other. The OLD name is the one that counts, and
//             `yad migrate` will not fix it — the step already has the new key, so the step is
//             skipped as done. Only a person can say which was meant.
//   A REVIEW STEP CLAIMING AUTO  `advance: auto` on a step a human must sign off. The rule that never
//             bends, and worth failing over rather than warning: it is the one dial value that can
//             let work past a person.
//
// Scoped to the per-step dials only. `trust-log.json` records what a dial WAS on a past run and is
// not a live setting, so a mismatch there is history, not drift.
export function dialChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  const disagree = [];
  const reviewAuto = [];
  const newOnly = [];

  const inspect = (rel, where, steps) => {
    if (!Array.isArray(steps)) return;
    for (const s of steps) {
      if (!isPlainObject(s)) continue;
      const at = `${rel}${where ? ` (${where})` : ''} step \`${s.id || '?'}\``;
      if (typeof s.assistance === 'string' && typeof s.driver === 'string'
          && DRIVER_FROM_ASSISTANCE[s.assistance] !== s.driver) {
        disagree.push(`${at}: \`assistance: ${s.assistance}\` but \`driver: ${s.driver}\``);
      }
      if (typeof s.automation === 'string' && typeof s.advance === 'string'
          && ADVANCE_FROM_AUTOMATION[s.automation] !== s.advance) {
        disagree.push(`${at}: \`automation: ${s.automation}\` but \`advance: ${s.advance}\``);
      }
      // A step holding ONLY the new name is the half-made pair, and it is silent from every other
      // direction: this CLI reads it fine, `yad migrate` only ever adds new-from-old so it can never
      // repair it, and an OLDER CLI finds no dial at all and falls back to `human_approve` — turning
      // a lane earned to auto back into a manual one with nothing to say why. That is the exact
      // failure the two-name window exists to prevent, so doctor has to be the one that sees it.
      if (typeof s.driver === 'string' && typeof s.assistance !== 'string') {
        newOnly.push(`${at}: \`driver\` with no \`assistance\``);
      }
      if (typeof s.advance === 'string' && typeof s.automation !== 'string') {
        newOnly.push(`${at}: \`advance\` with no \`automation\``);
      }
      const isReview = s.type === 'review+approve' || s.locked === true;
      if (isReview && (s.advance === 'auto' || s.automation === 'machine_advance')) {
        reviewAuto.push(at);
      }
    }
  };

  for (const e of fs.readdirSync(epicsDir).sort()) {
    try {
      if (!fs.statSync(path.join(epicsDir, e)).isDirectory()) continue;
    } catch { continue; }
    const f = epicFiles(path.join('epics', e));
    const state = readJSON(path.join(root, f.state), null);
    if (state) inspect(f.state, '', state.steps);
    const bsDir = path.join(root, f.buildStateDir);
    if (!exists(bsDir)) continue;
    let names;
    try { names = fs.readdirSync(bsDir).filter((n) => n.endsWith('.json')).sort(); } catch { continue; }
    for (const n of names) {
      const bs = readJSON(path.join(bsDir, n), null);
      if (!bs || typeof bs.repos !== 'object' || bs.repos === null) continue;
      for (const [repo, r] of Object.entries(bs.repos)) inspect(`${f.buildStateDir}/${n}`, repo, r?.steps);
    }
  }

  if (reviewAuto.length) {
    check(
      checks, 'dials:review-auto', 'shape', 'fail',
      `a review step is set to advance on its own: ${reviewAuto.slice(0, 3).join('; ')}${reviewAuto.length > 3 ? ` (+${reviewAuto.length - 3} more)` : ''}`,
      'a review gate can never be `auto` — set it back to `advance: human` (`automation: human_approve`). `yad migrate` never writes this value; something else did',
    );
  }
  if (newOnly.length) {
    check(
      checks, 'dials:new-only', 'shape', 'warn',
      `${newOnly.length} step(s) carry only the new dial name: ${newOnly.slice(0, 2).join('; ')}${newOnly.length > 2 ? ` (+${newOnly.length - 2} more)` : ''}`,
      'add the older name beside it (`driver` needs `assistance`, `advance` needs `automation`) — an older yadflow reads only the old one and would see no dial at all. `yad migrate` cannot repair this: it only ever adds the new name from the old',
    );
  }
  if (disagree.length) {
    check(
      checks, 'dials:disagree', 'shape', 'warn',
      `${disagree.length} step(s) carry two different dial values: ${disagree.slice(0, 2).join('; ')}${disagree.length > 2 ? ` (+${disagree.length - 2} more)` : ''}`,
      'the OLD name (`assistance`/`automation`) is the one being read. Set both to the value you meant — `yad migrate` skips a step that already has the new key, so it cannot decide this for you',
    );
  }
}

// The work-item type, mid-rename. Shape 5 writes `type:` beside `kind:` in `epic.md` and copies the
// value into `state.json`; `kind:` is still the name that is READ. Four things can go wrong while two
// names are alive, and only one of them is a failure:
//
//   A GATE THAT CANNOT SEE THE TYPE   `type:` alone, with no `kind:`, on a change/defect/hotfix.
//             `templates/checks/lineage-check.sh` runs inside the user's repository and is refreshed
//             by `yad update`, which is a separate act from `yad migrate` with no ordering between
//             them — so a repo that migrated but did not update has a copy that reads only `kind:`.
//             It finds none, defaults to `feature`, decides the epic is a parent-free genesis, and
//             stops asking it for its parent. A lineage gate silently disarmed by an upgrade is worth
//             failing over; everything else here is drift a person can take their time with.
//   ONLY THE NEW NAME, on a genesis type. The same half-made pair with nothing at stake — `feature`
//             is what an older reader defaults to anyway.
//   TWO DIFFERENT VALUES   `kind:` and `type:` disagree. The OLD one is being read, and `yad migrate`
//             skips an epic that already has the new key, so only a person can say which was meant.
//   A LEDGER THAT DISAGREES WITH THE EPIC   `state.json` records a `type` that is not what `epic.md`
//             says. The epic.md value is the one the engine reads, so this is a stale copy.
//   A TYPE NOBODY DEFINED   a value outside the five. It reads as a non-genesis type, so the lineage
//             gate gets stricter rather than looser — a warning, not a failure.
//
// `state.json`'s own top-level `kind` is NOT looked at here. That is the `stub` / `discovery`
// lifecycle marker, a different axis, and a stub legitimately carries both at once.
export function typeChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  const gateBlind = [];
  const newOnly = [];
  const disagree = [];
  const ledger = [];
  const unknown = [];

  for (const e of fs.readdirSync(epicsDir).sort()) {
    if (!isValidEpicId(e)) continue;
    const md = path.join(epicsDir, e, 'epic.md');
    if (!exists(md)) continue; // no epic.md — EP-discovery, not a work item on the ladder
    const fm = readFrontmatter(md);
    const hasOld = typeof fm.kind === 'string' && fm.kind;
    const hasNew = typeof fm.type === 'string' && fm.type;
    const resolved = workItemType(fm);

    if (hasNew && !hasOld) {
      if (isGenesisType(fm.type)) newOnly.push(`${e}: \`type: ${fm.type}\` with no \`kind:\``);
      else gateBlind.push(`${e}: \`type: ${fm.type}\` with no \`kind:\``);
    }
    if (hasOld && hasNew && fm.kind !== fm.type) {
      disagree.push(`${e}: \`kind: ${fm.kind}\` but \`type: ${fm.type}\``);
    }
    if (!WORK_ITEM_TYPES.includes(resolved)) unknown.push(`${e}: \`${resolved}\``);

    const state = readJSON(path.join(epicsDir, e, '.sdlc', 'state.json'), null);
    if (isPlainObject(state) && typeof state.type === 'string' && state.type !== resolved) {
      ledger.push(`${e}: epic.md says \`${resolved}\`, state.json says \`${state.type}\``);
    }
  }

  const some = (list, n) => `${list.slice(0, n).join('; ')}${list.length > n ? ` (+${list.length - n} more)` : ''}`;
  if (gateBlind.length) {
    check(
      checks, 'type:gate-blind', 'shape', 'fail',
      `${gateBlind.length} epic(s) record a type only the newest yadflow can see: ${some(gateBlind, 3)}`,
      'add `kind:` beside `type:` in epic.md. `lineage-check.sh` inside your repo reads `kind:` and, finding none, treats the epic as a parent-free genesis — so it stops requiring the `parent:` a change/defect/hotfix must have. Run `yad update` to refresh the check gates too',
    );
  }
  if (newOnly.length) {
    check(
      checks, 'type:new-only', 'shape', 'warn',
      `${newOnly.length} epic(s) carry only the new name: ${some(newOnly, 2)}`,
      'add `kind:` beside `type:` — it is still the name every other reader uses. Nothing can do it for you: `yad migrate` never writes `epic.md` at all',
    );
  }
  if (disagree.length) {
    check(
      checks, 'type:disagree', 'shape', 'warn',
      `${disagree.length} epic(s) name two different types: ${some(disagree, 2)}`,
      'the OLD name (`kind:`) is the one being read. Set both to the type you meant',
    );
  }
  if (ledger.length) {
    check(
      checks, 'type:ledger', 'shape', 'warn',
      `${ledger.length} epic ledger(s) disagree with their epic.md: ${some(ledger, 2)}`,
      'epic.md is where the type is authored and is what the engine reads. Correct `type` in `.sdlc/state.json`, or fix epic.md if the ledger was right',
    );
  }
  if (unknown.length) {
    check(
      checks, 'type:unknown', 'shape', 'warn',
      `${unknown.length} epic(s) use a type nobody defined: ${some(unknown, 3)}`,
      `a work item is one of ${WORK_ITEM_TYPES.join(' · ')}. An unrecognised value reads as a non-genesis type, so the lineage gate will demand a \`parent:\` for it`,
    );
  }
}

// The grouping theme (E31) — a free tag on `epic.md` that puts several epics under one heading. It is
// deliberately unvalidated: there is no list of allowed themes, and having none is normal. So there is
// nothing here to check about a SINGLE epic. Both reports below are about the tag failing at the one
// job it has, which is putting epics together.
//
// Reported in the `shape` section beside the type and phase checks: those three are the engine's own
// vocabulary, and the golden test freezes the `epics` and `threads` sections against exactly this kind
// of addition (rule 6).
export function themeChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  const spellings = new Map();   // folded key -> the distinct spellings seen, in first-seen order
  const unreadable = [];
  const commented = [];

  for (const e of fs.readdirSync(epicsDir).sort()) {
    if (!isValidEpicId(e)) continue;
    const md = path.join(epicsDir, e, 'epic.md');
    if (!exists(md)) continue;   // no epic.md — EP-discovery, not a work item on the ladder
    const fm = readFrontmatter(md);
    // `readFrontmatter` turns `theme: [a, b]` into an array, and a theme is ONE tag. Left alone the
    // value would simply read as absent, so the epic would drop out of every grouping in silence.
    // An EMPTY list is not this — `theme: []` plainly says "no theme", and so does a blank `theme:`,
    // which is what the skill templates ship.
    if (Array.isArray(fm.theme)) {
      if (fm.theme.length) unreadable.push(`${e}: \`theme: [${fm.theme.join(', ')}]\``);
      continue;
    }
    const t = themeOf(fm);
    if (!t) continue;
    // A `#` inside the tag is almost always the comment trap: neither `readFrontmatter` nor the check
    // gates' `fm_val` strips a trailing `# …`, so it lands in the value. The tag IS read — it is not
    // unreadable — but it now includes the note, so it groups only with epics carrying that exact
    // text. Reported on its own rather than as a spelling variant, which would be true of
    // `#checkout-revamp` beside `checkout-revamp` while naming the wrong problem.
    if (t.includes('#')) { commented.push(`${e}: \`theme: ${t}\``); continue; }
    const key = themeKey(t);
    // Nothing left after the fold — a tag of pure punctuation or symbols, like `🎯`. Nothing is wrong
    // with it: it reads, and two epics carrying it group by being the same string. It is only left OUT
    // of the variant report, which has nothing to compare. Keeping it IN would be the bug: every such
    // tag folds to the same empty key, so `🎯` and `···` would be reported as one theme spelled two
    // ways — which is exactly backwards.
    if (!key) continue;
    const seen = spellings.get(key) || [];
    if (!seen.includes(t)) seen.push(t);
    spellings.set(key, seen);
  }

  const variants = [...spellings.values()].filter((v) => v.length > 1);
  const some = (list, n) => `${list.slice(0, n).join('; ')}${list.length > n ? ` (+${list.length - n} more)` : ''}`;
  if (variants.length) {
    check(
      checks, 'theme:variants', 'shape', 'warn',
      `${variants.length} grouping theme(s) are spelled more than one way: ${some(variants.map((v) => v.map((x) => `\`${x}\``).join(' / ')), 2)}`,
      'these are one theme typed differently, and they group as two. Pick one spelling and use it in every `epic.md` that belongs to the group',
    );
  }
  if (unreadable.length) {
    check(
      checks, 'theme:unreadable', 'shape', 'warn',
      `${unreadable.length} epic(s) have a \`theme:\` nothing can read: ${some(unreadable, 3)}`,
      'a theme is ONE free tag — a word or short phrase, in any language. A list is read as no theme at all, so the epic drops out of every grouping',
    );
  }
  if (commented.length) {
    check(
      checks, 'theme:commented', 'shape', 'warn',
      `${commented.length} epic(s) have a \`#\` inside the theme itself: ${some(commented, 3)}`,
      'these frontmatter readers keep the whole rest of the line, so a `#` and everything after it becomes part of the tag — the epic then groups only with epics carrying that exact text. Write the tag bare. `yad next` and `yad thread` print a `#` in front of it, but that is decoration on the screen, not part of the value',
    );
  }
}

// A project's chain against the step catalogue (E4). `phaseChecks` below asks whether a step id is
// KNOWN; this asks whether a known step is set up the way the catalogue says it is.
//
// IT REPORTS AND CHANGES NOTHING, and when the two disagree THE FILE WINS for this whole major
// (rule 3). `yad epic new` seeds from the catalogue and three of the five authoring skills now call
// it, so a fresh epic on those routes cannot disagree with it by accident — but `yad-discovery` and
// `yad-change` still write their own, a chain may legitimately leave a step out (not every epic has a
// `ui-design`), and a project may hold a chain from a newer yadflow. So a mismatch is a warning about a file somebody should look at, never
// a rewrite — the same discipline as `workItemType`.
//
// Nothing here reports a step that is ABSENT from a chain. Skipping `ui-design` on an epic with no
// screens is a normal thing to do, and a check that nagged about it would train people to ignore the
// section that also carries the two below, which are real breakage.
export function catalogueChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  const wrongArtifact = [];
  const noArtifact = [];
  const wrongKind = [];
  const orphanGate = [];
  const offRoute = [];

  for (const e of fs.readdirSync(epicsDir).sort()) {
    if (!isValidEpicId(e)) continue;
    const state = readJSON(path.join(epicsDir, e, '.sdlc', 'state.json'), null);
    if (!isPlainObject(state) || !Array.isArray(state.steps)) continue;
    const present = new Set(state.steps.map((s) => s?.id).filter((x) => typeof x === 'string'));

    // Which lifecycle profile is this epic walking? Worked out from the CHAIN, not from the `profile`
    // key shape 6 records — the key says which route the epic was started on, and this is about the
    // steps as they stand. (`profileChecks` below is what compares the two.) A chain matching NO
    // profile carries a step no route has, or has them out of order, and `yad next` walks a chain in
    // array order: the step it names next is then whatever happens to sit there, not the step that
    // comes next in any route.
    if (state.steps.length && !matchLifecycleProfile(state.steps)) {
      const known = state.steps.filter((x) => stepDef(x?.id));
      // Only reported when every step is one the catalogue knows. An id from a newer release is
      // `phase:unknown`'s business, and a chain full of them would otherwise be reported twice.
      if (known.length === state.steps.length) {
        offRoute.push(`${e}: \`${state.steps.map((x) => x.id).join(' → ')}\``);
      }
    }

    for (const step of state.steps) {
      const def = step && typeof step.id === 'string' ? stepDef(step.id) : null;
      if (!def) continue;   // unknown id — `phase:unknown` below is the check for that
      // ONLY THE ARTIFACT COMPARISON skips a Build id, and only because there is nothing to compare:
      // Build runs per story per code repo out of `build-state/`, so those catalogue rows carry no
      // epic-level artifact. The two checks below still run on a Build id in an epic chain, which is
      // right — `implement` written as a `review+approve` step is wrong wherever it appears.
      //
      // The artifact is what the gate HASHES. A chain naming a different one binds the approval to
      // the wrong file, so the gate can pass while the artifact everybody reviewed sits unapproved.
      //
      // Compared through `artifactBase`, which is how every consumer reads this field
      // (`findReviewStep`, `artifactHash`, `yad gate`). It maps `stories`, `stories/`, `stories.md`
      // and `stories/EP-x-S01.md` all to one gate, so those spellings differ on paper and are the
      // same artifact in fact. Comparing the raw strings would warn that a chain which gates, hashes
      // and approves perfectly is bound to the wrong file — a false statement, and the kind that
      // teaches people to stop reading warnings.
      if (def.artifact && typeof step.artifact === 'string' && step.artifact
          && artifactBase(step.artifact) !== artifactBase(def.artifact)) {
        wrongArtifact.push(`${e} \`${step.id}\`: \`${step.artifact}\`, catalogue says \`${def.artifact}\``);
      }
      // A Shape step with NO artifact at all is the one shape that crashes rather than misfires:
      // `artifactBase(undefined)` throws, so `yad gate` on such a chain dies with an unhandled
      // TypeError instead of a message. Reported here because this is where the catalogue knows the
      // step should have named a file.
      if (def.artifact && (step.artifact === undefined || step.artifact === null || step.artifact === '')) {
        noArtifact.push(`${e} \`${step.id}\` (should be \`${def.artifact}\`)`);
      }
      // `type` in the file is `author` or `review+approve`; the catalogue calls the second one
      // `review`. A step on the wrong side of that line is not driven by what drives it: an author
      // step written as a gate is never closed by `yad gate`, and a gate written as an author step is
      // handed to a skill that has no artifact to write.
      const fileKind = step.type === 'review+approve' ? 'review' : step.type === 'author' ? 'author' : null;
      if (fileKind && fileKind !== def.kind) {
        wrongKind.push(`${e} \`${step.id}\`: \`${step.type}\`, catalogue says \`${def.kind}\``);
      }
      // A gate whose author step is not in the chain has nothing to review. Note what this does NOT
      // do: it does not block the steps after it. `preconditionsMet` only requires the steps BEFORE
      // one in the array to be done, and an absent step is in no such position — that is the
      // different problem of an author step present and stranded (issue #131), which
      // `stateInvariants` already reports.
      if (def.reviews && !present.has(def.reviews)) {
        orphanGate.push(`${e} \`${step.id}\` reviews \`${def.reviews}\`, which is not in the chain`);
      }
    }
  }

  const some = (list, n) => `${list.slice(0, n).join('; ')}${list.length > n ? ` (+${list.length - n} more)` : ''}`;
  if (offRoute.length) {
    const routes = LIFECYCLE_PROFILES.map((p) => `\`${p.id}\` (${p.title})`).join(' · ');
    check(
      checks, 'step:off-route', 'shape', 'warn',
      `${offRoute.length} epic(s) walk a chain that matches no lifecycle profile: ${some(offRoute, 2)}`,
      `a profile is the route an epic takes through the steps — ${routes}. Leaving a step OUT is fine; a step no route has, or two in the wrong order, is not: \`yad next\` reads the chain in the order it is written, so it will name whatever sits next rather than what comes next. In \`.sdlc/state.json\`, put the steps back in a route's order — and REMOVE any step no route has, which reordering cannot fix. A Build step (\`spec\`, \`tasks\`, \`implement\`, \`checks\`, \`engineer-review\`) is one of those: Build runs per story per repo out of \`build-state/\`, so it belongs in no epic chain`,
    );
  }
  if (wrongArtifact.length) {
    check(
      checks, 'step:artifact', 'shape', 'warn',
      `${wrongArtifact.length} step(s) name an artifact the catalogue does not: ${some(wrongArtifact, 3)}`,
      'the artifact is the file the review gate hashes, so a wrong one binds the approval to the wrong file. Correct `artifact` in `.sdlc/state.json`, or leave it if this project deliberately runs a different chain — nothing is rewritten either way',
    );
  }
  if (noArtifact.length) {
    check(
      checks, 'step:no-artifact', 'shape', 'warn',
      `${noArtifact.length} step(s) name no artifact at all: ${some(noArtifact, 3)}`,
      'the gate reads this field to know what to hash, and a missing one is not treated as "nothing" — `yad gate` stops with an unhandled error on this epic. Add `artifact` to the step in `.sdlc/state.json`',
    );
  }
  if (wrongKind.length) {
    check(
      checks, 'step:kind', 'shape', 'warn',
      `${wrongKind.length} step(s) are the wrong kind of step: ${some(wrongKind, 3)}`,
      'an author step is run by a skill and a `review+approve` step by `yad gate`. On the wrong side of that line the step is never driven by the thing that drives it',
    );
  }
  if (orphanGate.length) {
    check(
      checks, 'step:orphan-gate', 'shape', 'warn',
      `${orphanGate.length} review gate(s) review a step that is not there: ${some(orphanGate, 3)}`,
      'nothing in this chain tells anyone to write the artifact the gate reviews, and for a directory artifact the hash comes back empty, so the gate has nothing to bind an approval to. Add the author step, or drop the gate if this chain deliberately inherits that artifact from its parent epic',
    );
  }
}

// The lifecycle profile an epic RECORDS (E17, shape 6) against the chain it actually walks.
//
// Before shape 6 the route was only ever derived, so it could not be wrong — it was whatever the chain
// said. Now `state.json` names it, and a name can go stale: someone edits the chain by hand, or copies
// a ledger from another epic, and the file claims a route it is no longer on. That matters because the
// name is what a seed and a renderer trust WITHOUT re-reading the chain.
//
// Reported, never corrected. The file wins for this whole major (rule 3) — an epic may carry a route
// from a newer yadflow, and `yad migrate` deliberately never overwrites a `profile` somebody wrote.
//
// NO OVERLAP WITH `step:off-route`, on purpose. That check fires when a chain fits no route at all,
// and it already tells the user their chain is broken and how. Re-reporting the same epic here as
// "the recorded route disagrees" would name the same fault twice with two different remedies, so this
// check speaks only when the chain fits a route CLEANLY and it is a different one from the record.
export function profileChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  const unknown = [];
  const disagree = [];

  for (const e of fs.readdirSync(epicsDir).sort()) {
    if (!isValidEpicId(e)) continue;
    const state = readJSON(path.join(epicsDir, e, '.sdlc', 'state.json'), null);
    // No key at all is the normal state for a chain that matches no route: `stampProfile` declines to
    // invent one, and `step:off-route` is what reports that chain. Nothing to say here.
    if (!isPlainObject(state) || !('profile' in state)) continue;
    const recorded = state.profile;
    if (!lifecycleProfile(recorded)) {
      unknown.push(`${e}: \`${recorded === null ? 'null' : String(recorded)}\``);
      continue;
    }
    const matched = matchLifecycleProfile(state.steps);
    if (matched && matched !== recorded) {
      disagree.push(`${e}: records \`${recorded}\`, its chain is \`${matched}\``);
    }
  }

  const some = (list, n) => `${list.slice(0, n).join('; ')}${list.length > n ? ` (+${list.length - n} more)` : ''}`;
  if (unknown.length) {
    check(
      checks, 'profile:unknown', 'shape', 'warn',
      `${unknown.length} epic(s) record a lifecycle profile nobody defined: ${some(unknown, 3)}`,
      `a profile is one of ${LIFECYCLE_PROFILES.map((p) => p.id).join(' · ')}. An unrecognised value means nothing can say which route this epic is on, so every reader falls back to matching the chain — set \`profile\` in \`.sdlc/state.json\` to the route it walks, or delete the key and let it be derived`,
    );
  }
  if (disagree.length) {
    check(
      checks, 'profile:disagree', 'shape', 'warn',
      `${disagree.length} epic(s) record a route their chain is not on: ${some(disagree, 2)}`,
      'the chain is the truth here — it is what `yad next` and every gate actually walk. The recorded name is a label on top of it, and a stale one misleads whoever reads the record instead of the steps. Correct `profile` in `.sdlc/state.json` to the route the chain shows',
    );
  }
}

// `.sdlc/skills.json`: which skill runs which step, when the project does not want the engine's
// default (E6). Absent is the normal case and says nothing — most projects run the shipped skills.
//
// REPORTS, NEVER CORRECTS, and never judges a skill NAME. The engine cannot know which skills a team
// has installed — that is E50's job — and binding a skill this release has never heard of is the whole
// point of the file. So the only things checked here are the ones the engine CAN know: does the file
// parse, is a value usable, and is the step id one this engine runs at all.
//
// Three warnings, all of them "your line did nothing", which is the failure a config file makes easy
// to miss. A typo in a step id is silent otherwise: the binding sits in the file, `yad next` never
// looks it up, and the team concludes the feature does not work.
export function skillBindingChecks(checks, root) {
  const rel = PROJECT_FILES.skillsConfig;
  const file = path.join(root, rel);
  if (!exists(file)) return;

  let raw;
  try {
    raw = readJSONStrict(file, null);
  } catch (e) {
    check(checks, 'skills', 'project', 'fail', `${rel} does not parse [${e.code || 'YAD-STATE-001'}]`,
      e.hint || 'fix the JSON or restore it from git');
    return;
  }
  if (!isPlainObject(raw)) {
    check(checks, 'skills', 'project', 'fail', `${rel} has the wrong shape [YAD-STATE-002]`, 'expected a JSON object');
    return;
  }
  // `steps` missing entirely is fine — a file holding only `schemaVersion` is what `yad skill unbind`
  // leaves behind when the last binding goes, and it binds nothing, correctly.
  if (raw.steps !== undefined && !isPlainObject(raw.steps)) {
    check(checks, 'skills', 'project', 'fail', `${rel}: \`steps\` must be a JSON object [YAD-STATE-002]`,
      'expected `"steps": { "<step-id>": "<skill>" }`');
    return;
  }

  const bindings = normalizeBindings(raw);
  const bound = Object.entries(bindings.steps);
  // Dropped by `normalizeBindings` — a number, an empty string, an empty list. The line is in the file
  // and does nothing, which is the one thing a person editing it would never guess.
  const unusable = Object.keys(raw.steps || {})
    .filter((id) => !Object.hasOwn(bindings.steps, id));
  // A step id this engine does not run. The file still wins — a project may hold a step from a newer
  // release — so this changes nothing and only says the binding is asleep.
  const unknown = bound.map(([id]) => id).filter((id) => !stepDef(id));
  // A step id the engine knows but runs no skill for: a Shape review gate, driven by `yad gate`.
  const gates = bound.map(([id]) => id).filter((id) => stepDef(id) && !stepDef(id).skill);

  if (unusable.length) {
    check(checks, 'skills', 'project', 'warn',
      `${rel}: ${unusable.length} binding(s) name no skill and are ignored — ${unusable.join(', ')} [YAD-CFG-006]`,
      'each value must be a skill name or a non-empty list of them');
  }
  if (unknown.length) {
    check(checks, 'skills:unknown-step', 'project', 'warn',
      `${rel} binds ${unknown.length} step(s) this yadflow does not run: ${unknown.join(', ')}`,
      'check the spelling against `yad skill list`, or upgrade yadflow if the step is from a newer release');
  }
  if (gates.length) {
    check(checks, 'skills:review-step', 'project', 'warn',
      `${rel} binds ${gates.join(', ')}, which no skill runs — review gates are driven by \`yad gate\``,
      'bind the author step instead (for example `architecture`, not `architecture-review`)');
  }
  // Its OWN id, not `skills` again. A file with one good binding and one broken line fires both, and
  // two checks sharing an id put a green tick under the complaint in prose — and, worse, let a `--json`
  // consumer keying by id overwrite the warning with the tick.
  if (bound.length) {
    const chained = bound.filter(([, list]) => list.length > 1).length;
    check(checks, 'skills:bound', 'project', 'ok',
      `skills: ${bound.length} step(s) bound${chained ? `, ${chained} to more than one skill` : ''}`);
  }
}

// A step this release does not recognise. Every step the engine can run has a row in the step
// catalogue (E4), and that row is what gives it both a phase and a skill. So an id no phase claims is
// an id with no row at all: one `yad next` cannot guide, `yad gate` has no artifact rule for, and no
// renderer can place in the lifecycle. It is reported rather than ignored, and only warned about rather than failed: a project
// may legitimately hold a step from a newer yadflow than the one being run, and a hand-written
// `state.json` is allowed to be ahead of the tool reading it.
//
// THREE PLACES A STEP ID CAN APPEAR, and all three are read:
//   * `state.json` `steps[]` — the Shape chain;
//   * `state.json` `currentStep` — the field `yad thread --json` derives its `phase` from, and the one
//     nothing else validates. A typo there does not break `yad next`, which falls back to the first
//     step that is not done, so it would otherwise sit in a project unreported;
//   * `build-state/<story>.json` `repos.<name>.steps[]` — the Build half. Without these, five of the
//     twelve known step ids have no reader on this path at all.
// The four `currentStep` sentinels are markers rather than steps and are skipped by name.
export function phaseChecks(checks, root) {
  const epicsDir = path.join(root, 'epics');
  if (!exists(epicsDir)) return;
  const unplaced = [];
  // One report per unknown id per epic. `currentStep` usually names a step that is also in `steps[]`,
  // so a single typo would otherwise be listed twice and push a genuinely different one out of the
  // three the message has room for.
  let seen = new Set();
  const consider = (where, id) => {
    if (typeof id !== 'string' || !id || SENTINELS.includes(id) || seen.has(id)) return;
    if (stepPhase(id)) return;
    seen.add(id);
    unplaced.push(`${where}: \`${id}\``);
  };
  const considerSteps = (where, steps) => {
    if (!Array.isArray(steps)) return;
    for (const s of steps) if (isPlainObject(s)) consider(where, s.id);
  };
  for (const e of fs.readdirSync(epicsDir).sort()) {
    if (!isValidEpicId(e)) continue;
    seen = new Set();
    const state = readJSON(path.join(epicsDir, e, '.sdlc', 'state.json'), null);
    if (isPlainObject(state)) {
      considerSteps(e, state.steps);
      consider(`${e} (currentStep)`, state.currentStep);
    }
    const bsDir = path.join(epicsDir, e, '.sdlc', 'build-state');
    if (!exists(bsDir)) continue;
    let names;
    try { names = fs.readdirSync(bsDir).filter((n) => n.endsWith('.json')).sort(); } catch { continue; }
    for (const n of names) {
      const bs = readJSON(path.join(bsDir, n), null);
      if (!isPlainObject(bs) || !isPlainObject(bs.repos)) continue;
      for (const [repo, r] of Object.entries(bs.repos)) considerSteps(`${e}/${n} (${repo})`, r?.steps);
    }
  }
  if (unplaced.length) {
    check(
      checks, 'phase:unknown', 'shape', 'warn',
      `${unplaced.length} step(s) belong to no phase: ${unplaced.slice(0, 3).join('; ')}${unplaced.length > 3 ? ` (+${unplaced.length - 3} more)` : ''}`,
      'this yadflow does not recognise that step id, so it cannot say which phase it is in, which skill runs it, or what `yad next` should tell you to do. Check the spelling, or upgrade if the step comes from a newer release',
    );
  }
}

export function shapeChecks(checks, root, { plan: injected = null } = {}) {
  if (!injected && !exists(productConfigPath(root)) && !exists(path.join(root, PROJECT_FILES.version))) return;
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
    // A genesis type with no parent has no lineage to check. `chore` joins `feature` here from
    // shape 5 on: upkeep often has no feature to hang off (see isGenesisType).
    if (isGenesisType(lin.type) && !lin.parent) continue;
    const { broken } = resolveThread(root, e);
    if (broken) {
      check(checks, `thread:${e}`, 'threads', 'fail', `${e}: ${broken}`,
        'a change-epic must thread to a real parent; fix `parent:`/`thread:` in epic.md frontmatter');
    } else {
      check(checks, `thread:${e}`, 'threads', 'ok', `${e}: ${lin.type} threaded to ${lin.thread || lin.parent}`);
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
  mirrorChecks(checks, root);
  dialChecks(checks, root);
  typeChecks(checks, root);
  themeChecks(checks, root);
  catalogueChecks(checks, root);
  profileChecks(checks, root);
  phaseChecks(checks, root);
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
