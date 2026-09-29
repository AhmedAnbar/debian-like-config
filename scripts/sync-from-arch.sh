#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Report, or pull back, configuration that has drifted from arch-desktop-setup.
set -Eeuo pipefail
trap 'printf "Stopped at line %s. Review the error above before retrying.\n" "${BASH_LINENO[0]:-$LINENO}" >&2' ERR
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
    # --pull overwrites files in place; git is what makes that reversible.
    if ! git -C "$bundle_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        printf -- '--pull replaces files in place and needs a git checkout to undo that. This is not one.\n' >&2
        printf 'Compare with --check and copy the files you want by hand.\n' >&2
        exit 1
    fi
    if ! git -C "$bundle_dir" diff --quiet || ! git -C "$bundle_dir" diff --cached --quiet; then
        printf 'Commit or stash your changes before --pull, so the copy is reviewable.\n' >&2
        exit 1
    fi
    # An untracked file has no copy in git at all, so overwriting it loses the only one.
    if (( ${#drifted[@]} )); then
        untracked=$(git -C "$bundle_dir" ls-files --others --exclude-standard -- "${drifted[@]}")
        if [[ -n "$untracked" ]]; then
            printf 'These drifted files are untracked, so git cannot undo an overwrite:\n' >&2
            while IFS= read -r file; do printf '  %s\n' "$file" >&2; done <<< "$untracked"
            printf 'Commit them first, then run --pull again.\n' >&2
            exit 1
        fi
    fi
    for relative in "${drifted[@]}"; do
        cp -a -- "$arch_dir/$relative" "$bundle_dir/$relative"
        printf 'pulled\t%s\n' "$relative"
    done
    printf 'Pulled %d file(s). Review with git diff, then run the tests.\n' "${#drifted[@]}"
    exit 0
fi
(( ${#drifted[@]} == 0 && ${#missing[@]} == 0 )) || exit 1
