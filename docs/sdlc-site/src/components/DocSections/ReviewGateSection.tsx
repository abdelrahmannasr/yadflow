import { Icon } from '../shared/Icon';

// The reusable team review gate — the one gate, reused for all five Shape
// reviews. open → comment → approve → advance. The file ledger is the source of
// truth; with a Product platform it rides a real review PR/MR and advances on merge.
const REVIEWS = [
  {
    method: 'BASE',
    path: 'every review (enforced)',
    description:
      'The rule that holds every gate: at least 1 distinct approver, who should not be the author (GitHub never lets you approve your own PR; GitLab only stops it when its approval settings say so), every comment thread resolved, and the review PR/MR merged. There are no roles and no stored list of people — anyone with access to the repo can approve, and the approval is recorded under their platform login.',
    middleware: ['1 approver (should not be the author)', 'all threads resolved', 'PR merged → advance currentStep'],
    category: 'base',
  },
  {
    method: 'COUNT',
    path: 'every step (risk step advisory for now)',
    description:
      'Names no person, role or step: a step asks for base 1 + risk step distinct approvers. The risk step is +2 for a contract tag and +1 for auth or payments, the highest tag and never the sum. Read from the tags the epic records. The number of active people is counted live — committed or approved, over a window that scales with how fast the team merges (the span of the last 20 merged PRs, bounded 30-180 days). The engine caps the count at the active people less one, never below 1 — a contract gate asks 3, and with 2 active people the capped ask is 1; the one seat is left for the author. Only the base is enforced; the risk step is printed as a shortfall ("1 short"). The cap is reported, not enforced. Why: the count of people can read high (a git name and a platform login are two people until proven one), so a two-person team can read as four and an enforced gate would lock it out. A later yadflow change will enforce the capped count together with yad gate lower --reason, a recorded way out of a gate a team cannot meet, once the count is accurate. Until then, under an open gate, yad gate status and yad gate sync print a "may not be met:" warning when the count suggests the gate may not pass; it holds nothing. When a source cannot be read the count says "NOT COUNTED" rather than a number, because an unreadable input must never look like a small team, and no cap is shown. A team gate that passes on its counted approvals while the cap lowered its ask records it as capped on its closing record (not in solo mode, and not on a skipped or inherited step).',
    middleware: ['asks base 1 + risk step', 'capped at active people − 1 (reported)', 'distinct people, not roles', 'shortfall reported, not blocking'],
    category: 'base',
  },
  {
    method: 'CONTRACT RISK',
    path: 'architecture + contract',
    description:
      'risk_tags: ["contract"] — the count asks for 3 approvers (base 1 + contract risk 2). The base is enforced; the other 2 are reported as a shortfall. The contract-surface hash must still match contract-lock.json. The review PR is labelled domain:<repo> for each repo in epic.repos, as a hint for whom to ask.',
    middleware: ['count asks 3 (1 + 2)', 'base 1 enforced', 'contract hash matches'],
    category: 'risk',
  },
  {
    method: 'COUNT',
    path: 'stories',
    description:
      'An ordinary count gate, like every other review. The repos that any story touches label the review PR (domain:<repo>); they add no approvals.',
    middleware: ['base 1 enforced', 'domain:<repo> labels', 'advance to ready-for-build'],
    category: 'base',
  },
  {
    method: 'SOLO',
    path: 'opt-in (solo: true)',
    description:
      "A lone developer can't approve their own PR on GitHub, so solo mode waives the approval requirement only — the review PR/MR + its merge stay (CI runs on the PR; the merge advances the step). Passes on merged + threads resolved, and the closing record says `waived: \"solo\"`. Switch with yad mode solo --reason \"<why>\" / yad mode team, which records who, when and why.",
    middleware: ['no approval required', 'all threads resolved', 'PR merged → advance', 'waived: solo recorded'],
    category: 'base',
  },
];

const LEDGER = [
  { file: 'reviews/<artifact>--<date>--comments.md', note: 'reviewer comments (commenting never advances)' },
  { file: '.sdlc/approvals.json', note: 'recorded approvals — hash-bound to the artifact' },
  { file: '.sdlc/state.json', note: 'currentStep advances when the base count is met; risk_tags per step set the full, reported count' },
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
          With a Product platform the gate rides a real review PR/MR and{' '}
          <strong className="text-white">auto-advances on merge</strong>, which is the human approval act — so
          Shape steps still never advance on their own. <strong className="text-white">CI is the sole writer of the
          ledger</strong>, and writes only at merge, on the default branch: during review the platform PR/MR is
          the source of truth and CI never touches the review branch; humans never commit the gate files.
          Approvals are revoked when the artifact changes (re-hash; the frontmatter status line does not count), re-checked when CI reads the platform at merge.
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
