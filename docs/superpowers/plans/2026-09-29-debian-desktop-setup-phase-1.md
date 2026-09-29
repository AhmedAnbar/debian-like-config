# debian-desktop-setup Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of a Debian/Ubuntu counterpart to `arch-desktop-setup`: an interactive installer that brings up the i3 desktop, shell and editor on Debian 13 or Ubuntu 26.04, with a package map verified against real apt indexes and a drift check against the Arch repository.

**Architecture:** One bash installer (`install.sh`) reads `packages/apt-map.tsv` — the single source of truth for arch→apt package equivalences — and builds its prompt groups from it, filtered by the release detected in `/etc/os-release`. Configuration files are copied verbatim from `arch-desktop-setup` except for two adapted files, and `scripts/sync-from-arch.sh` plus a test report any shared file that has since diverged. Tests are plain Node scripts: three fast ones that run anywhere, and one container-backed one that re-verifies every apt name.

**Tech Stack:** bash (`set -Eeuo pipefail`), apt-get, Node (`node:assert/strict`, no framework), Docker for the container test, codex CLI for the logo prompt.

**Spec:** `docs/superpowers/specs/2026-09-28-debian-desktop-setup-design.md`

## Global Constraints

- Every script: `#!/usr/bin/env bash`, `set -Eeuo pipefail`, and an `ERR` trap printing `Setup stopped at line %s. Review the error above before retrying.`
- SPDX header `# SPDX-License-Identifier: GPL-3.0-only` on every script; `LICENSE` is GPL-3.0 with `Copyright (C) 2026 AhmedAnbar`.
- Never run as root: `(( EUID == 0 ))` exits 1 with `Run as your normal user, without sudo. Commands needing root will use sudo.`
- Backups go to `$HOME/.local/state/debian-desktop-setup/$(date +%Y%m%d-%H%M%S)-$$`.
- `--dry-run` prints every command through `run()` and writes nothing; `--help` exits 0; any other argument exits 2.
- The release is read from `${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}`.
- Supported releases: Debian 13 trixie (`ID=debian`) and Ubuntu 26.04.1 LTS (`ID=ubuntu`); `ID_LIKE` containing `ubuntu` or `debian` is accepted and treated as that family.
- Package names in `packages/apt-map.tsv` are only added after resolving in `debian:stable-slim` and `ubuntu:latest`.
- Tests are `node tests/<name>.js`, print one `<name>: all checks passed` line on success, and never install packages or touch `$HOME` outside a temporary directory.
- Commits are authored `AhmedAnbar <AhmedAnbar@users.noreply.github.com>` with no co-author trailers.

## Review Focus

1. **`/etc/os-release` missing, unreadable or without `ID`** — the installer must say which families it supports and exit 1, not crash under `set -u`. Test in Task 3.
2. **Ubuntu's `firefox` is a snap transitional package** — it must never reach `apt-get install`; the Ubuntu run omits the browser and prints why. Test in Task 4.
3. **`apt-get update` failing** (no network, expired sources) — installation must abort rather than continue and report success. Test in Task 4.
4. **A configuration destination that is a symlink** into a dotfiles checkout — `install_file` must back up and replace the link itself, never write through it. Test in Task 5.
5. **`where=none` rows** (`rofi-emoji`, `uv`) — the `-` placeholder must never be passed to `apt-get`, and the feature that needs it must say it is unavailable. Tests in Task 4 and Task 5.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `LICENSE` | GPL-3.0 text, copied from the Arch repository. |
| `.gitignore` | Same ignores as the Arch repository. |
| `README.md` | The only documentation: logo header, what it sets up, get started, package catalogue, keyboard table, backups, phase roadmap. |
| `assets/LOGO.md` | The image-generation prompt written by codex, plus provenance and the path the PNG goes to. |
| `packages/apt-map.tsv` | arch→apt package map: group, arch, apt, where, note. The single source of truth. |
| `install.sh` | Guards, release detection, package groups from the map, configuration installation, services, summary. |
| `scripts/shared-files.txt` | Paths that must stay byte-identical to `arch-desktop-setup`. |
| `scripts/adapted-files.txt` | Paths that must differ, each with a reason. |
| `scripts/sync-from-arch.sh` | `--check` reports drift, `--pull` copies shared files back from the Arch checkout. |
| `setup-zsh.sh` | Zsh, Oh My Zsh, plugins, zshrc, login shell — apt flavour. |
| `setup-nvim.sh` | Neovim with a 0.11 floor: apt when new enough, upstream tarball when not. |
| `tests/readme-smoke.js` | Header, badges, logo prompt, and that every mapped package is documented. |
| `tests/apt-map-smoke.js` | Map well-formedness: columns, allowed `where` values, a reason for every difference. |
| `tests/install-smoke.js` | Guards, release detection, group previews, dry-run writes nothing. |
| `tests/drift-smoke.js` | Every config file is in exactly one list; shared files match; adapted files differ. |
| `tests/apt-names-smoke.js` | Container-gated: every mapped name resolves and `apt-get install --simulate` succeeds. |

---

### Task 1: Repository skeleton, licence and the logo prompt

**Files:**
- Create: `LICENSE`, `.gitignore`, `README.md`, `assets/LOGO.md`
- Test: `tests/readme-smoke.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the repository root every later task writes into; `README.md` with a `## Package catalogue` heading that Task 4 appends rows to.

- [ ] **Step 1: Write the failing test**

Create `tests/readme-smoke.js`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// Documentation and branding only: no packages, no network, no installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const readme = read('README.md');
// Ahmed generates the image from the recorded prompt, so the path is fixed up front.
assert.match(readme, /<img src="assets\/logo\.png" alt="[^"]{10,}" width="240">/,
    'The header must show assets/logo.png with descriptive alt text');
