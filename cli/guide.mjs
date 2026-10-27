// `yad guide` — the step brief an AI coding agent reads before each step (E157). Read-only.
//
// `yad next` says WHAT comes next. The guide adds what an agent needs to do it for a person without
// guessing: what the step is for, whether it is mandatory or can be skipped (and the skip command, which is
// the person's decision), who does the work, the skills and tools that fit, what the agent runs now, and
// what only the person can do, with the exact steps and the command that confirms it was done. It also
// carries the rules (cli/agent-rules.mjs), so an agent with no AGENTS.md yet still has them.
//
//   yad guide [--json]          the step to work on here
//   yad guide <epic> [--json]   that epic's step
//
// It never picks an epic for the person. With several open epics and none named (no epic argument, and
// not on a task branch), it lists them and says to ask which one.
//
// The facts come from the lifecycle default (`description`, `driver`, and a gate's `advance`, cli/lifecycle.mjs),
// the action from `nextAction` (the same answer `yad next --json` gives, whose keys are frozen), and
// where the person is from `yad status`. Text from the Product's own files passes through `forTerminal`:
// it reaches a model, and a control character there is never wanted.
import path from 'node:path';
import { c, log, info, hand, readJSON, forTerminal, exists } from './lib.mjs';
import { isVerifiedLedger, productConfigPath } from './manifest.mjs';
import { DEFAULT_LIFECYCLE, DRIVERS, GATE_SUFFIX } from './lifecycle.mjs';
import { PRODUCT_EPICS, epicRoot, isValidEpicId, loadLedger, optionalStepsFor, epicIds } from './epic-state.mjs';
import { epicAction, soloOf } from './next.mjs';
import { buildStatus } from './status.mjs';
import { recommendationsFor, bindCommand } from './recommend.mjs';
import { TOOLBOX } from './toolbox.mjs';
import { RULES, HUMAN_ONLY_ACTS, NEVER, classify, askFor } from './agent-rules.mjs';

export const GUIDE_VERSION = 1;

const clean = (s) => (typeof s === 'string' ? forTerminal(s) : s);

// The lifecycle's facts for one step id: an author or lane step by its own id, a gate by `<id>-review`.
// Null for an id the lifecycle does not define (a sentinel such as `ready-for-build`).
export function stepFacts(stepId, def = DEFAULT_LIFECYCLE) {
  const partOf = (phase) => def.phases.find((p) => p.id === phase)?.part ?? null;
  const own = def.steps.find((s) => s.id === stepId);
  if (own) {
    return { id: own.id, name: own.name, phase: own.phase, part: partOf(own.phase), kind: own.kind,
      description: own.description ?? null, driver: own.driver ?? null, gate: false, reviews: null };
  }
  if (typeof stepId === 'string' && stepId.endsWith(GATE_SUFFIX)) {
    const base = def.steps.find((s) => s.gate && `${s.id}${GATE_SUFFIX}` === stepId);
    if (base) {
      return { id: stepId, name: `${base.name} review`, phase: base.phase, part: partOf(base.phase), kind: 'review',
        description: base.gate.description ?? null, driver: 'human', advance: base.gate.advance ?? 'human', gate: true, reviews: base.id };
    }
  }
  return null;
}

// The Build phase, for an epic at `ready-for-build`: the step is the whole Build loop, its lanes below.
function buildFacts(def = DEFAULT_LIFECYCLE) {
  const ph = def.phases.find((p) => p.part === 'Build' && p.runs === 'loop');
  return ph ? { id: 'ready-for-build', name: ph.name, phase: ph.id, part: 'Build', kind: 'loop', description: ph.description ?? null, driver: null, gate: false, reviews: null } : null;
}

// The driver an epic records on a step (the shape-4 dial), when it records a word the lifecycle knows.
const recordedDriver = (state, stepId) => {
  const s = Array.isArray(state?.steps) ? state.steps.find((x) => x?.id === stepId) : null;
  return typeof s?.driver === 'string' && DRIVERS.includes(s.driver) ? s.driver : null;
};

// One command the agent runs, with what the rules let it do with it.
const agentRun = (line, why) => {
  const words = line.replace(/^yad\s+/, '').split(/\s+/);
  const flags = words.filter((w) => w.startsWith('--')).map((w) => w.slice(2).split('=')[0]);
  const cls = classify(words.filter((w) => !w.startsWith('-')).slice(0, 2), flags);
  return { run: line, class: cls, ask: askFor(cls), why };
};
const agentSkill = (skill, why) => ({ skill, class: 'local-write', ask: 'never', why });

