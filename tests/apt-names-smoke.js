// SPDX-License-Identifier: GPL-3.0-only
// Resolves every mapped apt name inside the real Debian and Ubuntu indexes.
// Slow (it pulls images), so it runs only when asked for explicitly.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (process.env.DEBIAN_SETUP_CONTAINER_TESTS !== '1') {
    console.log('apt-names-smoke: skipped, set DEBIAN_SETUP_CONTAINER_TESTS=1 to run it');
    process.exit(0);
}
const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {encoding: 'utf8'});
assert.equal(docker.status, 0, 'DEBIAN_SETUP_CONTAINER_TESTS=1 needs a usable docker: ' + docker.stderr);

const rows = fs.readFileSync(path.join(root, 'packages/apt-map.tsv'), 'utf8').trim().split('\n')
    .slice(1).map((line) => line.split('\t'));
const wanted = (release) => [...new Set(rows
    .filter(([, , apt, where]) => apt !== '-' && (where === 'both' || where === release))
    .map(([, , apt]) => apt))].sort();

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apt-names-'));
try {
    for (const [release, image] of [['debian', 'debian:stable-slim'], ['ubuntu', 'ubuntu:latest']]) {
        const list = path.join(scratch, release + '.txt');
        fs.writeFileSync(list, wanted(release).join('\n') + '\n');
        const result = spawnSync('docker', ['run', '--rm', '-v', `${list}:/list.txt:ro`, image, 'sh', '-c',
            'apt-get update -qq >/dev/null 2>&1 || { echo "apt-get update failed"; exit 1; }\n' +
            'while read -r p; do\n' +
            '  v=$(apt-cache policy "$p" 2>/dev/null | awk "/Candidate:/{print \\$2; exit}")\n' +
            '  case "$v" in ""|"(none)") printf "MISSING %s\\n" "$p" ;; esac\n' +
            'done < /list.txt\n' +
            'apt-get install --simulate $(tr "\\n" " " < /list.txt) >/dev/null || echo "SIMULATE FAILED"'],
            {encoding: 'utf8', timeout: 900000});
        assert.equal(result.status, 0, `${image}: ${result.stderr}`);
        assert.doesNotMatch(result.stdout, /MISSING/, `${image} cannot resolve: ${result.stdout}`);
        assert.doesNotMatch(result.stdout, /SIMULATE FAILED/, `${image} cannot install the set together`);
        console.log(`apt-names-smoke: ${image} resolves all ${wanted(release).length} packages`);
    }
} finally {
    fs.rmSync(scratch, {recursive: true, force: true});
}
console.log('apt-names-smoke: all checks passed');
