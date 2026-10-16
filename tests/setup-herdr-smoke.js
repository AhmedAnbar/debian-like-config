// SPDX-License-Identifier: GPL-3.0-only
// setup-herdr.sh against stubs. Nothing here reaches the network, apt or a real
// Herdr: curl is a stub that records whether it was called and hands back a fake
// installer, and the "herdr" the configuration steps validate against is a stub
// whose "config check" exits 0. The real herdr.dev download, the real 30285672-byte
// binary and the real "herdr config check" were exercised in containers during
// recon; they belong to the gated container suite, not here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'setup-herdr.sh');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-smoke-'));
const osRelease = (body, name) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, body);
    return file;
};
const debian = osRelease('ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const ubuntu = osRelease('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n', 'ubuntu');
// Kali is the one case where release and variant differ: release stays debian,
// because the archive, the suites and every version this port prints are Debian's,
// and variant is kali. Running only a Debian os-release, as this file used to, holds
// the script to neither half of that distinction.
const kali = osRelease('ID=kali\nID_LIKE=debian\nPRETTY_NAME="Kali GNU/Linux Rolling"\n', 'kali');

// The package map is a fixture, and it is set explicitly, because the two name
// assertions below claim the names come from the map rather than from this script.
// Against the repository's own map they prove nothing: curl and jq are where=both
// there, and the script's own ${jq_packages[*]:-jq} fallbacks print the same word
// with no map at all. So the fixture gives each of the two names a different
// spelling per archive -- none of which the script could guess -- and the three
// os-release fixtures above then show which archive was consulted. The kali row
// exists for one reason: map_named_packages takes the archive, so it must be
// invisible on a Kali run, and a lookup handed the variant instead would pick it up.
const mapFile = (name, rows) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, ['group\tarch\tapt\twhere\tnote', ...rows].join('\n') + '\n');
    return file;
};
const map = mapFile('apt-map.tsv', [
    'dev\tcurl\tcurl\tdebian\tthe Debian archive spelling',
    'dev\tcurl\tcurl-ubuntu-spelling\tubuntu\tthe Ubuntu archive spelling',
    'sway\tjq\tjq\tdebian\tthe Debian archive spelling',
    'sway\tjq\tjq-ubuntu-spelling\tubuntu\tthe Ubuntu archive spelling',
    'sway\tjq\tjq-kali-row\tkali\ta row keyed on the running variant, which this lookup does not read',
]);

// This machine runs a real network and a real package manager. A PATH built from a
// named list is the only way to be sure the script reached a stub and not the real
// thing: the zram and sway smoke tests do the same, for the same reason.
const minimalPath = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-path-'));
    for (const command of ['bash', 'sh', 'awk', 'basename', 'cat', 'chmod', 'chown', 'cmp', 'cp',
        'date', 'dirname', 'env', 'grep', 'id', 'install', 'mkdir', 'mktemp', 'mv', 'rm', 'rmdir',
        'sha256sum', 'sort', 'stat', 'tail', 'unlink']) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
    return dir;
};

// A herdr that answers the two subcommands this repository depends on: --version,
// which the script prints, and "config check", which both configuration helpers use
// to validate the file they staged before it replaces anything.
//
// "config check" has to be able to exit non-zero with real-looking output, because
// the real herdr 0.9.5 does: measured in debian:stable-slim on 2026-10-16, it exits
// 1 on an unknown key it only ignores as well as on a config it cannot parse, and it
// writes both diagnostics to stdout. A stub that can only exit 0 cannot tell those
// two apart, so it cannot show which one stops a run and which one must not.
const herdrStub = (log, {configStatus = 0, configOutput = 'config: ok'} = {}) => `#!/bin/sh
echo "herdr $* HERDR_CONFIG_PATH=\${HERDR_CONFIG_PATH:-unset}" >> ${log}
case "\${1:-}" in
    --version) echo "herdr 0.9.5" ;;
    config)
        cat <<'HERDR_CONFIG_OUTPUT'
${configOutput}
HERDR_CONFIG_OUTPUT
        exit ${configStatus} ;;
esac
exit 0
`;

// What the curl stub hands back instead of herdr.dev/install.sh. It has to parse
// under dash, because the script syntax-checks it with sh -n before running it, and
// it has to honour HERDR_INSTALL_DIR, because that is the one thing the real
// installer is trusted to do (its line 5 reads HERDR_INSTALL_DIR:-$HOME/.local/bin).
const installerStub = (log, herdrSource) => `#!/bin/sh
set -eu
echo "installer HERDR_INSTALL_DIR=\${HERDR_INSTALL_DIR:-unset}" >> ${log}
mkdir -p "\${HERDR_INSTALL_DIR:-\$HOME/.local/bin}"
cp -- ${herdrSource} "\${HERDR_INSTALL_DIR:-\$HOME/.local/bin}/herdr"
chmod +x "\${HERDR_INSTALL_DIR:-\$HOME/.local/bin}/herdr"
echo "> installed herdr to \${HERDR_INSTALL_DIR:-\$HOME/.local/bin}/herdr"
`;

