#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Docker Engine from Docker's own apt repository, with the distribution's own
# packages as the fallback route, the docker group, and lazydocker. Nothing here
# touches an engine that is already installed: docker-ce Conflicts with docker.io,
# and choosing which engine a working machine runs is not an installer's decision.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Docker setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-docker.sh [--dry-run]\n'
        printf 'Installs Docker Engine, the docker group and lazydocker on Debian 13 or Ubuntu 26.04.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-docker.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/docker-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
desktop_user=${USER:-$(id -un)}
# The suite is the one this phase proved for this release, not a guess from the
# codename: download.docker.com carries a directory per suite, and a name it does
# not carry yields a repository that verifies and offers nothing.
case "$release" in
    debian) vendor_suite=trixie; fallback_version='26.1.5+dfsg1-9+deb13u1' ;;
    ubuntu) vendor_suite=resolute; fallback_version='29.1.3-0ubuntu4.1' ;;
esac
# Guarded, and before the ERR trap has anything to report into: a bare command
# substitution here aborts the script with "stopped at line 0" and no summary, which
# is worse than any outcome it could report. amd64 is the architecture this phase
# proved, and it is the only one Docker publishes for x86_64.
if vendor_arch=$(dpkg --print-architecture 2>/dev/null) && [[ -n "$vendor_arch" ]]; then
    :
elif [[ "$(uname -m 2>/dev/null)" == x86_64 ]]; then
    vendor_arch=amd64
    printf 'dpkg could not report the architecture; using amd64, which is what x86_64 means to apt.\n' >&2
else
    vendor_arch=''
    printf 'dpkg could not report the architecture, and this is not x86_64, so route 1 is unavailable.\n' >&2
fi
vendor_key="https://download.docker.com/linux/$release/gpg"
# signed-by names the keyring add_vendor_repo writes: a key under /etc/apt/keyrings
# is trusted for one repository only when its sources line says so.
vendor_line="deb [arch=$vendor_arch signed-by=$etc_root/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$release $vendor_suite stable"
lazydocker_version=0.25.2
lazydocker_url="https://github.com/jesseduffield/lazydocker/releases/download/v$lazydocker_version/lazydocker_${lazydocker_version}_Linux_x86_64.tar.gz"
# Guarded like the probe above, and for the same reason: a bare command substitution at
# the top level aborts before the EXIT trap exists, and uname is the kind of thing a
# minimal container leaves out.
machine=$(uname -m 2>/dev/null || true)
printf 'Docker setup — engine, compose, the docker group and lazydocker\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf '\nTwo routes, and you choose one:\n'
printf '  1. %s %s stable, which carried docker-ce 5:29.9.1, containerd.io 2.4.2-2,\n' \
    'https://download.docker.com/linux/'"$release" "$vendor_suite"
printf '     docker-buildx-plugin 0.38.0 and docker-compose-plugin 5.6.0 on 2026-10-15.\n'
printf '  2. The engine %s packages itself (docker.io %s), offered if route 1 fails.\n' \
    "$family" "$fallback_version"
printf 'Then, each on its own: the docker group, docker.service, and lazydocker %s.\n' "$lazydocker_version"
printf 'Both engines use the same unit name, docker.service, so nothing here depends on the route.\n'
# dpkg-query, not apt-cache: the question is what is installed on this machine, and
# docker-ce declares Conflicts: docker.io, which aborts the whole transaction with
# "E: Unable to satisfy dependencies" rather than quietly replacing anything.
engine_blocked=false
arch_unresolved=false
engine_present=false
if command -v dpkg-query >/dev/null; then
    docker_io_status=$(dpkg-query -W -f='${Status}\n' docker.io 2>/dev/null || true)
    case "$docker_io_status" in *'ok installed'*) engine_blocked=true ;; esac
else
    printf '\ndpkg-query is missing, so whether docker.io is installed could not be checked.\n' >&2
