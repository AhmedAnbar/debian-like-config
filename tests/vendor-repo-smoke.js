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
const scenario = ({key = 'ok', candidate = '26.2.2', update = 0, pin = ''} = {}) => {
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
    fs.writeFileSync(path.join(bin, 'apt-cache'), candidate
        ? `#!/bin/sh\necho "apt-cache $*" >> ${log}\nprintf '  Installed: (none)\\n  Candidate: ${candidate}\\n'\n`
        : `#!/bin/sh\necho "apt-cache $*" >> ${log}\nprintf '  Installed: (none)\\n  Candidate: (none)\\n'\n`, {mode: 0o755});
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

console.log('vendor-repo-smoke: all checks passed');
