// The harness hook scripts (`skills/yad-checks/templates/hooks/*.mjs`) and the Windows-facing parts of
// the CLI (E113). Every test here runs on Linux, macOS AND Windows: this is the file the Windows CI job
// runs, so nothing in it may reach for bash, a POSIX path, or an execute bit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The #280 guard, as in cli/test.mjs: under `node --test` this file's stdout carries the runner's own
// messages, and a printed `warn()` line landing between them can lose every result after it.
if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}

process.env.YAD_NO_UPDATE_CHECK = '1';
process.env.YAD_PLATFORM_READ = '0';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOOKS = path.join(ROOT, 'skills/yad-checks/templates/hooks');
const IS_WINDOWS = process.platform === 'win32';
const SCRIPTS = ['ledger-guard.mjs', 'ledger-guard-cursor.mjs', 'yad-capture.mjs'];

// A Product laid out the way a hook expects: `<T>/hooks/<script>.mjs`.
function scaffold() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-hooks-'));
  fs.mkdirSync(path.join(T, 'hooks'), { recursive: true });
  for (const s of SCRIPTS) fs.copyFileSync(path.join(HOOKS, s), path.join(T, 'hooks', s));
  return T;
}
const cleanup = (T) => fs.rmSync(T, { recursive: true, force: true });

// A stand-in `yad`, as a Node script so it runs everywhere. It records its argv (one per line) and
// whether stdin reached it, prints `stdout`, and exits with `code`.
function fakeYad(dir, name, { code = 0, stdout = '' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(p, `
import fs from 'node:fs';
let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch {}
fs.writeFileSync(${JSON.stringify(path.join(dir, `${name}.argv`))}, JSON.stringify({ argv: process.argv.slice(2), input }));
${stdout ? `process.stdout.write(${JSON.stringify(`${stdout}\n`)});` : ''}
process.exit(${code});
`);
  return p;
}
const argvOf = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.argv`), 'utf8'));
// YAD_BIN as a person would write it: the interpreter, then the script. Quoted, because Node on
// Windows usually lives under `C:\Program Files\`.
const yadBin = (script) => `"${process.execPath}" "${script}"`;

// The environment a hook runs in: this one, minus anything that could find a real `yad`, with PATH set to
// `pathDirs` only. Every spelling of PATH is removed first — Windows keeps it as `Path`, and a second key
// beside it would leave which one wins to chance.
function hookEnv(extra = {}, pathDirs = []) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(path|yad_bin|yad_capture|yad_hook_disable)$/i.test(k)));
  return { ...env, PATH: pathDirs.join(path.delimiter), ...extra };
}
function runHook(T, script, { env = {}, pathDirs = [], input = '{"tool_input":{"file_path":"epics/EP-a/.sdlc/state.json"}}', args = [], cwd = T } = {}) {
  const r = spawnSync(process.execPath, [path.join(T, 'hooks', script), ...args], { input, encoding: 'utf8', cwd, env: hookEnv(env, pathDirs), timeout: 30_000 });
  return { code: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
}

// ---- the shared resolver ---------------------------------------------------------------------------

test('E113: the three hook scripts carry the SAME yad-resolve block, byte for byte', () => {
  const block = (s) => {
    const text = fs.readFileSync(path.join(HOOKS, s), 'utf8');
    const start = text.indexOf('// ---- yad-resolve');
    const end = text.indexOf('// ---- end yad-resolve');
    assert.ok(start >= 0 && end > start, `${s} has the marked block`);
    return text.slice(start, end);
  };
  const [first, ...rest] = SCRIPTS.map(block);
  for (const [i, b] of rest.entries()) assert.equal(b, first, `${SCRIPTS[i + 1]} drifted from ${SCRIPTS[0]}`);
});

test('E113: no hook script imports anything but Node itself — it runs where yadflow is not installed', () => {
  for (const s of SCRIPTS) {
    const text = fs.readFileSync(path.join(HOOKS, s), 'utf8');
    for (const m of text.matchAll(/^import .* from '([^']+)';$/gm)) assert.match(m[1], /^node:/, `${s} imports ${m[1]}`);
  }
});

// ---- ledger-guard.mjs (the exit-code protocol) ------------------------------------------------------

test('ledger-guard.mjs: only an explicit deny blocks, and the payload reaches yad', () => {
  const T = scaffold();
  const bin = path.join(T, 'bin');
  try {
    assert.equal(runHook(T, 'ledger-guard.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, 'deny', { code: 2 })) } }).code, 2);
    assert.equal(runHook(T, 'ledger-guard.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, 'allow')) } }).code, 0);
    // A crash, or an old `yad` that does not know the subcommand, must not read as a refusal.
    for (const code of [1, 127]) {
      const r = runHook(T, 'ledger-guard.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, `c${code}`, { code })) } });
      assert.equal(r.code, 0, `exit ${code} allows`);
      assert.match(r.err, new RegExp(`exited ${code}`));
    }
    const { argv, input } = argvOf(bin, 'allow');
    assert.deepEqual(argv, ['hook', 'ledger-guard']);
    assert.match(input, /state\.json/, 'stdin is the harness\'s own, passed through');
  } finally { cleanup(T); }
});

test('ledger-guard.mjs: resolution order — the Product install, found from the script, beats PATH', () => {
  const T = scaffold();
  try {
    // Nothing to find at all → allow, and say so.
    const none = runHook(T, 'ledger-guard.mjs');
    assert.equal(none.code, 0);
    assert.match(none.err, /no `yad` on PATH and none installed/);
    // A YAD_BIN of only spaces is no override at all.
    assert.equal(runHook(T, 'ledger-guard.mjs', { env: { YAD_BIN: '   ' } }).code, 0);

    // The Product's own install answers 2; a `yad` on PATH would answer 0. Run from another directory:
    // the Product is found from the SCRIPT's location, never the caller's.
    const nm = path.join(T, 'node_modules/yadflow/bin');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'yad.mjs'), 'process.exit(2);');
    const pathBin = path.join(T, 'pathbin');
    const onPath = fakeYad(pathBin, 'onpath');
    if (IS_WINDOWS) fs.writeFileSync(path.join(pathBin, 'yad.cmd'), `@"${process.execPath}" "${onPath}" %*\r\n`);
    else { fs.writeFileSync(path.join(pathBin, 'yad'), `#!/bin/sh\nexec "${process.execPath}" "${onPath}" "$@"\n`); fs.chmodSync(path.join(pathBin, 'yad'), 0o755); }
    const r = runHook(T, 'ledger-guard.mjs', { pathDirs: [pathBin], cwd: os.tmpdir() });
    assert.equal(r.code, 2, `the Product install answered: ${r.err}`);
    assert.ok(!fs.existsSync(path.join(pathBin, 'onpath.argv')), 'the PATH copy was never invoked');

    // Without the Product install, the `yad` on PATH is used — on Windows that is the `.cmd` launcher,
    // which needs a shell to start.
    fs.rmSync(path.join(T, 'node_modules'), { recursive: true });
    const viaPath = runHook(T, 'ledger-guard.mjs', { pathDirs: [pathBin] });
    assert.equal(viaPath.code, 0, viaPath.err);
    assert.deepEqual(argvOf(pathBin, 'onpath').argv, ['hook', 'ledger-guard']);
  } finally { cleanup(T); }
});

