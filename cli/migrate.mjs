// `yad migrate` — the one command that moves a project's files from one shape to the next.
//
// Rule 4 of the change-safety rules (docs/roadmap-idea-1.md, Part 2): one real upgrade command —
// preview, back up, rewrite, report, safe to run twice.
//
// The shape of a file is its `schemaVersion` (cli/lib.mjs stamps it; manifest.mjs holds the engine's
// current number). This command exists so that raising that number is survivable: every project can be
// walked forward, in the open, with a copy of anything it rewrites left beside the original.
//
// Two things it deliberately is NOT:
//
//   * not automatic. Nothing here runs as a side effect of another command. An upgrade that happens
//     without being asked for is how a tool loses the trust this one is selling.
//   * not destructive by default. Running `yad migrate` prints what WOULD change and touches nothing.
//     Only `--apply` writes, and only after copying each file it rewrites to `<file>.yad-orig` — the
//     same backup mechanism `yad check --fix` already uses.
import fs from 'node:fs';
import path from 'node:path';

import { c, exists, fail, hand, info, log, ok, readJSON, warn, writeJSON } from './lib.mjs';
import { BACKUP_SUFFIX, epicFiles, isBridgeHub, MANAGED_LEDGER, PROJECT_FILES, SCHEMA_VERSION, VERSION } from './manifest.mjs';
import { backupPathFor } from './plan.mjs';
import { isValidEpicId } from './epic-state.mjs';

// ---- the migration list --------------------------------------------------------------------
// Ordered steps, each moving a file from one shape to the next. A step is applied to a file only when
// the file's current shape equals its `from`; the list is walked ONCE per file, in order, so a step
// can never be applied twice and a same-version step cannot spin.
//
// The first entry is 1 → 1 on purpose. It changes no field. It exists so the machinery — preview,
// backup, rewrite, report, re-run — is exercised and tested by real use before there is any real shape
// change to trust it with. When a genuine 1 → 2 lands, it appends here and this one stays.
export const MIGRATIONS = [
  {
    from: 1,
    to: 1,
    title: 'baseline — every file states its shape',
    apply: (obj) => obj,
  },
];

