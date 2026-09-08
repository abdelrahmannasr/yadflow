// The single source of truth for what a set-up SDLC project should contain.
// Drives setup (install from), update (re-sync), and check (diff against).
// Keep the skill list here in sync with skills/sdlc/install.sh.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Read the version from package.json (the one source of truth) so it always
// tracks the semantic-release-managed version — never a hardcoded constant
// that would drift after a release. package.json ships in the npm tarball and
// sits at the package root, one level up from this cli/ dir.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;

// The published npm package name — the registry path the update check queries, and the name in the
// `npm install <name> -g` line it prints. Read from package.json so a rename can never desync them.
export const PKG_NAME = pkg.name;

// The upstream yadflow repo, as `owner/name` — where `yad report` files issues. Derived from
// package.json `bugs.url` (the single source of truth) so it tracks a fork/rename automatically;
// falls back to the canonical slug if the field is ever malformed.
export const UPSTREAM_REPO =
  (pkg.bugs?.url || '').match(/github\.com\/([^/]+\/[^/]+?)(?:\/issues)?\/?$/i)?.[1]
  || 'abdelrahmannasr/yadflow';

// The hand-authored yad-* skills (mirrors skills/sdlc/install.sh).
export const SKILLS = [
  'yad-discovery',
  'yad-analysis',
  'yad-epic',
  'yad-architecture',
  'yad-ui',
  'yad-stories',
  'yad-test-cases',
  'yad-connect-repos',
  'yad-sync-repos',
  'yad-connect-design',
  'yad-connect-testing',
  'yad-connect-learning',
  'yad-connect-docs',
  'yad-docs',
  'yad-docs-overview',
  'yad-docs-sync',
  'yad-learn',
  'yad-spec',
  'yad-implement',
  'yad-checks',
  'yad-pr-template',
  'yad-hub-bridge',
  'yad-commit',
  'yad-open-pr',
  'yad-ship',
  'yad-engineer-review',
  'yad-backfill',
  'yad-run',
  'yad-review-gate',
  'yad-review-companion',
  'yad-pair-review',
  'yad-status',
  'yad-report',
  'yad-change',
  'yad-timeline',
  'yad-defects',
  'yad-reconcile',
  'yad-stub',
];

// Pre-2.0 skill names (the sdlc-* -> yad-* rename). `check`/`update` migrate any install
// still carrying an old name: remove the old copy, install the renamed one.
export const LEGACY_SKILLS = {
  'yad-analysis': 'sdlc-author-analysis',
  'yad-epic': 'sdlc-author-epic',
  'yad-architecture': 'sdlc-author-architecture',
  'yad-ui': 'sdlc-author-ui',
  'yad-stories': 'sdlc-author-stories',
  'yad-connect-repos': 'sdlc-connect-repos',
  'yad-spec': 'sdlc-spec',
  'yad-implement': 'sdlc-implement',
  'yad-checks': 'sdlc-checks',
  'yad-pr-template': 'sdlc-pr-template',
  'yad-hub-bridge': 'sdlc-hub-bridge',
  // Step E ("ship") was renamed to yad-engineer-review (the yad-ship name now belongs to the new
  // commit+open-PR combined skill). Pre-2.0 installs carry sdlc-ship → migrate it to yad-engineer-review.
  // A 2.x install carrying yad-ship-as-Step-E is simply overwritten with the new combined content on
  // `yad update` (same name, fresh copy), and yad-engineer-review is installed as a new skill.
  'yad-engineer-review': 'sdlc-ship',
  'yad-backfill': 'sdlc-backfill',
  'yad-run': 'sdlc-run',
  'yad-review-gate': 'sdlc-review-gate',
  'yad-status': 'sdlc-status',
};

// Skills removed in a later release that must be PURGED from existing installs. Unlike
// LEGACY_SKILLS (a rename: drop old name, install new), these have no replacement — a rerun of
// `yad update` / `yad setup` deletes any installed copy from every IDE target so a breaking
// removal actually takes effect. List every install basename to purge, including any pre-rename
// alias the skill ever shipped under.
//   yad-review-comments — removed in 2.x (was sdlc-review-comments pre-2.0).
export const REMOVED_SKILLS = ['yad-review-comments', 'sdlc-review-comments'];

