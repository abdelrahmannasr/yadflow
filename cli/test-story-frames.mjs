// #354: each story records its design frames (`design-frames: [id, …]`), `yad story frames` reads them
// with their names and links from the epic's design-links.json, and `yad doctor` warns on any it cannot
// read. One rule (`frameFindings`) decides for both, and every finding is a warning in both.
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

const { frameFindings, readDesignLinks, readStoryFrames, allStoryFrames, FRAMES_KEY } = await import('./story-frames.mjs');
const { storyFrameChecks } = await import('./doctor.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAD = path.join(HERE, '..', 'bin', 'yad.mjs');
const REPO = path.join(HERE, '..');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-frames-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const done = (T) => fs.rmSync(T, { recursive: true, force: true });
const story = (id, line) => `---\nid: ${id}\nepic: ${id.replace(/-S\d+$/, '')}\nstatus: draft\nrepos: [web]\n${line === null ? '' : `${line}\n`}---\n\n## Story\n`;
const LINKS = {
  tool: 'pencil', fileUrl: 'https://design.example/f', direction: 'generate', source: 'pencil',
  screens: [
    { name: 'Cart', platform: 'web', nodeId: '12:34', url: 'https://design.example/f?node=12:34' },
    { name: 'Pay', platform: 'mobile', nodeId: 'aB3xQ', url: 'https://design.example/f?node=aB3xQ' },
  ],
};
const ok = { state: 'ok', tool: 'pencil', fileUrl: LINKS.fileUrl, screens: LINKS.screens };
const kinds = (r) => r.findings.map((f) => f.kind);
const BOM = String.fromCharCode(0xfeff);

// A Product with one epic: its design-links.json (or none) and the given stories.
function product(stories, links = LINKS) {
  const T = tmp();
  const epic = path.join(T, 'epics', 'EP-shop');
  fs.mkdirSync(epic, { recursive: true });
  if (links !== null) put(path.join(epic, '.sdlc', 'design-links.json'), links);
  for (const [id, line] of Object.entries(stories)) put(path.join(epic, 'stories', `${id}.md`), story(id, line));
  return T;
}
const yad = (T, ...args) => spawnSync(process.execPath, [YAD, ...args, '--dir', T], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1' } });

test('#354: frameFindings — no key, an empty list, and IDs that all resolve', () => {
  assert.deepEqual(frameFindings({}, ok), { recorded: false, ids: [], frames: [], findings: [] });
  const none = frameFindings({ [FRAMES_KEY]: [] }, { state: 'missing' });
  assert.equal(none.recorded, true);
  assert.deepEqual(none.findings, [], '`[]` needs no design-links.json — a story with no screens');
  const r = frameFindings({ [FRAMES_KEY]: ['12:34', 'aB3xQ'] }, ok);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.frames, [
    { id: '12:34', found: true, name: 'Cart', platform: 'web', url: LINKS.screens[0].url },
    { id: 'aB3xQ', found: true, name: 'Pay', platform: 'mobile', url: LINKS.screens[1].url },
  ], 'a Figma 12:34 ID and a Pencil-style ID both resolve');
});

test('#354: frameFindings — every problem is a finding, never a silent "no frames"', () => {
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12:34', '99:99'] }, ok)), ['not-found']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: '[12:34] # the cart' }, ok)), ['commented'], 'the comment trap');
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: '' }, ok)), ['not-a-list'], 'blank — what a `- id` block list reads as');
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: '12:34' }, ok)), ['not-a-list']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12 34'] }, ok)), ['bad-id', 'not-found']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12:34', '12:34'] }, ok)), ['duplicate']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12:34'] }, { state: 'missing' })), ['no-design-links']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12:34'] }, { state: 'unreadable', why: 'x' })), ['design-links-unreadable']);
});

test('#354: frameFindings — text from the files reaches the terminal cleaned', () => {
  const r = frameFindings({ [FRAMES_KEY]: ['\x1b[31m1:2'] }, ok);
  for (const f of r.findings) assert.ok(!f.message.includes('\x1b'), f.message);
});

