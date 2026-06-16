import { useNavigate } from 'react-router-dom';
import { Icon } from '../shared/Icon';
import { useFlowStore } from '../../store/useFlowStore';

export function TopNavBar() {
  const navigate = useNavigate();
  const toggleReferencePanel = useFlowStore((s) => s.toggleReferencePanel);
  const toggleCommandPalette = useFlowStore((s) => s.toggleCommandPalette);

  return (
    <header className="flex-none flex items-center justify-between whitespace-nowrap border-b px-6 py-3 z-20"
      style={{
        borderColor: 'var(--color-border-default)',
        background: 'var(--color-bg-primary)',
      }}
    >
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2 text-white">
          <img src={`${import.meta.env.BASE_URL}yadflow-icon.png`} alt="yadflow" className="h-9 w-9 object-contain" />
          <span className="text-lg font-bold font-display text-white tracking-tight">yadflow</span>
        </div>
        <button
          onClick={toggleCommandPalette}
          className="hidden md:flex items-center rounded-lg px-3 py-1.5 w-64 border transition-colors"
          style={{
            background: 'var(--color-surface-highlight)',
            borderColor: 'transparent',
          }}
        >
          <Icon name="search" size={20} className="text-slate-400" />
          <span className="text-sm text-slate-500 ml-2 flex-1 text-left">Search phases...</span>
          <div className="text-xs text-slate-500 px-1.5 py-0.5 rounded border"
            style={{ background: 'var(--color-surface-dark)', borderColor: 'var(--color-border-default)' }}
          >
            &#8984;K
          </div>
        </button>
      </div>
      <div className="flex items-center gap-4">
        <div className="hidden lg:flex items-center gap-2">
          <button
            onClick={toggleReferencePanel}
            className="flex items-center justify-center px-4 py-2 rounded-full text-slate-300 text-sm font-medium transition-colors"
            style={{ ':hover': { background: 'var(--color-surface-highlight)' } } as React.CSSProperties}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-highlight)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="menu_book" size={18} className="mr-2" />
            Reference
          </button>
          <button
            onClick={() => navigate('/docs')}
            className="flex items-center justify-center px-4 py-2 rounded-full text-slate-300 text-sm font-medium transition-colors"
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-highlight)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="description" size={18} className="mr-2" />
            Docs
          </button>
          <a
            href={import.meta.env.BASE_URL.replace(/app\/$/, '') || '/'}
            title="Back to the full static SDLC report (the main documentation)"
            className="flex items-center justify-center px-4 py-2 rounded-full text-slate-300 text-sm font-medium transition-colors"
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-highlight)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="article" size={18} className="mr-2" />
            Full report
          </a>
        </div>
      </div>
    </header>
  );
}
