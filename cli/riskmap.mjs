// The risk map (E65): one file per code repo, `.sdlc/risk-map`, that gives each directory a risk LEVEL —
// `high`, `medium` or `low`. No names, no roles, no topic tags. Pure: no git, no filesystem. Callers pass
// in the map's text and the repo's file list, so every rule here is testable with plain strings.
//
// WHAT IT IS FOR. Part 3's escalation needs to know which code is risky. A hard-coded guess from file
// names (`RISK_PATTERNS`, cli/walkthrough.mjs) breaks on every naming habit, so the team keeps its own
// answer, one line per directory. E66 turns a `high` directory into the high step (+1), read from the
// map on the BASE branch (`changeLevel`); E67 asks who has committed to it. The step is REPORTED and
// never holds a merge: a Build merge is held by the platform's branch protection, and the capacity cap
// (E72) is shown on the Build half but not enforced there (the user's decision, 2026-09-21).
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

// E66 — ESCALATE BY COUNT. The approvals a level adds: `high` is the high step, +1 — the same step and
// the same tier name `gateRuleFor` gives an `auth` or `payments` tag (cli/epic-state.mjs), so the two
// vocabularies print one sum (`base 1 + high risk 1`). `medium` is reported only; `low` adds nothing. A
// test pins `high` to `auth`'s step, so moving one without the other fails.
export const LEVEL_STEP = { high: 1, medium: 0, low: 0 };
const LEVEL_RANK = { low: 1, medium: 2, high: 3 };

// The level ONE change takes from a map: the highest level among the lines that decide the files it
// changes. Pure — the caller reads the map from the BASE branch, so a change cannot lower its own count
// by editing the map (E66). `changed` should hold every path the change adds, edits, deletes or moves
// away from: deleting code in a `high` directory is a `high` change. Returns:
//   level  'high' | 'medium' | 'low', or null when no touched line has a level
//   step   the approvals that level adds (`LEVEL_STEP`)
//   dirs   [{ dir, level, state }] for every touched line with a level, in map order
// Rules the roadmap closed: a `guessed` level counts exactly as a `confirmed` one (it can only ask for
// one more human, never let a gate pass); an `unset` line and a file no line covers add nothing (they
// are warned about, never counted as `high`). A map for a newer version was not read, so its level is
// unknown — `unsupported: true`, which a caller must say, never read as "nothing is high".
// The twin is the `--level` mode of `checks/risk-map-check.sh`; the parity test compares the two.
export function changeLevel(parsed, changed = []) {
  if (!parsed.supported) return { level: null, step: 0, dirs: [], unsupported: true };
  const touched = new Set();
  for (const f of changed) {
    const e = coverOf(parsed.entries, f);
    if (e && e.level !== 'unset') touched.add(e);
  }
  const dirs = parsed.entries.filter((e) => touched.has(e)).map(({ dir, level, state }) => ({ dir, level, state }));
  let level = null;
  for (const d of dirs) if (!level || LEVEL_RANK[d.level] > LEVEL_RANK[level]) level = d.level;
  return { level, step: level ? LEVEL_STEP[level] : 0, dirs };
}

// E67 — ESCALATE BY PROVEN HISTORY. Who has worked in the `high` directories a change touches, lately.
//
// The platform login a noreply commit address carries — `12345+octocat@users.noreply.github.com`,
// `octocat@users.noreply.github.com`, `12345-tanuki@users.noreply.gitlab.com` — else null. The address
// itself is never emitted; only the login, which the ledgers already record. The login keeps the case
// the address carries. It lives here, not in cli/usage.mjs (which re-exports it), because the awk twin
// in `checks/risk-map-check.sh` derives the same login and a test compares the two.
export function loginFromEmail(email) {
  const e = String(email || '');
  const gh = e.match(/^(?:\d+\+)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)@users\.noreply\.github\.com$/i);
  if (gh) return gh[1];
  const gl = e.match(/^\d+-([a-z0-9._-]+)@users\.noreply\.gitlab\.com$/i);
  return gl ? gl[1] : null;
}

// A commit whose author is a robot, not a person: an approval can never come from one. GitHub writes
// `dependabot[bot]` as the name and `…[bot]@users.noreply.github.com` as the address; the `[` also makes
// the login rule above reject it, so without this it would be listed by name as if it could approve.
export const isBot = (name, email) => /\[bot\]$/i.test(String(name || '').trim()) || /\[bot\]@/i.test(String(email || ''));

