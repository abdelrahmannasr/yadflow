import { Icon } from '../shared/Icon';

// The build-half check gates (yad-checks). CI-agnostic bash invoked by GitHub
// Actions and GitLab CI; blocking in CI, but the human still owns the merge.
const GATE_GROUPS = [
  {
    layer: 'Production-safety gates',
    items: [
      { control: 'spec-link — every change links a real story/spec via its Task: trailer' },
      { control: 'contract-check — a contract-surface diff without Contract-Change + a re-locked contract FAILS and routes back to the architecture gate' },
      { control: 'build-test-lint — the repo builds, tests pass, and the linter is clean' },
    ],
  },
  {
    layer: 'Security gate',
    items: [
      { control: 'verified-commits — commits are platform-Verified (signed)' },
      { control: 'verified-commits — and authored by a roster-known author' },
    ],
  },
  {
    layer: 'Pattern gates (profile-aware: code | hub)',
    items: [
      { control: 'commit-message — Conventional-Commits subject + the fixed trailer order' },
      { control: 'pr-title — the PR/MR title follows the commit-subject style' },
      { control: 'pr-template — the PR/MR body uses the committed template (Impact & Risk block)' },
    ],
  },
  {
    layer: 'Where they run',
    items: [
      { control: '.github/workflows/yad-checks.yml (GitHub) and .gitlab-ci.yml (GitLab)' },
      { control: 'On both code repos AND the product hub (the hub validates its artifact-review conventions)' },
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
