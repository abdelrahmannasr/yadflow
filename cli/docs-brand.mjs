// `yad docs brand <site>` — a generated doc site wears the Product's brand (E186).
//
// A site made from the doc template (skills/yad-docs/templates/app, 0.0.7 and later) keeps three places for
// the brand, and this writes only there:
//
//   src/index.css      the block between `/* yad-brand:begin */` and `/* yad-brand:end */` (the last thing in
//                      the file, outside every layer, so it wins over the template's dark and light looks)
//   index.html         the block between `<!-- yad-brand:head:begin -->` and `<!-- yad-brand:head:end -->`
//                      (the favicon, and the Space Grotesk / Noto Sans link the brand's own fonts replace)
//   src/data/brand.ts  the name and mark the top bar shows
//
// The brand is read as every other page reads it (`readBrand`): with no brand file, or one with problems,
// the site gets yadflow's look back (the template's own blocks), and the problems are said. The same brand
// always writes the same bytes, so a site's staleness hash only moves when the brand does.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readBrand, brandAssets, brandPath, contrast, DATA_IMAGE_RE, BRAND_FILE } from './brand.mjs';
import { c, log, ok, warn, info, refuse, emitJSON, forTerminal } from './lib.mjs';

export const CSS_BEGIN = '/* yad-brand:begin */';
export const CSS_END = '/* yad-brand:end */';
export const HEAD_BEGIN = '<!-- yad-brand:head:begin -->';
export const HEAD_END = '<!-- yad-brand:head:end -->';

// The template's own head block: yadflow's icon and the two fonts the template is drawn in.
export const TEMPLATE_HEAD = [
  '    <link rel="icon" type="image/png" href="/yadflow-icon.png" />',
  '    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Noto+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />',
];
export const TEMPLATE_BRAND_TS = `// The brand the site shows in its top bar. \`yad docs brand <site>\` rewrites this file from the Product's
// .sdlc/brand.json: \`name\` is the brand's name, and \`mark\` its mark (or logo) as a data: image. With
// \`mark: null\` the top bar shows yadflow's icon.
export const brand: { name: string; mark: string | null } = { name: 'yadflow', mark: null };
`;

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const stack = (f, system) => `"${f.family}", ${system}`;
const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

// Text on a solid primary fill (a button): white, unless a near-black reads better on this primary. A light
// primary is common in a dark look, where yadflow makes the brand's primary lighter. A colour yadflow cannot
// read (hsl(), oklab()) keeps white.
export function onPrimary(primary) {
  const white = contrast('#ffffff', primary);
  const ink = contrast('#111111', primary);
  return white !== null && ink !== null && ink > white ? '#111111' : '#ffffff';
}

// One look's variables, from its seven roles. Every other colour the template uses is mixed from them with a
// fixed share, so any colour form the brand allows works (hex, rgb(), hsl(), oklch(), oklab()), and the
// result never depends on yadflow reading the colour. "Toward the text" is lighter in the dark look and darker
// in the light one, so the same rule makes a hover, a raised surface or a stronger border in both.
function lookVars(r) {
  return [
    ['--color-bg-primary', r.bg],
    ['--color-bg-secondary', r.surface],
    ['--color-bg-tertiary', mix(r.surface, 88, r.text)],
    ['--color-bg-brand-soft', mix(r.primary, 15, r.bg)],
    ['--color-bg-accent-soft', mix(r.accent, 15, r.bg)],
    ['--color-surface-dark', r.surface],
    ['--color-surface-highlight', mix(r.surface, 88, r.text)],
    ['--color-surface-darker', mix(r.bg, 50, r.surface)],
    ['--color-text-primary', r.text],
    ['--color-text-secondary', mix(r.text, 55, r.muted)],
    ['--color-text-muted', r.muted],
    ['--color-primary', r.primary],
    ['--color-primary-hover', mix(r.primary, 80, r.text)],
    ['--color-primary-soft', mix(r.primary, 25, r.bg)],
    ['--color-accent', r.accent],
    ['--color-accent-hover', mix(r.accent, 80, r.text)],
    ['--color-accent-soft', mix(r.accent, 25, r.bg)],
    ['--color-border-light', mix(r.border, 75, r.text)],
    ['--color-border-default', r.border],
    ['--color-border-strong', mix(r.border, 60, r.text)],
    ['--color-ink', r.text],
    ['--color-scroll-thumb', mix(r.border, 75, r.text)],
    ['--color-scroll-thumb-hover', mix(r.border, 55, r.text)],
    ['--color-canvas', mix(r.bg, 50, r.surface)],
    ['--color-on-primary', onPrimary(r.primary)],
    // The Tailwind colours the components use for text follow the brand's text, in both looks.
    ['--color-white', 'var(--color-text-primary)'],
    ['--color-slate-100', 'var(--color-text-primary)'],
    ['--color-slate-200', 'var(--color-text-primary)'],
    ['--color-slate-300', 'var(--color-text-secondary)'],
    ['--color-slate-400', 'var(--color-text-secondary)'],
    ['--color-slate-500', 'var(--color-text-muted)'],
    ['--color-slate-600', 'var(--color-text-muted)'],
  ].map(([k, v]) => `  ${k}: ${v};`).join('\n');
}

