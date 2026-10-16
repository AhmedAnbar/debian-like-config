#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Stop the ASUS Zenbook S 16 (UM5606) firmware from capping the CPU at its lowest
# performance level. Writes one modprobe.d file; no packages, no session changes.
# The initramfs rebuild it offers afterwards is housekeeping, not the fix: see the
# reasoning it prints before asking.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Zenbook CPU cap setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
remove=false
force=false
usage() {
    printf 'Usage: bash setup-zenbook-cpu-cap.sh [--dry-run] [--remove] [--force]\n'
    printf 'Blocks amd_pmf, amdxdna and asus_armoury at boot on the ASUS Zenbook S 16 (UM5606),\n'
    printf 'where loading them locks the CPU to about 605 MHz and 5 W.\n'
    printf -- '--dry-run: print every command and write nothing.\n'
    printf -- '--remove:  delete the file again and restore the stock drivers.\n'
    printf -- '--force:   apply on hardware whose model does not match UM5606.\n'
}
while (( $# )); do
    case "$1" in
        --dry-run) dry_run=true ;;
        --remove) remove=true ;;
        --force) force=true ;;
        --help|-h) usage; exit 0 ;;
        *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
    esac
    shift
done
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-zenbook-cpu-cap.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/zenbook-cpu-cap-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
# The one system file this subject writes, under the prefix lib/common.sh gives every
# other system path here, so a test can watch the write without a root filesystem of
# its own. The name and the three lines are the Arch repository's, unchanged, so the
# same file is greppable in both checkouts.
conf="${etc_root}/etc/modprobe.d/zenbook-um5606-cpu-cap.conf"
modules=(amd_pmf amdxdna asus_armoury)
# True once this run has left the intended blacklist in place, by writing it or by
# finding it already identical. The closing verification block hangs off this and not
# off the file merely existing: after a declined replacement nothing changed in this
# run, and sending the user off to reboot and measure would describe a run that did
# not happen.
in_place=false
# True once this run has deleted the file, which is the other thing a run can change.
# --dry-run never sets it: a preview that claimed the modules load again at the next
# boot would be the same false success as the one gated above, in the other direction.
deleted=false
# Two seams for the same question, because two repositories ask it two ways:
# DEBIAN_SETUP_DMI_NAME is what setup-sway.sh already uses for this exact glob, and
# ZENBOOK_CPU_CAP_DMI_FILE is the Arch script's hook, kept so a test written against
# either repository works here. The default is the real attribute, which read the same
# string from Debian, Ubuntu and Kali userspaces on 2026-10-16.
dmi_file=${ZENBOOK_CPU_CAP_DMI_FILE:-/sys/class/dmi/id/product_name}
model=${DEBIAN_SETUP_DMI_NAME:-$(cat -- "$dmi_file" 2>/dev/null || true)}
# Which initramfs generator this machine has, which decides both the rebuild command and
# the tool named in the closing verification. Three cheaper tests all answer the wrong
# question, and each was tried in a container on 2026-10-16:
#   command -v update-initramfs   dracut ships its own /usr/sbin/update-initramfs shim on
#                                 Ubuntu 26.04 and Kali, so the name proves nothing.
#   -d /etc/initramfs-tools       that directory is conffiles. `apt-get install dracut`
#                                 removes initramfs-tools, because dracut declares
#                                 Conflicts: initramfs-tools, and dpkg keeps the conffiles
#                                 of a removed package, so the directory survives on
#                                 exactly the machine this check existed to catch.
#   dpkg status                   initramfs-tools-core stays installed under dracut, and
#                                 /usr/sbin/mkinitramfs and /usr/bin/lsinitramfs with it.
# What does answer it is `update-initramfs --version`, whose first field names the package
# the command came from -- and that is not this script's invention: Debian's own
# /etc/kernel/postinst.d/initramfs-tools runs
#     test "$(update-initramfs --version | cut -d ' ' -f 1)" = initramfs-tools || exit 0
# and builds nothing when it fails, after which /etc/kernel/postinst.d/dracut builds the
# image with `dracut --force`. So this is the tool that actually generates the initramfs.
# Verified on ubuntu:latest (26.04.1) and kalilinux/kali-rolling: after apt-get install
# initramfs-tools, then dracut, then apt-get remove initramfs-tools, the package is in
# state config-files, /etc/initramfs-tools and mkinitramfs and lsinitramfs are all still
# present, dpkg -S /usr/sbin/update-initramfs answers dracut, and --version answers
# "dracut 110-11ubuntu0.1" and "dracut 112-6". The same sequence on debian:stable-slim
# leaves no update-initramfs at all, so the third branch answers there.
generator=''
rebuild=()
lister=''
generator_version=''
if command -v update-initramfs >/dev/null; then
    generator_version=$(update-initramfs --version 2>/dev/null || true)
    generator_version=${generator_version%%$'\n'*}
