import { Icon } from '../shared/Icon';

const SCENARIOS = [
  {
    name: 'Concurrent Booking Updates',
    description: 'Simulate multiple status updates hitting the same trip simultaneously',
    expected: 'Only one succeeds (optimistic lock), others skip silently with modifiedCount: 0',
    metric: '< 50ms p99 for updateOne with status guard',
  },
  {
    name: 'BullMQ Job Throughput',
    description: 'Schedule 1000 confirmation jobs within 1 minute',
    expected: 'All jobs processed within their delay windows, no job drops',
    metric: 'Queue depth returns to 0 within expected timeframe + 10% buffer',
  },
  {
    name: 'Notification Burst',
    description: 'Trigger 500 booking notifications simultaneously',
    expected: 'All notifications delivered via FCM/APNS, fire-and-forget pattern prevents blocking',
    metric: '< 200ms for notification dispatch (excludes delivery)',
  },
  {
    name: 'DAC Pub/Sub Latency',
    description: 'Publish/delete 100 DAC cards in rapid succession',
    expected: 'All Pub/Sub messages acknowledged within timeout',
    metric: '< 100ms per Pub/Sub publish',
  },
  {
    name: 'Full Flow Path Execution',
    description: 'Execute all 11 flow paths sequentially with realistic delays',
    expected: 'All paths reach terminal state with correct booking_status',
    metric: 'No memory leaks, no connection pool exhaustion',
  },
];

const KEY_METRICS = [
  { metric: 'MongoDB updateOne (with guard)', target: '< 10ms p50, < 50ms p99', icon: 'storage' },
  { metric: 'BullMQ job scheduling', target: '< 5ms per add()', icon: 'schedule' },
  { metric: 'Pub/Sub publish', target: '< 100ms per message', icon: 'cloud_upload' },
  { metric: 'API endpoint response', target: '< 200ms p99 (end-to-end)', icon: 'speed' },
];

export function PerformanceTestingSection() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {KEY_METRICS.map((m) => (
          <div
            key={m.metric}
            className="rounded-lg border p-3"
            style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
          >
            <Icon name={m.icon} size={18} className="text-cyan-400 mb-2" />
            <div className="text-xs text-slate-200 font-medium">{m.metric}</div>
            <div className="text-[11px] text-emerald-400 font-mono mt-1">{m.target}</div>
          </div>
        ))}
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
          <span className="text-sm font-bold text-slate-200">Load Test Scenarios</span>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--color-border-default)' }}>
          {SCENARIOS.map((s) => (
            <div key={s.name} className="p-4 hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--color-border-default)' }}>
              <div className="text-sm font-semibold text-slate-200 mb-1">{s.name}</div>
              <p className="text-xs text-slate-400 mb-2">{s.description}</p>
              <div className="flex flex-wrap gap-3">
                <span className="text-[10px] text-slate-500">
                  <strong className="text-slate-400">Expected:</strong> {s.expected}
                </span>
              </div>
              <div className="mt-1.5">
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded border"
                  style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.2)', color: '#22c55e' }}
                >
                  Target: {s.metric}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
