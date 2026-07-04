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
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, readJSONStrict, writeJSON } from './lib.mjs';
import { epicFiles } from './manifest.mjs';

// ---- shard filenames — the ONE source of truth for the naming convention -------------------------
// story ids already contain hyphens; the filename is just a unique handle (the entry inside carries
// the fields), so no parsing-back is needed. A trust entry needs `uid` to stay unique across re-runs
// of the same (story, repo, step); a ship is unique by (story, task, repo) already.
export const trustShardName = (e) => `${e.story}-${e.repo}-${e.step}-${e.uid}.json`;
export const buildShardName = (e) => `${e.story}-${e.task}-${e.repo}.json`;

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

// Find the ship matching `match(ship)` across loose shards (authoritative until folded) then the
// folded file, apply `update(ship)`, and write back ONLY the file that holds it. Returns
// { found, where, file, ship }; found:false writes nothing (the caller warns).
export function updateShip(epicDir, match, update) {
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

export function foldTrust(epicDir, pick, opts = {}) {
  const f = epicFiles(epicDir);
  return fold(epicDir, { foldedPath: f.trustLog, dir: f.trustLogDir, arr: 'runs', isTrust: true }, pick, opts);
}
export function foldBuild(epicDir, pick, opts = {}) {
  const f = epicFiles(epicDir);
  return fold(epicDir, { foldedPath: f.buildLog, dir: f.buildLogDir, arr: 'ships', isTrust: false }, pick, opts);
}
