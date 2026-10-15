#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# DBeaver CE from dbeaver.io, which is the only route: the name exists in neither
# Debian 13 nor Ubuntu 26.04, which is why its map row is a where=none pointer at
# this script rather than an apt name.
set -Eeuo pipefail
trap 'printf "DBeaver setup stopped at line %s. Review the error above before retrying.\n" "${BASH_LINENO[0]:-$LINENO}" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-dbeaver.sh [--dry-run]\n'
        printf 'Adds the DBeaver CE apt repository on Debian 13 or Ubuntu 26.04 and installs dbeaver-ce.\n'
        printf 'Both steps ask first, and declining either changes nothing.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-dbeaver.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
# Nothing here replaces a configuration file, so nothing is ever backed up. The path
# exists because the shared closing summary prints it either way.
backup_dir="$HOME/.local/state/debian-desktop-setup/dbeaver-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# A flat repository: the sources line ends in a bare slash and names no suite and no
# component, because dbeaver.io/debs/dbeaver-ce/dists/ does not exist. signed-by ties
# the line to this repository's own keyring, so trusting DBeaver trusts nothing else.
# $etc_root is empty outside the tests, where it prefixes both paths into a scratch tree.
repo_id=dbeaver
repo_package=dbeaver-ce
repo_line="deb [signed-by=$etc_root/etc/apt/keyrings/$repo_id.gpg] https://dbeaver.io/debs/dbeaver-ce /"
# Overridable because this URL is the one fact about this subject the container
# evidence did not record: it proved the repository, the candidate and the package,
# not the path the armoured key is served from. A wrong URL here is a failed fetch,
# which add_vendor_repo answers by changing nothing at all.
repo_key=${DEBIAN_SETUP_DBEAVER_KEY:-https://dbeaver.io/debs/dbeaver.gpg.key}
printf 'DBeaver CE setup — the vendor apt repository at dbeaver.io\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'Neither Debian 13 nor Ubuntu 26.04 packages %s, and DBeaver publishes one\n' "$repo_package"
printf 'repository for both: %s\n' "$repo_line"
printf 'It carried %s 26.2.2 on 2026-10-15; the repository may well have moved on since.\n' "$repo_package"
# The pointer row is the reason this script exists, so it is printed from the map
# rather than restated here: if the map ever grows an installable dbeaver row, this
# names it instead of silently disagreeing with the installer.
map_group_packages "$map" "$repo_id" "$release" dbeaver_packages
if (( ${#unavailable[@]} )); then printf '\nNot in either archive: %s\n' "${unavailable[*]}"; fi
if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
installed=$(dpkg-query -W -f='${Version}' "$repo_package" 2>/dev/null || true)
if [[ -n "$installed" ]]; then
    printf '\n%s %s is already installed. Adding the repository makes it an ordinary\n' \
        "$repo_package" "$installed"
    printf 'apt upgrade from here on, rather than a download to repeat by hand.\n'
fi
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    # The .deb declares no Depends at all, so apt and dpkg will never report the
    # libraries DBeaver's SWT interface loads. Saying nothing here would leave the
    # user to discover it as a window that does not open.
    printf 'The %s package declares no Depends, so apt cannot pull in the GTK 3 libraries\n' "$repo_package"
    printf 'its interface loads. On this machine they come with the desktop groups install.sh\n'
    printf 'offers; on a bare server dpkg would report nothing wrong and DBeaver would fail at\n'
    printf 'first launch instead.\n'
    printf 'Not verified by this script: that the interface starts. The package installs and\n'
    printf 'its bundled jre/bin/java reports Temurin 25.0.4.1, but SWT needs libgtk-3.so.0 and\n'
    printf 'a display, and neither was available where that was checked.\n'
    printf 'The package ships its own desktop entry, so the Rofi launcher finds it after a login.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
# add_vendor_repo records its own failure in failed[] on every path it can fail on,
# so it is called bare rather than through try: try would record the same failure a
# second time and the summary would name one broken step twice.
repo_live=false
printf '\nAdding the repository puts this machine on DBeaver'"'"'s update schedule: apt will offer\n'
printf 'their builds from here on. The key is fetched first and the sources file only after it\n'
printf 'lands, and if the repository cannot then be verified both are removed again.\n'
if ask "Add the DBeaver CE repository and its signing key from $repo_key?"; then
    if add_vendor_repo "$repo_id" "$repo_key" "$repo_line" "$repo_package"; then
        repo_live=true
    else
        printf 'The repository was not added, so there is nothing to install %s from.\n' "$repo_package" >&2
        printf 'If the key URL above is wrong, rerun with DEBIAN_SETUP_DBEAVER_KEY set to the right one.\n' >&2
    fi
else
    declined+=("the DBeaver CE repository")
    printf 'No repository, and %s is in neither archive, so nothing can be installed.\n' "$repo_package"
fi
if "$repo_live"; then
    # attempt, not run: a failed install must still reach the summary, which is the
    # only place the GTK 3 caveat and the unverified interface are said.
    if ask "Install $repo_package now?"; then
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "$repo_package"
    else
        declined+=("$repo_package")
    fi
fi
finished=true
