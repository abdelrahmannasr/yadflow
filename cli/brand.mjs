// The Product's brand on every page yadflow makes (E184).
//
// A Product may hold its design system — its logo, its colours, its fonts — in many shapes: a DESIGN.md with
// YAML front matter, one with a CSS `:root` block, prose tables, or a design tool. Pages never parse those.
// They read ONE small committed file, `.sdlc/brand.json`, which `yad brand init` (or the yad-brand skill)
// fills from the Product's design system:
//
//   { "version": 1, "name": "…", "source": "DESIGN.md", "sourceHash": "sha256:…",
//     "logo": "design/logo.svg", "mark": "design/mark.svg",
//     "colors": { "light": { bg, surface, text, muted, border, primary, accent }, "dark": { … } | null },
//     "fonts": { "heading": { "family": "Cairo", "files": ["design/fonts/Cairo.woff2"] } | null, "body": …, "mono": … },
//     "status": { live, merged, active, planned, idle } | null }
//
// With no file — or a file that cannot be used — every page wears yadflow's own look (its logo's purple and
// pink) and says why in `yad brand`. A brand never breaks a page: each value is checked before it reaches one.
//
// SAFETY. A colour must match a narrow pattern (hex, or rgb/hsl/oklch/oklab of numbers), so no value can end
// the CSS it is written into. A file must sit inside the Product (no `..`, no link out), be of an allowed type
// and under its size cap; it is embedded as a data: URI, and an SVG is only ever shown through <img>, where
// its scripts never run. A font family is letters, digits, spaces, `-` and `_`.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJSONStrict } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';

export const BRAND_FILE = PROJECT_FILES.brandConfig;
export const BRAND_VERSION = 1;
export const ROLES = Object.freeze(['bg', 'surface', 'text', 'muted', 'border', 'primary', 'accent']);
export const STATUS_KEYS = Object.freeze(['live', 'merged', 'active', 'planned', 'idle']);
export const FONT_SLOTS = Object.freeze(['heading', 'body', 'mono']);
export const IMAGE_CAP = 512 * 1024;
export const FONT_CAP = 600 * 1024;
const IMAGE_TYPES = Object.freeze({ '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' });
const FONT_TYPES = Object.freeze({ '.woff2': ['font/woff2', 'woff2'], '.woff': ['font/woff', 'woff'], '.ttf': ['font/ttf', 'truetype'], '.otf': ['font/otf', 'opentype'] });

// A colour value: hex, or a CSS colour function holding only numbers, units, `%`, `.`, `/`, `,` and spaces.
export const COLOR_RE = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|oklch|oklab)\(\s*(?:[-+0-9.%\s/,]|deg|turn|none)+\))$/i;
export const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
// A colour yadflow can write: checked for length first, so a huge value never reaches the pattern (review 1).
export const COLOR_MAX = 64;
export const isColor = (v) => typeof v === 'string' && v.trim().length <= COLOR_MAX && COLOR_RE.test(v.trim());
const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const YADFLOW_MARK_FILE = path.join(HERE, '..', 'skills', 'yad-docs', 'templates', 'app', 'public', 'favicon.svg');

