// SPDX-License-Identifier: GPL-3.0-only
// Stubbed runs only. Nothing here installs a package, starts a service, reaches the
// network or writes outside a mkdtemp directory: the PATH is built from a named list,
// every external command on it is a stub that logs its arguments, and the download
// tools are on it solely so the test can prove the panel step never calls one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'conky-smoke-'));
const osRelease = (body, name) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, body);
    return file;
};
const debian = osRelease('ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const ubuntu = osRelease('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n', 'ubuntu');

// This machine is an Arch desktop and may have conky, apt-get or neither. A PATH built
// from a named list is the only way to pin what the script finds, and it is also what
// keeps the run hermetic: no real apt, no real systemctl, no real network tool.
const minimalPath = (log, {candidate = '1.22.1-1', installStatus = 0, updateStatus = 0,
    extra = []} = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conky-path-'));
    // bash and sh are in the list because spawnSync resolves the command it runs
    // through the PATH it is given, not the one this process has.
    for (const command of ['bash', 'sh', 'cat', 'chmod', 'cmp', 'cp', 'date', 'dirname', 'env',
        'find', 'id', 'install', 'mkdir', 'mktemp', 'sort', 'stat', 'tail', 'unlink', 'awk',
        ...extra]) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidatePath) => fs.existsSync(candidatePath));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
    const stub = (name, body = 'exit 0') => fs.writeFileSync(path.join(dir, name),
        `#!/bin/sh\necho "${name} $*" >> ${log}\n${body}\n`, {mode: 0o755});
    // The two apt invocations fail independently: an unreachable index and a package
    // that is not in the enabled components are different outcomes for this script.
    stub('apt-get', `case "$1" in
  install) exit ${installStatus} ;;
  update) exit ${updateStatus} ;;
  *) exit 0 ;;
esac`);
    stub('apt-cache', `printf '  Installed: (none)\\n  Candidate: ${candidate}\\n'`);
    stub('sudo', 'exec "$@"');
    stub('systemctl');
    stub('conky');
    // The panel comes from apt and its configuration from the bundle, so none of these
    // may ever run. They are stubbed as failures: if the script reaches one, it breaks.
    for (const name of ['curl', 'wget', 'scp', 'ssh', 'gpg', 'tar', 'git']) stub(name, 'exit 1');
    return dir;
};
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
// One case: its own home, its own PATH, its own call log.
const run = (args, release, {answers = 'n\n'.repeat(40), label = 'case', ...options} = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `conky-${label}-`));
    const log = path.join(home, 'calls');
    const only = minimalPath(log, options);
    const result = spawnSync('bash', [path.join(root, 'setup-conky.sh'), ...args], {
        encoding: 'utf8', timeout: 60000, input: answers,
        env: {HOME: home, PATH: only, DEBIAN_SETUP_OS_RELEASE: release},
    });
    return {
        result, home, only, calls: read(log),
        config: (relative) => path.join(home, '.config', relative),
        clean: () => {
            fs.rmSync(only, {recursive: true, force: true});
            fs.rmSync(home, {recursive: true, force: true});
        },
    };
};
const mode = (file) => fs.statSync(file).mode & 0o777;

// Arguments and guards.
{
    const bad = run(['--invalid'], debian, {label: 'arg'});
    assert.equal(bad.result.status, 2, 'An unknown argument is a usage error');
    bad.clean();
    const help = run(['--help'], debian, {label: 'help'});
    assert.equal(help.result.status, 0);
    assert.match(help.result.stdout, /setup-conky\.sh/, 'The help names the script');
    help.clean();
    const fedora = run(['--dry-run'], osRelease('ID=fedora\n', 'fedora'), {label: 'fedora'});
    assert.equal(fedora.result.status, 1);
    assert.match(fedora.result.stderr, /Debian 13 and Ubuntu 26\.04/);
    fedora.clean();
}

// A preview that is declined: the package is named with the version apt offers, the
// virtual-package trap is explained, and nothing at all is written or run.
{
    const preview = run(['--dry-run'], debian, {label: 'preview'});
    assert.equal(preview.result.status, 0, preview.result.stderr);
    assert.match(preview.result.stdout, /conky-std/, 'Name the package that actually exists');
    assert.match(preview.result.stdout, /1\.22\.1-1/, 'Name the version apt offers');
    assert.match(preview.result.stdout, /no installation candidate|pure virtual/i,
        'Say why the package is conky-std and not conky');
    assert.doesNotMatch(preview.result.stdout, /apt-get install/,
        'A declined package step installs nothing');
    assert.ok(!fs.existsSync(preview.config('.')), 'A declined run writes no configuration');
    assert.doesNotMatch(preview.calls, /apt-get/, 'And runs no apt-get');
    assert.doesNotMatch(preview.calls, /^(curl|wget|scp|ssh|gpg)\b/m,
        'The panel needs no network: no download tool may be called');
    preview.clean();
}

