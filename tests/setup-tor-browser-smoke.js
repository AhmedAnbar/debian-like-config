// SPDX-License-Identifier: GPL-3.0-only
// setup-tor-browser.sh against stubs only. Nothing here touches the network: curl,
// ssh and scp are stubs that log every call, and several checks exist purely to
// prove they were never called. /opt and /usr/share are redirected into a mkdtemp
// directory with DEBIAN_SETUP_OPT_ROOT and DEBIAN_SETUP_SHARE_ROOT.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'setup-tor-browser.sh');

const realOf = (command) => ['/usr/bin', '/bin', '/usr/sbin']
    .map((directory) => path.join(directory, command))
    .find((candidate) => fs.existsSync(candidate));

// gpg, tar, ssh, scp and curl all exist on the machine that runs this test, so a
// PATH built from a named list is the only way to be sure which ones the script
// reached. Nothing outside this directory is callable.
const world = ({sshStatus = 0, verifyStatus = 0, listStatus = 0, release = 'debian'} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tor-smoke-'));
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(home, 'calls');
    for (const command of ['bash', 'sh', 'cat', 'chmod', 'cmp', 'cp', 'date', 'dirname', 'env',
        'find', 'id', 'install', 'ln', 'mkdir', 'mktemp', 'readlink', 'rm', 'sed', 'sort', 'stat',
        'tail', 'unlink', 'awk', 'grep', 'basename', 'head', 'xz', 'true']) {
        const source = realOf(command);
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(bin, command));
    }
    const stub = (name, body) => fs.writeFileSync(path.join(bin, name),
        `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> ${log}\n${body}\n`, {mode: 0o755});
    stub('sudo', 'exec "$@"');
    stub('apt-get', 'exit 0');
    stub('apt-cache', "printf '  Candidate: 2.4.7-21\\n'");
    stub('dpkg-query', 'exit 1');
    stub('systemctl', 'exit 0');
    // Called nowhere: this script has no download path, by design.
    stub('curl', 'exit 1');
    stub('ssh', `exit ${sshStatus}`);
    // The real tar, so a real archive is really listed and really unpacked — but
    // logged, so the test can prove extraction never happened after a bad signature.
    fs.writeFileSync(path.join(bin, 'tar'),
        `#!/bin/sh\nprintf '%s\\n' "tar $*" >> ${log}\nexec ${realOf('tar')} "$@"\n`, {mode: 0o755});
    // -o <file> is how both the export and a real dearmor name their output; the
    // import that follows needs the file to exist.
    fs.writeFileSync(path.join(bin, 'gpg'), `#!/bin/sh
printf '%s\\n' "gpg $*" >> ${log}
for a in "$@"; do
  case "$a" in
    --verify) exit ${verifyStatus} ;;
    --list-keys) exit ${listStatus} ;;
  esac
done
out=''; prev=''
for a in "$@"; do [ "$prev" = "-o" ] && out=$a; prev=$a; done
[ -n "$out" ] && printf 'KEYBYTES\\n' > "$out"
exit 0
`, {mode: 0o755});
    // Stands in for the relay: it copies out of SCP_SRC and refuses anything else,
    // which is what a remote path naming a file that is not there looks like.
    fs.writeFileSync(path.join(bin, 'scp'), `#!/bin/sh
printf '%s\\n' "scp $*" >> ${log}
dest=''
for a in "$@"; do dest=$a; done
for a in "$@"; do
  case "$a" in
    vps:*) f=\${a#vps:}; b=$(basename "$f")
      [ -f "$SCP_SRC/$b" ] || exit 1
      cp "$SCP_SRC/$b" "$dest" || exit 1 ;;
  esac
done
exit 0
`, {mode: 0o755});
    const osRelease = path.join(home, 'os-release');
    fs.writeFileSync(osRelease, release === 'ubuntu'
        ? 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n'
        : 'ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n');
    const env = {
        HOME: home, PATH: bin, DEBIAN_SETUP_OS_RELEASE: osRelease,
        DEBIAN_SETUP_OPT_ROOT: path.join(home, 'opt'),
        DEBIAN_SETUP_SHARE_ROOT: path.join(home, 'share'),
        DEBIAN_SETUP_ETC_ROOT: path.join(home, 'aptroot'),
        SCP_SRC: path.join(home, 'relay'),
    };
    return {
        home, bin, env,
        calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''),
        run: (args, input = 'y\n'.repeat(20)) => spawnSync('bash', [script, ...args],
            {encoding: 'utf8', timeout: 60000, input, env}),
        clean: () => fs.rmSync(home, {recursive: true, force: true}),
    };
};

