import { Icon } from '../shared/Icon';

const SCHEMA_FIELDS = [
  { field: 'booking_status', type: 'String', description: 'Current booking lifecycle status (enum)', indexed: true, example: 'TRIP_BOOK_PENDING' },
  { field: 'booking_status_history', type: 'Array<Object>', description: 'Audit trail of all status transitions', indexed: false, example: '[{ status, timestamp, reason? }]' },
  { field: 'is_booked', type: 'Boolean', description: 'Flag indicating this is a scheduled ride', indexed: true, example: 'true' },
  { field: 'booked_for', type: 'Date', description: 'Scheduled pickup time', indexed: true, example: '2024-12-25T14:00:00Z' },
];

const INDEXES = [
  { name: 'booking_status_1', fields: '{ booking_status: 1 }', purpose: 'Query trips by booking status' },
  { name: 'is_booked_1_booking_status_1', fields: '{ is_booked: 1, booking_status: 1 }', purpose: 'Compound: find booked trips in specific status' },
  { name: 'booked_for_1', fields: '{ booked_for: 1 }', purpose: 'Query trips by scheduled time (BullMQ job scheduling)' },
];

const QUERY_PATTERNS = [
  { name: 'Optimistic Lock Update', query: "Trip.updateOne(\n  { _id: tripId, booking_status: currentStatus },\n  { $set: { booking_status: newStatus }, $push: { booking_status_history: entry } }\n)", description: 'Core update pattern — only succeeds if status hasn\'t changed since read' },
  { name: 'Find Pending Bookings', query: "Trip.find(\n  { is_booked: true, booking_status: 'TRIP_BOOK_PENDING' }\n)", description: 'Used by BullMQ job scheduler to find trips needing confirmation' },
  { name: 'Terminal Status Guard', query: "const TERMINAL = ['TRIP_BOOK_FINISHED', 'TRIP_BOOK_OPERATION_RIDER_CANCELED',\n  'TRIP_BOOK_OPERATION_DRIVER_CANCELED', 'TRIP_BOOK_SYSTEM_CANCELED'];\nif (TERMINAL.includes(trip.booking_status)) return;", description: 'Skip middleware if booking is already in terminal state' },
];

export function DbSchemaSection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
          <Icon name="storage" size={16} className="text-emerald-400" />
          <span className="text-sm font-bold text-slate-200">Trip Schema — Booking Fields</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Field</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Type</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-400">Description</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-slate-400">Indexed</th>
            </tr>
          </thead>
          <tbody>
            {SCHEMA_FIELDS.map((f) => (
              <tr key={f.field} className="border-t hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--color-border-default)' }}>
                <td className="px-4 py-2.5 font-mono text-xs text-cyan-400">{f.field}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">{f.type}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{f.description}</td>
                <td className="px-4 py-2.5 text-center">
                  {f.indexed ? (
                    <Icon name="check_circle" size={14} className="text-emerald-400" />
                  ) : (
                    <Icon name="remove" size={14} className="text-slate-600" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Indexes</h4>
        <div className="space-y-2">
          {INDEXES.map((idx) => (
            <div key={idx.name} className="flex items-start gap-3 p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <Icon name="sort" size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <code className="text-xs font-mono text-slate-300">{idx.fields}</code>
                <p className="text-[11px] text-slate-500 mt-0.5">{idx.purpose}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Common Query Patterns</h4>
        <div className="space-y-4">
          {QUERY_PATTERNS.map((q) => (
            <div key={q.name}>
              <div className="text-xs font-semibold text-slate-300 mb-1">{q.name}</div>
              <p className="text-[11px] text-slate-500 mb-2">{q.description}</p>
              <pre className="text-[11px] font-mono text-emerald-400 bg-black/30 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap">
                {q.query}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
