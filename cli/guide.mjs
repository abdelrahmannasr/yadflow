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
import { PROJECT_FILES, VERSION, isVerifiedLedger, productConfigPath } from './manifest.mjs';
import { DEFAULT_LIFECYCLE, DRIVERS, GATE_SUFFIX } from './lifecycle.mjs';
import { PRODUCT_EPICS, artifactBase, epicRoot, isValidEpicId, isPassed, loadLedger, optionalStepsFor, epicIds } from './epic-state.mjs';
import { epicAction, soloOf } from './next.mjs';
import { buildStatus } from './status.mjs';
import { recommendationsFor, bindCommand } from './recommend.mjs';
import { TOOLBOX, parseVersion, compare as compareVersions } from './toolbox.mjs';
import { productGit, resolveDefaultBranch } from './productcommit.mjs';
import { updateBranchName } from './update-commit.mjs';
import { RULES, HUMAN_ONLY_ACTS, NEVER, classify, askFor, reaches } from './agent-rules.mjs';
import { seededSlugs } from './hook.mjs';

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

// A word read from the ledger that goes into a command the agent or the person will type: a plain path or
// id, or the placeholder. Anything else (a space, a quote, a `;`) never reaches a command line.
export const tok = (x, placeholder) => (typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(x.replace(/_/g, '-')) && !x.split('/').includes('..') ? x : placeholder);

