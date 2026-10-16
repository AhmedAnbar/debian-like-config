# Running this on Kali Linux

A step-by-step run-book for a fresh Kali Rolling install, including the one step that is
specific to the ASUS Zenbook S 16 (UM5606).

Kali is supported as a first-class target alongside Debian 13 and Ubuntu 26.04: it is
Debian's archive one suite ahead, so `release` stays `debian` — every version decision,
vendor suite and repository path is Debian's — while `variant` is `kali` and selects the
two package names Kali renames or drops. All five vendor repositories, every apt name in
the map, and the phase 4 system facts were verified in `kalilinux/kali-rolling`.

**What has not been done:** this has not been run on real hardware, on any distribution.
Every claim here comes from containers and from stub-driven tests. That is exactly why
step 3 is a preview and not an install.

## Before you start

- Run everything as **your normal user** — the one the Kali installer created, usually
  `kali`. Every script refuses to run as root or under `sudo` and exits 1; the privileged
  commands call `sudo` themselves, one at a time, and each is printed before it runs.
- Nothing is installed or replaced without a prompt. Every prompt **declines by default**:
  pressing Enter means no. Declining costs nothing — the closing summary names the command
  that runs each thing you said no to.
- Every file that gets replaced is copied first to
  `~/.local/state/debian-desktop-setup/<timestamp>-<pid>/`.
- A stock Kali root is **ext4**, so the snapshot step will decline itself. That is correct
  behaviour, not a failure. See the table below.

## 1. Clone

```bash
sudo apt-get update
sudo apt-get install -y git          # Kali usually has it already

git clone https://github.com/AhmedAnbar/debian-like-config.git ~/debian-desktop-setup
cd ~/debian-desktop-setup
```

## 2. Preview first

```bash
bash install.sh --dry-run
```

This prints every command it would run, every file it would write, and every package it
would install — and writes nothing at all. Read it before step 3. Answering `y` to
everything here is safe and is the most useful way to see the whole run.

## 3. Install

```bash
bash install.sh
```

The prompts come in this order. None of them is a point of no return.

1. **Six package groups**, each printing its name and the exact apt names it would
   install, then `Include these packages?`:
   core i3 desktop, PipeWire audio, brightness keys and emoji fonts, browser and file
   utilities, development utilities, Zsh and its plugins.
2. `Installed by their own scripts, not here: …` — a list of the groups other scripts own
   (Sway, Neovim, each third-party application, conky, zram, snapshots, hardening,
   colorls). Nothing to answer; the summary names each command.
3. `Not packaged on Kali: github-cli (…)` — expected, see the table below.
4. `Selected packages: …` then
   `Update the package lists and install the selected packages?`
   This is the one step that stops the run if it fails: installing against a stale index
   is worse than stopping.
5. `Install the desktop configuration bundle …?` — i3, kitty, rofi, picom, fontconfig,
   GTK, the shell snippets. Each existing file that differs asks before replacement.
   The Sway, Waybar, mako, swaylock, portal and herdr trees are deliberately **not**
   installed here: they belong to the scripts that own them.
6. `Choose the Rofi theme …?` — Catppuccin, Nord or Dracula.
7. `Open Markdown (.md) files rendered in ReText preview by default?`
8. `Set the dark appearance preference in your current desktop session?`
9. `Create and trust the mkcert local CA for HTTPS development?`
10. `Enable and start …?` for `NetworkManager.service`, `bluetooth.service`,
    `fstrim.timer` and `snapd.socket`, one at a time. On Kali nothing this project
    installs is a snap, so `snapd.socket` stays idle; it is safe to decline.
11. `Start and enable the PipeWire sockets and WirePlumber for this user?`
12. `Set up Zsh, Oh My Zsh, autosuggestions and syntax highlighting?`
13. `Restore Neovim and its plugins?`
14. **The optional scripts**, each its own prompt, in this order: Chrome, DBeaver,
    ONLYOFFICE, Dropbox, Docker, Postman, Tor Browser, conky, Herdr, colorls, zram,
    snapshots, SSH hardening — and, on a UM5606 only, the CPU cap (step 5).

Hardening is deliberately last, because it is the only step that can lock you out of this
machine.

## 4. The Sway session

`install.sh` does not install Sway. Run it separately when you want the Wayland session:

```bash
bash setup-sway.sh
```

It detects the UM5606 and offers the bundled screen profile
(`output eDP-1 mode 1920x1200`, scaled), or sets nothing on unknown hardware.

## 5. The Zenbook CPU cap — this laptop only

