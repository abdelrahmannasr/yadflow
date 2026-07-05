// `yad repo refresh --push` — after a repack + registry stamp, commit the connected-repo code-context
// (the tracked `code-map.md` per repo + the registry `.sdlc/repos.json`) and push it straight to the
// hub's default branch, so a code-map refresh "just lands" for teammates / CI / `yad status` on other
// machines instead of leaving a dirty tree for someone to hand-commit. This is the code-context
// analogue of `yad checkpoint` (cli/checkpoint.mjs) and reuses its default-branch commit machinery.
//
// Invariants (shared with checkpoint):
//   1. Stage an EXPLICIT allowlist — exactly the tracked code-maps + the registry (never `git add -A`,
//      which would sweep unrelated work in the hub). The gitignored repomix pack.md is never staged.
//   2. Commit ONLY on the hub's default branch (unless --allow-branch), so the `[skip ci]` audit
//      commit never enters a PR's base..HEAD range where it would strand required checks.
import fs from 'node:fs';
import path from 'node:path';
import { c, ok, info, fail, hand, exists, pushWithRebase } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { loadHub } from './gate.mjs';
import { resolveCommitterLogin } from './platform.mjs';
import { hubGit, resolveDefaultBranch, guardDefaultBranch, preflightGuardReadiness } from './hubcommit.mjs';
import { checkpointAuthor } from './checkpoint.mjs';

// Collapse any whitespace/newline runs to a single space — keeps a hostile `git user.name` or a stray
// path from breaking the one-line subject or injecting a fake trailer line.
const oneLine = (s = '') => String(s).replace(/\s+/g, ' ').trim();

// The tracked code-map for a repo: the registered path, else the conventional location.
const codeMapOf = (repo) => repo.codeMap || path.posix.join('.sdlc/code-context', repo.name, 'code-map.md');

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

// PURE — turn the staged pathspecs into the subject `label` + the body's file list. A `<name>` is
// pulled from any `.sdlc/code-context/<name>/code-map.md` path; a commit that only touched the
// registry is labelled `registry`.
export function summarizeCodeContext(files = []) {
  const repos = new Set();
  const basenames = [];
  for (const f of files) {
    basenames.push(f);
    const m = f.match(/\.sdlc\/code-context\/([^/]+)\/code-map\.md$/);
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

  const pathspecs = codeMapPathspecs(root, registry, name);
  if (!pathspecs.length) { info('no code-context to publish — nothing to commit'); return; }

  const add = git('add', '--', ...pathspecs);
  if (!add.ok) { fail(`git add failed — ${add.stderr.split('\n')[0] || add.code}`); process.exitCode = 1; return; }
  if (git('diff', '--cached', '--quiet', '--', ...pathspecs).ok) {
    info('code-context unchanged — nothing to commit');
    return;
  }
  // The exact files staged from the allowlist — scopes the commit to ONLY the allowlist, so any
  // unrelated pre-staged file never rides along.
  const staged = git('diff', '--cached', '--name-only', '--', ...pathspecs).stdout.split('\n').filter(Boolean);

  // Only relevant when we are about to push a commit straight to the default branch: warn (never block)
  // if signing/allowlisting would make the yad-update-guard reject it. Gated on `push` and deferred to
  // here so it isn't noise on a guard-refused branch or a nothing-to-commit run.
  if (push) preflightGuardReadiness(root);

  const { label, basenames } = summarizeCodeContext(staged);
  const author = checkpointAuthor(resolveCommitterLogin(root, hub?.roster || []), git('config', 'user.name').stdout);
  const message = buildCodeMapMessage({ label, author, basenames });

  const cm = git('commit', '-m', message, '--', ...staged);
  if (!cm.ok) {
    git('reset', '-q', '--', ...pathspecs); // don't leave the allowlist staged for an unrelated commit to sweep up
    fail(`git commit failed — ${cm.stderr.split('\n')[0] || cm.code}`);
    process.exitCode = 1;
    return { message };
  }
  ok(`published ${staged.length} file(s): ${c.dim(label)}`);

  if (!push) return { message };
  // Push HEAD to its OWN branch — on the default branch this is the same; with --allow-branch it keeps
  // a WIP branch from being force-published onto the default branch.
  if (pushWithRebase(root, branch).ok) { ok(`pushed to origin/${branch}`); return { message }; }
  fail(`could not push to origin/${branch} — a protected branch, or an unresolvable rebase conflict`);
  hand(`run \`git pull --rebase\` and re-run \`yad repo refresh --push\``);
  process.exitCode = 1;
  return { message };
}