// A real .tar.xz, because the listing gate and the strip-components unpack are the
// parts of install_tarball_app this script leans on.
const fixture = (directory, {name = 'tor-browser-linux-x86_64-15.0.25.tar.xz', valid = true} = {}) => {
    const stage = path.join(directory, 'stage');
    const inner = path.join(stage, 'tor-browser', valid ? 'Browser' : 'Elsewhere');
    fs.mkdirSync(inner, {recursive: true});
    fs.writeFileSync(path.join(inner, 'start-tor-browser'), '#!/bin/sh\n', {mode: 0o755});
    const archive = path.join(directory, name);
    const tar = spawnSync(realOf('tar'), ['-cJf', archive, '-C', stage, 'tor-browser'], {encoding: 'utf8'});
    assert.equal(tar.status, 0, tar.stderr);
    fs.rmSync(stage, {recursive: true, force: true});
    fs.writeFileSync(`${archive}.asc`, '-----BEGIN PGP SIGNATURE-----\n');
    return archive;
};

const fingerprint = 'EF6E286DDA85EA2A4BA7DE684E2C6E8793298290';

// Arguments and guards.
{
    const w = world();
    assert.equal(w.run(['--invalid']).status, 2, 'An unknown argument is a usage error');
    assert.equal(w.run(['--from-dir']).status, 2, '--from-dir without a directory is a usage error');
    const help = w.run(['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Host vps/, 'The help text documents the Host vps block to write');
    assert.match(help.stdout, /--from-dir/, 'And the no-network route');
    assert.match(help.stdout, /--remote-path/, 'And the remote path option');
    const fedora = world({release: 'fedora'});
    fs.writeFileSync(fedora.env.DEBIAN_SETUP_OS_RELEASE, 'ID=fedora\n');
    const refused = fedora.run(['--dry-run']);
    assert.equal(refused.status, 1, 'An unsupported distribution is refused');
    assert.match(refused.stderr, /Debian 13 and Ubuntu 26\.04/);
    fedora.clean();
    w.clean();
}

// The one identifier rule: the alias and nothing else, anywhere in the script.
{
    const body = fs.readFileSync(script, 'utf8');
    assert.doesNotMatch(body, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'No address may appear here');
    assert.doesNotMatch(body, /[Hh]ost[Nn]ame\s+[A-Za-z0-9][-A-Za-z0-9.]*\.[A-Za-z]{2,}/,
        'No real hostname may appear here, not even in the help text');
    assert.doesNotMatch(body, /\w+@[\w.-]+\.[A-Za-z]{2,}/, 'No user@host may appear here');
    assert.doesNotMatch(body, /\bPort\s+\d+/, 'No port may appear here');
    assert.doesNotMatch(body, /dist\.torproject\.org\/[^\s']/, 'There is no download URL in this script');
    assert.match(body, /\bvps\b/, 'The alias is what the script names');
}

// The header says where the bytes come from, and what signs them, before anything
// is agreed to. All-no: nothing is copied, nothing is installed, exit 0.
{
    const w = world();
    const declinedRun = w.run([], 'n\n'.repeat(20));
    assert.equal(declinedRun.status, 0, declinedRun.stderr);
    assert.match(declinedRun.stdout, /vps/, 'Name the alias the staging route uses');
    assert.match(declinedRun.stdout, new RegExp(fingerprint), 'Print the fingerprint to be checked');
    assert.match(declinedRun.stdout, /(does not resolve|unreachable)/i,
        'Say that the canonical host is not reachable from here');
    const calls = w.calls();
    assert.doesNotMatch(calls, /^ssh /m, 'A declined run must not probe the alias');
    assert.doesNotMatch(calls, /^scp /m, 'A declined run must copy nothing');
    assert.doesNotMatch(calls, /^curl /m, 'This script has no download path at all');
    assert.doesNotMatch(calls, /apt-get install/, 'A declined run installs no packages');
    assert.ok(!fs.existsSync(w.env.DEBIAN_SETUP_OPT_ROOT), 'A declined run writes nothing into /opt');
    w.clean();
}

// A preview writes nothing and reaches no command that could change anything.
{
    const w = world();
    const staged = path.join(w.home, 'staged');
    fs.mkdirSync(staged, {recursive: true});
    fixture(staged);
    const preview = w.run(['--dry-run', '--from-dir', staged]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, new RegExp(staged.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'A preview names the directory it would verify');
    assert.ok(!fs.existsSync(w.env.DEBIAN_SETUP_OPT_ROOT), 'A preview unpacks nothing');
    assert.ok(!fs.existsSync(w.env.DEBIAN_SETUP_SHARE_ROOT), 'And installs no .desktop file');
    const calls = w.calls();
    assert.doesNotMatch(calls, /^gpg /m, 'A preview verifies nothing, so it imports no key');
    assert.doesNotMatch(calls, /tar .*-xf/, 'A preview extracts nothing');
    assert.doesNotMatch(calls, /^scp /m, 'A preview copies nothing');
    w.clean();
}

// And a preview of the staging route itself: the alias is not even probed.
{
    const w = world();
    const preview = w.run(['--dry-run', '--remote-path', '/srv/tor-browser-linux-x86_64-15.0.25.tar.xz']);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /preview only/, 'A preview says it is one');
    const calls = w.calls();
    assert.doesNotMatch(calls, /^ssh /m, 'A preview probes nothing');
    assert.doesNotMatch(calls, /^scp /m, 'A preview copies nothing');
    assert.doesNotMatch(calls, /apt-get install/, 'A preview installs no packages');
    assert.ok(!fs.existsSync(w.env.DEBIAN_SETUP_OPT_ROOT), 'A preview writes nothing');
    w.clean();
}

// Route (b): --from-dir, with the key already in the keyring. No network command may
// be reached at all, and the versioned install is what lands.
{
    const w = world();
    const staged = path.join(w.home, 'staged');
    fs.mkdirSync(staged, {recursive: true});
    fixture(staged);
    const result = w.run(['--from-dir', staged]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const app = path.join(w.env.DEBIAN_SETUP_OPT_ROOT, 'tor-browser');
    assert.ok(fs.existsSync(path.join(app, '15.0.25/Browser/start-tor-browser')),
        'The version comes from the filename and the top level is stripped');
    assert.equal(fs.readlinkSync(path.join(app, 'current')), '15.0.25',
        'current points at the version by a relative name');
    const desktop = path.join(w.env.DEBIAN_SETUP_SHARE_ROOT, 'applications/tor-browser.desktop');
    assert.ok(fs.existsSync(desktop), 'The .desktop file this script writes itself is installed');
    const entry = fs.readFileSync(desktop, 'utf8');
    assert.match(entry, /^Exec=.*tor-browser\/current\/Browser\/start-tor-browser/m,
        'Exec points through current, at the entry the archive was checked for');
    assert.match(entry, /^Type=Application$/m);
    const calls = w.calls();
    assert.doesNotMatch(calls, /^ssh /m, '--from-dir must not touch the network');
    assert.doesNotMatch(calls, /^scp /m, '--from-dir must not copy anything');
    assert.doesNotMatch(calls, /^curl /m, '--from-dir must not download anything');
    assert.match(calls, /gpg .*--verify/, 'The signature is checked even with no network');
    assert.match(result.stdout, /Signature verified/i, 'And the result is said out loud');
    w.clean();
}

// A failed verification stops that step, records it, and must never fall through to
// extraction: the whole point of the gate.
{
    const w = world({verifyStatus: 1});
    const staged = path.join(w.home, 'staged');
    fs.mkdirSync(staged, {recursive: true});
    fixture(staged);
    const result = w.run(['--from-dir', staged]);
    assert.equal(result.status, 1, 'A failed signature is a failed run');
    assert.match(result.stderr + result.stdout, /signature/i, 'Say what failed');
    assert.ok(!fs.existsSync(w.env.DEBIAN_SETUP_OPT_ROOT), '/opt must be untouched');
    assert.ok(!fs.existsSync(w.env.DEBIAN_SETUP_SHARE_ROOT), 'And no .desktop file installed');
    const calls = w.calls();
    assert.doesNotMatch(calls, /tar .*-xf/, 'Nothing may be extracted after a bad signature');
    assert.doesNotMatch(calls, /tar .*-tf/, 'The archive is not even listed');
    assert.match(result.stdout, /Steps that failed:/, 'The failure is named in the summary');
    w.clean();
}

// The key is not in the keyring and none was given: the fingerprint and the way out
// are printed, and nothing is verified or unpacked.
{
    const w = world({listStatus: 1});
    const staged = path.join(w.home, 'staged');
    fs.mkdirSync(staged, {recursive: true});
    fixture(staged);
    const result = w.run(['--from-dir', staged]);
    assert.equal(result.status, 1, 'No key is a failed run, not a silent install');
    assert.match(result.stderr + result.stdout, new RegExp(fingerprint), 'Name the key wanted');
    assert.match(result.stderr + result.stdout, /--key/, 'And the option that supplies it');
    assert.doesNotMatch(w.calls(), /gpg .*--verify/, 'Nothing is verified against an empty keyring');
    assert.ok(!fs.existsSync(w.env.DEBIAN_SETUP_OPT_ROOT), '/opt must be untouched');
    w.clean();
}

// An archive that does not contain the expected entry is refused before /opt is
// touched, and the override is named.
{
    const w = world();
    const staged = path.join(w.home, 'staged');
    fs.mkdirSync(staged, {recursive: true});
    fixture(staged, {valid: false});
    const result = w.run(['--from-dir', staged]);
    assert.equal(result.status, 1, 'An unexpected layout is a refusal');
    assert.ok(!fs.existsSync(path.join(w.env.DEBIAN_SETUP_OPT_ROOT, 'tor-browser', '15.0.25', 'Elsewhere')),
        'Nothing from the archive may be unpacked');
    assert.match(result.stdout, /--expect/, 'Name the way out of a layout that changed');
    w.clean();
}

// Route (a): the alias does not answer. A skip with a reason and exit 0 — never a
// hang, and never an scp.
{
    const w = world({sshStatus: 255});
    const result = w.run(['--remote-path', '/srv/tor-browser-linux-x86_64-15.0.25.tar.xz']);
    assert.equal(result.status, 0, 'An unconfigured alias is an ordinary outcome, not a failure');
    assert.match(result.stdout + result.stderr, /vps/, 'Name the alias that did not answer');
    assert.match(result.stdout + result.stderr, /skip/i, 'Say that Tor Browser is being skipped');
    const calls = w.calls();
    assert.match(calls, /^ssh .*BatchMode=yes.*ConnectTimeout=5/m,
        'The probe is batch mode with a timeout, so a DNS lookup cannot hang the run');
    assert.doesNotMatch(calls, /^scp /m, 'No copy may be attempted after a failed probe');
    assert.ok(!fs.existsSync(w.env.DEBIAN_SETUP_OPT_ROOT), 'And nothing is installed');
    w.clean();
}

// Route (a) end to end against the stub relay: probe, copy both files, verify, install.
{
    const w = world();
    const relay = w.env.SCP_SRC;
    fs.mkdirSync(relay, {recursive: true});
    const archive = fixture(relay);
    const result = w.run(['--remote-path', `/srv/${path.basename(archive)}`]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = w.calls();
    assert.match(calls, /^ssh /m, 'The alias is probed first');
    assert.match(calls, /scp .*vps:\/srv\/tor-browser-linux-x86_64-15\.0\.25\.tar\.xz/,
        'The tarball is copied from the alias');
    assert.match(calls, /scp .*vps:\/srv\/tor-browser-linux-x86_64-15\.0\.25\.tar\.xz\.asc/,
        'And its signature with it');
    assert.doesNotMatch(calls, /^curl /m, 'Still nothing downloaded');
    assert.ok(fs.existsSync(path.join(w.env.DEBIAN_SETUP_OPT_ROOT, 'tor-browser/15.0.25/Browser/start-tor-browser')),
        'The staged tarball is what gets installed');
    assert.match(result.stdout, /(not verified|unverified|could not)/i,
        'The closing output says what this script could not confirm');
    w.clean();
}

// The relay has not got the file: a recorded failure and a non-zero exit, because
// install.sh reaches this script through attempt and would otherwise swallow it.
{
    const w = world();
    fs.mkdirSync(w.env.SCP_SRC, {recursive: true});
    const result = w.run(['--remote-path', '/srv/absent.tar.xz']);
    assert.equal(result.status, 1, 'A failed copy must not report success');
    assert.match(result.stdout, /Steps that failed:/, 'The failure is named');
    assert.ok(!fs.existsSync(w.env.DEBIAN_SETUP_OPT_ROOT), 'And nothing is installed');
    w.clean();
}

// The packages come from the map's tor group, on both releases, and are declined by
// default like everything else.
{
    for (const release of ['debian', 'ubuntu']) {
        const w = world({release});
        const result = w.run([], 'y\nn\nn\nn\nn\nn\n');
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /gnupg/, `The tor group's gnupg is offered on ${release}`);
        assert.match(result.stdout, /xz-utils/, `And xz-utils on ${release}`);
        assert.match(w.calls(), /apt-get install -y .*gnupg/, 'Accepting installs them');
        assert.match(result.stdout, /torbrowser-launcher/,
            'And the rejected package is named, so the choice is visible');
        w.clean();
    }
}

console.log('setup-tor-browser-smoke: all checks passed');
