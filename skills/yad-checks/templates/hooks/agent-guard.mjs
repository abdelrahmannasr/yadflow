// agent-guard HARNESS HOOK (E158) — before an AI agent's shell command runs, refuse a yad command only the
// person may run (an approval; a gate comment, advance or reopen; `commit --manual`), a PR/MR approval or merge
// (`gh`, `glab`), skipping the git hooks (`--no-verify` or `-n`, `YAD_HOOK_DISABLE`, `core.hooksPath`), or a force
// push, and say what to do instead: ask the person to run it themselves.
//
// This file is only the ADAPTER. It locates `yad` and hands the payload to `yad hook agent-guard`, which
// holds the decision (cli/agent-guard.mjs). ONE script serves both harnesses, and answers in the protocol
// the payload names:
//
//   Claude Code  `PreToolUse`, matcher `Bash`: exit 0 allows, exit 2 denies with the reason on stderr
//   Cursor       `beforeShellExecution`: a permission hook — a JSON verdict on stdout, ALWAYS, since an
//                empty or off-schema answer blocks the command
//
// A SPEED BUMP, NOT PROOF: a command hidden in a script or an alias is not seen. The platform, and CI's
// ledger guard, are what prove an approval. Codex has no hooks: there only the rules in AGENTS.md apply.
//
// A NODE SCRIPT (E113), importing nothing outside Node, because it runs from the Product (`hooks/`) or a
// connected code repo (`checks/`, E158b), where yadflow may not be installed at all.
//
// FAIL-OPEN: if no `yad` can be found, or it cannot run, the command is ALLOWED and this says why on stderr.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- yad-resolve (the same block in every hooks/*.mjs; a test keeps the copies identical) ----------
// The Product root is this script's grandparent — `<product>/hooks/<script>.mjs` — found from the
// script's OWN location, never from the harness's working directory or its project-root variable
// (whose form on Windows, `C:\…` or `/c/…`, no harness documents). `realpathSync` so a script reached
// through a symbolic link still finds its own Product.
const PRODUCT_ROOT = path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))));
const IS_WINDOWS = process.platform === 'win32';

// A command found on PATH, or null. On Windows the npm launchers are `.cmd` files.
function onPath(name) {
  const exts = IS_WINDOWS ? ['.cmd', '.exe', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      try { if (fs.statSync(full).isFile()) return full; } catch { /* not here */ }
    }
  }
  return null;
}

// Windows cannot start a `.cmd` launcher without a shell (Node refuses since 18.20.2), so those run
// through one, each word in double quotes. A Windows path cannot hold a `"`, so the quoting is whole.
const quoteForCmd = (word) => `"${String(word).replace(/"/g, '')}"`;

