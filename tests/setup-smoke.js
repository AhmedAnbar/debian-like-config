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
// The library is sourced, not run: executing it must not look like a successful install.
{
    const direct = spawnSync('bash', [path.join(root, 'lib/common.sh')], {encoding: 'utf8', timeout: 10000});
    assert.equal(direct.status, 0, 'Sourcing a function library has no side effects');
    assert.equal(direct.stdout, '', 'A sourced library prints nothing on its own');
}
// Every script that uses the shared helpers must source them rather than redefine them.
{
    const body = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
    assert.match(body, /source "\$bundle_dir\/lib\/common\.sh"/, 'install.sh must source the library');
    assert.doesNotMatch(body, /^install_file\(\) \{/m, 'install.sh must not redefine install_file');
}
// The group reader is the one place that decides what a release installs.
{
    const groupScratch = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-group-smoke-'));
    const map = path.join(groupScratch, 'map.tsv');
    fs.writeFileSync(map, ['group\tarch\tapt\twhere\tnote',
        'demo\talpha\talpha\tboth\t-',
        'demo\tbeta\tbeta-debian\tdebian\tDebian names it differently for a reason this test does not care about',
        'demo\tgamma\tgamma-ubuntu\tubuntu\tUbuntu names it differently for a reason this test does not care about',
        'demo\tdelta\t-\tnone\tNot packaged anywhere, and this note is long enough to satisfy the map rule',
        'other\tepsilon\tepsilon\tboth\t-',
        'demo\talpha-too\talpha\tboth\tA second row resolving to the same apt name, to prove deduplication',
    ].join('\n') + '\n');
    const probe = `
        dry_run=true; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        map_group_packages ${map} demo debian chosen
        printf '%s\\n' "\${chosen[@]}"
        printf 'unavailable: %s\\n' "\${unavailable[*]}"
        printf 'skipped: %s\\n' "\${skipped[*]}"
    `;
    const result = spawnSync('bash', ['-c', probe], {encoding: 'utf8', timeout: 10000,
        env: {...process.env, HOME: groupScratch}});
    assert.equal(result.status, 0, result.stderr);
    const printed = result.stdout.trim().split('\n');
    assert.equal(printed[0], 'alpha', 'Deduplicated, and only this release');
    assert.equal(printed.filter((l) => l === 'beta-debian').length, 1,
        'The Debian-only package is included on Debian');
    assert.equal(printed.filter((l) => l === 'gamma-ubuntu').length, 0,
        'The other release\'s package is not installed here');
    const reported = printed.join('\n');
    assert.match(reported, /unavailable: delta \(Not packaged anywhere/, 'Report it with its reason');
    assert.match(reported, /skipped: gamma-ubuntu \(Ubuntu names it/, 'Report the other release\'s package');
    fs.rmSync(groupScratch, {recursive: true, force: true});
}
console.log('setup-smoke: all checks passed');
