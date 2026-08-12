// Shard-then-fold storage for the two append-only back-half ledgers (trust-log, build-log).
//
// The problem: both ledgers were ONE file per epic, so two people driving different stories of the
// SAME epic both appended to the same file → git merge conflict on push. The fix ("loose objects +
// `git gc`"): each writer writes ONE small file per entry under a shard dir, so concurrent writers
// touch different files → zero conflict, by construction. Readers UNION the folded file (the legacy
// single file, and the output of `yad tidy up`) with every loose shard. `yad tidy up` folds finished
// shards back into the folded file on demand — a single, serialized, human-run act.
//
// A legacy epic that only has the folded file still reads correctly (no shards to union) → zero
// migration; new writes simply go to shards.
//
// Shards remove the conflict BETWEEN entries; they do not make a single read-modify-write atomic, so
// every writer that decides something from the ledger before writing takes an exclusive lock first
// (see "ledger locking" below).
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, readJSONStrict, writeJSON } from './lib.mjs';
import { epicFiles } from './manifest.mjs';
import { err } from './errors.mjs';

// ---- ledger locking -------------------------------------------------------------------------------
// Shards make concurrent writers conflict-free ACROSS entries, but a writer that READS THEN WRITES is
// only safe if nothing slips in between. `writeRetroShip` decides "no ship for this (story, repo) yet"
// and then writes; `updateShip` finds a ship and then rewrites it; a fold reads shards, merges them,
// then deletes them. Two `--retro-ship` runs with different `--task` values both read "no ship", both
// write, and the duplicate guard is defeated — two shards for one (story, repo). So every
// read-modify-write on a ledger holds an exclusive lock for its whole span.
//
// `fs.mkdirSync` is the primitive: directory creation is atomic on POSIX and Windows, so exactly one
// caller wins and the rest get EEXIST. It needs no fd bookkeeping, releases with one `rmdir`, and an
// EMPTY DIRECTORY IS INVISIBLE TO GIT — a lock can never be committed, and `readShardDir` only reads
// `*.json` files, so it is never mistaken for an entry either.
//
// The lock is per LEDGER, not per (story, repo). A per-identity lock keyed on the raw identity would
// let the one pair that most needs serializing race: `api.v2` and `api_v2` are DIFFERENT identities
// that share ONE shard filename (`safe()` maps both to `api_v2`), so they would take different locks
// and then collide on the same file. A ledger-wide lock cannot be wrong that way, and what it
// serializes is a handful of local file operations.
const LOCK_STALE_MS = 30_000;   // a lock older than this belonged to a process that died holding it
const LOCK_WAIT_MS = 50;
const LOCK_RETRIES = 100;       // ≈5s — long enough for any real ledger write, short enough to report

// Block the thread without spinning. `Atomics.wait` on the main thread is allowed in Node (only
// browsers forbid it), and these ledger writers are synchronous by design.
const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// Run `fn` while holding `lockPath` exclusively; always releases, even when `fn` throws. Throws
// YAD-STATE-006 when the lock is held by a live process for the whole retry window — better to report
// than to write over another writer's work.
export function withLedgerLock(lockPath, fn, { retries = LOCK_RETRIES, waitMs = LOCK_WAIT_MS } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // A holder that died leaves its lock behind forever; reclaim one that is provably too old.
      let age;
      try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { continue; } // vanished → retry
      if (age > LOCK_STALE_MS) { try { fs.rmdirSync(lockPath); } catch { /* someone else won */ } continue; }
      if (i >= retries) {
        throw err('YAD-STATE-006', `another process is writing ${path.basename(lockPath, '.lock')} in ${path.basename(path.dirname(path.dirname(lockPath)))}`,
          'wait for the other yad command to finish and re-run; if nothing else is running, delete the stale .lock directory the message names');
      }
      sleep(waitMs);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lockPath); } catch { /* already reclaimed */ } }
}