fi
if "$engine_blocked"; then
    engine_present=true
    printf '\nRefusing to install Docker CE: docker.io is already installed here.\n'
    printf 'docker-ce declares Conflicts: docker.io, so apt would abort the transaction, and\n'
    printf 'removing the engine a machine is already running is your call, not this script'"'"'s.\n'
    printf 'To switch deliberately, stop your containers, then:\n'
    printf '  sudo apt-get remove docker.io docker-compose docker-buildx\n'
    printf 'and run this script again. The docker group and lazydocker steps below still apply\n'
    printf 'to the engine you have.\n'
fi
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    if "$engine_blocked"; then
        printf 'Docker CE was not installed: docker.io holds this machine'"'"'s engine.\n'
    fi
    if "$arch_unresolved"; then
        printf 'Docker'"'"'s own repository was not offered: this machine'"'"'s architecture could not\n'
        printf 'be resolved to one Docker publishes for.\n'
    fi
    printf 'Group membership takes effect at your next login, not in this shell. Check it with: id -nG\n'
    printf 'This run could not verify that the daemon starts, that a container runs, or that\n'
    printf 'group membership works: all three need a reboot or a new session to show.\n'
    printf 'lazydocker %s is a pinned version, not a lookup: re-running this script installs\n' "$lazydocker_version"
    printf 'the same one. Newer releases are at github.com/jesseduffield/lazydocker/releases.\n'
    printf 'Rootless Docker is deliberately not offered here: it is an alternative to the docker\n'
    printf 'group, and a machine set up half each way is worse than either.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
# Route 1. try, not attempt: the next line depends on whether this one worked, and the
# apt fallback is still available afterwards, which is the reason it must not abort.
if ! "$engine_blocked" && [[ -z "$vendor_arch" ]]; then
    printf '\nRoute 1 is skipped: the architecture this machine reports is not one Docker\n'
    printf 'publishes packages for, and a sources line without arch= makes apt ask for an\n'
    printf 'index that is not there, which fails every later update.\n'
    arch_unresolved=true
fi
if ! "$engine_blocked" && [[ -n "$vendor_arch" ]]; then
    printf '\nRoute 1 adds Docker'"'"'s signing key and repository to this machine, then installs\n'
    printf 'docker-ce, docker-ce-cli, containerd.io, docker-buildx-plugin and docker-compose-plugin.\n'
    if ask "Add $vendor_key and install Docker CE?"; then
        # add_vendor_repo bare, for the reason the helper documents: it records its own
        # failure, and try would both double the summary entry and skip the preview,
        # because try routes through run and run executes nothing under --dry-run.
        if add_vendor_repo docker "$vendor_key" "$vendor_line" docker-ce &&
           try sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y \
               docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
            engine_present=true
            printf 'Docker CE is installed from Docker'"'"'s repository.\n'
        else
            printf 'The vendor route did not complete; route 2 is still available below.\n' >&2
        fi
    else
        declined+=('Docker CE from download.docker.com')
    fi
