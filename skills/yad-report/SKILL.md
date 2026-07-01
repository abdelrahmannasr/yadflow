---
name: yad-report
description: 'Self issue reporter for the yad CLI. When a yadflow flow breaks, file a well-formed bug in the upstream yadflow repo (abdelrahmannasr/yadflow) with auto-scrubbed diagnostics attached, so recurring issues surface to the maintainers. Drives the `yad report` command: it captures ONLY a privacy-safe allowlist (yadflow/node/os version, tool present+authenticated booleans, hub platform enum, the YadError code/hint, a path-scrubbed error message, and the failing command + flag NAMES) — never absolute paths, hostnames, git URLs, repo names, roster logins/emails, epic/story IDs, branch names, or flag values. It searches open issues first to avoid duplicates, shows the exact payload, and asks before posting anything to the public repo. Files directly via an authenticated gh/glab, or falls back to a prefilled issues/new URL. Also offered automatically after an unexpected failure (interactive only; YAD_NO_REPORT=1 or SDLC_NONINTERACTIVE disables it). Use when the user says "yad report", "report this bug", "file an issue", or "something broke in the flow".'
---

# yad — Self Issue Reporter

**Goal:** turn a broken flow into a fixable, well-formed bug report in the upstream yadflow repo —
without leaking any private data. This skill drives the `yad report` CLI command; it does not
hand-craft issues.

## When it runs
- **Manually:** the user runs `yad report` (optionally `yad report -m "one-line summary"`).
- **Automatically:** after an unexpected failure, the CLI's top-level handler offers
  *"Report this failure to the yadflow team?"*. This is **interactive only** — it never fires in CI
  (`SDLC_NONINTERACTIVE`) and is disabled by `YAD_NO_REPORT=1`.

## Privacy is the contract
Issues post to a **public** repo, so the reporter is **allowlist-first**. It sends ONLY:
- `yadflow` version, Node version, OS platform;
- tool state as booleans (`git` present; `gh` present + authenticated);
- the hub **platform enum** (`github` / `gitlab` / `file-only`) — never the URL, host, or roster;
- the `YadError` **code** + **hint**, and a **path-scrubbed** error message;
- the failing **command name and flag names only** — never flag values.

It **never** sends absolute paths, cwd, hostnames, git remote URLs, repo names/paths, roster logins
or emails, epic/story IDs or titles, branch names, `-m` free text, or the raw `yad doctor --json`
check list. Free-text fields (the summary, the error message) are scrubbed of paths / URLs / emails.

## On activation
1. **Assemble the safe context** (`sanitizeContext`) and, if interactive and no `-m` was given, ask
   the user for a one-line summary.
2. **Deduplicate:** search open issues in `abdelrahmannasr/yadflow` by the error code (or the first
   summary word). If matches exist, list them and offer to open an existing one instead of filing a
   duplicate.
3. **Preview + consent:** print the exact title + body that will be posted to the public repo, then
   ask *"Post this now?"*. Nothing leaves the machine without this confirmation.
4. **File:** with an authenticated `gh`/`glab`, create the issue directly (label `bug`) and print the
   URL. Otherwise, fall back to a **prefilled `issues/new` URL** (printed and, on a TTY, opened in the
   browser) so the user can complete it manually.

## Hard rules
- Reuse the `yad report` command — do not craft issues by hand or shell out to `gh` directly.
- Reporting is best-effort: it must never crash the CLI or mask the original failure.
- Respect `SDLC_NONINTERACTIVE` and `YAD_NO_REPORT` — no prompts, no auto-offer when they are set.
- Diagnostics are the maintainers' input to fix bugs; keep the payload safe and truthful.
