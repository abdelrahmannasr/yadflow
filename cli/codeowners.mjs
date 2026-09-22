// CODEOWNERS as a HINT (E68). Part 3: "CODEOWNERS is a hint, never an authority — in practice these files
// rot." So nothing here decides anything: it never holds a gate, never counts toward an approval, never
// requests a reviewer. `yad open-pr` prints what the file on the BASE branch lists for the files a change
// touches, on its own line, beside (never merged with) the people git history names.
//
// THE RULES ARE THE PLATFORMS' OWN, taken from their docs (checked 2026-09-22), never from memory:
//
//   GitHub (docs.github.com, "About code owners"):
//     - the first of `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`; a file of 3 MB or more is not loaded;
//     - gitignore patterns, EXCEPT that `\` escaping, `!` negation and `[ ]` ranges do not work;
//     - the LAST matching line decides, and a line with no owners leaves the path with none;
//     - owners are `@user`, `@org/team` or an e-mail address; `#` starts a comment, also after a pattern;
//     - "If any line … contains invalid syntax, that line will be skipped."
//   GitLab (docs.gitlab.com, "Code Owners" and "Syntax of CODEOWNERS file"):
//     - the first of `CODEOWNERS`, `docs/CODEOWNERS`, `.gitlab/CODEOWNERS`;
//     - a path WITHOUT a leading `/` matches at any depth, even with a `/` inside (`internal/README.md`
//       matches `/docs/internal/README.md`) — unlike gitignore, which anchors such a path at the root;
//     - `[Section]`, `^[Optional]`, `[Section][2]`, and default owners after the heading; names are
//       case-insensitive and duplicates combine (required if any copy is); a heading it cannot parse is
//       read as an entry; the unnamed section holds everything before the first heading;
//     - within a section the last matching entry decides; every section answers for itself;
//     - `!path` excludes within its section, and a later entry cannot include it again;
//     - owners are `@user`, `@group`, `@group/subgroup`, `@@role` or an e-mail address; a malformed owner
//       is ignored; "Inline comments are unsupported. Any Code Owners listed in a comment are parsed";
//     - a space in a path is written `\ `.
//
// WHAT IS NOT GUESSED. A pattern that uses a form its platform's docs do not describe (`?` or `**` on
// GitLab outside `/**/`, any `\` on GitHub, `[`) is not matched, and the line is reported as not read — a
// wrong match would print the wrong person, which is the whole class of bug E67 paid for eight times.
// One reading is ours, from both platforms' examples: a pattern whose LAST segment holds no wildcard also
// covers everything under a directory of that name (`apps/`, `**/logs`, GitLab's `docs`), while one whose
// last segment has a wildcard matches files only (`docs/*` never reaches `docs/build-app/x.md`).
//
// NO E-MAIL ADDRESS IS EVER PRINTED (E67's rule): an address owner is kept as "an e-mail address".

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitEnv } from './riskmap-command.mjs';

export const CODEOWNERS_PATHS = {
  github: ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'],
  gitlab: ['CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'],
};
// GitHub: "CODEOWNERS files must be under 3 MB in size." Read as 3 000 000 bytes: the smaller reading, so
// a file GitHub may not load is never quietly used here.
export const GITHUB_MAX_BYTES = 3_000_000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One owner word → { kind, text }, or null when it is not an owner on this platform.
export function ownerOf(word, platform) {
  // `key` tells two addresses apart for counting; it stays inside this module and is never printed.
  if (EMAIL.test(word)) return { kind: 'email', text: 'an e-mail address', key: word.toLowerCase() };
  if (platform === 'gitlab') {
    if (/^@@[A-Za-z]+$/.test(word)) return { kind: 'role', text: word };
    if (/^@[^\s@/]+(\/[^\s@/]+)+$/.test(word)) return { kind: 'group', text: word };
    if (/^@[^\s@/]+$/.test(word)) return { kind: 'name', text: word };
    return null;
  }
  if (/^@[^\s@/]+\/[^\s@/]+$/.test(word)) return { kind: 'team', text: word };
  if (/^@[^\s@/]+$/.test(word)) return { kind: 'user', text: word };
  return null;
}

