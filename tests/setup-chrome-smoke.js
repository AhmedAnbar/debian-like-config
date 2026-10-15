// SPDX-License-Identifier: GPL-3.0-only
// setup-chrome.sh against stubs only. Nothing here reaches the network, apt, dpkg or
// systemd: curl, gpg, apt-get, apt-cache, dpkg-query, sudo and systemctl are scripts in
// a scratch PATH, and Google's repository lands under DEBIAN_SETUP_ETC_ROOT. Every stub
// logs its own call, so "this was never run" is an assertion rather than a hope.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'setup-chrome.sh');

// The minimalPath trick from setup-sway-smoke.js: a PATH built from a named list is the
// only way to be sure the script cannot reach this machine's real curl or apt-get,
// whatever is installed on it. bash and sh are in the list because spawnSync resolves
// the command it runs through the PATH it is given, not the one this process has.
const minimalPath = (dir, stubs) => {
    for (const command of ['bash', 'sh', 'awk', 'cat', 'chmod', 'cmp', 'cp', 'date', 'dirname',
        'env', 'grep', 'id', 'install', 'mkdir', 'mktemp', 'rm', 'sort', 'stat', 'tail', 'unlink']) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
    for (const [name, body] of Object.entries(stubs)) {
        fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, {mode: 0o755});
    }
};

const keyUrl = 'https://dl.google.com/linux/linux_signing_key.pub';

// installed: null leaves dpkg-query off the PATH entirely (the tool may be missing),
// false is dpkg-query reporting an unknown package, a string is an installed version.
const scenario = ({release = 'debian', answers = 'y\n'.repeat(12), args = [], key = 'ok',
    candidate = '155.0.8059.79-1', update = 0, installed = null, map = null} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-smoke-'));
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(home, 'calls');
    const aptRoot = path.join(home, 'root');
    const bodies = {
        debian: 'ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n',
        ubuntu: 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n',
    };
    const osRelease = path.join(home, 'os-release');
    fs.writeFileSync(osRelease, bodies[release] ?? `ID=${release}\n`);
    // A real PGP key would need a keyring; the gpg stub dearmors by writing bytes, which
    // is all the helper's key-before-sources ordering depends on.
    const stubs = {
        sudo: `echo "sudo $*" >> ${log}\nexec "$@"`,
        curl: key === 'ok'
            ? `echo "curl $*" >> ${log}\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && { printf 'KEYBYTES\\n' > "$2"; exit 0; }; shift; done\nexit 0`
            : `echo "curl $*" >> ${log}\nexit 22`,
        gpg: `echo "gpg $*" >> ${log}\nout=''\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out=$2; shift; done\n[ -n "$out" ] && printf 'DEARMORED\\n' > "$out"\nexit 0`,
        'apt-get': `echo "apt-get $*" >> ${log}\nexit ${update}`,
        'apt-cache': `echo "apt-cache $*" >> ${log}\nprintf '  Installed: (none)\\n  Candidate: ${candidate || '(none)'}\\n'`,
        // Chrome needs no unit, and a test must never touch the real init system.
        systemctl: `echo "systemctl $*" >> ${log}\nexit 0`,
    };
    if (installed !== null) {
        stubs['dpkg-query'] = installed === false
            ? `echo "dpkg-query $*" >> ${log}\nexit 1`
            : `echo "dpkg-query $*" >> ${log}\nprintf '%s' '${installed}'`;
    }
    minimalPath(bin, stubs);
    const env = {HOME: home, PATH: bin, DEBIAN_SETUP_OS_RELEASE: osRelease,
        DEBIAN_SETUP_ETC_ROOT: aptRoot};
    if (map) { env.DEBIAN_SETUP_MAP = map; }
    const result = spawnSync('bash', [script, ...args],
        {encoding: 'utf8', timeout: 60000, input: answers, env});
    return {result, home, aptRoot,
        log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
        sources: path.join(aptRoot, 'etc/apt/sources.list.d/google-chrome.list'),
        keyring: path.join(aptRoot, 'etc/apt/keyrings/google-chrome.gpg')};
};

// No step in this script may fetch anything until it has been agreed to.
const noNetwork = (s, why) => {
    assert.doesNotMatch(s.log, /curl/, `${why}: nothing may be fetched`);
    assert.doesNotMatch(s.log, /gpg/, `${why}: no key may be dearmored`);
    assert.doesNotMatch(s.log, /apt-get/, `${why}: apt must not run`);
};

