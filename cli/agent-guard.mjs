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
// in the two ways an agent's commands use most: a `\` at the end of a line joins the next line on, and the
// body of a heredoc (`cat > notes.md <<EOF` … `EOF`) is text fed to a command, never commands. `$(…)` and
// backticks are not opened: their text stays inside a word, which is the safe side for a guard that only
// refuses.
export function shellParts(line) {
  const parts = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const heredocs = [];
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  const endPart = () => { endWord(); if (words.length) parts.push(words); words = []; };
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
    if (ch === '\\' && i + 1 < line.length) { word += line[++i]; inWord = true; continue; }
    if (ch === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
      // A heredoc: its delimiter, bare or quoted, with `<<-` stripping leading tabs from the lines.
      const m = /^<<(-?)[ \t]*(['"]?)([A-Za-z0-9_.-]+)\2/.exec(line.slice(i));
      if (m) { heredocs.push({ word: m[3], tabs: m[1] === '-' }); endWord(); i += m[0].length - 1; continue; }
    }
    if (ch === '\n' && heredocs.length) {
      endPart();
      // Skip each heredoc's body, up to the line that is its delimiter alone.
      let at = i + 1;
      for (const h of heredocs) {
        while (at <= line.length) {
          const eol = line.indexOf('\n', at);
          const text = line.slice(at, eol < 0 ? line.length : eol);
          at = eol < 0 ? line.length + 1 : eol + 1;
          if ((h.tabs ? text.replace(/^\t+/, '') : text) === h.word) break;
        }
      }
      heredocs.length = 0;
      i = at - 2;
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
// `command`, `exec`, `time`, `nohup`, `nice`, and `timeout` with its duration.
const PREFIXES = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nohup', 'nice']);
const stripPrefix = (words) => {
  let i = 0;
  for (;;) {
    if (i < words.length && (PREFIXES.has(words[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) { i++; continue; }
    if (words[i] === 'timeout') {
      i++;
      while (i < words.length && words[i].startsWith('-')) i += /^-(s|k|-signal|-kill-after)$/.test(words[i]) ? 2 : 1;
      i++; // the duration
      continue;
    }
    return words.slice(i);
  }
};
const programOf = (word) => word.split(/[\\/]/).pop().replace(/\.(exe|cmd)$/i, '');

// The yad argv after the program, or null when the part does not run yad: `yad …` (any path, `yad.mjs` too),
// `npx [-y] yadflow[@v] …` (and pnpx, bunx), `npm exec|x yadflow -- …`, `node …/yad.mjs …`.
function yadArgs(words) {
  const w = stripPrefix(words);
  if (!w.length) return null;
  const prog = programOf(w[0]);
  if (prog === 'yad' || prog === 'yad.mjs') return w.slice(1);
  const firstPlain = (from) => w.findIndex((x, n) => n >= from && !x.startsWith('-'));
  if (prog === 'npx' || prog === 'pnpx' || prog === 'bunx') {
    const i = firstPlain(1);
    return i > 0 && /^yadflow(@.*)?$/.test(w[i]) ? w.slice(i + 1).filter((x, n) => !(n === 0 && x === '--')) : null;
  }
  if (prog === 'npm' && (w[1] === 'exec' || w[1] === 'x')) {
    const i = firstPlain(2);
    return i > 0 && /^yadflow(@.*)?$/.test(w[i]) ? w.slice(i + 1).filter((x, n) => !(n === 0 && x === '--')) : null;
  }
  if (prog === 'node') {
    const i = firstPlain(1);
    return i > 0 && programOf(w[i]) === 'yad.mjs' ? w.slice(i + 1) : null;
  }
  return null;
}

// The command words and flag names of yad's argv, read as bin/yad.mjs reads it: flags may come anywhere, and
// a flag that takes a value (`--dir <path>`, `-m <text>`) takes the word after it.
function yadWords(args) {
  const words = [];
  const flags = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') continue;
    if (a.startsWith('--')) {
      const name = a.split('=')[0];
      flags.push(name.slice(2));
      if (!a.includes('=') && (VALUE_FLAGS.has(name) || LIST_FLAGS.has(name))) i++;
    } else if (a === '-m') i++;
    else if (a.startsWith('-')) continue;
    else if (words.length < 2) words.push(a);
  }
  return { words, flags };
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
  if (!g || g[0] !== 'push') return false;
  return g.slice(1).some((a) => a === '--force' || a === '--force-if-includes' || /^--force-with-lease(=|$)/.test(a)
    || (/^-[A-Za-z]+$/.test(a) && a.includes('f')) || /^\+/.test(a));
}

// Is this part an approval or a merge of a PR/MR on the platform? `gh pr review … --approve|-a`, `gh pr merge`,
// `glab mr approve`, `glab mr merge`. The person's, even when the agent's login could do it.
function platformApproval(words) {
  const w = stripPrefix(words);
  if (!w.length) return false;
  const prog = programOf(w[0]);
  const rest = w.slice(1).filter((x) => !x.startsWith('-') || x === '--approve' || x === '-a');
  if (prog === 'gh') {
    if (rest[0] !== 'pr') return false;
    if (rest[1] === 'merge') return true;
    return rest[1] === 'review' && w.some((x) => x === '--approve' || x === '-a');
  }
  if (prog === 'glab') return rest[0] === 'mr' && (rest[1] === 'approve' || rest[1] === 'merge');
  return false;
}

// The verdict for one shell command line: `{allow: true}` or `{allow: false, message}`.
export function agentGuardDecision(line) {
  if (typeof line !== 'string' || !line.trim()) return { allow: true };
  for (const part of shellParts(line)) {
    const args = yadArgs(part);
    if (args) {
      const { words, flags } = yadWords(args);
      if (classify(words, flags) === 'human-only') {
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