// Pre-2.0 wired-file dests replaced by renamed ones (old dest -> new dest, per platform).
// An old file is removed ONLY when its first line carries the old ownership marker —
// a same-named file the user authored themselves is never touched.
export const LEGACY_MARKER = '# sdlc-managed';
export const LEGACY_REPO_FILES = {
  github: { '.github/workflows/sdlc-checks.yml': '.github/workflows/yad-checks.yml' },
  gitlab: { '.gitlab/ci/sdlc-checks.yml': '.gitlab/ci/yad-checks.yml' },
};
export const LEGACY_HUB_FILES = {
  github: {
    '.github/workflows/sdlc-gate-sync.yml': '.github/workflows/yad-gate-sync.yml',
    '.github/workflows/sdlc-verified-commits.yml': '.github/workflows/yad-verified-commits.yml',
  },
  gitlab: {
    '.gitlab/ci/sdlc-gate-sync.yml': '.gitlab/ci/yad-gate-sync.yml',
    '.gitlab/ci/sdlc-verified-commits.yml': '.gitlab/ci/yad-verified-commits.yml',
  },
};

// IDE install targets (relative to the target project root).
export const IDE_FOLDER_TARGETS = Object.freeze(['.claude', '.agents', '.zencoder']); // <ide>/skills/<skill>/ (folder copy)
export const IDE_OPENCODE_TARGET = '.opencode';
export const IDE_TARGETS = Object.freeze([...IDE_FOLDER_TARGETS, IDE_OPENCODE_TARGET]);
export const IDE_OPENCODE_DIR = `${IDE_OPENCODE_TARGET}/commands`; // <skill>.md (flat SKILL.md copy)

// Module registration files copied from skills/sdlc/ into _bmad/sdlc/.
export const MODULE_FILES = ['config.yaml', 'module-help.csv'];

// Supported design-tool adapters (mirrors skills/sdlc/config.yaml `design.tools`); `DESIGN_PRIMARY` is
// the fallback `registerDesign`/setup use when an unknown tool is named, and `none` is the explicit
// markdown-only choice. (doctor does NOT fall back — an unknown tool there is a hard YAD-CFG-002 fail,
// mirroring how registerRepo falls back on platform while doctor fails on an unknown hub platform.)
export const DESIGN_TOOLS = ['figma', 'pencil'];
export const DESIGN_PRIMARY = 'figma';

// Supported testing-tool adapters (mirrors skills/sdlc/config.yaml `testing.tools`); `TESTING_PRIMARY`
// is the fallback `registerTesting`/setup use when an unknown tool is named, and `none` is the explicit
// artifacts-only choice. (doctor does NOT fall back — an unknown tool there is a hard YAD-CFG-003 fail,
// mirroring the design-tool YAD-CFG-002.)
export const TESTING_TOOLS = ['playwright', 'cypress', 'pytest', 'maestro'];
export const TESTING_PRIMARY = 'playwright';

// Supported learning-tool adapters (mirrors skills/sdlc/config.yaml `learning.tools`); `LEARNING_PRIMARY`
// is the fallback `registerLearning`/setup use when an unknown tool is named, and `none` is the explicit
// harness-native choice (yad-learn tutors via the harness model when no tool is connected). DeepTutor is
// a CLI subprocess (no MCP), so the connect skill detects the binary — not an MCP — but the registry +
// degrade shape mirrors design/testing. (doctor does NOT fall back — an unknown tool there is a hard
// YAD-CFG-004 fail, mirroring the design-tool YAD-CFG-002.)
export const LEARNING_TOOLS = ['deeptutor'];
export const LEARNING_PRIMARY = 'deeptutor';

// The shape (schema version) every file the engine writes declares, as `"schemaVersion": <n>`.
//
// Rule 1 of the change-safety rules (docs/roadmap-idea-1.md, Part 2): every file states its shape,
// and a file with no version counts as 1.
//
// Raising this number is not a one-line change. Three things move together, or a project is left
// holding files it cannot upgrade:
//   1. a step appended to MIGRATIONS (cli/migrate.mjs) taking a file from the old shape to the new
//      one — the chain from 1 upwards must have no gap, which cli/test-migrate.mjs asserts;
//   2. `docs/migrations/shape-<n>.md`, which scripts/shape-guide-check.sh REFUSES to release without;
//   3. every writer of the changed file taught to write the new shape's fields.
// `yad doctor` reports a project whose files disagree with this number, and `yad migrate` is what
// closes the gap.
//
// 2 — `.sdlc/hub.json` records who writes the ledger as `ledger: verified | local` (E104).
//
// Deliberately NOT the same thing as `VERSION` above. That is which release of the CLI you are
// running and moves on every publish; this is what the files on disk look like and moves only when
// their shape actually changes.

