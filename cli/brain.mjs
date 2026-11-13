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
//      GRAPHIFY_QUERY_LOG_DISABLE=1. yad never runs `graphify install`, `hook install`, `watch`, its MCP
//      server or its query commands: `yad brain query` reads the merged file itself.
//   3. DERIVED, LOCAL, NEVER COMMITTED. `.sdlc/brain/` holds its own `.gitignore` (`*`), so the folder ignores
//      itself and no shared file changes. It holds names from private code, and it is rebuilt from git.
//   4. STALENESS IS A HASH of the exact bytes it was built from (the E19 rule, `indexHash`), plus, per repo,
//      the HEAD its code graph was built at (the `syncedHead` rule).
//   5. EVERY EDGE SAYS HOW IT IS KNOWN. EXTRACTED: a field or a parse says so (a story's `repos:`, a task's
//      **Files:** line, a call in the code). INFERRED: a name matched a name (a surface `Order` and a class
//      `Order`). Graphify's own edges keep Graphify's word.
//   6. WITHOUT GRAPHIFY IT STILL WORKS: the work layer alone, with a file node for each declared file.
import fs from 'node:fs';
import path from 'node:path';
import { c, emitJSON, fail, forTerminal, hand, info, isPlainObject, log, ok, refuse, run, warn } from './lib.mjs';
import { err } from './errors.mjs';
import { productConfigPath } from './manifest.mjs';
import { buildIndex, indexHash, readInput } from './product-index.mjs';
import { epicRoot, parseFrontmatter, declaredRepos } from './epic-state.mjs';
import { lightTasksBlock, isLightSpec } from './build.mjs';
import { readShips } from './ledger.mjs';
import { judgeRepo, readRegistry } from './workspace.mjs';
import { onPath } from './toolbox.mjs';

export const GRAPHIFY_VERSION = '0.9.108';
// The `graph.schema_version` values this reader knows. A new one is refused, never guessed at.
export const GRAPHIFY_SCHEMAS = Object.freeze([1]);
// Mixed into the hash: move it whenever `composeBrain` changes what it writes.
export const BRAIN_FORMAT = 'yad-brain-1';
export const BRAIN_DIR = path.join('.sdlc', 'brain');
export const BRAIN_FILE = path.join(BRAIN_DIR, 'graph.json');
const CODE = 'YAD-STATE-011';
export const GRAPHIFY_ENV = Object.freeze({ GRAPHIFY_BACKEND: 'none', GRAPHIFY_QUERY_LOG_DISABLE: '1' });
// A repo name becomes a folder name under .sdlc/brain/repos/: one plain word, never a path.
const safeName = (n) => typeof n === 'string' && /^\w[\w.-]*$/.test(n) && !n.includes('..');
const posix = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

// ---- the folder ----------------------------------------------------------------------------------