// A folder for a command line: as it is when it is a plain path, else in single quotes (nothing inside them
// is expanded, `!` included), a `'` written as `'\''`.
const shellPath = (p) => (/^[A-Za-z0-9._/~-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);

// One command the agent runs, with what the rules let it do with it.
export const agentRun = (line, why) => {
  const words = line.replace(/^yad\s+/, '').split(/\s+/);
  const flags = words.filter((w) => w.startsWith('--')).map((w) => w.slice(2).split('=')[0]);
  const cmd = words.filter((w) => !w.startsWith('-')).slice(0, 2);
  const cls = classify(cmd, flags);
  // A flag that needs the person to have asked, under a stronger class (a push): said, never dropped.
  const onRequest = cls !== 'on-request' && cls !== 'human-only' && reaches(cmd, flags).includes('on-request');
  return { run: line, class: cls, ask: askFor(cls), ...(onRequest ? { onRequest: true } : {}), why };
};
// A skill the agent runs. Its class is what the skill does at most: `yad-run` opens task PRs/MRs.
const agentSkill = (skill, why, cls = 'local-write') => ({ skill: clean(skill), class: cls, ask: askFor(cls), why });

const WHY_APPROVAL = 'an approval is a person\'s act: the record of who approved what rests on it';

// What only the person does, for a review gate, on this Product. `opening`: the review is not open yet,
// so the person acts once the agent has opened it.
function reviewHandOff(a, { verified, platform, solo, epic, opening = false }) {
  const art = tok(a.artifact, '<artifact>');
  if (platform) {
    const what = platform === 'gitlab' ? 'merge request' : 'pull request';
    return [{
      act: 'approve-merge',
      why: WHY_APPROVAL,
      steps: [
        `${opening ? 'Once the agent has opened it, open' : 'Open'} the review ${what}${a.pr ? ` #${a.pr}` : ''} for ${art} on ${platform === 'gitlab' ? 'GitLab' : 'GitHub'}.`,
        solo ? 'Read it. In solo mode no approval is counted, so merging it is the decision.' : 'Read it, comment where needed, and approve it (each reviewer the gate asks for).',
        'Merge it when the checks pass.',
        ...(verified ? ['On a verified Product, CI writes the approval into the ledger at the merge: the agent then pulls the Product\'s default branch to see it.'] : []),
      ],
      commands: [],
      verify: `yad gate sync ${epic} ${art}`,
    }];
  }
  return [{
    act: 'approve-merge',
    why: WHY_APPROVAL,
    steps: [
      `${opening ? 'Once the agent has marked the review open, read' : 'Read'} ${art}.`,
      solo ? 'In solo mode no approval is counted: advance it when you are happy with it.' : 'Each reviewer records an approval under their own name.',
      'Then advance the step. In Claude Code, type the commands with a leading `!` so they run as you.',
    ],
    commands: [
      ...(solo ? [] : [`yad gate approve ${epic} ${art} --by "<your name>"`]),
      `yad gate advance ${epic} ${art}`,
    ],
    verify: `yad guide ${epic} --json`,
  }];
}

// A review gate: what the agent runs and what the person does. With no platform, `yad gate open` only marks
// the review open here, and the review stays a `review-open` action until the person advances it: once it
// is open there is nothing left for the agent to run. On a verified Product the PR/MR is recorded only at the
// merge, so the review stays `review-open` while it is open: the agent opens it once.
function reviewWork(a, ctx, epic, also = null) {
  const art = tok(a.artifact, '<artifact>');
  const add = (w) => (also ? `${also}: ${w}` : w);
  if (a.kind === 'review-sync') {
    return {
      agent: [agentRun(`yad gate sync ${epic} ${art}`, add('read the review\'s state back after the person acted; it advances the step only once the review passed'))],
      person: reviewHandOff(a, { ...ctx, epic }),
    };
  }
  const branch = `review/${epic}/${tok(artifactBase(String(a.artifact ?? '')), '<artifact>')}`;
  return {
    agent: !ctx.platform && a.status === 'in_review' ? []
      : [agentRun(`yad gate open ${epic} ${art}`, add(ctx.platform
        ? `open the review PR/MR. Its branch \`${branch}\` must be on origin first: it is the agent's own branch, so push it (\`git push -u origin ${branch}\`); \`yad gate open\` never pushes it. If the review is already open, do not open another: \`yad gate sync\` finds it from the review branch`
        : 'mark the review open; with no platform nothing leaves this machine'))],
    person: reviewHandOff(a, { ...ctx, epic, opening: !!ctx.platform || a.status !== 'in_review' }),
  };
}

// Two cautions for a skip or an unblock on a verified Product, where CI owns an epic's ledger once its first
// review PR/MR merges. UNREAD: origin cannot be read, so nobody can tell (`yad skip` and `yad unblock` warn
// the same, cli/skip.mjs). ASFETCHED: the ledger is not on origin as last fetched, and the fetch may be
// behind a review that merged since (`yad skip` says so; `yad unblock` does not, so the guide does).
const UNREAD = 'origin could not be read, so it is not known whether CI already owns this epic\'s ledger; if its first review PR/MR has merged, the command is refused';
const ASFETCHED = 'checked against origin as last fetched: run `git fetch origin` first if the epic\'s first review PR/MR may have merged, because CI then owns its ledger and the command is refused';

// A blocked step: the person resolves it, and the agent clears it only when asked. On a verified Product
// `yad unblock` refuses once the epic's ledger is on the default branch, and CI has no step for it yet (the
// same words `yad next` prints). Before that, the ledger is still the person's to write.
function blockedWork(a, ctx, epic, also = null) {
  const reason = a.record?.reason ? `: ${clean(a.record.reason)}` : '';
  const why = also ? `${also}, and is blocked` : 'the step waits on something outside the agent\'s reach';
  if (ctx.ciOwns) {
    return { agent: [], person: [{ act: 'unblock', why, steps: [`Resolve the blocker${reason}.`, 'On a verified Product only CI can clear it once the epic\'s ledger is on the default branch, and CI has no step for that yet (`yad unblock` refuses). Decide with the team how to go on.'], commands: [], verify: null }] };
  }
  return {
    agent: [agentRun(`yad unblock ${epic} ${tok(a.step, '<step>')}`, `only after the person says the blocker is gone and asks to clear it${ctx.originAsFetched ? `; ${ASFETCHED}` : ctx.originUnread ? `; ${UNREAD}` : ''}`)],
    person: [{ act: 'unblock', why, steps: [`Resolve the blocker${reason}, then tell the agent to clear it.`], commands: [], verify: `yad guide ${epic} --json` }],
  };
}

// The agent's commands and the person's steps for one action (the action kinds of `nextAction`).
export function playbook(a, ctx) {
  const epic = a.epicId;
  const art = tok(a.artifact, '<artifact>');
  const step = tok(a.step, '<step>');
  const skills = Array.isArray(a.skills) ? a.skills : a.skill ? [a.skill] : [];
  const runSkills = (why) => skills.map((s) => agentSkill(s, why));
  const base = (() => {
    switch (a.kind) {
      case 'new':
        return {
          agent: runSkills('seed the epic: the skill asks the person what the change is, then writes epic.md and the ledger'),
          person: [{ act: 'answer', why: 'the epic is the person\'s change: the agent asks, never assumes', steps: ['Answer the agent\'s questions about the change.'], commands: [], verify: null }],
        };
      case 'author':
        return {
          agent: [
            agentRun(`yad next ${epic} --check ${step}`, 'confirm the step may run now, before writing'),
            ...runSkills(`write ${art}, asking the person every question only they can answer`),
          ],
          person: [{ act: 'answer', why: 'the artifact records the person\'s decisions', steps: ['Answer the agent\'s questions, and read the draft before it goes to review.'], commands: [], verify: null }],
        };
      case 'review-open':
      case 'review-sync':
        return reviewWork(a, ctx, epic);
      case 'blocked':
        return blockedWork(a, ctx, epic);
      case 'build': {
        // A lane yad-run halted (`blocked`) waits for the person, like a blocked Shape step.
        const halted = (a.builds || []).flatMap((b) => (b.repos || []).filter((r) => r.status === 'blocked').map((r) => ({
          act: 'unblock',
          why: 'yad-run halted this Build step: a person must resolve it',
          // The lane summary carries no record for a halted step (its keys are frozen); the build-state does.
          steps: [`Resolve the halt on ${tok(b.story, '<story>')} in ${tok(r.repo, '<repo>')} (${tok(r.step, '<step>')})${(() => { const why = ctx.haltReason?.(b.story, r.repo, r.step); return why ? `: ${clean(why)}` : ''; })()}, then tell the agent to move it on.`],
          commands: [],
          verify: `yad guide ${epic} --json`,
        })));
        return {
          agent: [agentSkill('yad-run', 'drive the Build lanes one step at a time; it stops at every step a person must decide, and asks before opening a task PR/MR unless `yad dial open-pr` is `auto`', 'task-pr')],
          person: [...halted, { act: 'approve-merge', why: 'the engineer review and every merge are a person\'s', steps: ['Review and merge each task PR/MR the agent opens.'], commands: [], verify: 'yad build sync' }],
        };
      }
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
  })();
  // Work open beside the chain's own step: the test-cases track, and steps re-opened behind finished work.
  const beside = [];
  if (a.parallel?.skill) beside.push(agentSkill(a.parallel.skill, `the ${tok(a.parallel.step, 'parallel')} track runs beside this step: write ${tok(a.parallel.artifact, 'its artifact')}`));
  const besidePerson = [];
  for (const l of Array.isArray(a.reopened) ? a.reopened : []) {
    const ls = tok(l?.step, '<step>');
    const why = `${ls} was re-opened behind finished work`;
    if (l?.kind === 'author') {
      const chain = Array.isArray(l.skills) ? l.skills : l.skill ? [l.skill] : [];
      for (const sk of chain) beside.push(agentSkill(sk, `${why}: write ${tok(l.artifact, 'its artifact')} again`));
    } else if (l?.kind === 'review-open' || l?.kind === 'review-sync') {
      const w = reviewWork({ ...l, epicId: epic }, ctx, epic, why);
      beside.push(...w.agent);
      besidePerson.push(...w.person);
    } else if (l?.kind === 'blocked') {
      const w = blockedWork(l, ctx, epic, why);
      beside.push(...w.agent);
      besidePerson.push(...w.person);
    }
  }
  return { agent: [...base.agent, ...beside], person: [...base.person, ...besidePerson] };
}

// The step block: the facts, mandatory or skippable, who does it, and the skills and tools that fit.
function stepBlock(a, state, ctx = {}) {
  const facts = a.kind === 'build' ? buildFacts() : stepFacts(a.step);
  const authorId = facts?.gate ? facts.reviews : a.step;
  const author = Array.isArray(state?.steps) ? state.steps.find((s) => s?.id === authorId) : null;
  // A step may be skipped only on a route that marks it optional, and only while it is not written yet:
  // `yad skip` refuses an authored step.
  const skippable = !!facts && facts.part === 'Shape' && optionalStepsFor(state ?? {}).includes(authorId) && !(author && isPassed(author));
  // The Foundation is the Product level: optional for the Product, so neither mandatory nor skippable here.
  const productLevel = !!facts && facts.part === null && a.kind !== 'build';
  const skills = (Array.isArray(a.skills) ? a.skills : a.skill ? [a.skill] : []).map(clean);
  const tools = TOOLBOX.filter((t) => Array.isArray(t.usedBy) && t.usedBy.some((u) => skills.includes(u)))
    .map((t) => ({ id: t.id, name: t.name, role: t.role, fallback: t.fallback ?? null }));
  return {
    epic: a.epicId,
    id: clean(a.step ?? null),
    name: facts?.name ?? null,
    phase: facts?.phase ?? null,
    part: facts?.part ?? null,
    actionKind: a.kind,
    brief: facts?.description ?? null,
    mandatory: !facts || productLevel ? null : !skippable,
    // On a verified Product whose ledger CI already owns, `yad skip` refuses (cli/skip.mjs): said, not offered.
    skip: !skippable ? null : ctx.ciOwns
      ? { command: null, decidedBy: 'human', note: 'on this verified Product the epic\'s ledger is on the default branch, and only CI writes it; CI has no step for a skip yet (`yad skip` refuses)' }
      : { command: `yad skip ${a.epicId} ${tok(authorId, '<step>')} --reason "<why>"`, decidedBy: 'human',
        // `yad skip` warns the same way when it cannot read origin (cli/skip.mjs).
        ...(ctx.originUnread ? { note: UNREAD } : {}),
        ...(ctx.originAsFetched ? { note: ASFETCHED } : {}) },
    driver: facts?.gate ? 'human' : recordedDriver(state, a.step) ?? facts?.driver ?? null,
    ...(facts?.gate ? { advance: facts.advance } : {}),
    status: clean(a.status ?? null),
    artifact: clean(a.artifact ?? null),
    why: clean(a.why ?? null),
    skills: {
      bound: skills,
      recommended: facts && !facts.gate ? recommendationsFor(authorId).map((r) => ({ skill: r.skill, why: r.reason, bind: bindCommand(r), decidedBy: 'human' })) : [],
    },
    tools,
    ...(a.parallel ? { parallel: { step: clean(a.parallel.step), skill: clean(a.parallel.skill ?? null), artifact: clean(a.parallel.artifact ?? null) } } : {}),
    ...(Array.isArray(a.reopened) && a.reopened.length ? { reopened: a.reopened.map((l) => ({ step: clean(l?.step ?? null), kind: l?.kind ?? null, status: clean(l?.status ?? null) })) } : {}),
    ...(Array.isArray(a.debt) && a.debt.length ? { debt: a.debt.map((d) => ({ step: clean(d?.step ?? null), status: clean(d?.status ?? null) })) } : {}),
    ...(a.builds ? { lanes: lanesOf(a) } : {}),
  };
}

// Each Build lane: its step's facts, and whether a person moves it on (the epic's `advance` dial).
function lanesOf(a) {
  return (a.builds || []).flatMap((b) => (b.repos || []).map((r) => {
    const facts = stepFacts(r.step);
    const open = !r.shipped && r.status !== 'skipped';
    return {
      story: clean(b.story), repo: clean(r.repo), step: clean(r.step ?? null), status: clean(r.status ?? null), shipped: !!r.shipped,
      brief: facts?.description ?? null, driver: facts?.driver ?? null,
      advance: r.automation === 'machine_advance' ? 'auto' : 'human',
      skill: clean(r.skill ?? null),
      skip: open ? { command: `yad skip ${a.epicId} ${tok(b.story, '<story>')} --repo ${tok(r.repo, '<repo>')} --reason "<why>"`, decidedBy: 'human', when: 'the story needs no change in this repo' } : null,
    };
  }));
}

// The answer before any Product exists here. Agent-driven setup is E159; until then the person runs the
// setup command, which asks its questions in a terminal.
function noProduct() {
  return {
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
    then: 'run `yad guide --json` again once the Product exists',
  };
}

// Is the Product's install behind this yadflow? Its stamp (`.sdlc/cli-version.json`) names the version that
// last wrote the managed files. Behind: `yad update --open-pr` brings them up, one PR/MR per repo (the
// person's choice, 2026-10-27). Ahead (an older yadflow here) is `yad`'s own warning, not upkeep.
//
// The working tree's stamp alone would loop: `--open-pr` leaves the default branch as it was until the
// PR/MR merges. So it also asks git (no network): is the update branch already here or on origin as last
// fetched (on review), and does origin's default branch already carry the new stamp (merged, not pulled)?
const behindOf = (stamped, running) => {
  const a = parseVersion(stamped);
  const b = parseVersion(running);
  return a && b ? compareVersions(a, b) < 0 : null;
};
export function installState(root, running = VERSION, { defaultBranch = null } = {}) {
  const stamped = readJSON(path.join(root, PROJECT_FILES.version), null)?.version;
  const behind = behindOf(stamped, running);
  const state = { project: typeof stamped === 'string' ? clean(stamped) : null, yadflow: running, behind };
  if (!behind) return state;
  const git = productGit(root);
  if (!git('rev-parse', '--git-dir').ok) return { ...state, onReview: false, merged: false, origin: false };
  const head = updateBranchName(running);
  const origin = git('remote', 'get-url', 'origin').ok;
  const onReview = git('rev-parse', '--verify', '--quiet', `refs/heads/${head}`).ok
    || git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${head}`).ok;
  const base = defaultBranch || resolveDefaultBranch(git);
  const shown = git('show', `refs/remotes/origin/${base}:${PROJECT_FILES.version}`);
  const originStamp = (() => { try { return shown.ok ? JSON.parse(shown.stdout)?.version : null; } catch { return null; } })();
  const merged = typeof originStamp === 'string' && behindOf(originStamp, running) === false;
  return { ...state, onReview, merged, origin };
}

function upkeepFor(install, { platform }) {
  if (!install.behind) return null;
  if (install.merged) {
    return {
      agent: [{ run: 'git pull --ff-only', class: 'local-write', ask: 'never', why: `the update to v${install.yadflow} is on origin's default branch already: bring this clone up to date. If it says the tree has local changes, stop and ask the person` }],
      person: [],
    };
  }
  if (install.onReview) {
    return {
      agent: [],
      person: [{ act: 'approve-merge', why: 'the update is already on review: it lands through its PR/MR', steps: ['Merge each open `chore(yad-update)` PR/MR once its checks pass.', 'Then pull the default branch in each repo (the agent can, once you say they are merged).'], commands: [], verify: 'yad guide --json' }],
    };
  }
  if (!platform || !install.origin) {
    return {
      agent: [],
      person: [{ act: 'choose', why: `there is ${install.origin ? 'no platform' : 'no origin remote'} to open an update PR/MR on, so how it is published is the person's call`, steps: ['Run `yad update`, then commit and share the changes the way this team does.'], commands: ['yad update'], verify: 'yad guide --json' }],
    };
  }
  return {
    agent: [agentRun('yad update --open-pr', `the managed files were written by yadflow v${install.project} and this is v${install.yadflow}: bring them up to date on a branch in each repo and open a PR/MR for each. Do this before the step below. A repo it skips is said, with why`)],
    person: [{ act: 'approve-merge', why: 'the update lands through review, like any change', steps: ['Merge each `chore(yad-update)` PR/MR once its checks pass.', 'Then pull the default branch in each repo.'], commands: [], verify: 'yad guide --json' }],
  };
}

