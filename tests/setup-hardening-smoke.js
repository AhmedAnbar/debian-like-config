// SPDX-License-Identifier: GPL-3.0-only
// setup-hardening.sh against stubs only. Nothing is installed, no unit is touched
// and no socket is opened: apt-get, sudo, systemctl and sshd are all scripts in a
// scratch PATH, /etc/ssh is prefixed by DEBIAN_SETUP_ETC_ROOT the way
// DEBIAN_SETUP_ETC_ROOT prefixes /etc/apt, and TMPDIR points inside the scratch
// directory so even the staged file lands there. curl and scp are stubbed too,
// and this test asserts they were never called: this script must reach no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'setup-hardening.sh');

const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'hardening-shared-'));
const osRelease = (body, name) => {
    const file = path.join(shared, name);
    fs.writeFileSync(file, body);
    return file;
};
const releases = {
    debian: osRelease('ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian'),
    ubuntu: osRelease('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04 LTS"\n', 'ubuntu'),
    fedora: osRelease('ID=fedora\n', 'fedora'),
};

// The real machine this comes from has an sshd and may have a drop-in already. A
// PATH built from a named list is the only way to decide, from the test, whether
// sshd exists at all -- the same trick tests/setup-sway-smoke.js uses for sway.
const scenario = ({
    answers = 'n\n'.repeat(20), release = 'debian', keys = null,
    sshd = 'ok', args = [], otherDropins = {}, effective = null, sshdCase = 'lower',
} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hardening-'));
    const log = path.join(home, 'calls');
    const sshRoot = path.join(home, 'root');
    const dropin = path.join(sshRoot, 'etc/ssh/sshd_config.d/99-hardening.conf');
    const seen = path.join(home, 'validated');
    const dir = path.join(home, 'path');
    fs.mkdirSync(dir);
    for (const command of ['bash', 'sh', 'cat', 'chmod', 'cp', 'date', 'dirname', 'env', 'grep',
        'id', 'install', 'mkdir', 'mktemp', 'rm', 'sort', 'stat', 'tail', 'unlink', 'awk']) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
    const stub = (name, body) =>
        fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, {mode: 0o755});
    // sudo logs and then really runs: the install this script does is the thing
    // under test, and it lands under the prefixed root, not on this machine.
    stub('sudo', `echo "sudo $*" >> ${log}\nexec "$@"`);
    stub('apt-get', `echo "apt-get $*" >> ${log}\nexit 0`);
    stub('apt-cache', `echo "apt-cache $*" >> ${log}\nprintf '  Candidate: 1:10.0p1-7+deb13u4\\n'`);
    stub('systemctl', `echo "systemctl $*" >> ${log}\nexit 0`);
    // Never legitimately reached. Called means the test is no longer hermetic.
    stub('curl', `echo "curl $*" >> ${log}\nexit 1`);
    stub('scp', `echo "scp $*" >> ${log}\nexit 1`);
    if (sshd !== 'absent') {
        // The stub records what it was handed and whether the destination already
        // existed when it ran: that is how "validated before installed" is proved.
        //
        // -T is answered separately, because what sshd would really do with two
        // drop-ins is not something a stub should be trusted to model. sshd uses the
        // FIRST value it obtains for a keyword and Debian's sshd_config includes
        // sshd_config.d/*.conf at line 12, so among drop-ins the lowest-numbered file
        // wins: verified in a debian:trixie container, where a 50-*.conf saying
        // "PasswordAuthentication yes" leaves `sshd -T` reporting yes even with
        // 99-hardening.conf saying no. The `effective` knob is that outcome.
        // OpenSSH 9 prints the keywords of sshd -T lowercased; OpenSSH 10 prints them
        // in CamelCase. Debian 13 ships 9.9 and kali-rolling 10.5, both of which this
        // script has to read, so the stub can answer in either style.
        const settings = sshdCase === 'camel'
            ? [`PasswordAuthentication ${effective || 'no'}`, 'PermitRootLogin no',
                'KbdInteractiveAuthentication no', 'X11Forwarding no']
            : [`passwordauthentication ${effective || 'no'}`, 'permitrootlogin no',
                'kbdinteractiveauthentication no', 'x11forwarding no'];
        stub('sshd', `echo "sshd $*" >> ${log}
case "$*" in
  *-T*) printf '${settings.join('\\n')}\\n'
        exit 0 ;;
esac
if [ -e ${dropin} ]; then echo "sshd ran with the drop-in already installed" >> ${log}; fi
for a in "$@"; do last=$a; done
cat "$last" >> ${seen} 2>/dev/null
exit ${sshd === 'ok' ? 0 : 255}`);
    }
    for (const [name, body] of Object.entries(otherDropins)) {
        const other = path.join(sshRoot, 'etc/ssh/sshd_config.d', name);
        fs.mkdirSync(path.dirname(other), {recursive: true});
        fs.writeFileSync(other, body);
    }
    if (keys !== null) {
        fs.mkdirSync(path.join(home, '.ssh'), {recursive: true});
        fs.writeFileSync(path.join(home, '.ssh/authorized_keys'), keys);
    }
    const result = spawnSync('bash', [script, ...args], {
        encoding: 'utf8', timeout: 60000, input: answers,
        env: {HOME: home, PATH: dir, TMPDIR: home,
            DEBIAN_SETUP_OS_RELEASE: releases[release], DEBIAN_SETUP_ETC_ROOT: sshRoot},
    });
    const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    return {result, home, dropin, sshRoot,
        out: result.stdout + result.stderr, log: read(log),
        validated: read(seen), installed: read(dropin)};
};
const cleanup = (s) => fs.rmSync(s.home, {recursive: true, force: true});
// One real key, with an options prefix, because that is what a locked-down
// authorized_keys looks like and a naive check misses it.
const realKey = 'restrict,pty ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJexampleexampleexample anbar@zenbook\n';

