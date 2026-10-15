// SPDX-License-Identifier: GPL-3.0-only
// Shape of the package map only; apt-names-smoke.js checks the names against apt.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'packages/apt-map.tsv'), 'utf8').trim().split('\n');

assert.equal(lines[0], ['group', 'arch', 'apt', 'where', 'note'].join('\t'), 'Header row');
const groups = new Set(['core-desktop', 'audio', 'input-emoji', 'browser-files', 'dev', 'shell',
    'editor-tools', 'sway', 'chrome', 'dbeaver', 'onlyoffice', 'dropbox', 'docker', 'postman',
    'tor', 'conky-panel', 'zram', 'snapshots', 'hardening']);
const places = new Set(['both', 'debian', 'ubuntu', 'none']);
const archSeen = new Set();
let none = 0;
for (const line of lines.slice(1)) {
    const columns = line.split('\t');
    assert.equal(columns.length, 5, 'Five tab-separated columns: ' + line);
    const [group, arch, apt, where, note] = columns;
    assert.ok(groups.has(group), 'Unknown group: ' + line);
    assert.ok(places.has(where), 'Unknown where: ' + line);
    // One row per Arch name per release. A package may resolve to a different apt
    // name on each release, but never to two names on the same one.
    if (arch !== '-') {
        for (const target of (where === 'both' ? ['debian', 'ubuntu'] : [where])) {
            if (target === 'none') continue;
            const key = `${arch}@${target}`;
            assert.ok(!archSeen.has(key), `Two rows claim ${arch} on ${target}`);
            archSeen.add(key);
        }
    }
    if (where === 'none') {
        none++;
        assert.equal(apt, '-', 'An unavailable package has no apt name: ' + line);
        assert.ok(note.length > 20, 'An unavailable package must name its replacement: ' + line);
    } else {
        assert.match(apt, /^[a-z0-9][a-z0-9.+-]*$/, 'Not a Debian package name: ' + line);
    }
    if (arch !== apt || where !== 'both') {
        assert.ok(note.length > 10, 'Every difference needs a reason: ' + line);
    }
}
// Every unavailable package is named here, not counted: a new one is a decision about
// what this repository will and will not install, and it belongs in a spec before it
// belongs in the map. Each needs a note saying which script, or which other route,
// covers it instead -- the rule above already enforces that the note exists.
const unavailableNames = lines.slice(1).map((l) => l.split('\t'))
    .filter(([, , , where]) => where === 'none').map(([, arch]) => arch).sort();
assert.deepEqual(unavailableNames, [
    'dbeaver-ce',           // vendor repository, setup-dbeaver.sh
    'dropbox',              // vendor repository, setup-dropbox.sh
    'google-chrome',        // vendor repository, setup-chrome.sh
    'lazydocker',           // upstream static binary, setup-docker.sh
    'onlyoffice-bin',       // vendor repository, setup-onlyoffice.sh
    'postman',              // upstream tarball, setup-postman.sh
    'rofi-emoji',           // replaced by the bundled picker reading unicode-data
    'teams',                // retired by Microsoft; the web client in the browser
    'torbrowser-launcher',  // dead signing key; setup-tor-browser.sh uses the tarball
    'uv',                   // no apt package; the official installer script, later
].sort(), 'Every unavailable package is accounted for by name');
assert.equal(none, unavailableNames.length, 'And none of them is counted twice');
assert.ok(lines.length > 50, 'The map covers the phase 1 groups');
// The commands the bindings and the installer run come from packages that provide the
// binary, not from a library or a schema package. Both providers were checked in a container.
const aptNames = new Set(lines.slice(1).map((line) => line.split('\t')[2]));
for (const [command, provider] of [['pactl', 'pulseaudio-utils'], ['gsettings', 'libglib2.0-bin']]) {
    assert.ok(aptNames.has(provider), `${command} lives in ${provider}; the map must install it`);
}
// Every group must be offered by name somewhere. install.sh labels the groups it
// offers; editor-tools belongs to setup-nvim.sh and sway to setup-sway.sh, and each
// is named by the script that owns it.
const owners = {'editor-tools': 'setup-nvim.sh', sway: 'setup-sway.sh',
    chrome: 'setup-chrome.sh', dbeaver: 'setup-dbeaver.sh', onlyoffice: 'setup-onlyoffice.sh',
    dropbox: 'setup-dropbox.sh', docker: 'setup-docker.sh', postman: 'setup-postman.sh',
    tor: 'setup-tor-browser.sh', 'conky-panel': 'setup-conky.sh', zram: 'setup-zram.sh',
    snapshots: 'setup-snapshots.sh', hardening: 'setup-hardening.sh'};
const installSource = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const labelled = new Set([...installSource.matchAll(/^\s*\[([a-z-]+)\]=/gm)].map((m) => m[1]));
for (const group of new Set(lines.slice(1).map((line) => line.split('\t')[0]))) {
    // A group another script offers is that script's own test's business: this file
    // reads the map, and setup-sway-smoke.js proves the sway group reaches the user
    // by checking the packages it prints.
    if (owners[group]) continue;
    assert.ok(labelled.has(group), `install.sh has no label for the map group ${group}`);
}
// The browser is the first package with a different apt name on each release.
const browsers = lines.slice(1).map((l) => l.split('\t')).filter(([, arch]) => arch === 'firefox');
assert.deepEqual(browsers.map(([, , apt, where]) => `${apt}/${where}`).sort(),
    ['firefox-esr/debian', 'firefox/ubuntu'].sort(), 'Debian gets the ESR package, Ubuntu the snap installer');
// snapd goes on both releases: the Ubuntu browser is a snap, and phase 3 will want it.
const aptAll = new Set(lines.slice(1).map((l) => l.split('\t')[2]));
for (const name of ['snapd', 'sway', 'swaybg', 'swayidle', 'swaylock', 'waybar', 'mako-notifier',
    'grim', 'slurp', 'wl-clipboard', 'cliphist', 'xwayland', 'mate-polkit', 'wtype', 'xdotool',
    'unicode-data', 'qtwayland5', 'qt6-wayland', 'xdg-desktop-portal-wlr', 'xdg-desktop-portal-gtk']) {
    assert.ok(aptAll.has(name), `The Sway session needs ${name}`);
}
// Every sway-group row is a real apt name, never a where=none placeholder.
for (const [group, , apt, where] of lines.slice(1).map((l) => l.split('\t'))) {
    if (group !== 'sway') continue;
    assert.notEqual(where, 'none', `The sway group installs from apt: ${apt}`);
}
console.log('apt-map-smoke: all checks passed');
