// The lifecycle definition — the phases, steps and routes as one versioned JSON file (E134, the first row
// of the lifecycle spine; docs/roadmap-idea-1.md, "The lifecycle spine").
//
// WHERE THE LIFECYCLE LIVES NOW. yadflow ships its default as `cli/lifecycle/defaults/<n>.json`. Until
// E134 the same facts were lists written in `cli/epic-state.mjs` (`STEPS`, `LIFECYCLE_PROFILES`,
// `PHASES`, `PRODUCT_PHASES`, the Build order). Those names still exist, with the same contents, but they
// are now VIEWS of the default, built by the functions at the bottom of this file. A test compares each
// view, field by field and in key order, with a frozen copy of the lists as they stood before this row
// (`cli/fixtures/lifecycle-v4-catalogue.json`), so the move changed nothing the engine does.
//
// WHAT IS NOT READ YET. Nothing reads a team's own file in this row: `.sdlc/lifecycle.json` is E135. The
// validator below (`lifecycleProblems`) and the behaviour registry are built and tested now so the file
// format is settled before anyone can write one. Several fields of a step (`behaviours`, `inputs`,
// `extraPaths`, `provider`, `replaces`) are checked by the validator now; the engine starts to act on
// them in later rows (E136, E141).
//
// A PAST DEFAULT NEVER CHANGES. A team's file will say which default it was copied from (`extends:
// "yadflow-default@<n>"`), and `yad lifecycle upgrade` (E141) compares the old default, the team's file
// and the new default. That only works if `1.json` stays exactly what it was on the day it shipped. A
// change to the default is a new file, `2.json`. The release check refuses a release that edits a
// default an earlier release carried (scripts/release-check.sh).
//
// IT IS JSON, NOT AN IMPORT. The file is read with `fs` rather than `import … with { type: 'json' }`,
// because the published package supports Node 18, where that import form is not stable on every release.
import fs from 'node:fs';

// The newest shipped default — the one every reader uses until a team file exists (E135).
export const DEFAULT_VERSION = 2;

const DEFAULTS_DIR = new URL('./lifecycle/defaults/', import.meta.url);

// Every default this package ships, oldest first, as numbers. E141's three-way upgrade needs the old ones.
export function shippedDefaults() {
  return fs.readdirSync(DEFAULTS_DIR).map((f) => /^([1-9]\d*)\.json$/.exec(f)?.[1]).filter(Boolean)
    .map(Number).sort((a, b) => a - b);
}

// One shipped default, exactly as the file says (not normalized).
export function loadDefault(n = DEFAULT_VERSION) {
  return JSON.parse(fs.readFileSync(new URL(`${n}.json`, DEFAULTS_DIR), 'utf8'));
}

// YADFLOW'S CLAIMS: every step yadflow has ever shipped, by its original id (`provider.origin`), with the
// files it claims — its artifact (path and type) and the files it commits beside it (`extraPaths`, such as
// the contract beside the architecture). Read from the shipped defaults, so the rule cannot drift from the
// data; a test ties these files to what the engine itself commits for each step (`stepPaths`, cli/fold.mjs).
//
//   byOrigin  origin -> { type, path, version, extras } (`version`: the newest `provider.version`
//             shipped). A step that names a yadflow origin must name one of these (a step with no origin
//             is matched by its id), or the upgrade merge (E141), which matches yadflow's steps by origin, would have
//             nothing to match it to.
//   byKey     the key a review branch finds a file by (`artifactKey`) -> the origin that owns it. Once
//             yadflow ships a name it stays reserved for that step, even in a file that deleted the step:
//             the engine treats several of these names specially by name (`architecture` is hashed with
//             the contract lock, `discovery` is read back as the discovery set), so another step taking
//             one would be read the wrong way.
//
// Read when the validator first needs it, not when this module loads: every `yad` command imports this
// module, and only the validator needs the older defaults.
let claims = null;
export function yadflowClaims() {
  if (claims) return claims;
  const byOrigin = new Map();
  const byKey = new Map();
  for (const n of shippedDefaults()) {
    for (const st of arr(loadDefault(n).steps)) {
      if (!isObj(st) || st.provider?.id !== 'yadflow' || typeof st.provider.origin !== 'string') continue;
      const o = st.provider.origin;
      const art = isObj(st.artifact) && typeof st.artifact.path === 'string' ? st.artifact : null;
      const extras = arr(st.extraPaths).filter((x) => typeof x === 'string');
      const version = Math.max(byOrigin.get(o)?.version ?? 0, Number.isInteger(st.provider.version) ? st.provider.version : 0);
      byOrigin.set(o, { type: art?.type ?? null, path: art?.path ?? null, version, extras: [...new Set([...(byOrigin.get(o)?.extras ?? []), ...extras])] });
      for (const f of [art?.path, ...extras]) if (f) byKey.set(artifactKey(f), o);
    }
  }
  claims = { byOrigin, byKey };
  return claims;
}

// `currentStep` markers that are NOT steps: they never appear in `steps[]`, and no phase claims them.
// They stay in code on purpose (the roadmap's "What stays in code"): they describe an epic's state, not a
// step a team may define. They live in this file, not `epic-state.mjs`, because the validator needs them
// (a step may not be called `ready-for-build`) and `epic-state.mjs` imports this file; it re-exports
// them under the same name.
export const SENTINELS = ['ready-for-build', 'backfill-pending', 'backfill-done', 'discovery-done', 'foundation-done'];

