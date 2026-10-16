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
for (const badge of ['License-GPL--3.0', 'OS-Debian', 'OS-Ubuntu', 'OS-Kali', 'Desktop-i3', 'Shell-Zsh']) {
    assert.ok(readme.includes(badge), 'Missing badge: ' + badge);
}
assert.match(readme, /^## Package catalogue$/m, 'Task 4 appends the catalogue here');
// Supported releases are a promise to the reader: name them, and only them.
assert.match(readme, /Debian 13/);
assert.match(readme, /Ubuntu 26\.04/);
assert.match(readme, /Kali/);
// The first command in the file is the one a reader runs before anything else, and
// the repository it names has to be the one that exists: AhmedAnbar/debian-linux-config
// was a typo nobody could clone.
assert.match(readme, /git clone https:\/\/github\.com\/AhmedAnbar\/debian-like-config\.git/,
    'The clone URL must name the repository that actually exists');
assert.doesNotMatch(readme, /debian-linux-config/, 'And never the name that does not');

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

// Phases 3 and 4 document themselves: a script a user is never told about is a script
// that does not exist to them.
assert.match(readme, /^## Third-party applications$/m, 'Phase 3 documents its own section');
assert.match(readme, /^## System extras$/m, 'And phase 4 its own');
// Derived from the directory rather than listed here, because a hard-coded list is
// exactly how three scripts the Arch repository has went unported and unnoticed: a
// list cannot fail for a script nobody remembered to add to it.
const scripts = fs.readdirSync(root).filter((name) => /^setup-[a-z0-9-]+\.sh$/.test(name)).sort();
assert.ok(scripts.length >= 14, `Expected the full set of setup scripts, found ${scripts.length}`);
for (const script of scripts) {
    assert.ok(readme.includes(script), `The README must name ${script}`);
}
// The decisions and caveats a user cannot discover by reading the package list.
assert.match(readme, /teams\.microsoft\.com/,
    'Teams is not installed, so name the web client that replaces it');
assert.match(readme, /no checksum|neither a checksum|without a checksum/i,
    "Postman's missing integrity material is the user's risk to accept");
assert.match(readme, /root-equivalent|equivalent to root/i,
    'Docker group membership is root-equivalent, and the README must say so');
assert.match(readme, /dropbox start -i/, 'Dropbox needs one manual first run');
assert.match(readme, /btrfs/i, 'Snapshots need a btrfs root, which not every install has');
assert.match(readme, /Host vps/, 'Tor Browser is staged over an ssh alias the user defines');
// The relay is named by alias and nothing else, here as everywhere in this repository.
assert.doesNotMatch(readme, /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    'No address for the staging host may appear in this repository');
assert.match(readme, /password authentication|PasswordAuthentication/i,
    'Say what SSH hardening changes before a user runs it');
// The forward-looking list cannot still promise work that now exists.
const later = readme.slice(readme.indexOf('## What comes later'));
assert.doesNotMatch(later, /Still to come[\s\S]{0,400}Postman/,
    'Phases 3 and 4 are no longer "still to come"');

// KALI.md is the run-book for the one target that has rows of its own in the map, so the
// map is what keeps it honest: a Kali row nobody wrote about is a surprise waiting for
// whoever follows the file. Derived, not listed, for the same reason as the scripts above.
{
    const kali = read('KALI.md');
    const kaliRows = read('packages/apt-map.tsv').trim().split('\n').slice(1)
        .map((line) => line.split('\t')).filter(([, , , where]) => where === 'kali');
    assert.ok(kaliRows.length >= 2, 'The map still carries the Kali rows this file explains');
    for (const [, arch, apt] of kaliRows) {
        assert.ok(kali.includes(apt === '-' ? arch : apt),
            `KALI.md must say what becomes of ${arch} on Kali`);
    }
    // The first command a reader runs has to be the one that works.
    assert.match(kali, /git clone https:\/\/github\.com\/AhmedAnbar\/debian-like-config\.git/,
        'KALI.md must carry the clone URL that exists');
    assert.doesNotMatch(kali, /debian-linux-config/, 'That repository name does not exist');
    for (const script of ['install.sh', 'setup-sway.sh', 'setup-zenbook-cpu-cap.sh',
        'setup-hardening.sh']) {
        assert.ok(kali.includes(script), `KALI.md must name ${script}`);
    }
    // Same two promises the README makes: no identifier for the staging host, and no
    // pretending the scripts have been run on a real machine.
    assert.doesNotMatch(kali, /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
        'No address for the staging host may appear in this repository');
    assert.match(kali, /Host vps/, 'The relay is named by its ssh alias and nothing else');
    assert.match(kali, /has not run on real hardware|not been run on real hardware/i,
        'KALI.md must not imply the scripts have been proved on a real machine');
}

console.log('readme-smoke: all checks passed');
