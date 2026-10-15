// SPDX-License-Identifier: GPL-3.0-only
// setup-snapshots.sh against stubs only. Nothing real is reached: no apt, no
// systemctl, no btrfs tooling, no network, and every write lands under a mkdtemp
// directory through DEBIAN_SETUP_ETC_ROOT. findmnt is a stub in every case below,
// so both the btrfs and the not-btrfs path are exercised whatever filesystem this
// test happens to run on.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'setup-snapshots.sh');

// The minimalPath() trick from tests/setup-sway-smoke.js: a PATH built from a named
// list, so the test and not this machine decides what exists. btrbk and snapper are
// absent here, and anything the script can reach is a stub that only writes a log.
const sandbox = ({fstype = 'btrfs', apt = 0, findmnt = true, volumeMounted = true,
    release = 'debian'} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshots-smoke-'));
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(home, 'calls');
    for (const command of ['bash', 'sh', 'cat', 'chmod', 'chown', 'cmp', 'cp', 'date', 'dirname', 'env',
        'id', 'install', 'mkdir', 'mktemp', 'sort', 'stat', 'tail', 'unlink', 'awk', 'rm',
        'grep', 'basename']) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(bin, command));
    }
    const stub = (name, body) =>
        fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${log}\n${body}\n`,
            {mode: 0o755});
    // findmnt answers per path, so the stub does too: with volumeMounted false, / is
    // btrfs and the volume directory is a plain directory nothing is mounted on.
    const findmntBody = !fstype ? 'exit 0'
        : volumeMounted ? `printf '%s\\n' ${fstype}`
            : `for last; do :; done\n[ "$last" = / ] && printf '%s\\n' ${fstype}\nexit 0`;
    if (findmnt) stub('findmnt', findmntBody);
    stub('apt-get', `exit ${apt}`);
    stub('snapper', 'exit 0');
    stub('systemctl', 'exit 0');
    // Enough of a btrfs to satisfy the next step's existence check, and nothing more.
    stub('btrfs', '[ "$1" = subvolume ] && [ "$2" = create ] && mkdir -p "$3"\nexit 0');
    stub('btrbk', 'exit 0');
    // sudo logs before it execs, which is how the hermeticity assertions below read
    // back every system path this script asked root to write.
    fs.writeFileSync(path.join(bin, 'sudo'),
        `#!/bin/sh\necho "sudo $*" >> ${log}\nexec "$@"\n`, {mode: 0o755});
    // Nothing in this subject downloads or copies anything from anywhere. These exist
    // so that reaching for them is a recorded, failing call rather than a silent one.
    for (const name of ['curl', 'wget', 'scp', 'ssh', 'gpg', 'tar']) stub(name, 'exit 1');
    const osRelease = path.join(home, 'os-release');
    fs.writeFileSync(osRelease, release === 'ubuntu'
        ? 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n'
        : release === 'debian'
            ? 'ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n'
            : 'ID=fedora\nPRETTY_NAME="Fedora Linux 43"\n');
    const aptRoot = path.join(home, 'root');
    const pool = path.join(home, 'pool');
    fs.mkdirSync(pool);
    const run = (args = [], input = '\n'.repeat(40), extra = {}) => spawnSync('bash',
        [script, ...args], {
            encoding: 'utf8', timeout: 60000, input,
            env: {
                HOME: home, PATH: bin, TMPDIR: home,
                DEBIAN_SETUP_OS_RELEASE: osRelease,
                DEBIAN_SETUP_ETC_ROOT: aptRoot,
                DEBIAN_SETUP_BTRFS_VOLUME: pool,
                ...extra,
            },
        });
    return {
        home, bin, aptRoot, pool, run,
        conf: path.join(aptRoot, 'etc/btrbk/btrbk.conf'),
        calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''),
        clean: () => fs.rmSync(home, {recursive: true, force: true}),
    };
};

// Arguments and guards.
{
    const s = sandbox();
    assert.equal(s.run(['--invalid']).status, 2, 'An unknown argument is a usage error');
    assert.equal(s.run(['--help']).status, 0, '--help is not an error');
    assert.match(s.run(['--help']).stdout, /btrfs/i, '--help says what filesystem this needs');
    s.clean();
}
{
    const s = sandbox({release: 'fedora'});
    const result = s.run(['--dry-run'], 'y\n'.repeat(40));
    assert.equal(result.status, 1, 'An unsupported distribution is refused');
    assert.match(result.stderr, /Debian 13 and Ubuntu 26\.04/, 'And says which are supported');
    s.clean();
}

