import { Icon } from '../shared/Icon';

// The `yad` CLI surface (published to npm as `yadflow`). Zero-dependency; run
// with npx from your product hub. Requires Node >= 18.
const GROUPS = [
  {
    phase: 'Setup & reconcile',
    color: '#b7950b',
    items: [
      'npx yadflow setup — guided first-run wizard',
      'npx yadflow check [--fix] — report / reconcile drift vs the manifest',
      'npx yadflow update — apply drift only (also migrates pre-2.0 sdlc-* installs)',
      'npx yadflow doctor [--json] — environment + state health (exit 1 on failure)',
    ],
  },
  {
    phase: 'Front-half review gate',
    color: '#ca6f1e',
    items: [
      'yad gate open <epic> <artifact> — open the review PR/MR, mark in_review',
      'yad gate sync <epic> [artifact] — pull approvals/threads, auto-advance on merge',
      'yad gate comments <epic> — fetch the unresolved review comments',
      'yad gate status <epic> — show each review step and its approvals',
    ],
  },
  {
    phase: 'Build-half commit & PR',
    color: '#1e8449',
    items: [
      'yad commit --type <t> -m <subject> — Conventional subject + trailers + atomic guard',
      'yad open-pr [--repo <name>] — open a task PR/MR from the repo template',
      'yad ship --type <t> -m <subject> — commit AND open the PR/MR in one step',
      'yad repo list / yad repo refresh [name] — fresh/stale code-context',
      'yad repo refresh [name] --push — publish refreshed code-maps + the registry to the hub default branch (chore(hub): sync code-context [skip ci])',
    ],
  },
];

const FLAGS = [
  { risk: '--dir <path>', mitigation: 'target a project other than the cwd', level: 'low' },
  { risk: '--ai <claude|copilot|cursor|coderabbit|none>', mitigation: 'per-commit Co-Authored-By footer (the human still owns the commit)', level: 'low' },
  { risk: '--contract-change', mitigation: 'mark a diff that touches the locked contract surface (routes back to architecture)', level: 'high' },
  { risk: '--risk <low|medium|high>', mitigation: 'high (or contract/auth/payments) routes the review to domain owners', level: 'medium' },
];

const LEVEL_COLORS: Record<string, string> = { high: '#ca6f1e', medium: '#b7950b', low: '#1e8449' };

export function CliReferenceSection() {
  return (
    <div className="space-y-5">
      {GROUPS.map((phase) => (
        <div
          key={phase.phase}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: phase.color }} />
            <span className="text-sm font-bold text-slate-200">{phase.phase}</span>
          </div>
          <ul className="p-4 space-y-1.5">
            {phase.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <Icon name="chevron_right" size={14} className="text-slate-500 mt-0.5 shrink-0" />
                <code className="text-[11px] text-slate-300 font-mono leading-relaxed">{item}</code>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Key flags</h4>
        <div className="space-y-2">
          {FLAGS.map((r, i) => (
            <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <span
                className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                style={{ color: LEVEL_COLORS[r.level], background: `${LEVEL_COLORS[r.level]}1a` }}
              >
                {r.level}
              </span>
              <div>
                <code className="text-xs text-slate-300 font-mono">{r.risk}</code>
                <div className="text-[11px] text-slate-500 mt-0.5">{r.mitigation}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
