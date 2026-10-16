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
    // No delegates unless a block asks for them: the real ones are interactive
    // installers that reach vendor hosts, and one of them scps from another machine.
    // An empty list means none, which is why install.sh reads it with - and not :- .
    DEBIAN_SETUP_DELEGATES: '',
});
const install = (args, file, answers = 'n\n'.repeat(60)) =>
    spawnSync('bash', [path.join(root, 'install.sh'), ...args],
        {encoding: 'utf8', timeout: 30000, input: answers, env: env(file)});

const debian = osRelease('ID=debian\nVERSION_CODENAME=trixie\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const ubuntu = osRelease('ID=ubuntu\nVERSION_CODENAME=resolute\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n', 'ubuntu');
// Kali's own os-release: ID=kali with ID_LIKE=debian, which is how detect_release
// reaches the Debian side of every version decision while staying Kali for the
// package names and the messages.
const kali = osRelease('ID=kali\nID_LIKE=debian\nVERSION_CODENAME=kali-rolling\nPRETTY_NAME="Kali GNU/Linux Rolling"\n', 'kali');

// Arguments.
assert.equal(install(['--invalid'], debian).status, 2, 'An unknown argument is a usage error');
assert.equal(install(['--help'], debian).status, 0);

// An unknown or unreadable distribution must explain itself, never crash.
const fedora = install(['--dry-run'], osRelease('ID=fedora\nID_LIKE=rhel\n', 'fedora'));
assert.equal(fedora.status, 1);
assert.match(fedora.stderr, /Debian/);
assert.match(fedora.stderr, /Ubuntu/);
assert.match(fedora.stderr, /Kali/, 'Everything the installer supports is named where it refuses');
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
    ['bin', 'debian', 'fedora', 'idless', 'kali', 'mint', 'ubuntu'], 'A preview must not create files');

// Package groups come from the map, and the map's gaps must be visible.
const accept = 'y\n'.repeat(60);
const debianPreview = install(['--dry-run'], debian, accept);
assert.equal(debianPreview.status, 0, debianPreview.stderr);
const ubuntuPreview = install(['--dry-run'], ubuntu, accept);
assert.equal(ubuntuPreview.status, 0, ubuntuPreview.stderr);
const selected = (result) => result.stdout.split('\n').find((line) => line.startsWith('Selected packages:'));

// Each release gets the browser it actually has: Debian the ESR package, Ubuntu the
// apt package whose job is to install the Firefox snap. Neither gets the other's.
assert.match(selected(debianPreview), /\bfirefox-esr\b/);
assert.doesNotMatch(selected(debianPreview), /\bfirefox(?!-esr)\b/, 'Debian has no apt firefox');
assert.match(selected(ubuntuPreview), /\bfirefox\b/, 'Ubuntu installs Firefox through its snap-installing apt package');
assert.doesNotMatch(selected(ubuntuPreview), /\bfirefox-esr\b/, 'Ubuntu has no firefox-esr');
// Kali is Debian's archive under another name, with two packages it does not carry.
// detect_release keeps it on the Debian side of every version decision -- the vendor
// suites and repository paths are Debian's, proved against kali-rolling in a container
// -- while the map's kali rows replace the two names kali-rolling has no candidate for.
{
    const kaliPreview = install(['--dry-run'], kali, accept);
    assert.equal(kaliPreview.status, 0, kaliPreview.stderr);
    assert.match(kaliPreview.stdout, /\(Kali family\)/, 'Kali is named as itself, not as Debian');
    assert.match(selected(kaliPreview), /\bnetwork-manager-applet\b/,
        'Kali carries the applet under its own name');
    assert.doesNotMatch(selected(kaliPreview), /\bnetwork-manager-gnome\b/,
        'and not under the Debian name, which has no candidate in kali-rolling');
    assert.match(kaliPreview.stdout, /Not packaged on Kali:[^\n]*github-cli/,
        'gh is in no Kali component, so it is named as missing instead of failing the whole install');
    assert.doesNotMatch(selected(kaliPreview), /\bgh\b/, 'and never selected');
    // And the parent is untouched by rows written for the derivative.
    assert.match(selected(debianPreview), /\bnetwork-manager-gnome\b/, 'Debian keeps its own name');
    assert.match(selected(debianPreview), /\bgh\b/, 'and its own GitHub CLI');
    assert.doesNotMatch(debianPreview.stdout, /Skipped on Debian:[^\n]*network-manager-applet/,
        'A row written for a derivative must not surface as a skip on the parent');
}

