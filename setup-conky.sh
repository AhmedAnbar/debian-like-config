#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# The conky system panel for both sessions. Phases 1 and 2 left it out on purpose:
# autostarting a panel no earlier phase installs is a silent login failure, so the
# autostart arrives here, together with the program it starts.
set -Eeuo pipefail
trap 'printf "Conky setup stopped at line %s. Review the error above before retrying.\n" "${BASH_LINENO[0]:-$LINENO}" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-conky.sh [--dry-run]\n'
        printf 'Installs the conky panel, its three themes and the session autostarts.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-conky.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/conky-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
[[ -d "$bundle_dir/config/conky" ]] || { printf 'Keep setup-conky.sh with its config folder.\n' >&2; exit 1; }
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# apt-cache may be absent or the package unindexed; pipefail would turn that into an
# exit, and an unknown version is not a reason to refuse to run.
candidate() { apt-cache policy "$1" 2>/dev/null | awk '/Candidate:/{print $2; exit}' || true; }
printf 'Conky panel setup — clock, CPU, memory, disk, network and battery\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'The panel is the configuration from the Arch desktop, unchanged: config/conky in\n'
printf 'this repository. Only Conky built-ins are used, so one panel serves i3 and Sway.\n'
# The map row carries conky-std for a reason worth repeating where the user can see it.
printf 'apt offers conky-std %s. The plain "conky" package is virtual, with\n' "$(candidate conky-std)"
printf 'no installation candidate of its own; conky-std is the build carrying the Lua\n'
printf 'configuration format, Xft text, the ARGB own-window the panel needs and the\n'
printf 'Wayland output.\n'
conky_packages=()
map_group_packages "$map" conky-panel "$release" conky_packages
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
    printf 'Alt+Shift+T picks a theme or switches the panel off, once the binding is in place.\n'
    printf 'The panel reloads with: sh ~/.config/conky/start.sh\n'
    # The recon proved what it proved and no more. Saying so here is cheaper for the
    # user than discovering an empty line in the panel and distrusting the whole thing.
    printf '\nWhat was proved, and what was not:\n'
    printf '  Proved: the panel loads and draws under Xvfb on Debian 13 and Ubuntu 26.04,\n'
    printf '    with no unknown-setting errors.\n'
    printf '  Not verified: a real Sway surface. Xvfb is an X server, so the Wayland output\n'
    printf '    path is confirmed on your machine at your first login, not by any test.\n'
    printf '  Not verified: the hwmon temperature line and the battery lines. They are found\n'
    printf '    by probing /sys, which a container has nothing to probe; a machine with no\n'
    printf '    matching sensor or battery simply draws one line fewer.\n'
    printf '  Not verified: the glyphs. The panel asks for JetBrainsMono Nerd Font, which\n'
    printf '    neither release packages, so fontconfig substitutes something legible and\n'
    printf '    the Nerd Font step is the one that improves it.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
if (( ${#conky_packages[@]} )); then
    printf '\nConky panel packages\n  %s\n' "${conky_packages[*]}"
    # Ubuntu keeps conky-std in universe, so the install is an attempt, not a run: a
    # machine with universe switched off must lose the package, not the configuration.
    if [[ "$release" == ubuntu ]]; then
        printf 'Ubuntu keeps conky-std in universe. If the install fails, enable universe\n'
        printf 'with: sudo add-apt-repository universe, then run this script again.\n'
    fi
    if ask 'Update the package lists and install these packages?'; then
        if try sudo apt-get update; then
            attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${conky_packages[@]}"
        else
            printf 'The package lists could not be updated, so nothing was installed.\n' >&2
        fi
    fi
fi
if ask 'Install the conky panel configuration (each existing changed file asks before replacement)?'; then
    # sessions/ holds the two session fragments, which belong in the i3 and Sway
    # configuration directories rather than beside the panel's own files.
    while IFS= read -r -d '' source <&3; do
        relative=${source#"$bundle_dir/config/"}
        case "$relative" in
            *.sh) install_file "$source" "$relative" 755 ;;
            *) install_file "$source" "$relative" ;;
        esac
    done 3< <(find "$bundle_dir/config/conky" -path "$bundle_dir/config/conky/sessions" -prune \
        -o -type f -print0 | sort -z)
fi
# start.sh reads this file and falls back to catppuccin when it is absent or names a
# theme that is not installed, so writing it is optional and switch.sh rewrites it.
printf '\nThe panel ships three palettes, matching the three Rofi themes install.sh offers.\n'
if ask 'Choose the panel theme now (Alt+Shift+T changes it later)?'; then
    printf '1) Catppuccin  2) Nord  3) Dracula\n'
    read -r -p 'Theme [1]: ' choice
    case "$choice" in
        2) theme=nord ;;
        3) theme=dracula ;;
        *) theme=catppuccin ;;
    esac
    if ! "$dry_run"; then
        theme_temp=$(mktemp)
        printf '%s\n' "$theme" > "$theme_temp"
        install_file "$theme_temp" conky/theme
        unlink "$theme_temp"
    else
        printf 'Would select %s\n' "$theme"
    fi
fi
# Sway includes ~/.config/sway/config.d/*.conf, so the fragment is a file of its own and
# this script never edits the Sway configuration others are also writing.
printf '\nThe Sway session reads ~/.config/sway/config.d/*.conf, so the panel autostart and\n'
printf 'its Alt+Shift+T binding install as 30-conky.conf without touching sway/config.\n'
if ask 'Start the panel in your Sway session?'; then
    install_file "$bundle_dir/config/conky/sessions/sway-30-conky.conf" sway/config.d/30-conky.conf
    if [[ ! -f "$target_config/sway/config" ]]; then
        printf 'There is no %s/sway/config yet; the fragment waits there for setup-sway.sh.\n' \
            "$target_config"
    fi
fi
# i3 has no drop-in directory in this repository's configuration: it is one file, which
# install.sh replaces whole. Appending to it would duplicate the lines on the second run,
# and replacing it would discard the user's own edits, so the lines are printed instead.
printf '\ni3 is configured as a single file, so its two lines are yours to add:\n'
printf '\n'
printf '  # Conky system panel (no-op until conky is installed); Alt+Shift+T picks a theme or Off.\n'
printf '  exec --no-startup-id sh ~/.config/conky/start.sh\n'
printf '  bindsym $mod+Shift+t exec --no-startup-id sh ~/.config/conky/switch.sh\n'
printf '\n'
printf 'Add them to %s/i3/config, next to the nm-applet and blueman-applet autostarts,\n' "$target_config"
printf 'then reload i3 with Alt+Shift+R.\n'
if ask 'Keep those lines on disk as ~/.config/conky/i3-conky.conf to paste from?'; then
    install_file "$bundle_dir/config/conky/sessions/i3-conky.conf" conky/i3-conky.conf
fi
finished=true
