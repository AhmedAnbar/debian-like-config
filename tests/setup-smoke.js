// SPDX-License-Identifier: GPL-3.0-only
// Previews of the Zsh and Neovim scripts against stubs: nothing is installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-setup-smoke-'));
const bin = path.join(scratch, 'bin');
fs.mkdirSync(bin);
for (const [name, body] of [
    ['apt-get', '#!/bin/sh\nexit 0\n'],
    ['sudo', '#!/bin/sh\nexec "$@"\n'],
    ['chsh', '#!/bin/sh\nexit 0\n'],
    ['git', '#!/bin/sh\nexit 0\n'],
    // The version apt offers is what decides between apt and the upstream tarball.
    ['apt-cache', '#!/bin/sh\nprintf "  Candidate: %s\\n" "${STUB_NEOVIM:-0.11.6-1}"\n'],
]) fs.writeFileSync(path.join(bin, name), body, {mode: 0o755});

const preview = (script, stubNeovim) => {
    const result = spawnSync('bash', [path.join(root, script), '--dry-run'], {
        encoding: 'utf8', timeout: 30000, input: 'y\n'.repeat(40),
        env: {...process.env, HOME: scratch, PATH: `${bin}:${process.env.PATH}`, STUB_NEOVIM: stubNeovim || ''},
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
};

assert.equal(spawnSync('bash', [path.join(root, 'setup-zsh.sh'), '--invalid']).status, 2);
assert.equal(spawnSync('bash', [path.join(root, 'setup-nvim.sh'), '--invalid']).status, 2);

const zsh = preview('setup-zsh.sh');
assert.match(zsh, /apt-get install[^\n]*\bzsh\b/);
assert.match(zsh, /zsh-autosuggestions/);
assert.match(zsh, /ohmyzsh/, 'Oh My Zsh comes from its own repository');
assert.match(zsh, /chsh -s \/usr\/bin\/zsh|chsh -s \/bin\/zsh/);

// Ubuntu's 0.11.6 is new enough for apt; Debian's 0.10.4 must take the upstream tarball.
const modern = preview('setup-nvim.sh', '0.11.6-1');
assert.match(modern, /apt-get install[^\n]*\bneovim\b/);
assert.doesNotMatch(modern, /github\.com\/neovim/, 'No download when apt is new enough');
const old = preview('setup-nvim.sh', '0.10.4-8');
assert.match(old, /github\.com\/neovim\/neovim\/releases/, 'Fall back to the upstream tarball');
assert.doesNotMatch(old, /apt-get install[^\n]*\bneovim\b/, 'Do not install the too-old apt package');
assert.match(old, /0\.10\.4/, 'Say which version apt offered');
assert.match(old, /\.local\/opt/, 'The tarball goes to a user-owned prefix');

// The zshrc was pointed at the Debian plugin paths in Task 5; keep it that way.
const zshrc = fs.readFileSync(path.join(root, 'zsh/zshrc'), 'utf8');
assert.match(zshrc, /\/usr\/share\/zsh-autosuggestions\/zsh-autosuggestions\.zsh/);
assert.match(zshrc, /\/usr\/share\/zsh-syntax-highlighting\/zsh-syntax-highlighting\.zsh/);
assert.doesNotMatch(zshrc, /\/usr\/share\/zsh\/plugins\//,
    "Arch's plugin layout would silently load nothing on Debian");

assert.deepEqual(fs.readdirSync(scratch), ['bin'], 'A preview must not create files');
fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-smoke: all checks passed');
