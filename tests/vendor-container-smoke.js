// SPDX-License-Identifier: GPL-3.0-only
// Runs the real add_vendor_repo against the real vendor hosts, inside a container.
// Gated: needs Docker and the network. This is the only test that can notice a vendor
// rotating a signing key, moving a suite, or publishing a key URL this repository
// guessed wrong -- every other test here stubs curl by design.
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (process.env.DEBIAN_SETUP_CONTAINER_TESTS !== '1') {
    console.log('vendor-container-smoke: skipped (set DEBIAN_SETUP_CONTAINER_TESTS=1 to run)');
    process.exit(0);
}

// The helper is sourced from the mounted bundle and called exactly as the scripts call
// it, so what is under test is the shipped code and the shipped strings. dry_run is
// false: this is a throwaway container, and a preview would prove nothing about a host.
const script = (release, suite) => `
set -u
apt-get update -qq >/dev/null 2>&1
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    ca-certificates curl gpg >/dev/null 2>&1
# The helper runs privileged commands through sudo and this container is already root,
# so sudo is a pass-through rather than a package: what is under test is the helper's
# logic against live hosts, not privilege handling.
mkdir -p /usr/local/bin
printf '#!/bin/sh\nexec "$@"\n' > /usr/local/bin/sudo
chmod 755 /usr/local/bin/sudo
dry_run=false; target_config=/tmp/config; backup_dir=/tmp/backup
. /bundle/lib/common.sh
keyring() { printf '/etc/apt/keyrings/%s.gpg' "$1"; }

# Each subject: id, key URL and sources line, taken from the scripts themselves rather
# than retyped here, so a URL that changes in a script changes what this test checks.
url() { grep -ohE 'https?://[A-Za-z0-9._~:/?#@!$&+,;=%-]+' "/bundle/$1" \
    | grep -E "$2" | head -1; }

chrome_key=$(url setup-chrome.sh 'linux_signing_key')
dbeaver_key=$(url setup-dbeaver.sh 'gpg.key|dbeaver.*key')
onlyoffice_key=$(url setup-onlyoffice.sh 'GPG-KEY')
dropbox_key=$(url setup-dropbox.sh 'rpm-public-key')
docker_key="https://download.docker.com/linux/${release}/gpg"

report() { printf 'SUBJECT %s %s\\n' "$1" "$2"; }

check() {   # id  key url  sources line  package
    printf '\\n=== %s ===\\nkey: %s\\n' "$1" "$2"
    if add_vendor_repo "$1" "$2" "$3" "$4"; then
        report "$1" ok
    else
        report "$1" FAILED
    fi
}

check google-chrome "$chrome_key" \
  "deb [arch=amd64 signed-by=$(keyring google-chrome)] https://dl.google.com/linux/chrome/deb/ stable main" \
  google-chrome-stable
check dbeaver "$dbeaver_key" \
  "deb [signed-by=$(keyring dbeaver)] https://dbeaver.io/debs/dbeaver-ce /" \
  dbeaver-ce
check dropbox "$dropbox_key" \
  "deb [arch=amd64 signed-by=$(keyring dropbox)] https://linux.dropbox.com/${release} ${suite} main" \
  dropbox
check docker "$docker_key" \
  "deb [arch=amd64 signed-by=$(keyring docker)] https://download.docker.com/linux/${release} ${suite} stable" \
  docker-ce

# ONLYOFFICE with its pin, because the pin is the part no other test can watch work:
# the vendor's 308 stanzas over 71 names outrank the distribution's ttf-mscorefonts.
printf 'Package: *\\nPin: origin download.onlyoffice.com\\nPin-Priority: 100\\n' > /tmp/pin
check onlyoffice "$onlyoffice_key" \
  "deb [arch=amd64 signed-by=$(keyring onlyoffice)] https://download.onlyoffice.com/repo/debian squeeze main" \
  onlyoffice-desktopeditors /tmp/pin
printf 'MSCOREFONTS %s\\n' "$(apt-cache policy -- ttf-mscorefonts-installer 2>/dev/null \
    | awk '/Candidate:/{print $2; exit}')"
printf 'MSCOREFONTS-ORIGIN %s\\n' "$(apt-cache policy -- ttf-mscorefonts-installer 2>/dev/null \
    | grep -c 'download.onlyoffice.com')"

# The shared update must still be clean afterwards: a sources file this run left behind
# that apt cannot read is the one outcome install.sh cannot survive.
apt-get update >/tmp/update.log 2>&1
printf 'SHARED-UPDATE %s\\n' "$?"
grep -E '^(E|W):' /tmp/update.log | head -5 || true
printf 'FAILED-STEPS %s\\n' "\${failed[*]:-none}"
`;

// The suite each vendor publishes for this release, proved in the recon: a codename
// the vendor does not carry gives a repository that verifies and offers nothing.
for (const [image, release, suite] of [['debian:trixie', 'debian', 'trixie'],
    ['ubuntu:26.04', 'ubuntu', 'resolute'],
    // Kali passes Debian's own release and suite, because that is what detect_release
    // resolves it to and therefore what the scripts send: this run is what makes the
    // README's claim about Kali an observation rather than an assumption.
    ['kalilinux/kali-rolling', 'debian', 'trixie']]) {
    const result = spawnSync('docker', ['run', '--rm', '-v', `${root}:/bundle:ro`,
        image, 'bash', '-c', script(release, suite)], {encoding: 'utf8', timeout: 2400000});
    const output = `${result.stdout}\n${result.stderr}`;

    // Every subject must verify. A failure here is a real-world change -- a rotated key,
    // a moved suite, a key URL this repository guessed -- not a flaky test, so it names
    // the subject and prints what the helper said.
    for (const subject of ['google-chrome', 'dbeaver', 'dropbox', 'docker', 'onlyoffice']) {
        assert.match(output, new RegExp(`SUBJECT ${subject} ok`),
            `${image}: ${subject} did not verify against its own host:\n${output}`);
    }
    // The candidate must come from the vendor, which is what add_vendor_repo now proves;
    // this pins that the message says so, so a weakened helper cannot pass quietly.
    for (const host of ['dl.google.com', 'dbeaver.io', 'linux.dropbox.com',
        'download.docker.com', 'download.onlyoffice.com']) {
        assert.match(output, new RegExp(`is live: \\S+ \\S+, from ${host.replace(/\./g, '\\.')}`),
            `${image}: nothing was verified as coming from ${host}:\n${output}`);
    }
    assert.match(output, /FAILED-STEPS none/, `${image}: a step failed:\n${output}`);

    // The pin: ONLYOFFICE's repository carries ttf-mscorefonts-installer too, and the
    // distribution's must stay the candidate.
    assert.match(output, /MSCOREFONTS-ORIGIN [1-9]/,
        `${image}: ONLYOFFICE did not offer ttf-mscorefonts-installer, so the pin proves nothing now:\n${output}`);
    const fonts = output.match(/MSCOREFONTS (\S+)/);
    assert.ok(fonts && /^3\.8/.test(fonts[1]),
        `${image}: the pin did not keep the distribution's ttf-mscorefonts-installer: ${fonts && fonts[1]}\n${output}`);

    // And apt is still usable, which is the whole point of the cleanup paths.
    assert.match(output, /SHARED-UPDATE 0/, `${image}: apt-get update is broken now:\n${output}`);
    assert.doesNotMatch(output, /^E:/m, `${image}: apt reported an error:\n${output}`);
    console.log(`vendor-container-smoke: ${image} verified all five vendor repositories`);
}

console.log('vendor-container-smoke: all checks passed');
