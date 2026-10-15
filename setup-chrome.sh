#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Google Chrome, from Google's own apt repository, on Debian 13 and Ubuntu 26.04.
# It is the only route: the branded browser is in neither archive, and installing the
# .deb by hand does not avoid the repository either, because Chrome's postinst carries
# its own copy of it. So consent is the honest option, and this script asks for it.
# Chromium is deliberately out of scope in both directions: on Debian install.sh already
# offered the real chromium with the browser-files group, and on Ubuntu 26.04 there is no
# chromium package at all. Nothing here installs or removes one.
set -Eeuo pipefail
trap 'printf "Chrome setup stopped at line %s. Review the error above before retrying.\n" "${BASH_LINENO[0]:-$LINENO}" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-chrome.sh [--dry-run]\n'
        printf "Adds Google's apt repository and installs google-chrome-stable on Debian 13 or Ubuntu 26.04.\n"
        printf 'chromium is neither installed nor removed.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-chrome.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/chrome-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# arch=amd64 because that is the only architecture Google publishes, and the only one the
# route was proved on. Without it, every apt-get update on a machine with a foreign
# architecture enabled reports the missing arm64 index as an error of ours.
# signed-by, because a key in trusted.gpg.d would trust Google for every repository on
# the machine; this one is trusted for this one repository.
chrome_key=https://dl.google.com/linux/linux_signing_key.pub
chrome_line="deb [arch=amd64 signed-by=$etc_root/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main"
# A candidate, never an exit status: apt-cache may be absent or the package unindexed,
# and under pipefail that would end the run instead of answering the question.
chrome_candidate() {
    apt-cache policy -- google-chrome-stable 2>/dev/null | awk '/Candidate:/{print $2; exit}' || true
}
printf 'Google Chrome — the branded browser, from Google apt repository\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'Proved on 2026-10-15: google-chrome-stable 155.0.8059.79-1 on both releases. apt\n'
printf 'installs whatever Google ships today, which is the point of a repository.\n'
case "$release" in
    debian)
        printf 'Debian 13 packages a real chromium, and install.sh already offered it with the\n'
        printf 'browser-files group: that build stays installed and untouched. Chrome is an\n'
        printf 'addition here, not a replacement for it.\n' ;;
    *)
        printf 'Ubuntu 26.04 has no chromium package at all: its chromium-browser is a debconf\n'
        printf "stub that fetches Canonical's snap. So Chrome is the Chromium-family browser\n"
        printf 'offered here, and this script installs no snap.\n' ;;
esac
# dpkg-query is how a re-run tells "already installed" from "never installed", and a
# machine missing it is not a reason to refuse: the question is informational.
installed=
if command -v dpkg-query >/dev/null; then
    installed=$(dpkg-query -W -f='${Version}' google-chrome-stable 2>/dev/null || true)
fi
if [[ -n "$installed" ]]; then
    printf '\ngoogle-chrome-stable %s is already installed. Adding the repository is what keeps\n' "$installed"
    printf 'it updated; installing again upgrades it to the current candidate.\n'
fi
# The map's chrome group is one pointer row, so there is nothing installable to read from
# it today. Anything installable added there later is an archive package Chrome wants, and
# it is installed alongside rather than silently dropped.
map_group_packages "$map" chrome "$release" chrome_packages
packages=(google-chrome-stable)
(( ${#chrome_packages[@]} == 0 )) || packages+=("${chrome_packages[@]}")
if (( ${#unavailable[@]} )); then
    printf '\nNot in either archive, which is why this script exists: %s\n' "${unavailable[*]}"
fi
if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    # Tolerated, not fought: both of these are Chrome's, they come back on their own, and
    # a user who does not expect them reads them as damage.
    printf 'Chrome maintains its own apt configuration whatever this script does. Its postinst\n'
    printf 'writes /etc/apt/sources.list.d/google-chrome.list and /usr/share/keyrings/google-chrome.gpg,\n'
    printf 'and /etc/cron.daily/google-chrome checks that configuration every day. So apt may\n'
    printf 'show this repository twice — once from Google file, once from the one added here —\n'
    printf 'and a sources file deleted by hand comes back while the package is installed.\n'
    printf 'Removing google-chrome-stable is what ends both; nothing here tries to.\n'
    printf 'chromium is untouched on both releases: this script never installs or removes it.\n'
    printf 'Not verified by this repository, in a container or here: that Chrome launches on\n'
    printf 'this machine. The repository, the key and the dependency resolution were proved;\n'
    printf 'the GPU, Wayland or XWayland, Widevine and the sandbox were not, and cannot be\n'
    printf 'until you start it from a desktop session.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
printf '\nGoogle apt repository\n'
printf '  %s\n' "$chrome_line"
printf '  key: %s\n' "$chrome_key"
printf 'Trusting it lets Google push browser updates to this machine through apt. Only this\n'
printf 'repository carries google-chrome-stable; there is no route that avoids it.\n'
repo_ready=false
if ask "Add Google's apt repository and trust its signing key?"; then
    # Not attempt: the install step below depends on whether this one worked, and
    # add_vendor_repo already records its own failure and removes what it half-wrote.
    if add_vendor_repo google-chrome "$chrome_key" "$chrome_line" google-chrome-stable; then
        repo_ready=true
    else
        printf 'The repository was not added, so there is nothing to install from it.\n' >&2
    fi
else
    declined+=("Google's apt repository")
fi
# A machine that has had Chrome before already carries Google's own sources file, so the
# package can be available with nothing added by this run. A preview asks regardless: it
# runs no apt-cache, and refusing to show the step would hide half the script.
if ! "$repo_ready" && ! "$dry_run"; then
    available=$(chrome_candidate)
    if [[ "$available" =~ ^[0-9] ]]; then
        printf '\napt already offers google-chrome-stable %s from a sources file this run did not\n' "$available"
        printf "write, which is Chrome's own repository configuration. The step below uses it.\n"
        repo_ready=true
    fi
fi
if "$repo_ready" || "$dry_run"; then
    printf '\nPackages: %s\n' "${packages[*]}"
    # attempt, not run: Ubuntu keeps several archive packages in universe, apt can fail for
    # reasons that have nothing to do with this repository, and install.sh reaches this
    # script through attempt — a hard exit here would cost the user the closing summary.
    if ask 'Install them now?'; then
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
    else
        declined+=("${packages[*]}")
    fi
else
    printf '\ngoogle-chrome-stable comes from that repository alone, so nothing is installed.\n'
fi
finished=true
