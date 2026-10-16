<p align="center">
  <img src="assets/logo.png" alt="Debian Linux Config — tiled panel logo in Debian red" width="240">
</p>

<h1 align="center">Debian Linux Config</h1>

<p align="center">An interactive installer for a Catppuccin-inspired i3 desktop on Debian and Ubuntu.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-b4befe" alt="License: GPL-3.0"></a>
  <img src="https://img.shields.io/badge/OS-Debian_13-A80030?logo=debian&amp;logoColor=white" alt="Debian 13">
  <img src="https://img.shields.io/badge/OS-Ubuntu_26.04-E95420?logo=ubuntu&amp;logoColor=white" alt="Ubuntu 26.04">
  <img src="https://img.shields.io/badge/OS-Kali_Rolling-367BF0?logo=kalilinux&amp;logoColor=white" alt="Kali Rolling">
  <img src="https://img.shields.io/badge/Desktop-i3-313244?logo=i3&amp;logoColor=white" alt="i3 desktop">
  <img src="https://img.shields.io/badge/Shell-Zsh-a6e3a1?logo=zsh&amp;logoColor=313244" alt="Zsh">
</p>

This is the Debian-family sibling of [arch-desktop-setup](https://github.com/AhmedAnbar/arch-linux-config):
the same desktop, the same keys, installed with apt instead of pacman.

Verified on **Debian 13 (trixie)**, **Ubuntu 26.04.1 LTS** and **Kali Rolling**.
Other apt-based distributions are accepted when their `ID_LIKE` names one of those
families, but are untested.

Kali is Debian's archive one suite ahead, so it takes the Debian side of every
version decision: all five vendor repositories were checked against a
`kalilinux/kali-rolling` container, and `docker-ce` there resolves from
`linux/debian trixie` like any other Debian machine. Two package names differ, and
the map carries both as `kali` rows — `network-manager-applet` keeps its own name
there, and `gh` is in no Kali component, so the installer names it as missing
instead of failing the whole transaction on an unknown package. Two things to
expect: a stock Kali root is ext4, so `setup-snapshots.sh` will decline and explain
itself; and `setup-hardening.sh` installs **and starts** `openssh-server`, which
Kali ships deliberately disabled. Kali's OpenSSH is 10.5p1, which prints the
keywords of `sshd -T` in CamelCase where Debian 13's 9.9 lowercases them, so the
hardening script reads its effective configuration back case-insensitively — a
case-sensitive match would find nothing there and call that success.

[**KALI.md**](KALI.md) is the step-by-step run-book for a fresh Kali install: the
clone, the preview, every prompt in the order it arrives, the Zenbook CPU cap step,
and what to do when a step fails.

## Get started

```sh
git clone https://github.com/AhmedAnbar/debian-like-config.git ~/debian-desktop-setup
cd ~/debian-desktop-setup
bash install.sh --dry-run   # preview every command first
bash install.sh
```

Nothing is installed or replaced without a prompt, and every file it replaces is
backed up under `~/.local/state/debian-desktop-setup/`.

`install.sh` offers two of its steps as separate scripts, because each owns a package
group of its own and both are worth re-running on their own later:

```bash
bash setup-zsh.sh    # the bundled Zsh configuration, and Zsh as your login shell
bash setup-nvim.sh   # Neovim and its plugins, with the editor-tools group
```

## Package catalogue

Every package the installer can offer, generated from `packages/apt-map.tsv`. `Releases` says where the package exists: `both`, `debian`, `ubuntu`, `none` when apt has no such package, or `kali` for a row that replaces the Debian name on Kali alone.

| Package | Arch counterpart | Releases | Notes |
| --- | --- | --- | --- |
| `i3-wm` | `i3-wm` | both |  |
| `i3status` | `i3status` | both |  |
| `i3lock` | `i3lock` | both |  |
| `xserver-xorg` | `xorg-server` | both | Debian splits the X server metapackage under a different name |
| `xinit` | `xorg-xinit` | both | startx and xinitrc handling |
| `xinput` | `xorg-xinput` | both | Debian drops the xorg- prefix from the X utility packages |
| `x11-xkb-utils` | `xorg-setxkbmap` | both | setxkbmap ships inside x11-xkb-utils |
| `x11-xserver-utils` | `xorg-xrandr` | both | xrandr ships inside x11-xserver-utils |
| `xserver-xorg-input-libinput` | `xf86-input-libinput` | both | Debian names the X input drivers xserver-xorg-input-* |
| `kitty` | `kitty` | both |  |
| `rofi` | `rofi` | both | Debian 13 has 1.7.5 and Ubuntu 26.04 has 2.0.0; both read the bundled themes |
| `picom` | `picom` | both |  |
| `flameshot` | `flameshot` | both |  |
| `fonts-noto` | `noto-fonts` | both | Debian font packages are prefixed fonts- |
| `dex` | `dex` | both |  |
| `xss-lock` | `xss-lock` | both |  |
| `network-manager` | `networkmanager` | both | Debian spells the NetworkManager package with a hyphen |
| `network-manager-gnome` | `network-manager-applet` | both | nm-applet ships in network-manager-gnome |
| `network-manager-applet` | `network-manager-applet` | kali | kali-rolling offers no network-manager-gnome candidate; there the applet keeps its own name |
| `bluez` | `bluez` | both |  |
| `bluez` | `bluez-utils` | both | bluetoothctl ships in bluez itself; Debian has no separate utils package |
| `blueman` | `blueman` | both |  |
| `pulseaudio-utils` | `libpulse` | both | The volume keys need the pactl binary, which Debian ships here, not in libpulse0 |
| `psmisc` | `psmisc` | both |  |
| `gsettings-desktop-schemas` | `gsettings-desktop-schemas` | both | The schema the dark appearance setting writes to; the binary is in libglib2.0-bin |
| `libglib2.0-bin` | `glib2` | both | Debian ships the gsettings binary in the -bin package, apart from the library |
| `pipewire` | `pipewire` | both |  |
| `pipewire-alsa` | `pipewire-alsa` | both |  |
| `pipewire-jack` | `pipewire-jack` | both |  |
| `pipewire-pulse` | `pipewire-pulse` | both |  |
| `wireplumber` | `wireplumber` | both |  |
| `alsa-utils` | `alsa-utils` | both |  |
| `brightnessctl` | `brightnessctl` | both |  |
| — | `rofi-emoji` | none | Not packaged in Debian 13 or Ubuntu 26.04; config/i3/emoji.sh is a bundled picker reading unicode-data instead of a rofi plugin |
| `unicode-data` | — | both | Provides /usr/share/unicode/emoji/emoji-test.txt, the list the bundled emoji picker reads |
| `xdotool` | — | both | Types the chosen emoji into the focused X11 window; the Sway session uses wtype instead |
| `fonts-noto-color-emoji` | `noto-fonts-emoji` | both | Debian names the colour emoji font separately |
| `xclip` | `xclip` | both |  |
| `firefox-esr` | `firefox` | debian | Debian ships the ESR package and has no apt firefox |
| `firefox` | `firefox` | ubuntu | Ubuntu's apt firefox is the package that installs the Firefox snap; there is no firefox-esr |
| `snapd` | — | both | Ubuntu's browser is a snap; on Debian snapd installs nothing by itself and is groundwork for phase 3 |
| `thunar` | `thunar` | both |  |
| `thunar-archive-plugin` | `thunar-archive-plugin` | both |  |
| `file-roller` | `file-roller` | both |  |
| `gvfs` | `gvfs` | both |  |
| `gpicview` | `gpicview` | both |  |
| `xdg-user-dirs` | `xdg-user-dirs` | both |  |
| `xdg-utils` | `xdg-utils` | both |  |
| `retext` | `retext` | both |  |
| `build-essential` | `base-devel` | both | build-essential is the Debian equivalent metapackage |
| `git` | `git` | both |  |
| `gh` | `github-cli` | both | Debian and Ubuntu both package the GitHub CLI as gh |
| — | `github-cli` | kali | No Kali component carries gh; GitHub publishes its own apt repository for it |
| `vim` | `vim` | both |  |
| `neovim` | `neovim` | both | Debian 13 has 0.10.4 and Ubuntu 26.04 has 0.11.6; setup-nvim.sh installs the upstream tarball when apt is older than 0.11 |
| `dialog` | `dialog` | both |  |
| `php-cli` | `php` | both | The Debian php metapackage pulls Apache; php-cli is the command-line interpreter |
| `composer` | `composer` | both |  |
| `curl` | `curl` | both |  |
| `openssh-client` | `openssh` | both | A desktop needs the client; the server is not installed by default |
| `mkcert` | `mkcert` | both |  |
| `libnss3-tools` | `nss` | both | certutil, which mkcert needs, lives in libnss3-tools |
| `iputils-ping` | `inetutils` | both | Debian splits the inetutils tools; ping is the one this desktop uses |
| — | `uv` | none | Astral publishes no apt package; the official installer script is used in a later phase |
| `zsh` | `zsh` | both |  |
| `zsh-autosuggestions` | `zsh-autosuggestions` | both |  |
| `zsh-syntax-highlighting` | `zsh-syntax-highlighting` | both |  |
| `nodejs` | `nodejs` | both | Mason language servers need Node |
| `npm` | `npm` | both |  |
| `golang` | `go` | both | Debian names the Go toolchain golang |
| `ripgrep` | `ripgrep` | both |  |
| `fd-find` | `fd` | both | Debian installs the binary as fdfind; the Neovim configuration falls back to ripgrep |
| `unzip` | `unzip` | both |  |
| `lazygit` | `lazygit` | both |  |
| `fonts-jetbrains-mono` | `ttf-jetbrains-mono-nerd` | both | Debian packages the plain family; the Nerd Font patch is not packaged and is installed by hand if wanted |
| `sway` | `sway` | both | Debian 13 has 1.10.1 and Ubuntu 26.04 has 1.11 |
| `swaybg` | `swaybg` | both |  |
| `swayidle` | `swayidle` | both |  |
| `swaylock` | `swaylock` | both |  |
| `waybar` | `waybar` | both | Debian 13 has 0.12.0 and Ubuntu 26.04 has 0.15.0; every module this configuration uses predates 0.12 |
| `mako-notifier` | `mako` | both | Debian names the notification daemon package mako-notifier |
| `grim` | `grim` | both |  |
| `slurp` | `slurp` | both |  |
| `wl-clipboard` | `wl-clipboard` | both |  |
| `cliphist` | `cliphist` | both |  |
| `jq` | `jq` | both |  |
| `dbus` | `dbus` | both |  |
| `libnotify-bin` | `libnotify` | both | notify-send ships in the -bin package, not the library |
| `mate-polkit` | `polkit-gnome` | both | policykit-1-gnome was dropped from Debian 13; MATE's GTK agent is the equivalent and is packaged in both |
| `qtwayland5` | `qt5-wayland` | both | Debian keeps the Qt 5 Wayland platform plugin under its soname |
| `qt6-wayland` | `qt6-wayland` | both |  |
| `xdg-desktop-portal-wlr` | `xdg-desktop-portal-wlr` | both |  |
| `xdg-desktop-portal-gtk` | `xdg-desktop-portal-gtk` | both |  |
| `xwayland` | `xorg-xwayland` | both | Debian drops the xorg- prefix; rofi is X11-only on Debian's 1.7.5, so the session needs it |
| `wtype` | — | both | Types the chosen emoji into the focused Wayland window; no counterpart in the Arch package list |
| `chromium` | `chromium` | debian | Debian's stable-security build tracks upstream Chrome; Ubuntu 26.04 packages no chromium at all, so Chrome is its browser |
| — | `teams` | none | Microsoft retired the Linux client and its apt repository is empty; nothing is installed and the README names the web client instead |
| — | `google-chrome` | none | Chrome exists only in Google apt repository, on both releases; setup-chrome.sh adds it with consent |
| — | `dbeaver-ce` | none | Absent from both archives; setup-dbeaver.sh adds the vendor repository, which carries 26.2.2 for both releases |
| — | `onlyoffice-bin` | none | Not in Debian 13 or Ubuntu 26.04; setup-onlyoffice.sh adds the vendor repository, pinned, which carries 10.0.0 |
| — | `dropbox` | none | Neither archive resolves this name to a version (their 2019 frontend is nautilus-dropbox), so a numeric candidate proves the vendor repository answered; it carries 2026.09.28 |
| `python3-gpg` | — | both | Without it the Dropbox frontend announces it will not verify the proprietary daemon signature and skips the check |
| `docker.io` | `docker` | both | The apt fallback when the vendor repository cannot be reached; Debian ships no client inside it |
| `docker-cli` | — | debian | Debian docker.io only Recommends the client, so it must be named; Ubuntu bundles /usr/bin/docker in the package |
| `docker-compose` | `docker-compose` | debian | Debian has no docker-compose-v2; this package is Compose v2 and also provides /usr/bin/docker-compose |
| `docker-compose-v2` | `docker-compose` | ubuntu | Plugin only on Ubuntu, with no /usr/bin/docker-compose symlink of its own |
| `docker-buildx` | — | both | A Suggests rather than a dependency on both releases, so it must be named to be installed |
| — | `lazydocker` | none | Packaged on neither release; setup-docker.sh installs the upstream static binary into ~/.local/bin |
| — | `postman` | none | Postman publishes no apt package and no vendor repository; setup-postman.sh installs the official tarball into /opt |
| `libgtk-3-0t64` | — | both | One of eleven Electron runtime libraries; ldd on the bundled Postman binary reports 26 missing sonames without them |
| `libnss3` | — | both | Electron runtime library for the Postman tarball, proved missing by ldd on a bare install |
| `libasound2t64` | — | both | Electron runtime library for the Postman tarball; the 64-bit time_t transition renamed it |
| `libgbm1` | — | both | Electron runtime library for the Postman tarball, proved missing by ldd on a bare install |
| `libcups2t64` | — | both | Electron runtime library for the Postman tarball; the 64-bit time_t transition renamed it |
| `libatk-bridge2.0-0t64` | — | both | Electron accessibility bridge the Postman tarball links against; renamed by the time_t transition |
| `libxkbcommon0` | — | both | Electron runtime library for the Postman tarball, proved missing by ldd on a bare install |
| `libatspi2.0-0t64` | — | both | Electron accessibility library the Postman tarball links against; renamed by the time_t transition |
| `libxcomposite1` | — | both | X11 runtime library the Postman tarball links against, proved missing by ldd on a bare install |
| `libxdamage1` | — | both | X11 runtime library the Postman tarball links against, proved missing by ldd on a bare install |
| `libxrandr2` | — | both | X11 runtime library the Postman tarball links against, proved missing by ldd on a bare install |
| `desktop-file-utils` | — | both | Installs the Postman menu entry; its basename must stay Postman.desktop or postman:// links break |
| — | `torbrowser-launcher` | none | Packaged in Debian contrib and Ubuntu universe, but both ship a dead signing key and must reach torproject.org on first run; setup-tor-browser.sh installs the signed upstream tarball instead |
| `gnupg` | — | both | Verifies the Tor Browser tarball signature, which is done offline so the relay never has to be trusted |
| `xz-utils` | — | both | Unpacks the Tor Browser tarball, which ships as tar.xz |
| `conky-std` | `conky` | both | conky is a pure virtual package with no installation candidate; -std carries the Lua config, Xft and ARGB own-window the panel needs |
| `systemd-zram-generator` | `zram-generator` | both | Both releases prefix the package systemd-; the Arch name zram-generator does not exist in apt |
| `btrbk` | `btrbk` | both | 0.32.6 on both releases; ships only btrbk.conf.example, so this repository installs the configuration |
| `snapper` | `snapper` | both | Needs the configured path to be a btrfs subvolume, and adds an apt hook that snapshots around every later apt run |
| `btrfs-progs` | `btrfs-progs` | both | The subvolume tooling both snapshot routes call, and what findmnt checks for before either runs |
| `openssh-server` | — | both | sshd lives here, not in the openssh-client the dev group installs; installing it starts a listening service |
| `ruby` | `ruby` | both | colorls is a Ruby program and the interpreter is not installed by default |
| `ruby-dev` | — | both | The clocale gem in the dependency tree is a C extension and needs ruby.h |
| `build-essential` | — | both | ruby3.3-dev depends on libgmp-dev and libruby3.3 and brings no compiler of its own |

## Keyboard

| Keys | Action |
| --- | --- |
| Alt+Enter | Kitty terminal |
| Alt+D | Rofi launcher with the selected theme |
| Alt+Shift+Q | Close the focused window |
| Shift+Caps Lock | Toggle English (US) / Arabic |
| Alt+Shift+S | Select a region and save a screenshot |
| Super+period | Emoji picker (needs a self-built `rofi-emoji`; see the catalogue) |
| Alt+Shift+C or Alt+Shift+R | Reload the i3 configuration |
| Alt+Shift+E | Log out |

## Services

The installer offers to enable `NetworkManager.service`, `bluetooth.service` and
`fstrim.timer`, plus the user PipeWire sockets and WirePlumber. Nothing is
enabled without a prompt.

No login manager is part of this phase: keep the one your installation already
has, or start the session with `startx` using the bundled `xinit`.

## The Sway session

Phase 2 adds an optional Wayland session. The i3 desktop stays installed and
unchanged; the two live side by side and the greeter's session menu chooses
between them.

```bash
bash setup-sway.sh          # or --dry-run to see every step first
```

It installs the `sway` package group, the Sway, Waybar, mako, swaylock and
portal configuration, and a screen profile. It also offers the programs the
session invokes that `install.sh` would otherwise have installed — the terminal,
rofi and its themes, `pactl`, `brightnessctl`, the fonts, the emoji list, the
tray applets and the browser — so it works on a machine where `install.sh` never
ran, and installs no Xorg and no i3 to do it. Every step asks first, and every
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
and a notification says so. The i3 session uses the same script.

**What has not been confirmed.** The tests in this repository validate the Sway
configuration with `sway -C`, check that Waybar 0.12.0 and 0.15.0 both load
`config.jsonc`, and resolve every package name in both releases. They cannot
show that the session renders, that the touchscreen mapping works, or that the
fonts look right: those are confirmed on the machine, and this README will say
so when they have been.

## Third-party applications

Six applications that neither release packages properly, each its own script, each
asked about at the end of `install.sh` and declined by default. Five of them add a
vendor apt repository; Postman is a tarball into `/opt`, because Postman is published
no other way. The five repositories are all added the same way: the signing key is fetched **before** any
sources file is written, the repository gets its own `apt-get update`, and the
verdict is both that the update succeeded and that `apt-cache policy` then offers the
package **from that vendor's own host**. Neither test alone is enough: `apt-get update`
exits 0 when a vendor host is unreachable, and apt reports a candidate for any already
installed package straight out of `/var/lib/dpkg/status` — so on a second run a bare
candidate check would pass no matter what happened. A repository that cannot be verified
is removed again, key and pin included, so a vendor outage leaves the machine exactly as
it was.

```bash
bash setup-chrome.sh        # google-chrome-stable, from dl.google.com
bash setup-dbeaver.sh       # dbeaver-ce, from dbeaver.io's flat repository
bash setup-onlyoffice.sh    # onlyoffice-desktopeditors, a 279 MB download
bash setup-dropbox.sh       # the Dropbox frontend, from linux.dropbox.com
bash setup-docker.sh        # Docker Engine, compose, the docker group, lazydocker
bash setup-postman.sh       # Postman, from the vendor tarball, into /opt (no repository)
```

Each takes `--dry-run`, which shows every step and writes nothing.

What is worth knowing before you run them:

- **Chrome** does not replace Chromium. On Debian `install.sh` already installed
  `chromium` with the browser group; on Ubuntu there is no `chromium` package at
  all, only a snap stub. Chrome's own postinst re-creates its sources file and an
  `/etc/cron.daily/google-chrome` that puts it back if you delete it by hand.
- **Dropbox** installs a 62 KB frontend. The sync client is a proprietary daemon of
  about 91 MB that Dropbox fetches outside apt, into your home directory, the first
  time you start it: run `dropbox start -i` once from a desktop session afterwards.
  The script never downloads or starts it, because with stdin closed that command
  dies with `EOFError` and still exits 0 — a failure nothing could detect.
- **Docker** adds you to the `docker` group, and that is
  **root-equivalent**: any member can start a container that mounts the whole
  filesystem as root. It takes effect at your next login, not in the shell that ran
  the script. If `docker.io` is already installed, the vendor route is skipped
  rather than forced, because `docker-ce` declares `Conflicts: docker.io`.
- **Postman** publishes **no checksum and no signature** — every `.sha256` and
  `SHASUMS` path returns 400. The only integrity gate available is that the
  downloaded archive lists cleanly and contains `Postman/app/postman`, which is
  checked before anything under `/opt` is touched. Accept that or skip the script.
- **Teams is not installed.** Microsoft's own `packages.microsoft.com/repos/ms-teams`
  is deliberately empty: a 0-byte `Packages` index, a `Release` file from
  2023-02-28, and a pool that 404s. The unofficial `teams-for-linux` exists but is
  not Microsoft's. Use <https://teams.microsoft.com> in a browser, which is what
  Microsoft supports on Linux.

## System extras

Eight scripts for the system and the shell rather than applications. The same rules
apply: every step asks, declines by default, and `--dry-run` previews.

```bash
bash setup-tor-browser.sh   # from a signed tarball you stage yourself
bash setup-conky.sh         # the system panel, for both i3 and Sway
bash setup-herdr.sh         # Herdr, the terminal multiplexer, from its own installer
bash setup-colorls.sh       # ls with colours and icons, from the user gem path
bash setup-zram.sh          # zram swap through systemd-zram-generator
bash setup-snapshots.sh     # btrbk on a timer, snapper separately
bash setup-hardening.sh     # SSH, last and loudest
bash setup-zenbook-cpu-cap.sh   # ASUS Zenbook S 16 (UM5606) only: unclamp the CPU
```

The last one is the only hardware-specific script in this repository, and `install.sh`
offers it only when the DMI product name matches `*UM5606*`. The rest are offered
everywhere.

- **Tor Browser** is never downloaded here: `dist.torproject.org` is unreachable
  from this machine, so the tarball and its `.asc` are staged from somewhere that
  can reach it. The script names exactly one ssh alias, `vps`, and nothing else —
  no host, user, port or address appears anywhere in this repository. Write the
  block yourself before using it, and check that `ssh vps true` works:

  ```
  Host vps
      HostName <your machine>
      User <your login>
      Port <your ssh port>
      IdentityFile ~/.ssh/<your key>
  ```

  `--from-dir <dir>` verifies and installs files you already have, with no network
  at any point. Either way the signature is checked against
  `EF6E286DDA85EA2A4BA7DE684E2C6E8793298290` before anything is unpacked, and a
  failed signature stops that step instead of falling through to extraction.
  `torbrowser-launcher` is deliberately not used: Debian's bundled key expired on
  2025-07-21, Ubuntu's signing subkey expires on 2026-10-26, and it cannot be fed
  from disk.
- **conky** installs the panel for both sessions. `Alt+Shift+T` picks a theme or
  turns it off. The i3 autostart is part of `config/i3/config`, and the Sway
  fragment is installed as `~/.config/sway/config.d/30-conky.conf`. The panel is a
  no-op until conky itself is installed, which is why the autostart is harmless on
  a machine that never ran this script.
- **zram** only ever raises a cap: `systemd-zram-generator` already ships an active
  default of `min(ram / 2, 4096)` MB, so the script writes
  `/etc/systemd/zram-generator.conf` with `zram-size` set to `min(ram / 2, 8192)`
  **worked out now, as a plain number**: an expression the generator cannot parse makes
  it exit 1 and leaves the machine with no zram at all, so the figure is frozen at the
  amount of RAM this machine has when you run it.
  When half this machine's RAM is already under the shipped cap it writes nothing
  and says so, rather than restating the default and calling it a change.
- **Snapshots need a btrfs root.** `findmnt -no FSTYPE /` runs before anything else,
  and anything that is not btrfs — including an absent or silent `findmnt` — stops
  the script with an explanation instead of configuring a tool that cannot work.
  The same question is asked again of the volume directory itself
  (`/mnt/btrfs-root` by default): an empty placeholder with nothing mounted on it is
  a plain directory that `btrfs subvolume create` would succeed inside, snapshotting
  the wrong place, so the snapshot subvolume is left uncreated and the command to run
  once it is mounted is printed instead.
  btrbk is the default; snapper is a separate, louder opt-in because its
  `/etc/apt/apt.conf.d/80snapper` takes a snapshot around **every** apt run.
  `timeshift` is not offered: it refuses any layout but Ubuntu's `@` and `@home`.
- **SSH hardening** is the only script here that changes how you can log in to this
  machine, which is why `install.sh` offers it last. It stages the drop-in,
  validates it with `sshd -t` before installing it, and **refuses to set
  `PasswordAuthentication no` until you have confirmed that a key login actually
  worked** — it asks you to try one in another terminal first. Nothing is
  restarted without being asked.

## Backups and undo

Every replaced file is copied to `~/.local/state/debian-desktop-setup/<timestamp>-<pid>/`
with its path preserved, so restoring one is a `cp` back.

## What comes later

All four phases are here: the i3 desktop and the shell, the Sway session, the
third-party applications, and the system extras. Each has its design document
under `docs/superpowers/specs/`, and the evidence behind every package name,
repository URL, suite and version is in
`docs/superpowers/specs/2026-10-15-phase-3-4-recon.md`.

What a container cannot prove is what is left, and none of it is code:

- No application here has been **started**. The container tests prove that the
  right packages resolve, that the repositories verify, and that nothing is
  written outside a scratch directory — not that Chrome renders, that ONLYOFFICE
  shapes Arabic, or that the Dropbox daemon links an account.
- zram, the snapshot timers and the SSH restart need a **reboot or a new session**
  to show. `systemd-zram-generator` refuses to run in a container at all
  ("Running in a container, exiting").

- **Herdr** is installed from `herdr.dev` into `~/.local/bin` as your normal user,
  behind two review gates: one before the installer is downloaded, one after it has
  been syntax-checked and its SHA-256 printed. Upstream publishes no apt repository,
  no `.deb` and no signature over either, and the checksum the installer verifies
  comes from the same host that serves the installer — so that is a transport check,
  not an independent one, and both prompts are worth answering. Nothing runs as root.
  An existing `herdr` binary is left exactly as it is; only the two configuration
  steps are offered, which is the reason to run the script again. Those steps write
  only the keys they manage into `~/.config/herdr/config.toml`, keeping a copy of
  whatever they replaced beside it:

  ```toml
  [keys]
  prefix = "ctrl+a"
  switch_workspace = "prefix+shift+1..9"

  [ui]
  sidebar_start_collapsed = true
  sidebar_collapsed_mode = "hidden"
  tab_bar_right = [{ type = "command", command = "/home/you/.config/herdr/workspaces-status.sh", interval_seconds = 1, timeout_seconds = 2 }]
  ```

  That `command` path is absolute on purpose, with `/home/you` standing in for your own
  home directory: herdr does not expand `~` inside a TOML string, and a `~`-relative
  path there produces an empty tab row and no error at all. Workspaces take the shifted
  digits because `prefix+1..9` already switches tabs. The tab row prints nothing until a
  herdr server exists — `herdr workspace list` exits 1 with `server_not_running` before
  the first client starts — and that is what first launch looks like, not a failure.
- **colorls** is in no Debian-family archive: `apt-get install -s ruby-colorls` answers
  `E: Unable to locate package ruby-colorls` on Debian 13, Ubuntu 26.04 and Kali Rolling
  alike. apt supplies only `ruby`, `ruby-dev` and `build-essential`, which the `clocale`
  C extension in its dependency tree needs to build, and the gem itself goes into
  `~/.local/share/gem` with `gem install --user-install`. The aliases live in
  `~/.config/shell/colorls.sh` — that literal path, not `$XDG_CONFIG_HOME`, because
  `zsh/zshrc` and `install.sh` both name it literally — and one guarded line in
  `~/.bashrc` and `~/.zshrc` sources it, appended once and backed up first. The Arch
  repository's `unicode-display_width` 2.x pin is deliberately not carried over: the
  resolver chose 2.6.0 by itself in all three containers. Icons need a patched font,
  which no archive carries, so they are substitution boxes until you install a Nerd
  Font by hand.
- **The Zenbook CPU cap** is one `modprobe.d` file blacklisting `amd_pmf`, `amdxdna`
  and `asus_armoury`, which the UM5606 firmware answers by pinning every core to
  605 MHz and about 5 W. The script refuses on any other model unless you pass
  `--force`. Every figure it prints was measured on the Arch install of that laptop and
  says so: no Debian-family install of it exists yet, so nothing here re-measured them.
  The clamp has a second, identical-looking cause — a stuck embedded controller — and
  the script tells you how to tell the two apart with `systemd-analyze` before it asks
  for anything, because no blacklist can help the second one. The initramfs rebuild it
  offers afterwards is housekeeping rather than the fix: four images built in containers
  were searched for those three module names and held none of them, so declining the
  rebuild still leaves the fix in place. It detects `initramfs-tools` and `dracut` by
  asking `update-initramfs --version` which one it is, the same test Debian's own kernel
  hooks use, and rebuilds every installed kernel rather than only the running one.
- Every version in this README is a snapshot taken on 2026-10-15, except the three
  scripts above, measured on 2026-10-16.

Five test files do reach the real world, and they are the ones to run before trusting a
vendor route again. All need Docker and are off by default:

```bash
DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/vendor-container-smoke.js   # the five repositories, live
DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/extras-container-smoke.js   # the system facts phase 4 relies on
DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/apt-names-smoke.js          # every name in the map resolves
DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/sway-container-smoke.js     # sway and waybar parse the config
DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/setup-herdr-smoke.js        # the herdr awk edits, under mawk
```

The last one is unlike the other four: it runs its whole fast suite either way and
adds one scenario when the variable is set. All three target distributions resolve
`awk` to `/usr/bin/mawk`, while the machine this port was written on has gawk, so the
two awk programs that edit `config.toml` are proved against the real mawk rather than
argued about.

`vendor-container-smoke` runs the real `add_vendor_repo` against the real hosts in both
releases, reading each key URL out of the script that uses it, and checks that the
ONLYOFFICE pin still keeps the distribution's `ttf-mscorefonts-installer`.
`extras-container-smoke` confirms the system facts behind phase 4: that the zram package
ships no options of its own, that a lower-numbered `sshd_config.d` drop-in really does
beat `99-hardening.conf`, and that the Tor signing key still has the fingerprint
`setup-tor-browser.sh` hard-codes.
