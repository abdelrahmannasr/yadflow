// The lifecycle definition (E134). The rules each test pins:
//   - the five lists the engine reads (STEPS, LIFECYCLE_PROFILES, PHASES, PRODUCT_PHASES, the Build order)
//     are views of the newest default (cli/lifecycle/defaults/2.json) and equal, key for key and in order, a FROZEN copy of the
//     lists as they stood before the move — comparing a view with itself would prove nothing;
//   - the shipped default passes the validator, and each validator rule fires on a file broken that way;
//   - a value this release does not know makes one step unusable, never the whole file;
//   - the editor schema and the code agree on every list of allowed values;
//   - skills/sdlc/config.yaml carries exactly what the default generates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The #280 guard (cli/test.mjs): printed lines go to stderr while the runner owns stdout.
if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}

const {
  ARTIFACT_TYPES, DRIVERS, BEHAVIOURS, DEFAULT_LIFECYCLE, DEFAULT_VERSION, KNOWN_KEYS, PARTS, PHASE_LEVELS,
  PHASE_RUNS, SENTINELS, STEP_KINDS, applyConfigRegions, configRegions, expandRoutes, expandSteps, featurePhases,
  artifactKey, laneAuthorSteps, laneOrder, lifecycleProblems, loadDefault, normalizeLifecycle, productPhases, routeKind,
  shippedDefaults, yadflowClaims,
} = await import('./lifecycle.mjs');
const { stepPaths } = await import('./fold.mjs');
const { DRIVER_FROM_ASSISTANCE } = await import('./manifest.mjs');
const ES = await import('./epic-state.mjs');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FROZEN = JSON.parse(fs.readFileSync(path.join(ROOT, 'cli', 'fixtures', 'lifecycle-v4-catalogue.json'), 'utf8'));
const fresh = () => loadDefault(1);
const messages = (def, level = 'error') => lifecycleProblems(def).filter((p) => p.level === level);

// ---- the views equal the lists they replaced -----------------------------------------------------------

test('every view equals the frozen pre-E134 list, field by field, in key order and array order', () => {
  // deepEqual ignores key order; JSON.stringify does not. Both are checked, because a printed list (a
  // `--json` answer) would change if the keys moved even with equal contents.
  const views = {
    STEPS: ES.STEPS,
    LIFECYCLE_PROFILES: ES.LIFECYCLE_PROFILES,
    PHASES: ES.PHASES,
    PRODUCT_PHASES: ES.PRODUCT_PHASES,
    SENTINELS: ES.SENTINELS,
    BUILD_STEP_ORDER: laneOrder(DEFAULT_LIFECYCLE),
  };
  assert.deepEqual(Object.keys(views).sort(), Object.keys(FROZEN).sort(), 'the fixture and the views name the same lists');
  for (const [name, view] of Object.entries(views)) {
    assert.deepEqual(view, FROZEN[name], `${name} differs from the frozen list`);
    assert.equal(JSON.stringify(view), JSON.stringify(FROZEN[name]), `${name} has the same contents but a different key order`);
  }
});

test('the frozen fixture is still what default 1 expands to (a past default never changes)', () => {
  // Once a 2.json exists the engine's lists may move on; this pins 1.json itself to the lists it shipped with.
  const d = normalizeLifecycle(loadDefault(1));
  assert.deepEqual(expandSteps(d), FROZEN.STEPS);
  assert.deepEqual(expandRoutes(d), FROZEN.LIFECYCLE_PROFILES);
  assert.deepEqual(featurePhases(d), FROZEN.PHASES);
  assert.deepEqual(productPhases(d), FROZEN.PRODUCT_PHASES);
  assert.deepEqual(laneOrder(d), FROZEN.BUILD_STEP_ORDER);
});

test('the view mapping: a gate row follows its step, the merge gate has no "reviews", the lane is no profile', () => {
  const rows = expandSteps(DEFAULT_LIFECYCLE);
  const at = (id) => rows.findIndex((r) => r.id === id);
  assert.equal(at('architecture-review'), at('architecture') + 1);
  assert.deepEqual(rows[at('architecture')].risk_tags, [], 'the author row carries no tags');
  assert.deepEqual(rows[at('architecture-review')].risk_tags, ['contract'], 'the gate row carries gate.riskTags');
  assert.ok(!('reviews' in rows[at('engineer-review')]), 'engineer-review gates nothing');
  assert.equal(rows[at('engineer-review')].skill, 'yad-engineer-review');
  assert.ok(!('skill' in rows[at('epic-review')]), 'a Shape gate has no skill: yad gate drives it');
  assert.ok(!ES.LIFECYCLE_PROFILES.some((p) => p.id === 'lane'));
  assert.equal(routeKind(DEFAULT_LIFECYCLE, DEFAULT_LIFECYCLE.routes.find((r) => r.id === 'lane')), 'lane');
  assert.deepEqual(laneAuthorSteps(DEFAULT_LIFECYCLE), ['spec', 'tasks', 'implement', 'checks']);
});

test('a step optional by default is optional on every route, and a route row overrides it (the route wins)', () => {
  const d = fresh();
  d.steps.find((s) => s.id === 'test-cases').optional = true;
  d.routes.find((r) => r.id === 'chore').steps = ['epic', 'stories', { id: 'test-cases', optional: false }];
  const p = Object.fromEntries(expandRoutes(normalizeLifecycle(d)).map((r) => [r.id, r.steps]));
  assert.deepEqual(p.classic.slice(-2), [{ id: 'test-cases', optional: true }, { id: 'test-cases-review', optional: true }]);
  assert.deepEqual(p.chore.slice(-2), ['test-cases', 'test-cases-review']);
});

test('the set artifacts list the same files the engine checks', () => {
  const art = (id) => DEFAULT_LIFECYCLE.steps.find((s) => s.id === id).artifact;
  assert.deepEqual(art('foundation').files, ES.FOUNDATION_FILES);
  assert.deepEqual(art('foundation').optional, ES.FOUNDATION_SECTIONS.filter((s) => s.optional).map((s) => s.file));
  assert.deepEqual(art('discovery').files, ES.DISCOVERY_FILES);
});

