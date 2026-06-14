import { Icon } from '../shared/Icon';
import { useStakeholderFilter } from '../../hooks/useStakeholderFilter';
import { CLI_COMMANDS } from '../../data/referenceData';

export function CliCommandChips() {
  const actions = useStakeholderFilter(CLI_COMMANDS);

  if (actions.length === 0) return null;

  const setupCommands = actions.filter((a) => a.target === 'setup');
  const buildCommands = actions.filter((a) => a.target === 'build');

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="terminal" size={20} className="text-cyan-400" />
        <h3 className="text-slate-100 text-lg font-bold font-display">The yad CLI</h3>
      </div>

      {setupCommands.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 block">
            Setup &amp; Front ({setupCommands.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {setupCommands.map((action) => (
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

      {buildCommands.length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 block">
            Build &amp; Automation ({buildCommands.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {buildCommands.map((action) => (
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
