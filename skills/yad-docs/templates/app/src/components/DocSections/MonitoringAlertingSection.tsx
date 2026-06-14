import { Icon } from '../shared/Icon';

const METRICS = [
  {
    name: 'booking_status_update_rate',
    type: 'Counter',
    description: 'Number of booking status updates per minute',
    alert: '> 500/min sustained → investigate traffic spike',
    source: 'fnUpdateBookingStatus middleware',
  },
  {
    name: 'optimistic_lock_failure_rate',
    type: 'Counter',
    description: 'Number of modifiedCount: 0 responses',
    alert: '> 5% of total updates → investigate concurrent access patterns',
    source: 'Trip.updateOne with booking_status guard',
  },
  {
    name: 'bullmq_job_processing_time',
    type: 'Histogram',
    description: 'Time from job scheduled to job completed',
    alert: 'p99 > 30s → check Redis latency and worker health',
    source: 'BullMQ worker event listeners',
  },
  {
    name: 'bullmq_queue_depth',
    type: 'Gauge',
    description: 'Number of waiting jobs in booking-trips queue',
    alert: '> 100 waiting → workers may be stuck or undersized',
    source: 'BullMQ queue.getWaitingCount()',
  },
  {
    name: 'notification_delivery_failures',
    type: 'Counter',
    description: 'Failed push notification sends',
    alert: '> 10% failure rate → check FCM/APNS credentials',
    source: 'sendBookingNotificationWithConfig .catch()',
  },
  {
    name: 'dac_pubsub_publish_failures',
    type: 'Counter',
    description: 'Failed DAC Pub/Sub publishes',
    alert: 'Any sustained failures → check GCP Pub/Sub health',
    source: 'publishScheduledRideDacMW',
  },
];

const DASHBOARD_PANELS = [
  'Booking status distribution (pie chart: terminal vs active)',
  'Update rate over time (time series: last 24h)',
  'Optimistic lock failure ratio (single stat + trend)',
  'BullMQ queue depth and processing rate (dual axis)',
  'Notification delivery success rate (gauge)',
  'Top error codes by frequency (bar chart)',
];

export function MonitoringAlertingSection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
          <span className="text-sm font-bold text-slate-200">Key Metrics & Alert Thresholds</span>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--color-border-default)' }}>
          {METRICS.map((m) => (
            <div key={m.name} className="p-4 hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--color-border-default)' }}>
              <div className="flex items-center gap-2 mb-1">
                <code className="text-xs font-mono text-cyan-400">{m.name}</code>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-muted)' }}
                >
                  {m.type}
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-1.5">{m.description}</p>
              <div className="flex items-start gap-2">
                <Icon name="notifications_active" size={12} className="text-amber-400 mt-0.5" />
                <span className="text-[11px] text-amber-300">{m.alert}</span>
              </div>
              <div className="text-[10px] text-slate-600 mt-1">Source: {m.source}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Grafana Dashboard Panels</h4>
        <div className="space-y-1.5">
          {DASHBOARD_PANELS.map((panel, i) => (
            <div key={i} className="flex items-center gap-2">
              <Icon name="dashboard" size={14} className="text-slate-600" />
              <span className="text-xs text-slate-400">{panel}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
