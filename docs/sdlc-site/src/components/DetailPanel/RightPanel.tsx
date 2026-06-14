import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useFlowStore } from '../../store/useFlowStore';
import { StatusCard } from './StatusCard';
import { TriggerEventCard } from './TriggerEventCard';
import { RequestPayloadPreview } from './RequestPayloadPreview';
import { HandlerLogicSnippet } from './HandlerLogicSnippet';
import { Icon } from '../shared/Icon';

export function RightPanel() {
  const getCurrentStep = useFlowStore((s) => s.getCurrentStep);
  const activeStepIndex = useFlowStore((s) => s.activeStepIndex);
  const selectedPath = useFlowStore((s) => s.selectedPath);
  const navigate = useNavigate();
  const step = getCurrentStep();

  return (
    <aside
      className="w-80 flex-none flex flex-col border-l z-10"
      style={{
        borderColor: 'var(--color-border-default)',
        background: 'var(--color-bg-primary)',
      }}
    >
      <div className="p-5 border-b flex justify-between items-center"
        style={{ borderColor: 'var(--color-border-default)' }}
      >
        <h3 className="text-slate-100 text-sm font-bold font-display uppercase tracking-wider">
          Step Details
        </h3>
        <Icon name="close" size={20} className="text-slate-500 cursor-pointer hover:text-white" />
      </div>

      {!step ? (
        <div className="flex-1 flex items-center justify-center p-5">
          <p className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
            Select a path to view step details
          </p>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto p-5 space-y-6"
          >
            <StatusCard step={step} stepIndex={activeStepIndex} />
            <TriggerEventCard step={step} />
            <RequestPayloadPreview step={step} />
            <HandlerLogicSnippet step={step} />
          </motion.div>
        </AnimatePresence>
      )}

      {step && (
        <div className="p-4 border-t flex flex-col gap-2" style={{ borderColor: 'var(--color-border-default)' }}>
          <button
            onClick={() => navigate(`/path/${selectedPath.id}`)}
            className="w-full py-2.5 rounded-lg text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            style={{
              background: 'var(--color-primary)',
              boxShadow: '0 4px 15px rgba(97,22,218,0.2)',
            }}
          >
            <Icon name="open_in_new" size={18} />
            View Full Path Details
          </button>
          <button
            onClick={() => console.log('Debug step:', step)}
            className="w-full py-2.5 rounded-lg text-slate-300 text-sm font-medium border transition-colors flex items-center justify-center gap-2"
            style={{
              background: 'rgba(255,255,255,0.05)',
              borderColor: 'rgba(255,255,255,0.05)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <Icon name="bug_report" size={18} />
            Debug Step
          </button>
        </div>
      )}
    </aside>
  );
}
