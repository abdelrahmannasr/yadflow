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

test('mixed line endings outside the block are kept byte for byte', () => {
  const { begin, end } = AGENTS_MARKERS;
  const before = `a\r\nb\n${begin}\nold\n${end}\nc\r\n`;
  assert.equal(applyMarkedBlock(before, opts()).text, `a\r\nb\n${begin}\nline one\nline two\n${end}\nc\r\n`);
  const last = `${begin}\r\nold\r\n${end}`;
  assert.equal(applyMarkedBlock(last, opts()).text, `${begin}\r\nline one\r\nline two\r\n${end}`);
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
    assert.deepEqual(both.map((a) => [a.item, a.status]), [['AGENTS.md', 'new'], ['CLAUDE.md', 'new']]);
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
    assert.equal(a.writesNothing, true, 'never applied, so no run says it was fixed');
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
    // On a repo yad has not wired, it stays `missing`: `yad update` never does a repo's one-time setup.
    assert.ok(repoActions(P, { name: 'api', path: '../api', platform: 'github' }).filter((a) => a.kind === 'text').every((a) => a.status === 'missing'));
    assert.deepEqual(items({ name: 'web', path: '../web', platform: 'github' }), []);
    assert.deepEqual(items({ name: 'product', path: '.', platform: 'github' }), []);
    // Review 3: the team's own AGENTS.md there, with no block, is `missing` too, so `yad update` leaves it.
    put(path.join(R, 'AGENTS.md'), '# Team notes\n');
    const team = repoActions(P, { name: 'api', path: '../api', platform: 'github' }).find((x) => x.item === 'AGENTS.md');
    assert.equal(team.status, 'missing');
    // On a wired repo the block is `new`, and update adds it.
    put(path.join(R, 'checks/spec-link.sh'), '#!/usr/bin/env bash\n');
    assert.equal(repoActions(P, { name: 'api', path: '../api', platform: 'github' }).find((x) => x.item === 'AGENTS.md').status, 'new');
    team.apply();
    assert.ok(read(path.join(R, 'AGENTS.md')).startsWith('# Team notes\n'));
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

test('--overwrite-local never says it fixed a rules block it could not write', async () => {
  const { reconcile } = await import('./reconcile.mjs');
  const T = tmp();
  const said = [];
  const orig = { log: console.log, error: console.error };
  try {
    put(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', default_branch: 'main' }));
    put(path.join(T, '.sdlc/cli-version.json'), JSON.stringify({ version: '4.0.0', ideTargets: ['.agents'] }));
    const broken = `${AGENTS_MARKERS.begin}\nno end\n`;
    put(path.join(T, 'AGENTS.md'), broken);
    console.log = (...a) => said.push(a.join(' '));
    console.error = (...a) => said.push(a.join(' '));
    await reconcile(T, { fix: true, overwriteLocal: true });
    Object.assign(console, orig);
    assert.equal(read(path.join(T, 'AGENTS.md')), broken);
    const text = said.join('\n');
    assert.doesNotMatch(text, /fixed: [^\n]*AGENTS\.md/);
    assert.doesNotMatch(text, /AGENTS\.md is locally modified/);
    assert.match(text, /AGENTS\.md: the yadflow block needs exactly one line/);
  } finally { Object.assign(console, orig); fs.rmSync(T, { recursive: true, force: true }); process.exitCode = 0; }
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
    assert.ok(r.items.some((i) => i.item === 'AGENTS.md' && i.status === 'new'), JSON.stringify(r.items));
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
    // Review 1: yad's flags anywhere, a joined line, other plain spellings, and the platform's own approve and merge.
    'yad --dir ../product gate approve EP-x epic',
    'yad --json gate advance EP-x epic',
    'yad -m s commit --manual --reason r',
    'yad gate approve \\\nEP-x epic',
    'yad \\\n  gate reopen EP-x epic',
    './bin/yad.mjs gate approve EP-x epic',
    'timeout 30 yad gate approve EP-x epic',
    'npm exec yadflow -- gate approve EP-x epic',
    'git --git-dir .git push -f',
    'gh pr review 5 --approve',
    'gh pr review 5 -a -b ok',
    'gh pr merge 5 --squash',
    'glab mr approve 3',
    'glab mr merge 3',
    'cat <<EOF > notes.md\nsome text\nEOF\nyad gate approve EP-x epic',
    // Review 2: a here-string, a shift, an unclosed heredoc, CRLF, a comment, prefixes with options, shells.
    'cat <<< "x"\nyad gate approve EP-x epic',
    'echo $((1<<2))\nyad gate approve EP-x epic',
    'cat <<EOF\r\nx\r\nEOF\r\nyad gate approve EP-x epic',
    // #492: the reader splits as bash and zsh do. A CR is a word character (so `x\r#` holds no comment), a heredoc's
    // end word is every character the shell reads as one word and its end line must match exactly, `(` and `)`
    // end a part, and a command nested past three levels is refused.
    'x\r#; gh pr merge 5', 'x\r#; yad gate approve EP-x epic', 'cat <<EOF#;gh pr merge 5\nbody\nEOF#\n', 'cat <<EOF#;git push --force\nb\nEOF#',
    'cat <<EOF+\nEOF\ncat <<X\nEOF+\ngh pr merge 5\nX\n', 'cat <<EOF\nEOF\r\ncat <<X\nEOF\ngh pr merge 5\nX\n', 'cat <<EOF\r\nEOF\ncat <<X\nEOF\r\ngh pr merge 5\nX\n',
    'cat <(gh pr merge 5)', 'echo x > >(gh pr merge 5)', 'f(){ gh pr merge 5; }; f', 'case x in x) gh pr merge 5;; esac', '(gh pr merge 5)',
    'echo $(echo $(echo $(echo $(gh pr merge 5))))', 'echo $(echo $(echo $(echo $(echo hi))))', "bash -c 'bash -c \"bash -c \\\"bash -c ls\\\"\"'",
    'git push --force\r', 'git push \\\r\n--force',
    // #492 review: a `\`-newline join hiding a `$(` or splitting an end word; an end word holding `$` (the outer
    // shell expands it first); and a heredoc that never ends, whose `$(…)` the shell still runs.
    'echo "$\\\r\n(gh pr merge 5)"', 'cat <<EOF\r\n$\\\r\n(npx yadflow gate advance EP-x)\nEOF\r\n', 'echo "$\\\n(gh pr merge 5)"', 'cat <<EOF\n$\\\n(gh pr merge 5)\nEOF',
    'cat <<EOF\nx\nEO\\\nF\ngh pr merge 5\nEOF\n', 'bash -c "cat <<EOF$x\nEOF\ngh pr merge 5\nEOF$x"', 'bash -lc "cat <<E$F\nE$Fx\ngh pr merge 5\nE$F\n"',
    'cat <<< "x"\ncat <<EOF+\nbody\nEOF#\ncat <<\'EOF\'\n$(git push --force)\nEOF\n\n', "cat <<X\ncat <<'EOF'\n$(gh pr merge 5)\nEOF", "cat <<X\necho '$(gh pr merge 5)'",
    // #492 review 2: an expanding end word is still a redirect, read past; a `#` right after `(` or `)` starts no comment.
    '<<"E$x" gh pr merge 1', 'echo hi; <<"E$x" gh pr merge 1', "<<'E`x`' yad gate approve EP-a", '<<E$x gh pr merge 1', 'x=1 <<E$x gh pr merge 1',
    '[[ a =~ (#|$(gh pr merge 1)) ]]', '[[ a =~ (#|`gh pr merge 1`) ]]', '[[ a =~ (x)#$(gh pr merge 1) ]]', 'shopt -s extglob\necho @(#$(gh pr merge 1))',
    'echo foo(#$(gh pr merge 1))', 'ls foo(#q$(gh pr merge 1))', 'A((#$(gh pr merge 1)', '<<<((###;gh pr merge 1',
    // #492 review 3: every reading the shells may make — an expanding end word as a heredoc, as none, and line by
    // line (its value is unknown); a `#` after a parenthesis as a comment (command position) and as text.
    'cat <<"E$x"\n\'\nE$x\ngh pr merge 1', "cat <<'E$x'\n'\nE$x\ngh pr merge 1", 'cat <<"E$x"\n"\nE$x\ngh pr merge 1', 'bash -c "cat <<E$x\n\'\nE\ngh pr merge 1"',
    'x=F; bash -c "cat <<E$x\n\'\nEF\ngh pr merge 1"', "cat <<E$x\nit's a note\nE$x\ngh pr merge 1",
    "(cd web && npm ci)# don't skip\ngh pr merge 1", "(true)# x '\ngh pr merge 1", "(# '\ngh pr merge 1\n)", "if (true)# '\nthen gh pr merge 1; fi",
    "x=(# '\n$(gh pr merge 1)\n)", "f()# '\n{ gh pr merge 1; }; f", "()# x '\ngh pr merge 1", "x=(a b)# don't\ngh pr merge 1",
    // A body of many `$(` overflowed the stack (the hook then exited 1, which lets the command run).
    `cat <<E >/dev/null\n${'$((1))\n'.repeat(130000)}$(gh pr merge 1)\n`, `cat <<E >/dev/null\n${'$((1))'.repeat(130000)}\nE\ngh pr merge 1\n`,
    // #495: redirects in the middle of a command, $'…' strings, options after bash -c, more prefixes, commands
    // that carry a command, an expanding command word, a shell fed its script, case inside $(…), # after |.
    'git push origin main 2>&1 --force', 'git commit -m x 2>&1 --no-verify', '>out gh pr merge 5', 'gh >x pr merge 5', 'x=<<<1 git commit --no-verify -m x',
    'git push --force>/dev/null', 'yad gate approve> EP-x epic', "git commit -m $'fix: don\\'t\\n' && gh pr merge 5 && echo 'done'", "bash -c $'gh pr merge 5'",
    'bash -c $"gh pr merge 5"', 'bash -c -- "gh pr merge 5"', 'bash -c -x "gh pr merge 5"', 'bash -c -o pipefail "gh pr merge 5"', 'env -S "gh pr merge 5"',
    'env --split-string="gh pr merge 5"', 'exec -a x gh pr merge 5', 'builtin command gh pr merge 5', 'function f { gh pr merge 5; }; f', 'coproc gh pr merge 5',
    'coproc c { gh pr merge 5; }', 'find . -exec gh pr merge 5 \\;', 'find . -execdir git push --force {} +', "git -c alias.p='push --force' p", "git -c alias.m='!gh pr merge 5' m",
    'noglob gh pr merge 5', '{gh pr merge 5;}', 'eval "gh pr merge 5"', 'eval gh pr merge 5', 'echo "gh pr merge 5" | bash', "printf 'gh pr merge 5' | sh",
    '$(echo gh) pr merge 5', '${x:-gh} pr merge 5', '{gh,} pr merge 5', '$CMD pr merge 5', 'echo $(case x in x) gh pr merge 5;; esac)', '[[ a =~ x|#$(gh pr merge 1) ]]',
    'bash <<EOF\ngh pr merge 5\nEOF', "sh <<'EOF'\ngit push --force\nEOF", 'bash <<< "gh pr merge 5"',
    // #495 review: zsh's numeric globs are one word (both readings); and the gaps of the same kinds.
    'git push origin main <-> --force', 'git push <1-9> --force', 'git commit -m x <-> --no-verify', 'git commit -am x <1-3000> -n', 'gh pr review >> 5 <1-9> --approve',
    'bash -c - "gh pr merge 5"', '$SUDO gh pr merge 5', '${DRY} git push --force', '$X yad gate approve EP-x epic', '$SHELL -c "gh pr merge 5"', '$(which bash) -c "gh pr merge 5"',
    '{bash,} -c "gh pr merge 5"', "find . -exec sh -c 'git push --force' {} +", 'env -u X -S "gh pr merge 5"', 'env -C . -S "gh pr merge 5"', "printf '%s\\n' 'gh pr merge 5' | bash",
    'printf "%s" "gh pr merge 5" | bash', 'echo gh pr merge 5 | tee /dev/null | bash', "cat <<'EOF' | bash\ngh pr merge 5\nEOF", 'source /dev/stdin <<< "gh pr merge 5"',
    '. /dev/stdin <<< "gh pr merge 5"', 'git push origin main --{force,}', 'gh pr {merge,} 5', 'git commit -m x --no-{verify,}', '=gh pr merge 5', "git -c alias.a=b -c alias.b='push --force' a",
    // #495 review 2: a shell reads its input after -s, from /dev/stdin, past --rcfile; a brace list expands into words.
    "echo 'gh pr merge 5' | bash -s foo", "bash -s foo <<'EOF'\ngit push --force origin main\nEOF", "echo 'yad gate approve EP-x analysis' | bash /dev/stdin",
    "bash /dev/stdin <<< 'gh pr review 5 --approve'", "zsh /dev/stdin <<< 'git commit -n -m x'", "sh /dev/fd/0 <<'EOF'\nglab mr merge 5\nEOF", "echo 'gh pr merge 5' | bash --rcfile /dev/null",
    "echo 'gh pr merge 5' | bash -xs foo", "echo 'gh pr merge 5' | ksh -s a", "cat <<'EOF' | bash -s x\ngh pr merge 5\nEOF", 'gh {pr,merge} 5', '{gh,pr} merge 5', 'git {push,--force} origin main',
    'git {commit,-n} -m x', 'yad {gate,approve} EP-x analysis', 'gh {pr,review} 5 --approve', 'git push origin main {x,--fo}{rce,y}', 'git push origin {a,{--force,b}}', 'git push -{f..f} origin main',
    'git push origin {main,main,main,main,main,main,main,main,--force}',
    // #495 review 3: empty alternatives (bash drops the empty words); option clusters with o; zsh --emulate; a brace
    // list or an expansion in a shell's words; zsh's one-character sequences.
    'gh pr {,merge} 5', 'gh {,pr} merge 5', "bash -c 'gh pr {,merge} 5'", 'echo {,}; gh pr {,,merge} 5', 'gh pr {,{,{merge,x}}} 5',
    "bash -euo pipefail <<'EOF'\ngh pr merge 5\nEOF", "echo 'gh pr merge 5' | bash -eo pipefail", "zsh --emulate sh <<< 'gh pr merge 5'", "echo 'gh pr merge 5' | bash {-s,}",
    "{bash,} <<< 'gh pr merge 5'", "echo 'gh pr merge 5' | $SHELL", "${SHELL:-bash} <<< 'gh pr merge 5'", "echo 'gh pr merge 5' | bash $NOPE", 'git push origin {+..+}main',
    'git push origin main -{-..-}force',
    // #495 review 4: text printed in a group or a file reaches a real shell; `\||` is a pipe; quoted brace characters are text.
    "{ echo 'gh pr merge 5'; } | bash", "{ echo 'gh pr merge 5'; } 2>&1 | bash", "(echo 'gh pr merge 5'; true) | bash", "if true; then echo 'gh pr merge 5'; fi | bash",
    "for i in 1; do echo 'gh pr merge 5'; done | bash", "case x in x) echo 'gh pr merge 5';; esac | bash", "{ cat <<'E'; } | bash\ngh pr merge 5\nE", "f() { echo 'gh pr merge 5'; }; f | bash",
    "echo 'gh pr merge 5' > f; bash < f", "echo 'gh pr merge 5 #' \\||bash", "git commit -m {'}',-n}", "git commit -m {'{',-n}", 'git commit -m {"}",--no-verify}', "git commit {-n,'{'} -m x",
    // A typed shield character stays inert, in a carried command too.
    'bash -c "gh pr {merge,} 5"', "eval 'gh pr {merge,} 5'", "echo 'gh pr {merge,} 5' | bash", "bash -c 'git push {--force,}'", "bash -c 'git commit {-n,} -m x'",
    // A word too long to expand, or too many words, is refused rather than expanded: a 1 MB JSON word crashed the heap.
    `echo x${'{'.repeat(200000)}a,b${'}'.repeat(200000)}; gh pr merge 5`, `echo ${'{a,b}'.repeat(190000)}; gh pr merge 5`,
    // E167 review 5: a CRLF heredoc ends at `EOF\r`, as the shell's end word is `EOF\r`; a later plain EOF is not its end.
    'cat <<EOF\r\nb\r\nEOF\r\ngh pr merge 5\nEOF\n', "cat <<'EOF'\r\nb\r\nEOF\r\ngh pr merge 5\nEOF\n",
    // E167 review 4: \ + CR + LF does not join lines in bash or zsh.
    'git log \\\r\ngh pr merge 5', 'git status \\\r\ngit push --force', 'git log \\\r\ngit commit --no-verify -m x',
    // ... and a join to a shell that drops CRs (Git Bash with igncr): refused under either reading.
    'git push \\\r\n--force', 'git push \\\r\n-f', 'yad gate \\\r\napprove EP-x epic', 'gh pr \\\r\nmerge 5',
    // ... also inside a bash -c string built from quoted pieces.
    "bash -c 'git push \\'\"\r\n\"'--force'", "bash -c 'git push \\''\r\n--force'",
    '# <<x\nyad gate approve EP-x epic',
    'env -i yad gate approve EP-x epic',
    'sudo -u me yad gate approve EP-x epic',
    'nice -n 5 yad gate approve EP-x epic',
    'time -p yad gate approve EP-x epic',
    'npx -p yadflow yad gate approve EP-x epic',
    'node -r ./x.js bin/yad.mjs gate approve EP-x epic',
    '(yad gate approve EP-x epic)',
    '{ yad gate approve EP-x epic; }',
    'if true; then yad gate approve EP-x epic; fi',
    'bash -c "yad gate approve EP-x epic"',
    'gh -R o/r pr merge 5',
    'glab -R g/p mr merge 1',
    // Review 3: a command substitution runs its command; the package runners run yadflow's own `yad`.
    'r=$(yad gate approve EP-x epic --json)',
    'echo `yad gate approve EP-x epic`',
    'echo "$(yad gate advance EP-x epic)"',
    'x=$(echo $(yad gate reopen EP-x epic))',
    'npx yad gate approve EP-x epic',
    'npm exec yad -- gate approve EP-x epic',
    'pnpm exec yad gate approve EP-x epic',
    'pnpm yad gate approve EP-x epic',
    'pnpm dlx yadflow gate approve EP-x epic',
    'yarn yad gate approve EP-x epic',
    'yarn exec yad gate approve EP-x epic',
    'glab mr accept 5',
    'git push --mirror',
    'gh pr review 5 --approve=true',
    'git commit -m "$(cat <<\'EOF\'\nsubject\n\nsays "hi\nEOF\n)" && git push -f',
    // Review 4: an unquoted heredoc runs the commands in its text; runner options before the program.
    'git commit -F - <<EOF\nfix: $(yad gate approve EP-a epic)\nEOF',
    'cat <<EOF\n`yad gate advance EP-a epic`\nEOF',
    'pnpm --dir x yad gate approve EP-a epic',
    'pnpm -C x exec yad gate approve EP-a epic',
    'yarn --cwd x yad gate approve EP-a epic',
    // Review 5: a runner's -c holds a shell line; more runner forms.
    'npx -c \'yad gate approve EP-x analysis\'',
    'npm exec -c \'yad gate approve EP-x analysis\'',
    'npx --call=\'yad gate advance EP-x analysis\'',
    'pnpm exec -c yad gate approve EP-x analysis',
    'yarn workspace web yad gate approve EP-x analysis',
    'bun x yad gate approve EP-x analysis',
    // Review 6: pnpm dlx's shell mode, yarn run, npm options before exec.
    'pnpm dlx -c \'yad gate approve EP-x analysis\'',
    'pnpm --package=yadflow dlx -c \'yad gate approve EP-x analysis\'',
    'pnpm dlx --shell-mode \'yad gate approve EP-x analysis\'',
    'pnpm --shell-mode exec yad gate approve EP-x analysis',
    'yarn run yad gate approve EP-x analysis',
    'yarn workspace web run yad gate approve EP-x analysis',
    'npm --yes exec -c \'yad gate approve EP-x analysis\'',
    'npm --yes exec yadflow gate approve EP-x analysis',
    'npx -c="yad gate approve EP-x analysis"',
    // Review 7: npm's -w <name> and other options that take a value.
    'npm exec -w web -c \'yad gate approve EP-x analysis\'',
    'npx -w web -c \'yad gate approve EP-x analysis\'',
    'npm -w web exec yad gate approve EP-x analysis',
    'npm exec -w web -- yad gate approve EP-x analysis',
    'npx --loglevel warn -c \'yad gate approve EP-x analysis\'',
    'pnpm --reporter silent exec yad gate approve EP-x analysis',
    'pnpm -w exec yad gate approve EP-x analysis',
    // Review 8: bun's options before run or x.
    'bun --filter web run yad gate approve EP-x analysis',
    'bun --cwd web run yad gate approve EP-x analysis',
    'bun --bun run yad gate approve EP-x analysis',
    'bun --bun x yadflow gate approve EP-x analysis',
    // Review 9: bun's own options that take a value.
    'bun --env-file .env run yad gate approve EP-x analysis',
    'bun --preload ./s.ts run yad gate approve EP-x analysis',
    'bun --config bunfig.toml x yadflow gate approve EP-x analysis',
    // Review 10: node's options that take a value, the platform API, the git hooks' door, more wrappers.
    'node --env-file .env bin/yad.mjs gate approve EP-x analysis',
    'node --watch-path src bin/yad.mjs gate approve EP-x analysis',
    'gh api -X PUT repos/o/r/pulls/5/merge',
    'gh api --method PUT /repos/{owner}/{repo}/pulls/5/merge -f merge_method=squash',
    'gh api repos/o/r/pulls/5/reviews -f event=APPROVE',
    'gh api graphql -f query=\'mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }\'',
    'glab api -X PUT projects/1/merge_requests/3/merge',
    'glab api -X POST projects/1/merge_requests/3/approve',
    'git commit --no-verify -m x',
    'git commit -n -m x',
    'git commit -anm x',
    'git -c core.hooksPath=/dev/null commit -m x',
    // Review 11: setting it for good.
    'git config core.hooksPath /dev/null',
    'git config --local core.hooksPath .nohooks',
    'gh api -XPUT repos/o/r/pulls/5/merge',
    'gh api --method=PUT repos/o/r/pulls/5/merge',
    'gh api --cache 1h repos/o/r/pulls/5/merge -X PUT',
    'gh api graphql -f query=\'mutation { submitPullRequestReview(input: {pullRequestReviewId: "x", event: APPROVE}) { clientMutationId } }\'',
    'glab api graphql -f query=\'mutation { mergeRequestAccept(input: {projectPath: "g/p", iid: "3"}) { errors } }\'',
    'glab api projects/1/merge_requests/3/approve -f sha=abc',
    // Review 12: xargs's switches take no value; a field in its `=` form.
    'echo 5 | xargs -r gh pr merge',
    'echo 5 | xargs -t gh pr merge',
    'echo 5 | xargs -o gh pr merge',
    'xargs -r git commit -n -m x',
    'echo x | xargs -r git push -f',
    'watch -t yad gate advance EP-x analysis',
    'gh api repos/o/r/pulls/5/reviews --field=event=APPROVE',
    'gh api repos/o/r/pulls/5/reviews --raw-field=event=APPROVE',
    // Review 13: the BSD (macOS) xargs's options that take a value; a short field with its value attached.
    'echo 5 | xargs -J % gh pr merge %',
    'ls | xargs -R 1 -I % gh pr merge %',
    'ls | xargs -S 255 -I % gh pr merge %',
    'gh api repos/o/r/pulls/5/reviews -Fevent=APPROVE',
    'gh api repos/o/r/pulls/5/reviews -fevent=APPROVE',
    'gh api repos/o/r/pulls/5/merge -fmerge_method=squash -XPUT',
    // Review 14: a short option's value after `=`.
    'gh api repos/o/r/pulls/5/reviews -f=event=APPROVE',
    'gh api repos/o/r/pulls/5/reviews -F=event=APPROVE',
    'gh api repos/o/r/pulls/5/merge -X=PUT',
    'YAD_HOOK_DISABLE=1 git commit -m x',
    'env YAD_HOOK_DISABLE=1 git commit -m x',
    'export YAD_HOOK_DISABLE=1 && git commit -m x',
    'xargs yad gate approve',
    'echo EP-x | xargs -I {} yad gate approve {} analysis',
    'stdbuf -oL yad gate approve EP-x analysis',
    'watch -n 5 yad gate advance EP-x analysis',
    'sudo -E yad gate approve EP-x analysis',
    'yarn workspaces foreach -A run yad gate approve EP-x analysis',
    'yarn workspaces foreach --include web exec yad gate approve EP-x analysis',
    // #498, rows 3–7, each run by a real shell (bash 3.2 and zsh 5.9 unless named). Row 3: `$'…'` inside `$(…)`.
    "echo $(echo $'a\\')'; gh pr merge 5\n)", "echo \"$(echo $'a\\')'; gh pr merge 5\n)\"", "x=$(echo $'a\\')'; git push --force\n)",
    // Row 4: a `case` in `"$(…)"` across a newline (zsh runs it).
    'echo "$(case x in x)\ngh pr merge 5;; esac)"', 'x="$(case x in\nx) gh pr merge 5;; esac)"',
    // Row 5: bash closes a list only after a comma (`{x},-n}` is `x}` and `-n`).
    'git commit -m {x},-n}', 'git push origin {a},+main}', 'git commit -m {a}{b},-n}',
    // Row 6: a backslash kept in double quotes, re-read by the shell `bash -c` and `eval` start.
    "bash -c \"echo \\'; gh pr merge 5; echo \\'\"", "eval \"echo \\'; gh pr merge 5; echo \\'\"", 'bash -c "gh pr {merge,\\}} 5"',
    "sh -c \"echo \\'; git push --force; echo \\'\"",
    // Row 7: a brace list does not see into `$(…)`, backticks or `${…}`.
    "git commit -m {$(echo '}'),-n}", "git push origin {$(echo '}'),+main}", "git commit -m {`echo '}'`,-n}", 'git commit -m {$(echo \\}),-n}',
    // Rows 3 and 7 together, and row 4's `case` inside a list (zsh).
    "git commit -m {$(echo $'\\')'),-n}", 'git commit -m {$(case x in x) echo a;; esac),-n}',
    // Row 4 with the `case` word quoted, escaped, a `$(…)`, longer than 256 characters, or an `esac` that is only a word (zsh).
    'echo "$(case "a b" in\n"a b") gh pr merge 5;; esac)"', "echo \"$(case 'a b' in\n*) gh pr merge 5;; esac)\"", 'echo "$(case a\\ b in\n*) gh pr merge 5;; esac)"',
    'echo "$(case $(echo y) in\n*) gh pr merge 5;; esac)"', `echo "$(case \${y:-${'x'.repeat(300)}} in\n*) gh pr merge 5;; esac)"`,
    'echo "$(case y in x) echo esac;;\n*) gh pr merge 5;; esac)"',
    // Rows 3 and 4 in an unquoted heredoc's text (zsh).
    "cat <<EOF\n$(echo $'a\\')'; gh pr merge 5\n)\nEOF", 'cat <<EOF\n$(case x in\nx) gh pr merge 5;; esac)\nEOF',
    // Row 6 through a here-string and a piped echo or printf.
    "bash <<< \"echo \\'; gh pr merge 5; echo \\'\"", "echo \"echo \\'; gh pr merge 5; echo \\'\" | bash", "printf '%s\\n' \"echo \\'; gh pr merge 5; echo \\'\" | sh",
    // Review round 2: a `$(…)` in a heredoc's text that the shells end sooner hides nothing after it (zsh), and
    // a chain of `case $(` that once took exponential time is refused at once (bash runs line 1 first).
    "cat <<E\n$(echo $'\\''x) it's $(gh pr merge 5)\nE", `gh pr merge 5\necho $(${' case $('.repeat(40)}`,
    // Each `$(…)` on the line is read to that reading's own end.
    "echo $(echo $'\\')'; gh pr merge 5\n) $(echo $'\\')' x\n)",
    // Review round 5: bash 3.2 honours `$'…'` but reads a `case` as text; zsh honours both. A reading per shell,
    // never one mixed reading (bash runs the first, zsh the heredoc one).
    "echo \"$(case x in x) echo ' ;; esac)\" $(echo $'\\')' ; git push -f) ' ;; esac)\"'", "echo $($'\\'' $(case x in x) esac) $(echo ')') ; git push -f ; ",
    "cat <<E\n$(echo $'\\')' ' $(echo ' ) $(git push -f) ' )\nE\n",
    // Round 6: a `#` comment inside `$(…)` (both shells; zsh only in double quotes), and backticks inside it (bash).
    "echo $( # )'\ngit push -f\n)''", "echo \"$( # )\"'\ngit push -f\n)\"''", "echo $( echo hi # )'\ngit push -f\n)''", "echo $(echo $((1)) # )'\ngit push -f\n)''",
    "echo $(echo `echo )'`\ngit push -f\n)''",
    // Round 7: bash starts a comment only after a blank (`;#` is none to it); the brace shield; `${…}` as a `case` word.
    "echo $(echo $'\\'' ;#) ; git push -f ; echo '\n)'", "echo $(echo $'\\''&#) ; git push -f ; echo '\n)'", "echo $(echo $'\\''&&#) ; gh pr merge 5 ; echo '\n)'",
    "git commit -m {$(echo '{'),-n}", 'git commit -m {$(echo {),-n}', 'git commit -m {`echo {`,-n}', 'echo "$(case ${x:-a b} in\n*) git push -f ;; esac)"',
    // Round 4: a reading that trusts the first reading's quotes past a `$(…)` the shells end elsewhere misses these.
    "echo $(echo $'\\')\"') ' $(echo ' ; git push -f ; echo \"' $'\\')\"') '", "echo $(echo $'\\')\"') ' $(echo ' ; gh pr merge 1 ; echo \"' $'\\')\"') '",
    "echo $(echo $'\\')\"') $(echo $'\\')\"') ' $(echo ' ; git push -f ; echo \"' $'\\')\"') '",
    // #516, each run by a real shell. B2 (bash 3.2): a heredoc's text inside `$(…)` is read as code.
    "x=$(cat <<'E'\n) ; git push -f ; echo '\nE\n)'", "echo \"$(cat <<'E'\n)\" ; git push -f ; echo \"\nE\n)\"", "x=$(cat <<E\n) ; gh pr merge 5 ; echo '\nE\n)'",
    // B2's printed text: bash 3.2 ends the `$(…)` at the heredoc's `)`, so `cat` prints the text before it (the heredoc
    // never ends there), joined to the text after it.
    "eval \"$(cat <<'EOF'\ngit p)ush --force\nEOF\n)\"", "bash -c \"$(cat <<'EOF'\ngit commit -)n -m x\n)EOF\n)\"",
    "bash -c \"$(echo 'eval \"$(cat <<'EOF'\nyad gate )approve EP-x epic\n\nEOF\n)\"')\"",
    // B3, B4 (zsh): a `case` word in backticks; a comment, a newline or a `;` before `in`.
    'echo "$(case `echo x` in\nx) gh pr merge 5 ;; esac)"', 'echo "$(case x #c\nin\nx) gh pr merge 5 ;; esac)"', 'echo "$(case x #c\n#d\n\nin\nx) gh pr merge 5 ;; esac)"',
    'echo "$(case x ;in\nx) gh pr merge 5 ;; esac)"',
    // B5 (zsh): `esac` right after `}` or `]]` (and `esac`, `!`, `in`: no line found that main lets through and zsh runs).
    `echo "$(case x in x) { echo '"' ; } esac)" ; git push -f ; echo '"'`, `echo "$(case x in x) [[ '"' ]] esac)" ; git push -f ; echo '"'`,
    // B6 (zsh): `case x { … }`, closed by `}` (anywhere, `echo }` too) or `esac`; a group's `}` inside it closes the group.
    'echo "$(case x {\nx) git push -f ;; })"', `echo "$(case x { x) echo '"' } )" ; git push -f ; echo '"'`, `echo "$(case x { x) echo '"' ;; esac)" ; git push -f ; echo '"'`,
    // Review round 1: an `in` right at the 4,096-character bound on a `case` word still counts, as on main (zsh runs it).
    `echo "$(case x${' '.repeat(4090)}in x) echo '"' ;; esac)" ; git push -f ; echo '"'`,
    // Review round 2: a `#'` right after a `)` on an earlier line (the `)#` reading) with B2, B3 and B6 after it.
    // Round 3: the same after a `|#'` (the `|#` reading), alone or with `)#'`.
    "[[ a =~ x|#'\n' ]] ; x=$(cat <<'E'\n) ; git push -f ; echo '\nE\n)'", "case a in (x|#'\n') ;; esac ; echo \"$(case x {\nx) git push -f ;; })\"",
    "(echo a)#'\ncase a in (x|#'\n') ;; esac ; echo \"$(case x {\nx) git push -f ;; })\"",
    "(echo a)#'\nx=$(cat <<'E'\n) ; git push -f ; echo '\nE\n)'", "(echo a)#'\necho \"$(case `echo x` in\nx) gh pr merge 5 ;; esac)\"", "(echo a)#'\necho \"$(case x {\nx) git push -f ;; })\"",
    // #498, rows 1, 2, 8: text that reaches a shell (bash 3.2 and zsh 5.9 run each). Row 1: a process substitution
    // as a shell's script or input.
    'bash <(echo "gh pr merge 5")', 'bash < <(echo "gh pr merge 5")', 'source <(echo "git push --force")', ". <(echo 'gh pr merge 5')",
    'zsh =(echo "gh pr merge 5")', "bash -s < <(echo 'gh pr merge 5')", "bash -x <(echo 'git commit -n -m x')", "bash <(cat <<'EOF'\ngh pr merge 5\nEOF\n)",
    // Row 2: a `$(…)` whose printed text is known becomes code.
    "bash -c \"$(cat <<'EOF'\ngh pr merge 5\nEOF\n)\"", 'eval "$(echo gh pr merge 5)"', "$(cat <<'EOF'\ngh pr merge 5\nEOF\n)", "bash -c \"$(echo 'true; gh pr merge 5')\"",
    "bash <<< \"$(echo 'true; gh pr merge 5')\"", "bash -c '$(cat <<EOF\ngh pr merge 5\nEOF\n)'", 'bash -c "gh pr $(echo merge) 5"', 'eval "$(printf \'%s\\n\' \'git push --force\')"',
    // Row 8: a file written, then run, by every path a shell finds it by.
    'echo "gh pr merge 5" > f; bash f', "cat > f.sh <<'EOF'\ngh pr merge 5\nEOF\nbash f.sh", "echo 'gh pr merge 5' > f; cat f | bash", "echo 'gh pr merge 5' > f; bash < f",
    "echo 'gh pr merge 5' > f; chmod +x f; ./f", "echo 'gh pr merge 5' > f; bash -- f", "echo 'gh pr merge 5' > ./f; bash f", "echo 'gh pr merge 5' > f; bash ./f",
    "printf '%s\\n' 'gh pr merge 5' > f; source f", "echo 'git push --force' > f; . ./f", "echo 'gh pr merge 5' &> f; bash f",
    // Appended, through `tee`, and a write that may not run (it must not hide the one before).
    "echo 'true' > f; echo 'gh pr merge 5' >> f; bash f", "echo 'gh pr merge 5' | tee f; bash f", "echo 'gh pr merge 5' > f; false && echo ok > f; bash f",
    // Across rows and across the lines a command carries.
    "echo 'gh pr merge 5' > f; bash <(cat f)", "echo 'gh pr merge 5' > f; bash -c \"$(cat f)\"", "echo 'gh pr merge 5' > f; eval \"$(<f)\"",
    "echo 'gh pr merge 5' > f; bash -c 'bash f'", "echo 'gh pr merge 5' > f; eval bash f", "echo \"echo '\" > f; echo 'gh pr merge 5' > f; bash -c \"$(cat f)\"",
    // The differential test: only `echo`'s leading options are options; zsh writes a pipe to a bare `> f`; a
    // backslash in a printer's name; zsh's `print`.
    'echo git commit -n -m x > f; bash f', "echo 'gh pr merge 5' | > f; bash f", "bash <<< \"$(ech\\o 'gh pr merge 5')\"", "print 'gh pr merge 5' > f; source f",
    // Review round 1: a file run by a `$(…)`, a loop or a function after the write; `source --`; a `case` in a
    // process substitution; a second one on the same command; `tee` and filters fed by a here-string, a pipe or `<`.
    "echo 'gh pr merge 5' > f; x=$(bash f)", "echo 'gh pr merge 5' > f; echo `bash f`", "for i in 1 2; do bash f; echo 'gh pr merge 5' > f; done",
    "g(){ bash f; }; echo 'gh pr merge 5' > f; g", "echo 'gh pr merge 5' > f; source -- f", "source -- <(echo 'gh pr merge 5')",
    "bash <(case x in x) echo 'gh pr merge 5';; esac)", "bash <( (case x in x) ;; esac); echo 'gh pr merge 5')", "bash < <(echo x) < <(echo 'gh pr merge 5')",
    "tee f <<< 'gh pr merge 5'; bash f", "tee f <<'E'\ngh pr merge 5\nE\nbash f", "echo 'gh pr merge 5' | cat > f; bash f", "echo 'gh pr merge 5' | sort > f; bash f",
    "echo 'gh pr merge 5' > f; cat < f > g; bash g", "echo 'gh pr merge 5' > f; tee g < f; bash g",
    // Texts joined as the shell joins them: a `>>` after a `$(…)` reading, `cat a b`; a guessed shell; `>&f`; a path
    // spelled another way.
    "echo \"$(echo 'gh pr \\')\" > f; echo 'merge 5' >> f; bash f", "echo 'gh pr \\' > a; echo 'merge 5' > b; cat a b | bash",
    "$SHELL <(echo 'gh pr merge 5')", "echo 'gh pr merge 5' >& f; bash f", "echo 'gh pr merge 5' >&f; bash f", "echo 'gh pr merge 5' > d/../f; bash f",
    // Review round 2: a quoted `case` is no reserved word, and one after `then`, `do` or `{` is; a command read
    // from a file past its limits; zsh's `-`, `--` and `print -f`.
    'bash <(echo gh pr merge 1; "case")', 'bash <(echo gh pr merge 1; \\case)', 'bash <(if :; then case x in x) echo gh pr merge 1;; esac; fi)',
    'bash <({ case x in x) echo gh pr merge 1;; esac; })', `${Array.from({ length: 70 }, (_, i) => `echo a${i} > f`).join('; ')}; echo gh pr merge 1 > f; $(<f)`,
    'print -r -- gh pr merge 1 > f; bash f', 'echo - gh pr merge 1 > f; bash f', "print -f '%s %s %s %s\\n' gh pr merge 1 > f; bash f",
    `bash < <(true) ${'-e '.repeat(70)}<(echo gh pr merge 1)`, 'git push origin >&+main', 'git push origin >& --force',
    // Review round 3: an `esac` that is an argument; a file past its limits in an argument.
    'bash <(case x in y) echo then esac;; x) echo gh pr merge 5;; esac)', "bash <(printf '%b' 'echo hi\\n'; echo gh pr merge 5)",
    "bash <(printf 'echo hi\\012'; printf 'gh pr merge 5')", "bash <(echo -en 'echo hi\\n'; echo gh pr merge 5)",
    `${Array.from({ length: 70 }, (_, i) => `echo t${i} > f`).join('; ')}; echo 'pr merge 5' > f; gh $(<f)`,
    // Review round 4: a held `)` record runs on to the real close; `1>&f` writes f.
    'bash <(: { case; case y in y) echo gh pr merge 5;; esac)', 'bash <(: { case; case y in y) :;; esac; echo gh pr merge 5)',
    'bash <(case y in y) { :; } esac; echo gh pr merge 5)', 'echo gh pr merge 5 1>& f; bash f',
    // Review round 5: `printf --` keeps its format; a quote one printed text opens and the next closes; `>& -n`
    // writes the file `-n`.
    "printf -- 'gh pr merge 1\\n' | bash", "bash <(printf -- 'gh pr merge 1')", `{ echo "x='"; echo "'; gh pr merge 1"; } | bash`,
    "echo gh pr merge 1 >& -'n'; bash ./-n", 'echo gh pr merge 1 >& -n; bash ./-n',
    // Review round 6: main's reading of `echo` (every `-n`/`-e` word dropped) is kept beside the shells'.
    'echo git -c -n core.hooksPath=x commit | bash', 'echo git -c -e core.hooksPath=x commit | zsh',
    // Review round 7: main's reading is judged alone, so the joins still pair the shells' readings.
    `bash -c "$(printf -- 'git commit '; echo - -n)"`,
    // CI review: a `cat` whose file names come from a file read past its limits prints what is not known.
    // A file empty when it is read: the next text stands alone (`printf '' > a` after an open quote).
    `printf '"' > a; printf '' > a; bash <(cat a; printf 'gh pr merge 5')`, `printf '"' > a; printf '' > a; bash -c "$(cat a; printf 'gh pr merge 5')"`,
    `false && printf '"' > a; source <(cat a; printf 'gh pr merge 5')`, `printf 'echo "' "'" > b; source <(cat nofile b; printf 'gh pr merge 5')`,
    // Readings are paired by their place: empty ones from files never written keep theirs.
    ...['bash -c "$(cat e1 e2 a; cat q)"', 'eval "$(cat e1 e2 a; cat q)"', 'source <(cat e1 e2 a; cat q)'].map((t) => `printf '"' > a; printf '' > a; printf 'echo hi\\n' > q; printf 'gh pr merge 5\\n' > q; false && printf 'echo z\\n' > q; ${t}`),
    ...['cat $(cat f) | bash', 'cat $(<f) | bash', 'cat $(cat f) > g; bash g'].map((t) => `bash -c "printf '%s' 'gh pr merge 5' > h"; cat > f <<'E'\nh${' '.repeat(300000)}\nE\n${t}`),
    // #518, PR 1: the word after `>&` / `<&` as bash 3.2 reads it — an unquoted `-` closes the descriptor and the
    // rest is a word of the command — and as zsh reads it — any word but digits, `-` or `p` is a file written.
    'git commit -m x >&--n', 'git commit -m x >& --n', 'git commit -m x <&--n', 'git commit -m x <& --n', 'git commit -m x 2>&--n', 'git commit -m x 1>&--n',
    'git commit -m x >&\t--n', 'git commit -m x >&-"-n"', 'git commit -m x >& -"-n"', 'git commit -m x >&-\\-n', 'git push origin >& -+main', 'git push origin >&-+main',
    // Crossed with a brace and a `$(…)` word: bash expands the word that follows the `-`.
    'git commit -m x >&--{n,x}', 'git commit -m x >&--$(echo n)', 'git commit -m x >& --$(echo n)', 'git push origin >&-{+main,x}',
    'echo gh pr merge 1 >&--n; bash ./--n', 'echo gh pr merge 1 >&-n; bash ./-n', 'echo gh pr merge 1 >&1--n; bash ./1--n', 'echo gh pr merge 1 >&1-; bash ./1-',
    'echo gh pr merge 1 >&p; bash ./p', 'echo gh pr merge 1 >&--n; source ./--n',
    // zsh's `>!`, `>>!`, `&>!`, `&>>!`, `>>|`, `>&|` and `>&!` write a file, as `>|` does.
    'echo gh pr merge 1 >! f; bash f', 'echo gh pr merge 1 >!f; bash f', 'echo gh pr merge 1 >>! f; bash f', 'echo gh pr merge 1 >>| f; bash f',
    'echo gh pr merge 1 >&| f; bash f', 'echo gh pr merge 1 >&|f; bash f', 'echo gh pr merge 1 >&! f; bash f', 'echo gh pr merge 1 &>! f; bash f',
    'echo gh pr merge 1 &>>! f; bash f', 'echo gh pr merge 1 1>! f; bash f', 'echo gh pr merge 1 >! "f"; bash f', 'bash -c "echo gh pr merge 1 >! f; bash f"',
    // #518 review 1: main's redirect reading still runs under bash's and zsh's `$(…)` end rules — zsh reads `>|!` as
    // `>|` writing the file `!` — and a blank before a descriptor number, a `\`-newline join, and a `#` right after
    // bash's closing `-` are read too.
    'echo "$(case x in x)\ngh pr >|! merge 5;; esac)"', 'echo "$(case x in x)\ngh pr &>|! merge 5;; esac)"', 'echo "$(case x in x)\ngit commit -m x >|! -n;; esac)"',
    'echo gh pr >|! merge 5 >! f; bash f', 'gh pr >& 1 merge 5', 'gh pr 2>& 1 merge 5', 'gh pr >&\t2 merge 5', 'gh pr <& 0 merge 5',
    'git commit -m x >\\\n&--n', 'git commit -m x >&\\\n--n', "echo x >&-#'\ngh pr merge 5\n#'", "echo x 2>&-#'\ngh pr merge 5\n#'", "echo x >& -#'\ngh pr merge 5\n#'",
    `bash -c "echo x >&-#'\ngh pr merge 5\n#'"`,
    // #518 review 2: what a `$(…)` prints is read by each shell's redirect reading too.
    '$(echo gh >& 1 pr merge 5)', '$(echo gh <& 0 pr merge 5)', '$(echo gh 2>& 1 pr merge 5)', "bash -c '$(echo gh >& 1 pr merge 5)'", 'eval "$(echo gh >& 1 pr merge 5)"',
    "bash <<'E'\n$(echo gh >& 1 pr merge 5)\nE", '$(echo gh pr >& 1- merge 5)', 'echo "$(case x in x)\n$(echo gh >& 1 pr merge 5);; esac)"',
  ]) assert.equal(agentGuardDecision(cmd).allow, false, cmd.slice(-40));
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
    // A heredoc's text is written into a file, never run.
    'cat > notes.md <<EOF\nyad gate approve EP-x epic\ngit push --force\nEOF',
    'cat > notes.md <<-\'END\'\n\tyad gate advance EP-x epic\n\tEND',
    'gh pr review 5 --comment -b "looks fine"',
    'gh pr view 5',
    'glab mr view 3',
    'yad --json gate status EP-x',
    'yad gate approve --help',
    'gh pr merge --help',
    'git log --oneline # yad gate approve',
    'gh pr create --title t --body b',
    // Review 3: single quotes keep a substitution as text; quotes inside one are its own.
    'echo \'$(yad gate approve EP-x epic)\'',
    'r=$(yad gate status EP-x --json)',
    'npx yad gate status',
    'pnpm install',
    'yarn test',
    'git commit -m "$(cat <<\'EOF\'\nfix: x\n\nA "quote and 1) item\nyad gate approve EP-x\ngit push -f\nEOF\n)"',
    // Review 4: a quoted heredoc's text is only text; an option's value is not an option.
    'git commit -F - <<\'EOF\'\nfix: $(yad gate approve EP-a epic)\nEOF',
    'cat <<EOF\nescaped \\$(yad gate approve EP-a epic)\nEOF',
    'gh pr review 5 --comment --body "-a"',
    'pnpm --dir x test',
    // Review 5: `<<\EOF` and `<<E"OF"` are quoted heredocs: their text is only text.
    'cat <<\\EOF > n.md\nyad gate approve EP-x analysis\n$(yad gate advance EP-x analysis)\nEOF',
    'cat <<E"OF" > n.md\nyad gate approve EP-x analysis\nEOF',
    'npx -c \'yad status\'',
    'yarn workspace web test',
    // Review 6: a program's own -c is its own.
    'pnpm exec vitest -c vitest.config.ts',
    'npx eslint -c \'git push -f\' src',
    'pnpm -c exec echo hi',
    'npx -c \'eslint .\'',
    'yarn run build',
    'pnpm -w add -D x',
    'npm -w web run build',
    'bun --filter web run build',
    'bun --env-file .env run dev',
    'bun --watch run dev',
    // Review 10: a push option's value is text; ordinary API reads, commits and wrappers.
    'git push -o +x origin feat/x',
    'git push --push-option +ci.skip origin feat/x',
    'node --env-file .env server.js',
    'gh api repos/o/r/pulls/5',
    'gh api repos/o/r/pulls/5/reviews -f event=COMMENT -f body=ok',
    'glab api projects/1/merge_requests/3',
    'git commit -m "-n is a flag"',
    'git commit -m x --no-edit',
    'git commit -F msg.txt',
    'git log -n 3',
    'git -c user.name=x commit -m y',
    'git config core.hooksPath',
    'git config --get core.hooksPath',
    'git config --unset core.hooksPath',
    'git config user.name x',
    'gh api repos/o/r/pulls/5/merge',
    'gh api repos/o/r/pulls/5/merge --jq .message',
    'glab api projects/1/merge_requests/3/approvals',
    'git commit -uno -m x',
    'gh pr merge --disable-auto 5',
    'gh api graphql -f query=\'query { repository(owner: "o", name: "r") { pullRequest(number: 5) { merged } } }\'',
    'xargs -n 1 echo',
    'watch -d git status',
    'yarn workspaces foreach -A run build',
  ]) assert.equal(agentGuardDecision(cmd).allow, true, cmd);
  assert.equal(agentGuardDecision(undefined).allow, true);
  assert.deepEqual(shellParts('a "b c" \'d e\' && f\\ g | h'), [['a', 'b c', 'd e'], ['f g'], ['h']]);
  // #492: a heredoc opened and closed with CRLF is text up to its `EOF\r` line; what follows is a command.
  assert.deepEqual(shellParts('cat <<EOF\r\nb\r\nEOF\r\ngh pr merge 5\r\n'), [['cat'], ['gh', 'pr', 'merge', '5\r']]);
  // A redirect's operator is not a word (#495): `<(` is a part break after it.
  assert.deepEqual(shellParts('cat <(gh pr view 5) | f(){ x; }'), [['cat'], ['gh', 'pr', 'view', '5'], ['f'], ['{', 'x'], ['}']]);
  // Redirects and their targets leave the command's words; `$'…'` reads its escapes; a here-string is input.
  assert.deepEqual(shellParts('git push origin main 2>&1 --force'), [['git', 'push', 'origin', 'main', '--force']]);
  assert.deepEqual(shellParts('gh >x pr merge 5 2> err &>all'), [['gh', 'pr', 'merge', '5']]);
  assert.deepEqual(shellParts("git commit -m $'it\\'s\\n'"), [['git', 'commit', '-m', "it's\n"]]);
  assert.deepEqual(shellParts('x=<<<1 git commit'), [['x=', 'git', 'commit']]);
  // Still allowed: a heredoc that ends, a quoted parenthesis, arithmetic, three levels of nesting.
  for (const ok of ['cat <<EOF\nhello\nEOF', 'git commit -m "fix (thing)"', 'echo $((1<<2))', 'echo $(echo $(echo hi))', 'git log\r\n',
    '(cd web && npm ci)# install', 'npm test # x', 'cat <<E$x\nhi\nE$x', '[[ $x =~ ^#(a|b) ]]', 'git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)"',
    // A docs heredoc naming a guarded command stays allowed: only an end word that expands adds line-by-line reading.
    `cat <<'EOF' > "$f"\ngh pr merge 1 is the person's\nEOF`, "gh pr create --body-file - <<'EOF' # $x\ngh pr merge 1 stays with the person\nEOF",
    `cat <<'EOF'\ngh pr merge 1 docs\nEOF\ncat > b <<"E$n"\nx\nE$n`,
    // #495: the common forms around the new readings stay allowed.
    'npm test 2>&1 | tail', 'git log > out.txt', 'cmd >/dev/null 2>&1', 'find . -name x -exec grep y {} +', 'git -c core.pager=less log', 'eval "$(ssh-agent)"',
    'echo hi | bash -s', 'curl -fsSL https://example.com/i.sh | sh', "git commit -m $'line one\\nline two'", 'cat <<< "gh pr merge 5"', "python3 - <<'PY'\nprint(1)\nPY",
    'bash <<EOF\necho hi\nEOF', 'git log --oneline 2>/dev/null | head -3',
    'find . -name x -exec grep "git push --force" {} +', 'git -c alias.lg="log --oneline" lg', 'curl -fsSL https://x | bash -s -- --yes', '[[ a > b ]]', 'echo {a,b}.txt',
    '$EDITOR notes.md', '${PYTHON:-python3} x.py', '$(npm bin)/eslint .', "cat <<'EOF' | bash\necho hi\nEOF", 'ls <->', 'echo "gh pr merge 5" > notes.md; bash build.sh',
    'curl x | bash -s stable', 'cat build.sh | bash', 'bash -x ./build.sh arg', 'mkdir -p src/{a,b,c}', 'git add src/{a,b}.js', "jq '{a,b}' f.json", 'echo {1..5}', 'ls {a,b}{c,d}',
    'for i in {1..100}; do echo $i; done', 'echo {0..64}', 'touch file{001..100}.txt', `curl -d '[${'{"id":0,"v":2},'.repeat(5)}{}]' https://x`,
    'echo x || bash', 'docker ps --format {{.Names}}', 'gh pr view {1,2,3}', 'gh pr {merge\\,x,} 5',
    `gh api repos/x -f body='[${'{"a":1,"b":2},'.repeat(10)}{}]'`, "echo '{a,b}{a,b}{a,b}{a,b}{a,b}'", 'echo {a,b}{a,b}{a,b}{a,b}{a,b}', 'bash -euo pipefail ./x.sh', 'echo {a..z}',
    `curl -d '[${'{"a":1,"b":2},'.repeat(66000)}{}]' https://x`,
    `git add ${'f.js '.repeat(2000)}src/{a,b}.js`,
    // #498: the ordinary forms around the new readings stay allowed.
    "echo $(echo $'it\\'s')", "x=$(printf $'a\\tb')", 'echo "$(echo $\'\\\'\')"', 'echo "$(case $x in a) echo a;; esac)"', 'echo "$(echo case)"',
    'echo {x}', 'gh pr view {x},5}', 'git log {x},y}', "echo {$(echo '}'),x}", 'git log {$(echo a),b}', 'gh api repos/{owner}/{repo}/pulls',
    'bash -c "echo \\"hi\\""', 'bash -c "echo \\$HOME"', "bash -c \"grep '\\d' f\"", "bash -c \"printf 'a\\nb'\"", "eval \"echo \\'quoted\\'\"", 'grep "\\d+" f',
    'echo "$(echo test case)"', "echo \"it\\'s\" | cat", 'echo "$(case y in x) echo esac;; esac)"', "cat <<EOF\n$(echo $'it\\'s')\nEOF",
    // The budget counts only a `$(…)` the shells end elsewhere, once per reading: 40 ordinary ones, with a CR too.
    Array(40).fill("x=$(printf $'a\\tb')").join('; '), `${Array(40).fill("x=$(printf $'a\\tb')").join('; ')}\r`,
    // Review round 2: a line read again with `$(:)` is judged at its own depth, and `a|esac)` is a pattern.
    `echo "$(printf $'it\\'s')" "$(printf $'a\\'b')" "$(printf $'c\\'d')"`, 'echo "$(case x in a|esac) echo a;; esac)"',
    // Any number of `$(…)` that a shell ends elsewhere: each reading reads them all in one pass.
    Array.from({ length: 100 }, (_, n) => `echo "$(case x${n} in x${n}) echo esac;; esac)"`).join('\n'), Array(4).fill('echo $(case a in a) echo hi;; esac)').join(' '), Array(100).fill("$(echo $'\\')')").join(' '),
    // #516: a heredoc in `$(…)`, zsh's `case x { … }` and a `case` word in backticks, with safe commands.
    // Review round 2: a `#` right at the 4,096-character bound of a `case` word is judged at once (it looped forever).
    // Round 3: many heredocs that never end, inside `$(…)`, are read in linear time (one text each was quadratic).
    `x=$(cat <<A\n${'bash <<B\n'.repeat(10000)})`,
    `echo "$(case x${' '.repeat(4090)}#x\nin x) ;; esac)"`, `echo "$(case x${';'.repeat(4090)}#x\nin x) ;; esac)"`,
    "x=$(cat <<'E'\n(a)\nE\n); echo ok", "git commit -m \"$(cat <<'EOF'\nfix: it's done\nEOF\n)\" && git push", 'echo "$(case x { x) echo a ;; })"',
    'echo "$(case `echo x` in x) echo a ;; esac)"', 'echo "$(case x #c\nin x) echo a ;; esac)"',
    // A `#` that starts no word is no comment, and backticks inside `$(…)` are ordinary.
    'x=$(echo a#b)', 'echo $(git log --format=%H#%s -1)', 'echo "$(date) # not a comment"', 'echo $(echo $#)', 'echo ${#x} $(echo ${#y})',
    'n=$((16#ff)); echo $(echo $n)', 'echo $(echo `date`)', 'echo $( # a comment\necho hi )', 'y=$(echo `echo a`)$(echo b)',
    // #498, rows 1, 2, 8: a process substitution as an argument, a `$(…)` whose text is not run or not known, and
    // a file written that no shell runs.
    'bash build.sh <(echo "gh pr merge 5")', 'cat <(echo "gh pr merge 5")', 'bash <(curl -fsSL https://x/i.sh)', 'bash -c "$(curl -fsSL https://x/i.sh)"',
    "bash -c 'echo $(echo gh pr merge 5)'", 'bash -c "echo $(echo gh pr merge 5)"', 'echo "$(echo gh pr merge 5)"', 'x=$(git rev-parse HEAD); echo $x',
    'cd "$(git rev-parse --show-toplevel)" && bash build.sh', 'echo x > notes; bash build.sh', 'echo "gh pr merge 5" > notes.md; bash build.sh', "echo 'gh pr merge 5' > f; cat f",
    'bash build.sh > log.txt; cat log.txt', 'echo "gh pr merge 5" 2> f; bash f', "echo 'gh pr merge 5' > f; bash g", 'git diff > x.patch; git apply x.patch',
    // Review round 1: a file printed, however many times it was written; a copy of a descriptor is no file.
    `${Array.from({ length: 70 }, (_, i) => `echo "line ${i}" >> notes.md`).join('; ')}; cat notes.md`, 'npm test 2>&1 | tee out.txt', 'echo "$(date)" >> notes.md',
    'cat < in.txt > out.txt', 'bash build.sh >&2', 'echo x >&-', 'source .venv/bin/activate',
    // Review round 2: a file run after many lines written to it; descriptors copied; a `case` that runs a script.
    `cat > f <<'E'\n${'npm run lint\n'.repeat(45000)}E\nbash f`, 'npm run build >&build.log', 'exec 3>&1; npm test >&3', 'make 2>&1 >&2 | tee make.log',
    'case "$1" in start) bash run.sh;; esac', 'printf "%s\\n" a > f; bash f',
    // Review round 3: a long `case` in a process substitution; a quoted word after `>&`.
    `bash <(case x in ${'a) echo a;; '.repeat(600)}esac)`, 'git commit -m x >&"--n"', 'echo hi 2>& f',
    // Review round 4: bash passes nothing here.
    'git commit -m x >& "-"-n', 'git commit -m x >&1--n', `bash <(${'case y in y) :;; esac; '.repeat(40000)})`,
    // #518, PR 1: the forms around the new readings stay allowed — a descriptor copied, moved or closed, a file
    // written that nothing runs, and words that run nothing in bash or zsh.
    'npm run build 2>&1 | tee build.log', 'git log >& log.txt', 'git diff >& d.txt; cat d.txt', 'echo x >&2', 'cmd 2>&1 >/dev/null', 'git fetch 2>&- ; git status',
    'git commit -m x >&-n', 'git commit -m x >&1-', 'git commit -m x 2>&1--n', 'git commit -m x >&p', 'npm test >! out', 'git status >| s.txt', 'npm test >>! out.log',
    'echo gh pr merge 1 2>&--n; bash ./--n', 'echo gh pr merge 1 2>! f; bash f', 'echo gh pr merge 1 > !f; bash f', 'echo gh pr merge 1 <&--n; bash ./--n',
    'git commit -m x >&| -n', 'git push origin main >&2',
    // #518 review 1: a blank before the number copies a descriptor as before; a `#` after `>&-` with a blank is text.
    'make >& 1 | head', 'echo x >& 2', 'npm test 2>& 1 | tail', 'echo x >&- # done', 'echo "$(case x in x) echo a >&2;; esac)"',
    'x=$(git status >& 1)', 'echo "$(make 2>& 1 | tail)"', 'out=$(npm test >&- 2>&1)']) {
    assert.equal(agentGuardDecision(ok).allow, true, ok);
  }
});

