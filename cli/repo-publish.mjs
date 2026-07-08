// `yad repo refresh --push` — after a repack + registry stamp, commit the connected-repo code-context
// (the tracked `code-map.md` per repo + the registry `.sdlc/repos.json`) and push it straight to the
// hub's default branch, so a code-map refresh "just lands" for teammates / CI / `yad status` on other
// machines instead of leaving a dirty tree for someone to hand-commit. This is the code-context
// analogue of `yad checkpoint` (cli/checkpoint.mjs) and reuses its default-branch commit machinery.
//
// Invariants (shared with checkpoint):
//   1. Commit an EXPLICIT allowlist via `git commit -- <paths>` (--only) — the tracked code-maps, the
//      registry, and (only when its change is the managed pack-ignore block alone) the hub `.gitignore`.
//      NEVER `git add -A` and NEVER a whole-index `git reset`: both would mutate unrelated staged work.
//      The repomix pack.md is gitignored (setup + publish scaffold the ignore via ensurePackIgnored) and
//      never committed as content. A pack committed BEFORE that ignore existed is self-healed here: its
//      on-disk file is held aside across the --only commit so the deletion is recorded (the regenerable
//      cache is restored right after), clearing the stranded working tree — see the commit block below.
//   2. Commit ONLY on the hub's default branch (unless --allow-branch), so the `[skip ci]` audit
//      commit never enters a PR's base..HEAD range where it would strand required checks.
import fs from 'node:fs';
import path from 'node:path';
import { c, ok, info, fail, hand, exists, pushWithRebase } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { loadHub } from './gate.mjs';
import { resolveCommitterLogin } from './platform.mjs';
import { hubGit, resolveDefaultBranch, guardDefaultBranch, preflightGuardReadiness } from './hubcommit.mjs';
import { ensurePackIgnored, PACK_IGNORE_BLOCK } from './setup.mjs';
import { checkpointAuthor } from './checkpoint.mjs';

// Collapse any whitespace/newline runs to a single space — keeps a hostile `git user.name` or a stray
// path from breaking the one-line subject or injecting a fake trailer line.
const oneLine = (s = '') => String(s).replace(/\s+/g, ' ').trim();

// The tracked code-map for a repo: the registered path, else the conventional location.
const codeMapOf = (repo) => repo.codeMap || path.posix.join('.sdlc/code-context', repo.name, 'code-map.md');

// The repomix pack for a repo: the registered path, else the conventional location.
const packOf = (repo) => repo.contextPack || path.posix.join('.sdlc/code-context', repo.name, 'pack.md');

// PURE — the repo-relative pathspecs to stage: the registry plus each registered repo's code-map that
// exists on disk. When `name` is given (a scoped `yad repo refresh <name> --push`), only that repo's
// code-map is staged, so an unrelated repo's uncommitted code-map never rides along in a named refresh's
// audit commit. Explicit allowlist by design (invariant 1); the gitignored pack.md is never included.
export function codeMapPathspecs(root, registry = { repos: [] }, name = null) {
  const out = [];
  for (const repo of registry.repos || []) {
    if (name && repo.name !== name) continue;
    const rel = codeMapOf(repo);
    if (fs.existsSync(path.join(root, rel))) out.push(rel);
  }
  // The registry always rides along — `yad repo refresh` stamps syncedHead/lastSyncedAt into it.
  if (fs.existsSync(path.join(root, PROJECT_FILES.reposRegistry))) out.push(PROJECT_FILES.reposRegistry);
  return out;
}

// PURE — each registered repo's on-disk pack path (scoped by `name` like codeMapPathspecs). These are
// UNTRACK candidates, not content to stage: the pack is gitignored, but a hub that committed it before
// the ignore existed would otherwise strand a dirty pack on every refresh. publishCodeContext keeps only
// the still-tracked ones and records their removal in the audit commit (see the self-heal block there).
export function packPathspecs(root, registry = { repos: [] }, name = null) {
  const out = [];
  for (const repo of registry.repos || []) {
    if (name && repo.name !== name) continue;
    const rel = packOf(repo);
    if (fs.existsSync(path.join(root, rel))) out.push(rel);
  }
  return out;
}

