#!/usr/bin/env node
// `yad` — setup/maintenance + the PR-driven review gate + build helpers for the SDLC module.
import { VERSION } from '../cli/manifest.mjs';
import { c, log, closePrompts, askYesNo } from '../cli/lib.mjs';
import { runLedgerGuardHook } from '../cli/hook.mjs';

const helpText = (profiles) => `${c.bold('yad')} — setup, review-gate & build helpers for the SDLC Workflow module  ${c.dim('v' + VERSION)}

${c.bold('Setup & maintenance')}
  yad setup            Guided first-run setup (profile interview, install, connect & wire repos)
                       profile flags: --solo | --team <n>, --greenfield | --brownfield,
                       --monorepo | --separate, --tools (configure design/testing/learning now)
  yad check            Report what is missing / drifted / modified / stale / legacy (read-only)
  yad check --fix      Reconcile: fill what is missing, update what changed
  yad update           Apply drift only (alias for: check --fix --scope=changed);
                       installs newly-added skills, updates changed skills + gate scripts,
                       and migrates pre-2.0 sdlc-* installs to the yad-* names.
                       A managed file whose edit yad can prove (its recorded sha) is
                       reported 'modified' and left alone; --overwrite-local replaces
                       it. Anything else it cannot account for is replaced only after
                       a <file>.yad-orig backup
  yad update --push    Also commit each repo's applied changes and push them straight to the
                       default branch of the Product + every connected repo (a chore(yad-update)
                       commit; no PR — the push-on-main yad-update-guard runs verified-commits
                       + commit-message). Announce the team & pause merges first. Also works as
                       'yad check --fix --push'; --allow-branch permits a non-default branch
  yad doctor [--json]  Environment + state health: tools/auth, config files,
                       repo paths, epic ledgers (exit 1 on any failure)
  yad migrate [--apply] [--json]   Move this project's state files onto the shape
                       this yadflow expects. Prints what WOULD change and writes
                       nothing until --apply, which copies each file it rewrites to
                       <file>.yad-orig first. Safe to run twice — the second run
                       reports there is nothing to do
  yad sync-status [epic]   Update artifact frontmatter status (draft/in-review/approved)
                       from .sdlc/state.json — all epics if omitted (--dry-run to preview)
  yad report [-m <text>]   File a bug in the yadflow repo with auto-scrubbed diagnostics
                       (no paths/hosts/repo names/logins/flag values). Also offered
                       automatically after an unexpected failure. YAD_NO_REPORT=1 disables.
  yad hook ledger-guard    ${c.dim('harness-invoked, not typed')} — refuse an agent's edit to the
                       CI-owned gate ledger in verified mode and name the command that owns
                       the transition. Reads a tool-call payload on stdin (or --path <p>);
                       exit 0 allows, exit 2 denies with the reason on stderr. With
                       --format cursor the verdict is JSON on stdout instead, for a harness
                       whose pre-edit hook asks for permission rather than reading an exit
                       code. Wired into .claude/settings.json and .cursor/hooks.json by
                       setup / check --fix. YAD_HOOK_DISABLE=1 skips.

${c.bold('Team usage (EM adoption & behavior report)')}
  yad usage                            Build a per-member report (HTML) from git + the SDLC ledgers
                                       (derived, read-only — writes no tracked state)
                                       flags: --out <path> (default ./usage-report.html),
                                       --since <YYYY-MM-DD> --until <YYYY-MM-DD> | --all,
                                       --member <name>, --format html|json|md, --repos (code commits)

${c.bold('Where am I / what next')}
  yad epic new <slug> [--type <t>] [--profile <p>] [--stub] [--parent <epic> --inherits <bases>] [--json]
                                       Seed a new epic's lifecycle: writes its step chain from a
                                       profile, plus empty approval/comment ledgers and reviews/.
                                       --type feature|chore (default feature). A change/defect/
                                       hotfix needs --parent: it takes the parent's route, and
                                       --inherits epic,architecture,contract,ui-design carries
                                       those steps by reference (satisfied, bound to the owner's
                                       hash). Carrying the contract writes a pointer-lock instead
                                       of a second contract (E42). The yad-change skill triages.
                                       --profile ${profiles.join('|')} (default classic).
                                       classic and analysis-first are the full chains; chore and
                                       spike are E40's short lanes — epic + stories, with the
                                       analyst's brief in front for a spike. Neither carries an
                                       architecture gate, so neither may move the contract surface.
                                       --stub seeds a brownfield anchor instead: the same chain
                                       with every step blocked behind backfill-pending, so a
                                       defect can thread off a feature that shipped before the
                                       Product existed (yad-backfill promote wakes it).
                                       Writes no epic.md, no branch and no commit: run the skill
                                       the chain names next. Refuses an epic that already has one
  yad foundation new [--json]          Seed the Product level (E75): the Foundation's two-step chain
                                       in foundation/.sdlc/, plus empty ledgers and reviews/. Run once
                                       per product, before any epic — then the yad-discovery skill
                                       authors its sections. Refuses a second one, and a product still
                                       on the old epics/EP-discovery/ (yad migrate converts that)
  yad foundation status [--json]       Which roadmap features are started: reads each proposed epic id
                                       in roadmap.md and reports planned / in-shape / in-build /
                                       shipped from the epic ledgers. Read-only — the roadmap's Status
                                       column is no longer kept by hand
  yad next                             Project-wide: the one next action to take (or run setup)
  yad next <epic>                      The single next action for one epic (skill or yad command)
  yad next <epic> --check <step>       Exit 0 if <step> is runnable now, else 1 (precondition guard)
  yad next --all                       Every active epic's next action at once
  yad next [<epic>] --json             The same answer as a machine-readable action object (for
                                       agents/CI) — always every epic, so --all is implied
  yad skill list [--json]              Which skill runs which step, and whether that is this
                                       project's choice or the engine's default
  yad skill bind <step> <skill> [<skill> ...]
                                       Bind a step to a skill of your own. Several skills run in
                                       the order given, one after another — each costs tokens
  yad skill unbind <step>              Drop the binding; the step goes back to the engine's default
  yad skip <epic> <step> --reason <text>   Mark an optional step N/A for this epic. Which steps
                                       those are comes from the epic's lifecycle route — on classic
                                       and analysis-first, ui-design: a backend/API/data epic with no
                                       UI. Stays visible & auditable (reason recorded, gate
                                       short-circuited); refused once any later step has started
  yad unskip <epic> <step>             Put a skipped step back in the chain (\`skip --undo\` does the
                                       same), until the step that follows it is finished or work
                                       past it starts — on classic, until stories are done
  yad skip <epic> <story> --repo <name> --reason <text>
                                       Skip a whole Build lane: this story needs no change in this
                                       repo (E39). Written to build-state/<story>.json; commit it with
                                       yad checkpoint --push. Refused before the stories review passes
                                       (edit the story's repos: instead), for a repo the story does not
                                       declare, once work started or a ship is recorded, and for the
                                       story's last lane. No single Build step can be skipped
  yad unskip <epic> <story> --repo <name>
                                       Put a skipped Build lane back; yad-run adds it on its next run
  yad defer <epic> <step> --reason <text> [--debt]
                                       Set an optional step aside to do LATER: marks it deferred.
                                       Say who is waiting for it in the reason. Same steps and same
                                       refusals as skip; the chain goes on, its review is still owed.
                                       --debt marks it owed back: yad next and yad doctor remind
                                       you until its review passes
  yad undefer <epic> <step>            Put a deferred step back, at any time. After later work has
                                       finished, the step re-opens beside that work, which stays done
  yad unblock <epic> <step>            Clear a recorded blocker once the wait is over: moves the
                                       step off blocked and removes its record in one write
  yad dial <step> [--to auto|human] [--json]
                                       A Shape author step's advance dial, for the whole project (E34),
                                       kept in .sdlc/automation.json. No --to shows it. A review gate is
                                       always human. Recorded only for now: nothing drives a Shape step
                                       on its own until the engine runs agents
  yad dial <epic> <story> --repo <name> <step> [--to auto|human] [--json]
                                       A Build lane step's dial (spec, tasks, implement, checks), in
                                       build-state; on auto the yad-run skill moves past it after a clean
                                       run. Shows the step's run record as advice, never as a rule
  yad kill --reason <text>             Kill switch: hold every step at advance: human. Recorded in
                                       .sdlc/automation.json — who, when and why
  yad unkill [--reason <text>]         Turn the kill switch off; each step follows its own dial again
  yad mode [solo --reason <text> | team [--reason <text>]] [--json]
                                       Who must approve. Solo waives approvals on every review gate (the
                                       merge still decides); team counts them. Records who, when and why.
                                       No word reads the mode. Open reviews follow it from their next sync

${c.bold('Review gate (Shape)')}
  yad gate open <epic> <artifact>      Open the review PR/MR; mark the step in_review. The review
                                       branch must already be on origin (it is never created here)
  yad gate sync <epic> [artifact] [--pr <n>]
                                       Pull PR state -> ledger; advance on approved+resolved+merged.
                                       With no recorded PR, resolves it from the review branch; --pr
                                       names one (and overrides a stale recorded pointer). Advisory
                                       in verified mode — there, recover with 'yad gate ci' below
  yad gate comments <epic> [artifact]  Fetch unresolved review comments to address
  yad gate status <epic>               Show each review step + approvals
  yad gate repair <epic> [--push]      Close an author step stranded behind a passed review gate
                                       (YAD-STATE-005); --push commits state.json to the default branch
  yad gate review <epic> [artifact]    Print the grounding bundle for the review companion
                                       (artifact + risk + contract + PR + code-maps) — fun, easy review
  yad gate walkthrough <epic> [artifact]  Grounding bundle + ordered risk-tagged stops for the
                                       pair-review walkthrough (yad-pair-review) — guided, teaching review
  yad gate trailer <epic> [artifact] --body <text> [--pr <n>]
                                       Upsert the companion's 60-sec briefing into the PR/MR description
  yad gate ci [--branch <head>] [--pr <n>] [--merged]
                        CI entry (Product workflow): pre-merge is read-only (nothing pushed);
                        --merged advances the step + flips artifact status on the default branch

${c.bold('Build helpers')}
  yad commit --type <t> -m <subject>   Commit by convention (trailers, atomic guard)
  yad open-pr [--repo <name>]          Open a task PR/MR against the repo's DEFAULT branch (never a
                                       hardcoded main; --base overrides) — stage-aware on the Product: a
                                       review/EP-* branch opens the Shape artifact-review PR
                                       (delegates to gate open), any other Product branch uses the
                                       code-task template
  yad ship --type <t> -m <subject>     Commit AND open the task PR/MR in one step (stage-aware)
  yad checkpoint [--push]              Commit the machine-written Build state on the Product
                                       (trust-log/build-log/build-state) — plus any story
                                       status: flip (→ in-build/shipped) backed by a build-log
                                       ship — as one audit-trail chore(hub) commit; default
                                       branch only (--allow-branch to override); no-op when clean
  yad checkpoint --retro-ship <epic>/<story> --repo <r>
                                       Record a retroactive build-log ship for a PRE-TRACKING story
                                       (merged before ledger tracking), then carry its status: shipped
                                       flip in the same commit (--merge-commit <sha>, --task <t> opt.);
                                       one repo per run — re-run per --repo for a multi-repo story
  yad tidy up [<epic>] [--push]        Fold FINISHED Build shards (a shipped story's
                                       trust-log/build-log entries) back into the single folded
                                       ledger, as one chore(hub) commit — the manual "pack it up"
                                       for the shard files; a no-op when nothing is foldable
  yad review trailer --repo <r> --pr <n> --body <text>   Post the companion's 60-sec briefing to a code PR/MR
  yad review context --repo <r> --pr <n>                  Print the grounding bundle for cards/chat
  yad review walkthrough --repo <r> --pr <n>              Bundle + ordered risk-tagged stops for the
                                                          pair-review walkthrough (yad-pair-review)
  yad review nudge --repo <r> --pr <n>                    Friendly @-mention on a bare code-PR approve
  yad review reconcile --epic <id> --repo <r> --pr <n>    Bridge: stamp engagement onto the build-log ship
  yad repo list                        Show connected repos (fresh / stale)
  yad repo refresh [name] [--push]     Re-pack a stale repo (a human decision). --push commits the
                       refreshed code-maps + registry as a chore(hub): sync code-context … [skip ci]
                       audit commit and pushes it to the Product default branch (--allow-branch to override)
  yad risk-map check [repo] [--json]   Warn where a code repo's .sdlc/risk-map (a risk level per
                                       directory, no names) has gone stale — advisory, never blocks
  yad risk-map draft [repo]            Add an 'unset' line for every directory the map does not cover
                                       (--dry-run prints it);
                                       never changes a line (the yad-connect-repos skill classifies them)
  yad codeowners check [repo] [--json] [--platform github|gitlab]
                                       Warn where a code repo's CODEOWNERS looks stale: a line that
                                       matches no file, a file the platform never reads or will not load,
                                       a line yad cannot read; plus a hint about @logins with no recent
                                       commit — advisory, never blocks, never writes the file

${c.bold('Feature threads (post-lock change management)')}
  yad thread                           List every feature thread (genesis → changes → defects)
  yad thread <epic> [--json]           Show one thread: its epics, the resolved current truth, open debt
  yad reconcile [check|refresh|wire]   Flag orphan drift + open hotfix debt across threads (advisory,
                                       never a gate — the gates block at merge)

${c.bold('Interactive docs (generated sites)')}
  yad docs list                        Show the docs target + per-site freshness
  yad docs build [--epic <id>|--overview]    npm-build a generated doc site
  yad docs deploy [--epic <id>|--overview]   Build + report the Pages deploy
  yad docs sync [--check|--refresh|--wire]   Staleness sweep; --wire installs the Pages CI

${c.bold('Options')}
  --dir <path>          Target project root (default: cwd)
  --type <t>            commit: feat|fix|docs|refactor|test|perf|build|ci|chore|revert
  -m, --message <s>     commit: subject / PR title
  --task <id>           commit: Task trailer, a <story>-T<NN> id (else derived from the branch)
  --ai <id>             commit: co-author — claude|copilot|cursor|coderabbit|none (default none)
  --contract-change     commit/open-pr: mark the contract surface touched
  --risk <level>        open-pr: low|medium|high (default low)
  --repo <name>         open-pr: target a registered repo by name
  --base <branch>       open-pr: override the PR/MR base — default is the repo's own default
                        branch (repos.json default_branch, else hub.json default_branch for a PR
                        on the Product itself, else the platform, else origin/HEAD, else main); a
                        non-default base loses the AI first pass (warns, never blocks)
  --epic <id>           docs: target one epic's site (EP-<slug>)
  --overview            docs: target the project SDLC-overview site
  --check/--refresh/--wire   docs sync: report stale / rebuild / install Pages CI
  --dry-run             commit: print the message, do not commit
  --force               commit: bypass the atomic-file guard / re-copy unchanged files
  --branch <head>       gate ci: the review PR/MR head branch (review/EP-<slug>/<artifact>)
  --pr <n>              gate ci: the PR/MR number from the CI event
  --merged              gate ci: merge phase — advance the step on the default branch
  --no-push             gate ci: commit the ledger but do not push
  --push                check --fix / update: commit + push applied changes to the default branch
  --allow-branch        check --fix --push / update --push / repo refresh --push: allow committing on a non-default branch
  --overwrite-local     check --fix / update: replace managed files reported as 'modified'
                        (a <file>.yad-orig backup is written first)
  -h, --help            Show this help
  -v, --version         Print version

${c.bold('Environment')}
  YAD_NO_UPDATE_NOTIFIER=1   Silence the "update available" notice (also off in CI)
  YAD_NO_REPORT=1            Never offer to file a bug report after a failure
  YAD_PLATFORM_LOGIN=0       Name a record's author by git user.name; never ask gh/glab who is logged in`;

