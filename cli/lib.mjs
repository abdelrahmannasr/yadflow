// Shared helpers for the `yad` CLI. Node >=18 built-ins only — no dependencies.
import { createHash, randomBytes } from 'node:crypto';
import { err } from './errors.mjs';
import { MAX_PLAIN_BYTES, MIRRORED_FILES, SCHEMA_VERSION, VERSION, mirrorDrift, preferring } from './manifest.mjs';
import { spawnSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Package root = one level up from this cli/ dir. Asset paths (skills/, etc.)
// resolve from HERE, never from the user's cwd.
export const PKG_ROOT = fileURLToPath(new URL('../', import.meta.url));

// ---- --json (E1) ---------------------------------------------------------
// Every command answers `--json` with ONE object on stdout, built here and nowhere else:
//   { jsonVersion, version, command, ok, ...the command's own keys, warnings }
// and a refusal adds `error`, `code` (a `YAD-` code, or null) and `hint` (or null). `jsonVersion` is
// the contract's own number: adding a key keeps it, renaming or removing one — or changing what a key
// means — bumps it. `version` is the package that answered.
//
// While a `--json` run is on, `log` (and so every helper built on it) writes to STDERR, so stdout
// holds the one object and nothing else — a progress line printed before the answer would otherwise
// make the whole output unparseable. Each `warn` is also collected into `warnings`, as plain text.
// A command never calls JSON.stringify toward stdout itself; a test greps for it.
// Text read from a shared file (a repo name, a path) is shown in the terminal: every control character
// (C0, DEL and C1 — U+0080–U+009F, which some terminals obey too) becomes a space, so a registry entry cannot move the cursor or recolour what follows.
// So do the line and paragraph separators and the bidi controls, which can make a line read in another
// order than it holds (E81 review 9).
const INVISIBLE = new Set([0x2028, 0x2029, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x061c]);
const unsafeChar = (ch) => { const n = ch.charCodeAt(0); return n < 32 || (n >= 127 && n <= 159) || INVISIBLE.has(n); };
export const forTerminal = (s) => [...String(s ?? '')].map((ch) => (unsafeChar(ch) ? ' ' : ch)).join('');
// True when `forTerminal` would change `s`: a name holding one of those characters is never written into
// a committed file yad drafts (the risk map), where every later reader would meet it raw.
export const changedForTerminal = (s) => [...String(s ?? '')].some(unsafeChar);

// A registry name inside a command the person is invited to copy: as it is only when it is one plain
// word that starts with a letter or digit (never an option like `--push`), else `<name>` — the shared
// file could hold `api; curl …|sh` (E81 reviews 9–10; here since review 15, for doctor and people.mjs).
export const asArg = (name) => (typeof name === 'string' && /^\w[\w.-]*$/.test(name) ? name : '<name>');

export const JSON_VERSION = 2;
export const ENVELOPE_KEYS = ['jsonVersion', 'version', 'command'];
let jsonRun = null;
export function beginJSON(command) { jsonRun = { command, emitted: false, warnings: [], failures: [] }; }
export const inJSON = () => jsonRun !== null;
// A warning said some other way than `warn` (straight to stderr, before a command's own output) still
// belongs in `warnings`: a --json reader must never read `warnings: []` while stderr warned (E1 review).
export const collectWarning = (s) => { if (jsonRun) jsonRun.warnings.push(stripAnsi(s)); };
export const jsonEmitted = () => jsonRun?.emitted === true;
// The refusal a command SAID in prose (`fail`, then the `hand` under it), for the run that ends with a
// non-zero exit and no answer: most refusals are written that way, and turning each by hand into a
// JSON one is how one arm gets fixed and its twin missed. `bin/yad.mjs` answers with the first.
// Every failure after the first goes into `warnings`, so a sweep that skipped several epics says all of
// them (E1 review 2) — `error` holds one line, and none is lost.
export const jsonFailure = () => {
  const [f, ...more] = jsonRun?.failures ?? [];
  if (!f) return null;
  // With its hint: for a repo whose push failed, the hint is the only recovery step.
  for (const m of more) jsonRun.warnings.push(m.hint ? `${m.error} — ${m.hint}` : m.error);
  const code = /\b(YAD-[A-Z]+-\d{3})\b/.exec(f.error)?.[1] ?? null;
  return { error: f.error, hint: f.hint, code };
};
// For a test that drives several commands in one process.
export function endJSON() { jsonRun = null; }
// eslint-disable-next-line no-control-regex -- removing the colour codes is the point
export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

// Written with console.log, which is stdout: during a --json run `log` has moved to stderr, so the
// answer is the only thing left there. Called outside a run (a test calling a command with
// `json: true`), it still answers, with `command: null` and no collected warnings.
export function emitJSON(payload = {}) {
  const command = jsonRun?.command ?? null;
  // A second answer would make stdout two documents; a bug, and said as one.
  if (jsonRun?.emitted) throw new Error(`yad ${command}: a second JSON answer`);
  const clash = ENVELOPE_KEYS.filter((k) => Object.hasOwn(payload, k));
  if (clash.length) throw new Error(`yad ${command}: the answer sets the envelope key(s) ${clash.join(', ')}`);
  if (jsonRun) jsonRun.emitted = true;
  const { ok = true, warnings, ...rest } = payload;
  // A refusal always carries all three keys, so a reader never tests whether one exists.
  const refusal = ok === false && typeof rest.error === 'string'
    ? { error: stripAnsi(rest.error), code: rest.code ?? null, hint: rest.hint == null ? null : stripAnsi(rest.hint) } : {};
  const all = [...(jsonRun?.warnings ?? []), ...(Array.isArray(warnings) ? warnings.map(stripAnsi) : [])];
  console.log(JSON.stringify({ jsonVersion: JSON_VERSION, version: VERSION, command, ok, ...rest, ...refusal, warnings: all }, null, 2));
}

// A refusal: one object under --json, the red line and its hint otherwise. Exit code 1 either way.
// `json` answers in JSON outside a CLI run too (a command called with `json: true`); `extra` carries
// keys a command adds to its refusal (never an envelope key).
export function refuse(message, hint = null, { code = null, json = false, ...extra } = {}) {
  process.exitCode = 1;
  if (jsonRun || json) return emitJSON({ ok: false, error: stripAnsi(message), code, hint: hint === null || hint === undefined ? null : stripAnsi(hint), ...extra });
  log(c.red(message));
  if (hint) log(c.yellow(`  → ${hint}`));
}

// ---- output -------------------------------------------------------------
// A run whose stdout carries something else (`yad repo pack <name> -o -`: the pack itself) sends every
// line it says to stderr, as a --json run does, so the pack is the only thing on stdout.
let proseOnStderr = false;
export function proseToStderr() { proseOnStderr = true; }
// Colour follows the stream the prose goes to: stderr during a --json run, stdout otherwise.
const useColor = () => (jsonRun || proseOnStderr ? process.stderr.isTTY : output.isTTY) && !process.env.NO_COLOR;
const paint = (code, s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: (s) => paint('1', s),
  dim: (s) => paint('2', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  red: (s) => paint('31', s),
  cyan: (s) => paint('36', s),
};
// `quietly(fn)`: run `fn` with every line below silenced — for a dry run whose verdict is only an
// input to the caller's own decision, and would read as a second verdict in a CI log (issue #362).
let muted = 0;
export async function quietly(fn) {
  muted++;
  try { return await fn(); } finally { muted--; }
}
export const log = (s = '') => {
  if (muted) return;
  if (!jsonRun) return proseOnStderr ? console.error(s) : console.log(s);
  jsonRun.afterFail = false;
  console.error(s);
};
export const step = (n, total, title) => log(`\n${c.cyan(`[${n}/${total}]`)} ${c.bold(title)}`);
export const ok = (s) => log(`  ${c.green('✓')} ${s}`);
export const info = (s) => log(`  ${c.dim('•')} ${s}`);
export const warn = (s) => {
  if (muted) return;
  if (jsonRun) jsonRun.warnings.push(stripAnsi(s));
  log(`  ${c.yellow('!')} ${s}`);
};
export const fail = (s) => {
  if (muted) return;
  log(`  ${c.red('✗')} ${s}`);
  if (jsonRun) { jsonRun.failures.push({ error: stripAnsi(s), hint: null }); jsonRun.afterFail = true; }
};
// A hint belongs to a failure only when it is the very next line under it — never a later `hand`.
export const hand = (s) => {
  if (muted) return;
  const attach = jsonRun?.afterFail ? jsonRun.failures.at(-1) : null;
  log(`  ${c.yellow('→')} ${s}`);
  if (attach) attach.hint = stripAnsi(s);
};
// Like `info`, but to STDERR — for diagnostics emitted by commands whose STDOUT must stay pure (e.g. a
// JSON bundle a tool parses). Keeps the human hint visible without corrupting machine-readable output.
export const note = (s) => { if (!muted) console.error(`  ${c.dim('•')} ${s}`); };
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
// A --json run never prompts: its stdin is a program's, and a question on stderr would hang it.
const noPromptInJSON = (question) => {
  if (jsonRun) throw err('YAD-CLI-001', `a --json run cannot ask: ${stripAnsi(question)}`, 'pass the answer as a flag where one exists (`yad --help` lists them), set SDLC_NONINTERACTIVE=1 to take every default, or run without --json');
};
export async function ask(question, def = '') {
  if (process.env.SDLC_NONINTERACTIVE) return def;
  noPromptInJSON(question);
  const suffix = def ? c.dim(` (${def})`) : '';
  const a = (await getRl().question(`  ${question}${suffix}: `)).trim();
  return a || def;
}
export async function askYesNo(question, def = true) {
  if (process.env.SDLC_NONINTERACTIVE) return def;
  noPromptInJSON(question);
  const hint = def ? 'Y/n' : 'y/N';
  const a = (await getRl().question(`  ${question} ${c.dim(`(${hint})`)} `)).trim().toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
}

// ---- filesystem ---------------------------------------------------------
export const asset = (...p) => path.join(PKG_ROOT, ...p);
export const exists = (p) => fs.existsSync(p);

// Do two paths name the same existing file or folder? Used where one path comes from git and one from Node,
// which can spell the same place differently: on Windows git answers with the long name while Node's temp
// folder is often an 8.3 short name (`C:\Users\RUNNER~1\…`) that the JS realpath keeps; `.native` asks
// Windows for the final name. Windows also compares without case, and a macOS `/var` is `/private/var`.
// A path that does not exist is never the same as anything (E48).
export function samePath(a, b, platform = process.platform) {
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
  const ra = real(a);
  const rb = real(b);
  if (ra === null || rb === null) return false;
  return platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

export function fileSha(p) {
  if (!fs.existsSync(p)) return null;
  return 'sha256:' + createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
// The sha of a file yad INSTALLS, read the way git would give it back: every CRLF counted as LF (E113).
// On Windows git checks text out with CRLF (`core.autocrlf`, on by default there), so a teammate's clone
// holds each shipped file with different bytes and the same content — and a byte compare would call every
// one of them outdated, or edited, for ever. A file with no CR in it hashes exactly as `fileSha` does, so
// every sha already recorded in `.sdlc/managed.json` still matches. Not for artifact hashes: those are
// `fileSha`, and an approval is bound to them.
// A link, a folder, a device, a file under a linked folder of the Product or one too big to read has no
// sha, as a missing file has none (#222): a committed CI file that links to /dev/zero made `yad check` and
// setup wait for ever here, and one that links out of the Product made yad compare a file it does not own.
// A file it may not read (no permission) still throws, as before. A path nothing is at — its folder missing or a
// file, a link loop — has no sha either, as `existsSync` said before.
export function contentSha(p) {
  try { fs.lstatSync(path.resolve(p)); } catch { return null; }
  let bytes;
  try { bytes = readPlainBytes(p); } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === NOT_PLAIN_FILE || e?.code === FILE_TOO_BIG) return null;
    throw e;
  }
  const text = bytes.includes(13) ? Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : bytes;
  return 'sha256:' + createHash('sha256').update(text).digest('hex');
}
// True when dest exists and its content matches src, line endings aside (see `contentSha`).
export function sameContent(src, dest) {
  const a = contentSha(src);
  const b = contentSha(dest);
  return a !== null && a === b;
}

// Both refuse a destination under a linked folder of the Product (#214): `copyDir` removes the old copy
// first, and through a linked `.claude/` that would delete inside the folder the link points at.
// The copy goes to a new file beside `dest`, made only when nothing is there (COPYFILE_EXCL), then is renamed
// over it (#222): `copyFileSync` straight onto `dest` writes through a link standing there (a dangling one too,
// making its target), so a committed `checks/x.sh` that links to `~/.zshenv` would get the gate's text. A
// rename replaces the link itself.
// `within`, as for the plain reads: a code repo's folder, whose own sub-folders must not be links either.
export function copyFile(src, dest, { exec = false, within } = {}) {
  refuseLinkedWrite(dest, within);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${path.resolve(dest)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let made = false;
  try {
    fs.copyFileSync(src, tmp, fs.constants.COPYFILE_EXCL);
    made = true;
    if (exec) fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, dest);
  } catch (e) {
    // Only our own new file is removed: an entry already there under that name (EEXIST) is not ours.
    if (made) { try { fs.rmSync(tmp, { force: true }); } catch { /* keep the copy's own error */ } }
    throw e;
  }
}
export function copyDir(src, dest, { within } = {}) {
  refuseLinkedWrite(dest, within);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}
// E161 — which Node line this is. Below 18 yadflow does not run (YAD-ENV-003). 18 and 20 are end of life:
// yadflow 4 still runs on them, with a warning (YAD-ENV-004), and yadflow 5 needs 22. 22 and later are ok.
export const NODE_FLOOR = 18;
export const NODE_SUPPORTED = 22;
export function nodeSupport(version = process.versions.node) {
  const major = Number(String(version).replace(/^v/, '').split('.')[0]);
  return !(major >= NODE_FLOOR) ? 'unsupported' : major < NODE_SUPPORTED ? 'end-of-life' : 'ok';
}
export const nodeEndOfLife = (version) => `Node ${version} is end of life and gets no security fixes. yadflow 4 still runs on it; yadflow 5 will need Node ${NODE_SUPPORTED} or newer. Upgrade: https://nodejs.org`;

// Remove a file or a folder tree, read-only folders too: each folder is opened (its owner may write) first,
// since a folder whose mode forbids writing keeps its files from `rmSync`. A path that is not there is fine.
export function rmTree(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return; }
  if (st.isDirectory()) {
    try { fs.chmodSync(p, (st.mode & 0o7777) | 0o700); } catch { /* not ours to open: rmSync says why */ }
    for (const name of fs.readdirSync(p)) rmTree(path.join(p, name));
  }
  fs.rmSync(p, { recursive: true, force: true });
}

// Copy a folder into another, joining folders and never replacing a file: a file that is already there is
// an EEXIST error. `fs.cpSync(…, { errorOnExist: true, force: false })` did this up to Node 22; Node 24
// refuses a folder that exists too, even an empty one, so a move into a folder with the user's own files
// failed. A new folder keeps its source's permissions, and a file its mode (copyFileSync). A link is copied
// as the link it is (cpSync made a relative link absolute, into the source the move then deletes).
// Anything else (a named pipe, a device) is refused, as cpSync did. `created`, when given, collects every
// path this copy made, so a failed move removes those and nothing that was there before.
export function cpMerge(src, dest, created = null) {
  const st = fs.lstatSync(src);
  let there = true;
  try { fs.lstatSync(dest); } catch { there = false; }
  if (st.isDirectory()) {
    // The source's mode is set after the folder is filled: a read-only folder must still take its files.
    if (!there) { fs.mkdirSync(dest); created?.push(dest); }
    for (const name of fs.readdirSync(src)) cpMerge(path.join(src, name), path.join(dest, name), created);
    if (!there) fs.chmodSync(dest, st.mode & 0o7777);
    return;
  }
  if (there) throw Object.assign(new Error(`EEXIST: ${dest} already exists, and a copy never replaces a file`), { code: 'EEXIST' });
  if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dest);
  else if (st.isFile()) fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  else throw Object.assign(new Error(`${src} is not a file, a folder or a link, so it is not copied`), { code: 'EINVAL' });
  created?.push(dest);
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
// Rule 1 of the change-safety rules (docs/design-rules.md, Part 2): every file the engine writes
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
// Exported so the dial stampers (migrate.mjs, epic-state.mjs) and doctor all decide "is this a step
// object" the same way. Three private copies drifted once already: one guarded arrays, one did not,
// so an array-valued step came out as `["x"]` from one and `{"0":"x"}` from the other.
export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const underSdlcDir = (p) => {
  const dir = path.dirname(path.resolve(p));
  return path.basename(dir) === '.sdlc' || path.basename(path.dirname(dir)) === '.sdlc';
};
const carriesShape = (p, v) => isPlainObject(v) && underSdlcDir(p);

// Always FIRST in the serialized object. A stamp that moved around between writers would change the
// bytes without changing the meaning. An existing version is preserved, never forced back or forward,
// so a file already on another shape survives being read and written by this release.
//
// Reading and writing do NOT default the same way, and the difference is load-bearing:
//
//   read  — a file with no version IS shape 1 (rule 1). Defaulting it to the engine's current shape
//           would be the engine telling itself an old file is already current. Everything downstream
//           believes it: `yad doctor` stops reporting drift, and a plain read-modify-write stamps the
//           engine's shape onto content that was never migrated — after which `yad migrate` skips the
//           file forever, because its own claim says there is nothing to do. Silent, permanent, and
//           invisible until someone asks why a field never got renamed.
//   write — a NEW object, one that was never read from disk and so has no version of its own, is
//           written by this engine and therefore has this engine's shape.
//
// This was harmless while SCHEMA_VERSION was 1, because the two defaults were the same number. It
// stops being harmless the moment the shape moves, which is why it is fixed in the commit that moves it.
const readShape  = (p, v) => (carriesShape(p, v) ? { schemaVersion: v.schemaVersion ?? 1, ...v } : v);
const writeShape = (p, v) => (carriesShape(p, v) ? { schemaVersion: v.schemaVersion ?? SCHEMA_VERSION, ...v } : v);

// A JSON file yad reads must be a plain file of its own (E125 b). Anyone who can commit to the Product
// controls its files: a committed `.sdlc/repos.json` that links to `/dev/zero` made yad hang on a read
// that never ends, and a link elsewhere made yad read a file outside the Product. So the entry is looked at
// with `lstat` first, and a link, a folder, a device or a pipe is never opened.
//
// Returns the file's text, `null` when there is no file (the same as `existsSync` saying no), or throws an
// error with code NOT_PLAIN_FILE. The file is then opened with O_NOFOLLOW and O_NONBLOCK and checked again
// on the open handle, so a link put in its place between the two steps is refused too, and opening a pipe
// never waits for a writer. (Windows has neither flag; there the `lstat` check stands alone.)
export const NOT_PLAIN_FILE = 'YAD_NOT_PLAIN_FILE';

// A linked FOLDER inside the Product (#214). The checks above look at the file's own name only, so a committed
// `.sdlc` (or `epics/`, an epic's folder, `.sdlc/build-state/`) that links elsewhere made yad read and write
// files outside the Product under the Product's names. So a path inside the Product is read or written only
// when each folder between the Product's folder and the file is a real folder, not a link: the file's real
// folder is then the folder its path names inside the Product's real folder. A path outside the Product is
// read as before. The Product's folder is set once per command, when yad settles it (`setProductRoot`); a
// caller whose files live in another folder (a code repo's risk map) names that folder with `{ within }`.
//
// Each folder is looked at with `lstat` on every read and write, never cached: it costs a few microseconds a
// folder, and yad itself can swap a folder mid-command (a `git checkout` of a branch that commits a link).
let productRoot = null;
// `realpathSync.native` gives the disk's own spelling (its case too, on macOS), which `realpathSync` does not.
const rootOf = (dir) => {
  const at = path.resolve(dir);
  let real = at;
  try { real = fs.realpathSync.native(at); } catch { /* not made yet: its own spelling only */ }
  return { at, real };
};
// `null` ends it (between tests, or a command that leaves the Product).
export function setProductRoot(dir) { productRoot = dir ? rootOf(dir) : null; }
// macOS and Windows disks ignore case by default: `/Users/x/Product/.SDLC` is the Product's `.sdlc`, so the
// spelling is compared with case folded there. The walk then looks at the caller's own spelling of each
// folder, which the disk finds the same way.
const FOLD_CASE = process.platform === 'darwin' || process.platform === 'win32';
const fold = (s) => (FOLD_CASE ? s.toLowerCase() : s);
// The path of `abs` inside `root` ('' for the root itself), or null when it is not inside. Both spellings of
// the root count: on macOS the temp folder is `/var/…` and `/private/var/…`, and some callers resolve first.
function insideRoot(root, abs) {
  for (const base of root.real === root.at ? [root.at] : [root.at, root.real]) {
    if (fold(abs) === fold(base)) return { base, rel: '' };
    const head = base.endsWith(path.sep) ? base : base + path.sep;
    if (fold(abs).startsWith(fold(head))) return { base, rel: abs.slice(head.length) };
  }
  return null;
}
// The roots a path is checked against: the Product's, and the caller's own (`within`) on top of it, so a
// code repo kept inside the Product's folder is checked from the Product down too.
const rootsFor = (within) => [productRoot, within ? rootOf(within) : null].filter(Boolean);
// The first folder between a root and `abs`'s folder that is a link, with that root, or null. A folder that
// is not there ends the walk: nothing below it exists, and a write makes real folders from there down.
function linkedFolderOf(abs, within) {
  for (const root of rootsFor(within)) {
    const hit = insideRoot(root, path.dirname(abs));
    if (!hit || hit.rel === '') continue;
    let at = hit.base;
    for (const part of hit.rel.split(path.sep)) {
      at = path.join(at, part);
      let st;
      try { st = fs.lstatSync(at); } catch { break; }
      if (st.isSymbolicLink()) return { folder: at, root };
      if (!st.isDirectory()) break;
    }
  }
  return null;
}
// A path as yad names it: inside the caller's folder (`within`) or the Product, by its path there with `/`
// (never the absolute path, which would land in a `--json` run's warnings); outside both, as given.
function productShown(p, within, only) {
  const abs = path.resolve(p);
  for (const root of only ? [only] : rootsFor(within).reverse()) {
    const hit = insideRoot(root, abs);
    if (hit && hit.rel !== '') return hit.rel.split(path.sep).join('/');
  }
  return p;
}
// "<folder> is a link, so yad did not read <file> (…)": the folder first, as it is the one to replace.
const linkedFolder = (p, { folder, root }, verb) => Object.assign(
  new Error(`${productShown(folder, null, root)} is a link, so yad did not ${verb} ${productShown(p, null, root)} (it ${verb}s a file there only through real folders)`),
  { code: NOT_PLAIN_FILE, kind: 'link', folder: productShown(folder, null, root) },
);
function refuseLinkedFolder(p, within, verb) {
  const hit = linkedFolderOf(path.resolve(p), within);
  if (hit) throw linkedFolder(p, hit, verb);
}
// How a linked folder is undone: `git checkout -- <folder>` would bring the committed link back.
export const LINKED_FOLDER_FIX = 'remove the link (`git rm <folder>`), then restore the real folder from a commit where it was a folder (`git checkout <good-commit> -- <folder>`)';
// What a caller that names the file itself says of a refused read: the linked folder when there is one.
export const notPlainSaid = (e, said) => (e?.folder ? `is under ${e.folder}, a linked folder, so it was not read` : said);
// A write under a linked folder: a YAD-STATE-001 with the way out, so a command stops with a clear answer.
// It keeps the plain read's `kind` and `folder`. Exported for a writer that moves files itself (a rename), so
// it stops before the first move.
export function refuseLinkedWrite(p, within) {
  try { refuseLinkedFolder(p, within, 'write'); } catch (e) {
    throw Object.assign(err('YAD-STATE-001', e.message, `${LINKED_FOLDER_FIX}, then run the command again`), { kind: e.kind, folder: e.folder });
  }
}
// A Product whose `.sdlc` is a link is refused as a whole (#214): its settings decide whether the Product is
// verified, and a lenient read of them through the link would run a verified Product as an unverified one.
// Called where yad settles a Product folder that already exists.
export function refuseLinkedSettings(dir) {
  let st;
  try { st = fs.lstatSync(path.join(dir, '.sdlc')); } catch { return; }
  if (st.isSymbolicLink()) throw Object.assign(err('YAD-STATE-001', '.sdlc is a link, so yad did not read the Product\'s settings or files in it (it reads them only through real folders)', `${LINKED_FOLDER_FIX}, then run the command again`), { kind: 'link', folder: '.sdlc' });
}
const OPEN_PLAIN = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
// `kind` says what was there instead: 'dir', 'link' or 'other' (a device, a pipe, a socket).
const notPlain = (p, kind, within) => Object.assign(new Error(`${productShown(p, within)} is not a plain file (a link, a folder or a device), so yad did not read it`), { code: NOT_PLAIN_FILE, kind });
const kindOf = (st) => (st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'other');
// No Product file yad reads comes near this size (#215). Anyone who can commit to the Product could
// commit a file of hundreds of megabytes, and every command that reads it would load it whole into memory.
// So a plain file larger than this is refused before any byte of it is read: its size is taken from the open
// handle, the same one the read uses. Generous on purpose: the same reads load Markdown (an epic, a story,
// DESIGN.md), `.gitignore`, the local setup script and migrate's backups. `cli/detect.mjs` uses it too.
// The constant lives in manifest.mjs, which this file imports, so `mirrorDrift` there uses the same one.
// A caller whose file is generated and can be bigger (the brain's code graph) passes its own `max`.
export { MAX_PLAIN_BYTES };
export const FILE_TOO_BIG = 'YAD_FILE_TOO_BIG';
// The words after a file's name, for a caller that names the file by its path inside the Product.
export const tooBigSaid = (limit = MAX_PLAIN_BYTES) => `is larger than ${limit / (1024 * 1024)} MiB, the most yad reads, so yad did not read it`;
export const TOO_BIG_SAID = tooBigSaid();
// `size` is the size seen: for a file that grew while it was read, the bytes read so far (more than `limit`).
const tooBig = (p, size, limit, within) => Object.assign(new Error(`${productShown(p, within)} ${tooBigSaid(limit)}`), { code: FILE_TOO_BIG, size, limit });
// At most `max` bytes from the open file. The size `fstat` gave can be out of date by the time of the read (a
// file that grows, or one that was empty then), so the read never trusts it: it reads into a buffer of at most
// `max + 1` bytes, and a byte past the limit means the file is too big. No read runs to the end of the file.
function readCapped(fd, p, size, max, within) {
  let buf = Buffer.allocUnsafeSlow(Math.min(size, max) + 1);
  let n = 0;
  for (;;) {
    if (n === buf.length) {
      if (n > max) throw tooBig(p, n, max, within);
      const more = Buffer.allocUnsafeSlow(Math.min(buf.length * 2, max + 1));
      buf.copy(more, 0, 0, n);
      buf = more;
    }
    const got = fs.readSync(fd, buf, n, buf.length - n, null);
    if (got === 0) return buf.subarray(0, n);
    n += got;
  }
}
// The read itself. Every failure is thrown, the `lstat` one too, so a caller can tell a missing file
// (ENOENT) from one it may not read. `encoding: null` gives the raw bytes.
function readPlainOrThrow(p, encoding = 'utf8', opts = {}) {
  refuseLinkedFolder(p, opts?.within, 'read');
  return readPlainAt(p, encoding, opts);
}
// The file is looked at and opened by the same normalised path the folder walk checked; it is named as given.
function readPlainAt(p, encoding = 'utf8', { max = MAX_PLAIN_BYTES, within } = {}) {
  const at = path.resolve(p);
  const st = fs.lstatSync(at);
  if (!st.isFile()) throw notPlain(p, kindOf(st), within);
  let fd;
  try { fd = fs.openSync(at, OPEN_PLAIN); } catch (e) { if (e.code === 'ELOOP') throw notPlain(p, 'link', within); throw e; }
  try {
    const now = fs.fstatSync(fd);
    if (!now.isFile()) throw notPlain(p, kindOf(now), within);
    if (now.size > max) throw tooBig(p, now.size, max, within);
    const bytes = readCapped(fd, p, now.size, max, within);
    return encoding === null ? bytes : bytes.toString(encoding);
  } finally { fs.closeSync(fd); }
}
// `opts.max` (each plain read takes it): the most bytes read, MAX_PLAIN_BYTES unless named. `opts.within`: the
// folder whose sub-folders must not be links, when it is not the Product's.
export function readPlainFile(p, opts) {
  // Before the first look: a linked folder whose target has no such file must not read as "no file", which
  // a caller would then write.
  refuseLinkedFolder(p, opts?.within, 'read');
  try { fs.lstatSync(path.resolve(p)); } catch { return null; }
  // A file removed between the two looks is no file, as it would have been a moment earlier.
  try { return readPlainAt(p, 'utf8', opts); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
// The raw bytes, for a caller that hashes them. Every failure is thrown, a missing file as ENOENT.
export const readPlainBytes = (p, opts) => readPlainOrThrow(p, null, opts);
// A committed text file read as plain text (#222): a CI workflow, a GitLab fragment, a gate script, a git hook.
// The text, or `null` for anything yad will not or cannot read: no file, a link (dangling or not), a folder, a
// device or a pipe, a file under a linked folder of the Product, a file too big, one it may not open. So it
// never follows a link and never waits on a device, and a caller keeps its one answer for "no file". A caller
// that must tell a refused file from a missing one (to leave it alone rather than write it) uses
// `readPlainFile`, which throws NOT_PLAIN_FILE or FILE_TOO_BIG for those.
export function readPlainText(p, opts) {
  try { return readPlainFile(p, opts); } catch { return null; }
}
// One JSON file as it is on disk: no shape stamp, and nothing caught. A missing file throws ENOENT, a link
// or a folder throws NOT_PLAIN_FILE, a file larger than MAX_PLAIN_BYTES throws FILE_TOO_BIG, and a file that
// does not parse throws a SyntaxError. So each caller keeps its own answer for each of them, which `readJSON`
// (one fallback for all) cannot give.
export function readPlainJSON(p, opts) {
  return JSON.parse(readPlainOrThrow(p, 'utf8', opts));
}
// Each refused path is named once per run, on stderr: readJSON has many callers, and some print an answer
// on stdout that another program reads (a hook, a `--json` run), which a warning there would break.
const refusedOnce = new Set();
function sayRefused(p, e) {
  // A linked folder is named once, not once for each file read under it.
  const key = e.folder ? `folder:${e.folder}` : p;
  if (refusedOnce.has(key)) return;
  refusedOnce.add(key);
  // A file too big to read is most often the committed file itself, so git has no other copy to restore.
  const fix = e.code === FILE_TOO_BIG ? 'replace it with a file of the right size'
    : e.folder ? LINKED_FOLDER_FIX : 'replace it with the real file (from git)';
  const s = `${e.message} — ${fix}, then run the command again`;
  if (jsonRun) warn(s); else note(`${c.yellow('!')} ${forTerminal(s)}`);
}

export function readJSON(p, def = null) {
  try {
    const text = readPlainFile(p);
    if (text === null) return def;
    // "Read old, write new" (rule 2): an unstamped file reads back as shape 1, so a caller never has
    // to ask whether the file it just loaded predates the stamp.
    return readShape(p, JSON.parse(text));
  } catch (e) {
    // A link or a folder in place of the file reads as no file, like a file that does not parse — but it is
    // named, because the person should replace it.
    // A file too big to read is named the same way.
    if (e?.code === NOT_PLAIN_FILE || e?.code === FILE_TOO_BIG) sayRefused(p, e);
    // The caller's own default is returned untouched: it is not a file, and stamping it would invent
    // a shape for something that was never read from disk.
    return def;
  }
}
// Strict variant for ledger files (the source of truth): a missing file is a normal state and
// returns `def`, but a file that exists and fails to parse must throw — silently defaulting a
// corrupt approvals.json to [] would let the next sync rewrite it and permanently lose approvals.
// A link or a folder in place of a ledger file is refused without reading it (E125 b): it may point at a
// file outside the Product, or at a device whose read never ends. `opts.within`, as for the plain reads: a code
// repo's folder, whose own sub-folders must not be links either (#235).
export function readJSONStrict(p, def = null, opts) {
  let text;
  try { text = readPlainFile(p, opts); } catch (e) {
    if (e?.code === NOT_PLAIN_FILE && e.folder) throw Object.assign(err('YAD-STATE-001', e.message, `${LINKED_FOLDER_FIX} — never delete a ledger blindly`), { kind: e.kind, folder: e.folder });
    if (e?.code === NOT_PLAIN_FILE) throw err('YAD-STATE-001', e.message, 'replace it with the real file from git (`git checkout -- <file>`) — never delete a ledger blindly');
    if (e?.code === FILE_TOO_BIG) throw err('YAD-STATE-001', e.message, 'restore the file from a commit where it had its real size (`git log -- <file>`) — never delete a ledger blindly');
    throw err('YAD-STATE-001', `cannot read ${productShown(p)}: ${e.message}`, 'fix the file or restore it from git — never delete a ledger blindly');
  }
  if (text === null) return def;
  try {
    return readShape(p, JSON.parse(text));
  } catch (e) {
    throw err('YAD-STATE-001', `corrupt JSON in ${productShown(p)}: ${e.message}`, 'fix the file or restore it from git — never delete a ledger blindly');
  }
}
// Atomic: serialize first, write a sibling tmp file (same dir = same filesystem),
// then rename over the target. A killed process can never leave a truncated ledger
// file, and a failed rename never leaves a stray .tmp for `git add -A` to pick up.
// `opts.within`, as for the plain reads: the folder whose sub-folders must not be links, when not the Product's.
export function writeJSON(p, obj, opts) {
  const data = JSON.stringify(writeShape(p, obj), null, 2) + '\n';
  // Byte-identical content is not a write. The ledger writers are unconditional — they re-serialize
  // whether or not anything changed — so this keeps an unchanged sync from touching the file at all
  // (no mtime churn, nothing for a watcher or a `git add -A` to notice). A backstop, not the fix: the
  // load-bearing guarantee is that the serialized bytes are canonically ordered (see #163).
  // Only a plain file is read to compare: a link or a folder there counts as different, and writeFileAtomic
  // then replaces it, so the write never follows the link (E125 b).
  try {
    if (readPlainFile(p, opts) === data) return;
  } catch { /* not a plain file, or unreadable — fall through and write it */ }
  writeFileAtomic(p, data, opts);
}

// Write `data` to `p` through a fresh temporary file and a rename: a crash leaves the old file or the new
// one, never half of either, and a link standing at `p` is replaced rather than followed.
// A linked folder on the way is refused before any folder is made (#214): `mkdirSync` and the rename would
// follow it. The refusal is a YAD-STATE-001 with a hint, so a command stops with a clear answer; it keeps
// the plain read's `kind` and `folder`.
// `opts.mode`: the new file's mode, set on the new file before the rename — never on whatever stands at `p`, which
// a chmod there would follow if it were a link. `opts.keepMode`: the mode of the plain file at `p` now, when there
// is one (a rewrite in place keeps the file's mode, as a plain `writeFileSync` did).
export function writeFileAtomic(given, data, opts) {
  refuseLinkedWrite(given, opts?.within);
  // The same normalised path the walk checked.
  const p = path.resolve(given);
  if (opts?.keepMode && opts.mode === undefined) {
    let st = null;
    try { st = fs.lstatSync(p); } catch { /* none yet: the default mode */ }
    if (st?.isFile()) opts = { ...opts, mode: st.mode & 0o777 };
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // A name nobody can guess, created exclusively (`wx`): a Product can commit `repos.json.<pid>.tmp` as a
  // link, and a plain write follows it — a dangling one too — putting this file's text wherever the link
  // points (`~/.zshenv`; E81 review 17). `wx` refuses any entry already there, links included.
  const tmp = `${p}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { flag: 'wx' });
    if (opts?.mode !== undefined) fs.chmodSync(tmp, opts.mode);
  } catch (e) {
    // A half-written file of our own (a full disk) is removed; an entry that was already there (EEXIST)
    // is not ours to delete.
    if (e.code !== 'EEXIST') { try { fs.rmSync(tmp, { force: true }); } catch { /* keep the write's own error */ } }
    throw e;
  }
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* keep the rename's own error */ }
    throw e;
  }
}

// The `.yad-orig` copy of a file yad is about to replace (#222). The file is read only as a plain file, so a
// link put in its place is never read through (nor a device waited on), and the copy is written through a new
// file and a rename, so a `.yad-orig` that is a link is replaced, never written through. A file that is not
// plain (a link, a folder, a device, one too big, or one under a linked folder) is refused with its error
// (NOT_PLAIN_FILE, FILE_TOO_BIG, or ENOENT when it is gone): the caller then replaces nothing.
export function backupPlain(src, backup) {
  const bytes = readPlainBytes(src);
  let mode;
  try { mode = fs.lstatSync(src).mode & 0o777; } catch { /* gone since the read: the copy keeps the default */ }
  writeFileAtomic(backup, bytes, mode === undefined ? undefined : { mode });
}

// ---- subprocess ---------------------------------------------------------
// Returns { ok, stdout, stderr, code }. Never throws on non-zero exit.
export function run(cmd, args = [], opts = {}) {
  // A subprocess that shares our stdout (`npm run build`) would print into a --json answer: during a
  // --json run its stdout is our stderr instead (E1).
  const stdio = jsonRun && opts.stdio === 'inherit' ? ['inherit', 2, 'inherit'] : opts.stdio;
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts, ...(stdio === undefined ? {} : { stdio }) });
  const ok = r.status === 0;
  let stderr = (r.stderr || '').trim();
  // git too (#526): with glab as git's login helper (`glab auth login`), git passes glab's warning through on a
  // push, fetch, pull, ls-remote or clone.
  if (/^(?:glab|git)(?:\.exe)?$/i.test(path.basename(String(cmd)))) stderr = withoutGlabConfigWarning(stderr, { ok });
  return {
    ok,
    code: r.status,
    stdout: (r.stdout || '').trim(),
    stderr,
    error: r.error,
  };
}

// #509 — glab with more than one config file prints a warning block on EVERY run, before its own output:
//   Warning: Multiple config files found. Only the first one will be used.
//     Using: <file>
//     Ignoring: <file>
//   Consider consolidating to one location to avoid confusion.
// It is not an error (the run still exits 0 when it works), but every caller that shows stderr as the
// reason cuts that reason short, so the warning was all a person saw and the real error was cut off. So the
// block is dropped from what yad reads. When the run FAILED, one short line goes BEFORE the real error
// instead, because a login saved in the ignored file is not used — often the very reason the run failed — and
// a line after glab's long error would be cut off. It shares its line with the error's first line, so a caller
// that shows only stderr's first line still shows the error. Only that exact block is removed. git's own calls get
// the same (#526): git passes its login helper's stderr through, and that helper can be glab.
export function withoutGlabConfigWarning(stderr = '', { ok = true } = {}) {
  const lines = String(stderr).split('\n');
  const isStart = (l) => /^Warning: Multiple config files found\b/i.test(l.trim());
  if (!lines.some(isStart)) return stderr;
  // Every block: one git push runs its login helper more than once (`get`, then `store` or `erase`), and glab
  // prints the block each time (#526 review).
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isStart(lines[i])) { kept.push(lines[i]); continue; }
    while (i + 1 < lines.length && /^\s+(?:Using|Ignoring):/.test(lines[i + 1])) i += 1;
    if (i + 1 < lines.length && /^Consider consolidating\b/i.test(lines[i + 1].trim())) i += 1;
  }
  const rest = kept.join('\n').trim();
  if (ok) return rest;
  const hint = 'glab reads only one of its two config files, so a login saved in the other is not used (see `yad doctor`, glab-config)';
  return rest ? `${hint} — ${rest}` : hint;
}
export const has = (cmd) => run(process.platform === 'win32' ? 'where' : 'which', [cmd]).ok;

// An npm launcher (`npm`, `npx`) is a `.cmd` file on Windows, which Node will not start without a shell
// (since 18.20.2) — a plain spawn fails with EINVAL there. So on Windows it runs through one, each argument in
// double quotes (a Windows path cannot hold a `"`); everywhere else it is spawned directly (E113).
// The launcher name itself stays bare: a `.cmd` found on PATH through a QUOTED name reads `%~dp0` as the
// current folder, so `"npx"` looked for npx-cli.js inside the repo being packed (#326). Callers pass a
// fixed name (`npm`, `npx`), never user input.
export function launcherInvocation(cmd, args, platform = process.platform) {
  if (platform !== 'win32') return { cmd, args, shell: false };
  return { cmd: [cmd, ...args.map((a) => `"${String(a).replace(/"/g, '')}"`)].join(' '), args: [], shell: true };
}
export function runLauncher(cmd, args = [], opts = {}) {
  const inv = launcherInvocation(cmd, args);
  return run(inv.cmd, inv.args, { ...opts, ...(inv.shell ? { shell: true } : {}) });
}

// Push HEAD to origin/<target>, rebasing onto it and retrying on rejection — both the Shape gate
// sync and the Build checkpoint push append-only ledgers to the default branch, so a concurrent
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

// ---- the product config, which lives under two names until v5 ----------------------------------
//
// Read through `productConfigPath` (manifest.mjs), which every reader in cli/ does. Write through
// here: BOTH names, every time.
//
// The duplicate is not sloppiness. The check gates sit committed inside the user's own repository,
// and the ones installed before E122 open `.sdlc/hub.json` by that literal path; they are refreshed by
// `yad update`, which is a separate act from `yad migrate`. So a project whose gates are older than
// its CLI is a real state, and if only the new name existed its `ledger-guard` would find nothing,
// read no platform, call the ledger local, and stop rejecting human commits to it. An upgrade that
// silently disarms a safety gate is worse than a duplicated file. v5 deletes the old name.
//
// Order: the old name first, then the new one, which readers use (`preferring`, cli/manifest.mjs).
// If the second write fails, the pair disagrees and every command refuses until `yad migrate`
// settles it (`mirrorDrift`) — loud, never a silent half-change. The authoritative copy is the one
// left untouched in that case, so the refusal shows the settings every reader was already using.
//
// Write a file that lives under two names. Returns the paths it actually wrote — empty when there
// was nothing to do.
//
// The "nothing to do" case is load-bearing, not an optimisation. The ledger writers are
// UNCONDITIONAL: `yad gate` re-serializes and writes every time, and relies on `writeJSON` doing
// nothing when the bytes match, which is what keeps a read-only pre-merge run from touching the
// working tree at all. A naive mirror breaks that on day one — the new name does not exist yet, so
// every read-only run would create it and leave the tree dirty, and `gate ci` would try to push a
// file it never meant to write. So the comparison happens FIRST, against whichever name is currently
// readable; only a genuine change writes, and then it writes both.
export function writeMirrored(canonicalPath, legacyPath, obj) {
  // Compare against the AUTHORITATIVE copy — the same one readers use (`preferring`,
  // cli/manifest.mjs), which is the new name whenever it exists. Comparing against the other file
  // would let the two rules disagree about whether anything changed.
  const readable = preferring(canonicalPath, legacyPath);
  const next = `${JSON.stringify(writeShape(canonicalPath, obj), null, 2)}\n`;
  // "Unchanged" means BOTH names are already right. A half-made pair — one side missing — is work
  // to do even when the readable copy matches, or the pair can never be repaired: the comparison
  // says nothing changed, nothing is written, and `yad doctor` reports the missing file for ever.
  // A drifted pair fails the same test (the other copy is not `next`), so a write repairs it too.
  const bothPresent = fs.existsSync(canonicalPath) && fs.existsSync(legacyPath);
  // The drift check first: it never opens a name that is a link or not a plain file (E125 b), and a pair that
  // has one is drift. Then the plain read, so a link to /dev/zero is never read; a throw falls through to the
  // write, which replaces the link and never writes through it.
  try {
    if (bothPresent && !mirrorDrift(canonicalPath, legacyPath) && readPlainFile(readable) === next) return [];
  } catch { /* unreadable — treat as a first write and fall through */ }
  writeJSON(legacyPath, obj);
  writeJSON(canonicalPath, obj);
  return [canonicalPath, legacyPath];
}

export function writeProductConfig(root, obj) {
  const written = [];
  for (const { canonical, legacy } of MIRRORED_FILES) {
    const wrote = writeMirrored(path.join(root, canonical), path.join(root, legacy), obj);
    if (wrote.length) written.push(canonical, legacy);
  }
  return written;
}

