// Shared helpers for the `yad` CLI. Node >=18 built-ins only — no dependencies.
import { createHash } from 'node:crypto';
import { err } from './errors.mjs';
import { SCHEMA_VERSION } from './manifest.mjs';
import { spawnSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Package root = one level up from this cli/ dir. Asset paths (skills/, etc.)
// resolve from HERE, never from the user's cwd.
export const PKG_ROOT = fileURLToPath(new URL('../', import.meta.url));

// ---- output -------------------------------------------------------------
const useColor = output.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: (s) => paint('1', s),
  dim: (s) => paint('2', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  red: (s) => paint('31', s),
  cyan: (s) => paint('36', s),
};
export const log = (s = '') => console.log(s);
export const step = (n, total, title) => log(`\n${c.cyan(`[${n}/${total}]`)} ${c.bold(title)}`);
export const ok = (s) => log(`  ${c.green('✓')} ${s}`);
export const info = (s) => log(`  ${c.dim('•')} ${s}`);
export const warn = (s) => log(`  ${c.yellow('!')} ${s}`);
export const fail = (s) => log(`  ${c.red('✗')} ${s}`);
export const hand = (s) => log(`  ${c.yellow('→')} ${s}`);
// Like `info`, but to STDERR — for diagnostics emitted by commands whose STDOUT must stay pure (e.g. a
// JSON bundle a tool parses). Keeps the human hint visible without corrupting machine-readable output.
export const note = (s) => console.error(`  ${c.dim('•')} ${s}`);
// Dimmed, indented guidance under a step — what it does / why / what to enter / what skipping means.
// Accepts a string or an array of lines so a knowledgeable user can skim past it.
export const guide = (lines) => { for (const l of (Array.isArray(lines) ? lines : [lines])) log(`    ${c.dim(l)}`); };

// ---- prompts ------------------------------------------------------------
let rl;
const getRl = () => (rl ??= readline.createInterface({ input, output }));
export function closePrompts() {
  rl?.close();
  rl = undefined;
}
export async function ask(question, def = '') {
  if (process.env.SDLC_NONINTERACTIVE) return def;
  const suffix = def ? c.dim(` (${def})`) : '';
  const a = (await getRl().question(`  ${question}${suffix}: `)).trim();
  return a || def;
}
export async function askYesNo(question, def = true) {
  if (process.env.SDLC_NONINTERACTIVE) return def;
  const hint = def ? 'Y/n' : 'y/N';
  const a = (await getRl().question(`  ${question} ${c.dim(`(${hint})`)} `)).trim().toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
}

// ---- filesystem ---------------------------------------------------------
export const asset = (...p) => path.join(PKG_ROOT, ...p);
export const exists = (p) => fs.existsSync(p);

export function fileSha(p) {
  if (!fs.existsSync(p)) return null;
  return 'sha256:' + createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
// True when dest exists and its bytes match src exactly.
export function sameContent(src, dest) {
  const a = fileSha(src);
  const b = fileSha(dest);
  return a !== null && a === b;
}

export function copyFile(src, dest, { exec = false } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  if (exec) fs.chmodSync(dest, 0o755);
}
export function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}
// Recursive list of file paths relative to `dir`.
export function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}
// True only if every file under src exists in dest with identical bytes.
export function dirMatches(src, dest) {
  const files = listFiles(src);
  if (files.length === 0) return false;
  return files.every((rel) => sameContent(path.join(src, rel), path.join(dest, rel)));
}

