// SPDX-License-Identifier: GPL-3.0-only
// setup-zenbook-cpu-cap.sh against stubs. Nothing here needs the laptop, a Debian
// kernel or docker: the model comes from DEBIAN_SETUP_DMI_NAME (or, for one scenario,
// from the Arch script's ZENBOOK_CPU_CAP_DMI_FILE), /etc is prefixed by
// DEBIAN_SETUP_ETC_ROOT, and update-initramfs and dracut are stubs that log what they
// were called with. The container facts this script's prose rests on -- that
// /etc/modprobe.d lands inside a real initramfs on all three distributions, and that
// dpkg says dracut owns /usr/sbin/update-initramfs on Ubuntu and Kali -- were proved
// in docker on 2026-10-16 and belong in tests/extras-container-smoke.js, not here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zenbook-smoke-'));
const osRelease = (body, name) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, body);
    return file;
};
const debian = osRelease('ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const ubuntu = osRelease('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n', 'ubuntu');
const kali = osRelease('ID=kali\nID_LIKE=debian\nPRETTY_NAME="Kali GNU/Linux Rolling"\n', 'kali');

// The exact string all three container userspaces read from
// /sys/class/dmi/id/product_name on this laptop on 2026-10-16.
const thisLaptop = 'ASUS Zenbook S 16 UM5606WA_UM5606WA';
const otherLaptop = 'Dell Inc. XPS 13 9310';

// A PATH built from a named list, as the zram and sway smoke tests do: it is the only
// way to be sure the script reached a stub and not this machine's real initramfs tools.
const minimalPath = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenbook-path-'));
    for (const command of ['bash', 'sh', 'awk', 'basename', 'cat', 'chmod', 'chown', 'cmp', 'cp',
        'date', 'dirname', 'env', 'grep', 'id', 'install', 'mkdir', 'mktemp', 'rm', 'sed', 'sort',
        'stat', 'tail', 'unlink']) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
    return dir;
};

const logger = (dir, name, log, status = 0) =>
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\necho "${name} $*" >> ${log}\nexit ${status}\n`,
        {mode: 0o755});

// A stub update-initramfs that answers --version the way the real commands do, because
// that answer is what the script asks to tell the two generators apart. Verified in
// containers on 2026-10-16: initramfs-tools answers "initramfs-tools 0.151ubuntu1" on
// ubuntu:latest and "initramfs-tools 0.148.4" on debian:stable-slim, and dracut's shim
// answers "dracut 110-11ubuntu0.1" on ubuntu:latest and "dracut 112-6" on Kali. --version
// is not logged: it is a question, not a step, and the scenarios that assert nothing was
// rebuilt are asserting about steps.
const updateInitramfs = (dir, version, log, status = 0) =>
    fs.writeFileSync(path.join(dir, 'update-initramfs'),
        `#!/bin/sh
if [ "$1" = --version ]; then echo "${version}"; exit 0; fi
` +
        `echo "update-initramfs $*" >> ${log}
