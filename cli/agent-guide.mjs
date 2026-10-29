// The generated sections of the `yad-guide` skill (E158), written from cli/agent-rules.mjs so the skill and
// the rules `yad guide --json` hands out cannot drift apart. Each section sits between two marker lines the
// skill holds; only the lines between them are ever replaced (`applyMarkedBlock`, the AGENTS.md block's
// rules). A test runs `scripts/agent-guide.mjs --check`, and fails when the skill and the rules disagree.
import fs from 'node:fs';
import { applyMarkedBlock } from './marked-block.mjs';
import { CLASSES, ASK, COMMAND_CLASS, RULES, NEVER, HUMAN_ONLY_ACTS, humanOnlyCommands } from './agent-rules.mjs';

export const GUIDE_SECTIONS = ['human-only', 'classes', 'never', 'rules'];
const begin = (name) => `<!-- generated: ${name} — from cli/agent-rules.mjs by scripts/agent-guide.mjs; do not edit by hand -->`;
const end = (name) => `<!-- end: ${name} -->`;

// What each "ask" answer means for the agent, in the words the skill uses.
const ASK_WORDS = {
  never: 'run it without asking',
  'each-time': 'ask the person every time, naming what it will do; run it only on a yes',
  'per-dial': 'ask first, unless `yad dial open-pr` is `auto`',
  'person-runs': 'never run it: give the person the exact command, wait, then confirm by reading',
  'only-when-asked': 'run it only when the person asked for exactly this, or gave you what it records',
  'not-by-agent': 'do not run it',
};

// Every command line of a class, as finished Markdown: the commands whose own class it is, and
// `<command> --<flag>` for each flag that raises a command to it.
function commandsOf(cls) {
  const out = [];
  for (const [key, e] of Object.entries(COMMAND_CLASS)) {
    // A command whose flags raise it says which, so `yad dial` reads as "not with --to".
    const raised = Object.entries(e.flags ?? {}).filter(([, c]) => c !== cls).map(([f]) => `\`--${f}\``);
    if (e.class === cls) out.push(raised.length ? `\`yad ${key}\` (not with ${raised.join(', ')})` : `\`yad ${key}\``);
    for (const [flag, c] of Object.entries(e.flags ?? {})) if (c === cls) out.push(`\`yad ${key} --${flag}\``);
  }
  return out;
}

export function guideSections() {
  return {
    'human-only': [
      '',
      'Only the person does these:',
      '',
      ...humanOnlyCommands().map((c) => `- \`${c}\``),
      ...HUMAN_ONLY_ACTS.map((a) => `- ${a.text}`),
      '',
    ],
    classes: [
      '',
      '`yad guide --json` gives each command its `class` and `ask`. In short:',
      '',
      ...CLASSES.filter((cls) => !['internal', 'removed'].includes(cls)).flatMap((cls) => [
        `- **${cls}** — ${ASK_WORDS[ASK[cls]]}. ${commandsOf(cls).join(', ')}.`,
      ]),
      '',
      'A command not listed: read `yad <command> --help`, and treat it as a write until you know better.',
      '',
    ],
    never: ['', ...NEVER.map((n) => `- ${n.text}`), ''],
    rules: ['', ...RULES.map((r) => `- ${r.text}`), ''],
  };
}

// Bring one skill file in line. Returns `{stale: [names], refused: [reasons], text}`; writes only when
// `check` is false and nothing is refused. A section whose markers are missing is refused, never added: the
// skill's prose decides where it goes.
export function syncGuideSkill(file, { check = false } = {}) {
  let text = fs.readFileSync(file, 'utf8');
  const stale = [];
  const refused = [];
  const sections = guideSections();
  for (const name of GUIDE_SECTIONS) {
    const lines = text.split(/\r?\n/);
    if (!lines.some((l) => l.trim().startsWith(`<!-- generated: ${name} `)) || !lines.some((l) => l.trim() === end(name))) {
      refused.push(`the "${name}" section's markers are missing ("${begin(name)}" … "${end(name)}")`);
      continue;
    }
    const r = applyMarkedBlock(text, { begin: begin(name), beginKey: `<!-- generated: ${name} `, end: end(name), lines: sections[name] });
    if (r.refused) { refused.push(`"${name}": ${r.refused}`); continue; }
    if (r.status !== 'ok') stale.push(name);
    text = r.text;
  }
  if (!check && !refused.length && stale.length) fs.writeFileSync(file, text);
  return { stale, refused, text };
}
