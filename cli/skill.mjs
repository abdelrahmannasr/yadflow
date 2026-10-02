// `yad skill` — which skill runs which step (E6), for every epic or for one route (E51).
//
// The engine ships a default for every step (the `skill` column of the step catalogue in
// epic-state.mjs). A project that wants a different one records it in `.sdlc/skills.json`, and every
// surface that names a skill — `yad next`, `yad epic new` — reads the project's answer first.
//
//   yad skill list [--profile <p> | --epic <id>] [--json]
//                                           every step, its bound skill(s), where that came from, and
//                                           whether each skill is installed on this machine
//   yad skill bind <step> <skill> [<skill>…] [--profile <p>]
//                                           bind one step; several skills run in the order given
//   yad skill unbind <step> [--profile <p>] drop the binding and fall back to the next layer
//
// TWO LAYERS, THE MOST SPECIFIC WINS (E51). `steps` binds a step for every epic; `profiles.<p>.steps`
// binds it for epics on route `<p>` only, and wins over the project-wide line on those epics. Unbinding
// a route's line falls back to the project-wide one, then to the engine's default.
//
// WHY A COMMAND AND NOT JUST A FILE. The file stays hand-editable — it is read by
// `loadSkillBindings`, and `yad doctor` reports a line that binds nothing rather than correcting it.
// But a file the engine never writes is a file with no `schemaVersion` in it, and `yad doctor` would
// then tell the user to migrate the config file it had just asked them to write. Writing it through
// `writeJSON` stamps the shape like every other engine-written file, and gives the cost warning a
// place to appear at the moment somebody opts into a chain.
//
// INSTALLED IS ASKED, NEVER ENFORCED (E51). `list` and `bind` ask `yad detect` (E50) whether each
// skill is installed here, in this folder or the home folder. A skill it cannot find is a WARNING: the
// binding is the team's, committed, and a teammate may well have a skill this machine lacks. A skill
// it finds is "found", not "this agent will run it" — which copy an agent loads is each agent's own
// rule, and E50 leaves it unresolved on purpose.
import os from 'node:os';
import path from 'node:path';
import { c, exists, fail, hand, info, log, ok, readJSONStrict, warn, writeJSON, emitJSON } from './lib.mjs';
import {
  boundSkills, bindingsForProfile, recordedRoute, epicRoot, isValidEpicId, lifecycleProfile, loadLedger,
  loadSkillBindings, normalizeBindings, profileSteps, stepDef, stepSkills, STEPS,
} from './epic-state.mjs';
import { detectInstalled } from './detect.mjs';
import { PROJECT_FILES, SCHEMA_VERSION } from './manifest.mjs';

const bail = (message, hint) => { fail(message); if (hint) hand(hint); process.exitCode = 1; };

// Every step the engine actually runs a skill for — the ones worth binding. Shape review gates are
// driven by `yad gate` and are deliberately not listed: offering to bind one would promise something
// that never runs.
const bindableSteps = () => STEPS.filter((s) => s.skill).map((s) => s.id);

