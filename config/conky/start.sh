#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Start or restart the Conky panel with the selected theme; --stop removes it.
# Runs at every Sway/i3 login, so it stays silent when conky is not installed.
set -u
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
conky_dir=$config_root/conky
default_theme=catppuccin
runtime_dir=${XDG_RUNTIME_DIR:-/tmp}
pid_file=$runtime_dir/arch-desktop-conky.pid

stop_panel() {
    [ -f "$pid_file" ] || return 0
    pid=
    read -r pid < "$pid_file" || true
    case $pid in
        ''|*[!0-9]*) ;;
        *)
            # Only stop our own panel, never whatever reused a stale PID.
            if [ -r "/proc/$pid/comm" ] && [ "$(cat "/proc/$pid/comm")" = conky ]; then
                kill "$pid" 2>/dev/null
                tries=0
                while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 30 ]; do
                    sleep 0.1
                    tries=$((tries + 1))
                done
            fi ;;
    esac
    rm -f "$pid_file"
}

case "${1:-}" in
    --stop) stop_panel; exit 0 ;;
    '') ;;
    *) printf 'Usage: %s [--stop]\n' "$0" >&2; exit 2 ;;
esac
command -v conky >/dev/null 2>&1 || exit 0

theme=
if [ -f "$conky_dir/theme" ]; then read -r theme < "$conky_dir/theme" || true; fi
theme=${theme:-$default_theme}
if [ "$theme" = off ]; then
    stop_panel
    exit 0
fi
case $theme in
    *[!a-z0-9_-]*) found=false ;;
    *) if [ -f "$conky_dir/themes/$theme.conf" ]; then found=true; else found=false; fi ;;
esac
if ! "$found"; then
    printf "Conky theme '%s' not found; using %s.\n" "$theme" "$default_theme" >&2
    theme=$default_theme
fi

stop_panel
# setsid detaches the panel from the launching terminal; errors go to a log for debugging.
setsid conky -c "$conky_dir/themes/$theme.conf" > "$runtime_dir/arch-desktop-conky.log" 2>&1 &
printf '%s\n' "$!" > "$pid_file"
