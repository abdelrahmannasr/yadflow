import { useEffect, useRef } from "react";
import { useFlowStore } from "../store/useFlowStore";

export function usePlayback() {
  const {
    playbackState,
    speed,
    activeStepIndex,
    animatingMessages,
    nextStep,
    getCurrentSteps,
    setAnimatingMessages,
    addLog,
    tickElapsed,
    resetElapsed,
  } = useFlowStore();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStepRef = useRef<number>(-1);

  // Elapsed time ticker
  useEffect(() => {
    if (playbackState === 'playing') {
      elapsedRef.current = setInterval(tickElapsed, 100);
    } else {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
    if (playbackState === 'idle') resetElapsed();
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [playbackState, tickElapsed, resetElapsed]);

  // Generate logs on step change
  useEffect(() => {
    if (prevStepRef.current === activeStepIndex) return;
    prevStepRef.current = activeStepIndex;

    const steps = getCurrentSteps();
    const currentStep = steps[activeStepIndex];
    if (!currentStep) return;

    addLog({
      level: 'info',
      source: currentStep.actor.toUpperCase(),
      message: `Step ${activeStepIndex + 1}: ${currentStep.title}`,
    });

    for (const msg of currentStep.messages) {
      setTimeout(() => {
        addLog({
          level: 'info',
          source: msg.from,
          message: `${msg.type}: ${msg.label} → ${msg.to}`,
        });
      }, msg.delay / speed);
    }
  }, [activeStepIndex, speed, addLog, getCurrentSteps]);

  useEffect(() => {
    if (playbackState !== "playing") {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const steps = getCurrentSteps();
    const currentStep = steps[activeStepIndex];
    if (!currentStep) return;

    // Calculate total duration for current step messages
    const messages = currentStep.messages;
    const lastMessage = messages[messages.length - 1];
    const totalAnimDuration = lastMessage
      ? (lastMessage.delay + lastMessage.duration) / speed
      : 1000 / speed;

    // Trigger message animations
    if (!animatingMessages) {
      setAnimatingMessages(true);
    }

    // Wait for animations + pause, then advance
    const baseDelay = 3000 / speed;
    const stepDuration = totalAnimDuration + baseDelay;

    timerRef.current = setTimeout(() => {
      const isLast = activeStepIndex >= steps.length - 1;
      if (!isLast) {
        nextStep();
      } else {
        useFlowStore.getState().pause();
      }
    }, stepDuration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [playbackState, activeStepIndex, speed, animatingMessages, getCurrentSteps, nextStep, setAnimatingMessages]);
}
