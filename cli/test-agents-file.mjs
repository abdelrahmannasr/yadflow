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

// ---- the agent guard (E158) --------------------------------------------------------------------------

const { agentGuardDecision, shellParts } = await import('./agent-guard.mjs');
const { agentGuardActions, orphanAgentGuardActions } = await import('./plan.mjs');
const { AGENT_GUARD_ADAPTERS } = await import('./manifest.mjs');
const { spawnSync } = await import('node:child_process');

test('the agent guard refuses every human-only yad command and every force push, however it is spelled', () => {
  for (const cmd of [
    'yad gate approve EP-a epic --by me',
    'yad gate comment EP-a epic --by me --count 2',
    'yad gate advance EP-a epic',
    'yad gate reopen EP-a epic --reason "why"',
    'yad commit -m "a b" --manual --reason x',
    'cd x && yad gate approve EP-a epic',
    'yad status; yad gate advance EP-a epic',
    'npx -y yadflow@4 gate approve EP-a epic',
    'node ./node_modules/yadflow/bin/yad.mjs gate reopen EP-a epic',
    'YAD_X=1 yad gate approve EP-a epic',
    '/usr/local/bin/yad gate approve EP-a epic',
    'git push --force',
    'git push -f origin main',
    'git push -uf origin main',
    'git push --force-with-lease',
    'git push --force-with-lease=main:abc origin main',
    'git push --force-if-includes origin main',
    'git -C repo push origin +main',
    'git status | cat && git push origin +feat/x',
  ]) assert.equal(agentGuardDecision(cmd).allow, false, cmd);
});

test('the agent guard lets the rest through: reads, the agent\'s own pushes, text that only mentions a command', () => {
  for (const cmd of [
    'yad gate status EP-a',
    'yad guide --json',
    'yad gate open EP-a epic',
    'yad commit -m "fix it"',
    'yad help gate approve',
    'git push origin feat/x',
    'git push -u origin feat/x',
    'echo "yad gate approve EP-a"',
    'grep -n "git push --force" docs/x.md',
    '',
  ]) assert.equal(agentGuardDecision(cmd).allow, true, cmd);
  assert.equal(agentGuardDecision(undefined).allow, true);
  assert.deepEqual(shellParts('a "b c" \'d e\' && f\\ g | h'), [['a', 'b c', 'd e'], ['f g'], ['h']]);
});

test('the refusal says what to do instead: the person runs it', () => {
  const v = agentGuardDecision('yad gate approve EP-a epic');
  assert.match(v.message, /`yad gate approve`/);
  assert.match(v.message, /Ask the person to run it themselves/);
  assert.match(v.message, /`!`/);
});

// The hook script, run as a harness runs it, with this checkout's yad.
function guardScript() {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'hooks'));
  fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skills/yad-checks/templates/hooks/agent-guard.mjs'), path.join(T, 'hooks/agent-guard.mjs'));
  return T;
}
const YAD_MJS = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'yad.mjs');
const runGuard = (T, payload, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(T, 'hooks/agent-guard.mjs')], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', cwd: T,
    env: { ...process.env, YAD_BIN: `"${process.execPath}" "${YAD_MJS}"`, YAD_HOOK_DISABLE: '', ...env }, timeout: 30_000,
  });
  return { code: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
};

