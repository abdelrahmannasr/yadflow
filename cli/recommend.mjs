// The recommendation catalogue — a short, hand-picked list of skills worth binding to each step (E52).
//
//   yad skill recommend [<step>] [--profile <p> | --epic <id>] [--json]
//
// WHAT IT IS FOR. The toolbox lists three skill pools (BMAD-METHOD, ECC, mattpocock/skills) as
// "recommended — listed, never pushed". A pool holds dozens of skills, and an agent with three pools
// installed chooses between hundreds of descriptions. This list narrows that to a few named skills per
// step, each with the reason it fits. It recommends only: `yad skill bind` stays the one writer, and
// nothing is ever bound for you (E84: listed, never pushed; E51: a step's line is always a team's choice).
//
// A CHAIN, NEVER A REPLACEMENT. yadflow's own skill for a step does work no pool skill knows about — it
// writes the artifact where the gate looks, locks the contract, seeds the ledger. So every suggestion is
// the pool skill FIRST and yadflow's skill LAST: `yad skill bind architecture <pool-skill> yad-architecture`.
// A chain hands each skill what the one before it produced, and the last output is the artifact (closed
// decision 7), so the pool skill shapes the thinking and yadflow's skill files the result.
//
// VERSIONED SEPARATELY (decided with the row). The list carries its own `version` and `checked` day, apart
// from yadflow's package version, and every command that shows it prints its age. It still ships inside
// yadflow and moves with a release: no network, no cache, no project file, so no shape change. A test
// holds each version to one content: changing an entry without moving `version` fails.
//
// EVERY ENTRY IS VETTED, THE E88 WAY. Each one carries the same `vetted` record as a toolbox tool —
// where the licence was read, the official source, the release tag on that day — plus `file`, the exact
// SKILL.md at that tag, so the name was read from the real repository and never guessed from a pool's
// naming habit. The release check refuses to publish while any record is older than VET_MAX_AGE_DAYS
// (`scripts/vet-check.mjs`), exactly as for the toolbox.
//
// NOT THE ORCHESTRATOR. Part 7's separate package (E92–E102) ranks skills from measured evidence. This is
// the hand-made list that comes first: a person read each skill and wrote down why it fits.
import { createHash } from 'node:crypto';
import { c, emitJSON, fail, hand, info, log, warn } from './lib.mjs';
import { bindingsForProfile, loadSkillBindings, stepDef, stepSkills, STEPS } from './epic-state.mjs';
import { TOOLBOX, isCalendarDay, vettingProblems } from './toolbox.mjs';

// The list's own version and the day it was last read through as a whole. Move `version` whenever an
// entry is added, removed or changed — the test names the new digest to record beside it.
export const CATALOGUE = Object.freeze({ version: 1, checked: '2026-10-03' });

const VETTED_ON = '2026-10-03';

// ---- the list --------------------------------------------------------------------------------------
//
//   step     the step id it fits (a step a skill runs — never a review gate)
//   skill    the name to bind, as an agent calls it once the pool is installed
//   pool     the toolbox id of the pool it comes from (its install routes are the pool's)
//   reason   one sentence: what it adds before yadflow's own skill runs
//   caveat   null, or one sentence a team must know before binding it (an install profile, a file it writes)
//   file     the skill's SKILL.md in the pool's repository, at `vetted.release`
//   licence  + vetted: the E88 record, read for this entry
// The vetting record each pool's skills share, read on VETTED_ON at the pool's release tag: the licence
// from its LICENSE file, the source, and the npm package its installer is. Every SKILL.md below was
// fetched at that tag and its `name` read; none sets `disable-model-invocation`, so an agent can run each
// one as a step of a chain. Deprecated BMAD names that only forward to a newer skill (`bmad-create-prd`,
// `bmad-create-architecture`, `bmad-dev-story` — removed in BMAD v7) are left out on purpose.
const BMAD = Object.freeze({
  on: VETTED_ON, licenceFrom: 'https://github.com/bmad-code-org/BMAD-METHOD/blob/main/LICENSE',
  source: 'https://github.com/bmad-code-org/BMAD-METHOD', release: 'v6.12.0',
  packages: [{ registry: 'npm', name: 'bmad-method', version: '6.12.0' }],
  note: "GitHub reads the LICENSE as NOASSERTION: it is MIT text with a trademark notice added. Named as `npx bmad-method install` copies it (a plugin install calls it <plugin>:<name>).",
});
const ECC = Object.freeze({
  on: VETTED_ON, licenceFrom: 'https://github.com/affaan-m/ECC/blob/main/LICENSE',
  source: 'https://github.com/affaan-m/ECC', release: 'v2.2.3',
  packages: [{ registry: 'npm', name: 'ecc-universal', version: '2.2.3' }],
  note: 'Named as `npx ecc-universal install` copies it; the `ecc@ecc` plugin calls it ecc:<name>.',
});
const MATT = Object.freeze({
  on: VETTED_ON, licenceFrom: 'https://github.com/mattpocock/skills/blob/main/LICENSE',
  source: 'https://github.com/mattpocock/skills', release: 'v1.2.3',
  packages: [],
  note: 'Named as the mattpocock-skills plugin calls it (<plugin>:<name>): a plugin is the one install route the toolbox lists for this pool.',
});
const B = 'https://github.com/bmad-code-org/BMAD-METHOD/blob/v6.12.0/src';
const E = 'https://github.com/affaan-m/ECC/blob/v2.2.3/skills';
const M = 'https://github.com/mattpocock/skills/blob/v1.2.3/skills';
const ECC_PROFILE = (p) => `Not in ECC's smaller install profiles: install with --profile ${p}, or use the ecc@ecc plugin.`;

