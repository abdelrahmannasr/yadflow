import type { FlowPath, FlowStep } from "./types";

// ───────────────────────────────────────────────────────────────────────────
// yadflow pipeline, modeled as one FlowPath per PHASE.
//   1 Setup & connect   2 Front half (human-gated)   3 Build half   4 Automation
// Every step = a yad-* skill or the review gate, in pipeline order. Titles are
// the module-help.csv display-names; descriptions paraphrase its `description`;
// status reuses the SDLC step status; stepState carries the .sdlc artifact
// it writes; messages flow the skill's outputs to the ledger components.
// ───────────────────────────────────────────────────────────────────────────

// ── Phase 1 — Setup & connect ───────────────────────────────────────────────

const setupSteps: FlowStep[] = [
  {
    id: "install",
    title: "Install the Module",
    description:
      "Run `npx yadflow setup` — the guided wizard copies all 35 yad-* skills into your IDE skill dirs and registers the sdlc module. Idempotent; re-run `check --fix` any time.",
    actor: "system",
    status: "installed",
    stepState: "_bmad/sdlc/ registered",
    trigger: "npx yadflow setup",
    handler: "yad setup / install.sh",
    activeComponents: ["product-hub", "platform"],
    messages: [
      { id: "in-1", from: "platform", to: "product-hub", label: "install 35 yad-* skills", type: "write", color: "#2471a3", delay: 0, duration: 800 },
    ],
    sideEffects: { jobs: ".sdlc/cli-version.json stamped" },
  },
  {
    id: "connect-repos",
    title: "Connect Code Repos",
    description:
      "Register N code repos (GitHub/GitLab, local-user auth, no stored tokens) into repos.json and cache an AI-readable Repomix pack + a code-map per repo, secret-scanned. Staleness is tracked by HEAD sha.",
    actor: "system",
    status: "connected",
    stepState: ".sdlc/repos.json",
    trigger: "yad-connect-repos action: connect",
    handler: "yad-connect-repos",
    activeComponents: ["product-hub", "repos-json", "code-repos"],
    messages: [
      { id: "cr-1", from: "code-repos", to: "repos-json", label: "register repo", type: "write", color: "#b7950b", delay: 0, duration: 700 },
      { id: "cr-2", from: "code-repos", to: "product-hub", label: "cache pack.md + code-map.md", type: "write", color: "#2471a3", delay: 800, duration: 800 },
    ],
    sideEffects: { jobs: "repos.json · code-context/<repo>/pack.md · code-map.md" },
  },
  {
    id: "connect-design",
    title: "Connect Design Tool",
    description:
      "Connect a design tool (Figma-first, pluggable) so yad-ui can materialize the actual feature design inside it. Detects the design-tool MCP and degrades to markdown-only when absent.",
    actor: "system",
    status: "connected",
    stepState: ".sdlc/design.json",
    trigger: "yad-connect-design action: connect",
    handler: "yad-connect-design",
    activeComponents: ["product-hub", "design-json", "design-tool"],
    messages: [
      { id: "cd-1", from: "design-tool", to: "design-json", label: "record tool + file refs", type: "write", color: "#ca6f1e", delay: 0, duration: 700 },
    ],
    sideEffects: { jobs: ".sdlc/design.json" },
  },
  {
    id: "connect-testing",
    title: "Connect Testing Tool",
    description:
      "Connect a testing tool (Playwright-first, pluggable) so yad-test-cases can implement the automation tests inside it. Detects the testing-tool MCP and degrades to artifacts-only when absent.",
    actor: "system",
    status: "connected",
    stepState: ".sdlc/testing.json",
    trigger: "yad-connect-testing action: connect",
    handler: "yad-connect-testing",
    activeComponents: ["product-hub", "testing-json", "testing-tool"],
    messages: [
      { id: "ct-1", from: "testing-tool", to: "testing-json", label: "record tool + suite refs", type: "write", color: "#1e8449", delay: 0, duration: 700 },
    ],
    sideEffects: { jobs: ".sdlc/testing.json" },
  },
  {
    id: "connect-learning",
    title: "Connect Learning Tool",
    description:
      "Connect a learning/tutoring tool (DeepTutor-first, a CLI subprocess like Repomix) so the cross-cutting learning layer can tutor any member, at any stage. Degrades to harness-native tutoring when absent.",
    actor: "system",
    status: "connected",
    stepState: ".sdlc/learning.json",
    trigger: "yad-connect-learning action: connect",
    handler: "yad-connect-learning",
    activeComponents: ["product-hub", "learning-json", "learning-tool"],
    messages: [
      { id: "cl-1", from: "learning-tool", to: "learning-json", label: "record tool + KB", type: "write", color: "#2471a3", delay: 0, duration: 700 },
    ],
    sideEffects: { jobs: ".sdlc/learning.json (the only committed learning file)" },
  },
  {
    id: "connect-docs",
    title: "Connect Docs Target",
    description:
      "Connect a docs/Pages publishing target so the generated doc sites can deploy. Auto-detects the platform from hub.json (github→github-pages, gitlab→gitlab-pages, null→build-only) and resolves the Vite base path.",
    actor: "system",
    status: "connected",
    stepState: ".sdlc/docs.json",
    trigger: "yad-connect-docs action: connect",
    handler: "yad-connect-docs",
    activeComponents: ["product-hub", "docs-json", "platform"],
    messages: [
      { id: "dx-1", from: "platform", to: "docs-json", label: "record Pages target + base path", type: "write", color: "#566573", delay: 0, duration: 700 },
    ],
    sideEffects: { jobs: ".sdlc/docs.json" },
  },
  {
    id: "detect-hub",
    title: "Detect Hub & Roster",
    description:
      "Put the hub on a platform: detect GitHub/GitLab from the remote and record reviewers (login → name + per-repo roles) into hub.json. Manage the roster any time with `yad roster` (list / add / grant / revoke / remove). With the bridge enabled, the front-half review runs through a real PR/MR.",
    actor: "system",
    status: "connected",
    stepState: ".sdlc/hub.json",
    trigger: "yad-connect-repos action: detect-hub",
    handler: "yad-connect-repos (detect-hub) / yad roster",
    activeComponents: ["product-hub", "platform", "repos-json"],
    messages: [
      { id: "dh-1", from: "platform", to: "product-hub", label: "detect platform + roster", type: "write", color: "#7d3c98", delay: 0, duration: 800 },
    ],
    sideEffects: { jobs: ".sdlc/hub.json (platform + reviewer roster)" },
  },
];

