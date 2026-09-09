#!/usr/bin/env bash
#
# Take a backup, off-site (PRD FR-32.1).
#
# Runs from cron on the server. Three things matter here and each has cost
# somebody their data somewhere:
#
#   1. It fails loudly. A backup script that exits 0 after a failed dump is
#      worse than none — it buys a year of false confidence, and you find out
#      on the day you need it.
#   2. It dumps with -Z 0 so restic can deduplicate between snapshots.
#      Compressed dumps differ completely each night, and seventeen retained
#      snapshots then cost seventeen full copies.
#   3. It checks what it produced. An empty or truncated dump restores
#      cleanly into an empty database, which is the worst possible failure:
#      silent.
#
# Usage:  ./backup.sh            take a backup and push it off-site
#         ./backup.sh --local    dump only, no restic (for a quick local copy)
set -euo pipefail

LOCAL_ONLY=false
[[ "${1:-}" == "--local" ]] && LOCAL_ONLY=true

OUT="${BACKUP_DIR:-/var/backups/ecity}"
STAMP=$(date +%F-%H%M)
DUMP="$OUT/db-$STAMP.dump"
# A dump smaller than this is not a shop's database; it is an error message.
MIN_BYTES="${BACKUP_MIN_BYTES:-20000}"

fail() {
  echo "backup FAILED: $*" >&2
  exit 1
}

mkdir -p "$OUT"

echo "› dumping to $DUMP"
if [[ -n "${DATABASE_URL:-}" ]]; then
  # Local or CI: dump straight through the connection string.
  pg_dump -Fc -Z 0 "$DATABASE_URL" > "$DUMP" || fail "pg_dump exited non-zero"
else
  # On the server the database is a container (docs/04 §4.1).
  docker compose exec -T db pg_dump -U ecity -Fc -Z 0 ecity > "$DUMP" \
    || fail "pg_dump exited non-zero"
fi

SIZE=$(wc -c < "$DUMP" | tr -d ' ')
[[ "$SIZE" -ge "$MIN_BYTES" ]] || fail "dump is only ${SIZE} bytes — refusing to call that a backup"

# Prove it is a readable archive before trusting it. pg_restore --list reads
# the table of contents without touching a database; a truncated file fails
# here rather than on the day of the restore.
#
# Run wherever pg_restore actually exists. On the server that is inside the
# db container — the host has no Postgres client tools, only Docker.
if command -v pg_restore >/dev/null 2>&1; then
  toc() { pg_restore --list "$DUMP"; }
else
  toc() { docker compose exec -T db pg_restore --list < "$DUMP"; }
fi

toc > /dev/null 2>&1 || fail "dump is not a readable archive"
TABLES=$(toc | grep -c 'TABLE DATA' || true)
[[ "$TABLES" -ge 20 ]] || fail "dump holds only ${TABLES} tables — the schema is not all there"

echo "  ${SIZE} bytes, ${TABLES} tables"

if [[ "$LOCAL_ONLY" == true ]]; then
  echo "✓ local backup only: $DUMP"
  exit 0
fi

: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}"
: "${RESTIC_PASSWORD:?set RESTIC_PASSWORD — without it the repository cannot be read back}"

export RESTIC_REPOSITORY="s3:https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/${R2_BACKUP_BUCKET:-ecity-backups}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RESTIC_PASSWORD

echo "› sending off-site"
restic backup "$OUT" --tag ecity || fail "restic backup failed"
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune \
  || fail "restic forget failed"

# Keep a few days locally too: restoring from disk is faster than from R2,
# and the common emergency is a bad migration ten minutes ago.
find "$OUT" -name 'db-*.dump' -mtime +3 -delete

echo "✓ backup complete: $DUMP"
