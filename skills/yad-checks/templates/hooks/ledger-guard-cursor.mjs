// ledger-guard CURSOR ADAPTER — the same guard, answered in the protocol Cursor requires (E11).
//
// Cursor's `preToolUse` is a PERMISSION hook, and its docs are explicit: for a permission hook,
// "invalid JSON or a response that doesn't match the hook's schema blocks the action". Empty stdout is
// invalid JSON. The plain `ledger-guard.mjs` prints nothing when it allows — so wiring it directly
// would have blocked EVERY file write in a verified project, which is the exact opposite of this
// guard's fail-open design.
//
// This wrapper guarantees one thing: a permission answer on stdout, always, whatever happens below.
//
//   allow   {"permission":"allow"}   exit 0
//   deny    {"permission":"deny","user_message":"<reason>","agent_message":"<reason>"}   exit 0
//
// A deny exits 0 because the JSON is the authoritative answer and exit 0 is what tells Cursor to read
// it; exit 2 blocks too, but is documented as the code for "no JSON to read" and would discard the
// reason — and naming the command that owns the transition is the whole point of speaking at edit time.
//
// A NODE SCRIPT, NOT A SHELL SCRIPT (E113). On Windows Cursor starts hooks through PowerShell, which
// cannot run a `.sh` file at all. The entry is `node hooks/ledger-guard-cursor.mjs`: a relative path,
// because Cursor documents that a project hook runs from the project root.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOW = '{"permission":"allow"}';
const allow = () => { process.stdout.write(`${ALLOW}\n`); process.exit(0); };

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

// Every failure below this line resolves to ALLOW, because this guard fails open by design and CI is
// what fails closed. A wrapper that blocked when it could not reach `yad` would stop an agent editing
// anything at all the moment an install went sideways.
const yad = resolveYad();
if (!yad) {
  process.stderr.write(`  • yad hook: no \`yad\` on PATH and none installed in ${PRODUCT_ROOT} — allowing (install yadflow to re-arm the ledger guard)\n`);
  allow();
}

// stdout is CAPTURED (the JSON verdict); stdin (the tool-call payload) and stderr (Cursor's log) are
// the harness's own.
const r = runYad(yad, ['hook', 'ledger-guard', '--format', 'cursor'], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });

// THE VERDICT IS THE LAST NON-EMPTY LINE, not the whole of stdout, and it is recognised by containing
// a `"permission"` key rather than by starting with one. `yad`'s own top-level failure handler prints
// to STDOUT, so a usage error or a crash banner can land in front of the JSON; a prefix test would then
// fail to recognise our own deny and fall through to the allow below. And a containment test does not
// care what order the JSON's properties are in.
const lines = String(r.stdout || '').split(/\r?\n/).filter((l) => l.trim());
const verdict = lines.length ? lines[lines.length - 1] : '';
if (verdict.includes('"permission"')) { process.stdout.write(`${verdict}\n`); process.exit(0); }

// EXIT 2 IS A DENY, even with nothing on stdout — and this branch is reached in a real, ordinary case.
// The Product's own `node_modules/yadflow` comes BEFORE `PATH`, so a project pinned to a yadflow older
// than `--format` parses the flag, ignores it, and answers in the exit protocol: exit 2, empty stdout.
// The message is FIXED: the reason the older `yad` printed has already gone to stderr, where Cursor
// logs it.
if (r.status === 2) {
  process.stdout.write(`${JSON.stringify({
    permission: 'deny',
    user_message: 'yad: this edit touches CI-owned gate state.',
    agent_message: 'This edit touches CI-owned gate state, which CI is the sole writer of. Do not edit the ledger by hand: use `yad gate open` for the transition, and commit only the artifact. The installed yadflow is older than this hook, so the full reason is in the hook log rather than here — `yad doctor` will name the version gap.',
  })}\n`);
  process.exit(0);
}

if (r.status !== 0) {
  const why = r.error ? r.error.message : `exited ${r.status ?? r.signal}`;
  process.stderr.write(`  • yad hook: \`yad hook ledger-guard\` ${why} — allowing (run \`yad doctor\` to check the install)\n`);
}
allow();
