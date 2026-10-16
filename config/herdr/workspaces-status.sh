#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# tmux-style workspace list for the Herdr tab row: "1:Projects*  2:nuvora".
# Herdr keeps only the last line and strips escape sequences, so print one plain line.
herdr workspace list 2>/dev/null | jq -j '
  [.result.workspaces[] | "\(.number):\(.label)" + (if .focused then "*" else "" end)]
  | join("  ")'
