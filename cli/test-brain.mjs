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
  readGraphify, surfacesOf, tasksOf, composeBrain, buildRepoGraph, ensureBrainDir, excludeGraphifyOut, BRAIN_GRAPH_MAX_BYTES,
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

// The same, with git on PATH too, for a command that asks git: a folder holding only a link to git, so a
// Graphify installed beside git (Homebrew's one folder) is never found.
const GIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-brain-git-'));
process.on('exit', () => fs.rmSync(GIT_DIR, { recursive: true, force: true }));
fs.symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), path.join(GIT_DIR, 'git'));
const yadGit = (cwd, ...a) => spawnSync(process.execPath, [YAD, ...a], {
  cwd, encoding: 'utf8',
  env: { ...process.env, PATH: [path.dirname(process.execPath), GIT_DIR].join(path.delimiter), NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' },
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

// #215: the code graph is generated and grows with the code, so it is read up to its own, larger limit; a graph
// past that is named as too big, never as one Graphify did not write.
test('#215: a code graph over 64 MiB is still read, and one over 256 MiB is named as too big', () => {
  const { ws, root, be } = product();
  try {
    const sized = (size) => {
      const { runner } = fakeGraphify();
      return (cmd, args = [], opts = {}) => {
        const r = runner(cmd, args, opts);
        // Sparse: no room on disk. The trailing zero bytes make it not parse, which shows it was read.
        if (cmd === 'graphify' && args[0] === 'update') fs.truncateSync(path.join(opts.cwd, 'graphify-out', 'graph.json'), size);
        return r;
      };
    };
    assert.equal(BRAIN_GRAPH_MAX_BYTES, 256 * 1024 * 1024);
    const read = buildRepoGraph(root, { name: 'backend', target: be }, { runner: sized(70 * 1024 * 1024) });
    assert.equal(read.ok, false);
    assert.match(read.why, /does not parse/, 'read past the 64 MiB limit of other files');
    const big = buildRepoGraph(root, { name: 'backend', target: be }, { runner: sized(BRAIN_GRAPH_MAX_BYTES + 1) });
    assert.equal(big.why, 'graphify-out/graph.json could not be read: it is larger than 256 MiB, the most yad reads, so yad did not read it');
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

// ---- review round 2 ---------------------------------------------------------------------------------

test('review 2: a committed link in place of graph.json, files.txt or meta.json is replaced, never written through', () => {
  const { ws, root, be } = product();
  try {
    const victim = path.join(tmp(), 'victim');
    fs.writeFileSync(victim, 'keep\n');
    const dir = path.join(root, '.sdlc', 'brain', 'repos', 'backend');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['graph.json', 'files.txt', 'meta.json']) fs.symlinkSync(victim, path.join(dir, f));
    assert.equal(buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner }).ok, true);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep\n');
    for (const f of ['graph.json', 'files.txt', 'meta.json']) assert.equal(fs.lstatSync(path.join(dir, f)).isFile(), true, f);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
    done(path.dirname(victim));
  } finally { done(ws); }
});

test('review 2: a timeout says so; build runs the file found on PATH; one that cannot start is not "installed"', async () => {
  const { ws, root, be } = product();
  try {
    const timedOut = (cmd, args, opts) => (cmd === 'graphify' ? { ok: false, code: null, stdout: '', stderr: 'progress 40%', error: { code: 'ETIMEDOUT' } } : fakeGraphify().runner(cmd, args, opts));
    assert.match(buildRepoGraph(root, { name: 'backend', target: be }, { runner: timedOut }).why, /longer than 20 minutes/);
    const { runBrain, graphifyHere } = await import('./brain.mjs');
    const calls = [];
    const runner = (cmd, args = [], opts = {}) => {
      calls.push(cmd);
      if (cmd === '/opt/x/graphify' && args[0] === '--version') return { ok: true, stdout: `graphify ${GRAPHIFY_VERSION}`, stderr: '' };
      if (cmd === '/opt/x/graphify') { put(path.join(opts.cwd, 'graphify-out', 'graph.json'), JSON.stringify(graphifyGraph())); return { ok: true, stdout: '', stderr: '' }; }
      const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
      return { ok: r.status === 0, code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
    };
    await runBrain(root, { action: 'build', json: false, runner, where: () => '/opt/x/graphify' });
    assert.ok(calls.filter((c) => c === '/opt/x/graphify').length >= 2, 'the version and the update both ran the file found');
    assert.equal(calls.includes('graphify'), false, 'never the bare name');
    assert.equal(composeBrain(root).brain.repos.backend.code, true);
    const cannot = graphifyHere({ where: () => 'C:\\x\\graphify.cmd', runner: () => ({ ok: false, error: { code: 'EINVAL' }, stdout: '', stderr: '' }) });
    assert.deepEqual(cannot, { bin: 'C:\\x\\graphify.cmd', version: null, startError: 'EINVAL' });
    const hung = graphifyHere({ where: () => '/x/graphify', runner: () => ({ ok: false, error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '' }) });
    assert.deepEqual(hung, { bin: '/x/graphify', version: null, startError: 'ETIMEDOUT', hung: true });
  } finally { done(ws); process.exitCode = 0; }
});

test('review 2: a grouped ship keeps the first PR found, whatever the row order', () => {
  const { ws, root } = product();
  try {
    const log = path.join(root, 'epics', 'EP-checkout', '.sdlc', 'build-log.json');
    const b = JSON.parse(fs.readFileSync(log, 'utf8'));
    b.ships.push({ story: 'EP-checkout-S04', task: 'T01', repo: 'mobile', mergeCommit: 'def5678', pr: 9 }, { story: 'EP-checkout-S04', task: 'T02', repo: 'mobile', mergeCommit: 'def5678' });
    put(log, JSON.stringify(b));
    assert.equal(composeBrain(root).brain.nodes.find((n) => n.id === 'ship:mobile:def5678').label, '2 tasks #9');
  } finally { done(ws); }
});

// ---- review round 3 ---------------------------------------------------------------------------------

test('review 3: the merged file is written by a rename too, so a link left at its name is replaced', () => {
  const { ws, root } = product();
  try {
    const victim = path.join(tmp(), 'victim');
    fs.writeFileSync(victim, 'keep\n');
    ensureBrainDir(root);
    fs.symlinkSync(victim, path.join(root, BRAIN_FILE));
    writeBrain(root, composeBrain(root).brain);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep\n');
    assert.equal(fs.lstatSync(path.join(root, BRAIN_FILE)).isFile(), true);
    done(path.dirname(victim));
  } finally { done(ws); }
});

test('review 3: a file name that starts with a space keeps it in the list of files', () => {
  const { ws, root, be } = product();
  try {
    put(path.join(be, ' lead.js'), '//\n');
    git(be, 'add', '-A');
    git(be, 'commit', '-qm', 'lead');
    buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner });
    const files = fs.readFileSync(path.join(root, '.sdlc', 'brain', 'repos', 'backend', 'files.txt'), 'utf8').split('\n');
    assert.ok(files.includes(' lead.js'), files.slice(0, 3).join('|'));
  } finally { done(ws); }
});

test('review 3: query names the repos whose code moved; status --json says why it cannot read the brain', () => {
  const { ws, root, be } = product();
  try {
    buildRepoGraph(root, { name: 'backend', target: be }, { runner: fakeGraphify().runner });
    writeBrain(root, composeBrain(root).brain);
    let q = JSON.parse(yadGit(root, 'brain', 'query', 'Order', '--json').stdout);
    assert.deepEqual(q.codeBehind, []);
    put(path.join(be, 'src', 'later.js'), '//\n');
    git(be, 'add', '-A');
    git(be, 'commit', '-qm', 'later');
    q = JSON.parse(yadGit(root, 'brain', 'query', 'Order', '--json').stdout);
    assert.deepEqual(q.codeBehind, ['backend']);
    const b = JSON.parse(fs.readFileSync(path.join(root, BRAIN_FILE), 'utf8'));
    b.repos = ['odd'];
    put(path.join(root, BRAIN_FILE), JSON.stringify(b));
    assert.deepEqual(JSON.parse(yadGit(root, 'brain', 'query', 'Order', '--json').stdout).codeBehind, [], 'an odd repos field is ignored');
    put(path.join(root, BRAIN_FILE), '{');
    const s = JSON.parse(yad(root, 'brain', 'status', '--json').stdout);
    assert.equal(s.code, 'YAD-STATE-011');
    assert.match(s.error, /does not parse/);
    assert.match(s.hint, /yad brain build/);
  } finally { done(ws); }
});

test('review 3: a Graphify that cannot start builds the work items only, and --json names why', async () => {
  const { ws, root } = product();
  try {
    const { runBrain } = await import('./brain.mjs');
    const runner = (cmd, args = [], opts = {}) => {
      if (cmd === '/opt/x/graphify') return { ok: false, code: null, stdout: '', stderr: '', error: { code: 'EINVAL' } };
      const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
      return { ok: r.status === 0, code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
    };
    await runBrain(root, { action: 'build', runner, where: () => '/opt/x/graphify' });
    const brain = readBrain(root);
    assert.ok(brain.nodes.some((n) => n.kind === 'story'));
    assert.equal(brain.repos.backend.code, false);
    assert.equal(fs.existsSync(path.join(root, '.sdlc', 'brain', 'repos', 'backend')), false, 'no repo was built');
  } finally { done(ws); process.exitCode = 0; }
});

test('review 3: a grouped ship keeps the first PR found in either row order', () => {
  const { ws, root } = product();
  try {
    const log = path.join(root, 'epics', 'EP-checkout', '.sdlc', 'build-log.json');
    const b = JSON.parse(fs.readFileSync(log, 'utf8'));
    b.ships.push({ story: 'EP-checkout-S04', task: 'T02', repo: 'mobile', mergeCommit: 'fed9876' }, { story: 'EP-checkout-S04', task: 'T01', repo: 'mobile', mergeCommit: 'fed9876', pr: 11 });
    put(log, JSON.stringify(b));
    assert.equal(composeBrain(root).brain.nodes.find((n) => n.id === 'ship:mobile:fed9876').label, '2 tasks #11');
  } finally { done(ws); }
});

// ---- review round 4 ---------------------------------------------------------------------------------

test('review 4: --json build and status name a Graphify that does not start; the key is absent otherwise', () => {
  const { ws, root } = product();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-brain-bin-'));
  try {
    // A `graphify` on PATH that cannot be started: no permission to run it.
    fs.writeFileSync(path.join(bin, 'graphify'), '#!/bin/sh\necho graphify 0.9.108\n', { mode: 0o644 });
    fs.symlinkSync(path.join(GIT_DIR, 'git'), path.join(bin, 'git'));
    const env = { ...process.env, PATH: [path.dirname(process.execPath), bin].join(path.delimiter), NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' };
    const run = (...a) => JSON.parse(spawnSync(process.execPath, [YAD, ...a], { cwd: root, encoding: 'utf8', env }).stdout);
    // whereOnPath skips a file it may not run, so nothing is found: graphify null, no error key.
    let b = run('brain', 'build', '--json');
    assert.equal(b.graphify, null);
    assert.equal('graphifyError' in b, false);
    assert.equal('graphifyError' in run('brain', 'status', '--json'), false);
    // Runnable but failing to start the interpreter it names: the spawn errors.
    fs.writeFileSync(path.join(bin, 'graphify'), '#!/no/such/interpreter\n');
    fs.chmodSync(path.join(bin, 'graphify'), 0o755); // a write to a file that exists keeps its old mode
    b = run('brain', 'build', '--json');
    assert.equal(b.graphify, null);
    assert.equal(typeof b.graphifyError, 'string');
    assert.ok(b.warnings.some((w) => /cannot be started/.test(w)));
    assert.equal(typeof run('brain', 'status', '--json').graphifyError, 'string');
  } finally { done(ws, bin); }
});

// ---- E179: focused questions, and the skills that ask them ---------------------------------------------

const { fileAbout, storyAbout, fileCandidates } = await import('./brain-about.mjs');
const { BRAIN_SKILLS, BRAIN_FIRST_LINE, brainBlockLines, syncBrainSkills, BRAIN_BLOCK_BEGIN, BRAIN_BLOCK_END } = await import('./brain-skills.mjs');
const SKILLS = path.join(HERE, '..', 'skills');

// The golden Product with its backend mapped by the fake Graphify, composed and written: a brain with both layers.
function builtProduct() {
  const p = product();
  buildRepoGraph(p.root, { name: 'backend', target: p.be }, { runner: fakeGraphify().runner });
  const { brain } = composeBrain(p.root);
  writeBrain(p.root, brain);
  return { ...p, brain };
}

test('E179 fileAbout: who declares a file, what it defines, the files that use it and that it uses', () => {
  const { ws, brain } = builtProduct();
  try {
    const r = fileAbout(brain, 'backend/src/order/index.js');
    assert.equal(r.found, 'one');
    const a = r.about;
    assert.deepEqual(a.file, { id: 'file:backend:src/order/index.js', repo: 'backend', path: 'src/order/index.js' });
    const t01 = a.declaredBy.find((d) => d.task.short === 'T01');
    assert.equal(t01.story.id, 'story:EP-checkout-S01');
    assert.equal(t01.epic.id, 'epic:EP-checkout');
    assert.deepEqual(a.defines.map((d) => d.label), ['index.js', 'Order', 'create()'], 'in file order');
    assert.deepEqual(a.usedBy.map((u) => [u.file, u.relations, u.confidence]), [['backend/src/routes.js', ['calls'], 'EXTRACTED']]);
    assert.ok(a.surfaces.some((s) => s.label === 'Order' && s.via.includes('named-as')));
    assert.ok(a.shippedIn.length >= 1, 'T01 shipped');
    // The other direction, and an edge inside one file (routes.js contains postOrders) is not a use.
    const routes = fileAbout(brain, 'src/routes.js').about;
    assert.deepEqual(routes.uses.map((u) => u.file), ['backend/src/order/index.js']);
    assert.deepEqual(routes.usedBy, []);
    // A declared file the code does not hold yet.
    const store = fileAbout(brain, 'backend/src/order/store.js').about;
    assert.equal(store.file.missing, true);
    assert.deepEqual(store.defines, []);
    // --limit cuts each list and says how many were left out.
    const cut = fileAbout(brain, 'backend/src/order/index.js', { limit: 1 }).about;
    assert.equal(cut.defines.length, 1);
    assert.equal(cut.more.defines, 2);
    // Not in the brain: suggestions by the file's own name.
    const none = fileAbout(brain, 'backend/src/nope/index.js');
    assert.equal(none.found, 'none');
    assert.equal(none.suggestions[0], 'backend/src/order/index.js', 'the same name in another folder');
  } finally { done(ws); }
});

test('E179 fileCandidates: <repo>/<path> or a bare path; a path in two repos is ambiguous', () => {
  const file = (repo, p) => ({ id: `file:${repo}:${p}`, kind: 'file', label: p, repo });
  const brain = { nodes: [file('backend', 'src/a.js'), file('mobile', 'src/a.js'), file('src', 'x.js'), file('web', 'src/x.js')], edges: [] };
  assert.deepEqual(fileCandidates(brain, 'backend/src/a.js').map((n) => n.id), ['file:backend:src/a.js']);
  assert.equal(fileAbout(brain, 'src/a.js').found, 'many');
  assert.deepEqual(fileAbout(brain, 'src/a.js').candidates, ['backend/src/a.js', 'mobile/src/a.js']);
  // A repo named like a folder: both readings are taken, so neither file hides the other.
  assert.deepEqual(fileCandidates(brain, 'src/x.js').map((n) => n.id), ['file:src:x.js', 'file:web:src/x.js']);
  assert.deepEqual(fileCandidates(brain, './backend/src/a.js').map((n) => n.id), ['file:backend:src/a.js']);
});

test('E179 storyAbout: tasks with their files and ships; every declared file once; an unknown story suggests', () => {
  const { ws, brain } = builtProduct();
  try {
    const a = storyAbout(brain, 'EP-checkout-S01').about;
    assert.equal(a.epic.id, 'epic:EP-checkout');
    assert.ok(a.repos.includes('backend'));
    assert.deepEqual(a.tasks.map((t) => t.short), ['T01', 'T02']);
    assert.deepEqual(a.tasks[0].files.map((f) => f.path), ['src/order/index.js', 'src/order/store.js', 'src/routes.js']);
    assert.equal(a.tasks[0].files.find((f) => f.path === 'src/order/store.js').missing, true);
    assert.ok(a.tasks[0].shipped.length >= 1);
    assert.equal(new Set(a.files.map((f) => f.file)).size, a.files.length, 'each file once');
    assert.ok(a.surfaces.includes('POST /orders'));
    const none = storyAbout(brain, 'S01');
    assert.equal(none.found, 'none');
    assert.ok(none.suggestions.includes('EP-checkout-S01'));
  } finally { done(ws); }
});

test('E179 yad brain file / story: --json answers, plain text, and every refusal', () => {
  const { ws, root } = product();
  try {
    let r = yadGit(root, 'brain', 'file', 'backend/src/routes.js');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no brain here yet/);
    buildRepoGraph(root, { name: 'backend', target: path.join(root, 'demo-repos', 'backend') }, { runner: fakeGraphify().runner });
    writeBrain(root, composeBrain(root).brain);
    r = yadGit(root, 'brain', 'file', 'backend/src/order/index.js', '--json');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.command, 'brain file');
    assert.deepEqual(j.codeBehind, []);
    for (const k of ['file', 'declaredBy', 'defines', 'usedBy', 'uses', 'shippedIn', 'surfaces', 'more']) assert.ok(k in j, k);
    r = yadGit(root, 'brain', 'file', 'src/order/index.js', '--repo', 'backend');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Used by\n {2}backend\/src\/routes\.js {2}calls/);
    r = yadGit(root, 'brain', 'story', 'EP-checkout-S01', '--json');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).command, 'brain story');
    assert.match(yadGit(root, 'brain', 'story', 'EP-checkout-S01').stdout, /T01 — Add `POST \/orders` route/);
    // Refusals: no name, two names, a name the brain does not hold, flags that are not theirs.
    for (const args of [['file'], ['file', 'a', 'b'], ['story'], ['story', 'EP-checkout-S01', '--repo', 'backend'],
      ['file', 'backend/nope.js'], ['story', 'EP-nope-S01'], ['file', 'backend/src/routes.js', '--open'], ['story', 'EP-checkout-S01', '--limit', '0']]) {
      const x = yadGit(root, 'brain', ...args);
      assert.equal(x.status, 1, args.join(' '));
    }
    assert.match(yadGit(root, 'brain', 'file', 'backend/src/order/indx.js').stdout, /did you mean: backend\/src\/order\/index\.js/, 'a typo: the folder');
    assert.match(yadGit(root, 'brain', 'file', 'backend/lib/routes.js').stdout, /did you mean: backend\/src\/routes\.js/, 'the wrong folder: the name');
  } finally { done(ws); }
});

