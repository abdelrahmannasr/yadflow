import type { FlowStep } from '../../data/types';
import { Icon } from '../shared/Icon';
import { ACTOR_ICONS } from '../../utils/iconMap';

interface TriggerEventCardProps {
  step: FlowStep;
}

export function TriggerEventCard({ step }: TriggerEventCardProps) {
  const actorIcon = ACTOR_ICONS[step.actor] || 'person';

  return (
    <div>
      <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
        <Icon name="bolt" size={16} /> Trigger Event
      </h4>
      <div className="rounded-lg p-3 border group relative"
        style={{
          background: 'var(--color-surface-darker)',
          borderColor: 'var(--color-surface-highlight)',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-bold px-1.5 rounded text-white"
            style={{ background: 'var(--color-primary)' }}
          >
            {step.actor.toUpperCase()}
          </span>
          <Icon name={actorIcon} size={14} className="text-slate-400" />
          <span className="text-xs text-slate-300 font-mono break-all">{step.trigger}</span>
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          Status: {step.status}
        </div>
        <button
          onClick={() => navigator.clipboard.writeText(step.trigger)}
          className="absolute top-2 right-2 text-slate-600 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Copy trigger"
        >
          <Icon name="content_copy" size={16} />
        </button>
      </div>
    </div>
  );
}
