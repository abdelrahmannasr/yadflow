import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { COMPONENTS } from '../../data/components';

interface AnimatedMessageProps {
  from: string;
  to: string;
  label: string;
  color: string;
  delay: number;
  duration: number;
  speed: number;
  containerWidth: number;
  containerHeight: number;
}

export const AnimatedMessage: React.FC<AnimatedMessageProps> = React.memo(
  ({ from, to, label, color, delay, duration, speed, containerWidth, containerHeight }) => {
    const coords = useMemo(() => {
      const fromComp = COMPONENTS.find((c) => c.id === from);
      const toComp = COMPONENTS.find((c) => c.id === to);
      if (!fromComp || !toComp) return null;

      const x1 = (fromComp.position.x / 100) * containerWidth;
      const y1 = (fromComp.position.y / 100) * containerHeight;
      const x2 = (toComp.position.x / 100) * containerWidth;
      const y2 = (toComp.position.y / 100) * containerHeight;

      const midX = (x1 + x2) / 2;
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      const curveFactor = Math.min(dx, dy) * 0.25;
      const midY = (y1 + y2) / 2 - curveFactor;

      return { x1, y1, x2, y2, midX, midY };
    }, [from, to, containerWidth, containerHeight]);

    if (!coords) return null;

    const { x1, y1, x2, y2, midX, midY } = coords;
    const animDelay = delay / speed / 1000;
    const animDuration = duration / speed / 1000;
    const pathD = `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;

    return (
      <>
        {/* Trail line */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ zIndex: 15 }}
        >
          <motion.path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: [0, 0.6, 0.3] }}
            transition={{
              duration: animDuration,
              delay: animDelay,
              ease: 'easeInOut',
            }}
          />
        </svg>

        {/* Floating message bubble */}
        <motion.div
          className="pointer-events-none absolute z-20 flex items-center gap-1 rounded-full px-3 py-1.5"
          style={{
            backgroundColor: `${color}ee`,
            boxShadow: `0 0 20px ${color}60, 0 2px 12px rgba(0,0,0,0.4)`,
            whiteSpace: 'nowrap',
            left: 0,
            top: 0,
            translateX: '-50%',
            translateY: '-50%',
            border: '1px solid rgba(255,255,255,0.2)',
          }}
          initial={{ x: x1, y: y1, opacity: 0, scale: 0.5 }}
          animate={{
            x: [x1, midX, x2],
            y: [y1, midY, y2],
            opacity: [0, 1, 1, 0.8],
            scale: [0.5, 1, 1, 0.9],
          }}
          transition={{
            duration: animDuration,
            delay: animDelay,
            ease: 'easeInOut',
          }}
        >
          <span className="text-[9px] font-bold leading-none text-white drop-shadow-sm">
            {label}
          </span>
        </motion.div>
      </>
    );
  }
);
