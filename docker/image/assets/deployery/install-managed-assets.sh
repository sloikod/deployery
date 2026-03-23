#!/usr/bin/env bash
set -euo pipefail

SANDBOX_ROOTFS="${DEPLOYERY_SANDBOX_ROOTFS:?DEPLOYERY_SANDBOX_ROOTFS is required}"
SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME:-/home/deployery}"
SANDBOX_USER_HOME="${SANDBOX_ROOTFS}${SANDBOX_HOME}"
MANAGED_ASSETS_DIR="/opt/deployery/managed-assets"
EXTENSION_VSIX="/opt/deployery/extensions/deployery-extension-desktop.vsix"
SANDBOX_DEPLOYERY_DIR="${SANDBOX_ROOTFS}/deployery"
SANDBOX_EXTENSION_DIR="${SANDBOX_ROOTFS}/opt/deployery/extensions"

mkdir -p "${SANDBOX_USER_HOME}/Desktop"
mkdir -p "${SANDBOX_USER_HOME}/.local/share/code-server/User"
mkdir -p "${SANDBOX_ROOTFS}/etc/profile.d"
mkdir -p "${SANDBOX_EXTENSION_DIR}"

rsync -a --ignore-existing "${MANAGED_ASSETS_DIR}/Desktop/" "${SANDBOX_USER_HOME}/Desktop/"
rsync -a --delete /deployery/ "${SANDBOX_DEPLOYERY_DIR}/"
cp /etc/resolv.conf "${SANDBOX_ROOTFS}/etc/resolv.conf"

if [ ! -f "${SANDBOX_USER_HOME}/.local/share/code-server/User/settings.json" ]; then
  cp "${MANAGED_ASSETS_DIR}/code-server/settings.json" "${SANDBOX_USER_HOME}/.local/share/code-server/User/settings.json"
fi
cp /deployery/wayland-env.sh "${SANDBOX_ROOTFS}/etc/profile.d/deployery-wayland.sh"

if ! grep -q "deployery-wayland.sh" "${SANDBOX_USER_HOME}/.bashrc" 2>/dev/null; then
  printf '\nsource /etc/profile.d/deployery-wayland.sh\n' >> "${SANDBOX_USER_HOME}/.bashrc"
fi

chroot "${SANDBOX_ROOTFS}" chown -R deployery:deployery "${SANDBOX_HOME}"

cat > "${SANDBOX_ROOTFS}/usr/local/bin/deployery" <<'EOF'
#!/usr/bin/env bash
exec node /deployery/packages/cli/dist/main.js "$@"
EOF
chmod +x "${SANDBOX_ROOTFS}/usr/local/bin/deployery"

if [ -f "${EXTENSION_VSIX}" ]; then
  cp "${EXTENSION_VSIX}" "${SANDBOX_EXTENSION_DIR}/deployery-extension-desktop.vsix"
  DEPLOYERY_SANDBOX_ROOTFS="${SANDBOX_ROOTFS}" DEPLOYERY_SANDBOX_HOME="${SANDBOX_HOME}" \
    /deployery/start-code-server.sh --install-extension /opt/deployery/extensions/deployery-extension-desktop.vsix --force >/tmp/deployery-extension-install.log 2>&1 || true
fi
