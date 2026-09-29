#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Report, or pull back, configuration that has drifted from arch-desktop-setup.
set -Eeuo pipefail
trap 'printf "Stopped at line %s. Review the error above before retrying.\n" "$LINENO" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
mode=check
case "${1:-}" in
    --check|'') mode=check ;;
    --pull) mode=pull ;;
    --help|-h)
        printf 'Usage: bash scripts/sync-from-arch.sh [--check|--pull]\n'
        printf '  --check  report same/drifted/missing for every shared file (default)\n'
        printf '  --pull   copy drifted shared files back from the Arch checkout\n'
        printf 'The checkout is $ARCH_SETUP_DIR, or ~/arch-desktop-setup.\n'
        exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
arch_dir=${ARCH_SETUP_DIR:-$HOME/arch-desktop-setup}
if [[ ! -d "$arch_dir" ]]; then
    printf 'No Arch checkout at %s, so there is nothing to compare.\n' "$arch_dir"
    printf 'Set ARCH_SETUP_DIR to compare against a checkout elsewhere.\n'
    exit 0
fi
drifted=()
missing=()
while IFS= read -r relative; do
    [[ -n "$relative" ]] || continue
    if [[ ! -f "$arch_dir/$relative" ]]; then
        printf 'missing\t%s\n' "$relative"; missing+=("$relative"); continue
    fi
    if cmp -s "$arch_dir/$relative" "$bundle_dir/$relative"; then
        printf 'same\t%s\n' "$relative"
    else
        printf 'drifted\t%s\n' "$relative"; drifted+=("$relative")
    fi
done < "$bundle_dir/scripts/shared-files.txt"
printf '\n%d drifted, %d missing upstream.\n' "${#drifted[@]}" "${#missing[@]}"
if [[ "$mode" == pull ]]; then
    if ! git -C "$bundle_dir" diff --quiet || ! git -C "$bundle_dir" diff --cached --quiet; then
        printf 'Commit or stash your changes before --pull, so the copy is reviewable.\n' >&2
        exit 1
    fi
    for relative in "${drifted[@]}"; do
        cp -a -- "$arch_dir/$relative" "$bundle_dir/$relative"
        printf 'pulled\t%s\n' "$relative"
    done
    printf 'Pulled %d file(s). Review with git diff, then run the tests.\n' "${#drifted[@]}"
    exit 0
fi
(( ${#drifted[@]} == 0 && ${#missing[@]} == 0 )) || exit 1
