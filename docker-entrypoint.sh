#!/bin/sh
set -eu
umask 077

PUID="${PUID:-99}"
PGID="${PGID:-100}"
DATA_DIR=/app/data
PRISMA_CLI=/app/node_modules/prisma/build/index.js

case "$PUID$PGID" in
  *[!0-9]*)
    echo "PUID and PGID must be numeric." >&2
    exit 1
    ;;
esac

# Unquoted on purpose below: empty when already unprivileged, else two words.
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  # A host-mounted dir (e.g. Unraid appdata) arrives root-owned, and the
  # database holds encrypted credentials, so lock it to the runtime user.
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  RUN_AS="su-exec $PUID:$PGID"
fi

# shellcheck disable=SC2086
if ! $RUN_AS sh -c 'touch "$1/.write-test" && rm -f "$1/.write-test"' sh "$DATA_DIR" 2>/dev/null; then
  echo "$DATA_DIR is not writable by the runtime user. Fix the volume ownership or set PUID/PGID to match it." >&2
  exit 1
fi

# shellcheck disable=SC2086
$RUN_AS node "$PRISMA_CLI" migrate deploy --schema prisma/schema.prisma

# shellcheck disable=SC2086
exec $RUN_AS node dist/index.js