// The values this release understands. A value outside these lists is not an error for the whole file:
// a team file may come from a newer yadflow, so a step using an unknown value is only marked unusable
// for new epics, and the rest of the file still loads (the roadmap's unknown-value rule).
export const STEP_KINDS = ['author', 'review'];
export const ARTIFACT_TYPES = ['file', 'folder', 'set'];
export const PHASE_RUNS = ['once', 'loop'];
export const PHASE_LEVELS = ['feature', 'product'];
export const PARTS = ['Shape', 'Build', 'Run'];
// Who does a step's work, by default (E157), in the words of the shape-4 `driver` dial (cli/manifest.mjs):
// `human` (only a person can), `pair` (the AI agent drafts, the person answers its questions and decides)
// or `agent` (the agent does it). An epic's own `driver` on a step, when it records one, says what that
// epic chose. An AI agent reads it through `yad guide --json` to know when to stop and hand the work over.
// A review step is a person's approval, so its driver is `human`. A gate is moved on only by a person (its
// `advance` is `human`, rule 1 of the spine: a gate is never automatic), so a file that says otherwise is
// refused.
export const DRIVERS = ['human', 'pair', 'agent'];

// THE BEHAVIOUR REGISTRY. A behaviour is something the engine does because of a step, not because of a
// step's name: the epic step is where the work-item type is read, the architecture step locks the
// contract, and so on. A team may rename, re-skill, move or make optional a step that carries one, but
// the rules below say what it may not do, because the engine and the CI checks depend on them.
// Only yadflow defines behaviours; a team cannot invent one.
//
//   where     which part of the lifecycle the step must sit in: `shape` (a Shape phase), `product` (the
//             Foundation level), or `lane` (the Build loop).
//   artifacts the artifact names a step with this behaviour may have. The engine and the CI checks read
//             these files by name (until E136 at least), so moving the behaviour to a step with another
//             file, or renaming the file, would leave them reading nothing. `product-level` allows two,
//             because it sits on both `foundation` and the retired `discovery`.
//   keepGate  the step must keep its review gate. Every Shape and Foundation behaviour does, except
//             `parallel-with-build`, whose step (test-cases) may drop it.
//   review    the step must be a standalone `review` step (the merge gate).
//   route     how many steps with this behaviour each route of that kind must hold: [min, max].
//
// What each behaviour DOES is still code in the engine (`advanceState`, the contract lock, …). E136 moves
// the engine from step ids to these names.
export const BEHAVIOURS = {
  'work-item-source': { where: 'shape', keepGate: true, artifacts: ['epic.md'], route: [1, 1] },
  'locks-contract': { where: 'shape', keepGate: true, artifacts: ['architecture.md'], route: [0, 1] },
  'ends-shape': { where: 'shape', keepGate: true, artifacts: ['stories/'], route: [1, 1] },
  'parallel-with-build': { where: 'shape', keepGate: false, artifacts: ['test-cases.md'], route: [0, 1] },
  'product-level': { where: 'product', keepGate: true, artifacts: ['foundation/', 'discovery/'], route: [1, 1] },
  'spec-source': { where: 'lane', keepGate: false, route: [1, 1] },
  'code-change': { where: 'lane', keepGate: false, route: [1, 1] },
  'ci-gates': { where: 'lane', keepGate: false, route: [1, 1] },
  'merge-gate': { where: 'lane', keepGate: false, review: true, route: [1, 1] },
};

// The second half of the same rule is yadflow's claims (`yadflowClaims`, above): a step yadflow ships keeps
// the files it shipped with even when a team takes its behaviour away. Until E136 the engine finds these
// files through step id literals (`'epic'`, `base === 'architecture'` in cli/epic-state.mjs), not through
// behaviours or `provider`. `provider.origin` is how the validator still recognises a yadflow step a team
// renamed, and a step whose id is one yadflow ships must say so (`provider: { id: "yadflow", origin: <its
// id> }`), so deleting the record cannot free its files.

// The keys this release knows at each level. Anything else is kept as it is and reported as a warning,
// so a file from a newer yadflow still loads.
export const KNOWN_KEYS = {
  file: ['$schema', 'schemaVersion', 'extends', 'phases', 'steps', 'routes', 'plugins'],
  phase: ['id', 'name', 'description', 'part', 'level', 'runs', 'over', 'built'],
  step: ['id', 'name', 'description', 'phase', 'kind', 'artifact', 'optional', 'gate', 'skills', 'behaviours',
    'extraPaths', 'inputs', 'retired', 'replaces', 'provider', 'driver'],
  route: ['id', 'name', 'description', 'steps', 'bindings', 'retired', 'provider'],
  gate: ['riskTags', 'skills', 'description', 'advance'],
  artifact: ['type', 'path', 'unit', 'files', 'optional', 'in'],
  provider: ['id', 'version', 'origin'],
  routeStep: ['id', 'optional'],
};

// The suffix the engine gives a gate it derives from an author step. It stays in code (rule 1 of the
// spine: a gate is never automatic, and its id is not something a team chooses).
export const GATE_SUFFIX = '-review';
export const gateIdOf = (id) => `${id}${GATE_SUFFIX}`;

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);
const isStrings = (x) => Array.isArray(x) && x.every((v) => typeof v === 'string');

const ID_RE = /^[a-z][a-z0-9-]*$/;

// A path inside the epic folder, as the engine joins it: no `..`, no leading `/` or drive letter, no
// backslash, no empty or `.` part. A folder may end in `/`.
export function cleanPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.startsWith('/') || /^[a-z]:/i.test(p)) return false;
  return p.replace(/\/$/, '').split('/').every((part) => part && part !== '.' && part !== '..');
}

// The key a review branch is found by: `review/EP-<slug>/<base>`. The same rule as `artifactBase` in
// cli/epic-state.mjs (which this module cannot import: that file imports this one), compared without
// letter case, because macOS and Windows file systems treat `Epic.md` and `epic.md` as one file.
// `stories/<anything>-S01.md` maps to `stories-s01`, which the engine reads back as the stories gate.
export function artifactKey(p) {
  const a = String(p).replace(/\/$/, '');
  const m = a.match(/stories\/.*?(S\d+)\.md$/i);
  if (m) return `stories-${m[1]}`.toLowerCase();
  return a.split('/').pop().replace(/\.md$/i, '').toLowerCase();
}