test('E179 the four skills hold the brain block exactly, and no other skill holds it', () => {
  assert.deepEqual(Object.keys(BRAIN_SKILLS).sort(), ['yad-architecture', 'yad-implement', 'yad-spec', 'yad-stories']);
  for (const skill of Object.keys(BRAIN_SKILLS)) {
    const text = fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8');
    const lines = text.split(/\r?\n/);
    const b = lines.indexOf(BRAIN_BLOCK_BEGIN);
    const e = lines.indexOf(BRAIN_BLOCK_END);
    assert.ok(b >= 0 && e > b, `${skill} has the markers`);
    assert.deepEqual(lines.slice(b + 1, e), brainBlockLines(skill), `${skill}: run node scripts/brain-skills.mjs`);
    const block = lines.slice(b + 1, e).join('\n');
    assert.match(block, /`yad brain status --json`/);
    assert.match(block, /`missing` or `unreadable`.*the brain is \*\*none\*\*/);
    assert.match(block, /never stop for it/);
    // Review 1: a repo whose code moved is "behind"; the build is suggested, never run in the step; the
    // record step is done for "none" too; a refusal means go on; the rules above still stand.
    assert.match(block, /any repo `behind` or `unknown`/);
    assert.match(block, /Do not run it inside this step/);
    assert.match(block, /Skip step 2, .*, and still do step 3/);
    assert.match(block, /A refusal .* go on without it/);
    assert.match(block, /never lifts a rule above/);
    // EP-brain-first-S04: each block holds the paragraph, right after its opening one.
    assert.ok(lines.slice(b + 1, e).includes(BRAIN_FIRST_LINE), `${skill}: the Brain first paragraph`);
  }
  // EP-brain-first-S04: the block says the brain is asked first, and when the other tools are used.
  assert.match(BRAIN_FIRST_LINE, /^\*\*Brain first\.\*\* .*ask the brain before you search the repo or read files, the pack or the code-map for the same answer.*only when the brain has no answer: it is \*\*none\*\*, the answer is empty, or the command refuses or is declined.*What a file contains is not a brain question/);
  // Review 1: it names the block's own list, not a skill's "Step 2"; a declined prompt ends the asking; the skill's steps stand.
  assert.match(BRAIN_FIRST_LINE, /For the questions under "2\. Ask it" below.*do not ask it again in this session.*The skill's own steps still stand: a code-map a step above already loaded stays loaded/);
  assert.match(brainBlockLines('yad-stories').join('\n'), /Never drop scope yourself/);
  assert.match(brainBlockLines('yad-stories').join('\n'), /never change the key after the stories review/);
  // Review 2: the question has a place to go; the stale record keeps its fields; the light spec is re-judged.
  assert.match(brainBlockLines('yad-stories').join('\n'), /ask the person before you write it.*Step 7 report/);
  for (const s of ['yad-architecture', 'yad-stories']) assert.match(brainBlockLines(s).join('\n'), /repos: \[\.\.\.\], loaded: <date>, stale: true, brain: <state>/);
  assert.match(brainBlockLines('yad-spec').join('\n'), /touches the contract surface ends the light spec: it must be redone as a full spec/);
  assert.match(brainBlockLines('yad-spec').join('\n'), /Never write the light spec's `link\.md` \(Step 6\) for it, whatever the answer/);
  assert.match(brainBlockLines('yad-spec').join('\n'), /`high` is the person's choice.*until they answer, do not write `link\.md`.*- Q: the brain added a high-risk file/);
  assert.match(brainBlockLines('yad-spec').join('\n'), /`tasks` leg, which writes nothing, only report/);
  // yad-spec's block comes after its tasks are written (Step 5), not before.
  const spec = fs.readFileSync(path.join(SKILLS, 'yad-spec', 'SKILL.md'), 'utf8');
  assert.ok(spec.indexOf(BRAIN_BLOCK_BEGIN) > spec.indexOf('### Step 5') && spec.indexOf(BRAIN_BLOCK_BEGIN) < spec.indexOf('### Step 6'));
  for (const skill of fs.readdirSync(SKILLS)) {
    if (Object.hasOwn(BRAIN_SKILLS, skill)) continue;
    const f = path.join(SKILLS, skill, 'SKILL.md');
    if (fs.existsSync(f)) assert.equal(fs.readFileSync(f, 'utf8').includes('<!-- generated: brain '), false, skill);
  }
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'scripts', 'brain-skills.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('E179 syncBrainSkills writes a stale block, refuses missing markers, and refuses the block in another skill', () => {
  const dir = tmp();
  try {
    const marked = `# x\n\n## Step 1\n${BRAIN_BLOCK_BEGIN}\nold\n${BRAIN_BLOCK_END}\n\n## Step 2\n`;
    put(path.join(dir, 'yad-spec', 'SKILL.md'), marked);
    put(path.join(dir, 'yad-implement', 'SKILL.md'), '# no markers\n');
    put(path.join(dir, 'yad-epic', 'SKILL.md'), marked);
    let r = syncBrainSkills(dir, { check: true });
    assert.deepEqual(r.stale, ['yad-spec']);
    assert.deepEqual(r.wrote, []);
    assert.deepEqual(r.refused.map((x) => x.skill).sort(), ['yad-architecture', 'yad-epic', 'yad-implement', 'yad-stories'], 'two have no SKILL.md, one no markers, one holds a block it must not');
    r = syncBrainSkills(dir);
    assert.deepEqual(r.wrote, ['yad-spec']);
    const text = fs.readFileSync(path.join(dir, 'yad-spec', 'SKILL.md'), 'utf8');
    assert.ok(text.startsWith('# x\n\n## Step 1\n') && text.endsWith(`${BRAIN_BLOCK_END}\n\n## Step 2\n`), 'only the block changed');
    assert.equal(fs.readFileSync(path.join(dir, 'yad-epic', 'SKILL.md'), 'utf8'), marked, 'a refused skill is left as it is');
    assert.deepEqual(syncBrainSkills(dir, { check: true }).stale, []);
  } finally { done(dir); }
});

test('E179 review 1: --repo settles an ambiguity and never answers from another repo; .\\ paths match', () => {
  const file = (repo, p) => ({ id: `file:${repo}:${p}`, kind: 'file', label: p, repo });
  const brain = { nodes: [file('api', 'src/a.js'), file('web', 'api/src/a.js'), file('web', 'api/x.js')], edges: [] };
  // `api/src/a.js` reads two ways; --repo picks one.
  assert.equal(fileAbout(brain, 'api/src/a.js').found, 'many');
  assert.equal(fileAbout(brain, 'src/a.js', { repo: 'api' }).about.file.id, 'file:api:src/a.js');
  assert.equal(fileAbout(brain, 'api/src/a.js', { repo: 'web' }).about.file.id, 'file:web:api/src/a.js');
  // A path only another repo holds is not this repo's file.
  assert.equal(fileAbout(brain, 'x.js', { repo: 'api' }).found, 'none');
  // A Windows-style relative path.
  assert.equal(fileAbout(brain, '.\\src\\a.js', { repo: 'api' }).about.file.id, 'file:api:src/a.js');
});

test('E179 review 1: syncBrainSkills refuses one of the four skills when its SKILL.md is gone', () => {
  const dir = tmp();
  try {
    for (const s of ['yad-architecture', 'yad-stories', 'yad-spec']) put(path.join(dir, s, 'SKILL.md'), `${BRAIN_BLOCK_BEGIN}\n${BRAIN_BLOCK_END}\n`);
    const r = syncBrainSkills(dir, { check: true });
    assert.deepEqual(r.refused.map((x) => x.skill), ['yad-implement']);
    assert.match(r.refused[0].reason, /cannot be read/);
  } finally { done(dir); }
});

test('E179 review 1: yad brain story prints the ships recorded on the story, so done work shows with no repo cloned', () => {
  const { ws, root } = product();
  try {
    // No code graph and the backend's tasks unreadable: the ledger's ships attach to the story itself.
    fs.rmSync(path.join(root, 'demo-repos', 'backend', 'specs'), { recursive: true, force: true });
    writeBrain(root, composeBrain(root).brain);
    const j = JSON.parse(yadGit(root, 'brain', 'story', 'EP-checkout-S01', '--json').stdout);
    assert.ok(j.shipped.length >= 1, 'the ledger has ships for this story');
    assert.match(yadGit(root, 'brain', 'story', 'EP-checkout-S01').stdout, /shipped: /);
  } finally { done(ws); }
});