On a UM5606 the firmware answers `amd_pmf`, `amdxdna` and `asus_armoury` by pinning every
core to about 605 MHz and 5 W. `install.sh` offers this script only when
`/sys/class/dmi/id/product_name` matches `*UM5606*`; it can also be run on its own:

```bash
bash setup-zenbook-cpu-cap.sh --dry-run
bash setup-zenbook-cpu-cap.sh
sudo reboot
```

It writes one file, `/etc/modprobe.d/zenbook-um5606-cpu-cap.conf`, and offers to rebuild
the initramfs afterwards. That rebuild is housekeeping rather than the fix — four
initramfs images built in containers were searched for those three module names and held
none of them — so declining it still leaves the fix in force. `--remove` undoes it.

Every figure the script prints was measured on the **Arch** install of this laptop and
says so; no Debian-family install of it existed when this was written.

## 6. Verify, after the reboot

```bash
time (head -c 256M /dev/zero | sha256sum)          # well under 1s; about 4.5s if clamped
lsmod | grep -E 'amd_pmf|amdxdna|asus_armoury'     # expect no output
```

If it is still slow, run `systemd-analyze` **before changing anything**. The clamp has a
second cause that looks identical from `/proc/cpuinfo`: a stuck embedded controller, which
is already in effect before Linux loads any driver and which no blacklist can fix. The
firmware and loader phases are the fingerprint — healthy on this machine is roughly 6s
firmware and 3-6s loader; a clamped boot showed 22.4s and 47.3s. That case needs a hard
EC reset (shut down, unplug USB-C, hold the power button about 40s, reconnect, boot), not
a configuration change.

## What Kali does differently

| What you will see | Why, and what to do |
| --- | --- |
| `Not packaged on Kali: github-cli` | No Kali component carries `gh`. It is reported rather than attempted, because one unknown name would otherwise abort the whole `apt-get install`. GitHub publishes its own apt repository if you want it. |
| `network-manager-applet` instead of `network-manager-gnome` | `kali-rolling` offers no `network-manager-gnome` candidate; there the applet keeps its own name. Handled by a map row, nothing to do. |
| The snapshot step declines itself | A stock Kali root is ext4. `findmnt -no FSTYPE /` is the first thing it runs, and anything but btrfs skips with a reason. Converting a root filesystem to btrfs is a reinstall, not a step in a script. |
| SSH hardening installs **and starts** `openssh-server` | Kali ships sshd deliberately disabled. Accepting hardening gives you a listening service. Decline it if you do not want one — or accept it and read the next row. |
| Hardening prints CamelCase settings | Kali's OpenSSH is 10.5p1, which prints `sshd -T` keywords as `PasswordAuthentication`, where Debian 13's 9.9 lowercases them. The read-back is case-insensitive for exactly this reason. |
| Docker reports a version you did not expect | `kali-rolling` carries `docker.io` 28.5.2 where Debian 13 has 26.1.5, so the script reads the real candidate from apt rather than printing Debian's figure. |
| Tor Browser cannot download anything | `dist.torproject.org` is unreachable from this network. Write your own `Host vps` block in `~/.ssh/config` and check `ssh vps true` first, or decline and install later with `--from-dir`. The repository names one ssh alias and nothing else. |

**Before you log out after hardening:** open a second terminal and log in with your key.
`sshd -t` checks the file, not your access, and nothing in the script opens a connection to
find out. The session you ran it from is the one place a mistake can still be undone.

## Running single pieces later

Every script is independent, takes `--dry-run`, and is safe to re-run — re-running is the
update path:

```bash
bash setup-herdr.sh          # Herdr, from its own upstream installer, behind two gates
bash setup-colorls.sh        # ls with colours and icons, from the user gem path
bash setup-conky.sh          # the system panel, for both i3 and Sway
bash setup-zram.sh           # zram swap through systemd-zram-generator
bash setup-hardening.sh      # SSH, last and loudest
bash setup-tor-browser.sh --from-dir ~/staged   # install from files you already have
```

## If a step fails

`install.sh` does not stop at the first failure — the steps are independent, and a vendor
host that is down today must not take the rest of the run with it. It collects what went
wrong and names every one of them in the closing summary, with the command to retry each.

- Read the summary. It lists failed steps, declined steps and where the backups went.
- Re-run just the one script that failed; nothing is lost by running it again.
- `--dry-run` on that script shows what it was trying to do.
- To undo a configuration change, the replaced file is under
  `~/.local/state/debian-desktop-setup/`.

If a step fails in a way the summary does not explain, the whole summary is the useful
thing to keep: it names the distribution, the release it detected and every command it ran.
