import { Icon } from '../shared/Icon';

const TERM_GROUPS = [
  {
    phase: 'Phases & artifacts',
    steps: [
      'Epic — the unit of front-half work, identified by a stable EP-<slug> ID; everything hangs off it.',
      'Front half — the human-gated thinking: analysis → epic → architecture → ui → stories → test-cases.',
      'Build half — turning a ready-for-build story into shipped code, once per story per repo.',
      'Contract surface — the shared cross-repo API/event surface, delimited in contract.md and hash-locked.',
    ],
  },
  {
    phase: 'Gates & roles',
    steps: [
      'Review gate — the reusable owner + 1 reviewer approval, escalating on contract/auth/payments.',
      'Domain owner — the engineer who owns a repo; a required reviewer when their repo is touched.',
      'Engineer review — the human merge gate; advisory AI first-pass, never the authority. Permanently human.',
      'Lens — the role a step is authored through (analyst, pm, architect, ux, dev, tester, reviewer, engineer).',
    ],
  },
  {
    phase: 'Dials & automation',
    steps: [
      'assistance — none | review | heavy: how much AI helps author a step.',
      'automation — human_approve | machine_advance: who advances a step.',
      'Earned automation — a back step set to machine_advance after its trust slice clears ≥5 runs / ≥80% unchanged.',
      'Kill switch — one line that forces every step back to human_approve system-wide, instantly reversible.',
    ],
  },
];

const KEY_FILES = [
  { label: 'state.json', query: 'currentStep + each step\'s assistance/automation dials + front_steps_locked' },
  { label: 'approvals.json', query: 'recorded approvals, hash-bound to the reviewed artifact' },
  { label: 'contract-lock.json', query: 'the SHA-256 of the CONTRACT-SURFACE block in contract.md' },
  { label: 'trust-log.json', query: 'every back-half run\'s verdict — the evidence base for earning automation' },
];

export function DataMigrationSection() {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <p className="text-sm text-slate-400 leading-relaxed">
          The vocabulary of yadflow, in one place. Every term maps to a file you can read or a rule the gates
          enforce — <strong className="text-white">all state lives in files</strong>, nothing hidden.
        </p>
      </div>

      {TERM_GROUPS.map((phase) => (
        <div
          key={phase.phase}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
            <span className="text-sm font-bold text-slate-200">{phase.phase}</span>
          </div>
          <ul className="p-4 space-y-2">
            {phase.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <Icon name="chevron_right" size={14} className="text-slate-600 mt-0.5 shrink-0" />
                <span className="text-xs text-slate-400">{step}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">The .sdlc ledger files</h4>
        <div className="space-y-2">
          {KEY_FILES.map((q) => (
            <div key={q.label}>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{q.label}</span>
              <pre className="mt-1 text-[11px] font-mono text-emerald-400 bg-black/30 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap">
                {q.query}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
