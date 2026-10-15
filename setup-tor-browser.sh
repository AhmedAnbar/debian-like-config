#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Tor Browser from the upstream signed tarball. There is no download path here: every
# torproject.org host answered "curl: (6) Could not resolve" from this machine, so the
# bytes arrive over ssh from the alias "vps", or from a directory you filled yourself.
# The signature is what makes that acceptable, and gpg --verify needs no network.
set -Eeuo pipefail
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "${BASH_LINENO[0]:-$LINENO}" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
from_dir=
remote_path=
key_file=
# The expected entry inside the tarball, which is also the Exec line below. The recon
# could not reach the distribution host, so the archive's internal layout is the one
# thing about it that is unproved: a wrong guess here refuses the install instead of
# unpacking something unexpected, and this option is the way past a layout that moved.
expect='Browser/start-tor-browser'
# The Tor Project signing key. Printed everywhere it matters, because a fingerprint
# the user never sees is a fingerprint the user cannot check.
fingerprint=EF6E286DDA85EA2A4BA7DE684E2C6E8793298290
usage() {
    printf 'Usage: bash setup-tor-browser.sh [--dry-run] [--from-dir <dir>]\n'
    printf '                                 [--remote-path <path>] [--key <file>] [--expect <entry>]\n'
    printf '\n'
    printf 'Installs Tor Browser from the upstream signed tarball into /opt/tor-browser.\n'
    printf 'Nothing is downloaded: the tarball and its .asc are staged, then verified\n'
    printf 'against %s offline.\n' "$fingerprint"
    printf '\n'
    printf '  --dry-run            show every step and write nothing at all\n'
    printf '  --from-dir <dir>     verify and install the tarball and .asc already in <dir>,\n'
    printf '                       with no network used at any point\n'
    printf '  --remote-path <path> the tarball on the remote machine; asked for when omitted\n'
    printf '  --key <file>         the signing key as a file, when it is not in your keyring\n'
    printf '  --expect <entry>     the path inside the archive that proves it is Tor Browser\n'
    printf '                       (default: %s)\n' "$expect"
    printf '\n'
    printf 'The staging route names one ssh alias, "vps", and nothing else: no host, user,\n'
    printf 'port or address appears anywhere in this repository. Write the block yourself in\n'
    printf '~/.ssh/config before using it, and check that "ssh vps true" works:\n'
    printf '\n'
    printf '  Host vps\n'
    printf '      HostName <your machine>\n'
    printf '      User <your login>\n'
    printf '      Port <your ssh port>\n'
    printf '      IdentityFile ~/.ssh/<your key>\n'
}
while (( $# )); do
    case "$1" in
        --dry-run) dry_run=true ;;
        --from-dir)
            from_dir=${2:-}
            [[ -n "$from_dir" ]] || { printf -- '--from-dir needs a directory.\n' >&2; exit 2; }
            shift ;;
        --remote-path)
            remote_path=${2:-}
            [[ -n "$remote_path" ]] || { printf -- '--remote-path needs a path.\n' >&2; exit 2; }
            shift ;;
        --key)
            key_file=${2:-}
            [[ -n "$key_file" ]] || { printf -- '--key needs a file.\n' >&2; exit 2; }
            shift ;;
        --expect)
            expect=${2:-}
            [[ -n "$expect" ]] || { printf -- '--expect needs an entry.\n' >&2; exit 2; }
            shift ;;
        --help|-h) usage; exit 0 ;;
        *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
    esac
    shift
