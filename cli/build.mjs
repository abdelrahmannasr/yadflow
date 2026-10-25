// `yad build start|step|trust|ship|done` (issue #346) — one command per Build record, so the records are
// written in the shape every reader expects instead of by hand. The user's decisions (2026-10-19):
//   - one family, `yad build …`, named after the Build phase the records belong to;
//   - `build ship` reads the merge commit, checks and approvers from the MERGED PR/MR on the platform (as
//     `yad review reconcile` does), and refuses one that is not merged; flags fill in with no platform;
//   - `build done` makes the three "shipped" signals agree — the story's `status:` line, the ship records
//     and every lane step `done` — so `yad next`, the epic seal and `yad tidy up` all read the same answer.
//
// The records and their readers are unchanged: the commands write exactly what the skills wrote by hand
// (skills/yad-epic/references/state-schema.md, skills/yad-engineer-review/references/ship-and-record.md).
// They write; `yad checkpoint --push` commits, as before.
//
// The rules are the PURE planners below (`planStart`, `planStep`, `trustEntry`, `planDone`); the commands
// read the files, call them, and write.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ok, info, hand, warn, run, readJSON, readJSONStrict, writeJSON, writeFileAtomic, isPlainObject, exists } from './lib.mjs';
import { epicIds, epicRoot, epicRel, epicStories, loadLedger, stepStatus, laneStarted, isPassed, readFrontmatter, parseFrontmatter, nextAction, loadAutomation, effectiveAdvance, effectiveAction } from './epic-state.mjs';
import { DEFAULT_LIFECYCLE, laneOrder, laneAuthorSteps } from './lifecycle.mjs';
import { epicFiles, PROJECT_FILES } from './manifest.mjs';
import { err } from './errors.mjs';
import { readShips, readTrustRuns, writeShip, shipBlocked, updateShip, writeTrustRun, updateTrustRun } from './ledger.mjs';
import { setBuildStatus, readStoryStatus } from './artifact-status.mjs';
import { readPr, mapApprovers, detectPlatform, cliFor, platformReady, prNumberFromUrl } from './platform.mjs';
import { repoPathFromGitUrl } from './protection.mjs';
import { readCommit, tasksOfCommit, prOfCommit, shipDrift } from './ship-drift.mjs';
import { recordActor } from './skip.mjs';
import { sealedEpic } from './thread.mjs';
import { worktreeAt, sameDir } from './worktree-record.mjs';

const CODE = 'YAD-STATE-009';
const STORY_RE = /^EP-[a-z0-9-]+-S\d+$/;
const TASK_RE = /^T\d+$/;
export const VERDICTS = ['approved-unchanged', 'approved-with-edits', 'rejected'];
// The signals each step's trust entry may carry (state-schema.md, "Per-step signals fields").
export const STEP_SIGNALS = {
  spec: ['human_edited_spec'],
  tasks: ['task_rescoped'],
  implement: ['human_edited_diff', 'scope_overrun', 'contract_touch'],
  checks: ['checks'],
};
// The states `build step` moves a step to. `done` closes it; `blocked` halts the lane with a record.
export const STEP_MOVES = ['in_progress', 'in_review', 'done', 'blocked'];

const LANE = laneOrder(DEFAULT_LIFECYCLE);
const AUTHOR = new Set(laneAuthorSteps(DEFAULT_LIFECYCLE));
const REVIEW_STEP = LANE.find((id) => !AUTHOR.has(id)) || 'engineer-review';
// The steps walked once per task (the user's decision, 2026-10-20): `implement` and every author step after
// it. A story's tasks each go through them in turn, so a later task reopens them.
export const PER_TASK = new Set(LANE.slice(LANE.indexOf('implement')).filter((id) => AUTHOR.has(id)));

export const storyEpic = (story) => String(story).replace(/-S\d+$/, '');

// A lane as `yad-run` seeds it: every step `todo`, every dial `human`, the review step locked.
export function newLane() {
  return {
    currentStep: LANE[0],
    steps: LANE.map((id) => ({ id, automation: 'human_approve', advance: 'human', locked: !AUTHOR.has(id), status: 'todo' })),
  };
}

// A build-state file this can read as a lane map, or a refusal — never overwritten when it cannot be read.
function lanes(bs, story) {
  if (bs == null) return { story, repos: {} };
  if (!isPlainObject(bs)) throw err(CODE, `build-state/${story}.json is not a JSON object`, 'fix the file by hand — nothing here overwrites content it cannot read');
  if ('repos' in bs && !isPlainObject(bs.repos)) throw err(CODE, `build-state/${story}.json has a \`repos\` that is not an object`, 'fix the file by hand — nothing here overwrites content it cannot read');
  return { ...bs, story: bs.story || story, repos: { ...(bs.repos || {}) } };
}

// PURE: add a repo's lane to a story's build-state. The same refusals as a lane skip (E39): the stories
// review passed, and the story declares the repo. A lane already there is left as it is.
export function planStart(buildState, { story, repo, declared = [], storiesPassed = false }) {
  if (!storiesPassed) throw err(CODE, `the stories review has not passed, so ${story} is not approved for Build yet`, 'pass the stories review first (yad gate)');
  if (!declared.includes(repo)) {
    throw err(CODE, `${story} does not declare ${repo}, so it has no lane there`, declared.length ? `its repos: ${declared.join(', ')} (names are case-sensitive)` : 'the story declares no repos at all');
  }
  const bs = lanes(buildState, story);
  const lane = bs.repos[repo];
  if (isPlainObject(lane) && lane.status === 'skipped' && !laneStarted(lane)) {
    throw err(CODE, `${story} / ${repo} is skipped`, `\`yad unskip ${storyEpic(story)} ${story} --repo ${repo}\` if the lane is owed after all`);
  }
  if (lane != null) return { buildState: bs, already: true };
  return { buildState: { ...bs, repos: { ...bs.repos, [repo]: newLane() } }, already: false };
}

// A lane to change, or a refusal naming what to run first.
function liveLane(bs, story, repo) {
  const lane = bs.repos[repo];
  if (lane == null) throw err(CODE, `${story} has no lane in ${repo} yet`, `\`yad build start ${story} --repo ${repo}\` makes it`);
  if (!isPlainObject(lane) || !Array.isArray(lane.steps)) {
    if (isPlainObject(lane) && lane.status === 'skipped') throw err(CODE, `${story} / ${repo} is skipped`, `\`yad unskip ${storyEpic(story)} ${story} --repo ${repo}\` if the lane is owed after all`);
    throw err(CODE, `${story} / ${repo} has no steps in build-state/${story}.json`, 'fix the file by hand — nothing here overwrites content it cannot read');
  }
  return lane;
}

// The lane's step now: `currentStep` when it is not done, else the first step not done.
const activeStep = (lane) => {
  const cur = lane.steps.find((s) => s?.id === lane.currentStep);
  return cur && !isPassed(cur) ? cur : lane.steps.find((s) => !isPassed(s)) || null;
};

// PURE: move one step of a lane. Only the lane's active step moves, so a lane is never walked out of order.
// `done` writes the closing record (E18) and moves `currentStep` on; `blocked` needs a reason, written as
// the step's record. The review step is closed by `build done`, which checks every task shipped first.
export function planStep(buildState, { story, repo, step, to, reason = null, by = null, date = null, via = 'human', run = null, task = null, automation = null }) {
  if (task != null && !TASK_RE.test(String(task))) throw err(CODE, `--task must be a task id such as T02 (got '${task}')`, '--task T02');
  if (!STEP_MOVES.includes(to)) throw err(CODE, `'${to}' is not a step state this sets`, `one of: ${STEP_MOVES.join(', ')}`);
  const bs = lanes(buildState, story);
  const lane = liveLane(bs, story, repo);
  const target = lane.steps.find((s) => s?.id === step);
  if (!target) throw err(CODE, `${story} / ${repo} has no step '${step}'`, `its steps: ${lane.steps.map((s) => s?.id).join(', ')}`);
  if (step === REVIEW_STEP && to === 'done') {
    throw err(CODE, `${REVIEW_STEP} is closed by \`yad build done ${story}\``, 'it checks that every task has a ship record first');
  }
  const active = activeStep(lane);
  if (isPassed(target)) {
    // `done --task T02` on a step T01 closed is not "already done": T02 has not been through it.
    if (to === 'done' && task && target.closed?.task !== task) {
      if (!PER_TASK.has(step)) throw err(CODE, `--task does not apply to ${step}`, `${step} is walked once per story, not per task`);
      throw err(CODE, `${step} was closed ${target.closed?.task ? `for ${target.closed.task}` : 'for no task'}, not ${task}`, `reopen it for ${task} first: yad build step ${story} --repo ${repo} implement in_progress --task ${task}`);
    }
    if (to === 'done') return { buildState: bs, already: true };
    // The next task reopens the per-task steps — once the lane has walked them all for the task before
    // (it is at the review step) and the review is not closed. Each close stays in `runs`, by task.
    // The next task starts at implement: reopening checks alone would leave the task no implement run.
    const first = [...PER_TASK][0];
    const reopen = step === first && task && active?.id === REVIEW_STEP && stepStatus(active) !== 'blocked';
    if (!reopen) {
      const hint = !PER_TASK.has(step) ? 'a closed step is not reopened'
        : active?.id === REVIEW_STEP && stepStatus(active) === 'blocked' ? `clear the halt on ${REVIEW_STEP} first`
          : `the next task reopens ${first} once the lane is at ${REVIEW_STEP}: yad build step ${story} --repo ${repo} ${first} ${to} --task <T>`;
      throw err(CODE, `${step} is already done in ${story} / ${repo}`, hint);
    }
    const at = LANE.indexOf(step);
    const keep = (s) => {
      const n = { ...s };
      if (n.closed) {
        const prior = Array.isArray(n.runs) ? n.runs : [];
        n.runs = [...(n.closed.run ? prior.filter((r) => r?.run !== n.closed.run) : prior), n.closed];
      }
      delete n.closed;
      delete n.record;
      return n;
    };
    const steps = lane.steps.map((s) => {
      if (s?.id === step) {
        const n = { ...keep(s), status: to, task };
        if (to === 'blocked') {
          if (reason == null || reason === true || !String(reason).trim()) throw err(CODE, 'a halt needs a reason', `yad build step ${story} --repo ${repo} ${step} blocked --task ${task} --reason "<what a person must resolve>"`);
          n.record = { reason: String(reason).trim(), by, date };
        }
        return n;
      }
      // The per-task steps after it are owed again for this task.
      if (PER_TASK.has(s?.id) && LANE.indexOf(s.id) > at && isPassed(s)) return { ...keep(s), status: 'todo', task };
      return s;
    });
    return { buildState: { ...bs, repos: { ...bs.repos, [repo]: { ...lane, currentStep: step, steps } } }, already: false, reopened: task };
  }
  if (active && active.id !== step) {
    throw err(CODE, `${story} / ${repo} is at ${active.id}, not ${step}`, `move ${active.id} first — the lane is walked in order`);
  }
  if (!['auto', 'human'].includes(via)) throw err(CODE, `--via must be auto or human (got '${via}')`, '--via human, unless the orchestrator advanced it on its own');
  // The dial IN FORCE — the lane's own, held at human while the kill switch is on — not the lane's word alone.
  if (via === 'auto' && to === 'done' && effectiveAdvance(target, automation).advance !== 'auto') {
    const why = effectiveAdvance(target, automation).why;
    throw err(CODE, `${step} is not advancing on its own in ${story} / ${repo}${why === 'kill' ? ' (the kill switch is on)' : ''}, so it is not closed --via auto`,
      why === 'kill' ? '`yad unkill` turns the kill switch off' : `\`yad dial ${storyEpic(story)} ${story} --repo ${repo} ${step} --to auto\` sets the dial first`);
  }
  // A step reopened for a task closes for that task: `--task` defaults to it, and another is refused.
  if (task && target.task && task !== target.task) throw err(CODE, `${step} is open for ${target.task}, not ${task}`, `--task ${target.task}`);
  const forTask = task || target.task || null;
  const next = { ...target, status: to };
  delete next.record;
  if (to === 'blocked') {
    if (reason == null || reason === true || !String(reason).trim()) throw err(CODE, 'a halt needs a reason', `yad build step ${story} --repo ${repo} ${step} blocked --reason "<what a person must resolve>"`);
    next.record = { reason: String(reason).trim(), by, date };
  }
  if (to === 'done') {
    next.closed = { by, date, via, ...(run ? { run } : {}), ...(forTask ? { task: forTask } : {}) };
    delete next.task;
  }
  const steps = lane.steps.map((s) => (s?.id === step ? next : s));
  let currentStep;
  if (to === 'done') {
    const i = LANE.indexOf(step);
    const after = steps.find((s, k) => !isPassed(s) && (LANE.indexOf(s?.id) > i || (LANE.indexOf(s?.id) === -1 && k > steps.indexOf(next))));
    currentStep = after ? after.id : step;
  } else currentStep = step;
  return { buildState: { ...bs, repos: { ...bs.repos, [repo]: { ...lane, currentStep, steps } } }, already: false };
}