// The brand a site wears, as one fingerprint: brand.json and every logo, mark and font file it names (E186).
// `yad docs brand` writes it at the top of the site's brand block, and `yad docs sync` compares it with the
// Product's brand now, so a changed brand makes the site stale. → 'sha256:…', or null when the Product's
// brand cannot be worn (no file, or one with problems): the site wears yadflow's look.
// BRAND_BLOCK_VERSION is part of it: when a later yadflow writes the block differently (another mapping),
// every branded site reads as stale once, and a refresh writes it again.
export const BRAND_BLOCK_VERSION = 1;
export function brandFingerprint(root, r = readBrand(root)) {
  if (r.origin !== 'product') return null;
  const b = r.brand;
  const named = [b.logo, b.mark, ...['heading', 'body', 'mono'].flatMap((s) => b.fonts?.[s]?.files || [])].filter(Boolean);
  const h = createHash('sha256');
  h.update(`yad-brand-block:${BRAND_BLOCK_VERSION}\n`);
  for (const rel of [BRAND_FILE, ...[...new Set(named)].sort()]) {
    const full = rel === BRAND_FILE ? path.join(root, BRAND_FILE) : brandPath(root, rel);
    let buf;
    try { buf = fs.readFileSync(full); } catch { buf = Buffer.alloc(0); }
    h.update(`${rel}:${buf.length}\n`);
    h.update(buf);
  }
  return `sha256:${h.digest('hex')}`;
}

const FINGERPRINT_RE = /^\/\* yad-brand:fingerprint (sha256:[0-9a-f]{64}) \*\/$/m;
// The fingerprint a site's index.css records. → 'sha256:…'; null when its brand block holds none (yadflow's
// look); undefined when the file has no brand block (a site made before 0.0.7: nothing to compare).
export function siteBrandFingerprint(css) {
  if (typeof css !== 'string') return undefined;
  const a = css.indexOf(CSS_BEGIN);
  const b = css.indexOf(CSS_END);
  // Only a block `yad docs brand` could write: the markers once each, in order.
  if (a < 0 || b < a || css.indexOf(CSS_BEGIN, a + 1) >= 0 || css.indexOf(CSS_END, b + 1) >= 0) return undefined;
  const m = FINGERPRINT_RE.exec(css.slice(a, b));
  return m ? m[1] : null;
}

// The CSS between the markers: the brand's fonts, its dark look, then its light look for a light setting.
// → text (no markers), '' for yadflow's look.
export function docsSiteCss(brand, assets, origin, fingerprint = null) {
  if (origin !== 'product') return '';
  const out = [];
  if (fingerprint) out.push(`/* yad-brand:fingerprint ${fingerprint} */`);
  for (const f of assets.fonts) out.push(`@font-face { font-family: "${f.family}"; src: url(${f.src}) format("${f.format}"); font-display: swap; }`);
  const fonts = [];
  const heading = brand.fonts?.heading || brand.fonts?.body;
  const body = brand.fonts?.body || brand.fonts?.heading;
  if (heading) fonts.push(`  --font-display: ${stack(heading, SANS)};`);
  if (body) fonts.push(`  --font-body: ${stack(body, SANS)};`);
  if (brand.fonts?.mono) fonts.push(`  --font-mono: ${stack(brand.fonts.mono, MONO)};`);
  out.push(`:root {\n${lookVars(brand.colors.dark)}\n${fonts.join('\n')}${fonts.length ? '\n' : ''}  color-scheme: dark;\n}`);
  out.push(`@media (prefers-color-scheme: light) {\n:root {\n${lookVars(brand.colors.light)}\n  color-scheme: light;\n}\n}`);
  return out.join('\n');
}

