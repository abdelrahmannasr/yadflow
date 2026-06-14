import { useState, useEffect } from 'react';
import { Icon } from '../shared/Icon';

interface TocItem {
  id: string;
  title: string;
  icon: string;
}

interface DocTableOfContentsProps {
  items: TocItem[];
  roleLabel: string;
  roleIcon: string;
  roleColor: string;
}

export function DocTableOfContents({ items, roleLabel, roleIcon, roleColor }: DocTableOfContentsProps) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? '');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 }
    );

    items.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [items]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-6 px-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${roleColor}20`, color: roleColor }}
        >
          <Icon name={roleIcon} size={18} />
        </div>
        <span className="text-sm font-bold text-white font-display">{roleLabel}</span>
      </div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold px-2 mb-3">
        Sections ({items.length})
      </div>
      <nav className="space-y-0.5">
        {items.map(({ id, title, icon }) => {
          const isActive = activeId === id;
          return (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-all text-sm"
              style={{
                background: isActive ? `${roleColor}15` : 'transparent',
                color: isActive ? roleColor : 'var(--color-text-muted)',
                borderLeft: isActive ? `2px solid ${roleColor}` : '2px solid transparent',
              }}
            >
              <Icon name={icon} size={16} />
              <span className="truncate font-medium">{title}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
