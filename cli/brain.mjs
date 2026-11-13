// E176 — the project brain: one knowledge graph of the code AND the work, built on this machine.
//
//   yad brain build [--repo <name>] [--json]   run Graphify in each connected code repo, then merge its code
//                                              graph with the work items into .sdlc/brain/graph.json
//   yad brain query <text> [--limit n] [--json] the nodes whose name holds <text>, each with its neighbours
//   yad brain status [--json]                  is the brain there, is it current, is each repo graph current
//
// THE RULES, each one the user's decision (2026-11-13; the E176 roadmap row has the reasons):
//   1. ONE GRAPH, TWO LAYERS. The CODE layer is Graphify's (github.com/Graphify-Labs/graphify): files,
//      symbols, calls, imports, parsed locally with tree-sitter. The WORK layer is yadflow's own: epics,
//      stories, tasks, contract surfaces, ships, repos, read from the Product's files. Edges join them: a task
//      declares files, a story touches a surface, a surface is named in the code.
//   2. NOTHING LEAVES THE MACHINE. Graphify runs with GRAPHIFY_BACKEND=none (no LLM pass: code only) and
//      GRAPHIFY_QUERY_LOG_DISABLE=1, and without the shell's LLM keys, so a backend it misread has nothing to
//      call. yad never runs `graphify install`, `hook install`, `watch`, its MCP server or its query
//      commands: `yad brain query` reads the merged file itself.
//   3. DERIVED, LOCAL, NEVER COMMITTED. `.sdlc/brain/` holds its own `.gitignore` (`*`), so the folder ignores
//      itself and no shared file changes. It holds names from private code, and it is rebuilt from git.
//   4. STALENESS IS A HASH of the exact bytes it was built from (the E19 rule, `indexHash`), plus, per repo,
//      the HEAD its code graph was built at (the `syncedHead` rule).
//   5. EVERY EDGE SAYS HOW IT IS KNOWN. EXTRACTED: a field or a parse says so (a story's `repos:`, a task's
//      **Files:** line, a call in the code). INFERRED: a name matched a name (a surface `Order` and a class
//      `Order`). Graphify's own edges keep Graphify's word.
//   6. WITHOUT GRAPHIFY IT STILL WORKS: the work layer alone, with a file node for each declared file.
//
// Every name a key is made from comes from a file anyone can edit, so the lookups are Maps, never plain
// objects: a story naming the repo `constructor` must not reach Object.prototype (E176 review 1).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { c, emitJSON, fail, forTerminal, hand, info, isPlainObject, log, ok, refuse, run, warn } from './lib.mjs';
import { err } from './errors.mjs';
import { productConfigPath } from './manifest.mjs';
import { buildIndex, indexHash, readInput } from './product-index.mjs';
import { epicRoot, parseFrontmatter, declaredRepos } from './epic-state.mjs';
import { lightTasksBlock, isLightSpec } from './build.mjs';
import { readShips } from './ledger.mjs';
import { judgeRepo, readRegistry } from './workspace.mjs';
import { whereOnPath } from './toolbox.mjs';

export const GRAPHIFY_VERSION = '0.9.108';
// The `graph.schema_version` values this reader knows. A new one is refused, never guessed at.
export const GRAPHIFY_SCHEMAS = Object.freeze([1]);
// Mixed into the hash: move it whenever `composeBrain` changes what it writes.
export const BRAIN_FORMAT = 'yad-brain-1';
export const BRAIN_DIR = path.join('.sdlc', 'brain');
export const BRAIN_FILE = path.join(BRAIN_DIR, 'graph.json');
const CODE = 'YAD-STATE-011';
export const GRAPHIFY_ENV = Object.freeze({ GRAPHIFY_BACKEND: 'none', GRAPHIFY_QUERY_LOG_DISABLE: '1' });
// The shell's LLM settings, which Graphify reads to pick a backend: left out of its environment.
export const LLM_ENV = /^(?:.*_API_KEY|.*_BASE_URL|ANTHROPIC_.*|OPENAI_.*|AZURE_OPENAI_.*|GEMINI_.*|GOOGLE_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|MOONSHOT_.*|DEEPSEEK_.*|OLLAMA_.*|AWS_.*|GRAPHIFY_.*)$/i;
// Graphify on a large repo is slow, but never this slow; a hang must not hold `yad` for ever.
const GRAPHIFY_TIMEOUT_MS = 20 * 60 * 1000;
// A repo name becomes a folder name under .sdlc/brain/repos/: one plain word, never a path or a key that
// means something to JavaScript.
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export const safeName = (n) => typeof n === 'string' && /^\w[\w.-]*$/.test(n) && !n.includes('..') && !RESERVED.has(n);
const posix = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

// ---- paths with no link on the way ----------------------------------------------------------------

// Make each folder of `parts` under `base`, refusing any that is not a plain folder: writing through a link
// would put the file wherever it points. Returns the last folder.
function plainDirs(base, parts, label) {
  let cur = path.resolve(base);
  for (const part of parts) {
    cur = path.join(cur, part);
    let st = null;
    try { st = fs.lstatSync(cur); } catch { /* made below */ }
    if (st && !st.isDirectory()) throw err(CODE, `${label(cur)} is not a plain folder (a link?)`, 'move it aside, then run `yad brain build` again');
    if (!st) fs.mkdirSync(cur);
  }
  return cur;
}

// Make `.sdlc/brain/` with its own `.gitignore`.
export function ensureBrainDir(root) {
  const cur = plainDirs(root, ['.sdlc', 'brain'], (p) => path.relative(root, p));
  const gi = path.join(cur, '.gitignore');
  let st = null;
  try { st = fs.lstatSync(gi); } catch { /* written below */ }
  if (st && !st.isFile()) throw err(CODE, `${BRAIN_DIR}/.gitignore is not a plain file`, 'remove it, then run `yad brain build` again');
  if (!st || fs.readFileSync(gi, 'utf8') !== '*\n') fs.writeFileSync(gi, '*\n');
  return cur;
}

