import { useState } from 'react';
import { Icon } from '../shared/Icon';

interface TestCase {
  id: string;
  scenario: string;
  steps: string[];
  expected: string;
  priority: 'critical' | 'high' | 'medium';
}

const PRIORITY_COLORS = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  high: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  medium: { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
};

const TEST_CASES: TestCase[] = [
  {
    id: 'TC-001',
    scenario: 'Happy Path — Rider confirms booking',
    steps: ['Create scheduled trip', 'Wait for confirmation notification (24h before)', 'Rider sends BOOK_CONFIRMED', 'Verify booking_status = TRIP_BOOK_RIDER_CONFIRMED'],
    expected: 'Status transitions correctly, notification sent to driver, history updated',
    priority: 'critical',
  },
  {
    id: 'TC-002',
    scenario: 'Rider declines confirmation',
    steps: ['Create scheduled trip', 'Wait for confirmation notification', 'Rider sends BOOK_UNCONFIRMED', 'Verify booking_status = TRIP_BOOK_RIDER_CANCELED'],
    expected: 'Booking cancelled, BullMQ jobs cleaned up, DAC deleted, driver notified',
    priority: 'critical',
  },
  {
    id: 'TC-003',
    scenario: 'Rider confirmation timeout → ops timeout → system cancel',
    steps: ['Create trip', 'Let rider confirmation expire (30 min)', 'Let ops window expire (15 min)', 'Verify auto-cancellation'],
    expected: 'booking_status = TRIP_BOOK_SYSTEM_CANCELED after full timeout chain',
    priority: 'critical',
  },
  {
    id: 'TC-004',
    scenario: 'Driver accepts booking',
    steps: ['Create trip with assigned driver', 'Driver sends BOOK_ACCEPTED', 'Verify booking_status = TRIP_BOOK_OPERATION_DRIVER_CONFIRMED'],
    expected: 'Status updated, rider notified, DAC card updated',
    priority: 'high',
  },
  {
    id: 'TC-005',
    scenario: 'Driver cancels booking',
    steps: ['Create trip with assigned driver', 'Driver sends BOOK_DRIVER_CANCELED', 'Verify re-dispatch triggered'],
    expected: 'Status = TRIP_BOOK_OPERATION_DRIVER_CANCELED, ride re-dispatched, rider notified',
    priority: 'high',
  },
  {
    id: 'TC-006',
    scenario: 'Concurrent update (optimistic lock)',
    steps: ['Send two booking status updates simultaneously for same trip', 'Verify only one succeeds'],
    expected: 'One update returns success, other silently skips (modifiedCount: 0)',
    priority: 'high',
  },
  {
    id: 'TC-007',
    scenario: 'Invalid transition rejected',
    steps: ['Set booking_status to TRIP_BOOK_FINISHED (terminal)', 'Attempt to send BOOK_CONFIRMED'],
    expected: 'HTTP 409 — INVALID_BOOKING_STATUS_TRANSITION',
    priority: 'medium',
  },
  {
    id: 'TC-008',
    scenario: 'Active trip cancellation (DRIVER_COMING)',
    steps: ['Trip reaches DRIVER_COMING status', 'Rider cancels active trip', 'Verify booking_status sync'],
    expected: 'booking_status = TRIP_BOOK_OPERATION_RIDER_CANCELED via fnUpdateBookingStatus',
    priority: 'high',
  },
  {
    id: 'TC-009',
    scenario: 'Feature flags OFF — no jobs scheduled',
    steps: ['Set ENABLE_BOOKING_JOBS=false', 'Create scheduled trip', 'Verify no BullMQ jobs created'],
    expected: 'Trip created normally but no confirmation jobs in queue',
    priority: 'medium',
  },
  {
    id: 'TC-010',
    scenario: 'Non-booked trip — endpoints return 404',
    steps: ['Create regular (non-scheduled) trip', 'Call PUT /rider/trips/:id/booking-status'],
    expected: 'HTTP 404 — NOT_A_BOOKED_TRIP',
    priority: 'medium',
  },
];

export function TestPlanSection() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-slate-200">Test Coverage</span>
          <div className="flex gap-3">
            {(['critical', 'high', 'medium'] as const).map((p) => {
              const count = TEST_CASES.filter((t) => t.priority === p).length;
              const pc = PRIORITY_COLORS[p];
              return (
                <span key={p} className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: pc.bg, color: pc.color }}>
                  {p}: {count}
                </span>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-slate-400">{TEST_CASES.length} test cases covering all flow paths, edge cases, and error scenarios.</p>
      </div>

      <div className="space-y-2">
        {TEST_CASES.map((tc) => {
          const isExpanded = expandedId === tc.id;
          const pc = PRIORITY_COLORS[tc.priority];
          return (
            <div
              key={tc.id}
              className="rounded-lg border overflow-hidden"
              style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : tc.id)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <span className="text-[10px] font-mono font-bold text-slate-500 w-14 shrink-0">{tc.id}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: pc.bg, color: pc.color }}>
                  {tc.priority}
                </span>
                <span className="text-sm text-slate-200 text-left flex-1">{tc.scenario}</span>
                <Icon name={isExpanded ? 'expand_less' : 'expand_more'} size={16} className="text-slate-500" />
              </button>
              {isExpanded && (
                <div className="px-4 pb-3 space-y-3 border-t" style={{ borderColor: 'var(--color-border-default)' }}>
                  <div className="pt-3">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Steps</span>
                    <ol className="mt-1.5 space-y-1">
                      {tc.steps.map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-[10px] font-bold text-slate-600 w-4 shrink-0 mt-0.5">{i + 1}.</span>
                          <span className="text-xs text-slate-400">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Expected Result</span>
                    <p className="text-xs text-emerald-400 mt-1">{tc.expected}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
