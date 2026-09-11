// `yad migrate` — preview, backup, rewrite, report, re-run.
//
// The command's whole promise is that an upgrade is survivable: you can see what it would do before it
// does it, everything it rewrites is copied first, and running it twice is not running it twice. These
// tests pin each half of that, including a FAKE 1 → 2 migration so the machinery is exercised against a
// real shape change while the shipped list still only contains the 1 → 1 baseline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MIGRATIONS, planMigration, projectJsonFiles, runMigrate } from './migrate.mjs';
import { SCHEMA_VERSION as ENGINE_SHAPE } from './manifest.mjs';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const rowFor = (rows, file) => rows.find((r) => r.file === file);

// Capture stdout the way the rest of the suite does — the JSON path prints, it does not return.
async function grab(fn) {
  const orig = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = orig; }
  return lines.join('\n');
}

// A minimal project: the two files `runMigrate` uses to decide a project exists, plus whatever the
// caller wants on top. `bridge` turns on verified mode, where CI owns the gate ledger.
function project({ bridge = false, files = {} } = {}) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-migrate-'));
  write(path.join(T, '.sdlc/hub.json'),
    JSON.stringify({ platform: 'github', ...(bridge ? { bridge_enabled: true } : {}) }, null, 2) + '\n');
  write(path.join(T, '.sdlc/cli-version.json'), JSON.stringify({ version: '1.0.2' }, null, 2) + '\n');
  for (const [rel, body] of Object.entries(files)) write(path.join(T, rel), body);
  return T;
}
const cleanup = (T) => fs.rmSync(T, { recursive: true, force: true });

// A fake shape change, used to prove the machinery works on something real. Never shipped.
// A step that takes a file one shape PAST this engine. Written relative to SCHEMA_VERSION on
// purpose: pinned to a literal it would have to be edited on every shape bump, and the thing it
// proves — that a migration runs once rather than looping, and that a file left ahead of the engine
// is reported rather than rewritten — is exactly what a shape bump most needs still tested.
const AHEAD = ENGINE_SHAPE + 1;
const FAKE_AHEAD = [
  ...MIGRATIONS,
  { from: ENGINE_SHAPE, to: AHEAD, title: 'fake — add a field', apply: (o) => ({ ...o, added: true }) },
];

test('migrate: the shipped list starts at the 1 → 1 baseline, which changes no field', () => {
  assert.deepEqual(MIGRATIONS[0].apply({ a: 1 }), { a: 1 }, 'the baseline stamps, it does not edit');
  // The list must be a connected chain from 1 up to this engine's shape, with no gap and no step
  // that goes backwards. A gap would strand every project sitting on the missing shape.
  assert.equal(MIGRATIONS[0].from, 1, 'the chain starts at shape 1 — rule 1, an unstamped file');
  assert.equal(MIGRATIONS[MIGRATIONS.length - 1].to, ENGINE_SHAPE, 'and ends at the engine shape');
  for (const m of MIGRATIONS) assert.ok(m.to >= m.from, `a step may not go backwards: ${m.title}`);
  for (let i = 1; i < MIGRATIONS.length; i++) {
    assert.equal(MIGRATIONS[i].from, MIGRATIONS[i - 1].to, `gap before: ${MIGRATIONS[i].title}`);
  }
});

test('migrate: preview reports what would change and writes absolutely nothing', async () => {
  const T = project({ files: { '.sdlc/repos.json': '{\n  "repos": []\n}\n' } });
  const before = new Map(projectJsonFiles(T).map((f) => [f, fs.readFileSync(f, 'utf8')]));
  const out = await grab(() => runMigrate(T, { json: true }));
  const res = JSON.parse(out);

  assert.equal(res.applied, false);
  assert.equal(res.ok, true);
  assert.deepEqual(res.changed.sort(), ['.sdlc/cli-version.json', '.sdlc/hub.json', '.sdlc/repos.json']);
  for (const [f, body] of before) assert.equal(fs.readFileSync(f, 'utf8'), body, `${f} was written during a preview`);
  assert.deepEqual(fs.readdirSync(path.join(T, '.sdlc')).filter((n) => n.endsWith('.yad-orig')), [],
    'a preview leaves no backups either');
  cleanup(T);
});

test('migrate --apply: stamps the files, backs each one up first, and reports what it wrote', async () => {
  const T = project({ files: { '.sdlc/repos.json': '{\n  "repos": []\n}\n' } });
  const original = fs.readFileSync(path.join(T, '.sdlc/repos.json'), 'utf8');
  const res = await runMigrate(T, { apply: true });

  assert.equal(res.ok, true);
  // `.sdlc/product.json` is in the list because the product config is written under BOTH its new
  // name and its old one, for one major, so a ledger-guard that has not been refreshed yet still
  // finds the file it opens by name.
  assert.deepEqual(res.written.sort(),
    ['.sdlc/cli-version.json', '.sdlc/hub.json', '.sdlc/product.json', '.sdlc/repos.json']);
  assert.equal(read(path.join(T, '.sdlc/repos.json')).schemaVersion, ENGINE_SHAPE);
  assert.equal(Object.keys(read(path.join(T, '.sdlc/repos.json')))[0], 'schemaVersion', 'the stamp leads the file');
  assert.equal(fs.readFileSync(path.join(T, '.sdlc/repos.json.yad-orig'), 'utf8'), original,
    'the backup is the file exactly as it was before the rewrite');
  cleanup(T);
});

test('migrate --apply: running it twice does nothing the second time, and says so', async () => {
  const T = project({ files: { '.sdlc/repos.json': '{\n  "repos": []\n}\n' } });
  await runMigrate(T, { apply: true });
  const after = new Map(projectJsonFiles(T).map((f) => [f, fs.readFileSync(f, 'utf8')]));
  const mtimes = new Map([...after.keys()].map((f) => [f, fs.statSync(f).mtimeMs]));

  const second = await runMigrate(T, { apply: true });
  assert.deepEqual(second.written, [], 'nothing was rewritten on the second run');
  for (const [f, body] of after) {
    assert.equal(fs.readFileSync(f, 'utf8'), body, `${f} changed on a re-run`);
    assert.equal(fs.statSync(f).mtimeMs, mtimes.get(f), `${f} was touched on a re-run`);
  }

  const out = await grab(() => runMigrate(T, {}));
  assert.match(out, /nothing to do/);
  cleanup(T);
});

test('migrate: the preview predicts exactly what an apply writes — file for file', async () => {
  // Preview decides "would this change" by re-serializing the object itself, while apply hands the
  // object to writeJSON. Those are two pieces of code producing bytes, and a promise that a preview is
  // trustworthy is only as good as their agreeing. Run both over the same project and compare.
  const files = {
    '.sdlc/repos.json': '{\n  "repos": []\n}\n',
    'epics/EP-x/.sdlc/state.json': '{\n  "currentStep": "epic"\n}\n',
    'epics/EP-x/.sdlc/approvals.json': '[]\n',
    'epics/EP-x/.sdlc/build-log/EP-x-S01-T01-be.json': '{\n  "story": "EP-x-S01"\n}\n',
    // Stamped at the engine's own shape, so it is genuinely already current. A file stamped 1 while
    // the engine is on 2 is NOT unchanged — it migrates like everything else, which is the point.
    'epics/EP-x/.sdlc/contract-lock.json': `{\n  "schemaVersion": ${ENGINE_SHAPE},\n  "hash": "sha256:abc"\n}\n`,
  };
  const A = project({ files });
  const B = project({ files });
  try {
    // A row can also declare a file it CREATES — the product config is written under its new name
    // and its old one. The preview names both, so the comparison has to count both, or it would
    // report a mismatch that is really the preview being more complete than the row list.
    const plan = (await runMigrate(A, {})).rows.filter((r) => r.changes);
    const predicted = plan.flatMap((r) => [r.file, ...(r.creates ?? [])]).sort();
    const actual = (await runMigrate(B, { apply: true })).written.slice().sort();
    assert.deepEqual(actual, predicted, 'a preview that does not match the apply is worse than no preview');
    // …and the already-stamped file is in neither list, so "unchanged" really means untouched.
    assert.ok(!predicted.includes(path.join('epics', 'EP-x', '.sdlc', 'contract-lock.json')));
  } finally { cleanup(A); cleanup(B); }
});

