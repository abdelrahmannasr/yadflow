---
name: yad-stories
description: 'Shape step 7 of the gated SDLC. With the pm, break the approved epic into user stories, each tagged with the repos that must implement it. Assigns zero-padded EP-<slug>-S0N IDs and writes one file per story under stories/. Reads epic + architecture + contract + UI as input. Never auto-advances — hands off to the team review gate (an ordinary approval-count gate). Use when the user says "author the stories" or after the UI gate passes.'
---

# SDLC — Author Stories (Shape step 7)

**Goal:** Break an approved epic into human-authored, AI-assisted user stories, each with a stable
`EP-<slug>-S0N` ID and a `repos` tag listing which repos must implement it. This is a **Shape step**:
human-authored with AI assist, **never auto-advances**. When the stories are drafted, control passes
to `yad-review-gate`, an ordinary count gate: at least 1 distinct approver, who should not be the author. The stories'
`repos` tags still say which repos a story touches, and the review PR is labelled with those repos.

There is **no `sm` agent** (Phase 0 Deviation 1): the `pm` lens breaks down the epic; the `pm` or
`architect` lens prepares each story's detail. IDs are engine-assigned and never renamed.

## Conventions

- `{project-root}` resolves from the project working directory.
- Stories live under `{project-root}/epics/EP-<slug>/stories/` (build plan §6).
- Story files are named `EP-<slug>-S0N.md` (zero-padded, e.g. `EP-checkout-S01.md`).
- Speak in the `communication_language` set in `{project-root}/.sdlc/config.yaml`; write documents in `document_output_language`.

## On Activation

### Step 1 — Resolve the epic and check the gate
Resolve the `EP-<slug>` (ask if not provided).

**Precondition gate (rail):** run `yad next EP-<slug> --check stories` first. If it exits non-zero,
**STOP** — surface the blocker it prints and point the user at `yad next EP-<slug>`. Do not author until
it passes.

This passes when `stories` is the next runnable step per the state sequence — every prior step
(through the UI review) is `done` and `stories` is not already `done`.

### Step 1b — Open the authoring branch
Open the stories authoring branch `stories/EP-<slug>` per the shared procedure
(`../yad-epic/references/state-schema.md` → "Authoring branches"): git-safe (skip with a note
if `{project-root}` is not a git work tree), check out the branch if it exists, else create it from the
Product's default branch. Author the story files under `stories/` on it, and end the step with `yad fold EP-<slug> stories` — the
one commit the step keeps (E44). This is **distinct**
from the verified ledger's `review/…` branch.

### Step 2 — Read inputs
Read `epic.md` (scope, acceptance signals, `repos`), `architecture.md` (components by repo, flows),
`contract.md` (the shared surface stories must honour), and `ui-design.md` (screens/flows). Stories
must collectively satisfy the epic's acceptance signals and stay within the contract surface.

- **UI-optional-safe:** `ui-design.md` may be absent — the `ui-design` step is optional and can be
  marked N/A for an epic with no user-facing surface (state.json shows it `skipped`). When there is no
  UI design, proceed without UI screens; the epic's acceptance signals + contract remain the source of
  truth for the stories. If state.json shows it `deferred` instead, the UI **will** come later: write the
  stories so they do not assume there are no screens, and note in each story that touches the UI that
  its screens are still to be designed.
- **Short-lane-safe:** `architecture.md` and `contract.md` may BOTH be absent, and on the `chore` and
  `spike` routes they always are — those lanes carry no architecture step, so there is no locked
  contract for this epic. Read `state.json`'s `profile` key first — an epic seeded before file shape 6
  has no such key, so fall back to what its `steps[]` actually contains, which is the real answer
  either way. On a short lane, write the stories
  from `epic.md` alone and say so in each story's "Contract & design touchpoints" section. Because
  there is no lock, a story on a short lane **must not change the shared cross-repo surface**: if the
  work turns out to need that, stop and say so — the epic belongs on `classic`, which has the
  architecture gate that locks the surface.

### Step 2b — Load existing-code context (make the brain code-aware)
Read the registry `{project-root}/.sdlc/repos.json` (`config.yaml` `code_context`). For **each repo in
`epic.repos`**, load the code-map `{project-root}/.sdlc/code-context/<repo>/code-map.md` so each story's
**"Notes for build"** can point at the **real existing modules/files** a story extends — giving the
Phase 3 build (Spec Kit per repo) accurate anchors instead of invented ones.

- **Greenfield-safe:** if `repos.json` is absent/empty, note "no repos connected" and proceed.
- **Staleness:** if a repo's current HEAD ≠ its registry `syncedHead`, warn and suggest
  `yad repo refresh <repo>` (a human decision — flag and stop, never auto-refresh); stamp
  `code-context: stale` in the story frontmatter.
- **Traceability:** record the loaded maps in each story's `code-context:` frontmatter field.

### Step 2c — Load the design frames (so no one has to ask which screens a story builds)
When the UI step drew the screens in a design tool, it recorded them in
`{project-root}/epics/EP-<slug>/.sdlc/design-links.json`: a `screens` list, each with `name`, `platform`,
`nodeId` and `url`. Read it. In Step 5 each story lists the `nodeId`s of the screens it builds in its
`design-frames:` field, so the spec and implement steps read them with `yad story frames <story>`.

- **No file, no field:** with no `design-links.json` (no design tool, or the UI step skipped), leave
  the `design-frames:` line out of every story and name the screens in "Notes for build" as before.
  `[]` means "this story has no screens", which is not the same as "no frames were recorded".
