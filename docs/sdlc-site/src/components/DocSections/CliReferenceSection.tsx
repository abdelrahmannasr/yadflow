import { Icon } from '../shared/Icon';

// The `yad` CLI surface (published to npm as `yadflow`). Zero-dependency; run
// with npx from your Product. Requires Node >= 18.
const GROUPS = [
  {
    phase: 'Setup & reconcile',
    color: '#b7950b',
    items: [
      'yad new <name> — new product: make <name>/product/ and run setup (no remote created)',
      'yad init — in the folder holding your repos: make product/, run setup, offer each repo',
      'yad join <url> [folder] — clone the Product and its repos; per-machine steps only',
      'npx yadflow setup — guided first-run wizard',
      '--json on every command but yad hook (E1) — one object on stdout: { jsonVersion, version, command, ok, …the command\'s own keys, warnings }; a refusal adds error, code and hint; every other line goes to stderr; exit codes unchanged',
      'npx yadflow check [--fix] — report / reconcile drift vs the manifest',
      'npx yadflow update — apply drift only (also migrates pre-2.0 sdlc-* installs)',
      'npx yadflow doctor [--json] — environment + state health (exit 1 on failure); its protection section says whether each repo\'s branch requires an approval on GitHub or GitLab, or that it is not known and why (E70) — a warning at most',
      'npx yadflow migrate [--apply] — move state files onto this release\'s file shape (previews by default, backs up before writing)',
      'yad skill list | bind <step> <skill>… | unbind <step> — choose which skill runs a lifecycle step (.sdlc/skills.json); several skills run as a chain, each costing another model run',
      'yad detect [--json] — which skills, agents, MCP servers and plugins are installed here and in your home folder, and which agents read each place; read-only, MCP servers named only',
      'yad repo clone [name] — clone every registered repo missing on this machine, at its recorded path (the clone step of yad join); never touches a repo already there',
      'yad report [-m <text>] — file a bug in the yadflow repo with scrubbed diagnostics (no paths, hosts, repo names, logins or flag values); YAD_NO_REPORT=1 turns the offer off',
      'yad usage [--out <path>] [--since/--until <YYYY-MM-DD> | --all] [--member <name>] [--format html|json|md] [--repos] — per-member adoption report from git + the ledgers; read-only',
    ],
  },
  {
    phase: 'Where am I, steps and dials',
    color: '#2471a3',
    items: [
      'yad next [<epic>] [--all] [--check <step>] [--json] — the one next action, project-wide or per epic; in Build, the next sub-step per story and repo',
      'yad history [list] [--type t] [--theme x] [--thread EP-…] [--open|--done] | show <id> | search <text> — every work item newest first, one item\'s steps and approvals, or a text search; built live, writes nothing',
      'yad index [--json] — rebuild .sdlc/index.json, one summary line per work item (default branch only; on a verified Product CI writes it)',
      'yad foundation new | status — seed the Product level (the Foundation) once per product; status reports each roadmap feature as planned / in-shape / in-build / shipped',
      'yad skip <epic> <step> --reason <why> · yad unskip <epic> <step> — mark an optional step N/A, or put it back',
      'yad skip <epic> <story> --repo <name> --reason <why> · yad unskip … --repo <name> — skip a whole Build lane (no change needed in this repo), or put it back',
      'yad defer <epic> <step> --reason <why> [--debt] · yad undefer <epic> <step> — set an optional step aside to do later, or put it back',
      'yad unblock <epic> <step> — clear a recorded blocker once the wait is over',
      'yad dial <step> [--to auto|human] — a Shape author step\'s dial for the whole project (.sdlc/automation.json; recorded only for now). A review gate is always human',
      'yad dial <epic> <story> --repo <name> <step> [--to auto|human] — a Build lane step\'s dial; shows its run record as advice, never as a rule',
      'yad kill --reason <why> · yad unkill — hold every step at advance: human, or release it',
      'yad mode [solo --reason <why> | team] — who must approve: solo waives approvals (the merge still decides), team counts them',
      'yad assign <epic> <step> [--to <name>] [--force] · yad unassign · yad owners [<epic>] — step owners; advice, not a lock (the capture hook warns anyone else who edits)',
    ],
  },
  {
    phase: 'Shape review gate',
    color: '#ca6f1e',
    items: [
      'yad epic new <slug> [--type feature|chore] [--profile classic|analysis-first|chore|spike] [--stub] — seed a new epic\'s step chain from a lifecycle profile (no epic.md, no branch, no commit); chore and spike are the short lanes, with no architecture gate and so no contract of their own; --stub mints a brownfield anchor a defect can thread off',
      'yad gate open <epic> <artifact> — open the review PR/MR (branch must be on origin), mark in_review',
      'yad gate sync <epic> [artifact] [--pr <n>] — pull approvals/threads; merging the approved, resolved PR advances the step (sync records it with a local ledger; with a verified ledger CI runs yad gate ci --merged and sync is advice only)',
      'yad gate comments <epic> — fetch the unresolved review comments',
      'yad gate status <epic> — show each review step and its approvals',
      'yad gate approve <epic> <artifact> --by <name> — no platform only: record an approval, bound to the artifact (an edit revokes it)',
      'yad gate comment <epic> <artifact> --by <name> [--count <n>] [--new-round] — no platform only: record who commented this round',
      'yad gate advance <epic> <artifact> — no platform only: pass the gate when its approvals hold',
      'yad gate repair <epic> — close an author step stranded behind a passed gate (YAD-STATE-005)',
      'yad capture [--no-push] — snapshot every changed artifact onto your private yad/wip/<you>/<epic> branches (a hook runs it after each agent edit)',
      'yad claims [<epic>] [--no-fetch] — who else is editing which artifact, read from everyone\'s capture branches; advice, not a lock; ends 4 h after the last save or once merged (E46)',
      'yad fold <epic> <step> — end an authoring step with ONE commit of its files, docs(<epic>): author <step>; with ledger: local the epic\'s ledger rides along; the drafts stay on yad/wip (E44)',
    ],
  },
  {
    phase: 'Build commit & PR',
    color: '#1e8449',
    items: [
      'yad commit --type <t> -m <subject> — Conventional subject + trailers + atomic guard',
      'yad commit … --manual --reason <why> — commit past the Product\'s ledger hook; the reason is recorded, CI still judges it',
      'yad open-pr [--repo <name>] [--base <branch>] — open a task PR/MR from the repo template, based on the repo\'s resolved default branch (warns on a non-default base: no AI first pass); prints a reviewer suggestion from recent history and CODEOWNERS — a hint, never a request (E68)',
      'yad ship --type <t> -m <subject> — commit AND open the PR/MR in one step',
      'yad checkpoint [--push] — commit the machine-written Build state (trust-log / build-log / build-state) as one chore(product) commit; --retro-ship <epic>/<story> --repo <r> records a ship for a story merged before tracking',
      'yad tidy up [<epic>] [--push] — fold a shipped story\'s finished trust-log / build-log shards back into the single ledger',
      'yad repo list / yad repo refresh [name] — fresh/stale code-context',
      'yad repo refresh [name] --push — publish refreshed code-maps + the registry to the Product default branch (chore(product): sync code-context [skip ci])',
      'yad risk-map check|draft [repo] — a code repo\'s .sdlc/risk-map: a risk level per directory (high / medium / low), no names. draft adds unset lines and never changes one; check warns where the map is stale (advisory). A PR touching a directory the base branch\'s map marks high asks for one more approver (reported, not enforced); the CI check, risk-route.sh and yad open-pr — not this command — also name who committed there in the last 30 days',
      'yad codeowners check [repo] [--json] [--platform github|gitlab] — warn where a code repo\'s CODEOWNERS looks stale (E69): a line that matches no file, a second file the platform never reads, a GitHub file of 3 MB or more, a line yad cannot read; plus a hint (this command only, never yad doctor) naming @logins with no commit in 90 days that carries their noreply address. Advisory; never writes the file — there is no --write, because a name yad wrote would become an owner the platform can enforce',
    ],
  },
  {
    phase: 'Feature threads & docs',
    color: '#8e44ad',
    items: [
      'yad thread [<epic>] [--json] — list every feature thread, or show one: its epics, the resolved current truth and open debt',
      'yad reconcile [check|refresh|wire] — flag orphan drift and open hotfix debt across threads (advisory; the gates block at merge)',
      'yad docs list | build | deploy | sync [--epic <id>|--overview] — the generated doc sites: freshness, build, Pages deploy, staleness sweep (--wire installs the Pages CI)',
    ],
  },
];

