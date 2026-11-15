// E185 part 2 — what THIS machine did with the local setup script: the steps the person did or said no to.
//
//   <git-common-dir>/yad/local-setup-done.json   { steps: { <id>: { hash, state: 'done'|'skipped', at, reason? } } }
//
// Inside git's own folder, so it is never committed, and every worktree of one clone shares it (the same folder
// `yad capture` keeps its state in). It holds only this person's answers: deleting it asks the questions again.
//
// An answer is tied to the step's hash (stepHash: what the step runs and how it is checked). When a step's
// commands change, the old answer no longer counts, and the person is asked again.

import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject, run, writeJSON } from './lib.mjs';
import { err } from './errors.mjs';

export const RECORD_STATES = Object.freeze(['done', 'skipped']);
const RECORD_NAME = path.join('yad', 'local-setup-done.json');

// The record's path for the clone `root` is in, or null when `root` is not in a git clone.
export function localSetupRecordPath(root) {
  const r = run('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  return r.ok && r.stdout ? path.join(r.stdout, RECORD_NAME) : null;
}

const sound = (e) => isPlainObject(e) && typeof e.hash === 'string' && RECORD_STATES.includes(e.state);

// For showing: `{ path, entries, error }`. A file that cannot be read counts as empty (it only remembers answers),
// and `error` says why. An entry of the wrong shape is left out.
export function readLocalSetupRecord(root) {
  const file = localSetupRecordPath(root);
  if (!file) return { path: null, entries: {}, error: null };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { path: file, entries: {}, error: e.code === 'ENOENT' ? null : 'cannot be read' }; }
  let doc;
  try { doc = JSON.parse(text); } catch { return { path: file, entries: {}, error: 'does not parse' }; }
  if (!isPlainObject(doc) || (doc.steps !== undefined && !isPlainObject(doc.steps))) return { path: file, entries: {}, error: 'is not the shape yad writes' };
  const entries = {};
  for (const [id, e] of Object.entries(doc.steps ?? {})) if (sound(e)) entries[id] = e;
  return { path: file, entries, error: null };
}

// The answer that counts for a step: its entry, only when made for the step as it is now.
export const answerFor = (entries, step) => {
  const e = entries[step.id];
  return e && e.hash === step.hash ? e : null;
};

// Record answers: `answers` is a list of { id, hash, state, reason? }. Read strictly first — a file that does not
// parse is refused, never replaced, so no answer already there is lost. Every other key and entry is kept.
export function writeLocalSetupAnswers(root, answers, { now = new Date() } = {}) {
  const file = localSetupRecordPath(root);
  if (!file) throw new Error(`${root} is not in a git clone, so this machine's local setup answers have nowhere to go`);
  let doc = {};
  if (fs.existsSync(file)) {
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { doc = null; }
    if (!isPlainObject(doc) || (doc.steps !== undefined && !isPlainObject(doc.steps))) {
      throw err('YAD-STATE-001', `${file} is not the record yad writes, so it was not changed`, 'delete it: it only remembers which local setup steps this machine did or skipped, and `yad local-setup` asks again');
    }
  }
  const steps = { ...(doc.steps ?? {}) };
  const at = now.toISOString();
  for (const a of answers) {
    steps[a.id] = { hash: a.hash, state: a.state, at, ...(a.state === 'skipped' ? { reason: a.reason } : {}) };
  }
  writeJSON(file, { ...doc, steps });
  return file;
}
