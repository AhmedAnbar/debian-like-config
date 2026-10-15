# Phase 4: /opt tarballs, the conky panel, and the system-level work

Date: 2026-10-15
Status: approved design, pending plan
Evidence: `docs/superpowers/specs/2026-10-15-phase-3-4-recon.md`. Versions are a
2026-10-15 snapshot, proved in `debian:stable-slim` and `ubuntu:latest`, amd64.

## Purpose

Phase 3 covered the applications a vendor apt repository can deliver. What is
left is everything that cannot come from apt at all — two applications that ship
as tarballs, one of which cannot even be downloaded from this network — plus the
system-level work phases 1 and 2 deliberately deferred: the conky panel, zram,
filesystem snapshots and SSH hardening.

After this phase the Debian repository covers every subject the Arch repository
does, and `scripts/sync-from-arch.sh --check` is the standing guard that it
stays that way.

## Targets

Debian 13 (trixie) and Ubuntu 26.04 LTS, amd64. No assumption about the root
filesystem: the snapshot step detects it and skips itself when it is not btrfs.

## Scope

In: `setup-postman.sh`, `setup-tor-browser.sh`, the Nerd Font step, the conky
panel for both sessions, `setup-zram.sh`, `setup-snapshots.sh` and
`setup-hardening.sh`.

Out: nothing. This is the last phase.

## The decisions taken

1. **One tarball mechanism, written once.** Postman and Tor Browser share it:
   download, verify, unpack into a versioned directory under `/opt/<name>/`, a
   `current` symlink, a hand-written `.desktop` file and icon, and re-running
   the script as the update path. `install_tarball_app` in `lib/common.sh`.
2. **Tor Browser is staged over the `vps` ssh alias.** `dist.torproject.org` is
   unreachable from this machine — every host returned `curl: (6) Could not
   resolve`. The script's primary path is `scp vps:<remote path>` into a scratch
   directory; `--from-dir <dir>` installs from files already on disk with no
   network at all. `gpg --verify` was proved to work under `docker run
   --network none`, so verification never needs the network either. The alias is
   the only identifier in the repository: no host, user, port or address. The
   README tells the reader to write their own `Host vps` block.
3. **`torbrowser-launcher` is rejected**, on its own evidence: Debian contrib
   0.3.7-3 bundles a key that expired 2025-07-21 with a signing subkey that
   expired 2024-08-23; Ubuntu universe 0.3.9-1build1's subkey expires
   2026-10-26. Both must reach torproject.org on first run and neither can be
   fed from disk.
4. **Snapshots use btrbk, with snapper offered separately.** btrbk 0.32.6 on
   both releases was proved to create `snaps/@.20261015T1938` on a real
   loop-mounted btrfs; snapper's `create-config` was proved to make the nested
   `@/.snapshots` subvolume. timeshift is rejected in its own words: "Only
   ubuntu-type layouts with @ and @home subvolumes are currently supported."
   `findmnt -no FSTYPE /` is the first thing the step runs, and anything but
   btrfs skips with a reason rather than failing.
5. **Snapper's apt hook is offered in the same breath as snapper.**
   `/etc/apt/apt.conf.d/80snapper` takes a pre and post snapshot around *every*
   apt invocation the moment `/etc/snapper/configs/root` exists, which changes
   the cost of every later step in this repository. The prompt says so and
   offers `DISABLE_APT_SNAPSHOT="yes"`.
6. **SSH hardening runs last, asks loudest, and cannot lock the user out.**
   It is the only thing in this repository that changes how the machine can be
   reached, and installing `openssh-server` starts a listening service, which
   nothing else here does. Both are declined by default. The script **refuses to
   disable password authentication** unless it finds an `authorized_keys` with at
   least one key and the user confirms that a key login already works; it writes
   a drop-in under `/etc/ssh/sshd_config.d/`, validates the staged file with
   `sshd -t` before installing it, and restarts the right unit per release —
   `ssh.service` on Debian, `ssh.socket` on Ubuntu, which their postinsts were
   proved to enable differently.
