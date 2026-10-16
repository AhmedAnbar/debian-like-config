#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -Eeuo pipefail
trap '__err_line=${BASH_LINENO[0]:-0}; (( __err_line > 0 )) || __err_line=$LINENO; printf "Setup stopped at line %s. Review the error above before retrying.\n" "$__err_line" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h) printf 'Usage: bash setup-zsh.sh [--dry-run]\n'; exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
source "$bundle_dir/lib/common.sh"
require_normal_user
if ask 'Install Zsh, Git, autosuggestions and syntax highlighting with apt?'; then
    run sudo apt-get install -y zsh git zsh-autosuggestions zsh-syntax-highlighting
fi
if [[ ! -e "$HOME/.oh-my-zsh" ]]; then
    if ask 'Download Oh My Zsh from its official repository?'; then
        run git clone --depth=1 https://github.com/ohmyzsh/ohmyzsh.git "$HOME/.oh-my-zsh"
    fi
fi
if ask 'Apply the bundled zshrc (your existing file is backed up first)?'; then
    if ! "$dry_run"; then
        command -v zsh >/dev/null || { printf 'Install Zsh first.\n' >&2; exit 1; }
        zsh -n "$bundle_dir/zsh/zshrc"
    fi
    if [[ -e "$HOME/.zshrc" || -L "$HOME/.zshrc" ]]; then
        if [[ -e "$HOME/.zshrc" ]]; then
            # -aL, not -a: a dotfiles-managed .zshrc is a symbolic link, and copying the
            # link leaves a backup that holds no content of its own -- worthless as soon
            # as the checkout it points into moves. install_file in lib/common.sh
            # dereferences for the same reason.
            run cp -aL "$HOME/.zshrc" "$HOME/.zshrc.backup-$(date +%Y%m%d-%H%M%S)-$$"
        else
            # -L without -e: a link whose target is gone. There is nothing to copy, and
            # cp -aL would end the run here, so say so and carry on.
            printf '%s is a symbolic link with no target, so there is nothing to back up.\n' \
                "$HOME/.zshrc"
        fi
        run unlink "$HOME/.zshrc"
    fi
    run install -m644 "$bundle_dir/zsh/zshrc" "$HOME/.zshrc"
    # Debian puts the plugins under /usr/share; the zshrc sources them from there.
    printf 'Plugins are sourced from /usr/share/zsh-autosuggestions and /usr/share/zsh-syntax-highlighting.\n'
fi
if ask 'Make /usr/bin/zsh your login shell?'; then
    run chsh -s /usr/bin/zsh
fi
printf 'Open Zsh now with: zsh\nLog out and back in after changing your login shell.\n'
