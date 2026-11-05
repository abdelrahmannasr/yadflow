// #354 — each story records the design frames it builds, so the developer never has to ask which ones.
//
// The stories step writes the frame IDs into the story's frontmatter, as one inline list:
//
//   design-frames: [12:34, 56:78]
//
// The IDs only. Each one is a `nodeId` the UI step already recorded in the epic's
// `.sdlc/design-links.json` (`screens[]`: name, platform, nodeId, url), and the name and URL are read
// from there, so they are written down once. `design-frames: []` says the story has no screens (a
// backend story); no key at all says nobody recorded them.
//
// ONE RULE, TWO READERS. `frameFindings` decides every problem; `yad story frames` and `yad doctor` both
// print what it returns, and every finding is a warning in both, so the two can never disagree about a
// story. The only refusals are about the command line itself: a word that is not a story id, or a story
// with no file.
//
// The frontmatter reader is `readFrontmatter`: one line per key, a `[ … ]` value split on commas, and
// everything else kept as the rest of the line. So a trailing `# note` turns the list into a plain
// string, and a YAML `- item` list on the next lines is not read at all (the key reads as blank). Both
// are reported here instead of being read as "no frames".
import fs from 'node:fs';
import path from 'node:path';

import { c, emitJSON, forTerminal, hand, info, log, ok, readJSONStrict, refuse, stripAnsi, warn } from './lib.mjs';
import { epicRoot, parseFrontmatter } from './epic-state.mjs';
import { STORY_RE, storyEpic } from './build.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { reachFor } from './toolbox.mjs';

export const FRAMES_KEY = 'design-frames';
export const DESIGN_LINKS_FILE = path.join('.sdlc', 'design-links.json');

