export type StakeholderView =
  | "rider-mobile-dev"
  | "driver-mobile-dev"
  | "backend-dev"
  | "product-manager"
  | "engineering-manager"
  | "staff-engineer"
  | "qa-engineer";

export type MessageType = "request" | "response" | "event" | "job" | "notification" | "cleanup";

export type ActorType = "rider" | "driver" | "ops" | "system";

export type PathCategory = "success" | "rider-cancel" | "driver-cancel" | "timeout" | "ops" | "active-cancel";

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
  status: string;
  bookingStatus: string;
  trigger: string;
  handler: string;
  messages: AnimatedMessage[];
  activeComponents: string[];
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
  request: "#7b59e6",
  response: "#06b6d4",
  event: "#10b981",
  job: "#f59e0b",
  notification: "#fb2576",
  cleanup: "#ef4444",
};