// True iff committing `.gitignore` would carry ONLY the managed pack-ignore block (comments + glob) and
// nothing else. Guards invariant 1: a hub whose `.gitignore` also has unrelated uncommitted edits must
// keep them OUT of the `[skip ci]` audit commit. The publish commit is `git commit -- <paths>` (--only,
// reads the WORKING TREE), so this compares the working tree — an untracked `.gitignore` must be wholly
// managed; a tracked one must differ from HEAD by the managed block alone (added, nothing removed).
// `git` is a hubGit-style accessor; `root` is the hub root. Mirrors checkpoint's stagedStoryIsStatusOnly.
export function ignoreChangeIsManagedOnly(git, root) {
  const gi = path.join(root, '.gitignore');
  if (!fs.existsSync(gi)) return false;
  const managed = new Set(PACK_IGNORE_BLOCK.map((l) => l.trim()));
  if (!git('ls-files', '--error-unmatch', '--', '.gitignore').ok) {
    // untracked: every non-blank line of the whole file must be a managed line
    let seen = 0;
    for (const l of fs.readFileSync(gi, 'utf8').split('\n')) {
      const body = l.trim();
      if (body === '') continue;
      if (!managed.has(body)) return false;
      seen++;
    }
    return seen > 0;
  }
  // tracked: the working-tree-vs-HEAD diff must ADD only managed lines and remove nothing
  const d = git('diff', '-U0', 'HEAD', '--', '.gitignore');
  if (!d.ok) return false;
  let added = 0;
  for (const ln of d.stdout.split('\n')) {
    if (ln.startsWith('+++') || ln.startsWith('---') || ln.startsWith('@@')) continue; // headers/hunks
    if (ln.startsWith('-')) return false;              // we only ever append — any removal ⇒ not ours
    if (ln.startsWith('+')) {
      const body = ln.slice(1).trim();
      if (body !== '' && !managed.has(body)) return false; // a non-managed added line ⇒ a user edit
      added++;
    }
  }
  return added > 0;
}

// PURE — turn the staged pathspecs into the subject `label` + the body's file list. A `<name>` is
// pulled from any `.sdlc/code-context/<name>/code-map.md` path; a commit that only touched the
// registry is labelled `registry`.
export function summarizeCodeContext(files = []) {
  const repos = new Set();
  const basenames = [];
  for (const f of files) {
    basenames.push(f);
    // A repo name comes from either its code-map (content) or a pack removal (self-heal), so the
    // subject label stays accurate even when untracking a stranded pack is the only change.
    const m = f.match(/\.sdlc\/code-context\/([^/]+)\/(?:code-map|pack)\.md$/);
    if (m) repos.add(m[1]);
  }
  let label;
  if (repos.size === 1) label = [...repos][0];
  else if (repos.size > 1) label = `${repos.size} repos`;
  else label = 'registry';
  return { label, basenames };
}

// PURE — the audit-trail commit message. Subject passes the hub commit-message gate (valid type
// `chore`, scope `hub`, non-empty description, no trailing period). No Task trailer and no
// Co-Authored-By: this is human-owned machine state, not an authored code change. `[skip ci]` mirrors
// `yad checkpoint` — it lands on the default branch and needs no PR gate suite. `label`/`author` are
// collapsed to one line so nothing can split the subject or forge a trailer.
export function buildCodeMapMessage({ label, author, basenames = [] }) {
  const subject = `chore(hub): sync code-context — ${oneLine(label)} by ${oneLine(author)} [skip ci]`;
  const body = basenames.length ? `Updated: ${basenames.join(', ')}` : '';
  return body ? `${subject}\n\n${body}` : subject;
}