test('migrate --apply: cli-version.json is migrated like any other file, and `version` is left alone', async () => {
  // It is stamped because it is a project file, not because migrate writes it a second time to record
  // itself. `version` there means which release last installed or re-synced the managed files — what
  // doctor compares against the running CLI to tell you to run `yad update`. Migrating a shape re-syncs
  // nothing, so moving it would silence a warning that is still true.
  const T = project();
  const res = await runMigrate(T, { apply: true });
  const rec = read(path.join(T, '.sdlc/cli-version.json'));
  assert.equal(rec.schemaVersion, ENGINE_SHAPE, 'stamped, as an ordinary migrated row');
  assert.equal(rec.version, '1.0.2', 'the CLI-sync version is not a migration record and must not move');
  assert.deepEqual(Object.keys(rec), ['schemaVersion', 'version'], 'and nothing else was added to it');
  assert.ok(res.written.includes('.sdlc/cli-version.json'), 'so it is reported like every other write');
  assert.ok(fs.existsSync(path.join(T, '.sdlc/cli-version.json.yad-orig')), 'and backed up like every other write');
  cleanup(T);
});

test('migrate: a real shape change is applied, reported, and reruns clean (fake step past the engine)', async () => {
  const T = project({ files: { '.sdlc/repos.json': '{\n  "repos": []\n}\n' } });

  const preview = planMigration(T, { migrations: FAKE_AHEAD });
  const row = rowFor(preview.rows, '.sdlc/repos.json');
  assert.deepEqual([row.from, row.to, row.action], [1, AHEAD, 'migrate']);
  // Only steps that actually CHANGED the file are named. The 1 → 1 baseline runs on every file and
  // moves nothing, and the shipped 1 → 2 step touches hub.json alone — naming either on a row they
  // did not alter would report work that never happened.
  assert.deepEqual(row.steps, ['fake — add a field'],
    'the list is walked in order and the steps that changed the file are named');

  await runMigrate(T, { apply: true }, { migrations: FAKE_AHEAD });
  const migrated = read(path.join(T, '.sdlc/repos.json'));
  assert.equal(migrated.schemaVersion, AHEAD, 'the file now states the new shape');
  assert.equal(migrated.added, true, 'and the migration actually changed it');
  assert.deepEqual(read(path.join(T, '.sdlc/repos.json.yad-orig')), { repos: [] }, 'the pre-migration file is kept');

  // The step must not run a second time, which is what an unbounded loop would do. With this fake
  // list the files are now on a shape the SHIPPED engine does not know, so the honest second answer is
  // "these are newer than me" — reported, and still not rewritten.
  const exit = process.exitCode;
  try {
    const again = await runMigrate(T, { apply: true }, { migrations: FAKE_AHEAD });
    assert.deepEqual(again.written, [], 'a migrated project is not migrated again');
    assert.equal(rowFor(again.rows, '.sdlc/repos.json').action, 'ahead');
    assert.equal(read(path.join(T, '.sdlc/repos.json')).added, true, 'and the migrated content is intact');
  } finally { process.exitCode = exit ?? 0; }
  cleanup(T);
});

test('migrate: an ALREADY-STAMPED file still advances its shape, so it is not re-migrated forever', async () => {
  // Every file E13 touched carries "schemaVersion": 1 on disk. If the stamp the migration ends on were
  // written as `{ schemaVersion: version, ...obj }`, the file's own key would shadow it: the content
  // would migrate while the number stayed at 1, so the file would be migrated AGAIN on every later run
  // — each run overwriting its .yad-orig with already-migrated bytes until the original was gone.
  // A non-idempotent step makes that visible: it appends, so a second application would show up.
  // Applied to every file in the project, so it only touches the one that has the field.
  const APPEND = [{
    from: 1, to: 2, title: 'fake — append once',
    apply: (o) => (Array.isArray(o.repos) ? { ...o, repos: [...o.repos, 'X'] } : o),
  }];
  const T = project({ files: { '.sdlc/repos.json': '{\n  "schemaVersion": 1,\n  "repos": [\n    "a"\n  ]\n}\n' } });

  await runMigrate(T, { apply: true }, { migrations: APPEND });
  const once = read(path.join(T, '.sdlc/repos.json'));
  assert.equal(once.schemaVersion, 2, 'the file now states the shape the migration ended on');
  assert.deepEqual(once.repos, ['a', 'X']);

  const exit = process.exitCode;
  try {
    const again = await runMigrate(T, { apply: true }, { migrations: APPEND });
    assert.deepEqual(again.written, [], 'the step must not run a second time');
    assert.deepEqual(read(path.join(T, '.sdlc/repos.json')).repos, ['a', 'X'], 'content applied exactly once');
    assert.deepEqual(read(path.join(T, '.sdlc/repos.json.yad-orig')).repos, ['a'],
      'and the backup is still the ORIGINAL, not a half-migrated copy');
  } finally { process.exitCode = exit ?? 0; }
  cleanup(T);
});

test('migrate --apply: the backups are gitignored, so another command cannot commit them for you', async () => {
  // `gate sync` and `yad tidy up` both stage epics/<epic>/.sdlc with `git add -A`. A .yad-orig sitting
  // there would be swept into the next chore(gate) commit and pushed — so "do not commit these" has to
  // be enforced, not advised.
  const T = project({ files: { 'epics/EP-x/.sdlc/state.json': '{\n  "currentStep": "epic"\n}\n' } });
  await runMigrate(T, { apply: true });
  const gi = fs.readFileSync(path.join(T, '.gitignore'), 'utf8');
  assert.ok(gi.split('\n').some((l) => l.trim() === '*.yad-orig'), 'the backup glob is ignored');

  // Idempotent, and it never rewrites a .gitignore when there is nothing to back up.
  await runMigrate(T, { apply: true });
  assert.equal(gi.split('\n').filter((l) => l.trim() === '*.yad-orig').length, 1, 'the entry is added once');
  const U = project();
  await runMigrate(U, {});
  assert.ok(!fs.existsSync(path.join(U, '.gitignore')), 'a preview creates no .gitignore');
  cleanup(T); cleanup(U);
});

test('migrate: a file NEWER than the engine is never touched, and the run fails loudly', async () => {
  const T = project({ files: { '.sdlc/repos.json': '{\n  "schemaVersion": 99,\n  "repos": []\n}\n' } });
  const before = fs.readFileSync(path.join(T, '.sdlc/repos.json'), 'utf8');
  const exit = process.exitCode;
  try {
    const res = await runMigrate(T, { apply: true });
    assert.equal(res.ok, false, 'a project this engine cannot understand is not an ok outcome');
    assert.equal(rowFor(res.rows, '.sdlc/repos.json').action, 'ahead');
    assert.equal(fs.readFileSync(path.join(T, '.sdlc/repos.json'), 'utf8'), before,
      'downgrading a newer file would destroy data written by a version we know nothing about');
    assert.ok(!fs.existsSync(path.join(T, '.sdlc/repos.json.yad-orig')), 'and it is not even backed up, because it is not touched');
  } finally { process.exitCode = exit ?? 0; }
  cleanup(T);
});

test('migrate: a corrupt file is reported, never rewritten', async () => {
  const T = project({ files: { '.sdlc/repos.json': '{ this is not json' } });
  const exit = process.exitCode;
  try {
    const res = await runMigrate(T, { apply: true });
    assert.equal(res.ok, false);
    assert.equal(rowFor(res.rows, '.sdlc/repos.json').action, 'unreadable');
    assert.equal(fs.readFileSync(path.join(T, '.sdlc/repos.json'), 'utf8'), '{ this is not json',
      'the one thing worse than a corrupt ledger is a corrupt ledger that has been overwritten');
  } finally { process.exitCode = exit ?? 0; }
  cleanup(T);
});

test('migrate: top-level list ledgers are reported as shape 1 and left as lists', async () => {
  const T = project({ files: { 'epics/EP-x/.sdlc/approvals.json': '[\n  {\n    "step": "epic-review"\n  }\n]\n' } });
  const res = await runMigrate(T, { apply: true });
  const row = rowFor(res.rows, path.join('epics', 'EP-x', '.sdlc', 'approvals.json'));
  assert.equal(row.action, 'list');
  assert.equal(row.from, 1, 'a list has no key to read, so rule 1 makes it shape 1');
  assert.deepEqual(read(path.join(T, 'epics/EP-x/.sdlc/approvals.json')), [{ step: 'epic-review' }],
    'still a list — wrapping it in an object would be a shape change, and those wait for v4');
  cleanup(T);
});

