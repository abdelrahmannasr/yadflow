// `yad capture` (E43) — background capture of Shape artifacts to private `yad/wip/<name>/<epic>` branches.
//
// "Humans write content. Only the engine writes git." Every change to an artifact is snapshotted onto a
// private branch, so nothing is ever lost and nobody types a git command. E44 later folds a branch into one
// clean commit at a step boundary; this row only captures. The decisions were the user's (2026-09-25):
//   1. TRIGGER: this command, run after every agent edit by a harness hook (Claude Code `PostToolUse`,
//      Cursor `afterFileEdit` — see CAPTURE_ADAPTERS in manifest.mjs) and by hand from any other tool. Every
//      capture snapshots EVERY changed artifact, so a person's own editor edits ride along on the next one.
//   2. PUSH: the commit is local and immediate; the push runs in a detached background process, at most
//      once every PUSH_EVERY_MS, with no prompts and a short timeout — an edit never waits on the network.
//      No remote, or offline: the capture stays local, and nothing fails.
//   3. BRANCH: `yad/wip/<git user.name, made ref-safe>/<epic>` — one branch per person per epic. The git
//      name, not the platform login: it is there offline and never flips, so one person's work never
//      splits across two branches when the network drops. Two people with one git name share branches.
//   4. FILES: everything under `epics/<epic>/` and `foundation/` EXCEPT the ledger — any `.sdlc/` folder
//      and `reviews/`. `contract-lock.json` and `change.json` are the two `.sdlc/` files a person writes,
//      so they are captured. A new kind of artifact is captured with no list to update.
//
// THE MECHANISM NEVER TOUCHES THE CHECKOUT. It builds each commit with git plumbing in a throwaway index
// (`GIT_INDEX_FILE`): the tree is HEAD's, with this epic's changed artifacts as they are on disk. So the
// person's branch, index and working tree are exactly as they were, a hook firing mid-edit can never
// disturb anything, and no `git commit` hook runs. The ref moves by compare-and-swap (`update-ref <new>
// <old>`), so two agents capturing at once cannot lose each other's commit.
//
// THE COMMIT SHAPE IS A CONTRACT E44 READS: subject `wip(<epic>): capture`, and three trailers —
// `Yad-Epic`, `Yad-Base` (the HEAD the tree was built on, or `none`) and `Yad-Branch` (the branch checked
// out, or `(detached)`). `wip` is not a commit-message type the gates accept, and it need not be: only a
// PR to the default branch is message-gated, and a capture branch is never one. The commits are unsigned
// on purpose (`--no-gpg-sign`): a signing prompt inside a hook would hang the agent, and E44's fold is the
// commit that gets signed.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ok, info, warn, fail, hand, readJSON, writeJSON } from './lib.mjs';
import { productConfigPath } from './manifest.mjs';
import { FOUNDATION_DIR, FOUNDATION_EPIC } from './epic-state.mjs';

export const WIP_PREFIX = 'yad/wip';
// How often the background push may run. A capture between two pushes is committed locally and rides the
// next one — the push sends every capture branch of this person at once.
export const PUSH_EVERY_MS = 5 * 60 * 1000;
// The two `.sdlc/` files a person writes (hook.mjs calls them artifact-side). Everything else in a `.sdlc/`
// folder is the ledger, or a Build log only the engine writes.
const PERSON_WRITTEN_SDLC = new Set(['.sdlc/contract-lock.json', '.sdlc/change.json']);

// Which epic a Product-relative path belongs to, if capture takes it — else null. The complement of the
// ledger, not a list of artifacts (decision 4).
export function capturedEpic(rel) {
  if (typeof rel !== 'string') return null;
  const p = rel.split(path.sep).join('/');
  let epic;
  let rest;
  if (p.startsWith(`${FOUNDATION_DIR}/`)) { epic = FOUNDATION_EPIC; rest = p.slice(FOUNDATION_DIR.length + 1); }
  else {
    const m = p.match(/^epics\/(EP-[^/]+)\/(.+)$/);
    if (!m) return null;
    [, epic, rest] = m;
  }
  if (!rest || PERSON_WRITTEN_SDLC.has(rest)) return rest ? epic : null;
  const parts = rest.split('/');
  // The ledger at any depth: a `.sdlc/` folder (state, approvals, Build logs, shards) or `reviews/`.
  if (parts.slice(0, -1).some((d) => d === '.sdlc' || d === 'reviews')) return null;
  return epic;
}

