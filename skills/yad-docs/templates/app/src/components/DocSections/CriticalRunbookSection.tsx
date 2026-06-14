import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from '../shared/Icon';

interface Incident {
  title: string;
  severity: 'P1' | 'P2' | 'P3';
  symptoms: string[];
  diagnosis: string[];
  resolution: string[];
  escalation: string;
}

const SEVERITY_COLORS = {
  P1: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' },
  P2: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' },
  P3: { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.2)' },
};

const INCIDENTS: Incident[] = [
  {
    title: 'Optimistic Lock Failures Spike',
    severity: 'P2',
    symptoms: [
      'High rate of modifiedCount: 0 in logs',
      'Booking statuses appear stuck or outdated',
      'Users report stale booking UI',
    ],
    diagnosis: [
      'Check for concurrent request patterns (multiple webhooks firing simultaneously)',
      'Verify MongoDB connection pool is not exhausted',
      'Check if any deployment introduced a new middleware that reads/writes booking_status',
    ],
    resolution: [
      'The system is designed to skip silently on lock failures — this is safe by design',
      'If persistent: check for infinite retry loops in upstream services',
      'Monitor BullMQ job queue for backed-up jobs that might be causing contention',
    ],
    escalation: 'Backend team lead → Staff engineer if rate exceeds 5% of requests',
  },
  {
    title: 'BullMQ Jobs Stuck / Not Processing',
    severity: 'P1',
    symptoms: [
      'Riders not receiving confirmation notifications',
      'Timeouts not firing — expired bookings remain active',
      'BullMQ dashboard shows jobs in "waiting" state indefinitely',
    ],
    diagnosis: [
      'Check Redis connectivity (BullMQ depends on Redis)',
      'Verify worker processes are running (pm2 list or k8s pod status)',
      'Check ENABLE_BOOKING_JOBS flag is true in the environment',
    ],
    resolution: [
      'Restart BullMQ worker pods/processes',
      'If Redis is down: restore from backup, jobs will auto-retry on reconnect',
      'For stuck individual jobs: use BullMQ admin to manually remove and reschedule',
    ],
    escalation: 'Immediate: on-call backend engineer → infrastructure team if Redis related',
  },
  {
    title: 'DAC Card Orphans',
    severity: 'P3',
    symptoms: [
      'Driver app shows stale action cards for cancelled/completed trips',
      'DAC delete Pub/Sub messages failing silently',
    ],
    diagnosis: [
      'Check GCP Pub/Sub topic health and subscription backlog',
      'Verify PUB_SUB_DRIVER_ACTIONS_TOPIC environment variable',
      'Check DAC service logs for processing errors',
    ],
    resolution: [
      'DAC operations are fire-and-forget — orphans resolve when driver refreshes app',
      'For bulk cleanup: run a script that queries terminal-status trips and publishes delete messages',
      'Long-term: add a TTL-based auto-cleanup in DAC service',
    ],
    escalation: 'Driver platform team if affecting > 100 drivers',
  },
  {
    title: 'Notification Delivery Failures',
    severity: 'P2',
    symptoms: [
      'Riders/drivers not receiving push notifications',
      'sendBookingNotificationWithConfig errors in logs',
      'FCM/APNS error codes in notification service logs',
    ],
    diagnosis: [
      'Check FCM/APNS service status',
      'Verify device tokens are valid and not expired',
      'Check notification service rate limits',
    ],
    resolution: [
      'Notifications are fire-and-forget — core booking flow continues regardless',
      'For critical notifications: trigger manual re-send through ops dashboard',
      'If FCM key expired: rotate in GCP console and redeploy',
    ],
    escalation: 'Notifications team → Mobile platform team if device token issues',
  },
];

export function CriticalRunbookSection() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {INCIDENTS.map((incident, i) => {
        const isExpanded = expandedIndex === i;
        const sc = SEVERITY_COLORS[incident.severity];
        return (
          <div
            key={i}
            className="rounded-xl border overflow-hidden transition-colors"
            style={{
              borderColor: isExpanded ? sc.border : 'var(--color-border-default)',
              background: 'rgba(20,17,24,0.5)',
            }}
          >
            <button
              onClick={() => setExpandedIndex(isExpanded ? null : i)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
            >
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}
              >
                {incident.severity}
              </span>
              <span className="text-sm text-slate-200 font-medium text-left flex-1">{incident.title}</span>
              <Icon name={isExpanded ? 'expand_less' : 'expand_more'} size={18} className="text-slate-500" />
            </button>
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: 'var(--color-border-default)' }}>
                    {[
                      { title: 'Symptoms', items: incident.symptoms, icon: 'warning', color: '#fbbf24' },
                      { title: 'Diagnosis', items: incident.diagnosis, icon: 'search', color: '#60a5fa' },
                      { title: 'Resolution', items: incident.resolution, icon: 'build', color: '#22c55e' },
                    ].map((section) => (
                      <div key={section.title} className="pt-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Icon name={section.icon} size={14} className={`text-[${section.color}]`} />
                          <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: section.color }}>
                            {section.title}
                          </span>
                        </div>
                        <ul className="space-y-1.5">
                          {section.items.map((item, j) => (
                            <li key={j} className="flex items-start gap-2">
                              <span className="text-slate-600 mt-1">-</span>
                              <span className="text-xs text-slate-400">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <div className="pt-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Escalation: </span>
                      <span className="text-xs text-slate-400">{incident.escalation}</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
