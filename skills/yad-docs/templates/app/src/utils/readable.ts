// A colour used as text, made to read in both looks: in the dark look it is the colour itself; in the light
// look it is mixed toward the page's text colour, so a bright tint (#10b981, #f59e0b) still reads on white.
// The share is the CSS variable --color-tint-share (100% dark, 62% light), so the dark look never changes.
export const readable = (color: string): string =>
  `color-mix(in oklab, ${color} var(--color-tint-share), var(--color-text-primary))`;
