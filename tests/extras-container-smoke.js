// SPDX-License-Identifier: GPL-3.0-only
// The phase 4 facts that only a real system can answer, inside both releases. Gated:
// needs Docker. Everything here is a claim some script's behaviour depends on and no
// stub can confirm: what the zram package actually ships, which sshd unit the SSH
// package restarts, how sshd resolves two drop-ins, and whether the Tor signing key
// this repository names still has the fingerprint it hard-codes.
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');

if (process.env.DEBIAN_SETUP_CONTAINER_TESTS !== '1') {
    console.log('extras-container-smoke: skipped (set DEBIAN_SETUP_CONTAINER_TESTS=1 to run)');
    process.exit(0);
}

const script = `
set -u
apt-get update -qq >/dev/null 2>&1
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    ca-certificates curl gpg systemd-zram-generator openssh-server conky-std >/dev/null 2>&1

echo "=== what systemd-zram-generator ships ==="
# setup-zram.sh writes /etc/systemd/zram-generator.conf whole, and the generator reads
# the first file it finds rather than merging. That is only safe while the shipped file
# carries no options of its own, so this is the fact the script depends on.
printf 'ZRAM-SHIPPED-KEYS %s\\n' "$(grep -cE '^[a-z-]+ *=' /usr/lib/systemd/zram-generator.conf || true)"
printf 'ZRAM-SHIPPED-SECTION %s\\n' "$(grep -c '^\\[zram0\\]' /usr/lib/systemd/zram-generator.conf || true)"
printf 'ZRAM-ETC-EXISTS %s\\n' "$([ -e /etc/systemd/zram-generator.conf ] && echo yes || echo no)"

echo "=== which sshd unit this release uses ==="
# setup-hardening.sh restarts one or the other, and restarting the wrong one applies
# nothing: Debian ships ssh.service, Ubuntu socket-activates ssh.socket.
for unit in ssh.service ssh.socket; do
    printf 'UNIT %s %s\\n' "$unit" "$(systemctl is-enabled "$unit" 2>&1 | head -1)"
done
printf 'UNIT-FILES %s\\n' "$(ls /lib/systemd/system/ssh.socket /lib/systemd/system/ssh.service 2>/dev/null | tr '\\n' ' ')"

echo "=== how sshd resolves two drop-ins ==="
# The reason setup-hardening.sh reads the effective configuration back instead of
# trusting its own file: sshd keeps the FIRST value it obtains, and the Include is at
# the top of sshd_config, so a lower-numbered drop-in wins.
printf 'Include position: %s\\n' "$(grep -n '^Include' /etc/ssh/sshd_config | head -1)"
mkdir -p /etc/ssh/sshd_config.d
printf 'PasswordAuthentication yes\\n' > /etc/ssh/sshd_config.d/50-other.conf
printf 'PasswordAuthentication no\\n'  > /etc/ssh/sshd_config.d/99-hardening.conf
# tolower on the keyword, because OpenSSH 9 lowercases every keyword in this output
# and OpenSSH 10 prints it in CamelCase: matching one spelling reads empty on the other,
# and an empty read-back is indistinguishable from a passing one.
reported() { sshd -T 2>/dev/null | awk 'tolower($1)=="passwordauthentication"{print tolower($2); exit}'; }
printf 'DROPIN-LOWER-WINS %s\\n' "$(reported)"
rm -f /etc/ssh/sshd_config.d/50-other.conf
printf 'DROPIN-ALONE %s\\n'      "$(reported)"
printf 'SSHD-VERSION %s\\n' "$(sshd -V 2>&1 | head -1)"
# How this release spells it, which is what setup-hardening.sh has to read back.
printf 'SSHD-KEYWORD %s\\n' "$(sshd -T 2>/dev/null | awk 'tolower($1)=="passwordauthentication"{print $1; exit}')"
# And that the drop-in this repository writes is one sshd accepts.
sshd -t -f /etc/ssh/sshd_config.d/99-hardening.conf >/dev/null 2>&1
printf 'DROPIN-VALIDATES %s\\n' "$?"
rm -f /etc/ssh/sshd_config.d/99-hardening.conf

echo "=== the conky package name ==="
# conky is a pure virtual package, so the map names conky-std; if that stopped being
# true the whole group would fail one apt transaction.
printf 'CONKY-STD %s\\n' "$(conky --version 2>/dev/null | head -1)"

echo "=== the Tor signing key this repository names ==="
# setup-tor-browser.sh carries this fingerprint as a literal and verifies against it
# offline. If the key moved or the fingerprint changed, every staged install fails with
# a signature error and no other test here would say why.
want=$(grep -oE '^fingerprint=[0-9A-F]+' /bundle/setup-tor-browser.sh | cut -d= -f2)
printf 'TOR-WANT %s\\n' "$want"
if curl -fsS --max-time 60 -o /tmp/tor.asc \
    "https://keys.openpgp.org/vks/v1/by-fingerprint/$want"; then
    printf 'TOR-KEY-BYTES %s\\n' "$(wc -c < /tmp/tor.asc)"
    printf 'TOR-FINGERPRINT %s\\n' "$(gpg --show-keys --with-colons /tmp/tor.asc 2>/dev/null \
        | awk -F: '/^fpr:/{print $10; exit}')"
else
    printf 'TOR-KEY-BYTES unreachable\\n'
fi
`;

