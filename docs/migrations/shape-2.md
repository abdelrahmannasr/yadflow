# File shape 2 — `ledger: verified | local`

**What moved:** `.sdlc/hub.json` gains a `ledger` field. Nothing else changes. Every other file the
engine writes simply records the new shape number.

**Who this affects:** every project. The change is small, and running it is safe.

---

## The short version

```bash
npx yadflow@next migrate           # preview — writes nothing
npx yadflow@next migrate --apply   # rewrites, backing up every file it touches
```

Run the preview first. It prints one line per file and does not touch your project.

---

## What changed, and why

"Bridge mode" is now called a **verified ledger**. The old name described a mechanism — a bridge
between the engine and your platform. The new name describes what you get, and it is the word your
platform already shows next to the commits.

The switch used to be a boolean, and now it is a named value:

| before (shape 1) | after (shape 2) | meaning |
|---|---|---|
| `"bridge_enabled": true` | `"ledger": "verified"` | **CI** writes the ledger, signed. A local `yad gate open` is advisory and writes nothing. `ledger-guard` rejects any human commit to it. |
| `"bridge_enabled": false` | `"ledger": "local"` | **your machine** writes the ledger. Works offline, needs no CI, and nothing guards it. |

A named value is worth the migration because a boolean can only ever answer *"is the bridge on?"*,
while the real question is *who writes the record*. `local` is a legitimate answer, not an absence.

## What `--apply` writes

For `.sdlc/hub.json`, one added field:

```diff
  {
+   "schemaVersion": 2,
    "platform": "github",
    "bridge_enabled": true,
+   "ledger": "verified",
    "default_branch": "main"
  }
```

For every other file, only `"schemaVersion": 2`.

**`bridge_enabled` is kept on purpose.** It is not a leftover and you should not delete it. The
`ledger-guard` check gate is committed inside your own repo and is refreshed by `yad update`, which
is a *separate* action from `yad migrate`. Between the two, a copy of the guard that predates this
release will still be running — and that copy only knows the old key. If the migration removed it,
that guard would read no flag, decide your ledger is local, and quietly stop rejecting human commits
to it. That is the one guarantee verified mode exists to provide.

Both keys are read, the new one wins, and the old one is removed in a later major once nothing on
either side reads it.

**Your setting does not change.** The value written is computed from what the engine already decided
about your hub, not copied from the flag. So a hub with `bridge_enabled: true` but no `platform` —
which has always behaved as *local*, because there is no Verified badge to read without a platform —
migrates to `ledger: "local"`, which is what it was already doing.

## After you run it

```bash
yad doctor
```

The shape section should say your project and the engine are both on shape 2. Then check the one
thing that matters:

- **On a verified hub:** open a review PR as usual. The gate should still refuse a local ledger
  write and still advance on merge.
- **On a local hub:** `yad gate open` should still write the ledger on your machine.

If `yad doctor` reports files still behind, run `yad migrate` again and read the rows — a file that
CI owns on a verified hub is skipped on purpose and is stamped by the next gate sync.

## If something goes wrong

`--apply` copies every file it rewrites to `<file>.yad-orig` first. To undo it by hand, move those
back:

```bash
find .sdlc epics -name '*.yad-orig' | while read -r f; do mv "$f" "${f%.yad-orig}"; done
```

**Do not downgrade the CLI to a 3.x release without restoring those backups first.** An older engine
reads `schemaVersion: 2` as a shape from the future and will refuse to touch the file, which is the
safe behaviour but leaves you unable to run anything until the files are restored.

## Reporting a problem

`yad doctor --json` and the output of `yad migrate` (the preview, which writes nothing) are the two
things worth attaching. Neither contains the contents of your artifacts.
