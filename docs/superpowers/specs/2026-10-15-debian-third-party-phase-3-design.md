# Phase 3: third-party applications and vendor apt repositories

Date: 2026-10-15
Status: approved design, pending plan
Evidence: `docs/superpowers/specs/2026-10-15-phase-3-4-recon.md` — every route
named here was proved by running a command in `debian:stable-slim` (Debian 13
trixie) or `ubuntu:latest` (Ubuntu 26.04.1), amd64. Versions are a 2026-10-15
snapshot and are dated wherever they are quoted.

## Purpose

Phases 1 and 2 install everything the two distributions package themselves. The
applications Ahmed actually works in — a browser, a database client, an office
suite, a file sync client, Docker — are not in those archives, or are in them in
a form too old to use. Phase 3 adds them, and adds the one mechanism they share:
a vendor apt repository, added with consent, verified before it is trusted, and
removed again when it cannot be.

The phase ships even if any one vendor host is down on the day: every step is
independently declinable and independently recoverable.

## Targets

Debian 13 (trixie) and Ubuntu 26.04 LTS, amd64, on the ASUS Zenbook S 16
UM5606WA or any machine phases 1 and 2 already serve. No change to the i3 or
Sway sessions.

## Scope

In: the two shared helpers, the installer's group ownership, the `chromium` map
row, and five scripts — Chrome, DBeaver, ONLYOFFICE, Dropbox, Docker (with
lazydocker). Teams is explicitly *not* installed, and that decision is
documented rather than silent.

Out, and deferred to phase 4: Postman and Tor Browser (both are `/opt` tarballs,
a different mechanism, and Tor needs the `vps` relay), the Nerd Font, the conky
panel, zram, btrfs snapshots and SSH hardening.

## The decisions taken

Recorded here because the evidence did not settle them; Ahmed did, on 2026-10-15.

1. **Per application, the evidence chooses the route**: a vendor apt repository
   where one exists, a snap only where no repository does, a tarball last. Every
   choice carries its reason in the map note or the script's header comment.
2. **Ubuntu gets Chrome and no Chromium.** Debian 13 packages a real
   `chromium` — 155.0.8059.79 from stable-security, the same upstream build
   number as Chrome on the same day, with a full GTK/NSS dependency set. Ubuntu
   26.04 packages none at all (`Candidate: (none)`); its `chromium-browser` is a
   104 KB debconf stub that pre-depends on snapd. Rather than install a snap
   under a familiar name, Ubuntu's browser row is Chrome, from Google's
   repository, and there is no `chromium` row for Ubuntu.
3. **Teams is not installed.** Microsoft retired the Linux client: its
   repository (`packages.microsoft.com/repos/ms-teams`) still verifies and is
   deliberately empty — a 0-byte `Packages` with the empty-string SHA256, a
   `Release` dated 2023-02-28, a 404 pool. The only working desktop route is
   `teams-for-linux` 2.24.0 from one maintainer's host, signed by a personal key
   with a hotmail uid, and a wrapper a tenant may not sanction. The map carries a
   pointer row saying so and the README names the web client instead.
4. **Dropbox is installed from the vendor repository, with its first run left to
   a human.** The archive packages are the 2019 frontend; the repository carries
   2026.09.28. `python3-gpg` is installed alongside, because without it the
   frontend announces that it will not verify the proprietary daemon's signature
   and skips the check. The installer never fetches the 91 MB daemon: with stdin
   closed, `dropbox start -i` prints its prompt, dies on `EOFError`, and a bare
   `except` swallows it so the process still exits 0 — an undetectable failure.
   The closing summary tells the user to run it once from a desktop session.
5. **Docker grants access through the `docker` group**, as the Arch machine does,
   and the prompt says plainly that membership is root-equivalent and needs a
   new login. Rootless is not offered in the same run: they are alternatives, and
   offering both invites a machine configured half each way.

## The map keeps five columns

