// #244 — a skill that runs `yad` says, before its first step, that it needs the `yad` command, and what to do
// when it is missing. Without this, an agent on a machine with no yadflow CLI gets a raw "command not found"
// part way through a step.
//
// The block's words live here, so a test (cli/test-detect.mjs, next to the E87 one) can hold every skill to
// them; `scripts/skill-yad-cli.mjs` writes them, and `--check` says which skill is stale. It sits between two
// markers, right after the skill's `# ` title, so it is the first thing the agent reads, and it never touches
// the frontmatter (the skill's `description:` is held to its own limits):
//
//   <!-- generated: yad-cli — from cli/skill-yad-cli.mjs by scripts/skill-yad-cli.mjs; do not edit by hand -->
//   …
//   <!-- end: yad-cli -->
//
// Which skills get it is decided from the skill's own text (`skillRunsYad`), never from a list kept by hand,
// so a new skill that runs `yad` is caught by the test. The skills keep the CLI dependency on purpose
// (docs/design-rules.md, Part 9): a skill that worked without it could only ask the agent to wait, not
// enforce an approval.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './lib.mjs';
import { applyMarkedBlock } from './marked-block.mjs';
import { isFallbackHeading, SKILL_FALLBACK_END } from './toolbox.mjs';

export const YAD_CLI_BEGIN = '<!-- generated: yad-cli — from cli/skill-yad-cli.mjs by scripts/skill-yad-cli.mjs; do not edit by hand -->';
export const YAD_CLI_KEY = '<!-- generated: yad-cli ';
export const YAD_CLI_END = '<!-- end: yad-cli -->';

// The lines between the markers. Markdown. The stop is before the first `yad …` command, not before the whole
// skill: yad-guide runs `npx -y yadflow@4 new|join|member add` on a machine that has no `yad` yet.
export const YAD_CLI_LINES = Object.freeze([
  '',
  '**This skill needs the `yad` command.** Before its first `yad …` command, run `command -v yad` (in PowerShell, `(Get-Command yad -ErrorAction SilentlyContinue).Source`). When it prints nothing, the yadflow CLI is not installed on this machine: stop there, and tell the person:',
  '',
  '- Install it with `npm install -g yadflow@latest`, or run each command as `npx -y yadflow@4 …` in place of `yad …`.',
  '- It is needed because the CLI is what enforces the approvals. Without it, a step could only ask you to wait; it could not check that a person approved.',
  '',
  'Go on only when that check prints a path, or when the person chooses `npx -y yadflow@4`. A command this skill already writes as `npx -y yadflow@4 …` runs without the install.',
  '',
]);

// Skills whose text names a `yad` command only to say another skill runs it. They never run `yad` themselves,
// so they get no block. Each entry says why; the test checks every entry still names one (or it is dropped).
export const YAD_CLI_MENTIONS_ONLY = Object.freeze({
  'yad-connect-docs': 'it only writes .sdlc/docs.json; it names `yad docs deploy` as what yad-docs runs',
  'yad-pr-template': 'it only writes the PR/MR templates and runs `bash checks/risk-route.sh`; the yad commands it names (`yad open-pr`, `yad update`, `yad setup`) are run by other skills',
});

// A `yad <command>` in inline code, or a line that is a `yad <command>` (a code block, with or without `$ `).
const RUNS = [/`yad [a-z]/, /^\s*(?:\$\s+)?yad [a-z]/];

// Where the frontmatter ends: the index of the first line after its closing `---`, 0 when the file has none
// (a byte-order mark before the opening `---` is allowed, as toolbox.mjs's sectionBounds allows it), and the
// whole file when it never closes.
function frontmatterEnd(lines) {
  if ((lines[0] ?? '').replace(/^\uFEFF/, '').trim() !== '---') return 0;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return close === -1 ? lines.length : close + 1;
}

// A code fence, as CommonMark reads one: it opens with three or more ` or ~ (indented at most three spaces),
// and closes with a line of the same mark, at least as long, with nothing after it. Returns the fence still
// open after `line` (null when none) and whether `line` itself is a fence line.
function fenceAfter(open, line) {
  if (!open) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m || (m[1][0] === '`' && m[2].includes('`'))) return { open: null, fenced: false };
    return { open: m[1], fenced: true };
  }
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  if (m && m[1][0] === open[0] && m[1].length >= open.length) return { open: null, fenced: true };
  return { open, fenced: true };
}

// The skill's own words: no frontmatter (the description names commands too), no block yad generates (this
// one, the brain block, yad-guide's lists — `<!-- generated: … -->` to `<!-- end: … -->`), and no "When a
// tool is missing" section (E87), which already says what to do when `yad` cannot answer. A marker or heading
// inside a code fence is only an example: it opens no region, and the fenced lines count as the skill's own.
export function ownLines(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let skip = null; // the test that ends the region being skipped
  let open = null;
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (skip) { if (skip(t)) skip = null; continue; }
    const f = fenceAfter(open, l);
    const inFence = open !== null || f.fenced;
    open = f.open;
    if (!inFence && t.startsWith('<!-- generated: ')) { skip = (x) => x.startsWith('<!-- end: '); continue; }
    if (!inFence && isFallbackHeading(l)) { skip = (x) => x === SKILL_FALLBACK_END; continue; }
    out.push(l);
  }
  return out;
}