exit ${status}
`, {mode: 0o755});

// One run, with its own home, its own prefixed /etc and its own call log. generator
// chooses which initramfs world the fake machine lives in:
//   initramfs-tools         update-initramfs answers initramfs-tools, and
//                           /etc/initramfs-tools exists as it does on any such machine
//   dracut-shim             update-initramfs answers dracut, which is a dracut-only
//                           Ubuntu 26.04 or Kali that never had initramfs-tools
//   dracut-shim-conffiles   the same machine after being switched over: dracut owns
//                           update-initramfs and /etc/initramfs-tools is still there,
//                           because apt-get install dracut removes initramfs-tools
//                           (dracut Conflicts: initramfs-tools) and keeps its conffiles
//   dracut                  only dracut is on PATH, which is a dracut-only Debian 13
//   dracut-conffiles        the same, with /etc/initramfs-tools left behind, which is
//                           what debian:stable-slim looks like after the same switch
//   unknown-flavour         update-initramfs is there and answers with a generator this
//                           script has never met, which must not be guessed at
//   none                    neither, so there is nothing to rebuild
const cap = ({args = [], answers = 'n', release = debian, model = thisLaptop, dmiFile = null,
    seed = null, generator = 'initramfs-tools', rebuildStatus = 0, times = 20,
    tmpdirMode = 0o700} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zenbook-home-'));
    const bin = minimalPath();
    const log = path.join(home, 'calls');
    const etcRoot = path.join(home, 'root');
    fs.writeFileSync(path.join(bin, 'sudo'), `#!/bin/sh\necho "sudo $*" >> ${log}\nexec "$@"\n`,
        {mode: 0o755});
    logger(bin, 'apt-get', log);
    for (const name of ['curl', 'wget', 'scp', 'ssh', 'systemctl', 'lsmod', 'modinfo']) {
        logger(bin, name, log);
    }
    if (generator.endsWith('-conffiles') || generator === 'initramfs-tools') {
        fs.mkdirSync(path.join(etcRoot, 'etc/initramfs-tools'), {recursive: true});
    }
    if (generator === 'initramfs-tools') {
        updateInitramfs(bin, 'initramfs-tools 0.151ubuntu1', log, rebuildStatus);
    } else if (generator === 'dracut-shim' || generator === 'dracut-shim-conffiles') {
        updateInitramfs(bin, 'dracut 110-11ubuntu0.1', log, rebuildStatus);
    } else if (generator === 'unknown-flavour') {
        updateInitramfs(bin, 'mkinitramfs-ng 2.0', log, rebuildStatus);
    } else if (generator === 'dracut' || generator === 'dracut-conffiles') {
        logger(bin, 'dracut', log, rebuildStatus);
    }
    const conf = path.join(etcRoot, 'etc/modprobe.d/zenbook-um5606-cpu-cap.conf');
    if (seed !== null) {
        fs.mkdirSync(path.dirname(conf), {recursive: true});
        fs.writeFileSync(conf, seed);
    }
    // Its own TMPDIR, so a scenario can see what the script does with temporary files and
    // one scenario can take the permission to make them away.
    const tmp = path.join(home, 'tmp');
    fs.mkdirSync(tmp, {recursive: true});
    fs.chmodSync(tmp, tmpdirMode);
    const env = {PATH: bin, HOME: home, TMPDIR: tmp, DEBIAN_SETUP_OS_RELEASE: release,
        DEBIAN_SETUP_ETC_ROOT: etcRoot};
    if (dmiFile !== null) {
        const file = path.join(home, 'product_name');
        fs.writeFileSync(file, `${dmiFile}\n`);
        env.ZENBOOK_CPU_CAP_DMI_FILE = file;
    } else {
        env.DEBIAN_SETUP_DMI_NAME = model;
    }
    const replies = Array.isArray(answers) ? answers : Array(times).fill(answers);
    const result = spawnSync('bash', [path.join(root, 'setup-zenbook-cpu-cap.sh'), ...args], {
        encoding: 'utf8', timeout: 60000, input: `${replies.join('\n')}\n`, env});
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    const written = fs.existsSync(conf) ? fs.readFileSync(conf, 'utf8') : null;
    const state = path.join(home, '.local/state/debian-desktop-setup');
    const backups = fs.existsSync(state) ? fs.readdirSync(state) : [];
    const leftInTmp = fs.existsSync(tmp) ? fs.readdirSync(tmp) : [];
    return {result, calls, written, conf, home, bin, backups, state, leftInTmp,
        clean: () => {
            fs.chmodSync(tmp, 0o700);
            fs.rmSync(bin, {recursive: true, force: true});
            fs.rmSync(home, {recursive: true, force: true});
        }};
};
// This subject writes one local file. A test that downloaded anything would pass or
// fail with the network instead of with the script.
const noNetwork = (calls) => {
    assert.doesNotMatch(calls, /^curl |^wget /m, 'Nothing here downloads anything');
    assert.doesNotMatch(calls, /^scp |^ssh /m, 'Nothing here reaches another host');
};

