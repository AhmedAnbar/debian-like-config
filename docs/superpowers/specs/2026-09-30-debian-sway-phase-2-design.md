# debian-desktop-setup — phase 2 design: the Sway session

Date: 2026-09-30
Status: approved in conversation; implementation plan to follow
Predecessor: `2026-09-28-debian-desktop-setup-design.md` (phase 1, merged as `b32886f`)

## Purpose

Port the Sway/Wayland session from `arch-desktop-setup` to Debian 13 and
Ubuntu 26.04, as an optional addition that leaves the phase 1 i3 desktop
installed and unchanged. On Arch the Sway session is a separate script that the
user may never run; this phase keeps that relationship, so declining Wayland
costs nothing and choosing it does not disturb X11.

## Targets

- Debian 13 (trixie): Sway 1.10.1, Waybar 0.12.0.
- Ubuntu 26.04.1 LTS: Sway 1.11, Waybar 0.15.0.
- Hardware: the ASUS Zenbook UM5606WA, and machines whose outputs are unknown.
  Both paths are designed; only the Zenbook path can be confirmed on real
  hardware during this phase.

## Scope

In scope: the compositor and its configuration, Waybar, mako notifications,
swaylock and swayidle, the screenshot and clipboard helpers, the portal
configuration, the Wayland session's polkit agent, a bundled emoji picker, the
hardware profile, and an optional greeter.

Out of scope: `30-conky.conf` and the conky panel (phase 4), third-party
applications (phase 3), and anything that needs a display to prove.

Phase 2 also removes the conky autostart from the phase 1 i3 configuration. That
line references a tool no phase before 4 installs, and it was recorded as a
deferred finding at the end of phase 1; a fragment that starts a missing program
belongs to the phase that installs it.

## Conventions inherited from phases past

Phase 1's conventions hold without restatement: GPL-3.0-only headers,
`set -Eeuo pipefail` with an ERR trap reporting `${BASH_LINENO[0]}`, every
prompt declinable, every replaced file backed up under
`~/.local/state/debian-desktop-setup/<timestamp>-<pid>/`, no `sudo` outside a
`run`/`attempt` call, and no claim in the README that a test does not cover.

## Shared helpers: `lib/common.sh`

`install.sh` currently owns `ask`, `run`, `attempt`, `install_file`, the
`declined`/`failed` accumulators and the EXIT-trap summary. `setup-sway.sh`
needs all of them. Copying them would give the consent-and-backup path a second
implementation — exactly the defect the phase 1 review found in the one place
that bypassed `install_file` — so they move to `lib/common.sh`, sourced by
`install.sh`, `setup-sway.sh`, `setup-zsh.sh` and `setup-nvim.sh`.

The library owns no policy: the sourcing script sets `backup_dir`,
`target_config` and `dry_run` before sourcing, and the library reads them. This
keeps `setup-sway.sh` free to back up into its own timestamped directory while
sharing one consent prompt, one backup rule and one summary.

Moving code that four scripts depend on is the riskiest change in this phase.
It happens in its own task, with the phase 1 test suite green before and after,
and no behaviour change: a pure move, proven by the existing tests continuing to
pass unmodified.

## The package group

A new `sway` group in `packages/apt-map.tsv`, mapping the 38 names in
`arch-desktop-setup/sway/packages.txt`. Verified in `debian:stable-slim` and
`ubuntu:latest` on 2026-09-30:

| Arch | apt | where | Why it differs |
| --- | --- | --- | --- |
| `polkit-gnome` | `mate-polkit` | both | `policykit-1-gnome` does not exist in Debian 13; MATE's GTK agent is its equivalent, verified as 1.26.1-4 on Debian and 1.26.1-6 on Ubuntu, so one code path serves both |
| `rofi-emoji` | `unicode-data` | both | Packaged nowhere; the bundled picker reads its emoji list from this package instead |
| `libpulse` | `pulseaudio-utils` | both | Already corrected in phase 1: the volume keys need `pactl` |
| `xorg-xwayland` | `xwayland` | both | The launcher is rofi, which is X11-only in Debian's 1.7.5 |
| `qt5-wayland` | `qtwayland5` | both | Debian's naming |
| `qt6-wayland` | `qt6-wayland` | both | Same name |
| `bluez-utils` | `bluez` | both | Debian ships the tools in `bluez` itself |
| `noto-fonts` | `fonts-noto` | both | Debian font naming, as in phase 1 |
| `networkmanager` | `network-manager` | both | Debian naming |
| `network-manager-applet` | `network-manager-gnome` | both | Debian naming |
| `libnotify` | `libnotify-bin` | both | `notify-send` lives in the `-bin` package |
| `mako` | `mako-notifier` | both | Debian naming |

Names already in the map from phase 1 — `kitty`, `rofi`, `firefox-esr`,
`gsettings-desktop-schemas`, `libglib2.0-bin`, `brightnessctl`, `jq`, `cliphist`,
`wl-clipboard`, `xdg-utils`, `xdg-user-dirs`, `pipewire*`, `wireplumber`,
`blueman`, `bluez`, `dbus` — are not duplicated: the map's one-row-per-Arch-name
rule holds, and `setup-sway.sh` installs the union of the `sway` group and
whatever phase 1 rows it needs, deduplicated as `install.sh` already does.

