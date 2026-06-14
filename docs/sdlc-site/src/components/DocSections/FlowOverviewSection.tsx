import { Icon } from '../shared/Icon';
import { PATHS } from '../../data/paths';

const CATEGORY_COLORS: Record<string, string> = {
  setup: '#b7950b',
  front: '#2471a3',
  build: '#1e8449',
  automate: '#ca6f1e',
};

const CATEGORY_LABELS: Record<string, string> = {
  setup: 'Setup & connect',
  front: 'Front half (human-gated)',
  build: 'Build half (per story)',
  automate: 'Automation (earned)',
};

export function FlowOverviewSection() {
  const grouped = PATHS.reduce<Record<string, typeof PATHS>>((acc, path) => {
    const cat = path.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(path);
    return acc;
  }, {});

  const totalSteps = PATHS.reduce((n, p) => n + p.steps.length, 0);

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <p className="text-sm text-slate-400 leading-relaxed">
          The whole lifecycle, from an empty project to shipped code, is{' '}
          <strong className="text-white">{PATHS.length} phases</strong> and{' '}
          <strong className="text-white">{totalSteps} steps</strong>. Setup is one-time; the front half is
          human-gated and runs once per epic; the build half runs once per story per code repo; automation is
          opt-in and earned. Each author step writes its artifact and stops at the reusable team review gate.
        </p>
      </div>

      {['setup', 'front', 'build', 'automate'].map((category) => {
        const paths = grouped[category] || [];
        const color = CATEGORY_COLORS[category] || '#64748b';
        return (
          <div key={category}>
            <div className="flex items-center gap-2 mb-2">
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>
                {CATEGORY_LABELS[category]} ({paths.length})
              </span>
            </div>
            <div className="space-y-1.5">
              {paths.map((path) => (
                <div
                  key={path.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border hover:bg-white/5 transition-colors"
                  style={{ background: 'rgba(20,17,24,0.3)', borderColor: 'var(--color-border-default)' }}
                >
                  <span style={{ color: path.color }} className="flex">
                    <Icon name={path.icon} size={18} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-200 font-medium">{path.label}</span>
                    <p className="text-xs text-slate-500 truncate">{path.description}</p>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">
                    {path.steps.length} steps
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
