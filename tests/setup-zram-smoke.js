// SPDX-License-Identifier: GPL-3.0-only
// setup-zram.sh against stubs. Nothing here touches apt, systemd or the network:
// /proc/meminfo is read through DEBIAN_SETUP_MEMINFO, /etc is prefixed by
// DEBIAN_SETUP_ETC_ROOT, and every external command the script can reach is a stub
// inside a mkdtemp directory that logs what it was called with.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zram-smoke-'));
const osRelease = (body, name) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, body);
    return file;
};
const debian = osRelease('ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const ubuntu = osRelease('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n', 'ubuntu');

// The machine this configuration comes from: 30 GiB of RAM and a 59 GiB swap
// partition. kB, as the kernel writes it, because the script has to divide.
const meminfo = (name, {memTotal = 32388600, swapTotal = 61865984, extra = true} = {}) => {
    const file = path.join(scratch, `meminfo-${name}`);
    const lines = [];
    if (memTotal !== null) lines.push(`MemTotal:       ${memTotal} kB`);
    if (extra) lines.push(`MemFree:         2048000 kB`, `MemAvailable:   14000000 kB`);
    if (swapTotal !== null) lines.push(`SwapTotal:      ${swapTotal} kB`);
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return file;
};
const laptop = meminfo('laptop');

// This machine runs apt, systemd and a real network. A PATH built from a named list
// is the only way to be sure the script reached a stub and not the real thing: the
// sway smoke test does the same, for the same reason.
const minimalPath = (home) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zram-path-'));
    for (const command of ['bash', 'sh', 'awk', 'cat', 'chmod', 'chown', 'cmp', 'cp', 'date', 'dirname',
        'env', 'grep', 'id', 'install', 'mkdir', 'mktemp', 'rm', 'sort', 'stat', 'tail', 'unlink']) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
    return dir;
};

// Every command that could reach the network, apt or the init system, logging what
// it was asked to do. curl and scp are here to be proved unused: this subject is
// pure apt, and a test that downloads anything passes or fails with the network.
const stubs = (dir, log, {apt = 0, systemctl = 0} = {}) => {
    fs.writeFileSync(path.join(dir, 'sudo'), `#!/bin/sh\necho "sudo $*" >> ${log}\nexec "$@"\n`, {mode: 0o755});
    fs.writeFileSync(path.join(dir, 'apt-get'), `#!/bin/sh\necho "apt-get $*" >> ${log}\nexit ${apt}\n`, {mode: 0o755});
    fs.writeFileSync(path.join(dir, 'apt-cache'),
        `#!/bin/sh\necho "apt-cache $*" >> ${log}\nprintf '  Candidate: 1.2.1-2\\n'\n`, {mode: 0o755});
    fs.writeFileSync(path.join(dir, 'systemctl'),
        `#!/bin/sh\necho "systemctl $*" >> ${log}\nexit ${systemctl}\n`, {mode: 0o755});
    for (const name of ['curl', 'wget', 'scp', 'ssh', 'gpg', 'tar', 'dpkg-query', 'findmnt',
        'zramctl', 'swapon']) {
        fs.writeFileSync(path.join(dir, name), `#!/bin/sh\necho "${name} $*" >> ${log}\nexit 0\n`, {mode: 0o755});
    }
};

