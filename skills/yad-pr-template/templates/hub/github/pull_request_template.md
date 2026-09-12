<!-- SDLC HUB PR template — Shape artifact review (epic / architecture+contract / ui-design / stories). -->
<!-- This PR is a REVIEW VEHICLE on the Product, not a code merge. The file gate (yad-review-gate)
     advances the step; do NOT rely on merging this PR to advance. Reviewers approve/comment here, then a
     `yad-review-gate action: sync` pulls that into the file ledger. -->

## Artifact under review
- Epic: `EP-<slug>`
- Artifact: `epic.md | architecture.md (+contract.md) | ui-design.md | stories/`
- Gate step: `<epic-review | architecture-review | ui-design-review | stories-review>`
- Owner: `<epic.md owner>`

## What changed
<!-- One or two sentences on what this artifact says / what changed since the last review round. -->

## Impact & Risk (front-half)
- **Domains / repos touched:** <epic.repos, e.g. backend, mobile>
- **Risk tags:** <none | contract | auth | payments>  <!-- contract/auth/payments => escalates to domain owners -->
- **Contract surface:** <n/a | locked @ sha256:…>  <!-- architecture only; a re-lock invalidates prior approvals -->

## Required approvals (yad-review-gate rule)
- Base: **owner + 1 reviewer**.
- Escalated (risk tag set, or a stories PR): **plus one domain-owner per touched repo** — see the
  requested reviewers / `domain:<repo>` labels on this PR. Run `bash checks/hub-route.sh <this-description>`
  to list them.
- Approver count (**advisory, not enforced**): base 1 + the step's risk step in **distinct people** — 3 on a
  `contract` step, 2 on `auth`/`payments`, 1 otherwise. One person holding two roles counts once. `yad gate
  status <epic>` prints it; being short of it never holds the gate.

## How to review (this drives the gate)
- **Approve** this PR to record an `owner` / `reviewer` / `domain-owner` approval in the file ledger
  (your platform login maps to your SDLC name + role via `.sdlc/hub.json`'s roster).
- **Comment / request changes** to record review comments (synced into `reviews/<artifact>--<date>--comments.md`).
- **Do NOT merge to advance** — `yad-review-gate action: sync` + `action: advance` move the step.

## Checklist
- [ ] `owner` set in the artifact frontmatter (inherited from `epic.md`)
- [ ] Contract re-locked (`.sdlc/contract-lock.json`) if the surface changed (architecture only — a short-lane epic has no architecture step and no lock, so tick this only if your route has one)
- [ ] Risk tags reflect the real surface touched (contract/auth/payments escalate)
- [ ] No secrets or tokens in the artifact or this description
