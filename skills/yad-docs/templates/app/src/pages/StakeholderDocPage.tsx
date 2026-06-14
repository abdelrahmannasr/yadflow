import { useParams, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { DocPageShell } from '../components/DocLayout/DocPageShell';
import { DocTableOfContents } from '../components/DocLayout/DocTableOfContents';
import { DocSectionCard } from '../components/DocLayout/DocSectionCard';
import { getRoleBySlug } from '../data/roles';
import { DOC_SECTIONS } from '../data/docSections';
import { useFlowStore } from '../store/useFlowStore';
import { Icon } from '../components/shared/Icon';
import type { StakeholderView } from '../data/types';

export function StakeholderDocPage() {
  const { roleSlug } = useParams<{ roleSlug: string }>();
  const navigate = useNavigate();
  const setStakeholderView = useFlowStore((s) => s.setStakeholderView);

  const role = getRoleBySlug(roleSlug ?? '');

  useEffect(() => {
    if (role) {
      setStakeholderView(role.slug as StakeholderView);
    }
  }, [role, setStakeholderView]);

  if (!role) {
    return (
      <DocPageShell title="Role Not Found" backTo="/docs" backLabel="Back to Docs">
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <Icon name="error_outline" size={48} className="text-slate-600 mb-3" />
            <p className="text-slate-400">Unknown role: {roleSlug}</p>
            <button
              onClick={() => navigate('/docs')}
              className="mt-4 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'var(--color-primary)' }}
            >
              Back to Documentation Hub
            </button>
          </div>
        </div>
      </DocPageShell>
    );
  }

  const sections = role.sectionIds
    .map((id) => DOC_SECTIONS[id])
    .filter(Boolean);

  const tocItems = sections.map((s) => ({ id: s.id, title: s.title, icon: s.icon }));

  return (
    <DocPageShell
      title={role.label}
      subtitle={role.description}
      icon={role.icon}
      iconColor={role.color}
      backTo="/docs"
      backLabel="All Roles"
      headerRight={
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: `${role.color}20`, color: role.color }}
          onMouseEnter={(e) => (e.currentTarget.style.background = `${role.color}30`)}
          onMouseLeave={(e) => (e.currentTarget.style.background = `${role.color}20`)}
        >
          <Icon name="play_circle" size={18} />
          Open Visualizer
        </button>
      }
      sidebar={
        <DocTableOfContents
          items={tocItems}
          roleLabel={role.shortLabel}
          roleIcon={role.icon}
          roleColor={role.color}
        />
      }
    >
      <div className="p-8 max-w-4xl space-y-2">
        {sections.map((section) => {
          const Component = section.component;
          return (
            <DocSectionCard
              key={section.id}
              id={section.id}
              title={section.title}
              icon={section.icon}
              iconColor={section.iconColor}
            >
              <Component />
            </DocSectionCard>
          );
        })}
      </div>
    </DocPageShell>
  );
}
