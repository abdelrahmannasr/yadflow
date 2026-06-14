import { Icon } from '../shared/Icon';
import { STATUS_MAPPINGS } from '../../data/referenceData';

const CATEGORY_COLORS: Record<string, string> = {
  Completion: '#22c55e',
  'Rider cancel': '#ef4444',
  'Driver cancel': '#f97316',
  'System cancel': '#eab308',
  'Active trip cancel': '#ec4899',
  'Driver confirm': '#06b6d4',
  'Assignment (special)': '#8b5cf6',
};

const TERMINAL_STATUSES = [
  'TRIP_BOOK_FINISHED',
  'TRIP_BOOK_OPERATION_RIDER_CANCELED',
  'TRIP_BOOK_OPERATION_DRIVER_CANCELED',
  'TRIP_BOOK_SYSTEM_CANCELED',
];

export function StatusMachineSection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
          <span className="text-sm font-bold text-slate-200">TRIP_STATUS → BOOKING_STATUS Mapping</span>
          <span className="text-[10px] font-bold text-slate-400">{STATUS_MAPPINGS.length} entries</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400">Trip Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400">Booking Status</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400">Category</th>
            </tr>
          </thead>
          <tbody>
            {STATUS_MAPPINGS.map((m) => {
              const color = CATEGORY_COLORS[m.category] || '#64748b';
              return (
                <tr
                  key={m.tripStatus}
                  className="border-t hover:bg-white/5 transition-colors"
                  style={{ borderColor: 'var(--color-border-default)' }}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{m.tripStatus}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{m.bookingStatus}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className="text-[10px] font-medium px-2 py-0.5 rounded border"
                      style={{ color, background: `${color}15`, borderColor: `${color}25` }}
                    >
                      {m.category}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Terminal States</h4>
        <p className="text-xs text-slate-400 mb-3">
          Once a booking reaches a terminal state, no further transitions are allowed. The <code className="text-xs bg-white/5 px-1 rounded text-slate-300">fnUpdateBookingStatus</code> middleware
          includes a guard that skips updates if the current status is terminal.
        </p>
        <div className="flex flex-wrap gap-2">
          {TERMINAL_STATUSES.map((s) => (
            <span
              key={s}
              className="px-2.5 py-1 rounded-md text-xs font-mono border"
              style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', color: '#f87171' }}
            >
              <Icon name="block" size={12} className="inline mr-1" />
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
