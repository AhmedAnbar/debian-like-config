#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
set -Eeuo pipefail
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "$LINENO" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
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
printf 'Debian desktop setup — packages, configuration and services\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE for redistribution terms.\n'
printf 'Detected %s (%s family); installing with apt.\n' "${distro_name:-$distro_id}" "$family"
printf 'Existing configuration files are backed up before replacement.\n'
