// Shared machinery for committing the machine-written Build ledgers to the Product — used by both
// `yad checkpoint` (sync new state) and `yad tidy up` (fold finished shards). Both must commit ONLY on
// the default branch, so their `[skip ci]` commit never enters a PR's base..HEAD range (where it would
// strand required checks and fail verified-commits). This module is the single home of that guard.
import { warn, fail, hand, run, forTerminal } from './lib.mjs';
import { SETTINGS_EDIT_HINT, settingsEditHint } from './manifest.mjs';
import { worktreeAt } from './worktree-record.mjs';

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

// The branch a default-branch command commits on: the current one — or, in an epic's Product worktree
// (#115), which sits DETACHED because the default branch is checked out in the main tree, the default
// branch itself, so the commit is pushed as HEAD:<default>. Only when HEAD holds nothing the default branch
// lacks (fetched first): a detached HEAD on a step branch's unreviewed commits must never reach it. A
// detached HEAD anywhere else stays 'HEAD', and the guard below refuses it as before.
export function branchToCommitOn(root, git, defaultBranch) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  if (branch !== 'HEAD' || worktreeAt(root)?.repo !== null) return branch;
  if (!git('fetch', '--quiet', 'origin', `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`).ok) return branch;
  return git('merge-base', '--is-ancestor', 'HEAD', `origin/${defaultBranch}`).ok ? defaultBranch : branch;
}

// Guard: only commit on the default branch. Returns true when OK; on a non-default branch it prints the
// refusal + sets a non-zero exit code, unless `allowBranch` overrides (with a warning). `--allow-branch`
// is the SINGLE documented override — never `--force` (which elsewhere only waives the atomic guard).
// `root` (the Product) lets the hint name the exact settings file to edit; without it the hint says it in words.
export function guardDefaultBranch(branch, defaultBranch, { allowBranch = false, cmd = 'yad checkpoint', root = null } = {}) {
  if (branch === defaultBranch) return true;
  // Printed cleaned (E81 review 13): `default_branch` comes from the Product's shared hub.json.
  const [b, d] = [forTerminal(branch), forTerminal(defaultBranch)];
  if (allowBranch) {
    warn(`--allow-branch: committing on '${b}' — pushes go to origin/${b}, and this commit needs a verified signature to pass the gate in a PR`);
    return true;
  }
  fail(`on '${b}', not the default branch '${d}' — ${cmd} commits go to the default branch to stay out of PR-checked ranges`);
  // An epic worktree (#115) refused here holds commits origin/<default> lacks, or could not fetch it.
  if (branch === 'HEAD' && root && worktreeAt(root)?.repo === null) {
    hand(`this epic worktree's HEAD has commits origin/${d} does not (or the fetch failed): push them where they belong, then \`git fetch origin ${d}\` and \`git switch --detach origin/${d}\``);
    process.exitCode = 1;
    return false;
  }
  hand(`switch to '${d}' and re-run, or pass --allow-branch to override (if '${d}' is wrong, set default_branch in ${root ? settingsEditHint(root) : SETTINGS_EDIT_HINT})`);
  process.exitCode = 1;
  return false;
}
