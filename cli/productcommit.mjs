// Shared machinery for committing the machine-written Build ledgers to the Product — used by both
// `yad checkpoint` (sync new state) and `yad tidy up` (fold finished shards). Both must commit ONLY on
// the default branch, so their `[skip ci]` commit never enters a PR's base..HEAD range (where it would
// strand required checks and fail verified-commits). This module is the single home of that guard.
import { warn, fail, hand, run, forTerminal } from './lib.mjs';
import { SETTINGS_EDIT_HINT, settingsEditHint, PACK_IGNORE_BLOCK } from './manifest.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { worktreeAt, linkedGitDir, WORKTREE_RECORD } from './worktree-record.mjs';

export const productGit = (root) => (...args) => run('git', args, { cwd: root });

// A direct-to-default push (`yad update --push`, `yad repo refresh --push`) will be rejected by the
// yad-update-guard unless the commits are signed. Warn up front (never block) so the operator isn't
// surprised by a reddened default branch. There is no author allowlist to check since E62: write access
// decides who can author.
// `why` names the check an unsigned commit fails; the default is the direct-push commands' guard.
export function preflightGuardReadiness(root, why = 'the yad-update-guard requires a platform-Verified signature; unsigned pushes will fail the gate') {
  // Only commit.gpgsign actually enables signing — user.signingkey merely picks WHICH key once
  // signing is on, so it must not count (it would hide the warning while commits stay unsigned).
  const signing = run('git', ['config', '--bool', '--get', 'commit.gpgsign'], { cwd: root }).stdout === 'true';
  if (!signing) warn(`commit signing is not enabled (git config commit.gpgsign true) — ${why}.`);
}

