interface DialStep {
  name: string;
  description: string;
  type: 'validate' | 'persist' | 'sideEffect' | 'notify';
}

const TYPE_COLORS = {
  validate: { color: '#2471a3', bg: 'rgba(36,113,163,0.12)' },   // dial value
  persist: { color: '#1e8449', bg: 'rgba(30,132,73,0.12)' },     // set by the team
  sideEffect: { color: '#b7950b', bg: 'rgba(183,149,11,0.12)' }, // evidence
  notify: { color: '#566573', bg: 'rgba(86,101,115,0.12)' },     // locked
};

const CHAINS: { title: string; endpoint: string; color: string; steps: DialStep[] }[] = [
  {
    title: 'Dial 1 — driver (who does the work)',
    endpoint: 'state.json · per step',
    color: '#2471a3',
    steps: [
      { name: 'human', description: 'No AI help — the human authors the step entirely.', type: 'validate' },
      { name: 'pair', description: 'Default. A person and an agent together — AI drafts; the human reviews and edits.', type: 'validate' },
      { name: 'agent', description: 'AI does most of the work; the human still owns the gate.', type: 'validate' },
    ],
  },
  {
    title: 'Dial 2 — advance (who moves it forward)',
    endpoint: 'state.json · per step',
    color: '#1e8449',
    steps: [
      { name: 'human', description: 'Default. A human advances the step. Every review gate — engineer-review and each Shape review — stays here forever.', type: 'notify' },
      { name: 'auto', description: 'Set by the team with yad dial. On a Build step yad-run advances it on its own after a clean run; on a Shape author step it is recorded only, for now.', type: 'persist' },
    ],
  },
  {
    title: 'Setting the dial (the run record as advice)',
    endpoint: 'trust-log.json · .sdlc/automation.json',
    color: '#b7950b',
    steps: [
      { name: 'run record', description: 'Every yad-run step records its verdict. yad dial shows runs and % approved-unchanged beside the dial — advice, never a rule.', type: 'sideEffect' },
      { name: 'yad dial → auto', description: 'The team decides. A review gate is refused; --to human is always accepted.', type: 'persist' },
      { name: 'yad kill', description: 'Holds every step at `advance: human`, recorded with who, when and why — reversible in one move with yad unkill.', type: 'notify' },
    ],
  },
];

export function TwoDialsSection() {
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