// Arguments and guards.
{
    const bad = cap({args: ['--invalid']});
    assert.equal(bad.result.status, 2, 'An unknown argument is a usage error');
    assert.match(bad.result.stderr, /Unknown argument/);
    bad.clean();
    const help = cap({args: ['--help']});
    assert.equal(help.result.status, 0);
    assert.match(help.result.stdout, /setup-zenbook-cpu-cap\.sh/, 'The help names the script');
    assert.match(help.result.stdout, /--remove/, 'And every flag it accepts');
    assert.match(help.result.stdout, /--force/);
    help.clean();
    const fedora = cap({args: ['--dry-run'], release: osRelease('ID=fedora\n', 'fedora')});
    assert.equal(fedora.result.status, 1, 'An unsupported distribution stops the script');
    assert.match(fedora.result.stderr, /Unsupported distribution/);
    fedora.clean();
}

// Scenario: the model mismatch refusal, and that it writes nothing.
{
    const other = cap({answers: 'y', model: otherLaptop});
    assert.equal(other.result.status, 1, 'Other hardware is a refusal, not a silent skip');
    assert.match(other.result.stdout, /Dell Inc\. XPS 13 9310/, 'Say which model it read');
    assert.match(other.result.stderr, /UM5606/, 'And which model this fix is for');
    assert.match(other.result.stderr, /--force/, 'And how to override it deliberately');
    assert.equal(other.written, null, 'A refusal writes no blacklist');
    assert.deepEqual(other.backups, [], 'And creates no backup directory');
    assert.doesNotMatch(other.calls, /install -Dm644/, 'And installs nothing');
    assert.doesNotMatch(other.calls, /update-initramfs|^dracut /m, 'And rebuilds no initramfs');
    other.clean();
}

// Scenario: --force overrides the model check.
{
    const forced = cap({args: ['--force'], answers: 'y', model: otherLaptop});
    assert.equal(forced.result.status, 0, forced.result.stderr);
    assert.ok(forced.written, '--force applies the fix on hardware that does not match');
    assert.match(forced.written, /^blacklist amd_pmf$/m);
    forced.clean();
}