test('ledger-guard.mjs: an npm global install on Windows runs the package script with this Node, not its .cmd', { skip: !IS_WINDOWS && 'Windows only' }, () => {
  const T = scaffold();
  try {
    const prefix = path.join(T, 'npm-prefix');
    fs.mkdirSync(path.join(prefix, 'node_modules/yadflow/bin'), { recursive: true });
    fs.writeFileSync(path.join(prefix, 'node_modules/yadflow/bin/yad.mjs'), 'process.exit(2);');
    // A launcher that would ALLOW if it were run: the answer proves which one was.
    fs.writeFileSync(path.join(prefix, 'yad.cmd'), '@exit /b 0\r\n');
    assert.equal(runHook(T, 'ledger-guard.mjs', { pathDirs: [prefix] }).code, 2);
  } finally { cleanup(T); }
});

test('ledger-guard.mjs: a script reached through a symbolic link still finds its own Product', { skip: IS_WINDOWS && 'symbolic links need admin rights on Windows' }, () => {
  const T = scaffold();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-hooks-link-'));
  try {
    const nm = path.join(T, 'node_modules/yadflow/bin');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'yad.mjs'), 'process.exit(2);');
    fs.mkdirSync(path.join(elsewhere, 'hooks'));
    fs.symlinkSync(path.join(T, 'hooks/ledger-guard.mjs'), path.join(elsewhere, 'hooks/ledger-guard.mjs'));
    assert.equal(runHook(elsewhere, 'ledger-guard.mjs').code, 2);
  } finally { cleanup(T); cleanup(elsewhere); }
});

// ---- ledger-guard-cursor.mjs (the permission protocol) ----------------------------------------------

