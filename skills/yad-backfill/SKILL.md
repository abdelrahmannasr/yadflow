---
name: yad-backfill
description: 'Build Step G of the gated SDLC — backfill: generate specs for already-built features in an existing repo so new work does not break them. Confirm Repomix (run through `yad repo pack`, which runs npx repomix@1.18.1 safely), pack ONE feature at a time (compress + git logs, secret-scan), feed it to AI with a "describe what exists, do not invent" prompt, and write a DRAFT spec marked unverified. Require human approval (reuse yad-review-gate) before the spec counts as real. Boundary is auto-proposed from the project convention and human-confirmed. A change is blocked only until the features IT touches have approved specs. The `promote` action flips a brownfield stub epic (minted by yad-stub, so defects could thread off it) to a real, verified feature epic once its backfill spec is approved. Use when the user says "backfill specs", "document an existing feature", "spec the legacy code", or "promote the stub epic".'
---

# SDLC — Backfill (existing-code specs)

<!-- generated: yad-cli — from cli/skill-yad-cli.mjs by scripts/skill-yad-cli.mjs; do not edit by hand -->

**This skill needs the `yad` command.** Before its first `yad …` command, run `command -v yad` (in PowerShell, `Get-Command yad`). When it prints nothing, the yadflow CLI is not installed on this machine: stop there, and tell the person:

- Install it with `npm install -g yadflow@latest`, or run each command as `npx -y yadflow@4 …` in place of `yad …`.
- It is needed because the CLI is what enforces the approvals. Without it, a step could only ask you to wait; it could not check that a person approved.

Go on only when `command -v yad` prints a path, or when the person chooses `npx -y yadflow@4`. A command this skill already writes as `npx -y yadflow@4 …` runs without the install.

<!-- end: yad-cli -->

**Goal:** Bring an existing repo (no specs) under the gated SDLC one **feature** at a time, by
generating a spec for what is **already built** — so future changes have a contract to check against
(build plan §G). The generated spec is a **draft, unverified** until a human approves it; only then does
it count. Gating is **per touched feature**: a new change is blocked only until the features it touches
have approved specs — never the whole repo at once.

## When a tool is missing

<!-- Written from yadflow's cli/toolbox.mjs (E87). Change the words there: a test holds this section to it. -->

No tool below is required. When one is missing, this skill still finishes, using the fallback written
beside it.

For Repomix, decide from yad's answer, not from a guess:
run `yad toolbox list --json` and read, in its `tools` list, the entry with the tool's `id`. Run it
where the tool will run: for work inside a code repo, add `--dir <that repo>`, so the tools installed
there are found.

- **The team's choices.** They come from the Product. If the answer's `product` is null, yad found no
  Product, so a tool the team chose not to use still shows `used: true`. Tell the person that.
- **When yad cannot see the tool.** yad does not read every way a tool can be set up (an older install
  may be missed). If the entry says `missing` but the check in the steps below finds the tool, use
  it — but never when the entry says `used: false`.
- **When yad cannot answer** (yad is not installed here, or the command fails), use the check in the
  steps below.

Before you fall back because a tool the team uses is not on this machine (not turned off, not removed
by the team), offer to connect it, once: run `yad toolbox connect <id> --json` and follow the
connect-tool rule. On a no, or when a step fails, use the fallback.

Tell the person which tools you used and which fallbacks, and why.

- **Repomix** (`repomix`). Use it when its entry has `used: true` and `status.state` is `installed` or `available`. Otherwise — not found, its plugin turned off in Claude Code, or the team chose not to use it (`yad toolbox remove repomix`) — use the fallback.
  - Fallback — no Repomix pack. yad-connect-repos and yad-backfill put the same context together by hand, from the source tree and the recent git log, and the Shape steps read the code map.
  - Record `source: repomix-unavailable`. It means the tool was not used, whatever the reason.

<!-- end: When a tool is missing -->

## Conventions

- `{project-root}` resolves from the project working directory; code repos are separate git repos under
  `{project-root}/demo-repos/<repo>/`.
