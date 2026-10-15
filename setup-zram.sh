#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# zram swap through systemd-zram-generator. The package already ships an active
# [zram0] capped at 4096 MB, so this script exists for one reason only: to raise that
# cap on a machine with enough RAM to make it worth raising. Nothing here disables
# the swap partition, and declining every prompt leaves the shipped default running.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-zram.sh [--dry-run]\n'
        printf 'Offers a larger zram swap device on Debian 13 or Ubuntu 26.04 by raising the\n'
        printf 'cap the systemd-zram-generator package already ships. Declining changes nothing.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-zram.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/zram-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# The two system files this subject involves, under the same prefix lib/common.sh
# gives its other system paths, so the tests can watch the write without a root
# filesystem of their own. shipped is the package's, and is never written to.
config="${etc_root}/etc/systemd/zram-generator.conf"
shipped="${etc_root}/usr/lib/systemd/zram-generator.conf"
# Overridable for the same reason os-release is: the size is computed from this file,
# and a test that cannot choose the RAM cannot test the computation.
meminfo=${DEBIAN_SETUP_MEMINFO:-/proc/meminfo}
[[ -r "$meminfo" ]] || { printf 'Cannot read %s, so the zram size cannot be computed.\n' "$meminfo" >&2; exit 1; }
# The kernel writes these in kB. Prints nothing at all when the key is absent, which
# the caller treats as fatal rather than as zero: a size computed from a missing
# MemTotal would be a guess wearing a number's clothes.
meminfo_mb() { awk -v key="$1" '$1 == key ":" { printf "%d\n", $2 / 1024; exit }' "$meminfo"; }
ram_mb=$(meminfo_mb MemTotal)
[[ "$ram_mb" =~ ^[0-9]+$ ]] && (( ram_mb > 0 )) ||
    { printf '%s has no usable MemTotal line, so the zram size cannot be computed.\n' "$meminfo" >&2; exit 1; }
swap_mb=$(meminfo_mb SwapTotal)
[[ "$swap_mb" =~ ^[0-9]+$ ]] || swap_mb=0
# 4096 is the cap the package ships; 8192 is the only thing this script changes.
shipped_cap=4096
raised_cap=8192
half_mb=$(( ram_mb / 2 ))
size_mb=$half_mb
(( size_mb <= raised_cap )) || size_mb=$raised_cap
printf 'zram swap setup — systemd-zram-generator\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf '\nThis machine reports %s MB of RAM (about %s GiB) in %s.\n' "$ram_mb" "$(( ram_mb / 1024 ))" "$meminfo"
if (( swap_mb > 0 )); then
    printf 'It also has %s MB (about %s GiB) of swap already active, so zram is a latency win\n' \
        "$swap_mb" "$(( swap_mb / 1024 ))"
    printf 'here, not a capacity one: it keeps warm pages compressed in RAM instead of reading\n'
    printf 'them back from the disk. The swap partition is left exactly as it is.\n'
else
    printf 'No swap is active, so a zram device would be the only swap this machine has, and\n'
    printf 'it cannot survive a hibernate — a disk swap area is still worth having.\n'
fi
# Read rather than asserted: the claim this whole script rests on is that an active
# [zram0] already exists, and the package's own file is the evidence for it.
shipped_size=''
if [[ -r "$shipped" ]]; then
    shipped_size=$(awk -F= '/^[[:space:]]*zram-size/ { gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2; exit }' "$shipped")
fi
if [[ -n "$shipped_size" ]]; then
    printf '\nThe package already ships an active [zram0] in %s:\n' "$shipped"
    printf '  zram-size = %s\n' "$shipped_size"
else
    printf '\nsystemd-zram-generator is not installed yet. It ships an active [zram0] of\n'
    printf 'min(ram / 2, 4096) MB in %s, which needs no configuration from anyone.\n' "$shipped"
