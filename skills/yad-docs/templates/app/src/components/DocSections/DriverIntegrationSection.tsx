import { Icon } from '../shared/Icon';

const ENDPOINTS = [
  {
    method: 'PUT',
    path: '/b2c/driver/trips/:tripId/booking-status',
    body: '{ "booking_status": "BOOK_ACCEPTED" | "BOOK_DRIVER_CANCELED" }',
    description: 'Driver updates their booking status — accept or cancel the assigned ride.',
  },
];

const TRANSITIONS = [
  { from: 'TRIP_BOOK_PENDING', to: 'BOOK_ACCEPTED', action: 'Driver accepts the assignment' },
  { from: 'TRIP_BOOK_PENDING', to: 'BOOK_DRIVER_CANCELED', action: 'Driver cancels the assignment' },
  { from: 'TRIP_BOOK_OPERATION_DRIVER_CONFIRMED', to: 'BOOK_DRIVER_CANCELED', action: 'Driver cancels after confirming' },
];

const DAC_CARDS = [
  { action: 'confirm', description: 'Shown when driver is assigned and needs to confirm availability', triggers: 'BOOK_ACCEPTED on tap' },
  { action: 'cancel', description: 'Shown alongside confirm — driver can decline', triggers: 'BOOK_DRIVER_CANCELED on tap' },
  { action: 'view_ride', description: 'Shown after confirmation — ride details view', triggers: 'Opens ride detail screen' },
];

const INTEGRATION_CHECKLIST = [
  'Handle push notification with action "confirm_driver_booking" — show confirmation DAC card',
  'Handle push notification with action "driver_booking_timeout" — show timeout warning',
  'Handle push notification with action "driver_booking_ops_cancelled" — remove DAC card',
  'Handle push notification with action "booking_driver_assigned" — show new assignment card',
  'Handle push notification with action "booking_canceled_by_rider" — remove DAC card',
  'Implement DAC card rendering for confirm/cancel actions',
  'Handle HTTP 409 responses (concurrent update / invalid transition)',
  'Handle re-dispatch scenario: after driver cancel, ride goes back to dispatch queue',
  'Handle the publishRideDispatchBookingMW side effect: new driver may be assigned',
];

export function DriverIntegrationSection() {
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
          <span className="text-sm font-bold text-slate-200">Valid Driver Transitions</span>
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
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
          <span className="text-sm font-bold text-slate-200">DAC (Driver Action Cards)</span>
        </div>
        <div className="p-3 space-y-2">
          {DAC_CARDS.map((card) => (
            <div key={card.action} className="flex items-start gap-3 p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <Icon name="credit_card" size={16} className="text-cyan-400 mt-0.5 shrink-0" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-semibold text-slate-200">{card.action}</span>
                  <span className="text-[10px] text-slate-500">→ {card.triggers}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{card.description}</p>
              </div>
            </div>
          ))}
        </div>
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