// ---- reading a file's shape ---------------------------------------------------------------
// Deliberately NOT readJSON: that reports an unstamped file as shape 1 (rule 2, "read old"), which is
// the right answer for every other caller and the wrong one here. Migrate is the one place that has to
// see the bytes as they are, so it can tell a file that already carries the key from one that does not.
function readRaw(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// A file's shape as recorded ON DISK. An object with no key is shape 1 by rule 1; so is an array,
// which cannot carry a key at all.
const shapeOf = (v) => (isPlainObject(v) && Number.isInteger(v.schemaVersion) ? v.schemaVersion : 1);

// Walk the migration list once. Returns the migrated object, the shape it ended on, and which steps ran.
function applyMigrations(obj, migrations) {
  let out = obj;
  let version = shapeOf(obj);
  const applied = [];
  for (const m of migrations) {
    if (version !== m.from) continue;
    out = m.apply({ ...out });
    version = m.to;
    applied.push(m.title);
  }
  return { obj: out, version, applied };
}

// ---- what the engine would write -----------------------------------------------------------
// The single source of truth for "does this file need writing" is the bytes writeJSON would produce.
// Comparing those against the bytes on disk means preview can never disagree with apply: whatever the
// preview says would change is exactly what a write would change.
const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';

// The version the migration ENDED on wins, so the old key is removed before the new one is written.
// Spreading the object over the stamp instead would let a file's existing `schemaVersion` shadow it:
// the content would migrate while the number stayed put, so the file would be migrated again on every
// later run — each one overwriting its own .yad-orig with already-migrated bytes until the original
// was gone. (This is the one place that must NOT behave like lib.mjs's writeJSON, which preserves a
// file's existing version on purpose. Here, changing it is the entire point.)
const stamped = (obj, version) => {
  const rest = { ...obj };
  delete rest.schemaVersion;
  return { schemaVersion: version, ...rest };
};

// ---- keeping the backups out of the commit ---------------------------------------------------
// The `.yad-orig` copies land beside the files they back up, which for a ledger means inside the
// tracked `epics/<epic>/.sdlc/` tree. Two commands stage that whole directory with `git add -A` —
// `gate sync`'s merge-phase advance and `yad tidy up` — so telling the user "do not commit these"
// would be advice they cannot act on: the next gate advance would sweep them into a `chore(gate)`
// commit and push it to the default branch on its own.
//
// So ignore them instead, idempotently, the way `yad setup` already ignores the repomix packs. Only on
// `--apply`, and only when a backup is actually about to be written — a preview still touches nothing.
export const BACKUP_IGNORE_GLOB = `*${BACKUP_SUFFIX}`;
export const BACKUP_IGNORE_BLOCK = [
  '# Pre-migration copies written by `yad migrate --apply`. They are your safety net on disk,',
  '# not history — the migrated file is what gets committed.',
  BACKUP_IGNORE_GLOB,
];

export function ensureBackupsIgnored(root) {
  const gi = path.join(root, '.gitignore');
  const lines = exists(gi) ? fs.readFileSync(gi, 'utf8').split('\n') : [];
  if (lines.some((l) => l.trim() === BACKUP_IGNORE_GLOB)) return false;
  const body = lines.join('\n').replace(/\n*$/, '');
  const prefix = body ? `${body}\n\n` : '';
  fs.writeFileSync(gi, `${prefix}${BACKUP_IGNORE_BLOCK.join('\n')}\n`);
  return true;
}

// ---- the file set --------------------------------------------------------------------------
// Every JSON file this project's engine owns: the product-level files (including the hub's own
// provenance ledger and each epic's docs-build cache, neither of which is in PROJECT_FILES/epicFiles),
// then each epic's ledger and its three shard folders.
//
// A CONNECTED REPO's own `.sdlc/managed.json` is deliberately not here. It belongs to that repo, is
// rewritten wholesale by that repo's `yad check --fix`, and migrating it from the hub would reach
// across a boundary the rest of the CLI respects. The hub's copy is a different file and is included.
function shardFiles(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => path.join(dir, n));
}

export function projectJsonFiles(root) {
  const files = [];
  for (const rel of Object.values(PROJECT_FILES)) files.push(path.join(root, rel));
  // The hub's own provenance record (cli/plan.mjs) — a stamped object under .sdlc/ like any other.
  files.push(path.join(root, MANAGED_LEDGER));

  const epicsDir = path.join(root, 'epics');
  if (exists(epicsDir)) {
    for (const epic of fs.readdirSync(epicsDir).sort()) {
      if (!isValidEpicId(epic)) continue;
      const epicDir = path.join(epicsDir, epic);
      if (!fs.statSync(epicDir).isDirectory()) continue;
      const f = epicFiles(epicDir);
      files.push(f.state, f.approvals, f.comments, f.hubPrs, f.contractLock,
        f.buildLog, f.trustLog, f.change, f.reconcileDebt);
      files.push(...shardFiles(f.buildLogDir), ...shardFiles(f.trustLogDir), ...shardFiles(f.buildStateDir));
      // The docs-build cache (cli/docs.mjs) lives in the same directory and is written by the engine,
      // so it moves shape with everything else rather than being quietly left behind.
      files.push(path.join(epicDir, '.sdlc', 'docs-build.json'));
    }
  }
  return files.filter((f) => exists(f));
}

