#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Only configure touchpads exposing tapping AND two-finger support.
[ -n "${DISPLAY:-}" ] || exit 0
command -v xinput >/dev/null || exit 0
xinput list --id-only | while IFS= read -r device_id; do
    props=$(xinput list-props "$device_id" 2>/dev/null) || continue
    printf '%s\n' "$props" | grep -q 'libinput Tapping Enabled' || continue
    printf '%s\n' "$props" | grep -Eq 'libinput Scroll Methods Available.*:[[:space:]]+1,' || continue
    xinput set-prop "$device_id" 'libinput Scroll Method Enabled' 1 0 0
    xinput set-prop "$device_id" 'libinput Tapping Enabled' 1
    xinput set-prop "$device_id" 'libinput Natural Scrolling Enabled' 1
    xinput set-prop "$device_id" 'libinput Disable While Typing Enabled' 1
    xinput set-prop "$device_id" 'libinput Accel Speed' 0.3
done
