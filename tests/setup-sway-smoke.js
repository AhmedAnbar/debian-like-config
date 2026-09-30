// SPDX-License-Identifier: GPL-3.0-only
// Previews and stubbed runs only: no package is installed and no service is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-smoke-'));
const bin = path.join(scratch, 'bin');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'apt-get'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
fs.writeFileSync(path.join(bin, 'apt-cache'), `#!/bin/sh
case "$2" in
  sway) echo '  Candidate: 1.10.1-2' ;;
  waybar) echo '  Candidate: 0.12.0-1' ;;
  *) echo '  Candidate: (none)' ;;
esac
`, {mode: 0o755});

const osRelease = (body, name) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, body);
    return file;
};
const debian = osRelease('ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const env = (file, home = scratch) => ({
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, DEBIAN_SETUP_OS_RELEASE: file,
});
const sway = (args, file, answers = 'n\n'.repeat(40), home = scratch) =>
    spawnSync('bash', [path.join(root, 'setup-sway.sh'), ...args],
        {encoding: 'utf8', timeout: 60000, input: answers, env: env(file, home)});

// This machine may well have sway installed — it is where the configuration comes
// from. A PATH built from a named list is the only way to test the branch that runs
// when sway is absent, so the test controls it instead of inheriting it.
const minimalPath = (extra = []) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-path-'));
    // bash and sh are in the list because spawnSync resolves the command it runs
    // through the PATH it is given, not the one this process has.
    for (const command of ['bash', 'sh', 'cat', 'cmp', 'cp', 'date', 'dirname', 'env', 'find', 'id',
        'install', 'mkdir', 'mktemp', 'sort', 'tail', 'unlink', 'awk', ...extra]) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
    for (const [name, body] of [['apt-get', 'exit 0'], ['apt-cache', "echo '  Candidate: 1.10.1-2'"],
        ['sudo', 'exec "$@"']]) {
        fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, {mode: 0o755});
    }
    return dir;
};

// Arguments and guards.
assert.equal(sway(['--invalid'], debian).status, 2, 'An unknown argument is a usage error');
assert.equal(sway(['--help'], debian).status, 0);
const fedora = sway(['--dry-run'], osRelease('ID=fedora\n', 'fedora'));
assert.equal(fedora.status, 1);
assert.match(fedora.stderr, /Debian 13 and Ubuntu 26\.04/);

// The versions apt offers are named before anything is agreed to.
const preview = sway(['--dry-run'], debian);
assert.equal(preview.status, 0, preview.stderr);
assert.match(preview.stdout, /Sway 1\.10\.1/, 'Name the Sway version apt offers');
assert.match(preview.stdout, /Waybar 0\.12\.0/, 'Name the Waybar version apt offers');
assert.match(preview.stdout, /i3 .*(unchanged|untouched)/i, 'Say that i3 is left alone');

// The sway group is offered, and declining installs nothing.
assert.match(preview.stdout, /sway swaybg swayidle swaylock/, 'Offer the group from the map');
assert.doesNotMatch(preview.stdout, /apt-get install/, 'A declined group installs nothing');

// Review Focus 1: the rofi theme phase 1 installs is what the launcher loads.
assert.match(preview.stdout, /rofi\/active-theme\.rasi/,
    'Warn that the launcher needs the theme pointer install.sh writes');

