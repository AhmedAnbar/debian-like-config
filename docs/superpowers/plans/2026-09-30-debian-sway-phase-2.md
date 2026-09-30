# Sway session (phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Sway/Wayland session to `debian-desktop-setup` that installs from apt on Debian 13 and Ubuntu 26.04, leaves the phase 1 i3 desktop untouched, and ships its own emoji picker, hardware profile and browser decision.

**Architecture:** A new `setup-sway.sh` beside `install.sh`, both sourcing a new `lib/common.sh` that owns the single consent-and-backup path. The Sway configuration tree is copied from `arch-desktop-setup` and drift-checked; three files are adapted where Debian differs. A new `sway` group in `packages/apt-map.tsv` carries the 38 packages, verified against both releases in containers.

**Tech Stack:** bash (`set -Eeuo pipefail`), Node's `node:assert/strict` for tests with no framework, Docker (`debian:stable-slim`, `ubuntu:latest`) for package and headless-compositor verification, sway 1.10.1/1.11, waybar 0.12.0/0.15.0.

**Spec:** `docs/superpowers/specs/2026-09-30-debian-sway-phase-2-design.md`

## Global Constraints

- Every file starts with `# SPDX-License-Identifier: GPL-3.0-only`; the two installer scripts also carry `# Copyright (C) 2026 AhmedAnbar`.
- Every bash script: `set -Eeuo pipefail` and the ERR trap reporting `"${BASH_LINENO[0]:-$LINENO}"`, never bare `$LINENO`.
- Every step that changes the system is behind `ask`, and answering no leaves the machine as it was.
- Every replaced file is backed up under `$HOME/.local/state/debian-desktop-setup/<timestamp>-<pid>/` before replacement, through `install_file` and no other path.
- Optional steps use `attempt`, never `run`, so one failure neither aborts the script nor suppresses the summary.
- No `sudo` outside a `run`/`attempt` call. Tests never run as root and never touch the real system.
- Reference releases: Debian 13 trixie (sway 1.10.1, waybar 0.12.0, snapd 2.68.3, mate-polkit 1.26.1-4, unicode-data 15.1.0) and Ubuntu 26.04.1 LTS (sway 1.11, waybar 0.15.0, snapd 2.76.3, mate-polkit 1.26.1-6, unicode-data 16.0.0).
- `packages/apt-map.tsv` rule: no Arch name may appear twice for the same release. `both` collides with everything; `debian` and `ubuntu` do not collide with each other.
- The README claims only what a test in this repository shows. Anything needing a display says so.
- Commits name only Ahmed Anbar. No `Co-Authored-By` trailer of any kind.
- Container tests stay behind `DEBIAN_SETUP_CONTAINER_TESTS=1` so the fast suite runs without Docker.

## Review Focus

These five conditions the spec implies are each pinned by a test named in the task that owns the code.

1. **`setup-sway.sh` on a machine where `install.sh` never ran.** `launcher.sh`, `clipboard.sh` and the emoji picker all pass `-theme "$config_root/rofi/active-theme.rasi"` to rofi, which phase 1 installs. Without it every launcher keystroke fails silently. Expected: the installer says so before finishing, and offers to write the theme pointer itself. Pinned in Task 4.
2. **Run outside a Sway session.** `swaymsg -t get_outputs` cannot work without `SWAYSOCK`, and the profile step must skip rather than write a profile naming nothing. Expected: a clear "log in to Sway first" message and exit 0. Pinned in Task 7.
3. **The Ubuntu browser step with no network.** The snap installation inside apt's `postinst` fails; the run must record it and continue to the configuration, which is the part that does not need a network. Pinned in Task 2.
4. **The configuration bundle accepted while the packages were declined.** `sway -C` cannot validate a config when `sway` is not installed. Expected: the validation step is skipped with a reason, not reported as a failure. Pinned in Task 5.
5. **`wtype` refused by the compositor.** The virtual-keyboard protocol may be unavailable or a lock screen may hold input. Expected: the emoji picker copies the character with `wl-copy` and says so, rather than losing the choice. Pinned in Task 6.

---

## File structure

| File | Responsibility |
| --- | --- |
| `lib/common.sh` (new) | `ask`, `run`, `attempt`, `install_file`, `detect_release`, `map_group_packages`, `require_normal_user`, `require_apt_get`, `summary_prologue`, and the `declined`/`failed` accumulators. No policy, no prompts of its own. |
| `install.sh` (modify) | Phase 1's i3 installer, now sourcing the library instead of defining the helpers. |
| `setup-sway.sh` (new) | The optional Sway installer: packages, configuration, validation, profile, greeter, summary. |
| `packages/apt-map.tsv` (modify) | Gains the `sway` group, the second `firefox` row, `snapd`, `xdotool`, `unicode-data`, `wtype`. |
| `config/sway/**`, `config/waybar/**`, `config/mako/**`, `config/swaylock/**`, `config/xdg-desktop-portal/**` (new) | The session, copied from `arch-desktop-setup`; three files adapted. |
| `config/i3/emoji.sh` (rewrite) | The bundled picker, installed to `i3/emoji.sh` and `sway/emoji.sh`, replacing phase 1's unavailable stub. |
| `profiles/zenbook-um5606.conf` (new) | The Zenbook output and touchscreen settings. |
| `tests/setup-sway-smoke.js`, `tests/emoji-smoke.js`, `tests/sway-container-smoke.js` (new) | Prompts and profiles against stubs; the picker against a fixture; sway and waybar in containers. |

---

### Task 1: `lib/common.sh` — the pure move

**Files:**
- Create: `lib/common.sh`
- Modify: `install.sh` (lines 8-71 and 189-210, the helper and summary regions)
- Test: `tests/install-smoke.js` (unmodified — that is the point)

**Interfaces:**
- Consumes: nothing.
- Produces: `ask "<question>"` → 0 on y/Y/yes, 1 otherwise and on closed stdin. `run <cmd...>` → prints the command, runs it unless `$dry_run`. `attempt <cmd...>` → runs through `run`, appends `"$*"` to `failed` on failure, always returns 0. `install_file <source> <relative> [mode=644] [root=$target_config]` → consent, backup, install; appends to `declined` on a no. `detect_release <os-release path>` → sets `release` (`debian`|`ubuntu`), `family` (`Debian`|`Ubuntu`), `distro_name`; exits 1 with a message on anything else. `require_normal_user`, `require_apt_get` → exit 1 with a message. `summary_prologue` → prints the failed and declined lists and the backup path. Arrays `declined` and `failed` are declared by the library.
- The sourcing script sets `dry_run`, `target_config` and `backup_dir` **before** sourcing.

- [ ] **Step 1: Run the phase 1 suite and record the baseline**

```bash
cd ~/debian-desktop-setup
for t in tests/*.js; do printf '%-32s' "$t"; node "$t" >/dev/null 2>&1 && echo OK || echo FAIL; done
```

Expected: six OK. This is the contract for the whole task: the same six files, unmodified, must print OK at the end. If any test needs an edit, the move stopped being pure — stop and reconsider rather than editing the test.

- [ ] **Step 2: Create `lib/common.sh` by moving, not rewriting**

Cut the following from `install.sh` verbatim — `ask`, `run`, `attempt`, `install_file`, the `declined=()` and `failed=()` declarations — and paste them into the new file under this header. Add the three new functions, which are the guard and detection lines from `install.sh` wrapped in function bodies with no change to their text.

```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Shared by install.sh and setup-sway.sh. Sourced, never executed: the sourcing
# script sets dry_run, target_config and backup_dir first, and this file holds no
# policy of its own — every prompt belongs to the script that asks it.
declined=()
failed=()
require_normal_user() {
    if (( EUID == 0 )); then
        printf 'Run as your normal user, without sudo. Commands needing root will use sudo.\n' >&2
        exit 1
    fi
}
require_apt_get() {
    command -v apt-get >/dev/null || { printf 'This installer requires apt-get: Debian or Ubuntu.\n' >&2; exit 1; }
}
# Sets release, family and distro_name. os-release is shell syntax, so it is read
# in subshells: a stray variable in that file must not become one of ours.
detect_release() {
    local os_release=$1 distro_id distro_like
    [[ -r "$os_release" ]] || { printf 'Cannot read %s, so the distribution is unknown.\n' "$os_release" >&2; exit 1; }
    distro_id=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${ID:-}")
    distro_like=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${ID_LIKE:-}")
    distro_name=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${PRETTY_NAME:-${ID:-}}")
    [[ -n "$distro_id" ]] || { printf '%s has no ID line, so the distribution is unknown.\n' "$os_release" >&2; exit 1; }
    case "$distro_id" in
        debian) release=debian family=Debian ;;
        ubuntu) release=ubuntu family=Ubuntu ;;
        *)  case " $distro_like " in
                *" ubuntu "*) release=ubuntu family=Ubuntu ;;
                *" debian "*) release=debian family=Debian ;;
                *)  printf 'Unsupported distribution: %s.\n' "$distro_id" >&2
                    printf 'This installer supports Debian 13 and Ubuntu 26.04, and derivatives that name one of them in ID_LIKE.\n' >&2
                    exit 1 ;;
            esac ;;
    esac
}
ask() {
    local answer
    read -r -p "$1 [y/N] " answer || return 1
    [[ "$answer" == y || "$answer" == Y || "$answer" == yes ]]
}
run() {
    printf '  '; printf '%q ' "$@"; printf '\n'
    if ! "$dry_run"; then "$@"; fi
}
# An optional step that fails must not abort the installation: the steps after it are
# independent, and a machine left half configured with no summary is the worst outcome.
attempt() {
    if run "$@"; then return 0; fi
    printf 'That step failed; continuing with the rest.\n' >&2
    failed+=("$*")
    return 0
}
# Every file either installer writes goes through here: one consent prompt, one backup,
# one place where the mode is decided.
install_file() {
    local source=$1 relative=$2 mode=${3:-644} root=${4:-$target_config}
    local destination="$root/$relative"
    if [[ -f "$destination" ]] && cmp -s "$source" "$destination"; then
        printf 'Unchanged: %s\n' "$destination"; return 0
    fi
    if [[ -e "$destination" || -L "$destination" ]]; then
        ask "Back up and replace $destination?" || { declined+=("$destination"); return 0; }
        run mkdir -p -- "$backup_dir/$(dirname -- "$relative")"
        if [[ ! -e "$backup_dir/$relative" && ! -L "$backup_dir/$relative" ]]; then
            # -L copies what the link points at: a copied relative symlink would be a
            # dead link inside the backup directory, which is no backup at all.
            run cp -aL -- "$destination" "$backup_dir/$relative"
        fi
        # Replace a symlink itself rather than writing through it into a dotfiles checkout.
        run unlink -- "$destination"
    fi
    run install -Dm"$mode" -- "$source" "$destination"
}
# The part of the closing summary both installers share. The caller prints its own
# closing lines after this and decides the exit status.
summary_prologue() {
    if (( ${#failed[@]} )); then printf 'Steps that failed:\n'; printf '  %s\n' "${failed[@]}"; fi
    if (( ${#declined[@]} )); then printf 'Left alone at your request:\n'; printf '  %s\n' "${declined[@]}"; fi
    printf 'Backups, when needed: %s\n' "$backup_dir"
}
```