const buildLogLock = (epicDir) => `${epicFiles(epicDir).buildLog}.lock`;
const trustLogLock = (epicDir) => `${epicFiles(epicDir).trustLog}.lock`;

// ---- shard filenames — the ONE source of truth for the naming convention -------------------------
// story ids already contain hyphens; the filename is just a unique handle (the entry inside carries
// the fields), so no parsing-back is needed. A trust entry needs `uid` to stay unique across re-runs
// of the same (story, repo, step); a ship is unique by (story, task, repo) already.
//
// Each component is sanitized to a filename-safe charset FIRST: a `/`, `..`, or other separator in an
// id would otherwise be a real path element under `path.join(dir, name)` + `writeJSON`, letting a
// malformed shard escape the shard dir (and then vanish from `readShardDir`). Anything outside
// [A-Za-z0-9_-] collapses to `_` (dots dropped too, so `.`/`..` can never form); an empty component
// becomes `_` so a segment is never blank.
const safe = (c) => String(c ?? '').replace(/[^A-Za-z0-9_-]/g, '_') || '_';
export const trustShardName = (e) => `${safe(e.story)}-${safe(e.repo)}-${safe(e.step)}-${safe(e.uid)}.json`;
export const buildShardName = (e) => `${safe(e.story)}-${safe(e.task)}-${safe(e.repo)}.json`;

// Read every shard object under `dir` (each file = ONE entry object). Sorted for determinism; a
// corrupt/non-object shard is skipped (these ledgers are advisory evidence, never fatal).
function readShardDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const obj = readJSON(path.join(dir, name), null);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.push({ name, obj });
  }
  return out;
}

// The half-applied-tidy guard key: a shard is a genuine duplicate of a folded entry ONLY when its FULL
// identity matches — NOT `uid` alone. `uid` is minted by an LLM skill, so two runs of DIFFERENT
// (story,repo,step) could share a short token; keying on uid alone would drop the second as a false
// "duplicate" and corrupt the trust count (in the unsafe direction). Legacy folded entries lack `uid`,
// so their key never collides with a real shard's key — they are never skipped.
const trustKey = (e) => `${e.story}|${e.repo}|${e.step}|${e.uid}`;

// trust-log = the evidence base. EVERY entry is a distinct step run (re-runs of a step share
// story/repo/step), so we CONCATENATE folded runs + shards and never dedup by (story,repo,step) —
// that would drop re-run history the trust threshold counts. The only guard is a shard whose full
// identity (`trustKey`) already appears folded (a half-applied tidy). A corrupt folded file must throw
// (readJSONStrict), never silently read as empty — under-reporting the evidence base is a safety bug.
export function readTrustRuns(epicDir) {
  const f = epicFiles(epicDir);
  const foldedObj = readJSONStrict(f.trustLog, null);
  const folded = Array.isArray(foldedObj?.runs) ? foldedObj.runs : [];
  const seen = new Set(folded.filter((e) => e && e.uid).map(trustKey));
  const out = [...folded];
  for (const { obj } of readShardDir(f.trustLogDir)) {
    if (obj.uid && seen.has(trustKey(obj))) continue; // a true full-identity twin already folded
    out.push(obj);
  }
  return out;
}

// build-log = one ship per (story, task, repo) — a natural unique key. `yad review reconcile` mutates
// a ship's engineer_review in its shard, so a shard is authoritative and WINS over a stale folded
// ship of the same key.
const shipKey = (s) => `${s.story}|${s.task}|${s.repo}`;
export function readShips(epicDir) {
  const f = epicFiles(epicDir);
  const foldedObj = readJSONStrict(f.buildLog, null);
  const folded = Array.isArray(foldedObj?.ships) ? foldedObj.ships : [];
  const byKey = new Map();
  for (const s of folded) byKey.set(shipKey(s), s);
  for (const { obj } of readShardDir(f.buildLogDir)) byKey.set(shipKey(obj), obj);
  return [...byKey.values()];
}