// ── Phase 2 — Front half (author → review gate, repeated) ───────────────────

// Reusable review-gate step factory — the one gate, reused for all five reviews.
function gateStep(
  idSuffix: string,
  artifact: string,
  rule: string,
  ruleColor: string,
): FlowStep {
  return {
    id: `gate-${idSuffix}`,
    title: `Team Review Gate · ${artifact}`,
    description:
      `The reusable team review + approve gate. Shares the ${artifact} for review, records comments and approvals as files, enforces ${rule}, and advances state ONLY when approval is recorded.`,
    actor: "reviewer",
    status: "in-review",
    stepState: "reviews/*.md · approvals.json",
    trigger: `yad-review-gate artifact: ${artifact}`,
    handler: "yad-review-gate (open → comment → approve → advance)",
    activeComponents: ["product-hub", "approvals-json", "state-json", "platform"],
    messages: [
      { id: `g${idSuffix}-1`, from: "product-hub", to: "platform", label: "open review PR/MR", type: "gate", color: "#ca6f1e", delay: 0, duration: 700 },
      { id: `g${idSuffix}-2`, from: "platform", to: "approvals-json", label: "record approval", type: "gate", color: ruleColor, delay: 800, duration: 700 },
      { id: `g${idSuffix}-3`, from: "approvals-json", to: "state-json", label: "advance currentStep", type: "event", color: "#1e8449", delay: 1600, duration: 700 },
    ],
    sideEffects: { jobs: rule, notifications: "owner + reviewer (escalates on contract/auth/payments)" },
  };
}

// ── Phase 2 — Front-zero · project discovery (optional, once per project) ────