// A file inside `base`, read only when nothing on its way is a link (a committed link could point anywhere).
function readPlain(base, rel) {
  let cur = base;
  for (const part of rel.split('/')) {
    cur = path.join(cur, part);
    try { if (fs.lstatSync(cur).isSymbolicLink()) return { error: 'a link' }; } catch { return { absent: true }; }
  }
  return readInput(cur);
}

// Write a file by a temp file and a rename: a rename replaces a link where `writeFileSync` would follow it,
// and a committed link (`files.txt -> ~/.zshrc`) would take every name from the code repo (E176 review 2).
function writePlain(dir, name, data) {
  const file = path.join(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- Graphify's file -----------------------------------------------------------------------------

// Graphify's graph.json, as { schemaVersion, graphifyVersion, nodes, edges }. Its edges are under `links`
// (networkx's node-link format); `edges` is read too, for a release that renames it.
export function readGraphify(text) {
  let g;
  try { g = JSON.parse(text); } catch { throw err(CODE, 'the Graphify graph does not parse', 'run `yad brain build` again'); }
  if (!isPlainObject(g)) throw err(CODE, 'the Graphify graph is not an object', 'run `yad brain build` again');
  const schemaVersion = isPlainObject(g.graph) ? g.graph.schema_version : undefined;
  if (!GRAPHIFY_SCHEMAS.includes(schemaVersion)) {
    throw err(CODE, `the Graphify graph has schema_version ${JSON.stringify(schemaVersion ?? null)}, which this yadflow does not read (it reads ${GRAPHIFY_SCHEMAS.join(', ')})`,
      `install the vetted Graphify: \`uv tool install graphifyy==${GRAPHIFY_VERSION}\`, then run \`yad brain build\` again`);
  }
  const edges = Array.isArray(g.links) ? g.links : g.edges;
  if (!Array.isArray(g.nodes) || !Array.isArray(edges)) throw err(CODE, 'the Graphify graph has no list of nodes or of links', 'run `yad brain build` again');
  return { schemaVersion, graphifyVersion: typeof g.graph.graphify_version === 'string' ? g.graph.graphify_version : null, nodes: g.nodes, edges };
}

// The Graphify program on PATH, as { bin, version }, or null. `bin` is the file found, which is what runs.
// A file found that cannot be started (on Windows a `.cmd` shim, which needs a shell) is { bin, startError }.
export function graphifyHere({ runner = run, where = whereOnPath } = {}) {
  const bin = where('graphify');
  if (!bin) return null;
  const r = runner(bin, ['--version'], { timeout: 60_000 });
  if (r.error) return { bin, version: null, startError: r.error.code || r.error.message };
  const m = /graphify\s+v?(\d[\w.+-]*)/i.exec(`${r.stdout}\n${r.stderr}`);
  return { bin, version: m ? m[1] : 'unknown' };
}

// The environment Graphify runs in: the shell's, without its LLM settings, plus ours. Keys are matched
// without regard to case, as Windows reads them.
export function graphifyEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!LLM_ENV.test(k)) out[k] = v;
  return { ...out, ...GRAPHIFY_ENV };
}

// Keep Graphify's output folder out of the code repo's git, in `.git/info/exclude` — local to this clone,
// never committed. Returns false when git cannot say where that file is, or it is not a plain file.
export function excludeGraphifyOut(target, { runner = run } = {}) {
  const r = runner('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: target });
  if (!r.ok || !r.stdout) return false;
  const file = path.resolve(target, r.stdout);
  let body = '';
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return false;
    body = fs.readFileSync(file, 'utf8');
  } catch (e) { if (e.code !== 'ENOENT') return false; }
  if (body.split(/\r?\n/).some((l) => l.trim() === 'graphify-out/')) return true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${body.replace(/\n*$/, body ? '\n' : '')}# yad brain build (E176): Graphify's output, kept on this machine\ngraphify-out/\n`);
  return true;
}

const headOf = (target, runner) => { const r = runner('git', ['rev-parse', 'HEAD'], { cwd: target }); return r.ok && /^[0-9a-f]{7,64}$/.test(r.stdout) ? r.stdout : null; };

// The code repos the brain can read: registered, on disk, with a safe name that no other repo shares in
// another case (`Backend` and `backend` are one folder on macOS and Windows). The rest, with why.
export function brainRepos(root, registry) {
  const usable = [];
  const skipped = [];
  const seen = new Set();
  for (const repo of registry.repos) {
    const name = repo && typeof repo === 'object' ? repo.name : null;
    if (!safeName(name)) { skipped.push({ name: forTerminal(name ?? '(unnamed)'), why: 'its name is not one plain word' }); continue; }
    if (seen.has(name.toLowerCase())) { skipped.push({ name, why: 'another repo has the same name in another case' }); continue; }
    seen.add(name.toLowerCase());
    const j = judgeRepo(root, repo);
    if (j.state !== 'present') {
      const absent = j.state === 'missing' || (j.target && !fs.existsSync(j.target));
      skipped.push({ name, why: absent ? 'not cloned here (`yad repo clone`)' : j.reason || j.state });
      continue;
    }
    usable.push({ name, target: j.target, codeMap: typeof repo.codeMap === 'string' ? repo.codeMap : null });
  }
  return { usable, skipped };
}

