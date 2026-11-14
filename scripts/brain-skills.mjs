#!/usr/bin/env node
/* global console, process */
// Writes the "Ask the project brain" block (E179) into yad-architecture, yad-stories, yad-spec and
// yad-implement, from cli/brain-skills.mjs. The block sits between two markers placed by hand in each skill;
// only the lines between them are ever replaced. A test in cli/test-brain.mjs fails when a skill's block and
// cli/brain-skills.mjs disagree, and this script is how you make them agree again.
//
//   node scripts/brain-skills.mjs           rewrite the blocks; print each skill it changed
//   node scripts/brain-skills.mjs --check   change nothing; exit 1 when a block is stale or refused
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBrainSkills } from '../cli/brain-skills.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
const r = syncBrainSkills(path.join(ROOT, 'skills'), { check });
if (check) for (const s of r.stale) console.log(`stale: skills/${s}/SKILL.md`);
for (const s of r.wrote) console.log(`wrote: skills/${s}/SKILL.md`);
for (const { skill, reason } of r.refused) console.error(`refused: skills/${skill}/SKILL.md — ${reason}`);
if ((check && r.stale.length) || r.refused.length) process.exit(1);
