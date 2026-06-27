import { Fragment } from 'react';

/**
 * Renders a single line of lesson text with minimal inline formatting —
 * `` `code` `` spans and `**bold**` — without pulling in a Markdown parser.
 */
export function InlineText({ text }: { text: string }) {
  // First split on backtick code spans, then handle **bold** inside non-code parts.
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        const boldSplit = part.split(/(\*\*[^*]+\*\*)/g);
        return (
          <Fragment key={i}>
            {boldSplit.map((seg, j) =>
              seg.startsWith('**') && seg.endsWith('**') ? (
                <strong key={j} style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {seg.slice(2, -2)}
                </strong>
              ) : (
                <Fragment key={j}>{seg}</Fragment>
              ),
            )}
          </Fragment>
        );
      })}
    </>
  );
}