test('#492: a line of many heredocs that never end is judged in bounded time; one too long to judge is refused', async () => {
  // A coverage run makes this work about seven times slower, which says nothing about the guard, so it is not
  // timed. The other runs are timed, but a shared CI machine has passed 3 s on work that takes 0.5 s here, so
  // every limit is 4.5 s: still under the guard's own 5 s cut-off, because a line refused at the cut-off would
  // otherwise pass this test and hide a slowdown. Nested tails keep 6 s; that case runs into the cut-off inside
  // the brace expansion by design.
  const within = (ms) => (process.env.NODE_V8_COVERAGE ? Infinity : ms);
  const { MAX_JUDGED, JUDGE_BUDGET_MS } = await import('./agent-guard.mjs');
  const line = `${'cat <<X\n'.repeat(60000)}gh pr merge 5`;
  const t0 = Date.now();
  assert.equal(agentGuardDecision(line).allow, false);
  assert.ok(Date.now() - t0 < within(4500), `took ${Date.now() - t0} ms`);
  // Distinct end words, just under the cap: each end line is found by a lookup, not a scan.
  let distinct = '';
  for (let i = 0; distinct.length < MAX_JUDGED - 20; i++) distinct += `<<A${i}\n`;
  const t1 = Date.now();
  assert.equal(agentGuardDecision(`${distinct}gh pr merge 5`).allow, false);
  assert.ok(Date.now() - t1 < within(4500), `distinct words took ${Date.now() - t1} ms`);
  // Many `$(…)`, each holding a heredoc, near the cap: one line index per text, shared by every `$(` in it.
  for (const unit of ['$(cat <<E\nx\nE\n)', '$(cat <<E\n$(cat <<F\nx\nF\n)\nE\n)']) {
    const many = `${unit.repeat(Math.floor((MAX_JUDGED - 100) / unit.length))}\ngh pr merge 1`;
    const t3 = Date.now();
    assert.equal(agentGuardDecision(many).allow, false);
    assert.ok(Date.now() - t3 < within(4500), `many $( took ${Date.now() - t3} ms`);
  }
  // A run of `<<` with no newline: the expanding-word check reads the matches one by one, never a backtracking regex.
  const t4 = Date.now();
  assert.equal(agentGuardDecision(`gh pr merge 1 # ${'<<'.repeat(125000)}`).allow, false);
  assert.ok(Date.now() - t4 < within(4500), `a run of << took ${Date.now() - t4} ms`);
  // #495 review: a `case` scan per `$(` and a loop over every body for every part were quadratic.
  // Many words under the length bound, each with lists and a nested tail: the budget is checked inside the expansion.
  const nestedTail = `x {a,b}{a,b}{a,b}{a,b}{a,b}{a,b}${'{'.repeat(2000)}${'}'.repeat(2000)};`;
  const t7 = Date.now();
  assert.equal(agentGuardDecision(`${nestedTail.repeat(245)} gh pr merge 5`).allow, false);
  assert.ok(Date.now() - t7 < within(6000), `nested tails took ${Date.now() - t7} ms`);
  // A `{` and many commas with no `}`: the brace check is a scan, never a backtracking regex.
  for (const l of [`echo '{${','.repeat(250000)}'; gh pr merge 5`, `git status {${','.repeat(990000)}`]) {
    const t6 = Date.now();
    agentGuardDecision(l);
    assert.ok(Date.now() - t6 < within(4500), `{ + commas took ${Date.now() - t6} ms`);
  }
  for (const [unit, tail] of [['$()', '$()'], ['$(a) ', '$(a) '], [':<<<x;', 'sh;'], [':<<E\nE\n', 'sh;']]) {
    const l = unit.repeat(Math.floor(495000 / unit.length)) + tail.repeat(Math.floor(495000 / tail.length));
    const t5 = Date.now();
    agentGuardDecision(l);
    assert.ok(Date.now() - t5 < within(4500), `${JSON.stringify(unit)} took ${Date.now() - t5} ms`);
  }
  let inSub = 'echo $(';
  for (let i = 0; i < 10000; i++) inSub += `<<B${i}\n`;
  const t2 = Date.now();
  agentGuardDecision(`${inSub})`);
  assert.ok(Date.now() - t2 < within(4500), `inside $( took ${Date.now() - t2} ms`);
  // #498: each shell's reading of `$(…)` is one pass, and bash's brace rule is bounded per word.
  for (const unit of ["$(echo $'a\\'", '$(case x in x) ', "\"$(case x in x)\n", `{x}${'{x}'.repeat(50)},y `, 'echo "$(case $(', ' case $(', ' case ${', '(case ${', " case '"]) {
    const l = unit.repeat(Math.floor((MAX_JUDGED - 100) / unit.length)) + ' gh pr merge 5';
    const t8 = Date.now();
    agentGuardDecision(l);
    assert.ok(Date.now() - t8 < within(4500), `#498 ${JSON.stringify(unit.slice(0, 12))} took ${Date.now() - t8} ms`);
  }
  // #498, rows 1, 2, 8: each new path is linear; a file run again after each of many appends is refused at its bound.
  // Half the cap (#498 CI): a shared runner has run two to four times slower than a laptop. The trade-off: a path
  // that scans every earlier part costs a quarter as much at half the length, so a mild one may only show near
  // the limit. Under coverage the 5 s cut-off may also refuse; the other runs check each verdict.
  const half = (unit) => unit.repeat(Math.floor(MAX_JUDGED / 2 / unit.length));
  for (const unit of ['bash <(echo x) ', 'bash <(', 'echo x > f; bash f;', 'echo x >> f; ', 'printf x >> f; ', 'x=$(echo a > f; bash f);', 'bash -c "$(echo x)";', 'echo $(echo x)', 'bash <(cat <<E\nx\nE\n) ', 'x <<< "$(echo a b)" ', '$(<f)']) {
    const l = half(unit);
    const t10 = Date.now();
    const d = agentGuardDecision(l);
    assert.ok(d.allow || (process.env.NODE_V8_COVERAGE && /took too long/.test(d.message)), `${unit}: ${d.message}`);
    assert.ok(Date.now() - t10 < within(4500), `#498 ${JSON.stringify(unit)} took ${Date.now() - t10} ms`);
  }
  for (const unit of ['echo x >> f; bash f;', 'echo x | tee -a f; cat f | bash;', 'echo x > f; echo "$(cat f)$(cat f)" > f; cat f | bash;']) {
    const l = half(unit);
    const t11 = Date.now();
    // Refused at its bound, or on a runner slow enough to need it at the 5 s cut-off (CI's Node 20 reached the
    // bound in 4.7 s). Either way within the guard's own budget, with slack: a missing deadline check still shows.
    const m = agentGuardDecision(l).message;
    const ms = Date.now() - t11;
    assert.ok(/runs files it writes too many times|took too long/.test(m ?? ''), `${unit}: ${m}`);
    assert.ok(ms < within(JUDGE_BUDGET_MS + 1500), `#498 ${JSON.stringify(unit)} took ${ms} ms`);
  }
  assert.equal(agentGuardDecision(`echo ${'$(echo x)'.repeat(100000)}`).allow, true);
  // CI review: many file names from a `$(…)`, each read joined to a long text, ran out of memory before the cut-off.
  for (const n of [60000, 150000]) {
    const t14 = Date.now();
    agentGuardDecision(`cat > f <<'E'\nh ${'a '.repeat(n)}\nE\ncat $(cat f) | bash`);
    assert.ok(Date.now() - t14 < within(4500), `#498 cat $(cat f) with ${n} names took ${Date.now() - t14} ms`);
  }
  // Review round 3: many files to one `cat`, many `>&f`, many parts in one process substitution stay linear.
  for (const l of [`echo -n a>f;cat ${'f '.repeat(490000)};gh pr merge 5`, `cat ${'x '.repeat(490000)};gh pr merge 5`, `echo hi ${'>&f '.repeat(245000)}`, `bash <(${'echo a;'.repeat(140000)})`]) {
    const t13 = Date.now();
    agentGuardDecision(l);
    assert.ok(Date.now() - t13 < within(4500), `#498 ${JSON.stringify(l.slice(0, 20))} took ${Date.now() - t13} ms`);
  }
  // Review round 1: nested process substitutions are refused past their bound, not read in quadratic time.
  for (const d of [4000, 16000]) {
    const t12 = Date.now();
    assert.match(agentGuardDecision(`${'bash <('.repeat(d)}echo hi${')'.repeat(d)}`).message, /too many process substitutions/);
    assert.ok(Date.now() - t12 < within(4500), `#498 nested <( took ${Date.now() - t12} ms`);
  }
  assert.equal(agentGuardDecision(Array(60).fill("echo 'echo hi' >> f").join('; ') + '; bash f').allow, true);
  // #498 review round 7: each budget refuses past its limit, and a line well under it stays allowed.
  assert.match(agentGuardDecision(`echo $(${' case ${'.repeat(120000)})`).message, /too many `case` words/);
  // Near the limit: 240 `case` words of 4,000 characters read about 960,000 of the 1,048,576 allowed. The line
  // must also stay under MAX_JUDGED, or it is refused as too long rather than for its words.
  const nearCase = `echo $(${` case ${'x'.repeat(4000)} in x) :;; esac;`.repeat(240)})`;
  assert.ok(nearCase.length < MAX_JUDGED, `the near-limit line is ${nearCase.length} characters`);
  assert.equal(agentGuardDecision(nearCase).allow, true);
  assert.match(agentGuardDecision(`echo ${'{x}'.repeat(1300)},y`).message, /brace lists expand to too many words/);
  assert.equal(agentGuardDecision(`echo ${'{x}'.repeat(150)},y`).allow, true);
  // #498 review: the kept spelling of a long double-quoted word with many backslashes is built in one pass.
  const n = Math.floor((MAX_JUDGED - 100) / 2);
  for (const [l, allow] of [[`bash -c "${'\\x'.repeat(n)}; gh pr merge 5"`, false], [`echo "${'\\x'.repeat(n)}"`, true]]) {
    const t9 = Date.now();
    assert.equal(agentGuardDecision(l).allow, allow, l.slice(0, 20));
    assert.ok(Date.now() - t9 < within(4500), `#498 kept backslashes took ${Date.now() - t9} ms`);
  }
  const long = agentGuardDecision(`echo ${'x'.repeat(MAX_JUDGED)}`);
  assert.equal(long.allow, false);
  assert.match(long.message, /too long to judge/);
});

