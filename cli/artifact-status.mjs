// `yad sync-status [epic]` — reconcile each artifact's frontmatter `status:` with the real
// source of truth, the per-epic state machine in .sdlc/state.json. The authoring skills hard-code
// `status: draft` at creation and never update it, so artifacts read as "draft" long after their
// gate has passed. This derives draft / in-review / approved from the step statuses and rewrites
// only the `status:` line — advance-only, and never touching build-owned values.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, info, readJSONStrict, writeFileAtomic, refuseLinkedWrite } from './lib.mjs';
import {
  epicIds, epicRoot, artifactBase, artifactFromBase, findReviewStep, DISCOVERY_FILES, FOUNDATION_FILES, isPassed, stepStatus, FRONTMATTER_BLOCK,
} from './epic-state.mjs';
import { epicFiles } from './manifest.mjs';

// The Shape gate lifecycle this command manages. Forward-only: a status is only ever moved UP this
// ladder, so a re-run never regresses anything.
const RANK = { draft: 0, 'in-review': 1, approved: 2 };

// Values owned by other parts of the workflow — left untouched. `locked` is the contract surface;
// `in-build` / `shipped` are set by Build (engineer-review) per story; `ready-for-build`,
// `done`, `blocked` are roll-ups/states we must not overwrite from the Shape gate view.
const PRESERVE = new Set(['locked', 'in-build', 'shipped', 'ready-for-build', 'done', 'blocked']);

// The per-epic artifact files this command considers (bases). Story files are handled separately
// because they live under stories/ and all map to the single stories / stories-review step pair.
const ARTIFACT_FILES = ['analysis.md', 'epic.md', 'architecture.md', 'contract.md', 'ui-design.md', 'test-cases.md'];

// The desired Shape gate status for an artifact base, derived purely from state.json. Returns null
// when the chain has no steps for this base (nothing to manage) — e.g. contract has no own step.
export function desiredStatus(state, base) {
  if (!state?.steps) return null;
  const review = findReviewStep(state, artifactFromBase(base));
  const author = state.steps.find((s) => s.type === 'author' && artifactBase(s.artifact) === base);
  if (!review && !author) return null;
  // `isPassed`, not `status === 'done'`: a gate that PASSED is what makes an artifact approved,
  // however it passed. An inherited gate was approved upstream in the thread, and a skipped one has
  // no artifact for this command to find — both used to reach here spelled `done`.
  // A gate SET ASIDE — skipped or deferred — lets the chain continue without anybody reviewing the
  // artifact, so it says nothing about the file. `isPassed` alone read it as approved: a skip taken over a half-written draft,
  // or a deferral of one, would have had CI stamp `status: approved` on a file nobody reviewed (E37).
  const reviewState = stepStatus(review);
  if (reviewState === 'skipped' || reviewState === 'deferred') return null;
  if (isPassed(review)) return 'approved';
  if (stepStatus(review) === 'in_review' || isPassed(author)) return 'in-review';
  return 'draft';
}

// The file written back whole, through a new file and a rename (#235): a story or epic folder that is a link is
// refused with YAD-STATE-001, as a read is, and nothing is written where it points. The file keeps its mode.
const rewrite = (file, text) => writeFileAtomic(file, text, { keepMode: true });

// Rewrite ONLY the `status:` line inside the first `---\n...\n---` frontmatter block, preserving
// everything else. Returns the prior status when a change was written, or null for a no-op (no
// frontmatter, no status line, preserved value, or not an advance). Mirrors the frontmatter regex
// in gate.mjs.
export function setFrontmatterStatus(file, status) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const fm = text.match(FRONTMATTER_BLOCK);
  if (!fm) return null;
  const cur = (fm[1].match(/^status:\s*(.*)$/m) || [])[1]?.trim();
  if (cur === undefined) return null;
  // Advance-only within the managed ladder; anything else (build-owned, roll-ups) is left as-is.
  if (PRESERVE.has(cur)) return null;
  if (!(cur in RANK) || !(status in RANK) || RANK[status] <= RANK[cur]) return null;
  // Replacement FUNCTIONS, not strings: in a replacement string `$'`, `$&` and `$$` are codes, so a
  // frontmatter value holding one (`title: costs $' less`) rewrote the file wrongly — on the default
  // branch, in the gate's merge commit.
  const block = fm[1].replace(/^status:\s*.*$/m, () => `status: ${status}`);
  rewrite(file, text.replace(fm[1], () => block));
  return cur;
}