// ---- file shape (schemaVersion) -----------------------------------------
// Rule 1 of the change-safety rules (docs/roadmap-idea-1.md, Part 2): every file the engine writes
// states its shape, and a file with no version counts as 1.
//
// Both halves live here, in the one JSON reader/writer pair, rather than at the ~30 call sites. Two
// writers that disagreed about whether — or where — a file carries the stamp would flip its bytes back
// and forth on every sync, which is the ledger-churn failure issue #163 exists to prevent.
//
// Two conditions gate it, and both are load-bearing:
//
//   * the path runs through a `.sdlc` directory. writeJSON is also how the CLI writes
//     `.claude/settings.json` (cli/plan.mjs) and the per-user update cache (cli/update-notice.mjs).
//     Stamping a file the engine does not own would be a bug, not a feature.
//   * the value is a plain object. Four ledger kinds — approvals, comments, hub-prs and
//     reconcile-debt — are top-level JSON arrays, which cannot carry a key. Rule 1's second half
//     already covers them: no version means version 1. Wrapping them in an object would be a shape
//     change, and shape changes wait for v4 (rule 7).
// Matched against the file's own directory and its parent, NOT any ancestor. Every kind the engine
// writes sits either directly in a `.sdlc/` (state.json, hub.json, …) or one level down in a shard
// folder (build-log/, trust-log/, build-state/). Matching any ancestor instead would stamp every JSON
// file in a project that merely happened to live somewhere under a directory called `.sdlc` — the
// user's own .claude/settings.json included, which is exactly what this must never touch. A new kind
// nested deeper than that has to be added here on purpose.
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const underSdlcDir = (p) => {
  const dir = path.dirname(path.resolve(p));
  return path.basename(dir) === '.sdlc' || path.basename(path.dirname(dir)) === '.sdlc';
};
const carriesShape = (p, v) => isPlainObject(v) && underSdlcDir(p);

// Always FIRST in the serialized object. A stamp that moved around between writers would change the
// bytes without changing the meaning. An existing version is preserved, never forced back to 1, so a
// file already on a newer shape survives being read and written by this release.
const withShape = (p, v) =>
  (carriesShape(p, v) ? { schemaVersion: v.schemaVersion ?? SCHEMA_VERSION, ...v } : v);

export function readJSON(p, def = null) {
  try {
    // "Read old, write new" (rule 2): an unstamped file reads back as shape 1, so a caller never has
    // to ask whether the file it just loaded predates the stamp.
    return withShape(p, JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch {
    // The caller's own default is returned untouched: it is not a file, and stamping it would invent
    // a shape for something that was never read from disk.
    return def;
  }
}
// Strict variant for ledger files (the source of truth): a missing file is a normal state and
// returns `def`, but a file that exists and fails to parse must throw — silently defaulting a
// corrupt approvals.json to [] would let the next sync rewrite it and permanently lose approvals.
export function readJSONStrict(p, def = null) {
  if (!fs.existsSync(p)) return def;
  try {
    return withShape(p, JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (e) {
    throw err('YAD-STATE-001', `corrupt JSON in ${p}: ${e.message}`, 'fix the file or restore it from git — never delete a ledger blindly');
  }
}
// Atomic: serialize first, write a sibling tmp file (same dir = same filesystem),
// then rename over the target. A killed process can never leave a truncated ledger
// file, and a failed rename never leaves a stray .tmp for `git add -A` to pick up.
export function writeJSON(p, obj) {
  const data = JSON.stringify(withShape(p, obj), null, 2) + '\n';
  // Byte-identical content is not a write. The ledger writers are unconditional — they re-serialize
  // whether or not anything changed — so this keeps an unchanged sync from touching the file at all
  // (no mtime churn, nothing for a watcher or a `git add -A` to notice). A backstop, not the fix: the
  // load-bearing guarantee is that the serialized bytes are canonically ordered (see #163).
  try {
    if (fs.readFileSync(p, 'utf8') === data) return;
  } catch { /* missing or unreadable — fall through and write it */ }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// ---- subprocess ---------------------------------------------------------
// Returns { ok, stdout, stderr, code }. Never throws on non-zero exit.
export function run(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    error: r.error,
  };
}
export const has = (cmd) => run(process.platform === 'win32' ? 'where' : 'which', [cmd]).ok;

// Push HEAD to origin/<target>, rebasing onto it and retrying on rejection — both the front-half gate
// sync and the back-half checkpoint push append-only ledgers to the default branch, so a concurrent
// push is a normal race, not an error. Returns { ok } after up to `attempts` tries; logs each retry.
// A failed `pull --rebase` is aborted so we never leave a wedged rebase for the next command.
export function pushWithRebase(cwd, target, { attempts = 3 } = {}) {
  const git = (...args) => run('git', args, { cwd });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (git('push', 'origin', `HEAD:${target}`).ok) return { ok: true };
    if (attempt < attempts) {
      info(`push rejected — rebasing onto origin/${target} and retrying (${attempt}/${attempts})`);
      if (!git('pull', '--rebase', 'origin', target).ok) git('rebase', '--abort');
    }
  }
  return { ok: false };
}
