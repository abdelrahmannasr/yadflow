// E186 — a generated doc site wears the Product's brand (`yad docs brand <site>`). Every brand, name and file
// here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

const { runDocsBrand, onPrimary, between, docsSiteCss, docsHeadLines, docsBrandTs, brandFingerprint, siteBrandFingerprint, CSS_BEGIN, CSS_END, HEAD_BEGIN, TEMPLATE_HEAD, TEMPLATE_BRAND_TS } = await import('./docs-brand.mjs');
const { readBrand, BRAND_FILE } = await import('./brand.mjs');
const { docsStale, runDocs } = await import('./docs.mjs');
const { classify } = await import('./agent-rules.mjs');
const { endJSON } = await import('./lib.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAD = path.join(HERE, '..', 'bin', 'yad.mjs');
const TEMPLATE = path.join(HERE, '..', 'skills', 'yad-docs', 'templates', 'app');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-docs-brand-')));
const put = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof d === 'string' || Buffer.isBuffer(d) ? d : JSON.stringify(d, null, 2)); };
const done = (...d) => d.forEach((x) => fs.rmSync(x, { recursive: true, force: true }));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#2a7"/></svg>';
// Run quietly: the prose a command prints is not what the test reads. → its return value
async function quiet(fn) {
  const orig = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = orig; }
}
async function captured(fn) {
  const out = []; const orig = console.log;
  console.log = (s) => out.push(String(s));
  try { await fn(); } finally { console.log = orig; endJSON(); }
  return out.length ? JSON.parse(out.join('\n')) : null;
}

const SITE = 'epics/EP-x/docs-site';
const SITE_FILES = ['index.html', 'src/index.css', 'src/data/brand.ts'];
const BRAND = {
  version: 1, name: 'Fernleaf',
  colors: { light: { bg: '#f4f6ff', surface: '#ffffff', text: '#101828', muted: '#475467', border: '#d0d5dd', primary: 'oklch(0.5 0.1 160)', accent: '#e4a036' }, dark: null },
  fonts: { heading: { family: 'Fernsans', files: ['design/fern.woff2'] }, body: null, mono: null },
  logo: null, mark: 'design/mark.svg',
};

// A Product holding one site copied from the template (only the three files the brand touches).
function product({ brand = null, files = {} } = {}) {
  const ws = tmp();
  const root = path.join(ws, 'product');
  put(path.join(root, '.sdlc', 'product.json'), { name: 'Invented' });
  for (const f of SITE_FILES) put(path.join(root, SITE, f), fs.readFileSync(path.join(TEMPLATE, f)));
  if (brand) put(path.join(root, BRAND_FILE), brand);
  for (const [rel, data] of Object.entries(files)) put(path.join(root, rel), data);
  return { ws, root, site: (f) => fs.readFileSync(path.join(root, SITE, f), 'utf8') };
}
const branded = () => product({ brand: BRAND, files: { 'design/mark.svg': SVG, 'design/fern.woff2': Buffer.from('wOF2-invented-font-bytes') } });

test('docs brand: with no brand file the site keeps the template bytes exactly, and says so', async () => {
  const { ws, root, site } = product();
  try {
    const before = SITE_FILES.map(site);
    const out = await captured(() => runDocsBrand(root, { site: SITE, json: true }));
    assert.equal(out.origin, 'yadflow');
    assert.equal(out.theme, null);
    assert.equal(out.fingerprint, null);
    assert.deepEqual(out.wrote, []);
    assert.deepEqual(SITE_FILES.map(site), before);
    // The constants this writes for yadflow's look are the template's own: a run can always undo a brand.
    assert.equal(fs.readFileSync(path.join(TEMPLATE, 'src/data/brand.ts'), 'utf8'), TEMPLATE_BRAND_TS);
    const html = fs.readFileSync(path.join(TEMPLATE, 'index.html'), 'utf8');
    for (const line of TEMPLATE_HEAD) assert.ok(html.includes(`${line}\n`), `the template head holds: ${line}`);
  } finally { done(ws); }
});