// Whether a skill runs `yad`: one rule, used by the script and the test alike.
export function skillRunsYad(skill, text) {
  if (Object.hasOwn(YAD_CLI_MENTIONS_ONLY, skill)) return false;
  return ownLines(text).some((l) => RUNS.some((re) => re.test(l)));
}

// The index of the skill's `# ` title: the first one past the frontmatter and outside a code fence.
function titleIndex(lines) {
  const from = frontmatterEnd(lines);
  let open = null;
  for (let i = from; i < lines.length; i++) {
    const f = fenceAfter(open, lines[i]);
    const inFence = open !== null || f.fenced;
    open = f.open;
    if (!inFence && /^# \S/.test(i === 0 ? lines[i].replace(/^\uFEFF/, '') : lines[i])) return i;
  }
  return -1;
}

// The skill's text with the block in place (`want`), or without it. Returns { text, refused }: `refused` says
// why the markers cannot be trusted (or, for a new block, why there is nowhere to put it), and the text is
// then unchanged. Every line yad does not write keeps its own line ending; the lines it writes take the
// ending of the line they follow (a Windows checkout is all CRLF).
export function withYadCliBlock(text, want) {
  const rows = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const lines = rows.map((r) => r.replace(/\r?\n$/, ''));
  const begins = lines.flatMap((l, i) => (l.trim().startsWith(YAD_CLI_KEY) ? [i] : []));
  const ends = lines.flatMap((l, i) => (l.trim() === YAD_CLI_END ? [i] : []));
  const bad = `the yad-cli block needs exactly one line starting "${YAD_CLI_KEY.trim()}" followed by one line "${YAD_CLI_END}" — fix or delete the markers`;
  const crlf = (text.match(/\r\n/g) || []).length;
  const most = crlf > (text.match(/\n/g) || []).length - crlf ? '\r\n' : '\n';
  const endingOf = (i) => (rows[i].match(/\r?\n$/) ?? [most])[0];
  if (begins.length || ends.length) {
    if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) return { text, refused: bad };
    if (want) {
      const r = applyMarkedBlock(text, { begin: YAD_CLI_BEGIN, beginKey: YAD_CLI_KEY, end: YAD_CLI_END, lines: YAD_CLI_LINES });
      return r.refused ? { text, refused: r.refused } : { text: r.text, refused: null };
    }
    // Out, with the blank line written below it when one sits above too, so the text never closes up.
    const [b, e] = [begins[0], ends[0]];
    let after = e + 1;
    if (lines[after] === '' && (b === 0 || lines[b - 1] === '')) after++;
    return { text: [...rows.slice(0, b), ...rows.slice(after)].join(''), refused: null };
  }
  if (!want) return { text, refused: null };
  const at = titleIndex(lines);
  if (at === -1) return { text, refused: 'it has no `# ` title line to put the yad-cli block after — add one' };
  const eol = endingOf(at);
  const title = /\r?\n$/.test(rows[at]) ? rows[at] : rows[at] + eol;
  const block = ['', YAD_CLI_BEGIN, ...YAD_CLI_LINES, YAD_CLI_END].map((l) => l + eol).join('');
  const gap = at + 1 < rows.length && lines[at + 1] !== '' ? eol : '';
  return { text: rows.slice(0, at).join('') + title + block + gap + rows.slice(at + 1).join(''), refused: null };
}

// The block as a skill holds it (null when it has none or its markers cannot be trusted), for the test.
export function yadCliBlockOf(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const b = lines.findIndex((l) => l.trim().startsWith(YAD_CLI_KEY));
  const e = lines.findIndex((l) => l.trim() === YAD_CLI_END);
  return b === -1 || e < b ? null : lines.slice(b, e + 1).join('\n');
}

export const yadCliBlock = () => [YAD_CLI_BEGIN, ...YAD_CLI_LINES, YAD_CLI_END].join('\n');

// Bring every skill under `skillsDir` in line: the block in each skill that runs `yad`, none in any other.
// `check` changes nothing. Returns { stale: [skill], wrote: [skill], refused: [{ skill, reason }] }.
export function syncSkillYadCli(skillsDir, { check = false } = {}) {
  const out = { stale: [], wrote: [], refused: [] };
  let names = [];
  try { names = fs.readdirSync(skillsDir).sort(); } catch { /* no skills folder */ }
  for (const skill of names) {
    const file = path.join(skillsDir, skill, 'SKILL.md');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; } // a folder with no SKILL.md (skills/sdlc)
    const r = withYadCliBlock(text, skillRunsYad(skill, text));
    if (r.refused) { out.refused.push({ skill, reason: r.refused }); continue; }
    if (r.text === text) continue;
    out.stale.push(skill);
    if (check) continue;
    writeFileAtomic(file, r.text, { within: skillsDir, keepMode: true });
    out.wrote.push(skill);
  }
  return out;
}
