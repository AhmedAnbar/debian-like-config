// SPDX-License-Identifier: GPL-3.0-only
// setup-onlyoffice.sh against stubs only. Nothing here reaches the network, apt,
// systemd or any path outside a mkdtemp directory: curl, gpg, apt-get, apt-cache,
// dpkg-query, sudo, systemctl, tar, ssh and scp are all stubs on a curated PATH,
// the helpers' system paths are prefixed with DEBIAN_SETUP_ETC_ROOT, and TMPDIR
// points into the scratch directory so even mktemp lands there.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'setup-onlyoffice.sh');

// The map rows belong to the shared map, which other scripts also read. The
// behavioural runs below use a fixture so a row added elsewhere cannot turn this
// test red, and this one assertion keeps the group name honest.
{
    const shared = fs.readFileSync(path.join(root, 'packages/apt-map.tsv'), 'utf8')
        .split('\n').slice(1).filter(Boolean).map((line) => line.split('\t'));
    assert.ok(shared.some((row) => row[0] === 'onlyoffice'),
        'The shared map must carry an onlyoffice group for this script to read');
}

// This machine is an Arch box with a real curl and no apt: a PATH built from a
// named list is the only way to be sure the script reached nothing real. Every
// name the script or lib/common.sh can invoke is either in this list or a stub.
const minimalPath = (dir) => {
    for (const command of ['bash', 'sh', 'awk', 'basename', 'cat', 'chmod', 'cmp', 'cp', 'date',
        'dirname', 'env', 'grep', 'id', 'install', 'mkdir', 'mktemp', 'rm', 'sed', 'sort',
        'stat', 'tail', 'tr', 'unlink']) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
};

const osRelease = (home, body, name) => {
    const file = path.join(home, name);
    fs.writeFileSync(file, body);
    return file;
};
const DEBIAN = 'ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n';
const UBUNTU = 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n';

// One pointer row, as the shared map carries it: the group installs nothing by apt
// name, and this script is what the note names.
const MAP = 'group\tarch\tapt\twhere\tnote\n'
    + 'onlyoffice\tonlyoffice-bin\t-\tnone\tNot in Debian 13 or Ubuntu 26.04; setup-onlyoffice.sh adds the vendor repository, pinned\n';

const sandbox = ({release = DEBIAN, key = 'ok', candidate = '10.0.0-169', update = 0,
    answers = 'y\n'.repeat(12), args = [], map = MAP} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-smoke-'));
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin);
    minimalPath(bin);
    const log = path.join(home, 'calls');
    const aptRoot = path.join(home, 'root');
    const preferences = path.join(aptRoot, 'etc/apt/preferences.d/onlyoffice');
    const sources = path.join(aptRoot, 'etc/apt/sources.list.d/onlyoffice.list');
    const keyring = path.join(aptRoot, 'etc/apt/keyrings/onlyoffice.gpg');
    fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    // The key fetch is the only thing in this script that would touch the network.
    fs.writeFileSync(path.join(bin, 'curl'), key === 'ok'
        ? `#!/bin/sh\nprintf 'curl %s\\n' "$*" >> ${log}\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && { printf 'KEYBYTES\\n' > "$2"; exit 0; }; shift; done\nexit 0\n`
        : `#!/bin/sh\nprintf 'curl %s\\n' "$*" >> ${log}\nexit 22\n`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'gpg'),
        `#!/bin/sh\nprintf 'gpg %s\\n' "$*" >> ${log}\nout=''\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out=$2; shift; done\n[ -n "$out" ] && printf 'DEARMORED\\n' > "$out"\nexit 0\n`,
        {mode: 0o755});
    // Every apt-get call records whether the pin was already on disk when it ran.
    // That is how the ordering requirement is checked without reading the script:
    // the preferences file must exist before the install command, not after it.
    fs.writeFileSync(path.join(bin, 'apt-get'), `#!/bin/sh
if [ -f ${preferences} ]; then state=pin-present; else state=pin-missing; fi
printf '%s: apt-get %s [frontend=%s]\\n' "$state" "$*" "\${DEBIAN_FRONTEND:-unset}" >> ${log}
case "$1" in update) exit ${update} ;; esac
exit 0
`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'apt-cache'), candidate
        ? `#!/bin/sh\nprintf 'apt-cache %s\\n' "$*" >> ${log}\nprintf '  Installed: (none)\\n  Candidate: ${candidate}\\n'\n`
        : `#!/bin/sh\nprintf 'apt-cache %s\\n' "$*" >> ${log}\nprintf '  Installed: (none)\\n  Candidate: (none)\\n'\n`,
        {mode: 0o755});
    // Present so that calling one is a recorded fact rather than a crash.
    for (const name of ['systemctl', 'dpkg-query', 'dpkg', 'tar', 'ssh', 'scp', 'findmnt', 'snap', 'flatpak']) {
        fs.writeFileSync(path.join(bin, name),
            `#!/bin/sh\nprintf '${name} %s\\n' "$*" >> ${log}\nexit 0\n`, {mode: 0o755});
    }
    const mapFile = path.join(home, 'apt-map.tsv');
    fs.writeFileSync(mapFile, map);
    const result = spawnSync('bash', [script, ...args], {
        encoding: 'utf8', timeout: 90000, input: answers,
        env: {HOME: home, PATH: bin, TMPDIR: home,
            DEBIAN_SETUP_OS_RELEASE: osRelease(home, release, 'os-release'),
            DEBIAN_SETUP_MAP: mapFile, DEBIAN_SETUP_ETC_ROOT: aptRoot,
            DEBIAN_SETUP_OPT_ROOT: path.join(home, 'opt'),
            DEBIAN_SETUP_SHARE_ROOT: path.join(home, 'share')},
    });
    return {result, home, aptRoot, preferences, sources, keyring,
        log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''};
};
const clean = (s) => fs.rmSync(s.home, {recursive: true, force: true});

