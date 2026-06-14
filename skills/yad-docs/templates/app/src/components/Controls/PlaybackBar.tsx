import { motion } from 'framer-motion';
import { useFlowStore } from '../../store/useFlowStore';
import { Icon } from '../shared/Icon';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export const PlaybackBar = () => {
  const {
    playbackState,
    speed,
    activeStepIndex,
    elapsedTime,
    play,
    pause,
    stop,
    nextStep,
    prevStep,
    setSpeed,
    setActiveStep,
    getTotalSteps,
    getCurrentStep,
    getCurrentSteps,
    toggleLogsPanel,
    replayStep,
    addLog,
  } = useFlowStore();

  const totalSteps = getTotalSteps();
  const currentStep = getCurrentStep();
  const steps = getCurrentSteps();
  const progress = totalSteps > 0 ? ((activeStepIndex + 1) / totalSteps) * 100 : 0;
  const estimatedTotal = totalSteps * 8;

  const handleFlagIssue = () => {
    if (currentStep) {
      addLog({
        level: 'warn',
        source: 'USER',
        message: `Flagged step ${activeStepIndex + 1}: ${currentStep.title}`,
      });
    }
  };

  return (
    <div className="relative z-20">
      {/* Ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ background: 'rgba(30,26,37,0.9)' }}
      >
        <div
          className="absolute left-1/2 -translate-x-1/2 top-0 w-1/3 h-full"
          style={{
            background: 'rgba(97,22,218,0.05)',
            filter: 'blur(100px)',
          }}
        />
      </div>

      <div
        className="relative"
        style={{
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {/* Header: label + timer */}
        <div className="flex items-center justify-between px-6 pt-3 pb-1">
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Booking Flow Progress
          </span>
          <div className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <span style={{ color: 'var(--color-primary)' }}>{formatTime(elapsedTime)}</span>
            {' / '}
            <span>{formatTime(estimatedTotal)}</span>
          </div>
        </div>

        {/* Step title */}
        <div className="px-6 pb-2">
          <h3 className="text-white text-base font-bold">
            {currentStep
              ? `Step ${activeStepIndex + 1}: ${currentStep.title}`
              : 'Select a path to begin'}
          </h3>
        </div>

        {/* Step markers + progress bar */}
        <div className="px-6 pb-3">
          {/* Markers row */}
          <div className="relative flex items-start justify-between mb-1">
            {steps.map((step, i) => {
              const isCompleted = i < activeStepIndex;
              const isActive = i === activeStepIndex;
              const shortLabel = step.title.split(' ')[0];

              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(i)}
                  className="flex flex-col items-center gap-1 z-10 group cursor-pointer"
                  style={{ flex: '1 1 0' }}
                  title={step.title}
                >
                  <div
                    className="rounded-full transition-all duration-300"
                    style={{
                      width: isActive ? 14 : 10,
                      height: isActive ? 14 : 10,
                      background: isCompleted
                        ? 'var(--color-primary)'
                        : isActive
                          ? 'white'
                          : 'rgba(255,255,255,0.15)',
                      border: isActive ? '3px solid var(--color-primary)' : 'none',
                      boxShadow: isActive
                        ? '0 0 12px rgba(97,22,218,0.6)'
                        : isCompleted
                          ? '0 0 6px rgba(97,22,218,0.3)'
                          : 'none',
                    }}
                  />
                  <span
                    className="text-[9px] font-medium transition-colors"
                    style={{
                      color: isActive
                        ? 'white'
                        : isCompleted
                          ? 'var(--color-primary)'
                          : 'var(--color-text-muted)',
                    }}
                  >
                    {shortLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Progress bar */}
          <div
            className="relative h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{
                background: 'linear-gradient(90deg, var(--color-primary), #a855f7)',
              }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3 px-6 pb-3">
          {/* Skip Prev */}
          <button
            onClick={prevStep}
            disabled={activeStepIndex === 0}
            className="group flex flex-col items-center gap-0.5 p-1.5 rounded-md transition-colors disabled:opacity-30"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <Icon name="skip_previous" size={22} />
            <span className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">Prev</span>
          </button>

          {/* Play / Pause */}
          <motion.button
            onClick={playbackState === 'playing' ? pause : play}
            className="h-14 w-14 rounded-full flex items-center justify-center text-white transition-transform active:scale-95"
            style={{
              background: 'var(--color-primary)',
              boxShadow: '0 0 20px rgba(97,22,218,0.5)',
            }}
            whileHover={{ scale: 1.05, boxShadow: '0 0 30px rgba(97,22,218,0.8)' }}
            whileTap={{ scale: 0.95 }}
            aria-label={playbackState === 'playing' ? 'Pause' : 'Play'}
          >
            <Icon name={playbackState === 'playing' ? 'pause' : 'play_arrow'} size={32} filled />
          </motion.button>

          {/* Skip Next */}
          <button
            onClick={nextStep}
            disabled={activeStepIndex >= totalSteps - 1}
            className="group flex flex-col items-center gap-0.5 p-1.5 rounded-md transition-colors disabled:opacity-30"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <Icon name="skip_next" size={22} />
            <span className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">Next</span>
          </button>

          {/* Stop */}
          <button
            onClick={stop}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            aria-label="Stop"
          >
            <Icon name="stop" size={22} />
          </button>

          {/* Divider */}
          <div className="h-8 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />

          {/* Speed control */}
          <div className="flex rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
            {[1, 2, 3].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className="px-3 py-1 rounded-md text-xs font-bold transition-all"
                style={{
                  background: speed === s ? 'rgba(97,22,218,0.2)' : 'transparent',
                  color: speed === s ? 'white' : 'var(--color-text-muted)',
                  border: speed === s ? '1px solid rgba(97,22,218,0.3)' : '1px solid transparent',
                }}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="h-8 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />

          {/* Replay Step */}
          <button
            onClick={replayStep}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
            style={{
              background: 'var(--color-surface-dark)',
              borderColor: 'var(--color-border-default)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <Icon name="history" size={16} />
            Replay Step
          </button>

          {/* Flag Issue */}
          <button
            onClick={handleFlagIssue}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
            style={{
              background: 'var(--color-surface-dark)',
              borderColor: 'var(--color-border-default)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <Icon name="bug_report" size={16} />
            Flag Issue
          </button>

          {/* Divider */}
          <div className="h-8 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />

          {/* Logs toggle */}
          <button
            onClick={toggleLogsPanel}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
            style={{
              background: 'var(--color-surface-dark)',
              borderColor: 'var(--color-border-default)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <Icon name="terminal" size={16} />
            Logs
          </button>
        </div>
      </div>
    </div>
  );
};