// Split a GitLab line on spaces and tabs, where `\ ` is a space inside a word. Any other `\` is a form the
// docs do not describe: { bad } says so.
function gitlabWords(line) {
  const words = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      if (line[i + 1] === ' ') { cur += ' '; i++; continue; }
      return { bad: 'a `\\` that is not `\\ ` (GitLab\'s docs describe only an escaped space)' };
    }
    if (ch === ' ' || ch === '\t') { if (cur) words.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return { words };
}

// A word from the file, quoted for a `not read` reason — unless it holds an `@` after its first character:
// a pattern can be a mistyped address (`alice@corp.com docs/`), and no address is ever printed.
const quoted = (w) => (w.indexOf('@', 1) >= 0 ? 'an address-like word' : `\`${w}\``);

const escRe = (s) => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');

// A pattern → { re, dirs } or { bad: why }. `re` is tested against a file path and, when `dirs`, against
// each directory above it (see WHAT IS NOT GUESSED).
export function patternOf(raw, platform) {
  if (raw.includes('[')) return { bad: `${quoted(raw)} uses \`[\`, which ${platform === 'gitlab' ? 'GitLab\'s docs do not describe' : 'GitHub does not support'}` };
  if (platform !== 'gitlab' && raw.includes('\\')) return { bad: `${quoted(raw)} uses \`\\\`, which GitHub does not support in CODEOWNERS` };
  if (platform === 'gitlab' && raw.includes('?')) return { bad: `${quoted(raw)} uses \`?\`, which GitLab's docs do not describe` };
  let p = raw;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.replace(/\/+$/, '');
  const rooted = p.startsWith('/');
  if (rooted) p = p.replace(/^\/+/, '');
  if (!p) return { re: /^/, dirs: true, all: true };
  const segs = p.split('/');
  // GitHub follows gitignore: a `/` at the start or in the middle anchors the pattern at the root.
  // GitLab anchors only on a leading `/`.
  const anchored = rooted || (platform !== 'gitlab' && segs.length > 1);
  let body = '';
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    if (seg === '**') {
      if (!last) { body += '(?:.*/)?'; continue; }
      if (platform === 'gitlab') return { bad: `${quoted(raw)} ends in \`/**\`, which GitLab's docs do not describe (they say to end a directory with \`/\`)` };
      if (i === 0) { body += '.*'; continue; }
      body = body.replace(/\/$/, '') + '/.+';
      continue;
    }
    if (seg.includes('**') && platform === 'gitlab') return { bad: `${quoted(raw)} uses \`**\` inside a name, which GitLab's docs do not describe` };
    body += seg.split('').map((ch) => (ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : escRe(ch))).join('').replace(/(\[\^\/\]\*)+/g, '[^/]*');
    if (!last) body += '/';
  }
  const lastSeg = segs[segs.length - 1];
  return { re: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}$`), dirs: dirOnly || !/[*?]/.test(lastSeg), fileToo: !dirOnly };
}

export function matches(pat, file) {
  if (pat.all) return true;
  if (pat.fileToo && pat.re.test(file)) return true;
  if (!pat.dirs) return false;
  const segs = file.split('/');
  for (let i = 1; i < segs.length; i++) if (pat.re.test(segs.slice(0, i).join('/'))) return true;
  return false;
}

// The file's text → { rules, skipped }. A rule is { line, section, negate, pattern, pat, owners }; `pattern`
// is the path as written (without a GitLab `!`), `section` the lower-cased name ('' for the unnamed one)
// and `optional` a per-section fact kept in `sections`. `skipped` is every line this reader did not use,
// with why — printed, never dropped quietly.
export function parseCodeowners(text, platform) {
  const rules = [];
  const skipped = [];
  const sections = new Map([['', { optional: false }]]);
  let section = '';
  let defaults = [];
  const lines = String(text).replace(/^\uFEFF/, '').split('\n');
  lines.forEach((rawLine, i) => {
    const line = rawLine.replace(/\r$/, '');
    const n = i + 1;
    if (!line.trim() || /^[ \t]*#/.test(line)) return;
    if (platform === 'gitlab') {
      const h = line.match(/^(\^)?\[([^\]]+)\](?:\[(\d+)\])?(?:[ \t]+(.*))?$/);
      if (h && h[2].trim()) {
        section = h[2].trim().toLowerCase();
        const prev = sections.get(section);
        // "If a section is duplicated … and one of them is marked as optional and the other isn't, the
        // section is required."
        sections.set(section, { optional: prev ? prev.optional && !!h[1] : !!h[1] });
        const w = gitlabWords(h[4] || '');
        // Default owners this reader cannot split are reported, never read as "no defaults".
        if (w.bad) skipped.push({ line: n, why: w.bad });
        defaults = (w.words || []).map((x) => ownerOf(x, platform)).filter(Boolean);
        return;
      }
      const w = gitlabWords(line.replace(/^[ \t]+/, ''));
      if (w.bad) { skipped.push({ line: n, why: w.bad }); return; }
      let [pattern, ...rest] = w.words;
      const negate = pattern.startsWith('!');
      if (negate) pattern = pattern.slice(1);
      const pat = patternOf(pattern, platform);
      if (pat.bad) { skipped.push({ line: n, why: pat.bad }); return; }
      // GitLab ignores a malformed owner and keeps the rest. The section's defaults apply only to an entry
      // that WRITES no owner at all: one whose words are all unreadable (`docs/ bob`, `docs/ # note`) has
      // no owner, never the defaults — printing a default owner there would name the wrong person. It is
      // also reported, so the answer is hedged.
      const own = rest.map((x) => ownerOf(x, platform)).filter(Boolean);
      // An exclusion takes no owners, so words after it are nothing to report.
      if (!negate && rest.length && !own.length) {
        skipped.push({ line: n, why: `${quoted(pattern)} is read as having no owner: none of its owner words is one this reader can read${defaults.length ? ', and the section\'s default owners do not apply to it' : ''}` });
      }
      rules.push({ line: n, section, negate, pattern, pat, owners: rest.length ? own : defaults });
      return;
    }
    const words = line.trim().split(/[ \t]+/);
    const cut = words.findIndex((x, j) => j > 0 && x.startsWith('#'));
    const [pattern, ...rest] = cut < 0 ? words : words.slice(0, cut);
    if (pattern.startsWith('!')) { skipped.push({ line: n, why: `${quoted(pattern)} is a \`!\` pattern, which GitHub does not support` }); return; }
    const pat = patternOf(pattern, platform);
    if (pat.bad) { skipped.push({ line: n, why: pat.bad }); return; }
    const owners = rest.map((x) => ownerOf(x, platform));
    const badAt = owners.indexOf(null);
    if (badAt >= 0) {
      // A word with an `@` anywhere after its first character may be a mistyped address (`bob@corp`,
      // `@alice@corp.com`), so it is never printed as written (`quoted`).
      skipped.push({ line: n, why: `${quoted(rest[badAt])} is not an owner (@user, @org/team or an e-mail address)` });
      return;
    }
    rules.push({ line: n, section: '', negate: false, pattern, pat, owners });
  });
  return { rules, skipped, sections };
}

