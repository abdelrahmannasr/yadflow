import type { StakeholderView } from './types';

// Structured reference data for the yadflow SDLC-overview site. Shapes are kept
// compatible with the vendored Reference components (which were re-labelled to
// yadflow); the reference content was fully replaced.

interface Filterable {
  visibleTo: StakeholderView[];
}

const ALL: StakeholderView[] = [
  'analyst', 'pm', 'architect', 'ux-designer', 'dev',
  'tester', 'reviewer', 'engineer', 'maintainer',
];
const BUILD: StakeholderView[] = ['dev', 'engineer', 'maintainer', 'tester'];

// ─── Gate routing decision (the review-gate rule, by review) ───
// Reuses the DecisionBranch shape (condition → result + detail).

export interface DecisionBranch {
  condition: string;
  result: string;
  detail?: string;
  visibleTo: StakeholderView[];
}

export const DECISION_TREE: DecisionBranch[] = [
  {
    condition: 'Base review (epic, UI, analysis, test-cases)',
    result: 'owner + 1 reviewer',
    detail: 'The default gate rule: the artifact owner plus one non-owner reviewer must approve before the step advances.',
    visibleTo: ALL,
  },
  {
    condition: 'risk_tags include contract / auth / payments',
    result: 'escalate to domain owners',
    detail: 'Architecture+contract escalates: base rule PLUS a domain owner for every repo in epic.repos. The contract-surface hash must still match contract-lock.json.',
    visibleTo: ALL,
  },
  {
    condition: 'Per-repo review (stories)',
    result: 'base + a domain owner per touched repo',
    detail: 'Each repo that appears in any story.repos contributes its engineer as a required reviewer.',
    visibleTo: ALL,
  },
];

// ─── The two dials (per step) — rendered via the dial-state tables ───
// Reuses the DialState shape: state / endpoint / schemaValue / isTerminal.

export interface DialState extends Filterable {
  state: string;
  endpoint: string;
  schemaValue: string;
  isTerminal: boolean;
  description: string;
}

// Assistance dial values.
export const ASSISTANCE_DIAL_STATES: DialState[] = [
  {
    state: 'none',
    endpoint: 'state.json · per step',
    schemaValue: 'assistance: none',
    isTerminal: false,
    description: 'No AI help — the human authors the step entirely.',
    visibleTo: ALL,
  },
  {
    state: 'review',
    endpoint: 'state.json · per step',
    schemaValue: 'assistance: review',
    isTerminal: false,
    description: 'Default. AI drafts; the human reviews and edits.',
    visibleTo: ALL,
  },
  {
    state: 'heavy',
    endpoint: 'state.json · per step',
    schemaValue: 'assistance: heavy',
    isTerminal: false,
    description: 'AI does most of the work; the human still owns the gate.',
    visibleTo: ALL,
  },
];

// Automation dial values.
export const AUTOMATION_DIAL_STATES: DialState[] = [
  {
    state: 'human_approve',
    endpoint: 'state.json · per step',
    schemaValue: 'automation: human_approve',
    isTerminal: false,
    description: 'Default. A human advances the step. Front states + engineer-review are locked here forever.',
    visibleTo: ALL,
  },
  {
    state: 'machine_advance',
    endpoint: 'state.json · per step',
    schemaValue: 'automation: machine_advance',
    isTerminal: true,
    description: 'Earned per back step once its trust slice clears the threshold; the orchestrator advances it on its own.',
    visibleTo: ALL,
  },
];

// ─── Check gates (the CI gates) — rendered via the check-gates list ───
// Reuses the CheckGate shape: name / queue / timing / description / triggeredBy.

export interface CheckGate extends Filterable {
  name: string;
  queue: string;
  timing: string;
  description: string;
  triggeredBy: string;
}