test('#354: readDesignLinks — missing, not JSON, no screens list, and ok', () => {
  const T = tmp();
  try {
    assert.equal(readDesignLinks(T).state, 'missing');
    put(path.join(T, '.sdlc', 'design-links.json'), '{ nope');
    assert.equal(readDesignLinks(T).state, 'unreadable');
    put(path.join(T, '.sdlc', 'design-links.json'), { tool: 'figma' });
    assert.equal(readDesignLinks(T).state, 'unreadable');
    put(path.join(T, '.sdlc', 'design-links.json'), LINKS);
    const r = readDesignLinks(T);
    assert.equal(r.state, 'ok');
    assert.equal(r.screens.length, 2);
  } finally { done(T); }
});

test('#354: the frontmatter reader round-trips the key the stories step writes', () => {
  const T = product({ 'EP-shop-S01': `${FRAMES_KEY}: [12:34, aB3xQ]`, 'EP-shop-S02': `${FRAMES_KEY}: []`, 'EP-shop-S03': null });
  try {
    assert.deepEqual(readStoryFrames(T, 'EP-shop-S01').frames.map((f) => f.found), [true, true]);
    const s2 = readStoryFrames(T, 'EP-shop-S02');
    assert.deepEqual([s2.recorded, s2.ids, s2.findings], [true, [], []]);
    assert.equal(readStoryFrames(T, 'EP-shop-S03').recorded, false);
    assert.throws(() => readStoryFrames(T, 'EP-shop-S09'), /no story file/);
    assert.throws(() => readStoryFrames(T, 'shop'), /not a story id/);
    assert.throws(() => readStoryFrames(T, undefined), /needs a story id/);
  } finally { done(T); }
});

test('#354: yad story frames — text, --json, and the exit code', () => {
  const T = product({ 'EP-shop-S01': `${FRAMES_KEY}: [12:34, 99:99]` });
  try {
    const text = yad(T, 'story', 'frames', 'EP-shop-S01');
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /12:34 {2}Cart {2}\[web\]/);
    assert.match(text.stdout, /99:99 — not found/);
    const j = yad(T, 'story', 'frames', 'EP-shop-S01', '--json');
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    assert.equal(out.command, 'story frames');
    assert.equal(out.ok, true);
    assert.equal(out.tool, 'pencil');
    assert.deepEqual(out.frames.map((f) => [f.id, f.found]), [['12:34', true], ['99:99', false]]);
    assert.deepEqual(out.findings.map((f) => f.kind), ['not-found']);
    assert.equal(out.warnings.length, 1, 'a missing frame is a warning, and the exit code stays 0');

    const gone = yad(T, 'story', 'frames', 'EP-shop-S09', '--json');
    assert.equal(gone.status, 1);
    const g = JSON.parse(gone.stdout);
    assert.equal(g.ok, false);
    assert.match(g.hint, /story id/);
    assert.equal(yad(T, 'story', 'paint').status, 1, 'an unknown action is refused');
  } finally { done(T); }
});

test('#354: doctor — no row without frames, an ok row with a count, one warn row naming the problems', () => {
  const run = (T) => { const checks = []; storyFrameChecks(checks, T); return checks; };
  let T = product({ 'EP-shop-S01': null });
  try { assert.deepEqual(run(T), []); } finally { done(T); }

  T = product({ 'EP-shop-S01': `${FRAMES_KEY}: [12:34]`, 'EP-shop-S02': `${FRAMES_KEY}: []` }, LINKS);
  try {
    const [row, ...rest] = run(T);
    assert.equal(rest.length, 0);
    assert.deepEqual([row.id, row.status], ['stories:design-frames', 'ok']);
    assert.match(row.message, /^1 story\(ies\) record design frames.*; 1 story\(ies\) say they have no screens/);
  } finally { done(T); }

  T = product({ 'EP-shop-S01': `${FRAMES_KEY}: [12:34] # cart`, 'EP-shop-S02': `${FRAMES_KEY}: [77:1]` });
  try {
    const rows = run(T);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].id, rows[0].status], ['stories:design-frames', 'warn']);
    assert.match(rows[0].message, /^2 problem/);
    assert.match(rows[0].message, /EP-shop-S01: .*#/);
    assert.match(rows[0].message, /EP-shop-S02: .*77:1/);
    assert.deepEqual(allStoryFrames(T, ['EP-shop']).map((s) => s.findings[0].kind), ['commented', 'not-found']);
  } finally { done(T); }
});