// snapd goes on both: Ubuntu needs it for the browser, Debian for phase 3.
for (const preview of [debianPreview, ubuntuPreview]) {
    assert.match(selected(preview), /\bsnapd\b/, 'snapd is offered on both releases');
}
assert.match(ubuntuPreview.stdout, /Skipped on Ubuntu:[^\n]*firefox-esr/);
assert.match(ubuntuPreview.stdout, /Skipped on Ubuntu:[^\n]*Debian ships the ESR package/,
    'The skipped line must say why, and the reason is no longer a Mozilla repository');

// where=none rows are reported, never installed, and never leak the - placeholder.
for (const preview of [debianPreview, ubuntuPreview]) {
    assert.match(preview.stdout, /Not packaged on \w+:[^\n]*rofi-emoji/);
    assert.match(preview.stdout, /Not packaged on \w+:[^\n]*\buv\b/);
    assert.doesNotMatch(selected(preview), /(^|\s)-(\s|$)/, 'The - placeholder must never reach apt');
    // bluez appears twice in the map (bluez and bluez-utils both map to it).
    assert.equal(selected(preview).match(/\bbluez\b/g).length, 1, 'Duplicate apt names are collapsed');
    assert.match(preview.stdout, /sudo apt-get update/);
    assert.match(preview.stdout, /sudo env DEBIAN_FRONTEND=noninteractive apt-get install/);
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

// Configuration installation, for real, inside a scratch HOME.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-config-smoke-'));
    const outside = path.join(home, 'dotfiles-i3-config');
    fs.writeFileSync(outside, 'original i3 config\n');
    fs.mkdirSync(path.join(home, '.config', 'i3'), {recursive: true});
    // A dotfiles checkout is usually symlinked into place: replace the link, not its target.
    // Relative, as a dotfiles checkout links it: a backup that copies the link is dead.
    fs.symlinkSync(path.relative(path.join(home, '.config', 'i3'), outside),
        path.join(home, '.config', 'i3', 'config'));
    // Stub every system tool the installer can reach: a real run must never touch
    // this machine's services or trust store just because a later step exists.
    const homeBin = path.join(home, 'bin');
    fs.mkdirSync(homeBin);
    for (const name of ['apt-get', 'systemctl', 'gsettings', 'mkcert', 'xdg-mime', 'i3', 'nvim', 'chsh', 'git']) {
        fs.writeFileSync(path.join(homeBin, name), '#!/bin/sh\nexit 0\n', {mode: 0o755});
    }
    // Same reason as the delegation block below: no step here may reach the network.
    for (const [name, body] of [['curl', 'exit 1'], ['apt-cache', 'printf "  Candidate: 0.11.6-1\\n"']]) {
        fs.writeFileSync(path.join(homeBin, name), `#!/bin/sh\n${body}\n`, {mode: 0o755});
    }
    fs.writeFileSync(path.join(homeBin, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    const real = spawnSync('bash', [path.join(root, 'install.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(80),
        env: {...env(debian), HOME: home, PATH: `${homeBin}:${process.env.PATH}`},
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
    const backupCopy = path.join(home, '.local/state/debian-desktop-setup', backups[0], 'i3/config');
    assert.ok(!fs.lstatSync(backupCopy).isSymbolicLink(),
        'A copied symlink is not a backup: the relative target no longer resolves from there');
    assert.equal(fs.readFileSync(backupCopy, 'utf8'), 'original i3 config\n', 'The original is recoverable');
    // The Sway session is an optional addition, and declining it has to cost nothing:
    // its dotfiles belong to setup-sway.sh. The portal preference especially — the X11
    // session reads that file too, and nobody asked for Wayland here.
    for (const directory of ['sway', 'waybar', 'mako', 'swaylock', 'xdg-desktop-portal']) {
        assert.ok(!fs.existsSync(path.join(home, '.config', directory)),
            `install.sh must leave ${directory}/ to setup-sway.sh`);
    }
    // What it does own is still installed, including the helpers both sessions share.
    for (const relative of ['i3/config', 'i3/brightness.sh', 'i3/emoji.sh', 'rofi/i3-theme.rasi']) {
        assert.ok(fs.existsSync(path.join(home, '.config', relative)), `Missing: ${relative}`);
    }
    // The i3 configuration this installer writes autostarts the conky panel, so the
    // panel's own scripts have to be installed and executable even for a user who
    // never runs setup-conky.sh — they are a no-op until conky itself is there.
    for (const relative of ['conky/start.sh', 'conky/switch.sh']) {
        const target = path.join(home, '.config', relative);
        assert.ok(fs.existsSync(target), `Missing: ${relative}`);
        assert.equal(fs.statSync(target).mode & 0o777, 0o755, `${relative} must be executable`);
    }
    fs.rmSync(home, {recursive: true, force: true});
}

// The emoji picker has its own test file, tests/emoji-smoke.js: it is no longer a
// probe for a Rofi plugin but a picker reading unicode-data, with five scenarios.

// install.sh offers the six groups it owns and no others: a group belonging to
// another script must not appear, and the list comes from the label table rather
// than from a filter that has to be edited every time a phase adds a group.
{
    const groupHome = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-owned-smoke-'));
    const map = path.join(groupHome, 'map.tsv');
    const rows = fs.readFileSync(path.join(root, 'packages/apt-map.tsv'), 'utf8').trim();
    fs.writeFileSync(map, rows + '\n' +
        ['invented', 'nothing-of-ours', 'cowsay', 'both',
            'A group no script in this repository owns, to prove the installer does not offer it'
        ].join('\t') + '\n');
    const result = spawnSync('bash', [path.join(root, 'install.sh'), '--dry-run'], {
        encoding: 'utf8', timeout: 60000, input: 'n\n'.repeat(80),
        env: {...env(debian), DEBIAN_SETUP_MAP: map},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /cowsay/,
        'A map group this installer does not own must not be offered by it');
    assert.doesNotMatch(result.stdout, /Additional packages/,
        'The fallback label means a group slipped through the ownership table');
    for (const label of ['Core i3 desktop', 'PipeWire audio', 'Browser and file utilities']) {
        assert.ok(result.stdout.includes(label), `Still offers: ${label}`);
    }
    fs.rmSync(groupHome, {recursive: true, force: true});
}

// A failing shared update still stops the run, but names the third-party sources
// files this repository added: after phase 3 a vendor outage can block a re-run of
// a previously working installer, and that is the one fact the user needs.
{
    const failHome = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-update-smoke-'));
    const stubs = path.join(failHome, 'bin');
    fs.mkdirSync(stubs);
    fs.writeFileSync(path.join(stubs, 'apt-get'), '#!/bin/sh\n[ "$1" = update ] && exit 100\nexit 0\n', {mode: 0o755});
    fs.writeFileSync(path.join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    const aptRoot = path.join(failHome, 'root');
    fs.mkdirSync(path.join(aptRoot, 'etc/apt/sources.list.d'), {recursive: true});
    fs.writeFileSync(path.join(aptRoot, 'etc/apt/sources.list.d/google-chrome.list'),
        'deb https://dl.google.com/linux/chrome/deb/ stable main\n');
    const result = spawnSync('bash', [path.join(root, 'install.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(80),
        env: {...env(debian), HOME: failHome, PATH: `${stubs}:${process.env.PATH}`,
            DEBIAN_SETUP_ETC_ROOT: aptRoot},
    });
    assert.notEqual(result.status, 0, 'A failed update must still stop the run');
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /google-chrome\.list/,
        'Name the third-party sources file that can be the cause');
    fs.rmSync(failHome, {recursive: true, force: true});
}

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
    // This run delegates to setup-nvim.sh, which downloads a tarball when apt's Neovim
    // is too old — and apt-cache answers nothing on a machine without apt. A test that
    // reaches the network passes or fails with the network, so curl here is a stub that
    // refuses, and the version apt offers is stubbed too.
    fs.writeFileSync(path.join(stubs, 'curl'), `#!/bin/sh\necho "curl $*" >> ${log}\nexit 1\n`, {mode: 0o755});
    fs.writeFileSync(path.join(stubs, 'apt-cache'), '#!/bin/sh\nprintf "  Candidate: 0.11.6-1\\n"\n', {mode: 0o755});
    const result = spawnSync('bash', [path.join(root, 'install.sh')], {
        encoding: 'utf8', timeout: 120000, input: 'y\n'.repeat(120),
        env: {...env(debian), HOME: home, PATH: `${stubs}:${process.env.PATH}`},
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(log, 'utf8');
    for (const unit of ['NetworkManager.service', 'bluetooth.service', 'fstrim.timer', 'snapd.socket']) {
        assert.match(calls, new RegExp(`systemctl enable --now ${unit.replace('.', '\\.')}`), `Missing unit: ${unit}`);
    }
    assert.match(calls, /systemctl --user enable --now pipewire\.socket/);
    assert.match(calls, /gsettings set org\.gnome\.desktop\.interface color-scheme prefer-dark/);
    // The summary has to name the backup directory: it is the only way back.
    assert.match(result.stdout, /Backups, when needed: .*\.local\/state\/debian-desktop-setup/);
    assert.match(result.stdout, /Alt\+D/, 'Tell the user how to open the launcher');
    assert.doesNotMatch(calls, /^curl /m, 'Nothing in this suite may depend on a network');
    assert.match(calls, /apt-get install -y neovim/, 'Apt is new enough here, so no tarball');
    fs.rmSync(home, {recursive: true, force: true});
}

// Declining a replacement must leave the file alone — including the executable scripts,
// which a second installation pass used to overwrite with no prompt and no backup.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-decline-smoke-'));
    const stubs = path.join(home, 'bin');
    fs.mkdirSync(stubs);
    for (const name of ['apt-get', 'systemctl', 'gsettings', 'mkcert', 'xdg-mime', 'i3', 'nvim', 'chsh', 'git']) {
        fs.writeFileSync(path.join(stubs, name), '#!/bin/sh\nexit 0\n', {mode: 0o755});
    }
    fs.writeFileSync(path.join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    const mine = path.join(home, '.config', 'i3', 'brightness.sh');
    fs.mkdirSync(path.dirname(mine), {recursive: true});
    fs.writeFileSync(mine, '#!/bin/sh\n# my own brightness script\n', {mode: 0o755});
    const custom = path.join(home, '.local/share/applications/retext-preview.desktop');
    fs.mkdirSync(path.dirname(custom), {recursive: true});
    fs.writeFileSync(custom, '[Desktop Entry]\nName=My ReText\n');
    // Decline the six package groups, accept the configuration bundle, then decline
    // every replacement it offers.
    const answers = ['n', 'n', 'n', 'n', 'n', 'n', 'y'].concat(Array(60).fill('n')).join('\n') + '\n';
    const result = spawnSync('bash', [path.join(root, 'install.sh')], {
        encoding: 'utf8', timeout: 60000, input: answers,
        env: {...env(debian), HOME: home, PATH: `${stubs}:${process.env.PATH}`},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(mine, 'utf8'), '#!/bin/sh\n# my own brightness script\n',
        'A declined script must not be overwritten by a second installation pass');
    assert.equal(fs.readFileSync(custom, 'utf8'), '[Desktop Entry]\nName=My ReText\n',
        'The desktop entry must go through the same consent and backup path');
    fs.rmSync(home, {recursive: true, force: true});
}

// A failing optional step must not take the rest of the installation, or the closing
// summary, down with it: the backup path is the only way back and it prints there.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-failstep-smoke-'));
    const stubs = path.join(home, 'bin');
    fs.mkdirSync(stubs);
    for (const name of ['apt-get', 'gsettings', 'mkcert', 'xdg-mime', 'i3', 'nvim', 'chsh', 'git']) {
        fs.writeFileSync(path.join(stubs, name), '#!/bin/sh\nexit 0\n', {mode: 0o755});
    }
    // Same reason as the delegation block below: no step here may reach the network.
    for (const [name, body] of [['curl', 'exit 1'], ['apt-cache', 'printf "  Candidate: 0.11.6-1\\n"']]) {
        fs.writeFileSync(path.join(stubs, name), `#!/bin/sh\n${body}\n`, {mode: 0o755});
    }
    fs.writeFileSync(path.join(stubs, 'systemctl'), '#!/bin/sh\necho "systemctl: unit failed" >&2\nexit 1\n', {mode: 0o755});
    fs.writeFileSync(path.join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    const result = spawnSync('bash', [path.join(root, 'install.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(120),
        env: {...env(debian), HOME: home, PATH: `${stubs}:${process.env.PATH}`},
    });
    assert.match(result.stdout, /Backups, when needed: .*\.local\/state\/debian-desktop-setup/,
        'The summary must print even after a step failed');
    assert.match(result.stdout, /Steps that failed:[\s\S]*systemctl/,
        'A failed step must be named, not swallowed');
    assert.notEqual(result.status, 0, 'Report a non-zero status when a step failed');
    assert.ok(fs.existsSync(path.join(home, '.config', 'i3', 'config')),
        'A failed service step must not prevent the configuration from being installed');
    fs.rmSync(home, {recursive: true, force: true});
}

// A run that stops between installing the EXIT trap and the end must still print a
// usable summary. The trap names the delegates that were not run, so that array has to
// exist before the trap does -- otherwise an unreadable map dies inside the trap itself
// under set -u, and the unbound variable is the last thing the user sees instead of the
// reason the run stopped.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-earlyexit-smoke-'));
    const result = spawnSync('bash', [path.join(root, 'install.sh'), '--dry-run'], {
        encoding: 'utf8', timeout: 30000, input: 'n\n'.repeat(10),
        env: {...env(debian), HOME: home, DEBIAN_SETUP_MAP: path.join(home, 'absent.tsv')},
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /Missing package map/, 'The real cause is named');
    assert.doesNotMatch(output, /unbound variable/,
        'And the summary must not fail in the middle of explaining it');
    assert.match(output, /Backups, when needed:/, 'The summary is complete');
    fs.rmSync(home, {recursive: true, force: true});
}

// A fatal failure must point at the line that ran the command, not at run()'s own
// body. install.sh's only unguarded fatal run is now inside an if condition, where
// bash exempts the failure from the ERR trap, so the property is pinned directly:
// install.sh's own trap line, the library's own run(), and a call site this test
// controls — which cannot be fooled by two files happening to agree on a number.
{
    const errHome = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-errline-smoke-'));
    const trap = fs.readFileSync(path.join(root, 'install.sh'), 'utf8')
        .split('\n').find((line) => line.startsWith('trap ') && line.includes('ERR'));
    assert.ok(trap, "install.sh must install an ERR trap for this test to pin");
    const probe = [
        'set -Eeuo pipefail',
        trap,
        'dry_run=false; target_config=$HOME/.config; backup_dir=$HOME/backup',
        `source ${path.join(root, 'lib/common.sh')}`,
        'run false',            // line 5: the call site the trap must name
    ].join('\n');
    const script = path.join(errHome, 'probe.sh');
    fs.writeFileSync(script, probe + '\n');
    const result = spawnSync('bash', [script], {encoding: 'utf8', timeout: 20000,
        env: {...process.env, HOME: errHome}});
    assert.notEqual(result.status, 0, 'A failing run must be fatal under set -e');
    const reported = [...new Set([...result.stderr.matchAll(/line (\d+)/g)].map((m) => Number(m[1])))];
    assert.deepEqual(reported, [5],
        `The trap must name the call site, not run()'s body in the library, got ${reported}`);
    fs.rmSync(errHome, {recursive: true, force: true});
}

// And a failure at the top level, where there is no run() between the command and the
// trap, must name its own line too. ${BASH_LINENO[0]} is the string "0" there, not
// empty, so a :-$LINENO default never substitutes and every one of these scripts used
// to report "stopped at line 0" for exactly the failures a user most needs to locate:
// bare command substitutions like machine=$(uname -m).
{
    const errHome = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-errline-top-'));
    const trap = fs.readFileSync(path.join(root, 'install.sh'), 'utf8')
        .split('\n').find((line) => line.startsWith('trap ') && line.includes('ERR'));
    const probe = [
        'set -Eeuo pipefail',
        trap,
        'printf "before\\n"',
        'value=$(false)',       // line 4: a bare command substitution, no run() involved
        'printf "after\\n"',
    ].join('\n');
    const script = path.join(errHome, 'probe.sh');
    fs.writeFileSync(script, probe + '\n');
    const result = spawnSync('bash', [script], {encoding: 'utf8', timeout: 20000,
        env: {...process.env, HOME: errHome}});
    assert.notEqual(result.status, 0, 'The failure is still fatal');
    const reported = [...new Set([...result.stderr.matchAll(/line (\d+)/g)].map((m) => Number(m[1])))];
    assert.deepEqual(reported, [4],
        `A top-level failure must name its own line, never 0, got ${reported}`);
    fs.rmSync(errHome, {recursive: true, force: true});
}

// A group this installer does not own is not installed here -- but it is not dropped
// in silence either. Phase 1 asserted that every map group is offered, which was the
// old mechanism talking; what matters to a user is that nothing in the map vanishes
// without being named, so that is what this pins now.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-groups-smoke-'));
    const mapText = fs.readFileSync(path.join(root, 'packages/apt-map.tsv'), 'utf8').trimEnd();
    const extended = path.join(home, 'apt-map.tsv');
    fs.writeFileSync(extended, `${mapText}\nextras\tcowsay\tcowsay\tboth\ta group added by the test to prove the offer is derived\n`);
    const result = spawnSync('bash', [path.join(root, 'install.sh'), '--dry-run'], {
        encoding: 'utf8', timeout: 30000, input: 'n\n'.repeat(60),
        env: {...env(debian), HOME: home, DEBIAN_SETUP_MAP: extended},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installed by their own scripts, not here:[^\n]*\bextras\b/,
        'An unowned group must be named, not silently skipped');
    assert.doesNotMatch(result.stdout, /cowsay/,
        'Naming the group is not the same as offering its packages here');
    for (const owned of ['editor-tools', 'sway']) {
        assert.match(result.stdout, new RegExp(`Installed by their own scripts[^\n]*\\b${owned}\\b`),
            `${owned} belongs to its own script and must be named there`);
    }
    // Naming the group is only half the promise: a reader told that editor-tools lives
    // in its own script, and never told which, is no better off than before.
    for (const [group, command] of [['editor-tools', 'bash setup-nvim.sh'], ['sway', 'bash setup-sway.sh']]) {
        assert.ok(result.stdout.includes(command),
            `${group} is named, but ${command} is never printed, so there is nothing to run`);
    }
    fs.rmSync(home, {recursive: true, force: true});
}

// The phase 3 and 4 scripts are offered at the end of the run, each its own question,
// each declined by default, with --dry-run passed through. The eleven real ones are
// interactive installers that reach vendor hosts -- setup-tor-browser.sh would scp from
// another machine -- so the mechanism is proved against fixture scripts, in a copy of
// the bundle: install.sh resolves a delegate against its own directory, and a test that
// wrote fixtures into the repository would leave them there if it were interrupted.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-delegate-smoke-'));
    const bundle = path.join(home, 'bundle');
    fs.mkdirSync(bundle);
    for (const part of ['install.sh', 'lib', 'packages', 'config', 'applications', 'zsh', 'profiles']) {
        fs.cpSync(path.join(root, part), path.join(bundle, part), {recursive: true});
    }
    const stubs = path.join(home, 'bin');
    fs.mkdirSync(stubs);
    const log = path.join(home, 'calls');
    for (const name of ['apt-get', 'systemctl', 'gsettings', 'mkcert', 'xdg-mime', 'i3', 'nvim',
        'chsh', 'git', 'curl', 'scp', 'ssh']) {
        fs.writeFileSync(path.join(stubs, name), `#!/bin/sh\necho "${name} $*" >> ${log}\nexit 0\n`,
            {mode: 0o755});
    }
    fs.writeFileSync(path.join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    fs.writeFileSync(path.join(stubs, 'apt-cache'), '#!/bin/sh\nprintf "  Candidate: 0.11.6-1\\n"\n',
        {mode: 0o755});
    // One fixture that records how it was called, one that fails the way a dead vendor
    // host does.
    fs.writeFileSync(path.join(bundle, 'setup-ok-fixture.sh'),
        `#!/usr/bin/env bash\necho "fixture-ok $*" >> ${log}\nprintf 'fixture ok\\n'\n`, {mode: 0o755});
    fs.writeFileSync(path.join(bundle, 'setup-fail-fixture.sh'),
        `#!/usr/bin/env bash\necho "fixture-fail $*" >> ${log}\nexit 1\n`, {mode: 0o755});
    const runInstaller = (args, answers, delegates) => spawnSync('bash',
        [path.join(bundle, 'install.sh'), ...args], {
            encoding: 'utf8', timeout: 90000, input: answers,
            env: {...env(debian), HOME: home, PATH: `${stubs}:${process.env.PATH}`,
                DEBIAN_SETUP_DELEGATES: delegates},
        });
    const fixtures = 'setup-ok-fixture.sh setup-fail-fixture.sh';

    // A preview names the command with the flag passed through, and runs nothing --
    // the same contract install.sh has kept for setup-zsh.sh since phase 1.
    const preview = runInstaller(['--dry-run'], 'y\n'.repeat(120), fixtures);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /bash \S*setup-ok-fixture\.sh --dry-run/,
        'A preview names the delegate with --dry-run passed through');
    assert.match(preview.stdout, /bash \S*setup-fail-fixture\.sh --dry-run/,
        'Every delegate is offered, not just the first');
    assert.equal(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', '',
        'And a preview runs none of them');

    // A real run executes each one, and a failure neither stops the next nor is lost.
    const real = runInstaller([], 'y\n'.repeat(120), fixtures);
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /^fixture-ok $/m, 'A real run executes the delegate, with no flag');
    assert.match(calls, /^fixture-fail $/m,
        'And keeps going after one fails, because they are independent of each other');
    assert.match(real.stdout, /Steps that failed:[\s\S]*setup-fail-fixture\.sh/,
        'The delegate that failed is named in the summary');
    assert.notEqual(real.status, 0, 'And the run reports failure to whatever called it');

    // Declining is free: the summary names the command, so nothing is lost by saying no.
    const declined = runInstaller(['--dry-run'], 'n\n'.repeat(120), fixtures);
    assert.equal(declined.status, 0, 'Declining everything is not a failure');
    assert.match(declined.stdout, /bash setup-ok-fixture\.sh/,
        'A declined delegate is named with the command that runs it later');

    // A delegate that is not in the bundle is reported, never silently skipped.
    const missing = runInstaller(['--dry-run'], 'y\n'.repeat(120), 'setup-not-here.sh');
    assert.match(missing.stdout + missing.stderr, /setup-not-here\.sh/,
        'A delegate that cannot be found is named');

    // An explicitly empty list offers nothing and says nothing about optional scripts,
    // rather than printing a heading with no questions under it.
    const none = runInstaller(['--dry-run'], 'n\n'.repeat(120), '');
    assert.equal(none.status, 0);
    assert.doesNotMatch(none.stdout, /These install one application or system feature each/,
        'An empty delegate list prints no heading');

    fs.rmSync(home, {recursive: true, force: true});
}

// The default list is the eleven real scripts, in order, with hardening last. Read from
// the default expansion itself, not from the file as a whole: every one of these names
// also appears in the prompt table, so a substring search over install.sh would stay
// green if a name were dropped from the list that actually runs.
{
    const body = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
    const expansion = body.match(/\$\{DEBIAN_SETUP_DELEGATES-([\s\S]*?)\}/);
    assert.ok(expansion, 'install.sh must carry a default delegate list');
    const defaults = expansion[1].replace(/\\\n/g, ' ').trim().split(/\s+/);
    assert.deepEqual(defaults, [
        'setup-chrome.sh', 'setup-dbeaver.sh', 'setup-onlyoffice.sh', 'setup-dropbox.sh',
        'setup-docker.sh', 'setup-postman.sh', 'setup-tor-browser.sh', 'setup-conky.sh',
        'setup-zram.sh', 'setup-snapshots.sh', 'setup-hardening.sh',
    ], 'Every phase 3 and 4 script is offered, and SSH hardening is offered last');
    for (const script of defaults) {
        assert.ok(fs.existsSync(path.join(root, script)), `${script} must exist to be offered`);
        assert.ok(new RegExp(`\\[${script.replace('.', '\\.')}\\]=`).test(body),
            `${script} must have a prompt of its own, not the generic fallback`);
    }
}

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
  echo 'error: cannot install "firefox": Post-refresh hook failed' >&2
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

fs.rmSync(scratch, {recursive: true, force: true});
console.log('install-smoke: all checks passed');
