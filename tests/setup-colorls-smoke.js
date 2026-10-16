// SPDX-License-Identifier: GPL-3.0-only
// setup-colorls.sh against stubs. Nothing here touches apt, rubygems.org or a
// compiler: the distribution is read through DEBIAN_SETUP_OS_RELEASE, the package
// names through DEBIAN_SETUP_MAP, and every external command the script can reach
// is a stub inside a mkdtemp directory that logs what it was called with.
//
// The map fixture carries the three colorls rows this subject asks the orchestrator
// to add to packages/apt-map.tsv, plus the editor-tools font row the script looks up
// by its Arch name. The tree's own map has no colorls group yet, which is a separate
// scenario below: the script must say so rather than offer nothing in silence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'colorls-smoke-'));
const fixture = (body, name) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, body);
    return file;
};
const debian = fixture('ID=debian\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n', 'debian');
const ubuntu = fixture('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\n', 'ubuntu');
const kali = fixture('ID=kali\nID_LIKE=debian\nPRETTY_NAME="Kali GNU/Linux Rolling"\n', 'kali');

const row = (...cells) => cells.join('\t');
const fullMap = fixture([
    row('group', 'arch', 'apt', 'where', 'note'),
    row('colorls', 'ruby', 'ruby', 'both', 'colorls is a Ruby program'),
    row('colorls', '-', 'ruby-dev', 'both', 'clocale is a C extension and needs ruby.h'),
    row('colorls', '-', 'build-essential', 'both', 'ruby-dev brings no compiler'),
    row('editor-tools', 'ttf-jetbrains-mono-nerd', 'fonts-jetbrains-mono', 'both',
        'Debian packages the plain family; the Nerd Font patch is not packaged'),
].join('\n') + '\n', 'apt-map-full.tsv');
// A fixture built for one purpose: to tell the two keyings apart. Every row in fullMap
// is where=both, so map_group_packages returns the same names whether it is asked for
// debian or for kali, and a run on Kali proves only that detect_release did not abort.
// The kali row below is synthetic -- no such rename was found on Kali, where ruby,
// ruby-dev and build-essential are the names on all three releases -- and it exists so
// that asking for the wrong column produces a different answer. release is the archive
// whose names apply (debian for Kali), variant is what is running (kali), and a row
// keyed on the variant replaces the parent's row for the same Arch package.
const keyingMap = fixture([
    row('group', 'arch', 'apt', 'where', 'note'),
    row('colorls', 'ruby', 'ruby', 'both', 'colorls is a Ruby program'),
    row('colorls', 'ruby', 'ruby-kali-fixture', 'kali',
        'fixture only: stands in for a name the variant spells differently'),
    row('colorls', '-', 'ruby-dev', 'both', 'clocale is a C extension and needs ruby.h'),
    row('colorls', '-', 'build-essential', 'both', 'ruby-dev brings no compiler'),
    row('editor-tools', 'ttf-jetbrains-mono-nerd', 'fonts-jetbrains-mono', 'both',
        'Debian packages the plain family; the Nerd Font patch is not packaged'),
].join('\n') + '\n', 'apt-map-keying.tsv');
// \bruby\b matches inside ruby-dev, because \b sits between the y and the hyphen. These
// two say "the apt name ruby, whole", which is what every assertion below needs.
const aptNames = /apt-get install -y ([^\n]*)/;
const installs = (calls, name) => {
    const line = calls.match(aptNames);
    return line !== null && line[1].split(' ').includes(name);
};
// A map with the colorls group and no font row, so the font block is not reached: the
// closing provenance must then not attribute font measurements to a run that never
// mentioned a font.
const noFontMap = fixture([
    row('group', 'arch', 'apt', 'where', 'note'),
    row('colorls', 'ruby', 'ruby', 'both', 'colorls is a Ruby program'),
    row('colorls', '-', 'ruby-dev', 'both', 'clocale is a C extension and needs ruby.h'),
    row('colorls', '-', 'build-essential', 'both', 'ruby-dev brings no compiler'),
].join('\n') + '\n', 'apt-map-nofont.tsv');
// The map as the tree has it today: the font row exists, the colorls group does not.
const noGroupMap = fixture([
    row('group', 'arch', 'apt', 'where', 'note'),
    row('editor-tools', 'ttf-jetbrains-mono-nerd', 'fonts-jetbrains-mono', 'both',
        'Debian packages the plain family; the Nerd Font patch is not packaged'),
].join('\n') + '\n', 'apt-map-nogroup.tsv');

