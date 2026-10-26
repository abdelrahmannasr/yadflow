// `yad status [--brief]` (#349) — where the work stands, in about 20 lines: the story this checkout is on,
// each open epic and its next action, the open PRs/MRs, and what is still owed. Read-only. It exists for
// the moment after a context reset (a person back from a break, an agent whose memory was summarised):
// one command instead of rebuilding the picture from several files and acting on a stale one.
//
// It reuses what the other views already compute — `yad next`'s action per epic, `yad standup`'s PR/MR
// reading — and adds no state of its own. `--brief` is the only form today, so `yad status` prints the same.
//
//   here    the task branch this checkout is on (feat/<story>-<task>-…) and its Build lane step
//   epics   each open epic: its step and the next action
//   prs     your open PRs/MRs on the Product and every registered repo (asked of the platform)
//   owed    steps deferred as debt, recorded blockers (Shape and Build), open hotfix debt, open
//           follow-up PRs/MRs (fix/<story>-<task>-followup-…)
import fs from 'node:fs';
import path from 'node:path';
import { c, log, info, hand, readJSON, exists, forTerminal, stripAnsi, run } from './lib.mjs';
import { isVerifiedLedger, productConfigPath, PROJECT_FILES } from './manifest.mjs';
import { epicRoot, epicStories, featureStatus, isPassed, loadLedger, doneStepUnapproved, reviewAsItStands, loadSkillBindings, buildNextForRepo, stepStatus, isValidEpicId, PRODUCT_DONE, PRODUCT_EPICS, STEPS } from './epic-state.mjs';
import { listEpics, epicAction, actionLine, skillPhrase, soloOf } from './next.mjs';
import { productGit, resolveDefaultBranch } from './productcommit.mjs';
import { repoSources } from './standup.mjs';
import { listPrs, prTarget } from './pr-list.mjs';
import { platformLogin } from './platform.mjs';
import { productIdentity } from './members.mjs';
import { taskFromBranch } from './commit.mjs';
import { isFollowUpBranch, storyEpic } from './build.mjs';
import { loadDebt } from './thread.mjs';
import { registryEntryFor } from './find-product.mjs';
import { readRegistry } from './workspace.mjs';

// How many rows each section shows before "+N more": the whole view stays near 20 lines (#349).
export const BUDGET = { epics: 5, prs: 4, owed: 4 };

const safe = (v) => forTerminal(String(v ?? ''));
const prWord = (platform) => (platform === 'gitlab' ? 'MR !' : 'PR #');
// A task id inside any follow-up branch name; `isFollowUpBranch` (#350's one rule) then confirms it.
// Case-sensitive, as a story id is (E117) — the same rule the task branch above is read by.
const FOLLOW_UP_ID = /(?:^|[/_])(EP-[a-z0-9-]+-S\d+-T\d+)-followup(?=$|[-_/])/;
export function followUpTask(branch) {
  const m = FOLLOW_UP_ID.exec(branch || '');
  if (!m) return null;
  const [, story, task] = /^(.+)-(T\d+)$/.exec(m[1]) || [];
  return story && isFollowUpBranch(branch, story, task) ? `${story}-${task}` : null;
}

// Finished epics are counted, not listed: the view is for what is still moving. "Shipped" is the engine's
// own rule (`featureStatus`: every story has every lane it declares, all shipped), never the lanes on disk
// alone — a story that has not begun Build has none. A shipped epic whose parallel test-cases track is
// still open is not finished, nor is one with a step re-opened behind it (E41), nor one with any Shape
// step not yet passed (a test-cases review still in review is not on `parallel`); a documented brownfield
// anchor is.
function finished(root, id, ledger, a) {
  if (PRODUCT_DONE.includes(a.kind) || a.kind === 'backfill-done') return true;
  if (a.kind !== 'build' || a.parallel || a.reopened?.length) return false;
  if ((Array.isArray(ledger?.state?.steps) ? ledger.state.steps : []).some((s) => s && !isPassed(s))) return false;
  return featureStatus(ledger, { stories: epicStories(epicRoot(root, id)) }) === 'shipped';
}
// A lane's steps, only when they are a list of steps with an id (build-state is advisory: a bad file is
// skipped, never a crash — `loadBuildStates`).
const laneSteps = (lane) => (Array.isArray(lane?.steps) ? lane.steps.filter((s) => s && typeof s.id === 'string') : []);
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

