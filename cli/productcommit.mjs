// Shared machinery for committing the machine-written Build ledgers to the Product — used by both
// `yad checkpoint` (sync new state) and `yad tidy up` (fold finished shards). Both must commit ONLY on
// the default branch, so their `[skip ci]` commit never enters a PR's base..HEAD range (where it would
// strand required checks and fail verified-commits). This module is the single home of that guard.
import { warn, fail, hand, run, forTerminal } from './lib.mjs';
import { SETTINGS_EDIT_HINT, settingsEditHint, PACK_IGNORE_BLOCK } from './manifest.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { worktreeAt, linkedGitDir, WORKTREE_RECORD } from './worktree-record.mjs';
import { isValidEpicId, FOUNDATION_EPIC, FOUNDATION_DIR } from './epic-state.mjs';

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

// The line number of the closing `---` of the frontmatter in the blob `blob`, 0 when it has none (or the blob
// cannot be read). The blob is read by id, so no pathspec setting or file-name spelling can make it miss.
// The output is trimmed by run(): a blob that starts with blank lines then `---` reads as frontmatter at
// line 1, which only shifts the range earlier than the diff's real line numbers — a refusal, never a pass.
export function blobFrontmatterEnd(git, blob) {
  if (!blob || /^0+$/.test(blob)) return 0;
  const r = git('cat-file', 'blob', blob);
  if (!r.ok) return 0;
  const lines = r.stdout.split('\n');
  if (lines[0] !== '---') return 0;
  const close = lines.indexOf('---', 1);
  return close > 0 ? close + 1 : 0;
}

// The blob ids of `file` at `rev` (`:` for the index) — for checkpoint's staged story check. Null when absent.
export function blobAt(git, rev, file) {
  const r = git('rev-parse', '--verify', '--quiet', `${rev}:${file}`);
  return r.ok && r.stdout ? r.stdout : null;
}

// True iff the change from blob `oldBlob` to blob `newBlob` passes: only `status:` lines inside the
// frontmatter of both (`kind: 'status'`), or only managed lines added to `.gitignore` (`kind: 'ignore'`, where
// a new file must hold nothing else). Diffed by blob id: no path lookup, no textconv, no external diff.
export function blobChangeIsYads(git, kind, oldBlob, newBlob) {
  const none = (b) => !b || /^0+$/.test(b);
  if (none(newBlob)) return false; // a deletion is never one of yad's
  if (none(oldBlob)) {
    if (kind !== 'ignore') return false; // a new artifact is all prose
    const r = git('cat-file', 'blob', newBlob);
    if (!r.ok) return false;
    const managed = new Set(PACK_IGNORE_BLOCK.map((l) => l.trim()));
    const body = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    return body.length > 0 && body.every((l) => managed.has(l));
  }
  const d = git('diff', '-U0', '--no-ext-diff', '--no-textconv', '--no-color', oldBlob, newBlob);
  if (!d.ok) return false;
  if (kind === 'ignore') return diffAddsManagedIgnoreOnly(d.stdout);
  return diffIsStatusOnly(d.stdout, { oldEnd: blobFrontmatterEnd(git, oldBlob), newEnd: blobFrontmatterEnd(git, newBlob) });
}

// PURE — the records of `git log -z --raw --no-abbrev --no-renames --format=%x00%H`: each commit's files as
// [{ commit, oldMode, newMode, oldBlob, newBlob, status, file }]. Null on any token that is not a commit id,
// a raw entry with its path, or the separators between them — unknown is not safe.
export function parseRawLog(out) {
  const tokens = String(out ?? '').split('\0');
  const entries = [];
  let commit = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\n*$/.test(t)) continue;
    if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(t)) { commit = t; continue; }
    const m = t.match(/^\n?:(\d{6}) (\d{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([A-Z])\d*$/);
    const file = tokens[i + 1];
    if (!m || !commit || !file) return null;
    entries.push({ commit, oldMode: m[1], newMode: m[2], oldBlob: m[3], newBlob: m[4], status: m[5], file });
    i++;
  }
  return entries;
}

