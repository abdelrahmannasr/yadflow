import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProgressState {
  /** lesson ids the learner has marked complete */
  completed: Record<string, true>;
  toggle: (lessonId: string) => void;
  markComplete: (lessonId: string) => void;
  isComplete: (lessonId: string) => boolean;
  reset: () => void;
}

/** Tracks which lessons the learner has completed, persisted to localStorage. */
export const useProgress = create<ProgressState>()(
  persist(
    (set, get) => ({
      completed: {},
      toggle: (lessonId) =>
        set((s) => {
          const next = { ...s.completed };
          if (next[lessonId]) delete next[lessonId];
          else next[lessonId] = true;
          return { completed: next };
        }),
      markComplete: (lessonId) =>
        set((s) => ({ completed: { ...s.completed, [lessonId]: true } })),
      isComplete: (lessonId) => Boolean(get().completed[lessonId]),
      reset: () => set({ completed: {} }),
    }),
    {
      name: 'yadflow-tutorial-progress',
      // The Shape/Build/Run rename changed six lesson ids, and those ids are the KEYS of `completed`
      // in a learner's browser. Without this, everyone who had finished those lessons would silently
      // lose the ticks. Bump `version` again if ids ever move again.
      version: 1,
      migrate: (state, from) => {
        if (from >= 1) return state as ProgressState;
        const renamed: Record<string, string> = {
          'front-epic': 'shape-epic',
          'front-architecture': 'shape-architecture',
          'front-ui': 'shape-ui',
          'front-stories': 'shape-stories',
          'front-test-cases': 'shape-test-cases',
          'why-two-halves': 'why-three-parts',
        };
        const old = (state as ProgressState | undefined)?.completed ?? {};
        const completed: Record<string, true> = {};
        for (const id of Object.keys(old)) completed[renamed[id] ?? id] = true;
        return { ...(state as ProgressState), completed };
      },
    },
  ),
);
