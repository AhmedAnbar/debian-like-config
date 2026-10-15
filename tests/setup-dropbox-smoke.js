// SPDX-License-Identifier: GPL-3.0-only
// setup-dropbox.sh under stubs only. Nothing here reaches the network, apt, dpkg or
// systemd: PATH is built from a named list the way tests/setup-sway-smoke.js builds it,
// every external command the script can reach is a logging stub, and the helpers write
// under DEBIAN_SETUP_ETC_ROOT inside a mkdtemp directory. TMPDIR points there too, so
// even add_vendor_repo's mktemp stays inside it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'setup-dropbox.sh');

// The one key URL this script is allowed to use. Nothing else may appear: the same
// fingerprint from a keyserver is SHA1-bound and makes Debian 13's apt-get update
// exit 100 permanently, which no later step can undo.
const KEY_URL = 'https://linux.dropbox.com/fedora/rpm-public-key.asc';

const bodies = {
    debian: 'ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n',
    ubuntu: 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n',
    fedora: 'ID=fedora\nPRETTY_NAME="Fedora Linux 43"\n',
};

// This machine has curl and gpg; a test that inherited them would prove nothing about
// what the script fetched, so the PATH is assembled from scratch.
const sandbox = ({release = 'debian', candidate = '2026.09.28', key = 'ok', map = null,
    guardWrites = true} = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dropbox-smoke-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    for (const tool of ['bash', 'sh', 'awk', 'cat', 'date', 'dirname', 'env', 'install',
        'mkdir', 'mktemp', 'rm', 'sort', 'tail']) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, tool))
            .find((candidatePath) => fs.existsSync(candidatePath));
        assert.ok(source, `This test needs ${tool} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(bin, tool));
    }
    const log = path.join(dir, 'calls');
    const stub = (name, body) => fs.writeFileSync(path.join(bin, name),
        `#!/bin/sh\necho "${name} $*" >> ${log}\n${body}\n`, {mode: 0o755});
    stub('curl', key === 'ok'
        ? `while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { printf 'KEYBYTES\\n' > "$2"; exit 0; }; shift; done\nexit 0`
        : 'exit 22');
    stub('gpg', `out=''\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out=$2; shift; done\n[ -n "$out" ] && printf 'DEARMORED\\n' > "$out"\nexit 0`);
    stub('apt-get', 'exit 0');
    // The version table is part of the stub because add_vendor_repo checks where the
    // candidate comes from, not just that there is one: apt reports a candidate for any
    // installed package out of /var/lib/dpkg/status with no repository at all.
    stub('apt-cache', candidate
        ? `case "$*" in
  *dropbox*) printf '  Installed: (none)\\n  Candidate: ${candidate}\\n  Version table:\\n'
             printf '     ${candidate} 500\\n        500 https://linux.dropbox.com/debian trixie/main amd64 Packages\\n' ;;
  *) printf '  Candidate: (none)\\n' ;;
esac`
        : "printf '  Installed: (none)\\n  Candidate: (none)\\n  Version table:\\n'");
    // None of these may ever run. They are here so that running one is recorded rather
    // than reaching the real thing: dropbox start -i above all, which prints its prompt,
    // dies on EOFError and still exits 0, so only the log can prove it was not called.
    for (const name of ['dropbox', 'systemctl', 'scp', 'ssh', 'dpkg-query', 'tar']) stub(name, 'exit 0');
    // sudo runs the command, except when this scenario is about the guard write failing:
    // /etc/default/dropbox-repo is the whole reason the repository route is safe, so
    // "could not write it" has to be a representable outcome.
    fs.writeFileSync(path.join(bin, 'sudo'), guardWrites
        ? '#!/bin/sh\nexec "$@"\n'
        : `#!/bin/sh
for a in "$@"; do
  case "$a" in */etc/default/dropbox-repo) echo "sudo $*" >> ${log}; exit 1 ;; esac
done
exec "$@"
`, {mode: 0o755});
    const osRelease = path.join(dir, 'os-release');
    fs.writeFileSync(osRelease, bodies[release]);
    const aptRoot = path.join(dir, 'root');
    const env = {HOME: dir, PATH: bin, TMPDIR: dir, DEBIAN_SETUP_OS_RELEASE: osRelease,
        DEBIAN_SETUP_ETC_ROOT: aptRoot, DEBIAN_SETUP_OPT_ROOT: path.join(dir, 'opt'),
        DEBIAN_SETUP_SHARE_ROOT: path.join(dir, 'share')};
    if (map) {
        const file = path.join(dir, 'map.tsv');
        fs.writeFileSync(file, map);
        env.DEBIAN_SETUP_MAP = file;
    }
    const run = (args = [], answers = 'n\n'.repeat(12)) => {
        const result = spawnSync('bash', [script, ...args],
            {encoding: 'utf8', timeout: 60000, input: answers, env});
        return {...result, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''};
    };
    return {dir, run, aptRoot,
        sources: path.join(aptRoot, 'etc/apt/sources.list.d/dropbox.list'),
        keyring: path.join(aptRoot, 'etc/apt/keyrings/dropbox.gpg'),
        guard: path.join(aptRoot, 'etc/default/dropbox-repo')};
};
const yes = 'y\n'.repeat(12);
const cleanup = (s) => fs.rmSync(s.dir, {recursive: true, force: true});

