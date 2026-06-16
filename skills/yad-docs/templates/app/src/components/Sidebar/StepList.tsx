import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFlowStore } from '../../store/useFlowStore';
import type { ActorType } from '../../data/types';
import { Icon } from '../shared/Icon';
import { ACTOR_ICONS } from '../../utils/iconMap';

const ACTOR_COLORS: Record<ActorType, string> = {
  rider: '#fb2576',
  driver: '#6316db',
  ops: '#06b6d4',
  system: '#f59e0b',
};

export const StepList = () => {
  const {
    selectedPath,
    activeSubPathId,
    activeStepIndex,
    setActiveStep,
    selectSubPath,
    getCurrentSteps,
  } = useFlowStore();

  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const hasSubPaths = selectedPath.subPaths && selectedPath.subPaths.length > 0;
  const steps = getCurrentSteps();

  // Sync expanded state: auto-expand the active step, allow user to close it
  const isExpanded = (index: number) => {
    if (expandedIndex !== null) return expandedIndex === index;
    return index === activeStepIndex;
  };

  const handleStepClick = (index: number) => {
    setActiveStep(index);
    // Toggle: if already expanded, close it; otherwise expand it
    if (isExpanded(index)) {
      setExpandedIndex(-1); // -1 means "nothing expanded"
    } else {
      setExpandedIndex(index);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-slate-400 text-xs font-bold font-display uppercase tracking-wider">
          Sequence Timeline
        </h3>
        <span className="text-xs font-mono px-2 py-1 rounded"
          style={{ color: 'var(--color-text-secondary)', background: 'var(--color-surface-highlight)' }}
        >
          Path {selectedPath.id}
        </span>
      </div>

      {/* Sub-path selector */}
      {hasSubPaths && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedPath.subPaths!.map((sub) => (
            <button
              key={sub.id}
              onClick={() => selectSubPath(sub.id)}
              className="rounded-md px-2 py-1 text-[10px] font-semibold transition-colors"
              style={{
                background: activeSubPathId === sub.id ? `${selectedPath.color}25` : 'var(--color-surface-highlight)',
                color: activeSubPathId === sub.id ? selectedPath.color : 'var(--color-text-secondary)',
                border: `1px solid ${activeSubPathId === sub.id ? `${selectedPath.color}50` : 'var(--color-border-default)'}`,
              }}
            >
              {sub.id.toUpperCase()}: {sub.label}
            </button>
          ))}
        </div>
      )}

      {/* Timeline — uses absolute line to avoid overflow clipping */}
      <div className="relative" style={{ paddingLeft: '36px' }}>
        {/* Vertical timeline line */}
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: '15px',
            width: '2px',
            background: 'var(--color-surface-highlight)',
          }}
        />

        {steps.map((step, index) => {
          const isCurrent = index === activeStepIndex;
          const isCompleted = index < activeStepIndex;
          const expanded = isExpanded(index);
          const actorColor = ACTOR_COLORS[step.actor];
          const actorIcon = ACTOR_ICONS[step.actor] || 'person';

          return (
            <div key={step.id} className="relative pb-4">
              {/* Timeline dot — centered on the line at left:15px */}
              <div
                className="absolute"
                style={{
                  left: '-36px',
                  top: '4px',
                  width: '32px',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                {isCurrent ? (
                  <motion.div
                    className="h-7 w-7 rounded-full flex items-center justify-center"
                    style={{
                      background: 'var(--color-primary)',
                      boxShadow: '0 0 0 3px rgba(97,22,218,0.25)',
                    }}
                    animate={{ scale: [1, 1.08, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Icon name="sync" size={14} className="text-white" />
                  </motion.div>
                ) : isCompleted ? (
                  <div
                    className="h-5 w-5 rounded-full flex items-center justify-center"
                    style={{
                      background: 'var(--color-surface-highlight)',
                      border: '2px solid var(--color-border-light)',
                    }}
                  >
                    <Icon name="check" size={12} className="text-slate-500" />
                  </div>
                ) : (
                  <div
                    className="h-5 w-5 rounded-full flex items-center justify-center"
                    style={{
                      background: 'var(--color-bg-primary)',
                      border: '2px solid var(--color-surface-highlight)',
                    }}
                  >
                    <div className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-surface-highlight)' }} />
                  </div>
                )}
              </div>

              {/* Clickable step area */}
              <button
                onClick={() => handleStepClick(index)}
                className="text-left w-full block"
              >
                {/* Compact header — always visible */}
                <div className={`flex items-center gap-2 ${!isCurrent && !expanded ? (isCompleted ? 'opacity-60' : 'opacity-40') : ''} hover:opacity-100 transition-opacity`}>
                  <span className="text-xs font-bold uppercase" style={{ color: isCurrent ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                    Step {index + 1}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{
                      background: isCurrent ? 'var(--color-primary)' : 'var(--color-surface-highlight)',
                      color: isCurrent ? 'white' : isCompleted ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                    }}
                  >
                    {isCurrent ? 'Current' : isCompleted ? 'Completed' : 'Pending'}
                  </span>
                  {/* Expand/collapse indicator */}
                  <Icon
                    name={expanded ? 'expand_less' : 'expand_more'}
                    size={16}
                    className="text-slate-500 ml-auto"
                  />
                </div>
                <h4 className={`font-medium text-sm mt-1 ${isCurrent ? 'text-white font-bold' : 'text-slate-200'}`}>
                  {step.title}
                </h4>
                {!expanded && (
                  <div className="flex items-center gap-2 mt-1">
                    <Icon name={actorIcon} size={14} className="text-slate-400" />
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {step.actor}
                    </span>
                  </div>
                )}
              </button>

              {/* Expandable detail card */}
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div
                      className="flex flex-col gap-2 p-3 mt-2 rounded-lg border"
                      style={{
                        background: 'var(--color-surface-dark)',
                        borderColor: isCurrent ? 'rgba(97,22,218,0.3)' : 'var(--color-border-default)',
                      }}
                    >
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                        {step.description}
                      </p>
                      <div
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2"
                        style={{ borderTop: '1px solid var(--color-surface-highlight)' }}
                      >
                        <div className="flex items-center gap-1.5" style={{ color: actorColor }}>
                          <Icon name={actorIcon} size={16} />
                          <span className="text-xs font-medium">{step.actor}</span>
                        </div>
                        <Icon name="arrow_forward" size={12} className="text-slate-500" />
                        <span className="text-xs text-slate-400 font-medium break-all">{step.bookingStatus}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};
