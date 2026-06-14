import { DEEPLINK_ACTIONS } from '../../data/referenceData';

const PUSH_PAYLOAD_EXAMPLE = {
  notification: {
    title: '{{ localized_title }}',
    body: '{{ localized_body }}',
  },
  data: {
    action: 'confirm_booking',
    trip_id: '{{ trip._id }}',
    deeplink: 'yassir://booking/confirm?tripId={{ trip._id }}',
  },
};

const LOCALIZATION_KEYS = [
  { action: 'confirm_booking', titleKey: 'booking.confirm.title', bodyKey: 'booking.confirm.body', description: 'Asks rider to confirm their scheduled ride' },
  { action: 'booking_timeout', titleKey: 'booking.timeout.title', bodyKey: 'booking.timeout.body', description: 'Warns rider their confirmation window is closing' },
  { action: 'booking_cancelled', titleKey: 'booking.cancelled.title', bodyKey: 'booking.cancelled.body', description: 'Informs rider booking was cancelled' },
  { action: 'confirm_driver_booking', titleKey: 'driver.booking.confirm.title', bodyKey: 'driver.booking.confirm.body', description: 'Asks driver to confirm availability' },
  { action: 'booking_driver_assigned', titleKey: 'driver.booking.assigned.title', bodyKey: 'driver.booking.assigned.body', description: 'Notifies driver of new assignment' },
  { action: 'booking_driver_assigned_rider', titleKey: 'booking.driver_assigned.title', bodyKey: 'booking.driver_assigned.body', description: 'Notifies rider that driver is assigned' },
  { action: 'booking_driver_confirmed_rider', titleKey: 'booking.driver_confirmed.title', bodyKey: 'booking.driver_confirmed.body', description: 'Notifies rider that driver confirmed' },
];

export function NotificationLocalizationSection() {
  const riderActions = DEEPLINK_ACTIONS.filter((a) => a.target === 'rider');
  const driverActions = DEEPLINK_ACTIONS.filter((a) => a.target === 'driver');

  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-2">Push Notification Payload Format</h4>
        <p className="text-xs text-slate-400 mb-3">
          All booking notifications use <code className="text-xs bg-white/5 px-1 rounded text-slate-300">sendBookingNotificationWithConfig</code> which
          wraps the standard notification service. The payload follows this structure:
        </p>
        <pre className="text-[11px] font-mono text-emerald-400 bg-black/30 rounded-lg p-3 overflow-x-auto">
          {JSON.stringify(PUSH_PAYLOAD_EXAMPLE, null, 2)}
        </pre>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
          <span className="text-sm font-bold text-slate-200">Localization Keys</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Action</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Title Key</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Body Key</th>
            </tr>
          </thead>
          <tbody>
            {LOCALIZATION_KEYS.map((k) => (
              <tr key={k.action} className="border-t hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--color-border-default)' }}>
                <td className="px-4 py-2 font-mono text-[11px] text-cyan-400">{k.action}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-slate-400">{k.titleKey}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-slate-400">{k.bodyKey}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Action Summary</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 block">
              Rider ({riderActions.length})
            </span>
            <div className="space-y-1">
              {riderActions.map((a) => (
                <div key={a.value} className="text-[11px] font-mono text-slate-400">{a.value}</div>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 block">
              Driver ({driverActions.length})
            </span>
            <div className="space-y-1">
              {driverActions.map((a) => (
                <div key={a.value} className="text-[11px] font-mono text-slate-400">{a.value}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
