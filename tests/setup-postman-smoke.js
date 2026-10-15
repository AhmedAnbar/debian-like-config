// SPDX-License-Identifier: GPL-3.0-only
// setup-postman.sh under stubs only. Nothing here reaches the network, apt, systemd
// or any path outside a mkdtemp directory: curl, scp, apt-get, sudo, systemctl and
// update-desktop-database are stubs on a PATH this test builds, /opt and
// /usr/share are prefixed by DEBIAN_SETUP_OPT_ROOT and DEBIAN_SETUP_SHARE_ROOT, and
// TMPDIR is moved inside the scratch home so the script's own mktemp lands there too.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'setup-postman.sh');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'postman-smoke-'));
const osRelease = (body, name) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, body);
    return file;
};
const debian = osRelease('ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const ubuntu = osRelease('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n', 'ubuntu');
const fedora = osRelease('ID=fedora\n', 'fedora');

// An archive shaped like the one dl.pstmn.io serves: a single Postman/ top level,
// which install_tarball_app strips. `layout` decides which entries exist, because
// which entry is present is the whole of this installer's integrity gate.
const fixture = (home, name, entries) => {
    const stage = path.join(home, `stage-${name}`);
    for (const entry of entries) {
        const target = path.join(stage, entry);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        if (entry.endsWith('/')) fs.mkdirSync(target, {recursive: true});
        else fs.writeFileSync(target, '#!/bin/sh\n# stand-in for a 197 MiB Electron build\n');
    }
    const archive = path.join(home, `${name}.tar.gz`);
    const tar = spawnSync('tar', ['-czf', archive, '-C', stage, 'Postman'], {encoding: 'utf8'});
    assert.equal(tar.status, 0, tar.stderr);
    return archive;
};

// Every command the script can reach is either a symlink to the real tool (the
// coreutils it parses files with) or a stub that writes to one log.
const tools = ['bash', 'sh', 'awk', 'basename', 'cat', 'chmod', 'cmp', 'cp', 'cut', 'date',
    'dirname', 'env', 'find', 'grep', 'gzip', 'head', 'id', 'install', 'ln', 'mkdir', 'mktemp',
    'readlink', 'rm', 'sed', 'sha256sum', 'sort', 'stat', 'tail', 'tar', 'unlink'];

const sandbox = (label, {curl = 'ok', version = '12.32.3', archive = null} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `postman-${label}-`));
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(home, 'tmp'));
    for (const tool of tools) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, tool))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${tool} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(bin, tool));
    }
    const log = path.join(home, 'calls');
    fs.writeFileSync(path.join(bin, 'sudo'), `#!/bin/sh\necho "sudo $*" >> ${log}\nexec "$@"\n`, {mode: 0o755});
    for (const name of ['apt-get', 'apt-cache', 'systemctl', 'update-desktop-database', 'scp', 'ssh',
        'xdg-mime', 'dpkg-query', 'gpg', 'findmnt']) {
        fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${log}\nexit 0\n`, {mode: 0o755});
    }
    // The only stand-in for the network. A HEAD writes the redirect headers the
    // channel URL answers with; a GET copies the fixture archive into place.
    const headers = curl === 'head-fails' ? 'exit 22'
        : version
            ? `printf 'HTTP/1.1 302 Found\\r\\nlocation: https://dl.pstmn.io/download/version/${version}/linux64\\r\\n\\r\\n' > "$out"`
            : `printf 'HTTP/1.1 200 OK\\r\\ncontent-type: application/octet-stream\\r\\n\\r\\n' > "$out"`;
    const body = curl === 'fail' ? 'exit 22' : `cp ${archive} "$out"`;
    fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
echo "curl $*" >> ${log}
head_only=0
for a in "$@"; do
  case "$a" in
    -I|--head|-fsSI) head_only=1 ;;
  esac
done
out=
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift ;;
  esac
  shift
done
[ -n "$out" ] || exit 64
if [ "$head_only" = 1 ]; then
  ${headers}
  exit 0
fi
${body}
`, {mode: 0o755});
    return {home, bin, log,
        opt: path.join(home, 'opt'), share: path.join(home, 'share'),
        calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''),
        run: (args = [], answers = 'y\n'.repeat(20), release = debian) => spawnSync('bash', [script, ...args], {
            encoding: 'utf8', timeout: 120000, input: answers,
            env: {HOME: home, PATH: bin, TMPDIR: path.join(home, 'tmp'),
                DEBIAN_SETUP_OS_RELEASE: release,
                DEBIAN_SETUP_OPT_ROOT: path.join(home, 'opt'),
                DEBIAN_SETUP_SHARE_ROOT: path.join(home, 'share'),
                DEBIAN_SETUP_ETC_ROOT: path.join(home, 'aptroot')},
        })};
};
const clean = (box) => fs.rmSync(box.home, {recursive: true, force: true});
const valid = ['Postman/app/postman'];