// Kali takes the Debian answer to every one of these questions, and this is where
// that stops being an assumption: the shipped zram stanza, the sshd unit name and the
// conky package are all facts about an archive a suite ahead of Debian 13.
const hardening = fs.readFileSync(path.join(root, 'setup-hardening.sh'), 'utf8');
for (const image of ['debian:trixie', 'ubuntu:26.04', 'kalilinux/kali-rolling']) {
    const result = spawnSync('docker', ['run', '--rm', '-v', `${root}:/bundle:ro`,
        image, 'bash', '-c', script], {encoding: 'utf8', timeout: 1800000});
    const output = `${result.stdout}\n${result.stderr}`;
    const value = (key) => (output.match(new RegExp(`^${key} (.*)$`, 'm')) || [])[1];

    // zram: the shipped file must carry the section and no options, or writing it whole
    // would discard settings the package chose.
    assert.equal(value('ZRAM-SHIPPED-SECTION'), '1',
        `${image}: the shipped zram-generator.conf has no [zram0]:\n${output}`);
    assert.equal(value('ZRAM-SHIPPED-KEYS'), '0',
        `${image}: the shipped zram-generator.conf now carries options of its own, so `
        + `setup-zram.sh would discard them by replacing the file:\n${output}`);
    assert.equal(value('ZRAM-ETC-EXISTS'), 'no',
        `${image}: the package now ships /etc/systemd/zram-generator.conf:\n${output}`);

    // sshd: the unit this release actually has, and the precedence the hardening script
    // reads the configuration back because of.
    const units = value('UNIT-FILES') || '';
    const expected = image.startsWith('ubuntu') ? 'ssh.socket' : 'ssh.service';
    assert.ok(units.includes(expected),
        `${image}: expected ${expected} to exist; got ${units}\n${output}`);
    assert.equal(value('DROPIN-LOWER-WINS'), 'yes',
        `${image}: a lower-numbered drop-in no longer wins, so setup-hardening.sh's `
        + `read-back and its warning are describing something that stopped being true:\n${output}`);
    assert.equal(value('DROPIN-ALONE'), 'no',
        `${image}: 99-hardening.conf alone did not disable password authentication:\n${output}`);
    // The spelling is evidence, and the script that reads it has to match whatever this
    // release prints. Debian 13 has OpenSSH 9.9 and prints lowercase; kali-rolling has
    // 10.5p1 and prints CamelCase, which a case-sensitive read-back would miss entirely
    // while reporting success on a machine that still accepts passwords.
    const spelling = value('SSHD-KEYWORD') || '';
    assert.match(spelling, /^passwordauthentication$/i,
        `${image}: sshd -T no longer reports that keyword at all:\n${output}`);
    if (spelling !== spelling.toLowerCase()) {
        assert.match(hardening, /grep -iE/,
            `${image} spells it ${spelling} (${value('SSHD-VERSION')}), so setup-hardening.sh `
            + `must read the effective configuration back case-insensitively`);
        assert.match(hardening, /grep -qix/,
            `${image} spells it ${spelling}, so the surviving-yes check must be case-insensitive too`);
    }
    assert.equal(value('DROPIN-VALIDATES'), '0',
        `${image}: sshd rejected the drop-in this repository writes:\n${output}`);

    assert.match(value('CONKY-STD') || '', /conky/i,
        `${image}: conky-std did not install a working conky:\n${output}`);

    // The Tor key: fetched by the fingerprint the script names, so a key that answers
    // proves the fingerprint is still the one keys.openpgp.org serves.
    const want = value('TOR-WANT');
    assert.match(want || '', /^[0-9A-F]{40}$/,
        `${image}: setup-tor-browser.sh has no literal fingerprint to check:\n${output}`);
    if (value('TOR-KEY-BYTES') === 'unreachable') {
        console.log(`extras-container-smoke: ${image}: keys.openpgp.org unreachable, key not checked`);
    } else {
        assert.equal(value('TOR-FINGERPRINT'), want,
            `${image}: keys.openpgp.org served a different key for that fingerprint:\n${output}`);
    }
    console.log(`extras-container-smoke: ${image} confirmed the phase 4 system facts`);
}

console.log('extras-container-smoke: all checks passed');