- [ ] **Step 3: Source the library from `install.sh`**

Replace the deleted regions in `install.sh`. After the `--dry-run`/`--help` argument case and before the first guard, insert:

```bash
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep install.sh with its lib folder.\n' >&2; exit 1; }
target_config="$HOME/.config"
backup_dir="$HOME/.local/state/debian-desktop-setup/$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
# Overridable so the tests can present a Debian or Ubuntu release on any machine.
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
```

Delete the old `target_config`/`backup_dir` assignments further down, the `unsupported` function, the `os_release`/`distro_*` block and the `case "$distro_id"` block they fed.

Replace the body of `install.sh`'s `summary` with:

```bash
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    printf 'Finished. Log out and log in to apply startup programs. Alt+D: Rofi launcher; Alt+Shift+S: screenshot.\n'
    printf 'Keyboard: English (US) + Arabic. Shift+Caps Lock switches layouts after login.\n'
    printf 'No login manager is installed in this phase: use the one you have, or startx with the bundled xinit.\n'
    printf 'Sway is available with: bash setup-sway.sh\n'
    # A run with failed steps must not report success to whatever called this script.
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
```

Note the wording change: the old summary printed `Finished. Backups, when needed: %s` on one line, and `summary_prologue` now prints the backup line. `tests/install-smoke.js` matches `/Backups, when needed: .*\.local\/state\/debian-desktop-setup/` and `/Alt\+D/`, both of which still appear, so the test needs no edit. Keep the last line naming `setup-sway.sh` — Task 8 adds the matching README line.

- [ ] **Step 4: Run the whole phase 1 suite, unmodified**

```bash
cd ~/debian-desktop-setup
for t in tests/*.js; do printf '%-32s' "$t"; node "$t" >/dev/null 2>&1 && echo OK || { echo FAIL; node "$t" 2>&1 | tail -5; }; done
bash install.sh --help
```

Expected: six OK, and `--help` still exits 0. A failure here is a real regression in the move: fix `install.sh` or `lib/common.sh`, never the test.

- [ ] **Step 5: Prove the library refuses to be executed directly**

Append to `tests/setup-smoke.js`:

```js
// The library is sourced, not run: executing it must not look like a successful install.
{
    const direct = spawnSync('bash', [path.join(root, 'lib/common.sh')], {encoding: 'utf8', timeout: 10000});
    assert.equal(direct.status, 0, 'Sourcing a function library has no side effects');
    assert.equal(direct.stdout, '', 'A sourced library prints nothing on its own');
}
// Every script that uses the shared helpers must source them rather than redefine them.
for (const script of ['install.sh', 'setup-zsh.sh', 'setup-nvim.sh']) {
    const body = fs.readFileSync(path.join(root, script), 'utf8');
    if (script === 'install.sh') {
        assert.match(body, /source "\$bundle_dir\/lib\/common\.sh"/, `${script} must source the library`);
        assert.doesNotMatch(body, /^install_file\(\) \{/m, `${script} must not redefine install_file`);
    }
}
```

Run: `node tests/setup-smoke.js`
Expected: PASS. (`setup-zsh.sh` and `setup-nvim.sh` keep their own two-line `ask`/`run` for now: they install no files through `install_file`, and moving them is churn without a test to justify it.)

- [ ] **Step 6: Commit**

```bash
cd ~/debian-desktop-setup
git add lib/common.sh install.sh tests/setup-smoke.js
git commit -m "Move the shared installer helpers into lib/common.sh

setup-sway.sh needs the same consent prompt, backup rule and failure handling
install.sh has. Copying them would give the consent-and-backup path a second
implementation, which is the defect the phase 1 review found in the one place
that bypassed install_file. This is a pure move: the phase 1 test suite is
unmodified and still green, and the only behaviour change is that the backup
line now comes from summary_prologue."
```

---

### Task 2: the `sway` group, the browser and snapd

**Files:**
- Modify: `packages/apt-map.tsv`, `README.md` (the Package catalogue table), `tests/apt-map-smoke.js`, `install.sh` (the Ubuntu browser step)
- Test: `tests/apt-map-smoke.js`, `tests/install-smoke.js`

**Interfaces:**
- Consumes: the map schema from phase 1 — `group<TAB>arch<TAB>apt<TAB>where<TAB>note`, `where` in `both|debian|ubuntu|none`.
- Produces: the `sway` group name that Task 4 reads, and the rule that `-` in the `arch` column means "no counterpart in `arch-desktop-setup/sway/packages.txt`".

- [ ] **Step 1: Write the failing test for the generalized uniqueness rule**

In `tests/apt-map-smoke.js`, replace the single-name check:

```js
    assert.ok(!archSeen.has(arch) || arch === '-', 'Duplicate arch package: ' + arch);
    archSeen.add(arch);
```

with a per-release check, and add the browser assertion below it:

```js
    // One row per Arch name per release. A package may resolve to a different apt
    // name on each release, but never to two names on the same one.
    if (arch !== '-') {
        for (const target of (where === 'both' ? ['debian', 'ubuntu'] : [where])) {
            if (target === 'none') continue;
            const key = `${arch}@${target}`;
            assert.ok(!archSeen.has(key), `Two rows claim ${arch} on ${target}`);
            archSeen.add(key);
        }
    }
```

And at the end of the file, before the final `console.log`:

```js
// The browser is the first package with a different apt name on each release.
const browsers = lines.slice(1).map((l) => l.split('\t')).filter(([, arch]) => arch === 'firefox');
assert.deepEqual(browsers.map(([, , apt, where]) => `${apt}/${where}`).sort(),
    ['firefox-esr/debian', 'firefox/ubuntu'].sort(), 'Debian gets the ESR package, Ubuntu the snap installer');
// snapd goes on both releases: the Ubuntu browser is a snap, and phase 3 will want it.
const aptAll = new Set(lines.slice(1).map((l) => l.split('\t')[2]));
for (const name of ['snapd', 'sway', 'swaybg', 'swayidle', 'swaylock', 'waybar', 'mako-notifier',
    'grim', 'slurp', 'wl-clipboard', 'cliphist', 'xwayland', 'mate-polkit', 'wtype', 'xdotool',
    'unicode-data', 'qtwayland5', 'qt6-wayland', 'xdg-desktop-portal-wlr', 'xdg-desktop-portal-gtk']) {
    assert.ok(aptAll.has(name), `The Sway session needs ${name}`);
}
// Every sway-group row is a real apt name, never a where=none placeholder.
for (const [group, , apt, where] of lines.slice(1).map((l) => l.split('\t'))) {
    if (group !== 'sway') continue;
    assert.notEqual(where, 'none', `The sway group installs from apt: ${apt}`);
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/apt-map-smoke.js`
Expected: FAIL — `The Sway session needs snapd` (the new rows do not exist yet).

- [ ] **Step 3: Add the rows to `packages/apt-map.tsv`**

Append the `sway` group. Names verified in `debian:stable-slim` and `ubuntu:latest` on 2026-09-30; `-` in the `arch` column means the package has no counterpart in `arch-desktop-setup/sway/packages.txt`.

```
sway	sway	sway	both	Debian 13 has 1.10.1 and Ubuntu 26.04 has 1.11
sway	swaybg	swaybg	both	-
sway	swayidle	swayidle	both	-
sway	swaylock	swaylock	both	-
sway	waybar	waybar	both	Debian 13 has 0.12.0 and Ubuntu 26.04 has 0.15.0; every module this configuration uses predates 0.12
sway	mako	mako-notifier	both	Debian names the notification daemon package mako-notifier
sway	grim	grim	both	-
sway	slurp	slurp	both	-
sway	wl-clipboard	wl-clipboard	both	-
sway	cliphist	cliphist	both	-
sway	jq	jq	both	-
sway	dbus	dbus	both	-
sway	libnotify	libnotify-bin	both	notify-send ships in the -bin package, not the library
sway	polkit-gnome	mate-polkit	both	policykit-1-gnome was dropped from Debian 13; MATE's GTK agent is the equivalent and is packaged in both
sway	qt5-wayland	qtwayland5	both	Debian keeps the Qt 5 Wayland platform plugin under its soname
sway	qt6-wayland	qt6-wayland	both	-
sway	xdg-desktop-portal-wlr	xdg-desktop-portal-wlr	both	-
sway	xdg-desktop-portal-gtk	xdg-desktop-portal-gtk	both	-
sway	xorg-xwayland	xwayland	both	Debian drops the xorg- prefix; rofi is X11-only on Debian's 1.7.5, so the session needs it
sway	-	wtype	both	Types the chosen emoji into the focused Wayland window; no counterpart in the Arch package list
```

Add to the `input-emoji` group, which both sessions share:

```
input-emoji	-	unicode-data	both	Provides /usr/share/unicode/emoji/emoji-test.txt, the list the bundled emoji picker reads
input-emoji	-	xdotool	both	Types the chosen emoji into the focused X11 window; the Sway session uses wtype instead
```

Rewrite the `rofi-emoji` row's note, keeping `where=none` so the "exactly two unavailable packages" assertion still holds:

```
input-emoji	rofi-emoji	-	none	Not packaged in Debian 13 or Ubuntu 26.04; config/i3/emoji.sh is a bundled picker reading unicode-data instead of a rofi plugin
```

