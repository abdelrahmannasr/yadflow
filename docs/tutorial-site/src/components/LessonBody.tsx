import { Icon } from './Icon';
import { InlineText } from './InlineText';
import type { Block, CommandLine } from '../data/types';

const calloutStyles: Record<string, { border: string; bg: string; icon: string; iconColor: string; label: string }> = {
  info: { border: 'var(--color-earns)', bg: 'rgba(90,169,230,0.08)', icon: 'info', iconColor: 'var(--color-earns)', label: 'Note' },
  warn: { border: 'var(--color-gate)', bg: 'rgba(255,157,77,0.08)', icon: 'warning', iconColor: 'var(--color-gate)', label: 'Watch out' },
  key: { border: 'var(--color-accent)', bg: 'rgba(255,100,144,0.08)', icon: 'key', iconColor: 'var(--color-accent)', label: 'Key idea' },
};

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'h':
      return (
        <h3 className="font-display text-lg font-semibold mt-7 mb-2" style={{ color: 'var(--color-text-primary)' }}>
          <InlineText text={block.text} />
        </h3>
      );
    case 'p':
      return (
        <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-secondary)' }}>
          <InlineText text={block.text} />
        </p>
      );
    case 'list':
      return (
        <ul className="mb-4 space-y-2">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-2.5 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              <Icon name="chevron_right" size={18} style={{ color: 'var(--color-primary-hover)', marginTop: 2, flex: 'none' }} />
              <span><InlineText text={it} /></span>
            </li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="mb-4 space-y-2.5">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-3 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              <span
                className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold font-display"
                style={{ background: 'var(--color-primary-soft)', color: '#fff' }}
              >
                {i + 1}
              </span>
              <span className="pt-0.5"><InlineText text={it} /></span>
            </li>
          ))}
        </ol>
      );
    case 'callout': {
      const s = calloutStyles[block.tone];
      return (
        <div className="mb-5 rounded-lg p-4 flex gap-3" style={{ borderLeft: `3px solid ${s.border}`, background: s.bg }}>
          <Icon name={s.icon} size={20} style={{ color: s.iconColor, flex: 'none', marginTop: 1 }} />
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: s.iconColor }}>{s.label}</div>
            <p className="leading-relaxed text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <InlineText text={block.text} />
            </p>
          </div>
        </div>
      );
    }
  }
}

export function CommandList({ commands }: { commands: CommandLine[] }) {
  return (
    <div className="mb-5 rounded-lg overflow-hidden code-block">
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.02)' }}>
        <Icon name="terminal" size={15} style={{ color: 'var(--color-text-muted)' }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Try it</span>
      </div>
      <div className="p-3 space-y-2">
        {commands.map((c, i) => (
          <div key={i}>
            <div className="flex items-start gap-2 text-sm" style={{ color: '#d7c5ff' }}>
              <span style={{ color: 'var(--color-accent)' }} className="select-none flex-none">$</span>
              <span className="break-all">{c.cmd}</span>
            </div>
            {c.note && (
              <div className="pl-4 text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}># {c.note}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProducesList({ produces }: { produces: string[] }) {
  return (
    <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(244,208,63,0.05)', border: '1px solid rgba(244,208,63,0.18)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon name="description" size={16} style={{ color: 'var(--color-artifact)' }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-artifact)' }}>This step produces</span>
      </div>
      <ul className="space-y-1">
        {produces.map((p, i) => (
          <li key={i} className="text-sm flex gap-2" style={{ color: 'var(--color-text-secondary)' }}>
            <Icon name="arrow_right" size={16} style={{ color: 'var(--color-text-muted)', flex: 'none' }} />
            <code className="text-xs">{p}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LessonBody({ body }: { body: Block[] }) {
  return (
    <div className="prose-tutorial">
      {body.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}
