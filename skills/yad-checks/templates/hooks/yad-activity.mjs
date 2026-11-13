// yad-activity HARNESS HOOK — the live activity record behind `yad brain view --live` (E178).
//
// Runs AFTER an agent uses a tool, and appends ONE line to `<git common dir>/yad-activity.jsonl`: what kind
// of thing it did (read, search, edit, run), which files of this repo it touched, and when. The live view
// tails that file and lights up the brain as the agent works.
//
// Wired by `yad check --fix` only when the Product sets `"activity": true` (off by default), in the Product
// and in each cloned code repo:
//   Claude Code  a `PostToolUse` hook in `.claude/settings.json`:
//                node "$CLAUDE_PROJECT_DIR/hooks/yad-activity.mjs" --format claude
//   Cursor       `afterFileEdit` and `afterShellExecution` hooks in `.cursor/hooks.json`:
//                node hooks/yad-activity.mjs --format cursor
// (in a code repo the file is `checks/yad-activity.mjs`, since a repo's own `hooks/` is often the app's).
//
// IT NEVER STARTS YAD: it fires on every file the agent reads, so it writes the line itself, with nothing
// but `node:` modules, in a few milliseconds.
//
// WHAT A LINE HOLDS — and nothing else, whatever the harness sends:
//   { v: 1, ts, s, h, op, tool, paths, yad? }
//   s     the first 12 hex characters of sha256(session id) — sessions told apart, never named
//   h     'claude' or 'cursor'
//   op    'read' | 'search' | 'edit' | 'run'
//   tool  the harness's tool name (Read, Grep, Edit, Bash, afterFileEdit, …)
//   paths up to 20 paths, relative to this repo; a path outside it, absolute, or reached through a link
//         that leaves it is dropped
//   yad   for a shell command that is a yad command: '<command> [<action>]' from yad's own list — never the
//         rest of the line
// NEVER STORED: search patterns, command text, prompts, file content, tool output, absolute paths.
//
// THE CONTRACT: it ALWAYS exits 0 and prints nothing on stdout, so it can never block or slow the agent. A
// problem is at most one line on stderr. A line is at most 4 KB, so an append lands whole even when two
// agents write at once. Above 5 MB the file is renamed to `yad-activity.1.jsonl` (one old file is kept).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LOG_NAME = 'yad-activity.jsonl';
export const OLD_LOG_NAME = 'yad-activity.1.jsonl';
export const ROTATE_AT = 5 * 1024 * 1024;
export const MAX_LINE = 4096;
export const MAX_PATHS = 20;

// The yad commands a `run` may name: every key of COMMAND_CLASS (cli/agent-rules.mjs), frozen here because a
// hook imports nothing of yad's. A test holds the two lists equal.
export const YAD_COMMANDS = Object.freeze([
  'assign', 'brain build', 'brain query', 'brain status', 'brain view', 'build done', 'build merged',
  'build ship', 'build start', 'build step', 'build sync', 'build trust', 'capture', 'check', 'checkpoint',
  'ci check', 'claims', 'codeowners check', 'commit', 'defer', 'detect', 'dial', 'docs build', 'docs deploy',
  'docs list', 'docs sync', 'doctor', 'epic new', 'fold', 'foundation new', 'foundation publish',
  'foundation status', 'gate advance', 'gate approve', 'gate ci', 'gate comment', 'gate comments',
  'gate open', 'gate reopen', 'gate repair', 'gate review', 'gate status', 'gate sync', 'gate trailer',
  'gate walkthrough', 'guide', 'help', 'history list', 'history search', 'history show', 'hook agent-guard',
  'hook ledger-guard', 'index', 'init', 'issues assign', 'issues close', 'issues comment', 'issues edit',
  'issues label', 'issues labels', 'issues link', 'issues list', 'issues new', 'issues reopen',
  'issues show', 'issues sync', 'issues unlink', 'join', 'kill', 'member add', 'member list',
  'member remove', 'migrate', 'mode', 'mode solo', 'mode team', 'new', 'next', 'open-pr', 'owners',
  'reconcile check', 'reconcile refresh', 'reconcile wire', 'repo clone', 'repo list', 'repo preview',
  'repo refresh', 'repo sync', 'report', 'review cards', 'review chat', 'review context', 'review nudge',
  'review reconcile', 'review trailer', 'review walkthrough', 'risk-map check', 'risk-map draft', 'roster',
  'run checks', 'scan file', 'setup', 'ship', 'signing check', 'skill bind', 'skill list', 'skill recommend',
  'skill unbind', 'skip', 'standup', 'status', 'story frames', 'sync-status', 'thread', 'tidy up',
  'toolbox add', 'toolbox check', 'toolbox connect', 'toolbox list', 'toolbox remove', 'unassign', 'unblock',
  'undefer', 'unkill', 'unskip', 'update', 'usage', 'worktree add', 'worktree list', 'worktree remove',
]);
const KNOWN = new Set(YAD_COMMANDS);