Replace the `firefox` row and add its Ubuntu counterpart plus `snapd`, in the `browser-files` group:

```
browser-files	firefox	firefox-esr	debian	Debian ships the ESR package and has no apt firefox
browser-files	firefox	firefox	ubuntu	Ubuntu's apt firefox is the package that installs the Firefox snap; there is no firefox-esr
browser-files	-	snapd	both	Ubuntu's browser is a snap; on Debian snapd installs nothing by itself and is groundwork for phase 3
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/apt-map-smoke.js`
Expected: PASS. Then `node tests/readme-smoke.js`
Expected: FAIL — `Undocumented package: sway` and friends. That is Step 5.

- [ ] **Step 5: Regenerate the README catalogue rows**

The catalogue is a Markdown table of `| apt | arch | where | note |`. Generate the new rows rather than typing them, so the table cannot drift from the map:

```bash
cd ~/debian-desktop-setup
awk -F'\t' 'NR > 1 && ($1 == "sway" || $3 == "snapd" || $3 == "unicode-data" || $3 == "xdotool" || $3 == "wtype") {
    name = ($3 == "-") ? $2 : $3
    printf "| `%s` | `%s` | %s | %s |\n", name, $2, $4, ($5 == "-" ? "" : $5)
}' packages/apt-map.tsv
```

Paste the output into the Package catalogue table in `README.md`, keeping the table's existing order (groups in map order). Correct the two rows the map changed: the `firefox-esr` row's note, and the new `firefox`/`ubuntu` row beside it.

Run: `node tests/readme-smoke.js`
Expected: PASS.

- [ ] **Step 6: Write the failing test for the Ubuntu browser step**

The snap installation happens inside apt's `postinst`, which prompts through debconf and needs the network. Append to `tests/install-smoke.js`, before the cleanup:

```js
// Ubuntu's firefox package installs a snap from its postinst: it must not be able to
// hang on a debconf prompt, and a failure there must not take the whole run down.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-snap-smoke-'));
    const stubs = path.join(home, 'bin');
    fs.mkdirSync(stubs);
    const log = path.join(home, 'apt-env');
    // The stub fails the way an offline snap installation does, and records its environment.
    fs.writeFileSync(path.join(stubs, 'apt-get'), `#!/bin/sh
if [ "$1" = install ]; then
  echo "DEBIAN_FRONTEND=$DEBIAN_FRONTEND" >> ${log}
  echo "error: cannot install \\"firefox\\": Post-refresh hook failed" >&2
  exit 1