fi
printf 'Raising that cap to %s MB is the only reason to write %s,\n' "$raised_cap" "$config"
printf 'and on this machine that cap gives %s MB of compressed swap in RAM.\n' "$size_mb"
packages=()
map_group_packages "$map" zram "$release" packages
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    printf 'Check the device with: zramctl\n'
    printf 'Check the order with: swapon --show — zram carries the higher priority, so it fills\n'
    printf 'first and the partition is only reached when zram is full.\n'
    printf 'Not verified by this script: the generator prints "Running in a container, exiting",\n'
    printf 'so no test could watch it generate a unit. Unit generation and a live swap device are\n'
    printf 'confirmed on this machine by the two commands above, after the next boot.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
if (( ${#packages[@]} )); then
    printf '\nzram packages\n  %s\n' "${packages[*]}"
    if [[ "$release" == ubuntu ]]; then
        printf 'Ubuntu keeps this package in universe; enable that component if the install fails.\n'
    fi
    if ask 'Update the package lists and install them?'; then
        # try, not attempt: installing against lists that could not be updated is how a
        # universe package resolves to nothing and takes the step down with a worse message.
        if try sudo apt-get update; then
            attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
        else
            printf 'The package lists could not be updated, so nothing was installed.\n' >&2
        fi
    fi
fi
if (( ${#unavailable[@]} )); then printf '\nNot packaged on %s: %s\n' "$family" "${unavailable[*]}"; fi
if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
if (( half_mb > shipped_cap )); then
    printf '\n%s is the file the generator actually reads.\n' "$config"
    printf 'It would contain one computed number, because an expression the generator cannot\n'
    printf 'parse makes it exit 1 with Undefined(...) and leaves the machine with no zram at all.\n'
    if [[ -e "$config" ]]; then
        printf 'This machine already has that file:\n'
        while IFS= read -r line; do printf '  %s\n' "$line"; done < "$config"
    fi
    if ! ask "Write $config with zram-size = $size_mb?"; then
        declined+=("$config")
        printf 'Not written. The shipped default, min(ram / 2, %s) MB, is already active and\n' "$shipped_cap"
        printf 'stays that way: declining this step is not the same as having no zram.\n'
    elif ! backup_system_file "$config" zram-generator.conf; then
        # A replacement that could not be backed up does not happen: the file this
        # would overwrite is the only copy of whatever the machine had.
        printf 'Could not back up %s, so it was left exactly as it is.\n' "$config" >&2
    else
        if ! "$dry_run"; then
            staged=$(mktemp)
            printf '# Written by setup-zram.sh. Raises the cap the package ships, nothing else.\n' > "$staged"
            printf '# %s MB of RAM was detected, and min(ram / 2, %s) is %s MB.\n' \
                "$ram_mb" "$raised_cap" "$size_mb" >> "$staged"
            printf '[zram0]\nzram-size = %s\n' "$size_mb" >> "$staged"
            run sudo install -Dm644 -- "$staged" "$config"
            unlink -- "$staged"
        else
            printf 'Would write %s with zram-size = %s\n' "$config" "$size_mb"
        fi
    fi
else
    # Half this machine's RAM is under the cap the package already ships, so writing
    # the file would restate the default and call it a change.
    printf '\nHalf this RAM is %s MB, which is under the %s MB cap the package already ships,\n' \
        "$half_mb" "$shipped_cap"
    printf 'so there is nothing to raise and no reason to write %s.\n' "$config"
    printf 'The shipped default already gives this machine %s MB of zram.\n' "$half_mb"
fi
printf '\nsystemd builds the zram unit from that file at boot, so a reboot is the honest test.\n'
printf 'The generator refuses to run inside a container ("Running in a container, exiting"),\n'
printf 'which is why nothing but this machine can confirm the device.\n'
if ask 'Reload systemd and start the zram device now, without waiting for a reboot?'; then
    attempt sudo systemctl daemon-reload
    attempt sudo systemctl start systemd-zram-setup@zram0.service
fi
finished=true