export const SCHEMA_VERSION = 3;

// Project-level files setup produces (used by `check` to spot missing setup).
export const PROJECT_FILES = {
  reposRegistry: '.sdlc/repos.json',
  // The product's own settings. `product.json` is the name from shape 3 onward; `hub.json` is what
  // it was called before, and it is NOT dead — see MIRRORED_FILES below.
  productConfig: '.sdlc/product.json',
  hubConfig: '.sdlc/hub.json',
  designConfig: '.sdlc/design.json',
  testingConfig: '.sdlc/testing.json',
  learningConfig: '.sdlc/learning.json',
  docsConfig: '.sdlc/docs.json',
  version: '.sdlc/cli-version.json',
};

// ---- files that changed NAME in shape 3 --------------------------------------------------------
//
// `hub` became `Product`, so `.sdlc/hub.json` became `.sdlc/product.json`. A field rename is easy;
// a FILE rename is not, because a file is opened by name from outside this codebase:
//
//   - `templates/checks/ledger-guard.sh` is committed inside the USER's repo and opens
//     `.sdlc/hub.json` by that literal path. It is refreshed by `yad update`, which is a separate act
//     from `yad migrate` with no ordering between them.
//   - So a project WILL exist that has been migrated but not updated. Its guard would open a path
//     that no longer exists, read no platform, conclude the ledger is local, and stop rejecting human
//     commits to it — the audit trail disarmed by an upgrade.
//
// Hence: for one whole major version BOTH files exist, and the OLD name is the one that is READ.
// `product.json` is written on every save so that it is there, correct, and ready — but nothing
// depends on it yet. `productConfigPath` picks the old name whenever it exists and falls back to the
// new one, so a project holding either name alone still works.
//
// Reading the new name first is the tempting version and it is wrong: the moment two names exist and
// the new one wins, everything that writes the old one — the guard above, a script someone wrote,
// a person editing the file they know — is silently ignored.
//
// The ladder is add, then switch, then remove:
//   this major   the new name appears and is maintained; the old one is still read
//   next major   the new name becomes the one read, and `yad doctor` warns about the old
//   after that   the old name is deleted
//
// This costs a duplicated file on disk for two releases. That is the price of not silently disarming
// a safety gate in somebody else's repository, and it is worth paying.
export const MIRRORED_FILES = [
  { canonical: PROJECT_FILES.productConfig, legacy: PROJECT_FILES.hubConfig },
];

// Which of the two names to READ.
//
// The OLD name wins while it exists, and that is deliberate. Renaming a file across an ecosystem
// takes three releases, not one:
//
//   this major   the new name appears and is written on every save. The OLD name is still the one
//                that counts, so everything that already reads it keeps working — the ledger-guard
//                committed in the user's repo, a script somebody wrote, a person editing the file
//                they know. Nothing can be silently ignored, because the file everyone knows is
//                still authoritative.
//   next major   the new name becomes authoritative and `yad doctor` warns about the old one.
//   the one after that   the old name is deleted.
//
// Reading the NEW name first this early looks tidier and is a trap: the moment two names exist and
// the new one wins, anyone who edits the old one — including our own fixtures, which is how this was
// found — has their change silently ignored. `yad doctor` reports the two copies drifting apart, so
// a project that gets into that state is told, rather than left to wonder.
export const productConfigPath = (root) => {
  const legacy = path.join(root, PROJECT_FILES.hubConfig);
  return existsSync(legacy) ? legacy : path.join(root, PROJECT_FILES.productConfig);
};

// Same rule for a renamed file inside an epic's ledger.
export const preferring = (canonical, legacy) => (existsSync(legacy) ? legacy : canonical);

