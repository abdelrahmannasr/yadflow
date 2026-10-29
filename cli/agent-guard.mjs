// The agent guard (E158): a hook that runs before an AI agent's shell command, in Claude Code (`PreToolUse`,
// matcher `Bash`) and Cursor (`beforeShellExecution`), and refuses four kinds of command:
//   - a yad command only the person may run (`classify` in cli/agent-rules.mjs says `human-only`: an
//     approval, a gate comment or advance or reopen, a commit past the ledger guard);
//   - approving or merging a PR/MR on the platform (`gh pr review --approve`, `gh pr merge`, `glab mr approve`,
//     `glab mr merge` or `accept`, or the same through `gh api`/`glab api` and GraphQL): the person's, even
//     when the agent's login could;
//   - a force push (`git push --force`, `-f`, `--force-with-lease`, `--force-if-includes`, `--mirror`, a `+`
//     refspec);
//   - skipping the git hooks, the ledger guard's door (`git commit --no-verify` or `-n`, `YAD_HOOK_DISABLE=…`,
//     `git -c core.hooksPath=…`, `git config core.hooksPath <path>`): the person's, through `yad commit --manual`.
// The refusal says what to do instead: ask the person to run it themselves (`! <command>` in Claude Code).
//
// A SPEED BUMP, NOT PROOF. It reads the command line the agent sends, so a command hidden in a script, an
// alias or `eval` is not seen; Codex has no hooks at all. What proves an approval is the platform (and CI's
// ledger guard). The rules in AGENTS.md are what the agent follows; this catches the plain mistake.
//
// FAIL-OPEN, like the ledger guard: a payload it cannot read, or no command in it, is allowed.
import { classify } from './agent-rules.mjs';
import { VALUE_FLAGS, LIST_FLAGS } from './argv-flags.mjs';

