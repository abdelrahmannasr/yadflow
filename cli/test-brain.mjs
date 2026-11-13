// E176: the project brain — Graphify's code graph and the work items, merged into one local graph file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';

const {
  readGraphify, surfacesOf, tasksOf, composeBrain, buildRepoGraph, ensureBrainDir, excludeGraphifyOut,
  writeBrain, readBrain, brainFreshness, queryBrain, graphifyEnv, safeName, BRAIN_FILE, GRAPHIFY_ENV, GRAPHIFY_VERSION,
} = await import('./brain.mjs');
const { TOOLBOX } = await import('./toolbox.mjs');
const { RECIPES } = await import('./toolbox-connect.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAD = path.join(HERE, '..', 'bin', 'yad.mjs');
const GOLDEN = path.join(HERE, 'fixtures', 'golden-v3');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-brain-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const done = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
// A test that commits sets its own identity and never signs: CI has no identity, and a signing setup
// on the machine must not reach a throwaway repo.
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
// PATH holds only the folder node is in, so no Graphify on the machine is found.
const yad = (cwd, ...a) => spawnSync(process.execPath, [YAD, ...a], {
  cwd, encoding: 'utf8',
  env: { ...process.env, PATH: path.dirname(process.execPath), NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' },
});

// A Graphify graph as 0.9.108 writes it (read from a real run): edges under `links`.
const graphifyGraph = ({ key = 'links', schema = 1 } = {}) => ({
  directed: false, multigraph: false, graph: { schema_version: schema, graphify_version: '0.9.108' },
  nodes: [
    { id: 'src_routes', label: 'routes.js', source_file: 'src/routes.js', source_location: 'L1', file_type: 'code' },
    { id: 'src_routes_postorders', label: 'postOrders()', source_file: 'src/routes.js', source_location: 'L9', file_type: 'code' },
    { id: 'src_order_index', label: 'index.js', source_file: 'src/order/index.js', source_location: 'L1', file_type: 'code' },
    { id: 'src_order_create', label: 'create()', source_file: 'src/order/index.js', source_location: 'L4', file_type: 'code' },
    { id: 'src_order_order', label: 'Order', source_file: 'src/order/index.js', source_location: 'L2', file_type: 'code' },
  ],
  [key]: [
    { source: 'src_routes_postorders', target: 'src_order_create', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1 },
    { source: 'src_routes', target: 'src_routes_postorders', relation: 'contains', confidence: 'EXTRACTED' },
    { source: 'src_routes', target: 'ghost', relation: 'imports', confidence: 'EXTRACTED' },
  ],
});

// The golden Product, with its backend repo cloned beside it (a git repo holding one story's tasks).
function product() {
  const ws = tmp();
  const root = path.join(ws, 'product');
  fs.cpSync(GOLDEN, root, { recursive: true });
  const be = path.join(root, 'demo-repos', 'backend');
  put(path.join(be, 'src', 'routes.js'), '// routes\n');
  put(path.join(be, 'specs', 'EP-checkout-S01', 'tasks.md'), [
    '# Tasks — EP-checkout-S01 (backend)', '',
    '## T01 — Add `POST /orders` route + create path',
    '- **Files:** `src/order/index.js`, `src/order/store.js`, `src/routes.js`', '',
    '## T02 — Validate input',
    '- **Files:** `src/order/validate.js`, `../outside.js`, `/etc/passwd`, `package.json`', '',
  ].join('\n'));
  put(path.join(be, 'package.json'), '{}\n');
  git(be, 'init', '-q');
  git(be, 'add', '-A');
  git(be, 'commit', '-qm', 'init');
  return { ws, root, be };
}

// A runner that plays Graphify: `graphify update` writes the graph into graphify-out/.
function fakeGraphify(graph = graphifyGraph()) {
  const calls = [];
  const runner = (cmd, args = [], opts = {}) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'graphify' && args[0] === 'update') {
      put(path.join(opts.cwd, 'graphify-out', 'graph.json'), JSON.stringify(graph));
      return { ok: true, code: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'graphify' && args[0] === '--version') return { ok: true, code: 0, stdout: `graphify ${GRAPHIFY_VERSION}`, stderr: '' };
    const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
    return { ok: r.status === 0, code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
  };
  return { runner, calls };
}

test('readGraphify reads edges under links or edges, and refuses an unknown schema or shape', () => {
  assert.equal(readGraphify(JSON.stringify(graphifyGraph())).edges.length, 3);
  assert.equal(readGraphify(JSON.stringify(graphifyGraph({ key: 'edges' }))).edges.length, 3);
  assert.equal(readGraphify(JSON.stringify(graphifyGraph())).graphifyVersion, '0.9.108');
  assert.throws(() => readGraphify(JSON.stringify(graphifyGraph({ schema: 2 }))), (e) => e.code === 'YAD-STATE-011' && /schema_version 2/.test(e.message) && /graphifyy==0\.9\.108/.test(e.hint));
  assert.throws(() => readGraphify('{'), /does not parse/);
  assert.throws(() => readGraphify('[]'), /not an object/);
  assert.throws(() => readGraphify(JSON.stringify({ graph: { schema_version: 1 }, nodes: [] })), /no list of nodes or of links/);
});

test('surfacesOf reads the backtick names after "Contract surface touched", never "none"', () => {
  assert.deepEqual(surfacesOf('- Contract surface touched: `POST /orders`, `Order`, `OrderStatus`.'), ['POST /orders', 'Order', 'OrderStatus']);
  assert.deepEqual(surfacesOf('- Contract surface touched: **none** — `none`'), []);
  assert.deepEqual(surfacesOf('no such line'), []);
});

test('tasksOf reads each task and its declared files, dropping paths that leave the repo', () => {
  const t = tasksOf('## T01 — Goal one\r\n- **Files:** `src/a.js`, `./src/b.js`, `src/a.js`\r\n## T02: two\n**Files:** `../x.js`, `/abs.js`, `c\\d.js`\n## Notes\n');
  assert.deepEqual(t, [{ id: 'T01', goal: 'Goal one', files: ['src/a.js', 'src/b.js'] }, { id: 'T02', goal: 'two', files: ['c/d.js'] }]);
});

test('ensureBrainDir makes a folder that ignores itself, and refuses a link on the way', () => {
  const root = tmp();
  try {
    ensureBrainDir(root);
    assert.equal(fs.readFileSync(path.join(root, '.sdlc', 'brain', '.gitignore'), 'utf8'), '*\n');
    git(root, 'init', '-q');
    put(path.join(root, '.sdlc', 'brain', 'graph.json'), '{}');
    assert.equal(git(root, 'status', '--porcelain', '--untracked-files=all').stdout.includes('brain'), false, 'nothing under .sdlc/brain/ shows to git');
    const other = tmp();
    const linked = tmp();
    fs.mkdirSync(path.join(linked, '.sdlc'));
    fs.symlinkSync(other, path.join(linked, '.sdlc', 'brain'));
    assert.throws(() => ensureBrainDir(linked), (e) => e.code === 'YAD-STATE-011' && /not a plain folder/.test(e.message));
    assert.deepEqual(fs.readdirSync(other), [], 'nothing written through the link');
    done(other, linked);
  } finally { done(root); }
});

test('buildRepoGraph runs the vetted command with the LLM pass and the query log off, and keeps graphify-out/ out of git', () => {
  const { ws, root, be } = product();
  try {
    const { runner, calls } = fakeGraphify();
    const r = buildRepoGraph(root, { name: 'backend', target: be }, { runner, env: { PATH: '/x', GRAPHIFY_BACKEND: 'gemini' } });
    assert.deepEqual(r, { ok: true, nodes: 5, edges: 3 });
    const run = calls.find((x) => x.cmd === 'graphify');
    assert.deepEqual(run.args, ['update', '.', '--force']);
    assert.equal(run.opts.cwd, be);
    assert.equal(run.opts.env.GRAPHIFY_BACKEND, 'none', 'ours wins over a backend set in the shell');
    assert.equal(run.opts.env.GRAPHIFY_QUERY_LOG_DISABLE, '1');
    assert.deepEqual(GRAPHIFY_ENV, { GRAPHIFY_BACKEND: 'none', GRAPHIFY_QUERY_LOG_DISABLE: '1' });
    assert.match(fs.readFileSync(path.join(be, '.git', 'info', 'exclude'), 'utf8'), /^graphify-out\/$/m);
    assert.equal(git(be, 'status', '--porcelain').stdout, '', 'graphify-out/ is not seen by git');
    const meta = JSON.parse(fs.readFileSync(path.join(root, '.sdlc', 'brain', 'repos', 'backend', 'meta.json'), 'utf8'));
    assert.equal(meta.head, git(be, 'rev-parse', 'HEAD').stdout.trim());
    assert.equal(meta.schemaVersion, 1);
    // A second run adds the exclude line once.
    excludeGraphifyOut(be, { runner });
    assert.equal(fs.readFileSync(path.join(be, '.git', 'info', 'exclude'), 'utf8').match(/^graphify-out\/$/gm).length, 1);
  } finally { done(ws); }
});

test('buildRepoGraph reports a failed or unreadable Graphify run, and writes nothing', () => {
  const { ws, root, be } = product();
  try {
    const failing = (cmd, args, opts) => (cmd === 'graphify' ? { ok: false, code: 1, stdout: '', stderr: 'boom\nlast line' } : fakeGraphify().runner(cmd, args, opts));
    assert.deepEqual(buildRepoGraph(root, { name: 'backend', target: be }, { runner: failing }), { ok: false, why: 'graphify failed — last line' });
    const { runner } = fakeGraphify(graphifyGraph({ schema: 9 }));
    assert.match(buildRepoGraph(root, { name: 'backend', target: be }, { runner }).why, /schema_version 9/);
    assert.equal(fs.existsSync(path.join(root, '.sdlc', 'brain', 'repos', 'backend', 'graph.json')), false);
  } finally { done(ws); }
});

test('composeBrain joins the work items to the code: tasks declare files, surfaces reach handlers and names', () => {
  const { ws, root, be } = product();
  try {
    buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner });
    const { brain } = composeBrain(root);
    const has = (s, t, rel) => brain.edges.find((e) => e.source === s && e.target === t && e.relation === rel);
    const node = (id) => brain.nodes.find((n) => n.id === id);
    assert.ok(has('epic:EP-checkout', 'story:EP-checkout-S01', 'has-story'));
    assert.ok(has('story:EP-checkout-S01', 'repo:backend', 'builds-in'));
    assert.ok(has('epic:EP-checkout-queue-filter', 'epic:EP-checkout', 'changes'), 'lineage from the index');
    assert.ok(has('story:EP-checkout-S01', 'task:EP-checkout-S01:backend:T01', 'has-task'));
    assert.equal(has('task:EP-checkout-S01:backend:T01', 'file:backend:src/routes.js', 'declares-file').confidence, 'EXTRACTED');
    assert.ok(has('file:backend:src/routes.js', 'code:backend:src_routes_postorders', 'defines'));
    assert.equal(node('file:backend:src/routes.js').missing, undefined, 'a file the code graph knows');
    assert.equal(node('file:backend:src/order/store.js').missing, true, 'declared, and not in the code graph');
    assert.equal(node('file:backend:../outside.js'), undefined);
    assert.ok(has('story:EP-checkout-S01', 'surface:POST /orders', 'touches-surface'));
    assert.equal(has('surface:POST /orders', 'code:backend:src_routes_postorders', 'handled-by').confidence, 'INFERRED', 'from the code-map line');
    assert.equal(has('surface:Order', 'code:backend:src_order_order', 'named-as').confidence, 'INFERRED');
    assert.equal(has('code:backend:src_routes_postorders', 'code:backend:src_order_create', 'calls').score, 1);
    assert.equal(brain.edges.some((e) => e.target === 'code:backend:ghost'), false, 'an edge to a node Graphify never listed is dropped');
    assert.equal(brain.repos.backend.droppedEdges, 1);
    assert.ok(has('task:EP-checkout-S01:backend:T01', 'ship:backend:06edb9e', 'shipped-as'), 'the build log');
    assert.equal(brain.repos.mobile.code, false);
    assert.match(brain.repos.mobile.why, /not cloned here/);
    for (const e of brain.edges) assert.ok(['EXTRACTED', 'INFERRED', 'AMBIGUOUS'].includes(e.confidence), `${e.source} ${e.relation}`);
  } finally { done(ws); }
});

