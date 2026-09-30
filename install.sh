#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
set -Eeuo pipefail
# BASH_LINENO[0] is the line that called the function the error happened in, so a failure
# inside run() reports the step that ran, not run()'s own body. Empty at the top level.
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "${BASH_LINENO[0]:-$LINENO}" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -d "$bundle_dir/config" ]] || { printf 'Keep install.sh with its config folder.\n' >&2; exit 1; }
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash install.sh [--dry-run]\n'
        printf 'Run as your normal desktop user on Debian 13 or Ubuntu 26.04.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep install.sh with its lib folder.\n' >&2; exit 1; }
target_config="$HOME/.config"
backup_dir="$HOME/.local/state/debian-desktop-setup/$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
# Overridable so the tests can present a Debian or Ubuntu release on any machine.
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
printf 'Debian desktop setup — packages, configuration and services\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE for redistribution terms.\n'
printf 'Detected %s (%s family); installing with apt.\n' "${distro_name:-$distro_id}" "$family"
printf 'Existing configuration files are backed up before replacement.\n'
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    printf 'Finished. Log out and log in to apply startup programs. Alt+D: Rofi launcher; Alt+Shift+S: screenshot.\n'
    printf 'Keyboard: English (US) + Arabic. Shift+Caps Lock switches layouts after login.\n'
    printf 'No login manager is installed in this phase: use the one you have, or startx with the bundled xinit.\n'
    printf 'Sway is available with: bash setup-sway.sh\n'
    # A run with failed steps must not report success to whatever called this script.
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
# Overridable so the tests can present a map with a group this file has never seen.
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
declare -A group_label=(
    [core-desktop]='Core i3 desktop and all configuration dependencies'
    [audio]='PipeWire audio'
    [input-emoji]='Brightness keys, emoji fonts and clipboard'
    [browser-files]='Browser and file utilities'
    [dev]='Development and command-line utilities (PHP, Composer, mkcert)'
    [shell]='Zsh and its completion plugins'
)
packages=()
group() {
    # Not named "list": map_group_packages takes the array by name, and a nameref
    # pointing at a local of the same name is a circular reference bash refuses.
    local id=$1 chosen=()
    map_group_packages "$map" "$id" "$release" chosen
    (( ${#chosen[@]} )) || return 0
    printf '\n%s\n  %s\n' "${group_label[$id]:-Additional packages ($id)}" "${chosen[*]}"
    if ask 'Include these packages?'; then packages+=("${chosen[@]}"); fi
}
# editor-tools is offered by setup-nvim.sh, not here; every other group in the map is.
mapfile -t group_ids < <(awk -F'\t' 'NR > 1 && $1 != "editor-tools" && $1 != "sway" && !seen[$1]++ { print $1 }' "$map")
(( ${#group_ids[@]} )) || { printf 'The package map lists no groups: %s\n' "$map" >&2; exit 1; }
for id in "${group_ids[@]}"; do group "$id"; done
if (( ${#unavailable[@]} )); then
    printf '\nNot packaged on %s: %s\n' "$family" "${unavailable[*]}"
fi
if (( ${#skipped[@]} )); then
    printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"
fi
if (( ${#packages[@]} )); then
    mapfile -t packages < <(printf '%s\n' "${packages[@]}" | sort -u)
    printf '\nSelected packages: %s\n' "${packages[*]}"
    if ask 'Update the package lists and install the selected packages?'; then
        # A failed update must stop here: installing against a stale index is worse.
        run sudo apt-get update
        # Ubuntu's firefox package installs a snap from its postinst and asks debconf
        # about it; an installer the user is watching must not stop on that prompt.
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
    fi
fi
if ask 'Install the desktop configuration bundle (each existing changed file asks before replacement)?'; then
    while IFS= read -r -d '' source <&3; do
        relative=${source#"$bundle_dir/config/"}
        install_file "$source" "$relative"
    done 3< <(find "$bundle_dir/config" -path "$bundle_dir/config/nvim" -prune -o -type f -print0 | sort -z)
    # The scripts must stay executable; plain configuration is installed mode 644 above.
    for script in i3/brightness.sh i3/emoji.sh i3/launcher.sh i3/touchpad.sh; do
        [[ -f "$bundle_dir/config/$script" ]] || continue
        install_file "$bundle_dir/config/$script" "$script" 755
    done
    if ! "$dry_run" && command -v i3 >/dev/null; then attempt i3 -C -c "$target_config/i3/config"; fi
fi
if ask 'Choose the Rofi theme for the installed launcher?'; then
    printf '1) Catppuccin  2) Nord  3) Dracula\n'
    read -r -p 'Theme [1]: ' choice
    case "$choice" in
        2) theme=i3-theme-nord.rasi ;;
        3) theme=i3-theme-dracula.rasi ;;
        *) theme=i3-theme.rasi ;;
    esac
    # A separate pointer file means switching themes never edits the i3 bindings.
    if ! "$dry_run"; then
        theme_temp=$(mktemp)
        printf '@theme "%s"\n' "$theme" > "$theme_temp"
        install_file "$theme_temp" rofi/active-theme.rasi
        unlink "$theme_temp"
    else
        printf 'Would select %s\n' "$theme"
    fi
fi
if ask 'Open Markdown (.md) files rendered in ReText preview by default?'; then
    install_file "$bundle_dir/applications/retext-preview.desktop" \
        applications/retext-preview.desktop 644 "$HOME/.local/share"
    if command -v xdg-mime >/dev/null; then attempt xdg-mime default retext-preview.desktop text/markdown; fi
fi
if ask 'Set the dark appearance preference in your current desktop session?'; then
    if command -v gsettings >/dev/null; then
        attempt gsettings set org.gnome.desktop.interface color-scheme prefer-dark
    else
        printf 'Install libglib2.0-bin and rerun to set the desktop preference.\n'
    fi
fi
# Run as the desktop user: sudo would create the CA in root's home, unseen by your browsers.
printf '\nmkcert creates a local certificate authority trusted by this system and your browsers.\n'
printf 'Keep rootCA-key.pem private: anyone with it can issue certificates this machine trusts.\n'
if ask 'Create and trust the mkcert local CA for HTTPS development (mkcert -install)?'; then
    if ! "$dry_run" && ! command -v mkcert >/dev/null; then
        printf 'mkcert is not installed. Accept the development group, then rerun this step.\n' >&2
    else
        attempt mkcert -install
    fi
fi
printf '\nsnapd.socket is what makes snap packages work. On Ubuntu the browser is a snap and\n'
printf 'needs it; on Debian nothing this project installs is a snap, and it stays idle until\n'
printf 'something asks for one.\n'
for service in NetworkManager.service bluetooth.service fstrim.timer snapd.socket; do
    if ask "Enable and start $service?"; then attempt sudo systemctl enable --now "$service"; fi
done
if ask 'Start and enable the PipeWire sockets and WirePlumber for this user?'; then
    attempt systemctl --user enable --now pipewire.socket pipewire-pulse.socket wireplumber.service
fi
if ask 'Set up Zsh, Oh My Zsh, autosuggestions and syntax highlighting?'; then
    if "$dry_run"; then attempt bash "$bundle_dir/setup-zsh.sh" --dry-run; else attempt bash "$bundle_dir/setup-zsh.sh"; fi
fi
if ask 'Restore Neovim and its plugins?'; then
    if "$dry_run"; then attempt bash "$bundle_dir/setup-nvim.sh" --dry-run; else attempt bash "$bundle_dir/setup-nvim.sh"; fi
fi
finished=true
