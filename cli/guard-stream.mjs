// Output reading (#532): a pass beside the guard's own readings. It follows what each command prints, byte by
// byte, so a print with no newline runs on into the next one as in a real shell, and it judges any text that
// reaches a shell (a pipe into `bash`, a file then run, `bash <(…)`). It never adds an entry to the guard's lists
// paired by place (zipJoin, printedOf, …), and it runs only after the guard's own reading allowed the line, so it
// can only add refusals.
//
// bash and zsh print some things differently (zsh's `echo` always makes escapes, `%b` and `\c` differ), so the
// pass runs once as bash reads the line and, when they may differ (`zshDiffers`), once more as zsh reads it.
import path from 'node:path';

const SHELL_PROG = /^(?:bash|sh|zsh|dash|ksh|source|\.)$/;
// A compound command's last part: its output, and its redirects, are the whole command's.
const CLOSERS = new Set(['}', 'fi', 'done', 'esac']);
// Each opener with the word that closes it.
const OPENERS = new Map([['if', 'fi'], ['for', 'done'], ['while', 'done'], ['until', 'done'], ['select', 'done'], ['case', 'esac']]);
// Reserved words that may stand before a compound command in the same part (`then while …`, `{ if …`, `! for …`).
const LEAD = new Set(['{', '(', 'then', 'do', 'else', 'elif', '!', 'time']);
// The part's first word that is not one of those (`time -p for …` too).
const headOf = (ws) => { let i = 0; while (i < ws.length && (LEAD.has(ws[i]) || (ws[i - 1] === 'time' && ws[i] === '-p'))) i++; return ws[i]; };
// Every text a file may hold is kept (a write that may not run hides none before it, as in the guard's own
// file reading); past this many for one file the line is refused.
const MAX_TEXTS = 64;
// A `printf` width past this is refused, not built (`%999999999s`).
const MAX_WIDTH = 65536;
// Process substitutions nested past this many are refused as too deep.
const PROC_LEVELS = 16;
const LIMIT = 'YAD_GUARD_OUTPUT_LIMIT';
const fail = (message, code = LIMIT) => Object.assign(new Error(message), { code });

