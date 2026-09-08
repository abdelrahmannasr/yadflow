# File shape 3 — `hub` becomes `Product`

**What moved:** the product's settings file gains a second name, and each reviewer's product-level
role gains a second spelling. **Nothing is renamed away.** Every old name still exists and is still
the one the engine reads.

**Who this affects:** every project. Running it is safe, and running it twice changes nothing.

---

## The short version

```bash
npx yadflow@next migrate           # preview — writes nothing
npx yadflow@next migrate --apply   # rewrites, backing up every file it touches
```

Run the preview first. It prints one line per file and does not touch your project.

---

## What changed, and why it is done in stages

"Hub" becomes **Product**. The word was always a bit off: your product is the thing, and the hub was
just where its files lived.

Renaming a *field* is easy. Renaming a *file* is not, because a file gets opened by name from outside
the engine. In particular, `checks/ledger-guard.sh` — the check that stops people hand-editing the
approval records — is **committed inside your own repository** and opens `.sdlc/hub.json` by that
exact path. It is refreshed by `yad update`, which is a separate command from `yad migrate`, and
nothing makes you run them in order.

So if the old name simply disappeared, there would be a window where your guard opens a file that is
gone, decides your records are unprotected, and stops blocking hand-edits. An upgrade would quietly
switch off a safety check.

That is why this takes three releases rather than one:

| | what happens |
|---|---|
| **this release** | the new names appear and are kept up to date. The **old** names are still the ones read, so everything that already works keeps working |
| the next major | the new names become the ones read, and `yad doctor` warns about the old ones |
| the one after | the old names are deleted |

## What `--apply` writes

**A second copy of your settings, under the new name:**

```
.sdlc/hub.json        <- still read; still updated on every save
.sdlc/product.json    <- new; the same content, updated at the same time
```

**The same for each epic's record of review PRs:**

```
epics/<id>/.sdlc/hub-prs.json       <- still read
epics/<id>/.sdlc/product-prs.json   <- new
```

**And a second spelling for each reviewer's product-level role:**

```diff
  "roles": {
+   "hub": ["owner", "reviewer"],
    "product": ["owner", "reviewer"],
    "backend": ["domain-owner"]
  }
```

Plus `"schemaVersion": 3` on every file the engine writes.

## Two files with the same name — is that a mistake?

No, and please do not delete one.

Both copies are written together every time the engine saves. If they ever disagree, something
outside the engine changed one of them, and `yad doctor` will tell you:

```
warn: .sdlc/product.json and .sdlc/hub.json do not match — .sdlc/hub.json is the one being read
```

**If you need to edit the settings by hand, edit `hub.json`** — that is the one being read this
release. The next command that writes will copy it across.

## After you run it

```bash
yad doctor
```

You should see your project and the engine both on shape 3, and no warnings about files not matching.
Then check the two things that matter:

- **Reviewers still resolve.** `yad roster list` should show the same people with the same roles.
- **The guard still guards.** On a verified product, an attempt to hand-edit a record should still be
  refused.

## If something goes wrong

`--apply` copies every file it rewrites to `<file>.yad-orig` first — including both names of a
renamed file, each keeping its own original. To undo it by hand:

```bash
find .sdlc epics -name '*.yad-orig' | while read -r f; do mv "$f" "${f%.yad-orig}"; done
```

**Do not downgrade the CLI to an older release without restoring those backups first.** An older
engine reads `schemaVersion: 3` as a shape from the future and refuses to touch the file — safe, but
it leaves you stuck until the files are restored.

## Reporting a problem

`yad doctor --json` and the output of `yad migrate` (the preview, which writes nothing) are the two
things worth attaching. Neither contains the contents of your artifacts.