export const RECOMMENDATIONS = Object.freeze([
  // ---- foundation: the product's purpose, scope and principles ----
  { step: 'foundation', skill: 'bmad-prfaq', pool: 'bmad-method', licence: 'MIT', file: `${B}/bmm-skills/plan/bmad-prfaq/SKILL.md`, vetted: BMAD, caveat: null,
    reason: 'Works backwards from a press release and its hard questions, a sharp test of the product\'s purpose before the Foundation fixes it.' },
  { step: 'foundation', skill: 'bmad-brainstorming', pool: 'bmad-method', licence: 'MIT', file: `${B}/core-skills/bmad-brainstorming/SKILL.md`, vetted: BMAD, caveat: null,
    reason: 'Guided ideation with several techniques, so the options are wide before the principles are narrowed.' },
  { step: 'foundation', skill: 'council', pool: 'ecc', licence: 'MIT', file: `${E}/council/SKILL.md`, vetted: ECC, caveat: null,
    reason: 'A four-voice structured disagreement for the go/no-go and trade-off calls a Foundation records.' },

  // ---- analysis: pressure-test the idea ----
  { step: 'analysis', skill: 'bmad-forge-idea', pool: 'bmad-method', licence: 'MIT', file: `${B}/core-skills/bmad-forge-idea/SKILL.md`, vetted: BMAD, caveat: null,
    reason: 'Several personas attack a half-formed idea, so the analysis starts from one that has already been tested.' },
  { step: 'analysis', skill: 'bmad-product-brief', pool: 'bmad-method', licence: 'MIT', file: `${B}/bmm-skills/plan/bmad-product-brief/SKILL.md`, vetted: BMAD, caveat: null,
    reason: 'A structured product-brief template and validation pass to feed the discovery brief.' },

  // ---- epic ----
  { step: 'epic', skill: 'bmad-prd', pool: 'bmad-method', licence: 'MIT', file: `${B}/bmm-skills/plan/bmad-prd/SKILL.md`, vetted: BMAD, caveat: null,
    reason: 'BMAD\'s product-manager workflow for writing and validating a PRD, the closest counterpart of the epic.' },
  { step: 'epic', skill: 'mattpocock-skills:grilling', pool: 'mattpocock-skills', licence: 'MIT', file: `${M}/productivity/grilling/SKILL.md`, vetted: MATT, caveat: null,
    reason: 'Questions the plan hard before the product manager writes it down.' },

  // ---- architecture: the design and the locked contract ----
  { step: 'architecture', skill: 'bmad-architecture', pool: 'bmad-method', licence: 'MIT', file: `${B}/bmm-skills/plan/bmad-architecture/SKILL.md`, vetted: BMAD, caveat: null,
    reason: 'Records the decisions that keep separately built parts consistent, which is this step\'s cross-repo concern.' },
  { step: 'architecture', skill: 'contract-first', pool: 'ecc', licence: 'MIT', file: `${E}/contract-first/SKILL.md`, vetted: ECC, caveat: ECC_PROFILE('developer'),
    reason: 'Puts the contract in a machine-checkable form (OpenAPI, AsyncAPI, Protobuf or JSON Schema) before it is locked.' },
  { step: 'architecture', skill: 'architecture-decision-records', pool: 'ecc', licence: 'MIT', file: `${E}/architecture-decision-records/SKILL.md`, vetted: ECC,
    caveat: 'It writes numbered records under docs/adr/ as well.',
    reason: 'Captures each architecture choice as a numbered decision record with the alternatives weighed.' },

  // ---- ui-design ----
  { step: 'ui-design', skill: 'bmad-ux', pool: 'bmad-method', licence: 'MIT', file: `${B}/bmm-skills/plan/bmad-ux/SKILL.md`, vetted: BMAD,
    caveat: 'It writes its own DESIGN.md, the file yad-ui writes last, so review that yad-ui kept what you want.',
    reason: 'BMAD\'s UX designer: how the product looks and how it behaves, the direct counterpart of this step.' },
  { step: 'ui-design', skill: 'accessibility', pool: 'ecc', licence: 'MIT', file: `${E}/accessibility/SKILL.md`, vetted: ECC, caveat: ECC_PROFILE('developer'),
    reason: 'Adds a WCAG 2.2 AA pass for web, iOS and Android to the design.' },

  // ---- stories ----
  { step: 'stories', skill: 'bmad-create-epics-and-stories', pool: 'bmad-method', licence: 'MIT', file: `${B}/bmm-skills/plan/bmad-create-epics-and-stories/SKILL.md`, vetted: BMAD, caveat: null,
    reason: 'BMAD\'s own breakdown of requirements into stories, as a first draft for yad-stories to file and tag by repo.' },

  // ---- test-cases ----
  { step: 'test-cases', skill: 'intent-driven-development', pool: 'ecc', licence: 'MIT', file: `${E}/intent-driven-development/SKILL.md`, vetted: ECC, caveat: null,
    reason: 'Turns stories into scoped, checkable acceptance criteria with a way to verify each, the raw material of test cases.' },

  // ---- implement: one small task ----
  { step: 'implement', skill: 'mattpocock-skills:tdd', pool: 'mattpocock-skills', licence: 'MIT', file: `${M}/engineering/tdd/SKILL.md`, vetted: MATT, caveat: null,
    reason: 'Red-green-refactor discipline inside the task\'s small diff.' },
  { step: 'implement', skill: 'tdd-workflow', pool: 'ecc', licence: 'MIT', file: `${E}/tdd-workflow/SKILL.md`, vetted: ECC, caveat: null,
    reason: 'Test-first work with a coverage target, for teams that want the number enforced as they go.' },
  { step: 'implement', skill: 'bmad-build', pool: 'bmad-method', licence: 'MIT', file: `${B}/bmm-skills/ship/bmad-build/SKILL.md`, vetted: BMAD,
    caveat: 'It aims to finish a whole story, so it can push past yad-implement\'s one task and three files; yad-implement still stops it there.',
    reason: 'BMAD\'s official implementation method, with its own review and verification steps.' },

  // ---- checks ----
  { step: 'checks', skill: 'verification-loop', pool: 'ecc', licence: 'MIT', file: `${E}/verification-loop/SKILL.md`, vetted: ECC, caveat: null,
    reason: 'Runs build, type check, lint, tests, a security search and a diff review locally, with a pass/fail report, before the CI gates run.' },

  // ---- engineer-review: a first pass before the human review is recorded ----
  { step: 'engineer-review', skill: 'bmad-code-review', pool: 'bmad-method', licence: 'MIT', file: `${B}/bmm-skills/ship/bmad-code-review/SKILL.md`, vetted: BMAD, caveat: null,
    reason: 'Several independent reviewers in parallel, then sorted findings, as a first pass before a person reviews.' },
  { step: 'engineer-review', skill: 'bmad-walkthrough', pool: 'bmad-method', licence: 'MIT', file: `${B}/bmm-skills/ship/bmad-walkthrough/SKILL.md`, vetted: BMAD, caveat: null,
    reason: 'Walks the human reviewer through what the change is for, what to look at, and how to test it.' },
]);

