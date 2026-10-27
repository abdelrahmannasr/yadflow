// `yad update --push` / `yad check --fix --push` — after reconcile applies drift into the working
// trees, commit the applied changes PER REPO (the Product and every connected repo) and push them
// straight to the default branch, so a package update "just lands" everywhere instead of leaving
// dirty trees for someone to hand-commit across N repos. This is the update-flow analogue of the
// Build `yad checkpoint` (cli/checkpoint.mjs) and reuses its machine-commit machinery.
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
import { c, log, ok, info, warn, fail, hand, run, pushWithRebase, samePath } from './lib.mjs';
import { VERSION } from './manifest.mjs';
import { productGit, resolveDefaultBranch } from './productcommit.mjs';

// Collapse whitespace/newline runs to a single space — keeps a stray path or hostile value from
// breaking the one-line subject or injecting a fake trailer line.
const oneLine = (s = '') => String(s).replace(/\s+/g, ' ').trim();

// A short, human label for a repo root relative to the Product: 'product' for the Product itself, else the
// registered path (e.g. demo-repos/backend), else the basename.
export function repoLabel(productRoot, root) {
  if (root === productRoot) return 'product';
  const r = path.relative(productRoot, root);
  return r && !r.startsWith('..') ? r.split(path.sep).join('/') : path.basename(root);
}

// PURE — group applied reconcile actions by the repo root they wrote to. Each group carries the
// deduped pathspecs to stage plus the human-readable item labels for the commit body. Actions with
// no root/paths (e.g. gaps, or a status:'ok' that was force-reapplied without a root) are ignored.
// Order follows first-encounter, so the Product (its module and Product actions come first in reconcile)
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
// (the Product's default_branch / repo.default_branch); falls back to origin/HEAD then 'main'. Returns a small
// result object; never throws. On any hard error it sets process.exitCode so the CLI reports failure.
export function commitAndPush(group, { push = false, allowBranch = false, productRoot, defaultBranch } = {}) {
  const { root, paths, items } = group;
  const label = repoLabel(productRoot ?? root, root);
  // Whether this is the Product itself, from the folder — never from the label, which a repo named `product`
  // shares (E124 review 1).
  const isProduct = root === (productRoot ?? root);
  const git = productGit(root);

  // `root` must be the TOP of its OWN git repo — not merely "inside a work tree". A registered repo
  // whose clone is missing (reconcile's apply() happily recreates the wiring files) but whose path
  // sits under the Product would otherwise report inside-work-tree=true against the Product: git resolves the
  // pathspecs relative to cwd, so we would stage the connected repo's files into the Product's index and
  // push them to the Product's remote, mislabeled. Require the worktree top to BE this root.
  const top = git('rev-parse', '--show-toplevel');
  // `samePath`, not a plain realpath compare: on Windows git's long name and Node's 8.3 short name for the
  // same folder differed, and the repo was skipped with nothing committed.
  const sameRepo = top.ok && samePath(top.stdout, root);
  if (!sameRepo) {
    warn(`${label}: not its own git repo (missing/renamed clone?) — skipped (changes left in the working tree)`);
    return { label, product: isProduct, committed: false, pushed: false, skipped: true, error: false };
  }
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  const target = defaultBranch || resolveDefaultBranch(git);

  if (branch !== target) {
    if (allowBranch) {
      warn(`${label}: on '${branch}', not default '${target}' — --allow-branch: commit/push go to origin/${branch}`);
    } else {
      warn(`${label}: on '${branch}', not the default branch '${target}' — skipped (switch to '${target}' or pass --allow-branch)`);
      return { label, product: isProduct, committed: false, pushed: false, skipped: true, error: false };
    }
  }

  const { staged, addError } = stageAllowlist(git, root, paths);
  if (addError) warn(`${label}: git add reported "${addError}" — staging may be incomplete`);
  if (!staged.length) { info(`${label}: nothing to commit (unchanged or ignored)`); return { label, product: isProduct, committed: false, pushed: false, skipped: false, error: false }; }

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
    return { label, product: isProduct, committed: false, pushed: false, skipped: false, error: true };
  }
  ok(`${label}: committed ${staged.length} file(s)`);

  if (!push) return { label, product: isProduct, committed: true, pushed: false, skipped: false, error: false };
  if (pushWithRebase(root, branch).ok) { ok(`${label}: pushed to origin/${branch}`); return { label, product: isProduct, committed: true, pushed: true, skipped: false, error: false }; }
  // The commit already landed locally — a re-run of `yad update --push` would see no drift and skip
  // this repo, so point the operator at the direct push of the commit that already exists.
  fail(`${label}: could not push to origin/${branch} — a protected branch, or an unresolvable rebase conflict`);
  hand(`resolve it in ${isProduct ? '.' : label}, then push the existing commit with \`git push origin ${branch}\``);
  process.exitCode = 1;
  return { label, product: isProduct, committed: true, pushed: false, skipped: false, error: true };
}