// Who writes the ledger. Two values, and the switch lives in `.sdlc/hub.json`:
//
//   ledger: "verified"  CI only, with a platform-Verified signature. A local `gate open` is
//                       advisory and writes nothing; `ledger-guard` rejects any non-bot commit.
//   ledger: "local"     your machine. Works offline, no CI needed, guarded by nothing.
//
// `verified` is the old "bridge mode" renamed. The old name described a mechanism; this one
// describes what you get, and it is the word the platform shows next to the commits.
//
// READ ORDER, and it matters (rule 2 — read old, write new):
//   1. `ledger`, if the file carries it — shape 2 and later.
//   2. otherwise the old booleans `bridge_enabled` (canonical) or `bridge` (older still).
// A platform is required either way. Without one there is no Verified badge to read, so CI cannot
// be the sole writer and the local path has to stay open — otherwise a hub has no permitted writer
// at all and no gate can ever advance (issue #186).
//
// ONE definition, imported by every JS caller. `templates/checks/ledger-guard.sh` re-implements the
// SAME order in bash because the check gates are standalone by design; that copy is the only one,
// its header says so, and cli/test-checks.mjs runs a table of hub.json variants through both and
// asserts they agree on every row. Three keys is three ways for two readers to drift.
export const isVerifiedLedger = (hub) => {
  if (!hub?.platform) return false;
  if (typeof hub.ledger === 'string') return hub.ledger === 'verified';
  return hub.bridge_enabled === true || hub.bridge === true;
};

// ---- `yad commit` conventions (mirror skills/sdlc/config.yaml `build`) ----
// Conventional-commit types (config.yaml commit_subject_style).
export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'chore', 'revert'];
// Per-commit AI co-author choices (config.yaml build.ai_coauthor.allowed). The human git author OWNS
// the commit; the AI is only a Co-Authored-By trailer. `none` => human-only (trailer omitted).
export const AI_COAUTHORS = {
  claude: { name: 'Claude', email: 'noreply@anthropic.com' },
  copilot: { name: 'GitHub Copilot', email: 'copilot@users.noreply.github.com' },
  cursor: { name: 'Cursor', email: 'noreply@cursor.com' },
  coderabbit: { name: 'CodeRabbit', email: 'noreply@coderabbit.ai' },
  none: null,
};
// Atomic-commit guard: warn/refuse above this many staged files (build plan: ≤3 where possible).
export const ATOMIC_FILE_LIMIT = 3;
// Trailer order is fixed: Task -> Contract-Change -> Co-Authored-By (config.yaml build comment).
export const TASK_TRAILER = 'Task';
export const CONTRACT_CHANGE_TRAILER = 'Contract-Change';
export const COAUTHOR_TRAILER = 'Co-Authored-By';
// A Task trailer id must be a real <story>-T<NN>. Mirrors the spec-link gate contract
// (checks/spec-link.sh: `.+-T[0-9]+$`) so an explicit --task that would fail CI is
// rejected locally at commit time instead of after a push + history rewrite.
export const TASK_ID_RE = /.+-T\d+$/;

// Per-epic ledger files under epics/<epic>/.sdlc/ (the file source of truth the gate reads/writes).
export const epicFiles = (epicRoot) => ({
  state: `${epicRoot}/.sdlc/state.json`,
  approvals: `${epicRoot}/.sdlc/approvals.json`,
  comments: `${epicRoot}/.sdlc/comments.json`,
  // The record of review PR/MRs opened on the product. `product-prs.json` is the name from shape 3
  // onward; `hub-prs.json` is what it was called before and is written alongside it for one major —
  // both `templates/checks/ledger-guard.sh` and `cli/hook.mjs` name it literally, and the guard in a
  // user's repo only learns the new name when they run `yad update`. See MIRRORED_FILES.
  productPrs: `${epicRoot}/.sdlc/product-prs.json`,
  hubPrs: `${epicRoot}/.sdlc/hub-prs.json`,
  contractLock: `${epicRoot}/.sdlc/contract-lock.json`,
  // The two append-only Build ledgers use shard-then-fold storage (cli/ledger.mjs): writers add
  // one loose shard per entry under the *Dir path (conflict-free concurrent writes); `yad tidy up`
  // folds finished shards back into the single *Log file. Readers union the folded file + loose shards.
  buildLog: `${epicRoot}/.sdlc/build-log.json`,         // folded ships (also the legacy single file)
  buildLogDir: `${epicRoot}/.sdlc/build-log`,           // one <story>-<task>-<repo>.json per ship
  trustLog: `${epicRoot}/.sdlc/trust-log.json`,         // folded runs (also the legacy single file)
  trustLogDir: `${epicRoot}/.sdlc/trust-log`,           // one <story>-<repo>-<step>-<uid>.json per run
  buildStateDir: `${epicRoot}/.sdlc/build-state`,       // Phase 4 — per-story, per-repo Build state

  change: `${epicRoot}/.sdlc/change.json`,             // Phase 6 — change/defect intake + triage
  reconcileDebt: `${epicRoot}/.sdlc/reconcile-debt.json`, // Phase 6 — hotfix ship-first debt
});