// Record a RETROACTIVE ship for a pre-tracking story — one merged & shipped before the back-half
// ledger existed, so it has no build-log ship and `yad checkpoint` can't carry its `status:` flip
// (issue #142). Writes ONE minimal ship shard, marked `retroactive: true`, so `readShips` now proves
// the story shipped and checkpoint carries the human's already-made flip. It is NOT a fabricated real
// ship: `task` defaults to the sentinel `retro`, `mergeCommit` is written only when the caller supplies
// it (never invented), and `shippedAt` is the backfill date (the `retroactive` flag marks it as such).
//
// Guard: refuse when the story already has a build-log ship IN THIS REPO — then it isn't pre-tracking
// there and the normal ship/checkpoint flow applies; a retro record would only muddy the ledger. The
// key is (story, repo), NOT story alone (#166): a story tagged with several repos ships once per repo,
// so a story-only guard let the FIRST backfill lock out every other repo and a multi-repo pre-tracking
// story could never be fully recorded. Each repo is recorded by its own run — the shards are distinct
// by construction (`buildShardName` keys on story+task+repo). Not keyed on `task` too: that would let
// repeated `--task T0x` pile several retro shards into one repo, the very muddying this guard prevents.
//
// Two names can differ yet share ONE shard file: `buildShardName` sanitizes each component through
// `safe()`, so `api.v2` and `api_v2` both become `api_v2` while the (story, repo) key sees them as
// distinct. Writing the second would silently overwrite the first repo's ship — destroying evidence in
// an append-only ledger, and (via the --dry-run cleanup) deleting an already-committed shard. So a
// name that COLLIDES with an existing ship's shard name is refused as `reason: 'collision'`, and the
// target file is never overwritten even when `readShips` cannot see it (a corrupt shard is skipped by
// `readShardDir`). Returns { written: false, reason } when refused, else { written: true, file, ship }.
export function writeRetroShip(epicDir, { story, repo, task = 'retro', mergeCommit, shippedAt }, lockOpts = {}) {
  if (!story) throw new Error('writeRetroShip: story is required');
  if (!repo) throw new Error('writeRetroShip: repo is required');
  // Both guards and the write are ONE critical section: read outside the lock and a concurrent run
  // (notably a different `--task` for the same (story, repo)) can write between the check and ours.
  return withLedgerLock(buildLogLock(epicDir), () => {
    const ships = readShips(epicDir).filter((s) => s.story === story);
    if (ships.some((s) => s.repo === repo)) return { written: false, reason: 'exists' };
    const clash = ships.find((s) => safe(s.repo) === safe(repo));
    if (clash) return { written: false, reason: 'collision', repo: clash.repo };
    const t = task || 'retro';
    const ship = { story, task: t, repo, retroactive: true, note: 'pre-tracking backfill' };
    if (mergeCommit) ship.mergeCommit = mergeCommit;
    if (shippedAt) ship.shippedAt = shippedAt;
    const f = epicFiles(epicDir);
    const file = path.join(f.buildLogDir, buildShardName({ story, task: t, repo }));
    if (fs.existsSync(file)) return { written: false, reason: 'collision', file };
    writeJSON(file, ship);
    return { written: true, file, ship };
  }, lockOpts);
}

// Find the ship matching `match(ship)` across loose shards (authoritative until folded) then the
// folded file, apply `update(ship)`, and write back ONLY the file that holds it. Returns
// { found, where, file, ship }; found:false writes nothing (the caller warns). The find and the
// write-back are one locked span: a fold running between them would move the ship into the folded
// file and delete the shard this call is about to rewrite, resurrecting the deleted shard.
export function updateShip(epicDir, match, update, lockOpts = {}) {
  return withLedgerLock(buildLogLock(epicDir), () => {
    const f = epicFiles(epicDir);
    for (const { name, obj } of readShardDir(f.buildLogDir)) {
      if (match(obj)) {
        update(obj);
        const file = path.join(f.buildLogDir, name);
        writeJSON(file, obj);
        return { found: true, where: 'shard', file, ship: obj };
      }
    }
    const foldedObj = readJSONStrict(f.buildLog, null);
    const ship = Array.isArray(foldedObj?.ships) ? foldedObj.ships.find(match) : null;
    if (ship) {
      update(ship);
      writeJSON(f.buildLog, foldedObj);
      return { found: true, where: 'folded', file: f.buildLog, ship };
    }
    return { found: false };
  }, lockOpts);
}

