#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Called only after setup-herdr.sh asks permission. Does not reload/stop servers.
set -Eeuo pipefail
target=${1:?Pass the Herdr config path}
herdr_binary=${2:?Pass the installed Herdr executable}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ -L "$target" || ( -e "$target" && ! -f "$target" ) ]]; then
    printf 'Refusing to replace a symlink or non-regular config: %s\n' "$target" >&2
    exit 1
fi
source_file=/dev/null
if [[ -f "$target" ]]; then
    source_file=$target
    HERDR_CONFIG_PATH="$target" "$herdr_binary" config check
    # Never risk interpreting a section-like line inside a multiline TOML string.
    if grep -q -e '"""' -e "'''" "$target"; then
        printf 'Config contains multiline TOML strings. Set [keys] prefix = "ctrl+a" manually; file unchanged.\n' >&2
        exit 1
    fi
fi
mkdir -p -- "$(dirname -- "$target")"
staged=$(mktemp "$(dirname -- "$target")/.herdr-prefix.XXXXXXXX")
cleanup() { if [[ -f "$staged" ]]; then unlink -- "$staged"; fi; }
trap cleanup EXIT
awk -f "$script_dir/herdr-prefix.awk" "$source_file" > "$staged"
# Fail closed on unusual inline/quoted TOML keys rather than damaging the config.
HERDR_CONFIG_PATH="$staged" "$herdr_binary" config check
if [[ -f "$target" ]] && cmp -s -- "$staged" "$target"; then
    printf 'Herdr already uses Ctrl+A; config unchanged.\n'
    exit 0
fi
if [[ -f "$target" ]]; then
    backup="$target.backup-$(date +%Y%m%d-%H%M%S)-$$"
    cp -a -- "$target" "$backup"
    chmod --reference="$target" "$staged"
    printf 'Configuration backup: %s\n' "$backup"
fi
mv -- "$staged" "$target"
printf 'Herdr prefix is now Ctrl+A. Use the Herdr menu to reload config in an open client.\n'