test('the brain is current until one input changes; Windows line endings hash the same', () => {
  const { ws, root, be } = product();
  try {
    const { runner } = fakeGraphify();
    buildRepoGraph(root, { name: 'backend', target: be }, { runner });
    writeBrain(root, composeBrain(root).brain);
    assert.equal(brainFreshness(root).state, 'current');
    const story = path.join(root, 'epics', 'EP-checkout', 'stories', 'EP-checkout-S02.md');
    const before = fs.readFileSync(story, 'utf8');
    fs.writeFileSync(story, before.replace(/\n/g, '\r\n'));
    assert.equal(brainFreshness(root).state, 'current', 'CRLF is read as LF');
    fs.writeFileSync(story, `${before}\nmore\n`);
    assert.equal(brainFreshness(root).state, 'behind');
    fs.writeFileSync(story, before);
    fs.appendFileSync(path.join(be, 'specs', 'EP-checkout-S01', 'tasks.md'), '\n## T03 — more\n');
    assert.equal(brainFreshness(root).state, 'behind', 'a code repo\'s tasks.md is an input');
    writeBrain(root, composeBrain(root).brain);
    put(path.join(be, 'src', 'new.js'), '//\n');
    git(be, 'add', '-A');
    git(be, 'commit', '-qm', 'more');
    const f = brainFreshness(root);
    assert.equal(f.state, 'current', 'the merged file still matches the stored graphs');
    assert.equal(f.repos.find((r) => r.name === 'backend').state, 'behind', 'but the code graph is behind the repo');
  } finally { done(ws); }
});