- **Repomix runs through yad** (#213): `yad repo pack <repo> --include "<globs>" --logs -o <file>`. It runs
  `npx repomix@1.18.1` (the version yadflow vetted, never `@latest`) from an empty folder of its own, with
  the npm registry named, so a `.npmrc` committed to the repo cannot choose where Repomix comes from.
  **Never start Repomix with npx yourself inside a repo.** Repomix secret-scans by default (Secretlint) and
  yad shows its report.
- Backfilled specs live in the code repo at `specs/backfill/<feature>/spec.md`.
- A **feature** is the project's natural unit from the constitution (e.g. a module / a `src/<feature>/`
  directory). Auto-propose the boundary from the convention; **a human confirms** it where the code
  does not follow it.

## Inputs

- `repo` — the existing code repo to backfill.
- `feature` — the feature name (and its file globs, e.g. `src/<feature>/**`).
- `action` — `pack` | `draft` | `approve` | `gate` | `promote` (default `pack`).
- `epic` — `promote` only: the stub epic `EP-<slug>` (minted by `yad-stub`) to flip to real once the
  feature's backfill spec is approved.

## On Activation

### Step 1 — Propose the boundary (auto-propose, human-confirm)
From the constitution's convention (e.g. module = feature, or `src/<feature>/`), propose the feature's
file set. Present it and **ask the human to confirm or adjust** the boundary before packing. Never
guess silently where the code breaks the convention.

### Step 2 — `pack` (Repomix, one feature)
Run, over **only this feature's files** (`<repo>` is its name in `.sdlc/repos.json`):
```
yad repo pack <repo> --include "<feature globs>" --logs -o <out>.md
```
It packs with `--compress` (Tree-sitter structural compression), which keeps it small; `--logs` adds
the relevant git history (the last 50 commits); Secretlint secret-scans by default. If a
secret is reported, STOP and have it removed/redacted before continuing. (If Repomix is not
used — see **When a tool is missing** — degrade: hand-assemble the same feature context and record
`source: repomix-unavailable`.)

### Step 3 — `draft` (describe what exists — do NOT invent)
Feed the packed context to the AI with the **"describe what exists, do not invent"** instruction
(`references/backfill.md`). Write `specs/backfill/<feature>/spec.md` describing the feature's actual
endpoints/behaviour/data as built, with frontmatter:
```yaml
---
feature: <feature>
repo: <repo>
artifact: backfill-spec
status: draft
verified: false
source: repomix
generated: <YYYY-MM-DD>
---
```

When Repomix was not used, write `source: repomix-unavailable` instead.

`verified: false` means the spec is not real until a human approves it. Keep that line free of a `#`
comment: the gate reads the whole line, so `verified: true   # approved` would not count. Mark every
uncertain item explicitly (`<!-- unverified: ... -->`); do not fill gaps with invented behaviour.

### Step 4 — `approve` (human approval — reuse the gate)
A human reads the draft against the real code and approves it with the same `advance: human` discipline
as `yad-review-gate` (at least 1 approver who is not the author). On approval set the frontmatter line to exactly `verified: true` (lowercase, nothing after it — the
gate reads it from the base branch, so the approval merges before the change it allows) and record
the approver(s) + date. Only a `verified: true` backfill spec counts as real.

### Step 5 — `gate` (block changes per touched feature)
`bash checks/backfill-check.sh <base>` blocks a change that touches a feature being backfilled until
that feature's spec is `verified: true`. `<base>` is optional and resolves like every other gate's —
see "Resolving `<base>`" in `../yad-checks/references/check-gates.md`. It is **per touched feature** —
a change touching feature A is not blocked by an unverified feature B. Forward-spec'd features (those with their own `specs/<story>/`)
are not this gate's concern. The spec and its `verified: true` are read **from the base**, so an
approval counts once it is merged — approve in its own PR, before the change (E116). A symlink or
submodule at `src`, at `src/<feature>` or inside a feature being backfilled fails every PR until one PR
removes it; so do two spellings of that folder at once (`src/Billing/` beside `src/billing/`) until one
PR removes one of them.

### Step 6 — `promote` (flip a stub epic → real, once its spec is approved)
When a brownfield feature was anchored with a **stub genesis epic** (`yad-stub`) so that defects could
thread off it, `promote` is what makes that anchor real — run it once the feature's backfill spec is
`verified: true`. Given `epic EP-<slug>` (a stub: `stub: backfill-pending` / `verified: false`):

**Run the engine. Do not edit `epic.md` or the ledger yourself.** Ask the person which flavour they want
(below), then run:

