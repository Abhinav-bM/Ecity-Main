#!/usr/bin/env bash
#
# Restore a backup into a scratch database, check it, and time it (FR-32.1).
#
# "If you have never done this, you do not have backups — you have files you
# hope are backups." This is that drill, as a script rather than a paragraph,
# because a drill somebody has to remember the steps for is a drill that gets
# skipped.
#
# It answers the two questions that matter on the worst day: does the backup
# restore, and how long does the shop have to be shut while it does.
#
# Usage:  ./restore-drill.sh                 newest dump in BACKUP_DIR
#         ./restore-drill.sh path/to.dump    a particular one
set -euo pipefail

DUMP="${1:-}"
OUT="${BACKUP_DIR:-/var/backups/ecity}"
DRILL_DB="${DRILL_DB:-ecity_drill}"

if [[ -z "$DUMP" ]]; then
  DUMP=$(ls -t "$OUT"/db-*.dump 2>/dev/null | head -1 || true)
  [[ -n "$DUMP" ]] || { echo "no dump found in $OUT" >&2; exit 1; }
fi
[[ -f "$DUMP" ]] || { echo "no such dump: $DUMP" >&2; exit 1; }

echo "› restoring $DUMP into $DRILL_DB"
START=$(date +%s)

# A scratch database, dropped at the end. Never restore a drill over the
# live one: the whole point is to find out whether the backup is good, and
# discovering it is not, on top of the real data, is the disaster.
dropdb --if-exists "$DRILL_DB"
createdb "$DRILL_DB"
trap 'dropdb --if-exists "$DRILL_DB"' EXIT

pg_restore --no-owner --no-privileges -d "$DRILL_DB" "$DUMP" >/dev/null 2>&1 || true

ELAPSED=$(( $(date +%s) - START ))

# The check that matters: is this the shop's data, or an empty shell that
# restored without complaint? Money and stock, because those are what the
# business cannot reconstruct.
read -r SALES DEVICES LEDGER MOVEMENTS <<<"$(psql -tA -d "$DRILL_DB" -c "
  select
    (select count(*) from sale),
    (select count(*) from device_unit),
    (select count(*) from customer_ledger_entry),
    (select count(*) from cash_movement);" | tr '|' ' ')"

echo "  sales:            ${SALES}"
echo "  devices:          ${DEVICES}"
echo "  customer ledger:  ${LEDGER}"
echo "  cash movements:   ${MOVEMENTS}"
echo "  restore took:     ${ELAPSED}s"

# The append-only guards must come back too, or the restored database is
# writable in ways the live one never was — and this is the copy somebody
# would promote to live on a bad day.
#
# Counting `pg_trigger` rows only proves they exist. What matters is that
# they *fire*, so the drill actually attempts a forbidden write and expects
# to be refused. A guard that restored but did not enforce would pass a
# count and fail the shop.
TRIGGERS=$(psql -tA -d "$DRILL_DB" -c \
  "select count(*) from pg_trigger
   where not tgisinternal and (tgname like '%\\_no\\_update' or tgname like '%\\_no\\_delete');")
echo "  append-only guards: ${TRIGGERS}"

if psql -q -d "$DRILL_DB" -c "update audit_log set action = action where id = (select min(id) from audit_log);" >/dev/null 2>&1
then
  ENFORCED=false
else
  ENFORCED=true
fi
echo "  guards enforce:     ${ENFORCED}"

FAILED=false
[[ "${DEVICES:-0}" -gt 0 ]] || { echo "✗ no devices restored" >&2; FAILED=true; }
[[ "${TRIGGERS:-0}" -gt 0 ]] || { echo "✗ append-only triggers missing" >&2; FAILED=true; }
[[ "$ENFORCED" == true ]] || { echo "✗ append-only guards did not refuse a write" >&2; FAILED=true; }

if [[ "$FAILED" == true ]]; then
  echo "✗ DRILL FAILED — this backup is not one you can rely on" >&2
  exit 1
fi

echo "✓ drill passed in ${ELAPSED}s. Write that number down: it is how long"
echo "  the shop is shut for while you restore."