// The registered repo this checkout is. A monorepo registers the Product's own folder (`path: "."`), which
// `registryEntryFor` never answers (it is a code-repo command's guard), so that one case is matched here.
// So is a git worktree of a registered repo (agents often work in one): `registryEntryFor` refuses it on
// purpose — a command that WRITES must not swap one checkout for another — but this view only reads, and
// the branch it reports is the worktree's own. The worktree's main checkout names the repo.
function repoHere(root, cwd, top) {
  const hit = registryEntryFor(root, cwd)?.meta?.name;
  if (typeof hit === 'string') return hit;
  const common = run('git', ['rev-parse', '--git-common-dir'], { cwd });
  const gitDir = common.ok && common.stdout ? path.resolve(cwd, common.stdout) : null;
  if (gitDir && path.basename(gitDir) === '.git' && real(path.dirname(gitDir)) !== real(top)) {
    const main = registryEntryFor(root, path.dirname(gitDir))?.meta?.name;
    if (typeof main === 'string') return main;
  }
  if (real(top) !== real(root)) return null;
  const own = readRegistry(root).registry.repos.find((r) => typeof r?.path === 'string' && typeof r.name === 'string' && real(path.resolve(root, r.path)) === real(root));
  return own?.name ?? null;
}

// The checkout this was run in: its branch, and — on a task branch — the story's lane in this repo.
function hereOf(root, cwd, ledgers, views) {
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd });
  if (!top.ok) return { branch: null, task: null, why: 'not inside a git repo' };
  // `symbolic-ref` names the branch on a repo with no commit yet too; a detached HEAD has none.
  const head = run('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd });
  const branch = head.ok && head.stdout ? head.stdout : null;
  const repo = repoHere(root, cwd, top.stdout);
  const id = branch ? taskFromBranch(branch) : null;
  // Case-sensitive, as story ids are (E117): `feat/ep-pay-s01-t02` names no story, so it is not a task branch.
  const m = id ? /^(EP-[a-z0-9-]+-S\d+)-(T\d+)$/.exec(id) : null;
  if (!m) return { branch, task: null, repo, why: branch ? 'not a task branch' : 'no branch checked out' };
  const [, story, task] = m;
  const epic = storyEpic(story);
  const here = { branch, task, story, epic, repo, followUp: !!followUpTask(branch), step: null, status: null, reason: null };
  if (!repo) return { ...here, why: 'this checkout is not a repo the Product registers' };
  const bs = (ledgers.get(epic)?.buildStates || []).find((b) => b?.story === story);
  const lane = bs?.repos?.[repo];
  if (!lane || typeof lane !== 'object') return { ...here, why: `${story} has no Build lane in ${repo} yet` };
  // Only the steps that are steps: a `null` or a bare word in the list is not one (build-state is advisory).
  // With the epic's own skill bindings, as `yad next` reads the lane — a project may bind another skill.
  const next = buildNextForRepo({ ...lane, steps: laneSteps(lane) }, { bindings: views.get(epic) ?? null });
  if (next.status === 'skipped') return { ...here, why: `the lane is skipped in ${repo}${next.record?.reason ? ` — ${next.record.reason}` : ''}` };
  if (next.status === 'unknown') return { ...here, why: `the lane in ${repo} has no steps yet` };
  const active = laneSteps(lane).find((s) => s.id === next.step);
  return { ...here, step: next.step, status: next.status, shipped: !!next.shipped, skill: next.skill ?? null,
    reason: stepStatus(active) === 'blocked' ? active?.record?.reason ?? null : null };
}

