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
