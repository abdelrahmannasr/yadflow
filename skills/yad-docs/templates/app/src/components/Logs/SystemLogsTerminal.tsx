import { useEffect, useRef } from 'react';
import { useFlowStore } from '../../store/useFlowStore';
import { Icon } from '../shared/Icon';

const LEVEL_COLORS: Record<string, string> = {
  info: '#22c55e',
  warn: '#eab308',
  error: '#ef4444',
  debug: '#64748b',
};

function isHighlightEntry(message: string): boolean {
  const keywords = ['request', 'matching', 'confirmation', 'assigned', 'accepted'];
  const lower = message.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function exportLogs(logs: { timestamp: Date; level: string; source: string; message: string }[]) {
  const text = logs
    .map((l) => `[${l.timestamp.toLocaleTimeString('en-US', { hour12: false })}] [${l.level.toUpperCase()}] ${l.source}: ${l.message}`)
    .join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `system-logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function SystemLogsTerminal() {
  const logs = useFlowStore((s) => s.logs);
  const clearLogs = useFlowStore((s) => s.clearLogs);
  const toggleLogsPanel = useFlowStore((s) => s.toggleLogsPanel);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ background: 'var(--color-surface-darker, #0f0e13)' }}
    >
      {/* Header */}
      <div
        className="px-4 py-2 border-b flex justify-between items-center"
        style={{
          borderColor: 'var(--color-border-default)',
          background: 'var(--color-surface-dark)',
        }}
      >
        <div className="flex items-center gap-2">
          <Icon name="terminal" size={16} className="text-[var(--color-primary)]" />
          <h3 className="font-mono text-xs font-semibold text-slate-200">System Logs</h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => exportLogs(logs)}
            className="text-[10px] text-slate-400 hover:text-white transition-colors px-2 py-0.5 rounded flex items-center gap-1"
            style={{ background: 'rgba(255,255,255,0.05)' }}
          >
            <Icon name="download" size={12} />
            Export
          </button>
          <button
            onClick={clearLogs}
            className="text-[10px] text-slate-400 hover:text-white transition-colors px-2 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.05)' }}
          >
            Clear
          </button>
          {/* macOS window dots */}
          <div className="flex items-center gap-1.5 ml-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.5)' }} />
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(234,179,8,0.2)', border: '1px solid rgba(234,179,8,0.5)' }} />
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.5)' }} />
          </div>
          <button
            onClick={toggleLogsPanel}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 p-3 font-mono text-xs overflow-y-auto space-y-0.5 logs-scrollbar"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 animate-pulse">Waiting for events...</div>
        ) : (
          logs.map((log, index) => {
            const isLast = index === logs.length - 1;
            const isHighlight = isHighlightEntry(log.message);

            return (
              <div
                key={log.id}
                className={`flex gap-3 px-2 py-0.5 rounded transition-all ${isLast ? 'animate-pulse' : ''}`}
                style={{
                  color: LEVEL_COLORS[log.level] || '#64748b',
                  background: isHighlight ? 'rgba(97,22,218,0.08)' : 'transparent',
                  borderLeft: isHighlight ? '2px solid var(--color-primary)' : '2px solid transparent',
                  opacity: index < logs.length - 3 ? 0.7 : 1,
                }}
              >
                <span className="w-16 shrink-0 text-slate-600">
                  {log.timestamp.toLocaleTimeString('en-US', { hour12: false })}
                </span>
                <span style={{ color: LEVEL_COLORS[log.level] }}>{log.source}</span>
                <span className="text-slate-300">{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
