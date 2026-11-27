# Spec — EP-reported-ci-checkout-S02: the hooks' one shell spawn carries its reason and a `nosemgrep` note

Story: `EP-reported-ci-checkout-S02` (epic `EP-reported-ci-checkout`), engine repo. Issue: engine #704.
This epic is on the chore route, so it defines no contract surface; this story touches none. It changes
comments only: no behaviour changes.

## Problem

Four hook templates under `skills/yad-checks/templates/hooks/` share one block of code, between
`// ---- yad-resolve` and `// ---- end yad-resolve`. Test E113 (`cli/test-hooks.mjs`) keeps the block
byte-identical in all four. The block finds the `yad` command (`resolveYad`) and starts it (`runYad`).

On Windows, an npm launcher is a `.cmd` file, and Node cannot start a `.cmd` or `.bat` file without a
shell (it refuses since Node 18.20.2). So `runYad` starts that one case through a shell:

```js
if (yad.shell) return spawnSync([yad.file, ...all].map(quoteForCmd).join(' '), { ...options, shell: true, windowsHide: true });
```

Every word is wrapped in double quotes by `quoteForCmd`, and a Windows path cannot hold a `"`, so the
quoting is whole. A team that scans its repos with Semgrep (a code scanner) still gets an error-level
finding on that line, with no note on why the shell is there.

## The Semgrep run (before the change)

Semgrep 1.187.0, run on the four templates with `--metrics=off`:

| Config | Findings of `spawn-shell-true` |
|---|---|
| `p/javascript` | none (the rule is not in that pack) |
| `p/default` | 4 |
| `r/javascript` | 4 |
| `r/javascript.lang.security.audit.spawn-shell-true.spawn-shell-true` | 4 |

- **Rule id:** `javascript.lang.security.audit.spawn-shell-true.spawn-shell-true`, severity `ERROR`.
- **Flagged lines:** only the `spawnSync(…, { ...options, shell: true, windowsHide: true })` line in
  `runYad`: `agent-guard.mjs:82`, `yad-capture.mjs:82`, `ledger-guard-cursor.mjs:92`, `ledger-guard.mjs:96`.
- **Not flagged:** the three `shell:` values that `resolveYad` returns. They are plain data, not a spawn.

`r/javascript` also reports two `missing-template-string-indicator` findings (severity `INFO`) at
`ledger-guard-cursor.mjs:125`. They are outside the block and out of scope.

## Requirements

- **R1.** In `runYad`, the flagged `spawnSync` line ends with
  `// nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true`, on that same line.
- **R2.** The comment just above that line gives the reason: Windows cannot start a `.cmd` or `.bat`
  launcher without a shell (Node refuses since 18.20.2); every word is wrapped in double quotes, and a
  Windows path cannot hold a `"`. It reuses the wording of the comment above `quoteForCmd`.
- **R3.** The `resolveYad` lines get no note, because Semgrep does not flag them.
- **R4.** The block is byte-identical in `agent-guard.mjs`, `ledger-guard.mjs`, `ledger-guard-cursor.mjs`
  and `yad-capture.mjs`. E113 passes.
- **R5.** Only comments change: with `//` comments removed, the four files are the same as before.
- **R6.** After the change, Semgrep (`r/javascript.lang.security.audit.spawn-shell-true.spawn-shell-true`
  and `p/default`) reports no `spawn-shell-true` finding on the four templates.
- **R7.** The hook tests pass on Linux, macOS and the Windows CI leg (which runs the `.cmd` launcher path).
- **R8.** The engine's own installed `checks/agent-guard.mjs` is not edited; `yad update` brings it in line.

## Non-goals

- `cli/lib.mjs` (the CLI's own launcher).
- Starting `cmd.exe` by hand, or removing the shell path.
- The two `INFO` findings in `ledger-guard-cursor.mjs`.

## Clarifications

- **Q1. Same line, or the line above?** Same line, as the story asks. Semgrep reads a `nosemgrep`
  comment on the flagged line, and the rule id in it limits the note to this one rule.

## Plan

In the shared block of each of the four templates, add the reason comment above the `if (yad.shell)`
line in `runYad`, and add the `nosemgrep` comment at the end of that line. Copy the block from
`agent-guard.mjs` to the other three so they stay byte-identical. Then run Semgrep again (R6), E113 and
the full suite, and compare the files with comments removed (R5).

## Tasks

<!-- yad:tasks -->
## T01 — the hooks' shell spawn carries its reason and a `nosemgrep` note
**Files:**
- `skills/yad-checks/templates/hooks/agent-guard.mjs`
- `skills/yad-checks/templates/hooks/ledger-guard.mjs`
- `skills/yad-checks/templates/hooks/ledger-guard-cursor.mjs`
- `skills/yad-checks/templates/hooks/yad-capture.mjs`

**Done when:** R1–R8 hold. Semgrep reports no `spawn-shell-true` finding on the four files, E113 and the
full suite pass, and the diff with comments removed is empty.
<!-- /yad:tasks -->