// One run of the script, with its own home, its own stub PATH and its own log.
const herdr = ({args = [], answers = 'n', release = debian, installed = false,
    brokenLink = false, occupied = null, config = null, jq = true, curl = true,
    curlStatus = 0, apt = 0, fakeroot = false, times = 30, input = null,
    configStatus = 0, configOutput = 'config: ok', userStatusScript = null,
    packageMap = map} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-home-'));
    const bin = minimalPath();
    const log = path.join(home, 'calls');
    const herdrSource = path.join(home, 'herdr-binary');
    fs.writeFileSync(herdrSource, herdrStub(log, {configStatus, configOutput}), {mode: 0o755});
    const installer = path.join(home, 'fake-install.sh');
    fs.writeFileSync(installer, installerStub(log, herdrSource));
    // The whole point of this stub: it records that it was called, and a scenario
    // that must download nothing asserts the recording is absent.
    if (curl) {
        fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
echo "curl $*" >> ${log}
out=
prev=
for arg in "$@"; do
    if [ "$prev" = "-o" ]; then out=$arg; fi
    prev=$arg
done
if [ ${curlStatus} -eq 0 ] && [ -n "$out" ]; then cat -- ${installer} > "$out"; fi
exit ${curlStatus}
`, {mode: 0o755});
    }
    fs.writeFileSync(path.join(bin, 'sudo'), `#!/bin/sh\necho "sudo $*" >> ${log}\nexec "$@"\n`,
        {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'apt-get'), `#!/bin/sh\necho "apt-get $*" >> ${log}\nexit ${apt}\n`,
        {mode: 0o755});
    if (jq) {
        fs.writeFileSync(path.join(bin, 'jq'), `#!/bin/sh\necho "jq $*" >> ${log}\nexit 0\n`,
            {mode: 0o755});
    }
    const installDir = path.join(home, '.local/bin');
    const binary = path.join(installDir, 'herdr');
    if (installed) {
        fs.mkdirSync(installDir, {recursive: true});
        fs.copyFileSync(herdrSource, binary);
        fs.chmodSync(binary, 0o755);
    }
    if (brokenLink) {
        fs.mkdirSync(installDir, {recursive: true});
        fs.symlinkSync(path.join(home, 'nowhere/herdr'), binary);
    }
    if (occupied !== null) {
        fs.mkdirSync(installDir, {recursive: true});
        fs.writeFileSync(binary, occupied, {mode: 0o644});
    }
    if (userStatusScript !== null) {
        fs.mkdirSync(path.join(home, '.config/herdr'), {recursive: true});
        fs.writeFileSync(path.join(home, '.config/herdr/workspaces-status.sh'), userStatusScript,
            {mode: 0o755});
    }
    const configPath = path.join(home, '.config/herdr/config.toml');
    if (config !== null) {
        fs.mkdirSync(path.dirname(configPath), {recursive: true});
        fs.writeFileSync(configPath, config);
    }
    const command = fakeroot ? ['/usr/bin/fakeroot', ['bash', script, ...args]] : ['bash', [script, ...args]];
    const state = path.join(home, '.local/state/debian-desktop-setup');
    // One invocation, and a snapshot of everything it could have touched. A second
    // invocation has to happen in this same home, because the status script's
    // installed path is written into the config and a fresh home would change it.
    const invoke = () => {
        const result = spawnSync(command[0], command[1], {
            encoding: 'utf8', timeout: 60000,
            input: input === null ? `${answers}\n`.repeat(times) : input,
            env: {PATH: fakeroot ? `${bin}:/usr/bin:/bin` : bin, HOME: home,
                DEBIAN_SETUP_OS_RELEASE: release, DEBIAN_SETUP_MAP: packageMap},
        });
        return {
            result, home, bin, binary, configPath, state, again: invoke,
            out: result.stdout + result.stderr,
            calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
            statusScript: path.join(home, '.config/herdr/workspaces-status.sh'),
            written: fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null,
            backups: fs.existsSync(path.join(home, '.config/herdr'))
                ? fs.readdirSync(path.join(home, '.config/herdr')).filter((f) => f.includes('backup'))
                : [],
            clean: () => {
                fs.rmSync(bin, {recursive: true, force: true});
                fs.rmSync(home, {recursive: true, force: true});
            },
        };
    };
    return invoke();
};
// The download is the one thing this subject could do that a test must never do.
const noDownload = (run) => {
    assert.doesNotMatch(run.calls, /^curl /m, 'The curl stub must not have been called');
    assert.doesNotMatch(run.calls, /^installer /m, 'And no installer may have been executed');
};

