# Foundation schema — the sections and the ledger

The Foundation is the Product level (E75). It lives in `{project-root}/foundation/`, with its fixed id
`EP-foundation`:

```
foundation/
  purpose.md  market.md  scope.md  mvp.md  roadmap.md  stack.md  repos.md  risks.md
  .sdlc/state.json  approvals.json  comments.json  product-prs.json  hub-prs.json
  reviews/
```

## The ledger (`foundation/.sdlc/state.json`)

Written by `yad foundation new`, never by hand. What it holds, for reference:

```text
epicId       EP-foundation
kind         foundation       the marker every reader keys off (not a work-item type — there is none)
profile      foundation       the route: two steps, no Build
currentStep  foundation → foundation-review → foundation-done
steps        foundation (author, artifact foundation/) · foundation-review (review+approve, artifact foundation/)
```

- `artifact: "foundation/"` is a **virtual** base: the gate fingerprints the Foundation sections together
  (`foundationHash` in `cli/epic-state.mjs`). An edit to any section revokes prior approvals. The
  frontmatter `status:` line is not part of the fingerprint, so the gate flipping it is not an edit.
- The six **required** sections must all exist before the Foundation is reviewable. The two
  **optional** ones (`market.md`, `risks.md`) count once they exist.
- On approval the gate sets `currentStep: "foundation-done"`. The Foundation has no Build, so it never
  becomes `ready-for-build`.
- The review branch is `review/EP-foundation/foundation`, which both gate-sync workflows already match.
- On a **verified** ledger, `foundation/.sdlc/` and `foundation/reviews/` are CI-owned exactly like an
  epic's. The committed `checks/ledger-guard.sh` must be from E75 or later to guard them — `yad doctor`
  warns when it is not, and `yad update` refreshes it.

## When a section counts as written (E76)

A section that still holds **only its template** is not written. "Only its template" means nothing but
the frontmatter, `#` and `##` headings, `<!-- comments -->`, blank lines, `---` dividers, and an empty table
(its header row, its `|---|` rule, and rows whose cells are all empty). One real sentence, one filled
table row, or one `###` sub-heading makes it written.

The engine checks this, and only ever **warns**:

- `yad gate open` and `yad gate sync` print `Foundation not written yet — <files> hold nothing but their
  template` when a section that exists is still empty.
- `yad doctor` reports `foundation:unwritten` once the review has **opened or passed** with an empty
  section. While the Foundation is still being written, an empty section is just work not done yet.

So write every example into a comment, never as a table row: a filled row is read as your content.

## Section templates and what goes in them

Every section carries the same frontmatter block:

```markdown
---
id: EP-foundation
artifact: <section>
status: draft
owner:
---
```

Each section below has four parts:

- **The template** — the file to start from. Keep its headings; reviewers look for them.
- **Ask** — the questions to put to the user. Ask them one at a time and write down the user's answer,
  not your own guess.
- **A good answer** — what the section holds when it is done.
- **The reviewer checks** — what a reviewer holds it against at the gate.

The examples use one made-up product, **Tally**: an app for flatmates to split shared bills.

### `purpose.md`

```markdown
## Why this exists
## Who it is for
## What success looks like
<!-- measurable where possible -->
```

**Ask:**
- What problem does this solve, and what do people do about it today?
- Who has the problem most? Name one kind of person, not "everyone".
- A year after launch, what number would tell you this worked?

**A good answer:** one short paragraph per heading. The problem is stated from the user's side, not as a
feature. There is one main user group, with others named as secondary. Success is two or three
measurable signals, each with a number or a clear yes/no.

**The reviewer checks:** could someone outside the team say who this is for and why after one read? Is
every success signal something you could actually measure?

**Example (Tally):**

```markdown
## Why this exists
Flatmates split rent, bills and shopping. Today they use a shared spreadsheet or a group chat, and
someone always ends up owed money they are too awkward to ask for.

## Who it is for
People aged 20–35 sharing a flat with two to five others. Secondary: couples who share bills.

## What success looks like
- 40% of flats that add a second member are still logging expenses 8 weeks later.
- A flat settles up (everyone at zero) at least once a month.
```

### `market.md` *(optional)*

```markdown
## Who else does this
| Competitor | What they do | Where they fall short |
|---|---|---|
## Why us
```

