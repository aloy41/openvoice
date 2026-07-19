#!/bin/sh
# Periodic PostgreSQL logical backups for the Openvoice production stack.
# Runs as the db-backup service in docker-compose.prod.yml. Each cycle writes a
# gzipped pg_dump to /backups and prunes dumps older than BACKUP_KEEP_DAYS.
#
# Standalone one-shot use (from the repo host):
#   docker compose -f docker-compose.prod.yml exec -e RUN_ONCE=1 db-backup sh /usr/local/bin/backup.sh
set -eu

PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-openvoice}"
PGDATABASE="${PGDATABASE:-openvoice}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

do_backup() {
  # UTC timestamp; sortable and timezone-unambiguous.
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  out="$BACKUP_DIR/openvoice-$ts.sql.gz"
  tmp="$out.partial"
  echo "[backup] dumping $PGDATABASE -> $out"
  if pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" --no-owner --clean --if-exists \
      | gzip -c > "$tmp"; then
    mv "$tmp" "$out"
    echo "[backup] wrote $(wc -c < "$out") bytes"
  else
    echo "[backup] FAILED; leaving no partial file" >&2
    rm -f "$tmp"
    return 1
  fi
  # Prune old dumps (best effort).
  find "$BACKUP_DIR" -name 'openvoice-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -print -delete || true
}

if [ "${RUN_ONCE:-0}" = "1" ]; then
  do_backup
  exit 0
fi

echo "[backup] service started; interval=${INTERVAL}s keep=${KEEP_DAYS}d"
while true; do
  # Never let a single failure kill the loop — log and retry next cycle.
  do_backup || echo "[backup] cycle failed; will retry" >&2
  sleep "$INTERVAL"
done