// Arguments and guards, before anything else can happen.
{
    const box = sandbox('args', {archive: null});
    assert.equal(box.run(['--invalid'], '').status, 2, 'An unknown argument is a usage error');
    assert.equal(box.run(['--help'], '').status, 0, '--help explains itself and exits 0');
    const wrong = box.run(['--dry-run'], '', fedora);
    assert.equal(wrong.status, 1, 'An unsupported distribution refuses to run');
    assert.match(wrong.stderr, /Debian 13 and Ubuntu 26\.04/);
    assert.equal(box.calls(), '', 'A refused run reaches no command at all');
    clean(box);
}

// A preview names the source and the integrity caveat, and fetches nothing.
{
    const box = sandbox('dry', {archive: fixture(scratch, 'ok', valid)});
    const preview = box.run(['--dry-run']);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /dl\.pstmn\.io/, 'Name where the tarball comes from');
    assert.match(preview.stdout, /no checksum and no signature/i,
        'Say that Postman publishes no checksum and no signature at all');
    assert.match(preview.stdout, /Postman\/app\/postman/,
        'Name the tar listing entry that is the only integrity gate');
    assert.doesNotMatch(box.calls(), /curl/, 'A preview must not fetch anything');
    assert.doesNotMatch(box.calls(), /apt-get install/, 'A preview must not install anything');
    assert.ok(!fs.existsSync(box.opt), 'A preview writes nothing under /opt');
    assert.ok(!fs.existsSync(box.share), 'A preview writes no menu entry');
    clean(box);
}

// Every step declines by default: all-no changes nothing, calls nothing, exits 0.
{
    const box = sandbox('declined', {archive: fixture(scratch, 'ok', valid)});
    const result = box.run([], 'n\n'.repeat(20));
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(box.calls(), /curl/, 'Declining the install downloads nothing');
    assert.doesNotMatch(box.calls(), /apt-get/, 'Declining the libraries runs no apt');
    assert.doesNotMatch(box.calls(), /systemctl/, 'Nothing here touches a service');
    assert.ok(!fs.existsSync(box.opt), 'A declined run leaves /opt alone');
    assert.ok(!fs.existsSync(box.share), 'And installs no menu entry');
    clean(box);
}

