// The Plannotator Inbox (EP-plannotator-review). yad never talks to Plannotator: it only shapes the text of a
// message and puts it in its own `--json` output, in an `inbox` block, and the AGENT posts it with its own Inbox
// tool (architecture D1). This module holds that knowledge and nothing that reaches out: no network, no file
// write, no child process. S01 adds the one question every later piece asks; S02 adds the message builders.
//
// "The Inbox is ready" (contract.md, API) means both:
//   - the Product's toolbox choices put `plannotator` in use (a recommended tool is in use only when
//     `.sdlc/toolbox.json` says `shipped.plannotator: "use"`), and
//   - this machine has it: `toolStatus` says `installed` (its program, its plugin, or its Inbox server).
// Otherwise the `inbox` block is absent, and every command's output is what it was before (architecture D2).

import { artifactBase } from './epic-state.mjs';
import { looksSecret, redact } from './secret-text.mjs';
import { TOOLBOX, loadChoices, onPath, toolUse, toolboxRows } from './toolbox.mjs';

export const INBOX_TOOL = 'plannotator';

// Is the Inbox ready for this Product, on this machine? `detectRoot` is the folder yad runs in (a code repo's own
// plugins and servers count, as in `yad toolbox list`); `items` and `has` replace detection in tests. Asks the
// toolbox exactly as `yad toolbox list` does, so "chosen" and "found" mean what that list shows. A plugin the
// settings turn off is `disabled`, not installed: not ready. No Product: nothing chose it, so not ready.
// KNOWN LIMIT (contract.md, "the Inbox is ready"): the program on PATH alone counts as found, though the agent's
// Inbox tool comes from the plugin or the MCP server. The agent rule covers it: post only when the session has the
// Inbox tool. A caller running in a code repo passes `detectRoot`, so that repo's plugins and servers count.
export function inboxReady(productRoot, { detectRoot = productRoot, items = null, has = onPath } = {}) {
  if (!productRoot) return false;
  const tool = TOOLBOX.find((t) => t.id === INBOX_TOOL);
  if (!tool) return false;
  // Not chosen: the usual case, answered from the toolbox file without scanning this machine.
  if (!toolUse(tool, loadChoices(productRoot)).used) return false;
  const { rows } = toolboxRows(detectRoot, productRoot, { tools: [tool], items, has });
  const row = rows.find((r) => r.id === INBOX_TOOL);
  return Boolean(row && row.used && row.status.state === 'installed');
}

// ---- the messages (S02) -------------------------------------------------------------------------------------
//
// The shape is the contract's InboxMessage, and the words are DESIGN.md's, word for word (EP-plannotator-review).
// The shape is neutral (architecture D3): no Plannotator syntax. The agent renders `question` as options.
// Every text goes through `redact()` before it is placed (D4); a title is cut to 120 characters, a body to 4,000
// with its notice kept whole, and a halt's output to its last 60 lines.

export const TITLE_MAX = 120;
export const BODY_MAX = 4000;
export const HALT_LINES = 60;
export const TEXT = Object.freeze({
  notice: 'Replying here does not approve or record anything in yadflow. Type the command.',
  haltClosing: 'Your answer tells the agent what to propose. The step moves only when you say it is resolved.',
  haltPrompt: 'What should happen next?',
  haltOptions: Object.freeze(['fix', 'skip', 'stop']),
  trimmed: '(trimmed)',
  redactedLine: '[redacted line]',
  verify: (cmd) => `I will confirm with ${span(cmd)}.`,
});
// A hand-off's act, said in words for its title; any other act is "Your step: <act>".
const ACT_WORDS = Object.freeze({
  'approve-merge': 'Review and merge the PR',
  choose: 'Choose what to work on',
  answer: 'Answer the agent\'s questions',
  unblock: 'Resolve the blocker',
  install: 'Install a tool',
  login: 'Log in',
});