// One run of the script, with its own home, its own prefixed /etc and its own log.
const zram = ({args = [], answers = 'n', release = debian, mem = laptop, apt = 0,
    systemctl = 0, seed = null, times = 20} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zram-home-'));
    const bin = minimalPath(home);
    const log = path.join(home, 'calls');
    stubs(bin, log, {apt, systemctl});
    const aptRoot = path.join(home, 'root');
    const conf = path.join(aptRoot, 'etc/systemd/zram-generator.conf');
    // The file the package ships, which is the whole reason this script is small:
    // an active [zram0] already exists before anything here runs.
    const shipped = path.join(aptRoot, 'usr/lib/systemd/zram-generator.conf');
    fs.mkdirSync(path.dirname(shipped), {recursive: true});
    fs.writeFileSync(shipped, '[zram0]\nzram-size = min(ram / 2, 4096)\ncompression-algorithm = zstd lz4 (type=huge)\n');
    if (seed !== null) {
        fs.mkdirSync(path.dirname(conf), {recursive: true});
        fs.writeFileSync(conf, seed);
    }
    const result = spawnSync('bash', [path.join(root, 'setup-zram.sh'), ...args], {
        encoding: 'utf8', timeout: 60000, input: `${answers}\n`.repeat(times),
        env: {PATH: bin, HOME: home, DEBIAN_SETUP_OS_RELEASE: release,
            DEBIAN_SETUP_MEMINFO: mem, DEBIAN_SETUP_ETC_ROOT: aptRoot,
            DEBIAN_SETUP_OPT_ROOT: path.join(home, 'opt'),
            DEBIAN_SETUP_SHARE_ROOT: path.join(home, 'share')},
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    const written = fs.existsSync(conf) ? fs.readFileSync(conf, 'utf8') : null;
    const state = path.join(home, '.local/state/debian-desktop-setup');
    const backups = fs.existsSync(state) ? fs.readdirSync(state) : [];
    return {result, calls, written, conf, home, bin, backups, state,
        clean: () => {
            fs.rmSync(bin, {recursive: true, force: true});
            fs.rmSync(home, {recursive: true, force: true});
        }};
};
// Nothing in this subject downloads anything: proving the stub was never called is
// how the test stays independent of whether this machine has a network at all.
const noNetwork = (calls) => {
    assert.doesNotMatch(calls, /^curl /m, 'zram is pure apt: nothing may be downloaded');
    assert.doesNotMatch(calls, /^scp |^ssh |^wget /m, 'Nothing here reaches another host');
};

// Arguments and guards.
{
    const bad = zram({args: ['--invalid']});
    assert.equal(bad.result.status, 2, 'An unknown argument is a usage error');
    bad.clean();
    const help = zram({args: ['--help']});
    assert.equal(help.result.status, 0);
    assert.match(help.result.stdout, /setup-zram\.sh/, 'The help names the script');
    help.clean();
    const fedora = zram({args: ['--dry-run'], release: osRelease('ID=fedora\n', 'fedora')});
    assert.equal(fedora.result.status, 1, 'An unsupported distribution stops the script');
    assert.match(fedora.result.stderr, /Debian 13 and Ubuntu 26\.04/);
    fedora.clean();
}

// A preview writes nothing at all, and still shows both numbers the decision needs.
{
    const preview = zram({args: ['--dry-run'], answers: 'y'});
    assert.equal(preview.result.status, 0, preview.result.stderr);
    assert.match(preview.result.stdout, /31629 MB/, 'Show the RAM this machine actually reports');
    assert.match(preview.result.stdout, /30 GiB/, 'In a unit a human reads');
    assert.match(preview.result.stdout, /8192/, 'And the size it computed from it');
    assert.match(preview.result.stdout, /min\(ram \/ 2, 4096\)|min\(RAM \/ 2, 4096\)/,
        'Name the shipped default that is already active');
    assert.equal(preview.written, null, 'A preview writes no configuration');
    assert.deepEqual(preview.backups, [], 'A preview creates no backup directory');
    assert.doesNotMatch(preview.calls, /apt-get install/, 'A preview installs nothing');
    assert.doesNotMatch(preview.calls, /systemctl/, 'A preview touches no unit');
    noNetwork(preview.calls);
    preview.clean();
}

// All-no changes nothing, exits 0, and says what is still true afterwards: the
// shipped [zram0] is active whether or not this script was allowed to do anything.
{
    const declined = zram({answers: 'n'});
    assert.equal(declined.result.status, 0, declined.result.stderr);
    assert.equal(declined.written, null, 'Declining writes no configuration');
    assert.deepEqual(declined.backups, [], 'And backs nothing up');
    assert.doesNotMatch(declined.calls, /apt-get install/, 'Declining installs nothing');
    assert.doesNotMatch(declined.calls, /systemctl/, 'Declining touches no unit');
    assert.match(declined.result.stdout, /shipped default.*(already active|is active)/i,
        'Declining must say the shipped default is already active, not that nothing happens');
    assert.match(declined.result.stdout, /8192/, 'The numbers are shown before any consent');
    noNetwork(declined.calls);
    declined.clean();
}

// All-yes on this machine: the package from the map, the computed cap in the file
// the generator actually reads, and the unit started by name.
{
    const run = zram({answers: 'y'});
    assert.equal(run.result.status, 0, run.result.stderr + run.result.stdout);
    assert.match(run.calls, /apt-get install -y .*systemd-zram-generator/,
        'The package name comes from the map, systemd- prefix and all');
    assert.ok(run.written, 'The configuration is written');
    assert.match(run.written, /^\[zram0\]$/m, 'The section the generator reads');
    assert.match(run.written, /^zram-size = 8192$/m,
        'A plain computed number: a bad expression makes the generator exit 1');
    assert.match(run.calls, /systemctl daemon-reload/, 'systemd is told to re-read the generators');
    assert.match(run.calls, /systemctl start systemd-zram-setup@zram0\.service/,
        'And the device is started by its generated unit name');
    assert.match(run.result.stdout, /swapon --show|zramctl/, 'Say how to check it');
    noNetwork(run.calls);
    run.clean();
}

// The size is computed, not remembered: 10 GiB of RAM is under the 8192 cap.
{
    const small = zram({answers: 'y', mem: meminfo('10g', {memTotal: 10 * 1024 * 1024})});
    assert.equal(small.result.status, 0, small.result.stderr);
    assert.match(small.written, /^zram-size = 5120$/m, 'half the RAM, because it is under the cap');
    small.clean();
}

// Under the shipped cap there is nothing to raise, so the honest outcome is to
// write nothing and say why — not to rewrite the default as if it were a change.
{
    const tiny = zram({answers: 'y', mem: meminfo('6g', {memTotal: 6 * 1024 * 1024})});
    assert.equal(tiny.result.status, 0, tiny.result.stderr);
    assert.equal(tiny.written, null, 'Nothing to raise means nothing is written');
    assert.match(tiny.result.stdout, /3072/, 'Still show what the default gives this machine');
    assert.match(tiny.result.stdout, /nothing to raise|already gives|no reason to write/i,
        'And say why no file was written');
    tiny.clean();
}

// Honest about what zram is for: with 59 GiB of disk swap already active it buys
// latency, not capacity. With no swap at all it is the only swap there is.
{
    const withSwap = zram({args: ['--dry-run']});
    assert.match(withSwap.result.stdout, /latency/i, 'Say what zram buys on a machine with swap');
    assert.match(withSwap.result.stdout, /not a capacity/i, 'And what it does not buy');
    assert.match(withSwap.result.stdout, /60416 MB|59 GiB/, 'Name the swap it found');
    withSwap.clean();
    const noSwap = zram({args: ['--dry-run'], mem: meminfo('noswap', {swapTotal: 0})});
    assert.equal(noSwap.result.status, 0, noSwap.result.stderr);
    assert.match(noSwap.result.stdout, /only swap|no .*swap (partition|device|is active)/i,
        'With no disk swap, zram is the machine\'s only swap and that changes the advice');
    noSwap.clean();
}

// An existing file is backed up before it is replaced.
{
    const seeded = zram({answers: 'y', seed: '[zram0]\nzram-size = 1024\n'});
    assert.equal(seeded.result.status, 0, seeded.result.stderr);
    assert.match(seeded.written, /zram-size = 8192/, 'The new value lands');
    assert.equal(seeded.backups.length, 1, 'The replaced file is backed up exactly once');
    const backup = path.join(seeded.state, seeded.backups[0], 'zram-generator.conf');
    assert.ok(fs.existsSync(backup), `The backup is readable: ${backup}`);
    assert.match(fs.readFileSync(backup, 'utf8'), /zram-size = 1024/, 'And it is the old file');
    assert.match(seeded.result.stdout, /zram-size = 1024/, 'Show what is there before replacing it');
    seeded.clean();
}
// Declining the replacement leaves the existing file exactly as it was.
{
    const kept = zram({answers: 'n', seed: '[zram0]\nzram-size = 1024\n'});
    assert.equal(kept.result.status, 0, kept.result.stderr);
    assert.equal(kept.written, '[zram0]\nzram-size = 1024\n', 'A declined replacement changes nothing');
    assert.match(kept.result.stdout, /Left alone at your request/, 'And is named in the summary');
    kept.clean();
}

// A failed apt-get update must not be followed by an install against stale lists,
// and the run must exit non-zero: install.sh reaches this script through attempt.
{
    const broken = zram({answers: 'y', apt: 100});
    assert.equal(broken.result.status, 1, 'A failed step makes the whole script fail');
    assert.match(broken.result.stdout, /Steps that failed:/, 'The failure is named');
    assert.match(broken.result.stdout, /apt-get/, 'By the command that failed');
    assert.doesNotMatch(broken.calls, /apt-get install/,
        'A failed update must not be followed by an install against stale lists');
    broken.clean();
}
// A failed systemctl is recorded too, and does not stop the summary.
{
    const unit = zram({answers: 'y', systemctl: 1});
    assert.equal(unit.result.status, 1, 'A unit that would not start is a failure');
    assert.match(unit.result.stdout, /Steps that failed:/);
    assert.match(unit.result.stdout, /systemctl/, 'Named by what failed');
    assert.ok(unit.written, 'The configuration it already wrote is still reported');
    unit.clean();
}

// Ubuntu keeps the package in universe, so that step may fail on a machine with
// universe off: it must be an attempt, which is to say the script still finishes.
{
    const universe = zram({answers: 'y', release: ubuntu, apt: 0});
    assert.equal(universe.result.status, 0, universe.result.stderr);
    assert.match(universe.result.stdout, /universe/i, 'Say where Ubuntu keeps this package');
    universe.clean();
}

// The one number everything depends on: an unreadable or unparsable meminfo must
// stop the script rather than compute a size from nothing.
{
    const missing = zram({args: ['--dry-run'], mem: path.join(scratch, 'absent-meminfo')});
    assert.equal(missing.result.status, 1, 'No meminfo, no size');
    assert.match(missing.result.stderr, /meminfo/, 'Name the file it could not read');
    missing.clean();
    const empty = zram({args: ['--dry-run'], mem: meminfo('nomem', {memTotal: null, extra: false})});
    assert.equal(empty.result.status, 1, 'A meminfo with no MemTotal is not a size either');
    assert.match(empty.result.stderr, /MemTotal/, 'Name what was missing from it');
    empty.clean();
}

// The closing output must not imply what no test and no container can show: the
// generator prints "Running in a container, exiting", so a generated unit and a
// live swap device are confirmed on the machine, not here.
{
    const run = zram({args: ['--dry-run'], answers: 'y'});
    assert.match(run.result.stdout, /container/i,
        'Say that the generator refuses to run in a container');
    assert.match(run.result.stdout, /could not|cannot|not verif|unverified|confirm/i,
        'And that unit generation and swapon are unverified by this script');
    run.clean();
}

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-zram-smoke: all checks passed');