// Run Graphify in one repo and keep its graph under .sdlc/brain/repos/<name>/, with the files the checkout
// holds now — what Graphify read — so a declared file that is not code still counts as there.
// { ok, why?, nodes?, edges?, warning? }
export function buildRepoGraph(root, repo, { runner = run, env = process.env, bin = 'graphify' } = {}) {
  // Graphify writes into graphify-out/: a link there would send its files, and our read, anywhere; a tracked
  // folder would have committed files rewritten.
  let outSt = null;
  try { outSt = fs.lstatSync(path.join(repo.target, 'graphify-out')); } catch { /* made by Graphify */ }
  if (outSt && !outSt.isDirectory()) return { ok: false, why: 'graphify-out in the repo is not a plain folder (a link?)' };
  const tracked = runner('git', ['ls-files', '--', 'graphify-out'], { cwd: repo.target });
  if (tracked.ok && tracked.stdout) return { ok: false, why: 'graphify-out/ is committed in this repo, and Graphify would rewrite it' };
  const excluded = excludeGraphifyOut(repo.target, { runner });
  // `--force`: write the graph even when it has fewer nodes than the last one. Without it, Graphify keeps the
  // old file after code is deleted, and the brain would show code that is gone. Its stdout is not read.
  const r = runner(bin, ['update', '.', '--force'], {
    cwd: repo.target, env: graphifyEnv(env), timeout: GRAPHIFY_TIMEOUT_MS, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error?.code === 'ETIMEDOUT') return { ok: false, why: `graphify took longer than ${GRAPHIFY_TIMEOUT_MS / 60000} minutes and was stopped` };
  if (!r.ok) return { ok: false, why: `graphify failed — ${forTerminal((r.stderr || String(r.error?.code || 'no output')).split('\n').pop())}` };
  let text;
  try {
    const st = fs.lstatSync(path.join(repo.target, 'graphify-out'));
    if (!st.isDirectory()) return { ok: false, why: 'graphify-out in the repo is not a plain folder (a link?)' };
    const input = readPlain(repo.target, 'graphify-out/graph.json');
    if (!input.bytes) return { ok: false, why: 'graphify wrote no graphify-out/graph.json' };
    text = input.bytes.toString('utf8');
  } catch { return { ok: false, why: 'graphify wrote no graphify-out/graph.json' }; }
  let g;
  try { g = readGraphify(text); } catch (e) { return { ok: false, why: e.message }; }
  const head = headOf(repo.target, runner);
  // Tracked and new files git does not ignore, that are on disk: the working tree Graphify parsed, not HEAD.
  // Spawned directly, never through `run()`, which trims its output and so the first name's leading space.
  const lsr = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo.target, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ls = { ok: lsr.status === 0, stdout: lsr.stdout || '' };
  const dir = plainDirs(root, [...BRAIN_DIR.split(path.sep), 'repos', repo.name], (p) => path.relative(root, p));
  writePlain(dir, 'graph.json', text);
  // The list git holds is NUL-separated; kept sorted and LF-separated, so it hashes the same everywhere.
  const files = ls.ok ? [...new Set([...ls.stdout.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(repo.target, f))), ...g.nodes.map((n) => (isPlainObject(n) && typeof n.source_file === 'string' ? posix(n.source_file) : null)).filter(Boolean)])].sort() : null;
  if (files) writePlain(dir, 'files.txt', `${files.join('\n')}\n`);
  else fs.rmSync(path.join(dir, 'files.txt'), { force: true });
  const meta = { head, graphifyVersion: g.graphifyVersion, schemaVersion: g.schemaVersion, builtAt: new Date().toISOString() };
  writePlain(dir, 'meta.json', `${JSON.stringify(meta, null, 2)}\n`);
  return { ok: true, nodes: g.nodes.length, edges: g.edges.length, ...(excluded ? {} : { warning: 'graphify-out/ could not be added to the repo\'s .git/info/exclude — git may show it' }) };
}

// The code graph kept for one repo, or why there is none: { graph?, meta?, files?, inputs, why? }.
function storedRepoGraph(root, name) {
  const input = readPlain(root, posix(path.join(BRAIN_DIR, 'repos', name, 'graph.json')));
  const filesIn = readPlain(root, posix(path.join(BRAIN_DIR, 'repos', name, 'files.txt')));
  const inputs = { input, filesIn };
  if (!input.bytes) return { inputs, why: input.absent ? 'not built yet' : `unreadable (${input.error})` };
  let meta = {};
  const metaIn = readPlain(root, posix(path.join(BRAIN_DIR, 'repos', name, 'meta.json')));
  try { if (metaIn.bytes) meta = JSON.parse(metaIn.bytes.toString('utf8')); } catch { /* no head known */ }
  const files = filesIn.bytes ? new Set(filesIn.bytes.toString('utf8').split('\n').filter(Boolean)) : null;
  try { return { graph: readGraphify(input.bytes.toString('utf8')), meta: isPlainObject(meta) ? meta : {}, files, inputs }; } catch (e) { return { inputs, why: e.message }; }
}

// ---- the work layer ------------------------------------------------------------------------------

// The backtick names after "Contract surface touched:" in a story's body. `none` is not a name.
export function surfacesOf(body) {
  const m = /Contract surface touched:\s*(.*)/i.exec(String(body));
  if (!m) return [];
  return [...new Set([...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1].trim()).filter((s) => s && s.toLowerCase() !== 'none'))];
}

