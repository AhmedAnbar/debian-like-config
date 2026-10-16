#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Herdr, the terminal multiplexer, from herdr.dev into ~/.local/bin, followed by the
# two configuration steps that make it behave the way this desktop expects: Ctrl+A as
# the prefix, and the workspace list in the tab row instead of the sidebar.
#
# Upstream publishes one bare executable and a shell installer, with no apt
# repository, no .deb and no signature over either, so the two review gates below are
# the only integrity control there is: the SHA-256 the installer checks comes from the
# same host that serves the installer, which makes it a transport check and not an
# independent one. Nothing here runs as root, because the upstream installer writes
# only inside HERDR_INSTALL_DIR and asks for nothing else.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
usage() {
    printf 'Usage: bash setup-herdr.sh [--dry-run]\n'
    printf '\n'
    printf 'Downloads the official installer from https://herdr.dev/install.sh for review,\n'
    printf 'then runs it as your normal user with HERDR_INSTALL_DIR=$HOME/.local/bin, and\n'
    printf 'offers the Ctrl+A prefix and the workspace tab row afterwards. An existing\n'
    printf 'herdr binary is left exactly as it is; only the configuration steps are offered.\n'
    printf '\n'
    printf '  --dry-run   show every step, download nothing and write nothing\n'
    printf '  --help, -h  print this text\n'
    printf '\n'
    printf 'Verified on 2026-10-16 from a debian:stable-slim container on the machine this\n'
    printf 'port was written on: herdr.dev/install.sh answered HTTP/2 200, the installer\n'
    printf 'placed herdr 0.9.5 in ~/.local/bin as a non-root user, and herdr --version\n'
    printf 'worked afterwards on Debian 13, Ubuntu 26.04 and Kali Rolling. The binary is\n'
    printf 'static-pie with no NEEDED entries, so no libc or compatibility package is\n'
    printf 'involved. The installer is neither signed nor served from a versioned URL, so\n'
    printf 'nothing about it can be pinned and both review prompts are worth answering.\n'
}
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h) usage; exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-herdr.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/herdr-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
install_dir="$HOME/.local/bin"
installer_url=https://herdr.dev/install.sh
status_source="$bundle_dir/config/herdr/workspaces-status.sh"
[[ -r "$status_source" ]] || { printf 'Missing %s; keep setup-herdr.sh with its config folder.\n' "$status_source" >&2; exit 1; }
# The two names this script may have to install come from the map, not from this file:
# curl, because the upstream installer gates itself on it, and jq, because the tab row
# cannot build its line without it. Both are absent from a minimal Debian 13,
# Ubuntu 26.04 and Kali Rolling image, measured on 2026-10-16.
curl_packages=()
jq_packages=()
map_named_packages "$map" "$release" curl_packages curl
map_named_packages "$map" "$release" jq_packages jq
printf 'Herdr — the terminal multiplexer, from herdr.dev into ~/.local/bin\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
finished=false
# The private directory this run downloads the installer into and writes the config
# validator wrapper into. It is cleaned up inside summary() below rather than by a
# trap of its own: a second "trap ... EXIT" replaces the first, and the one it would
# replace is the one that prints the summary. setup-tor-browser.sh removes its
# tarball from inside summary() for exactly this reason, and this script now has one
# EXIT trap like every other script here.
work=
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    # Only the two files this script put there, each by name, and the directory
    # itself only with rmdir: nothing it did not create can be caught by this.
    if [[ -n "$work" && -d "$work" ]]; then
        [[ ! -f "$work/install.sh" ]] || unlink -- "$work/install.sh"
        [[ ! -f "$work/herdr-config-gate" ]] || unlink -- "$work/herdr-config-gate"
        [[ ! -f "$work/herdr-config-gate.noted" ]] || unlink -- "$work/herdr-config-gate.noted"
        rmdir -- "$work" || :
    fi
    summary_prologue
    # Two backup locations, because they are written by two different things. This
    # script backs up what it installs through the repository's own helper; the two
    # configuration helpers are copied from the Arch repository byte for byte, and
    # they keep their copy beside the file they edit as config.toml.backup-<date>-<pid>.
    printf 'The two configuration helpers instead keep theirs beside the config, as\n'
    printf '%s/herdr/config.toml.backup-<date>-<pid>.\n' "$target_config"
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
# Creates the one private directory this run uses, at most once. mktemp gives it
# mode 700, so nothing else on this machine can read or replace the installer
# between the review and the moment it runs.
private_dir() {
    [[ -n "$work" ]] || work=$(mktemp -d -t debian-herdr.XXXXXXXX)
}
# Printed before the prompts, because a prompt is invisible to anything that is not a
# terminal: bash writes a read -p prompt only to a tty, so this is where a non
# interactive run -- a test, a pipe, a log -- learns which two steps were offered.
configuration_prologue() {
    printf '\nTwo configuration steps follow, and each one asks first: the Ctrl+A prefix, and\n'
    printf 'the workspace list in the tab row with the sidebar hidden. Both edit only the\n'
    printf 'keys they manage in %s/herdr/config.toml, and both keep a copy of whatever\n' "$target_config"
    printf 'they replaced.\n'
}
gate=
# Both configuration helpers validate with "herdr config check" and stop on a
# non-zero status, and herdr 0.9.5 exits 1 from that command on every diagnostic it
# has, not only on the ones that matter. Measured with the real binary in
# debian:stable-slim on 2026-10-16: a config.toml whose only oddity is a key this
# herdr does not know prints, on stdout,
#   config: issues found
#   unknown config key ui.future_option; ignoring key
# and exits 1 -- while herdr itself ignores that key and runs perfectly well with it.
# A config written by a newer herdr, or carrying a key herdr has since renamed, would
# therefore abort a run over something herdr accepts.
#
# A config that does not parse is the opposite case and must still stop everything,
# because nothing may be written into a file we cannot read. The same command tells
# the two apart on the same output: a parse error carries its own line,
#   config parse error: TOML parse error at line 2, column 19
# followed by the offending line and "; using defaults".
#
# So the keyed-on text is herdr's own "unknown config key <table>.<key>; ignoring
# key", and the rule is fail closed: the status is forgiven only when every line
# herdr printed is either that or the "config: issues found" heading above it.
# Anything else -- a parse error, a diagnostic a later herdr invents, a wording
# change in this one -- leaves the non-zero status alone and stops the run, which is
# the safe direction to be wrong in.
#
# This wrapper lives here, and not in the two helpers, because those are copied from
# the Arch repository byte for byte and scripts/sync-from-arch.sh --check compares
# them against it. They are handed its path where they expect the herdr executable,
# and they call it only as "config check".
herdr_gate() {
    [[ -z "$gate" ]] || return 0
    private_dir
    gate="$work/herdr-config-gate"
    export DEBIAN_SETUP_HERDR_BINARY="$existing"
    cat > "$gate" <<'GATE'
#!/bin/sh
# Written by setup-herdr.sh; the reasoning is in the comment above herdr_gate there.
if [ "${1:-}" = config ] && [ "${2:-}" = check ]; then
    output=$("$DEBIAN_SETUP_HERDR_BINARY" "$@" 2>&1)
    status=$?
    printf '%s\n' "$output"
    [ "$status" -eq 0 ] && exit 0
    remaining=$(printf '%s\n' "$output" \
        | grep -v '^config: issues found$' \
        | grep -v '^unknown config key .*; ignoring key$') || :
    [ -z "$remaining" ] || exit "$status"
    # Four config checks run per invocation of this script, two per helper, and the
    # same keys are unknown to all four. herdr's own lines are repeated because they
    # are the evidence; the explanation of them is printed once.
    if [ ! -e "$0.noted" ]; then
        : > "$0.noted"
        printf 'Those are keys this herdr does not recognise and says it is ignoring, so they\n'
        printf 'are not a reason to stop. Only the keys this step manages are rewritten, and\n'
        printf 'the unknown ones are left in the file untouched.\n'
    fi
    exit 0
fi
exec "$DEBIAN_SETUP_HERDR_BINARY" "$@"
GATE
    chmod 755 -- "$gate"
}
# Set the Herdr prefix to Ctrl+A and nothing else. The helper validates the file it
# staged with "herdr config check" before it replaces anything, and refuses a config
# it cannot edit safely rather than damaging it.
configure_prefix() {
    local config_path=${HERDR_CONFIG_PATH:-$target_config/herdr/config.toml}
    if ask 'Set the Herdr prefix to Ctrl+A, preserving other settings and backing up changes?'; then
        if "$dry_run"; then
            printf 'Would validate and update only keys.prefix in %s to ctrl+a.\n' "$config_path"
        else
            herdr_gate
            bash "$bundle_dir/scripts/configure-herdr-prefix.sh" "$config_path" "$gate"
        fi
    fi
}
# Hide the sidebar and put the workspace list in the tab row. The status script is a
# shell pipeline over "herdr workspace list", so it needs jq.
configure_ui() {
    local config_dir=$target_config/herdr
    local config_path=${HERDR_CONFIG_PATH:-$config_dir/config.toml}
    local status_path=$config_dir/workspaces-status.sh
    if ! command -v jq >/dev/null; then
        printf '\nThe workspace tab row turns "herdr workspace list" into one line with jq, and\n'
        printf 'jq is not installed here. It is absent from a minimal Debian 13, Ubuntu 26.04\n'
        printf 'and Kali Rolling image as well, and the apt package is named %s on all three.\n' \
            "${jq_packages[*]:-jq}"
        if ask "Update the package lists and install ${jq_packages[*]:-jq}?"; then
            # try, not attempt: an install against lists that could not be updated is
            # how a package resolves to nothing and takes the step down with a worse
            # message than the update's own.
            if try sudo apt-get update; then
                attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${jq_packages[@]:-jq}"
            else
                printf 'The package lists could not be updated, so nothing was installed.\n' >&2
            fi
        fi
        if ! "$dry_run" && ! command -v jq >/dev/null; then
            printf 'Without jq the tab row would print an empty string, so this step is being\n'
            printf 'skipped. Install it and run this script again: sudo apt-get install %s\n' \
                "${jq_packages[*]:-jq}"
            declined+=("the workspace tab row (no jq)")
            return 0
        fi
    fi
    if ask 'Hide the Herdr sidebar and list workspaces in the tab row instead?'; then
        if "$dry_run"; then
            printf 'Would install %s as %s with mode 755.\n' "$status_source" "$status_path"
            printf 'Would set only the [ui] sidebar and tab_bar_right keys in %s,\n' "$config_path"
            printf 'and only the [keys] workspace bindings.\n'
        else
            # install_file records a decline and returns 0, by design: a step that
            # keeps someone's file must not abort an installation. Here it has to
            # stop the rest of this step, because everything the tab row shows comes
            # out of that one file. Rewiring the config to execute a file this
            # repository did not write would make herdr run whatever happens to be
            # there, once a second, under this configuration's name -- and the
            # missing-jq branch above already shows the shape: record it and return
            # without editing the config.
            local before=${#declined[@]}
            install_file "$status_source" herdr/workspaces-status.sh 755
            if (( ${#declined[@]} > before )); then
                printf 'The tab row would have to execute that file once a second, so the\n'
                printf 'configuration was not rewired to run it and the sidebar was left visible:\n'
                printf 'hiding it without the tab row that replaces it would leave no workspace\n'
                printf 'list at all. Nothing in %s was changed by this step.\n' "$config_path"
                printf 'Move your own copy aside and run this script again to take the tab row.\n'
                declined+=("the workspace tab row (your own workspaces-status.sh was kept)")
                return 0
            fi
            herdr_gate
            bash "$bundle_dir/scripts/configure-herdr-ui.sh" "$config_path" "$gate" "$status_path"
        fi
    fi
}
# What a user sees once both steps have run, including the part that looks like a
# failure and is not.
closing_notes() {
    printf '\nThe tab row prints nothing at all until a herdr server exists: "herdr workspace\n'
    printf 'list" exits 1 with a server_not_running error before the first client starts, the\n'
    printf 'status script discards that on stderr, and the pipeline exits 0 with empty output.\n'
    printf 'That is what first launch looks like, and it cannot fill the tab bar with errors.\n'
    printf 'The bundled Zsh configuration already puts ~/.local/bin on PATH, so the PATH\n'
    printf 'warning the upstream installer prints does not apply to a shell started from it.\n'
    printf 'Open a new terminal and run herdr when ready; no server and no agents were\n'
    printf 'started here, and nothing in this script reloads a running client.\n'
}
existing=$(command -v herdr || :)
if [[ -x "$install_dir/herdr" ]]; then existing="$install_dir/herdr"; fi
if [[ -n "$existing" ]]; then
    printf '\nHerdr is already installed at %s; leaving the binary unchanged.\n' "$existing"
    printf 'Updating it is upstream business, and the installer would replace it in place.\n'
    if ! "$dry_run"; then "$existing" --version; fi
    configuration_prologue
    configure_prefix
    configure_ui
    closing_notes
    finished=true
    exit 0
fi
if [[ -e "$install_dir/herdr" || -L "$install_dir/herdr" ]]; then
    printf 'An existing non-executable file or broken symlink occupies %s/herdr. Leaving it unchanged.\n' \
        "$install_dir" >&2
    printf 'Remove or repair it yourself and run this script again: unlinking it here would be\n' >&2
    printf 'this script deciding what a file it did not create is worth.\n' >&2
    exit 1
fi
printf '\nSource: %s (upstream code, run as your user and never as root).\n' "$installer_url"
printf 'The installer fetches herdr.dev/latest.json, downloads the single linux-x86_64\n'
printf 'executable named there from github.com, checks its SHA-256 against that same\n'
printf 'manifest, and moves it into HERDR_INSTALL_DIR. Both hosts have to be reachable.\n'
printf 'On 2026-10-16 the manifest served version 0.9.5 and the installer itself was 4835\n'
printf 'bytes, measured in a debian:stable-slim container rather than on this machine.\n'
if ! ask 'Download the official Herdr installer for review?'; then
    declined+=("$installer_url (not downloaded)")
    finished=true
    exit 0
fi
if "$dry_run"; then
    printf 'Would download %s to a private mktemp directory.\n' "$installer_url"
    printf 'Would syntax-check it with sh -n, print its SHA-256, ask again, and only then run\n'
    printf 'it with HERDR_INSTALL_DIR=%s so every write it makes is inside that directory.\n' "$install_dir"
    printf 'No download, installation or background process happens in preview mode.\n'
    configuration_prologue
    configure_prefix
    configure_ui
    closing_notes
    finished=true
    exit 0
fi
# The upstream installer gates itself on curl and awk, and verifies its download with
# the first of sha256sum, shasum or openssl it finds. Of those, only curl is actually
# missing from a minimal image on any of the three supported distributions: awk is
# /usr/bin/mawk through the alternatives link, and sha256sum ships out of the box
# (from coreutils on Debian 13 and Kali, from coreutils-from-uutils on Ubuntu 26.04,
# which is why no package is named for it here).
if ! command -v curl >/dev/null; then
    printf '\ncurl is missing, and nothing can be downloaded without it. It is absent from a\n'
    printf 'minimal Debian 13, Ubuntu 26.04 and Kali Rolling image too, and the apt package\n'
    printf 'is named %s on all three.\n' "${curl_packages[*]:-curl}"
    if ask "Update the package lists and install ${curl_packages[*]:-curl}?"; then
        if try sudo apt-get update; then
            attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${curl_packages[@]:-curl}"
        else
            printf 'The package lists could not be updated, so nothing was installed.\n' >&2
        fi
    fi
    command -v curl >/dev/null || {
        printf 'Install curl and run this script again: sudo apt-get install %s\n' \
            "${curl_packages[*]:-curl}" >&2
        exit 1
    }
fi
command -v awk >/dev/null || {
    printf 'Missing prerequisite: awk, which the upstream installer uses to read the manifest.\n' >&2
    printf 'All three supported distributions ship it as /usr/bin/mawk through the awk\n' >&2
    printf 'alternative, so it has been removed here: sudo apt-get install mawk\n' >&2
    exit 1
}
if ! command -v sha256sum >/dev/null && ! command -v shasum >/dev/null \
    && ! command -v openssl >/dev/null; then
    printf 'The installer verifies its download with the first of sha256sum, shasum or\n' >&2
    printf 'openssl it finds, and this machine has none of the three. sha256sum is part of\n' >&2
    printf 'the coreutils package every supported distribution installs by default, so\n' >&2
    printf 'something has removed it; restore it before installing anything from a URL.\n' >&2
    exit 1
fi
private_dir
installer_file="$work/install.sh"
# Both limits exist so that an unreachable or silent host fails here with a message
# rather than hanging: 10 seconds to connect, 120 for the whole transfer.
if ! try curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 10 --max-time 120 \
    "$installer_url" -o "$installer_file"; then
    printf '\nCould not fetch %s within the 10 second connect and 120 second transfer limits.\n' \
        "$installer_url" >&2
    printf 'Nothing was downloaded and nothing was installed. The host answered HTTP/2 200\n' >&2
    printf 'from a container on 2026-10-16, so a failure here is this network or this\n' >&2
    printf 'moment, not a missing release.\n' >&2
    exit 1
fi
if ! sh -n "$installer_file"; then
    printf '\nThe downloaded file is not valid POSIX shell, so it is not the installer it\n' >&2
    printf 'claims to be and it has not been run. Nothing was installed.\n' >&2
    exit 1
fi
checksum=
if command -v sha256sum >/dev/null; then
    checksum=$(sha256sum -- "$installer_file" | awk '{print $1}')
elif command -v shasum >/dev/null; then
    checksum=$(shasum -a 256 -- "$installer_file" | awk '{print $1}')
elif command -v openssl >/dev/null; then
    checksum=$(openssl dgst -sha256 -r -- "$installer_file" | awk '{print $1}')
fi
printf '\nIt parses as POSIX shell, which is all sh -n proves.\n'
if [[ -n "$checksum" ]]; then
    printf 'SHA-256 of what was just downloaded:\n  %s\n' "$checksum"
    printf 'The copy fetched on 2026-10-16 in a debian:stable-slim container was\n'
    printf '  bf83668c944cff30b3365eee5a4fe15ff61a4b749ab0c73b98e7a203f70893dd\n'
    printf 'A different value is not evidence of anything by itself: upstream publishes no\n'
    printf 'signature and no versioned installer URL, so the file is expected to change.\n'
fi
printf 'Review it in another terminal before answering: less %q\n' "$installer_file"
if ! ask 'Run the downloaded official installer now?'; then
    printf 'The installer was downloaded for review and has not been run, so nothing was\n'
    printf 'installed and no configuration was touched. The private copy is removed on the\n'
    printf 'way out; fetch it again whenever you want another look.\n'
    declined+=("$installer_url (downloaded for review, not run)")
    finished=true
    exit 0
fi
# No sudo: the installer contains none, checks no uid, and writes only inside this
# directory. Running it as root would leave a root-owned binary in your own ~/.local/bin.
if ! try env HERDR_INSTALL_DIR="$install_dir" sh "$installer_file"; then
    printf 'The installer did not finish, so nothing further was configured.\n' >&2
    exit 1
fi
[[ -x "$install_dir/herdr" ]] || {
    printf 'The installer finished without producing %s/herdr.\n' "$install_dir" >&2
    exit 1
}
printf '\nInstalled release, as the binary reports it rather than as this script remembers it:\n'
"$install_dir/herdr" --version
existing="$install_dir/herdr"
configuration_prologue
configure_prefix
configure_ui
closing_notes
finished=true