// Why HEAD's commits ahead of origin/<default> are not all yad's own — null when they are. `{ subject }`: a
// commit whose subject is not one yad writes (an empty one too); `{ merge }`: a merge commit, which yad never
// makes; `{ file, files }`: files the commits touch that yad does not write there (#231) — an amended yad
// commit that carries a person's edit, even one a later commit takes out again, as the push carries every
// commit; `link: true` when the first is a symlink or a submodule. With files, `yadFiles` lists the files of
// yad's own the commits touch that HEAD or origin/<default> holds, never a foreign one (the hint restores
// them). `{ unknown: true }`: the fetch or a read failed — unknown is not safe.
export function notYadsOwnAhead(git, defaultBranch, { fetch = true } = {}) {
  if (fetch && !git('fetch', '--quiet', 'origin', `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`).ok) return { unknown: true };
  const range = `origin/${defaultBranch}..HEAD`;
  // One record per commit, so a commit with an empty message is a record with an empty subject, not a gap.
  const ahead = git('log', '-z', '--no-show-signature', '--format=%H%x1f%s', range);
  if (!ahead.ok) return { unknown: true };
  const records = ahead.stdout.split('\0').filter((r) => r !== '');
  for (const rec of records) {
    const cut = rec.indexOf('\x1f');
    if (cut < 0) return { unknown: true };
    const subject = rec.slice(cut + 1);
    if (!YAD_COMMIT_SUBJECT.test(subject)) return { subject };
  }
  if (!records.length) return null;
  const merges = git('rev-list', '--min-parents=2', range);
  if (!merges.ok) return { unknown: true };
  if (merges.stdout) return { merge: merges.stdout.split('\n')[0] };
  const raw = git('log', '-z', '--raw', '--no-abbrev', '--format=%x00%H', '--no-show-signature', ...DIFF_OPTS, range);
  const entries = raw.ok ? parseRawLog(raw.stdout) : null;
  if (!entries) return { unknown: true };
  const foreign = [];
  const judged = new Map();
  let link = false;
  for (const e of entries) {
    if (foreign.includes(e.file)) continue;
    const isLink = LINK_MODES.has(e.oldMode) || LINK_MODES.has(e.newMode);
    if (isLink) { if (!foreign.length) link = true; foreign.push(e.file); continue; }
    if (YAD_WRITTEN.some((re) => re.test(e.file))) continue;
    const kind = e.file === '.gitignore' ? 'ignore' : STATUS_FLIP.test(e.file) ? 'status' : null;
    const key = `${kind}:${e.oldBlob}:${e.newBlob}`; // one change seen in many commits is judged once
    if (kind && !judged.has(key)) judged.set(key, blobChangeIsYads(git, kind, e.oldBlob, e.newBlob));
    if (!kind || !judged.get(key)) foreign.push(e.file);
  }
  if (!foreign.length) return null;
  const held = new Set();
  for (const rev of ['HEAD', `origin/${defaultBranch}`]) {
    const t = git('ls-tree', '-r', '-z', '--name-only', rev);
    if (t.ok) for (const f of t.stdout.split('\0')) if (f) held.add(f);
  }
  const touched = [...new Set(entries.map((e) => e.file))];
  return { file: foreign[0], files: foreign, ...(link ? { link: true } : {}), yadFiles: touched.filter((f) => !foreign.includes(f) && held.has(f)) };
}

// HEAD holds nothing origin/<default> lacks but yad's own `[skip ci]` commits, touching only the files yad
// writes. False when the fetch or a read fails.
export function onlyYadCommitsAhead(git, defaultBranch, opts = {}) {
  return notYadsOwnAhead(git, defaultBranch, opts) === null;
}

