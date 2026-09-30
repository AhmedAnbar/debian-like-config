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

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-sway-smoke: all checks passed');