const FLAGS = [
  { risk: '--dir <path>', mitigation: 'target a project other than the cwd', level: 'low' },
  { risk: '--ai <claude|copilot|cursor|coderabbit|none>', mitigation: 'per-commit Co-Authored-By footer (the human still owns the commit)', level: 'low' },
  { risk: '--contract-change', mitigation: 'mark a diff that touches the locked contract surface (routes back to architecture)', level: 'high' },
  { risk: '--risk <low|medium|high>', mitigation: 'filled into the PR body\'s Risk level; high (or a contract surface, or a high directory on the base branch\'s risk map) raises the approval count — open-pr and risk-route.sh print it; the extra approvers are advisory', level: 'medium' },
];

const LEVEL_COLORS: Record<string, string> = { high: '#ca6f1e', medium: '#b7950b', low: '#1e8449' };

export function CliReferenceSection() {
  return (
    <div className="space-y-5">
      {GROUPS.map((phase) => (
        <div
          key={phase.phase}
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border-default)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: phase.color }} />
            <span className="text-sm font-bold text-slate-200">{phase.phase}</span>
          </div>
          <ul className="p-4 space-y-1.5">
            {phase.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <Icon name="chevron_right" size={14} className="text-slate-500 mt-0.5 shrink-0" />
                <code className="text-[11px] text-slate-300 font-mono leading-relaxed">{item}</code>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div
        className="rounded-xl border p-4"
        style={{ background: 'rgba(20,17,24,0.5)', borderColor: 'var(--color-border-default)' }}
      >
        <h4 className="text-sm font-bold text-slate-200 mb-3">Key flags</h4>
        <div className="space-y-2">
          {FLAGS.map((r, i) => (
            <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <span
                className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                style={{ color: LEVEL_COLORS[r.level], background: `${LEVEL_COLORS[r.level]}1a` }}
              >
                {r.level}
              </span>
              <div>
                <code className="text-xs text-slate-300 font-mono">{r.risk}</code>
                <div className="text-[11px] text-slate-500 mt-0.5">{r.mitigation}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
