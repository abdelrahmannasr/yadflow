#!/usr/bin/env node
// `yad` — setup/maintenance + the PR-driven review gate + build helpers for the SDLC module.
import { VERSION } from '../cli/manifest.mjs';
import { c, log, closePrompts } from '../cli/lib.mjs';
import { runSetup } from '../cli/setup.mjs';
import { reconcile } from '../cli/reconcile.mjs';
import { gateOpen, gateSync, gateComments, gateStatus, gateCi, gateReview, gateTrailer } from '../cli/gate.mjs';
import { isValidEpicId } from '../cli/epic-state.mjs';
import { runCommit } from '../cli/commit.mjs';
import { runOpenPr } from '../cli/openpr.mjs';
import { reviewTrailer, reviewContext, reviewNudge, reviewReconcile } from '../cli/review.mjs';
import { runShip } from '../cli/ship.mjs';
import { runRepo } from '../cli/repo.mjs';
import { runRoster } from '../cli/roster.mjs';
import { runDocs } from '../cli/docs.mjs';
import { runDoctor } from '../cli/doctor.mjs';
import { runNext } from '../cli/next.mjs';
import { syncStatuses } from '../cli/artifact-status.mjs';
import { runThread, runReconcile } from '../cli/thread.mjs';

const HELP = `${c.bold('yad')} — setup, review-gate & build helpers for the SDLC Workflow module  ${c.dim('v' + VERSION)}

${c.bold('Setup & maintenance')}
  yad setup            Guided first-run setup (profile interview, install, connect & wire repos)
                       profile flags: --solo | --team <n>, --greenfield | --brownfield,
                       --monorepo | --separate, --tools (configure design/testing/learning now)
  yad check            Report what is missing / drifted / stale / legacy (read-only)
  yad check --fix      Reconcile: fill what is missing, update what changed
  yad update           Apply drift only (alias for: check --fix --scope=changed);
                       also migrates pre-2.0 sdlc-* installs to the yad-* names
  yad doctor [--json]  Environment + state health: tools/auth, config files,
                       repo paths, epic ledgers (exit 1 on any failure)
  yad sync-status [epic]   Update artifact frontmatter status (draft/in-review/approved)
                       from .sdlc/state.json — all epics if omitted (--dry-run to preview)

${c.bold('Reviewer roster')}
  yad roster list                      Show every member + their roles per scope (hub + each repo)
  yad roster add <login>               Add/edit a member, then walk the connected repos for their roles
                                       (--name, --email, --roles "hub=owner,reviewer backend=domain-owner")
  yad roster grant <name> <repo> <role...>   Grant role(s) for a connected repo (domain-owner|reviewer|owner)
  yad roster revoke <name> <repo> <role...>  Remove role(s) for a repo
  yad roster remove <login>            Delete a member from the roster

${c.bold('Where am I / what next')}
  yad next                             Project-wide: the one next action to take (or run setup)
  yad next <epic>                      The single next action for one epic (skill or yad command)
  yad next <epic> --check <step>       Exit 0 if <step> is runnable now, else 1 (precondition guard)
  yad next --all                       Every active epic's next action at once

${c.bold('Review gate (front half)')}
  yad gate open <epic> <artifact>      Open the review PR/MR; mark the step in_review
  yad gate sync <epic> [artifact]      Pull PR state -> ledger; advance on approved+resolved+merged
  yad gate comments <epic> [artifact]  Fetch unresolved review comments to address
  yad gate status <epic>               Show each review step + approvals
  yad gate review <epic> [artifact]    Print the grounding bundle for the review companion
                                       (artifact + risk + contract + PR + code-maps) — fun, easy review
  yad gate trailer <epic> [artifact] --body <text> [--pr <n>]
                                       Upsert the companion's 60-sec briefing into the PR/MR description
  yad gate ci [--branch <head>] [--pr <n>] [--merged]
                        CI entry (hub workflow): pre-merge is read-only (nothing pushed);
                        --merged advances the step + flips artifact status on the default branch

${c.bold('Build helpers')}
  yad commit --type <t> -m <subject>   Commit by convention (trailers, atomic guard)
  yad open-pr [--repo <name>]          Open a task PR/MR — stage-aware on the hub: a review/EP-*
                                       branch opens the front-half artifact-review PR (delegates to
                                       gate open), any other hub branch uses the code-task template
  yad ship --type <t> -m <subject>     Commit AND open the task PR/MR in one step (stage-aware)
  yad review trailer --repo <r> --pr <n> --body <text>   Post the companion's 60-sec briefing to a code PR/MR
  yad review context --repo <r> --pr <n>                  Print the grounding bundle for cards/chat
  yad review nudge --repo <r> --pr <n>                    Friendly @-mention on a bare code-PR approve
  yad review reconcile --epic <id> --repo <r> --pr <n>    Bridge: stamp engagement onto the build-log ship
  yad repo list                        Show connected repos (fresh / stale)
  yad repo refresh [name]              Re-pack a stale repo (a human decision)

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
  --task <id>           commit: Task trailer (else derived from the branch)
  --ai <id>             commit: co-author — claude|copilot|cursor|coderabbit|none (default none)
  --contract-change     commit/open-pr: mark the contract surface touched
  --risk <level>        open-pr: low|medium|high (default low)
  --repo <name>         open-pr: target a registered repo by name
  --epic <id>           docs: target one epic's site (EP-<slug>)
  --overview            docs: target the project SDLC-overview site
  --check/--refresh/--wire   docs sync: report stale / rebuild / install Pages CI
  --dry-run             commit: print the message, do not commit
  --force               commit: bypass the atomic-file guard / re-copy unchanged files
  --branch <head>       gate ci: the review PR/MR head branch (review/EP-<slug>/<artifact>)
  --pr <n>              gate ci: the PR/MR number from the CI event
  --merged              gate ci: merge phase — advance the step on the default branch
  --no-push             gate ci: commit the ledger but do not push
  -h, --help            Show this help
  -v, --version         Print version`;