// Redacted: every known token and long key-like run (`redact`), and any line that names a secret with a value
// (`PASSWORD=…`, `--token …`: `looksSecret`) is dropped whole — a test log or an env dump in a halt holds such lines.
const text = (v) => String(v ?? '').split(/\r?\n/).map((l) => (looksSecret(l) ? TEXT.redactedLine : redact(l))).join('\n').trim();
// One line of prose: line breaks become spaces, so a step or a reason can never start its own paragraph, heading
// or italic line (a forged notice).
const oneLine = (v) => text(v).replace(/\s+/g, ' ');
// An id in a key, title or body: redacted, on one line, and `-` when missing.
const part = (v) => (v === null || v === undefined || String(v).trim() === '' ? '-' : oneLine(v));
const keyOf = (...parts) => parts.map(part).join(':');
// Cut to at most `max` UTF-16 units without splitting a character in two (an emoji is two units).
const cutAt = (s, max) => {
  let end = Math.max(0, max);
  const c = s.charCodeAt(end - 1);
  if (end < s.length && c >= 0xd800 && c <= 0xdbff) end -= 1;
  return s.slice(0, end);
};
const title = (s) => {
  const t = oneLine(s);
  return t.length > TITLE_MAX ? `${cutAt(t, TITLE_MAX - 1)}…` : t;
};
// Backticks that no run inside can match: a code span or block the text cannot close early.
const ticks = (s, min) => '`'.repeat(Math.max(min, ...(String(s).match(/`+/g) || []).map((r) => r.length + 1)));
const span = (s) => {
  const t = ticks(s, 1);
  const pad = /^`|`$/.test(s) ? ' ' : '';
  return `${t}${pad}${s}${pad}${t}`;
};
const fence = (s) => {
  const f = ticks(s, 3);
  return `${f}\n${s}\n${f}`;
};
// The body, with the notice (when there is one) as its last paragraph, always whole: the text above it is cut,
// and a cut inside a fenced block closes that block first, so `(trimmed)` and the notice never read as code.
function body(paragraphs, notice) {
  const tail = notice ? `*${notice}*` : '';
  const sep = tail ? '\n\n' : '';
  let main = paragraphs.filter((p) => p !== null && p !== undefined && String(p).length).join('\n\n');
  if (!main) return tail;
  const room = BODY_MAX - tail.length - sep.length;
  if (main.length > room) {
    // Room for the closing fence and `(trimmed)` is kept before the cut is made.
    const longestFence = Math.max(3, ...(main.match(/^`{3,}$/gm) || []).map((f) => f.length));
    const spare = TEXT.trimmed.length + longestFence + 2;
    let cut = cutAt(main, Math.max(0, room - spare)).trimEnd();
    const open = [];
    for (const line of cut.split('\n')) {
      if (!/^`{3,}$/.test(line)) continue;
      if (open.length && open[open.length - 1] === line) open.pop(); else open.push(line);
    }
    if (open.length) cut += `\n${open[open.length - 1]}`;
    main = `${cut}\n${TEXT.trimmed}`;
  }
  return main + sep + tail;
}
// The https links in a text, without the full stop or comma a sentence puts after one: a link is only ever one
// yad was handed, never built.
const linksIn = (...texts) => [...new Set(texts.flatMap((s) => String(s ?? '').match(/https:\/\/[^\s)`'"<>]+/g) || [])
  .map((u) => u.replace(/[.,;:!?]+$/, '')))]
  .map(oneLine).filter((u) => /^https:\/\/\S+$/.test(u));

// The `inbox` block for a list of messages, or undefined for none: absent, never empty (contract, API).
export function inboxBlock(messages) {
  const list = (messages ?? []).filter(Boolean);
  return list.length ? { tool: INBOX_TOOL, messages: list } : undefined;
}

// One act only the person can do: a `person[]` entry of `yad guide`.
export function handOffMessage({ epic = null, step = null, entry } = {}) {
  const e = entry ?? {};
  const act = part(e.act);
  const steps = (Array.isArray(e.steps) ? e.steps : []).map(oneLine).filter(Boolean);
  // A command keeps its own lines (a heredoc), inside a block it cannot close.
  const commands = (Array.isArray(e.commands) ? e.commands : []).map(text).filter(Boolean);
  const why = oneLine(e.why);
  const verify = e.verify ? oneLine(e.verify) : null;
  const what = Object.hasOwn(ACT_WORDS, act) ? ACT_WORDS[act] : `Your step: ${act}`;
  return {
    key: keyOf('hand-off', epic, step, act),
    kind: 'hand-off',
    thread: epic ? `yad ${part(epic)}` : 'yad',
    title: title(epic ? `${what} — ${epic}` : what),
    body: body([
      why ? `Only you can do this: ${why.replace(/\.$/, '')}.` : null,
      steps.length ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : null,
      ...commands.map(fence),
      verify ? TEXT.verify(verify) : null,
    ], TEXT.notice),
    links: linksIn(...(e.steps ?? []), ...(e.commands ?? [])),
    notice: TEXT.notice,
  };
}

// A Build step that halted. Its key names the task (`halt:<story>:<step>:<repo>:<task>`, contract `key` patterns):
// `implement` and `checks` are walked once per task, and a later message with the same key replaces the earlier
// one, so a halt on T02 must not take the place of the halt on T01. The caller gives `task` only for such a step.
// The reason's first line is the "why"; the lines after it are the output. The fixed
// paragraphs (what, why, the question, the closing line) always fit; the output keeps its LAST lines — at most
// HALT_LINES, and fewer when they would not fit — so the error at the end is what the person sees.
export function haltMessage({ story, repo, step, task = null, reason } = {}) {
  const lines = text(reason).split('\n');
  const why = oneLine(lines[0]) || '-';
  const s = part(story);
  const head = [`Story ${span(s)} in ${span(part(repo))}: step ${span(part(step))} is halted.`, `Why: ${why}`];
  const tailParas = [`**${TEXT.haltPrompt}** ${TEXT.haltOptions.join(' / ')}`, TEXT.haltClosing];
  let out = lines.slice(1).join('\n').replace(/^\n+|\n+$/g, '').split('\n').filter((l, i, all) => all.length > 1 || l);
  let cut = false;
  if (out.length > HALT_LINES) { out = out.slice(-HALT_LINES); cut = true; }
  const fixed = [...head, ...tailParas].join('\n\n').length;
  const build = () => (out.length ? `${cut ? `${TEXT.trimmed}\n` : ''}${fence(out.join('\n'))}` : null);
  // Drop the oldest output lines until the whole body fits.
  while (out.length && fixed + 2 + build().length > BODY_MAX) { out = out.slice(1); cut = true; }
  return {
    key: keyOf('halt', story, step, repo, task),
    kind: 'halt',
    thread: story ? `yad ${s}` : 'yad',
    title: title(`Build halted — ${s} in ${part(repo)}: ${part(step)}`),
    body: body([...head, build(), ...tailParas], null),
    links: [],
    question: { prompt: TEXT.haltPrompt, options: [...TEXT.haltOptions] },
  };
}

// A review that is ready: a Shape artifact's review PR/MR (`epic` + `artifact`), or a code PR/MR (`repo` + `pr`).
// A Shape review's key names its review branch's base (`review:<epic>:<base>:gate`): the ledger's artifact path is
// `stories/` for every story, so two stories' review PRs would share a key. `base` is the last part of
// `review/EP-<slug>/<base>`; left out, it is the artifact's own base (`epic.md` → `epic`). The title keeps the artifact.
export function reviewMessage({ epic = null, artifact = null, base = null, repo = null, pr = null, url = null, solo = false } = {}) {
  const what = artifact ? `${part(artifact)} for ${part(epic)}` : `PR #${part(pr)} in ${part(repo)}`;
  const asked = solo
    ? 'Read it. In solo mode no approval is counted, so merging it is the decision.'
    : 'Read it, comment where needed, then approve or merge.';
  const links = url ? linksIn(url) : [];
  return {
    key: artifact ? keyOf('review', epic, base ?? artifactBase(String(artifact)), 'gate') : keyOf('review', repo, pr, 'nudge'),
    kind: 'review',
    thread: epic ? `yad ${part(epic)}` : repo ? `yad ${part(repo)}` : 'yad',
    title: title(`Review ready — ${what}`),
    body: body([`Review ready: ${what}.`, asked, links[0] ?? null], TEXT.notice),
    links,
    notice: TEXT.notice,
  };
}