test('#354 review 1: Windows line endings, a byte-order mark and a trailing space still read the list', () => {
  const T = product({});
  try {
    const dir = path.join(T, 'epics', 'EP-shop', 'stories');
    put(path.join(dir, 'EP-shop-S01.md'), story('EP-shop-S01', `${FRAMES_KEY}: [12:34]`).replace(/\n/g, '\r\n'));
    put(path.join(dir, 'EP-shop-S02.md'), BOM + story('EP-shop-S02', `${FRAMES_KEY}: [12:34]`));
    put(path.join(dir, 'EP-shop-S03.md'), story('EP-shop-S03', `${FRAMES_KEY}: [12:34]  `));
    for (const id of ['EP-shop-S01', 'EP-shop-S02', 'EP-shop-S03']) {
      const r = readStoryFrames(T, id);
      assert.deepEqual([r.recorded, r.frames.map((f) => f.found), r.findings], [true, [true], []], id);
    }
    assert.deepEqual(allStoryFrames(T, ['EP-shop']).map((s) => s.findings.length), [0, 0, 0], 'doctor reads them the same way');
  } finally { done(T); }
});

test('#354 review 1: a misspelled key and quoted IDs are said, not read as "no frames" or "not found"', () => {
  for (const k of ['Design-Frames', 'designFrames', 'design_frames']) {
    const r = frameFindings({ [k]: ['12:34'] }, ok);
    assert.deepEqual([r.recorded, kinds(r)], [false, ['key-spelling']], k);
  }
  const q = frameFindings({ [FRAMES_KEY]: ['"12:34"', "'aB3xQ'"] }, ok);
  assert.deepEqual(kinds(q), ['quoted']);
  assert.deepEqual(q.frames.map((f) => [f.id, f.found]), [['12:34', true], ['aB3xQ', true]]);
  assert.doesNotMatch(frameFindings({ [FRAMES_KEY]: 'x y' }, ok).findings[0].message, /\[\[/, 'never advice to double the brackets');
});

test('#354 review 1: doctor never points at a command that would refuse the story', () => {
  const T = product({ 'EP-shop-S01': `${FRAMES_KEY}: []` });
  try {
    const dir = path.join(T, 'epics', 'EP-shop', 'stories');
    put(path.join(dir, 'EP-Shop-S04.md'), story('EP-Shop-S04', `${FRAMES_KEY}: [12:34]`));
    put(path.join(dir, 'EP-other-S01.md'), story('EP-other-S01', `${FRAMES_KEY}: [12:34]`));
    fs.mkdirSync(path.join(dir, 'EP-shop-S07.md'));
    const rows = allStoryFrames(T, ['EP-shop']);
    assert.deepEqual(rows.map((s) => [s.story, kinds(s)]), [['EP-Shop-S04', ['not-a-story-file']], ['EP-other-S01', ['not-a-story-file']], ['EP-shop-S01', []]]);
    for (const s of rows.filter((x) => x.findings.length)) assert.match(s.findings[0].message, /rename the file/);
    assert.throws(() => readStoryFrames(T, 'EP-shop-S07'), /no story file/, 'a folder named like a story is refused, not a crash');
    const checks = [];
    storyFrameChecks(checks, T);
    assert.equal(checks[0].status, 'warn');
  } finally { done(T); }
});

test('#354 review 1: the ok row tells stories with frames from stories with no screens', () => {
  const T = product({ 'EP-shop-S01': `${FRAMES_KEY}: []` }, null);
  try {
    const checks = [];
    storyFrameChecks(checks, T);
    assert.equal(checks[0].status, 'ok');
    assert.match(checks[0].message, /^1 story\(ies\) say they have no screens/);
    assert.equal(yad(T, 'story', 'frames', 'EP-shop-S01', 'EP-shop-S02').status, 1, 'one story at a time');
  } finally { done(T); }
});

test('#354 review 2: doctor reads what the command reads — a symlinked story, a misspelled key', () => {
  const T = product({ 'EP-shop-S02': 'designFrames: [12:34]' });
  try {
    const dir = path.join(T, 'epics', 'EP-shop', 'stories');
    put(path.join(T, 'elsewhere.md'), story('EP-shop-S01', `${FRAMES_KEY}: [9:9]`));
    fs.symlinkSync(path.join(T, 'elsewhere.md'), path.join(dir, 'EP-shop-S01.md'));
    assert.deepEqual(kinds(readStoryFrames(T, 'EP-shop-S01')), ['not-found']);
    assert.deepEqual(allStoryFrames(T, ['EP-shop']).map((s) => [s.story, kinds(s)]), [['EP-shop-S01', ['not-found']], ['EP-shop-S02', ['key-spelling']]]);
    const checks = [];
    storyFrameChecks(checks, T);
    assert.equal(checks[0].status, 'warn');
    assert.match(checks[0].hint, /rename a story file/);
  } finally { done(T); }
});

test('#354 review 2: a misspelled key beside the right one is said; `""` is not an empty ID', () => {
  const both = frameFindings({ [FRAMES_KEY]: ['12:34'], designFrames: ['56:78'] }, ok);
  assert.deepEqual(kinds(both), ['key-spelling']);
  assert.match(both.findings[0].message, /move its IDs/);
  const empty = frameFindings({ [FRAMES_KEY]: ['""'] }, ok);
  assert.deepEqual(kinds(empty), ['not-found'], '`""` is left as it is, never turned into an empty ID');
  assert.deepEqual(empty.ids, ['""']);
  assert.match(frameFindings({ [FRAMES_KEY]: ['"12:34"'] }, ok).findings[0].message, /should be written without quotes/);
});

const { designPreflight, readDesignConfig } = await import('./story-frames.mjs');
const { TOOLBOX, toolProblems, reachFor } = await import('./toolbox.mjs');

test('#358: designPreflight — Pencil is read through the app; Figma only through its desktop server', () => {
  const frames = [{ id: '99:1', found: false }, { id: '12:34', found: true }];
  const links = { state: 'ok', fileUrl: 'design/app.pen', screens: [] };
  const pencil = designPreflight({ state: 'ok', data: { tool: 'pencil', provider: 'pencil-mcp' } }, links, frames);
  assert.deepEqual([pencil.reachable, pencil.appBound, pencil.frame, pencil.file], ['check', true, '12:34', 'design/app.pen'], 'the first frame that resolves is the one probed');
  assert.match(pencil.stop, /^Open the Pencil desktop app with `design\/app\.pen` loaded/);
  assert.match(pencil.probe, /get_app_state/);
  // E165: the command to connect the tool, when it is not on this machine at all.
  assert.equal(pencil.connect, 'yad toolbox connect pencil --json');
  const desk = designPreflight({ state: 'ok', data: { tool: 'figma', provider: 'figma-desktop' } }, links, frames);
  assert.deepEqual([desk.appBound, /desktop app/.test(desk.stop)], [true, true]);
  const cloud = designPreflight({ state: 'ok', data: { tool: 'figma', provider: 'figma' } }, links, frames);
  assert.deepEqual([cloud.appBound, /^Sign in to Figma/.test(cloud.stop), cloud.connect], [false, true, 'yad toolbox connect figma --json']);
  assert.match(cloud.probe, /`12:34`/);
  const old = designPreflight({ state: 'ok', data: { tool: 'figma', provider: 'figma-mcp' } }, links, frames);
  assert.deepEqual([old.appBound, /desktop app.*or sign in/.test(old.stop)], [null, true], 'the older figma-mcp: yad cannot tell, so both');
  const viaSource = designPreflight({ state: 'ok', data: { tool: 'figma', source: 'figma-desktop' } }, links, frames);
  assert.deepEqual([viaSource.provider, viaSource.appBound], ['figma-desktop', true], 'no provider: source names the server');
  const noFile = designPreflight({ state: 'ok', data: { tool: 'pencil', project_url: 'https://team/project' } }, { state: 'ok', tool: 'pencil', fileUrl: null, screens: [] }, frames);
  assert.match(noFile.stop, /the design file/, 'no file: said plainly — a project_url is a project, never compared as the file');
  const switched = designPreflight({ state: 'ok', data: { tool: 'pencil' } }, { state: 'ok', tool: 'figma', fileUrl: 'https://figma/f', screens: [] }, frames);
  assert.deepEqual([switched.reachable, /recorded for figma.*re-run the UI step/.test(switched.why)], ['not-checkable', true], 'frames of another tool are never probed through this one');
  const odd = designPreflight({ state: 'ok', data: { tool: 'figma', source: 'figma-dev-mode-mcp-server' } }, links, frames);
  assert.deepEqual([odd.reachable, odd.appBound], ['check', null], 'an MCP id yad does not know is still probed, with both messages');
  assert.equal(designPreflight({ state: 'ok', data: { tool: 'figma', provider: 'Figma-Desktop' } }, links, frames).appBound, true, 'names are compared in lower case');
  for (const provider of ['HTML-to-Design', 'html.to.design', ' html_to_design ']) {
    assert.equal(designPreflight({ state: 'ok', data: { tool: 'figma', provider } }, links, frames).reachable, 'not-checkable', provider);
  }
  assert.equal(designPreflight({ state: 'ok', data: { tool: 'figma' } }, { ...links, tool: 'Figma' }, frames).reachable, 'check', 'the same tool in other letters is not a switch');
});

test('#358: designPreflight — nothing to probe is not-checkable, and no frame means no preflight', () => {
  const frames = [{ id: '12:34', found: true }];
  const links = { state: 'ok', fileUrl: 'f', screens: [] };
  for (const design of [{ state: 'missing' }, { state: 'unreadable' }, { state: 'ok', data: { tool: 'none' } }, { state: 'ok', data: { tool: 'pencil', source: 'unavailable' } }, { state: 'ok', data: { tool: 'sketch' } }]) {
    const r = designPreflight(design, links, frames);
    assert.equal(r.reachable, 'not-checkable', JSON.stringify(design));
    assert.equal(r.connect, undefined, 'nothing to probe, nothing to connect: connecting the team\'s tool is yad-connect-design\'s');
  }
  assert.equal(designPreflight({ state: 'ok', data: { tool: 'pencil' } }, links, []), null);
  // E164: OpenPencil has no reach rule until its second PR — not checkable, said plainly.
  assert.deepEqual(designPreflight({ state: 'ok', data: { tool: 'openpencil', provider: 'openpencil-mcp' } }, links, frames),
    { tool: 'openpencil', reachable: 'not-checkable', why: 'yad has no reachability check for openpencil' });
  const writer = designPreflight({ state: 'ok', data: { tool: 'figma', provider: 'html-to-design' } }, links, frames);
  assert.deepEqual([writer.reachable, /cannot read a frame/.test(writer.why)], ['not-checkable', true]);
  const gone = designPreflight({ state: 'ok', data: { tool: 'pencil' } }, { state: 'missing' }, [{ id: '9:9', found: false }]);
  assert.match(gone.why, /no design-links\.json/, 'a missing file is named, not blamed on the IDs');
  assert.match(designPreflight({ state: 'ok', data: { tool: 'pencil' } }, { state: 'unreadable', why: 'it does not parse as JSON' }, [{ id: '9:9', found: false }]).why, /cannot be read/);
  const unresolved = designPreflight({ state: 'ok', data: { tool: 'pencil' } }, links, [{ id: '9:9', found: false }]);
  assert.deepEqual([unresolved.reachable, /fix the frame IDs/.test(unresolved.why)], ['not-checkable', true]);
  for (const data of [{ tool: 123 }, { tool: 'figma', provider: {} }, { tool: 'pencil', source: ['unavailable'] }]) {
    const r = designPreflight({ state: 'ok', data }, links, frames);
    assert.ok(r && ['check', 'not-checkable'].includes(r.reachable), JSON.stringify(data));
  }
  const dirty = designPreflight({ state: 'ok', data: { tool: 'pencil' } }, { state: 'ok', fileUrl: 'a\x1b[31mb', screens: [] }, frames);
  assert.ok(!dirty.stop.includes('\x1b') && !dirty.probe.includes('\x1b'));
});

test('#358: readDesignConfig, the reach data, and preflight through the command', () => {
  for (const t of TOOLBOX.filter((x) => x.reach)) assert.deepEqual(toolProblems(t), [], t.id);
  const figma = TOOLBOX.find((x) => x.id === 'figma');
  assert.deepEqual(toolProblems({ ...figma, reach: { app: 'F', probe: 'p', open: 'o', readers: true, appBound: ['x'] } }), ['reach.signIn and reach.either say what to do when the provider needs no app, or yad cannot tell']);
  assert.ok(toolProblems({ ...figma, reach: { readers: true, appBound: true } }).includes('reach has app, probe and open'));
  assert.ok(toolProblems({ ...figma, reach: null }).length > 0);
  assert.ok(toolProblems({ ...figma, reach: { ...figma.reach, appBound: false } }).includes('reach.appBound is true, or the providers read through the app'));
  assert.equal(reachFor('repomix'), null);
  const T = product({ 'EP-shop-S01': `${FRAMES_KEY}: [12:34]`, 'EP-shop-S02': `${FRAMES_KEY}: []` });
  try {
    assert.equal(readDesignConfig(T).state, 'missing');
    put(path.join(T, '.sdlc', 'design.json'), '{ nope');
    assert.equal(readDesignConfig(T).state, 'unreadable');
    put(path.join(T, '.sdlc', 'design.json'), { tool: 'pencil', provider: 'pencil-mcp', source: 'pencil-mcp', auth: 'user' });
    const j = JSON.parse(yad(T, 'story', 'frames', 'EP-shop-S01', '--json').stdout);
    assert.deepEqual([j.preflight.reachable, j.preflight.tool, j.preflight.appBound], ['check', 'pencil', true]);
    assert.match(yad(T, 'story', 'frames', 'EP-shop-S01').stdout, /before UI work: .* if that fails, stop: Open the Pencil desktop app[\s\S]*if pencil is not on this machine at all, your agent can offer to connect it first: `yad toolbox connect pencil --json`/);
    assert.equal(j.preflight.connect, 'yad toolbox connect pencil --json');
    assert.equal(JSON.parse(yad(T, 'story', 'frames', 'EP-shop-S02', '--json').stdout).preflight, null, 'no screens, no probe');
  } finally { done(T); }
});

test('#354: the stories, spec and implement skills all name `yad story frames`', () => {
  for (const skill of ['yad-stories', 'yad-spec', 'yad-implement']) {
    const body = fs.readFileSync(path.join(REPO, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.ok(body.includes('yad story frames'), `${skill} does not read the story's frames`);
  }
  const schema = fs.readFileSync(path.join(REPO, 'skills', 'yad-stories', 'references', 'story-schema.md'), 'utf8');
  assert.ok(schema.includes(FRAMES_KEY), 'the story schema names the key');
  const template = fs.readFileSync(path.join(REPO, 'skills', 'yad-stories', 'SKILL.md'), 'utf8');
  assert.match(template, new RegExp(`^${FRAMES_KEY}: \\[\\]$`, 'm'), 'the template ships the key bare, with no trailing comment');
});

test('#358: spec and implement probe the design tool first, stop on a failure, and record an override', () => {
  for (const [skill, where] of [['yad-spec', '## Clarifications'], ['yad-implement', 'Decisions:']]) {
    const body = fs.readFileSync(path.join(REPO, 'skills', skill, 'SKILL.md'), 'utf8');
    for (const word of ['preflight.probe', 'not-checkable', where]) assert.ok(body.includes(word), `${skill} lacks ${word}`);
    assert.match(body, /STOP\W+print `preflight\.stop` word for word/i, `${skill} does not stop with the message`);
  }
  const ctx = fs.readFileSync(path.join(REPO, 'skills', 'yad-connect-design', 'references', 'design-context.md'), 'utf8');
  assert.ok(ctx.includes('Reachable before Build (#358)'));
  const connect = fs.readFileSync(path.join(REPO, 'skills', 'yad-connect-design', 'SKILL.md'), 'utf8');
  for (const p of ['figma-desktop', '`figma`', 'html-to-design']) assert.ok(connect.includes(p), `yad-connect-design does not name the ${p} provider`);
  const example = connect.slice(connect.indexOf('### Step 2'), connect.indexOf('### Step 3'));
  assert.ok(example.includes('"provider": "figma-desktop"') && !example.includes('figma-mcp'), 'the registry example records a provider the preflight can read');
});