const discoverySteps: FlowStep[] = [
  {
    id: "discovery",
    title: "Project Discovery (optional front-zero)",
    description:
      "Optional front-zero, once per project: with the analyst, pressure-test the product idea — market, competitor, current-state, feasibility, requirements — and write roadmap.md, the feature menu each epic reads. Greenfield AND brownfield; modelled as the reserved epic-zero EP-discovery, it terminates at discovery-done (no build half).",
    actor: "analyst",
    status: "draft",
    stepState: "EP-discovery/ · roadmap.md",
    trigger: "yad-discovery {idea}",
    handler: "yad-discovery",
    activeComponents: ["product-hub", "state-json", "code-repos"],
    messages: [
      { id: "di-1", from: "code-repos", to: "analyst", label: "read code-maps (brownfield)", type: "event", color: "#1e8449", delay: 0, duration: 600 },
      { id: "di-2", from: "analyst", to: "product-hub", label: "write market / feasibility / roadmap.md", type: "write", color: "#2471a3", delay: 700, duration: 800 },
      { id: "di-3", from: "product-hub", to: "state-json", label: "seed EP-discovery → discovery-done", type: "event", color: "#1e8449", delay: 1500, duration: 600 },
    ],
    sideEffects: { jobs: "market-research.md · competitor-analysis.md · current-state.md · feasibility.md · requirements.md · roadmap.md", notifications: "roadmap.md is reference-only — never auto-seeds epics" },
  },
  gateStep("discovery", "discovery artifacts", "owner + 1 reviewer (base rule)", "#1e8449"),
];

// ── Phase 3 — Front half (author → review gate, repeated per epic) ───────────

