# The README's feature-change demo (docs/media/feature-change.gif), recorded with vhs
# (https://github.com/charmbracelet/vhs). Re-record from the repo root after a change to what these
# commands print:
#
#   vhs docs/media/feature-change.tape
#
# It runs this checkout's CLI (not the published one) in a fresh temp folder with synthetic data:
# a new local Product (no remote, no platform), the example epics from this repo's epics/ folder, and
# made-up people. Nothing leaves the machine. The change-epic's epic.md is pre-written below, because in
# real use your AI assistant writes it (the yad-change skill); the recording says so on screen.

Output docs/media/feature-change.gif

Set Shell "bash"
Set FontSize 14
Set Width 1180
Set Height 820
Set Padding 20
Set Theme "Builtin Dark"
Set TypingSpeed 30ms

Hide
Type `export R="$PWD" SDLC_NONINTERACTIVE=1 YAD_NO_UPDATE_NOTIFIER=1 YAD_NO_REPORT=1 PS1='> '` Enter
Type `yad() { node "$R/bin/yad.mjs" "$@"; }` Enter
Type `cd "$(mktemp -d)" && yad new acme --solo --separate --ide-targets .claude >/dev/null 2>&1 && cd acme/product` Enter
Type `git config user.name "Sam Lee" && git config user.email sam@example.com && cp -R "$R/epics" . && git add -A && git commit -qm "chore: start the acme Product"` Enter
Type `export DRAFT="$(mktemp)" && printf '%s\n' '---' 'id: EP-checkout-queue-sort' 'title: Sort the merchant queue by pickup time' 'kind: change' 'type: change' 'parent: EP-checkout' 'thread: EP-checkout' 'inherits: [architecture, contract, ui-design]' 'supersedes: [EP-checkout-S03]' 'status: draft' '---' '# Sort the merchant queue by pickup time' '' 'Merchants want the soonest pickup first. Same endpoint and screens; only the order changes.' '' 'A new queue story replaces EP-checkout-S03.' > "$DRAFT"` Enter
Type `clear` Enter
Show

Type "yad --version   # this recording runs the CLI from the yadflow source checkout"
Sleep 300ms
Enter
Sleep 2s
Type "# 1. What has this product already built?"
Enter
Type "yad history list 2>/dev/null"
Sleep 400ms
Enter
Sleep 4s

Type "# 2. The checkout feature: which version of each document applies today?"
Enter
Type "yad thread EP-checkout"
Sleep 400ms
Enter
Sleep 6s
Type "clear"
Enter

Type "# 3. Start a change that builds on it, keeping its architecture, contract and UI"
Enter
Type "yad epic new EP-checkout-queue-sort --type change --parent EP-checkout --inherits architecture,contract,ui-design 2>/dev/null | head -3"
Sleep 400ms
Enter
Sleep 5s
Type `yad assign EP-checkout-queue-sort epic --to "Sam Lee" >/dev/null 2>&1; yad next EP-checkout-queue-sort 2>/dev/null`
Sleep 400ms
Enter
Sleep 5s
Type "clear"
Enter

Type "# 4. Your AI assistant drafts the change (yad-change skill). Pre-written for this recording:"
Enter
Type `cp "$DRAFT" epics/EP-checkout-queue-sort/epic.md && cat epics/EP-checkout-queue-sort/epic.md`
Sleep 400ms
Enter
Sleep 5s
Type "clear"
Enter

Type "# 5. A person reviews and approves it (no GitHub or GitLab here, so the local gate)"
Enter
Type "yad gate open EP-checkout-queue-sort epic.md 2>/dev/null | tail -1"
Sleep 400ms
Enter
Sleep 2s
Type `yad gate approve EP-checkout-queue-sort epic.md --by "Alex Kim" 2>/dev/null | tail -1`
Sleep 400ms
Enter
Sleep 3s
Type "yad gate advance EP-checkout-queue-sort epic.md 2>/dev/null | tail -1"
Sleep 400ms
Enter
Sleep 4s
Type "clear"
Enter

Type "# 6. Later, a teammate or a new AI session finds the updated record"
Enter
Type "yad history search pickup 2>/dev/null"
Sleep 400ms
Enter
Sleep 4s
Type "yad thread EP-checkout | sed -n '/Current truth/,/composed/p'"
Sleep 400ms
Enter
Sleep 6s
