#!/bin/sh
# Keep the app/run launcher independent of unrelated global Rofi configuration.
set -eu
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
case "${1:-drun}" in
    drun|run|window) mode=${1:-drun} ;;
    *) printf 'Usage: %s [drun|run|window]\n' "$0" >&2; exit 2 ;;
esac
exec rofi -no-config -modi drun,run,window -show "$mode" -show-icons \
    -drun-display-format '{name}' -display-drun Apps -display-run Run \
    -theme "$config_root/rofi/active-theme.rasi"
