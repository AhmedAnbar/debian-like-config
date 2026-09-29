// SPDX-License-Identifier: GPL-3.0-only
// Compares the shared configuration against the Arch repository; read-only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const archDir = process.env.ARCH_SETUP_DIR || path.join(os.homedir(), 'arch-desktop-setup');

const shared = read('scripts/shared-files.txt').trim().split('\n');
const adapted = read('scripts/adapted-files.txt').trim().split('\n').map((line) => line.split('\t'));
const adaptedPaths = adapted.map(([file]) => file);

// Every tracked configuration file belongs to exactly one list: no file falls through.
const tracked = spawnSync('find', ['config', 'applications', 'zsh', '-type', 'f'],
    {cwd: root, encoding: 'utf8'}).stdout.trim().split('\n').map((p) => p.replace(/^\.\//, ''));
for (const file of tracked) {
    const inShared = shared.includes(file);
    const inAdapted = adaptedPaths.includes(file);
    assert.ok(inShared !== inAdapted, `${file} must be in exactly one of the two lists`);
}
for (const [file, reason] of adapted) {
    assert.ok(fs.existsSync(path.join(root, file)), `Adapted file is missing: ${file}`);
    assert.ok((reason || '').length > 20, `An adapted file needs a reason: ${file}`);
}

if (!fs.existsSync(archDir)) {
    console.log(`drift-smoke: skipped the comparison, no Arch checkout at ${archDir}`);
    // A shared file that is listed but not yet committed has no copy in git: --pull must refuse.
{
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-untracked-'));
    const copy = path.join(clone, 'repo');
    spawnSync('cp', ['-a', root, copy]);
    spawnSync('git', ['-C', copy, 'commit', '-qam', 'baseline the clone'], {encoding: 'utf8'});
    // Untrack a shared file and edit it: git holds no copy, so --pull would destroy the only one.
    spawnSync('git', ['-C', copy, 'rm', '--cached', '-q', 'config/kitty/kitty.conf'], {encoding: 'utf8'});
    spawnSync('git', ['-C', copy, 'commit', '-qm', 'untrack the file'], {encoding: 'utf8'});
    fs.appendFileSync(path.join(copy, 'config/kitty/kitty.conf'), '\n# work in progress\n');
    const pulled = spawnSync('bash', [path.join(copy, 'scripts/sync-from-arch.sh'), '--pull'],
        {encoding: 'utf8', timeout: 60000});
    assert.equal(pulled.status, 1, 'An untracked shared file must stop --pull');
    assert.match(pulled.stderr, /untracked/i, 'Say what is in the way');
    assert.match(fs.readFileSync(path.join(copy, 'config/kitty/kitty.conf'), 'utf8'), /work in progress/,
        'The only copy of the edit must survive');
    fs.rmSync(clone, {recursive: true, force: true});
}
// Outside a git checkout --pull says so instead of blaming uncommitted changes.
{
    const loose = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-notgit-'));
    const copy = path.join(loose, 'repo');
    spawnSync('cp', ['-a', root, copy]);
    fs.rmSync(path.join(copy, '.git'), {recursive: true, force: true});
    const pulled = spawnSync('bash', [path.join(copy, 'scripts/sync-from-arch.sh'), '--pull'],
        {encoding: 'utf8', timeout: 60000, env: {...process.env, GIT_CEILING_DIRECTORIES: loose}});
    assert.equal(pulled.status, 1);
    assert.match(pulled.stderr, /git checkout/i, 'Explain that --pull needs git to recover from');
    fs.rmSync(loose, {recursive: true, force: true});
}
console.log('drift-smoke: all checks passed');
    process.exit(0);
}

// Shared files match byte for byte; adapted files really differ, or they should be shared.
for (const file of shared) {
    assert.equal(read(file), fs.readFileSync(path.join(archDir, file), 'utf8'), `Drifted: ${file}`);
}
for (const [file] of adapted) {
    const upstream = path.join(archDir, file);
    if (!fs.existsSync(upstream)) continue;
    assert.notEqual(read(file), fs.readFileSync(upstream, 'utf8'),
        `${file} is identical upstream, so it belongs in shared-files.txt`);
}

const sync = (args, env = {}) => spawnSync('bash', [path.join(root, 'scripts/sync-from-arch.sh'), ...args],
    {encoding: 'utf8', timeout: 60000, env: {...process.env, ...env}});
const check = sync(['--check']);
assert.equal(check.status, 0, check.stdout + check.stderr);
assert.doesNotMatch(check.stdout, /^drifted/m, 'Nothing should be drifted right after creation');
assert.equal(sync(['--invalid']).status, 2);

// Without a checkout the tooling reports and succeeds: a fresh Debian machine is not blocked.
const nowhere = sync(['--check'], {ARCH_SETUP_DIR: path.join(os.tmpdir(), 'no-arch-checkout-here')});
assert.equal(nowhere.status, 0);
assert.match(nowhere.stdout, /nothing to compare/i);

// Drift is detected, and --pull repairs it.
{
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-drift-'));
    const copy = path.join(clone, 'repo');
    spawnSync('cp', ['-a', root, copy]);
    const victim = path.join(copy, 'config/kitty/kitty.conf');
    fs.appendFileSync(victim, '\n# local edit\n');
    spawnSync('git', ['-C', copy, 'commit', '-am', 'local edit'], {encoding: 'utf8'});
    const drifted = spawnSync('bash', [path.join(copy, 'scripts/sync-from-arch.sh'), '--check'],
        {encoding: 'utf8', timeout: 60000});
    assert.equal(drifted.status, 1, 'Drift must fail --check');
    assert.match(drifted.stdout, /^drifted\tconfig\/kitty\/kitty\.conf$/m);
    const pulled = spawnSync('bash', [path.join(copy, 'scripts/sync-from-arch.sh'), '--pull'],
        {encoding: 'utf8', timeout: 60000});
    assert.equal(pulled.status, 0, pulled.stdout + pulled.stderr);
    assert.equal(fs.readFileSync(victim, 'utf8'),
        fs.readFileSync(path.join(archDir, 'config/kitty/kitty.conf'), 'utf8'), '--pull restores the file');
    fs.rmSync(clone, {recursive: true, force: true});
}
// A shared file that is listed but not yet committed has no copy in git: --pull must refuse.
{
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-untracked-'));
    const copy = path.join(clone, 'repo');
    spawnSync('cp', ['-a', root, copy]);
    spawnSync('git', ['-C', copy, 'commit', '-qam', 'baseline the clone'], {encoding: 'utf8'});
    // Untrack a shared file and edit it: git holds no copy, so --pull would destroy the only one.
    spawnSync('git', ['-C', copy, 'rm', '--cached', '-q', 'config/kitty/kitty.conf'], {encoding: 'utf8'});
    spawnSync('git', ['-C', copy, 'commit', '-qm', 'untrack the file'], {encoding: 'utf8'});
    fs.appendFileSync(path.join(copy, 'config/kitty/kitty.conf'), '\n# work in progress\n');
    const pulled = spawnSync('bash', [path.join(copy, 'scripts/sync-from-arch.sh'), '--pull'],
        {encoding: 'utf8', timeout: 60000});
    assert.equal(pulled.status, 1, 'An untracked shared file must stop --pull');
    assert.match(pulled.stderr, /untracked/i, 'Say what is in the way');
    assert.match(fs.readFileSync(path.join(copy, 'config/kitty/kitty.conf'), 'utf8'), /work in progress/,
        'The only copy of the edit must survive');
    fs.rmSync(clone, {recursive: true, force: true});
}
// Outside a git checkout --pull says so instead of blaming uncommitted changes.
{
    const loose = fs.mkdtempSync(path.join(os.tmpdir(), 'debian-notgit-'));
    const copy = path.join(loose, 'repo');
    spawnSync('cp', ['-a', root, copy]);
    fs.rmSync(path.join(copy, '.git'), {recursive: true, force: true});
    const pulled = spawnSync('bash', [path.join(copy, 'scripts/sync-from-arch.sh'), '--pull'],
        {encoding: 'utf8', timeout: 60000, env: {...process.env, GIT_CEILING_DIRECTORIES: loose}});
    assert.equal(pulled.status, 1);
    assert.match(pulled.stderr, /git checkout/i, 'Explain that --pull needs git to recover from');
    fs.rmSync(loose, {recursive: true, force: true});
}
console.log('drift-smoke: all checks passed');