// Arguments and guards, before anything else is asked.
{
    const s = sandbox();
    assert.equal(s.run(['--invalid']).status, 2, 'An unknown argument is a usage error');
    assert.equal(s.run(['--help']).status, 0, '--help explains itself and exits 0');
    cleanup(s);
    const wrong = sandbox({release: 'fedora'});
    const refused = wrong.run(['--dry-run'], yes);
    assert.equal(refused.status, 1, 'An unsupported distribution is refused');
    assert.match(refused.stderr, /Debian 13 and Ubuntu 26\.04/);
    assert.equal(refused.log, '', 'A refused release reaches no command at all');
    cleanup(wrong);
}

// The key URL is load-bearing, so it is pinned in the source as well as in the calls.
{
    const body = fs.readFileSync(script, 'utf8');
    assert.ok(body.includes(KEY_URL), `The key must come from ${KEY_URL}`);
    // Comments are expected to explain the keyserver trap; the code may not use it.
    const code = body.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
    assert.doesNotMatch(code, /keyserver|hkps?:|--recv-key/i,
        'A keyserver copy of this key is SHA1-bound and breaks apt-get update permanently');
    assert.doesNotMatch(code, /http:\/\//, 'Nothing here is fetched over plain http');
    assert.doesNotMatch(code, /dpkg -i\b/, 'The time_t transition means a bare dpkg -i fails');
    assert.doesNotMatch(code, /^\s*(run|try|attempt)\s+(sudo\s+)?dropbox\b/m,
        'dropbox start -i must never be run by the script');
    assert.ok(body.indexOf('/etc/default/dropbox-repo') < body.indexOf('apt-get install -y dropbox'),
        'The postinst guard is written before the install it has to suppress');
}

// A preview writes nothing and fetches nothing, even when every step is accepted.
{
    const s = sandbox();
    const preview = s.run(['--dry-run'], yes);
    assert.equal(preview.status, 0, preview.stderr);
    assert.ok(preview.stdout.includes(KEY_URL), 'A preview names the key URL it would fetch');
    assert.ok(preview.stdout.includes('https://linux.dropbox.com/debian trixie main'),
        "Debian's suite is trixie");
    assert.equal(preview.log, '', 'A preview runs no command: no curl, no apt-get, no gpg');
    assert.ok(!fs.existsSync(s.aptRoot), 'A preview creates nothing under /etc/apt');
    cleanup(s);
}

// The suite follows the release, and nothing of the other release leaks in.
{
    const s = sandbox({release: 'ubuntu'});
    const preview = s.run(['--dry-run'], yes);
    assert.equal(preview.status, 0, preview.stderr);
    assert.ok(preview.stdout.includes('https://linux.dropbox.com/ubuntu resolute main'),
        "Ubuntu 26.04's suite is resolute");
    assert.doesNotMatch(preview.stdout, /trixie/, "Debian's suite must not reach Ubuntu");
    cleanup(s);
}

// Every step declines by default: a run of all-no changes nothing and exits 0.
{
    const s = sandbox();
    const declined = s.run([], 'n\n'.repeat(12));
    assert.equal(declined.status, 0, declined.stderr);
    assert.equal(declined.log, '', 'Declining must not fetch the key or run apt-get');
    assert.ok(!fs.existsSync(s.sources), 'No sources file');
    assert.ok(!fs.existsSync(s.keyring), 'No keyring');
    assert.ok(!fs.existsSync(s.guard), 'No /etc/default/dropbox-repo');
    assert.ok(declined.stdout.includes('dropbox start -i'),
        'The closing output still says how to start it');
    cleanup(s);
}

// Accepting everything on Debian: key from the vendor URL, sources file afterwards,
// the postinst guard, and two separate apt-get transactions.
{
    const s = sandbox();
    const result = s.run([], yes);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.log.includes(KEY_URL), 'The key is fetched from the vendor URL');
    assert.doesNotMatch(result.log, /keyserver/, 'And from nowhere else');
    assert.equal(fs.readFileSync(s.sources, 'utf8'),
        `deb [arch=amd64 signed-by=${s.keyring}] https://linux.dropbox.com/debian trixie main\n`,
        'The sources line names the keyring, the vendor host and the release suite');
    assert.ok(fs.existsSync(s.keyring), 'The dearmored key is installed');
    assert.ok(fs.existsSync(s.guard),
        'An empty /etc/default/dropbox-repo stops the postinst rewriting apt over http');
    assert.match(result.log, /apt-get update/, 'The repository gets its own update');
    assert.match(result.log, /^apt-get install -y dropbox$/m, 'The frontend is installed');
    assert.match(result.log, /^apt-get install -y python3-gpg$/m,
        'python3-gpg comes from the map group, in its own transaction');
    assert.doesNotMatch(result.log, /install -y (dropbox python3-gpg|python3-gpg dropbox)/,
        'One transaction would let a universe-only name take the frontend down with it');
    assert.doesNotMatch(result.log, /^dropbox /m,
        'dropbox start -i exits 0 having done nothing, so the script must never run it');
    assert.doesNotMatch(result.log, /^(scp|ssh|systemctl|tar) /m, 'Nothing else is reached');
    assert.ok(result.stdout.includes('dropbox start -i'), 'Say how to finish the install');
    assert.match(result.stdout, /desktop session/i, 'And where to do it from');
    assert.match(result.stdout, /not verif|unverified|cannot/i,
        'Say what this run could not show');
    cleanup(s);
}

