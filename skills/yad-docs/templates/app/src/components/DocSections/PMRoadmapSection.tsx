import { Icon } from '../shared/Icon';

const PHASES = [
  {
    phase: 'Phase 1 — Foundation',
    status: 'completed',
    color: '#22c55e',
    items: [
      'booking_status field added to Trip schema',
      'TRIP_STATUS_TO_BOOKING_STATUS mapping (12 entries)',
      'fnUpdateBookingStatus middleware on internal trip updates',
      'Rider booking status endpoint (confirm/unconfirm/cancel)',
      'Driver booking status endpoint (accept/cancel)',
    ],
  },
  {
    phase: 'Phase 2 — Scheduled Jobs',
    status: 'in-staging',
    color: '#f59e0b',
    items: [
      'BullMQ job scheduling for pre-trip confirmations',
      'Rider confirmation timeout chain (24h → 30min → 15min)',
      'Ops intervention window for unconfirmed bookings',
      'Job cleanup on cancellation/completion',
    ],
  },
  {
    phase: 'Phase 3 — Driver Confirmation',
    status: 'planned',
    color: '#8b5cf6',
    items: [
      'ENABLE_DRIVER_CONFIRMATION flag activation',
      'Driver confirmation timeout chain (40min → 5min → 10min)',
      'Fast-track auto-confirmation for imminent rides',
      'handleBookAssigned decision tree (time threshold logic)',
    ],
  },
  {
    phase: 'Phase 4 — Enhancements',
    status: 'planned',
    color: '#64748b',
    items: [
      'Ops dashboard for booking status monitoring',
      'Analytics events for booking funnel tracking',
      'Rider/driver app booking status history view',
      'Automated reporting for cancellation patterns',
    ],
  },
];

const STATUS_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  completed: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)', label: 'Completed' },
  'in-staging': { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'In Staging' },
  planned: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', label: 'Planned' },
};

const RISKS = [
  { risk: 'Redis downtime blocks all BullMQ jobs', mitigation: 'Redis HA setup + fallback to manual ops processing', level: 'high' },
  { risk: 'Mobile app not handling new booking statuses', mitigation: 'Graceful degradation — unknown statuses treated as pending', level: 'medium' },
  { risk: 'Notification service rate limiting', mitigation: 'Fire-and-forget pattern prevents blocking; add retry queue later', level: 'low' },
];

export function PMRoadmapSection() {
  return (
    <div className="space-y-5">
      {PHASES.map((phase) => {
        const sc = STATUS_COLORS[phase.status];
        return (
          <div
            key={phase.phase}
            className="rounded-xl border overflow-hidden"
            style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
          >
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: phase.color }} />
                <span className="text-sm font-bold text-slate-200">{phase.phase}</span>
              </div>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded"
                style={{ background: sc.bg, color: sc.color }}
              >
                {sc.label}
              </span>
            </div>
            <ul className="p-4 space-y-1.5">
              {phase.items.map((item, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Icon
                    name={phase.status === 'completed' ? 'check_circle' : 'radio_button_unchecked'}
                    size={14}
                    className={phase.status === 'completed' ? 'text-emerald-400' : 'text-slate-600'}
                  />
                  <span className="text-xs text-slate-400">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Risk Register</h4>
        <div className="space-y-2">
          {RISKS.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-2.5 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <span
                className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                style={{
                  color: r.level === 'high' ? '#ef4444' : r.level === 'medium' ? '#f59e0b' : '#22c55e',
                  background: r.level === 'high' ? 'rgba(239,68,68,0.1)' : r.level === 'medium' ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
                }}
              >
                {r.level}
              </span>
              <div>
                <div className="text-xs text-slate-300">{r.risk}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Mitigation: {r.mitigation}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
