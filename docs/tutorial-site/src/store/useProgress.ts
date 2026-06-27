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
    { name: 'yadflow-tutorial-progress' },
  ),
);