// The tasks of one story in one repo: [{ id, goal, files }]. `## T01 — goal` opens a task; its
// **Files:** line names the files it may touch, each in backticks.
export function tasksOf(text) {
  const tasks = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const h = /^##\s+(T\d+)\b\s*(?:[—–:-]\s*)?(.*)$/.exec(line);
    if (h) { cur = { id: h[1], goal: h[2].trim(), files: [] }; tasks.push(cur); continue; }
    const f = /\*\*Files:\*\*\s*(.*)$/.exec(line);
    if (cur && f) {
      for (const x of f[1].matchAll(/`([^`]+)`/g)) {
        const p = posix(x[1].trim());
        if (p && !path.posix.isAbsolute(p) && !/^[A-Za-z]:/.test(p) && !p.split('/').includes('..') && !cur.files.includes(p)) cur.files.push(p);
      }
    }
  }
  return tasks;
}

// Graph builder with de-duplicated nodes and edges. A node first named only in passing (an epic's parent,
// a repo a story lists) is a placeholder: its own definition fills it in later, and a second mention never
// overwrites what a definition wrote.
function graphBuilder() {
  const nodes = new Map();
  const real = new Set();
  const edges = new Map();
  return {
    nodes,
    node(id, fields, { define = false } = {}) {
      const n = nodes.get(id);
      if (!n) nodes.set(id, { id, ...fields });
      else if (define && !real.has(id)) Object.assign(n, fields);
      else for (const [k, v] of Object.entries(fields)) if (!(k in n)) n[k] = v;
      if (define) real.add(id);
      return id;
    },
    edge(source, target, relation, confidence = 'EXTRACTED', extra = {}) {
      const key = `${source}\0${target}\0${relation}`;
      if (!edges.has(key)) edges.set(key, { source, target, relation, confidence, ...extra });
    },
    edges,
  };
}

// The whole brain, built from the files on disk (it runs nothing but `git rev-parse` in status): { brain,
// inputs, repos }. `repos` is { name: state } in registry order.
export function composeBrain(root, { registry = readRegistry(root).registry } = {}) {
  const g = graphBuilder();
  const parts = [];
  const { usable, skipped } = brainRepos(root, registry);
  const repoState = new Map();
  const codeFiles = new Map(); // repo -> Set of files git holds (or, for an old build, that the code graph names)
  const codeByLabel = new Map(); // repo -> Map(lower label without "()" -> [node ids])
  const targets = new Map(usable.map((r) => [r.name, r]));
  const mapLines = new Map();
  parts.push({ name: 'repos.json', input: readInput(path.join(root, '.sdlc', 'repos.json')) });
  parts.push({ name: 'skipped', input: { bytes: Buffer.from(JSON.stringify(skipped)) } });

  // ---- the code layer
  for (const repo of usable) {
    g.node(`repo:${repo.name}`, { kind: 'repo', label: repo.name }, { define: true });
    const stored = storedRepoGraph(root, repo.name);
    parts.push({ name: `brain/repos/${repo.name}/graph.json`, input: stored.inputs.input });
    parts.push({ name: `brain/repos/${repo.name}/files.txt`, input: stored.inputs.filesIn });
    parts.push({ name: `brain/repos/${repo.name}/head`, input: { bytes: Buffer.from(String(stored.meta?.head ?? '')) } });
    if (!stored.graph) { repoState.set(repo.name, { code: false, why: stored.why }); continue; }
    const { graph, meta } = stored;
    const files = new Set();
    const byLabel = new Map();
    for (const n of graph.nodes) {
      if (!isPlainObject(n) || (typeof n.id !== 'string' && typeof n.id !== 'number')) continue;
      const id = `code:${repo.name}:${n.id}`;
      const file = typeof n.source_file === 'string' && n.source_file ? posix(n.source_file) : null;
      g.node(id, {
        kind: 'code', label: String(n.label ?? n.id), repo: repo.name,
        ...(file ? { file } : {}), ...(typeof n.source_location === 'string' ? { at: n.source_location } : {}),
        ...(n.community !== undefined ? { community: n.community } : {}),
      }, { define: true });
      if (file) {
        files.add(file);
        const fid = g.node(`file:${repo.name}:${file}`, { kind: 'file', label: file, repo: repo.name }, { define: true });
        g.edge(fid, id, 'defines');
      }
      const key = String(n.label ?? '').replace(/\(\)$/, '').replace(/^\./, '').toLowerCase();
      if (key) byLabel.set(key, [...(byLabel.get(key) || []), id]);
    }
    for (const f of files) g.edge(`repo:${repo.name}`, `file:${repo.name}:${f}`, 'holds');
    let dropped = 0;
    for (const e of graph.edges) {
      if (!isPlainObject(e)) continue;
      const s = `code:${repo.name}:${e.source}`;
      const t = `code:${repo.name}:${e.target}`;
      if (!g.nodes.has(s) || !g.nodes.has(t)) { dropped += 1; continue; }
      g.edge(s, t, String(e.relation || 'related'), ['EXTRACTED', 'INFERRED', 'AMBIGUOUS'].includes(e.confidence) ? e.confidence : 'INFERRED',
        typeof e.confidence_score === 'number' ? { score: e.confidence_score } : {});
    }
    codeFiles.set(repo.name, stored.files || files);
    codeByLabel.set(repo.name, byLabel);
    repoState.set(repo.name, { code: true, head: meta.head ?? null, graphifyVersion: meta.graphifyVersion ?? null, nodes: graph.nodes.length, ...(dropped ? { droppedEdges: dropped } : {}) });
  }
  for (const s of skipped) if (!repoState.has(s.name)) repoState.set(s.name, { code: false, why: s.why });

  // ---- the work layer
  const built = buildIndex(root);
  parts.push({ name: 'index', input: { bytes: Buffer.from(built.inputs) } });
  for (const item of built.index.items) {
    if (item.unreadable) continue;
    const eid = g.node(`epic:${item.id}`, { kind: 'epic', label: item.title || item.id, ...(item.currentStep ? { step: item.currentStep } : {}), ...(item.type ? { type: item.type } : {}) }, { define: true });
    if (item.parent) g.edge(eid, g.node(`epic:${item.parent}`, { kind: 'epic', label: item.parent }), 'changes');
    for (const r of item.repos || []) g.edge(eid, g.node(`repo:${r}`, { kind: 'repo', label: r }), 'touches');
    const dir = epicRoot(root, item.id);
    const contractIn = readInput(path.join(dir, 'contract.md'));
    parts.push({ name: `${item.id}/contract.md`, input: contractIn });
    const contractText = contractIn.bytes ? contractIn.bytes.toString('utf8') : null;
    const cid = contractText !== null ? g.node(`contract:${item.id}`, { kind: 'contract', label: `${item.id} contract` }, { define: true }) : null;
    if (cid) g.edge(eid, cid, 'has-contract');

    let ships = [];
    try { ships = readShips(dir).filter(isPlainObject); } catch { /* an unreadable ledger: yad doctor says so */ }
    parts.push({ name: `${item.id}/ships`, input: { bytes: Buffer.from(JSON.stringify(ships)) } });

    const sdir = path.join(dir, 'stories');
    let files = [];
    try { files = fs.readdirSync(sdir).filter((f) => f.endsWith('.md')).sort(); } catch { /* no stories yet */ }
    for (const f of files) {
      const sin = readInput(path.join(sdir, f));
      parts.push({ name: `${item.id}/stories/${f}`, input: sin });
      if (!sin.bytes) continue;
      const text = sin.bytes.toString('utf8');
      const fm = parseFrontmatter(text);
      // One node per story id: ids carry their epic (`EP-x-S01`), so two epics never share one.
      const sidText = typeof fm.id === 'string' && fm.id ? fm.id : f.replace(/\.md$/, '');
      const sid = g.node(`story:${sidText}`, { kind: 'story', label: sidText, ...(typeof fm.status === 'string' ? { status: fm.status } : {}), summary: summaryOf(text) }, { define: true });
      g.edge(eid, sid, 'has-story');
      const repos = declaredRepos(fm);
      for (const r of repos) g.edge(sid, g.node(`repo:${r}`, { kind: 'repo', label: r }), 'builds-in');

      for (const token of surfacesOf(text)) {
        const surf = g.node(`surface:${token}`, { kind: 'surface', label: token });
        g.edge(sid, surf, 'touches-surface');
        if (cid && contractText.includes(token)) g.edge(cid, surf, 'declares', 'INFERRED');
        for (const r of repos) linkSurface(g, surf, token, r, codeByLabel.get(r), codeMapLines(root, targets.get(r), parts, mapLines));
      }

      for (const r of repos) {
        // The tasks live in the code repo, so only a repo cloned here has them.
        const t = targets.get(r);
        const state = repoState.get(r);
        for (const task of t ? tasksFor(t.target, sidText, parts, r) : []) {
          const tid = g.node(`task:${sidText}:${r}:${task.id}`, { kind: 'task', label: `${task.id}${task.goal ? ` — ${task.goal}` : ''}`, repo: r }, { define: true });
          g.edge(sid, tid, 'has-task');
          for (const file of task.files) {
            const known = codeFiles.get(r)?.has(file);
            const fid = g.node(`file:${r}:${file}`, { kind: 'file', label: file, repo: r, ...(known || !state?.code ? {} : { missing: true }) });
            g.edge(tid, fid, 'declares-file');
            if (known) g.edge(`repo:${r}`, fid, 'holds');
          }
        }
        // The ships live in the Product's ledger: they are drawn whether or not the repo is cloned here.
        for (const s of ships.filter((x) => x.story === sidText && x.repo === r)) {
          const task = typeof s.task === 'string' && s.task ? s.task : 'ship';
          // One merge commit is one ship, even for a grouped PR's many tasks (#350); a ship with no commit (a
          // retroactive one) is its story's and task's own.
          const key = typeof s.mergeCommit === 'string' && s.mergeCommit ? s.mergeCommit : `${sidText}:${task}:${s.branch ?? ''}`;
          const shid = `ship:${r}:${key}`;
          const prev = g.nodes.get(shid);
          const tasks = [...new Set([...(prev?.tasks || []), `${sidText}/${task}`])].sort();
          // The first PR and date found are kept, so the label does not depend on which row is read last.
          const pr = prev?.pr ?? (s.pr ? s.pr : undefined);
          g.node(shid, { kind: 'ship', repo: r }, { define: true });
          Object.assign(g.nodes.get(shid), {
            tasks, label: `${tasks.length > 1 ? `${tasks.length} tasks` : task}${pr ? ` #${pr}` : ''}`,
            ...(pr ? { pr } : {}), ...(s.shippedAt && !prev?.date ? { date: s.shippedAt } : {}),
          });
          const tid = `task:${sidText}:${r}:${task}`;
          g.edge(g.nodes.has(tid) ? tid : sid, shid, 'shipped-as');
          g.edge(shid, g.node(`repo:${r}`, { kind: 'repo', label: r }), 'merged-into');
        }
      }
    }
  }

  const nodes = [...g.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...g.edges.values()].filter((e) => g.nodes.has(e.source) && g.nodes.has(e.target))
    .sort((a, b) => `${a.source}\0${a.target}\0${a.relation}`.localeCompare(`${b.source}\0${b.target}\0${b.relation}`));
  const inputs = indexHash(parts, BRAIN_FORMAT);
  const repos = Object.fromEntries(repoState);
  return { brain: { format: BRAIN_FORMAT, inputs, repos, counts: countsOf(nodes, edges), nodes, edges }, inputs, repos };
}

function summaryOf(text) {
  const lines = String(text).split(/\r?\n/);
  const at = lines.findIndex((l) => /^##\s+Story\b/i.test(l));
  const first = at < 0 ? null : lines.slice(at + 1).find((l) => l.trim());
  return first ? first.trim().slice(0, 160) : null;
}

function countsOf(nodes, edges) {
  const kinds = new Map();
  for (const n of nodes) kinds.set(n.kind, (kinds.get(n.kind) || 0) + 1);
  return { nodes: nodes.length, edges: edges.length, kinds: Object.fromEntries(kinds) };
}

// A story's tasks in one repo: from specs/<story>/tasks.md, or a light spec's marked block.
function tasksFor(target, story, parts, repo) {
  if (!safeName(story)) return [];
  const tin = readPlain(target, `specs/${story}/tasks.md`);
  parts.push({ name: `repo:${repo}/specs/${story}/tasks.md`, input: tin });
  if (tin.bytes) return tasksOf(tin.bytes.toString('utf8'));
  const link = readPlain(target, `specs/${story}/link.md`);
  parts.push({ name: `repo:${repo}/specs/${story}/link.md`, input: link });
  if (!link.bytes || !isLightSpec(link.bytes.toString('utf8'))) return [];
  const spec = readPlain(target, `specs/${story}/spec.md`);
  parts.push({ name: `repo:${repo}/specs/${story}/spec.md`, input: spec });
  const block = spec.bytes ? lightTasksBlock(spec.bytes.toString('utf8')) : null;
  return block ? tasksOf(block) : [];
}

// A repo's code-map lines, read once per compose.
function codeMapLines(root, repo, parts, cache) {
  if (!repo?.codeMap) return [];
  if (cache.has(repo.name)) return cache.get(repo.name);
  const rel = posix(repo.codeMap);
  const input = rel.startsWith('.sdlc/code-context/') && !rel.split('/').includes('..') ? readPlain(root, rel) : { absent: true };
  parts.push({ name: `code-map:${repo.name}`, input });
  const lines = input.bytes ? input.bytes.toString('utf8').split('\n') : [];
  cache.set(repo.name, lines);
  return lines;
}

// Join a surface to the code, by name only — so every edge here is INFERRED:
//   - a code symbol whose name IS the surface (`Order` → class Order);
//   - on a code-map line that names the surface, each backtick handler (`postOrders(body)`) and path.
function linkSurface(g, surf, token, repo, byLabel, mapLines) {
  if (byLabel) for (const id of byLabel.get(token.toLowerCase()) || []) g.edge(surf, id, 'named-as', 'INFERRED');
  for (const line of mapLines) {
    if (!line.includes(`\`${token}\``)) continue;
    for (const x of line.matchAll(/`([^`]+)`/g)) {
      const v = x[1].trim();
      if (v === token) continue;
      const fn = /^([A-Za-z_$][\w$]*)\(/.exec(v);
      if (fn && byLabel) for (const id of byLabel.get(fn[1].toLowerCase()) || []) g.edge(surf, id, 'handled-by', 'INFERRED');
      if (/^[\w.-]+(\/[\w.-]+)*\.\w+$/.test(v) && v.includes('/')) {
        const fid = `file:${repo}:${posix(v)}`;
        if (g.nodes.has(fid)) g.edge(surf, fid, 'mapped-to', 'INFERRED');
      }
    }
  }
}

// ---- reading the brain back ----------------------------------------------------------------------

export function readBrain(root) {
  const input = readPlain(root, posix(BRAIN_FILE));
  if (input.absent) return null;
  if (!input.bytes) throw err(CODE, `${BRAIN_FILE} cannot be read (${input.error})`, 'run `yad brain build`');
  let b;
  try { b = JSON.parse(input.bytes.toString('utf8')); } catch { throw err(CODE, `${BRAIN_FILE} does not parse`, 'run `yad brain build`'); }
  if (!isPlainObject(b) || b.format !== BRAIN_FORMAT || !Array.isArray(b.nodes) || !Array.isArray(b.edges)) {
    throw err(CODE, `${BRAIN_FILE} is not a brain this yadflow reads (format ${JSON.stringify(b?.format ?? null)}, expected ${BRAIN_FORMAT})`, 'run `yad brain build`');
  }
  return b;
}

export function writeBrain(root, brain) {
  ensureBrainDir(root);
  const file = path.join(root, BRAIN_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(brain)}\n`);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// How the brain on disk compares with the files it is built from.
