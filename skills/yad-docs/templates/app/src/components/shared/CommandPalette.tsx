import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFlowStore } from '../../store/useFlowStore';
import { PATHS } from '../../data/paths';
import { Icon } from './Icon';
import { CATEGORY_ICONS } from '../../utils/iconMap';

export function CommandPalette() {
  const isOpen = useFlowStore((s) => s.isCommandPaletteOpen);
  const toggle = useFlowStore((s) => s.toggleCommandPalette);
  const selectPath = useFlowStore((s) => s.selectPath);
  const setActiveStep = useFlowStore((s) => s.setActiveStep);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && isOpen) {
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, toggle]);

  // Reset on open — adjust state during render (not inside an effect) so it does
  // not trigger an extra cascading render (react-hooks/set-state-in-effect).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }

  const results = useMemo(() => {
    if (!query.trim()) {
      return PATHS.map((p) => ({
        id: `path-${p.id}`,
        type: 'path' as const,
        label: `Path ${p.id}: ${p.label}`,
        description: p.description,
        category: p.category,
        pathId: p.id,
      }));
    }

    const q = query.toLowerCase();
    const items: Array<{
      id: string;
      type: 'path' | 'step';
      label: string;
      description: string;
      category?: string;
      pathId: number;
      stepIndex?: number;
    }> = [];

    for (const path of PATHS) {
      if (path.label.toLowerCase().includes(q) || path.description.toLowerCase().includes(q)) {
        items.push({
          id: `path-${path.id}`,
          type: 'path',
          label: `Path ${path.id}: ${path.label}`,
          description: path.description,
          category: path.category,
          pathId: path.id,
        });
      }
      for (let i = 0; i < path.steps.length; i++) {
        const step = path.steps[i];
        if (step.title.toLowerCase().includes(q) || step.handler.toLowerCase().includes(q)) {
          items.push({
            id: `step-${path.id}-${i}`,
            type: 'step',
            label: `${step.title}`,
            description: `Path ${path.id} > Step ${i + 1} > ${step.handler}`,
            pathId: path.id,
            stepIndex: i,
          });
        }
      }
    }

    return items.slice(0, 20);
  }, [query]);

  const handleSelect = useCallback((item: typeof results[0]) => {
    selectPath(item.pathId);
    if (item.type === 'step' && item.stepIndex !== undefined) {
      setTimeout(() => setActiveStep(item.stepIndex!), 50);
    }
    toggle();
  }, [selectPath, setActiveStep, toggle]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, selectedIndex, results, handleSelect]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60"
            onClick={toggle}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50 rounded-xl shadow-2xl border overflow-hidden"
            style={{
              background: 'var(--color-surface-dark)',
              borderColor: 'var(--color-border-default)',
            }}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b"
              style={{ borderColor: 'var(--color-border-default)' }}
            >
              <Icon name="search" size={20} className="text-slate-400" />
              <input
                type="text"
                placeholder="Search paths, steps, handlers..."
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
                className="flex-1 bg-transparent border-none text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-0"
                autoFocus
              />
              <kbd className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded border"
                style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border-default)' }}
              >
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[400px] overflow-y-auto p-2">
              {results.length === 0 ? (
                <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  No results found
                </div>
              ) : (
                results.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors"
                    style={{
                      background: index === selectedIndex ? 'var(--color-surface-highlight)' : 'transparent',
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <Icon
                      name={item.type === 'path' ? (CATEGORY_ICONS[item.category || ''] || 'route') : 'arrow_forward'}
                      size={18}
                      className={item.type === 'path' ? 'text-[var(--color-primary)]' : 'text-slate-500'}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{item.label}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {item.description}
                      </p>
                    </div>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded"
                      style={{
                        background: item.type === 'path' ? 'rgba(97,22,218,0.15)' : 'rgba(255,255,255,0.05)',
                        color: item.type === 'path' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                      }}
                    >
                      {item.type}
                    </span>
                  </button>
                ))
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t flex items-center gap-4 text-[10px]"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}
            >
              <span><kbd className="font-mono">&#8593;&#8595;</kbd> Navigate</span>
              <span><kbd className="font-mono">&#9166;</kbd> Select</span>
              <span><kbd className="font-mono">Esc</kbd> Close</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
