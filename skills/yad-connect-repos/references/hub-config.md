# Product config — schema, detection, and who is recorded

The Product config is the Product's record of **its own** platform (so the Shape review/comment/
approval cycle can run through a real PR/MR on the Product). It holds **no list of people** — no roster,
no roles, no commit emails (E62). It is a single object for the Product itself — the sibling of the per-repo
`repos.json` registry (see `repos-registry.md`), kept separate so it never pollutes that array.

## Location

`{project-root}/.sdlc/hub.json`

(`config.yaml` `product.config` (older projects: `hub.config`).) Created/updated by `yad-connect-repos action: detect-hub`.

## Schema

```json
{
  "schemaVersion": 10,                                        // the file's shape. Absent means 1 (rule 1). `yad migrate` moves it; see docs/migrations/shape-2.md
  "platform": "github",                                       // github | gitlab (from the Product's own remote host); null when local-only
  "git_url": "https://github.com/abdelrahmannasr/yadflow.git", // REQUIRED when platform is non-null (scopes auth + opens PRs); yad doctor warns YAD-CFG-005 if absent
  "default_branch": "main",
  "ledger": "verified",                                       // WHO WRITES THE LEDGER, and the one that decides: "verified" = CI only, signed; "local" = this machine. Travels WITH platform — verified is both (isVerifiedLedger), so never "verified" beside platform: null (#186)
  "bridge_enabled": true,                                     // the older spelling of the same switch, kept so a check gate that predates `yad update` still reads it. Write it to MATCH `ledger`, never against it
  "bridge": true,                                             // older still. Same rule
  "gate_sync_version": "4.0.0",                              // OPTIONAL exact pin for the wired gate-sync job; an exact release of the wired fragment's major (4.x.y in this release), prereleases included (4.1.0-rc.1) — anything else, a 3.x pin included, is skipped. Omitted => the .sdlc/cli-version.json stamp if that qualifies, else floating on that major
  "review": { "requireEngagement": false },                   // Review Companion: false (soft) counts bare approves but nudges; true counts only verified-engagement approvals
  "solo": false,                                              // SOLO MODE, and the one that decides: true waives the approval requirement on every review gate (the merge + resolved threads still gate). Set by `yad setup --solo` / `--team <n>` or `yad mode`
  "mode": "team",                                             // the roadmap's name for the same switch (E10): "solo" | "team", written beside `solo` by `yad mode` and `yad setup`. NOT read by the gates this major — `yad doctor` warns `mode:disagree` when it contradicts `solo`. Not the ledger switch: "verified mode" elsewhere means `ledger`
  "mode_set": { "from": "solo", "to": "team", "by": "al", "date": "2026-09-15", "reason": null }, // the last change of mode (E10): who, when, why. `yad mode solo` requires the reason
  "detectedAt": "2026-06-08"                                  // last detect-hub run (YYYY-MM-DD)
}
```

## People — no roster (E62)

yadflow keeps **no stored list of people**. A list is a claim that goes stale; the platform already knows
who is logged in and who has access.

- **Who a record names.** A record's `by` is the platform login that `gh api user` / `glab api user`
  reports, else git `user.name` (no platform, CLI missing or logged out, no network).
  `YAD_PLATFORM_LOGIN=0` turns the lookup off.
- **Approvals.** Each approval records the platform login that gave it as `approver`, with no `role` and
  no `domain`. A team gate needs at least **1 approval from someone other than the author**, plus
  resolved threads and a merged PR. The full count is `base 1 + risk step` (`contract` +2, `auth` /
  `payments` +1, the largest and never the sum); the gate caps it at the active people less one and
  reports that (E72); the risk step is advisory until E73. Solo
  mode still waives the approval.
- **Reviewers.** Nothing requests reviewers on a PR/MR. Ask them on the PR/MR itself. A later roadmap row
  (E68) will suggest reviewers from history; CODEOWNERS is a hint only.