test('migrate: in verified mode the CI-owned ledger is skipped and named, not rewritten', async () => {
  const T = project({
    bridge: true,
    files: {
      'epics/EP-x/.sdlc/state.json': '{\n  "currentStep": "epic"\n}\n',
      'epics/EP-x/.sdlc/change.json': '{\n  "kind": "defect"\n}\n',
    },
  });
  const res = await runMigrate(T, { apply: true });
  const state = path.join('epics', 'EP-x', '.sdlc', 'state.json');
  assert.equal(rowFor(res.rows, state).action, 'ci-owned');
  assert.equal(fs.readFileSync(path.join(T, 'epics/EP-x/.sdlc/state.json'), 'utf8'), '{\n  "currentStep": "epic"\n}\n',
    'CI is the only writer there — a local rewrite could not be committed anyway');
  // Everything the guard does NOT own is still migrated normally.
  assert.equal(read(path.join(T, 'epics/EP-x/.sdlc/change.json')).schemaVersion, ENGINE_SHAPE);
  cleanup(T);
});

test('migrate: a project in local (non-verified) mode migrates its gate ledger like any other file', async () => {
  const T = project({ files: { 'epics/EP-x/.sdlc/state.json': '{\n  "currentStep": "epic"\n}\n' } });
  const res = await runMigrate(T, { apply: true });
  // `migrate`, not `stamp`: the shape genuinely moves (1 -> 2), even though this file's own fields
  // are untouched by the Product-only step. The shape describes the project's format, not one file's keys.
  assert.equal(rowFor(res.rows, path.join('epics', 'EP-x', '.sdlc', 'state.json')).action, 'migrate');
  assert.equal(read(path.join(T, 'epics/EP-x/.sdlc/state.json')).schemaVersion, ENGINE_SHAPE);
  cleanup(T);
});

// ---- shape 2: hub.json gains `ledger` -------------------------------------------------------
// The value is COMPUTED from what the engine already decided about the Product, never copied from the
// flag. That distinction is the whole safety argument for this migration: an upgrade must not change
// what a project does. The table covers every hub.json a real project can be sitting on.
test('migrate 1 -> 2: `ledger` records what the Product was already doing, for every hub shape', async () => {
  const { isVerifiedLedger } = await import('./manifest.mjs');
  const cases = [
    ['platform + bridge_enabled', { platform: 'github', bridge_enabled: true }, 'verified'],
    ['platform + the legacy `bridge`', { platform: 'github', bridge: true }, 'verified'],
    ['platform, flag explicitly false', { platform: 'github', bridge_enabled: false }, 'local'],
    ['platform, no flag at all', { platform: 'github' }, 'local'],
    // The one that would be wrong if the migration copied the flag instead of asking the reader:
    // no platform means no Verified badge to read, so this Product has ALWAYS behaved as local.
    ['flag true but NO platform', { bridge_enabled: true }, 'local'],
    ['platform null + flag true', { platform: null, bridge_enabled: true }, 'local'],
  ];
  for (const [name, hub, expected] of cases) {
    const T = project({ files: { '.sdlc/hub.json': JSON.stringify(hub, null, 2) + '\n' } });
    try {
      const before = isVerifiedLedger(hub);
      await runMigrate(T, { apply: true });
      const after = read(path.join(T, '.sdlc/hub.json'));
      assert.equal(after.ledger, expected, name);
      assert.equal(after.schemaVersion, ENGINE_SHAPE, `${name}: the file states the new shape`);
      assert.equal(isVerifiedLedger(after), before, `${name}: migrating changed what the engine DOES`);
      // Add before you remove (rule 3): the old key survives, because a ledger-guard that has not
      // been refreshed by `yad update` yet is still reading it.
      if ('bridge_enabled' in hub) assert.equal(after.bridge_enabled, hub.bridge_enabled, `${name}: old key kept`);
      if ('bridge' in hub) assert.equal(after.bridge, hub.bridge, `${name}: legacy key kept`);
    } finally { cleanup(T); }
  }
});

// A file must never DECLARE one shape while carrying another's fields. `yad setup` can run on a
// project that has not migrated yet, and if it wrote `ledger` there the Product would claim shape 1 while
// holding a shape-2 key — which makes doctor's drift report a lie about the one file this change is
// about. The old booleans carry the setting until `yad migrate` adds the key.
test('migrate 1 -> 2: a shape-1 hub written by an older shape stays coherent, then migrates cleanly', async () => {
  const { isVerifiedLedger } = await import('./manifest.mjs');
  const T = project({ files: { '.sdlc/hub.json': '{\n  "platform": "github",\n  "bridge_enabled": true\n}\n' } });
  try {
    const before = read(path.join(T, '.sdlc/hub.json'));
    assert.equal('ledger' in before, false, 'a shape-1 hub carries no shape-2 key');
    assert.equal(isVerifiedLedger(before), true, 'and the old booleans still answer the question');
    await runMigrate(T, { apply: true });
    const after = read(path.join(T, '.sdlc/hub.json'));
    assert.equal(after.schemaVersion, ENGINE_SHAPE);
    assert.equal(after.ledger, 'verified', 'the migration records what the booleans were already saying');
  } finally { cleanup(T); }
});

test('migrate 1 -> 2: only hub.json gains `ledger`; every other file just records the shape', async () => {
  const T = project({ files: {
    '.sdlc/hub.json': '{\n  "platform": "github",\n  "bridge_enabled": true\n}\n',
    '.sdlc/repos.json': '{\n  "repos": []\n}\n',
    'epics/EP-x/.sdlc/contract-lock.json': '{\n  "hash": "sha256:abc"\n}\n',
  } });
  try {
    await runMigrate(T, { apply: true });
    const repos = read(path.join(T, '.sdlc/repos.json'));
    const lock = read(path.join(T, 'epics/EP-x/.sdlc/contract-lock.json'));
    assert.deepEqual(repos, { schemaVersion: ENGINE_SHAPE, repos: [] }, 'a non-hub file gains the stamp and nothing else');
    assert.deepEqual(lock, { schemaVersion: ENGINE_SHAPE, hash: 'sha256:abc' });
    assert.equal('ledger' in repos, false, '`ledger` belongs to hub.json alone');
  } finally { cleanup(T); }
});

test('migrate 1 -> 2: running it twice is a no-op, and does not overwrite the backup', async () => {
  const T = project({ files: { '.sdlc/hub.json': '{\n  "platform": "github",\n  "bridge_enabled": true\n}\n' } });
  try {
    await runMigrate(T, { apply: true });
    const first = fs.readFileSync(path.join(T, '.sdlc/hub.json'), 'utf8');
    const backup = fs.readFileSync(path.join(T, '.sdlc/hub.json.yad-orig'), 'utf8');
    const again = await runMigrate(T, { apply: true });
    assert.deepEqual(again.written, [], 'nothing is rewritten the second time');
    assert.equal(fs.readFileSync(path.join(T, '.sdlc/hub.json'), 'utf8'), first);
    // The backup must still be the ORIGINAL, not a copy of the already-migrated file — otherwise a
    // second run quietly destroys the only way back.
    assert.equal(fs.readFileSync(path.join(T, '.sdlc/hub.json.yad-orig'), 'utf8'), backup);
    assert.equal('ledger' in JSON.parse(backup), false, 'the backup is the pre-migration file');
  } finally { cleanup(T); }
});

// ---- shape 3: `hub` becomes `Product` -------------------------------------------------------
// The settings file changes NAME, which is harder than changing a field, because a file is opened by
// name from outside this codebase — `templates/checks/ledger-guard.sh` lives in the user's own repo
// and opens `.sdlc/hub.json` by that literal path. So both names exist for one major.
test('migrate 2 -> 3: the settings file gains its new name and KEEPS the old one', async () => {
  const T = project({ files: { '.sdlc/hub.json': '{\n  "platform": "github",\n  "bridge_enabled": true\n}\n' } });
  try {
    const res = await runMigrate(T, { apply: true });
    const product = path.join(T, '.sdlc/product.json');
    const hub = path.join(T, '.sdlc/hub.json');
    assert.ok(fs.existsSync(product), 'the new name exists');
    assert.ok(fs.existsSync(hub), 'and the old one is still there — removing it would disarm an un-refreshed ledger-guard');
    assert.equal(fs.readFileSync(product, 'utf8'), fs.readFileSync(hub, 'utf8'), 'byte-identical, not merely similar');
    assert.equal(read(product).schemaVersion, ENGINE_SHAPE);
    assert.ok(res.written.includes('.sdlc/product.json'), 'and the report names the file it created');
  } finally { cleanup(T); }
});

