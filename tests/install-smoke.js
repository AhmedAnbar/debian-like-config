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

// A fatal failure must point at the line that ran the command, not at run()'s own body.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-errline-smoke-'));
    const stubs = path.join(home, 'bin');
    fs.mkdirSync(stubs);
    fs.writeFileSync(path.join(stubs, 'apt-get'), '#!/bin/sh\necho "apt-get: index unreachable" >&2\nexit 1\n', {mode: 0o755});
    fs.writeFileSync(path.join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    const source = fs.readFileSync(path.join(root, 'install.sh'), 'utf8').split('\n');
    const callSite = source.findIndex((line) => line.includes('run sudo apt-get update')) + 1;
    const insideRun = source.findIndex((line) => line.trim().startsWith('if ! "$dry_run"; then "$@"')) + 1;
    assert.ok(callSite > 0 && insideRun > 0, 'Both lines must be findable');
    const result = spawnSync('bash', [path.join(root, 'install.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(10),
        env: {...env(debian), HOME: home, PATH: `${stubs}:${process.env.PATH}`},
    });
    assert.match(result.stderr, new RegExp(`line ${callSite}\\b`), 'Name the failing call site');
    assert.doesNotMatch(result.stderr, new RegExp(`line ${insideRun}\\b`), 'run() is not the culprit');
    fs.rmSync(home, {recursive: true, force: true});
}

// Every group in the map is offered. A hardcoded list in install.sh drops new groups silently.
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
    assert.match(result.stdout, /cowsay/, 'A group present in the map must be offered');
    fs.rmSync(home, {recursive: true, force: true});
}

fs.rmSync(scratch, {recursive: true, force: true});
console.log('install-smoke: all checks passed');