const frontSteps: FlowStep[] = [
  {
    id: "analysis",
    title: "Author Analysis (optional)",
    description:
      "Optional front state 1: with the analyst, pressure-test a feature idea and write the discovery brief into analysis.md. Assigns the EP-<slug> ID and seeds .sdlc state. If skipped, the epic step does this inline.",
    actor: "analyst",
    status: "draft",
    stepState: "analysis.md",
    trigger: "yad-analysis {idea}",
    handler: "yad-analysis",
    activeComponents: ["product-hub", "state-json", "code-repos"],
    messages: [
      { id: "an-1", from: "code-repos", to: "analyst", label: "read code-maps", type: "event", color: "#1e8449", delay: 0, duration: 600 },
      { id: "an-2", from: "analyst", to: "product-hub", label: "write analysis.md", type: "write", color: "#2471a3", delay: 700, duration: 800 },
      { id: "an-3", from: "product-hub", to: "state-json", label: "seed state.json (EP-<slug>)", type: "write", color: "#2471a3", delay: 1500, duration: 600 },
    ],
    sideEffects: { jobs: "analysis.md · state.json" },
  },
  gateStep("analysis", "analysis.md", "owner + 1 reviewer", "#1e8449"),
  {
    id: "epic",
    title: "Author Epic",
    description:
      "Front state for the epic: shape the idea with the analyst then the pm into epic.md. The entry point when analysis is skipped — assigns the EP-<slug> ID and seeds .sdlc state. Never auto-advances.",
    actor: "pm",
    status: "draft",
    stepState: "epic.md",
    trigger: "yad-epic {idea}",
    handler: "yad-epic",
    activeComponents: ["product-hub", "state-json", "code-repos"],
    messages: [
      { id: "ep-1", from: "code-repos", to: "pm", label: "read code-maps", type: "event", color: "#1e8449", delay: 0, duration: 600 },
      { id: "ep-2", from: "pm", to: "product-hub", label: "write epic.md", type: "write", color: "#2471a3", delay: 700, duration: 800 },
    ],
    sideEffects: { jobs: "epic.md · state.json" },
  },
  gateStep("epic", "epic.md", "owner + 1 reviewer (base rule)", "#1e8449"),
  {
    id: "architecture",
    title: "Author Architecture + Contract",
    description:
      "Front state 3: with the architect, author architecture.md and the locked contract.md (the shared cross-repo surface), then hash-lock the CONTRACT-SURFACE into contract-lock.json. Escalates on the contract risk tag.",
    actor: "architect",
    status: "draft",
    stepState: "architecture.md · contract.md",
    trigger: "yad-architecture {epic}",
    handler: "yad-architecture",
    activeComponents: ["product-hub", "contract-lock", "code-repos"],
    messages: [
      { id: "aa-1", from: "code-repos", to: "architect", label: "cross-check contract vs endpoints", type: "event", color: "#1e8449", delay: 0, duration: 700 },
      { id: "aa-2", from: "architect", to: "product-hub", label: "write architecture.md + contract.md", type: "write", color: "#2471a3", delay: 800, duration: 800 },
      { id: "aa-3", from: "product-hub", to: "contract-lock", label: "hash-lock CONTRACT-SURFACE", type: "write", color: "#566573", delay: 1600, duration: 700 },
    ],
    sideEffects: { jobs: "architecture.md · contract.md · contract-lock.json" },
  },
  gateStep("architecture", "architecture.md", "escalated: base + a domain owner per repo (contract)", "#ca6f1e"),
  {
    id: "ui",
    title: "Author UI Design",
    description:
      "Front state 5: with the ux-designer, author ui-design.md and DESIGN.md, driving Impeccable slash-commands when installed. When a design tool is connected, materializes the screens; degrades to markdown-only.",
    actor: "ux",
    status: "draft",
    stepState: "ui-design.md · DESIGN.md",
    trigger: "yad-ui {epic}",
    handler: "yad-ui",
    activeComponents: ["product-hub", "design-tool", "design-json"],
    messages: [
      { id: "au-1", from: "ux", to: "product-hub", label: "write ui-design.md + DESIGN.md", type: "write", color: "#2471a3", delay: 0, duration: 800 },
      { id: "au-2", from: "ux", to: "design-tool", label: "materialize screens (design-links)", type: "write", color: "#ca6f1e", delay: 900, duration: 800 },
    ],
    sideEffects: { jobs: "ui-design.md · DESIGN.md · design-links.json" },
  },
  gateStep("ui", "ui-design.md", "owner + 1 reviewer (base rule)", "#1e8449"),
  {
    id: "stories",
    title: "Author Stories",
    description:
      "Front state 7: with the pm, break the approved epic into repo-tagged stories with stable EP-<slug>-S0N IDs, one file each under stories/. Reaching ready-for-build lets the build half start.",
    actor: "pm",
    status: "draft",
    stepState: "stories/EP-<slug>-S0N.md",
    trigger: "yad-stories {epic}",
    handler: "yad-stories",
    activeComponents: ["product-hub", "state-json", "code-repos"],
    messages: [
      { id: "as-1", from: "pm", to: "product-hub", label: "write repo-tagged stories", type: "write", color: "#2471a3", delay: 0, duration: 800 },
      { id: "as-2", from: "product-hub", to: "state-json", label: "currentStep → ready-for-build", type: "event", color: "#1e8449", delay: 900, duration: 700 },
    ],
    sideEffects: { jobs: "stories/*.md · state.json" },
  },
  gateStep("stories", "stories/", "per-repo: base + a domain owner for every touched repo", "#ca6f1e"),
  {
    id: "test-cases",
    title: "Author Test Cases (parallel)",
    description:
      "Front state 9 — a PARALLEL, non-blocking track that opens when the stories gate passes (the epic is already ready-for-build). With the test architect, author test-cases.md; implement automation when a tool is connected.",
    actor: "tester",
    status: "ready-for-build",
    stepState: "test-cases.md · test-links.json",
    trigger: "yad-test-cases {epic}",
    handler: "yad-test-cases",
    activeComponents: ["product-hub", "testing-tool", "testing-json"],
    messages: [
      { id: "tc-1", from: "tester", to: "product-hub", label: "write test-cases.md", type: "write", color: "#2471a3", delay: 0, duration: 800 },
      { id: "tc-2", from: "tester", to: "testing-tool", label: "implement automation (test-links)", type: "write", color: "#1e8449", delay: 900, duration: 800 },
    ],
    sideEffects: { jobs: "test-cases.md · test-links.json", notifications: "review never moves currentStep off ready-for-build" },
  },
  gateStep("test-cases", "test-cases.md", "owner + 1 reviewer (base rule)", "#1e8449"),
];

