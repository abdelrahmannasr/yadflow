// `yad map` — the command (E181). The data is cli/map.mjs; the page is cli/map/view/; the locked-down
// server and the self-contained file are cli/local-page.mjs (shared with `yad brain view`).
//
//   yad map [--open]                 a local page on 127.0.0.1 with a one-time key, until Ctrl-C
//   yad map --html [<file>] [--open] one self-contained file, saved in the local reports folder (E180)
//   yad map --live [--open]          the local page, drawn again whenever the ledger or a repo's refs change
//   yad map --anonymous              every person as "Person A…": for sharing outside the team
//   yad map --fetch                  `git fetch origin` first in the Product and each code repo (download only)
//   yad map --json                   the model (or, with --html, what was written)
//
// WHAT MOVED: each map saved into the reports folder keeps a digest beside it (`<file>.digest.json`: each
// item's state, by id). The next map compares itself with the newest earlier one — named, never anonymous,
// so its ids are the real ones — and lights what changed.
import fs from 'node:fs';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { c, emitJSON, forTerminal, info, log, ok, refuse, warn } from './lib.mjs';
import { gatherMap, mapModel, digestOf } from './map.mjs';
import { TYPES, startPageServer, inlineSnapshot, writeOwnFile, trackedRisk } from './local-page.mjs';
import { saveReport, listReports, SIDE_SUFFIX } from './reports-dir.mjs';
import { openUrl } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEW_DIR = path.join(HERE, 'map', 'view');
const readView = (name) => fs.readFileSync(path.join(VIEW_DIR, name), 'utf8');
export const MAP_USAGE = 'usage: yad map [--open] [--live] [--anonymous] [--fetch] [--json]  |  yad map --html [<file>] [--anonymous] [--open]';

// The newest saved, named progress map's digest, or null.
export function previousDigest(root, { env = process.env, runner = spawnSync } = {}) {
  const r = listReports(root, { env, runner });
  if (r.problem) return null;
  for (const e of r.entries) {
    if (e.kind !== 'progress-map' || e.anonymous || !e.present) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(r.dir, `${e.file}${SIDE_SUFFIX}`), 'utf8'));
      if (d && typeof d.states === 'object' && d.states) return d;
    } catch { /* no digest beside it */ }
  }
  return null;
}

export function buildMap(root, { anonymous = false, fetch = false, env = process.env, runner = spawnSync, now = Date.now(), log: say = () => {} } = {}) {
  const g = gatherMap(root, { fetch, runner, now, log: say });
  const model = mapModel(g.inputs, { anonymous, previous: previousDigest(root, { env, runner }), now });
  return { model, problems: g.problems };
}

export function mapSnapshot(model) {
  return inlineSnapshot({ shell: readView('index.html'), scripts: [readView('app.js')], css: readView('style.css'), dataId: 'yad-map-data', data: model });
}

