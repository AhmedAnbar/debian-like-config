#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Emoji picker for both sessions. rofi-emoji is not packaged in Debian 13 or
# Ubuntu 26.04, so the list comes from unicode-data's emoji-test.txt and the
# choice is typed with wtype under Wayland or xdotool under X11.
set -eu
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
data=${EMOJI_DATA:-/usr/share/unicode/emoji/emoji-test.txt}
say() {
    if command -v notify-send >/dev/null; then notify-send 'Emoji picker' "$1"; fi
    printf '%s\n' "$1" >&2
}
if [ ! -r "$data" ]; then
    say 'Emoji list missing: sudo apt-get install unicode-data'
    exit 0
fi
# Lines look like: 1F600 ; fully-qualified # 😀 E1.0 grinning face
# Keep the fully-qualified ones, and print "<emoji> <name>".
list=$(sed -n 's/.*; fully-qualified[[:space:]]*# \([^ ]*\) E[0-9.]* \(.*\)$/\1 \2/p' "$data")
if [ -z "$list" ]; then
    say 'Emoji list could not be read; check /usr/share/unicode/emoji/emoji-test.txt'
    exit 0
fi
set +e
choice=$(printf '%s\n' "$list" | rofi -no-config -dmenu -i -p 'Emoji' \
    -theme "$config_root/rofi/active-theme.rasi")
set -e
[ -n "${choice:-}" ] || exit 0
emoji=${choice%% *}
# Typing is best effort: a compositor may refuse synthetic input, and a lock screen
# always will. Copying keeps the choice rather than losing it.
if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wtype >/dev/null; then
    wtype -- "$emoji" && exit 0
elif [ -n "${DISPLAY:-}" ] && command -v xdotool >/dev/null; then
    xdotool type --clearmodifiers -- "$emoji" && exit 0
fi
if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-copy >/dev/null; then
    printf '%s' "$emoji" | wl-copy
    say "Copied $emoji — press Ctrl+V to paste"
elif command -v xclip >/dev/null; then
    printf '%s' "$emoji" | xclip -selection clipboard
    say "Copied $emoji — press Ctrl+V to paste"
else
    say "Could not type or copy $emoji; install wtype or xdotool"
fi