`packages/apt-map.tsv` is an index of apt names the release's own archive can
resolve. `where` is read by a `case` over `none|both|<release>`, and every
non-`none` row is handed to one `apt-get install -y` where a single unknown name
fails the whole transaction. A row spelling `google-chrome-stable`, `dbeaver-ce`
or `onlyoffice-desktopeditors` would therefore not fail by itself — it would take
its entire group down on a clean machine. Growing `where` to a `vendor` value
would make the map describe a key, a URL, a suite, a pin and an update, and turn
`map_group_packages` from a lookup into an installer.

So the schema does not change. The map grows two kinds of row, both of which it
already has shapes for:

**Installable rows**, resolvable by the release's own archive:

```
browser-files	chromium	chromium	debian	Debian's stable-security build tracks upstream Chrome; Ubuntu 26.04 packages no chromium at all, so Chrome is its browser
files	-	python3-gpg	both	Without it the Dropbox frontend announces it will not verify the proprietary daemon's signature and skips the check
docker	docker	docker.io	both	The apt fallback when the vendor repository cannot be reached; Debian ships no client in it
docker	-	docker-cli	debian	Debian's docker.io only Recommends the client, so it must be named; Ubuntu bundles /usr/bin/docker
docker	docker-compose	docker-compose	debian	Debian has no docker-compose-v2; this package is Compose v2 and also provides /usr/bin/docker-compose
docker	docker-compose	docker-compose-v2	ubuntu	Plugin only, with no /usr/bin/docker-compose symlink
docker	-	docker-buildx	both	A Suggests on both releases, so it must be named
```

**Pointer rows** with `where=none`, whose note names the script that does the
work — the shape the map already uses for `rofi-emoji` and `uv`, and which
`install.sh` prints under "Not packaged":

```
browser-files	google-chrome	-	none	Chrome exists only in Google's apt repository, on both releases; setup-chrome.sh adds it with consent
dev	dbeaver-ce	-	none	Absent from both archives; setup-dbeaver.sh adds the vendor repository, which carries 26.2.2 for both releases
office	onlyoffice-bin	-	none	Not in Debian 13 or Ubuntu 26.04; setup-onlyoffice.sh adds the vendor repository, pinned, which carries 10.0.0-169
files	dropbox	-	none	The archive packages are the 2019 frontend; setup-dropbox.sh adds the vendor repository, which carries 2026.09.28
chat	teams	-	none	Microsoft retired the Linux client and its apt repository is empty; the README names the web client, and nothing is installed
docker	lazydocker	-	none	Packaged on neither release; setup-docker.sh installs the upstream static binary into ~/.local/bin
```

`tests/apt-map-smoke.js` needs no structural change: the `chromium` row is a
single-release row like `firefox-esr`, and the pointer rows obey the existing
`where=none` rule. Its `groups` allow-list and its `owners` map gain the new
group names. `readme-smoke.js` fails until every installable name is in the
catalogue and every `none` row prints `| — |` in the apt column.

## Two new helpers in lib/common.sh

### add_vendor_repo

Five scripts need the same sequence, and copying it five times would recreate
exactly the defect the phase 1 review found.

```
# Usage: add_vendor_repo <id> <key url> <sources line> [pin file]
```

Contract, in this order, because the order is the safety property:

1. `install -d -m 0755 /etc/apt/keyrings`.
2. Fetch the key to a temporary file and dearmor it. **Only then** write
   `/etc/apt/sources.list.d/<id>.list`. A sources file without its key is the
   one failure here that damages a working system: it makes every later
   `apt-get update` fail, including the installer's own fatal one.
3. Its own `apt-get update`. Never the shared one.
4. **Verify by candidate, not by exit status.** `apt-get update` exits 0 when a
   vendor host is unreachable — it prints `W: Failed to fetch` and "old ones used
   instead". Success is `apt-cache policy <package>` reporting a numeric
   candidate.
5. On any failure, remove the sources file and the keyring again, record the
   step in `failed[]`, and return non-zero. The next shared update is then clean.

