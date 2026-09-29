// ledger-guard HARNESS HOOK — the local half of the CI gate of the same name (#171).
//
// The gate ledger is CI-owned in verified mode: `checks/ledger-guard.sh` rejects any non-bot commit
// that changes `epics/*/.sdlc/{state,approvals,comments,product-prs,hub-prs}.json` or `epics/*/reviews/*.md`,
// and the same files for the Foundation in `foundation/.sdlc/` and `foundation/reviews/` (E75).
// This hook says so at the moment an agent tries the edit, instead of twenty minutes later in a
// failed pipeline, and names the command that owns the transition (`yad gate open`).
//
// This file is only the ADAPTER. It locates `yad` and hands the tool-call payload to
// `yad hook ledger-guard`, which holds the decision. The contract it passes through:
//
//   stdin   the harness's tool-call payload as JSON (optional)
//   exit 0  allow
//   exit 2  deny, reason on stderr
//
// A NODE SCRIPT, NOT A SHELL SCRIPT (E113), so it runs the same on Windows, macOS and Linux. Node is
// the one thing yadflow already needs. It imports nothing outside Node itself, because it runs from the
// Product, where yadflow may not be installed at all.
//
// Wired by `yad check --fix` for every harness that can refuse a write BEFORE it lands:
//   Claude Code  a `PreToolUse` hook in `.claude/settings.json`, pointing straight at THIS script
//   Cursor       a `preToolUse` hook in `.cursor/hooks.json`, pointing at `ledger-guard-cursor.mjs`
//
// DO NOT WIRE THIS SCRIPT INTO CURSOR DIRECTLY, and check the same thing before wiring it into any
// other harness by hand. Cursor's `preToolUse` is a PERMISSION hook: it wants a JSON verdict on
// stdout, and treats an empty or off-schema answer as a refusal. This script prints NOTHING when it
// allows — so wired there directly it would block every file write in the project, which is the
// opposite of the fail-open stance below. `ledger-guard-cursor.mjs` exists to speak that protocol.
//
// A harness that reads the EXIT CODE can use this script as it stands: `node <product>/hooks/ledger-guard.mjs`.
//
// FAIL-OPEN: if no `yad` can be found, this ALLOWS and says why on stderr. A guardrail that blocked
// every edit the moment an install went sideways would be worse than the problem. The CI gate fails
// CLOSED and is what actually protects the ledger.
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

const yad = resolveYad();
if (!yad) {
  process.stderr.write(`  • yad hook: no \`yad\` on PATH and none installed in ${PRODUCT_ROOT} — allowing (install yadflow to re-arm the ledger guard)\n`);
  process.exit(0);
}

// Run it rather than hand the process over, so the exit code can be mapped. ONLY an explicit deny (2)
// blocks: a `yad` that is present but cannot run — an `npx --no-install` with no yadflow to find, a
// crash, a broken install — must not read as a refusal. Fail-open is the whole stance of this hook;
// the CI gate is what fails closed. stdin, stdout and stderr are all the harness's own.
const r = runYad(yad, ['hook', 'ledger-guard', ...process.argv.slice(2)], { stdio: 'inherit' });
if (r.status === 2) process.exit(2);
if (r.status !== 0) {
  const why = r.error ? r.error.message : `exited ${r.status ?? r.signal}`;
  process.stderr.write(`  • yad hook: \`yad hook ledger-guard\` ${why} — allowing (run \`yad doctor\` to check the install)\n`);
}
process.exit(0);
