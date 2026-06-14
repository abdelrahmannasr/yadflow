import type { FlowStep } from '../../data/types';
import { Icon } from '../shared/Icon';

interface RequestPayloadPreviewProps {
  step: FlowStep;
}

export function RequestPayloadPreview({ step }: RequestPayloadPreviewProps) {
  const payload = {
    step_id: step.id,
    actor: step.actor,
    status: step.status,
    booking_status: step.bookingStatus,
    trigger: step.trigger,
    active_components: step.activeComponents,
    messages: step.messages.map((m) => ({
      from: m.from,
      to: m.to,
      type: m.type,
      label: m.label,
    })),
    ...(Object.keys(step.sideEffects).length > 0 && {
      side_effects: step.sideEffects,
    }),
  };

  const jsonStr = JSON.stringify(payload, null, 2);

  return (
    <div>
      <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
        <Icon name="data_object" size={16} /> Request Payload
      </h4>
      <div className="rounded-lg p-3 border overflow-hidden"
        style={{
          background: 'var(--color-surface-darker)',
          borderColor: 'var(--color-surface-highlight)',
        }}
      >
        <pre className="text-[11px] text-green-400 font-mono leading-relaxed overflow-x-auto max-h-40">
          <code>{jsonStr}</code>
        </pre>
      </div>
    </div>
  );
}
