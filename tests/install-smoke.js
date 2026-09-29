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

fs.rmSync(scratch, {recursive: true, force: true});
console.log('install-smoke: all checks passed');