// The bundle: every file installed, scripts executable, and the conky fragment absent.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-bundle-'));
    const only = minimalPath();
    const result = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {HOME: home, PATH: only, DEBIAN_SETUP_OS_RELEASE: debian},
    });
    assert.equal(result.status, 0, result.stderr);
    for (const relative of ['sway/config', 'sway/config.d/00-local.conf', 'sway/config.d/40-notes.conf',
        'waybar/config.jsonc', 'waybar/style.css', 'mako/config', 'swaylock/config',
        'xdg-desktop-portal/sway-portals.conf']) {
        assert.ok(fs.existsSync(path.join(home, '.config', relative)), `Missing: ${relative}`);
    }
    for (const script of ['sway/clipboard.sh', 'sway/launcher.sh', 'sway/lock.sh', 'sway/notes.sh',
        'sway/screenshot.sh', 'sway/session-start.sh', 'sway/emoji.sh']) {
        const mode = fs.statSync(path.join(home, '.config', script)).mode & 0o777;
        assert.equal(mode, 0o755, `${script} must be executable, not ${mode.toString(8)}`);
    }
    assert.ok(!fs.existsSync(path.join(home, '.config', 'sway/config.d/30-conky.conf')),
        'The conky fragment belongs to the phase that installs conky');
    // Review Focus 4: sway is not installed here, so validation is skipped with a reason.
    assert.match(result.stdout, /sway is not installed.*skipping the configuration check/i,
        'Say why the configuration was not validated');
    fs.rmSync(only, {recursive: true, force: true});
    // And with sway present, the configuration really is validated.
    const withSway = minimalPath();
    fs.writeFileSync(path.join(withSway, 'sway'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
    const validated = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {HOME: home, PATH: withSway, DEBIAN_SETUP_OS_RELEASE: debian},
    });
    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /sway -C -c .*\/sway\/config/, 'Validate what was installed');
    fs.rmSync(withSway, {recursive: true, force: true});
    fs.rmSync(home, {recursive: true, force: true});
}
// The pacman instruction cannot survive in a Debian repository.
for (const file of ['config/sway/clipboard.sh', 'config/sway/session-start.sh']) {
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(body, /pacman/, `${file} must not tell a Debian user to run pacman`);
}
assert.match(fs.readFileSync(path.join(root, 'config/sway/session-start.sh'), 'utf8'),
    /polkit-mate-authentication-agent-1/, 'Debian 13 has no polkit-gnome agent');
assert.doesNotMatch(fs.readFileSync(path.join(root, 'config/i3/config'), 'utf8'),
    /conky\/start\.sh/, 'The i3 conky autostart moves to the phase that installs conky');

// The Zenbook is recognized by DMI name and offered its own profile.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-zenbook-'));
    const only = minimalPath();
    const withDmi = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {HOME: home, PATH: only, DEBIAN_SETUP_OS_RELEASE: debian,
            DEBIAN_SETUP_DMI_NAME: 'Zenbook S 16 UM5606WA_UM5606WA'},
    });
    assert.equal(withDmi.status, 0, withDmi.stderr);
    assert.match(withDmi.stdout, /Zenbook/, 'Name the machine it recognized');
    const installed = fs.readFileSync(path.join(home, '.config/sway/config.d/00-local.conf'), 'utf8');
    assert.match(installed, /output eDP-1 mode 1920x1200/, 'The bundled profile is what lands');
    assert.match(installed, /map_to_output eDP-1/, 'Including the touchscreen mapping');
    fs.rmSync(only, {recursive: true, force: true});
    fs.rmSync(home, {recursive: true, force: true});
}

// Unknown hardware inside a Sway session: the profile is generated from real outputs.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-generated-'));
    const only = minimalPath(['jq']);
    fs.writeFileSync(path.join(only, 'swaymsg'), `#!/bin/sh
cat <<'JSON'
[{"name":"DP-3","current_mode":{"width":2560,"height":1440}},
 {"name":"eDP-2","current_mode":{"width":1920,"height":1080}}]
JSON
`, {mode: 0o755});
    const result = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {HOME: home, PATH: only, DEBIAN_SETUP_OS_RELEASE: debian,
            DEBIAN_SETUP_DMI_NAME: 'Generic Laptop', SWAYSOCK: path.join(home, 'sock')},
    });
    assert.equal(result.status, 0, result.stderr);
    const generated = fs.readFileSync(path.join(home, '.config/sway/config.d/00-local.conf'), 'utf8');
    assert.match(generated, /output DP-3 mode 2560x1440/, 'The real output, not eDP-1');
    assert.match(generated, /output eDP-2 mode 1920x1080/, 'Every output, not just the first');
    assert.match(result.stdout, /DP-3/, 'Show the profile before writing it');
    fs.rmSync(only, {recursive: true, force: true});
    fs.rmSync(home, {recursive: true, force: true});
}

// Review Focus 2: unknown hardware, outside Sway. Nothing is written and the reason is said.
// All-no here: the bundle itself ships a 00-local.conf, so declining everything is the
// only way to prove the profile step wrote nothing of its own.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-nosock-'));
    const result = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'n\n'.repeat(40),
        env: {...env(debian, home), DEBIAN_SETUP_DMI_NAME: 'Generic Laptop', SWAYSOCK: ''},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(home, '.config/sway/config.d/00-local.conf')),
        'A profile naming no outputs must not be written');
    assert.match(result.stdout, /swaymsg -t get_outputs/,
        'Say how to fill the profile in after the first login');
    fs.rmSync(home, {recursive: true, force: true});
}

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-sway-smoke: all checks passed');