// The `high` directories this change touches, in map order. One git query runs per directory.
export function highTouched(entries, changed) {
  const hit = new Set();
  for (const f of changed) { const e = coverOf(entries, f); if (e && e.level === 'high') hit.add(e); }
  return entries.filter((e) => hit.has(e));
}

// The git pathspecs that mean "this directory, as the MAP sees it". Git then applies the map's cover
// rule itself, and nothing has to read a list of file names back out of git — which is what made a
// quoted path, a path holding a newline, or a merge's simplified path list able to name the wrong
// person. Every listed directory strictly below `dir` is excluded, whatever its level: the deepest
// listed line decides, so each of those directories answers for itself in its own query (git lets an
// exclude beat a later include, so they cannot share one).
// `./` is the files AT the root: `:(glob)*` matches a top-level entry only, because `*` never spans `/`.
// Every path built FROM A MAP NAME is `:(literal)` (`./` is the exception: it names no directory, and
// becomes `:(glob)*`). A directory name may legally start with `:` (`validDir` allows it), and git reads
// a leading `:` as pathspec MAGIC — `:weird/` would answer about `weird/`, and `:/` about the whole
// repo. A map name must describe a directory to git, never tell git what to do.
export function pathspecsFor(entries, dir) {
  if (dir === './') return [':(glob)*'];
  return [`:(literal)${dir}`, ...entries.filter((e) => e.dir !== dir && e.dir.startsWith(dir)).map((e) => `:(exclude,literal)${e.dir}`)];
}

// The people to name, from the author records those queries returned: `commits` is [{ name, email }] in
// the order git printed them (newest first, one run per directory in map order), and `excludeEmails` the
// authors of the change itself — an approval has to come from someone else, so their own work never
// counts. A robot is never a person who can approve. Deduped by address; the address itself never leaves
// this function (nor does `yad` ever print one).
export function recentAuthors(commits, excludeEmails = []) {
  const skip = new Set(excludeEmails.map((e) => String(e).toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const cm of commits) {
    const key = String(cm.email || '').toLowerCase();
    if (seen.has(key) || skip.has(key) || isBot(cm.name, cm.email)) continue;
    seen.add(key);
    out.push({ name: cm.name, login: loginFromEmail(cm.email) });
  }
  return out;
}

// E68 — the folders a change touches, for the reviewer SUGGESTION: the folder each changed file sits in
// (`./` for a file at the root), nobody twice, the folder holding the most changed files first (then by
// name, so the order is the same every run). A folder that holds only subfolders is never one.
export function touchedFolders(changed) {
  const n = new Map();
  for (const f of changed) {
    const i = f.lastIndexOf('/');
    const dir = i < 0 ? './' : f.slice(0, i + 1);
    n.set(dir, (n.get(dir) || 0) + 1);
  }
  return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || (a < b ? -1 : a > b ? 1 : 0));
}

// The pathspec for the files DIRECTLY in one folder — never its subfolders, so work in `src/` is not
// work in every folder below it. A glob, because `:(literal)` cannot stop at one level; so every glob
// character in the name is escaped, and the name can never tell git what to do (E67's `:weird/` lesson:
// the magic ends at `)`, and what follows is only a pattern).
export function folderPathspec(dir) {
  if (dir === './') return ':(glob)*';
  return `:(glob)${dir.replace(/[\\*?[]/g, '\\$&')}*`;
}

// The people to suggest, from ONE log over every touched folder: `recentAuthors`' rules (the change's own
// authors and robots left out, one row per address), ranked by how many commits each made there, then
// newest first. A count, because a suggestion list is read top-down and the first name should be the one
// who has done the most there lately.
export function rankAuthors(commits, excludeEmails = []) {
  const count = new Map();
  const first = [];
  for (const cm of commits) {
    const key = String(cm.email || '').toLowerCase();
    if (!count.has(key)) first.push(cm);
    count.set(key, (count.get(key) || 0) + 1);
  }
  // One record per address, in git's order (newest first). Each goes through recentAuthors on its own, so
  // the robot and own-author rules are the SAME code E67 runs, never a copy of them.
  const rows = [];
  for (const cm of first) {
    const [p] = recentAuthors([cm], excludeEmails);
    if (p) rows.push({ ...p, commits: count.get(String(cm.email || '').toLowerCase()) });
  }
  // Array.prototype.sort is stable, so equal counts keep git's newest-first order.
  return rows.sort((a, b) => b.commits - a.commits);
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
