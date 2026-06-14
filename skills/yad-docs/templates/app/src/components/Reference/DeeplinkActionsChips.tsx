import { Icon } from '../shared/Icon';
import { useStakeholderFilter } from '../../hooks/useStakeholderFilter';
import { DEEPLINK_ACTIONS } from '../../data/referenceData';

export function DeeplinkActionsChips() {
  const actions = useStakeholderFilter(DEEPLINK_ACTIONS);

  if (actions.length === 0) return null;

  const riderActions = actions.filter((a) => a.target === 'rider');
  const driverActions = actions.filter((a) => a.target === 'driver');

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="link" size={20} className="text-cyan-400" />
        <h3 className="text-slate-100 text-lg font-bold font-display">Deeplink Actions</h3>
      </div>

      {riderActions.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 block">
            Rider ({riderActions.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {riderActions.map((action) => (
              <span
                key={action.value}
                className="px-2.5 py-1.5 rounded-md text-xs font-mono border cursor-default hover:bg-white/5 transition-colors"
                style={{
                  background: 'rgba(20,17,24,0.5)',
                  borderColor: 'var(--color-border-default)',
                  color: '#94a3b8',
                }}
                title={action.description}
              >
                {action.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {driverActions.length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 block">
            Driver ({driverActions.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {driverActions.map((action) => (
              <span
                key={action.value}
                className="px-2.5 py-1.5 rounded-md text-xs font-mono border cursor-default hover:bg-white/5 transition-colors"
                style={{
                  background: 'rgba(20,17,24,0.5)',
                  borderColor: 'var(--color-border-default)',
                  color: '#94a3b8',
                }}
                title={action.description}
              >
                {action.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
