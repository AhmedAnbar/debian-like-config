// SPDX-License-Identifier: GPL-3.0-only
// The picker against a fixture and stubs: no display, no real typing, no clipboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'config/i3/emoji.sh');

// Three real lines from emoji-test.txt, plus the noise the file is full of.
const fixture = `# emoji-test.txt
# Group: Smileys
1F600                                                  ; fully-qualified     # 😀 E1.0 grinning face
1F469 200D 1F4BB                                       ; fully-qualified     # 👩‍💻 E4.0 woman technologist
263A FE0F                                              ; fully-qualified     # ☺️ E0.6 smiling face
263A                                                   ; unqualified         # ☺ E0.6 smiling face
`;

const stubDir = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-stub-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    for (const [name, body] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, 'bin', name), body, {mode: 0o755});
    }
    fs.writeFileSync(path.join(dir, 'emoji-test.txt'), fixture);
    return dir;
};
const run = (dir, extra = {}) => spawnSync('sh', [script], {
    encoding: 'utf8', timeout: 20000,
    env: {...process.env, HOME: dir, PATH: `${path.join(dir, 'bin')}:/usr/bin:/bin`,
        EMOJI_DATA: path.join(dir, 'emoji-test.txt'),
        WAYLAND_DISPLAY: '', DISPLAY: '', ...extra},
});

// The list rofi receives: fully-qualified entries only, emoji first, name after.
{
    const dir = stubDir({
        rofi: '#!/bin/sh\ncat > "$HOME/list"\nexit 1\n',
        'notify-send': '#!/bin/sh\nexit 0\n',
    });
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    const list = fs.readFileSync(path.join(dir, 'list'), 'utf8').trim().split('\n');
    assert.equal(list.length, 3, 'Only the fully-qualified entries: ' + list.join(' | '));
    assert.equal(list[0], '😀 grinning face');
    assert.equal(list[1], '👩‍💻 woman technologist');
    assert.equal(list[2], '☺️ smiling face', 'Variation selectors are part of the emoji');
    fs.rmSync(dir, {recursive: true, force: true});
}

// Wayland: the choice is typed with wtype, and only the character is typed.
{
    const dir = stubDir({
        rofi: '#!/bin/sh\ncat > /dev/null\necho "😀 grinning face"\n',
        wtype: '#!/bin/sh\nprintf "%s" "$2" > "$HOME/typed"\n',
        'notify-send': '#!/bin/sh\nexit 0\n',
    });
    const result = run(dir, {WAYLAND_DISPLAY: 'wayland-0'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'typed'), 'utf8'), '😀', 'Type the emoji, not its name');
    fs.rmSync(dir, {recursive: true, force: true});
}

// Review Focus 5: wtype refused by the compositor falls back to the clipboard.
{
    const dir = stubDir({
        rofi: '#!/bin/sh\ncat > /dev/null\necho "😀 grinning face"\n',
        wtype: '#!/bin/sh\necho "virtual keyboard protocol not supported" >&2\nexit 1\n',
        'wl-copy': '#!/bin/sh\ncat > "$HOME/copied"\n',
        'notify-send': '#!/bin/sh\nshift\nprintf "%s" "$*" > "$HOME/notified"\n',
    });
    const result = run(dir, {WAYLAND_DISPLAY: 'wayland-0'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'copied'), 'utf8').trim(), '😀', 'The choice is not lost');
    assert.match(fs.readFileSync(path.join(dir, 'notified'), 'utf8'), /paste|clipboard/i,
        'Tell the user where the emoji went');
    fs.rmSync(dir, {recursive: true, force: true});
}

// X11: the same script types with xdotool instead.
{
    const dir = stubDir({
        rofi: '#!/bin/sh\ncat > /dev/null\necho "☺️ smiling face"\n',
        xdotool: '#!/bin/sh\nprintf "%s" "$4" > "$HOME/typed"\n',
        'notify-send': '#!/bin/sh\nexit 0\n',
    });
    const result = run(dir, {DISPLAY: ':0'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'typed'), 'utf8'), '☺️');
    fs.rmSync(dir, {recursive: true, force: true});
}

// A missing data file reports itself instead of opening an empty picker.
{
    const dir = stubDir({
        rofi: '#!/bin/sh\necho "should not be called" >&2\nexit 1\n',
        'notify-send': '#!/bin/sh\nshift\nprintf "%s" "$*" > "$HOME/notified"\n',
    });
    fs.rmSync(path.join(dir, 'emoji-test.txt'));
    const result = run(dir);
    assert.equal(result.status, 0, 'A missing list is not a crash');
    assert.match(fs.readFileSync(path.join(dir, 'notified'), 'utf8'), /unicode-data/,
        'Name the package that provides the list');
    fs.rmSync(dir, {recursive: true, force: true});
}
console.log('emoji-smoke: all checks passed');