// What is still owed, from the files: debt steps, recorded blockers, open hotfix debt.
function owedOf(root, id, ledger, action, { solo = false, trunk = () => 'main' } = {}) {
  const out = [];
  for (const d of action.debt || []) out.push({ kind: 'debt', epic: id, step: d.step, status: d.status, reason: d.record?.reason ?? null });
  // A blocker is `blocked` WITH a record (E38); a bare `blocked` is the old spelling of `todo`.
  for (const s of Array.isArray(ledger?.state?.steps) ? ledger.state.steps : []) {
    if (s && typeof s.id === 'string' && stepStatus(s) === 'blocked') out.push({ kind: 'blocked', epic: id, step: s.id, reason: s.record?.reason ?? null });
  }
  for (const bs of ledger?.buildStates || []) {
    for (const [repo, lane] of Object.entries(bs?.repos || {})) {
      if (lane?.status === 'skipped') continue;
      for (const s of laneSteps(lane)) {
        if (stepStatus(s) === 'blocked') out.push({ kind: 'blocked', epic: id, story: bs.story ?? null, repo, step: s.id, reason: s.record?.reason ?? null });
      }
    }
  }
  // A done review whose artifact changed after it was approved (#418): owed a fresh review, with the steps
  // the gate prints. Not in solo mode, where no approval is counted and the gate says nothing either.
  for (const s of !solo && Array.isArray(ledger?.state?.steps) ? ledger.state.steps : []) {
    if (doneStepUnapproved(epicRoot(root, id), s, ledger?.approvals)) out.push({ kind: 'unapproved-change', epic: id, step: s.id, artifact: s.artifact, fix: reviewAsItStands(id, s.artifact, trunk()) });
  }
  const open = loadDebt(root, id).filter((d) => d?.status === 'open');
  if (open.length) out.push({ kind: 'hotfix-debt', epic: id, count: open.length });
  return out;
}

// The open PRs/MRs of the Product and every registered repo, read the way `yad standup` reads them.
function prsOf(root, { env, runner }) {
  const productConfig = readJSON(productConfigPath(root), null);
  const identity = productIdentity(root, { productConfig, ...(runner ? { runner } : {}) });
  const notRead = [];
  const sources = repoSources(root, identity, productConfig, notRead, env);
  // An unreadable registry means no code repo was asked at all: their PRs/MRs are unknown, not none.
  const registry = readRegistry(root);
  const missing = registry.problem ? [{ label: 'the registered repos', why: registry.problem }] : [];
  const seen = new Set();
  const authCache = new Map();
  const logins = new Map();
  const read = [];
  for (const s of sources) {
    const target = prTarget({ platform: s.platform, gitUrl: s.gitUrl }, { env, authCache, ...(runner ? { runner } : {}) });
    const key = target.host && target.repo ? `${target.host}/${target.repo}`.toLowerCase() : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const t = target.ok ? listPrs(target, { sinceMs: Date.now(), env, authCache, ...(runner ? { runner } : {}) }) : target;
    if (!t.ok) { missing.push({ label: s.label, why: t.why }); continue; }
    const who = `${t.platform}\0${t.host}`;
    if (!logins.has(who)) logins.set(who, platformLogin(root, t.platform, { env, host: t.host, ...(runner ? { runner } : {}) }));
    read.push({ label: s.label, platform: t.platform, login: logins.get(who), open: t.open, partial: !!t.openPartial });
  }
  const all = read.flatMap((p) => p.open.map((pr) => ({ repo: p.label, platform: p.platform, number: pr.number, author: pr.author, draft: !!pr.draft,
    checks: pr.checks ?? null, review: pr.review ?? null, branch: pr.branch ?? null, task: pr.branch ? taskFromBranch(pr.branch) : null,
    mine: p.login && pr.author ? p.login.toLowerCase() === String(pr.author).toLowerCase() : null })));
  const known = read.length > 0 && read.every((p) => p.login);
  return {
    asked: true,
    // Yours, when every platform said who you are; else every open one, and the view says so. `none` when
    // no repo answered at all: the count is unknown, not 0.
    listed: known ? all.filter((p) => p.mine) : all,
    whose: !read.length ? 'none' : known ? 'yours' : 'all',
    others: known ? all.filter((p) => !p.mine).length : 0,
    followUps: all.filter((p) => followUpTask(p.branch)).map((p) => ({ ...p, task: followUpTask(p.branch) })),
    partial: read.filter((p) => p.partial).map((p) => p.label),
    notRead: missing,
  };
}

