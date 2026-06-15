import type { SystemComponent } from "./types";

// The durable objects on the yadflow canvas — the product hub, its file ledger,
// the connectors + connected tools, the platform, and the trust log. Brand
// palette mirrors the legacy report public/report.html (accent #2471a3, sentinel #1e8449, gate
// #ca6f1e, artifact #b7950b, locked #566573).
//
// Layout (positions are 0–100, hub-and-spoke organized into four zones so the
// spokes fan out without crossing):
//   • Center  — product-hub (the brain)
//   • Top     — the file ledger the hub owns: state / approvals / contract-lock
//   • Left    — code side: repos-json → code-repos
//   • Right   — connected tools, each connector inner + its tool outer, one per row
//   • Bottom  — publish / platform / evidence: docs / platform / trust-log
export const COMPONENTS: SystemComponent[] = [
  {
    id: "product-hub",
    label: "Product Hub",
    icon: "🏛️",
    color: "#2471a3",
    position: { x: 40, y: 39 },
    description:
      "The product repo — the front-phase brain. Holds every epic's .sdlc ledger and the singular cross-repo contract.",
  },
  {
    id: "state-json",
    label: "state.json",
    icon: "🧭",
    color: "#2471a3",
    position: { x: 31, y: 4 },
    description:
      "Per-epic state machine: currentStep, each step's assistance/automation dials, and front_steps_locked.",
  },
  {
    id: "approvals-json",
    label: "approvals.json",
    icon: "✅",
    color: "#1e8449",
    position: { x: 50, y: 4 },
    description:
      "The recorded approvals ledger — owner + 1 reviewer per gate, hash-bound so a changed artifact drops them.",
  },
  {
    id: "contract-lock",
    label: "contract-lock.json",
    icon: "🔒",
    color: "#566573",
    position: { x: 69, y: 4 },
    description:
      "SHA-256 of the CONTRACT-SURFACE block in contract.md — the hash-locked cross-repo surface.",
  },
  {
    id: "repos-json",
    label: "repos.json",
    icon: "🗂️",
    color: "#b7950b",
    position: { x: 11, y: 27 },
    description:
      "Project-wide registry of connected code repos (GitHub/GitLab, local-user auth, no stored tokens).",
  },
  {
    id: "code-repos",
    label: "Code Repos",
    icon: "📦",
    color: "#7d3c98",
    position: { x: 11, y: 51 },
    description:
      "The separate code repos (one .git each). Each is cached as a Repomix pack + a lightweight code-map.",
  },
  {
    id: "design-json",
    label: "design.json",
    icon: "🎨",
    color: "#ca6f1e",
    position: { x: 69, y: 27 },
    description:
      "Design-tool connection (Figma-first, pluggable) so yad-ui can materialize screens, not just Markdown.",
  },
  {
    id: "testing-json",
    label: "testing.json",
    icon: "🧪",
    color: "#1e8449",
    position: { x: 69, y: 51 },
    description:
      "Testing-tool connection (Playwright-first) so yad-test-cases can implement the automation tests.",
  },
  {
    id: "learning-json",
    label: "learning.json",
    icon: "🎓",
    color: "#2471a3",
    position: { x: 69, y: 74 },
    description:
      "Learning-tool connection (DeepTutor-first, a CLI subprocess) powering the cross-cutting tutor layer.",
  },
  {
    id: "docs-json",
    label: "docs.json",
    icon: "📘",
    color: "#566573",
    position: { x: 11, y: 74 },
    description:
      "Docs/Pages publishing target (github-pages / gitlab-pages / build-only), auto-detected from hub.json.",
  },
  {
    id: "design-tool",
    label: "Design Tool",
    icon: "🖌️",
    color: "#ca6f1e",
    position: { x: 85, y: 27 },
    description:
      "The connected design tool (Figma / Pencil), reached via its MCP; degrades to markdown-only when absent.",
  },
  {
    id: "testing-tool",
    label: "Testing Tool",
    icon: "🎭",
    color: "#1e8449",
    position: { x: 85, y: 51 },
    description:
      "The connected testing tool (Playwright / Cypress / pytest), reached via its MCP; degrades to artifacts-only.",
  },
  {
    id: "learning-tool",
    label: "DeepTutor",
    icon: "🧠",
    color: "#2471a3",
    position: { x: 85, y: 74 },
    description:
      "The learning tutor (DeepTutor CLI on PATH); degrades to harness-native tutoring when absent — always opt-in.",
  },
  {
    id: "platform",
    label: "Git Platform",
    icon: "🌐",
    color: "#7d3c98",
    position: { x: 31, y: 74 },
    description:
      "The hub's git platform. The front-half review rides a real review PR/MR here; CI runs the check gates.",
  },
  {
    id: "trust-log",
    label: "trust-log.json",
    icon: "📈",
    color: "#b7950b",
    position: { x: 49, y: 74 },
    description:
      "Every back-half run's verdict — the evidence base a step must clear (≥5 runs, ≥80% unchanged) to earn automation.",
  },
];