// True when zsh may print the line differently from bash: an escape (a backslash), or zsh's `echo -`.
export const zshDiffers = (line) => line.includes('\\') || /(?:^|[\s;&|({])echo\s+-(?:\s|$)/.test(line);

// The characters a `tr` set names: escapes, ranges and the common classes. null for what is not read
// (`[=c=]`, `[c*n]`, an unknown class): its output is then unknown, as before.
const CLASSES = { space: /\s/, blank: /[ \t]/, cntrl: { test: (c) => c < ' ' || c === '\x7f' }, digit: /\d/, lower: /[a-z]/, upper: /[A-Z]/,
  alpha: /[A-Za-z]/, alnum: /[A-Za-z0-9]/, punct: /[!-/:-@[-`{-~]/, print: /[ -~]/, graph: /[!-~]/ };
function trSet(s) {
  if (s === undefined) return null;
  const chars = [];
  let i = 0;
  const one = () => {
    if (s[i] === '\\' && i + 1 < s.length) {
      const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1));
      if (oct) { i += 1 + oct[0].length; return String.fromCharCode(parseInt(oct[0], 8) & 255); }
      const c = s[i + 1];
      i += 2;
      return ({ n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v' })[c] ?? c;
    }
    return s[i++];
  };
  while (i < s.length) {
    const cls = /^\[:(\w+):\]/.exec(s.slice(i));
    if (cls) {
      const re = CLASSES[cls[1]];
      if (!re) return null;
      for (let c = 0; c < 128; c++) if (re.test(String.fromCharCode(c))) chars.push(String.fromCharCode(c));
      i += cls[0].length;
      continue;
    }
    if (/^\[(?:=.=\]|.\*)/.test(s.slice(i))) return null;
    const a = one();
    if (s[i] === '-' && i + 1 < s.length) {
      i++;
      const b = one();
      const from = a.charCodeAt(0), to = b.charCodeAt(0);
      if (to < from || to - from > 512) return null;
      for (let c = from; c <= to; c++) chars.push(String.fromCharCode(c));
    } else chars.push(a);
  }
  return chars;
}

export function streamGuard(line, mode, api, zsh = false) {
  const files = new Map();
  let verdict = { allow: true };
  const charge = api.charge;
  const copy = (s) => { charge(s.length + 1); return s; };
  const join = (xs) => { for (const x of xs) charge(x.length + 1); return xs.join(''); };
  // A file's name as the reader records a redirect's target, with no backslash (the run's word keeps the one the
  // shell keeps in double quotes): `> "a\b"; bash "a\b"` is one file (#532 review 2). Two names may share one.
  const key = (s) => path.posix.normalize(s.replace(/\\/g, ''));
  // Every text the file may hold, one after another on lines of their own: no two are read as one line.
  // Each text on its own, for a shell that runs the file: joined, an open quote in one would hide the next
  // (#532 review 2). Past MAX_TEXTS a file is refused only when read, not when written.
  const textsOf = (s) => {
    const texts = files.get(key(s));
    if (!texts) return [];
    if (texts.over) throw fail('too many writes to one file');
    for (const t of texts) charge(t.length + 1);
    return texts.slice();
  };
  const read = (s) => join(textsOf(s).flatMap((t, i) => i ? ['\n', t] : [t]));
  // A `>` adds a text (the same text again only moves to the end, as the guard's own set of a file's texts
  // keeps it once); a `>>` adds to each one.
  const write = (wr, text) => {
    const k = key(wr.target);
    const t = copy(text);
    const texts = files.get(k);
    if (!texts) { files.set(k, [t]); return; }
    // Texts that differ still differ with the same text added, so a `>>` makes no two the same.
    if (wr.append) { for (let i = 0; i < texts.length; i++) { charge(t.length + 1); texts[i] += t; } return; }
    const at = texts.indexOf(t);
    if (at >= 0) texts.splice(at, 1);
    else if (texts.length >= MAX_TEXTS) { texts.over = true; return; }
    texts.push(t);
  };
  const check = (s) => { if (s && verdict.allow) verdict = api.judge(s); };

  // The octal escapes each reader makes (checked in a real bash 3.2 and zsh 5.9): `echo` (bash's with -e) and
  // zsh's `%b` read `\0NNN` only; bash's `%b` also reads `\NNN`; a `printf` format and zsh's `print` read `\NNN`,
  // so `\0405` there is `\040` and `5`.
  const OCTAL = { echo: '0[0-7]{0,3}', b: zsh ? '0[0-7]{0,3}' : '0[0-7]{0,3}|[1-7][0-7]{0,2}', fmt: '[0-7]{1,3}' };
  const ESC = Object.fromEntries(Object.entries(OCTAL).map(([k, o]) => [k, {
    any: new RegExp(`\\\\(x[\\da-fA-F]{1,2}|${o}|[\\s\\S])`, 'g'), octal: new RegExp(`^(?:${o})$`) }]));
  const LETTERS = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\' };
  // `\c` ends all output; in a format bash 3.2 prints it as it is, zsh stops.
  function escapes(s, kind, stopAtC = kind !== 'fmt' || zsh) {
    const { any, octal } = ESC[kind];
    any.lastIndex = 0;
    let text = '', from = 0, m;
    while ((m = any.exec(s))) {
      text += s.slice(from, m.index);
      from = any.lastIndex;
      const c = m[1];
      if (c === 'c' && stopAtC) return { text, stopped: true };
      if (c.length > 1 && c[0] === 'x') text += String.fromCharCode(parseInt(c.slice(1), 16));
      else if (octal.test(c)) text += String.fromCharCode(parseInt(c, 8) & 255);
      else text += LETTERS[c] ?? `\\${c}`;
    }
    return { text: text + s.slice(from), stopped: false };
  }
  // What `printf` (or `print -f`) prints: its format, used again while words are left, with `%s`, `%b`, `%c`,
  // the numbers, widths and precisions filled from its words.
  const CONV = /%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d*))?([a-zA-Z%])/g;
  function formatted(args) {
    const fmt = args[0] ?? '', rest = args.slice(1);
    const out = [];
    let at = 0, stop = false;
    for (;;) {
      let from = 0, used = false;
      for (const m of fmt.matchAll(CONV)) {
        const lit = escapes(fmt.slice(from, m.index), 'fmt');
        out.push(copy(lit.text));
        if (lit.stopped) { stop = true; break; }
        from = m.index + m[0].length;
        const [, flags, w, p, conv] = m;
        if (conv === '%') { out.push('%'); continue; }
        used = true;
        const width = w === '*' ? Number.parseInt(rest[at++] ?? '0', 10) || 0 : Number(w ?? 0);
        const prec = p === undefined ? undefined : p === '*' ? Number.parseInt(rest[at++] ?? '0', 10) || 0 : Number(p || 0);
        const arg = rest[at++] ?? '';
        let text = arg;
        if (conv === 'b') { const r = escapes(arg, 'b'); text = r.text; if (r.stopped) stop = true; }
        else if (conv === 'c') text = arg.slice(0, 1);
        else if ('diu'.includes(conv)) text = String(Number.parseInt(arg, 10) || 0);
        if (prec !== undefined && 'sb'.includes(conv)) text = text.slice(0, prec);
        if (Math.abs(width) > MAX_WIDTH) throw fail('printf width too large');
        if (Math.abs(width) > text.length) text = flags.includes('-') || width < 0 ? text.padEnd(Math.abs(width)) : text.padStart(width);
        out.push(copy(text));
        if (stop) break;
      }
      if (stop) break;
      const tail = escapes(fmt.slice(from), 'fmt');
      out.push(copy(tail.text));
      if (tail.stopped || !used || at >= rest.length) break;
    }
    return join(out);
  }
  function run(text, level = 0, stdin = '', procLevel = 0) {
    // `$(…)` and shells nest as the guard counts them (its TOO_DEEP). Process substitutions count on their own,
    // deeper (#532 review 10): each level parses its text again, so 1,500 of them overflowed the stack (review 2).
    if (level > 3) throw fail('output nesting limit exceeded', 'YAD_GUARD_TOO_DEEP');
    if (procLevel > PROC_LEVELS) throw fail('process substitutions nested too deep', 'YAD_GUARD_TOO_MANY_PROCSUBS');
    const fileSub = /^\s*<\s*([^\s;&|<>()$`'"\\]+)\s*$/.exec(text);
    if (fileSub) return read(fileSub[1]);
    if (/^[A-Za-z0-9_]*$/.test(text) && !/^(echo|printf|print|cat|tee|eval|bash|zsh|sh|dash|ksh)$/.test(text)) return '';
    const parts = api.shellParts(text, mode);
    if (parts.tooComplex) throw fail('output parse budget exceeded');
    const stdout = [];
    const indexed = (xs, at) => { const m = new Map(); for (const x of xs) { const k = at(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
    const bodies = indexed(parts.bodies, (x) => x.part);
    const heres = indexed(parts.herestrings, (x) => x.part);
    const procs = indexed(parts.procsubs, (x) => x.from - 1);
    const pipedWrites = indexed(parts.pipedWrites, (x) => x.after);
    let before = '';
    // Groups by the part they close at: `{ … }` and `( … )` from the reader, and the compound commands
    // (`if … fi`, `for … done`, `case … esac`) found here, so the reader's own records stay as they are.
    const groups = new Map();
    const addGroup = (g) => { if (!groups.has(g.to)) groups.set(g.to, []); groups.get(g.to).push(g); };
    for (const g of parts.groups) addGroup(g);
    // A closer closes only its own opener: inside a `case`, a pattern spelled `done` or `fi` closes nothing
    // (#532 review 2), and a mismatched one is left alone rather than pairing with the wrong opener.
    const opened = [];
    for (let n = 0; n < parts.length; n++) {
      const w = headOf(parts[n]);
      if (OPENERS.has(w)) opened.push({ n, end: OPENERS.get(w) });
      else if (CLOSERS.has(w) && w !== '}' && opened.at(-1)?.end === w) addGroup({ from: opened.pop().n, to: n, writes: [], closer: true });
    }
    const close = (n) => {
      for (const g of groups.get(n) ?? []) {
        // What reaches the group's own output: not what its parts wrote to files (#532 review 9).
        const output = join(stdout.slice(g.from, g.to).filter((s) => s !== undefined));
        before = output;
        for (let i = g.from; i < g.to; i++) stdout[i] = '';
        // A group that ends in a part of its own (`}`, `fi`, `done`, `esac`): that part prints and writes it.
        if (g.brace || g.closer) continue;
        if (g.writes.length) for (const wr of g.writes) write(wr, output);
        else stdout[g.to - 1] = output;
      }
    };
    for (let n = 0; n < parts.length; n++) {
      charge(1); close(n);
      let words = [];
      for (let i = 0; i < parts[n].length; i++) {
        const entry = parts.subst[n]?.get(i);
        // The word as the shell spells it: in double quotes bash and zsh keep a backslash before an ordinary
        // character (`tr -d "\n"`, `echo "\x67h …"`), which the reader keeps as the word's posix spelling.
        if (!entry) { words.push(parts.posix[n]?.get(i) ?? parts[n][i]); continue; }
        const pieces = []; let from = 0;
        for (const sub of entry.subs) {
          pieces.push(entry.word.slice(from, sub.at), run(sub.text, level + 1, '', procLevel).replace(/\n+$/, ''));
          from = sub.at + sub.len;
        }
        pieces.push(entry.word.slice(from));
        const value = join(pieces);
        if (entry.subs.every((s) => s.quoted)) words.push(value);
        else for (const w of value.split(/[ \t\n]+/)) if (w) words.push(w);
      }
      words = api.stripPrefix(words);
      const prog = api.programOf(words[0] ?? '');
      const input = parts.piped.has(n) ? before : stdin;
      if (parts.piped.has(n) && n > 0) stdout[n - 1] = '';
      const fed = join([...((bodies.get(n) ?? []).map((b) => b.text)),
        ...((heres.get(n) ?? []).map((b) => b.text + '\n'))]);
      const redirected = join((parts.reads[n] ?? []).map(read));
      const stdinText = () => input || fed || redirected;
      let out = '';
      const proc = procs.get(n) ?? [];
      const procOutputs = proc.map((p) => run(p.text ?? '', level, '', procLevel + 1));
      // A closing part prints its group's output; one that closes none (a `case` pattern) prints nothing.
      if (CLOSERS.has(parts[n][0])) out = (groups.get(n) ?? []).some((g) => g.brace || g.closer) ? before : '';
      else if (prog === 'echo') {
        // zsh's `echo` always makes escapes, and its `-` ends the options; bash's makes them with -e.
        let k = 1, newline = true, decode = zsh;
        while (k < words.length) {
          if (zsh && words[k] === '-') { k++; break; }
          if (!/^-[neE]+$/.test(words[k])) break;
          for (const c of words[k].slice(1)) { if (c === 'n') newline = false; else decode = c === 'e'; }
          k++;
        }
        const t = words.slice(k).join(' '), r = decode ? escapes(t, 'echo') : { text: t, stopped: false };
        out = join([r.text, newline && !r.stopped ? '\n' : '']);
      } else if (prog === 'print') {
        // zsh's `print`: escapes as a format makes them, unless -r or -R; -l and -N part the words; -f formats.
        let k = 1, newline = true, decode = true, sep = ' ', end = '\n', fmt = null, silent = false;
        while (k < words.length) {
          const w = words[k];
          if (w === '-' || w === '--') { k++; break; }
          if (!/^-[A-Za-z]/.test(w)) break;
          k++;
          for (const c of w.slice(1)) {
            if (c === 'n') newline = false;
            else if (c === 'r' || c === 'R') decode = false;
            else if (c === 'e') decode = true;
            else if (c === 'l') sep = '\n';
            else if (c === 'N') { sep = '\0'; end = '\0'; }
            else if ('sSz'.includes(c)) silent = true;
            else if ('fvuCxX'.includes(c)) {
              // An option that takes a value takes the rest of the word (`-u1`, `-f'%s '`), or else the next word.
              const rest = w.slice(w.indexOf(c) + 1);
              const value = rest || (words[k++] ?? '');
              if (c === 'f') fmt = value;
              else if (c === 'v' || (c === 'u' && value !== '1')) silent = true;
              break;
            }
          }
        }
        if (silent) out = '';
        else if (fmt !== null) out = formatted([fmt, ...words.slice(k)]);
        else {
          const t = words.slice(k).join(sep), r = decode ? escapes(t, 'fmt', true) : { text: t, stopped: false };
          out = join([r.text, newline && !r.stopped ? end : '']);
        }
      } else if (prog === 'printf') {
        const args = words.slice(1);
        if (args[0] === '--') args.shift();
        // bash's `printf -v name` sets a variable and prints nothing.
        out = args[0] === '-v' ? '' : formatted(args);
      } else if (prog === 'cat') {
        const args = words.slice(1).filter((w) => !w.startsWith('-') || w === '-');
        const operands = args.map((a) => a === '-' ? stdinText() : read(a));
        for (let i = 0; i < proc.length; i++) operands.splice(Math.max(0, proc[i].position - 1), 0, procOutputs[i]);
        out = join(operands.length ? operands : [stdinText()]);
      } else if (prog === 'tee') out = copy(stdinText());
      else if (prog === 'tr') {
        const opts = [];
        let k = 1;
        while (/^-[A-Za-z]+$/.test(words[k] ?? '')) opts.push(...words[k++].slice(1));
        const s1 = trSet(words[k]), s2 = trSet(words[k + 1]);
        const src = stdinText();
        if (s1 && !opts.includes('c') && !opts.includes('C')) {
          if (opts.includes('d')) { const del = new Set(s1); out = copy([...src].filter((ch) => !del.has(ch)).join('')); }
          else if (s2?.length) {
            const map = new Map();
            s1.forEach((ch, i) => map.set(ch, s2[Math.min(i, s2.length - 1)]));
            out = copy([...src].map((ch) => map.get(ch) ?? ch).join(''));
          }
        }
      } else if (prog === 'head') {
        let count = null;
        const a = words.slice(1);
        for (let j = 0; j < a.length; j++) {
          const m = /^-c(\d*)$/.exec(a[j]) ?? /^--bytes=(\d+)$/.exec(a[j]);
          if (m) count = m[1] || a[++j];
          else if (a[j] === '--bytes') count = a[++j];
        }
        const c = Number(count);
        if (count !== null && Number.isSafeInteger(c) && c >= 0) out = copy(Buffer.from(stdinText()).subarray(0, c).toString());
      } else {
        const script = api.scriptAt(words);
        const body = api.innerLines(words);
        // A file a shell runs is run text by text (see textsOf).
        if (api.bareShell(words)) {
          if (!input && !fed && parts.reads[n]?.length) for (const r of parts.reads[n]) body.push(...textsOf(r));
          else body.push(stdinText());
        }
        if (script >= 0) body.push(...textsOf(words[script]));
        if (words[0]?.includes('/')) body.push(...textsOf(words[0]));
        // A process substitution the command's shell runs (#532 review 6): its stdin when it has no script
        // (`bash < <(…)`, not `bash x < <(…)`), or its script, the first word after the shell's options
        // (`bash <(…)`, `source <(…)`, zsh's `zsh =(…)`), never with -c or -s. Only the command word counts as the
        // shell: `ls . <(…)` and `grep sh <(…)` run nothing (review 2).
        const cmdAt = SHELL_PROG.test(prog) ? parts[n].indexOf(words[0]) : -1;
        const opts = (ws) => ws.every((w) => w.startsWith('-') && w !== '-c' && w !== '-s');
        for (let i = 0; cmdAt >= 0 && i < proc.length; i++) {
          const p = proc[i];
          const runs = p.viaStdin ? opts(words.slice(1)) : p.position > cmdAt && opts(parts[n].slice(cmdAt + 1, p.position));
          if (runs) body.push(procOutputs[i]);
        }
        for (const t of body) { check(t); out = join([out, run(t, level + 1, '', procLevel)]); }
      }
      // Judge substituted commands too, but quote words so data arguments stay data.
      if (parts.subst[n]) check(words.map((w) => "'" + w.replace(/'/g, "'\\''") + "'").join(' '));
      const after = proc.flatMap((p) => p.after ?? []);
      for (const wr of [...(parts.writes[n] ?? []), ...after]) write(wr, out);
      for (const p of pipedWrites.get(n) ?? []) for (const wr of p.writes) write(wr, out);
      if (prog === 'tee') for (const a of words.slice(1)) if (!a.startsWith('-')) write({ target: a, append: words.includes('-a') || words.includes('--append') }, out);
      stdout[n] = parts.writes[n]?.length || after.length ? '' : out; before = out;
      if (proc.length) n = Math.max(...proc.map((p) => p.to)) - 1;
    }
    close(parts.length);
    return join(stdout.filter((s) => s !== undefined));
  }
  run(line);
  return verdict;
}
