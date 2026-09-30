#!/bin/sh
# Copy the selected emoji; do not send synthetic typing to another application.
# Debian and Ubuntu do not package the Rofi emoji plugin, so check for it first
# and say so rather than opening an empty picker. ROFI_PLUGIN_PATH is a test hook.
set -eu
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
found=false
for dir in ${ROFI_PLUGIN_PATH:-/usr/lib/*/rofi /usr/lib/rofi /usr/local/lib/rofi}; do
    if [ -e "$dir/emoji.so" ]; then found=true; break; fi
done
if [ "$found" = false ]; then
    message='The Rofi emoji plugin is not packaged on Debian or Ubuntu. Build rofi-emoji from source to enable this picker.'
    if command -v notify-send >/dev/null; then notify-send 'Emoji picker' "$message"; fi
    printf '%s\n' "$message" >&2
    exit 0
fi
exec rofi -no-config -modi emoji -show emoji -emoji-mode copy \
    -emoji-format '{emoji}  {name}' -theme "$config_root/rofi/emoji.rasi"
