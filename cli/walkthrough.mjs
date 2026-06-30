// cli/walkthrough.mjs — the deterministic diff SEQUENCER for the pair-review walkthrough
// (yad-pair-review). Pure, no I/O, no LLM: it parses a unified `git diff` into ordered, hunk-anchored,
// risk-tagged "stops" so the skill walks the change one stop at a time, highest-risk first, the same way
// every time. The harness generates the prose for each stop; this only decides WHAT and IN WHICH ORDER.
//
// Risk tags reuse the same vocabulary as the review gate's escalation (contract / auth / payments — see
// cli/epic-state.mjs isEscalated), plus a `tests` tag so the walkthrough can check that tests cover the
// change (rubric step 5). The signal is a heuristic over file paths + hunk size — advisory, never a gate.

// Path heuristics for the escalation domains + tests. Order matters only for readability; a path can
// carry several tags.
const RISK_PATTERNS = [
  ['auth', /(^|[/_.-])(auth|authn|authz|login|logout|session|token|jwt|oauth|saml|password|passwd|credential|secret|permission|rbac|acl)([/_.-]|$)/i],
  ['payments', /(^|[/_.-])(pay|payment|payout|billing|invoice|charge|stripe|paypal|checkout|wallet|refund|subscription|price|pricing|ledger)([/_.-]|$)/i],
  ['contract', /(^|[/_.-])(contract|openapi|swagger|proto|graphql|schema|migration|migrations)([/_.-]|$)|\.(proto|sql|graphql|gql)$|(^|[/])(api|contracts?)[/]/i],
  ['tests', /(^|[/_.-])(test|tests|spec|specs|__tests__|e2e|fixtures?)([/_.-]|$)|\.(test|spec)\.[a-z]+$/i],
];

// Relative weight used to order stops — the higher, the earlier it is walked. `tests` is intentionally
// weightless (it's informative, not risky on its own).
const RISK_WEIGHT = { contract: 4, auth: 3, payments: 3, tests: 0 };

// The risk tags a file path carries. `contractPath` (when known) force-tags the locked contract surface
// even if its path doesn't match the generic heuristics.
export function riskTagsForPath(file, { contractPath } = {}) {
  const f = String(file || '');
  const tags = [];
  for (const [tag, re] of RISK_PATTERNS) {
    if (re.test(f)) tags.push(tag);
  }
  if (contractPath && (f === contractPath || f.endsWith(`/${contractPath}`) || contractPath.endsWith(`/${f}`))) {
    if (!tags.includes('contract')) tags.unshift('contract');
  }
  return tags;
}

// The maximum risk weight across a stop's tags (0 when none) — the primary sort key.
function weightOf(tags) {
  return (tags || []).reduce((m, t) => Math.max(m, RISK_WEIGHT[t] || 0), 0);
}

// Parse the `+c,d` side of a hunk header `@@ -a,b +c,d @@`. `d` defaults to 1 when omitted (a one-line
// hunk). Returns { startLine, endLine } in the NEW file, or null when the header doesn't parse.
function parseHunkRange(header) {
  const m = /@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header || '');
  if (!m) return null;
  const start = Number(m[1]);
  const count = m[2] == null ? 1 : Number(m[2]);
  return { startLine: start, endLine: count > 0 ? start + count - 1 : start };
}

// The file a `diff --git a/x b/y` line names. Use the new-side path (`b/`) so a rename is anchored to its
// destination; fall back to the old side for a pure deletion.
function fileFromDiffHeader(line) {
  const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  if (!m) return null;
  return m[2] || m[1];
}

// sequenceDiff(diffText, { contractPath }) -> ordered stops[].
// Each stop: { file, hunkHeader, startLine, endLine, added, removed, riskTags[], order }.
// A file with no hunks (binary, pure rename, mode-only change) still yields ONE stop so it's never
// skipped silently. `order` is the 1-based position AFTER sorting (high-risk, then larger, first).
export function sequenceDiff(diffText, { contractPath } = {}) {
  const lines = String(diffText || '').split('\n');
  const files = [];        // { file, hunks: [{ header, startLine, endLine, added, removed }] }
  let cur = null;
  let hunk = null;

  const closeHunk = () => { if (cur && hunk) cur.hunks.push(hunk); hunk = null; };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      closeHunk();
      const file = fileFromDiffHeader(line);
      cur = { file: file || '(unknown)', hunks: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;                       // preamble before the first file header
    if (line.startsWith('@@')) {
      closeHunk();
      const range = parseHunkRange(line) || { startLine: null, endLine: null };
      hunk = { header: line.trim(), startLine: range.startLine, endLine: range.endLine, added: 0, removed: 0 };
      continue;
    }
    if (!hunk) continue;                       // ---/+++/index/rename lines between header and first @@
    // Inside a hunk every +/- line is CONTENT — the `+++ b/file` / `--- a/file` headers appear before
    // the first @@ and are already skipped by the !hunk guard, so count on the marker char alone (a
    // content line like `--flag` or `++i` must not be dropped).
    if (line[0] === '+') hunk.added++;
    else if (line[0] === '-') hunk.removed++;
  }
  closeHunk();

  // Flatten to stops; a file with zero hunks becomes one zero-size stop.
  const stops = [];
  for (const f of files) {
    const tags = riskTagsForPath(f.file, { contractPath });
    if (f.hunks.length === 0) {
      stops.push({ file: f.file, hunkHeader: null, startLine: null, endLine: null, added: 0, removed: 0, riskTags: tags });
      continue;
    }
    for (const h of f.hunks) {
      stops.push({ file: f.file, hunkHeader: h.header, startLine: h.startLine, endLine: h.endLine, added: h.added, removed: h.removed, riskTags: tags });
    }
  }

  // Stable sort: highest risk weight first, then the larger change, then original order (index) so the
  // result is deterministic for identical input.
  return stops
    .map((s, i) => ({ s, i, w: weightOf(s.riskTags), size: s.added + s.removed }))
    .sort((a, b) => (b.w - a.w) || (b.size - a.size) || (a.i - b.i))
    .map(({ s }, idx) => ({ ...s, order: idx + 1 }));
}
