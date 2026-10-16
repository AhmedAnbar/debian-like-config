// SPDX-License-Identifier: GPL-3.0-only
// setup-docker.sh against stubs only. Nothing here reaches the network, apt, dpkg or
// systemd: every external command the script can call is a stub under one mkdtemp
// directory, PATH contains nothing else, and the vendor repository's writes are
// redirected with DEBIAN_SETUP_ETC_ROOT. The stubs that would cost something — curl,
// gpg, apt-get, systemctl, usermod — are the only ones that log, so an empty log is
// proof that a run fetched nothing, installed nothing and enabled nothing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

// This machine is not Debian and may have no dpkg at all, while the one the script
// runs on has dpkg and probably docker. Neither may decide what the test sees, so
// PATH is built from a named list and every other command is a stub.
const borrow = (dir, commands) => {
    for (const command of commands) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
};

const scenario = ({
    release = 'debian',
    candidate = '5:29.9.1',
    dockerIoCandidate = '28.5.2+dfsg4-5',
    dockerIo = false,
    download = 'tarball',
    answers = 'y\n'.repeat(40),
    args = [],
    machine = 'x86_64',
    dpkg = true,
} = {}) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-smoke-'));
    const home = path.join(base, 'home');
    const bin = path.join(base, 'bin');
    const stage = path.join(base, 'stage');
    for (const dir of [home, bin, stage]) fs.mkdirSync(dir);
    const log = path.join(base, 'calls');
    const aptRoot = path.join(base, 'aptroot');
    borrow(bin, ['bash', 'sh', 'awk', 'basename', 'cat', 'chmod', 'cp', 'date', 'dirname',
        // gzip because GNU tar forks it for -z, and PATH holds nothing but this directory.
        'env', 'grep', 'gzip', 'id', 'install', 'mkdir', 'mktemp', 'rm', 'sort', 'tail', 'tar']);
    // What the stubbed download hands back: the real asset is a tarball with the
    // static binary at its top level, which is the one thing the script can check.
    fs.writeFileSync(path.join(stage, 'lazydocker'), '#!/bin/sh\nprintf "Version: 0.25.2\\n"\n',
        {mode: 0o755});
    const fixture = path.join(base, 'fixture.tar.gz');
    const built = spawnSync('tar', ['-czf', fixture, '-C', stage, 'lazydocker'], {encoding: 'utf8'});
    assert.equal(built.status, 0, built.stderr);
    const body = {
        tarball: `cat ${fixture} > "$out"`,
        'error-page': 'printf \'<html>404</html>\\n\' > "$out"',
        fail: 'exit 22',
    }[download];
    assert.ok(body, `Unknown download mode: ${download}`);
    // The URL is the last argument in both calls the script makes, after the -- .
    fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
echo "curl $*" >> ${log}
out=''
url=''
while [ $# -gt 0 ]; do
  case "$1" in -o) out=$2; shift ;; -*) ;; *) url=$1 ;; esac
  shift
done
case "$url" in
  *github.com*) ${body} ;;
  *) printf 'KEYBYTES\\n' > "$out" ;;
