import type { FlowStep } from '../../data/types';
import { Icon } from '../shared/Icon';

interface StatusCardProps {
  step: FlowStep;
  stepIndex: number;
}

export function StatusCard({ step, stepIndex }: StatusCardProps) {
  return (
    <div className="rounded-xl p-4 border"
      style={{
        background: 'var(--color-surface-highlight)',
        borderColor: 'var(--color-surface-highlight)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-400 uppercase">Current State</span>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border"
          style={{
            background: 'rgba(59,130,246,0.2)',
            color: 'rgb(147,197,253)',
            borderColor: 'rgba(59,130,246,0.3)',
          }}
        >
          Step {stepIndex + 1}
        </span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="h-3 w-3 rounded-full animate-pulse"
          style={{ backgroundColor: '#eab308' }}
        />
        <h2 className="text-white text-lg font-bold font-display break-all">{step.bookingStatus}</h2>
      </div>
      <p className="text-slate-400 text-sm leading-relaxed">
        {step.description}
      </p>

      {/* Side effects badges */}
      {Object.keys(step.sideEffects).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t"
          style={{ borderColor: 'rgba(255,255,255,0.05)' }}
        >
          {step.sideEffects.jobs && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md"
              style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
            >
              <Icon name="work" size={12} /> {step.sideEffects.jobs}
            </span>
          )}
          {step.sideEffects.notifications && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md"
              style={{ background: 'rgba(251,37,118,0.15)', color: '#fb2576' }}
            >
              <Icon name="notifications" size={12} /> {step.sideEffects.notifications}
            </span>
          )}
          {step.sideEffects.dac && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md"
              style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}
            >
              <Icon name="assignment" size={12} /> {step.sideEffects.dac}
            </span>
          )}
          {step.sideEffects.pubsub && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md"
              style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}
            >
              <Icon name="cell_tower" size={12} /> {step.sideEffects.pubsub}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