// Scenario: usage. --help exits 0 and names the script; an unknown argument is 2.
{
    const help = herdr({args: ['--help']});
    assert.equal(help.result.status, 0, help.out);
    assert.match(help.result.stdout, /setup-herdr\.sh/, 'The help names the script');
    assert.match(help.result.stdout, /herdr\.dev/, 'And where the installer comes from');
    assert.match(help.result.stdout, /dry-run/, 'And the preview option');
    noDownload(help);
    help.clean();

    const bad = herdr({args: ['--invalid']});
    assert.equal(bad.result.status, 2, 'An unknown argument is a usage error');
    assert.match(bad.result.stderr, /Unknown argument/, 'And says so');
    noDownload(bad);
    bad.clean();
}

// Scenario: run as root. The upstream installer wants no root at all -- it contains
// no sudo, no id -u check, and writes only inside HERDR_INSTALL_DIR -- so a run
// under sudo would leave a root-owned binary in the user's own ~/.local/bin.
// fakeroot is what makes EUID 0 testable without being root; where it is absent the
// scenario is skipped rather than silently passed.
{
    if (fs.existsSync('/usr/bin/fakeroot')) {
        const asRoot = herdr({fakeroot: true});
        assert.equal(asRoot.result.status, 1, 'Running as root is refused');
        assert.match(asRoot.result.stderr, /normal user/, 'And says to use a normal user');
        noDownload(asRoot);
        asRoot.clean();
    } else {
        console.log('setup-herdr-smoke: skipped the root refusal, no fakeroot on this machine');
    }
}

// Scenario: --dry-run downloads nothing and writes nothing, and still walks the
// whole script with every prompt answered yes.
{
    const preview = herdr({args: ['--dry-run'], answers: 'y'});
    assert.equal(preview.result.status, 0, preview.out);
    noDownload(preview);
    assert.doesNotMatch(preview.calls, /^apt-get install/m, 'A preview installs nothing');
    assert.equal(fs.existsSync(preview.binary), false, 'A preview installs no binary');
    assert.equal(preview.written, null, 'A preview writes no configuration');
    assert.equal(fs.existsSync(preview.statusScript), false, 'And no status script');
    assert.equal(fs.existsSync(preview.state), false, 'And no backup directory');
    assert.match(preview.result.stdout, /HERDR_INSTALL_DIR/,
        'Name the variable the installer is given, since that is what bounds its writes');
    assert.match(preview.result.stdout, /\.local\/bin/, 'And where it would install');
    preview.clean();
}

// Scenario: declining the first review gate stops before any download.
{
    const declined = herdr({answers: 'n'});
    assert.equal(declined.result.status, 0, declined.out);
    noDownload(declined);
    assert.equal(fs.existsSync(declined.binary), false, 'Nothing is installed');
    // bash writes a read -p prompt only to a terminal, so what a declined run is
    // asserted on is its own prose and its summary, never the question it asked.
    assert.match(declined.result.stdout, /Left alone at your request/, 'The summary names what was declined');
    assert.match(declined.result.stdout, /install\.sh/, 'By the installer it did not fetch');
    declined.clean();
}

// Scenario: the two review gates. Accepting both downloads the installer, syntax
// checks it, and runs it with HERDR_INSTALL_DIR pointing at ~/.local/bin -- never
// with sudo, and never anywhere else.
{
    const run = herdr({answers: 'y'});
    assert.equal(run.result.status, 0, run.out);
    assert.match(run.calls, /^curl .*herdr\.dev\/install\.sh/m, 'The installer is fetched by URL');
    assert.match(run.calls, /--connect-timeout 10/, 'With a connect limit, so a dead host fails fast');
    assert.match(run.calls, /--max-time/, 'And a total limit');
    assert.match(run.calls, new RegExp(`^installer HERDR_INSTALL_DIR=${run.home}/\\.local/bin$`, 'm'),
        'The installer runs with HERDR_INSTALL_DIR set to ~/.local/bin and nothing else');
    assert.doesNotMatch(run.calls, /^sudo .*install\.sh/m, 'The installer is never run through sudo');
    assert.ok(fs.existsSync(run.binary), 'And it produced the executable');
    assert.match(run.result.stdout, /herdr 0\.9\.5/, 'The installed release is printed, not remembered');
    run.clean();
}