// PURE: a trust entry, checked. `signals` is { name: value } from `--signal name=value`.
export function trustEntry({ story, repo, step, verdict, signals = {}, ranBy = 'human', note = null, date = null, lane = null, uid, task = null, automation = null }) {
  if (task != null && !TASK_RE.test(String(task))) throw err(CODE, `--task must be a task id such as T02 (got '${task}')`, '--task T02');
  if (!AUTHOR.has(step)) throw err(CODE, `'${step}' has no trust entry`, `trust is recorded for: ${[...AUTHOR].join(', ')}`);
  if (!VERDICTS.includes(verdict)) throw err(CODE, `'${verdict}' is not a verdict`, `one of: ${VERDICTS.join(', ')}`);
  if (!['machine', 'human'].includes(ranBy)) throw err(CODE, `--ran-by must be machine or human (got '${ranBy}')`, 'machine when the orchestrator advanced it, else human');
  const allowed = STEP_SIGNALS[step] || [];
  const out = {};
  for (const [k, raw] of Object.entries(signals)) {
    if (!allowed.includes(k)) throw err(CODE, `'${k}' is not a ${step} signal`, `${step} signals: ${allowed.join(', ')}`);
    const v = String(raw);
    if (k === 'checks') {
      if (!['pass', 'fail', 'n/a'].includes(v)) throw err(CODE, `checks=${v}: expected pass, fail or n/a`, '--signal checks=pass');
      out[k] = v;
    } else {
      if (!['true', 'false'].includes(v)) throw err(CODE, `${k}=${v}: expected true or false`, `--signal ${k}=true`);
      out[k] = v === 'true';
    }
  }
  const st = lane?.steps?.find((s) => s?.id === step);
  // The dial in force at run time: the lane's own, held at human while the kill switch is on.
  const advance = st ? effectiveAdvance(st, automation).advance : 'human';
  return {
    story, repo, step, uid,
    automation: advance === 'auto' ? 'machine_advance' : 'human_approve', advance,
    verdict, signals: out, ranBy, date,
    ...(task ? { task } : {}),
    ...(note ? { note: String(note) } : {}),
  };
}

// The tasks a story owes in one repo: the ids in `specs/<story>/tasks.md` on the repo's default branch
// (merged, not the working tree — the rule the gates read by). Each task line starts with its id (`T01`).
export function parseTaskIds(text) {
  const ids = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|\d+[.)]\s+)?\**(T\d+)\b/);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

// A light spec (#348) is one spec.md holding the spec, the plan and the tasks; link.md says
// `spec-mode: light`. The tasks are the lines between the two markers, so a `T01` line in the spec or the
// plan above them is never read as a task. Exactly one block, opened before it is closed; otherwise null.
export const LIGHT_TASKS = { begin: '<!-- yad:tasks -->', end: '<!-- /yad:tasks -->' };
export function lightTasksBlock(text) {
  const lines = String(text).split(/\r?\n/);
  const at = (m) => lines.flatMap((l, i) => (l.trim() === m ? [i] : []));
  const b = at(LIGHT_TASKS.begin);
  const e = at(LIGHT_TASKS.end);
  if (b.length !== 1 || e.length !== 1 || e[0] < b[0]) return null;
  return lines.slice(b[0] + 1, e[0]).join('\n');
}
export const isLightSpec = (linkText) => parseFrontmatter(linkText)['spec-mode'] === 'light';

// PURE: what `build done` finds. `owed` is { repo: [taskIds] | null } (null: tasks.md could not be read);
// `ships` the story's ships. A retroactive ship covers its whole repo.
export function planDone({ story, declared, skipped = [], owed, ships }) {
  const missing = [];
  const unreadable = [];
  for (const repo of declared) {
    if (skipped.includes(repo)) continue;
    const shipped = ships.filter((s) => s.story === story && s.repo === repo);
    if (shipped.some((s) => s.retroactive)) continue;
    const tasks = owed[repo];
    if (tasks == null) { unreadable.push(repo); continue; }
    if (!tasks.length) { unreadable.push(repo); continue; }
    for (const t of tasks) if (!shipped.some((s) => s.task === t)) missing.push(`${repo}/${t}`);
  }
  return { missing, unreadable, shipped: !missing.length && !unreadable.length };
}

// The review step closed by `build done`: done, with its closing record, and no halt record left on it.
const closeReview = (s, { by, date }) => {
  const n = { ...s, status: 'done', closed: { by, date, via: 'human' } };
  delete n.record;
  return n;
};

// ---- the commands ----------------------------------------------------------------------------------

// The story's file, found the way `epicStories` finds the story: by its frontmatter `id`, else its name.
// One file, named for the story: `yad tidy` and the seal name a story by its file, so a file named other
// than its id would be shipped here and never folded there.
function storyFileOf(epicDir, story) {
  const dir = path.join(epicDir, 'stories');
  const claim = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()
    .filter((f) => (readFrontmatter(path.join(dir, f)).id || f.replace(/\.md$/, '')) === story);
  if (!claim.length) throw err(CODE, `no story file for ${story}`, 'check the story id');
  if (claim.length > 1) throw err(CODE, `${claim.length} story files claim ${story}: ${claim.join(', ')}`, 'keep one');
  if (claim[0] !== `${story}.md`) throw err(CODE, `${story} is in stories/${claim[0]}, not stories/${story}.md`, `rename it to ${story}.md: yad tidy and the epic seal read a story by its file name`);
  return path.join(dir, claim[0]);
}

// The status a Build write moves the story from must be one it can place; refused before anything is
// written, so the lanes and the status line never part.
function storyStatusOk(ctx, story) {
  const st = readStoryStatus(ctx.storyFile);
  if (!['draft', 'in-review', 'approved', 'in-build', 'shipped'].includes(st)) {
    throw err(CODE, `${path.relative(ctx.epicDir, ctx.storyFile)} has status: ${st ?? '(none)'}, which a Build write cannot move on`, `set it to approved (\`yad sync-status ${storyEpic(story)}\` does), then run this again`);
  }
  return st;
}

function storyContext(root, story) {
  if (!STORY_RE.test(String(story || ''))) throw err(CODE, `'${story}' is not a story id`, 'expected EP-<slug>-S<n>, such as EP-checkout-S01');
  const epic = storyEpic(story);
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) throw err(CODE, `no epic state at ${epicRel(epic)}`, 'seed the epic first with yad-epic');
  const entry = epicStories(epicDir).find((s) => s.id === story);
  if (!entry) throw err(CODE, `no story ${story} under ${epicRel(epic)}/stories/`, 'check the story id');
  const review = ledger.state.steps.find((s) => s?.id === 'stories-review');
  const file = path.join(epicFiles(epicDir).buildStateDir, `${story}.json`);
  return {
    epic, epicDir, entry, file, ledger,
    storiesPassed: ['done', 'satisfied'].includes(stepStatus(review)),
    buildState: readJSONStrict(file, null),
    storyFile: storyFileOf(epicDir, story),
  };
}

const rel = (root, p) => path.relative(root, p);
const repoArg = (repo, usage) => { if (!repo || repo === true) throw err(CODE, '--repo <name> is required', usage); return repo; };

export async function buildStart(root, { story, repo, today } = {}) {
  repoArg(repo, `yad build start ${story || '<story>'} --repo <name>`);
  const ctx = storyContext(root, story);
  const { buildState, already } = planStart(ctx.buildState, { story, repo, declared: ctx.entry.repos, storiesPassed: ctx.storiesPassed });
  if (already) {
    ok(`${story} / ${repo} already has a lane — nothing changed`);
    return { story, repo, changed: false, file: rel(root, ctx.file) };
  }
  writeJSON(ctx.file, buildState);
  ok(`${story} / ${repo} lane started at ${buildState.repos[repo].currentStep}${today ? ` on ${today}` : ''}`);
  hand(`yad next ${ctx.epic} shows it; commit with \`yad checkpoint --push\``);
  return { story, repo, changed: true, lane: buildState.repos[repo], file: rel(root, ctx.file) };
}

export async function buildStep(root, { story, repo, step, to, reason, via = 'human', run: runUid = null, task = null, today } = {}) {
  repoArg(repo, `yad build step ${story || '<story>'} --repo <name> <step> ${STEP_MOVES.join('|')}`);
  if (!step || !to) throw err(CODE, 'a step and the state to move it to are required', `yad build step ${story} --repo ${repo} <step> ${STEP_MOVES.join('|')}`);
  const ctx = storyContext(root, story);
  // A run named must be a run of this step in this lane, for the task the close is for, and not one an
  // earlier close already names: the closing record points at the evidence.
  if (runUid && runUid !== true) {
    const lane = lanes(ctx.buildState, story).repos[repo];
    const st = Array.isArray(lane?.steps) ? lane.steps.find((x) => x?.id === step) : null;
    const forTask = (task && task !== true ? task : null) || st?.task || null;
    const used = [st?.closed?.run, ...(Array.isArray(st?.runs) ? st.runs.map((x) => x?.run) : [])].filter(Boolean);
    // The same close sent again (an orchestrator resuming) is "already done", not a second close.
    const same = st && isPassed(st) && st.closed?.run === runUid && (!forTask || st.closed?.task === forTask);
    if (!same && used.includes(runUid)) throw err(CODE, `trust run ${runUid} already closed ${step} in ${story} / ${repo}`, 'each close names its own run: record this one with `yad build trust`');
    const known = readTrustRuns(ctx.epicDir).some((r) => r.uid === runUid && r.story === story && r.repo === repo && r.step === step
      && !(r.task && forTask && r.task !== forTask));
    if (!known) throw err(CODE, `no trust run ${runUid} for ${story} / ${repo} / ${step}`, `\`yad build trust ${story} --repo ${repo} ${step} --verdict …\` prints the uid of the run it records`);
  }
  // An automatic close names the run that earned it: without one, nothing shows the run was not rejected.
  if (to === 'done' && via === 'auto' && (!runUid || runUid === true)) {
    throw err(CODE, '--via auto needs --run <uid>, the trust run that advanced the step', `yad build trust ${story} --repo ${repo} ${step} --verdict … prints it`);
  }
  if (runUid && runUid !== true && to === 'done' && via === 'auto') {
    const r = readTrustRuns(ctx.epicDir).find((x) => x.uid === runUid && x.story === story && x.repo === repo && x.step === step);
    if (r?.verdict === 'rejected') throw err(CODE, `trust run ${runUid} is rejected, so ${step} does not advance on its own`, `halt instead: yad build step ${story} --repo ${repo} ${step} blocked --reason "<why>"`);
  }
  const { buildState, already, reopened } = planStep(ctx.buildState, {
    story, repo, step, to, reason, by: recordActor(root), date: today, via, run: runUid === true ? null : runUid, task: task === true ? null : task,
    automation: loadAutomation(root),
  });
  if (already) {
    ok(`${step} is already done in ${story} / ${repo} — nothing changed`);
    return { story, repo, step, status: 'done', changed: false };
  }
  writeJSON(ctx.file, buildState);
  const lane = buildState.repos[repo];
  ok(`${story} / ${repo}: ${step} is ${to}${reopened ? ` again, for ${reopened}` : ''}${to === 'blocked' ? ` — ${String(reason).trim()}` : ''}`);
  if (to === 'done') info(`next: ${lane.currentStep}`);
  hand('commit with `yad checkpoint --push`');
  const specKit = SPEC_KIT_STEPS.has(step) && to === 'in_progress' ? pinSpecKit(root, repo, story, step) : null;
  return { story, repo, step, status: to, currentStep: lane.currentStep, changed: true, ...(specKit ? { specKit } : {}) };
}

// Spec Kit finds the story folder it writes into through `.specify/feature.json` (issue #348): pinned to
// specs/<story> when the spec or tasks step starts (yad-spec runs both, and another story's spec may have
// moved the file in between), so /speckit.plan and the rest never write into the previous story's folder.
// Only in a repo that has a `.specify/` folder, i.e. uses Spec Kit. The step is already recorded, so nothing
// here fails it: a problem is a warning with the fix. The file is the clone's working state, as Spec Kit's
// own writes are — it is not committed.
const SPEC_KIT_STEPS = new Set(['spec', 'tasks']);
// A registered checkout's worktree for an epic, when yad made one beside it (#115); else null.
function epicWorktreeOf(checkout, epic, repo) {
  const at = path.join(path.dirname(checkout), `${path.basename(checkout)}--${epic}`);
  const rec = worktreeAt(at);
  return rec && rec.repo === repo && rec.epic === epic && sameDir(rec.main, checkout) ? at : null;
}

