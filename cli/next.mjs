// `yad next` — the unified next-step driver. Read-only: it never writes state or acts. It reads the
// file ledger and prints the ONE concrete, copy-pasteable next action (and a one-line why), so a user
// never has to remember which of the 31 skills / gate commands comes next. "Guide, don't act" — the
// front half still never auto-advances. Once an epic is `ready-for-build`, it reads each story's
// build-state and prints the next BUILD sub-step per repo (spec → implement → checks → engineer-review)
// plus the remaining chain — so the build half is guided too, not just hinted at.
//
//   yad next                  general orientation across the whole project
//   yad next <epic>           the single next action for one epic
//   yad next <epic> --check <step>   exit 0 if <step> is runnable now, else 1 (the precondition guard)
//   yad next --all            every active epic's next action at once
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, info, warn, hand, fail, readJSON, exists } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { epicRoot, loadLedger, nextAction, preconditionsMet, isValidEpicId, DISCOVERY_EPIC } from './epic-state.mjs';

// Is solo mode on? Persisted in hub.json by setup (Phase C/D); default false. Read defensively so a
// missing/old hub.json never breaks the driver.
function isSolo(root) {
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig), null);
  return !!(hub && (hub.solo === true || hub.review_gate?.solo === true));
}
// The setup profile recorded by `yad setup` (codebase / repo_layout / team_size), or null.
const profileOf = (root) => readJSON(path.join(root, PROJECT_FILES.hubConfig), null)?.profile || null;
// Has `yad setup` run here? True once the version stamp or hub config exists.
const isSetUp = (root) => exists(path.join(root, PROJECT_FILES.version)) || exists(path.join(root, PROJECT_FILES.hubConfig));

// Every epic that has a state ledger, in directory order.
function listEpics(root) {
  const dir = path.join(root, 'epics');
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidEpicId(e.name))
    .map((e) => e.name)
    .filter((id) => exists(path.join(dir, id, '.sdlc', 'state.json')))
    .sort();
}

// EP-istifta-inquiries-S03 → S03 (the compact lane label for the roll-up). Falls back to the full id.
const shortStory = (s) => (s && s.match(/S\d+$/i)?.[0]) || s || '(story)';

// Every per-repo lane across the build, flattened with its story id attached.
const buildLanes = (builds = []) => builds.flatMap((b) => b.repos.map((r) => ({ ...r, story: b.story })));

// The dial note for a build lane: a machine_advance lane is driven by yad-run; everything else stops
// for a human (the locked engineer-review always does).
function dialNote(r) {
  if (r.locked) return c.dim('human merge gate');
  return r.automation === 'machine_advance'
    ? c.dim('machine_advance — yad-run auto-drives')
    : c.dim('human_approve');
}

// The detailed per-story/per-repo build lanes for `printAction`. Each open lane is a 2-line block:
// a header naming the active step + dial, then the actionable `▸` skill line with the remaining chain.
function printBuildLanes(builds) {
  for (const lane of buildLanes(builds)) {
    const where = `${c.cyan(lane.story || '(story)')} / ${c.bold(lane.repo)}`;
    if (lane.shipped) { log(`    ${where} ${c.green('— shipped ✓')}`); continue; }
    // No resolvable next skill (an empty/half-seeded build-state file): show it as not-started, no ▸.
    if (!lane.skill) { log(`    ${where} ${c.dim('— not started yet (no build steps recorded)')}`); continue; }
    log(`    ${where} ${c.dim('—')} ${c.bold(lane.step)}  (${dialNote(lane)})`);
    const rest = (lane.chain || []).slice(1);
    const then = rest.length ? `   ${c.dim(`then → ${rest.join(' → ')}`)}` : '';
    hand(`invoke the ${c.bold(lane.skill)} skill${then}`);
  }
}

// A short, copy-pasteable line for one action — the `▸` line a user can act on directly.
function actionLine(a, { solo } = {}) {
  switch (a.kind) {
    case 'new':
      return `invoke the ${c.bold(a.skill)} skill ${c.dim('(author the epic)')}`;
    case 'author':
      return `invoke the ${c.bold(a.skill || ('yad-' + a.step))} skill ${c.dim(`(author ${a.artifact})`)}`;
    case 'review-open':
    case 'review-sync':
      return `${c.bold(a.command)}${solo ? c.dim('   (solo: no approval needed — just merge your own PR)') : ''}`;
    case 'build': {
      // In the build half: compact the lanes to "N lane(s) in build — next: <skill> @ <story>/<repo>".
      if (a.builds?.length) {
        const open = buildLanes(a.builds).filter((r) => !r.shipped);
        if (!open.length) return c.dim('build half — every lane shipped');
        // Headline the first lane with a resolvable next skill; if none, the half is started but unspecced.
        const first = open.find((r) => r.skill);
        if (!first) return c.dim(`${open.length} lane(s) in build — not specced yet`);
        return `${c.dim(`${open.length} lane(s) in build — next:`)} ${c.bold(first.skill)} ${c.dim(`@ ${shortStory(first.story)}/${first.repo}`)}`;
      }
      return `${c.bold('yad-run')} ${c.dim('(or per story: yad-spec → yad-implement → yad ship → yad-engineer-review)')}`;
    }
    case 'discovery-done':
      return `invoke the ${c.bold('yad-epic')} skill ${c.dim('(seed a feature epic from roadmap.md)')}`;
    default:
      return c.dim('nothing to do');
  }
}

