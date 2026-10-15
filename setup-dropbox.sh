#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Dropbox from Dropbox's own apt repository (dropbox 2026.09.28, observed 2026-10-15).
# Not from the release archives: neither resolves the name dropbox to any version at all
# (their 2019 frontend is nautilus-dropbox), so the package is installed only after a
# numeric candidate proves the vendor repository, and not something else, answered.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Dropbox setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-dropbox.sh [--dry-run]\n'
        printf "Adds Dropbox's apt repository and installs the frontend on Debian 13 or Ubuntu 26.04.\n"
        printf 'The proprietary sync daemon is not fetched here: run dropbox start -i once from a\n'
        printf 'desktop session afterwards.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-dropbox.sh with its lib folder.\n' >&2; exit 1; }
# No configuration file is installed by this script, but summary_prologue names the
# backup directory and install_file defaults to target_config, so both are set here as
# every other script sets them rather than left for set -u to trip over.
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/dropbox-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# This URL and no other. The same fingerprint fetched from a keyserver is SHA1-bound:
# Debian 13's sqv rejects it, and from then on every apt-get update exits 100 — including
# the deliberately fatal one in install.sh, which would leave the machine unable to
# install anything until someone finds this file. The Fedora path is where Dropbox
# publishes the armoured key that apt 3.0.3 and apt 3.2.0 both accept.
key_url=https://linux.dropbox.com/fedora/rpm-public-key.asc
keyring="${etc_root}/etc/apt/keyrings/dropbox.gpg"
sources_file="${etc_root}/etc/apt/sources.list.d/dropbox.list"
# One suite per release, and the path component carries the same name. A derivative that
# detect_release resolved to its parent is offered the parent's suite, because those two
# are the only ones Dropbox publishes.
case "$release" in
    debian) suite=trixie ;;
    ubuntu) suite=resolute ;;
esac
# arch=amd64 because Dropbox publishes i386 and amd64 only. Without it apt asks for the
# machine's own architecture index, and on anything else that 404 fails every update.
sources_line="deb [arch=amd64 signed-by=$keyring] https://linux.dropbox.com/$release $suite main"
printf 'Dropbox setup — the vendor apt repository and the frontend package\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'Repository: %s\n' "$sources_line"
printf 'Key:        %s\n' "$key_url"
printf 'That package is only the frontend. The sync client itself is a proprietary daemon\n'
printf 'of about 91 MB that Dropbox downloads outside apt, into your home directory, the\n'
printf 'first time you start it. This script never downloads or starts it.\n'
printf 'amd64 only: Dropbox publishes no arm64 packages for either release.\n'
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    printf 'Dropbox is not syncing yet, and no script can finish this part for you.\n'
    printf 'From inside a desktop session, run once: dropbox start -i\n'
    printf 'It downloads the daemon, then opens a browser to link the account.\n'
    printf 'Run from here it would do nothing instead: with no terminal to answer its prompt it\n'
    printf 'dies on EOFError, a bare except swallows that, and the process still exits 0 — a\n'
    printf 'failure neither you nor this script could see.\n'
    printf 'Not verified by this run: that the daemon downloads, runs, verifies its signature or\n'
    printf 'links an account, and that the tray icon appears in i3 or Sway.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
printf '\nThe repository and the frontend\n'
printf 'Accepting writes %s and %s, then installs the dropbox package.\n' "$keyring" "$sources_file"
printf "The package's own postinst would otherwise replace that sources file with its own over\n"
printf 'plain http, install a second keyring, and delete ~/.dropbox-dist from every home below\n'
printf 'version 2.10. An empty %s/etc/default/dropbox-repo stops all three, and is written\n' "${etc_root}"
printf 'before the install rather than after it.\n'
if ask 'Add the Dropbox repository and install the frontend?'; then
    # The branch is the point: on failure add_vendor_repo has already removed the key and
    # the sources file and recorded the step. Verified 2026-10-15 in both release
    # containers: apt-cache policy dropbox reports Candidate: (none) with no vendor
    # repository, so a numeric candidate cannot come from anywhere but this repository.
    if add_vendor_repo dropbox "$key_url" "$sources_line" dropbox; then
        guard="${etc_root}/etc/default/dropbox-repo"
        guard_ready=true
        if [[ -e "$guard" ]]; then
            printf '%s already exists, so the postinst will leave apt alone.\n' "$guard"
        else
            # try, not attempt: the install below depends on this having worked. Without
            # the guard the postinst replaces the sources file this run just wrote with
            # its own over plain http, adds a second keyring, and rm -rf's any
            # ~/.dropbox-dist below version 2.10. Installing anyway would undo the
            # repository this run configured, and do it unauthenticated.
            try sudo install -Dm644 -- /dev/null "$guard" || guard_ready=false
        fi
        if "$guard_ready"; then
            # Its own transaction, never one shared with the supporting package below: a
            # name apt cannot resolve fails the whole transaction it is named in, and on
            # Ubuntu that can be a universe package on a machine with universe disabled.
            attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y dropbox
        else
            printf 'Could not write %s, so dropbox was not installed.\n' "$guard" >&2
            printf 'Its postinst would have replaced the repository this run just added with\n' >&2
            printf 'its own over plain http, and added a second keyring. The repository is\n' >&2
            printf 'configured and verified; install the package once that file can be written.\n' >&2
        fi
    else
        printf 'Nothing was installed, because the repository is not live.\n' >&2
        printf 'Neither release packages dropbox itself, so there is nothing to fall back to.\n' >&2
        printf 'The nautilus-dropbox in the archives is the 2019 frontend; installing that would\n' >&2
        printf 'look like success and sync nothing.\n' >&2
    fi
else
    declined+=('the Dropbox repository and the dropbox package')
fi
map_group_packages "$map" dropbox "$release" support_packages
if (( ${#support_packages[@]} )); then
    printf '\nSignature verification for the daemon\n  %s\n' "${support_packages[*]}"
    printf 'The frontend checks the signature of the daemon it downloads only when this is\n'
    printf 'installed. Without it the frontend prints that it will not verify, and runs the blob\n'
    printf 'anyway. It is needed before the first dropbox start -i, not before the package.\n'
    if ask "Install ${support_packages[*]}?"; then
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${support_packages[@]}"
    else
        declined+=("${support_packages[*]}")
    fi
fi
# unavailable[] is not printed here: the only row that fills it in this group is the
# pointer row naming this script, and reporting dropbox as "not packaged" directly under
# the step that just installed it from the vendor repository would contradict it.
if (( ${#skipped[@]} )); then printf '\nSkipped on %s: %s\n' "$family" "${skipped[*]}"; fi
finished=true
