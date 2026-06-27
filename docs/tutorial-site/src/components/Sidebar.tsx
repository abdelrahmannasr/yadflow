import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import { MODULES } from '../data/lessons';
import { useProgress } from '../store/useProgress';

const levelColor: Record<string, string> = {
  beginner: 'var(--color-earns)',
  intermediate: 'var(--color-artifact)',
  advanced: 'var(--color-accent)',
};

/** The curriculum navigator: modules and lessons with per-module progress counts. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const completed = useProgress((s) => s.completed);

  return (
    <nav className="flex flex-col h-full">
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-default)' }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Curriculum
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {MODULES.map((m) => {
          const done = m.lessons.filter((l) => completed[l.id]).length;
          const allDone = done === m.lessons.length;
          return (
            <div key={m.id}>
              <div className="flex items-center gap-2 px-2 mb-1.5">
                <Icon
                  name={allDone ? 'check_circle' : m.icon}
                  size={17}
                  fill={allDone}
                  style={{ color: allDone ? '#3fae6b' : levelColor[m.level] }}
                />
                <span className="text-xs font-bold font-display uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                  {m.number}. {m.title}
                </span>
                <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  {done}/{m.lessons.length}
                </span>
              </div>
              <ul className="space-y-0.5">
                {m.lessons.map((l) => (
                  <li key={l.id}>
                    <NavLink
                      to={`/lesson/${l.id}`}
                      onClick={onNavigate}
                      className="flex items-center gap-2 rounded-md pl-3 pr-2 py-1.5 text-[13px] transition-colors"
                      style={({ isActive }) => ({
                        background: isActive ? 'var(--color-primary-soft)' : 'transparent',
                        color: isActive ? '#fff' : 'var(--color-text-secondary)',
                      })}
                    >
                      <Icon
                        name={completed[l.id] ? 'task_alt' : 'radio_button_unchecked'}
                        size={15}
                        style={{ color: completed[l.id] ? '#3fae6b' : 'var(--color-text-muted)', flex: 'none' }}
                      />
                      <span className="truncate">{l.title}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
