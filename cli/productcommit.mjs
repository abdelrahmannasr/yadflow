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
// The files yad's own default-branch commits write (#231), the allowlists the staging steps use: at the root
// only the index, the repo registry and the code-context (`yad index`, `yad repo refresh`); the ledgers in
// each epic and in foundation/; the gate's generated review summaries (in an epic and in foundation/); an
// artifact whose change is its frontmatter `status:` line alone (checkpoint's story flip, gate ci's
// draft → approved); and the managed `.gitignore` block. A symlink or a submodule entry is never one.
const YAD_WRITTEN = [
  /^\.sdlc\/(?:index\.json|repos\.json|code-context\/.+)$/,
  /^epics\/[^/]+\/\.sdlc\//, /^foundation\/\.sdlc\//, /^(?:epics\/[^/]+|foundation)\/reviews\//,
];
const STATUS_FLIP = /^(?:epics\/[^/]+|foundation)\/.+\.md$/;
const LINK_MODES = new Set(['120000', '160000']); // a symlink, a gitlink (submodule)
// The git diff options every read here uses: no external diff or textconv driver, no colour, and
// submodules shown, so what is read is the bytes that are pushed.
const DIFF_OPTS = ['--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=none'];
const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`; // one shell word
const literal = (f) => `:(literal)${f}`; // a pathspec that matches only this exact name

// PURE — the changed lines of one or more `-U0` patches, as [{ sign: '+'|'-', text, line }], `line` being the
// line number in the new file for '+' and in the old file for '-'. A line counts as a header (`diff --git`,
// `index`, `---`, `+++`, a mode line) only outside a hunk; inside one, the hunk header's line counts say how
// many '-' and '+' lines it holds, so a content line `---` or `++x` is a change, never skipped. Null when
// the patch does not read as one.
export function patchChanges(patch) {
  const out = [];
  let rem = 0; let add = 0; let oldNo = 0; let newNo = 0;
  for (const ln of String(patch ?? '').split('\n')) {
    if (rem > 0 || add > 0) {
      if (ln.startsWith('-') && rem > 0) { out.push({ sign: '-', text: ln.slice(1), line: oldNo++ }); rem--; continue; }
      if (ln.startsWith('+') && add > 0) { out.push({ sign: '+', text: ln.slice(1), line: newNo++ }); add--; continue; }
      if (ln.startsWith('\\')) continue; // "\ No newline at end of file"
      return null;
    }
    if (ln.startsWith('\\')) continue;
    const h = ln.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!h) continue; // a header line
    oldNo = Number(h[1]); rem = h[2] === undefined ? 1 : Number(h[2]);
    newNo = Number(h[3]); add = h[4] === undefined ? 1 : Number(h[4]);
  }
  return rem > 0 || add > 0 ? null : out;
}

// PURE — true iff a `-U0` patch changes only `status:` lines, each at column 0. With `oldEnd`/`newEnd` (the
// line number of the closing `---` of the frontmatter in the old and the new file, 0 for none), each change
// must also sit inside the frontmatter. A new file (all lines added) or any other edit fails. Limits: it reads
// lines, not YAML — two `status:` lines, or a value YAML reads oddly, are left to the writers' own checks.
export function diffIsStatusOnly(diff, { oldEnd = null, newEnd = null } = {}) {
  const changes = patchChanges(diff);
  if (!changes?.length) return false;
  return changes.every(({ sign, text, line }) => {
    if (!/^status:[ \t]*\S/.test(text)) return false;
    const end = sign === '-' ? oldEnd : newEnd;
    return end === null || (line > 1 && line < end);
  });
}

// PURE — true iff a `-U0` patch of `.gitignore` only ADDS lines of the managed pack-ignore block (or blank
// lines). Shared with repo-publish's check of the working tree.
export function diffAddsManagedIgnoreOnly(diff) {
  const managed = new Set(PACK_IGNORE_BLOCK.map((l) => l.trim()));
  const changes = patchChanges(diff);
  if (!changes?.length) return false;
  return changes.every(({ sign, text }) => sign === '+' && (text.trim() === '' || managed.has(text.trim())));
}

// The line number of the frontmatter's closing `---` in `file` at `rev` (or in the index with `--cached`),
// 0 when it has none. Read with git grep's line numbers, so no blank line or trimmed output can shift it.
export function frontmatterEnd(git, rev, file) {
  const at = rev === '--cached' ? ['--cached'] : [rev];
  const r = git('grep', '-n', '--no-column', '--no-color', '-e', '^---$', ...at, '--', literal(file));
  if (!r.ok) return 0;
  const lines = r.stdout.split('\n').map((l) => Number((l.match(/:(\d+):---$/) || [])[1])).filter(Boolean);
  return lines[0] === 1 && lines[1] ? lines[1] : 0;
}

// Each commit's own patch of `file` passes `check` — not only their sum, which a later commit could undo.
function everyCommitPasses(git, range, file, check) {
  const shas = git('rev-list', range, '--', literal(file));
  if (!shas.ok) return false;
  return shas.stdout.split('\n').filter(Boolean).every((sha) => {
    const d = git('diff', '-U0', ...DIFF_OPTS, `${sha}^`, sha, '--', literal(file));
    if (!d.ok) return false;
    if (check !== diffIsStatusOnly) return check(d.stdout);
    return check(d.stdout, { oldEnd: frontmatterEnd(git, `${sha}^`, file), newEnd: frontmatterEnd(git, sha, file) });
  });
}

// Why HEAD's commits ahead of origin/<default> are not all yad's own — null when they are. `{ subject }`: a
// commit whose subject is not one yad writes; `{ merge }`: a merge commit, which yad never makes; `{ file }`:
// a file one of the commits touches that yad does not write there (#231) — an amended yad commit that carries
// a person's edit, even one a later commit takes out again, as the push carries every commit; `link: true`
// when it is a symlink or a submodule. With a file, `yadFiles` lists the files of yad's own the commits
// touch that HEAD or origin/<default> holds (the hint restores them). `{ unknown: true }`: the fetch or a
// read failed — unknown is not safe.
export function notYadsOwnAhead(git, defaultBranch, { fetch = true } = {}) {
  if (fetch && !git('fetch', '--quiet', 'origin', `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`).ok) return { unknown: true };
  const range = `origin/${defaultBranch}..HEAD`;
  const ahead = git('log', '--format=%s', range);
  if (!ahead.ok) return { unknown: true };
  const subjects = ahead.stdout.split('\n').filter(Boolean);
  const subject = subjects.find((s) => !YAD_COMMIT_SUBJECT.test(s));
  if (subject !== undefined) return { subject };
  if (!subjects.length) return null;
  const merges = git('rev-list', '--min-parents=2', range);
  if (!merges.ok) return { unknown: true };
  if (merges.stdout) return { merge: merges.stdout.split('\n')[0] };
  // Every file any commit touches, with its modes: `:<old> <new> <sha> <sha> <status>\0<path>\0`.
  const raw = git('log', '-z', '--raw', '--format=', ...DIFF_OPTS, range);
  if (!raw.ok) return { unknown: true };
  const files = new Map();
  const tokens = raw.stdout.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const meta = tokens[i].replace(/^\n+/, '');
    if (!meta.startsWith(':')) continue;
    const file = tokens[++i];
    if (file === undefined) return { unknown: true };
    const [oldMode, newMode] = meta.slice(1).split(' ');
    const link = LINK_MODES.has(oldMode) || LINK_MODES.has(newMode);
    files.set(file, (files.get(file) || false) || link);
  }
  let foreign = null;
  for (const [file, link] of files) {
    if (link) { foreign = { file, link: true }; break; }
    if (YAD_WRITTEN.some((re) => re.test(file))) continue;
    const check = file === '.gitignore' ? diffAddsManagedIgnoreOnly : STATUS_FLIP.test(file) ? diffIsStatusOnly : null;
    if (!check || !everyCommitPasses(git, range, file, check)) { foreign = { file }; break; }
  }
  if (!foreign) return null;
  const held = new Set();
  for (const rev of ['HEAD', `origin/${defaultBranch}`]) {
    const t = git('ls-tree', '-r', '-z', '--name-only', rev);
    if (t.ok) for (const f of t.stdout.split('\0')) if (f) held.add(f);
  }
  return { ...foreign, yadFiles: [...files.keys()].filter((f) => f !== foreign.file && held.has(f)) };
}

// HEAD holds nothing origin/<default> lacks but yad's own `[skip ci]` commits, touching only the files yad
// writes. False when the fetch or a read fails.
export function onlyYadCommitsAhead(git, defaultBranch, opts = {}) {
  return notYadsOwnAhead(git, defaultBranch, opts) === null;
}

// When a Product worktree is refused for a file yad does not write (#231), say which, and how to keep it on a
// branch of its own while yad's own files go up. Every commit ahead is kept on that branch; HEAD goes back to
// the tip; yad's files come back uncommitted, and the yad command commits them again. Reads the local
// origin/<default> (the refusal just fetched it). True when it printed. Names are printed through
// forTerminal, so a name holding a control character is shown, not run, as it is.
export function explainForeignFile(git, defaultBranch) {
  const why = notYadsOwnAhead(git, defaultBranch, { fetch: false });
  if (!why?.file) return false;
  const [f, d] = [forTerminal(why.file), forTerminal(defaultBranch)];
  fail(why.link
    ? `'${f}' is a symlink or a submodule in the commits ahead of origin/${d}, and yad never writes one — they are not pushed to '${d}'`
    : `'${f}' is changed by the commits ahead of origin/${d}, and it is not a file yad writes — they are not pushed to '${d}'`);
  const restore = why.yadFiles.length
    ? `; bring yad's own files back, uncommitted: \`git restore --worktree --source <branch> -- ${why.yadFiles.map((x) => forTerminal(sq(literal(x)))).join(' ')}\``
    : '';
  hand(`move it to its own branch: \`git branch <branch>\` keeps every commit, with it, for review; then go back to the tip: \`git reset --hard origin/${d}\` (\`git stash\` first if this folder holds uncommitted work)${restore}; then re-run the yad command that made them (\`yad checkpoint --push\` for Build state), which commits them again`);
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