export function pinSpecKit(root, repo, story, step = 'spec') {
  let checkout;
  try { ({ checkout } = registeredRepo(root, repo)); } catch (e) { warn(`Spec Kit folder not pinned: ${e.message}${e.hint ? ` — ${e.hint}` : ''}`); return null; }
  if (!checkout) { info(`${repo} is not checked out here, so Spec Kit's feature folder was not pinned`); return null; }
  // The story's epic has its own worktree of this repo (#115): the agent specs there, so the pin goes there.
  const wt = epicWorktreeOf(checkout, storyEpic(story), repo);
  const where = wt ? path.basename(wt) : repo;
  const dir = path.join(wt ?? checkout, '.specify');
  const featureDirectory = `specs/${story}`;
  const fix = `set it by hand: {"feature_directory":"${featureDirectory}"} in ${where}/.specify/feature.json`;
  let dirStat;
  try { dirStat = fs.lstatSync(dir, { throwIfNoEntry: false }); } catch (e) { warn(`could not read ${where}/.specify: ${e.message} — ${fix}`); return null; }
  if (!dirStat) return null; // no .specify/: the repo does not use Spec Kit
  // A link is not followed: yad never writes through one.
  if (!dirStat.isDirectory()) { info(`${where}/.specify is not a plain folder, so Spec Kit's feature folder was not pinned — ${fix}`); return null; }
  const file = path.join(dir, 'feature.json');
  let have = {};
  try {
    const st = fs.lstatSync(file, { throwIfNoEntry: false });
    if (st && !st.isFile()) { warn(`${where}/.specify/feature.json is not a plain file, so it was left alone — ${fix}`); return null; }
    if (st) have = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { warn(`${where}/.specify/feature.json cannot be read, so it was left alone — ${fix}`); return null; }
  if (!isPlainObject(have)) { warn(`${where}/.specify/feature.json is not a JSON object, so it was left alone — ${fix}`); return null; }
  const changed = have.feature_directory !== featureDirectory;
  if (changed) {
    try { writeFileAtomic(file, JSON.stringify({ ...have, feature_directory: featureDirectory }) + '\n'); } catch (e) { warn(`could not write ${where}/.specify/feature.json: ${e.message} — ${fix}`); return null; }
  }
  ok(`Spec Kit's feature folder in ${where} ${changed ? 'is now' : 'is already'} ${featureDirectory}`);
  if (step === 'spec') hand(`when /speckit.specify runs, give it \`SPECIFY_FEATURE_DIRECTORY=${featureDirectory}\` — it makes a numbered folder of its own without it`);
  return { file: `${where}/.specify/feature.json`, featureDirectory, changed };
}

export async function buildTrust(root, { story, repo, step, verdict, signals = {}, ranBy = 'human', note = null, uid = null, task = null, today } = {}) {
  repoArg(repo, `yad build trust ${story || '<story>'} --repo <name> <step> --verdict <${VERDICTS.join('|')}>`);
  if (!step) throw err(CODE, 'a step is required', `yad build trust ${story} --repo ${repo} <step> --verdict <v>`);
  if (!verdict || verdict === true) throw err(CODE, '--verdict is required', `one of: ${VERDICTS.join(', ')}`);
  const ctx = storyContext(root, story);
  // Finalizing a run that was already recorded: the human gate confirms or overrides the provisional verdict.
  if (uid && uid !== true) {
    if (Object.keys(signals).length) throw err(CODE, '--signal is not changed when finalizing a run', 'the signals are what the run saw; --uid sets only the verdict (and --note)');
    if (!VERDICTS.includes(verdict)) throw err(CODE, `'${verdict}' is not a verdict`, `one of: ${VERDICTS.join(', ')}`);
    const res = updateTrustRun(ctx.epicDir, (r) => r.uid === uid && r.story === story && r.repo === repo && r.step === step, (r) => {
      r.verdict = verdict;
      if (note) r.note = String(note);
    });
    if (!res.found) throw err(CODE, `no trust run ${uid} for ${story} / ${repo} / ${step}`, 'the uid is the one `yad build trust` printed when it recorded the run');
    ok(`trust run ${uid} (${story} / ${repo} / ${step}) is now ${verdict}`);
    hand('commit with `yad checkpoint --push`');
    return { story, repo, step, uid, verdict, changed: true, finalized: true };
  }
  const bs = lanes(ctx.buildState, story);
  const lane = liveLane(bs, story, repo);
  const entry = trustEntry({ story, repo, step, verdict, signals, ranBy, note, date: today, lane, uid: randomBytes(4).toString('hex'), task: task === true ? null : task, automation: loadAutomation(root) });
  const res = writeTrustRun(ctx.epicDir, entry);
  if (!res.written) throw err(CODE, `a trust run named ${path.basename(res.file)} is already there`, 'run it again: a new uid is drawn each time');
  ok(`trust run ${entry.uid} recorded: ${story} / ${repo} / ${step} — ${verdict}`);
  info(`close the step with it: yad build step ${story} --repo ${repo} ${step} done --run ${entry.uid}`);
  hand('commit with `yad checkpoint --push`');
  return { story, repo, step, uid: entry.uid, verdict, changed: true, file: rel(root, res.file) };
}

// The registered repo's checkout, platform and default branch.
function registeredRepo(root, repo) {
  const reg = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
  const meta = (reg.repos || []).find((r) => r?.name === repo) || null;
  const product = readJSON(path.join(root, PROJECT_FILES.productConfig), null) || readJSON(path.join(root, '.sdlc/hub.json'), null) || {};
  const dir = meta?.path ? path.resolve(root, meta.path) : null;
  const checkout = dir && exists(path.join(dir, '.git')) ? dir : null;
  const remote = checkout ? run('git', ['remote', 'get-url', 'origin'], { cwd: checkout }).stdout : '';
  // The folder must be the registered repo: a stale path to another clone would read that repo's PR #n.
  // Compared by the repo's path on its host (`team/api`), so a port, an SSH host alias, a token in the URL
  // or a trailing slash do not matter. Never printed as a URL: a remote can hold a token.
  if (checkout && meta?.git_url && remote) {
    const have = repoPathFromGitUrl(remote);
    const want = repoPathFromGitUrl(meta.git_url);
    if (!have !== !want) warn(`${repo}: could not compare the clone with its registered git_url — check ${meta.path} is ${want || 'the registered repo'}`);
    if (have && want && have.toLowerCase() !== want.toLowerCase()) throw err(CODE, `${meta.path} is a clone of ${have}, not ${want}`, `fix the path of ${repo} in .sdlc/repos.json, or clone it with \`yad repo clone ${repo}\``);
  }
  const named = typeof meta?.default_branch === 'string' && meta.default_branch ? meta.default_branch : null;
  if (named && (named.startsWith('-') || !run('git', ['check-ref-format', '--branch', named]).ok)) {
    throw err(CODE, `.sdlc/repos.json names a default_branch for ${repo} git cannot use: ${named}`, 'fix default_branch in .sdlc/repos.json');
  }
  return { meta, checkout, platform: meta?.platform || detectPlatform(remote) || product.platform || null, defaultBranch: named };
}

// A PR/MR's state in one vocabulary: open, merged or closed (closed without a merge). GitLab's `locked` is
// an MR mid-merge, so still open.
const ghState = (v) => ({ OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' })[v] || null;
const glState = (v) => ({ opened: 'open', locked: 'open', merged: 'merged', closed: 'closed' })[v] || null;

// The merged PR/MR's facts the ship record holds. `runner` is injectable for tests.
export function readMergedPr(platform, n, { cwd, runner = run } = {}) {
  if (platform === 'gitlab') {
    const r = runner('glab', ['api', `projects/:id/merge_requests/${n}`], { cwd });
    if (!r.ok) return { ok: false, reason: r.stderr || 'glab api merge_requests failed' };
    let mr; try { mr = JSON.parse(r.stdout); } catch { return { ok: false, reason: 'unreadable glab answer' }; }
    // The gates that passed: the job names of the MR's head pipeline that succeeded.
    // One page of up to 100 jobs; jobs of a child or downstream pipeline are not listed here.
    let checks = [];
    let checksRead = false;
    const pid = mr.head_pipeline?.id;
    if (pid) {
      const j = runner('glab', ['api', `projects/:id/pipelines/${pid}/jobs?per_page=100`], { cwd });
      if (j.ok) { try { checks = [...new Set((JSON.parse(j.stdout) || []).filter((x) => x?.status === 'success').map((x) => x.name).filter(Boolean))].sort(); checksRead = true; } catch { /* unreadable */ } }
    }
    return {
      // A fast-forward merge has no merge commit: the MR's head is what landed.
      ok: true, state: glState(mr.state), merged: mr.state === 'merged', mergeCommit: mr.merge_commit_sha || mr.squash_commit_sha || (mr.state === 'merged' ? mr.sha : null) || null, checksRead,
      mergedAt: mr.merged_at || null, branch: mr.source_branch || null, url: mr.web_url || null, body: mr.description || '', checks,
    };
  }
  const r = runner('gh', ['pr', 'view', String(n), '--json', 'state,mergedAt,mergeCommit,headRefName,url,body,statusCheckRollup'], { cwd });
  if (!r.ok) return { ok: false, reason: r.stderr || 'gh pr view failed' };
  let pr; try { pr = JSON.parse(r.stdout); } catch { return { ok: false, reason: 'unreadable gh answer' }; }
  // The gates that passed on the merged head: a check run's name, or a status context's.
  const checks = [...new Set((pr.statusCheckRollup || [])
    .filter((c) => (c.conclusion || c.state || '').toUpperCase() === 'SUCCESS')
    .map((c) => c.name || c.context).filter(Boolean))].sort();
  return {
    ok: true, state: ghState(pr.state), merged: pr.state === 'MERGED', mergeCommit: pr.mergeCommit?.oid || null, mergedAt: pr.mergedAt || null, checksRead: true,
    branch: pr.headRefName || null, url: pr.url || null, body: pr.body || '', checks,
  };
}

// The task ids a branch names, lower-case: `feat/EP-auth-S01-T02-2fa-setup` → ['ep-auth-s01-t02'], under any
// folders, in any case. Each id is the shortest one from a folder or `_` boundary that ends at a word
// boundary, so a slug after the task (`-2fa-setup`, `-then-S02-T03`) is never read as part of it, and
// `T012` is not `T01`.
export function tasksInBranch(branch) {
  return [...String(branch || '').matchAll(/(?:^|[/_])(ep-[a-z0-9-]+?-s\d+-t\d+)(?=$|[-_/])/gi)].map((m) => m[1].toLowerCase());
}

// Which task a PR's branch carries, for `story`-`task`: 'this' (it names this task), 'other' (it names
// another) or 'none'. The expected id first: an epic slug may itself read like a task (`EP-aws-s3-t2-backup`).
export function branchTask(branch, story, task) {
  const esc = `${story}-${task}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:^|[/_])${esc}(?=$|[-_/])`, 'i').test(branch || '')) return 'this';
  return tasksInBranch(branch).length ? 'other' : 'none';
}

// A follow-up branch of `story`-`task` (issue #350): the task id followed by `-followup`, as in
// `fix/EP-pay-S01-T01-followup-null-check` — a fix to a task that has already shipped. Its commits keep the
// task's `Task:` line; its merge is added to the task's ship (`followUps`), never a second ship.
export function isFollowUpBranch(branch, story, task) {
  const esc = `${story}-${task}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[/_])${esc}-followup(?=$|[-_/])`, 'i').test(branch || '');
}

// A commit in the repo's own checkout: it exists and is on the default branch (origin's, fetched first
// unless --no-fetch; the local one when there is no origin). `strict` (a ship read with the platform's help)
// also asks that it names the task, by the rules `yad reconcile check` reads every commit with — a `Task:`
// trailer, a task branch a merge brought in, or the full id in the subject. By hand, where the platform
// cannot be read, the person vouches for it: it may not name a DIFFERENT task, and naming none is a warning.
function checkCommit(where, { story, task, repo, mergeCommit, strict = true, fetch = true, noTask = 'recorded as you say it ships', group = null }) {
  const cwd = where.checkout;
  const hasOrigin = run('git', ['remote', 'get-url', 'origin'], { cwd }).ok;
  const head = run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd }).stdout;
  const branch = where.defaultBranch || (head.startsWith('origin/') ? head.slice(7) : 'main');
  let ref = `refs/heads/${branch}`;
  if (hasOrigin) {
    if (fetch && !run('git', ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd }).ok) {
      throw err(CODE, `could not fetch ${branch} in ${repo} to check the commit`, 'check the network and your login, or pass --no-fetch to check against the last fetched copy');
    }
    ref = `refs/remotes/origin/${branch}`;
  }
  if (!run('git', ['rev-parse', '--verify', '--quiet', ref], { cwd }).ok) {
    throw err(CODE, `${repo} has no ${hasOrigin ? `origin/${branch}` : `branch ${branch}`} to check the commit against`, `set default_branch for ${repo} in .sdlc/repos.json`);
  }
  const sha = run('git', ['rev-parse', '--verify', '--quiet', `${mergeCommit}^{commit}`], { cwd }).stdout;
  if (!sha) throw err(CODE, `${mergeCommit} is not a commit in ${repo}`, 'fetch it, or check the SHA');
  if (!run('git', ['merge-base', '--is-ancestor', sha, ref], { cwd }).ok) {
    throw err(CODE, `${mergeCommit} is not on ${repo}'s ${branch}`, 'a ship is recorded once the work is merged into the default branch');
  }
  const rec = readCommit(cwd, sha);
  if (!rec) throw err(CODE, `${mergeCommit} could not be read in ${repo}`, 'check the SHA');
  const named = tasksOfCommit(rec).map((x) => x.task);
  const want = `${story}-${task}`;
  // A grouped PR (#350): its merge commit names the branch's task; it ships every task the PR carries.
  // By hand there is no PR to ask: the merge commit's own merged range is read (`group: 'range'`).
  if (group === 'range') group = mergeRangeTasks(cwd, sha);
  const inGroup = Array.isArray(group) && group.includes(want) && named.length && named.every((t) => group.includes(t));
  if (!named.includes(want) && !inGroup) {
    if (strict || named.length) {
      throw err(CODE, named.length ? `${mergeCommit} names ${named.join(', ')}, not ${want}` : `${mergeCommit} does not name ${want}`,
        'the commit must name the task it ships: its Task: trailer, the task branch a merge commit brought in, or the full id in its subject');
    }
    if (noTask) warn(`${mergeCommit} names no task — ${noTask} ${want}`);
  }
  const body = run('git', ['log', '-1', '--format=%b', sha], { cwd }).stdout;
  return { sha, rec, body, date: run('git', ['log', '-1', '--format=%cs', sha], { cwd }).stdout };
}

