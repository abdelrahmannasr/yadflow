// `yad next` — the unified next-step driver. Read-only: it never writes state or acts. It reads the
// file ledger and prints the ONE concrete, copy-pasteable next action (and a one-line why), so a user
// never has to remember which of the 38 skills / gate commands comes next. "Guide, don't act" — the
// Shape still never auto-advances. Once an epic is `ready-for-build`, it reads each story's
// build-state and prints the next BUILD sub-step per repo (spec → tasks → implement → checks → engineer-review)
// plus the remaining chain — so Build is guided too, not just hinted at.
//
//   yad next                  general orientation across the whole project
//   yad next <epic>           the single next action for one epic
//   yad next <epic> --check <step>   exit 0 if <step> is runnable now, else 1 (the precondition guard)
//   yad next --all            every active epic's next action at once
//   yad next [<epic>] --json  the same answer as an action object, for an agent or CI
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, info, warn, hand, fail, readJSON, exists } from './lib.mjs';
import { PROJECT_FILES, VERSION , productConfigPath, stepAdvance } from './manifest.mjs';
import { dedupeConsecutive, epicRoot, loadLedger, loadSkillBindings, stepSkills, nextAction, preconditionsMet, isValidEpicId, epicLineage, typeNoun, phaseOf, PHASES, DISCOVERY_EPIC } from './epic-state.mjs';

// Is solo mode on? Persisted in hub.json by setup (Phase C/D); default false. Read defensively so a
// missing/old hub.json never breaks the driver.
function isSolo(root) {
  const hub = readJSON(productConfigPath(root), null);
  return !!(hub && (hub.solo === true || hub.review_gate?.solo === true));
}
// The SETUP profile recorded by `yad setup` (codebase / repo_layout / team_size), or null. Not the
// lifecycle profile — that is the route an epic walks through the steps (`LIFECYCLE_PROFILES` in
// epic-state.mjs, E5). Two unrelated things share the word `profile`, one of them a `hub.json` field
// that predates the other, so this one is spelled out wherever it is read.
const setupProfileOf = (root) => readJSON(productConfigPath(root), null)?.profile || null;
// Has `yad setup` run here? True once the version stamp or Product config exists.
const isSetUp = (root) => exists(path.join(root, PROJECT_FILES.version)) || exists(productConfigPath(root));

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

// The action object for ONE epic, with its work-item type attached. The single shape both surfaces
// consume — `printAction` renders it, `--json` emits it verbatim — so the prose and the machine
// answer can never drift apart.
//
// The key stays `lineageKind` even though the word is now `type`, and there is no `lineageType`
// beside it. `yad next --json` is deep-equalled by the golden test (cli/test-golden.mjs), which
// rule 6 says never changes — and a deep-equal breaks on an ADDED key just as hard as a renamed
// one. The value is the same either way; only the label is old.
//
// The lineage may be passed in. `epicLineage` opens and parses `epic.md`, and every printed surface
// needs the grouping theme off the SAME read — without this the file would be parsed twice per epic
// on every `yad next`. The default keeps the `--json` path a one-liner, where the theme is not wanted.
// `bindings` is passed in for the same reason `lin` is: every loop below renders many epics, and the
// project's skill bindings are ONE file for all of them. The default keeps the single-epic callers a
// one-liner; a loop reads the file once and hands the same object to every row.
const actionFor = (root, id, lin = epicLineage(root, id), bindings = loadSkillBindings(root)) => ({
  ...nextAction(loadLedger(epicRoot(root, id)), { epic: id, bindings }),
  lineageKind: lin.type,
});

// One `epic.md` read, both things that come out of it: the action to print and the tag to print
// beside it. Every printed path in this file goes through here.
const rowFor = (root, id, bindings = loadSkillBindings(root)) => {
  const lin = epicLineage(root, id);
  return { action: actionFor(root, id, lin, bindings), theme: lin.theme };
};

// EP-checkout-S03 → S03 (the compact lane label for the roll-up). Falls back to the full id.
const shortStory = (s) => (s && s.match(/S\d+$/i)?.[0]) || s || '(story)';

// Every per-repo lane across the build, flattened with its story id attached.
const buildLanes = (builds = []) => builds.flatMap((b) => b.repos.map((r) => ({ ...r, story: b.story })));

