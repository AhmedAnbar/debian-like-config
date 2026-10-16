# SPDX-License-Identifier: GPL-3.0-only
# Set only the workspace-tab keys in conventional table-based Herdr TOML:
# the [ui] sidebar and tab row, plus the [keys] workspace navigation.
# The caller rejects multiline strings and validates the resulting TOML.
function emit_ui() {
    print "sidebar_start_collapsed = true"
    print "sidebar_collapsed_mode = \"hidden\""
    print "tab_bar_right = [{ type = \"command\", command = \"" CMD "\", interval_seconds = 1, timeout_seconds = 2 }]"
    print "tab_bar_right_separator = \"  \""
}
function emit_keys() {
    # prefix+1..9 already switches tabs, so workspaces take the shifted digits.
    print "switch_workspace = \"prefix+shift+1..9\""
    print "next_workspace = \"prefix+alt+n\""
    print "previous_workspace = \"prefix+alt+p\""
}
function flush_blanks() {
    while (blanks-- > 0) print ""
    blanks = 0
}
# Managed keys join the end of their table, before any blank line that closes it.
function close_table() {
    if (in_ui) emit_ui()
    if (in_keys) emit_keys()
    flush_blanks()
}
in_ui || in_keys {
    if ($0 ~ /^[[:space:]]*$/) { blanks++; next }
}
/^[[:space:]]*\[/ {
    close_table()
    in_ui = ($0 ~ /^[[:space:]]*\[[[:space:]]*ui[[:space:]]*\][[:space:]]*(#.*)?$/)
    in_keys = ($0 ~ /^[[:space:]]*\[[[:space:]]*keys[[:space:]]*\][[:space:]]*(#.*)?$/)
    if (in_ui) found_ui = 1
    if (in_keys) found_keys = 1
    print
    next
}
in_ui && /^[[:space:]]*(sidebar_start_collapsed|sidebar_collapsed_mode|tab_bar_right|tab_bar_right_separator)[[:space:]]*=/ {
    # A managed key whose array spills onto later lines needs manual editing.
    if ($0 ~ /\[/ && $0 !~ /\]/) {
        printf "A multi-line %s array needs manual editing; file unchanged.\n", $1 > "/dev/stderr"
        bail = 1
        exit 1
    }
    next
}
in_keys && /^[[:space:]]*(switch_workspace|next_workspace|previous_workspace)[[:space:]]*=/ { next }
{ flush_blanks(); print }
END {
    if (bail) exit 1
    close_table()
    if (!found_ui) {
        print ""
        print "[ui]"
        emit_ui()
    }
    if (!found_keys) {
        print ""
        print "[keys]"
        emit_keys()
    }
}