// ---- checking an entry ------------------------------------------------------------------------------

const POOLS = () => TOOLBOX.filter((t) => t.tier === 'recommended').map((t) => t.id);
const bindable = (step) => !!stepDef(step)?.skill && STEPS.some((s) => s.id === step);

// Every way an entry is malformed, as sentences; [] means it is well formed. The vetting record is
// checked by the toolbox's own `vettingProblems`, so one rule holds both lists.
export function recommendationProblems(r) {
  const out = [];
  const need = (ok, what) => { if (!ok) out.push(what); };
  need(typeof r?.step === 'string' && bindable(r.step), 'step is a step a skill runs (not a review gate)');
  need(typeof r?.skill === 'string' && /^[a-z0-9][a-z0-9:_-]*$/i.test(r.skill), 'skill is a skill name');
  need(POOLS().includes(r?.pool), `pool is one of the toolbox's recommended pools (${POOLS().join(', ')})`);
  need(typeof r?.reason === 'string' && r.reason.length > 0 && /\.$/.test(r.reason), 'reason is one sentence ending in a full stop');
  need(typeof r?.file === 'string' && /^https:\/\/[^/\s]+\/.+\/SKILL\.md$/.test(r.file), 'file is the https URL of the skill\'s SKILL.md');
  need(typeof r?.licence === 'string' && r.licence.length > 0, 'licence is set');
  need(r?.caveat === null || (typeof r?.caveat === 'string' && /\.$/.test(r.caveat)), 'caveat is null or one sentence ending in a full stop');
  for (const p of vettingProblems(r)) out.push(p);
  // The file must be read at the release the record names, so the name was checked at that tag.
  if (r?.vetted?.release && typeof r?.file === 'string') need(r.file.includes(`/${r.vetted.release}/`), 'file is read at vetted.release');
  return out;
}

