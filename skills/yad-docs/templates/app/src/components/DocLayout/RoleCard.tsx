import { useNavigate } from 'react-router-dom';
import { Icon } from '../shared/Icon';
import type { RoleConfig } from '../../data/roles';

interface RoleCardProps {
  role: RoleConfig;
}

export function RoleCard({ role }: RoleCardProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/docs/${role.slug}`)}
      className="group text-left rounded-xl border p-5 transition-all hover:border-opacity-60"
      style={{
        background: 'rgba(20,17,24,0.5)',
        borderColor: 'var(--color-border-default)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `${role.color}50`;
        e.currentTarget.style.background = `${role.color}08`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border-default)';
        e.currentTarget.style.background = 'rgba(20,17,24,0.5)';
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center"
          style={{ background: `${role.color}20`, color: role.color }}
        >
          <Icon name={role.icon} size={24} />
        </div>
        <Icon
          name="arrow_forward"
          size={18}
          className="text-slate-600 group-hover:text-slate-300 transition-colors mt-1"
        />
      </div>
      <h3 className="text-white font-bold font-display mb-1">{role.label}</h3>
      <p className="text-xs text-slate-400 leading-relaxed mb-3">{role.description}</p>
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded border"
          style={{
            color: role.color,
            background: `${role.color}15`,
            borderColor: `${role.color}25`,
          }}
        >
          {role.sectionIds.length} sections
        </span>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded border text-slate-400"
          style={{
            background: 'rgba(255,255,255,0.03)',
            borderColor: 'var(--color-border-default)',
          }}
        >
          {role.relevantPathIds.length} flow paths
        </span>
      </div>
    </button>
  );
}
