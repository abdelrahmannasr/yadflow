---
name: yad-brand
description: 'Makes every page yadflow generates for this Product wear the Product''s own design system — its logo, colours and fonts — by filling the one small brand file, .sdlc/brand.json (E184). Runs `yad brand init` when the DESIGN.md is machine-readable (YAML front matter or a CSS :root block); otherwise reads a prose DESIGN.md, a design folder, or a connected design tool, and writes the same file by hand: seven colour roles (bg, surface, text, muted, border, primary, accent) for light and dark, the logo and mark paths, and the font families and files. Never invents a colour: a role it cannot find is left out and named, and yadflow''s value is used. Then runs `yad brand check` and shows the person the result. Not a gated step — it never touches epic state or approvals. Use when the user says "use our brand", "theme the reports", "add our logo", "brand init", or "the pages should use our design system".'
---

# yadflow — the Product's brand on every page (E184)

**Goal:** every page yadflow makes for this Product — the progress map, the brain view, the standup, usage
and issues reports, and the saved-reports catalog (the doc sites follow later, E186) — wears the Product's own logo, colours
and fonts. Pages never read a design system directly. They read **one** file, `.sdlc/brand.json`. This skill
fills it.

With no brand file, the pages wear yadflow's own look (its purple and pink, and its mark). That is fine and
is never an error.

## The file

```json
{ "version": 1, "name": "<the product's name>",
  "source": "DESIGN.md", "sourceHash": "<only yad brand init writes it; omit it when you write the file by hand>",
  "logo": "<path inside the Product: .svg/.png/.webp/.jpg, at most 512 KB>",
  "mark": "<a small square version of the logo — the favicon-like mark>",
  "colors": {
    "light": { "bg": "…", "surface": "…", "text": "…", "muted": "…", "border": "…", "primary": "…", "accent": "…" },
    "dark":  { …the same roles… } | null },
  "fonts": { "heading": { "family": "<name>", "files": ["<.woff2/.woff/.ttf/.otf inside the Product>"] } | null,
             "body": { … } | null, "mono": { … } | null },
  "status": null }
```

- **Colours** are hex (`#1f6f8b`) or `rgb()`, `hsl()`, `oklch()`, `oklab()` of numbers. Nothing else is
  accepted — a value that is not one of these makes the file unusable.
- **Roles:** `bg` the page, `surface` cards and panels, `text` body text, `muted` secondary text, `border`
  hairlines, `primary` the main brand colour (buttons, links), `accent` the second brand colour.
- `dark: null` lets yadflow make a dark look: a neutral dark that keeps your primary and accent.
- `status` stays `null` unless the person asks: the progress map's status colours carry meaning (blue = in
  Production, pink = waiting, amber = in progress) and stay the same in every project.

## Steps

1. **Machine-readable first.** The person asked for their brand, so run `yad brand init` (or `--from <file>` for a DESIGN.md that is not at the
   Product's root, `--logo <file>` / `--mark <file>` when the files are not found by name). It reads YAML
   front matter (`colors:`, `typography:`) or a CSS `:root { --name: value }` block, and prints which name
   filled each role and which roles it could not fill. If it succeeds, go to step 4.
2. **Otherwise, read the design system yourself.** A prose DESIGN.md (tables of named colours), a design
   folder (`design/`, `designs/`, `design-system/`), or a connected design tool (`.sdlc/design.json`; read its
   variables through its MCP, as yad-ui does). Find, for each role, the colour the design system itself
   names for that purpose. **Never invent or "pick a nice" colour.** If the design system does not say,
   leave the role out and tell the person which roles are missing.
3. **Write `.sdlc/brand.json`** with the roles you found, the logo and mark paths (inside the Product), and the
   font families (and their files, when the Product holds them). Set `"source"` to the file you read.
4. **Check:** run `yad brand check`. Fix every problem it names (an unusable value, a path outside the
   Product, a file too big). Report its contrast warnings to the person; do not change their colours
   yourself.
5. **Show the person** `yad brand show` (the resolved look) and say which pages will now wear it. The brand file
   is committed like any other Product file; the person commits it.

## Rules

- One brand per Product. A Product with several brands (one per site) picks the umbrella brand for its
  pages; the person says which.
- Never copy a logo or font from outside the Product into it without the person's yes.
- Never put a colour that is not in the design system into the file.
- When DESIGN.md changes later, `yad brand check` and `yad doctor` say the brand file is stale — but only for
  a file `yad brand init` made (it stamps `sourceHash`). A file you write by hand has none, so nothing can tell
  when its design system moves on: `yad brand check` says so, and you tell the person to run this skill again
  when their design system changes.
- `yad brand init` writes a committed file (and `--force` replaces the team's edits), so run it only when the
  person asks for their brand.
