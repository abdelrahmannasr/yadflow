import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from '../shared/Icon';
import { useStakeholderFilter } from '../../hooks/useStakeholderFilter';
import { ERROR_CODES } from '../../data/referenceData';

const SEVERITY_COLORS = {
  info: { text: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.2)' },
  warn: { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.2)' },
  critical: { text: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.2)' },
};

export function TroubleshootingSection() {
  const errors = useStakeholderFilter(ERROR_CODES);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  if (errors.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="warning" size={20} className="text-amber-400" />
        <h3 className="text-slate-100 text-lg font-bold font-display">Troubleshooting & Error Codes</h3>
      </div>
      <div className="space-y-2">
        {errors.map((error) => {
          const isExpanded = expandedCode === error.code;
          const colors = SEVERITY_COLORS[error.severity];

          return (
            <div
              key={error.code}
              className="rounded-lg border overflow-hidden transition-colors"
              style={{
                borderColor: isExpanded ? colors.border : 'var(--color-border-default)',
                background: 'rgba(20,17,24,0.5)',
              }}
            >
              <button
                onClick={() => setExpandedCode(isExpanded ? null : error.code)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="text-xs font-mono font-bold"
                    style={{ color: colors.text }}
                  >
                    {error.code}
                  </span>
                  {error.httpStatus && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
                    >
                      {error.httpStatus}
                    </span>
                  )}
                </div>
                <Icon
                  name={isExpanded ? 'expand_less' : 'expand_more'}
                  size={18}
                  className="text-slate-500"
                />
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
                    <div className="px-4 pb-3 space-y-2 border-t" style={{ borderColor: 'var(--color-border-default)' }}>
                      <div className="pt-3">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Cause</span>
                        <p className="text-xs text-slate-300 mt-1">{error.cause}</p>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Resolution</span>
                        <p className="text-xs text-slate-300 mt-1">{error.resolution}</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