// The whole happy path: the eleven libraries from the map, the version from the
// channel headers, the version-pinned download, and the menu entry whose basename
// Postman's own xdg-mime call depends on.
{
    const box = sandbox('install', {archive: fixture(scratch, 'ok', valid)});
    const result = box.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const offered = result.stdout.match(/runtime libraries[^\n]*\n {2}(.*)/);
    assert.ok(offered, 'The packages are printed before they are agreed to');
    const list = offered[1].split(' ');
    for (const name of ['libgtk-3-0t64', 'libnss3', 'libasound2t64', 'libgbm1', 'libcups2t64',
        'libatk-bridge2.0-0t64', 'libxkbcommon0', 'libatspi2.0-0t64', 'libxcomposite1',
        'libxdamage1', 'libxrandr2', 'desktop-file-utils']) {
        assert.ok(list.includes(name), `The postman group in the map carries ${name}`);
    }
    assert.match(box.calls(), /apt-get install -y .*libgtk-3-0t64/, 'The libraries are installed');
    // The version is a header away, so the 197 MiB body is never fetched to learn it.
    assert.match(box.calls(), /curl[^\n]*(-I|--head|-fsSI)[^\n]*dl\.pstmn\.io\/download\/channel\/stable\/linux_64/,
        'The published version comes from a header-only request to the channel URL');
    assert.match(box.calls(), /curl.*dl\.pstmn\.io\/download\/version\/12\.32\.3\/linux64/,
        'And the download is the version-pinned URL it named');
    assert.doesNotMatch(box.calls(), /scp|ssh /, 'Postman is not staged over ssh');
    assert.ok(fs.existsSync(path.join(box.opt, 'postman/12.32.3/app/postman')),
        'The archive is unpacked into a versioned directory with its top level stripped');
    assert.equal(fs.readlinkSync(path.join(box.opt, 'postman/current')), '12.32.3',
        'current points at the version, so a bad update is one symlink away from being undone');
    const applications = fs.readdirSync(path.join(box.share, 'applications'));
    assert.deepEqual(applications, ['Postman.desktop'],
        'The basename must be exactly Postman.desktop: main.js runs ' +
        'xdg-mime default Postman.desktop x-scheme-handler/postman on every launch');
    const entry = fs.readFileSync(path.join(box.share, 'applications/Postman.desktop'), 'utf8');
    assert.match(entry, /^\[Desktop Entry\]/, 'A .desktop file starts with its group header');
    assert.match(entry, /MimeType=.*x-scheme-handler\/postman/,
        'The entry claims the postman:// scheme the deep links use');
    assert.match(entry, new RegExp(`Exec=${box.opt}/postman/current/app/postman %u`),
        'Exec runs the executable the archive listing actually contains');
    assert.match(box.calls(), /update-desktop-database/, 'The menu database is refreshed');
    // The closing output must not imply the download was verified.
    assert.match(result.stdout, /no checksum|not signed|publishes neither/i,
        'The summary says the bytes were never signed or checksummed by Postman');
    assert.match(result.stdout, /Postman\.desktop/, 'And names the basename that must not change');

    // Re-running is the update path: the same published version downloads nothing.
    fs.rmSync(box.log, {force: true});
    const again = box.run();
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /12\.32\.3.*already installed/i,
        'A machine already on the published version is told so');
    assert.doesNotMatch(box.calls(), /dl\.pstmn\.io\/download\/version/,
        'And nothing is downloaded again');
    assert.match(box.calls(), /curl[^\n]*(-I|--head|-fsSI)/,
        'The channel is still asked what the published version is');
    clean(box);
}

// The channel lookup returning nothing must never become "already up to date": the
// bytes are downloaded and compared instead.
{
    const box = sandbox('noversion', {version: '',
        archive: fixture(scratch, 'ok', valid)});
    const result = box.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /up to date/i,
        'An empty version lookup is not evidence that this machine is up to date');
    assert.match(box.calls(), /curl.*dl\.pstmn\.io\/download\/channel\/stable\/linux_64/,
        'The archive itself is fetched when the version could not be read');
    const versions = fs.readdirSync(path.join(box.opt, 'postman')).filter((n) => n !== 'current');
    assert.equal(versions.length, 1, 'One download, one versioned directory');
    assert.match(versions[0], /^stable-[0-9a-f]{12}$/,
        'With no version to name it, the directory is named after the bytes themselves');
    assert.ok(fs.existsSync(path.join(box.opt, 'postman', versions[0], 'app/postman')),
        'And the archive is unpacked into it');

    // The same bytes a second time are recognized as the same bytes, not reinstalled.
    const second = box.run();
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.deepEqual(fs.readdirSync(path.join(box.opt, 'postman')).filter((n) => n !== 'current'),
        versions, 'Identical bytes must not pile up a second directory');
    clean(box);
}

