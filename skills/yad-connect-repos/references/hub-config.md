# Hub config — schema, detection, and the reviewer roster

The hub config is the product hub's record of **its own** platform (so the front-half review/comment/
approval cycle can run through a real PR/MR on the hub) and the **reviewer roster** that maps a platform
login to an SDLC name + role. It is a single object for the hub itself — the sibling of the per-repo
`repos.json` registry (see `repos-registry.md`), kept separate so it never pollutes that array.

## Location

`{project-root}/.sdlc/hub.json`

(`config.yaml` `hub.config`.) Created/updated by `yad-connect-repos action: detect-hub`.

## Schema

```json
{
  "platform": "github",                                       // github | gitlab (from the hub's own remote host); null when local-only
  "git_url": "https://github.com/abdelrahmannasr/yadflow.git",
  "default_branch": "main",
  "bridge_enabled": true,                                     // open review PRs/MRs on the hub for front-half reviews
  "detectedAt": "2026-06-08",                                 // last detect-hub run (YYYY-MM-DD)
  "roster": [
    { "login": "abdelrahmannasr", "name": "alice", "email": "alice@example.com",
      "roles": { "hub": ["owner", "reviewer"] } },
    { "login": "carol-gh", "name": "carol", "email": "carol@example.com",
      "roles": { "hub": ["reviewer"], "backend": ["domain-owner", "owner"], "payments": ["reviewer"] } }
  ]
}
```

## The roster — login → name → per-scope roles

The roster is how a platform identity (a GitHub/GitLab **login**) becomes an SDLC **name + role(s)** in
the file ledger (`approvals.json` / `comments.json`). Roles are the same three the gate uses:
`owner | reviewer | domain-owner`. Populate and edit it any time with the **`yad roster`** CLI command
(`list` / `add` / `grant` / `revoke` / `remove`) — `add` walks the connected repos asking for each
one's role, and a `domain-owner` grant keeps `repos.json` `domain_owners` in sync.

- **`login`** — the platform username whose PR review / approval is being mapped.
- **`name`** — the SDLC name written into the ledger (the same names used across `approvals.json`,
  `comments.json`, and `epic.md` `owner`). Keep it stable.
- **`email`** — the commit email; drives the **committer → login** reverse lookup that auto-assigns PRs.
- **`roles`** — a **per-scope map**: scope (`hub`, or a connected repo name) → the roles held there. A
  person can be **owner + reviewer + domain-owner at once** and across scopes; a repo gets **several**
  people per role by appearing in several entries' maps. Validated against the hub during `yad setup` /
  `yad doctor`; a login that does not resolve is flagged `unverified` (warn-only, never blocks).

**Back-compat:** readers also accept a flat array `"roles": ["owner","reviewer"]` (treated as `hub`
roles) and the legacy single `"role": "owner"` (a `hub` role).

**`domain-owner` may also be DERIVED from `repos.json`.** A roster entry whose `name` equals a repo's
`domain_owner`/`domain_owners` in `repos.json` is treated as that repo's domain-owner **when that repo is
a touched domain for the step under review** — kept as a fallback so pre per-scope projects still resolve.
New setups write the grant directly into the person's `roles[<repo>]` map.

- **Unmapped login fallback.** A login absent from the roster maps to `name: <login>`, `role: reviewer`,
  and is flagged `<!-- unverified login: <login> -->` in the review record (mirrors the code-map
  `unverified` convention). An unmapped login is **never** auto-promoted to `owner` or `domain-owner` —
  it stays a plain reviewer until a human adds it to the roster, so a stranger cannot satisfy the
  owner/domain-owner requirement.

## Detection

`detect-hub` reuses the same host-detection logic this skill already applies to code repos:
run `git remote get-url origin` **on the hub itself** and read the host —
`github.com` → `github`, `gitlab.com`/self-hosted GitLab → `gitlab`, no remote → `platform: null`.
Auth is the **local user's own** `gh`/`glab`/git credentials; **no tokens are ever stored** (same rule
as the registry). `detect-hub` upserts `hub.json` in place — it is idempotent and safe to re-run.

## Bridge enable / degradation

- `bridge_enabled: true` **and** a non-null `platform` **and** `gh`/`glab` authenticated → the front-half
  review opens a PR/MR on the hub and `yad-review-gate action: sync` pulls platform state into the ledger.
- `bridge_enabled: false`, `platform: null`, or no/unauthenticated CLI → the gate falls back to the
  existing **file-only** flow with no error. The file ledger is the source of truth in both modes.
- The master switch `config.yaml` `hub.bridge: false` disables the bridge globally regardless of `hub.json`.

## Git tracking

Commit `hub.json` — it is small, reviewable, and carries no secrets (logins and names only, never tokens).
This mirrors how `repos.json` and the per-epic `.sdlc/` state are committed.

## Greenfield

A brand-new hub has no `hub.json`. That is valid — the front-half gate runs file-only until `detect-hub`
records a platform. The bridge is purely additive; nothing about authoring or the gate predicate changes.
```
