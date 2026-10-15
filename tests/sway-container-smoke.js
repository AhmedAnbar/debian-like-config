// SPDX-License-Identifier: GPL-3.0-only
// Validates the real configuration inside both releases. Gated: needs Docker.
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (process.env.DEBIAN_SETUP_CONTAINER_TESTS !== '1') {
    console.log('sway-container-smoke: skipped (set DEBIAN_SETUP_CONTAINER_TESTS=1 to run)');
    process.exit(0);
}

// The configuration is mounted read-only at the path the session expects, so sway -C
// resolves the include and the scripts' paths exactly as it would on the machine.
const script = `
set -e
apt-get update -qq >/dev/null 2>&1
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends sway waybar jq >/dev/null 2>&1
mkdir -p "$HOME/.config"
cp -r /bundle/config/sway /bundle/config/waybar /bundle/config/mako /bundle/config/swaylock "$HOME/.config/"
cp /bundle/profiles/zenbook-um5606.conf "$HOME/.config/sway/config.d/00-local.conf"
echo "sway: $(sway --version)"
# sway 1.10 starts its server before it validates, so -C alone looks for a DRM
# device and aborts in a container. The headless backend gives it one to find.
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 XDG_RUNTIME_DIR=/tmp \\
  sway -C -c "$HOME/.config/sway/config" && echo "sway -C: ok"
echo "waybar: $(waybar --version)"
# Waybar only parses its configuration once it has a Wayland display, so give it a
# headless one. D-Bus must exist or the tray module logs a failure that is not ours.
printf 'exec waybar\\nexec sh -c "sleep 8; swaymsg exit"\\n' > /tmp/probe.conf
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 XDG_RUNTIME_DIR=/tmp \\
  dbus-run-session -- sway -c /tmp/probe.conf > /tmp/log 2>&1 || true
grep -E 'waybar|\\[error\\]' /tmp/log || true
`;

for (const image of ['debian:stable-slim', 'ubuntu:latest']) {
    const result = spawnSync('docker', ['run', '--rm', '-v', `${root}:/bundle:ro`,
        '-e', 'HOME=/tmp/home', image, 'sh', '-c', script],
        {encoding: 'utf8', timeout: 1800000});
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, `${image}: ${output}`);
    assert.match(output, /sway -C: ok/, `${image}: sway rejected the configuration:\n${output}`);
    // A module name Waybar does not know is reported as an error on startup.
    assert.doesNotMatch(output, /\[error\].*(module|config|json)/i,
        `${image}: Waybar complained about the configuration:\n${output}`);
    const version = output.match(/waybar: Waybar v([\d.]+)/);
    assert.ok(version, `${image}: no Waybar version in the output:\n${output}`);
    console.log(`sway-container-smoke: ${image} validated with sway ` +
        `${(output.match(/sway: sway version ([\d.]+)/) || [])[1]} and waybar ${version[1]}`);
}
console.log('sway-container-smoke: all checks passed');