// This machine runs apt and has a real ruby. A PATH built from a named list is the
// only way to be sure the script reached a stub and not the real thing: the zram
// smoke test does the same, for the same reason.
const minimalPath = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colorls-path-'));
    for (const command of ['bash', 'sh', 'awk', 'basename', 'cat', 'chmod', 'chown', 'cmp', 'cp',
        'date', 'dirname', 'env', 'grep', 'id', 'install', 'ln', 'mkdir', 'mktemp', 'readlink',
        'rm', 'sort', 'stat', 'tail', 'unlink']) {
        const source = ['/usr/bin', '/bin', '/usr/sbin'].map((d) => path.join(d, command))
            .find((candidate) => fs.existsSync(candidate));
        assert.ok(source, `This test needs ${command} to exist somewhere ordinary`);
        fs.symlinkSync(source, path.join(dir, command));
    }
    return dir;
};

// gem is the only stub that creates anything: it writes the executable the real gem
// writes, at the path `ruby -e 'print Gem.user_dir'` reports, so the symlink step is
// exercised against a file that exists rather than against a hole.
const stubs = (dir, log, home, {apt = 0, gem = 0, ruby = true} = {}) => {
    fs.writeFileSync(path.join(dir, 'sudo'),
        `#!/bin/sh\necho "sudo $*" >> ${log}\nexec "$@"\n`, {mode: 0o755});
    fs.writeFileSync(path.join(dir, 'apt-get'),
        `#!/bin/sh\necho "apt-get $*" >> ${log}\nexit ${apt}\n`, {mode: 0o755});
    fs.writeFileSync(path.join(dir, 'apt-cache'),
        `#!/bin/sh\necho "apt-cache $*" >> ${log}\nprintf '  Candidate: (none)\\n'\n`, {mode: 0o755});
    const gemDir = path.join(home, '.local/share/gem/ruby/3.3.0');
    fs.writeFileSync(path.join(dir, 'gem'), `#!/bin/sh
echo "gem $*" >> ${log}
if [ ${gem} -eq 0 ]; then
    case " $* " in
        *" install "*) mkdir -p ${gemDir}/bin
            printf '#!/bin/sh\\necho 1.5.0\\n' > ${gemDir}/bin/colorls
            chmod 755 ${gemDir}/bin/colorls ;;
    esac
fi
exit ${gem}
`, {mode: 0o755});
    if (ruby) {
        fs.writeFileSync(path.join(dir, 'ruby'), `#!/bin/sh
echo "ruby $*" >> ${log}
case "$*" in
    *Gem.user_dir*) printf '%s' '${gemDir}' ;;
    *--version*) printf 'ruby 3.3.8 (2025-04-09 revision b200bad6cd) [x86_64-linux-gnu]\\n' ;;
esac
`, {mode: 0o755});
    }
    for (const name of ['curl', 'wget', 'scp', 'ssh', 'gpg', 'tar', 'git', 'pacman', 'yay',
        'dpkg-query', 'fc-list', 'fc-match']) {
        fs.writeFileSync(path.join(dir, name),
            `#!/bin/sh\necho "${name} $*" >> ${log}\nexit 0\n`, {mode: 0o755});
    }
};

const sourceLine = '[[ ! -r "$HOME/.config/shell/colorls.sh" ]] || source "$HOME/.config/shell/colorls.sh"';
const occurrences = (body, needle) => body.split(needle).length - 1;