//   { state: 'current' | 'behind' | 'missing' | 'unreadable', why?, problem?, repos: [{ name, state, … }] }
// A repo's state: 'current', 'behind' (its HEAD moved since its code graph was built), 'unknown' (a HEAD that
// cannot be read), 'not-built', or 'skipped' (not usable here, with why).
export function brainFreshness(root, { runner = run } = {}) {
  const { registry, problem } = readRegistry(root);
  const now = composeBrain(root, { registry });
  const { usable } = brainRepos(root, registry);
  const byName = new Map(usable.map((r) => [r.name, r]));
  const repos = Object.entries(now.repos).map(([name, s]) => {
    const u = byName.get(name);
    if (!u) return { name, state: 'skipped', why: s.why };
    if (!s.code) return { name, state: 'not-built', why: s.why };
    const head = headOf(u.target, runner);
    const state = !head || !s.head ? 'unknown' : head !== s.head ? 'behind' : 'current';
    return { name, state, builtHead: s.head, head, graphifyVersion: s.graphifyVersion };
  });
  const extra = problem ? { problem } : {};
  let onDisk;
  try { onDisk = readBrain(root); } catch (e) { return { state: 'unreadable', why: e.message, ...extra, repos }; }
  if (!onDisk) return { state: 'missing', ...extra, repos };
  return { state: onDisk.inputs === now.inputs ? 'current' : 'behind', ...extra, repos, counts: onDisk.counts };
}

