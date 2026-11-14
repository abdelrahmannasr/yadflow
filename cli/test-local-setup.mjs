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

const { localSetupActions, localSetupDocLines, localSetupState, readSteps, mergeLocalSetup, LOCAL_SETUP_MARKERS } = await import('./local-setup.mjs');
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
    yadflow: [{ id: 'yadflow-cli', title: 't', purpose: 'p', impact: 'i', when: 'required', commands: ['c'], check: { builtin: 'cli-version', min: '999.0.0' } },
      { id: 'now', title: 't', purpose: 'p', impact: 'i', when: 'required', commands: ['c'], check: { builtin: 'cli-version', min: VERSION } }],
    team: [teamStep({ check: { run: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', '')"` } })],
  });
  const st = localSetupState(dir, { items: [] });
  assert.equal(st.committed, false);
  assert.deepEqual(st.steps.map((s) => [s.id, s.state]), [['yadflow-cli', 'pending'], ['now', 'ok'], ['docker', 'ask']]);
  assert.equal(fs.existsSync(marker), false, 'a team check must never run');
});

test('nothing in a step\'s words can end yad\'s block early or break the view', () => {
  const doc = { yadflow: [], team: [teamStep({ title: `x ${LOCAL_SETUP_MARKERS.end}`, purpose: 'a\nnew line --> <!-- y', commands: ['echo `id`'] })] };
  const lines = localSetupDocLines(doc);
  assert.ok(lines.every((l) => !l.includes('-->') && !l.includes('<!--')));
  const once = applyMarkedBlock(null, { ...LOCAL_SETUP_MARKERS, lines });
  const again = applyMarkedBlock(once.text, { ...LOCAL_SETUP_MARKERS, lines });
  assert.equal(again.refused, null);
  assert.equal(again.status, 'ok');
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
  assert.match(yadflowSteps(product())[0].commands[0], new RegExp(`yadflow@${VERSION.replace(/\./g, '\\.')}$`));
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
  assert.ok(after.json.steps.find((s) => s.id === 'yadflow-cli').state === 'ok');
  assert.equal(yad(T, P, ['local-setup', 'nope']).code, 1);
  assert.equal(yad(T, T, ['local-setup']).code, 1, 'no Product here');
});
