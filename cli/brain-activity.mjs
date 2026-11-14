// The live activity record, read back for `yad brain view --live` (E178).
//
// The hook (skills/yad-checks/templates/hooks/yad-activity.mjs) appends one line per agent tool call to each
// repo's `<git common dir>/yad-activity.jsonl`: the Product's, and each cloned code repo's. This module finds
// those files, reads them (a backlog for replay, then each new line as it lands, through a rotation), and
// MATCHES each event to the brain's nodes — here, in Node, where the unit suite reaches it; the page only
// draws what it is sent.
//
// A line is DATA from a file anything on the machine can write: it is read field by field against the
// hook's own shape, and anything else in it is dropped.

import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { run } from './lib.mjs';
import { brainRepos } from './brain.mjs';
import { readRegistry } from './workspace.mjs';

export const LOG_NAME = 'yad-activity.jsonl';
export const OLD_LOG_NAME = 'yad-activity.1.jsonl';
export const KEEP_DAYS = 14;
export const BACKLOG_LIMIT = 20000;
const OPS = new Set(['read', 'search', 'edit', 'run']);
const posix = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

// ---- where the records are -----------------------------------------------------------------------

// Does the repo above `dir` track anything under it? One file is the answer: a big folder's full list
// overflows the small buffer, and that is a yes (E178 review 3). Shared with yad doctor.
export function tracksHere(dir, runner = run) {
  const r = runner('git', ['-C', dir, 'ls-files', '-z', '--', '.'], { maxBuffer: 4096 });
  return !!r.stdout && (r.ok || r.error?.code === 'ENOBUFS');
}

// The folder git keeps a repo's shared data in, or null. A folder with no `.git` of its own counts only when
// the repo above it tracks files under it — the hook's own rule, so both look in the same place.
function commonDir(dir, runner) {
  if (!fs.existsSync(path.join(dir, '.git')) && !tracksHere(dir, runner)) return null;
  const r = runner('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  return r.ok && r.stdout && path.isAbsolute(r.stdout) ? r.stdout : null;
}

// One source per repo that has a git folder: the Product (repo null) and each code repo cloned here. `prefix`
// is a code repo's folder inside the Product, for a Product session that edits it from there.
export function activitySources(root, { runner = run } = {}) {
  const out = [];
  const productDir = commonDir(root, runner);
  const { registry } = readRegistry(root);
  const { usable } = brainRepos(root, registry);
  const prefixes = [];
  for (const r of usable) {
    const rel = posix(path.relative(root, r.target));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) prefixes.push({ repo: r.name, prefix: `${rel}/` });
  }
  if (productDir) out.push({ repo: null, dir: productDir, prefixes });
  for (const r of usable) {
    const d = commonDir(r.target, runner);
    if (d && d !== productDir) out.push({ repo: r.name, dir: d, prefixes: [] });
  }
  return out;
}

// ---- reading lines -------------------------------------------------------------------------------

// One record from one line, in the hook's shape, or null. Nothing beyond the hook's fields is kept.
export function parseRecord(line) {
  let r;
  try { r = JSON.parse(line); } catch { return null; }
  if (!r || typeof r !== 'object' || Array.isArray(r) || r.v !== 1 || !OPS.has(r.op)) return null;
  const t = Date.parse(r.ts);
  if (!Number.isFinite(t)) return null;
  const paths = Array.isArray(r.paths) ? r.paths.filter((p) => typeof p === 'string' && p && p.length <= 1024 && !p.startsWith('/') && !p.split('/').includes('..')).slice(0, 20) : [];
  return {
    t,
    op: r.op,
    s: typeof r.s === 'string' && /^[0-9a-f]{12}$/.test(r.s) ? r.s : null,
    h: r.h === 'cursor' ? 'cursor' : 'claude',
    tool: typeof r.tool === 'string' ? r.tool.slice(0, 40) : null,
    paths,
    ...(typeof r.yad === 'string' && /^[a-z][a-z-]*( [a-z][a-z-]*)?$/.test(r.yad) ? { yad: r.yad } : {}),
  };
}

// A log is read only when it is a PLAIN FILE: a link could point the reader at any file, and a FIFO would
// block it for ever (E178 review 1). The size is read from the open file itself.
const MAX_READ = 8 * 1024 * 1024;
const MAX_PART = 64 * 1024;
function openPlain(file) {
  try { if (!fs.lstatSync(file).isFile()) return null; } catch { return null; }
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { fs.closeSync(fd); return null; }
    return { fd, st };
  } catch { if (fd !== undefined) fs.closeSync(fd); return null; }
}