// Which PRs/MRs merged a commit, asked of the platform — the only reliable answer (the user's decision,
// 2026-10-20): a squash subject ending "(#N)" may cite an issue, and a GitLab merge names its MR only in
// the body. Returns { ok, prs: [numbers] } or { ok: false, reason }.
export function prsForCommit(platform, sha, { cwd, runner = run } = {}) {
  if (platform === 'gitlab') {
    const r = runner('glab', ['api', `projects/:id/repository/commits/${sha}/merge_requests`], { cwd });
    if (!r.ok) return { ok: false, reason: r.stderr || 'glab api failed' };
    try { return { ok: true, prs: (JSON.parse(r.stdout) || []).filter((m) => m?.state === 'merged').map((m) => Number(m.iid)).filter(Boolean) }; } catch { return { ok: false, reason: 'unreadable glab answer' }; }
  }
  const r = runner('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/pulls`], { cwd });
  if (!r.ok) return { ok: false, reason: r.stderr || 'gh api failed' };
  try { return { ok: true, prs: (JSON.parse(r.stdout) || []).filter((p) => p?.merged_at).map((p) => Number(p.number)).filter(Boolean) }; } catch { return { ok: false, reason: 'unreadable gh answer' }; }
}

// The ship of a task merged with no PR/MR, where the platform can be read: the commit names the task, and
// the platform says no PR merged it. A PR that did is named (so the ship keeps its approvers); a platform
// that cannot answer is a refusal, never a guess.
function shipWithoutPr(where, { story, task, repo, mergeCommit, today, runner, fetch }) {
  const c = checkCommit(where, { story, task, repo, mergeCommit, strict: true, fetch });
  const asked = prsForCommit(where.platform, c.sha, { cwd: where.checkout, runner });
  if (!asked.ok) throw err(CODE, `could not ask ${where.platform} whether a PR/MR merged ${mergeCommit}: ${asked.reason}`, `log in with \`${cliFor(where.platform)} auth login\`, or pass --pr <n> if one did`);
  if (asked.prs.length > 1) throw err(CODE, `${mergeCommit} is in more than one merged PR/MR: ${asked.prs.map((x) => `#${x}`).join(', ')}`, `name the one that shipped ${story}-${task}: yad build ship ${story} --task ${task} --repo ${repo} --pr <n>`);
  if (asked.prs.length) throw err(CODE, `${mergeCommit} was merged by PR/MR #${asked.prs[0]}`, `record it from that PR/MR, with its approvers: yad build ship ${story} --task ${task} --repo ${repo} --pr ${asked.prs[0]}`);
  return {
    story, task, repo, branch: null, pr: 'none', mergeCommit: c.sha, gates: [],
    ai_review: null, engineer_review: [], companion: { trailer: false, cards: false, chat: false },
    risk: null, shippedAt: c.date || today,
  };
}

const riskFromBody = (body) => (String(body).match(/^\s*Risk level:\s*(low|medium|high)\b/im) || [])[1]?.toLowerCase() || null;

// What a ship of `story`/`task` in `repo` needs before anything is asked or written — shared by `build ship`
// and `build merged`, so `merged` never answers "merged" for a ship `ship` would then refuse.
function shipContext(root, { story, task, repo, pr, verb }) {
  repoArg(repo, `yad build ${verb} ${story || '<story>'} --task <T01> --repo <name>`);
  if (!TASK_RE.test(String(task || ''))) throw err(CODE, `--task must be a task id such as T01 (got '${task ?? ''}')`, `yad build ${verb} ${story} --task T01 --repo ${repo}`);
  if (pr && pr !== true && !/^[1-9]\d*$/.test(String(pr))) throw err(CODE, `--pr must be the PR/MR number (got '${pr}')`, 'the number, not a URL or a branch');
  const ctx = storyContext(root, story);
  if (!ctx.storiesPassed) throw err(CODE, `the stories review has not passed, so ${story} is not approved for Build yet`, 'pass the stories review first (yad gate)');
  if (!ctx.entry.repos.includes(repo)) throw err(CODE, `${story} does not declare ${repo}`, `its repos: ${ctx.entry.repos.join(', ') || 'none'}`);
  storyStatusOk(ctx, story);
  const lane = lanes(ctx.buildState, story).repos[repo];
  if (isPlainObject(lane) && lane.status === 'skipped' && !laneStarted(lane)) {
    throw err(CODE, `${story} / ${repo} is skipped`, `\`yad unskip ${ctx.epic} ${story} --repo ${repo}\` before recording a ship there`);
  }
  return { ctx, where: registeredRepo(root, repo) };
}

// The refusal for a ship `writeShip` (or `shipBlocked`) will not write.
function shipRefused(res, { story, task, repo }) {
  if (res.reason === 'exists') throw err(CODE, `${story} / ${task} already has a ship in ${repo}`, 'one ship per task and repo');
  throw err(CODE, `${repo} shares a ship file name with ${res.repo || 'another repo'}`, 'repo names that differ only in punctuation cannot both ship this task');
}

export async function buildShip(root, { story, task, repo, pr, mergeCommit = null, approvers = [], followUp = false, byHand: byHandOk = true, today, fetch = true, runner = run, prReader = readPr } = {}) {
  if (mergeCommit && mergeCommit !== true && !/^[0-9a-f]{7,64}$/i.test(String(mergeCommit))) throw err(CODE, `--merge-commit must be a commit SHA (got '${mergeCommit}')`, 'the merge commit, 7 to 64 hex characters');
  const { ctx, where } = shipContext(root, { story, task, repo, pr, verb: 'ship' });
  let ship;
  // Read from the platform only in the repo's own checkout: from anywhere else `gh pr view <n>` reads that
  // folder's repo — the Product's own PR #n.
  const readable = where.platform && where.checkout && (runner !== run || platformReady(where.platform));
  // A follow-up (#350) is added to the task's ship, so the ship must be there; where the platform can be
  // read, it is read from its PR/MR, like the ship itself.
  const original = followUp ? readShips(ctx.epicDir).find((s) => s.story === story && s.task === task && s.repo === repo) : null;
  if (followUp && !original) throw err(CODE, `${story} / ${task} has no ship in ${repo} yet, so it has no follow-up`, `record the task's own ship first: yad build ship ${story} --task ${task} --repo ${repo} --pr <n>`);
  if (followUp && readable && (!pr || pr === true)) throw err(CODE, 'a follow-up is read from its merged PR/MR: --pr <n> is required', `yad build ship ${story} --task ${task} --repo ${repo} --pr <n> --follow-up`);
  const byHand = (mergeCommit && mergeCommit !== true) || approvers.length;
  // A task merged with no PR/MR (the user's decision, 2026-10-20): the commit is the evidence, so it must be
  // on the default branch and name the task. Nobody approved a PR, so there are no approvers.
  if (readable && (!pr || pr === true) && mergeCommit && mergeCommit !== true && !approvers.length) {
    ship = shipWithoutPr(where, { story, task, repo, mergeCommit, today, runner, fetch });
  } else if (readable && byHand) throw err(CODE, `the ship is read from PR #${pr || '?'} on ${where.platform}`, '--merge-commit and --approver are for a repo whose platform cannot be read; drop them');
  const usable = readable;
  if (where.platform && !where.checkout && !byHand) {
    throw err(CODE, `${repo} is not checked out here, so its PR cannot be read`, `\`yad repo clone ${repo}\` fetches it; or record it by hand with --merge-commit <sha> and --approver <login>`);
  }
  if (!ship && usable && (!pr || pr === true)) throw err(CODE, '--pr <n> is required', `the merged PR/MR the ship is read from: yad build ship ${story} --task ${task} --repo ${repo} --pr <n>`);
  if (ship) { /* recorded from the commit above */ } else if (usable) {
    const got = readMergedPr(where.platform, pr, { cwd: where.checkout, runner });
    if (!got.ok) throw err(CODE, `could not read PR #${pr} in ${repo}: ${got.reason}`, `log in with \`${cliFor(where.platform)} auth login\`, then run this again`);
    if (!got.merged) throw err(CODE, `PR #${pr} in ${repo} is not merged`, 'a ship is recorded once the PR/MR merges');
    if (!got.mergeCommit) throw err(CODE, `PR #${pr} in ${repo} is merged, but the platform names no merge commit`, 'record it from the commit instead: yad build ship … --merge-commit <sha> with no --pr');
    // The PR carries the task (`prCarries`): its branch names it, or — a grouped PR (#350) — its commits do.
    // The ship is never put on a task the PR does not carry.
    const { carries, tasks: group } = prCarries(where, pr, got, { story, task, runner });
    if (carries === 'other') throw err(CODE, group?.length ? `PR #${pr}'s commits carry ${group.join(', ')}, not ${story}-${task}` : `PR #${pr} is from ${got.branch}, which names another task than ${story}-${task}`, group?.length ? `check --task and --pr; a PR/MR carries a task by a commit's Task: trailer (what spec-link reads), not by a mention in a subject` : 'check --task and --pr');
    if (carries === 'none') warn(`PR #${pr} is from ${got.branch || '(no branch)'}, which names no task — check it is the PR for ${story}-${task}`);
    if (carries === 'group') info(`PR #${pr} is a grouped PR: its commits carry ${group.join(', ')}`);
    // A follow-up branch is never the task's own ship, and a follow-up should come from one. The name is the
    // task's own only when nothing else can be (`ownPrs`): before the ship, with no plain-named PR for the task.
    const follows = isFollowUpBranch(got.branch, story, task);
    if (follows && !followUp && !followUpIsOwn(ctx, where, { story, task, repo, runner, asked: { number: Number(pr), state: got.state || 'merged' } })) throw err(CODE, `PR #${pr} is from ${got.branch}, a follow-up branch of ${story}-${task}`, `add it to the task's ship: yad build ship ${story} --task ${task} --repo ${repo} --pr ${pr} --follow-up`);
    if (followUp && !follows) warn(`PR #${pr} is from ${got.branch || '(no branch)'}, not a follow-up branch (fix/${story}-${task}-followup-<words>) — check it is a follow-up of ${story}-${task}`);
    const pull = prReader(where.platform, pr, { cwd: where.checkout, runner });
    const seen = new Set();
    const engineerReview = [];
    for (const a of pull.ok ? mapApprovers(pull.reviews, { headOid: pull.headOid }) : []) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      engineerReview.push({ approver: a.name, engagement: a.engagement === 'verified' ? 'verified' : 'none' });
    }
    if (got.checksRead === false) warn(`could not read the checks of PR #${pr} — gates is left empty`);
    if (!pull.ok) warn(`could not read the approvals of PR #${pr} (${pull.reason}) — engineer_review is left empty; \`yad review reconcile\` fills it later`);
    // What merged must be on the default branch, and may not name another task — the same check as by hand.
    const c = checkCommit(where, { story, task, repo, mergeCommit: got.mergeCommit, strict: false, fetch, group: carries === 'group' ? group : null });
    ship = {
      story, task, repo, branch: got.branch, pr: got.url || `#${pr}`, mergeCommit: c.sha, gates: got.checks,
      ai_review: null, engineer_review: engineerReview,
      companion: { trailer: /<!--\s*yad:trailer\s*-->/.test(got.body), cards: false, chat: false },
      risk: riskFromBody(got.body), shippedAt: (got.mergedAt || '').slice(0, 10) || today,
    };
  } else {
    // No platform to ask: the person says what merged — never `yad build sync`, where no person vouches.
    if (!byHandOk) throw err(CODE, `${where.platform ? `${cliFor(where.platform)} cannot read` : `${repo} has no platform to read`} the PR/MR that merged ${story}-${task}`, 'a person records it: yad build ship … --merge-commit <sha> [--approver <login>]');
    if (!mergeCommit || mergeCommit === true) {
      throw err(CODE, where.platform ? `${cliFor(where.platform)} is not available to read the PR` : `${repo} has no platform to read the PR from`, '--merge-commit <sha> (and --approver <login> for each approver) records it by hand');
    }
    // In the repo's checkout the commit is checked as evidence too; only with no checkout is it taken as given.
    const c = where.checkout ? checkCommit(where, { story, task, repo, mergeCommit, strict: false, fetch, group: 'range' }) : null;
    // A commit whose own merge subject names a PR is that PR's: a different --pr is refused.
    const said = c ? prOfCommit(c.rec.subject, c.body) : null;
    if (said?.certain && pr && pr !== true && Number(pr) !== said.pr) throw err(CODE, `${mergeCommit} merged PR/MR #${said.pr}, not #${pr}`, `--pr ${said.pr}`);
    ship = {
      story, task, repo, branch: null, pr: pr && pr !== true ? `#${pr}` : 'local', mergeCommit: c ? c.sha : mergeCommit, gates: [],
      ai_review: null, engineer_review: approvers.map((a) => ({ approver: a, engagement: 'none' })),
      companion: { trailer: false, cards: false, chat: false }, risk: null, shippedAt: (c && c.date) || today,
    };
  }
  if (followUp) return addFollowUp(root, ctx, original, ship, { story, task, repo });
  const res = writeShip(ctx.epicDir, ship);
  if (!res.written) shipRefused(res, { story, task, repo });
  // The story is in Build now (the skill's rule); `build done` sets it shipped once every task is.
  const moved = setBuildStatus(ctx.storyFile, 'in-build');
  ok(`ship recorded: ${story} / ${task} in ${repo}${ship.mergeCommit ? ` (${String(ship.mergeCommit).slice(0, 12)})` : ''}`);
  if (moved.changed) info(`${story} is now in-build`);
  hand(`when every task has shipped: yad build done ${story}; commit with \`yad checkpoint --push\``);
  return { story, task, repo, changed: true, ship, file: rel(root, res.file) };
}

// Add a follow-up's merge to the task's ship, where the ship lives (its shard, or the folded log). The same
// PR/MR or merge commit twice is refused; the story's status is left as it is.
// The task a commit message carries, read as the spec-link gate reads it: git's own trailer parser
// (`git interpret-trailers --parse --no-divider`, the rules `%(trailers)` applies to a commit — the trailer
// block, the key in any case, folded values), then the FIRST non-empty `Task:` value, and only when it is a
// task id. Used on messages the platform returns; local commits are read by git itself (`gitTasks`).
const TASK_ID_ONLY = /^EP-[a-z0-9-]+-S\d+-T\d+$/;
// Run in the code repo's own checkout (`cwd`), so its git settings apply as they do to `gitTasks`. Throws
// when git cannot read the message: that is a failed read, never "no task".
export function trailerTask(message, { cwd } = {}) {
  const r = spawnSync('git', ['interpret-trailers', '--parse', '--no-divider'], { input: String(message || ''), encoding: 'utf8', cwd });
  if (r.error || r.status !== 0) throw new Error(`git interpret-trailers failed${r.error ? `: ${r.error.message}` : ''}`);
  for (const line of String(r.stdout).split('\n')) {
    const m = line.match(/^task[ \t]*:[ \t]*(.*?)[ \t]*$/i);
    if (m && m[1]) return TASK_ID_ONLY.test(m[1]) ? m[1] : null;
  }
  return null;
}

// The tasks the commits of a `git log` range carry: each commit's FIRST `Task:` trailer, read by git as the
// spec-link gate reads it. `null` when git cannot read the range.
function gitTasks(cwd, args) {
  const r = run('git', ['log', '--format=%(trailers:key=Task,valueonly,separator=%x1e)%x00', ...args], { cwd });
  if (!r.ok) return null;
  const ids = r.stdout.split('\0').map((x) => x.split('\x1e')[0].trim()).filter((v) => TASK_ID_ONLY.test(v));
  return [...new Set(ids)].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
}

// The tasks a PR/MR's own commits carry by their `Task:` lines (issue #350): a grouped PR carries several
// small tasks of one story, each commit naming its own. Asked of the platform — the one source every reader
// uses (`build ship`, `build merged`). `{ ok, tasks, partial }` or `{ ok: false, reason }`.
const COMMIT_PAGE = 100;
export function prTasks(platform, n, { cwd, runner = run } = {}) {
  let messages;
  if (platform === 'gitlab') {
    const r = runner('glab', ['api', `projects/:id/merge_requests/${n}/commits?per_page=${COMMIT_PAGE}`], { cwd });
    if (!r.ok) return { ok: false, reason: r.stderr || 'glab api merge_requests commits failed' };
    try { messages = (JSON.parse(r.stdout) || []).map((c) => c?.message || ''); } catch { return { ok: false, reason: 'unreadable glab answer' }; }
  } else {
    // The whole message, as the commit holds it: `gh pr view --json commits` splits it into a headline and a
    // body, and joining them back can make a trailer the commit does not have.
    const r = runner('gh', ['api', `repos/{owner}/{repo}/pulls/${n}/commits?per_page=${COMMIT_PAGE}`], { cwd });
    if (!r.ok) return { ok: false, reason: r.stderr || 'gh api pulls commits failed' };
    try { messages = (JSON.parse(r.stdout) || []).map((c) => c?.commit?.message || ''); } catch { return { ok: false, reason: 'unreadable gh answer' }; }
  }
  if (!Array.isArray(messages)) return { ok: false, reason: 'unreadable answer' };
  let tasks;
  try { tasks = [...new Set(messages.map((m) => trailerTask(m, { cwd })).filter(Boolean))]; } catch (e) { return { ok: false, reason: e.message }; }
  return { ok: true, tasks, partial: messages.length >= COMMIT_PAGE };
}

// Does PR/MR `n` (read as `got`) carry `story`-`task`? `this` — its branch names it; `group` — another task's
// branch, but its own commits carry this one too (a grouped PR); `other` / `none` — as `branchTask`. `tasks`
// is what its commits carry, when they were asked. One rule for `build ship` and `build merged`.
function prCarries(where, n, got, { story, task, runner }) {
  const byBranch = branchTask(got.branch, story, task);
  if (byBranch === 'this') return { carries: 'this', tasks: null };
  const asked = prTasks(where.platform, n, { cwd: where.checkout, runner });
  const id = `${story}-${task}`;
  if (asked.ok && asked.tasks.includes(id)) return { carries: 'group', tasks: asked.tasks };
  // A list cut short could hold the task further on: as unread as a failed read.
  if (!asked.ok || asked.partial) {
    if (byBranch === 'other') throw err(CODE, `PR/MR #${n} is from ${got.branch}, which names another task than ${id}, and its commits could not all be read to see whether it carries ${task} too${asked.ok ? ' (more than one page of them)' : `: ${asked.reason}`}`, asked.ok ? `a grouped PR/MR of ${COMMIT_PAGE} commits or more is not read; a group is for small tasks — give ${task} its own PR/MR` : /interpret-trailers/.test(asked.reason) ? 'check that git runs here, then run this again' : 'log in, then run this again');
    return { carries: byBranch, tasks: null };
  }
  // The commits were read and carry other tasks, not this one: that is evidence, whatever the branch says.
  if (byBranch === 'none' && asked.tasks.length) return { carries: 'other', tasks: asked.tasks };
  return { carries: byBranch, tasks: asked.tasks };
}

// The task ids the commits of `range` carry by `Task:` lines, merges left out — what the spec-link gate reads
// on a PR. `null` when git cannot read the range.
export function rangeTasks(cwd, range) {
  return gitTasks(cwd, ['--no-merges', range]);
}

// The size limit of a grouped PR (#350): `group_limit: { lines, files }` in the Product settings, 200 lines
// and 10 files by default. A value that is not a positive whole number is read as its default, and said.
export const GROUP_LIMIT = { lines: 200, files: 10 };
export function groupLimit(settings) {
  const raw = isPlainObject(settings) ? settings.group_limit : undefined;
  const out = { ...GROUP_LIMIT };
  const bad = [];
  if (raw !== undefined && !isPlainObject(raw)) bad.push('group_limit');
  for (const k of ['lines', 'files']) {
    const v = isPlainObject(raw) ? raw[k] : undefined;
    if (v === undefined) continue;
    if (Number.isInteger(v) && v > 0) out[k] = v;
    else bad.push(`group_limit.${k}`);
  }
  return { ...out, bad };
}

// How big a PR's change is, from the merge base (`base...HEAD`, three dots: what the PR adds, not what the
// base gained since): lines added + deleted, and files. A binary file counts as a file with no lines.
export function changeSize(cwd, base) {
  const r = run('git', ['diff', '--numstat', '-z', `${base}...HEAD`], { cwd });
  if (!r.ok) return null;
  let lines = 0;
  let files = 0;
  const parts = r.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i].match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
    if (!m) continue;
    files += 1;
    if (m[1] !== '-') lines += Number(m[1]);
    if (m[2] !== '-') lines += Number(m[2]);
    // A rename prints its two paths as the next two fields.
    if (m[3] === '') i += 2;
  }
  return { lines, files };
}

