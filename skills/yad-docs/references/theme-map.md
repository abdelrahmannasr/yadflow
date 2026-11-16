# Theme map — DESIGN tokens → `index.css` `:root`

`yad-docs` themes only the **two `:root` blocks** at the top of the copied shell's `src/index.css`: the
dark look (the first `:root`) and the light look (the `:root` inside `@media (prefers-color-scheme:
light)`). The site follows the viewer's setting, so both must be themed (E186). Nothing else in the file
changes: the font variables, the Tailwind remaps in the light block, the utilities, and the empty
`yad-brand` block at the end stay as copied. Fonts are **Space Grotesk** (display / headings) + **Noto
Sans** (body), and the `.glass-panel` / `.flow-grid` / `.code-block` utilities and Material Symbols icon
names are untouched.

## 4-tier priority (first hit wins, per property)

For each custom property, resolve its value in this order and **stamp `theme:` in `docs-build.json`** to
the tier that supplied the palette:

1. **`DESIGN.md`** (`theme: DESIGN.md`) — the epic's hand/Impeccable-authored design-system tokens. The
   richest source; use it when present.
2. **`design.json` / `design-links.json` palette** (`theme: design.json`) — the connected design tool's
   palette (e.g. a Figma file's color styles read back).
3. **code-map tokens** (`theme: design.json`-tier fallback, noted) — brand/theme tokens captured in
   `.sdlc/code-context/<repo>/code-map.md` for repos in `epic.repos`, so the site matches the built UI.
4. **default theme** (`theme: default`) — keep the shell's reference `:root` verbatim (the dark theme
   below). Stamp `theme: default` so the degrade is visible.

A single missing token falls through to the next tier for **that token only** (the others can still come
from a higher tier); only a wholesale absence stamps `theme: default`.

## Token → custom-property mapping

Map design tokens onto these 20 properties, once in the dark `:root` and once in the light one. **Change
only the values of these 20 lines; leave every other line of both `:root` blocks exactly as copied**: the
overlay, canvas, on-primary and tint variables, the `--font-*` variables, `color-scheme`, and in the light
block the Tailwind remaps (`--color-white`, `--color-slate-*`, the -300/-400 tints). Each of those is used
by the components, and one left out breaks the page (no font, a panel with no background, white headings
on a white page). Names match the reference `index.css` — do not rename or add properties. The defaults
below are the dark look's; the light look's are in the reference file's light block.

| Design token (role) | CSS custom property | Default (reference) |
|---------------------|---------------------|---------------------|
| page background | `--color-bg-primary` | `#141118` |
| raised surface | `--color-bg-secondary` | `#1e1a25` |
| higher surface | `--color-bg-tertiary` | `#2f2938` |
| brand wash | `--color-bg-brand-soft` | `#1a0244` |
| accent wash | `--color-bg-accent-soft` | `#25060e` |
| panel surface | `--color-surface-dark` | `#1e1a25` |
| highlighted surface | `--color-surface-highlight` | `#2f2938` |
| darkest surface (code blocks) | `--color-surface-darker` | `#0f0e13` |
| primary text | `--color-text-primary` | `#ffffff` |
| secondary text | `--color-text-secondary` | `#a8a4b2` |
| muted text | `--color-text-muted` | `#767284` |
| **primary brand** | `--color-primary` | `#6116da` |
| primary hover | `--color-primary-hover` | `#7a2ce0` |
| primary soft | `--color-primary-soft` | `#35087c` |
| **accent** | `--color-accent` | `#ff6490` |
| accent hover | `--color-accent-hover` | `#fb2576` |
| accent soft | `--color-accent-soft` | `#4f0520` |
| light border | `--color-border-light` | `#453c53` |
| default border | `--color-border-default` | `#342e40` |
| strong border | `--color-border-strong` | `#141118` |

### Derivation rules (deterministic)
- The two anchors are **`--color-primary`** and **`--color-accent`**; everything else derives from them
  and the background ramp when a source supplies only a brand + accent.
- `*-hover` = the anchor lightened one step; `*-soft` = the anchor darkened/desaturated for washes.
  Apply a **fixed** lightness delta (no randomness) so regeneration is byte-identical.
- The background ramp (`bg-primary` → `bg-tertiary` → `surface-*`) is darkest→lighter in the dark
  look and lightest→darker in the light look; preserve that ordering when mapping a source's neutrals.
  A source with only one scheme: map it onto its own look and keep the reference values in the other.
- Always set **all 20 values** in the **fixed order above** (matching the reference file), in both
  looks, with no trailing timestamp/comment — the theme contributes to the `artifactHash`, so determinism matters.

## Fonts + utilities (never themed)
Headings/`.font-display` → **Space Grotesk**; body/`.font-body` → **Noto Sans**. The `.glass-panel`,
`.flow-grid`, `.code-block`, scrollbar, and `.logs-scrollbar` utilities are copied verbatim from the
shell. Icons are **Material Symbols** names (e.g. `phone_iphone`, `terminal`, `bar_chart`) carried in
the data files, not the theme.

## The Product's brand (never themed here)
`src/data/brand.ts`, the `yad-brand` block at the end of `index.css`, and the `yad-brand:head` block in
`index.html` belong to `yad docs brand <site>` (E186). Copy them as they are and never write them: that
command fills them from the Product's `.sdlc/brand.json`, and a later copy of the shell must not undo it.
