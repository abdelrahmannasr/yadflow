import type { SystemComponent } from "./types";

// The durable objects on the yadflow canvas — the product hub, its file ledger,
// the connectors + connected tools, the platform, and the trust log. Brand
// palette mirrors the legacy report public/report.html (accent #2471a3, sentinel #1e8449, gate
// #ca6f1e, artifact #b7950b, locked #566573).
//
// Layout — a left-to-right PIPELINE (positions are 0–100), read as five aligned
// columns so the flow is organized rather than a hub-and-spoke spider, with a
// loop-back arc (trust-log → product-hub, drawn in FlowCanvas) expressing the
// repeated-per-epic cycle:
//   • Col 1 — product-hub (the brain that drives the pipeline)
//   • Col 2 — the file ledger the hub owns + the code registry: state / approvals / contract-lock / repos-json
//   • Col 3 — the connectors + code resource: design / testing / learning json + code-repos
//   • Col 4 — the connected tools + docs target: design / testing / learning tool + docs-json
//   • Col 5 — publish / evidence terminal: platform + trust-log (loops back to the hub)
export const COMPONENTS: SystemComponent[] = [
  {
    id: "product-hub",
    label: "Product Hub",
    icon: "🏛️",
    color: "#2471a3",
    position: { x: 9, y: 50 },
    description:
      "The product repo — the front-phase brain. Holds every epic's .sdlc ledger and the singular cross-repo contract.",
  },
  {
    id: "state-json",
    label: "state.json",
    icon: "🧭",
    color: "#2471a3",
    position: { x: 28, y: 14 },
    description:
      "Per-epic state machine: currentStep, each step's assistance/automation dials, and front_steps_locked.",
  },
  {
    id: "approvals-json",
    label: "approvals.json",
    icon: "✅",
    color: "#1e8449",
    position: { x: 28, y: 38 },
    description:
      "The recorded approvals ledger — owner + 1 reviewer per gate, hash-bound so a changed artifact drops them.",
  },
  {
    id: "contract-lock",
    label: "contract-lock.json",
    icon: "🔒",
    color: "#566573",
    position: { x: 28, y: 62 },
    description:
      "SHA-256 of the CONTRACT-SURFACE block in contract.md — the hash-locked cross-repo surface.",
  },
  {
    id: "repos-json",
    label: "repos.json",
    icon: "🗂️",
    color: "#b7950b",
    position: { x: 28, y: 80 },
    description:
      "Project-wide registry of connected code repos (GitHub/GitLab, local-user auth, no stored tokens).",
  },
  {
    id: "design-json",
    label: "design.json",
    icon: "🎨",
    color: "#ca6f1e",
    position: { x: 48, y: 14 },
    description:
      "Design-tool connection (Figma-first, pluggable) so yad-ui can materialize screens, not just Markdown.",
  },
  {
    id: "testing-json",
    label: "testing.json",
    icon: "🧪",
    color: "#1e8449",
    position: { x: 48, y: 38 },
    description:
      "Testing-tool connection (Playwright-first) so yad-test-cases can implement the automation tests.",
  },
  {
    id: "learning-json",
    label: "learning.json",
    icon: "🎓",
    color: "#2471a3",
    position: { x: 48, y: 62 },
    description:
      "Learning-tool connection (DeepTutor-first, a CLI subprocess) powering the cross-cutting tutor layer.",
  },
  {
    id: "code-repos",
    label: "Code Repos",
    icon: "📦",
    color: "#7d3c98",
    position: { x: 48, y: 80 },
    description:
      "The separate code repos (one .git each). Each is cached as a Repomix pack + a lightweight code-map.",
  },
  {
    id: "design-tool",
    label: "Design Tool",
    icon: "🖌️",
    color: "#ca6f1e",
    position: { x: 68, y: 14 },
    description:
      "The connected design tool (Figma / Pencil), reached via its MCP; degrades to markdown-only when absent.",
  },
  {
    id: "testing-tool",
    label: "Testing Tool",
    icon: "🎭",
    color: "#1e8449",
    position: { x: 68, y: 38 },
    description:
      "The connected testing tool (Playwright / Cypress / pytest), reached via its MCP; degrades to artifacts-only.",
  },
  {
    id: "learning-tool",
    label: "DeepTutor",
    icon: "🧠",
    color: "#2471a3",
    position: { x: 68, y: 62 },
    description:
      "The learning tutor (DeepTutor CLI on PATH); degrades to harness-native tutoring when absent — always opt-in.",
  },
  {
    id: "docs-json",
    label: "docs.json",
    icon: "📘",
    color: "#566573",
    position: { x: 68, y: 80 },
    description:
      "Docs/Pages publishing target (github-pages / gitlab-pages / build-only), auto-detected from hub.json.",
  },
  {
    id: "platform",
    label: "Git Platform",
    icon: "🌐",
    color: "#7d3c98",
    position: { x: 88, y: 33 },
    description:
      "The hub's git platform. The front-half review rides a real review PR/MR here; CI runs the check gates.",
  },
  {
    id: "trust-log",
    label: "trust-log.json",
    icon: "📈",
    color: "#b7950b",
    position: { x: 88, y: 67 },
    description:
      "Every back-half run's verdict — the evidence base a step must clear (≥5 runs, ≥80% unchanged) to earn automation.",
  },
  // Phase 6 — the feature-thread ledgers (post-lock change management).
  {
    id: "change-json",
    label: "change.json",
    icon: "🧵",
    color: "#7d3c98",
    position: { x: 18, y: 92 },
    description:
      "The feature-thread record: a change-epic's kind (change/defect/hotfix), its parent, and the thread lineage — inherit unchanged front artifacts by reference, re-author only what changes.",
  },
  {
    id: "reconcile-debt-json",
    label: "reconcile-debt.json",
    icon: "🧾",
    color: "#c0392b",
    position: { x: 38, y: 92 },
    description:
      "Open hotfix debt on a thread — a fast fix that skipped a gate owes a reconcile. The reconcile-debt CI gate freezes the thread until it is paid.",
  },
  {
    id: "build-log-json",
    label: "build-log.json",
    icon: "📒",
    color: "#1e8449",
    position: { x: 58, y: 92 },
    description:
      "The per-epic ship ledger — every merged story recorded at merge time. A sealed epic (all stories shipped) refuses new behaviour, forcing a new threaded change-epic.",
  },
];