// Scenario: the file is written, with the three blacklist lines and nothing invented.
let produced = null;
{
    const run = cap({answers: 'y'});
    assert.equal(run.result.status, 0, run.result.stderr + run.result.stdout);
    assert.ok(run.written, 'The blacklist is written');
    produced = run.written;
    assert.match(run.written, /^blacklist amd_pmf$/m, 'The driver that does the clamping');
    assert.match(run.written, /^blacklist amdxdna$/m, 'The NPU driver that depends on it');
    assert.match(run.written, /^blacklist asus_armoury$/m, 'And the firmware attribute driver');
    assert.equal(run.written.match(/^blacklist /gm).length, 3, 'Three lines, no more');
    assert.match(run.written, /^# SPDX-License-Identifier: GPL-3\.0-only$/m, 'The file carries a licence');
    assert.match(run.written, /--remove/, 'And says how to undo itself');
    assert.match(run.calls, /install -Dm644/, 'Installed, not shell-redirected into /etc');
    assert.match(run.result.stdout, /zenbook-um5606-cpu-cap\.conf/,
        'The path is the Arch repository\'s, so one grep finds both');
    assert.match(run.result.stdout, /Would write/, 'The content is previewed before consent');
    assert.match(run.result.stdout, /^The blacklist is read by the kernel at the next boot/m,
        'A run that wrote the file says where the fix comes from');
    noNetwork(run.calls);
    run.clean();
}

// Scenario: an existing file with the same bytes is a short circuit, not a rewrite.
{
    const same = cap({answers: 'y', seed: produced});
    assert.equal(same.result.status, 0, same.result.stderr);
    assert.match(same.result.stdout, /Unchanged: .*zenbook-um5606-cpu-cap\.conf/,
        'An identical file is reported unchanged');
    assert.equal(same.written, produced, 'And left byte for byte as it was');
    assert.doesNotMatch(same.calls, /install -Dm644/, 'Nothing is installed over it');
    assert.deepEqual(same.backups, [], 'And nothing is backed up');
    assert.match(same.result.stdout, /Restart, then confirm/,
        'A file that is already correct is still worth verifying after a reboot');
    // A correct file says nothing about the copy inside the existing images, and this is
    // the run a user who declined the rebuild the first time will be doing from now on:
    // every later run short-circuits here, so this is the only place left to offer it.
    assert.match(same.result.stdout, /^Initramfs generator on this machine: initramfs-tools$/m,
        'The generator is reported on this path too');
    assert.match(same.calls, /^update-initramfs -u -k all$/m,
        'And the rebuild is offered here, not only on the run that wrote the file');
    same.clean();
    const sameDeclined = cap({answers: 'n', seed: produced});
    assert.equal(sameDeclined.result.status, 0, sameDeclined.result.stderr);
    assert.doesNotMatch(sameDeclined.calls, /update-initramfs/,
        'It stays a prompt: declining it rebuilds nothing');
    assert.match(sameDeclined.result.stdout, /initramfs rebuild/,
        'And the skipped rebuild is named in the summary');
    assert.match(sameDeclined.result.stdout, /^The blacklist is read by the kernel at the next boot/m,
        'The file is still in place, so this run does end with something to reboot for');
    sameDeclined.clean();
}

// An existing file with different bytes is backed up before it is replaced.
{
    const old = '# an older hand-written version\nblacklist amd_pmf\n';
    const seeded = cap({answers: 'y', seed: old});
    assert.equal(seeded.result.status, 0, seeded.result.stderr);
    assert.equal(seeded.written, produced, 'The new file lands');
    assert.equal(seeded.backups.length, 1, 'The replaced file is backed up exactly once');
    const backup = path.join(seeded.state, seeded.backups[0], 'zenbook-um5606-cpu-cap.conf');
    assert.ok(fs.existsSync(backup), `The backup is readable: ${backup}`);
    assert.equal(fs.readFileSync(backup, 'utf8'), old, 'And it is the old file, byte for byte');
    assert.match(seeded.backups[0], /^zenbook-cpu-cap-\d{8}-\d{6}-\d+$/,
        'Under this subject\'s own timestamped directory');
    seeded.clean();
    // Declining the replacement leaves what was there alone and says so.
    const kept = cap({answers: 'n', seed: old});
    assert.equal(kept.result.status, 0, kept.result.stderr);
    assert.equal(kept.written, old, 'A declined replacement changes nothing');
    assert.match(kept.result.stdout, /Left alone at your request/, 'And is named in the summary');
    assert.doesNotMatch(kept.result.stdout, /Restart, then confirm/,
        'A run that changed nothing has nothing for the user to go and verify');
    assert.doesNotMatch(kept.result.stdout, /read by the kernel at the next boot/,
        'Nor may its summary promise a fix at the next boot that it did not write');
    assert.match(kept.result.stdout, /^This run changed nothing/m,
        'It says plainly that nothing changed, which is the whole of the news');
    kept.clean();
}

// Scenario: --remove deletes the file.
{
    const removed = cap({args: ['--remove'], answers: 'y', seed: produced});
    assert.equal(removed.result.status, 0, removed.result.stderr);
    assert.equal(removed.written, null, 'The file is gone');
    assert.match(removed.calls, /^sudo rm -f/m, 'Removed through sudo, by rm');
    assert.match(removed.result.stdout, /Restart/, 'And the reboot that restores the drivers is named');
    assert.match(removed.result.stdout, /^With the file gone, the three modules load again at the next boot/m,
        'The summary of a removal describes the removal, not a blacklist taking effect');
    assert.doesNotMatch(removed.result.stdout, /The blacklist is read by the kernel/,
        'The file it just deleted cannot be read at the next boot');
    removed.clean();
    // Declining the deletion is also a run that changed nothing.
    const keptOnRemove = cap({args: ['--remove'], answers: 'n', seed: produced});
    assert.equal(keptOnRemove.result.status, 0, keptOnRemove.result.stderr);
    assert.equal(keptOnRemove.written, produced, 'A declined deletion deletes nothing');
    assert.doesNotMatch(keptOnRemove.calls, /^sudo rm/m, 'And runs no rm');
    assert.match(keptOnRemove.result.stdout, /^This run changed nothing/m,
        'And says so instead of describing a boot that will be different');
    keptOnRemove.clean();
    const absent = cap({args: ['--remove'], answers: 'y'});
    assert.equal(absent.result.status, 0, 'Removing a file that is not there is not an error');
    assert.match(absent.result.stdout, /Not present/, 'It says so');
    assert.doesNotMatch(absent.calls, /^sudo rm/m, 'And removes nothing');
    absent.clean();
    const preview = cap({args: ['--remove', '--dry-run'], answers: 'y', seed: produced});
    assert.equal(preview.result.status, 0, preview.result.stderr);
    assert.equal(preview.written, produced, 'A previewed removal removes nothing');
    assert.doesNotMatch(preview.calls, /^sudo /m, 'And runs nothing through sudo');
    preview.clean();
}

// Scenario: --dry-run writes nothing at all, and still shows what it would do.
{
    const preview = cap({args: ['--dry-run'], answers: 'y'});
    assert.equal(preview.result.status, 0, preview.result.stderr);
    assert.equal(preview.written, null, 'A preview writes no blacklist');
    assert.deepEqual(preview.backups, [], 'A preview creates no backup directory');
    assert.doesNotMatch(preview.calls, /^sudo /m, 'A preview runs nothing through sudo');
    assert.doesNotMatch(preview.calls, /update-initramfs|^dracut /m, 'And rebuilds no initramfs');
    assert.match(preview.result.stdout, /^ +blacklist amd_pmf$/m,
        'It still shows the file it would have written');
    assert.match(preview.result.stdout, /install -Dm644/, 'And the command it would have run');
    assert.match(preview.result.stdout, /Preview only/, 'And says that it wrote nothing');
    assert.match(preview.result.stdout, /Restart, then confirm/,
        'A preview of an accepted write still shows what it would ask you to check');
    assert.deepEqual(preview.leftInTmp, [], 'And leaves nothing behind in TMPDIR');
    noNetwork(preview.calls);
    preview.clean();
    // "Writes nothing" taken literally, as setup-zram.sh takes it: the staging file
    // belongs inside the branch that installs it, so a preview on a read-only or full
    // TMPDIR still previews instead of dying in mktemp.
    const readOnlyTmp = cap({args: ['--dry-run'], answers: 'y', tmpdirMode: 0o555});
    assert.equal(readOnlyTmp.result.status, 0,
        `A preview must not need a writable TMPDIR: ${readOnlyTmp.result.stderr}`);
    assert.match(readOnlyTmp.result.stdout, /^ +blacklist asus_armoury$/m,
        'And must still show all three lines of the file it would write');
    assert.match(readOnlyTmp.result.stdout, /install -Dm644/,
        'And the command it would have run');
    assert.equal(readOnlyTmp.written, null, 'Having written nothing');
    readOnlyTmp.clean();
}

// Scenario: the rebuild command is the one the recon proved for the generator found,
// chosen by /etc/initramfs-tools and never by `command -v update-initramfs` -- dracut
// ships its own shim of that name on Ubuntu 26.04 and Kali.
{
    const tools = cap({answers: 'y', generator: 'initramfs-tools'});
    assert.equal(tools.result.status, 0, tools.result.stderr);
    assert.match(tools.calls, /^update-initramfs -u -k all$/m,
        '-u alone leaves an older kernel carrying the stale modprobe.d, so -k all is required');
    assert.doesNotMatch(tools.calls, /^dracut /m, 'dracut is not called when initramfs-tools is there');
    // Anchored on the whole line, because the explanation paragraph above it names both
    // generators in prose on every run: a bare /initramfs-tools/ matches a machine where
    // nothing was detected at all, which is how this assertion used to pass regardless.
    assert.match(tools.result.stdout, /^Initramfs generator on this machine: initramfs-tools$/m,
        'The generator is named in the output, and only the detected path can print that line');
    assert.match(tools.result.stdout, /^update-initramfs --version answers "initramfs-tools 0\.151/m,
        'Quoting the answer it was decided by, which is the test Debian\'s kernel hook uses');
    assert.match(tools.result.stdout, /lsinitramfs \/boot/,
        'And the verification names its own lister');
    assert.doesNotMatch(tools.result.stdout, /lsinitrd/, 'Not the other generator\'s');
    tools.clean();

    const shim = cap({answers: 'y', generator: 'dracut-shim'});
    assert.equal(shim.result.status, 0, shim.result.stderr);
    assert.match(shim.calls, /^update-initramfs -u -k all$/m,
        'dracut\'s shim honours -u -k all, so one command covers both generators');
    assert.match(shim.result.stdout,
        /^Initramfs generator on this machine: dracut, through its own \/usr\/sbin\/update-initramfs shim$/m,
        'But the output must say it is dracut behind the shim');
    assert.doesNotMatch(shim.result.stdout, /^Initramfs generator on this machine: initramfs-tools$/m,
        'And must not name the generator that is not there');
    assert.match(shim.result.stdout, /^update-initramfs --version answers "dracut 110-/m,
        'Named by what the command answers, not by what is left in /etc');
    assert.match(shim.result.stdout, /lsinitrd \/boot/,
        'And name dracut\'s lister, which is the one that reads its images');
    assert.doesNotMatch(shim.result.stdout, /lsinitramfs \/boot/,
        'lsinitramfs cannot read a dracut-built image');
    shim.clean();

    // F6's machine: an Ubuntu 26.04 or Kali that once had initramfs-tools and now runs
    // dracut. /etc/initramfs-tools survives as kept conffiles, and so do mkinitramfs and
    // lsinitramfs from initramfs-tools-core, so no file on disk decides this; what builds
    // the image does, and update-initramfs --version is how Debian's own kernel hook asks.
    const switched = cap({answers: 'y', generator: 'dracut-shim-conffiles'});
    assert.equal(switched.result.status, 0, switched.result.stderr);
    assert.match(switched.result.stdout,
        /^Initramfs generator on this machine: dracut, through its own/m,
        'A leftover /etc/initramfs-tools must not make a dracut machine claim initramfs-tools');
    assert.match(switched.result.stdout, /lsinitrd \/boot/,
        'And the image the user is sent to open must be read with dracut\'s own lister');
    assert.doesNotMatch(switched.result.stdout, /lsinitramfs \/boot/,
        'lsinitramfs would be the wrong tool for a dracut-built image');
    switched.clean();

    const switchedDebian = cap({answers: 'y', generator: 'dracut-conffiles'});
    assert.equal(switchedDebian.result.status, 0, switchedDebian.result.stderr);
    assert.match(switchedDebian.result.stdout, /^Initramfs generator on this machine: dracut$/m,
        'Debian 13 after the same switch has no shim at all, and is plain dracut');
    assert.match(switchedDebian.calls, /^dracut --force --regenerate-all$/m,
        'So the rebuild is dracut itself, whatever is left in /etc');
    switchedDebian.clean();

    const dracut = cap({answers: 'y', generator: 'dracut'});
    assert.equal(dracut.result.status, 0, dracut.result.stderr);
    assert.match(dracut.calls, /^dracut --force --regenerate-all$/m,
        'Debian 13\'s dracut ships no update-initramfs shim, so the fallback is dracut itself');
    assert.doesNotMatch(dracut.calls, /update-initramfs/, 'There is no update-initramfs to call');
    assert.match(dracut.result.stdout, /^Initramfs generator on this machine: dracut$/m,
        'And it is named as plain dracut, with no shim to go through');
    assert.doesNotMatch(dracut.result.stdout, /^update-initramfs --version answers/m,
        'There is no update-initramfs here to have answered anything');
    dracut.clean();

    // An update-initramfs that answers with something else: the command is still the way
    // to rebuild, and the image format is not guessed at, so no lister is named.
    const unknown = cap({answers: 'y', generator: 'unknown-flavour'});
    assert.equal(unknown.result.status, 0, unknown.result.stderr);
    assert.match(unknown.result.stdout, /^Initramfs generator on this machine: update-initramfs$/m,
        'What is known is the command, and that is all that is claimed');
    assert.match(unknown.calls, /^update-initramfs -u -k all$/m, 'Which is still what rebuilds');
    assert.doesNotMatch(unknown.result.stdout, /lsinitr(amfs|d) \/boot/,
        'And no lister is named, because neither one is known to read that image');
    unknown.clean();

    const neither = cap({answers: 'y', generator: 'none'});
    assert.equal(neither.result.status, 0, 'No generator is not a failure: the blacklist still applies');
    assert.ok(neither.written, 'The file is still written');
    assert.doesNotMatch(neither.calls, /update-initramfs|^dracut /m, 'Nothing is rebuilt');
    assert.match(neither.result.stdout, /neither update-initramfs nor dracut/,
        'And the reason is stated rather than guessed at');
    neither.clean();
}

// The rebuild is a separate, declinable prompt, and declining it is a complete run:
// the Arch script's "needed by the modconf hook" is false twice over here.
{
    const declined = cap({answers: ['y', 'n']});
    assert.equal(declined.result.status, 0, declined.result.stderr);
    assert.ok(declined.written, 'The blacklist is written');
    assert.doesNotMatch(declined.calls, /update-initramfs/, 'The declined rebuild does not happen');
    assert.match(declined.result.stdout, /Left alone at your request/);
    assert.match(declined.result.stdout, /initramfs rebuild/, 'Named as what was skipped');
    declined.clean();
}

// The printed reasoning must not claim the fix depends on the rebuild, because none of
// the three modules is ever in an initramfs on these distributions.
{
    const run = cap({args: ['--dry-run'], answers: 'y'});
    assert.match(run.result.stdout, /takes effect at the next boot from that file alone/,
        'Say where the fix actually comes from');
    assert.match(run.result.stdout, /not what makes this work|housekeeping/,
        'And that the rebuild is not what makes it work');
    assert.doesNotMatch(run.result.stdout, /modconf/,
        'There is no modconf hook on Debian: that comment has no counterpart to name');
    assert.doesNotMatch(run.result.stdout, /needed by|required by the/i,
        'Nothing here may describe the rebuild as needed');
    assert.match(run.result.stdout, /MODULES=most/,
        'Name the policy that keeps them out of the initramfs');
    // What the probe actually established is that the three blacklisted names are absent.
    // The images hold hundreds of modules, two of them ASUS ones, so "contained asus-wmi
    // and nothing else" was a claim about a count nobody took.
    assert.doesNotMatch(run.result.stdout, /nothing else/,
        'No claim about everything an initramfs does not contain');
    assert.match(run.result.stdout, /831 modules/,
        'Say how big the image searched actually was');
    assert.match(run.result.stdout, /held none of them/,
        'And that what was looked for was the three names, which were absent');
    assert.match(run.result.stdout, /hid-asus and asus-wmi/,
        'Including the second ASUS module the images do carry');
    assert.match(run.result.stdout, /in containers on 2026-10-16/,
        'Attributed to where those counts were taken');
    run.clean();
}

// The systemd-analyze discriminator comes before the first consent prompt, is four
// lines, and attributes its figures to the machine they were measured on.
{
    const run = cap({args: ['--dry-run'], answers: 'y'});
    const lines = run.result.stdout.split('\n');
    const start = lines.findIndex((line) => line.includes('systemd-analyze'));
    const end = lines.findIndex((line) => line.includes('embedded controller'));
    assert.ok(start >= 0, 'The discriminator must be printed');
    assert.ok(end >= start, 'And must end with the cause this file cannot fix');
    assert.ok(end - start + 1 <= 4, `Four lines at most, not ${end - start + 1}`);
    const preview = lines.findIndex((line) => line.includes('Would write'));
    assert.ok(start < preview,
        'It comes before the file is shown, which is before the first consent prompt');
    const block = lines.slice(start, end + 1).join('\n');
    assert.match(block, /22\.4s/, 'The clamped firmware phase that was actually observed');
    assert.match(block, /47\.3s/, 'And the loader phase with it');
    assert.match(block, /6s firmware/, 'Against the healthy boot it is compared with');
    assert.match(block, /Arch/, 'Measured on the Arch install');
    assert.match(block, /2026-10-04/, 'On the day it was measured');
    assert.match(block, /40s|40 s/, 'And the EC reset that is the remedy for that cause');
    run.clean();
}

// Every figure from the Arch machine says so, because no Debian-family install of this
// laptop exists and nothing in a container can re-measure them.
{
    const run = cap({args: ['--dry-run'], answers: 'y'});
    assert.match(run.result.stdout, /605 MHz/, 'Keep the measured clamp');
    assert.match(run.result.stdout, /2\.4-3\.2 GHz/, 'And the speed restoring it gave');
    assert.match(run.result.stdout, /34 W/);
    assert.match(run.result.stdout, /BIOS UM5606WA\.318|BIOS 318/, 'Named with the firmware it was on');
    assert.match(run.result.stdout, /Arch install of this laptop \(BIOS/,
        'And attributed to the install it was measured on, not to Debian');
    assert.match(run.result.stdout, /not re-measured under Debian/,
        'The summary must not let a reader take these for Debian figures');
    // The timing in the verification block is the same Arch measurement as the rest, and
    // "here" meant the Debian-family machine the user is on, where nobody has timed it.
    assert.doesNotMatch(run.result.stdout, /under 1s here/,
        'No Arch figure may wear a local label, least of all the one the user checks against');
    assert.match(run.result.stdout, /# on Arch: well under 1s, about 4\.5s when capped/,
        'The timing says which install it came from, like every other number here');
    run.clean();
}

// Two of the three modules do not exist in Debian 13's 6.12 kernel, and that is said
// on Debian only: Ubuntu 26.04 and Kali carry all three.
{
    const onDebian = cap({args: ['--dry-run'], answers: 'y', release: debian});
    assert.match(onDebian.result.stdout, /amdxdna and asus_armoury absent/,
        'On Debian, say which two names are no-ops there');
    assert.match(onDebian.result.stdout, /6\.12/, 'Name the kernel that is true of');
    assert.match(onDebian.result.stdout, /^Detected Debian GNU\/Linux 13 \(trixie\) \(Debian family\)\.$/m,
        'And the banner names Debian as both the name and the family');
    assert.match(onDebian.result.stdout, /^ +blacklist asus_armoury$/m,
        'And still write all three, because a backport could add them');
    onDebian.clean();
    const onUbuntu = cap({args: ['--dry-run'], answers: 'y', release: ubuntu});
    assert.doesNotMatch(onUbuntu.result.stdout, /asus_armoury absent/,
        'Ubuntu 26.04 carries all three, so the note must not appear there');
    assert.match(onUbuntu.result.stdout, /^Detected Ubuntu 26\.04\.1 LTS \(Ubuntu family\)\.$/m,
        'The banner names the detected family, which is the only line that can');
    onUbuntu.clean();
    const onKali = cap({args: ['--dry-run'], answers: 'y', release: kali});
    assert.equal(onKali.result.status, 0, onKali.result.stderr);
    assert.doesNotMatch(onKali.result.stdout, /asus_armoury absent/,
        'Kali Rolling carries all three too, and release=debian must not make it claim otherwise');
    // Anchored for the same reason as the generator line: the prose names Ubuntu and Kali
    // on every run, so /Kali/ matched even when the banner printed the archive (debian)
    // instead of the family. release is debian here and family is Kali, and the banner
    // has to show the second.
    assert.match(onKali.result.stdout, /^Detected Kali GNU\/Linux Rolling \(Kali family\)\.$/m,
        'Kali is named as the family it is, not as the archive it borrows names from');
    assert.match(onKali.result.stdout, /^On the Arch install of this laptop, 2026-10-04, not on Kali:/m,
        'And the prose that says where the figures came from names it the same way');
    onKali.clean();
}

// A failed rebuild is recorded, the file it already wrote is still reported, and the
// run fails loudly rather than claiming a clean finish.
{
    const broken = cap({answers: 'y', rebuildStatus: 1});
    assert.equal(broken.result.status, 1, 'A failed step makes the whole script fail');
    assert.match(broken.result.stdout, /Steps that failed:/, 'The failure is named');
    assert.match(broken.result.stdout, /update-initramfs/, 'By the command that failed');
    assert.ok(broken.written, 'And the blacklist it already wrote is still in place');
    broken.clean();
}

// The Arch script's own test hook still works, so the model can come from a file
// rather than from a variable.
{
    const viaFile = cap({args: ['--dry-run'], answers: 'y', dmiFile: thisLaptop});
    assert.equal(viaFile.result.status, 0, viaFile.result.stderr);
    assert.match(viaFile.result.stdout, /UM5606WA_UM5606WA/, 'The model is read from the file');
    viaFile.clean();
    const otherViaFile = cap({args: ['--dry-run'], answers: 'y', dmiFile: otherLaptop});
    assert.equal(otherViaFile.result.status, 1, 'And the same refusal applies to what it reads');
    otherViaFile.clean();
}

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-zenbook-cpu-cap-smoke: all checks passed');
