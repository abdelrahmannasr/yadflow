// `yad update --push` / `yad check --fix --push` — after reconcile applies drift into the working
// trees, commit the applied changes PER REPO (the hub and every connected repo) and push them
// straight to the default branch, so a package update "just lands" everywhere instead of leaving
// dirty trees for someone to hand-commit across N repos. This is the update-flow analogue of the
// back-half `yad checkpoint` (cli/checkpoint.mjs) and reuses its machine-commit machinery.
//
// Invariants (shared with checkpoint):
//   1. Stage an EXPLICIT per-repo allowlist — exactly the paths the reconcile actions declared they
//      wrote (never `git add -A`, which would sweep unrelated work in a connected repo). Ignored
//      paths (a consumer repo that .gitignores .claude/ or the repomix code-context cache) are
//      dropped, and the commit is scoped to the staged allowlist so any pre-staged unrelated file
//      never rides along.
//   2. Commit ONLY on each repo's default branch; a repo on a feature branch is SKIPPED with a
//      warning (unless --allow-branch) — never disrupted.
//
// UNLIKE checkpoint, the commit is NOT marked `[skip ci]`: it goes straight to the default branch
// with NO PR (so the pull_request gate suite never fires), and a push-on-main integrity workflow
// (yad-update-guard) runs ONLY verified-commits + commit-message over it — the "skipped from CI
// except verified-commits + the pattern gates" contract. The subject is a valid `chore` commit so it
// passes commit-message and the story-linking gates treat it as an exempt maintenance commit; no
// Task trailer, no Co-Authored-By (human-owned machine state, not an authored code change).
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, info, warn, fail, hand, run, pushWithRebase } from './lib.mjs';
import { VERSION } from './manifest.mjs';
import { hubGit, resolveDefaultBranch } from './hubcommit.mjs';

// Collapse whitespace/newline runs to a single space — keeps a stray path or hostile value from
// breaking the one-line subject or injecting a fake trailer line.
const oneLine = (s = '') => String(s).replace(/\s+/g, ' ').trim();

// A short, human label for a repo root relative to the hub: 'hub' for the hub itself, else the
// registered path (e.g. demo-repos/backend), else the basename.
export function repoLabel(hubRoot, root) {
  if (root === hubRoot) return 'hub';
  const r = path.relative(hubRoot, root);
  return r && !r.startsWith('..') ? r.split(path.sep).join('/') : path.basename(root);
}

// PURE — group applied reconcile actions by the repo root they wrote to. Each group carries the
// deduped pathspecs to stage plus the human-readable item labels for the commit body. Actions with
// no root/paths (e.g. gaps, or a status:'ok' that was force-reapplied without a root) are ignored.
// Order follows first-encounter, so the hub (its module/_bmad/hub actions come first in reconcile)
// leads and connected repos follow in registry order.
export function groupByRoot(actions = []) {
  const groups = new Map();
  for (const a of actions) {
    if (!a || !a.root || !Array.isArray(a.paths) || !a.paths.length) continue;
    if (!groups.has(a.root)) groups.set(a.root, { root: a.root, paths: new Set(), items: [] });
    const g = groups.get(a.root);
    for (const p of a.paths) g.paths.add(p);
    // Stage every path, but keep only real *changes* in the body list: a `--force` re-copy of an
    // already-correct file (status 'ok') produces no diff, and the version stamp ('stamp') is implied
    // by the subject — neither belongs in the "Updated:" list.
    if (a.status !== 'ok' && a.status !== 'stamp') g.items.push(`${a.scope}/${a.item}`);
  }
  return [...groups.values()].map((g) => ({ root: g.root, paths: [...g.paths], items: g.items }));
}