// The last MAX_READ bytes of a plain file, from its first whole line; '' for anything else.
// With `upTo` ({ ino, offset } of the live reader), the file is read only up to there — and not at all when it
// is not the file the reader stands in (rotated in between, or made since): the reader sends all of it.
function readTail(file, upTo = null) {
  const o = openPlain(file);
  if (!o) return '';
  try {
    if (upTo !== null && upTo.ino && upTo.ino !== o.st.ino) return '';
    const end = upTo === null ? o.st.size : Math.min(o.st.size, upTo.offset);
    const from = Math.max(0, end - MAX_READ);
    const buf = Buffer.alloc(end - from);
    const got = fs.readSync(o.fd, buf, 0, buf.length, from);
    const text = buf.subarray(0, got).toString('utf8');
    return from === 0 ? text : text.slice(text.indexOf('\n') + 1);
  } catch { return ''; } finally { fs.closeSync(o.fd); }
}

// The recent past, for replay: every source's old and current file, newest KEEP_DAYS, oldest first, at most
// `limit` events (the newest ones).
// Is the old file the one the live reader stood in? Only when file numbers can be trusted: a file system that
// gives every file 0 (FAT, exFAT, some network shares) or the same number to two files (a 64-bit NTFS id past
// what a JavaScript number holds) cannot tell — then the old file is read whole (E178 review 5).
const oldIs = (src, at) => {
  if (!at || !at.ino) return false;
  try {
    const old = fs.lstatSync(path.join(src.dir, OLD_LOG_NAME)).ino;
    let cur = null;
    try { cur = fs.lstatSync(path.join(src.dir, LOG_NAME)).ino; } catch { /* no current file */ }
    return old === at.ino && old !== cur;
  } catch { return false; }
};
// `upTo(src)` gives where the live reader of a source stands ({ ino, offset }): the current file is read only
// up to there, so a line is either in the backlog or sent live, never both (E178 review 3).
export function readBacklog(sources, { now = Date.now(), days = KEEP_DAYS, limit = BACKLOG_LIMIT, upTo = () => null } = {}) {
  const since = now - days * 86400000;
  const all = [];
  for (const src of sources) {
    // The CURRENT file first: a rotation between the two reads then repeats a line (it is in both) rather than
    // losing one (in neither) (E178 review 5).
    for (const name of [LOG_NAME, OLD_LOG_NAME]) {
      // The current file stops at the reader. The OLD file does too when it is the one the reader stood in
      // (rotated since): its tail is the reader's to send at its next look (E178 review 4).
      const at = upTo(src);
      const cut = at === null ? null : name === LOG_NAME ? at : (oldIs(src, at) ? at : null);
      for (const line of readTail(path.join(src.dir, name), cut).split('\n')) {
        const r = line ? parseRecord(line) : null;
        if (r && r.t >= since && r.t <= now + 60000) all.push({ src, r });
      }
    }
  }
  all.sort((a, b) => a.r.t - b.r.t);
  return all.slice(-limit);
}

// Follow one source's current file: `onRecord(src, record)` for each whole new line. It starts at the end
// (the backlog has the rest). ITS LIMIT: a rotation is caught only while the renamed file is the one last read
// and at most 4 MB behind; rotated twice between two looks (half a second apart, 5 MB a file), or looked at in
// the instant between the rename and the next write, the old file's unread tail is not sent live — it is still
// in the backlog of the next page that opens (E178 review 2). At a rotation it first reads what the old file gained since the last look (now
// renamed aside), then starts the new file at 0. Bytes are decoded as a stream, so a character split across
// two reads arrives whole; a part line longer than MAX_PART (no newline ever comes) is dropped. Returns
// { stop, pump, position }.
export function follow(src, onRecord, { interval = 500, watch = fs.watchFile, unwatch = fs.unwatchFile } = {}) {
  const file = path.join(src.dir, LOG_NAME);
  let offset = 0;
  let ino = null;
  let rest = '';
  let decoder = new StringDecoder('utf8');
  const first = openPlain(file);
  if (first) { offset = first.st.size; ino = first.st.ino; fs.closeSync(first.fd); }
  const take = (text) => {
    const lines = (rest + text).split('\n');
    rest = lines.pop();
    if (rest.length > MAX_PART) rest = '';
    for (const line of lines) { const r = line ? parseRecord(line) : null; if (r) onRecord(src, r); }
  };
  // Read `o` from `offset` to its end, at most 4 MB a tick.
  const drain = (o) => {
    const len = Math.min(o.st.size - offset, 4 * 1024 * 1024);
    if (len <= 0) return;
    const buf = Buffer.alloc(len);
    const got = fs.readSync(o.fd, buf, 0, len, offset);
    offset += got;
    take(decoder.write(buf.subarray(0, got)));
  };
  const pump = () => {
    const o = openPlain(file);
    if (!o) { offset = 0; ino = null; rest = ''; decoder = new StringDecoder('utf8'); return; }
    try {
      if (ino !== null && o.st.ino !== ino) {
        // Rotated: the old file is the renamed one when its inode is the one we were reading.
        const old = openPlain(path.join(src.dir, OLD_LOG_NAME));
        if (old) { try { if (old.st.ino === ino) drain(old); } catch { /* lost, as a rotation may lose a line */ } finally { fs.closeSync(old.fd); } }
        offset = 0; rest = ''; decoder = new StringDecoder('utf8');
      } else if (o.st.size < offset) { offset = 0; rest = ''; decoder = new StringDecoder('utf8'); }
      ino = o.st.ino;
      drain(o);
    } catch { /* read again on the next tick */ } finally { fs.closeSync(o.fd); }
  };
  watch(file, { interval, persistent: false }, pump);
  // Where this reader stands: the backlog of a page that opens now stops here.
  const position = () => (ino === null ? { ino: -1, offset: 0 } : { ino, offset: offset - Buffer.byteLength(rest) });
  return { stop: () => unwatch(file, pump), pump, position };
}