// Arguments and guards, before anything else is believed about the script.
{
    const bad = sandbox({args: ['--invalid']});
    assert.equal(bad.result.status, 2, 'An unknown argument is a usage error');
    assert.equal(bad.log, '', 'A usage error runs no command at all');
    clean(bad);
    const help = sandbox({args: ['--help']});
    assert.equal(help.result.status, 0, 'Asking for help is not a failure');
    assert.match(help.result.stdout, /--dry-run/, 'The help text names the preview flag');
    clean(help);
    const fedora = sandbox({release: 'ID=fedora\n', args: ['--dry-run']});
    assert.equal(fedora.result.status, 1, 'An unsupported distribution is refused');
    assert.match(fedora.result.stderr, /Debian 13 and Ubuntu 26\.04/);
    assert.doesNotMatch(fedora.log, /curl/, 'A refused release fetches nothing');
    clean(fedora);
}

// A preview writes nothing, reaches nothing, and still says what it would do —
// including the pin, which is the whole point of this script.
{
    const s = sandbox({args: ['--dry-run']});
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.match(s.result.stdout, /download\.onlyoffice\.com\/repo\/debian squeeze main/,
        'A preview names the repository it would add, suite and all');
    assert.match(s.result.stdout, /preferences\.d\/onlyoffice/,
        'A preview names the pin file it would write');
    assert.match(s.result.stdout, /ttf-mscorefonts-installer/,
        'A preview names the package the pin protects');
    // The helper's own preview, not a shell-quoted call to it: try routes through run,
    // and run does not execute anything under --dry-run, so wrapping the helper in try
    // turns its preview into dead code and prints an internal function call that reads
    // like a command the user could run.
    assert.match(s.result.stdout, /preview only: no key fetched/,
        "The repository helper's own preview must run");
    assert.doesNotMatch(s.result.stdout, /add_vendor_repo /,
        'A preview must not print an internal function call as if it were a command');
    assert.ok(!fs.existsSync(s.aptRoot), 'A preview creates nothing under the apt root');
    assert.equal(s.log, '', 'A preview runs no curl, no gpg, no apt-get and no apt-cache');
    clean(s);
}

// Declining every step changes nothing and is not a failure.
{
    const s = sandbox({answers: 'n\n'.repeat(12)});
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.ok(!fs.existsSync(s.aptRoot), 'An all-no run writes no sources file and no pin');
    assert.doesNotMatch(s.log, /curl/, 'An all-no run must not fetch the key');
    assert.doesNotMatch(s.log, /apt-get/, 'An all-no run must not run apt at all');
    assert.match(s.result.stdout, /onlyoffice/i, 'It still says what it offered');
    clean(s);
}