// PURE — the update commit message. Subject `chore(yad-update): sync SDLC install to yadflow vX.Y.Z`
// passes the commit-message gate (valid type `chore`, lowercase scope, non-empty description, no
// trailing period) and the `chore` type makes it an exempt maintenance commit for the story-linking
// gates. Deliberately NO `[skip ci]` (we want the yad-update-guard integrity workflow to run), NO
// Task trailer, NO Co-Authored-By. Body lists the changed items; each is a `- ` bullet (never a
// `key: value` line) so `git interpret-trailers` can't mistake it for a trailer.
export function buildUpdateMessage({ version = VERSION, items = [] } = {}) {
  const subject = oneLine(`chore(yad-update): sync SDLC install to yadflow v${version}`);
  const body = items.length ? `Updated:\n${items.map((i) => `- ${oneLine(i)}`).join('\n')}` : '';
  return body ? `${subject}\n\n${body}` : subject;
}

// Stage exactly `paths` under `root`, keeping only pathspecs safe to hand `git add`:
//   - not git-ignored (naming an ignored path to `git add` is a hard error, not a no-op — so a
//     consumer repo that .gitignores .claude/ or the repomix code-context cache is respected), AND
//   - present in the working tree (an add/modify) OR tracked in the index (so a deletion — e.g. a
//     legacy rename's old file — stages) — this also drops a no-match pathspec (the root
//     .gitlab-ci.yml a github repo never has) that would otherwise abort `git add`.
// Returns the pathspecs actually staged.
function stageAllowlist(git, root, paths) {
  const keep = paths.filter((p) => {
    if (run('git', ['check-ignore', '-q', '--', p], { cwd: root }).ok) return false;
    if (fs.existsSync(path.join(root, p))) return true;
    return run('git', ['ls-files', '--error-unmatch', '--', p], { cwd: root }).ok;
  });
  if (!keep.length) return { staged: [] };
  // `git add` can exit non-zero (index lock, permissions) yet run() never throws — surface it rather
  // than silently reporting "nothing to commit". (A directory pathspec whose contents are ALL ignored
  // also exits 1 after staging the rest; the empty-diff below then correctly drops it.)
  const add = git('add', '--', ...keep);
  const staged = git('diff', '--cached', '--name-only', '--', ...keep).stdout.split('\n').filter(Boolean);
  return { staged, addError: !add.ok ? (add.stderr.split('\n')[0] || `exit ${add.code}`) : null };
}

// Commit (and, with push, push) one repo group. `defaultBranch` is the repo's configured default
// (hub.default_branch / repo.default_branch); falls back to origin/HEAD then 'main'. Returns a small
// result object; never throws. On any hard error it sets process.exitCode so the CLI reports failure.
export function commitAndPush(group, { push = false, allowBranch = false, hubRoot, defaultBranch } = {}) {
  const { root, paths, items } = group;
  const label = repoLabel(hubRoot ?? root, root);
  const git = hubGit(root);

  // `root` must be the TOP of its OWN git repo — not merely "inside a work tree". A registered repo
  // whose clone is missing (reconcile's apply() happily recreates the wiring files) but whose path
  // sits under the hub would otherwise report inside-work-tree=true against the HUB: git resolves the
  // pathspecs relative to cwd, so we would stage the connected repo's files into the HUB's index and
  // push them to the HUB's remote, mislabeled. Require the worktree top to BE this root.
  const top = git('rev-parse', '--show-toplevel');
  const sameRepo = top.ok && (() => {
    try { return fs.realpathSync(top.stdout) === fs.realpathSync(root); } catch { return false; }
  })();
  if (!sameRepo) {
    warn(`${label}: not its own git repo (missing/renamed clone?) — skipped (changes left in the working tree)`);
    return { label, committed: false, skipped: true };
  }
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  const target = defaultBranch || resolveDefaultBranch(git);

  if (branch !== target) {
    if (allowBranch) {
      warn(`${label}: on '${branch}', not default '${target}' — --allow-branch: commit/push go to origin/${branch}`);
    } else {
      warn(`${label}: on '${branch}', not the default branch '${target}' — skipped (switch to '${target}' or pass --allow-branch)`);
      return { label, committed: false, skipped: true };
    }
  }

  const { staged, addError } = stageAllowlist(git, root, paths);
  if (addError) warn(`${label}: git add reported "${addError}" — staging may be incomplete`);
  if (!staged.length) { info(`${label}: nothing to commit (unchanged or ignored)`); return { label, committed: false }; }

  // Pushing HEAD lands any local commits ahead of the remote too. Warn before we add ours so the
  // operator sees unpublished WIP about to ride the update push (never silently publish it).
  if (push) {
    const ahead = git('rev-list', '--count', `origin/${branch}..HEAD`);
    const n = Number(ahead.stdout);
    if (ahead.ok && n > 0) warn(`${label}: ${n} local commit(s) ahead of origin/${branch} will also be pushed`);
  }

  const message = buildUpdateMessage({ items });
  const cm = git('commit', '-m', message, '--', ...staged);
  if (!cm.ok) {
    git('reset', '-q', '--', ...staged); // don't leave our allowlist staged for an unrelated commit to sweep up
    fail(`${label}: git commit failed — ${cm.stderr.split('\n')[0] || cm.code}`);
    process.exitCode = 1;
    return { label, committed: false, error: true };
  }
  ok(`${label}: committed ${staged.length} file(s)`);

  if (!push) return { label, committed: true };
  if (pushWithRebase(root, branch).ok) { ok(`${label}: pushed to origin/${branch}`); return { label, committed: true, pushed: true }; }
  // The commit already landed locally — a re-run of `yad update --push` would see no drift and skip
  // this repo, so point the operator at the direct push of the commit that already exists.
  fail(`${label}: could not push to origin/${branch} — a protected branch, or an unresolvable rebase conflict`);
  hand(`resolve it in ${label === 'hub' ? '.' : label}, then push the existing commit with \`git push origin ${branch}\``);
  process.exitCode = 1;
  return { label, committed: true, pushed: false, error: true };
}

