// SPDX-License-Identifier: GPL-3.0-only
// add_vendor_repo against stubs. No repository is added and no apt is run: the
// helper's paths are prefixed by DEBIAN_SETUP_ETC_ROOT so every write lands in a
// scratch directory, the way DEBIAN_SETUP_MAP and DEBIAN_SETUP_OS_RELEASE work.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

// A real PGP key would need gpg and a keyring; the stub dearmors by copying, which
// is all the helper's ordering contract depends on.
const scenario = ({key = 'ok', candidate = '26.2.2', update = 0, pin = '',
    origin = 'https://example.invalid/debs/dbeaver-ce  Packages'} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-repo-'));
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(home, 'calls');
    const aptRoot = path.join(home, 'root');
    fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'curl'), key === 'ok'
        ? `#!/bin/sh\necho "curl $*" >> ${log}\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && { printf 'KEYBYTES\\n' > "$2"; exit 0; }; shift; done\nexit 0\n`
        : `#!/bin/sh\necho "curl $*" >> ${log}\nexit 22\n`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'gpg'), key === 'bad-key'
        ? `#!/bin/sh\necho "gpg $*" >> ${log}\nexit 2\n`
        : `#!/bin/sh\necho "gpg $*" >> ${log}\nout=''\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out=$2; shift; done\n[ -n "$out" ] && printf 'DEARMORED\\n' > "$out"\nexit 0\n`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'apt-get'), `#!/bin/sh\necho "apt-get $*" >> ${log}\nexit ${update}\n`, {mode: 0o755});
    // The real shape of apt-cache policy output, because where the candidate comes from
    // is the whole question: apt reports a candidate for any installed package out of
    // /var/lib/dpkg/status, with no repository configured at all.
    fs.writeFileSync(path.join(bin, 'apt-cache'), candidate
        ? `#!/bin/sh
echo "apt-cache $*" >> ${log}
printf '  Installed: (none)\\n  Candidate: ${candidate}\\n  Version table:\\n'
printf '     ${candidate} 500\\n        500 ${origin}\\n'
`
        : `#!/bin/sh\necho "apt-cache $*" >> ${log}\nprintf '  Installed: (none)\\n  Candidate: (none)\\n  Version table:\\n'\n`,
        {mode: 0o755});
    const probe = `
        dry_run=false; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        add_vendor_repo dbeaver https://example.invalid/key.asc 'deb https://example.invalid/debs/dbeaver-ce /' dbeaver-ce ${pin}
        printf 'returned %s\\n' "$?"
        printf 'failed: %s\\n' "\${failed[*]:-none}"
    `;
    const result = spawnSync('bash', ['-c', probe], {
        encoding: 'utf8', timeout: 20000,
        env: {...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`,
            DEBIAN_SETUP_ETC_ROOT: aptRoot},
    });
    return {result, aptRoot, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', home,
        sources: path.join(aptRoot, 'etc/apt/sources.list.d/dbeaver.list'),
        keyring: path.join(aptRoot, 'etc/apt/keyrings/dbeaver.gpg')};
};

// The happy path: key first, then the sources file, then its own update, then a
// candidate check — and the sources line is written verbatim, trailing slash and all.
{
    const s = scenario();
    assert.match(s.result.stdout, /returned 0/, s.result.stdout + s.result.stderr);
    assert.ok(fs.existsSync(s.keyring), 'The dearmored key is installed');
    assert.equal(fs.readFileSync(s.sources, 'utf8'),
        'deb https://example.invalid/debs/dbeaver-ce /\n',
        "A flat repository's trailing slash must survive verbatim");
    assert.match(s.log, /apt-get update/, 'The helper runs its own update, not the shared one');
    assert.match(s.log, /apt-cache policy -- dbeaver-ce|apt-cache policy dbeaver-ce/,
        'Success is read from the candidate');
    assert.match(s.result.stdout, /26\.2\.2/, 'Report the version it found');
    assert.match(s.result.stdout, /failed: none/, 'Nothing failed');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// The key cannot be fetched: no sources file may exist, because a sources file
// without its key breaks every later apt-get update, including the fatal one.
{
    const s = scenario({key: 'no-key'});
    assert.doesNotMatch(s.result.stdout, /returned 0/, 'A failed key fetch is a failure');
    assert.ok(!fs.existsSync(s.sources), 'No sources file may be left behind');
    assert.ok(!fs.existsSync(s.keyring), 'And no keyring');
    assert.doesNotMatch(s.log, /apt-get update/, 'Nothing was added, so nothing is updated');
    assert.match(s.result.stdout, /failed: .*curl|failed: .*key/i, 'The failure is recorded');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// A key that is not a key: same rule.
{
    const s = scenario({key: 'bad-key'});
    assert.doesNotMatch(s.result.stdout, /returned 0/);
    assert.ok(!fs.existsSync(s.sources), 'An unusable key must not leave a sources file');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// apt-get update exits 0 when the vendor host is unreachable: it prints
// "W: Failed to fetch" and uses the old lists. So a zero exit with no candidate
// is a failure, and the repository is removed again.
{
    const s = scenario({candidate: '', update: 0});
    assert.doesNotMatch(s.result.stdout, /returned 0/,
        'A zero-exit update with no candidate is still a failure');
    assert.ok(!fs.existsSync(s.sources), 'The sources file is removed again');
    assert.ok(!fs.existsSync(s.keyring), 'And the keyring with it');
    assert.match(s.result.stdout, /failed: .*dbeaver/, 'The failure is recorded by name');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// A preview writes nothing at all and still reports what it would do.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-repo-dry-'));
    const aptRoot = path.join(home, 'root');
    const probe = `
        dry_run=true; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        add_vendor_repo dbeaver https://example.invalid/key.asc 'deb https://example.invalid/debs/dbeaver-ce /' dbeaver-ce
        printf 'returned %s\\n' "$?"
    `;
    const result = spawnSync('bash', ['-c', probe], {encoding: 'utf8', timeout: 20000,
        env: {...process.env, HOME: home, PATH: '/usr/bin:/bin', DEBIAN_SETUP_ETC_ROOT: aptRoot}});
    assert.match(result.stdout, /returned 0/, result.stdout + result.stderr);
    assert.match(result.stdout, /example\.invalid/, 'A preview names the key and the sources line');
    assert.ok(!fs.existsSync(aptRoot), 'A preview creates nothing');
    fs.rmSync(home, {recursive: true, force: true});
}

// A re-run is the case the old gate could not see. apt reports a candidate for any
// INSTALLED package straight out of /var/lib/dpkg/status, with no repository at all
// (verified in a debian:trixie container: jq, every source file removed and the lists
// wiped, still reports "Candidate: 1.7.1-6+deb13u4" at priority 100). So on the second
// run of any of these scripts the package is already installed and a numeric candidate
// proves nothing. What must be proved is that the candidate comes from THIS repository.
{
    const s = scenario({origin: '/var/lib/dpkg/status'});
    assert.doesNotMatch(s.result.stdout, /returned 0/,
        'A candidate that comes from dpkg rather than this repository is not success');
    assert.ok(!fs.existsSync(s.sources),
        'And the sources file this run wrote must come off again');
    assert.ok(!fs.existsSync(s.keyring), 'With its keyring');
    assert.match(s.result.stdout, /failed: .*dbeaver/, 'The failure is recorded');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// Nor may the candidate come from some other repository that happens to carry the name.
{
    const s = scenario({origin: 'http://deb.debian.org/debian trixie/main amd64 Packages'});
    assert.doesNotMatch(s.result.stdout, /returned 0/,
        "Another repository's package is not proof that this one works");
    assert.ok(!fs.existsSync(s.sources), 'The sources file comes off again');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// A non-zero apt-get update means the file this run just wrote is broken: a 404 suite
// or an unreadable keyring exits 100 (proved in a container), while an unreachable host
// exits 0. So the exit status is not sufficient -- which is what the recon said -- but
// it is necessary, and ignoring it leaves a sources file that fails every later update.
{
    const s = scenario({update: 100});
    assert.doesNotMatch(s.result.stdout, /returned 0/,
        'An update that failed is a failure, whatever the candidate says');
    assert.ok(!fs.existsSync(s.sources),
        'A sources file that breaks apt must not survive the run that wrote it');
    assert.ok(!fs.existsSync(s.keyring), 'With its keyring');
    assert.match(s.result.stdout + s.result.stderr, /update/i, 'Say what went wrong');
    fs.rmSync(s.home, {recursive: true, force: true});
}

// The update is scoped to the file this run wrote, so a third-party repository that was
// already broken before this script ran cannot be mistaken for this one failing.
{
    const s = scenario();
    assert.match(s.log, /apt-get update[^\n]*Dir::Etc::sourcelist=[^\n]*dbeaver\.list/,
        'The update names this repository alone');
    fs.rmSync(s.home, {recursive: true, force: true});
}

console.log('vendor-repo-smoke: all checks passed');