// The definition with every optional field filled in, so readers never have to ask "is it there". Unknown
// keys are kept as they are. The input is never changed; the result is a new object.
export function normalizeLifecycle(raw) {
  const def = isObj(raw) ? raw : {};
  return {
    ...def,
    phases: arr(def.phases).map((p) => ({
      ...p,
      runs: p?.runs ?? 'once',
      over: arr(p?.over),
      built: p?.built ?? true,
    })),
    steps: arr(def.steps).map((s) => ({
      ...s,
      artifact: s?.artifact ?? null,
      optional: !!s?.optional,
      gate: s?.gate ? { ...s.gate, riskTags: arr(s.gate.riskTags) } : null,
      skills: arr(s?.skills),
      behaviours: arr(s?.behaviours),
      extraPaths: arr(s?.extraPaths),
      inputs: arr(s?.inputs),
      retired: !!s?.retired,
    })),
    routes: arr(def.routes).map((r) => ({
      ...r,
      steps: arr(r?.steps).map((x) => (typeof x === 'string' ? { id: x } : { ...x })),
      bindings: isObj(r?.bindings) ? r.bindings : {},
      retired: !!r?.retired,
    })),
    plugins: arr(def.plugins),
  };
}

// Where a phase sits: `product` (the Foundation level), `lane` (the Build loop — the Build part's loop
// phase), `shape` (a Shape phase), or `run` (Release, Operate). The lane is told apart by its part, not by
// `runs: loop` alone, because Release loops too (over releases) and is not the Build lane.
//
// A Build phase whose `runs` is a value this release does not know still counts as the lane: its steps
// are reported unusable, and the rest of the file keeps its one lane (the unknown-value rule).
function phaseWhere(p) {
  if (!p) return null;
  if (p.level === 'product') return 'product';
  if (p.part === 'Build') return p.runs === 'once' ? null : 'lane';
  if (p.part === 'Shape') return 'shape';
  return p.part === 'Run' ? 'run' : null;
}

// Which kind of route this is, worked out from the phases of its steps (a route has no `level` field):
// `product` (the Foundation level), `lane` (the Build loop), `feature` (the Shape phases), `run` (the Run
// phases, none built yet), or null when its steps mix two of those, or name a step or phase that does
// not exist.
export function routeKind(def, route) {
  const phase = new Map(def.phases.map((p) => [p.id, p]));
  const step = new Map(def.steps.map((s) => [s.id, s]));
  const kinds = new Set(route.steps.map((x) => {
    const w = phaseWhere(phase.get(step.get(x.id)?.phase));
    return w === 'shape' ? 'feature' : w;
  }));
  return kinds.size === 1 && !kinds.has(null) ? [...kinds][0] : null;
}

// Where a step sits, in the registry's words. Null when its phase is unknown.
const stepWhere = (def, s) => phaseWhere(def.phases.find((x) => x.id === s.phase));

// A `provider` record: who ships the step or route, which version of their lifecycle, and the step's
// original id. Every field is optional, but each has one type.
const PROVIDER_SHAPE = '"provider" must be { "id": text, "version": a whole number, "origin": text }';
const providerOk = (p) => isObj(p) && (p.id === undefined || typeof p.id === 'string')
  && (p.version === undefined || Number.isInteger(p.version)) && (p.origin === undefined || typeof p.origin === 'string');

