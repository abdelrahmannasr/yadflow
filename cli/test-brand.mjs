// E184 — the Product's brand on every page yadflow makes. Every brand, name and file here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
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

const { readBrand, checkBrand, brandCss, brandAssets, brandForPage, contrast, contrastProblems, linearRgb, COLOR_RE, BRAND_FILE, YADFLOW_BRAND, PAGE_MAPS, DATA_IMAGE_RE } = await import('./brand.mjs');
const { runBrand, readFrontMatter, readRootVars, rolesFrom } = await import('./brand-cmd.mjs');
const { classify } = await import('./agent-rules.mjs');
const { endJSON } = await import('./lib.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAD = path.join(HERE, '..', 'bin', 'yad.mjs');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-brand-')));
const put = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof d === 'string' || Buffer.isBuffer(d) ? d : JSON.stringify(d, null, 2)); };
const done = (...d) => d.forEach((x) => fs.rmSync(x, { recursive: true, force: true }));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#2a7"/></svg>';
async function captured(fn) {
  const out = []; const orig = console.log;
  console.log = (s) => out.push(String(s));
  try { await fn(); } finally { console.log = orig; endJSON(); }
  return out.length ? JSON.parse(out.join('\n')) : null;
}

// A Product with a YAML front-matter design system (the shape the Impeccable DESIGN.md spec uses).
const YAML_DESIGN = `---
name: Fernleaf (fernleaf.example)
description: invented
colors:
  primary: "#2B7358"
  accent: "#E4A036"
  ink: "#101828"
  ink-secondary: "#667085"
  bg: "#F4F6FF"
  surface: "#FFFFFF"
  border: "#D0D5DD"
  dark-bg: "#0D291F"
  dark-surface: "#1A3D2E"
  dark-ink: "#F2F4F7"
  dark-ink-secondary: "#D3DBE9"
  dark-border: "#2B7358"
  dark-primary-strong: "#94CBBA"
typography:
  display:
    fontFamily: "Fernsans, sans-serif"
    fontSize: "28px"
  body:
    fontFamily: "Fernsans, sans-serif"
---

# Fernleaf design system
`;
// A Product with a CSS :root block in OKLCH (the shape a hand-written DESIGN.md often has).
const CSS_DESIGN = `# Design

The visual system for **Quillmark**.

\`\`\`css
:root {
  --bg:            oklch(1.000 0.000 0);      /* page */
  --surface:       oklch(0.975 0.002 75);
  --border:        oklch(0.912 0.003 75);
  --ink:           oklch(0.205 0.008 70);
  --muted:         oklch(0.460 0.006 70);
  --gold:          oklch(0.680 0.135 62);
  --action:        oklch(0.220 0.010 70);
}
\`\`\`
`;

function product({ design = null, files = {} } = {}) {
  const ws = tmp();
  const root = path.join(ws, 'product');
  put(path.join(root, '.sdlc', 'product.json'), { name: 'Invented' });
  if (design) put(path.join(root, 'DESIGN.md'), design);
  for (const [rel, data] of Object.entries(files)) put(path.join(root, rel), data);
  return { ws, root };
}