// The dial note for a build lane: an `advance: auto` lane is driven by yad-run; everything else stops
// for a human (the locked engineer-review always does).
//
// This is the sentence a person LEARNS the vocabulary from, so it says the new words even though the
// `--json` key beside it still says `automation` (see buildNextForRepo). Different audiences: the key
// is read by scripts and is frozen by the golden test; this line is read by people.
function dialNote(r) {
  if (r.locked) return c.dim('human merge gate');
  return stepAdvance(r) === 'auto'
    ? c.dim('advance: auto — yad-run auto-drives')
    : c.dim('advance: human');
}

// ---- how a step's skills read on a line (E6) -----------------------------------------------------
//
// A step's skill is no longer one string the engine chose: `.sdlc/skills.json` can bind a different
// one, or several. The resolver puts the first in `skill` and, ONLY when there is more than one, the
// whole chain in `skills` — so everything here reads `skills` when it is there and falls back to the
// single field, and a project that binds nothing prints exactly what it printed before.
const skillList = (a) => a?.skills || (a?.skill ? [a.skill] : []);

// "the yad-architecture skill", or for a bound chain "the shape-it skill, then yad-stories". Closed
// decision 7: several skills on one step are a CHAIN, not a panel — they run in the order given, each
// seeing what the one before it produced, and the last output is the artifact.
function skillPhrase(a, fallback = null) {
  const ids = skillList(a);
  if (!ids.length) return `the ${c.bold(fallback || '(no skill)')} skill`;
  const [first, ...rest] = ids;
  const then = rest.length ? `, then ${rest.map((s) => c.bold(s)).join(', then ')}` : '';
  return `the ${c.bold(first)} skill${then}`;
}

// The cost warning decision 7 asks for. Extra skills are opt-in, and each one is another model run —
// said here, where the chain is actually about to be invoked, rather than in a document nobody reopens
// after binding. Null for the normal one-skill step, so the common case gains no noise.
const costNote = (a) => {
  const n = skillList(a).length;
  return n > 1 ? `${n} skills run for this step, one after another — each one costs tokens` : null;
};

// The detailed per-story/per-repo build lanes for `printAction`. Each open lane is a 2-line block:
// a header naming the active step + dial, then the actionable `▸` skill line with the remaining chain.
function printBuildLanes(builds) {
  for (const lane of buildLanes(builds)) {
    const where = `${c.cyan(lane.story || '(story)')} / ${c.bold(lane.repo)}`;
    if (lane.shipped) { log(`    ${where} ${c.green('— shipped ✓')}`); continue; }
    // No resolvable next skill (an empty/half-seeded build-state file): show it as not-started, no ▸.
    if (!lane.skill) { log(`    ${where} ${c.dim('— not started yet (no build steps recorded)')}`); continue; }
    log(`    ${where} ${c.dim('—')} ${c.bold(lane.step)}  (${dialNote(lane)})`);
    // `chain` is every skill still to run in this lane, the active step's own included — so drop this
    // step's own off the front, or a bound chain would print its second skill again as if it came
    // later. Folded through the SAME helper the chain was built with: `chain` collapses consecutive
    // duplicates, so a step bound to one skill twice has two entries here and one there, and slicing
    // by the raw count would swallow the next step's skill.
    const rest = (lane.chain || []).slice(dedupeConsecutive(skillList(lane)).length);
    const then = rest.length ? `   ${c.dim(`then → ${rest.join(' → ')}`)}` : '';
    hand(`invoke ${skillPhrase(lane)}${then}`);
    const note = costNote(lane);
    if (note) info(c.dim(note));
  }
}

