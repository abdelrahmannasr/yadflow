import { useState, useEffect, useRef } from "react";
import { useFlowStore } from "../store/useFlowStore";

export function useAnimationQueue() {
  const activeStepIndex = useFlowStore((s) => s.activeStepIndex);
  const speed = useFlowStore((s) => s.speed);

  const [completedTargets, setCompletedTargets] = useState<Set<string>>(new Set());
  const [animKey, setAnimKey] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Reset the pulse state the instant the step (or speed) changes — done during
  // render via the "adjust state on change" pattern rather than inside the effect,
  // so it does not trigger an extra cascading render (react-hooks/set-state-in-effect).
  const stepKey = `${activeStepIndex}-${speed}`;
  const [resetKey, setResetKey] = useState(stepKey);
  if (stepKey !== resetKey) {
    setResetKey(stepKey);
    setCompletedTargets(new Set());
    setAnimKey((k) => k + 1);
  }

  // When step changes, schedule the target-pulse completion events.
  useEffect(() => {
    // Clear previous timers
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    // Get messages from the current step
    const step = useFlowStore.getState().getCurrentStep();
    const messages = step?.messages || [];

    if (messages.length === 0) return;

    // Schedule completion events for target pulse effect
    for (const msg of messages) {
      const timer = setTimeout(() => {
        setCompletedTargets((prev) => new Set(prev).add(msg.to));
      }, (msg.delay + msg.duration) / speed);
      timersRef.current.push(timer);
    }

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [activeStepIndex, speed]);

  return { completedTargets, animKey, speed };
}