// Make `.sdlc/brain/` with its own `.gitignore`. Refuses a link anywhere on the way: writing through one
// would put the brain wherever it points.
export function ensureBrainDir(root) {
  let cur = path.resolve(root);
  for (const part of ['.sdlc', 'brain']) {
    cur = path.join(cur, part);
    let st = null;
    try { st = fs.lstatSync(cur); } catch { /* made below */ }
    if (st && !st.isDirectory()) throw err(CODE, `${path.relative(root, cur)} is not a plain folder (a link?)`, `move it aside, then run \`yad brain build\` again`);
    if (!st) fs.mkdirSync(cur);
  }
  const gi = path.join(cur, '.gitignore');
  let st = null;
  try { st = fs.lstatSync(gi); } catch { /* written below */ }
  if (st && !st.isFile()) throw err(CODE, `${BRAIN_DIR}/.gitignore is not a plain file`, 'remove it, then run `yad brain build` again');
  if (!st || fs.readFileSync(gi, 'utf8') !== '*\n') fs.writeFileSync(gi, '*\n');
  return cur;
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

// The Graphify version on PATH, or null.
export function graphifyVersionHere({ runner = run, has = onPath } = {}) {
  if (!has('graphify')) return null;
  const r = runner('graphify', ['--version']);
  const m = /graphify\s+v?(\d[\w.+-]*)/i.exec(`${r.stdout}\n${r.stderr}`);
  return m ? m[1] : r.ok ? 'unknown' : null;
}

// Keep Graphify's output folder out of the code repo's git, in `.git/info/exclude` — local to this clone,
// never committed. Returns false when git cannot say where that file is.
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

const repoDir = (root, name) => path.join(root, BRAIN_DIR, 'repos', name);
const headOf = (target, runner) => { const r = runner('git', ['rev-parse', 'HEAD'], { cwd: target }); return r.ok && /^[0-9a-f]{7,64}$/.test(r.stdout) ? r.stdout : null; };

// The code repos the brain can read: registered, on disk, with a safe name. The rest, with why.
export function brainRepos(root, registry) {
  const usable = [];
  const skipped = [];
  for (const repo of registry.repos) {
    const name = repo && typeof repo === 'object' ? repo.name : null;
    if (!safeName(name)) { skipped.push({ name: forTerminal(name ?? '(unnamed)'), why: 'its name is not one plain word' }); continue; }
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

// Run Graphify in one repo and keep its graph under .sdlc/brain/repos/<name>/. { ok, why?, nodes?, edges? }
export function buildRepoGraph(root, repo, { runner = run, env = process.env } = {}) {
  excludeGraphifyOut(repo.target, { runner });
  // `--force`: write the graph even when it has fewer nodes than the last one. Without it, Graphify keeps the
  // old file after code is deleted, and the brain would show code that is gone.
  const r = runner('graphify', ['update', '.', '--force'], {
    cwd: repo.target, env: { ...env, ...GRAPHIFY_ENV }, maxBuffer: 64 * 1024 * 1024,
  });
  if (!r.ok) return { ok: false, why: `graphify failed — ${forTerminal((r.stderr || r.stdout || String(r.error?.code || 'no output')).split('\n').pop())}` };
  const out = path.join(repo.target, 'graphify-out', 'graph.json');
  let text;
  try { text = fs.readFileSync(out, 'utf8'); } catch { return { ok: false, why: 'graphify wrote no graphify-out/graph.json' }; }
  let g;
  try { g = readGraphify(text); } catch (e) { return { ok: false, why: e.message }; }
  const dir = repoDir(root, repo.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'graph.json'), text);
  const meta = { head: headOf(repo.target, runner), graphifyVersion: g.graphifyVersion, schemaVersion: g.schemaVersion, builtAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return { ok: true, nodes: g.nodes.length, edges: g.edges.length };
}

// The code graph kept for one repo, or why there is none: { graph?, meta?, input, why? }.
function storedRepoGraph(root, name) {
  const dir = repoDir(root, name);
  const input = readInput(path.join(dir, 'graph.json'));
  if (!input.bytes) return { input, why: input.absent ? 'not built yet' : `unreadable (${input.error})` };
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { /* no head known */ }
  try { return { graph: readGraphify(input.bytes.toString('utf8')), meta: isPlainObject(meta) ? meta : {}, input }; } catch (e) { return { input, why: e.message }; }
}

// ---- the work layer ------------------------------------------------------------------------------

// The backtick names after "Contract surface touched:" in a story's body. `none` and words in bold are
// not names.
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
        if (p && !path.posix.isAbsolute(p) && !p.split('/').includes('..') && !cur.files.includes(p)) cur.files.push(p);
      }
    }
  }
  return tasks;
}

// A file under a code repo, read only when nothing on its way is a link (a committed link could point
// anywhere on the machine).
function readInRepo(target, rel) {
  let cur = target;
  for (const part of rel.split('/')) {
    cur = path.join(cur, part);
    try { if (fs.lstatSync(cur).isSymbolicLink()) return { error: 'a link' }; } catch { return { absent: true }; }
  }
  return readInput(cur);
}

// Graph builder with de-duplicated nodes and edges.
function graphBuilder() {
  const nodes = new Map();
  const edges = new Map();
  return {
    nodes, edges,
    node(id, fields) { if (!nodes.has(id)) nodes.set(id, { id, ...fields }); else Object.assign(nodes.get(id), fields); return id; },
    edge(source, target, relation, confidence = 'EXTRACTED', extra = {}) {
      const key = `${source}\0${target}\0${relation}`;
      if (!edges.has(key)) edges.set(key, { source, target, relation, confidence, ...extra });
    },
  };
}

