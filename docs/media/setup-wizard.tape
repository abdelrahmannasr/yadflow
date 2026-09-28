# The README's setup GIF (docs/media/setup-wizard.gif), recorded with vhs (https://github.com/charmbracelet/vhs).
# Re-record from the repo root after a change to what `yad new` / `yad setup` print:
#
#   vhs docs/media/setup-wizard.tape
#
# It runs this checkout's CLI (not the published one) in a fresh temp folder, with every setup question
# taking its default (SDLC_NONINTERACTIVE), so the recording is the same on every machine.

Output docs/media/setup-wizard.gif

Set Shell "bash"
Set FontSize 14
Set Width 1180
Set Height 820
Set Padding 20
Set Theme "Builtin Dark"
Set TypingSpeed 45ms

Hide
Type `export YAD_BIN_JS="$PWD/bin/yad.mjs" SDLC_NONINTERACTIVE=1 YAD_NO_UPDATE_NOTIFIER=1 PS1='> '` Enter
Type `yad() { node "$YAD_BIN_JS" "$@"; }` Enter
Type `cd "$(mktemp -d)" && clear` Enter
Show

Type "yad new acme --solo --separate --ide-targets .claude"
Sleep 600ms
Enter
Sleep 9s

Type "ls -a acme/product"
Sleep 400ms
Enter
Sleep 4s
