// `yad skill` — which skill runs which step (E6).
//
// The engine ships a default for every step (the `skill` column of the step catalogue in
// epic-state.mjs). A project that wants a different one records it in `.sdlc/skills.json`, and every
// surface that names a skill — `yad next`, `yad epic new` — reads the project's answer first.
//
//   yad skill list [--json]                 every step, its bound skill(s), and where that came from
//   yad skill bind <step> <skill> [<skill>…]  bind one step; several skills run in the order given
//   yad skill unbind <step>                 drop the binding and fall back to the engine's default
//
// WHY A COMMAND AND NOT JUST A FILE. The file stays hand-editable — it is read by
// `loadSkillBindings`, and `yad doctor` reports a line that binds nothing rather than correcting it.
// But a file the engine never writes is a file with no `schemaVersion` in it, and `yad doctor` would
// then tell the user to migrate the config file it had just asked them to write. Writing it through
// `writeJSON` stamps the shape like every other engine-written file, and gives the cost warning a
// place to appear at the moment somebody opts into a chain.
import path from 'node:path';
import { c, exists, fail, hand, info, log, ok, readJSONStrict, warn, writeJSON } from './lib.mjs';
import { loadSkillBindings, stepDef, stepSkills, STEPS } from './epic-state.mjs';
import { PROJECT_FILES, SCHEMA_VERSION } from './manifest.mjs';

const bail = (message, hint) => { fail(message); if (hint) hand(hint); process.exitCode = 1; };

// Every step the engine actually runs a skill for — the ones worth binding. Shape review gates are
// driven by `yad gate` and are deliberately not listed: offering to bind one would promise something
// that never runs.
const bindableSteps = () => STEPS.filter((s) => s.skill).map((s) => s.id);

const skillsFile = (root) => path.join(root, PROJECT_FILES.skillsConfig);

// Read the file as it is on disk, so a write preserves keys this release does not know about (E50 and
// E51 add some). `normalizeBindings` is for READING a binding; this is for editing the document.
//
// STRICT, unlike the resolver. `loadSkillBindings` treats a broken file as an empty one because
// `yad next` must still answer; this is a read-modify-write, and doing the same here would rebuild
// the document from nothing and delete every binding the file held — silently, with a green tick, on
// the file the docs tell people to hand-edit. Returns null when the bytes do not parse; the caller
// refuses rather than writing.
const readRaw = (root) => {
  const file = skillsFile(root);
  if (!exists(file)) return {};
  let raw;
  try { raw = readJSONStrict(file, null); } catch { return null; }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
};

// An existing document plus this edit, ready to write.
//
// `schemaVersion` is set OUTRIGHT rather than carried through. `readJSON` back-stamps an unstamped
// file as shape 1 (rule 1: a file with no version IS shape 1), and `writeJSON` then preserves what it
// was handed — so writing the document back unchanged would stamp a hand-authored file as shape 1 and
// `yad doctor` would immediately report it as behind. This command is the file's engine writer; like
// `writeState`, its write IS the file's migration.
const withSteps = (raw, steps) => ({ ...raw, schemaVersion: SCHEMA_VERSION, steps });

const brokenFile = () => bail(`${PROJECT_FILES.skillsConfig} does not parse [YAD-STATE-001]`,
  'fix the JSON (or restore it from git) first — writing over it would delete every binding it holds');

// One row per step the engine can run a skill for: what runs it now, and whether that is the project's
// choice or the engine's. `source` is the field worth having — "yad-stories" alone never says whether
// someone chose it.
// `written` is the set of step ids the FILE mentions, whether or not the value was usable. It is what
// separates "this project left the step alone" from "this project wrote a line here and the line does
// nothing" — the second is invisible otherwise, which is the failure `yad skill list` exists to end.
export function skillRows(root, bindings = loadSkillBindings(root), written = null) {
  return bindableSteps().map((id) => {
    const bound = Object.hasOwn(bindings.steps, id) ? bindings.steps[id] : null;
    return {
      step: id,
      phase: stepDef(id).phase,
      skills: stepSkills(id, bindings),
      source: bound?.length ? 'project' : (written?.has(id) ? 'ignored' : 'engine'),
      default: stepDef(id).skill,
    };
  });
}