test('no brand file: every page wears yadflow\'s look, with its mark, and nothing is said wrong', () => {
  const { ws, root } = product();
  try {
    const r = readBrand(root);
    assert.equal(r.origin, 'yadflow');
    assert.deepEqual(r.problems, []);
    assert.equal(r.brand.colors.light.primary, '#6316db');
    const p = brandForPage(root, 'standup');
    assert.match(p.css, /--brand-primary:#6316db/);
    assert.match(p.css, /--brand-mark:url\("data:image\/svg\+xml;base64,/, 'yadflow\'s mark');
    assert.match(p.css, /body h1::before/);
  } finally { done(ws); }
});

test('a colour must be one yadflow can write safely: nothing can end the CSS it goes into', () => {
  for (const ok of ['#fff', '#A1b2C3', '#11223344', 'oklch(0.68 0.135 62)', 'oklch(68% 0.1 62deg)', 'rgb(1, 2, 3)', 'hsl(210 50% 40% / .5)', 'oklab(0.5 0.1 -0.1)']) assert.ok(COLOR_RE.test(ok), ok);
  for (const bad of ['red', '#ggg', 'url(x)', '#fff;}body{display:none', 'oklch(0.5 0.1 62);x', 'expression(alert(1))', 'rgb(1,2,3)}', 'var(--x)', '"#fff"']) assert.equal(COLOR_RE.test(bad), false, bad);
});

test('the brand file is checked: paths stay inside, types and sizes, families, version', () => {
  const { ws, root } = product({ files: { 'design/mark.svg': SVG, 'design/big.png': Buffer.alloc(600 * 1024), 'design/x.gif': 'gif' } });
  try {
    fs.writeFileSync(path.join(ws, 'outside.svg'), SVG);
    fs.symlinkSync(path.join(ws, 'outside.svg'), path.join(root, 'design', 'link.svg'));
    const base = { version: 1, name: 'Invented', colors: { light: { bg: '#fff', text: '#111' } } };
    assert.deepEqual(checkBrand(root, { ...base, mark: 'design/mark.svg' }).problems, []);
    const bad = (extra) => checkBrand(root, { ...base, ...extra }).problems.join(' | ');
    assert.match(bad({ mark: '../outside.svg' }), /not a file inside the Product/);
    assert.match(bad({ mark: 'design/link.svg' }), /not a file inside the Product/, 'a link out is never followed');
    assert.match(bad({ mark: '/etc/hosts' }), /not a file inside the Product/);
    assert.match(bad({ logo: 'design/x.gif' }), /is not one of/);
    assert.match(bad({ logo: 'design/big.png' }), /at most 512 KB/);
    assert.match(bad({ fonts: { body: { family: 'Evil"; } body{', files: [] } } }), /fonts.body.family must be a font name/);
    assert.match(bad({ version: 2 }), /version 2/);
    assert.match(bad({ colors: { light: { bg: 'red' } } }), /colors.light.bg is not a colour/);
    assert.match(bad({ name: '' }), /"name"/);
    // A broken file never breaks a page: the fallback, with the problem said.
    put(path.join(root, BRAND_FILE), '{ nope');
    const r = readBrand(root);
    assert.equal(r.origin, 'yadflow');
    assert.match(r.problems[0], /cannot be read/);
  } finally { done(ws); }
});

test('init from YAML front matter: roles by name, dark from dark-*, fonts and their files, the mark found', async () => {
  const { ws, root } = product({ design: YAML_DESIGN, files: { 'design/fonts/Fernsans-Bold.woff2': 'fontbytes', 'design/assets/fernleaf-logo.svg': SVG, 'design/assets/fernleaf-mark.svg': SVG } });
  try {
    const out = await captured(() => runBrand(root, { action: 'init', json: true }));
    assert.equal(out.command, null);
    const b = out.brand;
    assert.equal(b.name, 'Fernleaf');
    assert.deepEqual(b.colors.light, { bg: '#F4F6FF', surface: '#FFFFFF', text: '#101828', muted: '#667085', border: '#D0D5DD', primary: '#2B7358', accent: '#E4A036' });
    assert.equal(b.colors.dark.bg, '#0D291F');
    assert.equal(b.colors.dark.primary, '#94CBBA', 'dark-primary-strong');
    assert.equal(b.fonts.heading.family, 'Fernsans');
    assert.deepEqual(b.fonts.heading.files, ['design/fonts/Fernsans-Bold.woff2']);
    assert.equal(b.logo, 'design/assets/fernleaf-logo.svg');
    assert.equal(b.mark, 'design/assets/fernleaf-mark.svg');
    assert.equal(out.report.how, 'front matter');
    assert.equal(out.report.filled.light.text, 'ink');
    assert.match(b.sourceHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(readBrand(root).origin, 'product');
    // Not overwritten without --force.
    assert.equal((await captured(() => runBrand(root, { action: 'init', json: true }))).ok, false);
    process.exitCode = 0;
  } finally { done(ws); }
});

test('init from a :root block in OKLCH: --action is primary, --gold is accent, missing roles are named', async () => {
  const { ws, root } = product({ design: CSS_DESIGN });
  try {
    const out = await captured(() => runBrand(root, { action: 'init', json: true }));
    assert.equal(out.report.how, ':root block');
    assert.equal(out.brand.name, 'Invented', 'the Product\'s own name, when there is no front matter name');
    assert.equal(out.brand.colors.light.primary, 'oklch(0.220 0.010 70)');
    assert.equal(out.brand.colors.light.accent, 'oklch(0.680 0.135 62)');
    assert.equal(out.brand.colors.dark, null, 'no dark block: made from light later');
    assert.deepEqual(out.report.missing, []);
    const r = readBrand(root);
    assert.equal(r.brand.colors.derivedDark, true);
    assert.equal(r.brand.colors.dark.bg, YADFLOW_BRAND.colors.dark.bg, 'a neutral dark …');
    assert.equal(r.brand.colors.dark.primary, 'oklch(0.610 0.010 70)', '… with the brand\'s own primary made lighter, so it reads on the dark');
  } finally { done(ws); }
});

test('init refuses prose it cannot read, and a logo path outside the Product', async () => {
  const { ws, root } = product({ design: '# Design\n\nOur primary colour is a deep teal.\n' });
  try {
    const prose = await captured(() => runBrand(root, { action: 'init', json: true }));
    assert.equal(prose.ok, false);
    assert.match(prose.error, /no colours yadflow can read/);
    assert.match(prose.hint, /yad-brand skill/);
    const out = await captured(() => runBrand(root, { action: 'init', logo: '../x.svg', json: true }));
    assert.match(out.error, /not a file inside the Product/);
    const missing = await captured(() => runBrand(root, { action: 'init', from: 'design/none.md', json: true }));
    assert.match(missing.error, /no design\/none.md/);
    process.exitCode = 0;
  } finally { done(ws); }
});

test('the parsers: front matter maps, :root and dark blocks, role names', () => {
  const fm = readFrontMatter('---\na: 1\nb:\n  c: "x" # note\n  d:\n    e: \'y\'\n---\nbody');
  assert.deepEqual(fm, { a: '1', b: { c: 'x', d: { e: 'y' } } });
  assert.equal(readFrontMatter('no front matter'), null);
  const css = readRootVars(':root { --bg: #fff; --ink: #111 }\n@media (prefers-color-scheme: dark) { :root { --bg: #000; --ink: #eee } }');
  assert.deepEqual(css.light, { '--bg': '#fff', '--ink': '#111' });
  assert.deepEqual(css.dark, { '--bg': '#000', '--ink': '#eee' });
  assert.deepEqual(rolesFrom({ 'color-background': '#fff', foreground: '#000', 'not-a-colour': 'blue' }).colors, { bg: '#fff', text: '#000' });
});

test('check: stale when DESIGN.md moved on; contrast in hex and OKLCH; exit 1 only for an unusable file', async () => {
  const { ws, root } = product({ design: YAML_DESIGN });
  try {
    await captured(() => runBrand(root, { action: 'init', json: true }));
    let c = await captured(() => runBrand(root, { action: 'check', json: true }));
    assert.equal(c.ok, true);
    assert.equal(c.stale, null);
    fs.appendFileSync(path.join(root, 'DESIGN.md'), '\nmore\n');
    c = await captured(() => runBrand(root, { action: 'check', json: true }));
    assert.match(c.stale, /DESIGN.md changed since/);
    assert.equal(c.ok, true, 'stale is a warning, not a failure');
    // Contrast.
    assert.ok(contrast('#000', '#fff') > 20);
    assert.ok(Math.abs(contrast('oklch(1 0 0)', '#ffffff') - 1) < 0.01, 'oklch white is white');
    assert.equal(contrast('hsl(0 0% 0%)', '#fff'), null, 'not read: never guessed');
    assert.ok(linearRgb('oklch(0.205 0.008 70)'));
    const low = { ...YADFLOW_BRAND, colors: { light: { ...YADFLOW_BRAND.colors.light, text: '#eeeeee' }, dark: YADFLOW_BRAND.colors.dark } };
    assert.match(contrastProblems(low)[0], /light: text on bg is .* under 4.5:1/);
    // An unusable file: exit 1 on check.
    put(path.join(root, BRAND_FILE), { version: 1, name: 'X', colors: { light: { bg: 'nope' } } });
    const bad = await captured(() => runBrand(root, { action: 'check', json: true }));
    assert.equal(bad.ok, false);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  } finally { done(ws); }
});

test('the CSS: fonts embedded under the cap, both schemes named, status only when set, the mark only as a data image', () => {
  const { ws, root } = product({ files: { 'design/fonts/Fernsans.woff2': 'abc', 'design/mark.svg': SVG } });
  try {
    put(path.join(root, BRAND_FILE), { version: 1, name: 'Fern', mark: 'design/mark.svg', colors: { light: { bg: '#fff', text: '#111', primary: '#2b7358' } },
      fonts: { body: { family: 'Fernsans', files: ['design/fonts/Fernsans.woff2'] } }, status: { live: '#0055ff' } });
    const r = readBrand(root);
    assert.equal(r.origin, 'product');
    const assets = brandAssets(root, r.brand, r.origin);
    const css = brandCss(r.brand, assets);
    assert.match(css, /@font-face\{font-family:"Fernsans";src:url\(data:font\/woff2;base64,YWJj\) format\("woff2"\)/);
    assert.match(css, /--brand-primary:#2b7358;--brand-dark-primary:#/);
    assert.match(css, /--brand-font-body:"Fernsans", system-ui/);
    assert.match(css, /--brand-status-live:#0055ff/);
    assert.equal(/--brand-status-merged/.test(css), false);
    assert.ok(DATA_IMAGE_RE.test(assets.mark));
    // The map keeps its status colours unless the brand sets them.
    assert.match(PAGE_MAPS.map, /--merged:var\(--brand-status-merged, #d55181\)/);
    assert.match(PAGE_MAPS.map, /--bg:var\(--brand-dark-bg\)/, 'the map is always dark');
  } finally { done(ws); }
});

test('every page takes the brand: reports and the catalog carry it after their own CSS, with fonts and images allowed', async () => {
  const { ws, root } = product({ design: YAML_DESIGN, files: { 'design/assets/fernleaf-mark.svg': SVG } });
  try {
    await captured(() => runBrand(root, { action: 'init', json: true }));
    const { renderHtml: standupHtml } = await import('./standup.mjs');
    const { renderHtml: issuesHtml } = await import('./issues.mjs');
    const { renderIndex } = await import('./reports-dir.mjs');
    const css = brandForPage(root, 'issues').css;
    const issues = issuesHtml({ items: [], repos: [], notes: [], notRead: [], summary: { total: 0, status: {}, priority: {}, type: {}, unassigned: 0 }, unfiltered: 0 }, undefined, { brandCss: css });
    assert.match(issues, /--brand-primary:#2B7358/);
    assert.ok(issues.indexOf('--brand-primary') > issues.indexOf('--p0:'), 'after the page\'s own colours, so it wins');
    assert.match(issues, /img-src data:; font-src data:/);
    const index = renderIndex([], { brandCss: brandForPage(root, 'catalog').css });
    assert.match(index, /img-src data:; font-src data:/);
    assert.match(index, /body > main > h1::before/);
    assert.equal(typeof standupHtml, 'function');
  } finally { done(ws); }
});

test('yad brand from the CLI, and its agent classes', () => {
  const { ws, root } = product();
  try {
    const r = spawnSync(process.execPath, [YAD, 'brand', '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' } });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.command, 'brand show');
    assert.equal(out.origin, 'yadflow');
    assert.equal(classify(['brand']), 'read');
    assert.equal(classify(['brand', 'check']), 'read');
    assert.equal(classify(['brand', 'init']), 'on-request', 'it writes a committed file: only when the person asks');
  } finally { done(ws); }
});

// #553: the self-contained map and brain files carry the brand inside the ONE hashed style, so the CSP still
// allows it; fonts are allowed as data; the map's status colours keep their meaning unless the brand sets them.
test('#553: the map and brain files carry the brand inside the hashed style; status colours stay', async () => {
  const { ws, root } = product({ design: YAML_DESIGN, files: { 'design/assets/fernleaf-mark.svg': SVG } });
  try {
    await captured(() => runBrand(root, { action: 'init', json: true }));
    const { mapSnapshot } = await import('./map-view.mjs');
    const { snapshotHTML } = await import('./brain-view.mjs');
    const pages = [
      ['map', mapSnapshot({ epics: [] }, { brandCss: brandForPage(root, 'map').css })],
      ['brain', snapshotHTML({ nodes: [], edges: [] }, { brandCss: brandForPage(root, 'brain').css })],
      ['live', snapshotHTML({ nodes: [], edges: [] }, { live: true, brandCss: brandForPage(root, 'live').css })],
    ];
    for (const [page, html] of pages) {
      const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
      assert.match(csp, /font-src data:/, page);
      const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((x) => x[1]);
      assert.equal(styles.length, 1, `${page}: one inline style`);
      assert.match(styles[0], /--brand-primary:#2B7358/i, `${page}: the brand is in the style`);
      const hash = createHash('sha256').update(styles[0], 'utf8').digest('base64');
      assert.ok(csp.includes(`'sha256-${hash}'`), `${page}: the CSP allows the style with the brand in it`);
    }
    const mapCss = brandForPage(root, 'map').css;
    for (const [k, v] of [['live', '#3987e5'], ['merged', '#d55181'], ['active', '#c98500'], ['planned', '#93a0bf'], ['idle', '#5b6680']]) {
      assert.ok(mapCss.includes(`--${k}:var(--brand-status-${k}, ${v})`), `${k} keeps its colour`);
    }
    assert.ok(!/--brand-status-live:/.test(mapCss), 'no status colour unless the brand sets one');
  } finally { done(ws); }
});

test('#553: a standup page carries the brand after its own colours; with no brand file it is yadflow\'s look', async () => {
  const { renderHtml, buildStandup } = await import('./standup.mjs');
  const branded = product();
  try {
    const model = buildStandup(branded.root, { now: Date.now(), fetch: false, env: {}, access: () => 'yes' });
    const page = renderHtml(model, { brandCss: ':root{--brand-primary:#2B7358}' });
    assert.ok(page.indexOf('--brand-primary:#2B7358') > page.indexOf('--bg:'), 'after the page\'s own colours, so it wins');
    assert.equal(page.split('</style>').length, 2, 'still one style block');
    assert.ok(!renderHtml(model).includes('--brand-'), 'no brand CSS asked for, none added');
  } finally { done(branded.ws); }
  const { ws, root } = product();
  try {
    const css = brandForPage(root, 'standup').css;
    assert.match(css, /--brand-primary:#6316db/i, 'yadflow\'s purple');
    assert.match(css, /--brand-accent:#fb2576/i, 'yadflow\'s pink');
  } finally { done(ws); }
});

test('#553: the doctor row — none is fine, a broken file and a changed DESIGN.md are said', async () => {
  const { brandChecks } = await import('./doctor.mjs');
  const row = (root) => { const checks = []; brandChecks(root, checks); return checks.find((x) => x.id === 'brand'); };
  const none = product();
  const made = product({ design: YAML_DESIGN });
  try {
    assert.equal(row(none.root).status, 'ok');
    assert.match(row(none.root).message, /yadflow's look/);
    put(path.join(none.root, BRAND_FILE), '{ broken');
    assert.equal(row(none.root).status, 'warn');
    await captured(() => runBrand(made.root, { action: 'init', json: true }));
    assert.equal(row(made.root).status, 'ok');
    put(path.join(made.root, 'DESIGN.md'), `${YAML_DESIGN}\nMore words.\n`);
    assert.equal(row(made.root).status, 'warn');
    assert.match(row(made.root).message, /DESIGN\.md changed since/);
  } finally { done(none.ws, made.ws); }
});

// ---- review 1 -----------------------------------------------------------------------------------

test('#553 review 1: a long or nested dark block and a huge colour are read in linear time', { timeout: 5000 }, async () => {
  const { isColor } = await import('./brand.mjs');
  const dark = `.dark {${Array.from({ length: 40 }, (_, i) => ` --c${i}: #000;`).join('')} .card { color: red; } }`;
  let t = Date.now();
  const r = readRootVars(`:root{--bg:#fff}\n${dark}`);
  assert.ok(Date.now() - t < 1000, `read in ${Date.now() - t} ms`);
  t = Date.now();
  for (const hostile of ['{'.repeat(200000), '/*'.repeat(100000), '"'.repeat(200000), `:root{--a:1}${'.dark{'.repeat(50000)}--bg:#000${'}'.repeat(50000)}`]) readRootVars(hostile);
  assert.ok(Date.now() - t < 2000, `hostile input read in ${Date.now() - t} ms`);
  assert.equal(Object.keys(r.dark).length, 40);
  assert.deepEqual(readRootVars(`:root{--bg:#fff}\n@media (prefers-color-scheme: dark) { :root { --bg: #000; } }`).dark, { '--bg': '#000' });
  t = Date.now();
  assert.equal(isColor(`rgb(${' '.repeat(400000)}x`), false);
  assert.equal(isColor(`rgb(${'1 '.repeat(40)})`), false, 'longer than any colour');
  assert.ok(Date.now() - t < 200, `refused in ${Date.now() - t} ms`);
  assert.equal(isColor(' #2B7358 '), true);
});

test('#553 review 1: init through a linked Product writes a path inside it, never this machine\'s folders', async () => {
  const { ws, root } = product({ design: YAML_DESIGN });
  const link = path.join(ws, 'linked');
  fs.symlinkSync(root, link, 'dir');
  try {
    await captured(() => runBrand(link, { action: 'init', json: true }));
    const rec = JSON.parse(fs.readFileSync(path.join(root, BRAND_FILE), 'utf8'));
    assert.equal(rec.source, 'DESIGN.md');
    const r = await captured(() => runBrand(link, { action: 'check', json: true }));
    assert.equal(r.stale, null, 'staleness still tracked');
  } finally { done(ws); }
});

test('#553 review 1: a source that is a folder is said, never a crash; a hand-made file says staleness is not tracked', async () => {
  const { ws, root } = product({ files: { 'design/x.txt': 'x' } });
  try {
    put(path.join(root, BRAND_FILE), { version: 1, name: 'Hand', source: 'design', colors: { light: { primary: '#2B7358' } } });
    // With a fingerprint too: that is the path that once read the folder and threw.
    const withHash = product({ files: { 'design/x.txt': 'x' } });
    try {
      put(path.join(withHash.root, BRAND_FILE), { version: 1, name: 'Hand', source: 'design', sourceHash: 'sha256:00', colors: { light: { primary: '#2B7358' } } });
      assert.match((await captured(() => runBrand(withHash.root, { action: 'check', json: true }))).stale, /cannot be read/);
    } finally { done(withHash.ws); }
    const r = await captured(() => runBrand(root, { action: 'check', json: true }));
    const out = r;
    assert.match(out.stale, /cannot be read/);
    assert.ok(out.warnings.some((w) => /no sourceHash/.test(w)), out.warnings.join(' | '));
  } finally { done(ws); }
});

test('#553 review 1: bad status colours, backslash and drive paths are refused', () => {
  const { ws, root } = product({ files: { 'design/m.svg': SVG } });
  try {
    const base = { version: 1, name: 'X', colors: { light: { primary: '#2B7358' } } };
    assert.ok(checkBrand(root, { ...base, status: { live: '#fff;}' } }).problems.some((p) => /status\.live/.test(p)));
    assert.ok(checkBrand(root, { ...base, status: { live: '</style>' } }).problems.some((p) => /status\.live/.test(p)));
    for (const bad of ['..\\design\\m.svg', 'C:design/m.svg', '/etc/passwd', 'design/../../m.svg']) {
      assert.ok(checkBrand(root, { ...base, mark: bad }).problems.some((p) => /not a file inside the Product/.test(p)), bad);
    }
    assert.deepEqual(checkBrand(root, { ...base, mark: 'design/m.svg' }).problems, []);
  } finally { done(ws); }
});

test('#553 review 1: contrast reads each channel\'s own unit, and returns nothing for a unit it does not read', () => {
  assert.equal(contrast('rgb(100 100 100 / 50%)', '#fff').toFixed(1), '5.9');
  assert.equal(contrast('rgb(39.2% 39.2% 39.2%)', '#fff').toFixed(1), '5.9');
  assert.equal(contrast('oklch(0.5 0.1 250turn)', '#fff'), null);
  assert.ok(linearRgb('oklch(60% 40% 250)').every((x) => x >= 0 && x <= 1));
});

test('#553 review 1: a dark scheme without its primary takes the light one made lighter, not yadflow\'s purple', () => {
  const { ws, root } = product();
  try {
    put(path.join(root, BRAND_FILE), { version: 1, name: 'X', colors: { light: { primary: '#2B7358', accent: 'hsl(1 2% 3%)' }, dark: { bg: '#0D291F' } } });
    const r = readBrand(root);
    assert.equal(r.origin, 'product');
    assert.notEqual(r.brand.colors.dark.primary, YADFLOW_BRAND.colors.dark.primary);
    assert.match(r.brand.colors.dark.primary, /^#[0-9a-f]{6}$/);
    assert.equal(r.brand.colors.dark.accent, YADFLOW_BRAND.colors.dark.accent, 'one it cannot make lighter is yadflow\'s');
    assert.equal(r.brand.colors.dark.bg, '#0D291F');
  } finally { done(ws); }
});

test('#553 review 1: the doctor row never prints escape codes from the file', async () => {
  const { brandChecks } = await import('./doctor.mjs');
  const { ws, root } = product();
  try {
    put(path.join(root, BRAND_FILE), { version: 1, name: 'Evil\u001b]52;c;aGk=\u0007', colors: { light: { primary: '#2B7358' } } });
    const checks = [];
    brandChecks(root, checks);
    const row = checks.find((x) => x.id === 'brand');
    assert.ok(![...row.message].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f), JSON.stringify(row.message));
  } finally { done(ws); }
});

test('#553 review 1: the served map and brain style sheets carry the brand; the usage page too; init outside a Product is refused', async () => {
  const http = await import('node:http');
  const { startMapServer } = await import('./map-view.mjs');
  const { startBrainServer } = await import('./brain-view.mjs');
  const { ws, root } = product({ design: YAML_DESIGN });
  try {
    await captured(() => runBrand(root, { action: 'init', json: true }));
    const get = (port, p) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: p, headers: { Host: `127.0.0.1:${port}` } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
      req.on('error', reject); req.end();
    });
    for (const start of [() => startMapServer(root, { env: { YAD_REPORTS_DIR: path.join(ws, 'r') } }), () => startBrainServer(root, {})]) {
      const s = await start();
      try {
        const r = await get(s.port, `/style.css?t=${s.token}`);
        assert.equal(r.status, 200);
        assert.match(r.body, /--brand-primary:#2B7358/i);
      } finally { await s.close(); }
    }
    const U = await import('./usage.mjs');
    const page = U.renderHtml(U.analyze([], { since: null, until: null }), '2026-11-15', { brandCss: brandForPage(root, 'usage').css });
    assert.ok(page.includes('--bg') && page.indexOf('--brand-primary') > page.indexOf('--bg'));
  } finally { done(ws); }
  const plain = tmp();
  try {
    put(path.join(plain, 'DESIGN.md'), YAML_DESIGN);
    const r = spawnSync(process.execPath, [YAD, 'brand', 'init'], { cwd: plain, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' } });
    assert.notEqual(r.status, 0);
    assert.equal(fs.existsSync(path.join(plain, BRAND_FILE)), false);
  } finally { done(plain); }
});

// ---- review 2 -----------------------------------------------------------------------------------

test('#553 review 2: the dark block is read inside itself only, at its own level', () => {
  const dark = (t) => readRootVars(`:root{--bg:#fff}\n${t}`).dark;
  assert.deepEqual(dark('@media (prefers-color-scheme: dark) { :root { --bg:#000; --text:#eee } }'), { '--bg': '#000', '--text': '#eee' });
  assert.deepEqual(dark('[data-theme=dark] { --bg:#000 }'), { '--bg': '#000' });
  assert.deepEqual(dark('.dark{ --bg:#000; .card{ --bg:#222 } --text:#eee }'), { '--bg': '#000', '--text': '#eee' }, 'after a nested rule too, never the nested one');
  assert.deepEqual(dark('.dark{ .card{ color:red } --bg:#000 }'), { '--bg': '#000' });
  assert.equal(dark('@media (prefers-color-scheme: dark){ body{color:red} }\n.btn{ --pad:4px; --bg:#f00 }'), null, 'never a later component\'s');
  // Review 3: a dark media block whose first rule is not :root; an outer @media; comments and quotes; prose.
  assert.deepEqual(dark('@media (prefers-color-scheme: dark) { body{color:red} :root{--bg:#000} }'), { '--bg': '#000' });
  assert.deepEqual(dark('@media screen{.dark{--bg:#000}}'), { '--bg': '#000' });
  assert.deepEqual(dark('.x{}@media{}.dark{--bg:#000}'), { '--bg': '#000' });
  assert.deepEqual(dark('/* use [data-theme="dark"] */ .x{--pad:1px} [data-theme="dark"]{--bg:#000}'), { '--bg': '#000' });
  assert.deepEqual(dark('.dark { /* } */ --bg:#000 }'), { '--bg': '#000' });
  assert.deepEqual(dark('.dark { --icon:"}"; --bg:#000 }'), { '--icon': '"}"', '--bg': '#000' });
  assert.deepEqual(readRootVars('Dark mode follows prefers-color-scheme: dark.\n\n```css\n:root { --bg: #fff; --ink: #111 }\n@media (prefers-color-scheme: dark) { :root { --bg: #000 } }\n```'),
    { light: { '--bg': '#fff', '--ink': '#111' }, dark: { '--bg': '#000' } }, 'prose before the CSS is never a selector');
});

// Review 4: a real DESIGN.md is markdown — an apostrophe in a heading or prose, fences with an info string, a
// heading right above the dark block, Tailwind's `html.dark` and `:root.dark`.
test('#553 review 4: a markdown DESIGN.md with apostrophes, fences and html.dark is read in full', () => {
  const md = [
    "# Acme's design system", '', "The team's colours are below. A \"quote\" too.", '',
    '```css', ':root { --primary: #111; --q: "a\\"b"; --bg: #fff }', '```', '',
    "It's dark too:", '### Dark', '```css', '@media (prefers-color-scheme: dark) { :root { --bg: #000; --primary: #eee } }', '```', '',
  ].join('\n');
  assert.deepEqual(readRootVars(md), { light: { '--primary': '#111', '--q': '"a\\"b"', '--bg': '#fff' }, dark: { '--bg': '#000', '--primary': '#eee' } });
  assert.deepEqual(readRootVars(':root{--bg:#fff}\nhtml.dark{--bg:#000}').dark, { '--bg': '#000' });
  assert.deepEqual(readRootVars(':root.dark{--bg:#000}\n:root{--bg:#fff}'), { light: { '--bg': '#fff' }, dark: { '--bg': '#000' } }, ':root.dark is never the light look');
  assert.deepEqual(readRootVars(':root{--bg:#fff}\n.dark-mode{--bg:#000}').dark, { '--bg': '#000' });
  assert.equal(readRootVars(':root{--bg:#fff}\n.darkmode{--bg:#000}').dark, null);
  assert.equal(readRootVars(':root{--bg:#fff}\n.dark-blue{--bg:#000}').dark, null);
  assert.deepEqual(readRootVars(':root{--bg:#fff}\nDark mode:\n@media (prefers-color-scheme: dark){:root{--bg:#000}}').dark, { '--bg': '#000' });
  // Review 5: `:not(.dark)` is the light look; a `/*` in prose is not a comment; a quote inside a value.
  assert.deepEqual(readRootVars(':root:not(.dark){--bg:#fff}\n.dark{--bg:#000}'), { light: { '--bg': '#fff' }, dark: { '--bg': '#000' } });
  assert.equal(readRootVars(':root{--bg:#fff}\nhtml:not(.dark){--x:1}').dark, null);
  assert.deepEqual(readRootVars(':root:not([data-theme="dark"]){--bg:#fff}\n[data-theme="dark"]{--bg:#000}'), { light: { '--bg': '#fff' }, dark: { '--bg': '#000' } });
  assert.deepEqual(readRootVars('Tokens live in `styles/*.css`.\n\n```css\n:root{--bg:#fff} /* x */\n:root.dark{--bg:#000}\n```'), { light: { '--bg': '#fff' }, dark: { '--bg': '#000' } });
  assert.deepEqual(readRootVars("/* the team's tokens */\n:root{--font: 'Inter',\n  sans-serif; --bg:#fff}").light, { '--font': "'Inter',\n  sans-serif", '--bg': '#fff' });
});

test('#553 review 2: primary is checked as link text in yad brand check, never in the doctor row; yadflow\'s own look passes', async () => {
  const { brandChecks } = await import('./doctor.mjs');
  assert.deepEqual(contrastProblems(YADFLOW_BRAND, { links: true }), [], 'yadflow\'s own look reads');
  const { ws, root } = product();
  try {
    put(path.join(root, BRAND_FILE), { version: 1, name: 'Sky', colors: { light: { primary: '#0ea5e9' } } });
    const r = await captured(() => runBrand(root, { action: 'check', json: true }));
    assert.ok(r.contrast.some((x) => /primary \(links\)/.test(x)), r.contrast.join(' | '));
    const checks = [];
    brandChecks(root, checks);
    assert.equal(checks.find((x) => x.id === 'brand').status, 'ok', 'a button colour never warns in doctor');
  } finally { done(ws); }
});

test('#553 review 2: a dark primary is made lighter from rgb() too; one yadflow cannot read is yadflow\'s', async () => {
  const { lighter } = await import('./brand.mjs');
  assert.match(lighter('rgb(20 80 60)'), /^#[0-9a-f]{6}$/);
  assert.equal(lighter('hsl(1 2% 3%)'), null);
  assert.match(lighter('oklch(60% 0.2 250 / 50%)'), /^oklch\(0\.800 0\.2 250 \/ 50%\)$/);
});