// An entry seen through the toolbox's vetting helpers, which name a record by `id` and `name`.
export const asVetted = (r) => ({ ...r, id: `${r.step}:${r.skill}`, name: `${r.skill} for ${r.step}` });

// A digest of the list's content, so a test can hold each version to exactly one list.
export const catalogueDigest = (list = RECOMMENDATIONS) =>
  createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 16);

// How many whole days old the list is on `today` (a Date), counted in UTC like every record date.
export function catalogueAge(today = new Date(), checked = CATALOGUE.checked) {
  if (!isCalendarDay(checked)) return null;
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((day - Date.parse(`${checked}T00:00:00Z`)) / 86400000);
}

// "version 1, checked 2026-10-03 (12 days ago)" — said wherever the list is shown.
export function catalogueLabel(today = new Date()) {
  const age = catalogueAge(today);
  const ago = age === null ? '' : age <= 0 ? ' (today)' : age === 1 ? ' (1 day ago)' : ` (${age} days ago)`;
  return `recommendation catalogue version ${CATALOGUE.version}, checked ${CATALOGUE.checked}${ago}`;
}

// The recommendations for one step, in the list's order.
export const recommendationsFor = (step, list = RECOMMENDATIONS) => list.filter((r) => r.step === step);

// The chain a suggestion binds: the pool skill first, yadflow's own skill last (see the header).
export function suggestedChain(r) {
  const own = stepDef(r.step)?.skill;
  return own && own !== r.skill ? [r.skill, own] : [r.skill];
}

export function bindCommand(r, profile = null) {
  return `yad skill bind ${r.step} ${suggestedChain(r).join(' ')}${profile ? ` --profile ${profile}` : ''}`;
}

// ---- yad skill recommend -----------------------------------------------------------------------------

const poolName = (id) => TOOLBOX.find((t) => t.id === id)?.name ?? id;

// Is the BOUND name this catalogue pick? A team that installed a pool as a plugin binds
// `ecc:contract-first`, and that is the catalogue's bare `contract-first`. Only that direction: a pick the
// catalogue names WITH its plugin (`mattpocock-skills:tdd`) is matched exactly, because a bare `tdd` is
// just as likely a team's own skill (review 2) — matching it would hide the bind command from a team that
// never ran the pool's skill. These are the plugin spellings `installedSkillNames` also accepts — including
// `<plugin>@<marketplace>:<skill>`, whose marketplace part is dropped before the exact comparison.
const bareName = (s) => String(s).split(':').at(-1);
const withoutMarketplace = (s) => String(s).replace(/^([^:@]+)@[^:]+:/, '$1:');
export const sameSkill = (bound, pick) => withoutMarketplace(bound) === pick || (!pick.includes(':') && bareName(bound) === pick);

// One row per recommendation: what it is, whether the step already runs it, whether it is installed here.
// `bindings` is the view for the route shown; `names` is `installedSkillNames`' answer (null: unknown).
// `onRoute(step)` is false for a step the route never walks — `yad skill bind --profile` refuses those, so
// a command for one would be a command that fails.
export function recommendRows({ step = null, bindings, names, list = RECOMMENDATIONS, profile = null, onRoute = () => true }) {
  return list.filter((r) => (!step || r.step === step) && onRoute(r.step)).map((r) => {
    const running = stepSkills(r.step, bindings);
    const own = stepDef(r.step)?.skill;
    return {
      step: r.step, skill: r.skill, pool: r.pool, reason: r.reason, caveat: r.caveat, file: r.file, licence: r.licence,
      bound: running.some((s) => sameSkill(s, r.skill)),
      // Bound so that yadflow's own skill does not run LAST — in its place, or before it. Allowed (the
      // file wins), never quiet: the last output of a chain is the artifact (closed decision 7), so the
      // pool skill's output is then filed and yadflow's skill does not write it where the gate looks.
      // yadflow's own skill is compared exactly: yadflow ships no plugin, so it has no `<plugin>:` spelling.
      ownSkillDropped: running.some((s) => sameSkill(s, r.skill)) && !!own && running.at(-1) !== own,
      installed: names ? names.has(r.skill) : null,
      bind: suggestedChain(r),
      command: bindCommand(r, profile),
      vetted: r.vetted,
    };
  });
}