// What only the person does, for a review gate, on this Product.
function reviewHandOff(a, { verified, platform, solo, epic }) {
  if (platform && platform !== 'none') {
    const what = platform === 'gitlab' ? 'merge request' : 'pull request';
    return [{
      act: 'approve-merge',
      why: 'an approval is a person\'s act: the record of who approved what rests on it',
      steps: [
        `Open the review ${what}${a.pr ? ` #${a.pr}` : ''} for ${a.artifact} on ${platform === 'gitlab' ? 'GitLab' : 'GitHub'}.`,
        solo ? 'Read it. In solo mode no approval is counted, so merging it is the decision.' : 'Read it, comment where needed, and approve it (each reviewer the gate asks for).',
        'Merge it when the checks pass.',
      ],
      commands: [],
      verify: `yad gate sync ${epic} ${a.artifact}`,
      ...(verified ? { note: 'On a verified Product, CI writes the ledger at the merge; `yad gate sync` only reads it back.' } : {}),
    }];
  }
  return [{
    act: 'approve-merge',
    why: 'an approval is a person\'s act: the record of who approved what rests on it',
    steps: [
      `Read ${a.artifact}.`,
      solo ? 'In solo mode no approval is counted: advance it when you are happy with it.' : 'Each reviewer records an approval under their own name.',
      'Then advance the step. In Claude Code, type the commands with a leading `!` so they run as you.',
    ],
    commands: [
      ...(solo ? [] : [`yad gate approve ${epic} ${a.artifact} --by "<your name>"`]),
      `yad gate advance ${epic} ${a.artifact}`,
    ],
    verify: `yad guide ${epic} --json`,
  }];
}

// The agent's commands and the person's steps for one action (the action kinds of `nextAction`).
export function playbook(a, ctx) {
  const epic = a.epicId;
  const skills = Array.isArray(a.skills) ? a.skills : a.skill ? [a.skill] : [];
  const runSkills = (why) => skills.map((s) => agentSkill(s, why));
  switch (a.kind) {
    case 'new':
      return {
        agent: runSkills('seed the epic: the skill asks the person what the change is, then writes epic.md and the ledger'),
        person: [{ act: 'answer', why: 'the epic is the person\'s change: the agent asks, never assumes', steps: ['Answer the agent\'s questions about the change.'], commands: [], verify: null }],
      };
    case 'author':
      return {
        agent: [
          ...runSkills(`write ${a.artifact}, asking the person every question only they can answer`),
          agentRun(`yad next ${epic} --check ${a.step}`, 'confirm the step may run now, before writing'),
        ],
        person: [{ act: 'answer', why: 'the artifact records the person\'s decisions', steps: ['Answer the agent\'s questions, and read the draft before it goes to review.'], commands: [], verify: null }],
      };
    case 'review-open':
      return {
        agent: [agentRun(a.command, 'open the review PR/MR for the artifact (its branch must be on origin; `yad open-pr` pushes it and opens the review)')],
        person: [],
      };
    case 'review-sync':
      return {
        agent: [agentRun(`yad gate sync ${epic} ${a.artifact}`, 'read the review\'s state back after the person acted; it advances the step only once the review passed')],
        person: reviewHandOff(a, { ...ctx, epic }),
      };
    case 'blocked':
      return {
        agent: [agentRun(`yad unblock ${epic} ${a.step}`, 'only after the person says the blocker is gone')],
        person: [{ act: 'unblock', why: 'the step waits on something outside the agent\'s reach', steps: [`Resolve the blocker${a.record?.reason ? `: ${clean(a.record.reason)}` : ''}, then tell the agent.`], commands: [], verify: `yad guide ${epic} --json` }],
      };
    case 'build':
      return {
        agent: [agentSkill('yad-run', 'drive the Build lanes one step at a time; it stops at every step a person must decide')],
        person: [{ act: 'approve-merge', why: 'the engineer review and every merge are a person\'s', steps: ['Review and merge each task PR/MR the agent opens.'], commands: [], verify: `yad build sync` }],
      };
    case 'foundation-done':
    case 'discovery-done':
      return {
        agent: [agentSkill('yad-epic', 'seed the next feature epic from the approved roadmap, once the person picks which item')],
        person: [{ act: 'choose', why: 'which roadmap item comes next is the person\'s call', steps: ['Pick the roadmap item to start.'], commands: [], verify: null }],
      };
    case 'backfill-pending':
      return { agent: [agentSkill('yad-backfill', 'document the code that already exists, then promote the anchor')], person: [] };
    case 'backfill-done':
      return { agent: [agentSkill('yad-change', 'thread a change or defect off the documented feature, when the person has one')], person: [] };
    default:
      return { agent: [agentRun(`yad next ${epic} --json`, 'read the action and follow its `why`')], person: [] };
  }
}