// ---- the plan ------------------------------------------------------------------------------
// One row per file. `action` is what would happen, and it is the same value whether this runs as a
// preview or as an apply:
//
//   stamp             an object with no schemaVersion — gets one, no field changes
//   migrate           a real shape change, one or more steps applied
//   unchanged         already on the engine's shape, bytes identical
//   list              a top-level JSON array: shape 1 by rule 1, and it cannot carry a key
//   ahead             the file's shape is NEWER than this engine — never touched, always reported
//   ci-owned          a verified (bridge) hub's ledger file: CI is its only writer
//   unreadable        does not parse — reported, never rewritten
//
// Each row also carries `stamped`: whether the file literally holds a `schemaVersion` key. That is a
// fact about the bytes, read the same way for every branch, so a caller never has to infer it from
// `action` — which would be wrong twice over: `stamp` fires whenever the serialized bytes differ for
// ANY reason (a hand re-indent, say), and `ci-owned`/`ahead`/`list` short-circuit before the byte
// comparison happens at all.
export function planMigration(root, { migrations = MIGRATIONS } = {}) {
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig), null);
  const bridge = isBridgeHub(hub);
  // On a verified hub the ledger guard refuses a human commit to these, so rewriting them locally
  // would produce a change that cannot be committed. Of the four the guard names, only state.json is
  // an object; the rest are arrays and would be skipped anyway.
  const ciOwned = new Set(['state.json', 'approvals.json', 'comments.json', 'hub-prs.json']);

  const rows = [];
  for (const file of projectJsonFiles(root)) {
    const rel = path.relative(root, file);
    const raw = readRaw(file);
    if (!raw.ok) {
      rows.push({ file: rel, from: null, to: null, action: 'unreadable', changes: false, stamped: false, detail: raw.error });
      continue;
    }
    const from = shapeOf(raw.value);
    // Read from the bytes, before any branch: a list can never carry the key, and every other kind
    // either does or does not, whoever owns the file.
    const isStamped = isPlainObject(raw.value) && Number.isInteger(raw.value.schemaVersion);
    if (!isPlainObject(raw.value)) {
      rows.push({ file: rel, from, to: from, action: 'list', changes: false, stamped: false });
      continue;
    }
    if (from > SCHEMA_VERSION) {
      rows.push({ file: rel, from, to: from, action: 'ahead', changes: false, stamped: isStamped });
      continue;
    }
    if (bridge && ciOwned.has(path.basename(file))) {
      rows.push({ file: rel, from, to: from, action: 'ci-owned', changes: false, stamped: isStamped });
      continue;
    }
    const { obj, version, applied } = applyMigrations(raw.value, migrations);
    const next = serialize(stamped(obj, version));
    const current = fs.readFileSync(file, 'utf8');
    const changes = next !== current;
    const action = version !== from ? 'migrate' : (changes ? 'stamp' : 'unchanged');
    // `steps` lists the migrations that actually moved the file's shape. The baseline 1 → 1 runs on
    // every file by design and moves nothing, so naming it on every row would be noise reported as work.
    rows.push({ file: rel, from, to: version, action, changes, stamped: isStamped, ...(version !== from ? { steps: applied } : {}) });
  }
  return { engine: SCHEMA_VERSION, bridge, rows };
}

// ---- the report ----------------------------------------------------------------------------
const ACTION_NOTE = {
  stamp: 'record its shape',
  migrate: 'move to a new shape',
  unchanged: 'already current',
  list: 'a list — counts as shape 1',
  ahead: 'newer than this engine',
  'ci-owned': 'CI writes it — will be stamped by the next gate sync',
  unreadable: 'does not parse — fix it by hand',
};

function printRows(rows) {
  const width = Math.max(...rows.map((r) => r.file.length), 4);
  for (const r of rows) {
    const shape = r.from === null ? '?' : (r.from === r.to ? `shape ${r.from}` : `shape ${r.from} → ${r.to}`);
    const line = `  ${r.file.padEnd(width)}  ${shape.padEnd(14)} ${c.dim(ACTION_NOTE[r.action] ?? r.action)}`;
    if (r.action === 'unreadable' || r.action === 'ahead') fail(line.trim());
    else log(line);
  }
}

