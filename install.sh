#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
set -Eeuo pipefail
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "$LINENO" >&2' ERR
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
install_file() {
    local source=$1 relative=$2 destination="$target_config/$2"
    if [[ -f "$destination" ]] && cmp -s "$source" "$destination"; then
        printf 'Unchanged: %s\n' "$destination"; return
    fi
    if [[ -e "$destination" || -L "$destination" ]]; then
        ask "Back up and replace $destination?" || return 0
        run mkdir -p -- "$backup_dir/$(dirname -- "$relative")"
        if [[ ! -e "$backup_dir/$relative" && ! -L "$backup_dir/$relative" ]]; then
            run cp -a -- "$destination" "$backup_dir/$relative"
        fi
        # Replace a symlink itself rather than writing through it into a dotfiles checkout.
        run unlink -- "$destination"
    fi
    run install -Dm644 -- "$source" "$destination"
}
printf 'Debian desktop setup — packages, configuration and services\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE for redistribution terms.\n'
printf 'Detected %s (%s family); installing with apt.\n' "${distro_name:-$distro_id}" "$family"
printf 'Existing configuration files are backed up before replacement.\n'
map="$bundle_dir/packages/apt-map.tsv"
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
    printf '\n%s\n  %s\n' "${group_label[$id]}" "${list[*]}"
    if ask 'Include these packages?'; then packages+=("${list[@]}"); fi
}
for id in core-desktop audio input-emoji browser-files dev shell; do group "$id"; done
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
        run sudo apt-get install -y "${packages[@]}"
    fi
fi
if ask 'Install the desktop configuration bundle (each existing changed file asks before replacement)?'; then
    while IFS= read -r -d '' source <&3; do
        relative=${source#"$bundle_dir/config/"}
        install_file "$source" "$relative"
    done 3< <(find "$bundle_dir/config" -path "$bundle_dir/config/nvim" -prune -o -type f -print0 | sort -z)
    # The scripts must stay executable; install_file writes mode 644 for plain configuration.
    for script in i3/brightness.sh i3/emoji.sh i3/launcher.sh i3/touchpad.sh; do
        [[ -f "$bundle_dir/config/$script" ]] || continue
        run install -Dm755 -- "$bundle_dir/config/$script" "$target_config/$script"
    done
    if ! "$dry_run" && command -v i3 >/dev/null; then run i3 -C -c "$target_config/i3/config"; fi
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
    viewer_entry="$HOME/.local/share/applications/retext-preview.desktop"
    if [[ -f "$viewer_entry" ]] && cmp -s -- "$bundle_dir/applications/retext-preview.desktop" "$viewer_entry"; then
        printf 'Unchanged: %s\n' "$viewer_entry"
    else
        run install -Dm644 -- "$bundle_dir/applications/retext-preview.desktop" "$viewer_entry"
    fi
    if command -v xdg-mime >/dev/null; then run xdg-mime default retext-preview.desktop text/markdown; fi
fi