// Commit the tracked code-context (and, with push, push it) on the hub's default branch. Mirrors
// `runCheckpoint`. Never throws; sets process.exitCode on a hard error so the CLI reports failure.
export async function publishCodeContext(root, { push = false, allowBranch = false, name = null } = {}) {
  if (!exists(path.join(root, '.git'))) { fail('not a git repo'); process.exitCode = 1; return; }
  if (!exists(path.join(root, PROJECT_FILES.hubConfig))) {
    fail('no .sdlc/hub.json — --push publishes the hub code-context; run it from the product hub');
    process.exitCode = 1;
    return;
  }

  const { hub, repos } = loadHub(root);
  const registry = { repos: repos || [] };
  const git = hubGit(root);

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  const defaultBranch = resolveDefaultBranch(git, hub);
  if (!guardDefaultBranch(branch, defaultBranch, { allowBranch, cmd: 'yad repo refresh --push' })) return;

  // Stage the EXPLICIT allowlist (code-maps + registry), scoped so an unrelated pre-staged file is never
  // swept in and the user's index is left untouched — mirrors `runCheckpoint`. NEVER `git add -A` and
  // NEVER a whole-index `git reset` (both would mutate unrelated staged work). The commit below is
  // `git commit -- <paths>` (--only), which reads the WORKING TREE for the named paths only.
  const pathspecs = codeMapPathspecs(root, registry, name);
  if (pathspecs.length) {
    const add = git('add', '--', ...pathspecs);
    if (!add.ok) { fail(`git add failed — ${add.stderr.split('\n')[0] || add.code}`); process.exitCode = 1; return; }
  }

  // Make the "pack is gitignored" assumption true (idempotent; packRepo also does this on refresh) so a
  // hub whose pack was tracked before the ignore existed stops stranding a dirty tree. Publish `.gitignore`
  // ONLY when the change is the managed pack-ignore block alone (invariant 1) — a hub whose `.gitignore`
  // also carries unrelated uncommitted edits keeps them OUT of this audit commit; the pack is still ignored
  // on disk and the human commits their own `.gitignore` edits through their own change. When we do carry
  // it, `git add` makes an untracked `.gitignore` known so the --only commit can include it.
  const ignoreChanged = ensurePackIgnored(root);
  const commitIgnore = ignoreChangeIsManagedOnly(git, root);
  if (commitIgnore) git('add', '--', '.gitignore');
  else if (ignoreChanged) hand('.gitignore has unrelated uncommitted edits — commit them yourself so the pack ignore is published (it is already ignored locally)');

  // Push HEAD to its OWN branch — on the default branch this is the same; with --allow-branch it keeps a
  // WIP branch from being force-published onto the default branch. Shared by the fresh-commit path and
  // the retry-after-failed-push path below.
  const pushHead = () => {
    if (pushWithRebase(root, branch).ok) { ok(`pushed to origin/${branch}`); return true; }
    fail(`could not push to origin/${branch} — a protected branch, or an unresolvable rebase conflict`);
    hand(`run \`git pull --rebase\` and re-run \`yad repo refresh --push\``);
    process.exitCode = 1;
    return false;
  };

  // Self-heal (invariant 1): a pack committed before it was gitignored strands the working tree on every
  // refresh. Any STILL-TRACKED pack must be recorded as removed in this commit — but `git rm --cached`
  // can't be committed under --only (which reads the working tree, where the regenerated pack still
  // exists). So we untrack it below by momentarily removing the on-disk file across the commit (restored
  // right after), letting --only record a clean deletion while the regenerable cache is preserved.
  const trackedPacks = packPathspecs(root, registry, name)
    .filter((p) => git('ls-files', '--error-unmatch', '--', p).ok);

  // The exact files this audit commit will touch: the staged allowlist (+ managed `.gitignore`) plus any
  // pack removal. Scopes the --only commit and, being all known to git, is a safe commit pathspec.
  const ignoreSpec = commitIgnore ? ['.gitignore'] : [];
  const staged = git('diff', '--cached', '--name-only', '--', ...pathspecs, ...ignoreSpec).stdout.split('\n').filter(Boolean);
  const fileset = [...staged, ...trackedPacks];
  if (!fileset.length) {
    // Nothing new to commit. A non-push run is simply done. But on a push run a PRIOR run may have
    // committed and then FAILED to push (the commit sits ahead of origin) — a plain re-run must land
    // that commit, not silently no-op and exit 0 while it stays stranded. Push any unpushed commit(s).
    if (!push) { info('code-context unchanged — nothing to commit'); return; }
    const rev = git('rev-list', '--count', `origin/${branch}..HEAD`);
    const ahead = rev.ok ? (Number(rev.stdout) || 0) : 1; // no upstream ref yet -> attempt the push
    if (!ahead) { info('code-context unchanged and already published — nothing to do'); return; }
    info(`code-context unchanged — pushing ${ahead} already-committed change(s) not yet on origin/${branch}`);
    pushHead();
    return;
  }

  // Only relevant when we are about to push a commit straight to the default branch: warn (never block)
  // if signing/allowlisting would make the yad-update-guard reject it. Gated on `push` and deferred to
  // here so it isn't noise on a guard-refused branch or a nothing-to-commit run.
  if (push) preflightGuardReadiness(root);

  const { label, basenames } = summarizeCodeContext(fileset);
  const author = checkpointAuthor(resolveCommitterLogin(root, hub?.roster || []), git('config', 'user.name').stdout);
  const message = buildCodeMapMessage({ label, author, basenames });

  // Untrack the packs by holding their bytes and removing the files across the --only commit, then
  // restoring them (now gitignored ⇒ a clean tree). try/finally so the regenerable cache is always put
  // back, even on a commit failure.
  const held = [];
  try {
    for (const p of trackedPacks) {
      const abs = path.join(root, p);
      held.push({ abs, buf: fs.readFileSync(abs) });
      fs.rmSync(abs);
    }
    const cm = git('commit', '-m', message, '--', ...fileset); // --only: adds from the tree, packs as deletions
    if (!cm.ok) {
      git('reset', '-q', '--', ...pathspecs, ...ignoreSpec); // unstage only OUR allowlist for a clean retry
      fail(`git commit failed — ${cm.stderr.split('\n')[0] || cm.code}`);
      process.exitCode = 1;
      return { message };
    }
  } finally {
    for (const h of held) if (!fs.existsSync(h.abs)) fs.writeFileSync(h.abs, h.buf);
  }
  ok(`published ${fileset.length} file(s): ${c.dim(label)}`);

  if (!push) return { message };
  pushHead();
  return { message };
}
