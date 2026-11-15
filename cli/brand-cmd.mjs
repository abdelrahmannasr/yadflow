// `yad brand [show] | init | check` (E184) — the Product's brand file, `.sdlc/brand.json`. See cli/brand.mjs.
//
// `init` fills the file from the Product's design system, on its own, when that is machine-readable:
//   - a DESIGN.md with YAML front matter: `colors:` (named colours) and `typography:` (each style's fontFamily);
//   - a DESIGN.md with a CSS block holding `:root { --name: value; }` (and a dark block, when there is one).
// Each colour ROLE is filled from the first name that means it (the table below), and the report says which
// name filled it — or that nothing did, so yadflow's value is used. It never invents a colour. A DESIGN.md in
// prose (tables) is the yad-brand skill's job: the agent reads it and writes the same file.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, info, warn, refuse, emitJSON, forTerminal, writeJSON } from './lib.mjs';
import { productConfigPath } from './manifest.mjs';
import { BRAND_FILE, BRAND_VERSION, ROLES, isColor, FAMILY_RE, IMAGE_CAP, checkBrand, readBrand, contrastProblems, sourceFingerprint, brandPath } from './brand.mjs';

export const BRAND_USAGE = 'usage: yad brand [show] [--json] · yad brand init [--from <DESIGN.md>] [--logo <file>] [--mark <file>] [--force] · yad brand check [--json]';

// The names that mean each role, most specific first. Compared lower-case, without a leading `--` or `color-`.
export const ROLE_NAMES = Object.freeze({
  bg: ['bg', 'background', 'page', 'canvas', 'bg-primary', 'surface-page', 'base'],
  surface: ['surface', 'card', 'panel', 'raised', 'bg-secondary', 'surface-1'],
  text: ['ink', 'text', 'fg', 'foreground', 'text-primary', 'on-surface', 'on-background', 'body'],
  muted: ['ink-secondary', 'muted', 'text-secondary', 'secondary-text', 'subtle', 'ink-muted', 'faint'],
  border: ['border', 'line', 'hairline', 'divider', 'outline', 'stroke'],
  primary: ['primary', 'brand', 'action', 'action-fill', 'primary-strong', 'primary-500', 'main'],
  accent: ['accent', 'secondary', 'highlight', 'gold', 'accent-strong'],
});
const FONT_NAMES = Object.freeze({ heading: ['display', 'headline', 'heading', 'title', 'h1'], body: ['body', 'text', 'paragraph', 'base', 'sans'], mono: ['mono', 'code', 'monospace'] });

const norm = (k) => String(k).toLowerCase().replace(/^--/, '').replace(/^colou?r-/, '').trim();

// A small YAML reader for front matter: nested maps of scalars by indentation, `#` comments, quoted values.
// Lists and anchors are not read (a design system's colours and type are maps).
export function readFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!m) return null;
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw) || /^\s*-/.test(raw)) continue;
    const k = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(raw);
    if (!k) continue;
    const indent = k[1].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    let v = k[3].replace(/\s+#.*$/, '').trim();
    if (v === '') { parent[k[2]] = {}; stack.push({ indent, obj: parent[k[2]] }); continue; }
    v = v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    parent[k[2]] = v;
  }
  return root;
}