// An archive that is not the build it claims to be: refused before /opt is touched,
// recorded, and the script exits non-zero because install.sh reads that status.
{
    const box = sandbox('wrong', {archive: fixture(scratch, 'wrong', ['Postman/Postman'])});
    const result = box.run();
    assert.equal(result.status, 1, 'A failed step must not report success to install.sh');
    assert.match(result.stdout, /Steps that failed:/, 'The failure is named in the summary');
    assert.ok(!fs.existsSync(path.join(box.opt, 'postman')), '/opt must be untouched');
    assert.ok(!fs.existsSync(path.join(box.share, 'applications')), 'And no menu entry written');
    clean(box);
}

// A download that fails: same contract, and nothing is unpacked.
{
    const box = sandbox('download-fails', {curl: 'fail',
        archive: fixture(scratch, 'ok', valid)});
    const result = box.run();
    assert.equal(result.status, 1, 'A failed download is a failed run');
    assert.match(result.stdout, /Steps that failed:[\s\S]*curl/, 'The failed download is named');
    assert.ok(!fs.existsSync(path.join(box.opt, 'postman')), 'Nothing is unpacked from a failed download');
    clean(box);
}

// The executable comes out of the archive listing, not an assumption: a build that
// carries Postman/Postman gets a menu entry pointing at that, not at app/postman.
{
    const box = sandbox('toplevel',
        {archive: fixture(scratch, 'both', ['Postman/Postman', 'Postman/app/postman'])});
    const result = box.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const entry = fs.readFileSync(path.join(box.share, 'applications/Postman.desktop'), 'utf8');
    assert.match(entry, new RegExp(`Exec=${box.opt}/postman/current/Postman %u`),
        'The top-level executable is what the entry runs when the archive has one');
    clean(box);
}

// An archive where Postman/app/postman is a directory rather than an executable
// passes a plain listing check and still has nothing for the menu entry to run, so
// this installer refuses it too, before /opt is touched.
{
    const box = sandbox('nobinary',
        {archive: fixture(scratch, 'dironly', ['Postman/app/postman/resources.pak'])});
    const result = box.run();
    assert.equal(result.status, 1, 'An archive with no Postman executable is a failed run');
    assert.match(result.stdout, /Steps that failed:[\s\S]*executable/,
        'And the reason names the missing executable');
    assert.ok(!fs.existsSync(path.join(box.opt, 'postman')), '/opt must be untouched');
    clean(box);
}

// The version lookup itself failing is the same degradation, and it is still recorded:
// the install can succeed while the run reports that it could not read the channel.
{
    const box = sandbox('headfail', {curl: 'head-fails', archive: fixture(scratch, 'ok', valid)});
    const result = box.run();
    assert.match(result.stdout, /channel named no version/,
        'A failed lookup degrades to downloading and comparing, not to being up to date');
    const versions = fs.readdirSync(path.join(box.opt, 'postman')).filter((n) => n !== 'current');
    assert.match(versions[0] || '', /^stable-[0-9a-f]{12}$/, 'The bytes name the directory');
    assert.equal(result.status, 1, 'The lookup failure is still reported to install.sh');
    assert.match(result.stdout, /Steps that failed:[\s\S]*curl/, 'And named in the summary');
    clean(box);
}

// Ubuntu offers the same rows, since every runtime library is a both row.
{
    const box = sandbox('ubuntu', {archive: fixture(scratch, 'ok', valid)});
    const preview = box.run(['--dry-run'], 'n\n'.repeat(20), ubuntu);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Ubuntu/, 'The release it detected is named');
    assert.match(preview.stdout, /libgtk-3-0t64/, 'The same runtime libraries are offered');
    clean(box);
}

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-postman-smoke: all checks passed');