test('migrate 2 -> 3: the PREVIEW names the file the apply will create', async () => {
  const T = project({ files: { '.sdlc/hub.json': '{\n  "platform": "github"\n}\n' } });
  try {
    const plan = await runMigrate(T, {});
    const row = rowFor(plan.rows, '.sdlc/hub.json');
    assert.deepEqual(row.creates, ['.sdlc/product.json'],
      'a preview that does not mention a file the apply creates is not a preview');
    assert.ok(!fs.existsSync(path.join(T, '.sdlc/product.json')), 'and the preview still wrote nothing');
  } finally { cleanup(T); }
});

test('migrate 2 -> 3: a roster role under `hub` GAINS a `product` spelling, and other domains are untouched', async () => {
  const roster = [
    { login: 'alice', roles: { hub: ['owner', 'reviewer'], backend: ['domain-owner'] } },
    { login: 'bob', roles: { payments: ['reviewer'] } },
    { login: 'carol' },
  ];
  const T = project({ files: { '.sdlc/hub.json': JSON.stringify({ platform: 'github', roster }, null, 2) + '\n' } });
  try {
    await runMigrate(T, { apply: true });
    const after = read(path.join(T, '.sdlc/product.json'));
    // BOTH spellings. Replacing `hub` would silently strip every product-level role from the point
    // of view of an older CLI, of `yad setup` (which still writes `hub` when it adds a member), and
    // of every caller that asks `rolesForScope(entry, 'hub')`.
    assert.deepEqual(after.roster[0].roles,
      { product: ['owner', 'reviewer'], hub: ['owner', 'reviewer'], backend: ['domain-owner'] });
    assert.deepEqual(after.roster[1].roles, { payments: ['reviewer'] }, 'a member with no hub role is unchanged');
    assert.deepEqual(after.roster[2], { login: 'carol' }, 'and a member with no roles at all is left alone');
  } finally { cleanup(T); }
});

test('migrate 2 -> 3: a product-level role survives the rename for BOTH spellings', async () => {
  const { rolesForScope } = await import('./platform.mjs');
  const roster = [{ login: 'alice', roles: { hub: ['owner'], backend: ['domain-owner'] } }];
  const T = project({ files: { '.sdlc/hub.json': JSON.stringify({ platform: 'github', roster }, null, 2) + '\n' } });
  try {
    await runMigrate(T, { apply: true });
    const entry = read(path.join(T, '.sdlc/hub.json')).roster[0];
    // The gate asks for the product scope by whichever name the code it came from knows. Both must
    // answer, or a reviewer stops being found and no message says why.
    assert.deepEqual(rolesForScope(entry, 'hub'), ['owner'], 'an older caller still finds the role');
    assert.deepEqual(rolesForScope(entry, 'product'), ['owner'], 'and so does a newer one');
    assert.deepEqual(rolesForScope(entry, 'backend'), ['domain-owner'], 'repo scopes are untouched');
  } finally { cleanup(T); }
});

// Each of these is a bug that shipped in an earlier draft of this branch and was found by review.
test('migrate: the authoritative file and its backup survive a DRIFTED pair', async () => {
  // hub.json is the one that is read; product.json holds different content. Listing both names as
  // separate rows made the product.json row write over hub.json before the hub.json row could copy
  // it to .yad-orig — the content and its only backup, both gone.
  const T = project({ files: {
    '.sdlc/hub.json': JSON.stringify({ schemaVersion: 2, platform: 'github', roster: [{ login: 'a' }] }, null, 2) + '\n',
    '.sdlc/product.json': JSON.stringify({ schemaVersion: 2, platform: 'github', roster: [] }, null, 2) + '\n',
  } });
  try {
    await runMigrate(T, { apply: true });
    assert.deepEqual(read(path.join(T, '.sdlc/hub.json')).roster, [{ login: 'a' }], 'the authoritative content survived');
    assert.deepEqual(read(path.join(T, '.sdlc/hub.json.yad-orig')).roster, [{ login: 'a' }], 'and its backup is its OWN original');
    assert.deepEqual(read(path.join(T, '.sdlc/product.json.yad-orig')).roster, [], 'the partner keeps its own original too');
  } finally { cleanup(T); }
});

test('migrate: the preview names the partner even when it ALREADY exists', async () => {
  // The state this release puts every project into. Naming the partner only when it is MISSING left
  // the preview silent here while the apply rewrote the file — a preview that under-reports, which
  // is the one thing that makes `--apply` not worth trusting.
  const both = { schemaVersion: 2, platform: 'github' };
  const files = {
    '.sdlc/hub.json': JSON.stringify(both, null, 2) + '\n',
    '.sdlc/product.json': JSON.stringify(both, null, 2) + '\n',
  };
  const A = project({ files });
  const B = project({ files });
  try {
    const rows = (await runMigrate(A, {})).rows.filter((r) => r.changes);
    const predicted = rows.flatMap((r) => [r.file, ...(r.creates ?? []), ...(r.rewrites ?? [])]).sort();
    const actual = (await runMigrate(B, { apply: true })).written.slice().sort();
    assert.ok(predicted.includes('.sdlc/product.json'), `the partner must be named: ${JSON.stringify(predicted)}`);
    assert.deepEqual(actual, predicted, 'a preview that does not match the apply is worse than no preview');
  } finally { cleanup(A); cleanup(B); }
});

test('migrate: a HALF-MADE pair is repaired, not reported forever', async () => {
  // The row's own bytes are already correct, so without treating a missing partner as a change the
  // plan says "already current", nothing is written, and `yad doctor` warns about the missing file
  // for ever while naming a command that does nothing.
  const T = project({ files: { '.sdlc/hub.json': '{\n  "platform": "github"\n}\n' } });
  try {
    await runMigrate(T, { apply: true });
    fs.rmSync(path.join(T, '.sdlc/product.json'));
    const plan = await runMigrate(T, {});
    const row = rowFor(plan.rows, '.sdlc/hub.json');
    assert.equal(row.changes, true, 'a missing partner counts as work to do');
    assert.deepEqual(row.creates, ['.sdlc/product.json']);
    await runMigrate(T, { apply: true });
    assert.ok(fs.existsSync(path.join(T, '.sdlc/product.json')), 'and the apply actually puts it back');
  } finally { cleanup(T); }
});

test('migrate: a project holding ONLY the new name is migrated, not ignored', async () => {
  const T = project({ files: { '.sdlc/product.json': '{\n  "platform": "github"\n}\n' } });
  try {
    fs.rmSync(path.join(T, '.sdlc/hub.json'), { force: true });
    const plan = await runMigrate(T, {});
    const row = rowFor(plan.rows, '.sdlc/product.json');
    assert.ok(row, `the new name must be planned: ${JSON.stringify(plan.rows.map((r) => r.file))}`);
    assert.deepEqual(row.creates, ['.sdlc/hub.json'], 'and the preview names the partner it will create');
    await runMigrate(T, { apply: true });
    const after = read(path.join(T, '.sdlc/product.json'));
    assert.equal(after.schemaVersion, ENGINE_SHAPE);
    assert.equal(after.ledger, 'local', 'a shape-1 file under the new name still gains the shape-2 field');
  } finally { cleanup(T); }
});

test('migrate: a second run has nothing pending — the plan and the write agree on one comparison', async () => {
  const T = project({ files: {
    '.sdlc/hub.json': '{\n  "platform": "github"\n}\n',
    '.sdlc/product.json': '{\n  "platform": "github"\n}\n',
  } });
  try {
    await runMigrate(T, { apply: true });
    const second = await runMigrate(T, {});
    assert.deepEqual(second.rows.filter((r) => r.changes).map((r) => r.file), [],
      'a migrated project that still reports pending work never converges');
  } finally { cleanup(T); }
});