// The Product's open epics with their next step, as `yad status` lists them, for "which one?".
const epicChoices = (m) => (m.epics || []).filter((e) => !e.problem).map((e) => ({ epic: e.epic, product: !!e.product, step: e.step, kind: e.kind, next: clean(e.next) }));

// An epic whose ledger does not load: the answer is `yad doctor`, never "start another epic".
const broken = (base, situation, problems, epics = []) => ({
  ...base, situation: { ...situation, stage: 'broken' }, problems, epics, step: null,
  agent: [agentRun('yad doctor', 'find what is wrong with the ledger; it names the fix')],
  person: [{ act: 'choose', why: 'a ledger that does not load is not fixed by guessing', steps: ['Read what `yad doctor` reports with the agent, and decide the fix.', ...(epics.length ? ['Or pick one of the other open epics to work on meanwhile (`yad guide <epic> --json`).'] : [])], commands: [], verify: 'yad guide --json' }],
  then: 'run `yad guide --json` again once `yad doctor` is clean',
});

const thenFor = (person, epic) => (person.some((p) => p.verify)
  ? 'wait for the person to say it is done, then run the `verify` command; never go on from their word alone'
  : person.length ? `wait for the person's answer, then go on; run \`yad guide ${epic} --json\` again after this step`
    : `run \`yad guide ${epic} --json\` again after this step`);