// THE VALIDATOR. Every problem with a lifecycle definition, as a list. An empty list means the file can
// be used as it is. Hand-written on purpose: the package has no runtime dependencies, and each rule says
// why it exists in a sentence a person can act on.
//
// Each problem is `{ level, where, message }`:
//   error     the file cannot be used.
//   unusable  one step (or route) uses a value this release does not know; it cannot be used for new
//             epics, and the rest of the file still loads.
//   warn      an unknown key, kept as it is, or a reference that names nothing where nothing breaks.
// `where` names the place: `file`, `phase <id>`, `step <id>` or `route <id>`.
export function lifecycleProblems(raw) {
  const out = [];
  const add = (level, where, message) => out.push({ level, where, message });
  if (!isObj(raw)) {
    add('error', 'file', 'the lifecycle definition must be a JSON object');
    return out;
  }
  const def = normalizeLifecycle(raw);
  // An unknown key is kept and warned about, at every level — a nested object (`gate`, `artifact`,
  // `provider`, a route's step entry) included, so a field a newer yadflow adds is never silently ignored.
  const NESTED = { gate: ' in "gate"', artifact: ' in "artifact"', provider: ' in "provider"', routeStep: ' in a route step' };
  const unknownKeys = (obj, level, where) => {
    if (!isObj(obj)) return;
    for (const k of Object.keys(obj)) if (!KNOWN_KEYS[level].includes(k)) add('warn', where, `unknown key "${k}"${NESTED[level] ?? ''} is kept and not read`);
  };

  // The file.
  unknownKeys(raw, 'file', 'file');
  if (!Number.isInteger(raw.schemaVersion)) add('error', 'file', '"schemaVersion" must be a whole number (the project\'s file shape)');
  if (raw.extends !== undefined && !(typeof raw.extends === 'string' && /^yadflow-default@[1-9]\d*$/.test(raw.extends))) {
    add('error', 'file', '"extends" must look like "yadflow-default@<n>", naming the shipped default the file was copied from');
  }
  for (const key of ['phases', 'steps', 'routes']) {
    if (!Array.isArray(raw[key])) add('error', 'file', `"${key}" must be a list`);
  }
  if (raw.plugins !== undefined && !Array.isArray(raw.plugins)) add('error', 'file', '"plugins" must be a list');

  // Phases.
  const phaseIds = new Set();
  for (const [i, p] of arr(raw.phases).entries()) {
    const where = `phase ${p?.id ?? `#${i + 1}`}`;
    if (!isObj(p) || typeof p.id !== 'string' || !p.id) { add('error', where, 'a phase needs an "id"'); continue; }
    unknownKeys(p, 'phase', where);
    if (!ID_RE.test(p.id)) add('error', where, 'a phase id is lower-case letters, digits and dashes, starting with a letter');
    if (typeof p.name !== 'string' || !p.name) add('error', where, 'a phase needs a "name"');
    if (phaseIds.has(p.id)) add('error', where, 'two phases share this id');
    phaseIds.add(p.id);
    if (!PHASE_LEVELS.includes(p.level)) add('error', where, `"level" must be one of: ${PHASE_LEVELS.join(', ')}`);
    if (p.level === 'feature' && !PARTS.includes(p.part)) add('error', where, `a feature phase needs a "part": ${PARTS.join(', ')}`);
    if (p.level === 'product' && p.part !== undefined) add('error', where, 'a product phase belongs to no part, so it has no "part"');
    if (p.description !== undefined && typeof p.description !== 'string') add('error', where, '"description" must be text');
    if (p.runs !== undefined && typeof p.runs !== 'string') add('error', where, '"runs" must be a word: once or loop');
    else if (p.runs !== undefined && !PHASE_RUNS.includes(p.runs)) add('unusable', where, `"runs" is "${p.runs}", which this yadflow does not know; its steps cannot be used for new epics`);
    if (p.part === 'Build' && def.phases[i].runs === 'once') add('error', where, 'a Build phase runs in a loop (over each story and repo), so its "runs" is "loop"');
    if (p.over !== undefined && !isStrings(p.over)) add('error', where, '"over" must be a list of words');
    if (p.runs === 'loop' && arr(p.over).length === 0) add('error', where, 'a loop phase needs "over" (what it loops over, such as "story" and "repo")');
    if (p.built !== undefined && typeof p.built !== 'boolean') add('error', where, '"built" must be true or false');
  }
  const unknownRuns = new Set(def.phases.filter((p) => !PHASE_RUNS.includes(p.runs)).map((p) => p.id));

  // Steps.
  const stepById = new Map();
  const claimsList = [];
  const origins = new Map();
  const folders = [];
  const allPaths = [];
  for (const [i, s] of arr(raw.steps).entries()) {
    const where = `step ${s?.id ?? `#${i + 1}`}`;
    if (!isObj(s) || typeof s.id !== 'string') { add('error', where, 'a step needs an "id"'); continue; }
    const n = def.steps[i];
    unknownKeys(s, 'step', where);
    unknownKeys(s.gate, 'gate', where);
    unknownKeys(s.artifact, 'artifact', where);
    unknownKeys(s.provider, 'provider', where);
    if (!ID_RE.test(s.id)) add('error', where, 'a step id is lower-case letters, digits and dashes, starting with a letter');
    if (/-s\d+$/.test(s.id)) add('error', where, 'a step id must not end like a story id (-s01)');
    if (SENTINELS.includes(s.id)) add('error', where, `"${s.id}" is a word the engine uses for an epic's state, not a step`);
    if (typeof s.name !== 'string' || !s.name) add('error', where, 'a step needs a "name"');
    if (stepById.has(s.id)) add('error', where, 'two steps share this id');
    stepById.set(s.id, n);
    // A wrong type is reported, never quietly read as empty: `skills: "yad-epic"` would otherwise lose
    // the step its skill without a word.
    for (const key of ['skills', 'behaviours', 'extraPaths', 'inputs']) {
      if (s[key] !== undefined && !(isStrings(s[key]) && s[key].every(Boolean))) add('error', where, `"${key}" must be a list of names, none of them empty`);
    }
    for (const key of ['optional', 'retired']) {
      if (s[key] !== undefined && typeof s[key] !== 'boolean') add('error', where, `"${key}" must be true or false`);
    }
    if (s.replaces !== undefined && typeof s.replaces !== 'string') add('error', where, '"replaces" must be a step id');
    if (s.description !== undefined && typeof s.description !== 'string') add('error', where, '"description" must be text');
    if (s.driver !== undefined && typeof s.driver !== 'string') add('error', where, `"driver" must be one word: ${DRIVERS.join(', ')}`);
    else if (s.driver !== undefined && !DRIVERS.includes(s.driver)) add('unusable', where, `"driver" is "${s.driver}", which this yadflow does not know; the step cannot be used for new epics`);
    if (s.kind === 'review' && s.driver !== undefined && s.driver !== 'human') add('error', where, 'a review step is a person\'s approval, so its "driver" is "human"');
    if (s.provider !== undefined && !providerOk(s.provider)) add('error', where, PROVIDER_SHAPE);
    if (!phaseIds.has(s.phase)) add('error', where, `its phase "${s.phase}" does not exist`);
    else if (unknownRuns.has(s.phase)) add('unusable', where, `its phase "${s.phase}" uses a "runs" value this yadflow does not know`);

    if (typeof s.kind !== 'string') add('error', where, `a step needs a "kind": ${STEP_KINDS.join(' or ')}`);
    else if (!STEP_KINDS.includes(s.kind)) {
      add('unusable', where, `"kind" is "${s.kind}", which this yadflow does not know; the step cannot be used for new epics`);
    } else if (s.kind === 'author' && s.id.endsWith(GATE_SUFFIX)) {
      add('error', where, `an author step id must not end in "${GATE_SUFFIX}": that ending belongs to the gate the engine adds`);
    }
    if (s.kind === 'review' && n.gate) add('error', where, 'a review step is a gate on its own, so its "gate" must be null');
    if (s.kind === 'review' && n.artifact !== null) add('error', where, 'a review step reviews the work before it and writes no artifact of its own, so its "artifact" is null');
    if (s.gate !== undefined && s.gate !== null && (!isObj(s.gate) || (s.gate.riskTags !== undefined && !isStrings(s.gate.riskTags))
      || (s.gate.skills !== undefined && !isStrings(s.gate.skills)))) {
      add('error', where, '"gate" must be null or { "riskTags": [ … ], "skills": [ … ] }');
    }
    if (isObj(s.gate) && s.gate.description !== undefined && typeof s.gate.description !== 'string') add('error', where, 'the gate\'s "description" must be text');
    if (isObj(s.gate) && s.gate.advance !== undefined && s.gate.advance !== 'human') add('error', where, 'a gate is moved on only by a person, so the gate\'s "advance" is "human"');

    if (n.artifact !== null) {
      const a = n.artifact;
      if (!isObj(a) || typeof a.path !== 'string' || !a.path || typeof a.type !== 'string') {
        add('error', where, '"artifact" must be null or { "type", "path", … }');
      } else {
        if (!ARTIFACT_TYPES.includes(a.type)) add('unusable', where, `artifact type "${a.type}" is one this yadflow does not know; the step cannot be used for new epics`);
        if (a.type === 'set' && !isStrings(a.files)) add('error', where, 'a "set" artifact lists its "files" by name');
        if (a.unit !== undefined && typeof a.unit !== 'string') add('error', where, 'an artifact\'s "unit" is one word, such as "story"');
        if (a.in !== undefined && a.in !== 'product') {
          if (a.in === 'repo') add('unusable', where, 'an artifact kept in a code repo ("in": "repo") is reserved; this yadflow cannot use the step for new epics');
          else add('error', where, 'an artifact\'s "in" is "product" or "repo"');
        }
        if (a.type === 'set' && a.optional !== undefined && !(isStrings(a.optional) && a.optional.every((f) => arr(a.files).includes(f)))) {
          add('error', where, 'a "set" artifact\'s "optional" lists some of its "files"');
        }
      }
    }
    // THE FILES A STEP CLAIMS: its artifact, its `extraPaths`, and — for a `set` — each file the set lists
    // (the engine commits those as the step's files, directly in the epic folder). Each must be a clean
    // path inside the epic folder; a `.sdlc` path is ledger unless it is exactly a path yadflow ships for
    // this step's origin; a name yadflow ships
    // belongs to that yadflow step only; and no two steps may claim files a review branch finds by one key
    // (`artifactKey`), or they would share one gate (checked after every step is read, below).
    const isYadflow = isObj(s.provider) && s.provider.id === 'yadflow';
    const origin = isYadflow && typeof s.provider.origin === 'string' ? s.provider.origin : null;
    const { byOrigin, byKey } = yadflowClaims();
    const artPath = isObj(n.artifact) && typeof n.artifact.path === 'string' && n.artifact.path ? n.artifact.path : null;
    // A step from a newer yadflow — a `provider.version` this release never shipped for its origin, or an
    // origin this release does not know at all — or with an artifact type this release does not know may
    // have moved its files on purpose. Every rule about which names it may claim (reserved names, the
    // ledger, the behaviour's names, the files it shipped with) then reports it unusable here, never a
    // broken file (the unknown-value rule). The shape rules (a clean path, no name twice, no story-like
    // name) and the rules between two steps stay errors.
    const shippedVersion = origin !== null ? byOrigin.get(origin)?.version : undefined;
    const newer = (origin !== null && shippedVersion === undefined)
      || (shippedVersion !== undefined && Number.isInteger(s.provider.version) && s.provider.version > shippedVersion)
      || (isObj(n.artifact) && !ARTIFACT_TYPES.includes(n.artifact.type));
    const level = newer ? 'unusable' : 'error';
    const extras = isStrings(s.extraPaths) ? s.extraPaths : [];
    for (const x of extras) if (x.endsWith('/')) add('error', where, `"${x}" in "extraPaths" is a folder; list the files, or make the folder the step's artifact`);
    const isSet = n.artifact?.type === 'set';
    const members = isSet && isStrings(n.artifact.files) ? n.artifact.files : [];
    if (isSet && isStrings(n.artifact.files) && members.length === 0) add('error', where, 'a "set" artifact lists at least one file');
    for (const f of members) if (f.includes('/')) add('error', where, `"${f}" in a set's "files" is a file name: the set's files sit directly in its epic folder`);
    const stepLevel = def.phases.find((x) => x.id === s.phase)?.level ?? null;
    const productSet = isSet && stepLevel === 'product';
    const ownFiles = new Set();
    for (const [claimed, member] of [[artPath, false], ...extras.map((x) => [x, false]), ...members.map((x) => [x, true])]) {
      if (claimed === null) continue;
      if (!cleanPath(claimed)) { add('error', where, `"${claimed}" must be a path inside the epic folder: not empty, no "..", no leading "/", no "\\"`); continue; }
      // One step naming one file twice (`a.md` and `A.md` are one file on macOS and Windows) would count it twice.
      const bareOwn = claimed.replace(/\/$/, '').toLowerCase();
      if (ownFiles.has(bareOwn)) add('error', where, `"${claimed}" is listed twice among this step's files (letter case ignored)`);
      ownFiles.add(bareOwn);
      if (claimed === artPath && n.artifact.type === 'file' && claimed.endsWith('/')) add('error', where, `"${claimed}" is a file, so it does not end in "/"`);
      const key = artifactKey(claimed);
      if (/-s\d+$/.test(key)) add('error', where, `"${claimed}" is named like a story (-S01), which the engine reads as the stories gate`);
      const reservedFor = byKey.get(key);
      const bare = claimed.replace(/\/$/, '').toLowerCase();
      if (reservedFor !== undefined && reservedFor !== origin) {
        add(level, where, `"${claimed}" is a file of yadflow's "${reservedFor}" step (found as "${key}"); only that step may claim it`);
      }
      // The ledger folder: only the exact `.sdlc/` paths yadflow ships for this step's origin are allowed,
      // never another path that merely shares their review key (`.sdlc/x/contract.md`).
      const shippedPaths = origin !== null && byOrigin.has(origin)
        ? [byOrigin.get(origin).path, ...byOrigin.get(origin).extras].filter(Boolean).map((x) => x.toLowerCase()) : [];
      if ((bare === '.sdlc' || bare.startsWith('.sdlc/')) && !shippedPaths.includes(claimed.toLowerCase())) {
        add(level, where, `"${claimed}" is in .sdlc/, which holds the ledger; a step's files live beside it`);
      }
      claimsList.push({ step: s.id, where, path: claimed, key, level: stepLevel, member, productSet });
    }
    if (n.artifact?.type === 'folder' && artPath) folders.push({ step: s.id, level: stepLevel, prefix: artPath.replace(/\/?$/, '/').toLowerCase() });
    allPaths.push(...[artPath, ...extras].filter((x) => typeof x === 'string').map((x) => ({ step: s.id, level: stepLevel, path: x })));

    // Behaviours.
    const at = stepWhere(def, n);
    for (const b of n.behaviours) {
      if (!own(BEHAVIOURS, b)) { add('unusable', where, `behaviour "${b}" is one this yadflow does not know; the step cannot be used for new epics`); continue; }
      const rule = BEHAVIOURS[b];
      if (at !== rule.where) add('error', where, `behaviour "${b}" belongs in ${rule.where === 'shape' ? 'a Shape phase' : rule.where === 'product' ? 'the product level' : 'the Build loop'}`);
      if (rule.keepGate && !n.gate) add('error', where, `behaviour "${b}" needs the step to keep its review gate`);
      if (rule.review && s.kind !== 'review') add('error', where, `behaviour "${b}" must stay a "review" step: it is the merge gate`);
      if (rule.artifacts && !rule.artifacts.includes(n.artifact?.path)) {
        add(level, where, `behaviour "${b}" needs the artifact ${rule.artifacts.map((x) => `"${x}"`).join(' or ')}: the engine and the CI checks read it by that name`);
      }
    }

    // yadflow's own steps: a step whose id is one yadflow ships says so; a known origin is used once and
    // keeps the artifact (path and type) and the extra files it shipped with. An origin this release does
    // not know is from a newer yadflow: that step is unusable here, and the rest of the file still loads.
    if (byOrigin.has(s.id) && origin !== s.id) {
      add('error', where, `"${s.id}" is a step yadflow ships, so it keeps "provider": { "id": "yadflow", "origin": "${s.id}" } — to make a step of your own, give it another id`);
    }
    if (origin !== null) {
      const shipped = byOrigin.get(origin);
      if (!shipped) add('unusable', where, `"provider.origin" is "${origin}", a yadflow step this release does not know; the step cannot be used for new epics`);
      else {
        if (origins.has(origin)) add('error', where, `step ${origins.get(origin)} already has the origin "${origin}"; each yadflow step appears once`);
        else origins.set(origin, s.id);
        if (artPath !== shipped.path || (n.artifact?.type ?? null) !== shipped.type) {
          add(level, where, shipped.path ? `its artifact must stay "${shipped.path}" (a ${shipped.type}): the engine and the CI checks read it by that name` : 'its artifact must stay null: yadflow\'s step writes code in a repo, not a file here');
        }
        for (const x of shipped.extras) if (!extras.includes(x)) add(level, where, `its "extraPaths" must keep "${x}": the engine commits it with this step's review`);
      }
    }

    // A Build-loop step has no gate of its own and is never optional: the lane walks its route in order,
    // and the human merge gate is a step of its own (`engineer-review`), never skipped.
    if (stepWhere(def, n) === 'lane') {
      if (n.gate) add('error', where, 'a Build-loop step has no "gate": the lane\'s review is its merge-gate step');
      if (n.optional) add('error', where, 'a Build-loop step is never optional: the lane walks every step in order');
    }
  }
  // No two steps claim files a review branch finds by one key. A set's member files live in that set's own
  // epic folder, so they are compared only with steps at the same level — and two product-level sets
  // (the Foundation and the retired Discovery, each its own folder) never with each other. Reported on the
  // later of the two steps in the file.
  for (const [j, c] of claimsList.entries()) {
    const first = claimsList.slice(0, j).find((o) => o.step !== c.step && o.key === c.key
      && !(o.productSet && c.productSet && o.member && c.member)
      && (!(o.member || c.member) || o.level === c.level));
    if (first) {
      add('error', c.where, (c.member || first.member)
        ? `"${c.path}" is the same file as step ${first.step}'s "${first.path}" (letter case ignored); two steps cannot write one file`
        : `"${c.path}" is found by the same name as step ${first.step}'s "${first.path}" ("${c.key}", letter case ignored); two steps cannot share one, or they would share one review`);
    }
  }
  // A file inside another step's folder belongs to that folder's review (the stories gate hashes every
  // file under `stories/`), so no other step at the same level may claim one there — checked both ways,
  // whatever the order. A product step and a feature step live in different epic folders on disk.
  for (const f of folders) {
    for (const x of allPaths) {
      if (x.step !== f.step && x.level === f.level && x.path.toLowerCase().startsWith(f.prefix)) {
        add('error', `step ${x.step}`, `"${x.path}" is inside step ${f.step}'s folder "${f.prefix}", whose review covers every file in it`);
      }
    }
  }
  // The gate the engine derives must not take a name another step already has.
  for (const s of def.steps) {
    if (s.kind === 'author' && s.gate && stepById.has(gateIdOf(s.id))) {
      add('error', `step ${s.id}`, `its gate would be called "${gateIdOf(s.id)}", which is already a step`);
    }
    // A team may delete a retired step; the record of what replaced it then names nothing, which harms nothing.
    if (typeof s.replaces === 'string' && !stepById.has(s.replaces)) add('warn', `step ${s.id}`, `it replaces "${s.replaces}", which is not a step in this file`);
    for (const input of isStrings(s.inputs) ? s.inputs : []) {
      if (!stepById.has(input)) add('warn', `step ${s.id}`, `its input "${input}" is not a step in this file`);
    }
  }

  // Routes.
  const routeIds = new Set();
  let lanes = 0;
  for (const [i, r] of arr(raw.routes).entries()) {
    const where = `route ${r?.id ?? `#${i + 1}`}`;
    if (!isObj(r) || typeof r.id !== 'string' || !r.id) { add('error', where, 'a route needs an "id"'); continue; }
    const n = def.routes[i];
    unknownKeys(r, 'route', where);
    unknownKeys(r.provider, 'provider', where);
    if (Array.isArray(r.steps)) for (const x of r.steps) unknownKeys(x, 'routeStep', where);
    if (!ID_RE.test(r.id)) add('error', where, 'a route id is lower-case letters, digits and dashes, starting with a letter');
    if (typeof r.name !== 'string' || !r.name) add('error', where, 'a route needs a "name"');
    if (routeIds.has(r.id)) add('error', where, 'two routes share this id');
    routeIds.add(r.id);
    if (r.bindings !== undefined && !isObj(r.bindings)) add('error', where, '"bindings" must be an object');
    if (r.retired !== undefined && typeof r.retired !== 'boolean') add('error', where, '"retired" must be true or false');
    if (r.description !== undefined && typeof r.description !== 'string') add('error', where, '"description" must be text');
    if (r.provider !== undefined && !providerOk(r.provider)) add('error', where, PROVIDER_SHAPE);
    if (!Array.isArray(r.steps)) { add('error', where, '"steps" must be a list'); continue; }
    const bad = r.steps.filter((x) => !(typeof x === 'string' || (isObj(x) && typeof x.id === 'string'
      && (x.optional === undefined || typeof x.optional === 'boolean'))));
    if (bad.length) { add('error', where, 'each step is a step id, or { "id": "<step>", "optional": true | false }'); continue; }
    if (n.steps.length === 0) { add('error', where, 'a route needs at least one step'); continue; }
    const seen = new Set();
    let missing = false;
    for (const x of n.steps) {
      if (!stepById.has(x.id)) { add('error', where, `step "${x.id}" does not exist`); missing = true; }
      if (seen.has(x.id)) add('error', where, `step "${x.id}" is listed twice`);
      seen.add(x.id);
    }
    if (missing) continue;
    // A route new epics take cannot hold a step that is never seeded for new epics.
    if (!n.retired) for (const x of n.steps) if (stepById.get(x.id).retired) add('error', where, `step "${x.id}" is retired, so only a retired route may list it`);
    // A step whose phase does not exist is already reported on the step; the route says nothing more.
    if (n.steps.some((x) => !stepWhere(def, stepById.get(x.id)))) continue;
    const kind = routeKind(def, n);
    if (!kind) { add('error', where, 'its steps mix the product level, the Shape phases, the Build loop and the Run phases; a route stays in one'); continue; }
    if (kind === 'lane') {
      lanes += 1;
      if (n.steps.some((x) => x.optional !== undefined)) add('error', where, 'the Build lane walks every step in order, so its steps carry no "optional"');
    }
    // Each behaviour's route rule, for the routes of its kind.
    const scope = { shape: 'feature', product: 'product', lane: 'lane' };
    for (const [b, rule] of Object.entries(BEHAVIOURS)) {
      if (scope[rule.where] !== kind) continue;
      const count = n.steps.filter((x) => stepById.get(x.id).behaviours.includes(b)).length;
      const [min, max] = rule.route;
      if (count < min || count > max) {
        const want = min === max ? `exactly ${min}` : `at most ${max}`;
        add('error', where, `a ${kind} route needs ${want} step with behaviour "${b}"; it has ${count}`);
      }
    }
  }
  if (lanes !== 1) add('error', 'file', `there must be exactly one Build lane route (a route whose steps are in the Build part's loop phase); there are ${lanes}`);
  return out;
}