const VALUE_FLAGS = new Set(['--dir', '--type', '--message', '--task', '--ai', '--risk', '--repo', '--platform', '--base', '--title', '--scope', '--branch', '--pr', '--epic', '--team', '--body', '--out', '--since', '--until', '--member', '--format', '--reason', '--profile', '--parent', '--inherits', '--to', '--retro-ship', '--merge-commit', '--path', '--ide-targets']);

function parseArgs(argv) {
  const o = { _: [], dir: process.cwd(), fix: false, force: false, scope: 'all' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fix') o.fix = true;
    else if (a === '--force') o.force = true;
    else if (a === '--contract-change') o.contractChange = true;
    else if (a === '--no-push') o.noPush = true;
    else if (a === '--push') o.push = true;
    else if (a === '--allow-branch') o.allowBranch = true;
    else if (a === '--overwrite-local') o.overwriteLocal = true;
    else if (a === '--merged') o.merged = true;
    else if (a === '--overview') o.overview = true;
    // `--check` is a bare boolean for `docs sync --check`, but takes a value for
    // `next <epic> --check <step>`. Only the `next` command consumes the following token as a value —
    // scoping it to `next` keeps `docs sync --check overview` (and any other command) from swallowing a
    // positional. `o._[0]` is the command, already pushed by the time `--check` is seen in normal use.
    else if (a === '--check') { const v = argv[i + 1]; o.check = (o._[0] === 'next' && v !== undefined && !v.startsWith('-')) ? argv[++i] : true; }
    else if (a === '--all') o.all = true;
    else if (a === '--undo') o.undo = true;
    else if (a === '--debt') o.debt = true;
    else if (a === '--stub') o.stub = true;
    // setup profile flags (pre-answer the Step 0 interview, for CI/scripts)
    else if (a === '--solo') o.solo = true;
    else if (a === '--greenfield') o.greenfield = true;
    else if (a === '--brownfield') o.brownfield = true;
    else if (a === '--monorepo') o.monorepo = true;
    else if (a === '--separate') o.separate = true;
    else if (a === '--tools') o.tools = true;
    else if (a === '--refresh') o.refresh = true;
    else if (a === '--repos') o.repos = true;
    else if (a === '--wire') o.wire = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--apply') o.apply = true;
    // The roadmap and the release check spell the default `--preview`. Accepting it means a script can
    // say what it means rather than relying on the absence of a flag.
    else if (a === '--preview') o.apply = false;
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a.startsWith('--scope=')) o.scope = a.slice('--scope='.length);
    else if (a === '-m' || a === '--message') o.message = takeValue(argv, ++i, a);
    else if (VALUE_FLAGS.has(a)) o[a.replace(/^--/, '')] = takeValue(argv, ++i, a);
    // `--flag=value` for the same flags. Without it the token matched nothing and fell through to the
    // positionals, where it was silently ignored — and for `yad hook ledger-guard --format=cursor`
    // that is not a cosmetic miss: the format goes undefined, the exit protocol is selected, and under
    // Cursor an empty stdout on an allow BLOCKS every file write. A flag spelling that silently
    // inverts a guard is worth accepting rather than quietly dropping.
    else if (a.startsWith('--') && a.includes('=') && VALUE_FLAGS.has(a.slice(0, a.indexOf('=')))) {
      const eq = a.indexOf('=');
      const value = a.slice(eq + 1);
      if (!value) throw new Error(`${a.slice(0, eq)} expects a value`);
      o[a.slice(2, eq)] = value;
    } else o._.push(a);
  }
  return o;
}