// The owners of the files a change touches. Per file: GitHub takes the last matching line; GitLab takes,
// in every section, the last matching entry unless an exclusion in that section matches. Returns
// { owners: [{ kind, text, files, optional }], matched, unmatched } — `files` is how many touched files
// list that owner, `optional` true when every such listing is in a GitLab `^[optional]` section, and
// `unmatched` how many touched files no line gives an owner.
export function ownersFor(parsed, files) {
  const by = new Map();
  let matched = 0;
  for (const f of files) {
    const got = [];
    for (const [name, meta] of parsed.sections) {
      const inSec = parsed.rules.filter((r) => r.section === name);
      if (inSec.some((r) => r.negate && matches(r.pat, f))) continue;
      let last = null;
      for (const r of inSec) if (!r.negate && matches(r.pat, f)) last = r;
      if (last) for (const o of last.owners) got.push({ ...o, optional: meta.optional });
    }
    if (got.length) matched++;
    const seen = new Set();
    for (const o of got) {
      const k = `${o.kind}\0${o.key || o.text}`;
      const row = by.get(k) || { kind: o.kind, text: o.text, files: 0, optional: true };
      if (!seen.has(k)) row.files++;
      seen.add(k);
      row.optional = row.optional && o.optional;
      by.set(k, row);
    }
  }
  // Every e-mail address prints the same words, so they are one row.
  const rows = [...by.values()];
  const mails = rows.filter((o) => o.kind === 'email');
  const out = rows.filter((o) => o.kind !== 'email');
  if (mails.length) out.push({ kind: 'email', text: mails.length > 1 ? `${mails.length} e-mail addresses` : 'an e-mail address', files: Math.max(...mails.map((m) => m.files)), optional: mails.every((m) => m.optional) });
  return { owners: out.sort((a, b) => b.files - a.files), matched, unmatched: files.length - matched };
}