// The nodes whose label or id holds `text`, best first, each with its neighbours: the edges out first, then
// the edges in, so a busy node shows both.
export function queryBrain(brain, text, { limit = 10, neighbours = 12 } = {}) {
  const q = String(text).trim().toLowerCase();
  if (!q) return [];
  const score = (n) => {
    const l = String(n.label).toLowerCase();
    if (l === q || l.replace(/\(\)$/, '') === q) return 4;
    if (l.startsWith(q)) return 3;
    if (l.includes(q)) return 2;
    return String(n.id).toLowerCase().includes(q) ? 1 : 0;
  };
  const byId = new Map(brain.nodes.map((n) => [n.id, n]));
  const hits = brain.nodes.map((n) => ({ n, s: score(n) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.n.kind === 'code') - (b.n.kind === 'code') || a.n.id.localeCompare(b.n.id)).slice(0, limit);
  const want = new Set(hits.map((h) => h.n.id));
  const out = new Map();
  const into = new Map();
  for (const e of brain.edges) {
    if (want.has(e.source)) out.set(e.source, [...(out.get(e.source) || []), e]);
    if (want.has(e.target)) into.set(e.target, [...(into.get(e.target) || []), e]);
  }
  const brief = (n) => ({ id: n.id, kind: n.kind, label: n.label, ...(n.repo ? { repo: n.repo } : {}), ...(n.file ? { file: n.file } : {}), ...(n.missing ? { missing: true } : {}) });
  return hits.map(({ n }) => {
    const o = (out.get(n.id) || []).filter((e) => byId.has(e.target)).map((e) => ({ relation: e.relation, direction: 'out', confidence: e.confidence, node: brief(byId.get(e.target)) }));
    const i = (into.get(n.id) || []).filter((e) => byId.has(e.source)).map((e) => ({ relation: e.relation, direction: 'in', confidence: e.confidence, node: brief(byId.get(e.source)) }));
    const half = Math.ceil(neighbours / 2);
    const takeOut = Math.min(o.length, Math.max(half, neighbours - i.length));
    return { node: brief(n), neighbours: [...o.slice(0, takeOut), ...i.slice(0, neighbours - takeOut)], more: Math.max(0, o.length + i.length - neighbours) };
  });
}

// ---- the command ---------------------------------------------------------------------------------

export const BRAIN_USAGE = 'usage: yad brain build [--repo <name>] | query <text> [--limit <n>] | status   (each with --json; the search text cannot start with -)';
export const BRAIN_FLAGS = Object.freeze(['--repo', '--limit', '--json', '--dir']);

export async function runBrain(root, { action = 'status', args = [], repo = null, limit = null, json = false, unknownFlags = [], runner = run, where = whereOnPath } = {}) {
  if (unknownFlags.length) return refuse(`yad brain does not take ${unknownFlags.join(', ')}`, BRAIN_USAGE, { json });
  if (!fs.existsSync(productConfigPath(root))) {
    return refuse('no Product here (.sdlc/product.json) — run `yad brain` from the Product, or from a repo it registers', null, { json });
  }
  if (action !== 'query' && args.length) return refuse(`unexpected argument(s): ${args.map(forTerminal).join(' ')}`, BRAIN_USAGE, { json });
  if (action === 'build') return brainBuild(root, { repo, json, runner, where });
  if (action === 'query') return brainQuery(root, { text: args.join(' '), limit, json, runner });
  if (action === 'status') return brainStatus(root, { json, runner, where });
  return refuse(`unknown brain action: ${forTerminal(action)} (build, query, status)`, BRAIN_USAGE, { json });
}

function brainBuild(root, { repo, json, runner, where }) {
  const { registry, problem } = readRegistry(root);
  if (problem) return refuse(problem, 'fix .sdlc/repos.json, then run `yad brain build` again', { json });
  const { usable, skipped } = brainRepos(root, registry);
  if (repo && !usable.some((r) => r.name === repo)) {
    return refuse(`no usable repo named ${forTerminal(repo)} here`, `the repos: ${usable.map((r) => r.name).join(', ') || '(none cloned here)'}`, { json });
  }
  try { ensureBrainDir(root); } catch (e) { return refuse(e.message, e.hint, { json }); }
  if (!json) log(c.bold('\nyad brain build'));
  const here = graphifyHere({ runner, where });
  const results = [];
  if (!here) {
    warn('Graphify is not installed here, so the brain has no code layer: the work items only');
    if (!json) hand(`install it: \`uv tool install graphifyy==${GRAPHIFY_VERSION}\` (or \`yad toolbox connect graphify\`), then run \`yad brain build\` again`);
  } else if (here.startError) {
    warn(`Graphify was found at ${forTerminal(here.bin)} but cannot be started (${forTerminal(here.startError)}), so the brain has no code layer: the work items only`);
    if (!json) hand(`install it with uv, which makes a program that starts directly: \`uv tool install graphifyy==${GRAPHIFY_VERSION}\``);
  } else {
    if (here.version !== GRAPHIFY_VERSION) warn(`Graphify ${forTerminal(here.version)} is installed; yadflow vetted ${GRAPHIFY_VERSION}. It is used anyway`);
    for (const r of usable.filter((x) => !repo || x.name === repo)) {
      if (!json) info(`${r.name}: mapping the code with Graphify (local, no LLM) …`);
      let res;
      try { res = buildRepoGraph(root, r, { runner, bin: here.bin }); } catch (e) { res = { ok: false, why: e.message }; }
      results.push({ name: r.name, ...res });
      if (res.ok) { if (!json) ok(`${r.name}: ${res.nodes} code nodes, ${res.edges} code edges`); if (res.warning) warn(`${r.name}: ${res.warning}`); }
      else warn(`${r.name}: ${res.why} — its last code graph, if any, is kept`);
    }
  }
  for (const s of skipped) if (!json) info(`${forTerminal(s.name)}: skipped — ${forTerminal(s.why)}`);
  let composed;
  try {
    composed = composeBrain(root, { registry });
    writeBrain(root, composed.brain);
  } catch (e) {
    return refuse(`${BRAIN_FILE} was not written (${e.code && !String(e.code).startsWith('YAD-') ? e.code : e.message})`, e.hint || 'run `yad brain build` again', { json });
  }
  const k = composed.brain.counts;
  if (json) {
    return emitJSON({ file: posix(BRAIN_FILE), graphify: here?.version ?? null, vetted: GRAPHIFY_VERSION, built: results, skipped, counts: k, inputs: composed.inputs });
  }
  ok(`wrote ${BRAIN_FILE} — ${k.nodes} nodes, ${k.edges} edges (${Object.entries(k.kinds).map(([a, b]) => `${b} ${a}`).join(', ') || 'empty'})`);
  info('it stays on this machine: .sdlc/brain/ ignores itself, and is never committed');
  hand('search it: `yad brain query <text>`');
  return undefined;
}

function brainQuery(root, { text, limit, json, runner }) {
  if (!text.trim()) return refuse('nothing to search for', 'usage: yad brain query <text> [--limit <n>] [--json]', { json });
  const n = limit === null || limit === undefined ? 10 : Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 500) return refuse(`--limit must be a whole number from 1 to 500, not ${forTerminal(limit)}`, null, { json });
  let brain;
  try { brain = readBrain(root); } catch (e) { return refuse(e.message, e.hint, { json }); }
  if (!brain) return refuse(`no brain here yet (${BRAIN_FILE})`, 'build it: `yad brain build`', { json });
  // A cheap check, not `status`'s full rebuild: has any repo's code moved since its graph was built?
  const behind = codeBehind(root, brain, runner);
  if (behind.length) warn(`the code moved in ${behind.join(', ')} since the brain was built — the answer may be out of date; run \`yad brain build\` (\`yad brain status\` checks everything)`);
  const matches = queryBrain(brain, text, { limit: n });
  if (json) return emitJSON({ query: text, codeBehind: behind, matches });
  log(c.bold(`\nyad brain query ${forTerminal(text)}`));
  if (!matches.length) { info('no node matches'); return undefined; }
  for (const m of matches) {
    log(`\n${c.bold(forTerminal(m.node.label))}  ${c.dim(`${m.node.kind} · ${forTerminal(m.node.id)}`)}${m.node.missing ? c.yellow('  (declared, not in the code)') : ''}`);
    for (const x of m.neighbours) {
      const arrow = x.direction === 'out' ? '→' : '←';
      log(`  ${arrow} ${x.relation}${x.confidence === 'EXTRACTED' ? '' : c.dim(` (${x.confidence.toLowerCase()})`)}  ${forTerminal(x.node.label)} ${c.dim(x.node.kind)}`);
    }
    if (m.more) log(c.dim(`  … and ${m.more} more`));
  }
  return undefined;
}

