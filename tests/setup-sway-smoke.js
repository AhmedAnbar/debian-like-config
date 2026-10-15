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
const ubuntu = osRelease('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n', 'ubuntu');
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
    for (const command of ['bash', 'sh', 'cat', 'chmod', 'cmp', 'cp', 'date', 'dirname', 'env', 'find',
        'id', 'install', 'mkdir', 'mktemp', 'sort', 'stat', 'tail', 'unlink', 'awk', ...extra]) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
    // systemctl is a no-op here: every all-yes run reaches the service and greeter
    // steps, and a test must never touch the real init system.
    for (const [name, body] of [['apt-get', 'exit 0'], ['apt-cache', "echo '  Candidate: 1.10.1-2'"],
        ['sudo', 'exec "$@"'], ['systemctl', 'exit 0']]) {
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

// Review Focus 1 again, the other half: the session's own group is not enough. The
// configuration invokes programs phase 1 installs with the i3 desktop, and a machine
// where install.sh never ran has none of them — so this script offers those rows too.
const offered = (stdout) => {
    const line = stdout.match(/Sway session packages\n {2}(.*)/);
    assert.ok(line, 'The packages are printed before they are agreed to');
    return line[1].split(' ');
};
const debianOffer = offered(preview.stdout);
for (const name of ['kitty', 'rofi', 'pulseaudio-utils', 'brightnessctl', 'unicode-data',
    'fonts-noto', 'fonts-noto-color-emoji', 'network-manager-gnome', 'blueman',
    'xdg-user-dirs', 'libglib2.0-bin', 'gsettings-desktop-schemas', 'neovim']) {
    assert.ok(debianOffer.includes(name),
        `The session needs ${name}, which the sway group does not contain`);
}
// And it must not drag the X11 desktop in: this script installs no i3 and no Xorg.
for (const name of ['i3-wm', 'i3status', 'i3lock', 'picom', 'xserver-xorg', 'xss-lock']) {
    assert.ok(!debianOffer.includes(name),
        `${name} belongs to install.sh, not to the Sway session`);
}
// The browser follows the release here exactly as it does in install.sh.
assert.ok(debianOffer.includes('firefox-esr'), 'Debian gets the ESR browser');
assert.ok(!debianOffer.includes('firefox'), 'Debian has no apt firefox');
const ubuntuPreview = sway(['--dry-run'], ubuntu);
assert.equal(ubuntuPreview.status, 0, ubuntuPreview.stderr);
const ubuntuOffer = offered(ubuntuPreview.stdout);
assert.ok(ubuntuOffer.includes('firefox'), "Ubuntu's own firefox package installs the snap");
assert.ok(!ubuntuOffer.includes('firefox-esr'), 'Ubuntu has no firefox-esr');

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
    // Every helper the configuration binds a key to must be on disk: a binding whose
    // script was never installed is a key that does nothing and says nothing.
    const bindings = fs.readFileSync(path.join(root, 'config/sway/config'), 'utf8');
    const referenced = [...bindings.matchAll(/~\/\.config\/sway\/([\w-]+\.sh)/g)].map((m) => m[1]);
    assert.ok(referenced.length >= 7, 'The configuration binds keys to helper scripts');
    for (const script of new Set(referenced)) {
        const target = path.join(home, '.config', 'sway', script);
        assert.ok(fs.existsSync(target), `${script} is bound to a key but never installed`);
        assert.equal(fs.statSync(target).mode & 0o777, 0o755, `${script} must be executable`);
    }
    // The theme pointer this script offers to write must point at a file it installs.
    const pointer = fs.readFileSync(path.join(home, '.config/rofi/active-theme.rasi'), 'utf8');
    const theme = pointer.match(/@theme "([^"]+)"/);
    assert.ok(theme, 'The pointer names a theme');
    assert.ok(fs.existsSync(path.join(home, '.config/rofi', theme[1])),
        `The pointer names ${theme[1]}, which nothing installed`);
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
// i3's configuration is one file that install.sh replaces whole, so the panel's two
// lines have to be in it: there is no config.d to drop a fragment into. They are safe
// for a user who never runs setup-conky.sh, because start.sh exits silently when conky
// is not installed — which is also why phase 2 could leave them out until now.
{
    const i3 = fs.readFileSync(path.join(root, 'config/i3/config'), 'utf8');
    assert.match(i3, /exec --no-startup-id sh ~\/\.config\/conky\/start\.sh/,
        'The i3 session autostarts the panel, as the Arch configuration does');
    assert.match(i3, /bindsym \$mod\+Shift\+t exec --no-startup-id sh ~\/\.config\/conky\/switch\.sh/,
        'And binds the theme chooser');
    assert.match(fs.readFileSync(path.join(root, 'config/conky/start.sh'), 'utf8'),
        /command -v conky >\/dev\/null 2>&1 \|\| exit 0/,
        'Which is only safe while start.sh is a no-op without conky');
}

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
    // A connected-but-disabled output reports no mode, and a HiDPI session reports its
    // own scale: both are ordinary, and both were wrong in the first version of this.
    fs.writeFileSync(path.join(only, 'swaymsg'), `#!/bin/sh
cat <<'JSON'
[{"name":"DP-3","current_mode":{"width":2560,"height":1440},"scale":2},
 {"name":"eDP-2","current_mode":{"width":1920,"height":1080},"scale":1},
 {"name":"HDMI-A-1","current_mode":null,"scale":1}]
JSON
`, {mode: 0o755});
    const result = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {HOME: home, PATH: only, DEBIAN_SETUP_OS_RELEASE: debian,
            DEBIAN_SETUP_DMI_NAME: 'Generic Laptop', SWAYSOCK: path.join(home, 'sock')},
    });
    assert.equal(result.status, 0, result.stderr);
    const generated = fs.readFileSync(path.join(home, '.config/sway/config.d/00-local.conf'), 'utf8');
    assert.match(generated, /output DP-3 mode 2560x1440 scale 2/,
        'The real output, at the scale the session runs it');
    assert.match(generated, /output eDP-2 mode 1920x1080 scale 1/, 'Every output, not just the first');
    assert.doesNotMatch(generated, /nullxnull/, 'An output with no mode has no line to write');
    assert.doesNotMatch(generated, /HDMI-A-1/, 'A disabled output is left to sway to enable');
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