// A value flag must be followed by a token; erroring beats silently passing `undefined` downstream.
function takeValue(argv, i, flag) {
  const v = argv[i];
  if (v === undefined || v.startsWith('-')) throw new Error(`${flag} expects a value`);
  return v;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const cmd = o._[0];
  if (o.version) return log(VERSION);

  // THE HOT PATH, handled before anything heavy is loaded. `yad hook ledger-guard` runs inside the
  // agent's tool loop on every file-editing call, and it needs `cli/hook.mjs` alone. Everything else
  // lives behind the single dynamic import below, so the hook no longer pays for 29 modules it does
  // not use — measured at ~30ms of module loading against ~14ms for what it actually needs.
  //
  // It sits above the help and the newer-shape warning deliberately: `--help` is not a hook call, and
  // the warning is already excluded for `hook` below because its stderr is the channel a block reason
  // reaches the model on.
  if (cmd === 'hook') {
    const [, action] = o._;
    if (action !== 'ledger-guard') {
      log(c.red(`unknown hook: ${action ?? '(none)'} (ledger-guard)`));
      process.exitCode = 1;
      return;
    }
    runLedgerGuardHook({ paths: o.path ? [o.path] : [], format: o.format });
    return;
  }

  // Every other command. One await, once, for a process that is about to do real work anyway.
  const commands = await import('./commands.mjs');
  if (o.help || !cmd) return log(helpText(commands.seedableProfiles()));
  // A project written by a newer yadflow is warned about before any command reads it (docs/migrations/
  // shape-8.md). Not on `hook` — its stderr is the channel a block reason reaches a model on — and not
  // where the command reports the same thing itself (doctor, migrate) or runs before a project exists.
  if (!['hook', 'doctor', 'migrate', 'setup', 'report'].includes(cmd)) commands.warnIfProjectAhead(o.dir || process.cwd());

  const today = new Date().toISOString().slice(0, 10);
  switch (cmd) {
    case 'setup':
      await commands.runSetup(o.dir, {
        today, force: o.force,
        solo: o.solo, team: o.team, greenfield: o.greenfield, brownfield: o.brownfield,
        monorepo: o.monorepo, separate: o.separate, tools: o.tools,
        // The agent directories to install into, as a pre-answer for CI/scripts exactly like `--solo`
        // above (E11). Until this flag existed, `ideTargets` was reachable only programmatically: a
        // non-interactive run took `ask`'s default and had NO way to choose. That was survivable while
        // the default was one directory; it stopped being survivable when the default became two,
        // because a scripted setup would write a second full copy of the skills with no way to say no.
        // `o['ide-targets']`, not `o.ideTargets`: VALUE_FLAGS strips the leading `--` and nothing else,
        // so a hyphenated flag keeps its hyphen as the key (`--retro-ship` is read the same way below).
        ideTargets: o['ide-targets'] === undefined ? undefined : String(o['ide-targets']).split(',').map((t) => t.trim()).filter(Boolean),
      });
      break;
    case 'check':
      await commands.reconcile(o.dir, { fix: o.fix, scope: o.scope, force: o.force, push: o.push, allowBranch: o.allowBranch, overwriteLocal: o.overwriteLocal, today });
      break;
    case 'update':
      await commands.reconcile(o.dir, { fix: true, scope: 'changed', force: o.force, push: o.push, allowBranch: o.allowBranch, overwriteLocal: o.overwriteLocal, today });
      break;
    case 'doctor':
      await commands.runDoctor(o.dir, { json: o.json });
      break;
    case 'migrate':
      await commands.runMigrate(o.dir, { apply: o.apply, json: o.json });
      break;
    case 'report':
      await commands.runReport(o.dir, { message: o.message });
      break;
    case 'usage':
      commands.runUsage(o.dir, {
        out: o.out, since: o.since, until: o.until, all: o.all, member: o.member,
        format: o.format, repos: o.repos, json: o.json, today,
      });
      break;
    case 'sync-status': {
      const [, epic] = o._;
      if (epic && !commands.isValidEpicId(epic)) { log(c.red(`invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      await commands.syncStatuses(o.dir, { epic, dryRun: o.dryRun });
      break;
    }
    case 'epic': {
      const [, action, slug, ...extra] = o._;
      // A stray word is refused rather than dropped: `--inherits epic architecture` takes only `epic` as
      // the value, and silently seeding without `architecture` would carry less than the author asked.
      if (action === 'new' && extra.length) {
        log(c.red(`unexpected argument(s): ${extra.join(' ')} — a list takes commas, e.g. --inherits epic,architecture`));
        process.exitCode = 1; break;
      }
      if (action !== 'new') {
        log(c.red(`unknown epic action: ${action ?? '(none)'} (new)`));
        log(`usage: yad epic new <slug> [--type feature|chore|change|defect|hotfix] [--profile ${commands.seedableProfiles().join('|')}] [--parent EP-<slug> --inherits <bases>]`);
        process.exitCode = 1; break;
      }
      await commands.runEpicNew(o.dir, { slug, type: o.type, profile: o.profile, stub: o.stub, parent: o.parent, inherits: o.inherits, today, json: o.json });
      break;
    }
    case 'foundation': {
      const [, action] = o._;
      if (action === 'status') { await commands.runFoundationStatus(o.dir, { json: o.json }); break; }
      if (action !== 'new') {
        log(c.red(`unknown foundation action: ${action ?? '(none)'} (new, status)`));
        log('usage: yad foundation new [--json] | yad foundation status [--json]');
        process.exitCode = 1; break;
      }
      await commands.runFoundationNew(o.dir, { today, json: o.json });
      break;
    }
    case 'skill': {
      const [, action, step, ...rest] = o._;
      if (action === 'list' || action === undefined) { commands.runSkillList(o.dir, { json: o.json }); break; }
      if (action === 'bind') { commands.runSkillBind(o.dir, { step, skills: rest }); break; }
      if (action === 'unbind') { commands.runSkillUnbind(o.dir, { step }); break; }
      log(c.red(`unknown skill action: ${action} (list, bind, unbind)`));
      log('usage: yad skill list [--json] | yad skill bind <step> <skill> [<skill> ...] | yad skill unbind <step>');
      process.exitCode = 1;
      break;
    }
    case 'next': {
      const [, epic] = o._;
      // `--check` with no step is a malformed guard call — fail loudly rather than silently print.
      if (o.check === true) { log(c.red('usage: yad next <epic> --check <step>')); process.exitCode = 1; break; }
      await commands.runNext(o.dir, { epic, check: typeof o.check === 'string' ? o.check : undefined, all: o.all, json: o.json });
      break;
    }
    case 'skip':
    case 'unskip':
    case 'defer':
    case 'undefer': {
      const [verb, epic, step] = o._;
      if (!epic || !commands.isValidEpicId(epic)) { log(c.red(`invalid or missing epic id: ${epic ?? '(none)'} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      // A STORY id where the step goes names a whole Build lane (E39), with --repo naming the repo. No Shape
      // step id ends in -S<n>, so the two never overlap. A lane is skipped, never deferred.
      if (step && /-S\d+$/i.test(step)) {
        if (verb === 'defer' || verb === 'undefer') {
          log(c.red(`a Build lane is skipped whole, never deferred: yad skip ${epic} ${step} --repo <name> --reason "<why>"`));
          process.exitCode = 1; break;
        }
        if (o.debt) log(c.yellow('--debt is not used on a Build lane: a lane is skipped whole, never owed back'));
        await commands.runLaneSkip(o.dir, { epic, story: step, repo: o.repo, reason: o.reason, undo: verb === 'unskip' || o.undo, today });
        break;
      }
      if (o.repo) log(c.yellow(`--repo is only for a Build lane (yad ${verb} ${epic} <story> --repo <name>) — ignored for a Shape step`));
      // `unskip` / `undefer` are the verbs E36 / E37 named; `--undo` is the spelling that shipped first and stays.
      const runVerb = verb === 'defer' || verb === 'undefer' ? commands.runDefer : commands.runSkip;
      await runVerb(o.dir, { epic, step, reason: o.reason, debt: o.debt, undo: verb.startsWith('un') || o.undo, today });
      break;
    }
    case 'dial': {
      // One word names a Shape author step (project-wide). Three name a Build lane step: epic, story, step.
      const args = o._.slice(1);
      if (args.length === 1) {
        await commands.runDial(o.dir, { step: args[0], to: o.to, json: o.json });
      } else if (args.length === 3) {
        if (!commands.isValidEpicId(args[0])) { log(c.red(`invalid epic id: ${args[0]} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
        await commands.runDial(o.dir, { epic: args[0], story: args[1], step: args[2], repo: o.repo, to: o.to, json: o.json });
      } else {
        log(c.red('usage: yad dial <step> [--to auto|human]   |   yad dial <epic> <story> --repo <name> <step> [--to auto|human]'));
        process.exitCode = 1;
      }
      break;
    }
    case 'mode': {
      if (o._.length > 2) { log(c.red(`unexpected argument(s): ${o._.slice(2).join(' ')}`)); process.exitCode = 1; break; }
      await commands.runMode(o.dir, { to: o._[1] ?? null, reason: o.reason, json: o.json, today });
      break;
    }
    case 'kill':
    case 'unkill': {
      if (o._.length > 1) { log(c.red(`unexpected argument(s): ${o._.slice(1).join(' ')}`)); process.exitCode = 1; break; }
      await commands.runKill(o.dir, { on: o._[0] === 'kill', reason: o.reason, json: o.json, today });
      break;
    }
    case 'unblock': {
      const [, epic, step] = o._;
      if (!epic || !commands.isValidEpicId(epic)) { log(c.red(`invalid or missing epic id: ${epic ?? '(none)'} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      await commands.runUnblock(o.dir, { epic, step });
      break;
    }
    case 'gate': {
      const [, action, epic, artifact] = o._;
      // `gate ci` takes no positionals — epic/artifact come from --branch (or a sweep of all PRs).
      if (action === 'ci') { await commands.gateCi(o.dir, { branch: o.branch, pr: o.pr, merged: o.merged, push: !o.noPush, today }); break; }
      if (!epic) { log(c.red('usage: yad gate <open|sync|comments|status|repair|review|walkthrough|trailer|ci> <epic> [artifact]')); process.exitCode = 1; break; }
      // The epic id becomes a path segment under epics/ — reject anything but EP-<slug> outright.
      if (!commands.isValidEpicId(epic)) { log(c.red(`invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      // In verified mode CI is the sole ledger writer: `open` only opens the PR, and local `sync` is
      // advisory (reads the platform, prints status, writes nothing). The artifact status flip is
      // CI's job at merge — never wired into the local gate. Local mode keeps local writes.
      if (action === 'open') await commands.gateOpen(o.dir, { epic, artifact, today });
      else if (action === 'sync') await commands.gateSync(o.dir, { epic, artifact, today, number: o.pr, local: true });
      else if (action === 'comments') await commands.gateComments(o.dir, { epic, artifact, today });
      else if (action === 'status') await commands.gateStatus(o.dir, { epic });
      else if (action === 'repair') await commands.gateRepair(o.dir, { epic, push: o.push, allowBranch: o.allowBranch, dryRun: o.dryRun, today });
      else if (action === 'review') await commands.gateReview(o.dir, { epic, artifact });
      else if (action === 'walkthrough') await commands.gateWalkthrough(o.dir, { epic, artifact });
      else if (action === 'trailer') await commands.gateTrailer(o.dir, { epic, artifact, body: o.body || o.message, number: o.pr });
      else { log(c.red(`unknown gate action: ${action} (open|sync|comments|status|repair|review|walkthrough|trailer|ci)`)); process.exitCode = 1; }
      break;
    }
    case 'review': {
      const [, action] = o._;
      if (action === 'trailer') await commands.reviewTrailer(o.dir, { repo: o.repo, pr: o.pr, body: o.body || o.message });
      else if (action === 'context' || action === 'chat' || action === 'cards') await commands.reviewContext(o.dir, { repo: o.repo, pr: o.pr });
      else if (action === 'walkthrough') await commands.reviewWalkthrough(o.dir, { repo: o.repo, pr: o.pr });
      else if (action === 'nudge') await commands.reviewNudge(o.dir, { repo: o.repo, pr: o.pr });
      else if (action === 'reconcile') {
        // The epic becomes a path segment under epics/ — reject anything but EP-<slug> (no `../` escape).
        if (!o.epic || !commands.isValidEpicId(o.epic)) { log(c.red(`invalid or missing --epic: ${o.epic ?? '(none)'} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
        await commands.reviewReconcile(o.dir, { epic: o.epic, repo: o.repo, pr: o.pr });
      }
      else { log(c.red('usage: yad review <trailer|context|walkthrough|nudge|reconcile> --repo <name> --pr <n> [--epic <id>] [--body <text>]')); process.exitCode = 1; }
      break;
    }
    case 'commit':
      await commands.runCommit(o.dir, { type: o.type, message: o.message, task: o.task, ai: o.ai, contractChange: o.contractChange, dryRun: o.dryRun, force: o.force });
      break;
    case 'open-pr':
      await commands.runOpenPr(o.dir, { repo: o.repo, platform: o.platform, base: o.base, title: o.title || o.message, task: o.task, risk: o.risk, contractChange: o.contractChange });
      break;
    case 'ship':
      await commands.runShip(o.dir, { type: o.type, message: o.message, task: o.task, ai: o.ai, contractChange: o.contractChange, dryRun: o.dryRun, force: o.force, repo: o.repo, platform: o.platform, base: o.base, title: o.title, risk: o.risk });
      break;
    case 'checkpoint': {
      let retroShip;
      if (o['retro-ship']) {
        const [epic, story] = String(o['retro-ship']).split('/');
        if (!epic || !commands.isValidEpicId(epic)) { log(c.red(`invalid --retro-ship: expected <epic>/<story> with epic EP-<slug> (got ${o['retro-ship']})`)); process.exitCode = 1; break; }
        // The story id becomes a path element (stories/<story>.md) — pin it to the id shape (and to its
        // own epic) so a `..` or a slash can never traverse out of the epic's stories dir, and a typo'd
        // cross-epic id is caught here rather than failing obscurely later.
        if (!story || !/^EP-[a-z0-9-]+-S\d+$/.test(story) || !story.startsWith(`${epic}-S`)) { log(c.red(`invalid --retro-ship: expected <epic>/<story> with story <epic>-S<NN> (got ${o['retro-ship']})`)); process.exitCode = 1; break; }
        retroShip = { epic, story, repo: o.repo, task: o.task, mergeCommit: o['merge-commit'], today };
      }
      await commands.runCheckpoint(o.dir, { push: o.push, allowBranch: o.allowBranch, dryRun: o.dryRun, retroShip });
      break;
    }
    case 'tidy': {
      const [, action, epic] = o._;
      if (action !== 'up') { log(`usage: yad tidy up [<epic>] [--push] [--dry-run]`); process.exitCode = action ? 1 : 0; break; }
      await commands.runTidy(o.dir, { epic: epic || o.epic, push: o.push, allowBranch: o.allowBranch, dryRun: o.dryRun });
      break;
    }
    case 'repo': {
      const [, action, name] = o._;
      await commands.runRepo(o.dir, { action: action || 'list', name, today, push: o.push, allowBranch: o.allowBranch });
      break;
    }
    case 'risk-map': {
      const [, action, name] = o._;
      await commands.runRiskMap(o.dir, { action: action || 'check', name, json: o.json, dryRun: o.dryRun });
      break;
    }
    case 'codeowners': {
      const [, action, name] = o._;
      // `--write` was dropped (E69); wherever it is typed, it is refused with the reason — never ignored.
      await commands.runCodeowners(o.dir, { action: action || 'check', name, json: o.json, platform: o.platform, write: o._.includes('--write') });
      break;
    }
    case 'roster':
      // Removed in E62. Kept as a word for one major so a script or a habit gets told where it went
      // instead of "unknown command".
      log(c.red('yad roster was removed — yadflow keeps no list of people'));
      log('  A gate needs one approval (not the author\'s own) from anyone with access to the repo; the platform records who approved.');
      log('  Request reviewers on the PR itself. Keep an existing `roster` in hub.json until every review with older approvals is closed:');
      log('  it decides nothing, but the first sync uses its name → login pairs to recognise those approvals.');
      process.exitCode = 1;
      break;
    case 'docs': {
      const [, action] = o._;
      if (o.epic && !commands.isValidEpicId(o.epic)) { log(c.red(`invalid epic id: ${o.epic} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      const sync = o.wire ? 'wire' : o.refresh ? 'refresh' : 'check';
      await commands.runDocs(o.dir, { action: action || 'list', epic: o.epic, overview: o.overview, sync, today });
      break;
    }
    case 'thread': {
      const [, epic] = o._;
      if (epic && !commands.isValidEpicId(epic)) { log(c.red(`invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      await commands.runThread(o.dir, { epic, json: o.json });
      break;
    }
    case 'reconcile': {
      const [, action] = o._;
      const thread = o.epic || o.thread || null;
      if (thread && !commands.isValidEpicId(thread)) { log(c.red(`invalid epic id: ${thread} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      const act = action || (o.wire ? 'wire' : o.refresh ? 'refresh' : 'check');
      if (!['check', 'refresh', 'wire'].includes(act)) {
        log(c.red(`unknown reconcile action: ${act} (check|refresh|wire)`)); process.exitCode = 1; break;
      }
      await commands.runReconcile(o.dir, { action: act, thread });
      break;
    }
    default:
      log(c.red(`unknown command: ${cmd}`));
      log(helpText(commands.seedableProfiles()));
      process.exitCode = 1;
  }
}

main()
  .catch(async (err) => {
    const code = err?.code && /^YAD-/.test(err.code) ? ` [${err.code}]` : '';
    log(c.red(`\nyad failed${code}: ${err?.message || err}`));
    if (err?.hint) log(c.yellow(`  → ${err.hint}`));
    if (code) log(c.dim('  (see README "Troubleshooting" for this code, or run `yad doctor`)'));
    process.exitCode = 1;
    // Offer to report the failure — but only interactively (never in CI), and opt-out via
    // YAD_NO_REPORT. `report` failing on its own would land here, so never re-offer for it.
    // Require a TTY on BOTH ends: stdout for the message, stdin so the y/N prompt can be answered
    // (a TTY stdout with piped/closed stdin would otherwise hang on readline).
    const offerReport = process.stdin.isTTY && process.stdout.isTTY && !process.env.SDLC_NONINTERACTIVE
      && !process.env.YAD_NO_REPORT && process.argv[2] !== 'report';
    if (offerReport) {
      try {
        if (await askYesNo('\nReport this failure to the yadflow team?', false)) {
          const { runReport } = await import('./commands.mjs');
          await runReport(process.cwd(), { error: err });
        }
      } catch { /* reporting is best-effort — never mask the original failure */ }
    }
  })
  // Runs for every command, success or failure, after any report prompt. Prints to stderr and never
  // touches process.exitCode, so a command's stdout contract and exit status are unaffected.
  // The try/finally is load-bearing, not defensive noise: a rejection here would escape as an
  // unhandled rejection (exit 1 on an otherwise successful command) AND skip closePrompts(), leaving
  // the readline handle open so the process never exits.
  .finally(async () => {
    try {
      // Never on `yad hook`: it runs on every agent tool call, and its stderr is the channel the
      // block reason travels on — an update banner there would land in front of a model.
      // Resolved the way main() resolves it, NOT from argv[2]: that is the first raw argument, so
      // `yad --dir <path> hook ledger-guard` puts `--dir` there and the banner slips through.
      if (parseArgs(process.argv.slice(2))._[0] !== 'hook') {
        const { maybeNotifyUpdate } = await import('./commands.mjs');
        await maybeNotifyUpdate();
      }
    } catch { /* the notice is never worth failing or hanging a command over */ } finally {
      closePrompts();
    }
  });