test('ledger-guard-cursor.mjs: every path answers with a permission verdict on stdout', () => {
  const T = scaffold();
  const bin = path.join(T, 'bin');
  const verdict = (r) => { assert.doesNotThrow(() => JSON.parse(r.out), `not JSON: ${JSON.stringify(r.out)} ${r.err}`); return JSON.parse(r.out); };
  const run = (name, opts) => runHook(T, 'ledger-guard-cursor.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, name, opts)) } });
  try {
    const allow = run('allow', { stdout: '{"permission":"allow"}' });
    assert.equal(verdict(allow).permission, 'allow');
    assert.equal(allow.code, 0);
    assert.deepEqual(argvOf(bin, 'allow').argv, ['hook', 'ledger-guard', '--format', 'cursor']);
    const deny = run('deny', { stdout: '{"permission":"deny","agent_message":"x"}' });
    assert.equal(verdict(deny).permission, 'deny');
    assert.equal(deny.code, 0, 'a deny exits 0 — the JSON is the authoritative answer');
    // A banner printed in front of the JSON: the verdict is the LAST non-empty line.
    const banner = run('banner', { stdout: 'yad: some notice\n{"permission":"deny","agent_message":"y"}' });
    assert.equal(verdict(banner).permission, 'deny');

    // Exit 2 with nothing on stdout is an older yad's deny.
    const old = verdict(run('old', { code: 2 }));
    assert.equal(old.permission, 'deny');
    assert.deepEqual(Object.keys(old).sort(), ['agent_message', 'permission', 'user_message'], "Cursor's schema is snake_case");
    assert.match(old.agent_message, /yad gate open/);

    // Every fail-open branch is an explicit ALLOW, never the empty stdout that would block.
    const nothing = runHook(T, 'ledger-guard-cursor.mjs');
    assert.equal(verdict(nothing).permission, 'allow');
    assert.match(nothing.err, /no `yad` on PATH/);
    for (const code of [1, 127]) assert.equal(verdict(run(`c${code}`, { code })).permission, 'allow', `exit ${code} allows`);
    // Garbage is never forwarded as a verdict — an off-schema answer would block.
    assert.equal(verdict(run('junk', { stdout: 'not json at all' })).permission, 'allow');
  } finally { cleanup(T); }
});

// ---- yad-capture.mjs ---------------------------------------------------------------------------------

test('yad-capture.mjs: runs `capture --hook --dir <Product>`, passes only --format claude, and always exits 0', () => {
  const T = scaffold();
  const bin = path.join(T, 'bin');
  try {
    const plain = runHook(T, 'yad-capture.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, 'plain')) } });
    assert.equal(plain.code, 0);
    assert.equal(plain.out, '', 'nothing on stdout unless yad prints it');
    const product = fs.realpathSync(T);
    assert.deepEqual(argvOf(bin, 'plain').argv, ['capture', '--hook', '--dir', product]);
    assert.equal(argvOf(bin, 'plain').input, '', 'the payload is drained, never passed on');

    runHook(T, 'yad-capture.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, 'claude')) }, args: ['--format', 'claude'] });
    assert.deepEqual(argvOf(bin, 'claude').argv, ['capture', '--hook', '--format', 'claude', '--dir', product]);
    // Cursor sets CLAUDE_PROJECT_DIR too: the format is never guessed from it.
    runHook(T, 'yad-capture.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, 'cursor')), CLAUDE_PROJECT_DIR: T, CURSOR_PROJECT_DIR: T } });
    assert.deepEqual(argvOf(bin, 'cursor').argv, ['capture', '--hook', '--dir', product]);

    // yad's stdout (the Claude note) passes through.
    const note = runHook(T, 'yad-capture.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, 'note', { stdout: '{"hookSpecificOutput":{}}' })) }, args: ['--format', 'claude'] });
    assert.equal(note.out, '{"hookSpecificOutput":{}}');

    // A failing yad, and no yad at all: still exit 0.
    assert.equal(runHook(T, 'yad-capture.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, 'crash', { code: 1 })) } }).code, 0);
    const none = runHook(T, 'yad-capture.mjs');
    assert.equal(none.code, 0);
    assert.match(none.err, /nothing captured/);

    // YAD_CAPTURE=0 runs nothing.
    runHook(T, 'yad-capture.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, 'off')), YAD_CAPTURE: '0' } });
    assert.ok(!fs.existsSync(path.join(bin, 'off.argv')));

    // A large payload (a Write of a big file) is drained without a broken pipe.
    const big = runHook(T, 'yad-capture.mjs', { env: { YAD_BIN: yadBin(fakeYad(bin, 'big')) }, input: JSON.stringify({ tool_input: { content: 'x'.repeat(2_000_000) } }) });
    assert.equal(big.code, 0, big.err);
    assert.ok(fs.existsSync(path.join(bin, 'big.argv')));
  } finally { cleanup(T); }
});

// ---- the wiring --------------------------------------------------------------------------------------

test('E113: every hook entry runs `node` on a .mjs script, spelled for its harness', async () => {
  const { HOOK_ADAPTERS, CAPTURE_ADAPTERS, HOOK_WIRING, CAPTURE_WIRING } = await import('./manifest.mjs');
  assert.equal(HOOK_ADAPTERS['.claude'].command, 'node "$CLAUDE_PROJECT_DIR/hooks/ledger-guard.mjs"');
  assert.equal(CAPTURE_ADAPTERS['.claude'].command, 'node "$CLAUDE_PROJECT_DIR/hooks/yad-capture.mjs" --format claude');
  // Cursor: relative, no variable, no quotes — PowerShell on Windows reads neither.
  assert.equal(HOOK_ADAPTERS['.cursor'].command, 'node hooks/ledger-guard-cursor.mjs');
  assert.equal(CAPTURE_ADAPTERS['.cursor'].command, 'node hooks/yad-capture.mjs');
  for (const w of [...HOOK_WIRING, ...CAPTURE_WIRING, ...HOOK_ADAPTERS['.cursor'].wiring]) {
    assert.match(w.dest, /^hooks\/[a-z-]+\.mjs$/);
    assert.ok(!w.exec, `${w.dest} needs no execute bit`);
    assert.ok(fs.existsSync(path.join(ROOT, w.src)), `${w.src} ships`);
  }
  // The bash spellings are still recognised as ours, so `yad check --fix` rewrites them.
  assert.ok(HOOK_ADAPTERS['.claude'].legacyCommands.includes('"$CLAUDE_PROJECT_DIR/hooks/ledger-guard.sh"'));
  assert.ok(HOOK_ADAPTERS['.cursor'].legacyCommands.includes('hooks/ledger-guard-cursor.sh'));
  assert.ok(CAPTURE_ADAPTERS['.claude'].legacyCommands.includes('"$CLAUDE_PROJECT_DIR/hooks/yad-capture.sh"'));
  assert.ok(CAPTURE_ADAPTERS['.cursor'].legacyCommands.includes('hooks/yad-capture.sh'));
});

// A verified Product wired by a yadflow from before E113: bash scripts, their entries, and a provenance
// record of what was written.
async function oldProduct({ record = true } = {}) {
  const { MANAGED_LEDGER } = await import('./manifest.mjs');
  const { contentSha } = await import('./lib.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-hooks-old-'));
  fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ ledger: 'verified', platform: 'github', default_branch: 'main' }));
  fs.writeFileSync(path.join(T, '.sdlc/cli-version.json'), JSON.stringify({ version: '0', ideTargets: ['.claude', '.cursor'] }));
  fs.mkdirSync(path.join(T, '.claude/skills'), { recursive: true });
  fs.mkdirSync(path.join(T, '.cursor/skills'), { recursive: true });
  fs.mkdirSync(path.join(T, 'hooks'));
  const files = {};
  for (const s of ['ledger-guard.sh', 'ledger-guard-cursor.sh', 'yad-capture.sh']) {
    fs.writeFileSync(path.join(T, 'hooks', s), `#!/usr/bin/env bash\n# ${s}, as an older yadflow shipped it\n`);
    files[`hooks/${s}`] = contentSha(path.join(T, 'hooks', s));
  }
  if (record) fs.writeFileSync(path.join(T, MANAGED_LEDGER), JSON.stringify({ version: '0', files }));
  fs.writeFileSync(path.join(T, '.claude/settings.json'), JSON.stringify({ hooks: {
    PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/hooks/ledger-guard.sh"' }] }],
    PostToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/hooks/yad-capture.sh"' }] }],
  } }));
  fs.writeFileSync(path.join(T, '.cursor/hooks.json'), JSON.stringify({ version: 1, hooks: {
    preToolUse: [{ matcher: 'Write|Edit|Delete', command: 'hooks/ledger-guard-cursor.sh', failClosed: false }],
    afterFileEdit: [{ command: 'hooks/yad-capture.sh' }],
  } }));
  return T;
}
// What `yad check --fix` applies, in its order: the hook wiring, then the retired scripts last.
async function fixHooks(T) {
  const { hookActions, captureHookActions, legacyHookScriptActions } = await import('./plan.mjs');
  const actions = [...hookActions(T), ...captureHookActions(T), ...legacyHookScriptActions(T)];
  for (const a of actions) if (a.status !== 'ok' && a.status !== 'modified') a.apply();
  return actions;
}

test('E113: `yad check --fix` rewrites the bash entries to node and removes the scripts it proves it wrote', async () => {
  const T = await oldProduct();
  try {
    const actions = await fixHooks(T);
    assert.deepEqual(actions.filter((a) => a.status === 'removed').map((a) => a.item).sort(),
      ['hooks/ledger-guard-cursor.sh (removed)', 'hooks/ledger-guard.sh (removed)', 'hooks/yad-capture.sh (removed)']);
    const claude = JSON.parse(fs.readFileSync(path.join(T, '.claude/settings.json'), 'utf8'));
    assert.equal(claude.hooks.PreToolUse.length, 1, 'rewritten in place, not added beside');
    assert.equal(claude.hooks.PreToolUse[0].hooks[0].command, 'node "$CLAUDE_PROJECT_DIR/hooks/ledger-guard.mjs"');
    assert.equal(claude.hooks.PostToolUse[0].hooks[0].command, 'node "$CLAUDE_PROJECT_DIR/hooks/yad-capture.mjs" --format claude');
    const cursor = JSON.parse(fs.readFileSync(path.join(T, '.cursor/hooks.json'), 'utf8'));
    assert.equal(cursor.hooks.preToolUse[0].command, 'node hooks/ledger-guard-cursor.mjs');
    assert.equal(cursor.hooks.afterFileEdit[0].command, 'node hooks/yad-capture.mjs');
    for (const s of ['ledger-guard.sh', 'ledger-guard-cursor.sh', 'yad-capture.sh']) assert.ok(!fs.existsSync(path.join(T, 'hooks', s)), `${s} is gone`);
    for (const s of SCRIPTS) assert.ok(fs.existsSync(path.join(T, 'hooks', s)), `${s} is installed`);
    const record = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/managed.json'), 'utf8')).files;
    assert.ok(!Object.keys(record).some((k) => k.endsWith('.sh')), 'the record no longer lists them');
    // A second run has nothing left to do.
    const again = await fixHooks(T);
    assert.deepEqual(again.filter((a) => a.status !== 'ok').map((a) => `${a.item} ${a.status}`), []);
  } finally { cleanup(T); }
});

test('E113: an edited or unrecorded bash hook is the team\'s, and one still named by a settings file is kept', async () => {
  const { legacyHookScriptActions } = await import('./plan.mjs');
  const T = await oldProduct();
  try {
    fs.appendFileSync(path.join(T, 'hooks/ledger-guard.sh'), '# our own tweak\n');
    assert.ok(!legacyHookScriptActions(T).some((a) => a.item.startsWith('hooks/ledger-guard.sh')), 'edited: not ours to delete');
    // The team's own entry in a harness yad does not wire still runs the capture script.
    const cursor = JSON.parse(fs.readFileSync(path.join(T, '.cursor/hooks.json'), 'utf8'));
    cursor.hooks.stop = [{ command: 'bash hooks/yad-capture.sh --final' }];
    fs.writeFileSync(path.join(T, '.cursor/hooks.json'), JSON.stringify(cursor));
    const said = [];
    const orig = console.log;
    console.log = (...a) => { said.push(a.join(' ')); };
    try { await fixHooks(T); } finally { console.log = orig; }
    assert.ok(!said.some((l) => /yad-capture\.sh stays/.test(l)), 'a team\'s own command is their choice, and is left in silence');
    assert.ok(fs.existsSync(path.join(T, 'hooks/ledger-guard.sh')), 'the edited copy stays');
    assert.ok(fs.existsSync(path.join(T, 'hooks/yad-capture.sh')), 'still run by the team\'s entry, so it stays');
    assert.ok(!fs.existsSync(path.join(T, 'hooks/ledger-guard-cursor.sh')), 'the untouched, unnamed one goes');
  } finally { cleanup(T); }
  const U = await oldProduct({ record: false });
  try {
    await fixHooks(U);
    for (const s of ['ledger-guard.sh', 'ledger-guard-cursor.sh', 'yad-capture.sh']) assert.ok(fs.existsSync(path.join(U, 'hooks', s)), `${s}: no record, nothing proven, kept`);
  } finally { cleanup(U); }
});

test('E113 review 1: the old scripts stay until the rewritten settings are COMMITTED, then go', async () => {
  const { legacyHookScriptActions } = await import('./plan.mjs');
  const T = await oldProduct();
  // Unsigned, and blind to the global ignore file: a developer's `commit.gpgsign` would stop the commit, and a
  // global ignore of `.claude/` would keep the settings out of it.
  const g = (...a) => spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', `core.excludesFile=${path.join(T, '.no-global-ignore')}`, ...a], { cwd: T, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  try {
    g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'old wiring');
    // First run: the entries are rewritten on disk, but HEAD still runs the bash scripts — a push of the
    // deletion now would give everyone who pulls a hook with no script under it.
    const first = await fixHooks(T);
    assert.deepEqual(first.filter((a) => a.status === 'removed'), [], 'no removal is even planned');
    for (const s of ['ledger-guard.sh', 'ledger-guard-cursor.sh', 'yad-capture.sh']) assert.ok(fs.existsSync(path.join(T, 'hooks', s)), s);
    assert.deepEqual(legacyHookScriptActions(T), [], '`yad check` shows nothing pending it would not do');
    // The team commits the new entries: now they go.
    g('add', '-A'); g('commit', '-q', '-m', 'node hooks');
    assert.equal(legacyHookScriptActions(T).length, 3);
    await fixHooks(T);
    for (const s of ['ledger-guard.sh', 'ledger-guard-cursor.sh', 'yad-capture.sh']) assert.ok(!fs.existsSync(path.join(T, 'hooks', s)), s);
  } finally { cleanup(T); }
});

test('E113 review 1: a kept script is never pending — a local ledger\'s leftover guard entry, a personal settings file, a backslash', async () => {
  const { legacyHookScriptActions } = await import('./plan.mjs');
  const T = await oldProduct();
  try {
    // Local ledger: nothing rewrites the guard's old entry, so its script is still run — and so it is not
    // planned for removal at all (planning it, then keeping it, would show it pending on every check).
    fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ ledger: 'local', platform: 'github', default_branch: 'main' }));
    const said = [];
    const orig = console.log;
    console.log = (...a) => { said.push(a.join(' ')); };
    let plan;
    try { plan = legacyHookScriptActions(T).map((a) => a.item); } finally { console.log = orig; }
    // No guard is installed with a local ledger, so the advice is to remove the entry, not repoint it (review 4).
    assert.ok(said.some((l) => /hooks\/ledger-guard\.sh stays — .*has no ledger guard .*remove that entry/.test(l)), said.join('\n'));
    assert.ok(!said.some((l) => /ledger-guard\.sh stays — .*node hooks/.test(l)));
    assert.ok(!plan.includes('hooks/ledger-guard.sh (removed)'), plan.join());
    assert.ok(plan.includes('hooks/yad-capture.sh (removed)'), 'capture\'s old entry IS rewritten in both ledger modes');
    // A personal settings file, with a Windows-style path.
    fs.writeFileSync(path.join(T, '.claude/settings.local.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash hooks\\yad-capture.sh' }] }] } }));
    assert.ok(!legacyHookScriptActions(T).some((a) => a.item.startsWith('hooks/yad-capture.sh')));
    // Capture IS installed with a local ledger, so an old capture command of ours is told to repoint, never
    // to be removed (review 5).
    fs.writeFileSync(path.join(T, '.claude/settings.local.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/hooks/yad-capture.sh"' }] }] } }));
    const said2 = [];
    console.log = (...a) => { said2.push(a.join(' ')); };
    try { legacyHookScriptActions(T); } finally { console.log = orig; }
    assert.ok(said2.some((l) => /yad-capture\.sh stays — .*change it to the `node hooks/.test(l)), said2.join('\n'));
    assert.ok(!said2.some((l) => /yad-capture\.sh stays — .*remove th(at|ose) entr/.test(l)));
    // A config that does not read: yad cannot know, and says so.
    fs.writeFileSync(path.join(T, '.sdlc/hub.json'), '{ not json');
    const said3 = [];
    console.log = (...a) => { said3.push(a.join(' ')); };
    try { legacyHookScriptActions(T); } finally { console.log = orig; }
    assert.ok(said3.some((l) => /ledger-guard\.sh stays — .*does not read, so yad cannot tell/.test(l)), said3.join('\n'));
    fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ ledger: 'local', platform: 'github', default_branch: 'main' }));
    fs.writeFileSync(path.join(T, '.claude/settings.local.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash hooks\\yad-capture.sh' }] }] } }));
    await fixHooks(T);
    assert.ok(fs.existsSync(path.join(T, 'hooks/yad-capture.sh')));
    assert.ok(fs.existsSync(path.join(T, 'hooks/ledger-guard.sh')));
    assert.ok(!legacyHookScriptActions(T).some((a) => /ledger-guard\.sh|yad-capture\.sh/.test(a.item)), 'and a second check has nothing pending for them');
  } finally { cleanup(T); }
});

test('E113 review 2: our old command where no action reaches it — another event, a personal file — keeps the script, and is never pending', async () => {
  const { legacyHookScriptActions } = await import('./plan.mjs');
  for (const where of ['Stop in settings.json', 'settings.local.json']) {
    const T = await oldProduct();
    try {
      const entry = { hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/hooks/yad-capture.sh"' }] };
      if (where === 'settings.local.json') {
        fs.writeFileSync(path.join(T, '.claude/settings.local.json'), JSON.stringify({ hooks: { PostToolUse: [entry] } }));
      } else {
        const cfg = JSON.parse(fs.readFileSync(path.join(T, '.claude/settings.json'), 'utf8'));
        cfg.hooks.Stop = [entry];
        fs.writeFileSync(path.join(T, '.claude/settings.json'), JSON.stringify(cfg));
      }
      const said = [];
      const orig = console.log;
      console.log = (...a) => { said.push(a.join(' ')); };
      let planned;
      try { planned = legacyHookScriptActions(T); } finally { console.log = orig; }
      assert.ok(!planned.some((a) => a.item.startsWith('hooks/yad-capture.sh')), `${where}: not planned`);
      // Our own old command, which no action reaches, is stuck: say where, and the way out (review 3).
      assert.ok(said.some((l) => /hooks\/yad-capture\.sh stays — .* still runs it through an old yad hook command; change it to the `node hooks\/….mjs` command/.test(l)), said.join('\n'));
      await fixHooks(T);
      assert.ok(fs.existsSync(path.join(T, 'hooks/yad-capture.sh')), `${where}: kept`);
      assert.ok(!legacyHookScriptActions(T).some((a) => a.item.startsWith('hooks/yad-capture.sh')), `${where}: still not pending after --fix`);
      assert.ok(!fs.existsSync(path.join(T, 'hooks/ledger-guard.sh')), `${where}: an unrelated script still goes`);
    } finally { cleanup(T); }
  }
});

test('E113 review 2: a script waiting only on the commit says so', async () => {
  const { legacyHookScriptActions } = await import('./plan.mjs');
  const T = await oldProduct();
  const g = (...a) => spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', `core.excludesFile=${path.join(T, '.no-global-ignore')}`, ...a], { cwd: T, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const said = [];
  const orig = console.log;
  try {
    g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'old wiring');
    await fixHooks(T);
    console.log = (...a) => { said.push(a.join(' ')); };
    legacyHookScriptActions(T);
    console.log = orig;
    assert.ok(said.some((l) => /hooks\/yad-capture\.sh stays until \.claude\/settings\.json and \.cursor\/hooks\.json are committed as they now stand/.test(l)), said.join('\n'));
  } finally { console.log = orig; cleanup(T); }
});

test('E113 review 4: a removal planned, then run again by the time it applies, is kept with advice that works', async () => {
  const { legacyHookScriptActions } = await import('./plan.mjs');
  const T = await oldProduct();
  try {
    await fixHooks(T);
    fs.writeFileSync(path.join(T, 'hooks/yad-capture.sh'), '#!/usr/bin/env bash\n# yad-capture.sh, as an older yadflow shipped it\n');
    const { MANAGED_LEDGER } = await import('./manifest.mjs');
    const { contentSha } = await import('./lib.mjs');
    const rec = JSON.parse(fs.readFileSync(path.join(T, MANAGED_LEDGER), 'utf8'));
    rec.files['hooks/yad-capture.sh'] = contentSha(path.join(T, 'hooks/yad-capture.sh'));
    fs.writeFileSync(path.join(T, MANAGED_LEDGER), JSON.stringify(rec));
    const [act] = legacyHookScriptActions(T);
    assert.equal(act.item, 'hooks/yad-capture.sh (removed)');
    // Between plan and apply (as `yad setup` can leave it), an entry runs the script again.
    const cfg = JSON.parse(fs.readFileSync(path.join(T, '.cursor/hooks.json'), 'utf8'));
    cfg.hooks.afterFileEdit.push({ command: 'hooks/yad-capture.sh' });
    fs.writeFileSync(path.join(T, '.cursor/hooks.json'), JSON.stringify(cfg));
    const said = [];
    const orig = console.log;
    console.log = (...a) => { said.push(a.join(' ')); };
    try { act.apply(); } finally { console.log = orig; }
    assert.ok(fs.existsSync(path.join(T, 'hooks/yad-capture.sh')), 'kept');
    assert.ok(said.some((l) => /yad-capture\.sh kept — \.cursor\/hooks\.json still runs it; run `yad check --fix`.*change it to the `node hooks/.test(l)), said.join('\n'));
  } finally { cleanup(T); }
});