// A preview that is accepted at every prompt: it prints the commands and still writes
// nothing and runs nothing. This is the check that --dry-run is honoured end to end.
{
    const preview = run(['--dry-run'], debian, {label: 'dry-yes', answers: 'y\n'.repeat(40)});
    assert.equal(preview.result.status, 0, preview.result.stderr);
    assert.match(preview.result.stdout, /apt-get install -y conky-std/,
        'A preview still shows the command it would run');
    assert.doesNotMatch(preview.calls, /apt-get/, 'But must not run it');
    assert.ok(!fs.existsSync(preview.config('conky')), 'A preview installs no file');
    assert.ok(!fs.existsSync(preview.config('sway')), 'And writes no session fragment');
    // Not one directory either: the backup directory is created by the first backup,
    // and a preview that has taken none must not have made it.
    assert.deepEqual(fs.readdirSync(preview.home), ['calls'],
        'A preview leaves nothing behind but the stub log this test asked for');
    preview.clean();
}

// A real run with every prompt declined: exit 0 and an untouched machine.
{
    const declined = run([], debian, {label: 'declined'});
    assert.equal(declined.result.status, 0, declined.result.stderr);
    assert.ok(!fs.existsSync(declined.config('conky')), 'All-no installs no configuration');
    assert.ok(!fs.existsSync(declined.config('sway')), 'All-no writes no Sway fragment');
    assert.doesNotMatch(declined.calls, /apt-get install/, 'All-no installs no package');
    assert.doesNotMatch(declined.calls, /^(curl|wget|scp|ssh|gpg)\b/m, 'And downloads nothing');
    declined.clean();
}

// The whole panel, accepted: package, configuration tree, both session fragments.
{
    const all = run([], debian, {label: 'all', answers: 'y\n'.repeat(40)});
    assert.equal(all.result.status, 0, all.result.stderr);
    assert.match(all.calls, /apt-get install -y conky-std/, 'Install the package from the map');
    assert.doesNotMatch(all.calls, /^(curl|wget|scp|ssh|gpg|tar)\b/m,
        'Nothing is downloaded or unpacked: the tree is in the bundle');

    for (const relative of ['conky/panel.lua', 'conky/themes/catppuccin.conf',
        'conky/themes/nord.conf', 'conky/themes/dracula.conf']) {
        assert.ok(fs.existsSync(all.config(relative)), `Missing: ${relative}`);
        assert.equal(mode(all.config(relative)), 0o644, `${relative} is not a program`);
    }
    for (const script of ['conky/start.sh', 'conky/switch.sh']) {
        assert.ok(fs.existsSync(all.config(script)), `Missing: ${script}`);
        assert.equal(mode(all.config(script)), 0o755,
            `${script} is run by a key binding and must be executable`);
    }
    // Every theme loads the shared panel, so the panel has to be installed with them.
    for (const theme of ['catppuccin', 'nord', 'dracula']) {
        assert.match(read(all.config(`conky/themes/${theme}.conf`)), /conky\/panel\.lua/,
            `${theme} loads panel.lua, which must be installed beside it`);
    }

    // What phase 2 removed, restored: the Sway fragment the main config includes.
    const fragment = read(all.config('sway/config.d/30-conky.conf'));
    assert.match(fragment, /exec sh ~\/\.config\/conky\/start\.sh/, 'The Sway autostart');
    assert.match(fragment, /bindsym \$mod\+Shift\+t exec sh ~\/\.config\/conky\/switch\.sh/,
        'And the theme picker binding');
    // The i3 half cannot be installed by replacing a file, so the lines are printed and
    // kept on disk; both are useless if they name a script nothing installed.
    const i3 = read(all.config('conky/i3-conky.conf'));
    assert.match(i3, /exec --no-startup-id sh ~\/\.config\/conky\/start\.sh/, 'The i3 autostart');
    assert.match(i3, /bindsym \$mod\+Shift\+t exec --no-startup-id sh ~\/\.config\/conky\/switch\.sh/,
        'And the i3 binding, with the --no-startup-id i3 needs');
    for (const [file, body] of [['30-conky.conf', fragment], ['i3-conky.conf', i3]]) {
        const referenced = [...body.matchAll(/~\/\.config\/conky\/([\w-]+\.sh)/g)].map((m) => m[1]);
        assert.ok(referenced.length >= 2, `${file} must name both panel scripts`);
        for (const script of new Set(referenced)) {
            const target = all.config(`conky/${script}`);
            assert.ok(fs.existsSync(target), `${file} names ${script}, which nothing installed`);
            assert.equal(mode(target), 0o755, `${script} must be executable`);
        }
    }
    // The i3 configuration is a shared file this script must not rewrite, so the run
    // has to say what to add and where, or the i3 session silently has no panel.
    assert.match(all.result.stdout, /\.config\/i3\/config/, 'Say which file to edit by hand');
    assert.match(all.result.stdout, /exec --no-startup-id sh ~\/\.config\/conky\/start\.sh/,
        'And print the exact line to add');
    assert.match(all.result.stdout, /bindsym \$mod\+Shift\+t/, 'With its binding');

    // Accepting the theme prompt with "y" takes the default rather than writing junk.
    assert.equal(read(all.config('conky/theme')).trim(), 'catppuccin',
        'The default theme is the one the panel ships with');

    // Said in the script's own closing output, not left for the reader to discover.
    const out = all.result.stdout;
    assert.match(out, /Xvfb/, 'The panel was proved under Xvfb, not on a real session surface');
    assert.match(out, /hwmon|temperature/i, 'The temperature line is unverified');
    assert.match(out, /batter/i, 'The battery lines are unverified');
    assert.match(out, /Nerd Font/, 'The patched font is packaged by neither release');
    all.clean();
}