// Arguments and release guard, before anything else can happen.
{
    assert.equal(scenario({args: ['--invalid']}).result.status, 2,
        'An unknown argument is a usage error');
    const help = scenario({args: ['--help']});
    assert.equal(help.result.status, 0);
    assert.match(help.out, /ssh/i, 'The help text names the subject');
    const fedora = scenario({release: 'fedora', args: ['--dry-run']});
    assert.equal(fedora.result.status, 1, 'An unsupported release refuses to run');
    assert.match(fedora.out, /Debian 13 and Ubuntu 26\.04/);
}

// A preview writes nothing at all, even with every answer yes.
{
    const s = scenario({args: ['--dry-run'], answers: 'y\n'.repeat(20), keys: realKey});
    assert.equal(s.result.status, 0, s.out);
    assert.ok(!fs.existsSync(s.sshRoot), 'A preview creates nothing under /etc/ssh');
    assert.doesNotMatch(s.log, /apt-get install/, 'A preview installs no package');
    assert.doesNotMatch(s.log, /systemctl/, 'A preview touches no unit');
    assert.equal(s.validated, '', 'A preview stages no file to validate');
    cleanup(s);
}

// The package step says plainly what installing it does, and names it from the map.
{
    const s = scenario({answers: 'n\n'.repeat(20)});
    assert.equal(s.result.status, 0, 'A run of all-no is a clean exit');
    assert.match(s.out, /openssh-server/, 'Name the package the map lists for this group');
    assert.match(s.out, /listening service/i,
        'The prompt must say that installing sshd starts a listening service');
    assert.doesNotMatch(s.log, /apt-get install/, 'Declining installs nothing');
    assert.doesNotMatch(s.log, /systemctl/, 'Declining touches no unit');
    assert.ok(!fs.existsSync(s.dropin), 'Declining writes no drop-in');
    assert.doesNotMatch(s.log, /^(curl|scp)/m, 'This script must reach no network');
    cleanup(s);
}

// All-yes on Debian with a usable key: validate the staged file, then install the
// drop-in, then restart ssh.service.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: realKey, release: 'debian'});
    assert.equal(s.result.status, 0, s.out);
    assert.match(s.log, /apt-get install[^\n]*openssh-server/, 'Install the server package');
    // On a machine that has never run apt -- a fresh install, which is exactly what
    // this bundle is for -- an install with no update first fails on missing lists.
    const updateAt = s.log.search(/apt-get update/);
    const installAt = s.log.search(/apt-get install/);
    assert.ok(updateAt >= 0, 'The package lists are refreshed before the only install here');
    assert.ok(updateAt < installAt, 'And refreshed before it, not after');
    // Guard 2: sshd -t -f ran, on a staged file, before anything was installed.
    const validation = s.log.match(/sshd -t -f (\S+)/);
    assert.ok(validation, 'The staged file is validated with sshd -t -f');
    assert.ok(!validation[1].includes('sshd_config.d'),
        `sshd -t must validate the staged copy, not the installed path: ${validation[1]}`);
    assert.doesNotMatch(s.log, /already installed/,
        'Validation must run before the drop-in is installed, not after');
    assert.match(s.validated, /PermitRootLogin no/, 'The validated file is the one with the settings');
    assert.match(s.validated, /PasswordAuthentication no/, 'Including the password setting');
    // Guard 1: the key was found and the user confirmed it works, so it is set.
    assert.match(s.installed, /^PasswordAuthentication no$/m, 'The installed drop-in disables passwords');
    assert.match(s.installed, /^PermitRootLogin no$/m);
    assert.match(s.installed, /^KbdInteractiveAuthentication no$/m,
        'Passwords come back through PAM keyboard-interactive without this');
    assert.match(s.out, /authorized_keys/, 'Say which file the key was found in');
    // Guard 3: Debian's postinst enables ssh.service.
    assert.match(s.log, /systemctl restart ssh\.service/, 'Debian restarts ssh.service');
    assert.doesNotMatch(s.log, /ssh\.socket/, 'ssh.socket is the Ubuntu unit, not this one');
    assert.doesNotMatch(s.log, /^(curl|scp)/m, 'This script must reach no network');
    cleanup(s);
}

