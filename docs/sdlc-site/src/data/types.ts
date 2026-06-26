// yadflow SDLC-overview doc-site types.
// The vendored shell's unions are widened here to model yadflow's pipeline
// (lenses, phases, SDLC step status). Every consumer was updated to match.

export type StakeholderView =
  | "analyst"
  | "pm"
  | "architect"
  | "ux-designer"
  | "dev"
  | "tester"
  | "reviewer"
  | "engineer"
  | "maintainer";

// Message kinds flowing on the canvas. Repurposed for the SDLC:
// write = an artifact written to the ledger; gate = a review/approval act;
// event = a state transition; job = an automated run; notification = a routed
// signal (reviewers / domain owners); cleanup = a revoke / halt.
export type MessageType = "write" | "gate" | "event" | "job" | "notification" | "cleanup";

// The yadflow lenses that drive a step.
export type ActorType =
  | "analyst"
  | "pm"
  | "architect"
  | "ux"
  | "dev"
  | "tester"
  | "reviewer"
  | "engineer"
  | "system";

// One category per pipeline phase (the FlowPath grouping).
export type PathCategory = "setup" | "front" | "build" | "automate" | "change";

export type PlaybackState = "idle" | "playing" | "paused";

export interface SystemComponent {
  id: string;
  label: string;
  icon: string;
  color: string;
  position: { x: number; y: number };
  description: string;
}

export interface AnimatedMessage {
  id: string;
  from: string;
  to: string;
  label: string;
  type: MessageType;
  color: string;
  delay: number;
  duration: number;
}

export interface FlowStep {
  id: string;
  title: string;
  description: string;
  actor: ActorType;
  // Reused as the SDLC step status, e.g. "draft" / "in-review" / "approved" /
  // "ready-for-build" / "merged" / "earned".
  status: string;
  // Reused as the .sdlc currentStep / artifact label for the step.
  stepState: string;
  trigger: string;
  handler: string;
  messages: AnimatedMessage[];
  activeComponents: string[];
  // Repurposed labels: the .sdlc files the step writes / reads.
  sideEffects: {
    jobs?: string;
    notifications?: string;
    dac?: string;
    pubsub?: string;
  };
}

export interface FlowPath {
  id: number;
  label: string;
  icon: string;
  color: string;
  description: string;
  category: PathCategory;
  steps: FlowStep[];
  subPaths?: {
    id: string;
    label: string;
    steps: FlowStep[];
  }[];
}

export const MESSAGE_COLORS: Record<MessageType, string> = {
  write: "#2471a3",        // accent — an artifact written
  gate: "#ca6f1e",         // gate orange — a human review act
  event: "#1e8449",        // sentinel green — a state transition
  job: "#b7950b",          // artifact gold — an automated run
  notification: "#566573", // routed signal to reviewers / owners
  cleanup: "#c0392b",      // revoke / halt
};