test('the shipped defaults are numbered 1..N, the newest is DEFAULT_VERSION, and each says which it is', () => {
  const ns = shippedDefaults();
  assert.deepEqual(ns, ns.map((_, i) => i + 1), 'no gap in the numbering');
  assert.equal(ns.at(-1), DEFAULT_VERSION);
  for (const n of ns) assert.equal(loadDefault(n).extends, `yadflow-default@${n}`);
});

test('loading never changes the file: normalizing returns a new object and keeps unknown keys', () => {
  const raw = fresh();
  raw.futureKey = { a: 1 };
  raw.steps[0].futureField = true;
  const before = JSON.stringify(raw);
  const n = normalizeLifecycle(raw);
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(n.futureKey, { a: 1 });
  assert.equal(n.steps[0].futureField, true);
  assert.deepEqual(normalizeLifecycle(null).steps, []);
});

// ---- the validator -------------------------------------------------------------------------------------

test('default 2 is default 1 plus the step facts, and nothing else (E157)', () => {
  // 2.json added a description to each phase, step and gate, a driver to each step, and an advance to each gate. Taking those away must give 1.json back,
  // so the engine's lists (the views) did not move.
  const strip = (d) => {
    const c = JSON.parse(JSON.stringify(d));
    delete c.extends;
    for (const ph of c.phases) delete ph.description;
    for (const st of c.steps) {
      delete st.description;
      delete st.driver;
      if (st.gate) { delete st.gate.description; delete st.gate.advance; }
    }
    return c;
  };
  assert.equal(JSON.stringify(strip(loadDefault(2))), JSON.stringify(strip(loadDefault(1))));
  const d = normalizeLifecycle(loadDefault(2));
  assert.deepEqual(expandSteps(d), FROZEN.STEPS);
  assert.deepEqual(expandRoutes(d), FROZEN.LIFECYCLE_PROFILES);
});

test('every step of the newest default says what it is for and who does it; every gate is a person\'s (E157)', () => {
  for (const st of loadDefault(DEFAULT_VERSION).steps) {
    assert.ok(typeof st.description === 'string' && st.description.length > 20, `${st.id} has a description`);
    assert.ok(DRIVERS.includes(st.driver), `${st.id} has a driver`);
    if (st.kind === 'review') assert.equal(st.driver, 'human', `${st.id} is a person's approval`);
    if (st.gate) {
      assert.equal(st.gate.advance, 'human', `${st.id}'s gate is a person's`);
      assert.ok(typeof st.gate.description === 'string' && st.gate.description.length > 20, `${st.id}'s gate has a description`);
    }
  }
});

