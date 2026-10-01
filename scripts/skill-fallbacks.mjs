#!/usr/bin/env node
/* global console, process */
// Writes the "When a tool is missing" section (E87) into every skill a toolbox tool names, from
// cli/toolbox.mjs, and takes it out of every other skill (`syncSkillFallbacks`). The toolbox owns the
// words; a test in cli/test-detect.mjs fails when a skill's section and the toolbox disagree, and this
// script is how you make them agree again.
//
// The section runs from its heading down to its end marker (`<!-- end: When a tool is missing -->`),
// and only those lines are ever replaced. A new one goes just before the skill's first `## ` heading.
// A section without its marker, or with two copies, is refused: where it ends would be a guess.
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
for (const { skill, reason } of r.refused) {
  console.error(`${check ? 'will refuse' : 'refused'}: skills/${skill}/SKILL.md — ${reason}. Delete the section by hand (from its heading down to the end of the old text), then run this script again.`);
}
if ((check && r.stale.length) || r.refused.length) process.exit(1);