// Not btrfs: the findmnt check is the gate, every step skips with a reason, and the
// run is still a success — there is nothing wrong with an ext4 machine.
{
    const s = sandbox({fstype: 'ext4'});
    const result = s.run([], 'y\n'.repeat(40));
    assert.equal(result.status, 0, result.stderr);
    assert.match(s.calls(), /findmnt -no FSTYPE \//, 'The filesystem is read, not assumed');
    assert.match(result.stdout, /ext4/, 'Name the filesystem it actually found');
    assert.match(result.stdout, /btrfs/, 'And the one every step here needs');
    assert.match(result.stdout, /btrbk/, 'Say by name what was skipped');
    assert.match(result.stdout, /snapper/, 'Both routes, not just the first');
    assert.doesNotMatch(s.calls(), /apt-get install/, 'An ext4 machine installs nothing');
    assert.doesNotMatch(s.calls(), /systemctl/, 'And no service is touched');
    assert.doesNotMatch(s.calls(), /^snapper/m, 'And snapper is never configured');
    assert.ok(!fs.existsSync(s.aptRoot), 'And no system file is written');
    s.clean();
}

// findmnt itself missing: unknown is not btrfs, and the same skip applies.
{
    const s = sandbox({findmnt: false});
    const result = s.run([], 'y\n'.repeat(40));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /findmnt/, 'Name the tool it could not run');
    assert.ok(!fs.existsSync(s.aptRoot), 'An unknown filesystem is written to no more than an ext4 one');
    s.clean();
}

// A preview writes nothing at all, and still shows the configuration it would install.
{
    const s = sandbox();
    // The seam is cleared here so the preview shows the real default volume directory.
    const result = s.run(['--dry-run'], 'y\n'.repeat(40), {DEBIAN_SETUP_BTRFS_VOLUME: ''});
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(s.aptRoot), 'A preview writes no system file');
    assert.doesNotMatch(s.calls(), /apt-get install/, 'A preview installs nothing');
    assert.doesNotMatch(s.calls(), /btrfs subvolume create/, 'A preview creates no subvolume');
    assert.doesNotMatch(s.calls(), /systemctl enable/, 'A preview enables nothing');
    assert.doesNotMatch(s.calls(), /^snapper .*create-config/m, 'A preview configures no snapper');
    assert.match(result.stdout, /snapshot_preserve/, 'The retention is shown before it is agreed to');
    assert.match(result.stdout, /snapshot_dir\s+snaps/, 'And where the snapshots go');
    assert.match(result.stdout, /volume \/mnt\/btrfs-root/,
        'The default volume directory is a real path, not the test seam');
    s.clean();
}

// Declining by default: an empty answer is a no, and a run of nothing but defaults
// changes nothing and succeeds.
{
    const s = sandbox();
    const result = s.run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(s.conf), 'A declined configuration is not installed');
    assert.doesNotMatch(s.calls(), /apt-get install/, 'A declined package step installs nothing');
    assert.doesNotMatch(s.calls(), /systemctl enable/, 'A declined timer is not enabled');
    assert.doesNotMatch(s.calls(), /create-config/, 'A declined snapper is not configured');
    s.clean();
}

// The snapper prompt has to carry the cost it imposes on every later apt run in this
// repository, and the escape hatch in the same breath.
{
    const s = sandbox();
    const result = s.run(['--dry-run'], '\n'.repeat(40));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /80snapper/, 'Name the hook file that does it');
    assert.match(result.stdout, /every later apt|every apt/i, 'Say that it is every apt run');
    assert.match(result.stdout, /DISABLE_APT_SNAPSHOT="yes"/, 'And how to skip it');
    assert.match(result.stdout, /\/etc\/snapper\/configs\/root/, 'And what switches it on');
    // timeshift is refused in its own words, which is the whole argument against it.
    assert.match(result.stdout,
        /Only ubuntu-type layouts with @ and @home subvolumes are currently supported/,
        'timeshift is rejected in its own words');
    s.clean();
}