```bash
yad backfill promote EP-<slug> --repo <repo> --feature <feature>          # light (the default)
yad backfill promote EP-<slug> --repo <repo> --feature <feature> --full   # full
```

`<repo>` is the code repo's name in `.sdlc/repos.json` and `<feature>` the folder under
`specs/backfill/`, so the spec it reads is `specs/backfill/<feature>/spec.md` in that repo's checkout
on this machine.

- **What it checks first.** The epic must be a stub, and the spec's frontmatter must say exactly
  `verified: true` — read the way the backfill gate reads it (Step 5). If either is missing it writes
  nothing and says which; approve the spec first (Step 4). The approval must be **committed**: the spec
  must say `verified: true` in the checkout and as committed at the repo's HEAD, so an edit nobody
  committed promotes nothing. CI's gate still reads the spec on the base branch: an approval committed on
  a branch but not merged yet passes here and still fails the gate. `--feature` is the folder's exact
  name, in the same case.
- **What it writes, together or not at all.** A stub is marked in two files at once, and `yad next`
  (reads `state.json`) and `yad thread` / `yad-status` (read `epic.md`) must agree, so it writes both:
  - **`epic.md`:** `verified: true`, no `stub:` marker, and a `backfill:` line naming the approved
    spec, such as `backfill: { repo: <repo>, spec: specs/backfill/<feature>/spec.md, promoted: <YYYY-MM-DD> }`.
    The rest of the file is kept. If the stub has no `title:`, set one after the promote (the one-line
    name of the feature), by the rules in the `title` row of the `epic.md` frontmatter table in
    `../yad-epic/references/state-schema.md`.
  - **the ledger:** it drops `kind: "stub"` and moves `currentStep` off the `backfill-pending`
    sentinel (per the flavour below). It keeps `type: "feature"`: `kind` is the lifecycle marker,
    `type` the work item, which a promoted stub still is.
  If either write fails, it puts both files back as they were.
- **Light promote (default):** the feature's documentation lives in the approved backfill spec — the
  Shape chain stays asleep, and `currentStep` becomes `backfill-done` (a terminal sentinel, like
  `discovery-done`): the epic is a real, verified anchor and its later evolution threads normally with
  `yad-change`. `yad next` then reports it as a documented anchor, not a pending stub.
- **Full promote (`--full`, opt-in):** to bring the feature fully under Shape and lock a real contract.
  `currentStep` becomes `epic` and the `epic` step opens; then run `yad-epic` → `yad-architecture` → …
  the normal way. This re-locks a contract that later thread changes will inherit. Choose before you
  run it: a light promote is not made full later by this command. A documented anchor goes under Shape
  through a change threaded off it, with `yad-change`.
- **A promote cut short** (some stub markers left from an older hand edit) is finished by the same
  command, when the ledger is still on `backfill-pending` or already on the step the flavour writes.
  When only the `stub:` line in `epic.md` is left, it finishes `epic.md` alone and keeps the ledger as it
  is — but a stray `stub:` line on an epic that never was a stub is refused. When it refuses, show the
  person its message and stop.
- **verified mode.** On a verified ledger CI is the only writer of the ledger, so the command refuses
  and writes nothing, as `yad gate approve` does. Tell the person what it says: the stub keeps working as
  an anchor, and the promotion has no CI path yet. Never push a ledger edit around the guard.
- Commit the two files together, in one commit, so no commit holds half a promote.
- Never auto-advances; a human confirms the promotion.

### Step 7 — Stop (no auto-advance)
Report the packed feature, the draft path (or the approval / promotion), and what is still unverified.
Nothing auto-advances; a human owns the approval.

## Hard rules (build plan §G, Cross-cutting)

- **Describe what exists; never invent.** A backfill spec is a record of built behaviour, not a design.
- **Draft until human-approved.** `verified: false` specs do not count; approval reuses the gate.
- **One feature at a time; gate per touched feature.** Never block the whole repo.
- **Repomix via its real CLI** (Phase 0); secret-scan before any AI sees the code.

## Reference
- The "describe what exists" prompt, the spec shape, and the gate: `references/backfill.md`.
- The human approval discipline reused: `../yad-review-gate/SKILL.md`.
- Minting the stub epic that `promote` later flips to real (brownfield thread anchor):
  `../yad-stub/SKILL.md`.
- Repomix flags: `RESEARCH-NOTES.md` §3.
