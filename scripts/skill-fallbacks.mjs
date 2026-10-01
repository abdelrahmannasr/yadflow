#!/usr/bin/env node
/* global console, process */
// Writes the "When a tool is missing" section (E87) into every skill a toolbox tool names, from
// cli/toolbox.mjs, and takes it out of every other skill (`syncSkillFallbacks`). The toolbox owns the
// words; a test in cli/test-detect.mjs fails when a skill's section and the toolbox disagree, and this
// script is how you make them agree again.
//
// A skill without the section gets it just before its first `## ` heading, so the agent reads it early.
// A skill that has it gets it replaced, up to the next heading. A section holding a line the toolbox
// never writes (a heading, a heading underline, a fence) is refused: the section finder may have
// misread the file, and a rewrite could cut part of the skill. The message quotes the line.
//
//   node scripts/skill-fallbacks.mjs           rewrite the sections; print each skill it changed
//   node scripts/skill-fallbacks.mjs --check   change nothing; exit 1 when a section is missing or stale
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncSkillFallbacks } from '../cli/toolbox.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
const r = syncSkillFallbacks(path.join(ROOT, 'skills'), { check });
if (check) for (const s of r.stale) console.log(`stale: skills/${s}/SKILL.md`);
for (const s of r.wrote) console.log(`wrote: skills/${s}/SKILL.md`);
for (const { skill, line } of r.refused) {
  console.error(`${check ? 'will refuse' : 'refused'}: skills/${skill}/SKILL.md — the line ${JSON.stringify(line)} inside its section is not the toolbox's text, so the section's end may be misread and a rewrite could cut the skill. Delete the old section (from its heading down to the next heading), then run this script again.`);
}
if ((check && r.stale.length) || r.refused.length) process.exit(1);
