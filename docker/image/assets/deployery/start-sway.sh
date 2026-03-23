#!/usr/bin/env bash
set -euo pipefail

SANDBOX_ROOTFS="${DEPLOYERY_SANDBOX_ROOTFS:?DEPLOYERY_SANDBOX_ROOTFS is required}"
SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME:-/home/deployery}"

# Ensure /tmp exists and is world-writable — debootstrap --variant=minbase does not
# guarantee this, and rsync preserves whatever permissions the template had.
mkdir -p "${SANDBOX_ROOTFS}/tmp"
chmod 1777 "${SANDBOX_ROOTFS}/tmp"

# Write the Sway config into the chroot's /tmp before starting the compositor.
# This mirrors what the VS Code extension writes at runtime (app-session.ts:SWAY_CONFIG),
# so the extension's findExistingSwaySocket() reattach path works without a config reload.
cat > "${SANDBOX_ROOTFS}/tmp/sway-config" <<'EOF'
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
seat * xcursor_theme transparent-cursor 24
EOF

# Ensure XDG_RUNTIME_DIR exists and is owned by deployery before Sway starts.
chroot --userspec=deployery:deployery "${SANDBOX_ROOTFS}" \
    /bin/bash -c "mkdir -p /tmp/sway-runtime && chmod 700 /tmp/sway-runtime"

exec chroot --userspec=deployery:deployery "${SANDBOX_ROOTFS}" /usr/bin/env -i \
    HOME="${SANDBOX_HOME}" \
    USER="deployery" \
    LOGNAME="deployery" \
    SHELL="/bin/bash" \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    XDG_RUNTIME_DIR=/tmp/sway-runtime \
    WLR_BACKENDS=headless \
    WLR_RENDERER=pixman \
    WLR_LIBINPUT_NO_DEVICES=1 \
    LIBSEAT_BACKEND=noop \
    XCURSOR_THEME=transparent-cursor \
    XCURSOR_SIZE=24 \
    sway --config /tmp/sway-config