fi
exit 0
`, {mode: 0o755});
    for (const name of ['systemctl', 'gsettings', 'mkcert', 'xdg-mime', 'i3', 'nvim', 'chsh', 'git', 'snap']) {
        fs.writeFileSync(path.join(stubs, name), '#!/bin/sh\nexit 0\n', {mode: 0o755});
    }
    fs.writeFileSync(path.join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    const result = spawnSync('bash', [path.join(root, 'install.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(120),
        env: {...env(ubuntu), HOME: home, PATH: `${stubs}:${process.env.PATH}`},
    });
    assert.match(fs.readFileSync(log, 'utf8'), /DEBIAN_FRONTEND=noninteractive/,
        'The install step must be unattended: the firefox package prompts through debconf');
    assert.match(result.stdout, /Steps that failed:[\s\S]*apt-get install/,
        'A failed package step is reported, not swallowed');
    assert.ok(fs.existsSync(path.join(home, '.config', 'i3', 'config')),
        'The configuration is installed even when the packages could not be');
    fs.rmSync(home, {recursive: true, force: true});
}
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `node tests/install-smoke.js`
Expected: FAIL — the log file does not exist, because `install.sh` does not set `DEBIAN_FRONTEND`.

- [ ] **Step 8: Make the package step unattended**

In `install.sh`, change the install line inside the package step:

```bash
        # Ubuntu's firefox package installs a snap from its postinst and asks debconf
        # about it; an installer the user is watching must not stop on that prompt.
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd ~/debian-desktop-setup
for t in tests/*.js; do printf '%-32s' "$t"; node "$t" >/dev/null 2>&1 && echo OK || { echo FAIL; node "$t" 2>&1 | tail -5; }; done
```

Expected: six OK. Then confirm both previews still differ only where the map says:

```bash
bash install.sh --dry-run < /dev/null | grep -A2 'Selected packages'
```

Expected: the Debian preview names `firefox-esr` and `snapd`; run it again with `DEBIAN_SETUP_OS_RELEASE` pointing at an Ubuntu file and it names `firefox` and `snapd` instead.

- [ ] **Step 10: Commit**

```bash
cd ~/debian-desktop-setup
git add packages/apt-map.tsv README.md tests/apt-map-smoke.js tests/install-smoke.js install.sh
git commit -m "Map the Sway packages, the browser and snapd

The sway group carries the 38 names from the Arch session list, verified in both
container images: policykit-1-gnome is gone from Debian 13 so the polkit agent is
mate-polkit, xwayland loses its xorg- prefix, and mako is mako-notifier. The
browser is settled per release — firefox-esr on Debian, the snap-installing
firefox package on Ubuntu — which makes it the first package needing two rows,
so the map's uniqueness rule is now one row per name per release. The package
step runs with DEBIAN_FRONTEND=noninteractive because that snap installation
asks debconf a question."
```

---

### Task 3: `map_group_packages` — one group reader for both installers

**Files:**
- Modify: `lib/common.sh`, `install.sh` (the `group` function)
- Test: `tests/setup-smoke.js`

**Interfaces:**
- Consumes: `install_file`'s neighbours in `lib/common.sh`; `$release` from `detect_release`.
- Produces: `map_group_packages <map> <group> <release>` → prints the apt names for that group and release, one per line, sorted and deduplicated; appends `"<arch> (<note>)"` to `unavailable` for `where=none` rows and `"<apt> (<note>)"` to `skipped` for rows belonging to the other release. Declares the `unavailable` and `skipped` arrays.

- [ ] **Step 1: Write the failing test**

Append to `tests/setup-smoke.js`:

```js
// The group reader is the one place that decides what a release installs.
{
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-group-smoke-'));
    const map = path.join(scratch, 'map.tsv');
    fs.writeFileSync(map, ['group\tarch\tapt\twhere\tnote',
        'demo\talpha\talpha\tboth\t-',
        'demo\tbeta\tbeta-debian\tdebian\tDebian names it differently for a reason this test does not care about',
        'demo\tgamma\tgamma-ubuntu\tubuntu\tUbuntu names it differently for a reason this test does not care about',
        'demo\tdelta\t-\tnone\tNot packaged anywhere, and this note is long enough to satisfy the map rule',
        'other\tepsilon\tepsilon\tboth\t-',
        'demo\talpha-too\talpha\tboth\tA second row resolving to the same apt name, to prove deduplication',
    ].join('\n') + '\n');
    const probe = `
        dry_run=true; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        map_group_packages ${map} demo debian
        printf 'unavailable: %s\\n' "\${unavailable[*]}"
        printf 'skipped: %s\\n' "\${skipped[*]}"
    `;
    const result = spawnSync('bash', ['-c', probe], {encoding: 'utf8', timeout: 10000,
        env: {...process.env, HOME: scratch}});
    assert.equal(result.status, 0, result.stderr);
    const [names, ...rest] = result.stdout.trim().split('\n');
    assert.equal(names, 'alpha', 'Deduplicated, and only this release');
    assert.equal(result.stdout.split('\n').filter((l) => l === 'beta-debian').length, 1,
        'The Debian-only package is included on Debian');
    assert.ok(rest.join('\n').includes('delta'), 'An unavailable package is reported with its reason');
    assert.ok(rest.join('\n').includes('gamma-ubuntu'), 'The other release\\'s package is reported as skipped');
    fs.rmSync(scratch, {recursive: true, force: true});
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/setup-smoke.js`
Expected: FAIL — `map_group_packages: command not found`.

- [ ] **Step 3: Add the function to `lib/common.sh`**

```bash
unavailable=()
skipped=()
# Prints the apt names one group installs on one release, and records the rest:
# where=none packages are unavailable everywhere, and the other release's rows are
# skipped. Reading the map is the only thing this does — the prompt belongs to the caller.
map_group_packages() {
    local map=$1 id=$2 want=$3 list=() g arch apt where note
    while IFS=$'\t' read -r g arch apt where note; do
        [[ "$g" == "$id" ]] || continue
        case "$where" in
            none) unavailable+=("$arch ($note)") ;;
            both) list+=("$apt") ;;
            "$want") list+=("$apt") ;;
            *) skipped+=("$apt ($note)") ;;
        esac
    done < <(tail -n +2 -- "$map")
    (( ${#list[@]} )) || return 0
    printf '%s\n' "${list[@]}" | sort -u
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/setup-smoke.js`
Expected: PASS.

- [ ] **Step 5: Make `install.sh` use it**

Replace `install.sh`'s `group` function body and delete its now-duplicated `unavailable=()`/`skipped=()` declarations:

```bash
group() {
    local id=$1 list=()
    mapfile -t list < <(map_group_packages "$map" "$id" "$release")
    (( ${#list[@]} )) || return 0
    printf '\n%s\n  %s\n' "${group_label[$id]:-Additional packages ($id)}" "${list[*]}"
    if ask 'Include these packages?'; then packages+=("${list[@]}"); fi
}
```

The derived group list must keep skipping the groups another script owns:

```bash
mapfile -t group_ids < <(awk -F'\t' 'NR > 1 && $1 != "editor-tools" && $1 != "sway" && !seen[$1]++ { print $1 }' "$map")
```

- [ ] **Step 6: Run the whole suite**

```bash
cd ~/debian-desktop-setup
for t in tests/*.js; do printf '%-32s' "$t"; node "$t" >/dev/null 2>&1 && echo OK || { echo FAIL; node "$t" 2>&1 | tail -5; }; done
```

Expected: six OK. `install.sh` must still offer exactly the six phase 1 groups — the `sway` group belongs to `setup-sway.sh`, and `tests/install-smoke.js`'s derived-group test proves the offer still comes from the map.

- [ ] **Step 7: Commit**

```bash
cd ~/debian-desktop-setup
git add lib/common.sh install.sh tests/setup-smoke.js
git commit -m "Read package groups from one function in lib/common.sh

setup-sway.sh installs a group from the same map with the same release rules, so
the reader moves to the library and install.sh's group() keeps only the prompt.
install.sh now skips the sway group when deriving its own list: the Sway session
is optional and its own script offers it."
```

---

### Task 4: `setup-sway.sh` — guards, versions, packages

**Files:**
- Create: `setup-sway.sh`
- Test: `tests/setup-sway-smoke.js` (new)

**Interfaces:**
- Consumes: everything `lib/common.sh` produces (Tasks 1 and 3); the `sway` group from Task 2.
- **Test convention for every task that follows:** answer `'y\n'.repeat(40)` when the
  test wants the steps to happen and `'n\n'.repeat(40)` when it wants nothing to
  happen. Never count prompts positionally — later tasks append steps, and a test
  that says "the third answer is the bundle" silently starts answering something
  else. The stubbed `apt-get` makes an accepted package step a no-op, so all-yes is
  safe.
- Produces: `$release`, `$family`, `$backup_dir` (its own `sway-<timestamp>-<pid>` directory), `$packages`, and the `summary`/`finished` pair later tasks append to. The script's own `$bundle_dir` is its directory.

- [ ] **Step 1: Write the failing test**

Create `tests/setup-sway-smoke.js`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// Previews and stubbed runs only: no package is installed and no service is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-smoke-'));
const bin = path.join(scratch, 'bin');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'apt-get'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
fs.writeFileSync(path.join(bin, 'apt-cache'), `#!/bin/sh
case "$2" in
  sway) echo '  Candidate: 1.10.1-2' ;;
  waybar) echo '  Candidate: 0.12.0-1' ;;
  *) echo '  Candidate: (none)' ;;
esac
`, {mode: 0o755});

const osRelease = (body, name) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, body);
    return file;
};
const debian = osRelease('ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const env = (file, home = scratch) => ({
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, DEBIAN_SETUP_OS_RELEASE: file,
});
const sway = (args, file, answers = 'n\n'.repeat(40), home = scratch) =>
    spawnSync('bash', [path.join(root, 'setup-sway.sh'), ...args],
        {encoding: 'utf8', timeout: 60000, input: answers, env: env(file, home)});

// Arguments and guards.
assert.equal(sway(['--invalid'], debian).status, 2, 'An unknown argument is a usage error');
assert.equal(sway(['--help'], debian).status, 0);
const fedora = sway(['--dry-run'], osRelease('ID=fedora\n', 'fedora'));
assert.equal(fedora.status, 1);
assert.match(fedora.stderr, /Debian 13 and Ubuntu 26\.04/);

// The versions apt offers are named before anything is agreed to.
const preview = sway(['--dry-run'], debian);
assert.equal(preview.status, 0, preview.stderr);
assert.match(preview.stdout, /Sway 1\.10\.1/, 'Name the Sway version apt offers');
assert.match(preview.stdout, /Waybar 0\.12\.0/, 'Name the Waybar version apt offers');
assert.match(preview.stdout, /i3 .*(unchanged|untouched)/i, 'Say that i3 is left alone');

// The sway group is offered, and declining installs nothing.
assert.match(preview.stdout, /sway swaybg swayidle swaylock/, 'Offer the group from the map');
assert.doesNotMatch(preview.stdout, /apt-get install/, 'A declined group installs nothing');

// Review Focus 1: the rofi theme phase 1 installs is what the launcher loads.
const noTheme = sway(['--dry-run'], debian);
assert.match(noTheme.stdout, /rofi\/active-theme\.rasi/,
    'Warn that the launcher needs the theme pointer install.sh writes');

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-sway-smoke: all checks passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/setup-sway-smoke.js`
Expected: FAIL — `setup-sway.sh` does not exist, so bash exits 127.

- [ ] **Step 3: Write `setup-sway.sh`**

```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
# Optional Sway/Wayland session. The i3 desktop install.sh sets up stays installed
# and unchanged: nothing here removes or edits an i3, Picom or Flameshot setting.
set -Eeuo pipefail
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "${BASH_LINENO[0]:-$LINENO}" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -d "$bundle_dir/config/sway" ]] || { printf 'Keep setup-sway.sh with its config folder.\n' >&2; exit 1; }
[[ -r "$bundle_dir/lib/common.sh" ]] || { printf 'Keep setup-sway.sh with its lib folder.\n' >&2; exit 1; }
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash setup-sway.sh [--dry-run]\n'
        printf 'Adds an optional Sway session on Debian 13 or Ubuntu 26.04. i3 is left alone.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
target_config=${XDG_CONFIG_HOME:-$HOME/.config}
backup_dir="$HOME/.local/state/debian-desktop-setup/sway-$(date +%Y%m%d-%H%M%S)-$$"
# shellcheck source=lib/common.sh
source "$bundle_dir/lib/common.sh"
require_normal_user
require_apt_get
detect_release "${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}"
map=${DEBIAN_SETUP_MAP:-$bundle_dir/packages/apt-map.tsv}
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
# apt-cache may be absent or the package unindexed; pipefail would turn that into an
# exit, and an unknown version is not a reason to refuse to run.
candidate() { apt-cache policy "$1" 2>/dev/null | awk '/Candidate:/{print $2; exit}' || true; }
printf 'Sway session setup — Wayland, Waybar, notifications and screen lock\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE.\n'
printf 'Detected %s (%s family).\n' "${distro_name:-$release}" "$family"
printf 'apt offers Sway %s and Waybar %s.\n' "$(candidate sway)" "$(candidate waybar)"
printf 'Your i3 desktop stays installed and unchanged; nothing here edits its configuration.\n'
# The launcher, the clipboard picker and the emoji picker all load this file. install.sh
# writes it; without it every rofi keystroke fails with a theme error and no window.
if [[ ! -f "$target_config/rofi/active-theme.rasi" ]]; then
    printf '\nMissing %s/rofi/active-theme.rasi, which the launcher, clipboard and emoji\n' "$target_config"
    printf 'pickers all load. Run install.sh and accept the Rofi theme step, or the keys open nothing.\n'
    if ask 'Write a Catppuccin theme pointer now so the pickers work?'; then
        if ! "$dry_run"; then
            theme_temp=$(mktemp)
            printf '@theme "i3-theme.rasi"\n' > "$theme_temp"
            install_file "$theme_temp" rofi/active-theme.rasi
            unlink "$theme_temp"
        else
            printf 'Would write rofi/active-theme.rasi pointing at i3-theme.rasi\n'
        fi
    fi
fi
packages=()
mapfile -t sway_packages < <(map_group_packages "$map" sway "$release")
if (( ${#sway_packages[@]} )); then
    printf '\nSway session packages\n  %s\n' "${sway_packages[*]}"
    if ask 'Include these packages?'; then packages+=("${sway_packages[@]}"); fi
fi
if (( ${#unavailable[@]} )); then printf '\nNot packaged on %s: %s\n' "$family" "${unavailable[*]}"; fi
if (( ${#skipped[@]} )); then printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"; fi
finished=false
summary() {
    local status=$?
    printf '\n'
    if ! "$finished"; then
        printf 'Stopped before the end (exit %s); what follows still applies.\n' "$status"
    fi
    summary_prologue
    printf 'Log out, then choose Sway in your greeter, or run: dbus-run-session sway\n'
    printf 'Alt+D: apps; Alt+B: Firefox; Print: screenshot; Super+period: emoji; Alt+C: clipboard.\n'
    printf 'Shift+Caps Lock: English/Arabic; Alt+L: lock; Alt+Shift+E: log out.\n'
    printf 'Your i3 session is untouched: choose it in the greeter to go back.\n'
    if (( status == 0 && ${#failed[@]} )); then exit 1; fi
}
trap summary EXIT
if (( ${#packages[@]} )); then
    printf '\nSelected packages: %s\n' "${packages[*]}"
    if ask 'Update the package lists and install them?'; then
        run sudo apt-get update
        attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
    fi
fi
finished=true
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/setup-sway-smoke.js`
Expected: PASS — five assertion groups, no output from a declined run beyond the preview.

- [ ] **Step 5: Check the script the way a user would**

```bash
cd ~/debian-desktop-setup
bash -n setup-sway.sh
bash setup-sway.sh --help
printf 'n\nn\nn\n' | DEBIAN_SETUP_OS_RELEASE=/dev/null bash setup-sway.sh --dry-run; echo "exit=$?"
```

Expected: syntax clean; `--help` exits 0; the unreadable os-release exits 1 with the message from `detect_release`, and the EXIT trap does not fire a summary for a run that never started (the trap is installed after detection, on purpose).

- [ ] **Step 6: Commit**

```bash
cd ~/debian-desktop-setup
git add setup-sway.sh tests/setup-sway-smoke.js
git commit -m "Add setup-sway.sh with its guards, versions and package step

The script names the Sway and Waybar versions apt offers before asking for
anything, installs the sway group through the shared map reader, and says plainly
that i3 stays installed. It also checks for the Rofi theme pointer install.sh
writes: the launcher, clipboard and emoji pickers all load it, and without it
every one of those keys opens nothing."
```

---

### Task 5: the configuration tree

**Files:**
- Create: `config/sway/config`, `config/sway/config.d/00-local.conf`, `config/sway/config.d/40-notes.conf`, `config/sway/clipboard.sh`, `config/sway/launcher.sh`, `config/sway/lock.sh`, `config/sway/notes.lua`, `config/sway/notes.sh`, `config/sway/screenshot.sh`, `config/sway/session-start.sh`, `config/waybar/config.jsonc`, `config/waybar/style.css`, `config/mako/config`, `config/swaylock/config`, `config/xdg-desktop-portal/sway-portals.conf`
- Modify: `setup-sway.sh` (append the bundle step), `config/i3/config` (remove the conky autostart), `scripts/shared-files.txt`, `scripts/adapted-files.txt`
- Test: `tests/setup-sway-smoke.js`, `tests/drift-smoke.js`

**Interfaces:**
- Consumes: `install_file` (Task 1), `$target_config`, `$dry_run`.
- Produces: the installed tree Task 6's emoji picker and Task 7's profile write into.

- [ ] **Step 1: Copy the tree from the Arch checkout**

```bash
cd ~/debian-desktop-setup
arch=${ARCH_SETUP_DIR:-$HOME/arch-desktop-setup}
mkdir -p config/sway/config.d config/waybar config/mako config/swaylock config/xdg-desktop-portal profiles
cp -v "$arch"/sway/config/sway/{config,clipboard.sh,launcher.sh,lock.sh,notes.lua,notes.sh,screenshot.sh,session-start.sh} config/sway/
cp -v "$arch"/sway/config/sway/config.d/{00-local.conf,40-notes.conf} config/sway/config.d/
cp -v "$arch"/sway/config/waybar/{config.jsonc,style.css} config/waybar/
cp -v "$arch"/sway/config/mako/config config/mako/
cp -v "$arch"/sway/config/swaylock/config config/swaylock/
cp -v "$arch"/sway/config/xdg-desktop-portal/sway-portals.conf config/xdg-desktop-portal/
cp -v "$arch"/sway/profiles/zenbook-um5606.conf profiles/
```

`30-conky.conf` is deliberately not copied: it starts a tool no phase before 4 installs.

- [ ] **Step 2: Write the failing test**

Append to `tests/setup-sway-smoke.js`, before the cleanup:

```js
// The bundle: every file installed, scripts executable, and the conky fragment absent.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-bundle-'));
    const result = sway([], debian, 'y\n'.repeat(40), home);
    assert.equal(result.status, 0, result.stderr);
    for (const relative of ['sway/config', 'sway/config.d/00-local.conf', 'sway/config.d/40-notes.conf',
        'waybar/config.jsonc', 'waybar/style.css', 'mako/config', 'swaylock/config',
        'xdg-desktop-portal/sway-portals.conf']) {
        assert.ok(fs.existsSync(path.join(home, '.config', relative)), `Missing: ${relative}`);
    }
    for (const script of ['sway/clipboard.sh', 'sway/launcher.sh', 'sway/lock.sh', 'sway/notes.sh',
        'sway/screenshot.sh', 'sway/session-start.sh']) {
        const mode = fs.statSync(path.join(home, '.config', script)).mode & 0o777;
        assert.equal(mode, 0o755, `${script} must be executable, not ${mode.toString(8)}`);
    }
    assert.ok(!fs.existsSync(path.join(home, '.config', 'sway/config.d/30-conky.conf')),
        'The conky fragment belongs to the phase that installs conky');
    // Review Focus 4: sway is not installed here, so validation is skipped with a reason.
    assert.match(result.stdout, /sway is not installed.*skipping the configuration check/i,
        'Say why the configuration was not validated');
    fs.rmSync(home, {recursive: true, force: true});
}
// The pacman instruction cannot survive in a Debian repository.
for (const file of ['config/sway/clipboard.sh', 'config/sway/session-start.sh']) {
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(body, /pacman/, `${file} must not tell a Debian user to run pacman`);
}
assert.match(fs.readFileSync(path.join(root, 'config/sway/session-start.sh'), 'utf8'),
    /polkit-mate-authentication-agent-1/, 'Debian 13 has no polkit-gnome agent');
assert.doesNotMatch(fs.readFileSync(path.join(root, 'config/i3/config'), 'utf8'),
    /conky\/start\.sh/, 'The i3 conky autostart moves to the phase that installs conky');
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `node tests/setup-sway-smoke.js`
Expected: FAIL — `Missing: sway/config`, because `setup-sway.sh` has no bundle step yet.

- [ ] **Step 4: Adapt the two files Debian needs differently**

In `config/sway/clipboard.sh`, the missing-cliphist message:

```sh
    message='Clipboard history needs cliphist: sudo apt-get install cliphist'
```

In `config/sway/session-start.sh`, replace the single hardcoded agent line with a probe. Debian 13 dropped `policykit-1-gnome`, so the agent is MATE's, at `/usr/libexec/polkit-mate-authentication-agent-1` — verified in a `debian:stable-slim` container with `dpkg -L mate-polkit`. Ubuntu still ships the GNOME agent, so both are tried:

```sh
# Debian 13 dropped policykit-1-gnome; mate-polkit is the GTK agent in both releases.
# Ubuntu still has the GNOME one, so try each packaged location and say nothing if a
# desktop already runs an agent of its own.
for agent in /usr/libexec/polkit-mate-authentication-agent-1 \
    /usr/lib/mate-polkit/polkit-mate-authentication-agent-1 \
    /usr/lib/policykit-1-gnome/polkit-gnome-authentication-agent-1; do
    if [ -x "$agent" ]; then "$agent" & break; fi
done
```

- [ ] **Step 5: Remove the conky autostart from the i3 configuration**

Delete these three lines from `config/i3/config` (they were lines 68-70 at the end of phase 1):

```
# Conky system panel (no-op until conky is installed); Alt+Shift+T picks a theme or Off.
exec --no-startup-id sh ~/.config/conky/start.sh
bindsym $mod+Shift+t exec --no-startup-id sh ~/.config/conky/switch.sh
```

`config/i3/config` is already an adapted file, so its row in `scripts/adapted-files.txt` gains the reason:

```
config/i3/config	Debian uses the freedesktop autostart URL, and the conky panel arrives with conky in phase 4 rather than autostarting a tool no earlier phase installs
```

- [ ] **Step 6: Append the bundle step to `setup-sway.sh`**

Insert before `finished=true`:

```bash
if ask 'Install the Sway configuration (each existing changed file asks before replacement)?'; then
    while IFS= read -r -d '' source <&3; do
        relative=${source#"$bundle_dir/config/"}
        case "$relative" in
            *.sh) install_file "$source" "$relative" 755 ;;
            *) install_file "$source" "$relative" ;;
        esac
    done 3< <(find "$bundle_dir/config/sway" "$bundle_dir/config/waybar" "$bundle_dir/config/mako" \
        "$bundle_dir/config/swaylock" "$bundle_dir/config/xdg-desktop-portal" -type f -print0 | sort -z)
    # sway -C validates a configuration without a compositor, so this runs anywhere.
    if command -v sway >/dev/null; then
        attempt sway -C -c "$target_config/sway/config"
    else
        printf 'sway is not installed yet, so skipping the configuration check.\n'
        printf 'Accept the package step, or run: sway -C -c %s/sway/config\n' "$target_config"
    fi
fi
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd ~/debian-desktop-setup
node tests/setup-sway-smoke.js
node tests/drift-smoke.js
```

Expected: `setup-sway-smoke` passes. `drift-smoke` FAILS with `config/sway/config must be in exactly one of the two lists` — Step 8.

- [ ] **Step 8: Register the new files in the drift lists**

```bash
cd ~/debian-desktop-setup
# Every new file is byte-identical to the Arch checkout except the two just adapted.
for f in $(find config/sway config/waybar config/mako config/swaylock config/xdg-desktop-portal profiles -type f | sort); do
    case "$f" in
        config/sway/clipboard.sh|config/sway/session-start.sh) continue ;;
    esac
    printf '%s\n' "$f" >> scripts/shared-files.txt
done
sort -o scripts/shared-files.txt scripts/shared-files.txt
cat >> scripts/adapted-files.txt <<'ROWS'
config/sway/clipboard.sh	The missing-cliphist message names apt rather than pacman
config/sway/session-start.sh	Debian 13 has no polkit-gnome agent, so the session probes the mate-polkit and GNOME paths in turn
ROWS
```

The Arch checkout keeps these files under `sway/config/...` while this repository keeps them under `config/...`, so `sync-from-arch.sh` compares the same relative path in both and will report them `missing`. Teach it the one prefix difference instead of leaving a permanent false report — in `scripts/sync-from-arch.sh`, where it builds the upstream path:

```bash
    # The Arch repository keeps the Sway session under sway/config/; this one keeps
    # every desktop's configuration under config/. Same file, different home.
    upstream="$arch_dir/$relative"
    case "$relative" in
        config/sway/*|config/waybar/*|config/mako/*|config/swaylock/*|config/xdg-desktop-portal/*)
            upstream="$arch_dir/sway/${relative}" ;;
        profiles/*)
            upstream="$arch_dir/sway/${relative}" ;;
    esac
```

and use `$upstream` in place of `"$arch_dir/$relative"` in both the existence check and the `cmp`, and as the copy source in `--pull`.

- [ ] **Step 9: Run the whole suite**

```bash
cd ~/debian-desktop-setup
for t in tests/*.js; do printf '%-32s' "$t"; node "$t" >/dev/null 2>&1 && echo OK || { echo FAIL; node "$t" 2>&1 | tail -6; }; done
bash scripts/sync-from-arch.sh --check | tail -3
```

Expected: seven OK, and the drift check reporting `0 drifted, 0 missing upstream.` A `drifted` line here means the copy was edited by accident; a `missing` line means the prefix mapping above is wrong for that path.

- [ ] **Step 10: Commit**

```bash
cd ~/debian-desktop-setup
git add config/sway config/waybar config/mako config/swaylock config/xdg-desktop-portal profiles \
    config/i3/config setup-sway.sh scripts/shared-files.txt scripts/adapted-files.txt \
    scripts/sync-from-arch.sh tests/setup-sway-smoke.js
git commit -m "Install the Sway configuration tree

Fifteen files copied from arch-desktop-setup and drift-checked, with two
adapted: the clipboard picker names apt instead of pacman, and the session
start probes for a polkit agent because Debian 13 dropped policykit-1-gnome.
The conky fragment is held back for the phase that installs conky, and the same
autostart is removed from the phase 1 i3 configuration for the same reason. The
configuration is validated with sway -C, which needs no compositor, and the
check is skipped with a reason when sway is not installed yet."
```

---

### Task 6: the bundled emoji picker

**Files:**
- Rewrite: `config/i3/emoji.sh` (phase 1's unavailable stub)
- Modify: `setup-sway.sh` (install it as `sway/emoji.sh` too), `scripts/adapted-files.txt`
- Test: `tests/emoji-smoke.js` (new)

**Interfaces:**
- Consumes: `install_file` (Task 1); the `unicode-data`, `wtype` and `xdotool` rows (Task 2).
- Produces: `config/i3/emoji.sh`, installed at `i3/emoji.sh` (X11, bound by the i3 config) and `sway/emoji.sh` (Wayland, bound by `Mod4+period` and `XF86EmojiPicker`). Reads `${EMOJI_DATA:-/usr/share/unicode/emoji/emoji-test.txt}`.

- [ ] **Step 1: Write the failing test**

Create `tests/emoji-smoke.js`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// The picker against a fixture and stubs: no display, no real typing, no clipboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'config/i3/emoji.sh');

// Three real lines from emoji-test.txt, plus the noise the file is full of.
const fixture = `# emoji-test.txt
# Group: Smileys
1F600                                                  ; fully-qualified     # 😀 E1.0 grinning face
1F469 200D 1F4BB                                       ; fully-qualified     # 👩‍💻 E4.0 woman technologist
263A FE0F                                              ; fully-qualified     # ☺️ E0.6 smiling face
263A                                                   ; unqualified         # ☺ E0.6 smiling face
`;

const stubDir = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-stub-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    for (const [name, body] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, 'bin', name), body, {mode: 0o755});
    }
    fs.writeFileSync(path.join(dir, 'emoji-test.txt'), fixture);
    return dir;
};
const run = (dir, extra = {}) => spawnSync('sh', [script], {
    encoding: 'utf8', timeout: 20000,
    env: {...process.env, HOME: dir, PATH: `${path.join(dir, 'bin')}:/usr/bin:/bin`,
        EMOJI_DATA: path.join(dir, 'emoji-test.txt'), ...extra},
});

// The list rofi receives: fully-qualified entries only, emoji first, name after.
{
    const dir = stubDir({
        rofi: `#!/bin/sh\ncat > ${'$HOME'}/list\nexit 1\n`,
        'notify-send': '#!/bin/sh\nexit 0\n',
    });
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    const list = fs.readFileSync(path.join(dir, 'list'), 'utf8').trim().split('\n');
    assert.equal(list.length, 3, 'Only the fully-qualified entries: ' + list.join(' | '));
    assert.equal(list[0], '😀 grinning face');
    assert.equal(list[1], '👩‍💻 woman technologist');
    assert.equal(list[2], '☺️ smiling face', 'Variation selectors are part of the emoji');
    fs.rmSync(dir, {recursive: true, force: true});
}

// Wayland: the choice is typed with wtype, and only the character is typed.
{
    const dir = stubDir({
        rofi: '#!/bin/sh\ncat > /dev/null\necho "😀 grinning face"\n',
        wtype: `#!/bin/sh\nprintf '%s' "$2" > ${'$HOME'}/typed\n`,
        'notify-send': '#!/bin/sh\nexit 0\n',
    });
    const result = run(dir, {WAYLAND_DISPLAY: 'wayland-0'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'typed'), 'utf8'), '😀', 'Type the emoji, not its name');
    fs.rmSync(dir, {recursive: true, force: true});
}

// Review Focus 5: wtype refused by the compositor falls back to the clipboard.
{
    const dir = stubDir({
        rofi: '#!/bin/sh\ncat > /dev/null\necho "😀 grinning face"\n',
        wtype: '#!/bin/sh\necho "virtual keyboard protocol not supported" >&2\nexit 1\n',
        'wl-copy': `#!/bin/sh\ncat > ${'$HOME'}/copied\n`,
        'notify-send': `#!/bin/sh\nshift\nprintf '%s' "$*" > ${'$HOME'}/notified\n`,
    });
    const result = run(dir, {WAYLAND_DISPLAY: 'wayland-0'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'copied'), 'utf8').trim(), '😀', 'The choice is not lost');
    assert.match(fs.readFileSync(path.join(dir, 'notified'), 'utf8'), /paste|clipboard/i,
        'Tell the user where the emoji went');
    fs.rmSync(dir, {recursive: true, force: true});
}

// X11: the same script types with xdotool instead.
{
    const dir = stubDir({
        rofi: '#!/bin/sh\ncat > /dev/null\necho "☺️ smiling face"\n',
        xdotool: `#!/bin/sh\nprintf '%s' "$4" > ${'$HOME'}/typed\n`,
        'notify-send': '#!/bin/sh\nexit 0\n',
    });
    const result = run(dir, {DISPLAY: ':0'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'typed'), 'utf8'), '☺️');
    fs.rmSync(dir, {recursive: true, force: true});
}

// A missing data file reports itself instead of opening an empty picker.
{
    const dir = stubDir({
        rofi: '#!/bin/sh\necho "should not be called" >&2\nexit 1\n',
        'notify-send': `#!/bin/sh\nshift\nprintf '%s' "$*" > ${'$HOME'}/notified\n`,
    });
    fs.rmSync(path.join(dir, 'emoji-test.txt'));
    const result = run(dir);
    assert.equal(result.status, 0, 'A missing list is not a crash');
    assert.match(fs.readFileSync(path.join(dir, 'notified'), 'utf8'), /unicode-data/,
        'Name the package that provides the list');
    fs.rmSync(dir, {recursive: true, force: true});
}
console.log('emoji-smoke: all checks passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/emoji-smoke.js`
Expected: FAIL — the first assertion, because phase 1's stub notifies that the picker is unavailable and never writes a list.

- [ ] **Step 3: Write the picker**

Replace `config/i3/emoji.sh` entirely:

```sh
#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Emoji picker for both sessions. rofi-emoji is not packaged in Debian 13 or
# Ubuntu 26.04, so the list comes from unicode-data's emoji-test.txt and the
# choice is typed with wtype under Wayland or xdotool under X11.
set -eu
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
data=${EMOJI_DATA:-/usr/share/unicode/emoji/emoji-test.txt}
say() {
    if command -v notify-send >/dev/null; then notify-send 'Emoji picker' "$1"; fi
    printf '%s\n' "$1" >&2
}
if [ ! -r "$data" ]; then
    say 'Emoji list missing: sudo apt-get install unicode-data'
    exit 0
fi
# Lines look like: 1F600 ; fully-qualified # 😀 E1.0 grinning face
# Keep the fully-qualified ones, and print "<emoji> <name>".
list=$(sed -n 's/.*; fully-qualified[[:space:]]*# \([^ ]*\) E[0-9.]* \(.*\)$/\1 \2/p' "$data")
if [ -z "$list" ]; then
    say 'Emoji list could not be read; check /usr/share/unicode/emoji/emoji-test.txt'
    exit 0
fi
set +e
choice=$(printf '%s\n' "$list" | rofi -no-config -dmenu -i -p 'Emoji' \
    -theme "$config_root/rofi/active-theme.rasi")
set -e
[ -n "${choice:-}" ] || exit 0
emoji=${choice%% *}
# Typing is best effort: a compositor may refuse synthetic input, and a lock screen
# always will. Copying keeps the choice rather than losing it.
if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wtype >/dev/null; then
    wtype -- "$emoji" && exit 0
elif [ -n "${DISPLAY:-}" ] && command -v xdotool >/dev/null; then
    xdotool type --clearmodifiers -- "$emoji" && exit 0
fi
if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-copy >/dev/null; then
    printf '%s' "$emoji" | wl-copy
    say "Copied $emoji — press Ctrl+V to paste"
elif command -v xclip >/dev/null; then
    printf '%s' "$emoji" | xclip -selection clipboard
    say "Copied $emoji — press Ctrl+V to paste"
else
    say "Could not type or copy $emoji; install wtype or xdotool"
fi
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/emoji-smoke.js`
Expected: PASS — five blocks.

- [ ] **Step 5: Install it for the Sway session too**

In `setup-sway.sh`, inside the bundle step and after the `find` loop, add:

```bash
    # One picker serves both sessions: the i3 binding loads i3/emoji.sh and the Sway
    # binding loads sway/emoji.sh, and they are the same script.
    install_file "$bundle_dir/config/i3/emoji.sh" sway/emoji.sh 755
```

Update the `config/i3/emoji.sh` row in `scripts/adapted-files.txt`:

```
config/i3/emoji.sh	A bundled picker reading unicode-data's emoji-test.txt, because rofi-emoji is packaged in neither release
```

- [ ] **Step 6: Run the whole suite**

```bash
cd ~/debian-desktop-setup
for t in tests/*.js; do printf '%-32s' "$t"; node "$t" >/dev/null 2>&1 && echo OK || { echo FAIL; node "$t" 2>&1 | tail -6; }; done
```

Expected: eight OK. `drift-smoke` must stay green: `config/i3/emoji.sh` is adapted, and it must still differ from the Arch copy — it does, since the Arch one is the plugin probe.

- [ ] **Step 7: Commit**

```bash
cd ~/debian-desktop-setup
git add config/i3/emoji.sh setup-sway.sh scripts/adapted-files.txt tests/emoji-smoke.js
git commit -m "Bundle an emoji picker instead of the unpackaged rofi plugin

rofi-emoji exists in neither Debian 13 nor Ubuntu 26.04. The list now comes from
unicode-data's emoji-test.txt, which both releases ship, and the choice is typed
with wtype under Wayland or xdotool under X11. Typing is best effort: a
compositor that refuses synthetic input gets the character on the clipboard and
a notification saying so, rather than silently losing the choice. One script
serves both sessions, as it does in arch-desktop-setup."
```

---

### Task 7: the hardware profile

**Files:**
- Modify: `setup-sway.sh`
- Test: `tests/setup-sway-smoke.js`

**Interfaces:**
- Consumes: `install_file`, `ask`, `run`; `profiles/zenbook-um5606.conf` (copied in Task 5).
- Produces: `sway/config.d/00-local.conf` on the target. The bundle step (Task 5)
  installs the Arch copy of that file first, so the profile step replaces it through
  `install_file` and asks before doing so — which is why the profile step comes after
  the bundle step and not before it. Reads `${DEBIAN_SETUP_DMI_NAME:-}` first, falling back to `/sys/class/dmi/id/product_name`.

- [ ] **Step 1: Write the failing test**

Append to `tests/setup-sway-smoke.js`, before the cleanup:

```js
// The Zenbook is recognized by DMI name and offered its own profile.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-zenbook-'));
    const withDmi = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {...env(debian, home), DEBIAN_SETUP_DMI_NAME: 'Zenbook S 16 UM5606WA_UM5606WA'},
    });
    assert.equal(withDmi.status, 0, withDmi.stderr);
    assert.match(withDmi.stdout, /Zenbook/, 'Name the machine it recognized');
    const installed = fs.readFileSync(path.join(home, '.config/sway/config.d/00-local.conf'), 'utf8');
    assert.match(installed, /output eDP-1 mode 1920x1200/, 'The bundled profile is what lands');
    assert.match(installed, /map_to_output eDP-1/, 'Including the touchscreen mapping');
    fs.rmSync(home, {recursive: true, force: true});
}

// Unknown hardware inside a Sway session: the profile is generated from real outputs.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-generated-'));
    const stubs = path.join(home, 'bin');
    fs.mkdirSync(stubs);
    for (const [name, body] of [['apt-get', 'exit 0'], ['sudo', 'exec "$@"'],
        ['apt-cache', 'echo "  Candidate: 1.10.1-2"'],
        ['swaymsg', `cat <<'JSON'
[{"name":"DP-3","current_mode":{"width":2560,"height":1440}},
 {"name":"eDP-2","current_mode":{"width":1920,"height":1080}}]
JSON`]]) {
        fs.writeFileSync(path.join(stubs, name), `#!/bin/sh\n${body}\n`, {mode: 0o755});
    }
    const result = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {...process.env, HOME: home, PATH: `${stubs}:${process.env.PATH}`,
            DEBIAN_SETUP_OS_RELEASE: debian, DEBIAN_SETUP_DMI_NAME: 'Generic Laptop',
            SWAYSOCK: path.join(home, 'sock')},
    });
    assert.equal(result.status, 0, result.stderr);
    const generated = fs.readFileSync(path.join(home, '.config/sway/config.d/00-local.conf'), 'utf8');
    assert.match(generated, /output DP-3 mode 2560x1440/, 'The real output, not eDP-1');
    assert.match(generated, /output eDP-2 mode 1920x1080/, 'Every output, not just the first');
    assert.match(result.stdout, /DP-3/, 'Show the profile before writing it');
    fs.rmSync(home, {recursive: true, force: true});
}

// Review Focus 2: unknown hardware, outside Sway. Nothing is written and the reason is said.
// All-no here: the bundle itself ships a 00-local.conf, so declining everything is the
// only way to prove the profile step wrote nothing of its own.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-nosock-'));
    const result = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'n\n'.repeat(40),
        env: {...env(debian, home), DEBIAN_SETUP_DMI_NAME: 'Generic Laptop', SWAYSOCK: ''},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(home, '.config/sway/config.d/00-local.conf')),
        'A profile naming no outputs must not be written');
    assert.match(result.stdout, /swaymsg -t get_outputs/,
        'Say how to fill the profile in after the first login');
    fs.rmSync(home, {recursive: true, force: true});
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/setup-sway-smoke.js`
Expected: FAIL — `ENOENT: .config/sway/config.d/00-local.conf`, because no profile step exists.

- [ ] **Step 3: Add the profile step to `setup-sway.sh`**

Insert after the bundle step and before `finished=true`:

```bash
# The bundled profile is specific to one laptop; the generated one names whatever
# outputs the running session reports. Overridable so both branches are testable.
dmi_name=${DEBIAN_SETUP_DMI_NAME:-$(cat /sys/class/dmi/id/product_name 2>/dev/null || true)}
case "$dmi_name" in
    *UM5606*)
        printf '\nThis looks like an ASUS Zenbook UM5606 (%s).\n' "$dmi_name"
        printf 'Its profile sets eDP-1 to 1920x1200 and maps the touchscreen to that output.\n'
        if ask 'Use the bundled Zenbook screen profile?'; then
            install_file "$bundle_dir/profiles/zenbook-um5606.conf" sway/config.d/00-local.conf
        fi ;;
    *)
        if [[ -n "${SWAYSOCK:-}" ]] && command -v swaymsg >/dev/null && command -v jq >/dev/null; then
            generated=$(swaymsg -t get_outputs | jq -r \
                '.[] | "output \(.name) mode \(.current_mode.width)x\(.current_mode.height) scale 1"')
            if [[ -n "$generated" ]]; then
                printf '\nThis session reports these outputs:\n%s\n' "$generated"
                if ask 'Write this as your local Sway profile?'; then
                    if ! "$dry_run"; then
                        profile_temp=$(mktemp)
                        printf '# Generated from swaymsg -t get_outputs on %s.\n' "$(date +%Y-%m-%d)" > "$profile_temp"
                        printf '# Check inputs with: swaymsg -t get_inputs\n%s\n' "$generated" >> "$profile_temp"
                        install_file "$profile_temp" sway/config.d/00-local.conf
                        unlink "$profile_temp"
                    else
                        printf 'Would write sway/config.d/00-local.conf with those outputs\n'
                    fi
                fi
            fi
        else
            printf '\nNot running inside Sway, so the outputs are unknown and no profile is written.\n'
            printf 'After your first Sway login, run: swaymsg -t get_outputs\n'
            printf 'then put the output lines in %s/sway/config.d/00-local.conf\n' "$target_config"
        fi ;;
esac
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/setup-sway-smoke.js`
Expected: PASS — all three profile paths.

- [ ] **Step 5: Commit**

```bash
cd ~/debian-desktop-setup
git add setup-sway.sh tests/setup-sway-smoke.js
git commit -m "Offer a screen profile that matches the machine

The Zenbook profile is offered only when the DMI product name says so. On other
hardware, a session already running Sway gets a profile generated from swaymsg
-t get_outputs, shown before it is written; outside Sway nothing is written and
the installer says which command to run after the first login. Only the Zenbook
path can be confirmed on real hardware, so the other two are tested with stubs
and the README says as much."
```

---

### Task 8: the greeter, snapd's socket and the README

**Files:**
- Modify: `setup-sway.sh` (the greeter step), `install.sh` (the service list), `README.md`
- Test: `tests/setup-sway-smoke.js`, `tests/install-smoke.js`, `tests/readme-smoke.js`

**Interfaces:**
- Consumes: `ask`, `attempt`, `$release`.
- Produces: the finished installers. No new interface for later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `tests/setup-sway-smoke.js`, before the cleanup:

```js
// The greeter is offered and declined by default: a run of all-no touches no service.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-greeter-'));
    const stubs = path.join(home, 'bin');
    fs.mkdirSync(stubs);
    const log = path.join(home, 'calls');
    for (const name of ['apt-get', 'sudo', 'systemctl', 'apt-cache', 'sway']) {
        fs.writeFileSync(path.join(stubs, name), name === 'sudo'
            ? '#!/bin/sh\nexec "$@"\n'
            : `#!/bin/sh\necho "${name} $*" >> ${log}\nexit 0\n`, {mode: 0o755});
    }
    const declined = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'n\n'.repeat(40),
        env: {...env(debian, home), PATH: `${stubs}:${process.env.PATH}`},
    });
    assert.equal(declined.status, 0, declined.stderr);
    assert.match(declined.stdout, /lightdm/, 'The greeter step must at least be mentioned');
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.doesNotMatch(calls, /systemctl enable/, 'Declining must enable nothing');
    // Accepting installs the greeter and its GTK greeter, and enables the service.
    fs.rmSync(log, {force: true});
    const accepted = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {...env(debian, home), PATH: `${stubs}:${process.env.PATH}`,
            DEBIAN_SETUP_DMI_NAME: 'Generic Laptop', SWAYSOCK: ''},
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    const accCalls = fs.readFileSync(log, 'utf8');
    assert.match(accCalls, /apt-get install -y lightdm lightdm-gtk-greeter/, 'Install both parts');
    assert.match(accCalls, /systemctl enable lightdm\.service/, 'And enable it');
    fs.rmSync(home, {recursive: true, force: true});
}
```

Append to `tests/install-smoke.js`, inside the existing services block (the one that reads the `calls` log) — add `snapd.socket` to the units it requires:

```js
    for (const unit of ['NetworkManager.service', 'bluetooth.service', 'fstrim.timer', 'snapd.socket']) {
        assert.match(calls, new RegExp(`systemctl enable --now ${unit.replace('.', '\\.')}`), `Missing unit: ${unit}`);
    }
```

Append to `tests/readme-smoke.js`, before the final `console.log`:

```js
// The Sway session has to be documented where a reader will look for it.
assert.match(readme, /^## The Sway session$/m, 'Phase 2 documents its own section');
assert.match(readme, /setup-sway\.sh/, 'Name the script that installs it');
assert.match(readme, /dbus-run-session sway/, 'Document the route that needs no greeter');
assert.match(readme, /Super\+period/, 'Document the emoji picker key');
assert.match(readme, /swaymsg -t get_outputs/, 'Say how to write a profile on other hardware');
// Claims the tests cannot support must be marked as unverified, not stated as fact.
assert.match(readme, /not been run on a real Debian|confirmed on the machine|cannot show/i,
    'Say what a container test does not prove');
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
cd ~/debian-desktop-setup
node tests/setup-sway-smoke.js 2>&1 | tail -3
node tests/install-smoke.js 2>&1 | tail -3
node tests/readme-smoke.js 2>&1 | tail -3
```

Expected: `The greeter step must at least be mentioned`; `Missing unit: snapd.socket`; `Phase 2 documents its own section`.

- [ ] **Step 3: Add the greeter step to `setup-sway.sh`**

Insert after the profile step, before `finished=true`:

```bash
# No greeter is installed unless asked for: the machine already boots into something,
# and taking that over is not a side effect an optional step should have.
printf '\nA greeter is not required. The sway package installs the session file, so any\n'
printf 'greeter already on this machine will list Sway, and a text console can start it with\n'
printf 'dbus-run-session sway.\n'
printf 'lightdm with lightdm-gtk-greeter lists both X11 and Wayland sessions, and is what the\n'
printf 'Arch machine this configuration comes from uses.\n'
if ask 'Install lightdm and its GTK greeter, and enable it at boot?'; then
    attempt sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y lightdm lightdm-gtk-greeter
    attempt sudo systemctl enable lightdm.service
    printf 'lightdm starts at the next boot. Choose Sway or i3 from its session menu.\n'
fi
```

- [ ] **Step 4: Add `snapd.socket` to the service list in `install.sh`**

```bash
for service in NetworkManager.service bluetooth.service fstrim.timer snapd.socket; do
    if ask "Enable and start $service?"; then attempt sudo systemctl enable --now "$service"; fi
done
```

Add the sentence that tells the truth about it, just above that loop:

```bash
printf '\nsnapd.socket is what makes snap packages work. On Ubuntu the browser is a snap and\n'
printf 'needs it; on Debian nothing this project installs is a snap, and it stays idle until\n'
printf 'something asks for one.\n'
```

- [ ] **Step 5: Write the README sections**

Add after the `## Services` section:

```markdown
## The Sway session

Phase 2 adds an optional Wayland session. The i3 desktop stays installed and
unchanged; the two live side by side and the greeter's session menu chooses
between them.

```bash
bash setup-sway.sh          # or --dry-run to see every step first
```

It installs the `sway` package group, the Sway, Waybar, mako, swaylock and
portal configuration, and a screen profile. Every step asks first, and every
replaced file is backed up under `~/.local/state/debian-desktop-setup/`.

**Starting it.** The `sway` package installs
`/usr/share/wayland-sessions/sway.desktop`, so an existing greeter lists Sway
with no help from the installer. Without a greeter, log into a text console and
run `dbus-run-session sway`. The installer offers to set up `lightdm` with
`lightdm-gtk-greeter`, and declines by default.

**The screen profile.** On an ASUS Zenbook UM5606 the bundled profile sets
eDP-1 to 1920x1200 and maps the touchscreen to it. On other hardware, run
`setup-sway.sh` from inside a Sway session and it writes a profile from
`swaymsg -t get_outputs`; outside Sway it writes nothing and tells you to run
that command after your first login. `~/.config/sway/config.d/00-local.conf` is
the file to edit either way.

**Keys.** Alt+D apps · Alt+B Firefox · Print screenshot · Super+period emoji ·
Alt+C clipboard history · Alt+L lock · Alt+` notes · Shift+Caps Lock
English/Arabic · Alt+Shift+E log out.

**The emoji picker.** `rofi-emoji` is packaged in neither release, so
Super+period runs a bundled picker that reads the emoji list from
`unicode-data` and types the choice with `wtype` (Wayland) or `xdotool` (X11).
If the compositor refuses synthetic input, the character goes to the clipboard
and a notification says so.

**What has not been confirmed.** The tests in this repository validate the Sway
configuration with `sway -C`, check that Waybar 0.12.0 and 0.15.0 both load
`config.jsonc`, and resolve every package name in both releases. They cannot
show that the session renders, that the touchscreen mapping works, or that the
fonts look right: those are confirmed on the machine, and this README will say
so when they have been.
```

Update `## What comes later` to drop the Sway line and keep phases 3 and 4:

```markdown
## What comes later

Phases 1 and 2 cover the i3 desktop, the shell, the editor and the Sway
session. Still to come, each with its own design document under
`docs/superpowers/specs/`:

1. Third-party applications: Chrome, DBeaver, Teams, Dropbox, OnlyOffice,
   Postman, and Tor Browser fetched through a VPS. `snapd` is already installed,
   so each application chooses between a snap and a vendor apt repository.
2. System extras: Docker, SSH hardening, conky, zram and snapshots. The conky
   panel fragments for both i3 and Sway arrive here.
```

- [ ] **Step 6: Run the whole suite**

```bash
cd ~/debian-desktop-setup
for t in tests/*.js; do printf '%-32s' "$t"; node "$t" >/dev/null 2>&1 && echo OK || { echo FAIL; node "$t" 2>&1 | tail -6; }; done
```

Expected: eight OK.

- [ ] **Step 7: Commit**

```bash
cd ~/debian-desktop-setup
git add setup-sway.sh install.sh README.md tests/setup-sway-smoke.js tests/install-smoke.js tests/readme-smoke.js
git commit -m "Offer a greeter, enable snapd's socket and document the session

The greeter step installs lightdm with its GTK greeter and is declined by
default: the machine already boots into something and an optional step should
not take that over. snapd.socket joins the service list with a sentence saying
what it does and does not do on each release. The README documents the session,
the keys, the profile, the emoji picker, and what the tests in this repository
cannot show."
```

---

### Task 9: sway and waybar in containers

**Files:**
- Create: `tests/sway-container-smoke.js`
- Test: itself

**Interfaces:**
- Consumes: the installed configuration layout from Task 5.
- Produces: nothing other scripts read.

- [ ] **Step 1: Write the failing test**

Create `tests/sway-container-smoke.js`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// Validates the real configuration inside both releases. Gated: needs Docker.
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (process.env.DEBIAN_SETUP_CONTAINER_TESTS !== '1') {
    console.log('sway-container-smoke: skipped (set DEBIAN_SETUP_CONTAINER_TESTS=1 to run)');
    process.exit(0);
}

// The configuration is mounted read-only at the path the session expects, so sway -C
// resolves the include and the scripts' paths exactly as it would on the machine.
const script = `
set -e
apt-get update -qq >/dev/null 2>&1
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends sway waybar jq >/dev/null 2>&1
mkdir -p "$HOME/.config"
cp -r /bundle/config/sway /bundle/config/waybar /bundle/config/mako /bundle/config/swaylock "$HOME/.config/"
cp /bundle/profiles/zenbook-um5606.conf "$HOME/.config/sway/config.d/00-local.conf"
echo "sway: $(sway --version)"
sway -C -c "$HOME/.config/sway/config" && echo "sway -C: ok"
echo "waybar: $(waybar --version)"
# Waybar only parses its configuration once it has a Wayland display, so give it a
# headless one. D-Bus must exist or the tray module logs a failure that is not ours.
printf 'exec waybar\\nexec sh -c "sleep 8; swaymsg exit"\\n' > /tmp/probe.conf
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 XDG_RUNTIME_DIR=/tmp \\
  dbus-run-session -- sway -c /tmp/probe.conf > /tmp/log 2>&1 || true
grep -E 'waybar|\\[error\\]' /tmp/log || true
`;

for (const image of ['debian:stable-slim', 'ubuntu:latest']) {
    const result = spawnSync('docker', ['run', '--rm', '-v', `${root}:/bundle:ro`,
        '-e', 'HOME=/tmp/home', image, 'sh', '-c', script],
        {encoding: 'utf8', timeout: 1800000});
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, `${image}: ${output}`);
    assert.match(output, /sway -C: ok/, `${image}: sway rejected the configuration:\n${output}`);
    // A module name Waybar does not know is reported as an error on startup.
    assert.doesNotMatch(output, /\[error\].*(module|config|json)/i,
        `${image}: Waybar complained about the configuration:\n${output}`);
    const version = output.match(/waybar: Waybar v([\d.]+)/);
    assert.ok(version, `${image}: no Waybar version in the output:\n${output}`);
    console.log(`sway-container-smoke: ${image} validated with sway ` +
        `${(output.match(/sway: sway version ([\d.]+)/) || [])[1]} and waybar ${version[1]}`);
}
console.log('sway-container-smoke: all checks passed');
```

- [ ] **Step 2: Run it to make sure it fails for the right reason**

```bash
cd ~/debian-desktop-setup
node tests/sway-container-smoke.js
DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/sway-container-smoke.js
```

Expected: the first prints `skipped`. The second must actually run and pass — if `sway -C` rejects the configuration, that is a real finding about the copied tree (most likely a path in `config.d` or a `bindsym` referring to a script that is not installed in the container); fix the configuration, not the test. If Waybar logs an error naming a module, the spec's claim that every module predates 0.12 is wrong and the plan needs revisiting before the README repeats it.

- [ ] **Step 3: Run everything, fast and gated**

```bash
cd ~/debian-desktop-setup
for t in tests/*.js; do printf '%-32s' "$t"; node "$t" >/dev/null 2>&1 && echo OK || { echo FAIL; node "$t" 2>&1 | tail -6; }; done
DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/apt-names-smoke.js
DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/sway-container-smoke.js
bash scripts/sync-from-arch.sh --check | tail -2
```

Expected: nine OK; both container tests passing; zero drift. `apt-names-smoke` needs no edit — it reads every row of the map, so the `sway` group and the two browser rows are already covered, and its counts rise by the number of rows added in Task 2.

- [ ] **Step 4: Commit**

```bash
cd ~/debian-desktop-setup
git add tests/sway-container-smoke.js
git commit -m "Validate the Sway and Waybar configuration in both releases

sway -C needs no compositor, and Waybar parses its configuration once it has a
headless Wayland display, so both can be checked inside a container. This is
what stands behind the README's claim that the configuration is valid on Debian
13 and Ubuntu 26.04 — and the only thing that would catch Waybar 0.12 rejecting
a module the configuration uses."
```

---

## Where this plan departs from the spec

- The spec described a separate `sway/emoji.sh`. The Arch `setup-sway.sh` installs
  `config/i3/emoji.sh` to both `i3/emoji.sh` and `sway/emoji.sh`, so this plan
  rewrites that one file and installs it twice. The i3 session gains a working
  picker as a side effect, which the spec did not promise and the README now does.
- The spec put `map_group_packages` inside the `lib/common.sh` move. The plan
  splits it into Task 3 so Task 1 stays a pure move provable by the unmodified
  phase 1 suite.
- The spec listed `tests/sway-config-smoke.js` and `tests/waybar-smoke.js`
  separately. They share one container run, so they are one file,
  `tests/sway-container-smoke.js`.
- `scripts/sync-from-arch.sh` gains a prefix mapping the spec did not mention:
  the Arch repository keeps the session under `sway/config/`, this one under
  `config/`, and without the mapping every new file would be reported `missing`
  for ever.

## Verification before calling phase 2 done

- [ ] `for t in tests/*.js; do node "$t" || break; done` — nine files pass.
- [ ] `DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/apt-names-smoke.js` — every name resolves and simulates in both images.
- [ ] `DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/sway-container-smoke.js` — `sway -C` accepts the configuration and Waybar loads it in both images.
- [ ] `bash setup-sway.sh --dry-run` with `DEBIAN_SETUP_OS_RELEASE` pointing at a Debian and an Ubuntu file — both previews complete and differ only where the map says.
- [ ] `bash scripts/sync-from-arch.sh --check` — zero drift, zero missing.
- [ ] `git log --oneline` — nine commits, each authored `AhmedAnbar`, no co-author trailers.

What phase 2 cannot show, and must not claim: that the session starts on real
hardware, that the touchscreen mapping works, that `wtype` is permitted by the
running compositor, or that the snap browser installs. Each is confirmed on the
machine, and the README says so until then.
