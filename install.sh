#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
set -Eeuo pipefail
# BASH_LINENO[0] is the line that called the function the error happened in, so a failure
# inside run() reports the step that ran, not run()'s own body. Empty at the top level.
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -d "$bundle_dir/config" ]] || { printf 'Keep install.sh with its config folder.\n' >&2; exit 1; }
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash install.sh [--dry-run]\n'
        printf 'Run as your normal desktop user on Debian 13 or Ubuntu 26.04.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep install.sh with its lib folder.\n' >&2; exit 1; }
target_config="$HOME/.config"
backup_dir="$HOME/.local/state/debian-desktop-setup/$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
# Overridable so the tests can present a Debian or Ubuntu release on any machine.
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
printf 'Debian desktop setup — packages, configuration and services\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE for redistribution terms.\n'
printf 'Detected %s (%s family); installing with apt.\n' "${distro_name:-$distro_id}" "$family"
printf 'Existing configuration files are backed up before replacement.\n'
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    printf 'Finished. Log out and log in to apply startup programs. Alt+D: Rofi launcher; Alt+Shift+S: screenshot.\n'
    printf 'Keyboard: English (US) + Arabic. Shift+Caps Lock switches layouts after login.\n'
    printf 'No login manager is installed in this phase: use the one you have, or startx with the bundled xinit.\n'
    printf 'Sway is available with: bash setup-sway.sh\n'
    printf 'Neovim and its plugins: bash setup-nvim.sh (the editor-tools group lives there)\n'
    if (( ${#not_run_here[@]} )); then
        printf 'Not installed here, and each still one command away:\n'
        printf '  %s\n' "${not_run_here[@]}"
    fi
    # A run with failed steps must not report success to whatever called this script.
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
# Declared before the trap that prints it: a run that ends between installing the
# trap and reaching the delegation section -- an unreadable map, a map with no
# groups -- would otherwise die in the trap itself under set -u, hiding the real
# cause behind an unbound variable.
not_run_here=()
trap summary EXIT
# Overridable so the tests can present a map with a group this file has never seen.
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
declare -A group_label=(
    [core-desktop]='Core i3 desktop and all configuration dependencies'
    [audio]='PipeWire audio'
    [input-emoji]='Brightness keys, emoji fonts and clipboard'
    [browser-files]='Browser and file utilities'
    [dev]='Development and command-line utilities (PHP, Composer, mkcert)'
    [shell]='Zsh and its completion plugins'
)
packages=()
group() {
    # Not named "list": map_group_packages takes the array by name, and a nameref
    # pointing at a local of the same name is a circular reference bash refuses.
    local id=$1 chosen=()
    map_group_packages "$map" "$id" "$release" chosen
    (( ${#chosen[@]} )) || return 0
    printf '\n%s\n  %s\n' "${group_label[$id]:-Additional packages ($id)}" "${chosen[*]}"
    if ask 'Include these packages?'; then packages+=("${chosen[@]}"); fi
}
# editor-tools is offered by setup-nvim.sh, not here; every other group in the map is.
# The groups this installer owns are the ones it has a label for. Every other group
# in the map belongs to a setup-*.sh script -- editor-tools to setup-nvim.sh, sway to
# setup-sway.sh, and one per third-party application -- so the table is the source of
# truth and there is no exclusion list to edit when a phase adds a group.
mapfile -t group_ids < <(awk -F'\t' 'NR > 1 && !seen[$1]++ { print $1 }' "$map")
(( ${#group_ids[@]} )) || { printf 'The package map lists no groups: %s\n' "$map" >&2; exit 1; }
delegated=()
for id in "${group_ids[@]}"; do
    if [[ -v group_label[$id] ]]; then
        group "$id"
    else
        delegated+=("$id")
    fi
done
# Named rather than silently skipped: a group this installer does not own is still
# something the user can install, and the script that owns it says so by name.
if (( ${#delegated[@]} )); then
    printf '\nInstalled by their own scripts, not here: %s\n' "${delegated[*]}"
    printf 'The closing summary names the command for each.\n'
fi
if (( ${#unavailable[@]} )); then
    printf '\nNot packaged on %s: %s\n' "$family" "${unavailable[*]}"
fi
if (( ${#skipped[@]} )); then
    printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"
fi
if (( ${#packages[@]} )); then
    mapfile -t packages < <(printf '%s\n' "${packages[@]}" | sort -u)
    printf '\nSelected packages: %s\n' "${packages[*]}"
    if ask 'Update the package lists and install the selected packages?'; then
        # A failed update must stop here: installing against a stale index is worse.
        # But once a third-party repository exists, somebody else's outage can stop a
        # run that worked yesterday, so the one fact the user needs comes first.
        if ! run sudo apt-get update; then
            printf '\nThe package lists could not be updated, so nothing was installed.\n' >&2
            vendor_sources=("${etc_root}"/etc/apt/sources.list.d/*.list)
            if [[ -e "${vendor_sources[0]}" ]]; then
                printf 'Third-party repositories are configured on this machine:\n' >&2
                printf '  %s\n' "${vendor_sources[@]}" >&2
                printf 'If one of their hosts is down, removing its file above restores this run.\n' >&2
            fi
            exit 1
        fi
        # Ubuntu's firefox package installs a snap from its postinst and asks debconf
        # about it; an installer the user is watching must not stop on that prompt.
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
    fi
fi
if ask 'Install the desktop configuration bundle (each existing changed file asks before replacement)?'; then
    while IFS= read -r -d '' source <&3; do
        relative=${source#"$bundle_dir/config/"}
        install_file "$source" "$relative"
    # nvim belongs to setup-nvim.sh, and the Wayland session belongs to setup-sway.sh:
    # a user who never asked for Sway must not find its configuration installed, least
    # of all a portal preference the X11 session reads as well.
    done 3< <(find "$bundle_dir/config" \( -path "$bundle_dir/config/nvim" \
        -o -path "$bundle_dir/config/sway" -o -path "$bundle_dir/config/waybar" \
        -o -path "$bundle_dir/config/mako" -o -path "$bundle_dir/config/swaylock" \
        -o -path "$bundle_dir/config/xdg-desktop-portal" \) -prune -o -type f -print0 | sort -z)
    # The scripts must stay executable; plain configuration is installed mode 644 above.
    for script in i3/brightness.sh i3/emoji.sh i3/launcher.sh i3/touchpad.sh \
        conky/start.sh conky/switch.sh; do
        [[ -f "$bundle_dir/config/$script" ]] || continue
        install_file "$bundle_dir/config/$script" "$script" 755
    done
    if ! "$dry_run" && command -v i3 >/dev/null; then attempt i3 -C -c "$target_config/i3/config"; fi
fi
if ask 'Choose the Rofi theme for the installed launcher?'; then
    printf '1) Catppuccin  2) Nord  3) Dracula\n'
    # || choice=, because a closed stdin must take the default rather than abort the
    # run under set -e: every step after this one would be skipped, including the
    # ones that matter more than a colour.
    read -r -p 'Theme [1]: ' choice || choice=
    case "$choice" in
        2) theme=i3-theme-nord.rasi ;;
        3) theme=i3-theme-dracula.rasi ;;
        *) theme=i3-theme.rasi ;;
    esac
    # A separate pointer file means switching themes never edits the i3 bindings.
    if ! "$dry_run"; then
        theme_temp=$(mktemp)
        printf '@theme "%s"\n' "$theme" > "$theme_temp"
        install_file "$theme_temp" rofi/active-theme.rasi
        unlink "$theme_temp"
    else
        printf 'Would select %s\n' "$theme"
    fi
fi
if ask 'Open Markdown (.md) files rendered in ReText preview by default?'; then
    install_file "$bundle_dir/applications/retext-preview.desktop" \
        applications/retext-preview.desktop 644 "$HOME/.local/share"
    if command -v xdg-mime >/dev/null; then attempt xdg-mime default retext-preview.desktop text/markdown; fi
fi
if ask 'Set the dark appearance preference in your current desktop session?'; then
    if command -v gsettings >/dev/null; then
        attempt gsettings set org.gnome.desktop.interface color-scheme prefer-dark
    else
        printf 'Install libglib2.0-bin and rerun to set the desktop preference.\n'
    fi
fi
# Run as the desktop user: sudo would create the CA in root's home, unseen by your browsers.
printf '\nmkcert creates a local certificate authority trusted by this system and your browsers.\n'
printf 'Keep rootCA-key.pem private: anyone with it can issue certificates this machine trusts.\n'
if ask 'Create and trust the mkcert local CA for HTTPS development (mkcert -install)?'; then
    if ! "$dry_run" && ! command -v mkcert >/dev/null; then
        printf 'mkcert is not installed. Accept the development group, then rerun this step.\n' >&2
    else
        attempt mkcert -install
    fi
fi
printf '\nsnapd.socket is what makes snap packages work. On Ubuntu the browser is a snap and\n'
printf 'needs it; on Debian nothing this project installs is a snap, and it stays idle until\n'
printf 'something asks for one.\n'
for service in NetworkManager.service bluetooth.service fstrim.timer snapd.socket; do
    if ask "Enable and start $service?"; then attempt sudo systemctl enable --now "$service"; fi
done
if ask 'Start and enable the PipeWire sockets and WirePlumber for this user?'; then
    attempt systemctl --user enable --now pipewire.socket pipewire-pulse.socket wireplumber.service
fi
if ask 'Set up Zsh, Oh My Zsh, autosuggestions and syntax highlighting?'; then
    if "$dry_run"; then attempt bash "$bundle_dir/setup-zsh.sh" --dry-run; else attempt bash "$bundle_dir/setup-zsh.sh"; fi
fi
if ask 'Restore Neovim and its plugins?'; then
    if "$dry_run"; then attempt bash "$bundle_dir/setup-nvim.sh" --dry-run; else attempt bash "$bundle_dir/setup-nvim.sh"; fi
fi
# Phases 3 and 4: one script per subject, each asked separately and declined by default,
# so a user who only ever runs this installer is still asked about every application.
# attempt, not try: they are independent of each other and of everything above, and a
# vendor host that is down today must not stop the ones after it. Hardening is last
# because it is the only one that can lock this machine's owner out of it.
#
# Overridable so the tests can prove this mechanism without running eleven interactive
# installers that reach vendor hosts: DEBIAN_SETUP_DELEGATES is a space-separated list
# of scripts in this directory.
read -r -a delegate_scripts <<< "${DEBIAN_SETUP_DELEGATES-setup-chrome.sh setup-dbeaver.sh \
setup-onlyoffice.sh setup-dropbox.sh setup-docker.sh setup-postman.sh setup-tor-browser.sh \
setup-conky.sh setup-zram.sh setup-snapshots.sh setup-hardening.sh}"
declare -A delegate_prompt=(
    [setup-chrome.sh]="Install Google Chrome from Google's own apt repository?"
    [setup-dbeaver.sh]='Install DBeaver CE, the database tool, from dbeaver.io?'
    [setup-onlyoffice.sh]='Install ONLYOFFICE Desktop Editors from the vendor repository (a 279 MB download)?'
    [setup-dropbox.sh]="Install the Dropbox frontend from Dropbox's own apt repository?"
    [setup-docker.sh]='Install Docker Engine, compose and lazydocker?'
    [setup-postman.sh]='Install Postman from the vendor tarball (no checksum or signature is published)?'
    [setup-tor-browser.sh]='Install Tor Browser from an already-staged signed tarball?'
    [setup-conky.sh]='Install the conky system panel for both sessions?'
    [setup-zram.sh]='Set up zram swap through systemd-zram-generator?'
    [setup-snapshots.sh]='Set up btrfs snapshots (btrbk on a timer, snapper separately)?'
    [setup-hardening.sh]='Harden SSH on this machine? It changes how you can log in to it.'
)
# Nothing to say when there is nothing to offer: an empty list is how the tests keep a
# run hermetic, and a heading with no questions under it would be a puzzle.
if (( ${#delegate_scripts[@]} )); then
    printf '\nThese install one application or system feature each. Declining costs nothing: the\n'
    printf 'summary names the command for every one you say no to.\n'
fi
for script in ${delegate_scripts[@]+"${delegate_scripts[@]}"}; do
    [[ -n "$script" ]] || continue
    if [[ ! -r "$bundle_dir/$script" ]]; then
        printf 'Not in this bundle, so it cannot be offered: %s\n' "$script" >&2
        continue
    fi
    if ask "${delegate_prompt[$script]:-Run $script?}"; then
        if "$dry_run"; then
            attempt bash "$bundle_dir/$script" --dry-run
        else
            attempt bash "$bundle_dir/$script"
        fi
    else
        not_run_here+=("bash $script")
    fi
done
finished=true
