#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# SSH hardening: the only script in this repository that changes how this machine can
# be reached, which is why both of its steps are declined by default and the prompts
# say what they do before they do it.
# ~/arch-desktop-setup/setup-ssh.sh does NOT port here. That script is purely
# client-side: it writes ~/.ssh/config.d/<alias>.conf, makes no connection and never
# touches /etc/ssh. What ports is its discipline -- a drop-in instead of an edit to the
# main file, and a staged file validated before it is installed.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "SSH hardening stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-hardening.sh [--dry-run]\n'
        printf 'Offers openssh-server and an SSH hardening drop-in on Debian 13 or Ubuntu 26.04.\n'
        printf 'Both steps are declined by default. Password logins are only turned off when a key\n'
        printf 'is on disk and you confirm a key login already works.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-hardening.sh with its lib folder.\n' >&2; exit 1; }
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/hardening-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# The same kind of test seam lib/common.sh keeps as etc_root for /etc/apt: a prefix for
# the system paths this script writes to and reads sshd from, so the whole run can be
# exercised against a scratch directory without a root filesystem of its own.
dropin="$etc_root/etc/ssh/sshd_config.d/99-hardening.conf"
authorized_keys="$HOME/.ssh/authorized_keys"
# Debian's postinst enables multi-user.target.wants/ssh.service and Ubuntu's enables
# sockets.target.wants/ssh.socket, so restarting the other release's unit would report
# success and leave the running daemon on its old configuration.
case "$release" in
    ubuntu) unit=ssh.socket ;;
    *) unit=ssh.service ;;
esac
printf 'SSH hardening -- openssh-server and a drop-in under /etc/ssh/sshd_config.d\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family), which manages sshd through %s.\n' "${distro_name:-$release}" "$family" "$unit"
printf 'The package comes from apt. The drop-in is written by this script, and it is the only\n'
printf 'file it installs: /etc/ssh/sshd_config is left exactly as the package shipped it.\n'
hardened=false
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    if "$hardened"; then
        printf 'Installed: %s\n' "$dropin"
        printf 'Undo all of it with: sudo rm %s && sudo systemctl restart %s\n' "$dropin" "$unit"
    fi
    printf 'Not verified by this script: that a key login to this machine works. sshd -t checks the\n'
    printf 'file, not your access, and nothing here opens a connection to find out.\n'
    printf 'Before you log out, open a second terminal and log in with your key. This session is\n'
    printf 'still authenticated, so it is the one place from which a mistake can be undone.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
