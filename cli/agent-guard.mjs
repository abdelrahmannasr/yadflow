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

// A `$'…'` string from `from` (just past `$'`): its text with the escapes bash applies, and the index of its closing
// quote (or the end). `\'` is a quote in it, so it does not end the string.
const ANSI = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
function ansiC(line, from) {
  let text = '';
  let i = from;
  for (; i < line.length && line[i] !== "'"; i++) {
    if (line[i] !== '\\' || i + 1 >= line.length) { text += line[i]; continue; }
    const c = line[i + 1];
    let m;
    if (c in ANSI) { text += ANSI[c]; i++; } else if ((m = /^x([0-9A-Fa-f]{1,2})/.exec(line.slice(i + 1, i + 4)))) { text += String.fromCharCode(parseInt(m[1], 16)); i += m[0].length; } else if ((m = /^[0-7]{1,3}/.exec(line.slice(i + 1, i + 4)))) { text += String.fromCharCode(parseInt(m[0], 8)); i += m[0].length; } else if ((m = /^u([0-9A-Fa-f]{1,4})/.exec(line.slice(i + 1, i + 6)))) { text += String.fromCharCode(parseInt(m[1], 16)); i += m[0].length; } else { text += `\\${c}`; i++; }
  }
  return { text, end: i };
}

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
// `mode` picks the reading where bash and zsh decide by context the reader does not track (#492): `literalExpanding`
// reads an end word holding `$` or a backtick as a heredoc ending at that literal word (else: no heredoc), and
// `hashAfterParen` reads a `#` right after `(` or `)` as a comment (else: text). agentGuardDecision judges both.
export function shellParts(rawLine, mode = {}) {
  // The private-use characters that shield quoted braces (below) cannot come from the line itself: a typed one
  // would turn into a real `{` when a carried command is re-read (`bash -c "gh pr {merge,\uE000} 5"`).
  const line = rawLine.replace(/[\uE000-\uE002]/g, '\uFFFD');
  const parts = [];
  // Not enumerable: `parts` reads as the plain list of parts it always was. `bodies` and `herestrings` (#495) are
  // the text a part's heredocs and here-strings feed it, by part index: a shell reading them runs them.
  Object.defineProperty(parts, 'subs', { value: [] });
  Object.defineProperty(parts, 'bodies', { value: [] });
  Object.defineProperty(parts, 'herestrings', { value: [] });
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const heredocs = [];
  // A redirect's target is not a word of the command (#495): `gh >x pr merge 5` runs `gh pr merge 5`.
  let dropWord = false;
  let hereString = false;
  // Which words hold an unquoted `{` (#495): only those are brace-expanded, as the shell does — quoted JSON is not.
  Object.defineProperty(parts, 'braced', { value: [] });
  // Which parts read the previous part's output through a pipe (`|`, `|&`), by index.
  Object.defineProperty(parts, 'piped', { value: new Set() });
  // Words whose backslashes in double quotes the shell keeps (#498), by part: their kept spelling.
  Object.defineProperty(parts, 'posix', { value: [] });
  let partPosix = null;
  // Text that reaches a shell (#498, rows 1, 2, 8), by part: `procsubs` (a `<(…)`, `>(…)` or zsh `=(…)`, with the
  // words before it and its inner parts), `subst` (each word's `$(…)` and backtick spans, for the words their
  // printed text makes), `writes` (`>`, `>>` targets) and `reads` (`<` targets).
  Object.defineProperty(parts, 'procsubs', { value: [] });
  Object.defineProperty(parts, 'subst', { value: [] });
  Object.defineProperty(parts, 'writes', { value: [] });
  Object.defineProperty(parts, 'reads', { value: [] });
  Object.defineProperty(parts, 'pipedWrites', { value: [] });
  let partSubst = null;
  const wordSubs = [];
  let partWrites = null;
  let partReads = null;
  // The redirect whose target is the next word: `{op, fd}`, and the one before it when that one's target is
  // still to come (`bash < <(…)`: the process substitution is the target of a `<`).
  let redirect = null;
  let redirectBefore = null;
  // One entry per open `(`: `{proc, cases}`, `proc` set for a process substitution; `cases` counts the `case`
  // commands open inside it, whose pattern `)` closes nothing (#498 review: `bash <(case x in x) …;; esac)`).
  const parens = [];
  // The process substitution just closed, while the command it belongs to goes on (`bash < <(a) < <(b)`).
  let afterProc = null;
  const wordKeep = [];
  let orAt = -1;
  let realMarks = null;
  let wordBraced = false;
  // A word with no quote or escape in it: only such a `case` or `esac` is the reserved word.
  let wordPlain = true;
  // The word after a bare `>&` (#498 review): `>&f` and `>& f` write the file f, as `&>f` does. The word stays a
  // word of the command, as main reads it.
  let afterDup = null;
  let partBraced = null;
  const endWord = () => {
    if (inWord) {
      // A here-string is the command's input, not one of its words (`x=<<<1 git commit …` runs git).
      // The kept spelling is built in one pass (#498 review: a rebuild per backslash was quadratic).
      let kept = null;
      if (wordKeep.length) {
        kept = '';
        let from = 0;
        for (const at of wordKeep) { kept += `${word.slice(from, at)}\\`; from = at; }
        kept = unshieldBraces(kept + word.slice(from));
      }
      const subs = wordSubs.length ? { word, subs: wordSubs.slice() } : null;
      if (hereString) {
        parts.herestrings.push({ part: parts.length, text: unshieldBraces(word), subst: subs });
        // A shell fed the here-string reads the kept backslashes too (#498 review).
        if (kept !== null) parts.herestrings.push({ part: parts.length, text: kept });
      } else if (!dropWord) {
        words.push(unshieldBraces(word));
        const top = parens.at(-1);
        if (top && wordPlain && (words.length === 1 || CASE_LEAD.has(words[words.length - 2]))) {
          const wd = words[words.length - 1];
          // `esac` only as a command's first word: after `then` it may be an argument (`echo then esac`).
          if (wd === 'case') top.cases++; else if (wd === 'esac' && top.cases && words.length === 1) top.cases--;
        }
        if (afterDup?.write) {
          const wd = words[words.length - 1];
          if (!/[$`]/.test(word) && !DEVICE.test(wd)) (partWrites ??= []).push({ target: wd, append: false });
        }
        if (wordBraced) (partBraced ??= new Map()).set(words.length - 1, word);
        if (kept !== null) (partPosix ??= new Map()).set(words.length - 1, kept);
        if (subs) (partSubst ??= new Map()).set(words.length - 1, subs);
      } else if (redirect && !/[$`]/.test(word)) {
        // A redirect's target (#498, row 8): a file written (only by the output a shell would write, fd 1) or read.
        const target = unshieldBraces(word);
        if (!DEVICE.test(target)) {
          if (redirect.op === '<') (partReads ??= []).push(target);
          else if (redirect.op !== '<>' && (redirect.fd === '' || redirect.fd === '1')) (partWrites ??= []).push({ target, append: redirect.op.endsWith('>>') });
        }
      }
    }
    wordBraced = false;
    wordKeep.length = 0;
    wordSubs.length = 0;
    wordPlain = true;
    if (inWord) afterDup = null;
    // Reset only once the target (or the here-string) was read: a space before it ends no word.
    if (inWord) { dropWord = false; hereString = false; redirect = null; redirectBefore = null; }
    word = ''; inWord = false;
  };
  const endPart = () => {
    endWord(); dropWord = false; hereString = false; redirect = null; redirectBefore = null;
    afterDup = null;
    if (words.length) { parts.braced.push(partBraced); parts.posix.push(partPosix); parts.subst.push(partSubst); parts.writes.push(partWrites); parts.reads.push(partReads); parts.push(words); }
    // A redirect alone after a pipe: zsh writes what it is piped to the file (`echo … | > f`), as `cat > f` would.
    else if (partWrites && parts.length && parts.piped.has(parts.length)) parts.pipedWrites.push({ after: parts.length - 1, writes: partWrites });
    words = []; partBraced = null; partPosix = null; partSubst = null; partWrites = null; partReads = null;
  };
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
      if (next >= 0) parts.bodies.push({ part: h.part, text: line.slice(start, line.lastIndexOf('\n', next - 2) + 1 || start) });
      if (next < 0) {
        // Once is enough: a later heredoc that never ends starts further on, inside text already judged.
        if (restFrom < 0 && heredocs.some((x) => !x.quoted)) { restFrom = from; const subs = substitutionsIn(line.slice(from), mode); if (subs.tooComplex) parts.tooComplex = true; for (const x of subs) parts.subs.push(x); }
        return -1;
      }
      if (!h.quoted) bodies.push(line.slice(start, line.lastIndexOf('\n', next - 2) + 1 || start));
      at = next;
    }
    // A loop, not a spread: a body of 124,000 `$(` overflowed the stack with `push(...)` (#492 review).
    for (const body of bodies) { const subs = substitutionsIn(body, mode); if (subs.tooComplex) parts.tooComplex = true; for (const x of subs) parts.subs.push(x); }
    return at;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    // A command substitution, unquoted or in double quotes (single quotes keep it as text).
    if (quote !== '\'' && ((ch === '$' && line[i + 1] === '(') || ch === '`')) {
      const end = ch === '`' ? backtickEnd(line, i + 1) : substitutionEnd(line, i + 2, () => (index ??= lineIndex(line)), mode);
      // Past the budget for `case` words or the deadline (#498): refused, not read on.
      if (end < 0) { parts.tooComplex = true; break; }
      const subText = ch === '`' ? line.slice(i + 1, end).replace(/\\`/g, '`') : line.slice(i + 2, end);
      parts.subs.push(subText);
      // A `case` in it: its `x)` closes no `$(` to the shell (#495), so the text up to the line's last `)` is
      // judged too. Only refuses more.
      // The marks are found once per line, so this costs no scan per `$(` (#498 review: it was quadratic).
      if (ch === '$' && markWithin((realMarks ??= marksOf(line)).cases, i + 2, end)) {
        const eol = firstAtOrAfter(realMarks.newlines, i);
        const stop = eol < 0 ? line.length : eol;
        const last = line.lastIndexOf(')', stop - 1);
        if (last > end) parts.subs.push(line.slice(i + 2, last));
      }
      // Where it sits in the word, for the words its printed text makes (#498, row 2).
      wordSubs.push({ at: word.length, len: end + 1 - i, text: subText, quoted: quote === '"' });
      word += line.slice(i, end + 1); inWord = true;
      i = end;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && line[i + 1] === '\n') i++;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) {
        // In double quotes the shell keeps the backslash unless `$`, a backtick, `"`, `\\` or a newline follows
        // (#498): a line re-read by `bash -c` or `eval` sees it. Kept as an extra spelling of the word.
        if (!'$`"\\\n'.includes(line[i + 1])) wordKeep.push(word.length);
        word += shieldBrace(line[++i]);
      }
      else word += shieldBrace(ch);
      continue;
    }
    // `$'…'` is read with its escapes (`\'` is a quote in it, #495); `$"…"` is a double-quoted string.
    if (ch === '$' && line[i + 1] === '\'') { wordPlain = false; const r = ansiC(line, i + 2); word += [...r.text].map(shieldBrace).join(''); inWord = true; i = r.end; continue; }
    if (ch === '$' && line[i + 1] === '"') { continue; }
    if (ch === '\'' || ch === '"') { quote = ch; inWord = true; wordPlain = false; continue; }
    if (ch === '\\' && line[i + 1] === '\n') { i++; continue; }
    // `\` + CR + LF is NOT a line join: bash and zsh read an escaped CR, then run the next line as its own
    // command. So it falls through to the escape below (the CR is a character of the word), and the LF ends the part.
    if (ch === '\\' && i + 1 < line.length) { word += shieldBrace(line[++i]); inWord = true; wordPlain = false; continue; }
    // A `#` starts a comment only where a word starts after a space, a tab, a newline, `;`, `&` or `|` (or at the
    // start): right after `(` or `)` it is text to zsh's globs and to bash's `[[ =~ ]]` (#492 review).
    if (ch === '#' && !inWord && (i === 0 || (mode.hashAfterParen ? /[ \t\n;&|()]/ : /[ \t\n;&|]/).test(line[i - 1])) && !(mode.hashAfterBar && line[i - 1] === '|')) { while (i + 1 < line.length && line[i + 1] !== '\n') i++; continue; }
    if (ch === '<' && line[i + 1] === '<' && line[i + 2] === '<') { endWord(); hereString = true; i += 2; continue; }
    if (ch === '<' && line[i + 1] === '<') {
      // A heredoc: its delimiter, bare or quoted, with `<<-` stripping leading tabs from the lines.
      const m = heredocAt(line, i);
      if (m) { if (!m.expands || mode.literalExpanding) heredocs.push({ ...heredocOf(m), part: parts.length }); endWord(); i += m[0].length - 1; continue; }
    }
    if (ch === '\n' && heredocs.length) {
      endPart();
      const at = heredocsEnd(i + 1);
      heredocs.length = 0;
      // No end line: not a heredoc after all, so the next lines are read as commands.
      if (at >= 0) i = at - 1 - 1;
      continue;
    }
    // A redirect (#495): `[n]>`, `>>`, `>|`, `&>`, `&>>`, `<`, `<>`, `[n]>&n`, `[n]<&n`, `>&-`. Its operator and its
    // target are not words of the command, and the `&` in it splits nothing (`git push origin main 2>&1 --force`
    // pushes with --force). A `(` right after it is a process substitution: the part break below reads it.
    // zsh's numeric glob (`<->`, `<1-9>`) is one word, not two redirects (#495 review): judged both ways.
    if (mode.numericGlob && ch === '<') {
      const g = /^<[0-9]*-[0-9]*>/.exec(line.slice(i, i + 24));
      if (g) { word += g[0]; inWord = true; i += g[0].length - 1; continue; }
    }
    if ((ch === '>' || ch === '<') || (ch === '&' && line[i + 1] === '>')) {
      let fd = '';
      if (inWord && /^[0-9]+$/.test(word)) { fd = word; word = ''; inWord = false; wordKeep.length = 0; wordSubs.length = 0; } else endWord();
      let j = i + (ch === '&' ? 2 : 1);
      if (line[j] === '>' || line[j] === '|' || (ch === '<' && line[j] === '>')) j++;
      // `>&n` and `>&-` copy or close a file descriptor, read as before; a bare `>&` before a word writes it.
      if (line[j] === '&') {
        j++;
        const from = j;
        while (j < line.length && /[0-9-]/.test(line[j])) j++;
        if (j === from) afterDup = { write: ch !== '<' && (fd === '' || fd === '1') };
        i = j - 1;
        continue;
      }
      redirectBefore = dropWord ? redirect : null;
      redirect = { op: line.slice(i, j).replace(/\|/g, ''), fd: ch === '&' ? '1' : fd };
      dropWord = true;
      i = j - 1;
      continue;
    }
    // `(` and `)` end a part too (#492): `<(cmd)`, `>(cmd)`, `f(){ cmd; }` and `case x in x) cmd;;` run `cmd`.
    if (ch === '\n' || ch === ';' || ch === '&' || ch === '|' || ch === '(' || ch === ')') {
      const prevProc = afterProc;
      afterProc = null;
      if (ch === '(') {
        // A process substitution (#498, row 1): `<(…)` or `>(…)` (the `<` read as a redirect just before), or
        // zsh's `=(…)` (a word that is just `=`). The words before it are its owner's (with those before an
        // earlier one the same command holds), and the word it makes stands at `position` (the `=` word
        // itself, which stays a word of the part as written).
        const zshEq = inWord && word === '=' && !wordSubs.length;
        const isProc = zshEq || (dropWord && redirect && (line[i - 1] === '<' || line[i - 1] === '>'));
        // Carried only while short: a shell's script word comes before its first few words end (a carry with no
        // bound grew with every `<(…)` on a long line, #498 review).
        // Past the bound, the first owner's first words are kept and the substitution is judged whenever they
        // start a shell (`maybe`): only refuses more.
        const carry = prevProc && prevProc.owner.length + words.length < 64;
        const owner = !isProc ? null : carry ? [...prevProc.owner, ...(prevProc.viaStdin ? [] : ['\0']), ...words] : prevProc ? prevProc.owner.slice(0, 64) : words.slice();
        const viaStdin = !zshEq && redirectBefore?.op === '<';
        endPart();
        parens.push({ proc: owner && owner.length ? { owner, position: owner.length, viaStdin, maybe: !!prevProc && !carry, from: parts.length } : null, cases: 0 });
        continue;
      }
      endPart();
      if (ch === ')' && !parens.at(-1)?.cases) {
        const top = parens.pop();
        const p = top?.proc;
        // A held `)` before already recorded this substitution: its record now runs to this, the real close.
        if (p && top.held) { top.held.to = parts.length; afterProc = p; } else if (p) { parts.procsubs.push({ ...p, to: parts.length }); afterProc = p; }
      } else if (ch === ')' && parens.at(-1)?.held) {
        // One record per substitution, run on to each later held `)` (#498 review: a `case` the reader took
        // for the reserved word may hold every one).
        parens.at(-1).held.to = parts.length;
      } else if (ch === ')' && parens.at(-1)?.proc) {
        // A `)` read as a `case` pattern's: it may close the process substitution after all (a `case` the reader
        // took for the reserved word), so that reading is judged too.
        const rec = { ...parens.at(-1).proc, to: parts.length };
        parts.procsubs.push(rec);
        parens.at(-1).held = rec;
      }
      if (ch === '|') {
        // The second `|` of `||` is known by where the first one was, not by the raw text before it (`\||bash`).
        if (line[i + 1] === '|' && orAt !== i) orAt = i + 1;
        else if (orAt !== i) parts.piped.add(parts.length);
      }
      continue;
    }
    // A CR is a character of the word, as bash and zsh read it (#492): `x\r#` is one word, so its `#` starts no
    // comment. A shell that drops CRs is the other reading, judged by agentGuardDecision.
    if (ch === ' ' || ch === '\t') { endWord(); continue; }
    if (ch === '{') wordBraced = true;
    word += ch; inWord = true;
  }
  endPart();
  return parts;
}

