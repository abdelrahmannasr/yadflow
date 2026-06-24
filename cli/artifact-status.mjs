// `yad sync-status [epic]` — reconcile each artifact's frontmatter `status:` with the real
// source of truth, the per-epic state machine in .sdlc/state.json. The authoring skills hard-code
// `status: draft` at creation and never update it, so artifacts read as "draft" long after their
// gate has passed. This derives draft / in-review / approved from the step statuses and rewrites
// only the `status:` line — advance-only, and never touching build-owned values.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, info, readJSONStrict } from './lib.mjs';
import { epicRoot, artifactBase, artifactFromBase, findReviewStep } from './epic-state.mjs';
import { epicFiles } from './manifest.mjs';

// The front-gate lifecycle this command manages. Forward-only: a status is only ever moved UP this
// ladder, so a re-run never regresses anything.
const RANK = { draft: 0, 'in-review': 1, approved: 2 };

// Values owned by other parts of the workflow — left untouched. `locked` is the contract surface;
// `in-build` / `shipped` are set by the build half (engineer-review) per story; `ready-for-build`,
// `done`, `blocked` are roll-ups/states we must not overwrite from the front-gate view.
const PRESERVE = new Set(['locked', 'in-build', 'shipped', 'ready-for-build', 'done', 'blocked']);

// The per-epic artifact files this command considers (bases). Story files are handled separately
// because they live under stories/ and all map to the single stories / stories-review step pair.
const ARTIFACT_FILES = ['analysis.md', 'epic.md', 'architecture.md', 'contract.md', 'ui-design.md', 'test-cases.md'];

// The desired front-gate status for an artifact base, derived purely from state.json. Returns null
// when the chain has no steps for this base (nothing to manage) — e.g. contract has no own step.
export function desiredStatus(state, base) {
  if (!state?.steps) return null;
  const review = findReviewStep(state, artifactFromBase(base));
  const author = state.steps.find((s) => s.type === 'author' && artifactBase(s.artifact) === base);
  if (!review && !author) return null;
  if (review?.status === 'done') return 'approved';
  if (review?.status === 'in_review' || author?.status === 'done') return 'in-review';
  return 'draft';
}

// Rewrite ONLY the `status:` line inside the first `---\n...\n---` frontmatter block, preserving
// everything else. Returns the prior status when a change was written, or null for a no-op (no
// frontmatter, no status line, preserved value, or not an advance). Mirrors the frontmatter regex
// in gate.mjs.
export function setFrontmatterStatus(file, status) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const cur = (fm[1].match(/^status:\s*(.*)$/m) || [])[1]?.trim();
  if (cur === undefined) return null;
  // Advance-only within the managed ladder; anything else (build-owned, roll-ups) is left as-is.
  if (PRESERVE.has(cur)) return null;
  if (!(cur in RANK) || !(status in RANK) || RANK[status] <= RANK[cur]) return null;
  const block = fm[1].replace(/^status:\s*.*$/m, `status: ${status}`);
  fs.writeFileSync(file, text.replace(fm[1], block));
  return cur;
}

// Sweep one epic (or every epic under epics/) and reconcile artifact frontmatter with state.json.
export async function syncStatuses(root, { epic, dryRun = false } = {}) {
  const epicsDir = path.join(root, 'epics');
  const epics = epic
    ? [epic]
    : (fs.existsSync(epicsDir) ? fs.readdirSync(epicsDir).filter((e) => fs.statSync(path.join(epicsDir, e)).isDirectory()).sort() : []);
  if (!epics.length) { info('no epics found — nothing to sync'); return { changed: 0 }; }

  let changed = 0;
  for (const e of epics) {
    const dir = epicRoot(root, e);
    const state = readJSONStrict(epicFiles(dir).state, null);
    if (!state?.steps) { info(`${e}: no state.json — skipping`); continue; }

    // Single-file artifacts + each story file (all keyed to the stories step pair).
    const files = ARTIFACT_FILES.map((f) => ({ base: artifactBase(f), file: path.join(dir, f) }));
    const storiesDir = path.join(dir, 'stories');
    if (fs.existsSync(storiesDir)) {
      for (const f of fs.readdirSync(storiesDir).filter((x) => x.endsWith('.md'))) {
        files.push({ base: 'stories', file: path.join(storiesDir, f) });
      }
    }

    for (const { base, file } of files) {
      if (!fs.existsSync(file)) continue;
      const want = desiredStatus(state, base);
      if (!want) continue;
      if (dryRun) {
        // Peek without writing so --dry-run reports exactly what would change. Scope the match to the
        // frontmatter block so a `status:` line in the Markdown body can't be mistaken for the value.
        const text = fs.readFileSync(file, 'utf8');
        const fm = text.match(/^---\n([\s\S]*?)\n---/);
        const cur = (fm?.[1].match(/^status:\s*(.*)$/m) || [])[1]?.trim();
        if (cur && !PRESERVE.has(cur) && cur in RANK && RANK[want] > RANK[cur]) {
          log(`  ${c.dim('• would update')} ${path.relative(root, file)}: ${cur} → ${want}`);
          changed++;
        }
        continue;
      }
      const prev = setFrontmatterStatus(file, want);
      if (prev) { ok(`${path.relative(root, file)}: ${prev} → ${want}`); changed++; }
    }
  }
  if (!changed) info(dryRun ? 'no status changes needed' : 'all artifact statuses already in sync');
  else if (!dryRun) ok(`updated ${changed} artifact status(es)`);
  return { changed };
}
