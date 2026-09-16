// The single source of truth for what a set-up SDLC project should contain.
// Drives setup (install from), update (re-sync), and check (diff against).
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

// The hand-authored yad-* skills.
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
export const LEGACY_PRODUCT_FILES = {
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
export const IDE_FOLDER_TARGETS = Object.freeze(['.claude', '.agents', '.cursor', '.gemini', '.zencoder']); // <ide>/skills/<skill>/ (folder copy)
export const IDE_OPENCODE_TARGET = '.opencode';
export const IDE_TARGETS = Object.freeze([...IDE_FOLDER_TARGETS, IDE_OPENCODE_TARGET]);
export const IDE_OPENCODE_DIR = `${IDE_OPENCODE_TARGET}/commands`; // <skill>.md (flat SKILL.md copy)

// WHICH AGENT READS WHICH TARGET (E11). A target is a DIRECTORY, never an agent name — that is the
// closed decision, and it is the reason nothing here needs a migration: the stamped value in
// `.sdlc/cli-version.json` keeps meaning exactly what it always meant.
//
// This table exists because the mapping is not one-to-one and the docs were wrong about it. `SKILL.md`
// became a cross-agent format, and `.agents/skills/` the directory several agents agreed to read, so
// yadflow has been installing for Codex, Gemini CLI, Cursor and Copilot since long before this row —
// it just never said so, and a Codex user reading "Claude Code (plus .agents…)" had no way to know.
//
// Checked against each agent's own documentation on 2026-09-16, NOT from memory; every entry below is
// a directory that agent's docs name. Re-check before adding one — a guessed path installs in silence
// and is never read.
//
//   .claude    Claude Code. Cursor also reads it for compatibility.
//   .agents    the cross-agent directory: Codex CLI (repo root), Gemini CLI (alias), Cursor, Copilot.
//   .cursor    Cursor's own. Redundant beside `.agents`, offered for a Cursor-only project.
//   .gemini    Gemini CLI's own. Redundant beside `.agents`, same reason.
//   .zencoder  Zencoder.
//   .opencode  opencode — a FLAT `commands/<skill>.md` copy, not a folder (see IDE_OPENCODE_DIR).
//
// Used by the `yad setup` prompt, `yad doctor` and the docs, so the list a user is shown and the list
// the installer honours can never drift apart.
export const IDE_AGENTS = Object.freeze({
  '.claude': Object.freeze(['Claude Code', 'Cursor']),
  '.agents': Object.freeze(['Codex CLI', 'Gemini CLI', 'Cursor', 'GitHub Copilot']),
  '.cursor': Object.freeze(['Cursor']),
  '.gemini': Object.freeze(['Gemini CLI']),
  '.zencoder': Object.freeze(['Zencoder']),
  '.opencode': Object.freeze(['opencode']),
});

// What a FRESH `yad setup` offers when the project has no agent directory yet: Claude Code plus the
// cross-agent directory, which together cover every agent named above. The cost is honest and small —
// the skills are written twice, once per directory.
//
// NOT the same value as IDE_RECOVERY_TARGET below, and the difference is deliberate. This is a CHOICE
// offered to someone setting up; that one is what a project falls back to when its stamp is missing or
// unreadable. Installing `.agents` into an existing `.claude`-only project because its stamp went
// sideways would write forty skill folders the team never asked for, on a recovery path they did not
// choose to walk. A recovery restores the minimum; it does not upgrade anyone.
export const DEFAULT_IDE_TARGETS = Object.freeze(['.claude', '.agents']);
export const IDE_RECOVERY_TARGET = '.claude';

// The module config, copied from skills/sdlc/config.yaml into the project, where the skills read it (E3).
// Until E3 it went to `_bmad/sdlc/`, beside `module-help.csv`, because yadflow was packaged as a BMAD
// module. Only BMAD's own help menu read the installed `module-help.csv`, so that file is not installed
// at all now; its source stays in skills/sdlc/, where yad-docs-overview reads it. An existing
// `_bmad/sdlc/` is left where it is, and `yad doctor` names it.
export const MODULE_CONFIG = '.sdlc/config.yaml';

// Supported design-tool adapters (mirrors skills/sdlc/config.yaml `design.tools`); `DESIGN_PRIMARY` is
// the fallback `registerDesign`/setup use when an unknown tool is named, and `none` is the explicit
// markdown-only choice. (doctor does NOT fall back — an unknown tool there is a hard YAD-CFG-002 fail,
// mirroring how registerRepo falls back on platform while doctor fails on an unknown Product platform.)
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
// 3 — the Product's settings gain `.sdlc/product.json` beside `.sdlc/hub.json`, and a roster entry's
//     product-level roles gain a `product` spelling beside `hub` (E30).
// 4 — every step declares `driver` beside `assistance` and `advance` beside `automation` (E28).
// 5 — every epic's `state.json` records its work-item `type`, and `epic.md` gains `type:` beside
//     `kind:` (E21). `kind:` is still the name that is READ — see workItemType in epic-state.mjs.
// 6 — every epic's `state.json` records the lifecycle `profile` its chain came from (E17). The value
//     is one of LIFECYCLE_PROFILES in epic-state.mjs, and for an existing epic it is DERIVED from the
//     chain it already carries — never defaulted, because guessing a route would tell `yad epic new`
//     and `yad doctor` a chain is on a route nobody chose.
// 7 — every step's `status` is one of the step-state model's words (E38, STEP_STATES in
//     epic-state.mjs). `blocked` stops meaning "not started" and starts meaning "cannot proceed, not
//     our choice"; the old spelling of the first is rewritten to `todo`, a skip becomes
//     `status: skipped` and an inherited step `status: satisfied`, each with a `record` saying why.
//     THE FIRST SHAPE THAT CHANGES A VALUE IN PLACE rather than adding a key beside an old one — so
//     it is the first that an older CLI cannot read correctly, which docs/migrations/shape-7.md says
//     in as many words. Every legacy field is kept beside the new one (rule 3).
// 8 — the Product level lives in `foundation/` as the Foundation, id `EP-foundation` (E75). On a
//     local ledger `yad migrate` MOVES `epics/EP-discovery/` there and relabels its step ids; no field
//     of any other file changes. On a verified project the gate bot makes the same
//     move (`yad gate ci`); until it lands, the old spelling is still read.
//     docs/migrations/shape-8.md.
// 9 — an approval's fingerprint leaves out the artifact's frontmatter `status:` line (`reviewedSha` in
//     epic-state.mjs). No field is added, renamed or moved, and no file is rewritten: what changes is
//     the VALUE the gate writes into `artifactHash` on a new approval. It is still a shape, and a
//     breaking one, because an older yadflow reads that value as stale — so it has to see a newer
//     shape and say so. This release reads both the new value and every form older ones recorded.
//     docs/migrations/shape-9.md.
// 10 — a deferred step can be put back after the chain has built past it, and can carry `debt: true`
//     (E41). One optional key is added to a step in `state.json`, written only by `yad defer --debt`,
//     and nothing on disk is rewritten. It is a breaking shape because an older yadflow cannot read a
//     step re-opened behind finished work: it names that step the blocker of the work, and passing its
//     review re-opens the step after it. docs/migrations/shape-10.md.
//
// Deliberately NOT the same thing as `VERSION` above. That is which release of the CLI you are
// running and moves on every publish; this is what the files on disk look like and moves only when
// their shape actually changes.

export const SCHEMA_VERSION = 10;

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
  // Which skill runs which step, when the project does not want the engine's default (E6). Absent is
  // the normal case and means "every step uses the skill the catalogue names" — like design.json,
  // which is absent on a markdown-only project.
  skillsConfig: '.sdlc/skills.json',
  // The kill switch and the Shape steps a team has set to `advance: auto` (E34). Absent is the normal
  // case: the switch is off and every Shape step is `human`. A project file, not the module config the
  // switch lived in before (`_bmad/sdlc/config.yaml` then, `.sdlc/config.yaml` since E3) — that one is
  // hash-managed by `yad update`, so flipping it there marked the file modified and every later update
  // skipped it.
  automationConfig: '.sdlc/automation.json',
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
// be the sole writer and the local path has to stay open — otherwise a Product has no permitted writer
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

// ---- the two dials (E28) ------------------------------------------------------------------------
// Every step declares who does the work and who moves it forward. Shape 4 renames both, and the old
// names stay readable for a major (rule 3):
//
//   assistance: none | review | heavy         ->  driver:  human | pair  | agent
//   automation: human_approve | machine_advance  ->  advance: human | auto
//
// Same rule as `.sdlc/hub.json` above: BOTH are written, and the OLD one wins while it exists.
// The old name is what the 29 skills that hand-write `state.json` still emit, and what an older CLI
// still reads. A step whose dials disagree is a project mid-upgrade, not a decision — `yad doctor`
// reports it and `yad migrate` closes it.
export const DRIVER_FROM_ASSISTANCE = { none: 'human', review: 'pair', heavy: 'agent' };
export const ADVANCE_FROM_AUTOMATION = { human_approve: 'human', machine_advance: 'auto' };
// Back the other way, for the one place that still has to SAY the old word: `yad next --json` keeps
// emitting `automation`, because cli/test-golden.mjs deep-equals that output against a frozen v3
// snapshot and rule 6 says a frozen project's answers never change. The output key follows in the
// major that removes the old field.
export const AUTOMATION_FROM_ADVANCE = { human: 'human_approve', auto: 'machine_advance' };

// The dial a step is actually running under, from whichever spelling it carries. Old wins.
// `null` when the step declares nothing, so a caller can tell "not set" from "set to human".
export const stepAdvance = (step) => {
  if (!step || typeof step !== 'object') return null;
  if (typeof step.automation === 'string') return ADVANCE_FROM_AUTOMATION[step.automation] ?? null;
  if (typeof step.advance === 'string') return step.advance;
  return null;
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

// Product wiring: CI installed on the PRODUCT itself (dest is the project root — the Product IS the
// root). Installed only when hub.json has a platform and the ledger is verified. Carries the
// event-driven gate sync (approvals/change requests/the merge trigger `yad gate ci`) and the
// verified-commits gate (no unverified commits from unverified users reach merge on the Product).
export const PRODUCT_WIRING = {
  common: [
    { src: 'skills/yad-checks/templates/checks/verified-commits.sh', dest: 'checks/verified-commits.sh', exec: true },
    // The ledger is CI-owned: block non-bot commits to gate-state files on the Product review PRs.
    { src: 'skills/yad-checks/templates/checks/ledger-guard.sh', dest: 'checks/ledger-guard.sh', exec: true },
    // Pattern gates run on the Product too (profile: hub) — commit subject + PR title + PR body.
    { src: 'skills/yad-checks/templates/checks/commit-message.sh', dest: 'checks/commit-message.sh', exec: true },
    { src: 'skills/yad-pr-template/templates/checks/pr-title.sh', dest: 'checks/pr-title.sh', exec: true },
    { src: 'skills/yad-pr-template/templates/checks/pr-template.sh', dest: 'checks/pr-template.sh', exec: true },
  ],
  github: [
    { src: 'skills/yad-hub-bridge/templates/github/yad-gate-sync.yml', dest: '.github/workflows/yad-gate-sync.yml' },
    { src: 'skills/yad-checks/templates/github/yad-verified-commits.yml', dest: '.github/workflows/yad-verified-commits.yml' },
    { src: 'skills/yad-checks/templates/github/yad-hub-checks.yml', dest: '.github/workflows/yad-hub-checks.yml' },
    // Integrity gate for the Product's own direct-to-default pushes (`yad update --push`; the machine-
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

// Harness hooks: the LOCAL half of the ledger rule, installed on the Product beside the CI gates and
// active under the same verified-ledger predicate (#171). Kept out of `PRODUCT_WIRING` because a hook is not a
// CI gate — it is advisory, fails open, and its adapter (below) is per-harness, not per-platform.
export const HOOK_WIRING = [
  { src: 'skills/yad-checks/templates/hooks/ledger-guard.sh', dest: 'hooks/ledger-guard.sh', exec: true },
];

// Per-harness adapter config: which IDE target gets a hook entry written, where, and in what shape.
//
// A harness qualifies for an entry here ONLY if it can run a command BEFORE a file is written and
// refuse it. That is the whole point of the guard: saying "that edit was wrong" after the write has
// landed is what CI already does. Two harnesses are wired, both read from their own docs on
// 2026-09-16. The other install targets were NOT examined for a hook protocol — the scope closed at
// Cursor — so "no entry here" means "not wired", never "checked and found wanting":
//
//   .claude   Claude Code — `PreToolUse` in `.claude/settings.json`, exit 2 blocks the call.
//   .cursor   Cursor — `preToolUse` in `.cursor/hooks.json`, exit 2 is equivalent to `deny`.
//
// Cursor's `afterFileEdit` is deliberately NOT used: it fires once the edit is already on disk, so it
// could report but never refuse, and a guard that reports is the CI gate we already have.
//
// `.agents`, `.gemini`, `.zencoder` and `.opencode` carry skills only. They get the script and no
// wiring; the contract in the script header is what they would wire by hand, and `yad doctor` NAMES
// them rather than staying silent — an unguarded target that nothing mentions reads as a guarded one.
//
// THE TWO FILE SHAPES, which is what `nested` selects:
//   Claude  { hooks: { PreToolUse: [ { matcher, hooks: [ { type: 'command', command } ] } ] } }
//   Cursor  { version: 1, hooks: { preToolUse: [ { matcher, command, failClosed } ] } }
//
// `preamble` is the keys the FILE itself requires beside `hooks` — Cursor's `version`, which its
// loader rejects the file without. Written only when the key is ABSENT: a team that pinned a
// different version has made a choice, and this owns one entry, not their file.
// The harness's own name for the project root. Two things use it, and only one of them is the wiring:
// `yad hook ledger-guard` reads it to anchor a RELATIVE path out of the tool-call payload (see
// `baseDirFor`), and Claude Code's entry also builds its command from it. Cursor's entry does not —
// see the note on that command — but the variable is still what its guard reads, so it belongs here.
// Anchoring a payload path against the wrong root walks up to no Product and fails open, which is a
// guard that is off while every report says it is on.
const CLAUDE_PROJECT_DIR_ENV = 'CLAUDE_PROJECT_DIR';
const CURSOR_PROJECT_DIR_ENV = 'CURSOR_PROJECT_DIR';
const guardCommand = (envVar) => `"$${envVar}/hooks/ledger-guard.sh"`;

export const HOOK_ADAPTERS = Object.freeze({
  '.claude': Object.freeze({
    target: '.claude',
    settings: '.claude/settings.json',
    event: 'PreToolUse',
    nested: true,
    preamble: null,
    // The tools that can write a file. A `Bash` call (`sed -i epics/…`) is deliberately NOT matched:
    // matching it would mean parsing shell, and CI's ledger-guard already fails closed on the result.
    matcher: 'Edit|Write|MultiEdit|NotebookEdit',
    // `$CLAUDE_PROJECT_DIR` so the entry works whatever the harness's working directory is — QUOTED,
    // because the harness runs this through a shell: unquoted, a project path containing a space
    // word-splits, the command is not found, and the guard is silently off while `check` and `doctor`
    // both still report it wired. (Cursor's command below is spelled the opposite way, and the note
    // there says why — the two harnesses document different guarantees, so one spelling cannot serve
    // both.)
    projectDirEnv: CLAUDE_PROJECT_DIR_ENV,
    command: guardCommand(CLAUDE_PROJECT_DIR_ENV),
    // Claude Code reads the exit code, so the shared script needs no wrapper here.
    wiring: Object.freeze([]),
    // Spellings a previous yadflow wrote for the SAME hook. An installed entry matching one of these
    // is ours to normalise; anything else is the team's, even if it names a similar path. Never widen
    // this to a substring test — a team keeping its own wrapper at `.claude/hooks/ledger-guard.sh`
    // would have their hook silently rewritten to ours.
    legacyCommands: Object.freeze(['$CLAUDE_PROJECT_DIR/hooks/ledger-guard.sh']), // 3.16.x, pre-quoting
  }),
  '.cursor': Object.freeze({
    target: '.cursor',
    settings: '.cursor/hooks.json',
    event: 'preToolUse',
    nested: false,
    preamble: Object.freeze({ version: 1 }),
    // Cursor's file-writing tool names, which are NOT Claude's — copying `Edit|Write|MultiEdit` across
    // would leave `Delete` unmatched and `MultiEdit` matching a tool Cursor does not have. `Shell` is
    // left out for the same reason `Bash` is above. `Write` and `Delete` are named in Cursor's docs;
    // `Edit` is not, because that list is written as "values include" and does not enumerate the edit
    // tools. It is kept anyway: a name too many costs one regex alternative that never matches, and a
    // name too few is a write nothing intercepts.
    matcher: 'Write|Edit|Delete',
    // Cursor's `preToolUse` is a PERMISSION hook: it answers in JSON on stdout, and empty stdout is
    // invalid JSON, which BLOCKS. So the plain guard cannot be wired here — it prints nothing when it
    // allows, which would have blocked every file write in a verified project. This wrapper, installed
    // with the adapter below, always prints a permission answer. It takes no arguments on purpose:
    // Cursor holds one command STRING and does not document whether it is split by a shell.
    wiring: Object.freeze([
      Object.freeze({ src: 'skills/yad-checks/templates/hooks/ledger-guard-cursor.sh', dest: 'hooks/ledger-guard-cursor.sh', exec: true }),
    ]),
    // RELATIVE, and deliberately not `$CURSOR_PROJECT_DIR/…` — the opposite of the Claude entry above,
    // for a documented reason. Cursor's docs say a project hook RUNS FROM THE PROJECT ROOT, which is
    // the directory holding the `.cursor/hooks.json` this entry lives in, and the same directory
    // holding `hooks/ledger-guard.sh`. So the relative path always resolves, whatever the harness's
    // notion of cwd elsewhere.
    //
    // What they do NOT say is whether the command runs through a shell. That is exactly why there is
    // no variable and no quotes here: `$CURSOR_PROJECT_DIR` never expanded would be a command not
    // found, and quotes taken literally by a non-shell exec would be part of the filename. An
    // unquoted relative path with no variable and no space is the one spelling that works either way
    // — which matters, because every one of those failures is silent, fails OPEN, and leaves
    // `yad doctor` truthfully reporting the entry as wired while nothing is ever refused.
    projectDirEnv: CURSOR_PROJECT_DIR_ENV,
    command: 'hooks/ledger-guard-cursor.sh',
    // Nothing shipped before this release, so there is no past spelling of ours to normalise.
    legacyCommands: Object.freeze([]),
  }),
});

// The Claude adapter's fields under their original names. Kept because they are what the shipped
// error text and the existing tests name, and renaming a constant buys nothing; new code should read
// the adapter, since these three describe ONE harness and the engine now supports two.
export const CLAUDE_HOOK_ADAPTER = HOOK_ADAPTERS['.claude'];
export const HOOK_SETTINGS = Object.freeze(
  Object.fromEntries(Object.values(HOOK_ADAPTERS).map((a) => [a.target, a.settings])),
);
// Every harness variable that names the project root, for `baseDirFor` in `hook.mjs` to try in turn.
// Derived from the adapters, so adding a harness up there arms the guard's path resolution too.
export const HOOK_PROJECT_DIR_ENVS = Object.freeze(Object.values(HOOK_ADAPTERS).map((a) => a.projectDirEnv));
export const HOOK_TOOL_MATCHER = CLAUDE_HOOK_ADAPTER.matcher;
export const HOOK_COMMAND = CLAUDE_HOOK_ADAPTER.command;
export const HOOK_COMMAND_LEGACY = CLAUDE_HOOK_ADAPTER.legacyCommands;