// Guard 3, the other half: Ubuntu's postinst enables ssh.socket.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: realKey, release: 'ubuntu'});
    assert.equal(s.result.status, 0, s.out);
    assert.match(s.log, /systemctl restart ssh\.socket/, 'Ubuntu restarts ssh.socket');
    assert.doesNotMatch(s.log, /ssh\.service/, 'ssh.service is the Debian unit, not this one');
    assert.match(s.out, /ssh\.socket/, 'And say which unit it restarted');
    cleanup(s);
}

// Guard 1: no authorized_keys at all. The rest of the drop-in is still installed,
// but password authentication must be left exactly as it was.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: null});
    assert.equal(s.result.status, 0, s.out);
    assert.match(s.installed, /^PermitRootLogin no$/m, 'The safe settings are still installed');
    assert.doesNotMatch(s.installed, /PasswordAuthentication/,
        'With no key on disk, disabling password authentication could lock the user out');
    assert.doesNotMatch(s.validated, /PasswordAuthentication/,
        'And it was never even staged');
    assert.match(s.out, /authorized_keys/, 'Name the file that is missing');
    assert.match(s.out, /password authentication/i, 'And say what was therefore not done');
    cleanup(s);
}

// Guard 1 again: a file that exists but holds no key is the same as no file. The
// commented-out key is what an authorized_keys looks like after someone tidies it.
{
    const s = scenario({answers: 'y\n'.repeat(20),
        keys: '\n# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample old laptop\n\n'});
    assert.equal(s.result.status, 0, s.out);
    assert.doesNotMatch(s.installed, /PasswordAuthentication/,
        'A commented-out key is not a key you can log in with');
    cleanup(s);
}

// Guard 1, the third door: the key is there, and the user says a key login has not
// been proved yet. Their answer decides, not the file.
{
    // install openssh-server, write the drop-in, no the key login does not work, restart.
    const s = scenario({answers: 'y\ny\nn\ny\n', keys: realKey});
    assert.equal(s.result.status, 0, s.out);
    assert.match(s.installed, /^PermitRootLogin no$/m, 'The rest is installed');
    assert.doesNotMatch(s.installed, /PasswordAuthentication/,
        'Unconfirmed key login means password authentication stays enabled');
    cleanup(s);
}

// Guard 2: sshd -t rejects the staged file. Nothing is installed, no unit is
// restarted, and the run exits non-zero so install.sh does not report success.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: realKey, sshd: 'bad'});
    assert.equal(s.result.status, 1, 'A rejected configuration is a failed step');
    assert.ok(!fs.existsSync(s.dropin), 'A file sshd refuses must not be installed');
    assert.doesNotMatch(s.log, /systemctl restart/, 'And nothing is restarted');
    assert.match(s.out, /sshd -t/, 'Say what rejected it');
    assert.match(s.out, /Steps that failed/, 'The summary names the failure');
    cleanup(s);
}

// No sshd on the machine at all: there is no way to validate the file, so it is not
// installed, and the run says so rather than implying the machine was hardened.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: realKey, sshd: 'absent'});
    assert.equal(s.result.status, 1, 'Asked for and not done is a failure, not a success');
    assert.ok(!fs.existsSync(s.dropin), 'An unvalidated drop-in is not installed');
    assert.match(s.out, /sshd/, 'Name what is missing');
    assert.doesNotMatch(s.log, /systemctl restart/, 'Nothing to restart');
    cleanup(s);
}