// All yes on a btrfs root: packages from the map, the configuration installed into
// /etc, the snapshot directory created, the timer enabled, snapper configured.
{
    const s = sandbox();
    const result = s.run([], 'y\n'.repeat(40));
    assert.equal(result.status, 0, result.stderr);
    const calls = s.calls();
    assert.match(calls, /apt-get install -y .*btrbk/, 'btrbk comes from apt');
    assert.match(calls, /apt-get install -y .*btrfs-progs/, 'And the subvolume tooling with it');
    assert.ok(fs.existsSync(s.conf), `Nothing installed ${s.conf}`);
    assert.equal(fs.statSync(s.conf).mode & 0o777, 0o644, 'A configuration file is not executable');
    const conf = fs.readFileSync(s.conf, 'utf8');
    assert.match(conf, /^snapshot_preserve_min\s+\S+$/m, 'The retention floor is stated');
    assert.match(conf, /^snapshot_preserve\s+\S+$/m, 'And the retention itself');
    assert.match(conf, /^\s+snapshot_dir\s+snaps$/m, 'Snapshots go into snaps/');
    assert.match(conf, /^\s+subvolume\s+@$/m, 'The root subvolume is what is snapshotted');
    assert.match(conf, new RegExp(`^volume ${s.pool}$`, 'm'),
        'The volume directory is the one the run was given');
    assert.match(calls, new RegExp(`btrfs subvolume create ${s.pool}/snaps`),
        'The snapshot directory is created, because btrbk does not create it');
    assert.match(calls, /btrbk (-n|--dry-run|-v -n) run|btrbk -n run/,
        'The installed configuration is checked with a dry run, not left to the first timer');
    assert.match(calls, /systemctl enable --now btrbk\.timer/, 'The schedule is a timer');
    assert.match(calls, /apt-get install -y .*snapper/, 'snapper is its own install');
    assert.match(calls, /snapper -c root create-config \//, 'And its own root configuration');

    // Hermeticity, proved rather than asserted in prose: every path this script asked
    // root to write is under the scratch directory, and nothing fetched anything.
    for (const line of calls.split('\n').filter((l) => l.startsWith('sudo install'))) {
        assert.ok(line.includes(s.aptRoot), `A system write escaped the scratch root: ${line}`);
    }
    for (const name of ['curl', 'wget', 'scp', 'ssh', 'gpg', 'tar']) {
        assert.doesNotMatch(calls, new RegExp(`^${name} `, 'm'),
            `${name} was called: this subject is pure apt and must never reach the network`);
    }
    s.clean();
}

// A directory is not a mount. /mnt/btrfs-root can exist as an empty placeholder on the
// btrfs root with nothing mounted on it, and btrfs subvolume create succeeds inside it
// -- which leaves btrbk snapshotting a path that is not the top-level subvolume, with
// every command having reported success. What findmnt says about that directory is the
// question; whether the directory exists is not.
{
    const s = sandbox({volumeMounted: false});
    const result = s.run([], 'y\n'.repeat(40));
    assert.equal(result.status, 0, result.stderr);
    assert.match(s.calls(), new RegExp(`findmnt -no FSTYPE -- ${s.pool}`),
        'The volume directory is asked about by name, not inferred from the root');
    assert.doesNotMatch(s.calls(), /btrfs subvolume create/,
        'Nothing is created inside a placeholder that is not the mounted volume');
    assert.match(result.stdout, /exists but nothing is mounted there/,
        'And the reason says so, rather than reporting a success');
    assert.match(result.stdout, new RegExp(`sudo btrfs subvolume create ${s.pool}/snaps`),
        'With the command to run once the volume really is mounted');
    s.clean();
}

// Ubuntu keeps btrbk and snapper in universe, so a failing install must be reported
// and must make the script exit non-zero — install.sh reaches this through attempt.
{
    const s = sandbox({apt: 1, release: 'ubuntu'});
    const result = s.run([], 'y\n'.repeat(40));
    assert.equal(result.status, 1, 'A failed step is a non-zero exit, or install.sh cannot tell');
    assert.match(result.stdout, /Steps that failed:/, 'The summary names what failed');
    assert.match(result.stdout, /apt-get install/, 'By the command that failed');
    s.clean();
}

// An existing /etc/btrbk/btrbk.conf is backed up before it is replaced, and a declined
// replacement leaves it exactly as it was.
{
    const s = sandbox();
    fs.mkdirSync(path.dirname(s.conf), {recursive: true});
    fs.writeFileSync(s.conf, '# someone else wrote this\nvolume /mine\n');
    const declined = s.run([], 'y\nn\n'.repeat(40));
    assert.equal(declined.status, 0, declined.stderr);
    assert.match(fs.readFileSync(s.conf, 'utf8'), /someone else wrote this/,
        'A declined replacement must not be replaced');
    assert.match(declined.stdout, /Left alone at your request:/, 'And is reported as left alone');

    const accepted = s.run([], 'y\n'.repeat(40));
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(fs.readFileSync(s.conf, 'utf8'), /snapshot_preserve/, 'An accepted one is replaced');
    const backups = path.join(s.home, '.local/state/debian-desktop-setup');
    const found = fs.existsSync(backups) ? fs.readdirSync(backups)
        .map((d) => path.join(backups, d, 'btrbk.conf')).filter((f) => fs.existsSync(f)) : [];
    assert.ok(found.length, 'The file that was replaced must be recoverable');
    assert.match(fs.readFileSync(found[0], 'utf8'), /someone else wrote this/,
        'And the backup must be the old content, not the new');
    s.clean();
}

// What the script cannot verify, it has to say rather than imply.
{
    const s = sandbox();
    const result = s.run([], 'y\n'.repeat(40));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /not a backup|no backup/i,
        'A snapshot on the same disk is not a backup, and the user is told so');
    assert.match(result.stdout, /subvolume list/,
        'Say how to check the subvolume layout this configuration assumes');
    assert.match(result.stdout, /could not|not verified|unverified/i,
        'Name what this run could not confirm');
    s.clean();
}

console.log('setup-snapshots-smoke: all checks passed');