// ── Phase 3 — Build half (per story, per repo) ──────────────────────────────

const buildSteps: FlowStep[] = [
  {
    id: "spec",
    title: "Author Spec (Step A)",
    description:
      "For one ready-for-build story and one of its repos, run the heavy Spec Kit ceremony once (specify→clarify→plan→analyze→checklist→tasks), writing specs/<story-id>/. References the locked contract; never re-invents it.",
    actor: "dev",
    status: "spec'd",
    stepState: "specs/<story-id>/",
    trigger: "yad-spec story:<id> repo:<repo>",
    handler: "yad-spec",
    activeComponents: ["product-hub", "contract-lock", "code-repos"],
    messages: [
      { id: "sp-1", from: "contract-lock", to: "dev", label: "quote locked contract", type: "event", color: "#566573", delay: 0, duration: 600 },
      { id: "sp-2", from: "dev", to: "code-repos", label: "write specs/<story-id>/", type: "write", color: "#2471a3", delay: 700, duration: 800 },
      { id: "sp-3", from: "code-repos", to: "product-hub", label: "link.md back to story", type: "write", color: "#2471a3", delay: 1500, duration: 600 },
    ],
    sideEffects: { jobs: "spec.md · plan.md · tasks.md · contracts/ · link.md" },
  },
  {
    id: "implement",
    title: "Implement Task (Step B)",
    description:
      "With the dev lens, implement ONE atomic task from tasks.md as a small diff (≤3 files) on its own branch. The diff stays inside the declared files; the commit ends with a Task: trailer; Contract-Change: yes routes back to architecture.",
    actor: "dev",
    status: "committed",
    stepState: "feat/<story>-<task> branch",
    trigger: "yad-implement task:<T0N>",
    handler: "yad-implement / yad-commit",
    activeComponents: ["code-repos", "contract-lock", "platform"],
    messages: [
      { id: "im-1", from: "dev", to: "code-repos", label: "atomic diff (≤3 files) + Task: trailer", type: "write", color: "#2471a3", delay: 0, duration: 800 },
      { id: "im-2", from: "code-repos", to: "contract-lock", label: "Contract-Change? routes to architecture", type: "cleanup", color: "#c0392b", delay: 900, duration: 700 },
    ],
    sideEffects: { jobs: "one branch + one commit per task" },
  },
  {
    id: "checks",
    title: "Check Gates (Step C)",
    description:
      "Wire and run the CI gates: spec-link, contract-check (a surface change without Contract-Change + a re-lock FAILS), build/test/lint, verified-commits, the pattern gates (commit-message / pr-title / pr-template), and the Phase 6 thread gates (lineage-check / epic-open / reconcile-debt). Blocking in CI.",
    actor: "system",
    status: "checks-passing",
    stepState: "checks/*.sh · yad-checks.yml",
    trigger: "yad-checks repo:<repo> action: run",
    handler: "yad-checks",
    activeComponents: ["code-repos", "platform", "contract-lock"],
    messages: [
      { id: "ck-1", from: "code-repos", to: "platform", label: "run spec-link · contract-check · build/test/lint", type: "job", color: "#b7950b", delay: 0, duration: 800 },
      { id: "ck-2", from: "platform", to: "code-repos", label: "verified-commits + pattern + thread gates", type: "job", color: "#b7950b", delay: 900, duration: 700 },
    ],
    sideEffects: { jobs: "checks/*.sh · .github/workflows/yad-checks.yml · .gitlab-ci.yml" },
  },
  {
    id: "pr-template",
    title: "PR/MR Template (Step D)",
    description:
      "Detect the repo's platform and commit the matching PR/MR template with an Impact & Risk block. High risk (or a contract/auth/payments surface) routes the review to domain owners — the same yad-review-gate escalation.",
    actor: "dev",
    status: "pr-ready",
    stepState: "pull_request_template.md",
    trigger: "yad-pr-template repo:<repo> action: wire",
    handler: "yad-pr-template / yad-open-pr",
    activeComponents: ["code-repos", "platform"],
    messages: [
      { id: "pt-1", from: "dev", to: "code-repos", label: "commit PR/MR template + risk-route.sh", type: "write", color: "#2471a3", delay: 0, duration: 800 },
      { id: "pt-2", from: "code-repos", to: "platform", label: "open task PR (roster auto-assigned)", type: "notification", color: "#566573", delay: 900, duration: 700 },
    ],
    sideEffects: { jobs: "PR/MR template · risk-route.sh · pr-title.sh · pr-template.sh" },
  },
  {
    id: "engineer-review",
    title: "Engineer Review & Merge (Step E)",
    description:
      "Wire an advisory AI first-pass (CodeRabbit, never the authority), record the human engineer review (owner + 1 reviewer, escalating on high risk / contract / auth / payments), and on merge record the ship in build-log.json.",
    actor: "engineer",
    status: "merged",
    stepState: "build-log.json",
    trigger: "yad-engineer-review action: ship",
    handler: "yad-engineer-review / yad-ship",
    activeComponents: ["platform", "product-hub", "trust-log"],
    messages: [
      { id: "er-1", from: "platform", to: "engineer", label: "AI first-pass (advisory)", type: "notification", color: "#566573", delay: 0, duration: 700 },
      { id: "er-2", from: "engineer", to: "platform", label: "human approve + merge", type: "gate", color: "#ca6f1e", delay: 800, duration: 700 },
      { id: "er-3", from: "platform", to: "product-hub", label: "record ship in build-log.json", type: "write", color: "#2471a3", delay: 1600, duration: 700 },
    ],
    sideEffects: { jobs: "build-log.json · story-status (in-build → shipped)", notifications: "permanently human — never auto-advances" },
  },
];