**Ask:**
- Who does this already, including "a spreadsheet" or "nobody bothers"?
- For each one: why would your user still not be happy with it?
- What can you do that they cannot, or will not?

**A good answer:** three to five real alternatives, each with one honest line on where it falls short.
"Why us" names an advantage the team really has, not a wish.

**The reviewer checks:** is any obvious alternative missing? Does "why us" follow from the gaps in the
table, or is it unrelated to them?

**Example (Tally):**

```markdown
## Who else does this
| Competitor | What they do | Where they fall short |
|---|---|---|
| Splitwise | Tracks shared expenses for any group | Built for trips; recurring rent and bills are clumsy |
| A shared spreadsheet | Free and flexible | Nobody updates it; no reminders |

## Why us
We only do flats, so recurring bills and a monthly settle-up are the default, not an add-on.
```

### `scope.md`

```markdown
## What it is
## What it is NOT
<!-- explicit non-goals — the list a reviewer checks each feature epic against -->
```

**Ask:**
- In one sentence, what is this product?
- What will people expect it to do that it will **not** do? Keep asking until the user has named at
  least three things.
- Which of those are "not now" and which are "never"?

**A good answer:** "What it is" is one or two sentences. "What it is NOT" is a list of concrete
non-goals, each one a thing a real person might ask for. Mark each one *not now* or *never*.

**The reviewer checks:** every later feature epic is compared with this list, so each non-goal must be
specific enough to say yes or no to. "Not a bank" is useful; "not bloated" is not.

**Example (Tally):**

```markdown
## What it is
A shared ledger for one flat: log what each person paid, see who owes whom, settle up.

## What it is NOT
- Not a payment app — it never moves money (never).
- Not for trips or one-off groups (not now).
- Not a budgeting tool for one person (never).
```

### `mvp.md`

```markdown
## The smallest thing worth shipping
## What is deliberately left out of it, and why
```

**Ask:**
- What is the least a first user needs to get the value in `purpose.md`?
- Walk through one user's first week. Which steps must work for that week to succeed?
- What did you want to include but can live without at first?

**A good answer:** a short list of capabilities — not screens, not technical tasks — that together
deliver the first success signal. The "left out" list names each thing and one line on why it can wait.

**The reviewer checks:** is every item really needed for the first success signal? Does anything here
contradict `scope.md`'s non-goals?

**Example (Tally):**

```markdown
## The smallest thing worth shipping
- Create a flat and invite flatmates by link.
- Log an expense and who it is split between.
- See each person's balance, and mark a settle-up.

## What is deliberately left out of it, and why
- Recurring bills — people can log rent by hand for the first months; we learn the real patterns first.
- Receipts and photos — nice, but nobody leaves over it.
```

### `roadmap.md` (the spine of the review)

```markdown
## Summary
<!-- the product thesis in 2–3 lines -->

## Phase 1 — MVP
| Feature | Proposed epic id | Status |
|---------|------------------|--------|
<!-- one row per feature, e.g. | Registration | EP-registration | planned |. Write the Status once, when you add the row; do not update it by hand — `yad foundation status` reads it from the epic ledgers -->

## Phase 2 — <name>
| Feature | Proposed epic id | Status |
|---------|------------------|--------|

## Later / parked
<!-- explicitly deferred, with why -->
```

**Ask:**
- What does the MVP break down into, as features a team could build one at a time?
- After the MVP, what comes next, and what has to be true before it starts?
- What have you decided to park, and why?

**A good answer:** Phase 1 holds exactly the MVP from `mvp.md`, one row per feature. Later phases are
ordered by a stated reason (what they depend on, or what they unlock). Parked items are listed with why.
Each proposed epic id follows `EP-<2–4 lowercase words>`.

**The reviewer checks:** does Phase 1 match `mvp.md`, no more and no less? Is anything in a later phase
a non-goal in `scope.md`?

The proposed ids are suggestions — `yad-epic` still assigns the id, and never picks the reserved
`EP-foundation` or `EP-discovery`.

**Do not update the Status column by hand.** The roadmap table is part of what the Foundation's
reviewers approved, so editing a row after the review has passed changes the Foundation's fingerprint,
and `yad doctor` then reports its approvals as stale. Instead, `yad foundation status` reads how far each
feature has got from the epic ledgers:

