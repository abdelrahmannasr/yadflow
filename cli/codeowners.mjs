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

const escRe = (s) => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');

// A pattern → { re, dirs } or { bad: why }. `re` is tested against a file path and, when `dirs`, against
// each directory above it (see WHAT IS NOT GUESSED).
export function patternOf(raw, platform) {
  if (raw.includes('[')) return { bad: `\`${raw}\` uses \`[\`, which ${platform === 'gitlab' ? 'GitLab\'s docs do not describe' : 'GitHub does not support'}` };
  if (platform !== 'gitlab' && raw.includes('\\')) return { bad: `\`${raw}\` uses \`\\\`, which GitHub does not support in CODEOWNERS` };
  if (platform === 'gitlab' && raw.includes('?')) return { bad: `\`${raw}\` uses \`?\`, which GitLab's docs do not describe` };
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
      if (platform === 'gitlab') return { bad: `\`${raw}\` ends in \`/**\`, which GitLab's docs do not describe (they say to end a directory with \`/\`)` };
      if (i === 0) { body += '.*'; continue; }
      body = body.replace(/\/$/, '') + '/.+';
      continue;
    }
    if (seg.includes('**') && platform === 'gitlab') return { bad: `\`${raw}\` uses \`**\` inside a name, which GitLab's docs do not describe` };
    body += seg.split('').map((ch) => (ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : escRe(ch))).join('').replace(/(\[\^\/\]\*)+/g, '[^/]*');
    if (!last) body += '/';
  }
  const lastSeg = segs[segs.length - 1];
  return { re: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}$`), dirs: dirOnly || !/[*?]/.test(lastSeg), fileToo: !dirOnly };
}

function matches(pat, file) {
  if (pat.all) return true;
  if (pat.fileToo && pat.re.test(file)) return true;
  if (!pat.dirs) return false;
  const segs = file.split('/');
  for (let i = 1; i < segs.length; i++) if (pat.re.test(segs.slice(0, i).join('/'))) return true;
  return false;
}

// The file's text → { rules, skipped }. A rule is { line, section, negate, pat, owners }; `section` is the
// lower-cased name ('' for the unnamed one) and `optional` a per-section fact kept in `sections`. `skipped`
// is every line this reader did not use, with why — printed, never dropped quietly.
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
      // GitLab ignores a malformed owner and keeps the rest; an entry with none of its own takes the
      // section's defaults.
      const own = rest.map((x) => ownerOf(x, platform)).filter(Boolean);
      rules.push({ line: n, section, negate, pat, owners: own.length ? own : defaults });
      return;
    }
    const words = line.trim().split(/[ \t]+/);
    const cut = words.findIndex((x, j) => j > 0 && x.startsWith('#'));
    const [pattern, ...rest] = cut < 0 ? words : words.slice(0, cut);
    if (pattern.startsWith('!')) { skipped.push({ line: n, why: `\`${pattern}\` is a \`!\` pattern, which GitHub does not support` }); return; }
    const pat = patternOf(pattern, platform);
    if (pat.bad) { skipped.push({ line: n, why: pat.bad }); return; }
    const owners = rest.map((x) => ownerOf(x, platform));
    const badAt = owners.indexOf(null);
    if (badAt >= 0) {
      // A word with an `@` anywhere after its first character may be a mistyped address (`bob@corp`,
      // `@alice@corp.com`), so it is never printed as written.
      const shown = rest[badAt].indexOf('@', 1) >= 0 ? 'an address-like word' : `\`${rest[badAt]}\``;
      skipped.push({ line: n, why: `${shown} is not an owner (@user, @org/team or an e-mail address)` });
      return;
    }
    rules.push({ line: n, section: '', negate: false, pat, owners });
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
