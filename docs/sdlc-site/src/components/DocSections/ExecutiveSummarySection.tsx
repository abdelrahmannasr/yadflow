import { Icon } from '../shared/Icon';

const METRICS = [
  { label: 'yad-* Skills', value: '30', icon: 'extension', color: '#2471a3' },
  { label: 'Pipeline Phases', value: '4', icon: 'route', color: '#1e8449' },
  { label: 'Front Gates', value: '5', icon: 'rate_review', color: '#ca6f1e' },
  { label: 'Check Gates', value: '6', icon: 'verified', color: '#b7950b' },
];

const KEY_POINTS = [
  'Every step does its work, writes its output to a file, and waits at a gate — nothing hidden, no database.',
  'All state lives in files under .sdlc/ (state.json, approvals.json, contract-lock.json, trust-log.json) that you can also edit directly.',
  'The front half is human-gated and runs once per epic in the product hub; the build half runs once per story per code repo.',
  'Two per-step dials: assistance (none | review | heavy) and automation (human_approve | machine_advance).',
  'Automation is earned with trust-log evidence and reversible in one move; front states and the engineer review are permanently human.',
];

export function ExecutiveSummarySection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-2">What is yadflow?</h4>
        <p className="text-sm text-slate-400 leading-relaxed">
          <strong className="text-white">Yadflow</strong> (<em>yahd-flow</em> — from{' '}
          <span dir="rtl">يد</span>, Arabic for "hand") is the AI-driven, gated, team, multi-repo SDLC built
          as a custom BMAD module. It turns BMAD from a solo tool into a{' '}
          <strong className="text-white">team, gated, file-driven SDLC engine</strong>: every step writes a
          file and stops at a gate, and who advances that gate — a human now, a machine later once earned — is
          a per-step setting. The principle:{' '}
          <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded text-slate-300">AI builds. The hand decides.</code>
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {METRICS.map((m) => (
          <div
            key={m.label}
            className="rounded-lg border p-3 text-center"
            style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2"
              style={{ background: `${m.color}20`, color: m.color }}
            >
              <Icon name={m.icon} size={18} />
            </div>
            <div className="text-2xl font-bold text-white">{m.value}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Key Points</h4>
        <ul className="space-y-2">
          {KEY_POINTS.map((point, i) => (
            <li key={i} className="flex items-start gap-2">
              <Icon name="check_circle" size={16} className="text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-sm text-slate-400 leading-relaxed">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
