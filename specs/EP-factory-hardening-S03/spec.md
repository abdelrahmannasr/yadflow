# Spec — EP-factory-hardening-S03: read the committed CI and gate files only as plain files

Story: `EP-factory-hardening-S03` (epic `EP-factory-hardening`), engine repo. Issue: Product #222.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad doctor`, `yad check` / `yad update` and setup read the text files a Product commits — CI workflows,
`.gitlab-ci.yml` and its fragments, gate scripts under `checks/`, git hooks, the old `_bmad/sdlc/config.yaml` —
with `fs.readFileSync`, which follows a link and waits for ever on a device. A committed link to `/dev/zero`
hangs the command; a link out of the Product makes yad read a file it does not own. The wired-file compare
(`contentSha`) has the same read, and the writes after it follow a link too: `copyFile` copies onto a link at the
destination (a dangling one makes its target), the `.yad-orig` backup copies through one, and the GitLab include
rewrite in `yad update` writes the root `.gitlab-ci.yml` through one.

## Requirements

- R1. `readPlainText(p, opts)` in `cli/lib.mjs` gives a file's text, or `null` for no file, a link (dangling or
  not), a folder, a device, a file under a linked folder of the Product, a file too big, or one yad may not open.
  It is built on `readPlainFile`, so it never follows a link and never waits on a device.
- R2. `cli/doctor.mjs`, `cli/plan.mjs` and `cli/reconcile.mjs` read the committed text files through it (or through
  `readPlainFile`, where a refused file must be told from a missing one). Each place keeps its answer for a missing
  file; a link, folder or device gets that answer.
- R3. `contentSha` gives no sha for a link, a folder, a device, a file under a linked folder or one too big, as for a
  missing file; a file yad may not read still throws. So a wired file there is `missing`, is never backed up by
  reading through it, and is written fresh.
- R4. Nothing is written through a link: `copyFile` copies to a new file beside the destination and renames it over,
  so a link there is replaced; the `.yad-orig` backups use it; the GitLab include rewrite and the local setup notice
  copy are written with `writeFileAtomic`. A git hook that is a link, a folder or a device, or one in a linked hooks
  folder, is `foreign`: yad writes no hook through it and never replaces it. A notice copy in a linked folder of the
  Product is not written.
- R5. A test fails when a new direct `readFileSync(` (or `readFile(`, `createReadStream(`) appears in those three
  files, except the listed reads of yad's own shipped files, each with its reason.

## Out of scope

`cli/detect.mjs` reads a project's `SKILL.md`, agent files and `.opencode/commands/*.md` following links (a later
story). Files in a code repo outside the Product are checked at the file's own name only, not for a linked folder
(no `within` is passed). A link swapped in between the check and the open (the file's own name keeps its
O_NOFOLLOW check). The hook write itself (`fs.writeFileSync` of a hook judged missing or yad's own) is not made
atomic.

## Clarifications

### Session 2026-11-19
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: A wired file that is a link: missing (written fresh) or left alone? → A: missing, as a file yad cannot read is; the new file replaces the link, never writes through it.
- Q: A git hook that is a link? → A: ~~foreign~~ — superseded by the review below: 'linked'.
- Q: Code review of T01–T04 (2026-11-19)? → A: no blockers; fixed in T05–T08: the hook and rules-block writes look again and write through a rename (mode set on the new file); every `.yad-orig` backup reads only a plain file (`backupPlain`); a hook that is a link, or in a linked folder, has its own state ('linked') and honest advice in doctor; a wired file tells a link (replaced, and said so) from a folder, a device, a file too big or one under a linked folder (named, nothing written, the run goes on). yad's own shipped gate-sync fragment is read through `readPlainText` too.

## Plan

Add `readPlainText`, make `contentSha` and `copyFile` safe in `cli/lib.mjs`, then swap each raw read in plan, doctor
and reconcile. Tests link each file to an outside file whose text would change the answer, to a missing target, to a
folder, and to `/dev/zero` (in a child with a time limit), and check the answer is the missing-file one, the outside
file is unchanged and no dangling target is made. A guard test counts the direct reads left in the three files.

## Tasks

<!-- yad:tasks -->
## T01 — Add readPlainText, and give contentSha and copyFile no way through a link
**Files:**
- cli/lib.mjs
- cli/test.mjs

## T02 — Read and write setup's CI files, gate scripts and git hooks only as plain files
**Files:**
- cli/plan.mjs
- cli/test.mjs
- cli/test-hooks.mjs

## T03 — Read doctor's and check's CI files, gate scripts and old config only as plain files
**Files:**
- cli/doctor.mjs
- cli/reconcile.mjs
- cli/test.mjs

## T04 — Fail a new direct read in doctor, setup or check, and say what a linked CI file does
**Files:**
- cli/test.mjs
- docs/CLI.md

## T05 — Back up only a plain file, and set a new file's mode before its rename
**Files:**
- cli/lib.mjs
- cli/test.mjs

## T06 — Tell a link at a wired file from one yad may not write, and go on with the others
**Files:**
- cli/plan.mjs
- cli/setup.mjs
- cli/reconcile.mjs

## T07 — Give a linked git hook its own state and advice, and write hooks only through a rename
**Files:**
- cli/plan.mjs
- cli/doctor.mjs
- cli/test-hooks.mjs

## T08 — Test the wired-file cases end to end, read yad's own fragment plainly, and say what is written in the docs
**Files:**
- cli/test.mjs
- cli/reconcile.mjs
- docs/CLI.md
<!-- /yad:tasks -->
