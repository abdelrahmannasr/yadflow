import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useFlowStore } from '../../store/useFlowStore';
import { PATHS } from '../../data/paths';
import type { PathCategory } from '../../data/types';
import { Icon } from '../shared/Icon';
import { Tooltip } from '../shared/Tooltip';
import { CATEGORY_ICONS } from '../../utils/iconMap';

const CATEGORY_LABELS: Record<PathCategory, string> = {
  setup: 'Setup & Connect',
  front: 'Front Half',
  build: 'Build Half',
  automate: 'Automation',
  change: 'Change Management',
};

const CATEGORY_ORDER: PathCategory[] = [
  'setup',
  'front',
  'build',
  'automate',
  'change',
];

export const PathSelector = () => {
  const { selectedPath, selectPath } = useFlowStore();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const grouped = useMemo(() => {
    const groups: Record<string, typeof PATHS> = {};
    for (const path of PATHS) {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!path.label.toLowerCase().includes(q) && !path.description.toLowerCase().includes(q)) {
          continue;
        }
      }
      if (!groups[path.category]) groups[path.category] = [];
      groups[path.category].push(path);
    }
    return groups;
  }, [searchQuery]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-slate-100 text-sm font-bold font-display uppercase tracking-wider">
          Path Selection
        </h3>
        <Tooltip content="Coming soon">
          <button disabled className="text-xs font-medium opacity-50 cursor-not-allowed" style={{ color: 'var(--color-primary)' }}>
            View All
          </button>
        </Tooltip>
      </div>

      {/* Search */}
      <div className="flex items-center rounded-lg border transition-colors"
        style={{
          background: 'var(--color-surface-highlight)',
          borderColor: 'transparent',
        }}
      >
        <Icon name="search" size={20} className="text-slate-400 ml-3" />
        <input
          type="text"
          placeholder="Search paths..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent border-none text-sm text-white w-full placeholder-slate-500 ml-2 p-2 focus:outline-none focus:ring-0"
        />
      </div>

      {/* Path list */}
      <div className="space-y-1">
        {CATEGORY_ORDER.map((cat) => {
          const paths = grouped[cat];
          if (!paths || paths.length === 0) return null;
          return (
            <div key={cat}>
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {CATEGORY_LABELS[cat]}
              </div>
              {paths.map((path) => {
                const isSelected = selectedPath.id === path.id;
                const iconName = CATEGORY_ICONS[path.category] || 'circle';
                return (
                  <motion.button
                    key={path.id}
                    onClick={() => selectPath(path.id)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left transition-all relative overflow-hidden"
                    style={{
                      background: isSelected ? 'rgba(97,22,218,0.1)' : 'transparent',
                      border: isSelected ? '1px solid rgba(97,22,218,0.2)' : '1px solid transparent',
                      color: isSelected ? 'white' : 'var(--color-text-secondary)',
                    }}
                    whileHover={{
                      backgroundColor: isSelected ? undefined : 'var(--color-surface-highlight)',
                    }}
                  >
                    {isSelected && (
                      <div className="absolute left-0 top-0 bottom-0 w-1"
                        style={{ background: 'var(--color-primary)' }}
                      />
                    )}
                    <div className="flex items-center gap-3">
                      <Icon
                        name={iconName}
                        size={20}
                        filled={isSelected}
                        className={isSelected ? 'text-[var(--color-primary)]' : 'text-slate-500'}
                      />
                      <span className="text-sm font-medium">{path.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isSelected && (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/path/${path.id}`); }}
                          className="p-1 rounded hover:bg-white/10 transition-colors"
                          title="View details"
                        >
                          <Icon name="open_in_new" size={14} className="text-[var(--color-primary)]" />
                        </button>
                      )}
                      {isSelected ? (
                        <div className="h-2 w-2 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                          style={{ background: '#22c55e' }}
                        />
                      ) : (
                        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                          P{path.id}
                        </span>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
