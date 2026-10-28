// The agent guard (E158): a hook that runs before an AI agent's shell command, in Claude Code (`PreToolUse`,
// matcher `Bash`) and Cursor (`beforeShellExecution`), and refuses two kinds of command:
//   - a yad command only the person may run (`classify` in cli/agent-rules.mjs says `human-only`: an
//     approval, a gate comment or advance or reopen, a commit past the ledger guard);
//   - a force push (`git push --force`, `-f`, `--force-with-lease`, `--force-if-includes`, a `+` refspec).
// The refusal says what to do instead: ask the person to run it themselves (`! <command>` in Claude Code).
//
// A SPEED BUMP, NOT PROOF. It reads the command line the agent sends, so a command hidden in a script, an
// alias or `eval` is not seen; Codex has no hooks at all. What proves an approval is the platform (and CI's
// ledger guard). The rules in AGENTS.md are what the agent follows; this catches the plain mistake.
//
// FAIL-OPEN, like the ledger guard: a payload it cannot read, or no command in it, is allowed.
import { classify } from './agent-rules.mjs';

// One command line split into its simple commands: on `;`, `&`, `&&`, `||`, `|` and newlines, outside
// quotes. Each part is a list of words, with quotes removed and `\` escapes applied. `$(…)` and backticks are
// not opened: their text stays inside a word, which is the safe side for a guard that only refuses.
export function shellParts(line) {
  const parts = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  const endPart = () => { endWord(); if (words.length) parts.push(words); words = []; };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += ch;
      continue;
    }
    if (ch === '\'' || ch === '"') { quote = ch; inWord = true; continue; }
    if (ch === '\\' && i + 1 < line.length) { word += line[++i]; inWord = true; continue; }
    if (ch === '\n' || ch === ';' || ch === '&' || ch === '|') { endPart(); continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { endWord(); continue; }
    word += ch; inWord = true;
  }
  endPart();
  return parts;
}

// Words that only set up how a command runs, skipped to find the command itself: `env`, `VAR=value`, `sudo`,
// `command`, `exec`, `time`, `nohup`.
const PREFIXES = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nohup']);
const stripPrefix = (words) => {
  let i = 0;
  while (i < words.length && (PREFIXES.has(words[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) i++;
  return words.slice(i);
};

// The yad command words after the program, or null when the part does not run yad: `yad …`, a path ending in
// `/yad`, `npx [-y] yadflow[@v] …`, `node …/yad.mjs …`.
function yadArgs(words) {
  const w = stripPrefix(words);
  if (!w.length) return null;
  const prog = w[0].split(/[\\/]/).pop();
  if (prog === 'yad' || prog === 'yad.cmd') return w.slice(1);
  if (prog === 'npx' || prog === 'pnpx' || prog === 'bunx') {
    const i = w.findIndex((x, n) => n > 0 && !x.startsWith('-'));
    return i > 0 && /^yadflow(@.*)?$/.test(w[i]) ? w.slice(i + 1) : null;
  }
  if (prog === 'node' || prog === 'node.exe') {
    const i = w.findIndex((x, n) => n > 0 && !x.startsWith('-'));
    return i > 0 && /(^|[\\/])yad\.mjs$/.test(w[i]) ? w.slice(i + 1) : null;
  }
  return null;
}

// The command words and flag names of yad's argv, the way bin/yad.mjs reads them: words are the leading
// non-flag tokens, flags every `--name` or `--name=value` after.
function yadWords(args) {
  const words = [];
  const flags = [];
  for (const a of args) {
    if (a.startsWith('--')) flags.push(a.slice(2).split('=')[0]);
    else if (!a.startsWith('-') && !flags.length && words.length < 2) words.push(a);
  }
  return { words, flags };
}

// Is this part a force push? `git [-C dir] [-c k=v] push … --force | -f | --force-with-lease[=…] |
// --force-if-includes | a refspec starting with `+``.
function forcePush(words) {
  const w = stripPrefix(words);
  if (!w.length || w[0].split(/[\\/]/).pop().replace(/\.exe$/, '') !== 'git') return false;
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) i += (w[i] === '-C' || w[i] === '-c') ? 2 : 1;
  if (w[i] !== 'push') return false;
  return w.slice(i + 1).some((a) => a === '--force' || a === '--force-if-includes' || /^--force-with-lease(=|$)/.test(a)
    || (/^-[A-Za-z]+$/.test(a) && a.includes('f')) || (/^\+/.test(a)));
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
