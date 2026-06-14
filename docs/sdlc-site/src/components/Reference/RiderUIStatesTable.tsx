import { Icon } from '../shared/Icon';
import { useStakeholderFilter } from '../../hooks/useStakeholderFilter';
import { RIDER_UI_STATES } from '../../data/referenceData';

export function RiderUIStatesTable() {
  const states = useStakeholderFilter(RIDER_UI_STATES);

  if (states.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="tune" size={20} className="text-emerald-400" />
          <h3 className="text-slate-100 text-lg font-bold font-display">Assistance Dial</h3>
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border"
          style={{ color: '#10b981', background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)' }}
        >
          assistance
        </span>
      </div>
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)', background: 'rgba(20,17,24,0.5)' }}
      >
        <table className="w-full text-left text-sm">
          <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
            <tr>
              <th className="px-4 py-3 font-semibold text-slate-300">Value</th>
              <th className="px-4 py-3 font-semibold text-slate-300">Setting</th>
              <th className="px-4 py-3 font-semibold text-slate-300 text-right">Default</th>
            </tr>
          </thead>
          <tbody>
            {states.map((state) => (
              <tr
                key={state.state}
                className="border-t hover:bg-white/5 transition-colors"
                style={{ borderColor: 'var(--color-border-default)' }}
              >
                <td className="px-4 py-3 text-slate-200 font-mono text-xs">{state.state}</td>
                <td className="px-4 py-3 text-blue-400 font-mono text-xs">{state.schemaValue}</td>
                <td className="px-4 py-3 text-right">
                  {state.isTerminal ? (
                    <span className="inline-flex items-center gap-1 text-rose-400 text-xs font-medium">
                      <Icon name="cancel" size={14} /> Yes
                    </span>
                  ) : (
                    <span className="text-slate-500 text-xs">No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