// The whole view as data — what `--json` answers and the lines are drawn from.
export function buildStatus(root, { cwd = root, fetch = true, env = process.env, runner } = {}) {
  const productConfig = readJSON(productConfigPath(root), null);
  const setUp = exists(path.join(root, PROJECT_FILES.version)) || !!productConfig;
  if (!setUp) return { setUp: false };
  const bindings = loadSkillBindings(root);
  const solo = soloOf(productConfig);
  let trunkName = null;   // asked of git only when a fresh review is owed
  const trunk = () => (trunkName ??= resolveDefaultBranch(productGit(root), productConfig));
  const verified = isVerifiedLedger(productConfig);
  const ledgers = new Map();
  const views = new Map();
  const epics = [];
  const owed = [];
  let finishedCount = 0;
  for (const id of listEpics(root)) {
    if (!isValidEpicId(id)) continue;
    let ledger;
    try { ledger = loadLedger(epicRoot(root, id)); } catch { epics.push({ epic: id, problem: 'its ledger does not load — run `yad doctor`' }); continue; }
    ledgers.set(id, ledger);
    const { action, view } = epicAction(root, id, undefined, bindings);
    views.set(id, view);
    owed.push(...owedOf(root, id, ledger, action, { solo, trunk }));
    if (finished(root, id, ledger, action)) { finishedCount += 1; continue; }
    // The same words `yad next` prints, with the parallel test-cases track and any re-opened step beside
    // the chain's own action — they are what keeps a shipped epic open.
    // A step already named, and the review of an author step already named: that review cannot start
    // before its author step is done, so it is not "open" beside it.
    const named = new Set([action.parallel?.step, ...(action.reopened || []).map((l) => l?.step)].filter(Boolean));
    for (const r of STEPS) if (r.kind === 'review' && named.has(r.reviews)) named.add(r.id);
    const also = [
      ...(action.parallel ? [`parallel: invoke ${skillPhrase(action.parallel)}`] : []),
      ...(action.reopened || []).map((l) => `re-opened: ${actionLine({ ...l, epicId: id }, { solo, bindings: view, verified })}`),
      // In Build, any other Shape step not yet passed (a test-cases review still in review, say) is what
      // keeps the epic open, so it is named too — the Build line alone would read "every lane shipped".
      ...(action.kind === 'build' ? (Array.isArray(ledger?.state?.steps) ? ledger.state.steps : [])
        .filter((s) => s && typeof s.id === 'string' && !isPassed(s) && !named.has(s.id))
        .map((s) => `open: ${s.id} (${stepStatus(s) ?? (typeof s.status === 'string' ? s.status : 'no status')})`) : []),
    ];
    epics.push({ epic: id, product: PRODUCT_EPICS.includes(id), kind: action.kind, step: action.step ?? null, status: action.status ?? null,
      next: stripAnsi([actionLine(action, { solo, bindings: view, verified }), ...also].join(' · ')) });
  }
  const here = hereOf(root, cwd, ledgers, views);
  const prs = fetch ? prsOf(root, { env, runner }) : { asked: false };
  for (const f of prs.followUps || []) owed.push({ kind: 'follow-up-pr', repo: f.repo, platform: f.platform, number: f.number, task: f.task });
  return { setUp: true, here, epics, finished: finishedCount, prs, owed };
}