// Build the guide. `root` is the Product, or null when there is none here. `cwd` is where the agent is.
// `productElsewhere`: no Product here, but one is a `cd` away (bin/yad.mjs finds it).
export function buildGuide(root, { epic = null, cwd = root ?? process.cwd(), runner, productElsewhere = null } = {}) {
  const base = { guideVersion: GUIDE_VERSION, rules: RULES, humanOnly: HUMAN_ONLY_ACTS, never: NEVER };
  if (!root && productElsewhere) {
    const where = clean(productElsewhere);
    const q = shellPath(where);
    return { ...base, situation: { stage: 'product-elsewhere', product: where }, step: null,
      agent: [agentRun(`yad guide --dir ${q} --json`, 'the Product is one folder away: read it from there, never start a second one')],
      person: [], then: `work from the Product (cd ${q}), or pass --dir ${q}` };
  }
  if (!root) return { ...base, situation: { stage: 'no-product', product: null }, ...noProduct() };
  const productConfig = readJSON(productConfigPath(root), null);
  const platform = typeof productConfig?.platform === 'string' && productConfig.platform ? productConfig.platform : null;
  const solo = soloOf(productConfig);
  const verified = isVerifiedLedger(productConfig);
  const m = buildStatus(root, { cwd, fetch: false, runner });
  const rel = path.relative(cwd, root) || '.';
  const install = installState(root, VERSION, { defaultBranch: productConfig?.default_branch ?? null });
  const situation = { stage: 'ready', product: rel, platform, ledger: platform && verified ? 'verified' : 'local', solo, here: m.here ?? null, install };
  if (!m.setUp) return { ...base, situation: { ...situation, stage: 'no-product' }, ...noProduct() };
  // Upkeep rides every answer about this Product until it is done.
  base.upkeep = upkeepFor(install, { platform });

  const ctx = { verified, platform, solo };
  const chosen = epic ?? m.here?.epic ?? null;
  if (chosen) {
    if (!isValidEpicId(chosen) || !exists(path.join(epicRoot(root, chosen), '.sdlc', 'state.json'))) {
      return { ...base, ok: false, error: `no epic ${clean(chosen)} here`, code: null, hint: 'ask the person which epic they mean; `epics` lists the open ones',
        situation: { ...situation, stage: 'unknown-epic' }, epics: epicChoices(m), step: null, agent: [], person: [], then: 'ask the person which epic they mean' };
    }
    let state;
    let action;
    let ledger;
    try {
      ledger = loadLedger(epicRoot(root, chosen));
      state = ledger?.state;
      if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.steps)) throw new Error('its state.json is not a ledger');
      ({ action } = epicAction(root, chosen));
    } catch {
      return broken(base, situation, [{ epic: chosen, problem: 'its ledger does not load — run `yad doctor`' }]);
    }
    // Does CI already own this epic's ledger (verified, and the ledger is on origin's default branch)? The
    // same read `yad skip` and `yad unblock` make (cli/skip.mjs). Unknown (origin not read) is not "yes".
    const seeded = verified ? seededSlugs(root, productConfig, runner) : null;
    // `originAsFetched`: read from origin as last fetched, which may be behind the platform.
    // Why yad-run halted a Build step: read from the build-state, where the skill records it.
    const haltReason = (story, repo, step) => {
      const bs = (ledger?.buildStates || []).find((b) => b?.story === story);
      const steps = bs?.repos?.[repo]?.steps;
      const st = Array.isArray(steps) ? steps.find((x) => x?.id === step) : null;
      return typeof st?.record?.reason === 'string' ? st.record.reason : null;
    };
    const ectx = { ...ctx, haltReason, ciOwns: !!seeded && seeded.has(chosen.toLowerCase()), originUnread: verified && seeded === null, originAsFetched: !!seeded && !seeded.has(chosen.toLowerCase()) };
    const { agent, person } = playbook(action, ectx);
    return { ...base, situation: { ...situation, stage: 'in-epic' }, step: stepBlock(action, state, ectx), agent, person, then: thenFor(person, chosen) };
  }
  const problems = (m.epics || []).filter((e) => e.problem).map((e) => ({ epic: e.epic, problem: clean(e.problem) }));
  if (problems.length) return broken(base, situation, problems, epicChoices(m));
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
      ...(hasFoundation ? [] : [{ ...agentRun('yad foundation new', 'only once the person says they want the Foundation: frame the whole product once (purpose, scope, MVP, roadmap, stack), then run its skill'), optional: true }]),
      agentSkill('yad-epic', 'start the first feature epic, from what the person wants built'),
    ],
    person: [{ act: 'choose', why: 'what to build first is the person\'s call', steps: [hasFoundation ? 'Say which roadmap item to start.' : 'Say whether to write the Foundation first (optional), and what the first epic is.'], commands: [], verify: null }],
    then: 'run `yad guide --json` again once the epic exists' };
}

