// The single source of truth for what a set-up SDLC project should contain.
// Drives setup (install from), update (re-sync), and check (diff against).
// Keep the skill list here in sync with skills/sdlc/install.sh.
import { readFileSync } from 'node:fs';

// Read the version from package.json (the one source of truth) so it always
// tracks the semantic-release-managed version — never a hardcoded constant
// that would drift after a release. package.json ships in the npm tarball and
// sits at the package root, one level up from this cli/ dir.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = version;

// The 17 hand-authored yad-* skills (mirrors skills/sdlc/install.sh).
export const SKILLS = [
  'yad-analysis',
  'yad-epic',
  'yad-architecture',
  'yad-ui',
  'yad-stories',
  'yad-connect-repos',
  'yad-spec',
  'yad-implement',
  'yad-checks',
  'yad-pr-template',
  'yad-review-comments',
  'yad-hub-bridge',
  'yad-ship',
  'yad-backfill',
  'yad-run',
  'yad-review-gate',
  'yad-status',
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
  'yad-review-comments': 'sdlc-review-comments',
  'yad-hub-bridge': 'sdlc-hub-bridge',
  'yad-ship': 'sdlc-ship',
  'yad-backfill': 'sdlc-backfill',
  'yad-run': 'sdlc-run',
  'yad-review-gate': 'sdlc-review-gate',
  'yad-status': 'sdlc-status',
};

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
export const IDE_FOLDER_TARGETS = ['.claude', '.agents', '.zencoder']; // <ide>/skills/<skill>/ (folder copy)
export const IDE_OPENCODE_DIR = '.opencode/commands'; // <skill>.md (flat SKILL.md copy)

// Module registration files copied from skills/sdlc/ into _bmad/sdlc/.
export const MODULE_FILES = ['config.yaml', 'module-help.csv'];

// Project-level files setup produces (used by `check` to spot missing setup).
export const PROJECT_FILES = {
  reposRegistry: '.sdlc/repos.json',
  hubConfig: '.sdlc/hub.json',
  version: '.sdlc/cli-version.json',
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

// Per-epic ledger files under epics/<epic>/.sdlc/ (the file source of truth the gate reads/writes).
export const epicFiles = (epicRoot) => ({
  state: `${epicRoot}/.sdlc/state.json`,
  approvals: `${epicRoot}/.sdlc/approvals.json`,
  comments: `${epicRoot}/.sdlc/comments.json`,
  hubPrs: `${epicRoot}/.sdlc/hub-prs.json`,
  contractLock: `${epicRoot}/.sdlc/contract-lock.json`,
});

// Per-repo wiring: src is relative to PKG_ROOT, dest relative to the repo root.
// `common` always installs; the platform key installs by detected platform.
export const REPO_WIRING = {
  common: [
    { src: 'skills/yad-checks/templates/checks/spec-link.sh', dest: 'checks/spec-link.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/contract-check.sh', dest: 'checks/contract-check.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/build-test-lint.sh', dest: 'checks/build-test-lint.sh', exec: true },
    { src: 'skills/yad-checks/templates/checks/verified-commits.sh', dest: 'checks/verified-commits.sh', exec: true },
    { src: 'skills/yad-pr-template/templates/checks/risk-route.sh', dest: 'checks/risk-route.sh', exec: true },
  ],
  github: [
    { src: 'skills/yad-checks/templates/github/yad-checks.yml', dest: '.github/workflows/yad-checks.yml' },
    { src: 'skills/yad-pr-template/templates/github/pull_request_template.md', dest: '.github/pull_request_template.md' },
    { src: 'skills/yad-review-comments/templates/github/REVIEW_COMMENTS.md', dest: '.github/REVIEW_COMMENTS.md' },
  ],
  gitlab: [
    { src: 'skills/yad-checks/templates/gitlab/yad-checks.gitlab-ci.yml', dest: '.gitlab/ci/yad-checks.yml' },
    { src: 'skills/yad-pr-template/templates/gitlab/merge_request_templates/Default.md', dest: '.gitlab/merge_request_templates/Default.md' },
    { src: 'skills/yad-review-comments/templates/gitlab/REVIEW_COMMENTS.md', dest: '.gitlab/REVIEW_COMMENTS.md' },
  ],
};

export const wiringFor = (platform) => [
  ...REPO_WIRING.common,
  ...(REPO_WIRING[platform] || []),
];

// Hub wiring: CI installed on the PRODUCT HUB itself (dest is the project root — the hub IS the
// root). Installed only when hub.json has a platform and the bridge is enabled. Carries the
// event-driven gate sync (approvals/change requests/the merge trigger `yad gate ci`) and the
// verified-commits gate (no unverified commits from unverified users reach merge on the hub).
export const HUB_WIRING = {
  common: [
    { src: 'skills/yad-checks/templates/checks/verified-commits.sh', dest: 'checks/verified-commits.sh', exec: true },
  ],
  github: [
    { src: 'skills/yad-hub-bridge/templates/github/yad-gate-sync.yml', dest: '.github/workflows/yad-gate-sync.yml' },
    { src: 'skills/yad-checks/templates/github/yad-verified-commits.yml', dest: '.github/workflows/yad-verified-commits.yml' },
  ],
  gitlab: [
    { src: 'skills/yad-hub-bridge/templates/gitlab/yad-gate-sync.gitlab-ci.yml', dest: '.gitlab/ci/yad-gate-sync.yml' },
    { src: 'skills/yad-checks/templates/gitlab/yad-verified-commits.gitlab-ci.yml', dest: '.gitlab/ci/yad-verified-commits.yml' },
  ],
};
