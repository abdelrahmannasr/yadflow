// Text a person reads and an agent acts on, with nothing hidden in it (E185). Shared by the local setup script and
// the toolbox's own tools, whose words become setup steps every member's agent reads.
import { forTerminal } from './lib.mjs';

// Every character a reader cannot see: control, format and separator characters (zero-width spaces, soft hyphens,
// tag characters, direction marks), every space but the plain one, variation selectors (which can carry text an
// agent reads and a person never sees), the fillers that render blank (Hangul, braille), and half a character
// pair (a lone surrogate).
// `Default_Ignorable_Code_Point` names the rest, now and as Unicode adds them (U+034F, U+17B4, …; review 2).
const INVISIBLE = String.raw`\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u115F\u1160\u3164\uFFA0\u2800`;
export const HIDDEN = new RegExp(String.raw`[\p{Cc}${INVISIBLE}]|(?! )\p{Zs}`, 'u');
// Prose may wrap: a newline is its one allowed control character.
const HIDDEN_IN_PROSE = new RegExp(String.raw`[${INVISIBLE}]|[^\P{Cc}\n]|(?! )\p{Zs}`, 'u');

export const isText = (v) => typeof v === 'string' && v.trim().length > 0;
// One plain line: nothing `forTerminal` would change, and nothing hidden.
export const plainLine = (v) => isText(v) && forTerminal(v) === v && !HIDDEN.test(v);
// Plain prose: lines of text, nothing hidden.
export const plainProse = (v) => isText(v) && !HIDDEN_IN_PROSE.test(v);

// How long each part of a step may be: a step is read by every member, so it stays readable.
export const STEP_LIMITS = Object.freeze({ title: 120, text: 600, commands: 10, command: 500 });
