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
# Test seams, as DEBIAN_SETUP_MAP and DEBIAN_SETUP_OS_RELEASE are elsewhere: a
# prefix for the system paths the vendor-repository and tarball helpers write to,
# so a test can exercise them without a root filesystem of its own.
apt_root=${DEBIAN_SETUP_APT_ROOT:-}
opt_root=${DEBIAN_SETUP_OPT_ROOT:-/opt}
share_root=${DEBIAN_SETUP_SHARE_ROOT:-/usr/share}
# Records the failure as attempt does, and returns the command's status so the
# caller can take the other branch. attempt returns 0 unconditionally, by design,
# which is right for a step that should not stop the run and useless for a step
# whose next line depends on whether this one worked.
try() {
    local status=0
    run "$@" || status=$?
    (( status == 0 )) || failed+=("$*")
    return "$status"
}
# Adds a third-party apt repository, verifies it, and removes it again when it
# cannot be verified.
# Usage: add_vendor_repo <id> <key url> <sources line> <package to verify> [pin file]
add_vendor_repo() {
    local id=$1 key_url=$2 line=$3 package=$4 pin=${5:-}
    local keyring="$apt_root/etc/apt/keyrings/$id.gpg"
    local sources="$apt_root/etc/apt/sources.list.d/$id.list"
    local preferences="$apt_root/etc/apt/preferences.d/$id"
    printf '\nRepository %s\n' "$id"
    printf '  key:     %s\n' "$key_url"
    printf '  sources: %s\n' "$line"
    [[ -z "$pin" ]] || printf '  pin:     %s\n' "$preferences"
    if "$dry_run"; then
        printf '  preview only: no key fetched, no sources file written\n'
        return 0
    fi
    local temp
    temp=$(mktemp -d)
    # The key lands before the sources file, and that order is the safety property:
    # a sources file whose key is missing makes every later apt-get update fail,
    # including the deliberately fatal one in install.sh. That would break a
    # working machine instead of merely failing this step.
    if ! try curl -fsS --max-time 120 -o "$temp/key.asc" -- "$key_url"; then
        rm -rf -- "$temp"
        printf 'Could not fetch the signing key, so %s was not added.\n' "$id" >&2
        return 1
    fi
    if ! try gpg --dearmor -o "$temp/key.gpg" -- "$temp/key.asc"; then
        rm -rf -- "$temp"
        printf 'The key for %s is not a usable PGP key; nothing was changed.\n' "$id" >&2
        return 1
    fi
    run sudo install -Dm644 -- "$temp/key.gpg" "$keyring"
    printf '%s\n' "$line" > "$temp/sources"
    run sudo install -Dm644 -- "$temp/sources" "$sources"
    [[ -z "$pin" ]] || run sudo install -Dm644 -- "$pin" "$preferences"
    rm -rf -- "$temp"
    # Its own update, never the shared one: this one is allowed to fail.
    run sudo apt-get update || printf 'apt-get update reported a problem; checking the candidate anyway.\n' >&2
    # And the verdict is a candidate, not an exit status. apt-get update exits 0
    # when a vendor host is unreachable: it prints "W: Failed to fetch" and keeps
    # using the old lists, so an exit status cannot tell success from an outage.
    local candidate
    candidate=$(apt-cache policy -- "$package" 2>/dev/null | awk '/Candidate:/{print $2; exit}')
    if [[ "$candidate" =~ ^[0-9] ]]; then
        printf 'Repository %s is live: %s %s\n' "$id" "$package" "$candidate"
        return 0
    fi
    printf 'The %s repository did not offer %s, so it is being removed again.\n' "$id" "$package" >&2
    run sudo rm -f -- "$sources" "$keyring"
    [[ -z "$pin" ]] || run sudo rm -f -- "$preferences"
    run sudo apt-get update || true
    failed+=("add_vendor_repo $id")
    return 1
}
# Installs an application that ships as a tarball into a versioned directory, with
# a current symlink so a bad update is one symlink away from being undone.
# Usage: install_tarball_app <name> <archive> <version> <expected entry> <desktop file> [icon]
install_tarball_app() {
    local name=$1 archive=$2 version=$3 expect=$4 desktop=$5 icon=${6:-}
    local app="$opt_root/$name" versioned="$opt_root/$name/$version"
    printf '\nInstalling %s %s into %s\n' "$name" "$version" "$versioned"
    if "$dry_run"; then
        printf '  preview only: nothing unpacked\n'
        return 0
    fi
    # Postman publishes no checksum and no signature at all, so a clean listing
    # containing the expected entry is the only integrity gate available. It runs
    # before anything under the install root is touched, never after.
    local listing
    if ! listing=$(tar -tf "$archive" 2>/dev/null); then
        printf '%s is not a readable archive, so %s was not touched.\n' "$archive" "$app" >&2
        failed+=("install_tarball_app $name")
        return 1
    fi
    if ! printf '%s\n' "$listing" | grep -qF -- "$expect"; then
        printf 'The archive does not contain %s, so it is not the %s build it claims to be.\n' \
            "$expect" "$name" >&2
        failed+=("install_tarball_app $name")
        return 1
    fi
    run sudo install -d -m 0755 -- "$versioned"
    run sudo tar -xf "$archive" -C "$versioned" --strip-components=1
    # A relative link, so moving the install root cannot turn it into a dead one.
    run sudo ln -sfn -- "$version" "$app/current"
    run sudo install -Dm644 -- "$desktop" "$share_root/applications/$(basename -- "$desktop")"
    [[ -z "$icon" ]] || run sudo install -Dm644 -- "$icon" \
        "$share_root/icons/hicolor/128x128/apps/$name.png"
    printf '%s %s is installed; the previous version is still under %s.\n' "$name" "$version" "$app"
}
unavailable=()
skipped=()
# Fills the named array with the apt names one group installs on one release, and
# records the rest: where=none packages are unavailable everywhere, and the other
# release's rows are skipped. The array is passed by name rather than printed because
# a function read through $(...) or a process substitution runs in a subshell, where
# its appends to unavailable and skipped would be thrown away.
# Fills the named array with single rows looked up by their Arch name, or by their apt
# name for the rows that have no Arch one. A script that needs part of a group it does
# not install whole asks for those rows by name, and still gets the release's spelling:
# setup-sway.sh installs the browser this way, and gets firefox-esr or firefox.
# Usage: map_named_packages <map> <release> <array name> <name>...
map_named_packages() {
    local map=$1 want=$2
    local -n _mnp_out=$3
    shift 3
    local list=() g arch apt where note name
    _mnp_out=()
    for name in "$@"; do
        while IFS=$'\t' read -r g arch apt where note; do
            [[ "$arch" == "$name" || ( "$arch" == '-' && "$apt" == "$name" ) ]] || continue
            case "$where" in
                none) unavailable+=("$arch ($note)") ;;
                both) list+=("$apt") ;;
                "$want") list+=("$apt") ;;
                *) skipped+=("$apt ($note)") ;;
            esac
        done < <(tail -n +2 -- "$map")
    done
    (( ${#list[@]} )) || return 0
    mapfile -t _mnp_out < <(printf '%s\n' "${list[@]}" | sort -u)
}
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
        # Same bytes is not the same file: install.sh writes the shared helpers 644 for
        # the i3 session and setup-sway.sh installs them 755 for Sway, so the mode has
        # to be corrected here or the second script would silently leave the first's.
        local current
        current=$(stat -c '%a' -- "$destination" 2>/dev/null || true)
        if [[ "$current" == "$mode" ]]; then
            printf 'Unchanged: %s\n' "$destination"; return 0
        fi
        printf 'Unchanged contents, wrong mode (%s): %s\n' "${current:-unknown}" "$destination"
        run chmod -- "$mode" "$destination"
        return 0
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