const CLAUDE_OPS = new Map([
  ['Read', 'read'], ['Grep', 'search'], ['Glob', 'search'],
  ['Edit', 'edit'], ['Write', 'edit'], ['MultiEdit', 'edit'], ['NotebookEdit', 'edit'],
  ['Bash', 'run'],
]);
const CURSOR_OPS = new Map([['afterFileEdit', 'edit'], ['afterShellExecution', 'run']]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const short = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

// The real path of `abs`: its nearest part that exists, resolved through its links, with the rest (not
// written yet, or deleted) added back by name. Null when nothing on the way exists.
function realOf(abs) {
  let head = abs;
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(head), ...tail); } catch { /* go up one */ }
    const up = path.dirname(head);
    if (up === head) return null;
    tail.unshift(path.basename(head));
    head = up;
  }
}

// Text no harness sends as a file path, but that would read as a relative name: a home (`~`), a variable
// (`$HOME`, `%USERPROFILE%`), a URL (`file://…`), and — off Windows — a drive or a backslash path.
const NOT_A_PATH = process.platform === 'win32' ? /^[~$%]|^[a-z][a-z0-9+.-]*:\/\//i : /^[~$%]|[:\\]/;

// A path the harness gave, as a path relative to the repo, or null when it is not inside it. Judged on the
// REAL path (links resolved), against the repo's real root: a link inside the repo that points out is not the
// repo's, and a repo opened through a link (macOS /tmp, a linked projects folder, a Windows junction) still
// matches what the agent typed (E178 review 1).
export function repoPath(given, root, realRoot = root) {
  if (typeof given !== 'string' || !given || given.length > 1024 || given.includes('\0') || NOT_A_PATH.test(given)) return null;
  const real = realOf(path.resolve(root, given));
  if (real === null) return null;
  const rel = path.relative(realRoot, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

// The yad command a shell line runs, as '<command> [<action>]', or null. Only a line that IS a yad command
// (optionally through npx) counts, and only words yad itself names are kept.
export function yadCommand(line) {
  if (typeof line !== 'string') return null;
  const m = /^\s*(?:npx\s+(?:--no-install\s+)?)?yad\s+([a-z][a-z-]{0,30})(?:\s+([a-z][a-z-]{0,30}))?(?=\s|$)/.exec(line);
  if (!m) return null;
  if (m[2] && KNOWN.has(`${m[1]} ${m[2]}`)) return `${m[1]} ${m[2]}`;
  return KNOWN.has(m[1]) || YAD_COMMANDS.some((k) => k.startsWith(`${m[1]} `)) ? m[1] : null;
}

// The record for one payload, or null when the tool is not one this records.
export function recordOf(payload, { root, realRoot = root, now = Date.now(), format = 'claude' } = {}) {
  if (!isObject(payload) || !root) return null;
  const claude = format === 'claude';
  const tool = claude ? short(payload.tool_name, 40) : short(payload.hook_event_name, 40);
  const op = tool && (claude ? CLAUDE_OPS : CURSOR_OPS).get(tool);
  if (!op) return null;
  const input = claude ? (isObject(payload.tool_input) ? payload.tool_input : {}) : payload;
  const given = [];
  for (const key of ['file_path', 'notebook_path', 'path']) if (typeof input[key] === 'string') given.push(input[key]);
  if (Array.isArray(input.edits)) for (const e of input.edits) if (isObject(e) && typeof e.file_path === 'string') given.push(e.file_path);
  const paths = [];
  for (const g of given) {
    const p = repoPath(g, root, realRoot);
    if (p && !paths.includes(p) && paths.length < MAX_PATHS) paths.push(p);
  }
  const session = short(claude ? payload.session_id : payload.conversation_id, 200);
  const rec = {
    v: 1,
    ts: new Date(now).toISOString(),
    s: session ? createHash('sha256').update(session).digest('hex').slice(0, 12) : null,
    h: claude ? 'claude' : 'cursor',
    op,
    tool,
    paths,
  };
  if (op === 'run') {
    const y = yadCommand(input.command);
    if (y) rec.yad = y;
  }
  return rec;
}

// One line, never longer than MAX_LINE: paths are dropped from the end until it fits.
export function lineOf(rec) {
  const r = { ...rec, paths: [...rec.paths] };
  let line = `${JSON.stringify(r)}\n`;
  while (Buffer.byteLength(line) > MAX_LINE && r.paths.length) { r.paths.pop(); line = `${JSON.stringify(r)}\n`; }
  return Buffer.byteLength(line) > MAX_LINE ? null : line;
}

// The folder git keeps this repo's shared data in. `<root>/.git` when it is a folder (the usual case, with
// no process started); for a worktree or a submodule, where `.git` is a file, git is asked.
export function gitCommonDir(root) {
  const dotGit = path.join(root, '.git');
  // No `.git` here at all is a repo whose root is ABOVE this folder (a Product in a subfolder, a monorepo
  // app): git is asked, as for a worktree (E178 review 1).
  try { if (fs.lstatSync(dotGit).isDirectory()) return dotGit; } catch { /* asked below */ }
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 2000 });
  const out = r.status === 0 ? String(r.stdout).trim() : '';
  return out && path.isAbsolute(out) ? out : null;
}

