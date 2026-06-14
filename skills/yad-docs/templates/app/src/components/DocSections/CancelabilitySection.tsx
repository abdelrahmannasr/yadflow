import { Icon } from '../shared/Icon';

const CANCELABILITY_RULES = [
  { status: 'TRIP_BOOK_PENDING', riderCancel: true, driverCancel: false, opsCancel: true, note: 'Before assignment — rider or ops can cancel freely' },
  { status: 'TRIP_BOOK_RIDER_CONFIRMED', riderCancel: true, driverCancel: false, opsCancel: true, note: 'Rider confirmed but no driver yet' },
  { status: 'TRIP_BOOK_OPERATION_DRIVER_CONFIRMED', riderCancel: true, driverCancel: true, opsCancel: true, note: 'Both confirmed — either party can still cancel' },
  { status: 'TRIP_BOOK_FINISHED', riderCancel: false, driverCancel: false, opsCancel: false, note: 'Terminal: trip completed' },
  { status: 'TRIP_BOOK_OPERATION_RIDER_CANCELED', riderCancel: false, driverCancel: false, opsCancel: false, note: 'Terminal: rider cancelled' },
  { status: 'TRIP_BOOK_OPERATION_DRIVER_CANCELED', riderCancel: false, driverCancel: false, opsCancel: false, note: 'Terminal: driver cancelled' },
  { status: 'TRIP_BOOK_SYSTEM_CANCELED', riderCancel: false, driverCancel: false, opsCancel: false, note: 'Terminal: system auto-cancelled (timeout)' },
];

function CancelBadge({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <span className="inline-flex items-center gap-0.5 text-emerald-400 text-[11px] font-medium">
      <Icon name="check_circle" size={13} /> Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-slate-600 text-[11px]">
      <Icon name="block" size={13} /> No
    </span>
  );
}

export function CancelabilitySection() {
  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <p className="text-sm text-slate-400 leading-relaxed">
          Cancellation is only possible before a booking reaches a <strong className="text-white">terminal state</strong>.
          The terminal status guard in <code className="text-xs bg-white/5 px-1 rounded text-slate-300">fnUpdateBookingStatus</code> prevents
          any further transitions once a booking is finished, cancelled by rider/driver, or auto-cancelled by the system.
        </p>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <table className="w-full text-sm">
          <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400">Booking Status</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-400">Rider</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-400">Driver</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-400">Ops</th>
            </tr>
          </thead>
          <tbody>
            {CANCELABILITY_RULES.map((rule) => (
              <tr
                key={rule.status}
                className="border-t hover:bg-white/5 transition-colors"
                style={{ borderColor: 'var(--color-border-default)' }}
              >
                <td className="px-4 py-2.5">
                  <div className="font-mono text-xs text-slate-300">{rule.status}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{rule.note}</div>
                </td>
                <td className="px-4 py-2.5 text-center"><CancelBadge allowed={rule.riderCancel} /></td>
                <td className="px-4 py-2.5 text-center"><CancelBadge allowed={rule.driverCancel} /></td>
                <td className="px-4 py-2.5 text-center"><CancelBadge allowed={rule.opsCancel} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