test('readBrain refuses a file it does not know; queryBrain ranks exact names first', () => {
  const { ws, root, be } = product();
  try {
    assert.equal(readBrain(root), null);
    put(path.join(root, BRAIN_FILE), JSON.stringify({ format: 'other', nodes: [], edges: [] }));
    assert.throws(() => readBrain(root), (e) => e.code === 'YAD-STATE-011' && /format "other"/.test(e.message));
    buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner });
    const brain = composeBrain(root).brain;
    const m = queryBrain(brain, 'order', { limit: 50 });
    assert.equal(m[0].node.label.toLowerCase(), 'order');
    assert.ok(m.every((x) => x.neighbours.length <= 12));
    assert.deepEqual(queryBrain(brain, '   '), []);
    const s = queryBrain(brain, 'EP-checkout-S01', { limit: 1 })[0];
    assert.ok(s.neighbours.some((x) => x.relation === 'has-story' && x.direction === 'in'));
  } finally { done(ws); }
});

test('yad brain: build without Graphify writes the work items, query and status read it back, --json answers', () => {
  const { ws, root } = product();
  try {
    let r = yad(root, 'brain', 'status');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no brain here yet/);
    r = yad(root, 'brain', 'query', 'Order');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no brain here yet/);
    r = yad(root, 'brain', 'build');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Graphify is not installed here/);
    assert.match(r.stdout, /wrote \.sdlc\/brain\/graph\.json/);
    const j = JSON.parse(yad(root, 'brain', 'status', '--json').stdout);
    assert.equal(j.state, 'current');
    assert.equal(j.graphify, null);
    assert.equal(j.vetted, GRAPHIFY_VERSION);
    const q = JSON.parse(yad(root, 'brain', 'query', 'POST /orders', '--limit', '2', '--json').stdout);
    assert.equal(q.matches[0].node.id, 'surface:POST /orders');
    assert.equal(q.matches.length, 2);
    assert.equal(yad(root, 'brain', 'query', 'x', '--limit', '0').status, 1);
    assert.equal(yad(root, 'brain', 'frobnicate').status, 1);
    assert.equal(yad(root, 'brain', 'status', 'extra').status, 1);
    assert.equal(yad(root, 'brain', 'build', '--repo', 'nope').status, 1);
  } finally { done(ws); }
});

