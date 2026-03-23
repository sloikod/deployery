#!/usr/bin/env bash
set -euo pipefail

export DEPLOYERY_BASE_URL="${DEPLOYERY_BASE_URL:-http://localhost:3131}"
export DEPLOYERY_SQLITE_PATH="${DEPLOYERY_SQLITE_PATH:-/var/lib/deployery/data/deployery.sqlite}"
export DEPLOYERY_SANDBOX_ROOTFS="${DEPLOYERY_SANDBOX_ROOTFS:-/var/lib/deployery/sandbox-rootfs}"
export DEPLOYERY_SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME:-/home/deployery}"
export DEPLOYERY_CODE_SERVER_PORT="${DEPLOYERY_CODE_SERVER_PORT:-13337}"
export PORT="${PORT:-3131}"

ROOTFS_TEMPLATE="/opt/deployery/base-rootfs"
ROOTFS_MARKER="${DEPLOYERY_SANDBOX_ROOTFS}/.deployery-rootfs-initialized"

mkdir -p /var/lib/deployery/data
mkdir -p "${DEPLOYERY_SANDBOX_ROOTFS}"

if [ ! -f "${ROOTFS_MARKER}" ]; then
  rsync -a --delete "${ROOTFS_TEMPLATE}/" "${DEPLOYERY_SANDBOX_ROOTFS}/"
  touch "${ROOTFS_MARKER}"
fi

mount_bind() {
  local source="$1"
  local target="$2"

  mkdir -p "${target}"
  if mountpoint -q "${target}"; then
    return
  fi

  mount --rbind "${source}" "${target}"
}

mount_bind /dev "${DEPLOYERY_SANDBOX_ROOTFS}/dev"
mount_bind /proc "${DEPLOYERY_SANDBOX_ROOTFS}/proc"
mount_bind /sys "${DEPLOYERY_SANDBOX_ROOTFS}/sys"
mount_bind /run "${DEPLOYERY_SANDBOX_ROOTFS}/run"

cat > /var/lib/deployery/data/env <<EOF
export DEPLOYERY_BASE_URL="${DEPLOYERY_BASE_URL}"
export DEPLOYERY_SQLITE_PATH="${DEPLOYERY_SQLITE_PATH}"
export DEPLOYERY_SANDBOX_ROOTFS="${DEPLOYERY_SANDBOX_ROOTFS}"
export DEPLOYERY_SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME}"
export VSCODE_PROXY_URI="./proxy/{{port}}"
EOF

/deployery/install-managed-assets.sh
/deployery/start-sway.sh &
/deployery/start-code-server.sh &

exec node /deployery/apps/api/dist/index.js
