#!/usr/bin/env node
// Writes the "When a tool is missing" section (E87) into every skill a toolbox tool names, from
// cli/toolbox.mjs. The toolbox owns the words; a test in cli/test-detect.mjs fails when a skill's section
// and the toolbox disagree, and this script is how you make them agree again.
//
// A skill without the section gets it just before its first `## ` heading, so the agent reads it early.
// A skill that has it gets it replaced, up to the next `## ` heading.
//
//   node scripts/skill-fallbacks.mjs           rewrite the sections; print each skill it changed
//   node scripts/skill-fallbacks.mjs --check   change nothing; exit 1 when a section is missing or stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_FALLBACK_HEADING, TOOLBOX, skillFallbackSection, skillsUsing } from '../cli/toolbox.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');

// The skill text with `section` in place of its old one, or added before the first `## ` heading.
export function withSection(text, section) {
  const lines = text.split('\n');
  const at = lines.indexOf(SKILL_FALLBACK_HEADING);
  if (at >= 0) {
    let end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    if (end < 0) end = lines.length;
    return [...lines.slice(0, at), ...section.split('\n'), '', ...lines.slice(end)].join('\n');
  }
  const first = lines.findIndex((l) => l.startsWith('## '));
  if (first < 0) return `${text.replace(/\n*$/, '')}\n\n${section}\n`;
  return [...lines.slice(0, first), ...section.split('\n'), '', ...lines.slice(first)].join('\n');
}

const skills = [...new Set(TOOLBOX.filter((t) => t.tier !== 'recommended').flatMap(skillsUsing))].sort();
let stale = 0;
for (const skill of skills) {
  const file = path.join(ROOT, 'skills', skill, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const next = withSection(text, skillFallbackSection(skill));
  if (next === text) continue;
  stale++;
  if (check) console.log(`stale: skills/${skill}/SKILL.md`);
  else { fs.writeFileSync(file, next); console.log(`wrote: skills/${skill}/SKILL.md`); }
}
if (check && stale) process.exit(1);