`sway`, `swaybg`, `swayidle`, `swaylock`, `waybar`, `grim`, `slurp`, `wtype`,
`xdg-desktop-portal-wlr`, `xdg-desktop-portal-gtk` and `unicode-data` all
resolve under their own names in both releases.

## The browser and snap

Decided on 2026-09-30, replacing phase 1's deferral: Debian installs
`firefox-esr` from apt, Ubuntu installs Firefox as a snap, and `snapd` is
installed on both.

Ubuntu needs no explicit `snap install`. Its apt `firefox`
(`1:1snap1-0ubuntu9.1`) describes itself as "Installs Firefox snap and provides
some system integration", so `apt-get install -y firefox` performs the snap
installation through the package's `postinst`, which keeps the browser inside
the one package step the installer already has and stays idempotent on a rerun.
`DEBIAN_FRONTEND=noninteractive` is set for that step so its debconf prompt
cannot block an unattended run.

`snapd` is verified as 2.68.3 on Debian and 2.76.3 on Ubuntu. Debian's package
owns `/snap` itself — confirmed with `dpkg -L snapd` — so the symlink that
classic snaps need on some distributions is not a step here. It ships
`snapd.socket`, `snapd.service` and `snapd.apparmor.service`; enabling
`snapd.socket` joins the optional service list beside NetworkManager and
bluetooth, declinable like the rest. On Debian, where no snap is installed by
this project, `snapd` is groundwork for phase 3 and does nothing until a snap
is asked for; the installer says that rather than implying a benefit.

### The map's uniqueness rule generalizes

`packages/apt-map.tsv` currently allows one row per Arch package name. The
browser is the first package that maps to a different apt name on each release,
so the rule becomes: no Arch name may appear twice **for the same release**.
Two rows for `firefox` — `firefox-esr` where `debian`, `firefox` where
`ubuntu` — are legal; two rows both marked `both`, or both marked `debian`, are
not. `tests/apt-map-smoke.js` checks the pair rather than the name, and the
existing note requirement still applies to every row that differs.

The current `firefox` row's note says phase 3 will add the Mozilla apt
repository. That is now wrong and is corrected with the row.

## setup-sway.sh

Ordered as the Arch script is, with every step declinable:

1. Guards: not root, `apt-get` present, `config/sway` present, release detected
   through the same `DEBIAN_SETUP_OS_RELEASE`-overridable path as phase 1.
2. Report the Sway and Waybar versions apt offers, so the user sees what they
   are getting before agreeing to anything.
3. Install the `sway` group.
4. Install the configuration bundle through `install_file`: `sway/`, `waybar/`,
   `mako/`, `swaylock/`, `xdg-desktop-portal/`, with the session scripts at mode
   755 and everything else at 644.
5. Validate the installed configuration with `sway -C -c <installed config>`,
   which needs no display, and report the result. A failure is reported, not
   fatal: the files are already backed up and the user can inspect them.
6. The hardware profile (below).
7. The optional greeter (below).
8. The closing summary from `lib/common.sh`, naming the backup directory, the
   keys, and the fact that i3 is untouched.

## The hardware profile

`config/sway/config.d/00-local.conf` is where output and input settings live.
Three paths:

- **The Zenbook.** When `/sys/class/dmi/id/product_name` contains `UM5606`, offer
  the bundled `profiles/zenbook-um5606.conf` — `output eDP-1 mode 1920x1200
  scale 1` and the touchscreen mapped to `eDP-1`.
- **Unknown hardware, inside a Sway session.** Read `swaymsg -t get_outputs`
  with `jq`, and write a profile naming the real outputs at their current modes.
  Offered, shown before it is written, and declinable.
- **Unknown hardware, outside Sway.** Skip the step, and say that
  `swaymsg -t get_outputs` after the first login is how to fill
  `00-local.conf` in.

The DMI path is overridable (`DEBIAN_SETUP_DMI_NAME`) so both branches are
testable on any machine, exactly as `DEBIAN_SETUP_OS_RELEASE` makes the release
branches testable.

## The emoji picker

`config/sway/emoji.sh` replaces the `rofi-emoji` plugin binding on Super+period:

1. Read `/usr/share/unicode/emoji/emoji-test.txt` (present in both releases:
   Unicode 15.1 on Debian, 16.0 on Ubuntu).
2. Keep the `fully-qualified` lines, and present `<emoji> <name>` through the
   same themed rofi the launcher uses.
3. Type the chosen character into the focused window with `wtype`, and fall back
   to `wl-copy` with a notification when `wtype` is unavailable — a Wayland
   compositor may refuse synthetic input, and a copied emoji is still useful.
4. When `unicode-data` is missing, say so through `notify-send` and exit 0, the
   pattern phase 1 established for `cliphist` and the absent plugin.

The script is a shared file, not an adapted one: it is new to this repository,
and the Arch repository keeps its `rofi-emoji` plugin. `scripts/adapted-files.txt`
gains no row; `shared-files.txt` gains the new paths, and the drift check
tolerates files the Arch repository does not have — it already reports `missing`
rather than failing for those.