// The step block: the facts, mandatory or skippable, who does it, and the skills and tools that fit.
function stepBlock(a, state) {
  const facts = a.kind === 'build' ? buildFacts() : stepFacts(a.step);
  const authorId = facts?.gate ? facts.reviews : a.step;
  const optional = optionalStepsFor(state ?? {});
  const skippable = !!facts && facts.part === 'Shape' && optional.includes(authorId);
  const skills = Array.isArray(a.skills) ? a.skills : a.skill ? [a.skill] : [];
  const tools = TOOLBOX.filter((t) => Array.isArray(t.usedBy) && t.usedBy.some((u) => skills.includes(u)))
    .map((t) => ({ id: t.id, name: t.name, role: t.role, fallback: t.fallback ?? null }));
  return {
    epic: a.epicId,
    id: a.step ?? null,
    name: facts?.name ?? null,
    phase: facts?.phase ?? null,
    part: facts?.part ?? null,
    actionKind: a.kind,
    brief: facts?.description ?? null,
    mandatory: facts ? !skippable : null,
    skip: skippable ? { command: `yad skip ${a.epicId} ${authorId} --reason "<why>"`, decidedBy: 'human' } : null,
    driver: facts?.gate ? 'human' : recordedDriver(state, a.step) ?? facts?.driver ?? null,
    ...(facts?.gate ? { advance: facts.advance } : {}),
    status: a.status ?? null,
    artifact: a.artifact ?? null,
    why: clean(a.why ?? null),
    skills: {
      bound: skills,
      recommended: facts && !facts.gate ? recommendationsFor(authorId).map((r) => ({ skill: r.skill, why: r.reason, bind: bindCommand(r) })) : [],
    },
    tools,
    ...(a.parallel ? { parallel: { step: a.parallel.step, skill: a.parallel.skill ?? null, artifact: a.parallel.artifact ?? null } } : {}),
    ...(a.builds ? { lanes: lanesOf(a) } : {}),
  };
}

// Each Build lane: its step's facts, and whether a person moves it on (the epic's `advance` dial).
function lanesOf(a) {
  return (a.builds || []).flatMap((b) => (b.repos || []).map((r) => {
    const facts = stepFacts(r.step);
    return {
      story: b.story, repo: r.repo, step: r.step ?? null, status: r.status ?? null, shipped: !!r.shipped,
      brief: facts?.description ?? null, driver: facts?.driver ?? null,
      advance: r.automation === 'machine_advance' ? 'auto' : 'human',
      skill: r.skill ?? null,
      skip: r.shipped ? null : { command: `yad skip ${a.epicId} ${b.story} --repo ${r.repo} --reason "<why>"`, decidedBy: 'human', when: 'the story needs no change in this repo' },
    };
  }));
}

// The answer before any Product exists here. Agent-driven setup is E159; until then the person runs the
// setup command, which asks its questions in a terminal.
function noProduct() {
  return {
    stage: 'no-product',
    step: null,
    agent: [],
    person: [{
      act: 'choose',
      why: 'how yadflow is set up is the person\'s decision: ask, never assume',
      steps: [
        'Ask the person which applies: a new project (greenfield), existing code (brownfield), or joining a team that already uses yadflow.',
        'New project: `npx -y yadflow@4 new <name>`. Existing code: `npx -y yadflow@4 init` from the folder that holds the repos. Joining: `npx -y yadflow@4 join <the Product\'s git URL>`.',
        'These ask their questions in a terminal: the person runs the command in their own terminal, then tells the agent.',
      ],
      commands: ['npx -y yadflow@4 new <name>', 'npx -y yadflow@4 init', 'npx -y yadflow@4 join <url>'],
      verify: 'yad guide --json',
    }],
  };
}

// The Product's open epics with their next step, as `yad status` lists them, for "which one?".
const epicChoices = (m) => (m.epics || []).filter((e) => !e.problem).map((e) => ({ epic: e.epic, product: !!e.product, step: e.step, kind: e.kind, next: clean(e.next) }));

