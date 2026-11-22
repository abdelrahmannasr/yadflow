---
name: yad-brand
description: 'Makes every page yadflow generates for this Product wear the Product''s own design system — its logo, colours and fonts — by filling the one small brand file, .sdlc/brand.json (E184). Runs `yad brand init` when the DESIGN.md is machine-readable (YAML front matter or a CSS :root block); otherwise reads a prose DESIGN.md, a design folder, or a connected design tool, and writes the same file by hand: seven colour roles (bg, surface, text, muted, border, primary, accent) for light and dark, the logo and mark paths, and the font families and files. Never invents a colour: a role it cannot find is left out and named, and yadflow''s value is used — or, with Impeccable, suggests one from the same palette, written only on the person''s yes. Then runs `yad brand check` and shows the person the result. Not a gated step — it never touches epic state or approvals. Use when the user says "use our brand", "theme the reports", "add our logo", "brand init", or "the pages should use our design system".'
---

# yadflow — the Product's brand on every page (E184)

<!-- generated: yad-cli — from cli/skill-yad-cli.mjs by scripts/skill-yad-cli.mjs; do not edit by hand -->

**This skill needs the `yad` command.** Before its first `yad …` command, run `command -v yad` (in PowerShell, `(Get-Command yad -ErrorAction SilentlyContinue).Source`). When it prints nothing, the yadflow CLI is not installed on this machine: stop there, and tell the person:

- Install it with `npm install -g yadflow@latest`, or run each command as `npx -y yadflow@4 …` in place of `yad …`.
- It is needed because the CLI is what enforces the approvals. Without it, a step could only ask you to wait; it could not check that a person approved.

Go on only when that check prints a path, or when the person chooses `npx -y yadflow@4`. A command this skill already writes as `npx -y yadflow@4 …` runs without the install.

<!-- end: yad-cli -->

**Goal:** every page yadflow makes for this Product — the progress map, the brain view, the standup, usage
and issues reports, the saved-reports catalog, and the generated doc sites (`yad docs brand <site>`, E186) — wears the Product's own logo, colours
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
   filled each role and which roles it could not fill. If it succeeds, go to step 4 (missing roles), then step 5.
2. **Otherwise, read the design system yourself.** A prose DESIGN.md (tables of named colours), a design
   folder (`design/`, `designs/`, `design-system/`), or a connected design tool (`.sdlc/design.json`; read its
   variables through its MCP, as yad-ui does). Find, for each role, the colour the design system itself
   names for that purpose. **Never invent or "pick a nice" colour.** If the design system does not say,
   leave the role out and tell the person which roles are missing.
3. **Write `.sdlc/brand.json`** with the roles you found, the logo and mark paths (inside the Product), and the
   font families (and their files, when the Product holds them). Set `"source"` to the file you read.
4. **Missing roles (optional, only with Impeccable).** Skip this step when no role is missing (step 1 or 2
   named none), or when Impeccable is not installed: run `yad toolbox list --json` and go on only when the
   `impeccable` entry's `status.state` is `installed`. Then, for each missing role (an unset
   `accent`, say, or a whole dark look):
   1. Use Impeccable to suggest a value **taken only from the colours the design system already names** — a
      palette colour suited to that role, or a dark-look colour from the same palette. Never a new colour.
   2. Work out its contrast with the rules `yad brand check` applies (it names each pair it checks, such as
      `text` 4.5:1 on `bg`). Drop a suggestion that would make it warn.
   3. Show the person, one line per role: the role, the value, the palette name it comes from, and its
      contrast. Ask once for the whole list; they may accept some and refuse others.
   4. Write only the roles they said yes to. Leave every other missing role out and named, as before.
   Without Impeccable, or on a no, nothing changes: the missing roles stay out, and yadflow's value is used.
5. **Check:** run `yad brand check`. Fix every problem it names (an unusable value, a path outside the
   Product, a file too big). Report its contrast warnings to the person; do not change their colours
   yourself.
6. **Show the person** `yad brand show` (the resolved look) and say which pages will now wear it. The brand file
   is committed like any other Product file; the person commits it.

## Rules

- One brand per Product. A Product with several brands (one per site) picks the umbrella brand for its
  pages; the person says which.
- Never copy a logo or font from outside the Product into it without the person's yes.
- Never put a colour that is not in the design system into the file. The one way to fill a role the design
  system leaves unset is step 4: a colour from the same palette, suggested with Impeccable, that the person
  said yes to.
- When DESIGN.md changes later, `yad brand check` and `yad doctor` say the brand file is stale — but only for
  a file `yad brand init` made (it stamps `sourceHash`). A file you write by hand has none, so nothing can tell
  when its design system moves on: `yad brand check` says so, and you tell the person to run this skill again
  when their design system changes.
- `yad brand init` writes a committed file (and `--force` replaces the team's edits), so run it only when the
  person asks for their brand.
