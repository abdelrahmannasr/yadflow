# Spec — EP-reported-fixes-S03: links, accent and the map follow the brand

Story: `EP-reported-fixes-S03` (epic `EP-reported-fixes`), engine repo. Issue: engine #564.
This epic is on the chore route, so it defines no contract surface; this story touches none. The UI it
changes is yadflow's own generated report pages; there are no design-tool frames.

## Problem

The standup page has no colour rule for links, so in dark mode they keep the browser's default blue,
about 1.3:1 on a brand's dark surface. The brand's accent is used on no report page. The progress map
paints its own fixed header, table head, overlays, tints, focus ring and canvas sky, so a brand file
changes little of what people see there.

## Requirements

- R1. The standup colours links with `--link` and its focus ring with `--accent`, mapped to the brand's
  `primary` and `accent`, light and dark.
- R2. The map's CSS rules paint no fixed colour for the header, table head, list overlay, search box,
  tints, links or focus ring: each uses a variable the brand sets (`--bg`, `--tint`, `--link`,
  `--focus`). The defaults in `:root` keep the prototype's values.
- R3. The canvas sky reads `--bg`: with a brand (yadflow's own when the Product has none, since
  `yad map` always adds one) it is the brand's dark bg with a soft lift towards the bottom; a page served
  with no brand CSS keeps the prototype's two blues.
- R4. `yad brand check` warns, never fails, when the link colour is under 4.5:1 on `surface`, as it does
  on `bg`. `yad doctor` (no links option) does not warn about links.
- R5. The status colours keep their meaning: they change only when the brand sets them.

## Clarifications

### Session 2026-11-17
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface, no high-risk file; the engine has no risk map)

## Plan

Add `--link`/`--accent` and their rules to the standup's inline style, and map them in
`PAGE_MAPS.standup`. In the map's stylesheet, add `--tint`, `--focus` and `--link` to `:root` and turn
every fixed colour in the rules into those variables or `color-mix()` over them; `PAGE_MAPS.map` maps
them to the brand's dark primary and accent. `drawBg` in `app.js` reads `--bg` once. `contrastProblems`
gains the link-on-surface pair under `links: true`.

## Tasks

<!-- yad:tasks -->
## T01 — Brand mapping, standup links and accent, link contrast on surface
**Files:**
- cli/brand.mjs
- cli/standup.mjs
- cli/test-standup.mjs

## T02 — The map's stylesheet and canvas sky use the brand's variables
**Files:**
- cli/map/view/style.css
- cli/map/view/app.js

## T03 — Tests for the map's variables, the unbranded default and the surface contrast
**Files:**
- cli/test-brand.mjs
<!-- /yad:tasks -->