// The one epic yad's own files belong to (`epics/<id>/…`, or `foundation/…` for the Product level), or null when
// they name none or more than one. A root file (the index, the registry) belongs to no epic and is passed over.
export function epicOf(files) {
  const ids = new Set();
  for (const f of files) {
    if (f.startsWith(`${FOUNDATION_DIR}/`)) ids.add(FOUNDATION_EPIC);
    else {
      const m = f.match(/^epics\/([^/]+)\//);
      if (m) ids.add(isValidEpicId(m[1]) ? m[1] : null);
    }
  }
  return ids.size === 1 ? [...ids][0] : null;
}

// When a Product worktree is refused for files yad does not write (#231), name them all, and say how to keep
// them on a branch of their own while yad's own files go up. Every commit ahead is kept on that branch; HEAD
// goes back to the tip; yad's files come back uncommitted; and the yad command commits them again. A `status:`
// change in a file that is also the person's is not restored, so the hint names `yad sync-status`, which
// writes it again, uncommitted: it reaches the default branch with the person's branch, once that is reviewed
// and merged (#245). Reads the local origin/<default> (the refusal just fetched it) unless the caller passes
// what it read. True when it printed. Names are printed through forTerminal, so a name holding a control
// character is shown, not run.
export function explainForeignFile(git, defaultBranch, why = notYadsOwnAhead(git, defaultBranch, { fetch: false })) {
  if (!why?.file) return false;
  const d = forTerminal(defaultBranch);
  const names = why.files.map((x) => `'${forTerminal(x)}'`).join(', ');
  fail(why.link
    ? `${names} ${why.files.length > 1 ? 'are' : 'is'} in the commits ahead of origin/${d}, and yad never writes a symlink or a submodule (or the other files) — they are not pushed to '${d}'`
    : `${names} ${why.files.length > 1 ? 'are' : 'is'} changed by the commits ahead of origin/${d}, and yad does not write ${why.files.length > 1 ? 'them' : 'it'} — they are not pushed to '${d}'`);
  // The status clause comes only with the restore: without yad's files back there is no ledger to read anew.
  const epic = epicOf(why.yadFiles);
  const restore = why.yadFiles.length
    ? `; bring yad's own files back, uncommitted: \`git restore --worktree --source <branch> -- ${why.yadFiles.map((x) => forTerminal(sq(literal(x)))).join(' ')}\``
      + `; then \`yad sync-status${epic ? ` ${epic}` : ''}\`, which writes again a \`status:\` change the reset dropped — it stays uncommitted, and reaches '${d}' with <branch> when that is reviewed and merged, so \`git restore\` it once <branch> carries it`
    : '';
  hand(`move ${why.files.length > 1 ? 'them' : 'it'} to a branch of their own: \`git branch <branch>\` keeps every commit, with ${why.files.length > 1 ? 'them' : 'it'}, for review; then go back to the tip: \`git reset --hard origin/${d}\` (\`git stash\` first if this folder holds uncommitted work)${restore}; then re-run the yad command that made them (\`yad checkpoint --push\` for Build state), which commits them again`);
  return true;
}

// The last check before a default-branch command pushes from a Product worktree's detached HEAD: the commit
// this run just made is judged with every other commit ahead, as the run's start judged the ones before it
// (#231 review) — a file a person had staged, or edited in a file the run commits whole, is caught here. On a
// refusal the commit stays here, unpushed, and the refusal says why. True when the push may go.
export function recheckBeforePush(root, git, defaultBranch) {
  if (git('rev-parse', '--abbrev-ref', 'HEAD').stdout !== 'HEAD' || !isProductWorktree(root)) return true;
  const why = notYadsOwnAhead(git, defaultBranch, { fetch: false });
  if (!why) return true;
  const d = forTerminal(defaultBranch);
  fail(`not pushed to origin/${d}: the commits ahead, with the one this run made, hold more than yad's own — the commit stays here`);
  if (!explainForeignFile(git, defaultBranch, why)) {
    hand(`a step's work goes on its branch and through review: \`git switch -c <step>/<epic>\` keeps it, then \`git fetch origin ${d}\` and \`git switch --detach origin/${d}\``);
  }
  process.exitCode = 1;
  return false;
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
