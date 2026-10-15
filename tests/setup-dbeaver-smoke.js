// SPDX-License-Identifier: GPL-3.0-only
// setup-dbeaver.sh against stubs only. Nothing here reaches the network, apt, dpkg
// or systemd: the PATH is built from a named list, so a command the script can reach
// is either a stub this file wrote or absent, and every write the vendor-repository
// helper makes is prefixed into a mkdtemp directory by DEBIAN_SETUP_ETC_ROOT.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'setup-dbeaver.sh');

// The real tools the script and lib/common.sh call, resolved from ordinary places.
// bash and sh are in the list because spawnSync resolves the command it runs through
// the PATH it is given, not the one this process has.
const borrowed = ['bash', 'sh', 'awk', 'basename', 'cat', 'chmod', 'cmp', 'cp', 'date', 'dirname',
    'env', 'grep', 'id', 'install', 'mkdir', 'mktemp', 'rm', 'sed', 'sort', 'stat', 'tail', 'unlink'];

// Every command the script could reach that must never really run. curl and scp are
// the two that would turn this test's result into a statement about the network:
// they exist only as loggers, and the assertions below check they stayed unused
// wherever the script had no business fetching anything.
const scenario = ({
    release = 'debian', key = 'ok', candidate = '26.2.2', installStatus = 0,
    installed = '', args = [], answers = 'y\n'.repeat(12),
} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dbeaver-smoke-'));
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(home, 'calls');
    const aptRoot = path.join(home, 'root');
    for (const command of borrowed) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidatePath) => fs.existsSync(candidatePath));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(bin, command));
    }
    const stub = (name, body) =>
        fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${log}\n${body}\n`,
            {mode: 0o755});
    stub('sudo', 'exec "$@"');
    // The key fetch writes to whatever follows -o, which is how the helper's
    // key-before-sources ordering becomes observable at all.
    stub('curl', key === 'ok'
        ? 'while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { printf \'KEYBYTES\\n\' > "$2"; exit 0; }; shift; done\nexit 0'
        : 'exit 22');
    stub('gpg', key === 'bad-key'
        ? 'exit 2'
        : 'out=\'\'\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out=$2; shift; done\n[ -n "$out" ] && printf \'DEARMORED\\n\' > "$out"\nexit 0');
    // update always succeeds: a vendor outage shows up as a missing candidate, not as
    // a non-zero update, which is the whole reason the helper checks the candidate.
    stub('apt-get', `case "\${1:-}" in update) exit 0 ;; esac
for a in "$@"; do [ "$a" = install ] && exit ${installStatus}; done
exit 0`);
    // The version table is part of the stub because add_vendor_repo checks where the
    // candidate comes from, not just that there is one: apt reports a candidate for any
    // installed package out of /var/lib/dpkg/status with no repository at all.
    stub('apt-cache', candidate
        ? `printf '  Installed: (none)\\n  Candidate: ${candidate}\\n  Version table:\\n'
