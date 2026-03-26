#!/usr/bin/env bash
set -euo pipefail

export DEPLOYERY_BASE_URL="${DEPLOYERY_BASE_URL:-http://localhost:3131}"
export DEPLOYERY_SQLITE_PATH="${DEPLOYERY_SQLITE_PATH:-/var/lib/deployery/data/deployery.sqlite}"
export DEPLOYERY_SANDBOX_ROOTFS="${DEPLOYERY_SANDBOX_ROOTFS:-/}"
export DEPLOYERY_SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME:-/home/user}"
export DEPLOYERY_CODE_SERVER_PORT="${DEPLOYERY_CODE_SERVER_PORT:-13337}"
export DEPLOYERY_SANDBOX_ISOLATION_MODE="${DEPLOYERY_SANDBOX_ISOLATION_MODE:-compatibility}"
export DEPLOYERY_SANDBOX_RUNTIME="${DEPLOYERY_SANDBOX_RUNTIME:-runc}"
export PORT="${PORT:-3131}"

if [ "${DEPLOYERY_SANDBOX_ISOLATION_MODE}" = "hardened-runsc" ] || [ "${DEPLOYERY_SANDBOX_ISOLATION_MODE}" = "hardened-runsc-gpu" ]; then
  echo /usr/lib/libmonotonic-shim.so > /etc/ld.so.preload
fi

LEGACY_ROOTFS="/var/lib/deployery/sandbox-rootfs"
FLATTENED_MIGRATION_MARKER="/var/lib/deployery/.flattened-rootfs-migrated"

log_runtime_summary() {
  echo "Deployery sandbox runtime:"
  echo "  isolation mode: ${DEPLOYERY_SANDBOX_ISOLATION_MODE}"
  echo "  requested runtime: ${DEPLOYERY_SANDBOX_RUNTIME}"
  echo "  persistent rootfs: ${DEPLOYERY_SANDBOX_ROOTFS}"
  echo "  sandbox home: ${DEPLOYERY_SANDBOX_HOME}"
}

preflight_checks() {
  case "${DEPLOYERY_SANDBOX_ISOLATION_MODE}" in
    hardened-runsc)
      if [ "${DEPLOYERY_SANDBOX_RUNTIME}" != "runsc" ]; then
        echo "Deployery hardened mode requested, but DEPLOYERY_SANDBOX_RUNTIME=${DEPLOYERY_SANDBOX_RUNTIME}. Expected runsc." >&2
      fi
      ;;
    hardened-runsc-gpu)
      if [ "${DEPLOYERY_SANDBOX_RUNTIME}" != "runsc-gpu" ]; then
        echo "Deployery hardened GPU mode requested, but DEPLOYERY_SANDBOX_RUNTIME=${DEPLOYERY_SANDBOX_RUNTIME}. Expected runsc-gpu." >&2
      fi
      ;;
  esac
}

migrate_legacy_rootfs() {
  if [ -f "${FLATTENED_MIGRATION_MARKER}" ] || [ ! -d "${LEGACY_ROOTFS}" ]; then
    return
  fi

  if [ ! -d "${LEGACY_ROOTFS}/usr" ]; then
    return
  fi

  echo "Migrating legacy sandbox-rootfs into flattened persistent system volumes..."
  rsync -a "${LEGACY_ROOTFS}/usr/" /usr/
  rsync -a "${LEGACY_ROOTFS}/etc/" /etc/
  rsync -a "${LEGACY_ROOTFS}/opt/" /opt/
  rsync -a "${LEGACY_ROOTFS}/home/user/" /home/user/
  rsync -a --exclude "lib/deployery/" "${LEGACY_ROOTFS}/var/" /var/
  touch "${FLATTENED_MIGRATION_MARKER}"
}

preflight_checks
log_runtime_summary

mkdir -p /var/lib/deployery/data
migrate_legacy_rootfs

/deployery/install-managed-assets.sh
/deployery/start-sway.sh &
/deployery/start-code-server.sh &

exec node /deployery/apps/api/dist/index.js