// A heredoc's `<<` and its end word: bare (`EOF`), quoted (`'EOF'`, `"EOF"`, `E"OF"`) or escaped (`\EOF`). Any
// quote or `\` in the word makes the text plain text, as bash reads it: nothing in it runs.
const HEREDOC = /^<<(-?)[ \t]*((?:\\.|'[^'\n]*'|"[^"\n]*"|[A-Za-z0-9_.-])+)/;
const heredocOf = (m) => ({ word: m[2].replace(/\\(.)|['"]/g, '$1'), tabs: m[1] === '-', quoted: /['"\\]/.test(m[2]) });

// One command line split into its simple commands: on `;`, `&`, `&&`, `||`, `|` and newlines, outside
// quotes. Each part is a list of words, with quotes removed and `\` escapes applied. Read as the shell reads it
// in the ways an agent's commands use most: a `\` at the end of a line joins the next line on, a `#` that
// starts a word begins a comment, and the body of a heredoc (`cat > notes.md <<EOF` … `EOF`) is text fed to a
// command, never commands. A `<<` whose end line never comes (an arithmetic shift, `$((1<<2))`) is not a
// heredoc: nothing after it is skipped. `<<<` is a here-string, one word of text. A command substitution
// (`$(…)` or backticks, outside single quotes) stays inside its word, and its text is also kept in
// `parts.subs`, so the caller judges the command it runs: `r=$(yad gate approve …)` runs an approval. Quotes
// inside it are its own (`"$(cat <<'EOF' … EOF)"` holds any `"` in the heredoc's text).
export function shellParts(line) {
  const parts = [];
  // Not enumerable: `parts` reads as the plain list of parts it always was.
  Object.defineProperty(parts, 'subs', { value: [] });
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const heredocs = [];
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  const endPart = () => { endWord(); if (words.length) parts.push(words); words = []; };
  // Where the heredocs opened on this line end: the index just past the last one's end line, or -1 when an end
  // line never comes. The text of one whose end word is not quoted (`<<EOF`, not `<<'EOF'`) still runs its
  // `$(…)` and backticks, so those go to `parts.subs`.
  const heredocsEnd = (from) => {
    let at = from;
    const bodies = [];
    for (const h of heredocs) {
      const start = at;
      for (;;) {
        if (at > line.length) return -1;
        const eol = line.indexOf('\n', at);
        const text = line.slice(at, eol < 0 ? line.length : eol).replace(/\r$/, '');
        const lineStart = at;
        at = eol < 0 ? line.length + 1 : eol + 1;
        if ((h.tabs ? text.replace(/^\t+/, '') : text) === h.word) { if (!h.quoted) bodies.push(line.slice(start, lineStart)); break; }
      }
    }
    for (const body of bodies) parts.subs.push(...substitutionsIn(body));
    return at;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    // A command substitution, unquoted or in double quotes (single quotes keep it as text).
    if (quote !== '\'' && ((ch === '$' && line[i + 1] === '(') || ch === '`')) {
      const end = ch === '`' ? backtickEnd(line, i + 1) : substitutionEnd(line, i + 2);
      parts.subs.push(ch === '`' ? line.slice(i + 1, end).replace(/\\`/g, '`') : line.slice(i + 2, end));
      word += line.slice(i, end + 1); inWord = true;
      i = end;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && line[i + 1] === '\n') i++;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += ch;
      continue;
    }
    if (ch === '\'' || ch === '"') { quote = ch; inWord = true; continue; }
    if (ch === '\\' && line[i + 1] === '\n') { i++; continue; }
    if (ch === '\\' && line[i + 1] === '\r' && line[i + 2] === '\n') { i += 2; continue; }
    if (ch === '\\' && i + 1 < line.length) { word += line[++i]; inWord = true; continue; }
    if (ch === '#' && !inWord) { while (i + 1 < line.length && line[i + 1] !== '\n') i++; continue; }
    if (ch === '<' && line[i + 1] === '<' && line[i + 2] === '<') { endWord(); i += 2; continue; }
    if (ch === '<' && line[i + 1] === '<') {
      // A heredoc: its delimiter, bare or quoted, with `<<-` stripping leading tabs from the lines.
      const m = HEREDOC.exec(line.slice(i));
      if (m) { heredocs.push(heredocOf(m)); endWord(); i += m[0].length - 1; continue; }
    }
    if (ch === '\n' && heredocs.length) {
      endPart();
      const at = heredocsEnd(i + 1);
      heredocs.length = 0;
      // No end line: not a heredoc after all, so the next lines are read as commands.
      if (at >= 0) i = at - 1 - 1;
      continue;
    }
    if (ch === '\n' || ch === ';' || ch === '&' || ch === '|') { endPart(); continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { endWord(); continue; }
    word += ch; inWord = true;
  }
  endPart();
  return parts;
}

// Where the `$(` whose text starts at `from` closes: the index of its `)`, or the end of the line when it never
// closes. Quotes, nested `(…)` and a heredoc's text inside it are its own, so a `)` in them does not close it.
function substitutionEnd(line, from) {
  let depth = 1;
  let quote = null;
  const heredocs = [];
  for (let i = from; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"') i++;
      continue;
    }
    if (ch === '\\') { i++; continue; }
    if (ch === '\'' || ch === '"') { quote = ch; continue; }
    if (ch === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
      const m = HEREDOC.exec(line.slice(i));
      if (m) { heredocs.push(heredocOf(m)); i += m[0].length - 1; continue; }
    }
    if (ch === '\n' && heredocs.length) {
      // Skip each heredoc's text to its end line; one that never ends is not a heredoc.
      let at = i + 1;
      let found = true;
      for (const h of heredocs) {
        for (;;) {
          if (at > line.length) { found = false; break; }
          const eol = line.indexOf('\n', at);
          const text = line.slice(at, eol < 0 ? line.length : eol).replace(/\r$/, '');
          at = eol < 0 ? line.length + 1 : eol + 1;
          if ((h.tabs ? text.replace(/^\t+/, '') : text) === h.word) break;
        }
        if (!found) break;
      }
      heredocs.length = 0;
      if (found) i = at - 2;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return line.length;
}

// The commands of every `$(…)` and backticks in a heredoc's text, where quotes are plain characters and `\`
// keeps the next one as text.
function substitutionsIn(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if ((ch === '$' && text[i + 1] === '(') || ch === '`') {
      const end = ch === '`' ? backtickEnd(text, i + 1) : substitutionEnd(text, i + 2);
      out.push(ch === '`' ? text.slice(i + 1, end).replace(/\\`/g, '`') : text.slice(i + 2, end));
      i = end;
    }
  }
  return out;
}

// Where the backtick whose text starts at `from` closes, or the end of the line.
function backtickEnd(line, from) {
  for (let i = from; i < line.length; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === '`') return i;
  }
  return line.length;
}

// Words that only set up how a command runs, skipped to find the command itself: `env`, `VAR=value`, `sudo`,
// `command`, `exec`, `time`, `nohup`, `nice`, `timeout` with its duration, the shell's own words (`then`, `do`,
// `else`, `{`, `!`), `xargs`, `stdbuf`, `watch`, and a `(` stuck to the front of the first word. The options of a prefix are skipped with
// it, and the value of one that takes a value (`sudo -u <user>`, `nice -n <n>`, `env -u <name>`).
const PREFIXES = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nohup', 'nice', 'xargs', 'stdbuf', 'watch', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '{', '!']);
const PREFIX_VALUE_OPTIONS = new Set(['-u', '-g', '-n', '-C', '-h', '-U', '-r', '-t', '-s', '-k', '-o', '--user', '--group', '--signal',
  '--kill-after', '--unset', '--chdir', '--adjustment', '--output']);
// A prefix whose letters mean something else (`xargs -r` and `-t` take no value, `sudo -E` none either) reads
// only its own options that take a value, never the shared list.
const PREFIX_OWN_VALUE_OPTIONS = {
  // `-J`, `-R` and `-S` are the BSD (macOS) xargs's.
  xargs: new Set(['-n', '-s', '-I', '-L', '-P', '-d', '-E', '-a', '-J', '-R', '-S', '--replace', '--max-lines', '--max-args', '--max-chars',
    '--max-procs', '--delimiter', '--arg-file', '--eof']),
  stdbuf: new Set(['-i', '-o', '-e', '--input', '--output', '--error']),
  watch: new Set(['-n', '--interval']),
};
const stripPrefix = (words) => {
  const w = words.slice();
  if (w.length && w[0].startsWith('(')) w[0] = w[0].replace(/^\(+/, '');
  let i = 0;
  for (;;) {
    while (i < w.length && w[i] === '') i++;
    if (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) { i++; continue; }
    if (i < w.length && (PREFIXES.has(w[i]) || w[i] === 'timeout')) {
      const isTimeout = w[i] === 'timeout';
      const own = PREFIX_OWN_VALUE_OPTIONS[w[i]];
      i++;
      const valued = own || PREFIX_VALUE_OPTIONS;
      while (i < w.length && w[i].startsWith('-')) i += valued.has(w[i]) ? 2 : 1;
      if (isTimeout) i++; // the duration
      continue;
    }
    return w.slice(i);
  }
};
const programOf = (word) => word.split(/[\\/]/).pop().replace(/\.(exe|cmd)$/i, '');

// How package runners start a program. `npx [-y] yadflow[@v] …` or `npx yad …` (and pnpx, bunx), `npx -p
// yadflow yad …`, `npm [opts] exec|x yadflow|yad -- …`, `pnpm [opts] exec|dlx …`, `pnpm yad …`, `yarn [opts]
// [workspace <name>] [exec|dlx|run] yad …`, `bun x|run yad …`. `yad` is the program the yadflow package
// installs, so a local install runs it as `npx yad`.
const NODE_VALUE_OPTIONS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-e', '--eval', '-p', '--print', '--input-type', '--conditions', '-C',
  '--env-file', '--env-file-if-exists', '--watch-path']);
const NPX_VALUE_OPTIONS = new Set(['-p', '--package', '-c', '--call', '--cache', '--registry', '--userconfig', '--prefix']);
// The options that take a value and may come before the subcommand or the program (`pnpm -C x yad …`,
// `npm -w web exec …`). pnpm's `-c` is `--shell-mode` and its `-w` is `--workspace-root`: neither takes one.
const RUNNER_VALUE_OPTIONS = new Set([...NPX_VALUE_OPTIONS, '-C', '--dir', '--cwd', '--filter', '-F', '--workspace', '-w',
  '--filter-prod', '--loglevel', '--reporter', '--workspace-concurrency', '--include', '--exclude', '--from', '-j', '--jobs']);
const PNPM_VALUE_OPTIONS = new Set([...RUNNER_VALUE_OPTIONS].filter((o) => o !== '-c' && o !== '-w'));
// bun's own options that take a value (`bun --env-file .env run …`).
const BUN_VALUE_OPTIONS = new Set([...RUNNER_VALUE_OPTIONS, '--env-file', '--preload', '-r', '--config', '-e', '--eval', '--tsconfig-override']);
const isYadflow = (x) => /^yadflow(@.*)?$/.test(x);
const dropDashDash = (args) => (args[0] === '--' ? args.slice(1) : args);
// The first plain word of `w` at or after `from`, past options and the value of an option that takes one.
const plainAfter = (w, from, valued) => {
  let i = from;
  while (i < w.length && w[i].startsWith('-')) i += valued.has(w[i]) ? 2 : 1;
  return i;
};

// A package runner's parts: `{prog, start, valued}`, where `start` is the index its options before the program
// begin at (just past `exec`, `dlx`, `run`, `x` or `workspace <name>`), or null when `w` is not a runner that
// starts a program.
function runnerOf(w) {
  if (!w.length) return null;
  const prog = programOf(w[0]);
  const valued = prog === 'pnpm' ? PNPM_VALUE_OPTIONS : prog === 'bun' ? BUN_VALUE_OPTIONS : RUNNER_VALUE_OPTIONS;
  if (prog === 'npx' || prog === 'pnpx' || prog === 'bunx') return { prog, start: 1, valued };
  if (prog === 'bun') {
    // bun's own options may come first: `bun --filter web run …`, `bun --bun x …`.
    const k = plainAfter(w, 1, valued);
    return w[k] === 'x' || w[k] === 'run' ? { prog, start: k + 1, valued, sub: w[k] } : null;
  }
  if (prog === 'npm') {
    const k = plainAfter(w, 1, valued);
    return w[k] === 'exec' || w[k] === 'x' ? { prog, start: k + 1, valued, sub: w[k] } : null;
  }
  if (prog === 'pnpm' || prog === 'yarn') {
    let k = plainAfter(w, 1, valued);
    // `yarn workspace <name> <program> …` runs the program in that workspace; `yarn workspaces foreach [opts]
    // run|exec …` runs it in each one.
    if (prog === 'yarn' && w[k] === 'workspace') k = plainAfter(w, k + 2, valued);
    else if (prog === 'yarn' && w[k] === 'workspaces' && w[k + 1] === 'foreach') k = plainAfter(w, k + 2, valued);
    const subs = prog === 'yarn' ? ['exec', 'dlx', 'run'] : ['exec', 'dlx'];
    return subs.includes(w[k]) ? { prog, start: k + 1, valued, sub: w[k] } : { prog, start: k, valued };
  }
  return null;
}

// The command line a shell runs from its `-c` argument (`bash -c "yad gate approve …"`), or null. A package
// runner's `-c`/`--call` before its program is one too (`npx -c '<line>'`, `npm exec -c '<line>'`), and
// `pnpm exec|dlx -c` runs the rest of its words as a shell line. A program's own `-c` (`vitest -c x`) is not.
function shellC(words) {
  const w = stripPrefix(words);
  if (!w.length) return null;
  const prog = programOf(w[0]);
  if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(prog)) {
    const c = w.findIndex((x, n) => n > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
    return c > 0 && c + 1 < w.length ? w[c + 1] : null;
  }
  const r = runnerOf(w);
  if (!r) return null;
  if (r.prog === 'pnpm') {
    if (r.sub !== 'exec' && r.sub !== 'dlx') return null;
    // pnpm reads `-c` before or after `exec`: every option up to the program.
    for (let i = 1; i < w.length; i++) {
      if (w[i] === r.sub && i === r.start - 1) continue;
      if (!w[i].startsWith('-')) return null;
      if (w[i] === '-c' || w[i] === '--shell-mode') return i + 1 < w.length ? w.slice(i + 1).join(' ') : null;
      if (r.valued.has(w[i])) i++;
    }
    return null;
  }
  if (!['npx', 'pnpx', 'npm'].includes(r.prog)) return null;
  for (let i = r.start; i < w.length && w[i].startsWith('-'); i++) {
    if (w[i] === '-c' || w[i] === '--call') return i + 1 < w.length ? w[i + 1] : null;
    if (/^(--call|-c)=/.test(w[i])) return w[i].slice(w[i].indexOf('=') + 1);
    if (r.valued.has(w[i])) i++;
  }
  return null;
}

// The yad argv after the program, or null when the part does not run yad: `yad …` (any path, `yad.mjs` too),
// yadflow's `yad` through a package runner (`runnerOf`), or `node [options] …/yad.mjs …`.
function yadArgs(words) {
  const w = stripPrefix(words);
  if (!w.length) return null;
  const prog = programOf(w[0]);
  if (prog === 'yad' || prog === 'yad.mjs') return w.slice(1);
  const r = runnerOf(w);
  if (r) {
    const i = plainAfter(w, r.start, r.valued);
    return i < w.length && (isYadflow(w[i]) || programOf(w[i]) === 'yad') ? dropDashDash(w.slice(i + 1)) : null;
  }
  if (prog === 'node') {
    const i = plainAfter(w, 1, NODE_VALUE_OPTIONS);
    return i < w.length && programOf(w[i]) === 'yad.mjs' ? w.slice(i + 1) : null;
  }
  return null;
}

// The command words and flag names of yad's argv, read as bin/yad.mjs reads it: flags may come anywhere, a
// flag that takes a value (`--dir <path>`, `-m <text>`) takes the word after it, and `--` is a word like any
// other (yad has no end-of-flags marker). `help` is set for `--help`/`-h`: that run only prints the help.
function yadWords(args) {
  const words = [];
  const flags = [];
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') { help = true; continue; }
    if (a.startsWith('--') && a !== '--') {
      const name = a.split('=')[0];
      flags.push(name.slice(2));
      if (!a.includes('=') && (VALUE_FLAGS.has(name) || LIST_FLAGS.has(name))) i++;
    } else if (a === '-m') i++;
    else if (a.startsWith('-') && a !== '--') continue;
    else if (words.length < 2) words.push(a);
  }
  return { words, flags, help };
}

// The git subcommand and its arguments, past git's own options (`-C <dir>`, `-c <k=v>`, `--git-dir <dir>`, …).
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
function gitArgs(words) {
  const w = stripPrefix(words);
  if (!w.length || programOf(w[0]) !== 'git') return null;
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(w[i]) ? 2 : 1;
  return w.slice(i);
}

// Is this part a force push? `git push … --force | -f | --force-with-lease[=…] | --force-if-includes | a refspec
// starting with `+`` | --mirror. The value of an option that takes one (`-o <text>`) is text, never a refspec.
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
function forcePush(words) {
  const g = gitArgs(words);
  if (!g || g[0] !== 'push' || g.includes('--help') || g.includes('-h')) return false;
  for (let i = 1; i < g.length; i++) {
    const a = g[i];
    if (PUSH_VALUE_OPTIONS.has(a)) { i++; continue; }
    // `--mirror` makes the remote match this clone: it overwrites and deletes refs there, as a force push does.
    if (a === '--force' || a === '--mirror' || a === '--force-if-includes' || /^--force-with-lease(=|$)/.test(a)
      || (/^-[A-Za-z]+$/.test(a) && a.includes('f')) || /^\+/.test(a)) return true;
  }
  return false;
}

// Does this part skip the git hooks, the ledger guard's door? `git commit --no-verify` or `-n` (alone or in a
// cluster such as `-nm`), `git -c core.hooksPath=… <any>`, `git config [scope] core.hooksPath <path>`, or `YAD_HOOK_DISABLE=…` set for the command or
// exported. That is what `yad commit --manual` does, with the reason recorded: the person's.
const COMMIT_VALUE_OPTIONS = new Set(['-m', '--message', '-F', '--file', '-t', '--template', '-c', '--reedit-message', '-C',
  '--reuse-message', '--author', '--date', '--fixup', '--squash', '--trailer', '--cleanup']);
function hookSkip(words) {
  const w = stripPrefix(words);
  const lead = words.slice(0, words.length - w.length);
  const disables = (x) => /^YAD_HOOK_DISABLE=./.test(x);
  if (lead.some(disables)) return true;
  if (w.length && ['export', 'declare', 'typeset'].includes(w[0]) && w.slice(1).some(disables)) return true;
  if (!w.length || programOf(w[0]) !== 'git') return false;
  for (let i = 1; i < w.length && w[i].startsWith('-'); i++) {
    if (w[i] === '-c' && /^core\.hookspath=/i.test(w[i + 1] || '')) return true;
    if (GIT_VALUE_OPTIONS.has(w[i])) i++;
  }
  const g = gitArgs(words);
  if (!g || g.includes('--help') || g.includes('-h')) return false;
  // Setting it, not reading it: a value follows the key (`git config --unset core.hooksPath` puts it back).
  if (g[0] === 'config') {
    const k = g.findIndex((x) => /^core\.hookspath$/i.test(x));
    return k > 0 && k + 1 < g.length && !g.slice(1, k).some((x) => /^--(unset|unset-all|get|get-all|get-regexp)$/.test(x));
  }
  if (g[0] !== 'commit') return false;
  for (let i = 1; i < g.length; i++) {
    const a = g[i];
    if (a === '--') break;
    if (COMMIT_VALUE_OPTIONS.has(a)) { i++; continue; }
    if (a === '--no-verify') return true;
    if (/^-[A-Za-z]+$/.test(a)) {
      // A short cluster: the letters up to the first one that takes a value (`-mn` is `-m n`, `-uno` is `-u no`).
      for (const c of a.slice(1)) {
        if (c === 'n') return true;
        if ('mFtcCuS'.includes(c)) break;
      }
    }
  }
  return false;
}

// Is this part an approval or a merge of a PR/MR on the platform? `gh pr review … --approve|-a`, `gh pr merge`,
// `glab mr approve`, `glab mr merge` (or `accept`), and the same through the API: a PUT to `gh api …/pulls/<n>/merge`
// (a plain GET there only asks whether it was merged), an approving review (`…/pulls/<n>/reviews` with
// `event=APPROVE`), a PUT to `glab api …/merge_requests/<n>/merge` or a POST to `…/approve`, and the GraphQL merge
// and approve mutations. The person's, even when the agent's login could do it. The options
// that take a value (`-R <repo>`) are skipped with it, so `gh -R o/r pr merge 5` is read as `pr merge`.
const PLATFORM_VALUE_OPTIONS = new Set(['-R', '--repo', '-b', '--body', '-F', '--body-file', '-t', '--subject', '-m', '--message', '--match-head-commit', '--author-email', '--sha',
  '-f', '--field', '--raw-field', '-X', '--method', '-H', '--header', '--input', '-q', '--jq', '--template', '--hostname', '--cache']);
// The HTTP method of a `gh api`/`glab api` call: `-X PUT`, `-XPUT`, `--method PUT` or `--method=PUT`; else POST
// when fields are sent, as both tools do; else GET.
function apiMethod(w) {
  for (let i = 1; i < w.length; i++) {
    if ((w[i] === '-X' || w[i] === '--method') && i + 1 < w.length) return w[i + 1].toUpperCase();
    const m = /^(?:-X=?|--method=)(.+)$/.exec(w[i]);
    if (m) return m[1].toUpperCase();
  }
  return w.some((x) => /^(-f|-F|--field|--raw-field|--input)$/.test(x) || /^(--(raw-)?field=|-[fF].)/.test(x)) ? 'POST' : 'GET';
}
function apiApproval(prog, w, rest) {
  if (rest[0] !== 'api') return false;
  const path = rest[1] || '';
  if (path === 'graphql') {
    return w.some((x) => /\b(mergePullRequest|enablePullRequestAutoMerge|mergeRequestAccept|mergeRequestApprove)\b/.test(x)
      || /\b(addPullRequestReview|submitPullRequestReview)\b[\s\S]*\bAPPROVE\b/.test(x));
  }
  const method = apiMethod(w);
  if (prog === 'glab') {
    return (method === 'PUT' && /merge_requests\/\d+\/merge(\?|$)/.test(path))
      || (method === 'POST' && /merge_requests\/\d+\/approve(\?|$)/.test(path));
  }
  if (method === 'PUT' && /\/pulls\/\d+\/merge(\?|$)/.test(path)) return true;
  return /\/pulls\/\d+\/reviews(\/\d+\/events)?(\?|$)/.test(path) && w.some((x) => /^(?:--(?:raw-)?field=|-[fF]=?)?event=APPROVE$/i.test(x));
}
function platformApproval(words) {
  const w = stripPrefix(words);
  if (!w.length || w.includes('--help') || w.includes('-h')) return false;
  const prog = programOf(w[0]);
  if (prog !== 'gh' && prog !== 'glab') return false;
  const rest = [];
  const options = [];
  for (let i = 1; i < w.length; i++) {
    if (w[i].startsWith('-')) { options.push(w[i]); if (PLATFORM_VALUE_OPTIONS.has(w[i])) i++; continue; }
    rest.push(w[i]);
  }
  if (apiApproval(prog, w, rest)) return true;
  if (prog === 'gh') {
    if (rest[0] !== 'pr') return false;
    // `--disable-auto` only turns auto-merge off: it merges nothing.
    if (rest[1] === 'merge') return !options.includes('--disable-auto');
    // An option, never an option's value (`--body "-a"` is text).
    return rest[1] === 'review' && options.some((x) => /^--approve(=|$)/.test(x) || x === '-a');
  }
  // `glab mr accept` is `glab mr merge` by another name.
  return rest[0] === 'mr' && ['approve', 'merge', 'accept'].includes(rest[1]);
}

// The verdict for one shell command line: `{allow: true}` or `{allow: false, message}`.
export function agentGuardDecision(line, depth = 0) {
  if (typeof line !== 'string' || !line.trim()) return { allow: true };
  const parts = shellParts(line);
  // The commands a `$(…)` or backticks run are judged too (a few levels deep at most).
  if (depth < 3) {
    for (const sub of parts.subs) {
      const v = agentGuardDecision(sub, depth + 1);
      if (!v.allow) return v;
    }
  }
  for (const part of parts) {
    // `bash -c "<line>"`: the line it runs is judged too (a few levels deep at most).
    const inner = shellC(part);
    if (inner !== null && depth < 3) {
      const v = agentGuardDecision(inner, depth + 1);
      if (!v.allow) return v;
    }
    const args = yadArgs(part);
    if (args) {
      const { words, flags, help } = yadWords(args);
      if (!help && classify(words, flags) === 'human-only') {
        return { allow: false, message: `yad agent guard: \`yad ${words.join(' ')}${flags.includes('manual') ? ' --manual' : ''}\` is the person's to run, never the agent's (an approval, a gate comment or advance or reopen, or a commit past the ledger guard). Ask the person to run it themselves — in Claude Code they type it with \`!\` in front — then confirm by reading (\`yad gate status\` / \`yad guide --json\`).` };
      }
    }
    if (platformApproval(part)) {
      return { allow: false, message: 'yad agent guard: approving or merging a PR/MR is the person\'s, never the agent\'s (the yadflow rules), even when your login could. Give the person the link and the exact steps, wait, then confirm by reading (`yad gate status` / `yad guide --json`).' };
    }
    if (hookSkip(part)) {
      return { allow: false, message: 'yad agent guard: skipping the git hooks (`--no-verify`, `-n`, `YAD_HOOK_DISABLE`, `core.hooksPath`) is the person\'s, never the agent\'s (the yadflow rules): it is the door past the ledger guard. When a hook refuses a commit, follow its message; if the commit must go through, the person runs `yad commit --manual --reason "<why>"` themselves (`!` in front in Claude Code).' };
    }
    if (forcePush(part)) {
      return { allow: false, message: 'yad agent guard: a force push is never the agent\'s (the yadflow rules). Tell the person why the push was refused and what a force push would overwrite; if it is needed, they run it themselves.' };
    }
  }
  return { allow: true };
}

// The shell command in a harness's payload: Claude Code's `tool_input.command` (tool `Bash`), Cursor's
// `command` (`beforeShellExecution`). Anything else is not a shell call: null.
export function payloadCommand(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.tool_input?.command === 'string') return payload.tool_input.command;
  if (typeof payload.command === 'string') return payload.command;
  return null;
}

// Cursor's payload names its event; Claude Code's says `PreToolUse`.
export const isCursorPayload = (payload) => payload?.hook_event_name === 'beforeShellExecution' || typeof payload?.cursor_version === 'string';