printf '     ${candidate} 500\\n        500 https://dbeaver.io/debs/dbeaver-ce  Packages\\n'`
        : "printf '  Installed: (none)\\n  Candidate: (none)\\n  Version table:\\n'");
    stub('dpkg-query', installed
        ? `printf '${installed}\\n'`
        : 'exit 1');
    // Nothing in this subject touches a service, a remote host or an archive. They
    // exist so that a step that wrongly reached for one is a logged line, not a
    // "command not found" that a declining run would hide.
    for (const name of ['systemctl', 'scp', 'ssh', 'tar', 'findmnt', 'snap', 'dpkg']) stub(name, 'exit 0');

    const osRelease = path.join(home, 'os-release');
    fs.writeFileSync(osRelease, release === 'ubuntu'
        ? 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n'
        : release === 'debian'
            ? 'ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n'
            : 'ID=fedora\nPRETTY_NAME="Fedora Linux 43"\n');
    const result = spawnSync('bash', [script, ...args], {
        encoding: 'utf8', timeout: 60000, input: answers,
        env: {HOME: home, PATH: bin, DEBIAN_SETUP_OS_RELEASE: osRelease,
            DEBIAN_SETUP_ETC_ROOT: aptRoot},
    });
    return {result, home, aptRoot,
        log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
        sources: path.join(aptRoot, 'etc/apt/sources.list.d/dbeaver.list'),
        keyring: path.join(aptRoot, 'etc/apt/keyrings/dbeaver.gpg')};
};
const clean = (s) => fs.rmSync(s.home, {recursive: true, force: true});

// Arguments and guards, before any step can run.
{
    const bad = scenario({args: ['--invalid']});
    assert.equal(bad.result.status, 2, 'An unknown argument is a usage error, exit 2');
    assert.equal(bad.log, '', 'A usage error runs no command at all');
    clean(bad);
    const help = scenario({args: ['--help']});
    assert.equal(help.result.status, 0, '--help exits 0');
    assert.match(help.result.stdout, /setup-dbeaver\.sh \[--dry-run\]/, '--help names the usage');
    assert.equal(help.log, '', '--help runs no command at all');
    clean(help);
    const fedora = scenario({release: 'fedora', args: ['--dry-run']});
    assert.equal(fedora.result.status, 1, 'An unsupported distribution is refused');
    assert.match(fedora.result.stderr, /Debian 13 and Ubuntu 26\.04/,
        'And the refusal names the releases that are supported');
    clean(fedora);
}

// A run of all-no: nothing fetched, nothing installed, nothing written, exit 0.
{
    const s = scenario({answers: 'n\n'.repeat(12)});
    assert.equal(s.result.status, 0, `Declining everything is a success: ${s.result.stderr}`);
    assert.doesNotMatch(s.log, /curl/, 'A declining run must not fetch the signing key');
    assert.doesNotMatch(s.log, /apt-get/, 'A declining run must not run apt at all');
    assert.doesNotMatch(s.log, /scp|ssh|systemctl/, 'And must touch no host and no service');
    assert.ok(!fs.existsSync(s.aptRoot), 'A declining run creates no apt configuration');
    // The repository is the only source of the package, so declining it must say what
    // the second step would have had nothing to install from.
    assert.match(s.result.stdout, /dbeaver-ce/, 'Name the package even when declined');
    clean(s);
}

// A preview: every question answered yes, and still not one byte written or fetched.
{
    const s = scenario({args: ['--dry-run']});
    assert.equal(s.result.status, 0, `A preview exits 0: ${s.result.stderr}`);
    assert.doesNotMatch(s.log, /curl/, 'A preview fetches no key: it is a preview');
    assert.ok(!fs.existsSync(s.aptRoot), 'A preview writes no sources file and no keyring');
    assert.match(s.result.stdout, /dbeaver\.io\/debs\/dbeaver-ce \//,
        'A preview names the flat sources line it would write');
    clean(s);
}

// The flat repository, which is the shape this subject exists to prove: the sources
// line ends in a bare slash, because dbeaver.io/debs/dbeaver-ce/dists/ is a 404.
{
    const s = scenario();
    assert.equal(s.result.status, 0, `An accepted run with working stubs exits 0: ${s.result.stderr}`);
    const line = fs.readFileSync(s.sources, 'utf8');
    assert.match(line, /^deb \[signed-by=\S+\/etc\/apt\/keyrings\/dbeaver\.gpg\] https:\/\/dbeaver\.io\/debs\/dbeaver-ce \/\n$/,
        'The sources line is signed-by its own keyring and ends in a bare slash');
    assert.doesNotMatch(line, /dists/, 'A flat repository names no suite: dists/ is a 404 here');
    assert.ok(fs.existsSync(s.keyring), 'The dearmored key is installed beside it');
    assert.match(s.log, /apt-get update/, 'The step owns its update, never the shared one');
    assert.doesNotMatch(line, /trusted=yes/, 'A key is fetched, so nothing is trusted unsigned');
    // Within this run too, not only in the helper's own test: a sources file that
    // existed before its key would make the next apt-get update fail.
    assert.ok(s.log.indexOf('curl') < s.log.indexOf('apt-get'),
        'The key is fetched before apt is asked about anything');
    assert.match(s.result.stdout, /dbeaver-ce 26\.2\.2/, 'Report the candidate it verified');
    assert.match(s.log, /apt-get install -y dbeaver-ce/, 'And install the package');
    // The .deb declares no Depends at all, so nothing in apt will ever report the
    // missing GTK 3; the script has to say where it comes from instead.
    assert.match(s.result.stdout, /no Depends/i, 'Say that the package declares no dependencies');
    assert.match(s.result.stdout, /GTK 3/, 'Name what it needs anyway');
    assert.match(s.result.stdout, /bare server.*first launch|first launch.*bare server/is,
        'Say that a machine without the desktop groups fails at first launch');
    assert.match(s.result.stdout, /not verified|could not verify/i,
        'Say plainly what this script could not verify');
    clean(s);
}

// Both releases, one repository: Ubuntu gets the same single flat line.
{
    const debian = scenario();
    const ubuntu = scenario({release: 'ubuntu'});
    assert.equal(ubuntu.result.status, 0, `Ubuntu exits 0 too: ${ubuntu.result.stderr}`);
    assert.equal(fs.readFileSync(ubuntu.sources, 'utf8').replace(ubuntu.aptRoot, ''),
        fs.readFileSync(debian.sources, 'utf8').replace(debian.aptRoot, ''),
        'DBeaver publishes one repository for both releases, with no suite to vary');
    assert.match(ubuntu.result.stdout, /Ubuntu/, 'Name the release it detected');
    assert.match(debian.result.stdout, /Debian/, 'On Debian too');
    clean(debian);
    clean(ubuntu);
}

// The vendor host is unreachable: apt-get update still exits 0 and prints
// "W: Failed to fetch", so the missing candidate is the only evidence of failure.
{
    const s = scenario({candidate: ''});
    assert.notEqual(s.result.status, 0, 'A repository that offered nothing is a failed run');
    assert.ok(!fs.existsSync(s.sources), 'The sources file is removed again');
    assert.ok(!fs.existsSync(s.keyring), 'And the keyring with it');
    assert.doesNotMatch(s.log, /apt-get install -y dbeaver-ce/,
        'With no repository there is nothing to install from, so it is not attempted');
    assert.match(s.result.stdout, /Steps that failed/, 'The summary names the failure');
    assert.match(s.result.stdout, /dbeaver/, 'By name');
    clean(s);
}

// The key cannot be fetched: no sources file may exist, because a sources file with
// no key makes every later apt-get update fail, install.sh's deliberately fatal one
// among them. That would break a working machine instead of failing this step.
{
    const s = scenario({key: 'no-key'});
    assert.notEqual(s.result.status, 0, 'A failed key fetch is a failed run');
    assert.ok(!fs.existsSync(s.sources), 'No sources file may be left behind');
    assert.doesNotMatch(s.log, /apt-get update/, 'Nothing was added, so nothing is updated');
    assert.doesNotMatch(s.log, /apt-get install/, 'And nothing is installed');
    clean(s);
    const bad = scenario({key: 'bad-key'});
    assert.notEqual(bad.result.status, 0, 'A key that is not a key is a failed run');
    assert.ok(!fs.existsSync(bad.sources), 'An unusable key must not leave a sources file');
    clean(bad);
}

// The repository is live and the install fails anyway: the run must report it and
// exit non-zero, because install.sh reaches this script through attempt and would
// otherwise turn the whole subject into one unexplained line.
{
    const s = scenario({installStatus: 100});
    assert.notEqual(s.result.status, 0, 'A failed install is a failed run');
    assert.match(s.result.stdout, /Steps that failed/, 'The summary names it');
    assert.match(s.result.stdout, /apt-get install -y dbeaver-ce/, 'With the step that failed');
    assert.ok(fs.existsSync(s.sources),
        'A live repository stays: the failure was the install, not the repository');
    clean(s);
}

// Already installed: the version on disk is named, so the user knows this is an
// upgrade route rather than a first install.
{
    const s = scenario({installed: '26.1.0'});
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.match(s.result.stdout, /26\.1\.0/, 'Name the version already installed');
    clean(s);
}

// Nothing in this script may invent a package route the map does not carry: the map
// row is a where=none pointer, and the script is what the note points at.
{
    const map = fs.readFileSync(path.join(root, 'packages/apt-map.tsv'), 'utf8')
        .split('\n').filter((l) => l.startsWith('dbeaver\t'));
    assert.equal(map.length, 1, 'The map carries exactly one dbeaver row');
    const [, arch, apt, where, note] = map[0].split('\t');
    assert.equal(arch, 'dbeaver-ce');
    assert.equal(apt, '-', 'No archive resolves the name, so there is no apt column');
    assert.equal(where, 'none');
    assert.match(note, /setup-dbeaver\.sh/, 'And the note points at this script');
    const body = fs.readFileSync(script, 'utf8');
    assert.match(body, /map_group_packages .*dbeaver/,
        'The script reads its group from the map rather than hard-coding the row');
    assert.doesNotMatch(body, /\becho\b/, 'printf, never echo');
    assert.doesNotMatch(body, /dpkg -i/,
        'The time_t transition makes dpkg -i fail where apt-get install succeeds');
}

console.log('setup-dbeaver-smoke: all checks passed');