// ---- folding (used by `yad tidy up`) -------------------------------------------------------------
const trustSort = (a, b) =>
  `${a.date || ''}|${a.story || ''}|${a.repo || ''}|${a.step || ''}|${a.uid || ''}`
    .localeCompare(`${b.date || ''}|${b.story || ''}|${b.repo || ''}|${b.step || ''}|${b.uid || ''}`);
const buildSort = (a, b) =>
  `${a.shippedAt || ''}|${a.story || ''}|${a.task || ''}|${a.repo || ''}`
    .localeCompare(`${b.shippedAt || ''}|${b.story || ''}|${b.task || ''}|${b.repo || ''}`);

// Fold the shards that `pick(entry)` selects into the folded file, then delete them. Returns
// { folded, remaining, deleted } — `deleted` are the removed shard paths so the caller can stage them.
// Idempotent: nothing picked → no write, no delete. Deterministic order so the folded output is stable.
function fold(epicDir, { foldedPath, dir, arr, isTrust }, pick, { dryRun = false } = {}) {
  const shards = readShardDir(dir);
  const toFold = shards.filter((s) => pick(s.obj));
  if (!toFold.length) return { folded: 0, remaining: shards.length, deleted: [] };
  if (dryRun) return { folded: toFold.length, remaining: shards.length - toFold.length, deleted: [] };

  // A corrupt folded file must ABORT the fold (readJSONStrict throws), never be silently rebuilt from
  // scratch — rebuilding would erase all previously-folded history.
  const foldedObj = readJSONStrict(foldedPath, null) || { epic: path.basename(epicDir), [arr]: [] };
  if (!Array.isArray(foldedObj[arr])) foldedObj[arr] = [];
  if (isTrust) {
    // Guard on FULL identity (trustKey), not uid alone — a shard skipped here is a genuine twin of an
    // already-folded run, so deleting it below is safe; two runs that merely share a uid keep both.
    const seen = new Set(foldedObj.runs.filter((e) => e && e.uid).map(trustKey));
    for (const s of toFold) if (!(s.obj.uid && seen.has(trustKey(s.obj)))) foldedObj.runs.push(s.obj);
    foldedObj.runs.sort(trustSort);
  } else {
    const byKey = new Map(foldedObj.ships.map((s) => [shipKey(s), s]));
    for (const s of toFold) byKey.set(shipKey(s.obj), s.obj);
    foldedObj.ships = [...byKey.values()].sort(buildSort);
  }
  writeJSON(foldedPath, foldedObj);
  const deleted = [];
  for (const s of toFold) {
    const p = path.join(dir, s.name);
    fs.rmSync(p, { force: true });
    deleted.push(p);
  }
  return { folded: toFold.length, remaining: shards.length - toFold.length, deleted };
}

// Both folds are read-fold-delete, so they hold their ledger's lock for the whole span — otherwise a
// ship written (or stamped by `updateShip`) after the read but before the delete is folded away
// without its change, or deleted without ever being folded.
export function foldTrust(epicDir, pick, opts = {}) {
  const f = epicFiles(epicDir);
  return withLedgerLock(trustLogLock(epicDir), () =>
    fold(epicDir, { foldedPath: f.trustLog, dir: f.trustLogDir, arr: 'runs', isTrust: true }, pick, opts), opts);
}
export function foldBuild(epicDir, pick, opts = {}) {
  const f = epicFiles(epicDir);
  return withLedgerLock(buildLogLock(epicDir), () =>
    fold(epicDir, { foldedPath: f.buildLog, dir: f.buildLogDir, arr: 'ships', isTrust: false }, pick, opts), opts);
}