fi
case "${generator_version%% *}" in
    initramfs-tools)
        generator='initramfs-tools'
        # -u alone regenerates only the newest kernel, because the shipped
        # /etc/initramfs-tools/update-initramfs.conf says update_initramfs=yes and
        # update-initramfs loops over every version only when -k all is given. Proved in a
        # debian:stable-slim container with two kernels installed: after -u alone the older
        # kernel's image still carried the old modprobe.d, and after -u -k all both did.
        rebuild=(sudo update-initramfs -u -k all)
        lister=lsinitramfs
        ;;
    dracut)
        generator='dracut, through its own /usr/sbin/update-initramfs shim'
        rebuild=(sudo update-initramfs -u -k all)
        lister=lsinitrd
        ;;
    *)  if command -v dracut >/dev/null; then
            generator='dracut'
            rebuild=(sudo dracut --force --regenerate-all)
            lister=lsinitrd
        elif command -v update-initramfs >/dev/null; then
            # An update-initramfs that names a generator this script has never met. The
            # command is still the one to rebuild with, but nothing here knows which image
            # format it writes, so no lister is named rather than the wrong one being named.
            generator='update-initramfs'
            rebuild=(sudo update-initramfs -u -k all)
        fi
        ;;
esac
printf 'ASUS Zenbook S 16 (UM5606) CPU cap — one modprobe.d blacklist\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'Detected model: %s\n' "${model:-unknown}"
if [[ "$model" != *UM5606* ]] && ! "$force"; then
    printf 'This fix is specific to the ASUS Zenbook S 16 (UM5606); nothing changed.\n' >&2
    printf 'Other hardware needs its own diagnosis: compare cpufreq/scaling_cur_freq under load.\n' >&2
    printf 'Use --force only after confirming the same CPU cap on this machine.\n' >&2
    exit 1