// The whole brain, built from the files on disk (it runs nothing): { brain, inputs, repos }.
export function composeBrain(root, { registry = readRegistry(root).registry } = {}) {
  const g = graphBuilder();
  const parts = [];
  const { usable, skipped } = brainRepos(root, registry);
  const repoState = {};
  const codeFiles = {}; // repo -> Set of files the code graph knows
  const codeByLabel = {}; // repo -> Map(lower label without "()" -> [node ids])
  parts.push({ name: 'repos.json', input: readInput(path.join(root, '.sdlc', 'repos.json')) });

  // ---- the code layer
  for (const repo of usable) {
    g.node(`repo:${repo.name}`, { kind: 'repo', label: repo.name });
    const stored = storedRepoGraph(root, repo.name);
    parts.push({ name: `brain/repos/${repo.name}/graph.json`, input: stored.input });
    parts.push({ name: `brain/repos/${repo.name}/head`, input: { bytes: Buffer.from(String(stored.meta?.head ?? '')) } });
    if (!stored.graph) { repoState[repo.name] = { code: false, why: stored.why }; continue; }
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
      });
      if (file) {
        files.add(file);
        const fid = g.node(`file:${repo.name}:${file}`, { kind: 'file', label: file, repo: repo.name });
        g.edge(fid, id, 'defines');
      }
      const key = String(n.label ?? '').replace(/\(\)$/, '').replace(/^\./, '').toLowerCase();
      if (key) byLabel.set(key, [...(byLabel.get(key) || []), id]);
    }
    for (const fid of [...files].map((f) => `file:${repo.name}:${f}`)) g.edge(`repo:${repo.name}`, fid, 'holds');
    let dropped = 0;
    for (const e of graph.edges) {
      if (!isPlainObject(e)) continue;
      const s = `code:${repo.name}:${e.source}`;
      const t = `code:${repo.name}:${e.target}`;
      if (!g.nodes.has(s) || !g.nodes.has(t)) { dropped += 1; continue; }
      g.edge(s, t, String(e.relation || 'related'), ['EXTRACTED', 'INFERRED', 'AMBIGUOUS'].includes(e.confidence) ? e.confidence : 'INFERRED',
        typeof e.confidence_score === 'number' ? { score: e.confidence_score } : {});
    }
    codeFiles[repo.name] = files;
    codeByLabel[repo.name] = byLabel;
    repoState[repo.name] = { code: true, head: meta.head ?? null, graphifyVersion: meta.graphifyVersion ?? null, nodes: graph.nodes.length, ...(dropped ? { droppedEdges: dropped } : {}) };
  }
  for (const s of skipped) repoState[s.name] = { code: false, why: s.why };
  const targets = Object.fromEntries(usable.map((r) => [r.name, r]));

  // ---- the work layer
  const built = buildIndex(root);
  parts.push({ name: 'index', input: { bytes: Buffer.from(built.inputs) } });
  for (const item of built.index.items) {
    if (item.unreadable) continue;
    const eid = g.node(`epic:${item.id}`, { kind: 'epic', label: item.title || item.id, ...(item.currentStep ? { step: item.currentStep } : {}), ...(item.type ? { type: item.type } : {}) });
    if (item.parent) g.edge(eid, g.node(`epic:${item.parent}`, { kind: 'epic', label: item.parent }), 'changes');
    for (const r of item.repos || []) g.edge(eid, g.node(`repo:${r}`, { kind: 'repo', label: r }), 'touches');
    const dir = epicRoot(root, item.id);
    const contractIn = readInput(path.join(dir, 'contract.md'));
    parts.push({ name: `${item.id}/contract.md`, input: contractIn });
    const contractText = contractIn.bytes ? contractIn.bytes.toString('utf8') : null;
    const cid = contractText !== null ? g.node(`contract:${item.id}`, { kind: 'contract', label: `${item.id} contract` }) : null;
    if (cid) g.edge(eid, cid, 'has-contract');

    const ships = (() => { try { return readShips(dir); } catch { return []; } })();
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
      const sidText = typeof fm.id === 'string' && fm.id ? fm.id : f.replace(/\.md$/, '');
      const sid = g.node(`story:${sidText}`, { kind: 'story', label: sidText, ...(typeof fm.status === 'string' ? { status: fm.status } : {}), summary: summaryOf(text) });
      g.edge(eid, sid, 'has-story');
      const repos = declaredRepos(fm);
      for (const r of repos) g.edge(sid, g.node(`repo:${r}`, { kind: 'repo', label: r }), 'builds-in');

      for (const token of surfacesOf(text)) {
        const surf = g.node(`surface:${token}`, { kind: 'surface', label: token });
        g.edge(sid, surf, 'touches-surface');
        if (cid && contractText.includes(token)) g.edge(cid, surf, 'declares', 'INFERRED');
        for (const r of repos) linkSurface(g, surf, token, r, codeByLabel[r], codeMapLines(root, targets[r], parts));
      }

      for (const r of repos) {
        const t = targets[r];
        if (!t) continue;
        const tasks = tasksFor(t.target, sidText, parts, r);
        for (const task of tasks) {
          const tid = g.node(`task:${sidText}:${r}:${task.id}`, { kind: 'task', label: `${task.id}${task.goal ? ` — ${task.goal}` : ''}`, repo: r });
          g.edge(sid, tid, 'has-task');
          for (const file of task.files) {
            const known = codeFiles[r]?.has(file);
            const fid = g.node(`file:${r}:${file}`, { kind: 'file', label: file, repo: r, ...(known || !repoState[r]?.code ? {} : { missing: true }) });
            g.edge(tid, fid, 'declares-file');
            if (!known) g.edge(`repo:${r}`, fid, 'holds');
          }
        }
        for (const s of ships.filter((x) => x && x.story === sidText && x.repo === r)) {
          const key = s.mergeCommit || s.branch || `${s.task}`;
          const shid = g.node(`ship:${r}:${key}`, { kind: 'ship', label: `${s.task || 'ship'} ${s.pr ? `#${s.pr}` : ''}`.trim(), repo: r, ...(s.shippedAt ? { date: s.shippedAt } : {}) });
          const tid = `task:${sidText}:${r}:${s.task}`;
          g.edge(g.nodes.has(tid) ? tid : sid, shid, 'shipped-as');
          g.edge(shid, `repo:${r}`, 'merged-into');
        }
      }
    }
  }

  const nodes = [...g.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...g.edges.values()].filter((e) => g.nodes.has(e.source) && g.nodes.has(e.target))
    .sort((a, b) => `${a.source}\0${a.target}\0${a.relation}`.localeCompare(`${b.source}\0${b.target}\0${b.relation}`));
  const inputs = indexHash(parts, BRAIN_FORMAT);
  return { brain: { format: BRAIN_FORMAT, inputs, repos: repoState, counts: countsOf(nodes, edges), nodes, edges }, inputs, repos: repoState };
}