// A character an ID cannot hold and still be read back the same: whitespace splits it in a person's
// eye, `#` is the comment trap, and a bracket ends or starts the list. A comma cannot be tested here —
// the reader has already split on it — so an ID holding one reads as two halves, and neither is found.
const BAD_ID = /[\s#[\]]/;

const quote = (s) => `\`${forTerminal(s)}\``;

// The epic's design-links.json as { state: 'missing' | 'unreadable' | 'ok', screens, tool, fileUrl, why }.
// A file that does not parse, or parses without a `screens` list, is `unreadable` — never "no screens",
// which would report every recorded frame as missing for the wrong reason.
export function readDesignLinks(epicDir) {
  const file = path.join(epicDir, DESIGN_LINKS_FILE);
  if (!fs.existsSync(file)) return { state: 'missing' };
  let data;
  try {
    data = readJSONStrict(file, null);
  } catch {
    return { state: 'unreadable', why: 'it does not parse as JSON' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.screens)) {
    return { state: 'unreadable', why: 'it has no `screens` list' };
  }
  const str = (v) => (typeof v === 'string' ? v : null);
  return {
    state: 'ok',
    tool: str(data.tool),
    fileUrl: str(data.fileUrl),
    screens: data.screens.filter((s) => s && typeof s === 'object' && typeof s.nodeId === 'string'),
  };
}

// The key spelled another way — `Design-Frames`, `design_frames`, `designFrames`. It is never read as
// the key, but it is said: a story that misspells it must not read as "nobody recorded frames".
const keyVariant = (fm) => Object.keys(fm).find((k) => k !== FRAMES_KEY && k.toLowerCase().replace(/[_-]/g, '') === 'designframes');
export const recordsFrames = (fm = {}) => Object.hasOwn(fm, FRAMES_KEY) || keyVariant(fm) !== undefined;

// `"12:34"` and `'12:34'` — a YAML habit. The reader keeps the quote marks, so they are taken off here
// (and said), rather than reported as an ID that is not in design-links.json.
const unquote = (id) => (id.length >= 3 && /^(["']).+\1$/.test(id) ? id.slice(1, -1) : id);

// The pure rule. `fm` is the story's parsed frontmatter, `links` what `readDesignLinks` returned.
// Returns { recorded, ids, frames, findings }: `recorded` is false only when the key is absent;
// `findings` are { kind, message } — every one a warning.
export function frameFindings(fm = {}, links = { state: 'missing' }) {
  if (!Object.hasOwn(fm, FRAMES_KEY)) {
    const k = keyVariant(fm);
    const findings = k === undefined ? [] : [{ kind: 'key-spelling', message: `\`${forTerminal(k)}:\` is not read — the key is spelled \`${FRAMES_KEY}\`, exactly` }];
    return { recorded: false, ids: [], frames: [], findings };
  }
  const v = fm[FRAMES_KEY];
  const findings = [];
  // The right key AND a misspelled one: the second is never read, so its IDs would be lost in silence.
  const twin = keyVariant(fm);
  if (twin !== undefined) findings.push({ kind: 'key-spelling', message: `\`${forTerminal(twin)}:\` is not read — only \`${FRAMES_KEY}\` is; move its IDs into that line and delete it` });
  if (!Array.isArray(v)) {
    const text = String(v ?? '');
    findings.push(text.includes('#')
      ? { kind: 'commented', message: `\`${FRAMES_KEY}: ${forTerminal(text)}\` has a \`#\` after it, so it is read as text, not a list — write the list bare, with no comment on the line` }
      : text === ''
        ? { kind: 'not-a-list', message: `\`${FRAMES_KEY}:\` is blank — write the IDs on the same line, as \`${FRAMES_KEY}: [id, id]\` (a \`- id\` list on the lines below is not read), or \`${FRAMES_KEY}: []\` for a story with no screens` }
        : { kind: 'not-a-list', message: `\`${FRAMES_KEY}: ${forTerminal(text)}\` is not a list — write the IDs inside one pair of brackets, as \`${FRAMES_KEY}: [id, id]\`` });
    return { recorded: true, ids: [], frames: [], findings };
  }
  const quoted = v.filter((id) => unquote(id) !== id);
  if (quoted.length) findings.push({ kind: 'quoted', message: `frame IDs should be written without quotes: ${quoted.map(quote).join(', ')} — they are read without them` });
  const ids = v.map(unquote);
  const seen = new Set();
  for (const id of ids) {
    if (BAD_ID.test(id)) findings.push({ kind: 'bad-id', message: `frame ID ${quote(id)} holds a space, \`#\` or bracket, so it cannot be read back — give the frame a plain ID in the design tool` });
    if (seen.has(id)) findings.push({ kind: 'duplicate', message: `frame ID ${quote(id)} is listed twice` });
    seen.add(id);
  }
  const unique = [...seen];
  if (!unique.length) return { recorded: true, ids, frames: [], findings };
  if (links.state === 'missing') {
    findings.push({ kind: 'no-design-links', message: `${unique.length} frame ID(s) are recorded, but there is no ${DESIGN_LINKS_FILE} to read their names and links from — the UI step writes it` });
    return { recorded: true, ids, frames: unique.map((id) => ({ id, found: false })), findings };
  }
  if (links.state === 'unreadable') {
    findings.push({ kind: 'design-links-unreadable', message: `${DESIGN_LINKS_FILE} cannot be read (${links.why}), so the frame IDs cannot be checked` });
    return { recorded: true, ids, frames: unique.map((id) => ({ id, found: false })), findings };
  }
  const frames = unique.map((id) => {
    const s = links.screens.find((x) => x.nodeId === id);
    if (!s) return { id, found: false };
    const str = (x) => (typeof x === 'string' ? x : null);
    return { id, found: true, name: str(s.name), platform: str(s.platform), url: str(s.url) };
  });
  const missing = frames.filter((f) => !f.found);
  if (missing.length) {
    findings.push({ kind: 'not-found', message: `frame ID(s) ${missing.map((f) => quote(f.id)).join(', ')} are not in ${DESIGN_LINKS_FILE} — copy the \`nodeId\` exactly, or re-run the UI step if the screen is new` });
  }
  return { recorded: true, ids, frames, findings };
}

// A story file's frontmatter, read the same way by both readers. A byte-order mark, Windows line endings
// (git's `core.autocrlf` writes them on checkout) and spaces at the end of a line are taken out first:
// the shared reader matches `---\n` and `[ … ]` to the end of the line, so without this a story checked
// out on Windows would read as "nobody recorded frames", and `[12:34] ` as not a list.
export function readStoryFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
  return parseFrontmatter(text);
}

// The Product's design.json as { state: 'missing' | 'unreadable' | 'ok', data }. Read safely, like
// design-links.json: a file that does not parse is said, never thrown out of the command.
export function readDesignConfig(root) {
  const file = path.join(root, PROJECT_FILES.designConfig);
  if (!fs.existsSync(file)) return { state: 'missing' };
  try {
    const data = readJSONStrict(file, null);
    return data && typeof data === 'object' && !Array.isArray(data) ? { state: 'ok', data } : { state: 'unreadable' };
  } catch {
    return { state: 'unreadable' };
  }
}

// #358 — before UI work, can the agent reach the design tool with the right file open? yad cannot ask:
// an MCP server belongs to the agent's session. So this says HOW to ask, and what to tell the person
// when the answer is no; the yad-spec and yad-implement skills make the call and stop on a failure.
// null when the story names no frame (no UI task, nothing to check). `reachable` is `check` (probe, and
// stop when it fails) or `not-checkable` (nothing to probe: go on with the links). `appBound` is true (read
// through the running app), false (a hosted server: sign in) or null (yad cannot tell: `stop` names both).
export function designPreflight(design, links, frames) {
  if (!frames.length) return null;
  const d = design.state === 'ok' ? design.data : null;
  const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
  const tool = str(d?.tool);
  const notCheckable = (why) => ({ tool, reachable: 'not-checkable', why });
  if (design.state === 'missing') return notCheckable('no .sdlc/design.json: no design tool is connected');
  if (design.state === 'unreadable') return notCheckable('.sdlc/design.json cannot be read');
  if (!tool || tool === 'none') return notCheckable('design.json connects no design tool');
  if (d.source === 'unavailable') return notCheckable(`design.json records ${forTerminal(tool)} as unavailable (source: unavailable)`);
  const reach = reachFor(tool);
  if (!reach) return notCheckable(`yad has no reachability check for ${forTerminal(tool)}`);
  const provider = str(d.provider) ?? str(d.source);
  // The MCP id is free text: `Figma-Desktop`, `html.to.design` and ` html_to_design ` are the names yad
  // knows, so names are compared on their letters and digits alone.
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = provider === null ? null : fold(provider);
  const listed = (list) => key !== null && Array.isArray(list) && list.some((p) => fold(p) === key);
  // A provider that only writes (html-to-design) has no call that reads a frame: probing it would fail
  // on every story and make the person override each time.
  if (listed(reach.writers)) return notCheckable(`the connected provider ${forTerminal(provider)} cannot read a frame`);
  // The frames come from design-links.json. Without it — or with one the UI step wrote for ANOTHER tool —
  // the IDs belong to nothing this tool can open, and a probe would blame the app.
  if (links.state === 'missing') return notCheckable('there is no design-links.json for the frame IDs — re-run the UI step');
  if (links.state === 'unreadable') return notCheckable(`design-links.json cannot be read (${links.why})`);
  if (links.tool && fold(links.tool) !== fold(tool)) {
    return notCheckable(`design-links.json was recorded for ${forTerminal(links.tool)}, but design.json now connects ${forTerminal(tool)} — re-run the UI step`);
  }
  // Every recorded ID is unresolved: the bad IDs are the problem (the warnings name them), not the app.
  const found = frames.find((f) => f.found);
  if (!found) return notCheckable('no recorded frame is in design-links.json — fix the frame IDs first');
  const appBound = reach.appBound === true || listed(reach.appBound) ? true : listed(reach.signInOnly) ? false : null;
  // design.json's project_url is a project, not a file, so it is never compared against.
  const file = links.fileUrl;
  const fill = (s) => s.replace(/<file>/g, file ? `\`${forTerminal(file)}\`` : 'the design file').replace(/<frame>/g, `\`${forTerminal(found.id)}\``);
  return {
    tool, provider, reachable: 'check', appBound, file, frame: found.id,
    probe: fill(reach.probe),
    stop: fill(appBound === true ? reach.open : appBound === false ? reach.signIn : reach.either),
    // E165: when the probe fails because the tool is not on this machine at all (not a closed app or a
    // sign-in), the agent offers this first, under the connect-tool rule. A tool with a reach rule is shipped.
    connect: `yad toolbox connect ${tool} --json`,
  };
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// One story's frames. Throws { message, hint } only for the command line: a word that is not a story
// id, or a story with no file. Everything about the frames themselves comes back in `findings`.
export function readStoryFrames(root, story) {
  if (!story || story === true) {
    throw Object.assign(new Error('yad story frames needs a story id'), { hint: 'use: yad story frames <story-id>, such as EP-checkout-S01' });
  }
  if (!STORY_RE.test(String(story))) {
    throw Object.assign(new Error(`'${forTerminal(story)}' is not a story id`), { hint: 'expected EP-<slug>-S<n>, such as EP-checkout-S01' });
  }
  const epic = storyEpic(story);
  const epicDir = epicRoot(root, epic);
  const file = path.join(epicDir, 'stories', `${story}.md`);
  if (!isFile(file)) {
    throw Object.assign(new Error(`no story file epics/${epic}/stories/${story}.md`), { hint: 'check the story id; the stories step writes one file per story' });
  }
  const links = readDesignLinks(epicDir);
  const r = frameFindings(readStoryFrontmatter(file), links);
  return {
    story, epic,
    tool: links.state === 'ok' ? links.tool : null,
    fileUrl: links.state === 'ok' ? links.fileUrl : null,
    ...r,
    preflight: designPreflight(readDesignConfig(root), links, r.frames),
  };
}

// Every story that records frames (or misspells the key), for `yad doctor`:
// [{ epic, story, recorded, frames: <how many IDs>, findings }]. The epic folders are the caller's to
// pick. A story file the command cannot reach — named for another epic, or not `EP-<slug>-S<n>.md` — is
// reported as that, never with advice to run a command that would refuse it.
export function allStoryFrames(root, epicIds) {
  const out = [];
  for (const epic of epicIds) {
    const epicDir = epicRoot(root, epic);
    const dir = path.join(epicDir, 'stories');
    let names;
    try {
      // `isFile` follows a symlink, as the command's own check does, so the two read the same stories.
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && isFile(path.join(dir, n))).sort();
    } catch {
      continue;
    }
    let links = null;   // read once per epic, and only when a story there records frames
    for (const f of names) {
      const fm = readStoryFrontmatter(path.join(dir, f));
      if (!recordsFrames(fm)) continue;
      const story = f.replace(/\.md$/, '');
      if (!STORY_RE.test(story) || storyEpic(story) !== epic) {
        out.push({ epic, story, recorded: true, frames: 0, findings: [{ kind: 'not-a-story-file', message: `stories/${forTerminal(f)} records design frames, but its name is not ${epic}-S<n>.md, so \`yad story frames\` cannot read it — rename the file` }] });
        continue;
      }
      links ??= readDesignLinks(epicDir);
      const r = frameFindings(fm, links);
      out.push({ epic, story, recorded: r.recorded, frames: r.ids.length, findings: r.findings });
    }
  }
  return out;
}

// `yad story frames <story> [--json]`. Read only: it prints the story's frames and every finding as a
// warning, and exits 1 only for a refusal (an unknown action, a word that is not a story id, a story
// with no file).
export async function runStory(root, { action, story, json = false } = {}) {
  if (action !== 'frames') {
    refuse(action ? `unknown action: ${forTerminal(action)}` : 'yad story needs an action', 'use: yad story frames <story-id> [--json]', { json });
    return { ok: false };
  }
  let r;
  try {
    r = readStoryFrames(root, story);
  } catch (e) {
    refuse(e.message, e.hint ?? null, { json });
    return { ok: false };
  }
  const warnings = r.findings.map((f) => f.message);
  if (json) {
    emitJSON({
      ok: true, story: r.story, epic: r.epic, tool: r.tool, fileUrl: r.fileUrl, recorded: r.recorded, preflight: r.preflight,
      frames: r.frames, findings: r.findings.map((f) => ({ kind: f.kind, message: stripAnsi(f.message) })), warnings,
    });
    return { ok: true, ...r };
  }
  log(c.bold(`\n${r.story} — design frames${r.tool ? ` (${forTerminal(r.tool)})` : ''}`));
  if (!r.recorded) info(`no design frames recorded — the stories step adds \`${FRAMES_KEY}: [id, …]\` to the story`);
  else if (!r.ids.length && !r.findings.length) info(`no screens (\`${FRAMES_KEY}: []\`)`);
  for (const f of r.frames) {
    const id = forTerminal(f.id);
    if (!f.found) { warn(`${id} — not found`); continue; }
    ok(`${id}  ${forTerminal(f.name ?? '(no name)')}${f.platform ? `  [${forTerminal(f.platform)}]` : ''}`);
    if (f.url) log(`      ${c.dim(forTerminal(f.url))}`);
  }
  for (const w of warnings) warn(w);
  const p = r.preflight;
  if (p?.reachable === 'check') {
    hand(`before UI work: ${p.probe} — if that fails, stop: ${p.stop}`);
    hand(`if ${forTerminal(p.tool)} is not on this machine at all, your agent can offer to connect it first: \`${p.connect}\``);
  }
  else if (p) info(`before UI work: the design tool is not checked (${p.why}) — build from the frame links`);
  return { ok: true, ...r };
}