// Orchestrate the per-repo commit/push over the grouped applied actions, bookended by the announce
// banners. `defaultBranchFor(root)` yields each repo's configured default branch (undefined ->
// resolve from the remote). Prints, commits/pushes each group, then the done banner.
export function commitUpdates(hubRoot, groups, { push = false, allowBranch = false, defaultBranchFor, guardInactiveGitlab } = {}) {
  if (!groups.length) { info('no committable changes were applied'); return []; }

  const labels = groups.map((g) => repoLabel(hubRoot, g.root));
  log('');
  log(c.bold(`yad update — ${push ? 'publishing to default branches' : 'committing locally (no --push)'}`));
  warn(`about to ${push ? 'commit + push directly to the default branch' : 'commit'} on: ${labels.join(', ')}`);
  hand('announce the team and pause merges on these repos until this completes');

  const results = [];
  for (const g of groups) {
    const r = commitAndPush(g, { push, allowBranch, hubRoot, defaultBranch: defaultBranchFor?.(g.root) });
    if (push && r.pushed && guardInactiveGitlab?.(g.root)) {
      hand(`${r.label}: GitLab yad-update-guard is not active — add \`- local: '.gitlab/ci/yad-update-guard.yml'\` to the root .gitlab-ci.yml include (re-run the yad-checks wire step) so this direct-to-default push is gated`);
    }
    results.push(r);
  }

  const pushed = results.filter((r) => r.pushed).length;
  const committed = results.filter((r) => r.committed).length;
  const errored = results.filter((r) => r.error).length;
  const skipped = results.filter((r) => r.skipped).length;
  log('');
  if (push) {
    if (errored || skipped) {
      // Some repos did NOT receive the update (a push/commit failure, or a branch/clone skip) — do not
      // signal "all clear". commitAndPush already set process.exitCode on hard errors.
      warn(`update incomplete — ${pushed}/${groups.length} repo(s) pushed, ${errored} failed, ${skipped} skipped; keep merges paused and finish the rest (see above).`);
    } else {
      ok(`update published — ${pushed}/${groups.length} repo(s) pushed; merges can resume`);
    }
  } else ok(`update committed locally — ${committed}/${groups.length} repo(s); push with \`yad update --push\``);
  return results;
}
