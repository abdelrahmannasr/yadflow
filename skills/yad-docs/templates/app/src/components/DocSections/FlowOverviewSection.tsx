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

export function FlowOverviewSection() {
  const grouped = PATHS.reduce<Record<string, typeof PATHS>>((acc, path) => {
    const cat = path.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(path);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <p className="text-sm text-slate-400 leading-relaxed">
          The booking status sync feature covers <strong className="text-white">{PATHS.length} distinct flow paths</strong> organized
          by category. Each path represents a complete lifecycle scenario from trip creation through terminal state.
        </p>
      </div>

      {Object.entries(grouped).map(([category, paths]) => {
        const color = CATEGORY_COLORS[category] || '#64748b';
        return (
          <div key={category}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: color }}
              />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>
                {category.replace(/-/g, ' ')} ({paths.length})
              </span>
            </div>
            <div className="space-y-1.5">
              {paths.map((path) => (
                <div
                  key={path.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border hover:bg-white/5 transition-colors"
                  style={{
                    background: 'rgba(20,17,24,0.3)',
                    borderColor: 'var(--color-border-default)',
                  }}
                >
                  <Icon name={path.icon} size={18} className={`text-[${path.color}]`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-200 font-medium">{path.label}</span>
                    <p className="text-xs text-slate-500 truncate">{path.description}</p>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {path.steps.length} steps
                    {path.subPaths ? ` + ${path.subPaths.length} sub-paths` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