test('yad brain refuses a folder that is not a Product', () => {
  const dir = tmp();
  try {
    const r = yad(dir, 'brain', 'status', '--dir', dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no Product here/);
  } finally { done(dir); }
});

test('the Graphify toolbox entry pins the version the brain runs', () => {
  const t = TOOLBOX.find((x) => x.id === 'graphify');
  assert.equal(t.tier, 'recommended');
  assert.equal(t.vetted.packages[0].version, GRAPHIFY_VERSION);
  assert.ok(t.install.every((i) => / graphifyy$/.test(i.command)), 'the install text names the package; the agent\'s recipe holds the pin');
  assert.deepEqual(RECIPES.graphify.map((s) => s.run), [`uv tool install graphifyy==${GRAPHIFY_VERSION}`]);
  assert.deepEqual(t.usedBy, ['yad brain build']);
});

// ---- review round 1 ---------------------------------------------------------------------------------

const storyFile = (root, id) => path.join(root, 'epics', id.replace(/-S\d+$/, ''), 'stories', `${id}.md`);

test('review 1: a repo named like a built-in key never reaches Object.prototype', () => {
  const { ws, root, be } = product();
  try {
    buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner });
    const f = storyFile(root, 'EP-checkout-S01');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('repos: [backend]', 'repos: [backend, constructor, __proto__, toString]'));
    const reg = JSON.parse(fs.readFileSync(path.join(root, '.sdlc', 'repos.json'), 'utf8'));
    reg.repos.push({ ...reg.repos[0], name: '__proto__' }, { ...reg.repos[0], name: 'Backend' });
    put(path.join(root, '.sdlc', 'repos.json'), JSON.stringify(reg));
    const { brain } = composeBrain(root);
    assert.ok(brain.edges.some((e) => e.source === 'story:EP-checkout-S01' && e.target === 'repo:constructor'));
    assert.equal(Object.getPrototypeOf(brain.repos), Object.prototype, 'no prototype was set');
    assert.equal(brain.repos.Backend.why, 'another repo has the same name in another case');
    assert.equal(safeName('__proto__'), false);
    assert.equal(safeName('constructor'), false);
  } finally { done(ws); }
});