// A shell can outlive the compositor it was started from and still export SWAYSOCK.
// The query then fails, and that must cost the user a sentence, not the rest of the run.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-stale-'));
    const only = minimalPath(['jq']);
    fs.writeFileSync(path.join(only, 'swaymsg'), '#!/bin/sh\nexit 1\n', {mode: 0o755});
    const result = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {HOME: home, PATH: only, DEBIAN_SETUP_OS_RELEASE: debian,
            DEBIAN_SETUP_DMI_NAME: 'Generic Laptop', SWAYSOCK: path.join(home, 'gone')},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /Setup stopped/, 'A dead socket is not a crash');
    assert.match(result.stdout, /swaymsg -t get_outputs/, 'Say how to write the profile later');
    assert.match(result.stdout, /lightdm/, 'And carry on to the steps that follow');
    const local = fs.readFileSync(path.join(home, '.config/sway/config.d/00-local.conf'), 'utf8');
    assert.doesNotMatch(local, /Generated from swaymsg/, 'Nothing was generated from nothing');
    fs.rmSync(only, {recursive: true, force: true});
    fs.rmSync(home, {recursive: true, force: true});
}
// Inside a session, with jq not yet installed, the reason is jq — not the session.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-nojq-'));
    const only = minimalPath();
    fs.writeFileSync(path.join(only, 'swaymsg'), '#!/bin/sh\necho "[]"\n', {mode: 0o755});
    const result = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'n\n'.repeat(40),
        env: {HOME: home, PATH: only, DEBIAN_SETUP_OS_RELEASE: debian,
            DEBIAN_SETUP_DMI_NAME: 'Generic Laptop', SWAYSOCK: path.join(home, 'sock')},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\bjq\b/, 'Name the missing tool');
    assert.doesNotMatch(result.stdout, /Not running inside Sway/,
        'The user is inside Sway; saying otherwise sends them to fix the wrong thing');
    fs.rmSync(only, {recursive: true, force: true});
    fs.rmSync(home, {recursive: true, force: true});
}

// The greeter is offered and declined by default: a run of all-no touches no service.
{
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-greeter-'));
    const only = minimalPath();
    const log = path.join(home, 'calls');
    for (const name of ['systemctl', 'sway']) {
        fs.writeFileSync(path.join(only, name), `#!/bin/sh\necho "${name} $*" >> ${log}\nexit 0\n`, {mode: 0o755});
    }
    fs.writeFileSync(path.join(only, 'apt-get'), `#!/bin/sh\necho "apt-get $*" >> ${log}\nexit 0\n`, {mode: 0o755});
    const declinedRun = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'n\n'.repeat(40),
        env: {HOME: home, PATH: only, DEBIAN_SETUP_OS_RELEASE: debian},
    });
    assert.equal(declinedRun.status, 0, declinedRun.stderr);
    assert.match(declinedRun.stdout, /lightdm/, 'The greeter step must at least be mentioned');
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.doesNotMatch(calls, /systemctl enable/, 'Declining must enable nothing');
    // Accepting installs the greeter and its GTK greeter, and enables the service.
    fs.rmSync(log, {force: true});
    const accepted = spawnSync('bash', [path.join(root, 'setup-sway.sh')], {
        encoding: 'utf8', timeout: 60000, input: 'y\n'.repeat(40),
        env: {HOME: home, PATH: only, DEBIAN_SETUP_OS_RELEASE: debian,
            DEBIAN_SETUP_DMI_NAME: 'Generic Laptop', SWAYSOCK: ''},
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    const accCalls = fs.readFileSync(log, 'utf8');
    assert.match(accCalls, /apt-get install -y lightdm lightdm-gtk-greeter/, 'Install both parts');
    assert.match(accCalls, /systemctl enable lightdm\.service/, 'And enable it');
    fs.rmSync(only, {recursive: true, force: true});
    fs.rmSync(home, {recursive: true, force: true});
}

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-sway-smoke: all checks passed');