test('E113 review 1: on Windows doctor names a CRLF checkout, which reads approvals as stale', async () => {
  const { lineEndingChecks } = await import('./doctor.mjs');
  const at = (value, platform = 'win32') => {
    const checks = [];
    lineEndingChecks('/p', checks, { platform, runner: () => ({ ok: value !== null, stdout: value ?? '' }) });
    return checks;
  };
  assert.equal(at('true')[0].status, 'warn');
  assert.match(at('true')[0].hint, /core\.autocrlf input/);
  assert.deepEqual(at('input'), []);
  assert.deepEqual(at(null), [], 'unset');
  assert.deepEqual(at('true', 'linux'), [], 'Windows only');
});

// ---- the Windows-facing CLI --------------------------------------------------------------------------

test('E113: a CRLF checkout of a shipped file is the same content, and an LF file hashes as it always did', async () => {
  const { contentSha, fileSha, sameContent } = await import('./lib.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-crlf-'));
  try {
    fs.writeFileSync(path.join(T, 'lf'), 'a\nb\n');
    fs.writeFileSync(path.join(T, 'crlf'), 'a\r\nb\r\n');
    fs.writeFileSync(path.join(T, 'other'), 'a\nc\n');
    assert.ok(sameContent(path.join(T, 'lf'), path.join(T, 'crlf')));
    assert.ok(!sameContent(path.join(T, 'lf'), path.join(T, 'other')));
    assert.equal(contentSha(path.join(T, 'lf')), fileSha(path.join(T, 'lf')), 'every sha already recorded still matches');
    assert.notEqual(fileSha(path.join(T, 'crlf')), fileSha(path.join(T, 'lf')), 'artifact hashes are untouched: they stay byte-exact');
  } finally { cleanup(T); }
});

