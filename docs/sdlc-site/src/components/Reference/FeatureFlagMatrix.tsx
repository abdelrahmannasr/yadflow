import { Icon } from '../shared/Icon';
import { useStakeholderFilter } from '../../hooks/useStakeholderFilter';
import { FEATURE_FLAGS } from '../../data/referenceData';

function FlagIndicator({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-medium">
      <Icon name="check_circle" size={14} /> true
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-rose-400 text-xs font-medium">
      <Icon name="cancel" size={14} /> false
    </span>
  );
}

export function FeatureFlagMatrix() {
  const flags = useStakeholderFilter(FEATURE_FLAGS);

  if (flags.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="cable" size={20} className="text-amber-400" />
          <h3 className="text-slate-100 text-lg font-bold font-display">Connectors</h3>
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border"
          style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.2)' }}
        >
          setup
        </span>
      </div>
      <div className="space-y-3">
        {flags.map((flag) => (
          <div
            key={flag.name}
            className="p-3 rounded-lg border"
            style={{
              background: 'rgba(20,17,24,0.5)',
              borderColor: 'var(--color-border-default)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-slate-200">{flag.name}</span>
              <span
                className="text-[10px] px-2 py-0.5 rounded font-medium"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-muted)' }}
              >
                Committed: {flag.defaultValue ? 'yes' : 'no'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2.5">{flag.description}</p>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-xs">Tool/MCP</span>
                  <FlagIndicator value={flag.stagingValue} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-xs">Degrades</span>
                  <FlagIndicator value={flag.productionValue} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