function summaryOf(text) {
  const lines = String(text).split(/\r?\n/);
  const at = lines.findIndex((l) => /^##\s+Story\b/i.test(l));
  const first = at < 0 ? null : lines.slice(at + 1).find((l) => l.trim());
  return first ? first.trim().slice(0, 160) : null;
}

function countsOf(nodes, edges) {
  const kinds = {};
  for (const n of nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
  return { nodes: nodes.length, edges: edges.length, kinds };
}

// A story's tasks in one repo: from specs/<story>/tasks.md, or a light spec's marked block.
function tasksFor(target, story, parts, repo) {
  if (!/^[\w.-]+$/.test(story)) return [];
  const tin = readInRepo(target, `specs/${story}/tasks.md`);
  parts.push({ name: `repo:${repo}/specs/${story}/tasks.md`, input: tin });
  if (tin.bytes) return tasksOf(tin.bytes.toString('utf8'));
  const link = readInRepo(target, `specs/${story}/link.md`);
  if (!link.bytes || !isLightSpec(link.bytes.toString('utf8'))) return [];
  const spec = readInRepo(target, `specs/${story}/spec.md`);
  parts.push({ name: `repo:${repo}/specs/${story}/spec.md`, input: spec });
  const block = spec.bytes ? lightTasksBlock(spec.bytes.toString('utf8')) : null;
  return block ? tasksOf(block) : [];
}

// A repo's code-map lines, read once per compose (memoised on the parts list).
const mapCache = new WeakMap();
function codeMapLines(root, repo, parts) {
  if (!repo?.codeMap) return [];
  let cache = mapCache.get(parts);
  if (!cache) { cache = new Map(); mapCache.set(parts, cache); }
  if (cache.has(repo.name)) return cache.get(repo.name);
  const rel = posix(repo.codeMap);
  const ok2 = rel.startsWith('.sdlc/code-context/') && !rel.split('/').includes('..');
  const input = ok2 ? readInput(path.join(root, rel)) : { absent: true };
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
  const file = path.join(root, BRAIN_FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw err(CODE, `${BRAIN_FILE} cannot be read (${e.code})`, 'run `yad brain build`');
  }
  let b;
  try { b = JSON.parse(text); } catch { throw err(CODE, `${BRAIN_FILE} does not parse`, 'run `yad brain build`'); }
  if (!isPlainObject(b) || b.format !== BRAIN_FORMAT || !Array.isArray(b.nodes) || !Array.isArray(b.edges)) {
    throw err(CODE, `${BRAIN_FILE} is not a brain this yadflow reads (format ${JSON.stringify(b?.format ?? null)}, expected ${BRAIN_FORMAT})`, 'run `yad brain build`');
  }
  return b;
}

export function writeBrain(root, brain) {
  ensureBrainDir(root);
  const file = path.join(root, BRAIN_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(brain)}\n`);
  fs.renameSync(tmp, file);
}

// How the brain on disk compares with the files it is built from.
//   { state: 'current' | 'behind' | 'missing' | 'unreadable', why?, repos: [{ name, state, … }] }
// A repo's state: 'current', 'behind' (its HEAD moved since its code graph was built), 'not-built', or
// 'skipped' (not usable here, with why).
export function brainFreshness(root, { runner = run, composed = null } = {}) {
  const { registry } = readRegistry(root);
  const now = composed || composeBrain(root, { registry });
  const { usable } = brainRepos(root, registry);
  const repos = Object.entries(now.repos).map(([name, s]) => {
    const u = usable.find((r) => r.name === name);
    if (!u) return { name, state: 'skipped', why: s.why };
    if (!s.code) return { name, state: 'not-built', why: s.why };
    const head = headOf(u.target, runner);
    return { name, state: head && s.head && head !== s.head ? 'behind' : 'current', builtAt: s.head, head, graphifyVersion: s.graphifyVersion };
  });
  let onDisk;
  try { onDisk = readBrain(root); } catch (e) { return { state: 'unreadable', why: e.message, repos }; }
  if (!onDisk) return { state: 'missing', repos };
  return { state: onDisk.inputs === now.inputs ? 'current' : 'behind', repos, counts: onDisk.counts };
}

// The nodes whose label or id holds `text`, best first, each with its neighbours.
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
  const brief = (n) => ({ id: n.id, kind: n.kind, label: n.label, ...(n.repo ? { repo: n.repo } : {}), ...(n.file ? { file: n.file } : {}) });
  return hits.map(({ n }) => {
    const near = [];
    for (const e of brain.edges) {
      if (near.length >= neighbours) break;
      if (e.source === n.id && byId.has(e.target)) near.push({ relation: e.relation, direction: 'out', confidence: e.confidence, node: brief(byId.get(e.target)) });
      else if (e.target === n.id && byId.has(e.source)) near.push({ relation: e.relation, direction: 'in', confidence: e.confidence, node: brief(byId.get(e.source)) });
    }
    return { node: brief(n), neighbours: near };
  });
}

// ---- the command ---------------------------------------------------------------------------------

export const BRAIN_USAGE = 'usage: yad brain build [--repo <name>] | query <text> [--limit <n>] | status   (each with --json)';

export async function runBrain(root, { action = 'status', args = [], repo = null, limit = null, json = false, runner = run, has = onPath } = {}) {
  if (!fs.existsSync(productConfigPath(root))) {
    return refuse('no Product here (.sdlc/product.json) — run `yad brain` from the Product, or from a repo it registers', null, { json });
  }
  if (action === 'build') return brainBuild(root, { repo, json, runner, has });
  if (action === 'query') return brainQuery(root, { text: args.join(' '), limit, json });
  if (action === 'status') return brainStatus(root, { json, runner, has });
  return refuse(`unknown brain action: ${forTerminal(action)} (build, query, status)`, BRAIN_USAGE, { json });
}

function brainBuild(root, { repo, json, runner, has }) {
  const { registry, problem } = readRegistry(root);
  if (problem) return refuse(problem, 'fix .sdlc/repos.json, then run `yad brain build` again', { json });
  const { usable, skipped } = brainRepos(root, registry);
  if (repo && !usable.some((r) => r.name === repo)) {
    return refuse(`no usable repo named ${forTerminal(repo)} here`, `the repos: ${usable.map((r) => r.name).join(', ') || '(none cloned here)'}`, { json });
  }
  try { ensureBrainDir(root); } catch (e) { return refuse(e.message, e.hint, { json }); }
  if (!json) log(c.bold('\nyad brain build'));
  const version = graphifyVersionHere({ runner, has });
  const results = [];
  if (!version) {
    if (!json) {
      warn('Graphify is not installed here, so the brain has no code layer: the work items only');
      hand(`install it: \`uv tool install graphifyy==${GRAPHIFY_VERSION}\` (or \`yad toolbox connect graphify\`), then run \`yad brain build\` again`);
    }
  } else {
    if (version !== GRAPHIFY_VERSION && !json) warn(`Graphify ${forTerminal(version)} is installed; yadflow vetted ${GRAPHIFY_VERSION}. It is used anyway`);
    for (const r of usable.filter((x) => !repo || x.name === repo)) {
      if (!json) info(`${r.name}: mapping the code with Graphify (local, no LLM) …`);
      const res = buildRepoGraph(root, r, { runner });
      results.push({ name: r.name, ...res });
      if (!json) {
        if (res.ok) ok(`${r.name}: ${res.nodes} code nodes, ${res.edges} code edges`);
        else warn(`${r.name}: ${res.why} — its last code graph, if any, is kept`);
      }
    }
  }
  for (const s of skipped) if (!json) info(`${forTerminal(s.name)}: skipped — ${forTerminal(s.why)}`);
  const composed = composeBrain(root, { registry });
  writeBrain(root, composed.brain);
  const k = composed.brain.counts;
  if (json) {
    return emitJSON({ file: BRAIN_FILE.split(path.sep).join('/'), graphify: version, vetted: GRAPHIFY_VERSION, built: results, skipped, counts: k, inputs: composed.inputs });
  }
  ok(`wrote ${BRAIN_FILE} — ${k.nodes} nodes, ${k.edges} edges (${Object.entries(k.kinds).map(([a, b]) => `${b} ${a}`).join(', ') || 'empty'})`);
  info('it stays on this machine: .sdlc/brain/ ignores itself, and is never committed');
  hand('search it: `yad brain query <text>`');
  return undefined;
}