// Orchestrate the per-repo commit/push over the grouped applied actions, bookended by the announce
// banners. `defaultBranchFor(root)` yields each repo's configured default branch (undefined ->
// resolve from the remote). Prints, commits/pushes each group, then the done banner.
export function commitUpdates(productRoot, groups, { push = false, allowBranch = false, defaultBranchFor, guardInactiveGitlab } = {}) {
  if (!groups.length) { info('no committable changes were applied'); return []; }

  const labels = groups.map((g) => repoLabel(productRoot, g.root));
  log('');
  log(c.bold(`yad update — ${push ? 'publishing to default branches' : 'committing locally (no --push)'}`));
  warn(`about to ${push ? 'commit + push directly to the default branch' : 'commit'} on: ${labels.join(', ')}`);
  hand('announce the team and pause merges on these repos until this completes');

  const results = [];
  for (const g of groups) {
    const r = commitAndPush(g, { push, allowBranch, productRoot, defaultBranch: defaultBranchFor?.(g.root) });
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

// ---- `yad update --open-pr` / `yad check --fix --open-pr`: the same commit, reviewed ----------------
// The other way to publish an update (2026-10-27, the agent-first feature E157): each repo's changes go on
// their own branch, which is pushed, and a PR/MR is opened against the default branch. A person merges it,
// so the pull_request gates check the new files first, and it works where branch protection blocks a direct
// push. The branch is the update's own, so an AI agent opens it without asking (cli/agent-rules.mjs).
// Afterwards the repo is back on its default branch: the update lands there when the PR/MR merges.

export const updateBranchName = (version = VERSION) => `chore/yad-update-v${oneLine(version).replace(/[^0-9A-Za-z.-]/g, '-')}`;

// PURE — the PR/MR body. It carries the code template's required sections (`## Summary`, `## Impact &
// Risk` with a filled `Risk level:`, `## Checklist`), so the pr-template gate passes it on a code repo and
// on the Product (a non-review branch there is read as a tooling change). The file list comes last.
export function buildUpdatePrBody({ version = VERSION, items = [] } = {}) {
  const list = items.length ? items.map((i) => `- ${oneLine(i)}`).join('\n') : '- the version stamp only';
  return [
    '## Summary',
    '',
    `\`yad update\` brought the files yadflow manages here up to yadflow v${oneLine(version)}. The files are listed at the end.`,
    '',
    '## Impact & Risk',
    '',
    'Risk level: low',
    '',
    'Only files yadflow installs and manages changed. The checks on this PR/MR run them before they land.',
    '',
    '## Checklist',
    '',
    '- [x] Only yadflow-managed files are in this change',
    '- [ ] After the merge, each person pulls the default branch',
    '',
    // Last: a long list must never push a required section past GitLab's description cut.
    '## Files',
    '',
    list,
  ].join('\n');
}

// The repos `--open-pr` reaches, and so the ones it checks: the Product and every connected repo that is
// cloned here (one that is not is `yad repo clone`'s business, not the update's). ONE list for both
// readers — reconcile, which refuses a run, and the guide, which must never advise a run that is refused.
export function updateTargets(productRoot) {
  const settings = readJSONSafe(path.join(productRoot, '.sdlc/product.json')) ?? {};
  const registry = readJSONSafe(path.join(productRoot, '.sdlc/repos.json'));
  const repos = (Array.isArray(registry?.repos) ? registry.repos : [])
    .filter((x) => typeof x?.path === 'string' && x.path)
    .map((x) => ({ root: path.resolve(productRoot, x.path), name: typeof x.name === 'string' ? x.name : x.path, defaultBranch: x.default_branch ?? null, platform: x.platform ?? null }))
    .filter((x) => x.root !== productRoot && fs.existsSync(path.join(x.root, '.git')));
  return [{ root: productRoot, name: 'product', defaultBranch: settings.default_branch ?? null, platform: settings.platform ?? null, product: true }, ...repos];
}
const readJSONSafe = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Where one repo stands against its default branch, from git alone (origin as last fetched, no network):
// the branch checked out (null when detached or unborn), whether it has an origin, and how far HEAD is
// ahead of and behind origin/<base>. Every pull or push hint below is decided from this table.
export function branchTable(root, { defaultBranch } = {}) {
  const git = productGit(root);
  const top = git('rev-parse', '--show-toplevel');
  if (!(top.ok && samePath(top.stdout, root))) return { repo: false };
  const base = defaultBranch || resolveDefaultBranch(git);
  const sym = git('symbolic-ref', '--short', '-q', 'HEAD');
  const born = git('rev-parse', '--verify', '--quiet', 'HEAD').ok;
  const here = sym.ok && sym.stdout ? sym.stdout : null;
  const origin = git('remote', 'get-url', 'origin').ok;
  const tracked = origin && git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`).ok;
  const count = (range) => { const r = git('rev-list', '--count', range); return r.ok ? Number(r.stdout) : null; };
  return { repo: true, base, here, born, detached: !sym.ok, origin, tracked,
    ahead: tracked && born ? count(`origin/${base}..HEAD`) : null,
    behind: tracked && born ? count(`HEAD..origin/${base}`) : null };
}

// Why a repo cannot take the update as a PR/MR now, or null. Asked BEFORE anything is applied (reconcile),
// so a repo that cannot take it is never left with the update written into its working tree: a dirty
// default branch would stop the person's own `git pull` once the PR/MR merges.
//   kind `open`: the update is already on review (its branch is here, or on origin from another clone) —
//   nothing to do but merge it. Every other kind needs the person to fix something first.
// `network: false` (the guide) leaves out the one network read, `git ls-remote`.
export function updatePrBlocker(root, { defaultBranch, version = VERSION, productRoot = root, network = true, table = null } = {}) {
  const label = repoLabel(productRoot, root);
  // `table`: the caller's own read of `branchTable`, so it is not asked twice.
  const t = table ?? branchTable(root, { defaultBranch });
  if (!t.repo) return { kind: 'not-a-repo', label, message: 'not its own git repo (missing or renamed clone?)' };
  if (!t.born) return { kind: 'unborn', label, message: `has no commit yet — commit and push '${t.base}' first` };
  if (t.detached) return { kind: 'detached', label, message: `a detached HEAD — check out '${t.base}' first` };
  if (t.here !== t.base) return { kind: 'branch', label, message: `on '${t.here}', not the default branch '${t.base}' — switch to '${t.base}' first` };
  if (!t.origin) return { kind: 'no-origin', label, message: 'no origin remote to push the update branch to' };
  const git = productGit(root);
  const head = updateBranchName(version);
  const onReview = (where) => ({ kind: 'open', label, branch: head, message: `the update is already on review from '${head}'${where}: a person merges its PR/MR, then everyone pulls — nothing to do here (if that PR/MR was closed without merging, delete the branch, then run it again)` });
  if (git('rev-parse', '--verify', '--quiet', `refs/heads/${head}`).ok) return onReview('');
  if (git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${head}`).ok) return onReview(' (on origin)');
  // Exit 0: the branch is on origin. Exit 2: it is not. Anything else (offline): not known, and the push says so.
  if (network && run('git', ['ls-remote', '--exit-code', '--heads', 'origin', head], { cwd: root }).ok) return onReview(' (opened from another clone)');
  // `ahead` is null when origin/<base> was never fetched: the branch is then cut from the local base as it
  // is, and the push says the rest.
  if (t.ahead > 0) return { kind: 'ahead', label, message: `${t.ahead} local commit(s) on '${t.base}' are not on origin — push or drop them first, so the update PR/MR carries only the update` };
  return null;
}