// ── Phase 4 — Automation (earned, reversible) ───────────────────────────────

const automationSteps: FlowStep[] = [
  {
    id: "run",
    title: "Run (Automation)",
    description:
      "The Phase 4 orchestrator: drive a story's back-half loop (spec→tasks→implement→checks) in one repo, reading each step's automation dial. On machine_advance it advances on its own; on human_approve it stops for a human.",
    actor: "system",
    status: "running",
    stepState: "build-state/<story-id>.json",
    trigger: "yad-run story:<id> repo:<repo>",
    handler: "yad-run",
    activeComponents: ["product-hub", "state-json", "trust-log"],
    messages: [
      { id: "rn-1", from: "state-json", to: "product-hub", label: "read each step's dial", type: "event", color: "#1e8449", delay: 0, duration: 700 },
      { id: "rn-2", from: "product-hub", to: "trust-log", label: "advance / halt + record run", type: "job", color: "#b7950b", delay: 800, duration: 700 },
    ],
    sideEffects: { jobs: "build-state/<story-id>.json", notifications: "halts on FAIL / scope overrun / contract touch; always stops at engineer review" },
  },
  {
    id: "trust-log",
    title: "Trust Log",
    description:
      "Records every run's verdict (approved-unchanged / approved-with-edits / rejected) — the evidence base for earning automation. yad-status rolls it up: runs, % approved-unchanged, and whether it clears the threshold.",
    actor: "system",
    status: "gathering-evidence",
    stepState: "trust-log.json",
    trigger: "yad-status {epic}",
    handler: "yad-run / yad-status",
    activeComponents: ["trust-log", "product-hub"],
    messages: [
      { id: "tl-1", from: "engineer", to: "trust-log", label: "append run verdict", type: "write", color: "#2471a3", delay: 0, duration: 700 },
      { id: "tl-2", from: "trust-log", to: "product-hub", label: "roll up % approved-unchanged", type: "event", color: "#1e8449", delay: 800, duration: 700 },
    ],
    sideEffects: { jobs: "trust_threshold: ≥5 runs · ≥80% approved-unchanged" },
  },
  {
    id: "set-dial",
    title: "Set Dial (earn automation)",
    description:
      "Once a back step's trust slice clears the threshold, `yad-run set-dial step:<step> to: machine_advance` flips it. The setter REFUSES if evidence is short, or for any front state / the engineer review. Earned per step.",
    actor: "engineer",
    status: "earned",
    stepState: "state.json (automation dial)",
    trigger: "yad-run action: set-dial",
    handler: "yad-run (set-dial)",
    activeComponents: ["trust-log", "state-json"],
    messages: [
      { id: "sd-1", from: "trust-log", to: "engineer", label: "threshold cleared?", type: "event", color: "#1e8449", delay: 0, duration: 700 },
      { id: "sd-2", from: "engineer", to: "state-json", label: "set dial → machine_advance", type: "write", color: "#2471a3", delay: 800, duration: 700 },
    ],
    sideEffects: { jobs: "back_steps: spec · tasks · implement · checks", notifications: "front states + engineer-review hard-locked" },
  },
  {
    id: "kill-switch",
    title: "Kill Switch",
    description:
      "Safety: `yad-run action: kill` forces every step back to human_approve system-wide instantly — no code change, no per-step edits. `action: unkill` restores earned automation. Automation is reversible in one move.",
    actor: "engineer",
    status: "reversible",
    stepState: "automation.kill_switch",
    trigger: "yad-run action: kill | unkill",
    handler: "yad-run (kill / unkill)",
    activeComponents: ["state-json", "trust-log"],
    messages: [
      { id: "ks-1", from: "engineer", to: "state-json", label: "kill → all steps human_approve", type: "cleanup", color: "#c0392b", delay: 0, duration: 800 },
    ],
    sideEffects: { jobs: "kill_switch: true | false (one line, instantly reversible)" },
  },
];

