#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# btrfs snapshots: btrbk on a timer, and snapper as a separate, louder opt-in.
# Everything here is btrfs-only, so the filesystem is read before anything is asked.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Snapshot setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-snapshots.sh [--dry-run]\n'
        printf 'Sets up btrfs snapshots with btrbk, and offers snapper separately.\n'
        printf 'The root filesystem must be btrfs; on anything else every step skips itself.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-snapshots.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/snapshots-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
# The first thing after the guards, because btrbk, snapper and every other step below
# need btrfs: a run on ext4 must skip with a reason, not fail halfway through. An
# absent or silent findmnt counts as unknown, and unknown is treated as not btrfs.
root_fstype=$(findmnt -no FSTYPE / 2>/dev/null || true)
# /etc is written through the same prefix the vendor-repository helper uses, so a test
# can watch this script install a system file without a root filesystem of its own.
btrbk_conf="$etc_root/etc/btrbk/btrbk.conf"
# btrbk's volume directory is the mount point of the top-level subvolume, which is not
# / on a machine whose / is the @ subvolume. Overridable so a test can point it at a
# scratch directory instead of a real mount.
volume_dir=${DEBIAN_SETUP_BTRFS_VOLUME:-/mnt/btrfs-root}
snapshot_dir="$volume_dir/snaps"
printf 'btrfs snapshots — btrbk from apt, with snapper offered separately\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'Versions proved on 2026-10-15: btrbk 0.32.6, snapper 0.10.6, btrfs-progs 6.14-1\n'
printf 'on Debian 13 and 6.17.1-1build1 on Ubuntu 26.04. On Ubuntu btrbk and snapper come\n'
printf 'from universe, so those steps report a failure and carry on rather than stopping.\n'
printf 'A snapshot is not a backup: it shares the disk with what it snapshots, so it\n'
printf 'survives a mistaken rm and not a failing disk. Nothing here copies anything off\n'
printf 'this machine, and nothing here needs the network.\n'
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# One group in the map, two steps here: snapper is held back for its own prompt,
# because accepting it changes what every later apt run in this repository costs.
map_group_packages "$map" snapshots "$release" group_packages
btrbk_packages=()
snapper_packages=()
for package in "${group_packages[@]}"; do
    case "$package" in
        snapper) snapper_packages+=("$package") ;;
        *) btrbk_packages+=("$package") ;;
    esac