// A short, copy-pasteable line for one action — the `▸` line a user can act on directly.
//
// `bindings` arrives here as well as on the action object, because two of these lines name a skill
// the RESOLVER never put on the action: the `discovery-done` hand-off to the epic step, and the Build
// fallback printed when no story has a build-state yet. Both are the engine naming a step's skill in
// prose, so both must name the project's choice — otherwise `yad next` and `yad skill list` disagree
// about the same project.
function actionLine(a, { solo, bindings = null } = {}) {
  const runs = (stepId, fallback) => stepSkills(stepId, bindings)[0] || fallback;
  switch (a.kind) {
    case 'new':
      return `invoke ${skillPhrase(a)} ${c.dim('(author the epic)')}`;
    case 'author':
      return `invoke ${skillPhrase(a, `yad-${a.step}`)} ${c.dim(`(author ${a.artifact})`)}`;
    case 'review-open':
    case 'review-sync':
      return `${c.bold(a.command)}${solo ? c.dim('   (solo: no approval needed — just merge your own PR)') : ''}`;
    case 'build': {
      // In Build: compact the lanes to "N lane(s) in build — next: <skill> @ <story>/<repo>".
      if (a.builds?.length) {
        const open = buildLanes(a.builds).filter((r) => !r.shipped);
        if (!open.length) return c.dim('Build — every lane shipped');
        // Headline the first lane with a resolvable next skill; if none, the half is started but unspecced.
        const first = open.find((r) => r.skill);
        if (!first) return c.dim(`${open.length} lane(s) in build — not specced yet`);
        return `${c.dim(`${open.length} lane(s) in build — next:`)} ${c.bold(first.skill)} ${c.dim(`@ ${shortStory(first.story)}/${first.repo}`)}`;
      }
      return `${c.bold('yad-run')} ${c.dim(`(or per story: ${runs('spec', 'yad-spec')} → ${runs('implement', 'yad-implement')} → yad ship → ${runs('engineer-review', 'yad-engineer-review')})`)}`;
    }
    case 'discovery-done':
      return `invoke the ${c.bold(runs('epic', 'yad-epic'))} skill ${c.dim('(seed a feature epic from roadmap.md)')}`;
    case 'backfill-pending':
      return `invoke the ${c.bold('yad-backfill')} skill ${c.dim('(document the code, then `yad-backfill promote` — or thread bugs now with yad-change)')}`;
    case 'backfill-done':
      return `invoke the ${c.bold('yad-change')} skill ${c.dim('(documented anchor — evolve it by threading a change/defect off it)')}`;
    default:
      return c.dim('nothing to do');
  }
}

// Full, friendly printout for a single epic.
//
// The grouping theme arrives as an argument rather than as another field on the action object:
// `printAction` renders `a` and `--json` emits the SAME `a` verbatim, and that JSON is deep-equalled
// by the golden test, which an added key breaks (see actionFor). It comes from `rowFor`, off the same
// `epic.md` read the action's own `lineageKind` came from.
function printAction(a, { solo, theme: tag = null, bindings = null } = {}) {
  // Prefix the id with the type noun (Defect / Change request / Hotfix / Chore / Epic) so a glance
  // says what kind of work this is. The discovery front-zero is not a feature — leave it un-prefixed.
  const noun = a.lineageKind && a.epicId !== DISCOVERY_EPIC ? `${typeNoun(a.lineageKind)} ` : '';
  // The free grouping tag, printed only when the epic has one — most do not, and an empty marker on
  // every line would cost more attention than it pays back.
  const theme = tag ? ` ${c.dim(`#${tag}`)}` : '';
  log(`\n  ${c.bold(`${noun}${a.epicId || '(epic)'}`)}${theme} ${c.dim(`— ${a.why}`)}`);
  // In Build with live lanes, print each story/repo's next sub-step + remaining chain instead
  // of the single static hint; otherwise the one actionable line.
  if (a.kind === 'build' && a.builds?.length) printBuildLanes(a.builds);
  else {
    hand(actionLine(a, { solo, bindings }));
    const note = costNote(a);
    if (note) info(c.dim(note));
  }
  // Not `c.dim(... c.bold(...) ...)`: `paint` closes with a full reset, so a bold word inside a dim
  // string ends the dim and everything after it reads bright. Painted per segment instead.
  if (a.kind === 'review-sync') info(`${c.dim('unresolved comments?')} ${c.bold(`yad gate comments ${a.epicId} ${a.artifact}`)}`);
  if (a.parallel) {
    hand(`parallel track: invoke ${skillPhrase(a.parallel)} ${c.dim(`(author ${a.parallel.artifact})`)}`);
    const note = costNote(a.parallel);
    if (note) info(c.dim(note));
  }
  phaseLine(a);
}