// The git user.name as one branch-name segment. Lower case, because refs are files and a case-insensitive
// disk (macOS, Windows) would make `Ann` and `ann` one file. A name written in a script with no Latin
// letters (Arabic, Chinese…) leaves nothing after the cleaning, so it falls back to the local part of the
// git email, and then to a short fingerprint of the name itself — the same name always gives the same
// branch. Null only when git has no name at all.
const safeSegment = (v) => (typeof v === 'string' ? v : '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/-{2,}/g, '-')
  .replace(/^[-.]+|[-.]+$/g, '').replace(/\.lock$/, '');
export function wipName(gitName, email = null) {
  if (typeof gitName !== 'string' || !gitName.trim()) return null;
  return safeSegment(gitName)
    || safeSegment(typeof email === 'string' ? email.split('@')[0] : '')
    || `u-${createHash('sha256').update(gitName.trim()).digest('hex').slice(0, 8)}`;
}

export const wipBranch = (name, epic) => `${WIP_PREFIX}/${name}/${epic}`;

// Is capture turned off? `capture: false` in the Product config, or `YAD_CAPTURE=0` for one shell.
export function captureOff(root, env = process.env) {
  if (env.YAD_CAPTURE === '0') return 'YAD_CAPTURE=0 is set';
  const cfg = readJSON(productConfigPath(root), null);
  return cfg && cfg.capture === false ? 'capture is off in the Product config (`"capture": false`)' : null;
}

// git, spawned directly: `run()` trims its output, and a NUL-separated list must reach the parser whole.
// `env` is the whole environment the command was given (`runCapture`'s, so a caller's settings reach every git
// call); `extra` adds this call's own keys on top.
function gitIn(root, env = process.env, extra = null) {
  return (args, input = null) => {
    const r = spawnSync('git', args, {
      cwd: root, encoding: 'utf8', maxBuffer: 1 << 30,
      env: extra ? { ...env, ...extra } : env,
      ...(input !== null ? { input } : {}),
    });
    return { ok: r.status === 0, out: r.stdout || '', err: (r.stderr || '').trim() };
  };
}

// Every changed path under epics/ and foundation/ — tracked changes, deletions and new files — from
// `git status -z`. A rename yields both paths, so the old one is captured as deleted. git prints paths from
// the TOP of the repository, and a Product may live in a subfolder of it (a monorepo), so `prefix` — the
// Product's place in the repo — is cut off, and every path below is relative to the Product root.
// `GIT_OPTIONAL_LOCKS=0`: a plain `git status` refreshes and rewrites the person's real index, taking
// `index.lock` for a moment, and a `git commit` of theirs at that instant would fail. This must not.
function changedPaths(root, prefix, env) {
  const r = gitIn(root, env, { GIT_OPTIONAL_LOCKS: '0' })(['status', '-z', '--porcelain=v1', '--untracked-files=all', '--no-renames', '--', 'epics', FOUNDATION_DIR]);
  if (!r.ok) return null;
  const out = [];
  for (const entry of r.out.split('\0')) {
    if (entry.length <= 3) continue;
    const p = entry.slice(3);
    if (p.startsWith(prefix)) out.push(p.slice(prefix.length));
  }
  return out;
}
// A tree path from the top of the repo, as a Product-relative one — or null outside the Product.
const underPrefix = (p, prefix) => (p.startsWith(prefix) ? p.slice(prefix.length) : null);

const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

const trailers = ({ epic, base, branch }) => `Yad-Epic: ${epic}\nYad-Base: ${base || 'none'}\nYad-Branch: ${branch || '(detached)'}`;
export const captureMessage = (meta) => `wip(${meta.epic}): capture\n\n${trailers(meta)}\n`;

// One epic's capture: build the tree, and commit it on the epic's branch when its artifacts differ from the
// branch tip. Returns { epic, branch, commit, files } for a commit, { epic, branch, unchanged: true } when
// there was nothing new, or { epic, branch, error } on a failure (reported, never thrown).
function captureEpic(root, git, { name, epic, paths, head, headTree, current, prefix, env }) {
  const branch = wipBranch(name, epic);
  const ref = `refs/heads/${branch}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-capture-'));
  const idx = gitIn(root, env, { GIT_INDEX_FILE: path.join(tmp, 'index'), GIT_LITERAL_PATHSPECS: '1' });
  try {
    const seeded = head ? idx(['read-tree', head]) : idx(['read-tree', '--empty']);
    if (!seeded.ok) return { epic, branch, error: `could not read HEAD's tree: ${seeded.err}` };
    // The paths come on stdin, NUL-separated, so a name holding a space, a quote or a newline is read as
    // written and no command line grows past the system's limit. `-A` adds, updates AND removes.
    // A path that is neither on disk nor in HEAD's tree cannot be added — a file staged and then deleted
    // (`AD`), or deleted on both sides of a merge (`DD`) — and one such path would make `git add` refuse
    // the whole epic, on every capture, until someone fixed the index. It has nothing to capture: drop it.
    const known = new Set(idx(['ls-files', '-z', '--', 'epics', FOUNDATION_DIR]).out.split('\0').filter(Boolean));
    paths = paths.filter((p) => known.has(p) || fs.existsSync(path.join(root, p)) || isLink(path.join(root, p)));
    if (paths.length) {
      const added = idx(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], paths.join('\0'));
      if (!added.ok) return { epic, branch, error: `could not stage the artifacts: ${added.err}` };
    }
    const tree = idx(['write-tree']);
    if (!tree.ok) return { epic, branch, error: `could not write the tree: ${tree.err}` };
    const treeSha = tree.out.trim();
    for (let attempt = 0; attempt < 2; attempt++) {
      const tipR = git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
      const local = tipR.ok ? tipR.out.trim() : null;
      // No local branch, but origin has one (a fresh clone, or the local branch deleted after a push): the
      // capture CONTINUES origin's, or the plain push below could never fast-forward it and the epic's
      // captures would never leave this machine (E43 review 2). A capture by hand fetches these first.
      const remoteR = local ? null : git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}^{commit}`]);
      const tip = local || (remoteR?.ok ? remoteR.out.trim() : null);
      // Nothing new when this epic's artifacts are the same as on the branch tip (or, for a first capture,
      // as in HEAD). Compared on the artifacts only: HEAD moving under the branch changes the ledger and
      // the rest of the tree, and that alone is not a capture.
      const against = tip ? `${tip}^{tree}` : headTree;
      if (against) {
        const diff = git(['diff-tree', '-r', '-z', '--name-only', '--no-renames', against, treeSha]);
        if (!diff.ok) return { epic, branch, error: `could not compare with ${tip ? branch : 'HEAD'}: ${diff.err}` };
        const moved = diff.out.split('\0').filter((p) => p && capturedEpic(underPrefix(p, prefix)) === epic);
        if (!moved.length) return { epic, branch, unchanged: true };
      }
      const parent = tip || head;
      const commit = git(['commit-tree', '--no-gpg-sign', treeSha, ...(parent ? ['-p', parent] : []), '-F', '-'],
        captureMessage({ epic, base: head, branch: current }));
      if (!commit.ok) return { epic, branch, error: `could not commit: ${commit.err}` };
      const sha = commit.out.trim();
      // Compare-and-swap: move the ref only if it is still where it was read. An all-zero old value means
      // "must not exist yet". A lost race re-reads the tip and commits on top of it, once.
      const moved = git(['update-ref', '-m', `yad capture ${epic}`, ref, sha, local || '0'.repeat(sha.length)]);
      if (moved.ok) return { epic, branch, commit: sha, files: paths.filter((p) => capturedEpic(p) === epic).length };
      if (attempt === 1) return { epic, branch, error: `${branch} moved while it was being written — run \`yad capture\` again` };
    }
    return { epic, branch, error: 'unreachable' };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The push, as git arguments: every capture branch of this person in one go. A PLAIN push, never a forced
