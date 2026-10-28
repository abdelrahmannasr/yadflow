// The rules block in AGENTS.md and CLAUDE.md (E158). The rules each test pins:
//   - only the lines between yad's markers are written; the team's text around them is kept byte for byte;
//   - a block that is not there is appended; markers yad cannot trust are never guessed around;
//   - Windows line endings are kept;
//   - CLAUDE.md (importing AGENTS.md) only for a project that installs for Claude Code;
//   - a connected code repo gets the short block, the Product the full one;
//   - `yad update --push` never stages the files: they are the team's;
//   - `yad doctor` says when the block is missing, older, or cannot be written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

const { applyMarkedBlock } = await import('./marked-block.mjs');
const { AGENTS_MARKERS, agentsBlock, pointerBlock, claudeBlock, RULES, HUMAN_ONLY_ACTS, NEVER, humanOnlyCommands } = await import('./agent-rules.mjs');
const { agentFileActions, agentFilesState, repoActions } = await import('./plan.mjs');
const { agentFileChecks } = await import('./doctor.mjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yad-agents-'));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const read = (file) => fs.readFileSync(file, 'utf8');
const opts = (lines = ['line one', 'line two']) => ({ ...AGENTS_MARKERS, lines });

test('a block not there is appended after the team\'s text, which is kept byte for byte', () => {
  for (const team of ['# Team\n\nOur notes.\n', '# Team\nno newline at the end', '# Team\n\n\n']) {
    const r = applyMarkedBlock(team, opts());
    assert.equal(r.status, 'new');
    assert.ok(r.text.startsWith(team), JSON.stringify(r.text));
    assert.ok(r.text.endsWith(`${AGENTS_MARKERS.begin}\nline one\nline two\n${AGENTS_MARKERS.end}\n`));
  }
  const fresh = applyMarkedBlock(null, opts());
  assert.equal(fresh.status, 'new');
  assert.equal(fresh.text, `${AGENTS_MARKERS.begin}\nline one\nline two\n${AGENTS_MARKERS.end}\n`);
});

test('the block is rewritten in place, text on both sides kept; a second run changes nothing', () => {
  const before = `# Team\n\n${AGENTS_MARKERS.begin}\nold line\n${AGENTS_MARKERS.end}\n\n## After\nkeep me\n`;
  const r = applyMarkedBlock(before, opts());
  assert.equal(r.status, 'outdated');
  assert.equal(r.text, `# Team\n\n${AGENTS_MARKERS.begin}\nline one\nline two\n${AGENTS_MARKERS.end}\n\n## After\nkeep me\n`);
  const again = applyMarkedBlock(r.text, opts());
  assert.equal(again.status, 'ok');
  assert.equal(again.text, r.text);
});

test('a begin marker with an older note is still yad\'s block', () => {
  const before = `<!-- yadflow:begin — an older note -->\nold\n${AGENTS_MARKERS.end}\n`;
  const r = applyMarkedBlock(before, opts());
  assert.equal(r.status, 'outdated');
  assert.ok(r.text.startsWith(AGENTS_MARKERS.begin));
});

test('markers yad cannot trust are refused, and the text is returned as it is', () => {
  const { begin, end } = AGENTS_MARKERS;
  for (const bad of [`${begin}\nno end\n`, `${end}\n${begin}\n`, `${begin}\n${end}\n${begin}\n${end}\n`, `team\n${end}\n`]) {
    const r = applyMarkedBlock(bad, opts());
    assert.ok(r.refused, bad);
    assert.equal(r.text, bad);
  }
});

test('Windows line endings are kept, and only the content counts as a change', () => {
  const before = `# Team\r\n\r\n${AGENTS_MARKERS.begin}\r\nline one\r\nline two\r\n${AGENTS_MARKERS.end}\r\n`;
  assert.equal(applyMarkedBlock(before, opts()).status, 'ok');
  const r = applyMarkedBlock('# Team\r\n', opts());
  assert.equal(r.text, `# Team\r\n\r\n${AGENTS_MARKERS.begin}\r\nline one\r\nline two\r\n${AGENTS_MARKERS.end}\r\n`);
});

