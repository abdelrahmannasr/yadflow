import { Icon } from '../shared/Icon';
import { useStakeholderFilter } from '../../hooks/useStakeholderFilter';
import { DECISION_TREE } from '../../data/referenceData';

export function DecisionTreeView() {
  const branches = useStakeholderFilter(DECISION_TREE);

  if (branches.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="account_tree" size={20} className="text-[var(--color-primary)]" />
        <h3 className="text-slate-100 text-lg font-bold font-display">handleBookAssigned Decision Tree</h3>
      </div>
      <div
        className="rounded-xl border overflow-hidden font-mono text-sm"
        style={{
          borderColor: 'var(--color-border-default)',
          background: 'rgba(20,17,24,0.5)',
        }}
      >
        {branches.map((branch, i) => (
          <div
            key={i}
            className="p-4 border-b last:border-b-0 hover:bg-white/5 transition-colors"
            style={{ borderColor: 'var(--color-border-default)' }}
          >
            <div className="flex items-start gap-2">
              <span className="text-blue-400 shrink-0 mt-0.5">
                {i === branches.length - 1 ? '└' : '├'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-slate-200">
                  {branch.condition}
                  <span className="text-slate-500"> → </span>
                  <span className="text-emerald-400">{branch.result}</span>
                </div>
                {branch.detail && (
                  <p className="text-[11px] text-slate-500 mt-1.5 font-sans leading-relaxed">{branch.detail}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
