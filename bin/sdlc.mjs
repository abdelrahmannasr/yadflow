#!/usr/bin/env node
// `sdlc` — setup / update / check CLI for the SDLC Workflow module.
import { VERSION } from '../cli/manifest.mjs';
import { c, log, closePrompts } from '../cli/lib.mjs';
import { runSetup } from '../cli/setup.mjs';
import { reconcile } from '../cli/reconcile.mjs';

const HELP = `${c.bold('sdlc')} — setup & maintenance for the SDLC Workflow module  ${c.dim('v' + VERSION)}

${c.bold('Usage')}
  sdlc setup            Guided first-run setup (install module, connect & wire repos)
  sdlc check            Report what is missing / drifted / stale (read-only)
  sdlc check --fix      Reconcile: fill what is missing, update what changed
  sdlc update           Apply drift only (alias for: check --fix --scope=changed)

${c.bold('Options')}
  --dir <path>          Target project root (default: cwd)
  --force               Re-copy even unchanged files
  -h, --help            Show this help
  -v, --version         Print version`;

function parseArgs(argv) {
  const o = { _: [], dir: process.cwd(), fix: false, force: false, scope: 'all' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') o.dir = argv[++i];
    else if (a === '--fix') o.fix = true;
    else if (a === '--force') o.force = true;
    else if (a.startsWith('--scope=')) o.scope = a.slice('--scope='.length);
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else o._.push(a);
  }
  return o;
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
