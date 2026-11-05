# Design context — MCP detection, generate vs link, and the degrade path

How a connected design tool turns into the actual feature design the UI step materializes. The design
tool is reached through its **MCP** (a harness MCP server), the same shape as Impeccable's
slash-commands — detect it, use it when present, degrade cleanly when absent. This is the design-side
analogue of `yad-connect-repos`'s code-context.

## Provider detection

`connect`/`refresh` records `provider` (the concrete MCP) and `source` (the MCP id, or `unavailable`).
Detection is best-effort against the user's own authenticated MCP session:

| `tool` | MCP / provider | Capability |
|--------|----------------|------------|
| `figma` | a Figma Dev Mode MCP | **read/link** — reference a file, read frames back into `ui-design.md` |
| `figma` | html.to.design MCP (`import-html`) | **generate** — render HTML/CSS screens into a Figma file |
| `pencil` | the `pencil` MCP (`batch_design`) | **generate** — author `.pen` web/mobile screens directly |
| `openpencil` | its CLI (`openpencil eval … --write`), or its MCP while the desktop app is open | **generate** — create frames in the epic's design file in the repo, then save it |
| other | the adapter's named MCP | per that adapter |

**Honest capability note:** not every design-tool MCP can *write*. A read-only Figma Dev Mode MCP
supports **link + read-back** only; *generate* needs a write-capable provider (html.to.design for Figma,
`pencil` or `openpencil`). `yad-ui` picks the direction the connected provider actually supports and records which one
it used (`direction: generated | linked`). It never claims to have generated screens a read-only MCP
cannot produce.

## Generate (push screens into the tool)

When the connected provider is write-capable, the `ux-designer` lens produces the epic's screens in the
tool, covering the screens/states `ui-design.md` enumerates and the user flows the architecture defines:

- **Figma via html.to.design** — the lens drafts each screen as HTML/CSS (reusing `DESIGN.md` tokens),
  then imports it into the Figma file via the MCP's `import-html`, one frame per screen.
- **pencil** — the lens calls `batch_design` to author the screens as `.pen` frames directly (mobile
  and/or web per the epic).
- **openpencil** — the lens writes the screens into the epic's design file, `epics/EP-<slug>/design/<name>.fig`
  (created on first generate), one frame per screen, with `openpencil eval <file> --stdin --write` (Figma
  Plugin API code, run on the file with no app open). With the desktop app open on the file, the
  `open-pencil` MCP may be used instead. Until E164's second PR, `yad fold` does not take the `design/` folder: commit it on the review
  branch with `git`, as `yad-ui` says.

Reuse what already exists: load the connected code repos' code-maps (`yad-ui` Step 2b) and any
Impeccable `DESIGN.md` tokens so generated screens match built components, not invented ones.

## Link (reference a human-made design)

When a designer has already built the screens (or the provider is read-only), point `yad-ui` at the
existing file and **read the frames back** so `ui-design.md` reflects the real design: list each frame as
a screen, capture its node id + URL, and map components/tokens into `DESIGN.md`.

## Write back the linkage (done by `yad-ui`, per epic)

Either direction ends by writing `epics/EP-<slug>/.sdlc/design-links.json` — the machine-readable
screen→frame map — and a `## Design (<tool>)` section in `ui-design.md` linking each screen to its frame
URL. The design itself lives in the tool; the Product keeps the *links* and the Markdown spec beside the
other epic artifacts.

## Degrade path (no MCP / no tool)

If `design.json` is absent, `tool: "none"`, or `source: "unavailable"`, `yad-ui` runs **markdown-only**:
it authors `ui-design.md` / `DESIGN.md` exactly as before and records `design: none` in the frontmatter
with a one-line note (mirroring the `impeccable: not-installed` degrade). No error — the design tool is
purely additive.

## Reachable before Build (#358)

A design tool read through its running desktop app — Pencil, or Figma's `figma-desktop` server — cannot be
read while the app is closed or the design file is not open. So before a UI task, `yad-spec` and
`yad-implement` check it first, and stop early when it fails. yad itself cannot call an MCP server (it
belongs to the agent's session), so `yad story frames <story> --json` returns a `preflight` block that says
how to check and what to tell the person; the text for each tool is the toolbox entry's `reach` field.

| `tool` | What the agent checks | When it fails |
|--------|-----------------------|---------------|
| `pencil` | `get_app_state` (or `get_editor_state`): the active canvas editor is the design file, compared by file name (the app shows the full path). A frame inside a container is not in the top-level list, so it is read by its ID before it counts as missing | open the Pencil desktop app with the file loaded, then continue |
| `figma`, provider `figma-desktop` | `get_metadata` on one recorded frame | open the Figma desktop app with the file loaded and its Dev Mode MCP server on |
| `figma`, provider `figma` (hosted) | `get_metadata` on one recorded frame | sign in to Figma in your agent; no app is needed |
| `figma`, provider `figma-mcp` (older value), any other name, or none | `get_metadata` on one recorded frame | either of the two above — yad cannot tell which server it is |
| `figma`, provider `html-to-design` | nothing: it writes screens and cannot read a frame | not checked; build from the frame links |
| `openpencil` | not checked yet: yad has no reach rule for it (E164's second PR adds one) | build from the frame links |

Also not checked (build from the frame links): no `design.json`, tool `none`, source `unavailable`; no
`design-links.json`, one that cannot be read, or one recorded for another tool (re-run the UI step); and a
story whose recorded frame IDs are all missing from `design-links.json` — the bad IDs are the problem then.

A failed check stops the step. The person may choose to go on from the frame links only; that choice is
recorded (in `spec.md`'s Clarifications, or the commit's Decisions paragraph).

## Staleness / refresh

A re-generated or designer-edited file is like a moved code repo: `yad-ui` **flags** a divergence and
lets a human decide (re-run the step, or `yad-connect-design` action: refresh). It never silently
overwrites a designer's frames — refreshing the design is a human decision, the same discipline as
`code_context.refresh: human`.