| Status | Meaning |
|---|---|
| `planned` | No epic ledger with the proposed id exists yet |
| `in-shape` | The epic is seeded and still in Shape (epic, architecture, UI, stories) |
| `in-build` | Shape is done, and Build has not shipped every story in every repo |
| `shipped` | Every story in the epic has a Build state, every repo each story declares has a lane, and every lane is shipped (or the epic is a brownfield anchor) |

It also names feature epics that no row proposes — `yad-epic` may give an epic a different id from the
one proposed. Write `planned` when you first add a row; an older Foundation that says `epic-started` or
`shipped` can stay as it is, and the command notes where the column and the ledgers disagree.

**Example (Tally):**

```markdown
## Summary
Flatmates should never have to chase money. Tally is the shared ledger for one flat.

## Phase 1 — MVP
| Feature | Proposed epic id | Status |
|---------|------------------|--------|
| Flats and invites | EP-flat-invites | planned |
| Log and split an expense | EP-log-expense | planned |
| Balances and settle-up | EP-settle-up | planned |

## Phase 2 — Recurring bills
| Feature | Proposed epic id | Status |
|---------|------------------|--------|
| Recurring bills | EP-recurring-bills | planned |

## Later / parked
- Receipt photos — parked until people ask for it.
```

### `stack.md`

```markdown
## Languages and frameworks
## Hosting and runtime
## Data stores
<!-- brownfield: what the connected repos actually use, from their code-maps -->
```

**Ask (greenfield — nothing is built yet):**
- What does the team already know well? A stack nobody knows is a risk, not a choice.
- What does the product need that narrows the choice (offline use, a phone app, heavy data, a region
  the data must stay in)?
- For each choice: what else did you consider, and why not that?

**A good answer:** for each heading, the **decision**, the **alternatives rejected** and **why**, in a
line or two each. Say what would make you change the choice later. On a greenfield product this records
intended choices; nothing has to exist yet.

**The reviewer checks:** does every choice have a reason tied to this product or this team? Is anything
chosen that `mvp.md` does not need yet?

**Example (Tally):**

```markdown
## Languages and frameworks
TypeScript everywhere. Web app in React; no native app for the MVP (a phone browser is enough).
Rejected: a native app first — two codebases before we know people want it.

## Hosting and runtime
One Node service on a managed platform in the EU. Rejected: running our own servers — no one to run them.

## Data stores
PostgreSQL. Balances must add up exactly, so we want transactions. Rejected: a document store.
```

### `repos.md`

```markdown
## Layout
<!-- monorepo or separate repos, and why -->
| Repo | What it does |
|------|--------------|
```

**Ask (greenfield):**
- How many deployable parts does the MVP have?
- Will different people or teams own different parts?
- Do the parts release together, or on their own schedules?

**A good answer:** the layout decision (one repo, or several) with the reason, and a table with one row
per repo. Each row says what the repo does in one line. On a greenfield product the repos may not exist
yet — list what you intend to create.

**The reviewer checks:** does every part in `stack.md` have a home here? Is the reason for the layout
about how the team works, not just taste?

**Example (Tally):**

```markdown
## Layout
One repo for now. One small team owns everything and it all releases together; we split when a second
team joins.

| Repo | What it does |
|------|--------------|
| tally | The web app, the API and the database migrations |
```

### `risks.md` *(optional)*

```markdown
| Risk | Why it could kill this | What we do about it |
|------|------------------------|---------------------|
```

**Ask:**
- What would make this fail even if it is built well?
- What are you assuming about users, the market, or the law that might be wrong?
- For each risk: what is the cheapest way to find out early?

**A good answer:** three to six risks, each with a concrete action — a test, a limit, or a decision
point — not "monitor closely".

**The reviewer checks:** is the biggest risk the team talks about in private written here? Does each
action happen before the risk would hurt?

**Example (Tally):**

```markdown
| Risk | Why it could kill this | What we do about it |
|------|------------------------|---------------------|
| Only one flatmate uses it | The ledger is useless if others do not log | Measure second-member activity from week 1; stop if under 20% |
| People want it to move money | "Not a payment app" loses them | Ask the first 20 flats; revisit scope.md at 8 weeks |
```