// How to run `yad`, cheapest and most specific first: an explicit override, then the copy installed in
// this Product, then `yad` on PATH, then a network-free npx. `--no-install` matters — a hook runs on
// every tool call and must never pause an agent to download a package. Returns
// `{ file, args, shell }` or null.
function resolveYad() {
  // YAD_BIN is commonly an interpreter plus a script ("node /path/to/yad.mjs"). Split on spaces, with a
  // double-quoted word kept whole — Node on Windows usually lives under `C:\Program Files\`.
  const override = [...(process.env.YAD_BIN || '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]).filter(Boolean);
  if (override.length) {
    const [file, ...args] = override;
    return { file, args, shell: IS_WINDOWS && /\.(cmd|bat)$/i.test(file) };
  }
  const local = path.join(PRODUCT_ROOT, 'node_modules', 'yadflow', 'bin', 'yad.mjs');
  if (fs.existsSync(local)) return { file: process.execPath, args: [local], shell: false };
  const yad = onPath('yad');
  if (yad) {
    if (!IS_WINDOWS || !/\.(cmd|bat)$/i.test(yad)) return { file: yad, args: [], shell: false };
    // An npm global install puts the package beside its launcher: run the script with this Node
    // rather than through a shell whenever it is there.
    const script = path.join(path.dirname(yad), 'node_modules', 'yadflow', 'bin', 'yad.mjs');
    if (fs.existsSync(script)) return { file: process.execPath, args: [script], shell: false };
    return { file: yad, args: [], shell: true };
  }
  const npx = onPath('npx');
  if (npx) return { file: npx, args: ['--no-install', 'yadflow'], shell: IS_WINDOWS && /\.(cmd|bat)$/i.test(npx) };
  return null;
}

// Run the resolved `yad` with `args` appended. `options` go to spawnSync.
function runYad(yad, args, options) {
  const all = [...yad.args, ...args];
  if (yad.shell) return spawnSync([yad.file, ...all].map(quoteForCmd).join(' '), { ...options, shell: true, windowsHide: true });
  return spawnSync(yad.file, all, { ...options, windowsHide: true });
}
// ---- end yad-resolve ---------------------------------------------------------------------------------

// Read all of stdin. `fs.readFileSync(0)` throws EAGAIN when stdin is a pipe in non-blocking mode whose
// data has not arrived yet — seen on macOS — and the hook then read nothing and allowed. So this reads in a
// loop and, on EAGAIN, waits 5 ms and tries again, for up to `limitMs`; after that the error goes to the
// caller, which fails open as before. A read of 0 bytes (or Windows' EOF error) is the end.
function readStdin(limitMs = 5000) {
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  const nap = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + limitMs;
  for (;;) {
    let n;
    try { n = fs.readSync(0, buf, 0, buf.length, null); } catch (e) {
      if (e?.code === 'EAGAIN' && Date.now() < until) { Atomics.wait(nap, 0, 0, 5); continue; }
      if (e?.code === 'EOF') break;
      throw e;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// The payload is read here, so the protocol can be chosen even when `yad` cannot be reached.
let input = '';
try { input = process.stdin.isTTY ? '' : readStdin(); } catch { input = ''; }
let payload = null;
try { payload = JSON.parse(input); } catch { payload = null; }
const cursor = payload?.hook_event_name === 'beforeShellExecution' || typeof payload?.cursor_version === 'string';
const ALLOW = '{"permission":"allow"}';
// Exit with `code` once `text` is written. stdout to a pipe is asynchronous on macOS, so a `process.exit`
// straight after `process.stdout.write` can lose the verdict — and Cursor reads an empty answer as a block.
// The promise never resolves: `await finish(…)` also stops the code below it.
const finish = (code, text = '') => new Promise(() => {
  if (!text) process.exit(code);
  process.stdout.write(text, () => process.exit(code));
});
const allow = (why) => {
  if (why) process.stderr.write(`  • yad hook: ${why} — allowing\n`);
  return finish(0, cursor ? `${ALLOW}\n` : '');
};

const yad = resolveYad();
if (!yad) await allow(`no \`yad\` on PATH and none installed in ${PRODUCT_ROOT} (install yadflow to re-arm the agent guard)`);

const r = runYad(yad, ['hook', 'agent-guard', '--format', cursor ? 'cursor' : 'exit'], { input, stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf8' });
if (cursor) {
  // The verdict is the last non-empty line that names a permission (see ledger-guard-cursor.mjs for why).
  const lines = String(r.stdout || '').split(/\r?\n/).filter((l) => l.trim());
  const verdict = lines.length ? lines[lines.length - 1] : '';
  if (verdict.includes('"permission"')) await finish(0, `${verdict}\n`);
  await allow(r.status === 0 ? '' : `\`yad hook agent-guard\` ${r.error ? r.error.message : `exited ${r.status ?? r.signal}`} (run \`yad doctor\` to check the install)`);
}
// Only an explicit deny (2) blocks: a yad that cannot run, or one older than this hook (it refuses the
// unknown action with another code), must not read as a refusal.
if (r.status === 2) await finish(2, r.stdout || '');
if (r.status !== 0) {
  if (r.stdout) process.stdout.write(r.stdout);
  await allow(`\`yad hook agent-guard\` ${r.error ? r.error.message : `exited ${r.status ?? r.signal}`} (run \`yad doctor\` to check the install)`);
}
await finish(0, r.stdout || '');
