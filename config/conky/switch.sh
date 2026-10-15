#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Choose the Conky theme. No argument opens a Rofi picker (Alt+Shift+T);
# `switch.sh nord` or `switch.sh off` sets it directly; --list prints the choices.
set -eu
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
conky_dir=$config_root/conky

choices() {
    for file in "$conky_dir"/themes/*.conf; do
        [ -f "$file" ] || continue
        name=${file##*/}
        printf '%s\n' "${name%.conf}"
    done
    printf 'off\n'
}

case "${1:-}" in
    --list) choices; exit 0 ;;
    -h|--help) printf 'Usage: %s [THEME|off|--list]\n' "$0"; exit 0 ;;
    '')
        current=catppuccin
        if [ -f "$conky_dir/theme" ]; then read -r current < "$conky_dir/theme" || true; fi
        set -- -dmenu -i -no-config -p "Conky (${current:-catppuccin})"
        if [ -f "$config_root/rofi/active-theme.rasi" ]; then
            set -- "$@" -theme "$config_root/rofi/active-theme.rasi"
        fi
        # Escape or closing the picker keeps the current panel.
        choice=$(choices | rofi "$@") || exit 0
        [ -n "$choice" ] || exit 0 ;;
    *) choice=$1 ;;
esac

if ! choices | grep -qxF -- "$choice"; then
    printf 'Unknown theme: %s\nAvailable: %s\n' "$choice" "$(choices | tr '\n' ' ')" >&2
    exit 2
fi
printf '%s\n' "$choice" > "$conky_dir/theme"
if [ "$choice" = off ]; then
    exec sh "$conky_dir/start.sh" --stop
fi
exec sh "$conky_dir/start.sh"
