# `ledger-guard-v3.18.1.sh` — frozen, never edit

The `ledger-guard` check gate exactly as **v3.18.1** shipped it: the last release before the file
shape moved to 2 and `.sdlc/hub.json` gained `ledger`.

It is here because that script is **committed inside every user's own repo** and is refreshed by
`yad update`, which is a separate action from `yad migrate` with no ordering between them. So a
project will run this copy against a hub.json that has already been migrated. If it stops treating
such a hub as verified, the audit trail silently stops being enforced — the one guarantee verified
mode exists to provide.

`cli/test-checks.mjs` runs it against a migrated hub and asserts it still arms. That is what makes
removing `bridge_enabled` from the migration impossible to do by accident.

Do not edit or regenerate it. If it ever needs to change, the change is wrong.