// The printer and --json answer of `yad skill recommend`. `yad skill` (cli/skill.mjs) works out the route
// and asks `yad detect` what is installed, then calls this.
export function showRecommendations(root, { step = null, json = false, route = { profile: null }, names = null, today = new Date(), onRoute = () => true } = {}) {
  if (step !== null && step !== undefined && !stepDef(step)?.skill) {
    // A review gate is a step, but no skill runs it, so nothing could be recommended for it — the same
    // reason `yad skill bind` refuses one.
    fail(stepDef(step) ? `\`${step}\` is a review gate — no skill runs it` : `\`${step}\` is not a step this yadflow runs`);
    hand(`steps with a recommendation: ${[...new Set(RECOMMENDATIONS.map((r) => r.step))].join(' · ') || '(none yet)'}`);
    process.exitCode = 1;
    return undefined;
  }
  if (step && !onRoute(step)) {
    fail(`route \`${route.profile}\` has no \`${step}\` step — nothing would ever run a binding there`);
    hand(`see \`yad skill recommend --profile ${route.profile}\` for the steps it walks`);
    process.exitCode = 1;
    return undefined;
  }
  const bindings = bindingsForProfile(loadSkillBindings(root), route.profile);
  const rows = recommendRows({ step, bindings, names, profile: route.profile, onRoute });
  const catalogue = { version: CATALOGUE.version, checked: CATALOGUE.checked, age: catalogueAge(today) };

  if (json) {
    return emitJSON({
      ok: true, catalogue, step: step ?? null, profile: route.profile, ...(route.epic ? { epic: route.epic } : {}),
      installedChecked: !!names, recommendations: rows,
    });
  }

  info(catalogueLabel(today));
  if (route.profile) info(`route ${c.bold(route.profile)}${route.epic ? ` (${route.epic})` : ''} — the bind commands apply to it only`);
  if (!rows.length) {
    info(step ? `no recommendation for ${c.bold(step)} — yadflow's own skill (${stepDef(step)?.skill ?? 'none'}) is the one to run`
      : route.profile ? `no recommendation for a step route ${route.profile} walks` : 'the catalogue is empty');
    return { rows };
  }
  let last = null;
  for (const r of rows) {
    if (r.step !== last) {
      log(`\n  ${c.bold(r.step)} ${c.dim(`— runs ${stepSkills(r.step, bindings).join(' → ') || '(none)'} now`)}`);
      last = r.step;
    }
    const mark = r.bound ? c.green('✓') : r.installed === false ? c.yellow('?') : '•';
    log(`  ${mark} ${c.bold(r.skill)} ${c.dim(`(${poolName(r.pool)}, ${r.licence})`)}`);
    log(`      ${r.reason}`);
    if (r.caveat) log(`      ${c.yellow('note:')} ${r.caveat}`);
    log(`      ${r.bound ? c.dim('already bound to this step') : c.cyan(r.command)}`);
    if (r.ownSkillDropped) {
      warn(`${r.step} runs ${r.skill} without ${stepDef(r.step).skill} last — the last skill's output is the artifact, so yadflow's skill does not file it where the gate looks (\`${r.command}\` chains them)`);
    }
  }
  log('');
  info('each one runs BEFORE yadflow\'s own skill, which still writes the artifact — every extra skill is another model run');
  if (rows.some((r) => r.bound)) info(`${c.green('✓')} = this step already runs it`);
  if (!names) warn('could not check which skills are installed here — `yad detect` could not read this folder or the home folder');
  else if (rows.some((r) => r.installed === false && !r.bound)) {
    info(`${c.yellow('?')} = not installed here — install its pool first (\`yad toolbox list\` shows how)`);
  }
  hand(`nothing is bound for you: run a command above to choose one, and \`yad skill unbind <step>${route.profile ? ` --profile ${route.profile}` : ''}\` to undo it`);
  return { rows };
}

// Exported for `yad skill list`: the skills the catalogue recommends for a step (names only). Empty for a
// step the route never walks — `recommend` hides those too, and a bind for one is refused.
export const recommendedSkills = (step, onRoute = () => true) => (onRoute(step) ? recommendationsFor(step).map((r) => r.skill) : []);
