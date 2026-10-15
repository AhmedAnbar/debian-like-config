#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Select a region, save a private PNG and copy it to the Wayland clipboard.
set -eu
umask 077
command -v grim >/dev/null
command -v slurp >/dev/null
command -v wl-copy >/dev/null
geometry=$(slurp) || exit 0
[ -n "$geometry" ] || exit 0
pictures=$(xdg-user-dir PICTURES 2>/dev/null) || pictures="$HOME/Pictures"
[ -n "$pictures" ] || pictures="$HOME/Pictures"
capture_dir="$pictures/Screenshots"
mkdir -p -- "$capture_dir"
# A timestamp and unique suffix avoid overwriting another screenshot.
capture=$(mktemp "$capture_dir/$(date +%Y-%m-%d_%H-%M-%S)-XXXXXX.png")
if ! grim -g "$geometry" "$capture"; then
    # Remove only the newly-created, failed capture, never existing screenshots.
    unlink -- "$capture"
    exit 1
fi
if ! wl-copy --type image/png < "$capture"; then
    printf 'Saved screenshot, but clipboard copy failed: %s\n' "$capture" >&2
    exit 1
fi
notify-send -a Screenshot 'Screenshot saved and copied' "$capture" || :
printf '%s\n' "$capture"