// A story's Build status (`yad build ship` / `yad build done`, #346), forward only, and only the `status:`
// line of the frontmatter. Every Shape value (`draft`, `in-review`, `approved`) is before Build: a story
// whose stories review passed may still say `draft` when nobody ran `yad sync-status`. The Shape ladder
// above never writes the Build values (PRESERVE); this is the one writer of them. The value is read as YAML
// reads it — quotes and a trailing `# comment` aside. Returns { prior, changed }, or { prior, unknown: true }
// for a value this cannot place (the caller refuses rather than leave the line behind).
const BUILD_LADDER = { draft: 0, 'in-review': 0, approved: 0, 'in-build': 1, shipped: 2 };
export const statusValue = (raw) => String(raw ?? '').replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
// Two `status:` lines are read differently by different readers (the first by epic-open.sh, the last by
// parseFrontmatter), so a block with two is never read or written here.
const statusLines = (block) => [...block.matchAll(/^status:\s*(.*)$/gm)];
export function readStoryStatus(file) {
  if (!fs.existsSync(file)) return null;
  const fm = fs.readFileSync(file, 'utf8').match(FRONTMATTER_BLOCK);
  const lines = fm ? statusLines(fm[1]) : [];
  return lines.length === 1 ? statusValue(lines[0][1]) : null;
}
export function setBuildStatus(file, status) {
  if (!['in-build', 'shipped'].includes(status) || !fs.existsSync(file)) return { prior: null, unknown: true };
  const text = fs.readFileSync(file, 'utf8');
  const fm = text.match(FRONTMATTER_BLOCK);
  const lines = fm ? statusLines(fm[1]) : [];
  if (lines.length !== 1) return { prior: null, unknown: true };
  const prior = statusValue(lines[0][1]);
  if (!(prior in BUILD_LADDER)) return { prior, unknown: true };
  // Already there, and written as every reader reads it (no quotes, no comment): nothing to do. Written
  // another way (`"shipped"`, `shipped # done`), the line is rewritten, because the epic seal and
  // `yad tidy` compare the raw value.
  if (BUILD_LADDER[status] < BUILD_LADDER[prior]) return { prior, changed: false };
  if (BUILD_LADDER[status] === BUILD_LADDER[prior] && lines[0][0] === `status: ${status}`) return { prior, changed: false };
  const block = fm[1].replace(/^status:\s*.*$/m, () => `status: ${status}`);
  rewrite(file, text.replace(fm[1], () => block));
  return { prior, changed: true };
}

// Sweep one epic (or every epic under epics/) and reconcile artifact frontmatter with state.json.
// The artifact files of one epic, each with the step base it is keyed to.
function artifactFiles(dir) {
  // Single-file artifacts + each story file (all keyed to the stories step pair).
  const files = ARTIFACT_FILES.map((f) => ({ base: artifactBase(f), file: path.join(dir, f) }));
  const storiesDir = path.join(dir, 'stories');
  if (fs.existsSync(storiesDir)) {
    for (const f of fs.readdirSync(storiesDir).filter((x) => x.endsWith('.md'))) {
      files.push({ base: 'stories', file: path.join(storiesDir, f) });
    }
  }
  // Discovery ("epic zero") set: the project-discovery files all key to the single discovery /
  // discovery-review step pair, so they reconcile together (mirrors the stories/ set above).
  for (const f of DISCOVERY_FILES) {
    if (fs.existsSync(path.join(dir, f))) files.push({ base: 'discovery', file: path.join(dir, f) });
  }
  // The Foundation's sections key to its one foundation / foundation-review pair the same way. Both
  // spellings are offered; `desiredStatus` answers null for the base the chain does not carry, so
  // a converted Foundation holding the six old files still reconciles them under `discovery`.
  for (const f of FOUNDATION_FILES) {
    if (fs.existsSync(path.join(dir, f))) files.push({ base: 'foundation', file: path.join(dir, f) });
  }
  return files;
}

