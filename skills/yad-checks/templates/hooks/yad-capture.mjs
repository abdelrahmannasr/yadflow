// yad-capture HARNESS HOOK — background capture of Shape artifacts (E43).
//
// Runs AFTER an agent edits a file, and snapshots every changed artifact of the Product onto the
// person's private `yad/wip/<name>/<epic>` branches — built with git plumbing, so the checkout, the
// index and the current branch are never touched. The push runs in the background, at most once
// every few minutes. The decision lives in `yad capture --hook`; this file only locates `yad`.
//
// Wired by `yad check --fix`, in BOTH ledger modes:
//   Claude Code  a `PostToolUse` hook in `.claude/settings.json`:  node "$CLAUDE_PROJECT_DIR/hooks/yad-capture.mjs" --format claude
//   Cursor       an `afterFileEdit` hook in `.cursor/hooks.json`:  node hooks/yad-capture.mjs
// Any other harness: run `node <product>/hooks/yad-capture.mjs` (or `yad capture --hook`) after a file write.
//
// A NODE SCRIPT, NOT A SHELL SCRIPT (E113), so it runs the same on Windows, macOS and Linux.
//
// The contract: it ALWAYS exits 0 — a capture must never block or slow an agent. A problem is one line on
// stderr. Stdout carries ONE thing, and only with `--format claude`: when a file this edit changed is also
// being edited by someone else (E46 claims), a PostToolUse JSON note the agent reads. Otherwise it prints
// nothing. The format is passed by the entry and never guessed from the environment: Cursor sets
// `CLAUDE_PROJECT_DIR` too, as an alias. `YAD_CAPTURE=0`, or `"capture": false` in the Product config,
// turns it off.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- yad-resolve (the same block in every hooks/*.mjs; a test keeps the copies identical) ----------
// The Product root is this script's grandparent — `<product>/hooks/<script>.mjs` — found from the
// script's OWN location, never from the harness's working directory or its project-root variable
// (whose form on Windows, `C:\…` or `/c/…`, no harness documents). `realpathSync` so a script reached
// through a symbolic link still finds its own Product.
const HUB_ROOT = path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))));
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
  const local = path.join(HUB_ROOT, 'node_modules', 'yadflow', 'bin', 'yad.mjs');
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

// Drain the payload the harness sends on stdin, so it never sees a broken pipe — but never wait on it: not
// at all from a terminal (someone ran this by hand), and at most a second on a pipe that never closes.
function drainStdin() {
  if (process.stdin.isTTY) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); process.stdin.pause(); resolve(); };
    const timer = setTimeout(done, 1000);
    process.stdin.on('data', () => {});
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    process.stdin.resume();
  });
}

async function main() {
  await drainStdin();
  if (process.env.YAD_CAPTURE === '0') return;
  const yad = resolveYad();
  if (!yad) {
    process.stderr.write(`  • yad capture: no \`yad\` on PATH and none installed in ${HUB_ROOT} — nothing captured\n`);
    return;
  }
  // Only `--format claude` is passed through; anything else on the command line is not ours to forward.
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--format');
  const format = i >= 0 && argv[i + 1] === 'claude' ? ['--format', 'claude'] : [];
  // stdin is closed for the child: the payload was drained above and capture reads none.
  runYad(yad, ['capture', '--hook', ...format, '--dir', HUB_ROOT], { stdio: ['ignore', 'inherit', 'inherit'] });
}

main().catch((e) => { process.stderr.write(`  • yad capture: ${e?.message || e}\n`); }).finally(() => process.exit(0));