// ---- the views ---------------------------------------------------------------------------------------
//
// The shapes the engine has always read, built from a definition. Each one keeps the fields, the key
// order and the array order of the list it replaces, which the frozen-fixture test holds.

// The step catalogue, as `STEPS` (cli/epic-state.mjs). An author step with a gate becomes two rows: the
// step, then its gate `<id>-review` right after it. The gate row carries `reviews` (the step it gates) and
// the gate's risk tags; it has no skill, because `yad gate` drives Shape reviews. A standalone review step
// (`engineer-review`) is one row with its skill and no `reviews`.
export function expandSteps(def) {
  const level = new Map(def.phases.map((p) => [p.id, p.level]));
  const rows = [];
  for (const s of def.steps) {
    const artifact = s.artifact ? s.artifact.path : null;
    const row = { id: s.id, phase: s.phase, kind: s.kind, artifact };
    if (s.skills.length) row.skill = s.skills[0];
    rows.push({ ...row, level: level.get(s.phase), risk_tags: [] });
    if (s.kind === 'author' && s.gate) {
      rows.push({ id: gateIdOf(s.id), phase: s.phase, kind: 'review', artifact, reviews: s.id, level: level.get(s.phase), risk_tags: [...s.gate.riskTags] });
    }
  }
  return rows;
}

