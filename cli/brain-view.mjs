// `yad brain view` — a page that draws the project brain (E177).
//
// The brain (`.sdlc/brain/graph.json`, E176) is one graph of the code and the work. This draws it, two ways:
//
//   yad brain view [--open]                  a local server, until Ctrl-C
//   yad brain view --html [<file>] [--open]  one self-contained file (default: the local reports folder, E180)
//
// THE RULES, decided with the row:
//   1. ZERO DEPENDENCIES STILL. The server is `node:http`. The page draws with sigma.js, graphology and its
//      ForceAtlas2 layout, all MIT, VENDORED in cli/brain/vendor/ byte for byte from their npm tarballs
//      (cli/brain-vendor.mjs holds each one's licence, source and sha256). No CDN: the page works offline, and
//      no third party can change what it runs.
//   2. THE CLI'S FIRST HTTP SURFACE, SO IT IS LOCKED DOWN: bound to 127.0.0.1 on a random port; a random token
//      on every request; the Host header must be the address printed (no DNS rebinding — a web page that
//      points its own name at 127.0.0.1); GET and HEAD only; a fixed route table, so no request path ever
//      reaches the filesystem; a strict Content-Security-Policy, no CORS header, no-store, no-referrer.
//   3. THE LOGIC IS HERE, NOT IN THE PAGE. `viewModel` decides the layers, colours, sizes, the default view
//      and the filters, so the unit suite tests it; cli/brain/view/app.js only draws what it is given.
//   4. NAMES FROM THE CODE ARE DATA, NEVER MARKUP. The page writes every label with `textContent`; the file
//      written by --html escapes the JSON so no label can close its <script> tag.

import fs from 'node:fs';
import { setInterval, clearInterval } from 'node:timers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { c, emitJSON, forTerminal, info, log, ok, refuse, run, warn } from './lib.mjs';
import { BRAIN_FILE, codeBehind, readBrain } from './brain.mjs';
import { CSP, TYPES, startPageServer, inlineSnapshot, scriptSafeJSON, writeOwnFile, trackedRisk } from './local-page.mjs';
import { saveReport } from './reports-dir.mjs';
import { VENDORED } from './brain-vendor.mjs';
import { openUrl } from './report.mjs';
import { brandForPage } from './brand.mjs';
export { CSP, scriptSafeJSON };
import { activityIndex, activitySources, follow, matchEvent, planOf, readBacklog } from './brain-activity.mjs';
import { activityWanted } from './plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEW_DIR = path.join(HERE, 'brain', 'view');
const VENDOR_DIR = path.join(HERE, 'brain', 'vendor');

// Above this many nodes the page asks before drawing everything: a WebGL layout of tens of thousands of
// nodes can stall a laptop's browser for a minute.
export const WARN_ABOVE = 5000;

// ---- the view model ------------------------------------------------------------------------------

// The work layer is yadflow's own items; the code layer is the repos, their files and Graphify's symbols.
const WORK_KINDS = new Set(['epic', 'story', 'task', 'contract', 'surface', 'ship']);
export const KINDS = Object.freeze([
  // [kind, colour, layer, legend]
  ['epic', '#7c3aed', 'work', 'Epic'],
  ['story', '#2563eb', 'work', 'Story'],
  ['task', '#0891b2', 'work', 'Task'],
  ['contract', '#db2777', 'work', 'Contract'],
  ['surface', '#ea580c', 'work', 'Contract surface'],
  ['ship', '#16a34a', 'work', 'Ship (merged PR)'],
  ['repo', '#334155', 'code', 'Repo'],
  ['file', '#64748b', 'code', 'File'],
  ['code', '#94a3b8', 'code', 'Code symbol'],
]);
const KIND = new Map(KINDS.map(([k, colour, layer, legend]) => [k, { colour, layer, legend }]));
const OTHER = { colour: '#a8a29e', layer: 'code', legend: 'Other' };

// The edges a filter follows DOWN from an epic or a story: its parts, their declared files, and one hop of
// code from those files. `builds-in`, `touches` and `merged-into` are followed one step, to show the repo,
// never through it (a repo holds every file). `changes` points from a change-epic UP to its parent, so it is
// one step too: the parent is shown, never the parent's own tree (review 1).
const DOWN = new Set(['has-story', 'has-contract', 'has-task', 'declares-file', 'shipped-as', 'touches-surface', 'declares', 'mapped-to', 'handled-by', 'named-as']);
const ONE_STEP = new Set(['builds-in', 'touches', 'merged-into', 'defines', 'changes']);

