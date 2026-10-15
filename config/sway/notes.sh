#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Alt+` notes scratchpad: toggle the open notes window, or start a new note.
# Each new window takes the next unused name: scratch.md, scratch-1.md, scratch-2.md, ...
# A note closed without :w is never written, so its name is reused next time.
swaymsg '[app_id=notes-scratchpad] scratchpad show' >/dev/null 2>&1 && exit 0
dir=${NOTES_DIR:-$HOME/notes}
mkdir -p -- "$dir"
file=$dir/scratch.md
n=0
while [ -e "$file" ]; do
    n=$((n + 1))
    file=$dir/scratch-$n.md
done
exec kitty --class notes-scratchpad nvim -S "${0%/*}/notes.lua" -- "$file"