function brainQuery(root, { text, limit, json }) {
  if (!text.trim()) return refuse('nothing to search for', 'usage: yad brain query <text> [--limit <n>] [--json]', { json });
  const n = limit === null || limit === undefined ? 10 : Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 500) return refuse(`--limit must be a whole number from 1 to 500, not ${forTerminal(limit)}`, null, { json });
  let brain;
  try { brain = readBrain(root); } catch (e) { return refuse(e.message, e.hint, { json }); }
  if (!brain) return refuse(`no brain here yet (${BRAIN_FILE})`, 'build it: `yad brain build`', { json });
  const matches = queryBrain(brain, text, { limit: n });
  if (json) return emitJSON({ query: text, matches });
  log(c.bold(`\nyad brain query ${forTerminal(text)}`));
  if (!matches.length) { info('no node matches'); return undefined; }
  for (const m of matches) {
    log(`\n${c.bold(forTerminal(m.node.label))}  ${c.dim(`${m.node.kind} · ${forTerminal(m.node.id)}`)}`);
    for (const x of m.neighbours) {
      const arrow = x.direction === 'out' ? '→' : '←';
      log(`  ${arrow} ${x.relation}${x.confidence === 'EXTRACTED' ? '' : c.dim(` (${x.confidence.toLowerCase()})`)}  ${forTerminal(x.node.label)} ${c.dim(x.node.kind)}`);
    }
  }
  return undefined;
}

