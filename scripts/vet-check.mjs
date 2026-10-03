#!/usr/bin/env node
/* global console, process */
// Is every tool in the toolbox vetted, and recently enough to publish? (E88) And every skill the
// recommendation catalogue names (E52), which carries the same record.
//
// Every entry in cli/toolbox.mjs carries a `vetted` record: where its licence was read, its official
// source, and the day that was done. The unit suite already fails on an incomplete record. This adds the
// one thing the unit suite deliberately does not check — AGE — so `main` never turns red by itself, but a
// release cannot go out while a record is older than VET_MAX_AGE_DAYS.
//
//   node scripts/vet-check.mjs                 check against today
//   node scripts/vet-check.mjs --today YYYY-MM-DD   check against another day (to see what is coming)
//
// To re-vet a tool: read its LICENSE file (or, for a closed tool, the vendor's terms page) again,
// confirm its source is still the official one and that each package in `vetted.packages` still points
// back to it, then update `vetted.on`, `vetted.release` and the package versions in cli/toolbox.mjs.
// Every entry starts on the shared VETTED_ON date: to re-vet ONE tool, give that entry its own date
// literal instead of moving the shared one, which would re-date all thirteen.
// Moving Repomix's npm version moves the version yad runs (REPOMIX_VERSION), so the skills that write
// `npx repomix@…` out as text change with it — the test that holds them names each line.
import { isCalendarDay, staleVettings, TOOLBOX, VET_MAX_AGE_DAYS, vettingProblems } from '../cli/toolbox.mjs';
import { asVetted, RECOMMENDATIONS } from '../cli/recommend.mjs';

const at = process.argv.indexOf('--today');
const day = at === -1 ? null : process.argv[at + 1];
// A real day only: an impossible one (2026-13-01) would make every age NaN and pass everything.
if (at !== -1 && !isCalendarDay(day)) {
  console.error('usage: node scripts/vet-check.mjs [--today YYYY-MM-DD]');
  process.exit(2);
}
// Days are counted in UTC, like the dates in the records.
const today = day ? new Date(`${day}T00:00:00Z`) : new Date();

// A catalogue entry is named `<step>:<skill>`, and lives in cli/recommend.mjs rather than cli/toolbox.mjs.
const skills = RECOMMENDATIONS.map(asVetted);
const all = [...TOOLBOX, ...skills];
const fileOf = (id) => (skills.some((s) => s.id === id) ? 'cli/recommend.mjs' : 'cli/toolbox.mjs');
const incomplete = all.map((t) => [t, vettingProblems(t)]).filter(([, p]) => p.length);
const stale = staleVettings(today, all);

if (!incomplete.length && !stale.length) {
  const oldest = all.map((t) => t.vetted.on).sort()[0];
  console.log(`all ${TOOLBOX.length} toolbox tools and ${skills.length} recommended skills are vetted; the oldest record is from ${oldest} (limit: ${VET_MAX_AGE_DAYS} days)`);
  process.exit(0);
}
for (const [t, problems] of incomplete) console.error(`${t.id} (${fileOf(t.id)}): not vetted — ${problems.join('; ')}`);
for (const s of stale) {
  console.error(s.why === 'future'
    ? `${s.id} (${s.name}, ${fileOf(s.id)}): vetted on ${s.on}, which is after today (UTC) — fix the date to the day the vetting was done`
    : `${s.id} (${s.name}, ${fileOf(s.id)}): vetted on ${s.on}, ${s.age} days ago — older than ${VET_MAX_AGE_DAYS} days`);
}
// The re-vet steps only when something is stale or incomplete: a future date is a typo to correct, and
// telling someone to re-read a licence for it would send them the wrong way.
if (incomplete.length || stale.some((s) => s.why === 'stale')) {
  console.error(`\nre-vet each one in the file named: read its licence again (LICENSE file, or the vendor's terms),
confirm its source and its packages still point to the official home, then update vetted.on, vetted.release
and the package versions. A recommended skill also needs its SKILL.md read again at the new release, and the
catalogue's version moved. The header of scripts/vet-check.mjs has the steps.`);
}
process.exit(1);