const skillsFile = (root) => path.join(root, PROJECT_FILES.skillsConfig);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Read the file as it is on disk, so a write preserves keys this release does not know about.
// `normalizeBindings` is for READING a binding; this is for editing the document.
//
// STRICT, unlike the resolver. `loadSkillBindings` treats a broken file as an empty one because
// `yad next` must still answer; this is a read-modify-write, and doing the same here would rebuild
// the document from nothing and delete every binding the file held — silently, with a green tick, on
// the file the docs tell people to hand-edit. Returns null when the bytes do not parse; the caller
// refuses rather than writing.
// Returns `{ doc }`, or `{ error }` naming which of the two failures it is. The two are reported with
// different codes by `yad doctor` on the same bytes, and saying "does not parse" about a file that
// parses perfectly and is simply a JSON array sends the reader looking for a missing comma.
const readRaw = (root) => {
  const file = skillsFile(root);
  if (!exists(file)) return { doc: {} };
  let raw;
  try { raw = readJSONStrict(file, null); } catch { return { error: 'does not parse [YAD-STATE-001]' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'has the wrong shape [YAD-STATE-002]' };
  return { doc: raw };
};

// The step lines one layer of the document holds: the project-wide `steps`, or `profiles.<p>.steps`.
//
// A layer that is THERE but is not an object is an error, not an empty layer, for a route: writing one
// line into it would replace whatever the person put there. The project-wide `steps` keeps E6's
// behaviour (a non-object is rebuilt), which `yad doctor` already reports as a fail.
function layerOf(doc, profile) {
  if (!profile) return { steps: isObject(doc.steps) ? { ...doc.steps } : {} };
  if (doc.profiles === undefined) return { steps: {} };
  if (!isObject(doc.profiles)) return { error: '`profiles` is not a JSON object [YAD-STATE-002]' };
  if (!Object.hasOwn(doc.profiles, profile)) return { steps: {} };
  const entry = doc.profiles[profile];
  if (!isObject(entry)) return { error: `\`profiles.${profile}\` is not a JSON object [YAD-STATE-002]` };
  if (entry.steps === undefined) return { steps: {} };
  if (!isObject(entry.steps)) return { error: `\`profiles.${profile}.steps\` is not a JSON object [YAD-STATE-002]` };
  return { steps: { ...entry.steps } };
}

// An existing document plus this edit, ready to write.
//
// `schemaVersion` is set OUTRIGHT rather than carried through. `readJSON` back-stamps an unstamped
// file as shape 1 (rule 1: a file with no version IS shape 1), and `writeJSON` then preserves what it
// was handed — so writing the document back unchanged would stamp a hand-authored file as shape 1 and
// `yad doctor` would immediately report it as behind. This command is the file's engine writer; like
// `writeState`, its write IS the file's migration.
//
// A route's other keys — beside its `steps`, and the other routes beside it — are carried as they are.
const withSteps = (raw, steps, profile = null) => {
  if (!profile) return { ...raw, schemaVersion: SCHEMA_VERSION, steps };
  const profiles = isObject(raw.profiles) ? raw.profiles : {};
  const entry = isObject(profiles[profile]) ? profiles[profile] : {};
  return { ...raw, schemaVersion: SCHEMA_VERSION, profiles: { ...profiles, [profile]: { ...entry, steps } } };
};

const brokenFile = (error) => bail(`${PROJECT_FILES.skillsConfig} ${error}`,
  'fix the file (or restore it from git) first — writing over it would delete every binding it holds');

// A step id has the shape every catalogue id has. An id this release does not KNOW is allowed through
// with a warning (the file wins, rule 3), so this is not an allowlist — it is a shape guard, and the
// one thing it has to stop is `__proto__`: assigning that key to the document sets the object's
// prototype instead of adding a line, `JSON.stringify` then drops it, and the command would report a
// binding it did not write. `yad epic new` guards its slug the same way. A profile id is a key in the
// same document and every shipped one has the same shape, so the same guard covers `--profile`.
const STEP_ID = /^[a-z][a-z0-9-]*$/;

const badProfile = (profile) => bail(`\`${profile}\` is not a profile id`,
  'a profile id is lower-case letters, digits and dashes — for example `classic` or `spike`');

// ---- installed? (E50) --------------------------------------------------------------------------------

// The skill names `yad detect` finds here, or null when it could not look (an unreadable home folder).
// A plugin's skill is called `<plugin>:<skill>`, where `<plugin>` is the name before the `@` of the id
// the install record keeps (`codex@openai-codex` → `codex:rescue`), so all three spellings count.
export function installedSkillNames(root, { home = os.homedir() } = {}) {
  let items;
  try { ({ items } = detectInstalled(root, { home })); } catch { return null; }
  const names = new Set();
  for (const it of items) {
    if (it.kind !== 'skill' || typeof it.name !== 'string') continue;
    names.add(it.name);
    if (typeof it.plugin === 'string' && it.plugin) {
      names.add(`${it.plugin}:${it.name}`);
      names.add(`${it.plugin.split('@')[0]}:${it.name}`);
    }
  }
  return names;
}

// `{ <skill>: true | false }` for a row's skills, or null when nothing could be checked.
const installedMap = (skills, names) => (names ? Object.fromEntries(skills.map((s) => [s, names.has(s)])) : null);

// ---- list ----------------------------------------------------------------------------------------------

// One row per step the engine can run a skill for: what runs it now, and whether that is this route's
// choice, the project's, or the engine's. `source` is the field worth having — "yad-stories" alone
// never says whether someone chose it.
// `written` is the set of step ids the FILE mentions in the layers that apply, whether or not the value
// was usable. It is what separates "this project left the step alone" from "this project wrote a line
// here and the line does nothing" — the second is invisible otherwise, which is the failure
// `yad skill list` exists to end.
export function skillRows(root, bindings = loadSkillBindings(root), written = null) {
  return bindableSteps().map((id) => rowOf(id, bindings, written));
}

function rowOf(id, bindings, written) {
  const found = boundSkills(id, bindings);
  return {
    step: id,
    phase: stepDef(id)?.phase ?? null,
    skills: stepSkills(id, bindings),
    source: found ? found.source : (written?.has(id) ? 'ignored' : 'engine'),
    default: stepDef(id)?.skill ?? null,
  };
}

// Which route `list` shows: `--profile` as given, or the route the epic `--epic` names RECORDS — what
// `yad next` uses for it; none recorded means the project-wide view. `{ profile }` or `{ error, hint }`.
function routeFor(root, { profile, epic }) {
  if (profile && epic) return { error: 'give --profile or --epic, not both', hint: '--epic reads the route off that epic' };
  if (profile !== undefined && profile !== null) {
    if (!STEP_ID.test(String(profile))) return { error: `\`${profile}\` is not a profile id`, hint: 'for example `classic` or `spike`' };
    return { profile: String(profile) };
  }
  if (epic === undefined || epic === null) return { profile: null };
  if (!isValidEpicId(epic)) return { error: `\`${epic}\` is not an epic id`, hint: 'an epic id looks like EP-<slug>' };
  let state;
  try { state = loadLedger(epicRoot(root, epic))?.state; } catch (e) {
    return { error: `${epic}'s ledger could not be read${e.code ? ` [${e.code}]` : ''}`, hint: 'see `yad doctor`' };
  }
  if (!state) return { error: `${epic} has no state.json`, hint: 'see `yad next` for the epics in this Product' };
  return { profile: recordedRoute(state), epic };
}

export function runSkillList(root, { json = false, profile, epic, home = os.homedir() } = {}) {
  const route = routeFor(root, { profile, epic });
  if (route.error) return bail(route.error, route.hint);
  const view = bindingsForProfile(loadSkillBindings(root), route.profile);
  const { doc, error } = readRaw(root);
  const written = new Set(error ? [] : Object.keys(isObject(doc.steps) ? doc.steps : {}));
  if (route.profile && !error) {
    const layer = layerOf(doc, route.profile);
    for (const id of Object.keys(layer.steps || {})) written.add(id);
  }
  const names = installedSkillNames(root, { home });
  const rows = skillRows(root, view, written);
  // Bindings on ids the catalogue does not know are listed too, and marked. They are the ones a person
  // most needs to see: `yad next` never looks them up, so without this line they are invisible.
  const extra = [...written].filter((id) => !stepDef(id)).map((id) => rowOf(id, view, written));
  const all = [...rows, ...extra].map((r) => ({ ...r, installed: installedMap(r.skills, names) }));
  // Every route's own lines, whichever route is shown — so a line bound for `spike` is never invisible
  // from the plain `yad skill list`.
  const routes = Object.entries(view.profiles || {}).map(([id, { steps }]) => ({
    profile: id, known: !!lifecycleProfile(id), steps: Object.entries(steps).map(([step, skills]) => ({ step, skills })),
  }));

  if (json) {
    return emitJSON({
      ok: true, file: PROJECT_FILES.skillsConfig, profile: route.profile, ...(route.epic ? { epic: route.epic } : {}),
      installedChecked: !!names, steps: all, profiles: routes,
    });
  }

  if (error) warn(`${PROJECT_FILES.skillsConfig} ${error} — showing the engine's defaults`);
  if (route.epic) {
    info(route.profile
      ? `${route.epic} is on route ${c.bold(route.profile)}${lifecycleProfile(route.profile) ? '' : c.yellow(' — not a route this yadflow has')}`
      : `${route.epic} records no route — it runs the project-wide lines`);
  }
  else if (route.profile) info(`route ${c.bold(route.profile)}${lifecycleProfile(route.profile) ? '' : c.yellow(' — not a route this yadflow has')}`);
  log(`\n  ${c.bold('step')}                 ${c.bold('skill(s)')}`);
  for (const r of all) {
    const mark = r.source === 'profile' ? c.green('◆') : r.source === 'project' ? c.cyan('•') : (r.source === 'ignored' ? c.red('!') : ' ');
    const notes = [];
    if (r.phase === null) notes.push('not a step this yadflow runs');
    if (r.source === 'ignored') notes.push('the file has a line for this step that names no skill');
    const missing = r.installed ? r.skills.filter((s) => !r.installed[s]) : [];
    if (missing.length) notes.push(`not found here: ${missing.join(', ')}`);
    const note = notes.length ? c.dim(`   (${notes.join('; ')})`) : '';
    const shown = r.skills.map((s) => (r.installed && !r.installed[s] ? `${s}${c.yellow('?')}` : s));
    log(`  ${mark} ${r.step.padEnd(18)} ${shown.join(c.dim(' → ')) || c.dim('(none)')}${note}`);
  }
  const chosen = all.filter((r) => r.source === 'project' || r.source === 'profile').length;
  const ignored = all.filter((r) => r.source === 'ignored').length;
  if (all.some((r) => r.source === 'profile')) info(`${c.green('◆')} = bound for route ${route.profile} only`);
  info(chosen
    ? `${c.cyan('•')} = bound by this project in ${PROJECT_FILES.skillsConfig}; the rest are the engine's defaults`
    : `every step is on the engine's default — bind one with \`yad skill bind <step> <skill>\``);
  if (ignored) info(`${c.red('!')} = a line in that file that binds nothing — \`yad doctor\` says which`);
  if (!names) warn('could not check which skills are installed here — `yad detect` could not read this folder or the home folder');
  else if (all.some((r) => r.installed && r.skills.some((s) => !r.installed[s]))) {
    info(`${c.yellow('?')} = \`yad detect\` found no skill by that name in this folder or the home folder — a teammate may still have it`);
  }
  const others = routes.filter((r) => r.profile !== route.profile);
  if (others.length) {
    log(`\n  ${c.bold('bound for one route only')} ${c.dim('— see each with `yad skill list --profile <p>`')}`);
    for (const r of others) {
      for (const s of r.steps) log(`  ${c.green('◆')} ${`${r.profile}: ${s.step}`.padEnd(18)} ${s.skills.join(c.dim(' → '))}${r.known ? '' : c.dim('   (not a route this yadflow has)')}`);
    }
  }
}

// ---- bind / unbind -------------------------------------------------------------------------------------

// Would anything ever run this step on this route? A Shape step the route does not walk — `architecture`
// on `spike` — never comes up on an epic on it, so a line there records a decision that never happens:
// refused, for the reason a review gate is (E6). A Build step is on no route's row but runs on every
// FEATURE route, so it is allowed there; a Product route has no Build half. An unknown route is let
// through by the caller (rule 3), so this only judges a route this release carries.
function routeLacks(profile, step) {
  const route = lifecycleProfile(profile);
  const def = stepDef(step);
  if (!route || !def) return false;
  if (def.phase === 'build') return route.level !== 'feature';
  return !profileSteps(profile).includes(step);
}

export function runSkillBind(root, { step, skills = [], profile = null, home = os.homedir() } = {}) {
  const names = skills.map((s) => String(s || '').trim()).filter(Boolean);
  if (!step || !names.length) {
    return bail('usage: yad skill bind <step> <skill> [<skill> …] [--profile <p>]',
      `bindable steps: ${bindableSteps().join(' · ')}`);
  }
  if (!STEP_ID.test(step)) {
    return bail(`\`${step}\` is not a step id`, 'a step id is lower-case letters, digits and dashes — for example `architecture` or `ui-design`');
  }
  if (profile !== null && profile !== undefined && !STEP_ID.test(String(profile))) return badProfile(profile);
  const route = profile ? String(profile) : null;
  const def = stepDef(step);
  // A review gate is refused rather than warned about: nothing would ever invoke the binding, so
  // writing it would record a decision that silently never happens.
  if (def && !def.skill) {
    return bail(`\`${step}\` is a review gate — no skill runs it`,
      `it is driven by \`yad gate open\` / \`yad gate sync\`. Bind the step it reviews instead${def.reviews ? `: \`${def.reviews}\`` : ''}`);
  }
  if (route && routeLacks(route, step)) {
    return bail(`route \`${route}\` has no \`${step}\` step — nothing would ever run this binding`,
      `the steps on ${route}: ${profileSteps(route).filter((id) => stepDef(id)?.skill).join(' · ')}${lifecycleProfile(route).level === 'feature' ? ' · and the Build steps' : ''}`);
  }
  // An UNKNOWN id is allowed through with a warning, not refused. The file wins for this whole major
  // (rule 3), and a project may legitimately hold a step from a newer release than the CLI in hand.
  // The same holds for an unknown route.
  const { doc, error } = readRaw(root);
  if (error) return brokenFile(error);
  const layer = layerOf(doc, route);
  if (layer.error) return brokenFile(layer.error);
  const steps = layer.steps;
  steps[step] = names.length === 1 ? names[0] : names;
  writeJSON(skillsFile(root), withSteps(doc, steps, route));

  ok(`${route ? `${route}: ` : ''}${step} → ${names.join(' → ')}`);
  if (!def) {
    info(`\`${step}\` is not a step this yadflow runs — the binding is recorded but nothing will invoke it`);
  }
  if (route && !lifecycleProfile(route)) {
    info(`\`${route}\` is not a route this yadflow has — the binding is recorded, and applies to an epic that records it`);
  }
  // Closed decision 7: extra skills are a chain, never a panel, and every extra one costs another run.
  if (names.length > 1) {
    info(`${names.length} skills run for this step, one after another — each one costs tokens`);
    info('they chain: each sees what the one before it produced, and the last output is the artifact');
  }
  // Asked AFTER the write, and only warned: the binding is the team's, and this machine is one person's.
  const found = installedSkillNames(root, { home });
  const notFound = found ? names.filter((n) => !found.has(n)) : [];
  if (!found) warn('could not check whether the skill is installed — `yad detect` could not read this folder or the home folder');
  for (const n of notFound) {
    warn(`\`${n}\` is not installed here — \`yad detect\` found no skill by that name in this folder or the home folder`);
  }
  if (notFound.length) info('the binding is written anyway: a teammate may have it — install it here before running the step');
  hand(`written to ${PROJECT_FILES.skillsConfig} — \`yad next\` names it ${route ? `for epics on ${route} ` : ''}from now on (undo with \`yad skill unbind ${step}${route ? ` --profile ${route}` : ''}\`)`);
  return { step, skills: names, profile: route, known: !!def, file: PROJECT_FILES.skillsConfig, notInstalled: found ? notFound : null };
}

