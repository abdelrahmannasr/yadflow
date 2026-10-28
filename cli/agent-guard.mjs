// The agent guard (E158): a hook that runs before an AI agent's shell command, in Claude Code (`PreToolUse`,
// matcher `Bash`) and Cursor (`beforeShellExecution`), and refuses two kinds of command:
//   - a yad command only the person may run (`classify` in cli/agent-rules.mjs says `human-only`: an
//     approval, a gate comment or advance or reopen, a commit past the ledger guard);
//   - approving or merging a PR/MR on the platform (`gh pr review --approve`, `gh pr merge`, `glab mr approve`,
//     `glab mr merge`): the person's, even when the agent's login could;
//   - a force push (`git push --force`, `-f`, `--force-with-lease`, `--force-if-includes`, a `+` refspec).
// The refusal says what to do instead: ask the person to run it themselves (`! <command>` in Claude Code).
//
// A SPEED BUMP, NOT PROOF. It reads the command line the agent sends, so a command hidden in a script, an
// alias or `eval` is not seen; Codex has no hooks at all. What proves an approval is the platform (and CI's
// ledger guard). The rules in AGENTS.md are what the agent follows; this catches the plain mistake.
//
// FAIL-OPEN, like the ledger guard: a payload it cannot read, or no command in it, is allowed.
import { classify } from './agent-rules.mjs';
import { VALUE_FLAGS, LIST_FLAGS } from './argv-flags.mjs';