export const CHECK_GATES: CheckGate[] = [
  {
    name: 'spec-link',
    queue: 'yad-checks',
    timing: 'per commit',
    description: 'Every non-maintenance commit must link a real story/spec via its Task: trailer — checked per commit; ci/chore/build/test maintenance commits are exempt.',
    triggeredBy: 'GitHub Actions / GitLab CI (yad-checks.yml)',
    visibleTo: ALL,
  },
  {
    name: 'contract-check',
    queue: 'yad-checks',
    timing: 'on contract-surface diff',
    description: 'A diff that changes the contract surface without a Contract-Change + a re-locked contract FAILS and routes back to the architecture gate.',
    triggeredBy: 'specs/*/contracts/** changed',
    visibleTo: ALL,
  },
  {
    name: 'build-test-lint',
    queue: 'yad-checks',
    timing: 'on every PR/MR',
    description: 'The repo builds, its tests pass, and the linter is clean. CI caps jest/vitest test workers (YAD_TEST_MAX_WORKERS, default 2); other runners are unaffected.',
    triggeredBy: 'PR/MR opened or updated',
    visibleTo: ALL,
  },
  {
    name: 'verified-commits',
    queue: 'yad-checks',
    timing: 'on every commit',
    description: 'Commits are platform-Verified (signed) and authored by a roster-known author.',
    triggeredBy: 'push / PR sync',
    visibleTo: ALL,
  },
  {
    name: 'commit-message',
    queue: 'pattern-gate',
    timing: 'on every commit',
    description: 'Conventional-Commits subject + the fixed trailer order (Task → Contract-Change → Co-Authored-By). Profile-aware code | hub.',
    triggeredBy: 'push / PR sync',
    visibleTo: ALL,
  },
  {
    name: 'pr-title',
    queue: 'pattern-gate',
    timing: 'once the PR exists',
    description: 'The PR/MR title follows the commit-subject style. Profile-aware code | hub; on the hub it splits by head branch (review/EP-* → artifact-review shape, any other branch → code shape).',
    triggeredBy: 'PR/MR opened',
    visibleTo: ALL,
  },
  {
    name: 'pr-template',
    queue: 'pattern-gate',
    timing: 'once the PR exists',
    description: 'The PR/MR body uses the committed template (Impact & Risk block). On the hub it rejects a non-review branch that changes a front-half artifact (epics/**).',
    triggeredBy: 'PR/MR opened',
    visibleTo: ALL,
  },
  {
    name: 'lineage-check',
    queue: 'yad-checks',
    timing: 'per commit',
    description: 'A change/defect/hotfix epic must thread to a real parent (genesis → change → defect). Layered on spec-link\'s story→epic resolution; fails closed on an unresolvable base; degrades to PASS-with-note when the hub is unreachable from CI.',
    triggeredBy: 'GitHub Actions / GitLab CI (yad-checks.yml)',
    visibleTo: ALL,
  },
  {
    name: 'epic-open',
    queue: 'yad-checks',
    timing: 'per commit',
    description: 'A sealed epic (all stories shipped) refuses new behaviour, forcing a new threaded change-epic — so the front artifacts can never go stale, only superseded.',
    triggeredBy: 'GitHub Actions / GitLab CI (yad-checks.yml)',
    visibleTo: ALL,
  },
  {
    name: 'reconcile-debt',
    queue: 'yad-checks',
    timing: 'per commit',
    description: 'A thread with open hotfix debt is frozen until the debt is paid (the reconcile that a gate-skipping fast fix owes).',
    triggeredBy: 'GitHub Actions / GitLab CI (yad-checks.yml)',
    visibleTo: ALL,
  },
];

// ─── Connectors (the registries the setup phase writes) — "feature flags" matrix ───
// Reuses FeatureFlag shape: name / envVar / defaultValue / stagingValue / productionValue.
// defaultValue = is it committed?  stagingValue = MCP/CLI available?  productionValue = degrades gracefully?

export interface FeatureFlag extends Filterable {
  name: string;
  envVar: string;
  defaultValue: boolean;
  stagingValue: boolean;
  productionValue: boolean;
  description: string;
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    name: 'repos.json',
    envVar: 'yad-connect-repos',
    defaultValue: true,
    stagingValue: true,
    productionValue: true,
    description: 'Connect code repos (GitHub/GitLab) and cache a Repomix pack + code-map per repo so the front phases are code-aware. Staleness tracked by HEAD sha.',
    visibleTo: ALL,
  },
  {
    name: 'design.json',
    envVar: 'yad-connect-design',
    defaultValue: true,
    stagingValue: false,
    productionValue: true,
    description: 'Connect a design tool (Figma-first, via MCP). Degrades to markdown-only when no MCP is present.',
    visibleTo: ALL,
  },
  {
    name: 'testing.json',
    envVar: 'yad-connect-testing',
    defaultValue: true,
    stagingValue: false,
    productionValue: true,
    description: 'Connect a testing tool (Playwright-first, via MCP). Degrades to artifacts-only when no MCP is present.',
    visibleTo: ALL,
  },
  {
    name: 'learning.json',
    envVar: 'yad-connect-learning',
    defaultValue: true,
    stagingValue: false,
    productionValue: true,
    description: 'Connect DeepTutor (a CLI subprocess, not an MCP). Degrades to harness-native tutoring when the CLI is absent.',
    visibleTo: ALL,
  },
  {
    name: 'docs.json',
    envVar: 'yad-connect-docs',
    defaultValue: true,
    stagingValue: true,
    productionValue: true,
    description: 'Connect a Pages target (github-pages / gitlab-pages), auto-detected from hub.json. Degrades to build-only.',
    visibleTo: ALL,
  },
];

