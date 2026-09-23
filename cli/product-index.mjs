// E19 — `.sdlc/index.json`, the one-file front door: a summary of every work item in the Product, so a
// reader (an app, CI, an agent, E20's `yad history`) opens ONE file instead of walking `epics/*`.
//
// THE RULES, each one the user's decision (2026-09-23; the E19 roadmap row has the reasons):
//   1. DERIVED, never the system of record. It is rebuilt from `epicIds()` plus each item's
//      `.sdlc/state.json` and `epic.md` frontmatter, and never edited by hand (phase 5's founding rule:
//      rebuildable from git). It is committed, but WRITTEN ON THE DEFAULT BRANCH ONLY: an index every
//      branch rewrites would bring back the merge conflict `cli/ledger.mjs` sharded the ledgers to remove.
//   2. A SUMMARY per item, not a mirror of every step. An item whose files cannot be read is LISTED,
//      marked `unreadable` with the reason — never dropped (a silently missing item is the quiet
//      under-count E71 warned about), and never allowed to stop the whole file.
//   3. STALENESS is a hash of the exact bytes the index was built from (`inputs`), the `docs-build.json`
//      precedent — not a HEAD sha, which moves on commits that touch no work item. `yad doctor` checks it.
//   4. No title: none exists anywhere yet (E111).
//
// There is NO timestamp in the file: `writeJSON` skips identical bytes, so an unchanged Product never
// dirties git, and the hash is the version.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isPlainObject, writeJSON, info, warn } from './lib.mjs';
import { isVerifiedLedger } from './manifest.mjs';
import { productGit, resolveDefaultBranch } from './hubcommit.mjs';
import {
  epicIds, epicRel, epicRoot, unlistedLedgerDirs, parseFrontmatter, lineageFrom, stepStatus, STEP_STATES,
  FOUNDATION_EPIC,
} from './epic-state.mjs';

export const INDEX_FILE = path.join('.sdlc', 'index.json');
export const indexPath = (root) => path.join(root, INDEX_FILE);

// Mixed into the hash, so an engine that builds a DIFFERENT summary from the same inputs reads the old
// file as behind. Move it whenever `summarize` changes what it writes.
export const INDEX_FORMAT = 'e19-1';

// One input file's bytes, or why there are none. `absent` is a fact, not an error: an epic folder with no
// `epic.md` (the Foundation, always) is a normal shape.
function readInput(file) {
  try {
    return { bytes: fs.readFileSync(file) };
  } catch (e) {
    return e.code === 'ENOENT' ? { absent: true } : { error: e.code || e.message };
  }
}

// The hash of everything the index reads, length-prefixed so two inputs can never run together
// (`a` + `bc` never collides with `ab` + `c`), and naming each input's place so a file moved from one
// epic to another reads as a change.
function hashInputs(parts) {
  const h = createHash('sha256');
  h.update(`format:${INDEX_FORMAT}\n`);
  for (const { name, input } of parts) {
    if (input.bytes) {
      h.update(`${name}:${input.bytes.length}\n`);
      h.update(input.bytes);
    } else h.update(`${name}:${input.absent ? 'absent' : `unreadable ${input.error}`}\n`);
  }
  return `sha256:${h.digest('hex')}`;
}

// The state a work item's summary is built from, as { state }, or why there is none, as { why }.
function readState(input) {
  if (input.absent) return { why: 'it has no .sdlc/state.json' };
  if (input.error) return { why: `.sdlc/state.json could not be read (${input.error})` };
  let state;
  try {
    state = JSON.parse(input.bytes.toString('utf8'));
  } catch {
    return { why: '.sdlc/state.json does not parse' };
  }
  if (!isPlainObject(state)) return { why: '.sdlc/state.json is not an object' };
  if (!Array.isArray(state.steps)) return { why: '.sdlc/state.json has no list of steps' };
  return { state };
}

const text = (v) => (typeof v === 'string' && v ? v : null);
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : typeof v === 'string' && v ? [v] : []);

// The summary of one work item. Every value is what the files SAY — nothing is parsed further than the
// field it is (a date is carried as written: E71 met `2026-9-4`, and nothing here needs a date's value).
function summarize(id, state, fm) {
  const counts = Object.fromEntries(STEP_STATES.map((s) => [s.id, 0]));
  let unknown = 0;
  let lastClosed = null;
  for (const step of state.steps) {
    // `stepStatus`, never the raw field: `blocked` with no record reads `todo` (E38), and a state this
    // release does not know is counted as unknown rather than guessed.
    const st = stepStatus(step);
    if (st) counts[st] += 1; else unknown += 1;
    // The LAST closed step in the chain's own order, not the newest date: the order is a fact, and a
    // date written by hand may not sort.
    if (isPlainObject(step) && isPlainObject(step.closed)) {
      lastClosed = { step: text(step.id), date: text(step.closed.date), by: text(step.closed.by) };
    }
  }
  // The Foundation has no epic.md and no work-item type (E75), so it carries none rather than the
  // `feature` a missing type would otherwise default to.
  const product = id === FOUNDATION_EPIC;
  const lineage = product ? null : lineageFrom(fm);
  return {
    id,
    dir: epicRel(id),
    kind: text(state.kind),
    type: lineage ? lineage.type : null,
    theme: lineage ? lineage.theme : null,
    parent: lineage ? lineage.parent : null,
    thread: lineage ? lineage.thread : null,
    profile: text(state.profile),
    currentStep: text(state.currentStep),
    createdAt: text(state.createdAt),
    repos: product ? [] : list(fm.repos),
    steps: { ...counts, ...(unknown ? { unknown } : {}) },
    lastClosed,
  };
}

