#!/usr/bin/env node
/* global console, process */
// Writes the generated sections of skills/yad-guide/SKILL.md (E158) — the human-only list, the command
// classes, what is never done, and the short rules — from cli/agent-rules.mjs (`syncGuideSkill`). The rules
// own the words; a test in cli/test-agents-file.mjs fails when the skill and the rules disagree, and this
// script is how you make them agree again.
//
//   node scripts/agent-guide.mjs           rewrite the sections; print each one it changed
//   node scripts/agent-guide.mjs --check   change nothing; exit 1 when a section is stale or refused
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncGuideSkill } from '../cli/agent-guide.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
const r = syncGuideSkill(path.join(ROOT, 'skills', 'yad-guide', 'SKILL.md'), { check });
for (const s of r.stale) console.log(`${check ? 'stale' : 'wrote'}: skills/yad-guide/SKILL.md "${s}"`);
for (const reason of r.refused) console.error(`refused: skills/yad-guide/SKILL.md — ${reason}; put the markers back, then run this script again.`);
if ((check && r.stale.length) || r.refused.length) process.exit(1);