// The warning for a grouped PR over its size limit (#350): a group is for SMALL tasks. Warn only; nothing
// refuses on it. Returns the lines to print, or none.
export function groupWarnings(cwd, base, ids, settings) {
  if (!ids || new Set(ids).size < 2) return [];
  const out = [];
  const stories = [...new Set(ids.map((t) => t.replace(/-T\d+$/, '')))];
  if (stories.length > 1) out.push(`this PR/MR groups tasks of more than one story (${stories.join(', ')}) — a group is several small tasks of ONE story`);
  const limit = groupLimit(settings);
  if (limit.bad.length) out.push(`${limit.bad.join(', ')} in the Product settings is not a positive whole number — the default (${GROUP_LIMIT.lines} lines, ${GROUP_LIMIT.files} files) is used`);
  const size = changeSize(cwd, base);
  if (!size) out.push(`could not measure the change against ${base}, so the grouped PR's size limit was not checked`);
  else if (size.lines > limit.lines || size.files > limit.files) {
    out.push(`this grouped PR/MR (${ids.length} tasks) changes ${size.lines} lines in ${size.files} files — over the limit for a group (${limit.lines} lines, ${limit.files} files); split it, or open each task on its own`);
  }
  return out;
}

// The tasks a merge commit's own merged range carries by `Task:` lines (`<sha>^1..<sha>^2`) — a grouped PR
// recorded by hand, where the platform cannot be read. A squash or a fast-forward has no range: none.
function mergeRangeTasks(cwd, sha) {
  if (!run('git', ['rev-parse', '--verify', '--quiet', `${sha}^2`], { cwd }).ok) return [];
  return gitTasks(cwd, ['--no-merges', `${sha}^1..${sha}^2`]) || [];
}

// The PRs/MRs that can be the task's OWN (issue #350): those not named as follow-ups, and — only when there
// is none of those that is not closed — the follow-up-named ones, as a task may simply be about follow-ups
// (`…-T03-followup-reminders`). One rule for `build merged` and `build ship`.
export function ownPrs(prs) {
  const plain = prs.filter((x) => !x.followUp);
  return plain.some((x) => x.state !== 'closed') ? plain : prs;
}

// May the follow-up-named PR `asked` (`{ number, state }`) be the task's own ship? Not once the task has
// shipped, and not while a plain-named PR for it is open or merged. The asked PR always counts, even when it
// is older than the page the listing reads. A listing that fails is a refusal, never a guess.
function followUpIsOwn(ctx, where, { story, task, repo, runner, asked }) {
  if (readShips(ctx.epicDir).some((s) => s.story === story && s.task === task && s.repo === repo)) return false;
  const found = findTaskPrs(where.platform, { story, task }, { cwd: where.checkout, runner });
  if (!found.ok) throw err(CODE, `could not list the PRs/MRs of ${repo} to see whether this follow-up branch is ${story}-${task}'s own: ${found.reason}`, 'log in, then run this again');
  const prs = [...found.prs.filter((x) => x.number !== asked.number), { ...asked, followUp: true }];
  return ownPrs(prs).some((x) => x.number === asked.number);
}

// Two commit ids for the same commit: a ship recorded by hand may hold the short or upper-case form.
const sameSha = (a, b) => {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  return x.length >= 7 && y.length >= 7 && (x.startsWith(y) || y.startsWith(x));
};