test('migrate 2 -> 3: running it twice keeps both names in step and does not re-write', async () => {
  const T = project({ files: { '.sdlc/hub.json': '{\n  "platform": "github"\n}\n' } });
  try {
    await runMigrate(T, { apply: true });
    const again = await runMigrate(T, { apply: true });
    assert.deepEqual(again.written, [], 'a migrated project is not migrated again');
    assert.equal(
      fs.readFileSync(path.join(T, '.sdlc/product.json'), 'utf8'),
      fs.readFileSync(path.join(T, '.sdlc/hub.json'), 'utf8'),
      'the two copies have not drifted apart',
    );
  } finally { cleanup(T); }
});

test('migrate: the file set covers the epic ledger and all three shard folders', () => {
  const T = project({
    files: {
      '.sdlc/managed.json': '{\n  "files": {}\n}\n',
      'epics/EP-x/.sdlc/state.json': '{}\n',
      'epics/EP-x/.sdlc/docs-build.json': '{}\n',
      'epics/EP-x/.sdlc/build-log/EP-x-S01-T01-be.json': '{}\n',
      'epics/EP-x/.sdlc/trust-log/EP-x-be-spec-1.json': '{}\n',
      'epics/EP-x/.sdlc/build-state/EP-x-S01.json': '{}\n',
      'epics/EP-x/notes.json': '{}\n',
      'not-an-epic/.sdlc/state.json': '{}\n',
    },
  });
  const found = projectJsonFiles(T).map((f) => path.relative(T, f).split(path.sep).join('/')).sort();
  for (const want of [
    '.sdlc/hub.json',
    '.sdlc/managed.json',
    'epics/EP-x/.sdlc/state.json',
    'epics/EP-x/.sdlc/docs-build.json',
    'epics/EP-x/.sdlc/build-log/EP-x-S01-T01-be.json',
    'epics/EP-x/.sdlc/trust-log/EP-x-be-spec-1.json',
    'epics/EP-x/.sdlc/build-state/EP-x-S01.json',
  ]) assert.ok(found.includes(want), `missing ${want}`);
  assert.ok(!found.includes('epics/EP-x/notes.json'), 'only the ledger is migrated, not every file in an epic');
  assert.ok(!found.some((f) => f.startsWith('not-an-epic/')), 'a directory that is not a valid epic id is not an epic');
  cleanup(T);
});

test('migrate: outside a yad project it refuses rather than inventing one', async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-migrate-none-'));
  const exit = process.exitCode;
  try {
    const out = await grab(() => runMigrate(T, { json: true }));
    const res = JSON.parse(out);
    assert.equal(res.ok, false);
    assert.match(res.error, /no yad project/);
    assert.deepEqual(fs.readdirSync(T), [], 'nothing was created');
  } finally { process.exitCode = exit ?? 0; }
  cleanup(T);
});

// ---- shape 3 -> 4: the two dials (E28) -----------------------------------------------------------
// The rename is `assistance` -> `driver` and `automation` -> `advance`, added beside the old names.
// Each of these pins a way the rename could quietly lose a setting or grant one nobody asked for.

const stateWith = (steps) => JSON.stringify({ schemaVersion: 3, currentStep: steps[0]?.id, steps }, null, 2) + '\n';

test('migrate 3 -> 4: a step gains `driver` and `advance` and KEEPS the old names', async () => {
  const T = project({ files: { 'epics/EP-x/.sdlc/state.json': stateWith([
    { id: 'epic', type: 'author', assistance: 'review', automation: 'human_approve', status: 'done' },
    { id: 'implement', assistance: 'heavy', automation: 'machine_advance', status: 'in_progress' },
  ]) } });
  try {
    await runMigrate(T, { apply: true });
    const [author, build] = read(path.join(T, 'epics/EP-x/.sdlc/state.json')).steps;
    assert.equal(author.driver, 'pair', 'review -> pair');
    assert.equal(author.advance, 'human', 'human_approve -> human');
    assert.equal(build.driver, 'agent', 'heavy -> agent');
    assert.equal(build.advance, 'auto', 'machine_advance -> auto');
    // The old names are what 29 skills still write and an older CLI still reads. Losing them here
    // would strand a step with no dial the running code can find.
    assert.equal(author.assistance, 'review', 'the old name is kept, not replaced');
    assert.equal(build.automation, 'machine_advance', 'and so is the old dial');
  } finally { cleanup(T); }
});

test('migrate 3 -> 4: a REVIEW step is never told it may advance on its own', async () => {
  // The one rule that never bends. A review step carrying `machine_advance` is already wrong; the
  // migration must not turn that into a NEW field granting the permission, during an upgrade nobody
  // asked to change behaviour. Both ways a review step is marked are covered: `type` on the Shape
  // chain, `locked` on a Build step.
  const T = project({ files: { 'epics/EP-x/.sdlc/state.json': stateWith([
    { id: 'epic-review', type: 'review+approve', automation: 'machine_advance', status: 'in_review' },
    { id: 'engineer-review', locked: true, automation: 'machine_advance', status: 'in_progress' },
    { id: 'implement', automation: 'machine_advance', status: 'in_progress' },
  ]) } });
  try {
    await runMigrate(T, { apply: true });
    const [shapeReview, buildReview, plain] = read(path.join(T, 'epics/EP-x/.sdlc/state.json')).steps;
    assert.equal(shapeReview.advance, 'human', 'a review+approve step is pinned to human');
    assert.equal(buildReview.advance, 'human', 'and so is a locked one');
    assert.equal(plain.advance, 'auto', 'a step that is not a review keeps what it had');
    // The old value is left visible on purpose: papering over it would hide that somebody set it.
    assert.equal(shapeReview.automation, 'machine_advance', 'the mismatch stays visible for doctor');
  } finally { cleanup(T); }
});

test('migrate 3 -> 4: build-state dials migrate too, per repo', async () => {
  const bs = { schemaVersion: 3, story: 'EP-x-S01', repos: {
    backend: { currentStep: 'checks', steps: [{ id: 'checks', automation: 'machine_advance' }] },
    mobile: { currentStep: 'spec', steps: [{ id: 'engineer-review', locked: true, automation: 'human_approve' }] },
  } };
  const T = project({ files: { 'epics/EP-x/.sdlc/build-state/EP-x-S01.json': JSON.stringify(bs, null, 2) + '\n' } });
  try {
    await runMigrate(T, { apply: true });
    const out = read(path.join(T, 'epics/EP-x/.sdlc/build-state/EP-x-S01.json'));
    assert.equal(out.repos.backend.steps[0].advance, 'auto');
    assert.equal(out.repos.mobile.steps[0].advance, 'human');
    assert.equal(out.repos.backend.currentStep, 'checks', 'the rest of the repo entry is untouched');
  } finally { cleanup(T); }
});

test('migrate 3 -> 4: trust-log is HISTORY and is not rewritten', async () => {
  // Its `automation` records what the dial WAS when a run happened. Migrating it would rewrite the
  // evidence the trust ledger exists to hold.
  const runs = [{ story: 'EP-x-S01', step: 'checks', automation: 'machine_advance', verdict: 'approved-unchanged' }];
  const T = project({ files: { 'epics/EP-x/.sdlc/trust-log.json': JSON.stringify({ schemaVersion: 3, epic: 'EP-x', runs }, null, 2) + '\n' } });
  try {
    await runMigrate(T, { apply: true });
    const out = read(path.join(T, 'epics/EP-x/.sdlc/trust-log.json'));
    assert.equal(out.runs[0].automation, 'machine_advance', 'the record still says what happened');
    assert.equal('advance' in out.runs[0], false, 'and gains no live-looking dial');
  } finally { cleanup(T); }
});

test('migrate 3 -> 4: an unrecognised dial value is left alone, never guessed at', async () => {
  const T = project({ files: { 'epics/EP-x/.sdlc/state.json': stateWith([
    { id: 'odd', assistance: 'sideways', automation: 'whenever', status: 'in_progress' },
  ]) } });
  try {
    await runMigrate(T, { apply: true });
    const s = read(path.join(T, 'epics/EP-x/.sdlc/state.json')).steps[0];
    assert.equal('driver' in s, false, 'no invented driver');
    assert.equal('advance' in s, false, 'no invented advance');
    assert.equal(s.assistance, 'sideways', 'what was there is still there');
  } finally { cleanup(T); }
});