// The live stream: the Product's epics/ and .sdlc/, and each code repo's refs, watched while a page is open.
function mapStream(root, { heartbeat = 15000, debounce = 500, runner = spawnSync } = {}) {
  const clients = new Set();
  let watchers = [], timer = null;
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const send = (res, chunk) => { if (res.writableLength > 8 * 1024 * 1024) { res.destroy(); clients.delete(res); return; } res.write(chunk); };
  const changed = () => { clearTimeout(timer); timer = setTimeout(() => { for (const res of clients) send(res, frame('rebuilt', {})); }, debounce); timer.unref?.(); };
  // What to watch: the Product's record, and each code repo's refs (in its shared git folder, so a repo that
  // is a worktree — a `.git` FILE — is watched too).
  const watchPaths = () => {
    const out = [path.join(root, 'epics'), path.join(root, '.sdlc')];
    let reg = null;
    try { reg = JSON.parse(fs.readFileSync(path.join(root, '.sdlc', 'repos.json'), 'utf8')); } catch { /* none */ }
    for (const r of Array.isArray(reg?.repos) ? reg.repos : []) {
      if (!r || typeof r.path !== 'string') continue;
      const g = runner('git', ['-C', path.resolve(root, r.path), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
      if (g.status !== 0) continue;
      const common = String(g.stdout).trim();
      out.push(path.join(common, 'refs'), path.join(common, 'packed-refs'), path.join(common, 'FETCH_HEAD'));
    }
    return out.filter((p) => fs.existsSync(p));
  };
  // A recursive watch where the system has one (macOS, Windows, Linux on Node 20+); elsewhere each folder of
  // the record is watched on its own, three levels deep — enough for epics/<id>/{.sdlc,stories}/.
  const watchOne = (p) => {
    try { watchers.push(fs.watch(p, { persistent: false }, changed)); } catch { /* left out */ }
  };
  const watchTree = (p, depth) => {
    watchOne(p);
    if (depth <= 0) return;
    let kids = [];
    try { kids = fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { /* none */ }
    for (const d of kids) watchTree(path.join(p, d.name), depth - 1);
  };
  const start = () => {
    if (watchers.length) return;
    for (const p of watchPaths()) {
      let dir;
      try { dir = fs.statSync(p).isDirectory(); } catch { continue; }
      if (!dir) { watchOne(p); continue; }
      try { watchers.push(fs.watch(p, { recursive: true, persistent: false }, changed)); } catch { watchTree(p, 3); }
    }
    return watchers.length;
  };
  const stop = () => { for (const w of watchers) { try { w.close(); } catch { /* closed */ } } watchers = []; };
  const ping = setInterval(() => { for (const res of clients) send(res, ': ping\n\n'); }, heartbeat);
  ping.unref?.();
  return {
    path: '/events',
    attach(req, res, headers) {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const watching = start() ?? watchers.length;
      clients.add(res);
      res.write(frame('status', { live: watching > 0, watching }));
      req.on('close', () => { clients.delete(res); if (!clients.size) stop(); });
    },
    close() { clearInterval(ping); clearTimeout(timer); stop(); for (const res of clients) res.end(); clients.clear(); },
    // How much would be watched (for the person's line): a count, before any page has opened.
    canWatch: () => watchPaths().length,
  };
}

export function startMapServer(root, { anonymous = false, live = false, env = process.env, runner = spawnSync, host = '127.0.0.1', port = 0, heartbeat, debounce } = {}) {
  const stream = live ? mapStream(root, { heartbeat, debounce, runner }) : null;
  const routes = (token) => new Map([
    ['/', () => ({ type: TYPES.html, body: readView('index.html').replaceAll('__TOKEN__', token) })],
    ['/app.js', () => ({ type: TYPES.js, body: readView('app.js') })],
    ['/style.css', () => ({ type: TYPES.css, body: readView('style.css') })],
    ['/map.json', () => ({ type: TYPES.json, body: JSON.stringify(buildMap(root, { anonymous, env, runner }).model) })],
  ]);
  return startPageServer({ routes, stream, host, port, failText: 'the map could not be read' }).then((srv) => ({ ...srv, watchable: stream ? stream.canWatch() : null }));
}

const storiesState = (m) => `${m.summary.stories.shipped} of ${m.summary.stories.total} stories shipped`;

export async function runMap(root, { args = [], html = false, open = false, live = false, anonymous = false, fetch = false, json = false, env = process.env, runner = spawnSync, opener = openUrl, gitRunner = spawnSync, wait = true, now = Date.now() } = {}) {
  if (args.length > (html ? 1 : 0) || args.some((a) => String(a).startsWith('-'))) return refuse(`unexpected argument(s): ${args.map(forTerminal).join(' ')}`, MAP_USAGE, { json });
  if (html && live) return refuse('--html writes one file and --live keeps a page up to date — pick one', MAP_USAGE, { json });
  const say = json ? () => {} : (s) => info(s);
  let built;
  try { built = buildMap(root, { anonymous, fetch, env, runner, now, log: say }); } catch (e) { return refuse(`cannot read the map: ${forTerminal(String(e.message || e).split('\n')[0])}`, null, { json }); }
  const { model, problems } = built;
  for (const p of problems) warn(forTerminal(p));

  if (html) {
    const own = args.length === 1;
    let page;
    try { page = mapSnapshot(model); } catch (e) { return refuse(`cannot build the page: ${e.message}`, null, { json }); }
    let file, riskLine = null;
    if (own) {
      file = path.resolve(args[0]);
      const problem = writeOwnFile(file, page);
      if (problem) return refuse(problem, null, { json });
      if (trackedRisk(file, gitRunner)) riskLine = `${forTerminal(file)} is in a git work tree and not ignored: ${anonymous ? 'it is a picture of the work at one moment' : 'it holds the team\'s names'} — do not commit it`;
    } else {
      const saved = saveReport(root, { kind: 'progress-map', scope: 'all epics', state: anonymous ? `${storiesState(model)} anonymous` : storiesState(model), ext: 'html', content: page, command: `map --html${anonymous ? ' --anonymous' : ''}`, anonymous, env, runner, at: new Date(now) });
      if (saved.problem) return refuse(saved.problem, null, { json });
      file = saved.file;
      for (const w of saved.warnings) warn(w);
      // The digest beside a NAMED map, for the next one's "what moved".
      if (!anonymous) { try { fs.writeFileSync(`${file}${SIDE_SUFFIX}`, `${JSON.stringify(digestOf(model))}\n`, { flag: 'wx' }); } catch { /* the next map just shows nothing moved */ } }
    }
    if (riskLine) warn(riskLine);
    const opened = open ? opener(file) : null;
    if (json) return emitJSON({ file, epics: model.epics.length, stories: model.summary.stories.total, people: model.people.length, moved: model.moved.length, anonymous, ...(open ? { opened } : {}) });
    ok(`wrote ${forTerminal(file)} — ${model.epics.length} epics, ${storiesState(model)}, ${model.people.length} people${model.moved.length ? `, ${model.moved.length} moved since ${String(model.since).slice(0, 10)}` : ''}; it needs no server and no network`);
    if (!anonymous && model.people.length) info('it holds the team\'s names — pass --anonymous for a copy to share outside the team');
    if (opened === false) info('no browser opener was found here (open, xdg-open or explorer) — open the file yourself');
    return { file };
  }

  if (json && !open && !live) return emitJSON({ model });

  const s = await startMapServer(root, { anonymous, live, env, runner });
  const opened = open ? opener(s.url) : null;
  if (json) emitJSON({ url: s.url, port: s.port, live, anonymous, ...(open ? { opened } : {}) });
  else {
    log(c.bold(live ? '\nyad map --live' : '\nyad map'));
    ok(`the map is at ${s.url}`);
    info('only this machine can reach it, and only with that address (it holds a one-time key). Ctrl-C stops it.');
    info(live ? 'the page draws itself again when the ledger or a repo changes' : 'reload the page to read the record again');
    if (live && !s.watchable) warn('nothing here can be watched (no epics/, .sdlc/ or repo refs found), so the page will not change by itself — reload it instead');
    if (opened === false) info('no browser opener was found here (open, xdg-open or explorer) — copy the address into your browser');
  }
  if (!wait) return s;
  await new Promise((resolve) => {
    const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); s.close().then(resolve); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
  return undefined;
}