// One run of the script, with its own home, its own stubs and its own log. bashrc and
// zshrc are seeded with content of their own so an append can be told from a rewrite.
const bashrcSeed = '# the user\'s own bashrc\nexport EDITOR=nvim\n';
const zshrcSeed = '# the user\'s own zshrc\nexport EDITOR=nvim\n';
const colorls = ({args = [], answers = 'n', release = debian, map = fullMap, apt = 0, gem = 0,
    ruby = true, rc = {bashrc: bashrcSeed, zshrc: zshrcSeed}, home = null, times = 30,
    xdgConfig = null, seed = null} = {}) => {
    const reused = home !== null;
    if (!reused) home = fs.mkdtempSync(path.join(os.tmpdir(), 'colorls-home-'));
    const bin = minimalPath();
    const log = path.join(home, 'calls');
    if (reused) fs.rmSync(log, {force: true});
    stubs(bin, log, home, {apt, gem, ruby});
    const bashrc = path.join(home, '.bashrc');
    const zshrc = path.join(home, '.zshrc');
    if (!reused) {
        if (rc.bashrc !== null) fs.writeFileSync(bashrc, rc.bashrc);
        if (rc.zshrc !== null) fs.writeFileSync(zshrc, rc.zshrc);
    }
    // Lets a scenario put something of the user's own in the way before the run:
    // a symlinked rc file, or a hand-written wrapper where the symlink is to go.
    if (seed !== null) seed(home);
    const result = spawnSync('bash', [path.join(root, 'setup-colorls.sh'), ...args], {
        encoding: 'utf8', timeout: 60000, input: `${answers}\n`.repeat(times),
        env: {PATH: bin, HOME: home, DEBIAN_SETUP_OS_RELEASE: release, DEBIAN_SETUP_MAP: map,
            ...(xdgConfig === null ? {} : {XDG_CONFIG_HOME: xdgConfig})},
    });
    const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
    // Deliberately the path the appended source line names, not the path the script
    // chose: a snippet installed anywhere else is a snippet no shell ever loads.
    const snippet = path.join(home, '.config/shell/colorls.sh');
    const link = path.join(home, '.local/bin/colorls');
    const state = path.join(home, '.local/state/debian-desktop-setup');
    return {
        result, home, bin, state,
        calls: read(log) || '',
        snippet, snippetBody: read(snippet),
        bashrcBody: read(bashrc), zshrcBody: read(zshrc),
        link,
        // null means "no symlink was made there", which a plain file of the user's own
        // also is: readlinkSync throws EINVAL on one, so the kind is checked first.
        linkTarget: fs.lstatSync(link, {throwIfNoEntry: false})?.isSymbolicLink()
            ? fs.readlinkSync(link) : null,
        backups: fs.existsSync(state) ? fs.readdirSync(state) : [],
        clean: () => {
            fs.rmSync(bin, {recursive: true, force: true});
            fs.rmSync(home, {recursive: true, force: true});
        },
        keep: () => { fs.rmSync(bin, {recursive: true, force: true}); return home; },
    };
};

// Scenario: --help and the unknown argument.
{
    const help = colorls({args: ['--help']});
    assert.equal(help.result.status, 0, 'The help exits 0');
    assert.match(help.result.stdout, /setup-colorls\.sh/, 'The help names the script');
    assert.match(help.result.stdout, /--dry-run/, 'And the flag that previews it');
    assert.equal(help.calls, '', 'The help runs no command at all');
    help.clean();

    const bad = colorls({args: ['--invalid']});
    assert.equal(bad.result.status, 2, 'An unknown argument is a usage error');
    assert.match(bad.result.stderr, /Unknown argument: --invalid/, 'Named in the error');
    bad.clean();

    const fedora = colorls({args: ['--dry-run'], release: fixture('ID=fedora\n', 'fedora')});
    assert.equal(fedora.result.status, 1, 'An unsupported distribution stops the script');
    assert.match(fedora.result.stderr, /Debian 13 and Ubuntu 26\.04/, 'And says what is supported');
    fedora.clean();
}

