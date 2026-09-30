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
    # The pointer alone would name a file that is not there, so the palettes it can
    # point at are installed with it. This is what install.sh's theme step writes.
    if ask 'Install the Rofi themes and point the pickers at Catppuccin?'; then
        for theme in i3-theme.rasi i3-theme-nord.rasi i3-theme-dracula.rasi emoji.rasi; do
            install_file "$bundle_dir/config/rofi/$theme" "rofi/$theme"
        done
        install_file "$bundle_dir/config/rofi/active-theme.rasi" rofi/active-theme.rasi
    fi
fi
packages=()
map_group_packages "$map" sway "$release" sway_packages
# The session also needs programs phase 1 installs with the i3 desktop: the terminal a
# binding opens, rofi itself, pactl for the volume keys, brightnessctl, the emoji list,
# the fonts, the two tray applets, xdg-user-dir, gsettings and the editor the notes key
# opens. Asked for row by row rather than by group, so a machine that only ever runs
# this script does not get Xorg and i3 as a side effect — and the browser still follows
# the release, firefox-esr on Debian and the snap-installing firefox on Ubuntu.
map_named_packages "$map" "$release" session_packages \
    kitty rofi firefox neovim libpulse brightnessctl noto-fonts noto-fonts-emoji \
    network-manager-applet blueman xdg-user-dirs glib2 gsettings-desktop-schemas unicode-data
if (( ${#sway_packages[@]} + ${#session_packages[@]} )); then
    mapfile -t offered < <(printf '%s\n' "${sway_packages[@]}" "${session_packages[@]}" | sort -u)
    printf '\nSway session packages\n  %s\n' "${offered[*]}"
    if ask 'Include these packages?'; then packages+=("${offered[@]}"); fi
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
    # One picker and one brightness helper serve both sessions: the i3 bindings load
    # i3/*.sh and the Sway bindings load sway/*.sh, and they are the same scripts.
    install_file "$bundle_dir/config/i3/emoji.sh" sway/emoji.sh 755
    install_file "$bundle_dir/config/i3/brightness.sh" sway/brightness.sh 755
    # sway -C validates a configuration without a compositor, so this runs anywhere.
    if command -v sway >/dev/null; then
        attempt sway -C -c "$target_config/sway/config"
    else
        printf 'sway is not installed yet, so skipping the configuration check.\n'
        printf 'Accept the package step, or run: sway -C -c %s/sway/config\n' "$target_config"
    fi
fi
# The bundled profile is specific to one laptop; the generated one names whatever
# outputs the running session reports. Overridable so both branches are testable.
dmi_name=${DEBIAN_SETUP_DMI_NAME:-$(cat /sys/class/dmi/id/product_name 2>/dev/null || true)}
case "$dmi_name" in
    *UM5606*)
        printf '\nThis looks like an ASUS Zenbook UM5606 (%s).\n' "$dmi_name"
        printf 'Its profile sets eDP-1 to 1920x1200 and maps the touchscreen to that output.\n'
        if ask 'Use the bundled Zenbook screen profile?'; then
            install_file "$bundle_dir/profiles/zenbook-um5606.conf" sway/config.d/00-local.conf
        fi ;;
    *)
        if [[ -z "${SWAYSOCK:-}" ]]; then
            printf '\nNot running inside Sway, so the outputs are unknown and no profile is written.\n'
            printf 'After your first Sway login, run: swaymsg -t get_outputs\n'
            printf 'then put the output lines in %s/sway/config.d/00-local.conf\n' "$target_config"
        elif ! command -v swaymsg >/dev/null || ! command -v jq >/dev/null; then
            printf '\nReading the outputs needs swaymsg and jq, and one of them is not installed,\n'
            printf 'so no profile is written. Accept the package step above, then run this again.\n'
        else
            # A shell can outlive the compositor it was started from and still export
            # SWAYSOCK, so a query that answers nothing is an ordinary outcome here.
            # An output with no current mode is disabled: it has no line to write, and
            # the scale is read rather than assumed, or a HiDPI session loses its own.
            generated=$(swaymsg -t get_outputs 2>/dev/null | jq -r \
                '.[] | select(.current_mode) |
                 "output \(.name) mode \(.current_mode.width)x\(.current_mode.height) scale \(.scale)"' \
                2>/dev/null || true)
            if [[ -z "$generated" ]]; then
                printf '\nSWAYSOCK is set, but no running session answered, so no profile is written.\n'
                printf 'Inside your Sway session, run: swaymsg -t get_outputs\n'
                printf 'then put the output lines in %s/sway/config.d/00-local.conf\n' "$target_config"
            else
                printf '\nThis session reports these outputs:\n%s\n' "$generated"
                if ask 'Write this as your local Sway profile?'; then
                    if ! "$dry_run"; then
                        profile_temp=$(mktemp)
                        printf '# Generated from swaymsg -t get_outputs on %s.\n' "$(date +%Y-%m-%d)" > "$profile_temp"
                        printf '# Check inputs with: swaymsg -t get_inputs\n%s\n' "$generated" >> "$profile_temp"
                        install_file "$profile_temp" sway/config.d/00-local.conf
                        unlink "$profile_temp"
                    else
                        printf 'Would write sway/config.d/00-local.conf with those outputs\n'
                    fi
                fi
            fi
        fi ;;
esac
# No greeter is installed unless asked for: the machine already boots into something,
# and taking that over is not a side effect an optional step should have.
printf '\nA greeter is not required. The sway package installs the session file, so any\n'
printf 'greeter already on this machine will list Sway, and a text console can start it with\n'
printf 'dbus-run-session sway.\n'
printf 'lightdm with lightdm-gtk-greeter lists both X11 and Wayland sessions, and is what the\n'
printf 'Arch machine this configuration comes from uses.\n'
if ask 'Install lightdm and its GTK greeter, and enable it at boot?'; then
    attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y lightdm lightdm-gtk-greeter
    attempt sudo systemctl enable lightdm.service
    printf 'lightdm starts at the next boot. Choose Sway or i3 from its session menu.\n'
fi
finished=true
