import { Icon } from '../shared/Icon';
import { useFlowStore } from '../../store/useFlowStore';

export function SidebarFooter() {
  const { playbackState, play, stop } = useFlowStore();

  return (
    <div className="p-4 border-t flex items-center justify-between gap-4"
      style={{
        borderColor: 'var(--color-border-default)',
        background: 'var(--color-bg-primary)',
      }}
    >
      <button
        onClick={stop}
        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-lg border text-slate-200 text-sm font-medium transition-colors"
        style={{
          borderColor: 'var(--color-surface-highlight)',
          background: 'var(--color-surface-dark)',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-highlight)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-surface-dark)'}
      >
        <Icon name="restart_alt" size={18} />
        Reset Flow
      </button>
      <button
        onClick={play}
        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-lg text-white text-sm font-medium transition-colors"
        style={{
          background: 'var(--color-primary)',
          boxShadow: '0 4px 15px rgba(97,22,218,0.25)',
        }}
      >
        <Icon name={playbackState === 'playing' ? 'pause' : 'play_arrow'} size={18} />
        {playbackState === 'playing' ? 'Pause' : 'Resume'}
      </button>
    </div>
  );
}