done
# btrbk ships only btrbk.conf.example, so this file is the repository's own and not an
# upstream default anybody else maintains. The shape is the one the recon proved on a
# loop-mounted btrfs: the top-level subvolume as the volume directory, @ inside it, and
# the snapshots beside it in snaps/.
btrbk_configuration() {
    printf '# %s — written by setup-snapshots.sh (debian-desktop-setup).\n' "${btrbk_conf#"$etc_root"}"
    printf '# btrbk ships only btrbk.conf.example, so this file is not an upstream default.\n'
    printf '#\n'
    printf '# Retention: every snapshot is kept for its first 2 days, and one per day is kept\n'
    printf '# for 14 days. How often a snapshot is taken is the timer, not this file.\n'
    printf '#\n'
    printf '# There is no target section on purpose: this configuration snapshots and never\n'
    printf '# copies anything off this machine. A snapshot is not a backup.\n'
    printf 'timestamp_format        long\n'
    printf 'snapshot_create         always\n'
    printf 'snapshot_preserve_min   2d\n'
    printf 'snapshot_preserve       14d\n'
    printf '\n'
    printf '# volume is the mount point of the TOP-LEVEL subvolume (subvolid=5), not of /,\n'
    printf '# because / is usually the @ subvolume and @ is not visible from inside itself.\n'
    printf '# Check the names on this machine with: sudo btrfs subvolume list /\n'
    printf 'volume %s\n' "$volume_dir"
    printf '  snapshot_dir          snaps\n'
    printf '  subvolume             @\n'
}
# One consent prompt and one backup for the one system file this script writes.
# install_file, the repository's helper for exactly this, is not used: it runs install
# without sudo, and this script insists on being a normal user, so an /etc destination
# would fail for every caller rather than only in a test.
install_btrbk_conf() {
    local staged=$1
    if [[ -f "$btrbk_conf" ]] && cmp -s "$staged" "$btrbk_conf"; then
        printf 'Unchanged: %s\n' "$btrbk_conf"
        return 0
    fi
    if [[ -e "$btrbk_conf" || -L "$btrbk_conf" ]]; then
        if ! ask "Back up and replace $btrbk_conf?"; then
            declined+=("$btrbk_conf")
            return 0
        fi
        if ! backup_system_file "$btrbk_conf" btrbk.conf; then
            printf 'Could not back up %s, so it was left as it is.\n' "$btrbk_conf" >&2
            return 0
        fi
    fi
    attempt sudo install -Dm644 -- "$staged" "$btrbk_conf"
    return 0
}
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    if [[ "$root_fstype" == btrfs ]]; then
        printf 'What this run could not verify, and you should:\n'
        printf '  The subvolume layout. This configuration assumes @ under the top-level\n'
        printf '  subvolume; confirm it with: sudo btrfs subvolume list /\n'
        printf '  That %s is a mounted top-level subvolume. Until it is, btrbk\n' "$volume_dir"
        printf '  reads its configuration and finds nothing to snapshot. An fstab line:\n'
        printf '    UUID=<your btrfs uuid>  %s  btrfs  subvolid=5,noatime  0 0\n' "$volume_dir"
        printf '  btrbk.timer schedule. The cadence is whatever the package ships; this run\n'
        printf '  did not read it. Check it with: systemctl cat btrbk.timer\n'
        printf '  That any snapshot exists. No snapshot was taken here, only configured.\n'
        printf '  List them later with: sudo btrbk list snapshots\n'
    fi
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
if [[ "$root_fstype" != btrfs ]]; then
    if [[ -z "$root_fstype" ]]; then
        printf '\nfindmnt could not report the filesystem of /, so it is unknown here.\n'
        printf 'findmnt comes with util-linux; without its answer this script will not guess.\n'
    else
        printf '\nThe filesystem mounted at / is %s, not btrfs.\n' "$root_fstype"
    fi
    printf 'btrbk and snapper both snapshot btrfs subvolumes and have nothing to do on\n'
    printf 'any other filesystem, so every step here is skipped: no package is installed,\n'
    printf 'no configuration is written, no timer is enabled. This is not a failure.\n'
    printf 'Converting a root filesystem to btrfs is a reinstall, not a step in a script.\n'
    finished=true
    exit 0
