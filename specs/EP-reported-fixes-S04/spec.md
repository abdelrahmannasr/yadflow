# Spec — EP-reported-fixes-S04: the brand skill suggests missing colours with Impeccable

Story: `EP-reported-fixes-S04` (epic `EP-reported-fixes`), engine repo. Issue: engine #563.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

When a design system leaves colour roles unset (an accent, or a whole dark look), `yad-brand` leaves them
out and yadflow's own colours fill them, so the generated pages mix two brands.

## Requirements

- R1. A new optional step in `skills/yad-brand/SKILL.md` runs only when roles are missing and
  `yad toolbox list --json` shows `impeccable` with `status.state` `installed`.
- R2. Each suggestion is a colour the design system already names; it is checked with the contrast rules
  `yad brand check` applies, and shown with its role, value, palette name and contrast.
- R3. Only the roles the person says yes to are written; without Impeccable, or on a no, nothing changes.
- R4. The Rules section names this as the one exception to "never put a colour that is not in the design
  system into the file"; the skill's description stays within 1024 characters.
- R5. `cli/toolbox.mjs` is unchanged: Impeccable's fallback text is yad-ui's and would be copied into
  this skill word for word if `yad-brand` were added to its `usedBy`.

## Clarifications

### Session 2026-11-17
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface, no high-risk file; the engine has no risk map)

## Plan

Insert step 4, "Missing roles (optional, only with Impeccable)", between writing the file and checking it;
renumber Check and Show to 5 and 6, and point step 1's success path at step 4. Add the exception to the
Rules, and one clause to the description. Merge after S03, whose surface contrast check `yad brand check`
then applies.

## Tasks

<!-- yad:tasks -->
## T01 — Add the optional Impeccable step to the yad-brand skill
**Files:**
- skills/yad-brand/SKILL.md
<!-- /yad:tasks -->
