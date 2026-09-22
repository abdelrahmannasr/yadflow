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
    condition: 'Every review (analysis, epic, UI, test-cases, architecture, stories)',
    result: 'base: 1 approver, who should not be the author (enforced)',
    detail: 'The base is what holds the gate: at least 1 distinct approver, who should not be the author, every comment thread resolved, and the review PR/MR merged. yadflow does not compare the approver with the author: GitHub never lets you approve your own PR, and GitLab stops it only when its approval settings say so. There are no roles and no stored list of people: anyone with access to the repo can approve, and the platform records who did (their login).',
    visibleTo: ALL,
  },
  {
    condition: 'risk_tags include contract / auth / payments',
    result: 'full count = base 1 + risk step, capped at active people − 1 (advisory)',
    detail: 'The risk step is +2 for a contract tag and +1 for auth or payments — the highest tag, never the sum. It counts people, not roles. The engine caps the count at the active people less one, never below 1: a contract gate asks 3, and with 2 active people the capped ask is 1 (one seat is left for the author). But the risk step is advisory. A later yadflow change will enforce it together with yad gate lower --reason, a recorded way out of a gate a team cannot meet. Until then the gate prints the capped count and the shortfall (for example "1 short") and holds only on the base. The number of active people is counted live and printed next to the ask: committed or approved, from the approval and ship records plus git authorship in the product and every connected repo, over a window that scales with how fast the team merges (the last 20 merged PRs, bounded 30-180 days, and the wide end when there are fewer than 20). Nothing is stored. A source that cannot be read makes it "NOT COUNTED" rather than a number, because a small count lowers what a gate asks for. Then no cap is shown. The cap is not enforced yet because the count of people can read high: a git name and a platform login are two people until proven one, so a two-person team can read as four. A later yadflow change will enforce the capped count together with yad gate lower --reason, the way out, once the count is accurate. Until then, under a team gate that has not passed, yad gate status and yad gate sync print a warning line when the count of people suggests the gate may not pass: "! may not be met:" about the one approval enforced today, or "! if the risk step were enforced:" about what enforcing more would do. It holds nothing.',
    visibleTo: ALL,
  },
  {
    condition: 'Architecture + contract review',
    result: 'count asks 3 = base 1 + contract risk 2',
    detail: 'The base (1 approver) is enforced; the other 2 are reported as a shortfall, not blocking. The contract-surface hash must still match contract-lock.json. The review PR is labelled domain:<repo> for each repo in epic.repos, as a hint for whom to ask.',
    visibleTo: ALL,
  },
  {
    condition: 'Stories review',
    result: 'an ordinary count gate',
    detail: 'The same count as every other review. The repos that any story touches only label the review PR (domain:<repo>); they add no approvals.',
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
// Driver dial values. `state` is the shape-4 name; `schemaValue` shows BOTH keys, because a step
// carries each dial under two spellings and the OLD one is still what the engine reads.
export const DRIVER_DIAL_STATES: DialState[] = [
  {
    state: 'human',
    endpoint: 'state.json · per step',
    schemaValue: 'driver: human  (assistance: none)',
    isTerminal: false,
    description: 'No AI help — the human authors the step entirely.',
    visibleTo: ALL,
  },
  {
    state: 'pair',
    endpoint: 'state.json · per step',
    schemaValue: 'driver: pair  (assistance: review)',
    isTerminal: false,
    description: 'Default. AI drafts; the human reviews and edits.',
    visibleTo: ALL,
  },
  {
    state: 'agent',
    endpoint: 'state.json · per step',
    schemaValue: 'driver: agent  (assistance: heavy)',
    isTerminal: false,
    description: 'AI does most of the work; the human still owns the gate.',
    visibleTo: ALL,
  },
];

// Advance dial values (same two-spelling rule as the driver dial above).
export const ADVANCE_DIAL_STATES: DialState[] = [
  {
    state: 'human',
    endpoint: 'state.json · per step',
    schemaValue: 'advance: human  (automation: human_approve)',
    isTerminal: false,
    description: 'Default. A human advances the step. Every review gate — engineer-review and each Shape review — stays here forever.',
    visibleTo: ALL,
  },
  {
    state: 'auto',
    endpoint: 'state.json · per step',
    schemaValue: 'advance: auto  (automation: machine_advance)',
    isTerminal: true,
    description: 'Set by the team with yad dial (E34, nothing to earn). On a Build step the orchestrator advances it on its own after a clean run; on a Shape author step it is recorded only, for now.',
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
    description: 'The repo builds, its tests pass, and the linter is clean, run through the package manager package.json#packageManager declares (npm or pnpm, pinned to an exact version via Corepack; npm without the field keeps plain npm ci). CI runs on Node 22 by default (YAD_NODE_VERSION overrides) and caps jest/vitest test workers (YAD_TEST_MAX_WORKERS, default 2); other runners are unaffected.',
    triggeredBy: 'PR/MR opened or updated',
    visibleTo: ALL,
  },
  {
    name: 'verified-commits',
    queue: 'yad-checks',
    timing: 'on every commit',
    description: 'Every commit carries a platform-Verified signature. There is no author allowlist: write access to the repository decides who may author a commit.',
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
    description: 'The PR/MR title follows the commit-subject style. Profile-aware code | hub; on the Product it splits by head branch (review/EP-* → artifact-review shape, any other branch → code shape).',
    triggeredBy: 'PR/MR opened',
    visibleTo: ALL,
  },
  {
    name: 'pr-template',
    queue: 'pattern-gate',
    timing: 'once the PR exists',
    description: 'The PR/MR body uses the committed template (Impact & Risk block). On the Product it rejects a non-review branch that changes a Shape artifact (epics/**).',
    triggeredBy: 'PR/MR opened',
    visibleTo: ALL,
  },
  {
    name: 'lineage-check',
    queue: 'yad-checks',
    timing: 'per commit',
    description: 'A change/defect/hotfix epic must thread to a real parent (genesis → change → defect). Layered on spec-link\'s story→epic resolution; fails closed on an unresolvable base; degrades to PASS-with-note when the Product is unreachable from CI.',
    triggeredBy: 'GitHub Actions / GitLab CI (yad-checks.yml)',
    visibleTo: ALL,
  },
  {
    name: 'epic-open',
    queue: 'yad-checks',
    timing: 'per commit',
    description: 'A sealed epic (all stories shipped) refuses new behaviour, forcing a new threaded change-epic — so the Shape artifacts can never go stale, only superseded.',
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
  {
    name: 'ledger-guard',
    queue: 'yad-hub-checks',
    timing: 'on every Product review PR/MR',
    description: 'Product-only, verified mode only: the gate ledger (.sdlc/{state,approvals,comments,hub-prs}.json, reviews/*.md) is CI-owned, so any commit changing it that is not a verified gate-bot commit FAILS. A brand-new epic\'s ledger is exempt — creation, not mutation (#162); contract-lock.json is artifact-side and exempt too. Fails closed: this is what actually protects the ledger.',
    triggeredBy: 'GitHub Actions / GitLab CI (yad-hub-checks.yml)',
    visibleTo: ALL,
  },
  {
    name: 'ledger-guard (agent hook)',
    queue: 'harness hook',
    timing: 'before an agent\'s file edit',
    description: 'The local half of the rule above (#171): a PreToolUse hook that refuses an agent the CI-owned ledger write at the moment it is attempted and names the command that owns the transition (yad gate open), instead of letting it surface as a CI failure twenty minutes later. Harness-agnostic by contract — stdin takes the tool payload, exit 0 allows, exit 2 denies with the reason on stderr; with --format cursor the verdict is JSON on stdout instead, for a permission-style hook that treats an empty answer as a refusal. Fails OPEN (no yad, no Product, bad config all allow); the CI gate is the authority. Installed by yad setup / check --fix on verified Products.',
    triggeredBy: 'the agent harness (.claude/settings.json → hooks/ledger-guard.sh; .cursor/hooks.json → hooks/ledger-guard-cursor.sh)',
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
    description: 'Connect code repos (GitHub/GitLab) and cache a Repomix pack + code-map per repo so the Shape phases are code-aware. Staleness tracked by HEAD sha.',
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
// target 'setup' = setup/Shape commands · 'build' = build/automation commands.

export interface CliCommand extends Filterable {
  constant: string;
  value: string;
  target: 'setup' | 'build';
  category: string;
  description: string;
}

export const CLI_COMMANDS: CliCommand[] = [
  { constant: 'SETUP', value: 'yad setup', target: 'setup', category: 'setup', description: 'Guided first-run wizard: a short profile interview (solo/team, greenfield/brownfield, monorepo/separate) then the branched steps — install, detect the Product, connect tools + repos.', visibleTo: ALL },
  { constant: 'EPIC_NEW', value: 'yad epic new', target: 'setup', category: 'front', description: 'Start an epic — the engine writes its lifecycle. Seeds epics/EP-<slug>/.sdlc/state.json with the step chain of a lifecycle profile (--profile classic|analysis-first|chore|spike, default classic; chore and spike are the short lanes — epic + stories, with the analysis in front for a spike, and no architecture gate on either), plus empty approvals/comments ledgers and reviews/. --type feature|chore; a change/defect/hotfix needs --parent and takes the parent\'s route, and --inherits epic,architecture,contract,ui-design carries those steps by reference (satisfied, bound to the owning epic\'s hash) — carrying the contract writes a pointer-lock instead of a second contract (E42); the yad-change skill decides what is inherited, and the Product level (the Foundation) is seeded by yad foundation new. Writes no epic.md, no branch and no commit, and refuses an epic that already has a state.json.', visibleTo: ALL },
  { constant: 'FOUNDATION_NEW', value: 'yad foundation new', target: 'setup', category: 'front', description: 'Start the Foundation — the Product level, once per product before any epic (E75). Seeds foundation/.sdlc/state.json (fixed id EP-foundation, the two-step foundation route) plus empty approvals/comments ledgers and foundation/reviews/; the yad-discovery skill then writes the sections (purpose, scope, mvp, roadmap, stack, repos; market and risks optional). Writes no section, no branch and no commit, refuses a second Foundation, and refuses a product still on the old epics/EP-discovery/ — yad migrate --apply converts that on a local ledger.', visibleTo: ALL },
  { constant: 'FOUNDATION_STATUS', value: 'yad foundation status', target: 'setup', category: 'front', description: 'Which roadmap features are started — read-only (E76 follow-up). Reads the Proposed epic id column of the Foundation roadmap.md tables and reports each feature from its epic ledger: planned, in-shape, in-build or shipped. Names feature epics no row proposes, and notes where a hand-written Status disagrees — that column is no longer kept by hand, because editing the approved roadmap makes its approvals read as stale. Reads the old epics/EP-discovery/ spelling too; --json for scripts.', visibleTo: ALL },
  { constant: 'NEXT', value: 'yad next', target: 'setup', category: 'setup', description: 'Where am I / what next: the one concrete next action — project-wide or per epic (yad next <epic>). In Build it reads each story\'s build-state and prints the next build sub-step per repo (spec → tasks → implement → checks → engineer-review) plus the remaining chain; --check <step> guards step order.', visibleTo: ALL },
  { constant: 'SKIP', value: 'yad skip', target: 'setup', category: 'front', description: 'Mark an optional step N/A for one epic: yad skip <epic> <step> --reason "<why>". Which steps are optional comes from the epic\'s route — ui-design on classic and analysis-first, nothing on the chore and spike lanes. The step and its review gate stay in the chain, marked skipped with the reason, who and when recorded, and the gate passes without a review. Refused once the step was authored, its review opened, or work started on a later step. On a verified Product it is also refused once the epic\'s ledger is on the default branch, because only CI writes state.json there.', visibleTo: ALL },
  { constant: 'UNSKIP', value: 'yad unskip', target: 'setup', category: 'front', description: 'Put a skipped step back in the chain: yad unskip <epic> <step> (yad skip <epic> <step> --undo does the same). Removes the skip and its record. Refused once the step that follows the skipped pair is finished, or work has started past it — on classic, once stories are done or their review opens. An epic that reached ready-for-build only by skipping is moved back to the restored step. On a verified Product it is also refused once the epic\'s ledger is on the default branch, because only CI writes state.json there.', visibleTo: ALL },
  { constant: 'DEFER', value: 'yad defer', target: 'setup', category: 'front', description: 'Set an optional step aside to do later: yad defer <epic> <step> --reason "<why, and who is waiting>". Same steps and refusals as yad skip; the chain goes on and the review is still owed. Add --debt when the work is owed back: yad next and yad doctor (step:debt) remind you until its review passes. On a verified Product it is also refused once the epic\'s ledger is on the default branch, because only CI writes state.json there.', visibleTo: ALL },
  { constant: 'UNDEFER', value: 'yad undefer', target: 'setup', category: 'front', description: 'Put a deferred step back: yad undefer <epic> <step>. Removes the deferral and its record, at any time. After later work has finished, the step re-opens beside that work, which stays done, and currentStep does not move. This is also how a debt is paid back; the debt clears when the step review passes. On a verified Product it is also refused once the epic\'s ledger is on the default branch, because only CI writes state.json there.', visibleTo: ALL },
  { constant: 'UNBLOCK', value: 'yad unblock', target: 'setup', category: 'front', description: 'Clear a recorded blocker once the wait is over: yad unblock <epic> <step>. Moves the step off blocked and removes its record in one write, back to in_progress for an author step whose earlier steps have passed, otherwise to todo. Refuses a step that is not blocked. Changes only state.json, never a Build lane in build-state. On a verified Product it is also refused once the epic\'s ledger is on the default branch, because only CI writes state.json there.', visibleTo: ALL },
  { constant: 'DIAL', value: 'yad dial', target: 'setup', category: 'build', description: 'Set a step\'s advance dial (E34): yad dial <step> --to auto|human for a Shape author step, project-wide in .sdlc/automation.json and recorded only for now; yad dial <epic> <story> --repo <name> <step> --to auto|human for a Build lane step in build-state. Shows the step\'s run record as advice, never a refusal. A review gate is refused. No --to only reads.', visibleTo: ALL },
  { constant: 'KILL', value: 'yad kill', target: 'setup', category: 'build', description: 'Kill switch: yad kill --reason <text> holds every step at advance: human, recorded with who, when and why in .sdlc/automation.json.', visibleTo: ALL },
  { constant: 'UNKILL', value: 'yad unkill', target: 'setup', category: 'build', description: 'Turn the kill switch off: each step follows its own dial again. An optional --reason is recorded.', visibleTo: ALL },
  { constant: 'MODE', value: 'yad mode', target: 'setup', category: 'front', description: 'Who must approve (E10): yad mode solo --reason <text> waives approvals on every review gate (the merge and resolved threads still decide); yad mode team counts them again, with an optional --reason. Records who, when and why as mode_set, and writes mode beside the solo flag, which the gates still read. No word reads the mode; in solo mode it also counts the active people and suggests yad mode team when more than one person may work on the Product (E74, a suggestion only — never an automatic switch, and never a suggestion to go solo). A gate that already passed keeps its record; each open review is named and follows the new mode from its next sync.', visibleTo: ALL },
  { constant: 'CHECK', value: 'yad check --fix', target: 'setup', category: 'setup', description: 'Reconcile the install: fill what is missing and update what changed. A managed file you edited (gate script, CI fragment, PR/MR template) is reported as modified and never silently overwritten — .sdlc/managed.json records the sha of every file yad wrote; --overwrite-local replaces them, saving a <file>.yad-orig backup (#164).', visibleTo: ALL },
  { constant: 'DOCTOR', value: 'yad doctor', target: 'setup', category: 'setup', description: 'Environment + state health; exit 1 on any failure (--json for CI). Its shape section reports what schemaVersion this project\'s state files are on against the shape the running release writes — one line for the project and one per epic — warning when files are behind (run yad migrate) and failing when they were written by a NEWER yadflow (upgrade the CLI; migrating would move them backward). Its protection section (E70) asks GitHub or GitLab, with your own login, whether the Product hub\'s branch and each connected repo\'s branch require an approval before a merge — a GitHub ruleset or classic branch protection, or a GitLab approval rule — and warns, word for word, "This repo has no approval rules and no branch protection" only when both are proven. A read that fails says not known, and why (only a repo admin can read GitHub\'s classic protection; GitLab approval rules need Premium). Advisory: never a failure — the platform holds a merge, not yad. In solo mode the facts print as ok, except a required approval, which would block your own merge. YAD_PLATFORM_READ=0 turns the reads off.', visibleTo: ALL },
  { constant: 'SKILL', value: 'yad skill', target: 'setup', category: 'setup', description: 'Choose which skill runs which lifecycle step. The engine ships a default for every step; yad skill bind <step> <skill> records your own in .sdlc/skills.json and yad next names it from then on. Several skills run as a chain, in the order given, each seeing what the one before it produced — every extra one is another model run, and the command says so. yad skill list shows what runs each step and whose choice it is (--json); yad skill unbind <step> goes back to the default. A review gate is refused (yad gate drives those); a step this release does not know is recorded with a warning, because your file wins and yad doctor only reports.', visibleTo: ALL },
  { constant: 'MIGRATE', value: 'yad migrate', target: 'setup', category: 'setup', description: 'Move this project\'s state files onto the shape this yadflow expects. Previews by default — prints what would change and writes nothing; --apply rewrites, copying each file to <file>.yad-orig first. Safe to run twice. A file newer than the engine, or one that does not parse, is reported and never touched. In verified mode the CI-owned gate ledger is skipped, because CI stamps it on its next sync.', visibleTo: ALL },
  { constant: 'HOOK', value: 'yad hook ledger-guard', target: 'setup', category: 'setup', description: 'Harness-invoked, never typed: refuses an agent\'s edit to the CI-owned gate ledger in verified mode and names the command that owns the transition (yad gate open) — the local half of the ledger-guard CI gate (#171). Reads a tool-call payload on stdin (or --path); exit 0 allows, exit 2 denies with the reason on stderr, and --format cursor answers with a JSON verdict on stdout instead. A no-op with a local ledger, and fails open. Wired into .claude/settings.json (and .cursor/hooks.json, via hooks/ledger-guard-cursor.sh) by setup / check --fix; YAD_HOOK_DISABLE=1 skips it.', visibleTo: ALL },
  { constant: 'SYNC_STATUS', value: 'yad sync-status', target: 'setup', category: 'setup', description: 'Reconcile each artifact’s frontmatter status (draft → in-review → approved) with .sdlc/state.json — all epics, or one (yad sync-status <epic>); --dry-run to preview. Advance-only; locked/in-build/shipped are left alone. Runs automatically after a local gate open/sync.', visibleTo: ALL },
  { constant: 'REPORT', value: 'yad report', target: 'setup', category: 'setup', description: 'When a flow breaks, file a bug in the upstream yadflow repo (the yad-report skill). Sends only a safe allowlist — versions, tool booleans, the platform kind (github / gitlab / local), the error code and a scrubbed message, command and flag NAMES — never paths, URLs, names, IDs or flag values. Searches open issues first and shows the exact payload before posting. Offered after an unexpected failure (interactive only; YAD_NO_REPORT=1 turns it off).', visibleTo: ALL },
  { constant: 'GATE', value: 'yad gate open|sync', target: 'setup', category: 'front', description: 'Drive the Shape review PR/MR; sync approvals into the ledger and auto-advance on merge. A step that closes records how: when, on which PR and merge commit, and who merged it (closed, E18).', visibleTo: ALL },
  { constant: 'COMMIT', value: 'yad commit', target: 'build', category: 'build', description: 'Commit one staged atomic change by the conventions (subject + trailers + ≤3-file guard).', visibleTo: BUILD },
  { constant: 'OPEN_PR', value: 'yad open-pr', target: 'build', category: 'build', description: 'Open a code-repo task PR/MR from the committed platform template, based on the repo\'s RESOLVED default branch (repos.json default_branch → the platform → origin/HEAD → main; --base overrides) — never a hardcoded main. Warns when the base is not the platform default, because CodeRabbit skips auto-review there and retargeting later does not undo it (#168). Once the PR is open it prints a reviewer suggestion (E68): who has committed in the touched folders in the last 30 days, and what CODEOWNERS on the base branch lists — a hint only; it requests no reviewer and calls no one an owner.', visibleTo: BUILD },
  { constant: 'SHIP', value: 'yad ship', target: 'build', category: 'build', description: 'Commit AND open the task PR/MR in one step (commit, then open-pr) — same resolved-default-branch base as open-pr.', visibleTo: BUILD },
  { constant: 'CHECKPOINT', value: 'yad checkpoint', target: 'build', category: 'build', description: 'Commit the machine-written Build ledgers (trust-log/build-log/build-state) — plus any story status: flip (→ in-build/shipped) now backed by a build-log ship (#112) — as one chore(hub) audit-trail commit; default branch only, allowlist-scoped; called by yad-run / yad-engineer-review.', visibleTo: BUILD },
  { constant: 'TIDY', value: 'yad tidy up', target: 'build', category: 'build', description: 'Fold a shipped story\'s finished trust-log/build-log shards back into the single folded ledger file — the manual "pack it up" companion to the shard-then-fold storage (like git gc for loose objects). Default branch only, --push to push; a no-op when nothing is foldable.', visibleTo: BUILD },
  { constant: 'REPO', value: 'yad repo list|refresh|sync', target: 'build', category: 'build', description: 'List connected repos as fresh/stale and re-pack a stale one. sync (the yad-sync-repos skill) switches every connected repo to its default branch and fast-forwards it; a repo with local changes is skipped.', visibleTo: BUILD },
  { constant: 'RISK_MAP', value: 'yad risk-map check|draft', target: 'build', category: 'build', description: 'A code repo\'s risk map, .sdlc/risk-map (E65): one line per directory giving it a level — high, medium or low — and never a name. draft adds an unset line for every directory nothing covers and never changes a line; the yad-connect-repos skill has the AI agent read the code and fill each one as guessed, and a person confirms it in a PR. check warns about uncovered directories, dead lines and unconfirmed levels, like the checks/risk-map-check.sh PR check. Advisory. The count (E66): a PR touching a directory the base branch\'s map marks high asks for one more approver — a guessed level counts too; printed by the PR check, risk-route.sh and yad open-pr, never enforced: branch protection holds the merge, and only yad open-pr shows the count capped by the active people. Those three also name who committed in that directory in the last 30 days (E67), the people who can meet the ask: read live from the base branch, never stored.', visibleTo: BUILD },
  { constant: 'CODEOWNERS', value: 'yad codeowners check', target: 'build', category: 'build', description: 'Warn where a code repo\'s CODEOWNERS file looks stale (E69). Facts, also shown by yad doctor: a line that matches no file, a second CODEOWNERS the platform never reads, a GitHub file of 3 MB or more, a line yad cannot read. One hint, in this command only: the @logins with no commit on the checked-out branch in the last 90 days carrying their noreply address — only on a github.com or gitlab.com remote, and never proof that someone left. A shallow clone or a self-managed host says not known. Advisory: a finding never fails the command, and it never writes the file (write / --write is refused): CODEOWNERS is a hint, and a name yad wrote would become an owner the platform can enforce.', visibleTo: BUILD },
  { constant: 'DOCS', value: 'yad docs list|build|deploy|sync', target: 'build', category: 'automation', description: 'Build / deploy the generated documentation sites: one epic\'s site (--epic, from yad-docs) or this project overview site (--overview, from yad-docs-overview). sync (the yad-docs-sync skill) finds stale sites and can rebuild them; --wire installs the Pages CI.', visibleTo: BUILD },
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
    resolution: 'Install it and authenticate to the Product\'s host (gh auth login / glab auth login --hostname <host>); the check is scoped to the Product host, so an unrelated stale login elsewhere will not trip it. The gate degrades to local without the CLI.',
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
    resolution: 'Fix the path in .sdlc/repos.json or re-connect the repo. A sibling repo (../backend) that is simply absent from this checkout only warns.',
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
