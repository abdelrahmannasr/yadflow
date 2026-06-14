import type { SystemComponent } from "./types";

export const COMPONENTS: SystemComponent[] = [
  {
    id: "rider-app",
    label: "Rider App",
    icon: "👤",
    color: "#fb2576",
    position: { x: 8, y: 25 },
    description: "Mobile app used by riders to book and manage trips",
  },
  {
    id: "driver-app",
    label: "Driver App",
    icon: "🚗",
    color: "#6316db",
    position: { x: 8, y: 68 },
    description: "Mobile app used by drivers to accept and manage trips",
  },
  {
    id: "backend-api",
    label: "Backend API",
    icon: "⚡",
    color: "#7b59e6",
    position: { x: 38, y: 46 },
    description:
      "Core REST API handling trip creation, status updates, and booking management",
  },
  {
    id: "bullmq",
    label: "BullMQ Jobs",
    icon: "⏱️",
    color: "#f59e0b",
    position: { x: 65, y: 18 },
    description:
      "Job queue for scheduled tasks: confirmations, timeouts, and cleanup",
  },
  {
    id: "ops-dashboard",
    label: "Ops Dashboard",
    icon: "🛠️",
    color: "#06b6d4",
    position: { x: 65, y: 74 },
    description:
      "Internal operations dashboard for driver assignment, monitoring, and manual interventions",
  },
  {
    id: "pubsub",
    label: "Pub/Sub",
    icon: "📡",
    color: "#10b981",
    position: { x: 88, y: 28 },
    description:
      "Google Cloud Pub/Sub for ride dispatch events and status updates",
  },
  {
    id: "dac",
    label: "DAC (Driver Actions)",
    icon: "📋",
    color: "#8b5cf6",
    position: { x: 88, y: 64 },
    description:
      "Driver Action Cards — scheduled ride cards shown in driver app",
  },
  {
    id: "database",
    label: "MongoDB",
    icon: "🗄️",
    color: "#a8a4b2",
    position: { x: 38, y: 88 },
    description:
      "Primary database storing trip data, booking status, and history",
  },
];