**Legacy data an older release wrote.** A `roster` array (with `login`/`name`/`email`/`roles`, or the
older `role`) and a `verified_authors` list may still sit in this file. Nothing adds them, and nothing
deletes them (`yad migrate`'s shape-3 step still adds a `product` role key beside `hub` in an old roster, so
an older project upgrades the same way it always did). `verified_authors` decides nothing — only `yad doctor`
reads it, to warn. The roster is read for one thing only: its `name` →
`login` pairs let a gate write record the login on older approval and comment records
(`../../yad-hub-bridge/references/login-roster.md` → "Recording the login on older records"). `yad doctor`
warns `people:roster-unused` and `people:verified-authors-unused` so nobody edits them believing they decide
something. Delete `verified_authors` when convenient; delete `roster` when `people:roster-unused` says it
can go — no older record needs it any more, or only records it cannot place are left and their reviews are
closed.

## Detection

`detect-hub` reuses the same host-detection logic this skill already applies to code repos:
run `git remote get-url origin` **on the Product itself** and read the host —
`github.com` → `github`, `gitlab.com`/self-hosted GitLab → `gitlab`, no remote → `platform: null`.
Auth is the **local user's own** `gh`/`glab`/git credentials; **no tokens are ever stored** (same rule
as the registry). `detect-hub` upserts `hub.json` in place — it is idempotent and safe to re-run.

**`git_url` is required whenever `platform` is non-null.** `yad doctor` uses it to scope the auth
probe to the Product's own host (an unscoped `glab auth status` fails on any unrelated broken instance),
and the verified ledger/PR flow uses it to open PRs. Doctor flags its absence with a warn (`YAD-CFG-005`);
re-running `yad setup` backfills it from the origin remote (idempotent, non-interactive).

## Who writes the ledger, and what happens when it degrades

The switch is read in this order — `isVerifiedLedger` (`cli/manifest.mjs`) and the bash copy in
`checks/ledger-guard.sh` both do exactly this, and a test asserts they agree on every shape:

1. **`ledger`**, whenever the key is present. `"verified"` and nothing else means verified; any other
   value, including an empty string, means local.
2. **otherwise** the older booleans `bridge_enabled`, then `bridge`.
3. and a non-null `platform` is required either way — without one there is no Verified badge to read.

So on a migrated project `ledger` wins, and writing a boolean that contradicts it changes nothing.
Keep all three in step.

- `ledger: "verified"` **and** a non-null `platform` **and** `gh`/`glab` authenticated → the Shape
  review opens a PR/MR on the Product and `yad-review-gate action: sync` pulls platform state into the ledger.
- `ledger: "local"`, `platform: null`, or no/unauthenticated CLI → the gate falls back to the
  existing **local** flow with no error. The file ledger is the source of truth in both modes.
- The master switch `config.yaml` `product.bridge: false` (older projects: `hub.bridge`) disables the verified ledger globally regardless of `hub.json`.

## Review Companion engagement (`review.requireEngagement`)

`review.requireEngagement` (default `false`) controls the [Review Companion](../../yad-review-companion/SKILL.md)
engagement gate. Each approval records `engagement: verified | none`. **Soft (`false`):** both count — a
bare approve still passes but draws a friendly public nudge, so review *quality* is visible without
blocking. **Strict (`true`):** the predicate counts only `verified` approvals. The signal is gameable by
design ("visible, not impossible") — it raises the cost of a rubber-stamp, it does not prove a human
read the artifact. Applies to both the Shape gate and the Build engineer review.

## Git tracking

Commit `hub.json` — it is small, reviewable, and carries no secrets or tokens. The only people data in it is the login or git name in `mode_set.by`, plus
whatever an older `roster` still lists.
This mirrors how `repos.json` and the per-epic `.sdlc/` state are committed.

## Greenfield

A brand-new Product has no `hub.json`. That is valid — the Shape gate runs local until `detect-hub`
records a platform. The verified ledger is purely additive; nothing about authoring or the gate predicate changes.
```
