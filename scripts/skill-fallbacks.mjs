#!/usr/bin/env node
/* global console, process */
// Writes the "When a tool is missing" section (E87) into every skill a toolbox tool names, from
// cli/toolbox.mjs, and takes it out of every other skill. The toolbox owns the words; a test in
// cli/test-detect.mjs fails when a skill's section and the toolbox disagree, and this script is how you
// make them agree again.
//
// A skill without the section gets it just before its first `## ` heading, so the agent reads it early.
// A skill that has it gets it replaced, up to the next heading (see `withSkillSection`).
//
//   node scripts/skill-fallbacks.mjs           rewrite the sections; print each skill it changed
//   node scripts/skill-fallbacks.mjs --check   change nothing; exit 1 when a section is missing or stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillFallbackSection, skillSectionOf, withSkillSection } from '../cli/toolbox.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');

const skills = fs.readdirSync(path.join(ROOT, 'skills')).filter((s) => fs.existsSync(path.join(ROOT, 'skills', s, 'SKILL.md'))).sort();
let stale = 0;
for (const skill of skills) {
  const file = path.join(ROOT, 'skills', skill, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const want = skillFallbackSection(skill); // null: no tool names this skill, so it has no section
  const have = skillSectionOf(text);
  // Compared as text, not bytes, so a CRLF checkout (Windows) is not stale for its line endings alone.
  if (have === want) continue;
  stale++;
  if (check) { console.log(`stale: skills/${skill}/SKILL.md`); continue; }
  const next = withSkillSection(text, want);
  // A rewrite only swaps the section. If it would lose more than the old section held, the section
  // finder misread the file (a fence it did not understand, say): stop rather than cut the skill.
  if (text.length - next.length > (have ?? '').length) {
    console.error(`refused: skills/${skill}/SKILL.md — the rewrite would remove more than the section; fix the section by hand`);
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(file, next);
  console.log(`wrote: skills/${skill}/SKILL.md`);
}
if (check && stale) process.exit(1);
