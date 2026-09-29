#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -Eeuo pipefail
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "$LINENO" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h) printf 'Usage: bash setup-nvim.sh [--dry-run]\n'; exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
(( EUID != 0 )) || { printf 'Run as your normal user, not root.\n' >&2; exit 1; }
ask() { local answer; read -r -p "$1 [y/N] " answer || return 1; [[ "$answer" == y || "$answer" == Y || "$answer" == yes ]]; }
run() { printf '  '; printf '%q ' "$@"; printf '\n'; if ! "$dry_run"; then "$@"; fi; }
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
# The editor tooling comes from the same map as everything else.
mapfile -t tools < <(awk -F'\t' '$1 == "editor-tools" && $3 != "-" { print $3 }' "$bundle_dir/packages/apt-map.tsv" | sort -u)
if ask 'Install the Neovim tooling (Node, Go, ripgrep, fd, fonts) with apt?'; then
    run sudo apt-get install -y "${tools[@]}" git build-essential php-cli composer curl unzip xclip
fi
# This configuration needs Neovim 0.11 or newer; Debian 13 ships 0.10.4.
candidate=$(apt-cache policy neovim 2>/dev/null | awk '/Candidate:/{print $2; exit}')
version=${candidate#*:}; version=${version%%-*}
major=${version%%.*}; rest=${version#*.}; minor=${rest%%.*}
new_enough=false
if [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] && (( major > 0 || minor >= 11 )); then
    new_enough=true
fi
if "$new_enough"; then
    printf 'apt offers Neovim %s, which this configuration supports.\n' "$version"
    if ask 'Install Neovim from apt?'; then run sudo apt-get install -y neovim; fi
else
    printf 'apt offers Neovim %s, older than the 0.11 this configuration needs.\n' "${version:-unknown}"
    if ask 'Install the upstream Neovim release into ~/.local/opt instead?'; then
        tarball="$HOME/.local/opt/nvim-linux-x86_64.tar.gz"
        run mkdir -p -- "$HOME/.local/opt" "$HOME/.local/bin"
        run curl -fsSLo "$tarball" https://github.com/neovim/neovim/releases/latest/download/nvim-linux-x86_64.tar.gz
        run tar -xzf "$tarball" -C "$HOME/.local/opt"
        run ln -sfn "$HOME/.local/opt/nvim-linux-x86_64/bin/nvim" "$HOME/.local/bin/nvim"
        printf 'Ensure ~/.local/bin precedes /usr/bin in PATH, or nvim will resolve to the apt version.\n'
    fi
fi
if ask 'Back up the current Neovim configuration and restore this bundle?'; then
    backup_root="${XDG_STATE_HOME:-$HOME/.local/state}/debian-desktop-setup/nvim-$(date +%Y%m%d-%H%M%S)-$$"
    if [[ -e "$config_root/nvim" || -L "$config_root/nvim" ]]; then
        run mkdir -p -- "$backup_root"
        run mv -- "$config_root/nvim" "$backup_root/nvim"
        printf 'Previous configuration retained at %s/nvim\n' "$backup_root"
    fi
    run mkdir -p -- "$config_root"
    run cp -a -- "$bundle_dir/config/nvim" "$config_root/nvim"
fi
if ask 'Download the locked Neovim plugins?'; then
    run nvim --headless '+Lazy! restore' '+qa!'
fi
if ask 'Install the configured Mason language servers and formatters?'; then
    for tool in node npm php composer go; do
        if ! "$dry_run" && ! command -v "$tool" >/dev/null; then
            printf 'Missing %s; rerun and accept the tooling step first.\n' "$tool" >&2
            exit 1
        fi
    done
    run nvim --headless '+MasonToolsInstallSync' '+qa!'
fi
printf '\nRestart Neovim after tool installation. Leader is Space; Space + ? searches keymaps.\n'
printf 'Rust tooling and the Laravel language server are installed in a later phase.\n'
