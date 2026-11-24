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

import { redact } from './secret-text.mjs';
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
  verify: (cmd) => `I will confirm with \`${cmd}\`.`,
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

const text = (v) => redact(String(v ?? '')).trim();
// An id in a key, title or body: redacted too, and `-` when missing.
const part = (v) => (v === null || v === undefined || String(v).trim() === '' ? '-' : text(v));
const keyOf = (...parts) => parts.map(part).join(':');
const title = (s) => {
  const t = text(s).replace(/\s+/g, ' ');
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
};
// A fenced block that no command can close early: one more backtick than the longest run inside it.
const fence = (cmd) => {
  const longest = Math.max(2, ...(String(cmd).match(/`+/g) || []).map((r) => r.length));
  const f = '`'.repeat(longest + 1);
  return `${f}\n${cmd}\n${f}`;
};
// The body, with the notice (when there is one) as its last paragraph, always whole: the text above it is cut.
function body(paragraphs, notice) {
  const tail = notice ? `\n\n*${notice}*` : '';
  let main = paragraphs.filter((p) => p !== null && p !== undefined && String(p).length).join('\n\n');
  const room = BODY_MAX - tail.length;
  if (main.length > room) main = `${main.slice(0, room - TEXT.trimmed.length - 1).trimEnd()}\n${TEXT.trimmed}`;
  return main + tail;
}
// The https links in a text: a link is only ever one yad was handed, never built.
const linksIn = (...texts) => [...new Set(texts.flatMap((s) => String(s ?? '').match(/https:\/\/[^\s)`'"<>]+/g) || []))]
  .map((u) => text(u)).filter((u) => u.startsWith('https://'));

// The `inbox` block for a list of messages, or undefined for none: absent, never empty (contract, API).
export function inboxBlock(messages) {
  const list = (messages ?? []).filter(Boolean);
  return list.length ? { tool: INBOX_TOOL, messages: list } : undefined;
}

// One act only the person can do: a `person[]` entry of `yad guide`.
export function handOffMessage({ epic = null, step = null, entry } = {}) {
  const e = entry ?? {};
  const act = part(e.act);
  const steps = (Array.isArray(e.steps) ? e.steps : []).map(text).filter(Boolean);
  const commands = (Array.isArray(e.commands) ? e.commands : []).map(text).filter(Boolean);
  const why = text(e.why);
  const verify = e.verify ? text(e.verify) : null;
  const what = ACT_WORDS[act] ?? `Your step: ${act}`;
  return {
    key: keyOf('hand-off', epic, step, act),
    kind: 'hand-off',
    thread: epic ? `yad ${text(epic)}` : 'yad',
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

// A Build step that halted. The reason's first line is the "why"; any lines after it are the output, of which
// the last HALT_LINES are kept (S03 wires it to `yad build step … blocked`).
export function haltMessage({ story, repo, step, reason } = {}) {
  const lines = text(reason).split(/\r?\n/);
  const why = lines[0] || '-';
  let output = lines.slice(1).join('\n').replace(/^\n+|\n+$/g, '');
  let cut = false;
  if (output) {
    const all = output.split('\n');
    if (all.length > HALT_LINES) { output = all.slice(-HALT_LINES).join('\n'); cut = true; }
  }
  const s = text(story);
  return {
    key: keyOf('halt', story, step, repo),
    kind: 'halt',
    thread: story ? `yad ${s}` : 'yad',
    title: title(`Build halted — ${part(story)} in ${part(repo)}: ${part(step)}`),
    body: body([
      `Story \`${part(story)}\` in \`${part(repo)}\`: step \`${part(step)}\` is halted.`,
      `Why: ${why}`,
      output ? `${cut ? `${TEXT.trimmed}\n` : ''}${fence(output)}` : null,
      `**${TEXT.haltPrompt}** ${TEXT.haltOptions.join(' / ')}`,
      TEXT.haltClosing,
    ], null),
    links: [],
    question: { prompt: TEXT.haltPrompt, options: [...TEXT.haltOptions] },
  };
}

// A review that is ready: a Shape artifact's review PR/MR (`epic` + `artifact`), or a code PR/MR (`repo` + `pr`).
export function reviewMessage({ epic = null, artifact = null, repo = null, pr = null, url = null, solo = false } = {}) {
  const what = artifact ? `${text(artifact)} for ${part(epic)}` : `PR #${part(pr)} in ${part(repo)}`;
  const asked = solo
    ? 'Read it. In solo mode no approval is counted, so merging it is the decision.'
    : 'Read it, comment where needed, then approve or merge.';
  return {
    key: keyOf('review', epic ?? repo, artifact ?? pr, artifact ? 'gate' : 'nudge'),
    kind: 'review',
    thread: epic ? `yad ${text(epic)}` : repo ? `yad ${text(repo)}` : 'yad',
    title: title(`Review ready — ${what}`),
    body: body([`Review ready: ${what}.`, asked, url ? text(url) : null], TEXT.notice),
    links: url ? linksIn(url) : [],
    notice: TEXT.notice,
  };
}