// The theme chooser writes what was chosen, and only that.
{
    // Package no, configuration yes, theme yes + "2", both fragments no.
    const nord = run([], debian, {label: 'nord', answers: 'n\ny\ny\n2\nn\nn\n'});
    assert.equal(nord.result.status, 0, nord.result.stderr);
    assert.equal(read(nord.config('conky/theme')).trim(), 'nord', 'Nord was chosen');
    assert.ok(fs.existsSync(nord.config('conky/panel.lua')), 'The tree was still installed');
    assert.ok(!fs.existsSync(nord.config('sway/config.d/30-conky.conf')),
        'A declined Sway fragment is not written');
    assert.doesNotMatch(nord.calls, /apt-get install/, 'A declined package is not installed');
    nord.clean();
}

// Ubuntu keeps conky-std in universe, so a failed install must be recorded and reported
// rather than stopping the run — and the exit status must carry it to install.sh.
{
    const failing = run([], ubuntu, {label: 'ubuntu', answers: 'y\n'.repeat(40), installStatus: 1,
        candidate: '1.22.2-1build1'});
    assert.equal(failing.result.status, 1, 'A failed step must not report success');
    assert.match(failing.result.stdout, /Steps that failed:/, 'The failure is named');
    assert.match(failing.result.stdout, /apt-get install -y conky-std/, 'By the command that failed');
    assert.match(failing.result.stdout, /universe/i, 'Ubuntu keeps this package in universe');
    assert.ok(fs.existsSync(failing.config('conky/panel.lua')),
        'A failed package step must not cost the user the configuration');
    assert.doesNotMatch(failing.result.stderr, /stopped at line/,
        'A universe package that is not there is not a crash');
    failing.clean();
}

// An index that cannot be updated stops before the install rather than installing
// against a stale one, and says so without costing the user the configuration.
{
    const stale = run([], debian, {label: 'stale', answers: 'y\n'.repeat(40), updateStatus: 1});
    assert.equal(stale.result.status, 1, 'A failed update is a failed step');
    assert.match(stale.result.stderr, /could not be updated/, 'Say what went wrong, on stderr');
    assert.doesNotMatch(stale.calls, /apt-get install/,
        'Installing against an index that could not be updated is worse than not installing');
    assert.ok(fs.existsSync(stale.config('conky/panel.lua')), 'The configuration still arrives');
    stale.clean();
}

// The tree in the bundle is the Arch one, not a reinvention of it, and it carries no
// instruction a Debian user cannot follow.
{
    const panel = read(path.join(root, 'config/conky/panel.lua'));
    assert.match(panel, /conky\.config/, 'panel.lua sets the conky configuration');
    assert.match(panel, /out_to_wayland/, 'The same panel serves Sway and i3');
    for (const file of ['config/conky/start.sh', 'config/conky/switch.sh']) {
        assert.doesNotMatch(read(path.join(root, file)), /pacman/,
            `${file} must not tell a Debian user to run pacman`);
    }
}

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-conky-smoke: all checks passed');