export function runSkillList(root, { json = false } = {}) {
  const bindings = loadSkillBindings(root);
  const raw = readRaw(root);
  const written = new Set(raw === null ? [] : Object.keys(raw.steps && typeof raw.steps === 'object' ? raw.steps : {}));
  const rows = skillRows(root, bindings, written);
  // Bindings on ids the catalogue does not know are listed too, and marked. They are the ones a person
  // most needs to see: `yad next` never looks them up, so without this line they are invisible.
  const extra = [...written]
    .filter((id) => !stepDef(id))
    .map((step) => ({
      step, phase: null,
      skills: stepSkills(step, bindings),
      source: Object.hasOwn(bindings.steps, step) ? 'project' : 'ignored',
      default: null,
    }));

  if (json) return log(JSON.stringify({ ok: true, file: PROJECT_FILES.skillsConfig, steps: [...rows, ...extra] }, null, 2));

  if (raw === null) {
    warn(`${PROJECT_FILES.skillsConfig} does not parse — showing the engine's defaults [YAD-STATE-001]`);
  }
  log(`\n  ${c.bold('step')}                 ${c.bold('skill(s)')}`);
  for (const r of [...rows, ...extra]) {
    const mark = r.source === 'project' ? c.cyan('•') : (r.source === 'ignored' ? c.red('!') : ' ');
    const notes = [];
    if (r.phase === null) notes.push('not a step this yadflow runs');
    if (r.source === 'ignored') notes.push('the file has a line for this step that names no skill');
    const note = notes.length ? c.dim(`   (${notes.join('; ')})`) : '';
    log(`  ${mark} ${r.step.padEnd(18)} ${r.skills.join(c.dim(' → ')) || c.dim('(none)')}${note}`);
  }
  const all = [...rows, ...extra];
  const chosen = all.filter((r) => r.source === 'project').length;
  const ignored = all.filter((r) => r.source === 'ignored').length;
  info(chosen
    ? `${c.cyan('•')} = bound by this project in ${PROJECT_FILES.skillsConfig}; the rest are the engine's defaults`
    : `every step is on the engine's default — bind one with \`yad skill bind <step> <skill>\``);
  if (ignored) info(`${c.red('!')} = a line in that file that binds nothing — \`yad doctor\` says which`);
}

export function runSkillBind(root, { step, skills = [] } = {}) {
  const names = skills.map((s) => String(s || '').trim()).filter(Boolean);
  if (!step || !names.length) {
    return bail('usage: yad skill bind <step> <skill> [<skill> …]',
      `bindable steps: ${bindableSteps().join(' · ')}`);
  }
  const def = stepDef(step);
  // A review gate is refused rather than warned about: nothing would ever invoke the binding, so
  // writing it would record a decision that silently never happens.
  if (def && !def.skill) {
    return bail(`\`${step}\` is a review gate — no skill runs it`,
      `it is driven by \`yad gate open\` / \`yad gate sync\`. Bind the step it reviews instead${def.reviews ? `: \`${def.reviews}\`` : ''}`);
  }
  // An UNKNOWN id is allowed through with a warning, not refused. The file wins for this whole major
  // (rule 3), and a project may legitimately hold a step from a newer release than the CLI in hand.
  const raw = readRaw(root);
  if (raw === null) return brokenFile();
  const steps = raw.steps && typeof raw.steps === 'object' && !Array.isArray(raw.steps) ? { ...raw.steps } : {};
  steps[step] = names.length === 1 ? names[0] : names;
  writeJSON(skillsFile(root), withSteps(raw, steps));

  ok(`${step} → ${names.join(' → ')}`);
  if (!def) {
    info(`\`${step}\` is not a step this yadflow runs — the binding is recorded but nothing will invoke it`);
  }
  // Closed decision 7: extra skills are a chain, never a panel, and every extra one costs another run.
  if (names.length > 1) {
    info(`${names.length} skills run for this step, one after another — each one costs tokens`);
    info('they chain: each sees what the one before it produced, and the last output is the artifact');
  }
  hand(`written to ${PROJECT_FILES.skillsConfig} — \`yad next\` names it from now on (undo with \`yad skill unbind ${step}\`)`);
}

export function runSkillUnbind(root, { step } = {}) {
  if (!step) return bail('usage: yad skill unbind <step>');
  const raw = readRaw(root);
  if (raw === null) return brokenFile();
  const steps = raw.steps && typeof raw.steps === 'object' && !Array.isArray(raw.steps) ? { ...raw.steps } : {};
  if (!(step in steps)) {
    return bail(`${step} is not bound in ${PROJECT_FILES.skillsConfig}`, 'see `yad skill list` for what is bound');
  }
  delete steps[step];
  // The file is left behind, holding an empty `steps`, rather than deleted. Deleting a file the user
  // may have hand-authored — with comments-by-convention, or keys a later release reads — to undo one
  // line would throw away more than was asked for.
  writeJSON(skillsFile(root), withSteps(raw, steps));
  // What runs it now: the engine's default, or nothing at all if this engine does not know the step.
  const fallback = stepSkills(step, null);
  ok(`${step} unbound${fallback.length ? ` — back to the engine's default (${fallback.join(' → ')})` : ' — this yadflow runs no skill for it'}`);
}
