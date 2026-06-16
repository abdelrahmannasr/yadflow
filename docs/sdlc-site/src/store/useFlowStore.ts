import { create } from "zustand";
import type { FlowPath, FlowStep, PlaybackState, StakeholderView } from "../data/types";
import { PATHS } from "../data/paths";

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
}

interface FlowStore {
  selectedPath: FlowPath;
  activeSubPathId: string | null;
  activeStepIndex: number;
  playbackState: PlaybackState;
  speed: number;
  animatingMessages: boolean;

  // Stakeholder
  stakeholderView: StakeholderView;

  // UI panels
  zoomLevel: number;
  isReferencePanelOpen: boolean;
  isCommandPaletteOpen: boolean;
  isLogsPanelOpen: boolean;
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;

  // Logs
  logs: LogEntry[];

  // Timer
  elapsedTime: number;

  selectPath: (pathId: number) => void;
  selectSubPath: (subPathId: string) => void;
  setActiveStep: (index: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
  setAnimatingMessages: (val: boolean) => void;

  // Stakeholder
  setStakeholderView: (view: StakeholderView) => void;

  // Zoom
  setZoomLevel: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  // Panels
  toggleReferencePanel: () => void;
  toggleCommandPalette: () => void;
  toggleLogsPanel: () => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;

  // Logs
  addLog: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;

  // Timer
  tickElapsed: () => void;
  resetElapsed: () => void;

  // Replay
  replayStep: () => void;

  getCurrentSteps: () => FlowStep[];
  getCurrentStep: () => FlowStep | null;
  getTotalSteps: () => number;
}

let logCounter = 0;

export const useFlowStore = create<FlowStore>((set, get) => ({
  selectedPath: PATHS[0],
  activeSubPathId: null,
  activeStepIndex: 0,
  playbackState: "idle",
  speed: 1,
  animatingMessages: false,

  stakeholderView: 'dev' as StakeholderView,

  zoomLevel: 1,
  isReferencePanelOpen: false,
  isCommandPaletteOpen: false,
  isLogsPanelOpen: false,
  isLeftPanelOpen: true,
  isRightPanelOpen: true,
  logs: [],
  elapsedTime: 0,

  selectPath: (pathId: number) => {
    const path = PATHS.find((p) => p.id === pathId) || PATHS[0];
    const hasSubPaths = path.subPaths && path.subPaths.length > 0;
    set({
      selectedPath: path,
      activeStepIndex: 0,
      playbackState: "idle",
      animatingMessages: false,
      activeSubPathId: hasSubPaths ? path.subPaths![0].id : null,
    });
  },

  selectSubPath: (subPathId: string) => {
    set({
      activeSubPathId: subPathId,
      activeStepIndex: 0,
      playbackState: "idle",
      animatingMessages: false,
    });
  },

  setActiveStep: (index: number) => {
    const steps = get().getCurrentSteps();
    if (index >= 0 && index < steps.length) {
      set({ activeStepIndex: index, animatingMessages: false });
    }
  },

  nextStep: () => {
    const { activeStepIndex, getCurrentSteps } = get();
    const steps = getCurrentSteps();
    if (activeStepIndex < steps.length - 1) {
      set({ activeStepIndex: activeStepIndex + 1, animatingMessages: false });
    } else {
      set({ playbackState: "idle" });
    }
  },

  prevStep: () => {
    const { activeStepIndex } = get();
    if (activeStepIndex > 0) {
      set({ activeStepIndex: activeStepIndex - 1, animatingMessages: false });
    }
  },

  play: () => set({ playbackState: "playing" }),
  pause: () => set({ playbackState: "paused" }),
  stop: () => set({ playbackState: "idle", activeStepIndex: 0, animatingMessages: false }),
  setSpeed: (speed: number) => set({ speed }),
  setAnimatingMessages: (val: boolean) => set({ animatingMessages: val }),

  // Stakeholder
  setStakeholderView: (view) => set({ stakeholderView: view }),

  // Zoom
  setZoomLevel: (level: number) => set({ zoomLevel: Math.max(0.5, Math.min(2, level)) }),
  zoomIn: () => set((s) => ({ zoomLevel: Math.min(2, s.zoomLevel + 0.1) })),
  zoomOut: () => set((s) => ({ zoomLevel: Math.max(0.5, s.zoomLevel - 0.1) })),
  resetZoom: () => set({ zoomLevel: 1 }),

  // Panels
  toggleReferencePanel: () => set((s) => ({ isReferencePanelOpen: !s.isReferencePanelOpen })),
  toggleCommandPalette: () => set((s) => ({ isCommandPaletteOpen: !s.isCommandPaletteOpen })),
  toggleLogsPanel: () => set((s) => ({ isLogsPanelOpen: !s.isLogsPanelOpen })),
  toggleLeftPanel: () => set((s) => ({ isLeftPanelOpen: !s.isLeftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ isRightPanelOpen: !s.isRightPanelOpen })),

  // Logs
  addLog: (entry) => {
    logCounter++;
    set((s) => ({
      logs: [...s.logs.slice(-200), { ...entry, id: `log-${logCounter}`, timestamp: new Date() }],
    }));
  },
  clearLogs: () => set({ logs: [] }),

  // Timer
  tickElapsed: () => set((s) => ({ elapsedTime: s.elapsedTime + 0.1 })),
  resetElapsed: () => set({ elapsedTime: 0 }),

  // Replay
  replayStep: () => {
    set({ animatingMessages: false });
  },

  getCurrentSteps: () => {
    const { selectedPath, activeSubPathId } = get();
    if (selectedPath.subPaths && activeSubPathId) {
      const sub = selectedPath.subPaths.find((s) => s.id === activeSubPathId);
      return sub ? sub.steps : [];
    }
    return selectedPath.steps;
  },

  getCurrentStep: () => {
    const { activeStepIndex } = get();
    const steps = get().getCurrentSteps();
    return steps[activeStepIndex] || null;
  },

  getTotalSteps: () => {
    return get().getCurrentSteps().length;
  },
}));
