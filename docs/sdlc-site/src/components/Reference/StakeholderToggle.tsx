import { useFlowStore } from '../../store/useFlowStore';
import type { StakeholderView } from '../../data/types';
import { Icon } from '../shared/Icon';

const VIEWS: { id: StakeholderView; label: string; icon: string }[] = [
  { id: 'analyst', label: 'Analyst', icon: 'search' },
  { id: 'pm', label: 'PM', icon: 'bar_chart' },
  { id: 'architect', label: 'Architect', icon: 'architecture' },
  { id: 'ux-designer', label: 'UX', icon: 'design_services' },
  { id: 'dev', label: 'Dev', icon: 'terminal' },
  { id: 'tester', label: 'Tester', icon: 'science' },
  { id: 'reviewer', label: 'Reviewer', icon: 'rate_review' },
  { id: 'engineer', label: 'Engineer', icon: 'engineering' },
  { id: 'maintainer', label: 'Maintainer', icon: 'admin_panel_settings' },
];

export function StakeholderToggle() {
  const view = useFlowStore((s) => s.stakeholderView);
  const setView = useFlowStore((s) => s.setStakeholderView);

  return (
    <div className="flex items-center gap-2 px-6 py-3 border-b" style={{ borderColor: 'var(--color-border-default)' }}>
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mr-1 shrink-0">View:</span>
      <div className="flex overflow-x-auto rounded-lg p-0.5 gap-0.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {VIEWS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all whitespace-nowrap shrink-0"
            style={{
              background: view === id ? 'var(--color-primary)' : 'transparent',
              color: view === id ? 'white' : 'var(--color-text-muted)',
              border: view === id ? '1px solid rgba(97,22,218,0.3)' : '1px solid transparent',
            }}
          >
            <Icon name={icon} size={13} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