test('E113: a wired hook script needs no execute bit to count as installed', async () => {
  const { hookScriptReady } = await import('./plan.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-ready-'));
  try {
    fs.mkdirSync(path.join(T, 'hooks'));
    fs.writeFileSync(path.join(T, 'hooks/ledger-guard.mjs'), '');
    if (!IS_WINDOWS) fs.chmodSync(path.join(T, 'hooks/ledger-guard.mjs'), 0o644);
    assert.ok(hookScriptReady(T, 'hooks/ledger-guard.mjs'));
    assert.ok(!hookScriptReady(T, 'hooks/yad-capture.mjs'));
    fs.mkdirSync(path.join(T, 'hooks/dir.mjs'));
    assert.ok(!hookScriptReady(T, 'hooks/dir.mjs'), 'a directory is not a script');
  } finally { cleanup(T); }
});

test('E113: a harness path in URL form (/c:/…) is read as the Windows path it is', async () => {
  const { windowsPath } = await import('./hook.mjs');
  assert.equal(windowsPath('/c:/Users/ann/p/epics/EP-a/.sdlc/state.json', 'win32'), 'c:/Users/ann/p/epics/EP-a/.sdlc/state.json');
  assert.equal(windowsPath('/C:\\Users\\ann', 'win32'), 'C:\\Users\\ann');
  assert.equal(windowsPath('/c:/Users/ann', 'linux'), '/c:/Users/ann', 'only on Windows');
  assert.equal(windowsPath('/cx/Users', 'win32'), '/cx/Users');
  assert.equal(windowsPath('epics/EP-a/x', 'win32'), 'epics/EP-a/x');
});

