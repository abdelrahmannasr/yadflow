// The record that marks a git worktree as one yad made for an epic (issue #115).
//
// `yad worktree add` writes `yad-worktree.json` into the worktree's OWN git folder
// (`<repo>/.git/worktrees/<name>/`), so the record is never tracked, never shared with another worktree,
// and goes away with `git worktree remove`. A folder's name alone is never trusted: only a record whose
// common git folder is the expected repo's says "this is that repo's worktree for that epic".
//
// Reads files only and runs no git, like the Product lookup (cli/find-product.mjs) that uses it.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject } from './lib.mjs';

export const WORKTREE_RECORD = 'yad-worktree.json';
const EPIC_RE = /^EP-[a-z0-9-]+$/;
// The story id pattern: the same regular expression as STORY_RE in cli/build.mjs, copied here because
// build.mjs imports this file (an import back would be a cycle). Keep the two alike.
export const STORY_ID_RE = /^EP-[a-z0-9-]+-S\d+$/;
// Does a record's optional `story` fit its `epic`? No story (absent or null) is an epic's own worktree; a
// story must be a story id whose epic (the id without its `-S<n>` end) is the record's epic.
export const recordStoryFits = (rec) => rec.story === undefined || rec.story === null
  || (typeof rec.story === 'string' && STORY_ID_RE.test(rec.story) && rec.story.replace(/-S\d+$/, '') === rec.epic);
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
export const sameDir = (a, b) => { const [x, y] = [a && real(a), b && real(b)]; return !!x && !!y && fold(x) === fold(y); };

// A linked worktree's own git folder, from the `gitdir:` line of its `.git` FILE. Null for a main checkout
// (`.git` is a folder), for no checkout, or for a file that does not point at a `worktrees/<name>` folder
// holding git's `commondir` file (a submodule's `.git` file points into `modules/` — also one kept at a
// path `worktrees/<x>`, whose folder `modules/worktrees/<x>` has no `commondir`; #597 review).
export function linkedGitDir(top) {
  let text;
  try {
    if (!fs.lstatSync(path.join(top, '.git')).isFile()) return null;
    text = fs.readFileSync(path.join(top, '.git'), 'utf8');
  } catch { return null; }
  const m = text.match(/^gitdir:\s*(.+?)\s*$/m);
  if (!m) return null;
  const dir = path.resolve(top, m[1]);
  if (path.basename(path.dirname(dir)) !== 'worktrees') return null;
  try { return fs.statSync(path.join(dir, 'commondir')).isFile() ? dir : null; } catch { return null; }
}

// The common git folder a linked worktree shares with its main checkout (`<main>/.git`).
export function commonDirOf(gitDir) {
  try { return path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); } catch { return null; }
}

// → { epic, story?, repo, base, created, by, gitDir, commonDir, main } for a worktree yad made, else null.
//   `story` is there only in a story's worktree (`yad worktree add <epic> --story <story>`).
//   `repo` is null for the Product's worktree, or the registered repo's name. `main` is the main checkout
//   (the folder holding the common `.git`).
export function worktreeAt(top) {
  if (!top) return null;
  const gitDir = linkedGitDir(top);
  if (!gitDir) return null;
  let rec;
  try { rec = JSON.parse(fs.readFileSync(path.join(gitDir, WORKTREE_RECORD), 'utf8')); } catch { return null; }
  if (!isPlainObject(rec) || typeof rec.epic !== 'string' || !EPIC_RE.test(rec.epic)) return null;
  if (!(rec.repo === null || (typeof rec.repo === 'string' && rec.repo))) return null;
  if (!recordStoryFits(rec)) return null;
  const commonDir = commonDirOf(gitDir);
  if (!commonDir || path.basename(commonDir) !== '.git') return null;
  return { ...rec, gitDir, commonDir, main: path.dirname(commonDir) };
}