test('migrate 3 -> 4: a step that already has the new dial is not re-decided', async () => {
  // Idempotence, and the reason doctor has to report a disagreement rather than migrate fixing it:
  // once the new key exists, this step is done with that step and cannot tell which value was meant.
  const T = project({ files: { 'epics/EP-x/.sdlc/state.json': stateWith([
    { id: 'implement', assistance: 'heavy', driver: 'human', automation: 'machine_advance', advance: 'human' },
  ]) } });
  try {
    await runMigrate(T, { apply: true });
    const s = read(path.join(T, 'epics/EP-x/.sdlc/state.json')).steps[0];
    assert.equal(s.driver, 'human', 'the value already on the step wins');
    assert.equal(s.advance, 'human');
  } finally { cleanup(T); }
});

test('migrate 3 -> 4: on a VERIFIED project state.json is skipped, and the gate write carries it', async () => {
  // The half-applied case. `state.json` is CI-owned there, so migrate never touches it — but
  // build-state is not, so without a second writer the two halves of one rename would sit in
  // different vocabularies forever, with no command a user could run to close the gap.
  const { stampStepDials } = await import('./epic-state.mjs');
  const T = project({ bridge: true, files: {
    'epics/EP-x/.sdlc/state.json': stateWith([{ id: 'implement', automation: 'machine_advance' }]),
    'epics/EP-x/.sdlc/build-state/EP-x-S01.json': JSON.stringify(
      { schemaVersion: 3, story: 'EP-x-S01', repos: { backend: { steps: [{ id: 'checks', automation: 'machine_advance' }] } } }, null, 2) + '\n',
  } });
  try {
    const { rows } = planMigration(T);
    assert.equal(rowFor(rows, 'epics/EP-x/.sdlc/state.json').action, 'ci-owned', 'migrate will not write it');
    await runMigrate(T, { apply: true });
    const state = read(path.join(T, 'epics/EP-x/.sdlc/state.json'));
    assert.equal('advance' in state.steps[0], false, 'and indeed it did not');
    assert.equal(read(path.join(T, 'epics/EP-x/.sdlc/build-state/EP-x-S01.json')).repos.backend.steps[0].advance, 'auto',
      'while the file CI does not own did migrate — this is the gap');
    // What closes it: every writer of state.json goes through one function that stamps the dials.
    assert.equal(stampStepDials(state).steps[0].advance, 'auto', 'the gate write closes the gap');
  } finally { cleanup(T); }
});

test('stampStepDials: returns the SAME object when nothing changed', async () => {
  // writeJSON short-circuits on identical bytes. If this handed back a fresh object every time, that
  // comparison would be the only thing standing between a read-only gate path and a spurious write.
  const { stampStepDials } = await import('./epic-state.mjs');
  const done = { steps: [{ id: 'a', automation: 'human_approve', advance: 'human' }] };
  assert.equal(stampStepDials(done), done, 'an already-stamped state is passed straight through');
  const empty = { steps: [] };
  assert.equal(stampStepDials(empty), empty, 'no steps, no work');
  const noDials = { steps: [{ id: 'a', status: 'done' }] };
  assert.equal(stampStepDials(noDials), noDials, 'a step with no dial at all is not given one');
  // And it DOES return a new object when there is something to add, or nothing would ever be written.
  const pending = { steps: [{ id: 'a', automation: 'human_approve' }] };
  assert.notEqual(stampStepDials(pending), pending, 'a state that needs stamping is a new object');
  assert.equal(stampStepDials(pending).steps[0].advance, 'human');
});

// ---- shape 4 -> 5: the work-item type (E21) ------------------------------------------------------

// An epic.md carrying whatever frontmatter the test needs. The type is READ from here, never guessed.
const epicMd = (fm) => `---\nid: EP-x\n${fm}\n---\n\n## Goal\nx\n`;

test('migrate 4 -> 5: state.json takes its `type` FROM epic.md, it does not default it', async () => {
  // Defaulting to `feature` would reclassify every defect and change-epic in the project as a
  // parent-free genesis, and the lineage gate would stop asking them for a parent. An upgrade must
  // never quietly drop a safety check.
  const T = project({ files: {
    'epics/EP-x/epic.md': epicMd('kind: defect\nparent: EP-root\nthread: EP-root'),
    'epics/EP-x/.sdlc/state.json': stateWith([{ id: 'epic', type: 'author', status: 'done' }]),
  } });
  try {
    await runMigrate(T, { apply: true });
    const st = read(path.join(T, 'epics/EP-x/.sdlc/state.json'));
    assert.equal(st.type, 'defect', 'the type the author wrote, not the convenient one');
    assert.equal(st.schemaVersion, ENGINE_SHAPE);
    assert.equal(st.steps[0].type, 'author', 'a STEP type is a different axis and is untouched');
  } finally { cleanup(T); }
});

test('migrate 4 -> 5: `type` is written at the TOP of the file, not dangling under `steps`', async () => {
  // Key order is the file's bytes, and a person opening state.json is the reason this matters:
  // appending would put `"type": "feature"` directly beneath a `steps` array whose every entry
  // carries its own `"type"`, which is exactly the two-axis confusion this whole change avoids.
  const T = project({ files: {
    'epics/EP-x/epic.md': epicMd('kind: feature'),
    'epics/EP-x/.sdlc/state.json': stateWith([{ id: 'epic', type: 'author', status: 'done' }]),
  } });
  try {
    await runMigrate(T, { apply: true });
    const f = path.join(T, 'epics/EP-x/.sdlc/state.json');
    const keys = Object.keys(read(f));
    assert.ok(keys.indexOf('type') < keys.indexOf('steps'), `type came after steps: ${keys.join(', ')}`);
    assert.equal(keys[0], 'schemaVersion', 'and the shape stamp is still first');
    // Re-running writes nothing at all, and a gate write over the same content writes nothing either.
    const bytes = fs.readFileSync(f, 'utf8');
    await runMigrate(T, { apply: true });
    assert.equal(fs.readFileSync(f, 'utf8'), bytes, 'a second migrate is a no-op');
    const { writeState } = await import('./epic-state.mjs');
    writeState(f, read(f));
    assert.equal(fs.readFileSync(f, 'utf8'), bytes, 'and so is a gate write — no byte churn');
  } finally { cleanup(T); }
});

test('migrate 4 -> 5: the OLD frontmatter name wins, because it is still the one that counts', async () => {
  // `lineage-check.sh` lives in the user's repo and reads `kind:`. It is refreshed by `yad update`,
  // which has no ordering with `yad migrate` — so a repo WILL exist that migrated but did not update.
  // If the new name won here, that repo's engine and its gate would disagree about what the work is.
  const T = project({ files: {
    'epics/EP-x/epic.md': epicMd('kind: defect\ntype: feature\nparent: EP-root\nthread: EP-root'),
    'epics/EP-x/.sdlc/state.json': stateWith([{ id: 'epic', type: 'author', status: 'done' }]),
  } });
  try {
    await runMigrate(T, { apply: true });
    assert.equal(read(path.join(T, 'epics/EP-x/.sdlc/state.json')).type, 'defect');
  } finally { cleanup(T); }
});

test('migrate 4 -> 5: an epic with no epic.md gets no type at all', async () => {
  // EP-discovery is the case: the product front-zero, marked `kind: "discovery"` in state.json, with
  // no epic.md and no frontmatter to copy. It is not a work item on the ladder, so inventing
  // `feature` for it would put a fifth thing on that ladder nobody authored.
  const T = project({ files: {
    'epics/EP-discovery/.sdlc/state.json':
      JSON.stringify({ schemaVersion: 3, kind: 'discovery', currentStep: 'discovery',
        steps: [{ id: 'discovery', type: 'author', status: 'done' }] }, null, 2) + '\n',
  } });
  try {
    await runMigrate(T, { apply: true });
    const st = read(path.join(T, 'epics/EP-discovery/.sdlc/state.json'));
    assert.equal('type' in st, false, 'nothing to copy, so nothing is written');
    assert.equal(st.kind, 'discovery', 'and the lifecycle marker is left exactly as it was');
    assert.equal(st.schemaVersion, ENGINE_SHAPE, 'the file still moves shape — the shape is the project\'s');
  } finally { cleanup(T); }
});

