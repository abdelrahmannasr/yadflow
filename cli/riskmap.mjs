// The risk map (E65): one file per code repo, `.sdlc/risk-map`, that gives each directory a risk LEVEL —
// `high`, `medium` or `low`. No names, no roles, no topic tags. Pure: no git, no filesystem. Callers pass
// in the map's text and the repo's file list, so every rule here is testable with plain strings.
//
// WHAT IT IS FOR. Part 3's escalation needs to know which code is risky. A hard-coded guess from file
// names (`RISK_PATTERNS`, cli/walkthrough.mjs) breaks on every naming habit, so the team keeps its own
// answer, one line per directory. E66 turns a `high` directory into the high step (+1); E67 asks who
// has committed to it. Until then nothing counts the map: it is read, checked and reported.
//
// WHO WRITES IT. `yad risk-map draft` adds a line for every directory nothing covers, as `unset`. The
// `yad-connect-repos` skill has an AI agent read the code and fill each `unset` line with a level, a
// reason and `guessed`. A person turns `guessed` into `confirmed` in a PR, so the commit records who.
// It is the team's file: it is never wired, never hash-managed, and `yad update` never touches it.
//
// THE FORMAT is lines, so the PR check (`checks/risk-map-check.sh`) reads it in bash with no tools:
//
//   # yad-risk-map v1
//   src/payments/   high    confirmed  # charge.js calls the card processor
//   src/catalog/    low     guessed    # read-only product listing
//   docs/           unset
//   ./              low     confirmed  # the files at the repo root
//
//   - Fields split on spaces and tabs only, so a path holds neither. A comment starts at the first `#` that
//     follows a space or tab, and is stripped before the fields are read — a `#` glued to a word is part of it.
//   - A directory ends in `/` and is written from the repo root. `./` means the files AT the root, not
//     every file below it: there is no catch-all line, so a new directory can never hide under one.
//   - The deepest listed directory above a file decides its level.
//   - `unset` means listed but not classified; its state column may be left out.
//   - Everything here has a twin in `checks/risk-map-check.sh`. Change one and change the other: a test
//     runs both over the same repos and compares what they report.

export const RISK_MAP_FILE = '.sdlc/risk-map';
export const RISK_MAP_VERSION = 1;
export const RISK_LEVELS = ['high', 'medium', 'low'];
const LEVEL_WORDS = [...RISK_LEVELS, 'unset'];
const STATES = ['guessed', 'confirmed'];

const HEADER = /^#[ \t]*yad-risk-map[ \t]+v([0-9]+)[ \t]*$/;
// Only spaces and tabs separate or surround fields — never the wider whitespace `String.trim` removes —
// so this and the awk twin read a form feed or a non-breaking space the same way.
const trimST = (s) => s.replace(/^[ \t]+|[ \t]+$/g, '');
// A word starting `@alice` names a person. A map holds no people, and CODEOWNERS lines pasted into it
// look exactly like this — `@org/team` included. A word ENDING in `/` is a directory (`@types/`), and
// `user@example.com` is not matched: the `@` does not start the word.
const namesSomeone = (line) => line.split(/[ \t]+/).some((w) => /^@[A-Za-z0-9_-]/.test(w) && !w.endsWith('/'));
// The version on a header as written, leading zeros dropped, so `v01` is 1 and `v0` is 0 in both twins.
const versionText = (digits) => digits.replace(/^0+(?=.)/, '');