// Per-repo wiring: src is relative to PKG_ROOT, dest relative to the repo root.
// `common` always installs; the platform key installs by detected platform.
export const REPO_WIRING = {
  common: [
    { src: 'skills/yad-checks/templates/checks/spec-link.sh', dest: 'checks/spec-link.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/contract-check.sh', dest: 'checks/contract-check.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/package-manager.sh', dest: 'checks/package-manager.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/install-deps.sh', dest: 'checks/install-deps.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/build-test-lint.sh', dest: 'checks/build-test-lint.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/lineage-check.sh', dest: 'checks/lineage-check.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/epic-open.sh', dest: 'checks/epic-open.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/reconcile-debt-check.sh', dest: 'checks/reconcile-debt-check.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/verified-commits.sh', dest: 'checks/verified-commits.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/commit-message.sh', dest: 'checks/commit-message.sh', exec: true },
    { src: 'skills/yad-pr-template/templates/checks/risk-route.sh', dest: 'checks/risk-route.sh', exec: true },
    { src: 'skills/yad-pr-template/templates/checks/pr-title.sh', dest: 'checks/pr-title.sh', exec: true },
    { src: 'skills/yad-pr-template/templates/checks/pr-template.sh', dest: 'checks/pr-template.sh', exec: true },
  ],
  github: [
    { src: 'skills/yad-checks/templates/github/yad-checks.yml', dest: '.github/workflows/yad-checks.yml' },
    // Integrity gate for direct-to-default pushes (`yad update --push`): verified-commits + commit-message.
    { src: 'skills/yad-checks/templates/github/yad-update-guard.yml', dest: '.github/workflows/yad-update-guard.yml' },
    { src: 'skills/yad-pr-template/templates/github/pull_request_template.md', dest: '.github/pull_request_template.md' },
  ],
  gitlab: [
    { src: 'skills/yad-checks/templates/gitlab/yad-checks.gitlab-ci.yml', dest: '.gitlab/ci/yad-checks.yml' },
    { src: 'skills/yad-checks/templates/gitlab/yad-update-guard.gitlab-ci.yml', dest: '.gitlab/ci/yad-update-guard.yml' },
    { src: 'skills/yad-pr-template/templates/gitlab/merge_request_templates/Default.md', dest: '.gitlab/merge_request_templates/Default.md' },
  ],
};

// Provenance of the wired files above, per repo root. Wiring files are OURS to rewrite, but "the
// on-disk copy differs from the shipped template" cannot tell a STALE copy (overwrite it) from one a
// team deliberately CUSTOMIZED (ask first) — so every write records the sha256 of what it wrote here.
// On the next update, on-disk == recorded proves the copy is untouched since we wrote it; anything
// else is a local edit, reported as `modified` and left alone (#164). Committed, so the record
// travels with the repo instead of living in one person's clone.
export const MANAGED_LEDGER = '.sdlc/managed.json';
// Suffix for the copy written beside a managed file before its content is replaced without that
// proof — the local edit is always recoverable from the working tree, not only from git history.
export const BACKUP_SUFFIX = '.yad-orig';

export const wiringFor = (platform) => [
  ...REPO_WIRING.common,
  ...(REPO_WIRING[platform] || []),
];