// A DESIGN.md's CSS as rules, in ONE pass (linear; reviews 1–3): comments and quoted text are skipped, so a
// brace or a selector inside them never counts. Each rule: { selector, text (its own declarations, never a
// nested rule's), rules (nested) }. A selector is the text since the last rule or statement, cut at a blank
// line or a code fence line (with its info string), so prose before a CSS block is never part of one.
export const CSS_DEPTH = 16;
export function cssRules(src) {
  const top = { selector: '', text: '', rules: [] };
  const stack = [top];
  let pending = '', deeper = 0; // braces past CSS_DEPTH are counted, never kept: no design system nests so far
  const flush = () => { if (stack.length > 1) stack[stack.length - 1].text += `${pending};`; pending = ''; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 1; continue; }
    // A quoted string, only inside a rule (an apostrophe in prose is not one: review 4). It ends at its quote
    // or at a newline, as CSS ends a string; a backslash escapes the next character.
    if ((ch === '"' || ch === "'") && stack.length > 1) {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      pending += src.slice(i, Math.min(j + 1, src.length));
      i = j;
      continue;
    }
    if (deeper) { if (ch === '{') deeper++; else if (ch === '}') deeper--; continue; }
    if (ch === '{' && stack.length > CSS_DEPTH) { deeper = 1; pending = ''; continue; }
    if (ch === '{') {
      const rule = { selector: pending.split(/\n\s*\n|```[^\n]*/).pop().trim(), text: '', rules: [] };
      stack[stack.length - 1].rules.push(rule);
      stack.push(rule);
      pending = '';
    } else if (ch === '}') {
      flush();
      if (stack.length > 1) stack.pop();
    } else if (ch === ';') flush();
    else pending += ch;
  }
  return top.rules;
}

// `.dark`, `:root.dark`, `html.dark`, `.dark-mode`, `.dark-theme` — never `.darkmode` or `.dark-blue`. The media
// query is matched on the selector's own line, so a heading or prose line just above it never hides it.
const DARK_SELECTOR = /\[data-theme=["']?dark["']?\]|\.dark(?:-mode|-theme)?(?![\w-])/;
const DARK_MEDIA = /(?:^|\n)\s*@media\b[^{\n]*prefers-color-scheme\s*:\s*dark/;
const ROOT = /(?:^|[\s,]):root\b/;
const hasVars = (r) => /--[A-Za-z0-9_-]+\s*:/.test(r.text);
const isRootish = (r) => /(?:^|[\s,])(?::root|html|body)\b/.test(r.selector);

// The `--name: value` pairs of the first `:root` rule that is not a dark one, and of the dark rule when there
// is one: an `@media (prefers-color-scheme: dark)` block's `:root`, `html` or `body` rule (else its first rule
// with a `--` name), or a `[data-theme="dark"]` / `.dark` rule anywhere, inside another `@media` too.
export function readRootVars(text) {
  const all = [];
  const walk = (list, darkMedia) => { for (const r of list) { all.push({ r, darkMedia }); walk(r.rules, darkMedia || DARK_MEDIA.test(r.selector)); } };
  walk(cssRules(String(text || '')), false);
  const vars = (block) => Object.fromEntries([...block.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g)].map((x) => [x[1], x[2].trim()]));
  const light = all.find(({ r, darkMedia }) => !darkMedia && ROOT.test(r.selector) && !DARK_SELECTOR.test(r.selector));
  let dark = null;
  for (const { r } of all) {
    if (DARK_MEDIA.test(r.selector)) dark = r.rules.find((x) => isRootish(x) && hasVars(x)) || r.rules.find(hasVars) || null;
    else if (DARK_SELECTOR.test(r.selector) && hasVars(r)) dark = r;
    if (dark) break;
  }
  if (!light) return null;
  return { light: vars(light.r.text), dark: dark ? vars(dark.text) : null };
}

// Fill each role from a { name: value } map. → { colors: { role: value }, filledFrom: { role: name } }
export function rolesFrom(map, { darkPrefix = false } = {}) {
  const colors = {}, filledFrom = {};
  const entries = Object.entries(map || {}).filter(([, v]) => isColor(v));
  const pick = (k) => { const n = norm(k); if (darkPrefix) { const m = /^(?:dark-(.+)|(.+)-dark)$/.exec(n); return m ? (m[1] || m[2]) : null; } return /(^dark-|-dark$)/.test(n) ? null : n; };
  for (const role of ROLES) {
    for (const want of ROLE_NAMES[role]) {
      const hit = entries.find(([k]) => pick(k) === want);
      if (hit) { colors[role] = hit[1].trim(); filledFrom[role] = hit[0]; break; }
    }
  }
  return { colors, filledFrom };
}

function familyOf(v) {
  const first = String(v || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  return FAMILY_RE.test(first) ? first : null;
}

// Find files in the Product's design folders: depth 3, no links, never node_modules or .git.
function findFiles(root, test) {
  const out = [];
  const walk = (dir, depth) => {
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      if (d.name.startsWith('.') || d.name === 'node_modules') continue;
      const full = path.join(dir, d.name);
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory() && depth > 0) walk(full, depth - 1);
      else if (d.isFile() && test(d.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  for (const top of ['design', 'designs', 'design-system', 'brand', 'assets']) walk(path.join(root, top), 3);
  return out.sort();
}
const smallEnough = (root, rel) => { try { return fs.statSync(path.join(root, rel)).size <= IMAGE_CAP; } catch { return false; } };
const prefer = (list) => list.find((f) => f.endsWith('.svg')) || list.find((f) => f.endsWith('.png')) || list[0] || null;

// Build a brand.json from a DESIGN.md's text. → { brand, report: { filled, missing, fonts, logo, mark } }
export function brandFromDesign(root, text, { name = null, from = 'DESIGN.md', logo = null, mark = null } = {}) {
  const fm = readFrontMatter(text);
  const css = readRootVars(text);
  let light = { colors: {}, filledFrom: {} }, dark = { colors: {}, filledFrom: {} }, how = null;
  if (fm && fm.colors && typeof fm.colors === 'object') {
    light = rolesFrom(fm.colors); dark = rolesFrom(fm.colors, { darkPrefix: true }); how = 'front matter';
  }
  if (Object.keys(light.colors).length < 3 && css) {
    const l = rolesFrom(css.light);
    if (Object.keys(l.colors).length > Object.keys(light.colors).length) { light = l; dark = css.dark ? rolesFrom(css.dark) : { colors: {}, filledFrom: {} }; how = ':root block'; }
  }
  const fonts = { heading: null, body: null, mono: null };
  const fontFrom = {};
  if (fm && fm.typography && typeof fm.typography === 'object') {
    for (const [slot, names] of Object.entries(FONT_NAMES)) {
      for (const n of names) { const f = familyOf(fm.typography[n]?.fontFamily); if (f) { fonts[slot] = { family: f, files: [] }; fontFrom[slot] = `typography.${n}`; break; } }
    }
  }
  if (css) {
    for (const [slot, names] of Object.entries(FONT_NAMES)) {
      if (fonts[slot]) continue;
      for (const n of names) { const f = familyOf(css.light[`--font-${n}`]); if (f) { fonts[slot] = { family: f, files: [] }; fontFrom[slot] = `--font-${n}`; break; } }
    }
  }
  if (!fonts.body && fonts.heading) fonts.body = { ...fonts.heading, files: [] };
  for (const slot of Object.keys(fonts)) {
    if (!fonts[slot]) continue;
    const key = fonts[slot].family.toLowerCase().replace(/[\s_-]/g, '');
    fonts[slot].files = findFiles(root, (n) => /\.(woff2|woff|ttf|otf)$/i.test(n) && n.toLowerCase().replace(/[\s_-]/g, '').includes(key)).slice(0, 4);
  }
  const images = findFiles(root, (n) => /\.(svg|png|webp|jpe?g)$/i.test(n)).filter((f) => smallEnough(root, f));
  const logoFile = logo || prefer(images.filter((f) => /logo|wordmark/i.test(path.posix.basename(f))));
  const markFile = mark || prefer(images.filter((f) => /mark|icon|favicon|symbol/i.test(path.posix.basename(f)))) || logoFile;
  const productName = (() => { try { const n = JSON.parse(fs.readFileSync(productConfigPath(root), 'utf8')).name; return typeof n === 'string' && n.trim() ? n : null; } catch { return null; } })();
  const title = name || (typeof fm?.name === 'string' && fm.name) || (typeof fm?.title === 'string' && fm.title) || productName || (/^#\s+(.+)$/m.exec(String(text).replace(/^---[\s\S]*?\n---/, ''))?.[1]) || path.basename(root);
  const cleanName = String(title).split(/\s+[—–-]\s+|\s+\(/)[0].trim().slice(0, 80);
  const brand = {
    version: BRAND_VERSION, name: cleanName, source: from, sourceHash: sourceFingerprint(text),
    logo: logoFile, mark: markFile,
    colors: { light: light.colors, dark: Object.keys(dark.colors).length >= 3 ? dark.colors : null },
    fonts, status: null,
  };
  return { brand, report: { how, filled: { light: light.filledFrom, dark: dark.filledFrom }, missing: ROLES.filter((r) => !light.colors[r]), fonts: fontFrom, logo: logoFile, mark: markFile } };
}

export async function runBrand(root, { action = 'show', args = [], from = null, logo = null, mark = null, force = false, json = false } = {}) {
  if (args.length) return refuse(`yad brand ${action} takes no words (got: ${args.map(forTerminal).join(' ')})`, BRAND_USAGE, { json });

  if (action === 'show' || action === 'check') {
    const r = readBrand(root);
    const exists = fs.existsSync(r.file);
    const contrastLines = contrastProblems(r.brand, { links: true });
    let stale = null;
    if (r.origin === 'product' && r.brand.source) {
      const src = brandPath(root, r.brand.source);
      let text = null;
      try { text = src ? fs.readFileSync(src, 'utf8') : null; } catch { /* a folder, or unreadable */ }
      if (!src) stale = `its source ${r.brand.source} is not in the Product any more`;
      else if (text === null) stale = `its source ${r.brand.source} cannot be read`;
      else if (!r.brand.sourceHash) stale = null;
      else if (sourceFingerprint(text) !== r.brand.sourceHash) stale = `${r.brand.source} changed since ${BRAND_FILE} was made — run \`yad brand init --force\`, or update the file`;
    }
    // A file written by hand has no fingerprint, so nothing can say when its design system moves on (review 1).
    if (r.origin === 'product' && !r.brand.sourceHash) r.warnings = [...r.warnings, `no sourceHash in ${BRAND_FILE}, so yad cannot tell when the design system changes — \`yad brand init --force\` stamps it, if the design system is one it reads`];
    if (action === 'check' && exists && r.problems.length) process.exitCode = 1;
    const payload = { origin: r.origin, file: BRAND_FILE, exists, name: r.brand.name, logo: r.brand.logo, mark: r.brand.mark, colors: r.brand.colors, fonts: r.brand.fonts, status: r.brand.status,
      problems: r.problems, warnings: r.warnings, contrast: contrastLines, stale };
    if (json) return emitJSON(action === 'check' ? { ...payload, ok: !(exists && r.problems.length) } : payload);
    log(c.bold(`\nyad brand${action === 'check' ? ' check' : ''}`));
    if (r.origin === 'yadflow') info(exists ? `${BRAND_FILE} cannot be used, so pages wear yadflow's look:` : `no ${BRAND_FILE} — pages wear yadflow's look. \`yad brand init\` makes one from the Product's DESIGN.md`);
    else ok(`${forTerminal(r.brand.name)} — from ${BRAND_FILE}${r.brand.source ? ` (made from ${forTerminal(r.brand.source)})` : ''}`);
    for (const p of r.problems) warn(forTerminal(p));
    if (r.origin === 'product') {
      info(`logo: ${forTerminal(r.brand.logo || '—')} · mark: ${forTerminal(r.brand.mark || '—')}`);
      for (const scheme of ['light', 'dark']) info(`${scheme}${scheme === 'dark' && r.brand.colors.derivedDark ? ' (made from light)' : ''}: ${ROLES.map((role) => `${role} ${r.brand.colors[scheme][role]}`).join(' · ')}`);
      info(`fonts: ${['heading', 'body', 'mono'].map((s) => `${s} ${r.brand.fonts?.[s] ? `${r.brand.fonts[s].family}${r.brand.fonts[s].files.length ? ' (embedded)' : ''}` : 'system'}`).join(' · ')}`);
    }
    for (const w of r.warnings) info(c.dim(forTerminal(w)));
    for (const x of contrastLines) warn(x);
    if (stale) warn(forTerminal(stale));
    return payload;
  }

  if (action === 'init') {
    const file = path.join(root, BRAND_FILE);
    if (fs.existsSync(file) && !force) return refuse(`${BRAND_FILE} is already there`, 'add --force to make it again from the design system (your edits to it are replaced)', { json });
    const srcRel = from || 'DESIGN.md';
    const src = brandPath(root, srcRel);
    if (!src) return refuse(`no ${forTerminal(srcRel)} in the Product`, 'name the design system with --from <file> (a DESIGN.md), or ask the agent to fill the brand with the yad-brand skill', { json });
    for (const [flag, rel] of [['--logo', logo], ['--mark', mark]]) if (rel && !brandPath(root, rel)) return refuse(`${flag} ${forTerminal(rel)} is not a file inside the Product`, null, { json });
    let text;
    try { text = fs.readFileSync(src, 'utf8'); } catch { return refuse(`${forTerminal(srcRel)} cannot be read as a file`, null, { json }); }
    // Relative to the Product's REAL path: `src` is real (brandPath), and a Product reached through a link
    // must never write a path that leaves it, or this machine's folders, into a committed file (review 1).
    const { brand, report } = brandFromDesign(root, text, { from: path.relative(fs.realpathSync(root), src).split(path.sep).join('/'), logo, mark });
    if (!Object.keys(brand.colors.light).length) return refuse(`${forTerminal(srcRel)} has no colours yadflow can read (no front matter \`colors:\` and no \`:root\` block)`, 'ask the agent to fill the brand with the yad-brand skill — it reads prose and design tools', { json });
    const checked = checkBrand(root, brand);
    if (checked.problems.length) return refuse(`the brand made from ${forTerminal(srcRel)} cannot be used: ${checked.problems.join('; ')}`, null, { json });
    const { fontBytes, ...toWrite } = checked.brand;
    void fontBytes;
    writeJSON(file, toWrite);
    if (json) return emitJSON({ file: BRAND_FILE, brand: toWrite, report, warnings: checked.warnings });
    log(c.bold('\nyad brand init'));
    ok(`wrote ${BRAND_FILE} for ${forTerminal(toWrite.name)} from ${forTerminal(toWrite.source)} (${report.how})`);
    for (const scheme of ['light', 'dark']) {
      const f = report.filled[scheme];
      if (Object.keys(f).length) info(`${scheme}: ${Object.entries(f).map(([role, n]) => `${role} ← ${forTerminal(n)}`).join(' · ')}`);
    }
    if (report.missing.length) warn(`not found, so yadflow's is used: ${report.missing.join(', ')}`);
    if (!toWrite.colors.dark) info('no dark colours found: a dark look is made from a neutral dark with your primary and accent');
    info(`fonts: ${Object.entries(toWrite.fonts).map(([s, f]) => `${s} ${f ? `${f.family}${f.files.length ? ` (${f.files.length} file${f.files.length > 1 ? 's' : ''})` : ' (name only)'}` : 'system'}`).join(' · ')}`);
    info(`logo: ${forTerminal(toWrite.logo || 'none found')} · mark: ${forTerminal(toWrite.mark || 'none found')}${toWrite.logo ? '' : ' — pass --logo <file>'}`);
    info('check it with `yad brand`, then commit it: every page yad makes for this Product wears it');
    return { file: BRAND_FILE, brand: toWrite, report };
  }

  return refuse(`unknown action: yad brand ${forTerminal(action)}`, BRAND_USAGE, { json });
}
