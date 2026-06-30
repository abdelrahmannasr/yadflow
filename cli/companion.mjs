// cli/companion.mjs — pure, perspective-neutral helpers for the Review Companion, shared by the front
// half (yad gate …) and the back half (yad review …). The CLI never calls an LLM — generation happens
// in the skill/harness layer (like yad-learn/yad-docs). This module owns the platform MARKERS, the
// engagement parsing, the trailer-block upsert, and the message text the skill and the gate share.
//
// Design philosophy ("visible, not impossible"): the engagement signal is GAMEABLE by design. It makes
// review quality VISIBLE (verified vs none + a friendly public nudge); it never claims to prove a human
// read anything. All markers ride in PLATFORM data (PR/MR bodies + comment threads), never in a ledger
// file — so the ledger-guard check never sees them and the reviewer never writes the ledger.

export const TRAILER_BEGIN = '<!-- yad:trailer -->';
export const TRAILER_END = '<!-- /yad:trailer -->';
// A companion- or nudge-posted comment carries this so the gate EXCLUDES it from the thread-resolution
// blocking check. Such threads are deliberately left unresolved as a permanent PR/MR history trail.
export const NOBLOCK_MARK = '<!-- yad:noblock -->';
const ENGAGEMENT_RE = /<!--\s*yad:engagement\s+(verified|none)\s*-->/i;

// True when a comment/thread body is companion scaffolding (card deck, chat log, nudge) — never blocks.
export function isNoBlock(body) {
  return typeof body === 'string' && body.includes(NOBLOCK_MARK);
}

// The engagement signal a reviewer's APPROVE carries in its review body: a companion-driven approve
// embeds `<!-- yad:engagement verified -->`; a bare UI click has no marker → 'none'.
export function parseEngagement(body) {
  const m = ENGAGEMENT_RE.exec(typeof body === 'string' ? body : '');
  return m ? m[1].toLowerCase() : 'none';
}

// Body for a companion approval review — embeds the engagement marker the gate reads back.
export function engagementBody(kind = 'verified', note = '') {
  const k = kind === 'verified' ? 'verified' : 'none';
  return `${note ? note + '\n\n' : ''}<!-- yad:engagement ${k} -->`;
}

// Tag a companion comment so the gate never blocks on it (and it persists as PR/MR history).
export function noBlock(body = '') {
  return `${body}\n\n${NOBLOCK_MARK}`;
}

// Idempotently insert/replace the trailer block in a PR/MR description. String-based (no regex over the
// markers) so regenerating on every artifact change never duplicates or mangles the block.
export function upsertTrailerBlock(description = '', trailer = '') {
  const desc = typeof description === 'string' ? description : '';
  const block = `${TRAILER_BEGIN}\n${trailer}\n${TRAILER_END}`;
  const s = desc.indexOf(TRAILER_BEGIN);
  // Find the END marker AFTER the BEGIN, so an earlier quoted `<!-- /yad:trailer -->` in the body
  // can't break idempotency (otherwise a second block gets prepended instead of replacing).
  const e = s === -1 ? -1 : desc.indexOf(TRAILER_END, s + TRAILER_BEGIN.length);
  if (s !== -1 && e !== -1 && e > s) {
    return desc.slice(0, s) + block + desc.slice(e + TRAILER_END.length);
  }
  return desc ? `${block}\n\n${desc}` : block;
}

// The friendly, public nudge for a bare approve (engagement: none). Warm, short, names the reviewer,
// and carries the noblock marker so it never holds the gate.
export function nudgeMessage(login, cmd = 'yad gate review') {
  const who = login ? `@${login}` : 'there';
  return noBlock(`Thanks ${who} for the quick approval 🙏 — mind running \`${cmd}\`? It won't take long, and a real read has way more impact than the few minutes it costs 💛`);
}

// ---- pair review (yad-pair-review) --------------------------------------------------------------
// The pair-review walkthrough records its session as a PERMANENT PR/MR comment: the transcript summary,
// the review-skill scorecard, and BOTH sign-offs. It carries this marker so a recorded pair session is
// IDENTIFIABLE in platform history (the skill / `yad status` can recognise + count paired reviews for the
// 🏆 roll-up), AND the noblock marker so the session thread never holds the gate. The human's actual
// approval still rides the existing `<!-- yad:engagement verified -->` mark — the session comment NEVER
// carries an engagement marker (it is history, not the approval). `isPair` is the marker's public reader,
// symmetrical with `isNoBlock`; the engagement roll-up itself lives in the local yad-learn ledger.
export const PAIR_MARK = '<!-- yad:pair -->';

// True when a comment is a recorded pair-review session (countable, but never blocking).
export function isPair(body) {
  return typeof body === 'string' && body.includes(PAIR_MARK);
}

// Render the pair-review session-record comment. The skill generates each prose section; this composes
// them into one comment carrying both the pair marker (countable) and the noblock marker (never blocks).
export function pairSessionBody({ summary = '', scorecard = '', verdict = '', humanSignoff = '', aiSignoff = '' } = {}) {
  const parts = [
    PAIR_MARK,
    '## 🤝 Pair review session',
    summary && summary.trim(),
    scorecard && `### Review-skill scorecard\n${scorecard.trim()}`,
    verdict && `### AI verdict\n${verdict.trim()}`,
    (humanSignoff || aiSignoff) && `### Sign-off\n- 🧑 Human: ${humanSignoff || '—'}\n- 🤖 AI: ${aiSignoff || '—'}`,
  ].filter(Boolean);
  return noBlock(parts.join('\n\n'));
}