test('the Product block carries every rule, every human-only command and act, and what is never done', () => {
  const text = agentsBlock().join('\n');
  for (const r of RULES) assert.ok(text.includes(r.text), r.id);
  for (const a of HUMAN_ONLY_ACTS) assert.ok(text.includes(a.text), a.id);
  for (const n of NEVER) assert.ok(text.includes(n.text), n.id);
  const cmds = humanOnlyCommands();
  for (const c of ['yad gate approve', 'yad gate advance', 'yad gate reopen', 'yad gate comment', 'yad commit --manual']) assert.ok(cmds.includes(c), c);
  for (const c of cmds) assert.ok(text.includes(`\`${c}\``), c);
  assert.match(text, /yad-guide/);
  // The code repo's short block names no path: clones are laid out differently on each machine.
  const pointer = pointerBlock().join('\n');
  assert.match(pointer, /yad guide --json/);
  assert.doesNotMatch(pointer, /\.\.\//);
  assert.deepEqual(claudeBlock(), ['@AGENTS.md']);
});

test('check --fix writes AGENTS.md and CLAUDE.md for Claude Code, AGENTS.md alone otherwise; files are never staged', () => {
  const T = tmp();
  try {
    put(path.join(T, 'AGENTS.md'), '# Our team rules\n');
    const both = agentFileActions(T, ['.claude', '.agents']);
    assert.deepEqual(both.map((a) => [a.item, a.status]), [['AGENTS.md', 'outdated'], ['CLAUDE.md', 'new']]);
    for (const a of both) assert.deepEqual(a.paths, [], `${a.item}: --push never stages it`);
    for (const a of both) a.apply();
    assert.ok(read(path.join(T, 'AGENTS.md')).startsWith('# Our team rules\n\n'));
    assert.match(read(path.join(T, 'CLAUDE.md')), /^<!-- yadflow:begin[^\n]*\n@AGENTS\.md\n<!-- yadflow:end -->\n$/);
    assert.deepEqual(agentFileActions(T, ['.claude']).map((a) => a.status), ['ok', 'ok']);
    assert.deepEqual(agentFileActions(T, ['.agents']).map((a) => a.item), ['AGENTS.md']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('broken markers and a file that is not a plain file are left alone', () => {
  const T = tmp();
  try {
    const broken = `${AGENTS_MARKERS.begin}\nno end\n`;
    put(path.join(T, 'AGENTS.md'), broken);
    const [a] = agentFileActions(T, ['.agents']);
    assert.equal(a.status, 'modified');
    a.apply();
    assert.equal(read(path.join(T, 'AGENTS.md')), broken);
    if (process.platform !== 'win32') {
      const U = tmp();
      try {
        put(path.join(U, 'elsewhere.md'), 'theirs\n');
        fs.symlinkSync(path.join(U, 'elsewhere.md'), path.join(T, 'CLAUDE.md'));
        const claude = agentFileActions(T, ['.claude']).find((x) => x.item === 'CLAUDE.md');
        assert.equal(claude.status, 'modified');
        claude.apply();
        assert.equal(read(path.join(U, 'elsewhere.md')), 'theirs\n', 'never written through a link');
      } finally { fs.rmSync(U, { recursive: true, force: true }); }
    }
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a connected code repo cloned here gets the short block; one not cloned, or the Product itself, does not', () => {
  const T = tmp();
  try {
    const P = path.join(T, 'product');
    const R = path.join(T, 'api');
    fs.mkdirSync(P); fs.mkdirSync(R);
    put(path.join(P, '.sdlc/cli-version.json'), JSON.stringify({ version: '4.7.0', ideTargets: ['.claude'] }));
    const items = (repo) => repoActions(P, repo).filter((a) => a.kind === 'text').map((a) => `${a.scope}/${a.item}`);
    assert.deepEqual(items({ name: 'api', path: '../api', platform: 'github' }), ['api/AGENTS.md', 'api/CLAUDE.md']);
    assert.deepEqual(items({ name: 'web', path: '../web', platform: 'github' }), []);
    assert.deepEqual(items({ name: 'product', path: '.', platform: 'github' }), []);
    const a = repoActions(P, { name: 'api', path: '../api', platform: 'github' }).find((x) => x.item === 'AGENTS.md');
    a.apply();
    assert.ok(read(path.join(R, 'AGENTS.md')).includes(pointerBlock()[0]));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad doctor names a missing, older or unwritable rules block, and passes a current one', () => {
  const T = tmp();
  try {
    put(path.join(T, '.sdlc/cli-version.json'), JSON.stringify({ version: '4.7.0', ideTargets: ['.agents'] }));
    const run = () => { const checks = []; agentFileChecks(checks, T); return checks[0]; };
    assert.match(run().message, /AGENTS\.md is missing/);
    put(path.join(T, 'AGENTS.md'), '# Team\n');
    assert.match(run().message, /has no yadflow rules block/);
    put(path.join(T, 'AGENTS.md'), `${AGENTS_MARKERS.begin}\nold\n${AGENTS_MARKERS.end}\n`);
    assert.match(run().message, /has an older yadflow rules block/);
    assert.equal(run().status, 'warn');
    put(path.join(T, 'AGENTS.md'), `${AGENTS_MARKERS.begin}\nold\n`);
    assert.match(run().message, /needs exactly one line/);
    agentFileActions(T, ['.agents']).forEach((a) => a.apply());
    put(path.join(T, 'AGENTS.md'), applyMarkedBlock('# Team\n', { ...AGENTS_MARKERS, lines: agentsBlock() }).text);
    assert.equal(run().status, 'ok');
    assert.deepEqual(agentFilesState(T, ['.agents']).map((f) => f.state), ['ok']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad update brings the block to an install that predates it, beside the team\'s text', async () => {
  const { reconcile } = await import('./reconcile.mjs');
  const T = tmp();
  const git = (args) => execFileSync('git', args, { cwd: T, stdio: 'pipe' }).toString().trim();
  try {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', 'Alice Smith']); git(['config', 'user.email', 'alice@work.com']); git(['config', 'commit.gpgsign', 'false']);
    put(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', git_url: 'git@github.com:acme/product.git', default_branch: 'main' }));
    put(path.join(T, '.sdlc/cli-version.json'), JSON.stringify({ version: '4.0.0', ideTargets: ['.claude'] }));
    put(path.join(T, 'AGENTS.md'), '# Team\n');
    git(['add', '-A']); git(['commit', '-q', '-m', 'chore: start']);
    const r = await reconcile(T, { fix: true, scope: 'changed' });
    assert.ok(r.items.some((i) => i.item === 'AGENTS.md' && i.status === 'outdated'), JSON.stringify(r.items));
    assert.ok(r.items.some((i) => i.item === 'CLAUDE.md' && i.status === 'new'), JSON.stringify(r.items));
    assert.ok(read(path.join(T, 'AGENTS.md')).includes(AGENTS_MARKERS.end));
    assert.ok(fs.existsSync(path.join(T, 'CLAUDE.md')));
  } finally { fs.rmSync(T, { recursive: true, force: true }); process.exitCode = 0; }
});
