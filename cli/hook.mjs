// `yad hook ledger-guard` — the harness-side half of the ledger rule (#171).
//
// In BRIDGE mode the gate ledger is CI-owned: `templates/checks/ledger-guard.sh` rejects any non-bot
// commit that changes `epics/*/.sdlc/{state,approvals,comments,hub-prs}.json` or `epics/*/reviews/*.md`.
// That gate is the authority, but it only speaks at CI time — an agent that hand-edits `state.json`
// learns twenty minutes later, from a failed pipeline with nothing connecting cause to effect. This
// hook says the same thing at the moment of the edit, and names the command that owns the transition.
//
// HARNESS-AGNOSTIC CONTRACT — the reason this is a `yad` subcommand and not Claude-Code-shaped code:
//   stdin   a harness tool-call payload as JSON (optional; `--path <p>` works instead)
//   exit 0  allow
//   exit 2  deny — the reason is on stderr, for the agent to read
// Claude Code's PreToolUse protocol is exactly that (exit 2 blocks the call and feeds stderr back to
// the model), so `hooks/ledger-guard.sh` wires it with no adapter logic; another harness needs only
// the same two exit codes.
//
// FAIL-OPEN, deliberately. No hub, unreadable config, an unparseable payload, no git — every one of
// those ALLOWS, with a note on stderr. This is a local guardrail, and one that failed closed would
// brick an agent's ability to edit anything the moment a config went sideways. The asymmetry is the
// design: `ledger-guard` in CI fails closed and is what actually protects the ledger.
import fs from 'node:fs';
import path from 'node:path';
import { note, readJSON, run } from './lib.mjs';
import { PROJECT_FILES, isBridgeHub } from './manifest.mjs';

// The CI-owned files, exactly as `templates/checks/ledger-guard.sh` lists them. NOT `contract-lock.json`
// (artifact-side: the architect commits it with the architecture) and NOT `change.json` — both are a
// human's to write, and both are exempt in the gate too.
const LEDGER_FILES = new Set(['state.json', 'approvals.json', 'comments.json', 'hub-prs.json']);

// `epics/<epic>/.sdlc/<ledger>.json` or `epics/<epic>/reviews/<name>.md` → { epic, rel }; else null.
// Takes a hub-relative POSIX path.
//
// Depth is matched the way the CI gate matches it, not more strictly. Its arms are bash `case`
// globs — `epics/*/.sdlc/state.json` — and a bash glob's `*` spans `/`, so the gate ALSO rejects
// `epics/EP-a/nested/.sdlc/state.json`. Requiring exactly four segments here would have let a path
// through locally that CI blocks, in a guard whose whole claim is that its scope is the gate's.
// The slug is the second segment either way (the gate's `${f#epics/}` / `${_slug%%/*}`).
export function protectedLedgerPath(rel) {
  if (!rel.startsWith('epics/')) return null;
  const epic = rel.slice('epics/'.length).split('/')[0];
  if (!epic || epic === '.' || epic === '..') return null;
  const ledgers = [...LEDGER_FILES].map((f) => f.replace('.', '\\.')).join('|');
  if (new RegExp(`/\\.sdlc/(?:${ledgers})$`).test(rel)) return { epic, rel, kind: 'state' };
  if (/\/reviews\/.*\.md$/.test(rel)) return { epic, rel, kind: 'review' };
  return null;
}

// Every path a tool call would write. Covers the shapes harnesses actually send: a single
// `file_path` (Edit/Write), `notebook_path` (NotebookEdit), and a `MultiEdit`-style `edits[]` array.
// An unrecognised payload yields nothing, which allows — see the fail-open note above.
export function payloadPaths(payload) {
  const out = [];
  const input = payload?.tool_input;
  if (!input || typeof input !== 'object') return out;
  for (const key of ['file_path', 'notebook_path', 'path']) {
    if (typeof input[key] === 'string' && input[key]) out.push(input[key]);
  }
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) if (typeof edit?.file_path === 'string' && edit.file_path) out.push(edit.file_path);
  }
  return [...new Set(out)];
}