7. **zram is computed, not guessed.** `systemd-zram-generator` 1.2.1-2 on both
   releases already ships an active `[zram0]` in
   `/usr/lib/systemd/zram-generator.conf` with `min(ram / 2, 4096)`. This
   machine has 30 GB of RAM and a 59 GB swap partition, so the only honest
   reason to write `/etc/systemd/zram-generator.conf` is to raise the cap; the
   step computes `min(ram / 2, 8192)` from `/proc/meminfo`, shows the number
   before writing it, and says that the shipped default is already active if
   declined.
8. **The Nerd Font is its own step**, never folded into the conky panel. The
   panel's glyphs come from a patched font that neither release packages;
   fontconfig substitutes something legible without it, so the panel step works
   alone and the font step says what it improves.

## The tarball helper

```
# Usage: install_tarball_app <name> <tarball> <version> <strip dir> <desktop file>
```

Unpacks into `/opt/<name>/<version>/`, points `/opt/<name>/current` at it,
installs the `.desktop` file into `/usr/share/applications/` and the icon into
`/usr/share/icons/hicolor/`, and leaves the previous version in place so a bad
update is one symlink away from being undone. It refuses to touch `/opt` until
`tar -tf` has listed the archive cleanly and the expected top-level entry is
present — for Postman that is the only integrity gate there is.

## The scripts

| Script | Route proved | Version | Notes |
| --- | --- | --- | --- |
| `setup-postman.sh` | `dl.pstmn.io/download/version/<v>/linux64` plus eleven apt runtime libraries | 12.32.3 | `ldd` on the bundled binary reported 26 missing sonames on a bare install and zero after the eleven packages; Electron then booted and stopped only at `Missing X server or $DISPLAY`. Postman publishes **no checksum or signature at all** — every `.sha256` and `SHASUMS` path returns 400 — so a clean `tar -tzf` containing `Postman/app/postman` is the integrity gate, and the README says so. The `.desktop` basename must be exactly `Postman.desktop`: `main.js` runs `xdg-mime default Postman.desktop x-scheme-handler/postman` on every launch, and any other name silently breaks `postman://` deep links, OAuth sign-in among them. The snap is 11.71.7 on a core18 base, a major version behind, and is not offered |
| `setup-tor-browser.sh` | `scp vps:…` or `--from-dir`, then `gpg --verify` offline | tor-browser 15.0.25 | Signing key from `keys.openpgp.org`, fingerprint `EF6E286DDA85EA2A4BA7DE684E2C6E8793298290`; the tarball's sha256 was proved to match the signed manifest and `gpg --verify` printed `GOODSIG 316C1FACD62D07D9` with the network off. A failed signature **stops that step** and records it; it must never fall through to extraction. `gnupg` and `xz-utils` are named in the map |
| `setup-conky.sh` | apt `conky-std` | 1.22.1-1 / 1.22.2-1build1 | `conky` is a pure virtual package with no candidate; `-std` carries the Lua config, Xft, ARGB own-window and Wayland output. The unmodified Arch `config/conky` tree loaded and drew under Xvfb on both releases with no unknown-setting errors. Restores `config/sway/config.d/30-conky.conf`, the i3 autostart and `$mod+Shift+t`, and flips the two assertions in `tests/setup-sway-smoke.js` that currently require their absence |
| `setup-zram.sh` | apt `systemd-zram-generator` | 1.2.1-2 both | `/etc/systemd/zram-generator.conf` is the file actually read — a bad value produced `Undefined("this")` and exit 1. The generator prints "Running in a container, exiting", so unit generation and `swapon --show` are confirmed on the machine, not in a test |
| `setup-snapshots.sh` | apt `btrbk` (+`btrfs-progs`), `snapper` opt-in | btrbk 0.32.6 both; snapper 0.10.6; btrfs-progs 6.14-1 / 6.17.1-1build1 | btrbk ships only `btrbk.conf.example`, so the repository installs the config. Both tools refuse a non-btrfs target with a message |
| `setup-hardening.sh` | apt `openssh-server` + a drop-in | 1:10.0p1-7+deb13u4 / 1:10.2p1-2ubuntu3.8 | `sshd -T` was proved to pick up a drop-in, the stock default is `passwordauthentication yes` on both, and `sshd -t` exits 255 naming the offending file. `~/arch-desktop-setup/setup-ssh.sh` does **not** port: it is purely client-side, writes `~/.ssh/config.d/<alias>.conf` and never touches `/etc/ssh`. What ports is its discipline — Include-plus-drop-in rather than editing the main file, and validating a staged file before installing it |

