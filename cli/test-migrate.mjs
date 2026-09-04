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
const FAKE_1_TO_2 = [
  ...MIGRATIONS,
  { from: 1, to: 2, title: 'fake — add a field', apply: (o) => ({ ...o, added: true }) },
];

test('migrate: the shipped list is the 1 → 1 baseline, and it changes no field', () => {
  assert.deepEqual(MIGRATIONS.map((m) => [m.from, m.to]), [[1, 1]],
    'a real shape change appends here — and lands with its own migration test');
  assert.deepEqual(MIGRATIONS[0].apply({ a: 1 }), { a: 1 });
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
  assert.deepEqual(res.written.sort(), ['.sdlc/cli-version.json', '.sdlc/hub.json', '.sdlc/repos.json']);
  assert.equal(read(path.join(T, '.sdlc/repos.json')).schemaVersion, 1);
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
    'epics/EP-x/.sdlc/contract-lock.json': '{\n  "schemaVersion": 1,\n  "hash": "sha256:abc"\n}\n',
  };
  const A = project({ files });
  const B = project({ files });
  try {
    const predicted = (await runMigrate(A, {})).rows.filter((r) => r.changes).map((r) => r.file).sort();
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
  assert.equal(rec.schemaVersion, 1, 'stamped, as an ordinary migrated row');
  assert.equal(rec.version, '1.0.2', 'the CLI-sync version is not a migration record and must not move');
  assert.deepEqual(Object.keys(rec), ['schemaVersion', 'version'], 'and nothing else was added to it');
  assert.ok(res.written.includes('.sdlc/cli-version.json'), 'so it is reported like every other write');
  assert.ok(fs.existsSync(path.join(T, '.sdlc/cli-version.json.yad-orig')), 'and backed up like every other write');
  cleanup(T);
});

test('migrate: a real shape change is applied, reported, and reruns clean (fake 1 → 2)', async () => {
  const T = project({ files: { '.sdlc/repos.json': '{\n  "repos": []\n}\n' } });

  const preview = planMigration(T, { migrations: FAKE_1_TO_2 });
  const row = rowFor(preview.rows, '.sdlc/repos.json');
  assert.deepEqual([row.from, row.to, row.action], [1, 2, 'migrate']);
  assert.deepEqual(row.steps, ['baseline — every file states its shape', 'fake — add a field'],
    'the list is walked in order and every step that ran is named');

  await runMigrate(T, { apply: true }, { migrations: FAKE_1_TO_2 });
  const migrated = read(path.join(T, '.sdlc/repos.json'));
  assert.equal(migrated.schemaVersion, 2, 'the file now states the new shape');
  assert.equal(migrated.added, true, 'and the migration actually changed it');
  assert.deepEqual(read(path.join(T, '.sdlc/repos.json.yad-orig')), { repos: [] }, 'the pre-migration file is kept');

  // The step must not run a second time, which is what an unbounded loop would do. With this fake
  // list the files are now on a shape the SHIPPED engine does not know, so the honest second answer is
  // "these are newer than me" — reported, and still not rewritten.
  const exit = process.exitCode;
  try {
    const again = await runMigrate(T, { apply: true }, { migrations: FAKE_1_TO_2 });
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
  assert.equal(read(path.join(T, 'epics/EP-x/.sdlc/change.json')).schemaVersion, 1);
  cleanup(T);
});

test('migrate: a project in local (non-verified) mode migrates its gate ledger like any other file', async () => {
  const T = project({ files: { 'epics/EP-x/.sdlc/state.json': '{\n  "currentStep": "epic"\n}\n' } });
  const res = await runMigrate(T, { apply: true });
  assert.equal(rowFor(res.rows, path.join('epics', 'EP-x', '.sdlc', 'state.json')).action, 'stamp');
  assert.equal(read(path.join(T, 'epics/EP-x/.sdlc/state.json')).schemaVersion, 1);
  cleanup(T);
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