// The routes an epic can take, as `LIFECYCLE_PROFILES`. The Build lane is not one of them: an epic does not
// walk it, each story walks it in each repo. A step is optional on a route when the route says so, or,
// when the route says nothing, when the step says so (decision 2: the route wins). A non-optional step is
// written as its bare id, an optional one as `{ id, optional: true }`, and its gate follows the same way.
export function expandRoutes(def) {
  const step = new Map(def.steps.map((s) => [s.id, s]));
  return def.routes.filter((r) => routeKind(def, r) !== 'lane').map((r) => ({
    id: r.id,
    title: r.name,
    level: routeKind(def, r),
    steps: r.steps.flatMap((x) => {
      const s = step.get(x.id);
      const optional = x.optional ?? s.optional;
      const ids = s.kind === 'author' && s.gate ? [s.id, gateIdOf(s.id)] : [s.id];
      return ids.map((id) => (optional ? { id, optional: true } : id));
    }),
  }));
}

// The feature phases, as `PHASES`: the six-phase strip, Discover to Operate.
export const featurePhases = (def) => def.phases.filter((p) => p.level === 'feature')
  .map((p) => ({ id: p.id, name: p.name, part: p.part, built: p.built }));

// The product level's phases, as `PRODUCT_PHASES`: the Foundation.
export const productPhases = (def) => def.phases.filter((p) => p.level === 'product')
  .map((p) => ({ id: p.id, name: p.name, level: p.level, built: p.built }));