// ─── The yad CLI commands — rendered via the CLI-command chips ───
// Reuses the CliCommand shape: constant / value / target / category / description.
// target 'setup' = setup/front commands · 'build' = build/automation commands.

export interface CliCommand extends Filterable {
  constant: string;
  value: string;
  target: 'setup' | 'build';
  category: string;
  description: string;
}

export const CLI_COMMANDS: CliCommand[] = [
  { constant: 'SETUP', value: 'yad setup', target: 'setup', category: 'setup', description: 'Guided first-run wizard: a short profile interview (solo/team, greenfield/brownfield, monorepo/separate) then the branched steps — install, detect the hub, connect tools + repos.', visibleTo: ALL },
  { constant: 'NEXT', value: 'yad next', target: 'setup', category: 'setup', description: 'Where am I / what next: the one concrete next action — project-wide or per epic (yad next <epic>). In the build half it reads each story\'s build-state and prints the next build sub-step per repo (spec → tasks → implement → checks → engineer-review) plus the remaining chain; --check <step> guards step order.', visibleTo: ALL },
  { constant: 'CHECK', value: 'yad check --fix', target: 'setup', category: 'setup', description: 'Reconcile the install: fill what is missing and update what changed.', visibleTo: ALL },
  { constant: 'DOCTOR', value: 'yad doctor', target: 'setup', category: 'setup', description: 'Environment + state health; exit 1 on any failure (--json for CI).', visibleTo: ALL },
  { constant: 'SYNC_STATUS', value: 'yad sync-status', target: 'setup', category: 'setup', description: 'Reconcile each artifact’s frontmatter status (draft → in-review → approved) with .sdlc/state.json — all epics, or one (yad sync-status <epic>); --dry-run to preview. Advance-only; locked/in-build/shipped are left alone. Runs automatically after a local gate open/sync.', visibleTo: ALL },
  { constant: 'ROSTER', value: 'yad roster', target: 'setup', category: 'setup', description: 'Manage the reviewer roster + per-repo roles any time: list / add (repo-driven walk) / grant / revoke / remove. Domain-owner grants sync repos.json.', visibleTo: ALL },
  { constant: 'GATE', value: 'yad gate open|sync', target: 'setup', category: 'front', description: 'Drive the front-half review PR/MR; sync approvals into the ledger and auto-advance on merge.', visibleTo: ALL },
  { constant: 'COMMIT', value: 'yad commit', target: 'build', category: 'build', description: 'Commit one staged atomic change by the conventions (subject + trailers + ≤3-file guard).', visibleTo: BUILD },
  { constant: 'OPEN_PR', value: 'yad open-pr', target: 'build', category: 'build', description: 'Open a code-repo task PR/MR from the committed platform template.', visibleTo: BUILD },
  { constant: 'SHIP', value: 'yad ship', target: 'build', category: 'build', description: 'Commit AND open the task PR/MR in one step (commit, then open-pr).', visibleTo: BUILD },
  { constant: 'CHECKPOINT', value: 'yad checkpoint', target: 'build', category: 'build', description: 'Commit the machine-written back-half ledgers (trust-log/build-log/build-state) — plus any story status: flip (→ in-build/shipped) now backed by a build-log ship (#112) — as one chore(hub) audit-trail commit; default branch only, allowlist-scoped; called by yad-run / yad-engineer-review.', visibleTo: BUILD },
  { constant: 'TIDY', value: 'yad tidy up', target: 'build', category: 'build', description: 'Fold a shipped story\'s finished trust-log/build-log shards back into the single folded ledger file — the manual "pack it up" companion to the shard-then-fold storage (like git gc for loose objects). Default branch only, --push to push; a no-op when nothing is foldable.', visibleTo: BUILD },
  { constant: 'REPO', value: 'yad repo list|refresh', target: 'build', category: 'build', description: 'List connected repos as fresh/stale and re-pack a stale one.', visibleTo: BUILD },
  { constant: 'DOCS', value: 'yad docs', target: 'build', category: 'automation', description: 'Build / deploy the generated documentation sites.', visibleTo: BUILD },
  { constant: 'THREAD', value: 'yad thread', target: 'build', category: 'change', description: 'Print a feature thread (genesis → change → defect) with its resolved current truth and any open hotfix debt — yad thread <epic>.', visibleTo: ALL },
  { constant: 'RECONCILE', value: 'yad reconcile', target: 'build', category: 'change', description: 'Advisory drift / orphan / debt sweep across threads (mirrors yad docs sync). Check | refresh | wire.', visibleTo: ALL },
];