// Scenario: --dry-run installs nothing and writes nothing, with every prompt accepted.
{
    const preview = colorls({args: ['--dry-run'], answers: 'y'});
    assert.equal(preview.result.status, 0, preview.result.stderr);
    assert.doesNotMatch(preview.calls, /apt-get install/, 'A preview installs no packages');
    assert.doesNotMatch(preview.calls, /^gem install/m, 'A preview installs no gem');
    assert.doesNotMatch(preview.calls, /^curl |^wget |^git clone/m, 'And fetches nothing');
    assert.equal(preview.snippetBody, null, 'A preview writes no shell snippet');
    assert.equal(preview.linkTarget, null, 'A preview creates no symlink');
    assert.equal(preview.bashrcBody, bashrcSeed, 'A preview leaves ~/.bashrc byte for byte');
    assert.equal(preview.zshrcBody, zshrcSeed, 'And ~/.zshrc too');
    assert.deepEqual(preview.backups, [], 'A preview creates no backup directory');
    // The commands are still shown: a preview that prints nothing is not a preview.
    assert.match(preview.result.stdout, /gem install --user-install --no-document colorls/,
        'The preview prints the gem command it would run');
    // Anchored to the block the package preview prints, and quoting the order the
    // script really prints: map_group_packages pipes through sort -u, so the names come
    // out alphabetically. A loose match was satisfied by the explanatory prose that
    // follows it, which left the preview itself free to stop naming the packages.
    assert.match(preview.result.stdout, /\ncolorls packages\n {2}build-essential ruby ruby-dev\n/,
        'And the apt packages it would install, named in the preview block itself');
    preview.clean();
}

// Scenario: the shell snippet is installed to ~/.config/shell/colorls.sh.
{
    const run = colorls({answers: 'y'});
    assert.equal(run.result.status, 0, run.result.stderr + run.result.stdout);
    assert.equal(run.snippetBody, fs.readFileSync(path.join(root, 'config/shell/colorls.sh'), 'utf8'),
        'The snippet installed is the repository\'s own file, unmodified');
    assert.match(run.snippetBody, /alias ls='colorls -l'/, 'ls = colorls -l');
    assert.match(run.snippetBody, /alias ll='colorls -la'/, 'll = colorls -la');
    assert.match(run.snippetBody, /alias la='colorls -A'/, 'la = colorls -A');
    assert.equal(fs.statSync(run.snippet).mode & 0o777, 0o644, 'Installed 644, as a sourced file');
    // The route the recon proved: apt for the toolchain, the user gem for colorls itself.
    assert.ok(installs(run.calls, 'ruby'), 'ruby comes from apt');
    assert.ok(installs(run.calls, 'ruby-dev'), 'and the headers clocale needs');
    assert.ok(installs(run.calls, 'build-essential'), 'and the compiler it needs');
    assert.match(run.calls, /^gem install --user-install --no-document colorls$/m,
        'colorls itself comes from the user gem path, never from apt');
    assert.doesNotMatch(run.calls, /ruby-colorls/, 'No archive packages colorls');
    assert.doesNotMatch(run.calls, /unicode-display_width/,
        'The Arch unicode-display_width pin must not be carried over');
    // The gem bin directory is on no user's PATH, so the executable is linked where one is.
    assert.equal(run.linkTarget, path.join(run.home, '.local/share/gem/ruby/3.3.0/bin/colorls'),
        'The symlink points at the executable the gem actually wrote');
    run.clean();
}

// Scenario: XDG_CONFIG_HOME must not move the alias file away from the one path the
// wired source line can name. This script has no freedom here, and the agreement is
// with three files it may not change: config/shell/colorls.sh is a shared file the
// drift guard compares byte for byte against the Arch repository, zsh/zshrc line 60
// carries the same literal `$HOME/.config/shell/colorls.sh` source line that the Arch
// zshrc does, and install.sh line 21 sets target_config to "$HOME/.config" with no XDG
// seam at all. So the assertion is the end-to-end one: whatever XDG_CONFIG_HOME says,
// the file the appended line sources is there and holds the aliases.
{
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'colorls-xdg-'));
    const run = colorls({answers: 'y', xdgConfig: xdg});
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.equal(run.snippetBody,
        fs.readFileSync(path.join(root, 'config/shell/colorls.sh'), 'utf8'),
        'With XDG_CONFIG_HOME set, the aliases are still at the path the wired line sources');
    assert.equal(occurrences(run.bashrcBody, sourceLine), 1, 'And ~/.bashrc sources it');
    // The failure this guards against: the file installed under XDG while the line
    // appended to the rc files names ~/.config, so ls, ll and la are never defined and
    // the run still reports the wiring as done.
    assert.equal(fs.existsSync(path.join(xdg, 'shell/colorls.sh')), false,
        'Nothing is installed under XDG_CONFIG_HOME, which no rc file in this repository reads');
    assert.match(run.result.stdout,
        new RegExp(`${run.snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is the alias file`),
        'And the path the run names is the path it wrote');
    fs.rmSync(xdg, {recursive: true, force: true});
    run.clean();
}

