#!/usr/bin/env bash
set -euo pipefail

SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME:-/home/user}"
MANAGED_ASSETS_DIR="/deployery/managed-assets"
BRANDING_DIR="/deployery/code-server-branding"
SANDBOX_USER_HOME="${SANDBOX_HOME}"

mkdir -p "${SANDBOX_USER_HOME}/Desktop"
mkdir -p "${SANDBOX_USER_HOME}/.local/share/code-server/User"
mkdir -p /etc/profile.d
mkdir -p "${SANDBOX_USER_HOME}/.config/deployery"

cat > "${SANDBOX_USER_HOME}/.config/deployery/env" <<EOF
export DEPLOYERY_BASE_URL="${DEPLOYERY_BASE_URL:-http://localhost:3131}"
export VSCODE_PROXY_URI="./proxy/{{port}}"
EOF

rsync -a --ignore-existing "${MANAGED_ASSETS_DIR}/Desktop/" "${SANDBOX_USER_HOME}/Desktop/"

if [ ! -f "${SANDBOX_USER_HOME}/.local/share/code-server/User/settings.json" ]; then
  cp "${MANAGED_ASSETS_DIR}/code-server/settings.json" "${SANDBOX_USER_HOME}/.local/share/code-server/User/settings.json"
fi
cp /deployery/wayland-env.sh /etc/profile.d/deployery-wayland.sh

if ! grep -q "deployery-wayland.sh" "${SANDBOX_USER_HOME}/.bashrc" 2>/dev/null; then
  printf '\nsource /etc/profile.d/deployery-wayland.sh\n' >> "${SANDBOX_USER_HOME}/.bashrc"
fi
if ! grep -q ".config/deployery/env" "${SANDBOX_USER_HOME}/.bashrc" 2>/dev/null; then
  printf '\n[ -f ~/.config/deployery/env ] && source ~/.config/deployery/env\n' >> "${SANDBOX_USER_HOME}/.bashrc"
fi

chown -R user:user "${SANDBOX_HOME}"

cat > /usr/local/bin/deployery <<'EOF'
#!/usr/bin/env bash
exec node /deployery/packages/cli/dist/main.js "$@"
EOF
chmod +x /usr/local/bin/deployery

node /deployery/patch-code-server-workbench.js >/tmp/deployery-code-server-patch.log 2>&1 || true

CODE_SERVER_MEDIA_DIR="$(find /usr/lib/code-server -path '*/src/browser/media' | head -1 || true)"
if [ -n "${CODE_SERVER_MEDIA_DIR}" ]; then
  cp "${BRANDING_DIR}/deployery-favicon.svg" "${CODE_SERVER_MEDIA_DIR}/favicon.svg"
  cp "${BRANDING_DIR}/deployery-favicon.svg" "${CODE_SERVER_MEDIA_DIR}/favicon-dark-support.svg"
  cp "${BRANDING_DIR}/deployery-favicon.ico" "${CODE_SERVER_MEDIA_DIR}/favicon.ico"
  cp "${BRANDING_DIR}/pwa-icon-192.png" "${CODE_SERVER_MEDIA_DIR}/pwa-icon-192.png"
  cp "${BRANDING_DIR}/pwa-icon-512.png" "${CODE_SERVER_MEDIA_DIR}/pwa-icon-512.png"
  cp "${BRANDING_DIR}/pwa-icon-maskable-192.png" "${CODE_SERVER_MEDIA_DIR}/pwa-icon-maskable-192.png"
  cp "${BRANDING_DIR}/pwa-icon-maskable-512.png" "${CODE_SERVER_MEDIA_DIR}/pwa-icon-maskable-512.png"
fi
