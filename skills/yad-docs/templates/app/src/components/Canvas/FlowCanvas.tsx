import React, { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import { COMPONENTS } from '../../data/components';
import { useFlowStore } from '../../store/useFlowStore';
import { useAnimationQueue } from '../../hooks/useAnimationQueue';
import { SystemComponent } from './SystemComponent';
import { ConnectionLine } from './ConnectionLine';
import { AnimatedMessage } from './AnimatedMessage';
import { Icon } from '../shared/Icon';

const ALL_CONNECTIONS = [
  ['rider-app', 'backend-api'],
  ['driver-app', 'backend-api'],
  ['backend-api', 'bullmq'],
  ['backend-api', 'database'],
  ['backend-api', 'pubsub'],
  ['backend-api', 'dac'],
  ['backend-api', 'ops-dashboard'],
  ['ops-dashboard', 'backend-api'],
];

export const FlowCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const getCurrentStep = useFlowStore((s) => s.getCurrentStep);
  const speed = useFlowStore((s) => s.speed);
  const zoomLevel = useFlowStore((s) => s.zoomLevel);
  const zoomIn = useFlowStore((s) => s.zoomIn);
  const zoomOut = useFlowStore((s) => s.zoomOut);
  const resetZoom = useFlowStore((s) => s.resetZoom);
  const selectedPath = useFlowStore((s) => s.selectedPath);
  const currentStep = getCurrentStep();
  const { completedTargets, animKey } = useAnimationQueue();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDims({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const activeComponents = useMemo(
    () => new Set(currentStep?.activeComponents || []),
    [currentStep]
  );

  const activeConnections = useMemo(() => {
    if (!currentStep) return new Set<string>();
    const conns = new Set<string>();
    for (const msg of currentStep.messages) {
      conns.add(`${msg.from}-${msg.to}`);
      conns.add(`${msg.to}-${msg.from}`);
    }
    return conns;
  }, [currentStep]);

  const isConnectionActive = useCallback(
    (from: string, to: string) => {
      return (
        activeConnections.has(`${from}-${to}`) ||
        activeConnections.has(`${to}-${from}`)
      );
    },
    [activeConnections]
  );

  const messages = currentStep?.messages || [];

  // Optional loop-back arc, swept below the canvas to read as "the pipeline repeats".
  // Rendered only when both endpoint nodes exist (e.g. the SDLC-overview's
  // trust-log → product-hub cycle); a no-op for diagrams without them.
  const loopBack = useMemo(() => {
    if (dims.width === 0) return null;
    const a = COMPONENTS.find((c) => c.id === 'trust-log');
    const b = COMPONENTS.find((c) => c.id === 'product-hub');
    if (!a || !b) return null;
    const x1 = (a.position.x / 100) * dims.width;
    const y1 = (a.position.y / 100) * dims.height;
    const x2 = (b.position.x / 100) * dims.width;
    const y2 = (b.position.y / 100) * dims.height;
    const yb = dims.height * 0.985;
    return {
      d: `M ${x1} ${y1} C ${x1} ${yb}, ${x2} ${yb}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: dims.height * 0.92,
    };
  }, [dims]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {/* Canvas Header Overlay */}
      <div className="absolute top-4 left-4 right-4 z-30 flex justify-between items-start pointer-events-none">
        <div className="pointer-events-auto rounded-lg p-3 border shadow-xl"
          style={{
            background: 'rgba(30,26,37,0.8)',
            backdropFilter: 'blur(12px)',
            borderColor: 'rgba(255,255,255,0.05)',
          }}
        >
          <h1 className="text-white text-xl font-bold font-display">
            {selectedPath.label}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-slate-300 uppercase tracking-wide">Live Simulation</span>
          </div>
        </div>
        <div className="pointer-events-auto flex gap-2">
          <button
            onClick={zoomIn}
            className="h-10 w-10 flex items-center justify-center rounded-lg text-white border transition-colors"
            style={{
              background: 'rgba(30,26,37,0.8)',
              borderColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Icon name="zoom_in" size={20} />
          </button>
          <button
            onClick={zoomOut}
            className="h-10 w-10 flex items-center justify-center rounded-lg text-white border transition-colors"
            style={{
              background: 'rgba(30,26,37,0.8)',
              borderColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Icon name="zoom_out" size={20} />
          </button>
          <button
            onClick={resetZoom}
            className="h-10 w-10 flex items-center justify-center rounded-lg text-white border transition-colors"
            style={{
              background: 'rgba(30,26,37,0.8)',
              borderColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Icon name="center_focus_strong" size={20} />
          </button>
        </div>
      </div>

      {/* Zoomable content */}
      <div
        className="absolute inset-0"
        style={{
          transform: `scale(${zoomLevel})`,
          transformOrigin: 'center center',
          transition: 'transform 0.2s ease',
        }}
      >
        {/* SVG layer for connection lines */}
        {dims.width > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id="gradientPath" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6116da" stopOpacity={1} />
                <stop offset="100%" stopColor="#ff6490" stopOpacity={1} />
              </linearGradient>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#ff6490" />
              </marker>
            </defs>
            {ALL_CONNECTIONS.map(([from, to]) => (
              <ConnectionLine
                key={`${from}-${to}`}
                from={from}
                to={to}
                isActive={isConnectionActive(from, to)}
                containerWidth={dims.width}
                containerHeight={dims.height}
              />
            ))}

            {/* Loop-back: the pipeline repeats per epic */}
            {loopBack && (
              <g>
                <path
                  d={loopBack.d}
                  fill="none"
                  stroke="#ff6490"
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                  opacity={0.55}
                  markerEnd="url(#arrowhead)"
                />
                <text
                  x={loopBack.labelX}
                  y={loopBack.labelY}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={700}
                  letterSpacing={0.6}
                  fill="#ff8db0"
                  opacity={0.85}
                >
                  ↺ pipeline repeats per epic
                </text>
              </g>
            )}
          </svg>
        )}

        {/* Animated messages */}
        {dims.width > 0 &&
          messages.map((msg) => (
            <AnimatedMessage
              key={`${animKey}-${msg.id}`}
              from={msg.from}
              to={msg.to}
              label={msg.label}
              color={msg.color}
              delay={msg.delay}
              duration={msg.duration}
              speed={speed}
              containerWidth={dims.width}
              containerHeight={dims.height}
            />
          ))}

        {/* System component nodes */}
        {COMPONENTS.map((comp) => (
          <SystemComponent
            key={comp.id}
            component={comp}
            isActive={activeComponents.has(comp.id)}
            isReceiving={completedTargets.has(comp.id)}
          />
        ))}
      </div>

      {/* Current status badge */}
      {currentStep && (
        <div
          className="absolute left-4 bottom-4 z-30 rounded-lg border px-3 py-2"
          style={{
            background: 'rgba(30,26,37,0.85)',
            backdropFilter: 'blur(8px)',
            borderColor: 'var(--color-border-default)',
          }}
        >
          <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Status
          </div>
          <div className="text-sm font-bold" style={{ color: 'var(--color-accent)' }}>
            {currentStep.status}
          </div>
          <div className="mt-0.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
            {currentStep.bookingStatus}
          </div>
        </div>
      )}
    </div>
  );
};
