// `yad checkpoint` — commit the machine-written back-half hub state (trust-log / build-log /
// build-state) as one audit-trail commit. This is the back-half analogue of the front-half gate sync
// (cli/gate.mjs): the SDLC back half (yad-run, yad-engineer-review) WRITES these ledgers into the
// working tree but never commits them, so teammates/CI/`yad status` on other machines see stale trust
// evidence. checkpoint lands them with a `chore(hub): ...` message.
//
// It also carries the back-half story `status:` flip (approved → in-build/shipped) that
// yad-engineer-review writes into stories/<id>.md but no command committed — the #112 drift where
// build-log said shipped while the story artifact still said approved. Only story files with build-log
// ship evidence are carried (storyStatusPathspecs), AND only when their staged change is the `status:`
// line alone (stagedStoryIsStatusOnly) — so it stays a back-half record, never a raw edit that would
// slip prose onto the default branch under a `[skip ci]` commit that bypasses review.
//
// Two invariants keep it out of the gates' way:
//   1. It stages ONLY the back-half ledgers + build-log-backed story flips by an explicit allowlist —
//      never `git add -A`, which would sweep the CI-owned front-half ledger (state/approvals/
//      comments/hub-prs.json, reviews/*.md) and trip the ledger-guard gate. (ledger-guard does NOT
//      protect stories/*.md, and this commits to the default branch, never a PR range, so the carried
//      story flip is safe.)
//   2. It commits ONLY on the default branch (mirroring gate.mjs), so the commit never enters a PR's
//      base..HEAD range — where verified-commits would fail an unsigned commit and its [skip ci]
//      marker would strand the PR's required checks.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, info, fail, hand, exists, pushWithRebase } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { loadHub } from './gate.mjs';
import { resolveCommitterLogin } from './platform.mjs';
import { hubGit, resolveDefaultBranch, guardDefaultBranch } from './hubcommit.mjs';
import { readShips, writeRetroShip } from './ledger.mjs';
import { readFrontmatter } from './epic-state.mjs';

// The machine-written back-half ledgers, relative to an epic's dir. The two append-only logs are
// shard-then-fold (cli/ledger.mjs): each is a folded file PLUS a shard dir of loose per-entry files —
// both are allowlisted so a checkpoint commits new shards and any `yad tidy up` fold. `build-state` is
// the whole dir (one JSON per story). Keep in sync with cli/manifest.mjs epicFiles.
const BACK_HALF = [
  '.sdlc/trust-log.json', '.sdlc/trust-log',
  '.sdlc/build-log.json', '.sdlc/build-log',
  '.sdlc/build-state',
];