const VALUE_FLAGS = new Set(['--dir', '--type', '--message', '--task', '--ai', '--risk', '--repo', '--platform', '--base', '--title', '--scope', '--branch', '--pr', '--epic', '--name', '--email', '--roles', '--team', '--body']);

function parseArgs(argv) {
  const o = { _: [], dir: process.cwd(), fix: false, force: false, scope: 'all' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fix') o.fix = true;
    else if (a === '--force') o.force = true;
    else if (a === '--contract-change') o.contractChange = true;
    else if (a === '--no-push') o.noPush = true;
    else if (a === '--merged') o.merged = true;
    else if (a === '--overview') o.overview = true;
    // `--check` is a bare boolean for `docs sync --check`, but takes a value for
    // `next <epic> --check <step>`. Only the `next` command consumes the following token as a value —
    // scoping it to `next` keeps `docs sync --check overview` (and any other command) from swallowing a
    // positional. `o._[0]` is the command, already pushed by the time `--check` is seen in normal use.
    else if (a === '--check') { const v = argv[i + 1]; o.check = (o._[0] === 'next' && v !== undefined && !v.startsWith('-')) ? argv[++i] : true; }
    else if (a === '--all') o.all = true;
    // setup profile flags (pre-answer the Step 0 interview, for CI/scripts)
    else if (a === '--solo') o.solo = true;
    else if (a === '--greenfield') o.greenfield = true;
    else if (a === '--brownfield') o.brownfield = true;
    else if (a === '--monorepo') o.monorepo = true;
    else if (a === '--separate') o.separate = true;
    else if (a === '--tools') o.tools = true;
    else if (a === '--refresh') o.refresh = true;
    else if (a === '--wire') o.wire = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a.startsWith('--scope=')) o.scope = a.slice('--scope='.length);
    else if (a === '-m' || a === '--message') o.message = takeValue(argv, ++i, a);
    else if (VALUE_FLAGS.has(a)) o[a.replace(/^--/, '')] = takeValue(argv, ++i, a);
    else o._.push(a);
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
  if (o.help || !cmd) return log(HELP);

  const today = new Date().toISOString().slice(0, 10);
  switch (cmd) {
    case 'setup':
      await runSetup(o.dir, {
        today, force: o.force,
        solo: o.solo, team: o.team, greenfield: o.greenfield, brownfield: o.brownfield,
        monorepo: o.monorepo, separate: o.separate, tools: o.tools,
      });
      break;
    case 'check':
      await reconcile(o.dir, { fix: o.fix, scope: o.scope, force: o.force, today });
      break;
    case 'update':
      await reconcile(o.dir, { fix: true, scope: 'changed', force: o.force, today });
      break;
    case 'doctor':
      await runDoctor(o.dir, { json: o.json });
      break;
    case 'sync-status': {
      const [, epic] = o._;
      if (epic && !isValidEpicId(epic)) { log(c.red(`invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      await syncStatuses(o.dir, { epic, dryRun: o.dryRun });
      break;
    }
    case 'next': {
      const [, epic] = o._;
      // `--check` with no step is a malformed guard call — fail loudly rather than silently print.
      if (o.check === true) { log(c.red('usage: yad next <epic> --check <step>')); process.exitCode = 1; break; }
      await runNext(o.dir, { epic, check: typeof o.check === 'string' ? o.check : undefined, all: o.all });
      break;
    }
    case 'gate': {
      const [, action, epic, artifact] = o._;
      // `gate ci` takes no positionals — epic/artifact come from --branch (or a sweep of all PRs).
      if (action === 'ci') { await gateCi(o.dir, { branch: o.branch, pr: o.pr, merged: o.merged, push: !o.noPush, today }); break; }
      if (!epic) { log(c.red('usage: yad gate <open|sync|comments|status|review|trailer|ci> <epic> [artifact]')); process.exitCode = 1; break; }
      // The epic id becomes a path segment under epics/ — reject anything but EP-<slug> outright.
      if (!isValidEpicId(epic)) { log(c.red(`invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      // In bridge mode CI is the sole ledger writer: `open` only opens the PR, and local `sync` is
      // advisory (reads the platform, prints status, writes nothing). The artifact status flip is
      // CI's job at merge — never wired into the local gate. File-only mode keeps local writes.
      if (action === 'open') await gateOpen(o.dir, { epic, artifact });
      else if (action === 'sync') await gateSync(o.dir, { epic, artifact, today, local: true });
      else if (action === 'comments') await gateComments(o.dir, { epic, artifact, today });
      else if (action === 'status') await gateStatus(o.dir, { epic });
      else if (action === 'review') await gateReview(o.dir, { epic, artifact });
      else if (action === 'trailer') await gateTrailer(o.dir, { epic, artifact, body: o.body || o.message, number: o.pr });
      else { log(c.red(`unknown gate action: ${action} (open|sync|comments|status|review|trailer|ci)`)); process.exitCode = 1; }
      break;
    }
    case 'review': {
      const [, action] = o._;
      if (action === 'trailer') await reviewTrailer(o.dir, { repo: o.repo, pr: o.pr, body: o.body || o.message });
      else if (action === 'context' || action === 'chat' || action === 'cards') await reviewContext(o.dir, { repo: o.repo, pr: o.pr });
      else if (action === 'nudge') await reviewNudge(o.dir, { repo: o.repo, pr: o.pr });
      else if (action === 'reconcile') await reviewReconcile(o.dir, { epic: o.epic, repo: o.repo, pr: o.pr });
      else { log(c.red('usage: yad review <trailer|context|nudge|reconcile> --repo <name> --pr <n> [--epic <id>] [--body <text>]')); process.exitCode = 1; }
      break;
    }
    case 'commit':
      await runCommit(o.dir, { type: o.type, message: o.message, task: o.task, ai: o.ai, contractChange: o.contractChange, dryRun: o.dryRun, force: o.force });
      break;
    case 'open-pr':
      await runOpenPr(o.dir, { repo: o.repo, platform: o.platform, base: o.base, title: o.title || o.message, task: o.task, risk: o.risk, contractChange: o.contractChange });
      break;
    case 'ship':
      await runShip(o.dir, { type: o.type, message: o.message, task: o.task, ai: o.ai, contractChange: o.contractChange, dryRun: o.dryRun, force: o.force, repo: o.repo, platform: o.platform, base: o.base, title: o.title, risk: o.risk });
      break;
    case 'repo': {
      const [, action, name] = o._;
      await runRepo(o.dir, { action: action || 'list', name, today });
      break;
    }
    case 'roster': {
      const [, action, ...rest] = o._;
      await runRoster(o.dir, { action: action || 'list', args: rest, name: o.name, email: o.email, roles: o.roles, today });
      break;
    }
    case 'docs': {
      const [, action] = o._;
      if (o.epic && !isValidEpicId(o.epic)) { log(c.red(`invalid epic id: ${o.epic} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      const sync = o.wire ? 'wire' : o.refresh ? 'refresh' : 'check';
      await runDocs(o.dir, { action: action || 'list', epic: o.epic, overview: o.overview, sync, today });
      break;
    }
    case 'thread': {
      const [, epic] = o._;
      if (epic && !isValidEpicId(epic)) { log(c.red(`invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      await runThread(o.dir, { epic, json: o.json });
      break;
    }
    case 'reconcile': {
      const [, action] = o._;
      const thread = o.epic || o.thread || null;
      if (thread && !isValidEpicId(thread)) { log(c.red(`invalid epic id: ${thread} (expected EP-<slug>, [a-z0-9-] only)`)); process.exitCode = 1; break; }
      const act = action || (o.wire ? 'wire' : o.refresh ? 'refresh' : 'check');
      if (!['check', 'refresh', 'wire'].includes(act)) {
        log(c.red(`unknown reconcile action: ${act} (check|refresh|wire)`)); process.exitCode = 1; break;
      }
      await runReconcile(o.dir, { action: act, thread });
      break;
    }
    default:
      log(c.red(`unknown command: ${cmd}`));
      log(HELP);
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    const code = err?.code && /^YAD-/.test(err.code) ? ` [${err.code}]` : '';
    log(c.red(`\nyad failed${code}: ${err?.message || err}`));
    if (err?.hint) log(c.yellow(`  → ${err.hint}`));
    if (code) log(c.dim('  (see README "Troubleshooting" for this code, or run `yad doctor`)'));
    process.exitCode = 1;
  })
  .finally(closePrompts);
