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
if (( EUID == 0 )); then
    printf 'Run as your normal user, without sudo. Commands needing root will use sudo.\n' >&2
    exit 1
fi
command -v apt-get >/dev/null || { printf 'This installer requires apt-get: Debian or Ubuntu.\n' >&2; exit 1; }
# Overridable so the tests can present a Debian or Ubuntu release on any machine.
os_release=${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}
[[ -r "$os_release" ]] || { printf 'Cannot read %s, so the distribution is unknown.\n' "$os_release" >&2; exit 1; }
# os-release is shell syntax; read it in subshells so it cannot leak variables here.
distro_id=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${ID:-}")
distro_like=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${ID_LIKE:-}")
distro_name=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${PRETTY_NAME:-${ID:-}}")
[[ -n "$distro_id" ]] || { printf '%s has no ID line, so the distribution is unknown.\n' "$os_release" >&2; exit 1; }
unsupported() {
    printf 'Unsupported distribution: %s.\n' "$1" >&2
    printf 'This installer supports Debian 13 and Ubuntu 26.04, and derivatives that name one of them in ID_LIKE.\n' >&2
    exit 1
}
case "$distro_id" in
    debian) release=debian family=Debian ;;
    ubuntu) release=ubuntu family=Ubuntu ;;
    *)  case " $distro_like " in
            *" ubuntu "*) release=ubuntu family=Ubuntu ;;
            *" debian "*) release=debian family=Debian ;;
            *) unsupported "$distro_id" ;;
        esac ;;
esac
target_config="$HOME/.config"
backup_dir="$HOME/.local/state/debian-desktop-setup/$(date +%Y%m%d-%H%M%S)-$$"
ask() {
    local answer
    read -r -p "$1 [y/N] " answer || return 1
    [[ "$answer" == y || "$answer" == Y || "$answer" == yes ]]
}
run() {
    printf '  '; printf '%q ' "$@"; printf '\n'
    if ! "$dry_run"; then "$@"; fi
}
# An optional step that fails must not abort the installation: the steps after it are
# independent, and a machine left half configured with no summary is the worst outcome.
attempt() {
    if run "$@"; then return 0; fi
    printf 'That step failed; continuing with the rest.\n' >&2
    failed+=("$*")
    return 0
}
# Every file this installer writes goes through here: one consent prompt, one backup,
# one place where the mode is decided. The mode and root are arguments because the
# executable scripts and the desktop entry differ only in those two things.
install_file() {
    local source=$1 relative=$2 mode=${3:-644} root=${4:-$target_config}
    local destination="$root/$relative"
    if [[ -f "$destination" ]] && cmp -s "$source" "$destination"; then
        printf 'Unchanged: %s\n' "$destination"; return 0
    fi
    if [[ -e "$destination" || -L "$destination" ]]; then
        ask "Back up and replace $destination?" || { declined+=("$destination"); return 0; }
        run mkdir -p -- "$backup_dir/$(dirname -- "$relative")"
        if [[ ! -e "$backup_dir/$relative" && ! -L "$backup_dir/$relative" ]]; then
            # -L copies what the link points at: a copied relative symlink would be a
            # dead link inside the backup directory, which is no backup at all.
            run cp -aL -- "$destination" "$backup_dir/$relative"
        fi
        # Replace a symlink itself rather than writing through it into a dotfiles checkout.
        run unlink -- "$destination"
    fi
    run install -Dm"$mode" -- "$source" "$destination"
}
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
    if (( ${#failed[@]} )); then printf 'Steps that failed:\n'; printf '  %s\n' "${failed[@]}"; fi
    if (( ${#declined[@]} )); then printf 'Left alone at your request:\n'; printf '  %s\n' "${declined[@]}"; fi
    printf 'Finished. Backups, when needed: %s\n' "$backup_dir"
    printf 'Log out and log in to apply startup programs. Alt+D: Rofi launcher; Alt+Shift+S: screenshot.\n'
    printf 'Keyboard: English (US) + Arabic. Shift+Caps Lock switches layouts after login.\n'
    printf 'No login manager is installed in this phase: use the one you have, or startx with the bundled xinit.\n'
    printf 'Sway, third-party applications and system extras arrive in later phases.\n'
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
unavailable=()
skipped=()
declined=()
failed=()
group() {
    local id=$1 list=() g arch apt where note
    while IFS=$'\t' read -r g arch apt where note; do
        [[ "$g" == "$id" ]] || continue
        case "$where" in
            none) unavailable+=("$arch ($note)") ;;
            both) list+=("$apt") ;;
            "$release") list+=("$apt") ;;
            *) skipped+=("$apt ($note)") ;;
        esac
    done < <(tail -n +2 -- "$map")
    (( ${#list[@]} )) || return 0
    mapfile -t list < <(printf '%s\n' "${list[@]}" | sort -u)
    printf '\n%s\n  %s\n' "${group_label[$id]:-Additional packages ($id)}" "${list[*]}"
    if ask 'Include these packages?'; then packages+=("${list[@]}"); fi
}
# editor-tools is offered by setup-nvim.sh, not here; every other group in the map is.
mapfile -t group_ids < <(awk -F'\t' 'NR > 1 && $1 != "editor-tools" && !seen[$1]++ { print $1 }' "$map")
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
        attempt sudo apt-get install -y "${packages[@]}"
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
for service in NetworkManager.service bluetooth.service fstrim.timer; do
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
