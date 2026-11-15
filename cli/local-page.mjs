// A page served to this machine only, or written as one self-contained file (E177, shared since E181).
//
// `yad brain view` (E177) and `yad map` (E181) both draw a page in the person's browser. The rules that keep
// that page safe live here, once:
//   - the server binds 127.0.0.1 on a random port; every request needs the one-time key (`?t=`), compared in
//     constant time; the Host header must be the address printed (no DNS rebinding); GET and HEAD only; a
//     fixed route table, so no request path ever reaches the filesystem; strict headers (CSP, no-store,
//     no-referrer, no framing);
//   - the self-contained file holds every script and style inline, allowed by their hashes and nothing else,
//     with the data in a `<script type="application/json">` that no name can close;
//   - a file the person names is written by a temp file and a rename, never through a link, and a warning
//     says when it sits in a git work tree that does not ignore it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writePlain } from './brain.mjs';

export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const BASE_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
});
export const TYPES = Object.freeze({ html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8' });

// Is `given` the token? A length check first: `timingSafeEqual` throws on buffers of different lengths.
export function tokenMatches(given, token) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Start a locked-down page server: { url, token, port, host, server, close() }.
//   routes(token) → Map(pathname → () => { type, body, status? })   — a request path is only ever a KEY.
//   stream        optional { path, attach(req, res, headers), close() } — a one-way event stream (SSE).
export function startPageServer({ routes, stream = null, host = '127.0.0.1', port = 0, failText = 'the page could not read its files' }) {
  const token = randomBytes(24).toString('hex');
  const table = routes(token);
  let expectedHost = null;
  const server = http.createServer((req, res) => {
    const send = (status, type, body, extra = {}) => {
      res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const text = (status, msg, extra) => send(status, 'text/plain; charset=utf-8', `${msg}\n`, extra);
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'method not allowed', { Allow: 'GET, HEAD' });
    if (req.headers.host !== expectedHost) return text(403, 'forbidden');
    let url;
    try { url = new URL(req.url, `http://${expectedHost}`); } catch { return text(400, 'bad request'); }
    if (!tokenMatches(url.searchParams.get('t'), token)) return text(403, 'forbidden');
    if (stream && url.pathname === (stream.path || '/events') && req.method === 'GET') return stream.attach(req, res, BASE_HEADERS);
    const route = table.get(url.pathname);
    if (!route) return text(404, 'not found');
    try {
      const r = route();
      return send(r.status || 200, r.type, r.body);
    } catch {
      return text(500, failText);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const a = server.address();
      expectedHost = `${host}:${a.port}`;
      resolve({
        url: `http://${expectedHost}/?t=${token}`, token, port: a.port, host, server,
        close: () => new Promise((done) => { stream?.close(); server.closeAllConnections?.(); server.close(() => done()); }),
      });
    });
  });
}

// JSON that can sit inside a <script> element: nothing in it can end the element or start a comment.
export const scriptSafeJSON = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

export const SERVED_START = '<!--SERVED:start-->';
export const SERVED_END = '<!--SERVED:end-->';

// One HTML file with everything inline, and a CSP that allows exactly the inline blocks it holds (by hash)
// and no network at all. `shell` is the served page: its `<script src>` tags sit between the SERVED markers
// and are cut out by them (never by matching HTML with a pattern), its stylesheet link becomes a <style>, and
// `<!--SCRIPTS-->` becomes the data block followed by each script.
export function inlineSnapshot({ shell, scripts, css, dataId, data }) {
  // A script's own text must not hold `</script`, or the file would end it early: checked here, so a future
  // file that holds one fails loudly instead of breaking the page.
  for (const s of scripts) if (/<\/script/i.test(s)) throw new Error('an inline script holds </script');
  const csp = [
    "default-src 'none'",
    `script-src ${scripts.map((s) => `'sha256-${sha256b64(s)}'`).join(' ')}`,
    `style-src 'sha256-${sha256b64(css)}'`,
    "img-src data:", "font-src data:", "base-uri 'none'", "form-action 'none'",
  ].join('; ');
  // The key placeholder goes before anything is spliced in: the data's own names may hold the same text.
  const page = shell.replaceAll('__TOKEN__', '');
  const from = page.indexOf(SERVED_START);
  const to = page.indexOf(SERVED_END);
  if (from < 0 || to < from) throw new Error(`the page has no ${SERVED_START} … ${SERVED_END} block`);
  const body = (page.slice(0, from) + page.slice(to + SERVED_END.length))
    .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`)
    .replace('<!--SCRIPTS-->', () => [
      `<script type="application/json" id="${dataId}">${scriptSafeJSON(data)}</script>`,
      ...scripts.map((s) => `<script>${s}</script>`),
    ].join('\n'));
  return body
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`);
}

// Write `data` to the path the person named, by a temp file and a rename, refusing a link at the target (a
// rename replaces a link, but a person who put one there means the file it points at). → null | problem
export function writeOwnFile(file, data) {
  let st = null;
  try { st = fs.lstatSync(file); } catch { /* new file */ }
  if (st && !st.isFile()) return `${file} is not a plain file (a link or a folder) — name another path`;
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) return `the folder ${dir} does not exist`;
  writePlain(dir, path.basename(file), data);
  return null;
}

// Is `file` inside a git work tree, and NOT ignored there? Then committing it is one `git add .` away.
export function trackedRisk(file, runner = spawnSync) {
  const dir = path.dirname(file);
  const inTree = runner('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inTree.status !== 0 || String(inTree.stdout).trim() !== 'true') return false;
  const ignored = runner('git', ['-C', dir, 'check-ignore', '-q', '--', path.basename(file)], { encoding: 'utf8' });
  return ignored.status === 1;
}
