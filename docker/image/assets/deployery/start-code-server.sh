#!/usr/bin/env bash
set -euo pipefail

SANDBOX_ROOTFS="${DEPLOYERY_SANDBOX_ROOTFS:?DEPLOYERY_SANDBOX_ROOTFS is required}"
SANDBOX_HOME="${DEPLOYERY_SANDBOX_HOME:-/home/user}"
CODE_SERVER_PORT="${DEPLOYERY_CODE_SERVER_PORT:-13337}"
EXTRA_ARGS=("$@")

if [ "${#EXTRA_ARGS[@]}" -eq 0 ]; then
  EXTRA_ARGS=("${SANDBOX_HOME}")
fi

CODE_SERVER_CMD=(
  /usr/bin/code-server
  --bind-addr "127.0.0.1:${CODE_SERVER_PORT}"
  --auth none
  --app-name "Deployery"
  --i18n /opt/deployery/code-server-branding/deployery-i18n.json
  --disable-getting-started-override
  --disable-telemetry
  --disable-update-check
  "${EXTRA_ARGS[@]}"
)
printf -v CODE_SERVER_CMD_STR '%q ' "${CODE_SERVER_CMD[@]}"

exec chroot --userspec=user:user "${SANDBOX_ROOTFS}" /usr/bin/env -i \
  HOME="${SANDBOX_HOME}" \
  USER="user" \
  LOGNAME="user" \
  SHELL="/bin/bash" \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  VSCODE_PROXY_URI="./proxy/{{port}}" \
  /bin/bash -lc "cd '${SANDBOX_HOME}' && exec ${CODE_SERVER_CMD_STR}"