test('E113: the ledger guard refuses a CI-owned write sent as a native path of this machine', async () => {
  const { ledgerGuardDecision } = await import('./hook.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-guard-native-'));
  try {
    fs.mkdirSync(path.join(T, '.sdlc'), { recursive: true });
    fs.writeFileSync(path.join(T, '.sdlc/hub.json'), JSON.stringify({ ledger: 'verified', platform: 'github', default_branch: 'main' }));
    fs.mkdirSync(path.join(T, 'epics/EP-a/.sdlc'), { recursive: true });
    const native = path.join(T, 'epics', 'EP-a', '.sdlc', 'state.json');
    // git is stubbed: the base ref holds EP-a's ledger, so this is a mutation.
    const runner = (cmd, args) => (args.includes('ls-tree')
      ? { ok: true, stdout: 'epics/EP-a/.sdlc/state.json\0' }
      : { ok: args.includes('rev-parse'), stdout: '' });
    const v = ledgerGuardDecision([native], { env: {}, runner });
    assert.equal(v.allow, false, JSON.stringify(v));
    assert.equal(v.rel, 'epics/EP-a/.sdlc/state.json', 'the relative path is POSIX whatever the separator');
    if (IS_WINDOWS) {
      const url = `/${native.replace(/\\/g, '/')}`;
      assert.equal(ledgerGuardDecision([url], { env: {}, runner }).allow, false, 'the /c:/ form too');
    }
  } finally { cleanup(T); }
});