// One repo group: branch, commit exactly the allowlist, push the branch, open the PR/MR, switch back.
// Never throws; sets process.exitCode on a hard error. `creator(platform, opts)` opens the PR/MR (createPr).
export function openUpdatePr(group, { productRoot, defaultBranch, platform, creator, version = VERSION, checked = false } = {}) {
  const { root, paths, items } = group;
  const label = repoLabel(productRoot ?? root, root);
  const isProduct = root === (productRoot ?? root);
  const git = productGit(root);
  const out = (o) => ({ label, product: isProduct, branch: null, committed: false, pushed: false, opened: false, pr: null, skipped: false, error: false, ...o });
  // `checked`: reconcile already asked, before it wrote anything; asking again would be a second network read.
  const blocked = checked ? null : updatePrBlocker(root, { defaultBranch, version, productRoot: productRoot ?? root });
  if (blocked) {
    (blocked.kind === 'open' ? info : warn)(`${label}: ${blocked.message}${blocked.kind === 'open' ? '' : ' — skipped'}`);
    return out({ skipped: true, branch: blocked.branch ?? null, reason: blocked.kind });
  }
  const base = defaultBranch || resolveDefaultBranch(git);
  const head = updateBranchName(version);
  if (!git('switch', '-q', '-c', head).ok) {
    fail(`${label}: could not create the branch '${head}'`);
    process.exitCode = 1;
    return out({ error: true });
  }
  // Back to the default branch. A switch that fails (a hook rewrote a committed file) leaves the repo on the
  // update branch: said, never silent.
  const back = () => {
    const r = git('switch', '-q', base);
    if (!r.ok) {
      fail(`${label}: could not switch back to '${base}' — ${r.stderr.split('\n')[0] || 'see git'}; run \`git switch ${base}\` in ${isProduct ? '.' : label}`);
      process.exitCode = 1;
    }
    return r.ok;
  };
  const { staged, addError } = stageAllowlist(git, root, paths);
  if (addError) warn(`${label}: git add reported "${addError}" — staging may be incomplete`);
  if (!staged.length) {
    const ok2 = back();
    if (ok2) git('branch', '-q', '-D', head);
    info(`${label}: nothing to commit (unchanged or ignored)`);
    return out({ error: !ok2 });
  }
  const cm = git('commit', '-m', buildUpdateMessage({ version, items }), '--', ...staged);
  if (!cm.ok) {
    git('reset', '-q', '--', ...staged);
    if (back()) git('branch', '-q', '-D', head);
    fail(`${label}: git commit failed — ${cm.stderr.split('\n')[0] || cm.code}`);
    process.exitCode = 1;
    return out({ error: true });
  }
  ok(`${label}: committed ${staged.length} file(s) on ${head}`);
  const pushed = run('git', ['push', '-q', '-u', 'origin', head], { cwd: root });
  if (!pushed.ok) {
    // The branch is dropped, so a run after the push problem is fixed tries again rather than reading it as
    // "already on review". The update stays in the working tree, unstaged, deletions included: the branch is
    // moved back to the base with the files left as they are, then the switch to the base carries them.
    const where = isProduct ? '.' : label;
    const reset = git('reset', '-q', '--mixed', base).ok;
    const home = reset && back();
    if (home) git('branch', '-q', '-D', head);
    fail(`${label}: could not push ${head} — ${pushed.stderr.split('\n')[0] || 'see git'}`);
    hand(home
      ? `fix the push (access, network) and run the update again; the update is left in ${where}'s working tree, uncommitted (\`git restore .\` drops it)`
      : reset
        ? `the update is left uncommitted in ${where}, which is still on ${head}: run \`git switch ${base}\` there (the changes come with it), then \`git branch -D ${head}\`, fix the push and run the update again`
        : `the update is committed on ${head} in ${where}; fix the push, then push that branch (\`git push -u origin ${head}\`) and open a PR/MR from it`);
    process.exitCode = 1;
    return out({ committed: false, error: true });
  }
  let opened = false;
  let pr = null;
  if (platform === 'github' || platform === 'gitlab') {
    const r = creator(platform, { title: buildUpdateMessage({ version, items: [] }), body: buildUpdatePrBody({ version, items }), base, head, cwd: root });
    if (r?.ok) { opened = true; pr = r.url || null; ok(`${label}: opened ${pr ?? 'the PR/MR (no URL came back)'}`); }
    else {
      warn(`${label}: pushed ${head}, but the PR/MR did not open — ${oneLine(r?.reason || 'no reason given').slice(0, 200)}`);
      hand(`open it from ${head} into ${base} by hand`);
    }
  } else {
    hand(`${label}: pushed ${head} — no platform is recorded, so open a PR/MR from it into ${base} by hand`);
  }
  const home = back();
  return out({ branch: head, committed: true, pushed: true, opened, pr, error: !home });
}

// Every repo the update changed, one PR/MR each.
export function openUpdatePrs(productRoot, groups, { defaultBranchFor, platformFor, creator, version = VERSION, checked = false } = {}) {
  if (!groups.length) { info('no committable changes were applied'); return []; }
  log('');
  log(c.bold(`yad update — a branch and a PR/MR in each repo (${updateBranchName(version)})`));
  const results = groups.map((g) => openUpdatePr(g, { productRoot, defaultBranch: defaultBranchFor?.(g.root), platform: platformFor?.(g.root), creator, version, checked }));
  const opened = results.filter((r) => r.pushed).length;
  log('');
  if (results.some((r) => r.error || r.skipped)) warn(`update not fully published — ${opened}/${groups.length} repo(s) have a branch pushed; finish the rest (see above).`);
  else ok(`update on review — ${opened}/${groups.length} repo(s); merge each PR/MR, then pull the default branch`);
  return results;
}