// The closing output says what it could not check: that a key login works is the
// one thing none of the three guards can prove.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: realKey});
    assert.match(s.out, /could not|cannot|not verif/i,
        'Say what was not verified instead of implying the machine is safe');
    cleanup(s);
}

// The drop-in is a drop-in: sshd_config itself is never named as something to edit.
{
    const body = fs.readFileSync(script, 'utf8');
    assert.doesNotMatch(body, /sed[^\n]*sshd_config\b|>>?[^\n]*\/etc\/ssh\/sshd_config\b/,
        'The main sshd_config must never be edited');
    assert.match(body, /sshd_config\.d\/99-hardening\.conf/, 'The drop-in has the agreed name');
    assert.match(body, /arch-desktop-setup\/setup-ssh\.sh/,
        'Record that the Arch client-side script does not port to this one');
    assert.match(body, /source "\$bundle_dir\/lib\/common\.sh"/, 'Use the shared helpers');
    for (const helper of ['ask', 'run', 'attempt', 'try', 'install_file']) {
        assert.doesNotMatch(body, new RegExp(`^${helper}\\(\\) \\{`, 'm'),
            `${helper} belongs to lib/common.sh and must not be redefined`);
    }
}

// A lower-numbered drop-in beats 99-hardening.conf, silently. sshd takes the first
// value it obtains for each keyword and the Include sits at the top of sshd_config, so
// Ubuntu's own 50-cloud-init.conf with "PasswordAuthentication yes" wins -- after this
// script has told the user it set it to no. Telling someone their machine no longer
// accepts passwords when it does is the worst thing this script could do, so the
// effective configuration is read back and the disagreement reported.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: 'ssh-ed25519 AAAAC3Nz real@key\n',
        otherDropins: {'50-cloud-init.conf': 'PasswordAuthentication yes\n'},
        effective: 'yes'});
    assert.match(s.result.stdout, /50-cloud-init\.conf/,
        'The other drop-ins are named, because they decide the outcome');
    assert.match(s.result.stdout + s.result.stderr, /passwordauthentication yes|still accepts password/i,
        'The effective value is read back and reported, not assumed');
    assert.match(s.result.stdout, /Steps that failed:|did not take effect/i,
        'A setting that did not take is a failure, not a success');
    assert.notEqual(s.result.status, 0, 'And the run says so to whatever called it');
    cleanup(s);
}

// The same thing on an OpenSSH 10 machine, which is what kali-rolling has: sshd -T
// answers "PasswordAuthentication yes" rather than "passwordauthentication yes", and a
// read-back that only matched the old spelling would find nothing -- reporting success
// on a machine that still accepts passwords, which is the one outcome this script
// exists to prevent.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: 'ssh-ed25519 AAAAC3Nz real@key\n',
        otherDropins: {'50-cloud-init.conf': 'PasswordAuthentication yes\n'},
        effective: 'yes', sshdCase: 'camel'});
    assert.match(s.result.stdout, /PasswordAuthentication yes/,
        'The read-back must find the setting whatever case sshd prints it in');
    assert.match(s.result.stdout + s.result.stderr, /did not take effect/,
        'And a surviving yes must be called out, not passed over in silence');
    assert.match(s.result.stdout, /Steps that failed:/,
        'And recorded as a failure');
    assert.notEqual(s.result.status, 0, 'And reported to whatever called the script');
    cleanup(s);
}

// And on that same machine, with nothing in the way, the four settings still reach the
// user: a read-back that prints nothing is indistinguishable from one that was skipped.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: 'ssh-ed25519 AAAAC3Nz real@key\n',
        sshdCase: 'camel'});
    assert.match(s.result.stdout, /PasswordAuthentication no/i, 'The password setting is shown');
    assert.match(s.result.stdout, /PermitRootLogin no/i, 'And root logins');
    assert.doesNotMatch(s.result.stdout, /could not confirm/i, 'Nothing was skipped');
    cleanup(s);
}

// When nothing is in the way, the read-back confirms it rather than staying silent.
{
    const s = scenario({answers: 'y\n'.repeat(20), keys: 'ssh-ed25519 AAAAC3Nz real@key\n'});
    assert.match(s.result.stdout, /passwordauthentication no/,
        'The effective values are shown, so the user can see what the machine will do');
    assert.doesNotMatch(s.result.stdout, /did not take effect/, 'And nothing is reported wrong');
    cleanup(s);
}

fs.rmSync(shared, {recursive: true, force: true});
console.log('setup-hardening-smoke: all checks passed');
