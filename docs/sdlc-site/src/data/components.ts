import type { SystemComponent } from "./types";

// The durable objects on the yadflow canvas — the product hub, its file ledger,
// the connectors + connected tools, the platform, and the trust log. Brand
// palette mirrors docs/index.html (accent #2471a3, sentinel #1e8449, gate
// #ca6f1e, artifact #b7950b, locked #566573). Positions are 0–100, spread.
export const COMPONENTS: SystemComponent[] = [
  {
    id: "product-hub",
    label: "Product Hub",
    icon: "🏛️",
    color: "#2471a3",
    position: { x: 42, y: 46 },
    description:
      "The product repo — the front-phase brain. Holds every epic's .sdlc ledger and the singular cross-repo contract.",
  },
  {
    id: "state-json",
    label: "state.json",
    icon: "🧭",
    color: "#2471a3",
    position: { x: 24, y: 20 },
    description:
      "Per-epic state machine: currentStep, each step's assistance/automation dials, and front_steps_locked.",
  },
  {
    id: "approvals-json",
    label: "approvals.json",
    icon: "✅",
    color: "#1e8449",
    position: { x: 42, y: 14 },
    description:
      "The recorded approvals ledger — owner + 1 reviewer per gate, hash-bound so a changed artifact drops them.",
  },
  {
    id: "contract-lock",
    label: "contract-lock.json",
    icon: "🔒",
    color: "#566573",
    position: { x: 60, y: 20 },
    description:
      "SHA-256 of the CONTRACT-SURFACE block in contract.md — the hash-locked cross-repo surface.",
  },
  {
    id: "repos-json",
    label: "repos.json",
    icon: "🗂️",
    color: "#b7950b",
    position: { x: 16, y: 44 },
    description:
      "Project-wide registry of connected code repos (GitHub/GitLab, local-user auth, no stored tokens).",
  },
  {
    id: "code-repos",
    label: "Code Repos",
    icon: "📦",
    color: "#7d3c98",
    position: { x: 16, y: 70 },
    description:
      "The separate code repos (one .git each). Each is cached as a Repomix pack + a lightweight code-map.",
  },
  {
    id: "design-json",
    label: "design.json",
    icon: "🎨",
    color: "#ca6f1e",
    position: { x: 70, y: 44 },
    description:
      "Design-tool connection (Figma-first, pluggable) so yad-ui can materialize screens, not just Markdown.",
  },
  {
    id: "testing-json",
    label: "testing.json",
    icon: "🧪",
    color: "#1e8449",
    position: { x: 84, y: 44 },
    description:
      "Testing-tool connection (Playwright-first) so yad-test-cases can implement the automation tests.",
  },
  {
    id: "learning-json",
    label: "learning.json",
    icon: "🎓",
    color: "#2471a3",
    position: { x: 84, y: 64 },
    description:
      "Learning-tool connection (DeepTutor-first, a CLI subprocess) powering the cross-cutting tutor layer.",
  },
  {
    id: "docs-json",
    label: "docs.json",
    icon: "📘",
    color: "#566573",
    position: { x: 70, y: 64 },
    description:
      "Docs/Pages publishing target (github-pages / gitlab-pages / build-only), auto-detected from hub.json.",
  },
  {
    id: "design-tool",
    label: "Design Tool",
    icon: "🖌️",
    color: "#ca6f1e",
    position: { x: 88, y: 26 },
    description:
      "The connected design tool (Figma / Pencil), reached via its MCP; degrades to markdown-only when absent.",
  },
  {
    id: "testing-tool",
    label: "Testing Tool",
    icon: "🎭",
    color: "#1e8449",
    position: { x: 88, y: 86 },
    description:
      "The connected testing tool (Playwright / Cypress / pytest), reached via its MCP; degrades to artifacts-only.",
  },
  {
    id: "learning-tool",
    label: "DeepTutor",
    icon: "🧠",
    color: "#2471a3",
    position: { x: 68, y: 86 },
    description:
      "The learning tutor (DeepTutor CLI on PATH); degrades to harness-native tutoring when absent — always opt-in.",
  },
  {
    id: "platform",
    label: "Platform (GitHub/GitLab)",
    icon: "🌐",
    color: "#7d3c98",
    position: { x: 42, y: 78 },
    description:
      "The hub's git platform. The front-half review rides a real review PR/MR here; CI runs the check gates.",
  },
  {
    id: "trust-log",
    label: "trust-log.json",
    icon: "📈",
    color: "#b7950b",
    position: { x: 60, y: 70 },
    description:
      "Every back-half run's verdict — the evidence base a step must clear (≥5 runs, ≥80% unchanged) to earn automation.",
  },
];