// The head block's lines: the brand's mark as the favicon, and the template's font link unless the brand
// names its own heading or body font (a mono font alone leaves the template's two fonts in use). → [line]
export function docsHeadLines(brand, assets, origin) {
  if (origin !== 'product') return [...TEMPLATE_HEAD];
  const mark = assets.mark && DATA_IMAGE_RE.test(assets.mark) ? assets.mark : null;
  const lines = [mark ? `    <link rel="icon" href="${mark}" />` : TEMPLATE_HEAD[0]];
  const ownFonts = !!(brand.fonts?.heading || brand.fonts?.body);
  if (!ownFonts) lines.push(TEMPLATE_HEAD[1]);
  return lines;
}

// src/data/brand.ts. JSON is a TypeScript literal, so no name can end the string it is written into.
export function docsBrandTs(brand, assets, origin) {
  if (origin !== 'product') return TEMPLATE_BRAND_TS;
  const mark = assets.mark && DATA_IMAGE_RE.test(assets.mark) ? assets.mark : null;
  const name = String(brand.name).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim() || 'yadflow';
  return `// The brand the site shows in its top bar, written by \`yad docs brand\` from .sdlc/brand.json. Do not edit:
// the next run writes it again.
export const brand: { name: string; mark: string | null } = { name: ${JSON.stringify(name)}, mark: ${JSON.stringify(mark)} };
`;
}

// Replace the lines between one begin marker and one end marker: everything after the begin marker's line and
// before the end marker's line (its indentation kept). → new text, or null when the markers are not there
// exactly once each, in that order.
// `inner` is written with the file's own line ending (\r\n in a file that uses it).
export function between(text, begin, end, inner) {
  const a = text.indexOf(begin);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a || text.indexOf(begin, a + 1) >= 0 || text.indexOf(end, b + 1) >= 0) return null;
  const afterBegin = text.indexOf('\n', a);
  const endLine = text.lastIndexOf('\n', b) + 1;
  if (afterBegin < 0 || afterBegin >= endLine) return null; // the two markers share a line
  const eol = text[afterBegin - 1] === '\r' ? '\r\n' : '\n';
  const body = inner ? `${inner.split('\n').join(eol)}${eol}` : '';
  return `${text.slice(0, afterBegin + 1)}${body}${text.slice(endLine)}`;
}

