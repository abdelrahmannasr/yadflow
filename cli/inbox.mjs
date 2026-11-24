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

import { TOOLBOX, onPath, toolboxRows } from './toolbox.mjs';

export const INBOX_TOOL = 'plannotator';

// Is the Inbox ready for this Product, on this machine? `detectRoot` is the folder yad runs in (a code repo's own
// plugins and servers count, as in `yad toolbox list`); `items` and `has` replace detection in tests. Asks the
// toolbox exactly as `yad toolbox list` does, so "chosen" and "found" mean what that list shows. A plugin the
// settings turn off is `disabled`, not installed: not ready. No Product: nothing chose it, so not ready.
export function inboxReady(productRoot, { detectRoot = productRoot, items = null, has = onPath } = {}) {
  if (!productRoot) return false;
  const tool = TOOLBOX.find((t) => t.id === INBOX_TOOL);
  if (!tool) return false;
  const { rows } = toolboxRows(detectRoot, productRoot, { tools: [tool], items, has });
  const row = rows.find((r) => r.id === INBOX_TOOL);
  return Boolean(row && row.used && row.status.state === 'installed');
}