test('migrate 4 -> 5: a STUB carries the lifecycle marker and the type at once', async () => {
  // The trap this pins: `kind` in state.json means "stub"/"discovery", and `type` means the work-item
  // type. A stamper that read or wrote the wrong one of those would look right and be wrong — a stub
  // would come out typed "stub", which is not a type, or the marker would be overwritten and
  // `yad-backfill` would lose the epic it has to promote.
  const T = project({ files: {
    'epics/EP-x/epic.md': epicMd('kind: feature\nstub: backfill-pending'),
    'epics/EP-x/.sdlc/state.json':
      JSON.stringify({ schemaVersion: 3, kind: 'stub', currentStep: 'backfill-pending',
        steps: [{ id: 'epic', type: 'author', status: 'todo' }] }, null, 2) + '\n',
  } });
  try {
    await runMigrate(T, { apply: true });
    const st = read(path.join(T, 'epics/EP-x/.sdlc/state.json'));
    assert.equal(st.kind, 'stub', 'the lifecycle marker survives');
    assert.equal(st.type, 'feature', 'and the work-item type arrives beside it');
  } finally { cleanup(T); }
});

test('migrate 4 -> 5: a type already recorded is never rewritten, and a re-run is a no-op', async () => {
  const T = project({ files: {
    'epics/EP-x/epic.md': epicMd('kind: defect\nparent: EP-root\nthread: EP-root'),
    'epics/EP-x/.sdlc/state.json':
      JSON.stringify({ schemaVersion: 4, type: 'hotfix', currentStep: 'epic',
        steps: [{ id: 'epic', type: 'author', status: 'done' }] }, null, 2) + '\n',
  } });
  try {
    await runMigrate(T, { apply: true });
    const f = path.join(T, 'epics/EP-x/.sdlc/state.json');
    assert.equal(read(f).type, 'hotfix', 'a value already on disk is the answer, not epic.md');
    const bytes = fs.readFileSync(f, 'utf8');
    await runMigrate(T, { apply: true });
    assert.equal(fs.readFileSync(f, 'utf8'), bytes, 'the second run changes nothing');
  } finally { cleanup(T); }
});

test('migrate 4 -> 5: on a VERIFIED project state.json is skipped, and the gate write carries it', async () => {
  // The same half-applied gap shape 4 had, for the same reason: CI owns state.json on a verified
  // Product, so migrate refuses to write it. What closes the gap is that the gate's own write goes
  // through ONE function, and that function runs the same stamper this migration step does.
  const { stampWorkItemType } = await import('./epic-state.mjs');
  const T = project({ bridge: true, files: {
    'epics/EP-x/epic.md': epicMd('kind: defect\nparent: EP-root\nthread: EP-root'),
    'epics/EP-x/.sdlc/state.json': stateWith([{ id: 'epic', type: 'author', status: 'done' }]),
  } });
  try {
    const { rows } = planMigration(T);
    assert.equal(rowFor(rows, 'epics/EP-x/.sdlc/state.json').action, 'ci-owned', 'migrate will not write it');
    await runMigrate(T, { apply: true });
    const st = read(path.join(T, 'epics/EP-x/.sdlc/state.json'));
    assert.equal('type' in st, false, 'and indeed it did not');
    assert.equal(stampWorkItemType(st, path.join(T, 'epics/EP-x')).type, 'defect', 'the gate write closes the gap');
  } finally { cleanup(T); }
});

test('migrate 4 -> 5: a `type` key that is already there is never overwritten, whatever it holds', async () => {
  // The guard is "is the key present", not "is it a string". Overwriting a value somebody wrote —
  // even `null` — would be the migration deciding what their file meant, during an upgrade they ran
  // to be safe. Doctor is what reports a value nobody defined; correcting one here is not this
  // command's job, and a migration that silently rewrites hand-written values is the reason people
  // stop trusting one.
  const { stampWorkItemType } = await import('./epic-state.mjs');
  const T = project({ files: { 'epics/EP-x/epic.md': epicMd('kind: defect\nparent: EP-root') } });
  try {
    const dir = path.join(T, 'epics/EP-x');
    for (const held of [null, 42, '', 'nonsense', 'feature']) {
      const before = { schemaVersion: 5, type: held, currentStep: 'epic', steps: [] };
      const after = stampWorkItemType(before, dir);
      assert.equal(after, before, `a state holding ${JSON.stringify(held)} came back as a new object`);
    }
    // …and with no key at all, it is stamped from epic.md as usual.
    assert.equal(stampWorkItemType({ schemaVersion: 5, currentStep: 'epic', steps: [] }, dir).type, 'defect');
  } finally { cleanup(T); }
});

// ---- the gate write IS the migration, for the one file no migration reaches --------------------

// A shape-1 `state.json` in the vocabulary a real 3.18.1 project holds: old dial names, no work-item
// type, and — the part that mattered — a `schemaVersion` already written, so `writeShape` had
// something to preserve.
const LEGACY_STATE = JSON.stringify({
  schemaVersion: 1,
  epicId: 'EP-x',
  createdAt: '2026-01-01',
  currentStep: 'implement',
  steps: [
    { id: 'epic', type: 'author', assistance: 'review', automation: 'human_approve', locked: true, status: 'done' },
    { id: 'implement', assistance: 'heavy', automation: 'machine_advance', status: 'in_progress' },
  ],
}, null, 2) + '\n';
const LEGACY_FILES = {
  'epics/EP-x/epic.md': epicMd('kind: defect\nparent: EP-root\nthread: EP-root'),
  'epics/EP-x/.sdlc/state.json': LEGACY_STATE,
};
const STATE_REL = 'epics/EP-x/.sdlc/state.json';

test('the gate write on a VERIFIED project equals the migration on a local one, byte for byte', async () => {
  // The invariant the whole verified path rests on. `yad migrate` refuses to write `state.json` on a
  // verified Product — CI owns it — so `writeState` is the only thing that will ever move that file.
  // If the two ever produce different bytes, a verified project is on a shape nobody defined, and
  // nothing would say so. Comparing them directly is the only way to keep that from happening
  // quietly: a future shape 6 that changes `state.json` without teaching `writeState` fails HERE.
  const { writeState } = await import('./epic-state.mjs');
  const local = project({ files: LEGACY_FILES });
  const verified = project({ bridge: true, files: LEGACY_FILES });
  try {
    await runMigrate(local, { apply: true });

    const vf = path.join(verified, STATE_REL);
    await runMigrate(verified, { apply: true });
    assert.equal(fs.readFileSync(vf, 'utf8'), LEGACY_STATE, 'migrate really did refuse to touch it');
    writeState(vf, read(vf));

    assert.equal(fs.readFileSync(vf, 'utf8'), fs.readFileSync(path.join(local, STATE_REL), 'utf8'));
  } finally { cleanup(local); cleanup(verified); }
});

test('a gate write moves a STALE schemaVersion up to this engine, and never down', async () => {
  // 3.18.1 stamps shape 1, so every verified project on disk holds a state.json recording 1. Before
  // this, the gate write brought its FIELDS up to date and left the NUMBER at 1 for ever — `yad
  // doctor` warned "CI-owned and behind" with a hint promising CI would fix it, which it never could.
  const { writeState } = await import('./epic-state.mjs');
  const T = project({ files: LEGACY_FILES });
  try {
    const f = path.join(T, STATE_REL);
    writeState(f, read(f));
    const now = read(f);
    assert.equal(now.schemaVersion, ENGINE_SHAPE, 'the number moves with the fields');
    assert.equal(now.steps[1].advance, 'auto', 'and the fields really did move');
    assert.equal(now.type, 'defect');
    assert.equal(Object.keys(now)[0], 'schemaVersion', 'still the first key');

    // Writing it again changes nothing at all.
    const bytes = fs.readFileSync(f, 'utf8');
    writeState(f, read(f));
    assert.equal(fs.readFileSync(f, 'utf8'), bytes, 'no byte churn on an unchanged re-write');

    // A file AHEAD of this engine is left exactly as it is — the same refusal `yad migrate` makes.
    // Lowering it would have this release claim it wrote a shape it cannot read.
    const ahead = { ...read(f), schemaVersion: ENGINE_SHAPE + 1 };
    fs.writeFileSync(f, JSON.stringify(ahead, null, 2) + '\n');
    writeState(f, read(f));
    assert.equal(read(f).schemaVersion, ENGINE_SHAPE + 1, 'never moved backwards');
  } finally { cleanup(T); }
});