// Build the index from the Product on disk: { index, inputs }. Never throws for a work item — each one
// that cannot be read is listed as unreadable. Throws only when the `epics/` folder itself cannot be
// listed, because then there is no honest list to write at all.
export function buildIndex(root) {
  const ids = epicIds(root);
  const unlisted = unlistedLedgerDirs(root, ids).map((e) => `epics/${e}`);
  const parts = [{ name: `ids:${ids.join(',')}|unlisted:${unlisted.join(',')}`, input: { absent: true } }];
  const items = [];
  for (const id of ids) {
    const dir = epicRoot(root, id);
    const stateIn = readInput(path.join(dir, '.sdlc', 'state.json'));
    const epicIn = id === FOUNDATION_EPIC ? { absent: true } : readInput(path.join(dir, 'epic.md'));
    parts.push({ name: `${id}/state.json`, input: stateIn }, { name: `${id}/epic.md`, input: epicIn });
    const read = readState(stateIn);
    if (read.why) { items.push({ id, dir: epicRel(id), unreadable: true, why: read.why }); continue; }
    if (epicIn.error) { items.push({ id, dir: epicRel(id), unreadable: true, why: `epic.md could not be read (${epicIn.error})` }); continue; }
    const fm = epicIn.bytes ? parseFrontmatter(epicIn.bytes.toString('utf8')) : {};
    items.push(summarize(id, read.state, fm));
  }
  const inputs = hashInputs(parts);
  return { index: { inputs, items, ...(unlisted.length ? { unlisted } : {}) }, inputs };
}

// Write the index. Returns whether the bytes changed. The caller decides WHETHER to write (the branch
// and ledger rules live with the commands, not here).
export function writeIndex(root, built = buildIndex(root)) {
  const file = indexPath(root);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  writeJSON(file, built.index);
  return fs.readFileSync(file, 'utf8') !== before;
}

// How the committed index compares with the Product on disk:
//   { state: 'current' | 'behind' | 'missing' | 'unreadable' | 'none', why? }
// `none` — there are no work items and no index: nothing to be behind.
export function indexFreshness(root) {
  const file = indexPath(root);
  let built;
  try {
    built = buildIndex(root);
  } catch (e) {
    return { state: 'unreadable', why: `the epics folder could not be listed (${e.code || e.message})` };
  }
  if (!fs.existsSync(file)) {
    return built.index.items.length || built.index.unlisted ? { state: 'missing' } : { state: 'none' };
  }
  let onDisk;
  try {
    onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { state: 'unreadable', why: '.sdlc/index.json does not parse' };
  }
  if (!isPlainObject(onDisk) || typeof onDisk.inputs !== 'string') {
    return { state: 'unreadable', why: '.sdlc/index.json records no input hash' };
  }
  return onDisk.inputs === built.inputs ? { state: 'current' } : { state: 'behind' };
}

// Rebuild the index after a LOCAL write — a gate write, a `yad migrate --apply` — on the default branch
// only, and never on a verified Product, where CI is the ledger's one writer (it rebuilds the index in
// `gateCi`'s merge commit instead). A branch never carries a rewrite of the file every other branch rewrites too. No `.git` means
// the branch cannot be known, so nothing is written: the golden fixture is copied into a folder with no
// `.git` of its own, and asking git there would read yadflow's own branch (E71 finding c).
// The index is derived: a failure to rebuild it is said, and never stops the gate write it follows.
// Returns whether the file changed, so a caller that commits can carry it in the same commit. `quiet`
// for a caller whose stdout is JSON: the warning still goes to stderr.
export function refreshIndexAfterWrite(root, hub, { quiet = false } = {}) {
  if (isVerifiedLedger(hub) || !fs.existsSync(path.join(root, '.git'))) return false;
  const git = productGit(root);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  if (!branch || branch !== resolveDefaultBranch(git, hub)) return false;
  try {
    const changed = writeIndex(root);
    if (changed && !quiet) info(`rebuilt ${INDEX_FILE}`);
    return changed;
  } catch (e) {
    const why = `${INDEX_FILE} was not rebuilt (${e.code || e.message}) — run \`yad index\``;
    if (quiet) process.stderr.write(`${why}\n`); else warn(why);
    return false;
  }
}
