import { Icon } from '../shared/Icon';

const TERM_GROUPS = [
  {
    phase: 'Phases & artifacts',
    steps: [
      'Epic — the unit of Shape work, identified by a stable EP-<slug> ID; everything hangs off it.',
      'Shape — the human-gated thinking: analysis → epic → architecture → ui → stories → test-cases.',
      'Build — turning a ready-for-build story into shipped code, once per story per repo.',
      'Contract surface — the shared cross-repo API/event surface, delimited in contract.md and hash-locked.',
    ],
  },
  {
    phase: 'Gates & roles',
    steps: [
      'Review gate — the reusable team approval: 1 approver, who should not be the author (the base), all threads resolved, and the review PR/MR merged. Anyone with access to the repo can approve; yadflow keeps no list of people.',
      'Approval count — how many distinct people a step asks to approve: base 1 + risk step. Only the base is enforced for now; the gate prints the rest as a shortfall.',
      'Risk step — what a step\'s risk tags add to the count: contract +2, auth or payments +1, the highest tag and never the sum. Advisory until the capacity cap lands.',
      'Active people — how many people committed or approved lately, counted live from the approval and ship records plus git authorship, never from a stored list. The window scales with how fast the team merges. Printed once per epic on `yad gate status` and `yad gate sync`, and beside the ask in a generated review PR; it caps nothing yet. An unreadable source reads as "not counted", never as a small number.',
      'Engineer review — the human merge gate; advisory AI first-pass, never the authority. Permanently human.',
      'Lens — the role a step is authored through (analyst, pm, architect, ux, dev, tester, reviewer, engineer).',
    ],
  },
  {
    phase: 'Dials & automation',
    steps: [
      'driver — human | pair | agent: who does the work on a step. Older name: `assistance` (none | review | heavy), still what the engine reads.',
      'advance — human | auto: who moves a step forward. Older name: `automation` (human_approve | machine_advance), still what the engine reads.',
      'yad dial — sets a step\'s advance dial. A Build lane step in build-state; a Shape author step for the whole project in .sdlc/automation.json (recorded only). It shows the step\'s run record as advice; nothing is earned (E34).',
      'Kill switch — `yad kill --reason` holds every step at `advance: human`, recorded in .sdlc/automation.json; `yad unkill` turns it off.',
    ],
  },
];

const KEY_FILES = [
  { label: 'state.json', query: 'currentStep + each step\'s driver/advance dials (older names: assistance/automation) + shape_steps_locked' },
  { label: 'approvals.json', query: 'recorded approvals, hash-bound to the reviewed artifact' },
  { label: 'contract-lock.json', query: 'the SHA-256 of the CONTRACT-SURFACE block in contract.md' },
  { label: 'trust-log.json', query: 'every Build run\'s verdict — the run record yad dial shows as advice' },
  { label: 'schemaVersion', query: 'the shape a state file is in, stamped as the first key of every JSON object yad writes under .sdlc/ — a file without it counts as version 1' },
];

export function GlossarySection() {
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