// Build the guide. `root` is the Product, or null when there is none here. `cwd` is where the agent is.
export function buildGuide(root, { epic = null, cwd = root ?? process.cwd(), runner } = {}) {
  const base = { guideVersion: GUIDE_VERSION, rules: RULES, humanOnly: HUMAN_ONLY_ACTS, never: NEVER };
  if (!root) return { ...base, situation: { stage: 'no-product', product: null }, ...noProduct(), then: 'run `yad guide --json` again once the Product exists' };
  const productConfig = readJSON(productConfigPath(root), null);
  const platform = typeof productConfig?.platform === 'string' ? productConfig.platform : null;
  const solo = soloOf(productConfig);
  const verified = isVerifiedLedger(productConfig);
  const m = buildStatus(root, { cwd, fetch: false, runner });
  const rel = path.relative(cwd, root) || '.';
  const situation = { stage: 'ready', product: rel, platform, ledger: platform && platform !== 'none' ? (verified ? 'verified' : 'local') : 'local', solo, here: m.here ?? null };
  if (!m.setUp) return { ...base, situation: { ...situation, stage: 'no-product' }, ...noProduct(), then: 'run `yad guide --json` again once the Product exists' };

  const ctx = { verified, platform, solo };
  const chosen = epic ?? m.here?.epic ?? null;
  if (chosen) {
    if (!isValidEpicId(chosen) || !exists(path.join(epicRoot(root, chosen), '.sdlc', 'state.json'))) {
      return { ...base, situation: { ...situation, stage: 'ready' }, error: `no epic ${clean(chosen)} here`, epics: epicChoices(m), step: null, agent: [], person: [], then: 'ask the person which epic they mean' };
    }
    const { action } = epicAction(root, chosen);
    const state = loadLedger(epicRoot(root, chosen))?.state ?? null;
    const { agent, person } = playbook(action, ctx);
    return { ...base, situation: { ...situation, stage: 'in-epic' }, step: stepBlock(action, state), agent, person,
      then: person.length ? 'wait for the person to say it is done, then run the `verify` command; never go on from their word alone' : `run \`yad guide ${chosen} --json\` again after this step` };
  }
  const open = epicChoices(m);
  if (open.length > 1) {
    return { ...base, situation: { ...situation, stage: 'choose-epic' }, epics: open, step: null, agent: [],
      person: [{ act: 'choose', why: 'several epics are open; which to work on is the person\'s call', steps: ['Pick the epic to work on.'], commands: [], verify: null }],
      then: 'run `yad guide <epic> --json` for the epic the person picked' };
  }
  if (open.length === 1) return buildGuide(root, { epic: open[0].epic, cwd, runner });
  // Nothing open: the Foundation (optional) or the first epic.
  const brownfield = productConfig?.profile?.codebase === 'brownfield';
  const hasFoundation = epicIds(root).some((id) => PRODUCT_EPICS.includes(id));
  return { ...base, situation, step: null,
    agent: [
      ...(brownfield ? [agentSkill('yad-backfill', 'existing code: document what is already built first, so new epics can thread off it')] : []),
      ...(hasFoundation ? [] : [{ ...agentRun('yad foundation new', 'frame the whole product once (purpose, scope, MVP, roadmap, stack), then run its skill'), optional: true }]),
      agentSkill('yad-epic', 'start the first feature epic, from what the person wants built'),
    ],
    person: [{ act: 'choose', why: 'what to build first is the person\'s call', steps: [hasFoundation ? 'Say which roadmap item to start.' : 'Say whether to write the Foundation first (optional), and what the first epic is.'], commands: [], verify: null }],
    then: 'run `yad guide --json` again once the epic exists' };
}

// The printed form: the brief a person would read, in the order the agent would say it.
export function printGuide(g) {
  const s = g.step;
  if (s) {
    log(`\n  ${c.bold(`${s.epic} · ${s.name ?? s.id}`)}${s.part ? c.dim(`  (${s.part}${s.phase ? ` · ${s.phase}` : ''})`) : ''}`);
    if (s.brief) info(s.brief);
    if (s.mandatory === true) info(c.dim('mandatory'));
    else if (s.mandatory === false) info(c.dim(`can be skipped — the person decides: ${s.skip.command}`));
    if (s.driver) info(c.dim(`who: ${s.driver === 'pair' ? 'the agent drafts, the person decides' : s.driver === 'agent' ? 'the agent' : 'a person'}`));
    if (s.why) info(c.dim(s.why));
  } else if (g.situation?.stage === 'choose-epic') {
    log(`\n  ${c.bold('Several epics are open:')}`);
    for (const e of g.epics) info(`${e.epic}  ${c.dim(e.next ?? '')}`);
  } else if (g.situation?.stage === 'no-product') {
    log(`\n  ${c.bold('No yadflow Product here yet.')}`);
  }
  for (const a of g.agent || []) hand(`${a.run ? c.bold(a.run) : `the ${c.bold(a.skill)} skill`} ${c.dim(`— ${a.why}`)}`);
  for (const p of g.person || []) {
    info(`${c.bold('person:')} ${p.why}`);
    for (const st of p.steps) info(`  ${st}`);
    for (const cmd of p.commands) info(`  ${c.bold(cmd)}`);
  }
  if (g.then) info(c.dim(`then: ${g.then}`));
}

export async function runGuide(root, { epic = null, cwd, json = false, runner } = {}) {
  const g = buildGuide(root, { epic, cwd, runner });
  if (json) return g;
  printGuide(g);
  return undefined;
}