test('E113: an npm launcher runs through a shell on Windows, each word quoted, and directly elsewhere', async () => {
  const { launcherInvocation } = await import('./lib.mjs');
  assert.deepEqual(launcherInvocation('npx', ['repomix@latest', '-o', '/a b/out.md'], 'linux'), { cmd: 'npx', args: ['repomix@latest', '-o', '/a b/out.md'], shell: false });
  assert.deepEqual(launcherInvocation('npx', ['repomix@latest', '-o', 'C:\\a b\\out.md'], 'win32'), { cmd: '"npx" "repomix@latest" "-o" "C:\\a b\\out.md"', args: [], shell: true });
  assert.deepEqual(launcherInvocation('npm', ['run', 'build'], 'win32'), { cmd: '"npm" "run" "build"', args: [], shell: true });
  // Both callers go through it — the twin of the repomix fix is `yad docs build`.
  for (const f of ['cli/setup.mjs', 'cli/docs.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /\brun\('np[mx]'/, `${f} spawns an npm launcher directly`);
  }
});

test('E113: doctor finds Git Bash beside git on Windows, and says what its absence costs', async () => {
  const { hasBash, bashMissingHint } = await import('./doctor.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-gitbash-'));
  try {
    fs.mkdirSync(path.join(T, 'Git/cmd'), { recursive: true });
    fs.mkdirSync(path.join(T, 'Git/bin'), { recursive: true });
    const gitExe = path.join(T, 'Git/cmd/git.exe');
    const where = (out) => () => ({ ok: !!out, stdout: out });
    assert.equal(hasBash({ platform: 'win32', env: {}, runner: where(gitExe) }), false, 'no bash.exe yet');
    fs.writeFileSync(path.join(T, 'Git/bin/bash.exe'), '');
    assert.equal(hasBash({ platform: 'win32', env: {}, runner: where(`C:\\elsewhere\\git.exe\r\n${gitExe}`) }), true);
    assert.equal(hasBash({ platform: 'win32', env: {}, runner: where('') }), false, 'no git at all');
    assert.equal(hasBash({ platform: 'win32', env: { CLAUDE_CODE_GIT_BASH_PATH: path.join(T, 'Git/bin/bash.exe') }, runner: where('') }), true);
  } finally { cleanup(T); }
  assert.match(bashMissingHint('win32'), /Git Bash/);
  assert.match(bashMissingHint('win32'), /hooks do not run/);
  assert.match(bashMissingHint('linux'), /your CI runs them/);
});

test('E113: a background capture push never opens a console window on Windows', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'cli/capture.mjs'), 'utf8');
  const detached = [...src.matchAll(/detached: true[^}]*\}/g)].map((m) => m[0]);
  assert.ok(detached.length >= 2, 'the push and the fetch');
  for (const opts of detached) assert.match(opts, /windowsHide: true/, opts);
});