// ── Phase 6 — Change management (feature threads, post-lock) ─────────────────

const changeSteps: FlowStep[] = [
  {
    id: "change",
    title: "Change Intake & Triage",
    description:
      "The entry point of a feature thread. Classify a post-lock change into a depth (defect-fix / behavioral-no-surface / contract-surface / new-capability) and seed a new EP-<slug> change-epic threaded to its parent (genesis → change → defect). Inherits unchanged front artifacts by reference; re-authors only what changes, so locked artifacts are never mutated — only superseded. Hotfixes open reconcile-debt.",
    actor: "pm",
    status: "draft",
    stepState: "change.json · pointer-lock contract-lock.json",
    trigger: "yad-change {request}",
    handler: "yad-change",
    activeComponents: ["product-hub", "state-json", "change-json", "reconcile-debt-json"],
    messages: [
      { id: "cg-1", from: "product-hub", to: "change-json", label: "seed change-epic (kind / parent / thread)", type: "write", color: "#2471a3", delay: 0, duration: 800 },
      { id: "cg-2", from: "change-json", to: "state-json", label: "inherited-step state + pointer-lock", type: "event", color: "#1e8449", delay: 900, duration: 700 },
      { id: "cg-3", from: "change-json", to: "reconcile-debt-json", label: "hotfix → open reconcile-debt", type: "cleanup", color: "#c0392b", delay: 1700, duration: 600 },
    ],
    sideEffects: { jobs: "change.json · contract-lock.json (pointer) · reconcile-debt.json", notifications: "never auto-advances — hands off to the authoring skills + review gate" },
  },
  {
    id: "timeline",
    title: "Thread Timeline & Current Truth",
    description:
      "The evolution view over a feature thread: TIMELINE.md walks genesis → change → defect, and thread-resolved.md resolves the current truth — which artifact version is live after all supersessions. `yad thread <epic>` prints the thread + its resolved truth + any open debt.",
    actor: "pm",
    status: "draft",
    stepState: "TIMELINE.md · thread-resolved.md",
    trigger: "yad-timeline {epic} / yad thread {epic}",
    handler: "yad-timeline",
    activeComponents: ["product-hub", "change-json", "state-json"],
    messages: [
      { id: "tl-1", from: "change-json", to: "product-hub", label: "walk lineage → TIMELINE.md", type: "event", color: "#1e8449", delay: 0, duration: 700 },
      { id: "tl-2", from: "product-hub", to: "state-json", label: "resolve current truth → thread-resolved.md", type: "write", color: "#2471a3", delay: 800, duration: 700 },
    ],
    sideEffects: { jobs: "TIMELINE.md · thread-resolved.md" },
  },
  {
    id: "defects",
    title: "Defect Escape Analysis",
    description:
      "Quality-gap report over the thread: DEFECTS.md groups each defect by escape_stage (which gate let it through) and root cause, so the front gates can be tightened where escapes cluster.",
    actor: "tester",
    status: "draft",
    stepState: "DEFECTS.md",
    trigger: "yad-defects {epic}",
    handler: "yad-defects",
    activeComponents: ["product-hub", "change-json"],
    messages: [
      { id: "df-1", from: "change-json", to: "product-hub", label: "group by escape_stage + root cause", type: "event", color: "#1e8449", delay: 0, duration: 700 },
      { id: "df-2", from: "product-hub", to: "product-hub", label: "write DEFECTS.md", type: "write", color: "#2471a3", delay: 800, duration: 600 },
    ],
    sideEffects: { jobs: "DEFECTS.md (by escape_stage + root cause)" },
  },
  {
    id: "reconcile",
    title: "Drift / Debt Sweep (advisory)",
    description:
      "A read-only sweep across threads — drift (a bound artifact whose hash moved), orphans (a thread with a missing parent), and open hotfix debt. Advisory like yad-docs-sync; the CI gates (lineage-check / epic-open / reconcile-debt) are what actually block.",
    actor: "system",
    status: "earned",
    stepState: "reconcile-debt.json",
    trigger: "yad-reconcile / yad reconcile",
    handler: "yad-reconcile",
    activeComponents: ["product-hub", "reconcile-debt-json", "contract-lock"],
    messages: [
      { id: "rc-1", from: "product-hub", to: "reconcile-debt-json", label: "scan drift / orphan / open debt", type: "job", color: "#b7950b", delay: 0, duration: 800 },
      { id: "rc-2", from: "reconcile-debt-json", to: "contract-lock", label: "flag drifted boundHash (corruption)", type: "cleanup", color: "#c0392b", delay: 900, duration: 700 },
    ],
    sideEffects: { jobs: "reconcile-debt.json (advisory)", notifications: "a thread with open hotfix debt is frozen until paid" },
  },
];

