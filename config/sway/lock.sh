#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -eu
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
# -f returns only once the session is locked, important before system sleep.
exec swaylock -f -C "$config_root/swaylock/config"
