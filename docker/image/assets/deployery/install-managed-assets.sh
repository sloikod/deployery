#!/usr/bin/env bash
set -euo pipefail

SANDBOX_ROOTFS="${DEPLOYERY_SANDBOX_ROOTFS:?DEPLOYERY_SANDBOX_ROOTFS is required}"
SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME:-/home/user}"
SANDBOX_USER_HOME="${SANDBOX_ROOTFS}${SANDBOX_HOME}"
MANAGED_ASSETS_DIR="/opt/deployery/managed-assets"
EXTENSION_VSIX="/opt/deployery/extensions/deployery-extension-desktop.vsix"
SANDBOX_DEPLOYERY_DIR="${SANDBOX_ROOTFS}/deployery"
SANDBOX_EXTENSION_DIR="${SANDBOX_ROOTFS}/opt/deployery/extensions"
SANDBOX_BRANDING_DIR="${SANDBOX_ROOTFS}/opt/deployery/code-server-branding"

mkdir -p "${SANDBOX_USER_HOME}/Desktop"
mkdir -p "${SANDBOX_USER_HOME}/.local/share/code-server/User"
mkdir -p "${SANDBOX_ROOTFS}/etc/profile.d"
mkdir -p "${SANDBOX_EXTENSION_DIR}"
mkdir -p "${SANDBOX_BRANDING_DIR}"

mkdir -p "${SANDBOX_USER_HOME}/.config/deployery"
cat > "${SANDBOX_USER_HOME}/.config/deployery/env" <<EOF
export DEPLOYERY_BASE_URL="${DEPLOYERY_BASE_URL:-http://localhost:3131}"
export VSCODE_PROXY_URI="./proxy/{{port}}"
EOF

rsync -a --ignore-existing "${MANAGED_ASSETS_DIR}/Desktop/" "${SANDBOX_USER_HOME}/Desktop/"
rsync -a --delete /deployery/ "${SANDBOX_DEPLOYERY_DIR}/"
rsync -a --delete "${MANAGED_ASSETS_DIR}/code-server/branding/" "${SANDBOX_BRANDING_DIR}/"
cp /etc/resolv.conf "${SANDBOX_ROOTFS}/etc/resolv.conf"

if [ ! -f "${SANDBOX_USER_HOME}/.local/share/code-server/User/settings.json" ]; then
  cp "${MANAGED_ASSETS_DIR}/code-server/settings.json" "${SANDBOX_USER_HOME}/.local/share/code-server/User/settings.json"
fi
cp /deployery/wayland-env.sh "${SANDBOX_ROOTFS}/etc/profile.d/deployery-wayland.sh"

if ! grep -q "deployery-wayland.sh" "${SANDBOX_USER_HOME}/.bashrc" 2>/dev/null; then
  printf '\nsource /etc/profile.d/deployery-wayland.sh\n' >> "${SANDBOX_USER_HOME}/.bashrc"
fi
if ! grep -q ".config/deployery/env" "${SANDBOX_USER_HOME}/.bashrc" 2>/dev/null; then
  printf '\n[ -f ~/.config/deployery/env ] && source ~/.config/deployery/env\n' >> "${SANDBOX_USER_HOME}/.bashrc"
fi

chroot "${SANDBOX_ROOTFS}" chown -R user:user "${SANDBOX_HOME}"

cat > "${SANDBOX_ROOTFS}/usr/local/bin/deployery" <<'EOF'
#!/usr/bin/env bash
exec node /deployery/packages/cli/dist/main.js "$@"
EOF
chmod +x "${SANDBOX_ROOTFS}/usr/local/bin/deployery"

CODE_SERVER_MEDIA_DIR="$(find "${SANDBOX_ROOTFS}/usr/lib/code-server" -path '*/src/browser/media' | head -1 || true)"
if [ -n "${CODE_SERVER_MEDIA_DIR}" ]; then
  cp "${SANDBOX_BRANDING_DIR}/deployery-favicon.svg" "${CODE_SERVER_MEDIA_DIR}/favicon.svg"
  cp "${SANDBOX_BRANDING_DIR}/deployery-favicon.svg" "${CODE_SERVER_MEDIA_DIR}/favicon-dark-support.svg"
  cp "${SANDBOX_BRANDING_DIR}/deployery-favicon.ico" "${CODE_SERVER_MEDIA_DIR}/favicon.ico"
  cp "${SANDBOX_BRANDING_DIR}/pwa-icon-192.png" "${CODE_SERVER_MEDIA_DIR}/pwa-icon-192.png"
  cp "${SANDBOX_BRANDING_DIR}/pwa-icon-512.png" "${CODE_SERVER_MEDIA_DIR}/pwa-icon-512.png"
  cp "${SANDBOX_BRANDING_DIR}/pwa-icon-maskable-192.png" "${CODE_SERVER_MEDIA_DIR}/pwa-icon-maskable-192.png"
  cp "${SANDBOX_BRANDING_DIR}/pwa-icon-maskable-512.png" "${CODE_SERVER_MEDIA_DIR}/pwa-icon-maskable-512.png"
fi

if [ -f "${EXTENSION_VSIX}" ]; then
  cp "${EXTENSION_VSIX}" "${SANDBOX_EXTENSION_DIR}/deployery-extension-desktop.vsix"
  DEPLOYERY_SANDBOX_ROOTFS="${SANDBOX_ROOTFS}" DEPLOYERY_SANDBOX_HOME="${SANDBOX_HOME}" \
    /deployery/start-code-server.sh --install-extension /opt/deployery/extensions/deployery-extension-desktop.vsix --force >/tmp/deployery-extension-install.log 2>&1 || true
fi

DEPLOYERY_CODE_SERVER_ROOTFS="${SANDBOX_ROOTFS}" \
  node /deployery/patch-code-server-workbench.js >/tmp/deployery-code-server-patch.log 2>&1 || true

DEPLOYERY_SANDBOX_ROOTFS="${SANDBOX_ROOTFS}" DEPLOYERY_SANDBOX_HOME="${SANDBOX_HOME}" \
  /deployery/start-code-server.sh --install-extension thang-nm.flow-icons --force >/tmp/deployery-flow-icons-install.log 2>&1 || true
