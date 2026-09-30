// SPDX-License-Identifier: GPL-3.0-only
// Documentation and branding only: no packages, no network, no installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const readme = read('README.md');
// Ahmed generates the image from the recorded prompt, so the path is fixed up front.
assert.match(readme, /<img src="assets\/logo\.png" alt="[^"]{10,}" width="240">/,
    'The header must show assets/logo.png with descriptive alt text');
assert.match(readme, /^<h1 align="center">Debian Linux Config<\/h1>$/m);
for (const badge of ['License-GPL--3.0', 'OS-Debian', 'OS-Ubuntu', 'Desktop-i3', 'Shell-Zsh']) {
    assert.ok(readme.includes(badge), 'Missing badge: ' + badge);
}
assert.match(readme, /^## Package catalogue$/m, 'Task 4 appends the catalogue here');
// Supported releases are a promise to the reader: name them, and only them.
assert.match(readme, /Debian 13/);
assert.match(readme, /Ubuntu 26\.04/);

const license = read('LICENSE');
assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
assert.match(license, /Version 3/);

const logo = read('assets/LOGO.md');
assert.match(logo, /^# Logo$/m);
assert.match(logo, /^Prompt:$/m, 'The prompt is recorded verbatim, as in the Arch repository');
assert.match(logo, /codex/i, 'Record that the codex CLI wrote the prompt');
assert.match(logo, /assets\/logo\.png/, 'Say where the generated image goes');
assert.match(logo, /[Dd]ebian red|#[Aa]80030|#[Dd]70[Aa]53/, 'The prompt must name the Debian red');
assert.match(logo, /do not replicate|not replicate|avoid replicating/i,
    'The prompt must refuse to copy the official Debian logo');

// Every package that can be installed must be documented, as in the Arch repository.
const rows = read('packages/apt-map.tsv').trim().split('\n').slice(1).map((line) => line.split('\t'));
for (const [, arch, apt, where] of rows) {
    const documented = apt === '-' ? arch : apt;
    assert.ok(readme.includes('`' + documented + '`'),
        `Undocumented package: ${documented} (${where})`);
}
assert.match(readme, /not packaged/i, 'The catalogue must mark the unavailable packages');
// The first column is what a reader types after apt-get install, so a package that
// exists in neither release must not appear there under any name.
const unavailableRows = readme.split('\n').filter((line) => line.includes(' | none | '));
assert.equal(unavailableRows.length, rows.filter(([, , , where]) => where === 'none').length,
    'Every unavailable package has a catalogue row');
for (const line of unavailableRows) {
    assert.match(line, /^\| — \| `[a-z0-9.+-]+` \| none \| \S/,
        'An unavailable package has no apt name to print: ' + line);
}

// The Sway session has to be documented where a reader will look for it.
assert.match(readme, /^## The Sway session$/m, 'Phase 2 documents its own section');
assert.match(readme, /setup-sway\.sh/, 'Name the script that installs it');
assert.match(readme, /dbus-run-session sway/, 'Document the route that needs no greeter');
assert.match(readme, /Super\+period/, 'Document the emoji picker key');
assert.match(readme, /swaymsg -t get_outputs/, 'Say how to write a profile on other hardware');
// The script stands on its own, and the README has to say so: it installs the terminal,
// the launcher and the rest of what the session invokes, not only the sway group.
assert.match(readme, /install\.sh`?\s+never\s+ran/i,
    'Say that the Sway session can be installed on a machine where install.sh never ran');
// Claims the tests cannot support must be marked as unverified, not stated as fact.
assert.match(readme, /not been run on a real Debian|confirmed on the machine|cannot show/i,
    'Say what a container test does not prove');

console.log('readme-smoke: all checks passed');