// Append one line, renaming a full log aside first.
export function appendLine(dir, line) {
  const file = path.join(dir, LOG_NAME);
  let size = 0;
  try { const st = fs.lstatSync(file); if (!st.isFile()) return; size = st.size; } catch { /* first line */ }
  if (size + Buffer.byteLength(line) > ROTATE_AT) {
    try { fs.renameSync(file, path.join(dir, OLD_LOG_NAME)); } catch { /* another agent rotated it first */ }
  }
  fs.appendFileSync(file, line, { flag: 'a' });
}

// Read the payload: never from a terminal, at most a second, at most 1 MB.
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    const done = () => { clearTimeout(timer); process.stdin.pause(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const timer = setTimeout(done, 1000);
    process.stdin.on('data', (d) => { size += d.length; if (size <= 1024 * 1024) chunks.push(d); });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    process.stdin.resume();
  });
}

async function main() {
  const text = await readStdin();
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--format');
  const format = i >= 0 && argv[i + 1] === 'cursor' ? 'cursor' : 'claude';
  // The repo is this script's grandparent: `<repo>/hooks/yad-activity.mjs` or `<repo>/checks/yad-activity.mjs`.
  const root = path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))));
  let payload;
  try { payload = JSON.parse(text); } catch { return; }
  const rec = recordOf(payload, { root, realRoot: fs.realpathSync(root), format });
  if (!rec) return;
  const line = lineOf(rec);
  const dir = line && gitCommonDir(root);
  if (dir) appendLine(dir, line);
}

// Run only as the hook itself; a test imports the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch((e) => { process.stderr.write(`  • yad activity: ${String(e?.message || e).slice(0, 200)}\n`); }).finally(() => process.exit(0));
}