// The hub a path belongs to: the nearest ancestor holding `.sdlc/hub.json`.
//
// Resolved from the PATH, never from the session. The documented layout puts code repos BESIDE the
// hub (`project/{product,backend,mobile}` — see `insideWorkspace` in setup.mjs), so a session opened
// at the workspace has no `hub.json` under its root, and a session-rooted lookup would find nothing
// and silently allow a mutation inside `project/product/epics/…` — the multi-repo, parallel-agent
// setup this hook was reported from.
export function hubRootFor(abs) {
  let dir = path.dirname(path.resolve(abs));
  for (;;) {
    if (fs.existsSync(path.join(dir, PROJECT_FILES.hubConfig))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Where a RELATIVE path in the payload is anchored. Only used to make such a path absolute, so the
// hub walk-up above has somewhere to start.
export function baseDirFor(env = process.env, runner = run) {
  if (env.CLAUDE_PROJECT_DIR) return env.CLAUDE_PROJECT_DIR;
  const top = runner('git', ['rev-parse', '--show-toplevel']);
  return top.ok && top.stdout ? top.stdout : process.cwd();
}

// Case-folded, exactly as the CI gate folds (`tr '[:upper:]' '[:lower:]'`).
const fold = (s) => s.toLowerCase();

// The base ref, resolved in the CI gate's own order: `origin/<default_branch>`, then the remote's
// published default, then `origin/main`. Returns null when none resolves.
//
// ORIGIN refs only — never a bare local branch. A local trunk is whatever the developer last pulled,
// and `git fetch` never fast-forwards it, so probing `main` would report an epic whose review PR has
// already merged as absent from the base and wave a real mutation straight through. That is the
// stale-clone case, and it is the common one, not an edge.
export function resolveHookBase(hubRoot, hub, runner = run) {
  const cfg = hub?.default_branch || '';
  const head = runner('git', ['-C', hubRoot, 'symbolic-ref', '--short', '--quiet', 'refs/remotes/origin/HEAD']);
  for (const base of [cfg ? `origin/${cfg}` : '', head.ok ? head.stdout : '', 'origin/main']) {
    if (!base || base === 'origin/') continue;
    if (runner('git', ['-C', hubRoot, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) return base;
  }
  return null;
}

// Every epic whose ledger is already on the base ref, case-folded. The #162 carve-out, mirrored from
// the gate's `is_seeding`: no CI path can CREATE a ledger (`gate ci` only advances an existing chain,
// at merge, on the default branch), so a brand-new epic's seed is legitimately a human's write and
// rides the first review PR/MR. Mutating a ledger that is already on the base is what only the bot
// may do.
//
// Read with `ls-tree` from the hub, never with a `<rev>:<path>` probe: a rev:path spec is always
// resolved from the repository TOP LEVEL and `-C` does not re-anchor it, so a hub sitting in a
// subdirectory of its repo (a monorepo, or a workspace that is itself a repo) would miss on every
// probe and the guard would allow everything, silently. `ls-tree` run with `-C hubRoot` takes a
// cwd-relative pathspec and prints cwd-relative paths, so both halves stay hub-relative.
//
// Slugs are FOLDED because the gate folds them: on a case-insensitive filesystem `epics/ep-x/…` and
// `epics/EP-X/…` are the same file, so a byte-exact compare lets a mutation be laundered as a
// creation — the vector the gate's own header names.
//
// null means the base could not be read at all — "unknown", which ALLOWS. The working tree cannot
// stand in for the base ref: a seed writes `state.json` first, so using that as proof would deny
// every remaining file of the same seed.
export function seededSlugs(hubRoot, hub, runner = run) {
  const base = resolveHookBase(hubRoot, hub, runner);
  if (!base) return null;
  const tree = runner('git', [
    '-C', hubRoot, '-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', '-z', base, '--', 'epics',
  ]);
  if (!tree.ok) return null;
  const slugs = new Set();
  for (const p of tree.stdout.split('\0')) {
    const m = /^epics\/([^/]+)\/\.sdlc\/state\.json$/.exec(p);
    if (m) slugs.add(fold(m[1]));
  }
  return slugs;
}


// What the agent is told when the edit is refused. Names the command that owns each transition —
// the whole point of #171 was that the ledger write had no command behind it.
export function denyMessage({ epic, rel, hubRoot }) {
  return [
    `[yad] Blocked: ${rel} is CI-owned gate state.`,
    '',
    'This hub runs in bridge mode, where CI is the sole writer of the gate ledger. The `ledger-guard`',
    'check rejects any non-bot commit that changes it, so this edit cannot reach the default branch —',
    'it would fail the review PR/MR and have to be reverted.',
    '',
    'Use the command that owns the transition instead:',
    `  author step done → review opened   yad gate open ${epic} <artifact>`,
    '  the full advance at merge          CI runs `yad gate ci --merged` — nothing to do locally',
    `  a genuinely broken ledger          yad gate repair ${epic}`,
    '',
    'Commit the ARTIFACT only (the .md you authored) and hand off to `yad-review-gate`; the ledger',
    'follows on merge.',
    '',
    `hub: ${hubRoot}   ·   override for one command: YAD_HOOK_DISABLE=1`,
  ].join('\n');
}

// The decision, with git injectable so the tests can drive every branch. Returns
// `{ allow: true }` or `{ allow: false, message, epic, rel }`.
export function ledgerGuardDecision(paths, { env = process.env, runner = run } = {}) {
  if (env.YAD_HOOK_DISABLE) return { allow: true, skipped: 'YAD_HOOK_DISABLE' };
  if (!paths.length) return { allow: true };
  const base = baseDirFor(env, runner);
  // One `ls-tree` per hub, not one per candidate path: a MultiEdit carries many paths and this runs
  // inside the agent's tool loop.
  const seededByHub = new Map();
  for (const candidate of paths) {
    const abs = path.resolve(base, candidate);
    const hubRoot = hubRootFor(abs);
    if (!hubRoot) continue;
    // Non-strict on purpose: a hub.json that does not parse is a real problem, but refusing every
    // edit in the repo is not this hook's way of reporting it (`yad doctor` says so properly).
    const hub = readJSON(path.join(hubRoot, PROJECT_FILES.hubConfig), null);
    if (!isBridgeHub(hub)) continue;
    const rel = path.relative(hubRoot, abs).split(path.sep).join('/');
    const hit = protectedLedgerPath(rel);
    if (!hit) continue;
    if (!seededByHub.has(hubRoot)) seededByHub.set(hubRoot, seededSlugs(hubRoot, hub, runner));
    const seeded = seededByHub.get(hubRoot);
    if (seeded === null) continue;                      // base unreadable — unknown allows
    if (!seeded.has(fold(hit.epic))) continue;          // creation, not mutation (#162)
    return { allow: false, epic: hit.epic, rel, message: denyMessage({ epic: hit.epic, rel, hubRoot }) };
  }
  return { allow: true };
}

// Read the harness payload off stdin. Absent, empty, or unparseable all mean "nothing to inspect" —
// never an error, and never a block.
function readPayload() {
  try {
    if (process.stdin.isTTY) return null;
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    note('yad hook: could not read a JSON tool payload on stdin — allowing');
    return null;
  }
}

// The `yad hook ledger-guard` entry point. `paths` (from `--path`) is additive to the payload, so
// a harness with no JSON contract can call the guard directly.
export function runLedgerGuardHook({ paths = [] } = {}) {
  // Only read stdin when there is nothing else to go on. `readFileSync(0)` blocks until EOF, and a
  // caller that passes `--path` (the documented stdin-free alternative) may well have inherited an
  // open pipe from a long-lived parent — `isTTY` is false there, so the TTY guard does not trip and
  // the hook would hang forever. A hang is strictly worse for an agent than a block.
  const payload = paths.length ? null : readPayload();
  const all = [...new Set([...payloadPaths(payload), ...paths])];
  const verdict = ledgerGuardDecision(all);
  if (verdict.allow) return 0;
  console.error(verdict.message);
  process.exitCode = 2;
  return 2;
}