// The CODEOWNERS file on `baseRef` — the base, like the risk map, so a change cannot rewrite the hint it
// is shown. { path, text } for the first location the platform reads, { none } when there is none, or
// { unknown: why } — git failing is never "none". Only a regular file is read (a symlink's `git show` is
// its target's name).
export function baseCodeowners(repoRoot, baseRef, platform) {
  // gitEnv: a pathspec variable in the caller's environment makes `ls-tree -- <path>` fail outright.
  const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30, env: gitEnv() });
  const paths = CODEOWNERS_PATHS[platform];
  if (!paths) return { unknown: `no CODEOWNERS locations are known for platform '${platform}'` };
  for (const p of paths) {
    const ls = git(['ls-tree', '--full-tree', baseRef, '--', p]);
    if (ls.status !== 0) return { unknown: `git could not read '${baseRef}'` };
    if (!ls.stdout) continue;
    if (!/^100(644|755) blob /.test(ls.stdout)) return { unknown: `${p} on ${baseRef} is not a regular file` };
    const show = spawnSync('git', ['show', `${baseRef}:${p}`], { cwd: repoRoot, maxBuffer: 1 << 30 });
    if (show.status !== 0) return { unknown: `git could not read ${p} on ${baseRef}` };
    if (platform === 'github' && show.stdout.length >= GITHUB_MAX_BYTES) {
      return { unknown: `${p} on ${baseRef} is 3 MB or more, and GitHub does not load a file that large` };
    }
    return { path: p, text: show.stdout.toString('utf8') };
  }
  return { none: `no CODEOWNERS on ${baseRef} (${paths.join(', ')})` };
}

