#!/usr/bin/env node
// `sdlc` — setup/maintenance + the PR-driven review gate + build helpers for the SDLC module.
import { VERSION } from '../cli/manifest.mjs';
import { c, log, closePrompts } from '../cli/lib.mjs';
import { runSetup } from '../cli/setup.mjs';
import { reconcile } from '../cli/reconcile.mjs';
import { gateOpen, gateSync, gateComments, gateStatus, gateCi } from '../cli/gate.mjs';
import { runCommit } from '../cli/commit.mjs';
import { runOpenPr } from '../cli/openpr.mjs';
import { runRepo } from '../cli/repo.mjs';

const HELP = `${c.bold('sdlc')} — setup, review-gate & build helpers for the SDLC Workflow module  ${c.dim('v' + VERSION)}

${c.bold('Setup & maintenance')}
  sdlc setup            Guided first-run setup (install module, connect & wire repos)
  sdlc check            Report what is missing / drifted / stale (read-only)
  sdlc check --fix      Reconcile: fill what is missing, update what changed
  sdlc update           Apply drift only (alias for: check --fix --scope=changed)

${c.bold('Review gate (front half)')}
  sdlc gate open <epic> <artifact>      Open the review PR/MR; mark the step in_review
  sdlc gate sync <epic> [artifact]      Pull PR state -> ledger; advance on approved+resolved+merged
  sdlc gate comments <epic> [artifact]  Fetch unresolved review comments to address
  sdlc gate status <epic>               Show each review step + approvals
  sdlc gate ci [--branch <head>] [--pr <n>]
                        CI entry (hub workflow): derive epic/artifact from the review branch,
                        sync, commit the ledger to the default branch (sweep all PRs if no --branch)

${c.bold('Build helpers')}
  sdlc commit --type <t> -m <subject>   Commit by convention (trailers, atomic guard)
  sdlc open-pr [--repo <name>]          Open a code-repo task PR/MR from the template
  sdlc repo list                        Show connected repos (fresh / stale)
  sdlc repo refresh [name]              Re-pack a stale repo (a human decision)

${c.bold('Options')}
  --dir <path>          Target project root (default: cwd)
  --type <t>            commit: feat|fix|docs|refactor|test|perf|build|ci|chore|revert
  -m, --message <s>     commit: subject / PR title
  --task <id>           commit: Task trailer (else derived from the branch)
  --ai <id>             commit: co-author — claude|copilot|cursor|coderabbit|none (default none)
  --contract-change     commit/open-pr: mark the contract surface touched
  --risk <level>        open-pr: low|medium|high (default low)
  --repo <name>         open-pr: target a registered repo by name
  --dry-run             commit: print the message, do not commit
  --force               commit: bypass the atomic-file guard / re-copy unchanged files
  --branch <head>       gate ci: the review PR/MR head branch (review/EP-<slug>/<artifact>)
  --pr <n>              gate ci: the PR/MR number from the CI event
  --no-push             gate ci: commit the ledger but do not push
  -h, --help            Show this help
  -v, --version         Print version`;

const VALUE_FLAGS = new Set(['--dir', '--type', '--message', '--task', '--ai', '--risk', '--repo', '--platform', '--base', '--title', '--scope', '--branch', '--pr']);

function parseArgs(argv) {
  const o = { _: [], dir: process.cwd(), fix: false, force: false, scope: 'all' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fix') o.fix = true;
    else if (a === '--force') o.force = true;
    else if (a === '--contract-change') o.contractChange = true;
    else if (a === '--no-push') o.noPush = true;
    else if (a === '--dry-run') o.dryRun = true;
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
      await runSetup(o.dir, { today, force: o.force });
      break;
    case 'check':
      await reconcile(o.dir, { fix: o.fix, scope: o.scope, force: o.force, today });
      break;
    case 'update':
      await reconcile(o.dir, { fix: true, scope: 'changed', force: o.force, today });
      break;
    case 'gate': {
      const [, action, epic, artifact] = o._;
      // `gate ci` takes no positionals — epic/artifact come from --branch (or a sweep of all PRs).
      if (action === 'ci') { await gateCi(o.dir, { branch: o.branch, pr: o.pr, push: !o.noPush, today }); break; }
      if (!epic) { log(c.red('usage: sdlc gate <open|sync|comments|status|ci> <epic> [artifact]')); process.exitCode = 1; break; }
      if (action === 'open') await gateOpen(o.dir, { epic, artifact, today });
      else if (action === 'sync') await gateSync(o.dir, { epic, artifact, today });
      else if (action === 'comments') await gateComments(o.dir, { epic, artifact, today });
      else if (action === 'status') await gateStatus(o.dir, { epic });
      else { log(c.red(`unknown gate action: ${action} (open|sync|comments|status|ci)`)); process.exitCode = 1; }
      break;
    }
    case 'commit':
      await runCommit(o.dir, { type: o.type, message: o.message, task: o.task, ai: o.ai, contractChange: o.contractChange, dryRun: o.dryRun, force: o.force });
      break;
    case 'open-pr':
      await runOpenPr(o.dir, { repo: o.repo, platform: o.platform, base: o.base, title: o.title || o.message, task: o.task, risk: o.risk, contractChange: o.contractChange });
      break;
    case 'repo': {
      const [, action, name] = o._;
      await runRepo(o.dir, { action: action || 'list', name, today });
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
    log(c.red(`\nsdlc failed: ${err?.message || err}`));
    process.exitCode = 1;
  })
  .finally(closePrompts);