// Arguments and guards.
{
    const bad = scenario({args: ['--invalid']});
    assert.equal(bad.result.status, 2, 'An unknown argument is a usage error');
    fs.rmSync(bad.home, {recursive: true, force: true});
    const help = scenario({args: ['--help']});
    assert.equal(help.result.status, 0, 'Asking for help is not an error');
    assert.match(help.result.stdout, /chromium/i, 'Help says what it does not touch');
    noNetwork(help, 'Printing help');
    fs.rmSync(help.home, {recursive: true, force: true});
    const fedora = scenario({release: 'fedora', args: ['--dry-run']});
    assert.equal(fedora.result.status, 1, 'An unsupported distribution is refused');
    assert.match(fedora.result.stderr, /Debian 13 and Ubuntu 26\.04/);
    fs.rmSync(fedora.home, {recursive: true, force: true});
}

// A preview must write nothing at all, and must not run a single external command.
{
    const s = scenario({args: ['--dry-run']});
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.match(s.result.stdout, /dl\.google\.com\/linux\/chrome\/deb\/? stable main/,
        'Name the repository before anything is agreed to');
    assert.match(s.result.stdout, new RegExp(keyUrl.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')),
        'And the signing key it would trust');
    assert.match(s.result.stdout, /google-chrome-stable/, 'And the package it installs');
    assert.equal(s.log, '', 'A preview must not run a single external command');
    assert.ok(!fs.existsSync(s.aptRoot), 'A preview writes nothing');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// Every step declines by default: a run of all-no changes nothing and exits 0.
{
    const s = scenario({answers: 'n\n'.repeat(12), candidate: ''});
    assert.equal(s.result.status, 0, s.result.stderr);
    noNetwork(s, 'A declined run');
    assert.ok(!fs.existsSync(s.sources), 'A declined run adds no repository');
    assert.ok(!fs.existsSync(s.keyring), 'And installs no key');
    assert.match(s.result.stdout, /Left alone at your request:[\s\S]*repository/,
        'The declined repository is named in the summary');
    assert.match(s.result.stdout, /nothing is installed/,
        'Say why the install step was not even offered');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// The whole point, on Debian: the repository is added, verified, and the package
// installed — and Chromium is neither installed nor removed.
{
    const s = scenario({installed: false});
    assert.equal(s.result.status, 0, s.result.stdout + s.result.stderr);
    assert.ok(fs.existsSync(s.keyring), 'The dearmored key is installed');
    const line = fs.readFileSync(s.sources, 'utf8');
    assert.match(line, /^deb \[[^\]]*\] https:\/\/dl\.google\.com\/linux\/chrome\/deb\/ stable main\n$/,
        `The suite-and-components line Google publishes, verbatim; got: ${line}`);
    assert.match(line, /arch=amd64/, 'amd64 is the only architecture Google publishes');
    const signedBy = line.match(/signed-by=([^ \]]+)/);
    assert.ok(signedBy, 'The sources line names its own keyring, not the trusted.gpg.d pile');
    assert.ok(fs.existsSync(signedBy[1]),
        `signed-by names ${signedBy[1]}, which this run never installed`);
    assert.match(s.log, new RegExp(`curl .*${keyUrl.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`),
        'The key comes from Google, by that exact URL');
    assert.match(s.log, /apt-get update/, 'The repository gets its own update, not the shared one');
    assert.match(s.log, /apt-cache policy -- google-chrome-stable/,
        'Success is read from the candidate, because update exits 0 on an outage');
    assert.match(s.log, /apt-get install -y google-chrome-stable/, 'And the package is installed');
    assert.doesNotMatch(s.log, /chromium/, 'This script must never install or remove chromium');
    assert.doesNotMatch(s.log, /systemctl/, 'Chrome needs no unit enabled');
    assert.match(s.result.stdout, /155\.0\.8059\.79-1/, 'Report the version the repository offered');
    // Debian framing: install.sh already offered chromium, so Chrome is an addition.
    assert.match(s.result.stdout, /chromium[\s\S]{0,200}browser-files/,
        'On Debian, say that install.sh already offered chromium with the browser-files group');
    // The two things Chrome does behind apt's back, tolerated and named rather than fought.
    assert.match(s.result.stdout, /\/etc\/cron\.daily\/google-chrome/,
        "Name Chrome's own cron.daily rather than fighting it");
    assert.match(s.result.stdout, /sources\.list\.d\/google-chrome\.list[\s\S]{0,400}keyrings\/google-chrome\.gpg/,
        'And the sources file and keyring its postinst re-creates');
    assert.match(s.result.stdout, /[Nn]ot verified[\s\S]{0,300}(launch|sandbox|Wayland)/,
        'Say plainly that nothing here proves Chrome launches on this machine');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// Ubuntu gets the identical repository line, and the opposite Chromium sentence:
// 26.04 packages no chromium at all, so nothing was installed earlier to add to.
{
    const s = scenario({release: 'ubuntu'});
    assert.equal(s.result.status, 0, s.result.stdout + s.result.stderr);
    assert.match(fs.readFileSync(s.sources, 'utf8'),
        /https:\/\/dl\.google\.com\/linux\/chrome\/deb\/ stable main/,
        'The line is identical on both releases');
    assert.match(s.result.stdout, /no chromium/i, 'Ubuntu 26.04 packages none at all');
    assert.doesNotMatch(s.result.stdout, /browser-files/,
        'There is no Debian chromium install to refer to on Ubuntu');
    assert.doesNotMatch(s.log, /chromium/, 'And still nothing chromium is installed');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// The key cannot be fetched: no repository is left behind, nothing is installed, and the
// script exits non-zero so install.sh does not reduce the whole subject to one line.
{
    const s = scenario({key: 'no-key', candidate: ''});
    assert.notEqual(s.result.status, 0, 'A failed key fetch must not report success');
    assert.ok(!fs.existsSync(s.sources), 'A sources file without its key breaks every later update');
    assert.ok(!fs.existsSync(s.keyring), 'And no keyring is left either');
    assert.doesNotMatch(s.log, /apt-get install/, 'Nothing may be installed from a repository that failed');
    assert.match(s.result.stdout, /Steps that failed:/, 'The failure is reported');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// apt-get update exits 0 when dl.google.com is unreachable. No candidate is still a
// failure: the repository is removed again and the script exits non-zero.
{
    const s = scenario({candidate: '', update: 0});
    assert.notEqual(s.result.status, 0, 'A zero-exit update with no candidate is a failure');
    assert.ok(!fs.existsSync(s.sources), 'The sources file is removed again');
    assert.ok(!fs.existsSync(s.keyring), 'And the keyring with it');
    assert.doesNotMatch(s.log, /apt-get install -y google-chrome-stable/,
        'A repository that offered nothing installs nothing');
    assert.match(s.result.stdout, /Steps that failed:[\s\S]*google-chrome/, 'Named in the summary');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// Chrome's postinst writes its own sources file, so a machine that has had Chrome before
// can offer the package with no repository added by this run. Declining the repository
// step must then still reach the install step — and must still fetch nothing.
{
    const s = scenario({answers: 'n\ny\n', installed: '155.0.8059.79-1'});
    assert.equal(s.result.status, 0, s.result.stdout + s.result.stderr);
    assert.match(s.result.stdout, /already installed/i, 'Say that Chrome is already on the machine');
    assert.match(s.result.stdout, /155\.0\.8059\.79-1/, 'With the version dpkg reports');
    assert.doesNotMatch(s.log, /curl/, 'A declined repository step fetches nothing');
    assert.ok(!fs.existsSync(s.sources), 'And writes no sources file');
    assert.match(s.log, /apt-get install -y google-chrome-stable/,
        "Chrome's own repository is enough to install or upgrade from");
    fs.rmSync(s.home, {recursive: true, force: true});
}

// The chrome group is one pointer row, so the map has nothing installable in it today —
// and that row is what explains why this script exists at all.
{
    const s = scenario({args: ['--dry-run']});
    assert.match(s.result.stdout, /Not in either archive[\s\S]{0,200}google-chrome/,
        'Print the pointer row that says Chrome is in no archive');
    fs.rmSync(s.home, {recursive: true, force: true});
    // An installable row added to the group later must be installed, not dropped.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-map-'));
    const map = path.join(home, 'apt-map.tsv');
    fs.writeFileSync(map, ['group\tarch\tapt\twhere\tnote',
        'chrome\tgoogle-chrome\t-\tnone\tOnly in Google apt repository',
        'chrome\t-\tfonts-liberation\tboth\tA metric-compatible fallback for the fonts Chrome expects',
        'chrome\t-\tchrome-gnome-shell\tubuntu\tUbuntu only, for the test',
    ].join('\n') + '\n');
    const s2 = scenario({map});
    assert.equal(s2.result.status, 0, s2.result.stdout + s2.result.stderr);
    assert.match(s2.log, /apt-get install -y .*fonts-liberation/,
        'An installable row in the chrome group is installed with the browser');
    assert.match(s2.result.stdout, /Skipped on Debian[\s\S]{0,120}chrome-gnome-shell/,
        "And the other release's row is reported as skipped, not installed");
    assert.doesNotMatch(s2.log, /chrome-gnome-shell/, 'Not installed on the wrong release');
    fs.rmSync(s2.home, {recursive: true, force: true});
    fs.rmSync(home, {recursive: true, force: true});
}

console.log('setup-chrome-smoke: all checks passed');
