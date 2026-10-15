#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Postman from the vendor's own tarball, because it is published no other way: there
# is no apt package and no vendor repository on either release. Re-running this is the
# update path, and the previous version stays in /opt behind the current symlink.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Postman setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-postman.sh [--dry-run]\n'
        printf 'Installs Postman from the official linux64 tarball into /opt/postman on Debian 13\n'
        printf 'or Ubuntu 26.04, with the Electron runtime libraries it links against.\n'
        printf 'Run it again to update: the previous version stays under /opt/postman.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-postman.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/postman-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
channel_url='https://dl.pstmn.io/download/channel/stable/linux_64'
app_root="$opt_root/postman"
# The entry a genuine linux64 build has in its listing. With no checksum and no
# signature published, this is the entire integrity gate, and install_tarball_app
# checks it before anything under the install root is touched.
expect_entry='Postman/app/postman'
printf 'Postman — the official linux64 tarball into %s\n' "$app_root"
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Postman itself is proprietary and carries its own licence terms.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'Source: %s, then the version-pinned URL it names.\n' "$channel_url"
printf 'Postman publishes no checksum and no signature for this tarball: every .sha256 and\n'
printf 'SHASUMS path returns 400. The only integrity gate is a clean tar listing containing\n'
printf '%s, which is checked before %s is touched.\n' "$expect_entry" "$app_root"
printf 'The snap is a major version behind and is deliberately not offered.\n'
# Written here rather than shipped as an asset: the Exec line depends on the install
# root and on which executable this build actually carries. The basename is not a
# choice — Postman's main.js runs "xdg-mime default Postman.desktop
# x-scheme-handler/postman" on every launch, and any other name leaves that pointing
# at a file that does not exist, which breaks postman:// deep links in silence.
postman_desktop() {
    local directory=$1 binary=$2 file
    file="$directory/Postman.desktop"
    printf '%s\n' \
        '[Desktop Entry]' \
        'Type=Application' \
        'Version=1.0' \
        'Name=Postman' \
        'GenericName=API Platform' \
        'Comment=Build, test and document APIs' \
        "Exec=$app_root/current/$binary %u" \
        'Icon=postman' \
        'Terminal=false' \
        'StartupWMClass=Postman' \
        'Categories=Development;IDE;' \
        'MimeType=x-scheme-handler/postman;' > "$file"
    printf '%s' "$file"
}
# Installs one downloaded archive under one version name. The executable's path comes
# out of the archive's own listing: tar prints directories with a trailing slash, so a
# name matching without one is a file. A top-level Postman/Postman wins over a nested
# one, and an archive naming neither gets no menu entry pointing into thin air.
install_archive() {
    local archive=$1 version=$2 listing binary
    if ! listing=$(tar -tf "$archive" 2>/dev/null); then
        printf 'The download is not a readable archive, so %s was not touched.\n' "$app_root" >&2
        failed+=("postman download is not a readable tar archive")
        return 1
    fi
    binary=$(printf '%s\n' "$listing" | grep -E '^Postman/[Pp]ostman$' | head -n 1 || true)
    [[ -n "$binary" ]] ||
        binary=$(printf '%s\n' "$listing" | grep -E '^Postman/[^/]+/[Pp]ostman$' | head -n 1 || true)
    if [[ -z "$binary" ]]; then
        printf 'The archive lists no Postman executable, so the menu entry would run nothing.\n' >&2
        failed+=("postman executable missing from the archive")
        return 1
    fi
    install_tarball_app postman "$archive" "$version" "$expect_entry" \
        "$(postman_desktop "$(dirname -- "$archive")" "${binary#Postman/}")"
}
runtime_packages=()
map_group_packages "$map" postman "$release" runtime_packages
if (( ${#runtime_packages[@]} )); then
    printf '\nElectron runtime libraries, from the package map\n  %s\n' "${runtime_packages[*]}"
    printf 'ldd on the bundled binary reports 26 missing sonames without them, and\n'
    printf 'desktop-file-utils is what refreshes the menu database afterwards.\n'
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
    printf 'Menu entry: %s/applications/Postman.desktop. That basename is load-bearing:\n' "$share_root"
    printf 'Postman runs "xdg-mime default Postman.desktop x-scheme-handler/postman" itself on\n'
    printf 'every launch, so renaming it breaks postman:// links, OAuth sign-in among them.\n'
    printf 'Not verified here: nothing checked that these bytes are the ones Postman built,\n'
    printf 'because Postman publishes neither a checksum nor a signature to check them against\n'
    printf '— only the tar listing was verified. Also unverified: that the GUI starts, that the\n'
    printf 'postman:// registration takes, that Ubuntu 26.04 lets this Electron sandbox use\n'
    printf 'unprivileged user namespaces, and the menu icon, which is left to the icon theme\n'
    printf 'because the archive icon path has never been confirmed.\n'
    printf 'Run this script again to update; the previous version stays under %s.\n' "$app_root"
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
if (( ${#runtime_packages[@]} )) && ask 'Install the Electron runtime libraries Postman needs?'; then
    attempt sudo apt-get update
    # attempt, not run: Ubuntu keeps part of this set outside main, and a machine
    # without those components must be told which step failed, not stopped mid-run.
    attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${runtime_packages[@]}"
fi
installed=$(readlink -- "$app_root/current" 2>/dev/null || true)
installed=${installed##*/}
if [[ -n "$installed" ]]; then
    printf '\nInstalled now: Postman %s\n' "$installed"
else
    printf '\nNo Postman is installed under %s yet.\n' "$app_root"
fi
printf 'The tarball is about 197 MiB over https; the version lookup before it is one request.\n'
if ask "Download Postman and install it into $app_root?"; then
    if "$dry_run"; then
        printf '  preview only: nothing fetched from %s and nothing written under %s\n' \
            "$channel_url" "$app_root"
    else
        temp=$(mktemp -d)
        archive="$temp/postman-linux64.tar.gz"
        version=''
        installed_now=false
        # The channel URL redirects to the version-pinned path, so the published
        # version is in a response header and the 197 MiB body is not fetched to read it.
        if try curl -fsSI --max-time 60 -o "$temp/channel-headers" -- "$channel_url"; then
            version=$(grep -oE '/version/[0-9]+(\.[0-9]+)+/' "$temp/channel-headers" |
                grep -oE '[0-9]+(\.[0-9]+)+' | tail -n 1 || true)
        fi
        if [[ -n "$version" ]]; then
            if [[ "$version" == "$installed" ]]; then
                printf 'Postman %s is the published version and is already installed; nothing downloaded.\n' \
                    "$version"
            elif try curl -fL --max-time 1800 -o "$archive" -- \
                "https://dl.pstmn.io/download/version/$version/linux64"; then
                if install_archive "$archive" "$version"; then installed_now=true; fi
            fi
        else
            # No version from the channel is not evidence of being up to date, and
            # reporting it as such would freeze this machine on an old build forever.
            # So the bytes decide: the directory is named after the archive's own digest,
            # and the same download twice is recognised without trusting a version string.
            printf 'The channel named no version, so the archive itself is downloaded and compared.\n'
            if try curl -fL --max-time 1800 -o "$archive" -- "$channel_url"; then
                version="stable-$(sha256sum -- "$archive" | cut -c1-12)"
                if [[ -d "$app_root/$version" ]]; then
                    printf 'These are the bytes already installed as %s, so nothing was replaced.\n' "$version"
                else
                    if install_archive "$archive" "$version"; then installed_now=true; fi
                fi
            fi
        fi
        rm -rf -- "$temp"
        if "$installed_now" && command -v update-desktop-database >/dev/null; then
            attempt sudo update-desktop-database -- "$share_root/applications"
        fi
    fi
fi
finished=true