export function runSkillUnbind(root, { step, profile = null } = {}) {
  if (!step) return bail('usage: yad skill unbind <step> [--profile <p>]');
  if (profile !== null && profile !== undefined && !STEP_ID.test(String(profile))) return badProfile(profile);
  const route = profile ? String(profile) : null;
  const { doc, error } = readRaw(root);
  if (error) return brokenFile(error);
  const layer = layerOf(doc, route);
  if (layer.error) return brokenFile(layer.error);
  const steps = layer.steps;
  if (!Object.hasOwn(steps, step)) {
    return bail(`${step} is not bound${route ? ` for route ${route}` : ''} in ${PROJECT_FILES.skillsConfig}`,
      `see \`yad skill list${route ? ` --profile ${route}` : ''}\` for what is bound`);
  }
  delete steps[step];
  // The file is left behind, holding an empty `steps`, rather than deleted — and a route's entry is left
  // holding an empty `steps` the same way. Deleting a file (or a route's entry) the user may have
  // hand-authored, with keys a later release reads, to undo one line would throw away more than was
  // asked for.
  const next = withSteps(doc, steps, route);
  writeJSON(skillsFile(root), next);
  // What runs it now: the next layer down — the project-wide line for a route, else the engine's default,
  // or nothing at all if this engine does not know the step.
  const found = boundSkills(step, bindingsForProfile(normalizeBindings(next), route));
  const fallback = stepSkills(step, bindingsForProfile(normalizeBindings(next), route));
  // A route's line can still bind the step under its OLD id (`discovery` for `foundation`), so the
  // layer is read off the answer, never assumed.
  const where = !found ? "the engine's default"
    : found.source === 'profile' ? `this route's line under the step's old name` : 'the project-wide binding';
  ok(`${route ? `${route}: ` : ''}${step} unbound${fallback.length ? ` — back to ${where} (${fallback.join(' → ')})` : ' — this yadflow runs no skill for it'}`);
  return { step, skills: fallback, profile: route, file: PROJECT_FILES.skillsConfig };
}