// Where the word `case` and each newline stand in a line, in order: found once per line, so each `$(` asks by a
// binary search whether its text holds a `case`, never by a scan (a scan per `$(` was quadratic, #498 review).
function marksOf(line) {
  const cases = [], newlines = [];
  for (const m of line.matchAll(/\bcase\b|\n/g)) (m[0] === '\n' ? newlines : cases).push(m.index);
  return { cases, newlines };
}
// The first index in `sorted` at or after `from`, or -1.
function firstAtOrAfter(sorted, from) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < from) lo = mid + 1; else hi = mid; }
  return lo < sorted.length ? sorted[lo] : -1;
}
function markWithin(marks, from, to) {
  const at = firstAtOrAfter(marks, from);
  return at >= 0 && at < to;
}

// Where the `$(` whose text starts at `from` closes: the index of its `)`, or the end of the line when it never
// closes. Quotes, nested `(…)` and a heredoc's text inside it are its own, so a `)` in them does not close it.
// `getIndex` gives the line index of `line`, built once per text and shared by every `$(` in it (#492 review: one
// per call made many `$(…)` holding heredocs take quadratic time).
function substitutionEnd(line, from, getIndex, mode = {}) {
  let depth = 1;
  let quote = null;
  const heredocs = [];
  // `mode.ends` (#498), the end rule of the whole reading. Unset: main's. `bash`: `$'…'` is skipped with its
  // escapes (`\'` does not end it), a `#` comment and backticks are skipped, and a `case` is text, as bash 3.2
  // reads them. `zsh`: `$'…'` and comments the same, and a `case <word> in` makes its `x)` patterns close
  // nothing, as zsh reads them. Each is a reading of its own, never mixed in one.
  const ansi = mode.ends === 'bash' || mode.ends === 'zsh';
  const cases = [];
  // `mode.until`: scan no further (a bound on a `case` word).
  const stop = Math.min(line.length, mode.until ?? Infinity);
  for (let i = from; i < stop; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"') i++;
      continue;
    }
    if (ch === '\\') { i++; continue; }
    if (ansi && ch === '$' && line[i + 1] === '\'') {
      let j = i + 2;
      while (j < stop && line[j] !== '\'') j += line[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    // Both shells read a `#` that starts a word as a comment to the end of the line: a `)` in it closes nothing
    // (#498 review round 6). Not `$#`, `${#x}` or `16#ff`, where it starts no word. bash 3.2 starts one only after
    // a blank or a newline (`;#` is no comment to it); zsh after `;`, `&`, `|`, `(` and `)` too (round 7).
    if (ansi && ch === '#' && (i === from || (mode.ends === 'bash' ? /[ \t\n]/ : /[\s;&|()]/).test(line[i - 1]))) {
      const nl = line.indexOf('\n', i);
      if (nl < 0 || nl >= stop) return line.length;
      i = nl - 1;
      continue;
    }
    // bash 3.2 reads backticks inside `$(…)` as nested: a `)` in them closes nothing (zsh does not).
    if (mode.ends === 'bash' && ch === '`') { i = backtickEnd(line, i + 1); continue; }
    if (mode.ends === 'zsh' && (ch === 'c' || ch === 'e') && (i === from || /[\s;&|(]/.test(line[i - 1]))) {
      if (ch === 'c' && line.startsWith('case', i)) {
        const at = caseInEnd(line, i, getIndex);
        // What a `case` word costs is charged to one budget per reading: past it, the command is refused.
        if ((caseLeft.n -= caseScanned) < 0 || Date.now() > deadline) return -2;
        if (at >= 0) { cases.push(depth); i = at - 1; continue; }
      }
      // `esac` ends a case only where a command starts: `echo esac` is a word (#498 review).
      if (ch === 'e' && cases.length && /^esac(?![^\s;&|()<>])/.test(line.slice(i, i + 5)) && commandStart(line, i, from)) { cases.pop(); i += 3; continue; }
    }
    if (ch === '\'' || ch === '"') { quote = ch; continue; }
    if (ch === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
      const m = heredocAt(line, i);
      if (m) { if (!m.expands || mode.literalExpanding) heredocs.push(heredocOf(m)); i += m[0].length - 1; continue; }
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
    else if (ch === ')' && cases.length && depth === cases[cases.length - 1]) continue;
    else if (ch === ')' && --depth === 0) return i;
  }
  return line.length;
}

// After the `case` at `i`, the index just past its `in`, or -1 (#498 review): the word between may be quoted,
// escaped, a `$(…)` or a `${…}`, and `in` may follow a newline.
const CASE_WORD = 4096;
// How far the last caseInEnd scanned, charged by its caller to one budget per reading.
let caseScanned = 0;
function caseInEnd(line, i, getIndex) {
  const limit = Math.min(line.length, i + CASE_WORD);
  let j = i + 4;
  const done = (at) => { caseScanned = Math.min(Math.max(j, i + 4), limit) - i; return at; };
  if (line[j] !== ' ' && line[j] !== '\t') return done(-1);
  while (j < limit && (line[j] === ' ' || line[j] === '\t')) j++;
  const start = j;
  for (; j < limit && !/[\s;&|()<>]/.test(line[j]); j++) {
    const c = line[j];
    if (c === '\\') j++;
    else if (c === '\'') { j++; while (j < limit && line[j] !== '\'') j++; if (j >= limit) return done(-1); }
    else if (c === '"') { j++; while (j < limit && line[j] !== '"') j += line[j] === '\\' ? 2 : 1; if (j >= limit) return done(-1); }
    // The default scan, never the shells' own: that one reads a `case` here again, and the two calling each other
    // doubled the time at each `case $(` (#498 review round 2).
    else if (c === '$' && line[j + 1] === '(') { j = substitutionEnd(line, j + 2, getIndex, { until: limit }); if (j >= limit) return done(-1); }
    else if (c === '$' && line[j + 1] === '{') {
      let d = 0;
      for (; j < limit; j++) { if (line[j] === '{') d++; else if (line[j] === '}' && --d === 0) break; }
      if (j >= limit) return done(-1);
    }
  }
  if (j === start || j >= limit) return done(-1);
  while (j < limit && /\s/.test(line[j])) j++;
  return done(/^in(?![^\s;&|()<>])/.test(line.slice(j, j + 3)) ? j + 2 : -1);
}
// Whether a command starts at `i`: only blanks between it and `from`, or a `;`, `&`, `)` or newline (not `|` or
// `(`: in `case x in a|esac)` the `esac` is a pattern).
function commandStart(line, i, from) {
  let k = i - 1;
  while (k >= from && (line[k] === ' ' || line[k] === '\t')) k--;
  return k < from || /[;&)\n]/.test(line[k]);
}

// The commands of every `$(…)` and backticks in a heredoc's text, where quotes are plain characters and `\`
// keeps the next one as text.
function substitutionsIn(text, mode = {}) {
  const out = [];
  let index = null;
  const getIndex = () => (index ??= lineIndex(text));
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if ((ch === '$' && text[i + 1] === '(') || ch === '`') {
      const end = ch === '`' ? backtickEnd(text, i + 1) : substitutionEnd(text, i + 2, getIndex, { ends: mode.ends });
      if (end < 0) { out.tooComplex = true; break; }
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
// #495 adds `builtin`, zsh's `noglob` and `nocorrect`, `coproc [NAME]`, `function NAME` and `exec -a NAME`.
const PREFIXES = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nohup', 'nice', 'xargs', 'stdbuf', 'watch', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '{', '!',
  'builtin', 'noglob', 'nocorrect', 'coproc', 'function']);
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
  exec: new Set(['-a']),
};
const stripPrefix = (words) => {
  // The common case, a plain first word, in one look (it is called many times per part).
  const w0 = words[0];
  if (w0 && !w0.includes('=') && w0 !== 'function' && w0 !== 'coproc' && w0 !== 'timeout' && !PREFIXES.has(w0) && w0[0] !== '(' && w0[0] !== '{') return words.slice();
  const w = words.slice();
  // A `(` or a `{` stuck to the first word (zsh reads `{gh pr merge 5;}` as a group).
  if (w.length && /^[({]/.test(w[0])) w[0] = w[0].replace(/^[({]+/, '');
  let i = 0;
  for (;;) {
    while (i < w.length && w[i] === '') i++;
    if (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) { i++; continue; }
    // `function NAME`, and `coproc NAME {` (a name only before a `{`): the name is not the command.
    if (i < w.length && w[i] === 'function') { i += 2; continue; }
    if (i < w.length && w[i] === 'coproc' && w[i + 2] === '{') { i += 2; continue; }
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
// A word with no path and no extension is its own program (the common case, without two regexes).
const programOf = (word) => (typeof word === 'string' && !/[\\/.]/.test(word) ? word : word.split(/[\\/]/).pop().replace(/\.(exe|cmd)$/i, ''));

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
const SHELLS = ['bash', 'sh', 'zsh', 'dash', 'ksh'];
// The device files a redirect writes to or reads from that are not files the line can run (#498, row 8).
// The words after which a word starts a command, for `case` and `esac` (#498 review).
// Commands that only print their words: a file read past its limits there is printed, not run.
const PRINTERS = new Set(['echo', 'printf', 'print', 'cat']);
const CASE_LEAD = new Set(['then', 'do', 'else', 'elif', '{', '!', 'time', 'if', 'while', 'until']);
const DEVICE = /^\/dev\/(null|stdin|stdout|stderr|tty|zero|fd\/[0-9]+)$/;
// A shell reading its script from its input, not from a file: no `-c`, and either no plain word, or `-s` among its
// options (the words after are `$1…`), or the first plain word is the input itself (`-`, `/dev/stdin`,
// `/dev/fd/0`, `/proc/self/fd/0`); `source` / `.` of the input too. `--rcfile` / `--init-file` take a value.
const STDIN_FILES = /^(-|\/dev\/stdin|\/dev\/fd\/0|\/proc\/self\/fd\/0)$/;
function bareShell(w) {
  if (!w.length) return false;
  const prog = programOf(w[0]);
  if ((prog === 'source' || prog === '.') && STDIN_FILES.test(w[1] ?? '')) return true;
  if (!SHELLS.includes(prog) || shellC(w) !== null) return false;
  for (let k = 1; k < w.length; k++) {
    if (w[k] === '--') return k + 1 >= w.length || STDIN_FILES.test(w[k + 1]);
    if (/^--(rcfile|init-file|emulate)$/.test(w[k])) { k++; continue; }
    if (/^-[A-Za-z]*s[A-Za-z]*$/.test(w[k])) return true;
    // A cluster holding `o` or `O` takes the next word as its value (`-euo pipefail`).
    if (/^[-+][A-Za-z]*[oO][A-Za-z]*$/.test(w[k])) { k++; continue; }
    if (/^[-+]/.test(w[k]) && w[k] !== '-') continue;
    // A word that may expand to nothing (`bash $NOPE`, `"$@"`): the next one decides.
    if (/[$`]/.test(w[k])) continue;
    return STDIN_FILES.test(w[k]);
  }
  return true;
}
// Where a shell's script file is among its words (#498, rows 1, 8): the first plain word after its options, as
// bareShell reads them, or 1 for `source` and `.`; -1 when there is none, or the shell runs `-c` or reads `-s`.
function scriptAt(w) {
  if (!w.length) return -1;
  const prog = programOf(w[0]);
  if (prog === 'source' || prog === '.') { const k = w[1] === '--' ? 2 : 1; return w.length > k ? k : -1; }
  if (!SHELLS.includes(prog) || shellC(w) !== null) return -1;
  for (let k = 1; k < w.length; k++) {
    if (w[k] === '--') return k + 1 < w.length ? k + 1 : -1;
    if (/^--(rcfile|init-file|emulate)$/.test(w[k])) { k++; continue; }
    if (/^-[A-Za-z]*s[A-Za-z]*$/.test(w[k])) return -1;
    if (/^[-+][A-Za-z]*[oO][A-Za-z]*$/.test(w[k])) { k++; continue; }
    if (/^[-+]/.test(w[k]) && w[k] !== '-') continue;
    return k;
  }
  return -1;
}
// A quoted or escaped `{`, `}` or `,` is text to the shell, not brace syntax: the reader carries it as a private-use
// character until the word's expansion is done (`git commit -m {'}',-n}` is a list of `}` and `-n`).
const QUOTED_BRACE = { '{': '\uE000', '}': '\uE001', ',': '\uE002' };
const shieldBrace = (c) => QUOTED_BRACE[c] ?? c;
const unshieldBraces = (x) => (/[\uE000-\uE002]/.test(x) ? x.replace(/\uE000/g, '{').replace(/\uE001/g, '}').replace(/\uE002/g, ',') : x);
// A word's brace expansion, as the shell makes it: every alternative of each list, lists side by side multiplied,
// lists inside lists expanded, `{x..y}` sequences (any one character, as zsh allows: `{-..-}` is `-`). A number
// sequence stands for one word, since digits spell no flag. Null when the word is too long to expand (over
// BRACE_WORD characters with a `{`) or would make more than BRACE_CAP words: the line is refused. The length bound
// keeps every scan here small, so nesting and long lists cannot make it slow (#495 review).
const BRACE_CAP = 64;
const BRACE_WORD = 4096;
// `bash` (#498): bash closes a list only at a `}` after one of its commas, or where its body is a sequence; a
// `}` before that is text (`{x},merge}` is `x}` and `merge`), and a `{` that never closes is passed over. zsh
// reads the first `}` as the close, the default.
const SEQUENCE = /^(-?\d+|.)\.\.(-?\d+|.)(?:\.\.-?\d+)?$/s;
// Bash's rule may scan from each `{` to the end of its word: past this many characters scanned for one word, the
// word is not judged (refused), so a long word of `{x}` cannot cost a scan per brace (#498 review).
const BASH_BRACE_SCAN = 65536;
function braceExpand(x, budget = { left: BRACE_CAP }, opts = {}) {
  if (x.length > BRACE_WORD || Date.now() > deadline) return null;
  // Nothing to expand: no scan of its braces, whatever their nesting.
  if (!x.includes(',') && !x.includes('..')) return --budget.left < 0 ? null : [x];
  const lastSep = Math.max(x.lastIndexOf(','), x.lastIndexOf('..'));
  for (let i = x.indexOf('{'); i >= 0 && i < lastSep; i = x.indexOf('{', i + 1)) {
    if (Date.now() > deadline) return null;
    let depth = 0, close = -1;
    const commas = [];
    for (let j = i; j < x.length; j++) {
      if (x[j] === '{') depth++;
      else if (x[j] === '}') {
        if (opts.bash && depth === 1 && !commas.length && !(j - i - 1 <= 64 && SEQUENCE.test(x.slice(i + 1, j)))) continue;
        depth--; if (depth === 0) { close = j; break; }
      } else if (x[j] === ',' && depth === 1) commas.push(j);
    }
    if (opts.bash && (budget.scanned = (budget.scanned ?? 0) + (close < 0 ? x.length : close) - i) > BASH_BRACE_SCAN) return null;
    if (close < 0) { if (opts.bash) continue; break; }
    const body = x.slice(i + 1, close), pre = x.slice(0, i), post = x.slice(close + 1);
    let alts = null;
    if (commas.length) {
      alts = [];
      let from = i + 1;
      for (const c of [...commas, close]) { alts.push(x.slice(from, c)); from = c + 1; }
    } else {
      const m = SEQUENCE.exec(body);
      if (m) {
        const num = /^-?\d+$/.test(m[1]) && /^-?\d+$/.test(m[2]);
        if (num) alts = [m[1]];
        else if (m[1].length === 1 && m[2].length === 1) {
          const a = m[1].charCodeAt(0), b = m[2].charCodeAt(0);
          if (Math.abs(b - a) + 1 > BRACE_CAP) return null;
          alts = [];
          for (let k = a; a <= b ? k <= b : k >= b; k += a <= b ? 1 : -1) alts.push(String.fromCharCode(k));
        }
      }
    }
    if (!alts) continue;
    const out = [];
    for (const alt of alts) {
      const more = braceExpand(pre + alt + post, budget, opts);
      if (!more) return null;
      for (const y of more) out.push(y);
    }
    return out;
  }
  // A finished word: only these count against the cap.
  return --budget.left < 0 ? null : [x];
}
// A word's `$(…)`, backticks and `${…}` with their braces and commas shielded (#498): to bash and zsh a brace
// list does not see into them (`{$(echo '}'),-n}` is `$(echo '}')` and `-n`).
function shieldExpansions(raw, mode = {}) {
  let out = '';
  let index = null;
  for (let k = 0; k < raw.length; k++) {
    const ch = raw[k];
    let end = -1;
    if (ch === '$' && raw[k + 1] === '(') { end = substitutionEnd(raw, k + 2, () => (index ??= lineIndex(raw)), { ends: mode.ends }); if (end < 0) return null; }
    else if (ch === '`') end = backtickEnd(raw, k + 1);
    else if (ch === '$' && raw[k + 1] === '{') {
      let d = 0;
      for (let j = k + 1; j < raw.length; j++) { if (raw[j] === '{') d++; else if (raw[j] === '}' && --d === 0) { end = j; break; } }
      if (end < 0) end = raw.length;
    }
    if (end < 0) { out += ch; continue; }
    out += [...raw.slice(k, end + 1)].map(shieldBrace).join('');
    k = end;
  }
  return out;
}
// A word quoted for a shell line, so a carried command re-read as a line keeps its words (`find -exec sh -c '…'`).
const shq = (x) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(x) ? x : `'${x.replace(/'/g, "'\\''")}'`);
function shellC(words) {
  const w = stripPrefix(words);
  if (!w.length) return null;
  const prog = programOf(w[0]);
  if (SHELLS.includes(prog)) {
    const c = w.findIndex((x, n) => n > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
    if (c < 0) return null;
    // The line is the first word after the options that follow `-c` (#495): `bash -c -- "…"`, `bash -c -x "…"`,
    // and `-o NAME` / `-O NAME`, which take a value.
    let k = c + 1;
    while (k < w.length) {
      if (w[k] === '--' || w[k] === '-') { k++; break; }
      if (/^[-+][oO]$/.test(w[k])) { k += 2; continue; }
      if (/^[-+][A-Za-z]+$/.test(w[k])) { k++; continue; }
      break;
    }
    return k < w.length ? w[k] : null;
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

// Every command line a part carries and runs (#495): a shell's `-c` line (`shellC`); `env -S "<line>"`; each
// `find … -exec|-execdir|-ok|-okdir <cmd…> ;|+`; a `git -c alias.NAME=VALUE … NAME …` (a `!VALUE` is a shell
// line, any other VALUE runs as `git VALUE …`); and `eval <args>`, joined.
function innerLines(part) {
  const out = [];
  const c = shellC(part);
  if (c !== null) out.push(c);
  const lead = part.slice(0, part.length - stripPrefix(part).length);
  const envAt = lead.lastIndexOf('env') >= 0 ? lead.indexOf('env') : (part[0] === 'env' ? 0 : -1);
  if (envAt >= 0) {
    for (let i = envAt + 1; i < part.length; i++) {
      const a = part[i];
      if (a === '-S' || a === '--split-string') { out.push([part[i + 1] ?? '', ...part.slice(i + 2)].join(' ')); break; }
      const m = /^(?:-S|--split-string=)(.+)$/.exec(a);
      if (m) { out.push([m[1], ...part.slice(i + 1)].join(' ')); break; }
      // `env`'s options that take a value come before `-S` too (`env -u X -S "…"`).
      if (['-u', '--unset', '-C', '--chdir', '-a', '--argv0'].includes(a)) { i++; continue; }
      if (!a.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) break;
    }
  }
  const w = stripPrefix(part);
  const prog = w.length ? programOf(w[0]) : '';
  if (prog === 'find') {
    for (let i = 1; i < w.length; i++) {
      if (!/^-(exec|execdir|ok|okdir)$/.test(w[i])) continue;
      let j = i + 1;
      while (j < w.length && w[j] !== ';' && w[j] !== '+') j++;
      out.push(w.slice(i + 1, j).map(shq).join(' '));
      i = j;
    }
  }
  if (prog === 'git') {
    const alias = new Map();
    let i = 1;
    while (i < w.length && w[i].startsWith('-')) {
      const m = w[i] === '-c' ? /^alias\.([^=]+)=(.*)$/s.exec(w[i + 1] ?? '') : null;
      if (m) alias.set(m[1].toLowerCase(), m[2]);
      i += GIT_VALUE_OPTIONS.has(w[i]) ? 2 : 1;
    }
    // Aliases may name aliases (`-c alias.a=b -c alias.b='push --force' a`): followed a few steps.
    let rest = w.slice(i);
    for (let step = 0; step < 5 && rest.length; step++) {
      const value = alias.get(rest[0].toLowerCase());
      if (value === undefined) break;
      if (value.startsWith('!')) { out.push([value.slice(1), ...rest.slice(1).map(shq)].join(' ')); break; }
      out.push(['git', value, ...rest.slice(1).map(shq)].join(' '));
      rest = [...value.split(/\s+/).filter(Boolean), ...rest.slice(1)];
    }
  }
  if (prog === 'eval') out.push(w.slice(1).join(' '));
  return out;
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
// Every reading costs time, so the whole judgement has a budget: past it the line is refused, as a line too long
// is — a hook that runs out its harness's time lets the command through (#492).
// (agentGuardPreapproval asks again for an allowed line, so a hook can spend it twice: about 10 s at worst, well
// under a harness's hook timeout. Each reading is linear, so a 1 MB line costs well under a second per reading.)
export const JUDGE_BUDGET_MS = 5000;
let deadline = Infinity;
// How many characters of `case` words one reading may scan (#498 review round 2).
const CASE_SCAN = 1 << 20;
const caseLeft = { n: Infinity };
const TOO_MANY_READINGS = { allow: false, message: 'yad agent guard: this command has too many `case` words inside `$(…)` to judge. Run it as separate commands.' };
const OUT_OF_TIME = { allow: false, message: 'yad agent guard: this command took too long to judge. Run it as separate commands.' };
// The files a reading of the command writes (#498, row 8): each path's texts, every one ever written (a write
// that may not run must not hide an earlier one), plus the text a run of `>>` writes in all. One map per reading
// of the top-level command, shared by every line it carries, so `echo … > f; bash -c 'bash f'` is seen.
// `seen` logs each read as [path, the file's version then]; `appends` counts `>>` writes. A pass whose reads all
// saw the final version, with no `>>`, would be judged the same again, so it is not (see judgeLine).
const files = { map: new Map(), judged: 0, writes: 0, version: 0, seen: [], appends: 0 };
const resetFiles = () => { files.map = new Map(); files.judged = 0; files.writes = 0; files.version = 0; files.seen = []; files.appends = 0; };
const TOO_MUCH_WRITTEN = { allow: false, message: 'yad agent guard: this command runs files it writes too many times, or too much text, to judge. Run it as separate commands.' };
// `ends`: the end rule the reading this line came from uses (#498); a `$(…)` inside a line is read by the same
// shell. Unset for a line read afresh (the top line, or what `bash -c` or `eval` runs).
export function agentGuardDecision(line, depth = 0, ends = undefined) {
  if (typeof line === 'string' && line.length > MAX_JUDGED) {
    return { allow: false, message: `yad agent guard: this command is too long to judge (${line.length} characters, more than ${MAX_JUDGED}). Write what it carries to a file with your editor, or run it as separate commands.` };
  }
  if (depth > 0) return judgeReadings(line, depth, ends);
  deadline = Date.now() + JUDGE_BUDGET_MS;
  caseLeft.n = CASE_SCAN;
  resetFiles();
  try {
    return judgeReadings(line, depth);
  } catch (e) {
    // A line the reader cannot judge is refused, never let through: the payload was read, so this is a bug here.
    return { allow: false, message: `yad agent guard: this command could not be judged (${e?.message ?? e}). Run it as separate commands, and report it with \`yad report\`.` };
  } finally {
    deadline = Infinity;
    caseLeft.n = Infinity;
    resetFiles();
  }
}
// Where the first heredoc whose end word expands (`<<E$x`, `<<"E\`x\`"`) opens, or -1: read from the actual matches,
// one `<<` at a time, so it is linear (a regex over the line backtracked: quadratic on a run of `<<`).
function firstExpandingHeredoc(text) {
  for (let i = text.indexOf('<<'); i >= 0; i = text.indexOf('<<', i + 2)) {
    const m = heredocAt(text, i);
    if (m?.expands) return i;
  }
  return -1;
}
// Every reading the shells may make of the line: as written; with CRs dropped (a CR-dropping shell); with every
// `\` + newline join made, CRs dropped first (a `$\<LF>(`, an end word split by a join: `EO\<LF>F`); and, where
// the line has the context the reader does not track, each mode of shellParts. Refused if any reading refuses.
function judgeReadings(line, depth, ends) {
  if (typeof line !== 'string') return { allow: true };
  // The end rules of `$(…)` (#498): main's, bash 3.2's and zsh's (see substitutionEnd).
  // A line inside a `$(…)` keeps its reading's rule; a fresh one gets each rule that can differ here.
  const rules = ends !== undefined ? [ends] : [''];
  if (ends === undefined && line.includes('$(')) {
    const ansi = line.includes('$\'') || line.includes('#');
    if (ansi || line.includes('`')) rules.push('bash');
    if (ansi || /\bcase\b/.test(line)) rules.push('zsh');
  }
  const texts = [line];
  if (line.includes('\r')) texts.push(line.replace(/\r/g, ''));
  if (/\\\r?\n/.test(line)) texts.push(line.replace(/\r/g, '').replace(/\\\n/g, ''));
  const expandsAt = firstExpandingHeredoc(line);
  const flags = [];
  if (expandsAt >= 0) flags.push('literalExpanding');
  if (/[()]#/.test(line)) flags.push('hashAfterParen');
  // A `#` right after `|` is a comment in command position, text in `[[ =~ ]]` (#495).
  if (/\|#/.test(line)) flags.push('hashAfterBar');
  if (/<[0-9]*-[0-9]*>/.test(line)) flags.push('numericGlob');
  // Every combination of the readings that apply (at most 16).
  const flagModes = [{}];
  for (const f of flags) for (const m of flagModes.slice()) flagModes.push({ ...m, [f]: true });
  const modes = [];
  for (const rule of rules) for (const m of flagModes) modes.push({ ...m, ends: rule });
  for (const mode of modes) {
    for (const text of texts) {
      // Each reading of the command gets its own budget for `case` words (#498).
      if (depth === 0) { caseLeft.n = CASE_SCAN; resetFiles(); }
      const v = judgeLine(text, depth, mode);
      if (!v.allow) return v;
    }
  }
  // An end word that expands can end the heredoc on any line, whatever the variable holds (`bash -c "cat <<E$x …"`
  // with an empty $x ends at `E`): each line is judged on its own too, so the command after it is seen wherever
  // the heredoc ends. Only refuses more.
  if (expandsAt >= 0) {
    for (const text of texts) {
      const from = firstExpandingHeredoc(text);
      for (const one of text.slice(from < 0 ? 0 : from).split('\n')) {
        for (const rule of rules) {
          if (depth === 0) { caseLeft.n = CASE_SCAN; resetFiles(); }
          const v = judgeLine(one, depth, { ends: rule });
          if (!v.allow) return v;
        }
      }
    }
  }
  return { allow: true };
}
// The four refusals for one part's words.
function partVerdict(part) {
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
  return { allow: true };
}
const TOO_MANY_BRACES = { allow: false, message: 'yad agent guard: this command\'s brace lists expand to too many words, or a word with them is too long, to judge. Write the words out, quote them, or run it as separate commands.' };
const TOO_DEEP = { allow: false, message: 'yad agent guard: this command nests `$(…)`, backticks or `bash -c` too deep to judge. Run it as separate commands.' };
// Text that reaches a shell (#498, rows 1, 2, 8). A path as the shell finds it again: `./f` and `d/../f` are `f`.
const normPath = (p) => path.posix.normalize(p).replace(/^(?:\.\/+)+/, '');
// At most this many texts are kept for one file; running a file with more is refused, and so is reading one
// into anything a shell then runs.
const FILE_TEXTS = 64;
// At most this many characters of written files are read in one pass over a line (each read is judged again),
// a quarter of MAX_JUDGED: a line that reads past it is refused sooner, inside a hook's time (#498 CI: at the
// full cap, `echo x | tee -a f; cat f | bash;` repeated took 4.7 s to reach it on a slow runner).
const FILE_JUDGED = 250_000;
// What a read of a file past these limits gives: a text that refuses the line once a shell would run it, so a
// file only printed (`cat notes.md`) is not refused for its size (#498 review).
const OVER = '\0yad-guard-too-much-written\0';
// Every text a file may hold when it is read (each write, and each reading of the whole run of `>>`), or null
// when it holds too many, or too much text was read from files in all (each read is judged again, so this keeps
// it linear).
function fileTexts(p) {
  const key = normPath(p);
  const f = files.map.get(key);
  files.seen.push([key, f ? f.v : 0]);
  if (!f) return [];
  if (f.over || f.texts.size > FILE_TEXTS) return null;
  const out = [...f.texts];
  for (const a of f.all ?? []) if (!f.texts.has(a)) out.push(a);
  for (const t of out) if ((files.judged += t.length) > FILE_JUDGED) return null;
  return out;
}
// A write of `texts` (the readings of what a part prints) to a file: added to its texts, never replacing one.
// `all` holds the readings of the whole file, should every write before have run: `>>` joins each reading of
// what was there with each new one (side by side, as zipJoin does).
function writeFile(target, texts, append) {
  files.writes++;
  const key = normPath(target);
  let f = files.map.get(key);
  if (!f) files.map.set(key, (f = { texts: new Set(), all: null, over: false, v: 0 }));
  if (append) files.appends++;
  const size = f.texts.size;
  const oldAll = f.all;
  const wasOver = f.over;
  for (const t of texts) if (t !== '') f.texts.add(t);
  // Joined one by one, not through zipJoin's reduce, so a long run of `>>` stays linear (#498 review).
  if (append) {
    if (texts.length) {
      const old = f.all;
      if (old === null) f.all = texts.slice();
      else { const n = Math.max(old.length, texts.length); f.all = []; for (let j = 0; j < n; j++) f.all.push(`${old[Math.min(j, old.length - 1)]}\n${texts[Math.min(j, texts.length - 1)]}`); }
    }
  } else {
    for (const a of f.all ?? []) if (a !== '') f.texts.add(a);
    f.all = texts.length ? texts.slice() : null;
  }
  if (f.all && (f.all.length > FILE_TEXTS || f.all.some((a) => a.length > FILE_JUDGED))) { f.all = null; f.over = true; }
  // A new version only when a read would now give something else.
  const sameAll = oldAll === f.all || (oldAll !== null && f.all !== null && oldAll.length === f.all.length && oldAll.every((a, j) => a === f.all[j]));
  if (f.v === 0 || f.texts.size !== size || !sameAll || f.over !== wasOver) f.v = ++files.version;
}
// The text each part is fed (its heredocs and here-strings), grouped once by part. A here-string's `$(…)` is also
// read with its printed text in place (#498, row 2), one level deep: `bash <<< "$(echo '…; gh pr merge 5')"`.
function fedOf(parts, mode, deep) {
  const fed = new Map();
  const add = (n, t) => { if (!fed.has(n)) fed.set(n, []); fed.get(n).push(t); };
  for (const x of parts.bodies) add(x.part, x.text);
  for (const x of parts.herestrings) {
    add(x.part, x.text);
    if (deep && x.subst) {
      const s = spellWord(x.subst, mode, true);
      if (s === null) return null;
      for (const ws of s) add(x.part, ws.join(' '));
    }
  }
  return fed;
}
// What part `n` prints, read from each of its spellings `lists` (words with the prefix stripped): the text it is
// fed, `echo`'s words, `printf`'s two readings, and every text a `cat <file>` may hold (#498, row 8), with the
// files of one `cat` also joined. `input` is what it reads from a pipe or a `<` file, which `cat` (with no file,
// or `-`) and `tee` print. A file read past its limits gives OVER.
function printedOf(fed, n, lists, input = []) {
  const out = [...(fed.get(n) ?? [])];
  for (const pw of lists) {
    if (!pw.length) continue;
    const prog = programOf(pw[0]);
    // Only `echo`'s leading options are options: `echo git commit -n` prints the `-n` (#498 review). zsh's `-`
    // (and `print`'s `--`) ends them and is not printed; `print -f` takes a format, as printf does.
    if (prog === 'echo' || prog === 'print') {
      let k = 1;
      let format = false;
      while (k < pw.length && (prog === 'echo' ? /^-[neE]+$/ : /^-[A-Za-z]+$/).test(pw[k])) { if (prog === 'print' && pw[k].includes('f')) format = true; k++; }
      out.push(pw.slice(k).join(' '));
      // And main's reading, every `-n`/`-e`/`-E` word dropped wherever it stands: judged on its own, as main
      // judged it, and kept out of the joins (in the list, it moved the readings the joins pair, #498 review).
      if (prog === 'echo') (out.alone ??= []).push(pw.slice(1).filter((x) => !/^-[neE]+$/.test(x)).join(' '));
      if (pw[k] === '-' || (prog === 'print' && pw[k] === '--') || format) out.push(pw.slice(k + 1).join(' '));
    }
    // `printf` prints its format and its words; also its words after the format (`--` ends its options).
    if (prog === 'printf') {
      const f = pw[1] === '--' ? 2 : 1;
      out.push(pw.slice(1).join(' '), pw.slice(f).join(' '), pw.slice(f + 1).join(' '));
    }
    if (prog === 'cat' || prog === 'tee') {
      // A word read past its limits stays, even as an option (`cat -$(cat f)` may be `cat -- h`, #498 review).
      const args = pw.slice(1).filter((a) => !a.startsWith('-') || a === '-' || (prog === 'cat' && a.includes(OVER)));
      if (prog === 'tee' || !args.length || args.includes('-')) for (const x of input) out.push(x);
      if (prog === 'cat') {
        const per = [];
        for (const a of args) {
          if (a === '-') continue;
          // A file name read past its limits (`cat $(cat f)`): the file it names is unknown, so is what it prints
          // (#498 review: it read as no file, and `cat $(cat f) | bash` was let through).
          if (a.includes(OVER)) { per.push([OVER]); continue; }
          const t = fileTexts(a);
          per.push(t === null ? [OVER] : t.length ? t : ['']);
        }
        // One empty reading at most: a file may be empty when read (`printf '' > a`), and the joins need that
        // reading, but each one more was joined to every reading before it (#498 review: out of memory).
        let empty = false;
        for (const t of per) for (const x of t) if (x !== '') out.push(x); else if (!empty) { empty = true; out.push(x); }
        if (per.length > 1) for (const x of zipJoin(per)) out.push(x);
      }
    }
  }
  return out;
}
// Readings side by side: the j-th joins each list's j-th reading (its last, once it has no more) by newlines, as
// their output is, so every reading is in one of them and the count stays the longest list's. Built from pieces,
// one join each, so a long `cat f f f …` stays linear (#498 review). Past ZIP_CHARS characters in all, the
// joins are the text read past its limits instead: a shell that runs it is refused (#498 review: many readings
// of a part, each joined to a long one, ran out of memory before the cut-off, and a crashed hook lets it run).
const ZIP_CHARS = 2 * MAX_JUDGED;
function zipJoin(per) {
  let n = 0;
  for (const p of per) n = Math.max(n, p.length);
  const out = [];
  let size = 0;
  for (let j = 0; j < n; j++) {
    const pieces = [];
    for (let q = 0; q < per.length; q++) {
      if ((q & 4095) === 0 && Date.now() > deadline) return [OVER];
      const x = per[q][Math.min(j, per[q].length - 1)];
      if ((size += x.length + 1) > ZIP_CHARS) return [OVER];
      pieces.push(x);
    }
    out.push(pieces.join('\n'));
  }
  return out;
}
// The readings of what a `$(…)` prints, when its text says (#498, row 2): `$(<f)`, and the `echo`, `printf`,
// `cat` and heredoc text of its parts, in order, trailing newlines dropped. One level: a `$(…)` inside is not
// read. `['']` when nothing it prints is known, null when a file read holds too much.
function subOutputs(text, mode) {
  const m = /^\s*<\s*([^\s;&|<>()$`'"\\]+)\s*$/.exec(text);
  if (m) { const t = fileTexts(m[1]); return t === null ? [OVER] : (t.length ? t : ['']); }
  if (!/echo|printf|print|cat|<</.test(text.replace(/[\\'"]/g, ''))) return [''];
  const sp = shellParts(text, { ends: mode.ends });
  if (sp.tooComplex) return [''];
  const fed = fedOf(sp, mode, false);
  const per = [];
  let prev = [];
  for (let k = 0; k < sp.length; k++) {
    if (Date.now() > deadline) return [OVER];
    const t = printedOf(fed, k, spellingsOf(sp, k, null), sp.piped.has(k) ? prev : []);
    if (t.length) per.push(t);
    prev = t;
  }
  const out = zipJoin(per).map((x) => x.replace(/\n+$/, ''));
  return out.length ? out : [''];
}
// A word with each `$(…)` replaced by a reading of what it prints, as the shell makes it: split on blanks into
// words outside double quotes (an empty one drops out), kept whole inside them. One list of words per reading,
// or null when a file read holds too much.
function spellWord(entry, mode, noSplit = false) {
  const outs = [];
  for (const s of entry.subs) { const o = subOutputs(s.text, mode); if (o === null) return null; outs.push(o); }
  let n = 1;
  for (const o of outs) n = Math.max(n, o.length);
  const res = [];
  for (let j = 0; j < n; j++) {
    const ws = [];
    let cur = '';
    let from = 0;
    let kept = false;
    entry.subs.forEach((s, q) => {
      cur += entry.word.slice(from, s.at);
      const text = outs[q][Math.min(j, outs[q].length - 1)];
      if (s.quoted || noSplit) { cur += text; kept = true; } else {
        const toks = text.split(/[ \t\n]+/);
        cur += toks[0];
        for (let t = 1; t < toks.length; t++) { if (cur !== '') ws.push(cur); cur = toks[t]; }
      }
      from = s.at + s.len;
    });
    cur += entry.word.slice(from);
    if (cur !== '' || kept) ws.push(cur);
    res.push(ws.map(unshieldBraces));
  }
  return res;
}
// A part's spellings, prefix stripped: as written, and with the backslashes double quotes keep (#498). `subst`
// adds the spellings with each `$(…)` read for what it prints.
function spellingsOf(parts, n, subst) {
  const part = parts[n];
  const out = [stripPrefix(part)];
  const posix = parts.posix[n];
  if (posix) { const kept = part.slice(); for (const [k, v] of posix) kept[k] = v; out.push(stripPrefix(kept)); }
  if (subst) for (const s of subst) out.push(stripPrefix(s));
  return out;
}
// The spellings of part `n` with each `$(…)` read for what it prints (#498, row 2), whole parts with the prefix;
// null when a file read holds too much. Only the words with a `$(…)` change.
function substituted(parts, n, mode) {
  const subst = parts.subst[n];
  if (!subst) return [];
  const part = parts[n];
  const alts = new Map();
  let m = 0;
  for (const [k, e] of subst) {
    const a = spellWord(e, mode);
    if (a === null) return null;
    alts.set(k, a); m = Math.max(m, a.length);
  }
  const out = [];
  for (let j = 0; j < m; j++) {
    const ws = [];
    for (let k = 0; k < part.length; k++) {
      const a = alts.get(k);
      if (!a) { ws.push(part[k]); continue; }
      for (const x of a[Math.min(j, a.length - 1)]) ws.push(x);
    }
    out.push(ws);
  }
  return out;
}
function judgeLine(line, depth, mode = {}) {
  if (typeof line !== 'string' || !line.trim()) return { allow: true };
  if (Date.now() > deadline) return OUT_OF_TIME;
  const parts = shellParts(line, mode);
  if (parts.tooComplex) return Date.now() > deadline ? OUT_OF_TIME : TOO_MANY_READINGS;
  // The commands a `$(…)` or backticks run are judged too, three levels deep; one deeper is refused (#492).
  if (parts.subs.length && depth >= 3) return TOO_DEEP;
  // At most twice, when the first pass writes a file (#498 review): a `$(…)` is judged before the parts that write, and a
  // loop or a function may run a file a later part writes (`g(){ bash f; }; echo … > f; g`). The second pass
  // judges it all again with the files the first one saw. Only refuses more.
  // Each pass reads the files on its own budget (#498 review: the second read halved it).
  // A second pass is needed only when a read in the first saw a file a later write changed, or a `>>` ran (a
  // second append joins the text again); otherwise it would judge the same texts again (#498 CI: twice at every
  // level made `x=$(echo a > f; bash f);` repeated pass the 5 s cut-off on a slower machine).
  const judgedBefore = files.judged;
  for (let pass = 0; pass < 2; pass++) {
    files.judged = judgedBefore;
    const writesBefore = files.writes;
    const seenFrom = files.seen.length;
    const appendsBefore = files.appends;
    const v = judgeParts(parts, depth, mode);
    if (!v.allow || files.writes === writesBefore) return v;
    if (files.appends === appendsBefore && !files.seen.slice(seenFrom).some(([k, ver]) => (files.map.get(k)?.v ?? 0) !== ver)) return v;
  }
  return { allow: true };
}
// Each process substitution's inner parts are walked once per owner; nested ones walk them again, so past this
// many in all for one line the line is refused, not read on (#498 review: nested `bash <(` was quadratic).
const PROCSUB_WALK = 200000;
const TOO_MANY_PROCSUBS = { allow: false, message: 'yad agent guard: this command nests too many process substitutions (`<(…)`) to judge. Run it as separate commands.' };
function judgeParts(parts, depth, mode) {
  for (const sub of parts.subs) {
    const v = agentGuardDecision(sub, depth + 1, mode.ends ?? '');
    if (!v.allow) return v;
  }
  // The text each part is fed, grouped once by part (a loop over every body for every part was quadratic).
  const fed = fedOf(parts, mode, true);
  if (fed === null) return TOO_MUCH_WRITTEN;
  const printed = [];
  const printedPer = [];
  // The process substitutions each part owns (#498, row 1), and what the part before this one printed (`tee`).
  const procsubs = new Map();
  for (const p of parts.procsubs) { if (!procsubs.has(p.from - 1)) procsubs.set(p.from - 1, []); procsubs.get(p.from - 1).push(p); }
  const pipedWrites = new Map();
  for (const p of parts.pipedWrites) { if (!pipedWrites.has(p.after)) pipedWrites.set(p.after, []); for (const wr of p.writes) pipedWrites.get(p.after).push(wr); }
  let before = [];
  let walked = 0;
  for (let n = 0; n < parts.length; n++) {
    const part = parts[n];
    // Every way the shell may read this part's words (#495): as written; with a command word that expands
    // (`$(echo gh)`, `${x:-gh}`, `=gh`, `$SHELL`) dropped (it may be empty) or as each guarded program or a
    // shell; and with its unquoted brace lists expanded, with the empty words kept (zsh) and dropped (bash).
    if (Date.now() > deadline) return OUT_OF_TIME;
    const w = stripPrefix(part);
    const variants = [part];
    // The backslashes kept in double quotes (#498): what `bash -c` and `eval` re-read.
    const posix = parts.posix[n];
    if (posix) { const kept = part.slice(); for (const [k, v] of posix) kept[k] = v; variants.push(kept); }
    const braced = parts.braced[n];
    if (braced) {
      // Four readings: the first-`}` rule with the empty words kept (zsh) and dropped (bash), as before; then with
      // `$(…)`, backticks and `${…}` opaque, by the first-`}` rule with empty words kept (zsh) and by bash's own
      // rule with them dropped (#498). Duplicates are judged once.
      const readings = [{}, { drop: true }, { shield: true }, { shield: true, bash: true, drop: true }];
      const seen = new Set();
      for (const r of readings) {
        const out = [];
        let added = 0;
        for (let k = 0; k < part.length; k++) {
          if (!braced.has(k)) { out.push(part[k]); continue; }
          const raw = r.shield ? shieldExpansions(braced.get(k), mode) : braced.get(k);
          const e = raw === null ? null : braceExpand(raw, { left: BRACE_CAP }, { bash: r.bash });
          if (!e || (added += e.length - 1) > 4 * BRACE_CAP) return Date.now() > deadline ? OUT_OF_TIME : TOO_MANY_BRACES;
          // Only an expansion's empty words are dropped, as bash does; a quoted `''` is a word.
          for (const y of e) if (!(r.drop && y === '')) out.push(unshieldBraces(y));
        }
        const key = JSON.stringify(out);
        if (!seen.has(key)) { seen.add(key); variants.push(out); }
      }
    }
    // Every reading so far is one a real shell makes; the ones below are not. Each `$(…)` read for what it prints
    // (#498, row 2): `bash -c "$(cat <<'EOF' … EOF)"` runs the heredoc's text. Then the command-word guesses.
    const real = variants.length;
    const subst = substituted(parts, n, mode);
    if (subst === null) return TOO_MUCH_WRITTEN;
    // A file read past its limits whose text is the command (`$(<f)`): refused, as a shell would run it.
    // A file read past its limits, in a word of a command that is not a printer (`gh $(<f)`): refused.
    for (const s of subst) {
      const sw = stripPrefix(s);
      if (sw.length && (sw[0].includes(OVER) || (!PRINTERS.has(programOf(sw[0])) && sw.some((x) => x.includes(OVER))))) return TOO_MUCH_WRITTEN;
      variants.push(s);
    }
    for (const base of variants.slice()) {
      const bw = stripPrefix(base);
      const raw = base[base.length - bw.length] ?? '';
      if (bw.length && (/[$`]/.test(raw) || /^=[A-Za-z]/.test(raw))) {
        const bl = base.slice(0, base.length - bw.length);
        variants.push([...bl, ...bw.slice(1)], ...['gh', 'glab', 'git', 'yad', 'bash'].map((prog) => [...bl, prog, ...bw.slice(1)]));
      }
    }
    // The lines each variant carries (`bash -c`, `env -S`, `find -exec`, a git alias, `eval`) are judged too, as deep;
    // one deeper is refused. A shell that reads its input runs what it is fed: its own heredoc or here-string, and
    // any text an earlier part prints (a pipe, `tee`, a `cat <<EOF` body), each judged once, by the first shell.
    const carried = [];
    let readsInput = false;
    for (const vw of variants) for (const t of innerLines(vw)) carried.push(t);
    // A real shell (as written, or brace-expanded) takes all the text printed before it: through a pipe, a group
    // (`{ echo …; } | bash`), or a file it reads back. A command word only guessed to be a shell needs a real pipe:
    // otherwise any `$x` line after a docs heredoc would be judged as running it.
    let realShell = false;
    variants.forEach((vw, k) => { if (bareShell(stripPrefix(vw))) { readsInput = true; if (k < real) realShell = true; } });
    if (readsInput) {
      for (const t of fed.get(n) ?? []) carried.push(t);
      // Each text, and the texts of the parts before joined as their output is (`{ printf 'gh pr '; echo merge 5; }
      // | bash`, #498 review).
      if (realShell || parts.piped.has(n)) {
        for (const t of printed) carried.push(t);
        // Also joined by newlines, as their output is: a quote one text opens, a later one closes.
        if (printedPer.length > 1) for (const t of zipJoin(printedPer)) carried.push(t);
        printed.length = 0; printedPer.length = 0;
      }
    }
    // A process substitution this part runs as its script, or reads as its input (#498, row 1): what its parts
    // print, in order (`bash <(echo …)`, `source <(…)`, `bash < <(…)`, zsh's `=(…)`).
    // A command word that expands is also read as a shell (`$SHELL <(…)`), as for the part's own words.
    for (const p of procsubs.get(n) ?? []) {
      const owners = [p.owner];
      const ow0 = stripPrefix(p.owner);
      if (ow0.length && (/[$`]/.test(ow0[0]) || /^=[A-Za-z]/.test(ow0[0]))) owners.push([...p.owner.slice(0, p.owner.length - ow0.length), 'bash', ...ow0.slice(1)]);
      const maybeShell = p.maybe && (SHELLS.includes(programOf(ow0[0] ?? '')) || ['source', '.'].includes(programOf(ow0[0] ?? '')));
      const runs = maybeShell || owners.some((o) => {
        const ow = [...o, '\0'];
        const sw = stripPrefix(ow);
        return scriptAt(sw) === p.position - (ow.length - sw.length) || (p.viaStdin && bareShell(stripPrefix(o)));
      });
      if (!runs) continue;
      if ((walked += p.to - p.from) > PROCSUB_WALK) return TOO_MANY_PROCSUBS;
      const per = [];
      let prev = [];
      for (let k = p.from; k < p.to; k++) {
        if (Date.now() > deadline) return OUT_OF_TIME;
        const t = printedOf(fed, k, spellingsOf(parts, k, null), parts.piped.has(k) ? prev : []);
        if (t.length) per.push(t);
        prev = t;
      }
      for (const t of zipJoin(per)) carried.push(t);
    }
    // A file written earlier on the line (#498, row 8), run as a shell's script, through `source` or `.`, as a
    // program by its path (`./f`), or read by a shell through `<`: each text it may hold.
    const runs = new Set();
    for (const vw of variants) {
      const sw = stripPrefix(vw);
      if (!sw.length) continue;
      const k = scriptAt(sw);
      if (k >= 0) { runs.add(sw[k]); if (/[$`]/.test(sw[k]) && k + 1 < sw.length) runs.add(sw[k + 1]); }
      if (sw[0].includes('/')) runs.add(sw[0]);
      if (bareShell(sw)) for (const r of parts.reads[n] ?? []) runs.add(r);
    }
    for (const f of runs) {
      const t = fileTexts(f);
      if (t === null) return TOO_MUCH_WRITTEN;
      for (const x of t) carried.push(x);
    }
    if (carried.length && depth >= 3) return TOO_DEEP;
    for (const inner of carried) {
      // A file read past its limits, run by a shell (#498, row 8).
      if (inner.includes(OVER)) return TOO_MUCH_WRITTEN;
      const v = agentGuardDecision(inner, depth + 1);
      if (!v.allow) return v;
    }
    for (const vw of variants) {
      const v = partVerdict(vw);
      if (!v.allow) return v;
    }
    // What this part prints or is fed, for a shell later on the line: as written, with the backslashes double
    // quotes keep (#498 review: `echo "\\'; …" | bash`), and with each `$(…)` read for what it prints.
    // `cat` and `tee` print what they read from a pipe or a `<` file too.
    const prog = w.length ? programOf(w[0]) : '';
    const input = parts.piped.has(n) ? before.slice() : [];
    if (prog === 'cat' || prog === 'tee') for (const r of parts.reads[n] ?? []) { const t = fileTexts(r); if (t === null) input.push(OVER); else for (const x of t) input.push(x); }
    const outs = printedOf(fed, n, spellingsOf(parts, n, subst), input);
    if (outs === null) return TOO_MUCH_WRITTEN;
    for (const t of outs) printed.push(t);
    for (const t of outs.alone ?? []) printed.push(t);
    if (outs.length) printedPer.push(outs);
    // The files it writes (#498, row 8): its output through `>` or `>>` (with what it is piped, which a filter
    // like `cat` or `sort` passes on), and, for `tee`, its file words.
    const written = parts.piped.has(n) && prog !== 'cat' && prog !== 'tee' ? [...outs, ...before] : outs;
    // Each file once per part (`>&f >&f …` wrote the part's text once per redirect, #498 review).
    const once = new Set();
    for (const wr of parts.writes[n] ?? []) { const key = `${wr.append}:${wr.target}`; if (!once.has(key)) { once.add(key); writeFile(wr.target, written, wr.append); } }
    for (const wr of pipedWrites.get(n) ?? []) writeFile(wr.target, outs, wr.append);
    if (prog === 'tee') {
      const append = w.slice(1).some((x) => x === '--append' || /^-[A-Za-z]*a/.test(x));
      for (const a of w.slice(1)) if (!a.startsWith('-')) writeFile(a, outs, append);
    }
    before = outs;
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
    // The reader replaces these (the brace shield), so a file named with one would be judged under another name.
    if (/[\uE000-\uE002]/.test(line)) return no;
    const at = { cwd: path.resolve(root, cwd), root };
    if (!insideProject('.', at)) return no;
    const clean = blankHarmlessRedirects(line);
    if (clean === null) return no;
    if (clean.includes('`') || /\$\(/.test(clean)) return no;
    const parts = shellParts(clean);
    if (!parts.length || parts.subs.length) return no;
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