// The edges by which the work names code: their targets are in the default view.
const LINKS_TO_CODE = new Set(['declares-file', 'mapped-to', 'handled-by', 'named-as']);

// The node fields the page shows, each a short string (a name from a file can be any length).
const SHOWN = ['label', 'repo', 'file', 'at', 'step', 'status', 'type', 'summary'];
const short = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' ? String(v) : null);

// What the page draws, from a brain read by `readBrain`:
//   { nodes: [{ id, kind, layer, colour, size, label, … , missing?, inDefault }], edges: [{ s, t, relation,
//     confidence }] (s and t are node indexes), legend, filters: { epics, stories, repos: [{ id, label, nodes }] },
//     counts, defaultCount, warnAbove, meta }
export function viewModel(brain, { codeBehind: behind = [], builtAt = null } = {}) {
  // One node per id: the first wins, as in the index. A brain yad wrote has no repeats; a hand-edited one
  // must not draw a second, unlinked copy (review 1).
  const seenIds = new Set();
  const nodes = (Array.isArray(brain?.nodes) ? brain.nodes : [])
    .filter((n) => n && typeof n.id === 'string' && !seenIds.has(n.id) && seenIds.add(n.id));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = [];
  const out = nodes.map(() => []);
  const inn = nodes.map(() => []);
  const degree = nodes.map(() => 0);
  for (const e of Array.isArray(brain?.edges) ? brain.edges : []) {
    const s = index.get(e?.source);
    const t = index.get(e?.target);
    if (s === undefined || t === undefined) continue;
    const relation = short(e.relation, 80) || 'related';
    const k = edges.push({ s, t, relation, confidence: e.confidence === 'EXTRACTED' ? 'EXTRACTED' : short(e.confidence, 20) || 'INFERRED' }) - 1;
    out[s].push(k); inn[t].push(k);
    degree[s] += 1; degree[t] += 1;
  }

  // The default view: the work layer, the repos, the files a task declares (or a surface maps to), and the
  // code those files define or a surface is handled by. Not every file a repo holds: that is the whole repo.
  const inDefault = nodes.map((n) => WORK_KINDS.has(n.kind) || n.kind === 'repo');
  for (const e of edges) {
    if (LINKS_TO_CODE.has(e.relation)) inDefault[e.t] = true;
  }
  for (const e of edges) if (e.relation === 'defines' && inDefault[e.s] && nodes[e.s].kind === 'file') inDefault[e.t] = true;

  const vnodes = nodes.map((n, i) => {
    const k = KIND.get(n.kind) || OTHER;
    const v = { id: n.id, kind: short(n.kind, 40) || 'other', layer: k.layer, colour: k.colour, size: Math.round((3 + Math.min(12, Math.sqrt(degree[i]) * 1.6)) * 10) / 10, inDefault: inDefault[i] };
    for (const f of SHOWN) { const x = short(n[f]); if (x !== null) v[f] = x; }
    if (v.label === undefined) v.label = n.id;
    if (n.missing === true) v.missing = true;
    return v;
  });

  // A filter's nodes: the root, everything DOWN from it, and one step along ONE_STEP from what was reached.
  const reach = (root) => {
    const seen = new Set([root]);
    const queue = [root];
    while (queue.length) {
      const i = queue.shift();
      for (const k of out[i]) {
        const e = edges[k];
        if (DOWN.has(e.relation) && !seen.has(e.t)) { seen.add(e.t); queue.push(e.t); }
      }
    }
    for (const i of [...seen]) for (const k of out[i]) if (ONE_STEP.has(edges[k].relation)) seen.add(edges[k].t);
    return [...seen].sort((a, b) => a - b);
  };
  const byLabel = (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  const list = (kind) => vnodes.map((n, i) => [n, i]).filter(([n]) => n.kind === kind);
  const filters = {
    epics: list('epic').map(([n, i]) => ({ id: n.id, label: n.label, nodes: reach(i) })).sort(byLabel),
    stories: list('story').map(([n, i]) => ({ id: n.id, label: n.label, nodes: reach(i) })).sort(byLabel),
    // A repo's filter: the repo, every node that names it, and the stories that build in it. Files and code
    // alike: the page's own "All the code" choice decides whether the ones the work does not name are drawn,
    // so a symbol is never drawn without the file that defines it (review 1).
    repos: list('repo').map(([n, i]) => {
      const set = new Set([i]);
      vnodes.forEach((m, j) => { if (m.repo === n.label) set.add(j); });
      for (const k of inn[i]) if (edges[k].relation === 'builds-in' || edges[k].relation === 'touches') set.add(edges[k].s);
      return { id: n.id, label: n.label, nodes: [...set].sort((a, b) => a - b) };
    }).sort(byLabel),
  };

  const used = new Set(vnodes.map((n) => n.kind));
  return {
    nodes: vnodes,
    edges,
    legend: [...KINDS.filter(([k]) => used.has(k)).map(([kind, colour, layer, legend]) => ({ kind, colour, layer, legend })),
      ...([...used].some((k) => !KIND.has(k)) ? [{ kind: 'other', ...OTHER }] : [])],
    filters,
    counts: { nodes: vnodes.length, edges: edges.length, work: vnodes.filter((n) => n.layer === 'work').length, code: vnodes.filter((n) => n.layer === 'code').length },
    defaultCount: inDefault.filter(Boolean).length,
    warnAbove: WARN_ABOVE,
    meta: { format: short(brain?.format, 40), inputs: short(brain?.inputs, 100), builtAt, codeBehind: behind.map((r) => short(r, 200)) },
  };
}

// ---- the page's files ----------------------------------------------------------------------------

const PAGE = Object.freeze({ html: 'index.html', js: 'app.js', css: 'style.css' });
// E178: the live view, "the Observatory" — its own page, script and style, served at the same three routes.
const LIVE_PAGE = Object.freeze({ html: 'live.html', js: 'live.js', css: 'live.css' });
const readView = (name) => fs.readFileSync(path.join(VIEW_DIR, name), 'utf8');
const readVendor = (file) => fs.readFileSync(path.join(VENDOR_DIR, file));

// The model for what is on disk now, or a refusal: { model } | { problem, hint }. The live view adds the plan
// (each task's declared files), for Plan vs reality.
function loadModel(root, runner, { live = false } = {}) {
  let brain;
  try { brain = readBrain(root); } catch (e) { return { problem: e.message, hint: e.hint }; }
  if (!brain) return { problem: `no brain here yet (${BRAIN_FILE})`, hint: 'build it: `yad brain build`' };
  let builtAt = null;
  try { builtAt = fs.statSync(path.join(root, BRAIN_FILE)).mtime.toISOString(); } catch { /* shown as unknown */ }
  const model = viewModel(brain, { codeBehind: codeBehind(root, brain, runner), builtAt });
  if (live) { model.plan = planOf(model); model.live = true; }
  return { model };
}

// ---- the server ----------------------------------------------------------------------------------

// ---- the live stream (E178) ----------------------------------------------------------------------

// The `/events` stream: Server-Sent Events, one way, from this machine's activity records to the page.
//   status    { activity, sources, brain } — whether the record is on, which repos are followed, which brain
//   backlog   [event…] — the recent past (readBacklog), so the timeline can replay at once
//   activity  one event — each new record, matched to the brain (matchEvent), as it lands
//   rebuilt   {} — the brain file changed since this page's model was read: its node numbers no longer hold
// EACH PAGE KEEPS THE MODEL IT CONNECTED WITH: events are matched against it, so a rebuild (or a second tab
// that loaded a newer brain) never sends a page node numbers from another model (E178 review 1). The files are
// followed only while a page is open, and a page that stops reading (its buffer passes 8 MB) is dropped.
function activityStream(root, { runner, heartbeat, interval }) {
  const clients = new Map(); // res -> { index, mtime, told }
  let followers = null;
  let sources = [];
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const send = (res, chunk) => {
    if (res.writableLength > 8 * 1024 * 1024) { res.destroy(); clients.delete(res); return; }
    res.write(chunk);
  };
  const brainMtime = () => { try { return fs.statSync(path.join(root, BRAIN_FILE)).mtimeMs; } catch { return null; } };
  const broadcast = (src, r) => {
    const mtime = brainMtime();
    for (const [res, c] of clients) {
      if (mtime !== c.mtime && !c.told) { c.told = true; send(res, frame('rebuilt', {})); }
      send(res, frame('activity', matchEvent(c.index, src, r)));
    }
  };
  const start = () => {
    if (followers) return;
    sources = activitySources(root, { runner });
    followers = sources.map((src) => follow(src, broadcast, { interval }));
  };
  const stop = () => { for (const f of followers || []) f.stop(); followers = null; };
  const ping = setInterval(() => { for (const res of clients.keys()) send(res, ': ping\n\n'); }, heartbeat);
  ping.unref?.();
  return {
    attach(req, res, headers) {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      start();
      // The model first (it asks git, so it is slow); then the pages already open get every line that landed
      // since the last look, so the files' read position is now; then this page's backlog at once — those
      // lines are in it once, and no later pump sends them again (E178 review 2).
      const mtime = brainMtime();
      const m = loadModel(root, runner, { live: true });
      const index = m.model ? activityIndex(m.model) : null;
      for (const f of followers) f.pump();
      res.write(frame('status', { activity: activityWanted(root), sources: sources.map((x) => x.repo ?? 'product'), brain: m.model?.meta.inputs ?? null }));
      const at = new Map(sources.map((src, i) => [src, followers[i].position()]));
      res.write(frame('backlog', index ? readBacklog(sources, { upTo: (src) => at.get(src) }).map(({ src, r }) => matchEvent(index, src, r)) : []));
      if (index) clients.set(res, { index, mtime, told: false });
      req.on('close', () => { clients.delete(res); if (!clients.size) stop(); });
      return undefined;
    },
    close() { clearInterval(ping); stop(); for (const res of clients.keys()) res.end(); clients.clear(); },
  };
}

// The recorded past, matched, for a replay file (`--html --live`).
function recordedReplay(root, model, runner) {
  const index = activityIndex(model);
  return readBacklog(activitySources(root, { runner })).map(({ src, r }) => matchEvent(index, src, r));
}

// Start the viewer's server: { url, token, port, close() }. `root` is the Product.
export function startBrainServer(root, { runner = run, host = '127.0.0.1', port = 0, live = false, heartbeat = 15000, interval = 500 } = {}) {
  const page = live ? LIVE_PAGE : PAGE;
  const stream = live ? activityStream(root, { runner, heartbeat, interval }) : null;
  // The route table: a request path is only ever a KEY here. Nothing it says reaches the filesystem.
  const routes = (token) => new Map([
    ['/', () => ({ type: TYPES.html, body: readView(page.html).replaceAll('__TOKEN__', token) })],
    ['/app.js', () => ({ type: TYPES.js, body: readView(page.js) })],
    ['/style.css', () => ({ type: TYPES.css, body: `${readView(page.css)}\n${brandForPage(root, live ? 'live' : 'brain').css}` })],
    ['/graph.json', () => {
      const m = loadModel(root, runner, { live });
      return m.model
        ? { type: TYPES.json, body: JSON.stringify(m.model) }
        : { status: 404, type: TYPES.json, body: JSON.stringify({ error: m.problem, hint: m.hint }) };
    }],
    ...VENDORED.map((v) => [`/vendor/${v.file}`, () => ({ type: TYPES.js, body: readVendor(v.file) })]),
  ]);
  // E178: the live stream — Server-Sent Events, one way, read-only, behind the same key and Host check.
  return startPageServer({ routes, stream: stream && { path: '/events', attach: stream.attach, close: stream.close }, host, port, failText: 'the viewer could not read its files' });
}

// ---- the self-contained file ---------------------------------------------------------------------

// One HTML file with everything inline, and a CSP that allows exactly the inline blocks it holds (by hash)
// and no network at all (cli/local-page.mjs).
export function snapshotHTML(model, { live = false, brandCss = '' } = {}) {
  const page = live ? LIVE_PAGE : PAGE;
  const scripts = [...VENDORED.map((v) => readVendor(v.file).toString('utf8')), readView(page.js)];
  return inlineSnapshot({ shell: readView(page.html), scripts, css: `${readView(page.css)}\n${brandCss}`, dataId: 'yad-brain-data', data: model });
}

// ---- the command ---------------------------------------------------------------------------------

export const VIEW_USAGE = 'usage: yad brain view [--live] [--open]  |  yad brain view --html [<file>] [--live] [--open]   (--json prints what was done)';

export async function runBrainView(root, { args = [], html = false, open = false, live = false, json = false, runner = run, opener = openUrl, gitRunner = spawnSync, wait = true, env = process.env } = {}) {
  if (args.length > (html ? 1 : 0) || args.some((a) => String(a).startsWith('-'))) {
    return refuse(`unexpected argument(s): ${args.map(forTerminal).join(' ')}`, VIEW_USAGE, { json });
  }
  const m = loadModel(root, runner, { live });
  if (!m.model) return refuse(m.problem, m.hint, { json });
  const behind = m.model.meta.codeBehind;
  const behindLine = behind.length ? `the code moved in ${behind.join(', ')} since the brain was built — run \`yad brain build\` for a current picture` : null;

  if (html) {
    const own = args.length === 1;
    let file = own ? path.resolve(args[0]) : null;
    // E178: `--live` with `--html` is a REPLAY file — the recorded activity embedded, played back offline.
    if (live) m.model.replay = recordedReplay(root, m.model, runner);
    let page;
    try { page = snapshotHTML(m.model, { live, brandCss: brandForPage(root, live ? 'live' : 'brain').css }); } catch (e) { return refuse(`cannot build the page: ${e.message}`, null, { json }); }
    const saveWarnings = [];
    if (own) {
      const problem = writeOwnFile(file, page);
      if (problem) return refuse(problem, null, { json });
    } else {
      // E180: saved in the local reports folder beside the Product, named by what it shows.
      const saved = saveReport(root, { kind: 'brain-view', scope: live ? 'live replay' : 'code and work', state: `${m.model.counts.nodes} nodes`, ext: 'html', content: page, command: live ? 'brain view --html --live' : 'brain view --html', env });
      if (saved.problem) return refuse(saved.problem, null, { json });
      file = saved.file;
      saveWarnings.push(...saved.warnings);
    }
    const risk = own && trackedRisk(file, gitRunner);
    const riskLine = risk ? `${forTerminal(file)} is in a git work tree and not ignored: it holds the names in your code — do not commit it` : null;
    const opened = open ? opener(file) : null;
    const events = live ? { events: m.model.replay.length } : {};
    if (json) return emitJSON({ file, nodes: m.model.counts.nodes, edges: m.model.counts.edges, ...events, codeBehind: behind, ...(open ? { opened } : {}), ...(riskLine ? { warning: riskLine } : {}), ...(saveWarnings.length ? { warnings: saveWarnings } : {}) });
    for (const w of saveWarnings) warn(w);
    ok(`wrote ${forTerminal(file)} — ${m.model.counts.nodes} nodes, ${m.model.counts.edges} edges${live ? `, ${m.model.replay.length} recorded events to replay` : ''}; open it in a browser (it needs no server and no network)`);
    if (behindLine) warn(behindLine);
    if (riskLine) warn(riskLine);
    if (opened === false) info('no browser opener was found here (open, xdg-open or explorer) — open the file yourself');
    return undefined;
  }

  const s = await startBrainServer(root, { runner, live });
  const opened = open ? opener(s.url) : null;
  if (json) emitJSON({ url: s.url, port: s.port, nodes: m.model.counts.nodes, edges: m.model.counts.edges, codeBehind: behind, ...(open ? { opened } : {}) });
  else {
    log(c.bold(live ? '\nyad brain view --live' : '\nyad brain view'));
    ok(`the brain is at ${s.url}`);
    if (live && !activityWanted(root)) warn('the live activity record is off, so nothing the agent does will show — set `"activity": true` in the Product config, then `yad check --fix`');
    info('only this machine can reach it, and only with that address (it holds a one-time key). Ctrl-C stops it.');
    info('reload the page after `yad brain build` to see the new graph');
    if (opened === false) info('no browser opener was found here (open, xdg-open or explorer) — copy the address into your browser');
    if (behindLine) warn(behindLine);
  }
  if (!wait) return s;
  await new Promise((resolve) => {
    const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); s.close().then(resolve); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
  return undefined;
}