test('an UNSTAMPED state.json is unaffected — writeShape already stamped those correctly', async () => {
  const { writeState } = await import('./epic-state.mjs');
  const T = project({ files: {
    ...LEGACY_FILES,
    [STATE_REL]: JSON.stringify({ epicId: 'EP-x', currentStep: 'epic', steps: [{ id: 'epic', type: 'author', status: 'done' }] }, null, 2) + '\n',
  } });
  try {
    const f = path.join(T, STATE_REL);
    writeState(f, read(f));
    assert.equal(read(f).schemaVersion, ENGINE_SHAPE);
  } finally { cleanup(T); }
});

// ---- shape 5 -> 6: the lifecycle profile (E17) ---------------------------------------------------

// The `classic` 10-step chain and the `analysis-first` 12-step one, as step rows a state.json holds.
const chain = (ids) => ids.map((id) => ({ id, type: id.endsWith('-review') ? 'review+approve' : 'author', status: 'blocked' }));
const CLASSIC = ['epic', 'epic-review', 'architecture', 'architecture-review',
  'ui-design', 'ui-design-review', 'stories', 'stories-review', 'test-cases', 'test-cases-review'];

test('migrate 5 -> 6: the profile is READ off the chain the epic already carries', async () => {
  const T = project({ files: {
    'epics/EP-x/.sdlc/state.json': stateWith(chain(CLASSIC)),
    'epics/EP-y/.sdlc/state.json': stateWith(chain(['analysis', 'analysis-review', ...CLASSIC])),
    'epics/EP-discovery/.sdlc/state.json': stateWith(chain(['discovery', 'discovery-review'])),
  } });
  try {
    await runMigrate(T, { apply: true });
    assert.equal(read(path.join(T, 'epics/EP-x/.sdlc/state.json')).profile, 'classic');
    assert.equal(read(path.join(T, 'epics/EP-y/.sdlc/state.json')).profile, 'analysis-first');
    assert.equal(read(path.join(T, 'epics/EP-discovery/.sdlc/state.json')).profile, 'discovery');
  } finally { cleanup(T); }
});

test('migrate 5 -> 6: a chain on NO route gets no profile, so doctor keeps reporting it', async () => {
  // The whole reason the value is derived rather than defaulted. Stamping `classic` here would make
  // the file agree with itself, `step:off-route` would go quiet, and an upgrade run for safety would
  // have hidden the one epic that needed looking at.
  const T = project({ files: {
    'epics/EP-x/.sdlc/state.json': stateWith(chain(['stories', 'epic'])),
    'epics/EP-y/.sdlc/state.json': stateWith(chain(['epic', 'epic-review', 'implement'])),
  } });
  try {
    await runMigrate(T, { apply: true });
    for (const e of ['EP-x', 'EP-y']) {
      const st = read(path.join(T, `epics/${e}/.sdlc/state.json`));
      assert.equal('profile' in st, false, `${e}: a route was invented for a chain that has none`);
      assert.equal(st.schemaVersion, ENGINE_SHAPE, `${e}: the file still moves shape`);
    }
  } finally { cleanup(T); }
});

test('migrate 5 -> 6: a `profile` already recorded is never overwritten, whatever it says', async () => {
  // The file wins for this whole major (rule 3): a project may hold a route from a newer yadflow, and
  // correcting a value somebody wrote during an upgrade they ran to be safe is not this command's job.
  const T = project({ files: {
    'epics/EP-x/.sdlc/state.json': JSON.stringify(
      { schemaVersion: 5, profile: 'spike', currentStep: 'epic', steps: chain(CLASSIC) }, null, 2) + '\n',
  } });
  try {
    await runMigrate(T, { apply: true });
    assert.equal(read(path.join(T, 'epics/EP-x/.sdlc/state.json')).profile, 'spike');
  } finally { cleanup(T); }
});

test('migrate 5 -> 6: `profile` is written beside `type` at the TOP, not under `steps`', async () => {
  const T = project({ files: {
    'epics/EP-x/epic.md': epicMd('kind: feature'),
    'epics/EP-x/.sdlc/state.json': stateWith(chain(CLASSIC)),
  } });
  try {
    const f = path.join(T, 'epics/EP-x/.sdlc/state.json');
    await runMigrate(T, { apply: true });
    const keys = Object.keys(read(f));
    assert.equal(keys[0], 'schemaVersion');
    assert.ok(keys.indexOf('profile') < keys.indexOf('steps'), `profile came after steps: ${keys.join(', ')}`);
    assert.ok(keys.indexOf('type') < keys.indexOf('profile'), `the two shape keys are out of order: ${keys.join(', ')}`);
    // Safe to run twice, and a gate write over the same content changes nothing either — the two
    // paths have to agree down to the bytes, which is what the invariant test above pins in general.
    const bytes = fs.readFileSync(f, 'utf8');
    await runMigrate(T, { apply: true });
    assert.equal(fs.readFileSync(f, 'utf8'), bytes, 'a second migrate is a no-op');
    const { writeState } = await import('./epic-state.mjs');
    writeState(f, read(f));
    assert.equal(fs.readFileSync(f, 'utf8'), bytes, 'and so is a gate write');
  } finally { cleanup(T); }
});

test('migrate 5 -> 6: only an epic ledger gains a profile — no other file is touched', async () => {
  // `ctx.rel` is what scopes the step. Without it a `repos.json` holding a `steps` array of its own
  // would be handed to the matcher and could come out with a lifecycle route stamped on it.
  const T = project({ files: {
    '.sdlc/repos.json': JSON.stringify({ schemaVersion: 5, steps: chain(CLASSIC) }, null, 2) + '\n',
    'epics/EP-x/.sdlc/change.json': JSON.stringify({ schemaVersion: 5, steps: chain(CLASSIC) }, null, 2) + '\n',
  } });
  try {
    await runMigrate(T, { apply: true });
    assert.equal('profile' in read(path.join(T, '.sdlc/repos.json')), false);
    assert.equal('profile' in read(path.join(T, 'epics/EP-x/.sdlc/change.json')), false);
  } finally { cleanup(T); }
});

test('stampProfile: add-only, never invents, and hands back the SAME object when idle', async () => {
  const { stampProfile } = await import('./epic-state.mjs');
  const already = { profile: 'spike', steps: chain(CLASSIC) };
  assert.equal(stampProfile(already), already, 'a recorded route is untouched, object identity and all');
  const offRoute = { currentStep: 'x', steps: chain(['stories', 'epic']) };
  assert.equal(stampProfile(offRoute), offRoute, 'no route fits, so no key and no new object');
  const empty = { steps: [] };
  assert.equal(stampProfile(empty), empty, 'an empty chain names no route');
  assert.equal(stampProfile(null), null);
  assert.equal(stampProfile([1, 2]).length, 2, 'an array is not a state');
  // …and it DOES return a new object when there is something to add, or nothing would be written.
  const pending = { currentStep: 'epic', steps: chain(CLASSIC) };
  assert.notEqual(stampProfile(pending), pending);
  assert.equal(stampProfile(pending).profile, 'classic');
});

test('a gate write and a migration agree on the ORDER of the two shape keys, not just their values', async () => {
  // The general invariant above is checked on a fixture whose chain is off-route, so it gains `type`
  // and no `profile` — and with only one key added, running the two stampers in either order gives
  // the same bytes. Nothing there could tell. This fixture gains BOTH, which is the only case where
  // the order is observable: stamping profile first yields `profile, type`, the migration chain
  // (4 -> 5, then 5 -> 6) yields `type, profile`, and a verified project would then hold a key order
  // no local project ever produces.
  const { writeState } = await import('./epic-state.mjs');
  const FILES = {
    'epics/EP-x/epic.md': epicMd('kind: feature'),
    'epics/EP-x/.sdlc/state.json': JSON.stringify(
      { schemaVersion: 1, epicId: 'EP-x', createdAt: '2026-01-01', currentStep: 'epic', steps: chain(CLASSIC) },
      null, 2) + '\n',
  };
  const local = project({ files: FILES });
  const verified = project({ bridge: true, files: FILES });
  try {
    await runMigrate(local, { apply: true });
    const lf = path.join(local, STATE_REL);
    assert.deepEqual(Object.keys(read(lf)).slice(0, 6),
      ['schemaVersion', 'epicId', 'createdAt', 'type', 'profile', 'currentStep']);

    const vf = path.join(verified, STATE_REL);
    await runMigrate(verified, { apply: true });
    writeState(vf, read(vf));
    assert.equal(fs.readFileSync(vf, 'utf8'), fs.readFileSync(lf, 'utf8'));
  } finally { cleanup(local); cleanup(verified); }
});
