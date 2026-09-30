#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Alt+c clipboard history: pick an entry in Rofi and copy it back to the clipboard.
# Alt+Delete in the picker forgets the highlighted entry, for passwords and tokens.
set -eu
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
if ! command -v cliphist >/dev/null; then
    message='Clipboard history needs cliphist: sudo pacman -S --needed cliphist'
    if command -v notify-send >/dev/null; then notify-send 'Clipboard history' "$message"; fi
    printf '%s\n' "$message" >&2
    exit 0
fi
# The watchers start with the session, so cliphist installed later records nothing
# until the next login: say that instead of opening an empty picker.
entries=$(cliphist list)
if [ -z "$entries" ]; then
    if pgrep -x -u "$(id -u)" wl-paste >/dev/null; then
        message='Clipboard history is empty; copy something first.'
    else
        message='Clipboard history is not recording; log out and back in to start it.'
    fi
    if command -v notify-send >/dev/null; then notify-send 'Clipboard history' "$message"; fi
    printf '%s\n' "$message" >&2
    exit 0
fi
# cliphist list prints "<id><tab><preview>"; decode turns the chosen line back into the entry.
set +e
selection=$(printf '%s\n' "$entries" | rofi -no-config -dmenu -i -p 'Clipboard' \
    -kb-custom-1 'Alt+Delete' -theme "$config_root/rofi/active-theme.rasi")
status=$?
set -e
[ -n "$selection" ] || exit 0
case "$status" in
    0) printf '%s\n' "$selection" | cliphist decode | wl-copy ;;
    10) printf '%s\n' "$selection" | cliphist delete ;;
    *) exit 0 ;;
esac