// Full, friendly printout for a single epic.
function printAction(a, { solo } = {}) {
  log(`\n  ${c.bold(a.epicId || '(epic)')} ${c.dim(`— ${a.why}`)}`);
  // In the build half with live lanes, print each story/repo's next sub-step + remaining chain instead
  // of the single static hint; otherwise the one actionable line.
  if (a.kind === 'build' && a.builds?.length) printBuildLanes(a.builds);
  else hand(actionLine(a, { solo }));
  if (a.kind === 'review-sync') info(c.dim(`unresolved comments? ${c.bold(`yad gate comments ${a.epicId} ${a.artifact}`)}`));
  if (a.parallel) hand(`parallel track: invoke the ${c.bold(a.parallel.skill)} skill ${c.dim(`(author ${a.parallel.artifact})`)}`);
}

// `yad next` with no epic: orient across the whole project, always ending on ONE thing to do.
function generalNext(root, { all } = {}) {
  if (!isSetUp(root)) {
    log(`\n  ${c.bold('Project not set up yet.')}`);
    hand(`run ${c.bold('yad setup')} ${c.dim('(then come back to `yad next`)')}`);
    return;
  }
  const solo = isSolo(root);
  const brownfield = profileOf(root)?.codebase === 'brownfield';
  // The project front-zero (EP-discovery / "epic zero") is not a feature epic — split it out so it is
  // surfaced on its own line and never mixed into the feature-epic roll-up.
  const allEpics = listEpics(root);
  const hasDiscovery = allEpics.includes(DISCOVERY_EPIC);
  const featureEpics = allEpics.filter((id) => id !== DISCOVERY_EPIC);
  const discoveryAction = hasDiscovery
    ? nextAction(loadLedger(epicRoot(root, DISCOVERY_EPIC)), { epic: DISCOVERY_EPIC })
    : null;
  const discoveryOpen = !!discoveryAction && discoveryAction.kind !== 'discovery-done';

  if (!featureEpics.length) {
    if (discoveryOpen) { printAction(discoveryAction, { solo }); return; }
    log(`\n  ${c.bold('Set up — no feature epics yet.')}`);
    if (brownfield) hand(`capture what already exists first: invoke the ${c.bold('yad-backfill')} skill`);
    if (!hasDiscovery) hand(`frame the whole project (market, feasibility, roadmap): invoke the ${c.bold('yad-discovery')} skill ${c.dim('(optional front-zero)')}`);
    hand(`start your first epic: invoke the ${c.bold('yad-epic')} skill${hasDiscovery ? c.dim(' (it reads the approved roadmap.md)') : ''}`);
    return;
  }

  const actions = featureEpics.map((id) => nextAction(loadLedger(epicRoot(root, id)), { epic: id }));
  if (discoveryOpen) printAction(discoveryAction, { solo });   // an unfinished discovery comes first

  if (featureEpics.length === 1 || all) {
    for (const a of actions) printAction(a, { solo });
    return;
  }
  // Several epics — list each with a one-liner, then point at the per-epic / --all views.
  log(`\n  ${c.bold(`${featureEpics.length} epics`)} ${c.dim('— next action each:')}`);
  for (const a of actions) log(`    ${c.cyan(a.epicId)}  ${actionLine(a, { solo })}`);
  info(c.dim(`detail: ${c.bold('yad next <epic>')}  •  all at once: ${c.bold('yad next --all')}`));
}

// `yad next <epic> --check <step>`: the precondition guard. Exit 0 if runnable now, 1 otherwise.
function checkPrecondition(root, epic, stepId) {
  const ledger = loadLedger(epicRoot(root, epic));
  const res = preconditionsMet(ledger.state, stepId);
  if (res.ok) {
    ok(`${epic}: ${stepId} is ready to run`);
    return;
  }
  fail(`${epic}: ${stepId} is blocked — ${res.reason}`);
  hand(`see what to do now: ${c.bold(`yad next ${epic}`)}`);
  process.exitCode = 1;
}

// Entry point for the `next` command: route to the precondition check, a single epic's action, or the
// project-wide general view. Validates the epic id first.
export async function runNext(root, { epic, check, all } = {}) {
  if (epic && !isValidEpicId(epic)) {
    fail(`invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`);
    process.exitCode = 1;
    return;
  }
  if (epic && check) return checkPrecondition(root, epic, check);
  if (!epic) return generalNext(root, { all });

  const epicDir = epicRoot(root, epic);
  if (!exists(path.join(epicDir, '.sdlc', 'state.json'))) {
    warn(`no epic state at ${epicDir}/.sdlc/state.json`);
    hand(`is the id right? list project status with ${c.bold('yad next')}`);
    process.exitCode = 1;
    return;
  }
  printAction(nextAction(loadLedger(epicDir), { epic }), { solo: isSolo(root) });
}