// Hub wiring: CI installed on the PRODUCT HUB itself (dest is the project root — the hub IS the
// root). Installed only when hub.json has a platform and the ledger is verified. Carries the
// event-driven gate sync (approvals/change requests/the merge trigger `yad gate ci`) and the
// verified-commits gate (no unverified commits from unverified users reach merge on the hub).
export const HUB_WIRING = {
  common: [
    { src: 'skills/yad-checks/templates/checks/verified-commits.sh', dest: 'checks/verified-commits.sh', exec: true },
    // The ledger is CI-owned: block non-bot commits to gate-state files on hub review PRs.
    { src: 'skills/yad-checks/templates/checks/ledger-guard.sh', dest: 'checks/ledger-guard.sh', exec: true },
    // Pattern gates run on the hub too (profile: hub) — commit subject + PR title + PR body.
    { src: 'skills/yad-checks/templates/checks/commit-message.sh', dest: 'checks/commit-message.sh', exec: true },
    { src: 'skills/yad-pr-template/templates/checks/pr-title.sh', dest: 'checks/pr-title.sh', exec: true },
    { src: 'skills/yad-pr-template/templates/checks/pr-template.sh', dest: 'checks/pr-template.sh', exec: true },
  ],
  github: [
    { src: 'skills/yad-hub-bridge/templates/github/yad-gate-sync.yml', dest: '.github/workflows/yad-gate-sync.yml' },
    { src: 'skills/yad-checks/templates/github/yad-verified-commits.yml', dest: '.github/workflows/yad-verified-commits.yml' },
    { src: 'skills/yad-checks/templates/github/yad-hub-checks.yml', dest: '.github/workflows/yad-hub-checks.yml' },
    // Integrity gate for the hub's own direct-to-default pushes (`yad update --push`; the machine-
    // state `yad checkpoint`/`gate ci` commits carry [skip ci] and are intentionally not re-checked).
    { src: 'skills/yad-checks/templates/github/yad-update-guard.yml', dest: '.github/workflows/yad-update-guard.yml' },
  ],
  gitlab: [
    { src: 'skills/yad-hub-bridge/templates/gitlab/yad-gate-sync.gitlab-ci.yml', dest: '.gitlab/ci/yad-gate-sync.yml' },
    { src: 'skills/yad-checks/templates/gitlab/yad-verified-commits.gitlab-ci.yml', dest: '.gitlab/ci/yad-verified-commits.yml' },
    { src: 'skills/yad-checks/templates/gitlab/yad-hub-checks.gitlab-ci.yml', dest: '.gitlab/ci/yad-hub-checks.yml' },
    { src: 'skills/yad-checks/templates/gitlab/yad-update-guard.gitlab-ci.yml', dest: '.gitlab/ci/yad-update-guard.yml' },
  ],
};

// Harness hooks: the LOCAL half of the ledger rule, installed on the hub beside the CI gates and
// active under the same verified-ledger predicate (#171). Kept out of `HUB_WIRING` because a hook is not a
// CI gate — it is advisory, fails open, and its adapter (below) is per-harness, not per-platform.
export const HOOK_WIRING = [
  { src: 'skills/yad-checks/templates/hooks/ledger-guard.sh', dest: 'hooks/ledger-guard.sh', exec: true },
];

// Per-harness adapter config: which IDE target gets a hook entry written, and where.
// `.claude` alone — it is the only supported target with a defined hook protocol (`.agents`,
// `.zencoder` and `.opencode` carry skills only). The others simply get the script and no wiring;
// the contract in the script header is what they would wire by hand.
export const HOOK_SETTINGS = { '.claude': '.claude/settings.json' };
// The tools that can write a file. A `Bash` call (`sed -i epics/…`) is deliberately NOT matched:
// matching it would mean parsing shell, and CI's ledger-guard already fails closed on the result.
export const HOOK_TOOL_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';
// `$CLAUDE_PROJECT_DIR` so the entry works whatever the harness's working directory is — QUOTED,
// because the harness runs this through a shell: unquoted, a project path containing a space
// word-splits, the command is not found, and the guard is silently off while `check` and `doctor`
// both still report it wired.
export const HOOK_COMMAND = '"$CLAUDE_PROJECT_DIR/hooks/ledger-guard.sh"';
// Spellings a previous yadflow wrote for the SAME hook. An installed entry matching one of these is
// ours to normalise; anything else is the team's, even if it names a similar path. Never widen this
// to a substring test — a team keeping its own wrapper at `.claude/hooks/ledger-guard.sh` would have
// their hook silently rewritten to ours.
export const HOOK_COMMAND_LEGACY = Object.freeze([
  '$CLAUDE_PROJECT_DIR/hooks/ledger-guard.sh', // 3.16.x, pre-quoting
]);
