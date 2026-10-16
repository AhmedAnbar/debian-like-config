# SPDX-License-Identifier: GPL-3.0-only
# Update only keys.prefix in conventional table-based Herdr TOML.
# The caller rejects multiline strings and validates the resulting TOML.
function finish_keys() {
    if (in_keys && !has_prefix) print "prefix = \"ctrl+a\""
}
/^[[:space:]]*\[/ {
    finish_keys()
    in_keys = ($0 ~ /^[[:space:]]*\[[[:space:]]*keys[[:space:]]*\][[:space:]]*(#.*)?$/)
    if (in_keys) found_keys = 1
    has_prefix = 0
}
in_keys && /^[[:space:]]*prefix[[:space:]]*=/ {
    # Keep an already-correct line (including its comments/spacing) unchanged.
    if ($0 ~ /^[[:space:]]*prefix[[:space:]]*=[[:space:]]*"ctrl\+a"[[:space:]]*(#.*)?$/) print
    else print "prefix = \"ctrl+a\""
    has_prefix = 1
    next
}
{ print }
END {
    finish_keys()
    if (!found_keys) print "\n[keys]\nprefix = \"ctrl+a\""
}