// ─── Error / status codes — rendered via the Troubleshooting accordion ───

export interface ErrorCode extends Filterable {
  code: string;
  httpStatus?: number;
  cause: string;
  resolution: string;
  severity: 'info' | 'warn' | 'critical';
}

export const ERROR_CODES: ErrorCode[] = [
  {
    code: 'YAD-ENV-001',
    cause: 'git is not installed or not on PATH.',
    resolution: 'Install git — every yad command needs it.',
    severity: 'critical',
    visibleTo: ALL,
  },
  {
    code: 'YAD-ENV-002',
    cause: 'Platform CLI (gh/glab) missing or not authenticated.',
    resolution: 'Install it and authenticate to the hub\'s host (gh auth login / glab auth login --hostname <host>); the check is scoped to the hub host, so an unrelated stale login elsewhere will not trip it. The gate degrades to file-only without the CLI.',
    severity: 'warn',
    visibleTo: ALL,
  },
  {
    code: 'YAD-ENV-003',
    cause: 'Node.js older than the supported range.',
    resolution: 'Install Node >= 18.',
    severity: 'critical',
    visibleTo: ALL,
  },
  {
    code: 'YAD-STATE-001',
    cause: 'A ledger/config JSON file exists but does not parse.',
    resolution: 'Fix the file or restore from git — never delete a ledger blindly.',
    severity: 'critical',
    visibleTo: BUILD,
  },
  {
    code: 'YAD-STATE-003',
    cause: 'A registered repo path is missing or not a git repo.',
    resolution: 'Fix the path in .sdlc/repos.json or re-connect the repo.',
    severity: 'warn',
    visibleTo: BUILD,
  },
  {
    code: 'YAD-STATE-005',
    cause: 'An authoring step is stranded behind its completed review gate — it blocks every later step, including the parallel test-cases track.',
    resolution: 'Run yad gate repair <epic> (add --push to commit the fix to the default branch).',
    severity: 'critical',
    visibleTo: BUILD,
  },
  {
    code: 'YAD-CFG-001',
    cause: 'hub.json names an unknown platform.',
    resolution: 'Expected github, gitlab, or null — fix it or re-run yad setup.',
    severity: 'info',
    visibleTo: BUILD,
  },
  {
    code: 'YAD-CFG-005',
    cause: 'hub.json sets a platform but is missing git_url (needed to scope the auth probe and open PRs).',
    resolution: 'Add git_url to .sdlc/hub.json, or re-run yad setup — it backfills it from the origin remote.',
    severity: 'warn',
    visibleTo: BUILD,
  },
];

// ─── Phase → artifact mapping (reference display) ───

export interface StatusMapping extends Filterable {
  step: string;
  writes: string;
  category: string;
}

export const STATUS_MAPPINGS: StatusMapping[] = [
  { step: 'analysis (optional)', writes: 'analysis.md', category: 'Front', visibleTo: ALL },
  { step: 'epic', writes: 'epic.md', category: 'Front', visibleTo: ALL },
  { step: 'architecture', writes: 'architecture.md · contract.md · contract-lock.json', category: 'Front', visibleTo: ALL },
  { step: 'ui-design (optional)', writes: 'ui-design.md · DESIGN.md', category: 'Front', visibleTo: ALL },
  { step: 'stories', writes: 'stories/EP-<slug>-S0N.md', category: 'Front', visibleTo: ALL },
  { step: 'test-cases', writes: 'test-cases.md · test-links.json', category: 'Front (parallel)', visibleTo: ALL },
  { step: 'spec', writes: 'specs/<story-id>/', category: 'Build', visibleTo: ALL },
  { step: 'implement', writes: 'branch + commit (Task: trailer)', category: 'Build', visibleTo: ALL },
  { step: 'checks', writes: 'checks/*.sh · yad-checks.yml', category: 'Build', visibleTo: ALL },
  { step: 'engineer-review', writes: 'build-log.json (shard-then-fold)', category: 'Build', visibleTo: ALL },
  { step: 'run', writes: 'build-state/<story-id>.json · trust-log.json (shard-then-fold)', category: 'Automation', visibleTo: ALL },
  { step: 'checkpoint', writes: 'commits trust-log.json · build-log.json · build-state/<story-id>.json (chore(hub))', category: 'Automation', visibleTo: ALL },
  { step: 'tidy up', writes: 'folds trust-log/build-log shards → folded file (chore(hub))', category: 'Automation', visibleTo: ALL },
];