// The Build lane's order, as `BUILD_STEP_ORDER`: the steps one story walks in one repo.
export function laneOrder(def) {
  const lane = def.routes.find((r) => routeKind(def, r) === 'lane');
  return lane ? lane.steps.map((x) => x.id) : [];
}

// The lane steps that may ever be automated: every one but the review steps (the merge gate is locked to a
// human). `config.yaml`'s `automation.back_steps` is generated from this.
export function laneAuthorSteps(def) {
  const step = new Map(def.steps.map((s) => [s.id, s]));
  return laneOrder(def).filter((id) => step.get(id)?.kind === 'author');
}

// The shipped default, normalized — what every reader uses in this release.
export const DEFAULT_LIFECYCLE = normalizeLifecycle(loadDefault(DEFAULT_VERSION));

// ---- the copy in skills/sdlc/config.yaml ---------------------------------------------------------------
//
// `config.yaml` carries the phase table, the route ids, the sentinels and the steps that may be automated,
// for the skills and for people to read. They are GENERATED from the default, never typed: each generated
// part sits between two marker lines, and only the lines between them are ever replaced
// (`scripts/lifecycle-config.mjs`). A test fails when the file and the default disagree.
//
//   # >>> generated: <name> — …       the begin marker, with a note saying not to edit by hand
//   # <<< generated: <name>            the end marker
//
// The markers bound the region, so nothing has to guess where a YAML block ends.
export const CONFIG_REGIONS = ['lifecycle', 'back_steps'];
const BEGIN = (name) => `# >>> generated: ${name} — from cli/lifecycle/defaults/${DEFAULT_VERSION}.json by scripts/lifecycle-config.mjs; do not edit by hand`;
const END = (name) => `# <<< generated: ${name}`;