// Ubuntu writes Ubuntu's suite into the file that lands.
{
    const s = sandbox({release: 'ubuntu'});
    const result = s.run([], yes);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(s.sources, 'utf8'),
        `deb [arch=amd64 signed-by=${s.keyring}] https://linux.dropbox.com/ubuntu resolute main\n`);
    cleanup(s);
}

// The repository is reachable but offers no dropbox: apt-get update exits 0 in that
// case, so the candidate is the only verdict. Nothing may be installed: neither archive
// resolves the name at all, and their nautilus-dropbox is the 2019 frontend.
{
    const s = sandbox({candidate: ''});
    const result = s.run([], yes);
    assert.equal(result.status, 1, 'A failed step must exit non-zero for install.sh');
    assert.doesNotMatch(result.log, /install -y dropbox/,
        'No package may be installed as a consolation prize');
    assert.ok(!fs.existsSync(s.sources), 'The sources file is removed again');
    assert.match(result.stdout, /Steps that failed:[\s\S]*dropbox/,
        'The summary names the step that failed');
    assert.match(result.stdout + result.stderr, /nautilus-dropbox/,
        'Name the archive package, and say why it is not a substitute');
    cleanup(s);
}

// The key cannot be fetched: no sources file, no install, non-zero exit.
{
    const s = sandbox({key: 'fail'});
    const result = s.run([], yes);
    assert.equal(result.status, 1, 'A failed key fetch is a failed run');
    assert.ok(!fs.existsSync(s.sources),
        'A sources file without its key breaks every later apt-get update');
    assert.doesNotMatch(result.log, /install -y dropbox/, 'And nothing is installed');
    cleanup(s);
}

// The supporting package is read from the map, not spelled into the script.
{
    const s = sandbox({map: 'group\tarch\tapt\twhere\tnote\n'
        + 'dropbox\tdropbox\t-\tnone\tNeither archive resolves this name to a version\n'
        + 'dropbox\t-\tpython3-gpg-sentinel\tboth\tStands in for python3-gpg\n'});
    const result = s.run([], yes);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.log, /^apt-get install -y python3-gpg-sentinel$/m,
        'The supporting package name comes from the map group');
    cleanup(s);
}

// The guard is not optional. Without /etc/default/dropbox-repo the dropbox postinst
// replaces the sources file add_vendor_repo just wrote with its own over plain http,
// installs a second keyring, and rm -rf's ~/.dropbox-dist below version 2.10. So a run
// that could not write the guard must not install the package: that would undo the
// repository this run just configured, and over http.
{
    const s = sandbox({guardWrites: false});
    const result = s.run([], yes);
    assert.doesNotMatch(result.log, /apt-get install -y dropbox/,
        'Without the guard the package must not be installed');
    assert.match(result.stdout + result.stderr, /postinst|guard/i,
        'Say why nothing was installed');
    assert.equal(result.status, 1, 'And the failed step is reported to install.sh');
    assert.match(result.stdout, /Steps that failed:/, 'The summary names it');
}

console.log('setup-dropbox-smoke: all checks passed');