// The default branch: Product config, else the remote's published default (origin/HEAD), else 'main'.
// NEVER the current branch — falling back to it (as gate.mjs does, safe there because CI checks out the
// default branch) would make the guard below a no-op on a WIP branch and let an unsigned commit land in
// a future PR's range.
export function resolveDefaultBranch(git, productConfig) {
  const originHead = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD'); // e.g. "origin/main"
  return productConfig?.default_branch
    || (originHead.ok && originHead.stdout ? originHead.stdout.replace(/^origin\//, '') : '')
    || 'main';
}

// A linked worktree of the Product (#597): one `yad worktree add` made for an epic (#115), or a plain
// `git worktree add --detach <dir> origin/<default>` with no record. Never the main checkout, and never a
// folder whose record names a code repo.
// A record that is there but cannot be read or is not valid counts against it: it may name a code repo.
export function isProductWorktree(root) {
  const gitDir = root ? linkedGitDir(root) : null;
  if (!gitDir) return false;
  const rec = worktreeAt(root);
  if (rec) return rec.repo === null;
  try { fs.lstatSync(path.join(gitDir, WORKTREE_RECORD)); return false; } catch { return true; }
}

// The branch a default-branch command commits on: the current one — or, in a linked Product worktree
// (#115, #597), which sits DETACHED because the default branch is checked out in the main tree, the default
// branch itself, so the commit is pushed as HEAD:<default>. Only when every commit HEAD holds that the
// default branch lacks (fetched first) is one of yad's own default-branch commits — each subject is
// `chore(product|gate): … [skip ci]`, so a `Revert "…"` of one, or a step's commit, is not. One a run made
// without --push, or whose push failed, is pushed by the next run, as in the main checkout. Anything else
// (a step's unreviewed work) must never reach the default branch. A detached HEAD in the main checkout
// stays 'HEAD', and the guard below refuses it as before.
// `fetch: false` judges by the local origin/<default> — for a caller that writes a derived file and pushes
// nothing (the index refresh): a stale or missing ref can only make it skip — unless the default branch
// was rewound — and it asks no network.
export function branchToCommitOn(root, git, defaultBranch, { fetch = true } = {}) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  return branch === 'HEAD' && isProductWorktree(root) && onlyYadCommitsAhead(git, defaultBranch, { fetch }) ? defaultBranch : branch;
}

// The subject every yad default-branch commit has (checkpoint, tidy, repo refresh, gate ci/repair/reopen).
export const YAD_COMMIT_SUBJECT = /^chore\((product|gate)\): .* \[skip ci\]$/;
// The files yad's own default-branch commits write (#231), the allowlists the staging steps use: the
// ledgers (`.sdlc/**` at the root — the index, the registry, the code-context — and in each epic and in
// foundation/), the gate's generated review summaries (in an epic and in foundation/), an artifact whose change is its `status:` line
// alone (checkpoint's story flip, gate ci's draft → approved), and the managed `.gitignore` block.
const YAD_WRITTEN = [/^\.sdlc\//, /^epics\/[^/]+\/\.sdlc\//, /^foundation\/\.sdlc\//, /^(?:epics\/[^/]+|foundation)\/reviews\//];
const STATUS_FLIP = /^(?:epics\/[^/]+|foundation)\/.+\.md$/;

// PURE — true iff a `-U0` diff changes only frontmatter `status:` lines: every added or removed content line
// is one. A new file (all lines added) or any other edit fails. Shared with checkpoint's staged-story check.
export function diffIsStatusOnly(diff) {
  let changes = 0;
  for (const ln of String(diff ?? '').split('\n')) {
    if (ln.startsWith('+++') || ln.startsWith('---') || ln.startsWith('@@')) continue; // headers/hunks
    if (ln.startsWith('+') || ln.startsWith('-')) {
      if (!/^status:\s*\S/.test(ln.slice(1).trimStart())) return false; // a non-status change ⇒ not status-only
      changes++;
    }
  }
  return changes > 0;
}

// PURE — true iff a `-U0` diff of `.gitignore` only ADDS lines of the managed pack-ignore block (or blanks).
function diffAddsManagedIgnoreOnly(diff) {
  const managed = new Set(PACK_IGNORE_BLOCK.map((l) => l.trim()));
  let added = 0;
  for (const ln of String(diff ?? '').split('\n')) {
    if (ln.startsWith('+++') || ln.startsWith('---') || ln.startsWith('@@')) continue;
    if (ln.startsWith('-')) return false; // yad only ever appends
    if (ln.startsWith('+')) {
      const body = ln.slice(1).trim();
      if (body !== '' && !managed.has(body)) return false;
      added++;
    }
  }
  return added > 0;
}

// Why HEAD's commits ahead of origin/<default> are not all yad's own — null when they are. `{ subject }`: a
// commit whose subject is not one yad writes; `{ file }`: a file the commits change (net, from where HEAD
// left the default branch) that yad does not write — an amended yad commit that carries a person's edit
// (#231); `{ unknown: true }`: the fetch or a read failed — unknown is not safe.
export function notYadsOwnAhead(git, defaultBranch, { fetch = true } = {}) {
  if (fetch && !git('fetch', '--quiet', 'origin', `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`).ok) return { unknown: true };
  const ahead = git('log', '--format=%s', `origin/${defaultBranch}..HEAD`);
  if (!ahead.ok) return { unknown: true };
  const subjects = ahead.stdout.split('\n').filter(Boolean);
  const subject = subjects.find((s) => !YAD_COMMIT_SUBJECT.test(s));
  if (subject !== undefined) return { subject };
  if (!subjects.length) return null;
  const range = `origin/${defaultBranch}...HEAD`;
  const names = git('diff', '--name-only', '--no-renames', '--no-ext-diff', '-z', range);
  if (!names.ok) return { unknown: true };
  for (const file of names.stdout.split('\0').filter(Boolean)) {
    if (YAD_WRITTEN.some((re) => re.test(file))) continue;
    const check = file === '.gitignore' ? diffAddsManagedIgnoreOnly : STATUS_FLIP.test(file) ? diffIsStatusOnly : null;
    const d = check && git('diff', '-U0', '--no-renames', '--no-ext-diff', '--no-color', range, '--', file);
    if (!check || !d.ok || !check(d.stdout)) return { file };
  }
  return null;
}

// HEAD holds nothing origin/<default> lacks but yad's own `[skip ci]` commits, changing only the files yad
// writes. False when the fetch or a read fails.
export function onlyYadCommitsAhead(git, defaultBranch, opts = {}) {
  return notYadsOwnAhead(git, defaultBranch, opts) === null;
}

// When a Product worktree is refused for a file yad does not write (#231), say which, and how to move it to a
// branch of its own. Reads the local origin/<default> (the refusal just fetched it). True when it printed.
export function explainForeignFile(git, defaultBranch) {
  const why = notYadsOwnAhead(git, defaultBranch, { fetch: false });
  if (!why?.file) return false;
  const [f, d] = [forTerminal(why.file), forTerminal(defaultBranch)];
  fail(`'${f}' is changed by the commits ahead of origin/${d}, and it is not a file yad writes — they are not pushed to '${d}'`);
  hand(`move it to its own branch: \`git branch <branch>\` keeps the commits, with it, for review; then take it out of yad's commit here — \`git restore --staged --worktree --source "$(git merge-base origin/${d} HEAD)" -- '${f}'\` and \`git commit --amend --no-edit\` — and re-run`);
  return true;
}

// Guard: only commit on the default branch. Returns true when OK; on a non-default branch it prints the
// refusal + sets a non-zero exit code, unless `allowBranch` overrides (with a warning). `--allow-branch`
// is the SINGLE documented override — never `--force` (which elsewhere only waives the atomic guard).
// `root` (the Product) lets the hint name the exact settings file to edit; without it the hint says it in words.
export function guardDefaultBranch(branch, defaultBranch, { allowBranch = false, cmd = 'yad checkpoint', root = null } = {}) {
  if (branch === defaultBranch) return true;
  // Printed cleaned (E81 review 13): `default_branch` comes from the Product's shared hub.json.
  const [b, d] = [forTerminal(branch), forTerminal(defaultBranch)];
  // A detached HEAD not taken as the default branch is refused even with --allow-branch (#597): the push
  // goes to the branch it is on, and `HEAD:HEAD` fails only after a commit and a rebase of HEAD's commits.
  if (branch === 'HEAD') {
    fail(`on 'HEAD', not the default branch '${d}' — ${cmd} commits go to the default branch to stay out of PR-checked ranges`);
    if (allowBranch) fail('--allow-branch cannot apply to a detached HEAD: it pushes to the branch it is on, and a detached HEAD is on none');
    // A Product worktree (#115, #597) refused here holds commits origin/<default> lacks, or could not fetch it.
    if (isProductWorktree(root)) {
      if (explainForeignFile(productGit(root), defaultBranch)) { process.exitCode = 1; return false; }
      const which = worktreeAt(root) ? 'epic worktree' : 'worktree';
      hand(`this ${which}'s HEAD has commits origin/${d} does not that are not yad's own (or the fetch failed) — a step's work goes on its branch and through review: \`git switch -c <step>/<epic>\` keeps it, then \`git fetch origin ${d}\` and \`git switch --detach origin/${d}\``);
      process.exitCode = 1;
      return false;
    }
    // A detached HEAD in the main checkout: check out a branch, never `--allow-branch` (#597).
    hand(`check out the default branch and re-run (\`git switch ${d}\`), or, when another folder holds '${d}', run it from a worktree at its tip: \`git worktree add --detach <dir> origin/${d}\``);
    process.exitCode = 1;
    return false;
  }
  if (allowBranch) {
    warn(`--allow-branch: committing on '${b}' — pushes go to origin/${b}, and this commit needs a verified signature to pass the gate in a PR`);
    return true;
  }
  fail(`on '${b}', not the default branch '${d}' — ${cmd} commits go to the default branch to stay out of PR-checked ranges`);
  hand(`switch to '${d}' and re-run, or pass --allow-branch to override (if '${d}' is wrong, set default_branch in ${root ? settingsEditHint(root) : SETTINGS_EDIT_HINT})`);
  process.exitCode = 1;
  return false;
}
