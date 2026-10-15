#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# ONLYOFFICE Desktop Editors from the vendor repository, which is the only route
# that carries 10.0.0: neither Debian 13 nor Ubuntu 26.04 packages the editors at
# all, and the snap and the flatpak were both still on 9.4.0 when this was probed
# (phase 3 recon, 2026-10-15). One repository serves both releases.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "ONLYOFFICE setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-onlyoffice.sh [--dry-run]\n'
        printf 'Adds the pinned ONLYOFFICE apt repository and installs the Desktop Editors.\n'
        printf 'Debian 13 and Ubuntu 26.04 share one vendor suite. Every step asks first.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-onlyoffice.sh with its lib folder.\n' >&2; exit 1; }
# No configuration file of this repository's is installed here, but summary_prologue
# names the backup directory and install_file would use it if a later step needs one.
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/onlyoffice-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
package=onlyoffice-desktopeditors
# etc_root is lib/common.sh's test seam and is empty on a real machine, so the
# signed-by path in the sources line is the keyring add_vendor_repo installs and
# stays consistent when a test points both at a scratch directory.
keyring="$etc_root/etc/apt/keyrings/onlyoffice.gpg"
preferences="$etc_root/etc/apt/preferences.d/onlyoffice"
# The recon proved one suite, squeeze, for both releases; the vendor publishes no
# per-release suite. arch=amd64 is the only architecture the evidence covers.
sources_line="deb [arch=amd64 signed-by=$keyring] https://download.onlyoffice.com/repo/debian squeeze main"
# The recon recorded the host, the suite and the candidate, but not the key's own URL.
# tests/vendor-container-smoke.js now proves this one: it reads the URL out of this
# script, fetches it and verifies the repository and its pin against it in both
# releases. Overridable rather than hidden, because a vendor can move a key -- and if
# it 404s, add_vendor_repo removes everything it wrote and this run ends with a named
# failure, not a broken apt.
key_url=${DEBIAN_SETUP_ONLYOFFICE_KEY_URL:-https://download.onlyoffice.com/GPG-KEY-ONLYOFFICE}
printf 'ONLYOFFICE Desktop Editors — the vendor apt repository, pinned\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'Neither release packages the editors; this repository carried %s on 2026-10-15.\n' '10.0.0-169'
printf '  key:     %s\n' "$key_url"
printf '  sources: %s\n' "$sources_line"
printf '  pin:     %s\n' "$preferences"
printf 'The repository carries 308 stanzas over 71 names — DocSpace, Document Server, an\n'
printf 'XMPP server — and its ttf-mscorefonts-installer 3.8.2 outranks Debian contrib 3.8.1\n'
printf 'and Ubuntu multiverse 3.8.1ubuntu2. The pin is written before anything is installed.\n'
# Generated rather than shipped as a file in this repository: the names it holds
# down are the reason it exists, and they belong beside the sentence that explains
# them. A later version of the vendor repository is one re-run away from a new pin.
write_pin() {
    local file=$1
    {
        printf '# Written by setup-onlyoffice.sh. Remove this file to undo the pin.\n'
        printf '# This repository re-sources 71 package names that the distribution also\n'
        printf '# ships, so by default nothing from it outranks the distribution.\n'
        printf 'Package: *\n'
        printf 'Pin: origin download.onlyoffice.com\n'
        printf 'Pin-Priority: 100\n'
        printf '\n'
        printf '# Watched happening in apt-cache policy: the vendor 3.8.2 shadows Debian\n'
        printf "# contrib's 3.8.1 and Ubuntu multiverse's 3.8.1ubuntu2. The distribution's\n"
        printf '# copy must win. 1, not a negative priority, so that a machine with contrib\n'
        printf '# or multiverse disabled can still resolve the font dependency from here.\n'
        printf 'Package: ttf-mscorefonts-installer\n'
        printf 'Pin: origin download.onlyoffice.com\n'
        printf 'Pin-Priority: 1\n'
        printf '\n'
        printf '# The package this repository was added for exists in no other archive.\n'
        printf 'Package: %s\n' "$package"
        printf 'Pin: origin download.onlyoffice.com\n'
        printf 'Pin-Priority: 500\n'
    } > "$file"
}
# The map's onlyoffice group is a pointer row today, so this prints "not packaged"
# rather than offering anything; a later installable row is offered without an edit
# here. attempt, not run: the editors' font dependency is contrib on Debian and
# multiverse on Ubuntu, and a minimal install may have neither component enabled.
office_packages=()
map_group_packages "$map" onlyoffice "$release" office_packages
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
    if "$editors_absent"; then
        printf 'onlyoffice-desktopeditors was not installed: the repository was declined, or it\n'
        printf 'did not verify. Nothing from it is on this machine, and nothing was left behind.\n'
    fi
    printf 'What this run could not verify:\n'
    printf '  The editors were never started here: not the GUI, not file associations,\n'
    printf '  not Arabic shaping. Open one document before trusting the install.\n'
    printf '  The pin was designed from apt-cache policy output and never watched working.\n'
    printf '  Check it with: apt-cache policy ttf-mscorefonts-installer\n'
    printf '  The distribution version must be the candidate; if it is not, remove\n'
    printf '  %s and report it.\n' "$preferences"
    printf "  ttf-mscorefonts-installer shows a EULA, and this run accepted debconf's\n"
    printf '  defaults for it unattended; nothing here proved the fonts are on disk.\n'
    printf '  10.0.0-169 is a 2026-10-15 snapshot: apt-cache policy %s reports what you got.\n' "$package"
    # install.sh reaches this script through attempt, which keeps a bad run going;
    # without a non-zero exit the whole subject would collapse to one unexplained line.
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
repo_ready=false
editors_absent=false
if ask "Add the pinned ONLYOFFICE repository for $family?"; then
    pin=''
    if "$dry_run"; then
        printf 'Preview: no pin file is written. A real run writes %s\n' "$preferences"
        printf 'first, holding ttf-mscorefonts-installer and the other 70 shared names below\n'
        printf 'the distribution, and only then installs anything.\n'
    else
        pin=$(mktemp)
        write_pin "$pin"
    fi
    # Called bare, not through try or attempt: the helper already records its own
    # failure in failed[] on every path it can fail on, so try would name one broken
    # step twice — and try routes through run, which executes nothing under --dry-run,
    # so the helper's preview would never print.
    if add_vendor_repo onlyoffice "$key_url" "$sources_line" "$package" "$pin"; then
        repo_ready=true
    else
        printf 'The repository is not configured, so nothing will be installed from it.\n' >&2
    fi
    [[ -z "$pin" ]] || rm -f -- "$pin"
else
    declined+=('the ONLYOFFICE repository')
fi
if "$repo_ready"; then
    printf '\nThe editors are a 279 MB download and pull in roughly 386 further packages\n'
    printf '(350 newly installed on Debian, 342 on Ubuntu, in the 2026-10-15 simulation).\n'
    if ask "Install $package${office_packages[*]:+ and ${office_packages[*]}}?"; then
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y \
            "$package" ${office_packages[@]+"${office_packages[@]}"}
    else
        declined+=("$package")
    fi
elif ! "$dry_run"; then
    # Not skipped[]: that list is printed at offer time, from the map, before this is
    # known, so appending to it here would record this nowhere. The closing summary is
    # the only place left that the user still reads.
    editors_absent=true
fi
finished=true