- **IDs only, copied exactly, no quotes.** Copy each `nodeId` character for character, without quote
  marks. The name and link stay in `design-links.json`, so they are written down once. A frame ID holding a comma, a space, `#` or a
  bracket cannot be read back: ask for that frame to get a plain ID in the design tool.

### Step 3 — Break down the epic (assist: pm)
Adopt the **pm** lens. Decompose the epic into the smallest set of
independently reviewable, independently buildable stories. For each story decide which repos it touches
(must be a subset of the epic's `repos`). Prefer stories scoped to a clear slice of user value.

### Step 4 — Assign IDs (engine-assigned, never by hand)
Scan `stories/` for existing `EP-<slug>-S0N.md`. Assign the next zero-padded numbers continuing from
the highest existing one (`S01`, `S02`, …). **Never renumber or rename** an existing story — IDs are
permanent downstream links (build plan §6b).

### Step 5 — Prepare each story (assist: pm / architect)
Write one file per story, `{project-root}/epics/EP-<slug>/stories/EP-<slug>-S0N.md`, using EXACTLY this
template (see `references/story-schema.md`):

```markdown
---
id: EP-<slug>-S0N
epic: EP-<slug>
status: draft
owner: <inherit from epic.md owner>   # the epic owner carries through; not retyped
repos: [<subset of epic.repos this story implements>]
code-context: { repos: [], loaded: <YYYY-MM-DD or none> }   # code-maps anchoring "Notes for build" (Step 2b)
design-frames: []
---

## Story
As a <role>, I want <capability>, so that <outcome>.

## Acceptance criteria
- [ ] <testable criterion>
- [ ] <testable criterion>

## Notes for build
<!-- contract surface touched, architecture components involved, UI screens -->
<!-- this is the context the Phase 3 build (Spec Kit per repo) will read -->
```

`repos` is the field the later build phase reads to know where to scaffold specs — set it precisely.

`design-frames` lists the design-tool frame IDs (`nodeId`s from `design-links.json`, Step 2c) of the
screens this story builds, on ONE line: `design-frames: [12:34, 56:78]`. Leave it `[]` for a story with
no screens, and take the line out when the epic has no `design-links.json` (Step 2c). **Never put a `# comment` after it**, and never write it as a `- id` list on the lines
below: this frontmatter reader keeps the rest of the line, so either one makes the list unreadable.
Before the review, run `yad story frames <story>` for each story: it prints every frame's name and link,
and warns on an ID it cannot find. The field is part of the story, so the stories review approves it
like `repos`, and changing it after that review passed means the review must approve it again.

### Step 6 — Advance the authoring step (NOT the gate)
**Check the mode first — the two modes have opposite instructions here.** Read `.sdlc/product.json` (`.sdlc/hub.json` on an older Product that has only that name):
**verified mode** is `platform` set AND `ledger: "verified"` — or, on a project that has not run `yad migrate` yet, `bridge_enabled` (or legacy `bridge`) `true`. `ledger` wins whenever it is present.

**verified mode — do NOT write `state.json`.** The ledger is CI-owned: the `ledger-guard` check rejects
any non-bot commit touching `epics/*/.sdlc/{state,approvals,comments,product-prs,hub-prs}.json` or
`epics/*/reviews/*.md`, `yad gate open` deliberately skips this write for the same reason, and
`yad gate ci --merged` performs the whole transition when the review PR merges. Making the edit here
fails the gate if it rides the review PR, and desynchronises the ledger CI is about to rewrite if it
is pushed around the gate. Commit **the story files under `stories/` only** — nothing else
under `.sdlc/` (`yad fold EP-<slug> stories` takes exactly these) — then hand off to `yad-review-gate`.

**Otherwise — local, or a platform with no gate-sync CI — the engine makes this edit, not you.**
`yad gate open <epic> stories/` marks `stories-review` `in_review`, closes `stories` as `done`, and moves `currentStep` to the gate
— the same transition, from the one function that owns it (`markInReview`, `cli/epic-state.mjs`).
`yad-review-gate action: open` runs that command; hand off to it rather than editing the ledger here.

**With no platform configured** it writes the ledger and simply opens no PR, so this works offline.
**With a platform** the `review/EP-<slug>/stories` branch must already be **on origin** — the command
refuses and writes nothing otherwise. Cut it from the authoring branch and push it before handing off
(or run `yad open-pr` from that branch: it pushes the branch, then delegates).

Do **not** hand-edit `state.json`, and do **not** touch `approvals.json` — only real reviewers approve,
through the gate.

### Step 7 — Stop at the gate (do NOT advance)
Report: the story IDs created, the repos each touches, and that the next action is **review** via
`yad-review-gate`. This review is an ordinary count gate: it passes with at least 1 distinct approver (who
should not be the author) and, with a platform, resolved threads and a merged review PR. It is not routed per repo, and it requests no
reviewers — the team asks them on the review PR itself. When this gate
passes the epic becomes **`ready-for-build`** — Build can start **and** the parallel
**`test-cases`** track opens for the tester (`yad-test-cases`); the two run at the same time. **Never record
approval here.** Shape steps do not auto-advance. When the Product has a platform, the gate opens a review
PR on the Product (via `yad-product-bridge`, with a `domain:<repo>` label per touched repo) and
`yad-review-gate action: sync` pulls platform approvals/comments into the ledger; otherwise the review
is recorded local.

## Reference
- Story frontmatter and body template: `references/story-schema.md`.
- State schema and field meanings: `../yad-epic/references/state-schema.md`.
- Connecting code repos + the code-context the brain reads: `../yad-connect-repos/SKILL.md`.