test('review 1: ships come from the Product ledger, so they are drawn when no repo is cloned', () => {
  const { ws, root } = product();
  try {
    fs.rmSync(path.join(root, 'demo-repos'), { recursive: true, force: true });
    const { brain } = composeBrain(root);
    const ships = brain.nodes.filter((n) => n.kind === 'ship');
    assert.ok(ships.length >= 5, `ships: ${ships.length}`);
    assert.ok(brain.edges.some((e) => e.source === 'story:EP-checkout-S01' && e.relation === 'shipped-as'), 'to the story when the task is unknown here');
  } finally { done(ws); }
});

test('review 1: a parent epic keeps its own title, whatever order the epics are read in', () => {
  const { ws, root } = product();
  try {
    // The child (EP-checkout-queue-filter) is read after its parent and names it as a placeholder.
    const epic = path.join(root, 'epics', 'EP-checkout', 'epic.md');
    fs.writeFileSync(epic, fs.readFileSync(epic, 'utf8').replace(/^---\n/, '---\ntitle: Checkout for real\n'));
    const { brain } = composeBrain(root);
    assert.equal(brain.nodes.find((n) => n.id === 'epic:EP-checkout').label, 'Checkout for real');
  } finally { done(ws); }
});

test('review 1: ships with no merge commit stay apart; one merge commit for many tasks is one ship', () => {
  const { ws, root } = product();
  try {
    const log = path.join(root, 'epics', 'EP-checkout', '.sdlc', 'build-log.json');
    const b = JSON.parse(fs.readFileSync(log, 'utf8'));
    b.ships.push(
      { story: 'EP-checkout-S01', task: 'retro', repo: 'backend', retroactive: true, shippedAt: '2026-01-01' },
      { story: 'EP-checkout-S03', task: 'retro', repo: 'backend', retroactive: true, shippedAt: '2026-02-01' },
      { story: 'EP-checkout-S04', task: 'T01', repo: 'mobile', mergeCommit: 'abc1234', pr: 7 },
      { story: 'EP-checkout-S04', task: 'T02', repo: 'mobile', mergeCommit: 'abc1234', pr: 7 },
    );
    put(log, JSON.stringify(b));
    const { brain } = composeBrain(root);
    const ids = brain.nodes.filter((n) => n.kind === 'ship').map((n) => n.id);
    assert.ok(ids.includes('ship:backend:EP-checkout-S01:retro:') && ids.includes('ship:backend:EP-checkout-S03:retro:'));
    const grouped = brain.nodes.find((n) => n.id === 'ship:mobile:abc1234');
    assert.deepEqual(grouped.tasks, ['EP-checkout-S04/T01', 'EP-checkout-S04/T02']);
    assert.equal(grouped.label, '2 tasks #7');
  } finally { done(ws); }
});