// Where this epic sits in the lifecycle: the six phases, with the current one marked.
//
// `phaseOf` is given the same two facts every renderer needs — the epic's current step and whether it
// is the discovery front-zero — so `yad next` and `yad thread` cannot answer this differently. It
// returns null for a stub, for the discovery epic, and for any step id this release does not
// recognise, and this line then stays away entirely: a wrong phase is worse than no phase.
//
// The two unbuilt phases are shown, greyed, rather than hidden. Someone reading this needs to see
// that the lifecycle does not stop at merge; a list that ended at Build would say it does.
function phaseLine(a) {
  const here = phaseOf(a.step, { discovery: a.epicId === DISCOVERY_EPIC });
  if (!here) return;
  const rendered = PHASES.map((p) => (
    p.id === here.id ? c.bold(p.name) : c.dim(p.built ? p.name : `${p.name} (planned)`)
  ));
  // Coloured PER SEGMENT, never nested: `paint` closes with a full reset (\x1b[0m), so a bold word
  // inside a dim string ends the dim for everything after it and the rest of the line reads bright.
  // The current phase is named in WORDS as well as marked in bold, because bold is not always there:
  // `useColor` is off whenever output is not a terminal or NO_COLOR is set, which is every pipe, every
  // log file and every CI job. Without this the line would list six phases and give no way to tell
  // which one you are in — the one thing it exists to say. The part is added only when it is a
  // different word; "now: Build (Build part)" tells nobody anything.
  const part = here.name === here.part ? '' : ` (${here.part} part)`;
  info(`${c.dim('phase:')} ${rendered.join(c.dim(' · '))} ${c.dim(`— now: ${here.name}${part}`)}`);
}

