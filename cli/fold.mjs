// `yad fold <epic> <step>` (E44) — the step-boundary fold: one clean commit for one authoring step.
//
// E43 saves every draft of an artifact to a private `yad/wip/<name>/<epic>` branch, as unsigned `wip(…)`
// commits. At the end of an authoring step, this command makes the ONE commit the record keeps:
// `docs(<epic>): author <step>`. The decisions were the user's (2026-09-25):
//   1. THE DRAFT BRANCH IS LEFT ALONE. The fold does not delete, reset or mark it. E95 (rework measurement)
//      reads the draft history, and deleting a capture branch is the multi-machine trap E43's reviews kept
//      finding (another machine pushes its copy back). Capture's own rule makes the next capture a no-op:
//      the folded files now equal both HEAD and the branch tip, and the branch's `Yad-Base` is no longer
//      HEAD, so nothing is "undone" either.
//   2. ONLY THIS STEP'S FILES — `artifactPaths()`, the list a review of the step covers (architecture is
//      architecture.md + contract.md + the contract lock). Other changed artifacts of the epic are named and
//      left on disk, so another step's half-written draft never lands in this step's commit.
//   3. TRIGGER: this command. The authoring skills run it where they used to say "commit the artifact";
//      `yad open-pr` on a review branch only WARNS about step files that were never folded.
//   4. THE LEDGER FOLLOWS `ledger` MODE. `local`: this machine writes the epic's ledger, so its changes go
//      in the same commit — one step boundary, one commit. `verified`: CI writes the ledger at merge, so the
//      fold leaves it out — except files being CREATED (the seed of a new epic), which is exactly the case
//      `ledger-guard` exempts ("creation, not mutation", #162) and the only way the seed reaches the
//      default branch.
//
// THE FOLD IS A REAL `git commit`, not capture's plumbing: it is the commit that gets signed, so it honours
// `commit.gpgsign` and the person's own commit hooks. `--only` with the step's paths commits exactly those
// files as they are on disk and leaves anything else the person staged still staged, uncommitted.
// Where it may run: in `verified` mode never on the default branch (artifacts reach it only through the
// review PR); in `local` mode anywhere — a solo person commits on main.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ok, info, warn, fail, hand, readJSON } from './lib.mjs';
import { productConfigPath, isVerifiedLedger } from './manifest.mjs';
import { STEPS, FOUNDATION_EPIC, FOUNDATION_DIR, artifactBase, artifactPaths, epicRoot } from './epic-state.mjs';
import { capturedEpic, gitIn, statusEntries, wipName, wipBranch, runCapture } from './capture.mjs';
import { resolveDefaultBranch } from './hubcommit.mjs';

// The authoring steps a fold can close: every catalogue step of kind `author` that writes a Shape artifact.
// The Build steps (spec, tasks, implement, checks) write code in another repo and have no artifact here.
export const FOLD_STEPS = STEPS.filter((s) => s.kind === 'author' && s.artifact).map((s) => s.id);

// The epic's folder, relative to the Product root.
export const epicRel = (epic) => (epic === FOUNDATION_EPIC ? FOUNDATION_DIR : `epics/${epic}`);

// The Product-relative paths a step covers: the files its review covers (`artifactPaths` — a folder,
// `stories`, covers everything under it), plus what the step's skill writes beside them and commits with
// them — the "artifact set" each skill names. None of these extras is ledger: `ledger-guard` never reads them.
const STEP_EXTRAS = {
  'ui-design': ['DESIGN.md', '.sdlc/design-links.json'],
  'test-cases': ['.sdlc/test-links.json'],
};
export function stepPaths(epic, stepId) {
  const step = STEPS.find((s) => s.id === stepId && s.kind === 'author' && s.artifact);
  if (!step) return null;
  return [...artifactPaths(artifactBase(step.artifact)), ...(STEP_EXTRAS[stepId] || [])].map((p) => `${epicRel(epic)}/${p}`);
}
const covers = (paths, p) => paths.some((s) => p === s || p.startsWith(`${s}/`));

export const foldMessage = ({ epic, step, folded }) =>
  `docs(${epic}): author ${step}\n\nYad-Epic: ${epic}\nYad-Step: ${step}\nYad-Folded: ${folded || 'none'}\n`;

// Sort one epic's changed files into what the fold takes and what it leaves. `entries` are
// `statusEntries` rows; `verified` is the ledger mode. Pure, so every rule is testable without git.
//   step    — the step's own artifacts (always taken)
//   ledger  — the epic's ledger files taken (local mode: every change; verified: only files being created)
//   ci      — ledger changes left for CI (verified mode, a file that already exists)
//   other   — the epic's other changed artifacts, left on disk
export function sortChanges(entries, { epic, step, verified }) {
  const own = stepPaths(epic, step) || [];
  const dir = `${epicRel(epic)}/`;
  const out = { step: [], ledger: [], ci: [], other: [] };
  for (const { xy, path: p } of entries) {
    if (!p.startsWith(dir)) continue;
    const artifactOf = capturedEpic(p);
    if (covers(own, p)) out.step.push(p);
    else if (artifactOf === epic) out.other.push(p);
    else if (artifactOf === null) {
      // A ledger file. `??` is untracked, `A` in the first column is added to the index: both are a file
      // being created. Anything else already exists in HEAD.
      const creating = xy === '??' || xy[0] === 'A';
      (!verified || creating ? out.ledger : out.ci).push(p);
    }
  }
  return out;
}