// ---- the command ---------------------------------------------------------------------------
// `.sdlc/cli-version.json` is migrated as an ordinary row, like every other project file — it is in
// PROJECT_FILES, so it is previewed, backed up and stamped along with the rest. Nothing here writes it
// a second time to record that a migration happened: a separate side-write would sit outside the plan,
// which means no backup, no row in the report, and a preview that under-reports what an apply does. It
// would also be free to overwrite the one file the same run had just declared corrupt or newer than
// this engine. What shape a file is in is recorded in that file, which is the whole point of rule 1.
export async function runMigrate(root, { apply = false, json = false } = {}, { migrations = MIGRATIONS } = {}) {
  if (!exists(path.join(root, PROJECT_FILES.version)) && !exists(path.join(root, PROJECT_FILES.hubConfig))) {
    const message = 'no yad project here (.sdlc/ not initialised)';
    if (json) { log(JSON.stringify({ version: VERSION, ok: false, error: message }, null, 2)); }
    else { fail(message); hand('run `yad setup` to start one'); }
    process.exitCode = 1;
    return { ok: false };
  }

  const plan = planMigration(root, { migrations });
  const pending = plan.rows.filter((r) => r.changes);
  const blocked = plan.rows.filter((r) => r.action === 'ahead' || r.action === 'unreadable');
  const written = [];

  let ignored = false;
  if (apply) {
    // Before the first backup exists, not after — otherwise a gate advance racing this run could stage
    // one. A no-op when the line is already there.
    if (pending.length) ignored = ensureBackupsIgnored(root);
    for (const row of pending) {
      const file = path.join(root, row.file);
      const raw = readRaw(file);
      if (!raw.ok) continue; // re-read defensively; an unreadable file is never in `pending` anyway
      // Back up first, always. Unlike the wiring copies in plan.mjs — which skip the backup when the
      // file's bytes are provably ours — a ledger has no provenance record, so there is nothing to
      // prove and the copy is unconditional.
      fs.copyFileSync(file, backupPathFor(file));
      const { obj, version } = applyMigrations(raw.value, migrations);
      writeJSON(file, stamped(obj, version));
      written.push(row.file);
    }
  }

  if (json) {
    log(JSON.stringify({
      version: VERSION,
      ok: blocked.length === 0,
      engine: plan.engine,
      applied: apply,
      bridge: plan.bridge,
      changed: apply ? written : pending.map((r) => r.file),
      ...(ignored ? { gitignored: BACKUP_IGNORE_GLOB } : {}),
      rows: plan.rows,
    }, null, 2));
  } else {
    log(c.bold(`\nyad migrate  ${c.dim(`shape ${plan.engine}`)}`));
    log(c.dim(`target: ${root}\n`));
    printRows(plan.rows);
    log('');
    if (!pending.length) {
      ok(`nothing to do — this project is already on shape ${plan.engine}`);
    } else if (apply) {
      ok(`${written.length} file(s) updated — a copy of each is beside it as <file>${BACKUP_SUFFIX}`);
      info('re-run `yad migrate` to confirm there is nothing left to do');
      // These land inside the tracked .sdlc/ tree, so a `git add -A` would sweep them into the commit
      // alongside the migration itself. Say so rather than editing a .gitignore the project owns.
      info(`the ${BACKUP_SUFFIX} copies are yours to keep or delete${ignored ? ` — .gitignore now excludes ${BACKUP_IGNORE_GLOB}, so they stay out of the ledger commit` : ''}`);
    } else {
      info(`${pending.length} file(s) would change — nothing has been written`);
      hand('run `yad migrate --apply` to make the change (each file is backed up first)');
    }
    if (plan.bridge && plan.rows.some((r) => r.action === 'ci-owned')) {
      info('this project is in verified mode: CI owns some ledger files and stamps them on its next gate sync');
    }
    for (const r of blocked) {
      if (r.action === 'ahead') hand(`${r.file} was written by a newer yadflow — upgrade with \`npm i -g ${'yadflow'}\` rather than migrating`);
      if (r.action === 'unreadable') hand(`${r.file} does not parse — restore it from git before migrating`);
    }
    if (blocked.length) warn('some files were left untouched — see above');
  }

  if (blocked.length) process.exitCode = 1;
  return { ok: blocked.length === 0, rows: plan.rows, written };
}
