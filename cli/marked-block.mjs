// A block yad owns inside a file the team owns (E158): AGENTS.md and CLAUDE.md. Only the lines between the
// two markers are ever written; everything outside them is the team's and is kept byte for byte.
//
// The markers bound the block, so nothing has to guess where it ends (the lesson of E87: never infer the end
// of a generated block from headings). The rules follow `applyConfigRegions` (cli/lifecycle.mjs): exactly one
// begin marker followed by exactly one end marker, or the file is refused and left as it is; a file checked
// out with Windows line endings (CRLF) is compared without them and written back with them.
//
// Unlike a config region, a block that is not there yet is ADDED: the file is the team's, and yad's block is
// appended after their text, with one blank line between.

// The text of a file with yad's block in place, and what that changed.
//   status   'new'       the file had no block (or did not exist): it is appended
//            'outdated'  the block is there with other lines
//            'ok'        the block is there and right
//   refused  why the markers could not be trusted (a begin with no end, two of either, an end first). The
//            text is then returned unchanged.
// `text` is null for a file that does not exist.
// `beginKey` is the start every begin line shares, so a later release can reword the note after it.
export function applyMarkedBlock(text, { begin, beginKey = begin, end, lines }) {
  const source = text ?? '';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const want = [begin, ...lines, end];
  const all = source.split(/\r?\n/);
  const begins = all.flatMap((l, i) => (l.trim().startsWith(beginKey) ? [i] : []));
  const ends = all.flatMap((l, i) => (l.trim() === end ? [i] : []));
  if (!begins.length && !ends.length) {
    // Appended after the team's text, which is kept as it is: a newline is added only when it has none at the
    // end, and a blank line only when it does not already end with one.
    let head = source;
    if (head && !/\n$/.test(head)) head += eol;
    if (head && !/\n\r?\n$/.test(head)) head += eol;
    return { text: `${head}${want.join(eol)}${eol}`, status: 'new', refused: null };
  }
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
    return { text: source, status: null, refused: `the yadflow block needs exactly one line starting "${beginKey}" followed by one line "${end}"` };
  }
  const [b, e] = [begins[0], ends[0]];
  const same = all.slice(b, e + 1).join('\n') === want.join('\n');
  all.splice(b, e - b + 1, ...want);
  return { text: same ? source : all.join(eol), status: same ? 'ok' : 'outdated', refused: null };
}
