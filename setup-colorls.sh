#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# colorls: ls with colours and file icons, wired as ls = colorls -l in Bash and Zsh.
# No Debian-family archive packages colorls, so this script is in two halves: apt
# supplies ruby and the toolchain a C extension in colorls's dependency tree needs,
# and the user gem path supplies colorls itself. Nothing here writes outside $HOME
# except through apt, and declining every prompt leaves ls exactly as it was.
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-colorls.sh [--dry-run]\n'
        printf 'Installs colorls from the user gem path and makes ls, ll and la use it in Bash\n'
        printf 'and Zsh. No archive packages colorls, so apt supplies ruby and the toolchain\n'
        printf 'its clocale dependency needs, and the gem supplies colorls itself.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-colorls.sh with its lib folder.\n' >&2; exit 1; }
# $HOME/.config literally, and deliberately not ${XDG_CONFIG_HOME:-...} as the siblings
# use: this script installs one file and also writes the line that sources it, so the
# two halves have to name the same path, and three files that may not change here fix
# which path that is. config/shell/colorls.sh is a shared file the drift guard compares
# byte for byte against the Arch repository; zsh/zshrc line 60 carries the literal
# [[ ! -r "$HOME/.config/shell/colorls.sh" ]] || source ... that the Arch zshrc carries;
# and install.sh line 21 sets target_config="$HOME/.config" with no XDG seam. Honouring
# XDG for the install while the sourced line said $HOME/.config installed the aliases
# where nothing reads them, and reported the wiring as done.
target_config="$HOME/.config"
backup_dir="$HOME/.local/state/debian-desktop-setup/colorls-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# The same line works in Bash and Zsh, and the bundled zshrc already carries it.
source_line='[[ ! -r "$HOME/.config/shell/colorls.sh" ]] || source "$HOME/.config/shell/colorls.sh"'
link="$HOME/.local/bin/colorls"
packages=()
map_group_packages "$map" colorls "$release" packages
font_packages=()
map_named_packages "$map" "$release" font_packages ttf-jetbrains-mono-nerd
printf 'colorls setup — ls with colours and file icons\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf '\nWhat changes: ~/.config/shell/colorls.sh defines three aliases, and one guarded\n'
printf 'source line in ~/.bashrc and ~/.zshrc loads it.\n'
printf '  ls = colorls -l      ll = colorls -la      la = colorls -A\n'
printf 'Plain GNU ls stays reachable as: command ls   or   \\ls\n'
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    printf 'The aliases do nothing until colorls is on PATH: config/shell/colorls.sh guards\n'
    printf 'itself with command -v colorls, so a declined or failed install leaves ls as it was.\n'
    printf 'colorls answers to its name only in a shell started after ~/.local/bin existed:\n'
    printf '/etc/skel/.profile adds that directory at login, and only if it is already there, so\n'
    printf 'open a new login shell -- or, under Zsh, source ~/.zshrc, whose path= line adds it.\n'
    printf 'Not verified here: that the icons render. No glyph was rendered by any test or\n'
    printf 'container in this work; what was measured is narrower, and it is all this script\n'
    printf 'claims.\n'
    printf 'The apt messages and the gem versions quoted above were read in\n'
    printf 'docker run --rm debian:stable-slim, ubuntu:latest and kalilinux/kali-rolling on\n'
    printf '2026-10-16, not on this machine.\n'
    # Split per figure, and only when a font was actually offered. The two font figures
    # were not read in the same places -- the package listing in all three images, the
    # fontconfig answer on Debian alone -- and one sentence covering both contradicted
    # the body's own caveat. A run that reached no font row quotes no font figure here.
    if (( ${#font_packages[@]} )); then
        printf 'The two font figures come from different places, so they are separated here:\n'
        printf 'dpkg -L %s matched no file named for a Nerd Font in\n' "${font_packages[*]}"
        printf 'any of the three images, while the fontconfig answer -- the four codepoints and\n'
        printf 'the DejaVu Sans substitution -- was read on Debian alone.\n'
    fi
    printf 'The paths and the distribution name are this machine'"'"'s own, read here.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
# One apt-get update for the whole run, and never an install against lists that could
# not be updated: that is how a package in a component this machine has turned off
# resolves to nothing and takes the step down with a worse message.
lists_tried=false
lists_updated=false
update_lists() {
    if ! "$lists_tried"; then
        lists_tried=true
        if try sudo apt-get update; then lists_updated=true; fi
    fi
    "$lists_updated"
}
printf '\nNo Debian-family archive packages colorls. apt-get install -s ruby-colorls answers\n'
printf 'E: Unable to locate package ruby-colorls on Debian 13, Ubuntu 26.04 and Kali Rolling\n'
printf 'alike, and apt-cache policy ruby-colorls prints nothing at all. So colorls comes from\n'
printf 'the gem, and apt supplies only what the gem cannot build without.\n'
if (( ${#packages[@]} )); then
    printf '\ncolorls packages\n  %s\n' "${packages[*]}"
    printf 'ruby is there because colorls is a Ruby program, and build-essential and ruby-dev\n'
    printf 'because the dependency tree is not pure Ruby. The names above are in the order\n'
    printf 'sort -u puts them, which is not the order of this sentence. clocale 0.0.4 is a C\n'
    printf 'extension and a hard runtime dependency, so with ruby alone the install stops at\n'
    printf '"mkmf.rb can'"'"'t find header files for ruby at /usr/lib/ruby/include/ruby.h", and\n'
    printf 'with ruby and ruby-dev it stops one step later at "The compiler failed to generate\n'
    printf 'an executable file" -- apt-cache depends ruby3.3-dev lists libgmp-dev and\n'
    printf 'libruby3.3 and no compiler at all, not even as a Recommends.\n'
    if ask 'Update the package lists and install them?'; then
        if update_lists; then
            attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
        else
            printf 'The package lists could not be updated, so nothing was installed.\n' >&2
        fi
    else
        declined+=("${packages[*]}")
    fi
else
    printf '\n%s carries no colorls group, so no apt packages are offered here.\n' "$map"
    printf 'colorls needs ruby ruby-dev build-essential on every one of the three releases.\n'
    printf 'Install them yourself, or add the colorls rows to that map and run this again.\n'
fi
# Computed, never hard-coded: the 3.3.0 in ~/.local/share/gem/ruby/3.3.0 is the ruby ABI
# version, and gem environment is where USER INSTALLATION DIRECTORY is stated. Computed
# after the apt step, because before it there may be no ruby to ask.
gem_user_dir=''
gem_bin=''
if command -v ruby >/dev/null 2>&1; then
    gem_user_dir=$(ruby -e 'require "rubygems"; print Gem.user_dir' 2>/dev/null || true)
fi
[[ -z "$gem_user_dir" ]] || gem_bin="$gem_user_dir/bin"
printf '\ncolorls itself installs into your own gems, not into the system: one user-owned tree,\n'
printf 'removable with gem uninstall colorls, and no root involved. The resolver pulls in\n'
printf 'clocale, filesize, manpages, rainbow, addressable, public_suffix and\n'
printf 'unicode-display_width, and builds clocale'"'"'s native extension here.\n'
# Said once, so the next reader does not re-add it. The Arch script pins
# unicode-display_width 2.x into the user gems because pacman's 3.x makes colorls exit
# with Gem::MissingSpecError. That is an Arch problem and not one of these: the gemspec
# asks for >= 1.7, < 3.0, the resolver chose 2.6.0 unprompted in all three containers,
# and with apt's ruby-unicode-display-width installed alongside -- 3.3.0-1 on Kali,
# which is the same collision -- colorls still reported 1.5.0 and still listed a
# directory with exit 0. So the pin is not needed and is deliberately not carried over.
printf 'The Arch unicode-display_width 2.x pin is not needed here and is deliberately not\n'
printf 'carried over. The gemspec asks for >= 1.7, < 3.0 and the resolver chose 2.6.0 by\n'
printf 'itself; with apt'"'"'s ruby-unicode-display-width 3.3.0-1 installed alongside on Kali,\n'
printf 'colorls still reported 1.5.0 and still listed a directory with exit 0.\n'
if ask 'Install colorls into your user gems (gem install --user-install)?'; then
    if ! "$dry_run" && ! command -v gem >/dev/null 2>&1; then
        printf 'gem is not on PATH, so colorls cannot be installed. Accept the apt step above\n' >&2
        printf 'first: ruby brings RubyGems with it.\n' >&2
        failed+=('gem install colorls (gem is not installed)')
    else
        # attempt, not run: this step reaches rubygems.org and compiles C, and a failure
        # must leave the rest of the script -- and the alias file's own guard -- intact.
        attempt gem install --user-install --no-document colorls
    fi
else
    declined+=('colorls (gem install --user-install)')
fi
# PATH, dealt with by a symlink rather than by editing anyone's rc file. The gem bin
# directory is on no user's default login PATH on any of the three releases, and
# RubyGems says so itself during the install: "you don't have .../bin in your PATH,
# gem executables (colorls) will not run". ~/.local/bin is on PATH in both shells.
# ln -sfn replaces whatever is at that path, so a file of the user's own -- their own
# wrapper script, or an older link -- has to be copied out first and the prompt has to
# say that a file is about to be replaced. Every other file this repository writes goes
# through install_file, which asks "Back up and replace <path>?" and copies first; this
# step is a symlink rather than a file install, and the policy is the same.
link_gem_executable() {
    local prompt="Link that executable as $link?"
    local copy="$backup_dir/colorls"
    # Already the link this step would make, which is every run after the first:
    # nothing to replace, nothing to back up, and nothing to ask. install_file leaves
    # an identical file alone and says so; this is the same courtesy, and without it
    # every run would drop another copy of the gem executable into a new directory.
    if [[ -L "$link" && "$(readlink -- "$link")" == "$gem_bin/colorls" ]]; then
        printf '%s already points at %s; left as it is.\n' "$link" "$gem_bin/colorls"
        return 0
    fi
    if [[ -L "$link" ]]; then
        printf 'There is already a symbolic link at %s, to %s.\n' "$link" "$(readlink -- "$link")"
        printf 'What it points at is copied into the backup directory before it is repointed.\n'
        prompt="Back up and replace $link with a link to the gem executable?"
    elif [[ -e "$link" ]]; then
        printf 'There is already a file of your own at %s, and it is not a\n' "$link"
        printf 'symbolic link. It is copied into the backup directory before it is replaced.\n'
        prompt="Back up and replace $link with a link to the gem executable?"
    fi
    if ! ask "$prompt"; then
        declined+=("$link")
        return 0
    fi
    # The directory is created first and deliberately: /etc/skel/.profile adds it to
    # PATH at login only if it already exists, so a symlink made into a directory
    # that appears later is reachable only after the login after next.
    run mkdir -p -- "$HOME/.local/bin"
    if [[ -e "$link" || -L "$link" ]]; then
        # cp -aL: a copied symlink would point at a file this step is about to orphan,
        # which is no backup at all. A backup that could not be taken cancels the
        # replacement rather than preceding it, as it does in wire_rc.
        if ! { try mkdir -p -- "$backup_dir" && try cp -aL -- "$link" "$copy"; }; then
            printf 'Could not copy what is at %s, so it was left exactly as it is.\n' "$link" >&2
            skipped+=("$link (its contents could not be copied first)")
            return 0
        fi
        "$dry_run" || printf 'What was at %s is in %s.\n' "$link" "$copy"
    fi
    attempt ln -sfn -- "$gem_bin/colorls" "$link"
    case ":$PATH:" in
        *":$HOME/.local/bin:"*)
            printf '%s is already on this shell'"'"'s PATH.\n' "$HOME/.local/bin" ;;
        *)  printf '%s is not on this shell'"'"'s PATH yet, so colorls is installed\n' "$HOME/.local/bin"
            printf 'and not yet reachable by name. Start a new login shell -- or source ~/.zshrc,\n'
            printf 'whose path= line adds the directory without waiting for a login.\n' ;;
    esac
}
printf '\n'
if [[ -z "$gem_bin" ]]; then
    printf 'ruby is not installed here, so the gem bin directory could not be computed and\n'
    printf 'nothing was linked. It is $(ruby -e '"'"'require "rubygems"; print Gem.user_dir'"'"')/bin.\n'
else
    printf 'The gem writes its executable to %s,\n' "$gem_bin/colorls"
    printf 'and that directory is on no user'"'"'s default login PATH -- RubyGems warns about it\n'
    printf 'during the install. %s is on PATH in both shells, so one symlink there is\n' "$HOME/.local/bin"
    printf 'enough and no rc file has to learn a new directory.\n'
    if ! "$dry_run" && [[ ! -x "$gem_bin/colorls" ]]; then
        printf 'There is no executable at %s, so nothing was linked:\n' "$gem_bin/colorls"
        printf 'a symlink to a file that is not there is worse than no symlink.\n' >&2
        skipped+=("$link (no colorls executable to link)")
    else
        link_gem_executable
    fi
fi
# Appends the guarded source line once, with a backup of the file first. The guard is
# the grep, not the comment: a file that already names the snippet -- the bundled zshrc
# does, and so does this file on its second run -- is left untouched.
wire_rc() {
    local rc=$1 target=''
    # A dangling link is not a file to append to, and -f alone would have called it
    # absent: appending would create the file the link names, somewhere the user did
    # not ask for it.
    if [[ -L "$rc" && ! -e "$rc" ]]; then
        printf '%s is a symbolic link to %s, which is not there, so nothing\n' "$rc" "$(readlink -- "$rc")"
        printf 'was wired into it. Repair the link, or the file it names, and run this again.\n'
        skipped+=("$rc (a symbolic link to a file that is not there)")
        return 0
    fi
    [[ -f "$rc" ]] || { printf '%s does not exist, so nothing was wired into it.\n' "$rc"; return 0; }
    if grep -qF '.config/shell/colorls.sh' -- "$rc"; then
        printf '%s already sources the alias file; left as it is.\n' "$rc"
        return 0
    fi
    # Said before the prompt, not after it: on a machine where a dotfiles checkout owns
    # the rc files, the line lands in that checkout's file and the reader should know
    # which file is about to change.
    if [[ -L "$rc" ]]; then
        target=$(readlink -f -- "$rc" 2>/dev/null || true)
        printf '%s is a symbolic link to %s.\n' "$rc" "${target:-$(readlink -- "$rc")}"
        printf 'The line is appended through the link, so it lands in that file and the file\n'
        printf 'stays part of whatever manages it. A copy of its contents is taken first.\n'
    fi
    if ! ask "Append the one source line that loads those aliases to $rc?"; then
        declined+=("$rc")
        return 0
    fi
    if "$dry_run"; then
        printf '  Would append the colorls source line to %s\n' "$rc"
        return 0
    fi
    # The backup comes first, and a backup that could not be taken cancels the append:
    # this file is the only copy of whatever the user had in it.
    local copy="$backup_dir/${rc##*/}"
    # cp -aL, and the L is the whole point: -a implies -P, so a symlinked rc file was
    # backed up as another copy of the link -- a link to the very file the append below
    # then modifies, which is no backup at all and left the pre-run content nowhere.
    # lib/common.sh's install_file uses -aL for exactly this reason.
    if ! { try mkdir -p -- "$backup_dir" && try cp -aL -- "$rc" "$copy"; }; then
        printf 'Could not back up %s, so it was left exactly as it is.\n' "$rc" >&2
        return 0
    fi
    printf '\n# colorls aliases (ls = colorls -l), shared by Bash and Zsh.\n%s\n' "$source_line" >> "$rc"
    printf 'Appended one line to %s; the file as it was is in %s.\n' "$rc" "$copy"
}
printf '\n%s/shell/colorls.sh is the alias file, shared by both shells and installed\n' "$target_config"
printf 'unmodified from this bundle. It guards itself with command -v colorls, so it is inert\n'
printf 'until the gem install above has worked.\n'
if ask "Install the ls, ll and la aliases into $target_config/shell/colorls.sh?"; then
    install_file "$bundle_dir/config/shell/colorls.sh" shell/colorls.sh
else
    declined+=("$target_config/shell/colorls.sh")
fi
# Both shells are offered, and for different reasons. The bundled zshrc already carries
# this line and setup-zsh.sh installs it, so on a machine set up by this repository the
# Zsh call finds the line and does nothing; it is here for a ~/.zshrc that is not the
# bundled one. The repository ships no bashrc at all and install.sh wires nothing, so
# Bash is the one that genuinely needs the line.
printf '\n'
wire_rc "$HOME/.bashrc"
wire_rc "$HOME/.zshrc"
if (( ${#font_packages[@]} )); then
    printf '\nIcons need a patched font, and no archive carries one. %s is\n' "${font_packages[*]}"
    printf 'the plain family, offered here because it is the one the map already names: it is\n'
    printf 'the right monospace face, and it is not the Nerd Font.\n'
    printf 'Measured rather than assumed: dpkg -L %s matches nothing\n' "${font_packages[*]}"
    printf 'case-insensitively against "nerd" in any of the three images, and on Debian with\n'
    printf 'fontconfig installed none of the four Nerd codepoints checked (e5ff, f07b, f1c9,\n'
    printf 'e73c) is covered by the family, while fc-match "JetBrainsMono Nerd Font" answers\n'
    printf 'DejaVu Sans. That fontconfig check was run on Debian only. So colorls draws\n'
    printf 'substitution boxes where its icons go until a patched font is installed by hand.\n'
    printf 'This repository has no Nerd Font step yet; installing one is still a manual job.\n'
    if ask "Install ${font_packages[*]} with apt?"; then
        if update_lists; then
            attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${font_packages[@]}"
        else
            printf 'The package lists could not be updated, so the font was not installed.\n' >&2
        fi
    else
        declined+=("${font_packages[*]}")
    fi
fi
if (( ${#unavailable[@]} )); then printf '\nNot packaged on %s: %s\n' "$family" "${unavailable[*]}"; fi
if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
finished=true