done
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-tor-browser.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/tor-browser-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
printf 'Tor Browser setup — the upstream signed tarball, staged over ssh\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf '\n'
printf 'dist.torproject.org does not resolve from this machine, so this script downloads\n'
printf 'nothing. The tarball and its .asc come from the ssh alias "vps", or from a\n'
printf 'directory you already filled: --from-dir <dir>, which uses no network at all.\n'
printf 'Both routes end in the same check: gpg --verify against the Tor Project key\n'
printf '%s, which works offline, before anything is unpacked.\n' "$fingerprint"
printf 'The torbrowser-launcher package is not used: Debian contrib ships a key that\n'
printf 'expired in 2025, Ubuntu universe one expiring this month, and neither can be fed\n'
printf 'from disk — it insists on reaching torproject.org on first run.\n'
finished=false
work=
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    # The tarball is 131 MiB, and leaving it in /tmp after the install helps nobody.
    [[ -z "$work" || ! -d "$work" ]] || rm -rf -- "$work"
    summary_prologue
    printf 'Tor Browser lives in %s/tor-browser/<version>, with current pointing at the newest.\n' "$opt_root"
    printf 'Re-running this script with a newer tarball is the update path; the previous\n'
    printf 'version stays where it is, so a bad update is one symlink away from undone.\n'
    printf 'Not verified here: the layout inside the archive (%s), because no\n' "$expect"
    printf 'torproject.org host is reachable from this machine. The signature and the version\n'
    printf 'in the filename are what this script proves; pass --expect if a refusal names it.\n'
    printf 'No icon file ships with this script, so your launcher may show a generic one.\n'
    printf 'Whether the "vps" alias has these files at all is between you and that machine.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
