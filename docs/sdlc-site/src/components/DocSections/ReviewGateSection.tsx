import { Icon } from '../shared/Icon';

// The reusable team review gate — the one gate, reused for all five front-half
// reviews. open → comment → approve → advance. The file ledger is the source of
// truth; with a hub platform it rides a real review PR/MR and advances on merge.
const REVIEWS = [
  {
    method: 'BASE',
    path: 'epic · ui-design · analysis · test-cases',
    description: 'The default rule: the artifact owner plus one non-owner reviewer must approve.',
    middleware: ['owner approves', '1 reviewer approves', 'advance currentStep'],
    category: 'base',
  },
  {
    method: 'ESCALATED',
    path: 'architecture + contract',
    description:
      'risk_tags: ["contract"] — base rule PLUS a domain owner for every repo in epic.repos. The contract-surface hash must still match contract-lock.json.',
    middleware: ['owner + 1 reviewer', '+ domain owner per repo', 'contract hash matches'],
    category: 'escalated',
  },
  {
    method: 'PER-REPO',
    path: 'stories',
    description:
      'Base rule PLUS a domain owner (the repo engineer) for every repo that appears in any story.repos.',
    middleware: ['owner + 1 reviewer', '+ domain owner per touched repo', 'advance to ready-for-build'],
    category: 'escalated',
  },
];

const LEDGER = [
  { file: 'reviews/<artifact>--<date>--comments.md', note: 'reviewer comments (commenting never advances)' },
  { file: '.sdlc/approvals.json', note: 'recorded approvals — hash-bound to the artifact' },
  { file: '.sdlc/state.json', note: 'currentStep advances only when the rule is met' },
];

export function ReviewGateSection() {
  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <p className="text-xs text-slate-400 leading-relaxed">
          Every review is the same loop —{' '}
          <code className="text-[11px] bg-white/5 px-1 rounded text-slate-300">open → comment → approve → advance</code>.
          Reviewers comment and approve as files; the step moves forward only when the gate rule is satisfied.
          With a hub platform the gate rides a real review PR/MR and{' '}
          <strong className="text-white">auto-advances on merge</strong>, which is the human approval act — so
          front steps still never machine_advance. Approvals are revoked when the artifact changes (re-hash).
        </p>
      </div>

      {REVIEWS.map((ep) => (
        <div
          key={ep.path}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="px-4 py-3 flex items-center gap-3 border-b" style={{ borderColor: 'var(--color-border-default)' }}>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{
                background: ep.category === 'base' ? 'rgba(30,132,73,0.15)' : 'rgba(202,111,30,0.15)',
                color: ep.category === 'base' ? '#1e8449' : '#ca6f1e',
              }}
            >
              {ep.method}
            </span>
            <code className="text-sm text-slate-200 font-mono">{ep.path}</code>
          </div>
          <div className="px-4 py-2.5">
            <p className="text-xs text-slate-400 mb-3">{ep.description}</p>
            <div className="flex flex-wrap gap-1.5">
              {ep.middleware.map((mw, i) => (
                <span key={mw} className="inline-flex items-center gap-1">
                  <span
                    className="px-2 py-1 rounded text-[11px] font-mono border"
                    style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--color-border-default)', color: '#94a3b8' }}
                  >
                    {mw}
                  </span>
                  {i < ep.middleware.length - 1 && <Icon name="arrow_forward" size={12} className="text-slate-600" />}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">The file ledger (source of truth)</h4>
        <ul className="space-y-2">
          {LEDGER.map((l) => (
            <li key={l.file} className="flex items-start gap-2">
              <Icon name="description" size={14} className="text-slate-500 mt-0.5 shrink-0" />
              <span className="text-xs text-slate-400">
                <code className="text-[11px] text-slate-300">{l.file}</code> — {l.note}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