fi
finished=false
summary() {
    local status=$?
    [[ -z "${staged:-}" ]] || rm -f -- "$staged"
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    # The last word has to describe the run that actually happened. in_place is the same
    # flag the verification block at the end hangs off, so the two cannot disagree: a
    # declined write, a declined replacement, a declined or previewed deletion all end
    # here with nothing to reboot for, and saying otherwise would be a false success.
    if "$in_place"; then
        printf 'The blacklist is read by the kernel at the next boot, so a reboot is the honest test.\n'
    elif "$deleted"; then
        printf 'With the file gone, the three modules load again at the next boot.\n'
    else
        printf 'This run changed nothing, so the next boot behaves exactly as this one did.\n'
    fi
    printf 'Not verified by this script, or by any test in this repository: that this laptop shows\n'
    printf 'the cap under %s at all. The clamp was only ever reproduced on the Arch install of\n' "$family"
    printf 'this machine, so the figures above are that install, measured, not this one, predicted.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
# The initramfs paragraph and the optional rebuild prompt: why the rebuild is a prompt
# of its own, and why declining it is not a half-finished run. Both halves were proved
# in containers on 2026-10-16.
#
# Offered on both paths that leave the blacklist in place, and not only on the run that
# wrote the file: an identical file says nothing about the copy inside the existing
# images, and the run that finds it identical is exactly the run a user who declined
# this prompt once will be doing from then on. Offering it only after a write meant the
# deferred rebuild could never be taken up, while the closing block went on inviting
# them to look inside the initramfs.
offer_rebuild() {
    printf '\nThe blacklist takes effect at the next boot from that file alone.\n'
    printf 'None of the three modules is ever placed in an initramfs on these distributions:\n'
    printf 'initramfs-tools with the shipped MODULES=most picks from a fixed category list\n'
    printf '(base net ide scsi block ata dasd firewire mmc usb_storage fb) that has no\n'
    printf 'platform/x86 or accel category. Four images built in containers on 2026-10-16 were\n'
    printf 'searched for exactly those three names and held none of them: initramfs-tools on\n'
    printf 'Debian 13 (831 modules), Ubuntu 26.04 (1054) and Kali (829), and a dracut hostonly\n'
    printf 'build of the Ubuntu kernel on this model (658). What they do carry of this hardware\n'
    printf 'is hid-asus and asus-wmi, and neither is blacklisted here. The three cannot load out\n'
    printf 'of the initramfs, so the rebuild is not what makes this work.\n'
    printf 'What the rebuild does do: every /etc/modprobe.d/*.conf is copied into the image\n'
    printf '(mkinitramfs copies them itself; dracut copies them in hostonly mode), so a rebuild\n'
    printf 'keeps the copy inside the initramfs consistent with /etc. That is housekeeping, and\n'
    printf 'declining it leaves this run successful and the fix in place.\n'
    if [[ -n "$generator" ]]; then
        printf 'Initramfs generator on this machine: %s\n' "$generator"
        # The evidence, not just the verdict: this is the same question
        # /etc/kernel/postinst.d/initramfs-tools asks before it builds anything, so a
        # reader can check the answer against their own machine in one command.
        [[ -z "$generator_version" ]] || \
            printf 'update-initramfs --version answers "%s" here, which is what decided that.\n' \
                "$generator_version"
        if ask "Rebuild the initramfs now with ${rebuild[*]} (optional)?"; then
            try "${rebuild[@]}" || true
        else
            declined+=('initramfs rebuild')
        fi
    else
        printf 'No initramfs generator is installed here: neither update-initramfs nor dracut\n'
        printf 'exists, so there is nothing to rebuild and nothing was attempted.\n'
    fi
}
# Before the first consent prompt, because this machine produces one symptom from two
# causes and only one of them is a driver. Four lines, and the numbers in them say
# which install they were measured on.
printf '\nRun systemd-analyze before deciding: this laptop reaches the same cap two ways.\n'
printf 'On the Arch install of this laptop, 2026-10-04, not on %s: a healthy boot was about\n' "$family"
printf '6s firmware and 3-6s loader; a clamped one showed 22.4s firmware and 47.3s loader,\n'
printf 'which is the embedded controller — shut down, unplug USB-C, hold power about 40s.\n'

if "$remove"; then
    if [[ ! -f "$conf" ]]; then
        printf '\nNot present: %s\n' "$conf"
        finished=true
        exit 0
    fi
    printf '\nRemoving %s restores amd_pmf, amdxdna and asus_armoury at the next boot,\n' "$conf"
    printf 'which brought back the 605 MHz cap on the Arch install of this laptop.\n'
    if ask 'Delete the file?'; then
        run sudo rm -f -- "$conf"
        if "$dry_run"; then
            printf 'Preview only: the file is still there and nothing was deleted.\n'
        else
            deleted=true
            printf 'Removed. Restart to load the stock drivers again.\n'
        fi
        if [[ -n "$generator" ]]; then
            printf 'The deleted file is still inside the existing initramfs images, which is\n'
            printf 'harmless — none of the three modules is in an initramfs to blacklist — but a\n'
            printf 'rebuild with %s clears the stale copy.\n' "$generator"
            if ask "Rebuild the initramfs now with ${rebuild[*]}?"; then
                try "${rebuild[@]}" || true
            else
                declined+=('initramfs rebuild')
            fi
        fi
    else
        declined+=("$conf")
    fi
    finished=true
    exit 0
fi

printf '\nMeasured on the Arch install of this laptop (BIOS UM5606WA.318, Linux 7.2.4), not\n'
printf 'on %s: loading amd_pmf, amdxdna and asus_armoury during boot leaves every core at\n' "$family"
printf '605 MHz with a 5 W package limit, about eight times slower than normal, while Linux\n'
printf 'still requests full performance (CPPC_REQ max equals the highest supported level).\n'
printf 'Blocking the three modules restored 34 W and 2.4-3.2 GHz under a 24-thread load.\n'
printf 'The clamp is firmware behaviour, so it carries over to this kernel; the figures were\n'
printf 'not re-measured under %s, because no %s install of this laptop exists.\n' "$family" "$family"
printf '\nCost of the fix:\n'
printf '  - amd_pmf: AMD automatic power tuning. Power profiles keep working through asus-wmi.\n'
printf '  - amdxdna: the NPU driver, which needs amd_pmf. Linux software for the NPU is minimal.\n'
printf '  - asus_armoury: some ASUS firmware attributes. Fan, backlight and charge limits stay in asus_wmi.\n'
if [[ "$variant" == debian ]]; then
    printf '\nOn Debian 13 only one of the three names exists: modinfo against 6.12.113+deb13-amd64\n'
    printf 'finds amd_pmf (as amd-pmf.ko.xz) and reports amdxdna and asus_armoury absent, so two of\n'
    printf 'the three lines below are no-ops there until a backport adds those drivers. All three\n'
    printf 'are written anyway, because blacklisting a module that does not exist costs nothing\n'
    printf 'and a later kernel would need them. On Ubuntu 26.04 and Kali all three are present.\n'
fi
printf '\nWould write %s:\n' "$conf"
# The file's bytes live in a variable, and a temporary file is created only on the branch
# that installs one, the way setup-zram.sh does it. Shown and compared from here, so
# --dry-run touches no filesystem at all -- not even $TMPDIR, which on a read-only or
# full one is the difference between a preview and a failure.
conf_body=$(
    printf '# SPDX-License-Identifier: GPL-3.0-only\n'
    printf '# ASUS Zenbook S 16 (UM5606): loading these during boot makes the firmware pin\n'
    printf '# every core to its lowest performance level (~605 MHz, ~5 W package power),\n'
    printf '# even though cpufreq requests maximum performance. Measured on the Arch install\n'
    printf '# of this laptop; the clamp is firmware behaviour. Written by debian-desktop-setup.\n'
    printf '# Remove with: bash setup-zenbook-cpu-cap.sh --remove\n'
    printf 'blacklist %s\n' "${modules[@]}"
)
printf '%s\n' "$conf_body" | sed 's/^/    /'

if [[ -f "$conf" ]] && printf '%s\n' "$conf_body" | cmp -s - "$conf"; then
    printf 'Unchanged: %s\n' "$conf"
    in_place=true
    offer_rebuild
else
    written=false
    if [[ -e "$conf" || -L "$conf" ]]; then
        if ! ask "Back up and replace the existing $conf?"; then
            declined+=("$conf")
        elif ! backup_system_file "$conf" zenbook-um5606-cpu-cap.conf; then
            # The file this would overwrite is the only copy of whatever the machine had,
            # so a replacement that could not be backed up does not happen.
            printf 'Could not back up %s, so it was left exactly as it is.\n' "$conf" >&2
        else
            written=true
        fi
    elif ask "Write $conf?"; then
        written=true
    else
        declined+=("$conf")
    fi
    if "$written"; then
        in_place=true
        if "$dry_run"; then
            # The command, with the file it would be given named rather than invented:
            # under --dry-run there is no staged copy, because nothing was staged.
            printf '  sudo install -Dm644 -- <the file shown above> %s\n' "$conf"
        else
            staged=$(mktemp)
            printf '%s\n' "$conf_body" > "$staged"
            run sudo install -Dm644 -- "$staged" "$conf"
            rm -f -- "$staged"
            staged=''
        fi
        offer_rebuild
    fi
fi

# Only when there is something to confirm: after a declined write there is no change
# to verify, and telling the user to reboot and check would be describing a run that
# did not happen.
if "$in_place"; then
    printf '\nRestart, then confirm the cap is gone:\n'
    printf '  lsmod | grep -E %s   # expect no output\n' "'amd_pmf|amdxdna|asus_armoury'"
    # Both halves of that comment are the Arch install's, like every other number here:
    # nobody has timed this on a Debian-family install of this laptop, and a slower
    # kernel taking 1.4s unclamped would otherwise read as the fix having failed.
    printf '  time (head -c 256M /dev/zero | sha256sum)   # on Arch: well under 1s, about 4.5s when capped\n'
    if [[ -n "$lister" ]]; then
        # Named from the generator just detected: initramfs-tools provides lsinitramfs and
        # dracut provides lsinitrd, and only one of the two is ever installed.
        printf '  %s /boot/initrd.img-$(uname -r) | grep modprobe.d   # the copy inside the initramfs\n' "$lister"
    fi
fi
if "$dry_run"; then printf 'Preview only: no file was written and no initramfs was rebuilt.\n'; fi
finished=true