test('the driver rules: a wrong type is an error, an unknown word makes the step unusable, a gate or review is a person\'s', () => {
  const d1 = loadDefault(2); step(d1, 'epic').driver = 3;
  assert.match(messages(d1).map((m) => m.message).join('\n'), /"driver" must be one word/);
  const d2 = loadDefault(2); step(d2, 'epic').driver = 'robot';
  assert.deepEqual(messages(d2), []);
  assert.match(messages(d2, 'unusable').map((m) => m.message).join('\n'), /"driver" is "robot"/);
  const d3 = loadDefault(2); step(d3, 'engineer-review').driver = 'agent';
  assert.match(messages(d3).map((m) => m.message).join('\n'), /a review step is a person's approval/);
  const d4 = loadDefault(2); step(d4, 'epic').gate.advance = 'auto';
  assert.match(messages(d4).map((m) => m.message).join('\n'), /a gate is moved on only by a person/);
  const d5 = loadDefault(2); step(d5, 'epic').gate.description = ['x'];
  assert.match(messages(d5).map((m) => m.message).join('\n'), /the gate's "description" must be text/);
  // A file without the facts (1.json, or a team file copied from it) still loads with no problem.
  assert.deepEqual(lifecycleProblems(loadDefault(1)), []);
});

test('the shipped default has no problems at all', () => {
  for (const n of shippedDefaults()) assert.deepEqual(lifecycleProblems(loadDefault(n)), [], `default ${n}`);
});

// Each case breaks a fresh copy of the default one way and names the words its problem must contain.
const step = (d, id) => d.steps.find((s) => s.id === id);
const route = (d, id) => d.routes.find((r) => r.id === id);
const CASES = [
  ['not an object', () => 'x', /must be a JSON object/],
  ['schemaVersion missing', (d) => { delete d.schemaVersion; }, /"schemaVersion" must be a whole number/],
  ['extends malformed', (d) => { d.extends = 'mine'; }, /"extends" must look like/],
  ['steps not a list', (d) => { d.steps = {}; }, /"steps" must be a list/],
  ['phase without id', (d) => { d.phases.push({ name: 'X' }); }, /a phase needs an "id"/],
  ['phase without name', (d) => { delete d.phases[1].name; }, /a phase needs a "name"/],
  ['phase id twice', (d) => { d.phases.push({ ...d.phases[1] }); }, /two phases share this id/],
  ['phase level unknown', (d) => { d.phases[1].level = 'team'; }, /"level" must be one of/],
  ['feature phase without part', (d) => { delete d.phases[1].part; }, /a feature phase needs a "part"/],
  ['product phase with part', (d) => { d.phases[0].part = 'Shape'; }, /a product phase belongs to no part/],
  ['loop without over', (d) => { d.phases[4].over = []; }, /a loop phase needs "over"/],
  ['step without id', (d) => { d.steps.push({ name: 'X' }); }, /a step needs an "id"/],
  ['step without name', (d) => { delete step(d, 'epic').name; }, /a step needs a "name"/],
  ['step id shape', (d) => { step(d, 'tasks').id = 'Tasks'; route(d, 'lane').steps[1] = 'Tasks'; }, /lower-case letters, digits and dashes/],
  ['step id like a story', (d) => { step(d, 'tasks').id = 'tasks-s01'; route(d, 'lane').steps[1] = 'tasks-s01'; }, /must not end like a story id/],
  ['step id is a sentinel', (d) => { step(d, 'tasks').id = 'ready-for-build'; route(d, 'lane').steps[1] = 'ready-for-build'; }, /a word the engine uses for an epic's state/],
  ['step id twice', (d) => { d.steps.push({ ...step(d, 'tasks') }); }, /two steps share this id/],
  ['step without kind', (d) => { delete step(d, 'analysis').kind; }, /a step needs a "kind"/],
  ['step phase missing', (d) => { step(d, 'analysis').phase = 'nowhere'; }, /its phase "nowhere" does not exist/],
  ['author id ends in -review', (d) => { step(d, 'tasks').id = 'tasks-review'; route(d, 'lane').steps[1] = 'tasks-review'; }, /must not end in "-review"/],
  ['review step with a gate', (d) => { step(d, 'engineer-review').gate = { riskTags: [] }; }, /a review step is a gate on its own/],
  ['gate malformed', (d) => { step(d, 'analysis').gate = { riskTags: 'contract' }; }, /"gate" must be null or/],
  ['artifact malformed', (d) => { step(d, 'analysis').artifact = { type: 'file' }; }, /"artifact" must be null or/],
  ['set without files', (d) => { delete step(d, 'foundation').artifact.files; }, /a "set" artifact lists its "files"/],
  ['artifact shared', (d) => { step(d, 'analysis').artifact.path = 'ui-design.md'; }, /two steps cannot share one/],
  ['behaviour in the wrong part', (d) => { step(d, 'analysis').behaviours = ['spec-source']; }, /belongs in the Build loop/],
  ['behaviour step loses its gate', (d) => { step(d, 'architecture').gate = null; }, /needs the step to keep its review gate/],
  ['merge gate made an author step', (d) => { step(d, 'engineer-review').kind = 'author'; step(d, 'engineer-review').id = 'merge'; route(d, 'lane').steps[4] = 'merge'; }, /must stay a "review" step/],
  ['fixed artifact renamed', (d) => { step(d, 'epic').artifact.path = 'brief.md'; }, /its artifact must stay "epic.md"/],
  ['derived gate id taken', (d) => { d.steps.push({ ...step(d, 'engineer-review'), id: 'analysis-review', behaviours: [], provider: undefined }); }, /would be called "analysis-review", which is already a step/],
  ['route without id', (d) => { d.routes.push({ name: 'x', steps: ['epic'] }); }, /a route needs an "id"/],
  ['route without name', (d) => { delete route(d, 'chore').name; }, /a route needs a "name"/],
  ['route id twice', (d) => { d.routes.push({ ...route(d, 'chore') }); }, /two routes share this id/],
  ['route empty', (d) => { route(d, 'chore').steps = []; }, /a route needs at least one step/],
  ['route step missing', (d) => { route(d, 'chore').steps.push('ghost'); }, /step "ghost" does not exist/],
  ['route step twice', (d) => { route(d, 'chore').steps.push('epic'); }, /step "epic" is listed twice/],
  ['route mixes levels', (d) => { route(d, 'chore').steps.push('spec'); }, /mix the product level, the Shape phases, the Build loop and the Run phases/],
  ['feature route without ends-shape', (d) => { route(d, 'chore').steps = ['epic']; }, /exactly 1 step with behaviour "ends-shape"; it has 0/],
  ['product route with two product-level steps', (d) => { route(d, 'foundation').steps.push('discovery'); }, /exactly 1 step with behaviour "product-level"; it has 2/],
  ['feature route with two contract steps', (d) => {
    d.steps.push({ ...step(d, 'architecture'), id: 'api', name: 'API', artifact: { type: 'file', path: 'api.md' }, provider: { origin: 'api' } });
    route(d, 'classic').steps.push('api');
  }, /at most 1 step with behaviour "locks-contract"; it has 2/],
  ['no lane', (d) => { d.routes = d.routes.filter((r) => r.id !== 'lane'); }, /exactly one Build lane route/],
  // Review round 1: a behaviour keeps its file name wherever it goes, and yadflow's steps keep theirs.
  ['work-item-source moved to a new step', (d) => {
    step(d, 'epic').behaviours = [];
    d.steps.push({ id: 'intake', name: 'Intake', phase: 'discover', kind: 'author', artifact: { type: 'file', path: 'intake.md' },
      gate: { riskTags: [] }, behaviours: ['work-item-source'] });
    for (const r of d.routes) if (r.steps.includes('epic')) r.steps.unshift('intake');
  }, /behaviour "work-item-source" needs the artifact "epic.md"/],
  ['ends-shape moved to a new step', (d) => {
    step(d, 'stories').behaviours = [];
    d.steps.push({ id: 'backlog', name: 'Backlog', phase: 'plan', kind: 'author', artifact: { type: 'folder', path: 'backlog/' },
      gate: { riskTags: [] }, behaviours: ['ends-shape'] });
    for (const r of d.routes) if (r.steps.includes('stories')) r.steps.push('backlog');
  }, /behaviour "ends-shape" needs the artifact "stories\/"/],
  ['origin changed to escape the fixed name', (d) => { step(d, 'architecture').provider.origin = 'arch2'; step(d, 'architecture').artifact.path = 'arch.md'; }, /"architecture" is a step yadflow ships/],
  // Review round 2: deleting or rewriting the provider record does not free a yadflow step's file name.
  ['provider deleted to escape the fixed name', (d) => {
    const a = step(d, 'architecture'); delete a.provider; a.artifact.path = 'arch.md'; a.behaviours = [];
  }, /"architecture" is a step yadflow ships/],
  ['provider rewritten to escape the fixed name', (d) => {
    const a = step(d, 'architecture'); a.provider = { id: 'acme', origin: 'architecture' }; a.artifact.path = 'arch.md'; a.behaviours = [];
  }, /"architecture" is a step yadflow ships/],
  ['epic swaps its file with a new step', (d) => {
    const e = step(d, 'epic'); delete e.provider; e.artifact.path = 'brief.md'; e.behaviours = [];
    d.steps.push({ id: 'intake', name: 'Intake', phase: 'discover', kind: 'author', artifact: { type: 'file', path: 'epic.md' }, gate: { riskTags: [] }, behaviours: ['work-item-source'] });
    for (const r of d.routes) if (r.steps.includes('epic')) r.steps.unshift('intake');
  }, /"epic" is a step yadflow ships/],
  // Review round 2: two files a review branch would find by one name.
  ['artifact under a folder shares a base', (d) => { step(d, 'analysis').artifact.path = 'notes/epic.md'; }, /"epic.md" is found by the same name as step analysis's "notes\/epic.md"/],
  ['artifact differs only by letter case', (d) => { step(d, 'analysis').artifact.path = 'Epic.md'; }, /letter case ignored/],
  ['artifact shaped like a story', (d) => { step(d, 'analysis').artifact.path = 'stories-S01.md'; }, /named like a story/],
  ['artifact takes the contract', (d) => { step(d, 'analysis').artifact.path = 'contract.md'; }, /step architecture: .*"contract.md" is found by the same name as step analysis's/],
  ['artifact takes an extra path', (d) => { step(d, 'analysis').artifact.path = 'DESIGN.md'; }, /step ui-design: .*"DESIGN.md" is found by the same name as step analysis's/],
  // Review round 2: more wrong types.
  ['set files not names', (d) => { step(d, 'foundation').artifact.files = [1, 2]; }, /lists its "files" by name/],
  ['set optional not among its files', (d) => { step(d, 'foundation').artifact.optional = ['ghost.md']; }, /"optional" lists some of its "files"/],
  ['provider version not a number', (d) => { step(d, 'tasks').provider.version = 'x'; }, /"provider" must be/],
  ['route provider not an object', (d) => { route(d, 'chore').provider = 'yadflow'; }, /"provider" must be/],
  ['description not text', (d) => { step(d, 'epic').description = 5; }, /"description" must be text/],
  ['kind not a word', (d) => { step(d, 'analysis').kind = 5; }, /a step needs a "kind"/],
  ['runs not a word', (d) => { d.phases[1].runs = 5; }, /"runs" must be a word/],
  ['artifact type not a word', (d) => { step(d, 'analysis').artifact.type = 5; }, /"artifact" must be null or/],
  ['Build phase that runs once', (d) => { d.phases[4].runs = 'once'; }, /a Build phase runs in a loop/],
  // Review round 3: a yadflow name stays reserved even when its step is deleted, and the engine's extra files go with it.
  ['architecture deleted, its file taken', (d) => {
    d.steps = d.steps.filter((x) => x.id !== 'architecture');
    for (const r of d.routes) r.steps = r.steps.filter((x) => x !== 'architecture');
    d.steps.push({ id: 'arch2', name: 'Arch', phase: 'design', kind: 'author', artifact: { type: 'file', path: 'architecture.md' }, gate: { riskTags: [] } });
  }, /"architecture.md" is a file of yadflow's "architecture" step/],
  ['discovery deleted, its key taken', (d) => {
    d.steps = d.steps.filter((x) => x.id !== 'discovery');
    d.routes = d.routes.filter((x) => x.id !== 'discovery');
    d.steps.push({ id: 'notes', name: 'Notes', phase: 'discover', kind: 'author', artifact: { type: 'file', path: 'notes/discovery.md' }, gate: { riskTags: [] } });
    route(d, 'classic').steps.push('notes');
  }, /a file of yadflow's "discovery" step/],
  ['architecture drops its contract files', (d) => { step(d, 'architecture').extraPaths = []; }, /must keep "contract.md"/],
  ['epic made a folder', (d) => { step(d, 'epic').artifact.type = 'folder'; }, /must stay "epic.md" \(a file\)/],
  ['a file inside the stories folder', (d) => {
    d.steps.push({ id: 'extra', name: 'Extra', phase: 'plan', kind: 'author', artifact: { type: 'file', path: 'stories/extra.md' }, gate: { riskTags: [] } });
  }, /"stories\/extra.md" is inside step stories's folder/],
  ['a team folder holding another step\'s file', (d) => {
    step(d, 'analysis').artifact.path = 'research/analysis.md';
    d.steps.push({ id: 'research', name: 'Research', phase: 'discover', kind: 'author', artifact: { type: 'folder', path: 'research/' }, gate: { riskTags: [] } });
  }, /"research\/analysis.md" is inside step research's folder/],
  ['a gate on a Build-loop step', (d) => { step(d, 'spec').gate = { riskTags: [] }; }, /a Build-loop step has no "gate"/],
  ['an optional Build-loop step', (d) => { step(d, 'checks').optional = true; }, /a Build-loop step is never optional/],
  ['an optional merge gate on the lane', (d) => { route(d, 'lane').steps[4] = { id: 'engineer-review', optional: true }; }, /its steps carry no "optional"/],
  ['Build phase without runs', (d) => { delete d.phases[4].runs; delete d.phases[4].over; }, /phase build: a Build phase runs in a loop/],
  ['a path that leaves the epic folder', (d) => { step(d, 'analysis').artifact.path = '../EP-other/x.md'; }, /must be a path inside the epic folder/],
  ['an absolute extra path', (d) => { step(d, 'analysis').extraPaths = ['/etc/passwd']; }, /must be a path inside the epic folder/],
  ['a ledger file as an extra path', (d) => { step(d, 'analysis').extraPaths = ['.sdlc/state.json']; }, /is in .sdlc\/, which holds the ledger/],
  ['phase id shape', (d) => { d.phases[1].id = 'My Phase'; }, /a phase id is lower-case letters/],
  ['route id shape', (d) => { route(d, 'chore').id = 'Chore Route'; }, /a route id is lower-case letters/],
  ['gate skills not a list', (d) => { step(d, 'epic').gate.skills = 'x'; }, /"gate" must be null or/],
  ['artifact in unknown', (d) => { step(d, 'analysis').artifact.in = 'cloud'; }, /"in" is "product" or "repo"/],
  ['artifact unit not a word', (d) => { step(d, 'stories').artifact.unit = 3; }, /"unit" is one word/],
  ['a review step with an artifact', (d) => {
    d.steps.push({ id: 'signoff', name: 'Signoff', phase: 'plan', kind: 'review', artifact: { type: 'file', path: 'signoff.md' }, gate: null });
  }, /a review step .* writes no artifact of its own/],
  // Review round 4: a set's member files are claimed too, and ".sdlc" with no slash is still the ledger.
  ['a team set takes yadflow files', (d) => {
    d.steps.push({ id: 'bundle', name: 'Bundle', phase: 'discover', kind: 'author', artifact: { type: 'set', path: 'bundle/', files: ['epic.md', 'contract.md'] }, gate: { riskTags: [] } });
    route(d, 'classic').steps.push('bundle');
  }, /"contract.md" is a file of yadflow's "architecture" step/],
  ['a team set escapes the folder', (d) => {
    d.steps.push({ id: 'bundle', name: 'Bundle', phase: 'discover', kind: 'author', artifact: { type: 'set', path: 'bundle/', files: ['../x.md'] }, gate: { riskTags: [] } });
  }, /"\.\.\/x.md" in a set's "files" is a file name/],
  ['a team set lists a ledger file', (d) => {
    d.steps.push({ id: 'bundle', name: 'Bundle', phase: 'discover', kind: 'author', artifact: { type: 'set', path: 'bundle/', files: ['.sdlc'] }, gate: { riskTags: [] } });
  }, /"\.sdlc" is in \.sdlc\/, which holds the ledger/],
  ['an empty set', (d) => {
    d.steps.push({ id: 'bundle', name: 'Bundle', phase: 'discover', kind: 'author', artifact: { type: 'set', path: 'bundle/', files: [] }, gate: { riskTags: [] } });
  }, /lists at least one file/],
  ['a product step takes a Foundation section', (d) => {
    d.steps.push({ id: 'charter', name: 'Charter', phase: 'foundation', kind: 'author', artifact: { type: 'file', path: 'purpose.md' }, gate: { riskTags: [] } });
    route(d, 'foundation').steps.push('charter');
  }, /step charter: "purpose.md" is the same file as step foundation's "purpose.md"/],
  ['the ledger folder with no slash', (d) => { step(d, 'analysis').extraPaths = ['.sdlc']; }, /"\.sdlc" is in \.sdlc\/, which holds the ledger/],
  // Review round 5: an empty name is not skipped, and one step does not name one file twice.
  ['an empty extra path', (d) => { step(d, 'analysis').extraPaths = ['']; }, /"" must be a path inside the epic folder: not empty/],
  ['an empty set member', (d) => { step(d, 'foundation').artifact.files.push(''); }, /"" must be a path inside the epic folder: not empty/],
  ['a set lists one file twice', (d) => {
    d.steps.push({ id: 'bundle', name: 'Bundle', phase: 'discover', kind: 'author', artifact: { type: 'set', path: 'bundle/', files: ['a.md', 'A.md'] }, gate: { riskTags: [] } });
  }, /"A.md" is listed twice among this step's files/],
  ['an extra path repeats the artifact', (d) => { step(d, 'analysis').extraPaths = ['Analysis.md']; }, /"Analysis.md" is listed twice among this step's files/],
  ['an extra path named like a story', (d) => { step(d, 'analysis').extraPaths = ['notes-S01.md']; }, /"notes-S01.md" is named like a story/],
  ['two sets write one file', (d) => {
    d.steps.push({ id: 'b1', name: 'B1', phase: 'discover', kind: 'author', artifact: { type: 'set', path: 'b1/', files: ['x.md'] }, gate: { riskTags: [] } });
    d.steps.push({ id: 'b2', name: 'B2', phase: 'discover', kind: 'author', artifact: { type: 'set', path: 'b2/', files: ['X.md'] }, gate: { riskTags: [] } });
  }, /step b2: "X.md" is the same file as step b1's "x.md".*two steps cannot write one file/],
  // Review round 6.
  ['a file artifact ending in a slash', (d) => { step(d, 'analysis').artifact.path = 'analysis.md/'; }, /is a file, so it does not end in "\/"/],
  ['an empty skill name', (d) => { step(d, 'epic').skills = ['']; }, /"skills" must be a list of names, none of them empty/],
  ['an empty behaviour name', (d) => { step(d, 'epic').behaviours = ['work-item-source', '']; }, /"behaviours" must be a list of names, none of them empty/],
  // Review round 7: the ledger exception is the exact shipped path, not any path sharing its key.
  ['a ledger path sharing a shipped key', (d) => { step(d, 'architecture').extraPaths.push('.sdlc/approvals/architecture.md'); }, /is in \.sdlc\/, which holds the ledger/],
  ['the ledger in capitals sharing a shipped key', (d) => { step(d, 'architecture').extraPaths.push('.SDLC/contract.md'); }, /is in \.sdlc\/, which holds the ledger/],
  ['a folder in extraPaths', (d) => { step(d, 'analysis').extraPaths = ['notes/']; }, /"notes\/" in "extraPaths" is a folder/],
  ['retired step on a live route', (d) => { route(d, 'foundation').steps.push('discovery'); route(d, 'foundation').steps = ['discovery']; }, /step "discovery" is retired, so only a retired route may list it/],
  ['origin used twice', (d) => { step(d, 'tasks').provider.origin = 'spec'; }, /already has the origin "spec"/],
  ['a yadflow step loses its behaviour and its file name', (d) => { step(d, 'test-cases').behaviours = []; step(d, 'test-cases').artifact.path = 'qa.md'; }, /its artifact must stay "test-cases.md"/],
  // Review round 1: a wrong type is reported, never read as empty.
  ['skills not a list', (d) => { step(d, 'epic').skills = 'yad-epic'; }, /"skills" must be a list of names/],
  ['behaviours not a list', (d) => { step(d, 'checks').behaviours = 'ci-gates'; }, /"behaviours" must be a list of names/],
  ['optional not a boolean', (d) => { step(d, 'ui-design').optional = 'yes'; }, /"optional" must be true or false/],
  ['provider not an object', (d) => { step(d, 'tasks').provider = 'x'; }, /"provider" must be/],
  ['replaces not a string', (d) => { step(d, 'foundation').replaces = ['discovery']; }, /"replaces" must be a step id/],
  ['extends not a string', (d) => { d.extends = ['yadflow-default@1']; }, /"extends" must look like/],
  ['plugins not a list', (d) => { d.plugins = {}; }, /"plugins" must be a list/],
  ['over not a list', (d) => { d.phases[4].over = 'story'; }, /"over" must be a list of words/],
  ['built not a boolean', (d) => { d.phases[5].built = 'no'; }, /"built" must be true or false/],
  ['route steps not a list', (d) => { route(d, 'chore').steps = 'epic'; }, /"steps" must be a list/],
  ['route entry optional not a boolean', (d) => { route(d, 'classic').steps[2] = { id: 'ui-design', optional: 'no' }; }, /each step is a step id/],
  ['route entry a number', (d) => { route(d, 'chore').steps.push(7); }, /each step is a step id/],
  ['route bindings not an object', (d) => { route(d, 'chore').bindings = []; }, /"bindings" must be an object/],
  ['route retired not a boolean', (d) => { route(d, 'chore').retired = 1; }, /"retired" must be true or false/],
];
for (const [name, breakIt, want] of CASES) {
  test(`validator: ${name}`, () => {
    const d = fresh();
    const r = breakIt(d);
    const found = messages(r === undefined ? d : r).map((p) => `${p.where}: ${p.message}`);
    assert.ok(found.some((line) => want.test(line)), `wanted ${want}, got ${JSON.stringify(found)}`);
  });
}

test('a value this release does not know makes the step unusable, and the rest of the file still loads', () => {
  const d = fresh();
  step(d, 'analysis').kind = 'checkpoint';
  step(d, 'ui-design').artifact.type = 'canvas';
  step(d, 'test-cases').behaviours.push('future-thing');
  d.phases.find((p) => p.id === 'operate').runs = 'forever';
  d.steps.push({ id: 'watch', name: 'Watch', phase: 'operate', kind: 'author', artifact: null, gate: null });
  d.futureKey = 1;
  step(d, 'epic').futureField = 1;
  const all = lifecycleProblems(d);
  assert.deepEqual(all.filter((p) => p.level === 'error'), [], 'no error: an unknown value never breaks the file');
  const unusable = all.filter((p) => p.level === 'unusable').map((p) => p.where);
  for (const w of ['step analysis', 'step ui-design', 'step test-cases', 'phase operate', 'step watch']) assert.ok(unusable.includes(w), w);
  const warns = all.filter((p) => p.level === 'warn').map((p) => `${p.where}: ${p.message}`);
  assert.ok(warns.includes('file: unknown key "futureKey" is kept and not read'));
  assert.ok(warns.includes('step epic: unknown key "futureField" is kept and not read'));
});

test('round 2: a newer yadflow step, an unknown Build "runs", a deleted retired step: unusable or warned, never a broken file', () => {
  const d = fresh();
  d.steps.push({ id: 'deploy', name: 'Deploy', phase: 'release', kind: 'author', artifact: null, gate: null, provider: { id: 'yadflow', version: 2, origin: 'deploy' } });
  d.routes.push({ id: 'ship', name: 'ship', steps: ['deploy'] });
  assert.deepEqual(messages(d), []);
  assert.ok(lifecycleProblems(d).some((p) => p.level === 'unusable' && p.where === 'step deploy'));

  const b = fresh();
  b.phases.find((p) => p.id === 'build').runs = 'pipeline';
  assert.deepEqual(messages(b), [], 'the lane is still the lane');
  assert.equal(lifecycleProblems(b).filter((p) => p.level === 'unusable').length, 6, 'the phase and its five steps');

  const v = fresh();
  Object.assign(step(v, 'test-cases'), { artifact: { type: 'file', path: 'qa/test-cases.md' }, provider: { id: 'yadflow', version: 2, origin: 'test-cases' } });
  assert.deepEqual(messages(v), [], 'a newer yadflow moved its own file: unusable here, not an error');
  assert.ok(lifecycleProblems(v).some((p) => p.level === 'unusable' && p.where === 'step test-cases'));

  // A newer default moved DESIGN.md from ui-design to architecture: both steps are unusable here, not errors.
  const mv = fresh();
  for (const id of ['ui-design', 'architecture']) step(mv, id).provider.version = 2;
  step(mv, 'ui-design').extraPaths = ['.sdlc/design-links.json'];
  step(mv, 'architecture').extraPaths.push('DESIGN.md');
  assert.deepEqual(messages(mv), [], 'a file moved between two newer yadflow steps');
  // A newer default split out a step this release does not know, holding the contract: unusable, not an error.
  const sp = fresh();
  step(sp, 'architecture').provider.version = 2;
  step(sp, 'architecture').extraPaths = [];
  step(sp, 'architecture').behaviours = [];
  sp.steps.push({ id: 'contract', name: 'Contract', phase: 'design', kind: 'author', artifact: { type: 'file', path: 'contract.md' }, extraPaths: ['.sdlc/contract-lock.json'],
    gate: { riskTags: ['contract'] }, behaviours: ['locks-contract'], provider: { id: 'yadflow', version: 2, origin: 'contract' } });
  route(sp, 'classic').steps.splice(2, 0, 'contract');
  assert.deepEqual(messages(sp), [], 'an unknown-origin yadflow step taking reserved files');
  assert.ok(lifecycleProblems(sp).some((p) => p.level === 'unusable' && p.where === 'step contract'));

  const r = fresh();
  r.steps = r.steps.filter((s) => s.id !== 'discovery');
  r.routes = r.routes.filter((x) => x.id !== 'discovery');
  assert.deepEqual(messages(r), [], 'a team may delete a retired step');
  assert.ok(lifecycleProblems(r).some((p) => p.level === 'warn' && /replaces "discovery"/.test(p.message)));

  const i = fresh();
  i.steps = i.steps.filter((s) => s.id !== 'analysis');
  i.routes = i.routes.filter((x) => !x.steps.includes('analysis'));
  assert.deepEqual(messages(i), []);
  assert.ok(lifecycleProblems(i).some((p) => p.level === 'warn' && /input "analysis"/.test(p.message)));

  const m = fresh();
  step(m, 'analysis').phase = 'nowhere';
  const errs = messages(m).map((p) => p.message);
  assert.ok(!errs.some((x) => /mix/.test(x)), 'a missing phase is not called a mix');
});

test('the edits the roadmap allows stay allowed: rename, re-skill, make optional, move', () => {
  const d = fresh();
  Object.assign(step(d, 'epic'), { id: 'brief', name: 'Brief', skills: ['my-brief'] });
  for (const r of d.routes) r.steps = r.steps.map((x) => (x === 'epic' ? 'brief' : x));
  step(d, 'architecture').optional = true;
  step(d, 'architecture').phase = 'plan';
  step(d, 'test-cases').gate = null;
  assert.deepEqual(messages(d), []);
});

test('round 4: set member files are compared within their level, and the two product sets never with each other', () => {
  // Both product sets list roadmap.md, each in its own folder: not a clash.
  assert.deepEqual(messages(fresh()), []);
  // A feature step's roadmap.md is a different file from the Foundation's.
  const d = fresh();
  d.steps.push({ id: 'roadmap', name: 'Roadmap', phase: 'plan', kind: 'author', artifact: { type: 'file', path: 'roadmap.md' }, gate: { riskTags: [] } });
  route(d, 'classic').steps.push('roadmap');
  assert.deepEqual(messages(d), []);
  // A product folder and a feature file live in different epic folders on disk.
  const g = fresh();
  g.steps.push({ id: 'guides', name: 'Guides', phase: 'foundation', kind: 'author', artifact: { type: 'folder', path: 'guides/' }, gate: { riskTags: [] } });
  g.steps.push({ id: 'howto', name: 'How-to', phase: 'plan', kind: 'author', artifact: { type: 'file', path: 'guides/x.md' }, gate: { riskTags: [] } });
  assert.ok(!messages(g).some((p) => /inside step guides's folder/.test(p.message)));
  // "$schema" binds the editor schema and is a known key.
  const e = fresh();
  e.$schema = './lifecycle.schema.json';
  assert.deepEqual(lifecycleProblems(e), []);
});

test('artifactKey finds a file the way a review branch does', () => {
  assert.equal(artifactKey('epic.md'), 'epic');
  assert.equal(artifactKey('stories/'), 'stories');
  assert.equal(artifactKey('notes/Epic.MD'), 'epic');
  assert.equal(artifactKey('stories/EP-x-S01.md'), 'stories-s01');
  assert.equal(artifactKey('.sdlc/contract-lock.json'), 'contract-lock.json');
});

test('a name every JavaScript object inherits is not a known behaviour or origin', () => {
  const d = fresh();
  step(d, 'analysis').behaviours = ['constructor', '__proto__', 'toString'];
  const all = lifecycleProblems(d);
  assert.deepEqual(all.filter((p) => p.level === 'error'), []);
  assert.equal(all.filter((p) => p.level === 'unusable').length, 3);
  const e = fresh();
  e.steps.push({ id: 'constructor', name: 'C', phase: 'discover', kind: 'author', artifact: null, gate: null, provider: { id: 'yadflow', origin: 'constructor' } });
  assert.ok(lifecycleProblems(e).some((p) => p.level === 'unusable' && /"constructor"/.test(p.message)));
  assert.ok(!messages(e).some((p) => /native code/.test(p.message)));
});

test('a Run phase that loops is not the Build lane, and its route is neither a lane nor a feature route', () => {
  const d = fresh();
  d.steps.push({ id: 'release-notes', name: 'Release notes', phase: 'release', kind: 'author', artifact: { type: 'file', path: 'release-notes.md' }, gate: { riskTags: [] } });
  d.routes.unshift({ id: 'release', name: 'the release loop', steps: ['release-notes'] });
  assert.deepEqual(messages(d), []);
  const n = normalizeLifecycle(d);
  assert.equal(routeKind(n, n.routes[0]), 'run');
  assert.deepEqual(laneOrder(n), FROZEN.BUILD_STEP_ORDER, 'the Build order still comes from the Build lane');
});

test('yadflow\'s claimed files are exactly what the engine commits for each step (stepPaths)', () => {
  // The claims rule reads the shipped defaults; this ties those defaults to the engine, per artifact type,
  // so a later default cannot list files the engine does not commit, or leave out one it does.
  const rel = (p) => p.replace(/^epics\/EP-x\//, '');
  let checked = 0;
  for (const st of DEFAULT_LIFECYCLE.steps.filter((x) => x.artifact)) {
    const engine = stepPaths('EP-x', st.id).map(rel);
    const a = st.artifact;
    if (a.type === 'file') assert.deepEqual([...engine].sort(), [a.path, ...st.extraPaths].sort(), st.id);
    else if (a.type === 'folder') {
      assert.equal(artifactKey(engine[0]), artifactKey(a.path), st.id);
      assert.deepEqual(engine.slice(1), st.extraPaths, st.id);
    } else assert.deepEqual(engine, [...a.files, ...st.extraPaths], st.id);
    // The key a review branch uses is the engine's own `artifactBase`, without letter case.
    for (const f of [a.path, ...st.extraPaths]) {
      if (!f.startsWith('.sdlc/')) assert.equal(artifactKey(f), ES.artifactBase(f).toLowerCase(), f);
    }
    checked += 1;
  }
  assert.equal(checked, 8, 'every Shape and Foundation step was compared, sets and folders included');
  // Every yadflow step with a file reserves it.
  const { byOrigin, byKey } = yadflowClaims();
  for (const st of DEFAULT_LIFECYCLE.steps) assert.deepEqual(byOrigin.get(st.provider.origin).extras, st.extraPaths);
  assert.equal(byKey.get('contract'), 'architecture');
});

test('the registry keeps yadflow\'s file names, by the original id, after a rename', () => {
  // A renamed step keeps its origin, so the rule still finds it.
  const d = fresh();
  Object.assign(step(d, 'epic'), { id: 'brief', name: 'Brief' });
  for (const r of d.routes) r.steps = r.steps.map((x) => (x === 'epic' ? 'brief' : x));
  assert.deepEqual(messages(d), [], 'a rename alone is allowed');
  step(d, 'brief').artifact.path = 'brief.md';
  assert.ok(messages(d).some((p) => /must stay "epic.md"/.test(p.message)));
});

test('round 3: the edits the roadmap allows still pass under the claims and lane rules', () => {
  const d = fresh();
  step(d, 'architecture').skills = ['pool-architect', 'yad-architecture'];
  step(d, 'epic').optional = true;
  step(d, 'test-cases').phase = 'design';
  step(d, 'test-cases').gate = null;
  d.steps.push({ id: 'lint', name: 'Lint', phase: 'build', kind: 'author', artifact: null, gate: null });
  route(d, 'lane').steps.splice(3, 0, 'lint');
  d.steps.push({ id: 'threat-model', name: 'Threat model', phase: 'design', kind: 'author', artifact: { type: 'file', path: 'threat-model.md' }, gate: { riskTags: ['auth'] }, provider: { id: 'acme', version: 1, origin: 'threat-model' } });
  d.steps.push({ id: 'research', name: 'Research', phase: 'discover', kind: 'author', artifact: { type: 'folder', path: 'research/' }, gate: { riskTags: [] } });
  route(d, 'classic').steps.push('threat-model', 'research');
  assert.deepEqual(messages(d), []);
  assert.deepEqual(lifecycleProblems(d).filter((p) => p.level === 'warn'), []);
});

// ---- the editor schema ---------------------------------------------------------------------------------

test('the editor schema agrees with the code on every list of allowed values and every known key', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'cli', 'lifecycle', 'lifecycle.schema.json'), 'utf8'));
  const $ = schema.$defs;
  const artifactObj = $.artifact.oneOf.find((x) => x.type === 'object');
  assert.deepEqual($.step.properties.kind.enum, STEP_KINDS);
  assert.deepEqual(artifactObj.properties.type.enum, ARTIFACT_TYPES);
  assert.deepEqual($.phase.properties.runs.enum, PHASE_RUNS);
  assert.deepEqual($.phase.properties.level.enum, PHASE_LEVELS);
  assert.deepEqual($.phase.properties.part.enum, PARTS);
  assert.deepEqual($.step.properties.behaviours.items.enum, Object.keys(BEHAVIOURS));
  assert.deepEqual($.step.properties.driver.enum, DRIVERS);
  assert.deepEqual(DRIVERS, [...new Set(Object.values(DRIVER_FROM_ASSISTANCE))], 'the words of the shape-4 driver dial');
  assert.equal($.gate.oneOf.find((x) => x.type === 'object').properties.advance.const, 'human');
  assert.deepEqual(Object.keys(schema.properties), KNOWN_KEYS.file);
  assert.deepEqual(Object.keys($.phase.properties), KNOWN_KEYS.phase);
  assert.deepEqual(Object.keys($.step.properties), KNOWN_KEYS.step);
  assert.deepEqual(Object.keys($.route.properties), KNOWN_KEYS.route);
  assert.deepEqual(Object.keys($.gate.oneOf.find((x) => x.type === 'object').properties), KNOWN_KEYS.gate);
  assert.deepEqual(Object.keys(artifactObj.properties), KNOWN_KEYS.artifact);
  assert.deepEqual(Object.keys($.provider.properties), KNOWN_KEYS.provider);
  assert.deepEqual(Object.keys($.route.properties.steps.items.oneOf.find((x) => x.type === 'object').properties), KNOWN_KEYS.routeStep);
  // Every key the schema requires is one whose absence the validator reports as an error.
  for (const [where, required] of [['file', schema.required], ['phase', $.phase.required], ['step', $.step.required], ['route', $.route.required]]) {
    for (const key of required) {
      const d = fresh();
      if (where === 'file') delete d[key];
      else delete { phase: d.phases, step: d.steps, route: d.routes }[where][1][key];
      assert.ok(messages(d).length > 0, `removing ${where}.${key} is reported`);
    }
  }
  // The default uses only keys the schema names.
  const d = loadDefault(DEFAULT_VERSION);
  assert.deepEqual(messages(d, 'warn'), []);
});

// ---- the copy in config.yaml ---------------------------------------------------------------------------

test('skills/sdlc/config.yaml carries exactly what the default generates', () => {
  const file = path.join(ROOT, 'skills', 'sdlc', 'config.yaml');
  const text = fs.readFileSync(file, 'utf8');
  const r = applyConfigRegions(text);
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.stale, [], 'stale — run node scripts/lifecycle-config.mjs');
  assert.equal(r.text, text);
  // A hand edit inside a region is found, and rewriting puts it back.
  const edited = text.replace('back_steps: [spec, tasks, implement, checks]', 'back_steps: [spec]');
  const fixed = applyConfigRegions(edited);
  assert.deepEqual(fixed.stale, ['back_steps']);
  assert.equal(fixed.text, text);
  // A missing end marker is refused, and the text comes back unchanged.
  const broken = text.replace('# <<< generated: lifecycle', '');
  const refused = applyConfigRegions(broken);
  assert.equal(refused.refused.length, 1);
  assert.equal(refused.text, broken);
  // A CRLF checkout (Windows) is compared by content and written back with CRLF.
  const crlf = text.replace(/\n/g, '\r\n');
  const c = applyConfigRegions(crlf);
  assert.deepEqual(c.stale, []);
  assert.equal(c.text, crlf);
  assert.equal(applyConfigRegions(edited.replace(/\n/g, '\r\n')).text, crlf);
  // The script's --check agrees.
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lifecycle-config.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(Object.keys(configRegions(DEFAULT_LIFECYCLE)), ['lifecycle', 'back_steps']);
  assert.ok(SENTINELS.every((s) => text.includes(s)));
});