// The view as lines, each section held to its budget.
export function briefLines(m) {
  if (!m.setUp) return ['Project not set up yet — run yad setup'];
  const out = [];
  const more = (n, where) => (n > 0 ? [`  … +${n} more — ${where}`] : []);
  const h = m.here;
  if (h.task) {
    // A blocked step names what it waits on, not a skill to run (#349).
    const at = h.step ? `${h.step} (${h.status})${h.reason ? ` — blocked: ${safe(h.reason)}` : h.skill ? ` — next: ${h.skill}` : ''}`
      : h.shipped ? 'every step done' : safe(h.why);
    out.push(`here: ${h.story} ${h.task}${h.followUp ? ' follow-up' : ''}${h.repo ? ` in ${safe(h.repo)}` : ''} — ${at}`);
  } else out.push(`here: ${h.branch ? `${safe(h.branch)}, ` : ''}${safe(h.why)}`);
  out.push(`epics: ${m.epics.length} open${m.finished ? `, ${m.finished} finished (not shown)` : ''}`);
  for (const e of m.epics.slice(0, BUDGET.epics)) {
    out.push(e.problem ? `  ${e.epic} — ${e.problem}` : `  ${e.epic} ${e.step ?? '—'}${e.status && e.status !== e.step ? ` (${e.status})` : ''} — next: ${e.next}`);
  }
  out.push(...more(m.epics.length - BUDGET.epics, 'yad next --all'));
  const p = m.prs;
  if (!p.asked) out.push('open PRs/MRs: not asked (--no-fetch)');
  else {
    if (p.whose === 'none') out.push('open PRs/MRs: unknown — no repo could be read');
    else out.push(`open PRs/MRs (${p.whose}): ${p.listed.length}${p.whose === 'yours' && p.others ? ` — ${p.others} by others` : ''}${p.whose === 'all' ? ' — who you are on the platform is not known, so every open one is listed' : ''}`);
    for (const x of p.listed.slice(0, BUDGET.prs)) {
      const facts = [x.draft ? 'draft' : null, x.checks ? `checks ${x.checks}` : null, x.review ? `review ${x.review}` : null].filter(Boolean);
      out.push(`  ${safe(x.repo)} ${prWord(x.platform)}${x.number}${x.task ? ` ${x.task}` : ''}${facts.length ? ` — ${facts.join(', ')}` : ''}`);
    }
    out.push(...more(p.listed.length - BUDGET.prs, 'yad standup'));
    // Only one page of open PRs/MRs is read per repo: the counts above are then too low, and say so.
    if (p.partial.length) out.push(`  more open PRs/MRs than one page holds in ${p.partial.map(safe).join(', ')} — only the newest were read`);
    // One line for every repo not read, so a team with many repos offline does not fill the view.
    if (p.notRead.length) out.push(`  platform not read for ${p.notRead.map((n) => safe(n.label)).join(', ')} — PR/MR facts there are unknown, not none`);
  }
  out.push(`owed: ${m.owed.length ? m.owed.length : 'nothing'}`);
  for (const o of m.owed.slice(0, BUDGET.owed)) out.push(`  ${owedLine(o)}`);
  out.push(...more(m.owed.length - BUDGET.owed, 'yad next --all, yad reconcile check, yad standup'));
  // Every line is made safe at the end, in one place: values from shared files and from the platform (a
  // branch name, a record's author, a skill name) reach the terminal only as plain text.
  return out.map(forTerminal);
}

function owedLine(o) {
  if (o.kind === 'debt') return `${o.epic}: ${o.step.replace(/-review$/, '')} owed as debt (${o.status})${o.reason ? ` — ${safe(o.reason)}` : ''}`;
  if (o.kind === 'blocked') return `${o.epic}${o.story ? ` ${o.story} in ${safe(o.repo)}` : ''}: ${o.step} blocked${o.reason ? ` — ${safe(o.reason)}` : ''}`;
  if (o.kind === 'hotfix-debt') return `${o.epic}: ${o.count} open hotfix debt — yad reconcile check`;
  if (o.kind === 'unapproved-change') return `${o.epic}: ${safe(o.step)} is done, but ${safe(o.artifact)} changed after it was approved — ${safe(o.fix)}`;
  return `${safe(o.repo)} ${prWord(o.platform)}${o.number}: open follow-up of ${o.task}`;
}

export async function runStatus(root, { cwd = root, json = false, fetch = true, env = process.env, runner } = {}) {
  const m = buildStatus(root, { cwd, fetch, env, runner });
  if (json) return m;
  log('');
  for (const line of briefLines(m)) log(`  ${line}`);
  if (m.setUp) info(c.dim('detail: yad next <epic> · yad standup · yad doctor'));
  else hand(`run ${c.bold('yad setup')}`);
  return undefined;
}
