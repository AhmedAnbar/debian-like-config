// SPDX-License-Identifier: GPL-3.0-only
// Shape of the package map only; apt-names-smoke.js checks the names against apt.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'packages/apt-map.tsv'), 'utf8').trim().split('\n');

assert.equal(lines[0], ['group', 'arch', 'apt', 'where', 'note'].join('\t'), 'Header row');
const groups = new Set(['core-desktop', 'audio', 'input-emoji', 'browser-files', 'dev', 'shell', 'editor-tools']);
const places = new Set(['both', 'debian', 'ubuntu', 'none']);
const archSeen = new Set();
let none = 0;
for (const line of lines.slice(1)) {
    const columns = line.split('\t');
    assert.equal(columns.length, 5, 'Five tab-separated columns: ' + line);
    const [group, arch, apt, where, note] = columns;
    assert.ok(groups.has(group), 'Unknown group: ' + line);
    assert.ok(places.has(where), 'Unknown where: ' + line);
    assert.ok(!archSeen.has(arch) || arch === '-', 'Duplicate arch package: ' + arch);
    archSeen.add(arch);
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
// The two known gaps: rofi-emoji and uv. A third would be a decision, not a detail.
assert.equal(none, 2, 'Exactly the two documented unavailable packages');
assert.ok(lines.length > 50, 'The map covers the phase 1 groups');
// The commands the bindings and the installer run come from packages that provide the
// binary, not from a library or a schema package. Both providers were checked in a container.
const aptNames = new Set(lines.slice(1).map((line) => line.split('\t')[2]));
for (const [command, provider] of [['pactl', 'pulseaudio-utils'], ['gsettings', 'libglib2.0-bin']]) {
    assert.ok(aptNames.has(provider), `${command} lives in ${provider}; the map must install it`);
}
// Every group the map names must have a label in install.sh, or it is offered anonymously.
const installSource = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const labelled = new Set([...installSource.matchAll(/^\s*\[([a-z-]+)\]=/gm)].map((m) => m[1]));
for (const group of new Set(lines.slice(1).map((line) => line.split('\t')[0]))) {
    if (group === 'editor-tools') continue;
    assert.ok(labelled.has(group), `install.sh has no label for the map group ${group}`);
}
console.log('apt-map-smoke: all checks passed');
