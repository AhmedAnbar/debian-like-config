<p align="center">
  <img src="assets/logo.png" alt="Debian Linux Config — tiled panel logo in Debian red" width="240">
</p>

<h1 align="center">Debian Linux Config</h1>

<p align="center">An interactive installer for a Catppuccin-inspired i3 desktop on Debian and Ubuntu.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-b4befe" alt="License: GPL-3.0"></a>
  <img src="https://img.shields.io/badge/OS-Debian_13-A80030?logo=debian&amp;logoColor=white" alt="Debian 13">
  <img src="https://img.shields.io/badge/OS-Ubuntu_26.04-E95420?logo=ubuntu&amp;logoColor=white" alt="Ubuntu 26.04">
  <img src="https://img.shields.io/badge/Desktop-i3-313244?logo=i3&amp;logoColor=white" alt="i3 desktop">
  <img src="https://img.shields.io/badge/Shell-Zsh-a6e3a1?logo=zsh&amp;logoColor=313244" alt="Zsh">
</p>

This is the Debian-family sibling of [arch-desktop-setup](https://github.com/AhmedAnbar/arch-linux-config):
the same desktop, the same keys, installed with apt instead of pacman.

Verified on **Debian 13 (trixie)** and **Ubuntu 26.04.1 LTS**. Other apt-based
distributions are accepted when their `ID_LIKE` names one of those families, but
are untested.

## Get started

```sh
git clone https://github.com/AhmedAnbar/debian-linux-config.git ~/debian-desktop-setup
cd ~/debian-desktop-setup
bash install.sh --dry-run   # preview every command first
bash install.sh
```

Nothing is installed or replaced without a prompt, and every file it replaces is
backed up under `~/.local/state/debian-desktop-setup/`.

## Package catalogue

## Backups and undo

Every replaced file is copied to `~/.local/state/debian-desktop-setup/<timestamp>-<pid>/`
with its path preserved, so restoring one is a `cp` back.

## What comes later

Phase 1 covers the i3 desktop, the shell and the editor. Still to come, each
with its own design document under `docs/superpowers/specs/`:

1. The Sway/Wayland session, including the Waybar version guard Debian needs.
2. Third-party applications: Chrome, DBeaver, Teams, Dropbox, OnlyOffice,
   Postman, and Tor Browser fetched through a VPS.
3. System extras: Docker, SSH hardening, conky, zram and snapshots.
