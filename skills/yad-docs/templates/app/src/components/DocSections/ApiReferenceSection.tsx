import { Icon } from '../shared/Icon';

const ENDPOINTS = [
  {
    method: 'PUT',
    path: '/b2c/rider/services/v6/request',
    description: 'Internal trip status update — triggers fnUpdateBookingStatus middleware',
    middleware: [
      'validateTripStatus',
      'fnUpdateBookingStatus',
      'fnUpdateCancelBookingStatus',
      'fnCancelBookedTripScheduledJobs',
      'fnDeleteScheduledRideDac',
      'publishScheduledRideDacMW',
      'scheduleBookingJobs',
    ],
    category: 'rider',
  },
  {
    method: 'PUT',
    path: '/rider/trips/:tripId/booking-status',
    description: 'Rider booking status update — confirmation, unconfirmation, cancellation',
    middleware: [
      'validateBookingStatusTransition',
      'saveBookingStatusUpdate',
      'fnCancelBookedTripScheduledJobs',
      'fnDeleteScheduledRideDac',
      'publishScheduledRideDacMW',
      'sendBookingNotification',
    ],
    category: 'rider',
  },
  {
    method: 'PUT',
    path: '/b2c/driver/trips/:tripId/booking-status',
    description: 'Driver booking status update — accept or cancel assigned ride',
    middleware: [
      'validateDriverBookingTransition',
      'saveBookingStatusUpdate',
      'fnCancelBookedTripScheduledJobs',
      'publishRideDispatchBookingMW',
      'publishScheduledRideDacMW',
      'sendBookingNotification',
    ],
    category: 'driver',
  },
];

export function ApiReferenceSection() {
  return (
    <div className="space-y-4">
      {ENDPOINTS.map((ep) => (
        <div
          key={ep.path}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="px-4 py-3 flex items-center gap-3 border-b" style={{ borderColor: 'var(--color-border-default)' }}>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{
                background: ep.method === 'PUT' ? 'rgba(251,191,36,0.15)' : 'rgba(96,165,250,0.15)',
                color: ep.method === 'PUT' ? '#fbbf24' : '#60a5fa',
              }}
            >
              {ep.method}
            </span>
            <code className="text-sm text-slate-200 font-mono">{ep.path}</code>
            <span
              className="ml-auto text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded"
              style={{
                color: ep.category === 'rider' ? '#7b59e6' : '#06b6d4',
                background: ep.category === 'rider' ? 'rgba(123,89,230,0.1)' : 'rgba(6,182,212,0.1)',
              }}
            >
              {ep.category}
            </span>
          </div>
          <div className="px-4 py-2.5">
            <p className="text-xs text-slate-400 mb-3">{ep.description}</p>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
              Middleware Chain ({ep.middleware.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ep.middleware.map((mw, i) => (
                <span key={mw} className="inline-flex items-center gap-1">
                  <span
                    className="px-2 py-1 rounded text-[11px] font-mono border"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      borderColor: 'var(--color-border-default)',
                      color: '#94a3b8',
                    }}
                  >
                    {mw}
                  </span>
                  {i < ep.middleware.length - 1 && (
                    <Icon name="arrow_forward" size={12} className="text-slate-600" />
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