assert.match(readme, /^<h1 align="center">Debian Linux Config<\/h1>$/m);
for (const badge of ['License-GPL--3.0', 'OS-Debian', 'OS-Ubuntu', 'Desktop-i3', 'Shell-Zsh']) {
    assert.ok(readme.includes(badge), 'Missing badge: ' + badge);
}
assert.match(readme, /^## Package catalogue$/m, 'Task 4 appends the catalogue here');
// Supported releases are a promise to the reader: name them, and only them.
assert.match(readme, /Debian 13/);
assert.match(readme, /Ubuntu 26\.04/);

const license = read('LICENSE');
assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
assert.match(license, /Version 3/);

const logo = read('assets/LOGO.md');
assert.match(logo, /^# Logo$/m);
assert.match(logo, /^Prompt:$/m, 'The prompt is recorded verbatim, as in the Arch repository');
assert.match(logo, /codex/i, 'Record that the codex CLI wrote the prompt');
assert.match(logo, /assets\/logo\.png/, 'Say where the generated image goes');
assert.match(logo, /[Dd]ebian red|#[Aa]80030|#[Dd]70[Aa]53/, 'The prompt must name the Debian red');
assert.match(logo, /do not replicate|not replicate|avoid replicating/i,
    'The prompt must refuse to copy the official Debian logo');
console.log('readme-smoke: all checks passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd ~/debian-desktop-setup && node tests/readme-smoke.js`
Expected: FAIL with `ENOENT` for `README.md`.

- [ ] **Step 3: Copy the licence and ignores from the Arch repository**

```bash
cd ~/debian-desktop-setup
cp ~/arch-desktop-setup/LICENSE LICENSE
cp ~/arch-desktop-setup/.gitignore .gitignore
```

- [ ] **Step 4: Ask codex to write the image prompt**

The prompt for the logo must come from codex, not from you. Run it with the
repository as the working directory and capture stdout:

```bash
cd ~/debian-desktop-setup
codex exec --color never 'Write an image-generation prompt (one paragraph, no preamble, no markdown) for the logo of a personal Debian/Ubuntu desktop configuration project called Debian Linux Config. It is the sibling of an existing Arch project whose logo is a geometric mountain-shaped A built from three rounded tiled window panels with visible gaps and a tiny terminal prompt accent, in Catppuccin lavender #b4befe on solid dark #1e1e2e. Keep that visual language — flat, crisp, minimalist, centred large symbol, generous margins, no text, no watermark, readable at a small README icon size — but make the symbol a Debian-family counterpart in Debian red #A80030 with a warm highlight, on the same #1e1e2e background. State explicitly that it must be an original mark and must not replicate the official Debian swirl or any official distribution logo.' > /tmp/claude-1000/logo-prompt.txt
```

Check the output is a usable single paragraph before continuing:

```bash
wc -w /tmp/claude-1000/logo-prompt.txt && cat /tmp/claude-1000/logo-prompt.txt
```

If codex fails, returns an empty file, or returns something that is not an
image prompt, **stop and report it** — do not write a prompt yourself. The
requirement is that codex authored it.

- [ ] **Step 5: Write `assets/LOGO.md` around that prompt**

```bash
cd ~/debian-desktop-setup && mkdir -p assets && {
  cat <<'HEAD'
# Logo

File: `logo.png`. The prompt below was written by the codex CLI
(`codex exec`). Ahmed generates the image from it in ChatGPT and saves the
result as `assets/logo.png`, which the README header references.

Prompt:

HEAD
  cat /tmp/claude-1000/logo-prompt.txt
} > assets/LOGO.md
```

- [ ] **Step 6: Write the README skeleton**

```markdown
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
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node tests/readme-smoke.js`
Expected: `readme-smoke: all checks passed`

- [ ] **Step 8: Commit**

```bash
cd ~/debian-desktop-setup
git add LICENSE .gitignore README.md assets tests/readme-smoke.js
git commit -m "Add the repository skeleton, licence and logo prompt

The logo prompt is written by the codex CLI and recorded in assets/LOGO.md,
following the Arch repository's convention of keeping the prompt beside the
asset. The image itself is generated from it and saved as assets/logo.png."
```

---

### Task 2: The verified apt package map

**Files:**
- Create: `packages/apt-map.tsv`
- Test: `tests/apt-map-smoke.js`, `tests/apt-names-smoke.js`

**Interfaces:**
- Consumes: the repository root from Task 1.
- Produces: `packages/apt-map.tsv` with the header `group\tarch\tapt\twhere\tnote` and groups named `core-desktop`, `audio`, `input-emoji`, `browser-files`, `dev`, `shell`. Task 4 reads it; `where` is one of `both`, `debian`, `ubuntu`, `none`; `apt` is `-` exactly when `where=none`.

- [ ] **Step 1: Write the failing well-formedness test**

Create `tests/apt-map-smoke.js`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// Shape of the package map only; apt-names-smoke.js checks the names against apt.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'packages/apt-map.tsv'), 'utf8').trim().split('\n');

assert.equal(lines[0], ['group', 'arch', 'apt', 'where', 'note'].join('\t'), 'Header row');
const groups = new Set(['core-desktop', 'audio', 'input-emoji', 'browser-files', 'dev', 'shell']);
const places = new Set(['both', 'debian', 'ubuntu', 'none']);
const archSeen = new Set();
let none = 0;
for (const line of lines.slice(1)) {
    const columns = line.split('\t');
    assert.equal(columns.length, 5, 'Five tab-separated columns: ' + line);
    const [group, arch, apt, where, note] = columns;
    assert.ok(groups.has(group), 'Unknown group: ' + line);
    assert.ok(places.has(where), 'Unknown where: ' + line);
    assert.ok(!archSeen.has(arch) || arch === '-', 'Duplicate arch package: ' + arch);
    archSeen.add(arch);
    if (where === 'none') {
        none++;
        assert.equal(apt, '-', 'An unavailable package has no apt name: ' + line);
        assert.ok(note.length > 20, 'An unavailable package must name its replacement: ' + line);
    } else {
        assert.match(apt, /^[a-z0-9][a-z0-9.+-]*$/, 'Not a Debian package name: ' + line);
    }
    if (arch !== apt || where !== 'both') {
        assert.ok(note.length > 10, 'Every difference needs a reason: ' + line);
    }
}
// The two known gaps: rofi-emoji and uv. A third would be a decision, not a detail.
assert.equal(none, 2, 'Exactly the two documented unavailable packages');
assert.ok(lines.length > 50, 'The map covers the phase 1 groups');
console.log('apt-map-smoke: all checks passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/apt-map-smoke.js`
Expected: FAIL with `ENOENT` for `packages/apt-map.tsv`.

- [ ] **Step 3: Write the map**

Create `packages/apt-map.tsv`, tab-separated, exactly these rows:

```
group	arch	apt	where	note
core-desktop	i3-wm	i3-wm	both	-
core-desktop	i3status	i3status	both	-
core-desktop	i3lock	i3lock	both	-
core-desktop	xorg-server	xserver-xorg	both	Debian splits the X server metapackage under a different name
core-desktop	xorg-xinit	xinit	both	startx and xinitrc handling
core-desktop	xorg-xinput	xinput	both	-
core-desktop	xorg-setxkbmap	x11-xkb-utils	both	setxkbmap ships inside x11-xkb-utils
core-desktop	xorg-xrandr	x11-xserver-utils	both	xrandr ships inside x11-xserver-utils
core-desktop	xf86-input-libinput	xserver-xorg-input-libinput	both	-
core-desktop	kitty	kitty	both	-
core-desktop	rofi	rofi	both	Debian 13 has 1.7.5 and Ubuntu 26.04 has 2.0.0; both read the bundled themes
core-desktop	picom	picom	both	-
core-desktop	flameshot	flameshot	both	-
core-desktop	noto-fonts	fonts-noto	both	Debian font packages are prefixed fonts-
core-desktop	dex	dex	both	-
core-desktop	xss-lock	xss-lock	both	-
core-desktop	networkmanager	network-manager	both	-
core-desktop	network-manager-applet	network-manager-gnome	both	nm-applet ships in network-manager-gnome
core-desktop	bluez	bluez	both	-
core-desktop	bluez-utils	bluez	both	bluetoothctl ships in bluez itself; Debian has no separate utils package
core-desktop	blueman	blueman	both	-
core-desktop	libpulse	libpulse0	both	Debian suffixes the library package with its soname
core-desktop	psmisc	psmisc	both	-
core-desktop	gsettings-desktop-schemas	gsettings-desktop-schemas	both	-
audio	pipewire	pipewire	both	-
audio	pipewire-alsa	pipewire-alsa	both	-
audio	pipewire-jack	pipewire-jack	both	-
audio	pipewire-pulse	pipewire-pulse	both	-
audio	wireplumber	wireplumber	both	-
audio	alsa-utils	alsa-utils	both	-
input-emoji	brightnessctl	brightnessctl	both	-
input-emoji	rofi-emoji	-	none	Not packaged in Debian 13 or Ubuntu 26.04; config/i3/emoji.sh reports it is unavailable and phase 2 decides on an upstream build
input-emoji	noto-fonts-emoji	fonts-noto-color-emoji	both	Debian names the colour emoji font separately
input-emoji	xclip	xclip	both	-
browser-files	firefox	firefox-esr	debian	Debian ships the ESR package; Ubuntu's apt firefox is only a snap transitional package, so phase 3 adds the Mozilla apt repository instead
browser-files	thunar	thunar	both	-
browser-files	thunar-archive-plugin	thunar-archive-plugin	both	-
browser-files	file-roller	file-roller	both	-
browser-files	gvfs	gvfs	both	-
browser-files	gpicview	gpicview	both	-
browser-files	xdg-user-dirs	xdg-user-dirs	both	-
browser-files	xdg-utils	xdg-utils	both	-
browser-files	retext	retext	both	-
dev	base-devel	build-essential	both	build-essential is the Debian equivalent metapackage
dev	git	git	both	-
dev	github-cli	gh	both	Debian and Ubuntu both package the GitHub CLI as gh
dev	vim	vim	both	-
dev	neovim	neovim	both	Debian 13 has 0.10.4 and Ubuntu 26.04 has 0.11.6; setup-nvim.sh installs the upstream tarball when apt is older than 0.11
dev	dialog	dialog	both	-
dev	php	php-cli	both	The Debian php metapackage pulls Apache; php-cli is the command-line interpreter
dev	composer	composer	both	-
dev	curl	curl	both	-
dev	openssh	openssh-client	both	A desktop needs the client; the server is not installed by default
dev	mkcert	mkcert	both	-
dev	nss	libnss3-tools	both	certutil, which mkcert needs, lives in libnss3-tools
dev	inetutils	iputils-ping	both	Debian splits the inetutils tools; ping is the one this desktop uses
dev	uv	-	none	Astral publishes no apt package; the official installer script is used in a later phase
shell	zsh	zsh	both	-
shell	zsh-autosuggestions	zsh-autosuggestions	both	-
shell	zsh-syntax-highlighting	zsh-syntax-highlighting	both	-
```

- [ ] **Step 4: Run the well-formedness test to verify it passes**

Run: `node tests/apt-map-smoke.js`
Expected: `apt-map-smoke: all checks passed`

- [ ] **Step 5: Write the container test that checks the names against apt**

Create `tests/apt-names-smoke.js`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// Resolves every mapped apt name inside the real Debian and Ubuntu indexes.
// Slow (it pulls images), so it runs only when asked for explicitly.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (process.env.DEBIAN_SETUP_CONTAINER_TESTS !== '1') {
    console.log('apt-names-smoke: skipped, set DEBIAN_SETUP_CONTAINER_TESTS=1 to run it');
    process.exit(0);
}
const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {encoding: 'utf8'});
assert.equal(docker.status, 0, 'DEBIAN_SETUP_CONTAINER_TESTS=1 needs a usable docker: ' + docker.stderr);

const rows = fs.readFileSync(path.join(root, 'packages/apt-map.tsv'), 'utf8').trim().split('\n')
    .slice(1).map((line) => line.split('\t'));
const wanted = (release) => [...new Set(rows
    .filter(([, , apt, where]) => apt !== '-' && (where === 'both' || where === release))
    .map(([, , apt]) => apt))].sort();

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apt-names-'));
try {
    for (const [release, image] of [['debian', 'debian:stable-slim'], ['ubuntu', 'ubuntu:latest']]) {
        const list = path.join(scratch, release + '.txt');
        fs.writeFileSync(list, wanted(release).join('\n') + '\n');
        const result = spawnSync('docker', ['run', '--rm', '-v', `${list}:/list.txt:ro`, image, 'sh', '-c',
            'apt-get update -qq >/dev/null 2>&1 || { echo "apt-get update failed"; exit 1; }\n' +
            'while read -r p; do\n' +
            '  v=$(apt-cache policy "$p" 2>/dev/null | awk "/Candidate:/{print \\$2; exit}")\n' +
            '  case "$v" in ""|"(none)") printf "MISSING %s\\n" "$p" ;; esac\n' +
            'done < /list.txt\n' +
            'apt-get install --simulate $(tr "\\n" " " < /list.txt) >/dev/null || echo "SIMULATE FAILED"'],
            {encoding: 'utf8', timeout: 900000});
        assert.equal(result.status, 0, `${image}: ${result.stderr}`);
        assert.doesNotMatch(result.stdout, /MISSING/, `${image} cannot resolve: ${result.stdout}`);
        assert.doesNotMatch(result.stdout, /SIMULATE FAILED/, `${image} cannot install the set together`);
        console.log(`apt-names-smoke: ${image} resolves all ${wanted(release).length} packages`);
    }
} finally {
    fs.rmSync(scratch, {recursive: true, force: true});
}
console.log('apt-names-smoke: all checks passed');
```

- [ ] **Step 6: Run the container test for real**

Run: `DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/apt-names-smoke.js`
Expected: both images resolve every name and the simulated install succeeds.
`zsh-autosuggestions`, `zsh-syntax-highlighting`, `xinit`, `x11-xkb-utils`,
`x11-xserver-utils`, `xserver-xorg-input-libinput` and `composer` were not in the
original spec probe — if any of them is reported MISSING, fix the map row (and
its `note`) and rerun until this passes. Do not weaken the assertion.

- [ ] **Step 7: Confirm it skips cleanly without the flag**

Run: `node tests/apt-names-smoke.js`
Expected: `apt-names-smoke: skipped, set DEBIAN_SETUP_CONTAINER_TESTS=1 to run it`, exit 0.

- [ ] **Step 8: Commit**

```bash
cd ~/debian-desktop-setup
git add packages/apt-map.tsv tests/apt-map-smoke.js tests/apt-names-smoke.js
git commit -m "Add the verified arch-to-apt package map

Every name resolves in debian:stable-slim and ubuntu:latest, checked by
tests/apt-names-smoke.js. Two packages have no apt equivalent: rofi-emoji and
uv, both recorded with where=none and the replacement named in the note."
```

---

### Task 3: Guards and release detection

**Files:**
- Create: `install.sh`
- Test: `tests/install-smoke.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: in `install.sh` — `$release` (`debian` or `ubuntu`), `$family` (`Debian` or `Ubuntu`), `$dry_run`, `$bundle_dir`, `$target_config`, `$backup_dir`, and the functions `ask "question"` (returns 0 on y/Y/yes) and `run cmd args...` (prints the command, executes it unless `--dry-run`). Tasks 4, 5 and 8 extend the same file.

Do **not** add the `config/` directory guard here: that directory arrives in
Task 5, and adding the guard early breaks this task's own tests.

- [ ] **Step 1: Write the failing test**

Create `tests/install-smoke.js`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// Previews only: a scratch HOME, a stubbed apt-get, no package ever installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-install-smoke-'));
const bin = path.join(scratch, 'bin');
fs.mkdirSync(bin);
// Stubs: this test must never reach a real package manager or a real sudo.
fs.writeFileSync(path.join(bin, 'apt-get'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});

const osRelease = (body, name = 'os-release') => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, body);
    return file;
};
const env = (file) => ({
    ...process.env, HOME: scratch, PATH: `${bin}:${process.env.PATH}`,
    DEBIAN_SETUP_OS_RELEASE: file,
});
const install = (args, file, answers = 'n\n'.repeat(60)) =>
    spawnSync('bash', [path.join(root, 'install.sh'), ...args],
        {encoding: 'utf8', timeout: 30000, input: answers, env: env(file)});

const debian = osRelease('ID=debian\nVERSION_CODENAME=trixie\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const ubuntu = osRelease('ID=ubuntu\nVERSION_CODENAME=resolute\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n', 'ubuntu');

// Arguments.
assert.equal(install(['--invalid'], debian).status, 2, 'An unknown argument is a usage error');
assert.equal(install(['--help'], debian).status, 0);

// An unknown or unreadable distribution must explain itself, never crash.
const fedora = install(['--dry-run'], osRelease('ID=fedora\nID_LIKE=rhel\n', 'fedora'));
assert.equal(fedora.status, 1);
assert.match(fedora.stderr, /Debian/);
assert.match(fedora.stderr, /Ubuntu/);
const absent = install(['--dry-run'], path.join(scratch, 'does-not-exist'));
assert.equal(absent.status, 1);
assert.match(absent.stderr, /os-release|distribution is unknown/);
const idless = install(['--dry-run'], osRelease('PRETTY_NAME="Mystery Linux"\n', 'idless'));
assert.equal(idless.status, 1);
assert.match(idless.stderr, /ID/);

// Both families, and an Ubuntu derivative through ID_LIKE.
const cases = [[debian, 'Debian'], [ubuntu, 'Ubuntu'],
    [osRelease('ID=linuxmint\nID_LIKE="ubuntu debian"\n', 'mint'), 'Ubuntu']];
for (const [file, family] of cases) {
    const preview = install(['--dry-run'], file);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, new RegExp(`\\(${family} family\\)`), 'Name the detected family back');
}

// A preview writes nothing at all.
assert.deepEqual(fs.readdirSync(scratch).sort(),
    ['bin', 'debian', 'fedora', 'idless', 'mint', 'ubuntu'], 'A preview must not create files');
fs.rmSync(scratch, {recursive: true, force: true});
console.log('install-smoke: all checks passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/install-smoke.js`
Expected: FAIL — `install.sh` does not exist yet.

- [ ] **Step 3: Write `install.sh`**

```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 AhmedAnbar
set -Eeuo pipefail
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "$LINENO" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h)
        printf 'Usage: bash install.sh [--dry-run]\n'
        printf 'Run as your normal desktop user on Debian 13 or Ubuntu 26.04.\n'
        exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
if (( EUID == 0 )); then
    printf 'Run as your normal user, without sudo. Commands needing root will use sudo.\n' >&2
    exit 1
fi
command -v apt-get >/dev/null || { printf 'This installer requires apt-get: Debian or Ubuntu.\n' >&2; exit 1; }
# Overridable so the tests can present a Debian or Ubuntu release on any machine.
os_release=${DEBIAN_SETUP_OS_RELEASE:-/etc/os-release}
[[ -r "$os_release" ]] || { printf 'Cannot read %s, so the distribution is unknown.\n' "$os_release" >&2; exit 1; }
# os-release is shell syntax; read it in subshells so it cannot leak variables here.
distro_id=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${ID:-}")
distro_like=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${ID_LIKE:-}")
distro_name=$(. "$os_release" >/dev/null 2>&1; printf '%s' "${PRETTY_NAME:-${ID:-}}")
[[ -n "$distro_id" ]] || { printf '%s has no ID line, so the distribution is unknown.\n' "$os_release" >&2; exit 1; }
unsupported() {
    printf 'Unsupported distribution: %s.\n' "$1" >&2
    printf 'This installer supports Debian 13 and Ubuntu 26.04, and derivatives that name one of them in ID_LIKE.\n' >&2
    exit 1
}
case "$distro_id" in
    debian) release=debian family=Debian ;;
    ubuntu) release=ubuntu family=Ubuntu ;;
    *)  case " $distro_like " in
            *" ubuntu "*) release=ubuntu family=Ubuntu ;;
            *" debian "*) release=debian family=Debian ;;
            *) unsupported "$distro_id" ;;
        esac ;;
esac
target_config="$HOME/.config"
backup_dir="$HOME/.local/state/debian-desktop-setup/$(date +%Y%m%d-%H%M%S)-$$"
ask() {
    local answer
    read -r -p "$1 [y/N] " answer || return 1
    [[ "$answer" == y || "$answer" == Y || "$answer" == yes ]]
}
run() {
    printf '  '; printf '%q ' "$@"; printf '\n'
    if ! "$dry_run"; then "$@"; fi
}
printf 'Debian desktop setup — packages, configuration and services\n'
printf 'Copyright (C) 2026 AhmedAnbar. GPL-3.0-only; no warranty. See LICENSE for redistribution terms.\n'
printf 'Detected %s (%s family); installing with apt.\n' "${distro_name:-$distro_id}" "$family"
printf 'Existing configuration files are backed up before replacement.\n'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/install-smoke.js`
Expected: `install-smoke: all checks passed`

- [ ] **Step 5: Commit**

```bash
cd ~/debian-desktop-setup
git add install.sh tests/install-smoke.js
git commit -m "Detect Debian and Ubuntu before doing anything else

The release decides which packages exist, so it is read first, from an
overridable os-release path that lets the tests present either family on any
machine. An unknown, unreadable or ID-less file stops the run with a message
naming the supported releases instead of failing later under set -u."
```

---

### Task 4: Package groups built from the map

**Files:**
- Modify: `install.sh` (append after the banner), `README.md` (fill `## Package catalogue`)
- Test: `tests/install-smoke.js` (append), `tests/readme-smoke.js` (append)

**Interfaces:**
- Consumes: `$release`, `ask`, `run` from Task 3; `packages/apt-map.tsv` from Task 2.
- Produces: `$packages` (the accepted apt names, sorted and deduplicated) for Task 8's summary, and the printed lines `Selected packages: …`, `Not packaged on <family>: …` and `Skipped on <family>: …`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/install-smoke.js`, before the `fs.rmSync(scratch, …)` line (move that line and the final `console.log` to the end):

```js
// Package groups come from the map, and the map's gaps must be visible.
const accept = 'y\n'.repeat(60);
const debianPreview = install(['--dry-run'], debian, accept);
assert.equal(debianPreview.status, 0, debianPreview.stderr);
const ubuntuPreview = install(['--dry-run'], ubuntu, accept);
assert.equal(ubuntuPreview.status, 0, ubuntuPreview.stderr);
const selected = (result) => result.stdout.split('\n').find((line) => line.startsWith('Selected packages:'));

// Debian gets the ESR browser; Ubuntu must not be offered the snap transitional package.
assert.match(selected(debianPreview), /\bfirefox-esr\b/);
assert.doesNotMatch(selected(ubuntuPreview), /\bfirefox\b/, 'Never install apt firefox on Ubuntu: it is a snap stub');
assert.match(ubuntuPreview.stdout, /Skipped on Ubuntu:[^\n]*firefox-esr/);
assert.match(ubuntuPreview.stdout, /Mozilla apt repository/, 'Say what replaces it');

// where=none rows are reported, never installed, and never leak the - placeholder.
for (const preview of [debianPreview, ubuntuPreview]) {
    assert.match(preview.stdout, /Not packaged on \w+:[^\n]*rofi-emoji/);
    assert.match(preview.stdout, /Not packaged on \w+:[^\n]*\buv\b/);
    assert.doesNotMatch(selected(preview), /(^|\s)-(\s|$)/, 'The - placeholder must never reach apt');
    // bluez appears twice in the map (bluez and bluez-utils both map to it).
    assert.equal(selected(preview).match(/\bbluez\b/g).length, 1, 'Duplicate apt names are collapsed');
    assert.match(preview.stdout, /sudo apt-get update/);
    assert.match(preview.stdout, /sudo apt-get install/);
}

// A failing apt-get update must stop the run: never report an install that did not happen.
const failing = path.join(scratch, 'failbin');
fs.mkdirSync(failing);
fs.writeFileSync(path.join(failing, 'apt-get'),
    '#!/bin/sh\n[ "$1" = update ] && exit 100\nexit 0\n', {mode: 0o755});
fs.writeFileSync(path.join(failing, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
const broken = spawnSync('bash', [path.join(root, 'install.sh')], {
    encoding: 'utf8', timeout: 30000, input: accept,
    env: {...env(debian), PATH: `${failing}:${process.env.PATH}`},
});
assert.notEqual(broken.status, 0, 'A failed update must fail the run');
assert.doesNotMatch(broken.stdout, /apt-get install/, 'Do not attempt the install after a failed update');
```

Append to `tests/readme-smoke.js`, before its `console.log`:

```js
// Every package that can be installed must be documented, as in the Arch repository.
const rows = read('packages/apt-map.tsv').trim().split('\n').slice(1).map((line) => line.split('\t'));
for (const [, arch, apt, where] of rows) {
    const documented = apt === '-' ? arch : apt;
    assert.ok(readme.includes('`' + documented + '`'),
        `Undocumented package: ${documented} (${where})`);
}
assert.match(readme, /not packaged/i, 'The catalogue must mark the unavailable packages');
```

- [ ] **Step 2: Run both to make sure they fail**

Run: `node tests/install-smoke.js; node tests/readme-smoke.js`
Expected: install-smoke fails because no groups are offered; readme-smoke fails on the first undocumented package.

- [ ] **Step 3: Append the group logic to `install.sh`**

```bash
map="$bundle_dir/packages/apt-map.tsv"
[[ -r "$map" ]] || { printf 'Missing package map: %s\n' "$map" >&2; exit 1; }
declare -A group_label=(
    [core-desktop]='Core i3 desktop and all configuration dependencies'
    [audio]='PipeWire audio'
    [input-emoji]='Brightness keys, emoji fonts and clipboard'
    [browser-files]='Browser and file utilities'
    [dev]='Development and command-line utilities (PHP, Composer, mkcert)'
    [shell]='Zsh and its completion plugins'
)
packages=()
unavailable=()
skipped=()
group() {
    local id=$1 list=() g arch apt where note
    while IFS=$'\t' read -r g arch apt where note; do
        [[ "$g" == "$id" ]] || continue
        case "$where" in
            none) unavailable+=("$arch ($note)") ;;
            both) list+=("$apt") ;;
            "$release") list+=("$apt") ;;
            *) skipped+=("$apt ($note)") ;;
        esac
    done < <(tail -n +2 -- "$map")
    (( ${#list[@]} )) || return 0
    mapfile -t list < <(printf '%s\n' "${list[@]}" | sort -u)
    printf '\n%s\n  %s\n' "${group_label[$id]}" "${list[*]}"
    if ask 'Include these packages?'; then packages+=("${list[@]}"); fi
}
for id in core-desktop audio input-emoji browser-files dev shell; do group "$id"; done
if (( ${#unavailable[@]} )); then
    printf '\nNot packaged on %s: %s\n' "$family" "${unavailable[*]}"
fi
if (( ${#skipped[@]} )); then
    printf 'Skipped on %s: %s\n' "$family" "${skipped[*]}"
fi
if (( ${#packages[@]} )); then
    mapfile -t packages < <(printf '%s\n' "${packages[@]}" | sort -u)
    printf '\nSelected packages: %s\n' "${packages[*]}"
    if ask 'Update the package lists and install the selected packages?'; then
        # A failed update must stop here: installing against a stale index is worse.
        run sudo apt-get update
        run sudo apt-get install -y "${packages[@]}"
    fi
fi
```

- [ ] **Step 4: Fill the README catalogue from the same rows**

```bash
cd ~/debian-desktop-setup
{
  printf '| Package | Arch counterpart | Releases | Notes |\n| --- | --- | --- | --- |\n'
  tail -n +2 packages/apt-map.tsv | awk -F'\t' '{
    note = ($5 == "-" ? "" : $5);
    name = ($3 == "-" ? "`" $2 "` (not packaged)" : "`" $3 "`");
    printf "| %s | `%s` | %s | %s |\n", name, $2, $4, note;
  }'
} > /tmp/claude-1000/catalogue.md
python3 - <<'PY'
import pathlib
readme = pathlib.Path('README.md')
table = pathlib.Path('/tmp/claude-1000/catalogue.md').read_text()
text = readme.read_text()
marker = '## Package catalogue\n'
head, _, tail = text.partition(marker)
intro = ('\nEvery package the installer can offer, generated from '
         '`packages/apt-map.tsv`. `Releases` says where the package exists: '
         '`both`, `debian`, `ubuntu`, or `none` when apt has no such package.\n\n')
readme.write_text(head + marker + intro + table + tail)
PY
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `node tests/install-smoke.js && node tests/readme-smoke.js && node tests/apt-map-smoke.js`
Expected: three `all checks passed` lines.

- [ ] **Step 6: Commit**

```bash
cd ~/debian-desktop-setup
git add install.sh README.md tests/install-smoke.js tests/readme-smoke.js
git commit -m "Build the package groups from the map

install.sh reads packages/apt-map.tsv instead of carrying its own lists, so a
package cannot be installed without a documented apt name and a reason for any
difference. Rows that do not apply to the running release are reported rather
than silently dropped, and a failed apt-get update stops the run."
```

---

### Task 5: The configuration tree

**Files:**
- Create: `config/` (copied from the Arch repository), `applications/retext-preview.desktop`
- Modify: `install.sh` (append), `config/i3/config` (one comment), `config/i3/emoji.sh` (plugin guard), `zsh/zshrc` (Debian plugin paths)
- Test: `tests/install-smoke.js` (append)

**Interfaces:**
- Consumes: `$target_config`, `$backup_dir`, `ask`, `run`, `$dry_run` from Task 3.
- Produces: `install_file <source> <relative>` — copies a bundled file to `$target_config/<relative>`, asking before replacing a changed file and backing it up under `$backup_dir/<relative>`; and the `ROFI_PLUGIN_PATH` test hook in `config/i3/emoji.sh`.

- [ ] **Step 1: Write the failing test**

Append to `tests/install-smoke.js`, before the cleanup:

```js
// Configuration installation, for real, inside the scratch HOME.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-config-smoke-'));
    const outside = path.join(home, 'dotfiles-i3-config');
    fs.writeFileSync(outside, 'original i3 config\n');
    fs.mkdirSync(path.join(home, '.config', 'i3'), {recursive: true});
    // A dotfiles checkout is usually symlinked into place: replace the link, not its target.
    fs.symlinkSync(outside, path.join(home, '.config', 'i3', 'config'));
    const real = spawnSync('bash', [path.join(root, 'install.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(80),
        env: {...env(debian), HOME: home},
    });
    assert.equal(real.status, 0, real.stderr);
    const installed = path.join(home, '.config', 'i3', 'config');
    assert.ok(!fs.lstatSync(installed).isSymbolicLink(), 'The symlink itself must be replaced');
    assert.equal(fs.readFileSync(installed, 'utf8'),
        fs.readFileSync(path.join(root, 'config/i3/config'), 'utf8'), 'The bundled file is installed');
    assert.equal(fs.readFileSync(outside, 'utf8'), 'original i3 config\n',
        'Writing through the link would have overwritten the dotfiles checkout');
    const backups = fs.readdirSync(path.join(home, '.local/state/debian-desktop-setup'));
    assert.equal(backups.length, 1, 'One timestamped backup directory');
    assert.equal(fs.readFileSync(path.join(home, '.local/state/debian-desktop-setup',
        backups[0], 'i3/config'), 'utf8'), 'original i3 config\n', 'The original is recoverable');
    fs.rmSync(home, {recursive: true, force: true});
}

// The emoji picker must explain the missing Debian plugin instead of opening nothing.
{
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-emoji-smoke-'));
    const stubs = path.join(probe, 'bin');
    fs.mkdirSync(stubs);
    const log = path.join(probe, 'log');
    fs.writeFileSync(path.join(stubs, 'rofi'), `#!/bin/sh\necho "rofi $*" >> ${log}\n`, {mode: 0o755});
    fs.writeFileSync(path.join(stubs, 'notify-send'), `#!/bin/sh\necho "notify $*" >> ${log}\n`, {mode: 0o755});
    const emoji = (pluginDir) => {
        fs.writeFileSync(log, '');
        const result = spawnSync('sh', [path.join(root, 'config/i3/emoji.sh')], {
            encoding: 'utf8', timeout: 20000,
            env: {...process.env, PATH: `${stubs}:/usr/bin:/bin`, ROFI_PLUGIN_PATH: pluginDir},
        });
        assert.equal(result.status, 0, result.stderr);
        return {log: fs.readFileSync(log, 'utf8'), stderr: result.stderr};
    };
    const missing = emoji(path.join(probe, 'empty'));
    assert.doesNotMatch(missing.log, /^rofi/m, 'Without the plugin, Rofi must not be started');
    assert.match(missing.log, /^notify/m, 'The user is told why');
    assert.match(missing.stderr, /emoji plugin/);
    const present = path.join(probe, 'plugins');
    fs.mkdirSync(present);
    fs.writeFileSync(path.join(present, 'emoji.so'), '');
    assert.match(emoji(present).log, /^rofi .*-modi emoji/m, 'With the plugin, the picker opens');
    fs.rmSync(probe, {recursive: true, force: true});
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/install-smoke.js`
Expected: FAIL — `config/i3/config` does not exist yet.

- [ ] **Step 3: Copy the configuration tree from the Arch repository**

```bash
cd ~/debian-desktop-setup
mkdir -p config applications
for dir in i3 i3status kitty rofi picom fontconfig gtk-3.0 gtk-4.0 nvim shell flameshot phpactor; do
    cp -a ~/arch-desktop-setup/config/"$dir" config/
done
cp -a ~/arch-desktop-setup/applications/retext-preview.desktop applications/
cp -a ~/arch-desktop-setup/zsh zsh
find config applications zsh -type f | wc -l   # expect well over 100 files
```

- [ ] **Step 4: Adapt the two files that cannot be shared verbatim**

`config/i3/config` — the autostart comment points at the Arch wiki; point it at
the specification instead:

```bash
cd ~/debian-desktop-setup
sed -i 's#https://wiki.archlinux.org/index.php/XDG_Autostart#https://specifications.freedesktop.org/autostart-spec/latest/#' config/i3/config
grep -n 'autostart-spec' config/i3/config
```

`zsh/zshrc` — it sources the plugins from `/usr/share/zsh/plugins/`, which is
Arch's layout, behind an `[[ -r ]]` guard, so on Debian the plugins would simply
never load and nothing would say why. Point both lines at the Debian paths:

```bash
cd ~/debian-desktop-setup
sed -i \
  -e 's#/usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh#/usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh#g' \
  -e 's#/usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh#/usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh#g' \
  zsh/zshrc
grep -n 'zsh-autosuggestions\|zsh-syntax-highlighting' zsh/zshrc   # expect the Debian paths
zsh -n zsh/zshrc 2>/dev/null || bash -n /dev/null   # syntax check where zsh exists
```

`config/i3/emoji.sh` — replace the file with this version, which reports the
missing Debian plugin:

```sh
#!/bin/sh
# Copy the selected emoji; do not send synthetic typing to another application.
# Debian and Ubuntu do not package the Rofi emoji plugin, so check for it first
# and say so rather than opening an empty picker. ROFI_PLUGIN_PATH is a test hook.
set -eu
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
found=false
for dir in ${ROFI_PLUGIN_PATH:-/usr/lib/*/rofi /usr/lib/rofi /usr/local/lib/rofi}; do
    if [ -e "$dir/emoji.so" ]; then found=true; break; fi
done
if [ "$found" = false ]; then
    message='The Rofi emoji plugin is not packaged on Debian or Ubuntu. Build rofi-emoji from source to enable this picker.'
    if command -v notify-send >/dev/null; then notify-send 'Emoji picker' "$message"; fi
    printf '%s\n' "$message" >&2
    exit 0
fi
exec rofi -no-config -modi emoji -show emoji -emoji-mode copy \
    -emoji-format '{emoji}  {name}' -theme "$config_root/rofi/emoji.rasi"
```

- [ ] **Step 5: Append `install_file` and the configuration step to `install.sh`**

Insert `install_file` next to `run` (both are helpers), and the guard right
after the `bundle_dir` line:

```bash
[[ -d "$bundle_dir/config" ]] || { printf 'Keep install.sh with its config folder.\n' >&2; exit 1; }
```

```bash
install_file() {
    local source=$1 relative=$2 destination="$target_config/$2"
    if [[ -f "$destination" ]] && cmp -s "$source" "$destination"; then
        printf 'Unchanged: %s\n' "$destination"; return
    fi
    if [[ -e "$destination" || -L "$destination" ]]; then
        ask "Back up and replace $destination?" || return 0
        run mkdir -p -- "$backup_dir/$(dirname -- "$relative")"
        if [[ ! -e "$backup_dir/$relative" && ! -L "$backup_dir/$relative" ]]; then
            run cp -a -- "$destination" "$backup_dir/$relative"
        fi
        # Replace a symlink itself rather than writing through it into a dotfiles checkout.
        run unlink -- "$destination"
    fi
    run install -Dm644 -- "$source" "$destination"
}
```

Append after the package section:

```bash
if ask 'Install the desktop configuration bundle (each existing changed file asks before replacement)?'; then
    while IFS= read -r -d '' source <&3; do
        relative=${source#"$bundle_dir/config/"}
        install_file "$source" "$relative"
    done 3< <(find "$bundle_dir/config" -path "$bundle_dir/config/nvim" -prune -o -type f -print0 | sort -z)
    # The scripts must stay executable; install_file writes mode 644 for plain configuration.
    for script in i3/brightness.sh i3/emoji.sh i3/launcher.sh i3/touchpad.sh; do
        [[ -f "$bundle_dir/config/$script" ]] || continue
        run install -Dm755 -- "$bundle_dir/config/$script" "$target_config/$script"
    done
    if ! "$dry_run" && command -v i3 >/dev/null; then run i3 -C -c "$target_config/i3/config"; fi
fi
if ask 'Choose the Rofi theme for the installed launcher?'; then
    printf '1) Catppuccin  2) Nord  3) Dracula\n'
    read -r -p 'Theme [1]: ' choice
    case "$choice" in
        2) theme=i3-theme-nord.rasi ;;
        3) theme=i3-theme-dracula.rasi ;;
        *) theme=i3-theme.rasi ;;
    esac
    # A separate pointer file means switching themes never edits the i3 bindings.
    if ! "$dry_run"; then
        theme_temp=$(mktemp)
        printf '@theme "%s"\n' "$theme" > "$theme_temp"
        install_file "$theme_temp" rofi/active-theme.rasi
        unlink "$theme_temp"
    else
        printf 'Would select %s\n' "$theme"
    fi
fi
if ask 'Open Markdown (.md) files rendered in ReText preview by default?'; then
    viewer_entry="$HOME/.local/share/applications/retext-preview.desktop"
    if [[ -f "$viewer_entry" ]] && cmp -s -- "$bundle_dir/applications/retext-preview.desktop" "$viewer_entry"; then
        printf 'Unchanged: %s\n' "$viewer_entry"
    else
        run install -Dm644 -- "$bundle_dir/applications/retext-preview.desktop" "$viewer_entry"
    fi
    if command -v xdg-mime >/dev/null; then run xdg-mime default retext-preview.desktop text/markdown; fi
fi
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node tests/install-smoke.js`
Expected: `install-smoke: all checks passed`

- [ ] **Step 7: Commit**

```bash
cd ~/debian-desktop-setup
git add config applications zsh install.sh tests/install-smoke.js
git commit -m "Install the shared configuration tree

The configuration is the Arch repository's, byte for byte, except for three
files that cannot be: the i3 autostart comment now cites the freedesktop
specification, the emoji picker reports that Debian does not package the Rofi
emoji plugin instead of opening an empty picker, and the zshrc sources its
plugins from the Debian paths rather than Arch's /usr/share/zsh/plugins, where
its [[ -r ]] guard would have skipped them in silence.

install_file replaces a symlinked destination rather than writing through it,
so a dotfiles checkout is backed up and left intact."
```

---

### Task 6: Drift control against the Arch repository

**Files:**
- Create: `scripts/shared-files.txt`, `scripts/adapted-files.txt`, `scripts/sync-from-arch.sh`
- Test: `tests/drift-smoke.js`

**Interfaces:**
- Consumes: the configuration tree from Task 5.
- Produces: `scripts/sync-from-arch.sh [--check|--pull]`, reading `${ARCH_SETUP_DIR:-$HOME/arch-desktop-setup}` and printing one `same|drifted|missing<TAB><path>` line per shared file; `--check` exits 1 on any drift, 0 when the Arch checkout is absent. `scripts/adapted-files.txt` is `<path><TAB><reason>`.

- [ ] **Step 1: Write the failing test**

Create `tests/drift-smoke.js`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// Compares the shared configuration against the Arch repository; read-only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const archDir = process.env.ARCH_SETUP_DIR || path.join(os.homedir(), 'arch-desktop-setup');

const shared = read('scripts/shared-files.txt').trim().split('\n');
const adapted = read('scripts/adapted-files.txt').trim().split('\n').map((line) => line.split('\t'));
const adaptedPaths = adapted.map(([file]) => file);

// Every tracked configuration file belongs to exactly one list: no file falls through.
const tracked = spawnSync('find', ['config', 'applications', 'zsh', '-type', 'f'],
    {cwd: root, encoding: 'utf8'}).stdout.trim().split('\n').map((p) => p.replace(/^\.\//, ''));
for (const file of tracked) {
    const inShared = shared.includes(file);
    const inAdapted = adaptedPaths.includes(file);
    assert.ok(inShared !== inAdapted, `${file} must be in exactly one of the two lists`);
}
for (const [file, reason] of adapted) {
    assert.ok(fs.existsSync(path.join(root, file)), `Adapted file is missing: ${file}`);
    assert.ok((reason || '').length > 20, `An adapted file needs a reason: ${file}`);
}

if (!fs.existsSync(archDir)) {
    console.log(`drift-smoke: skipped the comparison, no Arch checkout at ${archDir}`);
    console.log('drift-smoke: all checks passed');
    process.exit(0);
}

// Shared files match byte for byte; adapted files really differ, or they should be shared.
for (const file of shared) {
    assert.equal(read(file), fs.readFileSync(path.join(archDir, file), 'utf8'), `Drifted: ${file}`);
}
for (const [file] of adapted) {
    const upstream = path.join(archDir, file);
    if (!fs.existsSync(upstream)) continue;
    assert.notEqual(read(file), fs.readFileSync(upstream, 'utf8'),
        `${file} is identical upstream, so it belongs in shared-files.txt`);
}

const sync = (args, env = {}) => spawnSync('bash', [path.join(root, 'scripts/sync-from-arch.sh'), ...args],
    {encoding: 'utf8', timeout: 60000, env: {...process.env, ...env}});
const check = sync(['--check']);
assert.equal(check.status, 0, check.stdout + check.stderr);
assert.doesNotMatch(check.stdout, /^drifted/m, 'Nothing should be drifted right after creation');
assert.equal(sync(['--invalid']).status, 2);

// Without a checkout the tooling reports and succeeds: a fresh Debian machine is not blocked.
const nowhere = sync(['--check'], {ARCH_SETUP_DIR: path.join(os.tmpdir(), 'no-arch-checkout-here')});
assert.equal(nowhere.status, 0);
assert.match(nowhere.stdout, /nothing to compare/i);

// Drift is detected, and --pull repairs it.
{
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-drift-'));
    const copy = path.join(clone, 'repo');
    spawnSync('cp', ['-a', root, copy]);
    const victim = path.join(copy, 'config/kitty/kitty.conf');
    fs.appendFileSync(victim, '\n# local edit\n');
    spawnSync('git', ['-C', copy, 'commit', '-am', 'local edit'], {encoding: 'utf8'});
    const drifted = spawnSync('bash', [path.join(copy, 'scripts/sync-from-arch.sh'), '--check'],
        {encoding: 'utf8', timeout: 60000});
    assert.equal(drifted.status, 1, 'Drift must fail --check');
    assert.match(drifted.stdout, /^drifted\tconfig\/kitty\/kitty\.conf$/m);
    const pulled = spawnSync('bash', [path.join(copy, 'scripts/sync-from-arch.sh'), '--pull'],
        {encoding: 'utf8', timeout: 60000});
    assert.equal(pulled.status, 0, pulled.stdout + pulled.stderr);
    assert.equal(fs.readFileSync(victim, 'utf8'),
        fs.readFileSync(path.join(archDir, 'config/kitty/kitty.conf'), 'utf8'), '--pull restores the file');
    fs.rmSync(clone, {recursive: true, force: true});
}
console.log('drift-smoke: all checks passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/drift-smoke.js`
Expected: FAIL — `scripts/shared-files.txt` does not exist.

- [ ] **Step 3: Write the two lists**

```bash
cd ~/debian-desktop-setup
mkdir -p scripts
cat > scripts/adapted-files.txt <<'ADAPTED'
config/i3/config	The XDG autostart comment cites the freedesktop specification instead of the Arch wiki
config/i3/emoji.sh	Debian and Ubuntu do not package the Rofi emoji plugin, so the picker reports it instead of opening empty
zsh/zshrc	Debian installs the Zsh plugins under /usr/share/<plugin>/ rather than Arch's /usr/share/zsh/plugins/<plugin>/
ADAPTED
find config applications zsh -type f \
  | grep -v -x -e 'config/i3/config' -e 'config/i3/emoji.sh' -e 'zsh/zshrc' \
  | LC_ALL=C sort > scripts/shared-files.txt
wc -l scripts/shared-files.txt scripts/adapted-files.txt
```

- [ ] **Step 4: Write `scripts/sync-from-arch.sh`**

```bash
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/drift-smoke.js`
Expected: `drift-smoke: all checks passed`

- [ ] **Step 6: Commit**

```bash
cd ~/debian-desktop-setup
git add scripts tests/drift-smoke.js
git commit -m "Report configuration that has drifted from the Arch repository

Every configuration file is either shared byte for byte or listed as adapted
with a reason, and the test fails if a file is in neither list. sync-from-arch.sh
reports drift by default and pulls it back on request, refusing to overwrite
anything while the working tree is dirty."
```

---

### Task 7: The Zsh and Neovim setup scripts

**Files:**
- Create: `setup-zsh.sh`, `setup-nvim.sh`
- Modify: `packages/apt-map.tsv` (add the `editor-tools` group), `tests/apt-map-smoke.js` (accept the new group)
- Test: `tests/setup-smoke.js`

**Interfaces:**
- Consumes: `packages/apt-map.tsv` from Task 2, `zsh/zshrc` and `config/nvim` from Task 5.
- Produces: `setup-zsh.sh [--dry-run]` and `setup-nvim.sh [--dry-run]`, both callable from `install.sh` in Task 8. `setup-nvim.sh` reads `apt-cache policy neovim` and chooses apt or the upstream tarball at the 0.11 floor.

- [ ] **Step 1: Probe the editor tool names before writing them down**

Never add an unverified name to the map. Probe these in both images:

```bash
cd /tmp/claude-1000
printf '%s\n' nodejs npm golang ripgrep fd-find unzip lazygit fonts-jetbrains-mono \
    zsh-autosuggestions zsh-syntax-highlighting > editor-tools.txt
for img in debian:stable-slim ubuntu:latest; do
  echo "=== $img ==="
  docker run --rm -v "$PWD/editor-tools.txt:/list.txt:ro" "$img" sh -c '
    apt-get update -qq >/dev/null 2>&1
    while read -r p; do
      v=$(apt-cache policy "$p" 2>/dev/null | awk "/Candidate:/{print \$2; exit}")
      case "$v" in ""|"(none)") printf "MISSING %s\n" "$p" ;; *) printf "ok %s %s\n" "$p" "$v" ;; esac
    done < /list.txt'
done
```

Record the result. Any name reported MISSING is added with `where=none` and a
note naming its replacement — do not guess a different name without probing it.

- [ ] **Step 2: Write the failing test**

Create `tests/setup-smoke.js`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// Previews of the Zsh and Neovim scripts against stubs: nothing is installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-setup-smoke-'));
const bin = path.join(scratch, 'bin');
fs.mkdirSync(bin);
for (const [name, body] of [
    ['apt-get', '#!/bin/sh\nexit 0\n'],
    ['sudo', '#!/bin/sh\nexec "$@"\n'],
    ['chsh', '#!/bin/sh\nexit 0\n'],
    ['git', '#!/bin/sh\nexit 0\n'],
    // The version apt offers is what decides between apt and the upstream tarball.
    ['apt-cache', '#!/bin/sh\nprintf "  Candidate: %s\\n" "${STUB_NEOVIM:-0.11.6-1}"\n'],
]) fs.writeFileSync(path.join(bin, name), body, {mode: 0o755});

const preview = (script, stubNeovim) => {
    const result = spawnSync('bash', [path.join(root, script), '--dry-run'], {
        encoding: 'utf8', timeout: 30000, input: 'y\n'.repeat(40),
        env: {...process.env, HOME: scratch, PATH: `${bin}:${process.env.PATH}`, STUB_NEOVIM: stubNeovim || ''},
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
};

assert.equal(spawnSync('bash', [path.join(root, 'setup-zsh.sh'), '--invalid']).status, 2);
assert.equal(spawnSync('bash', [path.join(root, 'setup-nvim.sh'), '--invalid']).status, 2);

const zsh = preview('setup-zsh.sh');
assert.match(zsh, /apt-get install[^\n]*\bzsh\b/);
assert.match(zsh, /zsh-autosuggestions/);
assert.match(zsh, /ohmyzsh/, 'Oh My Zsh comes from its own repository');
assert.match(zsh, /chsh -s \/usr\/bin\/zsh|chsh -s \/bin\/zsh/);

// Ubuntu's 0.11.6 is new enough for apt; Debian's 0.10.4 must take the upstream tarball.
const modern = preview('setup-nvim.sh', '0.11.6-1');
assert.match(modern, /apt-get install[^\n]*\bneovim\b/);
assert.doesNotMatch(modern, /github\.com\/neovim/, 'No download when apt is new enough');
const old = preview('setup-nvim.sh', '0.10.4-8');
assert.match(old, /github\.com\/neovim\/neovim\/releases/, 'Fall back to the upstream tarball');
assert.doesNotMatch(old, /apt-get install[^\n]*\bneovim\b/, 'Do not install the too-old apt package');
assert.match(old, /0\.10\.4/, 'Say which version apt offered');
assert.match(old, /\.local\/opt/, 'The tarball goes to a user-owned prefix');

assert.deepEqual(fs.readdirSync(scratch), ['bin'], 'A preview must not create files');
fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-smoke: all checks passed');
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `node tests/setup-smoke.js`
Expected: FAIL — neither setup script exists.

- [ ] **Step 4: Add the `editor-tools` rows to the map**

Append to `packages/apt-map.tsv` (adjusting any row the Step 1 probe contradicts):

```
editor-tools	nodejs	nodejs	both	Mason language servers need Node
editor-tools	npm	npm	both	-
editor-tools	go	golang	both	Debian names the Go toolchain golang
editor-tools	ripgrep	ripgrep	both	-
editor-tools	fd	fd-find	both	Debian installs the binary as fdfind; the Neovim configuration falls back to ripgrep
editor-tools	unzip	unzip	both	-
editor-tools	ttf-jetbrains-mono-nerd	fonts-jetbrains-mono	both	Debian packages the plain family; the Nerd Font patch is not packaged and is installed by hand if wanted
```

Then widen the group set in `tests/apt-map-smoke.js`:

```js
const groups = new Set(['core-desktop', 'audio', 'input-emoji', 'browser-files', 'dev', 'shell', 'editor-tools']);
```

- [ ] **Step 5: Write `setup-zsh.sh`**

```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -Eeuo pipefail
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "$LINENO" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h) printf 'Usage: bash setup-zsh.sh [--dry-run]\n'; exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
(( EUID != 0 )) || { printf 'Run as your normal user, without sudo.\n' >&2; exit 1; }
ask() { local answer; read -r -p "$1 [y/N] " answer || return 1; [[ "$answer" == y || "$answer" == Y || "$answer" == yes ]]; }
run() { printf '  '; printf '%q ' "$@"; printf '\n'; if ! "$dry_run"; then "$@"; fi; }
if ask 'Install Zsh, Git, autosuggestions and syntax highlighting with apt?'; then
    run sudo apt-get install -y zsh git zsh-autosuggestions zsh-syntax-highlighting
fi
if [[ ! -e "$HOME/.oh-my-zsh" ]]; then
    if ask 'Download Oh My Zsh from its official repository?'; then
        run git clone --depth=1 https://github.com/ohmyzsh/ohmyzsh.git "$HOME/.oh-my-zsh"
    fi
fi
if ask 'Apply the bundled zshrc (your existing file is backed up first)?'; then
    if ! "$dry_run"; then
        command -v zsh >/dev/null || { printf 'Install Zsh first.\n' >&2; exit 1; }
        zsh -n "$bundle_dir/zsh/zshrc"
    fi
    if [[ -e "$HOME/.zshrc" || -L "$HOME/.zshrc" ]]; then
        run cp -a "$HOME/.zshrc" "$HOME/.zshrc.backup-$(date +%Y%m%d-%H%M%S)-$$"
        run unlink "$HOME/.zshrc"
    fi
    run install -m644 "$bundle_dir/zsh/zshrc" "$HOME/.zshrc"
    # Debian puts the plugins under /usr/share; the zshrc sources them from there.
    printf 'Plugins are sourced from /usr/share/zsh-autosuggestions and /usr/share/zsh-syntax-highlighting.\n'
fi
if ask 'Make /usr/bin/zsh your login shell?'; then
    run chsh -s /usr/bin/zsh
fi
printf 'Open Zsh now with: zsh\nLog out and back in after changing your login shell.\n'
```

The zshrc was already pointed at the Debian plugin paths in Task 5, so add this
to `tests/setup-smoke.js` to keep it that way:

```js
const zshrc = fs.readFileSync(path.join(root, 'zsh/zshrc'), 'utf8');
assert.match(zshrc, /\/usr\/share\/zsh-autosuggestions\/zsh-autosuggestions\.zsh/);
assert.match(zshrc, /\/usr\/share\/zsh-syntax-highlighting\/zsh-syntax-highlighting\.zsh/);
assert.doesNotMatch(zshrc, /\/usr\/share\/zsh\/plugins\//,
    "Arch's plugin layout would silently load nothing on Debian");
```

- [ ] **Step 6: Write `setup-nvim.sh`**

```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -Eeuo pipefail
trap 'printf "Setup stopped at line %s. Review the error above before retrying.\n" "$LINENO" >&2' ERR
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
case "${1:-}" in
    --dry-run) dry_run=true ;;
    --help|-h) printf 'Usage: bash setup-nvim.sh [--dry-run]\n'; exit 0 ;;
    '') ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac
(( EUID != 0 )) || { printf 'Run as your normal user, not root.\n' >&2; exit 1; }
ask() { local answer; read -r -p "$1 [y/N] " answer || return 1; [[ "$answer" == y || "$answer" == Y || "$answer" == yes ]]; }
run() { printf '  '; printf '%q ' "$@"; printf '\n'; if ! "$dry_run"; then "$@"; fi; }
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
# The editor tooling comes from the same map as everything else.
mapfile -t tools < <(awk -F'\t' '$1 == "editor-tools" && $3 != "-" { print $3 }' "$bundle_dir/packages/apt-map.tsv" | sort -u)
if ask 'Install the Neovim tooling (Node, Go, ripgrep, fd, fonts) with apt?'; then
    run sudo apt-get install -y "${tools[@]}" git build-essential php-cli composer curl unzip xclip
fi
# This configuration needs Neovim 0.11 or newer; Debian 13 ships 0.10.4.
candidate=$(apt-cache policy neovim 2>/dev/null | awk '/Candidate:/{print $2; exit}')
version=${candidate#*:}; version=${version%%-*}
major=${version%%.*}; rest=${version#*.}; minor=${rest%%.*}
new_enough=false
if [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] && (( major > 0 || minor >= 11 )); then
    new_enough=true
fi
if "$new_enough"; then
    printf 'apt offers Neovim %s, which this configuration supports.\n' "$version"
    if ask 'Install Neovim from apt?'; then run sudo apt-get install -y neovim; fi
else
    printf 'apt offers Neovim %s, older than the 0.11 this configuration needs.\n' "${version:-unknown}"
    if ask 'Install the upstream Neovim release into ~/.local/opt instead?'; then
        tarball="$HOME/.local/opt/nvim-linux-x86_64.tar.gz"
        run mkdir -p -- "$HOME/.local/opt" "$HOME/.local/bin"
        run curl -fsSLo "$tarball" https://github.com/neovim/neovim/releases/latest/download/nvim-linux-x86_64.tar.gz
        run tar -xzf "$tarball" -C "$HOME/.local/opt"
        run ln -sfn "$HOME/.local/opt/nvim-linux-x86_64/bin/nvim" "$HOME/.local/bin/nvim"
        printf 'Ensure ~/.local/bin precedes /usr/bin in PATH, or nvim will resolve to the apt version.\n'
    fi
fi
if ask 'Back up the current Neovim configuration and restore this bundle?'; then
    backup_root="${XDG_STATE_HOME:-$HOME/.local/state}/debian-desktop-setup/nvim-$(date +%Y%m%d-%H%M%S)-$$"
    if [[ -e "$config_root/nvim" || -L "$config_root/nvim" ]]; then
        run mkdir -p -- "$backup_root"
        run mv -- "$config_root/nvim" "$backup_root/nvim"
        printf 'Previous configuration retained at %s/nvim\n' "$backup_root"
    fi
    run mkdir -p -- "$config_root"
    run cp -a -- "$bundle_dir/config/nvim" "$config_root/nvim"
fi
if ask 'Download the locked Neovim plugins?'; then
    run nvim --headless '+Lazy! restore' '+qa!'
fi
if ask 'Install the configured Mason language servers and formatters?'; then
    for tool in node npm php composer go; do
        if ! "$dry_run" && ! command -v "$tool" >/dev/null; then
            printf 'Missing %s; rerun and accept the tooling step first.\n' "$tool" >&2
            exit 1
        fi
    done
    run nvim --headless '+MasonToolsInstallSync' '+qa!'
fi
printf '\nRestart Neovim after tool installation. Leader is Space; Space + ? searches keymaps.\n'
printf 'Rust tooling and the Laravel language server are installed in a later phase.\n'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node tests/setup-smoke.js && node tests/apt-map-smoke.js && node tests/readme-smoke.js`
Expected: three `all checks passed` lines. If `readme-smoke` fails, the new
`editor-tools` rows are not in the catalogue yet — regenerate it with the Step 4
command block from Task 4.

- [ ] **Step 8: Commit**

```bash
cd ~/debian-desktop-setup
git add setup-zsh.sh setup-nvim.sh packages/apt-map.tsv README.md tests/setup-smoke.js tests/apt-map-smoke.js
git commit -m "Add the Zsh and Neovim setup scripts

The editor tooling is listed in the same package map as everything else, so it
is documented and version-checked like the rest. Neovim has a 0.11 floor: apt is
used where it is new enough, as on Ubuntu 26.04, and the upstream tarball goes
into ~/.local/opt on Debian 13, which ships 0.10.4."
```

---

### Task 8: Services, the closing summary and the finished README

**Files:**
- Modify: `install.sh` (append), `README.md` (keyboard table and first-login notes)
- Test: `tests/install-smoke.js` (append)

**Interfaces:**
- Consumes: `$packages`, `$family`, `$backup_dir`, `ask`, `run` from Tasks 3–5; `setup-zsh.sh` and `setup-nvim.sh` from Task 7.
- Produces: the finished installer.

- [ ] **Step 1: Write the failing test**

Append to `tests/install-smoke.js`, before the cleanup:

```js
// Services, delegation and the closing summary, against stubs.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-services-smoke-'));
    const stubs = path.join(home, 'bin');
    fs.mkdirSync(stubs);
    const log = path.join(home, 'calls');
    for (const name of ['apt-get', 'systemctl', 'gsettings', 'mkcert', 'xdg-mime', 'i3', 'nvim', 'chsh', 'git']) {
        fs.writeFileSync(path.join(stubs, name), `#!/bin/sh\necho "${name} $*" >> ${log}\nexit 0\n`, {mode: 0o755});
    }
    fs.writeFileSync(path.join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    const result = spawnSync('bash', [path.join(root, 'install.sh')], {
        encoding: 'utf8', timeout: 120000, input: 'y\n'.repeat(120),
        env: {...env(debian), HOME: home, PATH: `${stubs}:${process.env.PATH}`},
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(log, 'utf8');
    for (const unit of ['NetworkManager.service', 'bluetooth.service', 'fstrim.timer']) {
        assert.match(calls, new RegExp(`systemctl enable --now ${unit.replace('.', '\\.')}`), `Missing unit: ${unit}`);
    }
    assert.match(calls, /systemctl --user enable --now pipewire\.socket/);
    assert.match(calls, /gsettings set org\.gnome\.desktop\.interface color-scheme prefer-dark/);
    // The summary has to name the backup directory: it is the only way back.
    assert.match(result.stdout, /Backups, when needed: .*\.local\/state\/debian-desktop-setup/);
    assert.match(result.stdout, /Alt\+D/, 'Tell the user how to open the launcher');
    fs.rmSync(home, {recursive: true, force: true});
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node tests/install-smoke.js`
Expected: FAIL — no `systemctl` call is made.

- [ ] **Step 3: Append the services, delegation and summary to `install.sh`**

```bash
if ask 'Set the dark appearance preference in your current desktop session?'; then
    if command -v gsettings >/dev/null; then
        run gsettings set org.gnome.desktop.interface color-scheme prefer-dark
    else
        printf 'Install gsettings-desktop-schemas and rerun to set the desktop preference.\n'
    fi
fi
# Run as the desktop user: sudo would create the CA in root's home, unseen by your browsers.
printf '\nmkcert creates a local certificate authority trusted by this system and your browsers.\n'
printf 'Keep rootCA-key.pem private: anyone with it can issue certificates this machine trusts.\n'
if ask 'Create and trust the mkcert local CA for HTTPS development (mkcert -install)?'; then
    if ! "$dry_run" && ! command -v mkcert >/dev/null; then
        printf 'mkcert is not installed. Accept the development group, then rerun this step.\n' >&2
    else
        run mkcert -install
    fi
fi
for service in NetworkManager.service bluetooth.service fstrim.timer; do
    if ask "Enable and start $service?"; then run sudo systemctl enable --now "$service"; fi
done
if ask 'Start and enable the PipeWire sockets and WirePlumber for this user?'; then
    run systemctl --user enable --now pipewire.socket pipewire-pulse.socket wireplumber.service
fi
if ask 'Set up Zsh, Oh My Zsh, autosuggestions and syntax highlighting?'; then
    if "$dry_run"; then bash "$bundle_dir/setup-zsh.sh" --dry-run; else bash "$bundle_dir/setup-zsh.sh"; fi
fi
if ask 'Restore Neovim and its plugins?'; then
    if "$dry_run"; then bash "$bundle_dir/setup-nvim.sh" --dry-run; else bash "$bundle_dir/setup-nvim.sh"; fi
fi
printf '\nFinished. Backups, when needed: %s\n' "$backup_dir"
printf 'Log out and log in to apply startup programs. Alt+D: Rofi launcher; Alt+Shift+S: screenshot.\n'
printf 'Keyboard: English (US) + Arabic. Shift+Caps Lock switches layouts after login.\n'
printf 'No login manager is installed in this phase: use the one you have, or startx with the bundled xinit.\n'
printf 'Sway, third-party applications and system extras arrive in later phases.\n'
```

- [ ] **Step 4: Finish the README**

Add before `## Backups and undo`:

```markdown
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
```

- [ ] **Step 5: Run the whole suite**

Run:

```bash
cd ~/debian-desktop-setup
for t in tests/*.js; do printf '%-34s' "$t"; node "$t" >/dev/null 2>&1 && echo OK || { echo FAIL; node "$t" 2>&1 | tail -6; }; done
DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/apt-names-smoke.js
```

Expected: every fast test OK, and the container test resolving every name in
both images. `ls` may be aliased to `colorls` on this machine — use the glob
above rather than piping `ls` into a loop.

- [ ] **Step 6: Commit**

```bash
cd ~/debian-desktop-setup
git add install.sh README.md tests/install-smoke.js
git commit -m "Enable the desktop services and finish the phase 1 README

Services, the mkcert CA and the Zsh and Neovim scripts are all offered
individually, and the closing summary names the backup directory and the keys
needed to get around. The README documents the keyboard, the services and the
fact that no login manager is installed in this phase."
```

---

## Where this plan departs from the spec

- The spec's test table lists three test files; this plan has six. Documentation
  assertions (`readme-smoke.js`), map well-formedness (`apt-map-smoke.js`) and the
  setup scripts (`setup-smoke.js`) each get their own file rather than being
  bolted onto a test with a different responsibility.
- The spec named two adapted configuration files; there are three. `zsh/zshrc`
  joins them because Debian's Zsh plugin paths differ from Arch's and the
  existing `[[ -r ]]` guard would hide the mismatch.
- The map gains a seventh group, `editor-tools`, so the Neovim tooling is
  documented and verified like every other package instead of living as a
  hand-written list inside `setup-nvim.sh`.

## Verification before calling phase 1 done

- [ ] `for t in tests/*.js; do node "$t" || break; done` — all five pass.
- [ ] `DEBIAN_SETUP_CONTAINER_TESTS=1 node tests/apt-names-smoke.js` — both images resolve every mapped name and simulate the install.
- [ ] `bash install.sh --dry-run` on this Arch machine with `DEBIAN_SETUP_OS_RELEASE` pointing at a Debian and an Ubuntu file — both previews complete and differ only where the map says they should.
- [ ] `bash scripts/sync-from-arch.sh --check` — zero drift.
- [ ] `assets/logo.png` present, or noted as awaiting the image Ahmed generates from `assets/LOGO.md`.
- [ ] `git log --oneline` — eight commits, each authored `AhmedAnbar`, no co-author trailers.

The root-user guard is verified by reading `install.sh`, not by execution: the
test suite must never run as root, so no test exercises that branch.

What phase 1 cannot show, and must not claim: that i3 actually starts, that the
fonts render, or that the keybindings work. Those need a real Debian or Ubuntu
machine, and are confirmed there before the README claims them.
