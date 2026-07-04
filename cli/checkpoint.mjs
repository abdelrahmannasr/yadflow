// `yad checkpoint` — commit the machine-written back-half hub state (trust-log / build-log /
// build-state) as one audit-trail commit. This is the back-half analogue of the front-half gate sync
// (cli/gate.mjs): the SDLC back half (yad-run, yad-engineer-review) WRITES these ledgers into the
// working tree but never commits them, so teammates/CI/`yad status` on other machines see stale trust
// evidence. checkpoint lands them with a `chore(hub): ...` message.
//
// Two invariants keep it out of the gates' way:
//   1. It stages ONLY the three back-half ledgers by an explicit allowlist — never `git add -A`,
//      which would sweep the CI-owned front-half ledger (state/approvals/comments/hub-prs.json,
//      reviews/*.md) and trip the ledger-guard gate.
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

// PURE — turn the staged pathspecs into the subject label + the body's file list. A story id is pulled
// from any file that carries one (`build-state/<story>.json`, a `trust-log/`/`build-log/` shard whose
// name starts with the story id); the folded logs are epic-scoped. Prefer the most specific label.
export function summarizeStaged(files = []) {
  const stories = new Set();
  const epics = new Set();
  const basenames = [];
  for (const f of files) {
    const m = f.match(/^epics\/([^/]+)\/\.sdlc\/(.+)$/);
    if (!m) continue;
    const [, epic, rest] = m;
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

  const pathspecs = backHalfPathspecs(root);
  if (!pathspecs.length) { info('no back-half ledgers found — nothing to checkpoint'); return; }

  // Stage the allowlist. `git add -- <spec>` picks up new + modified files, and deletions of tracked
  // files WITHIN a still-present spec (e.g. a removed build-state/<story>.json). A wholesale-deleted
  // top-level ledger is intentionally NOT staged (its spec drops out on the existence check) — an
  // append-only audit ledger vanishing is an anomaly a human should see, not something to auto-commit.
  const add = git('add', '--', ...pathspecs);
  if (!add.ok) { fail(`git add failed — ${add.stderr.split('\n')[0] || add.code}`); process.exitCode = 1; return; }
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
    info('dry run — not committed');
    return { message };
  }

  const cm = git('commit', '-m', message, '--', ...staged);
  if (!cm.ok) {
    git('reset', '-q', '--', ...pathspecs); // don't leave the ledgers staged for an unrelated commit to sweep up
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
