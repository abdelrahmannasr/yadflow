import { useState, useEffect, useRef } from "react";
import { useFlowStore } from "../store/useFlowStore";

export function useAnimationQueue() {
  const activeStepIndex = useFlowStore((s) => s.activeStepIndex);
  const speed = useFlowStore((s) => s.speed);

  const [completedTargets, setCompletedTargets] = useState<Set<string>>(new Set());
  const [animKey, setAnimKey] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // When step changes, reset and schedule completion events
  useEffect(() => {
    // Clear previous timers
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setCompletedTargets(new Set());
    setAnimKey((k) => k + 1);

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
