#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -u
export XDG_CURRENT_DESKTOP=sway XDG_SESSION_TYPE=wayland MOZ_ENABLE_WAYLAND=1
# Portals must get this session's Wayland socket, not an old X11 environment.
dbus-update-activation-environment --systemd DISPLAY WAYLAND_DISPLAY SWAYSOCK \
    XDG_CURRENT_DESKTOP XDG_SESSION_TYPE MOZ_ENABLE_WAYLAND
gsettings set org.gnome.desktop.interface color-scheme prefer-dark

# No Picom, xss-lock, Flameshot or X11-wide autostart under Sway.
# Clipboard history for the Alt+c Rofi picker; text and images need separate watchers.
if command -v cliphist >/dev/null; then
    wl-paste --type text --watch cliphist store &
    wl-paste --type image --watch cliphist store &
fi
mako &
nm-applet --indicator &
blueman-applet &
# Debian 13 dropped policykit-1-gnome; mate-polkit is the GTK agent in both releases.
# Ubuntu still has the GNOME one, so try each packaged location and say nothing if a
# desktop already runs an agent of its own.
for agent in /usr/libexec/polkit-mate-authentication-agent-1 \
    /usr/lib/mate-polkit/polkit-mate-authentication-agent-1 \
    /usr/lib/policykit-1-gnome/polkit-gnome-authentication-agent-1; do
    if [ -x "$agent" ]; then "$agent" & break; fi
done

# No idle locking: the screen only goes black, and Alt+l locks when you want it.
# before-sleep and lock stay, so suspend and loginctl lock-session still lock.
exec swayidle -w \
    timeout 300 'swaymsg "output * power off"' \
        resume 'swaymsg "output * power on"' \
    before-sleep 'sh ~/.config/sway/lock.sh' \
    lock 'sh ~/.config/sway/lock.sh'