## Session start

The `sway` package installs `/usr/share/wayland-sessions/sway.desktop`, so any
existing greeter lists the session with no help from this installer. Phase 2
therefore installs no greeter by default. The README documents
`dbus-run-session sway` from a text console, and one optional step — declined
unless accepted, like the mkcert CA in phase 1 — installs and enables `lightdm`
with `lightdm-gtk-greeter` and says which sessions it will offer.

`lightdm` rather than `greetd`: it is what the Arch machine runs, so the two
desktops behave alike; it lists X11 and Wayland sessions from
`/usr/share/xsessions` and `/usr/share/wayland-sessions` with no configuration
at all; and it is packaged in both releases (1.32.0 in each). `greetd` is the
Wayland-native choice but needs a hand-written `config.toml` naming a greeter
command, which is a second file to install, back up and test for a step that
most runs will decline. Both `greetd` and `gtkgreet` are packaged in both
releases, so switching later costs one step, not a redesign.

## Waybar

The version difference between the releases turned out not to matter. Every
module the configuration uses — `sway/workspaces`, `sway/mode`, `sway/language`,
`clock` with its calendar and actions, `network`, `bluetooth`, `cpu`, `memory`,
`disk`, `battery`, `tray` — predates 0.12.0. There is no reduced configuration
and no version guard: `setup-sway.sh` prints the version apt offers, and a
container test asserts that 0.12.0 loads the real `config.jsonc` without parse
errors. If that test fails, this design changes; the README claims nothing the
test has not shown.

## Tests

| File | What it proves | Needs |
| --- | --- | --- |
| `tests/sway-config-smoke.js` | `sway -C` accepts the bundled configuration and every `config.d` fragment; the conky fragment is absent; `40-notes.conf` is present | `sway` in a container |
| `tests/waybar-smoke.js` | Waybar 0.12.0 and 0.15.0 both load `config.jsonc` and `style.css` with no error lines, under a headless Sway | containers, gated by `DEBIAN_SETUP_CONTAINER_TESTS=1` |
| `tests/setup-sway-smoke.js` | Prompts, declines, backups, the three profile paths, the greeter step staying off, and the summary naming the backup directory | stubs only |
| `tests/emoji-smoke.js` | The picker filters `emoji-test.txt` correctly, types with `wtype`, falls back to `wl-copy`, and reports a missing data file | stubs and a fixture |
| `tests/install-smoke.js` | Unchanged and still green after the `lib/common.sh` move | stubs only |
| `tests/apt-names-smoke.js` | Every `sway` group name resolves and simulates in both images | containers |
| `tests/drift-smoke.js` | The new files are listed exactly once, and shared files match the Arch repository byte for byte | the Arch checkout |
| `tests/readme-smoke.js` | Every installable package is documented, including the new group | none |
| `tests/apt-map-smoke.js` | No Arch name resolves twice for one release, and the two `firefox` rows are the only per-release split | none |

The headless compositor route is confirmed to work: `WLR_BACKENDS=headless
WLR_LIBINPUT_NO_DEVICES=1 sway` starts in `debian:stable-slim` and Waybar loads
a configuration under it. The probe also showed that D-Bus must be provided
(`dbus-run-session`) and that `xwayland` must be installed or Sway logs a
failure at startup.

## Risks

- **The `lib/common.sh` move touches working code.** Mitigated by doing it as a
  pure move in its own task, with the phase 1 suite unmodified and green either
  side. If a test needs changing, the move stopped being pure and must be
  reconsidered.
- **`mate-polkit`'s agent path differs from Arch's.** `session-start.sh` becomes
  an adapted file that probes the packaged locations and reports when none is
  found, rather than assuming one.
- **Synthetic input may be refused.** `wtype` needs the virtual-keyboard
  protocol; Sway supports it, but a future compositor or a locked session may
  not. The `wl-copy` fallback keeps the picker useful.
- **rofi under XWayland.** Debian's rofi 1.7.5 is X11-only, so the launcher and
  the emoji picker run through XWayland. Ubuntu's 2.0.0 may run natively; the
  configuration does not depend on which, and `xwayland` is installed either
  way.
- **The generated profile is untested on real hardware.** It is exercised with
  stubbed `swaymsg` output only. The README says so.
- **The snap installation cannot be verified here.** `apt-get install --simulate
  firefox` resolves the transitional package, but the snap it fetches needs a
  running `snapd`, systemd and network access, none of which a container test
  has. Phase 2 verifies that the name resolves and that the package is the snap
  installer; whether the browser starts on Wayland is confirmed on the machine.
- **Nothing here proves the session renders.** Container tests show
  configuration validity and package resolution. Whether the desktop starts,
  the touchscreen maps and the fonts render is confirmed on the machine, and
  the README does not claim it before then.

## Decisions still open

- Which of phase 3's applications come from snap now that `snapd` is present on
  both releases, and which keep a vendor apt repository. Phase 3 decides
  per application; this phase only installs `snapd` and the browser.