// The one writer that moves a status DOWN the ladder: `yad gate reopen` (#322) withdraws an approval, so a
// file that says `approved` (or `in-review`) over a step walked back says what is now true. Like
// `setFrontmatterStatus`, only the `status:` line changes and a build-owned value is never touched.
// Returns the prior status when a change was written, else null.
export function lowerFrontmatterStatus(file, status) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const fm = text.match(FRONTMATTER_BLOCK);
  if (!fm) return null;
  const cur = (fm[1].match(/^status:\s*(.*)$/m) || [])[1]?.trim();
  if (cur === undefined || PRESERVE.has(cur)) return null;
  if (!(cur in RANK) || !(status in RANK) || RANK[status] >= RANK[cur]) return null;
  const block = fm[1].replace(/^status:\s*.*$/m, () => `status: ${status}`);
  rewrite(file, text.replace(fm[1], () => block));
  return cur;
}

// Lower every artifact of one epic to what its walked-back `state` now says (`yad gate reopen`, #322).
// Returns the root-relative paths it rewrote, so the reopen commit holds exactly those.
export function lowerStatuses(root, epic, state) {
  const written = [];
  for (const { base, file } of artifactFiles(epicRoot(root, epic))) {
    const want = desiredStatus(state, base);
    if (want && lowerFrontmatterStatus(file, want)) written.push(path.relative(root, file));
  }
  return written;
}

export async function syncStatuses(root, { epic, dryRun = false } = {}) {
  // `epicIds` — the Foundation included (E75), and only VALID ids: a backup directory or any other
  // folder left under `epics/` is not an epic, and rewriting frontmatter inside it would be a write to
  // files nobody asked this command to touch.
  const epics = epic ? [epic] : epicIds(root);
  if (!epics.length) { info('no epics found — nothing to sync'); return { changed: 0, files: [] }; }

  let changed = 0;
  // The root-relative paths actually rewritten. `gate ci` stages its merge commit from an explicit
  // allowlist — the ledger, the generated reviews, and exactly these artifacts — so a run on a dirty
  // checkout (the documented manual recovery) can never sweep an unrelated file onto the default
  // branch. Reporting the paths is what lets the caller be that specific. Named `written`, not
  // `files`: the per-epic loop below already binds a local `files` (its candidate list).
  const written = [];
  for (const e of epics) {
    const dir = epicRoot(root, e);
    const state = readJSONStrict(epicFiles(dir).state, null);
    if (!state?.steps) { info(`${e}: no state.json — skipping`); continue; }

    const files = artifactFiles(dir);
    // Every file of the epic is checked before the first is rewritten (#235): a linked `stories/` stops the sync
    // before `epic.md` changes, so the epic is never left half in step.
    if (!dryRun) for (const { file } of files) refuseLinkedWrite(file);
    for (const { base, file } of files) {
      if (!fs.existsSync(file)) continue;
      const want = desiredStatus(state, base);
      if (!want) continue;
      if (dryRun) {
        // Peek without writing so --dry-run reports exactly what would change. Scope the match to the
        // frontmatter block so a `status:` line in the Markdown body can't be mistaken for the value.
        const text = fs.readFileSync(file, 'utf8');
        const fm = text.match(FRONTMATTER_BLOCK);
        const cur = (fm?.[1].match(/^status:\s*(.*)$/m) || [])[1]?.trim();
        if (cur && !PRESERVE.has(cur) && cur in RANK && RANK[want] > RANK[cur]) {
          log(`  ${c.dim('• would update')} ${path.relative(root, file)}: ${cur} → ${want}`);
          changed++;
        }
        continue;
      }
      const prev = setFrontmatterStatus(file, want);
      if (prev) { ok(`${path.relative(root, file)}: ${prev} → ${want}`); changed++; written.push(path.relative(root, file)); }
    }
  }
  if (!changed) info(dryRun ? 'no status changes needed' : 'all artifact statuses already in sync');
  else if (!dryRun) ok(`updated ${changed} artifact status(es)`);
  return { changed, files: written };
}
