// SPDX-License-Identifier: GPL-3.0-only
// install_tarball_app against a fixture archive. /opt is prefixed by
// DEBIAN_SETUP_OPT_ROOT so nothing outside a scratch directory is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const fixture = (home, {valid = true} = {}) => {
    const stage = path.join(home, 'stage', 'Postman');
    fs.mkdirSync(path.join(stage, 'app'), {recursive: true});
    fs.writeFileSync(path.join(stage, 'app', valid ? 'postman' : 'something-else'), '#!/bin/sh\n');
    const archive = path.join(home, 'postman.tar.gz');
    const tar = spawnSync('tar', ['-czf', archive, '-C', path.join(home, 'stage'), 'Postman'],
        {encoding: 'utf8'});
    assert.equal(tar.status, 0, tar.stderr);
    return archive;
};

const install = (home, archive, version, expect = 'Postman/app/postman') => {
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin, {recursive: true});
    fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    const desktop = path.join(home, 'Postman.desktop');
    fs.writeFileSync(desktop, '[Desktop Entry]\nName=Postman\nExec=/opt/postman/current/Postman\n');
    const probe = `
        dry_run=false; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        install_tarball_app postman ${archive} ${version} '${expect}' ${desktop}
        printf 'returned %s\\n' "$?"
        printf 'failed: %s\\n' "\${failed[*]:-none}"
    `;
    return spawnSync('bash', ['-c', probe], {encoding: 'utf8', timeout: 30000,
        env: {...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`,
            DEBIAN_SETUP_OPT_ROOT: path.join(home, 'opt'),
            DEBIAN_SETUP_SHARE_ROOT: path.join(home, 'share')}});
};

// The versioned directory, the current symlink, and the .desktop file whose
// basename Postman's own xdg-mime call depends on.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tarball-'));
    const result = install(home, fixture(home), '12.32.3');
    assert.match(result.stdout, /returned 0/, result.stdout + result.stderr);
    const app = path.join(home, 'opt/postman');
    assert.ok(fs.existsSync(path.join(app, '12.32.3/app/postman')),
        'The archive is unpacked into a versioned directory with its top level stripped');
    assert.equal(fs.readlinkSync(path.join(app, 'current')), '12.32.3',
        'current points at the version by a relative name, so moving /opt cannot break it');
    assert.ok(fs.existsSync(path.join(home, 'share/applications/Postman.desktop')),
        'The .desktop basename must survive exactly: xdg-mime default Postman.desktop');

    // An update leaves the previous version in place, so a bad one is a symlink away
    // from being undone.
    const second = install(home, fixture(home), '12.33.0');
    assert.match(second.stdout, /returned 0/, second.stdout + second.stderr);
    assert.ok(fs.existsSync(path.join(app, '12.32.3/app/postman')), 'The old version survives');
    assert.equal(fs.readlinkSync(path.join(app, 'current')), '12.33.0', 'current moves');
    fs.rmSync(home, {recursive: true, force: true});
}

// Postman publishes no checksum and no signature, so a clean listing containing the
// expected entry is the only integrity gate there is — and it must run before /opt
// is touched, not after.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tarball-wrong-'));
    const result = install(home, fixture(home, {valid: false}), '12.32.3');
    assert.doesNotMatch(result.stdout, /returned 0/, 'An archive without the expected entry is refused');
    assert.ok(!fs.existsSync(path.join(home, 'opt/postman')), '/opt must be untouched');
    assert.match(result.stdout, /failed: .*postman/, 'The refusal is recorded');
    fs.rmSync(home, {recursive: true, force: true});
}

// Not an archive at all.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tarball-junk-'));
    const junk = path.join(home, 'truncated.tar.gz');
    fs.writeFileSync(junk, 'this is an error page, not a tarball\n');
    const result = install(home, junk, '12.32.3');
    assert.doesNotMatch(result.stdout, /returned 0/, 'A download that is not an archive is refused');
    assert.ok(!fs.existsSync(path.join(home, 'opt/postman')), '/opt must be untouched');
    fs.rmSync(home, {recursive: true, force: true});
}

// A preview unpacks nothing.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tarball-dry-'));
    const archive = fixture(home);
    const desktop = path.join(home, 'Postman.desktop');
    fs.writeFileSync(desktop, '[Desktop Entry]\n');
    const probe = `
        dry_run=true; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        install_tarball_app postman ${archive} 12.32.3 'Postman/app/postman' ${desktop}
        printf 'returned %s\\n' "$?"
    `;
    const result = spawnSync('bash', ['-c', probe], {encoding: 'utf8', timeout: 20000,
        env: {...process.env, HOME: home, PATH: '/usr/bin:/bin',
            DEBIAN_SETUP_OPT_ROOT: path.join(home, 'opt')}});
    assert.match(result.stdout, /returned 0/, result.stdout + result.stderr);
    assert.ok(!fs.existsSync(path.join(home, 'opt')), 'A preview unpacks nothing');
    fs.rmSync(home, {recursive: true, force: true});
}

console.log('tarball-smoke: all checks passed');