// PURE — the repo-relative pathspecs to stage: every back-half ledger that exists under any epic.
// Explicit allowlist by design (see invariant 1 above).
export function backHalfPathspecs(root) {
  const epicsDir = path.join(root, 'epics');
  if (!fs.existsSync(epicsDir)) return [];
  const out = [];
  for (const e of fs.readdirSync(epicsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    for (const rel of BACK_HALF) {
      if (fs.existsSync(path.join(epicsDir, e.name, rel))) out.push(path.posix.join('epics', e.name, rel));
    }
  }
  return out;
}

// The two back-half story statuses. `in-build` = some of a story's tasks shipped; `shipped` = all did.
// Both are set ONLY by the build half (yad-engineer-review), never by the front-gate ladder
// (cli/artifact-status.mjs PRESERVEs them). See #112.
const BACK_HALF_STATUSES = new Set(['in-build', 'shipped']);

// The repo-relative pathspecs for story files whose back-half `status:` flip we carry alongside the
// ledgers (#112). The flip is authored by yad-engineer-review into the working tree but no command
// committed it, so it drifted (build-log said shipped, stories/<id>.md still said approved) and the
// only recovery was a raw git-to-main push. A story is a CANDIDATE iff BOTH hold:
//   1. it has >=1 ship recorded in build-log (the build-half evidence), and
//   2. its current frontmatter `status:` is a back-half value (in-build | shipped).
// A candidate is only actually carried when its staged diff is the `status:` line ALONE — runCheckpoint
// drops any candidate whose working tree also changed prose/other frontmatter (stagedStoryIsStatusOnly),
// so an unrelated edit can never ride into a `chore(hub) … [skip ci]` commit that bypasses review.
// The shared `git add`/`diff --cached` machinery then commits ONLY the ones that actually differ from
// HEAD (so a story already committed at shipped is a no-op).
//
// A corrupt build-log in one epic must not block checkpointing every OTHER epic's ledgers, so a
// readShips throw is caught per epic (that epic simply carries no story flip; its corrupt ledger is
// still staged by backHalfPathspecs for a human to see).
export function storyStatusPathspecs(root) {
  const epicsDir = path.join(root, 'epics');
  if (!fs.existsSync(epicsDir)) return [];
  const out = [];
  for (const e of fs.readdirSync(epicsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const epicDir = path.join(epicsDir, e.name);
    const storiesDir = path.join(epicDir, 'stories');
    if (!fs.existsSync(storiesDir)) continue;
    let shipped;
    try { shipped = new Set(readShips(epicDir).map((s) => s.story)); }
    catch { continue; } // corrupt build-log — skip story-carry for this epic, leave its ledger to a human
    for (const d of fs.readdirSync(storiesDir, { withFileTypes: true })) {
      if (!d.isFile() || !d.name.endsWith('.md')) continue;
      const storyId = d.name.slice(0, -3);
      if (!shipped.has(storyId)) continue;
      if (BACK_HALF_STATUSES.has(readFrontmatter(path.join(storiesDir, d.name)).status)) {
        out.push(path.posix.join('epics', e.name, 'stories', d.name));
      }
    }
  }
  return out;
}

// PURE — turn the staged pathspecs into the subject label + the body's file list. A story id is pulled
// from any file that carries one (`build-state/<story>.json`, a `trust-log/`/`build-log/` shard whose
// name starts with the story id); the folded logs are epic-scoped. Prefer the most specific label.
export function summarizeStaged(files = []) {
  const stories = new Set();
  const epics = new Set();
  const basenames = [];
  for (const f of files) {
    // A back-half ledger (…/.sdlc/…) or a carried story-status flip (…/stories/<id>.md, #112).
    const m = f.match(/^epics\/([^/]+)\/(?:\.sdlc\/(.+)|stories\/(.+\.md))$/);
    if (!m) continue;
    const [, epic] = m;
    const rest = m[2] ?? m[3];
    epics.add(epic);
    // the first `…-S0N` token in the filename is the story id (ids contain hyphens; `[\w-]` stops at `/`)
    const s = rest.match(/([A-Za-z][\w-]*?-S\d+)/);
    if (s) stories.add(`${epic}/${s[1]}`);
    basenames.push(rest);
  }
  let label;
  if (stories.size === 1) label = [...stories][0];
  else if (stories.size > 1) label = `${stories.size} stories`;
  else if (epics.size === 1) label = [...epics][0];
  else label = `${epics.size} epics`;
  return { label, basenames };
}

// Collapse any whitespace/newline runs to a single space — keeps a hostile `git user.name` or a stray
// path from breaking the one-line subject or injecting a fake trailer line.
const oneLine = (s = '') => String(s).replace(/\s+/g, ' ').trim();

// `@login` from the roster (the auditable handle the user asked for), else the raw git user.name,
// else a stable placeholder so the subject is never empty.
export function checkpointAuthor(login, name) {
  if (login) return `@${oneLine(login)}`;
  const n = oneLine(name);
  return n || 'unknown';
}

// PURE — the audit-trail commit message. The subject passes the hub commit-message gate (valid type
// `chore`, optional scope `hub`, non-empty description, no trailing period). No Task trailer and no
// Co-Authored-By footer: this is human-owned machine state, not an authored code change. `label` and
// `author` are collapsed to one line so nothing can split the subject or forge a trailer.
export function buildCheckpointMessage({ label, author, basenames = [] }) {
  const subject = `chore(hub): sync back-half state — ${oneLine(label)} by ${oneLine(author)} [skip ci]`;
  const body = basenames.length ? `Updated: ${basenames.join(', ')}` : '';
  return body ? `${subject}\n\n${body}` : subject;
}

// True iff a story file's STAGED diff changes ONLY the frontmatter `status:` line — every added or
// removed content line is a `status:` line. A newly-added file (all lines added) or any prose/other
// edit fails, so only a clean flip is carried into the `[skip ci]` chore commit; anything broader is
// left for a reviewed change (#112 review-bypass guard). `git` is a hubGit-style accessor.
export function stagedStoryIsStatusOnly(git, file) {
  const d = git('diff', '--cached', '-U0', '--', file);
  if (!d.ok) return false;
  let changes = 0;
  for (const ln of d.stdout.split('\n')) {
    if (ln.startsWith('+++') || ln.startsWith('---') || ln.startsWith('@@')) continue; // headers/hunks
    if (ln.startsWith('+') || ln.startsWith('-')) {
      if (!/^status:\s*\S/.test(ln.slice(1).trimStart())) return false; // a non-status change ⇒ not status-only
      changes++;
    }
  }
  return changes > 0;
}

// --retro-ship orchestration (#142): validate the target, then write the retroactive ship shard so the
// normal checkpoint path carries the story's already-made `status:` flip. Returns { ok, file } — ok:false
// (with a printed reason) aborts the commit; `file` is the shard just written, so a dry run can delete it
// and leave no side effect. Does NOT author the story frontmatter — it only supplies the missing
// evidence, and the human must have ALREADY flipped `status:` to a back-half value in the working tree.
export function recordRetroShip(root, { epic, story, repo, task, mergeCommit, today }) {
  if (!epic || !story) { fail('--retro-ship needs <epic>/<story> (e.g. --retro-ship EP-foo/EP-foo-S01)'); return { ok: false }; }
  if (!repo) { fail('--retro-ship needs --repo <name> (the repo the story shipped in)'); return { ok: false }; }
  const epicDir = path.join(root, 'epics', epic);
  const storyRel = path.posix.join('epics', epic, 'stories', `${story}.md`);
  const storyFile = path.join(epicDir, 'stories', `${story}.md`);
  if (!exists(epicDir)) { fail(`no epic ${epic} under epics/`); return { ok: false }; }
  if (!exists(storyFile)) { fail(`no story ${story} under epics/${epic}/stories/`); return { ok: false }; }

  // Evidence and the flip must land TOGETHER — the #112 no-drift invariant. Refuse unless the human has
  // already flipped the story frontmatter to a back-half status in the working tree; otherwise the ship
  // shard would commit while the artifact still says e.g. `approved` — the very drift #112 prevents.
  if (!BACK_HALF_STATUSES.has(readFrontmatter(storyFile).status)) {
    fail(`${story} frontmatter is not at in-build|shipped`);
    hand(`set \`status: shipped\` in ${storyRel} first, then re-run — the ship and the flip land in one commit`);
    return { ok: false };
  }

  let res;
  try { res = writeRetroShip(epicDir, { story, repo, task, mergeCommit, shippedAt: today }); }
  catch (e) { fail(`could not record retroactive ship — ${e.message}`); return { ok: false }; }
  if (!res.written) {
    fail(`${story} already has a build-log ship — it is not pre-tracking; use the normal ship/checkpoint flow`);
    return { ok: false };
  }
  ok(`recorded retroactive ship for ${story} (${repo})${mergeCommit ? ` @ ${mergeCommit}` : ''}`);
  return { ok: true, file: res.file };
}

// Undo a retro shard a dry run wrote so the preview leaves NO side effect: delete the shard, and if its
// `.sdlc/build-log/` dir was created just for it (now empty), drop that too. Best-effort — a non-empty
// dir (pre-existing shards) or a benign rmdir race is ignored.
function cleanupRetroShard(file) {
  fs.rmSync(file, { force: true });
  try { fs.rmdirSync(path.dirname(file)); } catch { /* not empty / already gone — leave it */ }
}

export async function runCheckpoint(root, opts = {}) {
  log(c.bold('\nyad checkpoint'));
  if (!exists(path.join(root, '.git'))) { fail('not a git repo'); process.exitCode = 1; return; }
  if (!exists(path.join(root, PROJECT_FILES.hubConfig))) {
    fail('no .sdlc/hub.json — checkpoint commits the hub back-half ledger; run it from the product hub');
    process.exitCode = 1;
    return;
  }

  const { hub } = loadHub(root);
  const git = hubGit(root);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  const defaultBranch = resolveDefaultBranch(git, hub);

  // Default-branch guard (invariant 2) — shared with `yad tidy up`.
  if (!guardDefaultBranch(branch, defaultBranch, { allowBranch: opts.allowBranch, cmd: 'yad checkpoint' })) return;

  // --retro-ship (#142): record a retroactive build-log ship for a PRE-TRACKING story (merged before
  // the back-half ledger existed, so it has no ship and its `status:` flip can't be carried). Done
  // AFTER the branch guard so we never leave a dangling shard on the wrong branch; the flip the human
  // already wrote is then carried by the normal storyStatusPathspecs path below — no raw git needed.
  let retroFile;
  if (opts.retroShip) {
    const r = recordRetroShip(root, opts.retroShip);
    if (!r.ok) { process.exitCode = 1; return; }
    retroFile = r.file;
  }

  // The machine ledgers PLUS any build-log-backed story `status:` flip (#112) — one commit records
  // both, so the story artifact never drifts from build-log and no raw git-to-main push is needed.
  const pathspecs = [...backHalfPathspecs(root), ...storyStatusPathspecs(root)];
  if (!pathspecs.length) { info('no back-half ledgers found — nothing to checkpoint'); return; }

  // Stage the allowlist. `git add -- <spec>` picks up new + modified files, and deletions of tracked
  // files WITHIN a still-present spec (e.g. a removed build-state/<story>.json). A wholesale-deleted
  // top-level ledger is intentionally NOT staged (its spec drops out on the existence check) — an
  // append-only audit ledger vanishing is an anomaly a human should see, not something to auto-commit.
  const add = git('add', '--', ...pathspecs);
  if (!add.ok) { fail(`git add failed — ${add.stderr.split('\n')[0] || add.code}`); process.exitCode = 1; return; }

  // #112 review-bypass guard: a story is only carried when its staged change is the `status:` line
  // ALONE. Unstage any candidate whose working tree also touched prose/other frontmatter — those
  // belong in a reviewed change, not a `[skip ci]` chore commit. Ledgers and clean flips are untouched.
  const storyStaged = git('diff', '--cached', '--name-only', '--', ...pathspecs).stdout
    .split('\n').filter((f) => /\/stories\/[^/]+\.md$/.test(f));
  for (const f of storyStaged) {
    if (!stagedStoryIsStatusOnly(git, f)) {
      git('reset', '-q', '--', f);
      info(`skipped ${f} — its change is more than the status: line; commit it through review`);
    }
  }

  if (git('diff', '--cached', '--quiet', '--', ...pathspecs).ok) {
    info('back-half state unchanged — nothing to commit');
    return;
  }
  // The exact files staged from the allowlist — all known to git by construction, so they are the
  // pathspec for the commit (a directory spec like build-state/ would make `git commit -- <dir>` fail
  // when the dir is empty, e.g. created before its first story JSON). This also scopes the commit to
  // ONLY the allowlist, so any unrelated pre-staged file never rides along.
  const staged = git('diff', '--cached', '--name-only', '--', ...pathspecs).stdout.split('\n').filter(Boolean);

  const { label, basenames } = summarizeStaged(staged);
  const author = checkpointAuthor(resolveCommitterLogin(root, hub?.roster || []), git('config', 'user.name').stdout);
  const message = buildCheckpointMessage({ label, author, basenames });

  if (opts.dryRun) {
    log('\n' + c.dim(message) + '\n');
    git('reset', '-q', '--', ...pathspecs); // restore the index — a dry run must not leave things staged
    // A --retro-ship dry run wrote a shard so the flip could be PREVIEWED above; undo it now so the dry
    // run leaves no side effect on disk (git reset only unstaged it, back to untracked).
    if (retroFile) cleanupRetroShard(retroFile);
    info('dry run — not committed');
    return { message };
  }

  const cm = git('commit', '-m', message, '--', ...staged);
  if (!cm.ok) {
    git('reset', '-q', '--', ...pathspecs); // don't leave the ledgers staged for an unrelated commit to sweep up
    // The retro shard stays on disk (untracked) — a follow-up `yad checkpoint` picks it up and carries
    // the flip; re-running `--retro-ship` would refuse ("already has a build-log ship").
    fail(`git commit failed — ${cm.stderr.split('\n')[0] || cm.code}`);
    process.exitCode = 1;
    return { message };
  }
  ok(`checkpointed ${staged.length} file(s): ${c.dim(label)}`);

  if (!opts.push) return { message };
  // Push HEAD to its OWN branch — never to `defaultBranch` blindly. On the default branch these are the
  // same; with --allow-branch on a WIP branch, pushing HEAD:defaultBranch would publish the whole WIP
  // branch to the default branch (bypassing review), so the target is always the branch we are on.
  if (pushWithRebase(root, branch).ok) { ok(`pushed to origin/${branch}`); return { message }; }
  fail(`could not push to origin/${branch} — a protected branch, or the append-only ledgers hit an unresolvable rebase conflict`);
  hand(`run \`git pull --rebase\` and re-run \`yad checkpoint --push\``);
  process.exitCode = 1;
  return { message };
}
