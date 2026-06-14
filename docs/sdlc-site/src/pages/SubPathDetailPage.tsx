import { useParams, useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { PATHS } from '../data/paths';
import { useFlowStore } from '../store/useFlowStore';
import { Icon } from '../components/shared/Icon';

export function SubPathDetailPage() {
  const { pathId } = useParams<{ pathId: string }>();
  const navigate = useNavigate();
  const selectPath = useFlowStore((s) => s.selectPath);
  const [activeTab, setActiveTab] = useState(0);

  const path = useMemo(() => {
    const id = parseInt(pathId || '0');
    return PATHS.find((p) => p.id === id);
  }, [pathId]);

  if (!path) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Icon name="error" size={48} className="text-slate-500 mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Path Not Found</h2>
          <button
            onClick={() => navigate('/')}
            className="text-sm px-4 py-2 rounded-lg"
            style={{ background: 'var(--color-primary)', color: 'white' }}
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const subPaths = path.subPaths || [];
  const currentSubPath = subPaths[activeTab];
  const steps = currentSubPath?.steps || path.steps;

  return (
    <main className="flex-1 flex flex-col overflow-y-auto px-6 py-8 max-w-7xl mx-auto w-full">
      {/* Header */}
      <header className="mb-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider"
                style={{ background: `${path.color}25`, color: path.color, border: `1px solid ${path.color}40` }}
              >
                Path {path.id}
              </span>
              <button
                onClick={() => navigate('/')}
                className="text-slate-400 text-sm hover:text-white transition-colors"
              >
                / Dashboard
              </button>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-white font-display mb-2">
              {path.label}
            </h2>
            <p className="text-slate-400 max-w-2xl text-lg">{path.description}</p>
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 rounded-lg border text-white text-sm font-medium flex items-center gap-2 transition-colors"
              style={{
                background: 'var(--color-surface-dark)',
                borderColor: 'var(--color-border-default)',
              }}
            >
              <Icon name="download" size={18} />
              Export PDF
            </button>
            <button
              onClick={() => { selectPath(path.id); navigate('/'); }}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 transition-colors"
              style={{
                background: 'var(--color-primary)',
                boxShadow: '0 4px 15px rgba(97,22,218,0.2)',
              }}
            >
              <Icon name="play_arrow" size={18} />
              Simulate Path
            </button>
          </div>
        </div>
      </header>

      {/* Sub-path tabs */}
      {subPaths.length > 0 && (
        <div className="border-b mb-8" style={{ borderColor: 'var(--color-border-default)' }}>
          <div className="flex gap-8 overflow-x-auto pb-px">
            {subPaths.map((sub, idx) => (
              <button
                key={sub.id}
                onClick={() => setActiveTab(idx)}
                className="group flex flex-col items-center gap-3 min-w-[140px] cursor-pointer"
              >
                <span className={`font-medium text-sm ${idx === activeTab ? 'text-[var(--color-primary)] font-bold' : 'text-slate-400 hover:text-white'} transition-colors`}>
                  {sub.id}. {sub.label}
                </span>
                <div className={`h-0.5 w-full rounded-t-full ${idx === activeTab ? 'bg-[var(--color-primary)]' : 'bg-transparent hover:bg-[var(--color-border-default)]'} transition-colors`} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
        {/* Left: System State & Side Effects Table */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* System State */}
          <div className="rounded-xl p-6 border shadow-xl relative overflow-hidden"
            style={{
              background: 'var(--color-surface-dark)',
              borderColor: 'var(--color-border-default)',
            }}
          >
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2 font-display">
              <Icon name="schema" size={20} className="text-[var(--color-primary)]" />
              System State Visualization
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {steps[0]?.activeComponents.slice(0, 3).map((compId, idx) => (
                <div key={compId} className="flex items-center gap-4">
                  <div className="rounded-lg p-4 flex flex-col gap-3 flex-1 border"
                    style={{
                      background: 'var(--color-bg-primary)',
                      borderColor: idx === 0 ? 'rgba(97,22,218,0.5)' : 'var(--color-border-default)',
                    }}
                  >
                    <div className="text-slate-300 text-sm font-semibold uppercase tracking-wider">
                      {compId.replace(/-/g, ' ')}
                    </div>
                    <div className="text-xs text-slate-500">
                      Status: <span className="text-slate-300 font-mono">{steps[0]?.status}</span>
                    </div>
                  </div>
                  {idx < 2 && (
                    <Icon name="arrow_forward" size={20} className="text-slate-600 hidden md:block shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Side Effects Table */}
          <div className="rounded-xl border overflow-hidden"
            style={{
              background: 'var(--color-surface-dark)',
              borderColor: 'var(--color-border-default)',
            }}
          >
            <div className="px-6 py-4 border-b flex justify-between items-center"
              style={{
                borderColor: 'var(--color-border-default)',
                background: 'var(--color-bg-primary)',
              }}
            >
              <h3 className="text-white font-bold text-lg flex items-center gap-2 font-display">
                <Icon name="table_chart" size={20} className="text-slate-400" />
                Scenario Side Effects
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}>
                    <th className="px-6 py-3 font-medium">Step</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium">Side Effects</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((step) => (
                    <tr key={step.id} className="border-t hover:bg-white/5 transition-colors"
                      style={{ borderColor: 'var(--color-border-default)' }}
                    >
                      <td className="px-6 py-4 font-medium text-white">{step.title}</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                          style={{
                            background: 'rgba(97,22,218,0.1)',
                            color: 'var(--color-primary)',
                          }}
                        >
                          {step.stepState}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-400">
                        {Object.entries(step.sideEffects)
                          .filter(([, v]) => v)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(', ') || 'None'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: Step Detail Panel */}
        <div className="flex flex-col gap-6">
          <div className="rounded-xl p-6 border h-full"
            style={{
              background: 'var(--color-surface-dark)',
              borderColor: 'var(--color-border-default)',
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-xl font-bold font-display">Step Detail Panel</h2>
              <div className="p-2 rounded-lg" style={{ background: 'rgba(97,22,218,0.2)' }}>
                <Icon name="info" size={20} className="text-[var(--color-primary)]" />
              </div>
            </div>

            <div className="space-y-6">
              {/* Pre-conditions */}
              <div>
                <h4 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Pre-conditions</h4>
                <ul className="space-y-2">
                  {steps[0] && (
                    <>
                      <li className="flex items-start gap-2 text-sm text-slate-300">
                        <Icon name="check_circle" size={18} className="text-emerald-400 shrink-0" />
                        <span>Status is <code className="px-1 rounded text-xs" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-primary)' }}>{steps[0].status}</code></span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-300">
                        <Icon name="check_circle" size={18} className="text-emerald-400 shrink-0" />
                        <span>Trigger: {steps[0].trigger}</span>
                      </li>
                    </>
                  )}
                </ul>
              </div>

              <div className="h-px w-full" style={{ background: 'var(--color-border-default)' }} />

              {/* Critical Logic */}
              <div>
                <h4 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Critical Logic</h4>
                <div className="p-4 rounded-r-lg border-l-2"
                  style={{
                    background: 'var(--color-bg-primary)',
                    borderLeftColor: 'var(--color-primary)',
                  }}
                >
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {steps[0]?.description || 'No description available.'}
                  </p>
                </div>
              </div>

              {/* Component Flags */}
              {steps[0] && (
                <div>
                  <h4 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Component Flags</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {steps[0].activeComponents.map((comp) => (
                      <div key={comp} className="p-3 rounded border"
                        style={{
                          background: 'var(--color-bg-primary)',
                          borderColor: 'var(--color-border-default)',
                        }}
                      >
                        <div className="text-xs text-slate-500 mb-1">{comp}</div>
                        <div className="text-emerald-400 font-mono text-sm">ACTIVE</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