// Scenario: wire_rc appends the source line exactly once, and not again on a re-run.
{
    const first = colorls({answers: 'y'});
    assert.equal(first.result.status, 0, first.result.stderr);
    assert.equal(occurrences(first.bashrcBody, sourceLine), 1,
        'The guarded source line is appended to ~/.bashrc exactly once');
    assert.ok(first.bashrcBody.startsWith(bashrcSeed),
        'Appended, not rewritten: the user\'s own bashrc is still in front of it');
    assert.equal(occurrences(first.zshrcBody, sourceLine), 1,
        'And to a ~/.zshrc that does not already carry it');
    const home = first.keep();

    const second = colorls({answers: 'y', home});
    assert.equal(second.result.status, 0, second.result.stderr);
    assert.equal(occurrences(second.bashrcBody, sourceLine), 1,
        'A second run must not append the line again');
    assert.equal(occurrences(second.zshrcBody, sourceLine), 1, 'In either file');
    // Nor does a second run copy and relink a symlink that already points where this
    // step would point it: install_file leaves an identical file alone and says so, and
    // a re-run of this script should be as quiet. Without this, every run would drop
    // another copy of the gem executable into a new backup directory.
    assert.match(second.result.stdout, /\.local\/bin\/colorls already points at .*gem\/ruby/,
        'A link that is already correct is left as it is');
    assert.equal(second.backups.length, 1,
        'And the re-run adds no second backup directory, having replaced nothing');
    second.clean();

    // The bundled zshrc already carries the line, so Zsh is wired before this script
    // runs and must be left alone -- the repository ships no bashrc, which is why Bash
    // is the one that needs wiring.
    const bundled = colorls({answers: 'y',
        rc: {bashrc: bashrcSeed, zshrc: `${zshrcSeed}${sourceLine}\n`}});
    assert.equal(bundled.result.status, 0, bundled.result.stderr);
    assert.equal(bundled.zshrcBody, `${zshrcSeed}${sourceLine}\n`,
        'A zshrc that already sources the snippet is not touched at all');
    assert.equal(occurrences(bundled.bashrcBody, sourceLine), 1, 'Bash is still wired');
    bundled.clean();

    // No ~/.bashrc at all is not an error, and nothing is created behind the user's back.
    const noBashrc = colorls({answers: 'y', rc: {bashrc: null, zshrc: zshrcSeed}});
    assert.equal(noBashrc.result.status, 0, noBashrc.result.stderr);
    assert.equal(noBashrc.bashrcBody, null, 'A missing rc file is left missing');
    noBashrc.clean();
}

// Scenario: the backup is taken before either rc file is modified.
{
    const run = colorls({answers: 'y'});
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.equal(run.backups.length, 1, 'One backup directory for the run');
    const dir = path.join(run.state, run.backups[0]);
    assert.match(run.backups[0], /^colorls-\d{8}-\d{6}-\d+$/,
        'Named colorls-<timestamp>-<pid> under ~/.local/state/debian-desktop-setup');
    for (const [name, seed] of [['.bashrc', bashrcSeed], ['.zshrc', zshrcSeed]]) {
        const backup = path.join(dir, name);
        assert.ok(fs.existsSync(backup), `${name} is backed up: ${backup}`);
        // The copy holds the file as it was, without the appended line. That is the
        // proof of order: a backup taken after the append would carry the append.
        assert.equal(fs.readFileSync(backup, 'utf8'), seed,
            `The backup of ${name} predates the append`);
    }
    assert.match(run.result.stdout, /\.local\/state\/debian-desktop-setup\/colorls-/,
        'The summary names where the backups went');
    run.clean();
}