export const PATHS: FlowPath[] = [
  {
    id: 1,
    label: "Setup & Connect",
    icon: "settings",
    color: "#b7950b",
    description:
      "One-time setup: install the 35 skills, then connect code repos, design / testing / learning / docs tools, and detect the hub platform.",
    category: "setup",
    steps: setupSteps,
  },
  {
    id: 2,
    label: "Front-Zero · Project Discovery",
    icon: "travel_explore",
    color: "#2471a3",
    description:
      "Optional front-zero, once per project: pressure-test the product — market, competitor, feasibility, requirements — and write roadmap.md, the feature menu each epic reads. Modelled as the reserved epic-zero EP-discovery; terminates at discovery-done, no build half.",
    category: "front",
    steps: discoverySteps,
  },
  {
    id: 3,
    label: "Front Half (human-gated)",
    icon: "edit_note",
    color: "#2471a3",
    description:
      "Author the thinking once per epic: analysis → epic → architecture+contract → UI → stories → test-cases — each stopping at the reusable team review gate.",
    category: "front",
    steps: frontSteps,
  },
  {
    id: 4,
    label: "Build Half (per story)",
    icon: "build",
    color: "#1e8449",
    description:
      "Turn a ready-for-build story into shipped code, per repo: spec → implement → check gates → PR template → engineer review & merge.",
    category: "build",
    steps: buildSteps,
  },
  {
    id: 5,
    label: "Automation (earned)",
    icon: "smart_toy",
    color: "#ca6f1e",
    description:
      "The second dial made real: run the back half on each step's dial, record every run in the trust log, earn machine_advance per step, and keep the kill switch.",
    category: "automate",
    steps: automationSteps,
  },
  {
    id: 6,
    label: "Change Management (feature threads)",
    icon: "manage_history",
    color: "#7d3c98",
    description:
      "Post-lock evolution: a sealed epic can't be mutated in place, so a change becomes a new epic threaded to its parent — yad-change intake/triage, then yad-timeline, yad-defects, and the advisory yad-reconcile sweep. Locked artifacts are never mutated, only superseded.",
    category: "change",
    steps: changeSteps,
  },
];