// The happy path: pinned first, installed second.
{
    const s = sandbox();
    assert.equal(s.result.status, 0, s.result.stdout + s.result.stderr);
    assert.ok(fs.existsSync(s.keyring), 'The dearmored key is installed');
    const line = fs.readFileSync(s.sources, 'utf8');
    assert.match(line, /^deb .*https:\/\/download\.onlyoffice\.com\/repo\/debian squeeze main$/m,
        `The one suite the recon proved, for both releases: ${line}`);
    assert.match(line, new RegExp(`signed-by=${s.keyring}`),
        'The sources line names the keyring the helper just installed');

    // The pin exists, and it names the package it is protecting.
    assert.ok(fs.existsSync(s.preferences), 'The pin file is written');
    const pin = fs.readFileSync(s.preferences, 'utf8');
    assert.match(pin, /^Package: ttf-mscorefonts-installer$/m,
        'The pin must name the package whose distribution version it is protecting');
    assert.match(pin, /^Pin: origin download\.onlyoffice\.com$/m,
        'And the origin it is holding down');
    assert.match(pin, /^Package: \*$/m, 'The other 70 names are held down too');
    assert.match(pin, /^Package: onlyoffice-desktopeditors$/m,
        'And the package this repository is here for keeps ordinary priority');
    const priority = (name) => {
        const block = pin.split(/\n\s*\n/).find((b) => b.includes(`Package: ${name}`));
        assert.ok(block, `No pin stanza for ${name}`);
        return Number(block.match(/Pin-Priority:\s*(-?\d+)/)[1]);
    };
    assert.ok(priority('ttf-mscorefonts-installer') < 500,
        "The vendor's mscorefonts must lose to the distribution's 500");
    assert.ok(priority('*') < 500, 'Nothing from this repository outranks the distribution');
    assert.equal(priority('onlyoffice-desktopeditors'), 500,
        'The editors exist in no other archive, so they are an ordinary 500');

    // The ordering, read from what apt-get itself saw: the pin was on disk before
    // the install command ran, not written afterwards.
    const install = s.log.split('\n').filter((l) => /apt-get install/.test(l));
    assert.equal(install.length, 1, `Exactly one install call: ${s.log}`);
    assert.match(install[0], /^pin-present:/,
        'The pin must already exist when the install runs; that is the point of this script');
    assert.match(install[0], /onlyoffice-desktopeditors/, 'And it installs the editors');
    // Read from the environment apt-get was actually given, not from the echoed
    // command line: sudo env ... is only a promise until the child sees it.
    assert.match(install[0], /frontend=noninteractive/,
        "ttf-mscorefonts-installer's EULA must not stop an unattended install");
    assert.match(s.log, /apt-cache policy/, 'Success is read from the candidate, not an exit status');
    assert.match(s.result.stdout, /10\.0\.0-169/, 'Report the version the repository offered');

    // Honesty in its own closing output, not in a comment nobody reads.
    assert.match(s.result.stdout, /could not verify|unverified/i,
        'The summary says what this run could not show');
    assert.match(s.result.stdout, /apt-cache policy ttf-mscorefonts-installer/,
        'And how to check the pin actually worked, since that was designed, not tested');
    assert.doesNotMatch(s.log, /\bscp\b|\bssh\b/, 'Nothing here copies anything anywhere');
    clean(s);
}

// Ubuntu takes the same single suite — the recon found one repository, not two.
{
    const s = sandbox({release: UBUNTU});
    assert.equal(s.result.status, 0, s.result.stdout + s.result.stderr);
    assert.match(fs.readFileSync(s.sources, 'utf8'),
        /https:\/\/download\.onlyoffice\.com\/repo\/debian squeeze main/,
        'Ubuntu gets the same debian/squeeze suite, which is what the vendor publishes');
    assert.match(s.result.stdout, /Ubuntu/, 'And says which release it detected');
    assert.ok(fs.existsSync(s.preferences), 'The pin is written on Ubuntu too');
    assert.match(fs.readFileSync(s.preferences, 'utf8'), /ttf-mscorefonts-installer/,
        "Ubuntu multiverse's 3.8.1ubuntu2 needs the same protection as Debian contrib's");
    clean(s);
}

// apt-get update exits 0 when the vendor host is unreachable. No candidate is a
// failure: the repository, its key and its pin all come off again, nothing is
// installed, and the script exits non-zero so install.sh's attempt can report it.
{
    const s = sandbox({candidate: ''});
    assert.equal(s.result.status, 1, 'A repository that offered nothing is a failed run');
    assert.ok(!fs.existsSync(s.sources), 'The sources file is removed again');
    assert.ok(!fs.existsSync(s.keyring), 'And the keyring with it');
    assert.ok(!fs.existsSync(s.preferences),
        'A pin for a repository that is no longer configured must not be left behind');
    assert.doesNotMatch(s.log, /apt-get install/,
        'Nothing may be installed from a repository that did not verify');
    assert.match(s.result.stdout, /Steps that failed:[\s\S]*onlyoffice/,
        'The failed step is named in the summary');
    // skipped[] is printed at offer time, from the map, long before this is known, so
    // appending to it here would record the one fact the user needs nowhere at all.
    assert.match(s.result.stdout, /onlyoffice-desktopeditors was not installed/,
        'The summary says the editors were not installed, and why');
    clean(s);
}

// The key cannot be fetched: no sources file, no pin, no install, non-zero exit.
{
    const s = sandbox({key: 'no-key'});
    assert.equal(s.result.status, 1, 'A failed key fetch is a failed run');
    assert.ok(!fs.existsSync(s.sources),
        'A sources file without its key breaks every later apt-get update');
    assert.ok(!fs.existsSync(s.preferences), 'And no pin is left for a repository that is not there');
    assert.doesNotMatch(s.log, /apt-get install/, 'Nothing is installed');
    assert.match(s.result.stdout, /Steps that failed:/, 'The failure is reported');
    clean(s);
}

console.log('setup-onlyoffice-smoke: all checks passed');
