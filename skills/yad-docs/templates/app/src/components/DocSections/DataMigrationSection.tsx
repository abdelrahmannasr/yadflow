import { Icon } from '../shared/Icon';

const MIGRATION_STEPS = [
  {
    phase: 'Pre-migration',
    steps: [
      'Verify booking_status field exists on Trip schema (additive — no breaking changes)',
      'Run validation query to count trips with is_booked: true that lack booking_status',
      'Backup: snapshot the trips collection before running backfill',
    ],
  },
  {
    phase: 'Backfill Script',
    steps: [
      'Query all trips where is_booked: true AND booking_status is null',
      'For each trip, compute booking_status from current trip_status using TRIP_STATUS_TO_BOOKING_STATUS map',
      'Use bulkWrite with ordered: false for parallel processing',
      'Set booking_status_history to [{ status: computed_status, timestamp: trip.updatedAt }]',
    ],
  },
  {
    phase: 'Validation',
    steps: [
      'Count trips where is_booked: true AND booking_status is null — should be 0',
      'Verify booking_status values are all valid enum values',
      'Spot-check 10 random trips: compare trip_status to booking_status for consistency',
      'Run the full QA test plan against staging with backfilled data',
    ],
  },
];

const VALIDATION_QUERIES = [
  {
    label: 'Count un-migrated trips',
    query: 'db.trips.countDocuments({ is_booked: true, booking_status: { $exists: false } })',
  },
  {
    label: 'Verify valid statuses',
    query: 'db.trips.distinct("booking_status", { is_booked: true })',
  },
  {
    label: 'Check for null booking_status',
    query: 'db.trips.countDocuments({ is_booked: true, booking_status: null })',
  },
];

export function DataMigrationSection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <p className="text-sm text-slate-400 leading-relaxed">
          The <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded text-slate-300">booking_status</code> field is
          additive — it does not replace or modify any existing fields. Existing trips without this field continue to work normally.
          Migration is only needed if you want historical trips to show booking status in the UI.
        </p>
      </div>

      {MIGRATION_STEPS.map((phase) => (
        <div
          key={phase.phase}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div
            className="px-4 py-2.5 border-b"
            style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}
          >
            <span className="text-sm font-bold text-slate-200">{phase.phase}</span>
          </div>
          <ul className="p-4 space-y-2">
            {phase.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <Icon name="chevron_right" size={14} className="text-slate-600 mt-0.5 shrink-0" />
                <span className="text-xs text-slate-400">{step}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Validation Queries</h4>
        <div className="space-y-2">
          {VALIDATION_QUERIES.map((q) => (
            <div key={q.label}>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{q.label}</span>
              <pre className="mt-1 text-[11px] font-mono text-emerald-400 bg-black/30 rounded-lg px-3 py-2 overflow-x-auto">
                {q.query}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
