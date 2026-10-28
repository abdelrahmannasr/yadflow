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
import { VERSION, PROJECT_FILES, MANAGED_LEDGER, productConfigPath } from './manifest.mjs';
import { parseVersion, compare as compareVersions } from './toolbox.mjs';
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
  // Every path list goes to git on stdin, never as arguments: `--open-pr` hands over every file of every skill
  // folder, hundreds of paths, which overflowed Windows' 32K command line (E157 update review 7); and one
  // spawn per path took minutes (review 6).
  if (!paths.length) return { staged: [] };
  const ignored = new Set(run('git', ['check-ignore', '-z', '--stdin'], { cwd: root, input: paths.join('\0') }).stdout.split('\0').filter(Boolean));
  const tracked = run('git', ['ls-files', '-z'], { cwd: root }).stdout.split('\0').filter(Boolean);
  const trackedSet = new Set(tracked);
  // A folder path covers every file under it.
  const under = (p, f) => f === p || f.startsWith(`${p.replace(/\/$/, '')}/`);
  const isTracked = (p) => trackedSet.has(p) || tracked.some((t) => under(p, t));
  const keep = paths.filter((p) => !ignored.has(p) && (fs.existsSync(path.join(root, p)) || isTracked(p)));
  if (!keep.length) return { staged: [] };
  // `git add` can exit non-zero (index lock, permissions) yet run() never throws — surface it rather
  // than silently reporting "nothing to commit". (A directory pathspec whose contents are ALL ignored
  // also exits 1 after staging the rest; the empty-diff below then correctly drops it.)
  const add = withPaths(root, ['add'], keep);
  const staged = run('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root }).stdout.split('\0').filter((f) => f && keep.some((p) => under(p, f)));
  return { staged, addError: !add.ok ? (add.stderr.split('\n')[0] || `exit ${add.code}`) : null };
}

// `git <args>` over a list of literal paths read from stdin (NUL-separated), not the command line.
function withPaths(root, args, paths) {
  return run('git', [...args, '--pathspec-from-file=-', '--pathspec-file-nul'], { cwd: root, input: paths.join('\0') });
}

