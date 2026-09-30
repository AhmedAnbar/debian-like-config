#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Shared by install.sh and setup-sway.sh. Sourced, never executed: the sourcing
# script sets dry_run, target_config and backup_dir first, and this file holds no
# policy of its own — every prompt belongs to the script that asks it.
declined=()
failed=()
require_normal_user() {
    if (( EUID == 0 )); then
        printf 'Run as your normal user, without sudo. Commands needing root will use sudo.\n' >&2
        exit 1
    fi
}
require_apt_get() {
    command -v apt-get >/dev/null || { printf 'This installer requires apt-get: Debian or Ubuntu.\n' >&2; exit 1; }
}
# Sets release, family and distro_name. os-release is shell syntax, so it is read
# in subshells: a stray variable in that file must not become one of ours.
detect_release() {
    local os_release=$1 distro_id distro_like
    [[ -r "$os_release" ]] || { printf 'Cannot read %s, so the distribution is unknown.\n' "$os_release" >&2; exit 1; }
    distro_id=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${ID:-}")
    distro_like=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${ID_LIKE:-}")
    distro_name=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${PRETTY_NAME:-${ID:-}}")
    [[ -n "$distro_id" ]] || { printf '%s has no ID line, so the distribution is unknown.\n' "$os_release" >&2; exit 1; }
    case "$distro_id" in
        debian) release=debian family=Debian ;;
        ubuntu) release=ubuntu family=Ubuntu ;;
        *)  case " $distro_like " in
                *" ubuntu "*) release=ubuntu family=Ubuntu ;;
                *" debian "*) release=debian family=Debian ;;
                *)  printf 'Unsupported distribution: %s.\n' "$distro_id" >&2
                    printf 'This installer supports Debian 13 and Ubuntu 26.04, and derivatives that name one of them in ID_LIKE.\n' >&2
                    exit 1 ;;
            esac ;;
    esac
}
unavailable=()
skipped=()
# Fills the named array with the apt names one group installs on one release, and
# records the rest: where=none packages are unavailable everywhere, and the other
# release's rows are skipped. The array is passed by name rather than printed because
# a function read through $(...) or a process substitution runs in a subshell, where
# its appends to unavailable and skipped would be thrown away.
# Usage: map_group_packages <map> <group> <release> <array name>
map_group_packages() {
    local map=$1 id=$2 want=$3 g arch apt where note
    local -n _mgp_out=$4
    local list=()
    _mgp_out=()
    while IFS=$'\t' read -r g arch apt where note; do
        [[ "$g" == "$id" ]] || continue
        case "$where" in
            none) unavailable+=("$arch ($note)") ;;
            both) list+=("$apt") ;;
            "$want") list+=("$apt") ;;
            *) skipped+=("$apt ($note)") ;;
        esac
    done < <(tail -n +2 -- "$map")
    (( ${#list[@]} )) || return 0
    mapfile -t _mgp_out < <(printf '%s\n' "${list[@]}" | sort -u)
}
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
# Every file either installer writes goes through here: one consent prompt, one backup,
# one place where the mode is decided.
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
# The part of the closing summary both installers share. The caller prints its own
# closing lines after this and decides the exit status.
summary_prologue() {
    if (( ${#failed[@]} )); then printf 'Steps that failed:\n'; printf '  %s\n' "${failed[@]}"; fi
    if (( ${#declined[@]} )); then printf 'Left alone at your request:\n'; printf '  %s\n' "${declined[@]}"; fi
    printf 'Backups, when needed: %s\n' "$backup_dir"
}