# Verifies the signature in $1 and installs what it covers. A function rather than a
# nest of conditions because every single gate here ends the step: not one of them may
# fall through to the extraction at the bottom.
verify_and_install() {
    local directory=$1 tarball signature base version keyring key_source desktop
    local tarballs=()
    mapfile -t tarballs < <(find "$directory" -maxdepth 1 -type f -name '*.tar.xz' | sort)
    if (( ${#tarballs[@]} != 1 )); then
        printf 'Expected exactly one *.tar.xz in %s, found %s.\n' "$directory" "${#tarballs[@]}" >&2
        failed+=("one tarball in $directory")
        return 1
    fi
    tarball=${tarballs[0]}
    signature="$tarball.asc"
    if [[ ! -f "$signature" ]]; then
        printf 'No signature beside the tarball: %s is missing, so nothing is unpacked.\n' "$signature" >&2
        failed+=("signature for $tarball")
        return 1
    fi
    base=$(basename -- "$tarball")
    # The filename is the only place the version is written down: the archive itself
    # does not carry one, and a guessed number would mislabel the directory in /opt.
    version=$(printf '%s\n' "$base" | sed -nE 's/.*-([0-9]+(\.[0-9]+)+).*/\1/p')
    if [[ -z "$version" ]]; then
        printf 'No version in the filename %s, so the install directory cannot be named.\n' "$base" >&2
        failed+=("version from $base")
        return 1
    fi
    printf '\nVerifying %s (version %s)\n' "$base" "$version"
    work=${work:-$(mktemp -d)}
    keyring="$work/keyring"
    run install -d -m 700 -- "$keyring"
    if [[ -n "$key_file" ]]; then
        if [[ ! -f "$key_file" ]]; then
            printf 'No such key file: %s\n' "$key_file" >&2
            failed+=("key file $key_file")
            return 1
        fi
        key_source=$key_file
    elif gpg --list-keys -- "$fingerprint" >/dev/null 2>&1; then
        key_source="$work/tor-project.gpg"
        try gpg --batch --export -o "$key_source" -- "$fingerprint" || return 1
    else
        printf 'The Tor Project key %s is not in your keyring.\n' "$fingerprint" >&2
        printf 'The recon took that key from keys.openpgp.org (39 452 bytes). Import it by\n' >&2
        printf 'whatever route you trust, or pass --key <file>, and run this again. Nothing\n' >&2
        printf 'is unpacked without a verified signature.\n' >&2
        failed+=("signing key $fingerprint")
        return 1
    fi
    # A keyring holding only this one key, so a clean gpg --verify can mean nothing
    # except that this key signed the tarball. Your own keyring holds other keys, and
    # verify's exit status alone would not say which of them made the signature.
    try gpg --homedir "$keyring" --batch --import -- "$key_source" || return 1
    if ! try gpg --homedir "$keyring" --batch --list-keys -- "$fingerprint"; then
        printf 'That key is not %s, so it cannot be the one to verify against.\n' "$fingerprint" >&2
        return 1
    fi
    if ! try gpg --homedir "$keyring" --batch --verify -- "$signature" "$tarball"; then
        printf 'The signature does not verify. Nothing was unpacked and Tor Browser was not\n' >&2
        printf 'installed: a tarball that fails this check is not Tor Browser, whatever it is.\n' >&2
        return 1
    fi
    printf 'Signature verified against %s.\n' "$fingerprint"
    if ! ask "Unpack Tor Browser $version into $opt_root/tor-browser?"; then
        declined+=("unpacking $base")
        return 0
    fi
    # Written here rather than shipped as a file, because its Exec line has to follow
    # whatever --expect says the entry point is.
    desktop="$work/tor-browser.desktop"
    {
        printf '[Desktop Entry]\n'
        printf 'Type=Application\n'
        printf 'Name=Tor Browser\n'
        printf 'Comment=Browse the web over the Tor network\n'
        printf 'Exec=%s/tor-browser/current/%s\n' "$opt_root" "$expect"
        printf 'Icon=tor-browser\n'
        printf 'Terminal=false\n'
        printf 'Categories=Network;WebBrowser;Security;\n'
        printf 'StartupWMClass=Tor Browser\n'
    } > "$desktop"
    install_tarball_app tor-browser "$tarball" "$version" "$expect" "$desktop"
}
tor_packages=()
map_group_packages "$map" tor "$release" tor_packages
if (( ${#tor_packages[@]} )); then
    printf '\nTor group packages\n  %s\n' "${tor_packages[*]}"
    printf 'gnupg verifies the tarball offline; xz-utils unpacks it.\n'
    if ask 'Install these with apt?'; then
        # attempt, not run: on Ubuntu several packages in this repository come from
        # universe, and an apt failure here must still leave a summary behind.
        attempt sudo apt-get update
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${tor_packages[@]}"
    else
        declined+=("${tor_packages[*]}")
    fi
fi
if (( ${#unavailable[@]} )); then printf 'Not packaged on %s: %s\n' "$family" "${unavailable[*]}"; fi
if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
stage_dir=
if [[ -n "$from_dir" ]]; then
    printf '\n--from-dir %s: no network is used at any point.\n' "$from_dir"
    if [[ ! -d "$from_dir" ]]; then
        printf 'Not a directory: %s\n' "$from_dir" >&2
        failed+=("--from-dir $from_dir")
    elif ask "Verify and install the Tor Browser tarball in $from_dir?"; then
        if "$dry_run"; then
            printf '  preview only: would verify the .asc in %s and unpack nothing\n' "$from_dir"
        else
            stage_dir=$from_dir
        fi
    else
        declined+=("$from_dir")
    fi
else
    printf '\nStaging over ssh. This repository names one alias, "vps", and nothing else:\n'
    printf 'write your own Host vps block in ~/.ssh/config, as --help shows.\n'
    if ask 'Copy the tarball and its signature from the ssh alias "vps" now?'; then
        if [[ -z "$remote_path" ]]; then
            read -r -p 'Remote path of the tarball on vps: ' remote_path || remote_path=
        fi
        if [[ -z "$remote_path" ]]; then
            printf 'No remote path given, so nothing was copied.\n' >&2
            failed+=('remote path of the tarball')
        elif "$dry_run"; then
            printf '  preview only: would check the alias, then copy %s and its .asc\n' "$remote_path"
        # A probe, not a step: an alias nobody has configured yet is an ordinary
        # outcome here. BatchMode stops ssh asking for a password nobody is watching
        # for, and the timeout stops a name that does not resolve from hanging the run.
        elif ! run ssh -o BatchMode=yes -o ConnectTimeout=5 vps true; then
            printf '\nThe ssh alias "vps" did not answer, so Tor Browser is skipped and nothing\n'
            printf 'was changed. Check your Host vps block and that "ssh vps true" works, or\n'
            printf 'stage the files by hand and use --from-dir <dir>.\n'
            finished=true
            exit 0
        else
            work=$(mktemp -d)
            # Both files in one copy: a tarball whose signature did not arrive is of
            # no use, and this way that is one failure rather than two.
            if try scp -- "vps:$remote_path" "vps:$remote_path.asc" "$work/"; then
                stage_dir=$work
            else
                printf 'The copy from "vps" failed, so there is nothing to verify.\n' >&2
            fi
        fi
    else
        declined+=('staging from the vps alias')
    fi
fi
if [[ -n "$stage_dir" ]]; then
    verify_and_install "$stage_dir" || true
fi
finished=true
