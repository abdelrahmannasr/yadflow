import { useState } from 'react';
import { Icon } from '../shared/Icon';
import { PATHS } from '../../data/paths';

const CATEGORY_COLORS: Record<string, string> = {
  success: '#22c55e',
  'rider-cancel': '#ef4444',
  'driver-cancel': '#f97316',
  timeout: '#eab308',
  ops: '#8b5cf6',
  'active-cancel': '#ec4899',
};

export function FlowPathsChecklistSection() {
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const total = PATHS.length;
  const done = checked.size;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-slate-200">Verification Progress</span>
          <span className="text-sm font-bold" style={{ color: pct === 100 ? '#22c55e' : '#f59e0b' }}>
            {done}/{total} ({pct}%)
          </span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: pct === 100 ? '#22c55e' : 'var(--color-primary)',
            }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        {PATHS.map((path) => {
          const isChecked = checked.has(path.id);
          const catColor = CATEGORY_COLORS[path.category] || '#64748b';
          return (
            <button
              key={path.id}
              onClick={() => toggle(path.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all"
              style={{
                background: isChecked ? 'rgba(34,197,94,0.05)' : 'rgba(20,17,24,0.3)',
                borderColor: isChecked ? 'rgba(34,197,94,0.2)' : 'var(--color-border-default)',
              }}
            >
              <Icon
                name={isChecked ? 'check_box' : 'check_box_outline_blank'}
                size={20}
                className={isChecked ? 'text-emerald-400' : 'text-slate-600'}
              />
              <Icon name={path.icon} size={18} className="text-slate-400" />
              <div className="flex-1 min-w-0">
                <span
                  className="text-sm font-medium"
                  style={{ color: isChecked ? '#94a3b8' : '#e2e8f0', textDecoration: isChecked ? 'line-through' : 'none' }}
                >
                  Path {path.id}: {path.label}
                </span>
              </div>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                style={{ background: `${catColor}15`, color: catColor }}
              >
                {path.category}
              </span>
              <span className="text-[10px] text-slate-500 font-mono shrink-0">
                {path.steps.length}s{path.subPaths ? `+${path.subPaths.length}sp` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