// The site folder, inside the Product, reached through no link: every step of the path is checked, so a link
// anywhere on the way (`epics -> /elsewhere`) is refused, not followed.
function siteFolder(root, rel) {
  if (typeof rel !== 'string' || !rel.trim() || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return null;
  let at = root;
  for (const part of rel.split(/[\\/]/).filter((p) => p && p !== '.')) {
    at = path.join(at, part);
    let st;
    try { st = fs.lstatSync(at); } catch { return null; }
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
  }
  return at === root ? null : at;
}

// A file of the site: a plain file, not a link, and not a second name of another file (a hard link), so a
// write never lands anywhere else. Its folders were checked by siteFolder. → its text; null when missing;
// false when it is there but not a plain file of its own.
function siteFile(full) {
  let st;
  try { st = fs.lstatSync(full); } catch (e) { return e.code === 'ENOENT' ? null : false; }
  if (!st.isFile() || st.nlink > 1) return false;
  return fs.readFileSync(full, 'utf8');
}

export const DOCS_BRAND_USAGE = 'usage: yad docs brand <site folder> [--json] — the folder of a generated doc site inside the Product, e.g. epics/EP-x/docs-site';

// The work, with no printing: → { ok: true, result } or { ok: false, error, hint }. `yad docs brand` and
// `yad docs sync --refresh` both use it, so a refusal inside a sync never becomes the sync's own answer.
export function applyBrand(root, site) {
  const no = (error, hint = null) => ({ ok: false, error, hint });
  const shown = forTerminal(site);
  const dir = siteFolder(root, site);
  if (!dir) return no(`${shown} is not a folder inside the Product (a relative path with no "..", reached through no link)`, DOCS_BRAND_USAGE);
  // src and src/data are checked like the site folder: a link there would carry every write out of it.
  const srcDir = siteFolder(root, path.join(site, 'src'));
  const dataDir = srcDir && siteFolder(root, path.join(site, 'src', 'data'));
  if (!srcDir || !dataDir) {
    const want = path.join(dir, srcDir ? path.join('src', 'data') : 'src');
    let missing = false;
    try { fs.lstatSync(want); } catch (e) { missing = e.code === 'ENOENT'; }
    if (missing && !srcDir) return no(`${shown} has no src folder: is it the folder of a generated doc site?`, DOCS_BRAND_USAGE);
    if (missing) return no(`${shown} has no src/data folder: the site is incomplete`, 'make the site again with the skill that made it (yad-docs, or yad-docs-overview for docs/sdlc-site)');
    return no(`${shown}/${srcDir ? 'src/data' : 'src'} must be a folder of the site, reached through no link`, 'make the site again with the skill that made it');
  }
  const cssAt = path.join(srcDir, 'index.css');
  const htmlAt = path.join(dir, 'index.html');
  const tsAt = path.join(dataDir, 'brand.ts');
  const css = siteFile(cssAt);
  const html = siteFile(htmlAt);
  const ts = siteFile(tsAt);
  if (!css || !html) return no(`${shown} is not a generated doc site (src/index.css and index.html must be plain files of their own)`, 'make it with the yad-docs skill first');
  if (ts === false) return no(`${shown}/src/data/brand.ts is not a plain file of its own`, 'remove it: the next run writes it again');

  const r = readBrand(root);
  const assets = brandAssets(root, r.brand, r.origin);
  const fingerprint = brandFingerprint(root, r);
  const nextCss = between(css, CSS_BEGIN, CSS_END, docsSiteCss(r.brand, assets, r.origin, fingerprint));
  const nextHtml = between(html, HEAD_BEGIN, HEAD_END, docsHeadLines(r.brand, assets, r.origin).join('\n'));
  if (nextCss === null || nextHtml === null) {
    return no(`${shown} has no place for the brand: ${nextCss === null ? 'src/index.css' : 'index.html'} does not hold its yad-brand markers once each, in order, on separate lines (a site made from a doc template older than 0.0.7)`,
      'make the site again with the yad-docs skill, or theme it by hand by skills/yad-docs/references/theme-map.md');
  }
  const nextTs = docsBrandTs(r.brand, assets, r.origin);
  const wrote = [];
  const put = (full, rel, before, after) => { if (before !== after) { fs.writeFileSync(full, after); wrote.push(rel); } };
  put(cssAt, 'src/index.css', css, nextCss);
  put(htmlAt, 'index.html', html, nextHtml);
  put(tsAt, 'src/data/brand.ts', ts, nextTs);
  const product = r.origin === 'product';
  return { ok: true, result: { site, origin: r.origin, theme: product ? 'brand.json' : null, fingerprint, wrote, fonts: product ? assets.fonts.map((f) => f.family) : [], mark: product && !!assets.mark, problems: r.problems }, name: r.brand.name };
}

export async function runDocsBrand(root, { site, args = [], json = false } = {}) {
  if (!site) return refuse('yad docs brand needs the site folder', DOCS_BRAND_USAGE, { json });
  if (args.length) return refuse(`yad docs brand takes one folder (got also: ${args.map(forTerminal).join(' ')})`, DOCS_BRAND_USAGE, { json });
  const done = applyBrand(root, site);
  if (!done.ok) return refuse(done.error, done.hint, { json });
  const { result } = done;
  if (json) return emitJSON(result);
  log(c.bold(`\n${forTerminal(site)} — brand`));
  if (result.origin === 'product') ok(`wears ${forTerminal(done.name)}'s brand from .sdlc/brand.json (theme: brand.json)`);
  else info(result.problems.length ? 'yadflow\'s look: the brand file cannot be used, so the site keeps its own theme' : 'no .sdlc/brand.json: the site keeps its own theme');
  for (const pr of result.problems) warn(forTerminal(pr));
  info(result.wrote.length ? `wrote ${result.wrote.join(', ')}` : 'nothing changed');
  return result;
}