It takes both line shapes observed: a suite-and-components line (Google, Docker,
Dropbox, ONLYOFFICE) and DBeaver's flat `https://dbeaver.io/debs/dbeaver-ce /`
with the trailing slash, because `dbeaver.io/debs/dbeaver-ce/dists/` is a 404.
The optional pin writes `/etc/apt/preferences.d/<id>` before the install.

### try

`attempt` records a failure and returns 0 unconditionally, by design, so a run
continues. There is today no way to record a failure *and* branch on it, and
four steps in this phase need that branch: the key fetch before the sources
write, the candidate check after a vendor update, the Docker vendor route before
falling back to apt, and Dropbox's key before anything else. `try` records the
failure in `failed[]` exactly as `attempt` does, and returns the command's
status.

## The installer's two changes

**Group ownership becomes a table, not a filter.** `install.sh` enumerates
groups with `awk … $1 != "editor-tools" && $1 != "sway"`. Phase 3 adds
`docker`, `office`, `chat` and `files` rows belonging to other scripts, and
phase 4 adds more. `group_label` already names the six groups `install.sh` owns;
that table becomes the source of truth and the enumeration iterates its keys.
One change, and no exclusion list to maintain again.

**The shared update says why it stopped.** `run sudo apt-get update` is
deliberately fatal — installing against a stale index is worse than stopping.
That stays. But once any vendor sources file exists, a Google or Docker outage
can abort a previously working installer, so the failure path first names the
third-party sources files this repository added and says that removing one
restores the run. Same outcome, plus the one fact the user needs.

## The scripts

`install.sh` offers each of them at the end of its run, in its existing
delegation idiom — `attempt bash "$bundle_dir/setup-<subject>.sh"`, with
`--dry-run` passed through — so a user who only ever runs `install.sh` is asked
about every application, and declining costs nothing.

Each is `bash setup-<subject>.sh [--dry-run]`, sources `lib/common.sh`, calls
`require_normal_user`, `require_apt_get` and `detect_release`, asks before every
step, prints `summary_prologue`, and **exits non-zero when `failed[]` is not
empty** — `install.sh` reaches each through `attempt bash setup-x.sh`, and
without that exit the whole subject collapses to one unexplained line.

| Script | Route proved | Version | What it also does |
| --- | --- | --- | --- |
| `setup-chrome.sh` | `dl.google.com/linux/chrome/deb stable main`, both releases | `google-chrome-stable` 155.0.8059.79-1 | Tolerates Chrome's own postinst re-creating the repository and its `/etc/cron.daily/google-chrome`. It does **not** offer Chromium: on Debian `install.sh` already installed it with the `browser-files` group, and the script says so before asking, so Chrome is understood as an addition rather than the only browser |
| `setup-dbeaver.sh` | `https://dbeaver.io/debs/dbeaver-ce /` (flat), both | `dbeaver-ce` 26.2.2 | Nothing. The .deb declares no `Depends` at all, so GTK 3 comes from the desktop groups; the script says a bare server would fail at first launch |
| `setup-onlyoffice.sh` | `download.onlyoffice.com/repo/debian squeeze main`, both | `onlyoffice-desktopeditors` 10.0.0-169 | Writes `/etc/apt/preferences.d/onlyoffice` **before** installing: the repository carries 308 stanzas over 71 names, and its `ttf-mscorefonts-installer` 3.8.2 outranks Debian contrib's 3.8.1 and Ubuntu multiverse's 3.8.1ubuntu2 |
| `setup-dropbox.sh` | `linux.dropbox.com/debian trixie main` / `…/ubuntu resolute main` | `dropbox` 2026.09.28 | Key from `linux.dropbox.com/fedora/rpm-public-key.asc` only — the same fingerprint from `keyserver.ubuntu.com` is SHA1-bound and makes Debian 13's `apt-get update` exit 100 permanently. Installs `python3-gpg`. Summary tells the user to run `dropbox start -i` once from a desktop session |
| `setup-docker.sh` | `download.docker.com/linux/{debian trixie,ubuntu resolute} stable` | `docker-ce` 5:29.9.1, `containerd.io` 2.4.2-2, `docker-buildx-plugin` 0.38.0, `docker-compose-plugin` 5.6.0 | Offers the apt fallback (26.1.5 on Debian, 29.1.3 on Ubuntu) when the vendor route fails; **refuses and reports** when `docker.io` is already installed, because `docker-ce` Conflicts with it and removing an engine is the user's call; offers the `docker` group with the root-equivalence warning; installs lazydocker 0.25.2 as a static binary into `~/.local/bin` |

