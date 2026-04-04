#!/bin/sh
set -eu

tsx /opt/deployery/runtime/persistence.ts restore

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
