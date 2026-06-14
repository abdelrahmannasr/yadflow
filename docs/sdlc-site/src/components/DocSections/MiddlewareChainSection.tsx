interface DialStep {
  name: string;
  description: string;
  type: 'validate' | 'persist' | 'sideEffect' | 'notify';
}

const TYPE_COLORS = {
  validate: { color: '#2471a3', bg: 'rgba(36,113,163,0.12)' },   // dial value
  persist: { color: '#1e8449', bg: 'rgba(30,132,73,0.12)' },     // earned
  sideEffect: { color: '#b7950b', bg: 'rgba(183,149,11,0.12)' }, // evidence
  notify: { color: '#566573', bg: 'rgba(86,101,115,0.12)' },     // locked
};

const CHAINS: { title: string; endpoint: string; color: string; steps: DialStep[] }[] = [
  {
    title: 'Dial 1 — assistance (how much AI helps)',
    endpoint: 'state.json · per step',
    color: '#2471a3',
    steps: [
      { name: 'none', description: 'No AI help — the human authors the step entirely.', type: 'validate' },
      { name: 'review', description: 'Default. AI drafts; the human reviews and edits.', type: 'validate' },
      { name: 'heavy', description: 'AI does most of the work; the human still owns the gate.', type: 'validate' },
    ],
  },
  {
    title: 'Dial 2 — automation (who advances the step)',
    endpoint: 'state.json · per step',
    color: '#1e8449',
    steps: [
      { name: 'human_approve', description: 'Default. A human advances the step. Front states + engineer-review are locked here forever.', type: 'notify' },
      { name: 'machine_advance', description: 'Earned per back step; yad-run advances it on its own once trust is proven.', type: 'persist' },
    ],
  },
  {
    title: 'Earning automation (the trust log)',
    endpoint: 'trust-log.json · trust_threshold',
    color: '#b7950b',
    steps: [
      { name: 'back_steps only', description: 'spec · tasks · implement · checks — the only steps that MAY be automated, safest-end first.', type: 'sideEffect' },
      { name: '≥5 runs · ≥80% approved-unchanged', description: 'A step becomes a candidate only once its trust slice clears the threshold. "It seems fine" is not evidence.', type: 'sideEffect' },
      { name: 'set-dial → machine_advance', description: 'Flips the dial; refused if evidence is short, or for any front state / the engineer review.', type: 'persist' },
      { name: 'kill switch', description: 'yad-run action: kill forces every step back to human_approve system-wide — reversible in one move.', type: 'notify' },
    ],
  },
];

export function MiddlewareChainSection() {
  return (
    <div className="space-y-5">
      {CHAINS.map((chain) => (
        <div
          key={chain.endpoint + chain.title}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: chain.color }} />
            <span className="text-sm font-bold text-slate-200">{chain.title}</span>
            <code className="text-[10px] font-mono text-slate-500 ml-auto">{chain.endpoint}</code>
          </div>
          <div className="p-3 space-y-1.5">
            {chain.steps.map((step, i) => {
              const tc = TYPE_COLORS[step.type];
              return (
                <div key={step.name} className="flex items-start gap-3 group">
                  <div className="flex flex-col items-center pt-1">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                      style={{ background: tc.bg, color: tc.color }}
                    >
                      {i + 1}
                    </div>
                    {i < chain.steps.length - 1 && (
                      <div className="w-px h-6 mt-0.5" style={{ background: 'var(--color-border-default)' }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <span className="text-xs font-mono font-semibold text-slate-200">{step.name}</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">{step.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
