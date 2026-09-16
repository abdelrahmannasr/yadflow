// `yad hook ledger-guard` — the harness-side half of the ledger rule (#171).
//
// In verified mode the gate ledger is CI-owned: `templates/checks/ledger-guard.sh` rejects any non-bot
// commit that changes `epics/*/.sdlc/{state,approvals,comments,product-prs,hub-prs}.json` or `epics/*/reviews/*.md`.
// That gate is the authority, but it only speaks at CI time — an agent that hand-edits `state.json`
// learns twenty minutes later, from a failed pipeline with nothing connecting cause to effect. This
// hook says the same thing at the moment of the edit, and names the command that owns the transition.
//
// HARNESS-AGNOSTIC CONTRACT — the reason this is a `yad` subcommand and not Claude-Code-shaped code:
//   stdin   a harness tool-call payload as JSON (optional; `--path <p>` works instead)
//   exit 0  allow
//   exit 2  deny — the reason is on stderr, for the agent to read
// Claude Code's `PreToolUse` protocol is exactly that (exit 2 blocks the call and feeds stderr back to
// the model), and Cursor's `preToolUse` is too (exit 2 is its `deny`), so `hooks/ledger-guard.sh`
// wires BOTH with no adapter logic — the per-harness difference is the settings file it goes in, and
// that lives in `HOOK_ADAPTERS`, not here. Any other harness needs only the same two exit codes.
//
// FAIL-OPEN, deliberately. No Product, unreadable config, an unparseable payload, no git — every one of
// those ALLOWS, with a note on stderr. This is a local guardrail, and one that failed closed would
// brick an agent's ability to edit anything the moment a config went sideways. The asymmetry is the
// design: `ledger-guard` in CI fails closed and is what actually protects the ledger.
import fs from 'node:fs';
import path from 'node:path';
import { note, readJSON, run } from './lib.mjs';
import { isVerifiedLedger , productConfigPath, HOOK_PROJECT_DIR_ENVS } from './manifest.mjs';
import { DISCOVERY_EPIC, FOUNDATION_DIR, FOUNDATION_EPIC } from './epic-state.mjs';

// The CI-owned files, exactly as `templates/checks/ledger-guard.sh` lists them. NOT `contract-lock.json`
// (artifact-side: the architect commits it with the architecture) and NOT `change.json` — both are a
// human's to write, and both are exempt in the gate too.
// Both names of the PR ledger: it was renamed `hub-prs.json` -> `product-prs.json` and the engine
// writes both for one major, so refusing only one would leave the other hand-editable.
const LEDGER_FILES = new Set(['state.json', 'approvals.json', 'comments.json', 'product-prs.json', 'hub-prs.json']);

// `epics/<epic>/.sdlc/<ledger>.json` or `epics/<epic>/reviews/<name>.md` → { epic, rel }; else null.
// Takes a Product-relative POSIX path.
//
// Depth is matched the way the CI gate matches it, not more strictly. Its arms are bash `case`
// globs — `epics/*/.sdlc/state.json` — and a bash glob's `*` spans `/`, so the gate ALSO rejects
// `epics/EP-a/nested/.sdlc/state.json`. Requiring exactly four segments here would have let a path
// through locally that CI blocks, in a guard whose whole claim is that its scope is the gate's.
// The slug is the second segment either way (the gate's `${f#epics/}` / `${_slug%%/*}`).
//
// The Foundation (E75) is the same rule in its own folder: `foundation/.sdlc/<ledger>.json` and
// `foundation/reviews/*.md`, under the fixed id `EP-foundation`. The gate's arms for it are globs of the
// same depth-blind kind, so the same depth-blind match is used here.
export function protectedLedgerPath(rel) {
  const ledgers = [...LEDGER_FILES].map((f) => f.replace('.', '\\.')).join('|');
  const classify = (epic) => {
    if (new RegExp(`/\\.sdlc/(?:${ledgers})$`).test(rel)) return { epic, rel, kind: 'state' };
    if (/\/reviews\/.*\.md$/.test(rel)) return { epic, rel, kind: 'review' };
    return null;
  };
  if (rel.startsWith(`${FOUNDATION_DIR}/`)) return classify(FOUNDATION_EPIC);
  if (!rel.startsWith('epics/')) return null;
  const epic = rel.slice('epics/'.length).split('/')[0];
  if (!epic || epic === '.' || epic === '..') return null;
  return classify(epic);
}