esac
exit 0
`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'gpg'), `#!/bin/sh
echo "gpg $*" >> ${log}
out=''
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out=$2; shift; done
[ -n "$out" ] && printf 'DEARMORED\\n' > "$out"
exit 0
`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'apt-get'), `#!/bin/sh\necho "apt-get $*" >> ${log}\nexit 0\n`,
        {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh\necho "systemctl $*" >> ${log}\nexit 0\n`,
        {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'usermod'), `#!/bin/sh\necho "usermod $*" >> ${log}\nexit 0\n`,
        {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    // Read-only probes do not log: that is what lets an untouched machine be proved
    // by an empty log rather than by a list of lines that are allowed to be there.
    // The version table is part of the stub because add_vendor_repo checks where the
    // candidate comes from, not just that there is one: apt reports a candidate for any
    // installed package out of /var/lib/dpkg/status with no repository at all.
    // Per package, because the archive's docker.io and the vendor's docker-ce are two
    // different answers and a derivative's run reads the first one.
    const vendorReply = candidate
        ? `printf '  Installed: (none)\\n  Candidate: ${candidate}\\n  Version table:\\n'\n`
            + `printf '     ${candidate} 500\\n        500 https://download.docker.com/linux/debian trixie/stable amd64 Packages\\n'`
        : `printf '  Installed: (none)\\n  Candidate: (none)\\n  Version table:\\n'`;
    fs.writeFileSync(path.join(bin, 'apt-cache'),
        `#!/bin/sh\ncase "$*" in\n  *docker.io*) printf '  Installed: (none)\\n  Candidate: ${dockerIoCandidate}\\n' ;;\n`
        + `  *) ${vendorReply} ;;\nesac\n`, {mode: 0o755});
    if (dpkg) {
        fs.writeFileSync(path.join(bin, 'dpkg'), '#!/bin/sh\nprintf \'amd64\\n\'\n', {mode: 0o755});
    }
    fs.writeFileSync(path.join(bin, 'dpkg-query'), dockerIo
        ? '#!/bin/sh\nprintf \'install ok installed\\n\'\nexit 0\n'
        : '#!/bin/sh\nprintf \'dpkg-query: no packages found\\n\' >&2\nexit 1\n', {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'uname'), `#!/bin/sh\nprintf '${machine}\\n'\n`, {mode: 0o755});
    const releases = {
        debian: 'ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n',
        ubuntu: 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n',
        fedora: 'ID=fedora\nPRETTY_NAME="Fedora Linux 44"\n',
        kali: 'ID=kali\nID_LIKE=debian\nVERSION_CODENAME=kali-rolling\nPRETTY_NAME="Kali GNU/Linux Rolling"\n',
    };
    const osRelease = path.join(base, `os-release-${release}`);
    fs.writeFileSync(osRelease, releases[release]);
    const result = spawnSync('bash', [path.join(root, 'setup-docker.sh'), ...args], {
        encoding: 'utf8', timeout: 90000, input: answers,
        env: {HOME: home, USER: 'tester', PATH: bin, DEBIAN_SETUP_OS_RELEASE: osRelease,
            DEBIAN_SETUP_ETC_ROOT: aptRoot},
    });
    return {
        result, base, home, aptRoot,
        log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
        sources: path.join(aptRoot, 'etc/apt/sources.list.d/docker.list'),
        keyring: path.join(aptRoot, 'etc/apt/keyrings/docker.gpg'),
        lazydocker: path.join(home, '.local/bin/lazydocker'),
    };
};
const done = (s) => fs.rmSync(s.base, {recursive: true, force: true});

// Arguments and guards, before anything else can have happened.
{
    const bad = scenario({args: ['--invalid']});
    assert.equal(bad.result.status, 2, 'An unknown argument is a usage error');
    assert.equal(bad.log, '', 'A usage error must not have run anything');
    done(bad);
    const help = scenario({args: ['--help']});
    assert.equal(help.result.status, 0, 'Asking for help is not an error');
    assert.match(help.result.stdout, /setup-docker\.sh/, 'Help names the script');
    assert.equal(help.log, '', 'Help must not have run anything');
    done(help);
    const fedora = scenario({release: 'fedora', args: ['--dry-run']});
    assert.equal(fedora.result.status, 1, 'An unsupported distribution is refused');
    assert.match(fedora.result.stderr, /Debian 13 and Ubuntu 26\.04/, 'And says what is supported');
    done(fedora);
}

// A preview names every route and every version, and writes nothing at all.
{
    const s = scenario({args: ['--dry-run']});
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.match(s.result.stdout, /download\.docker\.com\/linux\/debian trixie stable/,
        'Name the repository and the suite this release gets');
    for (const version of ['5:29.9.1', '2.4.2-2', '0.38.0', '5.6.0', '0.25.2']) {
        assert.ok(s.result.stdout.includes(version), `Name the ${version} this phase proved`);
    }
    assert.match(s.result.stdout, /root-equivalent/i, 'Say what docker group membership means');
    assert.match(s.result.stdout, /log ?in|login/i, 'And that it needs a new login');
    assert.equal(s.log, '', 'A preview fetches nothing, installs nothing and enables nothing');
    // The helper's own preview, not a shell-quoted call to it: try routes through run,
    // and run does not execute anything under --dry-run, so wrapping the helper in try
    // turns its preview into dead code and prints an internal function call that reads
    // like a command the user could run.
    assert.match(s.result.stdout, /preview only: no key fetched/,
        "The repository helper's own preview must run");
    assert.doesNotMatch(s.result.stdout, /add_vendor_repo /,
        'A preview must not print an internal function call as if it were a command');
    assert.ok(!fs.existsSync(s.aptRoot), 'A preview adds no repository');
    assert.deepEqual(fs.readdirSync(s.home), [], 'A preview writes nothing into HOME');
    done(s);
}

// dpkg missing from PATH. The architecture probe runs before the ERR trap is even
// installed, so an unguarded command substitution there aborts the script with
// "stopped at line 0" and no summary at all — the one outcome every script in this
// repository is built to avoid.
{
    const s = scenario({dpkg: false});
    assert.doesNotMatch(s.result.stderr, /stopped at line/,
        'A missing probe must not abort the run before the summary exists');
    assert.match(s.result.stdout + s.result.stderr, /architecture/i,
        'Say that the architecture could not be read');
    assert.match(s.result.stdout, /Backups, when needed:/,
        'A summary must still be printed');
    assert.match(s.result.stdout + s.result.stderr, /using amd64/,
        'On x86_64 it says which architecture it used instead of guessing silently');
    assert.ok(fs.existsSync(s.sources),
        'And route 1 is still offered, because amd64 is what x86_64 means to apt');
    done(s);
}

// No dpkg and not x86_64: there is no architecture Docker publishes for, so route 1
// is not offered at all. A sources line with no arch= makes apt fetch an index that
// is not there, which breaks every later update — including install.sh's fatal one.
{
    const s = scenario({dpkg: false, machine: 'aarch64'});
    assert.doesNotMatch(s.result.stderr, /stopped at line/, 'Still no abort');
    assert.ok(!fs.existsSync(s.sources), 'No repository is added');
    assert.match(s.result.stdout, /Backups, when needed:/, 'The summary is printed');
    assert.match(s.result.stdout, /could not\n?be resolved/,
        'And it repeats why route 1 never appeared');
    done(s);
}

// Every step declines by default: a run of all-no changes nothing and exits 0.
{
    const s = scenario({answers: 'n\n'.repeat(40)});
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.equal(s.log, '', 'Declining every step must fetch, install and enable nothing');
    assert.ok(!fs.existsSync(s.sources), 'No repository is added');
    assert.ok(!fs.existsSync(s.lazydocker), 'No binary is installed');
    assert.deepEqual(fs.readdirSync(s.home), [], 'And nothing is written into HOME');
    assert.match(s.result.stdout, /docker group/, 'The group is still explained');
    done(s);
}

// docker.io is already installed: docker-ce Conflicts with it, so the engine step is
// refused and reported, and removing an engine is left to the user.
{
    const s = scenario({dockerIo: true});
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.match(s.result.stdout, /[Rr]efus/, 'Refuse, in those words');
    assert.match(s.result.stdout, /docker\.io/, 'Name the package that is in the way');
    assert.match(s.result.stdout, /Conflicts/, 'Say why: docker-ce Conflicts with it');
    assert.match(s.result.stdout, /your (own )?call|up to you|decide/i,
        'Removing an engine is the user\'s decision, not this script\'s');
    assert.doesNotMatch(s.log, /download\.docker\.com/,
        'The key must not be fetched when the engine cannot be installed');
    assert.doesNotMatch(s.log, /docker-ce/, 'And no vendor package is installed');
    assert.doesNotMatch(s.log, /apt-get remove|apt-get purge/, 'And nothing is removed');
    assert.ok(!fs.existsSync(s.sources), 'No repository is added either');
    // The rest of the run still applies: the engine is there, just not this one.
    assert.match(s.log, /usermod -aG docker tester/, 'The group step still applies');
    assert.ok(fs.existsSync(s.lazydocker), 'And so does lazydocker');
    assert.doesNotMatch(s.result.stdout, /Steps that failed/,
        'A deliberate refusal is not a failed step');
    done(s);
}

// The vendor route, working: key, sources line, the five packages, the group, the
// service, lazydocker — and no apt fallback, because the vendor route succeeded.
{
    const s = scenario();
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.ok(fs.existsSync(s.keyring), 'The dearmored key is installed');
    const line = fs.readFileSync(s.sources, 'utf8');
    assert.match(line, /^deb \[arch=amd64 signed-by=\S*\/etc\/apt\/keyrings\/docker\.gpg\] /,
        'A key under /etc/apt/keyrings is only trusted when the line says signed-by');
    assert.match(line, /https:\/\/download\.docker\.com\/linux\/debian trixie stable\n$/,
        'The suite follows the release');
    assert.match(s.log,
        /apt-get install -y docker-ce docker-ce-cli containerd\.io docker-buildx-plugin docker-compose-plugin/,
        'All five vendor packages, in one transaction');
    assert.doesNotMatch(s.log, /docker\.io/,
        'The apt fallback is for a failed vendor route, not an extra engine on top of it');
    assert.match(s.log, /usermod -aG docker tester/, 'The docker group is offered and added');
    assert.match(s.log, /systemctl enable --now docker\.service/, 'The service is enabled on request');
    assert.ok(fs.existsSync(s.lazydocker), 'lazydocker is installed');
    assert.equal(fs.statSync(s.lazydocker).mode & 0o777, 0o755, 'And it is executable');
    assert.match(s.result.stdout, /not verif|could not be verif|unverified/i,
        'Say what this run could not show');
    done(s);
}

// Ubuntu gets its own suite, and the same five packages.
{
    const s = scenario({release: 'ubuntu'});
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.match(fs.readFileSync(s.sources, 'utf8'),
        /https:\/\/download\.docker\.com\/linux\/ubuntu resolute stable\n$/,
        'Ubuntu 26.04 is resolute, not trixie');
    done(s);
}

// The vendor route fails. apt-get update exits 0 when a vendor host is unreachable,
// so the failure arrives as a missing candidate — and then the apt fallback from the
// map's docker group is offered instead. The failure is still reported, and the exit
// status is non-zero because install.sh reaches this script through attempt.
{
    const s = scenario({candidate: ''});
    assert.equal(s.result.status, 1, 'A failed step must not report success');
    assert.match(s.result.stdout, /Steps that failed/, 'The summary names it');
    assert.match(s.result.stdout, /add_vendor_repo docker/, 'By name');
    assert.ok(!fs.existsSync(s.sources), 'A repository that did not verify is removed again');
    assert.ok(!fs.existsSync(s.keyring), 'And its keyring with it');
    const fallback = s.log.match(/apt-get install -y ([^\n]*docker\.io[^\n]*)/);
    assert.ok(fallback, 'The apt fallback is offered when the vendor route fails');
    for (const name of ['docker.io', 'docker-cli', 'docker-compose', 'docker-buildx']) {
        assert.ok(fallback[1].split(' ').includes(name),
            `Debian's fallback needs ${name} from the map`);
    }
    assert.ok(!fallback[1].split(' ').includes('docker-compose-v2'),
        'docker-compose-v2 does not exist on Debian');
    assert.match(s.result.stdout, /lazydocker/, 'The map row with no apt name is still reported');
    done(s);
}
{
    const s = scenario({release: 'ubuntu', candidate: ''});
    assert.equal(s.result.status, 1, s.result.stdout);
    const fallback = s.log.match(/apt-get install -y ([^\n]*docker\.io[^\n]*)/);
    assert.ok(fallback, 'Ubuntu gets the fallback too, from universe');
    assert.ok(fallback[1].split(' ').includes('docker-compose-v2'), 'Ubuntu names the plugin package');
    assert.ok(!fallback[1].split(' ').includes('docker-cli'),
        'Ubuntu bundles the client in docker.io, and docker-cli does not exist there');
    done(s);
}

// lazydocker publishes no signature, so the archive listing is the only gate there
// is: an error page served under the asset's name must install nothing.
{
    const s = scenario({download: 'error-page'});
    assert.equal(s.result.status, 1, 'A download that is not the archive is a failed step');
    assert.ok(!fs.existsSync(s.lazydocker), 'And nothing is installed');
    assert.match(s.result.stdout, /lazydocker/, 'The failure is reported by name');
    done(s);
}
{
    const s = scenario({download: 'fail'});
    assert.equal(s.result.status, 1, 'A failed download is a failed step');
    assert.ok(!fs.existsSync(s.lazydocker), 'And nothing is installed');
    assert.match(s.result.stdout, /leader>ld|<leader>ld|lazydocker/,
        'Say what stops working without it');
    done(s);
}

// Only the x86_64 build was proved, so no other machine gets a binary of unknown
// provenance — and the reason is said rather than implied.
{
    const s = scenario({machine: 'aarch64'});
    assert.ok(!fs.existsSync(s.lazydocker), 'An unverified architecture installs nothing');
    assert.doesNotMatch(s.log, /github\.com/, 'And fetches nothing');
    assert.match(s.result.stdout + s.result.stderr, /aarch64/, 'Name what the machine reported');
    done(s);
}

// Kali takes the Debian side of both routes -- the vendor suite is trixie, verified
// against kali-rolling -- but not Debian's archive version: kali-rolling carries
// docker.io 28.5.2 where Debian 13 has 26.1.5, and a run that printed the parent's
// figure would be telling the user about a package their machine does not have.
{
    const s = scenario({release: 'kali', answers: 'n\n'.repeat(40)});
    assert.equal(s.result.status, 0, s.result.stderr);
    const out = s.result.stdout;
    assert.match(out, /\(Kali family\)/, 'Kali is named as itself');
    assert.match(out, /linux\/debian trixie/, 'The vendor route stays on the Debian suite');
    assert.match(out, /docker\.io 28\.5\.2\+dfsg4-5/, 'The archive version is the one apt reports here');
    assert.doesNotMatch(out, /26\.1\.5/, "and never Debian 13's figure");
    done(s);
}

// On Debian itself the figure is the verified literal, with no apt-cache call needed
// for it: the derivative path must not become the ordinary one.
{
    const s = scenario({answers: 'n\n'.repeat(40)});
    assert.match(s.result.stdout, /docker\.io 26\.1\.5\+dfsg1-9\+deb13u1/, 'Debian keeps its verified figure');
    assert.doesNotMatch(s.result.stdout, /28\.5\.2/, 'and is told nothing about another archive');
    done(s);
}

// The shared helpers are sourced, never copied: a second consent path is the defect
// the phase 1 review found.
{
    const body = fs.readFileSync(path.join(root, 'setup-docker.sh'), 'utf8');
    assert.match(body, /source "\$bundle_dir\/lib\/common\.sh"/, 'It must source the library');
    for (const helper of ['ask', 'run', 'attempt', 'try', 'add_vendor_repo']) {
        assert.doesNotMatch(body, new RegExp(`^${helper}\\(\\) \\{`, 'm'),
            `setup-docker.sh must not redefine ${helper}`);
    }
    assert.doesNotMatch(body, /\becho\b/, 'printf, never echo');
}

console.log('setup-docker-smoke: all checks passed');