// Scenario: a dotfiles-managed ~/.bashrc, which is a symbolic link into a checkout as
// stow and chezmoi leave it. The backup has to hold the file's CONTENT: a copied link
// points at the very file the append then modifies, so reading that "backup" gives the
// modified file back and the content as it was exists nowhere, while the run says
// "the file as it was is in <backup>".
{
    const linked = (home) => {
        fs.mkdirSync(path.join(home, 'dotfiles'), {recursive: true});
        fs.writeFileSync(path.join(home, 'dotfiles/bashrc'), bashrcSeed);
        fs.symlinkSync(path.join(home, 'dotfiles/bashrc'), path.join(home, '.bashrc'));
    };
    const run = colorls({answers: 'y', rc: {bashrc: null, zshrc: zshrcSeed}, seed: linked});
    assert.equal(run.result.status, 0, run.result.stderr);
    const backup = path.join(run.state, run.backups[0], '.bashrc');
    assert.equal(fs.lstatSync(backup).isSymbolicLink(), false,
        'The backup of a symlinked rc file is a real file, not a second copy of the link');
    assert.equal(fs.readFileSync(backup, 'utf8'), bashrcSeed,
        'And it holds the content as it was, without the line this run appended');
    // The append itself still goes through the link into the checkout, which is what a
    // dotfiles user wants: breaking the link would detach the file from what manages it.
    assert.ok(fs.lstatSync(path.join(run.home, '.bashrc')).isSymbolicLink(),
        '~/.bashrc is still the user\'s own link, not replaced by a plain file');
    assert.equal(occurrences(fs.readFileSync(path.join(run.home, 'dotfiles/bashrc'), 'utf8'),
        sourceLine), 1, 'And the line landed in the file the link points at, exactly once');
    assert.match(run.result.stdout, /symbolic link/,
        'The run says the rc file is a link, so the reader knows which file was appended to');
    run.clean();
}

// Scenario: a wrapper of the user's own already at ~/.local/bin/colorls. ln -sfn
// replaces anything at that path, so the contents have to be copied first and the
// prompt has to say that a file is about to be replaced.
{
    const wrapper = '#!/bin/sh\n# my own colorls wrapper\nexec /opt/colorls/bin/colorls "$@"\n';
    const seedWrapper = (home) => {
        fs.mkdirSync(path.join(home, '.local/bin'), {recursive: true});
        fs.writeFileSync(path.join(home, '.local/bin/colorls'), wrapper, {mode: 0o755});
    };
    const run = colorls({answers: 'y', seed: seedWrapper});
    assert.equal(run.result.status, 0, run.result.stderr);
    const backup = path.join(run.state, run.backups[0], 'colorls');
    assert.ok(fs.existsSync(backup),
        `The wrapper that was in the way is copied into the backup directory: ${backup}`);
    assert.equal(fs.readFileSync(backup, 'utf8'), wrapper,
        'Byte for byte, so the user can put it back');
    assert.equal(run.linkTarget, path.join(run.home, '.local/share/gem/ruby/3.3.0/bin/colorls'),
        'And only then is the symlink made');
    assert.match(run.result.stdout, /already a file of your own at .*\.local\/bin\/colorls/,
        'The run says a file of the user\'s own is in the way');
    assert.match(run.result.stdout, /copied into the backup directory before it is replaced/,
        'And says what answering y does to it, before the question is asked');
    // The prompt itself cannot be captured here: bash prints a read -p prompt only when
    // the input is a terminal, and this harness feeds answers down a pipe. So the
    // wording is asserted where it lives. install_file asks "Back up and replace
    // <path>?" for every file this repository writes; a symlink over a file of the
    // user's own is the same question and must not be asked as "Link that executable".
    const script = fs.readFileSync(path.join(root, 'setup-colorls.sh'), 'utf8');
    assert.match(script, /prompt="Back up and replace \$link with a link to the gem executable\?"/,
        'The prompt for a path that already holds something says it is replaced');
    run.clean();

    // And the preview of that same path writes nothing: the backup it would take is a
    // command like any other, so it is shown and not run.
    const preview = colorls({args: ['--dry-run'], answers: 'y', seed: seedWrapper});
    assert.equal(preview.result.status, 0, preview.result.stderr);
    assert.equal(fs.readFileSync(path.join(preview.home, '.local/bin/colorls'), 'utf8'), wrapper,
        'A preview leaves the wrapper that is in the way byte for byte');
    assert.deepEqual(preview.backups, [], 'And copies it nowhere');
    assert.match(preview.result.stdout, /cp -aL -- .*\.local\/bin\/colorls/,
        'While still showing the copy it would take');
    assert.doesNotMatch(preview.result.stdout, /What was at .*\.local\/bin\/colorls is in/,
        'And claiming no copy it did not take');
    preview.clean();
}

