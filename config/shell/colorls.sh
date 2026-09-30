# SPDX-License-Identifier: GPL-3.0-only
# Sourced by ~/.bashrc and ~/.zshrc: colorls replaces ls in interactive shells.
# Nothing changes until colorls is installed. GNU ls stays available as `command ls` or `\ls`.
if command -v colorls >/dev/null 2>&1; then
    alias ls='colorls -l'
    # colorls has no -h: sizes are already human-readable.
    alias ll='colorls -la'
    alias la='colorls -A'
fi
