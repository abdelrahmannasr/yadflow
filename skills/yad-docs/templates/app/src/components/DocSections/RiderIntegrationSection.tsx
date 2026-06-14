import { Icon } from '../shared/Icon';

const ENDPOINTS = [
  {
    method: 'PUT',
    path: '/rider/trips/:tripId/booking-status',
    body: '{ "booking_status": "BOOK_CONFIRMED" | "BOOK_UNCONFIRMED" | "RIDER_CANCELED" }',
    description: 'Rider updates their booking status — confirm, decline, or cancel.',
  },
];

const TRANSITIONS = [
  { from: 'TRIP_BOOK_PENDING', to: 'BOOK_CONFIRMED', action: 'Rider confirms the booking' },
  { from: 'TRIP_BOOK_PENDING', to: 'BOOK_UNCONFIRMED', action: 'Rider declines (maps to BOOK_RIDER_CANCELED)' },
  { from: 'TRIP_BOOK_PENDING', to: 'RIDER_CANCELED', action: 'Rider cancels before confirmation' },
  { from: 'TRIP_BOOK_RIDER_CONFIRMED', to: 'RIDER_CANCELED', action: 'Rider cancels after confirming' },
];

const INTEGRATION_CHECKLIST = [
  'Handle push notification with action "confirm_booking" — deep link to booking confirmation screen',
  'Handle push notification with action "booking_timeout" — show warning that confirmation window is closing',
  'Handle push notification with action "booking_cancelled" — show cancellation screen',
  'Handle push notification with action "booking_driver_assigned_rider" — show driver info',
  'Handle push notification with action "booking_driver_confirmed_rider" — show confirmed status',
  'Handle push notification with action "booking_canceled_by_driver" — show re-assignment pending',
  'Implement booking status polling or WebSocket for real-time status updates',
  'Handle HTTP 409 responses gracefully (concurrent update / invalid transition)',
  'Handle HTTP 404 for non-booked trips (is_booked: false)',
];

export function RiderIntegrationSection() {
  return (
    <div className="space-y-5">
      {ENDPOINTS.map((ep) => (
        <div
          key={ep.path}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="px-4 py-3 flex items-center gap-3 border-b" style={{ borderColor: 'var(--color-border-default)' }}>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
              {ep.method}
            </span>
            <code className="text-sm text-slate-200 font-mono">{ep.path}</code>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-slate-400 mb-2">{ep.description}</p>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Request Body</span>
            <pre className="mt-1 text-[11px] font-mono text-emerald-400 bg-black/30 rounded-lg px-3 py-2">{ep.body}</pre>
          </div>
        </div>
      ))}

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
          <span className="text-sm font-bold text-slate-200">Valid Rider Transitions</span>
        </div>
        <table className="w-full text-sm">
          <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">From</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-slate-400"></th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">To</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Action</th>
            </tr>
          </thead>
          <tbody>
            {TRANSITIONS.map((t, i) => (
              <tr key={i} className="border-t hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--color-border-default)' }}>
                <td className="px-4 py-2 font-mono text-[11px] text-slate-400">{t.from}</td>
                <td className="px-4 py-2 text-center"><Icon name="arrow_forward" size={14} className="text-slate-600" /></td>
                <td className="px-4 py-2 font-mono text-[11px] text-cyan-400">{t.to}</td>
                <td className="px-4 py-2 text-xs text-slate-400">{t.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Integration Checklist</h4>
        <ul className="space-y-2">
          {INTEGRATION_CHECKLIST.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <Icon name="check_box_outline_blank" size={16} className="text-slate-600 mt-0.5 shrink-0" />
              <span className="text-xs text-slate-400">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
