// `yad index` — rebuild `.sdlc/index.json`, the Product's one-file front door (E19), on demand.
//
//   yad index                 rebuild and write it — the default branch only, on a local Product. There is
//                             no override: a branch never carries the index (E19 review — `--allow-branch`
//                             was the one way round the user's decision, and `gate repair` already keeps
//                             the index off a branch even when it allows one)
//   yad index --json          print what it holds, built live from the files; writes nothing, any branch
//
// WHO WRITES IT (the user's decision): the default branch only, so a branch never carries a rewrite of a
// file every other branch rewrites too. On a VERIFIED Product the ledger is CI's alone (rule 9): CI
// rebuilds the index when it records a merge, and a local write could not be committed past the ledger
// guard — so this command writes nothing there and says so, the way a local `gate open` does.
// It never commits: the index rides the commit that carries the change, like the ledger it summarizes.
import { c, log, ok, info, warn, fail, hand, exists } from './lib.mjs';
import path from 'node:path';
import { productConfigPath, isVerifiedLedger, SCHEMA_VERSION } from './manifest.mjs';
import { loadProduct } from './gate.mjs';
import { productGit, resolveDefaultBranch } from './hubcommit.mjs';
import { buildIndex, writeIndex, indexFreshness, INDEX_FILE } from './product-index.mjs';
import { printable } from './epic-state.mjs';

export async function runIndex(root, { json = false } = {}) {
  if (!exists(productConfigPath(root))) {
    fail('no Product here (.sdlc/product.json) — run `yad index` from the Product');
    process.exitCode = 1;
    return;
  }
  let built;
  try {
    built = buildIndex(root);
  } catch (e) {
    fail(`the epics folder could not be listed (${e.code || e.message}), so there is no honest index to build`);
    process.exitCode = 1;
    return;
  }
  // A read: the index as the files say it is right now, on whatever branch this is. Nothing is written,
  // so no branch or ledger rule applies.
  // The same shape as the file, `schemaVersion` first, as `writeJSON` stamps it.
  if (json) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...built.index }, null, 2)}\n`);
    return;
  }

  log(c.bold('\nyad index'));
  const { hub } = loadProduct(root);
  const items = built.index.items;
  const unreadable = items.filter((i) => i.unreadable);
  const summary = `${items.length} work item${items.length === 1 ? '' : 's'}${unreadable.length ? `, ${unreadable.length} unreadable` : ''}`;
  if (isVerifiedLedger(hub)) {
    const fresh = indexFreshness(root, built);
    info(`this Product's ledger is verified: CI rebuilds ${INDEX_FILE} when it records a merge on the default branch, and a local write could not be committed — nothing written`);
    if (fresh.state === 'current') ok(`${INDEX_FILE} is current (${summary})`);
    else warn(`${INDEX_FILE} is ${fresh.state === 'missing' ? 'not built yet' : fresh.state === 'unreadable' ? `unreadable — ${fresh.why}` : 'behind the work items'}; the next review CI records rebuilds it`);
    reportUnreadable(built.index);
    return;
  }
  if (!exists(path.join(root, '.git'))) {
    fail('not a git repo, so yad cannot tell whether this is the default branch — the index is written there only');
    process.exitCode = 1;
    return;
  }
  const git = productGit(root);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  const defaultBranch = resolveDefaultBranch(git, hub);
  if (branch !== defaultBranch) {
    fail(`on '${branch}', not the default branch '${defaultBranch}' — ${INDEX_FILE} is written on the default branch only, so a branch never carries it`);
    hand(`switch to '${defaultBranch}' and re-run (set default_branch in .sdlc/product.json if '${defaultBranch}' is wrong); \`yad index --json\` prints it here without writing`);
    process.exitCode = 1;
    return;
  }
  let changed;
  try {
    changed = writeIndex(root, built);
  } catch (e) {
    fail(`${INDEX_FILE} could not be written (${e.code || e.message})`);
    process.exitCode = 1;
    return;
  }
  if (changed) ok(`wrote ${INDEX_FILE} (${summary}) — commit it with the change it describes`);
  else ok(`${INDEX_FILE} is already current (${summary})`);
  reportUnreadable(built.index);
}

// Every item the index could not read is said, with the reason: it is in the file, and it is on screen.
function reportUnreadable(index) {
  for (const i of index.items.filter((x) => x.unreadable)) warn(`${printable(i.dir)}: listed as unreadable — ${printable(i.why)}`);
  for (const d of index.unlisted || []) warn(`${printable(d)} holds a ledger that is not read as a work item — listed as unlisted`);
  if (index.items.some((x) => x.unreadable) || index.unlisted) hand('fix or restore the files named above, then run `yad index` again');
}