// The repos whose HEAD moved since the brain recorded it.
function codeBehind(root, brain, runner) {
  const { registry } = readRegistry(root);
  const { usable } = brainRepos(root, registry);
  const out = [];
  for (const r of usable) {
    const built = isPlainObject(brain.repos) && Object.hasOwn(brain.repos, r.name) ? brain.repos[r.name]?.head : null;
    if (!built) continue;
    const head = headOf(r.target, runner);
    if (head && head !== built) out.push(r.name);
  }
  return out;
}

function brainStatus(root, { json, runner, where }) {
  const here = graphifyHere({ runner, where });
  const f = brainFreshness(root, { runner });
  // A brain that cannot be read is a failure, said with exit 1; behind or missing is a state, exit 0.
  if (f.state === 'unreadable') process.exitCode = 1;
  if (json) return emitJSON({ ...(f.state === 'unreadable' ? { ok: false, error: f.why, code: CODE, hint: 'run `yad brain build`' } : {}), file: posix(BRAIN_FILE), ...f, graphify: here?.version ?? null, vetted: GRAPHIFY_VERSION });
  log(c.bold('\nyad brain status'));
  if (f.problem) warn(f.problem);
  if (f.state === 'current') ok(`${BRAIN_FILE} is current — ${f.counts?.nodes ?? 0} nodes, ${f.counts?.edges ?? 0} edges`);
  else if (f.state === 'missing') warn('no brain here yet — build it: `yad brain build`');
  else if (f.state === 'unreadable') fail(f.why);
  else warn(`${BRAIN_FILE} is behind the files it is built from — run \`yad brain build\``);
  for (const r of f.repos) {
    const short = (s) => (s ? s.slice(0, 7) : '?');
    const line = `${forTerminal(r.name)}: ${
      r.state === 'behind' ? `code graph built at ${short(r.builtHead)}, the repo is at ${short(r.head)} — run \`yad brain build\``
        : r.state === 'current' ? `code graph current (${short(r.builtHead)})`
          : r.state === 'unknown' ? 'code graph built, but the repo\'s HEAD cannot be read — run `yad brain build`'
            : `${r.state} — ${forTerminal(r.why ?? '')}`}`;
    if (r.state === 'current') ok(line); else if (r.state === 'behind' || r.state === 'unknown') warn(line); else info(line);
  }
  if (!here) info(`Graphify is not installed here (vetted: ${GRAPHIFY_VERSION}); the brain has the work items only`);
  else if (here.startError) warn(`Graphify was found at ${forTerminal(here.bin)} but cannot be started (${forTerminal(here.startError)})`);
  else if (here.version !== GRAPHIFY_VERSION) warn(`Graphify ${forTerminal(here.version)} is installed; yadflow vetted ${GRAPHIFY_VERSION}`);
  return undefined;
}