Ubuntu keeps `conky-std`, `snapper`, `btrbk` and `systemd-zram-generator` in
**universe**, so every one of those steps uses `attempt`, not `run`.

## Map rows

```
postman	-	libgtk-3-0t64	both	One of the eleven Electron runtime libraries; ldd on the bundled Postman binary reports 26 missing sonames without them
conky-panel	conky	conky-std	both	conky is a pure virtual package with no installation candidate; -std carries the Lua config, Xft and ARGB own-window the panel needs
hardening	-	openssh-server	both	sshd lives here, not in the openssh-client the dev group already installs; installing it starts a listening service
hardening	zram-generator	systemd-zram-generator	both	Both releases prefix the package systemd-; the Arch name zram-generator does not exist in apt
snapshots	btrbk	btrbk	both	0.32.6 on both releases; ships only btrbk.conf.example, so this repository installs the configuration
snapshots	snapper	snapper	both	Needs the configured path to be a btrfs subvolume, and adds an apt hook that snapshots around every later apt run
snapshots	btrfs-progs	btrfs-progs	both	The subvolume tooling both snapshot routes call
tor	-	gnupg	both	Verifies the Tor Browser tarball signature, which is done offline
tor	-	xz-utils	both	Unpacks the Tor Browser tarball
dev	postman	-	none	Postman publishes no apt package and no vendor repository; setup-postman.sh installs the official tarball into /opt
tor	torbrowser-launcher	-	none	Packaged in Debian contrib and Ubuntu universe, but both ship a dead signing key and must reach torproject.org on first run; setup-tor-browser.sh installs the signed upstream tarball instead
```

The remaining eleven Postman runtime libraries are named in the plan rather than
here, to keep this table readable; all eleven were proved necessary by `ldd`.

## Tests

| File | What it pins |
| --- | --- |
| `tests/tarball-smoke.js` (new) | `install_tarball_app` against a fixture archive: the versioned directory, the `current` symlink, the `.desktop` and icon paths, that a previous version survives an update, and that a malformed archive is refused before `/opt` is touched |
| `tests/setup-extras-smoke.js` (new) | All six scripts: argument handling, release refusal, `--dry-run` writes nothing, every step declines by default, failures are named and the exit status is non-zero. `setup-tor-browser.sh` with an unreachable alias skips with a message and exit 0; with `--from-dir` and a bad signature it stops without extracting; `setup-hardening.sh` with no `authorized_keys` refuses to disable password authentication; `setup-snapshots.sh` on a stub `findmnt` reporting ext4 skips with a reason; `setup-zram.sh` computes its size from a stub `/proc/meminfo` |
| `tests/setup-sway-smoke.js` | The two assertions requiring the conky fragment's absence are flipped to require its presence, and the i3 autostart assertion with them |
| `tests/extras-container-smoke.js` (new, gated) | `conky-std`, `systemd-zram-generator`, `btrbk`, `snapper`, `btrfs-progs`, `openssh-server` and Postman's eleven libraries all resolve in both images; the conky configuration loads under Xvfb; `sshd -T` reads the drop-in |
| `tests/readme-smoke.js` | A `## System extras` section, the `Host vps` instruction, the Postman integrity caveat, and the snapshot filesystem requirement |

## Risks

- **Postman has no publisher integrity at all.** A clean `tar` listing is not a
  signature, and the README must not imply that it is.
- **Tor Browser's whole route depends on a relay no test can reach.** The
  `--from-dir` path is what the tests cover; the `scp` path is confirmed on the
  machine.
- **SSH hardening is the one step that can lock the user out of a remote
  machine.** The key check, `sshd -t`, and the per-release unit are the three
  guards; none of them proves a key login works, which is why the prompt asks
  the user to confirm it has.
- **Snapshots may be inapplicable entirely.** The target filesystem is unknown
  and the step is written to say so and skip.
- **The conky panel was proved under Xvfb, not on a Sway surface.** Its hwmon
  and battery lines, and what fontconfig substitutes for the missing Nerd Font,
  are confirmed on the machine.
- **Ubuntu universe is load-bearing** for four of these subjects.