// A directory as a line may name it: `./`, or one or more segments each ending in `/`. No leading `/`,
// no `.` or `..` segment, no glob characters (it is a directory, not a pattern), no backslash, no space,
// tab, CR or newline (they split fields or lines), and no leading `#` (that line is a comment).
export function validDir(dir) {
  if (dir === './') return true;
  if (dir.startsWith('#') || !/^([^/*?[\\ \t\r\n]+\/)+$/.test(dir)) return false;
  return !dir.slice(0, -1).split('/').some((seg) => seg === '.' || seg === '..');
}

// Parse the map's text. Never throws. Returns:
//   version   1 — or, when `supported` is false, the header's version as written (digits, leading zeros
//             dropped: a string, so a huge number prints the same in the awk twin)
//   header    false when the first non-blank line is not the header
//   supported false when the header names a version this release cannot read — then `entries` is empty,
//             because reading a newer file by older rules could invent levels it never said
//   entries   [{ dir, level, state, reason, line }] in file order, first line wins on a duplicate
//   problems  [{ code, line, message }] — `unreadable` for a line that is not an entry, `names` for an
//             `@login`, `duplicate` for a directory listed twice
export function parseRiskMap(text) {
  const out = { version: RISK_MAP_VERSION, header: false, supported: true, entries: [], problems: [] };
  const lines = String(text ?? '').split('\n');
  const seen = new Set();
  let first = true;
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const line = lines[i].replace(/\r$/, '');
    if (/^[ \t]*$/.test(line)) continue;
    if (first) {
      first = false;
      const h = HEADER.exec(line);
      if (h) {
        out.header = true;
        out.version = versionText(h[1]);
        if (out.version !== String(RISK_MAP_VERSION)) { out.supported = false; return out; }
        out.version = RISK_MAP_VERSION;
        continue;
      }
    }
    if (namesSomeone(line)) out.problems.push({ code: 'names', line: n, message: 'names a person (`@…`) — the map holds directories and levels only' });
    if (/^[ \t]*#/.test(line)) continue;
    const hash = /[ \t]#/.exec(line);
    const body = hash ? line.slice(0, hash.index) : line;
    const reason = hash ? trimST(line.slice(hash.index + 2)) : '';
    const f = trimST(body).split(/[ \t]+/);
    const bad = (why) => out.problems.push({ code: 'unreadable', line: n, message: why });
    if (f.length < 2 || f.length > 3) { bad('expected `<dir>/ <level> <guessed|confirmed>`'); continue; }
    const [dir, level, state = null] = f;
    if (!validDir(dir)) { bad(`\`${dir}\` is not a directory from the repo root ending in \`/\``); continue; }
    if (!LEVEL_WORDS.includes(level)) { bad(`\`${level}\` is not a level (high, medium, low or unset)`); continue; }
    if (level === 'unset' && state === 'confirmed') { bad('an `unset` line cannot be `confirmed`'); continue; }
    if (level === 'unset' ? state !== null && state !== 'guessed' : !STATES.includes(state)) {
      bad('the third field must be `guessed` or `confirmed`');
      continue;
    }
    if (seen.has(dir)) { out.problems.push({ code: 'duplicate', line: n, message: `\`${dir}\` is listed again — the first line wins` }); continue; }
    seen.add(dir);
    out.entries.push({ dir, level, state: level === 'unset' ? null : state, reason, line: n });
  }
  if (!first && !out.header) {
    out.problems.unshift({ code: 'header', line: 0, message: 'no `# yad-risk-map v1` line at the top — read as version 1' });
  }
  return out;
}

// The line that decides a file's level: the deepest listed directory above it, or `./` for a file at the
// root. null when no line covers it.
export function coverOf(entries, file) {
  if (!file.includes('/')) return entries.find((e) => e.dir === './') || null;
  let best = null;
  for (const e of entries) {
    if (e.dir !== './' && file.startsWith(e.dir) && (!best || e.dir.length > best.dir.length)) best = e;
  }
  return best;
}

// The directory to add for a file no line covers. Walk down from the root while some listed line sits
// deeper under the current directory; the first directory with none below it is the one to add. A file
// directly inside a directory that only has deeper lines asks for that directory itself. A directory a
// line cannot hold (`app/[slug]/`, `my docs/`) asks for its parent instead, which covers it; at the top
// level there is no parent line, so the name comes back as it is and `validDir` says it cannot be written.
export function dirToAdd(entries, file) {
  const segs = file.split('/');
  if (segs.length === 1) return './';
  let prefix = '';
  for (const seg of segs.slice(0, -1)) {
    const cand = `${prefix}${seg}/`;
    if (!validDir(cand)) return prefix || cand;
    if (!entries.some((e) => e.dir !== cand && e.dir.startsWith(cand))) return cand;
    prefix = cand;
  }
  return prefix;
}

// What to warn about. `files` is every file in the repo; `changed` is the files one change adds or edits.
// Leave `changed` out to check the whole repo: every file counts as touched, and `map-edited` — a fact
// about a change, not about a repo — is never said. Each finding is { code, target, message }, in this
// order: header / version, unreadable / names / duplicate (by line), dead, unset, guessed (by line),
// uncovered (in the order the files first ask for them), map-edited.
export function riskMapFindings(parsed, { files = [], changed = null } = {}) {
  const change = changed !== null;
  if (!change) changed = files;
  const out = [];
  if (!parsed.supported) {
    out.push({ code: 'version', target: `v${parsed.version}`, message: `written for risk-map v${parsed.version}; this release reads v${RISK_MAP_VERSION} — nothing in it was read` });
    return out;
  }
  for (const p of parsed.problems) out.push({ code: p.code, target: p.code === 'header' ? '' : `line ${p.line}`, message: p.message });
  const { entries } = parsed;
  for (const e of entries) {
    const holds = e.dir === './' ? files.some((f) => !f.includes('/')) : files.some((f) => f.startsWith(e.dir));
    if (!holds) out.push({ code: 'dead', target: e.dir, message: 'no file is in this directory any more — remove the line or fix the path' });
  }
  const touched = new Set();
  for (const f of changed) { const e = coverOf(entries, f); if (e) touched.add(e); }
  for (const e of entries) {
    if (touched.has(e) && e.level === 'unset') out.push({ code: 'unset', target: e.dir, message: 'has no level yet' });
  }
  for (const e of entries) {
    if (touched.has(e) && e.state === 'guessed') out.push({ code: 'guessed', target: e.dir, message: `\`${e.level}\` is still a guess — a person confirms it` });
  }
  const asked = [];
  for (const f of changed) {
    if (coverOf(entries, f)) continue;
    const d = dirToAdd(entries, f);
    if (!asked.includes(d)) asked.push(d);
  }
  for (const d of asked) {
    out.push({ code: 'uncovered', target: d, message: validDir(d) ? 'no line gives this directory a level'
      : 'no line gives this directory a level, and its name cannot be written in the map (a space, `#`, `*`, `?`, `[` or `\\`) — rename it' });
  }
  if (change && changed.includes(RISK_MAP_FILE)) out.push({ code: 'map-edited', target: RISK_MAP_FILE, message: 'this change edits the risk map, which decides how much review later changes need' });
  return out;
}

const NEW_MAP_HEAD = [
  `# yad-risk-map v${RISK_MAP_VERSION}`,
  '# One line per directory: <dir>/ <high|medium|low|unset> <guessed|confirmed>  # why',
  '# The deepest listed directory above a file decides its level. `./` is the files at the repo root.',
  '# No names. A person changes `guessed` to `confirmed` in a PR. See `yad risk-map check`.',
];

// Add an `unset` line for every directory nothing covers, and never change a line already there. Returns
// { text, added, unwritable, refused }: `refused` is a reason when the file is written for a newer version
// (adding to it by older rules is guessing); `unwritable` lists top-level directories whose names a line
// cannot hold — writing one would be an unreadable line that the next draft adds again. A missing header
// is added at the top — it is not an entry.
export function draftRiskMap(existing, files) {
  const text = existing ?? null;
  const parsed = parseRiskMap(text ?? '');
  if (!parsed.supported) return { text, added: [], unwritable: [], refused: `written for risk-map v${parsed.version}; this release reads v${RISK_MAP_VERSION}` };
  const all = files.includes(RISK_MAP_FILE) ? files : [...files, RISK_MAP_FILE];
  // Sorted, `./` first, so the same repo drafts the same bytes however git happens to list its files.
  const asked = riskMapFindings(parsed, { files: all }).filter((x) => x.code === 'uncovered').map((x) => x.target);
  const unwritable = asked.filter((d) => !validDir(d));
  const added = asked.filter((d) => validDir(d))
    .sort((a, b) => (a === './' ? -1 : b === './' ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const width = Math.max(0, ...added.map((d) => d.length)) + 2;
  const newLines = added.map((d) => `${d.padEnd(width)}unset`);
  if (text === null || /^[ \t\r\n]*$/.test(text)) {
    return { text: `${[...NEW_MAP_HEAD, '', ...newLines].join('\n')}\n`, added, unwritable, refused: null };
  }
  let body = text;
  if (!parsed.header) body = `# yad-risk-map v${RISK_MAP_VERSION}\n${body}`;
  if (newLines.length) body = `${body.replace(/\n*$/, '\n')}${newLines.join('\n')}\n`;
  return { text: body, added, unwritable, refused: null };
}
