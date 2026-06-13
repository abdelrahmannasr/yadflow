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
| other | the adapter's named MCP | per that adapter |

**Honest capability note:** not every design-tool MCP can *write*. A read-only Figma Dev Mode MCP
supports **link + read-back** only; *generate* needs a write-capable provider (html.to.design for Figma,
or `pencil`). `yad-ui` picks the direction the connected provider actually supports and records which one
it used (`direction: generated | linked`). It never claims to have generated screens a read-only MCP
cannot produce.

## Generate (push screens into the tool)

When the connected provider is write-capable, the `ux-designer` lens produces the epic's screens in the
tool, covering the screens/states `ui-design.md` enumerates and the user flows the architecture defines:

- **Figma via html.to.design** — the lens drafts each screen as HTML/CSS (reusing `DESIGN.md` tokens),
  then imports it into the Figma file via the MCP's `import-html`, one frame per screen.
- **pencil** — the lens calls `batch_design` to author the screens as `.pen` frames directly (mobile
  and/or web per the epic).

Reuse what already exists: load the connected code repos' code-maps (`yad-ui` Step 2b) and any
Impeccable `DESIGN.md` tokens so generated screens match built components, not invented ones.

## Link (reference a human-made design)

When a designer has already built the screens (or the provider is read-only), point `yad-ui` at the
existing file and **read the frames back** so `ui-design.md` reflects the real design: list each frame as
a screen, capture its node id + URL, and map components/tokens into `DESIGN.md`.

## Write back the linkage (done by `yad-ui`, per epic)

Either direction ends by writing `epics/EP-<slug>/.sdlc/design-links.json` — the machine-readable
screen→frame map — and a `## Design (<tool>)` section in `ui-design.md` linking each screen to its frame
URL. The design itself lives in the tool; the hub keeps the *links* and the Markdown spec beside the
other epic artifacts.

## Degrade path (no MCP / no tool)

If `design.json` is absent, `tool: "none"`, or `source: "unavailable"`, `yad-ui` runs **markdown-only**:
it authors `ui-design.md` / `DESIGN.md` exactly as before and records `design: none` in the frontmatter
with a one-line note (mirroring the `impeccable: not-installed` degrade). No error — the design tool is
purely additive.

## Staleness / refresh

A re-generated or designer-edited file is like a moved code repo: `yad-ui` **flags** a divergence and
lets a human decide (re-run the step, or `yad-connect-design` action: refresh). It never silently
overwrites a designer's frames — refreshing the design is a human decision, the same discipline as
`code_context.refresh: human`.
