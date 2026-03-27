#!/usr/bin/env bash
set -euo pipefail

SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME:-/home/user}"
DEFAULT_WORKSPACE="${DEPLOYERY_CODE_SERVER_DEFAULT_WORKSPACE:-${SANDBOX_HOME}/Desktop}"
MANAGED_ASSETS_DIR="/deployery/managed-assets"
BRANDING_DIR="/deployery/code-server-branding"
SANDBOX_USER_HOME="${SANDBOX_HOME}"
CHROME_INITIAL_PREFERENCES_SOURCE="/deployery/google-chrome-initial-preferences.json"
CHROME_MANAGED_POLICIES_SOURCE="/deployery/google-chrome-managed-policies.json"

mkdir -p "${SANDBOX_USER_HOME}/Desktop"
mkdir -p "${SANDBOX_USER_HOME}/.local/share/code-server/User"
mkdir -p /etc/profile.d
mkdir -p /etc/apt/apt.conf.d
mkdir -p "${SANDBOX_USER_HOME}/.config/deployery"

cat > "${SANDBOX_USER_HOME}/.config/deployery/env" <<EOF
export DEPLOYERY_BASE_URL="${DEPLOYERY_BASE_URL:-http://localhost:3131}"
export VSCODE_PROXY_URI="./proxy/{{port}}"
EOF

if [ -f /usr/share/applications/google-chrome.desktop ]; then
  mkdir -p /etc/opt/chrome/policies/managed
  install -m 0644 "${CHROME_INITIAL_PREFERENCES_SOURCE}" /opt/google/chrome/initial_preferences
  install -m 0644 "${CHROME_MANAGED_POLICIES_SOURCE}" /etc/opt/chrome/policies/managed/deployery.json

  (
    export XDG_CONFIG_HOME="${SANDBOX_USER_HOME}/.config"
    export XDG_DATA_HOME="${SANDBOX_USER_HOME}/.local/share"
    export HOME="${SANDBOX_USER_HOME}"
    xdg-mime default google-chrome.desktop x-scheme-handler/http
    xdg-mime default google-chrome.desktop x-scheme-handler/https
    xdg-mime default google-chrome.desktop text/html
    xdg-mime default google-chrome.desktop application/xhtml+xml
    xdg-settings set default-web-browser google-chrome.desktop || true
  )
fi

rsync -a --ignore-existing "${MANAGED_ASSETS_DIR}/Desktop/" "${SANDBOX_USER_HOME}/Desktop/"

if [ ! -f "${SANDBOX_USER_HOME}/.local/share/code-server/User/settings.json" ]; then
  cp "${MANAGED_ASSETS_DIR}/code-server/settings.json" "${SANDBOX_USER_HOME}/.local/share/code-server/User/settings.json"
fi

CODE_SERVER_STATE_PATH="${SANDBOX_USER_HOME}/.local/share/code-server/coder.json"
CODE_SERVER_STATE_PATH="${CODE_SERVER_STATE_PATH}" \
SANDBOX_HOME="${SANDBOX_HOME}" \
DEFAULT_WORKSPACE="${DEFAULT_WORKSPACE}" \
node <<'EOF'
const fs = require("fs");

const statePath = process.env.CODE_SERVER_STATE_PATH;
const sandboxHome = process.env.SANDBOX_HOME;
const defaultWorkspace = process.env.DEFAULT_WORKSPACE;

let state = {};

if (fs.existsSync(statePath)) {
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    state = {};
  }
}

state.query ??= {};
state.lastVisited ??= {};

if (!state.query.folder || state.query.folder === sandboxHome) {
  state.query.folder = defaultWorkspace;
}

if (!state.lastVisited.url || state.lastVisited.url === sandboxHome) {
  state.lastVisited.url = defaultWorkspace;
  state.lastVisited.workspace = false;
}

fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
EOF

cp /deployery/wayland-env.sh /etc/profile.d/deployery-wayland.sh

cat > /etc/apt/apt.conf.d/80deployery-network <<'EOF'
Acquire::Retries "3";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
EOF

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
