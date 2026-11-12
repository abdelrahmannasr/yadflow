// Additive output reading (#532). No entries are inserted into the guard's positional
// reading lists: this pass follows bytes, including the absence of a newline.
import path from 'node:path';

export function streamGuard(line, mode, api) {
  const files = new Map();
  let verdict = { allow: true };
  const charge = api.charge;
  const copy = (s) => { charge(s.length + 1); return s; };
  const join = (xs) => { for (const x of xs) charge(x.length + 1); return xs.join(''); };
  const key = (s) => path.posix.normalize(s);
  const read = (s) => join(files.get(key(s)) ?? []);
  const write = (wr, text) => {
    const k = key(wr.target);
    if (wr.append && files.has(k)) files.get(k).push(copy(text));
    else files.set(k, [copy(text)]);
  };
  const check = (s) => { if (s && verdict.allow) verdict = api.judge(s); };

  function escapes(s, percentB = false) {
    let stopped = false;
    const text = s.replace(/\\(x[\da-fA-F]{1,2}|0[0-7]{0,3}|[1-7][0-7]{0,2}|.)/gs, (raw, c) => {
      if (stopped) return '';
      if (c === 'c' && percentB) { stopped = true; return ''; }
      if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
      if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8) & 255);
      return ({ n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\' })[c] ?? raw;
    });
    // \c discards the rest, including ordinary characters after it.
    const at = percentB ? s.indexOf('\\c') : -1;
    return at < 0 ? { text, stopped } : { text: escapes(s.slice(0, at)).text, stopped: true };
  }
  // printf's output builder below keeps literal/argument pieces separate.
  function formatted(words) {
    const f = words[1] === '--' ? 2 : 1;
    const fmt = words[f] ?? '', args = words.slice(f + 1);
    let at = 0, stopped = false;
    const out = [];
    do {
      let from = 0, used = false;
      for (const m of fmt.matchAll(/%%|%([sb])/g)) {
        out.push(copy(escapes(fmt.slice(from, m.index)).text));
        if (m[0] === '%%') out.push('%');
        else {
          used = true;
          const arg = args[at++] ?? '';
          const r = m[1] === 'b' ? escapes(arg, true) : { text: arg };
          out.push(copy(r.text));
          if (r.stopped) { stopped = true; break; }
        }
        from = m.index + m[0].length;
      }
      if (stopped) break;
      out.push(copy(escapes(fmt.slice(from)).text));
      if (!used) break;
    } while (at < args.length);
    return join(out);
  }
  function run(text, level = 0, stdin = '') {
    if (level > 3) throw Object.assign(new Error('output nesting limit exceeded'), { code: 'YAD_GUARD_OUTPUT_LIMIT' });
    const fileSub = /^\s*<\s*([^\s;&|<>()$`'"\\]+)\s*$/.exec(text);
    if (fileSub) return read(fileSub[1]);
    if (/^[A-Za-z0-9_]*$/.test(text) && !/^(echo|printf|print|cat|tee|eval|bash|zsh|sh|dash|ksh)$/.test(text)) return '';
    const parts = api.shellParts(text, mode);
    if (parts.tooComplex) throw Object.assign(new Error('output parse budget exceeded'), { code: 'YAD_GUARD_OUTPUT_LIMIT' });
    const outputs = [], stdout = [];
    const indexed = (xs, at) => { const m = new Map(); for (const x of xs) { const k = at(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
    const bodies = indexed(parts.bodies, (x) => x.part);
    const heres = indexed(parts.herestrings, (x) => x.part);
    const procs = indexed(parts.procsubs, (x) => x.from - 1);
    const pipedWrites = indexed(parts.pipedWrites, (x) => x.after);
    let before = '';
    const groups = new Map();
    for (const g of parts.groups) { if (!groups.has(g.to)) groups.set(g.to, []); groups.get(g.to).push(g); }
    const close = (n) => {
      for (const g of groups.get(n) ?? []) {
        const output = join(outputs.slice(g.from, g.to).filter((s) => s !== undefined));
        before = output;
        for (let i = g.from; i < g.to; i++) stdout[i] = '';
        if (!g.writes.length && parts[g.to]?.[0] !== '}') stdout[g.to - 1] = output;
        for (const wr of g.writes) write(wr, output);
      }
    };
    for (let n = 0; n < parts.length; n++) {
      charge(1); close(n);
      let words = [];
      for (let i = 0; i < parts[n].length; i++) {
        const entry = parts.subst[n]?.get(i);
        if (!entry) { words.push(parts[n][i]); continue; }
        const pieces = []; let from = 0;
        for (const sub of entry.subs) {
          pieces.push(entry.word.slice(from, sub.at), run(sub.text, level + 1).replace(/\n+$/, ''));
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
      if (parts.piped.has(n) && n > 0) { outputs[n - 1] = ''; stdout[n - 1] = ''; }
      const fed = join([...((bodies.get(n) ?? []).map((b) => b.text)),
        ...((heres.get(n) ?? []).map((b) => b.text + '\n'))]);
      const redirected = join((parts.reads[n] ?? []).map(read));
      let out = '';
      const proc = procs.get(n) ?? [];
      const procOutputs = proc.map((p) => run(p.text ?? '', level + 1));
      if (parts[n][0] === '}') out = before;
      else if (prog === 'echo' || prog === 'print') {
        let k = 1, newline = true, decode = prog === 'print' || mode.redir === 'zsh';
        while (/^-[neE]+$/.test(words[k] ?? '')) { if (words[k].includes('n')) newline = false; if (words[k].includes('e')) decode = true; if (words[k].includes('E')) decode = false; k++; }
        const t = words.slice(k).join(' '), r = decode ? escapes(t, true) : { text: t };
        out = join([r.text, newline && !r.stopped ? '\n' : '']);
      } else if (prog === 'printf') out = formatted(words);
      else if (prog === 'cat') {
        const args = words.slice(1).filter((w) => !w.startsWith('-') || w === '-');
        const operands = args.map((a) => a === '-' ? input || fed || redirected : read(a));
        for (let i = 0; i < proc.length; i++) operands.splice(Math.max(0, proc[i].position - 1), 0, procOutputs[i]);
        out = join(operands.length ? operands : [input || fed || redirected]);
      } else if (prog === 'tee') out = copy(input || fed || redirected);
      else if (prog === 'tr' && words[1] === '-d' && ['\\n', '\n', '\\012'].includes(words[2])) out = copy((input || fed || redirected).replace(/\n/g, ''));
      else if (prog === 'head' && /^-c(?:\d+)?$/.test(words[1] ?? '')) {
        const count = Number(words[1].slice(2) || words[2]);
        if (Number.isSafeInteger(count) && count >= 0) out = copy(Buffer.from(input || fed || redirected).subarray(0, count).toString());
      } else {
        const script = api.scriptAt(words);
        const body = api.innerLines(words);
        if (api.bareShell(words)) body.push(input || fed || redirected);
        if (script >= 0) body.push(read(words[script]));
        if (words[0]?.includes('/')) body.push(read(words[0]));
        for (const t of body) { check(t); out = join([out, run(t, level + 1)]); }
      }
      // Judge substituted commands too, but quote words so data arguments stay data.
      if (parts.subst[n]) check(words.map((w) => "'" + w.replace(/'/g, "'\\''") + "'").join(' '));
      for (const wr of parts.writes[n] ?? []) write(wr, out);
      for (const p of pipedWrites.get(n) ?? []) for (const wr of p.writes) write(wr, out);
      if (prog === 'tee') for (const a of words.slice(1)) if (!a.startsWith('-')) write({ target: a, append: words.includes('-a') || words.includes('--append') }, out);
      outputs[n] = out;
      stdout[n] = parts.writes[n]?.length ? '' : out; before = out;
      if (proc.length) n = Math.max(...proc.map((p) => p.to)) - 1;
    }
    close(parts.length);
    return join(stdout.filter((s) => s !== undefined));
  }
  run(line);
  return verdict;
}
