#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -eu
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
case "${1:-drun}" in
    drun|run) mode=${1:-drun} ;;
    *) printf 'Usage: %s [drun|run]\n' "$0" >&2; exit 2 ;;
esac
# Rofi 2 supports Wayland natively. Avoid X11-only window-switching modes.
exec rofi -no-config -modi drun,run -show "$mode" -show-icons \
    -drun-display-format '{name}' -display-drun Apps -display-run Run \
    -theme "$config_root/rofi/active-theme.rasi"
