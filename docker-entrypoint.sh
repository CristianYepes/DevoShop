#!/bin/sh
# Starts PostgreSQL inside the app container, loads db/init.sql on first start,
# then runs the app (CMD) in the foreground.
#
# The database lives in the container's filesystem: on Cloud Run it starts fresh
# from init.sql on every new instance, and each instance has its own copy.
set -eu

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  initdb --username="$PGUSER" --auth=trust --encoding=UTF8 --locale=C.UTF-8 -D "$PGDATA" >/dev/null
  # Only reachable from inside the container.
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = $PGPORT"
    echo "shared_buffers = 32MB"
    echo "max_connections = 20"
  } >> "$PGDATA/postgresql.conf"
  FIRST_START=1
fi

pg_ctl -D "$PGDATA" -l "$PGDATA/postgres.log" -w -t 30 start >/dev/null

if [ "${FIRST_START:-0}" = 1 ]; then
  createdb "$PGDATABASE"
  psql -q -v ON_ERROR_STOP=1 -f /app/db/init.sql >/dev/null
  echo "postgres: database $PGDATABASE loaded from db/init.sql"
fi

# Stop Postgres cleanly when the container is asked to stop.
APP_PID=
shutdown() {
  [ -n "$APP_PID" ] && kill -TERM "$APP_PID" 2>/dev/null || true
  pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
}
trap shutdown TERM INT

"$@" &
APP_PID=$!
set +e
wait "$APP_PID"
STATUS=$?
[ "$STATUS" -gt 128 ] && wait "$APP_PID" && STATUS=$?
shutdown
exit "$STATUS"