Nothing in this phase uses `dpkg -i`. The 64-bit `time_t` transition left
`libgtk-3-0`, `libatspi2.0-0`, `libasound2` and `libappindicator3-1` with
`Candidate: (none)`, resolvable only as virtual provides from the `t64`
packages, so a bare `dpkg -i` fails where `apt-get install ./file.deb` succeeds.

## Tests

| File | What it pins |
| --- | --- |
| `tests/apt-map-smoke.js` | The new group names in the allow-list and the owners map; the `chromium` Debian-only row; six pointer rows with `apt == '-'` and a note naming their script |
| `tests/vendor-repo-smoke.js` (new) | `add_vendor_repo` against a stub `apt-get`/`apt-cache`: the keyring directory is created first, the sources file is written **only after** the key lands, a failed key fetch leaves no sources file behind, a zero-exit update with no candidate is treated as failure, and the sources file and keyring are both removed on failure |
| `tests/setup-apps-smoke.js` (new) | All five scripts: `--invalid` exits 2, `--help` exits 0, an unsupported release is refused, `--dry-run` writes nothing, every step declines by default, a failed step is named in the summary and the script exits non-zero, and `setup-docker.sh` refuses when a stub `dpkg-query` reports `docker.io` installed |
| `tests/install-smoke.js` | The group enumeration comes from the label table: a new map group belonging to another script is not offered by `install.sh`; a failing shared update names the third-party sources files |
| `tests/setup-smoke.js` | `try` returns the command's status and still records the failure, where `attempt` returns 0 |
| `tests/vendor-container-smoke.js` (new, gated on `DEBIAN_SETUP_CONTAINER_TESTS=1`) | The five repositories in real `debian:stable-slim` and `ubuntu:latest`: key fetch, sources write, update with no `NO_PUBKEY` and no `Err`, and `apt-cache policy` reporting a numeric candidate for each package. This is the test that catches a vendor rotating a key or moving a suite |
| `tests/readme-smoke.js` | A `## Third-party applications` section naming each script, the Teams decision, and the Dropbox first-run step; every installable name in the catalogue |

## Risks

- **Every vendor version here is a 2026-10-15 snapshot.** Docker's repository
  already carried two versions of every package during the probe. The container
  test checks that a candidate exists, never that it equals a number.
- **Chrome adds Google's repository whether or not we do**: its postinst carries
  its own `REPOCONFIG` and it ships a `cron.daily`. "Install the .deb to avoid
  the repository" does not work; consent or nothing are the honest options.
- **ONLYOFFICE's pin is designed, not tested.** The repository's
  `ttf-mscorefonts-installer` outranking the distribution's was watched happen in
  `apt-cache policy`; that the pin prevents it is what the container test must
  prove before the README claims it.
- **Ubuntu's `docker.io`, `docker-compose-v2` and much else live in universe.**
  A minimal install with universe disabled loses the whole apt fallback, so those
  steps use `attempt`, not `run`.
- **Dropbox's usable client is a proprietary blob** fetched outside apt on first
  run, and verified only because `python3-gpg` is present.
- **The container tests cannot show that any of these applications launch.** Not
  Chrome's sandbox under Wayland, not DBeaver's SWT GUI, not ONLYOFFICE's
  editors, not the Dropbox daemon, not the Docker daemon or group membership
  taking effect. The README says so until each is confirmed on the machine.

## Open, and deliberately left to phase 4

Postman's `/opt` layout and its missing checksums; the Tor Browser staging path
through the `vps` alias; the Nerd Font; conky without patched glyphs; the zram
size for 30 GB of RAM; the root filesystem, which decides whether snapshots can
work at all; and whether `openssh-server` belongs on this laptop.
