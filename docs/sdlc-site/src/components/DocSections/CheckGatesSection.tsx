import { Icon } from '../shared/Icon';

// The Build check gates (yad-checks). CI-agnostic bash invoked by GitHub
// Actions and GitLab CI; blocking in CI, but the human still owns the merge.
const GATE_GROUPS = [
  {
    layer: 'Production-safety gates',
    items: [
      { control: 'spec-link — every change links a real story/spec via its Task: trailer' },
      { control: 'contract-check — a contract-surface diff without Contract-Change + a re-locked contract FAILS and routes back to the architecture gate' },
      { control: 'risk-map — warns where the repo\'s .sdlc/risk-map (a risk level per directory, no names) has gone stale, and reports the approver count read from the base branch\'s map. Advisory: it always exits 0 and never blocks a merge' },
      { control: 'build-test-lint — the repo builds, tests pass, and the linter is clean' },
    ],
  },
  {
    layer: 'Feature-thread gates',
    items: [
      { control: 'lineage-check — the change links a real threaded epic' },
      { control: 'epic-open — a sealed epic (all stories shipped) refuses new behaviour, so the change needs a change-epic' },
      { control: 'reconcile-debt — a thread with open hotfix debt is frozen for new changes until the debt is paid' },
    ],
  },
  {
    layer: 'Security gate',
    items: [
      { control: 'verified-commits — commits are platform-Verified (signed)' },
      { control: 'verified-commits — no author allowlist: write access to the repository decides who may author' },
    ],
  },
  {
    layer: 'Pattern gates (profile-aware: code | product)',
    items: [
      { control: 'commit-message — Conventional-Commits subject + the fixed trailer order' },
      { control: 'pr-title — the PR/MR title follows the commit-subject style' },
      { control: 'pr-template — the PR/MR body uses the committed template (Impact & Risk block)' },
      { control: 'on the Product, pr-title/pr-template split by head branch (review/EP-* → artifact-review shape, else code shape) and reject an epics/** change on a non-review branch' },
    ],
  },
  {
    layer: 'Where they run',
    items: [
      { control: 'Code repos: .github/workflows/yad-checks.yml (GitHub) or the yad-checks include in .gitlab-ci.yml (GitLab)' },
      { control: 'The Product: .github/workflows/yad-product-checks.yml (or its GitLab include) — commit-message, pr-title, pr-template and ledger-guard (only CI may change the gate ledger), to check its artifact-review conventions' },
      { control: 'verified-commits runs on every code repo (a job in yad-checks.yml) and on the Product (its own yad-verified-commits.yml)' },
      { control: 'They fail closed on a bad base ref — never silently pass' },
    ],
  },
];

export function CheckGatesSection() {
  return (
    <div className="space-y-4">
      {GATE_GROUPS.map((layer) => (
        <div
          key={layer.layer}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div
            className="px-4 py-2.5 border-b flex items-center gap-2"
            style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}
          >
            <Icon name="verified" size={16} className="text-emerald-400" />
            <span className="text-sm font-bold text-slate-200">{layer.layer}</span>
          </div>
          <ul className="p-3 space-y-1.5">
            {layer.items.map((item) => (
              <li key={item.control} className="flex items-start gap-2 px-1">
                <Icon name="check_circle" size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-xs text-slate-400">{item.control}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