function brainStatus(root, { json, runner, has }) {
  const version = graphifyVersionHere({ runner, has });
  const f = brainFreshness(root, { runner });
  if (json) return emitJSON({ file: BRAIN_FILE.split(path.sep).join('/'), ...f, graphify: version, vetted: GRAPHIFY_VERSION });
  log(c.bold('\nyad brain status'));
  if (f.state === 'current') ok(`${BRAIN_FILE} is current — ${f.counts?.nodes ?? 0} nodes, ${f.counts?.edges ?? 0} edges`);
  else if (f.state === 'missing') warn(`no brain here yet — build it: \`yad brain build\``);
  else if (f.state === 'unreadable') fail(f.why);
  else warn(`${BRAIN_FILE} is behind the files it is built from — run \`yad brain build\``);
  for (const r of f.repos) {
    const line = `${forTerminal(r.name)}: ${r.state === 'behind' ? `code graph built at ${r.builtAt?.slice(0, 7)}, the repo is at ${r.head?.slice(0, 7)} — run \`yad brain build\`` : r.state === 'current' ? `code graph current (${r.builtAt?.slice(0, 7) ?? 'no HEAD'})` : `${r.state} — ${forTerminal(r.why ?? '')}`}`;
    if (r.state === 'current') ok(line); else if (r.state === 'behind') warn(line); else info(line);
  }
  if (!version) info(`Graphify is not installed here (vetted: ${GRAPHIFY_VERSION}); the brain has the work items only`);
  else if (version !== GRAPHIFY_VERSION) warn(`Graphify ${forTerminal(version)} is installed; yadflow vetted ${GRAPHIFY_VERSION}`);
  return undefined;
}
