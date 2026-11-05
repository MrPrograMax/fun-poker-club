#!/bin/sh
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
"$APP_DIR/start.sh"
APP_STATUS=$?
if [ "$APP_STATUS" -ne 0 ] && [ "$APP_STATUS" -ne 130 ]; then
  printf '\n%s\n' 'Could not start Until Morning. See the message above.' 'Press Enter to close.'
  read -r REPLY || true
fi
exit "$APP_STATUS"
