// Shared helpers for the `yad` CLI. Node >=18 built-ins only — no dependencies.
import { createHash } from 'node:crypto';
import { err } from './errors.mjs';
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

export function readJSON(p, def = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return def;
  }
}
// Strict variant for ledger files (the source of truth): a missing file is a normal state and
// returns `def`, but a file that exists and fails to parse must throw — silently defaulting a
// corrupt approvals.json to [] would let the next sync rewrite it and permanently lose approvals.
export function readJSONStrict(p, def = null) {
  if (!fs.existsSync(p)) return def;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw err('YAD-STATE-001', `corrupt JSON in ${p}: ${e.message}`, 'fix the file or restore it from git — never delete a ledger blindly');
  }
}
// Atomic: serialize first, write a sibling tmp file (same dir = same filesystem),
// then rename over the target. A killed process can never leave a truncated ledger
// file, and a failed rename never leaves a stray .tmp for `git add -A` to pick up.
export function writeJSON(p, obj) {
  const data = JSON.stringify(obj, null, 2) + '\n';
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
