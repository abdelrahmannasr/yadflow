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

// The 16 hand-authored sdlc-* skills (mirrors skills/sdlc/install.sh).
export const SKILLS = [
  'sdlc-author-epic',
  'sdlc-author-architecture',
  'sdlc-author-ui',
  'sdlc-author-stories',
  'sdlc-connect-repos',
  'sdlc-spec',
  'sdlc-implement',
  'sdlc-checks',
  'sdlc-pr-template',
  'sdlc-review-comments',
  'sdlc-hub-bridge',
  'sdlc-ship',
  'sdlc-backfill',
  'sdlc-run',
  'sdlc-review-gate',
  'sdlc-status',
];

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

// Per-repo wiring: src is relative to PKG_ROOT, dest relative to the repo root.
// `common` always installs; the platform key installs by detected platform.
export const REPO_WIRING = {
  common: [
    { src: 'skills/sdlc-checks/templates/checks/spec-link.sh', dest: 'checks/spec-link.sh', exec: true },
    { src: 'skills/sdlc-checks/templates/checks/contract-check.sh', dest: 'checks/contract-check.sh', exec: true },
    { src: 'skills/sdlc-checks/templates/checks/build-test-lint.sh', dest: 'checks/build-test-lint.sh', exec: true },
    { src: 'skills/sdlc-pr-template/templates/checks/risk-route.sh', dest: 'checks/risk-route.sh', exec: true },
  ],
  github: [
    { src: 'skills/sdlc-checks/templates/github/sdlc-checks.yml', dest: '.github/workflows/sdlc-checks.yml' },
    { src: 'skills/sdlc-pr-template/templates/github/pull_request_template.md', dest: '.github/pull_request_template.md' },
    { src: 'skills/sdlc-review-comments/templates/github/REVIEW_COMMENTS.md', dest: '.github/REVIEW_COMMENTS.md' },
  ],
  gitlab: [
    { src: 'skills/sdlc-checks/templates/gitlab/sdlc-checks.gitlab-ci.yml', dest: '.gitlab/ci/sdlc-checks.yml' },
    { src: 'skills/sdlc-pr-template/templates/gitlab/merge_request_templates/Default.md', dest: '.gitlab/merge_request_templates/Default.md' },
    { src: 'skills/sdlc-review-comments/templates/gitlab/REVIEW_COMMENTS.md', dest: '.gitlab/REVIEW_COMMENTS.md' },
  ],
};

export const wiringFor = (platform) => [
  ...REPO_WIRING.common,
  ...(REPO_WIRING[platform] || []),
];