// One command line split into its simple commands: on `;`, `&`, `&&`, `||`, `|` and newlines, outside
// quotes. Each part is a list of words, with quotes removed and `\` escapes applied. Read as the shell reads it
// in the ways an agent's commands use most: a `\` at the end of a line joins the next line on, a `#` that
// starts a word begins a comment, and the body of a heredoc (`cat > notes.md <<EOF` … `EOF`) is text fed to a
// command, never commands. A `<<` whose end line never comes (an arithmetic shift, `$((1<<2))`) is not a
// heredoc: nothing after it is skipped. `<<<` is a here-string, one word of text. `$(…)` and backticks are not
// opened: their text stays inside a word, which is the safe side for a guard that only refuses.
export function shellParts(line) {
  const parts = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const heredocs = [];
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  const endPart = () => { endWord(); if (words.length) parts.push(words); words = []; };
  // Where the heredocs opened on this line end: the index just past the last one's end line, or -1 when an end
  // line never comes.
  const heredocsEnd = (from) => {
    let at = from;
    for (const h of heredocs) {
      for (;;) {
        if (at > line.length) return -1;
        const eol = line.indexOf('\n', at);
        const text = line.slice(at, eol < 0 ? line.length : eol).replace(/\r$/, '');
        at = eol < 0 ? line.length + 1 : eol + 1;
        if ((h.tabs ? text.replace(/^\t+/, '') : text) === h.word) break;
      }
    }
    return at;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
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
      const m = /^<<(-?)[ \t]*(['"]?)([A-Za-z0-9_.-]+)\2/.exec(line.slice(i));
      if (m) { heredocs.push({ word: m[3], tabs: m[1] === '-' }); endWord(); i += m[0].length - 1; continue; }
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

// Words that only set up how a command runs, skipped to find the command itself: `env`, `VAR=value`, `sudo`,
// `command`, `exec`, `time`, `nohup`, `nice`, `timeout` with its duration, the shell's own words (`then`, `do`,
// `else`, `{`, `!`), and a `(` stuck to the front of the first word. The options of a prefix are skipped with
// it, and the value of one that takes a value (`sudo -u <user>`, `nice -n <n>`, `env -u <name>`).
const PREFIXES = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nohup', 'nice', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '{', '!']);
const PREFIX_VALUE_OPTIONS = new Set(['-u', '-g', '-n', '-C', '-h', '-U', '-r', '-t', '-s', '-k', '--user', '--group', '--signal', '--kill-after', '--unset', '--chdir', '--adjustment']);
const stripPrefix = (words) => {
  const w = words.slice();
  if (w.length && w[0].startsWith('(')) w[0] = w[0].replace(/^\(+/, '');
  let i = 0;
  for (;;) {
    while (i < w.length && w[i] === '') i++;
    if (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) { i++; continue; }
    if (i < w.length && (PREFIXES.has(w[i]) || w[i] === 'timeout')) {
      const isTimeout = w[i] === 'timeout';
      i++;
      while (i < w.length && w[i].startsWith('-')) i += PREFIX_VALUE_OPTIONS.has(w[i]) ? 2 : 1;
      if (isTimeout) i++; // the duration
      continue;
    }
    return w.slice(i);
  }
};
const programOf = (word) => word.split(/[\\/]/).pop().replace(/\.(exe|cmd)$/i, '');

// The command line a shell runs from its `-c` argument (`bash -c "yad gate approve …"`), or null.
function shellC(words) {
  const w = stripPrefix(words);
  if (!w.length || !['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(programOf(w[0]))) return null;
  const c = w.findIndex((x, n) => n > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
  return c > 0 && c + 1 < w.length ? w[c + 1] : null;
}

// The yad argv after the program, or null when the part does not run yad: `yad …` (any path, `yad.mjs` too),
// `npx [-y] yadflow[@v] …` (and pnpx, bunx), `npx -p yadflow yad …`, `npm exec|x yadflow -- …`,
// `node [options] …/yad.mjs …`.
const NODE_VALUE_OPTIONS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-e', '--eval', '-p', '--print', '--input-type', '--conditions', '-C']);
const NPX_VALUE_OPTIONS = new Set(['-p', '--package', '-c', '--call', '--cache', '--registry', '--userconfig', '--prefix']);
const isYadflow = (x) => /^yadflow(@.*)?$/.test(x);
const dropDashDash = (args) => (args[0] === '--' ? args.slice(1) : args);
function yadArgs(words) {
  const w = stripPrefix(words);
  if (!w.length) return null;
  const prog = programOf(w[0]);
  if (prog === 'yad' || prog === 'yad.mjs') return w.slice(1);
  // The first plain word after `from`, past options, and the value of an option that takes one.
  const plainAfter = (from, valued) => {
    let i = from;
    let pkg = false;
    while (i < w.length && w[i].startsWith('-')) {
      if (/^(-p|--package)(=|$)/.test(w[i]) && (w[i].includes('=') ? isYadflow(w[i].split('=')[1]) : isYadflow(w[i + 1] ?? ''))) pkg = true;
      i += valued.has(w[i]) ? 2 : 1;
    }
    return { i, pkg };
  };
  if (prog === 'npx' || prog === 'pnpx' || prog === 'bunx' || (prog === 'npm' && (w[1] === 'exec' || w[1] === 'x'))) {
    const { i, pkg } = plainAfter(prog === 'npm' ? 2 : 1, NPX_VALUE_OPTIONS);
    if (i >= w.length) return null;
    if (isYadflow(w[i])) return dropDashDash(w.slice(i + 1));
    // `npx -p yadflow yad …`: the package named, then its `yad` command.
    if (pkg && programOf(w[i]) === 'yad') return dropDashDash(w.slice(i + 1));
    return null;
  }
  if (prog === 'node') {
    const { i } = plainAfter(1, NODE_VALUE_OPTIONS);
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
// starting with `+``.
function forcePush(words) {
  const g = gitArgs(words);
  if (!g || g[0] !== 'push' || g.includes('--help') || g.includes('-h')) return false;
  return g.slice(1).some((a) => a === '--force' || a === '--force-if-includes' || /^--force-with-lease(=|$)/.test(a)
    || (/^-[A-Za-z]+$/.test(a) && a.includes('f')) || /^\+/.test(a));
}

// Is this part an approval or a merge of a PR/MR on the platform? `gh pr review … --approve|-a`, `gh pr merge`,
// `glab mr approve`, `glab mr merge`. The person's, even when the agent's login could do it. The options that
// take a value (`-R <repo>`) are skipped with it, so `gh -R o/r pr merge 5` is read as `pr merge`.
const PLATFORM_VALUE_OPTIONS = new Set(['-R', '--repo', '-b', '--body', '-F', '--body-file', '-t', '--subject', '-m', '--message', '--match-head-commit', '--author-email', '--sha']);
function platformApproval(words) {
  const w = stripPrefix(words);
  if (!w.length || w.includes('--help') || w.includes('-h')) return false;
  const prog = programOf(w[0]);
  if (prog !== 'gh' && prog !== 'glab') return false;
  const rest = [];
  for (let i = 1; i < w.length; i++) {
    if (w[i].startsWith('-')) { if (PLATFORM_VALUE_OPTIONS.has(w[i])) i++; continue; }
    rest.push(w[i]);
  }
  if (prog === 'gh') {
    if (rest[0] !== 'pr') return false;
    if (rest[1] === 'merge') return true;
    return rest[1] === 'review' && w.some((x) => x === '--approve' || x === '-a');
  }
  return rest[0] === 'mr' && (rest[1] === 'approve' || rest[1] === 'merge');
}

// The verdict for one shell command line: `{allow: true}` or `{allow: false, message}`.
export function agentGuardDecision(line, depth = 0) {
  if (typeof line !== 'string' || !line.trim()) return { allow: true };
  for (const part of shellParts(line)) {
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