// Scenario: declining every prompt leaves the machine untouched.
{
    const declined = colorls({answers: 'n'});
    assert.equal(declined.result.status, 0, declined.result.stderr);
    assert.doesNotMatch(declined.calls, /apt-get install/, 'Declining installs no packages');
    assert.doesNotMatch(declined.calls, /^gem install/m, 'And no gem');
    assert.equal(declined.snippetBody, null, 'And writes no snippet');
    assert.equal(declined.linkTarget, null, 'And no symlink');
    assert.equal(declined.bashrcBody, bashrcSeed, 'And leaves ~/.bashrc exactly as it was');
    assert.equal(declined.zshrcBody, zshrcSeed, 'And ~/.zshrc too');
    assert.deepEqual(declined.backups, [], 'And backs nothing up, because nothing was replaced');
    assert.match(declined.result.stdout, /Left alone at your request/,
        'The summary names what was declined rather than claiming success');
    declined.clean();
}

// Scenario: the prose is the Debian reason, not the pacman one, and claims only what
// a container could show.
{
    const run = colorls({args: ['--dry-run'], answers: 'y'});
    assert.match(run.result.stdout, /Unable to locate package ruby-colorls/,
        'Say why apt is not the route, in apt\'s own words');
    assert.match(run.result.stdout, /clocale/, 'Name the C extension that needs the toolchain');
    assert.match(run.result.stdout, /ruby\.h|header/, 'And what ruby alone is missing');
    assert.match(run.result.stdout, /compiler/i, 'And what ruby-dev alone is missing');
    assert.match(run.result.stdout, /unicode-display_width/,
        'Say once that the Arch pin was tested here and is unnecessary, so nobody re-adds it');
    assert.match(run.result.stdout, /not needed|unnecessary|does not apply/i, 'In those terms');
    assert.doesNotMatch(run.result.stdout, /pacman|yay|AUR/, 'No pacman reasons on a Debian machine');
    // PATH, honestly: the gem bin directory is on no user's PATH, and ~/.local/bin is
    // only added at login, so this run cannot claim colorls is reachable now.
    assert.match(run.result.stdout, /\.local\/bin/, 'Name the directory that is on PATH');
    assert.match(run.result.stdout, /new (login|shell)|log out|next login/i,
        'And say a new login is what puts it there');
    // The glyphs were never rendered: no container has a font renderer or a display.
    assert.match(run.result.stdout, /DejaVu Sans/, 'Say what fontconfig substitutes instead');
    assert.match(run.result.stdout, /not .*rendered|never rendered|no .*glyph was/i,
        'And that no test rendered a glyph');
    assert.match(run.result.stdout, /debian:stable-slim|container/,
        'And where the figures were read, since this script runs somewhere else');
    // The closing provenance has to agree with the caveat in the body: the fontconfig
    // check was run on Debian only, so no sentence may place the font figures in all
    // three images. The sentence that did -- "Every figure quoted above (the apt
    // messages, the gem versions, the font coverage) was read in ... debian:stable-slim,
    // ubuntu:latest and kalilinux/kali-rolling" -- contradicted it in the same run.
    assert.match(run.result.stdout, /That fontconfig check was run on Debian only/,
        'The body says which image the fontconfig answer came from');
    assert.match(run.result.stdout, /fontconfig answer[\s\S]{0,160}?Debian alone/,
        'And the closing provenance says the same, instead of widening it to three images');
    assert.doesNotMatch(run.result.stdout, /Every figure quoted above/,
        'No sentence claims every figure, the font coverage included, was read in all three');
    run.clean();

    // With no font row in the map the font block is never reached, and a run that never
    // mentioned a font must not close by saying where its font figures were measured.
    const noFont = colorls({args: ['--dry-run'], answers: 'y', map: noFontMap});
    assert.equal(noFont.result.status, 0, noFont.result.stderr);
    assert.doesNotMatch(noFont.result.stdout, /DejaVu Sans|Nerd|fontconfig|dpkg -L/,
        'A run with no font row quotes no font figure, in the body or in the summary');
    assert.match(noFont.result.stdout, /debian:stable-slim/,
        'The figures it did quote are still sourced');
    noFont.clean();
}