test('docs brand: a brand writes the three places, the same bytes on every run, and undoes cleanly', async () => {
  const { ws, root, site } = branded();
  try {
    const template = SITE_FILES.map(site);
    const out = await captured(() => runDocsBrand(root, { site: SITE, json: true }));
    assert.equal(out.origin, 'product');
    assert.equal(out.theme, 'brand.json');
    assert.match(out.fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(out.wrote.sort(), ['index.html', 'src/data/brand.ts', 'src/index.css']);
    assert.deepEqual(out.fonts, ['Fernsans']);
    assert.equal(out.mark, true);
    const css = site('src/index.css');
    const block = css.slice(css.indexOf(CSS_BEGIN), css.indexOf(CSS_END));
    assert.ok(block.includes(`/* yad-brand:fingerprint ${out.fingerprint} */`));
    assert.match(block, /@font-face \{ font-family: "Fernsans"; src: url\(data:font\/woff2;base64,/);
    assert.match(block, /--font-display: "Fernsans", /);
    assert.match(block, /--font-body: "Fernsans", /, 'the body takes the heading font when the brand names only one');
    assert.doesNotMatch(block, /--font-mono/, 'no mono font: the template\'s stays');
    assert.match(block, /--color-primary: oklch\(0\.5 0\.1 160\);/, 'the light primary, as the brand wrote it');
    assert.match(block, /@media \(prefers-color-scheme: light\)/);
    // No dark scheme: the dark primary is the light one made lighter, as every other page does it.
    const r = readBrand(root);
    assert.ok(block.includes(`--color-primary: ${r.brand.colors.dark.primary};`));
    assert.notEqual(r.brand.colors.dark.primary, r.brand.colors.light.primary);
    assert.ok(css.lastIndexOf(CSS_END) > css.lastIndexOf('@layer base'), 'the brand block stays after the layers');
    const html = site('index.html');
    assert.match(html, /<link rel="icon" href="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" \/>/);
    assert.doesNotMatch(html, /Space\+Grotesk/, 'the brand has its own fonts: the template\'s link goes');
    assert.match(html, /Material\+Symbols/, 'the icon font stays');
    assert.match(site('src/data/brand.ts'), /name: "Fernleaf", mark: "data:image\/svg\+xml;base64,/);

    const again = await captured(() => runDocsBrand(root, { site: SITE, json: true }));
    assert.deepEqual(again.wrote, [], 'the same brand writes the same bytes');

    fs.rmSync(path.join(root, BRAND_FILE));
    const back = await captured(() => runDocsBrand(root, { site: SITE, json: true }));
    assert.equal(back.origin, 'yadflow');
    assert.deepEqual(SITE_FILES.map(site), template, 'with the brand gone, the site is the template again');
  } finally { done(ws); }
});

test('docs brand: a brand without fonts keeps the template font link; one without a mark keeps yadflow\'s icon', async () => {
  const { ws, root, site } = product({ brand: { ...BRAND, fonts: { heading: null, body: null, mono: null }, mark: null } });
  try {
    const out = await captured(() => runDocsBrand(root, { site: SITE, json: true }));
    assert.equal(out.origin, 'product');
    assert.equal(out.mark, false);
    const html = site('index.html');
    assert.ok(html.includes(TEMPLATE_HEAD[0]) && html.includes(TEMPLATE_HEAD[1]));
    assert.doesNotMatch(site('src/index.css'), /--font-display:\s*"/);
    assert.match(site('src/data/brand.ts'), /mark: null/);
  } finally { done(ws); }
});

test('docs brand: a brand file with problems puts yadflow\'s look back and names the problems', async () => {
  const { ws, root, site } = product({ brand: { ...BRAND, colors: { light: { ...BRAND.colors.light, bg: 'red; } body { display: none' } } } });
  try {
    const before = SITE_FILES.map(site);
    const out = await captured(() => runDocsBrand(root, { site: SITE, json: true }));
    assert.equal(out.origin, 'yadflow');
    assert.ok(out.problems.length > 0);
    assert.deepEqual(SITE_FILES.map(site), before);
    assert.doesNotMatch(site('src/index.css'), /display: none/);
  } finally { done(ws); }
});

test('docs brand: text on a primary fill is white, or near-black on a light primary', () => {
  assert.equal(onPrimary('#6316db'), '#ffffff');
  assert.equal(onPrimary('#9ee6d8'), '#111111', 'a light primary, as a dark look often has');
  assert.equal(onPrimary('oklch(0.9 0.08 180)'), '#111111');
  assert.equal(onPrimary('hsl(200 50% 90%)'), '#ffffff', 'a colour yadflow cannot read keeps white');
});

test('docs brand: a name cannot leave its string, and a mark that is not an image never reaches the page', () => {
  const r = { brand: { name: 'Evil"; alert(1); // x', fonts: {} }, origin: 'product' };
  const ts = docsBrandTs(r.brand, { mark: 'javascript:alert(1)', fonts: [] }, 'product');
  assert.match(ts, /name: "Evil\\"; alert\(1\); \/\/x", mark: null/);
  const head = docsHeadLines(r.brand, { mark: 'data:text/html;base64,AAAA', fonts: [] }, 'product');
  assert.equal(head[0], TEMPLATE_HEAD[0]);
  assert.equal(docsSiteCss({}, { fonts: [] }, 'yadflow'), '');
});

test('docs brand: missing or doubled markers are refused and nothing is written', async () => {
  for (const [file, cut] of [['src/index.css', CSS_END], ['index.html', HEAD_BEGIN], ['src/index.css', null]]) {
    const { ws, root, site } = branded();
    try {
      const full = path.join(root, SITE, file);
      const text = fs.readFileSync(full, 'utf8');
      fs.writeFileSync(full, cut ? text.replace(cut, '') : `${text}\n${CSS_BEGIN}\n${CSS_END}\n`);
      const before = SITE_FILES.map(site);
      const out = await captured(() => runDocsBrand(root, { site: SITE, json: true }));
      assert.equal(out.ok, false, `${file} ${cut ?? 'doubled'}`);
      assert.match(out.error, /yad-brand markers/);
      assert.match(out.hint, /theme-map\.md/);
      assert.deepEqual(SITE_FILES.map(site), before);
      process.exitCode = 0;
    } finally { done(ws); }
  }
});

test('docs brand: the site must be a folder inside the Product reached through no link', async () => {
  const { ws, root } = branded();
  try {
    const outside = path.join(ws, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(path.join(root, 'epics'), path.join(root, 'linked'));
    for (const bad of ['../outside', outside, 'linked/EP-x/docs-site', 'epics/EP-x', '.', '', 'epics/none']) {
      const out = await captured(() => runDocsBrand(root, { site: bad, json: true }));
      assert.equal(out.ok, false, `refused: ${JSON.stringify(bad)}`);
      process.exitCode = 0;
    }
    const extra = await captured(() => runDocsBrand(root, { site: SITE, args: ['more'], json: true }));
    assert.equal(extra.ok, false);
    process.exitCode = 0;
  } finally { done(ws); }
});

test('docs brand: a site file that is a link is refused, never written through', async () => {
  const { ws, root } = branded();
  try {
    const target = path.join(ws, 'elsewhere.ts');
    fs.writeFileSync(target, 'kept');
    const ts = path.join(root, SITE, 'src/data/brand.ts');
    fs.rmSync(ts);
    fs.symlinkSync(target, ts);
    const out = await captured(() => runDocsBrand(root, { site: SITE, json: true }));
    assert.equal(out.ok, false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'kept');
    process.exitCode = 0;
  } finally { done(ws); }
});

test('docs brand: between() replaces only the lines between the markers, keeping the end marker\'s indent', () => {
  const t = 'a\n  <!-- b -->\n  old\n  <!-- e -->\nz\n';
  assert.equal(between(t, '<!-- b -->', '<!-- e -->', '  new'), 'a\n  <!-- b -->\n  new\n  <!-- e -->\nz\n');
  assert.equal(between(t, '<!-- b -->', '<!-- e -->', ''), 'a\n  <!-- b -->\n  <!-- e -->\nz\n');
  assert.equal(between('<!-- b --><!-- e -->', '<!-- b -->', '<!-- e -->', 'x'), null, 'markers on one line');
  assert.equal(between('<!-- e -->\n<!-- b -->\n', '<!-- b -->', '<!-- e -->', 'x'), null, 'markers out of order');
});

test('docs brand: the fingerprint follows brand.json and every file it names, and a site records it', async () => {
  const { ws, root, site } = branded();
  try {
    const one = brandFingerprint(root);
    fs.writeFileSync(path.join(root, 'design/mark.svg'), SVG.replace('#2a7', '#a27'));
    const two = brandFingerprint(root);
    assert.notEqual(one, two, 'a new mark is a new brand');
    fs.writeFileSync(path.join(root, 'design/fern.woff2'), 'wOF2-other');
    assert.notEqual(brandFingerprint(root), two, 'a new font file is a new brand');
    assert.equal(siteBrandFingerprint(site('src/index.css')), null, 'a template site wears no brand yet');
    await captured(() => runDocsBrand(root, { site: SITE, json: true }));
    assert.equal(siteBrandFingerprint(site('src/index.css')), brandFingerprint(root));
    assert.equal(siteBrandFingerprint('body{}'), undefined, 'a site made before the brand block: nothing to compare');
    fs.rmSync(path.join(root, BRAND_FILE));
    assert.equal(brandFingerprint(root), null);
  } finally { done(ws); }
});

test('docs brand: staleness — a changed or removed brand makes a branded site stale; an old site is not judged', async () => {
  const m = { artifactHash: 'sha256:aaa' };
  assert.equal(docsStale(m, { artifactHash: 'sha256:aaa', brand: { wears: 'sha256:1', now: 'sha256:1' } }).stale, false);
  assert.deepEqual(docsStale(m, { artifactHash: 'sha256:aaa', brand: { wears: 'sha256:1', now: 'sha256:2' } }).reasons, ['the Product\'s brand changed (yad docs brand <site>)']);
  assert.deepEqual(docsStale(m, { artifactHash: 'sha256:aaa', brand: { wears: 'sha256:1', now: null } }).reasons, ['the Product\'s brand was removed or cannot be used (yad docs brand <site>)']);
  assert.deepEqual(docsStale(m, { artifactHash: 'sha256:aaa', brand: { wears: null, now: 'sha256:2' } }).reasons, ['the Product\'s brand changed (yad docs brand <site>)']);
  assert.equal(docsStale(m, { artifactHash: 'sha256:aaa', brand: { wears: undefined, now: 'sha256:2' } }).stale, false);
  assert.equal(docsStale(m, { artifactHash: 'sha256:aaa', brand: { wears: null, now: null } }).stale, false);

  // End to end: `yad docs sync` reads the site's own index.css.
  const { ws, root } = branded();
  try {
    put(path.join(root, 'epics/EP-x/.sdlc/docs-build.json'), { builtAt: '2026-11-16' });
    put(path.join(root, 'epics/EP-x/.sdlc/state.json'), { repos: [] });
    const first = await quiet(() => runDocs(root, { action: 'sync', sync: 'check' }));
    assert.equal(first.stale, 1, 'the Product has a brand the site does not wear yet');
    await captured(() => runDocsBrand(root, { site: SITE, json: true }));
    const after = await quiet(() => runDocs(root, { action: 'sync', sync: 'check' }));
    assert.equal(after.stale, 0);
    process.exitCode = 0;
  } finally { done(ws); }
});

test('docs brand: an agent runs it as a local write; the CLI routes it and refuses outside a Product', () => {
  assert.equal(classify(['docs', 'brand', SITE]), 'local-write');
  const { ws, root } = branded();
  try {
    const env = { ...process.env, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' };
    const r = spawnSync(process.execPath, [YAD, 'docs', 'brand', SITE, '--json'], { cwd: root, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.theme, 'brand.json');
    const plain = path.join(ws, 'plain');
    fs.mkdirSync(plain);
    const no = spawnSync(process.execPath, [YAD, 'docs', 'brand', SITE], { cwd: plain, encoding: 'utf8', env });
    assert.notEqual(no.status, 0);
  } finally { done(ws); }
});