// The authoring step a review branch's artifact-base belongs to (`stories-S01` → `stories`).
export function authorStepOf(base) {
  const b = /^stories-S\d+$/i.test(base) ? 'stories' : base;
  return STEPS.find((s) => s.kind === 'author' && s.artifact && artifactBase(s.artifact) === b)?.id || b;
}

// The step files of a review branch that have changes no fold has committed — what `yad open-pr` warns about.
export function unfoldedPaths(root, epic, base, env = process.env) {
  const git = gitIn(root, env);
  const prefix = git(['rev-parse', '--show-prefix']);
  if (!prefix.ok) return [];
  const entries = statusEntries(root, prefix.out.trim(), env) || [];
  const own = stepPaths(epic, authorStepOf(base)) || [];
  // A per-story branch (`stories-S01`) reviews that one story: another story's edit is not its business.
  const story = /^stories-S\d+$/i.test(base) ? base.toLowerCase() : null;
  return entries.map((e) => e.path).filter((p) => covers(own, p) && (!story || artifactBase(p).toLowerCase() === story));
}

// `yad fold <epic> <step>`. Returns a plain object (E1 turns it into the `--json` answer); a refusal
// prints, sets a non-zero exit code and returns undefined.
export async function runFold(root, { epic, step, env = process.env, capture = runCapture } = {}) {
  const refuse = (msg, hint) => { fail(msg); if (hint) hand(hint); process.exitCode = 1; };
  if (!epic || !step) return refuse('yad fold needs an epic and a step', `usage: yad fold <epic> <step>   (steps: ${FOLD_STEPS.join(', ')})`);
  if (!/^EP-[a-z0-9-]+$/.test(epic)) return refuse(`not an epic id: ${epic}`, 'an epic id looks like EP-<slug> (the Product level is EP-foundation)');
  if (!FOLD_STEPS.includes(step)) return refuse(`${step} is not an authoring step with an artifact`, `steps: ${FOLD_STEPS.join(', ')}`);
  // The Product level has one folder, `foundation/`; a feature step never runs there, and `foundation`
  // never runs in an epic. (`discovery` is the old spelling, which lived in an ordinary epic folder.)
  if ((step === 'foundation') !== (epic === FOUNDATION_EPIC) && step !== 'discovery') {
    return refuse(`${step} is not a step of ${epic}`, 'the Product level folds with: yad fold EP-foundation foundation');
  }
  const git = gitIn(root, env);
  if (!git(['rev-parse', '--show-toplevel']).ok) return refuse('not a git repository — nothing to fold');
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/hub.json or product.json here)', 'run it from the Product root, or pass --dir');
  if (!fs.existsSync(epicRoot(root, epic))) return refuse(`no ${epicRel(epic)}/ in this Product`);

  const hub = readJSON(productConfigPath(root), {}) || {};
  const verified = isVerifiedLedger(hub);
  const branchR = git(['symbolic-ref', '--short', '-q', 'HEAD']);
  const branch = branchR.ok ? branchR.out.trim() : null;
  if (verified && !branch) {
    return refuse('not on a branch (a detached HEAD) — with a verified ledger, a fold belongs on the step\'s authoring branch',
      `switch to it first (git switch -c ${step}/${epic}), then run yad fold again`);
  }
  // `git commit --only` cannot make a partial commit in the middle of a merge, and staging the step's files
  // first would leave them staged for a commit that never comes. Refuse before touching anything.
  const IN_PROGRESS = { MERGE_HEAD: 'merge', CHERRY_PICK_HEAD: 'cherry-pick', REVERT_HEAD: 'revert', 'rebase-merge': 'rebase', 'rebase-apply': 'rebase' };
  const busy = Object.keys(IN_PROGRESS)
    .find((f) => { const r = git(['rev-parse', '--git-path', f]); return r.ok && fs.existsSync(path.resolve(root, r.out.trim())); });
  if (busy) return refuse(`a ${IN_PROGRESS[busy]} is in progress — finish or abort it first, then run yad fold again`);
  if (verified) {
    const def = resolveDefaultBranch((...a) => { const r = git(a); return { ok: r.ok, stdout: r.out.trim() }; }, hub);
    if (branch === def) {
      return refuse(`on the default branch '${def}' — with a verified ledger, artifacts reach it only through the review PR`,
        `switch to the step's authoring branch first (git switch -c ${step}/${epic}), then run yad fold again`);
    }
  }

  // One last capture, so the draft branch holds exactly what is being folded — nothing is ever lost. The
  // hook's quiet path: it never fails, and its push is the throttled background one.
  try { await capture(root, { hook: true, env }); } catch { /* a capture problem never blocks the fold */ }
  const name = wipName(git(['config', 'user.name']).out.trim(), git(['config', 'user.email']).out.trim());
  const tipR = name ? git(['rev-parse', '--verify', '-q', `refs/heads/${wipBranch(name, epic)}^{commit}`]) : null;
  const folded = tipR?.ok ? tipR.out.trim() : null;

  const prefix = git(['rev-parse', '--show-prefix']).out.trim();
  const entries = statusEntries(root, prefix, env);
  if (entries === null) return refuse('git could not list the changed files');
  const sorted = sortChanges(entries, { epic, step, verified });
  // What `git add` can take: a path on disk or in the index. A deletion already staged (`D `, from `git rm`
  // or the old half of a `git mv`) is in neither, and `git add` would refuse it — but it is in HEAD, so
  // `commit --only` commits the deletion. A path added and then deleted (`AD`) is in none of the three and
  // has nothing to fold.
  const known = new Set(git(['ls-files', '-z', '--', epicRel(epic)]).out.split('\0').filter(Boolean)); // relative to the Product, as `git ls-files` prints from its cwd
  const onDisk = (p) => fs.existsSync(path.join(root, p)) || (() => { try { return fs.lstatSync(path.join(root, p)).isSymbolicLink(); } catch { return false; } })();
  const stagedDeletion = new Set(entries.filter((e) => e.xy[0] === 'D').map((e) => e.path));
  const addable = (p) => known.has(p) || onDisk(p);
  const foldable = (p) => addable(p) || stagedDeletion.has(p);
  // A path can be listed twice: `git rm --cached` shows it as a staged deletion (`D `) AND untracked (`??`).
  const files = [...new Set([...sorted.step, ...sorted.ledger])].filter(foldable);
  // That case cannot be folded: the fold commits files as they are on disk, and `commit --only` cannot
  // record the deletion of a file that is still there. `git add` would quietly undo the person's choice.
  const untracked = files.filter((p) => stagedDeletion.has(p) && onDisk(p));
  if (untracked.length) {
    return refuse(`staged as deleted but still on disk (git rm --cached): ${untracked.join(', ')}`,
      'yad fold commits files as they are on disk — delete the file to fold its deletion, or `git add` it back to keep it');
  }
  if (!sorted.step.filter(foldable).length) {
    return refuse(`nothing to fold — ${step}'s files have no changes since the last commit`,
      sorted.other.length ? `changed, but not ${step}'s: ${sorted.other.join(', ')}` : null);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-fold-'));
  try {
    const spec = path.join(tmp, 'paths');
    const addSpec = path.join(tmp, 'add');
    const msg = path.join(tmp, 'message');
    fs.writeFileSync(spec, files.join('\0'));
    const toAdd = files.filter(addable);
    fs.writeFileSync(addSpec, toAdd.join('\0'));
    fs.writeFileSync(msg, foldMessage({ epic, step, folded }));
    const lit = { ...env, GIT_LITERAL_PATHSPECS: '1' };
    // New files must be known to git before `commit --only` can take them; the step's own paths only.
    // Never with an empty list: `git add -A` given no pathspec stages EVERY change in the repository.
    const added = toAdd.length ? spawnSync('git', ['add', '-A', `--pathspec-from-file=${addSpec}`, '--pathspec-file-nul'], { cwd: root, encoding: 'utf8', env: lit }) : { status: 0 };
    if (added.status !== 0) return refuse(`could not stage ${step}'s files: ${(added.stderr || '').trim()}`);
    // stdin stays the terminal's: a signing key may ask for its passphrase.
    const commit = spawnSync('git', ['commit', '--only', '--quiet', '-F', msg, `--pathspec-from-file=${spec}`, '--pathspec-file-nul'],
      { cwd: root, encoding: 'utf8', env: lit, stdio: ['inherit', 'pipe', 'pipe'] });
    if (commit.status !== 0) {
      return refuse(`git commit failed: ${((commit.stderr || '') + (commit.stdout || '')).trim().split('\n').pop() || `git exited ${commit.status}`}`,
        'the step\'s files are staged; fix the cause (a commit hook, a signing key) and run yad fold again');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const sha = git(['rev-parse', 'HEAD']).out.trim();
  const subject = `docs(${epic}): author ${step}`;
  ok(`${subject} → ${sha.slice(0, 7)} (${files.length} file(s))`);
  if (sorted.ledger.length) info(`with the ledger (${verified ? 'a new epic\'s seed' : 'ledger: local'}): ${sorted.ledger.length} file(s)`);
  if (sorted.ci.length) info(`ledger changes left for CI (ledger: verified): ${sorted.ci.join(', ')}`);
  if (sorted.other.length) warn(`changed but not ${step}'s, left on disk: ${sorted.other.join(', ')}`);
  if (!folded) info('no draft branch to point at — capture is off or never ran (Yad-Folded: none)');
  return { epic, step, commit: sha, subject, branch, folded, files, ledger: sorted.ledger, leftForCi: sorted.ci, leftOnDisk: sorted.other };
}