// one: each capture is built on the last — or, with no local branch, on origin's (see `captureEpic`) — so
// the push is a fast-forward. When it is not — the same person captured the same epic on two machines —
// git refuses that one branch and nothing is overwritten (E43 review: a lease read remote-tracking refs, which a
// single-branch clone never has, so it refused every push after the first; and which an IDE's background
// fetch updates, so it would have let the push overwrite the other machine). `--no-verify`: a team's
// pre-push hook (tests, linters) has no business running on a draft snapshot, and could not run unattended.
export const pushArgs = (name) => [
  '-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=20',
  'push', '--no-verify', '--quiet', 'origin',
  `refs/heads/${WIP_PREFIX}/${name}/*:refs/heads/${WIP_PREFIX}/${name}/*`,
];
// No prompt may ever appear: a hook has no terminal, and a prompt nobody sees hangs the push for ever.
export const pushEnv = (env = process.env) => ({
  GIT_TERMINAL_PROMPT: '0',
  ...(env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=10' }),
});

// When the last push started, per clone — kept in git's own COMMON folder (`--git-common-dir`), so it is
// never committed and every worktree of one clone shares it: they push the same branches.
function pushStatePath(git) {
  const r = git(['rev-parse', '--git-common-dir']);
  return r.ok && r.out.trim() ? path.join(r.out.trim(), 'yad-capture.json') : null;
}

// Push now (a person ran `yad capture`), or start one in the background when due (the hook).
function push(root, git, name, { hook, now, spawner, env }) {
  if (!git(['remote', 'get-url', 'origin']).ok) return { pushed: 'local', why: 'no remote named origin' };
  const statePath = pushStatePath(git);
  const stateFile = statePath && path.resolve(root, statePath);
  if (hook) {
    const last = stateFile ? Number(readJSON(stateFile, {})?.lastPushAt) || 0 : 0;
    if (now - last < PUSH_EVERY_MS) return { pushed: 'later', why: `the last push started under ${PUSH_EVERY_MS / 60000} minutes ago` };
    // Recorded BEFORE the push starts, so two hooks a moment apart cannot both start one.
    if (stateFile) writeJSON(stateFile, { lastPushAt: now });
    try {
      spawner('git', pushArgs(name), { cwd: root, env: { ...env, ...pushEnv(env) }, detached: true, stdio: 'ignore' }).unref();
      return { pushed: 'started' };
    } catch (e) {
      return { pushed: 'failed', why: e.message };
    }
  }
  const r = spawnSync('git', pushArgs(name), { cwd: root, encoding: 'utf8', timeout: 60_000, env: { ...env, ...pushEnv(env) } });
  if (stateFile) writeJSON(stateFile, { lastPushAt: now });
  if (r.status === 0) return { pushed: 'done' };
  // Refused, not failed: origin has a capture branch this one does not continue. The next push is refused
  // the same way, so it is named as stuck — never "rides the next push".
  const refused = [...(r.stderr || '').matchAll(/\[rejected\]\s+(\S+)/g)].map((m) => m[1]);
  if (refused.length) return { pushed: 'refused', branches: refused, why: `origin already has ${refused.join(', ')} with captures this machine does not have (pushed from another machine) — nothing was overwritten` };
  const why = r.error?.code === 'ETIMEDOUT' ? 'the push took over a minute' : ((r.stderr || '').trim().split('\n').pop() || `git exited ${r.status}`);
  return { pushed: 'failed', why };
}

// `yad capture [--no-push] [--hook]`. With `--hook` it is the harness's post-edit command: it never fails,
// never prints to stdout (a harness may read it), and says nothing unless something went wrong.
export async function runCapture(root, { hook = false, noPush = false, now = Date.now(), spawner = spawn, env = process.env } = {}) {
  const quiet = hook;
  const say = (fn, msg) => { if (!quiet) fn(msg); };
  const bail = (msg, extra = {}) => {
    if (quiet) { if (extra.loud) process.stderr.write(`  • yad capture: ${msg}\n`); }
    else { fail(msg); if (extra.hint) hand(extra.hint); process.exitCode = 1; }
    return { captured: [], unchanged: [], errors: [], pushed: null, off: extra.off ?? null };
  };
  const git = gitIn(root, env);
  const top = git(['rev-parse', '--show-toplevel']);
  if (!top.ok) return bail('not a git repository — nothing to capture');
  if (!fs.existsSync(productConfigPath(root))) return bail('not a Product (no .sdlc/hub.json or product.json here) — nothing to capture', { hint: 'run it from the Product root, or pass --dir' });
  const off = captureOff(root, env);
  if (off) {
    say(info, `capture is off — ${off}`);
    return { captured: [], unchanged: [], errors: [], pushed: null, off };
  }
  const name = wipName(git(['config', 'user.name']).out.trim(), git(['config', 'user.email']).out.trim());
  const prefix = git(['rev-parse', '--show-prefix']).out.trim();
  if (!name) return bail('git has no user.name to name the capture branch after', { hint: 'git config user.name "<your name>"', loud: true });

  const headR = git(['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  const head = headR.ok ? headR.out.trim() : null;
  const headTreeR = head ? git(['rev-parse', `${head}^{tree}`]) : null;
  const headTree = headTreeR?.ok ? headTreeR.out.trim() : null;
  const branchR = git(['symbolic-ref', '--short', '-q', 'HEAD']);
  const current = branchR.ok ? branchR.out.trim() : null;

  // A capture by hand first fetches this person's capture branches (no prompts, short), so one with no local
  // copy — a fresh clone, a deleted branch — is continued rather than restarted from HEAD. Not from the hook:
  // an edit must never wait on the network. Offline, it is skipped in silence.
  if (!hook && !noPush && git(['remote', 'get-url', 'origin']).ok) {
    // `--prune`, confined by the refspec to this person's capture copies: a branch deleted on origin (a
    // secret captured by mistake, say) is not continued from a stale copy (E43 review 3). This prune clears
    // every stale copy on the hand path; a LOCAL branch is still pushed back, and the hook, which never
    // fetches, still reads a copy another fetch left. Removing one for good means `git branch -D` and
    // `git branch -dr origin/…` on every machine too (README). The same
    // low-speed limit as the push, so a stalled HTTPS connection gives up instead of holding the capture.
    spawnSync('git', ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=20', 'fetch', '--quiet', '--prune', '--no-tags', 'origin', `+refs/heads/${WIP_PREFIX}/${name}/*:refs/remotes/origin/${WIP_PREFIX}/${name}/*`],
      { cwd: root, stdio: 'ignore', timeout: 30_000, env: { ...env, ...pushEnv(env) } });
  }
  const changed = changedPaths(root, prefix, env);
  if (changed === null) return bail('git could not list the changed files', { loud: true });
  const byEpic = new Map();
  for (const p of changed) {
    const epic = capturedEpic(p);
    if (!epic) continue;
    if (!byEpic.has(epic)) byEpic.set(epic, []);
    byEpic.get(epic).push(p);
  }
  // An epic whose capture branch has work the checkout no longer shows — every edit reverted, or the files
  // deleted — is captured too, so the branch ends on what is really there. Only while the checkout is still
  // on the HEAD that branch was last captured from (`Yad-Base`): once HEAD moves (a pull, a merge, a
  // switch), a difference is other work arriving, not an edit undone, and recording it would add a commit
  // to every old capture branch on every pull.
  const branches = git(['for-each-ref', '--format=%(refname)%00%(trailers:key=Yad-Base,valueonly)', `refs/heads/${WIP_PREFIX}/${name}/`]);
  for (const line of branches.ok ? branches.out.split('\n').filter(Boolean) : []) {
    const [r, base = ''] = line.split('\0');
    const epic = r.slice(`refs/heads/${WIP_PREFIX}/${name}/`.length);
    if (/^EP-[^/]+$/.test(epic) && !byEpic.has(epic) && base.trim() === (head || 'none')) byEpic.set(epic, []);
  }

  const captured = [];
  const unchanged = [];
  const errors = [];
  for (const [epic, paths] of [...byEpic].sort(([a], [b]) => a.localeCompare(b))) {
    const res = captureEpic(root, git, { name, epic, paths, head, headTree, current, prefix, env });
    if (res.error) errors.push(res);
    else if (res.unchanged) unchanged.push(res);
    else captured.push(res);
  }
  for (const e of errors) {
    if (quiet) process.stderr.write(`  • yad capture: ${e.epic}: ${e.error}\n`);
    else warn(`${e.epic}: ${e.error}`);
  }
  for (const c of captured) say(ok, `${c.epic} → ${c.branch} (${c.files} file(s))`);
  if (!captured.length && !errors.length) say(info, byEpic.size ? 'nothing new since the last capture' : 'no changed artifacts to capture');

  let pushed = null;
  if (!noPush && (captured.length || !hook)) {
    // Only this person's branches exist to push; with none at all there is nothing to send.
    const any = git(['for-each-ref', '--count=1', '--format=%(refname)', `refs/heads/${WIP_PREFIX}/${name}/`]);
    if (any.ok && any.out.trim()) {
      pushed = push(root, git, name, { hook, now, spawner, env });
      if (pushed.pushed === 'local') say(info, `local only — ${pushed.why}; the captures stay on this machine`);
      else if (pushed.pushed === 'done') say(ok, `pushed ${WIP_PREFIX}/${name}/* to origin`);
      else if (pushed.pushed === 'failed') {
        if (quiet) process.stderr.write(`  • yad capture: push failed — ${pushed.why}\n`);
        else { warn(`push failed — ${pushed.why}; the captures are safe on this machine and ride the next push`); }
      } else if (pushed.pushed === 'refused') {
        if (quiet) process.stderr.write(`  • yad capture: push refused — ${pushed.why}\n`);
        else {
          warn(`push refused — ${pushed.why}; it stays refused while both machines keep their own copy`);
          hand(`keep origin's: \`git branch -D ${pushed.branches.join(' ')}\` here, then \`yad capture\` continues it (this machine's un-pushed captures of that epic are dropped)`);
        }
      }
    }
  }
  if (!quiet && errors.length) process.exitCode = 1;
  return { name, captured, unchanged: unchanged.map((u) => u.epic), errors, pushed, off: null };
}
