import { useNavigate } from 'react-router-dom';
import { Icon } from '../shared/Icon';
import { useFlowStore } from '../../store/useFlowStore';
import { useAuthStore } from '../../store/useAuthStore';

export function TopNavBar() {
  const navigate = useNavigate();
  const toggleReferencePanel = useFlowStore((s) => s.toggleReferencePanel);
  const toggleCommandPalette = useFlowStore((s) => s.toggleCommandPalette);
  const logout = useAuthStore((s) => s.logout);

  return (
    <header className="flex-none flex items-center justify-between whitespace-nowrap border-b px-6 py-3 z-20"
      style={{
        borderColor: 'var(--color-border-default)',
        background: 'var(--color-bg-primary)',
      }}
    >
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3 text-white">
          <img src="/logo.svg" alt="Logo" className="h-8" />
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
          <span className="text-sm text-slate-500 ml-2 flex-1 text-left">Search flows...</span>
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
          <button
            className="flex items-center justify-center px-4 py-2 rounded-full text-slate-300 text-sm font-medium transition-colors"
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-highlight)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="settings" size={18} className="mr-2" />
            Settings
          </button>
        </div>
        <div className="h-6 w-px mx-2" style={{ background: 'var(--color-surface-highlight)' }} />
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-white">AbdelRahman Nasr</p>
            <p className="text-xs text-slate-400">Admin</p>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="h-10 w-10 rounded-full ring-2 ring-[#2f2938] flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80"
            style={{
              background: 'linear-gradient(135deg, var(--color-primary) 0%, #a855f7 100%)',
            }}
          >
            <Icon name="logout" size={20} className="text-white" />
          </button>
        </div>
      </div>
    </header>
  );
}
