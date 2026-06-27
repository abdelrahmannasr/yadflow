import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { useProgress } from '../store/useProgress';
import { TOTAL_LESSONS } from '../data/lessons';

export function TopNav({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const completed = useProgress((s) => s.completed);
  const doneCount = Object.keys(completed).length;
  const pct = Math.round((doneCount / TOTAL_LESSONS) * 100);

  return (
    <header
      className="flex items-center gap-3 px-4 h-14 flex-none border-b z-20"
      style={{ borderColor: 'var(--color-border-default)', background: 'var(--color-bg-primary)' }}
    >
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="md:hidden flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/5"
          aria-label="Toggle curriculum"
        >
          <Icon name="menu" size={20} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      )}
      <Link to="/" className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg font-display font-bold"
          style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', color: '#fff' }}
        >
          يد
        </div>
        <div className="leading-tight">
          <div className="font-display font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Yadflow</div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Guided Tutorial</div>
        </div>
      </Link>

      <div className="ml-auto flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-2">
          <div className="h-1.5 w-28 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-highlight)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))' }} />
          </div>
          <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{doneCount}/{TOTAL_LESSONS}</span>
        </div>
        <a
          href="https://abdelrahmannasr.github.io/yadflow/"
          target="_blank"
          rel="noreferrer"
          className="hidden md:flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors hover:bg-white/5"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}
        >
          <Icon name="article" size={15} />
          Reference
        </a>
        <a
          href="https://github.com/abdelrahmannasr/yadflow"
          target="_blank"
          rel="noreferrer"
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5"
          aria-label="GitHub repository"
        >
          <Icon name="code" size={18} style={{ color: 'var(--color-text-secondary)' }} />
        </a>
      </div>
    </header>
  );
}
