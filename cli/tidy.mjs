// `yad tidy up` — fold FINISHED back-half shards back into their single folded ledger, on demand.
//
// The two logs are shard-then-fold (cli/ledger.mjs): writers drop one loose file per entry so
// concurrent writers never conflict. Left alone they accumulate; `yad tidy up` is the "pack it up"
// step (git's loose-objects → `git gc`). It is a MANUAL, human-run act, so only one person folds at a
// time — the fold is a rewrite (worse to conflict on than an append), and doing it deliberately keeps
// it serialized. It folds ONLY shards of a SHIPPED story (terminal, no more writes coming), never an
// in-progress one, so it can't race an active writer. Idempotent: nothing finished → no-op.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, info, fail, hand, exists, pushWithRebase } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { loadHub } from './gate.mjs';
import { resolveCommitterLogin } from './platform.mjs';
import { checkpointAuthor } from './checkpoint.mjs';
import { hubGit, resolveDefaultBranch, guardDefaultBranch } from './hubcommit.mjs';
import { foldTrust, foldBuild } from './ledger.mjs';
import { epicRoot, isValidEpicId, readFrontmatter } from './epic-state.mjs';

// Story ids in an epic whose frontmatter `status` is `shipped` — the terminal, safe-to-fold signal
// (`yad-engineer-review` sets it once every task in the story has a ship record).
export function shippedStories(root, epic) {
  const dir = path.join(epicRoot(root, epic), 'stories');
  const set = new Set();
  if (!exists(dir)) return set;
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    if (readFrontmatter(path.join(dir, name)).status === 'shipped') set.add(name.replace(/\.md$/, ''));
  }
  return set;
}

function epicsWithLedgers(root) {
  const dir = path.join(root, 'epics');
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidEpicId(e.name)).map((e) => e.name).sort();
}

export async function runTidy(root, opts = {}) {
  log(c.bold('\nyad tidy up'));
  if (!exists(path.join(root, '.git'))) { fail('not a git repo'); process.exitCode = 1; return; }
  if (!exists(path.join(root, PROJECT_FILES.hubConfig))) {
    fail('no .sdlc/hub.json — run `yad tidy up` from the product hub');
    process.exitCode = 1;
    return;
  }

  const { hub } = loadHub(root);
  const git = hubGit(root);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  const defaultBranch = resolveDefaultBranch(git, hub);
  if (!guardDefaultBranch(branch, defaultBranch, { allowBranch: opts.allowBranch, cmd: 'yad tidy up' })) return;

  if (opts.epic && !isValidEpicId(opts.epic)) { fail(`invalid epic id '${opts.epic}'`); process.exitCode = 1; return; }
  if (opts.epic && !exists(epicRoot(root, opts.epic))) { fail(`no such epic '${opts.epic}'`); process.exitCode = 1; return; }
  const epics = opts.epic ? [opts.epic] : epicsWithLedgers(root);
  const touched = [];
  let folded = 0;
  for (const epic of epics) {
    const shipped = shippedStories(root, epic);
    const pick = (e) => shipped.has(e.story); // only a shipped story's shards are safe to fold
    const epicDir = epicRoot(root, epic);
    const t = foldTrust(epicDir, pick, { dryRun: opts.dryRun });
    const b = foldBuild(epicDir, pick, { dryRun: opts.dryRun });
    if (t.folded + b.folded > 0) {
      folded += t.folded + b.folded;
      touched.push(epic);
      info(`${epic}: ${opts.dryRun ? 'would fold' : 'folded'} ${t.folded} trust + ${b.folded} build shard(s)`);
    }
  }
  if (!folded) { info('nothing to tidy — no finished shards to fold'); return { folded: 0 }; }

  const author = checkpointAuthor(resolveCommitterLogin(root, hub?.roster || []), git('config', 'user.name').stdout);
  const label = touched.length === 1 ? touched[0] : `${touched.length} epics`;
  const message = `chore(hub): tidy back-half ledgers — ${label} by ${author} [skip ci]`;

  if (opts.dryRun) {
    log('\n' + c.dim(message) + '\n');
    info('dry run — nothing folded or committed');
    return { message, folded };
  }

  // Stage the fold (modified folded files + deleted shards) under each touched epic's ledger paths.
  // A pathspec that matches NOTHING (neither on disk nor tracked) makes `git add` fatal (exit 128), so
  // keep only the paths that exist OR are tracked — `git add -A` on those stages new/modified files AND
  // the shard deletions (even when the shard dir is now empty or removed).
  const candidates = touched.flatMap((e) => {
    const rel = `epics/${e}/.sdlc`;
    return [`${rel}/trust-log.json`, `${rel}/trust-log`, `${rel}/build-log.json`, `${rel}/build-log`];
  });
  const pathspecs = candidates.filter((spec) =>
    exists(path.join(root, spec)) || git('ls-files', '--error-unmatch', '--', spec).ok);
  if (!pathspecs.length) { info('fold produced no stageable change'); return { folded }; }
  const add = git('add', '-A', '--', ...pathspecs);
  if (!add.ok) { fail(`git add failed — ${add.stderr.split('\n')[0] || add.code}`); process.exitCode = 1; return { folded }; }
  const staged = git('diff', '--cached', '--name-only', '--', ...pathspecs).stdout.split('\n').filter(Boolean);
  if (!staged.length) { info('fold produced no net change — nothing to commit'); return { folded }; }

  const cm = git('commit', '-m', message, '--', ...staged);
  if (!cm.ok) {
    // Leave the fold STAGED (don't reset) — the on-disk fold already happened, so a re-run would see
    // "nothing to tidy"; keeping it staged lets a retry or `yad checkpoint` land it, never lose it.
    fail(`git commit failed — ${cm.stderr.split('\n')[0] || cm.code}`);
    hand('the fold is staged — re-run `yad tidy up`, or `yad checkpoint` to land it');
    process.exitCode = 1;
    return { message, folded };
  }
  ok(`tidied ${folded} shard(s) into ${touched.length} epic ledger(s): ${c.dim(label)}`);

  if (!opts.push) return { message, folded };
  if (pushWithRebase(root, branch).ok) { ok(`pushed to origin/${branch}`); return { message, folded }; }
  fail(`could not push to origin/${branch} — a protected branch, or an unresolvable rebase conflict`);
  hand(`run \`git pull --rebase\` and re-run \`yad tidy up --push\``);
  process.exitCode = 1;
  return { message, folded };
}