// Network git that never waits on a question an agent cannot answer: no password prompt (HTTPS), and no SSH
// passphrase or host-key question unless the person set their own ssh command, which is left alone.
function quietGit(root) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const own = process.env.GIT_SSH_COMMAND || process.env.GIT_SSH || run('git', ['config', '--get', 'core.sshCommand'], { cwd: root }).ok;
  if (!own) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  return (...args) => run('git', args, { cwd: root, env });
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
  const cm = withPaths(root, ['commit', '-m', message], staged);
  if (!cm.ok) {
    withPaths(root, ['reset', '-q'], staged); // don't leave our allowlist staged for an unrelated commit to sweep up
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
  const settings = readJSONSafe(productConfigPath(productRoot)) ?? {};
  const registry = readJSONSafe(path.join(productRoot, '.sdlc/repos.json'));
  const repos = (Array.isArray(registry?.repos) ? registry.repos : [])
    .filter((x) => typeof x?.path === 'string' && x.path)
    .map((x) => ({ root: path.resolve(productRoot, x.path), name: typeof x.name === 'string' ? x.name : x.path, defaultBranch: x.default_branch ?? null, platform: x.platform ?? null, file: MANAGED_LEDGER }))
    .filter((x) => x.root !== productRoot && fs.existsSync(path.join(x.root, '.git')));
  // `file`: where each records the yadflow version that last wrote it.
  return [{ root: productRoot, name: 'product', defaultBranch: settings.default_branch ?? null, platform: settings.platform ?? null, product: true, file: PROJECT_FILES.version }, ...repos];
}
const isRoot = (a, b) => path.resolve(a) === path.resolve(b);
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
//   kind `merged`: the update of this version is already on origin's default branch — pull it, never a
//   second PR/MR. kind `open`: the update is on review (its branch is here, or on origin from another clone)
//   — a person merges it. Both are HELD: nothing is written there. Every other kind needs the person to fix
//   something first, and stops the run.
// With `network` (the default), origin's default branch and the update branch are fetched first, so a stale
// clone sees what already happened. `file` is the version record to compare: the Product's stamp, or a
// connected repo's managed ledger.
export const HELD_KINDS = ['merged', 'open'];
export function updatePrBlocker(root, { defaultBranch, version = VERSION, productRoot = root, network = true, table = null, file = null } = {}) {
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
  const rel = isRoot(productRoot, root) ? '.' : repoLabel(productRoot, root);
  if (network) {
    // What origin already has. Never a prompt (an agent cannot answer one), and a fetch that fails is said:
    // what follows is then read from origin as last fetched.
    const quiet = quietGit(root);
    if (!quiet('fetch', '-q', 'origin', t.base).ok) warn(`${label}: could not fetch origin's '${t.base}' — reading it as last fetched`);
    // Exit 0: the update branch is on origin; fetch it, so later reads (the guide's too) see it. Exit 2: it is
    // NOT on origin (deleted there, with the web page's button), so this clone's copy of it is dropped — kept,
    // it would read as "on review" for good. Any other exit is a failed read: the copy is trusted as it is.
    const lr = quiet('ls-remote', '--exit-code', '--heads', 'origin', head);
    if (lr.ok) quiet('fetch', '-q', 'origin', `+refs/heads/${head}:refs/remotes/origin/${head}`);
    else if (lr.code === 2) git('update-ref', '-d', `refs/remotes/origin/${head}`);
  }
  const versionAt = (ref) => { const s = file ? git('show', `${ref}:${file}`) : { ok: false }; try { return s.ok ? JSON.parse(s.stdout)?.version ?? null : null; } catch { return null; } };
  const want = parseVersion(version);
  const here = parseVersion(versionAt('HEAD'));
  // This clone already has a NEWER install than this yadflow: running it would write the older templates and
  // stamp over it — a downgrade PR/MR. The person updates yadflow first.
  if (here && want && compareVersions(here, want) > 0) {
    const v = String(versionAt('HEAD')).trim();
    return { kind: 'newer', label, message: `'${t.base}' here has the update to v${v}, newer than this yadflow (v${version}) — update yadflow itself to v${v} or later, then run this again` };
  }
  if (file && git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${t.base}`).ok) {
    const there = parseVersion(versionAt(`refs/remotes/origin/${t.base}`));
    // Held only while THIS clone's commit is behind what origin has: once pulled, the run goes on as usual,
    // so a same-version repair (a deleted managed file) is still possible.
    if (there && want && compareVersions(there, want) >= 0 && (!here || compareVersions(here, there) < 0)) {
      const newer = compareVersions(there, want) > 0;
      return { kind: 'merged', label, message: `origin's '${t.base}' already has the update to v${versionAt(`refs/remotes/origin/${t.base}`)} — pull it: \`git -C ${rel} pull --ff-only origin ${t.base}\`${newer ? `; it is newer than this yadflow (v${version}), so update yadflow here too` : ''}` };
    }
  }
  const onReview = (where) => ({ kind: 'open', label, branch: head, message: `the update is on review from '${head}'${where}: a person merges its PR/MR, then run this again. If no PR/MR was opened from it, open one into '${t.base}'; if it was closed without merging, delete the branch (here and on origin), then run this again` });
  // Once this clone's commit has the update (merged and pulled), an update branch left behind is not "on
  // review": the run goes on, so a same-version repair still works, and `openUpdatePr` deals with the leftover.
  const landed = here && want && compareVersions(here, want) >= 0;
  if (!landed && git('rev-parse', '--verify', '--quiet', `refs/heads/${head}`).ok) return onReview('');
  if (!landed && git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${head}`).ok) return onReview(' (on origin)');
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
    return out({ skipped: true, branch: blocked.branch ?? null, reason: blocked.kind, hint: blocked.message });
  }
  const base = defaultBranch || resolveDefaultBranch(git);
  const head = updateBranchName(version);
  const where = isProduct ? '.' : label;
  // Staged on the default branch first, so a repo with nothing to commit never gets a branch, and a
  // staging problem is said before anything else moves.
  const { staged, addError } = stageAllowlist(git, root, paths);
  const unstage = () => { if (staged.length) withPaths(root, ['reset', '-q'], staged); };
  if (addError) {
    unstage();
    fail(`${label}: git add failed — ${addError}`);
    process.exitCode = 1;
    return out({ error: true, reason: 'add-failed', hint: `git could not stage the update in ${where} (${oneLine(addError).slice(0, 160)}) — often a leftover index.lock or file permissions; fix it and run this again: the update is in the working tree, and the next run carries it` });
  }
  if (!staged.length) { info(`${label}: nothing to commit (unchanged or ignored)`); return out({}); }
  // An update branch left from an update that already merged (`updatePrBlocker` lets the run on once this
  // clone has it). Dropped only when it holds nothing but the update's own commit; anything else is a person's.
  const leftover = (why) => {
    unstage();
    fail(`${label}: ${why}`);
    process.exitCode = 1;
    return out({ error: true, reason: 'leftover-branch', hint: why });
  };
  if (git('rev-parse', '--verify', '--quiet', `refs/heads/${head}`).ok) {
    const extra = git('log', '--format=%s', `${base}..${head}`);
    const subjects = extra.ok ? extra.stdout.split('\n').filter(Boolean) : null;
    const ours = subjects && subjects.every((x) => x === buildUpdateMessage({ version, items: [] }));
    if (!ours || !git('branch', '-q', '-D', head).ok) {
      return leftover(`the branch '${head}' is left from the update that already merged, and holds other commits: look at it (\`git -C ${where} log ${base}..${head}\`), delete it (\`git -C ${where} branch -D ${head}\`), then run this again`);
    }
  }
  if (git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${head}`).ok) {
    return leftover(`the branch '${head}' is still on origin, left from the update that already merged: delete it on origin (\`git -C ${where} push origin --delete ${head}\`), then run this again`);
  }
  if (!git('switch', '-q', '-c', head).ok) {
    unstage();
    fail(`${label}: could not create the branch '${head}'`);
    process.exitCode = 1;
    return out({ error: true, reason: 'branch-failed', hint: `git could not create '${head}' in ${where} — see what \`git switch -c ${head}\` says there, fix it, and run this again` });
  }
  // Back to the default branch. A switch that fails (a hook rewrote a committed file) leaves the repo on the
  // update branch: said, never silent.
  const stuck = `${where} is still on '${head}': run \`git switch ${base}\` there (the changes come with it), then \`git branch -D ${head}\``;
  const back = () => {
    const r = git('switch', '-q', base);
    if (!r.ok) {
      fail(`${label}: could not switch back to '${base}' — ${r.stderr.split('\n')[0] || 'see git'}; run \`git switch ${base}\` in ${where}`);
      process.exitCode = 1;
    }
    return r.ok;
  };
  const cm = withPaths(root, ['commit', '-m', buildUpdateMessage({ version, items })], staged);
  if (!cm.ok) {
    unstage();
    const home = back();
    if (home) git('branch', '-q', '-D', head);
    const why = cm.stderr.split('\n')[0] || `exit ${cm.code}`;
    fail(`${label}: git commit failed — ${why}`);
    process.exitCode = 1;
    return out({ error: true, branch: home ? null : head, reason: 'commit-failed', hint: `the commit failed (${oneLine(why).slice(0, 160)}) — often signing or a hook; fix it and run this again: the update is still in the working tree, and the next run carries it${home ? '' : `. First: ${stuck}`}` });
  }
  ok(`${label}: committed ${staged.length} file(s) on ${head}`);
  const pushed = quietGit(root)('push', '-q', '-u', 'origin', head);
  if (!pushed.ok) {
    // The branch is dropped, so a run after the push problem is fixed tries again rather than reading it as
    // "already on review". The update stays in the working tree, unstaged, deletions included: the branch is
    // moved back to the base with the files left as they are, then the switch to the base carries them.
    // Only the update's own paths are unstaged: anything the person had staged before the run stays staged.
    const reset = git('reset', '-q', '--soft', base).ok && withPaths(root, ['reset', '-q'], staged).ok;
    const home = reset && back();
    if (home) git('branch', '-q', '-D', head);
    fail(`${label}: could not push ${head} — ${pushed.stderr.split('\n')[0] || 'see git'}`);
    const hint = home
      ? `fix the push (access, network) and run this again; the update is left uncommitted in ${where}'s working tree, and the next run carries it`
      : reset
        ? `the update is left uncommitted in ${where}, which is still on ${head}: run \`git switch ${base}\` there (the changes come with it), then \`git branch -D ${head}\`, fix the push and run the update again`
        : `the update is committed on ${head} in ${where}; fix the push, then push that branch (\`git push -u origin ${head}\`) and open a PR/MR from it`;
    hand(hint);
    process.exitCode = 1;
    return out({ committed: !home && !reset, branch: home ? null : head, error: true, reason: 'push-failed', hint });
  }
  let opened = false;
  let pr = null;
  let left = null;
  if (platform === 'github' || platform === 'gitlab') {
    const r = creator(platform, { title: buildUpdateMessage({ version, items: [] }), body: buildUpdatePrBody({ version, items }), base, head, cwd: root });
    if (r?.ok) { opened = true; pr = r.url || null; ok(`${label}: opened ${pr ?? 'the PR/MR (no URL came back)'}`); }
    else {
      warn(`${label}: pushed ${head}, but the PR/MR did not open — ${oneLine(r?.reason || 'no reason given').slice(0, 200)}`);
      left = { reason: 'pr-not-opened', hint: `the branch '${head}' is pushed, but its PR/MR did not open (${oneLine(r?.reason || 'no reason given').slice(0, 160)}): open one from '${head}' into '${base}' by hand, or log the platform CLI in and run this again` };
      hand(left.hint);
    }
  } else {
    left = { reason: 'no-platform', hint: `the branch '${head}' is pushed, but no platform is recorded for this repo: open a PR/MR from '${head}' into '${base}' by hand` };
    hand(`${label}: ${left.hint}`);
  }
  const home = back();
  // Said together with what is left of the PR/MR, never in place of it.
  if (!home) left = left ? { reason: left.reason, hint: `${left.hint}. Also: ${where} is still on '${head}': run \`git switch ${base}\` there` } : { reason: 'switch-back-failed', hint: `${where} is still on '${head}': run \`git switch ${base}\` there` };
  return out({ branch: head, committed: true, pushed: true, opened, pr, error: !home, ...(left ?? {}) });
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
