import { Icon } from '../shared/Icon';

// The connectors: each setup-phase skill registers a connection in .sdlc/ and
// degrades gracefully when the underlying tool/MCP/CLI is absent.
const CONNECTORS = [
  { skill: 'yad-connect-repos', registry: 'repos.json', primary: 'GitHub / GitLab', degrade: 'greenfield-safe (skip)', color: '#b7950b' },
  { skill: 'yad-connect-design', registry: 'design.json', primary: 'Figma (MCP)', degrade: 'markdown-only', color: '#ca6f1e' },
  { skill: 'yad-connect-testing', registry: 'testing.json', primary: 'Playwright (MCP)', degrade: 'artifacts-only', color: '#1e8449' },
  { skill: 'yad-connect-learning', registry: 'learning.json', primary: 'DeepTutor (CLI)', degrade: 'harness-native', color: '#2471a3' },
  { skill: 'yad-connect-docs', registry: 'docs.json', primary: 'GitHub / GitLab Pages', degrade: 'build-only', color: '#566573' },
];

const ORDER = [
  { step: 'Install the module', detail: 'npx yadflow setup copies all 29 yad-* skills and registers _bmad/sdlc/.' },
  { step: 'Detect the hub & roster', detail: 'Detect GitHub/GitLab from the remote; record reviewers (login → name + role) into hub.json.' },
  { step: 'Connect code repos', detail: 'Register each repo in repos.json and cache a Repomix pack + code-map so the front phases are code-aware.' },
  { step: 'Connect design / testing / learning', detail: 'Optional, one per project — each degrades gracefully and records that it is absent.' },
  { step: 'Connect a docs target', detail: 'Resolve the Pages host + Vite base path from hub.json so the generated sites can deploy.' },
];

const FACTS = [
  'Local-user auth only — no tokens are ever stored in any registry (project_url / files are plain references).',
  'Every connector is idempotent and refreshable; most are one-per-project (repos can be many).',
  'A connector is never a gated state — it never touches epic state, approvals, or the contract lock.',
  'Staleness for code repos is tracked by HEAD sha and is a human decision: yad repo list / yad repo refresh.',
];

export function ConnectorsSection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">The five connectors</h4>
        <div className="space-y-3">
          {CONNECTORS.map((c) => (
            <div key={c.skill} className="flex items-center gap-3 flex-wrap">
              <span
                className="text-xs font-bold font-mono px-2 py-1 rounded text-center"
                style={{ background: `${c.color}15`, color: c.color, border: `1px solid ${c.color}25` }}
              >
                {c.skill}
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded border" style={{ color: '#94a3b8', background: 'rgba(255,255,255,0.03)', borderColor: 'var(--color-border-default)' }}>
                .sdlc/{c.registry}
              </span>
              <span className="text-[11px] text-slate-400">{c.primary}</span>
              <span className="text-[10px] text-slate-500 ml-auto">degrades → {c.degrade}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Setup order</h4>
        <div className="space-y-3">
          {ORDER.map((s, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                style={{ background: 'rgba(36,113,163,0.15)', color: '#2471a3' }}
              >
                {i + 1}
              </div>
              <div>
                <div className="text-sm text-slate-200 font-medium">{s.step}</div>
                <p className="text-xs text-slate-500 mt-0.5">{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(30,132,73,0.05)', borderColor: 'rgba(30,132,73,0.2)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Icon name="lock" size={18} className="text-emerald-400" />
          <h4 className="text-sm font-bold text-emerald-300">No stored tokens, graceful degradation</h4>
        </div>
        <ul className="space-y-2">
          {FACTS.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <Icon name="arrow_right" size={14} className="text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-xs text-slate-400">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