function addFollowUp(root, ctx, original, ship, { story, task, repo }) {
  const prNo = (v) => (v == null ? null : prNumberFromUrl(String(v)) || String(v).replace(/^#/, ''));
  const entry = { pr: ship.pr, branch: ship.branch, mergeCommit: ship.mergeCommit, date: ship.shippedAt };
  const known = [original, ...(Array.isArray(original.followUps) ? original.followUps : [])];
  const bySha = (x) => sameSha(x?.mergeCommit, ship.mergeCommit);
  const dup = known.find((x) => bySha(x) || (!['local', 'none'].includes(entry.pr) && prNo(x?.pr) === prNo(entry.pr)));
  if (dup) throw err(CODE, `${dup === original ? `${story} / ${task}'s own ship` : `a follow-up of ${story} / ${task}`} already records ${bySha(dup) ? `merge ${String(ship.mergeCommit).slice(0, 12)}` : `PR/MR ${entry.pr}`}`, 'each follow-up is recorded once');
  const res = updateShip(ctx.epicDir, (s) => s.story === story && s.task === task && s.repo === repo, (s) => {
    s.followUps = [...(Array.isArray(s.followUps) ? s.followUps : []), entry];
  });
  if (!res.found) throw err(CODE, `${story} / ${task}'s ship in ${repo} could not be found to add the follow-up to`, 'run it again; if it repeats, check the build-log files');
  ok(`follow-up recorded on ${story} / ${task} in ${repo}${entry.mergeCommit ? ` (${String(entry.mergeCommit).slice(0, 12)})` : ''}`);
  hand('commit with `yad checkpoint --push`');
  return { story, task, repo, changed: true, followUp: entry, file: rel(root, res.file) };
}

// The PRs/MRs whose source branch carries `story`-`task`, newest first, from one page of the repo's PRs/MRs
// (any state). `{ ok, prs: [{ number, state, branch, url }], partial }` — `partial` when the page was full,
// so an older PR may not be in it — or `{ ok: false, reason }`. Run in the repo's own checkout: from anywhere
// else gh and glab read that folder's repo.
const PR_PAGE = 100;
export function findTaskPrs(platform, { story, task }, { cwd, runner = run } = {}) {
  let rows;
  if (platform === 'gitlab') {
    const r = runner('glab', ['api', `projects/:id/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=${PR_PAGE}`], { cwd });
    if (!r.ok) return { ok: false, reason: r.stderr || 'glab api merge_requests failed' };
    try { rows = (JSON.parse(r.stdout) || []).map((m) => ({ number: Number(m?.iid), state: glState(m?.state), branch: m?.source_branch || null, url: m?.web_url || null })); } catch { return { ok: false, reason: 'unreadable glab answer' }; }
  } else {
    const r = runner('gh', ['pr', 'list', '--state', 'all', '--limit', String(PR_PAGE), '--json', 'number,state,headRefName,url'], { cwd });
    if (!r.ok) return { ok: false, reason: r.stderr || 'gh pr list failed' };
    try { rows = (JSON.parse(r.stdout) || []).map((p) => ({ number: Number(p?.number), state: ghState(p?.state), branch: p?.headRefName || null, url: p?.url || null })); } catch { return { ok: false, reason: 'unreadable gh answer' }; }
  }
  if (!Array.isArray(rows)) return { ok: false, reason: 'unreadable answer' };
  return {
    ok: true, partial: rows.length >= PR_PAGE,
    prs: rows.filter((x) => x.number > 0 && x.state && branchTask(x.branch, story, task) === 'this').map((x) => ({ ...x, followUp: isFollowUpBranch(x.branch, story, task) })),
  };
}

// `yad build merged <story> --task <T> --repo <r> [--pr <n>] [--ship]` (issue #355) — asks the platform
// whether the task's PR/MR has merged, so the agent need not wait for a person to say so. The user's
// decisions (2026-10-20): one check per run (the agent runs it again later; nothing waits); the PR is found
// by the task's branch unless --pr names it; --ship records the ship through `build ship` once merged.
// Every answer is a `state`: shipped (a ship is already recorded), merged, open, closed (closed without a
// merge) or none (no PR/MR carries the task yet). A refusal is only for what the agent must fix.
//
// `--follow-up` (issue #350) asks the same of the task's FOLLOW-UP PRs/MRs instead — branches named
// `fix/<story>-<task>-followup-<words>` — after the task has shipped; `--ship` adds the merge to the ship's
// `followUps`. Without it, a shipped task is answered `shipped`, and before the ship a follow-up-named PR is
// the task's own only when no plain-named one is open or merged (`ownPrs`).
export async function buildMerged(root, { story, task, repo, pr = null, ship = false, followUp = false, today, fetch = true, runner = run, prReader = readPr } = {}) {
  const { ctx, where } = shipContext(root, { story, task, repo, pr, verb: 'merged' });
  const id = `${story}-${task}`;
  const shipCmd = (n) => `yad build ship ${story} --task ${task} --repo ${repo} --pr ${n}${followUp ? ' --follow-up' : ''}`;
  const out = (state, extra = {}) => ({ story, task, repo, state, pr: null, url: null, mergeCommit: null, changed: false, ...(followUp ? { followUp: true } : {}), ...extra });
  const had = readShips(ctx.epicDir).find((s) => s.story === story && s.task === task && s.repo === repo);
  // A follow-up needs the task's ship; the PRs/MRs it already records are answered `shipped`.
  if (followUp && !had) throw err(CODE, `${story} / ${task} has no ship in ${repo} yet, so it has no follow-up`, `ask about the task's own PR first: yad build merged ${story} --task ${task} --repo ${repo}`);
  const prNo = (v) => (v == null ? null : prNumberFromUrl(String(v)) || String(v).replace(/^#/, ''));
  const recorded = new Set(followUp ? [had.pr, ...(Array.isArray(had.followUps) ? had.followUps.map((x) => x?.pr) : [])].map(prNo).filter(Boolean) : []);
  if (followUp && pr && pr !== true && recorded.has(String(Number(pr)))) {
    ok(`PR/MR #${Number(pr)} is already recorded on ${id}'s ship in ${repo}`);
    return out('shipped', { pr: Number(pr) });
  }
  // Already recorded: the same answer every time it is asked, with or without --ship.
  if (had && !followUp) {
    ok(`${id} already has a ship in ${repo}${had.mergeCommit ? ` (${String(had.mergeCommit).slice(0, 12)})` : ''}`);
    return out('shipped', { mergeCommit: had.mergeCommit || null });
  }
  if (!where.platform || !where.checkout || !(runner !== run || platformReady(where.platform))) {
    const why = !where.platform ? `${repo} has no platform to ask` : !where.checkout ? `${repo} is not checked out here` : `${cliFor(where.platform)} is not available`;
    throw err(CODE, `${why}, so yad cannot see whether ${id} merged`,
      !where.platform || where.checkout ? `once it has merged, record it by hand: yad build ship ${story} --task ${task} --repo ${repo} --merge-commit <sha>` : `\`yad repo clone ${repo}\` fetches it`);
  }
  let n = pr && pr !== true ? Number(pr) : null;
  // A PR/MR the dial opened (#356) is recorded on the lane: that number, before any search.
  const lane = lanes(ctx.buildState, story).repos[repo];
  const opened = !n && !followUp && isPlainObject(lane) && Array.isArray(lane.opened) ? lane.opened.filter((o) => o?.task === task && Number(o.pr) > 0).pop() : null;
  if (opened) {
    n = Number(opened.pr);
    info(`PR/MR #${n} was opened by the dial on ${opened.date || 'an earlier day'}`);
  }
  // The recorded PR closed without a merge: a person may have opened another, so search as usual.
  let first = null;
  if (opened) {
    first = readMergedPr(where.platform, n, { cwd: where.checkout, runner });
    if (first.ok && first.state === 'closed') {
      info(`PR/MR #${n}, opened by the dial, was closed without a merge — looking for another`);
      n = null;
      first = null;
    }
  }
  if (!n) {
    const found = findTaskPrs(where.platform, { story, task }, { cwd: where.checkout, runner });
    if (!found.ok) throw err(CODE, `could not list the PRs/MRs of ${repo}: ${found.reason}`, `log in with \`${cliFor(where.platform)} auth login\`, or pass --pr <n>`);
    // The task's own PRs, or (--follow-up) its follow-up PRs not yet recorded. A PR closed without a merge
    // never competes with a later one for the same task.
    // Without --follow-up the task has not shipped (a shipped task was answered above): its own PRs (`ownPrs`).
    const mine = followUp ? found.prs.filter((x) => x.followUp && !recorded.has(String(x.number))) : ownPrs(found.prs);
    const live = mine.filter((x) => x.state !== 'closed');
    if (live.length > 1) throw err(CODE, `more than one ${followUp ? 'follow-up ' : ''}PR/MR carries ${id}: ${live.map((x) => `#${x.number} (${x.state})`).join(', ')}`, `name the one to ask about: yad build merged ${story} --task ${task} --repo ${repo}${followUp ? ' --follow-up' : ''} --pr <n>`);
    // A closed follow-up owes nothing — the task has shipped — so it is `none`, not `closed`.
    if (!live.length && mine.length && !followUp) {
      const last = mine[0];
      warn(`PR/MR #${last.number} for ${id} was closed without a merge`);
      hand('open a new PR/MR for the task, or ask the person who closed it');
      return out('closed', { pr: last.number, url: last.url });
    }
    if (!live.length) {
      info(`no ${followUp ? 'follow-up ' : ''}PR/MR carries ${id} in ${repo} yet${followUp && recorded.size > 1 ? ' that is not already recorded' : ''}${found.partial ? ` among its newest ${PR_PAGE}` : ''}`);
      hand(found.partial ? `if it is older, name it: yad build merged ${story} --task ${task} --repo ${repo}${followUp ? ' --follow-up' : ''} --pr <n>`
        : followUp ? `a follow-up is opened from fix/${id}-followup-<words>`
          : `open it with \`yad open-pr\`, then run this again; in a grouped PR named after another task, name it: --pr <n>`);
      return out('none', { partial: found.partial });
    }
    n = live[0].number;
  }
  const got = first?.ok ? first : readMergedPr(where.platform, n, { cwd: where.checkout, runner });
  if (!got.ok) throw err(CODE, `could not read PR/MR #${n} in ${repo}: ${got.reason}`, `log in with \`${cliFor(where.platform)} auth login\`, then run this again`);
  // A number given by hand must carry this task: its branch, or (a grouped PR, #350) its commits.
  const { carries, tasks: group } = prCarries(where, n, got, { story, task, runner });
  if (carries === 'other') throw err(CODE, group?.length ? `PR/MR #${n}'s commits carry ${group.join(', ')}, not ${id}` : `PR/MR #${n} is from ${got.branch}, which names another task than ${id}`, 'check --task and --pr');
  const follows = isFollowUpBranch(got.branch, story, task);
  // A follow-up-named PR — named by --pr, recorded by the dial, or found — is the task's own only by the rule
  // `build ship` applies, so `merged` is never answered for a PR the ship then refuses.
  if (follows && !followUp) {
    if (!followUpIsOwn(ctx, where, { story, task, repo, runner, asked: { number: n, state: got.state || (got.merged ? 'merged' : 'open') } })) throw err(CODE, `PR/MR #${n} is from ${got.branch}, a follow-up branch, while ${id}'s own PR/MR is another`, `ask about the task's own: yad build merged ${story} --task ${task} --repo ${repo}`);
  }
  const state = got.state || (got.merged ? 'merged' : null);
  if (followUp && !follows && carries !== 'none' && !(ship && state === 'merged')) warn(`PR/MR #${n} is from ${got.branch}, not a follow-up branch (fix/${id}-followup-<words>) — check it is a follow-up of ${id}`);
  // Once, here — unless --ship hands a merged PR to `build ship`, which gives this warning itself.
  if (carries === 'none' && !(ship && state === 'merged')) warn(`PR/MR #${n} is from ${got.branch || '(no branch)'}, which names no task — check it is the PR for ${id}`);
  if (!state) throw err(CODE, `${where.platform} gave PR/MR #${n} a state yad does not know`, 'check it on the platform');
  const facts = { pr: n, url: got.url };
  if (state === 'open') {
    info(`PR/MR #${n} for ${id} is open — not merged yet`);
    hand(`run this again later; a person merges it`);
    return out('open', facts);
  }
  if (state === 'closed') {
    warn(`PR/MR #${n} for ${id} was closed without a merge`);
    hand('open a new PR/MR for the task, or ask the person who closed it');
    return out('closed', facts);
  }
  // Merged, but only an answer `build ship` would accept is `merged`: the same merge-commit checks run here
  // first (on the default branch, not naming another task), so a PR merged into a release branch or a
  // stacked parent is a refusal now, not a `merged` the ship then refuses.
  if (!got.mergeCommit) throw err(CODE, `PR/MR #${n} in ${repo} is merged, but the platform names no merge commit`, 'record it from the commit instead: yad build ship … --merge-commit <sha> with no --pr');
  // The warning for a commit naming no task is `build ship`'s to give, once, when it records; a read only asks.
  const c = checkCommit(where, { story, task, repo, mergeCommit: got.mergeCommit, strict: false, fetch, noTask: ship ? null : 'check it ships', group: carries === 'group' ? group : null });
  // A ship file `build ship` would not write (another repo's of the same file name, or one it cannot read).
  const blocked = followUp ? null : shipBlocked(ctx.epicDir, { story, task, repo });
  if (blocked) shipRefused(blocked, { story, task, repo });
  // A follow-up whose merge the ship already records is `shipped`, as `build ship --follow-up` would refuse it.
  if (followUp && [had, ...(Array.isArray(had.followUps) ? had.followUps : [])].some((x) => sameSha(x?.mergeCommit, c.sha))) {
    ok(`merge ${c.sha.slice(0, 12)} is already recorded on ${id}'s ship in ${repo}`);
    return out('shipped', { ...facts, mergeCommit: c.sha });
  }
  ok(`PR/MR #${n} for ${id} merged (${c.sha.slice(0, 12)})`);
  if (!ship) {
    hand(`record the ship: ${shipCmd(n)} (or run this again with --ship)`);
    return out('merged', { ...facts, mergeCommit: c.sha });
  }
  // The ship is written by `build ship` itself, never by a second path.
  const res = await buildShip(root, { story, task, repo, pr: String(n), followUp, today, fetch, runner, prReader });
  const rec = res.ship || res.followUp;
  return out('merged', { ...facts, mergeCommit: rec.mergeCommit, changed: true, ...(res.ship ? { ship: res.ship } : { entry: res.followUp }), file: res.file });
}

// `yad open-pr --via auto` (issue #356): the standing approval to open a task's PR/MR once its checks pass,
// without asking. The user's decisions (2026-10-20): one project-wide dial, `yad dial open-pr --to auto`,
// set by a person (nothing earned); `yad open-pr --via auto` refuses unless the dial is auto and THIS
// task's `checks` close names a run that passed and was not rejected; the opened PR is recorded on the lane
// (`opened`), so `yad build merged` and people can see the dial opened it. The merge stays a person's.
//
// PURE: may the PR/MR carrying `tasks` (one, or a group of one story's small tasks — #350) be opened without
// asking? `{ ok, runs: { T: run } }` or `{ ok: false, message, hint }`. One rule, for one task or several:
//   - the `checks` step is passed NOW — a step reopened (for a task of the group or the next) and not closed
//     again holds every task, so work its runs never checked is not opened;
//   - each task's NEWEST close (the current one, else the latest kept in `runs`) names it — on the close
//     (`--task`) or on the run it names; a close naming no task counts for none — and that run passed
//     (`checks=pass`) and was not rejected;
//   - no task of the group was already opened by the dial.
export function planAutoOpen(lane, trustRuns, { story, repo, task = null, tasks = null }) {
  const want = tasks || [task];
  const no = (message, hint) => ({ ok: false, message, hint });
  const at = `${story} / ${repo}`;
  if (!isPlainObject(lane) || !Array.isArray(lane.steps)) return no(`${at} has no lane`, 'the yad-run skill walks the lane before a PR is opened');
  const prior = (Array.isArray(lane.opened) ? lane.opened : []).find((o) => want.includes(o?.task));
  if (prior) return no(`${story}-${prior.task}'s PR/MR was already opened by the dial: #${prior.pr}`, 'ask the platform whether it merged: yad build merged … --ship; a new PR/MR for the task is opened by a person');
  const row = lane.steps.find((s) => s?.id === 'checks');
  const closeHint = (t) => `run the checks for ${t}, then close the step with its run and the task: yad build step ${story} --repo ${repo} checks done --run <uid> --task ${t}`;
  if (!isPassed(row) || !isPlainObject(row.closed) || !row.closed.run) return no(`${at}: checks is not closed${row?.task ? ` (it is open for ${row.task})` : ''}`, closeHint(row?.task || want[0]));
  const runOf = (uid) => (trustRuns || []).find((r) => r?.uid === uid && r.story === story && r.repo === repo && r.step === 'checks') || null;
  // Oldest first: `runs` in the order the closes were kept, then the current close.
  const closes = [...(Array.isArray(row.runs) ? row.runs : []), row.closed].filter((c) => isPlainObject(c) && c.run);
  const runs = {};
  for (const t of want) {
    const close = closes.filter((c) => (c.task || runOf(c.run)?.task || null) === t).pop();
    if (!close) return no(`${at}: checks has not closed for ${t}`, closeHint(t));
    const run = runOf(close.run);
    if (!run) return no(`${at}: the checks close for ${t} names trust run ${close.run}, which is not recorded`, 'record the run with `yad build trust`, then close the step with it');
    if (run.task && run.task !== t) return no(`${at}: the checks close for ${t} names run ${run.uid}, which is for ${run.task}`, closeHint(t));
    if (run.verdict === 'rejected') return no(`${at}: the checks run for ${t} (${run.uid}) is rejected`, 'fix what failed, run the checks again, and ask a person to open the PR/MR');
    if (run.signals?.checks !== 'pass') return no(`${at}: the checks run for ${t} (${run.uid}) did not record checks=pass`, 'a PR/MR is opened without asking only after the checks passed: yad build trust … checks --signal checks=pass');
    runs[t] = run;
  }
  return { ok: true, runs, run: runs[want[want.length - 1]] };
}

// The tasks a branch could carry, as `{ story, task }`, that are stories of this Product. A branch name has
// no end marker, so every reading is listed — each id starting at the branch's start or after a `/` or `_`,
// and ending where `-`, `_`, `/` or the end follows — and only those whose story file exists are kept:
// `feat/EP-x-S01-T01-then-S02-T03` and `feat/EP-aws-s3-t2-backup-S01-T01` each keep the one real task, and a
// branch carrying two real tasks keeps both (the caller refuses it).
export function branchTasks(root, branch) {
  const b = String(branch || '');
  const seen = new Map();
  for (let i = 0; i < b.length; i++) {
    if (i > 0 && !'/_'.includes(b[i - 1])) continue;
    if (b.slice(i, i + 3).toLowerCase() !== 'ep-') continue;
    for (let j = i + 1; j <= b.length; j++) {
      if (j < b.length && !'-_/'.includes(b[j])) continue;
      const m = b.slice(i, j).toLowerCase().match(/^ep-([a-z0-9-]+)-s(\d+)-t(\d+)$/);
      if (!m) continue;
      const story = `EP-${m[1]}-S${m[2]}`;
      if (!fs.existsSync(path.join(epicRoot(root, storyEpic(story)), 'stories', `${story}.md`))) continue;
      seen.set(`${story}-T${m[3]}`, { story, task: `T${m[3]}` });
    }
  }
  return [...seen.values()];
}

// The facts `yad open-pr --via auto` needs from the Product before anything is pushed: the dial, the lane
// and its checks run. Throws a refusal; returns `{ file }`, the build-state the record is written to.
export function autoOpenCheck(root, { story, task = null, tasks = null, repo }) {
  const want = tasks || [task];
  const eff = effectiveAction(loadAutomation(root), 'open-pr');
  if (eff.advance !== 'auto') {
    throw err(CODE, eff.why === 'kill' ? 'the open-pr dial is auto, but the kill switch (or an unreadable .sdlc/automation.json) holds it at human' : 'the open-pr dial is human, so a person approves opening this PR/MR',
      eff.why === 'kill' ? '`yad unkill` once the reason is gone, or ask a person to open it' : 'ask the person to approve it, then run `yad open-pr` without --via auto; `yad dial open-pr --to auto` is the standing approval');
  }
  const ctx = storyContext(root, story);
  if (!ctx.entry.repos.includes(repo)) throw err(CODE, `${story} does not declare ${repo}`, `its repos: ${ctx.entry.repos.join(', ') || 'none'}`);
  // A shipped task's checks close is the shipped work's: a follow-up is opened by a person.
  const shipped = want.find((t) => readShips(ctx.epicDir).some((s) => s.story === story && s.task === t && s.repo === repo));
  if (shipped) throw err(CODE, `${story}-${shipped} has already shipped in ${repo}`, `a follow-up PR/MR (fix/${story}-${shipped}-followup-<words>) is opened by a person`);
  const lane = lanes(ctx.buildState, story).repos[repo];
  const plan = planAutoOpen(lane, readTrustRuns(ctx.epicDir), { story, repo, tasks: want });
  if (!plan.ok) throw err(CODE, plan.message, plan.hint);
  return { file: ctx.file, run: plan.run.uid, runs: Object.fromEntries(Object.entries(plan.runs).map(([t, r]) => [t, r.uid])) };
}

// Record the PR/MR the dial opened on its lane. Re-read strictly: the file may have changed while the PR was
// being opened, and nothing here writes over content it cannot read.
// A grouped PR (#350) is recorded once per task it carries, each with its own checks run.
export function recordAutoOpen(file, { story, repo, task = null, tasks = null, runs = {}, pr, url, run, by, date }) {
  const bs = lanes(readJSONStrict(file, null), story);
  const lane = liveLane(bs, story, repo);
  const opened = [...(Array.isArray(lane.opened) ? lane.opened : []), ...(tasks || [task]).map((t) => ({ task: t, pr, url, via: 'auto', run: runs[t] || run, by, date }))];
  writeJSON(file, { ...bs, repos: { ...bs.repos, [repo]: { ...lane, opened } } });
}

export async function buildDone(root, { story, today, fetch = true } = {}) {
  const ctx = storyContext(root, story);
  // The epic is in Build — what featureStatus asks too: a reopened stories review takes it out again.
  if (nextAction(ctx.ledger).kind !== 'build') throw err(CODE, `${ctx.epic} is not in Build (its Shape chain is not finished)`, `\`yad next ${ctx.epic}\` says what is open`);
  storyStatusOk(ctx, story);
  const bs = lanes(ctx.buildState, story);
  const skipped = ctx.entry.repos.filter((r) => isPlainObject(bs.repos[r]) && bs.repos[r].status === 'skipped' && !laneStarted(bs.repos[r]));
  const ships = readShips(ctx.epicDir).filter((s) => s.story === story);
  // What each repo owes: its tasks.md on the repo's default branch, fetched first.
  const owed = {};
  const why = {};
  for (const repo of ctx.entry.repos) {
    if (skipped.includes(repo)) continue;
    const where = registeredRepo(root, repo);
    if (!where.checkout) { owed[repo] = null; why[repo] = 'not checked out here (`yad repo clone` fetches it)'; continue; }
    const head = run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: where.checkout }).stdout;
    const branch = where.defaultBranch || (head.startsWith('origin/') ? head.slice(7) : 'main');
    // A stale copy could miss a task added since: a failed fetch refuses, unless --no-fetch asked for the copy.
    if (fetch && !run('git', ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: where.checkout }).ok) {
      throw err(CODE, `could not fetch ${branch} in ${repo} to read the tasks it owes`, `check the network and your login, and that ${branch} is ${repo}'s default branch (default_branch in .sdlc/repos.json); or pass --no-fetch to read the last fetched copy`);
    }
    const show = (file) => run('git', ['show', `refs/remotes/origin/${branch}:specs/${story}/${file}`], { cwd: where.checkout });
    const shown = show('tasks.md');
    if (shown.ok) {
      owed[repo] = parseTaskIds(shown.stdout);
      if (!owed[repo].length) why[repo] = `specs/${story}/tasks.md on origin/${branch} names no task (T01, T02, …)`;
      continue;
    }
    // A light spec keeps its tasks in spec.md (#348) — only when its link.md says so.
    const link = show('link.md');
    const spec = link.ok ? show('spec.md') : null;
    if (!link.ok || !isLightSpec(link.stdout)) {
      owed[repo] = null;
      // A tasks block with no light mode named is most likely a link.md the reader cannot parse (CRLF, a
      // quoted value): say so, rather than only that tasks.md is missing.
      why[repo] = spec?.ok && lightTasksBlock(spec.stdout) !== null
        ? `no specs/${story}/tasks.md on origin/${branch}, and its link.md does not say \`spec-mode: light\` (plain, on its own line), so the tasks block in spec.md is not read`
        : `no specs/${story}/tasks.md on origin/${branch}`;
      continue;
    }
    const block = spec.ok ? lightTasksBlock(spec.stdout) : null;
    if (block === null) {
      owed[repo] = null;
      why[repo] = spec.ok
        ? `specs/${story}/spec.md on origin/${branch} is a light spec without one ${LIGHT_TASKS.begin} … ${LIGHT_TASKS.end} block`
        : `specs/${story}/link.md on origin/${branch} says spec-mode: light, but there is no spec.md`;
      continue;
    }
    owed[repo] = parseTaskIds(block);
    if (!owed[repo].length) why[repo] = `the tasks block of specs/${story}/spec.md on origin/${branch} names no task (T01, T02, …)`;
  }
  const plan = planDone({ story, declared: ctx.entry.repos, skipped, owed, ships });
  if (!plan.shipped) {
    for (const r of plan.unreadable) warn(`${r}: ${why[r]} — the tasks it owes cannot be read`);
    if (plan.missing.length) warn(`no ship yet for: ${plan.missing.join(', ')}`);
    throw err(CODE, `${story} is not shipped yet`, plan.missing.length ? `record each with \`yad build ship ${story} --task <T> --repo <r> --pr <n>\`` : 'make each repo\'s tasks.md (or a light spec\'s tasks block in spec.md) readable on its default branch, then run this again');
  }
  // Every owed repo has a lane, and every lane's earlier steps are done: `yad next` reads a repo with no
  // lane as still owed, so a story marked shipped without one would read shipped in one place and in-build
  // in another. A pre-tracking story (shipped before the Build ledger) takes `yad checkpoint --retro-ship`.
  if (!ctx.entry.repos.some((r) => !skipped.includes(r))) {
    throw err(CODE, `${story} owes no lane in any repo, so there is nothing to have shipped`, 'a story that needs no change in any repo is a question for its stories review');
  }
  // An empty `steps` is a half-seeded lane, which `yad next` reads as not started — never as shipped.
  const noLane = ctx.entry.repos.filter((r) => !skipped.includes(r) && !(isPlainObject(bs.repos[r]) && Array.isArray(bs.repos[r].steps) && bs.repos[r].steps.length));
  if (noLane.length) {
    throw err(CODE, `${story} has no lane in ${noLane.join(', ')}, so \`yad next\` would still read it in Build`,
      `\`yad build start ${story} --repo <r>\` and close its steps with \`yad build step\`; a story shipped before the Build ledger existed is recorded with \`yad checkpoint --retro-ship\` instead`);
  }
  const open = [];
  for (const repo of ctx.entry.repos.filter((r) => !skipped.includes(r))) {
    const lane = bs.repos[repo];
    for (const s of lane.steps) if (s?.id !== REVIEW_STEP && !isPassed(s)) open.push(`${repo}/${s?.id ?? '?'}`);
  }
  // Any other lane on disk (a repo the story does not declare, a name in another case) is read by `yad next`
  // too: one not finished would keep the story in Build there.
  const dupe = fs.existsSync(path.dirname(ctx.file)) ? fs.readdirSync(path.dirname(ctx.file)).filter((n) => n.endsWith('.json') && n !== `${story}.json`)
    .find((n) => readJSON(path.join(path.dirname(ctx.file), n), null)?.story === story) : null;
  if (dupe) throw err(CODE, `build-state/${dupe} also says story: ${story}`, 'yad next reads every file under build-state/: keep one per story');
  if (bs.story !== story) throw err(CODE, `build-state/${story}.json says story: ${bs.story}`, `set it to ${story}: yad next matches a lane to its story by that field`);
  const stray = Object.entries(bs.repos).filter(([r, l]) => !ctx.entry.repos.includes(r)
    && !(isPlainObject(l) && ((l.status === 'skipped' && !laneStarted(l)) || (Array.isArray(l.steps) && l.steps.length && l.steps.every(isPassed)))));
  if (stray.length) throw err(CODE, `build-state/${story}.json has a lane the story does not declare: ${stray.map(([r]) => r).join(', ')}`, '`yad doctor` reports it; remove it from the file, or add the repo to the story');
  const review = ctx.entry.repos.filter((r) => !skipped.includes(r)).filter((r) => bs.repos[r].steps.some((s) => s?.id === REVIEW_STEP && stepStatus(s) === 'blocked'));
  if (review.length) throw err(CODE, `${REVIEW_STEP} is blocked in ${review.join(', ')}`, `clear the halt first: \`yad build step ${story} --repo <r> ${REVIEW_STEP} in_progress\``);
  if (open.length) {
    throw err(CODE, `${story} has every task shipped, but these lane steps are still open: ${open.join(', ')}`, `close each with \`yad build step ${story} --repo <r> <step> done\`, then run this again`);
  }
  const by = recordActor(root);
  let changedLanes = 0;
  for (const repo of ctx.entry.repos.filter((r) => !skipped.includes(r))) {
    const lane = bs.repos[repo];
    const steps = lane.steps.map((s) => (s?.id === REVIEW_STEP && !isPassed(s) ? (changedLanes++, closeReview(s, { by, date: today })) : s));
    bs.repos[repo] = { ...lane, currentStep: REVIEW_STEP, steps };
  }
  // The lanes first, the status line last: if the run stops between the two, the story still reads in
  // Build to the seal and tidy — the safe side. A status line that cannot be set puts the lanes back.
  const storyText = fs.readFileSync(ctx.storyFile, 'utf8');
  const laneText = fs.existsSync(ctx.file) ? fs.readFileSync(ctx.file, 'utf8') : null;
  // The lanes first: a story file that could not be written (the usual cause) cannot be written back either.
  const restore = () => {
    if (laneText === null) fs.rmSync(ctx.file, { force: true }); else fs.writeFileSync(ctx.file, laneText);
    try { if (fs.readFileSync(ctx.storyFile, 'utf8') !== storyText) fs.writeFileSync(ctx.storyFile, storyText); } catch { /* left as it was */ }
  };
  if (changedLanes || !ctx.buildState?.story) writeJSON(ctx.file, bs);
  let moved;
  try {
    moved = setBuildStatus(ctx.storyFile, 'shipped');
  } catch (e) {
    restore();
    throw e;
  }
  if (moved.unknown || readFrontmatter(ctx.storyFile).status !== 'shipped') {
    restore();
    throw err(CODE, `could not set status: shipped in ${path.relative(ctx.epicDir, ctx.storyFile)}`, 'make it one plain `status:` line (with LF line endings), then run this again');
  }
  ok(`${story} is shipped${changedLanes ? ` — ${REVIEW_STEP} closed in ${changedLanes} lane${changedLanes > 1 ? 's' : ''}` : ''}`);
  if (sealedEpic(root, ctx.epic)) info(`${ctx.epic} is now sealed: every story shipped — new work there needs a change epic (yad-change)`);
  hand('commit with `yad checkpoint --push`');
  return { story, shipped: true, changed: changedLanes > 0 || !!moved.changed, lanesClosed: changedLanes };
}

// Does `story` have a Build lane in `repo` — the lanes `yad build start` and `yad-run` write? A skipped lane
// and a build-state that does not parse count as there: `yad build ship` refuses each with its own cause
// and fix (unskip; repair the file), which a person reads in the list — never "may predate tracking".
function laneIn(root, story, repo) {
  let bs;
  try { bs = readJSONStrict(path.join(epicFiles(epicRoot(root, storyEpic(story))).buildStateDir, `${story}.json`), null); } catch { return true; }
  if (bs == null) return false;
  // A file of the wrong shape is `yad build ship`'s to refuse, by its own cause.
  if (!isPlainObject(bs) || ('repos' in bs && !isPlainObject(bs.repos))) return true;
  const lane = isPlainObject(bs.repos) ? bs.repos[repo] : null;
  return isPlainObject(lane) && (Array.isArray(lane.steps) || lane.status === 'skipped');
}

// `yad build sync [<epic>]` (issue #365) — record the ships the code repos already show, so nobody has to
// type each `yad build ship` after a merge. The user's decisions (2026-10-21):
//   - a local command, run on the Product with the person's own gh/glab login; they commit the result with
//     `yad checkpoint --push` (no CI job);
//   - what it records is `yad reconcile check`'s list of tasks merged with no ship (`shipDrift`), each through
//     `yad build ship` itself: from the PR/MR that merged it, or — merged with no PR/MR — from its merge
//     commit where the platform confirms no PR/MR merged it;
//   - then `yad build done` for each story whose every task now has a ship.
// Nothing is guessed: a task it cannot record, a possible match, a story no file holds, a refusal from
// `build ship` or `build done` — each is listed with what to do, and the rest go on.
export async function buildSync(root, { epic = null, dryRun = false, today, fetch = true, runner = run, prReader = readPr, env = process.env } = {}) {
  if (epic && !/^EP-[a-z0-9-]+$/.test(String(epic))) throw err(CODE, `'${epic}' is not an epic id`, 'expected EP-<slug>, such as EP-checkout');
  if (epic && !epicIds(root).includes(epic)) throw err(CODE, `no epic ${epic} in this Product`, 'check the epic id: `yad next` lists the epics');
  const drift = shipDrift(root, { epics: epic ? new Set([epic]) : null, ...(runner !== run ? { runner } : {}), env });
  const recorded = [];
  const planned = [];
  const left = [];
  const touched = new Set();
  for (const f of drift.findings.filter((x) => x.kind === 'merged-no-ship')) {
    const at = { story: f.story, task: f.task, repo: f.repo };
    // Only a story yad tracks in Build there — a lane in that repo. One with no lane may predate tracking,
    // where `yad checkpoint --retro-ship` is the record, and a normal ship would close that door: a person
    // decides (the `fix` says both ways).
    if (!laneIn(root, f.story, f.repo)) { left.push({ ...at, why: `${f.story} has no Build lane in ${f.repo} — it may predate tracking`, fix: f.fix }); continue; }
    // The PR/MR that merged it: the platform's word when it has one; else the merge commit asks it.
    const pr = Number.isInteger(f.pr) ? f.pr : null;
    const how = pr ? { pr: String(pr) } : f.sha ? { mergeCommit: f.sha } : null;
    if (!how) { left.push({ ...at, why: 'no PR/MR and no merge commit is known for it', fix: f.fix }); continue; }
    const cmd = `yad build ship ${f.story} --task ${f.task} --repo ${f.repo} ${pr ? `--pr ${pr}` : `--merge-commit ${f.sha.slice(0, 12)}`}`;
    if (dryRun) { planned.push({ ...at, ...how, command: cmd }); touched.add(f.story); continue; }
    const ship = (h) => buildShip(root, { ...at, ...h, byHand: false, today, fetch, runner, prReader });
    try {
      let res;
      try { res = await ship(how); } catch (e) {
        // A merge commit the platform says a PR/MR merged: recorded from that PR/MR, with its approvers.
        const by = !pr && String(e.message).match(/was merged by PR\/MR #(\d+)$/);
        if (!by) throw e;
        res = await ship({ pr: by[1] });
      }
      recorded.push({ ...at, pr: res.ship.pr, mergeCommit: res.ship.mergeCommit, file: res.file });
      touched.add(f.story);
    } catch (e) {
      left.push({ ...at, why: e.message, fix: e.hint || f.fix, command: cmd });
    }
  }
  // Stories every task of which now has a ship — and those `reconcile check` already sees as shipped in the
  // code but not in their status — are set shipped by `build done`, which checks it all again.
  const done = [];
  const notDone = [];
  const candidates = [...new Set([...touched, ...drift.findings.filter((x) => x.kind === 'looks-shipped').map((x) => x.story)])].sort();
  for (const story of candidates) {
    if (dryRun) { planned.push({ story, command: `yad build done ${story}` }); continue; }
    try {
      await buildDone(root, { story, today, fetch });
      done.push(story);
    } catch (e) {
      notDone.push({ story, why: e.message, fix: e.hint || null });
    }
  }
  // What a person checks: a match by a short tag, a task naming a story no file holds, a repo not read.
  const forPerson = drift.findings.filter((x) => ['possible', 'no-story'].includes(x.kind));
  // What was not read is unknown, never an all-clear: a repo not read in full, an epic whose ledger does not
  // parse, a story that cannot be compared, a registry that cannot be read — as `yad reconcile check` says.
  const unread = [
    ...drift.repos.filter((r) => !r.read || r.partial),
    ...drift.unreadEpics.map((e) => ({ epic: e, read: false, why: 'its build ledger could not be read (`yad doctor` says why)' })),
    ...drift.uncompared.map((st) => ({ story: st, read: false, why: 'it names no repo while the Product registers more than one, or two story files claim its ID' })),
    ...(drift.registry ? [{ registry: true, read: false, why: `.sdlc/repos.json could not be read in full — ${drift.registry}` }] : []),
  ];

  if (dryRun) for (const p of planned) info(`would run: ${p.command}`);
  for (const r of recorded) ok(`recorded ${r.story} / ${r.task} in ${r.repo}`);
  for (const d of done) ok(`${d} is shipped`);
  for (const l of left) warn(`not recorded: ${l.story} / ${l.task} in ${l.repo} — ${l.why}${l.fix ? ` (${l.fix})` : ''}`);
  for (const n of notDone) info(`${n.story} not set shipped yet — ${n.why}`);
  for (const x of forPerson) warn(x.kind === 'possible' ? `${x.repo} ${String(x.sha || '').slice(0, 12)} may be ${x.stories.join(', ')} (${x.token}) — check it by hand` : `${x.repo} ${String(x.sha || '').slice(0, 12)} names ${x.task}, a story no file holds — check the trailer`);
  for (const r of unread) warn(`${r.repo || r.epic || r.story || 'repos.json'}: ${r.read ? 'read in part' : 'not read'}${r.why ? ` — ${r.why}` : r.note ? ` — ${r.note}` : ''}`);
  if (!dryRun && !recorded.length && !done.length && !left.length) {
    if (unread.length) info(`nothing recorded in what was read — ${unread.length} repo(s), ledger(s), stories or registry not read in full, so merged work there is unknown`);
    else ok('nothing to record — every merged task has a ship');
  }
  if (recorded.length || done.length) hand('commit with `yad checkpoint --push`');
  return {
    epic, dryRun, changed: recorded.length > 0 || done.length > 0,
    recorded, done, ...(dryRun ? { planned } : {}), left, notDone, forPerson, unread,
  };
}
