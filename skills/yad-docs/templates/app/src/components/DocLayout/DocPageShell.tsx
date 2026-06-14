import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../shared/Icon';

interface DocPageShellProps {
  title: string;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  backTo?: string;
  backLabel?: string;
  headerRight?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
}

export function DocPageShell({
  title,
  subtitle,
  icon,
  iconColor = 'var(--color-primary)',
  backTo,
  backLabel = 'Back',
  headerRight,
  sidebar,
  children,
}: DocPageShellProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-1 overflow-hidden">
      {sidebar && (
        <aside
          className="w-64 flex-none flex flex-col border-r overflow-y-auto"
          style={{
            borderColor: 'var(--color-border-default)',
            background: 'var(--color-bg-primary)',
          }}
        >
          {sidebar}
        </aside>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex-none px-8 py-5 border-b flex items-center justify-between"
          style={{
            borderColor: 'var(--color-border-default)',
            background: 'var(--color-bg-primary)',
          }}
        >
          <div className="flex items-center gap-4">
            {backTo && (
              <button
                onClick={() => navigate(backTo)}
                className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm"
              >
                <Icon name="arrow_back" size={18} />
                {backLabel}
              </button>
            )}
            {icon && (
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: `${iconColor}20`, color: iconColor }}
              >
                <Icon name={icon} size={22} />
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-white font-display">{title}</h1>
              {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {headerRight}
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
