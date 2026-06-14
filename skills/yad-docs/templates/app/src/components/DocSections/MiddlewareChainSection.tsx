interface MiddlewareStep {
  name: string;
  description: string;
  type: 'validate' | 'persist' | 'sideEffect' | 'notify';
}

const TYPE_COLORS = {
  validate: { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
  persist: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  sideEffect: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  notify: { color: '#fb2576', bg: 'rgba(251,37,118,0.1)' },
};

const CHAINS: { title: string; endpoint: string; color: string; steps: MiddlewareStep[] }[] = [
  {
    title: 'Internal Trip Status Path',
    endpoint: 'PUT /b2c/rider/services/v6/request',
    color: '#7b59e6',
    steps: [
      { name: 'validateTripStatus', description: 'Validates trip status transition is allowed', type: 'validate' },
      { name: 'fnUpdateBookingStatus', description: 'Maps trip status to booking_status using TRIP_STATUS_TO_BOOKING_STATUS, writes with optimistic lock', type: 'persist' },
      { name: 'fnUpdateCancelBookingStatus', description: 'Handles cancel-specific booking status updates (rider/driver/system cancels)', type: 'persist' },
      { name: 'fnCancelBookedTripScheduledJobs', description: 'Removes pending BullMQ jobs on cancellation', type: 'sideEffect' },
      { name: 'fnDeleteScheduledRideDac', description: 'Deletes DAC card via Pub/Sub when trip ends or is cancelled', type: 'sideEffect' },
      { name: 'publishScheduledRideDacMW', description: 'Publishes new DAC card for driver actions (confirm/cancel)', type: 'sideEffect' },
      { name: 'scheduleBookingJobs', description: 'Schedules BullMQ jobs on assignment (pre-trip confirmation timers)', type: 'sideEffect' },
    ],
  },
  {
    title: 'Rider Booking Endpoint',
    endpoint: 'PUT /rider/trips/:tripId/booking-status',
    color: '#06b6d4',
    steps: [
      { name: 'validateBookingStatusTransition', description: 'Checks VALID_RIDER_TRANSITIONS map', type: 'validate' },
      { name: 'saveBookingStatusUpdate', description: 'Persists new booking_status with optimistic lock', type: 'persist' },
      { name: 'fnCancelBookedTripScheduledJobs', description: 'Cleans up BullMQ jobs if cancelled', type: 'sideEffect' },
      { name: 'fnDeleteScheduledRideDac', description: 'Deletes DAC card on cancellation', type: 'sideEffect' },
      { name: 'publishScheduledRideDacMW', description: 'Publishes updated DAC card', type: 'sideEffect' },
      { name: 'sendBookingNotification', description: 'Sends push notification to driver about rider action', type: 'notify' },
    ],
  },
  {
    title: 'Driver Booking Endpoint',
    endpoint: 'PUT /b2c/driver/trips/:tripId/booking-status',
    color: '#10b981',
    steps: [
      { name: 'validateDriverBookingTransition', description: 'Checks VALID_DRIVER_TRANSITIONS map', type: 'validate' },
      { name: 'saveBookingStatusUpdate', description: 'Persists new booking_status with optimistic lock', type: 'persist' },
      { name: 'fnCancelBookedTripScheduledJobs', description: 'Cleans up BullMQ jobs on driver cancel', type: 'sideEffect' },
      { name: 'publishRideDispatchBookingMW', description: 'Re-dispatches ride when driver cancels', type: 'sideEffect' },
      { name: 'publishScheduledRideDacMW', description: 'Publishes/deletes DAC card', type: 'sideEffect' },
      { name: 'sendBookingNotification', description: 'Sends push notification to rider about driver action', type: 'notify' },
    ],
  },
];

export function MiddlewareChainSection() {
  return (
    <div className="space-y-5">
      {CHAINS.map((chain) => (
        <div
          key={chain.endpoint}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: chain.color }} />
            <span className="text-sm font-bold text-slate-200">{chain.title}</span>
            <code className="text-[10px] font-mono text-slate-500 ml-auto">{chain.endpoint}</code>
          </div>
          <div className="p-3 space-y-1.5">
            {chain.steps.map((step, i) => {
              const tc = TYPE_COLORS[step.type];
              return (
                <div key={step.name} className="flex items-start gap-3 group">
                  <div className="flex flex-col items-center pt-1">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                      style={{ background: tc.bg, color: tc.color }}
                    >
                      {i + 1}
                    </div>
                    {i < chain.steps.length - 1 && (
                      <div className="w-px h-6 mt-0.5" style={{ background: 'var(--color-border-default)' }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-slate-200">{step.name}</span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                        style={{ background: tc.bg, color: tc.color }}
                      >
                        {step.type}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">{step.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