test('review 1: a declared file git holds is not missing, even when it is not code; a planned one is', () => {
  const { ws, root, be } = product();
  try {
    buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner });
    const { brain } = composeBrain(root);
    const node = (id) => brain.nodes.find((n) => n.id === id);
    assert.equal(node('file:backend:package.json').missing, undefined);
    assert.equal(node('file:backend:src/order/store.js').missing, true);
    assert.equal(brain.edges.some((e) => e.target === 'file:backend:src/order/store.js' && e.relation === 'holds'), false, 'a repo does not hold a missing file');
  } finally { done(ws); }
});

test('review 1: Graphify gets no LLM settings from the shell, matched in any case', () => {
  const env = graphifyEnv({ PATH: '/bin', HOME: '/h', OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', gemini_api_key: 'k', OLLAMA_HOST: 'h', AWS_PROFILE: 'p', OPENAI_BASE_URL: 'u', graphify_backend: 'gemini', GRAPHIFY_VIZ_NODE_LIMIT: '1' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', GRAPHIFY_BACKEND: 'none', GRAPHIFY_QUERY_LOG_DISABLE: '1' });
});

test('review 1: a link or a committed graphify-out/ is refused; a link under .sdlc/brain/repos is never written through', () => {
  const { ws, root, be } = product();
  try {
    const away = tmp();
    fs.symlinkSync(away, path.join(be, 'graphify-out'));
    assert.match(buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner }).why, /not a plain folder/);
    fs.rmSync(path.join(be, 'graphify-out'));
    put(path.join(be, 'graphify-out', 'keep.txt'), 'x');
    git(be, 'add', '-f', 'graphify-out/keep.txt');
    git(be, 'commit', '-qm', 'tracked');
    assert.match(buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner }).why, /committed in this repo/);
    git(be, 'rm', '-rq', 'graphify-out');
    git(be, 'commit', '-qm', 'untracked');
    ensureBrainDir(root);
    fs.symlinkSync(away, path.join(root, '.sdlc', 'brain', 'repos'));
    assert.throws(() => buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner }), /not a plain folder/);
    assert.deepEqual(fs.readdirSync(away), [], 'nothing written through the link');
    done(away);
  } finally { done(ws); }
});

test('review 1: status of an unreadable brain exits 1; a flag brain does not take is refused, never searched for', () => {
  const { ws, root } = product();
  try {
    put(path.join(root, BRAIN_FILE), '{');
    let r = yad(root, 'brain', 'status');
    assert.equal(r.status, 1);
    r = yad(root, 'brain', 'status', '--json');
    assert.equal(r.status, 1);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false);
    assert.equal(j.state, 'unreadable');
    r = yad(root, 'brain', 'query', 'Order', '--repoo', 'x');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /does not take --repoo/);
    fs.rmSync(path.join(root, BRAIN_FILE));
    assert.equal(yad(root, 'brain', 'build').status, 0);
    const s = JSON.parse(yad(root, 'brain', 'status', '--json').stdout);
    assert.ok(s.repos.every((x) => !('builtAt' in x)));
  } finally { done(ws); }
});

test('review 1: a busy node shows edges in as well as out', () => {
  const nodes = [{ id: 'a', kind: 'k', label: 'center' }, ...Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, kind: 'k', label: `n${i}` }))];
  const edges = [...Array.from({ length: 20 }, (_, i) => ({ source: 'a', target: `n${i}`, relation: 'out', confidence: 'EXTRACTED' })),
    ...Array.from({ length: 10 }, (_, i) => ({ source: `n${20 + i}`, target: 'a', relation: 'in', confidence: 'EXTRACTED' }))];
  const [m] = queryBrain({ nodes, edges }, 'center');
  assert.equal(m.neighbours.length, 12);
  assert.ok(m.neighbours.some((x) => x.direction === 'in') && m.neighbours.some((x) => x.direction === 'out'));
  assert.equal(m.more, 18);
});
