// Shared machinery for committing the machine-written back-half ledgers to the hub — used by both
// `yad checkpoint` (sync new state) and `yad tidy up` (fold finished shards). Both must commit ONLY on
// the default branch, so their `[skip ci]` commit never enters a PR's base..HEAD range (where it would
// strand required checks and fail verified-commits). This module is the single home of that guard.
import fs from 'node:fs';
import path from 'node:path';
import { warn, fail, hand, run } from './lib.mjs';

export const hubGit = (root) => (...args) => run('git', args, { cwd: root });

const readFileSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

// A direct-to-default push (`yad update --push`, `yad repo refresh --push`) will be rejected by the
// yad-update-guard unless the commits are signed AND their author email is allowlisted. Warn up front
// (never block) so the operator isn't surprised by a reddened default branch. Best-effort, hub-identity
// based.
export function preflightGuardReadiness(root) {
  const gitcfg = (k) => run('git', ['config', '--get', k], { cwd: root }).stdout;
  // Only commit.gpgsign actually enables signing — user.signingkey merely picks WHICH key once
  // signing is on, so it must not count (it would hide the warning while commits stay unsigned).
  const signing = run('git', ['config', '--bool', '--get', 'commit.gpgsign'], { cwd: root }).stdout === 'true';
  if (!signing) warn('commit signing is not enabled (git config commit.gpgsign true) — the yad-update-guard requires a platform-Verified signature; unsigned pushes will fail the gate.');
  const email = gitcfg('user.email').toLowerCase();
  const allow = readFileSafe(path.join(root, '.sdlc', 'verified-authors'));
  const known = allow.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'));
  if (known.length && email && !known.includes(email)) {
    warn(`your git email <${email}> is not in .sdlc/verified-authors — the yad-update-guard will reject these commits (add it to the hub roster and re-run \`yad check --fix\`).`);
  }
}

// The default branch: hub config, else the remote's published default (origin/HEAD), else 'main'.
// NEVER the current branch — falling back to it (as gate.mjs does, safe there because CI checks out the
// default branch) would make the guard below a no-op on a WIP branch and let an unsigned commit land in
// a future PR's range.
export function resolveDefaultBranch(git, hub) {
  const originHead = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD'); // e.g. "origin/main"
  return hub?.default_branch
    || (originHead.ok && originHead.stdout ? originHead.stdout.replace(/^origin\//, '') : '')
    || 'main';
}

// Guard: only commit on the default branch. Returns true when OK; on a non-default branch it prints the
// refusal + sets a non-zero exit code, unless `allowBranch` overrides (with a warning). `--allow-branch`
// is the SINGLE documented override — never `--force` (which elsewhere only waives the atomic guard).
export function guardDefaultBranch(branch, defaultBranch, { allowBranch = false, cmd = 'yad checkpoint' } = {}) {
  if (branch === defaultBranch) return true;
  if (allowBranch) {
    warn(`--allow-branch: committing on '${branch}' — pushes go to origin/${branch}, and this commit needs a verified signature to pass the gate in a PR`);
    return true;
  }
  fail(`on '${branch}', not the default branch '${defaultBranch}' — ${cmd} commits go to the default branch to stay out of PR-checked ranges`);
  hand(`switch to '${defaultBranch}' and re-run, or pass --allow-branch to override (set default_branch in .sdlc/hub.json if '${defaultBranch}' is wrong)`);
  process.exitCode = 1;
  return false;
}