// Scenario: all three distributions get the same route, and the map is where the
// package names come from.
{
    // Asserted against keyingMap, whose kali row makes the two columns disagree: with
    // the archive's names (release) Kali installs the variant's ruby-kali-fixture and
    // not the parent's ruby, and asking the map for the variant instead would install
    // both. Each case states the whole apt name list, so no change to it is invisible.
    const expected = {
        Debian: ['build-essential', 'ruby', 'ruby-dev'],
        Ubuntu: ['build-essential', 'ruby', 'ruby-dev'],
        Kali: ['build-essential', 'ruby-dev', 'ruby-kali-fixture'],
    };
    for (const [name, release] of [['Debian', debian], ['Ubuntu', ubuntu], ['Kali', kali]]) {
        const run = colorls({answers: 'y', release, map: keyingMap});
        assert.equal(run.result.status, 0, `${name}: ${run.result.stderr}`);
        assert.match(run.calls, /^gem install --user-install --no-document colorls$/m,
            `${name} takes the same gem route`);
        const line = run.calls.match(aptNames);
        assert.ok(line, `${name} runs one apt-get install`);
        assert.deepEqual(line[1].split(' ').filter((n) => n !== '').sort(), expected[name],
            `${name} installs exactly the names its own column of the map carries`);
        run.clean();
    }
    // Said once more on its own, because this is the swap the scenario exists to catch:
    // the variant's row replaces the parent's, it does not join it.
    const onKali = colorls({answers: 'y', release: kali, map: keyingMap});
    assert.equal(onKali.result.status, 0, onKali.result.stderr);
    assert.ok(installs(onKali.calls, 'ruby-kali-fixture'),
        'On Kali the variant row is used');
    assert.ok(!installs(onKali.calls, 'ruby'),
        'And it replaces the parent row rather than being offered alongside it');
    onKali.clean();
    // The tree's map has no colorls group yet. The script must say so and name the
    // three packages, rather than silently offering an empty install.
    const noGroup = colorls({answers: 'y', map: noGroupMap});
    assert.equal(noGroup.result.status, 0, noGroup.result.stderr);
    assert.doesNotMatch(noGroup.calls, /apt-get install -y ruby/, 'No empty apt transaction');
    assert.match(noGroup.result.stdout, /no colorls group|colorls group/i,
        'Say the map carries no colorls group');
    assert.match(noGroup.result.stdout, /ruby ruby-dev build-essential/,
        'And name the three packages the reader needs anyway');
    noGroup.clean();
}

// A failed apt-get update must not be followed by an install against stale lists, and
// a failed gem install must leave the rest of the script running: the snippet guards
// itself on `command -v colorls`, so a failed install leaves ls exactly as it was.
{
    const broken = colorls({answers: 'y', apt: 100});
    assert.equal(broken.result.status, 1, 'A failed step makes the whole script fail');
    assert.match(broken.result.stdout, /Steps that failed:/, 'The failure is named');
    assert.doesNotMatch(broken.calls, /apt-get install/,
        'A failed update must not be followed by an install against stale lists');
    broken.clean();

    const noGem = colorls({answers: 'y', gem: 1});
    assert.equal(noGem.result.status, 1, 'A failed gem install is a failure');
    // Inside the "Steps that failed:" block, not anywhere on stdout: run() echoes every
    // command it is given, successes included, so a bare /gem install/ was satisfied by
    // that echo and would have stayed green had attempt been replaced by run ... || true.
    assert.match(noGem.result.stdout,
        /Steps that failed:\n {2}gem install --user-install --no-document colorls\n/,
        'The failed gem install is recorded as a failed step, not merely echoed');
    assert.equal(noGem.linkTarget, null, 'And nothing is linked to an executable that is absent');
    assert.equal(occurrences(noGem.bashrcBody, sourceLine), 1,
        'The aliases are still wired: the snippet guards itself on command -v colorls');
    noGem.clean();
}

fs.rmSync(scratch, {recursive: true, force: true});
console.log('setup-colorls-smoke: all checks passed');
