# Login roster — schema, resolution, per-repo routing

The roster lives in `.sdlc/hub.json` (`roster: [...]`) and is the only thing that turns a platform
**login** into an SDLC **name + role** for the ledger. Schema and the no-tokens rule are documented once
in `../../sdlc-connect-repos/references/hub-config.md`; this file covers how the bridge *uses* it.

## Entry

```json
{ "login": "abdelrahmannasr", "name": "alice", "role": "owner" }
```

- `login` — the GitHub/GitLab username whose review/approval is being mapped.
- `name` — the SDLC name written to `approvals.json` / `comments.json` (the same names as `epic.md`
  `owner` and `repos.json` `domain_owner`). Keep it stable.
- `role` — the person's default role: `owner` or `reviewer`. **Not** `domain-owner` — that is derived.

## Resolution

1. **login → name + role** from the roster.
2. **domain-owner is derived:** if the resolved `name` equals a repo's `domain_owner` in `repos.json`,
   and that repo is a **touched domain** for the step under review, the bridge also emits a
   `domain-owner` approval scoped to that repo (`domain: <repo>`). One person owning several repos yields
   several `domain-owner` records with different `domain` values — exactly what the gate predicate allows.
3. **Unmapped login → reviewer (flagged).** A login not in the roster maps to `name: <login>`,
   `role: reviewer`, with `<!-- unverified login: <login> -->` in the review record. It counts as a
   reviewer but is **never** auto-promoted to owner/domain-owner, so a stranger can never satisfy the
   owner/domain-owner requirement. The marker prompts a human to add the login to the roster.

## Per-repo routing (stories review, and any escalated step)

The stories review needs a `domain-owner` per repo in the **union of every story's `repos`**. On the
review PR the bridge makes this legible and enforceable:

- Add a `domain:<repo>` **label** per touched repo.
- **Request** each touched repo's `domain_owner` login as a reviewer (resolved via the roster).
- On `sync`, an approval from login *L* maps to `domain-owner` for repo *R* **iff**
  `repos.json[R].domain_owner == roster[L].name`. So a domain owner's approval is scoped to exactly the
  repos they own, and a repo with no approving owner shows up as still-required in the gate report.

This is the same touched-domains computation the gate uses (`../sdlc-review-gate/references/gating.md`):
architecture+contract → `epic.repos`; stories → union of story `repos`.
