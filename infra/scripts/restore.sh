#!/bin/sh
# Restore an Openvoice PostgreSQL logical backup produced by backup.sh.
#
# Usage (from the repo host, stack running):
#   # list available dumps
#   docker compose -f docker-compose.prod.yml exec db-backup ls -1 /backups
#   # restore a specific dump (DESTRUCTIVE: --clean drops existing objects)
#   docker compose -f docker-compose.prod.yml exec -e DUMP=openvoice-YYYYMMDDTHHMMSSZ.sql.gz \
#     db-backup sh /usr/local/bin/restore.sh
#
# The dump was written with --clean --if-exists, so it drops and recreates
# objects; restoring over a live database replaces its contents. Stop the api
# service first for a clean restore:
#   docker compose -f docker-compose.prod.yml stop api
set -eu

PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-openvoice}"
PGDATABASE="${PGDATABASE:-openvoice}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

if [ -z "${DUMP:-}" ]; then
  echo "Set DUMP=<filename> (see: ls $BACKUP_DIR)" >&2
  exit 2
fi

path="$BACKUP_DIR/$DUMP"
if [ ! -f "$path" ]; then
  echo "No such dump: $path" >&2
  exit 2
fi

echo "[restore] restoring $path into $PGDATABASE on $PGHOST"
# psql with ON_ERROR_STOP so a mid-restore failure is loud, not silent.
gunzip -c "$path" | psql -v ON_ERROR_STOP=1 -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE"
echo "[restore] done. Start the api service to run migrations if needed."