// Every path a tool call would write.
//
// The named keys are Claude Code's, and they are checked first because they are documented and exact:
// `file_path` (Edit/Write), `notebook_path` (NotebookEdit), `path`, and a `MultiEdit`-style `edits[]`
// array of `file_path`.
//
// THE SHAPE RULE EXISTS BECAUSE THE SECOND HARNESS DOES NOT DOCUMENT ITS KEYS (E11). Cursor publishes
// the payload envelope — `tool_name`, `tool_input`, `cwd` — but not what `tool_input` is called
// inside for Write, Edit or Delete. Inventing a name from memory would produce the worst outcome this
// hook has: an entry wired, reported healthy by `yad doctor`, reading a key that does not exist,
// finding no path, and allowing every ledger edit. So instead of guessing a vendor's spelling, any
// key whose NAME ends in `path`, `file`, `paths` or `files` (in snake_case or camelCase) is read as
// one — a structural rule, which `target_file`, `filePath` and `file_path` all satisfy without this
// code having to know which harness sent them.
//
// It matches on the KEY, never on the value. A rule that scanned `tool_input`'s values for anything
// shaped like `epics/…/state.json` would refuse an ordinary edit to a document that merely QUOTES a
// ledger path — and a false deny is far worse here than a miss, because the whole design fails open
// on purpose and CI is what fails closed.
//
// An unrecognised payload still yields nothing, which allows — see the fail-open note above.
const PATH_KEY = /(^|_)(path|file|paths|files)$|[a-z](Path|File|Paths|Files)$/;

function pathsFromInput(input, out) {
  if (!input || typeof input !== 'object') return;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      if (value && PATH_KEY.test(key)) out.push(value);
      continue;
    }
    // A list under a path-shaped key (`paths`, `files`) is a list OF paths; anything else is not.
    if (Array.isArray(value) && PATH_KEY.test(key)) {
      for (const v of value) if (typeof v === 'string' && v) out.push(v);
    }
  }
}

export function payloadPaths(payload) {
  const out = [];
  const input = payload?.tool_input;
  if (!input || typeof input !== 'object') return out;
  for (const key of ['file_path', 'notebook_path', 'path']) {
    if (typeof input[key] === 'string' && input[key]) out.push(input[key]);
  }
  pathsFromInput(input, out);
  // `edits[]` is the one nested shape worth walking: it is how a multi-edit call names several files
  // in one payload, and a top-level scan would never see them. Each edit is scanned by the same rule.
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (typeof edit?.file_path === 'string' && edit.file_path) out.push(edit.file_path);
      pathsFromInput(edit, out);
    }
  }
  return [...new Set(out)];
}