// ---- matching events to the brain ----------------------------------------------------------------

// What the matcher needs from the view model: each file node by repo and path, the code a file defines, and
// each Product work file's node.
export function activityIndex(model) {
  const byId = new Map(model.nodes.map((n, i) => [n.id, i]));
  // Each repo's file nodes by path, for a search of a folder.
  const files = new Map();
  model.nodes.forEach((n, i) => {
    const m = /^file:([^:]+):(.+)$/.exec(n.id);
    if (!m) return;
    if (!files.has(m[1])) files.set(m[1], []);
    files.get(m[1]).push([m[2], i]);
  });
  const defines = new Map();
  for (const e of model.edges) {
    if (e.relation !== 'defines') continue;
    if (!defines.has(e.s)) defines.set(e.s, []);
    defines.get(e.s).push(e.t);
  }
  return { byId, defines, files };
}
export const AREA_LIMIT = 24;

// The brain's nodes for one Product path: a story file is its story, a contract its contract, anything else
// under an epic's folder the epic.
function productNode(index, p) {
  const m = /^epics\/([^/]+)\/(.*)$/.exec(p);
  if (!m) return null;
  const [, epic, inner] = m;
  const story = /^stories\/([^/]+)\.md$/.exec(inner);
  if (story && index.byId.has(`story:${story[1]}`)) return index.byId.get(`story:${story[1]}`);
  if (inner === 'contract.md' && index.byId.has(`contract:${epic}`)) return index.byId.get(`contract:${epic}`);
  return index.byId.get(`epic:${epic}`) ?? null;
}

// One event, as the page draws it: { t, op, s, h, tool, yad?, repo, hits: [{ path, node, code: [indexes] }],
// areas: [{ path, nodes: [indexes] }], outside: [path] }. `node` is the file (or work item) the comet flies to;
// `code` is what that file defines (at most 8), lit with it. A FOLDER (a search's scope) is an area: the files
// under it, at most AREA_LIMIT, lit softly; a path that is neither is outside the brain.
export function matchEvent(index, src, r) {
  const hits = [];
  const areas = [];
  const outside = [];
  for (const raw of r.paths) {
    let repo = src.repo;
    let p = raw;
    if (repo === null) {
      const pre = src.prefixes.find((x) => raw.startsWith(x.prefix));
      if (pre) { repo = pre.repo; p = raw.slice(pre.prefix.length); }
    }
    const node = repo === null ? productNode(index, p) : index.byId.get(`file:${repo}:${p}`) ?? null;
    const shown = repo === null ? p : `${repo}/${p}`;
    if (node === null) {
      const under = repo === null ? [] : (index.files.get(repo) || []).filter(([f]) => f.startsWith(`${p.replace(/\/$/, '')}/`)).map(([, i]) => i);
      if (under.length) areas.push({ path: shown, nodes: under.slice(0, AREA_LIMIT) });
      else outside.push(shown);
      continue;
    }
    hits.push({ path: shown, node, code: (index.defines.get(node) || []).slice(0, 8) });
  }
  return { t: r.t, op: r.op, s: r.s, h: r.h, tool: r.tool, ...(r.yad ? { yad: r.yad } : {}), repo: src.repo, hits, areas, outside };
}

// ---- the plan --------------------------------------------------------------------------------------

// Each task and the files it declares, for Plan vs reality: [{ task, story, files: [indexes] }], from the
// `has-task` and `declares-file` edges.
export function planOf(model) {
  const storyOf = new Map();
  const files = new Map();
  for (const e of model.edges) {
    if (e.relation === 'has-task') storyOf.set(e.t, e.s);
    if (e.relation === 'declares-file') { if (!files.has(e.s)) files.set(e.s, []); files.get(e.s).push(e.t); }
  }
  return model.nodes.map((n, i) => [n, i]).filter(([n]) => n.kind === 'task')
    .map(([, i]) => ({ task: i, story: storyOf.has(i) ? storyOf.get(i) : null, files: files.get(i) || [] }));
}