// Inline YAML maps in aligned columns, one per line, the way the table has always been laid out.
function alignedRows(rows) {
  const keys = Object.keys(rows[0] ?? {});
  const cell = (k, v) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`;
  const width = Object.fromEntries(keys.map((k) => [k, Math.max(...rows.map((r) => cell(k, r[k]).length))]));
  return rows.map((r) => `- { ${keys.map((k, i) => (i === keys.length - 1 ? cell(k, r[k]) : `${cell(k, r[k])},`.padEnd(width[k] + 1))).join(' ')} }`);
}

// Each region's lines, without indentation, for one definition.
export function configRegions(def) {
  const rows = expandSteps(def).filter((r) => !r.reviews);
  const stepsOf = (phase) => rows.filter((r) => r.phase === phase).map((r) => r.id);
  const features = featurePhases(def);
  return {
    lifecycle: [
      `parts: [${[...new Set(features.map((p) => p.part))].join(', ')}]`,
      `profiles: [${expandRoutes(def).map((r) => r.id).join(', ')}]`,
      'product_phases:',
      ...alignedRows(productPhases(def).map((p) => ({ ...p, steps: stepsOf(p.id) }))).map((l) => `  ${l}`),
      'phases:',
      ...alignedRows(features.map((p) => ({ ...p, steps: stepsOf(p.id) }))).map((l) => `  ${l}`),
      `sentinels: [${SENTINELS.join(', ')}]`,
    ],
    back_steps: [`back_steps: [${laneAuthorSteps(def).join(', ')}]`],
  };
}

// The file's text with every region rewritten from `def`. Returns the new text, the regions whose lines
// changed (`stale`), and why a region could not be found (`refused`). A refused file is returned unchanged.
//
// A file checked out with Windows line endings (CRLF) is read without them and written back with them,
// so the comparison is about the content, never the line endings.
export function applyConfigRegions(text, def = DEFAULT_LIFECYCLE) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const regions = configRegions(def);
  const stale = [];
  const refused = [];
  for (const name of CONFIG_REGIONS) {
    const begins = lines.flatMap((l, i) => (l.trim().startsWith(`# >>> generated: ${name} `) ? [i] : []));
    const ends = lines.flatMap((l, i) => (l.trim() === END(name) ? [i] : []));
    if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
      refused.push(`the "${name}" region needs exactly one begin marker followed by one end marker ("${END(name)}")`);
      continue;
    }
    const [b, e] = [begins[0], ends[0]];
    const indent = lines[b].match(/^\s*/)[0];
    const want = [`${indent}${BEGIN(name)}`, ...regions[name].map((l) => `${indent}${l}`), `${indent}${END(name)}`];
    if (lines.slice(b, e + 1).join('\n') !== want.join('\n')) stale.push(name);
    lines.splice(b, e - b + 1, ...want);
  }
  return refused.length ? { text, stale, refused } : { text: lines.join(eol), stale, refused };
}