fi
# Route 2, offered when route 1 was declined or failed, and never on top of a working
# route 1: two engines in one transaction is the conflict this script opens by checking.
if ! "$engine_present"; then
    fallback_packages=()
    map_group_packages "$map" docker "$release" fallback_packages
    if (( ${#unavailable[@]} )); then
        printf '\nNot packaged on %s: %s\n' "$family" "${unavailable[*]}"
    fi
    if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
    if (( ${#fallback_packages[@]} )); then
        printf '\nRoute 2, the engine %s packages itself: %s\n' "$family" "${fallback_packages[*]}"
        printf 'That is docker.io %s — older than the vendor build, and enough for ordinary use.\n' \
            "$fallback_version"
        if [[ "$release" == ubuntu ]]; then
            printf 'Ubuntu keeps these in universe, so this step is allowed to fail on a machine\n'
            printf 'that has universe disabled, and says so rather than stopping the run.\n'
        fi
        if ask 'Install these instead?'; then
            attempt sudo apt-get update
            if try sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${fallback_packages[@]}"; then
                engine_present=true
            else
                printf 'The distribution packages did not install; on Ubuntu, check that universe\n' >&2
                printf 'is enabled. No engine is installed, so the steps below are skipped.\n' >&2
            fi
        else
            declined+=("Docker from $family apt")
        fi
    fi
fi
# The group and the service belong to an engine. Without one there is no docker group
# to join and no unit to enable, and usermod would fail for a reason the user cannot
# act on — so they are explained and skipped rather than offered and broken.
if "$engine_present" || "$dry_run"; then
    printf '\nThe docker group is how this machine grants access to the daemon, as the Arch\n'
    printf 'machine this configuration comes from does.\n'
    printf 'Membership is root-equivalent: any member can start a container that mounts the\n'
    printf 'whole filesystem as root, with no password and no sudo log entry.\n'
    printf 'It also does nothing until you log in again: a new group is read at login.\n'
    if ask "Add $desktop_user to the docker group?"; then
        attempt sudo usermod -aG docker "$desktop_user"
    else
        declined+=("docker group membership for $desktop_user")
    fi
    printf '\ndocker.service is not enabled by this script unless you ask: a daemon that starts\n'
    printf 'at boot is a choice, and docker can be started by hand when it is wanted.\n'
    if ask 'Enable and start docker.service now and at boot?'; then
        attempt sudo systemctl enable --now docker.service
    else
        declined+=('docker.service at boot')
    fi
else
    printf '\nNo Docker engine is installed, so the docker group and docker.service steps are\n'
    printf 'skipped: the group is created by the engine package, and there is no unit to enable.\n'
fi
# lazydocker is its own step and its own route: a 4 MiB static binary, packaged by
# neither release, and useful with whichever engine is installed.
printf '\nlazydocker %s is the terminal UI the Neovim <leader>ld binding opens; without it\n' \
    "$lazydocker_version"
printf 'that key reports a missing command. It is one static binary, installed for you alone\n'
printf 'in %s/.local/bin, and removed by deleting it.\n' "$HOME"
printf 'Upstream publishes no signature for this asset, so the only check this script can make\n'
printf 'is that the download really is the lazydocker archive.\n'
if ask "Install lazydocker $lazydocker_version from GitHub?"; then
    if "$dry_run"; then
        printf '  preview only: nothing fetched from %s\n' "$lazydocker_url"
    elif [[ "$machine" != x86_64 ]]; then
        printf 'Only the x86_64 build was verified, and this machine reports %s, so nothing\n' "$machine" >&2
        printf 'was fetched. Install lazydocker for %s yourself if upstream ships it.\n' "$machine" >&2
        skipped+=("lazydocker ($machine is not the verified x86_64 build)")
    else
        lazydocker_temp=$(mktemp -d)
        if ! try curl -fsSL --max-time 300 -o "$lazydocker_temp/lazydocker.tar.gz" -- "$lazydocker_url"; then
            printf 'lazydocker %s could not be downloaded, so <leader>ld stays dead.\n' \
                "$lazydocker_version" >&2
        # The listing is read before anything is unpacked or installed, and a server
        # that answers an error page under the asset's name fails here rather than
        # putting an HTML file on PATH under the name of a binary.
        elif ! tar -tzf "$lazydocker_temp/lazydocker.tar.gz" 2>/dev/null | grep -qx lazydocker; then
            printf 'That download is not the lazydocker archive it claims to be, so nothing was\n' >&2
            printf 'installed. Retry later, or fetch %s yourself.\n' "$lazydocker_url" >&2
            failed+=("lazydocker $lazydocker_version: the download is not its archive")
        else
            # try for the extract: installing a file that was never unpacked fails too,
            # and one cause recording two failures reads like two separate problems.
            if try tar -xzf "$lazydocker_temp/lazydocker.tar.gz" -C "$lazydocker_temp" lazydocker; then
                attempt install -Dm755 -- "$lazydocker_temp/lazydocker" "$HOME/.local/bin/lazydocker"
            fi
            case ":$PATH:" in
                *":$HOME/.local/bin:"*) ;;
                *) printf '%s/.local/bin is not on your PATH, so the binary is installed and\n' "$HOME"
                   printf 'unreachable by name. The bundled zshrc adds it; a new login picks it up.\n' ;;
            esac
        fi
        rm -rf -- "$lazydocker_temp"
    fi
else
    declined+=("lazydocker $lazydocker_version")
fi
finished=true