// Scenario: the summary on the download path. This is the script's main path -- a
// fresh install, every prompt accepted -- and it is the one path where the summary
// used to be lost, because a second EXIT trap for the private download directory
// replaced the one that prints it. Every other summary assertion in this file runs
// in a scenario that exits before that second trap would have been installed, so
// nothing here held the main path to the repository's summary contract.
{
    const done = herdr({answers: 'y'});
    assert.equal(done.result.status, 0, done.out);
    assert.ok(fs.existsSync(done.binary), 'The binary is there, so this really is the download path');
    assert.match(done.out, /Backups, when needed/,
        'The main path prints the summary, not only the paths that exit early');
    assert.match(done.out, new RegExp(done.state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'Naming the state directory this script backs up into');
    assert.match(done.out, /config\.toml\.backup-|beside the config/,
        'And the other place, because the two helpers keep theirs beside the config');
    // A completed run has nothing to report, and says so by omission rather than by
    // printing an empty heading.
    assert.doesNotMatch(done.out, /Steps that failed/, 'Nothing failed, so nothing is listed');
    assert.doesNotMatch(done.out, /Stopped before the end/, 'And it did reach the end');
    // The private download directory is still cleaned up: keeping the summary must
    // not mean leaking the installer into /tmp.
    const dir = done.out.match(/less (\S*debian-herdr\S*)\/install\.sh/);
    assert.ok(dir, `The run names the private directory it downloaded into: ${done.out}`);
    assert.equal(fs.existsSync(dir[1]), false,
        `The private download directory is removed on exit: ${dir[1]} is still there`);
    done.clean();
}

// Scenario: declining the second review gate, after the installer has been fetched
// and its SHA-256 shown. Nothing may be installed, and the summary has to say what
// was left alone -- the same contract as declining the first gate, which is the one
// asymmetry this pair of scenarios exists to rule out.
{
    const reviewed = herdr({input: 'y\nn\n'});
    assert.equal(reviewed.result.status, 0, reviewed.out);
    assert.match(reviewed.calls, /^curl /m, 'The installer was fetched for review');
    assert.doesNotMatch(reviewed.calls, /^installer /m, 'But never run');
    assert.equal(fs.existsSync(reviewed.binary), false, 'So nothing is installed');
    assert.match(reviewed.out, /Left alone at your request/,
        'Declining the second gate is reported exactly as declining the first one is');
    assert.match(reviewed.out, /install\.sh/, 'By the installer it fetched and did not run');
    assert.match(reviewed.out, /Backups, when needed/, 'And the summary is printed in full');
    reviewed.clean();
}

// Scenario: a curl that cannot reach herdr.dev fails with a message naming the host
// and the limits, rather than hanging or reporting a successful install.
{
    const offline = herdr({answers: 'y', curlStatus: 6});
    assert.equal(offline.result.status, 1, 'An unreachable host is a failure');
    assert.match(offline.result.stderr, /Could not fetch https:\/\/herdr\.dev\/install\.sh/,
        'Name the URL that could not be fetched');
    assert.match(offline.result.stderr, /10 second connect and 120 second/,
        'And the limits that bound the attempt, since a hang is the alternative');
    // The download has to be the thing that is reported. A fetch failure that falls
    // through to the syntax check blames the file for the network.
    assert.doesNotMatch(offline.result.stderr, /not valid POSIX shell/,
        'A failed download is not a malformed installer');
    assert.doesNotMatch(offline.calls, /^installer /m, 'And run no installer');
    assert.equal(fs.existsSync(offline.binary), false, 'And install nothing');
    offline.clean();
}

// Scenario: curl. It is the one prerequisite the upstream installer gates itself on
// that a minimal image does not already have, on any of the three distributions, and
// the name comes from the package map rather than from this script.
{
    const nocurl = herdr({curl: false, answers: 'y'});
    assert.equal(nocurl.result.status, 1, 'Nothing can be downloaded without curl');
    assert.match(nocurl.out, /apt-get install curl/, 'The hint names apt and the curl package');
    assert.doesNotMatch(nocurl.out, /pacman/, 'Never pacman: this is the Debian port');
    assert.match(nocurl.calls, /^apt-get install -y .*\bcurl\b/m,
        'Accepting the prompt installs curl with apt');
    assert.doesNotMatch(nocurl.calls, /^installer /m, 'And no installer runs either way');
    nocurl.clean();
}

// Scenario: already installed. The binary is left byte-for-byte alone, and the two
// configuration steps are still offered, because they are the reason to run this
// script a second time.
{
    const existing = herdr({installed: true, answers: 'y'});
    assert.equal(existing.result.status, 0, existing.out);
    assert.match(existing.result.stdout, /already installed/i, 'Say it is already there');
    assert.match(existing.result.stdout, /leaving the binary unchanged/i, 'And that it is left alone');
    assert.match(existing.result.stdout, /herdr 0\.9\.5/, 'Print the version that is installed');
    noDownload(existing);
    // The binary is the stub this test put there, unchanged: a run that re-installed
    // it would have had to download something, and nothing was downloaded.
    assert.match(fs.readFileSync(existing.binary, 'utf8'), /^#!\/bin\/sh$/m,
        'The binary that was there is the binary that is there');
    assert.equal(fs.readFileSync(existing.binary, 'utf8'),
        fs.readFileSync(path.join(existing.home, 'herdr-binary'), 'utf8'),
        'Byte for byte what it was');
    // Both configuration steps are still offered, and with every answer yes both of
    // them ran: the prompts themselves are invisible here, so their effect is the proof.
    assert.match(existing.result.stdout, /Ctrl\+A/, 'The prefix step is named before it asks');
    assert.match(existing.result.stdout, /tab row/i, 'And so is the workspace tab row step');
    assert.match(existing.written, /^prefix = "ctrl\+a"$/m, 'The prefix step ran');
    assert.match(existing.written, /^tab_bar_right = \[\{ type = "command"/m, 'And so did the tab row step');
    existing.clean();
}

// Scenario: a broken symlink at ~/.local/bin/herdr. It is neither an installation to
// leave alone nor free space to install into, so the script refuses and changes
// nothing: unlinking someone else's symlink is not this script's decision.
{
    const dangling = herdr({brokenLink: true, answers: 'y'});
    assert.equal(dangling.result.status, 1, 'A broken symlink stops the script');
    assert.match(dangling.result.stderr, /broken symlink|non-executable/i, 'Say what is in the way');
    assert.match(dangling.result.stderr, /Leaving it unchanged/i, 'And that it was not touched');
    noDownload(dangling);
    assert.ok(fs.lstatSync(dangling.binary).isSymbolicLink(), 'The symlink is still there');
    dangling.clean();
}

// Scenario: jq. The tab row needs it, it is absent from a minimal Debian 13,
// Ubuntu 26.04 and Kali Rolling install, and the name is apt's.
{
    const missing = herdr({installed: true, jq: false, answers: 'y'});
    assert.equal(missing.result.status, 0, missing.out);
    assert.match(missing.out, /apt-get install.*\bjq\b/,
        'The hint must name apt and the jq package');
    assert.doesNotMatch(missing.out, /pacman/, 'Never pacman: this is the Debian port');
    assert.match(missing.calls, /^apt-get install -y .*\bjq\b/m,
        'Accepting the prompt installs jq with apt, rather than only printing a hint');
    assert.match(missing.calls, /^apt-get install -y jq$/m,
        'And the Debian archive spelling of it, which is the one the map gives for this release');
    missing.clean();
}

// Scenario: Ubuntu. A different archive, so a different row of the map answers for
// the same package, and the family in the first three lines is Ubuntu's.
{
    const onUbuntu = herdr({installed: true, jq: false, answers: 'y', release: ubuntu});
    assert.equal(onUbuntu.result.status, 0, onUbuntu.out);
    assert.match(onUbuntu.result.stdout, /\(Ubuntu family\)/, 'Ubuntu is named as the family');
    assert.match(onUbuntu.out, /jq-ubuntu-spelling/,
        'The jq name is the one the map gives for this archive, not a name from the script');
    assert.match(onUbuntu.calls, /^apt-get install -y jq-ubuntu-spelling$/m,
        'And that is the name apt is asked for');
    onUbuntu.clean();
}

// Scenario: Kali. release is the archive, which is Debian's for Kali, and variant is
// what is running. The family shown is Kali's; the package name is Debian's. The
// map's kali row has to stay invisible here, because map_named_packages is handed
// the archive -- hand it the variant and that row answers instead.
{
    const onKali = herdr({installed: true, jq: false, answers: 'y', release: kali});
    assert.equal(onKali.result.status, 0, onKali.out);
    assert.match(onKali.result.stdout, /\(Kali family\)/, 'Kali is named as the family that is running');
    assert.match(onKali.calls, /^apt-get install -y jq$/m,
        'And the package name is the Debian archive spelling, because that is the archive Kali uses');
    assert.doesNotMatch(onKali.out, /jq-kali-row/,
        'The row keyed on the variant is not what this lookup reads');
    assert.doesNotMatch(onKali.out, /jq-ubuntu-spelling/, 'Nor is another archive\u2019s row');
    onKali.clean();
}

// Scenario: Ubuntu again, for curl. The same claim as the jq one above, on the other
// of the two names this script may have to install.
{
    const curlUbuntu = herdr({curl: false, answers: 'y', release: ubuntu});
    assert.equal(curlUbuntu.result.status, 1, 'Nothing can be downloaded without curl');
    assert.match(curlUbuntu.out, /curl-ubuntu-spelling/, 'The curl name comes from the map too');
    assert.match(curlUbuntu.calls, /^apt-get install -y curl-ubuntu-spelling$/m,
        'And that is the name apt is asked for');
    curlUbuntu.clean();
}

// Scenario: no package map. Both names this script installs come out of it, so a run
// without it has nothing to name and must say that rather than guess.
{
    const noMap = herdr({packageMap: path.join(scratch, 'there-is-no-such-map.tsv'), answers: 'y'});
    assert.equal(noMap.result.status, 1, 'A missing map stops the script');
    assert.match(noMap.result.stderr, /Missing package map/, 'And says what is missing');
    noDownload(noMap);
    noMap.clean();
}

// Scenario: the configuration steps edit only the keys they manage. The rest of an
// existing config.toml -- its other tables, its other keys, its comments -- survives,
// and the file it replaced is kept beside it.
{
    const source = 'onboarding = false\n\n[theme]\nname = "catppuccin"\n\n'
        + '[keys]\nprefix = "ctrl+b"\nnew_tab = "prefix+c"\n\n'
        + '[ui]\naccent = "mauve"\nconfirm_close = true\n';
    const edited = herdr({installed: true, config: source, answers: 'y'});
    assert.equal(edited.result.status, 0, edited.out);
    const updated = edited.written;
    assert.match(updated, /^prefix = "ctrl\+a"$/m, 'The prefix is the one key the first step sets');
    assert.match(updated, /^sidebar_start_collapsed = true$/m, 'The sidebar is collapsed');
    assert.match(updated, /^sidebar_collapsed_mode = "hidden"$/m, 'And hidden rather than narrow');
    assert.match(updated, new RegExp(`^tab_bar_right = \\[\\{ type = "command", command = "${edited.statusScript}"`, 'm'),
        'The tab row runs the status script that was installed, by its installed path');
    assert.match(updated, /^switch_workspace = "prefix\+shift\+1\.\.9"$/m,
        'Workspaces take the shifted digits, because prefix+1..9 already switches tabs');
    assert.match(updated, /^onboarding = false$/m, 'A key outside every managed table survives');
    assert.match(updated, /^name = "catppuccin"$/m, 'And so does another table');
    assert.match(updated, /^new_tab = "prefix\+c"$/m, 'And an unmanaged key inside [keys]');
    assert.match(updated, /^accent = "mauve"$/m, 'And an unmanaged key inside [ui]');
    assert.match(updated, /^confirm_close = true$/m);
    assert.equal(updated.match(/^\[keys\]$/gm).length, 1, 'One [keys] table only');
    assert.equal(updated.match(/^\[ui\]$/gm).length, 1, 'One [ui] table only');
    assert.equal(updated.match(/^sidebar_collapsed_mode/gm).length, 1, 'No duplicated keys');
    assert.doesNotMatch(updated, /ctrl\+b/, 'The old prefix is gone, not commented out');
    assert.equal(edited.backups.length, 2, 'Each helper keeps the file it replaced, beside the config');
    assert.ok(edited.backups.every((name) => /^config\.toml\.backup-\d{8}-\d{6}-\d+$/.test(name)),
        `The backups are named for when they were taken: ${edited.backups.join(' ')}`);
    assert.match(fs.readFileSync(path.join(path.dirname(edited.configPath), edited.backups.sort()[0]), 'utf8'),
        /prefix = "ctrl\+b"/, 'And the first of them is the file as it was');
    assert.equal(fs.statSync(edited.statusScript).mode & 0o777, 0o755,
        'The tab row cannot run a status script it may not execute');
    // The backups land beside the config, not under the state directory, because both
    // helpers are copied from the Arch repository byte for byte. The summary has to
    // name both places rather than the one the convention would predict.
    assert.match(edited.result.stdout, new RegExp(edited.state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'The summary names the state directory this script backs up into');
    assert.match(edited.result.stdout, /config\.toml\.backup-|beside the config/,
        'And the other place the two helpers put theirs');
    edited.clean();
}

// Scenario: a config.toml carrying one key this herdr does not know. Measured with
// the real herdr 0.9.5 in debian:stable-slim on 2026-10-16: "herdr config check" on
// a file whose only oddity is an unrecognised key prints
//   config: issues found
//   unknown config key ui.future_option; ignoring key
// to stdout and exits 1, while herdr itself only ignores the key and runs normally.
// Both configuration helpers stop on that status, so a config written by a newer
// herdr, or carrying a key herdr has since renamed, used to abort the whole run.
// It must not: the key is reported, and both steps still apply.
{
    const source = '[ui]\naccent = "mauve"\nfuture_option = true\n';
    const unknown = herdr({installed: true, config: source, answers: 'y', configStatus: 1,
        configOutput: 'config: issues found\nunknown config key ui.future_option; ignoring key'});
    assert.equal(unknown.result.status, 0,
        `A key herdr itself only ignores must not abort the run: ${unknown.out}`);
    assert.match(unknown.out, /unknown config key ui\.future_option/,
        'What herdr said is on screen, so the user can see which key it was');
    assert.match(unknown.out, /ignor/i, 'And that it is being ignored rather than stopping anything');
    assert.match(unknown.written, /^prefix = "ctrl\+a"$/m, 'The prefix step still ran');
    assert.match(unknown.written, /^tab_bar_right = \[\{ type = "command"/m, 'And so did the tab row step');
    assert.match(unknown.written, /^future_option = true$/m,
        'The key herdr does not know is left in the file, because it is not ours to remove');
    assert.match(unknown.written, /^accent = "mauve"$/m, 'And so is the rest of the table');
    unknown.clean();
}

// Scenario: a config.toml herdr cannot parse. The same non-zero status from the same
// command, and the opposite answer: nothing may be written into a file we cannot
// read, so the run stops, the parse error is what is on screen, and the file is
// exactly as it was.
{
    const source = '[ui]\naccent = "unclosed\n';
    const broken = herdr({installed: true, config: source, answers: 'y', configStatus: 1,
        configOutput: 'config: issues found\nconfig parse error: TOML parse error at line 2, column 19\n'
            + '  |\n2 | accent = "unclosed\n  |                   ^\ninvalid basic string\n; using defaults'});
    assert.equal(broken.result.status, 1, 'A config that does not parse stops the run');
    assert.match(broken.out, /config parse error/, 'And the parse error is what is on screen');
    assert.equal(broken.written, source, 'The file is byte for byte what it was');
    assert.equal(broken.backups.length, 0, 'Nothing was backed up, because nothing was replaced');
    assert.match(broken.out, /Backups, when needed/, 'And the summary is still printed');
    broken.clean();
}

// Scenario: declining install_file's "Back up and replace" for the status script,
// with a file of the user's own already at that path. Everything the tab row shows
// comes out of that file, so a config rewired to execute it would run whatever
// happens to be there once a second, under this repository's name. Declining the
// file has to decline the rewiring with it, and the run has to say so rather than
// report the step as done.
{
    const mine = '#!/bin/sh\necho MY OWN SCRIPT\n';
    const kept = herdr({installed: true, userStatusScript: mine, input: 'y\ny\nn\n'});
    assert.equal(kept.result.status, 0, kept.out);
    assert.equal(fs.readFileSync(kept.statusScript, 'utf8'), mine,
        'The file that was declined is byte for byte what it was');
    assert.doesNotMatch(kept.written || '', /tab_bar_right/,
        'And the config is not rewired to execute it');
    assert.doesNotMatch(kept.written || '', /sidebar_collapsed_mode/,
        'Nor is the sidebar hidden, since the tab row meant to replace it was not set up');
    assert.doesNotMatch(kept.out, /The sidebar is hidden and the tab row lists workspaces/,
        'And success is not printed for a step that did not happen');
    assert.match(kept.out, /Left alone at your request/, 'The summary says something was left alone');
    assert.match(kept.out, /workspaces-status\.sh/, 'And names the file it was');
    // The other step is independent and was accepted, so it still applies.
    assert.match(kept.written || '', /^prefix = "ctrl\+a"$/m, 'The prefix step is unaffected');
    kept.clean();
}

// Scenario: an idempotent second pass. A settled configuration is left exactly as it
// is, and no further backup is taken for a file nothing changed.
{
    const source = 'onboarding = false\n[theme]\nname = "catppuccin"\n';
    const first = herdr({installed: true, config: source, answers: 'y'});
    assert.equal(first.result.status, 0, first.out);
    const settled = first.written;
    // The second pass runs in the same home, so the status script's path inside the
    // config is the same one: a fresh home would differ for a reason that is the
    // test's, not the script's.
    const second = first.again();
    assert.equal(second.result.status, 0, second.out);
    assert.equal(second.written, settled, 'A second run must change nothing');
    assert.equal(second.backups.length, first.backups.length,
        'An unchanged file needs no further backup');
    assert.match(second.result.stdout, /config unchanged/, 'And says so');
    second.clean();
}

// Scenario: the closing prose must not promise what no test here can show. The tab
// row prints nothing at all until a herdr server is running, which is what a user
// sees on first launch, and nothing in this file exercises a running server.
{
    const closing = herdr({answers: 'y'});
    assert.match(closing.result.stdout, /no herdr server|server is running|first launch/i,
        'Say what the tab row does before a server exists');
    assert.match(closing.result.stdout, /PATH/, 'And that ~/.local/bin is already on PATH here');
    closing.clean();
}

// Scenario: the two awk programs under the awk the target distributions actually
// have. Everything above runs them under whatever /usr/bin/awk is on the machine the
// suite runs on, and on the Arch host this port was written on that is gawk -- while
// debian:stable-slim, ubuntu:latest and kalilinux/kali-rolling all resolve awk to
// /usr/bin/mawk through the alternatives link, with no gawk installed at all. The
// programs use POSIX character classes throughout and write to /dev/stderr, neither
// of which mawk is obliged to support, so the edits are proved here against the real
// thing rather than argued about. Gated, because it needs Docker.
if (process.env.DEBIAN_SETUP_CONTAINER_TESTS !== '1') {
    console.log('setup-herdr-smoke: skipped the mawk scenario '
        + '(set DEBIAN_SETUP_CONTAINER_TESTS=1 to run it)');
} else {
    const docker = spawnSync('docker', ['--version'], {encoding: 'utf8'});
    assert.equal(docker.status, 0,
        `DEBIAN_SETUP_CONTAINER_TESTS=1 needs a usable docker: ${docker.stderr}`);
    const probe = `
set -e
echo "AWK IS $(readlink -f "$(command -v awk)")"
awk -W version 2>&1 | head -1 || true
printf 'onboarding = false\\n\\n[theme]\\nname = "catppuccin"\\n\\n[keys]\\nprefix = "ctrl+b"\\nnew_tab = "prefix+c"\\n\\n[ui]\\naccent = "mauve"\\nconfirm_close = true\\n' > /tmp/in.toml
echo "@@@PREFIX@@@"
awk -f /bundle/scripts/herdr-prefix.awk /tmp/in.toml
echo "@@@UI@@@"
awk -v CMD=/home/me/.config/herdr/workspaces-status.sh -f /bundle/scripts/herdr-ui.awk /tmp/in.toml
echo "@@@EMPTY@@@"
awk -f /bundle/scripts/herdr-prefix.awk /dev/null
awk -v CMD=/x/s.sh -f /bundle/scripts/herdr-ui.awk /dev/null
echo "@@@BAIL@@@"
printf '[ui]\\ntab_bar_right = [\\n  { type = "command" }\\n]\\n' > /tmp/ml.toml
if awk -v CMD=/x/s.sh -f /bundle/scripts/herdr-ui.awk /tmp/ml.toml > /tmp/ml.out 2> /tmp/ml.err; then
    echo "BAIL EXIT zero"
else
    echo "BAIL EXIT nonzero"
fi
echo "BAIL STDERR $(cat /tmp/ml.err)"
echo "@@@END@@@"
`;
    for (const image of ['debian:stable-slim', 'ubuntu:latest', 'kalilinux/kali-rolling']) {
        const result = spawnSync('docker', ['run', '--rm', '-v', `${root}:/bundle:ro`,
            image, 'sh', '-c', probe], {encoding: 'utf8', timeout: 900000});
        const out = `${result.stdout}\n${result.stderr}`;
        assert.equal(result.status, 0, `${image}: the probe itself must succeed: ${out}`);
        const part = (name) => {
            const chunks = out.split(/@@@(?:PREFIX|UI|EMPTY|BAIL|END)@@@/);
            return chunks[{head: 0, prefix: 1, ui: 2, empty: 3, bail: 4}[name]];
        };
        // The premise. If this ever stops holding, the scenario below is proving
        // something about a different awk and the message has to say so.
        assert.match(part('head'), /AWK IS \/usr\/bin\/mawk/,
            `${image}: awk is expected to be mawk here, which is what makes this scenario worth running: ${out}`);
        // herdr-prefix.awk: the one key it manages, and nothing else disturbed.
        assert.match(part('prefix'), /^prefix = "ctrl\+a"$/m, `${image}: mawk sets the prefix`);
        assert.doesNotMatch(part('prefix'), /ctrl\+b/, `${image}: and removes the old one`);
        assert.match(part('prefix'), /^onboarding = false$/m, `${image}: a key outside every table survives`);
        assert.match(part('prefix'), /^new_tab = "prefix\+c"$/m, `${image}: and an unmanaged key inside [keys]`);
        assert.equal(part('prefix').match(/^\[keys\]$/gm).length, 1, `${image}: one [keys] table only`);
        // herdr-ui.awk: every key it manages, with the command path it was given.
        assert.match(part('ui'), /^sidebar_start_collapsed = true$/m, `${image}: mawk collapses the sidebar`);
        assert.match(part('ui'), /^sidebar_collapsed_mode = "hidden"$/m, `${image}: and hides rather than narrows it`);
        assert.match(part('ui'),
            /^tab_bar_right = \[\{ type = "command", command = "\/home\/me\/\.config\/herdr\/workspaces-status\.sh", interval_seconds = 1, timeout_seconds = 2 \}\]$/m,
            `${image}: and writes the tab row with the absolute path it was handed: ${part('ui')}`);
        assert.match(part('ui'), /^switch_workspace = "prefix\+shift\+1\.\.9"$/m, `${image}: and the workspace keys`);
        assert.match(part('ui'), /^accent = "mauve"$/m, `${image}: an unmanaged key inside [ui] survives`);
        assert.match(part('ui'), /^confirm_close = true$/m);
        assert.match(part('ui'), /^name = "catppuccin"$/m, `${image}: and another table entirely`);
        assert.equal(part('ui').match(/^\[ui\]$/gm).length, 1, `${image}: one [ui] table only`);
        assert.equal(part('ui').match(/^sidebar_collapsed_mode/gm).length, 1, `${image}: no duplicated keys`);
        // An absent config: both programs have to write their table from nothing,
        // which is the END-block path and the one a fresh install takes.
        assert.match(part('empty'), /^\[keys\]$/m, `${image}: an empty config gets a [keys] table`);
        assert.match(part('empty'), /^\[ui\]$/m, `${image}: and a [ui] table`);
        assert.match(part('empty'), /^prefix = "ctrl\+a"$/m, `${image}: with the prefix in it`);
        // The refusal path, which is the one that writes to /dev/stderr. mawk is not
        // obliged to open that name, and a message that went nowhere would leave the
        // helper exiting non-zero with nothing on screen to explain it.
        assert.match(part('bail'), /BAIL EXIT nonzero/,
            `${image}: a multi-line managed array refuses rather than mangling the file`);
        assert.match(part('bail'), /BAIL STDERR A multi-line tab_bar_right array needs manual editing/,
            `${image}: and says so on /dev/stderr, which mawk has to be able to open: ${part('bail')}`);
    }
    console.log('setup-herdr-smoke: the awk programs behave identically under mawk on all three images');
}

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-herdr-smoke: all checks passed');