test('hooks/agent-guard.mjs: Claude Code reads the exit code, Cursor a JSON verdict, always', () => {
  const T = guardScript();
  try {
    const claude = (command) => runGuard(T, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
    const denied = claude('yad gate approve EP-a epic --by me');
    assert.equal(denied.code, 2);
    assert.match(denied.err, /the person's to run/);
    assert.equal(claude('yad status').code, 0);
    const cursor = (command) => runGuard(T, { hook_event_name: 'beforeShellExecution', command });
    const no = cursor('git push --force');
    assert.equal(no.code, 0);
    assert.equal(JSON.parse(no.out).permission, 'deny');
    assert.match(JSON.parse(no.out).agent_message, /force push/);
    assert.deepEqual(JSON.parse(cursor('ls').out), { permission: 'allow' });
    // Fail-open: an unreadable payload, a switched-off guard, and no yad at all.
    assert.equal(runGuard(T, 'not json').code, 0);
    assert.equal(runGuard(T, { tool_input: { command: 'yad gate advance EP-a epic' } }, { YAD_HOOK_DISABLE: '1' }).code, 0);
    const none = runGuard(T, { hook_event_name: 'beforeShellExecution', command: 'git push -f' }, { YAD_BIN: '', PATH: '' });
    assert.deepEqual(JSON.parse(none.out), { permission: 'allow' });
    assert.match(none.err, /allowing/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('check --fix wires the agent guard on every Product, beside the team\'s own hooks; a target that leaves takes its entry', () => {
  const T = tmp();
  try {
    put(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', default_branch: 'main' }));
    put(path.join(T, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'theirs.sh' }] }] } }));
    const actions = agentGuardActions(T, ['.claude', '.cursor']);
    assert.deepEqual(actions.map((a) => `${a.scope}/${a.item}:${a.status}`), ['product/hooks/agent-guard.mjs:new', '.claude/settings.json:outdated', '.cursor/hooks.json:new']);
    for (const a of actions) a.apply();
    const claude = JSON.parse(read(path.join(T, '.claude/settings.json')));
    const commands = claude.hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(commands.includes('theirs.sh'), 'the team\'s hook is kept');
    assert.ok(commands.includes(AGENT_GUARD_ADAPTERS['.claude'].command));
    const cursor = JSON.parse(read(path.join(T, '.cursor/hooks.json')));
    assert.equal(cursor.hooks.beforeShellExecution[0].command, 'node hooks/agent-guard.mjs');
    assert.ok(fs.existsSync(path.join(T, 'hooks/agent-guard.mjs')));
    assert.ok(agentGuardActions(T, ['.claude', '.cursor']).every((a) => a.status === 'ok'));
    // `.cursor` leaves the targets: its entry comes out, the rest stays.
    const orphans = orphanAgentGuardActions(T, ['.claude']);
    assert.deepEqual(orphans.map((a) => a.scope), ['.cursor']);
    orphans.forEach((a) => a.apply());
    assert.equal(JSON.parse(read(path.join(T, '.cursor/hooks.json'))).hooks?.beforeShellExecution, undefined);
    // No Product: nothing.
    assert.deepEqual(agentGuardActions(tmp(), ['.claude']), []);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- the read-only yad commands, pre-approved for Claude Code (E158, issue #353) ------------------------

const { readAllowList, COMMAND_CLASS, classify } = await import('./agent-rules.mjs');
const { mergeAllowList, allowListActions } = await import('./plan.mjs');

test('the allow list holds only commands that read, whatever flag they are given', () => {
  const list = readAllowList();
  assert.ok(list.length > 20, `${list.length} entries`);
  assert.ok(list.includes('Bash(yad guide:*)') && list.includes('Bash(yad status:*)') && list.includes('Bash(yad gate status:*)'));
  for (const entry of list) {
    const key = entry.match(/^Bash\(yad (.+):\*\)$/)[1];
    const words = key.split(' ');
    // Every flag the command knows, and every command whose words start with these: all reads.
    const flags = Object.keys(COMMAND_CLASS[key].flags ?? {});
    assert.equal(classify(words, flags), 'read', key);
    for (const other of Object.keys(COMMAND_CLASS)) if (other.startsWith(`${key} `)) assert.equal(COMMAND_CLASS[other].class, 'read', `${key} begins ${other}`);
  }
  for (const never of ['gate approve', 'gate advance', 'check', 'update', 'mode', 'dial', 'report', 'checkpoint', 'standup', 'commit', 'gate']) {
    assert.ok(!list.includes(`Bash(yad ${never}:*)`), never);
  }
});

test('the allow list is added beside the team\'s own entries, once; a shape it cannot read is refused', () => {
  const mine = { permissions: { allow: ['Bash(npm test)'], deny: ['Bash(rm:*)'] }, env: { A: '1' } };
  const once = mergeAllowList(mine);
  assert.equal(once.changed, true);
  assert.equal(once.settings.permissions.allow[0], 'Bash(npm test)');
  assert.deepEqual(once.settings.permissions.deny, ['Bash(rm:*)']);
  assert.deepEqual(once.settings.env, { A: '1' });
  assert.equal(mergeAllowList(once.settings).changed, false);
  assert.ok(mergeAllowList({ permissions: [] }).unreadable);
  assert.ok(mergeAllowList({ permissions: { allow: 'x' } }).unreadable);
  const T = tmp();
  try {
    put(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', default_branch: 'main' }));
    assert.deepEqual(allowListActions(T, ['.agents']), [], 'only for Claude Code');
    const [a] = allowListActions(T, ['.claude']);
    assert.equal(a.status, 'new');
    assert.deepEqual(a.paths, [], '--push never stages the team\'s settings');
    a.apply();
    assert.deepEqual(JSON.parse(read(path.join(T, '.claude/settings.json'))).permissions.allow, readAllowList());
    assert.equal(allowListActions(T, ['.claude'])[0].status, 'ok');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- yad report from the agent: --kind, and --post --confirm (E158) ---------------------------------------

const { runReport, confirmHash } = await import('./report.mjs');

test('yad report --kind enhancement: its label, title and body; a bug keeps its error block and command', async () => {
  const quiet = { searcher: () => ({ ok: true, matches: [] }), interactive: false, opener: () => {} };
  const idea = await runReport(tmp(), { ...quiet, message: 'guide could list skipped steps', kind: 'enhancement', argv: ['report', '-m', 'x', '--kind', 'enhancement', '--json'] });
  assert.deepEqual(idea.labels, ['enhancement']);
  assert.equal(idea.title, '[report] Enhancement: guide could list skipped steps');
  assert.match(idea.body, /### What would help\?/);
  assert.doesNotMatch(idea.body, /### Error|Command:/);
  assert.equal(idea.confirm, confirmHash(idea));
  const bug = await runReport(tmp(), { ...quiet, message: 'it broke', error: Object.assign(new Error('boom'), { code: 'YAD-CLI-001' }), argv: ['report', '-m', 'x', '--json'] });
  assert.deepEqual(bug.labels, ['bug']);
  assert.match(bug.body, /### Error/);
  assert.match(bug.body, /Command: `yad report -m`/, 'the report\'s own flags never reach the posted command line');
});

test('yad report --post posts only the text the preview showed: a matching --confirm posts it, anything else posts nothing', async () => {
  const D = tmp();
  try {
    const posted = [];
    const seams = { searcher: () => ({ ok: true, matches: [] }), interactive: false, opener: () => {}, authed: () => true, filer: (p, repo, payload) => { posted.push(payload); return { ok: true, url: 'https://github.com/x/y/issues/9' }; } };
    const preview = await runReport(D, { ...seams, message: 'an idea', kind: 'enhancement', argv: ['report', '-m', 'an idea', '--kind', 'enhancement', '--json'] });
    assert.equal(preview.filed, false);
    assert.equal(posted.length, 0, '--json never posts');
    const postArgv = ['report', '-m', 'an idea', '--kind', 'enhancement', '--post', '--confirm', preview.confirm];
    for (const confirm of ['0'.repeat(64), null]) {
      const r = await runReport(D, { ...seams, message: 'an idea', kind: 'enhancement', post: true, confirm, argv: postArgv });
      assert.equal(r.refused, 'confirm-mismatch');
      assert.equal(posted.length, 0, `confirm ${confirm} posts nothing`);
    }
    // The text changed since the preview (another summary): refused.
    const other = await runReport(D, { ...seams, message: 'another idea', kind: 'enhancement', post: true, confirm: preview.confirm, argv: postArgv });
    assert.equal(other.refused, 'confirm-mismatch');
    assert.equal(posted.length, 0);
    const r = await runReport(D, { ...seams, message: 'an idea', kind: 'enhancement', post: true, confirm: preview.confirm, argv: postArgv });
    assert.equal(r.filed, true);
    assert.deepEqual(posted, [{ title: preview.title, body: preview.body, labels: preview.labels }]);
    // No gh login: the prefilled link, nothing posted, no browser opened.
    let opened = 0;
    const link = await runReport(D, { ...seams, authed: () => false, opener: () => { opened++; }, message: 'an idea', kind: 'enhancement', post: true, confirm: preview.confirm, argv: postArgv });
    assert.equal(link.filed, false);
    assert.match(link.url, /issues\/new/);
    assert.equal(opened, 0);
    assert.equal(posted.length, 1);
  } finally { fs.rmSync(D, { recursive: true, force: true }); process.exitCode = 0; }
});

test('yad report refuses --post without --confirm, --confirm without --post, and an unknown --kind', () => {
  const YAD = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'yad.mjs');
  const env = { ...process.env, YAD_NO_REPORT: '1', SDLC_NONINTERACTIVE: '1' };
  for (const [args, re] of [
    [['report', '-m', 'x', '--post'], /needs --confirm/],
    [['report', '-m', 'x', '--confirm', 'abc'], /--confirm is for --post/],
    [['report', '-m', 'x', '--kind', 'feature'], /--kind takes bug or enhancement/],
  ]) {
    const r = spawnSync(process.execPath, [YAD, ...args, '--json'], { encoding: 'utf8', env, cwd: os.tmpdir(), timeout: 30_000 });
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stdout + r.stderr, re, args.join(' '));
  }
});

// ---- the yad-guide skill (E158) ------------------------------------------------------------------------

const REPO = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const { SKILLS } = await import('./manifest.mjs');
const { syncGuideSkill, GUIDE_SECTIONS } = await import('./agent-guide.mjs');

test('the yad-guide skill is shipped, and its generated sections agree with the rules (scripts/agent-guide.mjs --check)', () => {
  assert.ok(SKILLS.includes('yad-guide'));
  const file = path.join(REPO, 'skills/yad-guide/SKILL.md');
  const r = syncGuideSkill(file, { check: true });
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.stale, [], 'run `node scripts/agent-guide.mjs`');
  const text = read(file);
  for (const name of GUIDE_SECTIONS) assert.ok(text.includes(`<!-- end: ${name} -->`), name);
  for (const c of humanOnlyCommands()) assert.ok(text.includes(`\`${c}\``), c);
  for (const n of NEVER) assert.ok(text.includes(n.text), n.id);
  const cli = spawnSync(process.execPath, [path.join(REPO, 'scripts/agent-guide.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  // A stale section is found, and missing markers are refused rather than guessed.
  const T = tmp();
  try {
    put(path.join(T, 'SKILL.md'), text.replace(NEVER[0].text, 'something else'));
    assert.deepEqual(syncGuideSkill(path.join(T, 'SKILL.md'), { check: true }).stale, ['never']);
    put(path.join(T, 'SKILL.md'), text.replace('<!-- end: rules -->', ''));
    assert.equal(syncGuideSkill(path.join(T, 'SKILL.md'), { check: true }).refused.length, 1);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('every skill\'s description fits the 1,024 characters an agent harness reads', () => {
  for (const skill of fs.readdirSync(path.join(REPO, 'skills'))) {
    const file = path.join(REPO, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const m = read(file).match(/^description:\s*(.*)$/m);
    if (!m) continue;
    let v = m[1].trim();
    if (v.startsWith('\'')) v = v.slice(1, -1).replace(/''/g, '\'');
    else if (v.startsWith('"')) v = JSON.parse(v);
    assert.ok(v.length <= 1024, `${skill}: ${v.length} characters`);
  }
});

test('no skill tells the agent to run a human-only command: only the person runs it', () => {
  const human = humanOnlyCommands().map((c) => c.replace(/^yad /, ''));
  const bad = [];
  for (const skill of fs.readdirSync(path.join(REPO, 'skills'))) {
    const file = path.join(REPO, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    read(file).split('\n').forEach((line, i) => {
      for (const c of human) {
        const [words, flag] = c.split(' --');
        const run = new RegExp(`\\b[Rr]uns? \`yad ${words}${flag ? `[^\`]*--${flag}` : ''}\\b`);
        if (run.test(line) && !/person/.test(line)) bad.push(`skills/${skill}/SKILL.md:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(bad, []);
  // The review gate hands its human-only commands over, and says how to confirm them.
  const gate = read(path.join(REPO, 'skills/yad-review-gate/SKILL.md'));
  assert.match(gate, /are the person's to run, never yours \(E158\)/);
  assert.match(gate, /yad gate status <epic>/);
  assert.match(read(path.join(REPO, 'skills/yad-commit/SKILL.md')), /Never pass `--manual` yourself, even when asked/);
});