// `yad next` with no epic: orient across the whole project, always ending on ONE thing to do.
function generalNext(root, { all } = {}) {
  if (!isSetUp(root)) {
    log(`\n  ${c.bold('Project not set up yet.')}`);
    hand(`run ${c.bold('yad setup')} ${c.dim('(then come back to `yad next`)')}`);
    return;
  }
  const solo = isSolo(root);
  const brownfield = setupProfileOf(root)?.codebase === 'brownfield';
  // The project front-zero (EP-discovery / "epic zero") is not a feature epic — split it out so it is
  // surfaced on its own line and never mixed into the feature-epic roll-up.
  const allEpics = listEpics(root);
  // One read of `.sdlc/skills.json` for the whole roll-up, not one per epic.
  const bindings = loadSkillBindings(root);
  const hasDiscovery = allEpics.includes(DISCOVERY_EPIC);
  const featureEpics = allEpics.filter((id) => id !== DISCOVERY_EPIC);
  const discoveryRow = hasDiscovery ? rowFor(root, DISCOVERY_EPIC, bindings) : null;
  const discoveryOpen = !!discoveryRow && discoveryRow.action.kind !== 'discovery-done';

  if (!featureEpics.length) {
    if (discoveryOpen) { printAction(discoveryRow.action, { solo, bindings, ...discoveryRow }); return; }
    log(`\n  ${c.bold('Set up — no feature epics yet.')}`);
    if (brownfield) hand(`capture what already exists first: invoke the ${c.bold('yad-backfill')} skill`);
    // Both name a STEP's skill, so both ask the project. `yad-backfill` above does not: waking a
    // brownfield anchor is the engine's own promote verb, not a step on any chain.
    if (!hasDiscovery) hand(`frame the whole project (market, feasibility, roadmap): invoke the ${c.bold(stepSkills('discovery', bindings)[0] || 'yad-discovery')} skill ${c.dim('(optional front-zero)')}`);
    hand(`start your first epic: invoke the ${c.bold(stepSkills('epic', bindings)[0] || 'yad-epic')} skill${hasDiscovery ? c.dim(' (it reads the approved roadmap.md)') : ''}`);
    return;
  }

  const rows = featureEpics.map((id) => rowFor(root, id, bindings));
  if (discoveryOpen) printAction(discoveryRow.action, { solo, bindings, ...discoveryRow });   // an unfinished discovery comes first

  if (featureEpics.length === 1 || all) {
    for (const r of rows) printAction(r.action, { solo, bindings, ...r });
    return;
  }
  // Several epics — list each with a one-liner, then point at the per-epic / --all views.
  log(`\n  ${c.bold(`${featureEpics.length} epics`)} ${c.dim('— next action each:')}`);
  // The grouping theme rides this list too. This is the ONE `yad next` view that shows several epics
  // side by side, so it is where seeing which of them belong together is worth most — and leaving it
  // off would have meant bare `yad next`, the command people run by default, never showed the tag.
  for (const { action: a, theme: tag } of rows) {
    const theme = tag ? ` ${c.dim(`#${tag}`)}` : '';
    log(`    ${c.cyan(`${typeNoun(a.lineageKind)} ${a.epicId}`)}${theme}  ${actionLine(a, { solo })}`);
  }
  // Painted per segment, not dim-wrapping a bold: `paint` closes with a full reset, so the nested
  // form loses the dim from the first bold word to the end of the line.
  info(`${c.dim('detail:')} ${c.bold('yad next <epic>')}  ${c.dim('•  all at once:')} ${c.bold('yad next --all')}`);
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

// ---- machine-readable output (`--json`) --------------------------------------------------------
// `nextAction` already computes exactly what a caller needs; until now the ANSI prose renderer was
// its only consumer, so anything driving yadflow had to regex coloured English. This emits the SAME
// objects, unrendered. One envelope for every route, so a caller never has to branch on the shape:
//
//   { version, ok: true,  actions: [ <action>, … ] }        next / next <epic>
//   { version, ok,        check: { epic, step, ok, reason } } next <epic> --check <step>
//   { version, ok: true,  setUp: false, actions: [] }        the project has no `yad setup` yet
//   { version, ok: false, error }                            bad epic id / no state.json
//
// Exit codes are unchanged from the prose path — only the rendering differs.
const emitJSON = (payload) => log(JSON.stringify({ version: VERSION, ...payload }, null, 2));

// A JSON error still leaves stdout parseable: a caller that pipes us into a parser gets an object
// explaining the failure, never half a document or a bare ANSI line.
function jsonError(message) {
  emitJSON({ ok: false, error: message });
  process.exitCode = 1;
}

// `--json` counterpart of runNext's three routes. Kept in one function so the routing reads next to
// the prose routing it mirrors.
function jsonNext(root, { epic, check }) {
  if (epic && check) {
    const res = preconditionsMet(loadLedger(epicRoot(root, epic)).state, check);
    emitJSON({ ok: !!res.ok, check: { epic, step: check, ok: !!res.ok, ...(res.reason ? { reason: res.reason } : {}) } });
    if (!res.ok) process.exitCode = 1;
    return;
  }
  if (epic) {
    if (!exists(path.join(epicRoot(root, epic), '.sdlc', 'state.json'))) {
      return jsonError(`no epic state at epics/${epic}/.sdlc/state.json`);
    }
    return emitJSON({ ok: true, actions: [actionFor(root, epic)] });
  }
  if (!isSetUp(root)) return emitJSON({ ok: true, setUp: false, actions: [] });
  // Every epic that HAS a ledger, discovery included — its ACTION kind already says whether it is open
  // (`discovery-*`) or finished, so filtering it out would hide a fact rather than clarify one.
  // `--all` is implied: an array always carries everything, so there is nothing left to expand.
  const bindings = loadSkillBindings(root);
  return emitJSON({ ok: true, actions: listEpics(root).map((id) => actionFor(root, id, undefined, bindings)) });
}

// Entry point for the `next` command: route to the precondition check, a single epic's action, or the
// project-wide general view. Validates the epic id first.
export async function runNext(root, { epic, check, all, json } = {}) {
  if (epic && !isValidEpicId(epic)) {
    const message = `invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`;
    if (json) return jsonError(message);
    fail(message);
    process.exitCode = 1;
    return;
  }
  if (json) return jsonNext(root, { epic, check });
  if (epic && check) return checkPrecondition(root, epic, check);
  if (!epic) return generalNext(root, { all });

  const epicDir = epicRoot(root, epic);
  if (!exists(path.join(epicDir, '.sdlc', 'state.json'))) {
    warn(`no epic state at ${epicDir}/.sdlc/state.json`);
    hand(`is the id right? list project status with ${c.bold('yad next')}`);
    process.exitCode = 1;
    return;
  }
  // One read, two readers: the resolver puts the bound skill on the action, and the renderer names it
  // in the two prose lines no action carries.
  const bindings = loadSkillBindings(root);
  const row = rowFor(root, epic, bindings);
  printAction(row.action, { solo: isSolo(root), bindings, ...row });
}
