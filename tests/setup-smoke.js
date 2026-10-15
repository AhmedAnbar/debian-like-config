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
// Named rows, for a script that needs part of a group it does not install whole.
{
    const namedScratch = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-named-smoke-'));
    const map = path.join(namedScratch, 'map.tsv');
    fs.writeFileSync(map, ['group\tarch\tapt\twhere\tnote',
        'demo\talpha\talpha\tboth\t-',
        'demo\tbeta\tbeta-debian\tdebian\tDebian names it differently for a reason this test does not care about',
        'demo\tbeta\tbeta-ubuntu\tubuntu\tUbuntu names it differently for a reason this test does not care about',
        'demo\tdelta\t-\tnone\tNot packaged anywhere, and this note is long enough to satisfy the map rule',
        'other\t-\tepsilon\tboth\tA row with no Arch name, reached by its apt name instead',
    ].join('\n') + '\n');
    const probe = `
        dry_run=true; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        map_named_packages ${map} debian picked alpha beta epsilon delta
        printf '%s\\n' "\${picked[@]}"
        printf 'unavailable: %s\\n' "\${unavailable[*]}"
        printf 'skipped: %s\\n' "\${skipped[*]}"
    `;
    const result = spawnSync('bash', ['-c', probe], {encoding: 'utf8', timeout: 10000,
        env: {...process.env, HOME: namedScratch}});
    assert.equal(result.status, 0, result.stderr);
    const printed = result.stdout.trim().split('\n');
    assert.deepEqual(printed.slice(0, 3), ['alpha', 'beta-debian', 'epsilon'],
        'One row per name, this release\'s spelling, sorted and deduplicated');
    assert.match(result.stdout, /skipped: beta-ubuntu/, "The other release's row is reported, not installed");
    assert.match(result.stdout, /unavailable: delta \(Not packaged anywhere/, 'With its reason');
    fs.rmSync(namedScratch, {recursive: true, force: true});
}
// The fast path must not leave a wrong mode behind: install.sh writes the shared
// helpers 644 for the i3 session and setup-sway.sh installs the same bytes 755.
{
    const modeScratch = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-mode-smoke-'));
    const probe = `
        dry_run=false; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        printf 'helper body\\n' > "$HOME/helper.sh"
        install -Dm644 -- "$HOME/helper.sh" "$target_config/helper.sh"
        install_file "$HOME/helper.sh" helper.sh 755
        stat -c '%a' "$target_config/helper.sh"
    `;
    const result = spawnSync('bash', ['-c', probe], {encoding: 'utf8', timeout: 10000,
        env: {...process.env, HOME: modeScratch}});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim().split('\n').pop(), '755',
        'Identical contents at the wrong mode must still be corrected');
    fs.rmSync(modeScratch, {recursive: true, force: true});
}
// The spec named four consumers of the shared helpers, and a second copy of the
// consent path is the defect the phase 1 review found.
for (const script of ['setup-zsh.sh', 'setup-nvim.sh']) {
    const body = fs.readFileSync(path.join(root, script), 'utf8');
    assert.match(body, /source "\$bundle_dir\/lib\/common\.sh"/, `${script} must source the library`);
    assert.doesNotMatch(body, /^ask\(\) \{/m, `${script} must not redefine ask`);
    assert.doesNotMatch(body, /^run\(\) \{/m, `${script} must not redefine run`);
}
// try records a failure exactly as attempt does, and still returns the command's
// status, so a caller can take the other branch. attempt returns 0 by design.
{
    const tryScratch = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-try-smoke-'));
    const probe = `
        dry_run=false; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        if try sh -c 'exit 3'; then printf 'try: returned zero\\n'; else printf 'try: returned %s\\n' "$?"; fi
        if attempt sh -c 'exit 3'; then printf 'attempt: returned zero\\n'; else printf 'attempt: nonzero\\n'; fi
        printf 'failed count: %s\\n' "\${#failed[@]}"
        if try true; then printf 'try success: zero\\n'; fi
    `;
    const result = spawnSync('bash', ['-c', probe], {encoding: 'utf8', timeout: 10000,
        env: {...process.env, HOME: tryScratch}});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /try: returned 3/, "try must return the command's own status");
    assert.match(result.stdout, /attempt: returned zero/, 'attempt still returns 0, by design');
    assert.match(result.stdout, /failed count: 2/, 'Both record the failure');
    assert.match(result.stdout, /try success: zero/, 'And try returns 0 when the command works');
    fs.rmSync(tryScratch, {recursive: true, force: true});
}
// backup_system_file: one way to copy a file out of /etc before replacing it. Read as
// root, because a file there may be readable by root alone; landed as the user, because
// a root-owned copy in their own backup directory is one they cannot delete without
// sudo. Two scripts had settled on one of those halves each, with comments calling the
// other half wrong.
{
    const bk = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-backup-smoke-'));
    const stubs = path.join(bk, 'bin');
    fs.mkdirSync(stubs);
    // sudo runs the command, so what the helper asks for is what actually happens.
    fs.writeFileSync(path.join(stubs, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o755});
    const etc = path.join(bk, 'etc');
    fs.mkdirSync(etc);
    const secret = path.join(etc, 'btrbk.conf');
    fs.writeFileSync(secret, 'volume /\n', {mode: 0o600});
    const probe = `
        dry_run=false; target_config=$HOME/.config; backup_dir=$HOME/backup
        source ${path.join(root, 'lib/common.sh')}
        backup_system_file ${secret} btrbk.conf
        printf 'returned %s\\n' "$?"
        backup_system_file ${path.join(etc, 'not-there.conf')} absent.conf
        printf 'absent returned %s\\n' "$?"
        printf 'failed: %s\\n' "${'$'}{failed[*]:-none}"
    `;
    const result = spawnSync('bash', ['-c', probe], {encoding: 'utf8', timeout: 10000,
        env: {...process.env, HOME: bk, PATH: `${stubs}:/usr/bin:/bin`}});
    assert.match(result.stdout, /returned 0/, result.stdout + result.stderr);
    const copy = path.join(bk, 'backup/btrbk.conf');
    assert.ok(fs.existsSync(copy), 'The file is copied into the backup directory');
    assert.equal(fs.readFileSync(copy, 'utf8'), 'volume /\n', 'Byte for byte');
    assert.equal(fs.statSync(copy).uid, process.getuid(),
        'The copy belongs to the user, who must be able to delete their own backup');
    assert.match(result.stdout, /absent returned 0/,
        'A file that is not there needs no backup and is not a failure');
    assert.ok(!fs.existsSync(path.join(bk, 'backup/absent.conf')));
    assert.match(result.stdout, /failed: none/, 'And nothing is recorded as having failed');
    fs.rmSync(bk, {recursive: true, force: true});
}

console.log('setup-smoke: all checks passed');
