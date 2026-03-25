#!/usr/bin/env bash
set -euo pipefail

SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME:-/home/user}"

mkdir -p /tmp /tmp/sway-runtime
chmod 1777 /tmp
rm -f /tmp/sway-config

cat > /tmp/sway-config <<'EOF'
xwayland enable
default_border none
default_floating_border none
focus_on_window_activation none
gaps inner 0
gaps outer 0
bar {
    mode invisible
    tray_output none
}
output * bg #000000 solid_color
output * scale 1
seat * xcursor_theme macOS-Monterey 24
EOF

chown user:user /tmp/sway-config /tmp/sway-runtime
chmod 700 /tmp/sway-runtime

exec /usr/bin/sudo -u user /usr/bin/env -i \
    HOME="${SANDBOX_HOME}" \
    USER="user" \
    LOGNAME="user" \
    SHELL="/bin/bash" \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    XDG_RUNTIME_DIR=/tmp/sway-runtime \
    WLR_BACKENDS=headless \
    WLR_RENDERER=pixman \
    WLR_LIBINPUT_NO_DEVICES=1 \
    LIBSEAT_BACKEND=noop \
    XCURSOR_THEME=macOS-Monterey \
    XCURSOR_SIZE=24 \
    sway --unsupported-gpu --config /tmp/sway-config
