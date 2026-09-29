#!/bin/sh
# Adjust the screen backlight, not the keyboard LEDs. Keep at least 5% brightness.
set -eu
case "${1:-}" in
    up) change=5%+ ;;
    down) change=5%- ;;
    *) printf 'Usage: %s up|down\n' "$0" >&2; exit 2 ;;
esac
command -v brightnessctl >/dev/null 2>&1 || {
    printf 'Install brightnessctl to use the brightness keys.\n' >&2
    exit 1
}
maximum=$(brightnessctl --class=backlight max)
case "$maximum" in ''|*[!0-9]*) printf 'No valid backlight device found.\n' >&2; exit 1 ;; esac
[ "$maximum" -gt 0 ] || exit 1
minimum=$(( (maximum + 19) / 20 ))
exec brightnessctl --class=backlight --min-value="$minimum" set "$change"