test('#518: a long line the bash and zsh readings are added for is judged in bounded time', () => {
  const within = (ms) => (process.env.NODE_V8_COVERAGE ? Infinity : ms);
  for (const line of [`${'npm run lint >&- ; '.repeat(40000)}gh pr view 1`, `${'echo x >! f; '.repeat(40000)}bash f`, `cat > f <<'E'\n${'npm run lint\n'.repeat(45000)}E\nbash f >&-`]) {
    const t0 = Date.now();
    agentGuardDecision(line);
    assert.ok(Date.now() - t0 < within(4500), `took ${Date.now() - t0} ms: ${line.slice(0, 30)}`);
  }
  assert.equal(agentGuardDecision(`${'npm run lint >&- ; '.repeat(40000)}git commit -m x >&--n`).allow, false);
  // Review 2: a `$(…)` inside a `$(…)` keeps its reading's shell, so nesting does not multiply the readings.
  const nest = (n) => (n ? `$(echo a >&p >& 1 >&|q ${nest(n - 1)})` : 'x');
  const nested = Array(20).fill(`echo ${nest(3)}`).join('; ');
  const t1 = Date.now();
  assert.equal(agentGuardDecision(nested).allow, true);
  assert.ok(Date.now() - t1 < within(4500), `nested took ${Date.now() - t1} ms`);
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
  // Every assertion carries the hook's exit code, answer and stderr: the reason it allowed is on stderr,
  // and without it a failure on CI (macOS, #459 and #460) said nothing.
  const said = (r) => `hook said ${JSON.stringify(r)}`;
  const parse = (r) => { try { return JSON.parse(r.out); } catch { assert.fail(`not a JSON verdict — ${said(r)}`); } };
  try {
    const claude = (command) => runGuard(T, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
    const denied = claude('yad gate approve EP-a epic --by me');
    assert.equal(denied.code, 2, said(denied));
    assert.match(denied.err, /the person's to run/, said(denied));
    const status = claude('yad status');
    assert.equal(status.code, 0, said(status));
    const cursor = (command) => runGuard(T, { hook_event_name: 'beforeShellExecution', command });
    const no = cursor('git push --force');
    assert.equal(no.code, 0, said(no));
    assert.equal(parse(no).permission, 'deny', said(no));
    assert.match(parse(no).agent_message, /force push/, said(no));
    const ls = cursor('ls');
    assert.deepEqual(parse(ls), { permission: 'allow' }, said(ls));
    // Fail-open: an unreadable payload, a switched-off guard, and no yad at all.
    const junk = runGuard(T, 'not json');
    assert.equal(junk.code, 0, said(junk));
    const off = runGuard(T, { tool_input: { command: 'yad gate advance EP-a epic' } }, { YAD_HOOK_DISABLE: '1' });
    assert.equal(off.code, 0, said(off));
    const none = runGuard(T, { hook_event_name: 'beforeShellExecution', command: 'git push -f' }, { YAD_BIN: '', PATH: '' });
    assert.deepEqual(parse(none), { permission: 'allow' }, said(none));
    assert.match(none.err, /allowing/, said(none));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('#498: yad hook agent-guard judges in a worker; one that runs out of memory, out of time, or into an error refuses', async () => {
  const { judgeInWorker } = await import('./hook.mjs');
  const yadBin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'yad.mjs');
  const ok = await judgeInWorker('npm test', null);
  assert.equal(ok.verdict.allow, true, JSON.stringify(ok));
  const no = await judgeInWorker('gh pr merge 5', null);
  assert.match(no.verdict.message, /approving or merging/);
  // A worker with almost no memory, or no time, does not answer: the line is refused, never allowed.
  const big = `echo ${'$(echo x) '.repeat(60000)}`;
  const oom = await judgeInWorker(big, null, { heapMb: 16 }); // 1-2 MB aborts Node itself, before the worker starts
  assert.equal(oom.verdict.allow, false, JSON.stringify(oom.verdict));
  assert.match(oom.verdict.message, /could not be judged/);
  const slow = await judgeInWorker(big, null, { wallMs: 1 });
  assert.equal(slow.verdict.allow, false, JSON.stringify(slow.verdict));
  assert.match(slow.verdict.message, /could not be judged \(no answer/);
  // The real hook: a refusal is exit 2, and a read-only line is still pre-approved from the worker.
  const hook = (command) => spawnSync(process.execPath, [yadBin, 'hook', 'agent-guard'], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: os.tmpdir(), YAD_HOOK_DISABLE: '' }, cwd: os.tmpdir() });
  assert.equal(hook('gh pr merge 5').status, 2);
  assert.match(hook('git status').stdout, /pre-approved/);
  // Out of time after the verdict: an allowed line stays allowed, only not pre-approved. This line's verdict
  // takes about 0.2 s on a laptop, its pre-approval about 6.5 s. Under coverage the verdict may be late too.
  const longRead = 'git status 2>&1; '.repeat(Math.floor(990_000 / 17));
  const late = await judgeInWorker(longRead, { root: os.tmpdir(), cwd: os.tmpdir() }, { wallMs: 3000 });
  assert.equal(late.pre, null, JSON.stringify(late.pre));
  if (!process.env.NODE_V8_COVERAGE) assert.equal(late.verdict.allow, true, late.verdict.message);
});

test('#498: a named pipe where a shipped check should be is not read, so pre-approval never blocks the hook', { skip: process.platform === 'win32', timeout: 20_000 }, async () => {
  const { agentGuardPreapproval } = await import('./agent-guard.mjs');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-fifo-'));
  try {
    fs.mkdirSync(path.join(T, 'checks'));
    execFileSync('mkfifo', [path.join(T, 'checks', 'spec-link.sh')]);
    const t = Date.now();
    assert.equal(agentGuardPreapproval('bash checks/spec-link.sh', { cwd: T, root: T }).preapproved, false);
    assert.ok(Date.now() - t < 2000);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('the hooks read a payload that arrives late or in pieces, retry a pipe that is not ready (EAGAIN), and never lose a verdict at exit', async () => {
  const { readStdin } = await import('./hook.mjs');
  // EAGAIN twice, then data in two pieces, then the end: all of it, once.
  const pieces = [Buffer.from('{"a":'), Buffer.from('1}')];
  let calls = 0;
  const fake = (fd, buf) => {
    calls += 1;
    if (calls <= 2) throw Object.assign(new Error('try again'), { code: 'EAGAIN' });
    const next = pieces.shift();
    if (!next) return 0;
    next.copy(buf);
    return next.length;
  };
  assert.equal(readStdin({ readSync: fake }), '{"a":1}');
  // Windows ends a pipe with an EOF error rather than a read of 0.
  let once = false;
  assert.equal(readStdin({ readSync: (fd, buf) => { if (once) throw Object.assign(new Error('end'), { code: 'EOF' }); once = true; buf.write('x'); return 1; } }), 'x');
  // A pipe that never becomes ready gives up after the limit, and the caller fails open.
  const t0 = Date.now();
  assert.throws(() => readStdin({ readSync: () => { throw Object.assign(new Error('try again'), { code: 'EAGAIN' }); }, limitMs: 50 }), /try again/);
  assert.ok(Date.now() - t0 < 2000, 'the limit holds');
  assert.throws(() => readStdin({ readSync: () => { throw Object.assign(new Error('bad'), { code: 'EBADF' }); } }), /bad/, 'any other error goes to the caller');
  // The real script, its payload written late and in pieces: the verdict is still right.
  const T = guardScript();
  try {
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [path.join(T, 'hooks/agent-guard.mjs')], {
      cwd: T, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, YAD_BIN: `"${process.execPath}" "${YAD_MJS}"`, YAD_HOOK_DISABLE: '' },
    });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const payload = JSON.stringify({ hook_event_name: 'beforeShellExecution', command: 'git push --force' });
    child.stdin.write(payload.slice(0, 10));
    const { setTimeout: sleep } = await import('node:timers/promises');
    await sleep(300);
    child.stdin.end(payload.slice(10));
    const code = await new Promise((r) => child.on('close', r));
    assert.equal(code, 0, err);
    assert.equal(JSON.parse(out.trim()).permission, 'deny', `out ${JSON.stringify(out)} err ${JSON.stringify(err)}`);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
  // Every write of a verdict in the hook scripts is followed by an exit only once it is written.
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills/yad-checks/templates/hooks');
  for (const f of ['agent-guard.mjs', 'ledger-guard-cursor.mjs']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/process\.stdout\.write\([^)]*\);?\s*process\.exit\(/.test(src), `${f}: no exit straight after a stdout write`);
    assert.match(src, /process\.stdout\.write\(text, \(\) => process\.exit\(code\)\)/, `${f}: the verdict is written, then the exit`);
  }
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
const { syncGuideSkill, guideSections, GUIDE_SECTIONS } = await import('./agent-guide.mjs');

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
  // Each generated line pairs its backticks, or every code span after an odd one reads wrongly.
  for (const line of Object.values(guideSections()).flat()) assert.equal((line.match(/`/g) ?? []).length % 2, 0, line);
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

test('every `yad … --push` a skill gives to copy says to ask the person first', () => {
  // A command in a code block is what an agent copies and runs; --push lands on the default branch, which the
  // agent asks for every time (E158 review 3: `checkpoint --retro-ship … --push` had no such line).
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const lines = read(p).split('\n');
      let inBlock = false;
      lines.forEach((line, i) => {
        if (line.trim().startsWith('```')) { inBlock = !inBlock; return; }
        if (!inBlock || !/\byad .*--push\b/.test(line)) return;
        if (!/\bask|person/i.test(lines.slice(Math.max(0, i - 12), i + 1).join('\n'))) bad.push(`${path.relative(REPO, p)}:${i + 1}: ${line.trim()}`);
      });
    }
  };
  walk(path.join(REPO, 'skills'));
  assert.deepEqual(bad, []);
});

test('a bug report previews and posts the same text: its Command line too', async () => {
  const D = tmp();
  try {
    const posted = [];
    const seams = { searcher: () => ({ ok: true, matches: [] }), interactive: false, opener: () => {}, authed: () => true, filer: (p, repo, payload) => { posted.push(payload); return { ok: true, url: 'u' }; } };
    const error = Object.assign(new Error('boom'), { code: 'YAD-CLI-001' });
    const preview = await runReport(D, { ...seams, error, message: 'it broke', argv: ['report', '-m', 'it broke', '--json'] });
    const r = await runReport(D, { ...seams, error, message: 'it broke', post: true, confirm: preview.confirm, argv: ['report', '-m', 'it broke', '--post', '--confirm', preview.confirm] });
    assert.equal(r.filed, true);
    assert.deepEqual(posted, [{ title: preview.title, body: preview.body, labels: ['bug'] }]);
  } finally { fs.rmSync(D, { recursive: true, force: true }); process.exitCode = 0; }
});

test('yad report with no terminal never prompts, so it never posts', async () => {
  let asked = 0;
  // Only the terminal check may stop it: the switch that also would is cleared for this run.
  const saved = process.env.SDLC_NONINTERACTIVE;
  delete process.env.SDLC_NONINTERACTIVE;
  assert.ok(!process.stdin.isTTY || !process.stdout.isTTY, 'the test runner has no terminal');
  const r = await runReport(tmp(), { message: 'x', searcher: () => ({ ok: true, matches: [] }), opener: () => {}, prompter: async () => { asked++; return true; }, filer: () => { throw new Error('posted'); }, argv: ['report', '-m', 'x'] });
  if (saved !== undefined) process.env.SDLC_NONINTERACTIVE = saved;
  assert.equal(r.filed, false);
  assert.equal(asked, 0);
});

const { orphanAllowListActions } = await import('./plan.mjs');
const { RETIRED_ALLOW_ENTRIES, SHIPPED_ALLOW_LISTS } = await import('./agent-rules.mjs');

test('the allow list comes out again when Claude Code leaves the targets; the team\'s entries stay', () => {
  const T = tmp();
  try {
    put(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', default_branch: 'main' }));
    const [a] = allowListActions(T, ['.claude']);
    a.apply();
    const file = path.join(T, '.claude/settings.json');
    const s = JSON.parse(read(file));
    s.permissions.allow.push('Bash(npm test)');
    put(file, JSON.stringify(s));
    assert.deepEqual(orphanAllowListActions(T, ['.claude']), [], 'nothing retired while .claude is a target');
    // One of yad's strings the team typed by hand, without yad's whole list: theirs, kept.
    const U = tmp();
    put(path.join(U, '.sdlc/product.json'), JSON.stringify({ platform: 'github', default_branch: 'main' }));
    put(path.join(U, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(yad status:*)'] } }));
    assert.deepEqual(orphanAllowListActions(U, ['.cursor']), []);
    fs.rmSync(U, { recursive: true, force: true });
    const gone = orphanAllowListActions(T, ['.agents']);
    assert.equal(gone.length, 1);
    gone[0].apply();
    assert.deepEqual(JSON.parse(read(file)).permissions.allow, ['Bash(npm test)']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a command that leaves the allow list is retired, so check --fix takes it out', () => {
  // Today's list is the last one shipped: when it changes, append it to SHIPPED_ALLOW_LISTS (cli/agent-rules.mjs),
  // and put each entry that left in RETIRED_ALLOW_ENTRIES.
  const now = readAllowList();
  assert.deepEqual(now, SHIPPED_ALLOW_LISTS.at(-1), 'append the new list to SHIPPED_ALLOW_LISTS');
  for (const e of SHIPPED_ALLOW_LISTS.flat()) assert.ok(now.includes(e) || RETIRED_ALLOW_ENTRIES.includes(e), `${e} left the list: add it to RETIRED_ALLOW_ENTRIES`);
});

test('no pre-approved command reads a flag bin/yad.mjs uses to write, push, post or approve', () => {
  // The flags a command reads in bin/yad.mjs, by the `case` that runs it.
  const src = fs.readFileSync(path.join(REPO, 'bin', 'yad.mjs'), 'utf8');
  const sw = src.slice(src.indexOf('switch (cmd) {'));
  const blocks = {};
  const re = /^\s{4}case '([a-z-]+)':/gm;
  const hits = [...sw.matchAll(re)];
  hits.forEach((m, i) => { blocks[m[1]] = sw.slice(m.index, hits[i + 1]?.index ?? sw.length); });
  // A write flag the command reads must be one the rules know, on the command or one of its actions: a flag
  // the rules know raises that command's class, which keeps it off the list. One they do not know is a hole.
  const WRITES = { out: 'out', fix: 'fix', push: 'push', apply: 'apply', post: 'post', openPr: 'open-pr', overwriteLocal: 'overwrite-local', to: 'to', ship: 'ship' };
  const known = (cmd, flag) => Object.entries(COMMAND_CLASS).some(([k, e]) => (k === cmd || k.startsWith(`${cmd} `)) && Object.hasOwn(e.flags ?? {}, flag));
  for (const entry of readAllowList()) {
    const [cmd] = entry.match(/^Bash\(yad (.+):\*\)$/)[1].split(' ');
    const body = blocks[cmd] ?? '';
    for (const [prop, flag] of Object.entries(WRITES)) {
      if (new RegExp(`\\bo\\.${prop}\\b`).test(body)) assert.ok(known(cmd, flag), `yad ${cmd} reads --${flag}, which the rules do not class`);
    }
  }
});

test('a PR/MR approval or merge in a skill is always handed to the person', () => {
  const bad = [];
  for (const skill of fs.readdirSync(path.join(REPO, 'skills'))) {
    const file = path.join(REPO, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    for (const para of read(file).split(/\n\s*\n/)) {
      if (/`(gh pr review[^`]*--approve|gh pr merge|glab mr (approve|merge))/.test(para) && !/the person|they submit|the human submits/.test(para)) bad.push(`${skill}: ${para.slice(0, 120)}`);
    }
  }
  assert.deepEqual(bad, []);
});

// ---- E158b: the agent guard and the allow list in a connected code repo -------------------------------
// The case list is in the E158b roadmap row; each test names the cases it covers.

const { repoOrphanAgentGuardActions } = await import('./plan.mjs');
const { REPO_AGENT_GUARD_DEST } = await import('./manifest.mjs');
const guardRepo = () => {
  const T = tmp();
  const P = path.join(T, 'product');
  const R = path.join(T, 'api');
  fs.mkdirSync(P); fs.mkdirSync(R);
  put(path.join(P, '.sdlc/product.json'), JSON.stringify({ platform: 'github', default_branch: 'main' }));
  return { T, P, R, repo: { name: 'api', path: '../api', platform: 'github' } };
};
const stamp = (P, ideTargets) => put(path.join(P, '.sdlc/cli-version.json'), JSON.stringify({ version: '4.8.0', ideTargets }));
const guardItems = (actions) => actions.filter((a) => a.item.startsWith(REPO_AGENT_GUARD_DEST) || a.item.includes('(agent guard)') || a.allowList);

test('E158b cases 1, 2, 5, 7: a cloned code repo gets the guard and the allow list beside its own entries; a second run is all ok', () => {
  const { T, P, R, repo } = guardRepo();
  try {
    stamp(P, ['.claude', '.cursor']);
    const theirs = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'theirs.sh' }] }] }, permissions: { allow: ['Bash(npm test)'] } };
    put(path.join(R, '.claude/settings.json'), JSON.stringify(theirs));
    const actions = guardItems(repoActions(P, repo));
    assert.deepEqual(actions.map((a) => `${a.scope}/${a.item}`), [
      'api/checks/agent-guard.mjs', 'api/.claude/settings.json (agent guard)', 'api/.cursor/hooks.json (agent guard)', 'api/.claude/settings.json (read-only yad commands)',
    ]);
    // The team's files are never staged by --push; the script is a wired file like the other checks/ files.
    assert.deepEqual(actions.map((a) => a.paths), [[REPO_AGENT_GUARD_DEST], [], [], []]);
    for (const a of actions) a.apply();
    const claude = JSON.parse(read(path.join(R, '.claude/settings.json')));
    const commands = claude.hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(commands.includes('theirs.sh'), 'the team\'s hook is kept');
    assert.ok(commands.includes('node "$CLAUDE_PROJECT_DIR/checks/agent-guard.mjs"'), commands.join(', '));
    assert.equal(claude.permissions.allow[0], 'Bash(npm test)', 'the team\'s entry is kept, first');
    assert.deepEqual(claude.permissions.allow.slice(1), readAllowList());
    assert.equal(JSON.parse(read(path.join(R, '.cursor/hooks.json'))).hooks.beforeShellExecution[0].command, 'node checks/agent-guard.mjs');
    assert.ok(fs.existsSync(path.join(R, REPO_AGENT_GUARD_DEST)));
    assert.ok(guardItems(repoActions(P, repo)).every((a) => a.status === 'ok'), 'a second run changes nothing');
    // Case 5: Claude Code only, or Cursor only — only that tool's files.
    stamp(P, ['.claude']);
    assert.ok(!guardItems(repoActions(P, repo)).some((a) => a.item.startsWith('.cursor')));
    stamp(P, ['.cursor']);
    assert.deepEqual(guardItems(repoActions(P, repo)).map((a) => a.item), ['checks/agent-guard.mjs', '.cursor/hooks.json (agent guard)']);
    stamp(P, ['.agents']);
    assert.deepEqual(guardItems(repoActions(P, repo)), [], 'no tool with hooks: no script either');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E158b cases 3, 4, 6: a settings file that does not parse, a repo not cloned, the Product itself, a linked target folder', () => {
  const { T, P, R, repo } = guardRepo();
  const said = [];
  const orig = console.error;
  try {
    stamp(P, ['.claude']);
    put(path.join(R, '.claude/settings.json'), '{ not json');
    console.error = (...a) => said.push(a.join(' '));
    const actions = guardItems(repoActions(P, repo)).filter((a) => a.item.startsWith('.claude'));
    console.error = orig;
    assert.ok(actions.length === 2 && actions.every((a) => a.status === 'modified' && a.writesNothing), JSON.stringify(actions.map((a) => a.status)));
    assert.equal(said.filter((l) => /api\/\.claude\/settings\.json does not parse/.test(l)).length, 1, `said once, naming the repo: ${said.join(' | ')}`);
    actions.forEach((a) => a.apply());
    assert.equal(read(path.join(R, '.claude/settings.json')), '{ not json');
    // Case 4: a repo not cloned here, and the Product registered as a repo.
    assert.deepEqual(guardItems(repoActions(P, { name: 'web', path: '../web', platform: 'github' })), []);
    assert.deepEqual(guardItems(repoActions(P, { name: 'product', path: '.', platform: 'github' })), []);
    // Case 6: the repo's .claude is a link: named, and nothing is written through it.
    fs.rmSync(path.join(R, '.claude'), { recursive: true });
    const elsewhere = path.join(T, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(R, '.claude'));
    said.length = 0;
    console.error = (...a) => said.push(a.join(' '));
    const linked = repoActions(P, repo);
    console.error = orig;
    assert.deepEqual(guardItems(linked), []);
    assert.ok(said.some((l) => /api: unsafe IDE target '\.claude'/.test(l)), said.join(' | '));
    assert.deepEqual(fs.readdirSync(elsewhere), []);
  } finally { console.error = orig; fs.rmSync(T, { recursive: true, force: true }); }
});

test('E158b case 10: a target that leaves takes yad\'s entries out of the repo\'s files; the team\'s stay, and so does the script', () => {
  const { T, P, R, repo } = guardRepo();
  try {
    stamp(P, ['.claude', '.cursor']);
    put(path.join(R, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }));
    guardItems(repoActions(P, repo)).forEach((a) => a.apply());
    assert.deepEqual(repoOrphanAgentGuardActions(R, ['.claude', '.cursor'], { scope: 'api' }), [], 'nothing while both are targets');
    const gone = repoOrphanAgentGuardActions(R, ['.agents'], { scope: 'api' });
    assert.deepEqual(gone.map((a) => `${a.scope}/${a.item}`).sort(), [
      'api/hooks.json (agent guard entry removed)', 'api/settings.json (agent guard entry removed)', 'api/settings.json (read-only yad commands removed)',
    ]);
    gone.forEach((a) => a.apply());
    const claude = JSON.parse(read(path.join(R, '.claude/settings.json')));
    assert.deepEqual(claude.permissions.allow, ['Bash(npm test)']);
    assert.equal(claude.hooks?.PreToolUse, undefined);
    assert.equal(JSON.parse(read(path.join(R, '.cursor/hooks.json'))).hooks?.beforeShellExecution, undefined);
    assert.ok(fs.existsSync(path.join(R, REPO_AGENT_GUARD_DEST)), 'the script stays');
    assert.deepEqual(repoOrphanAgentGuardActions(path.join(T, 'nowhere'), ['.agents'], { scope: 'web' }), []);
    // Review 1: a repo whose .claude is a link to another folder: nothing is removed through it, a target or not.
    guardItems(repoActions(P, repo)).forEach((a) => a.apply());
    assert.equal(repoOrphanAgentGuardActions(R, ['.agents'], { scope: 'api' }).filter((a) => a.item.startsWith('settings.json')).length, 2, 'yad\'s entries are back, so there is something to remove');
    const shared = path.join(T, 'shared');
    fs.renameSync(path.join(R, '.claude'), shared);
    fs.symlinkSync(shared, path.join(R, '.claude'));
    const before = read(path.join(shared, 'settings.json'));
    assert.deepEqual(repoOrphanAgentGuardActions(R, ['.claude'], { scope: 'api' }).filter((a) => a.item.startsWith('settings.json')), []);
    assert.deepEqual(repoOrphanAgentGuardActions(R, ['.agents'], { scope: 'api' }).filter((a) => a.item.startsWith('settings.json')), []);
    assert.equal(read(path.join(shared, 'settings.json')), before);
    // Review 2: the same for a linked .cursor.
    const sharedCursor = path.join(T, 'shared-cursor');
    fs.renameSync(path.join(R, '.cursor'), sharedCursor);
    fs.symlinkSync(sharedCursor, path.join(R, '.cursor'));
    const cursorBefore = read(path.join(sharedCursor, 'hooks.json'));
    assert.deepEqual(repoOrphanAgentGuardActions(R, ['.agents'], { scope: 'api' }).filter((a) => a.item.startsWith('hooks.json')), []);
    assert.equal(read(path.join(sharedCursor, 'hooks.json')), cursorBefore);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E158b cases 11, 12: checks/agent-guard.mjs in a code repo refuses and allows as in the Product, and fails open', () => {
  const T = tmp();
  try {
    put(path.join(T, REPO_AGENT_GUARD_DEST), read(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skills/yad-checks/templates/hooks/agent-guard.mjs')));
    const run = (payload, env = {}) => {
      const r = spawnSync(process.execPath, [path.join(T, REPO_AGENT_GUARD_DEST)], {
        input: JSON.stringify(payload), encoding: 'utf8', cwd: T,
        env: { ...process.env, YAD_BIN: `"${process.execPath}" "${YAD_MJS}"`, YAD_HOOK_DISABLE: '', ...env }, timeout: 30_000,
      });
      return { code: r.status, out: (r.stdout || '').trim() };
    };
    assert.equal(run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'yad gate approve EP-x epic' } }).code, 2);
    assert.equal(run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'yad status' } }).code, 0);
    assert.equal(JSON.parse(run({ hook_event_name: 'beforeShellExecution', command: 'gh pr merge 5' }).out).permission, 'deny');
    assert.deepEqual(JSON.parse(run({ hook_event_name: 'beforeShellExecution', command: 'npm test' }).out), { permission: 'allow' });
    // Case 12: no yad reachable from the repo — allowed.
    assert.deepEqual(JSON.parse(run({ hook_event_name: 'beforeShellExecution', command: 'git push -f' }, { YAD_BIN: '', PATH: '' }).out), { permission: 'allow' });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E158b case 14: on a repo wired before E158b the guard files are new, so yad update adds them; on an unwired repo they stay missing', () => {
  const { T, P, R, repo } = guardRepo();
  try {
    stamp(P, ['.claude']);
    assert.ok(guardItems(repoActions(P, repo)).every((a) => a.status === 'missing'), 'update never does a repo\'s one-time setup');
    put(path.join(R, 'checks/spec-link.sh'), '#!/usr/bin/env bash\n');
    assert.deepEqual(guardItems(repoActions(P, repo)).map((a) => a.status), ['new', 'new', 'new']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- pre-approval (E167, #353) ------------------------------------------------------------------------

const { agentGuardPreapproval, PREAPPROVED, PREAPPROVED_GATES } = await import('./agent-guard.mjs');

test('E167: a line the guard sees only reads is pre-approved; any write, secret or unknown form is not', () => {
  const T = tmp();
  try {
    fs.writeFileSync(path.join(T, 'a.json'), '{}');
    fs.mkdirSync(path.join(T, 'src'));
    const yes = (line) => assert.equal(agentGuardPreapproval(line, { cwd: T }).preapproved, true, `should be pre-approved: ${line}`);
    const no = (line) => assert.equal(agentGuardPreapproval(line, { cwd: T }).preapproved, false, `must NOT be pre-approved: ${line}`);
    for (const line of [
      'gh api repos/o/r/pulls',
      'gh api repos/o/r/pulls --paginate --jq ".[].number"',
      'gh api -X GET repos/o/r/commits/abc',
      'gh api repos/o/r/pulls/5 -H "Accept: application/vnd.github.diff"',
      'glab api projects/1/merge_requests',
      "gh api repos/o/r/pulls | jq '.[0].number'",
      'git log --oneline -5', 'git status --porcelain', 'git diff main...HEAD', 'git show HEAD:package.json', 'git rev-parse HEAD', 'git ls-files', 'git blame a.json',
      'git status 2>/dev/null', 'git log 2>&1 | head -n 3', 'git diff >/dev/null',
      'jq . a.json', "jq -r '.a > 1' a.json", "jq --arg x y -n '$x'", "git log -- '*.mjs'", 'git log -n5 -p', 'git blame -L 1,2 a.json',
      'cat a.json', 'head -5 a.json', 'tail -n 2 a.json', 'wc -l a.json', 'grep -rn foo src/', 'grep -e foo a.json', 'git log | cut -d" " -f1 | uniq -c | tr a-z A-Z',
      'yad status --json | jq .x', 'yad gate status EP-a', 'yad doctor && git status',
      // Decoded paths and suffixes do not block ordinary reads.
      'glab api projects/grp%2Fproj/merge_requests', 'gh api repos/o/r/contents/README.md', 'gh api repos/o/r/releases/tags/v1.2.3', 'gh api repos/o/r/compare/main...feat',
      // Review 2: forms the allow list of characters keeps.
      'gh api repos/{owner}/{repo}/pulls', 'git rev-parse @{u}', 'git log -S foo', 'git diff --text', 'git diff HEAD~1', "git diff 'HEAD^' -- a.json", 'git diff main...HEAD -- src',
      'git log --format=%H -3', "grep -n 'a.*b' a.json", 'git blame --ignore-rev abc a.json', 'git log\t--oneline -2', 'git log \\\n  --oneline',
    ]) yes(line);
    for (const line of [
      // API writes, GraphQL, other hosts, and the human-only area.
      'gh api -X POST repos/o/r/issues', 'gh api -XPOST repos/x', 'gh api --method=PATCH repos/x', 'gh api --method DELETE repos/x', 'gh api repos/x -f title=t',
      'gh api repos/x -F a=@file', 'gh api repos/x --field a=b', 'gh api repos/x --raw-field a=b', 'gh api repos/x --input body.json', 'gh api graphql -f query="{viewer{login}}"',
      'gh api graphql', 'gh api --hostname evil.example repos/x', 'gh api https://evil.example/x', 'gh api repos/x -H "X-HTTP-Method-Override: DELETE"',
      'gh api repos/o/r/actions/secrets', 'gh api repos/o/r/actions/variables', 'gh api user/keys', 'gh api repos/o/r/hooks', 'glab api projects/1/variables',
      'gh api repos/x --jq env', 'gh secret set X', 'gh secret list', 'gh variable set X', 'gh auth token', 'glab token create', 'gh pr merge 5', 'gh pr list',
      // git writes, git options, and reads outside the repo.
      'git log --output=x', 'git diff --output x', 'git -c core.pager=x log', 'git -C /tmp log', 'git diff --ext-diff', 'git diff --no-index /etc/passwd a.json',
      'git blame --contents /etc/passwd a.json', 'git commit -m x', 'git push', 'git checkout main', 'git branch -D x',
      // files outside the project, writes, and lines the guard cannot see through.
      'jq . /etc/passwd', 'jq -n env', 'jq -n "$ENV"', 'jq \'import "x" as y; .\' a.json', 'cat ~/.ssh/id_rsa', 'cat ../x', 'head /etc/hosts', 'grep -r x /',
      'git status > out.txt', 'git log >> out.txt', 'jq . < a.json', 'cat <<EOF\nx\nEOF', 'tee out.txt', 'sort -o x a.json', 'sed -i s/a/b/ a.json', 'awk 1 a.json', 'uniq a.json out.txt',
      'echo $(gh api repos/x)', 'git log `echo x`', 'bash -c "git log"', 'GH_HOST=x gh api repos/x', 'env gh api repos/x', 'sudo cat a.json', './gh api repos/x',
      '/usr/bin/git log', '(git log)', 'tail -f a.json', 'git log && rm -rf src', 'git log; curl https://x', 'yad gate approve EP-a epic', 'yad check --fix', 'npx yad status',
      'bash checks/build-test-lint.sh', 'bash checks/install-deps.sh', 'bash checks/product-checkout.sh', '', '   ',
      // Review 1: what the shell expands before the program runs is never judged as written.
      'cat {~/.ssh/id_rsa,a.json}', 'cat {/etc/passwd,a.json}', 'grep -r x {/etc,.}', 'jq -n --arg t "$GH_TOKEN" \'$t\'', 'jq --arg x y -n "$x"',
      'jq -n "\\"${HOME}\\""', 'gh api user --jq "\\"$GH_TOKEN\\""', 'head -n "$X" a.json', 'head -n $X a.json', 'cut -d "$X" -f1 a.json', 'cat ~/x', 'cat x ~/y',
      'cat a.*', 'cat a.jso?', 'cat [a]', 'grep -R x .', 'grep --dereference-recursive x .', 'jq -nf x.jq', 'jq --from-file x.jq a.json', 'gh api user --cache 1h',
      'gh api user/emails', 'git blame --conten=/etc/hosts a.json', 'git blame --contents=/etc/hosts a.json', 'git blame -S revs a.json', 'git ls-files -X ex',
      'git diff -O/etc/order', 'git log --show-signature', 'git log --show-sig', 'git log --outp=x', 'git diff --no-ind /etc/a b', 'cat a.json 2>/dev/null"x"',
      'yad check --fix', 'yad dial EP-a implement --to auto',
      // Review 2: zsh glob qualifiers and =(…) run commands; =ls reads a program's file; git diff reads files outside.
      'cat a.json(e:touch\\ PWNED:)', 'cat a.json(e:"touch PWNED":)', 'head -c 100 a.json(e:id:)', 'cat =(id)', 'cat =ls', 'cat x =ls', 'git log --x=~/y',
      'git diff /dev/null /etc/hosts', 'git diff --stat a.json /etc/passwd', 'git diff -- /etc/hosts /etc/passwd', 'git diff ../../x a.json', 'git log --format=%GS -1',
      'git log --pretty=format:%G?', 'git blame -S revs a.json', 'git diff -Oorder', 'gh api repos/{a,b}', 'cat a!b', 'git log #(x)\nrm -rf src', 'git log a#b',
      // Review 3: a "comment" the shell reads as part of a word, after a \-newline, a \r, or a character JavaScript calls a space.
      'git log -1 --format=x\\\n#$GH_TOKEN', 'git log -1 --format=x\r#$GH_TOKEN', 'git log -1 --format=x\u00a0#$GH_TOKEN', 'git log -1 --format=x\v#$GH_TOKEN',
      'git log -1 --format=x\f#$GH_TOKEN', 'git log -1 --format=x\u2028#$GH_TOKEN', 'git rev-parse --sq-quote x\\\n#${GH_TOKEN}', 'git log --oneline # a note', 'git status\r',
      // Review 4: \ + CR + LF runs the next line; a zsh extendedglob ^; $ ENV; paths that return secrets.
      'git log \\\r\ntouch PWNED', 'cat a.json \\\r\ntouch X', 'cat ^a.json', 'git log HEAD^', "jq -n '$ ENV.HOME'", "gh api --jq '$ ENV' user",
      'glab api projects/1/triggers', 'glab api projects/1/integrations/slack', 'gh api repos/o/r/actions/runs/1/logs', 'glab api projects/1/jobs/2/trace',
      'glab api projects/1/secure_files/3/download', 'glab api projects/1/terraform/state/prod', 'glab api projects/1/pipeline_schedules/2', 'glab api projects/1/jobs/2/artifacts',
      'gh api repos/o/r/actions/artifacts/1/zip', 'glab api application/settings', 'glab api user',
      'glab api user.json', 'glab api user.', 'glab api projects/1/jobs/2/trace.json', 'glab api user%2F', 'glab api application%2Fsettings', 'gh api user', 'gh api %zz',
    ]) no(line);
    // A refusal always wins: a refused line is never pre-approved.
    assert.equal(agentGuardDecision('git log && gh pr merge 5').allow, false);
    // The working folder must be inside the project.
    assert.equal(agentGuardPreapproval('cat etc/hosts', { cwd: '/', root: T }).preapproved, false);
    assert.equal(agentGuardPreapproval('cat ../a.json', { cwd: path.join(T, 'src'), root: T }).preapproved, true, 'inside the project, from a subfolder');
    // A link that leaves the project is outside it.
    fs.symlinkSync('/etc/hosts', path.join(T, 'hosts'));
    no('cat hosts');
    // A name holding a brace-shield character would be read under another name, past the link check: the prompt.
    fs.symlinkSync('/etc', path.join(T, 'link'));
    no("cat 'link/hosts'"); no('cat "link/hosts"');
    no('cat host*'); no('cat host?');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E167: a read gate is pre-approved only while its file is the copy this yadflow ships', () => {
  const T = tmp();
  try {
    fs.mkdirSync(path.join(T, 'checks'));
    const shipped = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skills/yad-checks/templates/checks');
    for (const g of PREAPPROVED_GATES) {
      assert.ok(fs.existsSync(path.join(shipped, g)), `${g} is shipped`);
      fs.copyFileSync(path.join(shipped, g), path.join(T, 'checks', g));
      const run = g.endsWith('.mjs') ? `node checks/${g} --base origin/main` : `bash checks/${g} origin/main`;
      assert.equal(agentGuardPreapproval(run, { cwd: T }).preapproved, true, run);
      if (!g.endsWith('.mjs')) assert.equal(agentGuardPreapproval(`sh ./checks/${g} origin/main`, { cwd: T }).preapproved, true, g);
      // The wrong runner, or one byte changed: the prompt.
      assert.equal(agentGuardPreapproval(g.endsWith('.mjs') ? `bash checks/${g}` : `node checks/${g}`, { cwd: T }).preapproved, false, g);
      fs.appendFileSync(path.join(T, 'checks', g), ' ');
      assert.equal(agentGuardPreapproval(run, { cwd: T }).preapproved, false, `${g} edited`);
    }
    // The gates that run the repo's own code, install or clone are never on the list.
    for (const g of ['build-test-lint.sh', 'install-deps.sh', 'product-checkout.sh', 'package-manager.sh']) {
      assert.ok(!PREAPPROVED_GATES.includes(g), g);
      fs.copyFileSync(path.join(shipped, g), path.join(T, 'checks', g));
      assert.equal(agentGuardPreapproval(`bash checks/${g}`, { cwd: T }).preapproved, false, g);
    }
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E167: the hook answers a read with a PreToolUse allow under Claude Code; Cursor, refusals and the switches are unchanged', () => {
  const T = guardScript();
  const said = (r) => `hook said ${JSON.stringify(r)}`;
  try {
    const claude = (command, env) => runGuard(T, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: T }, env);
    const read = claude('git status | head -3');
    assert.equal(read.code, 0, said(read));
    const answer = JSON.parse(read.out);
    assert.equal(answer.hookSpecificOutput.hookEventName, 'PreToolUse', said(read));
    assert.equal(answer.hookSpecificOutput.permissionDecision, 'allow', said(read));
    assert.match(answer.hookSpecificOutput.permissionDecisionReason, /read-only command \(git status, head\)/, said(read));
    // Not a read: no answer, so Claude Code asks as before.
    const write = claude('gh api -X POST repos/o/r/issues');
    assert.deepEqual([write.code, write.out], [0, ''], said(write));
    // A refusal still refuses.
    const merge = claude('git log && gh pr merge 5');
    assert.equal(merge.code, 2, said(merge));
    // The switches: YAD_NO_PREAPPROVE drops only this half; YAD_HOOK_DISABLE the whole guard.
    const off = claude('git status', { YAD_NO_PREAPPROVE: '1' });
    assert.deepEqual([off.code, off.out], [0, ''], said(off));
    assert.equal(claude('gh pr merge 5', { YAD_NO_PREAPPROVE: '1' }).code, 2);
    const disabled = claude('git status', { YAD_HOOK_DISABLE: '1' });
    assert.deepEqual([disabled.code, disabled.out], [0, ''], said(disabled));
    // Cursor's answer is the same literal as before.
    const cursor = runGuard(T, { hook_event_name: 'beforeShellExecution', command: 'git status' });
    assert.deepEqual(JSON.parse(cursor.out), { permission: 'allow' }, said(cursor));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E167: nothing that creates, prints or changes a secret, token or variable is ever pre-approved', () => {
  const T = tmp();
  try {
    const lines = [];
    for (const prog of ['gh', 'glab']) {
      for (const sub of ['secret set X', 'secret list', 'secret delete X', 'variable set X', 'variable list', 'auth token', 'auth login', 'token create', 'ssh-key add k', 'gpg-key add k']) lines.push(`${prog} ${sub}`);
      for (const p of ['repos/o/r/actions/secrets', 'repos/o/r/actions/secrets/public-key', 'repos/o/r/actions/variables', 'orgs/o/actions/secrets', 'repos/o/r/environments/e/secrets',
        'projects/1/variables', 'user/keys', 'user/gpg_keys', 'repos/o/r/keys', 'repos/o/r/hooks', 'personal_access_tokens', 'user/installations/1/access_tokens', 'projects/1/access_tokens',
        'repos/o/r/dependabot/secrets', 'repos/o/r/codespaces/secrets', 'groups/1/variables']) {
        lines.push(`${prog} api ${p}`, `${prog} api ${p} --paginate`, `${prog} api ${p} | jq .`);
      }
    }
    for (const line of lines) assert.equal(agentGuardPreapproval(line, { cwd: T }).preapproved, false, line);
    assert.match(PREAPPROVED.never, /secrets, tokens, variables/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// #532: output readings stay separate from the historical positional readings.
const outputGaps = [
  '{ echo gh pr merge 5; } > f; bash f',
  '( echo gh pr merge 5 ) > f; bash f',
  '{ echo gh pr merge 5; } >! f; zsh f',
  '{ echo gh pr merge 5; } | tee f; bash f',
  "echo echo 'gh pr merge 5' | bash > g; bash g",
  "echo 'echo gh pr merge 5' > f; eval \"$(<f)\" > g; bash g",
  '$(echo $(echo gh >& 1 pr merge 5))',
  "printf 'gh pr ' | cat - <(echo merge 5) | bash",
  "{ printf '%s ' gh pr; echo merge 5; } | bash",
  "printf 'gh pr ' > a; printf '%s\\n' 'merge 5' >> a; bash a",
  "{ printf '%b\\n' 'gh pr \\c'; echo merge 5; } | bash",
  "printf '\\x67h pr merge 5\\n' | bash",
  "printf 'git push \\055-force\\n' | bash",
  "{ printf 'gh pr\\n' | tr -d '\\n'; echo ' merge 5'; } | bash",
  "{ printf 'gh prX' | head -c 5; echo ' merge 5'; } | bash",
];
test('#532: every reported output gap is refused, while text only printed stays allowed', () => {
  for (const line of outputGaps) assert.equal(agentGuardDecision(line).allow, false, line);
  for (const line of ["printf '%s ' gh pr merge 5", '{ echo gh pr merge 5; } > f',
    "printf '\\x67h pr merge 5\\n'", "{ printf '%s ' echo; echo hello; } | bash",
    "printf 'echo ' > a; printf '%s\\n' hello >> a; bash a"]) {
    assert.equal(agentGuardDecision(line).allow, true, line);
  }
});

test('#532: differential output corpus against bash and zsh with harmless executable stubs', () => {
  const T = tmp();
  const log = path.join(T, 'executed');
  const bin = path.join(T, 'bin'); fs.mkdirSync(bin);
  for (const name of ['gh', 'git']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nprintf reached >> "$GUARD_STREAM_LOG"\n', { mode: 0o755 });
  }
  const corpus = [...outputGaps];
  for (const printer of ["echo gh pr merge 5", "printf '%s ' gh pr merge 5", "printf '%b' '\\x67h pr merge 5\\n'"]) {
    for (const group of [`{ ${printer}; }`, `( ${printer} )`]) {
      for (const sink of ['| bash', '> f; bash f', '| tee f; bash f']) corpus.push(`${group} ${sink}`);
    }
  }
  for (const shell of ['/bin/bash', '/bin/zsh']) {
    if (!fs.existsSync(shell)) continue;
    for (const line of corpus) {
      fs.rmSync(log, { force: true });
      try {
        execFileSync(shell, ['-c', line], { cwd: T, timeout: 2000, stdio: 'ignore',
          env: { PATH: `${bin}:/bin:/usr/bin`, HOME: T, GUARD_STREAM_LOG: log } });
      } catch { /* A shell-specific syntax error is not an execution witness. */ }
      if (fs.existsSync(log)) assert.equal(agentGuardDecision(line).allow, false, `${shell}: ${line}`);
    }
  }
});

test('#532: repeated cat stdin copies are charged before they exhaust the deadline', () => {
  const line = `printf x > a; echo go | ${'cat - $(<a) | '.repeat(25)}bash`;
  const v = agentGuardDecision(line);
  assert.equal(v.allow, false);
  assert.doesNotMatch(v.message, /took too long/);
});
