import React, { useMemo } from 'react';
import { COMPONENTS } from '../../data/components';

interface ConnectionLineProps {
  from: string;
  to: string;
  isActive: boolean;
  containerWidth: number;
  containerHeight: number;
}

let gradientCounter = 0;

export const ConnectionLine: React.FC<ConnectionLineProps> = React.memo(
  ({ from, to, isActive, containerWidth, containerHeight }) => {
    const gradientId = useMemo(() => `gradient-${from}-${to}-${++gradientCounter}`, [from, to]);

    const path = useMemo(() => {
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
      const curveFactor = Math.min(dx, dy) * 0.3;
      const midY = (y1 + y2) / 2 - curveFactor;

      return `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;
    }, [from, to, containerWidth, containerHeight]);

    if (!path) return null;

    if (isActive) {
      return (
        <g>
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#6116da" stopOpacity="1" />
              <stop offset="100%" stopColor="#ff6490" stopOpacity="1" />
            </linearGradient>
          </defs>
          {/* Background dashed path */}
          <path
            d={path}
            fill="none"
            stroke="var(--color-surface-highlight)"
            strokeWidth={1}
            strokeDasharray="5,5"
            opacity={0.5}
          />
          {/* Active gradient path */}
          <path
            d={path}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={2}
            opacity={0.7}
            style={{ transition: 'all 0.3s ease' }}
          >
            <animate
              attributeName="stroke-dasharray"
              from="0, 1000"
              to="1000, 0"
              dur="2s"
              repeatCount="indefinite"
            />
          </path>
        </g>
      );
    }

    return (
      <path
        d={path}
        fill="none"
        stroke="var(--color-surface-highlight)"
        strokeWidth={0.8}
        strokeDasharray="4 4"
        opacity={0.3}
        style={{ transition: 'all 0.3s ease' }}
      />
    );
  }
);