fi
printf '\nThe filesystem mounted at / is btrfs, so the steps below apply.\n'
packages=()
if (( ${#btrbk_packages[@]} )); then
    printf '\nSnapshot packages\n  %s\n' "${btrbk_packages[*]}"
    if ask 'Include these packages?'; then packages+=("${btrbk_packages[@]}"); fi
fi
if (( ${#unavailable[@]} )); then printf '\nNot packaged on %s: %s\n' "$family" "${unavailable[*]}"; fi
if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
if (( ${#packages[@]} )); then
    printf '\nSelected packages: %s\n' "${packages[*]}"
    if ask 'Update the package lists and install them?'; then
        attempt sudo apt-get update
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
    fi
fi
printf '\nThe btrbk configuration this repository installs as %s:\n\n' "$btrbk_conf"
btrbk_configuration
printf '\n'
if ask "Install this as $btrbk_conf?"; then
    if "$dry_run"; then
        printf '  preview only: nothing written\n'
    else
        conf_temp=$(mktemp)
        btrbk_configuration > "$conf_temp"
        install_btrbk_conf "$conf_temp"
        unlink "$conf_temp"
    fi
fi
# btrbk does not create its snapshot directory, and reports the missing directory as an
# error on every run until it exists. A subvolume rather than a plain directory, so the
# snapshots are not inside the subvolume being snapshotted.
printf '\nbtrbk writes its snapshots into %s, which it will not create itself.\n' "$snapshot_dir"
# A directory is not a mount: an empty /mnt/btrfs-root on the btrfs root is a plain
# directory that btrfs subvolume create succeeds inside, which looks like success and
# leaves btrbk snapshotting a path that is not the top-level subvolume. findmnt answers
# the question that was actually being asked.
volume_fstype=$(findmnt -no FSTYPE -- "$volume_dir" 2>/dev/null || true)
if [[ "$volume_fstype" == btrfs ]]; then
    if ask "Create $snapshot_dir as a btrfs subvolume?"; then
        attempt sudo btrfs subvolume create "$snapshot_dir"
    fi
elif [[ -d "$volume_dir" ]]; then
    printf '%s exists but nothing is mounted there (findmnt reports %s), so it is a plain\n' \
        "$volume_dir" "${volume_fstype:-nothing}"
    printf 'directory on this filesystem. Creating the snapshot subvolume inside it would\n'
    printf 'succeed and snapshot the wrong place, so it is left alone.\n'
    printf 'Mount the top-level subvolume there, then run: sudo btrfs subvolume create %s\n' "$snapshot_dir"
else
    printf '%s is not mounted here, so the snapshot directory cannot be created yet.\n' "$volume_dir"
    printf 'Mount the top-level subvolume there, then run: sudo btrfs subvolume create %s\n' "$snapshot_dir"
fi
# btrbk's own dry run is the only check available that reads the real configuration
# against the real filesystem, and it changes nothing. Skipped rather than failed when
# there is nothing yet for it to read.
if ! "$dry_run" && command -v btrbk >/dev/null && [[ -f "$btrbk_conf" && -d "$snapshot_dir" ]]; then
    attempt sudo btrbk -n run
elif ! "$dry_run"; then
    printf 'Not checking the configuration yet: that needs btrbk installed, %s written\n' "$btrbk_conf"
    printf 'and %s present. Once they are, check it with: sudo btrbk -n run\n' "$snapshot_dir"
fi
printf '\nThe snapshots happen on btrbk.timer, which the package ships with the service.\n'
if ask 'Enable and start btrbk.timer?'; then
    attempt sudo systemctl enable --now btrbk.timer
fi
# Snapper is the loud one. Its apt hook is not an optional extra of the package: it is
# what the package does the moment a root configuration exists.
printf '\nsnapper is the other route, and it is not a quiet addition.\n'
printf 'The moment /etc/snapper/configs/root exists, /etc/apt/apt.conf.d/80snapper from\n'
printf 'the snapper package takes a pre and a post snapshot around EVERY later apt\n'
printf 'invocation. That is two snapshots around every package step in this repository,\n'
printf 'including the ones install.sh and the other setup scripts run, so accepting this\n'
printf 'changes what each of them costs in time and in disk.\n'
printf 'To skip the pair for a single apt run: sudo DISABLE_APT_SNAPSHOT="yes" apt-get ...\n'
printf 'and to stop it for good, remove /etc/snapper/configs/root.\n'
if ask 'Install snapper and create its root configuration, with that apt hook?'; then
    if (( ${#snapper_packages[@]} )); then
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${snapper_packages[@]}"
    fi
    # create-config is what makes the nested .snapshots subvolume and the root config
    # file, which is also what switches the apt hook on.
    attempt sudo snapper -c root create-config /
    printf 'snapper is configured for /. Its own timeline and cleanup timers were not\n'
    printf 'verified for this repository, so this script does not enable them.\n'
fi
# One unbroken line, because the quote is the whole argument and a user who greps for
# it in timeshift's own output has to find the same words here.
printf '\ntimeshift is not offered, in its own words:\n'
printf '  "Only ubuntu-type layouts with @ and @home subvolumes are currently supported."\n'
printf 'It also schedules with cron and pulls in GTK3 and libxapp, none of which fits a\n'
printf 'machine configured by this repository.\n'
finished=true
