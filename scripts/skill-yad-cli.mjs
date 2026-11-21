#!/usr/bin/env node
/* global console, process */
// Writes the "this skill needs the `yad` command" block (#244) into every skill that runs `yad`, from
// cli/skill-yad-cli.mjs, and takes it out of every other skill. The block sits between two markers, right
// after the skill's `# ` title; only the lines between them are ever replaced. A test in cli/test-detect.mjs
// fails when a skill's block and cli/skill-yad-cli.mjs disagree, and this script is how you make them agree.
//
//   node scripts/skill-yad-cli.mjs           rewrite the blocks; print each skill it changed
//   node scripts/skill-yad-cli.mjs --check   change nothing; exit 1 when a block is missing, stale or refused
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncSkillYadCli } from '../cli/skill-yad-cli.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
const r = syncSkillYadCli(path.join(ROOT, 'skills'), { check });
if (check) for (const s of r.stale) console.log(`stale: skills/${s}/SKILL.md`);
for (const s of r.wrote) console.log(`wrote: skills/${s}/SKILL.md`);
for (const { skill, reason } of r.refused) console.error(`${check ? 'will refuse' : 'refused'}: skills/${skill}/SKILL.md — ${reason}, then run this script again.`);
if ((check && r.stale.length) || r.refused.length) process.exit(1);
