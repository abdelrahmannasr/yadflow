import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SystemComponent as SystemComponentType } from '../../data/types';
import { Icon } from '../shared/Icon';
import { COMPONENT_ICONS, COMPONENT_ROLES } from '../../utils/iconMap';

interface SystemComponentProps {
  component: SystemComponentType;
  isActive: boolean;
  isReceiving: boolean;
  onClick?: () => void;
}

export const SystemComponent: React.FC<SystemComponentProps> = React.memo(
  ({ component, isActive, isReceiving, onClick }) => {
    const [hovered, setHovered] = useState(false);
    const iconName = COMPONENT_ICONS[component.id] || 'circle';
    const role = COMPONENT_ROLES[component.id] || 'Service';

    const glowStyle = useMemo(() => {
      if (isReceiving) {
        return {
          boxShadow: `0 0 30px ${component.color}40, 0 0 60px ${component.color}20`,
          borderColor: `${component.color}80`,
        };
      }
      if (isActive) {
        return {
          boxShadow: `0 0 20px ${component.color}30, 0 0 40px ${component.color}15`,
          borderColor: `${component.color}50`,
        };
      }
      return {
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        borderColor: 'rgba(255,255,255,0.05)',
      };
    }, [isActive, isReceiving, component.color]);

    return (
      <>
        <motion.button
          onClick={onClick}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="absolute z-10 flex cursor-pointer flex-col items-center gap-2 rounded-2xl p-4 transition-colors glass-panel group"
          style={{
            left: `${component.position.x}%`,
            top: `${component.position.y}%`,
            transform: 'translate(-50%, -50%)',
            background: isActive
              ? `linear-gradient(135deg, ${component.color}12, ${component.color}06)`
              : 'rgba(47, 41, 56, 0.4)',
            backdropFilter: 'blur(12px)',
            ...glowStyle,
            minWidth: '116px',
            minHeight: '120px',
          }}
          animate={
            isReceiving
              ? { scale: [1, 1.05, 1] }
              : { scale: 1 }
          }
          transition={
            isReceiving
              ? { duration: 0.6, ease: 'easeInOut' }
              : { duration: 0.3 }
          }
          whileHover={{ scale: 1.05 }}
          aria-label={`${component.label}: ${component.description}`}
          tabIndex={0}
        >
          {/* Role tag */}
          <div className="absolute -top-3 px-3 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold"
            style={{
              background: 'var(--color-surface-dark)',
              border: '1px solid var(--color-surface-highlight)',
              color: 'var(--color-text-muted)',
            }}
          >
            {role}
          </div>

          {/* Icon with gradient background */}
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-white shadow-lg mb-1"
            style={{
              background: `linear-gradient(135deg, ${component.color}, ${component.color}99)`,
            }}
          >
            <Icon name={iconName} size={28} className="text-white" />
          </div>

          {/* Label */}
          <h3 className="text-white font-bold font-display text-sm text-center break-words w-full">{component.label}</h3>

          {/* Status */}
          <div className="flex items-center gap-1.5">
            <motion.div
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: isActive ? '#22c55e' : isReceiving ? component.color : 'var(--color-text-muted)',
              }}
              animate={
                isActive || isReceiving
                  ? { opacity: [0.7, 1, 0.7] }
                  : {}
              }
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span className="text-xs text-slate-300">
              {isReceiving ? 'Processing' : isActive ? 'Online' : 'Idle'}
            </span>
          </div>

          {/* Connection points */}
          <div className="absolute right-[-6px] top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-white"
            style={{ background: component.color, opacity: isActive ? 1 : 0.3 }}
          />
          <div className="absolute left-[-6px] top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-white"
            style={{ background: component.color, opacity: isActive ? 1 : 0.3 }}
          />
        </motion.button>

        {/* Tooltip */}
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-none absolute z-50 max-w-[220px] rounded-lg px-3 py-2 text-xs"
              style={{
                left: `${component.position.x}%`,
                top: `${component.position.y}%`,
                transform: 'translate(-50%, calc(-100% - 50px))',
                backgroundColor: 'var(--color-surface-dark)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-light)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div className="font-semibold font-display">{component.label}</div>
              <div className="mt-0.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                {component.description}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }
);
