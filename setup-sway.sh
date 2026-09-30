#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Optional Sway/Wayland session. The i3 desktop install.sh sets up stays installed
# and unchanged: nothing here removes or edits an i3, Picom or Flameshot setting.
set -Eeuo pipefail
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "${BASH_LINENO[0]:-$LINENO}" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-sway.sh [--dry-run]\n'
        printf 'Adds an optional Sway session on Debian 13 or Ubuntu 26.04. i3 is left alone.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-sway.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/sway-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
[[ -d "$bundle_dir/config/sway" ]] || { printf 'Keep setup-sway.sh with its config folder.\n' >&2; exit 1; }
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# apt-cache may be absent or the package unindexed; pipefail would turn that into an
# exit, and an unknown version is not a reason to refuse to run.
candidate() { apt-cache policy "$1" 2>/dev/null | awk '/Candidate:/{print $2; exit}' || true; }
printf 'Sway session setup — Wayland, Waybar, notifications and screen lock\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'apt offers Sway %s and Waybar %s.\n' "$(candidate sway)" "$(candidate waybar)"
printf 'Your i3 desktop stays installed and unchanged; nothing here edits its configuration.\n'
# The launcher, the clipboard picker and the emoji picker all load this file. install.sh
# writes it; without it every rofi keystroke fails with a theme error and no window.
if [[ ! -f "$target_config/rofi/active-theme.rasi" ]]; then
    printf '\nMissing %s/rofi/active-theme.rasi, which the launcher, clipboard and emoji\n' "$target_config"
    printf 'pickers all load. Run install.sh and accept the Rofi theme step, or the keys open nothing.\n'
    if ask 'Write a Catppuccin theme pointer now so the pickers work?'; then
        if ! "$dry_run"; then
            theme_temp=$(mktemp)
            printf '@theme "i3-theme.rasi"\n' > "$theme_temp"
            install_file "$theme_temp" rofi/active-theme.rasi
            unlink "$theme_temp"
        else
            printf 'Would write rofi/active-theme.rasi pointing at i3-theme.rasi\n'
        fi
    fi
fi
packages=()
map_group_packages "$map" sway "$release" sway_packages
if (( ${#sway_packages[@]} )); then
    printf '\nSway session packages\n  %s\n' "${sway_packages[*]}"
    if ask 'Include these packages?'; then packages+=("${sway_packages[@]}"); fi
fi
if (( ${#unavailable[@]} )); then printf '\nNot packaged on %s: %s\n' "$family" "${unavailable[*]}"; fi
if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    printf 'Log out, then choose Sway in your greeter, or run: dbus-run-session sway\n'
    printf 'Alt+D: apps; Alt+B: Firefox; Print: screenshot; Super+period: emoji; Alt+C: clipboard.\n'
    printf 'Shift+Caps Lock: English/Arabic; Alt+L: lock; Alt+Shift+E: log out.\n'
    printf 'Your i3 session is untouched: choose it in the greeter to go back.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
if (( ${#packages[@]} )); then
    printf '\nSelected packages: %s\n' "${packages[*]}"
    if ask 'Update the package lists and install them?'; then
        run sudo apt-get update
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
    fi
fi
if ask 'Install the Sway configuration (each existing changed file asks before replacement)?'; then
    while IFS= read -r -d '' source <&3; do
        relative=${source#"$bundle_dir/config/"}
        case "$relative" in
            *.sh) install_file "$source" "$relative" 755 ;;
            *) install_file "$source" "$relative" ;;
        esac
    done 3< <(find "$bundle_dir/config/sway" "$bundle_dir/config/waybar" "$bundle_dir/config/mako" \
        "$bundle_dir/config/swaylock" "$bundle_dir/config/xdg-desktop-portal" -type f -print0 | sort -z)
    # One picker serves both sessions: the i3 binding loads i3/emoji.sh and the Sway
    # binding loads sway/emoji.sh, and they are the same script.
    install_file "$bundle_dir/config/i3/emoji.sh" sway/emoji.sh 755
    # sway -C validates a configuration without a compositor, so this runs anywhere.
    if command -v sway >/dev/null; then
        attempt sway -C -c "$target_config/sway/config"
    else
        printf 'sway is not installed yet, so skipping the configuration check.\n'
        printf 'Accept the package step, or run: sway -C -c %s/sway/config\n' "$target_config"
    fi
fi
finished=true