// The Product a path belongs to: the nearest ancestor holding `.sdlc/hub.json`.
//
// Resolved from the PATH, never from the session. The documented layout puts code repos BESIDE the
// Product (`project/{product,backend,mobile}` — see `insideWorkspace` in setup.mjs), so a session opened
// at the workspace has no `hub.json` under its root, and a session-rooted lookup would find nothing
// and silently allow a mutation inside `project/product/epics/…` — the multi-repo, parallel-agent
// setup this hook was reported from.
export function hubRootFor(abs) {
  let dir = path.dirname(path.resolve(abs));
  for (;;) {
    if (fs.existsSync(productConfigPath(dir))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Where a RELATIVE path in the payload is anchored. Only used to make such a path absolute, so the
// Product walk-up above has somewhere to start.
//
// Every harness's project-root variable is tried, in the order the adapters declare them, before git
// is asked (E11). Reading only Claude Code's meant that under any other harness the FIRST branch
// never fired, and a relative payload path was anchored at the git toplevel instead — which in the
// documented multi-repo layout is a code repo, not the Product, so the walk-up found no `hub.json`
// and the guard allowed an edit it should have refused. `env` is a parameter precisely so a test can
// pin that, one harness at a time, without setting real environment variables.
export function baseDirFor(env = process.env, runner = run) {
  for (const name of HOOK_PROJECT_DIR_ENVS) {
    if (env[name]) return env[name];
  }
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
export function resolveHookBase(productRoot, hub, runner = run) {
  const cfg = hub?.default_branch || '';
  const head = runner('git', ['-C', productRoot, 'symbolic-ref', '--short', '--quiet', 'refs/remotes/origin/HEAD']);
  for (const base of [cfg ? `origin/${cfg}` : '', head.ok ? head.stdout : '', 'origin/main']) {
    if (!base || base === 'origin/') continue;
    if (runner('git', ['-C', productRoot, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) return base;
  }
  return null;
}

// Every epic whose ledger is already on the base ref, case-folded. The #162 carve-out, mirrored from
// the gate's `is_seeding`: no CI path can CREATE a ledger (`gate ci` only advances an existing chain,
// at merge, on the default branch), so a brand-new epic's seed is legitimately a human's write and
// rides the first review PR/MR. Mutating a ledger that is already on the base is what only the bot
// may do.
//
// Read with `ls-tree` from the Product, never with a `<rev>:<path>` probe: a rev:path spec is always
// resolved from the repository TOP LEVEL and `-C` does not re-anchor it, so a Product sitting in a
// subdirectory of its repo (a monorepo, or a workspace that is itself a repo) would miss on every
// probe and the guard would allow everything, silently. `ls-tree` run with `-C productRoot` takes a
// cwd-relative pathspec and prints cwd-relative paths, so both halves stay Product-relative.
//
// Slugs are FOLDED because the gate folds them: on a case-insensitive filesystem `epics/ep-x/…` and
// `epics/EP-X/…` are the same file, so a byte-exact compare lets a mutation be laundered as a
// creation — the vector the gate's own header names.
//
// null means the base could not be read at all — "unknown", which ALLOWS. The working tree cannot
// stand in for the base ref: a seed writes `state.json` first, so using that as proof would deny
// every remaining file of the same seed.
export function seededSlugs(productRoot, hub, runner = run) {
  const base = resolveHookBase(productRoot, hub, runner);
  if (!base) return null;
  const tree = runner('git', [
    '-C', productRoot, '-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', '-z', base, '--', 'epics', FOUNDATION_DIR,
  ]);
  if (!tree.ok) return null;
  const slugs = new Set();
  for (const p of tree.stdout.split('\0')) {
    const m = /^epics\/([^/]+)\/\.sdlc\/state\.json$/.exec(p);
    if (m) slugs.add(fold(m[1]));
    if (p === `${FOUNDATION_DIR}/.sdlc/state.json`) slugs.add(fold(FOUNDATION_EPIC));   // E75
  }
  // One product level: with the old spelling on base, a Foundation ledger replaces a CI-owned one
  // rather than creating something new — the same rule the CI gate applies.
  if (slugs.has(fold(DISCOVERY_EPIC))) slugs.add(fold(FOUNDATION_EPIC));
  else if (slugs.has(fold(FOUNDATION_EPIC))) slugs.add(fold(DISCOVERY_EPIC));   // the mirror
  return slugs;
}


// What the agent is told when the edit is refused. Names the command that owns each transition —
// the whole point of #171 was that the ledger write had no command behind it.
export function denyMessage({ epic, rel, productRoot }) {
  return [
    `[yad] Blocked: ${rel} is CI-owned gate state.`,
    '',
    'This Product runs in verified mode, where CI is the sole writer of the gate ledger. The `ledger-guard`',
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
    `hub: ${productRoot}   ·   override for one command: YAD_HOOK_DISABLE=1`,
  ].join('\n');
}

// The decision, with git injectable so the tests can drive every branch. Returns
// `{ allow: true }` or `{ allow: false, message, epic, rel }`.
export function ledgerGuardDecision(paths, { env = process.env, runner = run } = {}) {
  if (env.YAD_HOOK_DISABLE) return { allow: true, skipped: 'YAD_HOOK_DISABLE' };
  if (!paths.length) return { allow: true };
  const base = baseDirFor(env, runner);
  // One `ls-tree` per Product, not one per candidate path: a MultiEdit carries many paths and this runs
  // inside the agent's tool loop.
  const seededByHub = new Map();
  for (const candidate of paths) {
    const abs = path.resolve(base, candidate);
    const productRoot = hubRootFor(abs);
    if (!productRoot) continue;
    // Non-strict on purpose: a hub.json that does not parse is a real problem, but refusing every
    // edit in the repo is not this hook's way of reporting it (`yad doctor` says so properly).
    const hub = readJSON(productConfigPath(productRoot), null);
    if (!isVerifiedLedger(hub)) continue;
    const rel = path.relative(productRoot, abs).split(path.sep).join('/');
    const hit = protectedLedgerPath(rel);
    if (!hit) continue;
    if (!seededByHub.has(productRoot)) seededByHub.set(productRoot, seededSlugs(productRoot, hub, runner));
    const seeded = seededByHub.get(productRoot);
    if (seeded === null) continue;                      // base unreadable — unknown allows
    if (!seeded.has(fold(hit.epic))) continue;          // creation, not mutation (#162)
    return { allow: false, epic: hit.epic, rel, message: denyMessage({ epic: hit.epic, rel, productRoot }) };
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

// HOW A HARNESS IS TOLD THE VERDICT. Two protocols, because the second harness does not accept the
// first (E11).
//
// `exit` is the original and the default: exit 0 allows, exit 2 denies, the reason goes to stderr for
// the model to read. Claude Code reads exactly that.
//
// `cursor` is for a harness whose PERMISSION hooks are answered in JSON on stdout. Cursor's docs are
// explicit that for a permission hook — and `preToolUse` is one — "invalid JSON or a response that
// doesn't match the hook's schema blocks the action". Printing nothing, which is what `exit` does on
// an allow, is invalid JSON. So the exit protocol under Cursor would have blocked EVERY file write in
// a verified project: fail-CLOSED on everything, the one outcome this guard's whole design forbids.
//
// The field names are Cursor's documented permission-hook schema — `permission`, `user_message`,
// `agent_message`, all snake_case. Getting that wrong is quiet in the worst way: an off-schema
// response still BLOCKS, so the write is refused and the test suite is happy, while the text naming
// `yad gate open` is discarded and the agent is told only "no". Speaking at edit time instead of
// leaving it to CI is worth doing only because of that text.
//
// The allow response is a fixed literal with nothing interpolated into it, because a malformed allow
// is a block. The deny response carries the reason, and if a field were ever rejected as off-schema
// the response is invalid — which blocks, which is what a deny wanted anyway. Both failure
// directions are therefore safe, and they are safe in opposite ways on purpose.
//
// A deny exits 0, not 2: the JSON is the authoritative answer and exit 0 is what tells Cursor to read
// it. Exit 2 would also block, but it is documented as the code for "no JSON to read", so it would
// throw away the reason — and naming the command that owns the transition is the entire point of
// speaking at edit time instead of leaving it to CI. The reason also goes to stderr, where Cursor
// logs it, so it is never only in a channel we cannot confirm.
export const HOOK_FORMATS = ['exit', 'cursor'];
const CURSOR_ALLOW = '{"permission":"allow"}';
// `user_message` is what the person sees in the client, `agent_message` what the model reads. The
// same text serves both: the person needs to know why their agent stopped, and the reason already
// names the command rather than just refusing.
const cursorDeny = (message) => JSON.stringify({ permission: 'deny', user_message: message, agent_message: message });

// The `yad hook ledger-guard` entry point. `paths` (from `--path`) is additive to the payload, so
// a harness with no JSON contract can call the guard directly.
export function runLedgerGuardHook({ paths = [], format = 'exit' } = {}) {
  // Only read stdin when there is nothing else to go on. `readFileSync(0)` blocks until EOF, and a
  // caller that passes `--path` (the documented stdin-free alternative) may well have inherited an
  // open pipe from a long-lived parent — `isTTY` is false there, so the TTY guard does not trip and
  // the hook would hang forever. A hang is strictly worse for an agent than a block.
  const payload = paths.length ? null : readPayload();
  const all = [...new Set([...payloadPaths(payload), ...paths])];
  const verdict = ledgerGuardDecision(all);
  // An unknown format is treated as `exit` rather than refused: this runs inside an agent's tool loop,
  // and a usage error there would be a non-zero exit on every single call.
  if (format === 'cursor') {
    if (verdict.allow) {
      process.stdout.write(`${CURSOR_ALLOW}\n`);
      return 0;
    }
    process.stdout.write(`${cursorDeny(verdict.message)}\n`);
    console.error(verdict.message);
    return 0;
  }
  if (verdict.allow) return 0;
  console.error(verdict.message);
  process.exitCode = 2;
  return 2;
}
