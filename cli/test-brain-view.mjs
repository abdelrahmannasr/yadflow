// E177: `yad brain view` — the brain drawn in a browser, from a locked-down local server or one file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
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

const { viewModel, startBrainServer, snapshotHTML, scriptSafeJSON, runBrainView, CSP, WARN_ABOVE, VIEW_FILE } = await import('./brain-view.mjs');
const { VENDORED } = await import('./brain-vendor.mjs');
const { composeBrain, buildRepoGraph, writeBrain, BRAIN_FILE, GRAPHIFY_VERSION } = await import('./brain.mjs');
const { vettingProblems } = await import('./toolbox.mjs');
const { classify, readAllowList } = await import('./agent-rules.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAD = path.join(HERE, '..', 'bin', 'yad.mjs');
const GOLDEN = path.join(HERE, 'fixtures', 'golden-v3');
const VENDOR = path.join(HERE, 'brain', 'vendor');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-brain-view-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const done = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const yad = (cwd, ...a) => spawnSync(process.execPath, [YAD, ...a], {
  cwd, encoding: 'utf8',
  env: { ...process.env, PATH: path.dirname(process.execPath), NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' },
});
// A runner that plays git for `codeBehind` (rev-parse) and nothing else: no repo's code has moved.
const quiet = () => ({ ok: false, code: 1, stdout: '', stderr: '' });

// Graphify's graph as 0.9.108 writes it: edges under `links`.
const graphifyGraph = () => ({
  directed: false, multigraph: false, graph: { schema_version: 1, graphify_version: '0.9.108' },
  nodes: [
    { id: 'src_routes', label: 'routes.js', source_file: 'src/routes.js', source_location: 'L1' },
    { id: 'src_routes_postorders', label: 'postOrders()', source_file: 'src/routes.js', source_location: 'L9' },
    { id: 'src_order_index', label: 'index.js', source_file: 'src/order/index.js', source_location: 'L1' },
    { id: 'src_order_create', label: 'create()', source_file: 'src/order/index.js', source_location: 'L4' },
    { id: 'src_order_order', label: 'Order', source_file: 'src/order/index.js', source_location: 'L2' },
    { id: 'lib_util', label: 'util.js', source_file: 'lib/util.js', source_location: 'L1' },
    { id: 'lib_util_pad', label: 'pad()', source_file: 'lib/util.js', source_location: 'L3' },
  ],
  links: [
    { source: 'src_routes_postorders', target: 'src_order_create', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'src_routes', target: 'src_routes_postorders', relation: 'contains', confidence: 'EXTRACTED' },
    { source: 'lib_util', target: 'lib_util_pad', relation: 'contains', confidence: 'EXTRACTED' },
  ],
});

// The golden Product, its backend cloned with one story's tasks, and the brain built from it.
function product() {
  const ws = tmp();
  const root = path.join(ws, 'product');
  fs.cpSync(GOLDEN, root, { recursive: true });
  const be = path.join(root, 'demo-repos', 'backend');
  put(path.join(be, 'src', 'routes.js'), '// routes\n');
  put(path.join(be, 'specs', 'EP-checkout-S01', 'tasks.md'), [
    '# Tasks — EP-checkout-S01 (backend)', '',
    '## T01 — Add `POST /orders` route + create path',
    '- **Files:** `src/order/index.js`, `src/routes.js`', '',
  ].join('\n'));
  git(be, 'init', '-q');
  git(be, 'add', '-A');
  git(be, 'commit', '-qm', 'init');
  const runner = (cmd, args = [], opts = {}) => {
    if (cmd === 'graphify' && args[0] === 'update') {
      put(path.join(opts.cwd, 'graphify-out', 'graph.json'), JSON.stringify(graphifyGraph()));
      return { ok: true, code: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'graphify') return { ok: true, code: 0, stdout: `graphify ${GRAPHIFY_VERSION}`, stderr: '' };
    const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
    return { ok: r.status === 0, code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
  };
  buildRepoGraph(root, { name: 'backend', target: be }, { runner });
  const { brain } = composeBrain(root);
  writeBrain(root, brain);
  return { ws, root, be, brain };
}

// A raw request, so the test controls the Host header and the path exactly (fetch would normalise both).
function raw(port, { method = 'GET', pathname = '/', host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the view model: two layers, a colour per kind, the work and the code it names by default, and filters', () => {
  const { ws, brain } = product();
  try {
    const m = viewModel(brain, { codeBehind: [], builtAt: '2026-11-13T00:00:00.000Z' });
    const at = (id) => m.nodes.find((n) => n.id === id);
    assert.equal(at('epic:EP-checkout').layer, 'work');
    assert.equal(at('story:EP-checkout-S01').layer, 'work');
    assert.equal(at('code:backend:src_routes_postorders').layer, 'code');
    assert.notEqual(at('epic:EP-checkout').colour, at('story:EP-checkout-S01').colour);
    assert.equal(at('file:backend:src/routes.js').inDefault, true, 'a file a task declares');
    assert.equal(at('code:backend:src_routes_postorders').inDefault, true, 'code a declared file defines');
    assert.equal(at('file:backend:lib/util.js').inDefault, false, 'a file no work names');
    assert.equal(at('code:backend:lib_util_pad').inDefault, false, 'code no work names');
    assert.equal(m.defaultCount, m.nodes.filter((n) => n.inDefault).length);
    assert.ok(m.defaultCount < m.nodes.length);
    for (const e of m.edges) assert.ok(Number.isInteger(e.s) && Number.isInteger(e.t) && m.nodes[e.s] && m.nodes[e.t]);
    assert.ok(m.edges.some((e) => e.confidence === 'INFERRED'));
    const epic = m.filters.epics.find((f) => f.id === 'epic:EP-checkout');
    const ids = new Set(epic.nodes.map((i) => m.nodes[i].id));
    for (const id of ['epic:EP-checkout', 'story:EP-checkout-S01', 'task:EP-checkout-S01:backend:T01', 'file:backend:src/routes.js', 'code:backend:src_routes_postorders', 'repo:backend']) assert.ok(ids.has(id), id);
    assert.equal(ids.has('code:backend:lib_util_pad'), false, 'code the epic never names');
    const repo = m.filters.repos.find((f) => f.id === 'repo:backend');
    assert.ok(repo.nodes.map((i) => m.nodes[i].id).includes('story:EP-checkout-S01'), 'a story that builds in it');
    const repoIds = repo.nodes.map((i) => m.nodes[i].id);
    assert.ok(repoIds.includes('file:backend:lib/util.js') && repoIds.includes('code:backend:lib_util_pad'), 'the file and its code; "All the code" decides whether they are drawn');
    assert.ok(m.filters.stories.some((f) => f.id === 'story:EP-checkout-S01'));
    assert.deepEqual(m.meta, { format: 'yad-brain-1', inputs: brain.inputs, builtAt: '2026-11-13T00:00:00.000Z', codeBehind: [] });
    assert.match(m.meta.inputs, /^sha256:/, 'the live view compares it, to say when the brain was rebuilt (E178)');
    assert.equal(m.warnAbove, WARN_ABOVE);
    assert.ok(m.legend.every((k) => /^#[0-9a-f]{6}$/.test(k.colour)));
  } finally { done(ws); }
});

test('the view model takes any brain: hostile names stay data, unknown kinds get a colour, loose edges drop', () => {
  const evil = '</script><img src=x onerror=alert(1)>';
  const m = viewModel({
    format: 'yad-brain-1',
    nodes: [
      { id: '__proto__', kind: 'epic', label: evil },
      { id: 'constructor', kind: 'mystery', label: 'x'.repeat(5000), file: 42, summary: { not: 'text' } },
      { kind: 'epic' }, null,
    ],
    edges: [{ source: '__proto__', target: 'constructor', relation: 'has-story' }, { source: '__proto__', target: 'ghost' }, null],
  });
  assert.equal(m.nodes.length, 2);
  assert.equal(m.nodes[0].label, evil, 'kept as text; the page sets it with textContent');
  assert.equal(m.nodes[1].kind, 'mystery');
  assert.equal(m.nodes[1].label.length, 300);
  assert.equal(m.nodes[1].file, '42');
  assert.equal(m.nodes[1].summary, undefined);
  assert.ok(m.legend.some((k) => k.kind === 'other'));
  assert.deepEqual(m.edges, [{ s: 0, t: 1, relation: 'has-story', confidence: 'INFERRED' }]);
  assert.equal(Object.getPrototypeOf({}).polluted, undefined);
  assert.deepEqual(viewModel(null).nodes, []);
});

test('the server: 127.0.0.1 only, a key on every request, its own Host only, GET only, fixed routes, strict headers', async () => {
  const { ws, root } = product();
  const s = await startBrainServer(root, { runner: quiet });
  try {
    assert.equal(s.server.address().address, '127.0.0.1');
    assert.match(s.token, /^[0-9a-f]{48}$/);
    const q = `?t=${s.token}`;
    const page = await raw(s.port, { pathname: `/${q}` });
    assert.equal(page.status, 200);
    assert.ok(page.body.includes(`app.js?t=${s.token}`), 'the page asks for its scripts with its key');
    assert.equal(page.headers['content-security-policy'], CSP);
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    assert.equal(page.headers['access-control-allow-origin'], undefined, 'no CORS');
    for (const pathname of ['/', '/?t=', `/?t=${'0'.repeat(48)}`, `/?t=${s.token}0`, `/?t=${s.token.slice(1)}`, `/graph.json?t=${s.token.toUpperCase()}`]) {
      assert.equal((await raw(s.port, { pathname })).status, 403, pathname);
    }
    for (const host of ['localhost:' + s.port, 'evil.example', `127.0.0.1:${s.port + 1}`, '127.0.0.1', `127.0.0.1:${s.port}.evil.example`]) {
      assert.equal((await raw(s.port, { pathname: `/${q}`, host })).status, 403, host);
    }
    const post = await raw(s.port, { method: 'POST', pathname: `/graph.json${q}` });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
    for (const pathname of [`/vendor/../brain.mjs${q}`, `/../cli/brain.mjs${q}`, `/vendor/x.js${q}`, `/package.json${q}`, `/vendor/LICENSE-sigma.txt${q}`, `//etc/passwd${q}`]) {
      assert.equal((await raw(s.port, { pathname })).status, 404, pathname);
    }
    const head = await raw(s.port, { method: 'HEAD', pathname: `/app.js${q}` });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    for (const v of VENDORED) {
      const r = await raw(s.port, { pathname: `/vendor/${v.file}${q}` });
      assert.equal(r.status, 200, v.file);
      assert.match(r.headers['content-type'], /^text\/javascript/);
    }
    const g = await raw(s.port, { pathname: `/graph.json${q}` });
    assert.equal(g.status, 200);
    assert.ok(JSON.parse(g.body).nodes.some((n) => n.id === 'epic:EP-checkout'));
  } finally { await s.close(); done(ws); }
});

test('the server reads the brain on each request, and says why when there is none', async () => {
  const { ws, root, brain } = product();
  const s = await startBrainServer(root, { runner: quiet });
  try {
    const get = async () => raw(s.port, { pathname: `/graph.json?t=${s.token}` });
    const before = JSON.parse((await get()).body).counts.nodes;
    writeBrain(root, { ...brain, nodes: brain.nodes.slice(0, 3), edges: [] });
    assert.equal(JSON.parse((await get()).body).counts.nodes, 3, 'a rebuild shows on reload');
    assert.ok(before > 3);
    fs.rmSync(path.join(root, BRAIN_FILE));
    const gone = await get();
    assert.equal(gone.status, 404);
    assert.match(JSON.parse(gone.body).hint, /yad brain build/);
  } finally { await s.close(); done(ws); }
});

test('each vendored library is the copy its record names: the hash, the licence, a complete vetting record', () => {
  assert.deepEqual(VENDORED.map((v) => v.id).sort(), ['graphology', 'graphology-library', 'sigma']);
  const shipped = fs.readdirSync(VENDOR).sort();
  assert.deepEqual(shipped, VENDORED.flatMap((v) => [v.file, v.licenceFile]).sort(), 'nothing in the folder without a record');
  for (const v of VENDORED) {
    const bytes = fs.readFileSync(path.join(VENDOR, v.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), v.sha256, `${v.file} is not the vetted copy`);
    assert.equal(v.licence, 'MIT');
    assert.match(fs.readFileSync(path.join(VENDOR, v.licenceFile), 'utf8'), /Permission is hereby granted, free of charge/);
    assert.deepEqual(vettingProblems(v), [], v.id);
    const pkg = v.vetted.packages[0];
    assert.equal(v.tarball, `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`);
    assert.match(v.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
    const text = bytes.toString('utf8');
    assert.doesNotMatch(text, /\beval\(|new Function\(/, `${v.file} needs no eval, so the strict CSP holds`);
    assert.doesNotMatch(text, /<\/script/i, `${v.file} can be inlined in a <script>`);
  }
});

test('--html: one file, no network, a CSP that names each inline block, and no name can close its tag', () => {
  const evil = '</script><img src=x onerror=alert(1)><!--';
  const model = viewModel({ format: 'yad-brain-1', nodes: [{ id: 'epic:a', kind: 'epic', label: evil }, { id: 'x y', kind: 'code', label: '&amp; run __TOKEN__ check' }], edges: [] });
  const html = snapshotHTML(model);
  assert.doesNotMatch(html, /<[a-z][^>]*\s(src|href)=/i, 'no tag loads anything from anywhere');
  assert.ok(!html.includes(evil) && !html.includes('</script><img'), 'the label never appears raw');
  assert.equal(html.includes(' '), false);
  // The inline blocks, found by their exact tags (the file writes them exactly so).
  const between = (open, close) => html.split(open).slice(1).map((part) => part.slice(0, part.indexOf(close)));
  const [data] = between('<script type="application/json" id="yad-brain-data">', '</script>');
  assert.deepEqual(JSON.parse(data), JSON.parse(JSON.stringify(model)), 'the data reads back unchanged');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  assert.match(csp, /^default-src 'none'; /);
  assert.doesNotMatch(csp, /connect-src|'self'|unsafe/);
  const hashes = new Set([...csp.matchAll(/'sha256-([^']+)'/g)].map((x) => x[1]));
  const blocks = between('<script>', '</script>');
  assert.equal(blocks.length, VENDORED.length + 1, 'the vendored libraries and app.js');
  for (const b of [...blocks, ...between('<style>', '</style>')]) {
    assert.ok(hashes.has(createHash('sha256').update(b, 'utf8').digest('base64')), 'each inline block is allowed by its hash');
  }
  assert.equal(hashes.size, blocks.length + 1, 'and nothing else is');
  assert.equal(html.replace(/run __TOKEN__ check/g, '').includes('__TOKEN__'), false, 'the page\'s own placeholders are gone');
  assert.ok(html.includes('run __TOKEN__ check'), 'and a name that holds the same text keeps it (review 1)');
  assert.equal(scriptSafeJSON({ a: '<>&  ' }), '{"a":"\\u003c\\u003e\\u0026\\u2028\\u2029"}');
});

test('yad brain view --html writes the ignored default file, or a named one, never through a link', async () => {
  const { ws, root } = product();
  try {
    const r = yad(root, 'brain', 'view', '--html', '--json');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.file, path.join(root, VIEW_FILE));
    assert.equal(out.warning, undefined);
    assert.match(fs.readFileSync(out.file, 'utf8'), /^<!doctype html>/);
    assert.equal(fs.readFileSync(path.join(root, '.sdlc', 'brain', '.gitignore'), 'utf8'), '*\n', 'never committed');

    // A named file inside a git work tree that does not ignore it: written, with a warning.
    const repo = tmp();
    git(repo, 'init', '-q');
    const named = await captured(() => runBrainView(root, { args: [path.join(repo, 'brain.html')], html: true, json: true, runner: quiet }));
    assert.match(named.warning, /not ignored: it holds the names in your code/);
    assert.ok(fs.existsSync(path.join(repo, 'brain.html')));
    put(path.join(repo, '.gitignore'), 'brain.html\n');
    assert.equal((await captured(() => runBrainView(root, { args: [path.join(repo, 'brain.html')], html: true, json: true, runner: quiet }))).warning, undefined);

    // A link at the target is refused, and what it points at is untouched.
    const victim = path.join(repo, 'victim.txt');
    put(victim, 'keep me');
    fs.symlinkSync(victim, path.join(repo, 'link.html'));
    const linked = yad(root, 'brain', 'view', '--html', path.join(repo, 'link.html'));
    assert.notEqual(linked.status, 0);
    assert.match(linked.stderr + linked.stdout, /not a plain file/);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me');
    done(repo);
  } finally { done(ws); }
});

// Run a --json command in-process and return what it printed. It collects console.log, never stdout itself:
// the test runner reports on stdout, and catching that would both break this parse and corrupt the run.
async function captured(fn) {
  const log = console.log;
  const lines = [];
  console.log = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.log = log; }
  return JSON.parse(lines.join('\n'));
}

test('yad brain view refuses with no brain, extra words, and flags of other actions; --open is view\'s alone', () => {
  const { ws, root } = product();
  try {
    fs.rmSync(path.join(root, BRAIN_FILE));
    const none = yad(root, 'brain', 'view', '--html');
    assert.notEqual(none.status, 0);
    assert.match(none.stderr + none.stdout, /no brain here yet[\s\S]*yad brain build/);
    for (const args of [['view', 'a', 'b'], ['view', 'extra'], ['view', '--repo', 'backend'], ['view', '--limit', '3'], ['build', '--open'], ['status', '--html'], ['query', 'x', '--open']]) {
      const r = yad(root, 'brain', ...args, '--json');
      assert.notEqual(r.status, 0, args.join(' '));
      assert.equal(JSON.parse(r.stdout).ok, false, args.join(' '));
    }
  } finally { done(ws); }
});

test('brain view is a local write, never pre-approved for an agent', () => {
  assert.equal(classify(['brain', 'view']), 'local-write');
  assert.equal(classify(['brain', 'view'], ['html', 'open']), 'local-write');
  assert.equal(readAllowList().some((r) => r.includes('brain view')), false);
});

test('review 1: a change-epic shows its parent, never the parent\'s tree; a repo shows its files with their code; one node per id', () => {
  const m = viewModel({
    format: 'yad-brain-1',
    nodes: [
      { id: 'epic:A', kind: 'epic', label: 'A' }, { id: 'epic:B', kind: 'epic', label: 'B' },
      { id: 'story:A-S1', kind: 'story', label: 'A-S1' }, { id: 'story:B-S1', kind: 'story', label: 'B-S1' },
      { id: 'repo:be', kind: 'repo', label: 'be' },
      { id: 'file:be:x.js', kind: 'file', label: 'x.js', repo: 'be' }, { id: 'code:be:x', kind: 'code', label: 'x', repo: 'be' },
      { id: 'epic:A', kind: 'epic', label: 'a second A' },
    ],
    edges: [
      { source: 'epic:B', target: 'epic:A', relation: 'changes', confidence: 'EXTRACTED' },
      { source: 'epic:A', target: 'story:A-S1', relation: 'has-story', confidence: 'EXTRACTED' },
      { source: 'epic:B', target: 'story:B-S1', relation: 'has-story', confidence: 'EXTRACTED' },
      { source: 'repo:be', target: 'file:be:x.js', relation: 'holds', confidence: 'EXTRACTED' },
      { source: 'file:be:x.js', target: 'code:be:x', relation: 'defines', confidence: 'EXTRACTED' },
    ],
  });
  const ids = (f) => f.nodes.map((i) => m.nodes[i].id).sort();
  assert.deepEqual(ids(m.filters.epics.find((f) => f.id === 'epic:B')), ['epic:A', 'epic:B', 'story:B-S1']);
  assert.deepEqual(ids(m.filters.epics.find((f) => f.id === 'epic:A')), ['epic:A', 'story:A-S1']);
  assert.deepEqual(ids(m.filters.repos[0]), ['code:be:x', 'file:be:x.js', 'repo:be']);
  assert.equal(m.nodes.filter((n) => n.id === 'epic:A').length, 1);
  assert.equal(m.nodes.find((n) => n.id === 'epic:A').label, 'A', 'the first wins');
  assert.equal(m.filters.epics.length, 2);
  assert.equal(m.counts.nodes, 7);
});

test('review 1: --open finds a real opener on each system, explorer on Windows, and says when there is none', async () => {
  const { openUrl } = await import('./report.mjs');
  for (const [platform, cmd] of [['darwin', 'open'], ['linux', 'xdg-open'], ['win32', 'explorer']]) {
    const ran = [];
    assert.equal(openUrl('http://127.0.0.1:1/?t=k', { platform, exists: (c) => c === cmd, runner: (c, a) => ran.push([c, ...a]) }), true, platform);
    assert.deepEqual(ran, [[cmd, 'http://127.0.0.1:1/?t=k']], platform);
  }
  assert.equal(openUrl('x', { platform: 'linux', exists: () => false, runner: () => assert.fail('nothing to run') }), false);

  const { ws, root } = product();
  const opened = [];
  const printed = [];
  const log = console.log;
  console.log = (...a) => printed.push(a.join(' '));
  let s;
  try {
    s = await runBrainView(root, { open: true, wait: false, runner: quiet, opener: (u) => { opened.push(u); return false; } });
    assert.equal(opened[0], s.url, 'the address with its key');
    assert.match(printed.join('\n'), /no browser opener was found here/);
    console.log = log;
    const asJSON = await captured(() => runBrainView(root, { args: [path.join(ws, 'v.html')], html: true, open: true, json: true, runner: quiet, opener: () => false }));
    assert.equal(asJSON.opened, false, 'said under --json too (review 2)');
    assert.equal((await captured(() => runBrainView(root, { html: true, json: true, runner: quiet }))).opened, undefined, 'absent without --open');
    assert.equal((await raw(s.port, { pathname: new URL(s.url).pathname + new URL(s.url).search })).status, 200);
  } finally { console.log = log; await s?.close(); done(ws); }
});