hardening_packages=()
map_group_packages "$map" hardening "$release" hardening_packages
if (( ${#hardening_packages[@]} )); then
    printf '\nSSH server: %s\n' "${hardening_packages[*]}"
    printf 'Installing this STARTS A LISTENING SERVICE: sshd begins accepting connections on port\n'
    printf '22 as soon as the package is configured, and this machine becomes reachable from the\n'
    printf 'network it is on. Nothing else in this repository does that.\n'
    printf 'The default on both releases accepts passwords, which the next step can change.\n'
    # Ubuntu's own packages in this phase live in universe, and apt-get must not take the
    # rest of the run down with it either way.
    if ask "Install ${hardening_packages[*]} and start the listening SSH service?"; then
        # The update first, as every other script here does: on a machine whose lists are
        # stale or absent -- a fresh install, or one where nothing has run apt yet -- the
        # install fails for a reason the message below does not cover.
        attempt sudo apt-get update
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${hardening_packages[@]}"
    fi
else
    printf '\nThe package map lists no hardening packages for %s, so nothing is offered.\n' "$family"
fi
if (( ${#unavailable[@]} )); then printf 'Not packaged on %s: %s\n' "$family" "${unavailable[*]}"; fi
if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
printf '\nThe hardening drop-in: %s\n' "$dropin"
printf '  PermitRootLogin no              root has no business logging in over the network\n'
printf '  KbdInteractiveAuthentication no without it PAM still offers a password prompt, so\n'
printf '                                  PasswordAuthentication no alone is not enough\n'
printf '  X11Forwarding no                this is a desktop, not a jump host\n'
printf 'Deleting that one file and restarting %s undoes every line of it.\n' "$unit"
# sshd uses the FIRST value it obtains for each keyword, and both releases' sshd_config
# includes sshd_config.d/*.conf near the top, so among drop-ins the lowest-numbered file
# wins. A 50-cloud-init.conf saying "PasswordAuthentication yes" therefore beats this
# file -- verified in a debian:trixie container -- which is why they are named here and
# the effective configuration is read back after the install.
shopt -s nullglob
other_dropins=("$etc_root"/etc/ssh/sshd_config.d/*.conf)
shopt -u nullglob
other_names=()
for existing in ${other_dropins[@]+"${other_dropins[@]}"}; do
    [[ "$existing" == "$dropin" ]] || other_names+=("${existing##*/}")
done
if (( ${#other_names[@]} )); then
    printf '\nThis machine already has drop-ins in %s/etc/ssh/sshd_config.d:\n' "$etc_root"
    printf '  %s\n' "${other_names[@]}"
    printf 'sshd keeps the first value it finds for each setting, so a lower-numbered file\n'
    printf 'than 99-hardening.conf wins. The effective configuration is read back below, and\n'
    printf 'this run reports any setting that did not take.\n'
fi
if ask "Stage, validate and install $dropin?"; then
    want_no_password=false
    key_count=0
    if [[ -r "$authorized_keys" ]]; then
        # Options may precede the key type and a tidied file is mostly comments, so this
        # counts lines that really carry a key rather than lines.
        key_count=$(grep -vE '^[[:space:]]*#' -- "$authorized_keys" \
            | grep -cE '(^|[[:space:]])(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)[[:space:]]+AAAA' \
            || true)
    fi
    if (( key_count > 0 )); then
        printf '\n%s holds %s key(s).\n' "$authorized_keys" "$key_count"
        printf 'PasswordAuthentication no is the one setting here that can lock you out, and a key\n'
        printf 'on disk is not proof that it works: sshd may not be running yet, the file may have\n'
        printf 'the wrong mode, or the key may be the wrong one.\n'
        printf 'Open a second terminal now and log in to this machine with that key.\n'
        if ask 'Did that key login just succeed? Answering yes also sets PasswordAuthentication no'; then
            want_no_password=true
        else
            printf 'Password authentication is left enabled, which is the shipped default on both releases.\n'
        fi
    else
        printf '\nNo key found in %s, so password authentication is left enabled.\n' "$authorized_keys"
        printf 'Refusing to disable it: with no usable key, that is exactly how a machine becomes\n'
        printf 'unreachable. Add your public key there, confirm a key login works, then run this again.\n'
    fi
    if "$dry_run"; then
        printf '  preview only: nothing staged, nothing validated, nothing installed\n'
        if "$want_no_password"; then printf '  would also write: PasswordAuthentication no\n'; fi
        printf '  would then offer to restart %s\n' "$unit"
    else
        # sshd is on neither release's PATH for a normal user, so the usual location is
        # tried as well -- under the same prefix, because a run pointed at a scratch root
        # must not consult the real machine's daemon either.
        sshd_bin=$(command -v sshd || true)
        if [[ -z "$sshd_bin" && -x "$etc_root/usr/sbin/sshd" ]]; then sshd_bin="$etc_root/usr/sbin/sshd"; fi
        if [[ -z "$sshd_bin" ]]; then
            printf 'sshd is not installed, so this file cannot be validated, and an unvalidated\n' >&2
            printf 'configuration for a network daemon is not something to install. Accept the package\n' >&2
            printf 'step above, then run this again.\n' >&2
            failed+=("the hardening drop-in: no sshd to validate it with")
        else
            stage=$(mktemp -d)
            {
                printf '# Written by debian-desktop-setup setup-hardening.sh on %s.\n' "$(date +%Y-%m-%d)"
                printf '# A drop-in, not an edit: /etc/ssh/sshd_config is untouched. Delete this file and\n'
                printf '# restart %s to undo everything below.\n' "$unit"
                printf 'PermitRootLogin no\n'
                printf 'KbdInteractiveAuthentication no\n'
                printf 'X11Forwarding no\n'
            } > "$stage/99-hardening.conf"
            if "$want_no_password"; then
                printf 'PasswordAuthentication no\n' >> "$stage/99-hardening.conf"
            fi
            # sshd -t exits 255 naming the file it refused, so the check runs on the staged
            # copy: a file sshd will not accept never reaches sshd_config.d at all. try,
            # not attempt, because the install below depends on this answer.
            if try sudo "$sshd_bin" -t -f "$stage/99-hardening.conf"; then
                if try sudo install -Dm644 -- "$stage/99-hardening.conf" "$dropin"; then
                    hardened=true
                    # What sshd will actually do, not what this file asks for. A setting
                    # another drop-in already decided is reported, because telling someone
                    # their machine no longer accepts passwords when it does is the worst
                    # outcome this script has available.
                    effective=$(sudo "$sshd_bin" -T 2>/dev/null || true)
                    if [[ -n "$effective" ]]; then
                        printf '\nWhat sshd reports as effective now:\n'
                        while IFS= read -r setting; do
                            printf '  %s\n' "$setting"
                        # Case-insensitively, because the spelling changed: OpenSSH 9
                        # lowercases every keyword in sshd -T output and OpenSSH 10
                        # prints it in CamelCase. Debian 13 ships 9.9 and kali-rolling
                        # 10.5p1, so a match on one spelling alone reads an empty
                        # result on half the machines this installer supports -- and an
                        # empty result here looks exactly like success.
                        done < <(printf '%s\n' "$effective" | grep -iE \
                            '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication|x11forwarding) ' \
                            || true)
                        if "$want_no_password" \
                            && printf '%s\n' "$effective" | grep -qix 'passwordauthentication yes'; then
                            printf 'PasswordAuthentication no did not take effect: this machine still accepts\n' >&2
                            printf 'passwords. Another drop-in sets it first, and sshd keeps the first value.\n' >&2
                            if (( ${#other_names[@]} )); then
                                printf 'Look at: %s\n' "${other_names[*]}" >&2
                            fi
                            failed+=('PasswordAuthentication no did not take effect')
                        fi
                    else
                        printf 'sshd -T reported nothing, so this run could not confirm what took effect.\n' >&2
                        skipped+=('the read-back of the effective sshd configuration')
                    fi
                fi
            else
                printf 'sshd -t rejected the staged file, so nothing was installed and sshd is unchanged.\n' >&2
                printf 'The staged copy is gone; the message above names what it objected to.\n' >&2
            fi
            rm -rf -- "$stage"
        fi
    fi
else
    declined+=("$dropin")
fi
# Only offered when there is something to apply: a restart with no new file would be a
# network daemon bounced for nothing.
if "$hardened"; then
    printf '\nThe drop-in is on disk, and sshd is still running with its old configuration.\n'
    printf 'Restarting %s applies it. Sessions already open, including this one, stay connected.\n' "$unit"
    if ask "Restart $unit now?"; then
        attempt sudo systemctl restart "$unit"
    else
        declined+=("restarting $unit")
        printf 'Not restarted: the drop-in takes effect at the next restart or reboot.\n'
    fi
fi
finished=true
