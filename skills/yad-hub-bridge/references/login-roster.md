# Login roster — schema, resolution, per-repo routing

The roster lives in `.sdlc/hub.json` (`roster: [...]`) and is the only thing that turns a platform
**login** into an SDLC **name + role** for the ledger. Schema and the no-tokens rule are documented once
in `../../yad-connect-repos/references/hub-config.md`; this file covers how the bridge *uses* it.
It is populated/edited any time with the `yad roster` CLI command (see that reference).

## Entry

```json
{
  "login": "abdelrahmannasr",
  "name": "alice",
  "email": "alice@example.com",
  "roles": { "hub": ["owner", "reviewer"], "backend": ["domain-owner"] }
}
```

- `login` — the GitHub/GitLab username whose review/approval is being mapped.
- `name` — the SDLC name written to `approvals.json` / `comments.json` (the same names as `epic.md`
  `owner` and `repos.json` `domain_owner`). Keep it stable.
- `email` — the commit email; drives the **committer → login** reverse lookup used to auto-assign PRs.
- `roles` — a **per-scope map** from a scope (`hub`, or a connected repo name) to the roles held there
  (`owner` / `reviewer` / `domain-owner`). A person can hold several roles in one scope (owner **and**
  reviewer **and** domain-owner at once), and several scopes; a repo gets several owners/reviewers/
  domain-owners by being listed in several people's maps.

**Back-compat (read on all three shapes):** the per-scope object above; a flat array
`"roles": ["owner","reviewer"]` (treated as `hub` roles); and the legacy single `"role": "owner"`
(a `hub` role). The legacy `repos.json` `domain_owner` field is still honored (see Resolution step 2).

## Resolution

1. **login → name + roles** from the roster. The `hub` roles map straight to records; each touched
   domain `R` contributes the roles in `roles[R]` (a `domain-owner` role carries `domain: R`).
2. **Legacy domain-owner fallback:** if the resolved `name` equals a repo's `domain_owner` in
   `repos.json`, and that repo is a **touched domain** for the step under review, the bridge also emits a
   `domain-owner` approval scoped to that repo (`domain: <repo>`). One person owning several repos yields
   several `domain-owner` records with different `domain` values — exactly what the gate predicate allows.
3. **Unmapped login → reviewer (flagged).** A login not in the roster maps to `name: <login>`,
   `role: reviewer`, with `<!-- unverified login: <login> -->` in the review record. It counts as a
   reviewer but is **never** auto-promoted to owner/domain-owner, so a stranger can never satisfy the
   owner/domain-owner requirement. The marker prompts a human to add the login to the roster.

## Auto-assignee / auto-reviewer on PR/MR open

When a review PR/MR is opened (hub `yad gate open`, or a code-repo `yad open-pr`):

- **Assignee = the committer/opener** — resolved from local git identity (`user.email`, then
  `user.name`) through the roster (`email`/`name`/`login`). On GitHub an unresolved committer still
  self-assigns via `@me`.
- **Reviewers = `reviewer` + `domain-owner`** for the touched scope(s) (`hub` plus every touched
  domain for a hub review; the repo itself for a code PR), **minus the committer** — you do not review
  your own PR. The artifact **owner/author is recorded, not requested.**
- Logins are validated against the hub during `yad setup` / `yad doctor` (`gh api users/<login>`,
  `glab api users?username=<login>`); a miss is flagged `unverified` but never blocks (fail-open).

## Per-repo routing (stories review, and any escalated step)

The stories review needs a `domain-owner` per repo in the **union of every story's `repos`**. On the
review PR the bridge makes this legible and enforceable:

- Add a `domain:<repo>` **label** per touched repo.
- **Request** each touched repo's `domain_owner` login as a reviewer (resolved via the roster).
- On `sync`, an approval from login *L* maps to `domain-owner` for repo *R* **iff**
  `repos.json[R].domain_owner == roster[L].name`. So a domain owner's approval is scoped to exactly the
  repos they own, and a repo with no approving owner shows up as still-required in the gate report.

This is the same touched-domains computation the gate uses (`../yad-review-gate/references/gating.md`):
architecture+contract → `epic.repos`; stories → union of story `repos`.