// yadflow's own look, from its logo: purple #6316DB and pink #FB2576 (until yadflow defines its brand).
export const YADFLOW_BRAND = Object.freeze({
  version: BRAND_VERSION, name: 'yadflow', source: null, sourceHash: null, logo: null, mark: null,
  colors: {
    light: { bg: '#ffffff', surface: '#f7f5fb', text: '#1b1530', muted: '#5f5873', border: '#e4dff0', primary: '#6316db', accent: '#fb2576' },
    dark: { bg: '#120e1c', surface: '#1c1729', text: '#f1edfa', muted: '#a59cba', border: '#2f2842', primary: '#9466f8', accent: '#ff6490' },
  },
  fonts: { heading: null, body: null, mono: null },
  status: null,
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A path in brand.json: relative, inside the Product, never through a link that leaves it. → absolute | null
export function brandPath(root, rel) {
  if (typeof rel !== 'string' || !rel.trim() || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return null;
  const full = path.resolve(root, rel);
  let realRoot, realFull;
  try { realRoot = fs.realpathSync(root); realFull = fs.realpathSync(full); } catch { return null; }
  return realFull.startsWith(realRoot + path.sep) ? realFull : null;
}

// Check a parsed brand.json. → { brand (normalised), problems: [text], warnings: [text] }
export function checkBrand(root, rec) {
  const problems = [], warnings = [];
  if (!isObj(rec)) return { brand: null, problems: [`${BRAND_FILE} is not a JSON object`], warnings };
  if (rec.version !== BRAND_VERSION) problems.push(`${BRAND_FILE} is version ${JSON.stringify(rec.version ?? null)}, and this yadflow reads version ${BRAND_VERSION}`);
  const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim().slice(0, 80) : null;
  if (!name) problems.push('"name" must be the product\'s name');
  const colors = { light: null, dark: null };
  for (const scheme of ['light', 'dark']) {
    const c = rec.colors?.[scheme];
    if (c === null || c === undefined) { if (scheme === 'light') problems.push('"colors.light" is needed'); continue; }
    if (!isObj(c)) { problems.push(`"colors.${scheme}" must be an object of colour roles`); continue; }
    const out = {};
    for (const role of ROLES) {
      const v = c[role];
      if (v === undefined || v === null) { warnings.push(`colors.${scheme}.${role} is not set — yadflow's is used`); continue; }
      if (!isColor(v)) { problems.push(`colors.${scheme}.${role} is not a colour yadflow can use (hex, rgb(), hsl(), oklch() or oklab())`); continue; }
      out[role] = v.trim();
    }
    for (const k of Object.keys(c)) if (!ROLES.includes(k)) warnings.push(`colors.${scheme}.${k} is not a role yadflow uses (${ROLES.join(', ')})`);
    colors[scheme] = out;
  }
  const files = (rel, kind, types, cap) => {
    if (rel === null || rel === undefined) return null;
    const full = brandPath(root, rel);
    if (!full) { problems.push(`${kind} "${String(rel)}" is not a file inside the Product`); return null; }
    const ext = path.extname(full).toLowerCase();
    if (!Object.hasOwn(types, ext)) { problems.push(`${kind} "${rel}" is not one of ${Object.keys(types).join(', ')}`); return null; }
    let size;
    try { const st = fs.statSync(full); if (!st.isFile()) throw new Error('not a file'); size = st.size; } catch { problems.push(`${kind} "${rel}" cannot be read`); return null; }
    if (cap && size > cap) { problems.push(`${kind} "${rel}" is ${Math.ceil(size / 1024)} KB — at most ${cap / 1024} KB`); return null; }
    return rel;
  };
  const logo = files(rec.logo, 'logo', IMAGE_TYPES, IMAGE_CAP);
  const mark = files(rec.mark, 'mark', IMAGE_TYPES, IMAGE_CAP);
  const fonts = {};
  let fontBytes = 0;
  for (const slot of FONT_SLOTS) {
    const f = rec.fonts?.[slot];
    if (f === null || f === undefined) { fonts[slot] = null; continue; }
    if (!isObj(f) || typeof f.family !== 'string' || !FAMILY_RE.test(f.family.trim())) { problems.push(`fonts.${slot}.family must be a font name (letters, digits, spaces, - and _)`); fonts[slot] = null; continue; }
    const list = [];
    for (const rel of Array.isArray(f.files) ? f.files : []) {
      const ok = files(rel, `fonts.${slot} file`, FONT_TYPES, 0);
      if (!ok) continue;
      fontBytes += fs.statSync(brandPath(root, ok)).size;
      list.push(ok);
    }
    fonts[slot] = { family: f.family.trim(), files: list };
  }
  if (fontBytes > FONT_CAP) { warnings.push(`the font files add up to ${Math.ceil(fontBytes / 1024)} KB — over ${FONT_CAP / 1024} KB they are not embedded in self-contained pages; the font names are still used`); }
  let status = null;
  if (rec.status !== null && rec.status !== undefined) {
    if (!isObj(rec.status)) problems.push('"status" must be an object of status colours, or null');
    else {
      status = {};
      for (const k of STATUS_KEYS) {
        const v = rec.status[k];
        if (v === undefined) continue;
        if (!isColor(v)) problems.push(`status.${k} is not a colour yadflow can use`);
        else status[k] = v.trim();
      }
    }
  }
  const brand = { version: BRAND_VERSION, name, source: typeof rec.source === 'string' ? rec.source : null, sourceHash: typeof rec.sourceHash === 'string' ? rec.sourceHash : null,
    logo, mark, colors, fonts, status, fontBytes };
  return { brand, problems, warnings };
}

// The brand every page wears. → { brand (complete: every role set), origin: 'product' | 'yadflow', problems, warnings, file }
export function readBrand(root) {
  const file = path.join(root, BRAND_FILE);
  const fallback = (problems = [], warnings = []) => ({ brand: completeBrand(YADFLOW_BRAND), origin: 'yadflow', problems, warnings, file });
  let rec;
  try { rec = readJSONStrict(file, null); } catch (e) { return fallback([`${BRAND_FILE} cannot be read (${String(e.message).split('\n')[0]})`]); }
  if (rec === null) return fallback();
  const c = checkBrand(root, rec);
  if (c.problems.length) return fallback(c.problems, c.warnings);
  return { brand: completeBrand(c.brand), origin: 'product', problems: [], warnings: c.warnings, file };
}

// Every role set: a missing light role is yadflow's. A dark primary or accent the brand does not give (no dark
// scheme, or one without them) is its light one made lighter, or yadflow's when it cannot be made lighter, so
// it reads on a dark background; every other missing dark role is yadflow's neutral dark.
function completeBrand(b) {
  const light = { ...YADFLOW_BRAND.colors.light, ...(b.colors?.light || {}) };
  const ownDark = b.colors?.dark;
  const derive = (role) => (b.colors?.light?.[role] && lighter(light[role])) || YADFLOW_BRAND.colors.dark[role];
  const dark = { ...YADFLOW_BRAND.colors.dark, primary: derive('primary'), accent: derive('accent'), ...(ownDark || {}) };
  // `derivedDark`: the brand gave no dark colours of its own, so its dark look is made from the light one.
  return { ...b, colors: { light, dark, derivedDark: !ownDark || !Object.keys(ownDark).length }, fonts: b.fonts || { heading: null, body: null, mono: null } };
}

// ---- colour maths (for contrast, and the derived dark scheme) --------------------------------------

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
// A colour → linear sRGB [r, g, b] (0–1), or null when yadflow cannot read it (hsl, oklab: no contrast check).
export function linearRgb(value) {
  const v = String(value).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((ch) => ch + ch).join('');
    return [0, 2, 4].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255));
  }
  // Each channel read with its own unit; an alpha after `/` or a fourth value is left out. Anything else is
  // not read (null), never guessed (review 1).
  m = /^rgba?\(\s*([\d.]+)(%?)(?:\s*,\s*|\s+)([\d.]+)(%?)(?:\s*,\s*|\s+)([\d.]+)(%?)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(v);
  if (m) return [[m[1], m[2]], [m[3], m[4]], [m[5], m[6]]].map(([x, pc]) => toLinear(clamp01(Number(x) / (pc ? 100 : 255))));
  m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([-\d.]+)(deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)$/.exec(v);
  if (m) {
    // CSS: L 100% is 1; C 100% is 0.4.
    const L = Number(m[1]) / (m[2] ? 100 : 1), C = m[4] ? (Number(m[3]) / 100) * 0.4 : Number(m[3]), h = (Number(m[5]) * Math.PI) / 180;
    const a = C * Math.cos(h), b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s].map(clamp01);
  }
  return null;
}
const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
export function contrast(a, b) {
  const x = linearRgb(a), y = linearRgb(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
// A colour made lighter for a dark background: oklch() with its lightness raised; any other colour yadflow can
// read (hex, rgb()) → a lighter hex; one it cannot read → null, and yadflow's dark colour is used (reviews 1, 2).
export function lighter(value) {
  const ok = /^oklch\(\s*([\d.]+)(%?)(\s+[\d.]+%?\s+[-\d.]+(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?)\)$/i.exec(String(value).trim());
  if (ok) {
    const L = Number(ok[1]) / (ok[2] ? 100 : 1);
    return `oklch(${(L + (1 - L) * 0.5).toFixed(3)}${ok[3]})`;
  }
  const rgb = linearRgb(value);
  if (!rgb) return null;
  const toS = (c) => { const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(clamp01(s) * 255); };
  const mixed = rgb.map((c) => c + (1 - c) * 0.35);
  return `#${mixed.map((c) => toS(c).toString(16).padStart(2, '0')).join('')}`;
}

// Text that is hard to read. → [text]; a colour yadflow cannot read is skipped, never guessed. `links`: also
// `primary`, which the pages use as link text, so it needs 4.5:1 like text (review 2) — on bg, and on surface,
// where the standup's and the issues page's cards put their links (#564). `yad brand check` asks for it; `yad
// doctor` does not, so a brand colour chosen for buttons never warns on every run. Warnings only, never a failure.
export function contrastProblems(brand, { links = false } = {}) {
  const out = [];
  const pairs = [['text', 4.5, 'text', 'bg'], ['muted', 3, 'muted', 'bg'],
    ...(links ? [['primary', 4.5, 'primary (links)', 'bg'], ['primary', 4.5, 'primary (links)', 'surface']] : [])];
  for (const scheme of ['light', 'dark']) {
    const c = brand.colors[scheme];
    for (const [role, min, label, on] of pairs) {
      const r = contrast(c[role], c[on]);
      if (r !== null && r < min) out.push(`${scheme}: ${label} on ${on} is ${r.toFixed(1)}:1 — under ${min}:1, hard to read`);
    }
  }
  return out;
}

// ---- what a page needs ----------------------------------------------------------------------------

const dataUri = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
// The logo, the mark and the fonts as data: URIs (the files were checked by checkBrand).
export function brandAssets(root, brand, origin) {
  const image = (rel) => {
    const full = rel ? brandPath(root, rel) : null;
    if (!full) return null;
    const mime = IMAGE_TYPES[path.extname(full).toLowerCase()];
    if (!mime) return null;
    try { return dataUri(mime, fs.readFileSync(full)); } catch { return null; }
  };
  let mark = image(brand.mark) || image(brand.logo);
  if (!mark && origin === 'yadflow') { try { mark = dataUri('image/svg+xml', fs.readFileSync(YADFLOW_MARK_FILE)); } catch { mark = null; } }
  const fonts = [];
  if ((brand.fontBytes || 0) <= FONT_CAP) {
    for (const slot of FONT_SLOTS) {
      const f = brand.fonts?.[slot];
      for (const rel of f?.files || []) {
        const full = brandPath(root, rel);
        if (!full) continue;
        const type = FONT_TYPES[path.extname(full).toLowerCase()];
        if (!type) continue; // a brand never breaks a page
        const [mime, format] = type;
        try { fonts.push({ family: f.family, src: dataUri(mime, fs.readFileSync(full)), format }); } catch { /* left out */ }
      }
    }
  }
  return { mark, fonts };
}

const familyStack = (f, system) => (f ? `"${f.family}", ${system}` : system);
// The brand as CSS: @font-face for embedded fonts, then every role as a variable, light and dark both named
// (`--brand-bg`, `--brand-dark-bg`) so a page that is always dark (the map) can take the dark ones directly.
export function brandCss(brand, assets) {
  const lines = [];
  for (const f of assets.fonts) lines.push(`@font-face{font-family:"${f.family}";src:url(${f.src}) format("${f.format}");font-display:swap}`);
  const vars = [];
  for (const role of ROLES) vars.push(`--brand-${role}:${brand.colors.light[role]}`, `--brand-dark-${role}:${brand.colors.dark[role]}`);
  vars.push(`--brand-font-heading:${familyStack(brand.fonts?.heading || brand.fonts?.body, SYSTEM_SANS)}`);
  vars.push(`--brand-font-body:${familyStack(brand.fonts?.body || brand.fonts?.heading, SYSTEM_SANS)}`);
  vars.push(`--brand-font-mono:${familyStack(brand.fonts?.mono, SYSTEM_MONO)}`);
  for (const k of STATUS_KEYS) if (brand.status?.[k]) vars.push(`--brand-status-${k}:${brand.status[k]}`);
  if (assets.mark && DATA_IMAGE_RE.test(assets.mark)) vars.push(`--brand-mark:url("${assets.mark}")`);
  lines.push(`:root{${vars.join(';')}}`);
  return lines.join('\n');
}

// A data: image URI of the kinds brandAssets makes — nothing else is ever written into CSS.
export const DATA_IMAGE_RE = /^data:image\/(?:svg\+xml|png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/;

// Where each page shows its brand mark: before its title, drawn from `--brand-mark` (CSS only — no page script
// changes, and the strict pages already allow `img-src data:`).
export const PAGE_TITLES = Object.freeze({ map: '.brand h1', brain: '.brand h1', live: 'header.bar .mark', catalog: 'body > main > h1', usage: 'body h1', standup: 'body h1', issues: 'body h1' });
const markRule = (sel) => `${sel}::before{content:"";display:inline-block;width:1.15em;height:1.15em;margin-right:.4em;vertical-align:-0.18em;background:var(--brand-mark) center/contain no-repeat}`;

// How each page's own variables take the brand. Status, layer and priority colours keep their meaning: only
// the page around them changes (the user's decision). A page with a light and a dark look maps both.
const both = (light, dark) => `:root{${light}}\n@media (prefers-color-scheme: dark){:root{${dark}}}`;
const map = (pairs, scheme) => pairs.map(([v, role]) => `${v}:var(--brand-${scheme === 'dark' ? 'dark-' : ''}${role})`).join(';');
export const PAGE_MAPS = Object.freeze({
  // The progress map is always dark: the dark roles, a glass of the surface, the status colours only if set.
  map: `:root{${map([['--bg', 'bg'], ['--ink', 'text'], ['--muted', 'muted']], 'dark')};--ink-2:color-mix(in srgb, var(--brand-dark-text) 60%, var(--brand-dark-muted));--hair:color-mix(in srgb, var(--brand-dark-border) 70%, transparent);--glass:color-mix(in srgb, var(--brand-dark-surface) 80%, transparent)}
:root{--live:var(--brand-status-live, #3987e5);--merged:var(--brand-status-merged, #d55181);--active:var(--brand-status-active, #c98500);--planned:var(--brand-status-planned, #93a0bf);--idle:var(--brand-status-idle, #5b6680)}
:root{--link:var(--brand-dark-primary);--tint:var(--brand-dark-primary);--focus:var(--brand-dark-accent)}
html,body{font-family:var(--brand-font-body)}.brand h1{font-family:var(--brand-font-heading)}`,
  brain: both(map([['--bg', 'bg'], ['--panel', 'surface'], ['--text', 'text'], ['--muted', 'muted'], ['--line', 'border'], ['--accent', 'primary']], 'light'),
    map([['--bg', 'bg'], ['--panel', 'surface'], ['--text', 'text'], ['--muted', 'muted'], ['--line', 'border'], ['--accent', 'primary']], 'dark'))
    + '\nbody{font-family:var(--brand-font-body)}h1,h2,h3{font-family:var(--brand-font-heading)}',
  live: `:root{--sky-0:var(--brand-dark-bg);--sky-1:var(--brand-dark-surface);--ink:var(--brand-dark-text);--ink-2:color-mix(in srgb, var(--brand-dark-text) 60%, var(--brand-dark-muted));--ink-3:var(--brand-dark-muted);--rule:color-mix(in srgb, var(--brand-dark-border) 60%, transparent);--glass:color-mix(in srgb, var(--brand-dark-surface) 66%, transparent);--sans:var(--brand-font-body);--mono:var(--brand-font-mono)}`,
  catalog: both(map([['--bg', 'bg'], ['--ink', 'text'], ['--muted', 'muted'], ['--line', 'border'], ['--tag', 'surface'], ['--link', 'primary']], 'light'),
    map([['--bg', 'bg'], ['--ink', 'text'], ['--muted', 'muted'], ['--line', 'border'], ['--tag', 'surface'], ['--link', 'primary']], 'dark'))
    + '\nbody{font-family:var(--brand-font-body)}h1,h2{font-family:var(--brand-font-heading)}',
  // usage was dark only; it now follows the brand's light and dark looks like the other reports.
  usage: both(map([['--bg', 'bg'], ['--fg', 'text'], ['--dim', 'muted'], ['--card', 'surface'], ['--line', 'border'], ['--accent', 'primary']], 'light'),
    map([['--bg', 'bg'], ['--fg', 'text'], ['--dim', 'muted'], ['--card', 'surface'], ['--line', 'border'], ['--accent', 'primary']], 'dark'))
    + '\nbody{font-family:var(--brand-font-body)}h1,h2{font-family:var(--brand-font-heading)}',
  standup: both(map([['--bg', 'bg'], ['--fg', 'text'], ['--dim', 'muted'], ['--card', 'surface'], ['--line', 'border'], ['--link', 'primary'], ['--accent', 'accent']], 'light'),
    map([['--bg', 'bg'], ['--fg', 'text'], ['--dim', 'muted'], ['--card', 'surface'], ['--line', 'border'], ['--link', 'primary'], ['--accent', 'accent']], 'dark'))
    + '\nbody{font-family:var(--brand-font-body)}h1,h2{font-family:var(--brand-font-heading)}',
  issues: both(map([['--bg', 'bg'], ['--fg', 'text'], ['--dim', 'muted'], ['--card', 'surface'], ['--line', 'border'], ['--link', 'primary']], 'light'),
    map([['--bg', 'bg'], ['--fg', 'text'], ['--dim', 'muted'], ['--card', 'surface'], ['--line', 'border'], ['--link', 'primary']], 'dark'))
    + '\nbody{font-family:var(--brand-font-body)}h1,h2{font-family:var(--brand-font-heading)}',
});

// Everything one page needs. → { css, name, origin, problems }
//   css   the brand block, the page's own mapping and its mark rule — added AFTER the page's CSS, so it wins.
export function brandForPage(root, page) {
  const r = readBrand(root);
  const assets = brandAssets(root, r.brand, r.origin);
  const mark = assets.mark && DATA_IMAGE_RE.test(assets.mark) && PAGE_TITLES[page] ? `\n${markRule(PAGE_TITLES[page])}` : '';
  const css = `${brandCss(r.brand, assets)}\n${PAGE_MAPS[page] || ''}${mark}`;
  return { css, name: r.brand.name, origin: r.origin, problems: r.problems };
}

// The fingerprint of the design system brand.json was made from, for `yad brand check`.
export const sourceFingerprint = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
