import { Icon } from '../shared/Icon';

const METRICS = [
  { label: 'Flow Paths', value: '11', icon: 'route', color: '#7b59e6' },
  { label: 'Status Mappings', value: '12', icon: 'swap_horiz', color: '#06b6d4' },
  { label: 'BullMQ Jobs', value: '6', icon: 'schedule', color: '#a855f7' },
  { label: 'Feature Flags', value: '3', icon: 'flag', color: '#f59e0b' },
];

const KEY_POINTS = [
  'Syncs internal trip status changes to a rider/driver-facing booking_status field on the Trip schema',
  'Uses optimistic locking (updateOne with status guard) to prevent race conditions',
  'All side effects (notifications, DAC, cleanup) are fire-and-forget — never block the response',
  'Feature flags control rollout: ENABLE_BOOKING_JOBS, ENABLE_PRE_TRIP_RIDER_CONFIRMATION, ENABLE_DRIVER_CONFIRMATION',
  'Two entry points: rider endpoint (PUT /rider/trips/:tripId/booking-status) and driver endpoint (PUT /b2c/driver/trips/:tripId/booking-status)',
];

export function ExecutiveSummarySection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-2">What is Sync Booking Status?</h4>
        <p className="text-sm text-slate-400 leading-relaxed">
          The Scheduled Ride Booking Status Sync feature maintains a parallel <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded text-slate-300">booking_status</code> field
          on the Trip schema that reflects the lifecycle of a scheduled (booked) ride. When internal trip statuses change
          (e.g., driver assigned, trip started, rider cancelled), the middleware automatically maps these to
          booking-specific statuses that the mobile apps consume.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {METRICS.map((m) => (
          <div
            key={m.label}
            className="rounded-lg border p-3 text-center"
            style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2"
              style={{ background: `${m.color}20`, color: m.color }}
            >
              <Icon name={m.icon} size={18} />
            </div>
            <div className="text-2xl font-bold text-white">{m.value}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Key Points</h4>
        <ul className="space-y-2">
          {KEY_POINTS.map((point, i) => (
            <li key={i} className="flex items-start gap-2">
              <Icon name="check_circle" size={16} className="text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-sm text-slate-400 leading-relaxed">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
