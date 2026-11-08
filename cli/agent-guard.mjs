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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, readAllowList } from './agent-rules.mjs';
import { VALUE_FLAGS, LIST_FLAGS } from './argv-flags.mjs';

// A heredoc's `<<` and its end word: bare (`EOF`), quoted (`'EOF'`, `"EOF"`, `E"OF"`) or escaped (`\EOF`). Any
// quote or `\` in the word makes the text plain text, as bash reads it: nothing in it runs. The word is every
// character the shell reads as one word (#492): anything but a space, a tab, a newline or `; & | ( ) < >` — so
// `EOF#`, `EOF+` and a CR (`EOF\r`, from a line written with CRLF) are part of it. Sticky, matched in place
// (`heredocAt`): slicing the rest of the line for each `<<` made a long line take quadratic time.
const HEREDOC = /<<(-?)[ \t]*((?:\\.|'[^'\n]*'|"[^"\n]*"|[^ \t\n;&|()<>'"\\])+)/y;
// An end word holding `$` or a backtick is read as no heredoc (#492 review): inside `bash -c "…"` the outer shell
// expands it first (`EOF$x` becomes `EOF`), so where it ends cannot be known here, and the lines after it are
// judged as commands instead.
// It is still a redirect (`<<"E$x" gh pr merge 1` runs gh), so the `<<word` is read past either way: only no
// heredoc is recorded for it (`expands`).
const heredocAt = (line, i) => { HEREDOC.lastIndex = i; const m = HEREDOC.exec(line); if (m) m.expands = /[$`]/.test(m[2]); return m; };

// Where each line of `text` starts, by its exact text and by its text with leading tabs removed (`<<-`), so a
// heredoc's end line is found by a binary search, not by scanning on: a line of many heredocs with different
// end words is read in near-linear time (#492). `endAfter` gives the index just past the first line at or
// after `at` that reads `word`, or -1.
function lineIndex(text) {
  const exact = new Map(), stripped = new Map();
  for (let at = 0; at <= text.length;) {
    const eol = text.indexOf('\n', at);
    const t = text.slice(at, eol < 0 ? text.length : eol);
    for (const [map, k] of [[exact, t], [stripped, t.replace(/^\t+/, '')]]) { const list = map.get(k); if (list) list.push(at); else map.set(k, [at]); }
    at = eol < 0 ? text.length + 1 : eol + 1;
  }
  return {
    endAfter(word, tabs, at) {
      const list = (tabs ? stripped : exact).get(word);
      if (!list) return -1;
      let lo = 0, hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < at) lo = mid + 1; else hi = mid; }
      if (lo === list.length) return -1;
      const eol = text.indexOf('\n', list[lo]);
      return eol < 0 ? text.length + 1 : eol + 1;
    },
  };
}
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
  // The end line must match exactly: `EOF\r` ends only a heredoc whose word is `EOF\r`, as in bash and zsh (a
  // shell that drops CRs is the other reading, judged by agentGuardDecision). A heredoc whose end line never
  // comes is ended by the shell at the end of the input, and an unquoted one still runs its `$(…)` there: those
  // are judged too, as the rest of the line is also read as commands.
  let index = null;
  let restFrom = -1;
  const heredocsEnd = (from) => {
    index ??= lineIndex(line);
    let at = from;
    const bodies = [];
    for (const h of heredocs) {
      const start = at;
      const next = index.endAfter(h.word, h.tabs, at);
      if (next < 0) {
        // Once is enough: a later heredoc that never ends starts further on, inside text already judged.
        if (restFrom < 0 && heredocs.some((x) => !x.quoted)) { restFrom = from; parts.subs.push(...substitutionsIn(line.slice(from))); }
        return -1;
      }
      if (!h.quoted) bodies.push(line.slice(start, line.lastIndexOf('\n', next - 2) + 1 || start));
      at = next;
    }
    for (const body of bodies) parts.subs.push(...substitutionsIn(body));
    return at;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    // A command substitution, unquoted or in double quotes (single quotes keep it as text).
    if (quote !== '\'' && ((ch === '$' && line[i + 1] === '(') || ch === '`')) {
      const end = ch === '`' ? backtickEnd(line, i + 1) : substitutionEnd(line, i + 2, () => (index ??= lineIndex(line)));
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
    // `\` + CR + LF is NOT a line join: bash and zsh read an escaped CR, then run the next line as its own
    // command. So it falls through to the escape below (the CR is a character of the word), and the LF ends the part.
    if (ch === '\\' && i + 1 < line.length) { word += line[++i]; inWord = true; continue; }
    // A `#` starts a comment only where a word starts after a space, a tab, a newline, `;`, `&` or `|` (or at the
    // start): right after `(` or `)` it is text to zsh's globs and to bash's `[[ =~ ]]` (#492 review).
    if (ch === '#' && !inWord && (i === 0 || /[ \t\n;&|]/.test(line[i - 1]))) { while (i + 1 < line.length && line[i + 1] !== '\n') i++; continue; }
    if (ch === '<' && line[i + 1] === '<' && line[i + 2] === '<') { endWord(); i += 2; continue; }
    if (ch === '<' && line[i + 1] === '<') {
      // A heredoc: its delimiter, bare or quoted, with `<<-` stripping leading tabs from the lines.
      const m = heredocAt(line, i);
      if (m) { if (!m.expands) heredocs.push(heredocOf(m)); endWord(); i += m[0].length - 1; continue; }
    }
    if (ch === '\n' && heredocs.length) {
      endPart();
      const at = heredocsEnd(i + 1);
      heredocs.length = 0;
      // No end line: not a heredoc after all, so the next lines are read as commands.
      if (at >= 0) i = at - 1 - 1;
      continue;
    }
    // `(` and `)` end a part too (#492): `<(cmd)`, `>(cmd)`, `f(){ cmd; }` and `case x in x) cmd;;` run `cmd`.
    if (ch === '\n' || ch === ';' || ch === '&' || ch === '|' || ch === '(' || ch === ')') { endPart(); continue; }
    // A CR is a character of the word, as bash and zsh read it (#492): `x\r#` is one word, so its `#` starts no
    // comment. A shell that drops CRs is the other reading, judged by agentGuardDecision.
    if (ch === ' ' || ch === '\t') { endWord(); continue; }
    word += ch; inWord = true;
  }
  endPart();
  return parts;
}

// Where the `$(` whose text starts at `from` closes: the index of its `)`, or the end of the line when it never
// closes. Quotes, nested `(…)` and a heredoc's text inside it are its own, so a `)` in them does not close it.
// `getIndex` gives the line index of `line`, built once per text and shared by every `$(` in it (#492 review: one
// per call made many `$(…)` holding heredocs take quadratic time).
function substitutionEnd(line, from, getIndex) {
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
      const m = heredocAt(line, i);
      if (m) { if (!m.expands) heredocs.push(heredocOf(m)); i += m[0].length - 1; continue; }
    }
    if (ch === '\n' && heredocs.length) {
      // Skip each heredoc's text to its end line; one that never ends is not a heredoc.
      const index = getIndex();
      let at = i + 1;
      let found = true;
      for (const h of heredocs) {
        const next = index.endAfter(h.word, h.tabs, at);
        if (next < 0) { found = false; break; }
        at = next;
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
  let index = null;
  const getIndex = () => (index ??= lineIndex(text));
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if ((ch === '$' && text[i + 1] === '(') || ch === '`') {
      const end = ch === '`' ? backtickEnd(text, i + 1) : substitutionEnd(text, i + 2, getIndex);
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
// Bash and zsh read a CR as a character of a word; a shell that drops CRs (Git Bash with `igncr`) does not, and
// reads `\` + CR + LF as a line join. Refuse under either reading (#353, #492): a line holding a CR is judged
// again with every CR removed, at every depth, since a `bash -c` string built from quoted pieces holds one only
// once its quotes are gone. A line too long to judge in a hook's time is refused, never let through.
export const MAX_JUDGED = 1_000_000;
export function agentGuardDecision(line, depth = 0) {
  if (typeof line === 'string' && line.length > MAX_JUDGED) {
    return { allow: false, message: `yad agent guard: this command is too long to judge (${line.length} characters, more than ${MAX_JUDGED}). Write what it carries to a file with your editor, or run it as separate commands.` };
  }
  if (typeof line === 'string' && line.includes('\r')) {
    const dropped = judgeLine(line.replace(/\r/g, ''), depth);
    if (!dropped.allow) return dropped;
  }
  // And with every `\` + newline join already made (CRs dropped first), so a `$\<LF>(` or an end word split by a
  // join (`EO\<LF>F`) reads as the shell joins it (#492 review). Inside single quotes a join is literal text:
  // judging it joined only refuses more.
  if (typeof line === 'string' && /\\\r?\n/.test(line)) {
    const joined = judgeLine(line.replace(/\r/g, '').replace(/\\\n/g, ''), depth);
    if (!joined.allow) return joined;
  }
  return judgeLine(line, depth);
}
const TOO_DEEP = { allow: false, message: 'yad agent guard: this command nests `$(…)`, backticks or `bash -c` too deep to judge. Run it as separate commands.' };
function judgeLine(line, depth) {
  if (typeof line !== 'string' || !line.trim()) return { allow: true };
  const parts = shellParts(line);
  // The commands a `$(…)` or backticks run are judged too, three levels deep; one deeper is refused (#492).
  if (parts.subs.length && depth >= 3) return TOO_DEEP;
  for (const sub of parts.subs) {
    const v = agentGuardDecision(sub, depth + 1);
    if (!v.allow) return v;
  }
  for (const part of parts) {
    // `bash -c "<line>"`: the line it runs is judged too, as deep; one deeper is refused.
    const inner = shellC(part);
    if (inner !== null && depth >= 3) return TOO_DEEP;
    if (inner !== null) {
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

// ---------------------------------------------------------------------------------------------------------------
// PRE-APPROVAL (E167, issue #353). The other half of the guard: a command line it can SEE only reads runs with no
// permission prompt. Claude Code's allow rules match the start of a command, so `Bash(gh api:*)` would also pass
// `gh api -X DELETE …`; this reads each word instead. It answers "allow" only when EVERY part of the line is one of
// the reads below, written in a form it knows; anything else gets no answer, which is the prompt the person had
// before. So a mistake here, or a hook that fails, costs a prompt, never a write. A team's own `deny` and `ask`
// rules still win over a hook's "allow" (Claude Code's rule), and `YAD_NO_PREAPPROVE=1` turns this half off.
//
// Never pre-approved, whatever the form: a secret, token, variable, key or webhook (the person's, HUMAN_ONLY_ACTS
// in cli/agent-rules.mjs), GraphQL (a mutation rides the same call as a query), any API call that is not a GET, a
// file written or a file read from outside the project, a `$(…)`, a `bash -c`, an env prefix, and any program not
// named here. What it lists is printed by `yad setup` and given to agents by `yad guide --json`.
export const PREAPPROVED = Object.freeze({
  api: 'gh api / glab api: a GET (no -X other than GET, no fields, no --input, --hostname or --cache, only an Accept header), not graphql, and no secrets, secure files, variables, tokens, keys, hooks, e-mails, triggers, integrations, services, credentials, Terraform state, schedules, CI logs, traces or artifacts, admin settings (application) or user in the path, with or without a .json-style suffix',
  git: 'git log, status, diff, show, rev-parse, ls-files, blame (no git option before them; no --output, --ext-diff, --textconv, --no-index, --contents, --show-signature or a shortening of one, no %G in a format, git diff paths inside the project; git still runs what its own config names, such as an external diff or fsmonitor)',
  jq: 'jq (a filter on the line, never from a file; no env, $ENV, import or include in it; files inside the project)',
  filters: 'head, tail, wc, grep (not -R), cut, uniq, tr, cat (files inside the project)',
  yad: 'the read-only yad commands of the settings allow list',
  gates: 'the read-only gates in checks/ (spec-link, contract-check, commit-message, lineage-check, epic-open, reconcile-debt-check, risk-map-check, verified-commits, ledger-guard, member-check), only while the file is the copy this yadflow ships',
  never: 'secrets, tokens, variables, keys, webhooks, GraphQL, API writes, file writes, $ (variables) outside single quotes, brace lists, globs, ( ), a word starting with ~ or =, $(…), bash -c, env prefixes',
});
export const PREAPPROVED_GATES = Object.freeze(['spec-link.sh', 'contract-check.sh', 'commit-message.sh', 'lineage-check.sh', 'epic-open.sh',
  'reconcile-debt-check.sh', 'risk-map-check.sh', 'verified-commits.sh', 'ledger-guard.sh', 'member-check.mjs']);
const SHIPPED_CHECKS = fileURLToPath(new URL('../skills/yad-checks/templates/checks/', import.meta.url));

// The line with its harmless redirects blanked out (`2>/dev/null`, `>/dev/null`, `&>/dev/null`, `2>&1`, `>&2`),
// or null when it has any other: a `>` to a file writes it, a `<` (a file, a heredoc, a here-string) or a
// process substitution feeds text from somewhere this does not judge. Quotes are respected, so the `>` in
// `jq '.a > 1'` is text. Null too for anything the shell EXPANDS before the program sees it, because the words
// judged here would not be the words run: a `$` outside single quotes (`"$GH_TOKEN"`, `${HOME}`, `$((…))`).
// Unquoted text is held to an ALLOW list of characters — letters, digits, `_ . / : @ % + , ^ ~ = -`, spaces and
// the separators — because bash and zsh each expand more than any list of bad ones names: a brace list
// (`{~/.ssh/id_rsa,x}`), a glob (`*`, `?`, `[`, which can reach a link out of the project), zsh's glob
// qualifiers (`file(e:cmd:)` runs cmd) and `=(cmd)` / `=ls`. So also: no `=` or `~` starting a word. One form is
// let through because neither shell expands it: a brace around one plain word (`{owner}` in a gh path, `@{u}`).
// Only a space, a tab and a newline break words: `\r`, `\v`, a no-break space are word characters to the shell,
// and a guard that read them as breaks would judge different words than the shell runs. No `#` either: where a
// comment starts depends on that same reading (a `\`-newline joins words), so a `#` gets the prompt.
// Not `^`: zsh's `extendedglob` (on in setups such as Prezto) makes it a glob.
const UNQUOTED_SAFE = /[A-Za-z0-9_./:@%+,~=-]/;
function blankHarmlessRedirects(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && (ch === '$' || ch === '`')) return null;
      else if (ch === '\\' && quote === '"') { out += ch + (line[i + 1] ?? ''); i++; continue; }
      out += ch;
      continue;
    }
    // An escaped character is literal, except a CR, which the guard's reader and the shell do not split alike.
    if (ch === '\\') { if (line[i + 1] === '\r') return null; out += ch + (line[i + 1] ?? ''); i++; continue; }
    if (ch === '\'' || ch === '"') { quote = ch; out += ch; continue; }
    const wordStart = i === 0 || /[ \t\n;|&]/.test(line[i - 1]);
    if ((ch === '~' || ch === '=') && (wordStart || /[=:]/.test(line[i - 1]))) return null;
    if (ch === '{') {
      const m = /^\{[A-Za-z0-9_]*\}/.exec(line.slice(i));
      if (!m) return null;
      out += m[0]; i += m[0].length - 1; continue;
    }
    if (ch === '<') return null;
    if (ch !== '>' && !UNQUOTED_SAFE.test(ch) && !/[ \t\n;|&]/.test(ch)) return null;
    if (ch !== '>') { out += ch; continue; }
    // The fd before it (`2>`) or `&>`: blanked with it.
    let start = out.length;
    while (start > 0 && /[0-9&]/.test(out[start - 1])) start--;
    if (start > 0 && !/[\s;|&]/.test(out[start - 1])) return null;
    let j = i + 1;
    if (line[j] === '(') return null;
    let dup = false;
    if (line[j] === '>') j++;
    else if (line[j] === '&') { dup = true; j++; } else if (line[j] === '|') return null;
    while (line[j] === ' ' || line[j] === '\t') j++;
    let k = j;
    while (k < line.length && !/[\s;|&<>()'"`$\\]/.test(line[k])) k++;
    const target = line.slice(j, k);
    if (!(dup ? /^[0-9]+$/.test(target) : target === '/dev/null')) return null;
    // The target ends the word: `2>/dev/null"x"` writes to `/dev/nullx`.
    if (k < line.length && !/[\s;|&)]/.test(line[k])) return null;
    out = `${out.slice(0, start)}${' '.repeat(i - start)}${' '.repeat(k - i)}`;
    i = k - 1;
  }
  return quote ? null : out;
}

// A file named on a command line, read inside the project only: no `~`, no `$`, nothing that resolves (through a
// link too) outside the project. `at` is `{ cwd, root }`: the word resolves from `cwd` and must land in `root`.
// `-` is standard input.
function insideProject(word, at) {
  if (word === '-') return true;
  if (!word || /^~|\$/.test(word)) return false;
  let root, cwd;
  // Both through realpath, so a link in either (macOS's /var is /private/var) does not make a file look outside.
  try { root = fs.realpathSync(at.root); cwd = fs.realpathSync(at.cwd); } catch { return false; }
  let full = path.resolve(cwd, word);
  try { full = fs.realpathSync(full); } catch { /* not there yet (or a glob): judged by its spelling */ }
  const rel = path.relative(root, full);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Read a program's arguments against its options: `bool` takes no value, `value` takes one (`-n 5`, `-n5`,
// `--lines=5`, `--lines 5`), `pairs` takes two (`--arg name value`). Short options may be clustered (`-in`) while
// they take no value. `numeric` allows `-5` (head, tail). Returns the plain operands, or null for an option it
// does not know: an unknown option is never guessed at.
function operandsOf(args, { bool = [], value = [], pairs = [], numeric = false } = {}) {
  const B = new Set(bool), V = new Set(value), P = new Set(pairs);
  const ops = [];
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { ops.push(...args.slice(i + 1)); break; }
    if (a === '-' || !a.startsWith('-')) { ops.push(a); continue; }
    if (a.startsWith('--')) {
      const [name, eq] = [a.split('=')[0], a.includes('=')];
      if (B.has(name) && !eq) continue;
      if (V.has(name)) { (values[name] ??= []).push(eq ? a.slice(a.indexOf('=') + 1) : args[++i]); if (!eq && i >= args.length) return null; continue; }
      if (P.has(name) && !eq) { (values[name] ??= []).push([args[i + 1], args[i + 2]]); i += 2; if (i >= args.length) return null; continue; }
      return null;
    }
    if (numeric && /^-[0-9]+$/.test(a)) continue;
    // A short option or a cluster of them.
    for (let c = 1; c < a.length; c++) {
      const o = `-${a[c]}`;
      if (B.has(o)) continue;
      if (V.has(o)) {
        const rest = a.slice(c + 1);
        (values[o] ??= []).push(rest || args[++i]);
        if (!rest && i >= args.length) return null;
        break;
      }
      return null;
    }
  }
  return { ops, values };
}

// The tools a part may run, each judged on its own words (the program name first, bare: `./gh` is a script).
const FILTERS = {
  head: { bool: ['-q', '-v', '--quiet', '--silent', '--verbose'], value: ['-n', '-c', '--lines', '--bytes'], numeric: true },
  tail: { bool: ['-q', '-v', '-r', '--quiet', '--silent', '--verbose'], value: ['-n', '-c', '--lines', '--bytes'], numeric: true },
  wc: { bool: ['-l', '-w', '-c', '-m', '-L', '--lines', '--words', '--bytes', '--chars', '--max-line-length'] },
  cut: { bool: ['-s', '-n', '--only-delimited', '--complement'], value: ['-d', '-f', '-c', '-b', '--delimiter', '--fields', '--characters', '--bytes', '--output-delimiter'] },
  cat: { bool: ['-n', '-b', '-s', '-v', '-e', '-t', '-A', '-E', '-T', '-u', '--number', '--number-nonblank', '--squeeze-blank', '--show-all'] },
  grep: { bool: ['-i', '-v', '-c', '-n', '-E', '-F', '-G', '-o', '-q', '-w', '-x', '-l', '-L', '-h', '-H', '-s', '-r', '-z', '-a', '-I',
    '--ignore-case', '--invert-match', '--count', '--line-number', '--extended-regexp', '--fixed-strings', '--only-matching', '--quiet', '--silent',
    '--word-regexp', '--line-regexp', '--files-with-matches', '--files-without-match', '--no-filename', '--with-filename', '--recursive', '--color', '--no-messages'],
  // Not -R / --dereference-recursive: it follows every link under the folder, out of the project too.
  value: ['-e', '-m', '-A', '-B', '-C', '--regexp', '--max-count', '--after-context', '--before-context', '--context', '--include', '--exclude', '--exclude-dir'] },
};
function filterPart(prog, args, at) {
  if (prog === 'uniq') {
    const r = operandsOf(args, { bool: ['-c', '-d', '-u', '-i', '--count', '--repeated', '--unique', '--ignore-case'] });
    // A second operand is the file uniq WRITES.
    return Boolean(r && r.ops.length <= 1 && r.ops.every((f) => insideProject(f, at)));
  }
  if (prog === 'tr') {
    const r = operandsOf(args, { bool: ['-d', '-s', '-c', '-C', '--delete', '--squeeze-repeats', '--complement'] });
    return Boolean(r && r.ops.length >= 1 && r.ops.length <= 2);
  }
  const spec = FILTERS[prog];
  if (!spec) return false;
  const r = operandsOf(args, spec);
  if (!r) return false;
  // grep's first operand is its pattern, unless one came with -e.
  const files = prog === 'grep' && !r.values['-e'] && !r.values['--regexp'] ? r.ops.slice(1) : r.ops;
  if (prog === 'grep' && !r.values['-e'] && !r.values['--regexp'] && !r.ops.length) return false;
  return files.every((f) => insideProject(f, at));
}

const JQ_SPEC = { bool: ['-r', '-j', '-c', '-n', '-s', '-e', '-a', '-S', '-C', '-M', '--raw-output', '--join-output', '--compact-output', '--null-input',
  '--slurp', '--exit-status', '--ascii-output', '--sort-keys', '--color-output', '--monochrome-output', '--tab', '--seq', '--stream', '--raw-output0', '--raw-input', '-R'],
// Not -f / --from-file: the filter would come from a file this does not read (it could hold `env`); not -L.
value: ['--indent'], pairs: ['--arg', '--argjson', '--slurpfile', '--rawfile'] };
// `env` and `$ENV` print the environment, where the platform tokens live; `import` and `include` read a file
// from any path. A filter that only names a field `.env` is caught too: it gets the prompt, which is safe.
const READS_ENV = /\benv\b|\bENV\b|\$__prog_args\b|\bimport\b|\binclude\b/;
function jqPart(args, at) {
  const r = operandsOf(args, JQ_SPEC);
  if (!r) return false;
  const filter = r.ops[0];
  if (filter === undefined || READS_ENV.test(filter)) return false;
  for (const [, f] of [...(r.values['--slurpfile'] ?? []), ...(r.values['--rawfile'] ?? [])]) if (!insideProject(f, at)) return false;
  return r.ops.slice(1).every((f) => insideProject(f, at));
}

// `gh api` / `glab api`: a GET of a REST path, with only the options that keep it one.
const API_SPEC = { bool: ['--paginate', '--slurp', '-i', '--include', '--silent', '--verbose'], value: ['-X', '--method', '-H', '--header', '-q', '--jq', '-t', '--template', '-p', '--preview'] };
// (Not --cache: it writes gh's cache files, outside the project.)
// Any path segment that names a secret, token, variable, key or hook (`gpg_keys`, `webhooks`, `access_tokens`),
// a person's e-mail addresses, a pipeline trigger (its token), an integration or service (a webhook URL), a
// credential, CI logs, traces and artifacts (masking there is best effort, or none), GitLab's secure files,
// Terraform state, pipeline schedules (one lists its variables with their values) and admin settings, and
// GitLab's `user` (the caller's private e-mail).
const NEVER_PATH = /secret|secure|token|variable|key|hook|email|trigger|integration|service|credential|terraform|schedule|artifact|^logs$|^trace$|^application$|^user$/i;
function apiPart(prog, args) {
  const r = operandsOf(args, API_SPEC);
  if (!r || r.ops.length !== 1) return false;
  const methods = [...(r.values['-X'] ?? []), ...(r.values['--method'] ?? [])];
  if (methods.some((m) => String(m).toUpperCase() !== 'GET')) return false;
  if ([...(r.values['-H'] ?? []), ...(r.values['--header'] ?? [])].some((h) => !/^accept\s*:/i.test(String(h)))) return false;
  if ([...(r.values['-q'] ?? []), ...(r.values['--jq'] ?? [])].some((q) => READS_ENV.test(String(q)))) return false;
  const endpoint = r.ops[0];
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(endpoint) || /\$/.test(endpoint)) return false;
  // Decoded first, then split, so `user%2F` is two parts; each part is tested as written and without a format
  // suffix (`user.json`).
  const bare = decodeURIComponent(endpoint.split(/[?#]/)[0]);
  if (bare.replace(/^\/+/, '') === 'graphql') return false;
  if (bare.split('/').some((seg) => NEVER_PATH.test(seg) || NEVER_PATH.test(seg.replace(/\.[A-Za-z0-9]*$/, '')))) return false;
  return apiMethod([prog, 'api', ...args]) === 'GET';
}

const GIT_READS = new Set(['log', 'status', 'diff', 'show', 'rev-parse', 'ls-files', 'blame']);
// The options that write a file, read one from anywhere, or run a program. git accepts any unique shortening of a
// long option in some commands (`git blame --conten=/etc/hosts` is `--contents`), so a long option is refused
// when it is a prefix of one of these, not only when it equals one. The short ones: blame's `-S <file>`,
// ls-files' `-X <file>`, diff's `-O<file>`, in any cluster.
const GIT_RISKY = ['--output', '--output-directory', '--ext-diff', '--textconv', '--no-index', '--contents', '--open-files-in-pager', '--ignore-revs-file',
  '--exclude-from', '--exclude-per-directory', '--pathspec-from-file', '--orderfile', '--show-signature', '--rotate-to', '--skip-to'];
// Real options that happen to begin a risky one: allowed as written.
const GIT_EXACT_SAFE = new Set(['--text', '--ignore-rev', '--output-indicator-new', '--output-indicator-old', '--output-indicator-context']);
// The short options that read a file, by command: blame's `-S <file>`, ls-files' `-X <file>`, `-O<file>` (diff's
// order file). `git log -S <text>` is a search, not a file, so it stays.
const GIT_RISKY_SHORT = { blame: 'S', 'ls-files': 'X', diff: 'O', log: 'O', show: 'O' };
function gitPart(args, at) {
  if (!GIT_READS.has(args[0])) return false;
  const shortRisk = GIT_RISKY_SHORT[args[0]] ?? '';
  let afterDashes = false;
  for (const a of args.slice(1)) {
    if (a === '--') { afterDashes = true; continue; }
    // `%G…` in a format makes git check signatures, which runs gpg.
    if (/%G/.test(a)) return false;
    if (!afterDashes && a.startsWith('--')) {
      const name = a.split('=')[0];
      if (!GIT_EXACT_SAFE.has(name) && name.length > 2 && GIT_RISKY.some((r) => r.startsWith(name))) return false;
    } else if (!afterDashes && a.startsWith('-') && shortRisk && new RegExp(`^-[A-Za-z]*[${shortRisk}]`).test(a)) return false;
    // `git diff` turns to --no-index by itself when a path is outside the repo, and prints both files: every path
    // it is given must be inside the project. A ref (`main`, `origin/main`, `HEAD~1`) reads as one inside.
    else if (args[0] === 'diff' && (afterDashes || !a.startsWith('-')) && !insideProject(a, at)) return false;
  }
  return true;
}

// A read gate run from checks/, unchanged from the copy this yadflow ships.
function gatePart(prog, args, at) {
  const file = args[0] ?? '';
  const name = file.replace(/^\.\//, '');
  const m = /^checks\/([A-Za-z0-9._-]+)$/.exec(name);
  if (!m || !PREAPPROVED_GATES.includes(m[1])) return false;
  if (m[1].endsWith('.mjs') ? prog !== 'node' : !(prog === 'bash' || prog === 'sh')) return false;
  if (!insideProject(name, at)) return false;
  try {
    return fs.readFileSync(path.resolve(at.cwd, name)).equals(fs.readFileSync(path.join(SHIPPED_CHECKS, m[1])));
  } catch { return false; }
}

function yadPart(args) {
  const { words, flags } = yadWords(args);
  // yad's own reading of the words and flags must be a read too (`check --fix` is not, whatever the prefix).
  if (classify(words, flags) !== 'read') return false;
  const key = words.join(' ');
  return readAllowList().some((rule) => {
    const k = rule.slice('Bash(yad '.length, -':*)'.length);
    return key === k || key.startsWith(`${k} `);
  });
}

// What one part of the line is, when it is a read this pre-approves; else null.
function readKind(words, at) {
  if (!words.length) return null;
  const [prog, ...args] = words;
  // A bare program name: no path (a script that shares a name), no `VAR=value`, no prefix (`env`, `sudo`, …).
  if (!/^[a-z][a-z0-9_-]*$/.test(prog) || PREFIXES.has(prog)) return null;
  if ((prog === 'gh' || prog === 'glab') && args[0] === 'api') return apiPart(prog, args.slice(1)) ? `${prog} api GET` : null;
  if (prog === 'git') return gitPart(args, at) ? `git ${args[0]}` : null;
  if (prog === 'jq') return jqPart(args, at) ? 'jq' : null;
  if (prog === 'yad') return yadPart(args) ? 'a read-only yad command' : null;
  if (prog === 'bash' || prog === 'sh' || prog === 'node') return gatePart(prog, args, at) ? `the ${args[0].replace(/^\.\/|^checks\//g, '')} gate` : null;
  return filterPart(prog, args, at) ? prog : null;
}

// `{ preapproved: true, reason }` when every part of the line is a read named above, else `{ preapproved: false }`.
// It never judges a refusal: the caller asks `agentGuardDecision` first, and a refused line is never pre-approved.
// `cwd` is where the line runs (files resolve from it); `root` is the project, and `cwd` must be inside it — an
// agent that changed to `/` would otherwise make every file "inside".
export function agentGuardPreapproval(line, { cwd = process.cwd(), root = cwd } = {}) {
  const no = { preapproved: false };
  try {
    if (typeof line !== 'string' || !line.trim() || !agentGuardDecision(line).allow) return no;
    const at = { cwd: path.resolve(root, cwd), root };
    if (!insideProject('.', at)) return no;
    const clean = blankHarmlessRedirects(line);
    if (clean === null) return no;
    const parts = shellParts(clean);
    if (!parts.length || parts.subs.length || clean.includes('`') || /\$\(/.test(clean)) return no;
    const kinds = [];
    for (const words of parts) {
      const kind = readKind(words, at);
      if (!kind) return no;
      if (!kinds.includes(kind)) kinds.push(kind);
    }
    return { preapproved: true, reason: kinds.join(', ') };
  } catch {
    return no;
  }
}
