import { Icon } from '../shared/Icon';

const ENV_CONFIGS = [
  { env: 'Staging', flags: { ENABLE_BOOKING_JOBS: true, ENABLE_PRE_TRIP_RIDER_CONFIRMATION: true, ENABLE_DRIVER_CONFIRMATION: false }, color: '#f59e0b' },
  { env: 'Production', flags: { ENABLE_BOOKING_JOBS: false, ENABLE_PRE_TRIP_RIDER_CONFIRMATION: false, ENABLE_DRIVER_CONFIRMATION: false }, color: '#ef4444' },
];

const ROLLOUT_STEPS = [
  { step: 'Deploy backend with all flags OFF', detail: 'Code ships but nothing executes — zero risk' },
  { step: 'Enable ENABLE_BOOKING_JOBS in staging', detail: 'Master switch: allows BullMQ job scheduling' },
  { step: 'Enable ENABLE_PRE_TRIP_RIDER_CONFIRMATION in staging', detail: 'Enables the 24h-before-trip rider confirmation flow' },
  { step: 'QA validates all 11 flow paths in staging', detail: 'Full regression: happy path, cancellations, timeouts' },
  { step: 'Enable ENABLE_BOOKING_JOBS in production', detail: 'Production rollout — monitor BullMQ dashboard and error rates' },
  { step: 'Enable ENABLE_PRE_TRIP_RIDER_CONFIRMATION in production', detail: 'Rider confirmation goes live — monitor notification delivery' },
  { step: 'Enable ENABLE_DRIVER_CONFIRMATION when ready', detail: 'Last phase: driver confirmation flow (currently false everywhere)' },
];

const ROLLBACK = [
  'Set ENABLE_BOOKING_JOBS=false to disable all job scheduling immediately',
  'Existing in-flight jobs will still process — they are idempotent',
  'No database migration needed — booking_status field is additive, not destructive',
  'Mobile apps degrade gracefully: they simply won\'t see booking-specific UI states',
];

export function DeploymentGuideSection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Environment Configuration</h4>
        <div className="space-y-3">
          {ENV_CONFIGS.map((env) => (
            <div key={env.env} className="flex items-center gap-3">
              <span
                className="text-xs font-bold w-24 px-2 py-1 rounded text-center"
                style={{ background: `${env.color}15`, color: env.color, border: `1px solid ${env.color}25` }}
              >
                {env.env}
              </span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(env.flags).map(([key, val]) => (
                  <span
                    key={key}
                    className="text-[11px] font-mono px-2 py-0.5 rounded border"
                    style={{
                      color: val ? '#22c55e' : '#ef4444',
                      background: val ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                      borderColor: val ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                    }}
                  >
                    {key}={val ? 'true' : 'false'}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Rollout Steps</h4>
        <div className="space-y-3">
          {ROLLOUT_STEPS.map((s, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                style={{ background: 'rgba(123,89,230,0.15)', color: '#7b59e6' }}
              >
                {i + 1}
              </div>
              <div>
                <div className="text-sm text-slate-200 font-medium">{s.step}</div>
                <p className="text-xs text-slate-500 mt-0.5">{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Icon name="replay" size={18} className="text-red-400" />
          <h4 className="text-sm font-bold text-red-300">Rollback Procedure</h4>
        </div>
        <ul className="space-y-2">
          {ROLLBACK.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <Icon name="arrow_right" size={14} className="text-red-400 mt-0.5 shrink-0" />
              <span className="text-xs text-slate-400">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