// E69 — the lines that match no file: a fact about the file list, never a guess about a person. A GitLab
// `!` line that excludes nothing is one too. `files` is every file the repo holds; `submodules` the paths
// of its submodules, whose contents are not in that list — so a line that could reach into one is never
// called dead (the probe name is a NUL, which no pattern this reader accepts can spell but `*` matches).
// Returns [{ line, pattern, negate }] in file order.
export function deadLines(parsed, files, { submodules = [] } = {}) {
  const names = [...files, ...submodules.map((g) => `${g}/\u0000`)];
  // `matches` asks about a file and every folder above it. Here each folder is asked about ONCE, and a
  // plain path (no wildcard) is a set lookup, not a scan — a dead line costs a scan of every name, and the
  // E69 review measured 300 000 files × 1 000 dead lines at minutes before this.
  const dirs = new Set();
  for (const f of names) for (let i = f.indexOf('/'); i >= 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i));
  const nameSet = new Set(names);
  const base = (x) => x.slice(x.lastIndexOf('/') + 1);
  const nameBase = new Set(names.map(base));
  const dirBase = new Set([...dirs].map(base));
  const dirList = [...dirs];
  const live = (pat) => {
    if (pat.all) return names.length > 0;
    // `patternOf` writes `^`, then `(?:.*\/)?` for "at any depth" (once per leading `**/`), then the rest,
    // then `$`. When the rest is plain text, the answer is a set lookup; when it is "at any depth" and the
    // rest cannot cross a `/` (plain text, escapes other than `\/`, and `[^/]` classes), only a name's
    // LAST part can match, so the distinct last parts are tested instead of every path.
    const m = pat.re.source.match(/^\^((?:\(\?:\.\*\\\/\)\?)*)(.*)\$$/);
    if (m) {
      const [, anyDepth, rest] = m;
      if (/^(?:[^\\.*+?()[\]{}|^$]|\\.)*$/.test(rest)) {
        const text = rest.replace(/\\(.)/g, '$1');
        if (!anyDepth) return (pat.fileToo && nameSet.has(text)) || (pat.dirs && dirs.has(text));
        if (!text.includes('/')) return (pat.fileToo && nameBase.has(text)) || (pat.dirs && dirBase.has(text));
      } else if (anyDepth && /^(?:\[\^\/\][*]?|[^\\.*+?()[\]{}|^$]|\\[^/])*$/.test(rest)) {
        const last = new RegExp(`^${rest}$`);
        return (pat.fileToo && [...nameBase].some((b) => last.test(b))) || (pat.dirs && [...dirBase].some((b) => last.test(b)));
      }
    }
    return (pat.fileToo && names.some((f) => pat.re.test(f))) || (pat.dirs && dirList.some((d) => pat.re.test(d)));
  };
  return parsed.rules.filter((r) => !live(r.pat)).map((r) => ({ line: r.line, pattern: r.pattern, negate: r.negate }));
}

// E69 — the CODEOWNERS file on DISK (the working tree, like `yad risk-map check`), as its platform would
// pick it: the first of its locations that exists. Returns { path, text, ignored } — `ignored` the other
// locations that hold a file the platform never reads — or { path, tooBig, ignored } for a GitHub file of
// 3 MB or more, { none } when there is none, or { unknown: why }. A first location that is not a regular
// file is `unknown`: the platform reads the blob git stores, and a symlink's blob is its target's name.
// Does `rel` exist under `root` with exactly this spelling? A macOS or Windows disk ignores case, so a
// plain stat finds `.github/codeowners` for `.github/CODEOWNERS` — but git, and so the platform, stores the
// name as written (E69 review, round 1). Each part is looked for in its folder's listing. Throws what
// reading a folder throws.
function exactName(root, rel) {
  let dir = root;
  for (const part of rel.split('/')) {
    if (!fs.readdirSync(dir).includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}

export function diskCodeowners(repoRoot, platform) {
  const paths = CODEOWNERS_PATHS[platform];
  if (!paths) return { unknown: `no CODEOWNERS locations are known for platform '${platform}'` };
  const found = [];
  for (const p of paths) {
    try {
      if (!exactName(repoRoot, p)) continue;
      found.push({ p, st: fs.lstatSync(path.join(repoRoot, p)) });
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') continue;
      return { unknown: `${p} could not be read (${e.code})` };
    }
  }
  if (!found.length) return { none: `no CODEOWNERS (${paths.join(', ')})` };
  const [first, ...rest] = found;
  if (!first.st.isFile()) return { unknown: `${first.p} is not a regular file` };
  const ignored = rest.filter((x) => !x.st.isDirectory()).map((x) => x.p);
  if (platform === 'github' && first.st.size >= GITHUB_MAX_BYTES) return { path: first.p, tooBig: true, ignored };
  try {
    return { path: first.p, text: fs.readFileSync(path.join(repoRoot, first.p), 'utf8'), ignored };
  } catch (e) {
    return { unknown: `${first.p} could not be read (${e.code})` };
  }
}