// The printed form: the brief a person would read, in the order the agent would say it.
export function printGuide(g) {
  const s = g.step;
  if (g.upkeep) {
    log(`\n  ${c.bold(`Upkeep first: this Product's yadflow files are v${g.situation.install.project}, yadflow is v${g.situation.install.yadflow}.`)}`);
    for (const a of g.upkeep.agent) hand(`${c.bold(a.run)} ${c.dim(`— ${a.why}`)}`);
    for (const p of g.upkeep.person) for (const st of p.steps) info(st);
  }
  if (s) {
    log(`\n  ${c.bold(`${s.epic} · ${s.name ?? s.id}`)}${s.part ? c.dim(`  (${s.part}${s.phase ? ` · ${s.phase}` : ''})`) : ''}`);
    if (s.brief) info(s.brief);
    if (s.mandatory === true) info(c.dim('mandatory'));
    else if (s.mandatory === false) info(c.dim(s.skip?.command ? `can be skipped — the person decides: ${s.skip.command}${s.skip.note ? ` (${s.skip.note})` : ''}` : `optional, but it cannot be skipped here: ${s.skip?.note ?? ''}`));
    else if (s.name && !s.part) info(c.dim('the Product level: optional for the Product; once started, it is finished and reviewed'));
    if (s.driver) info(c.dim(`who: ${s.driver === 'pair' ? 'the agent drafts, the person decides' : s.driver === 'agent' ? 'the agent' : 'a person'}`));
    if (s.why) info(c.dim(s.why));
  } else if (g.situation?.stage === 'choose-epic') {
    log(`\n  ${c.bold('Several epics are open:')}`);
    for (const e of g.epics) info(`${e.epic}  ${c.dim(e.next ?? '')}`);
  } else if (g.situation?.stage === 'no-product') {
    log(`\n  ${c.bold('No yadflow Product here yet.')}`);
  } else if (g.situation?.stage === 'unknown-epic') {
    log(`\n  ${c.bold(g.error)}`);
    if (g.epics.length) {
      info('The open epics:');
      for (const e of g.epics) info(`${e.epic}  ${c.dim(e.next ?? '')}`);
    } else info('No epic is open.');
  } else if (g.situation?.stage === 'product-elsewhere') {
    log(`\n  ${c.bold(`The Product is at ${g.situation.product}.`)}`);
  } else if (g.situation?.stage === 'broken') {
    log(`\n  ${c.bold('An epic\'s ledger does not load:')}`);
    for (const e of g.problems) info(`${e.epic}  ${c.dim(e.problem)}`);
  }
  for (const a of g.agent || []) hand(`${a.run ? c.bold(a.run) : `the ${c.bold(a.skill)} skill`} ${c.dim(`— ${a.why}`)}`);
  for (const p of g.person || []) {
    info(`${c.bold('person:')} ${p.why}`);
    for (const st of p.steps) info(`  ${st}`);
    for (const cmd of p.commands) info(`  ${c.bold(cmd)}`);
  }
  if (g.then) info(c.dim(`then: ${g.then}`));
}

export async function runGuide(root, { epic = null, cwd, json = false, runner, productElsewhere = null } = {}) {
  const g = buildGuide(root, { epic, cwd, runner, productElsewhere });
  if (g.ok === false) process.exitCode = 1;
  if (json) return g;
  printGuide(g);
  return undefined;
}
