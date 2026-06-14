import { motion, AnimatePresence } from 'framer-motion';
import { useFlowStore } from '../../store/useFlowStore';
import { Icon } from '../shared/Icon';
import { MESSAGE_COLORS } from '../../data/types';
import { MESSAGE_TYPE_ICONS } from '../../utils/iconMap';
import { StakeholderToggle } from './StakeholderToggle';
import { DecisionTreeView } from './DecisionTreeView';
import { RiderUIStatesTable } from './RiderUIStatesTable';
import { DriverUIStatesTable } from './DriverUIStatesTable';
import { BullMQJobsList } from './BullMQJobsList';
import { FeatureFlagMatrix } from './FeatureFlagMatrix';
import { DeeplinkActionsChips } from './DeeplinkActionsChips';
import { TroubleshootingSection } from './TroubleshootingSection';

// Who advances each step type — the locked vs earnable rule.
const CANCELABILITY_RULES = [
  { status: 'Setup & connectors', canCancel: 'Not gated', color: '#b7950b', dotColor: '#b7950b' },
  { status: 'Front states (epic … stories)', canCancel: 'Human (locked)', color: '#566573', dotColor: '#566573' },
  { status: 'Back steps (spec … checks)', canCancel: 'Earnable', color: '#1e8449', dotColor: '#1e8449' },
  { status: 'Engineer review & merge', canCancel: 'Human (locked)', color: '#ca6f1e', dotColor: '#ca6f1e' },
];

const MESSAGE_LEGEND = [
  { type: 'write', label: 'Write', description: 'An artifact written to the ledger' },
  { type: 'gate', label: 'Gate', description: 'A human review / approval act' },
  { type: 'event', label: 'Event', description: 'A state transition' },
  { type: 'job', label: 'Job', description: 'An automated (CI / orchestrator) run' },
  { type: 'notification', label: 'Notification', description: 'A signal routed to reviewers / owners' },
  { type: 'cleanup', label: 'Halt', description: 'A revoke / halt (e.g. contract touch)' },
] as const;

export function RulesLegendPanel() {
  const isOpen = useFlowStore((s) => s.isReferencePanelOpen);
  const toggle = useFlowStore((s) => s.toggleReferencePanel);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={toggle}
          />
          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-[640px] z-50 flex flex-col overflow-hidden rounded-l-xl shadow-2xl border-l"
            style={{
              background: 'var(--color-surface-dark)',
              borderColor: 'var(--color-border-default)',
            }}
          >
            {/* Header */}
            <div className="px-6 py-5 border-b flex items-center justify-between sticky top-0 z-10"
              style={{
                borderColor: 'var(--color-border-default)',
                background: 'var(--color-surface-dark)',
              }}
            >
              <div>
                <h2 className="text-slate-100 text-xl font-bold font-display leading-tight">System Reference</h2>
                <p className="text-slate-400 text-sm mt-1">Rules and visual guides for the yadflow pipeline</p>
              </div>
              <button
                onClick={toggle}
                className="text-slate-400 hover:text-white transition-colors p-2 rounded-full hover:bg-white/5"
              >
                <Icon name="close" size={24} />
              </button>
            </div>

            {/* Stakeholder Toggle */}
            <StakeholderToggle />

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Who Advances Each Step */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Icon name="gavel" size={20} className="text-[var(--color-primary)]" />
                  <h3 className="text-slate-100 text-lg font-bold font-display">Who Advances Each Step</h3>
                </div>
                <div className="rounded-xl border overflow-hidden"
                  style={{
                    borderColor: 'var(--color-border-default)',
                    background: 'rgba(20,17,24,0.5)',
                  }}
                >
                  <table className="w-full text-left text-sm">
                    <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <tr>
                        <th className="px-4 py-3 font-semibold text-slate-300 w-1/2">Step Group</th>
                        <th className="px-4 py-3 font-semibold text-slate-300 w-1/2 text-right">Who Advances?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CANCELABILITY_RULES.map((rule) => (
                        <tr key={rule.status} className="border-t hover:bg-white/5 transition-colors"
                          style={{ borderColor: 'var(--color-border-default)' }}
                        >
                          <td className="px-4 py-3 text-slate-400 font-medium">
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: rule.dotColor }} />
                              {rule.status}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border"
                              style={{
                                background: `${rule.color}15`,
                                color: rule.color,
                                borderColor: `${rule.color}30`,
                              }}
                            >
                              {rule.canCancel}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Message Legend */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Icon name="palette" size={20} className="text-[var(--color-primary)]" />
                  <h3 className="text-slate-100 text-lg font-bold font-display">Message Legend</h3>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {MESSAGE_LEGEND.map(({ type, label, description }) => {
                    const color = MESSAGE_COLORS[type];
                    const iconName = MESSAGE_TYPE_ICONS[type] || 'circle';
                    return (
                      <div key={type}
                        className="flex items-center justify-between p-3 rounded-lg border group hover:border-[var(--color-primary)] transition-colors"
                        style={{
                          background: 'rgba(20,17,24,0.5)',
                          borderColor: 'var(--color-border-default)',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-10 h-10 rounded-lg"
                            style={{ background: `${color}20`, color: color }}
                          >
                            <Icon name={iconName} size={20} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-200">{label}</p>
                            <p className="text-xs text-slate-500">{description}</p>
                          </div>
                        </div>
                        <div className="h-6 w-24 rounded-full flex items-center justify-center"
                          style={{ background: `${color}20`, border: `1px solid ${color}30` }}
                        >
                          <div className="w-12 h-1.5 rounded-full opacity-60" style={{ background: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Decision Tree */}
              <DecisionTreeView />

              {/* Assistance Dial */}
              <RiderUIStatesTable />

              {/* Automation Dial */}
              <DriverUIStatesTable />

              {/* Check Gates */}
              <BullMQJobsList />

              {/* Feature Flags */}
              <FeatureFlagMatrix />

              {/* yad CLI */}
              <DeeplinkActionsChips />

              {/* Troubleshooting */}
              <TroubleshootingSection />
            </div>

            {/* Footer */}
            <div className="p-4 border-t flex items-center justify-center gap-2"
              style={{
                borderColor: 'var(--color-border-default)',
                background: 'var(--color-surface-dark)',
              }}
            >
              <button className="flex-1 py-3 px-4 rounded-lg text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
                style={{ background: 'var(--color-primary)' }}
              >
                <Icon name="download" size={18} />
                Export Rules PDF
              </button>
              <button className="p-3 rounded-lg text-slate-300 transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                <Icon name="settings" size={20} />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
